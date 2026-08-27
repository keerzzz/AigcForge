export * as SessionV2 from "./session"
export * from "./session/schema"

import { DateTime, Effect, Exit, Layer, Schema, Context, Stream, Option } from "effect"
import { ListAnchor } from "@aigcfroge/schema/session"
import { Composition } from "@aigcfroge/schema/composition"
import { and, asc, desc, eq, gt, like, lt, or, type SQL } from "drizzle-orm"
import { ProjectV2 } from "./project"
import { WorkspaceV2 } from "./workspace"
import { ModelV2 } from "./model"
import { ProductMode } from "@aigcfroge/schema/product-mode"
import { PermissionTier } from "@aigcfroge/schema/permission-tier"
import { Location } from "./location"
import { SessionMessage } from "./session/message"
import { Prompt } from "./session/prompt"
import { EventV2 } from "./event"
import { Database } from "./database/database"
import { SessionProjector } from "./session/projector"
import { SessionMessageTable, SessionTable } from "./session/sql"
import { SessionSchema } from "./session/schema"
import { AbsolutePath, PositiveInt, RelativePath } from "./schema"
import { AgentV2 } from "./agent"
import { WorkPreset } from "@aigcfroge/schema/work-preset"
import { SessionV1 } from "./v1/session"
import { InstallationVersion } from "./installation/version"
import { Slug } from "./util/slug"
import { ProductModeAgentPolicy } from "./product-mode-agent-policy"
import { ProductModePolicy } from "./product-mode-policy"
import { ProjectTable } from "./project/sql"
import { SessionComposition } from "./session/composition"
import { CompositionResolver } from "./composition-resolver"
import { LocationServiceMap } from "./location-layer"
import path from "path"
import { fromRow } from "./session/info"
import { SessionStore } from "./session/store"
import type { SessionRunner } from "./session/runner/index"
import { SessionExecution } from "./session/execution"
import { MessageDecodeError } from "./session/error"
import { SessionEvent } from "./session/event"
import { SessionInput } from "./session/input"
import { ToolSummary } from "./session/tool-summary"

// get project -> project.locations
//
// get all sessions
//

// - by project
//   - by subpath
// - by workspace (home is special)

export { ListAnchor }

const ListInputBase = {
  workspaceID: WorkspaceV2.ID.pipe(Schema.optional),
  mode: ProductMode.ID.pipe(Schema.optional),
  search: Schema.String.pipe(Schema.optional),
  limit: PositiveInt.pipe(Schema.optional),
  order: Schema.Literals(["asc", "desc"]).pipe(Schema.optional),
  anchor: ListAnchor.pipe(Schema.optional),
}

const ListDirectoryInput = Schema.Struct({
  ...ListInputBase,
  directory: AbsolutePath,
})

const ListProjectInput = Schema.Struct({
  ...ListInputBase,
  project: ProjectV2.ID,
  subpath: RelativePath.pipe(Schema.optional),
})

const ListAllInput = Schema.Struct(ListInputBase)

export const ListInput = Schema.Union([ListDirectoryInput, ListProjectInput, ListAllInput])
export type ListInput = typeof ListInput.Type

type CreateInput = {
  id?: SessionSchema.ID
  parentID?: SessionSchema.ID
  mode?: ProductMode.ID
  presetCategoryId?: WorkPreset.Category
  agent?: AgentV2.ID
  model?: ModelV2.Ref
  location: Location.Ref
  attended?: boolean
  permissionTier?: PermissionTier.ID
  title?: string
}

export class CreateCustomInput extends Schema.Class<CreateCustomInput>("Session.CreateCustomInput")({
  id: Schema.optional(SessionSchema.ID),
  location: Location.Ref,
  composition: Composition.CompositionInput,
  expectedPlanDigest: Schema.optional(Composition.Digest),
  title: Schema.optional(Schema.String),
}) {}

export class UpgradeCustomInput extends Schema.Class<UpgradeCustomInput>("Session.UpgradeCustomInput")({
  sessionID: SessionSchema.ID,
  composition: Composition.CompositionInput,
  expectedPlanDigest: Schema.optional(Composition.Digest),
  title: Schema.optional(Schema.String),
}) {}

type CompactInput = {
  sessionID: SessionSchema.ID
  prompt?: Prompt
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Session.NotFoundError", {
  sessionID: SessionSchema.ID,
}) {}

