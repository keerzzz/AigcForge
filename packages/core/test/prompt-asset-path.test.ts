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
import { PromptAssetPath } from "../src/prompt-asset/path"
import { it } from "./lib/effect"

describe("PromptAssetPath.isValidSegment", () => {
  test("accepts valid names", () => {
    expect(PromptAssetPath.isValidSegment("hello")).toBe(true)
    expect(PromptAssetPath.isValidSegment("my-prompt")).toBe(true)
    expect(PromptAssetPath.isValidSegment("my_prompt")).toBe(true)
    expect(PromptAssetPath.isValidSegment("a")).toBe(true)
    expect(PromptAssetPath.isValidSegment("123")).toBe(true)
  })

  test("accepts Chinese names", () => {
    expect(PromptAssetPath.isValidSegment("提示词模板")).toBe(true)
    expect(PromptAssetPath.isValidSegment("我的提示词")).toBe(true)
  })

  test("rejects empty, dot, dotdot", () => {
    expect(PromptAssetPath.isValidSegment("")).toBe(false)
    expect(PromptAssetPath.isValidSegment(".")).toBe(false)
    expect(PromptAssetPath.isValidSegment("..")).toBe(false)
  })

  test("rejects control characters", () => {
    expect(PromptAssetPath.isValidSegment("bad\x00name")).toBe(false)
    expect(PromptAssetPath.isValidSegment("bad\x1Fname")).toBe(false)
    expect(PromptAssetPath.isValidSegment("bad\x7Fname")).toBe(false)
  })

  test("rejects Windows reserved characters", () => {
    expect(PromptAssetPath.isValidSegment("bad<name")).toBe(false)
    expect(PromptAssetPath.isValidSegment("bad>name")).toBe(false)
    expect(PromptAssetPath.isValidSegment("bad:name")).toBe(false)
    expect(PromptAssetPath.isValidSegment('bad"name')).toBe(false)
    expect(PromptAssetPath.isValidSegment("bad/name")).toBe(false)
    expect(PromptAssetPath.isValidSegment("bad\\name")).toBe(false)
    expect(PromptAssetPath.isValidSegment("bad|name")).toBe(false)
    expect(PromptAssetPath.isValidSegment("bad?name")).toBe(false)
    expect(PromptAssetPath.isValidSegment("bad*name")).toBe(false)
  })

  test("rejects leading/trailing spaces and trailing dot", () => {
    expect(PromptAssetPath.isValidSegment(" leading")).toBe(false)
    expect(PromptAssetPath.isValidSegment("trailing ")).toBe(false)
    expect(PromptAssetPath.isValidSegment("trailing.")).toBe(false)
  })

  test("rejects segments exceeding 100 UTF-8 bytes", () => {
    expect(PromptAssetPath.isValidSegment("a".repeat(101))).toBe(false)
    expect(PromptAssetPath.isValidSegment("a".repeat(100))).toBe(true)
  })
})

describe("PromptAssetPath.validateRelativePath", () => {
  test("accepts valid .md paths", () => {
    expect(PromptAssetPath.validateRelativePath("test.md")).toBe("test.md")
    expect(PromptAssetPath.validateRelativePath("nested/test.md")).toBe("nested/test.md")
    expect(PromptAssetPath.validateRelativePath("中文/提示词.md")).toBe("中文/提示词.md")
  })

  test("rejects empty path", () => {
    expect(() => PromptAssetPath.validateRelativePath("")).toThrow(PromptAssetPath.PathValidationError)
  })

  test("rejects absolute path", () => {
    expect(() => PromptAssetPath.validateRelativePath("/etc/test.md")).toThrow(PromptAssetPath.PathValidationError)
  })

  test("rejects non-.md extension", () => {
    expect(() => PromptAssetPath.validateRelativePath("test.txt")).toThrow(PromptAssetPath.PathValidationError)
    expect(() => PromptAssetPath.validateRelativePath("test")).toThrow(PromptAssetPath.PathValidationError)
  })

  test("rejects path with invalid segments", () => {
    expect(() => PromptAssetPath.validateRelativePath("../escape.md")).toThrow(PromptAssetPath.PathValidationError)
    expect(() => PromptAssetPath.validateRelativePath("a/../b.md")).toThrow(PromptAssetPath.PathValidationError)
    expect(() => PromptAssetPath.validateRelativePath("a/<bad>.md")).toThrow(PromptAssetPath.PathValidationError)
  })

  test("normalizes backslashes", () => {
    expect(PromptAssetPath.validateRelativePath("nested\\test.md")).toBe("nested/test.md")
  })

  test("rejects path exceeding 240 UTF-8 bytes", () => {
    const longName = "a".repeat(238) + ".md"
    expect(longName.length).toBeGreaterThan(240)
    expect(() => PromptAssetPath.validateRelativePath(longName)).toThrow(PromptAssetPath.PathValidationError)
  })
})

