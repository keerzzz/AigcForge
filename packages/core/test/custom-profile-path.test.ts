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
import { CustomProfilePath } from "../src/custom-profile/path"
import { it } from "./lib/effect"

const nonWindowsIt = process.platform === "win32" ? it.live.skip : it.live
const nonWindowsTest = process.platform === "win32" ? test.skip : test

describe("CustomProfilePath.isValidSegment", () => {
  test("accepts valid names", () => {
    expect(CustomProfilePath.isValidSegment("hello")).toBe(true)
    expect(CustomProfilePath.isValidSegment("my-profile")).toBe(true)
    expect(CustomProfilePath.isValidSegment("my_profile")).toBe(true)
    expect(CustomProfilePath.isValidSegment("a")).toBe(true)
    expect(CustomProfilePath.isValidSegment("123")).toBe(true)
  })

  test("accepts Chinese names", () => {
    expect(CustomProfilePath.isValidSegment("自定义配置")).toBe(true)
    expect(CustomProfilePath.isValidSegment("前端开发配置")).toBe(true)
  })

  test("rejects empty, dot, dotdot", () => {
    expect(CustomProfilePath.isValidSegment("")).toBe(false)
    expect(CustomProfilePath.isValidSegment(".")).toBe(false)
    expect(CustomProfilePath.isValidSegment("..")).toBe(false)
  })

  test("rejects control characters", () => {
    expect(CustomProfilePath.isValidSegment("bad\x00name")).toBe(false)
    expect(CustomProfilePath.isValidSegment("bad\x1Fname")).toBe(false)
    expect(CustomProfilePath.isValidSegment("bad\x7Fname")).toBe(false)
  })

  test("rejects Windows reserved characters", () => {
    expect(CustomProfilePath.isValidSegment("bad<name")).toBe(false)
    expect(CustomProfilePath.isValidSegment("bad>name")).toBe(false)
    expect(CustomProfilePath.isValidSegment("bad:name")).toBe(false)
    expect(CustomProfilePath.isValidSegment('bad"name')).toBe(false)
    expect(CustomProfilePath.isValidSegment("bad/name")).toBe(false)
    expect(CustomProfilePath.isValidSegment("bad\\name")).toBe(false)
    expect(CustomProfilePath.isValidSegment("bad|name")).toBe(false)
    expect(CustomProfilePath.isValidSegment("bad?name")).toBe(false)
    expect(CustomProfilePath.isValidSegment("bad*name")).toBe(false)
  })

  test("rejects leading/trailing spaces and trailing dot", () => {
    expect(CustomProfilePath.isValidSegment(" leading")).toBe(false)
    expect(CustomProfilePath.isValidSegment("trailing ")).toBe(false)
    expect(CustomProfilePath.isValidSegment("trailing.")).toBe(false)
  })

  test("rejects segments exceeding 240 UTF-8 bytes", () => {
    expect(CustomProfilePath.isValidSegment("a".repeat(241))).toBe(false)
    expect(CustomProfilePath.isValidSegment("a".repeat(240))).toBe(true)
  })
})

describe("CustomProfilePath.validateRelativePath", () => {
  test("accepts valid .yaml paths", () => {
    expect(CustomProfilePath.validateRelativePath("test.yaml")).toBe("test.yaml")
    expect(CustomProfilePath.validateRelativePath("nested/test.yaml")).toBe("nested/test.yaml")
    expect(CustomProfilePath.validateRelativePath("中文/配置.yaml")).toBe("中文/配置.yaml")
  })

  test("rejects empty path", () => {
    expect(() => CustomProfilePath.validateRelativePath("")).toThrow(CustomProfilePath.PathValidationError)
  })

  test("rejects absolute path", () => {
    expect(() => CustomProfilePath.validateRelativePath("/etc/test.yaml")).toThrow(CustomProfilePath.PathValidationError)
  })

  test("rejects non-.yaml extension", () => {
    expect(() => CustomProfilePath.validateRelativePath("test.txt")).toThrow(CustomProfilePath.PathValidationError)
    expect(() => CustomProfilePath.validateRelativePath("test.md")).toThrow(CustomProfilePath.PathValidationError)
    expect(() => CustomProfilePath.validateRelativePath("test")).toThrow(CustomProfilePath.PathValidationError)
  })

  test("rejects path with invalid segments", () => {
    expect(() => CustomProfilePath.validateRelativePath("../escape.yaml")).toThrow(CustomProfilePath.PathValidationError)
    expect(() => CustomProfilePath.validateRelativePath("a/../b.yaml")).toThrow(CustomProfilePath.PathValidationError)
    expect(() => CustomProfilePath.validateRelativePath("a/<bad>.yaml")).toThrow(CustomProfilePath.PathValidationError)
  })

  test("normalizes backslashes", () => {
    expect(CustomProfilePath.validateRelativePath("nested\\test.yaml")).toBe("nested/test.yaml")
  })

  test("rejects path exceeding 500 UTF-8 bytes", () => {
    const longName = "a/".repeat(200) + "a".repeat(99) + ".yaml"
    expect(() => CustomProfilePath.validateRelativePath(longName)).toThrow(CustomProfilePath.PathValidationError)
  })
})

