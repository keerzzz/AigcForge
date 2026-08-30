import { PermissionV1 } from "@aigcfroge/core/v1/permission"
import { afterEach, describe, expect } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { SessionV1 } from "@aigcfroge/core/v1/session"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { Cause, Config, Deferred, Effect, Exit, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { CrossSpawnSpawner } from "@aigcfroge/core/cross-spawn-spawner"
import { Flag } from "@aigcfroge/core/flag/flag"
import { Ripgrep } from "@aigcfroge/core/ripgrep"
import { registerAdapter } from "../../src/control-plane/adapters"
import type { WorkspaceAdapter } from "../../src/control-plane/types"
import { Workspace } from "../../src/control-plane/workspace"

import { InstanceBootstrap } from "../../src/project/bootstrap"
import { InstanceBootstrap as InstanceBootstrapService } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { Project } from "../../src/project/project"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import * as HttpSessionError from "../../src/server/routes/instance/httpapi/handlers/session-errors"
import { SessionPaths } from "../../src/server/routes/instance/httpapi/groups/session"
import { Session } from "@/session/session"
import { Todo } from "@/session/todo"
import { MessageID, PartID, SessionID, type SessionID as SessionIDType } from "../../src/session/schema"
import { Database } from "@aigcfroge/core/database/database"
import { SessionInputTable, SessionMessageTable, SessionTable, TodoTable } from "@aigcfroge/core/session/sql"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionPermissionOverride } from "@aigcfroge/core/permission/session-override"
import { SessionTask } from "@aigcfroge/core/session/task"
import { EventV2 } from "@aigcfroge/core/event"
import { ModelV2 } from "@aigcfroge/core/model"
import { ProviderV2 } from "@aigcfroge/core/provider"
import { AbsolutePath } from "@aigcfroge/core/schema"
import * as DateTime from "effect/DateTime"
import { eq } from "drizzle-orm"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, provideInstanceEffect, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { TestLLMServer } from "../lib/llm-server"
import { testProviderConfig } from "../lib/test-provider"
import { testEffect, awaitWithTimeout } from "../lib/effect"
import { CliAdapterRegistry } from "../../src/agent/meta/adapters/registry"

const originalWorkspaces = Flag.AIGCFROGE_EXPERIMENTAL_WORKSPACES
const workspaceLayer = Workspace.defaultLayer.pipe(
  Layer.provide(InstanceStore.defaultLayer),
  Layer.provide(InstanceBootstrap.defaultLayer),
  Layer.provide(CliAdapterRegistry.defaultLayer),
)
const instanceStoreLayer = InstanceStore.defaultLayer.pipe(
  Layer.provide(
    Layer.succeed(InstanceBootstrapService.Service, InstanceBootstrapService.Service.of({ run: Effect.void })),
  ),
)
const servedRoutes: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
  HttpApiApp.routes,
  {
    disableListenLog: true,
    disableLogger: true,
  },
)
const httpApiLayer = servedRoutes.pipe(
  Layer.provide(layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
)
const it = testEffect(
  Layer.mergeAll(
    instanceStoreLayer,
    Project.defaultLayer,
    Session.defaultLayer,
    SessionTask.defaultLayer,
    Todo.defaultLayer,
    EventV2.defaultLayer,
    workspaceLayer,
    Database.defaultLayer,
    SessionPermissionOverride.locationLayer,
    httpApiLayer,
  ).pipe(Layer.provide(Ripgrep.defaultLayer)),
)

function pathFor(path: string, params: Record<string, string>) {
  return Object.entries(params).reduce((result, [key, value]) => result.replace(`:${key}`, value), path)
}

function createSession(input?: Session.CreateInput) {
  return Session.use.create(input)
}

function createTextMessage(sessionID: SessionIDType, text: string) {
  return Effect.gen(function* () {
    const svc = yield* Session.Service
    const info = yield* svc.updateMessage({
      id: MessageID.ascending(),
      role: "user",
      sessionID,
      agent: "build",
      model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
      time: { created: Date.now() },
    })
    const part = yield* svc.updatePart({
      id: PartID.ascending(),
      sessionID,
      messageID: info.id,
      type: "text",
      text,
    })
    return { info, part }
  })
}

const localAdapter = (directory: string): WorkspaceAdapter => ({
  name: "Local Test",
  description: "Create a local test workspace",
  configure: (info) => ({ ...info, name: "local-test", directory }),
  create: async () => {
    await mkdir(directory, { recursive: true })
  },
  async remove() {},
  target: () => ({ type: "local" as const, directory }),
})

const createLocalWorkspace = (input: { projectID: Project.Info["id"]; type: string; directory: string }) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      registerAdapter(input.projectID, input.type, localAdapter(input.directory))
      return yield* Workspace.Service.use((svc) =>
        svc.create({
          type: input.type,
          branch: null,
          extra: null,
          projectID: input.projectID,
        }),
      )
    }),
    (info) => Workspace.use.remove(info.id).pipe(Effect.ignore),
  )

const insertLegacyAssistantMessage = (sessionID: SessionIDType, seq = 1, time = seq) =>
  Effect.gen(function* () {
    const message = SessionMessage.Assistant.make({
      id: SessionMessage.ID.create(),
      type: "assistant",
      agent: "build",
      model: {
        id: ModelV2.ID.make("model"),
        providerID: ProviderV2.ID.make("provider"),
        variant: ModelV2.VariantID.make("default"),
      },
      time: { created: DateTime.makeUnsafe(time) },
      content: [],
    })
    const { db } = yield* Database.Service
    yield* db
      .insert(SessionMessageTable)
      .values([
        {
          id: message.id,
          session_id: sessionID,
          type: message.type,
          seq,
          time_created: time,
          data: {
            time: { created: time },
            agent: message.agent,
            model: message.model,
            content: message.content,
          } as NonNullable<(typeof SessionMessageTable.$inferInsert)["data"]>,
        },
      ])
      .run()
      .pipe(Effect.orDie)
    return message
  })

const insertCorruptV2Message = (sessionID: SessionIDType, time = 1) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(SessionMessageTable)
      .values([
        {
          id: SessionMessage.ID.create(),
          session_id: sessionID,
          type: "assistant",
          seq: time,
          time_created: time,
          data: {} as NonNullable<(typeof SessionMessageTable.$inferInsert)["data"]>,
        },
      ])
      .run()
      .pipe(Effect.orDie)
  })

const setLegacySummaryDiff = (sessionID: SessionIDType) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .update(SessionTable)
      .set({
        summary_additions: 1,
        summary_deletions: 0,
        summary_files: 1,
        summary_diffs: [{ additions: 1, deletions: 0 }],
      })
      .where(eq(SessionTable.id, sessionID))
      .run()
      .pipe(Effect.orDie)
  })

const getWorkspaceID = (sessionID: SessionIDType) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    return yield* db
      .select({ workspaceID: SessionTable.workspace_id })
      .from(SessionTable)
      .where(eq(SessionTable.id, sessionID))
      .get()
      .pipe(Effect.orDie)
  })

const clearSessionPath = (sessionID: SessionIDType) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db.update(SessionTable).set({ path: null }).where(eq(SessionTable.id, sessionID)).run().pipe(Effect.orDie)
  })

function request(path: string, init?: RequestInit) {
  const url = new URL(path, "http://localhost")
  return HttpClientRequest.fromWeb(new Request(url, init)).pipe(
    HttpClientRequest.setUrl(url.pathname),
    HttpClient.execute,
  )
}

function json<T>(response: HttpClientResponse.HttpClientResponse) {
  if (response.status !== 200) return response.text.pipe(Effect.flatMap((text) => Effect.die(new Error(text))))
  return response.json.pipe(Effect.map((value) => value as T))
}