export class OperationUnavailableError extends Schema.TaggedErrorClass<OperationUnavailableError>()(
  "Session.OperationUnavailableError",
  {
    operation: Schema.Literals(["move", "shell", "skill", "switchAgent", "compact", "wait"]),
  },
) {}

export { ContextSnapshotDecodeError, MessageDecodeError } from "./session/error"

export class PromptConflictError extends Schema.TaggedErrorClass<PromptConflictError>()("Session.PromptConflictError", {
  sessionID: SessionSchema.ID,
  messageID: SessionMessage.ID,
}) {}

export class SyntheticConflictError extends Schema.TaggedErrorClass<SyntheticConflictError>()(
  "Session.SyntheticConflictError",
  {
    sessionID: SessionSchema.ID,
    messageID: SessionMessage.ID,
  },
) {
  override get message() {
    return `Synthetic message ${this.messageID} conflicts with existing Session history`
  }
}

export class UpgradeSourceModeError extends Schema.TaggedErrorClass<UpgradeSourceModeError>()(
  "Session.UpgradeSourceModeError",
  {
    sessionID: SessionSchema.ID,
    mode: ProductMode.ID,
  },
) {}

export class SessionBusyError extends Schema.TaggedErrorClass<SessionBusyError>()("Session.SessionBusyError", {
  sessionID: SessionSchema.ID,
}) {}

export type Error =
  | NotFoundError
  | MessageDecodeError
  | OperationUnavailableError
  | PromptConflictError
  | SyntheticConflictError
  | UpgradeSourceModeError
  | SessionBusyError
  | ProductModePolicy.UnsupportedProductModeError
  | Composition.ResolveError
  | SessionComposition.SnapshotNotFoundError
  | SessionComposition.SnapshotDecodeError
  | SessionComposition.SnapshotAlreadyExistsError
  | SessionComposition.AgentDelegationForbiddenError

