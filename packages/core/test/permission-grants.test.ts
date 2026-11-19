import { describe, expect } from "bun:test"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Agent } from "@aigcfroge/core/agent"
import { Database } from "@aigcfroge/core/database/database"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { Bus } from "@aigcfroge/core/bus"
import { Location } from "@aigcfroge/core/location"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { SessionStore } from "@aigcfroge/core/session/store"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { Session } from "@aigcfroge/core/session"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { PermissionSaved } from "@aigcfroge/core/permission/saved"
import { Permission } from "@aigcfroge/core/permission"
import { SessionPermissionOverride } from "@aigcfroge/core/permission/session-override"
import { ScopedGrantStore } from "@aigcfroge/core/grant/store"
import { Effect, Exit, Layer, Schema } from "effect"
import { location } from "./fixture/location"
import { CompositionFixture } from "./lib/composition"
import { testEffect } from "./lib/effect"
import { withCustomModeEnabled } from "./lib/product-mode"

// ADR-20 §2.2 consultation order, exercised through the real Permission
// layer: policy rulesets decide first — deny rejects outright, allow passes
// outright, and only an `ask` verdict consults candidate grants. A consumed
// `once` grant must make the very next identical call fall back to asking.

withCustomModeEnabled()

const current = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionStore.node,
      SessionComposition.node,
      PermissionSaved.node,
      Agent.node,
      Location.node,
      ScopedGrantStore.node,
      SessionPermissionOverride.node,
      Permission.node,
    ]),
    [Location.node.replace(current)],
  ),
)

function setup(rules: Permission.Ruleset, options: { snapshot?: boolean } = {}) {
  return Effect.gen(function* () {
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
        id: Session.ID.make("ses_grant_perm"),
        project_id: Project.ID.global,
        slug: "ses_grant_perm",
        directory: AbsolutePath.make("/project"),
        title: "grants",
        version: "test",
        mode: "custom",
        agent: Agent.ID.make("test"),
        attended: null,
        time_created: Date.now(),
        time_updated: Date.now(),
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    const agents = yield* Agent.Service
    const info = Agent.Info.make({ ...Agent.Info.default(Agent.ID.make("test")), permissions: [...rules] })
    yield* agents.transform((editor) =>
      editor.update(Agent.ID.make("test"), (agent) => {
        Object.assign(agent, info)
      }),
    )
    if (options.snapshot !== false) yield* CompositionFixture.attach(Session.ID.make("ses_grant_perm"), info)
    return Session.ID.make("ses_grant_perm")
  })
}

