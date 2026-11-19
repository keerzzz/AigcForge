import { ensurePluginRuntime, provides } from "@aigcfroge/plugin/runtime"
import { Plugin, PluginContextProvider, usePlugin } from "@aigcfroge/plugin/tui"
import { ensureRuntimePluginSupport } from "@opentui/solid/runtime-plugin-support/configure"

ensurePluginRuntime()
ensureRuntimePluginSupport({
  additional: {
    "@aigcfroge/plugin/tui": { Plugin, PluginContextProvider, usePlugin },
  },
  preserve: provides,
})
