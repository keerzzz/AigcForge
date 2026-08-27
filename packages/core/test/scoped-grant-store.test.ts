import { describe, expect } from "bun:test"
import { Context, Deferred, Duration, Effect, Exit, Layer, Ref, Schema, Scope } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { eq, sql } from "drizzle-orm"
import { Database } from "@aigcfroge/core/database/database"
import { Location } from "@aigcfroge/core/location"
import { Project } from "@aigcfroge/core/project"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { EventTable } from "@aigcfroge/core/event/sql"
import { EventV2 } from "@aigcfroge/core/event"
import { ScopedGrantStore } from "@aigcfroge/core/grant/store"
import { ScopedGrantTable } from "@aigcfroge/core/grant/sql"
import { SessionV2 } from "@aigcfroge/core/session"
import { Composition } from "@aigcfroge/schema/composition"
import { testEffect } from "./lib/effect"

const current = Layer.succeed(
  Location.Service,
  Location.Service.of({
    directory: AbsolutePath.make("/project"),
    project: { id: Project.ID.global, directory: AbsolutePath.make("/project") },
  }),
)
const dependencies = Layer.mergeAll(Database.defaultLayer, EventV2.defaultLayer)
const grants = ScopedGrantStore.locationLayer.pipe(Layer.provide(Layer.mergeAll(dependencies, current)))
const it = testEffect(Layer.mergeAll(dependencies, current, grants))

const sessionA = SessionV2.ID.make("ses_grant_a")
const sessionB = SessionV2.ID.make("ses_grant_b")
const revision = Schema.decodeUnknownSync(Composition.Revision)("c".repeat(64))

