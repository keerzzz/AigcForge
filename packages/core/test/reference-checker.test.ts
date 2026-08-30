import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import os from "os"
import path from "path"
import { Config } from "../src/config"
import { ConfigMeta } from "../src/config/meta"
import { CorrectionStore } from "../src/session/correction-store"
import { FSUtil } from "../src/fs-util"
import { Location } from "../src/location"
import { Project } from "../src/project"
import { ReferenceChecker } from "../src/session/reference-checker"
import { Ripgrep } from "../src/ripgrep"
import { SessionV2 } from "../src/session"
import { AbsolutePath } from "../src/schema"
import { it } from "./lib/effect"

const sessionID = SessionV2.ID.make("ses_reference_checker")

const configLayer = (meta: { enabled?: boolean; timeout_ms?: number } = {}) =>
  Layer.succeed(
    Config.Service,
    Config.Service.of({
      entries: () =>
        Effect.succeed([
          new Config.Document({
            type: "document",
            info: Config.Info.make({
              meta: ConfigMeta.Info.make({ reference_check: ConfigMeta.ReferenceCheck.make(meta) }),
            }),
          }),
        ]),
    }),
  )

const mockRipgrep = Layer.mock(Ripgrep.Service, {
  grep: () => Effect.fail(new Ripgrep.Error({ message: "ripgrep unavailable" })),
  find: () => Effect.fail(new Ripgrep.Error({ message: "ripgrep unavailable" })),
  glob: () => Effect.fail(new Ripgrep.Error({ message: "ripgrep unavailable" })),
})

const projectLayer = (directory: string) =>
  Layer.succeed(
    Project.Service,
    Project.Service.of({
      directories: () => Effect.succeed([]),
      resolve: () =>
        Effect.succeed({ id: Project.ID.make("project"), directory: AbsolutePath.make(directory), vcs: undefined }),
      commit: () => Effect.void,
    }),
  )

const locationLayer = (directory: string) =>
  Location.layer({ directory: AbsolutePath.make(directory) }).pipe(Layer.provide(projectLayer(directory)))

// Builds the checker layer rooted at `directory` (the fixture tmpdir).
const layerAt = (
  directory: string,
  meta: { enabled?: boolean; timeout_ms?: number } = {},
  ripgrep: Layer.Layer<Ripgrep.Service> = Ripgrep.defaultLayer,
) =>
  ReferenceChecker.layer.pipe(
    Layer.provideMerge(CorrectionStore.layer.pipe(Layer.provide(configLayer(meta)))),
    Layer.provide(ripgrep),
    Layer.provide(FSUtil.defaultLayer),
    Layer.provide(configLayer(meta)),
    Layer.provide(locationLayer(directory)),
  )

// Creates a tmpdir with the given fixture files and returns [tmpDir, layer].
const withFixture = (
  files: Record<string, string>,
  meta: { enabled?: boolean; timeout_ms?: number } = {},
  ripgrep: Layer.Layer<Ripgrep.Service> = Ripgrep.defaultLayer,
) =>
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const tmpDir = yield* fs.makeTempDirectory({ directory: os.tmpdir(), prefix: "aigcfroge-refcheck-" })
    for (const [name, content] of Object.entries(files)) {
      yield* fs.writeWithDirs(path.join(tmpDir, name), content)
    }
    return [tmpDir, layerAt(tmpDir, meta, ripgrep)] as const
  }).pipe(Effect.provide(FSUtil.defaultLayer))

const runCheck = (input: Parameters<ReferenceChecker.Interface["check"]>[0]) =>
  Effect.gen(function* () {
    const checker = yield* ReferenceChecker.Service
    return yield* checker.check(input)
  })

