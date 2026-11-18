export * as CodexAppServer from "./codex-app-server.js"

import { Cause, Duration, Effect, Scope, Deferred, Exit, Option, Queue, Schema, Stream } from "effect"
import { ChildProcess } from "effect/process"
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import { which } from "../util/which"
import { CliAdapter } from "./cli-adapter.js"
import type { CliAdapterValue } from "./cli-adapter.js"

// Execution codecs follow the pinned codex-cli 0.162.1 protocol.

export const UserInput = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("text"),
    text: Schema.String,
    text_elements: Schema.optional(Schema.Array(Schema.Unknown)),
  }),
  Schema.Struct({
    type: Schema.Literal("image"),
    url: Schema.String,
    detail: Schema.optional(Schema.Unknown),
  }),
  Schema.Struct({
    type: Schema.Literal("localImage"),
    path: Schema.String,
    detail: Schema.optional(Schema.Unknown),
  }),
  Schema.Struct({
    type: Schema.Literal("audio"),
    url: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("localAudio"),
    path: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("skill"),
    name: Schema.String,
    path: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("mention"),
    name: Schema.String,
    path: Schema.String,
  }),
])
export type UserInput = typeof UserInput.Type

export const InitializeParams = Schema.Struct({
  clientInfo: Schema.Struct({
    name: Schema.String,
    version: Schema.String,
  }),
  capabilities: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        experimentalApi: Schema.optional(Schema.Boolean),
        requestAttestation: Schema.optional(Schema.Boolean),
        mcpServerOpenaiFormElicitation: Schema.optional(Schema.Boolean),
        optOutNotificationMethods: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
        extensions: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))),
      }),
    ),
  ),
})

export const InitializeResponse = Schema.Struct({
  userAgent: Schema.String,
})

const AskForApproval = Schema.Union([
  Schema.Literals(["untrusted", "on-request", "never"]),
  Schema.Struct({
    granular: Schema.Struct({
      mcp_elicitations: Schema.Boolean,
      rules: Schema.Boolean,
      sandbox_approval: Schema.Boolean,
      request_permissions: Schema.optional(Schema.Boolean),
      skill_approval: Schema.optional(Schema.Boolean),
    }),
  }),
])

const SandboxPolicy = Schema.Union([
  Schema.Struct({ type: Schema.Literal("dangerFullAccess") }),
  Schema.Struct({ type: Schema.Literal("readOnly"), networkAccess: Schema.optional(Schema.Boolean) }),
  Schema.Struct({ type: Schema.Literal("externalSandbox"), networkAccess: Schema.optional(Schema.String) }),
  Schema.Struct({
    type: Schema.Literal("workspaceWrite"),
    networkAccess: Schema.optional(Schema.Boolean),
    writableRoots: Schema.optional(Schema.Array(Schema.String)),
    excludeSlashTmp: Schema.optional(Schema.Boolean),
    excludeTmpdirEnvVar: Schema.optional(Schema.Boolean),
  }),
])

const TurnStatus = Schema.Literals(["completed", "interrupted", "failed", "inProgress"])
const Turn = Schema.Struct({
  id: Schema.String,
  items: Schema.Array(Schema.Unknown),
  itemsView: Schema.optionalKey(Schema.Literals(["notLoaded", "summary", "full"])),
  status: TurnStatus,
  error: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        message: Schema.String,
        additionalDetails: Schema.optional(Schema.NullOr(Schema.String)),
        codexErrorInfo: Schema.optional(Schema.NullOr(Schema.Unknown)),
      }),
    ),
  ),
})

const Thread = Schema.Struct({
  id: Schema.String,
  cliVersion: Schema.String,
  createdAt: Schema.Int,
  cwd: Schema.String,
  ephemeral: Schema.Boolean,
  modelProvider: Schema.String,
  preview: Schema.String,
  projectId: Schema.NullOr(Schema.String),
  sessionId: Schema.String,
  source: Schema.Unknown,
  status: Schema.Unknown,
  turns: Schema.Array(Turn),
  updatedAt: Schema.Int,
})

const ThreadResponse = Schema.Struct({
  approvalPolicy: AskForApproval,
  approvalsReviewer: Schema.Literals(["user", "auto_review", "guardian_subagent"]),
  cwd: Schema.String,
  model: Schema.String,
  modelProvider: Schema.String,
  sandbox: SandboxPolicy,
  thread: Thread,
})

export const ThreadStartParams = Schema.Struct({
  cwd: Schema.optional(Schema.String),
  approvalPolicy: Schema.optional(Schema.String),
  approvalsReviewer: Schema.optional(Schema.Literal("user")),
  model: Schema.optional(Schema.String),
  sandbox: Schema.optional(Schema.Literal("read-only")),
})
export const ThreadStartResponse = ThreadResponse

export const ThreadResumeParams = Schema.Struct({
  threadId: Schema.String,
  cwd: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  approvalPolicy: Schema.optional(Schema.String),
  approvalsReviewer: Schema.optional(Schema.Literal("user")),
  sandbox: Schema.optional(Schema.Literal("read-only")),
})
export const ThreadResumeResponse = ThreadResponse

export const ThreadReadParams = Schema.Struct({
  threadId: Schema.String,
  includeTurns: Schema.optionalKey(Schema.Boolean),
})
export const ThreadReadResponse = Schema.Struct({ thread: Thread })

export const ThreadForkParams = Schema.Struct({
  threadId: Schema.String,
  lastTurnId: Schema.optional(Schema.NullOr(Schema.String)),
  cwd: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
})
export const ThreadForkResponse = ThreadResponse

