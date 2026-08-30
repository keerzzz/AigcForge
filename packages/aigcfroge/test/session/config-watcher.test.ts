import { describe, expect, test, beforeEach } from "bun:test"
import { Effect } from "effect"
import { ConfigWatcher } from "../../src/session/config-watcher"

beforeEach(() => {
  process.env.AIGCFROGE_ENABLE_HOT_RELOAD = "true"
})

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

describe("ConfigWatcher", () => {
  test("should init with standard paths", () =>
    run(
      Effect.gen(function* () {
        const watcher = yield* ConfigWatcher.Service
        yield* watcher.init()
        const changed = yield* watcher.hasChanged()
        expect(changed).toBe(false)
      }).pipe(Effect.provide(ConfigWatcher.layer)),
    ))

  test("should not detect change when flag is off", () =>
    run(
      Effect.gen(function* () {
        process.env.AIGCFROGE_ENABLE_HOT_RELOAD = "false"
        const watcher = yield* ConfigWatcher.Service
        yield* watcher.init()
        const changed = yield* watcher.hasChanged()
        expect(changed).toBe(false)
      }).pipe(Effect.provide(ConfigWatcher.layer)),
    ))
})
