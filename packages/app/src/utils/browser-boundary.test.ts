import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

// The app bundle runs in a browser, where `process` does not exist. Several
// `@aigcfroge/core` modules are Node-only and read `process.env` while the module
// is being evaluated, so merely importing one of them anywhere in `packages/app/src`
// blanks the whole app with `ReferenceError: process is not defined` — a failure the
// dev server never reports and happy-dom unit tests never see, because bun provides
// `process`. This test walks the real import graph instead.
const appSrc = path.resolve(__dirname, "..")
const packagesRoot = path.resolve(__dirname, "../../..")

const SOURCE = /\.(ts|tsx)$/
const IS_TEST = /\.(test|stories)\.(ts|tsx)$/

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    if (!SOURCE.test(entry.name) || IS_TEST.test(entry.name)) return []
    return [full]
  })
}

/**
 * Resolves any `@aigcfroge/<pkg>/<subpath>` the way a package's `./*` export map
 * does. Not just `core`: `product-mode-policy`'s constants moved to
 * `@aigcfroge/schema/product-mode` precisely to escape this hazard, so the gate
 * has to inspect every workspace hop the app can take, not one package.
 */
function resolveWorkspace(specifier: string) {
  const match = /^@aigcfroge\/([^/]+)\/(.+)$/.exec(specifier)
  if (!match) return undefined
  const [, pkg, subpath] = match
  const src = path.join(packagesRoot, pkg, "src")
  if (!fs.existsSync(src)) return undefined
  for (const candidate of [`${subpath}.ts`, path.join(subpath, "index.ts")]) {
    const full = path.join(src, candidate)
    if (fs.existsSync(full)) return { entry: full, src }
  }
  return undefined
}

function resolveRelative(from: string, specifier: string) {
  const base = path.resolve(path.dirname(from), specifier)
  for (const candidate of [`${base}.ts`, path.join(base, "index.ts")]) {
    if (fs.existsSync(candidate)) return candidate
  }
  return undefined
}

// Deliberately newline-tolerant: a `[^"'\n]*?` body cannot cross the line break
// in a multi-line `import { a,\n b } from "..."`, which hid 47 specifiers in
// packages/app/src — including a live app -> core edge.
const IMPORT = /\bfrom\s*["']([^"']+)["']/g

function specifiers(file: string) {
  return [...fs.readFileSync(file, "utf8").matchAll(IMPORT)].map((match) => match[1])
}

// `const x = process.env[...]` / `process.foo()` at the start of a line is evaluated
// on import. A `process` read nested inside a function body is not, so it is ignored.
const MODULE_SCOPE_PROCESS = /^(?:export\s+)?(?:const|let|var)\s+[^\n=]*=\s*[^\n]*\bprocess\.|^\s{0,2}process\./m

function readsProcessOnImport(file: string) {
  return MODULE_SCOPE_PROCESS.test(fs.readFileSync(file, "utf8"))
}

describe("browser boundary: @aigcfroge workspace imports", () => {
  // The full-tree walk starves past bun's 5s default under turbo parallel
  // load (observed 8.6s); the scan itself finishes in ~1s idle.
  test("no app source pulls a workspace module that reads process on import", () => {
    const offenders: string[] = []

    for (const file of walk(appSrc)) {
      for (const specifier of specifiers(file)) {
        const resolved = resolveWorkspace(specifier)
        if (!resolved) continue

        // Breadth-first over relative imports inside that package's own src:
        // cross-package specifiers are picked up by their own resolution pass.
        const seen = new Set([resolved.entry])
        const queue = [resolved.entry]
        while (queue.length > 0) {
          const current = queue.shift()!
          if (readsProcessOnImport(current)) {
            offenders.push(`${path.relative(appSrc, file)} -> ${specifier} -> ${path.relative(packagesRoot, current)}`)
            break
          }
          for (const next of specifiers(current)) {
            if (next.startsWith(".")) {
              const relative = resolveRelative(current, next)
              if (!relative || seen.has(relative)) continue
              seen.add(relative)
              queue.push(relative)
              continue
            }
            const hop = resolveWorkspace(next)
            if (!hop || seen.has(hop.entry)) continue
            seen.add(hop.entry)
            queue.push(hop.entry)
          }
        }
      }
    }

    expect(offenders).toEqual([])
  }, 30_000)

  test("the boundary walker actually detects a node-only core module", () => {
    // Guards the guard: if resolution or the process pattern silently stops
    // matching, the test above would pass vacuously.
    const flag = resolveWorkspace("@aigcfroge/core/flag/flag")
    expect(flag?.entry).toBeString()
    expect(readsProcessOnImport(flag!.entry)).toBe(true)
    expect(resolveWorkspace("@aigcfroge/core/product-mode-policy")?.entry).toBeString()
    expect(resolveWorkspace("@aigcfroge/schema/product-mode")?.entry).toBeString()
    // A multi-line import must be visible to the specifier scanner.
    expect(specifiers(path.join(appSrc, "pages/session/workflow-runtime-model.ts"))).toContain(
      "@aigcfroge/sdk/v2/client",
    )
  })
})
