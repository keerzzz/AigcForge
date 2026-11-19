import { registerCustomTheme } from "@pierre/diffs"
import { AigcForgeTheme } from "./marked-theme"

let registered = false

export function registerAigcForgeTheme() {
  if (registered) return
  registered = true
  registerCustomTheme("AigcForge", () => Promise.resolve(AigcForgeTheme))
}
