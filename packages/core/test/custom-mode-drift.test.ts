import { describe, expect } from "bun:test"
import { LLMClient, LLMEvent, Model, type LLMRequest } from "@aigcfroge/llm"
import { route } from "@aigcfroge/llm/protocols/openai-chat"
import { Cause, Effect, Exit, Layer, Option, Schema, Scope, Stream } from "effect"
import { eq } from "drizzle-orm"
import { AgentV2 } from "@aigcfroge/core/agent"
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
import { EventTable } from "@aigcfroge/core/event/sql"
import { AgentAttachment, FileAttachment } from "@aigcfroge/core/session/prompt"
import { SessionCompositionSnapshotTable, SessionTable } from "@aigcfroge/core/session/sql"
import { SkillV2 } from "@aigcfroge/core/skill"
import { SkillGuidance } from "@aigcfroge/core/skill/guidance"
import { ReferenceGuidance } from "@aigcfroge/core/reference/guidance"
import { SystemContext } from "@aigcfroge/core/system-context"
import { SystemContextRegistry } from "@aigcfroge/core/system-context/registry"
import { Tool } from "@aigcfroge/core/tool/tool"
import { ToolOutputStore } from "@aigcfroge/core/tool-output-store"
import { ToolRegistry } from "@aigcfroge/core/tool/registry"
import { McpRegistration } from "@aigcfroge/core/tool/mcp-registration"
import { McpConnection } from "@aigcfroge/core/mcp/connection"
import { testEffect } from "./lib/effect"
import { withCustomModeEnabled } from "./lib/product-mode"

withCustomModeEnabled()

const requests: LLMRequest[] = []
let response: LLMEvent[] = []
let materializeCalls = 0
let currentSkills: SkillV2.Info[] = []
let currentMcpFacts: ReadonlyArray<McpConnection.Fact> = []

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
// Counts runner-side materialize calls so fail-closed tests can assert no tool
// definitions were ever built (or exactly one verification pass happened).
const mcpRegistration = McpRegistration.layer.pipe(
  Layer.provide(registry),
  Layer.provide(applications),
  Layer.provide(outputStore),
)
const countedRegistry = Layer.effect(
  ToolRegistry.Service,
  Effect.gen(function* () {
    const inner = yield* ToolRegistry.Service
    return ToolRegistry.Service.of({
      register: (tools) => inner.register(tools),
      registerSession: (sessionID, tools) => inner.registerSession(sessionID, tools),
      registeredNames: (sessionID) => inner.registeredNames(sessionID),
      materialize: (permissions, intent, options) =>
        Effect.sync(() => {
          materializeCalls++
        }).pipe(Effect.andThen(inner.materialize(permissions, intent, options))),
    })
  }),
).pipe(Layer.provide(registry))
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
const skillV2 = Layer.mock(SkillV2.Service, { list: () => Effect.succeed(currentSkills) })
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
const mcpConnection = Layer.mock(McpConnection.Service, {
  connect: () => Effect.die("unused"),
  disconnect: () => Effect.die("unused"),
  connections: () => Effect.succeed([]),
  facts: () => Effect.succeed(currentMcpFacts),
  health: () => Effect.succeed(undefined),
  callTool: () => Effect.die("unused"),
  shutdown: () => Effect.void,
})
const sessionComposition = SessionComposition.layer.pipe(Layer.provide(Database.defaultLayer))
// Everything the runner needs except the MCP connection owner. `session/runner/
// llm.ts` reads that one through `Effect.serviceOption`, so a host with no MCP
// wiring is a live configuration rather than a layer error — hence two graphs
// off one base instead of two hand-copied chains.
const runnerBase = runnerLayer.pipe(
  Layer.provide(sessionComposition),
  Layer.provide(appProcess),
  Layer.provide(skillV2),
  Layer.provide(Database.defaultLayer),
  Layer.provide(SessionStore.defaultLayer),
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(client),
  Layer.provide(countedRegistry),
  Layer.provide(models),
  Layer.provide(SystemContextRegistry.layer),
)
const runnerEnv = (base: typeof runnerBase) =>
  base.pipe(
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
const runner = runnerEnv(runnerBase.pipe(Layer.provide(mcpConnection)))
const runnerWithoutMcp = runnerEnv(runnerBase)
const sessions = SessionV2.layer.pipe(
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(Database.defaultLayer),
  Layer.provide(SessionStore.defaultLayer),
  Layer.provide(Project.defaultLayer),
  Layer.provide(sessionComposition),
  Layer.provide(SessionExecution.noopLayer),
)
// Same graph as `runner` minus the MCP connection owner. `session/runner/llm.ts`
// reads it through `Effect.serviceOption`, so a host with no MCP wiring is a
// live configuration rather than a layer error — that is the branch under test.
const baseLayers = Layer.mergeAll(
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
  mcpRegistration,
  echo,
  models,
  location,
  skillGuidance,
  referenceGuidance,
  skillV2,
  config,
  appProcess,
  sessions,
)
const it = testEffect(Layer.mergeAll(baseLayers, runner, mcpConnection))
const itWithoutMcp = testEffect(Layer.mergeAll(baseLayers, runnerWithoutMcp))

const mockDigest = Composition.Digest.make("a".repeat(64))
const mockRevision = Schema.decodeUnknownSync(Composition.Revision)(
  "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
)

const boundSkill: SkillV2.Info = {
  name: "bound-skill",
  description: "Bound skill",
  location: AbsolutePath.make("/project/skills/bound.md"),
  content: "BOUND SKILL CONTENT",
}
const outsideSkill: SkillV2.Info = {
  name: "outside-skill",
  description: "Outside skill",
  location: AbsolutePath.make("/project/skills/outside.md"),
  content: "OUTSIDE SKILL CONTENT",
}
const boundSkillInfo = new Composition.SkillInfo({
  name: "bound-skill",
  description: "Bound skill",
  relativePath: "skills/bound.md",
  revision: mockRevision,
})

const insertCustomSession = (id: SessionV2.ID) =>
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
        title: "drift test",
        version: "test",
        mode: "custom",
        agent: AgentV2.ID.make("meta"),
        time_created: Date.now(),
        time_updated: Date.now(),
      })
      .run()
      .pipe(Effect.orDie)
  })

