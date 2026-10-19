import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import {
  createRouteContributionRegistry,
  sessionContributionForRoute,
  type SessionContribution,
} from "./route-contribution"
import { ServerScope, SessionStateKey } from "@/utils/server-scope"
import { ServerConnection } from "./server"

const contribution = (routeIdentity: string): SessionContribution => ({
  routeIdentity,
  activeTopLevelTabKey: `tab:${routeIdentity}`,
  key: SessionStateKey.from(ServerScope.local, SessionStateKey.route(routeIdentity)),
  server: ServerConnection.Key.make("local"),
  scope: ServerScope.local,
  directory: `/${routeIdentity}`,
  leafID: routeIdentity,
  openContext() {},
  sessionStatus: { unseenCount: () => 0, unseenHasError: () => false, autoResponds: () => false },
  assistantPanel: { available: () => false, active: () => undefined, target: () => undefined, open() {} },
})

describe("sessionContributionForRoute", () => {
  test("returns the displayed Session owner, including canonical server aliases", () => {
    const value = { ...contribution("leaf"), server: ServerConnection.Key.make("http://localhost:4096") }
    const route = {
      type: "session" as const,
      server: ServerConnection.Key.make("http://127.0.0.1:4096"),
      sessionId: "leaf",
    }
    expect(sessionContributionForRoute(value, route)).toBe(value)
  })

  test("rejects a stale server or Session instead of directing actions to its panel", () => {
    const value = { ...contribution("leaf"), server: ServerConnection.Key.make("http://server-a:4096") }
    expect(
      sessionContributionForRoute(value, {
        type: "session",
        server: ServerConnection.Key.make("http://server-b:4096"),
        sessionId: "leaf",
      }),
    ).toBeUndefined()
    expect(
      sessionContributionForRoute(value, { type: "session", server: value.server, sessionId: "other-leaf" }),
    ).toBeUndefined()
    expect(sessionContributionForRoute(value, { type: "session", sessionId: "leaf" })).toBeUndefined()
    expect(sessionContributionForRoute(value, { type: "home" })).toBeUndefined()
    expect(
      sessionContributionForRoute(undefined, { type: "session", server: value.server, sessionId: "leaf" }),
    ).toBeUndefined()
  })
})

describe("createRouteContributionRegistry", () => {
  test("keeps the newest registration when an older token is disposed", () => {
    createRoot((dispose) => {
      const registry = createRouteContributionRegistry()
      const removeRoot = registry.register(contribution("root"))
      const removeLeaf = registry.register(contribution("leaf"))
      expect(registry.current()?.routeIdentity).toBe("leaf")
      removeRoot()
      expect(registry.current()?.routeIdentity).toBe("leaf")
      removeLeaf()
      expect(registry.current()).toBeUndefined()
      dispose()
    })
  })
})
