import { Logo } from "@omnixa/ui/logo"
import { onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import "./wordmark.css"

export function NewSessionWordmark() {
  const [state, setState] = createStore({ complete: false, visible: document.visibilityState === "visible" })
  onMount(() => {
    const updateVisibility = () => setState("visible", document.visibilityState === "visible")
    document.addEventListener("visibilitychange", updateVisibility)
    updateVisibility()
    onCleanup(() => document.removeEventListener("visibilitychange", updateVisibility))
  })

  return (
    <div
      data-component="new-session-wordmark"
      data-visible={state.visible ? "true" : "false"}
      data-complete={state.complete ? "true" : undefined}
      aria-hidden="true"
      class="pointer-events-none mx-auto w-full max-w-[720px] text-v2-background-bg-inverse"
      onAnimationEnd={(event) => {
        if (event.animationName === "new-session-wordmark-shimmer") setState("complete", true)
      }}
    >
      <div data-slot="wordmark-reveal" class="relative mx-auto w-4/5">
        <Logo class="block aspect-[720/129] w-full opacity-[0.16]" />
        <Logo class="wordmark-shimmer absolute inset-0 aspect-[720/129] w-full" />
      </div>
    </div>
  )
}
