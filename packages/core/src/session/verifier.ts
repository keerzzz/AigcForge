export * as Verifier from "./verifier"

import { ChildProcess } from "effect/process"
import { Context, DateTime, Duration, Effect, Layer, Ref, Schema, Semaphore } from "effect"
import { AppProcess } from "@aigcfroge/util/process"
import { FSUtil } from "@aigcfroge/util/fs-util"
import path from "path"
import { Config } from "../config"
import { Bus } from "../bus"
import { Location } from "../location"
import { Permission } from "../permission"
import type { Agent } from "../agent"
import { SessionSchema } from "./schema"
import { CorrectionStore } from "./correction-store"
import { SessionEvent } from "./event"
import { Document, type Entry } from "@aigcfroge/schema/config"
import { Instructions } from "../instructions"

const settings = (documents: readonly Entry[]) =>
  documents
    .filter((entry): entry is Document => entry.type === "document")
    .flatMap((entry) => (entry.info.meta?.verifier ? [entry.info.meta.verifier] : []))
    .reduce<{ enabled: boolean; timeoutMs: number; maxConsecutiveFailures: number }>(
      (result, current) => ({
        enabled: current.enabled ?? result.enabled,
        timeoutMs: current.timeout_ms ?? result.timeoutMs,
        maxConsecutiveFailures: current.max_consecutive_failures ?? result.maxConsecutiveFailures,
      }),
      { enabled: true, timeoutMs: 60_000, maxConsecutiveFailures: 2 },
    )

const manifest = Schema.fromJsonString(
  Schema.Struct({
    packageManager: Schema.optional(Schema.String),
    scripts: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  }),
)

// All automatic checks in this process share one permit, including different Locations.
const verification = Semaphore.makeUnsafe(1)

type Input = {
  readonly sessionID: SessionSchema.ID
  readonly toolName: string
  readonly files: readonly string[]
  readonly source?: Permission.Source
  readonly agent?: Agent.ID
}

export const Status = Schema.Literals(["passed", "failed", "unavailable", "unchecked"])

export class Change extends Schema.Class<Change>("Verifier.Change")({
  path: Schema.String,
  hash: Schema.NullOr(Schema.String),
}) {}

export class PackageCheck extends Schema.Class<PackageCheck>("Verifier.PackageCheck")({
  directory: Schema.String,
  status: Status,
  executed: Schema.NullOr(Schema.Boolean),
  script: Schema.optionalKey(Schema.String),
  signature: Schema.optionalKey(Schema.String),
  manifestHash: Schema.optionalKey(Schema.String),
  exitCode: Schema.optionalKey(Schema.Int),
  durationMs: Schema.optionalKey(Schema.Number),
}) {}

export class Result extends Schema.Class<Result>("Verifier.Result")({
  sessionID: SessionSchema.ID,
  toolName: Schema.String,
  source: Schema.optionalKey(Permission.Source),
  status: Status,
  files: Schema.Array(Change),
  packages: Schema.Array(PackageCheck),
}) {}

type Report = { readonly result: Result; readonly text: string }

