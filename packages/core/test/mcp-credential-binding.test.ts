import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer, Option } from "effect"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { McpCredentialBindingStore } from "@aigcfroge/core/mcp/binding/store"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Workspace } from "@aigcfroge/schema/workspace"
import { Location } from "@aigcfroge/core/location"
import { testEffect } from "./lib/effect"
import { sql } from "drizzle-orm"
import { location } from "./fixture/location"

const dbEvents = Layer.mergeAll(Database.defaultLayer, EventV2.defaultLayer)
const it = testEffect(dbEvents)

const makeStore = (ref: { directory: string; workspaceID?: string }) => {
  const abs = AbsolutePath.make(ref.directory)
  const locRef: Location.Ref = ref.workspaceID
    ? { directory: abs, workspaceID: Workspace.ID.make(ref.workspaceID) }
    : { directory: abs }
  return McpCredentialBindingStore.layer.pipe(Layer.provide(Layer.succeed(Location.Service, location(locRef))))
}

const expectStateError = (
  exit: Exit.Exit<unknown, unknown>,
  expectedReason: McpCredentialBindingStore.StateError["reason"],
) => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const errOpt = Cause.findErrorOption(exit.cause)
    expect(Option.isSome(errOpt)).toBe(true)
    if (Option.isSome(errOpt) && errOpt.value instanceof McpCredentialBindingStore.StateError) {
      expect(errOpt.value.reason).toBe(expectedReason)
    }
  }
}

const expectCrossLocation = (exit: Exit.Exit<unknown, unknown>) => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const errOpt = Cause.findErrorOption(exit.cause)
    expect(Option.isSome(errOpt)).toBe(true)
    if (Option.isSome(errOpt) && errOpt.value instanceof McpCredentialBindingStore.CrossLocationRefError) {
      expect(errOpt.value._tag).toBe("McpBinding.CrossLocationRefError")
    }
  }
}