describe("PromptAssetPath.nameToRelativePath", () => {
  test("generates default path", () => {
    expect(PromptAssetPath.nameToRelativePath("my-prompt")).toBe(".aigcfroge/prompts/my-prompt.md")
  })

  test("generates path for Chinese name", () => {
    expect(PromptAssetPath.nameToRelativePath("提示词模板")).toBe(".aigcfroge/prompts/提示词模板.md")
  })

  test("NFKC normalizes unicode", () => {
    expect(PromptAssetPath.nameToRelativePath("ｈello")).toBe(".aigcfroge/prompts/hello.md")
  })

  test("trims whitespace", () => {
    expect(PromptAssetPath.nameToRelativePath("  hello  ")).toBe(".aigcfroge/prompts/hello.md")
  })

  test("rejects invalid name", () => {
    expect(() => PromptAssetPath.nameToRelativePath("")).toThrow(PromptAssetPath.PathValidationError)
    expect(() => PromptAssetPath.nameToRelativePath("../bad")).toThrow(PromptAssetPath.PathValidationError)
    expect(() => PromptAssetPath.nameToRelativePath("a<b")).toThrow(PromptAssetPath.PathValidationError)
  })
})

describe("PromptAssetPath.resolveOwnerRoot", () => {
  test("computes owner root from directory", () => {
    if (process.platform === "win32") return
    expect(PromptAssetPath.resolveOwnerRoot("/home/user/project")).toBe("/home/user/project/.aigcfroge/prompts")
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

describe("PromptAssetPath.resolveSafeTarget", () => {
  it.live("resolves a target inside owner root", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return
      const mutation = yield* LocationMutation.Service
      const result = yield* PromptAssetPath.resolveSafeTarget("test.md", mutation)
      expect(result.canonical).toBe("/tmp/.aigcfroge/prompts/test.md")
    }).pipe(Effect.provide(mutationLayer("/tmp"))),
  )

  it.live("rejects path outside owner root", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return
      const mutation = yield* LocationMutation.Service
      const result = yield* PromptAssetPath.resolveSafeTarget("../../../etc/passwd.md", mutation).pipe(Effect.flip)
      expect(result).toBeInstanceOf(PromptAssetPath.PathValidationError)
    }).pipe(Effect.provide(mutationLayer("/tmp"))),
  )

  test("rejects a prompt root symlink redirected elsewhere in the Location", async () => {
    if (process.platform === "win32") return
    const tmp = await tmpdir()
    try {
      await fs.mkdir(path.join(tmp.path, ".aigcfroge"), { recursive: true })
      await fs.mkdir(path.join(tmp.path, "elsewhere"), { recursive: true })
      await fs.symlink(path.join(tmp.path, "elsewhere"), path.join(tmp.path, ".aigcfroge", "prompts"))

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const mutation = yield* LocationMutation.Service
          return yield* PromptAssetPath.resolveSafeTarget("test.md", mutation).pipe(Effect.flip)
        }).pipe(Effect.provide(mutationLayer(tmp.path))),
      )
      expect(result).toBeInstanceOf(PromptAssetPath.PathValidationError)
    } finally {
      await tmp[Symbol.asyncDispose]()
    }
  })
})
