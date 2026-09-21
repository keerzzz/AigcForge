import { beforeEach, describe, expect } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "path"
import { Effect, Layer } from "effect"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { Location } from "@aigcfroge/core/location"
import { PermissionV2 } from "@aigcfroge/core/permission"
import { Ripgrep } from "@aigcfroge/core/ripgrep"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { ToolRegistry } from "@aigcfroge/core/tool/registry"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { executeTool, toolIdentity } from "./lib/tool"
// 这两个必须排在最后：tool/builtins.ts 在自己的 locationLayer 里引用
// GlobTool.layer / GrepTool.layer，先加载 glob.ts 会撞上
// "Cannot access 'layer' before initialization"。同 tool-read.test.ts 的次序。
import { GlobTool } from "@aigcfroge/core/tool/glob"
import { GrepTool } from "@aigcfroge/core/tool/grep"

// 守卫在工具内部，所以测试必须真的调用工具。只断言 FSUtil.contains 证明不了
// grep/glob 用了它 —— 把两处守卫整段删掉，那种测试照样 3 pass（已实测）。
// 判别式是 searched：越界时 ripgrep 必须**根本没被调用**，而不只是返回失败。
const root = process.cwd()
const searched: string[] = []

const ripgrep = Layer.mock(Ripgrep.Service, {
  grep: (input) =>
    Effect.sync(() => {
      searched.push(input.cwd)
      return []
    }),
  glob: (input) =>
    Effect.sync(() => {
      searched.push(input.cwd)
      return []
    }),
})
const permission = Layer.mock(PermissionV2.Service, {
  effectiveRules: () => Effect.succeed([]),
  assert: () => Effect.void,
})
const infrastructure = Layer.mergeAll(
  FSUtil.defaultLayer,
  Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(root) }))),
)
const registry = ToolRegistry.defaultLayer.pipe(Layer.provide(permission))
const tools = Layer.mergeAll(GrepTool.layer, GlobTool.layer).pipe(
  Layer.provide(registry),
  Layer.provide(ripgrep),
  Layer.provide(permission),
  Layer.provide(infrastructure),
)
const it = testEffect(Layer.mergeAll(registry, ripgrep, permission, infrastructure, tools))
const sessionID = SessionV2.ID.make("ses_tool_path_containment")

const run = (name: "grep" | "glob", input: Record<string, unknown>) =>
  Effect.gen(function* () {
    const registryService = yield* ToolRegistry.Service
    return yield* executeTool(registryService, {
      sessionID,
      ...toolIdentity,
      call: { type: "tool-call", id: `call-${name}`, name, input },
    })
  })

describe("grep/glob path containment", () => {
  beforeEach(() => {
    searched.length = 0
  })

  it.effect("grep rejects a relative path that climbs out of the Location", () =>
    Effect.gen(function* () {
      expect(yield* run("grep", { pattern: "secret", path: "../.." })).toEqual({
        type: "error",
        value: "Path escapes the allowed root: ../..",
      })
      expect(searched).toEqual([])
    }),
  )

  it.effect("grep rejects an absolute path outside the Location", () =>
    Effect.gen(function* () {
      expect(yield* run("grep", { pattern: "root:", path: "/etc" })).toEqual({
        type: "error",
        value: "Path escapes the allowed root: /etc",
      })
      expect(searched).toEqual([])
    }),
  )

  it.effect("glob rejects both escape shapes", () =>
    Effect.gen(function* () {
      expect(yield* run("glob", { pattern: "*", path: "/etc" })).toEqual({
        type: "error",
        value: "Path escapes the allowed root: /etc",
      })
      expect(yield* run("glob", { pattern: "*", path: "../.." })).toEqual({
        type: "error",
        value: "Path escapes the allowed root: ../..",
      })
      expect(searched).toEqual([])
    }),
  )

  it.live("grep and glob refuse a symlink that resolves outside the Location", () =>
    Effect.acquireUseRelease(
      Effect.promise(async () => {
        const outside = await fs.mkdtemp(path.join(os.tmpdir(), "aigcfroge-containment-"))
        const link = path.join(root, `.aigcfroge-containment-${process.pid}-${Date.now()}`)
        try {
          await fs.symlink(outside, link, "dir")
        } catch (error) {
          await fs.rm(outside, { recursive: true, force: true })
          if (typeof error === "object" && error !== null && "code" in error && error.code === "EPERM") return undefined
          throw error
        }
        return { outside, link }
      }),
      (fixture) =>
        Effect.gen(function* () {
          if (!fixture) return
          const relative = path.basename(fixture.link)
          expect(yield* run("grep", { pattern: "secret", path: relative })).toEqual({
            type: "error",
            value: `Path escapes the allowed root: ${relative}`,
          })
          expect(yield* run("glob", { pattern: "*", path: relative })).toEqual({
            type: "error",
            value: `Path escapes the allowed root: ${relative}`,
          })
          expect(searched).toEqual([])
        }),
      (fixture) =>
        fixture
          ? Effect.promise(async () => {
              // Remove the link itself; recursive rm on a Windows directory
              // symlink can fail with EFAULT even though the link is valid.
              await fs.unlink(fixture.link).catch((error) => {
                if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return
                throw error
              })
              await fs.rm(fixture.outside, { recursive: true, force: true })
            })
          : Effect.void,
    ),
  )

  it.effect("grep still searches a path inside the Location", () =>
    Effect.gen(function* () {
      const result = yield* run("grep", { pattern: "export", path: "src" })
      expect(result.type).not.toBe("error")
      expect(searched).toHaveLength(1)
      expect(FSUtil.contains(root, searched[0]!)).toBe(true)
    }),
  )

  it.effect("glob defaults to the Location root when path is omitted", () =>
    Effect.gen(function* () {
      const result = yield* run("glob", { pattern: "*.json" })
      expect(result.type).not.toBe("error")
      expect(searched).toEqual([path.resolve(root, ".")])
    }),
  )
})
