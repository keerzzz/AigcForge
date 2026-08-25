export * as SessionComposition from "./composition"

import { Context, Effect, Layer, Schema } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "../database/database"
import { Composition } from "@aigcfroge/schema/composition"
import { computeDigest } from "../composition/digest"
import type { SessionSchema } from "./schema"
import { SessionCompositionSnapshotTable } from "./sql"

export class SnapshotNotFoundError extends Schema.TaggedErrorClass<SnapshotNotFoundError>()(
  "SessionComposition.SnapshotNotFoundError",
  {
    sessionID: Schema.String,
  },
) {}

export class SnapshotDecodeError extends Schema.TaggedErrorClass<SnapshotDecodeError>()(
  "SessionComposition.SnapshotDecodeError",
  {
    sessionID: Schema.String,
    details: Schema.String,
  },
) {}

export class SnapshotAlreadyExistsError extends Schema.TaggedErrorClass<SnapshotAlreadyExistsError>()(
  "SessionComposition.SnapshotAlreadyExistsError",
  {
    sessionID: Schema.String,
  },
) {}

export class AgentDelegationForbiddenError extends Schema.TaggedErrorClass<AgentDelegationForbiddenError>()(
  "SessionComposition.AgentDelegationForbiddenError",
  {
    sessionID: Schema.String,
    agentID: Schema.String,
    allowedAgentID: Schema.optional(Schema.String),
  },
) {}

export class DependencyMissingError extends Schema.TaggedErrorClass<DependencyMissingError>()(
  "SessionComposition.DependencyMissingError",
  {
    sessionID: Schema.String,
    reason: Schema.String,
    details: Schema.optional(Schema.String),
  },
) {}

