import { createContext, createSignal, useContext, type ParentProps } from "solid-js"
import type { ServerConnection } from "@/context/server"
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
