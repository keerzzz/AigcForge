import { expect, test } from "bun:test"
import { selectTheme, selectThemeMode, supportsThemeMode, themeModes } from "@omnixa/theme/tui"
import { getOmnixaTheme } from "../../../src/theme"

test("selects complete light and dark themes independently", () => {
  const light = selectTheme(getOmnixaTheme(), "light")
  const dark = selectTheme(getOmnixaTheme(), "dark")
  expect(selectTheme(getOmnixaTheme())).toEqual(light)
  expect(light.hue).toEqual(getOmnixaTheme().light.hue)
  expect(dark.text).toEqual(getOmnixaTheme().base.text)
  expect(dark.hue).toEqual(getOmnixaTheme().dark.hue)
  expect(selectThemeMode(getOmnixaTheme(), "dark")).toEqual({ theme: dark, mode: "dark" })
})

test("selects the available mode when the requested mode is missing", () => {
  const lightOnly = { base: getOmnixaTheme().base, light: getOmnixaTheme().light } as const
  const darkOnly = { base: getOmnixaTheme().base, dark: getOmnixaTheme().dark } as const

  expect(themeModes(lightOnly)).toEqual(["light"])
  expect(themeModes(darkOnly)).toEqual(["dark"])
  expect(supportsThemeMode(lightOnly, "light")).toBeTrue()
  expect(supportsThemeMode(lightOnly, "dark")).toBeFalse()
  expect(selectThemeMode(lightOnly, "dark")).toEqual({
    theme: selectTheme(getOmnixaTheme(), "light"),
    mode: "light",
  })
  expect(selectThemeMode(darkOnly, "light")).toEqual({ theme: selectTheme(getOmnixaTheme(), "dark"), mode: "dark" })
})
