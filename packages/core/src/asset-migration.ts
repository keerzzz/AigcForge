export * as AssetMigration from "./asset-migration"

import path from "path"
import { Effect } from "effect"
import { Config } from "./config"
import { ConfigMarkdown } from "./config/markdown"
import { FSUtil } from "./fs-util"

/** Project-local legacy source that can be parsed into an owned chat asset. */
export interface LegacyFile {
  readonly path: string
  readonly fallbackName: string
}

export interface LegacyEntry {
  readonly name: string
  readonly file: string
  readonly relativePath?: string
  readonly source?: string
}

function yamlEscape(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t")}"`
}

function localDocument(entry: Config.Entry, projectDirectory: string): entry is Config.Document {
  if (entry.type !== "document" || !entry.path) return false
  const relative = path.relative(projectDirectory, entry.path)
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
}

function safeRelativePath(relativePath: string) {
  if (path.isAbsolute(relativePath)) return false
  const normalized = relativePath.replaceAll("\\", "/")
  if (!normalized.endsWith(".md")) return false
  return normalized.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
}

/** Project-level legacy skill files: `.claude/skills` first, then `.agents/skills` (V1 precedence). */
export const legacySkillFiles = Effect.fnUntraced(function* (fs: FSUtil.Interface, directory: string) {
  const groups = yield* Effect.forEach([".claude/skills", ".agents/skills"], (dir) =>
    fs
      .glob("**/SKILL.md", { cwd: path.resolve(directory, dir), absolute: true, include: "file", dot: true })
      .pipe(Effect.catch(() => Effect.succeed([] as string[]))),
  )
  return groups.flat().map((file) => ({ path: file, fallbackName: path.basename(path.dirname(file)) }) satisfies LegacyFile)
})

/** Project-level legacy agent files: `.claude/agents/*.agent.md`. */
export const legacyAgentFiles = Effect.fnUntraced(function* (fs: FSUtil.Interface, directory: string) {
  const files = yield* fs
    .glob("*.agent.md", { cwd: path.resolve(directory, ".claude/agents"), absolute: true, include: "file", dot: true })
    .pipe(Effect.catch(() => Effect.succeed([] as string[])))
  return files.map((file) => ({ path: file, fallbackName: path.basename(file, ".agent.md") }) satisfies LegacyFile)
})

/** Legacy singular command directory; plural `.aigcfroge/commands` is handled lazily by CommandAsset.loadDir. */
export const legacyCommandFiles = Effect.fnUntraced(function* (fs: FSUtil.Interface, directory: string) {
  const root = path.resolve(directory, ".aigcfroge/command")
  const files = yield* fs
    .glob("**/*.md", { cwd: root, absolute: true, include: "file", dot: true })
    .pipe(Effect.catch(() => Effect.succeed([] as string[])))
  return files.map(
    (file) =>
      ({
        path: file,
        fallbackName: path.relative(root, file).replaceAll("\\", "/").replace(/\.md$/, ""),
      }) satisfies LegacyFile,
  )
})

/** Parse a legacy SKILL.md into the native SkillAsset markdown shape. */
export function skillEntry(raw: string, fallbackName: string): LegacyEntry | undefined {
  const parsed = ConfigMarkdown.parseOption(raw)
  if (!parsed) return undefined
  const name = typeof parsed.data.name === "string" && parsed.data.name ? parsed.data.name : fallbackName
  const description = typeof parsed.data.description === "string" ? parsed.data.description : ""
  const frontmatter = `---\nname: ${yamlEscape(name)}\ndescription: ${yamlEscape(description)}\nslash: true\n---\n`
  return { name, file: frontmatter + parsed.content }
}

/** Parse a legacy .agent.md into an AgentAsset file while leaving the original V1 source untouched. */
export function agentEntry(raw: string, fallbackName: string): LegacyEntry | undefined {
  const parsed = ConfigMarkdown.parseOption(raw)
  if (!parsed) return undefined
  const name = typeof parsed.data.name === "string" && parsed.data.name ? parsed.data.name : fallbackName
  const description = typeof parsed.data.description === "string" ? parsed.data.description : ""
  const frontmatter = `---\nkind: agent\nname: ${yamlEscape(name)}\ndescription: ${yamlEscape(description)}\n---\n`
  return { name, file: frontmatter + parsed.content }
}

/** Convert a V1 command markdown file to a dual-readable V1 + CommandAsset file. */
export function commandEntry(raw: string, fallbackName: string): LegacyEntry | undefined {
  const parsed = ConfigMarkdown.parseOption(raw)
  if (!parsed) return undefined
  if (parsed.data.kind === "command") return undefined

  const name = typeof parsed.data.name === "string" && parsed.data.name ? parsed.data.name : fallbackName
  const description = typeof parsed.data.description === "string" ? parsed.data.description : ""
  const invocation = typeof parsed.data.invocation === "string" && parsed.data.invocation ? parsed.data.invocation : `/${name}`
  const optional = [
    typeof parsed.data.args === "string" ? `args: ${yamlEscape(parsed.data.args)}` : undefined,
    typeof parsed.data.agent === "string" ? `agent: ${yamlEscape(parsed.data.agent)}` : undefined,
    typeof parsed.data.model === "string" ? `model: ${yamlEscape(parsed.data.model)}` : undefined,
    typeof parsed.data.variant === "string" ? `variant: ${yamlEscape(parsed.data.variant)}` : undefined,
    typeof parsed.data.subtask === "boolean" ? `subtask: ${String(parsed.data.subtask)}` : undefined,
  ].filter((line): line is string => line !== undefined)
  const frontmatter = [
    "---",
    "kind: command",
    `name: ${yamlEscape(name)}`,
    `description: ${yamlEscape(description)}`,
    `invocation: ${yamlEscape(invocation)}`,
    ...optional,
    "---",
    "",
  ].join("\n")
  return { name, relativePath: `${fallbackName}.md`, file: frontmatter + parsed.content }
}

/** Project-local JSON/JSONC command definitions, with higher-priority documents winning. */
export function commandConfigEntries(entries: readonly Config.Entry[], projectDirectory: string) {
  const commands = new Map<string, LegacyEntry>()
  for (const entry of entries) {
    if (!localDocument(entry, projectDirectory)) continue
    for (const [name, command] of Object.entries(entry.info.commands ?? {})) {
      const optional = [
        command.agent ? `agent: ${yamlEscape(command.agent)}` : undefined,
        command.model ? `model: ${yamlEscape(command.model)}` : undefined,
        command.variant ? `variant: ${yamlEscape(command.variant)}` : undefined,
        command.subtask !== undefined ? `subtask: ${String(command.subtask)}` : undefined,
      ].filter((line): line is string => line !== undefined)
      const file = [
        "---",
        "kind: command",
        `name: ${yamlEscape(name)}`,
        `description: ${yamlEscape(command.description ?? "")}`,
        `invocation: ${yamlEscape(`/${name}`)}`,
        ...optional,
        "---",
        command.template,
      ].join("\n")
      commands.set(name, { name, relativePath: `${name}.md`, file, source: entry.path })
    }
  }
  return [...commands.values()]
}

/** Project-local MCP config definitions, with higher-priority documents winning. */
export function mcpConfigEntries(entries: readonly Config.Entry[], projectDirectory: string) {
  const servers = new Map<string, LegacyEntry>()
  for (const entry of entries) {
    if (!localDocument(entry, projectDirectory)) continue
    for (const [name, server] of Object.entries(entry.info.mcp?.servers ?? {})) {
      const command = server.type === "local" ? server.command[0] : server.url
      if (!command) continue
      const args = server.type === "local" ? server.command.slice(1) : []
      const env = server.type === "local" ? (server.environment ?? {}) : {}
      const file = [
        "---",
        "kind: mcp",
        `name: ${yamlEscape(name)}`,
        `description: ${yamlEscape("")}`,
        `command: ${yamlEscape(command)}`,
        `args: ${JSON.stringify(args)}`,
        `env: ${JSON.stringify(env)}`,
        "---",
        JSON.stringify(server, null, 2),
      ].join("\n")
      servers.set(name, { name, relativePath: `${name}.md`, file, source: entry.path })
    }
  }
  return [...servers.values()]
}

export const entriesFromFiles = Effect.fnUntraced(function* (
  fs: FSUtil.Interface,
  files: readonly LegacyFile[],
  parse: (raw: string, fallbackName: string) => LegacyEntry | undefined,
) {
  const entries = yield* Effect.forEach(files, (legacy) =>
    fs.readFile(legacy.path).pipe(
      Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)),
      Effect.map((raw) => {
        if (!raw) return undefined
        const entry = parse(new TextDecoder().decode(raw), legacy.fallbackName)
        return entry ? ({ ...entry, source: legacy.path } satisfies LegacyEntry) : undefined
      }),
    ),
  )
  return entries.flatMap((entry) => (entry ? [entry] : []))
})

