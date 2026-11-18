export * as ReferenceChecker from "./reference-checker"

import { Context, Effect, Layer } from "effect"
import path from "path"
import { Config } from "../config"
import { Document, type Entry } from "@aigcfroge/schema/config"
import { FSUtil } from "@aigcfroge/util/fs-util"
import { Location } from "../location"
import { Ripgrep } from "../ripgrep"
import { SessionSchema } from "./schema"
import { CorrectionStore } from "./correction-store"
import { Permission } from "../permission"
import type { Agent } from "../agent"

const settings = (documents: readonly Entry[]) =>
  documents
    .filter((entry): entry is Document => entry.type === "document")
    .flatMap((entry) => (entry.info.meta?.reference_check ? [entry.info.meta.reference_check] : []))
    .reduce<{ enabled: boolean; timeoutMs: number }>(
      (result, current) => ({
        enabled: current.enabled ?? result.enabled,
        timeoutMs: current.timeout_ms ?? result.timeoutMs,
      }),
      { enabled: true, timeoutMs: 5_000 },
    )

type Input = {
  readonly sessionID: SessionSchema.ID
  readonly files: readonly string[]
  readonly source?: Permission.Source
  readonly agent?: Agent.ID
}

export interface Interface {
  readonly check: (input: Input) => Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/ReferenceChecker") {}

const extensions = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  "/index.ts",
  "/index.tsx",
  "/index.js",
]
const moduleFile = /\.[cm]?[jt]sx?$/i
const localReference = /^(?:\.{1,2}\/|\.{1,2}$)/

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const configured = settings(yield* config.entries())
    const ripgrep = yield* Ripgrep.Service
    const location = yield* Location.Service
    const fs = yield* FSUtil.Service
    const correctionStore = yield* CorrectionStore.Service
    const permission = yield* Permission.Service
    const isFile = (file: string) =>
      fs.stat(file).pipe(
        Effect.map((stat) => stat.type === "File"),
        Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(false)),
      )
    const resolve = Effect.fnUntraced(function* (file: string, reference: string) {
      const target = path.resolve(path.dirname(file), reference)
      if (!FSUtil.contains(location.directory, target)) return { outside: true } as const
      const candidates = [
        ...new Set([
          target,
          ...(/\.[cm]?js$/.test(target)
            ? [
                target.replace(/\.js$/, ".ts"),
                target.replace(/\.js$/, ".tsx"),
                target.replace(/\.mjs$/, ".mts"),
                target.replace(/\.cjs$/, ".cts"),
              ]
            : []),
          ...extensions.map((extension) => target + extension),
        ]),
      ]
      for (const candidate of candidates) {
        if (!(yield* isFile(candidate))) continue
        const real = yield* fs.realPath(candidate)
        if (!FSUtil.contains(location.directory, real)) return { outside: true } as const
        return { file: candidate } as const
      }
      return undefined
    })

    const check = Effect.fn("ReferenceChecker.check")(function* (input: Input) {
      if (!configured.enabled || input.files.length === 0) return ""
      const files = [...new Set(input.files.map((file) => path.resolve(location.directory, file)))]
      if (files.some((file) => !FSUtil.contains(location.directory, file)))
        return "[引用检查] 不可用：变更文件位于当前 Location 之外。"
      const names = [
        ...new Set(
          files.flatMap((file) => [
            path.basename(file).replace(/\.[^.]+$/, ""),
            ...(path.basename(file).startsWith("index.") ? [path.basename(path.dirname(file))] : []),
          ]),
        ),
      ]
      const pattern = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")
      yield* permission.assert({
        sessionID: input.sessionID,
        agent: input.agent,
        source: input.source,
        action: "grep",
        resources: [pattern],
        save: ["*"],
      })
      const reverse = yield* ripgrep.grep({
        cwd: location.directory,
        pattern,
        include: "*.{md,ts,tsx,mts,cts,js,jsx,mjs,cjs}",
        limit: 201,
      })
      const scan = [
        ...new Set([
          ...files,
          ...reverse.slice(0, 200).map((match) => path.resolve(location.directory, match.entry.path)),
        ]),
      ]
      const notes = new Set<string>()
      if (reverse.length > 200) notes.add("反向引用扫描达到200条匹配上限，未检查其余文件")
      const dangling: { file: string; reference: string; symbol?: string }[] = []
      const { default: ts } = yield* Effect.promise(() => import("typescript"))
      const parsed = new Map<string, ReturnType<typeof ts.createSourceFile>>()
      const read = Effect.fnUntraced(function* (file: string) {
        yield* permission.assert({
          sessionID: input.sessionID,
          agent: input.agent,
          source: input.source,
          action: "read",
          resources: [file],
          save: ["*"],
        })
        const real = yield* fs.realPath(file)
        if (!FSUtil.contains(location.directory, real)) return undefined
        return yield* fs.readFileString(real)
      })
      const source = Effect.fnUntraced(function* (file: string) {
        const existing = parsed.get(file)
        if (existing) return existing
        const text = yield* read(file)
        if (text === undefined) return undefined
        const result = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
        parsed.set(file, result)
        return result
      })
      for (const file of scan) {
        if (!FSUtil.contains(location.directory, file) || !(yield* isFile(file))) continue
        if (!moduleFile.test(file) && !/\.md$/i.test(file)) {
          notes.add("非Markdown/JS/TS文件未检查")
          continue
        }
        const references: { reference: string; symbols: string[] }[] = []
        if (moduleFile.test(file)) {
          const program = yield* source(file)
          if (!program) {
            notes.add("Location外的符号链接未检查")
            continue
          }
          const visit = (node: Parameters<typeof ts.forEachChild>[0]): void => {
            ts.forEachChild(node, visit)
            if (
              !ts.isCallExpression(node) ||
              !(
                (ts.isIdentifier(node.expression) && node.expression.text === "require") ||
                node.expression.kind === ts.SyntaxKind.ImportKeyword
              )
            )
              return
            const target = node.arguments[0]
            if (!target || !ts.isStringLiteral(target)) {
              notes.add("动态计算的模块引用未检查")
              return
            }
            references.push({ reference: target.text, symbols: [] })
          }
          visit(program)
          for (const statement of program.statements) {
            if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
              const bindings = statement.importClause?.namedBindings
              references.push({
                reference: statement.moduleSpecifier.text,
                symbols: [
                  ...(statement.importClause?.name ? ["default"] : []),
                  ...(bindings && ts.isNamedImports(bindings)
                    ? bindings.elements.map((item) => (item.propertyName ?? item.name).text)
                    : []),
                ],
              })
            }
            if (
              ts.isExportDeclaration(statement) &&
              statement.moduleSpecifier &&
              ts.isStringLiteral(statement.moduleSpecifier)
            )
              references.push({
                reference: statement.moduleSpecifier.text,
                symbols:
                  statement.exportClause && ts.isNamedExports(statement.exportClause)
                    ? statement.exportClause.elements.map((item) => (item.propertyName ?? item.name).text)
                    : [],
              })
          }
        }
        if (/\.md$/i.test(file)) {
          const text = yield* read(file)
          if (text === undefined) {
            notes.add("Location外的符号链接未检查")
            continue
          }
          references.push(
            ...Array.from(text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g), (match) => ({
              reference: match[1] ?? "",
              symbols: [],
            })),
          )
        }
        for (const ref of references) {
          if (!localReference.test(ref.reference)) {
            notes.add("非相对模块与链接未检查")
            continue
          }
          if (/[?%]/.test(ref.reference)) {
            notes.add("带查询或URL编码的引用未检查")
            continue
          }
          const target = yield* resolve(file, ref.reference.split("#")[0] ?? ref.reference)
          if (target && "outside" in target) {
            notes.add("Location外的引用未检查")
            continue
          }
          if (!target) {
            dangling.push({ file, reference: ref.reference })
            continue
          }
          if (ref.symbols.length === 0) continue
          if (!moduleFile.test(target.file)) {
            notes.add("非JS/TS模块的符号未检查")
            continue
          }
          const program = yield* source(target.file)
          if (!program) {
            notes.add("Location外的符号链接未检查")
            continue
          }
          const exported = new Set<string>()
          let open = false
          for (const statement of program.statements) {
            if (ts.isExportDeclaration(statement)) {
              if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
                statement.exportClause.elements.forEach((item) => exported.add(item.name.text))
                continue
              }
              open = true
              continue
            }
            if (ts.isExportAssignment(statement)) {
              if (statement.isExportEquals) {
                open = true
                continue
              }
              exported.add("default")
              continue
            }
            if (
              ts.isExpressionStatement(statement) &&
              /^(?:module\.exports|exports\.)/.test(statement.expression.getText(program))
            )
              open = true
            const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined
            if (!modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue
            if (modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
              exported.add("default")
              continue
            }
            if (ts.isVariableStatement(statement)) {
              statement.declarationList.declarations.forEach((item) => {
                if (!ts.isIdentifier(item.name)) {
                  open = true
                  return
                }
                exported.add(item.name.text)
              })
              continue
            }
            if (
              ts.isFunctionDeclaration(statement) ||
              ts.isClassDeclaration(statement) ||
              ts.isInterfaceDeclaration(statement) ||
              ts.isTypeAliasDeclaration(statement) ||
              ts.isEnumDeclaration(statement)
            ) {
              if (statement.name) exported.add(statement.name.text)
              continue
            }
            open = true
          }
          for (const symbol of ref.symbols) {
            if (exported.has(symbol)) continue
            if (open) {
              notes.add("星号再导出或复杂导出中的符号未检查")
              continue
            }
            dangling.push({ file, reference: ref.reference, symbol })
          }
        }
      }
      for (const item of dangling) {
        yield* correctionStore
          .record({
            sessionID: input.sessionID,
            entry: {
              key: item.symbol ? `ref:${item.reference}#${item.symbol}` : `ref:${item.reference}`,
              correct: item.symbol ? `${item.reference} 未声明导出 ${item.symbol}` : `${item.reference} 不存在`,
              wrong: item.reference,
              source: "reference-checker",
              extractLayer: 1,
            },
          })
          .pipe(
            Effect.catchTag("CorrectionStore.InvalidEntryError", () =>
              Effect.sync(() => notes.add("检测结果未获纠错Store接受")),
            ),
          )
      }
      return [
        dangling.length
          ? `[引用检查] 检测到悬空引用：\n${dangling.map((item) => `- ${item.reference}${item.symbol ? `#${item.symbol}` : ""}（${path.relative(location.directory, item.file)}）`).join("\n")}`
          : "[引用检查] 已检查支持的相对引用和显式导出，未发现悬空引用。",
        "范围：返回的变更文件及按文件名检索的直接反向引用；不是完整语言/类型验证。",
        ...notes,
      ].join("\n")
    })
    return Service.of({
      check: (input) =>
        check(input).pipe(
          Effect.timeoutOrElse({
            duration: `${configured.timeoutMs} millis`,
            orElse: () => Effect.succeed("[引用检查] 超时，未完成检查。"),
          }),
          Effect.catchTags({
            "Ripgrep.Error": () => Effect.succeed("[引用检查] 不可用：无法扫描引用。"),
            "Ripgrep.InvalidPatternError": () => Effect.succeed("[引用检查] 不可用：扫描表达式不受支持。"),
            PlatformError: () => Effect.succeed("[引用检查] 不可用：无法读取检查文件。"),
            "Permission.BlockedError": () => Effect.succeed("[引用检查] 不可用：当前权限拒绝检查。"),
            "Permission.CorrectedError": () => Effect.succeed("[引用检查] 不可用：当前权限要求修正。"),
            "Permission.RejectedError": () => Effect.succeed("[引用检查] 不可用：检查授权被拒绝。"),
            "Permission.AskExpiredError": () => Effect.succeed("[引用检查] 不可用：检查授权过期。"),
          }),
          Effect.orDie,
        ),
    })
  }),
)
