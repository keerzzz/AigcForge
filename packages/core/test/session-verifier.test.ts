import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppProcess } from "../src/process"
import { FSUtil } from "../src/fs-util"
import os from "os"
import path from "path"
import { Config } from "../src/config"
import { ConfigMeta } from "../src/config/meta"
import { CorrectionStore } from "../src/session/correction-store"
import { EventV2 } from "../src/event"
import { Location } from "../src/location"
import { Project } from "../src/project"
import { SessionV2 } from "../src/session"
import { AbsolutePath } from "../src/schema"
import { VerificationRouter } from "../src/session/verification-router"
import { Verifier } from "../src/session/verifier"
import { it, testEffect } from "./lib/effect"

const sessionID = SessionV2.ID.make("ses_verifier")

const locationLayer = Layer.mock(Location.Service, {
  directory: AbsolutePath.make("/repo"),
  workspaceID: undefined,
  project: { id: Project.ID.make("project"), directory: AbsolutePath.make("/repo") },
  vcs: undefined,
})

const configLayer = (meta: { enabled?: boolean; timeout_ms?: number; max_consecutive_failures?: number } = {}) =>
  Layer.succeed(
    Config.Service,
    Config.Service.of({
      entries: () =>
        Effect.succeed([
          new Config.Document({
            type: "document",
            info: Config.Info.make({
              meta: ConfigMeta.Info.make({ verifier: ConfigMeta.Verifier.make(meta) }),
            }),
          }),
        ]),
    }),
  )

const makeAppProcess = (exitCodes: ReadonlyArray<number>, runs: number[] = []) =>
  Layer.mock(AppProcess.Service, {
    run: () =>
      Effect.sync(() => {
        const index = Math.min(runs.length, exitCodes.length - 1)
        const code = exitCodes[index] ?? 0
        runs.push(runs.length)
        return {
          command: "bun",
          exitCode: code,
          stdout:
            code === 0
              ? Buffer.from("")
              : Buffer.from("src/foo.ts(1,1): error TS2307: Cannot find module './x'\n"),
          stderr: code === 0 ? Buffer.alloc(0) : Buffer.from(""),
          stdoutTruncated: false,
          stderrTruncated: false,
        }
      }),
  })

const layerFor = (meta = {}, appProcess?: Layer.Layer<AppProcess.Service, never, never>) =>
  Verifier.layer.pipe(
    Layer.provide(VerificationRouter.layer.pipe(Layer.provide(configLayer(meta)))),
    Layer.provideMerge(CorrectionStore.layer.pipe(Layer.provide(configLayer(meta)))),
    Layer.provide(EventV2.defaultLayer),
    Layer.provide(appProcess ?? makeAppProcess([0])),
    Layer.provide(locationLayer),
    Layer.provide(configLayer(meta)),
  )

const verify = (overrides: { toolName?: string; intent?: string; toolInput?: unknown } = {}) =>
  Effect.gen(function* () {
    const verifier = yield* Verifier.Service
    return yield* verifier.verify({
      sessionID,
      toolName: overrides.toolName ?? "edit",
      intent: overrides.intent ?? "code_modification",
      toolInput: overrides.toolInput ?? { path: "packages/core/src/foo.ts" },
    })
  })

describe("Verifier package resolution", () => {
  const it = testEffect(configLayer({}))

  it.effect("resolves packages/core/src/foo.ts to packages/core", () =>
    Effect.gen(function* () {
      expect(Verifier.packageDirectory("packages/core/src/foo.ts")).toBe("packages/core")
    }),
  )

  it.effect("resolves packages/app/src/bar.tsx to packages/app", () =>
    Effect.gen(function* () {
      expect(Verifier.packageDirectory("packages/app/src/bar.tsx")).toBe("packages/app")
    }),
  )

  it.effect("returns undefined for non-workspace files", () =>
    Effect.gen(function* () {
      expect(Verifier.packageDirectory("/tmp/test.ts")).toBeUndefined()
    }),
  )
})

describe("Verifier success", () => {
  const runs: number[] = []
  const it = testEffect(layerFor({}, makeAppProcess([0], runs)))

  it.effect("runs typecheck and returns empty augmentation on success", () =>
    Effect.gen(function* () {
      const warning = yield* verify()
      expect(warning).toBe("")
      expect(runs.length).toBe(1)
    }),
  )
})

