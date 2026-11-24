import { describe, expect } from "bun:test"
import { LanguageModel } from "@omnixa/ai"
import { OpenAIChat } from "@omnixa/ai/protocols"
import { Composition } from "@omnixa/schema/composition"
import { Provider } from "@omnixa/schema/provider"
import { Global } from "@omnixa/util/global"
import { LayerNode } from "@omnixa/util/effect/layer-node"
import { eq } from "drizzle-orm"
import { Context, Effect, Layer, Result, Schema, Scope } from "effect"
import { Agent } from "../src/agent"
import { App } from "../src/app"
import { CompositionDigest } from "../src/composition/digest"
import { CompositionCatalog } from "../src/skill/composition-catalog"
import { Database } from "../src/database/database"
import { Image } from "../src/image"
import { InstructionDiscovery } from "../src/instruction-discovery"
import { InstructionBuiltIns } from "../src/instructions/builtins"
import { Instructions } from "../src/instructions/index"
import { Location } from "../src/location"
import { McpConnection } from "../src/mcp/connection"
import { McpInstructions } from "../src/mcp/instructions"
import { MetaAgentService } from "../src/meta-agent/service"
import { Model } from "../src/model"
import { ModelResolver } from "../src/model-resolver"
import { Permission } from "../src/permission"
import { AgentPlugin } from "../src/plugin/agent"
import { Producer } from "../src/plugin/service"
import { Project } from "../src/project"
import { ProjectTable } from "../src/project/sql"
import { ReferenceInstructions } from "../src/reference/instructions"
import { AbsolutePath } from "../src/schema"
import { SessionComposition } from "../src/session/composition"
import { SessionContext } from "../src/session/context"
import { InstructionEntry } from "../src/session/instruction-entry"
import { InstructionState } from "../src/session/instruction-state"
import { SessionMessage } from "../src/session/message"
import { SessionModelRequest } from "../src/session/model-request"
import { SessionModelTransport } from "../src/session/model-transport"
import { SessionRunnerModel } from "../src/session/runner/model"
import { SessionSchema } from "../src/session/schema"
import { InstructionBlobTable, SessionCompositionSnapshotTable, SessionTable } from "../src/session/sql"
import { SessionStore } from "../src/session/store"
import { Skill } from "../src/skill"
import { Tool } from "../src/tool"
import { McpTool } from "../src/tool/mcp"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { readInitial } from "./lib/instructions"
import { withCustomMode, withCustomModeEnabled } from "./lib/product-mode"

withCustomModeEnabled()

const directory = AbsolutePath.make("/project")
const hostVersion = "test-host"
const revision = Composition.Revision.make("a".repeat(64))
const rootID = SessionSchema.ID.make("ses_custom_context_root")
const coderSessionID = SessionSchema.ID.make("ses_custom_context_coder")
const writerSessionID = SessionSchema.ID.make("ses_custom_context_writer")
const liveSessionID = SessionSchema.ID.make("ses_custom_context_live")
const coderID = Agent.ID.make("asset_coder")
const writerID = Agent.ID.make("asset_writer")
const frozenModel = Model.Info.make(Model.Info.default(Provider.ID.make("test"), Model.ID.make("frozen-model")))
const liveModel = Model.Info.make(Model.Info.default(Provider.ID.make("test"), Model.ID.make("live-model")))
const defaultModel = Model.Info.make(Model.Info.default(Provider.ID.make("test"), Model.ID.make("default-model")))
const frozenPermissions: Permission.Ruleset = [
  { action: "*", resource: "*", effect: "deny" },
  { action: "read", resource: "*", effect: "allow" },
  { action: "skill", resource: "*", effect: "allow" },
  { action: "write", resource: "*", effect: "deny" },
]
const frozenRoot = Agent.Info.make({
  ...Agent.Info.empty(Agent.ID.make("meta")),
  mode: "primary",
  system: "Frozen root system.",
  permissions: frozenPermissions,
})
const frozenCoder = Agent.Info.make({
  ...Agent.Info.empty(coderID),
  name: Agent.Name.make("coder"),
  system: "Frozen coder system.",
  model: Model.Ref.make({ providerID: frozenModel.providerID, id: frozenModel.id }),
  steps: 4,
  request: { settings: {}, headers: { "X-Agent": "frozen" }, body: { temperature: 0.2 } },
  permissions: frozenPermissions,
  originRelativePath: "coder.md",
  originRevision: revision,
})
const frozenWriter = Agent.Info.make({
  ...Agent.Info.empty(writerID),
  name: Agent.Name.make("writer"),
  system: "Frozen writer system.",
  permissions: frozenPermissions,
  originRelativePath: "writer.md",
  originRevision: revision,
})
const ownCoder = new Composition.Instruction({ source: `agent:${coderID}`, content: frozenCoder.system ?? "" })

const resolved = (info: Model.Info, variant?: Model.VariantID) =>
  SessionRunnerModel.resolved(LanguageModel.make({ id: info.id, provider: info.providerID, route: OpenAIChat.route }), {
    capabilities: info.capabilities,
    cost: info.cost,
    limit: info.limit,
    variant,
  })

const makeFixture = () => ({
  facts: new Array<McpConnection.Fact>(),
  available: [frozenModel, liveModel, defaultModel],
  mcpLoads: 0,
  mcpPermissions: new Array<Permission.Ruleset>(),
  flushes: 0,
  beforeFacts: Effect.void as Effect.Effect<void>,
})
class Fixture extends Context.Service<Fixture, ReturnType<typeof makeFixture>>()("test/SessionCustomContext") {}

// Ambient discovery, MCP facts, and model transport are substituted. Selection,
// permissions, registry capture, frozen skill guidance, and persistent owners are real.
const contextLayer = Layer.unwrap(
  Effect.map(Fixture, (fixture) =>
    LayerNode.compile(
      LayerNode.group([
        Database.node,
        SessionContext.node,
        Agent.node,
        Tool.node,
        Skill.node,
        Permission.node,
        SessionStore.node,
        SessionComposition.node,
        MetaAgentService.node,
        InstructionEntry.node,
        SessionRunnerModel.node,
      ]),
      {
        replacements: [
          Database.node.replace(
            Database.layer({ path: ":memory:" }).pipe(
              Layer.provide(
                Layer.succeed(Global.Service, Global.make({ data: "/data", config: "/config", tmp: "/tmp/omnixa" })),
              ),
            ),
          ),
          App.node.replace(App.layer({ version: hostVersion })),
          Location.node.replace(Layer.succeed(Location.Service, location({ directory }))),
          Image.node.replace(Layer.mock(Image.Service, {})),
          InstructionBuiltIns.node.replace(
            Layer.mock(InstructionBuiltIns.Service, { load: () => Effect.succeed(Instructions.empty) }),
          ),
          InstructionDiscovery.node.replace(
            Layer.mock(InstructionDiscovery.Service, {
              project: false,
              global: false,
              load: () => Effect.succeed(Instructions.empty),
            }),
          ),
          ReferenceInstructions.node.replace(
            Layer.mock(ReferenceInstructions.Service, { load: () => Effect.succeed(Instructions.empty) }),
          ),
          McpInstructions.node.replace(
            Layer.mock(McpInstructions.Service, {
              load: (permissions) =>
                Effect.sync(() => {
                  fixture.mcpLoads++
                  fixture.mcpPermissions.push(permissions)
                  return Instructions.empty
                }),
            }),
          ),
          McpConnection.node.replace(
            Layer.mock(McpConnection.Service, {
              facts: () => fixture.beforeFacts.pipe(Effect.andThen(Effect.sync(() => fixture.facts))),
            }),
          ),
          McpTool.node.replace(
            Layer.mock(McpTool.Service, {
              flush: Effect.sync(() => {
                fixture.flushes++
              }),
            }),
          ),
          Model.node.replace(
            Layer.mock(Model.Service, {
              selection: () => Effect.undefined,
              available: () => Effect.sync(() => fixture.available),
              get: (providerID, id) =>
                Effect.sync(() => fixture.available.find((info) => info.providerID === providerID && info.id === id)),
              small: () => Effect.succeed(undefined),
            }),
          ),
          ModelResolver.node.replace(
            Layer.mock(ModelResolver.Service, {
              resolve: () => Effect.succeed(resolved(defaultModel)),
              resolveModel: (info, variant) => Effect.succeed(resolved(info, variant)),
            }),
          ),
          SessionModelTransport.node.replace(
            Layer.mock(SessionModelTransport.Service, {
              bind: () => {
                throw new Error("Custom context selection must not bind model transport")
              },
            }),
          ),
        ],
      },
    ),
  ),
).pipe(Layer.provideMerge(Layer.effect(Fixture, Effect.sync(makeFixture))))
const it = testEffect(contextLayer)

