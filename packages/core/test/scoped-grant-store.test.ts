import { describe, expect } from "bun:test"
import { Effect, Exit, Layer, Schema } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@aigcfroge/core/database/database"
import { EventTable } from "@aigcfroge/core/event/sql"
import { EventV2 } from "@aigcfroge/core/event"
import { ScopedGrantStore } from "@aigcfroge/core/grant/store"
import { ScopedGrantTable } from "@aigcfroge/core/grant/sql"
import { SessionV2 } from "@aigcfroge/core/session"
import { Composition } from "@aigcfroge/schema/composition"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.mergeAll(Database.defaultLayer, EventV2.defaultLayer, ScopedGrantStore.locationLayer))

const sessionA = SessionV2.ID.make("ses_grant_a")
const sessionB = SessionV2.ID.make("ses_grant_b")
const revision = Schema.decodeUnknownSync(Composition.Revision)("c".repeat(64))

describe("ScopedGrantStore (ADR-20 §2.3/§2.4)", () => {
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

  it.effect("settled grants are pruned so the table does not grow forever", () =>
    Effect.gen(function* () {
      const store = yield* ScopedGrantStore.Service
      const { db } = yield* Database.Service
      const a = yield* store.issue({ scope: { level: "once" }, action: "bash", resources: ["*"] })
      yield* store.consume(a.grant.id)
      yield* store.issue({ scope: { level: "location" }, action: "read", resources: ["*"], expiresAt: Date.now() - 1 })
      // A new issuance sweeps settled/expired rows.
      yield* store.issue({ scope: { level: "location" }, action: "grep", resources: ["*"] })
      const rows = yield* db.select().from(ScopedGrantTable).all()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.action).toBe("grep")
    }),
  )
})
