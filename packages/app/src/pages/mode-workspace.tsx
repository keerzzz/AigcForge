import { createEffect, createMemo, createResource, createSignal, For } from "solid-js"
import { createStore } from "solid-js/store"
import { ModeSlotActiveProvider } from "@/pages/mode-slot-active"
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
    const [promptsRes, skillsRes, mcpsRes, cmdsRes, agentsRes, workflowsRes, pluginsRes] = await Promise.all([
      sdk.client.promptAsset.list(),
      sdk.client.skillAsset.list(),
      sdk.client.mcpAsset.list(),
      sdk.client.commandAsset.list(),
      sdk.client.agentAsset.list(),
      sdk.client.workflowAsset.list(),
      sdk.client.pluginAsset.list(),
    ])
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
      return { assets: emptyAssets, invalid: emptyInvalid }
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
    return { assets: merged, invalid: project?.invalid ?? [] }
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
                      <div style={{ display: mode.currentMode === slot ? "" : "none" }}>
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
        </AssistantSelectionCtx.Provider>
      </CodingSelectionCtx.Provider>
    </ModeWorkspaceAssetCtx.Provider>
  )
}
