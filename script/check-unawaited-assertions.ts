#!/usr/bin/env bun

/**
 * Gate: an `expect(...).rejects` / `.resolves` chain that nothing awaits.
 *
 * Why a text gate and not a lint rule: bun-types declares
 * `expect(p).rejects.toThrow()` as `void`, so `typescript/no-floating-promises`
 * (already enabled) sees nothing to float, and `typescript/await-thenable`
 * would instead flag every *correct* `await expect(...).rejects` site as
 * awaiting a non-thenable. `.oxlintrc.json` disables await-thenable in tests
 * for exactly that reason — do not re-enable it.
 *
 * The chain is located by walking back over balanced parentheses from the
 * `.rejects`/`.resolves` member, so the multi-line form
 *
 *     await expect(
 *       doThing(),
 *     ).rejects.toThrow("boom")
 *
 * is covered too. A line-anchored regex is not: it never sees the `expect(`.
 */

import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

const SCAN_DIRS = ["src", "test"]
const TEST_FILE = /\.test\.tsx?$/
const MEMBER = /\.(rejects|resolves)\b/g
const CONSUMED = /\b(await|return|yield)\s*$/

function testFiles(dir: string, found: string[] = []): string[] {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    if (entry.name === "node_modules") continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) testFiles(full, found)
    else if (TEST_FILE.test(entry.name)) found.push(full)
  }
  return found
}

/** Index of the `expect` token owning the chain, or undefined if this is not an expect chain. */
function expectStart(source: string, memberIndex: number): number | undefined {
  let i = memberIndex - 1
  while (i >= 0 && /\s/.test(source[i]!)) i--
  if (source[i] !== ")") return undefined
  let depth = 0
  for (; i >= 0; i--) {
    if (source[i] === ")") depth++
    else if (source[i] === "(") {
      depth--
      if (depth === 0) break
    }
  }
  if (i < 0) return undefined
  let end = i
  while (end > 0 && /\s/.test(source[end - 1]!)) end--
  const start = end - "expect".length
  return source.slice(start, end) === "expect" ? start : undefined
}

const files = SCAN_DIRS.flatMap((sub) =>
  readdirSync("packages", { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => testFiles(path.join("packages", entry.name, sub))),
).sort()

const violations: string[] = []
let chains = 0

for (const file of files) {
  const source = readFileSync(file, "utf-8")
  const lineStarts = [0]
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") lineStarts.push(i + 1)
  for (const match of source.matchAll(MEMBER)) {
    const start = expectStart(source, match.index)
    if (start === undefined) continue
    const lineIndex = lineStarts.findLastIndex((offset) => offset <= start)
    const prefix = source.slice(lineStarts[lineIndex]!, start)
    // `.rejects` quoted inside a comment reads as a chain to the paren walk.
    if (prefix.includes("//")) continue
    chains++
    if (CONSUMED.test(prefix)) continue
    const line = source.slice(lineStarts[lineIndex]!, source.indexOf("\n", start))
    violations.push(`${file}:${lineIndex + 1}: ${line.trim()}`)
  }
}

const summary = `${files.length} test files, ${chains} expect(...).rejects/.resolves chains`
if (violations.length === 0) {
  console.log(`No unawaited assertions. Scanned ${summary}.`)
  process.exit(0)
}
console.error(`Found ${violations.length} unawaited expect(...).rejects/.resolves assertions:\n`)
for (const violation of violations) console.error(violation)
console.error(`\nScanned ${summary}.`)
process.exit(1)
