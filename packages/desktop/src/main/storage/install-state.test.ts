import { describe, expect, test } from "bun:test"
import { hasExistingAppState } from "./install-state"

const file = (name: string) => ({ name, directory: false })

const directory = (name: string) => ({ name, directory: true })

describe("hasExistingAppState", () => {
  test("recognizes state from an earlier AigcForge launch but not files Electron creates on a fresh install", () => {
    expect(hasExistingAppState([])).toBe(false)
    expect(hasExistingAppState([file("Local State"), directory("Crashpad")])).toBe(false)
    expect(hasExistingAppState([file("aigcfroge.settings")])).toBe(true)
    expect(hasExistingAppState([file("drafts.sqlite")])).toBe(true)
    expect(hasExistingAppState([file("window-state-abc.json")])).toBe(true)
    expect(hasExistingAppState([directory("aigcfroge")])).toBe(true)
  })
})
