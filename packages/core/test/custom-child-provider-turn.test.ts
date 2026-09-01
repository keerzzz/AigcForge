import { describe, expect } from "bun:test"
import { LLMClient, LLMEvent, Model, type LLMRequest } from "@aigcfroge/llm"
import { route } from "@aigcfroge/llm/protocols/openai-chat"
import { Cause, Effect, Exit, Layer, Schema, Stream } from "effect"
import { AgentV2 } from "@aigcfroge/core/agent"
import { ProductModeAgentPolicy } from "@aigcfroge/core/product-mode-agent-policy"
import { AppProcess } from "@aigcfroge/core/process"
import { ApplicationTools } from "@aigcfroge/core/tool/application-tools"
import { Composition } from "@aigcfroge/schema/composition"
import { CompositionDigest } from "@aigcfroge/core/composition/digest"
import { Config } from "@aigcfroge/core/config"
import { ConfigCompaction } from "@aigcfroge/core/config/compaction"
import { ConfigMeta } from "../src/config/meta"
import { Database } from "@aigcfroge/core/database/database"
import { DoomLoop } from "@aigcfroge/core/session/doom-loop"
import { CorrectionExtractor } from "@aigcfroge/core/session/correction-extractor"
import { CorrectionStore } from "@aigcfroge/core/session/correction-store"
import { ReferenceChecker } from "@aigcfroge/core/session/reference-checker"
import { Verifier } from "@aigcfroge/core/session/verifier"
import { EventV2 } from "@aigcfroge/core/event"
import { EventTable } from "@aigcfroge/core/event/sql"
import { InstallationVersion } from "@aigcfroge/core/installation/version"
import { Location } from "@aigcfroge/core/location"
import { PermissionV2 } from "@aigcfroge/core/permission"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { Prompt } from "@aigcfroge/core/session/prompt"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionRunner } from "@aigcfroge/core/session/runner"
import { layer as runnerLayer } from "@aigcfroge/core/session/runner/llm"
import { SessionRunnerModel } from "@aigcfroge/core/session/runner/model"
import { SessionStore } from "@aigcfroge/core/session/store"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { SkillV2 } from "@aigcfroge/core/skill"
import { SkillGuidance } from "@aigcfroge/core/skill/guidance"
import { ReferenceGuidance } from "@aigcfroge/core/reference/guidance"
import { SystemContext } from "@aigcfroge/core/system-context"
import { SystemContextRegistry } from "@aigcfroge/core/system-context/registry"
import { Tool } from "@aigcfroge/core/tool/tool"
import { ToolOutputStore } from "@aigcfroge/core/tool-output-store"
import { ToolRegistry } from "@aigcfroge/core/tool/registry"
import { testEffect } from "./lib/effect"
import { withCustomModeEnabled } from "./lib/product-mode"
import { eq } from "drizzle-orm"

// Phase A probe for the unregistered contradiction between per-turn
// `ProductModeAgentPolicy.enforcePrimary` (custom allows only `meta`) and
// child creation (`resolveAgent` returns a non-meta snapshot agent). It drives
// one real provider turn in a non-meta custom child and reports whether the
// turn survives or dies as an AgentNotAllowedError defect.
withCustomModeEnabled()

const CHILD_AGENT = "custom-coder"

const requests: LLMRequest[] = []
let response: LLMEvent[] = []

const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: (request) => {
      requests.push(request)
      return Stream.fromIterable(response)
    },
    generate: () => Effect.die("unused"),
  }),
)
const model = Model.make({ id: "fake-model", provider: "fake", route })
const models = SessionRunnerModel.layerWith(() => Effect.succeed(model))
const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    effectiveRules: () => Effect.succeed([]),
    assert: () => Effect.die("unused"),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const applications = ApplicationTools.layer
