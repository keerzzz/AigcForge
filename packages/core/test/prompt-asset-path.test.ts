import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { FSUtil } from "@aigcfroge/core/fs-util"
import {
  PathValidationError,
  isValidSegment,
  nameToRelativePath,
  resolveOwnerRoot,
  resolveSafeTarget,
  validateRelativePath,
} from "../src/prompt-asset/path"
import { it } from "./lib/effect"

describe("isValidSegment", () => {
  test("accepts valid names", () => {
    expect(isValidSegment("hello")).toBe(true)
    expect(isValidSegment("my-prompt")).toBe(true)
    expect(isValidSegment("my_prompt")).toBe(true)
    expect(isValidSegment("a")).toBe(true)
    expect(isValidSegment("123")).toBe(true)
  })

  test("accepts Chinese names", () => {
    expect(isValidSegment("提示词模板")).toBe(true)
    expect(isValidSegment("我的提示词")).toBe(true)
  })

  test("rejects empty, dot, dotdot", () => {
    expect(isValidSegment("")).toBe(false)
    expect(isValidSegment(".")).toBe(false)
    expect(isValidSegment("..")).toBe(false)
  })

  test("rejects control characters", () => {
    expect(isValidSegment("bad\x00name")).toBe(false)
    expect(isValidSegment("bad\x1Fname")).toBe(false)
    expect(isValidSegment("bad\x7Fname")).toBe(false)
  })

  test("rejects Windows reserved characters", () => {
    expect(isValidSegment("bad<name")).toBe(false)
    expect(isValidSegment("bad>name")).toBe(false)
    expect(isValidSegment("bad:name")).toBe(false)
    expect(isValidSegment('bad"name')).toBe(false)
    expect(isValidSegment("bad/name")).toBe(false)
    expect(isValidSegment("bad\\name")).toBe(false)
    expect(isValidSegment("bad|name")).toBe(false)
    expect(isValidSegment("bad?name")).toBe(false)
    expect(isValidSegment("bad*name")).toBe(false)
  })

  test("rejects leading/trailing spaces and trailing dot", () => {
    expect(isValidSegment(" leading")).toBe(false)
    expect(isValidSegment("trailing ")).toBe(false)
    expect(isValidSegment("trailing.")).toBe(false)
  })

  test("rejects segments exceeding 100 UTF-8 bytes", () => {
    expect(isValidSegment("a".repeat(101))).toBe(false)
    expect(isValidSegment("a".repeat(100))).toBe(true)
  })
})

describe("validateRelativePath", () => {
  test("accepts valid .md paths", () => {
    expect(validateRelativePath("test.md")).toBe("test.md")
    expect(validateRelativePath("nested/test.md")).toBe("nested/test.md")
    expect(validateRelativePath("中文/提示词.md")).toBe("中文/提示词.md")
  })

  test("rejects empty path", () => {
    expect(() => validateRelativePath("")).toThrow(PathValidationError)
  })

  test("rejects absolute path", () => {
    expect(() => validateRelativePath("/etc/test.md")).toThrow(PathValidationError)
  })

  test("rejects non-.md extension", () => {
    expect(() => validateRelativePath("test.txt")).toThrow(PathValidationError)
    expect(() => validateRelativePath("test")).toThrow(PathValidationError)
  })

  test("rejects path with invalid segments", () => {
    expect(() => validateRelativePath("../escape.md")).toThrow(PathValidationError)
    expect(() => validateRelativePath("a/../b.md")).toThrow(PathValidationError)
    expect(() => validateRelativePath("a/<bad>.md")).toThrow(PathValidationError)
  })

  test("normalizes backslashes", () => {
    expect(validateRelativePath("nested\\test.md")).toBe("nested/test.md")
  })

  test("rejects path exceeding 240 UTF-8 bytes", () => {
    const longName = "a".repeat(238) + ".md"
    expect(longName.length).toBeGreaterThan(240)
    expect(() => validateRelativePath(longName)).toThrow(PathValidationError)
  })
})

describe("nameToRelativePath", () => {
  test("generates default path", () => {
    expect(nameToRelativePath("my-prompt")).toBe(".aigcfroge/prompts/my-prompt.md")
  })

  test("generates path for Chinese name", () => {
    expect(nameToRelativePath("提示词模板")).toBe(".aigcfroge/prompts/提示词模板.md")
  })

  test("NFKC normalizes unicode", () => {
    expect(nameToRelativePath("ｈello")).toBe(".aigcfroge/prompts/hello.md")
  })

  test("trims whitespace", () => {
    expect(nameToRelativePath("  hello  ")).toBe(".aigcfroge/prompts/hello.md")
  })

  test("rejects invalid name", () => {
    expect(() => nameToRelativePath("")).toThrow(PathValidationError)
    expect(() => nameToRelativePath("../bad")).toThrow(PathValidationError)
    expect(() => nameToRelativePath("a<b")).toThrow(PathValidationError)
  })
})

describe("resolveOwnerRoot", () => {
  test("computes owner root from directory", () => {
    expect(resolveOwnerRoot("/home/user/project")).toBe("/home/user/project/.aigcfroge/prompts")
  })
})

describe("resolveSafeTarget", () => {
  const testLayer = FSUtil.defaultLayer

  it.live("resolves a target inside owner root", () =>
    Effect.gen(function* () {
      const fsu = yield* FSUtil.Service
      const result = yield* resolveSafeTarget("/tmp", "test.md", fsu)
      expect(result.lexical).toBe("/tmp/.aigcfroge/prompts/test.md")
    }).pipe(Effect.provide(testLayer)),
  )

  it.live("rejects path outside owner root", () =>
    Effect.gen(function* () {
      const fsu = yield* FSUtil.Service
      const result = yield* resolveSafeTarget("/tmp", "../../../etc/passwd.md", fsu).pipe(Effect.flip)
      expect(result).toBeInstanceOf(PathValidationError)
    }).pipe(Effect.provide(testLayer)),
  )
})
