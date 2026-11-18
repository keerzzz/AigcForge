import { describe, expect } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Queue, Schema, Sink, Stream } from "effect"
import { CodexAppServer } from "@aigcfroge/core/tool/codex-app-server"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { TestClock } from "effect/testing"
import { awaitWithTimeout, testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)
const activeTurn = { id: "turn-owned", items: [], status: "inProgress" as const, error: null }
const completedTurn = { ...activeTurn, status: "completed" as const }

// A scoped, in-memory peer exercises the production adapter without starting Codex.
function peer(
  notifications: readonly CodexAppServer.CodexAppServerServerNotification[],
  readThread?: unknown,
  beforeRead = Effect.void,
) {
  const listeners = new Set<(notification: CodexAppServer.CodexAppServerServerNotification) => void>()
  const state = { closed: 0, initialized: 0, requests: [] as { method: string; params: unknown }[] }
  const connection: CodexAppServer.CodexAppServerConnection = {
    request: <T>(method: string, params?: unknown, responseSchema?: Schema.Decoder<T>) =>
      Effect.gen(function* () {
        state.requests.push({ method, params })
        if (!responseSchema) return yield* Effect.die(new Error("The peer requires a response codec"))
        if (method === "thread/read") yield* beforeRead
        if (method === "turn/start")
          notifications.forEach((notification) => listeners.forEach((listener) => listener(notification)))
        const response =
          method === "initialize"
            ? { userAgent: "codex/0.162.1" }
            : method === "turn/start"
              ? { turn: activeTurn }
              : method === "turn/steer"
                ? { turnId: "turn-owned" }
                : method === "thread/read"
                  ? { thread: readThread }
                  : {
                      approvalPolicy: "never",
                      approvalsReviewer: "user",
                      cwd: "/project",
                      model: "configured-model",
                      modelProvider: "configured-provider",
                      sandbox: { type: "readOnly", networkAccess: false },
                      thread: {
                        id: "thread-owned",
                        cliVersion: "0.162.1",
                        createdAt: 1,
                        cwd: "/project",
                        ephemeral: false,
                        modelProvider: "configured-provider",
                        preview: "",
                        projectId: null,
                        sessionId: "thread-owned",
                        source: "app-server",
                        status: { type: "idle" },
                        turns: [],
                        updatedAt: 1,
                      },
                    }
        return yield* Schema.decodeUnknownEffect(responseSchema)(response).pipe(
          Effect.mapError((error) => new Error(String(error))),
        )
      }),
    onNotification: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    notify: () => Effect.sync(() => void (state.initialized += 1)),
    close: () => Effect.sync(() => void (state.closed += 1)),
  }
  return {
    adapter: CodexAppServer.makeCodexAppServerAdapter(() => Effect.succeed(connection)),
    state,
    listeners,
  }
}

describe("MC06 Codex app-server execution ownership", () => {
  it.effect("MC06 ignores notifications from another thread or turn before settling the owned result", () =>
    Effect.gen(function* () {
      const fixture = peer([
        { method: "turn/started", params: { threadId: "thread-owned", turn: activeTurn } },
        {
          method: "item/agentMessage/delta",
          params: { threadId: "thread-foreign", turnId: "turn-foreign", itemId: "item-foreign", delta: "FOREIGN" },
        },
        {
          method: "turn/completed",
          params: { threadId: "thread-foreign", turn: { ...completedTurn, id: "turn-foreign" } },
        },
        {
          method: "item/agentMessage/delta",
          params: { threadId: "thread-owned", turnId: "turn-owned", itemId: "item-owned", delta: "OWNED" },
        },
        { method: "turn/completed", params: { threadId: "thread-owned", turn: completedTurn } },
      ])
      if (!fixture.adapter.execute) return yield* Effect.die(new Error("The production adapter has no execute method"))
      const result = yield* fixture.adapter.execute({ prompt: "Report the owned result", cwd: "/project" })
      expect(result).toMatchObject({
        status: "success",
        summary: "OWNED",
        sessionId: "thread-owned",
        turnId: "turn-owned",
      })
      expect(fixture.state.closed).toBe(1)
      expect(fixture.listeners.size).toBe(0)
    }),
  )

  it.effect("MC06 refuses a completed turn without a final response", () =>
    Effect.gen(function* () {
      const fixture = peer([
        { method: "turn/started", params: { threadId: "thread-owned", turn: activeTurn } },
        { method: "turn/completed", params: { threadId: "thread-owned", turn: completedTurn } },
      ])
      if (!fixture.adapter.execute) return yield* Effect.die(new Error("The production adapter has no execute method"))
      const result = yield* fixture.adapter.execute({ prompt: "Return a final response", cwd: "/project" })
      expect(result.status).toBe("failed")
      expect(result.summary).toContain("without a final response")
      expect(result).toMatchObject({ sessionId: "thread-owned", turnId: "turn-owned" })
      expect(fixture.state.closed).toBe(1)
      expect(fixture.listeners.size).toBe(0)
    }),
  )
})

