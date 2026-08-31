const guardedRules = [
  "typescript/no-unsafe-type-assertion",
  "typescript/consistent-return",
  "typescript/unbound-method",
  "typescript/await-thenable",
  // Only ever reported as warnings by `.oxlintrc.json` (suspicious: warn), so nothing else fails on
  // them. Gating them here — against added lines only — keeps dead imports and redundant casts from
  // accumulating in new code without re-litigating the existing tree.
  "typescript/no-unnecessary-type-assertion",
  "eslint/no-unused-vars",
] as const

const guardedRuleIDs = new Set(
  guardedRules.map((rule) => {
    const [plugin, name] = [rule.slice(0, rule.indexOf("/")), rule.slice(rule.indexOf("/") + 1)]
    return plugin === "eslint" ? `eslint(${name})` : `typescript-eslint(${name})`
  }),
)
const sourcePattern = /\.(?:[cm]?[jt]s|[jt]sx)$/

const target = await resolveTarget()
const base = (await git(["merge-base", "HEAD", target])).trim()
const diff = await git(["diff", "--unified=0", "--no-color", base, "--"])
const added = parseAddedLines(diff)

for (const file of (await git(["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean)) {
  if (!sourcePattern.test(file)) continue
  const lines = (await Bun.file(file).text()).split(/\r?\n/)
  added.set(file, new Set(lines.map((_, index) => index + 1)))
}

const files = Array.from(added.keys()).filter((file) => sourcePattern.test(file) && Bun.file(file).size > 0)
if (files.length === 0) {
  console.log("Incremental lint passed: no changed JavaScript or TypeScript files")
  process.exit(0)
}

const lint = Bun.spawn(
  [
    "./node_modules/.bin/oxlint",
    "-c",
    ".oxlintrc.json",
    ...guardedRules.flatMap((rule) => ["-W", rule]),
    "--format",
    "json",
    "--",
    ...files,
  ],
  { stdout: "pipe", stderr: "pipe" },
)
const [stdout, stderr, exitCode] = await Promise.all([
  new Response(lint.stdout).text(),
  new Response(lint.stderr).text(),
  lint.exited,
])

if (exitCode !== 0) {
  process.stderr.write(stderr)
  process.stderr.write(stdout)
  process.exit(exitCode)
}

const output = parseOutput(stdout)
const diagnostics = Array.isArray(output)
  ? output.filter(isDiagnostic)
  : output && typeof output === "object" && "diagnostics" in output && Array.isArray(output.diagnostics)
    ? output.diagnostics.filter(isDiagnostic)
    : []
const sources = new Map(await Promise.all(files.map(async (file) => [file, await Bun.file(file).text()] as const)))
const violations = diagnostics.filter((diagnostic) => {
  if (!guardedRuleIDs.has(ruleID(diagnostic))) return false
  const file = normalizePath(diagnostic.filename)
  const lines = added.get(file)
  if (!lines) return false
  if (!diagnostic.labels.some((label) => lines.has(label.span.line))) return false
  if (!ruleID(diagnostic).includes("await-thenable")) return true
  return !isBunAsyncMatcher(diagnostic, sources.get(file) ?? "")
})

if (violations.length === 0) {
  const lineCount = Array.from(added.values()).reduce((total, lines) => total + lines.size, 0)
  console.log(`Incremental lint passed: ${files.length} changed files, ${lineCount} added lines`)
  process.exit(0)
}

console.error("Incremental lint found new violations:")
for (const diagnostic of violations) {
  const span = diagnostic.labels[0]?.span
  console.error(`${normalizePath(diagnostic.filename)}:${span?.line ?? 1}:${span?.column ?? 1} ${ruleID(diagnostic)}`)
  console.error(`  ${diagnostic.message}`)
}
process.exit(1)

type Diagnostic = {
  filename: string
  message: string
  code?: string
  ruleId?: string
  labels: Array<{ span: { offset: number; length: number; line: number; column: number } }>
}

async function resolveTarget() {
  const requested =
    process.env.LINT_BASE_REF || (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "main")
  const probe = Bun.spawn(["git", "rev-parse", "--verify", "--quiet", requested], {
    stdout: "ignore",
    stderr: "ignore",
  })
  if ((await probe.exited) === 0) return requested
  return "HEAD"
}

async function git(args: string[]) {
  const child = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode === 0) return stdout
  throw new Error(`git ${args.join(" ")} failed: ${stderr.trim()}`)
}

function parseAddedLines(diff: string) {
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

function parseOutput(input: string): unknown {
  try {
    return JSON.parse(input)
  } catch (error) {
    throw new Error("oxlint returned invalid JSON", { cause: error })
  }
}

function isDiagnostic(value: unknown): value is Diagnostic {
  if (!value || typeof value !== "object") return false
  if (!("filename" in value) || typeof value.filename !== "string") return false
  if (!("message" in value) || typeof value.message !== "string") return false
  if (!("labels" in value) || !Array.isArray(value.labels)) return false
  if (!("code" in value) && !("ruleId" in value)) return false
  return value.labels.every(isLabel)
}

function isLabel(value: unknown): value is Diagnostic["labels"][number] {
  if (!value || typeof value !== "object" || !("span" in value)) return false
  const span = value.span
  if (!span || typeof span !== "object") return false
  return (
    "offset" in span &&
    typeof span.offset === "number" &&
    "length" in span &&
    typeof span.length === "number" &&
    "line" in span &&
    typeof span.line === "number" &&
    "column" in span &&
    typeof span.column === "number"
  )
}

function ruleID(diagnostic: Diagnostic) {
  return diagnostic.ruleId ?? diagnostic.code ?? "unknown"
}

function isBunAsyncMatcher(diagnostic: Diagnostic, source: string) {
  const snippets = diagnostic.labels.map((label) =>
    source.slice(label.span.offset, label.span.offset + label.span.length),
  )
  if (snippets.some((snippet) => /\.(?:rejects|resolves)\b/.test(snippet))) return true

  const line = diagnostic.labels[0]?.span.line ?? 1
  return /\.(?:rejects|resolves)\b/.test(
    source
      .split(/\r?\n/)
      .slice(Math.max(0, line - 1), line + 5)
      .join("\n"),
  )
}

function normalizePath(path: string) {
  const normalized = path.replaceAll("\\", "/")
  const root = `${process.cwd().replaceAll("\\", "/")}/`
  return normalized.startsWith(root) ? normalized.slice(root.length) : normalized
}
