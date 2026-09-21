import { createEffect, createMemo, createSignal, onCleanup, Suspense, type ParentProps, Show } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { useNavigate, useParams } from "@solidjs/router"
import { DebugBar } from "@/components/debug-bar"
import { secondarySidebarShown } from "@/context/layout-helpers"
import { Titlebar, type TitlebarUpdate } from "@/components/titlebar"
import { useNotification } from "@/context/notification"
import { usePlatform } from "@/context/platform"
import { setNavigate } from "@/utils/notification-click"
import { ToastRegion } from "@/utils/toast"
import { ModeProvider, useMode } from "@/context/mode"
import { ChatFeatureProvider } from "@/context/chat-feature"
import { WorkSecondaryTabProvider } from "@/context/work-secondary-tab"
import { ModeSwitcher } from "@/components/mode-switcher"
import { SecondarySidebar } from "@/components/secondary-sidebar"
import { StatusBar } from "@/components/status-bar/status-bar"
import { createCurrentSessionSource } from "@/components/status-bar/current-session-source"
import { useLayout } from "@/context/layout"
import { useRouteContribution } from "@/context/route-contribution"
import { ChatAssetsProvider } from "@/components/chat/chat-assets"
import { SurfacePending } from "@/pages/surface-pending"

function LayoutContent(props: ParentProps & { update: TitlebarUpdate }) {
  const mode = useMode()
  const layout = useLayout()
  const isWide = createMediaQuery("(min-width: 1024px)")
  const statusSource = createCurrentSessionSource()

  const showSecondarySidebar = () => secondarySidebarShown(mode.secondarySidebarOpen, layout.route().type)

  // S11 `hidden-panel-request-and-remount`, secondary-sidebar half.
  //
  // The Chat asset owner used to live inside `ChatSessionSidebar`, under the `Show` below.
  // Closing the panel unmounted the owner with it, so reopening rebuilt the resource and
  // re-issued all seven asset lists — the repeat the debt row names.
  //
  // Hoisting alone is not enough: mounted unconditionally it would issue the seven reads on
  // every session route even for a user who never opens the panel (measured: an extra full
  // read in `chat-asset-categories.spec.ts`). The latch is the same shape `mode-workspace.tsx`
  // uses for the workspace provider — enable on first show, then stay enabled, so the settled
  // resource survives close/reopen without ever pre-fetching for a panel nobody opened.
  const routeContribution = useRouteContribution()
  const [sidebarAssetsShown, setSidebarAssetsShown] = createSignal(false)
  createEffect(() => {
    if (showSecondarySidebar()) setSidebarAssetsShown(true)
  })
  const chatAssetTarget = createMemo(() => {
    if (!sidebarAssetsShown()) return undefined
    if (mode.currentMode !== "chat") return undefined
    if (layout.route().type !== "session") return undefined
    const contribution = routeContribution?.current()
    if (!contribution) return undefined
    return { server: contribution.server, directory: contribution.directory }
  })

  // S7: below `lg` the panel floats OVER the content instead of docking beside it (see the
  // wrapper in the JSX), so it needs the two affordances an overlay owes a keyboard user:
  // Escape dismisses it, and focus returns to the control that opened it. Both are gated on
  // the same breakpoint as the floating behaviour, so desktop interaction is unchanged.
  // `createMediaQuery` rather than a raw `matchMedia().matches`: that value is not reactive,
  // so an effect reading it never re-runs when the breakpoint changes and the listener would
  // be installed (or never cleaned up) for the wrong width. Measured before this: open on
  // desktop then shrink, Escape did nothing; open narrow then grow, Escape still closed it.
  const panelFloats = () => !isWide()
  createEffect(() => {
    if (!showSecondarySidebar() || !panelFloats()) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      mode.toggleSecondarySidebar()
    }
    document.addEventListener("keydown", onKeyDown)
    onCleanup(() => document.removeEventListener("keydown", onKeyDown))
  })
  let panelWasOpen = false
  createEffect(() => {
    const open = mode.secondarySidebarOpen
    if (panelWasOpen && !open && panelFloats()) {
      document.getElementById("secondary-sidebar-toggle")?.focus()
    }
    panelWasOpen = open
  })

  return (
    <ChatAssetsProvider serverKey={() => chatAssetTarget()?.server} directory={() => chatAssetTarget()?.directory}>
      <div
        class="relative bg-v2-background-bg-deep flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
        style={{
          "padding-top": "env(safe-area-inset-top, 0px)",
          "padding-bottom": "env(safe-area-inset-bottom, 0px)",
        }}
      >
        <Titlebar update={props.update} />
        <div class="flex-1 min-h-0 min-w-0 flex">
          <Show when={location.pathname !== "/"}>
            <ModeSwitcher />
          </Show>
          <Show when={showSecondarySidebar()}>
            {/*
            S7: below `lg` the panel floats over the content instead of docking beside it.
            Docked at 390x844 it took 256px and left `<main>` 68px (measured), because the
            gate has no width condition while the PRIMARY sidebar's affordance is hidden
            below `xl`. Floating keeps the plan's requirement (an entry at 390x844) without
            destroying the session area; from `lg` up it is the same flex sibling as before.
            `relative` on the parent (above) is what this positions against.
          */}
            <div class="absolute inset-y-0 left-0 z-40 max-w-[85%] shadow-[var(--v2-elevation-raised)] lg:static lg:z-auto lg:max-w-none lg:shadow-none">
              <SecondarySidebar />
            </div>
          </Show>
          <main class="flex-1 min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-strict">
            {/*
            Stated precisely, because measuring it moved the blame: the reported blank `<main>`
            was a mode slot's resource suspending to this boundary, and the fix for that is the
            per-slot boundary in `mode-workspace.tsx`, which is what the e2e now pins.

            It has exactly one reachable trigger, and it is not tested yet: `app.tsx:64` loads
            `NewSession` through `lazy()`, so `/new-session` can suspend here while its module
            loads. Driving that from a test needs the Home new-session action to navigate, which
            is the P2-HOME-EMPTY defect — it silently returns today — so the coverage lands with
            that fix. Every other route is eagerly imported and reads no resource above the slot
            boundaries, so nothing else reaches this fallback.

            It stays regardless: a boundary with no fallback is what produced the P1, and three
            separate comments in this repo already point here as the hazard.
          */}
            <Suspense fallback={<SurfacePending owner="route" class="flex-1 self-stretch" />}>
              {props.children}
            </Suspense>
          </main>
        </div>
        <StatusBar source={statusSource} />
        {import.meta.env.DEV && <DebugBar />}
        <ToastRegion />
      </div>
    </ChatAssetsProvider>
  )
}

export default function Layout(props: ParentProps) {
  const platform = usePlatform()
  const notification = useNotification()
  const navigate = useNavigate()
  const params = useParams<{ id?: string }>()
  setNavigate(navigate)

  createEffect(() => {
    if (!notification.ready() || !params.id) return
    notification.session.markViewed(params.id)
  })

  const update: TitlebarUpdate = {
    version: () => {
      const state = platform.updater?.state()
      if (state?.status !== "ready") return
      return state.version
    },
    installing: () => platform.updater?.state().status === "installing",
    install: () => void platform.updater?.install(),
  }

  return (
    <ModeProvider>
      <ChatFeatureProvider>
        <WorkSecondaryTabProvider>
          <LayoutContent update={update}>{props.children}</LayoutContent>
        </WorkSecondaryTabProvider>
      </ChatFeatureProvider>
    </ModeProvider>
  )
}
