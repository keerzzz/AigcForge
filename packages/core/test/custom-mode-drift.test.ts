import { describe, expect } from "bun:test"
import { LLMClient, LLMEvent, Model, type LLMRequest } from "@aigcfroge/llm"
import { route } from "@aigcfroge/llm/protocols/openai-chat"
import { Cause, Effect, Exit, Layer, Option, Schema, Stream } from "effect"
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

withCustomModeEnabled()

const requests: LLMRequest[] = []
let response: LLMEvent[] = []
let materializeCalls = 0
let currentSkills: SkillV2.Info[] = []

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
const sessionComposition = SessionComposition.layer.pipe(Layer.provide(Database.defaultLayer))
const runner = runnerLayer.pipe(
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
).pipe(
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
  const catalog = [...fingerprints.map((fingerprint) => fingerprint.name), ...(tamper === "extra-tool" ? ["ghost"] : [])]
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
    message.role === "user" ? message.content.flatMap((content) => (content.type === "text" ? [content.text] : [])) : [],
  )

const reset = () => {
  requests.length = 0
  response = []
  materializeCalls = 0
  currentSkills = []
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