export const ThreadArchiveParams = Schema.Struct({ threadId: Schema.String })
export const ThreadArchiveResponse = Schema.Struct({})
export const ThreadDeleteParams = Schema.Struct({ threadId: Schema.String })
export const ThreadDeleteResponse = Schema.Struct({})

export const TurnStartParams = Schema.Struct({
  sandboxPolicy: Schema.optional(SandboxPolicy),
  threadId: Schema.String,
  input: Schema.Array(UserInput),
  cwd: Schema.optional(Schema.String),
  approvalPolicy: Schema.optional(Schema.String),
  approvalsReviewer: Schema.optional(Schema.Literal("user")),
})
export const TurnStartResponse = Schema.Struct({ turn: Turn })

export const TurnSteerParams = Schema.Struct({
  threadId: Schema.String,
  expectedTurnId: Schema.String,
  input: Schema.Array(UserInput),
})
export const TurnSteerResponse = Schema.Struct({ turnId: Schema.String })
export const TurnInterruptParams = Schema.Struct({ threadId: Schema.String, turnId: Schema.String })
export const TurnInterruptResponse = Schema.Struct({})

export const CapabilitiesReadResponse = Schema.Struct({
  namespaceTools: Schema.Boolean,
  imageGeneration: Schema.Boolean,
  webSearch: Schema.Boolean,
})

export const AgentMessageDeltaNotification = Schema.Struct({
  threadId: Schema.String,
  turnId: Schema.String,
  itemId: Schema.String,
  delta: Schema.String,
})
export const TurnStartedNotification = Schema.Struct({ threadId: Schema.String, turn: Turn })
export const TurnCompletedNotification = Schema.Struct({ threadId: Schema.String, turn: Turn })
export const ItemCompletedNotification = Schema.Struct({
  completedAtMs: Schema.optional(Schema.Int),
  threadId: Schema.String,
  turnId: Schema.String,
  item: Schema.Unknown,
})
export const ErrorNotification = Schema.Struct({
  error: Schema.Struct({
    message: Schema.String,
    additionalDetails: Schema.optional(Schema.NullOr(Schema.String)),
    codexErrorInfo: Schema.optional(Schema.NullOr(Schema.Unknown)),
  }),
  threadId: Schema.String,
  turnId: Schema.String,
  willRetry: Schema.Boolean,
})

export type CodexAppServerServerNotification =
  | { readonly method: "turn/started"; readonly params: typeof TurnStartedNotification.Type }
  | { readonly method: "turn/completed"; readonly params: typeof TurnCompletedNotification.Type }
  | { readonly method: "item/agentMessage/delta"; readonly params: typeof AgentMessageDeltaNotification.Type }
  | { readonly method: "item/completed"; readonly params: typeof ItemCompletedNotification.Type }
  | { readonly method: "item/started"; readonly params: typeof ItemCompletedNotification.Type }
  | { readonly method: "error"; readonly params: typeof ErrorNotification.Type }

export class ProtocolError extends Schema.TaggedError<ProtocolError>()("CodexAppServer.ProtocolError", {
  method: Schema.String,
  reason: Schema.String,
}) {
  override get message() {
    return `${this.method}: ${this.reason}`
  }
}

/** Created only from a JSON-RPC error response matched to an outstanding request. */
export class RpcResponseError extends Schema.TaggedError<RpcResponseError>()("CodexAppServer.RpcResponseError", {
  method: Schema.String,
  requestID: Schema.Union([Schema.String, Schema.Number]),
  reason: Schema.String,
  code: Schema.optionalKey(Schema.Number),
  data: Schema.optionalKey(Schema.Json),
}) {
  override get message() {
    return `${this.method}: ${this.reason}`
  }
}

export class SteerError extends Schema.TaggedError<SteerError>()("CodexAppServer.SteerError", {
  threadID: Schema.String,
  turnID: Schema.String,
  phase: Schema.Literals(["not_sent", "rejected", "unknown"]),
  reason: Schema.String,
  requestID: Schema.optionalKey(Schema.Union([Schema.String, Schema.Number])),
  code: Schema.optionalKey(Schema.Number),
  data: Schema.optionalKey(Schema.Json),
}) {
  override get message() {
    return `turn/steer (${this.phase}): ${this.reason}`
  }
}

export const decodeNotification = (raw: {
  method: string
  params: unknown
}): Effect.Effect<CodexAppServerServerNotification | undefined, ProtocolError> => {
  const decode = <M extends CodexAppServerServerNotification["method"], A>(method: M, schema: Schema.Decoder<A>) =>
    Schema.decodeUnknownEffect(schema)(raw.params).pipe(
      Effect.map((params) => ({ method, params })),
      Effect.mapError(
        (error) =>
          new ProtocolError({
            method,
            reason: `Malformed notification payload: ${String(error)}`,
          }),
      ),
    )
  if (raw.method === "item/agentMessage/delta") return decode(raw.method, AgentMessageDeltaNotification)
  if (raw.method === "item/started") return decode(raw.method, ItemCompletedNotification)
  if (raw.method === "turn/completed") return decode(raw.method, TurnCompletedNotification)
  if (raw.method === "turn/started") return decode(raw.method, TurnStartedNotification)
  if (raw.method === "item/completed") return decode(raw.method, ItemCompletedNotification)
  if (raw.method === "error") return decode(raw.method, ErrorNotification)
  return Effect.succeed(undefined)
}