const persistedThread = (text: string) => ({
  id: "thread-owned",
  cliVersion: "0.162.1",
  createdAt: 1,
  cwd: "/project",
  ephemeral: false,
  modelProvider: "configured-provider",
  preview: "",
  projectId: null,
  sessionId: "thread-owned",
  source: "app-server",
  status: { type: "idle" },
  turns: [
    {
      id: "turn-owned",
      status: "completed",
      error: null,
      itemsView: "full",
      items: [{ type: "agentMessage", id: "answer", text }],
    },
  ],
  updatedAt: 1,
})

it.effect("MC06 R3a rejects steer without an active owner without opening a connection", () =>
  Effect.gen(function* () {
    const fixture = peer([])
    if (!fixture.adapter.steerTurn) return yield* Effect.die(new Error("The adapter has no steerTurn method"))
    const result = yield* fixture.adapter
      .steerTurn({
        threadId: "thread-owned",
        expectedTurnId: "turn-owned",
        input: [{ type: "text", text: "Only steer the existing active turn" }],
      })
      .pipe(Effect.exit)
    expect(Exit.isFailure(result)).toBe(true)
    if (Exit.isFailure(result)) expect(Cause.squash(result.cause)).toMatchObject({ phase: "not_sent" })
    expect(fixture.state.requests).toEqual([])
    expect(fixture.state.initialized).toBe(0)
    expect(fixture.state.closed).toBe(0)
  }),
)

it.effect("MC06 R3a exposes the original active connection before onTurn readiness", () =>
  Effect.gen(function* () {
    const fixture = peer([])
    const execute = fixture.adapter.execute
    const steer = fixture.adapter.steerTurn
    if (!execute || !steer) return yield* Effect.die(new Error("The adapter must support execute and steerTurn"))
    const result = yield* execute({
      prompt: "Start the original turn",
      cwd: "/project",
      onTurn: (turnID) =>
        steer({
          threadId: "thread-owned",
          expectedTurnId: turnID,
          input: [{ type: "text", text: "Keep the same active turn" }],
        }).pipe(
          Effect.tap((response) =>
            Effect.sync(() => {
              expect(response.turnId).toBe(turnID)
              expect(fixture.state.initialized).toBe(1)
              expect(fixture.state.closed).toBe(0)
              fixture.listeners.forEach((listener) => {
                listener({
                  method: "item/agentMessage/delta",
                  params: { threadId: "thread-owned", turnId: turnID, itemId: "item-owned", delta: "STEERED" },
                })
                listener({ method: "turn/completed", params: { threadId: "thread-owned", turn: completedTurn } })
              })
            }),
          ),
          Effect.asVoid,
          Effect.orDie,
        ),
    })
    expect(result.summary).toBe("STEERED")
    expect(fixture.state.requests.map((request) => request.method)).toEqual([
      "initialize",
      "thread/start",
      "turn/start",
      "turn/steer",
    ])
    expect(fixture.state.closed).toBe(1)
  }),
)