export interface Interface {
  readonly verify: (input: Input) => Effect.Effect<Report>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/Verifier") {}

// Existing tool consumers use this display helper; runtime discovery uses actual manifests below.
export const packageDirectory = (file: string): string | undefined => {
  const match = file.match(/^(?:\.{1,2}\/)?packages\/([^/]+)/)
  return match ? `packages/${match[1]}` : undefined
}

// Both the checker and its saved-result consumer use the same file identity rule.
const snapshot = Effect.fnUntraced(function* (directory: string, files: readonly string[]) {
  const fs = yield* FSUtil.Service
  const changes = yield* Effect.forEach([...new Set(files)].toSorted(), (file) =>
    Effect.gen(function* () {
      const target = path.resolve(directory, file)
      if (!FSUtil.contains(directory, target)) return undefined
      const stat = yield* fs
        .stat(target)
        .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
      if (!stat) return new Change({ path: target, hash: null })
      const real = yield* fs.realPath(target)
      if (stat.type !== "File" || !FSUtil.contains(directory, real)) return undefined
      return new Change({ path: target, hash: Instructions.hash(yield* fs.readFileString(real)) })
    }),
  )
  if (changes.some((change) => change === undefined)) return undefined
  return changes.filter((change) => change !== undefined)
})

export const isCurrent = Effect.fn("Verifier.isCurrent")(function* (directory: string, result: Result) {
  const fs = yield* FSUtil.Service
  const current = yield* snapshot(
    directory,
    result.files.map((file) => file.path),
  )
  if (
    !current ||
    Instructions.hash(current.map((change) => [change.path, change.hash])) !==
      Instructions.hash(result.files.map((change) => [change.path, change.hash]))
  )
    return false
  const manifests = yield* Effect.forEach(result.packages, (pkg) =>
    Effect.gen(function* () {
      if (pkg.manifestHash === undefined) return true
      if (!FSUtil.contains(directory, yield* fs.realPath(pkg.directory))) return false
      return Instructions.hash(yield* fs.readFileString(path.join(pkg.directory, "package.json"))) === pkg.manifestHash
    }),
  )
  return manifests.every(Boolean)
})

const report = (
  input: Input,
  status: typeof Status.Type,
  text: string,
  files: Change[] = [],
  packages: PackageCheck[] = [],
): Report => ({
  result: new Result({
    sessionID: input.sessionID,
    toolName: input.toolName,
    ...(input.source ? { source: input.source } : {}),
    status,
    files,
    packages,
  }),
  text,
})

const unavailable = (result: (text: string) => Report) => ({
  PlatformError: () => Effect.succeed(result("[验证] 不可用：无法读取package或检查目录。")),
  SchemaError: () => Effect.succeed(result("[验证] 不可用：package.json格式无效。")),
  "Permission.BlockedError": () => Effect.succeed(result("[验证] 不可用：当前权限拒绝执行typecheck。")),
  "Permission.CorrectedError": () => Effect.succeed(result("[验证] 不可用：typecheck授权要求修正。")),
  "Permission.RejectedError": () => Effect.succeed(result("[验证] 不可用：typecheck授权被拒绝。")),
  "Permission.AskExpiredError": () => Effect.succeed(result("[验证] 不可用：typecheck授权过期。")),
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const configured = settings(yield* config.entries())
    const appProcess = yield* AppProcess.Service
    const location = yield* Location.Service
    const events = yield* Bus.Service
    const correctionStore = yield* CorrectionStore.Service
    const fs = yield* FSUtil.Service
    const permission = yield* Permission.Service
    const failures = yield* Ref.make(new Map<string, { signature: string; count: number }>())
    const readManifest = (file: string) =>
      fs.readFileString(file).pipe(Effect.flatMap(Schema.decodeUnknownEffect(manifest)))
    const isFile = (file: string) =>
      fs.stat(file).pipe(
        Effect.map((stat) => stat.type === "File"),
        Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(false)),
      )
    const verify = Effect.fn("Verifier.verify")(function* (input: Input) {
      if (!configured.enabled) return report(input, "unchecked", "")
      if (input.files.length === 0) return report(input, "unavailable", "")
      const files = [...new Set(input.files.map((file) => path.resolve(location.directory, file)))]
      if (files.some((file) => !FSUtil.contains(location.directory, file)))
        return report(input, "unavailable", "[验证] 不可用：变更文件位于当前 Location 之外。")
      const changes = yield* snapshot(location.directory, files).pipe(Effect.provideService(FSUtil.Service, fs))
      if (!changes) return report(input, "unavailable", "[验证] 不可用：变更文件符号链接位于Location之外。")
      const manifests = yield* Effect.forEach(files, (file) =>
        fs.up({
          targets: ["package.json"],
          start: path.dirname(file),
          stop: location.directory,
          mode: "first",
          type: "file",
        }),
      )
      const packages = [...new Set(manifests.flat())]
      if (packages.length === 0)
        return report(input, "unavailable", "[验证] 不可用：没有找到变更文件所属的 package.json。", changes)
      const rootManifest = path.join(location.directory, "package.json")
      const root = (yield* isFile(rootManifest)) ? yield* readManifest(rootManifest) : undefined
      const launcher = path.join(location.directory, "script", "bun")
      const hasLauncher = yield* isFile(launcher)
      const reports = yield* Effect.forEach(packages, (file) =>
        Effect.gen(function* () {
          const directory = path.dirname(file)
          const packageReport = (text: string, check: Omit<typeof PackageCheck.Type, "directory">) =>
            report(input, check.status, text, changes, [new PackageCheck({ directory, ...check })])
          const real = yield* fs.realPath(directory)
          if (!FSUtil.contains(location.directory, real))
            return packageReport("[验证] 不可用：package符号链接位于Location之外。", {
              status: "unavailable",
              executed: false,
            })
          const raw = yield* fs.readFileString(file)
          const pkg = yield* Schema.decodeUnknownEffect(manifest)(raw)
          const identity = {
            manifestHash: Instructions.hash(raw),
            ...(pkg.scripts?.typecheck ? { script: pkg.scripts.typecheck } : {}),
          }
          if (!pkg.scripts?.typecheck)
            return packageReport(`[验证] 不可用：${directory} 没有 typecheck 脚本。`, {
              ...identity,
              status: "unavailable",
              executed: false,
            })
          const manager = pkg.packageManager ?? root?.packageManager
          if (!hasLauncher && !manager?.startsWith("bun@"))
            return packageReport(`[验证] 不可用：${directory} 未声明受支持的 Bun 执行方式。`, {
              ...identity,
              status: "unavailable",
              executed: false,
            })
          if (manager && !manager.startsWith("bun@"))
            return packageReport(`[验证] 不可用：${directory} 的包管理器不是 Bun，未替换执行方式。`, {
              ...identity,
              status: "unavailable",
              executed: false,
            })
          // Limit repeated checks of the same reported change, not future repairs in this Session.
          const key = Instructions.hash([input.sessionID, directory])
          const signature = Instructions.hash([
            pkg.scripts.typecheck,
            ...changes.map((change) => [change.path, change.hash]),
          ])
          const checkIdentity = { ...identity, signature }
          const previous = (yield* Ref.get(failures)).get(key)
          const count = previous?.signature === signature ? previous.count : 0
          if (count >= configured.maxConsecutiveFailures)
            return packageReport(
              `[验证] 未检查：同一变更已达到连续失败上限 ${configured.maxConsecutiveFailures}；新变更后会重新检查，也可显式运行 typecheck。`,
              { ...checkIdentity, status: "unchecked", executed: false },
            )
          const executable = hasLauncher ? launcher : "bun"
          const args = ["run", `--cwd=${directory}`, "typecheck"]
          yield* permission.assert({
            sessionID: input.sessionID,
            agent: input.agent,
            source: input.source,
            action: "shell",
            resources: [[executable, ...args].join(" ")],
            save: ["*"],
          })
          const started = yield* DateTime.nowAsDate
          yield* events.publish(SessionEvent.Verify.Started, {
            sessionID: input.sessionID,
            tool: input.toolName,
            packageDirectory: directory,
          })
          const result = yield* appProcess
            .run(ChildProcess.make(executable, args, { cwd: location.directory, stdin: "ignore" }), {
              timeout: Duration.millis(configured.timeoutMs),
              maxOutputBytes: 512 * 1024,
              maxErrorBytes: 512 * 1024,
            })
            .pipe(
              Effect.map((result) => ({ result })),
              Effect.catchTag("AppProcessError", (error) =>
                Effect.succeed({
                  unavailable:
                    error.cause instanceof Error && error.cause.message === "Timed out" ? "超时" : "执行不可用",
                }),
              ),
            )
          const durationMs = (yield* DateTime.nowAsDate).getTime() - started.getTime()
          if ("unavailable" in result) {
            yield* events.publish(SessionEvent.Verify.Failed, {
              sessionID: input.sessionID,
              tool: input.toolName,
              packageDirectory: directory,
              durationMs,
              error: result.unavailable,
            })
            return packageReport(`[验证] ${result.unavailable}：${directory} typecheck 未完成，不计为代码失败。`, {
              ...checkIdentity,
              status: "unavailable",
              executed: null,
              durationMs,
            })
          }
          const stderr = result.result.stderr.toString("utf8")
          const output = [result.result.stdout.toString("utf8"), stderr].filter(Boolean).join("\n")
          if (result.result.exitCode === 0) {
            yield* Ref.update(failures, (state) => {
              state.delete(key)
              return state
            })
            yield* events.publish(SessionEvent.Verify.Passed, {
              sessionID: input.sessionID,
              tool: input.toolName,
              packageDirectory: directory,
              durationMs,
            })
            return packageReport(`[验证] ${directory} typecheck 通过（exit 0）。`, {
              ...checkIdentity,
              status: "passed",
              executed: true,
              exitCode: 0,
              durationMs,
            })
          }
          const characters = Array.from(output)
          const diagnostic =
            characters.slice(0, 8_000).join("") +
            (characters.length > 8_000 || result.result.stdoutTruncated || result.result.stderrTruncated
              ? "\n[输出已截断]"
              : "")
          // Bun's Windows shell reports a missing executable as exit 1.
          const unavailable =
            [126, 127].includes(result.result.exitCode) ||
            (result.result.exitCode === 1 && /^bun: command not found: [^\r\n]+\r?$/m.test(stderr))
          yield* events.publish(SessionEvent.Verify.Failed, {
            sessionID: input.sessionID,
            tool: input.toolName,
            packageDirectory: directory,
            durationMs,
            error: `${unavailable ? "执行不可用" : "检查失败"}（exit ${result.result.exitCode}）\n${diagnostic}`,
          })
          if (unavailable)
            return packageReport(`[验证] 执行不可用：${directory} typecheck 未完成，不计为代码失败。`, {
              ...checkIdentity,
              status: "unavailable",
              executed: true,
              exitCode: result.result.exitCode,
              durationMs,
            })
          yield* Ref.update(failures, (state) => {
            if (state.size >= 32 && !state.has(key)) {
              const oldest = state.keys().next().value
              if (oldest !== undefined) state.delete(oldest)
            }
            return state.set(key, { signature, count: count + 1 })
          })
          const correction = yield* correctionStore
            .record({
              sessionID: input.sessionID,
              entry: {
                key: `verify:${directory}`,
                correct: `${directory} typecheck 需要修复`,
                source: "verifier",
                extractLayer: 1,
              },
            })
            .pipe(
              Effect.as(""),
              Effect.catchTag("CorrectionStore.InvalidEntryError", () => Effect.succeed("\n检测纠错未获Store接受。")),
            )
          return packageReport(
            `[验证] ${directory} typecheck 失败（exit ${result.result.exitCode}）：\n${diagnostic}${correction}`,
            { ...checkIdentity, status: "failed", executed: true, exitCode: result.result.exitCode, durationMs },
          )
        }).pipe(
          Effect.catchTags(
            unavailable((text) =>
              report(input, "unavailable", text, changes, [
                new PackageCheck({ directory: path.dirname(file), status: "unavailable", executed: false }),
              ]),
            ),
          ),
        ),
      )
      const checks = reports.flatMap((result) => result.result.packages)
      return report(
        input,
        checks.some((check) => check.status === "failed")
          ? "failed"
          : checks.every((check) => check.status === "passed")
            ? "passed"
            : checks.some((check) => check.status === "unavailable")
              ? "unavailable"
              : "unchecked",
        reports.map((result) => result.text).join("\n"),
        changes,
        checks,
      )
    })
    return Service.of({
      verify: (input) =>
        verify(input).pipe(
          verification.withPermits(1),
          Effect.catchTags({
            PlatformError: () =>
              Effect.succeed(report(input, "unavailable", "[验证] 不可用：无法读取package或检查目录。")),
            SchemaError: () => Effect.succeed(report(input, "unavailable", "[验证] 不可用：package.json格式无效。")),
            FileSystemError: () => Effect.succeed(report(input, "unavailable", "[验证] 不可用：无法定位检查目录。")),
          }),
          Effect.orDie,
        ),
    })
  }),
)
