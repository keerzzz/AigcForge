/**
 * 跨工具命令发现（M4 Bridge）。
 * 扫描用户电脑上其他 AI 工具的 skill/command 目录，提取可用的斜杠命令。
 * 发现结果由 Command.Service 在 init 时注入，不写文件，只注册到运行时内存。
 */

import { Effect } from "effect"
import path from "path"
import { FSUtil } from "@aigcfroge/core/fs-util"
import type { Info } from "./index"

/** 发现源：安装路径 + 源名称（用于前缀 + source 字段）。 */
type SourceDef = {
  /** 工具名，也是冲突时的命名空间前缀。如 "claude"、"codex"、"zcode" */
  name: string
  /** 扫描基目录。如 "~/.claude/skills"、"~/.codex/.tmp/plugins" */
  dir: string
  /** glob 模式匹配 skill 文件/目录 */
  pattern: string
  /** SKILL.md 目录格式（true）还是扁平 .md（false） */
  directoryFormat: boolean
}

const SOURCES: SourceDef[] = [
  { name: "claude", dir: ".claude/skills", pattern: "**/*.md", directoryFormat: false },
  { name: "codex", dir: ".codex/.tmp/plugins", pattern: "*/skills/**/SKILL.md", directoryFormat: true },
  { name: "zcode", dir: ".zcode/skills", pattern: "**/*.md", directoryFormat: false },
  { name: "opencode", dir: ".opencode/skills", pattern: "**/*.md", directoryFormat: false },
]

const home = process.env.HOME ?? ""

/** 标准化路径：扩展 ~ 为 HOME。 */
function expand(p: string): string {
  if (p.startsWith("~")) return path.join(home, p.slice(1))
  return p
}

/** 解析单个 SKILL.md 内容，提取 name/description/content（frontmatter + body 兼容两种格式）。 */
function parseSkillContent(text: string, fullPath: string): { name: string; description: string; content: string } | null {
  // 尝试 frontmatter 格式
  const fm = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)
  if (fm) {
    const frontmatter: Record<string, string> = {}
    for (const line of fm[1].split("\n")) {
      const m = /^(\w+):\s*(.*)$/.exec(line)
      if (m) frontmatter[m[1]] = m[2]
    }
    const name = frontmatter.name ?? path.basename(path.dirname(fullPath))
    const description = frontmatter.description ?? frontmatter.name ?? name
    return { name, description, content: fm[2].trim() }
  }
  // 无 frontmatter → 纯文本，文件名做 name
  const name = path.basename(fullPath, ".md")
  return { name, description: name, content: text.trim() }
}

/** 扫描单条 SourceDef，返回发现的 Command Info 列表。 */
function scanSource(fs: FSUtil.Interface, source: SourceDef): Effect.Effect<Array<{ commandName: string; info: Info }>> {
  return Effect.gen(function* () {
    const root = expand(source.dir)
    const files = yield* fs.glob(source.pattern, { cwd: root, absolute: true, include: "file", dot: true }).pipe(
      Effect.catch(() => Effect.succeed([] as string[])),
    )
    const results: Array<{ commandName: string; info: Info }> = []

    for (const file of files) {
      const raw = yield* fs.readFile(file).pipe(
        Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)),
      )
      if (!raw) continue

      const text = new TextDecoder().decode(raw)
      const parsed = parseSkillContent(text, file)
      if (!parsed) continue

      const commandName = `${source.name}/${parsed.name}`
      results.push({
        commandName,
        info: {
          name: commandName,
          description: parsed.description,
          source: "skill",
          template: parsed.content,
          hints: [],
        },
      })
    }
    return results
  }).pipe(Effect.catch(() => Effect.succeed([])))
}

/** 执行全部系统扫描，返回合并后的命令列表。同名以 sources 靠前的优先。 */
export function discover(fs: FSUtil.Interface): Effect.Effect<Array<{ commandName: string; info: Info }>> {
  return Effect.gen(function* () {
    const all: Array<{ commandName: string; info: Info }> = []
    const seen = new Set<string>()

    for (const source of SOURCES) {
      const items = yield* scanSource(fs, source)
      for (const item of items) {
        // 同名冲突：先发现的优先（sources 顺序决定优先级）
        if (seen.has(item.commandName)) continue
        seen.add(item.commandName)
        all.push(item)
      }
    }
    return all
  })
}