it.effect("MC06 R3a rejects a mismatched or already completed active turn without a steer RPC", () =>
  Effect.gen(function* () {
    const fixture = peer([])
    const execute = fixture.adapter.execute
    const steer = fixture.adapter.steerTurn
    if (!execute || !steer) return yield* Effect.die(new Error("The adapter must support execute and steerTurn"))
    yield* execute({
      prompt: "Keep the original turn",
      cwd: "/project",
      onTurn: () =>
        steer({
          threadId: "thread-owned",
          expectedTurnId: "foreign-turn",
          input: [{ type: "text", text: "Reject" }],
        }).pipe(
          Effect.flip,
          Effect.tap((error) =>
            Effect.sync(() => {
              expect(error).toMatchObject({ phase: "not_sent" })
              fixture.listeners.forEach((listener) => {
                listener({
                  method: "item/agentMessage/delta",
                  params: { threadId: "thread-owned", turnId: "turn-owned", itemId: "answer", delta: "ORIGINAL" },
                })
                listener({ method: "turn/completed", params: { threadId: "thread-owned", turn: completedTurn } })
              })
            }),
          ),
          Effect.asVoid,
          Effect.orDie,
        ),
    })
    const late = yield* steer({
      threadId: "thread-owned",
      expectedTurnId: "turn-owned",
      input: [{ type: "text", text: "Too late" }],
    }).pipe(Effect.flip)
    expect(late).toMatchObject({ phase: "not_sent" })
    expect(fixture.state.requests.map((request) => request.method)).toEqual([
      "initialize",
      "thread/start",
      "turn/start",
    ])
    expect(fixture.state.closed).toBe(1)
  }),
)

it.effect("MC06 R1 reads the exact completed full turn and preserves its long result", () =>
  Effect.gen(function* () {
    const text = "MC06_R1_" + "x".repeat(5000) + "\n"
    const fixture = peer([], persistedThread(text))
    if (!fixture.adapter.readResult)
      return yield* Effect.die(new Error("The production adapter has no readResult method"))
    const result = yield* fixture.adapter.readResult({
      cwd: "/project",
      threadID: "thread-owned",
      turnID: "turn-owned",
      modelProvider: "configured-provider",
      cliVersion: "0.162.1",
    })
    expect(result).toEqual({ status: "success", summary: text, sessionId: "thread-owned", turnId: "turn-owned" })
    expect(fixture.state.initialized).toBe(1)
    expect(fixture.state.requests.map((request) => request.method)).toEqual(["initialize", "thread/read"])
    expect(fixture.state.requests[1]?.params).toEqual({ threadId: "thread-owned", includeTurns: true })
    expect(fixture.state.closed).toBe(1)
  }),
)

for (const stop of ["interrupt", "timeout"] as const)
  it.effect(`MC06 R1 closes the result reader on ${stop} without starting or interrupting a turn`, () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const fixture = peer(
        [],
        persistedThread("COMPLETE"),
        Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
      )
      if (!fixture.adapter.readResult) return yield* Effect.die(new Error("Result reader missing"))
      const running = yield* fixture.adapter
        .readResult({
          cwd: "/project",
          threadID: "thread-owned",
          turnID: "turn-owned",
          modelProvider: "configured-provider",
          cliVersion: "0.162.1",
        })
        .pipe(Effect.forkScoped)
      yield* Deferred.await(started)
      if (stop === "interrupt") yield* Fiber.interrupt(running)
      if (stop === "timeout") yield* TestClock.adjust("30 seconds")
      expect(Exit.isFailure(yield* Fiber.await(running))).toBe(true)
      expect(fixture.state.closed).toBe(1)
      expect(fixture.state.requests.map((request) => request.method)).toEqual(["initialize", "thread/read"])
    }),
  )

