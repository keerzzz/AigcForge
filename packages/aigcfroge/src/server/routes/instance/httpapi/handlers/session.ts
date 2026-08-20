import { PermissionV1 } from "@aigcfroge/core/v1/permission"
import { Agent } from "@/agent/agent"
import { SessionV1 } from "@aigcfroge/core/v1/session"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionTodo } from "@aigcfroge/core/session/todo"
import { SessionTask } from "@aigcfroge/core/session/task"
import { SessionTask as SessionTaskSchema } from "@aigcfroge/schema/session-task" // Schema namespace; the core SessionTask import above uses the unaliased name.
import { Composition } from "@aigcfroge/schema/composition"
import { PermissionV2 } from "@aigcfroge/core/permission"
import { SessionPermissionOverride } from "@aigcfroge/core/permission/session-override"
import { SessionShareV2 } from "@aigcfroge/core/session/share-v2"
import { SessionRevert as V2SessionRevert } from "@aigcfroge/core/session/revert"
import { SessionSummary as V2SessionSummary } from "@aigcfroge/core/session/summary"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Command } from "@/command"
import { Permission } from "@/permission"
import { SessionShare } from "@/share/session"
import { Session } from "@/session/session"
import { SessionCompaction } from "@/session/compaction"
import { MessageV2 } from "@/session/message-v2"
import { v2InfoToV1 } from "./session-adapter"
import { SessionPrompt } from "@/session/prompt"
import { SessionRevert } from "@/session/revert"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Location } from "@aigcfroge/core/location"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { getCacheDiagnostics } from "@aigcfroge/core/session/cache-diagnostics"
import { Database } from "@aigcfroge/core/database/database"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { NamedError } from "@aigcfroge/core/util/error"
import { Cause, Effect, Layer, Option, Schema, Scope } from "effect"
import * as Stream from "effect/Stream"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError, HttpApiSchema } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import {
  CommandPayload,
  DiffQuery,
  ForkPayload,
  InitPayload,
  ListQuery,
  MessagesQuery,
  PermissionResponsePayload,
  PromptPayload,
  RevertPayload,
  ShellPayload,
  SummarizePayload,
  UpdatePayload,
} from "../groups/session"
import { PermissionNotFoundError, InvalidRequestError, UnsupportedProductModeError } from "../errors"
import { ProductModePolicy } from "@aigcfroge/core/product-mode-policy"
import { notFound } from "../errors"
import * as SessionError from "./session-errors"
import { AIGCFROGE_V2_RUNTIME } from "@/effect/app-runtime"

const tryParseJson = (text: string) =>
  Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: () => new HttpApiError.BadRequest({}),
  })

const v2SessionNotFound = (error: SessionV2.NotFoundError) => notFound(`Session not found: ${error.sessionID}`)

const v2OperationUnavailable = () => new HttpApiError.BadRequest({})

const unsupportedProductMode = (error: ProductModePolicy.UnsupportedProductModeError) =>
  new UnsupportedProductModeError({ mode: error.mode, message: error.message })

// HIGH-4: custom sessions are V2-native. The V1 sync prompt/command/shell
// endpoints run the legacy V1 prompt loop, which has no custom gating — reject
// typed and point clients at the V2 async admission surface.
const v1SyncUnsupportedForCustom = (mode: string) =>
  new UnsupportedProductModeError({
    mode,
    message: `Mode "${mode}" does not support the V1 sync prompt/command/shell endpoints. Custom sessions are V2-native: use the async admission endpoints instead (POST /api/session/:sessionID/prompt, /api/session/:sessionID/shell, /api/session/:sessionID/skill, or session.prompt_async).`,
  })