describe("ReferenceChecker", () => {
  it.live("reports a dangling markdown link", () =>
    withFixture({ "guide.md": "See [target](./missing.md) for details.\n" }).pipe(
      Effect.flatMap(([, layer]) =>
        runCheck({ sessionID, toolName: "edit", toolInput: { path: "guide.md" } }).pipe(Effect.provide(layer)),
      ),
      Effect.map((warning) => {
        expect(warning).toContain("⚠️ [引用校验]")
        expect(warning).toContain("./missing.md")
      }),
    ),
  )

  it.live("does not report when the markdown link target exists", () =>
    withFixture({ "guide.md": "See [target](./exists.md) for details.\n", "exists.md": "present\n" }).pipe(
      Effect.flatMap(([, layer]) =>
        runCheck({ sessionID, toolName: "edit", toolInput: { path: "guide.md" } }).pipe(Effect.provide(layer)),
      ),
      Effect.map((warning) => {
        expect(warning).toBe("")
      }),
    ),
  )

  it.live("reports a dangling import in a TypeScript file", () =>
    withFixture({ "src/worker.ts": 'import { X } from "./missing"\n' }).pipe(
      Effect.flatMap(([, layer]) =>
        runCheck({ sessionID, toolName: "write", toolInput: { path: "src/worker.ts" } }).pipe(Effect.provide(layer)),
      ),
      Effect.map((warning) => {
        expect(warning).toContain("./missing")
      }),
    ),
  )

  it.live("resolves extensionless imports against existing files", () =>
    withFixture({ "src/worker.ts": 'import { X } from "./util"\n', "src/util.ts": "export const X = 1\n" }).pipe(
      Effect.flatMap(([, layer]) =>
        runCheck({ sessionID, toolName: "write", toolInput: { path: "src/worker.ts" } }).pipe(Effect.provide(layer)),
      ),
      Effect.map((warning) => {
        expect(warning).toBe("")
      }),
    ),
  )

  it.live("does not scan for read or grep tools", () =>
    withFixture({ "guide.md": "See [target](./missing.md) for details.\n" }).pipe(
      Effect.flatMap(([, layer]) =>
        Effect.all([
          runCheck({ sessionID, toolName: "read", toolInput: { path: "guide.md" } }),
          runCheck({ sessionID, toolName: "grep", toolInput: { pattern: "target", path: "guide.md" } }),
        ]).pipe(Effect.provide(layer)),
      ),
      Effect.map(([readWarning, grepWarning]) => {
        expect(readWarning).toBe("")
        expect(grepWarning).toBe("")
      }),
    ),
  )

  it.live("writes the dangling reference into the CorrectionStore", () =>
    withFixture({ "guide.md": "See [target](./missing.md) for details.\n" }).pipe(
      Effect.flatMap(([, layer]) =>
        Effect.gen(function* () {
          const checker = yield* ReferenceChecker.Service
          yield* checker.check({ sessionID, toolName: "edit", toolInput: { path: "guide.md" } })
          const store = yield* CorrectionStore.Service
          return yield* store.facts(sessionID)
        }).pipe(Effect.provide(layer)),
      ),
      Effect.map((facts) => {
        expect(facts.length).toBeGreaterThan(0)
        expect(facts[0]).toEqual({ key: "ref:./missing.md", correct: "./missing.md 不存在" })
      }),
    ),
  )

  it.live("skips instead of blocking when the scan times out", () =>
    withFixture({ "guide.md": "See [target](./missing.md) for details.\n".repeat(5_000) }, { timeout_ms: 1 }).pipe(
      Effect.flatMap(([, layer]) =>
        runCheck({ sessionID, toolName: "edit", toolInput: { path: "guide.md" } }).pipe(Effect.provide(layer)),
      ),
      Effect.map((warning) => {
        expect(warning).toBe("")
      }),
    ),
  )
})

describe("ReferenceChecker config", () => {
  it.live("skips without blocking when ripgrep is unavailable", () =>
    withFixture({ "guide.md": "See [target](./missing.md) for details.\n" }, {}, mockRipgrep).pipe(
      Effect.flatMap(([, layer]) =>
        runCheck({ sessionID, toolName: "edit", toolInput: { path: "guide.md" } }).pipe(Effect.provide(layer)),
      ),
      Effect.map((warning) => {
        expect(warning).toBe("")
      }),
    ),
  )

  it.live("does not scan when disabled", () =>
    withFixture({ "guide.md": "See [target](./missing.md) for details.\n" }, { enabled: false }).pipe(
      Effect.flatMap(([, layer]) =>
        runCheck({ sessionID, toolName: "edit", toolInput: { path: "guide.md" } }).pipe(Effect.provide(layer)),
      ),
      Effect.map((warning) => {
        expect(warning).toBe("")
      }),
    ),
  )
})