const stored = persistedThread("COMPLETE")
for (const [name, thread] of [
  ["foreign thread", { ...stored, id: "foreign" }],
  ["foreign Location", { ...stored, cwd: "/foreign" }],
  ["changed provider", { ...stored, modelProvider: "foreign" }],
  ["changed version", { ...stored, cliVersion: "0.0.0" }],
  ["ephemeral thread", { ...stored, ephemeral: true }],
  ["missing turn", { ...stored, turns: [] }],
  ["foreign turn", { ...stored, turns: [{ ...stored.turns[0], id: "foreign" }] }],
  ["unfinished turn", { ...stored, turns: [{ ...stored.turns[0], status: "inProgress" }] }],
  ["partial items", { ...stored, turns: [{ ...stored.turns[0], itemsView: "summary" }] }],
  ["terminal error", { ...stored, turns: [{ ...stored.turns[0], error: { message: "Failed" } }] }],
  ["missing final text", { ...stored, turns: [{ ...stored.turns[0], items: [] }] }],
] as const)
  it.effect(`MC06 R1 refuses a persisted ${name}`, () =>
    Effect.gen(function* () {
      const fixture = peer([], thread)
      if (!fixture.adapter.readResult) return yield* Effect.die(new Error("Result reader missing"))
      expect(
        yield* fixture.adapter
          .readResult({
            cwd: "/project",
            threadID: "thread-owned",
            turnID: "turn-owned",
            modelProvider: "configured-provider",
            cliVersion: "0.162.1",
          })
          .pipe(Effect.flip),
      ).toMatchObject({ method: "thread/read" })
      expect(fixture.state.requests.map((request) => request.method)).toEqual(["initialize", "thread/read"])
      expect(fixture.state.closed).toBe(1)
    }),
  )

const frameDecoder = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      id: Schema.optionalKey(Schema.Number),
      method: Schema.optionalKey(Schema.String),
      params: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
      result: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
    }),
  ),
)

