import { createEffect, createMemo, createResource, createSignal, For } from "solid-js"
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

  const [chatDirSdk, setChatDirSdk] = createSignal<DirectorySDK | undefined>()
  createEffect(() => {
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
                            <surf.Sidebar />
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
                            <surf.Main />
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
