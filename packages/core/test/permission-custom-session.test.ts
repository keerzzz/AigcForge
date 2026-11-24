import { describe, expect } from "bun:test"
import { Agent } from "@omnixa/core/agent"
import { Bus } from "@omnixa/core/bus"
import { Database } from "@omnixa/core/database/database"
import { AppNodeBuilder } from "@omnixa/core/effect/app-node-builder"
import { Location } from "@omnixa/core/location"
import { LocationServiceMap } from "@omnixa/core/location-service-map"
import { Permission } from "@omnixa/core/permission"
import { Project } from "@omnixa/core/project"
import { ProjectTable } from "@omnixa/core/project/sql"
import { AbsolutePath } from "@omnixa/core/schema"
import { Session } from "@omnixa/core/session"
import { SessionComposition } from "@omnixa/core/session/composition"
import { SessionExecution } from "@omnixa/core/session/execution"
import { SessionTable } from "@omnixa/core/session/sql"
import { LayerNode } from "@omnixa/util/effect/layer-node"
import { Effect, Layer } from "effect"
import { location } from "./fixture/location"
import { promptLocationNode } from "./fixture/prompt-location"
import { CompositionFixture } from "./lib/composition"
import { testEffect } from "./lib/effect"
import { globalProjectNode } from "./lib/project"

const directory = AbsolutePath.make("/project")
const rootID = Session.ID.make("ses_custom_permission_root")
const workerID = Session.ID.make("ses_custom_permission_worker")
const agentID = Agent.ID.make("permission-worker")
const permissions: Permission.Ruleset = [
  { action: "*", resource: "*", effect: "deny" },
  { action: "read", resource: "*", effect: "allow" },
  { action: "task", resource: "*", effect: "allow" },
]
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, Session.node, Permission.node, Agent.node, SessionComposition.node]),
    [
      Location.node.replace(Layer.succeed(Location.Service, location({ directory }))),
      Project.node.replace(globalProjectNode),
      LocationServiceMap.node.replace(promptLocationNode),
      SessionExecution.node.replace(SessionExecution.noopLayer),
    ],
  ),
)

const setup = Effect.fn("PermissionCustomSession.setup")(function* (attended: boolean) {
  const database = yield* Database.Service
  yield* database.db.insert(ProjectTable).values({ id: Project.ID.global, worktree: directory, sandboxes: [] }).run()
  yield* database.db
    .insert(SessionTable)
    .values(
      [
        { id: rootID, agent: "meta", attended: 1 as const },
        { id: workerID, parent_id: rootID, agent: agentID, attended: attended ? (1 as const) : (0 as const) },
      ].map((row) => ({
        ...row,
        project_id: Project.ID.global,
        directory,
        slug: row.id,
        title: "Custom permissions",
        version: "test",
        mode: "custom" as const,
      })),
    )
    .run()
  yield* CompositionFixture.attach(
    rootID,
    Agent.Info.make({ ...Agent.Info.empty(agentID), mode: "subagent", permissions }),
    {
      orchestrator: Agent.Info.make({ ...Agent.Info.empty(Agent.ID.make("meta")), mode: "primary", permissions }),
    },
  )
  const compositions = yield* SessionComposition.Service
  yield* compositions.copy(rootID, workerID)
})

describe("Custom Session permission overrides", () => {
  for (const attended of [true, false]) {
    it.effect(`applies persisted wildcard deny and later read grants when attended=${attended}`, () =>
      Effect.gen(function* () {
        yield* setup(attended)
        const sessions = yield* Session.Service
        const service = yield* Permission.Service
        const agents = yield* Agent.Service
        yield* agents.transform((editor) =>
          editor.update(agentID, (agent) => {
            agent.permissions = [{ action: "*", resource: "*", effect: "allow" }]
          }),
        )
        const before = yield* service.effectiveRules(workerID, agentID)
        expect(Permission.evaluate("read", "src/index.ts", before).effect).toBe("allow")
        expect(Permission.evaluate("task", "coder", before).effect).toBe(attended ? "ask" : "deny")

        const deny: Permission.Ruleset = [{ action: "*", resource: "*", effect: "deny" }]
        yield* sessions.setPermissions({ sessionID: workerID, permissions: deny })
        expect((yield* sessions.get(workerID)).permissions).toEqual(deny)
        const blocked = yield* service.effectiveRules(workerID, agentID)
        for (const action of ["read", "task"]) {
          expect(Permission.evaluate(action, "src/index.ts", blocked).effect).toBe("deny")
          expect(
            yield* service
              .assert({ sessionID: workerID, agent: agentID, action, resources: ["src/index.ts"] })
              .pipe(Effect.flip),
          ).toBeInstanceOf(Permission.BlockedError)
          expect(
            yield* service.ask({ sessionID: workerID, agent: agentID, action, resources: ["src/index.ts"] }),
          ).toMatchObject({ effect: "deny" })
        }
        expect(yield* service.forSession(workerID)).toHaveLength(0)

        const restricted: Permission.Ruleset = [...deny, { action: "read", resource: "src/*", effect: "allow" }]
        yield* sessions.setPermissions({ sessionID: workerID, permissions: restricted })
        expect((yield* sessions.get(workerID)).permissions).toEqual(restricted)
        const reopened = yield* service.effectiveRules(workerID, agentID)
        expect(Permission.evaluate("read", "src/index.ts", reopened).effect).toBe("allow")
        expect(Permission.evaluate("read", "private/key.txt", reopened).effect).toBe("deny")
        expect(Permission.evaluate("task", "coder", reopened).effect).toBe("deny")
        yield* service.assert({ sessionID: workerID, agent: agentID, action: "read", resources: ["src/index.ts"] })
        expect(
          yield* service
            .assert({ sessionID: workerID, agent: agentID, action: "read", resources: ["private/key.txt"] })
            .pipe(Effect.flip),
        ).toBeInstanceOf(Permission.BlockedError)
      }),
    )
  }
})
