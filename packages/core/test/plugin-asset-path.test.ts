import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { LocationMutation } from "@aigcfroge/core/location-mutation"
import { Location } from "@aigcfroge/core/location"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import fs from "fs/promises"
import path from "path"
import { PluginAssetPath } from "../src/plugin-asset/path"
import { it } from "./lib/effect"

describe("PluginAssetPath.isValidSegment", () => {
  test("accepts valid names", () => {
    expect(PluginAssetPath.isValidSegment("hello")).toBe(true)
    expect(PluginAssetPath.isValidSegment("code-review")).toBe(true)
    expect(PluginAssetPath.isValidSegment("my_plugin")).toBe(true)
    expect(PluginAssetPath.isValidSegment("a")).toBe(true)
    expect(PluginAssetPath.isValidSegment("123")).toBe(true)
  })

  test("accepts Chinese names", () => {
    expect(PluginAssetPath.isValidSegment("插件模板")).toBe(true)
    expect(PluginAssetPath.isValidSegment("我的插件")).toBe(true)
  })

  test("rejects empty, dot, dotdot", () => {
    expect(PluginAssetPath.isValidSegment("")).toBe(false)
    expect(PluginAssetPath.isValidSegment(".")).toBe(false)
    expect(PluginAssetPath.isValidSegment("..")).toBe(false)
  })

  test("rejects control characters", () => {
    expect(PluginAssetPath.isValidSegment("bad\x00name")).toBe(false)
    expect(PluginAssetPath.isValidSegment("bad\x1Fname")).toBe(false)
    expect(PluginAssetPath.isValidSegment("bad\x7Fname")).toBe(false)
  })

  test("rejects Windows reserved characters", () => {
    expect(PluginAssetPath.isValidSegment("bad<name")).toBe(false)
    expect(PluginAssetPath.isValidSegment("bad>name")).toBe(false)
    expect(PluginAssetPath.isValidSegment("bad:name")).toBe(false)
    expect(PluginAssetPath.isValidSegment('bad"name')).toBe(false)
    expect(PluginAssetPath.isValidSegment("bad/name")).toBe(false)
    expect(PluginAssetPath.isValidSegment("bad\\name")).toBe(false)
    expect(PluginAssetPath.isValidSegment("bad|name")).toBe(false)
    expect(PluginAssetPath.isValidSegment("bad?name")).toBe(false)
    expect(PluginAssetPath.isValidSegment("bad*name")).toBe(false)
  })

  test("rejects leading/trailing spaces and trailing dot", () => {
    expect(PluginAssetPath.isValidSegment(" leading")).toBe(false)
    expect(PluginAssetPath.isValidSegment("trailing ")).toBe(false)
    expect(PluginAssetPath.isValidSegment("trailing.")).toBe(false)
  })

  test("rejects segments exceeding 100 UTF-8 bytes", () => {
    expect(PluginAssetPath.isValidSegment("a".repeat(101))).toBe(false)
    expect(PluginAssetPath.isValidSegment("a".repeat(100))).toBe(true)
  })
})

describe("PluginAssetPath.validateRelativePath", () => {
  test("accepts valid .plugin.yaml paths", () => {
    expect(PluginAssetPath.validateRelativePath("test.plugin.yaml")).toBe("test.plugin.yaml")
    expect(PluginAssetPath.validateRelativePath("nested/test.plugin.yaml")).toBe("nested/test.plugin.yaml")
    expect(PluginAssetPath.validateRelativePath("中文/插件.plugin.yaml")).toBe("中文/插件.plugin.yaml")
  })

  test("rejects non-.plugin.yaml extension", () => {
    expect(() => PluginAssetPath.validateRelativePath("test.yaml")).toThrow(PluginAssetPath.PathValidationError)
    expect(() => PluginAssetPath.validateRelativePath("test.md")).toThrow(PluginAssetPath.PathValidationError)
    expect(() => PluginAssetPath.validateRelativePath("test")).toThrow(PluginAssetPath.PathValidationError)
  })

  test("rejects empty path", () => {
    expect(() => PluginAssetPath.validateRelativePath("")).toThrow(PluginAssetPath.PathValidationError)
  })

  test("rejects absolute path", () => {
    expect(() => PluginAssetPath.validateRelativePath("/etc/test.plugin.yaml")).toThrow(PluginAssetPath.PathValidationError)
  })

  test("rejects path with invalid segments", () => {
    expect(() => PluginAssetPath.validateRelativePath("../escape.plugin.yaml")).toThrow(PluginAssetPath.PathValidationError)
    expect(() => PluginAssetPath.validateRelativePath("a/../b.plugin.yaml")).toThrow(PluginAssetPath.PathValidationError)
    expect(() => PluginAssetPath.validateRelativePath("a/<bad>.plugin.yaml")).toThrow(PluginAssetPath.PathValidationError)
  })

  test("normalizes backslashes", () => {
    expect(PluginAssetPath.validateRelativePath("nested\\test.plugin.yaml")).toBe("nested/test.plugin.yaml")
  })

  test("rejects path exceeding 240 UTF-8 bytes", () => {
    const longName = "a".repeat(226) + ".plugin.yaml"
    expect(() => PluginAssetPath.validateRelativePath(longName)).toThrow(PluginAssetPath.PathValidationError)
  })
})

