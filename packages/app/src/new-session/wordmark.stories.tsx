import { NewSessionWordmark } from "./wordmark"
import { createStore } from "solid-js/store"

export default {
  title: "App/New Session/Wordmark",
  id: "app-new-session-wordmark",
  component: NewSessionWordmark,
}

export const Reveal = {
  render: () => <NewSessionWordmark />,
}

export const StartupHandoff = {
  render: () => {
    const [state, setState] = createStore({ covering: true, hidden: false })
    return (
      <section aria-label="Wordmark startup handoff">
        <div class="flex gap-2 pb-4">
          <button type="button" onClick={() => setState("covering", !state.covering)}>
            {state.covering ? "Reveal work surface" : "Cover work surface"}
          </button>
          <button type="button" onClick={() => setState("hidden", !state.hidden)}>
            {state.hidden ? "Show wordmark" : "Hide wordmark"}
          </button>
        </div>
        <div data-startup-covering={state.covering ? "true" : "false"} hidden={state.hidden}>
          <NewSessionWordmark />
        </div>
      </section>
    )
  },
}