export const sessionHandlers = HttpApiBuilder.group(InstanceHttpApi, "session", (handlers) =>
  Effect.gen(function* () {
    const session = yield* Session.Service
    const shareSvc = yield* SessionShare.Service
    const promptSvc = yield* SessionPrompt.Service
    const revertSvc = yield* SessionRevert.Service
    const compactSvc = yield* SessionCompaction.Service
    const runState = yield* SessionRunState.Service
    const agentSvc = yield* Agent.Service
    const permissionSvc = yield* Permission.Service
    const statusSvc = yield* SessionStatus.Service
    const summary = yield* SessionSummary.Service
    const events = yield* EventV2Bridge.Service
    const { db } = yield* Database.Service
    const scope = yield* Scope.Scope
    const permissionOverrideSvc = yield* SessionPermissionOverride.Service
    const locations = yield* LocationServiceMap

    const list = Effect.fn("SessionHttpApi.list")(function* (ctx: { query: typeof ListQuery.Type }) {
      const all = yield* session.list({
        directory: ctx.query.scope === "project" ? undefined : ctx.query.directory,
        scope: ctx.query.scope,
        mode: ctx.query.mode,
        path: ctx.query.path,
        roots: ctx.query.roots,
        start: ctx.query.start,
        search: ctx.query.search,
        limit: ctx.query.limit,
      })
      const request = yield* HttpServerRequest.HttpServerRequest
      const capabilitiesHeader = request.headers[ProductModePolicy.CAPABILITIES_HEADER]
      return ProductModePolicy.filterSupportedSessions(all, capabilitiesHeader)
    })

    const status = Effect.fn("SessionHttpApi.status")(function* () {
      return Object.fromEntries(yield* statusSvc.list())
    })

    const requireSession = Effect.fn("SessionHttpApi.requireSession")(function* (sessionID: SessionID) {
      const info = yield* SessionError.mapStorageNotFound(session.get(sessionID))
      const request = yield* HttpServerRequest.HttpServerRequest
      const capabilitiesHeader = request.headers[ProductModePolicy.CAPABILITIES_HEADER]
      if (!ProductModePolicy.isSessionSupported(info, capabilitiesHeader)) {
        return yield* Effect.fail(
          new UnsupportedProductModeError({
            mode: info.mode ?? "unknown",
            message: `Product mode "${info.mode}" is not supported by this client. Required capability: ${ProductModePolicy.CAPABILITY_CUSTOM_V1}`,
          }),
        )
      }
      return info
    })

    const requireRuntimeSession = Effect.fn("SessionHttpApi.requireRuntimeSession")(function* (sessionID: SessionID) {
      const info = yield* requireSession(sessionID)
      yield* ProductModePolicy.assertRuntimeSupported(info.mode).pipe(
        Effect.catchTag(
          "UnsupportedProductModeError",
          (error) =>
            Effect.fail(
              new UnsupportedProductModeError({
                mode: error.mode,
                message: error.message,
              }),
            ),
        ),
      )
      return info
    })

    const get = Effect.fn("SessionHttpApi.get")(function* (ctx: { params: { sessionID: SessionID } }) {
      return yield* requireSession(ctx.params.sessionID)
    })
    const children = Effect.fn("SessionHttpApi.children")(function* (ctx: { params: { sessionID: SessionID } }) {
      const info = yield* requireRuntimeSession(ctx.params.sessionID)
      const request = yield* HttpServerRequest.HttpServerRequest
      const capabilitiesHeader = request.headers[ProductModePolicy.CAPABILITIES_HEADER]
      if (ProductModePolicy.shouldUseV2Runtime(info.mode, AIGCFROGE_V2_RUNTIME)) {
        const v2session = yield* SessionV2.Service
        const result = yield* v2session.children(ctx.params.sessionID).pipe(
          Effect.catchTag("Session.NotFoundError", (error) => Effect.fail(v2SessionNotFound(error))),
        )
        const mapped = result.map(v2InfoToV1)
        return ProductModePolicy.filterSupportedSessions(mapped, capabilitiesHeader)
      }
      const rawChildren = yield* SessionError.mapStorageNotFound(session.children(ctx.params.sessionID))
      return ProductModePolicy.filterSupportedSessions(rawChildren, capabilitiesHeader)
    })

    const todo = Effect.fn("SessionHttpApi.todo")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireRuntimeSession(ctx.params.sessionID)
      // TaskTable is the single source in both runtimes; SessionTodo projects
      // the legacy three-field shape from it.
      const v2todo = yield* SessionTodo.Service
      return yield* v2todo.get(ctx.params.sessionID)
    })

    const task = Effect.fn("SessionHttpApi.task")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: ReadonlyArray<SessionTask.WriteInfo>
    }) {
      yield* requireRuntimeSession(ctx.params.sessionID)
      const v2task = yield* SessionTask.Service
      return yield* v2task.update({ sessionID: ctx.params.sessionID, tasks: ctx.payload }).pipe(
        // A forged/repeated id or dead schedule is a client error, not a 500.
        Effect.catchTag("SessionTask.TaskWriteError", (error) =>
          Effect.fail(new InvalidRequestError({ message: error.message })),
        ),
      )
    })

    const getTask = Effect.fn("SessionHttpApi.getTask")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireRuntimeSession(ctx.params.sessionID)
      const v2task = yield* SessionTask.Service
      return yield* v2task.get(ctx.params.sessionID)
    })

    // Atomic single-task mutations (differential-review HIGH-2): each touches
    // only the named row, so a stale client cache can never delete a task that
    // was appended server-side but whose SSE event hasn't reached the client yet.
    const patchTask = Effect.fn("SessionHttpApi.patchTask")(function* (ctx: {
      params: { sessionID: SessionID; taskID: string }
      payload: {
        status?: SessionTaskSchema.TaskStatus
        content?: string
        priority?: SessionTaskSchema.TaskPriority
        expectedRevision?: number
      }
    }) {
      yield* requireRuntimeSession(ctx.params.sessionID)
      const v2task = yield* SessionTask.Service
      const hasFields = ctx.payload.content !== undefined || ctx.payload.priority !== undefined
      if (!hasFields && ctx.payload.status === undefined) {
        return yield* Effect.fail(
          new InvalidRequestError({ message: "At least one of status, content, or priority is required" }),
        )
      }
      // P3-d: field updates route to updateTask; status routes to patch. When
      // both are requested, updateTask runs first and its returned revision
      // guards the subsequent patch. undefined means not-found or stale revision.
      let result: typeof SessionTask.Info.Type | undefined
      if (hasFields) {
        result = yield* v2task
          .updateTask({
            sessionID: ctx.params.sessionID,
            id: ctx.params.taskID,
            content: ctx.payload.content,
            priority: ctx.payload.priority,
            expectedRevision: ctx.payload.expectedRevision,
          })
          .pipe(
            Effect.catchTag("SessionTask.TaskWriteError", (error) =>
              Effect.fail(new InvalidRequestError({ message: error.message })),
            ),
          )
        if (!result) {
          return yield* Effect.fail(
            notFound(`Task ${ctx.params.taskID} not found or revision is stale in session ${ctx.params.sessionID}`),
          )
        }
      }
      if (ctx.payload.status !== undefined) {
        result = yield* v2task
          .patch({
            sessionID: ctx.params.sessionID,
            id: ctx.params.taskID,
            status: ctx.payload.status,
            expectedRevision: result?.revision ?? ctx.payload.expectedRevision,
          })
          .pipe(
            // Resuming a schedule-less task to `scheduled` is rejected by the
            // domain invariant (HIGH-4) - surface it as a client error, not a 500.
            Effect.catchTag("SessionTask.TaskWriteError", (error) =>
              Effect.fail(new InvalidRequestError({ message: error.message })),
            ),
          )
        if (!result) {
          return yield* Effect.fail(
            notFound(`Task ${ctx.params.taskID} not found or revision is stale in session ${ctx.params.sessionID}`),
          )
        }
      }
      // The early guard ensures at least one branch ran; this final guard
      // satisfies the endpoint's non-undefined Info return type.
      if (!result) return yield* Effect.fail(new InvalidRequestError({ message: "Unable to update task" }))
      return result
    })

    const createTask = Effect.fn("SessionHttpApi.createTask")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: SessionTask.WriteInfo
    }) {
      yield* requireRuntimeSession(ctx.params.sessionID)
      const v2task = yield* SessionTask.Service
      // The server owns id generation on create: a client-supplied id on POST
      // could collide with the global task PK or enable cycle forgery
      // (differential-review re-review HIGH-2). `append` mints a fresh `tsk_`.
      const created = yield* v2task
        .append({
          sessionID: ctx.params.sessionID,
          tasks: [
            {
              content: ctx.payload.content,
              status: ctx.payload.status,
              priority: ctx.payload.priority,
              ...(ctx.payload.parentID !== undefined ? { parentID: ctx.payload.parentID } : {}),
              ...(ctx.payload.agentID !== undefined ? { agentID: ctx.payload.agentID } : {}),
              ...(ctx.payload.scheduledAt !== undefined ? { scheduledAt: ctx.payload.scheduledAt } : {}),
              ...(ctx.payload.recurrence !== undefined ? { recurrence: ctx.payload.recurrence } : {}),
              ...(ctx.payload.spawnedFrom !== undefined ? { spawnedFrom: ctx.payload.spawnedFrom } : {}),
              ...(ctx.payload.dependsOn !== undefined ? { dependsOn: ctx.payload.dependsOn } : {}),
            },
          ],
        })
        .pipe(
          // A forged/repeated id or dead schedule is a client error, not a 500.
          Effect.catchTag("SessionTask.TaskWriteError", (error) =>
            Effect.fail(new InvalidRequestError({ message: error.message })),
          ),
        )
      // `append` returns the full position-ordered list; the newly appended row
      // carries the highest position (re-review MEDIUM-1), so `.at(-1)` is the
      // created task even in a pre-populated session. An empty result for a
      // single-item append is an infrastructure invariant violation → 500
      // defect, not a client 404.
      const createdTask = created.at(-1)
      if (!createdTask) {
        return yield* Effect.die("SessionTask.append returned no task for a single-item create")
      }
      return createdTask
    })

    const deleteTask = Effect.fn("SessionHttpApi.deleteTask")(function* (ctx: {
      params: { sessionID: SessionID; taskID: string }
    }) {
      yield* requireRuntimeSession(ctx.params.sessionID)
      const v2task = yield* SessionTask.Service
      const removed = yield* v2task.removeTask({ sessionID: ctx.params.sessionID, id: ctx.params.taskID })
      if (!removed) {
        return yield* Effect.fail(notFound(`Task ${ctx.params.taskID} not found in session ${ctx.params.sessionID}`))
      }
      return removed
    })

    // P3-d: reorder a session's task list by id. The ids must be a permutation
    // of the current task ids; expectedRevision (max observed) rejects stale
    // reorders. TaskWriteError (foreign/duplicate/stale_revision) -> 400.
    const reorderTask = Effect.fn("SessionHttpApi.reorderTask")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: { ids: readonly string[]; expectedRevision?: number }
    }) {
      yield* requireRuntimeSession(ctx.params.sessionID)
      const v2task = yield* SessionTask.Service
      return yield* v2task
        .reorder({
          sessionID: ctx.params.sessionID,
          ids: ctx.payload.ids,
          expectedRevision: ctx.payload.expectedRevision,
        })
        .pipe(
          Effect.catchTag("SessionTask.TaskWriteError", (error) =>
            Effect.fail(new InvalidRequestError({ message: error.message })),
          ),
        )
    })

    const diff = Effect.fn("SessionHttpApi.diff")(function* (ctx: {
      params: { sessionID: SessionID }
      query: typeof DiffQuery.Type
    }) {
      const info = yield* requireRuntimeSession(ctx.params.sessionID)
      if (ProductModePolicy.shouldUseV2Runtime(info.mode, AIGCFROGE_V2_RUNTIME)) {
        const v2summary = yield* V2SessionSummary.Service
        return yield* v2summary.diff({
          sessionID: ctx.params.sessionID,
          ...(ctx.query.messageID ? { messageID: SessionMessage.ID.make(ctx.query.messageID) } : {}),
        })
      }
      return yield* summary.diff({ sessionID: ctx.params.sessionID, messageID: ctx.query.messageID })
    })

    const messages = Effect.fn("SessionHttpApi.messages")(function* (ctx: {
      params: { sessionID: SessionID }
      query: typeof MessagesQuery.Type
    }) {
      if (ctx.query.before && ctx.query.limit === undefined) return yield* new HttpApiError.BadRequest({})
      if (ctx.query.before) {
        const before = ctx.query.before
        yield* Effect.try({
          try: () => MessageV2.cursor.decode(before),
          catch: () => new HttpApiError.BadRequest({}),
        })
      }
      yield* requireRuntimeSession(ctx.params.sessionID)
      // messages/message endpoints stay on the V1 path (MessageV2.page / session.messages)
      // even when AIGCFROGE_V2_RUNTIME=true. The V2 session_message table only stores
      // metadata events (agent-switched/model-switched); the actual conversation
      // (user/assistant + parts) is written to the V1 message+part tables by both V1
      // and V2 runtimes. v2s.messages reads session_message and returns flat V2
      // SessionMessage.Message[] - incomplete data AND wrong shape (API schema expects
      // SessionV1.WithParts[] = { info, parts }). Stay V1 until V2 message storage is
      // complete and a V2->WithParts adapter exists.
      if (ctx.query.limit === undefined || ctx.query.limit === 0) {
        return yield* SessionError.mapStorageNotFound(session.messages({ sessionID: ctx.params.sessionID }))
      }

      const page = yield* SessionError.mapStorageNotFound(
        MessageV2.page({
          sessionID: ctx.params.sessionID,
          limit: ctx.query.limit,
          before: ctx.query.before,
        }),
      )
      if (!page.cursor) return page.items

      const request = yield* HttpServerRequest.HttpServerRequest
      // toURL() honors the Host + x-forwarded-proto headers, so the Link
      // header echoes the real origin instead of a hard-coded localhost.
      const url = Option.getOrElse(HttpServerRequest.toURL(request), () => new URL(request.url, "http://localhost"))
      url.searchParams.set("limit", ctx.query.limit.toString())
      url.searchParams.set("before", page.cursor)
      return HttpServerResponse.jsonUnsafe(page.items, {
        headers: {
          "Access-Control-Expose-Headers": "Link, X-Next-Cursor",
          Link: `<${url.toString()}>; rel="next"`,
          "X-Next-Cursor": page.cursor,
        },
      })
    })

    const message = Effect.fn("SessionHttpApi.message")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID }
    }) {
      yield* requireRuntimeSession(ctx.params.sessionID)
      // V1 path: MessageV2.get reads message+part tables, returns WithParts.
      // See `messages` handler comment for why this endpoint stays V1.
      return yield* SessionError.mapStorageNotFound(
        MessageV2.get({ sessionID: ctx.params.sessionID, messageID: ctx.params.messageID }),
      )
    })

    const create = Effect.fn("SessionHttpApi.create")(function* (ctx: {
      payload?: Session.CreateInput
    }) {
      yield* ProductModePolicy.assertCreationSupported(ctx.payload?.mode)
      // create stays on the V1 path (shareSvc.create) even when AIGCFROGE_V2_RUNTIME=true.
      // V2 SessionV2.create requires an explicit location.directory, but the create
      // endpoint is registered via handleRaw and the client (submit.ts) calls
      // session.create() without passing directory. V1 shareSvc.create resolves the
      // directory via the V1 Session service's workspace context. Re-enable V2 create
      // once the client passes directory or V2 create can resolve it from context.
      return yield* shareSvc.create(ctx.payload)
    })

    const createRaw = Effect.fn("SessionHttpApi.createRaw")(function* (ctx: {
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      if (body.trim().length === 0) return yield* create({})

      const json = yield* tryParseJson(body)
      const decoded = yield* Schema.decodeUnknownEffect(Session.CreateInput)(json).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
      const payload = decoded
        ? {
            ...decoded,
            permission: decoded.permission ? [...decoded.permission] : undefined,
          }
        : decoded
      return yield* create({ payload })
    })

    const remove = Effect.fn("SessionHttpApi.remove")(function* (ctx: { params: { sessionID: SessionID } }) {
      const info = yield* requireRuntimeSession(ctx.params.sessionID)
      if (ProductModePolicy.shouldUseV2Runtime(info.mode, AIGCFROGE_V2_RUNTIME)) {
        const v2s = yield* SessionV2.Service
        yield* v2s.remove(ctx.params.sessionID).pipe(
          Effect.catchTag("Session.NotFoundError", (error) => Effect.fail(v2SessionNotFound(error))),
        )
        return true
      }
      yield* SessionError.mapStorageNotFound(session.remove(ctx.params.sessionID))
      return true
    })

    const overrideNotFound = (sessionID: SessionID) =>
      Effect.fail(notFound(`Session not found: ${sessionID}`))

    const overrideGet = Effect.fnUntraced(function* (sessionID: SessionID) {
      yield* requireSession(sessionID)
      return yield* permissionOverrideSvc.get(sessionID).pipe(
        Effect.catchTag("Session.NotFoundError", () => overrideNotFound(sessionID)),
      )
    })

    const overrideStatus = Effect.fn("SessionHttpApi.overrideStatus")(function* (sessionID: SessionID) {
      return { enabled: yield* overrideGet(sessionID) }
    })

    const putOverride = Effect.fn("SessionHttpApi.putOverride")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: { acknowledged?: boolean }
    }) {
      yield* requireRuntimeSession(ctx.params.sessionID)
      const active = yield* permissionOverrideSvc
        .get(ctx.params.sessionID)
        .pipe(Effect.catchTag("Session.NotFoundError", () => overrideNotFound(ctx.params.sessionID)))
      if (!active && ctx.payload.acknowledged !== true) {
        return yield* new InvalidRequestError({
          message: "First activation of the permission override requires acknowledged:true",
          kind: "permission-override",
        })
      }
      yield* (active ? permissionOverrideSvc.renew : permissionOverrideSvc.enable)(ctx.params.sessionID).pipe(
        Effect.catchTag("PermissionOverride.UnavailableError", (error) =>
          Effect.fail(
            new InvalidRequestError({
              message: error.reason === "child-session"
                ? "Permission override is only available for root sessions"
                : "Permission override is not available for unattended sessions",
              kind: "permission-override",
            }),
          ),
        ),
        Effect.catchTag("Session.NotFoundError", () => overrideNotFound(ctx.params.sessionID)),
      )
      return { enabled: true }
    })

    const deleteOverride = Effect.fn("SessionHttpApi.deleteOverride")(function* (ctx: {
      params: { sessionID: SessionID }
    }) {
      yield* requireRuntimeSession(ctx.params.sessionID)
      yield* permissionOverrideSvc.disable(ctx.params.sessionID)
      return { enabled: false }
    })

    const update = Effect.fn("SessionHttpApi.update")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof UpdatePayload.Type
    }) {
      const current = yield* requireSession(ctx.params.sessionID)
      if (ctx.payload.title !== undefined) {
        if (ProductModePolicy.shouldUseV2Runtime(current.mode, AIGCFROGE_V2_RUNTIME)) {
          const v2s = yield* SessionV2.Service
          yield* v2s.setTitle({ sessionID: ctx.params.sessionID, title: ctx.payload.title }).pipe(
            Effect.catchTag("Session.NotFoundError", (error) => Effect.fail(v2SessionNotFound(error))),
          )
        } else {
          yield* session.setTitle({ sessionID: ctx.params.sessionID, title: ctx.payload.title })
        }
      }
      if (ctx.payload.metadata !== undefined) {
        yield* session.setMetadata({ sessionID: ctx.params.sessionID, metadata: ctx.payload.metadata })
      }
      if (ctx.payload.permission !== undefined) {
        yield* session.setPermission({
          sessionID: ctx.params.sessionID,
          permission: Permission.merge(current.permission ?? [], ctx.payload.permission),
        })
      }
      if (ctx.payload.permissionTier !== undefined) {
        yield* session
          .setPermissionTier({
            sessionID: ctx.params.sessionID,
            permissionTier: ctx.payload.permissionTier,
          })
          .pipe(
            Effect.catchTag("Session.PermissionTierError", (error) =>
              Effect.fail(
                new InvalidRequestError({
                  message:
                    error.reason === "child-session"
                      ? "Permission tier is only available for root sessions"
                      : "Permission tier is not available for unattended sessions",
                  kind: "permission-tier",
                }),
              ),
            ),
            Effect.catchTag("NotFoundError", () =>
              Effect.fail(notFound(`Session not found: ${ctx.params.sessionID}`)),
            ),
          )
      }
      if (ctx.payload.time?.archived !== undefined) {
        yield* session.setArchived({ sessionID: ctx.params.sessionID, time: ctx.payload.time.archived })
      }
      return yield* requireSession(ctx.params.sessionID)
    })

    // Copy the parent's task list into a forked session as a three-field
    // projection: ids, spawned_from, depends_on, parent_id, schedules and
    // digests are dropped so the copy holds no dangling references and cannot
    // re-fire the parent's schedules. The update publishes task.updated /
    // todo.updated for the child, so clients refresh on their own.
    const copyForkTasks = Effect.fn("SessionHttpApi.copyForkTasks")(function* (
      sourceID: SessionID,
      childID: SessionID,
    ) {
      const v2task = yield* SessionTask.Service
      const tasks = yield* v2task.get(sourceID)
      if (tasks.length === 0) return
      yield* v2task
        .update({
          sessionID: childID,
          tasks: tasks.map((task) => ({
            content: task.content,
            // Never resume in-flight or scheduled work in the fork: the copy
            // carries no trigger, and a bare `scheduled` row would be rejected
            // as a dead schedule.
            status: task.status === "in_progress" || task.status === "scheduled" ? "pending" : task.status,
            priority: task.priority,
          })),
        })
        .pipe(
          // No client-supplied ids or schedules here, so a write error is
          // theoretically unreachable; surface it as a client-agnostic 400
          // (the only error the fork endpoint declares besides 404).
          Effect.catchTag("SessionTask.TaskWriteError", () => Effect.fail(new HttpApiError.BadRequest({}))),
        )
    })

    const fork = Effect.fn("SessionHttpApi.fork")(function* (ctx: {
      params: { sessionID: SessionID }
      payload?: typeof ForkPayload.Type
    }) {
      const original = yield* requireSession(ctx.params.sessionID)
      // MEDIUM-5: the creation gate exists to block generic ROOT creation of
      // custom sessions; fork is not root creation. A custom parent falls
      // through to the V2 branch, where create({parentID}) copies the frozen
      // snapshot (orphan custom parents fail typed via the SnapshotNotFound
      // catchTag below). Root custom creation stays blocked on session.create.
      if (original.mode !== "custom") {
        yield* ProductModePolicy.assertCreationSupported(original.mode).pipe(
          Effect.mapError(unsupportedProductMode),
        )
      }
      if (ProductModePolicy.shouldUseV2Runtime(original.mode, AIGCFROGE_V2_RUNTIME)) {
        const v2s = yield* SessionV2.Service
        const parent = yield* SessionError.mapStorageNotFound(session.get(ctx.params.sessionID))
        if (parent.mode !== "custom") {
          yield* ProductModePolicy.assertCreationSupported(parent.mode).pipe(
            Effect.mapError(unsupportedProductMode),
          )
        }
        const child = yield* v2s
          .create({
            location: { directory: AbsolutePath.make(parent.directory) },
            parentID: parent.id,
            mode: parent.mode,
          })
          .pipe(
            // Custom-parent delegation/snapshot rejections surface as a
            // client-agnostic 400, mirroring the copyForkTasks precedent above.
            Effect.catchTag("Session.PromptConflictError", () => Effect.fail(new HttpApiError.BadRequest({}))),
            Effect.catchTag("SessionComposition.AgentDelegationForbiddenError", () =>
              Effect.fail(new HttpApiError.BadRequest({})),
            ),
            Effect.catchTag("SessionComposition.SnapshotNotFoundError", () =>
              Effect.fail(new HttpApiError.BadRequest({})),
            ),
            Effect.catchTag("SessionComposition.SnapshotDecodeError", () =>
              Effect.fail(new HttpApiError.BadRequest({})),
            ),
          )
        const shareSvc = yield* SessionShareV2.Service
        yield* shareSvc
          .share({
            sourceSessionID: ctx.params.sessionID,
            targetSessionID: child.id,
            scope: "full",
            trigger: true,
          })
          .pipe(Effect.catchTag("Session.NotFoundError", (error) => Effect.fail(v2SessionNotFound(error))))
        yield* copyForkTasks(ctx.params.sessionID, child.id)
        return v2InfoToV1(child)
      }
      const child = yield* session
        .fork({
          sessionID: ctx.params.sessionID,
          messageID: ctx.payload?.messageID,
        })
        .pipe(
          Effect.catchTag("UnsupportedProductModeError", (error) => Effect.fail(unsupportedProductMode(error))),
          Effect.catchTag("NotFoundError", (error) => Effect.fail(notFound(error.message))),
        )
      yield* copyForkTasks(ctx.params.sessionID, child.id)
      return child
    })

    const forkRaw = Effect.fn("SessionHttpApi.forkRaw")(function* (ctx: {
      params: { sessionID: SessionID }
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      if (body.trim().length === 0) return yield* fork({ params: ctx.params })

      const json = yield* tryParseJson(body)
      const payload = yield* Schema.decodeUnknownEffect(ForkPayload)(json).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
      return yield* fork({ params: ctx.params, payload })
    })

    const abort = Effect.fn("SessionHttpApi.abort")(function* (ctx: { params: { sessionID: SessionID } }) {
      const current = yield* Effect.option(session.get(ctx.params.sessionID))
      if (Option.isNone(current)) return true
      const info = yield* requireRuntimeSession(ctx.params.sessionID)
      if (ProductModePolicy.shouldUseV2Runtime(info.mode, AIGCFROGE_V2_RUNTIME)) {
        const v2session = yield* SessionV2.Service
        yield* v2session.interrupt(ctx.params.sessionID)
        return true
      }
      yield* promptSvc.cancel(ctx.params.sessionID)
      return true
    })

    const init = Effect.fn("SessionHttpApi.init")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof InitPayload.Type
    }) {
      const info = yield* requireRuntimeSession(ctx.params.sessionID)
      if (ProductModePolicy.shouldUseV2Runtime(info.mode, AIGCFROGE_V2_RUNTIME)) {
        const v2s = yield* SessionV2.Service
        yield* v2s.skill({ sessionID: ctx.params.sessionID, skill: Command.Default.INIT, resume: false }).pipe(
          Effect.catchTag("Session.NotFoundError", (error) => Effect.fail(v2SessionNotFound(error))),
          Effect.catchTag("Session.PromptConflictError", () => Effect.fail(new HttpApiError.BadRequest({}))),
          Effect.catchTag("SessionComposition.SnapshotNotFoundError", () =>
            Effect.fail(notFound(`Snapshot not found for session ${ctx.params.sessionID}`)),
          ),
          Effect.catchTag("SessionComposition.SnapshotDecodeError", () =>
            Effect.fail(new HttpApiError.BadRequest({})),
          ),
        )
        return true
      }
      yield* promptSvc
        .command({
          sessionID: ctx.params.sessionID,
          messageID: ctx.payload.messageID,
          model: `${ctx.payload.providerID}/${ctx.payload.modelID}`,
          command: Command.Default.INIT,
          arguments: "",
        })
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      return true
    })

    // share/unshare errors aren't all client-induced — storage and network
    // failures from SessionShare are real possibilities. Map to a typed 500
    // (matches the legacy route behavior which routed any failure through
    // ErrorMiddleware → NamedError.Unknown 500) instead of blanket-mapping
    // every failure to a 400 BadRequest.
    const share = Effect.fn("SessionHttpApi.share")(function* (ctx: { params: { sessionID: SessionID } }) {
      const info = yield* requireRuntimeSession(ctx.params.sessionID)
      if (ProductModePolicy.shouldUseV2Runtime(info.mode, AIGCFROGE_V2_RUNTIME)) {
        const shareSvc2 = yield* SessionShareV2.Service
        yield* shareSvc2
          .share({
            sourceSessionID: ctx.params.sessionID,
            targetSessionID: ctx.params.sessionID,
            scope: "full",
            trigger: false,
          })
          .pipe(Effect.catchTag("Session.NotFoundError", (error) => Effect.fail(v2SessionNotFound(error))))
      } else {
        yield* shareSvc.share(ctx.params.sessionID).pipe(Effect.mapError(() => new HttpApiError.InternalServerError({})))
      }
      return yield* requireRuntimeSession(ctx.params.sessionID)
    })

    const unshare = Effect.fn("SessionHttpApi.unshare")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireRuntimeSession(ctx.params.sessionID)
      yield* shareSvc
        .unshare(ctx.params.sessionID)
        .pipe(Effect.mapError(() => new HttpApiError.InternalServerError({})))
      return yield* requireRuntimeSession(ctx.params.sessionID)
    })

    const summarize = Effect.fn("SessionHttpApi.summarize")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof SummarizePayload.Type
    }) {
      const info = yield* requireRuntimeSession(ctx.params.sessionID)
      yield* revertSvc.cleanup(info)
      if (ProductModePolicy.shouldUseV2Runtime(info.mode, AIGCFROGE_V2_RUNTIME)) {
        const v2s = yield* SessionV2.Service
        yield* v2s.compact({ sessionID: ctx.params.sessionID }).pipe(
          Effect.catchTag("Session.NotFoundError", (error) => Effect.fail(v2SessionNotFound(error))),
          Effect.catchTag("Session.OperationUnavailableError", () => Effect.fail(v2OperationUnavailable())),
        )
        return true
      }
      const messages = yield* SessionError.mapStorageNotFound(session.messages({ sessionID: ctx.params.sessionID }))
      const defaultAgent = yield* agentSvc.defaultAgent()
      const currentAgent = messages.findLast((message) => message.info.role === "user")?.info.agent ?? defaultAgent

      yield* compactSvc.create({
        sessionID: ctx.params.sessionID,
        agent: currentAgent,
        model: {
          providerID: ctx.payload.providerID,
          modelID: ctx.payload.modelID,
        },
        auto: ctx.payload.auto ?? false,
      })
      yield* promptSvc.loop({ sessionID: ctx.params.sessionID })
      return true
    })

    const prompt = Effect.fn("SessionHttpApi.prompt")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof PromptPayload.Type
    }) {
      const info = yield* requireRuntimeSession(ctx.params.sessionID)
      if (info.mode === "custom") return yield* v1SyncUnsupportedForCustom(info.mode)
      // prompt/command/shell stay on the V1 path even when AIGCFROGE_V2_RUNTIME=true.
      // V2 v2s.prompt/v2s.skill/v2session.shell return SessionInput.Admitted (a flat
      // durable-inbox admission record) but the API success schema is SessionV1.WithParts
      // ({info, parts}). No Admitted->WithParts adapter exists, and the message/parts are
      // not synchronously materialized after admission (V2 runner drains async). V1
      // promptSvc returns WithParts directly. Re-enable V2 once the adapter + sync
      // materialization exist.
      const message = yield* promptSvc
        .prompt({
          ...ctx.payload,
          sessionID: ctx.params.sessionID,
        })
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      return HttpServerResponse.stream(Stream.make(JSON.stringify(message)).pipe(Stream.encodeText), {
        contentType: "application/json",
      })
    })

    const promptAsync = Effect.fn("SessionHttpApi.promptAsync")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof PromptPayload.Type
    }) {
      const info = yield* requireRuntimeSession(ctx.params.sessionID)
      if (ProductModePolicy.shouldUseV2Runtime(info.mode, AIGCFROGE_V2_RUNTIME)) {
        const v2session = yield* SessionV2.Service
        // Extract text from the V1 prompt payload's first text part.
        const parts = ctx.payload.parts as Array<{ type: string; text?: string }> | undefined
        const textPart = parts?.find((p) => p.type === "text")
        const promptText = textPart?.text ?? ""
        if (promptText) {
          yield* v2session
            .prompt({
              sessionID: ctx.params.sessionID,
              prompt: { text: promptText },
              delivery: "steer",
              resume: true,
            })
            .pipe(Effect.ignore)
        }
        return HttpApiSchema.NoContent.make()
      }
      yield* promptSvc.prompt({ ...ctx.payload, sessionID: ctx.params.sessionID }).pipe(
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            yield* Effect.logError("prompt_async failed", { sessionID: ctx.params.sessionID, cause })
            yield* events.publish(Session.Event.Error, {
              sessionID: ctx.params.sessionID,
              error: new NamedError.Unknown({ message: Cause.pretty(cause) }).toObject(),
            })
            // When prompt fails (including enforcePrimary dying outside runLoop), Runner.onIdle
            // never fires, so set idle explicitly — otherwise the frontend working() stays true
            // and the spinner hangs. status.set(idle) publishes session.status + session.idle
            // events, which the frontend uses to clear loading.
            yield* statusSvc.set(ctx.params.sessionID, { type: "idle" })
          }),
        ),
        Effect.forkIn(scope, { startImmediately: true }),
      )
      return HttpApiSchema.NoContent.make()
    })

    const command = Effect.fn("SessionHttpApi.command")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof CommandPayload.Type
    }) {
      const info = yield* requireRuntimeSession(ctx.params.sessionID)
      if (info.mode === "custom") return yield* v1SyncUnsupportedForCustom(info.mode)
      // command stays V1 - see prompt handler comment (V2 v2s.skill returns Admitted, API expects WithParts)
      return yield* promptSvc
        .command({ ...ctx.payload, sessionID: ctx.params.sessionID })
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
    })

    const shell = Effect.fn("SessionHttpApi.shell")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof ShellPayload.Type
    }) {
      const info = yield* requireRuntimeSession(ctx.params.sessionID)
      if (info.mode === "custom") return yield* v1SyncUnsupportedForCustom(info.mode)
      // shell stays V1 - see prompt handler comment (V2 v2session.shell returns Admitted, API expects WithParts)
      return yield* SessionError.mapBusy(promptSvc.shell({ ...ctx.payload, sessionID: ctx.params.sessionID }))
    })

    const revert = Effect.fn("SessionHttpApi.revert")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof RevertPayload.Type
    }) {
      const info = yield* requireRuntimeSession(ctx.params.sessionID)
      if (ProductModePolicy.shouldUseV2Runtime(info.mode, AIGCFROGE_V2_RUNTIME)) {
        const v2revert = yield* V2SessionRevert.Service
        const result = yield* v2revert.revert({
          sessionID: ctx.params.sessionID,
          messageID: ctx.payload.messageID as unknown as SessionMessage.ID,
        })
        return v2InfoToV1(result)
      }
      return yield* SessionError.mapBusy(revertSvc.revert({ sessionID: ctx.params.sessionID, ...ctx.payload }))
    })

    const unrevert = Effect.fn("SessionHttpApi.unrevert")(function* (ctx: { params: { sessionID: SessionID } }) {
      const info = yield* requireRuntimeSession(ctx.params.sessionID)
      if (ProductModePolicy.shouldUseV2Runtime(info.mode, AIGCFROGE_V2_RUNTIME)) {
        const v2revert = yield* V2SessionRevert.Service
        const result = yield* v2revert.unrevert({ sessionID: ctx.params.sessionID })
        return v2InfoToV1(result)
      }
      return yield* SessionError.mapBusy(revertSvc.unrevert({ sessionID: ctx.params.sessionID }))
    })

    const permissionRespond = Effect.fn("SessionHttpApi.permissionRespond")(function* (ctx: {
      params: { sessionID: SessionID; permissionID: PermissionV1.ID }
      payload: typeof PermissionResponsePayload.Type
    }) {
      const info = yield* requireRuntimeSession(ctx.params.sessionID)
      if (ProductModePolicy.shouldUseV2Runtime(info.mode, AIGCFROGE_V2_RUNTIME)) {
        const v2perm = yield* PermissionV2.Service
        yield* v2perm.reply({
          requestID: PermissionV2.ID.make(ctx.params.permissionID),
          reply: ctx.payload.response,
        }).pipe(
          Effect.catchTag("PermissionV2.NotFoundError", (error) =>
            Effect.fail(
              new PermissionNotFoundError({
                requestID: String(error.requestID),
                message: `Permission request not found: ${error.requestID}`,
              }),
            ),
          ),
        )
      } else {
        yield* permissionSvc.reply({ requestID: ctx.params.permissionID, reply: ctx.payload.response }).pipe(
          Effect.catchTag("Permission.NotFoundError", (error) =>
            Effect.fail(
              new PermissionNotFoundError({
                requestID: String(error.requestID),
                message: `Permission request not found: ${error.requestID}`,
              }),
            ),
          ),
        )
      }
      return true
    })

    const deleteMessage = Effect.fn("SessionHttpApi.deleteMessage")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID }
    }) {
      const info = yield* requireRuntimeSession(ctx.params.sessionID)
      yield* SessionError.mapBusy(runState.assertNotBusy(ctx.params.sessionID))
      if (ProductModePolicy.shouldUseV2Runtime(info.mode, AIGCFROGE_V2_RUNTIME)) {
        const v2s = yield* SessionV2.Service
        yield* v2s.removeMessage({
          sessionID: ctx.params.sessionID,
          messageID: SessionMessage.ID.make(ctx.params.messageID),
        }).pipe(
          Effect.catchTag("Session.NotFoundError", (error) => Effect.fail(v2SessionNotFound(error))),
        )
        return true
      }
      yield* session.removeMessage(ctx.params)
      return true
    })

    const deletePart = Effect.fn("SessionHttpApi.deletePart")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID; partID: PartID }
    }) {
      yield* requireRuntimeSession(ctx.params.sessionID)
      yield* session.removePart(ctx.params)
      return true
    })

    const updatePart = Effect.fn("SessionHttpApi.updatePart")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID; partID: PartID }
      payload: typeof SessionV1.Part.Type
    }) {
      yield* requireRuntimeSession(ctx.params.sessionID)
      const payload = ctx.payload as SessionV1.Part
      if (
        payload.id !== ctx.params.partID ||
        payload.messageID !== ctx.params.messageID ||
        payload.sessionID !== ctx.params.sessionID
      ) {
        return yield* new HttpApiError.BadRequest({})
      }
      return yield* session.updatePart(payload)
    })

    const cacheDiagnostics = Effect.fn("SessionHttpApi.cacheDiagnostics")(function* (ctx: {
      params: { sessionID: SessionID }
    }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* getCacheDiagnostics(db, ctx.params.sessionID).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
    })

    const toolSummary = Effect.fn("SessionHttpApi.toolSummary")(function* (ctx: {
      params: { sessionID: SessionID }
    }) {
      const info = yield* requireSession(ctx.params.sessionID)
      if (ProductModePolicy.shouldUseV2Runtime(info.mode, AIGCFROGE_V2_RUNTIME)) {
        const v2s = yield* SessionV2.Service
        return yield* v2s.toolSummary(ctx.params.sessionID).pipe(
          Effect.catchTag("Session.NotFoundError", (error) => Effect.fail(v2SessionNotFound(error))),
          Effect.catchTag("Session.MessageDecodeError", () => Effect.fail(new HttpApiError.BadRequest({}))),
        )
      }
      return []
    })

    const composition = Effect.fn("SessionHttpApi.composition")(function* (ctx: {
      params: { sessionID: SessionID }
    }) {
      const info = yield* requireRuntimeSession(ctx.params.sessionID)
      // SessionComposition is Location-scoped and resolved through the
      // LocationServiceMap for the session's directory.
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(info.directory) }))
      const sessionComp = yield* SessionComposition.Service.pipe(Effect.provide(layer), Effect.orDie)
      const snapshot = yield* sessionComp.get(ctx.params.sessionID).pipe(
        Effect.catchTag("SessionComposition.SnapshotNotFoundError", () =>
          Effect.fail(notFound(`Snapshot not found for session ${ctx.params.sessionID}`)),
        ),
        Effect.catchTag("SessionComposition.SnapshotDecodeError", () =>
          Effect.fail(new HttpApiError.BadRequest({})),
        ),
      )
      return snapshot
    })

    const compositionRaw = Effect.fn("SessionHttpApi.compositionRaw")(function* (ctx: {
      params: { sessionID: SessionID }
      request: HttpServerRequest.HttpServerRequest
    }) {
      // Use the raw handler to bypass HttpApi's automatic response encoding
      // for the top-level Snapshot class, which has a known Effect Schema
      // encode issue in the current version.
      const snapshot = yield* composition({ params: ctx.params })
      const encoded = Schema.encodeUnknownSync(Composition.Snapshot)(snapshot)
      return yield* HttpServerResponse.json(encoded).pipe(Effect.orDie)
    })

    return handlers
      .handle("list", list)
      .handle("status", status)
      .handle("get", get)
      .handle("children", children)
      .handle("todo", todo)
      .handle("task", task)
      .handle("getTask", getTask)
      .handle("patchTask", patchTask)
      .handle("createTask", createTask)
      .handle("deleteTask", deleteTask)
      .handle("reorderTask", reorderTask)
      .handle("diff", diff)
      .handle("messages", messages)
      .handle("message", message)
      .handleRaw("create", createRaw)
      .handle("remove", remove)
      .handle("update", update)
      .handleRaw("fork", forkRaw)
      .handle("abort", abort)
      .handle("init", init)
      .handle("share", share)
      .handle("unshare", unshare)
      .handle("summarize", summarize)
      .handle("prompt", prompt)
      .handle("promptAsync", promptAsync)
      .handle("command", command)
      .handle("shell", shell)
      .handle("revert", revert)
      .handle("unrevert", unrevert)
      .handle("permissionRespond", permissionRespond)
      .handle("getPermissionOverride", (ctx: { params: { sessionID: SessionID } }) =>
        overrideStatus(ctx.params.sessionID),
      )
      .handle("putPermissionOverride", putOverride)
      .handle("deletePermissionOverride", deleteOverride)
      .handle("deleteMessage", deleteMessage)
      .handle("deletePart", deletePart)
      .handle("updatePart", updatePart)
      .handle("cacheDiagnostics", cacheDiagnostics)
      .handle("toolSummary", toolSummary)
      .handleRaw("composition", compositionRaw)
  }).pipe(Effect.provide(LocationServiceMap.layer)),
)