const setup = Effect.gen(function* () {
  const database = yield* Database.Service
  const agents = yield* Agent.Service
  const registry = yield* Tool.Service
  const skills = yield* Skill.Service
  const permissions = yield* Permission.Service
  const metas = yield* MetaAgentService.Service
  yield* database.db.insert(ProjectTable).values({ id: Project.ID.global, worktree: directory, sandboxes: [] }).run()
  yield* database.db
    .insert(SessionTable)
    .values(
      [
        { id: rootID, agent: "meta", mode: "custom" as const },
        { id: coderSessionID, parent_id: rootID, agent: coderID, mode: "custom" as const },
        { id: writerSessionID, parent_id: rootID, agent: writerID, mode: "custom" as const },
        { id: liveSessionID, agent: coderID, mode: "work" as const },
      ].map((session) => ({
        ...session,
        project_id: Project.ID.global,
        directory,
        slug: session.id,
        title: "custom context",
        version: hostVersion,
        attended: 1 as const,
      })),
    )
    .run()
  yield* Effect.forEach([rootID, liveSessionID], (sessionID) =>
    Effect.gen(function* () {
      const meta = yield* metas.create({
        title: "Context fixture owner",
        agent: "meta",
        model: { providerID: defaultModel.providerID, id: defaultModel.id },
      })
      yield* metas.attach({ metaID: meta.id, sessionID, role: "orchestrator" })
      yield* database.db
        .update(SessionTable)
        .set({ controller: { kind: "root", metaAgentID: meta.id, rootSessionID: sessionID } })
        .where(eq(SessionTable.id, sessionID))
        .run()
    }),
  )
  yield* agents.transform((editor) => {
    ;[frozenRoot, frozenCoder, frozenWriter].forEach((frozen) =>
      editor.update(frozen.id, (info) => {
        Object.assign(info, frozen, {
          originKind: "builtin",
          system: `Live ${frozen.id} system.`,
          model: Model.Ref.make({ providerID: liveModel.providerID, id: liveModel.id }),
          steps: 99,
          request: { settings: {}, headers: { "X-Agent": "live" }, body: { temperature: 0.9 } },
          permissions: [{ action: "*", resource: "*", effect: "allow" }],
        })
      }),
    )
  })
  yield* registry.transform((editor) => {
    ;["read", "write"].forEach((name) =>
      editor.add({
        name,
        description: `${name} text`,
        input: Schema.Struct({ text: Schema.String }),
        output: Schema.String,
        options: { codemode: false },
        execute: (input, context) =>
          permissions
            .assert({
              sessionID: context.sessionID,
              agent: context.agent,
              action: name,
              resources: [input.text],
              source: { type: "tool", messageID: context.messageID, id: context.id },
            })
            .pipe(
              Effect.as({ output: input.text, content: input.text }),
              Effect.mapError((error) => new Tool.Error({ message: error.message, error })),
            ),
      }),
    )
  })
  yield* skills.transform((editor) =>
    editor.add(
      Skill.Info.make({
        id: Skill.ID.make("live-only"),
        name: Skill.Name.make("Live only"),
        description: "Live-only skill guidance.",
        path: AbsolutePath.make("/skills/live-only.md"),
        content: "Live-only skill body.",
      }),
    ),
  )
  return (yield* registry.snapshot()).catalog
})

function snapshotData(catalog: Tool.Snapshot["catalog"], coderInstructions?: ReadonlyArray<Composition.Instruction>) {
  const skill = (name: string) =>
    new Composition.SnapshotSkillData({
      name,
      description: `Frozen ${name} guidance.`,
      relativePath: `${name}.md`,
      revision,
      content: `Frozen ${name} body.`,
    })
  const binding = (
    instructions: ReadonlyArray<Composition.Instruction>,
    skills: ReadonlyArray<Composition.SnapshotSkillData>,
  ) => new Composition.SnapshotBindingData({ instructions, skills, prompts: [], commands: [] })
  return new Composition.SnapshotDataV2({
    orchestrator: frozenRoot,
    agents: [frozenCoder, frozenWriter].map(
      (info) =>
        new Composition.AgentInfo({
          id: info.id,
          name: info.name,
          description: info.name,
          relativePath: `${info.name}.md`,
          revision,
          consumerKey: `agents/${info.name}`,
        }),
    ),
    executors: [frozenCoder, frozenWriter].map(
      (info) => new Composition.SnapshotExecutorData({ id: info.id, relativePath: `${info.name}.md`, revision, info }),
    ),
    bindings: {
      orchestrator: binding(
        [new Composition.Instruction({ source: "root.md", content: "Root-only instruction." })],
        [],
      ),
      "agents/coder": binding(
        coderInstructions ?? [
          ownCoder,
          new Composition.Instruction({ source: "coder.md", content: "Coder-only instruction." }),
          new Composition.Instruction({ source: "prompt:copy", content: frozenCoder.system ?? "" }),
        ],
        [skill("coder-skill")],
      ),
      "agents/writer": binding(
        [new Composition.Instruction({ source: "writer.md", content: "Writer-only instruction." })],
        [skill("writer-skill")],
      ),
    },
    instructions: [new Composition.Instruction({ source: "flat.md", content: "Flat cross-consumer instruction." })],
    skills: [skill("flat-skill")],
    prompts: [],
    tools: CompositionDigest.captureTools(catalog, directory, hostVersion),
    mcp: new Composition.SnapshotMcpInfo({ bindings: [], tools: [] }),
  })
}

const attach = Effect.fnUntraced(function* (data: Composition.SnapshotDataV2) {
  const compositions = yield* SessionComposition.Service
  yield* compositions.attach(
    rootID,
    new Composition.SnapshotV2({
      version: 2,
      sessionID: rootID,
      digest: CompositionDigest.computeDigest("custom-context-plan"),
      createdAt: 1_790_000_000_000,
      data,
    }),
  )
  yield* compositions.copy(rootID, coderSessionID)
  yield* compositions.copy(rootID, writerSessionID)
})

const initialize = Effect.fnUntraced(function* (
  selection: SessionContext.Selection,
  historical?: Readonly<Record<string, Schema.Json>>,
) {
  const database = yield* Database.Service
  const admission = yield* Instructions.read(selection.instructions).pipe(Effect.flatMap(Instructions.diff))
  const blobs =
    historical === undefined
      ? Object.entries(admission.blobs)
      : Object.values(historical).map((value) => [Instructions.hash(value), value] as const)
  if (blobs.length > 0)
    yield* database.db
      .insert(InstructionBlobTable)
      .values(blobs.map(([hash, value]) => ({ hash: Instructions.Hash.make(hash), value })))
      .onConflictDoNothing()
      .run()
  yield* InstructionState.initialize(
    database.db,
    selection.session.id,
    0,
    historical === undefined
      ? Instructions.applyHashDelta({}, admission.delta)
      : Object.fromEntries(Object.entries(historical).map(([key, value]) => [key, Instructions.hash(value)])),
  )
})

