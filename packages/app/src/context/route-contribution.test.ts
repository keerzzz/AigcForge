import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createRouteContributionRegistry, type SessionContribution } from "./route-contribution"
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
