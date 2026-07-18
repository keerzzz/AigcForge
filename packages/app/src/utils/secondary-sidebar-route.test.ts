import { describe, expect, test } from "bun:test"
import { secondarySidebarAvailable } from "./secondary-sidebar-route"

describe("secondary sidebar routes", () => {
  test("hides the sidebar only on the launcher and draft route", () => {
    expect(secondarySidebarAvailable("/")).toBe(false)
    expect(secondarySidebarAvailable("/new-session")).toBe(false)
  })

  test("shows the mode-specific sidebar on mode and session routes", () => {
    expect(secondarySidebarAvailable("/mode/chat")).toBe(true)
    expect(secondarySidebarAvailable("/mode/coding")).toBe(true)
    expect(secondarySidebarAvailable("/server/local/session/session-1")).toBe(true)
  })
})