// The real production frame pump runs over these byte streams. No process is spawned.
const wirePeer = (
  mode:
    | "command"
    | "local"
    | "file"
    | "missing-file"
    | "remote"
    | "eof"
    | "malformed"
    | "unsupported"
    | "version"
    | "steer-rejected"
    | "steer-rejected-minimal"
    | "steer-eof"
    | "startup-timeout" = "command",
) =>
  Effect.gen(function* () {
    const stdout = yield* Queue.unbounded<string, Cause.Done>()
    const state = {
      initialized: false,
      killed: 0,
      turnRequest: 0,
      steerRequest: 0,
      requests: [] as string[],
      decisions: [] as { id: number; decision: unknown }[],
    }
    const emit = (frame: unknown) => Queue.offerUnsafe(stdout, JSON.stringify(frame) + "\n")
    const spawner = ChildProcessSpawner.make((command) =>
      Effect.sync(() => {
        expect(ChildProcess.isStandardCommand(command) && command.command).toBe("controlled-codex")
        expect(ChildProcess.isStandardCommand(command) && command.args).toEqual(["app-server", "--stdio"])
        return ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(0),
          exitCode: Effect.never,
          isRunning: Effect.succeed(true),
          kill: () =>
            Effect.sync(() => {
              state.killed += 1
              Queue.endUnsafe(stdout)
            }),
          stdin: Sink.forEach((chunk: Uint8Array) =>
            Effect.sync(() => {
              const frame = frameDecoder(new TextDecoder().decode(chunk).trim())
              if (frame.method) state.requests.push(frame.method)
              if (frame.method === "initialize") {
                if (mode === "startup-timeout") return
                if (mode === "malformed") {
                  Queue.offerUnsafe(stdout, "{bad-frame\n")
                  return
                }
                emit({ id: frame.id, result: { userAgent: mode === "version" ? "codex/0.150.1" : "codex/0.162.1" } })
                return
              }
              if (frame.method === "initialized") {
                state.initialized = true
                return
              }
              if (frame.method === "thread/start" || frame.method === "thread/resume") {
                expect(state.initialized).toBe(true)
                expect(frame.params).toMatchObject({
                  cwd: "/project",
                  sandbox: "read-only",
                  approvalPolicy: "untrusted",
                  approvalsReviewer: "user",
                })
                emit({
                  id: frame.id,
                  result: {
                    approvalPolicy: "untrusted",
                    approvalsReviewer: "user",
                    cwd: "/project",
                    model: "configured-model",
                    modelProvider: "configured-provider",
                    sandbox: { type: "readOnly", networkAccess: false },
                    thread: {
                      id: "thread-owned",
                      cliVersion: "0.162.1",
                      createdAt: 1,
                      cwd: "/project",
                      ephemeral: false,
                      modelProvider: "configured-provider",
                      preview: "",
                      projectId: null,
                      sessionId: "thread-owned",
                      source: "app-server",
                      status: { type: "idle" },
                      turns: [],
                      updatedAt: 1,
                    },
                  },
                })
                return
              }
              if (frame.method === "turn/start") {
                expect(frame.params).toMatchObject({
                  threadId: "thread-owned",
                  approvalPolicy: "untrusted",
                  sandboxPolicy: { type: "readOnly", networkAccess: false },
                })
                state.turnRequest = frame.id ?? 0
                if (mode === "steer-rejected" || mode === "steer-rejected-minimal" || mode === "steer-eof") {
                  emit({ id: frame.id, result: { turn: activeTurn } })
                  return
                }
                if (mode === "file")
                  emit({
                    method: "item/started",
                    params: {
                      threadId: "thread-owned",
                      turnId: "turn-owned",
                      item: {
                        type: "fileChange",
                        id: "change",
                        changes: [
                          { path: "/project/owned.txt", kind: { type: "update", move_path: null }, diff: "+owned" },
                        ],
                      },
                    },
                  })
                emit({
                  id: 90,
                  method: "item/commandExecution/requestApproval",
                  params: {
                    kind: "command",
                    environmentId: null,
                    threadId: "thread-foreign",
                    turnId: "turn-foreign",
                    itemId: "foreign",
                    command: "touch foreign",
                    cwd: "/foreign",
                  },
                })
                emit({
                  id: frame.id,
                  method:
                    mode === "unsupported"
                      ? "item/tool/requestUserInput"
                      : mode === "file" || mode === "missing-file"
                        ? "item/fileChange/requestApproval"
                        : "item/commandExecution/requestApproval",
                  params: {
                    kind: "command",
                    environmentId: mode === "remote" ? "remote-env" : mode === "local" ? "local" : null,
                    threadId: "thread-owned",
                    turnId: "turn-owned",
                    itemId: "change",
                    startedAtMs: 1,
                    command: "echo owned",
                    cwd: "/project",
                  },
                })
                emit({ id: frame.id, result: { turn: activeTurn } })
                return
              }
              if (frame.method === "turn/interrupt") {
                emit({ id: frame.id, result: {} })
                return
              }
              if (frame.method === "turn/steer") {
                state.steerRequest = frame.id ?? 0
                if (mode === "steer-eof") {
                  Queue.endUnsafe(stdout)
                  return
                }
                emit({
                  id: frame.id,
                  error:
                    mode === "steer-rejected-minimal"
                      ? { message: "Controlled native rejection" }
                      : { code: -32600, message: "Controlled native rejection", data: { accepted: false } },
                })
                return
              }
              if (frame.id !== undefined && frame.result) {
                state.decisions.push({ id: frame.id, decision: frame.result.decision })
                if (frame.id !== state.turnRequest || mode === "eof") return
                emit({
                  method: "item/agentMessage/delta",
                  params: {
                    threadId: "thread-owned",
                    turnId: "turn-owned",
                    itemId: "answer",
                    delta: frame.result.decision === "accept" ? "OWNED RESULT" : "DENIED RESULT",
                  },
                })
                emit({ method: "turn/completed", params: { threadId: "thread-owned", turn: completedTurn } })
              }
            }),
          ),
          stdout: Stream.fromQueue(stdout).pipe(Stream.map((line) => new TextEncoder().encode(line))),
          stderr: Stream.empty,
          all: Stream.empty,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
          unref: Effect.succeed(Effect.void),
        })
      }),
    )
    const adapter = CodexAppServer.makeCodexAppServerAdapter(
      CodexAppServer.makeCodexAppServerProcessConnection,
    ).forCommand?.("controlled-codex")
    if (!adapter?.execute || !adapter.steerTurn) return yield* Effect.die(new Error("Missing invocation adapter"))
    return {
      execute: adapter.execute,
      steer: adapter.steerTurn,
      complete: () => {
        emit({
          method: "item/agentMessage/delta",
          params: { threadId: "thread-owned", turnId: "turn-owned", itemId: "answer", delta: "ORIGINAL RESULT" },
        })
        emit({ method: "turn/completed", params: { threadId: "thread-owned", turn: completedTurn } })
      },
      state,
      stdout,
      layer: Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
    }
  })

