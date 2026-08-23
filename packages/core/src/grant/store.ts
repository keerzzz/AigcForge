export * as ScopedGrantStore from "./store"

import { Context, Effect, Layer, Schema } from "effect"
import { and, eq, isNull, isNotNull, lte, or } from "drizzle-orm"
import { Composition } from "@aigcfroge/schema/composition"
import { McpScope } from "@aigcfroge/schema/mcp-scope"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { Wildcard } from "../util/wildcard"
import { GrantEvent, type CommitRejected } from "./event"
import { ScopedGrantTable } from "./sql"

export type GrantStatus = "active" | "consumed" | "revoked"

export interface Info {
  readonly grant: McpScope.ScopedGrant
  readonly status: GrantStatus
  readonly consumedAt?: number
  /** CAS counter for state transitions (ADR-20 §2.4); not the asset revision. */
  readonly grantRevision: number
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("ScopedGrant.NotFoundError", {
  grantID: Schema.String,
}) {
  override get message() {
    return `Scoped grant ${this.grantID} not found`
  }
}

/** Typed failure for a denied transition: wrong CAS revision or already-settled state. */
export class StateError extends Schema.TaggedErrorClass<StateError>()("ScopedGrant.StateError", {
  grantID: Schema.String,
  reason: Schema.Literals(["already_consumed", "already_revoked", "expired", "revision_mismatch"]),
}) {
  override get message() {
    return `Scoped grant ${this.grantID} rejected transition: ${this.reason}`
  }
}

export type ConsultInput = {
  readonly action: string
  readonly resources: ReadonlyArray<string>
  readonly sessionID?: string
  readonly agent?: string
  readonly snapshotRevision?: string
}

type Row = typeof ScopedGrantTable.$inferSelect

const decodeRevision = (value: string): McpScope.ScopedGrant["revision"] | undefined => {
  try {
    return Schema.decodeUnknownSync(Composition.Revision)(value)
  } catch {
    return undefined
  }
}

/**
 * Tolerant row decode: a missing row and a corrupt row both yield `undefined`
 * rather than a defect. `rows[0]` is `Row | undefined` at every call site (the
 * repo does not enable `noUncheckedIndexedAccess`), and the settled-row sweep
 * makes "look up a grant that is already gone" an ordinary path.
 */
const toInfoSafe = (row: Row | undefined): Info | undefined => {
  if (!row) return undefined
  if (row.asset_revision !== null && decodeRevision(row.asset_revision) === undefined) {
    return undefined
  }
  return toInfo(row)
}

/**
 * Decode inside the Effect so a skipped row is reported rather than silently
 * dropped — the log stays on the caller's fiber instead of a detached one.
 */
const decodeRow = (row: Row | undefined) =>
  Effect.gen(function* () {
    if (!row) return undefined
    const info = toInfoSafe(row)
    if (!info)
      yield* Effect.logWarning("Scoped grant row failed to decode; skipping", { grantID: row.id })
    return info
  })

const toInfo = (row: Row): Info => {
  const grant = new McpScope.ScopedGrant({
    id: row.id,
    scope:
      row.level === "session"
        ? { level: "session", sessionID: row.session_id ?? "" }
        : row.level === "location"
          ? { level: "location" }
          : { level: "once" },
    action: row.action,
    resources: row.resources,
    effect: "allow",
    ...(row.agent ? { agent: row.agent } : {}),
    ...(row.asset_revision !== null
        ? { revision: Schema.decodeUnknownSync(Composition.Revision)(row.asset_revision) }
        : {}),
    issuedAt: row.issued_at,
    ...(row.expires_at !== null ? { expiresAt: row.expires_at } : {}),
    ...(row.revoked_at !== null ? { revokedAt: row.revoked_at } : {}),
  })
  return {
    grant,
    status: row.revoked_at !== null ? "revoked" : row.consumed_at !== null ? "consumed" : "active",
    ...(row.consumed_at !== null ? { consumedAt: row.consumed_at } : {}),
    grantRevision: row.grant_revision,
  }
}

const isExpired = (row: Row, now: number) => row.expires_at !== null && row.expires_at <= now

interface Interface {
  /** Creates one active grant and publishes its durable creation event. */
  readonly issue: (input: {
    readonly scope: McpScope.ScopedGrant["scope"]
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly agent?: string
    readonly revision?: McpScope.ScopedGrant["revision"]
    readonly issuedAt?: number
    readonly expiresAt?: number
    readonly id?: string
  }) => Effect.Effect<Info, CommitRejected>
  readonly get: (id: string) => Effect.Effect<Info | undefined>
  /**
   * Live consultation (ADR-20 §2.2/§2.3): expiry/revocation/consumption are
   * evaluated against the store on every call; no cached copy exists.
   */
  readonly findValid: (input: ConsultInput) => Effect.Effect<Info | undefined>
  /** Marks a `once` grant consumed. Concurrent consumers: exactly one wins. */
  readonly consume: (id: string) => Effect.Effect<Info, NotFoundError | StateError | CommitRejected>
  /** Revokes under CAS; 0 affected rows raises instead of returning quietly. */
  readonly revoke: (id: string, expectedRevision: number) => Effect.Effect<Info, NotFoundError | StateError | CommitRejected>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/ScopedGrantStore") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service