/** Import entries once. A marker supports owner roots that already contain legacy files. */
export const importEntriesOnce = Effect.fn("AssetMigration.importEntriesOnce")(function* (
  fs: FSUtil.Interface,
  input: {
    readonly ownerRoot: string
    readonly marker?: string
    readonly entries: readonly LegacyEntry[]
    readonly isValidName: (name: string) => boolean
  },
) {
  if (yield* fs.exists(input.marker ?? input.ownerRoot)) return

  const seen = new Set<string>()
  const entries = input.entries.filter((entry) => {
    const relativePath = entry.relativePath ?? `${entry.name}.md`
    if (!input.isValidName(entry.name) || !safeRelativePath(relativePath)) {
      Effect.runFork(Effect.logWarning("asset migration: invalid entry skipped", { name: entry.name, path: entry.source }))
      return false
    }
    if (seen.has(entry.name)) return false
    seen.add(entry.name)
    return true
  })

  const written = yield* Effect.forEach(entries, (entry) => {
    const target = path.join(input.ownerRoot, entry.relativePath ?? `${entry.name}.md`)
    return fs.exists(target).pipe(
      Effect.andThen((exists) => {
        if (exists) return Effect.succeed(true)
        return fs.writeWithDirs(target, entry.file).pipe(
          Effect.as(true),
          Effect.catch((error) =>
            Effect.logWarning("asset migration: write failed", { name: entry.name, error }).pipe(Effect.as(false)),
          ),
        )
      }),
    )
  })

  if (!input.marker || written.some((success) => !success)) return
  yield* fs.writeWithDirs(input.marker, "completed\n")
})

/** File-backed first-run import used by Skill and Agent registries. */
export const importOnce = Effect.fn("AssetMigration.importOnce")(function* (
  fs: FSUtil.Interface,
  input: {
    readonly ownerRoot: string
    readonly files: readonly LegacyFile[]
    readonly parse: (raw: string, fallbackName: string) => LegacyEntry | undefined
    readonly isValidName: (name: string) => boolean
  },
) {
  if (yield* fs.exists(input.ownerRoot)) return
  yield* importEntriesOnce(fs, {
    ownerRoot: input.ownerRoot,
    entries: yield* entriesFromFiles(fs, input.files, input.parse),
    isValidName: input.isValidName,
  })
})
