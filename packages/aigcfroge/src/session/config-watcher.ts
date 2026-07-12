export * as ConfigWatcher from "./config-watcher"

import { Context, Effect, Layer } from "effect"
import { FileChangeTracker } from "./file-change-tracker"
import { Flag } from "@aigcfroge/core/flag/flag"

/**
 * Standard paths to monitor for hot-reload.
 * Registered lazily — the tracker is only initialized when enabled.
 */
const STANDARD_CONFIG_PATTERNS = [
  { type: "file" as const, path: ".claude/CLAUDE.md" },
  { type: "file" as const, path: "CLAUDE.md" },
  { type: "file" as const, path: ".claude/settings.json" },
  { type: "dir" as const, dir: ".claude/agents", ext: ".agent.md" },
] as const

export interface Interface {
  /** Initialize the config change tracker with standard paths. Safe to call multiple times. */
  readonly init: () => Effect.Effect<void>
  /** Check if tracked config files have changed since last check. */
  readonly hasChanged: () => Effect.Effect<boolean>
  /** Reset the watcher state. Used after a restart is handled. */
  readonly reset: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/session/ConfigWatcher") {}

class State {
  tracker: FileChangeTracker | undefined
}

const make = Effect.gen(function* () {
  const state = new State()

  const init = Effect.fn("ConfigWatcher.init")(function* () {
    if (!Flag.AIGCFROGE_ENABLE_HOT_RELOAD) return

    if (!state.tracker) {
      state.tracker = yield* FileChangeTracker.make
      for (const pattern of STANDARD_CONFIG_PATTERNS) {
        if (pattern.type === "file") {
          state.tracker.registerPath(pattern.path)
        }
      }
    }
    // Rescan directories every init to pick up newly added files (e.g. new .agent.md)
    for (const pattern of STANDARD_CONFIG_PATTERNS) {
      if (pattern.type === "dir") {
        yield* state.tracker.registerDirectory(pattern.dir, pattern.ext)
      }
    }
    yield* state.tracker.refresh()
  })

  const hasChanged = Effect.fn("ConfigWatcher.hasChanged")(function* () {
    if (!state.tracker || !Flag.AIGCFROGE_ENABLE_HOT_RELOAD) return false
    return yield* state.tracker.hasChanges()
  })

  const reset = Effect.fn("ConfigWatcher.reset")(function* () {
    if (state.tracker) {
      yield* state.tracker.refresh()
    }
  })

  return Service.of({ init, hasChanged, reset })
})

export const layer = Layer.effect(Service, make)

export const noopLayer = Layer.succeed(
  Service,
  Service.of({
    init: () => Effect.void,
    hasChanged: () => Effect.succeed(false),
    reset: () => Effect.void,
  }),
)
