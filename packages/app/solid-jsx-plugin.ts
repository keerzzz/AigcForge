import { transformSync } from "@babel/core"
import presetTypescript from "@babel/preset-typescript"
import babelPresetSolid from "babel-preset-solid"

/**
 * Bun `onLoad` plugin that compiles app-test `.tsx` through
 * `babel-preset-solid` + `@babel/preset-typescript`.
 *
 * Bun's built-in transpiler turns JSX into React `jsx()` calls, which throws
 * `ReferenceError: React is not defined` under the `browser` condition — Solid
 * JSX is not a runtime `jsx()` call, it must be compiled into template cloning.
 * `--conditions=browser` makes `solid-js/web` resolve to the browser build so
 * `render` actually mounts into the happy-dom document.
 *
 * Only `.tsx` loaded by the test run is transformed; `node_modules` (which
 * ships prebuilt JS) and Vite config are untouched.
 */
export const solidJsxPlugin: Bun.Plugin = {
  name: "solid-jsx",
  setup(builder) {
    builder.onLoad({ filter: /\.tsx$/ }, async (args) => {
      if (args.path.includes("node_modules")) return undefined
      const source = await Bun.file(args.path).text()
      const result = transformSync(source, {
        filename: args.path,
        presets: [[presetTypescript, { jsx: "preserve" }], [babelPresetSolid]],
        sourceMaps: "inline",
        babelrc: false,
        configFile: false,
      })
      return result?.code ? { contents: result.code, loader: "js" } : { contents: source, loader: "ts" }
    })
  },
}
