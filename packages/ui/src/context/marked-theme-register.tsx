import { registerCustomTheme } from "@pierre/diffs"
import { OmnixaTheme } from "./marked-theme"

let registered = false

export function registerOmnixaTheme() {
  if (registered) return
  registered = true
  registerCustomTheme("Omnixa", () => Promise.resolve(OmnixaTheme))
}
