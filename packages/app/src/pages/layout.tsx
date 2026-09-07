import { createEffect, Suspense, type ParentProps, Show } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { DebugBar } from "@/components/debug-bar"
import { HelpButton } from "@/components/help-button"
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
import { SurfacePending } from "@/pages/surface-pending"

function LayoutContent(props: ParentProps & { update: TitlebarUpdate }) {
  const mode = useMode()
  const layout = useLayout()
  const statusSource = createCurrentSessionSource()

  const showSecondarySidebar = () => mode.secondarySidebarOpen && layout.route().type === "session"

  return (
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
          <SecondarySidebar />
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
          <Suspense fallback={<SurfacePending owner="route" class="flex-1 self-stretch" />}>{props.children}</Suspense>
        </main>
      </div>
      <StatusBar source={statusSource} />
      {import.meta.env.DEV && <DebugBar />}
      <HelpButton />
      <ToastRegion />
    </div>
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
