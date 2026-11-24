import { Plugin } from "@omnixa/plugin/tui"
import { createMermaidCodeBlockRenderer } from "./markdown.js"
import { resolveOmnixaDiagramPalette } from "./palette.js"

export default Plugin.define({
  id: "omnixa.merman",
  setup(context) {
    context.markdown.registerCodeBlockRenderer(
      "mermaid",
      createMermaidCodeBlockRenderer(context.renderer, () => ({
        colors: resolveOmnixaDiagramPalette(context.theme, context.themeMode),
      })),
    )
  },
})