for (const mode of ["steer-rejected", "steer-rejected-minimal", "steer-eof"] as const)
  it.effect(`MC06 R3a raw ${mode} preserves the actual RPC phase`, () =>
    Effect.gen(function* () {
      const f = yield* wirePeer(mode)
      const seen: Error[] = []
      const result = yield* f
        .execute({
          prompt: "Run the original turn",
          cwd: "/project",
          onPermission: () => Effect.succeed("allow" as const),
          onTurn: (turnID) =>
            f
              .steer({
                threadId: "thread-owned",
                expectedTurnId: turnID,
                input: [{ type: "text", text: "A bounded steer" }],
              })
              .pipe(
                Effect.flip,
                Effect.tap((error) =>
                  Effect.sync(() => {
                    if (!(error instanceof CodexAppServer.SteerError)) throw new Error("Steer error lost its RPC phase")
                    seen.push(error)
                    expect(error).toMatchObject({
                      phase: mode === "steer-eof" ? "unknown" : "rejected",
                      threadID: "thread-owned",
                      turnID,
                    })
                    if (mode === "steer-rejected") {
                      expect(error).toMatchObject({
                        requestID: f.state.steerRequest,
                        code: -32600,
                        data: { accepted: false },
                      })
                    }
                    if (mode === "steer-rejected-minimal") {
                      expect(error).toMatchObject({ requestID: f.state.steerRequest })
                      expect(Object.hasOwn(error, "code")).toBe(false)
                      expect(Object.hasOwn(error, "data")).toBe(false)
                    }
                    if (mode !== "steer-eof") f.complete()
                  }),
                ),
                Effect.asVoid,
                Effect.orDie,
              ),
        })
        .pipe(Effect.provide(f.layer), Effect.exit)
      expect(seen).toHaveLength(1)
      expect(f.state.requests.filter((method) => method === "turn/steer")).toHaveLength(1)
      expect(f.state.requests.filter((method) => method === "turn/start")).toHaveLength(1)
      expect(f.state.requests.filter((method) => method === "initialize")).toHaveLength(1)
      expect(f.state.killed).toBe(1)
      if (mode === "steer-eof") {
        expect(Exit.isFailure(result)).toBe(true)
        return
      }
      expect(result).toMatchObject({ _tag: "Success", value: { status: "success", summary: "ORIGINAL RESULT" } })
    }),
  )

