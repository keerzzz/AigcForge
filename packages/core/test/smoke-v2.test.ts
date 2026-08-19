/**
 * P0.2 smoke test — packages/server V2 端到端 Layer 验证（R3 硬门槛）。
 *
 * 验证 SessionV2.prompt → SessionExecution.wake → SessionRunner.run 链能 resolve。
 * 目标不是测试 V2 功能（由 session-runner.test.ts 覆盖），而是证明 handlers.ts 的 Layer 提供链
 * （SessionV2.defaultLayer + SessionExecutionLocal.defaultLayer + LocationServiceMap.layer）
 * 能在运行时正确 resolve SessionRunner.Service。
 *
 * @see docs/plan/meta-agent-v2-production-closure.md §Phase 0
 */

import { afterEach, describe, expect } from "bun:test"
import {
  LLMClient,
  Model,
  type LLMEvent,
  type LLMRequest,
} from "@aigcfroge/llm"
import * as OpenAIChat from "@aigcfroge/llm/protocols/openai-chat"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { PermissionV2 } from "@aigcfroge/core/permission"
import { Project } from "@aigcfroge/core/project"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionRunCoordinator } from "@aigcfroge/core/session/run-coordinator"
import { SessionRunner } from "@aigcfroge/core/session/runner"
import * as SessionRunnerLLM from "@aigcfroge/core/session/runner/llm"
import { DoomLoop } from "@aigcfroge/core/session/doom-loop"
import { CorrectionExtractor } from "@aigcfroge/core/session/correction-extractor"
import { CorrectionStore } from "@aigcfroge/core/session/correction-store"
import { ReferenceChecker } from "@aigcfroge/core/session/reference-checker"
import { Verifier } from "@aigcfroge/core/session/verifier"
import { VerificationRouter } from "@aigcfroge/core/session/verification-router"
import { Ripgrep } from "../src/ripgrep"
import { RipgrepBinary } from "../src/ripgrep/binary"
import { FSUtil } from "../src/fs-util"
import { SessionRunnerModel } from "@aigcfroge/core/session/runner/model"
import { ToolRegistry } from "@aigcfroge/core/tool/registry"
import { ToolOutputStore } from "@aigcfroge/core/tool-output-store"
import { ApplicationTools } from "@aigcfroge/core/tool/application-tools"
import { AppProcess } from "@aigcfroge/core/process"
import { SkillV2 } from "@aigcfroge/core/skill"
import { AgentV2 } from "@aigcfroge/core/agent"
import { Config } from "@aigcfroge/core/config"
import { ConfigMeta } from "../src/config/meta"
import { ConfigCompaction } from "@aigcfroge/core/config/compaction"
import {
  SessionTable,
} from "@aigcfroge/core/session/sql"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { SessionStore } from "@aigcfroge/core/session/store"
import { SystemContext } from "@aigcfroge/core/system-context"
import { SystemContextRegistry } from "@aigcfroge/core/system-context/registry"
import { SkillGuidance } from "@aigcfroge/core/skill/guidance"
import { ReferenceGuidance } from "@aigcfroge/core/reference/guidance"
import { Location } from "@aigcfroge/core/location"
import { Effect, Layer, Schema, Stream } from "effect"
import { testEffect } from "./lib/effect"

// ── Mock LLM client ──────────────────────────────────────────────
const requests: LLMRequest[] = []
let response: LLMEvent[] = []

const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: ((request: LLMRequest) => {
      requests.push(request)
      return Stream.fromIterable(response)
    }) as unknown as (request: LLMRequest) => Stream.Stream<LLMEvent>,
    generate: () => Effect.die("unused"),
  }),
)

const model = Model.make({ id: "smoke-model", provider: "smoke", route: OpenAIChat.route })

// ── Mock permissions ──────────────────────────────────────────────
const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    effectiveRules: () => Effect.succeed([]),
    assert: () => Effect.void,
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

// ── Mock AgentV2 ──────────────────────────────────────────────────
const agents = AgentV2.layer

// ── Tool registry (minimal) ───────────────────────────────────────
const applications = ApplicationTools.layer
const registry = ToolRegistry.layer.pipe(
  Layer.provide(permission),
  Layer.provide(applications),
  Layer.provide(ToolOutputStore.defaultLayer),
)

// ── Mock model resolver ───────────────────────────────────────────
const models = SessionRunnerModel.layerWith((_session) => Effect.succeed(model))

// ── System context (minimal, following existing test pattern) ──────
const systemContextKey = SystemContext.Key.make("smoke/test")
const systemBaseline = "Smoke test baseline"
const systemContext = Layer.effectDiscard(
  SystemContextRegistry.Service.pipe(
    Effect.flatMap((registry) =>
      registry.register({
        key: systemContextKey,
        load: Effect.succeed(
          SystemContext.make({
            key: systemContextKey,
            codec: Schema.toCodecJson(Schema.String),
            load: Effect.succeed(systemBaseline),
            baseline: (current) => current,
            update: (_previous, current) => current,
            removed: () => "System context source removed: smoke/test",
          }),
        ),
      }),
    ),
  ),
).pipe(Layer.provideMerge(SystemContextRegistry.layer))

// ── Location ──────────────────────────────────────────────────────
const location = Location.layer({ directory: AbsolutePath.make("/smoke-test") }).pipe(
  Layer.provide(Project.defaultLayer),
)

