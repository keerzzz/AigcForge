import { describe, expect } from "bun:test"
import { asc, eq } from "drizzle-orm"
import { Cause, DateTime, Effect, Exit, Fiber, Layer, Schema, Stream } from "effect"
import { LLMClient, LLMError, LLMEvent, Model, type LLMRequest, type LLMClientShape } from "@aigcfroge/llm"
import * as OpenAIChat from "@aigcfroge/llm/protocols/openai-chat"
import { AppProcess } from "../src/process"
import { Config } from "../src/config"
import { ConfigMeta } from "../src/config/meta"
import { CorrectionStore } from "../src/session/correction-store"
import { Database } from "../src/database/database"
import { EventV2 } from "../src/event"
import { Location } from "../src/location"
import { PermissionV2 } from "../src/permission"
import { Project } from "../src/project"
import { SessionProjector } from "../src/session/projector"
import { SessionRunner } from "../src/session/runner"
import * as SessionRunnerLLM from "../src/session/runner/llm"
import { SessionRunnerModel } from "../src/session/runner/model"
import { SessionStore } from "../src/session/store"
import { SessionExecution } from "../src/session/execution"
import { SessionRunCoordinator } from "../src/session/run-coordinator"
import { Prompt } from "../src/session/prompt"
import { SessionV2 } from "../src/session"
import { SessionTable } from "../src/session/sql"
import { EventTable } from "../src/event/sql"
import { SessionEvent } from "../src/session/event"
import { ProjectTable } from "../src/project/sql"
import { SkillV2 } from "../src/skill"
import { SkillGuidance } from "../src/skill/guidance"
import { ReferenceGuidance } from "../src/reference/guidance"
import { SystemContext } from "../src/system-context"
import { SystemContextRegistry } from "../src/system-context/registry"
import { ToolRegistry } from "../src/tool/registry"
import { ApplicationTools } from "../src/tool/application-tools"
import { ToolOutputStore } from "../src/tool-output-store"
import { Tool } from "../src/tool/tool"
import { AgentV2 } from "../src/agent"
import { QuestionV2 } from "../src/question"
import { ReferenceChecker } from "../src/session/reference-checker"
import { Ripgrep } from "../src/ripgrep"
import { RipgrepBinary } from "../src/ripgrep/binary"
import { FSUtil } from "../src/fs-util"
import { DoomLoop } from "../src/session/doom-loop"
import { CorrectionExtractor } from "../src/session/correction-extractor"
import { Verifier } from "../src/session/verifier"
import { VerificationRouter } from "../src/session/verification-router"
import { AbsolutePath } from "../src/schema"
import { testEffect } from "./lib/effect"

const sessionID = SessionV2.ID.make("ses_runner_verifier")