const executeRead = (selection: SessionContext.Selection, text: string, codemode = false) =>
  selection.tools.execute({
    sessionID: selection.session.id,
    agent: selection.agent.id,
    messageID: SessionMessage.ID.make("msg_context_permission"),
    call: {
      type: "tool-call",
      id: "call_context_permission",
      name: codemode ? "execute" : "read",
      input: codemode ? { code: `return await tools.read(${JSON.stringify({ text })});` } : { text },
    },
  })

const setupMetaDirectory = Effect.fnUntraced(function* (actions: ReadonlyArray<string> = ["subagent"]) {
  yield* setup
  const database = yield* Database.Service
  const agents = yield* Agent.Service
  const registry = yield* Tool.Service
  yield* database.db
    .update(SessionTable)
    .set({ mode: "coding", agent: "meta", attended: 0 })
    .where(eq(SessionTable.id, liveSessionID))
    .run()
  yield* agents.transform((editor) => {
    editor.update(Agent.ID.make("meta"), (agent) => {
      agent.system = AgentPlugin.metaSystem
      agent.permissions = [
        { action: "*", resource: "*", effect: "deny" },
        ...actions.map((action) => ({ action, resource: coderID, effect: "ask" as const })),
      ]
    })
    editor.update(coderID, (agent) => {
      agent.mode = "subagent"
      agent.hidden = false
      agent.description = "Directory target"
    })
  })
  yield* registry.transform((editor) =>
    actions.forEach((name) =>
      editor.add({
        name,
        description: "Directory capability",
        input: Schema.Struct({}),
        output: Schema.String,
        options: { codemode: false },
        execute: () => Effect.die(new Error("Directory fixture must not execute")),
      }),
    ),
  )
})

describe("SessionContext effective Meta directory", () => {
  it.effect("keeps asset definition discovery on demand in ordinary Meta requests", () =>
    Effect.gen(function* () {
      yield* setupMetaDirectory(["list_assets", "skill"])
      const agents = yield* Agent.Service
      const context = yield* SessionContext.Service
      const registry = yield* Tool.Service
      yield* agents.transform((editor) =>
        editor.update(Agent.ID.make("meta"), (agent) => {
          agent.permissions = [
            { action: "*", resource: "*", effect: "deny" },
            { action: "list_assets", resource: "*", effect: "allow" },
            { action: "skill", resource: "live-only", effect: "allow" },
          ]
        }),
      )
      const selected = yield* context.select(liveSessionID)
      const transcript = SessionModelRequest.baseTranscript({
        agent: selected.agent.info,
        model: resolved(defaultModel),
        tools: selected.tools,
        initial: (yield* readInitial(selected.instructions)).text,
        messages: [],
      })
      const system = transcript.system.map((part) => part.text).join("\n")
      expect(system).toContain("Use list_assets to discover asset definitions when the task needs them.")
      expect(system).toContain('"id":"live-only"')
      expect(system).not.toContain("Definition source errors")
      expect(system).not.toContain("Live-only skill body.")
      expect((yield* agents.get(Agent.ID.make("meta")))?.system).toBe(AgentPlugin.metaSystem)
      yield* registry.transform((editor) => editor.remove("list_assets"))
      const unavailable = yield* context.select(liveSessionID)
      expect(unavailable.agent.info.system).not.toContain("Use list_assets")
      expect(unavailable.agent.info.system).toContain('"id":"live-only"')
    }),
  )
  it.effect("aligns Work Meta full and propose views with effective permissions", () =>
    Effect.gen(function* () {
      yield* setupMetaDirectory(["memory_record", "memory_search", "skill"])
      const database = yield* Database.Service
      const agents = yield* Agent.Service
      const context = yield* SessionContext.Service
      const permission = yield* Permission.Service
      const fixture = yield* Fixture
      yield* agents.transform((editor) =>
        editor.update(Agent.ID.make("meta"), (agent) => {
          agent.permissions = [{ action: "*", resource: "*", effect: "deny" }]
        }),
      )
      yield* database.db
        .update(SessionTable)
        .set({ mode: "work", permission_tier: "full", attended: 1 })
        .where(eq(SessionTable.id, liveSessionID))
        .run()
      const rules = yield* permission.effectiveRules(liveSessionID, Agent.ID.make("meta"))
      expect(Permission.evaluate("memory_record", "*", rules).effect).toBe("ask")
      expect(Permission.evaluate("memory_search", "*", rules).effect).toBe("ask")
      const full = yield* context.select(liveSessionID)
      expect(full.tools.catalog.some((tool) => tool.name === "memory_record")).toBe(true)
      expect(full.tools.catalog.some((tool) => tool.name === "memory_search")).toBe(true)
      expect(full.agent.info.system).toContain('"id":"live-only"')
      expect((yield* readInitial(full.instructions)).text).toContain("Live-only skill guidance.")
      expect(fixture.mcpPermissions.at(-1)).toEqual(rules)
      expect(yield* permission.list()).toEqual([])
      yield* database.db
        .update(SessionTable)
        .set({ permission_tier: "propose" })
        .where(eq(SessionTable.id, liveSessionID))
        .run()
      const propose = yield* context.select(liveSessionID)
      expect(propose.tools.catalog.some((tool) => tool.name === "memory_record")).toBe(false)
      expect(propose.tools.catalog.some((tool) => tool.name === "memory_search")).toBe(false)
      expect(propose.agent.info.system).not.toContain('"id":"live-only"')
      expect((yield* readInitial(propose.instructions)).text).not.toContain("Live-only skill guidance.")
      expect(yield* permission.list()).toEqual([])
    }),
  )
  it.effect("publishes registered Skill IDs through the same live Meta selection as guidance", () =>
    Effect.gen(function* () {
      yield* setupMetaDirectory(["skill"])
      const agents = yield* Agent.Service
      const context = yield* SessionContext.Service
      const registry = yield* Tool.Service
      yield* agents.transform((editor) =>
        editor.update(Agent.ID.make("meta"), (agent) => {
          agent.permissions = [
            { action: "*", resource: "*", effect: "deny" },
            { action: "skill", resource: "live-only", effect: "allow" },
          ]
        }),
      )
      const selected = yield* context.select(liveSessionID)
      expect(selected.agent.info.system).toContain("Registered skills")
      expect(selected.agent.info.system).toContain('"id":"live-only"')
      expect(selected.agent.info.system).not.toContain("Live-only skill body.")
      expect((yield* readInitial(selected.instructions)).text).toContain("Live-only skill guidance.")
      yield* registry.transform((editor) => editor.remove("skill"))
      const withoutCallable = yield* context.select(liveSessionID)
      expect(withoutCallable.agent.info.system).not.toContain('"id":"live-only"')
      expect((yield* readInitial(withoutCallable.instructions)).text).toContain("Live-only skill guidance.")
      yield* agents.transform((editor) =>
        editor.update(Agent.ID.make("meta"), (agent) => {
          agent.permissions = [{ action: "*", resource: "*", effect: "deny" }]
        }),
      )
      const denied = yield* context.select(liveSessionID)
      expect(denied.agent.info.system).not.toContain('"id":"live-only"')
      expect((yield* readInitial(denied.instructions)).text).not.toContain("Live-only skill guidance.")
    }),
  )
  it.effect("omits an unattended ask target from selection and the actual base transcript", () =>
    Effect.gen(function* () {
      yield* setupMetaDirectory()
      const permissions = yield* Permission.Service
      const context = yield* SessionContext.Service
      const selected = yield* context.select(liveSessionID)
      expect(selected.tools.catalog.some((tool) => tool.name === "subagent")).toBe(true)
      expect(
        Permission.evaluate("subagent", coderID, yield* permissions.effectiveRules(liveSessionID, selected.agent.id))
          .effect,
      ).toBe("deny")
      expect(selected.agent.info.system).not.toContain(`- **${coderID}**: Directory target`)
      yield* initialize(selected)
      const loaded = yield* context.load(selected)
      const transcript = SessionModelRequest.baseTranscript({ ...loaded, agent: loaded.agent.info })
      expect(transcript.system.map((part) => part.text).join("\n")).not.toContain(`- **${coderID}**: Directory target`)
      expect(yield* permissions.list()).toEqual([])
    }),
  )
  ;[["task"], ["subagent"], []].forEach((actions) => {
    it.effect(`renders only targets backed by the captured ${actions.join("/") || "empty"} catalog`, () =>
      Effect.gen(function* () {
        yield* setupMetaDirectory(actions)
        const agents = yield* Agent.Service
        const context = yield* SessionContext.Service
        yield* agents.transform((editor) =>
          editor.update(Agent.ID.make("meta"), (agent) => {
            agent.permissions = [{ action: "*", resource: "*", effect: "allow" }]
          }),
        )
        const selected = yield* context.select(liveSessionID)
        expect(
          selected.tools.catalog
            .filter((tool) => tool.name === "task" || tool.name === "subagent")
            .map((tool) => tool.name),
        ).toEqual(actions)
        expect(selected.agent.info.system?.includes(`- **${coderID}**: Directory target`)).toBe(actions.length > 0)
        expect((yield* agents.get(Agent.ID.make("meta")))?.system).toBe(AgentPlugin.metaSystem)
      }),
    )
  })
  it.effect("keeps attended asks conditional and narrows the catalog with Session target denies", () =>
    Effect.gen(function* () {
      yield* setupMetaDirectory()
      const database = yield* Database.Service
      const permissions = yield* Permission.Service
      const context = yield* SessionContext.Service
      yield* database.db.update(SessionTable).set({ attended: 1 }).where(eq(SessionTable.id, liveSessionID)).run()
      const attended = yield* context.select(liveSessionID)
      expect(
        Permission.evaluate("subagent", coderID, yield* permissions.effectiveRules(liveSessionID, attended.agent.id))
          .effect,
      ).toBe("ask")
      expect(attended.agent.info.system).toContain(`- **${coderID}**: Directory target`)
      expect(yield* permissions.list()).toEqual([])
      yield* database.db
        .update(SessionTable)
        .set({ permission: [{ action: "subagent", resource: coderID, effect: "deny" }] })
        .where(eq(SessionTable.id, liveSessionID))
        .run()
      const denied = yield* context.select(liveSessionID)
      expect(denied.tools.catalog.some((tool) => tool.name === "subagent")).toBe(true)
      expect(denied.agent.info.system).not.toContain(`- **${coderID}**: Directory target`)
      expect(
        yield* permissions
          .assert({ sessionID: liveSessionID, agent: denied.agent.id, action: "subagent", resources: [coderID] })
          .pipe(Effect.flip),
      ).toBeInstanceOf(Permission.BlockedError)
      expect(yield* permissions.list()).toEqual([])
    }),
  )
  it.effect("tracks live inventory changes while excluding primary and hidden targets", () =>
    Effect.gen(function* () {
      yield* setupMetaDirectory()
      const agents = yield* Agent.Service
      const context = yield* SessionContext.Service
      yield* agents.transform((editor) => {
        editor.update(Agent.ID.make("meta"), (agent) => {
          agent.permissions = [{ action: "*", resource: "*", effect: "allow" }]
        })
        editor.update(coderID, (agent) => {
          agent.mode = "primary"
        })
        editor.update(writerID, (agent) => {
          agent.hidden = true
        })
      })
      const excluded = yield* context.select(liveSessionID)
      expect(excluded.agent.info.system).not.toContain(`- **${coderID}**:`)
      expect(excluded.agent.info.system).not.toContain(`- **${writerID}**:`)
      expect((yield* agents.list()).map((agent) => agent.id)).toContain(coderID)
      yield* agents.transform((editor) => {
        editor.update(coderID, (agent) => {
          agent.mode = "subagent"
        })
      })
      expect((yield* context.select(liveSessionID)).agent.info.system).toContain(`- **${coderID}**: Directory target`)
      yield* agents.transform((editor) => editor.remove(coderID))
      expect((yield* context.select(liveSessionID)).agent.info.system).not.toContain(`- **${coderID}**:`)
    }),
  )
})

