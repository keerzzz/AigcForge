export * as SessionComposition from "./composition"

import { Context, Effect, Layer, Option, Result, Schema } from "effect"
import { and, asc, eq, getTableColumns, inArray, sql } from "drizzle-orm"
import path from "path"
import { Agent } from "@omnixa/schema/agent"
import { Database } from "../database/database"
import { Composition } from "@omnixa/schema/composition"
import { AssetPlacement } from "@omnixa/schema/asset-placement"
import { makeGlobalNode } from "@omnixa/util/effect/app-node"
import { CompositionConsumerView } from "../composition/consumer-view"
import { CompositionDigest } from "../composition/digest"
import { CompositionReference } from "../composition/reference"
import { Location } from "../location"
import { EventTable } from "../event/sql"
import { SessionEvent } from "./event"
import { Event } from "@omnixa/schema/event"
import type { SessionSchema } from "./schema"
import type { ModelGroup } from "@omnixa/schema/model-group"
import { SessionCompositionSnapshotTable, SessionTable } from "./sql"

type QueryHandle = Pick<Database.Interface["db"], "insert">

// Decode JSON per snapshot so one corrupt row does not discard healthy references.
const snapshotFields = {
  ...getTableColumns(SessionCompositionSnapshotTable),
  data: sql<string>`${SessionCompositionSnapshotTable.data}`,
}

export class SnapshotNotFoundError extends Schema.TaggedError<SnapshotNotFoundError>()(
  "SessionComposition.SnapshotNotFoundError",
  {
    sessionID: Schema.String,
  },
) {}

export class SnapshotDecodeError extends Schema.TaggedError<SnapshotDecodeError>()(
  "SessionComposition.SnapshotDecodeError",
  {
    sessionID: Schema.String,
    details: Schema.String,
  },
) {}

export class SnapshotAlreadyExistsError extends Schema.TaggedError<SnapshotAlreadyExistsError>()(
  "SessionComposition.SnapshotAlreadyExistsError",
  {
    sessionID: Schema.String,
  },
) {}

export class AgentDelegationForbiddenError extends Schema.TaggedError<AgentDelegationForbiddenError>()(
  "SessionComposition.AgentDelegationForbiddenError",
  {
    sessionID: Schema.String,
    agentID: Schema.String,
    allowedAgentID: Schema.optional(Schema.String),
  },
) {}

export class DependencyMissingError extends Schema.TaggedError<DependencyMissingError>()(
  "SessionComposition.DependencyMissingError",
  {
    sessionID: Schema.String,
    reason: Schema.String,
    details: Schema.optional(Schema.String),
  },
) {}

export type Error = SnapshotNotFoundError | SnapshotDecodeError | DependencyMissingError | AgentDelegationForbiddenError

export interface Selection {
  readonly snapshot: Composition.SnapshotV2
  readonly scope: CompositionConsumerView.Scope
  readonly info: Agent.Info
}

export interface Interface {
  readonly references: (input: {
    readonly location: Location.Ref
    readonly kind: Composition.AllowedKind
    readonly path: string
    readonly target?: AssetPlacement.Target
    readonly includeLegacyLocation?: boolean
  }) => Effect.Effect<
    {
      readonly snapshots: ReadonlyArray<Composition.SnapshotReference>
      readonly snapshotsComplete: boolean
    },
    Composition.ResolveError
  >
  readonly attach: (
    sessionID: SessionSchema.ID,
    snapshot: Composition.Snapshot,
  ) => Effect.Effect<void, SnapshotAlreadyExistsError>
  readonly read: (sessionID: SessionSchema.ID) => Effect.Effect<Composition.Snapshot | undefined, SnapshotDecodeError>
  readonly get: (
    sessionID: SessionSchema.ID,
  ) => Effect.Effect<Composition.Snapshot, SnapshotNotFoundError | SnapshotDecodeError>
  readonly exists: (sessionID: SessionSchema.ID) => Effect.Effect<boolean>
  readonly updateGroupBehavior: (
    sessionID: SessionSchema.ID,
    groupBehavior?: ModelGroup.BehaviorSnapshot,
    agentID?: string,
  ) => Effect.Effect<void, SnapshotNotFoundError | SnapshotDecodeError | DependencyMissingError>
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
    frozen?: Composition.SnapshotV2,
  ) => Effect.Effect<Composition.SnapshotV2, SnapshotNotFoundError | SnapshotDecodeError | DependencyMissingError>
  readonly selectAgent: (
    sessionID: SessionSchema.ID,
    agentID: string,
    frozen?: Composition.SnapshotV2,
  ) => Effect.Effect<Selection, Error>
}

