import { Flag } from "@aigcfroge/core/flag/flag"
import { Effect } from "effect"
import path from "path"

const preserveExerciseGlobalRoot = !!process.env.AIGCFROGE_HTTPAPI_EXERCISE_GLOBAL
export const exerciseGlobalRoot =
  process.env.AIGCFROGE_HTTPAPI_EXERCISE_GLOBAL ??
  path.join(process.env.TMPDIR ?? "/tmp", `aigcfroge-httpapi-global-${process.pid}`)
process.env.XDG_DATA_HOME = path.join(exerciseGlobalRoot, "data")
process.env.XDG_CONFIG_HOME = path.join(exerciseGlobalRoot, "config")
process.env.XDG_STATE_HOME = path.join(exerciseGlobalRoot, "state")
process.env.XDG_CACHE_HOME = path.join(exerciseGlobalRoot, "cache")
process.env.AIGCFROGE_DISABLE_SHARE = "true"
export const exerciseConfigDirectory = path.join(exerciseGlobalRoot, "config", "aigcfroge")
export const exerciseDataDirectory = path.join(exerciseGlobalRoot, "data", "aigcfroge")

const preserveExerciseDatabase = !!process.env.AIGCFROGE_HTTPAPI_EXERCISE_DB
export const exerciseDatabasePath =
  process.env.AIGCFROGE_HTTPAPI_EXERCISE_DB ??
  path.join(process.env.TMPDIR ?? "/tmp", `aigcfroge-httpapi-exercise-${process.pid}.db`)
process.env.AIGCFROGE_DB = exerciseDatabasePath
Flag.AIGCFROGE_DB = exerciseDatabasePath

// The custom composition routes are flag-gated at the HTTP layer (default off).
// The exerciser covers the enabled path; the disabled 400 behavior is asserted
// by the capability-matrix unit tests, so enable the flag for the whole run.
process.env.AIGCFROGE_CUSTOM_MODE = "true"

export const original = {
  AIGCFROGE_SERVER_PASSWORD: Flag.AIGCFROGE_SERVER_PASSWORD,
  AIGCFROGE_SERVER_USERNAME: Flag.AIGCFROGE_SERVER_USERNAME,
}

export const cleanupExercisePaths = Effect.promise(async () => {
  const fs = await import("fs/promises")
  if (!preserveExerciseDatabase) {
    await Promise.all(
      [exerciseDatabasePath, `${exerciseDatabasePath}-wal`, `${exerciseDatabasePath}-shm`].map((file) =>
        fs.rm(file, { force: true }).catch(() => undefined),
      ),
    )
  }
  if (!preserveExerciseGlobalRoot)
    await fs.rm(exerciseGlobalRoot, { recursive: true, force: true }).catch(() => undefined)
})
