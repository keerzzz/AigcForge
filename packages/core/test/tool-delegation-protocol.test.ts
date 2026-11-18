import { describe, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { eq } from "drizzle-orm"
import { Agent } from "@aigcfroge/core/agent"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { Bus } from "@aigcfroge/core/bus"
import { Database } from "@aigcfroge/core/database/database"
import { CompositionDigest } from "@aigcfroge/core/composition/digest"
import { Location } from "@aigcfroge/core/location"
import { Permission } from "@aigcfroge/core/permission"
import { Project } from "@aigcfroge/core/project"
import { AgentPlugin } from "@aigcfroge/core/plugin/agent"
import { Session } from "@aigcfroge/core/session"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { Tool } from "@aigcfroge/core/tool"
import { DelegationProtocolTool } from "@aigcfroge/core/tool/delegation-protocol"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { Global } from "@aigcfroge/util/global"
import { tempGlobalLayer } from "./fixture/global"
import { tempLocationLayer } from "./fixture/location"
import { createLegacySession, offlineModels } from "./fixture/models"
import { CompositionFixture } from "./lib/composition"
import { testEffect } from "./lib/effect"
import { withCustomModeEnabled } from "./lib/product-mode"
import { executeTool, registerToolPlugin, toolDefinitions, toolIdentity } from "./lib/tool"
import { agentHost, host } from "./plugin/host"

withCustomModeEnabled()

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Tool.node,
      Agent.node,
      Permission.node,
      Location.node,
      Session.node,
      SessionComposition.node,
      Database.node,
      Project.node,
      Bus.node,
    ]),
    [
      Global.node.replace(tempGlobalLayer),
      Location.node.replace(tempLocationLayer),
      Bus.node.replace(Bus.configured({ persist: true })),
      offlineModels,
    ],
  ),
)

const input = {
  engine: "build",
  task_description: "Verify the preview manifest.",
  constraints: "Read only. Do not infer approvals.",
  context: "The manifest contains declared readiness checks.",
  success_criteria: "Report each declared status accurately.",
  unknowns: "Missing values remain unresolved.",
  verification: "Read the manifest; distinguish declarations from executed checks.",
} satisfies typeof DelegationProtocolTool.Input.Type

const setup = Effect.gen(function* () {
  const agents = yield* Agent.Service
  const registry = yield* Tool.Service
  const location = yield* Location.Service
  yield* AgentPlugin.Plugin.effect(host({ agent: agentHost(agents) }))
  const parent = yield* createLegacySession({
    location: Location.Ref.make({ directory: location.directory }),
    agent: Agent.ID.make("meta"),
    title: "Protocol keeper",
  })
  yield* registerToolPlugin(DelegationProtocolTool.Plugin)
  return {
    agents,
    registry,
    parent,
    location,
    execute: (changes: Partial<typeof DelegationProtocolTool.Input.Type> = {}) =>
      executeTool(registry, {
        sessionID: parent.id,
        ...toolIdentity,
        agent: Agent.ID.make("meta"),
        call: {
          type: "tool-call",
          id: "protocol-keeper",
          name: DelegationProtocolTool.name,
          input: { ...input, ...changes },
        },
      }),
  }
})

const decodeOutput = Schema.decodeUnknownSync(DelegationProtocolTool.Output)

