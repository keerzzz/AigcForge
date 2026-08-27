export * as ScopedGrantStore from "./store"

import { Cause, Context, Duration, Effect, Layer, Schedule, Schema } from "effect"
import { and, eq, gte, isNull, isNotNull, lt, lte, or } from "drizzle-orm"
import { Composition } from "@aigcfroge/schema/composition"
import { McpScope } from "@aigcfroge/schema/mcp-scope"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { Location } from "../location"
import { Wildcard } from "../util/wildcard"
import { GrantEvent, type CommitRejected } from "./event"
import { ScopedGrantTable } from "./sql"

export type GrantStatus = "active" | "consumed" | "revoked" | "expired"

/** Settled grant history is retained for 30 days by default. Callers may pass a shorter window to prune/list. */
export const DEFAULT_SETTLED_GRANT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000
/** Retention pruning runs once immediately, then once per hour per Location owner Scope. */
export const SETTLED_GRANT_PRUNE_INTERVAL = Duration.hours(1)

export type Info = typeof McpScope.ScopedGrantInfo.Type

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

export type ListInput = {
  readonly sessionID?: string
  readonly agent?: string
  readonly status?: GrantStatus
  readonly since?: number
  readonly until?: number
  readonly retentionMs?: number
  readonly now?: number
}

export type PruneInput = {
  readonly retentionMs?: number
  readonly now?: number
}

type Row = typeof ScopedGrantTable.$inferSelect

const normalizeWorkspaceId = McpScope.normalizeWorkspaceId

export type LocationInput = {
  readonly directory: string
  readonly workspaceID?: string
}

export const locationFilter = (input: LocationInput) =>
  and(
    eq(ScopedGrantTable.directory, input.directory),
    eq(ScopedGrantTable.workspace_id, normalizeWorkspaceId(input.workspaceID)),
  )

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
const toInfoSafe = (row: Row | undefined, now = Date.now()): Info | undefined => {
  if (!row) return undefined
  if (row.asset_revision !== null && decodeRevision(row.asset_revision) === undefined) {
    return undefined
  }
  return toInfo(row, now)
}

/**
 * Decode inside the Effect so a skipped row is reported rather than silently
 * dropped — the log stays on the caller's fiber instead of a detached one.
 */
const decodeRow = (row: Row | undefined, now = Date.now()) =>
  Effect.gen(function* () {
    if (!row) return undefined
    const info = toInfoSafe(row, now)
    if (!info) yield* Effect.logWarning("Scoped grant row failed to decode; skipping", { grantID: row.id })
    return info
  })

const toInfo = (row: Row, now = Date.now()): Info => {
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
  return new McpScope.ScopedGrantInfo({
    grant,
    status:
      row.revoked_at !== null
        ? "revoked"
        : row.consumed_at !== null
          ? "consumed"
          : isExpired(row, now)
            ? "expired"
            : "active",
    ...(row.consumed_at !== null ? { consumedAt: row.consumed_at } : {}),
    grantRevision: row.grant_revision,
  })
}

const isExpired = (row: Row, now: number) => row.expires_at !== null && row.expires_at <= now

/** Retention cutoff shared by `list` and `prune` so both agree on "in window". */
export const retentionCutoff = (now: number, retentionMs?: number) =>
  now - Math.max(0, retentionMs ?? DEFAULT_SETTLED_GRANT_RETENTION_MS)

/**
 * The `list` read filter as one exported pure builder, so a query-plan assertion
 * can run against the *same* predicate production uses. Hand-copying it into the
 * test would let a future edit silently stop using
 * `scoped_grant_session_issued_idx` / `scoped_grant_level_issued_idx` while the
 * EXPLAIN test stayed green on the stale copy.
 *
 * Window rule: a settled row is in-window when its latest transition is at or
 * after `cutoff`; an unsettled row is in-window unless it expired before
 * `cutoff`. Wildcard action/resource matching stays in JS — it cannot be pushed
 * into SQL; `findValid` splits the same way.
 */
