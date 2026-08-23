import { describe, expect } from "bun:test"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { AgentV2 } from "@aigcfroge/core/agent"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { Location } from "@aigcfroge/core/location"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionStore } from "@aigcfroge/core/session/store"
import { SessionV2 } from "@aigcfroge/core/session"
import { PermissionSaved } from "@aigcfroge/core/permission/saved"
import { PermissionV2 } from "@aigcfroge/core/permission"
import { ScopedGrantStore } from "@aigcfroge/core/grant/store"
import { Effect, Exit, Layer, Schema } from "effect"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { withCustomModeEnabled } from "./lib/product-mode"

// ADR-20 §2.2 consultation order, exercised through the real PermissionV2
// layer: policy rulesets decide first — deny rejects outright, allow passes
// outright, and only an `ask` verdict consults candidate grants. A consumed
// `once` grant must make the very next identical call fall back to asking.

withCustomModeEnabled()

const current = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
)
const sessions = SessionV2.layer.pipe(
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(Database.defaultLayer),
  Layer.provide(SessionStore.defaultLayer),
  Layer.provide(Project.defaultLayer),
  Layer.provide(SessionExecution.noopLayer),
)
const layer = PermissionV2.locationLayer.pipe(
  Layer.provideMerge(Database.defaultLayer),
  Layer.provideMerge(SessionStore.defaultLayer),
  Layer.provideMerge(EventV2.defaultLayer),
  Layer.provideMerge(current),
  Layer.provideMerge(sessions),
  Layer.provideMerge(SessionExecution.noopLayer),
  Layer.provideMerge(PermissionSaved.defaultLayer),
  Layer.provideMerge(ScopedGrantStore.locationLayer),
)
const it = testEffect(layer)

function setup(rules: PermissionV2.Ruleset) {
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
        id: SessionV2.ID.make("ses_grant_perm"),
        project_id: Project.ID.global,
        slug: "ses_grant_perm",
        directory: AbsolutePath.make("/project"),
        title: "grants",
        version: "test",
        mode: "custom",
        agent: AgentV2.ID.make("test"),
        attended: null,
        time_created: Date.now(),
        time_updated: Date.now(),
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    const agents = yield* AgentV2.Service
    yield* agents.transform((editor) =>
      editor.update(AgentV2.ID.make("test"), (agent) => {
        agent.permissions = [...rules]
      }),
    )
    return SessionV2.ID.make("ses_grant_perm")
  })
}


describe("PermissionV2 × ScopedGrant consultation (ADR-20 §2.2)", () => {
  it.effect("full chain: ask verdict hits grant, skips the prompt, consumes once, next call asks again", () =>
    Effect.gen(function* () {
      const sessionID = yield* setup([{ action: "bash", resource: "*", effect: "ask" }])
      const store = yield* ScopedGrantStore.Service
      const service = yield* PermissionV2.Service

      yield* store.issue({ scope: { level: "once" }, action: "bash", resources: ["/tmp/*"] })

      // First call: the grant answers the ask — no pending request is created.
      yield* service.assert({
        sessionID,
        action: "bash",
        resources: ["/tmp/run.sh"],
        agent: AgentV2.ID.make("test"),
      })
      expect(yield* service.forSession(sessionID)).toHaveLength(0)

      // Second identical call: the once grant is gone, so the ask surfaces.
      const result = yield* service.ask({
        sessionID,
        action: "bash",
        resources: ["/tmp/run.sh"],
        agent: AgentV2.ID.make("test"),
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
      const service = yield* PermissionV2.Service

      yield* store.issue({ scope: { level: "location" }, action: "bash", resources: ["*"] })

      const exit = yield* service
        .assert({ sessionID, action: "bash", resources: ["/anywhere"], agent: AgentV2.ID.make("test") })
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(yield* service.forSession(sessionID)).toHaveLength(0)
    }),
  )

  it.effect("an allow rule passes without consulting or consuming any grant", () =>
    Effect.gen(function* () {
      const sessionID = yield* setup([{ action: "read", resource: "*", effect: "allow" }])
      const store = yield* ScopedGrantStore.Service
      const service = yield* PermissionV2.Service

      const grant = yield* store.issue({ scope: { level: "once" }, action: "read", resources: ["*"] })

      yield* service.assert({
        sessionID,
        action: "read",
        resources: ["src/index.ts"],
        agent: AgentV2.ID.make("test"),
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
      const service = yield* PermissionV2.Service

      const rules = yield* service.effectiveRules(sessionID, AgentV2.ID.make("test"))
      expect(rules.some((rule) => rule.action === "edit" && rule.resource === "docs/*" && rule.effect === "allow"))
        .toBe(true)

      // And the stored shape is untouched: four fields, Project-scoped.
      const listed = yield* saved.list({})
      expect(listed).toHaveLength(1)
      expect(Object.keys(Schema.decodeUnknownSync(Schema.Any)(listed[0]) ?? {}).sort()).toEqual([
        "action",
        "id",
        "projectID",
        "resource",
      ])
    }),
  )
})