describe("ScopedGrantStore (ADR-20 §2.3/§2.4)", () => {
  // `rows[0]` is `Row | undefined` at every read site and the settled-row sweep
  // makes "look up a grant that is already gone" an ordinary path, so a missing
  // row must be `undefined`, not a defect.
  it.effect("returns undefined for an unknown grant instead of dying", () =>
    Effect.gen(function* () {
      const store = yield* ScopedGrantStore.Service
      const exit = yield* store.get("grt_does_not_exist").pipe(Effect.exit)
      expect(Exit.isSuccess(exit)).toBe(true)
      expect(yield* store.get("grt_does_not_exist")).toBeUndefined()
    }),
  )

  it.effect("issues an active grant whose row, info and durable event agree", () =>
    Effect.gen(function* () {
      const store = yield* ScopedGrantStore.Service
      const issued = yield* store.issue({
        scope: { level: "session", sessionID: sessionA },
        action: "bash",
        resources: ["/workspace/*"],
        agent: "custom-coder",
        revision,
      })
      expect(issued.status).toBe("active")
      expect(issued.grantRevision).toBe(1)
      expect(issued.grant.id.startsWith("grt_")).toBe(true)

      const fetched = yield* store.get(issued.grant.id)
      expect(fetched?.grant.action).toBe("bash")
      if (fetched?.grant.scope.level === "session") expect(fetched.grant.scope.sessionID).toBe(sessionA)

      const { db } = yield* Database.Service
      const events = yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, issued.grant.id)).all()
      expect(events).toHaveLength(1)
    }),
  )

  it.effect("once consumes exactly once; concurrent consumers leave a single winner; second consume fails", () =>
    Effect.gen(function* () {
      const store = yield* ScopedGrantStore.Service
      const grant = yield* store.issue({ scope: { level: "once" }, action: "bash", resources: ["*"] })

      const exits = yield* Effect.all(
        Array.from({ length: 8 }, () => store.consume(grant.grant.id).pipe(Effect.exit)),
        { concurrency: "unbounded" },
      )
      expect(exits.filter(Exit.isSuccess)).toHaveLength(1)
      expect(exits.filter(Exit.isFailure)).toHaveLength(7)

      const consumed = yield* store.get(grant.grant.id)
      expect(consumed?.status).toBe("consumed")

      // The explicit second consume is a typed failure, not a silent no-op.
      const second = yield* store.consume(grant.grant.id).pipe(Effect.exit)
      expect(Exit.isFailure(second)).toBe(true)

      // Consultation misses a consumed grant.
      const hit = yield* store.findValid({ action: "bash", resources: ["/workspace/run.sh"] })
      expect(hit).toBeUndefined()
    }),
  )

  it.effect("session grants do not cross sessions; location grants do", () =>
    Effect.gen(function* () {
      const store = yield* ScopedGrantStore.Service
      yield* store.issue({ scope: { level: "session", sessionID: sessionA }, action: "edit", resources: ["src/*"] })
      yield* store.issue({ scope: { level: "location" }, action: "grep", resources: ["*"] })

      const own = yield* store.findValid({ action: "edit", resources: ["src/a.ts"], sessionID: sessionA })
      expect(own?.status).toBe("active")
      const foreign = yield* store.findValid({ action: "edit", resources: ["src/a.ts"], sessionID: sessionB })
      expect(foreign).toBeUndefined()

      for (const sessionID of [sessionA, sessionB]) {
        const locationHit = yield* store.findValid({ action: "grep", resources: ["any"], sessionID })
        expect(locationHit?.status).toBe("active")
      }
    }),
  )

  it.effect("agent and snapshot-revision narrowings reject mismatches", () =>
    Effect.gen(function* () {
      const store = yield* ScopedGrantStore.Service
      yield* store.issue({
        scope: { level: "location" },
        action: "webfetch",
        resources: ["https://api.example.com/*"],
        agent: "custom-coder",
        revision,
      })

      const matching = yield* store.findValid({
        action: "webfetch",
        resources: ["https://api.example.com/v1"],
        agent: "custom-coder",
        snapshotRevision: revision,
      })
      expect(matching?.status).toBe("active")

      const wrongAgent = yield* store.findValid({
        action: "webfetch",
        resources: ["https://api.example.com/v1"],
        agent: "other-agent",
        snapshotRevision: revision,
      })
      expect(wrongAgent).toBeUndefined()

      const wrongRevision = yield* store.findValid({
        action: "webfetch",
        resources: ["https://api.example.com/v1"],
        agent: "custom-coder",
        snapshotRevision: Schema.decodeUnknownSync(Composition.Revision)("d".repeat(64)),
      })
      expect(wrongRevision).toBeUndefined()
    }),
  )

  it.effect("expiry and revocation take effect immediately at consultation time", () =>
    Effect.gen(function* () {
      const store = yield* ScopedGrantStore.Service
      yield* store.issue({
        scope: { level: "once" },
        action: "read",
        resources: ["secrets/*"],
        expiresAt: Date.now() - 1,
      })
      const expired = yield* store.findValid({ action: "read", resources: ["secrets/key"] })
      expect(expired).toBeUndefined()

      const grant = yield* store.issue({ scope: { level: "location" }, action: "write", resources: ["out/*"] })
      const before = yield* store.findValid({ action: "write", resources: ["out/x"] })
      expect(before?.status).toBe("active")

      const staleRevision = yield* store.revoke(grant.grant.id, grant.grantRevision + 5).pipe(Effect.exit)
      expect(Exit.isFailure(staleRevision)).toBe(true)

      const revoked = yield* store.revoke(grant.grant.id, grant.grantRevision)
      expect(revoked.status).toBe("revoked")
      const after = yield* store.findValid({ action: "write", resources: ["out/x"] })
      expect(after).toBeUndefined()

      const doubleRevoke = yield* store.revoke(grant.grant.id, revoked.grantRevision).pipe(Effect.exit)
      expect(Exit.isFailure(doubleRevoke)).toBe(true)
    }),
  )

  it.effect("publishes one durable event per transition with seq+1 equal to the CAS revision", () =>
    Effect.gen(function* () {
      const store = yield* ScopedGrantStore.Service
      const grant = yield* store.issue({ scope: { level: "once" }, action: "bash", resources: ["*"] })
      yield* store.consume(grant.grant.id)
      yield* store.revoke(grant.grant.id, 2)

      const { db } = yield* Database.Service
      const events = yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, grant.grant.id)).all()
      expect(events.length).toBe(3)
      const revisions = events.map((event) => {
        const raw = event.data as { revision?: unknown }
        return typeof raw.revision === "number" ? raw.revision : -1
      })
      expect(revisions).toEqual([1, 2, 3])

      const rows = yield* db.select().from(ScopedGrantTable).all()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.grant_revision).toBe(3)
    }),
  )
  it.effect("wildcard-action grants are discoverable and cover concrete actions", () =>
    Effect.gen(function* () {
      const store = yield* ScopedGrantStore.Service
      yield* store.issue({ scope: { level: "location" }, action: "web*", resources: ["*"] })
      const hit = yield* store.findValid({ action: "webfetch", resources: ["https://x.test"] })
      expect(hit?.status).toBe("active")
      expect(hit?.grant.action).toBe("web*")
    }),
  )

  it.effect("settled rows remain after later issuance but stay unavailable and once cannot be consumed twice", () =>
    Effect.gen(function* () {
      const store = yield* ScopedGrantStore.Service
      const consumed = yield* store.issue({ scope: { level: "once" }, action: "bash", resources: ["*"] })
      yield* store.consume(consumed.grant.id)

      yield* store.issue({ scope: { level: "location" }, action: "grep", resources: ["*"] })

      const retained = yield* store.get(consumed.grant.id)
      expect(retained?.status).toBe("consumed")
      expect(yield* store.findValid({ action: "bash", resources: ["/workspace/run.sh"] })).toBeUndefined()
      expect(Exit.isFailure(yield* store.consume(consumed.grant.id).pipe(Effect.exit))).toBe(true)
    }),
  )

  it.effect("lists once, session, and location grants with explicit session filtering", () =>
    Effect.gen(function* () {
      const store = yield* ScopedGrantStore.Service
      const once = yield* store.issue({ scope: { level: "once" }, action: "bash", resources: ["*"] })
      const sessionAGrant = yield* store.issue({ scope: { level: "session", sessionID: sessionA }, action: "edit", resources: ["*"] })
      const sessionBGrant = yield* store.issue({ scope: { level: "session", sessionID: sessionB }, action: "write", resources: ["*"] })
      const locationGrant = yield* store.issue({ scope: { level: "location" }, action: "read", resources: ["*"] })

      const all = yield* store.list({ retentionMs: 60_000 })
      expect(all.map((item) => item.grant.id).sort()).toEqual(
        [once.grant.id, sessionAGrant.grant.id, sessionBGrant.grant.id, locationGrant.grant.id].sort(),
      )

      const forA = yield* store.list({ sessionID: sessionA, retentionMs: 60_000 })
      expect(forA.map((item) => item.grant.id).sort()).toEqual([sessionAGrant.grant.id, locationGrant.grant.id].sort())
      expect(forA.some((item) => item.grant.id === once.grant.id)).toBe(false)
      expect(forA.some((item) => item.grant.id === sessionBGrant.grant.id)).toBe(false)
    }),
  )

  // Retention makes "read a settled row" an ordinary path, so `toInfoSafe`'s
  // corrupt-revision branch is load-bearing (Phase D review fixed a defect
  // there). The discriminating assertion is that a healthy row in the *same*
  // table still comes back — asserting only `[]` would also pass if `list`
  // returned nothing at all.
  it.effect("skips a corrupt historical row while still returning its healthy siblings", () =>
    Effect.gen(function* () {
      const store = yield* ScopedGrantStore.Service
      const { db } = yield* Database.Service
      const healthy = yield* store.issue({ scope: { level: "location" }, action: "grep", resources: ["*"] })
      const now = Date.now()
      yield* db.run(sql`
        INSERT INTO scoped_grant (id, directory, workspace_id, level, action, resources, asset_revision, issued_at, grant_revision, time_created, time_updated)
        VALUES ('grt_corrupt_history', '/project', '', 'location', 'read', '["*"]', 'not-a-revision', ${now}, 1, ${now}, ${now})
      `)

      const listed = yield* store.list()
      expect(listed.map((item) => item.grant.id)).toEqual([healthy.grant.id])
      expect(yield* store.get("grt_corrupt_history")).toBeUndefined()
      // The row is skipped on read, not deleted: retention owns row lifetime.
      expect(yield* db.all(sql`SELECT id FROM scoped_grant WHERE id = 'grt_corrupt_history'`)).toHaveLength(1)
    }),
  )

  // EXPLAIN the *production* predicate, not a hand-written copy of it: retention
  // keeps rows around, so a future edit that drops index usage has to fail here.
  it.effect("the real list filter resolves through the session and level indexes", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const now = Date.now()
      const input = { sessionID: sessionA, since: now - 60_000, until: now, retentionMs: 60_000 }
      const query = db
        .select()
        .from(ScopedGrantTable)
        .where(ScopedGrantStore.listFilter(input, ScopedGrantStore.retentionCutoff(now, input.retentionMs), {
            directory: "/project",
          }))
      const { sql: text } = query.toSQL()
      const plan = yield* db.all<{ detail: string }>(sql.raw(`EXPLAIN QUERY PLAN ${text.replaceAll("?", "1")}`))
      const details = plan.map((row) => row.detail)
      expect(details.some((detail) => detail.includes("scoped_grant_location_session_issued_idx"))).toBe(true)
      expect(details.some((detail) => detail.includes("scoped_grant_location_level_issued_idx"))).toBe(true)
      // A full scan would mean the indexes exist but serve nothing.
      expect(details.some((detail) => detail.includes("SCAN scoped_grant"))).toBe(false)
    }),
  )

  it.effect("does not expose a Location grant through another Location store", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const database = yield* Database.Service
      const events = yield* EventV2.Service
      const storeFor = (directory: string) =>
        Layer.fresh(
          ScopedGrantStore.locationLayer.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(
                  Location.Service,
                  Location.Service.of({
                    directory: AbsolutePath.make(directory),
                    project: { id: Project.ID.global, directory: AbsolutePath.make(directory) },
                  }),
                ),
                Layer.succeed(Database.Service, database),
                Layer.succeed(EventV2.Service, events),
              ),
            ),
          ),
        )
      const first = Context.get(yield* Layer.buildWithScope(storeFor("/grant-location-a"), scope), ScopedGrantStore.Service)
      const second = Context.get(yield* Layer.buildWithScope(storeFor("/grant-location-b"), scope), ScopedGrantStore.Service)

      const issued = yield* first.issue({ scope: { level: "location" }, action: "bash", resources: ["*"] })
      expect(yield* second.get(issued.grant.id)).toBeUndefined()
      expect(yield* second.list()).toEqual([])
      expect(yield* second.findValid({ action: "bash", resources: ["*"] })).toBeUndefined()
      yield* Scope.close(scope, Exit.void)
    }),
  )

  it.effect("uses the Location-provided Database and EventV2 instances", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const context = yield* Layer.buildWithScope(Layer.fresh(ScopedGrantStore.locationLayer), scope)
      const store = Context.get(context, ScopedGrantStore.Service)
      const issued = yield* store.issue({ scope: { level: "once" }, action: "read", resources: ["*"] })
      const { db } = yield* Database.Service
      expect(yield* db.all(sql`SELECT id FROM scoped_grant WHERE id = ${issued.grant.id}`)).toHaveLength(1)
      yield* Scope.close(scope, Exit.void)
    }),
  )

  it.effect("continues scheduled pruning after a non-interrupting failure", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0)
      const recovered = yield* Deferred.make<void>()
      const cleanupScope = yield* Scope.make()
      const store = Layer.mock(ScopedGrantStore.Service, {
        prune: () =>
          Ref.updateAndGet(calls, (count) => count + 1).pipe(
            Effect.flatMap((count) =>
              count === 1 ? Effect.die("injected prune defect") : Deferred.succeed(recovered, void 0),
            ),
            Effect.asVoid,
          ),
      })
      yield* Layer.buildWithScope(
        Layer.fresh(ScopedGrantStore.cleanupLayer.pipe(Layer.provide(Layer.fresh(store)))),
        cleanupScope,
      )
      yield* Effect.yieldNow
      expect(yield* Ref.get(calls)).toBe(1)
      yield* TestClock.adjust(Duration.hours(1))
      yield* Effect.yieldNow
      yield* Deferred.await(recovered)
      expect(yield* Ref.get(calls)).toBe(2)
      yield* Scope.close(cleanupScope, Exit.void)
    }),
  )

  it.effect("runs scheduled pruning in its owner scope and stops when that scope closes", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0)
      const firstRun = yield* Deferred.make<void>()
      const cleanupScope = yield* Scope.make()
      const store = Layer.mock(ScopedGrantStore.Service, {
        prune: () =>
          Ref.updateAndGet(calls, (count) => count + 1).pipe(
            Effect.tap((count) => (count === 1 ? Deferred.succeed(firstRun, void 0) : Effect.void)),
            Effect.asVoid,
          ),
      })
      yield* Layer.buildWithScope(
        Layer.fresh(ScopedGrantStore.cleanupLayer.pipe(Layer.provide(Layer.fresh(store)))),
        cleanupScope,
      )
      yield* Effect.yieldNow
      yield* Deferred.await(firstRun)
      expect(yield* Ref.get(calls)).toBe(1)

      yield* TestClock.adjust(Duration.hours(1))
      yield* Effect.yieldNow
      expect(yield* Ref.get(calls)).toBe(2)

      yield* Scope.close(cleanupScope, Exit.void)
      yield* TestClock.adjust(Duration.hours(1))
      yield* Effect.yieldNow
      expect(yield* Ref.get(calls)).toBe(2)
    }),
  )

  it.effect("prunes only settled rows outside the retention window and is reentrant", () =>
    Effect.gen(function* () {
      const store = yield* ScopedGrantStore.Service
      const { db } = yield* Database.Service
      const now = Date.now()
      const recent = yield* store.issue({ scope: { level: "once" }, action: "bash", resources: ["*"], issuedAt: now - 1_000 })
      const old = yield* store.issue({ scope: { level: "once" }, action: "edit", resources: ["*"], issuedAt: now - 20_000 })
      yield* db.run(sql`UPDATE scoped_grant SET consumed_at = ${now - 1_000}, grant_revision = 2 WHERE id = ${recent.grant.id}`)
      yield* db.run(sql`UPDATE scoped_grant SET consumed_at = ${now - 20_000}, grant_revision = 2 WHERE id = ${old.grant.id}`)
      const expired = yield* store.issue({
        scope: { level: "location" },
        action: "read",
        resources: ["*"],
        issuedAt: now - 20_000,
        expiresAt: now - 20_000,
      })
      const boundary = yield* store.issue({ scope: { level: "location" }, action: "grep", resources: ["*"], issuedAt: now - 5_000 })
      yield* db.run(sql`UPDATE scoped_grant SET consumed_at = ${now - 5_000}, grant_revision = 2 WHERE id = ${boundary.grant.id}`)
      const transitionedWithFutureExpiry = yield* store.issue({
        scope: { level: "once" },
        action: "write",
        resources: ["*"],
        issuedAt: now - 20_000,
        expiresAt: now + 60_000,
      })
      yield* db.run(
        sql`UPDATE scoped_grant SET consumed_at = ${now - 20_000}, grant_revision = 2 WHERE id = ${transitionedWithFutureExpiry.grant.id}`,
      )

      const retainedHistory = yield* store.list({ now, retentionMs: 5_000 })
      expect(retainedHistory.some((item) => item.grant.id === transitionedWithFutureExpiry.grant.id)).toBe(false)

      yield* store.prune({ now, retentionMs: 5_000 })
      expect(yield* store.get(recent.grant.id)).toBeDefined()
      expect(yield* store.get(old.grant.id)).toBeUndefined()
      expect(yield* store.get(expired.grant.id)).toBeUndefined()
      expect(yield* store.get(boundary.grant.id)).toBeDefined()
      expect(yield* store.get(transitionedWithFutureExpiry.grant.id)).toBeUndefined()
      yield* store.prune({ now, retentionMs: 5_000 })
      expect(yield* db.all(sql`SELECT id FROM scoped_grant`)).toHaveLength(2)
    }),
  )
})