export const listFilter = (input: ListInput, cutoff: number, location: LocationInput) =>
  and(
    locationFilter(location),
    ...(input.sessionID !== undefined
      ? [or(eq(ScopedGrantTable.session_id, input.sessionID), eq(ScopedGrantTable.level, "location"))]
      : []),
    ...(input.agent !== undefined ? [or(isNull(ScopedGrantTable.agent), eq(ScopedGrantTable.agent, input.agent))] : []),
    ...(input.since !== undefined ? [gte(ScopedGrantTable.issued_at, input.since)] : []),
    ...(input.until !== undefined ? [lte(ScopedGrantTable.issued_at, input.until)] : []),
    or(
      and(
        isNull(ScopedGrantTable.consumed_at),
        isNull(ScopedGrantTable.revoked_at),
        isNull(ScopedGrantTable.expires_at),
      ),
      and(
        isNull(ScopedGrantTable.consumed_at),
        isNull(ScopedGrantTable.revoked_at),
        isNotNull(ScopedGrantTable.expires_at),
        gte(ScopedGrantTable.expires_at, cutoff),
      ),
      and(
        or(isNotNull(ScopedGrantTable.consumed_at), isNotNull(ScopedGrantTable.revoked_at)),
        or(
          and(isNotNull(ScopedGrantTable.consumed_at), gte(ScopedGrantTable.consumed_at, cutoff)),
          and(isNotNull(ScopedGrantTable.revoked_at), gte(ScopedGrantTable.revoked_at, cutoff)),
        ),
      ),
    ),
  )

export interface Interface {
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
  /** Returns active rows and settled rows inside the bounded history window. */
  readonly list: (input?: ListInput) => Effect.Effect<ReadonlyArray<Info>>
  /** Deletes only settled rows older than the bounded history window. */
  readonly prune: (input?: PruneInput) => Effect.Effect<void>
  /**
   * Live consultation (ADR-20 §2.2/§2.3): expiry/revocation/consumption are
   * evaluated against the store on every call; no cached copy exists.
   */
  readonly findValid: (input: ConsultInput) => Effect.Effect<Info | undefined>
  /** Marks a `once` grant consumed. Concurrent consumers: exactly one wins. */
  readonly consume: (id: string) => Effect.Effect<Info, NotFoundError | StateError | CommitRejected>
  /** Revokes under CAS; 0 affected rows raises instead of returning quietly. */
  readonly revoke: (
    id: string,
    expectedRevision: number,
  ) => Effect.Effect<Info, NotFoundError | StateError | CommitRejected>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/ScopedGrantStore") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service
    const location = yield* Location.Service
    const currentLocation = () => ({ directory: location.directory, workspaceID: location.workspaceID })

