import { Splash } from "@omnixa/ui/logo"
import { Wordmark } from "@omnixa/ui/wordmark"
import type { Platform } from "@omnixa/app/desktop"
import { onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import "./splash.css"

export function LoadingSplash(props: {
  deep: boolean
  firstLaunch: boolean
  platform: Pick<Platform, "os" | "webviewZoom">
  preview: boolean
  onDrawEnd: () => void
}) {
  const [drawing, setDrawing] = createStore({
    started: false,
    complete: false,
    visible: document.visibilityState === "visible",
  })
  const finishDrawing = () => {
    if (drawing.complete) return
    setDrawing("complete", true)
    props.onDrawEnd()
  }

  onMount(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => {
      setDrawing("visible", document.visibilityState === "visible")
      if (!drawing.visible || (props.preview && !document.hasFocus())) return
      if (props.preview && props.firstLaunch) setDrawing("started", true)

      if (props.firstLaunch && motion.matches) finishDrawing()
    }

    window.addEventListener("focus", update)
    document.addEventListener("visibilitychange", update)
    motion.addEventListener("change", update)
    update()
    onCleanup(() => {
      window.removeEventListener("focus", update)
      document.removeEventListener("visibilitychange", update)
      motion.removeEventListener("change", update)
    })
  })

  const titlebarHeight = () => {
    const zoom = props.platform.webviewZoom?.() ?? 1

    if (props.platform.os === "macos") return `max(36px, ${36 / zoom}px)`

    if (props.platform.os === "windows")
      return `max(36px, env(titlebar-area-height, ${44 / Math.min(Math.max(zoom, 0.25), 1)}px))`

    return "36px"
  }

  return (
    <Show
      when={props.firstLaunch}
      fallback={
        <div
          data-component="startup-splash"
          data-visible={drawing.visible ? "true" : "false"}
          class="h-dvh w-screen flex flex-col items-center justify-center"
          classList={{
            "bg-v2-background-bg-deep": props.deep,
            "bg-v2-background-bg-base": !props.deep,
          }}
        >
          <Splash class="size-16 text-v2-icon-icon-base" />
        </div>
      }
    >
      <div
        data-component="first-launch-splash"
        data-visible={drawing.visible ? "true" : "false"}
        data-drawing={props.preview && !drawing.started ? "pending" : "running"}
        aria-hidden="true"
        class="h-dvh w-screen bg-v2-background-bg-base"
        style={{
          // Match the default session's titlebar, panel insets, and wordmark position.
          "padding-block-start": `calc(${titlebarHeight()} + ${props.platform.os === "windows" ? 1 : 8}px)`,
          "padding-block-end": "8px",
          "padding-inline": "32px",
        }}
      >
        <div class="relative size-full">
          <div class="absolute inset-x-0 top-[25.375%]">
            <div class="relative mx-auto w-full max-w-[720px]">
              <div
                data-slot="first-launch-emblem"
                class="pointer-events-none absolute inset-x-0 -top-20 flex justify-center"
              >
                <div class="relative size-14">
                  <svg
                    data-slot="shockwave"
                    class="absolute inset-0 size-full overflow-visible"
                    viewBox="0 0 100 100"
                    fill="none"
                  >
                    <circle
                      cx="50"
                      cy="50"
                      r="25"
                      stroke="var(--omnxa-core-color, var(--v2-icon-brand-core, #00abcfff))"
                      stroke-width="2"
                    />
                  </svg>
                  <Splash class="size-full overflow-visible text-v2-icon-icon-base" />
                </div>
              </div>
              <Wordmark
                outline
                fade={false}
                muted={false}
                class="mx-auto block h-auto w-4/5 text-v2-icon-icon-faint opacity-50"
                onAnimationEnd={(event) => {
                  if (
                    event.animationName === "first-launch-wordmark-draw" &&
                    event.target === event.currentTarget.querySelector("path")
                  )
                    finishDrawing()
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </Show>
  )
}
