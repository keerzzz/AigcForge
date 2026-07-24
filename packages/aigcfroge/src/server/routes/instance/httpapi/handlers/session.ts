import { PermissionV1 } from "@aigcfroge/core/v1/permission"
import { Agent } from "@/agent/agent"
import { SessionV1 } from "@aigcfroge/core/v1/session"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionTodo } from "@aigcfroge/core/session/todo"
import { PermissionV2 } from "@aigcfroge/core/permission"
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
import { Todo } from "@/session/todo"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { getCacheDiagnostics } from "@aigcfroge/core/session/cache-diagnostics"
import { Database } from "@aigcfroge/core/database/database"
import { NamedError } from "@aigcfroge/core/util/error"
import { Cause, Effect, Option, Schema, Scope } from "effect"
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
import { PermissionNotFoundError } from "../errors"
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
    const todoSvc = yield* Todo.Service
    const summary = yield* SessionSummary.Service
    const events = yield* EventV2Bridge.Service
    const { db } = yield* Database.Service
    const scope = yield* Scope.Scope

    const list = Effect.fn("SessionHttpApi.list")(function* (ctx: { query: typeof ListQuery.Type }) {
      return yield* session.list({
        directory: ctx.query.scope === "project" ? undefined : ctx.query.directory,
        scope: ctx.query.scope,
        mode: ctx.query.mode,
        path: ctx.query.path,
        roots: ctx.query.roots,
        start: ctx.query.start,
        search: ctx.query.search,
        limit: ctx.query.limit,
      })
    })

    const status = Effect.fn("SessionHttpApi.status")(function* () {
      return Object.fromEntries(yield* statusSvc.list())
    })

    const requireSession = Effect.fn("SessionHttpApi.requireSession")(function* (sessionID: SessionID) {
      return yield* SessionError.mapStorageNotFound(session.get(sessionID))
    })

    const get = Effect.fn("SessionHttpApi.get")(function* (ctx: { params: { sessionID: SessionID } }) {
      return yield* requireSession(ctx.params.sessionID)
    })
    const children = Effect.fn("SessionHttpApi.children")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      if (AIGCFROGE_V2_RUNTIME) {
        const v2session = yield* SessionV2.Service
        const result = yield* v2session.children(ctx.params.sessionID as SessionV2.ID).pipe(
          Effect.catchTag("Session.NotFoundError", (error) => Effect.fail(v2SessionNotFound(error))),
        )
        return result.map(v2InfoToV1) as Session.Info[] // brand escape: V1→V2 type bridge, same shape at runtime
      }
      return yield* SessionError.mapStorageNotFound(session.children(ctx.params.sessionID))
    })

    const todo = Effect.fn("SessionHttpApi.todo")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      if (AIGCFROGE_V2_RUNTIME) {
        const v2todo = yield* SessionTodo.Service
        return yield* v2todo.get(ctx.params.sessionID as SessionV2.ID)
      }
      return yield* todoSvc.get(ctx.params.sessionID)
    })

    const diff = Effect.fn("SessionHttpApi.diff")(function* (ctx: {
      params: { sessionID: SessionID }
      query: typeof DiffQuery.Type
    }) {
      if (AIGCFROGE_V2_RUNTIME) {
        const v2summary = yield* V2SessionSummary.Service
        return yield* v2summary.diff({
          sessionID: ctx.params.sessionID as SessionV2.ID,
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
      yield* requireSession(ctx.params.sessionID)
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
      // V1 path: MessageV2.get reads message+part tables, returns WithParts.
      // See `messages` handler comment for why this endpoint stays V1.
      return yield* SessionError.mapStorageNotFound(
        MessageV2.get({ sessionID: ctx.params.sessionID, messageID: ctx.params.messageID }),
      )
    })

    const create = Effect.fn("SessionHttpApi.create")(function* (ctx: {
      payload?: Session.CreateInput
    }) {
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
      if (AIGCFROGE_V2_RUNTIME) {
        const v2s = yield* SessionV2.Service
        yield* v2s.remove(ctx.params.sessionID as SessionV2.ID).pipe(
          Effect.catchTag("Session.NotFoundError", (error) => Effect.fail(v2SessionNotFound(error))),
        )
        return true
      }
      yield* SessionError.mapStorageNotFound(session.remove(ctx.params.sessionID))
      return true
    })

    const update = Effect.fn("SessionHttpApi.update")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof UpdatePayload.Type
    }) {
      const current = yield* requireSession(ctx.params.sessionID)
      if (ctx.payload.title !== undefined) {
        if (AIGCFROGE_V2_RUNTIME) {
          const v2s = yield* SessionV2.Service
          yield* v2s.setTitle({ sessionID: ctx.params.sessionID as SessionV2.ID, title: ctx.payload.title }).pipe(
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
      if (ctx.payload.time?.archived !== undefined) {
        yield* session.setArchived({ sessionID: ctx.params.sessionID, time: ctx.payload.time.archived })
      }
      return yield* requireSession(ctx.params.sessionID)
    })

    const fork = Effect.fn("SessionHttpApi.fork")(function* (ctx: {
      params: { sessionID: SessionID }
      payload?: typeof ForkPayload.Type
    }) {
      if (AIGCFROGE_V2_RUNTIME) {
        const v2s = yield* SessionV2.Service
        const parent = yield* SessionError.mapStorageNotFound(session.get(ctx.params.sessionID))
        const child = yield* v2s.create({ location: { directory: AbsolutePath.make(parent.directory) }, parentID: parent.id })
        const shareSvc = yield* SessionShareV2.Service
        yield* shareSvc
          .share({
            sourceSessionID: ctx.params.sessionID as SessionV2.ID,
            targetSessionID: child.id,
            scope: "full",
            trigger: true,
          })
          .pipe(Effect.catchTag("Session.NotFoundError", (error) => Effect.fail(v2SessionNotFound(error))))
        return v2InfoToV1(child) as Session.Info // brand escape: V1→V2 type bridge
      }
      return yield* SessionError.mapStorageNotFound(
        session.fork({
          sessionID: ctx.params.sessionID,
          messageID: ctx.payload?.messageID,
        }),
      )
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
      if (AIGCFROGE_V2_RUNTIME) {
        const v2session = yield* SessionV2.Service
        yield* v2session.interrupt(ctx.params.sessionID as SessionV2.ID)
        return true
      }
      yield* promptSvc.cancel(ctx.params.sessionID)
      return true
    })

    const init = Effect.fn("SessionHttpApi.init")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof InitPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      if (AIGCFROGE_V2_RUNTIME) {
        const v2s = yield* SessionV2.Service
        yield* v2s.skill({ sessionID: ctx.params.sessionID as SessionV2.ID, skill: Command.Default.INIT, resume: false }).pipe(
          Effect.catchTag("Session.NotFoundError", (error) => Effect.fail(v2SessionNotFound(error))),
          Effect.catchTag("Session.PromptConflictError", () => Effect.fail(new HttpApiError.BadRequest({}))),
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
      yield* requireSession(ctx.params.sessionID)
      if (AIGCFROGE_V2_RUNTIME) {
        const shareSvc2 = yield* SessionShareV2.Service
        yield* shareSvc2
          .share({
            sourceSessionID: ctx.params.sessionID as SessionV2.ID,
            targetSessionID: ctx.params.sessionID as SessionV2.ID,
            scope: "full",
            trigger: false,
          })
          .pipe(Effect.catchTag("Session.NotFoundError", (error) => Effect.fail(v2SessionNotFound(error))))
      } else {
        yield* shareSvc.share(ctx.params.sessionID).pipe(Effect.mapError(() => new HttpApiError.InternalServerError({})))
      }
      return yield* requireSession(ctx.params.sessionID)
    })

    const unshare = Effect.fn("SessionHttpApi.unshare")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      yield* shareSvc
        .unshare(ctx.params.sessionID)
        .pipe(Effect.mapError(() => new HttpApiError.InternalServerError({})))
      return yield* requireSession(ctx.params.sessionID)
    })

    const summarize = Effect.fn("SessionHttpApi.summarize")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof SummarizePayload.Type
    }) {
      yield* revertSvc.cleanup(yield* requireSession(ctx.params.sessionID))
      if (AIGCFROGE_V2_RUNTIME) {
        const v2s = yield* SessionV2.Service
        yield* v2s.compact({ sessionID: ctx.params.sessionID as SessionV2.ID }).pipe(
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
      yield* requireSession(ctx.params.sessionID)
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
      yield* requireSession(ctx.params.sessionID)
      if (AIGCFROGE_V2_RUNTIME) {
        const v2session = yield* SessionV2.Service
        // Extract text from the V1 prompt payload's first text part.
        const parts = ctx.payload.parts as Array<{ type: string; text?: string }> | undefined
        const textPart = parts?.find((p) => p.type === "text")
        const promptText = textPart?.text ?? ""
        if (promptText) {
          yield* v2session
            .prompt({
              sessionID: ctx.params.sessionID as SessionV2.ID,
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
            // prompt 失败（含 enforcePrimary die 等 runLoop 外抛错）时 Runner.onIdle 不会触发，
            // 需显式设 idle，否则前端 working() 永真、spinner 卡死。
            // status.set(idle) 会 publish session.status + session.idle 事件，前端据此清 loading。
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
      yield* requireSession(ctx.params.sessionID)
      // command stays V1 - see prompt handler comment (V2 v2s.skill returns Admitted, API expects WithParts)
      return yield* promptSvc
        .command({ ...ctx.payload, sessionID: ctx.params.sessionID })
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
    })

    const shell = Effect.fn("SessionHttpApi.shell")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof ShellPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      // shell stays V1 - see prompt handler comment (V2 v2session.shell returns Admitted, API expects WithParts)
      return yield* SessionError.mapBusy(promptSvc.shell({ ...ctx.payload, sessionID: ctx.params.sessionID }))
    })

    const revert = Effect.fn("SessionHttpApi.revert")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof RevertPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      if (AIGCFROGE_V2_RUNTIME) {
        const v2revert = yield* V2SessionRevert.Service
        const info = yield* v2revert.revert({
          sessionID: ctx.params.sessionID as SessionV2.ID,
          messageID: ctx.payload.messageID as unknown as SessionMessage.ID,
        })
        return v2InfoToV1(info) as Session.Info // brand escape: V1→V2 type bridge
      }
      return yield* SessionError.mapBusy(revertSvc.revert({ sessionID: ctx.params.sessionID, ...ctx.payload }))
    })

    const unrevert = Effect.fn("SessionHttpApi.unrevert")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      if (AIGCFROGE_V2_RUNTIME) {
        const v2revert = yield* V2SessionRevert.Service
        const info = yield* v2revert.unrevert({ sessionID: ctx.params.sessionID as SessionV2.ID })
        return v2InfoToV1(info) as Session.Info // brand escape: V1→V2 type bridge
      }
      return yield* SessionError.mapBusy(revertSvc.unrevert({ sessionID: ctx.params.sessionID }))
    })

    const permissionRespond = Effect.fn("SessionHttpApi.permissionRespond")(function* (ctx: {
      params: { sessionID: SessionID; permissionID: PermissionV1.ID }
      payload: typeof PermissionResponsePayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      if (AIGCFROGE_V2_RUNTIME) {
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
      yield* requireSession(ctx.params.sessionID)
      yield* SessionError.mapBusy(runState.assertNotBusy(ctx.params.sessionID))
      if (AIGCFROGE_V2_RUNTIME) {
        const v2s = yield* SessionV2.Service
        yield* v2s.removeMessage({
          sessionID: ctx.params.sessionID as SessionV2.ID,
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
      yield* requireSession(ctx.params.sessionID)
      yield* session.removePart(ctx.params)
      return true
    })

    const updatePart = Effect.fn("SessionHttpApi.updatePart")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID; partID: PartID }
      payload: typeof SessionV1.Part.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
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
      if (AIGCFROGE_V2_RUNTIME) {
        const v2s = yield* SessionV2.Service
        return yield* v2s.toolSummary(ctx.params.sessionID as SessionV2.ID).pipe(
          Effect.catchTag("Session.NotFoundError", (error) => Effect.fail(v2SessionNotFound(error))),
          Effect.catchTag("Session.MessageDecodeError", () => Effect.fail(new HttpApiError.BadRequest({}))),
        )
      }
      return []
    })

    return handlers
      .handle("list", list)
      .handle("status", status)
      .handle("get", get)
      .handle("children", children)
      .handle("todo", todo)
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
      .handle("deleteMessage", deleteMessage)
      .handle("deletePart", deletePart)
      .handle("updatePart", updatePart)
      .handle("cacheDiagnostics", cacheDiagnostics)
      .handle("toolSummary", toolSummary)
  }),
)