describe("CustomProfilePath.nameToRelativePath", () => {
  test("generates default path", () => {
    expect(CustomProfilePath.nameToRelativePath("my-profile")).toBe(".aigcfroge/custom-profiles/my-profile.yaml")
  })

  test("generates path for Chinese name", () => {
    expect(CustomProfilePath.nameToRelativePath("前端开发配置")).toBe(".aigcfroge/custom-profiles/前端开发配置.yaml")
  })

  test("NFKC normalizes unicode", () => {
    expect(CustomProfilePath.nameToRelativePath("ｈello")).toBe(".aigcfroge/custom-profiles/hello.yaml")
  })

  test("trims whitespace", () => {
    expect(CustomProfilePath.nameToRelativePath("  hello  ")).toBe(".aigcfroge/custom-profiles/hello.yaml")
  })

  test("rejects invalid name", () => {
    expect(() => CustomProfilePath.nameToRelativePath("")).toThrow(CustomProfilePath.PathValidationError)
    expect(() => CustomProfilePath.nameToRelativePath("../bad")).toThrow(CustomProfilePath.PathValidationError)
    expect(() => CustomProfilePath.nameToRelativePath("a<b")).toThrow(CustomProfilePath.PathValidationError)
  })
})

describe("CustomProfilePath.resolveOwnerRoot", () => {
  nonWindowsTest("computes owner root from directory", () => {
    expect(CustomProfilePath.resolveOwnerRoot("/home/user/project")).toBe(
      "/home/user/project/.aigcfroge/custom-profiles",
    )
  })
})

function mutationLayer(directory: string) {
  return LocationMutation.locationLayer.pipe(
    Layer.provide(
      Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
    ),
    Layer.provide(FSUtil.defaultLayer),
  )
}

describe("CustomProfilePath.resolveSafeTarget", () => {
  nonWindowsIt("resolves a target inside owner root", () =>
    Effect.gen(function* () {
      const mutation = yield* LocationMutation.Service
      const result = yield* CustomProfilePath.resolveSafeTarget("test.yaml", mutation)
      expect(result.canonical).toBe("/tmp/.aigcfroge/custom-profiles/test.yaml")
    }).pipe(Effect.provide(mutationLayer("/tmp"))),
  )

  nonWindowsIt("rejects path outside owner root", () =>
    Effect.gen(function* () {
      const mutation = yield* LocationMutation.Service
      const result = yield* CustomProfilePath.resolveSafeTarget("../../../etc/passwd.yaml", mutation).pipe(Effect.flip)
      expect(result).toBeInstanceOf(CustomProfilePath.PathValidationError)
    }).pipe(Effect.provide(mutationLayer("/tmp"))),
  )

  nonWindowsTest("rejects a custom-profiles root symlink redirected elsewhere in the Location", async () => {
    const tmp = await tmpdir()
    try {
      await fs.mkdir(path.join(tmp.path, ".aigcfroge"), { recursive: true })
      await fs.mkdir(path.join(tmp.path, "elsewhere"), { recursive: true })
      await fs.symlink(path.join(tmp.path, "elsewhere"), path.join(tmp.path, ".aigcfroge", "custom-profiles"))

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const mutation = yield* LocationMutation.Service
          return yield* CustomProfilePath.resolveSafeTarget("test.yaml", mutation).pipe(Effect.flip)
        }).pipe(Effect.provide(mutationLayer(tmp.path))),
      )
      expect(result).toBeInstanceOf(CustomProfilePath.PathValidationError)
    } finally {
      await tmp[Symbol.asyncDispose]()
    }
  })
})

describe("CustomProfile name 约束跨层一致性", () => {
  const cjk80 = "工".repeat(80)

  test("80 个汉字 = 80 code points，落在 schema 上限内", () => {
    expect(Array.from(cjk80).length).toBe(80)
  })

  test("80 个汉字 = 240 UTF-8 bytes，恰好等于 SEGMENT_MAX_BYTES", () => {
    expect(new TextEncoder().encode(cjk80).length).toBe(CustomProfilePath.SEGMENT_MAX_BYTES)
  })

  test("80 个汉字的 name 能通过路径层", () => {
    expect(CustomProfilePath.isValidSegment(cjk80)).toBe(true)
    expect(() => CustomProfilePath.nameToRelativePath(cjk80)).not.toThrow()
  })

  test("81 个汉字被路径层拒绝", () => {
    const cjk81 = "工".repeat(81)
    expect(Array.from(cjk81).length).toBeGreaterThan(80)
    expect(CustomProfilePath.isValidSegment(cjk81)).toBe(false)
  })

  test("80 汉字生成的 relativePath 仍在 PATH_MAX_BYTES 之内", () => {
    const rel = CustomProfilePath.nameToRelativePath(cjk80)
    expect(new TextEncoder().encode(rel).length).toBeLessThanOrEqual(CustomProfilePath.PATH_MAX_BYTES)
  })
})
