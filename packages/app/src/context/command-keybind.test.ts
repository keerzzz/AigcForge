import { describe, expect, test } from "bun:test"
import { formatKeybind, matchKeybind, parseKeybind } from "./command"

describe("command keybind helpers", () => {
  test("parseKeybind handles aliases and multiple combos", () => {
    const keybinds = parseKeybind("control+option+k, mod+shift+comma")

    expect(keybinds).toHaveLength(2)
    expect(keybinds[0]).toEqual({
      key: "k",
      ctrl: true,
      meta: false,
      shift: false,
      alt: true,
    })
    expect(keybinds[1]?.shift).toBe(true)
    expect(keybinds[1]?.key).toBe("comma")
    expect(keybinds[1]?.ctrl || keybinds[1]?.meta).toBe(true)
  })

  test("parseKeybind treats none and empty as disabled", () => {
    expect(parseKeybind("none")).toEqual([])
    expect(parseKeybind("")).toEqual([])
  })

  test("matchKeybind normalizes punctuation keys", () => {
    const keybinds = parseKeybind("ctrl+comma, shift+plus, meta+space")

    expect(matchKeybind(keybinds, new KeyboardEvent("keydown", { key: ",", ctrlKey: true }))).toBe(true)
    expect(matchKeybind(keybinds, new KeyboardEvent("keydown", { key: "+", shiftKey: true }))).toBe(true)
    expect(matchKeybind(keybinds, new KeyboardEvent("keydown", { key: " ", metaKey: true }))).toBe(true)
    expect(matchKeybind(keybinds, new KeyboardEvent("keydown", { key: ",", ctrlKey: true, altKey: true }))).toBe(false)
  })

  test("matchKeybind folds a shifted punctuation key back to its base key", () => {
    // Regression: `shift+mod+.` reported `event.key === ">"` on a US layout, so the
    // configured key "." never matched. `event.code` names the physical key.
    const keybinds = parseKeybind("shift+ctrl+.")
    const shifted = new KeyboardEvent("keydown", {
      key: ">",
      code: "Period",
      ctrlKey: true,
      shiftKey: true,
    })
    expect(matchKeybind(keybinds, shifted)).toBe(true)
    // Without a code the event key stays ">" and must not match "." — the fold is
    // driven by `event.code`, not by guessing from the layout.
    expect(matchKeybind(keybinds, new KeyboardEvent("keydown", { key: ">", ctrlKey: true, shiftKey: true }))).toBe(
      false,
    )
    // Shift state is still part of the match: the base "." without shift must not fire.
    expect(matchKeybind(keybinds, new KeyboardEvent("keydown", { key: ".", code: "Period", ctrlKey: true }))).toBe(
      false,
    )
  })

  test("matchKeybind supports bracket keys", () => {
    const keybinds = parseKeybind("mod+alt+[, mod+alt+]")
    const prev = keybinds[0]
    const next = keybinds[1]

    expect(
      matchKeybind(
        keybinds,
        new KeyboardEvent("keydown", { key: "[", ctrlKey: prev?.ctrl, metaKey: prev?.meta, altKey: true }),
      ),
    ).toBe(true)
    expect(
      matchKeybind(
        keybinds,
        new KeyboardEvent("keydown", { key: "]", ctrlKey: next?.ctrl, metaKey: next?.meta, altKey: true }),
      ),
    ).toBe(true)
  })

  test("formatKeybind returns human readable output", () => {
    const display = formatKeybind("ctrl+alt+arrowup")

    expect(display).toContain("↑")
    expect(display.includes("Ctrl") || display.includes("⌃")).toBe(true)
    expect(display.includes("Alt") || display.includes("⌥")).toBe(true)
    expect(formatKeybind("none")).toBe("")
  })

  test("formatKeybind prefers the first combo", () => {
    const display = formatKeybind("mod+k,mod+p")

    expect(display.includes("K") || display.includes("k")).toBe(true)
    expect(display.includes("P") || display.includes("p")).toBe(false)
  })
})