describe("Verifier failure", () => {
  const runs: number[] = []
  const it = testEffect(layerFor({}, makeAppProcess([1], runs)))

  it.effect("augments the result with prose and records a correction on failure", () =>
    Effect.gen(function* () {
      const warning = yield* verify()
      expect(warning).toContain("⚠️ [验证]")
      expect(warning).toContain("Self-export is the global default")
      const store = yield* CorrectionStore.Service
      const facts = yield* store.facts(sessionID)
      expect(facts.length).toBeGreaterThan(0)
      expect(facts[0]).toEqual({ key: "verify:packages/core", correct: "packages/core typecheck 修复" })
    }),
  )
})

describe("Verifier gating", () => {
  const runs: number[] = []
  const it = testEffect(layerFor({}, makeAppProcess([0], runs)))

  it.effect("does not run typecheck for code_understanding intent", () =>
    Effect.gen(function* () {
      const warning = yield* verify({ intent: "code_understanding" })
      expect(warning).toBe("")
      expect(runs.length).toBe(0)
    }),
  )

  it.effect("skips non-package files", () =>
    Effect.gen(function* () {
      const warning = yield* verify({ toolInput: { path: "/tmp/foo.ts" } })
      expect(warning).toBe("")
      expect(runs.length).toBe(0)
    }),
  )

  it.effect("skips read tool calls", () =>
    Effect.gen(function* () {
      const warning = yield* verify({ toolName: "read" })
      expect(warning).toBe("")
      expect(runs.length).toBe(0)
    }),
  )
})

describe("Verifier consecutive failures", () => {
  const runs: number[] = []
  const it = testEffect(layerFor({ max_consecutive_failures: 2 }, makeAppProcess([1], runs)))

  it.effect("stops auto-triggering after max consecutive failures", () =>
    Effect.gen(function* () {
      yield* verify()
      yield* verify()
      yield* verify()
      expect(runs.length).toBe(2)
    }),
  )
})

describe("Verifier recovery", () => {
  const runs: number[] = []
  const it = testEffect(layerFor({ max_consecutive_failures: 2 }, makeAppProcess([1, 0, 1, 0], runs)))

  it.effect("resets the failure count after a success", () =>
    Effect.gen(function* () {
      yield* verify()
      yield* verify()
      yield* verify()
      yield* verify()
      expect(runs.length).toBe(4)
    }),
  )
})

describe("Verifier disabled", () => {
  const it = testEffect(layerFor({ enabled: false }))

  it.effect("does not trigger when disabled", () =>
    Effect.gen(function* () {
      expect(yield* verify()).toBe("")
    }),
  )
})

describe("Verifier real subprocess", () => {
  it.live("runs the real typecheck script and reports failure output", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const tmpDir = yield* fs.makeTempDirectory({ directory: os.tmpdir(), prefix: "aigcfroge-verifier-" })
      yield* fs.writeWithDirs(
        path.join(tmpDir, "packages/core/package.json"),
        JSON.stringify({
          name: "fixture-core",
          scripts: { typecheck: "echo 'src/foo.ts(1,1): error TS2307: Cannot find module ./x' && exit 1" },
        }),
      )
      const liveLayer = Verifier.layer.pipe(
        Layer.provide(VerificationRouter.layer.pipe(Layer.provide(configLayer({})))),
        Layer.provideMerge(CorrectionStore.layer.pipe(Layer.provide(configLayer({})))),
        Layer.provide(EventV2.defaultLayer),
        Layer.provide(AppProcess.defaultLayer),
        Layer.provide(
          Location.layer({ directory: AbsolutePath.make(tmpDir) }).pipe(
            Layer.provide(Project.defaultLayer),
          ),
        ),
        Layer.provide(configLayer({})),
      )
      return yield* Effect.gen(function* () {
        const verifier = yield* Verifier.Service
        const warning = yield* verifier.verify({
          sessionID,
          toolName: "edit",
          intent: "code_modification",
          toolInput: { path: "packages/core/src/foo.ts" },
        })
        expect(warning).toContain("⚠️ [验证]")
        expect(warning).toContain("Cannot find module")
      }).pipe(Effect.provide(liveLayer))
    }).pipe(Effect.provide(FSUtil.defaultLayer)),
  )
})

