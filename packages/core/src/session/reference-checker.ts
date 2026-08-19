export * as ReferenceChecker from "./reference-checker"

import { Context, Effect, Layer, Schema } from "effect"
import path from "path"
import { Config } from "../config"
import { FSUtil } from "../fs-util"
import { Location } from "../location"
import { Ripgrep } from "../ripgrep"
import { SessionSchema } from "./schema"
import { isRecord } from "../util/record"
import { CorrectionStore } from "./correction-store"

const DEFAULT_ENABLED = true
const DEFAULT_TIMEOUT_MS = 5_000

type Settings = {
  readonly enabled: boolean
  readonly timeoutMs: number
}

const settings = (documents: readonly Config.Entry[]) => {
  const configured = documents
    .filter((entry): entry is Config.Document => entry.type === "document")
    .flatMap((entry) => (entry.info.meta?.reference_check ? [entry.info.meta.reference_check] : []))
  return configured.reduce<Settings>(
    (result, current) => ({
      enabled: current.enabled ?? result.enabled,
      timeoutMs: current.timeout_ms ?? result.timeoutMs,
    }),
    { enabled: DEFAULT_ENABLED, timeoutMs: DEFAULT_TIMEOUT_MS },
  )
}

export class ScanError extends Schema.TaggedErrorClass<ScanError>()("ReferenceChecker.ScanError", {
  reason: Schema.String,
}) {
  override get message() {
    return `Reference scan failed: ${this.reason}`
  }
}

export interface Interface {
  readonly check: (input: {
    readonly sessionID: SessionSchema.ID
    readonly toolName: string
    readonly toolInput: unknown
  }) => Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/ReferenceChecker") {}

// Tools that mutate files and therefore warrant a reference integrity scan.
const MUTATING_TOOLS = new Set(["edit", "write", "apply_patch", "bash"])

// Reference syntaxes that can be mechanically checked: markdown links and
// TypeScript/JavaScript import paths.
const MARKDOWN_LINK = /\[[^\]]*\]\(([^)]+)\)/g
const IMPORT_FROM = /(?:import\s+(?:type\s+)?(?:[^'"]*?)\s+from\s+|import\s+)(["'])([^"']+)\1/g
const REQUIRE = /require\(\s*(["'])([^"']+)\1\s*\)/g

// Bare specifiers (package names, node builtins) are not checkable without a
// resolution pass; only relative paths are scanned.
const RELATIVE_REFERENCE = /^(?:\.{1,2}\/|\.{1,2}$)/

// Module resolution candidates for extensionless imports, mirroring TS module
// resolution for relative specifiers.
const RESOLUTION_CANDIDATES = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", "/index.ts", "/index.js"]

const existsResolved = (fs: FSUtil.Interface, base: string, reference: string) =>
  Effect.gen(function* () {
    const resolved = path.resolve(base, reference)
    for (const candidate of RESOLUTION_CANDIDATES) {
      if (yield* fs.existsSafe(resolved + candidate)) return true
    }
    return false
  })

const extractFiles = (toolName: string, toolInput: unknown): ReadonlyArray<string> => {
  if (!MUTATING_TOOLS.has(toolName) || !isRecord(toolInput)) return []
  if (toolName === "edit" || toolName === "write") {
    const file = toolInput.path
    return typeof file === "string" ? [file] : []
  }
  if (toolName === "apply_patch") {
    const patchText = toolInput.patchText
    if (typeof patchText !== "string") return []
    const files: string[] = []
    for (const match of patchText.matchAll(/^\+\+\+ b\/(.+)$/gm)) {
      if (match[1]) files.push(match[1].trim())
    }
    return files
  }
  const command = toolInput.command
  if (typeof command !== "string") return []
  const files: string[] = []
  for (const match of command.matchAll(/(?:\.{1,2}\/)?[\w@/.-]+\.(?:md|ts|tsx|js|jsx|json|css|html|py|rs|go|sh|yml|yaml|toml)\b/g)) {
    files.push(match[0])
  }
  return files
}

const extractReferences = (line: string): ReadonlyArray<string> => {
  const references: string[] = []
  for (const match of line.matchAll(MARKDOWN_LINK)) {
    if (match[1]) references.push(match[1])
  }
  for (const match of line.matchAll(IMPORT_FROM)) {
    if (match[2]) references.push(match[2])
  }
  for (const match of line.matchAll(REQUIRE)) {
    if (match[2]) references.push(match[2])
  }
  return references
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const configured = settings(yield* config.entries())
    const ripgrep = yield* Ripgrep.Service
    const location = yield* Location.Service
    const fs = yield* FSUtil.Service
    const correctionStore = yield* CorrectionStore.Service

    const check = Effect.fn("ReferenceChecker.check")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly toolName: string
      readonly toolInput: unknown
    }) {
      if (!configured.enabled) return ""
      const files = extractFiles(input.toolName, input.toolInput)
      if (files.length === 0) return ""
      const dangling: Array<{ file: string; reference: string }> = []
      for (const file of files) {
        const matches = yield* ripgrep
          .grep({
            cwd: location.directory,
            pattern: "\\[[^]]*\\]\\([^)]*\\)|import[^;]*from\\s+['\"][^'\"]+['\"]|require\\s*\\(\\s*['\"][^'\"]+['\"]",
            file,
            limit: 200,
          })
          .pipe(
            Effect.catchTag("Ripgrep.Error", () => Effect.succeed([])),
            Effect.catchTag("Ripgrep.InvalidPatternError", () => Effect.succeed([])),
          )
        for (const match of matches) {
          for (const reference of extractReferences(match.text)) {
            if (!RELATIVE_REFERENCE.test(reference)) continue
            const exists = yield* existsResolved(fs, path.resolve(location.directory, path.dirname(file)), reference)
            if (!exists) dangling.push({ file, reference })
          }
        }
      }
      if (dangling.length === 0) return ""
      const lines = dangling.map(
        (item) => `- ${item.reference}（${item.file} 中引用）`,
      )
      const details = lines.join("\n")
      for (const item of dangling) {
        yield* correctionStore.record({
          sessionID: input.sessionID,
          entry: {
            key: `ref:${item.reference}`,
            correct: `${item.reference} 不存在`,
            wrong: item.reference,
            source: "reference-checker",
            extractLayer: 1,
          },
        })
      }
      return `⚠️ [引用校验] 检测到悬空引用：\n${details}\n请创建缺失的文件或修正引用路径。`
    })

    return Service.of({
      check: (input) =>
        check(input).pipe(
          Effect.timeoutOrElse({
            duration: `${configured.timeoutMs} millis`,
            orElse: () => Effect.succeed(""),
          }),
          Effect.catchTag("CorrectionStore.InvalidEntryError", () => Effect.succeed("")),
        ),
    })
  }),
)
