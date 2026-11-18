import { describe, expect } from "bun:test"
import { Composition } from "@aigcfroge/schema/composition"
import { Global } from "@aigcfroge/util/global"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { Effect, Layer, Result, Schema } from "effect"
import { Agent } from "../src/agent"
import { App } from "../src/app"
import { CompositionDigest } from "../src/composition/digest"
import { Database } from "../src/database/database"
import { Image } from "../src/image"
import { InstructionDiscovery } from "../src/instruction-discovery"
import { InstructionBuiltIns } from "../src/instructions/builtins"
import { Instructions } from "../src/instructions/index"
import { Location } from "../src/location"
import { McpConnection } from "../src/mcp/connection"
import { McpInstructions } from "../src/mcp/instructions"
import { Model } from "../src/model"
import { Project } from "../src/project"
import { ProjectTable } from "../src/project/sql"
import { ReferenceInstructions } from "../src/reference/instructions"
import { AbsolutePath } from "../src/schema"
import { SessionComposition } from "../src/session/composition"
import { SessionContext } from "../src/session/context"
import { SessionMessage } from "../src/session/message"
import { SessionModelRequest } from "../src/session/model-request"
import { SessionRunnerModel } from "../src/session/runner/model"
import { SessionSchema } from "../src/session/schema"
import { SessionTable } from "../src/session/sql"
import { Tool } from "../src/tool"
import { McpTool } from "../src/tool/mcp"
import { location } from "./fixture/location"
import { CompositionFixture } from "./lib/composition"
import { testEffect } from "./lib/effect"
import { readInitial } from "./lib/instructions"
import { withCustomModeEnabled } from "./lib/product-mode"

withCustomModeEnabled()

const directory = AbsolutePath.make("/project")
const hostVersion = "namespace-test"
const rootID = SessionSchema.ID.make("ses_custom_namespace_root")
const workerID = SessionSchema.ID.make("ses_custom_namespace_worker")
const liveID = SessionSchema.ID.make("ses_live_namespace")
const worker = Agent.Info.make({ ...Agent.Info.empty(Agent.ID.make("namespace-worker")), mode: "subagent" })
const root = Agent.Info.make({ ...Agent.Info.empty(Agent.ID.make("meta")), mode: "primary" })

// Keep persistence, frozen selection, and tool discovery real. Model execution and
// ambient instruction producers are outside this selection-only regression.
const it = testEffect(
  LayerNode.compile(
    LayerNode.group([Database.node, SessionContext.node, SessionComposition.node, Tool.node, Agent.node]),
    {
      replacements: [
        Global.node.replace(
          Layer.succeed(Global.Service, Global.make({ data: "/data", config: "/config", tmp: "/tmp/aigcfroge" })),
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
          Layer.mock(McpInstructions.Service, { load: () => Effect.succeed(Instructions.empty) }),
        ),
        McpConnection.node.replace(Layer.mock(McpConnection.Service, { facts: () => Effect.succeed([]) })),
        McpTool.node.replace(Layer.mock(McpTool.Service, { flush: Effect.void })),
        Model.node.replace(Layer.mock(Model.Service, {})),
        SessionRunnerModel.node.replace(Layer.mock(SessionRunnerModel.Service, {})),
        SessionModelRequest.node.replace(Layer.mock(SessionModelRequest.Service, {})),
      ],
    },
  ),
)

const setup = Effect.fn("SessionCustomNamespace.setup")(function* (namespace = "tools", description?: string) {
  const database = yield* Database.Service
  yield* database.db.insert(ProjectTable).values({ id: Project.ID.global, worktree: directory, sandboxes: [] }).run()
  yield* database.db
    .insert(SessionTable)
    .values(
      [
        { id: rootID, agent: root.id, mode: "custom" as const },
        { id: workerID, parent_id: rootID, agent: worker.id, mode: "custom" as const },
        { id: liveID, agent: root.id, mode: "work" as const },
      ].map((session) => ({
        ...session,
        project_id: Project.ID.global,
        directory,
        slug: session.id,
        title: "namespace capture",
        version: hostVersion,
        attended: 1 as const,
      })),
    )
    .run()
  const agents = yield* Agent.Service
  yield* agents.transform((editor) => editor.update(root.id, (info) => Object.assign(info, root)))
  const registry = yield* Tool.Service
  yield* registry.transform((editor) => {
    if (description !== undefined) editor.namespace({ name: "tools", description })
    editor.add({
      name: "echo",
      description: "Echo text",
      input: Schema.Struct({ text: Schema.String }),
      output: Schema.String,
      options: { namespace },
      execute: ({ text }) => Effect.succeed({ output: text }),
    })
  })
  return (yield* registry.snapshot()).catalog
})

const freeze = Effect.fn("SessionCustomNamespace.freeze")(function* (catalog: Tool.Snapshot["catalog"]) {
  yield* CompositionFixture.attach(rootID, worker, {
    orchestrator: root,
    tools: CompositionDigest.captureTools(catalog, directory, hostVersion),
  })
  const compositions = yield* SessionComposition.Service
  yield* compositions.copy(rootID, workerID)
})

