import { ensurePluginRuntime, provides } from "@omnixa/plugin/runtime"
import { Plugin, PluginContextProvider, usePlugin } from "@omnixa/plugin/tui"
import { ensureRuntimePluginSupport } from "@opentui/solid/runtime-plugin-support/configure"

ensurePluginRuntime()
ensureRuntimePluginSupport({
  additional: {
    "@omnixa/plugin/tui": { Plugin, PluginContextProvider, usePlugin },
  },
  preserve: provides,
})
