import { expect, onTestFinished, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { tmpdir } from "../fixture/tmpdir"

// The child intentionally fails one test. Testing the real Bun deadline in another
// process keeps that failure observable without turning this suite red by design.
export function check(helper: string, factory: "testEffect" | "testEffectShared") {
  test.each(["body", "build", "test-clock", "failure", "cleanup-defect"] as const)(
    `${factory} owns the Effect lifetime across %s`,
    async (phase) => {
      await using tmp = await tmpdir()
      const file = `${tmp.path}/lifecycle.test.ts`
      await Bun.write(file, source(helper, factory, phase))
      const child = Bun.spawn([process.execPath, "test", file], {
        cwd: fileURLToPath(new URL("../../", helper)),
        stdout: "pipe",
        stderr: "pipe",
      })
      onTestFinished(async () => {
        if (child.exitCode !== null) return
        child.kill()
        await child.exited
      })
      const [exit, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      const output = stdout + stderr
      expect(exit, output).toBe(1)
      expect(output).toMatch(/\b1 pass\b/)
      expect(output).toMatch(/\b1 fail\b/)
      expect(output).not.toContain("Unhandled error between tests")
      expect(output).not.toContain("late failure from timed-out")
      expect(output).not.toContain("Custom mode is disabled")
      const body = phase === "build" ? [] : ["1:body"]
      expect(stdout).toContain(
        `LIFECYCLE_TRACE=${JSON.stringify({
          events: ["1:acquire", ...body, "1:release", "2:acquire", "2:body", "2:verified", "2:release"],
          custom: "false",
        })}`,
      )
      if (phase === "failure") expect(output).toContain("original test failure")
      if (phase !== "failure") expect(output).toContain("this test timed out after 50ms")
      if (phase === "cleanup-defect") expect(output).toContain("cleanup defect must remain visible")
    },
  )
}

function source(helper: string, factory: string, phase: string) {
  return `
import { afterAll, expect } from "bun:test"
import { Deferred, Effect, Layer } from ${JSON.stringify(import.meta.resolve("effect"))}
import { ProductModePolicy } from ${JSON.stringify(import.meta.resolve("../../src/product-mode-policy.ts"))}
import { ${factory} } from ${JSON.stringify(helper)}

const phase = ${JSON.stringify(phase)}
const release = Deferred.makeUnsafe<void>()
const finalized = Deferred.makeUnsafe<void>()
const events: string[] = []
let ordinal = 0
// Bun 1.3.14 leaves its Windows test-deadline timer unreferenced. Keep the real
// loop alive while Deferred waits so the runner can fire the tested deadline.
const keepAlive = setInterval(() => {}, 1000)
process.env.AIGCFROGE_CUSTOM_MODE = "false"
const state = Layer.effectDiscard(
  Effect.gen(function* () {
    const id = ++ordinal
    const custom = process.env.AIGCFROGE_CUSTOM_MODE
    process.env.AIGCFROGE_CUSTOM_MODE = "true"
    events.push(id + ":acquire")
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        if (custom === undefined) delete process.env.AIGCFROGE_CUSTOM_MODE
        if (custom !== undefined) process.env.AIGCFROGE_CUSTOM_MODE = custom
        events.push(id + ":release")
        if (id !== 1) return
        yield* Deferred.succeed(finalized, undefined)
        if (phase === "cleanup-defect") return yield* Effect.die(new Error("cleanup defect must remain visible"))
      }),
    )
    if (id !== 1 || phase !== "build") return
    yield* Deferred.await(release)
    return yield* Effect.fail(new Error("late failure from timed-out layer build"))
  }),
)
const first = ${factory}(state)
const second = ${factory}(Layer.fresh(state))
const method = phase === "test-clock" ? "effect" : "live"
first[method](
  "original failure or intentional Bun deadline",
  () => Effect.gen(function* () {
    events.push("1:body")
    if (phase === "failure") return yield* Effect.fail(new Error("original test failure"))
    yield* Deferred.await(release)
    return yield* Effect.fail(new Error("late failure from timed-out test"))
  }),
  50,
)
second[method]("next test owns its state after prior cleanup", () =>
  Effect.gen(function* () {
    const previousWasClosed = events.includes("1:release")
    events.push("2:body")
    yield* Deferred.succeed(release, undefined)
    // Do not hang on a leaked scope when construction itself failed.
    if (phase === "build") expect(previousWasClosed).toBe(true)
    yield* Deferred.await(finalized)
    yield* ProductModePolicy.assertRuntimeSupported("custom")
    expect(previousWasClosed).toBe(true)
    expect(process.env.AIGCFROGE_CUSTOM_MODE).toBe("true")
    events.push("2:verified")
  }),
)
afterAll(() => {
  clearInterval(keepAlive)
  console.log("LIFECYCLE_TRACE=" + JSON.stringify({ events, custom: process.env.AIGCFROGE_CUSTOM_MODE }))
})
`
}

export * as EffectLifecycle from "./effect-lifecycle"
