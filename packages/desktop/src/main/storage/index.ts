export * as DesktopStorage from "./index"

import { app, BrowserWindow } from "electron"
import { Context, Effect, Layer, Path } from "effect"
import { marks } from "../lifecycle/marks"
import { openDatabase } from "./database"
import { setStorageSnapshotProvider } from "./snapshot"
import { createDraftStore } from "./drafts"
import { createStateStore } from "./state"
import { readEnableState } from "../extension/enable-state"

export type Interface = ReturnType<typeof make>

export class Service extends Context.Service<Service, Interface>()("omnixa/desktop/DesktopStorage") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const path = yield* Path.Path
    const runFork = Effect.runForkWith(yield* Effect.context())
    const userData = app.getPath("userData")

    const storage = make(path.join(userData, "drafts.sqlite"), (error) =>
      runFork(Effect.logError("storage flush failed", { error })),
    )

    const wire = (_event: Electron.Event | undefined, win: BrowserWindow) => win.on("session-end", storage.flush)
    app.on("before-quit", storage.flush)
    app.on("browser-window-created", wire)
    BrowserWindow.getAllWindows().forEach((win) => wire(undefined, win))
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        app.off("before-quit", storage.flush)
        app.off("browser-window-created", wire)
        BrowserWindow.getAllWindows().forEach((win) => win.off("session-end", storage.flush))
        storage.close()
      }),
    )
    setStorageSnapshotProvider((names) => ({
      storage: Object.fromEntries(names.map((name) => [name, storage.state.items(name)])),
      extensions: readEnableState(storage.db.$client),
    }))
    marks.storage = Date.now()

    return Service.of(storage)
  }),
)

// The file keeps its historical name; renaming it would mean moving the drafts it already holds.
// SAFETY: this observer only reports caught write failures; it never interprets them as stored values.
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- see SAFETY above
export function make(filename: string, onError?: (error: unknown) => void) {
  const database = openDatabase(filename)
  const state = createStateStore(database.db, { onError })
  const drafts = createDraftStore(database.db, { onError })

  return {
    db: database.db,
    state,
    drafts,
    flush() {
      state.flush()
      drafts.flush()
    },
    close() {
      state.close()
      drafts.close()
      database.close()
    },
  }
}
