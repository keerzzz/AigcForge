export type AddedLines = Map<string, Set<number>>

export function normalizePath(path: string) {
  const normalized = path.replaceAll("\\", "/")
  const root = `${process.cwd().replaceAll("\\", "/")}/`
  return normalized.startsWith(root) ? normalized.slice(root.length) : normalized
}

/** Parse `git diff --unified=0` into per-file added-line sets. */
export function parseAddedLines(diff: string): AddedLines {
  const files = new Map<string, Set<number>>()
  let file: string | undefined
  let line = 0
  let hunk = false

  for (const row of diff.split("\n")) {
    if (row.startsWith("diff --git ")) {
      file = undefined
      hunk = false
      continue
    }
    if (row.startsWith("+++ b/")) {
      file = normalizePath(row.slice("+++ b/".length))
      if (!files.has(file)) files.set(file, new Set())
      continue
    }
    if (row.startsWith("@@")) {
      const match = row.match(/\+(\d+)(?:,\d+)?/)
      if (!match) continue
      line = Number(match[1])
      hunk = true
      continue
    }
    if (!file || !hunk || row.startsWith("\\ No newline")) continue
    if (row.startsWith("+")) {
      files.get(file)?.add(line)
      line++
      continue
    }
    if (row.startsWith("-")) continue
    line++
  }

  for (const [name, lines] of files) if (lines.size === 0) files.delete(name)
  return files
}

/** Every line of an untracked file counts as added. */
export function addedLinesOfFile(content: string): Set<number> {
  return new Set(content.split(/\r?\n/).map((_, index) => index + 1))
}

/**
 * Resolve the diff baseline in the repository's documented order: an explicit
 * `LINT_BASE_REF` wins, then the GitHub base, then `origin/main`, then `main`,
 * falling back to `HEAD` when none resolves.
 */
export async function resolveBaseline(env: {
  readonly LINT_BASE_REF?: string
  readonly GITHUB_BASE_REF?: string
}): Promise<string> {
  const candidates: string[] = []
  if (env.LINT_BASE_REF) candidates.push(env.LINT_BASE_REF)
  if (env.GITHUB_BASE_REF) candidates.push(`origin/${env.GITHUB_BASE_REF}`)
  candidates.push("origin/main", "main")
  for (const ref of candidates) {
    const probe = Bun.spawn(["git", "rev-parse", "--verify", "--quiet", ref], {
      stdout: "ignore",
      stderr: "ignore",
    })
    if ((await probe.exited) === 0) return ref
  }
  return "HEAD"
}

/**
 * `bun --cwd <pkg> run <script>` silently prints bun's usage and exits 0
 * without running anything (bun 1.3.14, recorded in docs/testing.md §0 and
 * technical-debt §4). Only the two orders where `run` does not sit between
 * `--cwd` and the script are valid: `bun --cwd <pkg> <script>` and
 * `bun run --cwd <pkg> <script>`. Gate only ADDED lines so history stays.
 */
const BAD_CWD_RUN = /bun\s+--cwd(?:=|\s+)(?:[^\s]+|"[^"]*"|'[^']*')\s+run\s+/

// Lines that DESCRIBE the anti-pattern (e.g. docs that say "reject
// `bun --cwd <pkg> run <script>`") are not commands to run and must not be
// flagged — only added lines that instruct the bad form are. Chinese and
// English rejection words both appear in this repo's docs, so both are listed;
// the `i` flag only affects the ASCII words (Chinese has no case).
const DESCRIBES_REJECTION =
  /拒绝|禁止|反例|不要|别用|不应|不是|不清扫|非法|不能这样|never|reject|forbidden|don't|don’t|do not|wrong|invalid|anti-pattern|bad form|not this/i

export function findBadBunCwdRun(
  added: ReadonlySet<number>,
  content: string,
): Array<{ line: number; text: string }> {
  const violations: Array<{ line: number; text: string }> = []
  const rows = content.split(/\r?\n/)
  for (const line of added) {
    const text = rows[line - 1]
    if (text !== undefined && BAD_CWD_RUN.test(text) && !DESCRIBES_REJECTION.test(text)) {
      violations.push({ line, text: text.trim() })
    }
  }
  return violations
}
