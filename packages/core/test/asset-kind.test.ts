import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { AssetKind } from "../src/asset-kind"
import { it } from "./lib/effect"

describe("AssetKindRegistry", () => {
  it.effect("registers and resolves a kind", () =>
    Effect.gen(function* () {
      const reg = yield* AssetKind.Service
      yield* reg.register({
        id: "skill",
        schema: { Summary: null as any, Info: null as any },
        ownerDir: ".aigcfroge/skills",
      })
      const d = yield* reg.resolve("skill")
      expect(d.id).toBe("skill")
      expect(d.ownerDir).toBe(".aigcfroge/skills")
    }).pipe(Effect.provide(AssetKind.layer)),
  )

  it.effect("fails with unknown_kind for unregistered", () =>
    Effect.gen(function* () {
      const reg = yield* AssetKind.Service
      const result = yield* reg.resolve("bogus").pipe(Effect.flip)
      expect(result.reason).toBe("unknown_kind")
    }).pipe(Effect.provide(AssetKind.layer)),
  )

  it.effect("lists registered kinds", () =>
    Effect.gen(function* () {
      const reg = yield* AssetKind.Service
      yield* reg.register({
        id: "skill",
        schema: { Summary: null as any, Info: null as any },
        ownerDir: ".aigcfroge/skills",
      })
      expect(reg.list()).toContain("skill")
    }).pipe(Effect.provide(AssetKind.layer)),
  )
})