describe("McpCredentialBindingStore (ADR-21 §2.2/§2.3 v1.2)", () => {
  it.effect("bind succeeds and duplicate server in same Location fails via unique constraint", () =>
    Effect.gen(function* () {
      const store = yield* McpCredentialBindingStore.Service
      const a = yield* store.bind({ serverName: "git", credentialRef: "cred_aaaaaaaa" })
      expect(a.serverName).toBe("git")
      expect(a.workspaceID).toBeUndefined()
      const dup = yield* store.bind({ serverName: "git", credentialRef: "cred_bbbbbbbb" }).pipe(Effect.exit)
      expectStateError(dup, "duplicate")
    }).pipe(Effect.provide(makeStore({ directory: "/tmp/a" }))),
  )

  it.effect("workspace_id sentinel: undefined is stored as empty string and enforces uniqueness", () =>
    Effect.gen(function* () {
      const store = yield* McpCredentialBindingStore.Service
      const a = yield* store.bind({ serverName: "s1", credentialRef: "cred_111111" })
      expect(a.workspaceID).toBeUndefined()
      const dup = yield* store.bind({ serverName: "s1", credentialRef: "cred_222222" }).pipe(Effect.exit)
      expectStateError(dup, "duplicate")
      const fetched = yield* store.get({ serverName: "s1" })
      expect(fetched?.credentialRef).toBe("cred_111111")
    }).pipe(Effect.provide(makeStore({ directory: "/tmp/sentinel" }))),
  )

  it.effect(
    "cross-location isolation: B cannot resolve A's ref, same server across directories both bind, revoke is local",
    () =>
      Effect.gen(function* () {
        yield* Effect.gen(function* () {
          const store = yield* McpCredentialBindingStore.Service
          yield* store.bind({ serverName: "git", credentialRef: "cred_cross" })
        }).pipe(Effect.provide(makeStore({ directory: "/tmp/cross-a" })))

        const cross = yield* Effect.gen(function* () {
          const store = yield* McpCredentialBindingStore.Service
          return yield* store.resolve({ serverName: "git", credentialRef: "cred_cross" })
        })
          .pipe(Effect.provide(makeStore({ directory: "/tmp/cross-b" })))
          .pipe(Effect.exit)
        expectCrossLocation(cross)

        yield* Effect.gen(function* () {
          const store = yield* McpCredentialBindingStore.Service
          const b = yield* store.bind({ serverName: "git", credentialRef: "cred_cross-b" })
          expect(b.serverName).toBe("git")
        }).pipe(Effect.provide(makeStore({ directory: "/tmp/cross-b" })))

        const { db } = yield* Database.Service
        const { McpCredentialBindingTable } = yield* Effect.promise(() => import("@aigcfroge/core/mcp/binding/sql"))
        const rows = yield* db.select().from(McpCredentialBindingTable).all().pipe(Effect.orDie)
        const gitRows = rows.filter((r) => r.server_name === "git")
        expect(gitRows.length).toBe(2)

        yield* Effect.gen(function* () {
          const store = yield* McpCredentialBindingStore.Service
          const found = yield* store.get({ serverName: "git" })
          if (!found) throw new Error("not found")
          const revoked = yield* store.revoke(found.id, found.bindingRevision)
          expect(revoked.revokedAt).toBeDefined()
          const after = yield* store.resolve({ serverName: "git", credentialRef: "cred_cross" }).pipe(Effect.exit)
          expectCrossLocation(after)
        }).pipe(Effect.provide(makeStore({ directory: "/tmp/cross-a" })))
      }),
  )

  it.effect("resolve fails with CrossLocationRefError when ref not bound in this Location", () =>
    Effect.gen(function* () {
      const store = yield* McpCredentialBindingStore.Service
      yield* store.bind({ serverName: "git", credentialRef: "cred_ok" })
      const missing = yield* store.resolve({ serverName: "git", credentialRef: "cred_missing" }).pipe(Effect.exit)
      expectCrossLocation(missing)
      const wrongServer = yield* store.resolve({ serverName: "other", credentialRef: "cred_ok" }).pipe(Effect.exit)
      expectCrossLocation(wrongServer)
    }).pipe(Effect.provide(makeStore({ directory: "/tmp/resolve" }))),
  )

  it.effect("revoke succeeds, second revoke fails already_revoked, wrong revision fails revision_mismatch", () =>
    Effect.gen(function* () {
      const store = yield* McpCredentialBindingStore.Service
      const b = yield* store.bind({ serverName: "srv", credentialRef: "cred_abc" })
      const revoked = yield* store.revoke(b.id, b.bindingRevision)
      expect(revoked.revokedAt).toBeDefined()
      const again = yield* store.revoke(b.id, revoked.bindingRevision).pipe(Effect.exit)
      expectStateError(again, "already_revoked")
      const stale = yield* store.revoke(b.id, b.bindingRevision).pipe(Effect.exit)
      expectStateError(stale, "revision_mismatch")
      const after = yield* store.get({ serverName: "srv" })
      expect(after).toBeUndefined()
    }).pipe(Effect.provide(makeStore({ directory: "/tmp/revoke" }))),
  )

  it.effect("lookupFilter is the production predicate (EXPLAIN uses the unique index)", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const filter = McpCredentialBindingStore.lookupFilter({ directory: "/tmp/x", serverName: "git" })
      const { McpCredentialBindingTable } = yield* Effect.promise(() => import("@aigcfroge/core/mcp/binding/sql"))
      const query = db.select().from(McpCredentialBindingTable).where(filter)
      const { sql: text } = query.toSQL()
      const plan = yield* db.all<{ detail: string }>(sql.raw(`EXPLAIN QUERY PLAN ${text.replaceAll("?", "'x'")}`))
      const details = plan.map((r) => r.detail)
      expect(details.some((d) => d.includes("mcp_binding_directory_workspace_server_idx"))).toBe(true)
      expect(details.some((d) => d.includes("SCAN mcp_credential_binding"))).toBe(false)
    }),
  )

  it.effect("rebind after revoke succeeds and restores active binding", () =>
    Effect.gen(function* () {
      const store = yield* McpCredentialBindingStore.Service
      const b = yield* store.bind({ serverName: "git", credentialRef: "cred_old" })
      const revoked = yield* store.revoke(b.id, b.bindingRevision)
      expect(revoked.revokedAt).toBeDefined()
      const rebound = yield* store.rebind(revoked.id, revoked.bindingRevision, "cred_new")
      expect(rebound.credentialRef).toBe("cred_new")
      expect(rebound.revokedAt).toBeUndefined()
      const fetched = yield* store.get({ serverName: "git" })
      expect(fetched?.credentialRef).toBe("cred_new")
    }).pipe(Effect.provide(makeStore({ directory: "/tmp/rebind" }))),
  )

  it.effect("rebind on an ACTIVE binding fails not_revoked (never a silent credential swap)", () =>
    Effect.gen(function* () {
      const store = yield* McpCredentialBindingStore.Service
      const b = yield* store.bind({ serverName: "git", credentialRef: "cred_active" })
      const swap = yield* store.rebind(b.id, b.bindingRevision, "cred_swapped").pipe(Effect.exit)
      expectStateError(swap, "not_revoked")
      const still = yield* store.get({ serverName: "git" })
      expect(still?.credentialRef).toBe("cred_active")
      expect(still?.bindingRevision).toBe(b.bindingRevision)
    }).pipe(Effect.provide(makeStore({ directory: "/tmp/rebind-active" }))),
  )

  it.effect("rebind with a stale revision fails revision_mismatch, not not_revoked", () =>
    Effect.gen(function* () {
      const store = yield* McpCredentialBindingStore.Service
      const b = yield* store.bind({ serverName: "git", credentialRef: "cred_old" })
      const revoked = yield* store.revoke(b.id, b.bindingRevision)
      const stale = yield* store.rebind(revoked.id, b.bindingRevision, "cred_new").pipe(Effect.exit)
      expectStateError(stale, "revision_mismatch")
      const untouched = yield* store.getById(revoked.id)
      expect(untouched?.credentialRef).toBe("cred_old")
      expect(untouched?.revokedAt).toBeDefined()
    }).pipe(Effect.provide(makeStore({ directory: "/tmp/rebind-stale" }))),
  )

  it.effect("rebindFilter carries the revoked-state race guard into the UPDATE", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const { McpCredentialBindingTable } = yield* Effect.promise(() => import("@aigcfroge/core/mcp/binding/sql"))
      const { sql: text } = db
        .update(McpCredentialBindingTable)
        .set({ credential_ref: "cred_x" })
        .where(McpCredentialBindingStore.rebindFilter({ id: "mcb_x", expectedRevision: 2 }))
        .toSQL()
      const where = text.slice(text.indexOf(" where "))
      expect(where).toContain('"id" = ?')
      expect(where).toContain('"binding_revision" = ?')
      expect(where).toContain('"revoked_at" is not null')
    }),
  )
})
