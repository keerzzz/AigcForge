import { describe, expect, test } from "bun:test"
import { ServerConnection } from "@/context/server"
import { readSessionTabsRemovedDetail, SESSION_TABS_REMOVED_EVENT } from "./titlebar-session-events"

describe("titlebar session events", () => {
  test("reads valid removed session tab details", () => {
    expect(
      readSessionTabsRemovedDetail(
        new CustomEvent(SESSION_TABS_REMOVED_EVENT, {
          detail: { server: "http://localhost:4096/", directory: "/tmp/project", sessionIDs: ["ses_1", "ses_2", 1] },
        }),
      ),
    ).toEqual({
      server: ServerConnection.Key.make("http://localhost:4096/"),
      directory: "/tmp/project",
      sessionIDs: ["ses_1", "ses_2"],
    })
  })

  test("ignores invalid removed session tab details", () => {
    expect(readSessionTabsRemovedDetail(new Event(SESSION_TABS_REMOVED_EVENT))).toBeUndefined()
    expect(
      readSessionTabsRemovedDetail(
        new CustomEvent(SESSION_TABS_REMOVED_EVENT, {
          detail: { server: "sidecar", directory: "/tmp/project", sessionIDs: [] },
        }),
      ),
    ).toBeUndefined()
  })

  test.each([undefined, null, 1, ""])("ignores events without a server identity: %s", (server) => {
    expect(
      readSessionTabsRemovedDetail(
        new CustomEvent(SESSION_TABS_REMOVED_EVENT, {
          detail: { server, directory: "/tmp/project", sessionIDs: ["ses_1"] },
        }),
      ),
    ).toBeUndefined()
  })

  test("preserves caller-owned navigation and rejects invalid navigation flags", () => {
    const detail = {
      server: ServerConnection.Key.make("sidecar"),
      directory: "/tmp/project",
      sessionIDs: ["ses_1"],
      navigate: false,
    }
    expect(readSessionTabsRemovedDetail(new CustomEvent(SESSION_TABS_REMOVED_EVENT, { detail }))).toEqual(detail)
    expect(
      readSessionTabsRemovedDetail(
        new CustomEvent(SESSION_TABS_REMOVED_EVENT, { detail: { ...detail, navigate: "false" } }),
      ),
    ).toBeUndefined()
  })
})
