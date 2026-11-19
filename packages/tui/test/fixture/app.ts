import { createTestRenderer } from "@opentui/core/testing"
import { Effect, Exit, FileSystem } from "effect"
import path from "node:path"
import { Global } from "@aigcfroge/util/global"
import type { TuiInput } from "../../src/app"
import type { Config } from "../../src/config"
import { tmpdir } from "./fixture"
import { createEventStream, createFetch, type FetchHandler } from "./tui-client"

export async function createAppFixture(
  input: {
    width?: number
    height?: number
    state?: string
    config?: Config.Info
    args?: TuiInput["args"]
    fetch?: FetchHandler
    log?: TuiInput["log"]
  } = {},
) {
  const { run } = await import("../../src/app")
  const root = await tmpdir()
  const setup = await createTestRenderer({
    width: input.width ?? 100,
    height: input.height ?? 30,
    useThread: false,
    kittyKeyboard: true,
  })
  setup.renderer.start()
  const ready = Promise.withResolvers<void>()
  const exit = Promise.withResolvers<Exit.Exit<void, unknown>>()
  const controller = new AbortController()
  let mounted = false
  let shutdownStarted = false
  setup.renderer.once("destroy", () => {
    shutdownStarted = true
  })
  const events = createEventStream()
  const calls = createFetch(input.fetch, events)
  const server = Bun.serve({ port: 0, fetch: (request) => calls.fetch(request) })
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: { get: async () => input.config ?? { animations: false }, update: async () => ({}) },
      packages: { prepare: async () => ({ directory: "" }) },
      terminalHandoff: async () => ({
        renderer: setup.renderer,
        mode: "dark",
        complete: () => {
          mounted = true
          ready.resolve()
        },
      }),
      args: input.args ?? {},
      log: input.log ?? (() => {}),
    }).pipe(
      Effect.provide(
        Global.layerWith({
          home: path.join(root.path, "home"),
          data: path.join(root.path, "data"),
          cache: path.join(root.path, "cache"),
          config: path.join(root.path, "config"),
          state: input.state ?? path.join(root.path, "state"),
          bin: path.join(root.path, "cache", "bin"),
          log: path.join(root.path, "data", "log"),
          repos: path.join(root.path, "data", "repos"),
          tmp: path.join(root.path, "tmp"),
        }),
      ),
      Effect.provide(FileSystem.layerNoop({})),
      Effect.onExit((result) => Effect.sync(() => exit.resolve(result))),
    ),
    { signal: controller.signal },
  )
  let disposing: Promise<void> | undefined
  return {
    ...setup,
    task,
    exit: exit.promise,
    directory: root.path,
    events,
    server,
    ready: ready.promise,
    [Symbol.asyncDispose]() {
      return (disposing ??= (async () => {
        // The same barrier is shared by repeated disposal calls. Cleanup errors retain
        // the original task failure through native async-disposal suppression.
        await using _directory = root
        await using _connection = {
          async [Symbol.asyncDispose]() {
            await server.stop(true)
          },
        }
        await using _running = {
          async [Symbol.asyncDispose]() {
            if (!mounted) controller.abort()
            await task
          },
        }
        try {
          if (!setup.renderer.isDestroyed) setup.renderer.destroy()
        } catch (error) {
          if (!shutdownStarted) controller.abort()
          throw error
        }
      })())
    },
  }
}
