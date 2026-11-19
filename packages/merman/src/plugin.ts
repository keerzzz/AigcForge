import { Plugin } from "@aigcfroge/plugin/tui"
import { createMermaidCodeBlockRenderer } from "./markdown.js"
import { resolveAigcForgeDiagramPalette } from "./palette.js"

export default Plugin.define({
  id: "aigcfroge.merman",
  setup(context) {
    context.markdown.registerCodeBlockRenderer(
      "mermaid",
      createMermaidCodeBlockRenderer(context.renderer, () => ({
        colors: resolveAigcForgeDiagramPalette(context.theme, context.themeMode),
      })),
    )
  },
})
