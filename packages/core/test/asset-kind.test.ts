import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Asset } from "@aigcfroge/schema/asset"
import { Schema } from "effect"
import { AssetKind } from "../src/asset-kind"
import { it } from "./lib/effect"

const testKindDef: AssetKind.AssetKindDef = {
  id: "custom-profile",
  schema: {
    Summary: Schema.Struct({ name: Schema.String }),
    Info: Schema.Struct({ name: Schema.String, content: Schema.String }),
  },
  ownerDir: ".aigcfroge/custom-profiles",
}

describe("AssetKindRegistry", () => {
  it.effect("resolves pre-registered 8 asset kinds with canonical owner directories", () =>
    Effect.gen(function* () {
      const registry = yield* AssetKind.Service
      const kinds = registry.list()
      expect(kinds).toHaveLength(8)
      expect(kinds).toEqual(
        expect.arrayContaining([
          "prompt",
          "skill",
          "mcp",
          "command",
          "agent",
          "workflow",
          "plugin",
          "custom-profile",
        ]),
      )

      const expectedDirs: ReadonlyArray<readonly [Asset.AssetKindId, string]> = [
        ["prompt", ".aigcfroge/prompts"],
        ["skill", ".aigcfroge/skills"],
        ["mcp", ".aigcfroge/mcps"],
        ["command", ".aigcfroge/commands"],
        ["agent", ".aigcfroge/agents"],
        ["workflow", ".aigcfroge/workflows"],
        ["plugin", ".aigcfroge/plugins"],
        ["custom-profile", ".aigcfroge/custom-profiles"],
      ]

      for (const [id, dir] of expectedDirs) {
        const resolved = yield* registry.resolve(id)
        expect(resolved.id).toBe(id)
        expect(resolved.ownerDir).toBe(dir)
      }
    }).pipe(Effect.provide(AssetKind.layer)),
  )

  it.effect("returns unknown_kind error for unresolved kinds", () =>
    Effect.gen(function* () {
      const registry = yield* AssetKind.Service
      const err = yield* registry.resolve("non-existent").pipe(Effect.flip)
      expect(err).toBeInstanceOf(Asset.AssetError)
      expect(err.reason).toBe("unknown_kind")
    }).pipe(Effect.provide(AssetKind.layer)),
  )

  it.effect("rejects duplicate registration with typed error instead of silent overwrite", () =>
    Effect.gen(function* () {
      const registry = yield* AssetKind.Service
      const err = yield* registry.register(testKindDef).pipe(Effect.flip)
      expect(err).toBeInstanceOf(Asset.AssetError)
      expect(err.reason).toBe("name_conflict")
      expect(err.message).toContain("Asset kind already registered")
    }).pipe(Effect.provide(AssetKind.layer)),
  )
})
