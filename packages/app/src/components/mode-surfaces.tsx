import type { Component } from "solid-js"
import { For, Show, createEffect, createMemo, createResource, createSignal } from "solid-js"
import { modeDefinition, modeDraft, type Mode, type ModeSurfaceSlot } from "@/context/mode"
import { useChatFeature, type ChatFeatureID } from "@/context/chat-feature"
import { type DirectorySDK } from "@/context/sdk"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { IconButtonV2 } from "@aigcfroge/ui/v2/icon-button-v2"
import { useLanguage } from "@/context/language"
import { assetVersion } from "@/components/chat/prompt-asset-store"
import { useModeDirectory } from "@/pages/mode-workspace-context"
import { AssetWorkbench } from "@/components/chat/asset-workbench"
import { useGlobal } from "@/context/global"
import { ServerConnection } from "@/context/server"
import { useServerSync } from "@/context/server-sync"
import { useTabs } from "@/context/tabs"
import { useDirectoryPicker } from "@/components/directory-picker"
import { homeProjectDirectories, openProjectNewSession } from "@/pages/layout/helpers"
import { getFilename } from "@aigcfroge/core/util/path"
import { AssistantDashboardMain } from "@/pages/assistant-dashboard"
import { AssistantSidebar } from "@/components/assistant-feature-sidebar"
import { ChatAssetWorkbenchMain, CodingProjectColumnSidebar, CodingSessionListMain, WorkPresetCatalogMain, WorkProjectColumnSidebar } from "@/pages/mode-workspace-slots"

export type ModeSurface = {
  Sidebar: Component
  Main: Component
}

const CHAT_FEATURES = [
  { id: "prompt", icon: "mode-chat", label: "chat.feature.prompt" },
  { id: "skill", icon: "mode-work", label: "chat.feature.skill" },
  { id: "mcp", icon: "grid-plus", label: "chat.feature.mcp" },
  { id: "command", icon: "mode-coding", label: "chat.feature.command" },
  { id: "agent", icon: "mode-assistant", label: "chat.feature.agent" },
  { id: "workflow", icon: "settings-gear", label: "chat.feature.workflow" },
  { id: "plugin", icon: "outline-dots", label: "chat.feature.plugin" },
] as const satisfies ReadonlyArray<{ id: ChatFeatureID; icon: string; label: string }>

/** Shared Chat feature counts and the current Chat directory. */
function useChatFeatureData() {
  const sync = useServerSync()
  const { conn, ctx, directory } = useModeDirectory()

  // Command and MCP data load only when the child store opts into MCP bootstrap.
  const directoryData = createMemo(() => {
    const current = directory()
    if (!current) return
    return sync().child(current, { mcp: true })[0]
  })

  return { conn, ctx, directory, directoryData }
}

/**
 * Chat secondary sidebar: Location, new session, asset categories, and counts.
 */