export type CodexAppServerClientRequest =
  | { readonly method: "initialize"; readonly params: typeof InitializeParams.Type }
  | { readonly method: "modelProvider/capabilities/read"; readonly params: Record<string, never> }
  | { readonly method: "thread/start"; readonly params: typeof ThreadStartParams.Type }
  | { readonly method: "thread/resume"; readonly params: typeof ThreadResumeParams.Type }
  | { readonly method: "thread/read"; readonly params: typeof ThreadReadParams.Type }
  | { readonly method: "thread/fork"; readonly params: typeof ThreadForkParams.Type }
  | { readonly method: "thread/archive"; readonly params: typeof ThreadArchiveParams.Type }
  | { readonly method: "thread/delete"; readonly params: typeof ThreadDeleteParams.Type }
  | { readonly method: "turn/start"; readonly params: typeof TurnStartParams.Type }
  | { readonly method: "turn/steer"; readonly params: typeof TurnSteerParams.Type }
  | { readonly method: "turn/interrupt"; readonly params: typeof TurnInterruptParams.Type }

export interface CodexAppServerConnection {
  readonly request: <T>(method: string, params?: unknown, responseSchema?: Schema.Decoder<T>) => Effect.Effect<T, Error>
  readonly onNotification: (callback: (notification: CodexAppServerServerNotification) => void) => () => void
  readonly close: () => Effect.Effect<void>
  readonly notify?: (method: "initialized") => Effect.Effect<void, Error>
  readonly onRequest?: (callback: (request: ServerRequest) => void) => () => void
  readonly respond?: (
    id: string | number,
    result: { decision: "accept" | "decline" | "cancel" },
  ) => Effect.Effect<void, Error>
  readonly onClose?: (callback: (error: Error) => void) => () => void
}

export type ServerRequest = { id: string | number; method: string; params: unknown }

const CommandApproval = Schema.Struct({
  kind: Schema.String,
  environmentId: Schema.NullOr(Schema.String),
  threadId: Schema.String,
  turnId: Schema.String,
  itemId: Schema.String,
  command: Schema.NullOr(Schema.String),
  cwd: Schema.NullOr(Schema.String),
})
const FileApproval = Schema.Struct({
  threadId: Schema.String,
  turnId: Schema.String,
  itemId: Schema.String,
  grantRoot: Schema.optionalKey(Schema.NullOr(Schema.String)),
})
const FileItem = Schema.Struct({
  type: Schema.Literal("fileChange"),
  id: Schema.String,
  changes: Schema.Array(Schema.Struct({ path: Schema.String, kind: Schema.Unknown, diff: Schema.String })),
})
const AgentItem = Schema.Struct({ type: Schema.Literal("agentMessage"), id: Schema.String, text: Schema.String })

const request = <T>(
  connection: CodexAppServerConnection,
  input: CodexAppServerClientRequest,
  responseSchema: Schema.Decoder<T>,
) => connection.request(input.method, input.params, responseSchema)

export type CodexAppServerConnectionFactory = (input: {
  cwd: string
  resumeId?: string
  command?: string
}) => Effect.Effect<CodexAppServerConnection, Error, Scope.Scope>

export interface CodexAppServerNegotiation {
  readonly supported: boolean
  readonly userAgent?: string
  readonly fallbackTransport?: "sdk" | "jsonl"
  readonly resolveAdapter: (input: {
    fallbackSdk?: CliAdapterValue<Error>
    fallbackJsonl?: CliAdapterValue<Error>
  }) => CliAdapterValue<Error>
}

const fallbackAdapter = (input: { fallbackSdk?: CliAdapterValue<Error>; fallbackJsonl?: CliAdapterValue<Error> }) => {
  const adapter = input.fallbackSdk ?? input.fallbackJsonl
  if (!adapter) throw new Error("Codex app-server fallback requires an SDK or JSONL adapter")
  return adapter
}

export const negotiateCapabilities = (connection: CodexAppServerConnection): Effect.Effect<CodexAppServerNegotiation> =>
  Effect.gen(function* () {
    const initRes = yield* request(
      connection,
      {
        method: "initialize",
        params: {
          clientInfo: { name: "aigcfroge", version: "0.1.0" },
          capabilities: { experimentalApi: true },
        },
      },
      InitializeResponse,
    ).pipe(Effect.option)
    if (Option.isNone(initRes) || !initRes.value.userAgent.includes("/0.150.")) {
      return { supported: false, fallbackTransport: "sdk", resolveAdapter: fallbackAdapter }
    }
    const probeRes = yield* request(
      connection,
      { method: "modelProvider/capabilities/read", params: {} },
      CapabilitiesReadResponse,
    ).pipe(Effect.option)
    if (Option.isNone(probeRes)) {
      return { supported: false, fallbackTransport: "sdk", resolveAdapter: fallbackAdapter }
    }
    return {
      supported: true,
      userAgent: initRes.value.userAgent,
      resolveAdapter: () => makeCodexAppServerAdapter(() => Effect.succeed(connection)),
    }
  })

const negotiationCache = new Map<string, Effect.Effect<CodexAppServerNegotiation, Error>>()

const negotiateFor = (cwd: string) => {
  const cached = negotiationCache.get(cwd)
  if (cached) return cached
  const effect = Effect.scoped(
    Effect.gen(function* () {
      const connection = yield* makeCodexAppServerProcessConnection({ cwd })
      return yield* negotiateCapabilities(connection)
    }),
  ).pipe(Effect.cached, Effect.flatten)
  negotiationCache.set(cwd, effect)
  return effect
}