export interface Interface {
  readonly list: (input?: ListInput) => Effect.Effect<SessionSchema.Info[]>
  readonly create: (input: CreateInput) => Effect.Effect<
    SessionSchema.Info,
    | ProductModePolicy.UnsupportedProductModeError
    | PromptConflictError
    | SessionComposition.SnapshotNotFoundError
    | SessionComposition.SnapshotDecodeError
    | SessionComposition.AgentDelegationForbiddenError
  >
  readonly createCustom: (input: CreateCustomInput) => Effect.Effect<
    { session: SessionSchema.Info; snapshot: Composition.Snapshot },
    | Composition.ResolveError
    | PromptConflictError
    | ProductModePolicy.UnsupportedProductModeError
    | SessionComposition.SnapshotAlreadyExistsError
    | SessionComposition.SnapshotDecodeError
  >
  readonly upgradeCustom: (input: UpgradeCustomInput) => Effect.Effect<
    { session: SessionSchema.Info; snapshot: Composition.Snapshot },
    | NotFoundError
    | UpgradeSourceModeError
    | SessionBusyError
    | Composition.ResolveError
    | PromptConflictError
    | ProductModePolicy.UnsupportedProductModeError
    | SessionComposition.SnapshotAlreadyExistsError
    | SessionComposition.SnapshotDecodeError
  >
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<SessionSchema.Info, NotFoundError>
  readonly children: (sessionID: SessionSchema.ID) => Effect.Effect<SessionSchema.Info[], NotFoundError>
  readonly messages: (input: {
    sessionID: SessionSchema.ID
    limit?: number
    order?: "asc" | "desc"
    cursor?: {
      id: SessionMessage.ID
      direction: "previous" | "next"
    }
  }) => Effect.Effect<SessionMessage.Message[], NotFoundError | MessageDecodeError>
  readonly message: (input: {
    sessionID: SessionSchema.ID
    messageID: SessionMessage.ID
  }) => Effect.Effect<SessionMessage.Message | undefined>
  readonly context: (
    sessionID: SessionSchema.ID,
  ) => Effect.Effect<SessionMessage.Message[], NotFoundError | MessageDecodeError>
  readonly events: (input: {
    sessionID: SessionSchema.ID
    after?: number
  }) => Stream.Stream<SessionEvent.DurableEvent, NotFoundError>
  readonly switchAgent: (input: { sessionID: SessionSchema.ID; agent: string }) => Effect.Effect<
    void,
    | NotFoundError
    | ProductModePolicy.UnsupportedProductModeError
    | SessionComposition.AgentDelegationForbiddenError
    | SessionComposition.SnapshotNotFoundError
    | SessionComposition.SnapshotDecodeError
  >
  readonly switchModel: (input: {
    sessionID: SessionSchema.ID
    model: ModelV2.Ref
  }) => Effect.Effect<void, NotFoundError | ProductModePolicy.UnsupportedProductModeError>
  readonly remove: (sessionID: SessionSchema.ID) => Effect.Effect<void, NotFoundError>
  readonly removeMessage: (input: { sessionID: SessionSchema.ID; messageID: SessionMessage.ID }) => Effect.Effect<void, NotFoundError>
  readonly setTitle: (input: { sessionID: SessionSchema.ID; title: string }) => Effect.Effect<void, NotFoundError>
  readonly prompt: (input: {
    id?: SessionMessage.ID
    sessionID: SessionSchema.ID
    prompt: Prompt
    delivery?: SessionInput.Delivery
    resume?: boolean
  }) => Effect.Effect<
    SessionInput.Admitted,
    | NotFoundError
    | PromptConflictError
    | ProductModePolicy.UnsupportedProductModeError
    | SessionComposition.SnapshotNotFoundError
    | SessionComposition.SnapshotDecodeError
  >
  readonly shell: (input: {
    id?: SessionMessage.ID
    sessionID: SessionSchema.ID
    command: string
    resume?: boolean
  }) => Effect.Effect<
    SessionInput.Admitted,
    | NotFoundError
    | PromptConflictError
    | ProductModePolicy.UnsupportedProductModeError
    | SessionComposition.SnapshotNotFoundError
    | SessionComposition.SnapshotDecodeError
  >
  readonly skill: (input: {
    id?: SessionMessage.ID
    sessionID: SessionSchema.ID
    skill: string
    resume?: boolean
  }) => Effect.Effect<
    SessionInput.Admitted,
    | NotFoundError
    | PromptConflictError
    | ProductModePolicy.UnsupportedProductModeError
    | SessionComposition.SnapshotNotFoundError
    | SessionComposition.SnapshotDecodeError
  >
  readonly compact: (input: CompactInput) => Effect.Effect<void, NotFoundError | OperationUnavailableError>
  readonly wait: (id: SessionSchema.ID) => Effect.Effect<void, NotFoundError | OperationUnavailableError>
  readonly resume: (
    sessionID: SessionSchema.ID,
  ) => Effect.Effect<
    void,
    | NotFoundError
    | SessionRunner.RunError
    | SessionComposition.SnapshotNotFoundError
    | SessionComposition.SnapshotDecodeError
  >
  readonly injectSynthetic: (input: {
    id?: SessionMessage.ID
    sessionID: SessionSchema.ID
    text: string
  }) => Effect.Effect<void, NotFoundError | SyntheticConflictError | SessionRunner.RunError>
  readonly interrupt: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly toolSummary: (sessionID: SessionSchema.ID) => Effect.Effect<ToolSummary.Summary[], NotFoundError | MessageDecodeError>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/Session") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const events = yield* EventV2.Service
    const projects = yield* ProjectV2.Service
    const execution = yield* SessionExecution.Service
    const store = yield* SessionStore.Service
    const sessionComposition = yield* SessionComposition.Service
    const decodeMessage = Schema.decodeUnknownEffect(SessionMessage.Message)
    const isDurableSessionEvent = Schema.is(SessionEvent.Durable)
    const decode = (row: typeof SessionMessageTable.$inferSelect) =>
      decodeMessage({ ...row.data, id: row.id, type: row.type }).pipe(
        Effect.mapError(
          () =>
            new MessageDecodeError({
              sessionID: SessionSchema.ID.make(row.session_id),
              messageID: SessionMessage.ID.make(row.id),
            }),
        ),
      )

    const resolveCompositionResolver = (locationRef: Location.Ref) =>
      Effect.gen(function* () {
        const context = yield* Effect.context<never>()
        const directResolver = Context.getOption(context, CompositionResolver.Service)
        if (Option.isSome(directResolver)) return directResolver.value

        const map = Context.getOption(context, LocationServiceMap)
        if (Option.isSome(map)) {
          const locLayer = map.value.get(locationRef)
          return yield* CompositionResolver.Service.pipe(Effect.provide(locLayer), Effect.orDie)
        }

        return yield* Effect.die("No CompositionResolver or LocationServiceMap available in context")
      })