// Recomputes the freeze-time tool info exactly as CompositionResolver.freeze did
// (full materialization, same fingerprint struct shape, same digest inputs), with
// optional tampering to simulate on-disk drift of the stored snapshot row.
const buildToolInfo = Effect.fnUntraced(function* (tamper?: "tool-digest" | "catalog-digest" | "extra-tool") {
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
    .map((fingerprint, index) =>
      tamper === "tool-digest" && index === 0
        ? { ...fingerprint, digest: Composition.Digest.make("f".repeat(64)) }
        : fingerprint,
    )
  const catalog = [
    ...fingerprints.map((fingerprint) => fingerprint.name),
    ...(tamper === "extra-tool" ? ["ghost"] : []),
  ]
  const catalogDigest =
    tamper === "catalog-digest"
      ? Composition.Digest.make("e".repeat(64))
      : CompositionDigest.computeDigest(fingerprints)
  return new Composition.SnapshotToolInfo({ fingerprints, catalogDigest, catalog })
})

const makeSnapshot = (
  sessionID: SessionV2.ID,
  tools: Composition.SnapshotToolInfo,
  skills: Composition.SkillInfo[] = [],
) =>
  new Composition.SnapshotV1({
    version: 1,
    digest: mockDigest,
    sessionID,
    createdAt: Date.now(),
    data: new Composition.SnapshotDataV1({
      agentID: "meta",
      instructions: [],
      prompts: [],
      skills,
      tools,
    }),
  })