export function makeNegotiatedCodexAdapter(input: {
  readonly appServer: CliAdapterValue<Error>
  readonly fallbackSdk: CliAdapterValue<Error>
  readonly fallbackJsonl: CliAdapterValue<Error>
}): CliAdapterValue<Error> {
  const resolve = (request: Parameters<NonNullable<CliAdapterValue<Error>["execute"]>>[0]) =>
    Effect.scoped(
      Effect.gen(function* () {
        const negotiation = yield* negotiateFor(request.cwd)
        return negotiation.supported
          ? input.appServer
          : negotiation.resolveAdapter({ fallbackSdk: input.fallbackSdk, fallbackJsonl: input.fallbackJsonl })
      }).pipe(Effect.orElseSucceed(() => input.fallbackSdk ?? input.fallbackJsonl)),
    )
  return {
    ...input.appServer,
    name: "codex",
    detect: () => Effect.sync(() => which("codex") !== null),
    execute: (request) =>
      resolve(request).pipe(
        Effect.flatMap((selected) => {
          if (!selected.execute) return Effect.fail(new Error(`CLI adapter ${selected.name} has no execute method`))
          return selected.execute(request)
        }),
        Effect.catch((error) =>
          Effect.succeed({
            status: "failed" as const,
            summary: error instanceof Error ? error.message : String(error),
            sessionId: request.resumeId ?? "",
            errorCode: "app_server_negotiation_error",
            recoveryRequired: true,
          }),
        ),
      ),
    cancel: (cwd, sessionId) => (input.appServer.cancel ? input.appServer.cancel(cwd, sessionId) : Effect.void),
  }
}

interface ActiveTurnRecord {
  readonly conn: CodexAppServerConnection
  readonly threadId: string
  readonly turnId: string
  readonly cwd: string
}

const initializeConnection = (connection: CodexAppServerConnection) =>
  request(
    connection,
    {
      method: "initialize",
      params: {
        clientInfo: { name: "aigcfroge", version: "0.1.0" },
        capabilities: { experimentalApi: true, requestAttestation: false },
      },
    },
    InitializeResponse,
  )

