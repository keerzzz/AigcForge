import { describe, expect, test } from "bun:test"
import { secondarySidebarAvailable } from "./secondary-sidebar-route"

describe("secondary sidebar routes", () => {
  test("hides the sidebar on module entry and draft routes", () => {
    expect(secondarySidebarAvailable("/")).toBe(false)
    expect(secondarySidebarAvailable("/mode/chat")).toBe(false)
    expect(secondarySidebarAvailable("/mode/coding")).toBe(false)
    expect(secondarySidebarAvailable("/new-session")).toBe(false)
  })

  test("keeps the sidebar available on session routes", () => {
    expect(secondarySidebarAvailable("/server/local/session/session-1")).toBe(true)
  })
})
