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
import { WorkflowAssetPath } from "../src/workflow-asset/path"
import { it } from "./lib/effect"

describe("WorkflowAssetPath.isValidSegment", () => {
  test("accepts valid names", () => {
    expect(WorkflowAssetPath.isValidSegment("hello")).toBe(true)
    expect(WorkflowAssetPath.isValidSegment("code-review")).toBe(true)
    expect(WorkflowAssetPath.isValidSegment("my_workflow")).toBe(true)
    expect(WorkflowAssetPath.isValidSegment("a")).toBe(true)
    expect(WorkflowAssetPath.isValidSegment("123")).toBe(true)
  })

  test("accepts Chinese names", () => {
    expect(WorkflowAssetPath.isValidSegment("工作流模板")).toBe(true)
    expect(WorkflowAssetPath.isValidSegment("我的工作流")).toBe(true)
  })

  test("rejects empty, dot, dotdot", () => {
    expect(WorkflowAssetPath.isValidSegment("")).toBe(false)
    expect(WorkflowAssetPath.isValidSegment(".")).toBe(false)
    expect(WorkflowAssetPath.isValidSegment("..")).toBe(false)
  })

  test("rejects control characters", () => {
    expect(WorkflowAssetPath.isValidSegment("bad\x00name")).toBe(false)
    expect(WorkflowAssetPath.isValidSegment("bad\x1Fname")).toBe(false)
    expect(WorkflowAssetPath.isValidSegment("bad\x7Fname")).toBe(false)
  })

  test("rejects Windows reserved characters", () => {
    expect(WorkflowAssetPath.isValidSegment("bad<name")).toBe(false)
    expect(WorkflowAssetPath.isValidSegment("bad>name")).toBe(false)
    expect(WorkflowAssetPath.isValidSegment("bad:name")).toBe(false)
    expect(WorkflowAssetPath.isValidSegment('bad"name')).toBe(false)
    expect(WorkflowAssetPath.isValidSegment("bad/name")).toBe(false)
    expect(WorkflowAssetPath.isValidSegment("bad\\name")).toBe(false)
    expect(WorkflowAssetPath.isValidSegment("bad|name")).toBe(false)
    expect(WorkflowAssetPath.isValidSegment("bad?name")).toBe(false)
    expect(WorkflowAssetPath.isValidSegment("bad*name")).toBe(false)
  })

  test("rejects leading/trailing spaces and trailing dot", () => {
    expect(WorkflowAssetPath.isValidSegment(" leading")).toBe(false)
    expect(WorkflowAssetPath.isValidSegment("trailing ")).toBe(false)
    expect(WorkflowAssetPath.isValidSegment("trailing.")).toBe(false)
  })

  test("rejects segments exceeding 100 UTF-8 bytes", () => {
    expect(WorkflowAssetPath.isValidSegment("a".repeat(101))).toBe(false)
    expect(WorkflowAssetPath.isValidSegment("a".repeat(100))).toBe(true)
  })
})

describe("WorkflowAssetPath.validateRelativePath", () => {
  test("accepts valid .yaml paths", () => {
    expect(WorkflowAssetPath.validateRelativePath("test.yaml")).toBe("test.yaml")
    expect(WorkflowAssetPath.validateRelativePath("nested/test.yaml")).toBe("nested/test.yaml")
    expect(WorkflowAssetPath.validateRelativePath("中文/工作流.yaml")).toBe("中文/工作流.yaml")
  })

  test("rejects non-.yaml extension", () => {
    expect(() => WorkflowAssetPath.validateRelativePath("test.md")).toThrow(WorkflowAssetPath.PathValidationError)
    expect(() => WorkflowAssetPath.validateRelativePath("test.txt")).toThrow(WorkflowAssetPath.PathValidationError)
    expect(() => WorkflowAssetPath.validateRelativePath("test")).toThrow(WorkflowAssetPath.PathValidationError)
  })

  test("rejects empty path", () => {
    expect(() => WorkflowAssetPath.validateRelativePath("")).toThrow(WorkflowAssetPath.PathValidationError)
  })

  test("rejects absolute path", () => {
    expect(() => WorkflowAssetPath.validateRelativePath("/etc/test.yaml")).toThrow(WorkflowAssetPath.PathValidationError)
  })

  test("rejects path with invalid segments", () => {
    expect(() => WorkflowAssetPath.validateRelativePath("../escape.yaml")).toThrow(WorkflowAssetPath.PathValidationError)
    expect(() => WorkflowAssetPath.validateRelativePath("a/../b.yaml")).toThrow(WorkflowAssetPath.PathValidationError)
    expect(() => WorkflowAssetPath.validateRelativePath("a/<bad>.yaml")).toThrow(WorkflowAssetPath.PathValidationError)
  })

  test("normalizes backslashes", () => {
    expect(WorkflowAssetPath.validateRelativePath("nested\\test.yaml")).toBe("nested/test.yaml")
  })

  test("rejects path exceeding 240 UTF-8 bytes", () => {
    const longName = "a".repeat(238) + ".yaml"
    expect(() => WorkflowAssetPath.validateRelativePath(longName)).toThrow(WorkflowAssetPath.PathValidationError)
  })
})