describe("generate_delegation_protocol registered tool", () => {
  it.live("advertises the Meta tool and generates all seven sections with actual protocol bytes", () =>
    Effect.gen(function* () {
      const f = yield* setup
      const meta = yield* f.agents.resolve("meta")
      expect(meta).toBeDefined()
      expect((yield* toolDefinitions(f.registry, meta?.permissions)).map((tool) => tool.name)).toContain(
        DelegationProtocolTool.name,
      )
      const result = yield* f.execute({ include_protocol: true })
      expect(result.status).toBe("completed")
      const output = decodeOutput(result.output)
      expect(output.protocol.match(/^# .+$/gm)).toEqual([
        "# Project",
        "# Context",
        "# Task",
        "# Engine",
        "# Constraints",
        "# Unknowns",
        "# Verify",
      ])
      const build = yield* f.agents.resolve("build")
      const card = build?.card
      expect(card && !("_tag" in card) ? output.protocol.includes(card.protocol ?? "") : false).toBe(true)
      expect(output).toMatchObject({
        engine: "build",
        cardStatus: "present",
        protocolStatus: "included",
        protocolIncluded: true,
        source: { scope: "live", location: f.location.directory },
      })
      expect(result.metadata).toMatchObject({
        engine: output.engine,
        cardStatus: output.cardStatus,
        protocolStatus: output.protocolStatus,
        protocolIncluded: output.protocolIncluded,
        source: output.source,
      })
    }),
  )

  it.live("distinguishes absent cards, absent protocols, omission, broken cards and invalid targets", () =>
    Effect.gen(function* () {
      const f = yield* setup
      yield* f.agents.transform((editor) => {
        editor.update(Agent.ID.make("no-card"), (info) => {
          info.mode = "all"
          info.originKind = "builtin"
        })
        editor.update(Agent.ID.make("no-protocol"), (info) => {
          info.mode = "all"
          info.originKind = "builtin"
          info.card = { capabilities: ["review"], constraints: [] }
        })
        editor.update(Agent.ID.make("broken"), (info) => {
          info.mode = "all"
          info.originKind = "builtin"
          info.card = { _tag: "InvalidCard", reason: "empty_protocol" }
        })
      })
      expect(decodeOutput((yield* f.execute()).output)).toMatchObject({
        protocolStatus: "not_requested",
        protocolIncluded: false,
      })
      expect(decodeOutput((yield* f.execute({ engine: "no-card", include_protocol: true })).output)).toMatchObject({
        cardStatus: "absent",
        protocolStatus: "absent",
        protocolIncluded: false,
      })
      expect(decodeOutput((yield* f.execute({ engine: "no-protocol", include_protocol: true })).output)).toMatchObject({
        cardStatus: "present",
        protocolStatus: "absent",
        protocolIncluded: false,
      })
      const broken = yield* f.execute({ engine: "broken" })
      expect(broken.status).toBe("error")
      expect(JSON.stringify(broken.error)).toContain("reason=empty_protocol")
      expect(JSON.stringify((yield* f.execute({ engine: "missing" })).error)).toContain("Unknown delegation target")
      expect(JSON.stringify((yield* f.execute({ engine: "meta" })).error)).toContain("Ineligible delegation target")
      expect((yield* f.execute({ context: "  " })).status).toBe("error")
    }),
  )

  it.live("rechecks actual permissions on every invocation", () =>
    Effect.gen(function* () {
      const f = yield* setup
      expect((yield* f.execute()).status).toBe("completed")
      yield* f.agents.transform((editor) =>
        editor.update(Agent.ID.make("meta"), (info) => {
          info.permissions.push({ action: DelegationProtocolTool.name, resource: "*", effect: "deny" })
        }),
      )
      expect((yield* f.execute()).status).toBe("error")
    }),
  )

  for (const state of ["present", "absent", "broken", "denied"] as const) {
    it.live(`uses the persisted Custom ${state} card without live fallback`, () =>
      Effect.gen(function* () {
        const f = yield* setup
        const compositions = yield* SessionComposition.Service
        const database = yield* Database.Service
        const info = Agent.Info.make({
          ...Agent.Info.empty(Agent.ID.make("build")),
          mode: "all",
          ...(state === "present" || state === "denied"
            ? { card: { capabilities: ["frozen"], constraints: [], protocol: "Exact frozen A\n" } }
            : {}),
          ...(state === "broken" ? { card: { _tag: "InvalidCard" as const, reason: "invalid_shape" as const } } : {}),
        })
        const meta = yield* f.agents.resolve("meta")
        if (meta === undefined) return yield* Effect.die("Expected registered Meta")
        const orchestrator =
          state === "denied"
            ? Agent.Info.make({
                ...meta,
                permissions: [
                  ...meta.permissions,
                  { action: DelegationProtocolTool.name, resource: "*", effect: "deny" },
                ],
              })
            : meta
        const snapshot = yield* CompositionFixture.attach(f.parent.id, info, {
          orchestrator,
          tools: CompositionDigest.captureTools(
            (yield* f.registry.snapshot()).catalog,
            f.location.directory,
            "protocol-keeper",
          ),
        })
        yield* database.db
          .update(SessionTable)
          .set({ mode: "custom" })
          .where(eq(SessionTable.id, f.parent.id))
          .run()
          .pipe(Effect.orDie)
        yield* f.agents.transform((editor) =>
          editor.update(info.id, (agent) => {
            agent.card = { capabilities: ["live"], constraints: [], protocol: "Exact live B\n" }
          }),
        )
        const result = yield* f.execute({ include_protocol: true })
        const captured = yield* compositions.selectAgent(f.parent.id, info.id)
        expect(captured.info.card).toEqual(info.card)
        expect(captured.snapshot.digest).toBe(snapshot.digest)
        if (state === "denied") {
          expect(result.status).toBe("error")
          return
        }
        if (state === "broken") {
          expect(result.status).toBe("error")
          expect(JSON.stringify(result.error)).toContain("scope=frozen reason=invalid_shape")
          return
        }
        expect(result.status).toBe("completed")
        const output = decodeOutput(result.output)
        expect(output.source).toMatchObject({
          scope: "frozen",
          snapshotDigest: snapshot.digest,
          consumerKey: "agents/build",
        })
        expect(output.protocol).not.toContain("Exact live B")
        expect(output.protocolIncluded).toBe(state === "present")
        if (state === "present") expect(output.protocol).toContain("Exact frozen A\n")
        expect(JSON.stringify((yield* f.execute({ engine: "missing" })).error)).toContain(
          "Cannot select frozen delegation target",
        )
      }),
    )
  }
})
