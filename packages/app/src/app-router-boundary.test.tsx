import { afterEach, describe, expect, test } from "bun:test"
import { createMemoryHistory, MemoryRouter, Route, useNavigate, type BaseRouterProps } from "@solidjs/router"
import { type Component, createSignal, type JSX, Show } from "solid-js"
import { render } from "solid-js/web"
import { AppRouterBoundary } from "./app-router-boundary"

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
})

function mount(view: () => JSX.Element) {
  const container = document.createElement("div")
  document.body.append(container)
  dispose = render(view, container)
  return container
}

const settle = async () => {
  await new Promise<void>((resolve) => queueMicrotask(resolve))
  await new Promise<void>((resolve) => queueMicrotask(resolve))
}

function throwing(message: string): never {
  throw new Error(message)
}

describe("AppRouterBoundary", () => {
  test("the next navigation after a fatal render error uses the same router", async () => {
    const history = createMemoryHistory()
    let routerMounts = 0
    let navigate: ReturnType<typeof useNavigate> | undefined
    let fail: (() => void) | undefined

    const CountingRouter: Component<BaseRouterProps> = (props) => {
      routerMounts += 1
      return <MemoryRouter {...props} history={history} />
    }

    function Shell(props: { outlet: () => JSX.Element }) {
      navigate = useNavigate()
      const [broken, setBroken] = createSignal(false)
      fail = () => setBroken(true)
      const Crash = () => throwing("route-render")
      return (
        <Show when={!broken()} fallback={<Crash />}>
          {props.outlet()}
        </Show>
      )
    }

    const container = mount(() => (
      <AppRouterBoundary.Root
        router={CountingRouter}
        routes={() => (
          <>
            <Route path="/" component={() => <div data-route="home" />} />
            <Route path="/next" component={() => <div data-route="next" />} />
          </>
        )}
        fallback={() => <div data-fatal="true" />}
        render={(outlet) => <Shell outlet={outlet} />}
      />
    ))

    expect(container.querySelector('[data-route="home"]')).not.toBeNull()
    fail?.()
    await settle()
    expect(container.querySelector('[data-fatal="true"]')).not.toBeNull()

    await navigate?.("/next")
    await settle()
    expect(history.get()).toBe("/next")
    expect(container.querySelector('[data-route="next"]')).not.toBeNull()
    expect(routerMounts).toBe(1)
  })

  test("provider construction errors still reach the fatal fallback", async () => {
    const history = createMemoryHistory()
    let routerMounts = 0
    let captures = 0
    const CountingRouter: Component<BaseRouterProps> = (props) => {
      routerMounts += 1
      return <MemoryRouter {...props} history={history} />
    }

    const container = mount(() => (
      <AppRouterBoundary.Root
        router={CountingRouter}
        routes={() => <Route path="/" component={() => <div data-route="home" />} />}
        fallback={() => {
          captures += 1
          return <div data-fatal="true" />
        }}
        render={() => throwing("provider-construction")}
      />
    ))

    await settle()
    expect(container.querySelector('[data-fatal="true"]')).not.toBeNull()
    expect(captures).toBe(1)
    expect(routerMounts).toBe(1)
  })

  test("an error-free navigation neither remounts the router nor shows the fallback", async () => {
    const history = createMemoryHistory()
    let routerMounts = 0
    let navigate: ReturnType<typeof useNavigate> | undefined
    const CountingRouter: Component<BaseRouterProps> = (props) => {
      routerMounts += 1
      return <MemoryRouter {...props} history={history} />
    }

    function Shell(props: { outlet: () => JSX.Element }) {
      navigate = useNavigate()
      return props.outlet()
    }

    const container = mount(() => (
      <AppRouterBoundary.Root
        router={CountingRouter}
        routes={() => (
          <>
            <Route path="/" component={() => <div data-route="home" />} />
            <Route path="/next" component={() => <div data-route="next" />} />
          </>
        )}
        fallback={() => <div data-fatal="true" />}
        render={(outlet) => <Shell outlet={outlet} />}
      />
    ))

    await navigate?.("/next")
    await settle()
    expect(container.querySelector('[data-route="next"]')).not.toBeNull()
    expect(container.querySelector('[data-fatal="true"]')).toBeNull()
    expect(routerMounts).toBe(1)
  })
})
