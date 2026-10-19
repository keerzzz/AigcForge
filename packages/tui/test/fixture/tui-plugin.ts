import type { TuiPluginApi } from "@aigcfroge/plugin/tui"
import { RGBA } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import type { createTuiApiAdapters } from "../../src/plugin/adapters"
import { createTuiResolvedConfig } from "./tui-runtime"

type Opts = {
  client?: TuiPluginApi["client"]
  keymap?: TuiPluginApi["keymap"]
  attention?: Partial<TuiPluginApi["attention"]>
  event?: TuiPluginApi["event"]
  state?: { session?: Partial<TuiPluginApi["state"]["session"]> }
}

export function createTuiPluginApi(opts: Opts = {}) {
  const values = new Map<string, unknown>()
  const color = RGBA.fromInts(200, 200, 200)
  const dialog = { clear() {}, replace() {}, setSize() {}, size: "medium" as const, depth: 0, open: false }
  return {
    attention: { notify: async () => ({ ok: false, notification: false, sound: false }), ...opts.attention },
    client: opts.client,
    event: opts.event,
    keymap: opts.keymap,
    kv: {
      get(name: string, fallback?: unknown) {
        return values.has(name) ? values.get(name) : fallback
      },
      set(name: string, value: unknown) {
        values.set(name, value)
      },
      ready: true,
    },
    state: { session: { get: () => undefined, task: () => [], ...opts.state?.session } },
    theme: { current: new Proxy({}, { get: () => color }) },
    tuiConfig: createTuiResolvedConfig(),
    ui: { dialog },
  } as unknown as TuiPluginApi
}

// Exercise the real adapter with a real SyncProvider and renderer. Unused host
// contexts fail closed so state contract tests cannot reach a provider or UI.
export function createTuiAdapterInput(
  input: Pick<Parameters<typeof createTuiApiAdapters>[0], "sync" | "renderer" | "kv">,
) {
  const api = createTuiPluginApi()
  return {
    ...input,
    version: "0.0.0-test",
    tuiConfig: createTuiResolvedConfig(),
    keymap: createDefaultOpenTuiKeymap(input.renderer),
    dialog: { ...api.ui.dialog, stack: [] },
    attention: api.attention,
    event: { on: () => () => {}, subscribe: () => () => {} },
    get route(): never {
      throw new Error("Unexpected route access in state adapter fixture")
    },
    get routes(): never {
      throw new Error("Unexpected plugin route access in state adapter fixture")
    },
    get sdk(): never {
      throw new Error("Unexpected SDK access in state adapter fixture")
    },
    get theme(): never {
      throw new Error("Unexpected theme access in state adapter fixture")
    },
    get toast(): never {
      throw new Error("Unexpected toast access in state adapter fixture")
    },
    Slot: () => null,
  } satisfies Parameters<typeof createTuiApiAdapters>[0]
}
