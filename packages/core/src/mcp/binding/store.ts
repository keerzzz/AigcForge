export * as McpCredentialBindingStore from "./store"

import { Context, Effect, Layer, Schema } from "effect"
import { and, eq, isNotNull, isNull } from "drizzle-orm"
import { McpScope } from "@aigcfroge/schema/mcp-scope"
import { Database } from "../../database/database"
import { EventV2 } from "../../event"
import { Location } from "../../location"
import { BindingEvent } from "./event"
import { McpCredentialBindingTable } from "./sql"

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("McpBinding.NotFoundError", {
  id: Schema.String,
}) {
  override get message() {
    return `MCP credential binding ${this.id} not found`
  }
}

export class StateError extends Schema.TaggedErrorClass<StateError>()("McpBinding.StateError", {
  id: Schema.String,
  reason: Schema.Literals(["already_revoked", "revision_mismatch", "duplicate", "not_revoked"]),
}) {
  override get message() {
    return `MCP credential binding ${this.id} rejected: ${this.reason}`
  }
}

export class CrossLocationRefError extends Schema.TaggedErrorClass<CrossLocationRefError>()(
  "McpBinding.CrossLocationRefError",
  { directory: Schema.String, serverName: Schema.String, credentialRef: Schema.String },
) {
  override get message() {
    return `Credential ref ${this.credentialRef} for server '${this.serverName}' not bound in location ${this.directory}`
  }
}

export class DanglingRefError extends Schema.TaggedErrorClass<DanglingRefError>()("McpBinding.DanglingRefError", {
  credentialRef: Schema.String,
}) {
  override get message() {
    return `Credential ${this.credentialRef} not found — binding is dangling and requires rebinding`
  }
}

export interface Info {
  readonly id: string
  readonly directory: string
  readonly workspaceID?: string
  readonly serverName: string
  readonly credentialRef: string
  readonly bindingRevision: number
  readonly revokedAt?: number
  readonly timeCreated: number
  readonly timeUpdated: number
}

type Row = typeof McpCredentialBindingTable.$inferSelect

const toInfoSafe = (row: Row | undefined): Info | undefined => {
  if (!row) return undefined
  try {
    const decoded = new McpScope.McpCredentialBinding({
      id: row.id,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      directory: row.directory as McpScope.McpCredentialBinding["directory"],
      workspaceID: row.workspace_id,
      serverName: row.server_name,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      credentialRef: row.credential_ref as McpScope.McpCredentialBinding["credentialRef"],
      bindingRevision: row.binding_revision,
      ...(row.revoked_at !== null ? { revokedAt: row.revoked_at } : {}),
      timeCreated: row.time_created,
      timeUpdated: row.time_updated,
    })
    return {
      id: decoded.id,
      directory: decoded.directory,
      ...(decoded.workspaceID !== "" ? { workspaceID: decoded.workspaceID } : {}),
      serverName: decoded.serverName,
      credentialRef: decoded.credentialRef,
      bindingRevision: decoded.bindingRevision,
      ...(decoded.revokedAt !== undefined ? { revokedAt: decoded.revokedAt } : {}),
      timeCreated: decoded.timeCreated,
      timeUpdated: decoded.timeUpdated,
    }
  } catch {
    return undefined
  }
}

const toInfo = (row: Row): Info => {
  const info = toInfoSafe(row)
  if (!info) throw new Error(`Corrupt binding row ${row.id}`)
  return info
}

const normalizeWorkspaceId = McpScope.normalizeWorkspaceId

/** Pure predicate for the unique active lookup — used for EXPLAIN assertions. */
export const lookupFilter = (input: { directory: string; workspaceID?: string; serverName: string }) =>
  and(
    eq(McpCredentialBindingTable.directory, input.directory),
    eq(McpCredentialBindingTable.workspace_id, normalizeWorkspaceId(input.workspaceID)),
    eq(McpCredentialBindingTable.server_name, input.serverName),
    isNull(McpCredentialBindingTable.revoked_at),
  )

/**
 * Pure CAS predicate for `rebind` (ADR-21 §2.3 v1.2). `revoked_at IS NOT NULL`
 * is the race guard: the pre-read cannot see a concurrent revoke→rebind, so the
 * revoked-state invariant has to travel with the UPDATE, not only with the
 * pre-check. It is unobservable in a single-threaded test, so it is asserted
 * structurally instead — see the `rebindFilter` case in the store test.
 */