export interface Interface {
  readonly attach: (
    sessionID: SessionSchema.ID,
    snapshot: Composition.Snapshot,
  ) => Effect.Effect<void, SnapshotAlreadyExistsError>
  readonly read: (
    sessionID: SessionSchema.ID,
  ) => Effect.Effect<Composition.Snapshot | undefined, SnapshotDecodeError>
  readonly get: (
    sessionID: SessionSchema.ID,
  ) => Effect.Effect<Composition.Snapshot, SnapshotNotFoundError | SnapshotDecodeError>
  readonly exists: (sessionID: SessionSchema.ID) => Effect.Effect<boolean>
  readonly copy: (
    sourceSessionID: SessionSchema.ID,
    targetSessionID: SessionSchema.ID,
  ) => Effect.Effect<Composition.Snapshot, SnapshotNotFoundError | SnapshotDecodeError | SnapshotAlreadyExistsError>
  readonly assertAgentAllowed: (
    sessionID: SessionSchema.ID,
    agentID: string,
  ) => Effect.Effect<void, SnapshotNotFoundError | SnapshotDecodeError | AgentDelegationForbiddenError>
  readonly assertDependency: (
    sessionID: SessionSchema.ID,
  ) => Effect.Effect<Composition.Snapshot, SnapshotNotFoundError | SnapshotDecodeError | DependencyMissingError>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/SessionComposition") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const exists = Effect.fn("SessionComposition.exists")(function* (sessionID: SessionSchema.ID) {
      const row = yield* db
        .select({ sessionID: SessionCompositionSnapshotTable.session_id })
        .from(SessionCompositionSnapshotTable)
        .where(eq(SessionCompositionSnapshotTable.session_id, sessionID))
        .get()
        .pipe(Effect.orDie)
      return row !== undefined
    })

    const read = Effect.fn("SessionComposition.read")(function* (sessionID: SessionSchema.ID) {
      const row = yield* db
        .select()
        .from(SessionCompositionSnapshotTable)
        .where(eq(SessionCompositionSnapshotTable.session_id, sessionID))
        .get()
        .pipe(
          Effect.catch((err) =>
            Effect.fail(
              new SnapshotDecodeError({
                sessionID,
                details: `Failed to read snapshot from database: ${String(err)}`,
              }),
            ),
          ),
        )

      if (!row) return undefined

      if (row.version !== 1 && row.version !== 2) {
        return yield* new SnapshotDecodeError({
          sessionID,
          details: `Unsupported snapshot version: ${row.version}`,
        })
      }

      const digest = yield* Schema.decodeUnknownEffect(Composition.Digest)(row.digest).pipe(
        Effect.mapError(
          (error) =>
            new SnapshotDecodeError({
              sessionID,
              details: `Invalid snapshot digest: ${row.digest} (${String(error)})`,
            }),
        ),
      )

      let profileRevision: Composition.Revision | undefined
      if (row.profile_revision) {
        profileRevision = yield* Schema.decodeUnknownEffect(Composition.Revision)(row.profile_revision).pipe(
          Effect.mapError(
            (error) =>
              new SnapshotDecodeError({
                sessionID,
                details: `Invalid profile revision: ${row.profile_revision} (${String(error)})`,
              }),
          ),
        )
      }

      if (row.version === 1) {
        const decodedData = yield* Schema.decodeUnknownEffect(Composition.SnapshotDataV1)(row.data).pipe(
          Effect.mapError(
            (error) =>
              new SnapshotDecodeError({
                sessionID,
                details: `Failed to decode snapshot v1 data: ${String(error)}`,
              }),
          ),
        )
        return new Composition.SnapshotV1({
          version: 1,
          digest,
          sessionID: row.session_id,
          profilePath: row.profile_path ?? undefined,
          profileRevision,
          createdAt: row.time_created,
          data: decodedData,
        })
      }

      const decodedData = yield* Schema.decodeUnknownEffect(Composition.SnapshotDataV2)(row.data).pipe(
        Effect.mapError(
          (error) =>
            new SnapshotDecodeError({
              sessionID,
              details: `Failed to decode snapshot v2 data: ${String(error)}`,
            }),
        ),
      )
      return new Composition.SnapshotV2({
        version: 2,
        digest,
        sessionID: row.session_id,
        profilePath: row.profile_path ?? undefined,
        profileRevision,
        createdAt: row.time_created,
        data: decodedData,
      })
    })

    const get = Effect.fn("SessionComposition.get")(function* (sessionID: SessionSchema.ID) {
      const snapshot = yield* read(sessionID)
      if (!snapshot) {
        return yield* new SnapshotNotFoundError({ sessionID })
      }
      return snapshot
    })

    const attach = Effect.fn("SessionComposition.attach")(function* (
      sessionID: SessionSchema.ID,
      snapshot: Composition.Snapshot,
    ) {
      const alreadyExists = yield* exists(sessionID)
      if (alreadyExists) {
        yield* new SnapshotAlreadyExistsError({ sessionID })
      }

      yield* db
        .insert(SessionCompositionSnapshotTable)
        .values({
          session_id: sessionID,
          version: snapshot.version,
          digest: snapshot.digest,
          profile_path: snapshot.profilePath ?? null,
          profile_revision: snapshot.profileRevision ?? null,
          data: snapshot.data,
          time_created: snapshot.createdAt,
        })
        .run()
        .pipe(Effect.orDie)
    })

    const copy = Effect.fn("SessionComposition.copy")(function* (
      sourceSessionID: SessionSchema.ID,
      targetSessionID: SessionSchema.ID,
    ) {
      const sourceSnapshot = yield* get(sourceSessionID)
      const targetSnapshot =
        sourceSnapshot.version === 1
          ? new Composition.SnapshotV1({
              version: 1,
              digest: sourceSnapshot.digest,
              sessionID: targetSessionID,
              profilePath: sourceSnapshot.profilePath,
              profileRevision: sourceSnapshot.profileRevision,
              createdAt: sourceSnapshot.createdAt,
              data: sourceSnapshot.data,
            })
          : new Composition.SnapshotV2({
              version: 2,
              digest: sourceSnapshot.digest,
              sessionID: targetSessionID,
              profilePath: sourceSnapshot.profilePath,
              profileRevision: sourceSnapshot.profileRevision,
              createdAt: sourceSnapshot.createdAt,
              data: sourceSnapshot.data,
            })

      yield* attach(targetSessionID, targetSnapshot)
      return targetSnapshot
    })

    const assertAgentAllowed = Effect.fn("SessionComposition.assertAgentAllowed")(function* (
      sessionID: SessionSchema.ID,
      agentID: string,
    ) {
      const snapshot = yield* get(sessionID)
      const allowed =
        snapshot.version === 1
          ? snapshot.data.agentID === agentID
          : snapshot.data.agents.some((a) => a.id === agentID || a.name === agentID)

      if (!allowed) {
        const allowedAgentID =
          snapshot.version === 1 ? snapshot.data.agentID : snapshot.data.agents.map((a) => a.id).join(", ")
        yield* new AgentDelegationForbiddenError({
          sessionID,
          agentID,
          allowedAgentID,
        })
      }
    })

    const assertDependency = Effect.fn("SessionComposition.assertDependency")(function* (
      sessionID: SessionSchema.ID,
    ) {
      const snapshot = yield* get(sessionID)
      const missing = (reason: string, details?: string) =>
        new DependencyMissingError({ sessionID, reason, ...(details !== undefined ? { details } : {}) })

      if (snapshot.version === 1) {
        if (snapshot.data.agentID.trim().length === 0) {
          return yield* missing("empty_agent_id", "snapshot data carries an empty agentID")
        }
      } else {
        if (snapshot.data.agents.length === 0) {
          return yield* missing("empty_agents", "snapshot data carries an empty agents list")
        }
      }
      const names = snapshot.data.tools.fingerprints.map((fingerprint) => fingerprint.name)
      if (!names.every((name, index) => index === 0 || names[index - 1].localeCompare(name) <= 0)) {
        return yield* missing(
          "unsorted_tool_fingerprints",
          `tool fingerprints are not sorted by name: ${JSON.stringify(names)}`,
        )
      }
      if (snapshot.data.tools.catalog.length === 0) {
        return yield* missing("empty_tool_catalog", "tool catalog is empty")
      }
      if (
        snapshot.data.tools.catalog.length !== names.length ||
        snapshot.data.tools.catalog.some((name, index) => name !== names[index])
      ) {
        return yield* missing(
          "tool_catalog_mismatch",
          `tool catalog ${JSON.stringify(snapshot.data.tools.catalog)} does not equal the sorted fingerprint names ${JSON.stringify(names)}`,
        )
      }
      // snapshot.digest is the PLAN digest, not a digest of snapshot.data; the
      // tool catalog is the one sub-structure with its own recomputable digest.
      const catalogDigest = computeDigest(snapshot.data.tools.fingerprints)
      if (catalogDigest !== snapshot.data.tools.catalogDigest) {
        return yield* missing(
          "tool_catalog_digest_mismatch",
          `recomputed catalog digest ${catalogDigest} does not match stored ${snapshot.data.tools.catalogDigest}`,
        )
      }
      if (snapshot.version === 2) {
        const catalogMcpTools = snapshot.data.tools.catalog.filter((name) => name.startsWith("mcp_"))
        const auditMcpTools = snapshot.data.mcp.tools
          .map((tool) => tool.canonicalName)
          .toSorted((a, b) => a.localeCompare(b))
        if (
          catalogMcpTools.length !== auditMcpTools.length ||
          catalogMcpTools.some((name, index) => name !== auditMcpTools[index])
        ) {
          return yield* missing(
            "mcp_audit_catalog_mismatch",
            `MCP catalog ${JSON.stringify(catalogMcpTools)} does not equal MCP audit tools ${JSON.stringify(auditMcpTools)}`,
          )
        }
        for (const tool of snapshot.data.mcp.tools) {
          const binding = snapshot.data.mcp.bindings.find(
            (entry) =>
              entry.serverName === tool.serverName &&
              entry.ref.relativePath === tool.ref.relativePath &&
              entry.ref.revision === tool.ref.revision,
          )
          if (binding !== undefined) continue
          return yield* missing(
            "mcp_audit_binding_missing",
            `MCP audit tool '${tool.canonicalName}' has no matching binding identity`,
          )
        }
      }
      return snapshot
    })

    return Service.of({
      attach,
      read,
      get,
      exists,
      copy,
      assertAgentAllowed,
      assertDependency,
    } satisfies Interface)
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))
