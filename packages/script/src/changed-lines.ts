export * as ChangedLines from "./changed-lines"

export type AddedLines = Map<string, Set<number>>

export function normalizePath(path: string) {
  const normalized = path.replaceAll("\\", "/")
  const root = `${process.cwd().replaceAll("\\", "/")}/`
  return normalized.startsWith(root) ? normalized.slice(root.length) : normalized
}

function decodeGitPath(value: string): string | undefined {
  const quoted = value.startsWith('"') && value.endsWith('"')
  if (!quoted) return value

  const bytes: number[] = []
  const text = value.slice(1, -1)
  for (let index = 0; index < text.length; index++) {
    const character = text[index]
    if (character !== "\\") {
      const encoded = new TextEncoder().encode(character)
      bytes.push(...encoded)
      continue
    }

    const escaped = text[++index]
    if (escaped === undefined) return undefined
    if (/[0-7]/.test(escaped)) {
      const octal = text.slice(index).match(/^[0-7]{1,3}/)?.[0]
      if (!octal) return undefined
      bytes.push(Number.parseInt(octal, 8))
      index += octal.length - 1
      continue
    }
    const common: Record<string, number> = {
      a: 0x07,
      b: 0x08,
      t: 0x09,
      n: 0x0a,
      v: 0x0b,
      f: 0x0c,
      r: 0x0d,
      '"': 0x22,
      "\\": 0x5c,
    }
    const decoded = common[escaped]
    if (decoded === undefined) return undefined
    bytes.push(decoded)
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes))
}

function diffPath(row: string): string | undefined {
  if (!row.startsWith("+++ ")) return undefined
  const decoded = decodeGitPath(row.slice(4))
  if (!decoded?.startsWith("b/")) return undefined
  return normalizePath(decoded.slice(2))
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
    const nextFile = diffPath(row)
    if (nextFile) {
      file = nextFile
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
 * technical-debt §4). Gate only logical commands containing an added line so
 * history remains untouched.
 */
const BAD_CWD_RUN = /bun\s+--cwd(?:=|\s+)(?:[^\s]+|"[^"]*"|'[^']*')\s+run\s+/
const DIRECT_REJECTION =
  /(?:拒绝|禁止|反例|不要|别用|不应|非法|不能这样|never(?:\s+use)?|reject|forbidden(?:\s+form)?|don't(?:\s+run|\s+use)?|don’t(?:\s+run|\s+use)?|do\s+not(?:\s+run|\s+use)?|wrong|invalid|anti-pattern|bad\s+form|not\s+this)\s*[:：]?\s*[`'"“”]?\s*$/i

type LogicalCommand = {
  readonly text: string
  readonly lines: readonly number[]
}

function logicalCommands(rows: readonly string[]): LogicalCommand[] {
  const commands: LogicalCommand[] = []
  for (let index = 0; index < rows.length; index++) {
    let text = rows[index]
    const lines = [index + 1]
    while (/\\\s*$/.test(text) && index + 1 < rows.length) {
      text = text.replace(/\\\s*$/, " ") + rows[++index].trimStart()
      lines.push(index + 1)
    }
    commands.push({ text, lines })
  }
  return commands
}

function directlyRejected(text: string, commandStart: number): boolean {
  const clause = text
    .slice(0, commandStart)
    .split(/[.;。；!?！？]/)
    .at(-1)
    ?.replace(/[`'"“”]\s*$/, "")
    .trimEnd()
  return clause !== undefined && DIRECT_REJECTION.test(clause)
}

export function findBadBunCwdRun(added: ReadonlySet<number>, content: string): Array<{ line: number; text: string }> {
  const violations: Array<{ line: number; text: string }> = []
  const rows = content.split(/\r?\n/)
  for (const command of logicalCommands(rows)) {
    if (!command.lines.some((line) => added.has(line))) continue
    const match = BAD_CWD_RUN.exec(command.text)
    if (!match || directlyRejected(command.text, match.index)) continue
    const line = command.lines.find((candidate) => added.has(candidate))
    if (line !== undefined) violations.push({ line, text: command.text.trim() })
  }
  return violations
}

/**
 * Meta-documentation that quotes the prohibited command only to describe the
 * anti-pattern itself: the debt ledger and implementation plans cannot avoid
 * quoting the form they document. The gate exists for instructional docs a
 * reader might copy commands from, so those stay checked.
 */
const COMMAND_GATE_EXEMPT_PATHS = /^(?:docs\/technical-debt\.md|docs\/plan\/)/

/** Whether added lines in this file skip the Markdown command gate. */
export function isCommandGateExempt(path: string): boolean {
  return COMMAND_GATE_EXEMPT_PATHS.test(normalizePath(path))
}