describe("WorkflowAssetPath.nameToRelativePath", () => {
  test("uses .aigcfroge/workflows/ prefix with .yaml extension", () => {
    expect(WorkflowAssetPath.nameToRelativePath("code-review")).toBe(".aigcfroge/workflows/code-review.yaml")
  })

  test("handles Chinese name", () => {
    expect(WorkflowAssetPath.nameToRelativePath("工作流")).toBe(".aigcfroge/workflows/工作流.yaml")
  })

  test("NFKC normalizes unicode", () => {
    expect(WorkflowAssetPath.nameToRelativePath("ｈello")).toBe(".aigcfroge/workflows/hello.yaml")
  })

  test("trims whitespace", () => {
    expect(WorkflowAssetPath.nameToRelativePath("  hi  ")).toBe(".aigcfroge/workflows/hi.yaml")
  })

  test("rejects invalid name", () => {
    expect(() => WorkflowAssetPath.nameToRelativePath("")).toThrow(WorkflowAssetPath.PathValidationError)
    expect(() => WorkflowAssetPath.nameToRelativePath("../bad")).toThrow(WorkflowAssetPath.PathValidationError)
    expect(() => WorkflowAssetPath.nameToRelativePath("a<b")).toThrow(WorkflowAssetPath.PathValidationError)
  })
})

describe("WorkflowAssetPath.resolveOwnerRoot", () => {
  test("computes owner root from directory", () => {
    if (process.platform === "win32") return
    expect(WorkflowAssetPath.resolveOwnerRoot("/home/user/project")).toBe("/home/user/project/.aigcfroge/workflows")
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

describe("WorkflowAssetPath.resolveSafeTarget", () => {
  if (process.platform === "win32") {
    it.live.skip("resolves a target inside owner root", Effect.void)
    it.live.skip("rejects path outside owner root", Effect.void)
    test.skip("rejects a workflow root symlink redirected elsewhere in the Location", () => {})
  } else {
    it.live("resolves a target inside owner root", () =>
      Effect.gen(function* () {
        const mutation = yield* LocationMutation.Service
        const result = yield* WorkflowAssetPath.resolveSafeTarget("test.yaml", mutation)
        expect(result.canonical).toBe("/tmp/.aigcfroge/workflows/test.yaml")
      }).pipe(Effect.provide(mutationLayer("/tmp"))),
    )

    it.live("rejects path outside owner root", () =>
      Effect.gen(function* () {
        const mutation = yield* LocationMutation.Service
        const result = yield* WorkflowAssetPath.resolveSafeTarget("../../../etc/passwd.yaml", mutation).pipe(Effect.flip)
        expect(result).toBeInstanceOf(WorkflowAssetPath.PathValidationError)
      }).pipe(Effect.provide(mutationLayer("/tmp"))),
    )

    test("rejects a workflow root symlink redirected elsewhere in the Location", async () => {
      const tmp = await tmpdir()
      try {
        await fs.mkdir(path.join(tmp.path, ".aigcfroge"), { recursive: true })
        await fs.mkdir(path.join(tmp.path, "elsewhere"), { recursive: true })
        await fs.symlink(path.join(tmp.path, "elsewhere"), path.join(tmp.path, ".aigcfroge", "workflows"))

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const mutation = yield* LocationMutation.Service
            return yield* WorkflowAssetPath.resolveSafeTarget("test.yaml", mutation).pipe(Effect.flip)
          }).pipe(Effect.provide(mutationLayer(tmp.path))),
        )
        expect(result).toBeInstanceOf(WorkflowAssetPath.PathValidationError)
      } finally {
        await tmp[Symbol.asyncDispose]()
      }
    })
  }
})
