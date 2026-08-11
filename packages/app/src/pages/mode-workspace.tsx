import { createEffect, createMemo, createResource, createSignal, For } from "solid-js"
import { createStore } from "solid-js/store"
import { modeSurface } from "@/components/mode-surfaces"
import { useServerSync } from "@/context/server-sync"
import { type DirectorySDK } from "@/context/sdk"
import { AssetWorkbench } from "@/components/chat/asset-workbench"
import { useMode } from "@/context/mode"
import { useServer } from "@/context/server"
import { ServerConnection } from "@/context/server"
import { ModeWorkspaceAssetCtx, CodingSelectionCtx } from "@/pages/mode-workspace-context"
import { useChatDirectory } from "@/pages/mode-workspace-context"
import type { HomeProjectSelection } from "@/pages/layout/helpers"

const ALL_SLOTS = ["chat", "coding", "work", "assistant"] as const

export function ModeWorkspace() {
  const mode = useMode()
  const sync = useServerSync()
  const server = useServer()
  const { ctx: chatCtx, directory: chatDirectory } = useChatDirectory()

  // ---- Shared Coding Selection (sidebar ↔ main linkage) ----
  const [codingSel, setCodingSel] = createStore({
    selection: { server: server.key } as HomeProjectSelection,
  })
  const codingValue = {
    get selection() { return codingSel.selection },
    selectServer: (key: ServerConnection.Key) => setCodingSel("selection", { server: key }),
    selectProject: (key: ServerConnection.Key, directory: string) => setCodingSel("selection", { server: key, directory }),
  }

  // ---- Asset Resource ----
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

    const bridgedPluginInputs: AssetWorkbench.AssetInput[] = bridgedPlugins.map((b: any) => ({
      kind: "plugin" as const,
      name: b.name,
      description: b.description,
      relativePath: b.originPath,
      revision: "",
      origin: "system" as const,
    }))

    const allAssets: AssetWorkbench.AssetInput[] = [
      ...promptAssets, ...skillAssets, ...mcpAssets, ...cmdAssets, ...agentAssets, ...workflowAssets, ...pluginAssets, ...bridgedPluginInputs,
    ]

    const invalidRows: AssetWorkbench.AssetRow[] = [
      ...promptInvalid.map((i: any) => ({ ...i, kind: "prompt" as const })),
      ...skillInvalid.map((i: any) => ({ ...i, kind: "skill" as const })),
      ...mcpInvalid.map((i: any) => ({ ...i, kind: "mcp" as const })),
      ...cmdInvalid.map((i: any) => ({ ...i, kind: "command" as const })),
      ...agentInvalid.map((i: any) => ({ ...i, kind: "agent" as const })),
      ...workflowInvalid.map((i: any) => ({ ...i, kind: "workflow" as const })),
      ...pluginInvalid.map((i: any) => ({ ...i, kind: "plugin" as const })),
    ]

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
      <div data-mode-workspace class="rounded-[10px] shadow-[var(--v2-elevation-raised)] m-2 min-h-0 lg:overflow-hidden bg-v2-background-bg-base self-stretch flex-1 flex flex-col">
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
                    <surf.Sidebar />
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
                  <div class="flex min-h-0 flex-1 flex-col pt-6 lg:pt-12" style={{ display: mode.currentMode === slot ? "flex" : "none" }}>
                    <surf.Main />
                  </div>
                )
              }}
            </For>
          </section>
        </div>
      </div>
      </CodingSelectionCtx.Provider>
    </ModeWorkspaceAssetCtx.Provider>
  )
}
