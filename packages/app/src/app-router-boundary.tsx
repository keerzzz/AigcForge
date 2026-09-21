export * as AppRouterBoundary from "./app-router-boundary"

import { Router, type BaseRouterProps } from "@solidjs/router"
import { type Component, ErrorBoundary, type JSX } from "solid-js"
import { Dynamic } from "solid-js/web"

export type Props = {
  router?: Component<BaseRouterProps>
  routes: () => JSX.Element
  fallback: (error: unknown) => JSX.Element
  render: (routeOutlet: () => JSX.Element) => JSX.Element
}

/**
 * Keeps the router context outside Solid's resettable error boundary while retaining one fatal
 * boundary around the complete application/provider subtree. Router navigation resets the
 * boundary, but can no longer replace the router whose transition is still committing.
 */
export function Root(props: Props) {
  return (
    <Dynamic
      component={props.router ?? Router}
      root={(route) => (
        <ErrorBoundary fallback={(error) => props.fallback(error)}>{props.render(() => route.children)}</ErrorBoundary>
      )}
    >
      {props.routes()}
    </Dynamic>
  )
}