export const rebindFilter = (input: { id: string; expectedRevision: number }) =>
  and(
    eq(McpCredentialBindingTable.id, input.id),
    eq(McpCredentialBindingTable.binding_revision, input.expectedRevision),
    isNotNull(McpCredentialBindingTable.revoked_at),
  )

export interface BindInput {
  readonly serverName: string
  readonly credentialRef: string
}

export interface GetInput {
  readonly serverName: string
}

interface Interface {
  readonly bind: (input: BindInput) => Effect.Effect<Info, StateError>
  readonly rebind: (
    id: string,
    expectedRevision: number,
    credentialRef: string,
  ) => Effect.Effect<Info, NotFoundError | StateError>
  readonly get: (input: GetInput) => Effect.Effect<Info | undefined>
  readonly getById: (id: string) => Effect.Effect<Info | undefined>
  readonly revoke: (id: string, expectedRevision: number) => Effect.Effect<Info, NotFoundError | StateError>
  /** Resolve and validate that the requested ref is bound in this Location. */
  readonly resolve: (
    input: GetInput & { readonly credentialRef: string },
  ) => Effect.Effect<Info, CrossLocationRefError | StateError>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/McpCredentialBindingStore") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service
    const location = yield* Location.Service

    const currentLocation = () => ({
      directory: location.directory,
      workspaceID: location.workspaceID as string | undefined,
    })

