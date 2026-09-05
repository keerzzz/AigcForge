import { createEffect, createMemo, createResource, createSignal, ErrorBoundary, For, Suspense } from "solid-js"
import { Spinner } from "@aigcfroge/ui/spinner"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { useLanguage } from "@/context/language"
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
function SlotError(props: { reset: () => void }) {
  const language = useLanguage()
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

function SlotPending() {
  return (
    <div
      class="flex flex-1 items-center justify-center py-6 text-v2-text-text-muted"
      data-component="mode-slot-pending"
      role="status"
    >
      <Spinner class="size-4" />
    </div>
  )
}

export function ModeWorkspace() {
  const mode = useMode()
  const sync = useServerSync()
  const server = useServer()
  const { ctx: chatCtx, directory: chatDirectory } = useModeDirectory()

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

  // `chatAssetList` and `chatSystemData` are Chat-only — `ModeWorkspaceAssetCtx` has one
  // consumer, `ChatAssetWorkbenchMain` — but they are declared here, above every slot, so no
  // `ModeSlotActiveProvider` can reach them. Without a gate, opening any mode fetched Chat's
  // seven asset lists and started its MCP child sync.
  //
  // A latch rather than a live gate: clearing them on the way out of Chat would drop exactly
  // what render-all exists to preserve, and would refetch on every return. So nothing runs
  // until Chat is shown once, and after that behaviour is unchanged.
  const [chatShown, setChatShown] = createSignal(false)
  createEffect(() => {
    if (mode.currentMode === "chat") setChatShown(true)
  })

  const [chatDirSdk, setChatDirSdk] = createSignal<DirectorySDK | undefined>()
  createEffect(() => {
    if (!chatShown()) return
    const dir = chatDirectory()
    const currentCtx = chatCtx()
    if (!dir || !currentCtx) {
      setChatDirSdk(undefined)
      return
    }
    setChatDirSdk(currentCtx.sdk.ensureDirSdkContext(dir))
  })

  const [chatAssetList, { refetch: refetchAssets }] = createResource(chatDirSdk, async (sdk) => {
    // Each list is settled individually, so one failing endpoint contributes nothing
    // instead of rejecting the whole resource. That matters because `mergedAssetData`
    // below reads this resource, and reading a rejected resource throws into the
    // nearest boundary — the fallback-less `<Suspense>` at `pages/layout.tsx:43`. A
    // single 500 therefore used to blank the entire mode workspace, for every mode.
    // The failed kinds below feed the workbench's `AssetLoadError`. `ChatFeatureSidebar`
    // reads the same seven kinds through its own resource and settles them for exactly
    // the same reason — merging the two reads is recorded as debt, not done here.
    const settle = <T,>(call: Promise<T>): Promise<T | { data: undefined }> =>
      call.then(
        (value) => value,
        () => ({ data: undefined }),
      )
    const [promptsRes, skillsRes, mcpsRes, cmdsRes, agentsRes, workflowsRes, pluginsRes] = await Promise.all([
      settle(sdk.client.promptAsset.list()),
      settle(sdk.client.skillAsset.list()),
      settle(sdk.client.mcpAsset.list()),
      settle(sdk.client.commandAsset.list()),
      settle(sdk.client.agentAsset.list()),
      settle(sdk.client.workflowAsset.list()),
      settle(sdk.client.pluginAsset.list()),
    ])
    // Which kinds did not answer. Without this the workspace no longer blanks but the
    // failure is invisible — "silently one kind short" instead of an error.
    const failed = (
      [
        ["prompts", promptsRes],
        ["skills", skillsRes],
        ["mcp", mcpsRes],
        ["commands", cmdsRes],
        ["agents", agentsRes],
        ["workflows", workflowsRes],
        ["plugins", pluginsRes],
      ] as const
    ).flatMap(([kind, result]) => (result.data === undefined ? [kind] : []))
    const promptAssets = promptsRes.data?.assets ?? []
    const skillAssets = skillsRes.data?.assets ?? []
    const mcpAssets = mcpsRes.data?.assets ?? []
    const cmdAssets = cmdsRes.data?.assets ?? []
    const agentAssets = agentsRes.data?.assets ?? []
    const workflowAssets = workflowsRes.data?.assets ?? []
    const pluginAssets = pluginsRes.data?.assets ?? []
    const pluginInvalid = pluginsRes.data?.invalid ?? []
    const bridgedPlugins = pluginsRes.data?.bridged ?? []
    const promptInvalid = promptsRes.data?.invalid ?? []
    const skillInvalid = skillsRes.data?.invalid ?? []
    const mcpInvalid = mcpsRes.data?.invalid ?? []
    const cmdInvalid = cmdsRes.data?.invalid ?? []
    const agentInvalid = agentsRes.data?.invalid ?? []
    const workflowInvalid = workflowsRes.data?.invalid ?? []

    const bridgedPluginInputs: AssetWorkbench.AssetInput[] = bridgedPlugins.map((plugin) => ({
      kind: "plugin" as const,
      name: plugin.name,
      description: plugin.description,
      relativePath: plugin.originPath,
      revision: "",
      origin: "system" as const,
    }))

    const allAssets: AssetWorkbench.AssetInput[] = [
      ...promptAssets,
      ...skillAssets,
      ...mcpAssets,
      ...cmdAssets,
      ...agentAssets,
      ...workflowAssets,
      ...pluginAssets,
      ...bridgedPluginInputs,
    ]

    const invalidRows = AssetWorkbench.buildRows(
      [],
      [
        ...promptInvalid.map((item) => ({ ...item, kind: "prompt" as const })),
        ...skillInvalid.map((item) => ({ ...item, kind: "skill" as const })),
        ...mcpInvalid.map((item) => ({ ...item, kind: "mcp" as const })),
        ...cmdInvalid.map((item) => ({ ...item, kind: "command" as const })),
        ...agentInvalid.map((item) => ({ ...item, kind: "agent" as const })),
        ...workflowInvalid.map((item) => ({ ...item, kind: "workflow" as const })),
        ...pluginInvalid.map((item) => ({ ...item, kind: "plugin" as const })),
      ],
    )

    return {
      failed,
      assets: allAssets,
      invalid: invalidRows,
    }
  })

  const chatSystemData = createMemo(() => {
    if (!chatShown()) return undefined
    const dir = chatDirectory()
    if (!dir) return undefined
    return sync().child(dir, { mcp: true })[0]
  })

  const mergedAssetData = createMemo(() => {
    const project = chatAssetList()
    const system = chatSystemData()
    if (!project && !system) {
      const emptyAssets: AssetWorkbench.AssetInput[] = []
      const emptyInvalid: AssetWorkbench.AssetRow[] = []
      return { assets: emptyAssets, invalid: emptyInvalid, failed: [] as readonly string[] }
    }
    const merged = AssetWorkbench.mergeAssets(
      project?.assets ?? [],
      system
        ? AssetWorkbench.systemAssets({
            commands: system.command ?? [],
            agents: system.agent ?? [],
            mcp: system.mcp ?? {},
          })
        : [],
    )
    return { assets: merged, invalid: project?.invalid ?? [], failed: (project?.failed ?? []) as readonly string[] }
  })

  const assetCtx = {
    chatDirSdk,
    chatAssetList,
    chatSystemData,
    mergedAssetData,
    refetchAssets,
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
                            <ErrorBoundary fallback={(_error, reset) => <SlotError reset={reset} />}>
                              <Suspense fallback={<SlotPending />}>
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
                            <ErrorBoundary fallback={(_error, reset) => <SlotError reset={reset} />}>
                              <Suspense fallback={<SlotPending />}>
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
