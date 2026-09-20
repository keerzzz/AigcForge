import { createEffect, createMemo, createResource, createSignal, ErrorBoundary, For, Suspense } from "solid-js"
import * as Sentry from "@sentry/solid"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { useLanguage } from "@/context/language"
import { SurfacePending } from "@/pages/surface-pending"
import { createStore } from "solid-js/store"
import { ModeSlotActiveProvider } from "@/pages/mode-slot-active"
import { CustomDraftProvider } from "@/context/custom-draft"
import { modeSurface } from "@/components/mode-surfaces"
import { LocationApprovalCenter } from "@/components/approval-center"
import { useServerSync } from "@/context/server-sync"
import { type DirectorySDK } from "@/context/sdk"
import { AssetWorkbench } from "@/components/chat/asset-workbench"
import { useMode } from "@/context/mode"
import { useServer } from "@/context/server"
import { ServerConnection } from "@/context/server"
import { ModeWorkspaceAssetCtx, CodingSelectionCtx, AssistantSelectionCtx } from "@/pages/mode-workspace-context"
import { ChatAssetsProvider, useChatAssets } from "@/components/chat/chat-assets"
import { useModeDirectory } from "@/pages/mode-workspace-context"
import type { HomeProjectSelection } from "@/pages/layout/helpers"
import type { AssistantNavSelection } from "@/components/assistant-nav-model"

const ALL_SLOTS = ["chat", "coding", "work", "assistant", "custom"] as const

/**
 * What one slot shows while its own resources resolve.
 *
 * Each slot gets its own boundary because otherwise a pending read escapes to the route
 * boundary in `layout.tsx` and every slot disappears behind the route fallback — measured: with
 * `/workflow-asset` held open, arriving at Work made all five slots vanish. Render-all exists so
 * that switching modes keeps each mode's UI state, and losing every slot to one mode's request
 * is exactly what it is supposed to prevent.
 *
 * Solid's `Suspense` keeps its children alive while showing the fallback, so this contains the
 * wait without unmounting anything.
 */
/**
 * What one slot shows when its own resources reject.
 *
 * Measured before this existed: a 500 from `/workflow-asset` reached the app's top-level
 * `ErrorBoundary` and replaced the entire application with "Something went wrong" — one asset
 * endpoint took down every mode. The per-kind settling in `mode-workspace.tsx` and
 * `mode-surfaces.tsx` covers the chat asset lists; work's `workflowAsset.list()` resource is
 * read directly, and the SDK's interceptor throws on a non-2xx, so it had nothing above it.
 *
 * Borrows the danger vocabulary from `AssetLoadError` rather than that component itself: its
 * contract is which asset *kinds* failed, and reporting a slot failure through it would say
 * something untrue. `reset` remounts the slot's subtree, which is what gives the resource a
 * second attempt.
 */
function SlotError(props: { error: unknown; reset: () => void }) {
  const language = useLanguage()
  // Containing the failure must not also hide it: `app.tsx:376-379` reports what reaches the
  // top-level boundary, and without this the slot boundary would swallow exactly the errors it
  // was added to catch — quieter logs, same broken surface.
  Sentry.captureException(props.error)
  return (
    <div
      data-component="mode-slot-error"
      class="m-3 flex items-center gap-2 rounded-md border border-v2-state-border-danger bg-v2-state-bg-danger px-2 py-1.5"
      role="alert"
    >
      <Icon name="warning" size="small" class="shrink-0 text-v2-state-fg-danger" />
      <span class="min-w-0 flex-1 text-11-regular text-v2-state-fg-danger">{language.t("mode.slot.error")}</span>
      <ButtonV2 variant="neutral" size="small" onClick={props.reset}>
        {language.t("asset.load.retry")}
      </ButtonV2>
    </div>
  )
}

/**
 * Chat asset owner (S3-3) is mounted here, gated by the `chatShown` latch: nothing runs
 * until Chat is shown once, so opening another mode does not issue Chat's seven list
 * requests (P2-14). The session secondary sidebar mounts the same provider with its own
 * directory — see `components/chat/chat-assets.tsx`.
 */
export function ModeWorkspace() {
  const mode = useMode()
  const server = useServer()
  const { directory: chatDirectory } = useModeDirectory()
  const [chatShown, setChatShown] = createSignal(false)
  createEffect(() => {
    if (mode.currentMode === "chat") setChatShown(true)
  })
  const directory = createMemo(() => (chatShown() ? chatDirectory() : undefined))

  return (
    <ChatAssetsProvider
      serverKey={() => (server.current ? ServerConnection.key(server.current) : undefined)}
      directory={directory}
    >
      <ModeWorkspaceBody />
    </ChatAssetsProvider>
  )
}