describe("SessionContext ordinary Coding permissions", () => {
  ;["true", "false"]
    .flatMap((custom) => [false, true].map((codemode) => ({ custom, codemode })))
    .forEach((scenario) => {
      it.effect(
        `keeps ${scenario.codemode ? "CodeMode" : "direct"} discovery and execution aligned with Session overrides when Custom is ${scenario.custom}`,
        () =>
          withCustomMode(
            scenario.custom,
            Effect.gen(function* () {
              yield* setup
              const agents = yield* Agent.Service
              const database = yield* Database.Service
              const registry = yield* Tool.Service
              const context = yield* SessionContext.Service
              const store = yield* SessionStore.Service
              const permissions = yield* Permission.Service
              const fixture = yield* Fixture
              const agentRules: Permission.Ruleset = [
                { action: "*", resource: "*", effect: "allow" },
                { action: "read", resource: "*", effect: "deny" },
                { action: "skill", resource: "*", effect: "deny" },
              ]
              yield* agents.transform((editor) =>
                editor.update(coderID, (agent) => {
                  agent.permissions = [...agentRules]
                }),
              )
              yield* registry.transform((editor) =>
                editor.update("read", (tool) => {
                  tool.options = { codemode: scenario.codemode }
                }),
              )
              const sessionRules: Permission.Ruleset = [
                { action: "read", resource: "*", effect: "allow" },
                { action: "skill", resource: "*", effect: "allow" },
              ]
              yield* database.db
                .update(SessionTable)
                .set({ mode: "coding", permission: sessionRules })
                .where(eq(SessionTable.id, liveSessionID))
                .run()

              expect(yield* store.get(liveSessionID)).toMatchObject({ mode: "coding", permissions: sessionRules })
              const liveAgent = yield* agents.select(coderID)
              expect(liveAgent.id).toBe(coderID)
              expect(liveAgent.info?.permissions).toEqual(agentRules)
              expect((yield* registry.list()).find((tool) => tool.id === "read")).toMatchObject({
                name: "read",
                options: { codemode: scenario.codemode },
              })
              const selected = yield* context.select(liveSessionID)
              expect(selected.session.mode).toBe("coding")
              expect(selected.session.permissions).toEqual(sessionRules)
              expect(selected.session.attended).toBe(true)
              expect(selected.agent.id).toBe(coderID)
              expect(selected.agent.info.permissions).toEqual(agentRules)
              expect(selected.tools.catalog.find((tool) => tool.name === "read")).toMatchObject({
                placement: scenario.codemode ? "codemode" : "direct",
              })
              expect(selected.tools.definitions.map((tool) => tool.name)).toContain(
                scenario.codemode ? "execute" : "read",
              )
              expect(selected.tools.definitions.some((tool) => tool.name === "read")).toBe(!scenario.codemode)
              expect(
                selected.tools.codeModeCatalog?.tools.some((tool) => tool.type === "tool" && tool.name === "read") ??
                  false,
              ).toBe(scenario.codemode)
              expect((yield* readInitial(selected.instructions)).text).toContain("Live-only skill guidance.")
              expect(fixture.mcpPermissions.at(-1)).toEqual(
                Permission.merge(selected.agent.info.permissions, selected.session.permissions ?? []),
              )
              yield* permissions.assert({ sessionID: liveSessionID, action: "read", resources: ["src/index.ts"] })
              yield* permissions.assert({ sessionID: liveSessionID, action: "skill", resources: ["live-only"] })
              const executed = yield* executeRead(selected, "src/index.ts", scenario.codemode)
              expect(executed.output).toEqual(
                scenario.codemode
                  ? {
                      output: "src/index.ts",
                      toolCalls: [{ tool: "read", status: "completed", input: { text: "src/index.ts" } }],
                      files: [],
                    }
                  : "src/index.ts",
              )
              expect(yield* permissions.list()).toEqual([])

              // A resource deny keeps the tool discoverable; its captured leaf still authorizes each call.
              const partialRules: Permission.Ruleset = [
                ...sessionRules,
                { action: "read", resource: "secret.txt", effect: "deny" },
              ]
              yield* database.db
                .update(SessionTable)
                .set({ permission: partialRules })
                .where(eq(SessionTable.id, liveSessionID))
                .run()
              const partial = yield* context.select(liveSessionID)
              expect(partial.session.permissions).toEqual(partialRules)
              expect(partial.tools.catalog.some((tool) => tool.name === "read")).toBe(true)
              yield* permissions.assert({ sessionID: liveSessionID, action: "read", resources: ["src/index.ts"] })
              expect(
                yield* permissions
                  .assert({ sessionID: liveSessionID, action: "read", resources: ["secret.txt"] })
                  .pipe(Effect.flip),
              ).toBeInstanceOf(Permission.BlockedError)
              if (scenario.codemode) {
                const denied = yield* executeRead(partial, "secret.txt", true)
                expect(denied.output).toMatchObject({ error: true, toolCalls: [{ tool: "read", status: "error" }] })
                expect(denied.content).toEqual([
                  { type: "text", text: expect.stringContaining("Permission denied: read") },
                ])
              }
              if (!scenario.codemode) {
                const denied = yield* executeRead(partial, "secret.txt").pipe(Effect.flip)
                expect(denied).toBeInstanceOf(Tool.Error)
                expect(denied.error).toBeInstanceOf(Permission.BlockedError)
              }

              const deniedRules: Permission.Ruleset = [
                ...sessionRules,
                { action: "read", resource: "*", effect: "deny" },
                { action: "skill", resource: "*", effect: "deny" },
              ]
              yield* database.db
                .update(SessionTable)
                .set({ permission: deniedRules })
                .where(eq(SessionTable.id, liveSessionID))
                .run()
              const denied = yield* context.select(liveSessionID)
              expect(denied.session.permissions).toEqual(deniedRules)
              expect(denied.tools.catalog.some((tool) => tool.name === "read")).toBe(false)
              expect(denied.tools.definitions.some((tool) => tool.name === "read")).toBe(false)
              expect(
                denied.tools.codeModeCatalog?.tools.some((tool) => tool.type === "tool" && tool.name === "read") ??
                  false,
              ).toBe(false)
              expect((yield* readInitial(denied.instructions)).text).not.toContain("Live-only skill guidance.")
              expect(
                yield* permissions
                  .assert({ sessionID: liveSessionID, action: "read", resources: ["src/index.ts"] })
                  .pipe(Effect.flip),
              ).toBeInstanceOf(Permission.BlockedError)
              expect(yield* permissions.list()).toEqual([])
            }),
          ),
      )
    })
})

