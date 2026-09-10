/**
 * Phase 5 tests: Codex app-server control plane, protocol contract,
 * capability negotiation, and lifecycle management.
 *
 * @see docs/architecture/adr/ADR-22-meta-agent-persistent-delegation.md §2.7, §2.8
 * @see docs/plan/meta-agent-persistent-delegation-closed-loop.md §16.9
 */

import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Schema } from "effect"
import {
  CapabilitiesReadResponse,
  ErrorNotification,
  ItemCompletedNotification,
  ThreadResumeResponse,
  TurnStartResponse,
  decodeNotification,
  makeCodexAppServerAdapter,
  makeCodexAppServerProcessConnection,
  negotiateCapabilities,
  resolveCodexAppServerCommand,
  type CodexAppServerConnection,
  type CodexAppServerServerNotification,
} from "../src/tool/codex-app-server"
import { CrossSpawnSpawner } from "../src/cross-spawn-spawner"
import { tmpdir } from "./fixture/tmpdir"
import { awaitWithTimeout, testEffect } from "./lib/effect"

// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- mock helper
const asResponse = <T>(val: unknown): T => val as T

const it = testEffect(Layer.empty)
const liveIt = testEffect(CrossSpawnSpawner.defaultLayer)

describe.serial("Phase 5: Codex app-server Control Plane & Contracts", () => {
  test("resolves the installed app-server CLI ahead of Bun's SDK binary shim", async () => {
    await using tmp = await tmpdir()
    const sdkBin = path.join(tmp.path, "node_modules", ".bin")
    const installedBin = path.join(tmp.path, "installed")
    await fs.mkdir(sdkBin, { recursive: true })
    await fs.mkdir(installedBin)
    const extension = process.platform === "win32" ? ".cmd" : ""
    const sdkCodex = path.join(sdkBin, `codex${extension}`)
    const installedCodex = path.join(installedBin, `codex${extension}`)
    const contents = process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\n"
    await fs.writeFile(sdkCodex, contents)
    await fs.writeFile(installedCodex, contents)
    if (process.platform !== "win32") {
      await fs.chmod(sdkCodex, 0o755)
      await fs.chmod(installedCodex, 0o755)
    }

    const value = [sdkBin, installedBin].join(path.delimiter)
    const resolved = resolveCodexAppServerCommand({ PATH: value, Path: value })
    expect(process.platform === "win32" ? resolved.toLowerCase() : resolved).toBe(
      process.platform === "win32" ? installedCodex.toLowerCase() : installedCodex,
    )
  })

  const liveAppServerIt = /(^|[\\/])node_modules[\\/]\.bin([\\/]|$)/.test(resolveCodexAppServerCommand())
    ? liveIt.live.skip
    : liveIt.live

  liveAppServerIt(
    "live. negotiates and starts a thread on the installed Codex app-server",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          // Bun prepends node_modules/.bin to PATH. The app-server protocol must
          // use the independently installed CLI, not the older SDK payload.
          expect(resolveCodexAppServerCommand()).not.toContain("node_modules/.bin")
          const negotiation = yield* awaitWithTimeout(
            Effect.gen(function* () {
              const connection = yield* makeCodexAppServerProcessConnection({ cwd: process.cwd() })
              return yield* negotiateCapabilities(connection)
            }),
            "installed Codex app-server did not negotiate within 30 seconds",
            "30 seconds",
          )
          expect(negotiation.supported).toBe(true)
          expect(negotiation.userAgent).toContain("/0.150.")

          const adapter = makeCodexAppServerAdapter(makeCodexAppServerProcessConnection)
          const started = yield* adapter.startThread!({ workingDirectory: process.cwd(), approvalPolicy: "never" })
          expect(started.threadId.length).toBeGreaterThan(0)
        }),
      ),
    60_000,
  )

  it.effect("0. generated v2 snapshot rejects incomplete responses and malformed known notifications", () =>
    Effect.gen(function* () {
      expect(Schema.decodeUnknownOption(CapabilitiesReadResponse)({})._tag).toBe("None")
      expect(Schema.decodeUnknownOption(ThreadResumeResponse)({})._tag).toBe("None")
      expect(Schema.decodeUnknownOption(TurnStartResponse)({ turn: { id: "turn" } })._tag).toBe("None")
      expect(
        Schema.decodeUnknownOption(ItemCompletedNotification)({
          threadId: "thread",
          turnId: "turn",
          item: {},
        })._tag,
      ).toBe("None")
      expect(Schema.decodeUnknownOption(ErrorNotification)({ message: "boom" })._tag).toBe("None")
      const malformed = yield* Effect.exit(decodeNotification({ method: "turn/completed", params: {} }))
      expect(Exit.isFailure(malformed)).toBe(true)
    }),
  )

  it.effect("1. request contracts match app-server schema for thread/start, resume, fork, archive, delete", () =>
    Effect.gen(function* () {
      const requests: Array<{ method: string; params?: unknown }> = []
      const mockConnection: CodexAppServerConnection = {
        request: <T>(method: string, params: unknown) =>
          Effect.sync(() => {
            requests.push({ method, params })
            if (method === "initialize") {
              return asResponse<T>({
                userAgent: "codex-app-server/0.150.1 (linux; x86_64)",
                codexHome: "/home/test/.codex",
                platformFamily: "unix",
                platformOs: "linux",
              })
            }
            if (method === "thread/start") {
              return asResponse<T>({ thread: { id: "th_001" } })
            }
            if (method === "thread/resume") {
              return asResponse<T>({ thread: { id: "th_001" } })
            }
            if (method === "thread/fork") {
              return asResponse<T>({ thread: { id: "th_forked_002" } })
            }
            if (method === "thread/archive" || method === "thread/delete") {
              return asResponse<T>({})
            }
            return asResponse<T>({})
          }),
        onNotification: () => () => {},
        close: () => Effect.void,
      }

      const adapter = makeCodexAppServerAdapter(() => Effect.succeed(mockConnection))
      expect(adapter.transport).toBe("app-server")
      expect(adapter.name).toBe("codex")

      // Test thread/start contract
      const startRes = yield* adapter.startThread!({
        workingDirectory: "/test/repo",
        approvalPolicy: "never",
      })
      expect(startRes.threadId).toBe("th_001")
      const startReq = requests.find((r) => r.method === "thread/start")
      expect(startReq).toBeDefined()
      expect(startReq?.params).toEqual({
        cwd: "/test/repo",
        approvalPolicy: "never",
      })

      // Test thread/resume contract
      const resumeRes = yield* adapter.resumeThread!("th_001", {
        workingDirectory: "/test/repo",
      })
      expect(resumeRes.threadId).toBe("th_001")
      const resumeReq = requests.find((r) => r.method === "thread/resume")
      expect(resumeReq).toBeDefined()
      expect(resumeReq?.params).toEqual({
        threadId: "th_001",
        cwd: "/test/repo",
      })

      // Test thread/fork contract
      const forkRes = yield* adapter.forkThread!("th_001", {
        lastTurnId: "turn_prior",
      })
      expect(forkRes.threadId).toBe("th_forked_002")
      const forkReq = requests.find((r) => r.method === "thread/fork")
      expect(forkReq).toBeDefined()
      expect(forkReq?.params).toEqual({
        threadId: "th_001",
        lastTurnId: "turn_prior",
      })

      // Test thread/archive contract
      yield* adapter.archiveThread!("th_001")
      const archiveReq = requests.find((r) => r.method === "thread/archive")
      expect(archiveReq).toBeDefined()
      expect(archiveReq?.params).toEqual({ threadId: "th_001" })

      // Test thread/delete contract
      yield* adapter.deleteThread!("th_001")
      const deleteReq = requests.find((r) => r.method === "thread/delete")
      expect(deleteReq).toBeDefined()
      expect(deleteReq?.params).toEqual({ threadId: "th_001" })
    }),
  )

  it.effect("2. turn contracts enforce expectedTurnId precondition on steer and turn/interrupt", () =>
    Effect.gen(function* () {
      const requests: Array<{ method: string; params?: unknown }> = []

      const mockConnection: CodexAppServerConnection = {
        request: <T>(method: string, params: unknown) =>
          Effect.sync(() => {
            requests.push({ method, params })
            if (method === "turn/start") {
              return asResponse<T>({ turn: { id: "turn_100", status: "inProgress" } })
            }
            if (method === "turn/steer") {
              if (
                !params ||
                typeof params !== "object" ||
                !("expectedTurnId" in params) ||
                params.expectedTurnId !== "turn_100"
              ) {
                throw new Error("expectedTurnId mismatch")
              }
              return asResponse<T>({ turnId: "turn_100" })
            }
            if (method === "turn/interrupt") {
              return asResponse<T>({})
            }
            return asResponse<T>({})
          }),
        onNotification: () => () => {},
        close: () => Effect.void,
      }

      const adapter = makeCodexAppServerAdapter(() => Effect.succeed(mockConnection))

      // 1. turn/start
      const startRes = yield* adapter.startTurn!({
        threadId: "th_001",
        input: [{ type: "text", text: "Fix typo in README" }],
      })
      expect(startRes.turnId).toBe("turn_100")
      const startReq = requests.find((r) => r.method === "turn/start")
      expect(startReq?.params).toEqual({
        threadId: "th_001",
        input: [{ type: "text", text: "Fix typo in README" }],
      })

      // 2. turn/steer: requires explicit expectedTurnId
      yield* adapter.steerTurn!({
        threadId: "th_001",
        expectedTurnId: "turn_100",
        input: [{ type: "text", text: "Also format markdown" }],
      })
      const steerReq = requests.find((r) => r.method === "turn/steer")
      expect(steerReq?.params).toEqual({
        threadId: "th_001",
        expectedTurnId: "turn_100",
        input: [{ type: "text", text: "Also format markdown" }],
      })

      // 3. steer fails when expectedTurnId does not match active turn
      const mismatchedSteer = adapter.steerTurn!({
        threadId: "th_001",
        expectedTurnId: "turn_wrong",
        input: [{ type: "text", text: "Wrong" }],
      })
      const steerExit = yield* Effect.exit(mismatchedSteer)
      expect(steerExit._tag).toBe("Failure")

      // 4. turn/interrupt
      yield* adapter.interruptTurn!({
        threadId: "th_001",
        turnId: "turn_100",
      })
      const interruptReq = requests.find((r) => r.method === "turn/interrupt")
      expect(interruptReq?.params).toEqual({
        threadId: "th_001",
        turnId: "turn_100",
      })
    }),
  )

  it.effect("3. turn/interrupt settles as cancelled/interrupted, does not fake completed", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      let notificationCallback: ((notif: CodexAppServerServerNotification) => void) | undefined

      const mockConnection: CodexAppServerConnection = {
        request: <T>(method: string) =>
          Effect.sync(() => {
            if (method === "initialize") return asResponse<T>({ userAgent: "codex-app-server/0.150.1" })
            if (method === "thread/start") return asResponse<T>({ thread: { id: "th_int" } })
            if (method === "turn/start") {
              queueMicrotask(() => {
                Deferred.doneUnsafe(started, Exit.void)
              })
              return asResponse<T>({ turn: { id: "turn_int", status: "inProgress" } })
            }
            if (method === "turn/interrupt") {
              // App-server fires turn/completed with status: "interrupted"
              notificationCallback?.({
                method: "turn/completed",
                params: {
                  threadId: "th_int",
                  turn: {
                    id: "turn_int",
                    status: "interrupted",
                    items: [],
                    error: null,
                  },
                },
              })
              return asResponse<T>({})
            }
            return asResponse<T>({})
          }),
        onNotification: (cb) => {
          notificationCallback = cb
          return () => {
            notificationCallback = undefined
          }
        },
        close: () => Effect.void,
      }

      const adapter = makeCodexAppServerAdapter(() => Effect.succeed(mockConnection))

      // Execute through adapter execute interface
      const execFiber = yield* Effect.forkScoped(
        adapter.execute!({
          prompt: "Long running task",
          cwd: "/project",
        }),
      )

      // Wait until turn/start is called
      yield* Deferred.await(started)

      // Cancel turn
      yield* adapter.cancel!("/project")

      const result = yield* Fiber.await(execFiber)
      expect(result._tag).toBe("Success")
      if (result._tag === "Success") {
        // ADR-22 §2.7: Interrupted turn must be cancelled/interrupted, NOT completed!
        expect(result.value.status).toBe("failed")
        expect(result.value.errorCode).toBe("interrupted")
        expect(result.value.summary).toContain("interrupted")
      }
    }),
  )

  it.effect("4. capability negotiation failure falls back to SDK/JSONL without silent option dropping", () =>
    Effect.gen(function* () {
      // Mock connection where initialize rejects or method is missing
      const mockIncompatibleConnection: CodexAppServerConnection = {
        request: <T>(method: string) =>
          Effect.gen(function* () {
            if (method === "initialize") {
              return asResponse<T>({
                userAgent: "legacy-server/0.0.1",
                platformFamily: "unix",
                platformOs: "linux",
              })
            }
            return yield* Effect.fail(new Error(`Method ${method} not supported`))
          }),
        onNotification: () => () => {},
        close: () => Effect.void,
      }

      const negotiation = yield* negotiateCapabilities(mockIncompatibleConnection)
      expect(negotiation.supported).toBe(false)
      expect(negotiation.fallbackTransport).toBe("sdk")

      // Fallback adapter retains prompt and execution without dropping
      const fallbackAdapter = negotiation.resolveAdapter({
        fallbackSdk: {
          name: "codex-sdk",
          command: "codex",
          description: "Codex SDK fallback",
          transport: "sdk",
          detect: () => Effect.succeed(true),
          buildArgs: () => Effect.succeed([]),
          parseOutput: (s) => Effect.succeed({ status: "success", summary: s }),
          execute: ({ prompt }) =>
            Effect.succeed({
              status: "success",
              summary: `SDK executed: ${prompt}`,
              sessionId: "sdk_thread_1",
            }),
        },
      })

      expect(fallbackAdapter.transport).toBe("sdk")
      const result = yield* fallbackAdapter.execute!({
        prompt: "Review PR #42",
        cwd: "/project",
      })
      expect(result.status).toBe("success")
      expect(result.summary).toBe("SDK executed: Review PR #42")
    }),
  )

  it.effect("5. connection scope cleanly releases resources and closes transport on exit", () =>
    Effect.gen(function* () {
      let closed = false
      let notificationCb: ((notif: CodexAppServerServerNotification) => void) | undefined
      const mockConnection: CodexAppServerConnection = {
        request: <T>(method: string) =>
          Effect.sync(() => {
            if (method === "initialize") return asResponse<T>({ userAgent: "codex-app-server/0.150.1" })
            if (method === "thread/start") return asResponse<T>({ thread: { id: "th_scoped" } })
            if (method === "turn/start") {
              notificationCb?.({
                method: "turn/completed",
                params: {
                  threadId: "th_scoped",
                  turn: {
                    id: "turn_sc",
                    status: "completed",
                    items: [],
                    error: null,
                  },
                },
              })
              return asResponse<T>({ turn: { id: "turn_sc" } })
            }
            return asResponse<T>({})
          }),
        onNotification: (cb) => {
          notificationCb = cb
          return () => {
            notificationCb = undefined
          }
        },
        close: () =>
          Effect.sync(() => {
            closed = true
          }),
      }

      const adapter = makeCodexAppServerAdapter(() => Effect.succeed(mockConnection))
      expect(closed).toBe(false)
      const result = yield* adapter.execute!({
        prompt: "Check scoping",
        cwd: "/project",
      })
      expect(result.status).toBe("success")
      // When execute finishes and its internal scope exits, close() must have been called
      expect(closed).toBe(true)
    }),
  )

  it.effect("6. capability negotiation fails and falls back when method probe rejects even if userAgent matches", () =>
    Effect.gen(function* () {
      const mockConn: CodexAppServerConnection = {
        request: <T>(method: string) =>
          Effect.gen(function* () {
            if (method === "initialize") {
              return asResponse<T>({
                userAgent: "codex-app-server/0.150.1",
              })
            }
            if (method === "modelProvider/capabilities/read") {
              return yield* Effect.fail(new Error("Method modelProvider/capabilities/read unsupported"))
            }
            return asResponse<T>({})
          }),
        onNotification: () => () => {},
        close: () => Effect.void,
      }

      const negotiation = yield* negotiateCapabilities(mockConn)
      expect(negotiation.supported).toBe(false)
      expect(negotiation.fallbackTransport).toBe("sdk")
      const fallback = negotiation.resolveAdapter({
        fallbackSdk: {
          name: "codex-sdk",
          command: "codex",
          description: "Codex SDK fallback",
          transport: "sdk",
          detect: () => Effect.succeed(true),
          buildArgs: () => Effect.succeed([]),
          parseOutput: (s) => Effect.succeed({ status: "success", summary: s }),
        },
      })
      expect(fallback.transport).toBe("sdk")
    }),
  )

  it.effect("7. schema validation failure on malformed app-server response surfaces typed error without defect", () =>
    Effect.gen(function* () {
      const mockConn: CodexAppServerConnection = {
        request: <T>(method: string, _params?: unknown, responseSchema?: Schema.Decoder<T>): Effect.Effect<T, Error> =>
          Effect.gen(function* () {
            const rawMalformed = { notAThread: 123 }
            if (responseSchema) {
              const decoded = yield* Effect.try({
                try: () => Schema.decodeUnknownSync(responseSchema)(rawMalformed),
                catch: (err) => new Error(`Schema decode error for ${method}: ${err}`),
              })
              return decoded
            }
            return asResponse<T>(rawMalformed)
          }),
        onNotification: () => () => {},
        close: () => Effect.void,
      }

      const adapter = makeCodexAppServerAdapter(() => Effect.succeed(mockConn))
      const exit = yield* Effect.exit(adapter.startThread!({ workingDirectory: "/project" }))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const errorMsg = Cause.pretty(exit.cause)
        expect(errorMsg).toContain("Schema decode error for initialize")
      }
    }),
  )

  it.effect("8. concurrent turns in same working directory are isolated by threadId without crosstalk", () =>
    Effect.gen(function* () {
      const started1 = yield* Deferred.make<void>()
      const started2 = yield* Deferred.make<void>()
      let notificationCb1: ((notif: CodexAppServerServerNotification) => void) | undefined
      let notificationCb2: ((notif: CodexAppServerServerNotification) => void) | undefined

      const mockConn1: CodexAppServerConnection = {
        request: <T>(method: string) =>
          Effect.sync(() => {
            if (method === "initialize") return asResponse<T>({ userAgent: "codex-app-server/0.150.1" })
            if (method === "thread/start") return asResponse<T>({ thread: { id: "th_concurrent_1" } })
            if (method === "turn/start") {
              queueMicrotask(() => {
                Deferred.doneUnsafe(started1, Exit.void)
              })
              return asResponse<T>({ turn: { id: "turn_c1" } })
            }
            if (method === "turn/interrupt") {
              notificationCb1?.({
                method: "turn/completed",
                params: {
                  threadId: "th_concurrent_1",
                  turn: { id: "turn_c1", status: "interrupted", items: [], error: null },
                },
              })
              return asResponse<T>({})
            }
            return asResponse<T>({})
          }),
        onNotification: (cb) => {
          notificationCb1 = cb
          return () => {}
        },
        close: () => Effect.void,
      }

      const mockConn2: CodexAppServerConnection = {
        request: <T>(method: string) =>
          Effect.sync(() => {
            if (method === "initialize") return asResponse<T>({ userAgent: "codex-app-server/0.150.1" })
            if (method === "thread/start") return asResponse<T>({ thread: { id: "th_concurrent_2" } })
            if (method === "turn/start") {
              queueMicrotask(() => {
                Deferred.doneUnsafe(started2, Exit.void)
              })
              return asResponse<T>({ turn: { id: "turn_c2" } })
            }
            return asResponse<T>({})
          }),
        onNotification: (cb) => {
          notificationCb2 = cb
          return () => {}
        },
        close: () => Effect.void,
      }

      const adapter1 = makeCodexAppServerAdapter(() => Effect.succeed(mockConn1))
      const adapter2 = makeCodexAppServerAdapter(() => Effect.succeed(mockConn2))

      const fiber1 = yield* Effect.forkScoped(adapter1.execute!({ prompt: "Task 1", cwd: "/shared-cwd" }))
      const fiber2 = yield* Effect.forkScoped(adapter2.execute!({ prompt: "Task 2", cwd: "/shared-cwd" }))

      yield* Deferred.await(started1)
      yield* Deferred.await(started2)

      // Interrupt only thread 1 using its threadId (not global cwd)
      yield* adapter1.cancel!("/shared-cwd", "th_concurrent_1")

      const res1 = yield* Fiber.join(fiber1)
      expect(res1.status).toBe("failed")
      expect(res1.sessionId).toBe("th_concurrent_1")
      expect(res1.turnId).toBe("turn_c1")
      expect(res1.errorCode).toBe("interrupted")

      // Now complete thread 2 cleanly
      notificationCb2?.({
        method: "turn/completed",
        params: {
          threadId: "th_concurrent_2",
          turn: { id: "turn_c2", status: "completed", items: [], error: null },
        },
      })

      const res2 = yield* Fiber.join(fiber2)
      expect(res2.status).toBe("success")
      expect(res2.sessionId).toBe("th_concurrent_2")
      expect(res2.turnId).toBe("turn_c2")
    }),
  )
})