describe("Permission × ScopedGrant consultation (ADR-20 §2.2)", () => {
  it.effect("a missing Custom snapshot blocks live allows, grants, and master override", () =>
    Effect.gen(function* () {
      const sessionID = yield* setup([{ action: "read", resource: "*", effect: "allow" }], { snapshot: false })
      const store = yield* ScopedGrantStore.Service
      const service = yield* Permission.Service
      const overrides = yield* SessionPermissionOverride.Service
      const grant = yield* store.issue({ scope: { level: "once" }, action: "read", resources: ["*"] })
      yield* overrides.enable(sessionID)
      expect(yield* overrides.get(sessionID)).toBe(true)

      const input = { sessionID, action: "read", resources: ["src/index.ts"], agent: Agent.ID.make("test") }
      expect(yield* service.effectiveRules(sessionID, input.agent).pipe(Effect.flip)).toBeInstanceOf(
        Permission.BlockedError,
      )
      expect(yield* service.assert(input).pipe(Effect.flip)).toBeInstanceOf(Permission.BlockedError)
      expect(yield* service.ask(input)).toMatchObject({ effect: "deny" })
      expect((yield* store.get(grant.grant.id))?.status).toBe("active")
      expect(yield* service.forSession(sessionID)).toHaveLength(0)
    }),
  )

  it.effect("full chain: ask verdict hits grant, skips the prompt, consumes once, next call asks again", () =>
    Effect.gen(function* () {
      const sessionID = yield* setup([{ action: "bash", resource: "*", effect: "ask" }])
      const store = yield* ScopedGrantStore.Service
      const service = yield* Permission.Service

      yield* store.issue({ scope: { level: "once" }, action: "bash", resources: ["/tmp/*"] })

      // First call: the grant answers the ask — no pending request is created.
      yield* service.assert({
        sessionID,
        action: "bash",
        resources: ["/tmp/run.sh"],
        agent: Agent.ID.make("test"),
      })
      expect(yield* service.forSession(sessionID)).toHaveLength(0)

      // Second identical call: the once grant is gone, so the ask surfaces.
      const result = yield* service.ask({
        sessionID,
        action: "bash",
        resources: ["/tmp/run.sh"],
        agent: Agent.ID.make("test"),
      })
      expect(result.effect).toBe("ask")
      expect(yield* service.forSession(sessionID)).toHaveLength(1)

      // The consumed grant is terminal in the store itself.
      const all = yield* store.findValid({ action: "bash", resources: ["/tmp/x"], sessionID })
      expect(all).toBeUndefined()
    }),
  )

  it.effect("a grant never flips a policy deny", () =>
    Effect.gen(function* () {
      const sessionID = yield* setup([{ action: "bash", resource: "*", effect: "deny" }])
      const store = yield* ScopedGrantStore.Service
      const service = yield* Permission.Service

      yield* store.issue({ scope: { level: "location" }, action: "bash", resources: ["*"] })

      const exit = yield* service
        .assert({ sessionID, action: "bash", resources: ["/anywhere"], agent: Agent.ID.make("test") })
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(yield* service.forSession(sessionID)).toHaveLength(0)
    }),
  )

  it.effect("an allow rule passes without consulting or consuming any grant", () =>
    Effect.gen(function* () {
      const sessionID = yield* setup([{ action: "read", resource: "*", effect: "allow" }])
      const store = yield* ScopedGrantStore.Service
      const service = yield* Permission.Service

      const grant = yield* store.issue({ scope: { level: "once" }, action: "read", resources: ["*"] })

      yield* service.assert({
        sessionID,
        action: "read",
        resources: ["src/index.ts"],
        agent: Agent.ID.make("test"),
      })

      const after = yield* store.get(grant.grant.id)
      expect(after?.status).toBe("active")
    }),
  )

  it.effect("saved always approvals keep working alongside grants (no migration of meaning)", () =>
    Effect.gen(function* () {
      const sessionID = yield* setup([])
      const saved = yield* PermissionSaved.Service
      const location = yield* Location.Service
      yield* saved.add({ projectID: location.project.id, action: "edit", resources: ["docs/*"] })
      const service = yield* Permission.Service

      const rules = yield* service.effectiveRules(sessionID, Agent.ID.make("test"))
      expect(
        rules.some((rule) => rule.action === "edit" && rule.resource === "docs/*" && rule.effect === "allow"),
      ).toBe(true)

      // And the stored shape is untouched: Project-scoped, never session-scoped.
      const listed = yield* saved.list({})
      expect(listed).toHaveLength(1)
      expect(Object.keys(Schema.decodeUnknownSync(Schema.Any)(listed[0]) ?? {}).sort()).toEqual([
        "action",
        "id",
        "projectID",
        "resource",
        "time",
      ])
    }),
  )
  it.effect("attended custom allow-all asset really surfaces the ask prompt (full chain)", () =>
    Effect.gen(function* () {
      const sessionID = yield* setup([{ action: "bash", resource: "*", effect: "allow" }])
      const service = yield* Permission.Service

      // Pre-fix this assert returned silently (allow). The rewrite must make
      // the approval request actually appear.
      const result = yield* service.ask({
        sessionID,
        action: "bash",
        resources: ["/workspace/build.sh"],
        agent: Agent.ID.make("test"),
      })
      expect(result.effect).toBe("ask")
      const pending = yield* service.forSession(sessionID)
      expect(pending).toHaveLength(1)

      // Replying settles the surfaced prompt.
      yield* service.reply({ requestID: pending[0]!.id, reply: "reject" })
      expect(yield* service.forSession(sessionID)).toHaveLength(0)
    }),
  )
})
