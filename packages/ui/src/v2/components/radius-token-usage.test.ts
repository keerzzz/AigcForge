import { describe, expect, test } from "bun:test"
import path from "node:path"

// Design-system reuse contract: no behavioral assertion can distinguish a
// hardcoded mapped radius from its token-backed equivalent, so this pins the
// ownership decision itself and prevents mapped values from forking again.
const mappedRadius = /border-radius:\s*(?:2|4|6|8)px\s*;|border-radius:\s*4px\s+0\s+0\s+4px\s*;/g
const root = path.resolve(import.meta.dir, "..")

describe("v2 radius token usage", () => {
  test("mapped v2 radii use the shared radius tokens", async () => {
    const hits: string[] = []
    for await (const file of new Bun.Glob("**/*.css").scan({ cwd: root })) {
      const source = await Bun.file(path.join(root, file)).text()
      for (const match of source.matchAll(mappedRadius)) hits.push(`${file}:${match.index}`)
    }
    expect(hits).toEqual([])
  })
})