    const service = Service.of({
      bind: Effect.fn("McpBinding.bind")(function* (input: BindInput) {
        const id = "mcb_" + crypto.randomUUID().replaceAll("-", "")
        const now = Date.now()
        const { directory, workspaceID } = currentLocation()
        const ws = normalizeWorkspaceId(workspaceID)
        return yield* Effect.gen(function* () {
          yield* BindingEvent.publish(events, { bindingID: id, status: "active", revision: 1, timeUpdated: now }, () =>
            Effect.gen(function* () {
              const inserted = yield* db
                .insert(McpCredentialBindingTable)
                .values({
                  id,
                  directory,
                  workspace_id: ws,
                  server_name: input.serverName,
                  credential_ref: input.credentialRef,
                  binding_revision: 1,
                  revoked_at: null,
                })
                .onConflictDoNothing()
                .returning()
                .get()
                .pipe(Effect.orDie)
              return inserted !== undefined
            }),
          )
          const row = (yield* db
            .select()
            .from(McpCredentialBindingTable)
            .where(eq(McpCredentialBindingTable.id, id))
            .all()
            .pipe(Effect.orDie))[0]
          if (!row) return yield* Effect.die(new Error(`Binding ${id} not found after successful commit`))
          return toInfo(row)
        }).pipe(
          Effect.catch((error) => {
            if (error instanceof StateError) return Effect.fail(error)
            if (error instanceof BindingEvent.CommitRejected)
              return Effect.fail(new StateError({ id, reason: "duplicate" }))
            return Effect.die(error)
          }),
        )
      }),

      rebind: Effect.fn("McpBinding.rebind")(function* (id: string, expectedRevision: number, credentialRef: string) {
        const currentRaw = (yield* db
          .select()
          .from(McpCredentialBindingTable)
          .where(eq(McpCredentialBindingTable.id, id))
          .all()
          .pipe(Effect.orDie))[0]
        if (!currentRaw) return yield* new NotFoundError({ id })
        const current = toInfoSafe(currentRaw)
        if (!current) return yield* new NotFoundError({ id })
        if (current.bindingRevision !== expectedRevision)
          return yield* new StateError({ id, reason: "revision_mismatch" })
        if (current.revokedAt === undefined) return yield* new StateError({ id, reason: "not_revoked" })
        const nextRevision = current.bindingRevision + 1
        const now = Date.now()
        yield* BindingEvent.publish(
          events,
          { bindingID: id, status: "active", revision: nextRevision, timeUpdated: now },
          () =>
            Effect.gen(function* () {
              const updated = yield* db
                .update(McpCredentialBindingTable)
                .set({ credential_ref: credentialRef, revoked_at: null, binding_revision: nextRevision })
                .where(rebindFilter({ id, expectedRevision }))
                .returning()
                .get()
                .pipe(Effect.orDie)
              return updated !== undefined
            }),
        ).pipe(
          Effect.catch((error) => {
            if (error instanceof BindingEvent.CommitRejected)
              return Effect.fail(new StateError({ id, reason: "revision_mismatch" }))
            return Effect.die(error)
          }),
        )
        const updatedRaw = (yield* db
          .select()
          .from(McpCredentialBindingTable)
          .where(eq(McpCredentialBindingTable.id, id))
          .all()
          .pipe(Effect.orDie))[0]
        if (!updatedRaw) return yield* new NotFoundError({ id })
        const updated = toInfoSafe(updatedRaw)
        if (!updated) return yield* new NotFoundError({ id })
        return updated
      }),

      get: Effect.fn("McpBinding.get")(function* (input: GetInput) {
        const { directory, workspaceID } = currentLocation()
        const rows = yield* db
          .select()
          .from(McpCredentialBindingTable)
          .where(lookupFilter({ directory, workspaceID, serverName: input.serverName }))
          .all()
          .pipe(Effect.orDie)
        const info = toInfoSafe(rows[0])
        if (rows[0] && !info) yield* Effect.logWarning("MCP binding row failed to decode; skipping", { id: rows[0].id })
        return info
      }),

      getById: Effect.fn("McpBinding.getById")(function* (id: string) {
        const rows = yield* db
          .select()
          .from(McpCredentialBindingTable)
          .where(eq(McpCredentialBindingTable.id, id))
          .all()
          .pipe(Effect.orDie)
        const info = toInfoSafe(rows[0])
        if (rows[0] && !info) yield* Effect.logWarning("MCP binding row failed to decode; skipping", { id })
        return info
      }),

      revoke: Effect.fn("McpBinding.revoke")(function* (id: string, expectedRevision: number) {
        const currentRaw = (yield* db
          .select()
          .from(McpCredentialBindingTable)
          .where(eq(McpCredentialBindingTable.id, id))
          .all()
          .pipe(Effect.orDie))[0]
        if (!currentRaw) return yield* new NotFoundError({ id })
        const current = toInfoSafe(currentRaw)
        if (!current) return yield* new NotFoundError({ id })
        if (current.bindingRevision !== expectedRevision)
          return yield* new StateError({ id, reason: "revision_mismatch" })
        if (current.revokedAt !== undefined) return yield* new StateError({ id, reason: "already_revoked" })
        const nextRevision = current.bindingRevision + 1
        const now = Date.now()
        yield* BindingEvent.publish(
          events,
          { bindingID: id, status: "revoked", revision: nextRevision, timeUpdated: now },
          () =>
            Effect.gen(function* () {
              const updated = yield* db
                .update(McpCredentialBindingTable)
                .set({ revoked_at: now, binding_revision: nextRevision })
                .where(
                  and(
                    eq(McpCredentialBindingTable.id, id),
                    eq(McpCredentialBindingTable.binding_revision, expectedRevision),
                    isNull(McpCredentialBindingTable.revoked_at),
                  ),
                )
                .returning()
                .get()
                .pipe(Effect.orDie)
              return updated !== undefined
            }),
        ).pipe(
          Effect.catch((error) => {
            if (error instanceof BindingEvent.CommitRejected)
              return Effect.fail(new StateError({ id, reason: "revision_mismatch" }))
            return Effect.die(error)
          }),
        )
        const updatedRaw = (yield* db
          .select()
          .from(McpCredentialBindingTable)
          .where(eq(McpCredentialBindingTable.id, id))
          .all()
          .pipe(Effect.orDie))[0]
        if (!updatedRaw) return yield* new NotFoundError({ id })
        const updated = toInfoSafe(updatedRaw)
        if (!updated) return yield* new NotFoundError({ id })
        return updated
      }),

      resolve: Effect.fn("McpBinding.resolve")(function* (input: GetInput & { credentialRef: string }) {
        const { directory, workspaceID } = currentLocation()
        const rows = yield* db
          .select()
          .from(McpCredentialBindingTable)
          .where(
            and(
              lookupFilter({ directory, workspaceID, serverName: input.serverName }),
              eq(McpCredentialBindingTable.credential_ref, input.credentialRef),
            ),
          )
          .all()
          .pipe(Effect.orDie)
        const row = rows[0]
        if (!row)
          return yield* new CrossLocationRefError({
            directory,
            serverName: input.serverName,
            credentialRef: input.credentialRef,
          })
        const info = toInfoSafe(row)
        if (!info)
          return yield* new CrossLocationRefError({
            directory,
            serverName: input.serverName,
            credentialRef: input.credentialRef,
          })
        return info
      }),
    })

    return service
  }),
)

/**
 * Database/EventV2/Location are requirements, not provided here — the Location
 * composition owns the shared instances, so this layer must resolve them
 * from the ambient context rather than build its own. Never reintroduce
 * `Layer.provideMerge(Database…)` here; it would shadow the shared
 * instance (Phase D regression).
 */
export const locationLayer = layer