const makeMcpSnapshot = (sessionID: SessionV2.ID, tools: Composition.SnapshotToolInfo) =>
  new Composition.SnapshotV2({
    version: 2,
    digest: mockDigest,
    sessionID,
    createdAt: Date.now(),
    data: new Composition.SnapshotDataV2({
      agents: [],
      // Real resolver output always emits the orchestrator entry (D5-A), even
      // when nothing is bound. An empty `{}` here trips the runner's
      // consumer-binding gate before the MCP drift check, masking the reasons
      // these tests assert. Keep the binding present-but-empty.
      bindings: {
        orchestrator: new Composition.SnapshotBindingData({
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
      mcp: new Composition.SnapshotMcpInfo({
        bindings: [
          new Composition.SnapshotMcpBinding({
            serverName: "snapshot-mcp",
            ref: new Composition.McpRef({ kind: "mcp", relativePath: "snapshot-mcp.md", revision: mockRevision }),
          }),
        ],
        tools: [
          new Composition.SnapshotMcpTool({
            canonicalName: "mcp_snapshot-mcp_echo",
            serverName: "snapshot-mcp",
            ref: new Composition.McpRef({ kind: "mcp", relativePath: "snapshot-mcp.md", revision: mockRevision }),
          }),
        ],
      }),
    }),
  })

const expectDrift = (exit: Exit.Exit<void, SessionRunner.RunError>, reason: string) => {
  expect(Exit.isFailure(exit)).toBe(true)
  const error = Exit.isFailure(exit) ? Option.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
  expect(error).toBeInstanceOf(SessionRunner.SnapshotDriftError)
  if (error instanceof SessionRunner.SnapshotDriftError) expect(error.reason).toBe(reason)
}

const textResponse = (id: string, text: string): LLMEvent[] => [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.textStart({ id }),
  LLMEvent.textDelta({ id, text }),
  LLMEvent.textEnd({ id }),
  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
  LLMEvent.finish({ reason: "stop" }),
]

const userTexts = (request: LLMRequest) =>
  request.messages.flatMap((message) =>
    message.role === "user"
      ? message.content.flatMap((content) => (content.type === "text" ? [content.text] : []))
      : [],
  )

const reset = () => {
  requests.length = 0
  response = []
  materializeCalls = 0
  currentSkills = []
  currentMcpFacts = []
}

describe("Custom Mode Runner Drift Fail-Closed (MEDIUM-3)", () => {
  it.effect("missing snapshot row fails the turn closed before any provider or tool work", () =>
    Effect.gen(function* () {
      reset()
      const sessionID = SessionV2.ID.make("ses_drift_missing")
      yield* insertCustomSession(sessionID)
      const sessionRunner = yield* SessionRunner.Service

      const exit = yield* sessionRunner.run({ sessionID, force: true }).pipe(Effect.exit)

      expectDrift(exit, "snapshot_missing")
      expect(requests).toHaveLength(0)
      expect(materializeCalls).toBe(0)
    }),
  )

  it.effect("fails before provider dispatch when MCP registration identity no longer matches the frozen binding", () =>
    Effect.gen(function* () {
      reset()
      const sessionID = SessionV2.ID.make("ses_drift_mcp_identity")
      yield* insertCustomSession(sessionID)
      const mcp = yield* McpRegistration.Service
      const scope = yield* Scope.make()
      yield* mcp
        .registerServer({
          serverName: "snapshot-mcp",
          tools: {
            echo: Tool.make({
              description: "Snapshot MCP echo",
              input: Schema.Struct({}),
              output: Schema.Struct({}),
              execute: () => Effect.succeed({}),
            }),
          },
        })
        .pipe(Effect.provideService(Scope.Scope, scope))
      currentMcpFacts = [
        new McpConnection.Fact({
          serverName: "snapshot-mcp",
          ref: { relativePath: "replacement.md", revision: mockRevision },
          health: "ready",
          tools: ["mcp_snapshot-mcp_echo"],
        }),
      ]
      const composition = yield* SessionComposition.Service
      yield* composition.attach(sessionID, makeMcpSnapshot(sessionID, yield* buildToolInfo()))
      const sessionRunner = yield* SessionRunner.Service

      const exit = yield* sessionRunner.run({ sessionID, force: true }).pipe(Effect.exit)

      expectDrift(exit, "mcp_binding_missing")
      expect(requests).toHaveLength(0)
      yield* Scope.close(scope, Exit.void)
    }),
  )

  it.effect("fails before provider dispatch when a frozen MCP binding becomes revoked", () =>
    Effect.gen(function* () {
      reset()
      const sessionID = SessionV2.ID.make("ses_drift_mcp_revoked")
      yield* insertCustomSession(sessionID)
      const mcp = yield* McpRegistration.Service
      const scope = yield* Scope.make()
      yield* mcp
        .registerServer({
          serverName: "snapshot-mcp",
          tools: {
            echo: Tool.make({
              description: "Snapshot MCP echo",
              input: Schema.Struct({}),
              output: Schema.Struct({}),
              execute: () => Effect.succeed({}),
            }),
          },
        })
        .pipe(Effect.provideService(Scope.Scope, scope))
      currentMcpFacts = [
        new McpConnection.Fact({
          serverName: "snapshot-mcp",
          ref: { relativePath: "snapshot-mcp.md", revision: mockRevision },
          health: "revoked",
          tools: ["mcp_snapshot-mcp_echo"],
        }),
      ]
      const composition = yield* SessionComposition.Service
      yield* composition.attach(sessionID, makeMcpSnapshot(sessionID, yield* buildToolInfo()))
      const sessionRunner = yield* SessionRunner.Service

      const exit = yield* sessionRunner.run({ sessionID, force: true }).pipe(Effect.exit)

      expectDrift(exit, "mcp_connection_not_ready")
      expect(requests).toHaveLength(0)
      yield* Scope.close(scope, Exit.void)
    }),
  )

  it.effect("fails before provider dispatch when the frozen MCP tool is absent from the live registration fact", () =>
    Effect.gen(function* () {
      reset()
      const sessionID = SessionV2.ID.make("ses_drift_mcp_registration")
      yield* insertCustomSession(sessionID)
      const mcp = yield* McpRegistration.Service
      const scope = yield* Scope.make()
      yield* mcp
        .registerServer({
          serverName: "snapshot-mcp",
          tools: {
            echo: Tool.make({
              description: "Snapshot MCP echo",
              input: Schema.Struct({}),
              output: Schema.Struct({}),
              execute: () => Effect.succeed({}),
            }),
          },
        })
        .pipe(Effect.provideService(Scope.Scope, scope))
      // Binding identity and health still match, so the binding loop passes; the
      // fact no longer carries the canonical tool name the snapshot froze.
      currentMcpFacts = [
        new McpConnection.Fact({
          serverName: "snapshot-mcp",
          ref: { relativePath: "snapshot-mcp.md", revision: mockRevision },
          health: "ready",
          tools: [],
        }),
      ]
      const composition = yield* SessionComposition.Service
      yield* composition.attach(sessionID, makeMcpSnapshot(sessionID, yield* buildToolInfo()))
      const sessionRunner = yield* SessionRunner.Service

      const exit = yield* sessionRunner.run({ sessionID, force: true }).pipe(Effect.exit)

      expectDrift(exit, "mcp_registration_mismatch")
      expect(requests).toHaveLength(0)
      yield* Scope.close(scope, Exit.void)
    }),
  )

  itWithoutMcp.effect("fails before provider dispatch when no MCP connection owner is wired at all", () =>
    Effect.gen(function* () {
      reset()
      const sessionID = SessionV2.ID.make("ses_drift_mcp_unwired")
      yield* insertCustomSession(sessionID)
      const mcp = yield* McpRegistration.Service
      const scope = yield* Scope.make()
      yield* mcp
        .registerServer({
          serverName: "snapshot-mcp",
          tools: {
            echo: Tool.make({
              description: "Snapshot MCP echo",
              input: Schema.Struct({}),
              output: Schema.Struct({}),
              execute: () => Effect.succeed({}),
            }),
          },
        })
        .pipe(Effect.provideService(Scope.Scope, scope))
      const composition = yield* SessionComposition.Service
      yield* composition.attach(sessionID, makeMcpSnapshot(sessionID, yield* buildToolInfo()))
      const sessionRunner = yield* SessionRunner.Service

      const exit = yield* sessionRunner.run({ sessionID, force: true }).pipe(Effect.exit)

      expectDrift(exit, "mcp_connection_unavailable")
      expect(requests).toHaveLength(0)
      yield* Scope.close(scope, Exit.void)
    }),
  )

  it.effect("rejects a snapshot MCP catalog entry that lacks registration audit identity", () =>
    Effect.gen(function* () {
      reset()
      const sessionID = SessionV2.ID.make("ses_drift_mcp_audit")
      yield* insertCustomSession(sessionID)
      const mcp = yield* McpRegistration.Service
      const scope = yield* Scope.make()
      yield* mcp
        .registerServer({
          serverName: "audit-mcp",
          tools: {
            echo: Tool.make({
              description: "Audit MCP echo",
              input: Schema.Struct({}),
              output: Schema.Struct({}),
              execute: () => Effect.succeed({}),
            }),
          },
        })
        .pipe(Effect.provideService(Scope.Scope, scope))
      const tools = yield* buildToolInfo()
      const composition = yield* SessionComposition.Service
      yield* composition.attach(
        sessionID,
        new Composition.SnapshotV2({
          version: 2,
          digest: mockDigest,
          sessionID,
          createdAt: Date.now(),
          data: new Composition.SnapshotDataV2({
            agents: [],
            // Real resolver output always emits the orchestrator entry (D5-A).
            bindings: {
              orchestrator: new Composition.SnapshotBindingData({
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
            mcp: new Composition.SnapshotMcpInfo({ bindings: [], tools: [] }),
          }),
        }),
      )
      const sessionRunner = yield* SessionRunner.Service

      const exit = yield* sessionRunner.run({ sessionID, force: true }).pipe(Effect.exit)

      expectDrift(exit, "mcp_audit_catalog_mismatch")
      expect(requests).toHaveLength(0)
      yield* Scope.close(scope, Exit.void)
    }),
  )

  it.effect("a reconnected MCP definition fails the next provider turn through the existing fingerprint guard", () =>
    Effect.gen(function* () {
      reset()
      const sessionID = SessionV2.ID.make("ses_drift_mcp_reconnect")
      yield* insertCustomSession(sessionID)
      const mcp = yield* McpRegistration.Service
      const firstScope = yield* Scope.make()
      const makeRemoteEcho = (description: string) =>
        Tool.make({
          description,
          input: Schema.Struct({ text: Schema.String }),
          output: Schema.Struct({ text: Schema.String }),
          toModelOutput: ({ output }) => [{ type: "text", text: output.text }],
          execute: ({ text }) => Effect.succeed({ text }),
        })
      yield* mcp
        .registerServer({ serverName: "reconnect", tools: { echo: makeRemoteEcho("First remote echo") } })
        .pipe(Scope.provide(firstScope))
      const tools = yield* buildToolInfo()
      yield* Scope.close(firstScope, Exit.void)
      const secondScope = yield* Scope.make()
      yield* mcp
        .registerServer({ serverName: "reconnect", tools: { echo: makeRemoteEcho("Changed remote echo") } })
        .pipe(Scope.provide(secondScope))
      const composition = yield* SessionComposition.Service
      yield* composition.attach(sessionID, makeSnapshot(sessionID, tools))
      const sessionRunner = yield* SessionRunner.Service

      const exit = yield* sessionRunner.run({ sessionID, force: true }).pipe(Effect.exit)

      expectDrift(exit, "tool_fingerprint_mismatch")
      expect(requests).toHaveLength(0)
      yield* Scope.close(secondScope, Exit.void)
    }),
  )

  it.effect("tampered tool fingerprint fails the turn closed", () =>
    Effect.gen(function* () {
      reset()
      response = textResponse("text-drift-tool", "Done")
      const sessionID = SessionV2.ID.make("ses_drift_tool")
      yield* insertCustomSession(sessionID)
      const tools = yield* buildToolInfo("tool-digest")
      const composition = yield* SessionComposition.Service
      yield* composition.attach(sessionID, makeSnapshot(sessionID, tools))
      const sessionRunner = yield* SessionRunner.Service

      const exit = yield* sessionRunner.run({ sessionID, force: true }).pipe(Effect.exit)

      expectDrift(exit, "tool_fingerprint_mismatch")
      expect(requests).toHaveLength(0)
      expect(materializeCalls).toBe(1)
    }),
  )

  it.effect("tampered catalog digest fails the turn closed", () =>
    Effect.gen(function* () {
      reset()
      response = textResponse("text-drift-catalog", "Done")
      const sessionID = SessionV2.ID.make("ses_drift_catalog")
      yield* insertCustomSession(sessionID)
      const tools = yield* buildToolInfo("catalog-digest")
      const composition = yield* SessionComposition.Service
      yield* composition.attach(sessionID, makeSnapshot(sessionID, tools))
      const sessionRunner = yield* SessionRunner.Service

      const exit = yield* sessionRunner.run({ sessionID, force: true }).pipe(Effect.exit)

      expectDrift(exit, "catalog_digest_mismatch")
      expect(requests).toHaveLength(0)
      expect(materializeCalls).toBe(1)
    }),
  )

  it.effect("catalog tool missing from the live registry fails the turn closed", () =>
    Effect.gen(function* () {
      reset()
      response = textResponse("text-drift-extra", "Done")
      const sessionID = SessionV2.ID.make("ses_drift_extra")
      yield* insertCustomSession(sessionID)
      const tools = yield* buildToolInfo("extra-tool")
      const composition = yield* SessionComposition.Service
      yield* composition.attach(sessionID, makeSnapshot(sessionID, tools))
      const sessionRunner = yield* SessionRunner.Service

      const exit = yield* sessionRunner.run({ sessionID, force: true }).pipe(Effect.exit)

      expectDrift(exit, "tool_missing")
      expect(requests).toHaveLength(0)
      expect(materializeCalls).toBe(1)
    }),
  )

  it.effect("matching snapshot proceeds with the allowlisted tool set", () =>
    Effect.gen(function* () {
      reset()
      response = textResponse("text-ok", "Done")
      const sessionID = SessionV2.ID.make("ses_drift_ok")
      yield* insertCustomSession(sessionID)
      const tools = yield* buildToolInfo()
      const composition = yield* SessionComposition.Service
      yield* composition.attach(sessionID, makeSnapshot(sessionID, tools))
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Hello there" }), resume: false })
      const sessionRunner = yield* SessionRunner.Service

      yield* sessionRunner.run({ sessionID, force: true })

      expect(requests).toHaveLength(1)
      expect(requests[0]?.tools.map((tool) => tool.name)).toEqual(["echo"])
      // One verification materialization plus the request materialization.
      expect(materializeCalls).toBe(2)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Hello there" },
        { type: "assistant", content: [{ type: "text", text: "Done" }] },
      ])
    }),
  )
})

describe("Custom Mode Skill Steer Snapshot-Local (MEDIUM-2b)", () => {
  it.effect("publishes not-found text for an out-of-snapshot skill steer and never its content", () =>
    Effect.gen(function* () {
      reset()
      response = textResponse("text-steer-out", "Done")
      currentSkills = [boundSkill, outsideSkill]
      const sessionID = SessionV2.ID.make("ses_drift_steer_out")
      yield* insertCustomSession(sessionID)
      const tools = yield* buildToolInfo()
      const composition = yield* SessionComposition.Service
      yield* composition.attach(sessionID, makeSnapshot(sessionID, tools, [boundSkillInfo]))
      const session = yield* SessionV2.Service
      yield* session.skill({ sessionID, skill: "outside-skill", resume: false })
      const sessionRunner = yield* SessionRunner.Service

      yield* sessionRunner.run({ sessionID, force: true })

      expect(requests).toHaveLength(1)
      const texts = requests.flatMap(userTexts)
      expect(texts).toContain("Skill not found: outside-skill")
      expect(texts.join("\n")).not.toContain("OUTSIDE SKILL CONTENT")
    }),
  )

  it.effect("injects snapshot-bound skill content for an in-snapshot skill steer", () =>
    Effect.gen(function* () {
      reset()
      response = textResponse("text-steer-bound", "Done")
      currentSkills = [boundSkill, outsideSkill]
      const sessionID = SessionV2.ID.make("ses_drift_steer_bound")
      yield* insertCustomSession(sessionID)
      const tools = yield* buildToolInfo()
      const composition = yield* SessionComposition.Service
      yield* composition.attach(sessionID, makeSnapshot(sessionID, tools, [boundSkillInfo]))
      const session = yield* SessionV2.Service
      yield* session.skill({ sessionID, skill: "bound-skill", resume: false })
      const sessionRunner = yield* SessionRunner.Service

      yield* sessionRunner.run({ sessionID, force: true })

      expect(requests).toHaveLength(1)
      const texts = requests.flatMap(userTexts)
      expect(texts).toContain("BOUND SKILL CONTENT")
      expect(texts.join("\n")).not.toContain("OUTSIDE SKILL CONTENT")
    }),
  )
})

describe("Custom Mode Command Steer Snapshot-Local (S5)", () => {
  const reviewCommand = new Composition.CommandInfo({
    name: "review",
    description: "Review the change",
    relativePath: "commands/review.md",
    revision: mockRevision,
    invocation: "/review $1",
    args: "$1: path",
  })

  const makeCommandSnapshot = Effect.fnUntraced(function* (
    sessionID: SessionV2.ID,
    tools: Composition.SnapshotToolInfo,
    commands: Composition.CommandInfo[],
  ) {
    return new Composition.SnapshotV2({
      version: 2,
      digest: mockDigest,
      sessionID,
      createdAt: Date.now(),
      data: new Composition.SnapshotDataV2({
        agents: [
          new Composition.AgentInfo({
            id: "meta",
            name: "meta",
            description: "",
            relativePath: "meta.md",
            revision: mockRevision,
            consumerKey: "orchestrator",
          }),
        ],
        bindings: {
          orchestrator: new Composition.SnapshotBindingData({
            instructions: [],
            prompts: [],
            skills: [],
            commands,
          }),
        },
        instructions: [],
        prompts: [],
        skills: [],
        tools,
        mcp: new Composition.SnapshotMcpInfo({ bindings: [], tools: [] }),
      }),
    })
  })

  const attachCommands = (sessionID: SessionV2.ID, commands: Composition.CommandInfo[]) =>
    Effect.gen(function* () {
      yield* insertCustomSession(sessionID)
      // ADR-20 provenance: the frozen agent entry must match the live registry
      // origin, otherwise the runner fails the turn before any command steer.
      const agents = yield* AgentV2.Service
      yield* agents.transform((editor) =>
        editor.update(AgentV2.ID.make("meta"), (agent) => {
          agent.originRelativePath = "meta.md"
          agent.originRevision = mockRevision
        }),
      )
      const tools = yield* buildToolInfo()
      const composition = yield* SessionComposition.Service
      yield* composition.attach(sessionID, yield* makeCommandSnapshot(sessionID, tools, commands))
    })

  it.effect("promotes a bound command steer into a canonical user prompt expanded from the frozen catalog", () =>
    Effect.gen(function* () {
      reset()
      response = textResponse("text-cmd-ok", "Done")
      const sessionID = SessionV2.ID.make("ses_cmd_promote")
      yield* attachCommands(sessionID, [reviewCommand])
      const session = yield* SessionV2.Service
      yield* session.command({ sessionID, command: "review", arguments: "src/main.ts", resume: false })
      const sessionRunner = yield* SessionRunner.Service

      yield* sessionRunner.run({ sessionID, force: true })

      expect(requests).toHaveLength(1)
      const texts = requests.flatMap(userTexts)
      expect(texts).toContain("/review src/main.ts")
      // No agent/model override can enter the runtime from a command admission.
      const { db } = yield* Database.Service
      const events = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .all()
        .pipe(Effect.orDie)
      expect(
        events.some(
          (event) => event.type === "session.next.agent.switched" || event.type === "session.next.model.switched",
        ),
      ).toBe(false)
    }),
  )

  it.effect("carries the canonical context files and agents into the promoted user message", () =>
    Effect.gen(function* () {
      reset()
      response = textResponse("text-cmd-ctx", "Done")
      const sessionID = SessionV2.ID.make("ses_cmd_context")
      yield* attachCommands(sessionID, [reviewCommand])
      const session = yield* SessionV2.Service
      yield* session.command({
        sessionID,
        command: "review",
        arguments: "src",
        context: Prompt.make({
          text: "",
          files: [FileAttachment.make({ uri: "file:///project/src/main.ts", mime: "text/plain" })],
          agents: [AgentAttachment.make({ name: "coder" })],
        }),
        resume: false,
      })
      const sessionRunner = yield* SessionRunner.Service

      yield* sessionRunner.run({ sessionID, force: true })

      const context = yield* session.context(sessionID)
      const user = context.findLast((message) => message.type === "user")
      expect(user?.type === "user" && user.text).toBe("/review src")
      if (user?.type !== "user") return
      expect(user.files?.map((file) => file.uri)).toContain("file:///project/src/main.ts")
      expect(user.agents?.map((agent) => agent.name)).toContain("coder")
    }),
  )

  it.effect("a command steer whose frozen entry was replaced fails closed with not-found text", () =>
    Effect.gen(function* () {
      reset()
      response = textResponse("text-cmd-gone", "Done")
      const sessionID = SessionV2.ID.make("ses_cmd_replaced")
      yield* attachCommands(sessionID, [reviewCommand])
      const session = yield* SessionV2.Service
      yield* session.command({ sessionID, command: "review", arguments: "src", resume: false })
      // The frozen asset is replaced after admission: the current snapshot now
      // carries a different revision of the same command name.
      const replacedRevision = Schema.decodeUnknownSync(Composition.Revision)(
        "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      )
      const replaced = new Composition.CommandInfo({
        name: "review",
        description: "Review the change",
        relativePath: "commands/review.md",
        revision: replacedRevision,
        invocation: "/review2 $1",
        args: "$1: path",
      })
      const next = yield* makeCommandSnapshot(sessionID, yield* buildToolInfo(), [replaced])
      const { db } = yield* Database.Service
      yield* db
        .update(SessionCompositionSnapshotTable)
        .set({ data: next.data })
        .where(eq(SessionCompositionSnapshotTable.session_id, sessionID))
        .run()
        .pipe(Effect.orDie)
      const sessionRunner = yield* SessionRunner.Service

      yield* sessionRunner.run({ sessionID, force: true })

      expect(requests).toHaveLength(1)
      const texts = requests.flatMap(userTexts)
      expect(texts).toContain("Command not found: review")
      expect(texts.join("\n")).not.toContain("/review2")
      expect(texts.join("\n")).not.toContain("Review the change")
    }),
  )

  it.effect("delivers a shell-fenced command body as text and never executes it", () =>
    Effect.gen(function* () {
      reset()
      response = textResponse("text-cmd-fence", "Done")
      const sessionID = SessionV2.ID.make("ses_cmd_fence")
      const fenced = new Composition.CommandInfo({
        name: "run",
        description: "Run",
        relativePath: "commands/run.md",
        revision: mockRevision,
        invocation: "Explain this bash:\n```bash\necho $1\n```",
      })
      yield* attachCommands(sessionID, [fenced])
      const session = yield* SessionV2.Service
      yield* session.command({ sessionID, command: "run", arguments: "hi", resume: false })
      const sessionRunner = yield* SessionRunner.Service

      yield* sessionRunner.run({ sessionID, force: true })

      expect(requests).toHaveLength(1)
      const texts = requests.flatMap(userTexts)
      expect(texts.join("\n")).toContain("```bash")
      expect(texts.join("\n")).toContain("echo hi")
      const { db } = yield* Database.Service
      const events = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .all()
        .pipe(Effect.orDie)
      expect(events.some((event) => event.type.startsWith("session.next.shell"))).toBe(false)
    }),
  )

  it.effect("a command steer for a missing consumer binding fails the turn closed", () =>
    Effect.gen(function* () {
      reset()
      response = textResponse("text-cmd-unbound", "Done")
      const sessionID = SessionV2.ID.make("ses_cmd_unbound")
      yield* attachCommands(sessionID, [reviewCommand])
      const session = yield* SessionV2.Service
      yield* session.command({ sessionID, command: "review", arguments: "src", resume: false })
      // The session's agent is rewritten to an agent absent from the frozen
      // pool after admission, so promotion cannot map the consumer.
      const { db } = yield* Database.Service
      yield* db
        .update(SessionTable)
        .set({ agent: AgentV2.ID.make("impostor") })
        .where(eq(SessionTable.id, sessionID))
        .run()
        .pipe(Effect.orDie)
      const sessionRunner = yield* SessionRunner.Service

      const exit = yield* sessionRunner.run({ sessionID, force: true }).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(requests).toHaveLength(0)
    }),
  )
})
