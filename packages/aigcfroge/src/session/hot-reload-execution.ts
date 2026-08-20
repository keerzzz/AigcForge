export * as HotReloadSessionExecution from "./hot-reload-execution"

import { Effect, Layer } from "effect"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import * as SessionExecutionLocal from "@aigcfroge/core/session/execution/local"
import { SessionStore } from "@aigcfroge/core/session/store"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { ConfigWatcher } from "./config-watcher"

/**
 * Wraps the core V2 SessionExecution layer so that every resume/wake first
 * checks whether tracked config files changed. If they did, the active drain
 * is interrupted, the watcher is reset, and execution resumes with fresh
 * config/agent state.
 */
export const layer = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const base = yield* SessionExecution.Service
    const watcher = yield* ConfigWatcher.Service

    const checkAndReload = Effect.fn("HotReloadSessionExecution.checkAndReload")(function* (sessionID: string) {
      yield* watcher.init()
      const changed = yield* watcher.hasChanged()
      if (changed) {
        yield* base.interrupt(sessionID as never)
        yield* watcher.reset()
      }
    })

    return SessionExecution.Service.of({
      resume: Effect.fn("HotReloadSessionExecution.resume")(function* (sessionID) {
        yield* checkAndReload(sessionID)
        return yield* base.resume(sessionID)
      }),
      wake: Effect.fn("HotReloadSessionExecution.wake")(function* (sessionID) {
        yield* checkAndReload(sessionID)
        return yield* base.wake(sessionID)
      }),
      interrupt: base.interrupt,
      isActive: base.isActive,
    })
  }),
).pipe(
  Layer.provide(SessionExecutionLocal.layer),
  Layer.provide(Layer.mergeAll(SessionStore.defaultLayer, LocationServiceMap.layer)),
  Layer.provide(ConfigWatcher.layer),
)
