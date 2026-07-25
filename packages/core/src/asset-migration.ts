export * as AssetMigration from "./asset-migration"

import path from "path"
import { Effect } from "effect"
import { ConfigMarkdown } from "./config/markdown"
import { FSUtil } from "./fs-util"

/**
 * Legacy → asset-owner migration (chat M3). Runs at registry boot BEFORE the
 * initial reload. Import happens only when the owner directory does not exist
 * (first-run semantics): once the directory exists — even empty — nothing is
 * ever auto-imported again, so files the user deleted are never resurrected.
 *
 * Scope is deliberately limited to project-local legacy files:
 * - skill: `.claude/skills/<name>/SKILL.md` and `.agents/skills/<name>/SKILL.md`
 * - agent: `.claude/agents/<name>.agent.md`
 * Global (~/) sources, config-driven command/mcp entries, MCP prompts, and
 * built-ins are NOT migrated: they remain active config/discovery sources
 * owned by the V1 consumers, and copying them would fork the source of truth.
 */

function yamlEscape(value: string): string {
  // YAML double-quoted string: escape \, ", \r, \n, \t
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t")}"`
}

export interface LegacyFile {
  readonly path: string
  readonly fallbackName: string
}

export interface LegacyEntry {
  readonly name: string
  readonly file: string
}

/** Project-level legacy skill files: `.claude/skills` first, then `.agents/skills` (V1 discovery order). */
export const legacySkillFiles = Effect.fnUntraced(function* (fs: FSUtil.Interface, directory: string) {
  const dirs = [".claude/skills", ".agents/skills"]
  const groups = yield* Effect.forEach(dirs, (dir) =>
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

/** Parse a legacy SKILL.md (frontmatter name/description + body) into an asset file. */
export function skillEntry(raw: string, fallbackName: string): LegacyEntry | undefined {
  const parsed = ConfigMarkdown.parseOption(raw)
  if (!parsed) return undefined
  const name = typeof parsed.data.name === "string" && parsed.data.name ? parsed.data.name : fallbackName
  const description = typeof parsed.data.description === "string" ? parsed.data.description : ""
  // V1 skills are all invocable as `/name` commands, so migrate with slash: true.
  const frontmatter = `---\nname: ${yamlEscape(name)}\ndescription: ${yamlEscape(description)}\nslash: true\n---\n`
  return { name, file: frontmatter + parsed.content }
}

/**
 * Parse a legacy .agent.md into an asset file. Extra legacy keys (tools,
 * handoffs, model, user-invocable) are not carried into `config`: the legacy
 * files remain the active source for the V1 AgentFileLoader, so nothing is lost.
 */
export function agentEntry(raw: string, fallbackName: string): LegacyEntry | undefined {
  const parsed = ConfigMarkdown.parseOption(raw)
  if (!parsed) return undefined
  const name = typeof parsed.data.name === "string" && parsed.data.name ? parsed.data.name : fallbackName
  const description = typeof parsed.data.description === "string" ? parsed.data.description : ""
  const frontmatter = `---\nkind: agent\nname: ${yamlEscape(name)}\ndescription: ${yamlEscape(description)}\n---\n`
  return { name, file: frontmatter + parsed.content }
}

/**
 * Import legacy entries into the owner root when it does not exist yet.
 * Duplicate names keep the first file (matching V1 precedence); invalid names
 * and unreadable files are skipped with a warning. Individual write failures
 * are logged and do not abort the remaining imports.
 */
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

  const seen = new Set<string>()
  const entries: LegacyEntry[] = []
  for (const legacy of input.files) {
    const raw = yield* fs.readFile(legacy.path).pipe(
      Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)),
    )
    if (!raw) continue
    const entry = input.parse(new TextDecoder().decode(raw), legacy.fallbackName)
    if (!entry) {
      yield* Effect.logWarning("asset migration: unparseable legacy file skipped", { path: legacy.path })
      continue
    }
    if (!input.isValidName(entry.name)) {
      yield* Effect.logWarning("asset migration: invalid name skipped", { name: entry.name, path: legacy.path })
      continue
    }
    if (seen.has(entry.name)) {
      yield* Effect.logWarning("asset migration: duplicate name skipped", { name: entry.name, path: legacy.path })
      continue
    }
    seen.add(entry.name)
    entries.push(entry)
  }
  if (entries.length === 0) return

  yield* Effect.forEach(
    entries,
    (entry) =>
      fs.writeWithDirs(path.join(input.ownerRoot, `${entry.name}.md`), entry.file).pipe(
        Effect.catch((error) => Effect.logWarning("asset migration: write failed", { name: entry.name, error })),
      ),
    { discard: true },
  )
})