const outputStore = Layer.mock(ToolOutputStore.Service, {
  bound: (input) => Effect.succeed({ output: input.output, outputPaths: [] }),
})
const registry = ToolRegistry.layer.pipe(Layer.provide(applications), Layer.provide(outputStore))
const echo = Layer.effectDiscard(
  ToolRegistry.Service.use((registry) =>
    registry.register({
      echo: Tool.make({
        description: "Echo text",
        input: Schema.Struct({ text: Schema.String }),
        output: Schema.Struct({ text: Schema.String }),
        toModelOutput: ({ output }) => [{ type: "text", text: output.text }],
        execute: ({ text }) => Effect.succeed({ text }),
      }),
    }),
  ),
).pipe(Layer.provide(registry))
const agents = AgentV2.layer
const location = Location.layer({ directory: AbsolutePath.make("/project") }).pipe(Layer.provide(Project.defaultLayer))
const skillGuidance = Layer.mock(SkillGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const referenceGuidance = Layer.mock(ReferenceGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const skillV2 = Layer.mock(SkillV2.Service, { list: () => Effect.succeed([]) })
const verifier = Layer.mock(Verifier.Service, { verify: () => Effect.succeed("") })
const referenceChecker = Layer.mock(ReferenceChecker.Service, { check: () => Effect.succeed("") })
const appProcess = Layer.mock(AppProcess.Service, { run: () => Effect.die("unused") })
const config = Layer.succeed(
  Config.Service,
  Config.Service.of({
    entries: () =>
      Effect.succeed([
        new Config.Document({
          type: "document",
          info: new Config.Info({
            compaction: new ConfigCompaction.Info({
              buffer: 3_000,
              keep: new ConfigCompaction.Keep({ tokens: 1_000 }),
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
const sessionComposition = SessionComposition.layer.pipe(Layer.provide(Database.defaultLayer))
const runner = runnerLayer
  .pipe(
    Layer.provide(sessionComposition),
    Layer.provide(appProcess),
    Layer.provide(skillV2),
    Layer.provide(Database.defaultLayer),
    Layer.provide(SessionStore.defaultLayer),
    Layer.provide(EventV2.defaultLayer),
    Layer.provide(client),
    Layer.provide(registry),
    Layer.provide(models),
    Layer.provide(SystemContextRegistry.layer),
  )
  .pipe(
    Layer.provide(location),
    Layer.provide(agents),
    Layer.provide(skillGuidance),
    Layer.provide(referenceGuidance),
    Layer.provide(DoomLoop.layer),
    Layer.provide(CorrectionExtractor.layer),
    Layer.provide(CorrectionStore.layer),
    Layer.provide(verifier),
    Layer.provide(referenceChecker),
    Layer.provide(permission),
    Layer.provide(config),
  )
const sessions = SessionV2.layer.pipe(
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(Database.defaultLayer),
  Layer.provide(SessionStore.defaultLayer),
  Layer.provide(Project.defaultLayer),
  Layer.provide(sessionComposition),
  Layer.provide(SessionExecution.noopLayer),
)

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
    echo,
    models,
    location,
    skillGuidance,
    referenceGuidance,
    skillV2,
    config,
    appProcess,
    runner,
    sessions,
  ),
)

const mockDigest = Composition.Digest.make("b".repeat(64))

const insertCustomRoot = (id: SessionV2.ID) =>
  Effect.gen(function* () {
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
        id,
        project_id: Project.ID.global,
        slug: id,
        directory: AbsolutePath.make("/project"),
        title: "probe root",
        version: "test",
        mode: "custom",
        agent: AgentV2.ID.make("meta"),
        time_created: Date.now(),
        time_updated: Date.now(),
      })
      .run()
      .pipe(Effect.orDie)
  })

// Freeze-time tool info recomputed exactly as CompositionResolver.freeze did so
// verifySnapshotTools passes when the turn is allowed to proceed that far.
const buildToolInfo = Effect.fnUntraced(function* () {
  const registry = yield* ToolRegistry.Service
  const materialized = yield* registry.materialize()
  const fingerprints = materialized.definitions
    .map((definition) => ({
      placement: "/project",
      name: definition.name,
      digest: CompositionDigest.computeDigest({
        description: definition.description,
        inputSchema: definition.inputSchema,
        outputSchema: definition.outputSchema,
      }),
      installationVersion: InstallationVersion,
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name))
  return new Composition.SnapshotToolInfo({
    fingerprints,
    catalogDigest: CompositionDigest.computeDigest(fingerprints),
    catalog: fingerprints.map((fingerprint) => fingerprint.name),
  })
})

const attachChildAgentSnapshot = (sessionID: SessionV2.ID) =>
  Effect.gen(function* () {
    const tools = yield* buildToolInfo()
    const composition = yield* SessionComposition.Service
    yield* composition.attach(
      sessionID,
      new Composition.SnapshotV1({
        version: 1,
        digest: mockDigest,
        sessionID,
        createdAt: Date.now(),
        data: new Composition.SnapshotDataV1({
          agentID: CHILD_AGENT,
          instructions: [],
          prompts: [],
          skills: [],
          tools,
        }),
      }),
    )
  })

const textResponse = (id: string, text: string): LLMEvent[] => [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.textStart({ id }),
  LLMEvent.textDelta({ id, text }),
  LLMEvent.textEnd({ id }),
  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
  LLMEvent.finish({ reason: "stop" }),
]

const reset = () => {
  requests.length = 0
  response = []
}

describe("Custom Mode non-meta child provider turn (Phase A probe)", () => {
  it.effect("pool agent without matching asset provenance fails the turn closed (ADR-20 §2.6)", () =>
    Effect.gen(function* () {
      reset()
      response = textResponse("text-prov", "Done")
      const { db } = yield* Database.Service
      const parentID = SessionV2.ID.make("ses_prov_root")
      yield* insertCustomRoot(parentID)
      // V2 snapshot binding custom-coder to an asset file/revision.
      const tools = yield* buildToolInfo()
      const composition = yield* SessionComposition.Service
      const revision = Schema.decodeUnknownSync(Composition.Revision)("e".repeat(64))
      yield* composition.attach(
        parentID,
        new Composition.SnapshotV2({
          version: 2,
          digest: mockDigest,
          sessionID: parentID,
          createdAt: Date.now(),
          data: new Composition.SnapshotDataV2({
            agents: [
              new Composition.AgentInfo({
                id: CHILD_AGENT,
                name: CHILD_AGENT,
                description: "bound",
                relativePath: "agents/coder.yaml",
                revision,
              }),
            ],
            // A real freeze emits an entry for every addressable consumer
            // (`composition-resolver.ts`), so a pool agent always has one. An
            // empty map here is a scoped graph with no entries, which the
            // consumer-binding gate fails closed on before provenance runs.
            bindings: {
              orchestrator: new Composition.SnapshotBindingData({
                instructions: [],
                prompts: [],
                skills: [],
                commands: [],
              }),
              [`agents/${CHILD_AGENT}`]: new Composition.SnapshotBindingData({
                instructions: [],
                prompts: [],
                skills: [],
                commands: [],
              }),
            },
            instructions: [],
            prompts: [],
            skills: [],
            tools,
          }),
        }),
      )
      const sessions = yield* SessionV2.Service
      const child = yield* sessions.create({
        id: SessionV2.ID.make("ses_prov_child"),
        parentID,
        agent: AgentV2.ID.make(CHILD_AGENT),
        location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
      })

      // The registry entry carries no origin → impostor, fail closed.
      yield* sessions.prompt({ sessionID: child.id, prompt: Prompt.make({ text: "hi" }), resume: false })
      const sessionRunner = yield* SessionRunner.Service
      const exit = yield* sessionRunner.run({ sessionID: child.id, force: true }).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause) instanceof SessionRunner.AgentProvenanceError).toBe(true)
      }
      expect(requests).toHaveLength(0)
    }),
  )

  it.effect("pool agent whose registry origin matches the bound asset completes the turn", () =>
    Effect.gen(function* () {
      reset()
      response = textResponse("text-prov-ok", "Done")
      const agents = yield* AgentV2.Service
      yield* agents.transform((editor) =>
        editor.update(AgentV2.ID.make(CHILD_AGENT), (agent) => {
          agent.originRelativePath = "agents/coder.yaml"
          agent.originRevision = Schema.decodeUnknownSync(Composition.Revision)("e".repeat(64))
        }),
      )
      const parentID = SessionV2.ID.make("ses_prov_ok_root")
      yield* insertCustomRoot(parentID)
      const tools = yield* buildToolInfo()
      const composition = yield* SessionComposition.Service
      const revision = Schema.decodeUnknownSync(Composition.Revision)("e".repeat(64))
      yield* composition.attach(
        parentID,
        new Composition.SnapshotV2({
          version: 2,
          digest: mockDigest,
          sessionID: parentID,
          createdAt: Date.now(),
          data: new Composition.SnapshotDataV2({
            agents: [
              new Composition.AgentInfo({
                id: CHILD_AGENT,
                name: CHILD_AGENT,
                description: "bound",
                relativePath: "agents/coder.yaml",
                revision,
              }),
            ],
            // A real freeze emits an entry for every addressable consumer
            // (`composition-resolver.ts`), so a pool agent always has one. An
            // empty map here is a scoped graph with no entries, which the
            // consumer-binding gate fails closed on before provenance runs.
            bindings: {
              orchestrator: new Composition.SnapshotBindingData({
                instructions: [],
                prompts: [],
                skills: [],
                commands: [],
              }),
              [`agents/${CHILD_AGENT}`]: new Composition.SnapshotBindingData({
                instructions: [],
                prompts: [],
                skills: [],
                commands: [],
              }),
            },
            instructions: [],
            prompts: [],
            skills: [],
            tools,
          }),
        }),
      )
      const sessions = yield* SessionV2.Service
      const child = yield* sessions.create({
        id: SessionV2.ID.make("ses_prov_ok_child"),
        parentID,
        agent: AgentV2.ID.make(CHILD_AGENT),
        location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
      })
      yield* sessions.prompt({ sessionID: child.id, prompt: Prompt.make({ text: "hi" }), resume: false })
      const sessionRunner = yield* SessionRunner.Service

      const exit = yield* sessionRunner.run({ sessionID: child.id, force: true }).pipe(Effect.exit)

      if (Exit.isFailure(exit)) throw Cause.squash(exit.cause)
      expect(requests).toHaveLength(1)
    }),
  )
  it.effect("child creation succeeds with the snapshot agent while the parent keeps meta", () =>
    Effect.gen(function* () {
      reset()
      const parentID = SessionV2.ID.make("ses_probe_child_root")
      yield* insertCustomRoot(parentID)
      yield* attachChildAgentSnapshot(parentID)
      const sessions = yield* SessionV2.Service

      const child = yield* sessions.create({
        id: SessionV2.ID.make("ses_probe_child_created"),
        parentID,
        agent: AgentV2.ID.make(CHILD_AGENT),
        location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
      })

      expect(child.mode).toBe("custom")
      expect(child.agent).toBe(AgentV2.ID.make(CHILD_AGENT))
      expect(child.parentID).toBe(parentID)
    }),
  )

  it.effect("non-meta custom child completes one real provider turn without dying", () =>
    Effect.gen(function* () {
      reset()
      response = textResponse("text-probe-child", "Done")
      const parentID = SessionV2.ID.make("ses_probe_turn_root")
      yield* insertCustomRoot(parentID)
      yield* attachChildAgentSnapshot(parentID)
      const sessions = yield* SessionV2.Service

      const child = yield* sessions.create({
        id: SessionV2.ID.make("ses_probe_turn_child"),
        parentID,
        agent: AgentV2.ID.make(CHILD_AGENT),
        location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
      })

      yield* sessions.prompt({ sessionID: child.id, prompt: Prompt.make({ text: "Hello child" }), resume: false })
      const sessionRunner = yield* SessionRunner.Service

      const exit = yield* sessionRunner.run({ sessionID: child.id, force: true }).pipe(Effect.exit)

      // Desired contract: a Snapshot-allowlisted non-meta custom child reaches
      // the provider like any delegated executor. Red on main before the fix:
      // the turn died at ProductModeAgentPolicy.enforcePrimary (root-only
      // invariant) before any provider work.
      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        throw Cause.squash(exit.cause)
      }
      expect(requests).toHaveLength(1)
    }),
  )

  it.effect("non-custom children stay subject to the per-turn primary gate (R6-3)", () =>
    Effect.gen(function* () {
      reset()
      response = textResponse("text-probe-gate", "Done")
      const { db } = yield* Database.Service
      const parentID = SessionV2.ID.make("ses_probe_gate_root")
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({
          id: parentID,
          project_id: Project.ID.global,
          slug: parentID,
          directory: AbsolutePath.make("/project"),
          title: "gate root",
          version: "test",
          mode: "chat",
          agent: AgentV2.ID.make("meta"),
          time_created: Date.now(),
          time_updated: Date.now(),
        })
        .run()
        .pipe(Effect.orDie)
      // work-orchestrator is invalid as a chat primary; a child row carrying it
      // must still die at the per-turn gate now that the exemption narrows to
      // custom mode.
      const childID = SessionV2.ID.make("ses_probe_gate_child")
      yield* db
        .insert(SessionTable)
        .values({
          id: childID,
          parent_id: parentID,
          project_id: Project.ID.global,
          slug: childID,
          directory: AbsolutePath.make("/project"),
          title: "gate child",
          version: "test",
          mode: "chat",
          agent: AgentV2.ID.make("work-orchestrator"),
          time_created: Date.now(),
          time_updated: Date.now(),
        })
        .run()
        .pipe(Effect.orDie)

      const sessionRunner = yield* SessionRunner.Service
      const exit = yield* sessionRunner.run({ sessionID: childID, force: true }).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause)
        expect(error instanceof ProductModeAgentPolicy.AgentNotAllowedError).toBe(true)
      }
      expect(requests).toHaveLength(0)
    }),
  )

  // P1-4 RED: switchAgent on a custom ROOT to an in-pool non-meta agent must
  // fail typed BEFORE any durable mutation. Before the fix the switch passed
  // (pool membership only), persisted AgentSwitched, and the next provider turn
  // bricked at the per-turn enforcePrimary gate.
  it.effect("custom root switch to an in-pool non-meta agent fails typed with zero durable side effects (P1-4)", () =>
    Effect.gen(function* () {
      reset()
      response = textResponse("text-root-switch", "Done")
      const { db } = yield* Database.Service
      const rootID = SessionV2.ID.make("ses_switch_brick_root")
      yield* insertCustomRoot(rootID)
      yield* attachChildAgentSnapshot(rootID)
      const sessions = yield* SessionV2.Service

      const exit = yield* sessions.switchAgent({ sessionID: rootID, agent: CHILD_AGENT }).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        // Typed failure, not a die: the switch must reject BEFORE any durable
        // mutation, so the error has to be catchable on the failure channel.
        const error = Cause.findErrorOption(exit.cause)
        expect(error._tag).toBe("Some")
        if (error._tag === "Some") {
          expect(error.value instanceof ProductModeAgentPolicy.AgentNotAllowedError).toBe(true)
        }
      }
      const switched = yield* db
        .select({ id: EventTable.id })
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, rootID))
        .run()
        .pipe(Effect.orDie)
      expect(switched).toHaveLength(0)
      const row = yield* db
        .select({ agent: SessionTable.agent })
        .from(SessionTable)
        .where(eq(SessionTable.id, rootID))
        .get()
        .pipe(Effect.orDie)
      expect(row?.agent).toBe(AgentV2.ID.make("meta"))
      expect(requests).toHaveLength(0)
    }),
  )
})