export class Service extends Context.Service<Service, Interface>()("@omnixa/v2/SessionComposition") {}

export const insertSnapshot = Effect.fn("SessionComposition.insertSnapshot")(function* (
  db: QueryHandle,
  sessionID: SessionSchema.ID,
  snapshot: Composition.Snapshot,
) {
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

export function bindGroupBehavior(
  snapshot: Composition.SnapshotV2,
  agentID: string,
  groupBehavior?: ModelGroup.BehaviorSnapshot,
) {
  const root = agentID === (snapshot.data.root?.id ?? "meta")
  return new Composition.SnapshotV2({
    ...snapshot,
    data: new Composition.SnapshotDataV2({
      ...snapshot.data,
      ...(root
        ? { groupBehavior }
        : {
            executors: snapshot.data.executors?.map((executor) =>
              executor.id === agentID ? new Composition.SnapshotExecutorData({ ...executor, groupBehavior }) : executor,
            ),
          }),
    }),
  })
}

export function groupBehaviorFor(snapshot: Composition.SnapshotV2, agentID: string) {
  if (agentID === (snapshot.data.root?.id ?? "meta")) return snapshot.data.groupBehavior
  return snapshot.data.executors?.find((executor) => executor.id === agentID)?.groupBehavior
}

const decodeSnapshot = Effect.fn("SessionComposition.decodeSnapshot")(function* (
  row: Omit<typeof SessionCompositionSnapshotTable.$inferSelect, "data"> & { readonly data: string },
) {
  if (row.version !== 1 && row.version !== 2) {
    return yield* new SnapshotDecodeError({
      sessionID: row.session_id,
      details: `Unsupported snapshot version: ${row.version}`,
    })
  }

  const digest = yield* Schema.decodeUnknownEffect(Composition.Digest)(row.digest).pipe(
    Effect.mapError(
      (error) =>
        new SnapshotDecodeError({
          sessionID: row.session_id,
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
            sessionID: row.session_id,
            details: `Invalid profile revision: ${row.profile_revision} (${String(error)})`,
          }),
      ),
    )
  }

  if (row.version === 1) {
    const decodedData = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Composition.SnapshotDataV1))(
      row.data,
    ).pipe(
      Effect.mapError(
        () =>
          new SnapshotDecodeError({
            sessionID: row.session_id,
            details: "Failed to decode snapshot v1 data",
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

  const decodedData = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Composition.SnapshotDataV2))(
    row.data,
  ).pipe(
    Effect.mapError(
      () =>
        new SnapshotDecodeError({
          sessionID: row.session_id,
          details: "Failed to decode snapshot v2 data",
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
        .select(snapshotFields)
        .from(SessionCompositionSnapshotTable)
        .where(eq(SessionCompositionSnapshotTable.session_id, sessionID))
        .get()
        .pipe(
          Effect.mapError(
            (err) =>
              new SnapshotDecodeError({
                sessionID,
                details: `Failed to read snapshot from database: ${String(err)}`,
              }),
          ),
        )

      if (!row) return undefined

      return yield* decodeSnapshot(row)
    })

    const references = Effect.fn("SessionComposition.references")(function* (input: {
      readonly location: Location.Ref
      readonly kind: Composition.AllowedKind
      readonly path: string
      readonly target?: AssetPlacement.Target
      readonly includeLegacyLocation?: boolean
    }) {
      if (input.target !== undefined && input.kind !== "prompt" && input.kind !== "skill" && input.kind !== "command")
        return yield* new Composition.ResolveError({
          code: "unsupported_reference_target",
          message: `Selected targets are unsupported for ${input.kind} references`,
        })
      const normalized = Result.try(() => CompositionReference.normalize(input.kind, input.path))
      if (Result.isFailure(normalized))
        return yield* new Composition.ResolveError({
          code: "invalid_reference_path",
          message: normalized.failure instanceof Error ? normalized.failure.message : String(normalized.failure),
        })

      const target = input.target ?? CompositionReference.legacyTarget(input.kind, input.location.directory)
      const includeLegacyLocation = input.includeLegacyLocation ?? input.target === undefined
      return yield* db
        .transaction(() =>
          Effect.gen(function* () {
            const rows = yield* db
              .select({ snapshot: snapshotFields, title: SessionTable.title })
              .from(SessionCompositionSnapshotTable)
              .innerJoin(SessionTable, eq(SessionTable.id, SessionCompositionSnapshotTable.session_id))
              .orderBy(asc(SessionCompositionSnapshotTable.session_id))
              .all()
              .pipe(Effect.orDie)
            const decoded = yield* Effect.forEach(rows, (row) =>
              decodeSnapshot(row.snapshot).pipe(
                Effect.map((snapshot) => ({ sessionID: row.snapshot.session_id, snapshot, title: row.title })),
                Effect.catchTag("SessionComposition.SnapshotDecodeError", () => Effect.succeed(undefined)),
              ),
            )
            const snapshots = new Map(decoded.flatMap((row) => (row ? [[row.sessionID, row] as const] : [])))
            const sources = new Map<string, Location.Ref | undefined>()
            const sourceFor = Effect.fnUntraced(function* (
              sessionID: SessionSchema.ID,
            ): Effect.fn.Return<Location.Ref | undefined> {
              if (sources.has(sessionID)) return sources.get(sessionID)
              // Reserve before following ancestry, so corrupt cycles cannot recurse forever.
              sources.set(sessionID, undefined)
              const snapshot = snapshots.get(sessionID)?.snapshot
              if (!snapshot) return undefined
              if (snapshot.data.sourceLocation !== undefined) {
                sources.set(sessionID, snapshot.data.sourceLocation)
                return snapshot.data.sourceLocation
              }
              // Lifecycle facts are optional in local deployments. Never substitute
              // the mutable Session directory or parse Tool placement as asset provenance.
              const event = yield* db
                .select({ type: EventTable.type, data: sql<string>`${EventTable.data}` })
                .from(EventTable)
                .where(
                  and(
                    eq(EventTable.aggregate_id, sessionID),
                    inArray(EventTable.type, [
                      Event.versionedType(SessionEvent.Created.type, SessionEvent.Created.durable.version),
                      Event.versionedType(SessionEvent.Forked.type, SessionEvent.Forked.durable.version),
                    ]),
                  ),
                )
                .orderBy(asc(EventTable.seq))
                .get()
                .pipe(Effect.orDie)
              if (!event) return undefined
              if (event.type === Event.versionedType(SessionEvent.Forked.type, SessionEvent.Forked.durable.version)) {
                const fork = Schema.decodeUnknownOption(Schema.fromJsonString(SessionEvent.Forked.data))(event.data)
                if (Option.isNone(fork) || fork.value.sessionID !== sessionID) return undefined
                const source = yield* sourceFor(fork.value.parentID)
                sources.set(sessionID, source)
                return source
              }
              const created = Schema.decodeUnknownOption(Schema.fromJsonString(SessionEvent.Created.data))(event.data)
              if (Option.isNone(created) || created.value.sessionID !== sessionID) return undefined
              const source =
                created.value.parentID !== undefined
                  ? yield* sourceFor(created.value.parentID)
                  : created.value.mode === "custom"
                    ? created.value.location
                    : undefined
              sources.set(sessionID, source)
              return source
            })
            let snapshotsComplete = decoded.every(
              (row) => row !== undefined && !(input.kind === "agent" && row.snapshot.version === 1),
            )
            const matches = new Array<Composition.SnapshotReference>()
            for (const row of snapshots.values()) {
              const candidates = CompositionReference.entries(row.snapshot, input.kind).filter(
                (candidate) =>
                  CompositionReference.matches(input.kind, normalized.success, candidate.relativePath) &&
                  (candidate.target === undefined
                    ? includeLegacyLocation || target === undefined || target.scope === "location"
                    : CompositionReference.matches(
                        input.kind,
                        normalized.success,
                        candidate.relativePath,
                        target,
                        candidate.target,
                      )),
              )
              if (candidates.length === 0) continue
              const source = yield* sourceFor(row.sessionID)
              if (source === undefined) {
                snapshotsComplete = false
                continue
              }
              if (source.workspaceID !== input.location.workspaceID) continue
              // Implicit queries retain saved Location membership across base aliases.
              const legacyTarget = CompositionReference.legacyTarget(input.kind, source.directory)
              if (
                !candidates.some(
                  (candidate) =>
                    (candidate.target !== undefined ||
                      path.resolve(source.directory) === path.resolve(input.location.directory)) &&
                    ((candidate.target === undefined && includeLegacyLocation) ||
                      CompositionReference.matches(
                        input.kind,
                        normalized.success,
                        candidate.relativePath,
                        target,
                        candidate.target ?? legacyTarget,
                      )),
                )
              )
                continue
              matches.push(
                new Composition.SnapshotReference({
                  sessionID: row.sessionID,
                  digest: row.snapshot.digest,
                  profilePath: row.snapshot.profilePath,
                  title: row.title ?? undefined,
                  createdAt: row.snapshot.createdAt,
                }),
              )
            }
            return { snapshots: matches, snapshotsComplete }
          }),
        )
        .pipe(Effect.orDie)
    })

    const get = Effect.fn("SessionComposition.get")(function* (sessionID: SessionSchema.ID) {
      const snapshot = yield* read(sessionID)
      if (!snapshot) {
        return yield* new SnapshotNotFoundError({ sessionID })
      }
      return snapshot
    })

    const updateGroupBehavior = Effect.fn("SessionComposition.updateGroupBehavior")(function* (
      sessionID: SessionSchema.ID,
      groupBehavior?: ModelGroup.BehaviorSnapshot,
      agentID?: string,
    ) {
      const snapshot = yield* get(sessionID)
      if (snapshot.version !== 2) {
        if (groupBehavior !== undefined)
          return yield* new DependencyMissingError({ sessionID, reason: "group_behavior_requires_snapshot_v2" })
        return
      }
      yield* db
        .update(SessionCompositionSnapshotTable)
        .set({
          data: bindGroupBehavior(snapshot, agentID ?? snapshot.data.root?.id ?? "meta", groupBehavior).data,
        })
        .where(eq(SessionCompositionSnapshotTable.session_id, sessionID))
        .run()
        .pipe(Effect.orDie)
    })

    const attach = Effect.fn("SessionComposition.attach")(function* (
      sessionID: SessionSchema.ID,
      snapshot: Composition.Snapshot,
    ) {
      const alreadyExists = yield* exists(sessionID)
      if (alreadyExists) {
        yield* new SnapshotAlreadyExistsError({ sessionID })
      }

      yield* insertSnapshot(db, sessionID, snapshot)
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
          : agentID !== (snapshot.data.root?.id ?? "meta") &&
            !(snapshot.data.root !== undefined && agentID === snapshot.data.orchestrator?.name) &&
            matchingAgent(snapshot.data.agents, agentID) !== undefined

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
      frozen?: Composition.SnapshotV2,
    ) {
      const snapshot = frozen ?? (yield* get(sessionID))
      const missing = (reason: string, details?: string) =>
        new DependencyMissingError({ sessionID, reason, ...(details !== undefined ? { details } : {}) })

      if (snapshot.version === 1) {
        if (snapshot.data.agentID.trim().length === 0) {
          return yield* missing("empty_agent_id", "snapshot data carries an empty agentID")
        }
      } else {
        if (snapshot.data.agents.length === 0 && snapshot.data.root === undefined) {
          return yield* missing("empty_agents", "snapshot data carries an empty agents list")
        }
      }
      if (snapshot.data.tools.catalog.length === 0) {
        return yield* missing("empty_tool_catalog", "tool catalog is empty")
      }
      // snapshot.digest identifies the plan. The captured catalog has a separate
      // recomputable digest; one validator owns both its ordering and identity.
      const capture = CompositionDigest.validateCapturedTools(snapshot.data.tools)
      if (Result.isFailure(capture)) return yield* missing(capture.failure.reason, capture.failure.details)
      if (snapshot.version === 2) {
        // A scoped graph must carry every addressable consumer, so that "present but binds nothing"
        // stays distinguishable from "absent" — the runtime fails closed only on absent.
        //
        // Whether an agent's own system prompt actually survived the freeze cannot be decided from
        // the snapshot alone (an agent whose asset body is empty legitimately contributes no
        // instruction). That invariant is enforced at freeze time in composition-resolver, where the
        // live asset and the binding are both in hand.
        const bindings = snapshot.data.bindings
        if (bindings !== undefined) {
          if (!("orchestrator" in bindings)) {
            return yield* missing(
              "missing_orchestrator_binding",
              "a scoped binding graph must carry an orchestrator entry, even when it binds nothing",
            )
          }
          const consumers = new Set(["orchestrator"])
          const identities = new Set<string>(
            snapshot.data.root === undefined
              ? ["meta"]
              : [
                  snapshot.data.root.id,
                  ...(snapshot.data.orchestrator === undefined ? [] : [snapshot.data.orchestrator.name]),
                ],
          )
          for (const agent of snapshot.data.agents) {
            for (const identity of new Set([agent.id, agent.name])) {
              if (identities.has(identity))
                return yield* missing("ambiguous_agent_identity", `frozen agent identity '${identity}' is not unique`)
              identities.add(identity)
            }
            const key = agent.consumerKey ?? `agents/${agent.name}`
            if (consumers.has(key))
              return yield* missing("duplicate_consumer_key", `more than one frozen agent maps to consumer '${key}'`)
            consumers.add(key)
            if (bindings[key] === undefined) {
              return yield* missing(
                "missing_agent_binding",
                `frozen agent '${agent.name}' has no binding entry for consumer '${key}'`,
              )
            }
          }
          const orphan = Object.keys(bindings).find((key) => !consumers.has(key))
          if (orphan !== undefined)
            return yield* missing("orphan_consumer_binding", `consumer '${orphan}' has no frozen agent`)
        }
        const audit = Composition.mcpAuditMatchesCatalog({
          catalog: snapshot.data.tools.catalog,
          auditToolNames: snapshot.data.mcp.tools.map((tool) => tool.canonicalName),
        })
        if (!audit.matches) {
          return yield* missing(
            "mcp_audit_catalog_mismatch",
            `MCP catalog ${JSON.stringify(audit.catalogMcpTools)} does not equal MCP audit tools ${JSON.stringify(audit.auditMcpTools)}`,
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
      if (snapshot.version !== 2)
        return yield* missing(
          "missing_executor_configuration",
          "historical V1 snapshots do not contain frozen executor configurations",
        )
      const orchestrator = snapshot.data.orchestrator
      if (orchestrator === undefined)
        return yield* missing(
          "missing_orchestrator_configuration",
          "runnable snapshots require a frozen root configuration",
        )
      if (
        orchestrator.id !== (snapshot.data.root?.id ?? "meta") ||
        (snapshot.data.root === undefined
          ? orchestrator.mode !== "primary"
          : orchestrator.mode === "subagent" || orchestrator.hidden) ||
        (snapshot.data.root?.source === "asset"
          ? orchestrator.id === "meta" ||
            orchestrator.originRelativePath !== snapshot.data.root.relativePath ||
            orchestrator.originRevision !== snapshot.data.root.revision
          : orchestrator.originRelativePath !== undefined || orchestrator.originRevision !== undefined)
      )
        return yield* missing(
          snapshot.data.root === undefined
            ? "orchestrator_identity_mismatch"
            : snapshot.data.root.source === "asset"
              ? "asset_root_identity_mismatch"
              : "builtin_root_identity_mismatch",
          "the frozen root configuration must match its declared source and identity",
        )
      if (snapshot.data.root?.source === "builtin") {
        if (snapshot.data.root.revision === undefined)
          return yield* missing(
            "missing_builtin_root_revision",
            "the frozen builtin root requires its definition revision",
          )
        if (
          snapshot.data.root.revision !==
          Composition.Revision.make(CompositionDigest.computeDigest(Schema.encodeSync(Agent.Info)(orchestrator)))
        )
          return yield* missing(
            "builtin_root_revision_mismatch",
            "the frozen builtin root definition does not match its revision",
          )
      }
      const executors = snapshot.data.executors
      if (executors === undefined || executors.length !== snapshot.data.agents.length)
        return yield* missing(
          "missing_executor_configuration",
          "each frozen agent must have exactly one executor configuration",
        )
      const executorIDs = new Set<string>()
      for (const executor of executors) {
        const agent = snapshot.data.agents.find((candidate) => candidate.id === executor.id)
        if (
          executorIDs.has(executor.id) ||
          !agent ||
          executor.id === "meta" ||
          executor.id === snapshot.data.root?.id ||
          executor.info.id !== executor.id ||
          executor.relativePath !== agent.relativePath ||
          executor.revision !== agent.revision ||
          executor.info.originRelativePath !== executor.relativePath ||
          executor.info.originRevision !== executor.revision
        )
          return yield* missing(
            "executor_identity_mismatch",
            `executor '${executor.id}' does not match its frozen agent asset`,
          )
        executorIDs.add(executor.id)
      }
      const bindings = snapshot.data.bindings
      if (bindings === undefined)
        return yield* missing("missing_consumer_bindings", "runnable snapshots require explicit consumer bindings")
      if (
        [...snapshot.data.commands, ...Object.values(bindings).flatMap((binding) => binding.commands)].some(
          (command) => command.invocation.length === 0,
        )
      )
        return yield* missing("missing_command_invocation", "a frozen Command is missing its invocation")
      if (
        [...snapshot.data.commands, ...Object.values(bindings).flatMap((binding) => binding.commands)].some(
          (command) => command.source === undefined,
        )
      )
        return yield* missing("missing_command_content", "a frozen Command is missing its body")
      const skills = [...snapshot.data.skills, ...Object.values(bindings).flatMap((binding) => binding.skills)]
      if (skills.some((skill) => skill.content === undefined))
        return yield* missing("missing_skill_content", "a frozen Skill is missing its body")
      if (
        snapshot.data.mcp.bindings.some(
          (binding) =>
            binding.transportFingerprint === undefined || !Schema.is(Composition.Digest)(binding.transportFingerprint),
        )
      )
        return yield* missing(
          "missing_mcp_transport_fingerprint",
          "every MCP binding requires a frozen transport fingerprint",
        )
      return snapshot
    })

    const selectAgent = Effect.fn("SessionComposition.selectAgent")(function* (
      sessionID: SessionSchema.ID,
      agentID: string,
      frozen?: Composition.SnapshotV2,
    ) {
      const snapshot = yield* assertDependency(sessionID, frozen)
      const agent = matchingAgent(snapshot.data.agents, agentID)
      const rootID = snapshot.data.root?.id ?? "meta"
      const info =
        agentID === rootID || (snapshot.data.root !== undefined && agentID === snapshot.data.orchestrator?.name)
          ? snapshot.data.orchestrator
          : agent === undefined
            ? undefined
            : snapshot.data.executors?.find((executor) => executor.id === agent.id)?.info
      if (info === undefined)
        return yield* new AgentDelegationForbiddenError({
          sessionID,
          agentID,
          allowedAgentID: [rootID, ...snapshot.data.agents.map((candidate) => candidate.id)].join(", "),
        })
      const scope = CompositionConsumerView.resolveScopeForAgent(snapshot, info.id)
      if (!CompositionConsumerView.isBindingSatisfied(snapshot, scope))
        return yield* new DependencyMissingError({ sessionID, reason: "missing_agent_binding" })
      return { snapshot, scope, info } satisfies Selection
    })

    return Service.of({
      references,
      attach,
      read,
      get,
      updateGroupBehavior,
      exists,
      copy,
      assertAgentAllowed,
      assertDependency,
      selectAgent,
    } satisfies Interface)
  }),
)

export const defaultLayer = layer

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })

export const selectSessionAgent = Effect.fn("SessionComposition.selectSessionAgent")(function* (
  compositions: Interface,
  session: Pick<SessionSchema.Info, "id" | "parentID" | "agent">,
  agentID = session.agent ?? "",
) {
  const selection = yield* compositions.selectAgent(session.id, agentID)
  const rootID = selection.snapshot.data.root?.id ?? "meta"
  if (
    (session.parentID === undefined && selection.info.id !== rootID) ||
    (session.parentID !== undefined && selection.info.id === rootID)
  )
    return yield* new AgentDelegationForbiddenError({
      sessionID: session.id,
      agentID,
      allowedAgentID:
        session.parentID === undefined ? rootID : selection.snapshot.data.agents.map((agent) => agent.id).join(", "),
    })
  return selection
})

function matchingAgent(agents: ReadonlyArray<Composition.AgentInfo>, agentID: string) {
  const matched = agents.filter((agent) => agent.id === agentID || agent.name === agentID)
  return matched.length === 1 ? matched[0] : undefined
}