const questions = QuestionV2.layer.pipe(Layer.provide(EventV2.defaultLayer))
const requests: LLMRequest[] = []
let responses: LLMEvent[][] | undefined
const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: ((request: LLMRequest) => {
      requests.push(request)
      return Stream.fromIterable(responses === undefined ? [] : (responses.shift() ?? []))
    }) as LLMClientShape["stream"],
    generate: () => Effect.die("unused"),
  }),
)
const model = Model.make({ id: "fake-model", provider: "fake", route: OpenAIChat.route })
const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: () => Effect.die("unused"),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const applications = ApplicationTools.layer
const registry = ToolRegistry.layer.pipe(
  Layer.provide(permission),
  Layer.provide(applications),
  Layer.provide(ToolOutputStore.defaultLayer),
)
const agents = AgentV2.layer
const fakeEdit = Layer.effectDiscard(
  ToolRegistry.Service.use((registry) =>
    registry.register({
      edit: Tool.make({
        description: "Edit a file",
        input: Schema.Struct({ path: Schema.String }),
        output: Schema.Struct({ ok: Schema.Boolean }),
        toModelOutput: ({ output }) => [{ type: "text", text: output.ok ? "edited" : "failed" }],
        execute: () => Effect.succeed({ ok: true }),
      }),
    }),
  ),
).pipe(Layer.provide(registry))
const models = SessionRunnerModel.layerWith(() => Effect.succeed(model))
const systemContext = Layer.effectDiscard(
  SystemContextRegistry.Service.pipe(Effect.flatMap((registry) => registry.register({ key: SystemContext.Key.make("test/context"), load: Effect.succeed(SystemContext.empty) }))),
).pipe(Layer.provideMerge(SystemContextRegistry.layer))
const location = Location.layer({ directory: AbsolutePath.make("/project") }).pipe(Layer.provide(Project.defaultLayer))
const skillGuidance = Layer.mock(SkillGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const referenceGuidance = Layer.mock(ReferenceGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const config = Layer.succeed(
  Config.Service,
  Config.Service.of({
    entries: () =>
      Effect.succeed([
        new Config.Document({
          type: "document",
          info: Config.Info.make({
            meta: ConfigMeta.Info.make({
              correction_store: ConfigMeta.CorrectionStore.make({ enabled: true }),
              verifier: ConfigMeta.Verifier.make({ enabled: true, max_consecutive_failures: 2 }),
              reference_check: ConfigMeta.ReferenceCheck.make({ enabled: false }),
            }),
          }),
        }),
      ]),
  }),
)
const skillV2 = Layer.mock(SkillV2.Service, {
  list: () => Effect.succeed([]),
})
const appProcess = Layer.mock(AppProcess.Service, {
  run: () =>
    Effect.succeed({
      command: "bun",
      exitCode: 1,
      stdout: Buffer.from("src/foo.ts(1,1): error TS2307: Cannot find module './x'\n"),
      stderr: Buffer.alloc(0),
      stdoutTruncated: false,
      stderrTruncated: false,
    }),
})
const runner = SessionRunnerLLM.defaultLayer.pipe(
  Layer.provide(appProcess),
  Layer.provide(skillV2),
  Layer.provide(Database.defaultLayer),
  Layer.provide(SessionStore.defaultLayer),
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(client),
  Layer.provide(registry),
  Layer.provide(models),
  Layer.provide(systemContext),
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
const sessions = SessionV2.layer.pipe(
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(Database.defaultLayer),
  Layer.provide(SessionStore.defaultLayer),
  Layer.provide(Project.defaultLayer),
  Layer.provide(execution),
)
const it = testEffect(
  Layer.mergeAll(
    Database.defaultLayer,
    EventV2.defaultLayer,
    questions,
    SessionProjector.defaultLayer,
    SessionStore.defaultLayer,
    client,
    permission,
    applications,
    agents,
    registry,
    fakeEdit,
    models,
    systemContext,
    location,
    skillGuidance,
    CorrectionStore.layer.pipe(Layer.provide(config)),
    config,
    runner,
    execution,
    sessions,
  ),
)

describe("SessionRunner verifier integration", () => {
  it.effect("publishes verify.failed and augments the tool result for a code modification", () =>
    Effect.gen(function* () {
      responses = [
        [
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.toolCall({ id: "call-edit", name: "edit", input: { path: "packages/core/src/foo.ts" } }),
          LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
          LLMEvent.finish({ reason: "tool-calls" }),
        ],
        [
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.textStart({ id: "text-final" }),
          LLMEvent.textDelta({ id: "text-final", text: "Done" }),
          LLMEvent.textEnd({ id: "text-final" }),
          LLMEvent.stepFinish({ index: 0, reason: "stop" }),
          LLMEvent.finish({ reason: "stop" }),
        ],
      ]
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: Project.ID.global,
          slug: sessionID,
          directory: "/project",
          title: "verifier integration",
          version: "test",
        })
        .run()
      const session = yield* SessionV2.Service
      yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "refactor packages/core/src/foo.ts" }),
        resume: true,
      })
      yield* session.resume(sessionID)

      const events = yield* db
        .select({ type: EventTable.type })
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .orderBy(asc(EventTable.seq))
        .all()
      const types = events.map((event) => event.type)
      expect(types).toContain(EventV2.versionedType(SessionEvent.Verify.Started.type, 1))
      expect(types).toContain(EventV2.versionedType(SessionEvent.Verify.Failed.type, 1))
      const store = yield* CorrectionStore.Service
      const facts = yield* store.facts(sessionID)
      expect(facts.length).toBeGreaterThan(0)
    }),
  )
})