// ── Skill/Reference guidance (mock) ───────────────────────────────
const skillGuidance = Layer.mock(SkillGuidance.Service, {
  load: () => Effect.succeed(SystemContext.empty),
})
const referenceGuidance = Layer.mock(ReferenceGuidance.Service, {
  load: () => Effect.succeed(SystemContext.empty),
})

// ── Config (minimal) ─────────────────────────────────────────────
const config = Layer.succeed(
  Config.Service,
  Config.Service.of({
    entries: () =>
      Effect.succeed([
        new Config.Document({
          type: "document",
          info: new Config.Info({
            compaction: new ConfigCompaction.Info({
              buffer: 100_000,
              keep: new ConfigCompaction.Keep({ tokens: 50_000 }),
            }),
            meta: ConfigMeta.Info.make({
              correction_store: ConfigMeta.CorrectionStore.make({ enabled: false }),
              verifier: ConfigMeta.Verifier.make({ enabled: false }),
            }),
          }),
        }),
      ]),
  }),
)

// ── SessionRunner (following location-layer.ts:99 pattern) ────────
const appProcess = Layer.succeed(
  AppProcess.Service,
  AppProcess.Service.of({
    run: () => Effect.die("AppProcess unused in smoke test"),
  } as unknown as AppProcess.Interface),
)
const skillV2 = Layer.succeed(
  SkillV2.Service,
  SkillV2.Service.of({ list: () => Effect.succeed([]) } as unknown as SkillV2.Interface),
)
const sessionComposition = SessionComposition.layer.pipe(Layer.provide(Database.defaultLayer))
const runner = SessionRunnerLLM.layer.pipe(
  Layer.provide(sessionComposition),
  Layer.provide(appProcess),
  Layer.provide(skillV2),
  Layer.provide(Database.defaultLayer),
  Layer.provide(SessionStore.defaultLayer),
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(client),
  Layer.provide(registry),
  Layer.provide(models),
  Layer.provide(systemContext),
).pipe(
  Layer.provide(location),
  Layer.provide(agents),
  Layer.provide(skillGuidance),
  Layer.provide(referenceGuidance),
  Layer.provide(DoomLoop.layer),
  Layer.provide(CorrectionExtractor.layer),
  Layer.provide(CorrectionStore.layer),
  Layer.provide(
    Verifier.layer.pipe(
      Layer.provide(VerificationRouter.layer.pipe(Layer.provide(config))),
      Layer.provide(CorrectionStore.layer.pipe(Layer.provide(config))),
      Layer.provide(EventV2.defaultLayer.pipe(Layer.provide(Database.defaultLayer))),
      Layer.provide(location),
      Layer.provide(appProcess),
      Layer.provide(config),
    ),
  ),
  Layer.provide(
    ReferenceChecker.layer.pipe(
      Layer.provide(CorrectionStore.layer.pipe(Layer.provide(config))),
      Layer.provide(location),
      Layer.provide(config),
      Layer.provide(Ripgrep.layer.pipe(Layer.provide(RipgrepBinary.defaultLayer), Layer.provide(appProcess))),
      Layer.provide(FSUtil.defaultLayer),
    ),
  ),
  Layer.provide(permission),
  Layer.provide(config),
)

// ── SessionExecution (following handlers.ts + location-layer.ts pattern) ─
const execution = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const sessionRunner = yield* SessionRunner.Service
    const coordinator = yield* SessionRunCoordinator.make<SessionV2.ID, SessionRunner.RunError>({
      drain: (sessionID, force) => sessionRunner.run({ sessionID, force }),
    })
    return SessionExecution.Service.of({
      resume: coordinator.run,
      wake: coordinator.wake,
      interrupt: coordinator.interrupt,
    })
  }),
).pipe(Layer.provide(runner))

// ── Sessions ──────────────────────────────────────────────────────
const sessions = SessionV2.layer.pipe(
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(Database.defaultLayer),
  Layer.provide(SessionStore.defaultLayer),
  Layer.provide(Project.defaultLayer),
  Layer.provide(sessionComposition),
  Layer.provide(execution),
)

// ── TestEffect layer (merge all) ──────────────────────────────────
const it = testEffect(
  Layer.mergeAll(
    Database.defaultLayer,
    EventV2.defaultLayer,
    SessionProjector.defaultLayer,
    SessionStore.defaultLayer,
    sessionComposition,
    client,
    permission,
    applications,
    agents,
    registry,
    models,
    systemContext,
    location,
    skillGuidance,
    referenceGuidance,
    config,
    runner,
    execution,
    sessions,
  ),
)

const sessionID = SessionV2.ID.make("ses_smoke_v2")

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  response = []
  requests.length = 0
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/smoke-test"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: sessionID,
      directory: "/smoke-test",
      title: "smoke-test",
      version: "test",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

// ── Tests ─────────────────────────────────────────────────────────

describe("smoke-v2 — V2 Layer chain end-to-end (R3)", () => {
  afterEach(() => {
    response = []
    requests.length = 0
  })

  it.effect("resolves SessionRunner.Service through the Layer chain", () =>
    Effect.gen(function* () {
      yield* SessionRunner.Service
      yield* SessionV2.Service
      // Service tags are resolvable — Layer chain is sound.
    }),
  )

  it.effect("SessionV2.prompt admits and wakes the execution", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const admitted = yield* session.prompt({
        sessionID,
        prompt: { text: "Hello smoke test" },
        resume: false,
      })
      expect(admitted).toBeDefined()
    }),
  )
})
