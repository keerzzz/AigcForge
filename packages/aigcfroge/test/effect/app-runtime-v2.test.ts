import { expect, test } from "bun:test"
import { Effect } from "effect"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionStore } from "@aigcfroge/core/session/store"
import { AppRuntime } from "../../src/effect/app-runtime"
import { disposeAllInstances } from "../fixture/fixture"

// Regression guard for the V2 layer composition in AppLayer. The bug was that
// AppLayer used Layer.mergeAll for V2 layers (SessionStore / SessionExecution /
// SessionV2), but Effect v4 mergeAll siblings do not satisfy each other's
// dependencies. This caused "Service not found: @aigcfroge/v2/SessionStore"
// when the AppRuntime was first built (e.g., disposeAllInstances in afterEach).

test("AppRuntime provides V2 SessionStore and SessionV2 services", async () => {
  // Building the AppLayer via AppRuntime.runPromise exercises the full V2
  // dependency chain. If composition is broken (mergeAll siblings), this
  // throws "Service not found" at layer build time.
  await AppRuntime.runPromise(
    Effect.gen(function* () {
      yield* SessionStore.Service
      yield* SessionV2.Service
    }) as never,
  )
})

test("disposeAllInstances succeeds with V2 layers wired", async () => {
  // The afterEach cleanup path that was broken by the mergeAll sibling issue.
  // Calling it standalone forces a fresh AppLayer build if the memoMap is empty.
  await disposeAllInstances()
  expect(true).toBe(true)
})