describe("PluginAssetPath.nameToRelativePath", () => {
  test("uses .aigcfroge/plugins/ prefix with .plugin.yaml extension", () => {
    expect(PluginAssetPath.nameToRelativePath("code-review")).toBe(".aigcfroge/plugins/code-review.plugin.yaml")
  })

  test("handles Chinese name", () => {
    expect(PluginAssetPath.nameToRelativePath("插件")).toBe(".aigcfroge/plugins/插件.plugin.yaml")
  })

  test("NFKC normalizes unicode", () => {
    expect(PluginAssetPath.nameToRelativePath("ｈello")).toBe(".aigcfroge/plugins/hello.plugin.yaml")
  })

  test("trims whitespace", () => {
    expect(PluginAssetPath.nameToRelativePath("  hi  ")).toBe(".aigcfroge/plugins/hi.plugin.yaml")
  })

  test("rejects invalid name", () => {
    expect(() => PluginAssetPath.nameToRelativePath("")).toThrow(PluginAssetPath.PathValidationError)
    expect(() => PluginAssetPath.nameToRelativePath("../bad")).toThrow(PluginAssetPath.PathValidationError)
    expect(() => PluginAssetPath.nameToRelativePath("a<b")).toThrow(PluginAssetPath.PathValidationError)
  })
})

describe("PluginAssetPath.resolveOwnerRoot", () => {
  test("computes owner root from directory", () => {
    if (process.platform === "win32") return
    expect(PluginAssetPath.resolveOwnerRoot("/home/user/project")).toBe("/home/user/project/.aigcfroge/plugins")
  })
})

function mutationLayer(directory: string) {
  return LocationMutation.locationLayer.pipe(
    Layer.provide(
      Layer.succeed(
        Location.Service,
        Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
      ),
    ),
    Layer.provide(FSUtil.defaultLayer),
  )
}

describe("PluginAssetPath.resolveSafeTarget", () => {
  if (process.platform === "win32") {
    it.live.skip("resolves a target inside owner root", Effect.void)
    it.live.skip("rejects path outside owner root", Effect.void)
    test.skip("rejects a plugin root symlink redirected elsewhere in the Location", () => {})
  } else {
    it.live("resolves a target inside owner root", () =>
      Effect.gen(function* () {
        const mutation = yield* LocationMutation.Service
        const result = yield* PluginAssetPath.resolveSafeTarget("test.plugin.yaml", mutation)
        expect(result.canonical).toBe("/tmp/.aigcfroge/plugins/test.plugin.yaml")
      }).pipe(Effect.provide(mutationLayer("/tmp"))),
    )

    it.live("rejects path outside owner root", () =>
      Effect.gen(function* () {
        const mutation = yield* LocationMutation.Service
        const result = yield* PluginAssetPath.resolveSafeTarget("../../../etc/passwd.plugin.yaml", mutation).pipe(Effect.flip)
        expect(result).toBeInstanceOf(PluginAssetPath.PathValidationError)
      }).pipe(Effect.provide(mutationLayer("/tmp"))),
    )

    test("rejects a plugin root symlink redirected elsewhere in the Location", async () => {
      const tmp = await tmpdir()
      try {
        await fs.mkdir(path.join(tmp.path, ".aigcfroge"), { recursive: true })
        await fs.mkdir(path.join(tmp.path, "elsewhere"), { recursive: true })
        await fs.symlink(path.join(tmp.path, "elsewhere"), path.join(tmp.path, ".aigcfroge", "plugins"))

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const mutation = yield* LocationMutation.Service
            return yield* PluginAssetPath.resolveSafeTarget("test.plugin.yaml", mutation).pipe(Effect.flip)
          }).pipe(Effect.provide(mutationLayer(tmp.path))),
        )
        expect(result).toBeInstanceOf(PluginAssetPath.PathValidationError)
      } finally {
        await tmp[Symbol.asyncDispose]()
      }
    })
  }
})