describe("Custom Code Mode namespace capture", () => {
  it.effect("rejects namespace-only description drift while work Sessions continue using live discovery", () =>
    Effect.gen(function* () {
      const catalog = yield* setup("tools", "Archival operations")
      yield* freeze(catalog)
      expect(catalog.find((tool) => tool.placement === "codemode")?.namespaceMetadata).toEqual([
        { name: "tools", description: "Archival operations" },
      ])
      expect(catalog.find((tool) => tool.placement === "direct")?.namespaceMetadata).toBeUndefined()
      const context = yield* SessionContext.Service
      const selected = yield* context.select(workerID)
      expect((yield* readInitial(selected.instructions)).text).toContain("Archival operations")
      const registry = yield* Tool.Service
      yield* registry.transform((editor) => editor.namespace({ name: "tools", description: "Billing operations" }))
      expect(yield* context.select(workerID).pipe(Effect.flip)).toMatchObject({
        _tag: "SessionComposition.DependencyMissingError",
        sessionID: workerID,
        reason: "tool_runtime_definition_mismatch",
      })
      const live = yield* context.select(liveID)
      expect((yield* readInitial(live.instructions)).text).toContain("Billing operations")
      expect((yield* readInitial(selected.instructions)).text).toContain("Archival operations")
      const execute = (tools: Tool.Snapshot, query: string) =>
        tools.execute({
          sessionID: workerID,
          agent: worker.id,
          messageID: SessionMessage.ID.make("msg_namespace_search"),
          call: {
            type: "tool-call",
            id: "namespace-search",
            name: "execute",
            input: {
              code: `return search({ query: ${JSON.stringify(query)} }).items.map(item => item.path).join(",")`,
            },
          },
        })
      expect((yield* execute(selected.tools, "archival")).output).toMatchObject({ output: "tools.tools.echo" })
      expect((yield* execute(selected.tools, "billing")).output).toMatchObject({ output: "" })
      expect((yield* execute(live.tools, "billing")).output).toMatchObject({ output: "tools.tools.echo" })
    }),
  )

  it.effect("captures ancestor namespace descriptions used by nested Code Mode search", () =>
    Effect.gen(function* () {
      const catalog = yield* setup("tools.archive", "Archival operations")
      yield* freeze(catalog)
      expect(catalog.find((tool) => tool.placement === "codemode")?.namespaceMetadata).toEqual([
        { name: "tools", description: "Archival operations" },
      ])
      const context = yield* SessionContext.Service
      expect((yield* readInitial((yield* context.select(workerID)).instructions)).text).toContain("Archival operations")
      const registry = yield* Tool.Service
      yield* registry.transform((editor) => editor.namespace({ name: "tools", description: "Billing operations" }))
      expect(yield* context.select(workerID).pipe(Effect.flip)).toMatchObject({
        _tag: "SessionComposition.DependencyMissingError",
        reason: "tool_runtime_definition_mismatch",
      })
    }),
  )

  it.effect("freezes an unregistered namespace and rejects a later description", () =>
    Effect.gen(function* () {
      const catalog = yield* setup()
      yield* freeze(catalog)
      expect(catalog.find((tool) => tool.placement === "codemode")?.namespaceMetadata).toEqual([])
      const context = yield* SessionContext.Service
      yield* context.select(workerID)
      const registry = yield* Tool.Service
      yield* registry.transform((editor) => editor.namespace({ name: "tools", description: "New live description" }))
      expect(yield* context.select(workerID).pipe(Effect.flip)).toMatchObject({
        _tag: "SessionComposition.DependencyMissingError",
        reason: "tool_runtime_definition_mismatch",
      })
    }),
  )

  it.effect("reads historical snapshots without metadata but refuses to restore namespaced tool execution", () =>
    Effect.gen(function* () {
      const catalog = (yield* setup("tools", "Archival operations")).map((tool) => {
        const historical = { ...tool }
        delete historical.namespaceMetadata
        return historical
      })
      yield* freeze(catalog)
      const compositions = yield* SessionComposition.Service
      const snapshot = yield* compositions.read(workerID)
      expect(snapshot?.version).toBe(2)
      if (snapshot === undefined) return yield* Effect.die("Expected persisted historical snapshot")
      expect(Result.isSuccess(CompositionDigest.validateCapturedTools(snapshot.data.tools))).toBe(true)
      const decoded = Schema.decodeUnknownSync(Composition.Snapshot)(JSON.parse(JSON.stringify(snapshot)))
      expect(decoded.data.tools.capture).toEqual(snapshot.data.tools.capture)
      const context = yield* SessionContext.Service
      expect(yield* context.select(workerID).pipe(Effect.flip)).toMatchObject({
        _tag: "SessionComposition.DependencyMissingError",
        reason: "tool_runtime_definition_mismatch",
      })
    }),
  )
})
