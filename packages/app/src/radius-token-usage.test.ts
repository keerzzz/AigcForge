import { describe, expect, test } from "bun:test"
import path from "node:path"

// Design-system reuse contract: no behavioral assertion can distinguish a
// hardcoded mapped radius from its token-backed equivalent, so this pins the
// ownership decision itself and prevents mapped values from forking again.
const mappedRadius = () => /rounded-(?:r-)?\[(?:2|4|6|8|10)px\]/g

describe("radius token usage", () => {
  test("mapped app radii use the shared radius utilities", async () => {
    const files = await Array.fromAsync(new Bun.Glob("**/*.{ts,tsx}").scan({ cwd: import.meta.dir }))
    const hits = (
      await Promise.all(
        files.map(async (file) => {
          const source = await Bun.file(path.join(import.meta.dir, file)).text()
          return [...source.matchAll(mappedRadius())].map((match) => `${file}:${match.index}`)
        }),
      )
    ).flat()
    expect(hits).toEqual([])
  }, 15_000)
})
