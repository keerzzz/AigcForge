export * as Verifier from "./verifier"

import { ChildProcess } from "effect/unstable/process"
import { Context, DateTime, Duration, Effect, Layer, Ref, Schema } from "effect"
import { AppProcess } from "../process"
import { Config } from "../config"
import { EventV2 } from "../event"
import { Location } from "../location"
import { SessionSchema } from "./schema"
import { isRecord } from "../util/record"
import { CorrectionStore } from "./correction-store"
import { SessionEvent } from "./event"
import { VerificationRouter } from "./verification-router"
import { VerifierProse } from "./verifier-prose"

const DEFAULT_ENABLED = true
const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 2

type Settings = {
  readonly enabled: boolean
  readonly timeoutMs: number
  readonly maxConsecutiveFailures: number
}

const settings = (documents: readonly Config.Entry[]) => {
  const configured = documents
    .filter((entry): entry is Config.Document => entry.type === "document")
    .flatMap((entry) => (entry.info.meta?.verifier ? [entry.info.meta.verifier] : []))
  return configured.reduce<Settings>(
    (result, current) => ({
      enabled: current.enabled ?? result.enabled,
      timeoutMs: current.timeout_ms ?? result.timeoutMs,
      maxConsecutiveFailures: current.max_consecutive_failures ?? result.maxConsecutiveFailures,
    }),
    {
      enabled: DEFAULT_ENABLED,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxConsecutiveFailures: DEFAULT_MAX_CONSECUTIVE_FAILURES,
    },
  )
}

export class TimeoutError extends Schema.TaggedErrorClass<TimeoutError>()("Verifier.TimeoutError", {
  packageDirectory: Schema.String,
}) {
  override get message() {
    return `Typecheck timed out for ${this.packageDirectory}`
  }
}

export class ExecutionError extends Schema.TaggedErrorClass<ExecutionError>()("Verifier.ExecutionError", {
  packageDirectory: Schema.String,
  reason: Schema.String,
}) {
  override get message() {
    return `Typecheck failed for ${this.packageDirectory}: ${this.reason}`
  }
}

export interface Interface {
  readonly verify: (input: {
    readonly sessionID: SessionSchema.ID
    readonly toolName: string
    readonly toolInput: unknown
    readonly intent: string | undefined
  }) => Effect.Effect<string, CorrectionStore.InvalidEntryError | VerificationRouter.InvalidLevelError>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/Verifier") {}

// Tools that may leave the workspace in a broken state after a code edit.
const MUTATING_TOOLS = new Set(["edit", "write", "apply_patch", "bash"])

// Resolves a changed file path to its workspace package directory.
export const packageDirectory = (file: string): string | undefined => {
  const match = file.match(/^(?:\.{1,2}\/)?packages\/([^/]+)/)
  return match ? `packages/${match[1]}` : undefined
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const configured = settings(yield* config.entries())
    const appProcess = yield* AppProcess.Service
    const location = yield* Location.Service
    const events = yield* EventV2.Service
    const correctionStore = yield* CorrectionStore.Service
    const router = yield* VerificationRouter.Service
    const failures = yield* Ref.make(new Map<SessionSchema.ID, number>())

    const verify = Effect.fn("Verifier.verify")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly toolName: string
      readonly toolInput: unknown
      readonly intent: string | undefined
    }) {
      if (!configured.enabled) return ""
      if (input.intent !== "code_modification") return ""
      if (!MUTATING_TOOLS.has(input.toolName)) return ""
      if (!isRecord(input.toolInput)) return ""
      const file = typeof input.toolInput.path === "string" ? input.toolInput.path : undefined
      const directory = file === undefined ? undefined : packageDirectory(file)
      if (directory === undefined) return ""
      const consecutive = (yield* Ref.get(failures)).get(input.sessionID) ?? 0
      if (consecutive >= configured.maxConsecutiveFailures) return ""

      const started = yield* DateTime.now
      const startedMillis = yield* Effect.sync(Date.now)
      yield* events.publish(SessionEvent.Verify.Started, {
        sessionID: input.sessionID,
        timestamp: started,
        tool: input.toolName,
        packageDirectory: directory,
      })
      const command = ChildProcess.make("bun", ["--cwd", directory, "typecheck"], {
        cwd: location.directory,
        stdin: "ignore",
      })
      const result = yield* appProcess
        .run(command, {
          timeout: Duration.millis(configured.timeoutMs),
          maxOutputBytes: 512 * 1024,
          maxErrorBytes: 512 * 1024,
        })
        .pipe(
          Effect.catchTag("AppProcessError", (error) =>
            Effect.succeed({
              command: "bun",
              exitCode: -1,
              stdout: Buffer.from(""),
              stderr: Buffer.from(String(error)),
              stdoutTruncated: false,
              stderrTruncated: false,
            }),
          ),
        )
      const durationMs = Date.now() - startedMillis
      const output = [result.stdout.toString("utf8"), result.stderr.toString("utf8")]
        .filter((part) => part.length > 0)
        .join("\n")
      if (result.exitCode === 0) {
        yield* Ref.update(failures, (map) => map.set(input.sessionID, 0))
        yield* router.route({ sessionID: input.sessionID, intent: input.intent, failed: false })
        yield* events.publish(SessionEvent.Verify.Passed, {
          sessionID: input.sessionID,
          timestamp: yield* DateTime.now,
          tool: input.toolName,
          packageDirectory: directory,
          durationMs,
        })
        return ""
      }
      const nextFailures = (yield* Ref.get(failures)).get(input.sessionID) ?? 0
      yield* Ref.update(failures, (map) => map.set(input.sessionID, nextFailures + 1))
      const level = yield* router.route({ sessionID: input.sessionID, intent: input.intent, failed: true })
      const prose = VerifierProse.render(output || `typecheck 退出码 ${result.exitCode}`)
      yield* events.publish(SessionEvent.Verify.Failed, {
        sessionID: input.sessionID,
        timestamp: yield* DateTime.now,
        tool: input.toolName,
        packageDirectory: directory,
        durationMs,
        error: output,
      })
      yield* correctionStore.record({
        sessionID: input.sessionID,
        entry: {
          key: `verify:${directory}`,
          correct: `${directory} typecheck 修复`,
          source: "verifier",
          extractLayer: 1,
        },
      })
      const escalation =
        level === "l0"
          ? ""
          : level === "l1"
            ? "\n\n升级: 机械验证失败，转交 L1 judge 仲裁（judgeMerge）。"
            : "\n\n升级: L1 仲裁失败，转交 L2 委派（delegateJudge）。"
      return `⚠️ [验证] typecheck 失败（${directory}）:\n${prose}${escalation}`
    })

    return Service.of({ verify })
  }),
)
