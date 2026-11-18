import { expect, test } from "bun:test"
import { selectTheme, selectThemeMode, supportsThemeMode, themeModes } from "@aigcfroge/theme/tui"
import { getAigcForgeTheme } from "../../../src/theme"

test("selects complete light and dark themes independently", () => {
  const light = selectTheme(getAigcForgeTheme(), "light")
  const dark = selectTheme(getAigcForgeTheme(), "dark")
  expect(selectTheme(getAigcForgeTheme())).toEqual(light)
  expect(light.hue).toEqual(getAigcForgeTheme().light.hue)
  expect(dark.text).toEqual(getAigcForgeTheme().base.text)
  expect(dark.hue).toEqual(getAigcForgeTheme().dark.hue)
  expect(selectThemeMode(getAigcForgeTheme(), "dark")).toEqual({ theme: dark, mode: "dark" })
})

test("selects the available mode when the requested mode is missing", () => {
  const lightOnly = { base: getAigcForgeTheme().base, light: getAigcForgeTheme().light } as const
  const darkOnly = { base: getAigcForgeTheme().base, dark: getAigcForgeTheme().dark } as const

  expect(themeModes(lightOnly)).toEqual(["light"])
  expect(themeModes(darkOnly)).toEqual(["dark"])
  expect(supportsThemeMode(lightOnly, "light")).toBeTrue()
  expect(supportsThemeMode(lightOnly, "dark")).toBeFalse()
  expect(selectThemeMode(lightOnly, "dark")).toEqual({ theme: selectTheme(getAigcForgeTheme(), "light"), mode: "light" })
  expect(selectThemeMode(darkOnly, "light")).toEqual({ theme: selectTheme(getAigcForgeTheme(), "dark"), mode: "dark" })
})