        return Service.of({
      issue: Effect.fn("ScopedGrantStore.issue")(function* (input) {
        const id = input.id ?? "grt_" + crypto.randomUUID().replaceAll("-", "")
        const now = Date.now()
        // Live-state table: settled rows live on only as durable events. Sweep
        // them here so the table cannot grow without bound.
        yield* db
          .delete(ScopedGrantTable)
          .where(
            or(
              isNotNull(ScopedGrantTable.consumed_at),
              isNotNull(ScopedGrantTable.revoked_at),
              and(isNotNull(ScopedGrantTable.expires_at), lte(ScopedGrantTable.expires_at, now)),
            ),
          )
          .run()
          .pipe(Effect.orDie)
        const grant = new McpScope.ScopedGrant({
          id,
          scope: input.scope,
          action: input.action,
          resources: input.resources,
          effect: "allow",
          ...(input.agent !== undefined ? { agent: input.agent } : {}),
          ...(input.revision !== undefined ? { revision: input.revision } : {}),
          issuedAt: input.issuedAt ?? now,
          ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
        })
        yield* GrantEvent.publish(events, { grantID: id, status: "active", revision: 1, timeUpdated: now }, () =>
          Effect.gen(function* () {
            yield* db
              .insert(ScopedGrantTable)
              .values({
                id,
                level: grant.scope.level,
                session_id: grant.scope.level === "session" ? grant.scope.sessionID : null,
                action: grant.action,
                resources: [...grant.resources],
                agent: grant.agent ?? null,
                asset_revision: grant.revision ?? null,
                issued_at: grant.issuedAt,
                expires_at: grant.expiresAt ?? null,
                revoked_at: null,
                consumed_at: null,
                grant_revision: 1,
              })
              .run().pipe(Effect.orDie)
            return true
          }),
        )
        return { grant, status: "active" as const, grantRevision: 1 }
      }),

      get: Effect.fn("ScopedGrantStore.get")(function* (id) {
        const rows = yield* db.select().from(ScopedGrantTable).where(eq(ScopedGrantTable.id, id)).all()
          .pipe(Effect.orDie)
        return yield* decodeRow(rows[0])
      }),

      findValid: Effect.fn("ScopedGrantStore.findValid")(function* (input) {
        const now = Date.now()
        // Status predicate belongs in SQL; action/resource matching cannot,
        // because a grant may carry a wildcard pattern rather than a literal.
        const rows = yield* db
          .select()
          .from(ScopedGrantTable)
          .where(and(isNull(ScopedGrantTable.consumed_at), isNull(ScopedGrantTable.revoked_at)))
          .all()
          .pipe(Effect.orDie)
        const valid = rows
          .filter((row) => !isExpired(row, now))
          .filter((row) => (row.level === "session" ? row.session_id === input.sessionID : true))
          .filter((row) => (row.agent !== null ? row.agent === input.agent : true))
          .filter((row) =>
            row.asset_revision !== null ? row.asset_revision === (input.snapshotRevision ?? null) : true,
          )
          .filter(
            (row) =>
              Wildcard.match(input.action, row.action) &&
              input.resources.every((resource) => row.resources.some((pattern) => Wildcard.match(resource, pattern))),
          )
          .toSorted((a, b) => b.issued_at - a.issued_at)
        for (const row of valid) {
          const info = yield* decodeRow(row)
          if (info) return info
        }
        return undefined
      }),

      consume: Effect.fn("ScopedGrantStore.consume")(function* (id) {
        const current = yield* db.select().from(ScopedGrantTable).where(eq(ScopedGrantTable.id, id)).all()
          .pipe(Effect.orDie)
        const row = current[0]
        if (!row) return yield* new NotFoundError({ grantID: id })
        if (row.revoked_at !== null) return yield* new StateError({ grantID: id, reason: "already_revoked" })
        if (row.consumed_at !== null) return yield* new StateError({ grantID: id, reason: "already_consumed" })
        if (isExpired(row, Date.now())) return yield* new StateError({ grantID: id, reason: "expired" })
        const nextRevision = row.grant_revision + 1
        const now = Date.now()
        yield* GrantEvent.publish(
          events,
          { grantID: id, status: "consumed", revision: nextRevision, timeUpdated: now },
          () =>
            Effect.gen(function* () {
              const updated = yield* db
                .update(ScopedGrantTable)
                .set({ consumed_at: now, grant_revision: nextRevision })
                .where(
                  and(
                    eq(ScopedGrantTable.id, id),
                    isNull(ScopedGrantTable.consumed_at),
                    isNull(ScopedGrantTable.revoked_at),
                    eq(ScopedGrantTable.grant_revision, row.grant_revision),
                  ),
                )
                .returning()
                .get()
                .pipe(Effect.orDie)
              return updated !== undefined
            }),
        )
        const updated = (yield* db.select().from(ScopedGrantTable).where(eq(ScopedGrantTable.id, id)).all().pipe(Effect.orDie))[0]
        return (yield* decodeRow(updated)) ?? (yield* new NotFoundError({ grantID: id }))
      }),

      revoke: Effect.fn("ScopedGrantStore.revoke")(function* (id, expectedRevision) {
        const current = yield* db.select().from(ScopedGrantTable).where(eq(ScopedGrantTable.id, id)).all()
          .pipe(Effect.orDie)
        const row = current[0]
        if (!row) return yield* new NotFoundError({ grantID: id })
        if (row.grant_revision !== expectedRevision)
          return yield* new StateError({ grantID: id, reason: "revision_mismatch" })
        if (row.revoked_at !== null) return yield* new StateError({ grantID: id, reason: "already_revoked" })
        const nextRevision = row.grant_revision + 1
        const now = Date.now()
        yield* GrantEvent.publish(
          events,
          { grantID: id, status: "revoked", revision: nextRevision, timeUpdated: now },
          () =>
            Effect.gen(function* () {
              const updated = yield* db
                .update(ScopedGrantTable)
                .set({ revoked_at: now, grant_revision: nextRevision })
                .where(
                  and(
                    eq(ScopedGrantTable.id, id),
                    isNull(ScopedGrantTable.revoked_at),
                    eq(ScopedGrantTable.grant_revision, expectedRevision),
                  ),
                )
                .returning()
                .get()
                .pipe(Effect.orDie)
              return updated !== undefined
            }),
        )
        const updated = (yield* db.select().from(ScopedGrantTable).where(eq(ScopedGrantTable.id, id)).all().pipe(Effect.orDie))[0]
        return (yield* decodeRow(updated)) ?? (yield* new NotFoundError({ grantID: id }))
      }),
    })
  }),
)

/**
 * `provide`, not `provideMerge`: merging would re-export Database/EventV2 into
 * the consuming composition, and since the Location lookup is `Layer.fresh`
 * that export is a *second* in-memory SQLite instance which then shadows the
 * shared one from `LocationServiceMap` dependencies. Writes and reads land in
 * different databases (observed: session tasks read back as `[]` and
 * "task is not owned by session" 500s across the instance HTTP surface).
 * Every sibling module (`permission/saved.ts:87`, `session/task.ts:1102`) uses
 * `provide` for exactly this reason.
 */
export const locationLayer = layer.pipe(Layer.provide(Database.defaultLayer), Layer.provide(EventV2.defaultLayer))