describe("SessionContext custom snapshots", () => {
  it.effect("consumes the frozen builtin root configuration and current permissions with no user pool", () =>
    Effect.gen(function* () {
      const catalog = yield* setup
      const database = yield* Database.Service
      const agents = yield* Agent.Service
      const compositions = yield* SessionComposition.Service
      const context = yield* SessionContext.Service
      const permissions = yield* Permission.Service
      const info = Agent.Info.make({
        ...frozenRoot,
        id: Agent.ID.make("build"),
        name: Agent.Name.make("Build"),
        mode: "all",
        system: "Frozen builtin Build system.",
        model: Model.Ref.make({ providerID: frozenModel.providerID, id: frozenModel.id }),
        request: { settings: {}, headers: { "X-Builtin": "frozen" }, body: { temperature: 0.1 } },
      })
      yield* attach(
        new Composition.SnapshotDataV2({
          ...snapshotData(catalog),
          root: new Composition.BuiltinRoot({
            source: "builtin",
            id: "build",
            revision: Composition.Revision.make(CompositionDigest.computeDigest(Schema.encodeSync(Agent.Info)(info))),
          }),
          orchestrator: info,
          agents: [],
          executors: [],
          bindings: {
            orchestrator: new Composition.SnapshotBindingData({
              instructions: [
                new Composition.Instruction({ source: "prompt:root", content: "An explicit root binding." }),
              ],
              prompts: [],
              skills: [],
              commands: [],
            }),
          },
        }),
      )
      yield* database.db
        .update(SessionTable)
        .set({ agent: info.id, model: null })
        .where(eq(SessionTable.id, rootID))
        .run()
      yield* agents.transform((editor) =>
        editor.update(info.id, (value) => {
          Object.assign(value, info, {
            system: "Live replacement.",
            request: { settings: {}, headers: {}, body: { temperature: 0.9 } },
          })
        }),
      )
      const before = yield* compositions.get(rootID)
      const selected = yield* context.select(rootID)
      expect(selected.agent.info).toEqual(info)
      expect(selected.tools.definitions.map((tool) => tool.name)).toEqual(["read"])
      yield* initialize(selected)
      const loaded = yield* context.load(selected)
      const transcript = SessionModelRequest.baseTranscript({ ...loaded, agent: loaded.agent.info })
      expect(transcript.system.map((part) => part.text).join("\n")).toContain("Frozen builtin Build system.")
      expect(transcript.system.map((part) => part.text).join("\n")).toContain("An explicit root binding.")
      expect(transcript.system.map((part) => part.text).join("\n")).not.toContain("Live replacement.")
      expect(loaded.agent.info.request).toEqual(info.request)
      expect(loaded.model.ref.id).toBe(frozenModel.id)
      expect(
        yield* permissions.assert({ sessionID: rootID, action: "write", resources: ["file.txt"] }).pipe(Effect.flip),
      ).toBeInstanceOf(Permission.BlockedError)
      yield* database.db
        .update(SessionTable)
        .set({ permission: [{ action: "read", resource: "*", effect: "deny" }] })
        .where(eq(SessionTable.id, rootID))
        .run()
      expect((yield* context.select(rootID)).tools.definitions.map((tool) => tool.name)).not.toContain("read")
      expect(yield* compositions.get(rootID)).toEqual(before)
    }),
  )

  it.effect("narrows frozen Meta Skill assets without changing adopted names or source", () =>
    Effect.gen(function* () {
      yield* setup
      const database = yield* Database.Service
      const registry = yield* Tool.Service
      const context = yield* SessionContext.Service
      const compositions = yield* SessionComposition.Service
      const permission = yield* Permission.Service
      yield* registry.transform((editor) =>
        editor.add({
          name: "skill",
          description: "Load a frozen skill",
          input: Schema.Struct({}),
          output: Schema.String,
          options: { codemode: false },
          execute: () => Effect.die(new Error("Skill directory test must not execute")),
        }),
      )
      const data = snapshotData((yield* registry.snapshot()).catalog)
      const skill = new Composition.SnapshotSkillData({
        name: "Root craft",
        description: "Frozen root craft guidance.",
        relativePath: "root-craft.md",
        revision,
        content: "Frozen root craft body.",
      })
      const system = AgentPlugin.renderMetaSystem(
        AgentPlugin.metaSystem,
        [],
        [
          { kind: "prompt", name: "Authored empty prompt" },
          { kind: "command", name: "Authored command" },
          { kind: "skill", name: skill.name },
        ],
      )
      yield* attach(
        new Composition.SnapshotDataV2({
          ...data,
          orchestrator: Agent.Info.make({ ...frozenRoot, system }),
          bindings: {
            ...data.bindings,
            orchestrator: new Composition.SnapshotBindingData({
              instructions: [new Composition.Instruction({ source: "agent:meta", content: system })],
              prompts: [],
              skills: [skill],
              commands: [],
            }),
          },
        }),
      )
      const before = yield* compositions.get(rootID)
      const catalog = CompositionCatalog.frozenSkills(directory, [skill])
      if (Result.isFailure(catalog)) return yield* catalog.failure
      yield* database.db
        .update(SessionTable)
        .set({ permission: [{ action: "skill", resource: catalog.success[0].id, effect: "deny" }] })
        .where(eq(SessionTable.id, rootID))
        .run()
      const selected = yield* context.select(rootID)
      expect(selected.tools.catalog.some((tool) => tool.name === "skill")).toBe(true)
      expect((yield* readInitial(selected.instructions)).text).not.toContain(skill.description)
      expect(selected.agent.info.system).not.toContain("- **skills**: Root craft")
      expect(selected.agent.info.system).toContain("- **prompts**: Authored empty prompt")
      expect(selected.agent.info.system).toContain("- **commands**: Authored command")
      yield* initialize(selected)
      const loaded = yield* context.load(selected)
      const transcript = SessionModelRequest.baseTranscript({ ...loaded, agent: loaded.agent.info })
      expect(transcript.system.map((part) => part.text).join("\n")).not.toContain("- **skills**: Root craft")
      expect(loaded.initial).not.toContain(system)
      expect(yield* compositions.get(rootID)).toEqual(before)
      yield* database.db.update(SessionTable).set({ permission: [] }).where(eq(SessionTable.id, rootID)).run()
      expect((yield* context.select(rootID)).agent.info.system).toBe(system)
      yield* database.db
        .update(SessionTable)
        .set({ permission: [{ action: "skill", resource: "*", effect: "deny" }] })
        .where(eq(SessionTable.id, rootID))
        .run()
      const hidden = yield* context.select(rootID)
      expect(hidden.tools.catalog.some((tool) => tool.name === "skill")).toBe(false)
      expect(hidden.agent.info.system).not.toContain("- **skills**: Root craft")
      expect(yield* compositions.get(rootID)).toEqual(before)
      expect(yield* permission.list()).toEqual([])
    }),
  )
  it.effect(
    "narrows an adopted Meta directory without changing its frozen source or duplicating old system instructions",
    () =>
      Effect.gen(function* () {
        yield* setup
        const database = yield* Database.Service
        const registry = yield* Tool.Service
        const context = yield* SessionContext.Service
        const compositions = yield* SessionComposition.Service
        const permission = yield* Permission.Service
        yield* registry.transform((editor) =>
          editor.add({
            name: "task",
            description: "Frozen directory dispatch",
            input: Schema.Struct({}),
            output: Schema.String,
            options: { codemode: false },
            execute: () => Effect.die(new Error("Frozen directory test must not execute")),
          }),
        )
        const data = snapshotData((yield* registry.snapshot()).catalog)
        const system = AgentPlugin.renderMetaSystem(AgentPlugin.metaSystem, [frozenCoder, frozenWriter])
        yield* attach(
          new Composition.SnapshotDataV2({
            ...data,
            orchestrator: Agent.Info.make({
              ...frozenRoot,
              system,
              permissions: [
                { action: "*", resource: "*", effect: "deny" },
                { action: "task", resource: "*", effect: "allow" },
              ],
            }),
            bindings: {
              ...data.bindings,
              orchestrator: new Composition.SnapshotBindingData({
                instructions: [new Composition.Instruction({ source: "agent:meta", content: system })],
                prompts: [],
                skills: [],
                commands: [],
              }),
            },
          }),
        )
        const before = yield* compositions.get(rootID)
        yield* database.db
          .update(SessionTable)
          .set({ permission: [{ action: "task", resource: coderID, effect: "deny" }] })
          .where(eq(SessionTable.id, rootID))
          .run()
        expect(
          Permission.evaluate("task", coderID, yield* permission.effectiveRules(rootID, Agent.ID.make("meta"))).effect,
        ).toBe("deny")
        const selected = yield* context.select(rootID)
        expect(selected.tools.catalog.some((tool) => tool.name === "task")).toBe(true)
        expect(selected.agent.info.system).not.toContain(`- **${coderID}**:`)
        expect(selected.agent.info.system).toContain(`- **${writerID}**:`)
        yield* initialize(selected)
        const loaded = yield* context.load(selected)
        const transcript = SessionModelRequest.baseTranscript({ ...loaded, agent: loaded.agent.info })
        expect(transcript.system.map((part) => part.text).join("\n")).not.toContain(`- **${coderID}**:`)
        expect(transcript.system.map((part) => part.text).join("\n")).toContain(`- **${writerID}**:`)
        expect(yield* compositions.get(rootID)).toEqual(before)
        expect(loaded.initial).not.toContain(system)
        expect(yield* permission.list()).toEqual([])
        const agents = yield* Agent.Service
        yield* agents.transform((editor) => {
          editor.remove(writerID)
          editor.update(coderID, (agent) => {
            agent.description = "Changed live coder"
          })
        })
        expect((yield* context.select(rootID)).agent.info.system).toBe(selected.agent.info.system)
        yield* database.db.update(SessionTable).set({ permission: [] }).where(eq(SessionTable.id, rootID)).run()
        const restored = yield* context.select(rootID)
        expect(restored.agent.info.system).toBe(system)
        expect(restored.agent.info.system).not.toContain("Changed live coder")
        yield* database.db.update(SessionTable).set({ attended: 0 }).where(eq(SessionTable.id, rootID)).run()
        const unattended = yield* context.select(rootID)
        expect(unattended.agent.info.system).toContain("(no subagents registered)")
        expect(unattended.agent.info.system).not.toContain(`- **${writerID}**:`)
        expect(
          Permission.evaluate("task", writerID, yield* permission.effectiveRules(rootID, Agent.ID.make("meta"))).effect,
        ).toBe("deny")
        yield* database.db
          .update(SessionTable)
          .set({ attended: 1, permission: [{ action: "task", resource: "*", effect: "deny" }] })
          .where(eq(SessionTable.id, rootID))
          .run()
        const noDispatch = yield* context.select(rootID)
        expect(noDispatch.tools.catalog.some((tool) => tool.name === "task")).toBe(false)
        expect(noDispatch.agent.info.system).toContain("(no subagents registered)")
        expect(yield* compositions.get(rootID)).toEqual(before)
        expect(yield* permission.list()).toEqual([])
      }),
  )
  it.effect(
    "rejects a disabled Custom runtime before selection or model loading while ordinary Sessions remain available",
    () =>
      Effect.gen(function* () {
        yield* attach(snapshotData(yield* setup))
        const context = yield* SessionContext.Service
        const fixture = yield* Fixture
        const selected = yield* context.select(coderSessionID)
        const flushes = fixture.flushes
        yield* withCustomMode(
          "false",
          Effect.gen(function* () {
            expect(yield* context.select(coderSessionID).pipe(Effect.flip)).toMatchObject({
              _tag: "UnsupportedProductModeError",
            })
            expect(yield* context.load(selected).pipe(Effect.flip)).toMatchObject({
              _tag: "UnsupportedProductModeError",
            })
            expect(yield* context.resolveModel(selected.session).pipe(Effect.flip)).toMatchObject({
              _tag: "UnsupportedProductModeError",
            })
            expect(fixture.flushes).toBe(flushes)
            expect((yield* context.select(liveSessionID)).session.mode).toBe("work")
          }),
        )
      }),
  )
  it.effect("selects frozen Agent capabilities and consumer instructions despite a conflicting live Agent", () =>
    Effect.gen(function* () {
      const catalog = yield* setup
      yield* attach(snapshotData(catalog))
      const context = yield* SessionContext.Service
      const registry = yield* Tool.Service
      const permissions = yield* Permission.Service
      const entries = yield* InstructionEntry.Service
      const fixture = yield* Fixture
      yield* registry.transform((editor) =>
        editor.add({
          name: "live-only",
          description: "Added after the freeze",
          input: Schema.Struct({}),
          output: Schema.String,
          options: { codemode: false },
          execute: () => Effect.succeed({ output: "live" }),
        }),
      )
      yield* entries.put({
        sessionID: coderSessionID,
        key: InstructionEntry.Key.make("task"),
        value: "Coder API context.",
      })

      const selected = yield* context.select(coderSessionID)
      expect(selected.agent.info).toEqual(frozenCoder)
      expect(selected.tools.definitions.map((tool) => tool.name)).toEqual(["read"])
      const initial = yield* readInitial(selected.instructions)
      expect(initial.text).toContain("Coder-only instruction.")
      expect(initial.text).toContain("Frozen coder system.")
      expect(initial.text).toContain("Frozen coder-skill guidance.")
      expect(initial.text).toContain("Coder API context.")
      ;[
        "Writer-only instruction.",
        "Root-only instruction.",
        "Flat cross-consumer instruction.",
        "writer-skill",
        "flat-skill",
        "Live-only",
      ].forEach((text) => expect(initial.text).not.toContain(text))
      const rules = yield* permissions.effectiveRules(coderSessionID)
      expect(Permission.evaluate("read", "file.txt", rules).effect).toBe("allow")
      expect(Permission.evaluate("write", "file.txt", rules).effect).toBe("deny")
      yield* permissions.assert({ sessionID: coderSessionID, action: "read", resources: ["file.txt"] })
      expect(
        yield* permissions
          .assert({ sessionID: coderSessionID, action: "write", resources: ["file.txt"] })
          .pipe(Effect.flip),
      ).toBeInstanceOf(Permission.BlockedError)
      expect((yield* executeRead(selected, "file.txt")).output).toBe("file.txt")

      const root = yield* context.select(rootID)
      const rootInitial = yield* readInitial(root.instructions)
      expect(root.agent.info).toEqual(frozenRoot)
      expect(rootInitial.text).toContain("Root-only instruction.")
      expect(rootInitial.text).not.toContain("Coder-only instruction.")
      expect(rootInitial.text).not.toContain("Frozen coder-skill guidance.")
      const writer = yield* context.select(writerSessionID)
      const writerInitial = yield* readInitial(writer.instructions)
      expect(writer.agent.info).toEqual(frozenWriter)
      expect(writerInitial.text).toContain("Writer-only instruction.")
      expect(writerInitial.text).toContain("Frozen writer-skill guidance.")
      expect(writerInitial.text).not.toContain("Coder-only instruction.")
      expect(writerInitial.text).not.toContain("Coder API context.")
      expect(writerInitial.text).not.toContain("Root-only instruction.")
      expect(fixture.mcpLoads).toBe(0)

      const live = yield* context.select(liveSessionID)
      expect(live.agent.info.system).toBe(`Live ${coderID} system.`)
      expect(live.agent.info.steps).toBe(99)
      expect(live.tools.definitions.map((tool) => tool.name)).toContain("live-only")
      expect((yield* readInitial(live.instructions)).text).toContain("Live-only skill guidance.")
      expect(Permission.evaluate("write", "file.txt", yield* permissions.effectiveRules(liveSessionID)).effect).toBe(
        "allow",
      )
      expect(fixture.mcpLoads).toBe(1)

      yield* initialize(selected)
      const loaded = yield* context.load(selected)
      expect(loaded.model.ref).toEqual(Model.Ref.make({ providerID: frozenModel.providerID, id: frozenModel.id }))
      expect((yield* context.resolveModel(selected.session)).ref).toEqual(loaded.model.ref)
      expect(loaded.agent.info.request).toEqual(frozenCoder.request)
      expect(loaded.initial).toBe(initial.text)
    }),
  )

  it.effect("omits own-system-only values from new reads and historical initial, changed, and removed rendering", () =>
    Effect.gen(function* () {
      yield* attach(snapshotData(yield* setup, [ownCoder]))
      const context = yield* SessionContext.Service
      const selected = yield* context.select(coderSessionID)
      const source = selected.instructions.find((item) => item.key === "core/composition")
      if (!source) throw new Error("Missing composition instruction source")
      expect(yield* source.read).toBe(Instructions.removed)

      const encode = Schema.encodeSync(Schema.toCodecJson(Schema.Array(Composition.Instruction)))
      const own = encode([ownCoder])
      const visible = encode([
        new Composition.Instruction({ source: "prompt:explicit", content: frozenCoder.system ?? "" }),
      ])
      const previous = encode([
        new Composition.Instruction({ source: "prompt:old", content: "Old visible instruction." }),
      ])
      expect(source.initial(own)).toBeUndefined()
      expect(source.changed(previous, own)).toBeUndefined()
      expect(source.removed(own)).toBeUndefined()
      expect(source.initial(visible)).toBe(frozenCoder.system)
      expect(source.changed(own, visible)).toBe(frozenCoder.system)
      expect(source.removed(visible)).toBe("Composition instructions are no longer available.")
      expect(
        source.initial(
          encode([new Composition.Instruction({ source: `agent:${writerID}`, content: frozenCoder.system ?? "" })]),
        ),
      ).toBe(frozenCoder.system)
      expect(
        source.initial(
          encode([new Composition.Instruction({ source: `agent:${coderID}`, content: "Distinct instruction." })]),
        ),
      ).toBe("Distinct instruction.")

      yield* initialize(selected, { "core/composition": own })
      const loaded = yield* context.load(selected)
      expect(loaded.initial).toBe("")
      const transcript = SessionModelRequest.baseTranscript({
        ...loaded,
        agent: loaded.agent.info,
        initial: loaded.initial ?? "",
      })
      expect(transcript.system.map((part) => part.text)).toEqual([frozenCoder.system ?? ""])
    }),
  )

  it.effect(
    "rejects a missing snapshot and stored invalid snapshot while live Agent capabilities remain available",
    () =>
      Effect.gen(function* () {
        const catalog = yield* setup
        const context = yield* SessionContext.Service
        const permissions = yield* Permission.Service
        const database = yield* Database.Service
        expect(yield* context.select(coderSessionID).pipe(Effect.flip)).toMatchObject({
          _tag: "SessionComposition.SnapshotNotFoundError",
          sessionID: coderSessionID,
        })
        expect(yield* permissions.effectiveRules(coderSessionID).pipe(Effect.flip)).toBeInstanceOf(
          Permission.BlockedError,
        )
        expect(
          yield* permissions
            .assert({ sessionID: coderSessionID, action: "read", resources: ["file.txt"] })
            .pipe(Effect.flip),
        ).toBeInstanceOf(Permission.BlockedError)
        expect((yield* context.select(liveSessionID)).agent.info.steps).toBe(99)

        yield* attach(snapshotData(catalog))
        yield* database.db
          .update(SessionCompositionSnapshotTable)
          .set({ version: 99 })
          .where(eq(SessionCompositionSnapshotTable.session_id, coderSessionID))
          .run()
        expect(yield* context.select(coderSessionID).pipe(Effect.flip)).toMatchObject({
          _tag: "SessionComposition.SnapshotDecodeError",
          sessionID: coderSessionID,
          details: "Unsupported snapshot version: 99",
        })
        expect(yield* permissions.effectiveRules(coderSessionID).pipe(Effect.flip)).toBeInstanceOf(
          Permission.BlockedError,
        )
      }),
  )

  it.effect(
    "uses the frozen Agent model until the Session selects an override and fails when that frozen model disappears",
    () =>
      Effect.gen(function* () {
        yield* attach(snapshotData(yield* setup))
        const context = yield* SessionContext.Service
        const database = yield* Database.Service
        const fixture = yield* Fixture
        const initial = yield* context.select(coderSessionID)
        yield* initialize(initial)
        expect((yield* context.resolveModel(initial.session)).ref).toEqual(
          Model.Ref.make({ providerID: frozenModel.providerID, id: frozenModel.id }),
        )
        expect((yield* context.load(initial)).model.ref).toEqual(
          Model.Ref.make({ providerID: frozenModel.providerID, id: frozenModel.id }),
        )
        fixture.available = [liveModel, defaultModel]
        expect(yield* context.load(initial).pipe(Effect.flip)).toMatchObject({
          _tag: "SessionRunnerModel.ModelUnavailableError",
          providerID: frozenModel.providerID,
          modelID: frozenModel.id,
        })
        fixture.available = [frozenModel, liveModel, defaultModel]
        yield* database.db
          .update(SessionTable)
          .set({ model: { providerID: defaultModel.providerID, id: defaultModel.id } })
          .where(eq(SessionTable.id, coderSessionID))
          .run()
        const override = yield* context.select(coderSessionID)
        expect((yield* context.resolveModel(override.session)).ref.id).toBe(defaultModel.id)
        expect((yield* context.load(override)).model.ref.id).toBe(defaultModel.id)
        expect(override.agent.info.model).toEqual(frozenCoder.model)
        const live = yield* context.select(liveSessionID)
        expect((yield* context.resolveModel(live.session)).ref.id).toBe(defaultModel.id)
      }),
  )

  it.effect("rejects an old Custom snapshot when only the proven tool implementation changes", () =>
    Effect.gen(function* () {
      yield* setup
      const registry = yield* Tool.Service
      const registered = (yield* registry.list()).find((tool) => tool.id === "read")
      if (!registered) return yield* Effect.die(new Error("Expected registered read tool"))
      yield* registry.transform(
        (editor) => editor.add(registered),
        new Producer({ id: "local-read", revision: "a".repeat(64) }),
      )
      const original = yield* registry.snapshot()
      const data = snapshotData(original.catalog)
      yield* attach(data)
      const context = yield* SessionContext.Service
      yield* context.select(coderSessionID)
      yield* registry.transform(
        (editor) =>
          editor.update("read", (tool) => {
            const previous = tool.execute
            tool.execute = (input, invocation) =>
              previous(input, invocation).pipe(
                Effect.map((result) => ({ ...result, output: "new implementation", content: "new implementation" })),
              )
          }),
        new Producer({ id: "local-read", revision: "b".repeat(64) }),
      )
      expect((yield* registry.snapshot()).definitions).toEqual(original.definitions)
      expect(yield* context.select(coderSessionID).pipe(Effect.flip)).toMatchObject({
        _tag: "SessionComposition.DependencyMissingError",
        sessionID: coderSessionID,
        reason: "tool_runtime_definition_mismatch",
      })
      const compositions = yield* SessionComposition.Service
      expect((yield* compositions.get(coderSessionID)).data.tools).toEqual(data.tools)
    }),
  )

  const toolDrift = [
    {
      name: "host version",
      reason: "tool_runtime_host_mismatch",
      capture: (catalog: Tool.Snapshot["catalog"]) =>
        CompositionDigest.captureTools(catalog, directory, "previous-host"),
      mutate: (_registry: Tool.Interface) => Effect.void,
    },
    {
      name: "host placement",
      reason: "tool_runtime_host_mismatch",
      capture: (catalog: Tool.Snapshot["catalog"]) =>
        CompositionDigest.captureTools(catalog, "/other-project", hostVersion),
      mutate: (_registry: Tool.Interface) => Effect.void,
    },
    {
      name: "input schema",
      reason: "tool_runtime_definition_mismatch",
      capture: (catalog: Tool.Snapshot["catalog"]) => CompositionDigest.captureTools(catalog, directory, hostVersion),
      mutate: (registry: Tool.Interface) =>
        registry
          .transform((editor) =>
            editor.update("read", (tool) => {
              tool.input = Schema.Struct({ value: Schema.Finite })
            }),
          )
          .pipe(Effect.asVoid),
    },
    {
      name: "output schema",
      reason: "tool_runtime_definition_mismatch",
      capture: (catalog: Tool.Snapshot["catalog"]) => CompositionDigest.captureTools(catalog, directory, hostVersion),
      mutate: (registry: Tool.Interface) =>
        registry
          .transform((editor) =>
            editor.update("read", (tool) => {
              tool.output = Schema.Finite
            }),
          )
          .pipe(Effect.asVoid),
    },
    {
      name: "a removed registration",
      reason: "tool_runtime_catalog_mismatch",
      capture: (catalog: Tool.Snapshot["catalog"]) => CompositionDigest.captureTools(catalog, directory, hostVersion),
      mutate: (registry: Tool.Interface) => registry.transform((editor) => editor.remove("read")).pipe(Effect.asVoid),
    },
  ]
  toolDrift.forEach((scenario) => {
    it.effect(`rejects frozen tools after ${scenario.name} drift`, () =>
      Effect.gen(function* () {
        const catalog = yield* setup
        const context = yield* SessionContext.Service
        const registry = yield* Tool.Service
        const data = snapshotData(catalog)
        yield* attach(new Composition.SnapshotDataV2({ ...data, tools: scenario.capture(catalog) }))
        yield* scenario.mutate(registry)
        expect(yield* context.select(coderSessionID).pipe(Effect.flip)).toMatchObject({
          _tag: "SessionComposition.DependencyMissingError",
          sessionID: coderSessionID,
          reason: scenario.reason,
        })
      }),
    )
  })

  it.effect("rejects a registry change between the frozen preflight and permission filtering", () =>
    Effect.gen(function* () {
      const catalog = yield* setup
      yield* attach(snapshotData(catalog))
      const registry = yield* Tool.Service
      const fixture = yield* Fixture
      fixture.beforeFacts = registry
        .transform((editor) => editor.remove("read"))
        .pipe(Effect.asVoid, Effect.provideService(Scope.Scope, yield* Effect.scope))
      const context = yield* SessionContext.Service
      expect(yield* context.select(coderSessionID).pipe(Effect.flip)).toMatchObject({
        _tag: "SessionComposition.DependencyMissingError",
        reason: "tool_runtime_revision_mismatch",
      })
    }),
  )

  it.effect("rechecks MCP credentials and owned tool identities on every Custom selection", () =>
    Effect.gen(function* () {
      yield* setup
      const context = yield* SessionContext.Service
      const registry = yield* Tool.Service
      const fixture = yield* Fixture
      yield* registry.transform((editor) =>
        editor.add({
          name: "list_files",
          description: "List files through MCP",
          input: Schema.Struct({}),
          output: Schema.String,
          options: { namespace: "mcp_git", codemode: false, permission: "mcp_git" },
          execute: () => Effect.succeed({ output: "file.txt" }),
        }),
      )
      const data = snapshotData((yield* registry.snapshot()).catalog)
      const ref = new Composition.McpRef({ kind: "mcp", relativePath: "git.yaml", revision })
      const transportFingerprint = CompositionDigest.computeDigest({ transport: "stdio", command: ["git-mcp"] })
      yield* attach(
        new Composition.SnapshotDataV2({
          ...data,
          mcp: new Composition.SnapshotMcpInfo({
            bindings: [
              new Composition.SnapshotMcpBinding({
                serverName: "git",
                ref,
                credentialRef: "git-token",
                transportFingerprint,
              }),
            ],
            tools: [new Composition.SnapshotMcpTool({ serverName: "git", ref, canonicalName: "mcp_git_list_files" })],
          }),
        }),
      )
      const ready = new McpConnection.Fact({
        serverName: "git",
        ref: { relativePath: ref.relativePath, revision },
        transportFingerprint,
        credentialRef: "git-token",
        credentialStatus: "available",
        health: "ready",
        tools: ["mcp_git_list_files"],
      })
      fixture.facts = [ready]
      expect((yield* context.select(coderSessionID)).agent.info).toEqual(frozenCoder)
      fixture.facts = [new McpConnection.Fact({ ...ready, credentialStatus: "revoked", health: "revoked" })]
      expect(yield* context.select(coderSessionID).pipe(Effect.flip)).toMatchObject({
        _tag: "SessionComposition.DependencyMissingError",
        reason: "mcp_runtime_binding_unavailable",
      })
      fixture.facts = [new McpConnection.Fact({ ...ready, tools: ["mcp_git_different"] })]
      expect(yield* context.select(coderSessionID).pipe(Effect.flip)).toMatchObject({
        _tag: "SessionComposition.DependencyMissingError",
        reason: "mcp_runtime_tools_mismatch",
      })
      fixture.facts = [ready]
      expect((yield* context.select(coderSessionID)).agent.info).toEqual(frozenCoder)
      expect(fixture.mcpLoads).toBe(0)
      expect(fixture.flushes).toBe(4)
    }),
  )
})