for (const mode of ["command", "local", "file", "missing-file", "remote"] as const)
  it.effect(`MC06 raw frames bind ${mode} approval despite a client/server request ID collision`, () =>
    Effect.gen(function* () {
      const f = yield* wirePeer(mode)
      const approvals: unknown[] = []
      const result = yield* f
        .execute({
          prompt: "Do the owned task",
          cwd: "/project",
          onPermission: (request) =>
            Effect.sync(() => {
              approvals.push(request)
              return "allow" as const
            }),
        })
        .pipe(Effect.provide(f.layer))
      expect(result).toMatchObject({
        status: "success",
        sessionId: "thread-owned",
        turnId: "turn-owned",
        summary: mode === "remote" || mode === "missing-file" ? "DENIED RESULT" : "OWNED RESULT",
      })
      expect(approvals).toEqual(
        mode === "remote" || mode === "missing-file"
          ? []
          : [
              {
                threadID: "thread-owned",
                turnID: "turn-owned",
                itemID: "change",
                requestID: 3,
                ...(mode === "file"
                  ? { kind: "file", paths: ["/project/owned.txt"] }
                  : { kind: "command", command: "echo owned", cwd: "/project" }),
              },
            ],
      )
      expect(f.state.decisions).toEqual([
        { id: 90, decision: "decline" },
        { id: 3, decision: approvals.length ? "accept" : "decline" },
      ])
      expect(f.state.killed).toBe(1)
    }),
  )

it.effect("MC06 forwards one denial without creating an allow rule", () =>
  Effect.gen(function* () {
    const f = yield* wirePeer()
    const result = yield* f
      .execute({ prompt: "Check denial", cwd: "/project", onPermission: () => Effect.succeed("deny" as const) })
      .pipe(Effect.provide(f.layer))
    expect(result.summary).toBe("DENIED RESULT")
    expect(f.state.decisions).toEqual([
      { id: 90, decision: "decline" },
      { id: 3, decision: "decline" },
    ])
  }),
)

it.effect("MC06 EOF cancels the active approval and closes the owned connection", () =>
  Effect.gen(function* () {
    const f = yield* wirePeer("eof")
    const pending = yield* Deferred.make<void>()
    const withdrawn = yield* Deferred.make<void>()
    const running = yield* f
      .execute({
        prompt: "Wait for approval",
        cwd: "/project",
        onPermission: () =>
          Deferred.succeed(pending, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(Deferred.succeed(withdrawn, undefined)),
          ),
      })
      .pipe(Effect.provide(f.layer), Effect.forkScoped)
    yield* awaitWithTimeout(Deferred.await(pending), "Approval was not requested")
    yield* Queue.end(f.stdout)
    const exit = yield* Fiber.await(running)
    expect(Exit.isFailure(exit)).toBe(true)
    yield* awaitWithTimeout(Deferred.await(withdrawn), "Approval survived EOF")
    expect(f.state.killed).toBe(1)
    expect(f.state.decisions.some((reply) => reply.decision === "accept")).toBe(false)
  }),
)

for (const mode of ["malformed", "unsupported", "version"] as const)
  it.effect(`MC06 ${mode} fails without inventing a result`, () =>
    Effect.gen(function* () {
      const f = yield* wirePeer(mode)
      const error = yield* f
        .execute({ prompt: "Must fail", cwd: "/project", onPermission: () => Effect.succeed("allow" as const) })
        .pipe(Effect.provide(f.layer), Effect.flip)
      expect(error).toMatchObject({
        _tag: mode === "version" ? "CliAdapter.Unavailable" : "CodexAppServer.ProtocolError",
      })
      expect(f.state.killed).toBe(1)
      expect(f.state.decisions.some((reply) => reply.decision === "accept")).toBe(false)
    }),
  )

it.effect("MC06 total timeout includes initialize and releases the process", () =>
  Effect.gen(function* () {
    const f = yield* wirePeer("startup-timeout")
    const running = yield* f
      .execute({ prompt: "Never initialized", cwd: "/project", timeoutMs: 50 })
      .pipe(Effect.provide(f.layer), Effect.forkScoped)
    yield* TestClock.adjust("50 millis")
    const exit = yield* Fiber.await(running)
    expect(Exit.isFailure(exit)).toBe(true)
    expect(f.state.requests).toEqual(["initialize"])
    expect(f.state.killed).toBe(1)
  }),
)