    const resolveAgent = (
      input: CreateInput,
      mode: ProductMode.ID,
      parent: SessionSchema.Info | undefined,
      parentSnapshot: Composition.Snapshot | undefined,
    ) =>
      Effect.gen(function* () {
        if (parent && parentSnapshot) {
          const defaultAgentID =
            parentSnapshot.version === 1
              ? parentSnapshot.data.agentID
              : parentSnapshot.data.agents[0]?.id ?? "meta"
          const agentID: string = input.agent ?? defaultAgentID
          yield* sessionComposition.assertAgentAllowed(parent.id, agentID)
          return AgentV2.ID.make(agentID)
        }
        if (mode === "custom") {
          return AgentV2.ID.make(yield* ProductModeAgentPolicy.enforcePrimary(mode, input.agent))
        }
        return AgentV2.ID.make(yield* ProductModeAgentPolicy.enforcePrimary(mode, input.agent ?? parent?.agent))
      })

    const result = Service.of({
      create: Effect.fn("V2Session.create")(function* (input) {
        const sessionID = input.id ?? SessionSchema.ID.create()
        const recorded = yield* store.get(sessionID)
        if (recorded) {
          yield* ProductModePolicy.assertCreationSupported(recorded.mode)
          return recorded
        }
        const parent = input.parentID ? yield* store.get(input.parentID) : undefined
        const mode = parent?.mode ?? input.mode ?? ProductMode.Default
        if (mode === "custom") {
          if (!parent) yield* ProductModePolicy.assertCreationSupported(mode)
          yield* ProductModePolicy.assertRuntimeSupported(mode)
        } else {
          yield* ProductModePolicy.assertCreationSupported(mode)
        }
        // A custom parent freezes its composition once; fetch the snapshot up
        // front as the delegation contract (agent identity) and the digest
        // baseline for child snapshot reconciliation after projection.
        const parentSnapshot = parent?.mode === "custom" ? yield* sessionComposition.get(parent.id) : undefined
        const agent = yield* resolveAgent(input, mode, parent, parentSnapshot)
        const project = yield* projects.resolve(input.location.directory)
        yield* db
          .insert(ProjectTable)
          .values({ id: project.id, worktree: project.directory, vcs: project.vcs?.type, sandboxes: [] })
          .onConflictDoNothing()
          .run()
          .pipe(Effect.orDie)
        const now = Date.now()
        const info = SessionV1.SessionInfo.make({
          id: sessionID,
          slug: Slug.create(),
          version: InstallationVersion,
          projectID: project.id,
          parentID: input.parentID,
          mode,
          directory: input.location.directory,
          path: path.relative(project.directory, input.location.directory).replaceAll("\\", "/"),
          workspaceID: input.location.workspaceID ? WorkspaceV2.ID.make(input.location.workspaceID) : undefined,
          title: input.title ?? `New session - ${new Date(now).toISOString()}`,
          agent,
          model: input.model
            ? {
                id: ModelV2.ID.make(input.model.id),
                providerID: input.model.providerID,
                variant: input.model.variant,
              }
            : undefined,
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: now, updated: now },
          attended: input.attended,
          permissionTier: input.permissionTier ?? PermissionTier.Default,
          metadata: input.presetCategoryId ? { presetCategoryId: input.presetCategoryId } : undefined,
        })
        const projected = yield* events
          .publish(SessionV1.Event.Created, { sessionID, info }, { location: input.location })
          .pipe(
            Effect.as({ type: "created" } as const),
            Effect.catchDefect((defect) => {
              if (!(defect instanceof SessionProjector.SessionAlreadyProjected)) {
                return Effect.die(defect)
              }
              // Concurrent creation lost the projection race. The existing Session identity wins.
              return store
                .get(sessionID)
                .pipe(
                  Effect.flatMap((session) =>
                    session ? Effect.succeed({ type: "existing", session } as const) : Effect.die(defect),
                  ),
                )
            }),
          )
        if (projected.type === "existing") {
          if (parentSnapshot) {
            // Lost the projection race for a custom child: only an identical
            // frozen digest reconciles the retry, anything else is a conflict.
            const existing = yield* sessionComposition.read(sessionID)
            if (!existing || existing.digest !== parentSnapshot.digest) {
              return yield* new PromptConflictError({ sessionID, messageID: SessionMessage.ID.create() })
            }
          }
          return projected.session
        }
        if (parent && parentSnapshot) {
          const existing = yield* sessionComposition.read(sessionID)
          if (existing && existing.digest !== parentSnapshot.digest) {
            return yield* new PromptConflictError({ sessionID, messageID: SessionMessage.ID.create() })
          }
          if (!existing) {
            yield* sessionComposition.copy(parent.id, sessionID).pipe(
              Effect.catchTag(
                "SessionComposition.SnapshotAlreadyExistsError",
                () => new PromptConflictError({ sessionID, messageID: SessionMessage.ID.create() }),
              ),
            )
          }
        }
        // TODO: Restore recorded sessions onto replacement synchronized workspaces in a future API slice.
        return yield* result.get(sessionID).pipe(Effect.orDie)
      }),
      createCustom: Effect.fn("V2Session.createCustom")(function* (input) {
        const sessionID = input.id ?? SessionSchema.ID.create()
        const resolver = yield* resolveCompositionResolver(input.location)
        const snapshot = yield* resolver.freeze({ input: input.composition, sessionID })

        if (input.expectedPlanDigest && snapshot.digest !== input.expectedPlanDigest) {
          return yield* new Composition.ResolveError({
            code: "stale_composition_plan",
            message: `Composition plan digest mismatch: expected ${input.expectedPlanDigest}, got ${snapshot.digest}`,
          })
        }

        const recorded = yield* store.get(sessionID)
        if (recorded) {
          if (recorded.mode !== "custom") {
            return yield* new PromptConflictError({ sessionID, messageID: SessionMessage.ID.create() })
          }
          const recordedSnapshot = yield* sessionComposition.read(sessionID)
          if (recordedSnapshot && recordedSnapshot.digest === snapshot.digest) {
            return { session: recorded, snapshot: recordedSnapshot }
          }
          return yield* new PromptConflictError({ sessionID, messageID: SessionMessage.ID.create() })
        }

        const project = yield* projects.resolve(input.location.directory)
        yield* db
          .insert(ProjectTable)
          .values({ id: project.id, worktree: project.directory, vcs: project.vcs?.type, sandboxes: [] })
          .onConflictDoNothing()
          .run()
          .pipe(Effect.orDie)

        const now = Date.now()
        const info = SessionV1.SessionInfo.make({
          id: sessionID,
          slug: Slug.create(),
          version: InstallationVersion,
          projectID: project.id,
          mode: "custom",
          directory: input.location.directory,
          path: path.relative(project.directory, input.location.directory).replaceAll("\\", "/"),
          workspaceID: input.location.workspaceID ? WorkspaceV2.ID.make(input.location.workspaceID) : undefined,
          title: input.title ?? `Custom session - ${new Date(now).toISOString()}`,
          agent: AgentV2.ID.make("meta"),
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: now, updated: now },
          permissionTier: PermissionTier.Default,
        })

        const projected = yield* events
          .publish(
            SessionV1.Event.Created,
            { sessionID, info },
            {
              location: input.location,
              commit: () => sessionComposition.attach(sessionID, snapshot).pipe(Effect.orDie),
            },
          )
          .pipe(
            Effect.as({ type: "created" } as const),
            Effect.catchDefect((defect) => {
              if (!(defect instanceof SessionProjector.SessionAlreadyProjected)) {
                return Effect.die(defect)
              }
              return store
                .get(sessionID)
                .pipe(
                  Effect.flatMap((session) =>
                    session ? Effect.succeed({ type: "existing", session } as const) : Effect.die(defect),
                  ),
                )
            }),
          )

        if (projected.type === "existing") {
          const existingSnapshot = yield* sessionComposition.read(sessionID)
          if (existingSnapshot && existingSnapshot.digest === snapshot.digest) {
            return { session: projected.session, snapshot: existingSnapshot }
          }
          return yield* new PromptConflictError({ sessionID, messageID: SessionMessage.ID.create() })
        }

        const createdSession = yield* result.get(sessionID).pipe(Effect.orDie)
        return { session: createdSession, snapshot }
      }),
      upgradeCustom: Effect.fn("V2Session.upgradeCustom")(function* (input) {
        const source = yield* result.get(input.sessionID)
        if (source.mode !== "custom") {
          return yield* new UpgradeSourceModeError({ sessionID: input.sessionID, mode: source.mode })
        }
        if (yield* execution.isActive(input.sessionID)) {
          return yield* new SessionBusyError({ sessionID: input.sessionID })
        }
        // Upgrading never mutates the source session or its snapshot row: the
        // new composition is frozen fresh at the source's location and attached
        // to a newly created session, leaving the source readable for frozen
        // replay.
        return yield* result.createCustom({
          location: source.location,
          composition: input.composition,
          expectedPlanDigest: input.expectedPlanDigest,
          title: input.title,
        })
      }),
      get: Effect.fn("V2Session.get")(function* (sessionID) {
        const session = yield* store.get(sessionID)
        if (!session) return yield* new NotFoundError({ sessionID })
        return session
      }),
      children: Effect.fn("V2Session.children")(function* (sessionID) {
        yield* result.get(sessionID)
        return yield* store.children(sessionID)
      }),
      list: Effect.fn("V2Session.list")(function* (input = {}) {
        const direction = input.anchor?.direction ?? "next"
        const requestedOrder = input.order ?? "desc"
        const order = direction === "previous" ? (requestedOrder === "asc" ? "desc" : "asc") : requestedOrder
        const sortColumn = SessionTable.time_created
        const conditions: SQL[] = []
        if ("directory" in input) conditions.push(eq(SessionTable.directory, input.directory))
        if (input.workspaceID) conditions.push(eq(SessionTable.workspace_id, input.workspaceID))
        if (input.mode) conditions.push(eq(SessionTable.mode, input.mode))
        if ("project" in input) conditions.push(eq(SessionTable.project_id, input.project))
        if (input.search) conditions.push(like(SessionTable.title, `%${input.search}%`))
        if (input.anchor) {
          conditions.push(
            order === "asc"
              ? or(
                  gt(sortColumn, input.anchor.time),
                  and(eq(sortColumn, input.anchor.time), gt(SessionTable.id, input.anchor.id)),
                )!
              : or(
                  lt(sortColumn, input.anchor.time),
                  and(eq(sortColumn, input.anchor.time), lt(SessionTable.id, input.anchor.id)),
                )!,
          )
        }
        const query = db
          .select()
          .from(SessionTable)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(
            order === "asc" ? asc(sortColumn) : desc(sortColumn),
            order === "asc" ? asc(SessionTable.id) : desc(SessionTable.id),
          )
        const rows = yield* (input.limit === undefined ? query.all() : query.limit(input.limit).all()).pipe(
          Effect.orDie,
        )
        return (direction === "previous" ? rows.toReversed() : rows).map((row) => fromRow(row))
      }),
      messages: Effect.fn("V2Session.messages")(function* (input) {
        yield* result.get(input.sessionID)
        const direction = input.cursor?.direction ?? "next"
        const requestedOrder = input.order ?? "desc"
        const order = direction === "previous" ? (requestedOrder === "asc" ? "desc" : "asc") : requestedOrder
        const anchor = input.cursor
          ? yield* db
              .select({ seq: SessionMessageTable.seq })
              .from(SessionMessageTable)
              .where(
                and(eq(SessionMessageTable.session_id, input.sessionID), eq(SessionMessageTable.id, input.cursor.id)),
              )
              .get()
              .pipe(Effect.orDie)
          : undefined
        if (input.cursor && !anchor) return []
        const boundary = anchor
          ? order === "asc"
            ? gt(SessionMessageTable.seq, anchor.seq)
            : lt(SessionMessageTable.seq, anchor.seq)
          : undefined
        const where = boundary
          ? and(eq(SessionMessageTable.session_id, input.sessionID), boundary)
          : eq(SessionMessageTable.session_id, input.sessionID)
        const query = db
          .select()
          .from(SessionMessageTable)
          .where(where)
          .orderBy(order === "asc" ? asc(SessionMessageTable.seq) : desc(SessionMessageTable.seq))
        const rows = yield* (input.limit === undefined ? query.all() : query.limit(input.limit).all()).pipe(
          Effect.orDie,
        )
        return yield* Effect.forEach(direction === "previous" ? rows.toReversed() : rows, decode)
      }),
      message: Effect.fn("V2Session.message")(function* (input) {
        const stored = yield* store.message(input.messageID)
        return stored?.sessionID === input.sessionID ? stored.message : undefined
      }),
      context: Effect.fn("V2Session.context")(function* (sessionID) {
        yield* result.get(sessionID)
        return yield* store.context(sessionID)
      }),
      events: (input) =>
        Stream.unwrap(
          result
            .get(input.sessionID)
            .pipe(Effect.as(events.durable({ aggregateID: input.sessionID, after: input.after }))),
        ).pipe(Stream.filter((event): event is SessionEvent.DurableEvent => isDurableSessionEvent(event))),
      prompt: Effect.fn("V2Session.prompt")((input) =>
        Effect.uninterruptible(
          Effect.gen(function* () {
            const session = yield* result.get(input.sessionID)
            yield* ProductModePolicy.assertRuntimeSupported(session.mode)
            if (session.mode === "custom") {
              yield* sessionComposition.get(input.sessionID)
            }
            const messageID = input.id ?? SessionMessage.ID.create()
            const delivery = input.delivery ?? "steer"
            const expected = { sessionID: input.sessionID, messageID, prompt: input.prompt, delivery }
            const admitted = yield* SessionInput.admit(db, events, {
              id: messageID,
              sessionID: input.sessionID,
              prompt: input.prompt,
              delivery,
            }).pipe(
              Effect.catchDefect((defect) =>
                defect instanceof SessionInput.LifecycleConflict
                  ? new PromptConflictError({ sessionID: input.sessionID, messageID })
                  : Effect.die(defect),
              ),
            )
            if (!SessionInput.equivalent(admitted, expected))
              return yield* new PromptConflictError({ sessionID: input.sessionID, messageID })
            if (input.resume !== false) yield* execution.wake(admitted.sessionID)
            return admitted
          }),
        ),
      ),
      shell: Effect.fn("V2Session.shell")((input) =>
        Effect.uninterruptible(
          Effect.gen(function* () {
            const session = yield* result.get(input.sessionID)
            yield* ProductModePolicy.assertRuntimeSupported(session.mode)
            if (session.mode === "custom") {
              yield* sessionComposition.get(input.sessionID)
            }
            // V2 shell policy guard: deny shell in chat mode
            const commandVerdict = ProductModeAgentPolicy.checkCommandAllowed(session.mode ?? "coding")
            if (!commandVerdict.allowed) return yield* Effect.die(commandVerdict.error)
            const messageID = input.id ?? SessionMessage.ID.create()
            const delivery: SessionInput.Delivery = "queue"
            const expected = { sessionID: input.sessionID, messageID, command: input.command, delivery }
            const admitted = yield* SessionInput.admitShell(db, events, {
              id: messageID,
              sessionID: input.sessionID,
              command: input.command,
            }).pipe(
              Effect.catchDefect((defect) =>
                defect instanceof SessionInput.LifecycleConflict
                  ? new PromptConflictError({ sessionID: input.sessionID, messageID })
                  : Effect.die(defect),
              ),
            )
            if (!SessionInput.equivalentShell(admitted, expected))
              return yield* new PromptConflictError({ sessionID: input.sessionID, messageID })
            if (input.resume !== false) yield* execution.wake(admitted.sessionID)
            return admitted
          }),
        ),
      ),
      skill: Effect.fn("V2Session.skill")((input) =>
        Effect.uninterruptible(
          Effect.gen(function* () {
            const session = yield* result.get(input.sessionID)
            yield* ProductModePolicy.assertRuntimeSupported(session.mode)
            if (session.mode === "custom") {
              yield* sessionComposition.get(input.sessionID)
            }
            const messageID = input.id ?? SessionMessage.ID.create()
            const delivery: SessionInput.Delivery = "steer"
            const expected = { sessionID: input.sessionID, messageID, skill: input.skill, delivery }
            const admitted = yield* SessionInput.admitSkill(db, events, {
              id: messageID,
              sessionID: input.sessionID,
              skill: input.skill,
            }).pipe(
              Effect.catchDefect((defect) =>
                defect instanceof SessionInput.LifecycleConflict
                  ? new PromptConflictError({ sessionID: input.sessionID, messageID })
                  : Effect.die(defect),
              ),
            )
            if (!SessionInput.equivalentSkill(admitted, expected))
              return yield* new PromptConflictError({ sessionID: input.sessionID, messageID })
            if (input.resume !== false) yield* execution.wake(admitted.sessionID)
            return admitted
          }),
        ),
      ),
      switchAgent: Effect.fn("V2Session.switchAgent")(function* (input) {
        const session = yield* result.get(input.sessionID)
        yield* ProductModePolicy.assertRuntimeSupported(session.mode)
        // Custom sessions may only switch within their frozen Snapshot pool;
        // without this gate a post-creation swap would bypass the same
        // allowlist that guards `create` and delegated dispatch.
        if (session.mode === "custom") {
          yield* sessionComposition.assertAgentAllowed(input.sessionID, input.agent)
        }
        yield* events.publish(SessionEvent.AgentSwitched, {
          sessionID: input.sessionID,
          messageID: SessionMessage.ID.create(),
          timestamp: yield* DateTime.now,
          agent: input.agent,
        })
      }),
      switchModel: Effect.fn("V2Session.switchModel")(function* (input) {
        const session = yield* result.get(input.sessionID)
        yield* ProductModePolicy.assertRuntimeSupported(session.mode)
        yield* events.publish(SessionEvent.ModelSwitched, {
          sessionID: input.sessionID,
          messageID: SessionMessage.ID.create(),
          timestamp: yield* DateTime.now,
          model: input.model,
        })
      }),
      remove: Effect.fn("V2Session.remove")(function* (sessionID: SessionSchema.ID) {
        yield* result.get(sessionID)
        // Delete events, messages, and session row. Foreign key cascade
        // handles session_input, session_message, etc. when the session row
        // is deleted. Event table is separate, so delete events explicitly.
        yield* db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run().pipe(Effect.orDie)
      }),
      removeMessage: Effect.fn("V2Session.removeMessage")(function* (input) {
        yield* result.get(input.sessionID)
        yield* db.delete(SessionMessageTable).where(and(eq(SessionMessageTable.session_id, input.sessionID), eq(SessionMessageTable.id, input.messageID))).run().pipe(Effect.orDie)
      }),
      setTitle: Effect.fn("V2Session.setTitle")(function* (input) {
        yield* result.get(input.sessionID)
        yield* db
          .update(SessionTable)
          .set({ title: input.title })
          .where(eq(SessionTable.id, input.sessionID))
          .run().pipe(Effect.orDie)
      }),
      compact: Effect.fn("V2Session.compact")(function* (input) {
        yield* result.get(input.sessionID)
        return yield* new OperationUnavailableError({ operation: "compact" })
      }),
      wait: Effect.fn("V2Session.wait")(function* (sessionID) {
        yield* result.get(sessionID)
        return yield* new OperationUnavailableError({ operation: "wait" })
      }),
      resume: Effect.fn("V2Session.resume")(function* (sessionID) {
        const session = yield* result.get(sessionID)
        if (session.mode === "custom") {
          yield* sessionComposition.get(sessionID)
        }
        yield* execution.resume(sessionID)
      }),
      injectSynthetic: Effect.fn("V2Session.injectSynthetic")(function* (input) {
        yield* result.get(input.sessionID)
        const messageID = input.id ?? SessionMessage.ID.create()
        const admission = yield* SessionInput.admitSynthetic(db, events, {
          id: messageID,
          sessionID: input.sessionID,
          text: input.text,
        })
        if (!SessionInput.equivalentSynthetic(admission.admitted, input)) {
          return yield* new SyntheticConflictError({ sessionID: input.sessionID, messageID })
        }
        if (admission.created) yield* execution.wake(input.sessionID)
      }),
      interrupt: Effect.fn("V2Session.interrupt")((sessionID) =>
        Effect.uninterruptible(
          Effect.gen(function* () {
            // Interrupt the session's own drain fiber.
            yield* execution.interrupt(sessionID)
            // Cascade to children so their BackgroundJob drains are also stopped.
            // Children cannot nest further (task tool prevents recursive
            // delegation via isChildSession), so depth is at most 1.
            const children = yield* store.children(sessionID)
            yield* Effect.forEach(children, (child) => execution.interrupt(child.id))
          }),
        ),
      ),
      toolSummary: Effect.fn("V2Session.toolSummary")(function* (sessionID) {
        yield* result.get(sessionID)
        const messages = yield* result.messages({ sessionID, order: "asc" })
        return ToolSummary.fromMessages(messages)
      }),
    })

    return result
  }),
).pipe(Layer.provide(SessionComposition.layer))

export const defaultLayer = layer.pipe(
  Layer.provide(SessionExecution.noopLayer),
  Layer.provide(SessionStore.defaultLayer),
  Layer.provide(SessionProjector.defaultLayer),
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(Database.defaultLayer),
  Layer.provide(ProjectV2.defaultLayer),
  Layer.orDie,
)