export function makeCodexAppServerAdapter(
  connectionFactory: CodexAppServerConnectionFactory,
  name = "codex",
): CliAdapterValue<Error> {
  const activeTurnsByThread = new Map<string, ActiveTurnRecord>()
  return {
    name,
    command: "codex",
    description: "Codex — OpenAI's coding agent (app-server transport)",
    transport: "app-server",
    forCommand: (command) => ({
      ...makeCodexAppServerAdapter((input) => connectionFactory({ ...input, command }), name),
      command,
    }),
    detect: () => Effect.sync(() => which("codex") !== null),
    buildArgs: () => Effect.succeed([]),
    parseOutput: (stdout) => Effect.succeed({ status: "success" as const, summary: stdout }),

    readResult: (input) =>
      Effect.scoped(
        Effect.gen(function* () {
          if (input.cliVersion !== "0.162.1")
            return yield* new CliAdapter.UnavailableError({ target: name, reason: "requires Codex app-server 0.162.1" })
          const conn = yield* connectionFactory({ cwd: input.cwd, resumeId: input.threadID })
          yield* Effect.addFinalizer(() => conn.close())
          const initialized = yield* initializeConnection(conn)
          if (!/\/0\.162\.1(?:$|[ (])/.test(initialized.userAgent) || !conn.notify)
            return yield* new CliAdapter.UnavailableError({ target: name, reason: "result reader handshake changed" })
          yield* conn.notify("initialized")
          const result = yield* request(
            conn,
            { method: "thread/read", params: { threadId: input.threadID, includeTurns: true } },
            ThreadReadResponse,
          )
          if (
            result.thread.id !== input.threadID ||
            result.thread.cwd !== input.cwd ||
            result.thread.cliVersion !== input.cliVersion ||
            result.thread.modelProvider !== input.modelProvider ||
            result.thread.ephemeral
          )
            return yield* new ProtocolError({ method: "thread/read", reason: "persisted thread binding changed" })
          const turn = result.thread.turns.find((turn) => turn.id === input.turnID)
          if (!turn || turn.itemsView !== "full" || turn.status !== "completed" || turn.error !== null)
            return yield* new ProtocolError({
              method: "thread/read",
              reason: "bound turn has no complete persisted result",
            })
          const text = turn.items
            .flatMap((item) => {
              const decoded = Schema.decodeUnknownOption(AgentItem)(item)
              return Option.isSome(decoded) ? [decoded.value.text] : []
            })
            .at(-1)
          if (!text?.trim())
            return yield* new ProtocolError({ method: "thread/read", reason: "completed turn has no final response" })
          return { status: "success" as const, summary: text, sessionId: input.threadID, turnId: input.turnID }
        }),
      ).pipe(
        Effect.timeoutOrElse({
          duration: "30 seconds",
          orElse: () => new ProtocolError({ method: "thread/read", reason: "persisted result read timed out" }),
        }),
      ),

    startThread: (options) =>
      Effect.scoped(
        Effect.gen(function* () {
          const conn = yield* connectionFactory({ cwd: options?.workingDirectory ?? process.cwd() })
          yield* Effect.addFinalizer(() => conn.close())
          yield* initializeConnection(conn)
          const res = yield* request(
            conn,
            {
              method: "thread/start",
              params: {
                cwd: options?.workingDirectory,
                approvalPolicy: options?.approvalPolicy,
                ...(options?.model ? { model: options.model } : {}),
              },
            },
            ThreadStartResponse,
          )
          return { threadId: res.thread.id }
        }),
      ),

    resumeThread: (threadId, options) =>
      Effect.scoped(
        Effect.gen(function* () {
          const conn = yield* connectionFactory({
            cwd: options?.workingDirectory ?? process.cwd(),
            resumeId: threadId,
          })
          yield* Effect.addFinalizer(() => conn.close())
          yield* initializeConnection(conn)
          yield* request(
            conn,
            {
              method: "thread/resume",
              params: {
                threadId,
                cwd: options?.workingDirectory,
                ...(options?.model ? { model: options.model } : {}),
              },
            },
            ThreadResumeResponse,
          )
          return { threadId }
        }),
      ),

    forkThread: (threadId, options) =>
      Effect.scoped(
        Effect.gen(function* () {
          const conn = yield* connectionFactory({
            cwd: options?.workingDirectory ?? process.cwd(),
            resumeId: threadId,
          })
          yield* Effect.addFinalizer(() => conn.close())
          yield* initializeConnection(conn)
          const res = yield* request(
            conn,
            {
              method: "thread/fork",
              params: {
                threadId,
                lastTurnId: options?.lastTurnId,
                cwd: options?.workingDirectory,
                ...(options?.model ? { model: options.model } : {}),
              },
            },
            ThreadForkResponse,
          )
          return { threadId: res.thread.id }
        }),
      ),

    archiveThread: (threadId, options) =>
      Effect.scoped(
        Effect.gen(function* () {
          const conn = yield* connectionFactory({ cwd: options?.workingDirectory ?? process.cwd(), resumeId: threadId })
          yield* Effect.addFinalizer(() => conn.close())
          yield* initializeConnection(conn)
          yield* request(conn, { method: "thread/archive", params: { threadId } }, ThreadArchiveResponse)
        }),
      ),

    deleteThread: (threadId) =>
      Effect.scoped(
        Effect.gen(function* () {
          const conn = yield* connectionFactory({ cwd: process.cwd(), resumeId: threadId })
          yield* Effect.addFinalizer(() => conn.close())
          yield* initializeConnection(conn)
          yield* request(conn, { method: "thread/delete", params: { threadId } }, ThreadDeleteResponse)
        }),
      ),

    startTurn: (options) =>
      Effect.scoped(
        Effect.gen(function* () {
          const conn = yield* connectionFactory({
            cwd: options.cwd ?? process.cwd(),
            resumeId: options.threadId,
          })
          yield* Effect.addFinalizer(() => conn.close())
          yield* initializeConnection(conn)
          const res = yield* request(
            conn,
            {
              method: "turn/start",
              params: {
                threadId: options.threadId,
                input: options.input,
                ...(options.cwd ? { cwd: options.cwd } : {}),
              },
            },
            TurnStartResponse,
          )
          return { turnId: res.turn.id }
        }),
      ),

    steerTurn: (options) =>
      Effect.gen(function* () {
        const active = activeTurnsByThread.get(options.threadId)
        if (!active || active.turnId !== options.expectedTurnId)
          return yield* new SteerError({
            threadID: options.threadId,
            turnID: options.expectedTurnId,
            phase: "not_sent",
            reason: active ? "The active turn changed" : "No active turn belongs to this adapter",
          })
        const res = yield* request(
          active.conn,
          {
            method: "turn/steer",
            params: {
              threadId: options.threadId,
              expectedTurnId: options.expectedTurnId,
              input: options.input,
            },
          },
          TurnSteerResponse,
        ).pipe(
          Effect.mapError(
            (error) =>
              new SteerError({
                threadID: options.threadId,
                turnID: options.expectedTurnId,
                phase: error instanceof RpcResponseError ? "rejected" : "unknown",
                reason: error.message,
                ...(error instanceof RpcResponseError
                  ? {
                      requestID: error.requestID,
                      ...(error.code !== undefined ? { code: error.code } : {}),
                      ...(error.data !== undefined ? { data: error.data } : {}),
                    }
                  : {}),
              }),
          ),
        )
        if (res.turnId !== options.expectedTurnId)
          return yield* new SteerError({
            threadID: options.threadId,
            turnID: options.expectedTurnId,
            phase: "unknown",
            reason: "The server returned a different turn",
          })
        return { turnId: res.turnId }
      }),

    interruptTurn: (options) =>
      Effect.scoped(
        Effect.gen(function* () {
          const active = activeTurnsByThread.get(options.threadId)
          if (active) {
            yield* request(
              active.conn,
              { method: "turn/interrupt", params: { threadId: options.threadId, turnId: options.turnId } },
              TurnInterruptResponse,
            ).pipe(Effect.ignore)
            activeTurnsByThread.delete(options.threadId)
            return
          }
          const conn = yield* connectionFactory({ cwd: process.cwd(), resumeId: options.threadId })
          yield* Effect.addFinalizer(() => conn.close())
          yield* initializeConnection(conn)
          yield* request(
            conn,
            {
              method: "turn/interrupt",
              params: {
                threadId: options.threadId,
                turnId: options.turnId,
              },
            },
            TurnInterruptResponse,
          )
        }),
      ),

    cancel: (cwd, sessionId) =>
      Effect.gen(function* () {
        if (sessionId) {
          const record = activeTurnsByThread.get(sessionId)
          if (record) {
            yield* request(
              record.conn,
              { method: "turn/interrupt", params: { threadId: record.threadId, turnId: record.turnId } },
              TurnInterruptResponse,
            ).pipe(Effect.ignore)
            activeTurnsByThread.delete(sessionId)
          }
          return
        }
        for (const [tId, record] of Array.from(activeTurnsByThread.entries())) {
          if (record.cwd === cwd) {
            yield* request(
              record.conn,
              { method: "turn/interrupt", params: { threadId: record.threadId, turnId: record.turnId } },
              TurnInterruptResponse,
            ).pipe(Effect.ignore)
            activeTurnsByThread.delete(tId)
          }
        }
      }),

    execute: (input) =>
      Effect.scoped(
        Effect.gen(function* () {
          const conn = yield* connectionFactory({ cwd: input.cwd, resumeId: input.resumeId })
          yield* Effect.addFinalizer(() => conn.close())
          const initialized = yield* initializeConnection(conn)
          if (!/\/0\.162\.1(?:$|[ (])/.test(initialized.userAgent))
            return yield* new CliAdapter.UnavailableError({ target: name, reason: "requires Codex app-server 0.162.1" })
          if (!conn.notify)
            return yield* new CliAdapter.UnavailableError({
              target: name,
              reason: "initialized notification is unavailable",
            })
          yield* conn.notify("initialized")
          if (input.onPermission && (!conn.onRequest || !conn.respond))
            return yield* new CliAdapter.UnavailableError({
              target: name,
              reason: "permission request/reply is unavailable",
            })
          const approvalPolicy = input.onPermission ? "untrusted" : "never"
          const params = {
            cwd: input.cwd,
            approvalPolicy,
            approvalsReviewer: "user" as const,
            sandbox: "read-only" as const,
          }
          const thread = input.resumeId
            ? yield* request(
                conn,
                { method: "thread/resume", params: { ...params, threadId: input.resumeId } },
                ThreadResumeResponse,
              )
            : yield* request(conn, { method: "thread/start", params }, ThreadStartResponse)
          if (input.resumeId && thread.thread.id !== input.resumeId)
            return yield* new ProtocolError({ method: "thread/resume", reason: "returned a different thread" })
          if (
            thread.cwd !== input.cwd ||
            thread.approvalPolicy !== approvalPolicy ||
            thread.approvalsReviewer !== "user" ||
            thread.sandbox.type !== "readOnly" ||
            thread.sandbox.networkAccess !== false
          )
            return yield* new ProtocolError({
              method: "thread/start",
              reason: "requested location or permission policy was not applied",
            })
          const threadID = thread.thread.id
          if (input.onThread)
            yield* input.onThread({
              threadID,
              cwd: thread.cwd,
              model: thread.model,
              modelProvider: thread.modelProvider,
              cliVersion: "0.162.1",
            })
          const queue = yield* Queue.unbounded<CodexAppServerServerNotification | ServerRequest, Error>()
          const unavailable = yield* Deferred.make<never, Error>()
          const endedTurns = new Map<string, ProtocolError>()
          let activeTurnID: string | undefined
          let connected = true
          const unsubscribe = conn.onNotification((event) => {
            Queue.offerUnsafe(queue, event)
            if (event.params.threadId !== threadID) return
            const endedTurnID =
              event.method === "turn/completed"
                ? event.params.turn.id
                : event.method === "error"
                  ? event.params.turnId
                  : undefined
            if (!endedTurnID) return
            const error = new ProtocolError({
              method: event.method,
              reason: `Turn ${endedTurnID} ended before its pending approval was resolved`,
            })
            endedTurns.set(endedTurnID, error)
            if (endedTurnID === activeTurnID) {
              activeTurnsByThread.delete(threadID)
              Deferred.doneUnsafe(unavailable, Exit.fail(error))
            }
          })
          yield* Effect.addFinalizer(() => Effect.sync(unsubscribe))
          if (conn.onRequest) {
            const unsubscribe = conn.onRequest((event) => {
              Queue.offerUnsafe(queue, event)
            })
            yield* Effect.addFinalizer(() => Effect.sync(unsubscribe))
          }
          if (conn.onClose) {
            const unsubscribe = conn.onClose((error) => {
              connected = false
              activeTurnsByThread.delete(threadID)
              Queue.failCauseUnsafe(queue, Cause.fail(error))
              Deferred.doneUnsafe(unavailable, Exit.fail(error))
            })
            yield* Effect.addFinalizer(() => Effect.sync(unsubscribe))
          }
          const started = yield* request(
            conn,
            {
              method: "turn/start",
              params: {
                threadId: threadID,
                input: [{ type: "text", text: input.prompt }],
                cwd: input.cwd,
                approvalPolicy,
                approvalsReviewer: "user",
                sandboxPolicy: { type: "readOnly", networkAccess: false },
              },
            },
            TurnStartResponse,
          )
          const turnID = started.turn.id
          activeTurnID = turnID
          const earlyEnd = endedTurns.get(turnID)
          if (earlyEnd) Deferred.doneUnsafe(unavailable, Exit.fail(earlyEnd))
          let completed = false
          if (!earlyEnd && connected)
            activeTurnsByThread.set(threadID, { conn, threadId: threadID, turnId: turnID, cwd: input.cwd })
          yield* Effect.addFinalizer(() =>
            Effect.gen(function* () {
              activeTurnsByThread.delete(threadID)
              if (!completed)
                yield* request(
                  conn,
                  { method: "turn/interrupt", params: { threadId: threadID, turnId: turnID } },
                  TurnInterruptResponse,
                ).pipe(Effect.timeoutOption("1 second"), Effect.ignore)
            }),
          )
          if (input.onTurn) yield* input.onTurn(turnID)
          const texts = new Map<string, string>()
          const files = new Map<string, readonly string[]>()
          return yield* Effect.gen(function* () {
            while (true) {
              const event = yield* Queue.take(queue)
              if ("id" in event) {
                if (
                  event.method !== "item/commandExecution/requestApproval" &&
                  event.method !== "item/fileChange/requestApproval"
                )
                  return yield* new ProtocolError({
                    method: event.method,
                    reason: "server request is unsupported by this transport slice",
                  })
                const command =
                  event.method === "item/commandExecution/requestApproval"
                    ? Schema.decodeUnknownOption(CommandApproval)(event.params)
                    : Option.none()
                const file =
                  event.method === "item/fileChange/requestApproval"
                    ? Schema.decodeUnknownOption(FileApproval)(event.params)
                    : Option.none()
                const approval: CliAdapter.PermissionRequest | undefined =
                  Option.isSome(command) &&
                  command.value.kind === "command" &&
                  (command.value.environmentId === null || command.value.environmentId === "local") &&
                  command.value.command &&
                  command.value.cwd
                    ? {
                        threadID: command.value.threadId,
                        turnID: command.value.turnId,
                        itemID: command.value.itemId,
                        requestID: event.id,
                        kind: "command",
                        command: command.value.command,
                        cwd: command.value.cwd,
                      }
                    : Option.isSome(file) && !file.value.grantRoot && files.has(file.value.itemId)
                      ? {
                          threadID: file.value.threadId,
                          turnID: file.value.turnId,
                          itemID: file.value.itemId,
                          requestID: event.id,
                          kind: "file",
                          paths: files.get(file.value.itemId) ?? [],
                        }
                      : undefined
                const alreadyEnded = endedTurns.get(turnID)
                if (approval?.threadID === threadID && approval.turnID === turnID && alreadyEnded)
                  return yield* alreadyEnded
                const decision =
                  approval && approval.threadID === threadID && approval.turnID === turnID && input.onPermission
                    ? yield* input.onPermission(approval).pipe(
                        Effect.raceFirst(Deferred.await(unavailable)),
                        Effect.onError(() =>
                          conn.respond && connected && !endedTurns.has(turnID)
                            ? conn.respond(event.id, { decision: "cancel" }).pipe(Effect.ignore)
                            : Effect.void,
                        ),
                      )
                    : "deny"
                const respond = conn.respond
                if (respond)
                  yield* Effect.suspend(() => {
                    // A reply cannot authorize a turn that ended while Permission was resolving.
                    const ended = endedTurns.get(turnID)
                    if (decision === "allow" && ended) return ended
                    if (!connected) return Deferred.await(unavailable)
                    return respond(event.id, { decision: decision === "allow" ? "accept" : "decline" })
                  })
                continue
              }
              if (event.params.threadId !== threadID) continue
              if (event.method === "turn/started") continue
              if (event.method === "turn/completed") {
                if (event.params.turn.id !== turnID) continue
                completed = true
                const final =
                  event.params.turn.items
                    .flatMap((item) => {
                      const decoded = Schema.decodeUnknownOption(AgentItem)(item)
                      return Option.isSome(decoded) ? [decoded.value.text] : []
                    })
                    .at(-1) ??
                  [...texts.values()].at(-1) ??
                  ""
                if (event.params.turn.status !== "completed")
                  return {
                    status: "failed" as const,
                    summary: event.params.turn.error?.message ?? `Turn ${event.params.turn.status}`,
                    sessionId: threadID,
                    turnId: turnID,
                    errorCode: event.params.turn.status,
                    recoveryRequired: true,
                  }
                if (!final.trim())
                  return {
                    status: "failed" as const,
                    summary: "Codex completed without a final response",
                    sessionId: threadID,
                    turnId: turnID,
                    errorCode: "malformed_output",
                    recoveryRequired: true,
                  }
                return { status: "success" as const, summary: final, sessionId: threadID, turnId: turnID }
              }
              if (event.params.turnId !== turnID) continue
              if (event.method === "error")
                return {
                  status: "failed" as const,
                  summary: event.params.error.message,
                  sessionId: threadID,
                  turnId: turnID,
                  errorCode: "app_server_turn_error",
                  recoveryRequired: true,
                }
              if (event.method === "item/agentMessage/delta") {
                texts.set(event.params.itemId, (texts.get(event.params.itemId) ?? "") + event.params.delta)
                if (input.onText) yield* input.onText(event.params.delta)
                continue
              }
              const file = Schema.decodeUnknownOption(FileItem)(event.params.item)
              if (Option.isSome(file))
                files.set(
                  file.value.id,
                  file.value.changes.map((change) => change.path),
                )
              const text = Schema.decodeUnknownOption(AgentItem)(event.params.item)
              if (Option.isSome(text)) texts.set(text.value.id, text.value.text)
            }
          })
        }),
      ).pipe(
        Effect.timeoutOrElse({
          duration: Duration.millis(input.timeoutMs ?? 300_000),
          orElse: () =>
            new ProtocolError({
              method: "execute",
              reason: "Codex app-server execution timed out; reconcile before retry",
            }),
        }),
      ),
  }
}

/**
 * Real production connection factory backed by ChildProcessSpawner and stdio.
 */
export const resolveCodexAppServerCommand = (env: NodeJS.ProcessEnv = process.env) => {
  const delimiter = process.platform === "win32" ? ";" : ":"
  const pathValue = env.PATH ?? env.Path ?? ""
  const userPath = pathValue
    .split(delimiter)
    .filter((entry) => !/(^|[\\/])node_modules[\\/]\.bin([\\/]|$)/.test(entry))
    .join(delimiter)
  return which("codex", { ...env, PATH: userPath, Path: userPath }) ?? which("codex", env) ?? "codex"
}

export const makeCodexAppServerProcessConnection: CodexAppServerConnectionFactory = (input) =>
  Effect.gen(function* () {
    const spawnerOpt = yield* Effect.serviceOption(ChildProcessSpawner)
    if (spawnerOpt._tag === "None") {
      return yield* Effect.fail(new Error("Codex app-server unavailable: no ChildProcessSpawner"))
    }
    const spawner = spawnerOpt.value
    const handle = yield* spawner.spawn(
      ChildProcess.make(input.command ?? resolveCodexAppServerCommand(), ["app-server", "--stdio"], {
        cwd: input.cwd,
        extendEnv: true,
        // JSON-RPC is multi-request; closing stdin after initialize makes the
        // capability probe fail and incorrectly selects the SDK fallback.
        stdin: { stream: "pipe", endOnDone: false },
        stdout: "pipe",
        stderr: "ignore",
        forceKillAfter: "3 seconds",
      }),
    )

    let nextId = 1
    const pending = new Map<string | number, { method: string; deferred: Deferred.Deferred<unknown, Error> }>()
    const listeners = new Set<(notification: CodexAppServerServerNotification) => void>()
    const requests = new Set<(request: ServerRequest) => void>()
    const closures = new Set<(error: Error) => void>()
    let ended: Error | undefined
    let closed = false
    const write = (value: unknown) =>
      Stream.make(new TextEncoder().encode(JSON.stringify(value) + "\n")).pipe(
        Stream.run(handle.stdin),
        Effect.mapError((error) => new Error(`Failed to write to app-server stdin: ${error}`)),
      )
    const decodeFrame = Schema.decodeUnknownEffect(
      Schema.fromJsonString(
        Schema.Struct({
          id: Schema.optionalKey(Schema.Union([Schema.String, Schema.Number])),
          method: Schema.optionalKey(Schema.String),
          params: Schema.optionalKey(Schema.Json),
          result: Schema.optionalKey(Schema.Json),
          error: Schema.optionalKey(
            Schema.Struct({
              message: Schema.String,
              code: Schema.optionalKey(Schema.Number),
              data: Schema.optionalKey(Schema.Json),
            }),
          ),
        }),
      ),
    )

    const failPending = (error: Error) =>
      Effect.sync(() => {
        for (const request of pending.values()) Deferred.doneUnsafe(request.deferred, Exit.fail(error))
        pending.clear()
        ended ??= error
        for (const listener of closures) listener(error)
      })

    const pump = handle.stdout.pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.runForEach((line) =>
        Effect.gen(function* () {
          const trimmed = line.trim()
          if (!trimmed) return
          const parsed = yield* decodeFrame(trimmed).pipe(
            Effect.mapError((error) => new ProtocolError({ method: "jsonrpc", reason: String(error) })),
          )
          if (parsed.method !== undefined) {
            if (parsed.id !== undefined) {
              if (!requests.size) {
                yield* write({ id: parsed.id, error: { code: -32601, message: "Unsupported server request" } })
                return
              }
              for (const listener of requests) listener({ id: parsed.id, method: parsed.method, params: parsed.params })
              return
            }
            const notification = yield* decodeNotification({ method: parsed.method, params: parsed.params })
            if (notification) for (const listener of listeners) listener(notification)
            return
          }
          if (parsed.id !== undefined) {
            const request = pending.get(parsed.id)
            if (!request) return
            pending.delete(parsed.id)
            if (parsed.error) {
              Deferred.doneUnsafe(
                request.deferred,
                Exit.fail(
                  new RpcResponseError({
                    method: request.method,
                    requestID: parsed.id,
                    reason: parsed.error.message,
                    ...(parsed.error.code !== undefined ? { code: parsed.error.code } : {}),
                    ...(parsed.error.data !== undefined ? { data: parsed.error.data } : {}),
                  }),
                ),
              )
              return
            }
            Deferred.doneUnsafe(request.deferred, Exit.succeed(parsed.result))
          }
        }),
      ),
      Effect.catch((error) => failPending(error instanceof Error ? error : new Error(String(error)))),
      Effect.andThen(failPending(new ProtocolError({ method: "stdout", reason: "Codex app-server stdout closed" }))),
    )
    yield* pump.pipe(Effect.forkScoped)

    const conn: CodexAppServerConnection = {
      request: <T>(method: string, params?: unknown, decoder?: Schema.Decoder<T>): Effect.Effect<T, Error> =>
        Effect.gen(function* () {
          if (!decoder) return yield* Effect.fail(new Error(`Missing response schema for ${method}`))
          if (ended) return yield* Effect.fail(ended)
          const id = nextId++
          const deferred = yield* Deferred.make<unknown, Error>()
          pending.set(id, { method, deferred })
          const result = yield* write({ id, method, params }).pipe(
            Effect.andThen(Deferred.await(deferred)),
            Effect.ensuring(
              Effect.sync(() => {
                pending.delete(id)
              }),
            ),
          )
          return yield* Schema.decodeUnknownEffect(decoder)(result).pipe(
            Effect.mapError((error) => new Error(`Schema decode error for ${method}: ${error}`)),
          )
        }),

      onNotification: (callback) => {
        listeners.add(callback)
        return () => {
          listeners.delete(callback)
        }
      },
      notify: (method) => write({ method }),
      respond: (id, result) => write({ id, result }),
      onRequest: (callback) => {
        requests.add(callback)
        return () => {
          requests.delete(callback)
        }
      },
      onClose: (callback) => {
        closures.add(callback)
        if (ended) callback(ended)
        return () => {
          closures.delete(callback)
        }
      },

      close: () =>
        Effect.gen(function* () {
          if (closed) return
          closed = true
          yield* failPending(new Error("Connection closed"))
          listeners.clear()
          requests.clear()
          closures.clear()
          yield* handle.kill().pipe(Effect.ignore)
        }),
    }

    yield* Effect.addFinalizer(() => conn.close())
    return conn
  })

export const adapter: CliAdapterValue<Error> = makeCodexAppServerAdapter(
  makeCodexAppServerProcessConnection,
  "codex-app-server",
)
