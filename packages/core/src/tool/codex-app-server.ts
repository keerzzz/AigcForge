export * as CodexAppServer from "./codex-app-server"

import { Duration, Effect, Scope, Deferred, Exit, Option, Schema } from "effect"
import * as Stream from "effect/Stream"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { which } from "../util/which"
import { DelegationParser } from "./delegation-parser"
import type { CliAdapter, DelegationResult } from "./cli-adapter"

// --- Effect Schemas matching codex-cli 0.150.1 snapshot ---

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
  model: Schema.optional(Schema.String),
})
export const ThreadStartResponse = ThreadResponse

export const ThreadResumeParams = Schema.Struct({
  threadId: Schema.String,
  cwd: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
})
export const ThreadResumeResponse = ThreadResponse

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
  threadId: Schema.String,
  input: Schema.Array(UserInput),
  cwd: Schema.optional(Schema.String),
  approvalPolicy: Schema.optional(Schema.String),
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
  completedAtMs: Schema.Int,
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
  | { readonly method: "error"; readonly params: typeof ErrorNotification.Type }

export class ProtocolError extends Schema.TaggedErrorClass<ProtocolError>()("CodexAppServer.ProtocolError", {
  method: Schema.String,
  reason: Schema.String,
}) {
  override get message() {
    return `${this.method}: ${this.reason}`
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
}

const request = <T>(
  connection: CodexAppServerConnection,
  input: CodexAppServerClientRequest,
  responseSchema: Schema.Decoder<T>,
) => connection.request(input.method, input.params, responseSchema)

export type CodexAppServerConnectionFactory = (input: {
  cwd: string
  resumeId?: string
}) => Effect.Effect<CodexAppServerConnection, Error, Scope.Scope>

export interface CodexAppServerNegotiation {
  readonly supported: boolean
  readonly userAgent?: string
  readonly fallbackTransport?: "sdk" | "jsonl"
  readonly resolveAdapter: (input: { fallbackSdk?: CliAdapter; fallbackJsonl?: CliAdapter }) => CliAdapter
}

const fallbackAdapter = (input: { fallbackSdk?: CliAdapter; fallbackJsonl?: CliAdapter }) => {
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
  readonly appServer: CliAdapter
  readonly fallbackSdk: CliAdapter
  readonly fallbackJsonl: CliAdapter
}): CliAdapter {
  const resolve = (request: Parameters<NonNullable<CliAdapter["execute"]>>[0]) =>
    Effect.scoped(
      Effect.gen(function* () {
        const negotiation = yield* negotiateFor(request.cwd)
        return negotiation.supported
          ? input.appServer
          : negotiation.resolveAdapter({ fallbackSdk: input.fallbackSdk, fallbackJsonl: input.fallbackJsonl })
      }).pipe(Effect.catch(() => Effect.succeed(input.fallbackSdk ?? input.fallbackJsonl))),
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

const activeTurnsByThread = new Map<string, ActiveTurnRecord>()

const initializeConnection = (connection: CodexAppServerConnection) =>
  request(
    connection,
    {
      method: "initialize",
      params: {
        clientInfo: { name: "aigcfroge", version: "0.1.0" },
        capabilities: { experimentalApi: true },
      },
    },
    InitializeResponse,
  )

export function makeCodexAppServerAdapter(
  connectionFactory: CodexAppServerConnectionFactory,
  name = "codex",
): CliAdapter {
  return {
    name,
    command: "codex",
    description: "Codex — OpenAI's coding agent (app-server transport)",
    transport: "app-server",
    detect: () => Effect.sync(() => which("codex") !== null),
    buildArgs: () => Effect.succeed([]),
    parseOutput: (stdout) => Effect.succeed({ status: "success" as const, summary: stdout }),

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

    archiveThread: (threadId) =>
      Effect.scoped(
        Effect.gen(function* () {
          const conn = yield* connectionFactory({ cwd: process.cwd(), resumeId: threadId })
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
      Effect.scoped(
        Effect.gen(function* () {
          const active = activeTurnsByThread.get(options.threadId)
          const conn = active
            ? active.conn
            : yield* connectionFactory({ cwd: process.cwd(), resumeId: options.threadId })
          if (!active) {
            yield* Effect.addFinalizer(() => conn.close())
            yield* initializeConnection(conn)
          }
          const res = yield* request(
            conn,
            {
              method: "turn/steer",
              params: {
                threadId: options.threadId,
                expectedTurnId: options.expectedTurnId,
                input: options.input,
              },
            },
            TurnSteerResponse,
          )
          return { turnId: res.turnId }
        }),
      ),

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

    execute: ({ prompt, cwd, resumeId, timeoutMs }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const conn = yield* connectionFactory({ cwd, resumeId })
          yield* Effect.addFinalizer(() => conn.close())

          yield* request(
            conn,
            {
              method: "initialize",
              params: {
                clientInfo: { name: "aigcfroge", version: "0.1.0" },
                capabilities: { experimentalApi: true },
              },
            },
            InitializeResponse,
          ).pipe(Effect.ignore)

          let threadId: string
          if (!resumeId) {
            const startRes = yield* request(
              conn,
              {
                method: "thread/start",
                params: {
                  cwd,
                  approvalPolicy: "never",
                },
              },
              ThreadStartResponse,
            )
            threadId = startRes.thread.id
          } else {
            threadId = resumeId
            yield* request(conn, { method: "thread/resume", params: { threadId, cwd } }, ThreadResumeResponse).pipe(
              Effect.ignore,
            )
          }

          const turnDeferred = yield* Deferred.make<DelegationResult, Error>()
          const agentTextParts: string[] = []

          const unsubscribe = conn.onNotification((notif) => {
            if (notif.method === "error" && !notif.params.willRetry) {
              Deferred.doneUnsafe(
                turnDeferred,
                Exit.succeed({
                  status: "failed" as const,
                  summary: notif.params.error.message,
                  sessionId: threadId,
                  turnId: notif.params.turnId,
                  errorCode: "app_server_turn_error",
                  recoveryRequired: true,
                }),
              )
              return
            }
            if (notif.method === "item/agentMessage/delta") {
              const delta = notif.params.delta
              if (delta) agentTextParts.push(delta)
            }
            if (notif.method === "turn/completed") {
              const turn = notif.params.turn
              if (turn?.status === "interrupted") {
                Deferred.doneUnsafe(
                  turnDeferred,
                  Exit.succeed({
                    status: "failed" as const,
                    summary: "Turn was interrupted",
                    sessionId: threadId,
                    turnId: turn.id,
                    errorCode: "interrupted",
                    recoveryRequired: true,
                  }),
                )
              } else if (turn?.status === "failed") {
                Deferred.doneUnsafe(
                  turnDeferred,
                  Exit.succeed({
                    status: "failed" as const,
                    summary: "Turn failed",
                    sessionId: threadId,
                    turnId: turn.id,
                    errorCode: "turn_failed",
                    recoveryRequired: true,
                  }),
                )
              } else if (turn?.status === "completed") {
                const text = agentTextParts.join("").trim() || "Turn completed"
                const parsed = DelegationParser.parseDelegationResult(text)
                Deferred.doneUnsafe(
                  turnDeferred,
                  Exit.succeed({
                    status: "success" as const,
                    summary: text,
                    sessionId: threadId,
                    turnId: turn.id,
                    review: parsed?.review,
                  }),
                )
              }
            }
          })
          yield* Effect.addFinalizer(() => Effect.sync(unsubscribe))

          const startTurnRes = yield* request(
            conn,
            {
              method: "turn/start",
              params: {
                threadId,
                input: [{ type: "text", text: prompt }],
                cwd,
              },
            },
            TurnStartResponse,
          )
          const turnId = startTurnRes.turn.id

          activeTurnsByThread.set(threadId, { conn, threadId, turnId, cwd })
          yield* Effect.addFinalizer(() => Effect.sync(() => activeTurnsByThread.delete(threadId)))

          return yield* Deferred.await(turnDeferred).pipe(
            Effect.timeoutOrElse({
              duration: Duration.millis(timeoutMs ?? 300_000),
              orElse: () =>
                Effect.succeed({
                  status: "failed" as const,
                  summary: `CLI "${name}" app-server execution timed out`,
                  sessionId: threadId,
                  turnId,
                  errorCode: "timeout",
                  recoveryRequired: true,
                  errors: ["Timed out"],
                }),
            }),
          )
        }).pipe(
          Effect.catch((err: unknown) =>
            Effect.succeed<DelegationResult>({
              status: "failed",
              summary: err instanceof Error ? err.message : String(err),
              sessionId: resumeId ?? "",
              errorCode: "app_server_execution_error",
              recoveryRequired: true,
            }),
          ),
        ),
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
      ChildProcess.make(resolveCodexAppServerCommand(), ["app-server", "--stdio"], {
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
    const pending = new Map<number, Deferred.Deferred<unknown, Error>>()
    const listeners = new Set<(notification: CodexAppServerServerNotification) => void>()

    const failPending = (error: Error) =>
      Effect.sync(() => {
        for (const deferred of pending.values()) Deferred.doneUnsafe(deferred, Exit.fail(error))
        pending.clear()
      })

    const pump = handle.stdout.pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.runForEach((line) =>
        Effect.gen(function* () {
          const trimmed = line.trim()
          if (!trimmed) return
          const parsed = yield* Effect.try({
            try: () => JSON.parse(trimmed) as unknown,
            catch: (error) => new ProtocolError({ method: "jsonrpc", reason: `Malformed JSON: ${String(error)}` }),
          })
          if (typeof parsed !== "object" || parsed === null) {
            yield* new ProtocolError({ method: "jsonrpc", reason: "Message must be an object" })
            return
          }
          if ("id" in parsed && typeof parsed.id === "number") {
            const deferred = pending.get(parsed.id)
            if (!deferred) return
            pending.delete(parsed.id)
            if ("error" in parsed && parsed.error) {
              const reason =
                typeof parsed.error === "object" && parsed.error !== null && "message" in parsed.error
                  ? String(parsed.error.message)
                  : JSON.stringify(parsed.error)
              Deferred.doneUnsafe(deferred, Exit.fail(new Error(reason)))
              return
            }
            Deferred.doneUnsafe(deferred, Exit.succeed("result" in parsed ? parsed.result : undefined))
            return
          }
          if ("method" in parsed && typeof parsed.method === "string") {
            const notification = yield* decodeNotification({
              method: parsed.method,
              params: "params" in parsed ? parsed.params : undefined,
            })
            if (!notification) return
            for (const listener of listeners) listener(notification)
          }
        }),
      ),
      Effect.catch((error) => failPending(error instanceof Error ? error : new Error(String(error)))),
      Effect.andThen(failPending(new Error("Codex app-server stdout closed"))),
    )
    yield* pump.pipe(Effect.forkScoped)

    const conn: CodexAppServerConnection = {
      request: <T>(method: string, params?: unknown, decoder?: Schema.Decoder<T>): Effect.Effect<T, Error> =>
        Effect.gen(function* () {
          if (!decoder) return yield* Effect.fail(new Error(`Missing response schema for ${method}`))
          const id = nextId++
          const deferred = yield* Deferred.make<unknown, Error>()
          pending.set(id, deferred)
          const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"
          yield* Stream.make(new TextEncoder().encode(payload)).pipe(
            Stream.run(handle.stdin),
            Effect.catch((error) =>
              Effect.gen(function* () {
                pending.delete(id)
                return yield* Effect.fail(new Error(`Failed to write to app-server stdin: ${error}`))
              }),
            ),
          )
          const result = yield* Deferred.await(deferred)
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

      close: () =>
        Effect.gen(function* () {
          yield* failPending(new Error("Connection closed"))
          listeners.clear()
          yield* handle.kill().pipe(Effect.orDie)
        }),
    }

    yield* Effect.addFinalizer(() => conn.close())
    return conn
  })

export const adapter: CliAdapter = makeCodexAppServerAdapter(makeCodexAppServerProcessConnection, "codex-app-server")