function ModeWorkspaceBody() {
  const mode = useMode()
  const server = useServer()
  const { ctx: chatCtx, directory: chatDirectory } = useModeDirectory()
  const assets = useChatAssets()

  const [codingSel, setCodingSel] = createStore({
    selection: { server: server.key } as HomeProjectSelection,
  })
  const codingValue = {
    get selection() {
      return codingSel.selection
    },
    selectServer: (key: ServerConnection.Key) => setCodingSel("selection", { server: key }),
    selectProject: (key: ServerConnection.Key, directory: string) =>
      setCodingSel("selection", { server: key, directory }),
  }

  const [assistantSel, setAssistantSel] = createStore<{ selection: AssistantNavSelection }>({ selection: undefined })
  const assistantValue = {
    get selection() {
      return assistantSel.selection
    },
    select: (selection: AssistantNavSelection) => setAssistantSel("selection", selection),
  }

  // S6 RED 4: the Custom draft is owned here, above both slots, so the Sidebar and
  // the Main share one Provider instead of relying on a module-level map to hand them
  // the same store. Derived from `ctx.sdk.scope` + directory directly — the same pair
  // `ensureDirSdkContext` would surface, without building an SDK to read two fields.
  const customLocation = createMemo(() => {
    const dir = chatDirectory()
    const currentCtx = chatCtx()
    if (!dir || !currentCtx) return undefined
    return { scope: currentCtx.sdk.scope, directory: dir }
  })

  const assetCtx = {
    chatDirSdk: assets.dirSdk,
    chatAssetList: assets.list,
    chatSystemData: assets.systemData,
    mergedAssetData: assets.merged,
    assetCounts: assets.counts,
    refetchAssets: assets.refetch,
  }

  return (
    <ModeWorkspaceAssetCtx.Provider value={assetCtx}>
      <CodingSelectionCtx.Provider value={codingValue}>
        <AssistantSelectionCtx.Provider value={assistantValue}>
          <CustomDraftProvider location={customLocation}>
            <div
              data-mode-workspace
              class="rounded-[10px] shadow-[var(--v2-elevation-raised)] m-2 min-h-0 lg:overflow-hidden bg-v2-background-bg-base self-stretch flex-1 flex flex-col"
            >
              <LocationApprovalCenter />
              <div
                class={
                  "mx-auto grid h-full w-full grid-rows-[auto_minmax(0,1fr)_auto] gap-4 px-3 pb-3 lg:grid-rows-1 lg:px-6 lg:pb-16 lg:gap-8" +
                  (mode.currentMode === "chat"
                    ? " max-w-[1080px] lg:grid-cols-[280px_minmax(0,960px)]"
                    : mode.currentMode === "work"
                      ? " max-w-[1080px] lg:grid-cols-[280px_minmax(0,960px)]"
                      : " max-w-[1080px] lg:grid-cols-[280px_minmax(0,720px)]")
                }
              >
                {/* Sidebar slot: render-all + display:none */}
                <div>
                  <For each={ALL_SLOTS}>
                    {(slot) => {
                      const surf = modeSurface(slot)
                      return (
                        <div data-mode-sidebar={slot} style={{ display: mode.currentMode === slot ? "" : "none" }}>
                          <ModeSlotActiveProvider value={() => mode.currentMode === slot}>
                            <ErrorBoundary fallback={(error, reset) => <SlotError error={error} reset={reset} />}>
                              <Suspense fallback={<SurfacePending owner="slot" class="flex-1 py-6" />}>
                                <surf.Sidebar />
                              </Suspense>
                            </ErrorBoundary>
                          </ModeSlotActiveProvider>
                        </div>
                      )
                    }}
                  </For>
                </div>
                {/* Main slot: render-all + display:none */}
                <section class="min-h-0 min-w-0 flex-1 flex flex-col" aria-label="Main content">
                  <For each={ALL_SLOTS}>
                    {(slot) => {
                      const surf = modeSurface(slot)
                      return (
                        <div
                          data-mode-main={slot}
                          class="flex min-h-0 flex-1 flex-col pt-6 lg:pt-12"
                          style={{ display: mode.currentMode === slot ? "flex" : "none" }}
                        >
                          <ModeSlotActiveProvider value={() => mode.currentMode === slot}>
                            <ErrorBoundary fallback={(error, reset) => <SlotError error={error} reset={reset} />}>
                              <Suspense fallback={<SurfacePending owner="slot" class="flex-1 py-6" />}>
                                <surf.Main />
                              </Suspense>
                            </ErrorBoundary>
                          </ModeSlotActiveProvider>
                        </div>
                      )
                    }}
                  </For>
                </section>
              </div>
            </div>
          </CustomDraftProvider>
        </AssistantSelectionCtx.Provider>
      </CodingSelectionCtx.Provider>
    </ModeWorkspaceAssetCtx.Provider>
  )
}
