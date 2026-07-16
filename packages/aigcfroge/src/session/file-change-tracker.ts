import { Clock, Effect } from "effect"

export interface FileChangeTrackerOptions {
  /** Milliseconds to wait after the first detected change before reporting it. */
  readonly debounceMs?: number
  /** Minimum milliseconds between two reported change events. */
  readonly cooldownMs?: number
}

/**
 * Tracks file changes by comparing mtime + size snapshots.
 * Used to detect CLAUDE.md, settings.json, and .agent.md changes
 * and trigger session restart with resume.
 */
export class FileChangeTracker {
  private snapshots = new Map<string, { mtime: number; size: number }>()
  private lastChangeDetectedAt = 0
  private lastReportedAt = -Infinity
  private pendingChange = false
  private readonly debounceMs: number
  private readonly cooldownMs: number

  constructor(options?: FileChangeTrackerOptions) {
    this.debounceMs = options?.debounceMs ?? 500
    this.cooldownMs = options?.cooldownMs ?? 60_000
  }

  static readonly make = Effect.sync(() => new FileChangeTracker())

  /** Register a file path for change tracking. */
  registerPath(path: string): void {
    this.snapshots.set(path, { mtime: 0, size: 0 })
  }

  /** Register all files in a directory matching an extension pattern. */
  registerDirectory(dir: string, extension: string): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      // Collect matching files via glob
      const entries = yield* Effect.promise(async () => {
        const results: string[] = []
        try {
          const glob = new Bun.Glob(`*${extension}`)
          for await (const entry of glob.scan({ cwd: dir })) {
            results.push(entry)
          }
        } catch {
          // Directory doesn't exist — no entries
        }
        return results
      })
      // Register each entry
      for (const entry of entries) {
        self.registerPath(dir + "/" + entry)
      }
    })
  }

  /** Check if any registered file has changed. Snapshot is refreshed on detection. */
  hasChanges(): Effect.Effect<boolean> {
    const self = this
    return Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const changed = yield* detectChanges(self.snapshots)

      if (changed) {
        // First detection — report immediately to avoid stale config on next resume/wake
        if (!self.pendingChange) {
          self.pendingChange = true
          self.lastChangeDetectedAt = now
          return true
        }
        // Subsequent change while already pending — extend debounce window
        self.lastChangeDetectedAt = now
      }

      // No pending change
      if (!self.pendingChange) {
        return false
      }

      // Still in cooldown from a previous report
      if (now - self.lastReportedAt < self.cooldownMs) {
        return false
      }

      // Debounce period not elapsed yet (for follow-up changes)
      if (now - self.lastChangeDetectedAt <= self.debounceMs) {
        return false
      }

      // Report the change and reset tracking state
      self.pendingChange = false
      self.lastChangeDetectedAt = 0
      self.lastReportedAt = now
      return true
    })
  }

  /** Refresh all snapshots without reporting changes. */
  refresh(): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      for (const [filePath] of self.snapshots) {
        self.snapshots.set(filePath, yield* statFile(filePath))
      }
      self.pendingChange = false
      self.lastChangeDetectedAt = 0
    })
  }
}

function detectChanges(
  snapshots: Map<string, { mtime: number; size: number }>,
): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    for (const [filePath, prev] of snapshots) {
      const current = yield* statFile(filePath)
      if (current.mtime !== prev.mtime || current.size !== prev.size) {
        snapshots.set(filePath, current)
        return true
      }
    }
    return false
  })
}

function statFile(filePath: string): Effect.Effect<{ readonly mtime: number; readonly size: number }> {
  return Effect.gen(function* () {
    try {
      const file = Bun.file(filePath)
      const exists = yield* Effect.promise(() => file.exists())
      if (!exists) return { mtime: 0, size: 0 }
      const info = yield* Effect.promise(() => file.stat())
      // Truncate mtime to whole seconds to avoid sub-second precision drift
      return { mtime: info.mtime ? Math.floor(info.mtime.getTime() / 1000) : 0, size: info.size ?? 0 }
    } catch {
      return { mtime: 0, size: 0 }
    }
  })
}