export function ChatFeatureSidebar() {
  const language = useLanguage()
  const tabs = useTabs()
  const global = useGlobal()
  const pickDirectory = useDirectoryPicker()
  const { selected: chatFeature, set: setChatFeature } = useChatFeature()
  const { conn, ctx, directory, directoryData } = useChatFeatureData()

  // ensureDirSdkContext registers cleanup hooks, so it must run under an effect
  // that disposes the previous directory context when the location changes.
  const [dirSdk, setDirSdk] = createSignal<DirectorySDK | undefined>()
  createEffect(() => {
    const dir = directory()
    const currentCtx = ctx()
    if (!dir || !currentCtx) {
      setDirSdk(undefined)
      return
    }
    setDirSdk(currentCtx.sdk.ensureDirSdkContext(dir))
  })
  // Keep names with counts so system assets can be deduplicated consistently.
  const [kindCounts] = createResource(() => ({ sdk: dirSdk(), version: assetVersion() }), async (source) => {
    if (!source.sdk) return { counts: {} as Record<string, number>, names: {} as Record<string, Set<string>> }
    const [p, s, m, c, a, w, pl] = await Promise.all([
      source.sdk.client.promptAsset.list(),
      source.sdk.client.skillAsset.list(),
      source.sdk.client.mcpAsset.list(),
      source.sdk.client.commandAsset.list(),
      source.sdk.client.agentAsset.list(),
      source.sdk.client.workflowAsset.list(),
      source.sdk.client.pluginAsset.list(),
    ])
    const byKind = {
      prompt: p.data?.assets ?? [],
      skill: s.data?.assets ?? [],
      mcp: m.data?.assets ?? [],
      command: c.data?.assets ?? [],
      agent: a.data?.assets ?? [],
      workflow: w.data?.assets ?? [],
      plugin: [...(pl.data?.assets ?? []), ...(pl.data?.bridged?.map((b) => ({ name: b.name, description: b.description, relativePath: b.originPath, revision: "" })) ?? [])],
    }
    return {
      counts: Object.fromEntries(Object.entries(byKind).map(([kind, assets]) => [kind, assets.length])),
      names: Object.fromEntries(Object.entries(byKind).map(([kind, assets]) => [kind, new Set(assets.map((x) => x.name))])),
    }
  })
  // Use the same kind-and-name deduplication rule as the workbench table.
  const countFor = (feature: ChatFeatureID) => {
    const data = kindCounts()
    const syncData = directoryData()
    const system = AssetWorkbench.systemAssets({
      commands: syncData?.command ?? [],
      agents: syncData?.agent ?? [],
      mcp: syncData?.mcp ?? {},
    })
    const total = (data?.counts[feature] ?? 0) + AssetWorkbench.systemCountFor(system, feature, data?.names[feature] ?? new Set())
    return total > 0 ? total : undefined
  }

  function newSession() {
    const current = conn()
    const currentCtx = ctx()
    const currentDirectory = directory()
    if (!current || !currentCtx || !currentDirectory) return
    openProjectNewSession(
      currentCtx.projects,
      (serverKey, draftDirectory) =>
        tabs.newDraft({ server: serverKey, directory: draftDirectory, ...modeDraft("chat") }),
      ServerConnection.key(current),
      currentDirectory,
    )
  }

  function addProject() {
    const current = conn()
    const currentCtx = ctx()
    if (!current || !currentCtx) return
    pickDirectory({
      server: current,
      title: language.t("command.project.open"),
      multiple: true,
      onSelect: (result) => {
        const dirs = homeProjectDirectories(result)
        if (!dirs[0]) return
        dirs.forEach(currentCtx.projects.open)
        currentCtx.projects.touch(dirs[0])
        global.lastSession.set(currentCtx.sdk.scope, dirs[0])
      },
    })
  }

  return (
    <div class="flex min-h-0 shrink-0 flex-col">
      <div class="flex items-center gap-1.5 border-b border-v2-border-border-base px-3 pb-3 pt-3">
        <Icon name="folder" size="small" class="shrink-0 text-v2-icon-icon-muted" />
        <span class="shrink-0 text-v2-text-text-muted text-11-regular">{language.t("chat.feature.project")}</span>
        <span class="min-w-0 flex-1 truncate text-v2-text-text-base text-11-regular">
          {directory() ? getFilename(directory()) || directory() : language.t("chat.feature.noLocation")}
        </span>
        <IconButtonV2
          variant="ghost-muted"
          size="small"
          icon={<Icon name="folder-add-left" />}
          aria-label={language.t("sidebar.secondary.addProject")}
          onClick={addProject}
        />
      </div>
      <div class="px-3 pb-2 pt-3">
        <ButtonV2
          variant="neutral"
          size="normal"
          icon="edit"
          class="w-full"
          disabled={!directory()}
          onClick={newSession}
        >
          {language.t("command.session.new")}
        </ButtonV2>
      </div>

      <div class="px-3 pb-1 text-v2-text-text-muted text-11-regular [font-weight:440]">
        {language.t("chat.feature.title")}
      </div>
      <nav class="flex flex-col gap-px px-2" aria-label={language.t("chat.feature.title")}>
        <For each={CHAT_FEATURES}>
          {(feature) => (
            <button
              type="button"
              class="flex h-8 w-full cursor-default items-center gap-2 rounded-[6px] px-2 text-left text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus data-[selected]:bg-v2-background-bg-layer-03 data-[selected]:text-v2-text-text-base"
              data-selected={chatFeature() === feature.id ? "" : undefined}
              aria-current={chatFeature() === feature.id ? "page" : undefined}
              onClick={() => setChatFeature(feature.id)}
            >
              <Icon name={feature.icon} size="small" class="shrink-0" />
              <span class="min-w-0 flex-1 truncate text-13-regular">{language.t(feature.label)}</span>
              <Show when={countFor(feature.id) !== undefined}>
                <span class="text-v2-text-text-faint text-11-regular">{countFor(feature.id)}</span>
              </Show>
            </button>
          )}
        </For>
      </nav>
    </div>
  )
}

const MODE_SURFACES: Record<ModeSurfaceSlot, ModeSurface> = {
  coding: {
    Sidebar: CodingProjectColumnSidebar,
    Main: CodingSessionListMain,
  },
  chat: {
    Sidebar: ChatFeatureSidebar,
    Main: ChatAssetWorkbenchMain,
  },
  work: {
    Sidebar: WorkProjectColumnSidebar,
    Main: WorkPresetCatalogMain,
  },
  assistant: {
    Sidebar: AssistantSidebar,
    Main: AssistantDashboardMain,
  },
}

export function modeSurface(mode: Mode) {
  return MODE_SURFACES[modeDefinition(mode).surface]
}
