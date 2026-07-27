/**
 * 跨工具命令发现（M4 Bridge - Option C）。
 * 扫描用户电脑上其他 AI 工具的 skill 目录，将可用的命令以 .md 文件写到
 * .aigcfroge/commands/source-name.md。写入后：
 * - ConfigCommandPlugin（glob 扫描命令目录）.md 文件自动拾取 → 斜杠弹窗
 * - CommandAsset registry 自动拾取 → AssetWorkbenchTable
 * 写入幂等：文件已存在且用户编辑过的不被覆盖。
 */

import { Effect } from "effect"
import path from "path"
import { FSUtil } from "@aigcfroge/core/fs-util"

/** 发现源：安装路径 + 源名称（用于文件名前缀 + 冲突隔离）。 */
type SourceDef = {
  name: string
  dir: string
  pattern: string
  directoryFormat: boolean
}

const SOURCES: SourceDef[] = [
  { name: "agents", dir: ".agents/skills", pattern: "{*.md,**/SKILL.md}", directoryFormat: true },
  { name: "claude", dir: ".claude/skills", pattern: "{*.md,**/SKILL.md}", directoryFormat: true },
  { name: "codex", dir: ".codex/.tmp/plugins", pattern: "*/skills/**/SKILL.md", directoryFormat: true },
  { name: "zcode", dir: ".zcode/skills", pattern: "**/*.md", directoryFormat: false },
  { name: "opencode", dir: ".opencode/skills", pattern: "**/*.md", directoryFormat: false },
]

const home = process.env.HOME ?? ""

function expand(p: string): string {
  if (p.startsWith("~")) return path.join(home, p.slice(1))
  return p
}

/** 从 SKILL.md 正文提取 name/description/body。 */
function parseSkillContent(text: string, fullPath: string): { name: string; description: string; content: string } | null {
  const fm = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)
  if (fm) {
    const frontmatter: Record<string, string> = {}
    for (const line of fm[1].split("\n")) {
      const m = /^(\w+):\s*(.*)$/.exec(line)
      if (m) frontmatter[m[1]] = m[2]
    }
    const name = frontmatter.name ?? path.basename(path.dirname(fullPath))
    const description = frontmatter.description ?? name
    return { name, description, content: fm[2].trim() }
  }
  const name = path.basename(fullPath, ".md")
  return { name, description: name, content: text.trim() }
}

/** Strip surrounding YAML quotes and escape for YAML double-quoted output. */
function yamlQuote(value: string): string {
  // Strip surrounding single or double quotes if present
  let clean = value
  if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'"))) {
    clean = clean.slice(1, -1)
  }
  // Escape backslash, double-quote, and control chars for YAML double-quoted scalar
  const escaped = clean
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
  // Truncate to 300 code points to pass CommandAsset.Frontmatter schema's Description ≤300 constraint
  const truncated = [...escaped].slice(0, 300).join("")
  return `"${truncated}"`
}

/** 将发现的命令以 .md 文件写入 COMMANDS_DIR，幂等（已存在且一致则跳过）。 */
export function syncDiscovered(
  fs: FSUtil.Interface,
  commandsDir: string,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const seen = new Set<string>()

    for (const source of SOURCES) {
      const root = expand(source.dir)
      const files = yield* fs.glob(source.pattern, { cwd: root, absolute: true, include: "file", dot: true, symlink: true }).pipe(
        Effect.catch(() => Effect.succeed([] as string[])),
      )

      for (const file of files) {
        const raw = yield* fs.readFile(file).pipe(
          Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)),
        )
        if (!raw) continue

        const text = new TextDecoder().decode(raw)
        const parsed = parseSkillContent(text, file)
        if (!parsed) continue

        // 冲突隔离：同名同源只写第一条（SKILL.md 优先于同目录的随机 .md）
        const dedupKey = `${source.name}/${parsed.name}`
        if (seen.has(dedupKey)) continue
        seen.add(dedupKey)

        const fileName = `${source.name}-${parsed.name}.md`
        const targetPath = path.join(commandsDir, fileName)

        // 已存在 → 跳过（用户可能编辑过）
        const existing = yield* fs.readFile(targetPath).pipe(
          Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)),
        )
        if (existing !== undefined) continue

        // 写文件（create dirs if needed）
        const content = `---\nname: ${source.name}-${parsed.name}\ndescription: ${yamlQuote(parsed.description)}\ninvocation: /${source.name}-${parsed.name}\nsource: ${source.name}\n---\n\n${parsed.content}\n`
        yield* fs.writeWithDirs(targetPath, content)
      }
    }
  }).pipe(Effect.catch(() => Effect.void))
}
