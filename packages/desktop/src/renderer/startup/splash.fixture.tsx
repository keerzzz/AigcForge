import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import { LoadingSplash } from "./splash"

let dispose: (() => void) | undefined

export function mountStartupSplash(input: { firstLaunch: boolean; preview: boolean }) {
  dispose?.()
  document.querySelector('[data-testid="desktop-startup-fixture"]')?.remove()
  const root = document.createElement("div")
  root.dataset.testid = "desktop-startup-fixture"
  document.body.append(root)
  dispose = render(() => {
    const [state, setState] = createStore({ completions: 0 })
    return (
      <section aria-label="Desktop startup preview" class="fixed inset-0 z-[200]">
        <output aria-label="Drawing completions" class="absolute top-0 z-[201]">
          {state.completions}
        </output>
        <LoadingSplash
          deep={false}
          firstLaunch={input.firstLaunch}
          platform={{ os: "linux" }}
          preview={input.preview}
          onDrawEnd={() => setState("completions", (value) => value + 1)}
        />
      </section>
    )
  }, root)
}