function responseJson(response: HttpClientResponse.HttpClientResponse) {
  return response.json
}

function requestJson<T>(path: string, init?: RequestInit) {
  return request(path, init).pipe(Effect.flatMap(json<T>))
}

afterEach(async () => {
  Flag.AIGCFROGE_EXPERIMENTAL_WORKSPACES = originalWorkspaces
  await disposeAllInstances()
  await resetDatabase()
})

describe("session HttpApi", () => {
  it.effect("maps busy sessions to public session busy errors", () =>
    Effect.gen(function* () {
      const sessionID = SessionID.descending()
      const exit = yield* HttpSessionError.mapBusy(Effect.fail(new Session.BusyError({ sessionID }))).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause)).toMatchObject({
          _tag: "SessionBusyError",
          sessionID,
          message: `Session is busy: ${sessionID}`,
        })
      }
    }),
  )

  it.instance(
    "returns declared not found errors for read routes",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-aigcfroge-directory": encodeURIComponent(test.directory) }
        const missingSession = SessionID.descending()
        const missingSessionBody = {
          name: "NotFoundError",
          data: { message: `Session not found: ${missingSession}` },
        }

        const get = yield* request(pathFor(SessionPaths.get, { sessionID: missingSession }), { headers })
        expect(get.status).toBe(404)
        expect(yield* responseJson(get)).toEqual(missingSessionBody)

        const children = yield* request(pathFor(SessionPaths.children, { sessionID: missingSession }), { headers })
        expect(children.status).toBe(404)
        expect(yield* responseJson(children)).toEqual(missingSessionBody)

        const todo = yield* request(pathFor(SessionPaths.todo, { sessionID: missingSession }), { headers })
        expect(todo.status).toBe(404)
        expect(yield* responseJson(todo)).toEqual(missingSessionBody)

        const messages = yield* request(pathFor(SessionPaths.messages, { sessionID: missingSession }), { headers })
        expect(messages.status).toBe(404)
        expect(yield* responseJson(messages)).toEqual(missingSessionBody)

        const remove = yield* request(pathFor(SessionPaths.remove, { sessionID: missingSession }), {
          headers,
          method: "DELETE",
        })
        expect(remove.status).toBe(404)
        expect(yield* responseJson(remove)).toEqual(missingSessionBody)

        const prompt = yield* request(pathFor(SessionPaths.prompt, { sessionID: missingSession }), {
          headers: { ...headers, "content-type": "application/json" },
          method: "POST",
          body: JSON.stringify({ agent: "build", noReply: true, parts: [{ type: "text", text: "hello" }] }),
        })
        expect(prompt.status).toBe(404)
        expect(yield* responseJson(prompt)).toEqual(missingSessionBody)

        const abort = yield* request(pathFor(SessionPaths.abort, { sessionID: missingSession }), {
          headers,
          method: "POST",
        })
        expect(abort.status).toBe(200)
        expect(yield* responseJson(abort)).toBe(true)

        const session = yield* createSession({ title: "missing message" })
        const missingMessage = MessageID.ascending()
        const message = yield* request(
          pathFor(SessionPaths.message, { sessionID: session.id, messageID: missingMessage }),
          { headers },
        )
        expect(message.status).toBe(404)
        expect(yield* responseJson(message)).toEqual({
          name: "NotFoundError",
          data: { message: `Message not found: ${missingMessage}` },
        })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "serves read routes",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-aigcfroge-directory": encodeURIComponent(test.directory) }
        const parent = yield* createSession({ title: "parent" })
        const child = yield* createSession({ title: "child", parentID: parent.id })
        const message = yield* createTextMessage(parent.id, "hello")
        yield* createTextMessage(parent.id, "world")

        const listed = yield* requestJson<Session.Info[]>(`${SessionPaths.list}?roots=true`, { headers })
        expect(listed.map((item) => item.id)).toContain(parent.id)
        expect(Object.hasOwn(listed[0], "parentID")).toBe(false)

        expect(yield* requestJson<Record<string, unknown>>(SessionPaths.status, { headers })).toEqual({})

        expect(
          yield* requestJson<Session.Info>(pathFor(SessionPaths.get, { sessionID: parent.id }), { headers }),
        ).toMatchObject({ id: parent.id, title: "parent" })

        expect(
          (yield* requestJson<Session.Info[]>(pathFor(SessionPaths.children, { sessionID: parent.id }), {
            headers,
          })).map((item) => item.id),
        ).toEqual([child.id])

        expect(
          yield* requestJson<unknown[]>(pathFor(SessionPaths.todo, { sessionID: parent.id }), { headers }),
        ).toEqual([])

        expect(
          yield* requestJson<unknown[]>(pathFor(SessionPaths.diff, { sessionID: parent.id }), { headers }),
        ).toEqual([])

        const messages = yield* request(`${pathFor(SessionPaths.messages, { sessionID: parent.id })}?limit=1`, {
          headers,
        })
        const messagePage = yield* json<SessionV1.WithParts[]>(messages)
        const nextCursor = messages.headers["x-next-cursor"]
        expect(nextCursor).toBeTruthy()
        expect(messagePage[0]?.parts[0]).toMatchObject({ type: "text" })

        expect(
          (yield* request(`${pathFor(SessionPaths.messages, { sessionID: parent.id })}?before=${nextCursor}`, {
            headers,
          })).status,
        ).toBe(400)
        expect(
          (yield* request(`${pathFor(SessionPaths.messages, { sessionID: parent.id })}?limit=1&before=invalid`, {
            headers,
          })).status,
        ).toBe(400)

        expect(
          yield* requestJson<SessionV1.WithParts>(
            pathFor(SessionPaths.message, { sessionID: parent.id, messageID: message.info.id }),
            { headers },
          ),
        ).toMatchObject({ info: { id: message.info.id } })

        yield* insertLegacyAssistantMessage(parent.id)

        expect(
          (yield* requestJson<{ data: SessionMessage.Message[] }>(`/api/session/${parent.id}/message`, {
            headers,
          })).data,
        ).toMatchObject([{ type: "assistant" }])
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.live(
    "uses the persisted session directory for prompt requests",
    () =>
      Effect.gen(function* () {
        const llm = yield* TestLLMServer
        yield* llm.text("ok", { usage: { input: 1, output: 1 } })

        const config = testProviderConfig(llm.url)
        const sessionDirectory = yield* tmpdirScoped({ git: true, config })
        const requestDirectory = yield* tmpdirScoped({ git: true, config })
        const session = yield* createSession({ title: "directory regression" }).pipe(
          provideInstanceEffect(sessionDirectory),
        )

        const response = yield* request(
          `${pathFor(SessionPaths.prompt, { sessionID: session.id })}?directory=${encodeURIComponent(requestDirectory)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              agent: "build",
              model: { providerID: "test", modelID: "test-model" },
              parts: [{ type: "text", text: "which directory?" }],
            }),
          },
        )

        expect(response.status).toBe(200)
        yield* responseJson(response)

        const messages = yield* Session.use
          .messages({ sessionID: session.id })
          .pipe(provideInstanceEffect(sessionDirectory), Effect.orDie)
        const assistant = messages.find((message) => message.info.role === "assistant")
        expect(assistant?.info.role === "assistant" ? assistant.info.path : undefined).toEqual({
          cwd: sessionDirectory,
          root: sessionDirectory,
        })
      }).pipe(Effect.provide(TestLLMServer.layer), Effect.provide(CrossSpawnSpawner.defaultLayer)),
    { timeout: 60_000 },
  )

  it.instance(
    "returns v2 public request errors for cursor and workspace query failures",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-aigcfroge-directory": encodeURIComponent(test.directory) }
        const session = yield* createSession({ title: "v2 cursor" })
        const firstMessage = yield* insertLegacyAssistantMessage(session.id, 1, 2)
        const secondMessage = yield* insertLegacyAssistantMessage(session.id, 2, 1)

        const sessionPage = yield* request(
          `/api/session?${new URLSearchParams({
            limit: "1",
            order: "asc",
            directory: test.directory,
            search: "v2",
          })}`,
          { headers },
        )
        const sessionCursor = (yield* json<{ data: Session.Info[]; cursor: { next?: string } }>(sessionPage)).cursor
          .next
        expect(sessionCursor).toBeTruthy()
        expect(JSON.parse(Buffer.from(sessionCursor!, "base64url").toString("utf8"))).toMatchObject({
          order: "asc",
          directory: test.directory,
          search: "v2",
          anchor: { id: session.id, direction: "next" },
        })

        const sessionNextPage = yield* request(`/api/session?cursor=${sessionCursor}`, { headers })
        expect(sessionNextPage.status).toBe(200)

        const invalidSessionCursor = yield* request(`/api/session?cursor=invalid`, { headers })
        expect(invalidSessionCursor.status).toBe(400)
        expect(yield* responseJson(invalidSessionCursor)).toMatchObject({
          _tag: "InvalidCursorError",
          message: "Invalid cursor",
        })

        const invalidWorkspace = yield* request(`/api/session?workspace=bad`, { headers })
        expect(invalidWorkspace.status).toBe(400)
        expect(yield* responseJson(invalidWorkspace)).toMatchObject({
          _tag: "InvalidRequestError",
          kind: "Query",
        })

        const messagePage = yield* request(`/api/session/${session.id}/message?limit=1`, { headers })
        const messageBody = yield* json<{ data: SessionMessage.Message[]; cursor: { next?: string } }>(messagePage)
        const messageCursor = messageBody.cursor.next
        expect(messageCursor).toBeTruthy()
        expect(messageBody.data.map((message) => message.id)).toEqual([secondMessage.id])
        expect(JSON.parse(Buffer.from(messageCursor!, "base64url").toString("utf8"))).toEqual({
          id: secondMessage.id,
          order: "desc",
          direction: "next",
        })

        const nextMessagePage = yield* request(`/api/session/${session.id}/message?cursor=${messageCursor}`, {
          headers,
        })
        expect(
          (yield* json<{ data: SessionMessage.Message[] }>(nextMessagePage)).data.map((message) => message.id),
        ).toEqual([firstMessage.id])

        const legacyMessageCursor = Buffer.from(
          JSON.stringify({ id: secondMessage.id, time: 1, order: "desc", direction: "next" }),
        ).toString("base64url")
        const legacyMessagePage = yield* request(`/api/session/${session.id}/message?cursor=${legacyMessageCursor}`, {
          headers,
        })
        expect(
          (yield* json<{ data: SessionMessage.Message[] }>(legacyMessagePage)).data.map((message) => message.id),
        ).toEqual([firstMessage.id])

        const messageCursorWithOrder = yield* request(
          `/api/session/${session.id}/message?cursor=${messageCursor}&order=asc`,
          { headers },
        )
        expect(messageCursorWithOrder.status).toBe(400)
        expect(yield* responseJson(messageCursorWithOrder)).toMatchObject({
          _tag: "InvalidCursorError",
          message: "Cursor cannot be combined with order",
        })

        const invalidMessageCursor = yield* request(`/api/session/${session.id}/message?cursor=invalid`, { headers })
        expect(invalidMessageCursor.status).toBe(400)
        expect(yield* responseJson(invalidMessageCursor)).toMatchObject({
          _tag: "InvalidCursorError",
          message: "Invalid cursor",
        })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "returns v2 public not found errors for missing sessions",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-aigcfroge-directory": encodeURIComponent(test.directory) }
        const missing = SessionID.descending()
        const expected = {
          _tag: "SessionNotFoundError",
          sessionID: missing,
          message: `Session not found: ${missing}`,
        }

        const messages = yield* request(`/api/session/${missing}/message`, { headers })
        expect(messages.status).toBe(404)
        expect(yield* responseJson(messages)).toEqual(expected)

        const context = yield* request(`/api/session/${missing}/context`, { headers })
        expect(context.status).toBe(404)
        expect(yield* responseJson(context)).toEqual(expected)

        const compact = yield* request(`/api/session/${missing}/compact`, { method: "POST", headers })
        expect(compact.status).toBe(404)
        expect(yield* responseJson(compact)).toEqual(expected)

        const wait = yield* request(`/api/session/${missing}/wait`, { method: "POST", headers })
        expect(wait.status).toBe(404)
        expect(yield* responseJson(wait)).toEqual(expected)

        const prompt = yield* request(`/api/session/${missing}/prompt`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ prompt: { text: "hello" } }),
        })
        expect(prompt.status).toBe(404)
        expect(yield* responseJson(prompt)).toEqual(expected)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "durably records one v2 prompt for exact message-ID retries",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-aigcfroge-directory": encodeURIComponent(test.directory) }
        const session = yield* createSession({ title: "v2 prompt recording" })

        const recordPrompt = () =>
          request(`/api/session/${session.id}/prompt`, {
            method: "POST",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({ id: "msg_http_prompt", prompt: { text: "hello" } }),
          })
        const first = yield* recordPrompt()
        const retried = yield* recordPrompt()
        type PromptBody = { id: string; prompt: { text: string }; delivery: string; promotedSeq?: number }
        const firstBody = yield* json<{ data: PromptBody }>(first)
        const retriedBody = yield* json<{ data: PromptBody }>(retried)
        expect(first.status).toBe(200)
        expect(retried.status).toBe(200)
        expect(retriedBody).toEqual(firstBody)
        expect(firstBody).toMatchObject({
          data: { id: "msg_http_prompt", prompt: { text: "hello" }, delivery: "steer" },
        })

        const messages = yield* requestJson<{ data: PromptBody[] }>(`/api/session/${session.id}/message`, {
          headers,
        })
        expect(messages.data).toHaveLength(0)
        const admitted = yield* Database.Service.use(({ db }) =>
          db
            .select()
            .from(SessionInputTable)
            .where(eq(SessionInputTable.id, SessionMessage.ID.make("msg_http_prompt")))
            .get()
            .pipe(Effect.orDie),
        )
        expect(admitted).toMatchObject({
          id: "msg_http_prompt",
          session_id: session.id,
          delivery: "steer",
          promoted_seq: null,
        })
        const conflict = yield* request(`/api/session/${session.id}/prompt`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ id: "msg_http_prompt", prompt: { text: "goodbye" } }),
        })
        expect(conflict.status).toBe(409)
        expect(yield* responseJson(conflict)).toEqual({
          _tag: "ConflictError",
          message: "Prompt message ID conflicts with an existing durable record: msg_http_prompt",
          resource: "msg_http_prompt",
        })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "returns v2 public unavailable errors for unfinished session mutations",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-aigcfroge-directory": encodeURIComponent(test.directory) }
        const session = yield* createSession({ title: "v2 unavailable" })

        const compact = yield* request(`/api/session/${session.id}/compact`, { method: "POST", headers })
        expect(compact.status).toBe(503)
        expect(yield* responseJson(compact)).toEqual({
          _tag: "ServiceUnavailableError",
          message: "Session compact is not available yet",
          service: "session.compact",
        })

        const wait = yield* request(`/api/session/${session.id}/wait`, { method: "POST", headers })
        expect(wait.status).toBe(503)
        expect(yield* responseJson(wait)).toEqual({
          _tag: "ServiceUnavailableError",
          message: "Session wait is not available yet",
          service: "session.wait",
        })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "returns safe v2 unknown errors for corrupt projected messages",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* createSession({ title: "v2 corrupt message" })
        yield* insertCorruptV2Message(session.id)

        const messages = yield* request(`/api/session/${session.id}/message`, {
          headers: { "x-aigcfroge-directory": encodeURIComponent(test.directory) },
        })
        const messagesBody = yield* responseJson(messages)
        expect(messages.status).toBe(500)
        expect(messagesBody).toMatchObject({
          _tag: "UnknownError",
          message: "Unexpected server error. Check server logs for details.",
        })
        expect((messagesBody as { ref?: unknown }).ref).toMatch(/^err_[0-9a-f-]{8}$/)
        expect(JSON.stringify(messagesBody)).not.toContain("assistant")

        const context = yield* request(`/api/session/${session.id}/context`, {
          headers: { "x-aigcfroge-directory": encodeURIComponent(test.directory) },
        })
        const contextBody = yield* responseJson(context)
        expect(context.status).toBe(500)
        expect(contextBody).toMatchObject({
          _tag: "UnknownError",
          message: "Unexpected server error. Check server logs for details.",
        })
        expect((contextBody as { ref?: unknown }).ref).toMatch(/^err_[0-9a-f-]{8}$/)
        expect(JSON.stringify(contextBody)).not.toContain("assistant")
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "serves sessions with migrated summary diffs missing file details",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* createSession({ title: "legacy diff" })
        yield* setLegacySummaryDiff(session.id)

        const response = yield* request(pathFor(SessionPaths.get, { sessionID: session.id }), {
          headers: { "x-aigcfroge-directory": encodeURIComponent(test.directory) },
        })

        expect(response.status).toBe(200)
        expect((yield* json<Session.Info>(response)).summary?.diffs).toEqual([{ additions: 1, deletions: 0 }])
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "serves lifecycle mutation routes",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = {
          "x-aigcfroge-directory": encodeURIComponent(test.directory),
          "content-type": "application/json",
        }

        const createdEmpty = yield* requestJson<Session.Info>(SessionPaths.create, {
          method: "POST",
          headers,
        })
        expect(createdEmpty.id).toBeTruthy()

        const created = yield* requestJson<Session.Info>(SessionPaths.create, {
          method: "POST",
          headers,
          body: JSON.stringify({ title: "created" }),
        })
        expect(created.title).toBe("created")

        const updated = yield* requestJson<Session.Info>(pathFor(SessionPaths.update, { sessionID: created.id }), {
          method: "PATCH",
          headers,
          body: JSON.stringify({ title: "updated", time: { archived: 1 } }),
        })
        expect(updated).toMatchObject({ id: created.id, title: "updated", time: { archived: 1 } })

        const forked = yield* requestJson<Session.Info>(pathFor(SessionPaths.fork, { sessionID: created.id }), {
          method: "POST",
          headers,
        })
        expect(forked.id).not.toBe(created.id)

        const forkedWithoutContentType = yield* requestJson<Session.Info>(
          pathFor(SessionPaths.fork, { sessionID: created.id }),
          {
            method: "POST",
            headers: { "x-aigcfroge-directory": encodeURIComponent(test.directory) },
          },
        )
        expect(forkedWithoutContentType.id).not.toBe(created.id)

        const invalidFork = yield* request(pathFor(SessionPaths.fork, { sessionID: created.id }), {
          method: "POST",
          headers,
          body: "{",
        })
        expect(invalidFork.status).toBe(400)

        const forkedWhitespace = yield* requestJson<Session.Info>(
          pathFor(SessionPaths.fork, { sessionID: created.id }),
          {
            method: "POST",
            headers,
            body: "  \n",
          },
        )
        expect(forkedWhitespace.id).not.toBe(created.id)

        expect(
          yield* requestJson<boolean>(pathFor(SessionPaths.abort, { sessionID: created.id }), {
            method: "POST",
            headers,
          }),
        ).toBe(true)

        expect(
          yield* requestJson<boolean>(pathFor(SessionPaths.remove, { sessionID: created.id }), {
            method: "DELETE",
            headers,
          }),
        ).toBe(true)
      }),
    { git: true, config: { formatter: false, lsp: false, share: "disabled" } },
  )

  it.instance(
    "fork copies the parent's tasks as a three-field projection",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = {
          "x-aigcfroge-directory": encodeURIComponent(test.directory),
          "content-type": "application/json",
        }
        const parent = yield* createSession({ title: "fork parent" })
        const tasks = yield* SessionTask.Service
        yield* tasks.update({
          sessionID: parent.id,
          tasks: [
            { content: "running", status: "in_progress", priority: "high" },
            // `scheduled` requires a real trigger (dead-schedule guard).
            {
              content: "scheduled",
              status: "scheduled",
              priority: "medium",
              agentID: "build",
              scheduledAt: Date.now() + 60_000,
            },
            { content: "done", status: "completed", priority: "low", spawnedFrom: "msg_seed" },
          ],
        })

        const child = yield* requestJson<Session.Info>(pathFor(SessionPaths.fork, { sessionID: parent.id }), {
          method: "POST",
          headers,
        })

        const copied = yield* requestJson<SessionTask.Info[]>(pathFor(SessionPaths.task, { sessionID: child.id }), {
          headers,
        })
        const projection: Array<{ content: string; status: string; priority: string }> = [
          { content: "running", status: "pending", priority: "high" },
          { content: "scheduled", status: "pending", priority: "medium" },
          { content: "done", status: "completed", priority: "low" },
        ]
        const copiedProjection: Array<{ content: string; status: string; priority: string }> = copied.map((task) => ({
          content: task.content,
          status: task.status,
          priority: task.priority,
        }))
        expect(copiedProjection).toEqual(projection)
        // No dangling references: schedule, spawn and delegation fields are dropped.
        expect(
          copied.every(
            (task) =>
              task.scheduledAt === undefined &&
              task.recurrence === undefined &&
              task.spawnedFrom === undefined &&
              task.dependsOn === undefined &&
              task.agentID === undefined,
          ),
        ).toBe(true)

        const todos = yield* requestJson<Array<{ content: string; status: string; priority: string }>>(
          pathFor(SessionPaths.todo, { sessionID: child.id }),
          { headers },
        )
        expect(todos).toEqual(projection)
      }),
    { git: true, config: { formatter: false, lsp: false, share: "disabled" } },
  )

  it.instance(
    "persists selected workspace id when creating a session",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        Flag.AIGCFROGE_EXPERIMENTAL_WORKSPACES = true
        const project = yield* Project.use.fromDirectory(test.directory)
        const workspace = yield* createLocalWorkspace({
          projectID: project.project.id,
          type: "session-create-workspace",
          directory: path.join(test.directory, ".workspace-local"),
        })

        const created = yield* requestJson<Session.Info>(`${SessionPaths.create}?workspace=${workspace.id}`, {
          method: "POST",
          headers: { "x-aigcfroge-directory": encodeURIComponent(test.directory), "content-type": "application/json" },
          body: JSON.stringify({ title: "workspace session" }),
        })
        const messages = yield* request(
          `${pathFor(SessionPaths.messages, { sessionID: created.id })}?workspace=${workspace.id}`,
          {
            headers: { "x-aigcfroge-directory": encodeURIComponent(test.directory) },
          },
        )

        expect(created).toMatchObject({ id: created.id, workspaceID: workspace.id })
        expect(messages.status).toBe(200)
        expect(yield* getWorkspaceID(created.id)).toEqual({ workspaceID: workspace.id })
      }),
    { git: true, config: { formatter: false, lsp: false, share: "disabled" } },
  )

  it.instance(
    "validates archived timestamp values",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = {
          "x-aigcfroge-directory": encodeURIComponent(test.directory),
          "content-type": "application/json",
        }
        const session = yield* createSession({ title: "archived" })
        const body = JSON.stringify({ time: { archived: -1 } })

        const response = yield* request(pathFor(SessionPaths.update, { sessionID: session.id }), {
          method: "PATCH",
          headers,
          body,
        })
        expect(response.status).toBe(200)
        expect((yield* json<Session.Info>(response)).time.archived).toBe(-1)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "uses project-scoped path and directory precedence",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const currentDir = path.join(test.directory, "packages", "aigcfroge", "src")
        yield* Effect.promise(() => mkdir(currentDir, { recursive: true }))

        const store = yield* InstanceStore.Service
        const { pathSession, pathlessSession } = yield* store.provide(
          { directory: currentDir },
          Effect.gen(function* () {
            return {
              pathSession: yield* createSession(),
              pathlessSession: yield* createSession(),
            }
          }).pipe(Effect.provideService(TestInstance, { directory: currentDir }), Effect.provide(Session.defaultLayer)),
        )
        yield* clearSessionPath(pathlessSession.id)

        const query = new URLSearchParams({
          scope: "project",
          path: "packages/aigcfroge/src",
          directory: currentDir,
        })
        const headers = { "x-aigcfroge-directory": encodeURIComponent(test.directory) }
        const sessions = (yield* json<Session.Info[]>(
          yield* request(`${SessionPaths.list}?${query}`, { headers }),
        )).map((item) => item.id)

        expect(sessions).toContain(pathSession.id)
        expect(sessions).not.toContain(pathlessSession.id)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "serves paginated message link headers",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-aigcfroge-directory": encodeURIComponent(test.directory) }
        const session = yield* createSession({ title: "messages" })
        yield* createTextMessage(session.id, "first")
        yield* createTextMessage(session.id, "second")
        const route = `${pathFor(SessionPaths.messages, { sessionID: session.id })}?limit=1`

        const response = yield* request(route, { headers })

        expect(response.headers["x-next-cursor"]).toBeTruthy()
        expect(response.headers["link"]).toContain("limit=1")
        expect(response.headers["access-control-expose-headers"]?.toLowerCase()).toContain("x-next-cursor")
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "serves message mutation routes",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = {
          "x-aigcfroge-directory": encodeURIComponent(test.directory),
          "content-type": "application/json",
        }
        const session = yield* createSession({ title: "messages" })
        const first = yield* createTextMessage(session.id, "first")
        const second = yield* createTextMessage(session.id, "second")

        const updated = yield* requestJson<SessionV1.Part>(
          pathFor(SessionPaths.updatePart, {
            sessionID: session.id,
            messageID: first.info.id,
            partID: first.part.id,
          }),
          {
            method: "PATCH",
            headers,
            body: JSON.stringify({ ...first.part, text: "updated" }),
          },
        )
        expect(updated).toMatchObject({ id: first.part.id, type: "text", text: "updated" })

        expect(
          yield* requestJson<boolean>(
            pathFor(SessionPaths.deletePart, {
              sessionID: session.id,
              messageID: first.info.id,
              partID: first.part.id,
            }),
            { method: "DELETE", headers },
          ),
        ).toBe(true)

        expect(
          yield* requestJson<boolean>(
            pathFor(SessionPaths.deleteMessage, { sessionID: session.id, messageID: second.info.id }),
            { method: "DELETE", headers },
          ),
        ).toBe(true)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "rejects part updates whose path and body ids disagree",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = {
          "x-aigcfroge-directory": encodeURIComponent(test.directory),
          "content-type": "application/json",
        }
        const session = yield* createSession({ title: "part mismatch" })
        const message = yield* createTextMessage(session.id, "first")
        const response = yield* request(
          pathFor(SessionPaths.updatePart, {
            sessionID: session.id,
            messageID: message.info.id,
            partID: message.part.id,
          }),
          {
            method: "PATCH",
            headers,
            body: JSON.stringify({ ...message.part, id: PartID.ascending() }),
          },
        )

        expect(response.status).toBe(400)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "serves remaining non-LLM session mutation routes",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = {
          "x-aigcfroge-directory": encodeURIComponent(test.directory),
          "content-type": "application/json",
        }
        const session = yield* createSession({ title: "remaining" })

        expect(
          yield* requestJson<Session.Info>(pathFor(SessionPaths.revert, { sessionID: session.id }), {
            method: "POST",
            headers,
            body: JSON.stringify({ messageID: MessageID.ascending() }),
          }),
        ).toMatchObject({ id: session.id })

        expect(
          yield* requestJson<Session.Info>(pathFor(SessionPaths.unrevert, { sessionID: session.id }), {
            method: "POST",
            headers,
          }),
        ).toMatchObject({ id: session.id })

        const permissionID = String(PermissionV1.ID.ascending())
        const permission = yield* request(
          pathFor(SessionPaths.permissions, {
            sessionID: session.id,
            permissionID,
          }),
          {
            method: "POST",
            headers,
            body: JSON.stringify({ response: "once" }),
          },
        )
        expect(permission.status).toBe(404)
        expect(yield* responseJson(permission)).toEqual({
          _tag: "PermissionNotFoundError",
          requestID: permissionID,
          message: `Permission request not found: ${permissionID}`,
        })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})

describe("session task HttpApi", () => {
  it.instance("PATCH /session/:id/task replaces the task list and reads back consistently", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = {
        "x-aigcfroge-directory": encodeURIComponent(test.directory),
        "content-type": "application/json",
      }
      const session = yield* createSession({ title: "task list" })

      // Seed two tasks via the service (shares the same DB the handler reads).
      const tasks = yield* SessionTask.Service
      const seeded = yield* tasks.update({
        sessionID: session.id,
        tasks: [
          { content: "first", status: "pending", priority: "low" },
          { content: "second", status: "in_progress", priority: "high" },
        ],
      })
      expect(seeded.every((task) => task.id.startsWith("tsk_"))).toBe(true)
      const first = seeded[0]

      // PATCH with one status flipped and the other omitted (removed by reconcile).
      // The body is plain JSON — project the WriteInfo fields the endpoint
      // decodes (id/content/status/priority) explicitly instead of spreading
      // the decoded Schema.Class instance.
      const body = yield* requestJson<SessionTask.Info[]>(pathFor(SessionPaths.task, { sessionID: session.id }), {
        method: "PATCH",
        headers,
        body: JSON.stringify([{ id: first.id, content: first.content, status: "completed", priority: first.priority }]),
      })
      expect(body).toHaveLength(1)
      expect(body[0]?.status).toBe("completed")
      expect(body[0]?.id).toBe(first.id)

      // Reads back consistently through the service.
      const got = yield* tasks.get(session.id)
      expect(got.map((task) => task.id)).toEqual([first.id])
      expect(got[0]?.status).toBe("completed")
    }),
  )

  it.instance("PATCH /session/:id/task rejects an invalid status body with 400", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = {
        "x-aigcfroge-directory": encodeURIComponent(test.directory),
        "content-type": "application/json",
      }
      const session = yield* createSession({ title: "task bad body" })

      const response = yield* request(pathFor(SessionPaths.task, { sessionID: session.id }), {
        method: "PATCH",
        headers,
        body: JSON.stringify([
          {
            id: "tsk_1",
            content: "x",
            status: "bogus",
            priority: "low",
            sessionID: session.id,
            createdAt: 1,
            updatedAt: 1,
          },
        ]),
      })
      expect(response.status).toBe(400)
    }),
  )

  it.instance("PATCH /session/:id/task rejects a dead-job recurrence cron with 400", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = {
        "x-aigcfroge-directory": encodeURIComponent(test.directory),
        "content-type": "application/json",
      }
      const session = yield* createSession({ title: "task bad cron" })

      const response = yield* request(pathFor(SessionPaths.task, { sessionID: session.id }), {
        method: "PATCH",
        headers,
        body: JSON.stringify([
          {
            content: "nightly",
            status: "scheduled",
            priority: "medium",
            recurrence: { cron: "not a cron", enabled: true },
          },
        ]),
      })
      expect(response.status).toBe(400)
      const body = yield* response.json
      expect(JSON.stringify(body)).toContain("invalid recurrence cron")
    }),
  )

  it.instance("PATCH /session/:id/task rejects a trigger-less scheduled task with 400", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = {
        "x-aigcfroge-directory": encodeURIComponent(test.directory),
        "content-type": "application/json",
      }
      const session = yield* createSession({ title: "task no trigger" })

      const response = yield* request(pathFor(SessionPaths.task, { sessionID: session.id }), {
        method: "PATCH",
        headers,
        body: JSON.stringify([
          {
            content: "stuck",
            status: "scheduled",
            priority: "medium",
          },
        ]),
      })
      expect(response.status).toBe(400)
      const body = yield* response.json
      expect(JSON.stringify(body)).toContain("must have a scheduledAt or an enabled recurrence")
    }),
  )

  it.instance("PATCH /session/:id/task persists M5 spawn fields (spawnedFrom/dependsOn)", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = {
        "x-aigcfroge-directory": encodeURIComponent(test.directory),
        "content-type": "application/json",
      }
      const session = yield* createSession({ title: "task spawn fields" })

      const created = yield* requestJson<SessionTask.Info[]>(pathFor(SessionPaths.task, { sessionID: session.id }), {
        method: "PATCH",
        headers,
        body: JSON.stringify([
          {
            content: "spawned audit",
            status: "pending",
            priority: "medium",
            spawnedFrom: "msg_spawn_1",
            dependsOn: ["tsk_pred_a"],
          },
        ]),
      })
      expect(created[0]?.spawnedFrom).toBe("msg_spawn_1")
      expect(created[0]?.dependsOn).toEqual(["tsk_pred_a"])

      // Re-read through the service: the columns survived the HTTP write.
      const tasks = yield* SessionTask.Service
      const got = yield* tasks.get(session.id)
      expect(got[0]?.spawnedFrom).toBe("msg_spawn_1")
      expect(got[0]?.dependsOn).toEqual(["tsk_pred_a"])
    }),
  )

  it.instance("PATCH /session/:id/task rejects a dependsOn cycle with 400", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = {
        "x-aigcfroge-directory": encodeURIComponent(test.directory),
        "content-type": "application/json",
      }
      const session = yield* createSession({ title: "task cycle" })
      const tasks = yield* SessionTask.Service
      const [a, b] = yield* tasks.append({
        sessionID: session.id,
        tasks: [
          { content: "a", status: "pending", priority: "medium" },
          { content: "b", status: "pending", priority: "medium" },
        ],
      })

      const response = yield* request(pathFor(SessionPaths.task, { sessionID: session.id }), {
        method: "PATCH",
        headers,
        body: JSON.stringify([
          { id: a.id, content: "a", status: "pending", priority: "medium", dependsOn: [b.id] },
          { id: b.id, content: "b", status: "pending", priority: "medium", dependsOn: [a.id] },
        ]),
      })
      expect(response.status).toBe(400)
      const body = yield* response.text
      expect(body).toContain("dependency cycle")
    }),
  )

  it.instance("PATCH /session/:id/task creates tasks from minimal write info", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = {
        "x-aigcfroge-directory": encodeURIComponent(test.directory),
        "content-type": "application/json",
      }
      const session = yield* createSession({ title: "task create" })

      const body = yield* requestJson<SessionTask.Info[]>(pathFor(SessionPaths.task, { sessionID: session.id }), {
        method: "PATCH",
        headers,
        body: JSON.stringify([{ content: "fresh", status: "in_progress", priority: "high" }]),
      })
      expect(body).toHaveLength(1)
      expect(body[0]?.content).toBe("fresh")
      expect(body[0]?.id.startsWith("tsk_")).toBe(true)
      expect(body[0]?.sessionID).toBe(session.id)

      const tasks = yield* SessionTask.Service
      const got = yield* tasks.get(session.id)
      expect(got[0]?.content).toBe("fresh")
    }),
  )

  it.instance("PATCH /session/:id/task cannot inject another session's id", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = {
        "x-aigcfroge-directory": encodeURIComponent(test.directory),
        "content-type": "application/json",
      }
      const session = yield* createSession({ title: "task forge" })
      const other = yield* createSession({ title: "other" })

      const body = yield* requestJson<SessionTask.Info[]>(pathFor(SessionPaths.task, { sessionID: session.id }), {
        method: "PATCH",
        headers,
        body: JSON.stringify([
          { content: "x", status: "pending", priority: "low", sessionID: other.id, createdAt: 999, updatedAt: 999 },
        ]),
      })
      // The path sessionID always owns the row; forged body fields are ignored.
      expect(body[0]?.sessionID).toBe(session.id)

      const tasks = yield* SessionTask.Service
      const otherTasks = yield* tasks.get(other.id)
      expect(otherTasks).toHaveLength(0)
    }),
  )

  it.instance("PATCH /session/:id/task rejects a foreign task id with 400 and writes nothing", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = {
        "x-aigcfroge-directory": encodeURIComponent(test.directory),
        "content-type": "application/json",
      }
      const session = yield* createSession({ title: "task foreign" })
      const other = yield* createSession({ title: "other" })

      // Seed one task per session; the other's id is foreign to this session.
      const tasks = yield* SessionTask.Service
      const [mine] = yield* tasks.update({
        sessionID: session.id,
        tasks: [{ content: "mine", status: "pending", priority: "low" }],
      })
      const [theirs] = yield* tasks.update({
        sessionID: other.id,
        tasks: [{ content: "theirs", status: "pending", priority: "low" }],
      })

      const response = yield* request(pathFor(SessionPaths.task, { sessionID: session.id }), {
        method: "PATCH",
        headers,
        body: JSON.stringify([{ id: theirs.id, content: "forged", status: "pending", priority: "low" }]),
      })
      expect(response.status).toBe(400)
      const error = yield* responseJson(response)
      expect(error).toMatchObject({ _tag: "InvalidRequestError" })

      // The rejection happens before any write in both sessions.
      expect((yield* tasks.get(session.id)).map((task) => task.id)).toEqual([mine.id])
      expect((yield* tasks.get(other.id)).map((task) => task.id)).toEqual([theirs.id])
    }),
  )

  it.instance("GET /session/:id/task returns the full TaskInfo list with outputDigest; empty session returns []", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = { "x-aigcfroge-directory": encodeURIComponent(test.directory) }
      const session = yield* createSession({ title: "task get" })

      // Seed a task and settle it with a digest (the delegation writeback path).
      const tasks = yield* SessionTask.Service
      const [seeded] = yield* tasks.update({
        sessionID: session.id,
        tasks: [{ content: "first", status: "in_progress", priority: "high" }],
      })
      yield* tasks.patch({ sessionID: session.id, id: seeded.id, status: "completed", outputDigest: "ses_child" })

      // GET returns the persisted Info with id + digest (reload-recovery source).
      const body = yield* requestJson<SessionTask.Info[]>(pathFor(SessionPaths.task, { sessionID: session.id }), {
        headers,
      })
      expect(body).toHaveLength(1)
      expect(body[0]?.id).toBe(seeded.id)
      expect(body[0]?.content).toBe("first")
      expect(body[0]?.status).toBe("completed")
      expect(body[0]?.outputDigest).toBe("ses_child")

      // A session with no tasks reads back an empty array.
      const empty = yield* createSession({ title: "task empty" })
      const emptyBody = yield* requestJson<SessionTask.Info[]>(pathFor(SessionPaths.task, { sessionID: empty.id }), {
        headers,
      })
      expect(emptyBody).toEqual([])
    }),
  )

  it.instance("GET /session/:id/todo projects from TaskTable in the default V1 runtime", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = { "x-aigcfroge-directory": encodeURIComponent(test.directory) }
      const session = yield* createSession({ title: "todo v1" })
      // The V1 service is the todowrite tool's write path in the default
      // runtime; after convergence it must land in TaskTable only.
      const v1todo = yield* Todo.Service
      yield* v1todo.update({
        sessionID: session.id,
        todos: [{ content: "legacy", status: "in_progress", priority: "high" }],
      })

      const { db } = yield* Database.Service
      const legacyRows = yield* db
        .select()
        .from(TodoTable)
        .where(eq(TodoTable.session_id, session.id))
        .all()
        .pipe(Effect.orDie)
      expect(legacyRows).toEqual([])

      const todos = yield* requestJson<Array<{ content: string; status: string; priority: string }>>(
        pathFor(SessionPaths.todo, { sessionID: session.id }),
        { headers },
      )
      expect(todos).toEqual([{ content: "legacy", status: "in_progress", priority: "high" }])

      // Single source: GET /task exposes the same rows with task metadata.
      const tasks = yield* requestJson<SessionTask.Info[]>(pathFor(SessionPaths.task, { sessionID: session.id }), {
        headers,
      })
      const taskProjection: Array<{ content: string; status: string; priority: string }> = tasks.map((task) => ({
        content: task.content,
        status: task.status,
        priority: task.priority,
      }))
      expect(taskProjection).toEqual(todos)
    }),
  )

  it.instance("V1 Todo.Service.update publishes todo.updated on the shared EventV2 bus with instance location", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const session = yield* createSession({ title: "todo event" })
      const events = yield* EventV2.Service
      const v1todo = yield* Todo.Service
      const received = yield* Deferred.make<EventV2.Payload>()
      const unsubscribe = yield* events.listen((event) =>
        event.type === "todo.updated" ? Deferred.succeed(received, event).pipe(Effect.asVoid) : Effect.void,
      )
      yield* v1todo.update({
        sessionID: session.id,
        todos: [{ content: "first", status: "pending", priority: "medium" }],
      })
      const event = yield* awaitWithTimeout(Deferred.await(received), "todo.updated not received on the EventV2 bus")
      yield* unsubscribe
      expect(event.data).toMatchObject({
        sessionID: session.id,
        todos: [{ content: "first", status: "pending", priority: "medium" }],
      })
      // The SSE /event route filters on location.directory, so the event must
      // carry the instance location to be deliverable.
      expect(event.location?.directory).toBe(AbsolutePath.make(test.directory))
    }),
  )

  it.instance("V1 Todo.Service.update rejects an invalid status", () =>
    Effect.gen(function* () {
      const session = yield* createSession({ title: "todo invalid" })
      const v1todo = yield* Todo.Service
      const error = yield* v1todo
        .update({
          sessionID: session.id,
          todos: [{ content: "bad", status: "bogus", priority: "high" }],
        })
        .pipe(
          Effect.match({
            onSuccess: () => undefined,
            onFailure: (error) => error,
          }),
        )
      expect(error?._tag).toBe("SchemaError")
    }),
  )

  it.instance("GET /agent-task aggregates every session's tasks for the Agent Hub", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = { "x-aigcfroge-directory": encodeURIComponent(test.directory) }
      const session = yield* createSession({ title: "agent hub" })
      const other = yield* createSession({ title: "agent hub other" })

      const tasks = yield* SessionTask.Service
      yield* tasks.update({
        sessionID: session.id,
        tasks: [{ content: "build-a", status: "in_progress", priority: "high", agentID: "build" }],
      })
      yield* tasks.update({
        sessionID: other.id,
        tasks: [
          // `scheduled` requires a real trigger (HIGH-4 schedule invariant).
          {
            content: "build-b",
            status: "scheduled",
            priority: "medium",
            agentID: "build",
            scheduledAt: Date.now() + 60_000,
          },
          { content: "unowned", status: "pending", priority: "low" },
        ],
      })

      const all = yield* requestJson<SessionTask.Info[]>("/agent-task", { headers })
      expect(all.map((task) => task.content).sort()).toEqual(["build-a", "build-b", "unowned"])
      const buildA = all.find((task) => task.content === "build-a")
      expect(buildA?.agentID).toBe("build")
      expect(buildA?.sessionID).toBe(session.id)
      const unowned = all.find((task) => task.content === "unowned")
      expect(unowned?.agentID).toBeUndefined()
    }),
  )

  it.instance("single-task patch/create/delete are atomic (HIGH-2) and reject a dead schedule (HIGH-4)", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = { "x-aigcfroge-directory": encodeURIComponent(test.directory) }
      const session = yield* createSession({ title: "atomic tasks" })

      // Create one task atomically (POST /session/:id/task).
      const created = yield* requestJson<SessionTask.Info>(pathFor(SessionPaths.task, { sessionID: session.id }), {
        method: "POST",
        headers,
        body: JSON.stringify({ content: "one", status: "pending", priority: "medium" }),
      })
      const taskID = created.id

      // A second create in a now non-empty session must return the NEWLY
      // created task (re-review MEDIUM-1), and a client-supplied id must be
      // ignored — the server owns id generation on create (re-review HIGH-2).
      const second = yield* requestJson<SessionTask.Info>(pathFor(SessionPaths.task, { sessionID: session.id }), {
        method: "POST",
        headers,
        body: JSON.stringify({ id: "tsk_client_forged", content: "two", status: "pending", priority: "medium" }),
      })
      expect(second.content).toBe("two")
      expect(second.id).not.toBe("tsk_client_forged")
      expect(second.id).not.toBe(taskID)

      // Patch ONE task by id — the other survives (no full reconcile).
      const patched = yield* requestJson<SessionTask.Info>(
        pathFor(SessionPaths.taskItem, { sessionID: session.id, taskID }),
        { method: "PATCH", headers, body: JSON.stringify({ status: "completed" }) },
      )
      expect(patched.status).toBe("completed")
      const afterPatch = yield* requestJson<SessionTask.Info[]>(pathFor(SessionPaths.task, { sessionID: session.id }), {
        headers,
      })
      expect(afterPatch.map((task) => task.content).sort()).toEqual(["one", "two"])

      // Patch a task the session doesn't own → 404 (scoped by session).
      const foreignResponse = yield* request(
        pathFor(SessionPaths.taskItem, { sessionID: session.id, taskID: "tsk_foreign" }),
        { method: "PATCH", headers, body: JSON.stringify({ status: "completed" }) },
      )
      expect(foreignResponse.status).toBe(404)

      // A scheduled task without a trigger is rejected at the HTTP boundary
      // too (HIGH-4: the create endpoint shares the domain invariant).
      const deadResponse = yield* request(pathFor(SessionPaths.task, { sessionID: session.id }), {
        method: "POST",
        headers,
        body: JSON.stringify({ content: "dead", status: "scheduled", priority: "medium" }),
      })
      expect(deadResponse.status).toBe(400)

      // Delete ONE task by id — the other survives.
      const removed = yield* requestJson<SessionTask.Info>(
        pathFor(SessionPaths.taskItem, { sessionID: session.id, taskID }),
        { method: "DELETE", headers },
      )
      expect(removed.id).toBe(taskID)
      const afterDelete = yield* requestJson<SessionTask.Info[]>(
        pathFor(SessionPaths.task, { sessionID: session.id }),
        {
          headers,
        },
      )
      expect(afterDelete.map((task) => task.content)).toEqual(["two"])
    }),
  )
})

describe("session permission tier HttpApi", () => {
  it.instance("creates with permissionTier and attended, updates the tier, and round-trips through get", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = {
        "x-aigcfroge-directory": encodeURIComponent(test.directory),
        "content-type": "application/json",
      }

      const created = yield* requestJson<Session.Info>(SessionPaths.create, {
        method: "POST",
        headers,
        body: JSON.stringify({ mode: "chat", permissionTier: "full", attended: false }),
      })
      expect(created).toMatchObject({ permissionTier: "full", attended: false })

      const fetched = yield* requestJson<Session.Info>(pathFor(SessionPaths.get, { sessionID: created.id }), {
        headers,
      })
      expect(fetched).toMatchObject({ id: created.id, permissionTier: "full", attended: false })

      // M6 防护：unattended 会话不允许更新档位（创建契约仍保留）。
      const rejected = yield* request(pathFor(SessionPaths.update, { sessionID: created.id }), {
        method: "PATCH",
        headers,
        body: JSON.stringify({ permissionTier: "propose" }),
      })
      expect(rejected.status).toBe(400)
      expect(yield* responseJson(rejected)).toMatchObject({ _tag: "InvalidRequestError" })

      const attended = yield* requestJson<Session.Info>(SessionPaths.create, {
        method: "POST",
        headers,
        body: JSON.stringify({ mode: "chat", permissionTier: "full" }),
      })
      const updated = yield* requestJson<Session.Info>(pathFor(SessionPaths.update, { sessionID: attended.id }), {
        method: "PATCH",
        headers,
        body: JSON.stringify({ permissionTier: "propose" }),
      })
      expect(updated).toMatchObject({ id: attended.id, permissionTier: "propose" })

      const defaulted = yield* requestJson<Session.Info>(SessionPaths.create, {
        method: "POST",
        headers,
        body: JSON.stringify({ title: "default tier" }),
      })
      expect(defaulted.permissionTier).toBe("propose")
    }),
  )

  it.live(
    "round-trips permissionTier through the default V1 create + sync prompt path",
    () =>
      Effect.gen(function* () {
        const llm = yield* TestLLMServer
        yield* llm.text("ok", { usage: { input: 1, output: 1 } })

        const config = testProviderConfig(llm.url)
        const sessionDirectory = yield* tmpdirScoped({ git: true, config })
        const headers = {
          "x-aigcfroge-directory": encodeURIComponent(sessionDirectory),
          "content-type": "application/json",
        }

        const created = yield* requestJson<Session.Info>(SessionPaths.create, {
          method: "POST",
          headers,
          body: JSON.stringify({ mode: "chat", permissionTier: "full" }),
        })
        expect(created).toMatchObject({ permissionTier: "full" })

        const response = yield* request(pathFor(SessionPaths.prompt, { sessionID: created.id }), {
          method: "POST",
          headers,
          body: JSON.stringify({
            agent: "chat-orchestrator",
            model: { providerID: "test", modelID: "test-model" },
            parts: [{ type: "text", text: "hello" }],
          }),
        })
        if (response.status !== 200) {
          const body = yield* response.text
          throw new Error(`prompt failed: ${response.status} ${body}`)
        }
        expect(response.status).toBe(200)
        yield* responseJson(response)

        const fetched = yield* requestJson<Session.Info>(pathFor(SessionPaths.get, { sessionID: created.id }), {
          headers,
        })
        expect(fetched).toMatchObject({ id: created.id, permissionTier: "full" })
      }).pipe(Effect.provide(TestLLMServer.layer), Effect.provide(CrossSpawnSpawner.defaultLayer)),
    { timeout: 60_000 },
  )
})

describe("session permission override HttpApi", () => {
  it.instance("enables, renews, and disables the override for an attended root session", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = {
        "x-aigcfroge-directory": encodeURIComponent(test.directory),
        "content-type": "application/json",
      }
      const session = yield* createSession({ mode: "chat", agent: "meta" })

      const initial = yield* requestJson<{ enabled: boolean }>(
        pathFor(SessionPaths.permissionOverride, { sessionID: session.id }),
        { headers },
      )
      expect(initial).toEqual({ enabled: false })

      const missingAck = yield* request(pathFor(SessionPaths.permissionOverride, { sessionID: session.id }), {
        method: "PUT",
        headers,
        body: JSON.stringify({}),
      })
      expect(missingAck.status).toBe(400)

      const enabled = yield* requestJson<{ enabled: boolean }>(
        pathFor(SessionPaths.permissionOverride, { sessionID: session.id }),
        { method: "PUT", headers, body: JSON.stringify({ acknowledged: true }) },
      )
      expect(enabled).toEqual({ enabled: true })

      const renewed = yield* requestJson<{ enabled: boolean }>(
        pathFor(SessionPaths.permissionOverride, { sessionID: session.id }),
        { method: "PUT", headers, body: JSON.stringify({}) },
      )
      expect(renewed).toEqual({ enabled: true })

      const disabled = yield* requestJson<{ enabled: boolean }>(
        pathFor(SessionPaths.permissionOverride, { sessionID: session.id }),
        { method: "DELETE", headers },
      )
      expect(disabled).toEqual({ enabled: false })
    }),
  )

  it.instance("rejects override activation for child and unattended sessions", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = {
        "x-aigcfroge-directory": encodeURIComponent(test.directory),
        "content-type": "application/json",
      }
      const parent = yield* createSession({ mode: "chat", agent: "meta" })
      const child = yield* createSession({ parentID: parent.id, mode: "chat", agent: "meta" })
      const unattended = yield* createSession({ mode: "chat", agent: "meta", attended: false })

      for (const session of [child, unattended]) {
        const response = yield* request(pathFor(SessionPaths.permissionOverride, { sessionID: session.id }), {
          method: "PUT",
          headers,
          body: JSON.stringify({ acknowledged: true }),
        })
        expect(response.status).toBe(400)
        expect(yield* responseJson(response)).toMatchObject({ _tag: "InvalidRequestError" })
      }
    }),
  )
})

describe("session permission tier update guards (M6)", () => {
  it.instance("rejects tier updates for child and unattended sessions with 400", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = {
        "x-aigcfroge-directory": encodeURIComponent(test.directory),
        "content-type": "application/json",
      }
      const parent = yield* createSession({ mode: "chat", agent: "meta" })
      const child = yield* createSession({ parentID: parent.id, mode: "chat", agent: "meta" })
      const unattended = yield* createSession({ mode: "chat", agent: "meta", attended: false })

      for (const session of [child, unattended]) {
        const response = yield* request(pathFor(SessionPaths.update, { sessionID: session.id }), {
          method: "PATCH",
          headers,
          body: JSON.stringify({ permissionTier: "full" }),
        })
        expect(response.status).toBe(400)
        expect(yield* responseJson(response)).toMatchObject({ _tag: "InvalidRequestError" })
      }

      const ok = yield* requestJson<Session.Info>(pathFor(SessionPaths.update, { sessionID: parent.id }), {
        method: "PATCH",
        headers,
        body: JSON.stringify({ permissionTier: "full" }),
      })
      expect(ok).toMatchObject({ id: parent.id, permissionTier: "full" })
    }),
  )
})
