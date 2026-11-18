import { describe, expect, test } from "bun:test"
import { acceptedLastActiveUrl } from "./route-storage"

describe("desktop last active route", () => {
  test("restores current desktop routes and falls back for invalid saved routes", () => {
    expect(acceptedLastActiveUrl("/")).toBe("/")
    expect(acceptedLastActiveUrl("/settings?server=local&tab=models")).toBe("/settings?server=local&tab=models")
    expect(acceptedLastActiveUrl("/new-session?directory=C%3A%5Cwork#draft")).toBe(
      "/new-session?directory=C%3A%5Cwork#draft",
    )
    expect(acceptedLastActiveUrl("/server/wsl%3ADebian/session/abc?view=review#file")).toBe(
      "/server/wsl%3ADebian/session/abc?view=review#file",
    )
    for (const mode of ["chat", "coding", "work", "assistant", "custom"]) {
      const route = `/mode/${mode}?tab=sessions#saved`
      expect(acceptedLastActiveUrl(route)).toBe(route)
    }
    expect(acceptedLastActiveUrl(undefined)).toBe("/")
    expect(acceptedLastActiveUrl("/settings/extra")).toBe("/")
    expect(acceptedLastActiveUrl("/new-session/extra")).toBe("/")
    expect(acceptedLastActiveUrl("/server/sidecar/session/abc/extra")).toBe("/")
    for (const route of ["/mode/", "/mode/unknown", "/mode/Work", "/mode/work/extra", "/mode/%77ork"]) {
      expect(acceptedLastActiveUrl(route)).toBe("/")
    }
  })
})
