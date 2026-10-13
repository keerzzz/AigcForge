import { createContext, createSignal, useContext, type Accessor, type ParentProps } from "solid-js"
import { ServerConnection } from "@/context/server"
import type { useNotification } from "./notification"
import type { usePermission } from "./permission"
import type { LayoutRoute } from "@/context/layout-helpers"
import type { AssistantPanelTab } from "@/utils/assistant-panel"
import type { ServerScope, SessionStateKey } from "@/utils/server-scope"

export type SessionContribution = {
  routeIdentity: string
  activeTopLevelTabKey: string
  key: SessionStateKey
  server: ServerConnection.Key
  scope: ServerScope
  directory: string
  leafID: string
  openContext: () => void
  sessionStatus: Pick<ReturnType<typeof useNotification>["session"], "unseenCount" | "unseenHasError"> &
    Pick<ReturnType<typeof usePermission>, "autoResponds">
  assistantPanel: {
    available: Accessor<boolean>
    active: Accessor<string | undefined>
    target: Accessor<string | undefined>
    open: (kind: AssistantPanelTab, itemId?: string) => void
  }
}

/** Only the resolved owner of the displayed route may handle shell actions. */
export function sessionContributionForRoute(value: SessionContribution | undefined, route: LayoutRoute) {
  if (!value || route.type !== "session" || !route.server) return undefined
  if (value.leafID !== route.sessionId || !ServerConnection.sameKey(value.server, route.server)) return undefined
  return value
}

export type RouteContributionContext = {
  current: () => SessionContribution | undefined
  register: (value: SessionContribution) => () => void
}

export function createRouteContributionRegistry(): RouteContributionContext {
  const [current, setCurrent] = createSignal<{ token: symbol; value: SessionContribution }>()
  return {
    current: () => current()?.value,
    register: (value) => {
      const token = Symbol("route-contribution")
      setCurrent({ token, value })
      return () => {
        if (current()?.token === token) setCurrent(undefined)
      }
    },
  }
}

const Ctx = createContext<RouteContributionContext>()

export function RouteContributionProvider(props: ParentProps) {
  const context = createRouteContributionRegistry()
  return <Ctx.Provider value={context}>{props.children}</Ctx.Provider>
}

export function useRouteContribution() {
  return useContext(Ctx)
}