    const service = Service.of({
      issue: Effect.fn("ScopedGrantStore.issue")(function* (input) {
        const id = input.id ?? "grt_" + crypto.randomUUID().replaceAll("-", "")
        const now = Date.now()
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
        yield* GrantEvent.publish(events, { grantID: id, status: "active", revision: 1, timeUpdated: now }, (tx) =>
          Effect.gen(function* () {
            yield* tx
              .insert(ScopedGrantTable)
              .values({
                id,
                directory: location.directory,
                workspace_id: normalizeWorkspaceId(location.workspaceID),
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
              .run()
              .pipe(Effect.orDie)
            return true
          }),
        )
        return new McpScope.ScopedGrantInfo({ grant, status: "active", grantRevision: 1 })
      }),

      get: Effect.fn("ScopedGrantStore.get")(function* (id) {
        const rows = yield* db
          .select()
          .from(ScopedGrantTable)
          .where(and(eq(ScopedGrantTable.id, id), locationFilter(currentLocation())))
          .all()
          .pipe(Effect.orDie)
        return yield* decodeRow(rows[0])
      }),

      list: Effect.fn("ScopedGrantStore.list")(function* (input: ListInput = {}) {
        const now = input.now ?? Date.now()
        const rows = yield* db
          .select()
          .from(ScopedGrantTable)
          .where(listFilter(input, retentionCutoff(now, input.retentionMs), currentLocation()))
          .all()
          .pipe(Effect.orDie)
        const filtered = rows.toSorted((a, b) => b.issued_at - a.issued_at)
        const result: Info[] = []
        for (const row of filtered) {
          const info = yield* decodeRow(row, now)
          if (info && (input.status === undefined || info.status === input.status)) result.push(info)
        }
        return result
      }),

      prune: Effect.fn("ScopedGrantStore.prune")(function* (input: PruneInput = {}) {
        const cutoff = retentionCutoff(input.now ?? Date.now(), input.retentionMs)
        yield* db
          .delete(ScopedGrantTable)
          .where(
            and(
              locationFilter(currentLocation()),
              or(
                and(
                  isNull(ScopedGrantTable.consumed_at),
                  isNull(ScopedGrantTable.revoked_at),
                  isNotNull(ScopedGrantTable.expires_at),
                  lt(ScopedGrantTable.expires_at, cutoff),
                ),
                and(
                  or(isNotNull(ScopedGrantTable.consumed_at), isNotNull(ScopedGrantTable.revoked_at)),
                  or(isNull(ScopedGrantTable.consumed_at), lt(ScopedGrantTable.consumed_at, cutoff)),
                  or(isNull(ScopedGrantTable.revoked_at), lt(ScopedGrantTable.revoked_at, cutoff)),
                ),
              ),
            ),
          )
          .run()
          .pipe(Effect.orDie)
      }),

      findValid: Effect.fn("ScopedGrantStore.findValid")(function* (input) {
        const now = Date.now()
        // Status predicate belongs in SQL; action/resource matching cannot,
        // because a grant may carry a wildcard pattern rather than a literal.
        const rows = yield* db
          .select()
          .from(ScopedGrantTable)
          .where(
            and(
              locationFilter(currentLocation()),
              isNull(ScopedGrantTable.consumed_at),
              isNull(ScopedGrantTable.revoked_at),
            ),
          )
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
        const current = yield* db
          .select()
          .from(ScopedGrantTable)
          .where(and(eq(ScopedGrantTable.id, id), locationFilter(currentLocation())))
          .all()
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
          (tx) =>
            Effect.gen(function* () {
              const updated = yield* tx
                .update(ScopedGrantTable)
                .set({ consumed_at: now, grant_revision: nextRevision })
                .where(
                  and(
                    eq(ScopedGrantTable.id, id),
                    locationFilter(currentLocation()),
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
        const updated = (yield* db
          .select()
          .from(ScopedGrantTable)
          .where(and(eq(ScopedGrantTable.id, id), locationFilter(currentLocation())))
          .all()
          .pipe(Effect.orDie))[0]
        return (yield* decodeRow(updated)) ?? (yield* new NotFoundError({ grantID: id }))
      }),

      revoke: Effect.fn("ScopedGrantStore.revoke")(function* (id, expectedRevision) {
        const current = yield* db
          .select()
          .from(ScopedGrantTable)
          .where(and(eq(ScopedGrantTable.id, id), locationFilter(currentLocation())))
          .all()
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
          (tx) =>
            Effect.gen(function* () {
              const updated = yield* tx
                .update(ScopedGrantTable)
                .set({ revoked_at: now, grant_revision: nextRevision })
                .where(
                  and(
                    eq(ScopedGrantTable.id, id),
                    locationFilter(currentLocation()),
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
        const updated = (yield* db
          .select()
          .from(ScopedGrantTable)
          .where(and(eq(ScopedGrantTable.id, id), locationFilter(currentLocation())))
          .all()
          .pipe(Effect.orDie))[0]
        return (yield* decodeRow(updated)) ?? (yield* new NotFoundError({ grantID: id }))
      }),
    })

    return service
  }),
)

export const cleanupLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* Service
    yield* store.prune().pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("Scoped grant retention cleanup failed", { source: "scheduled_prune", cause }),
      ),
      Effect.repeat(Schedule.spaced(SETTLED_GRANT_PRUNE_INTERVAL)),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
)

/**
 * Database/EventV2 are **requirements**, not provided here: the Location
 * composition already owns the shared instances, so this layer must resolve
 * them from the ambient context rather than build its own.
 *
 * Never reintroduce `Layer.provideMerge(Database…)` here. Merging re-exports
 * Database/EventV2 into the consuming composition, and because the Location
 * lookup ends in `Layer.fresh` that export is a *second* in-memory SQLite which
 * then shadows the shared instance — writes and reads land in different
 * databases (observed in Phase D: session tasks read back as `[]` plus
 * "task is not owned by session" 500s across 9 instance HTTP tests). Sibling
 * modules (`permission/saved.ts`, `session/task.ts`) follow the same rule.
 *
 * Guarded by `test/scoped-grant-store.test.ts`
 * "uses the Location-provided Database and EventV2 instances".
 */
export const locationLayer = Layer.merge(layer, cleanupLayer.pipe(Layer.provide(layer)))
