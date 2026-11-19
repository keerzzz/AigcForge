import { describe, expect, test } from "bun:test"
import path from "path"

// S2 connection guard, source-level half. The only way to end up with two
// SQLite connections in one graph is a second `Database.Service` layer
// implementation; layer identity already collapses every shared layer object
// for the same file, so the invariant is pinned here, at the source.
// `database.ts` builds the one real layer with an unqualified
// `Layer.effect(Service, …)`, which no other module can write — anywhere else
// it has to name `Database.Service`, and that is what this looks for.
//
// The fork's runtime halves (batch-with-projectors against a real file, the
// temp-table marker discriminator) exercised its `EventV2.publishBatch`
// pipeline; v2's bus commit contract and session inbox projection are covered
// by `bus.test.ts` / `bus-session-routing.test.ts`, so only this guard ports.
describe("S2 connection guard (source-level)", () => {
  test("no module builds its own Database.Service layer", async () => {
    const glob = new Bun.Glob("packages/*/src/**/*.ts")
    const root = path.resolve(import.meta.dir, "../../..")
    const construction = /Layer\.(?:effect|succeed|sync|scoped)\(\s*Database\.Service/
    const offenders: string[] = []
    for await (const relative of glob.scan({ cwd: root })) {
      const text = await Bun.file(path.join(root, relative)).text()
      if (construction.test(text)) offenders.push(relative)
    }
    expect(offenders).toEqual([])
  })
})
