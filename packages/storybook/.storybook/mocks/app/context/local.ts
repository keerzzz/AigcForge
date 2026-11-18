import { createComponent, createContext, useContext, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"

const model = {
  id: "claude-3-7-sonnet",
  name: "Claude 3.7 Sonnet",
  provider: { id: "anthropic" },
  variants: { fast: {}, thinking: {} },
}

const agents = [{ name: "build" }, { name: "review" }, { name: "plan" }]

function createLocal() {
  const [state, setState] = createStore<{ agent: string; variant?: string; draftID?: string }>({
    agent: agents[0].name,
  })
  return {
    slug: () => "c3Rvcnk=",
    locked: () => false,
    metaSelected: () => state.agent === "meta",
    composition: {
      snapshot: () => undefined,
      loading: () => false,
      error: () => "",
      load: () => {},
    },
    agent: {
      available: () => agents,
      list: () => agents,
      current: () => agents.find((item) => item.name === state.agent) ?? agents[0],
      set(value?: string) {
        const hit = agents.find((item) => item.name === value)
        setState("agent", hit?.name ?? agents[0].name)
      },
    },
    model: {
      ready: Object.assign(() => true, { promise: undefined }),
      current: () => model,
      list: () => [model],
      recent: () => [model],
      variant: {
        list: () => Object.keys(model.variants),
        current: () => state.variant,
        set(next?: string) {
          setState("variant", next)
        },
      },
    },
    session: {
      ready: () => true,
      bindDraft: (id: string) => setState("draftID", id),
      draftID: () => state.draftID,
      reset: () => setState({ agent: agents[0].name, variant: undefined, draftID: undefined }),
    },
  }
}

const LocalContext = createContext(createLocal())

export function LocalProvider(props: ParentProps) {
  return createComponent(LocalContext.Provider, {
    value: createLocal(),
    get children() {
      return props.children
    },
  })
}

export function useLocal() {
  return useContext(LocalContext)
}
