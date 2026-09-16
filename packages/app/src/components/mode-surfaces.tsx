import type { Component, ParentProps } from "solid-js"
import { For, Show, createMemo } from "solid-js"
import { modeDefinition, type Mode, type ModeSurfaceSlot } from "@/context/mode"
import { useChatFeature, type ChatFeatureID } from "@/context/chat-feature"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { IconButtonV2 } from "@aigcfroge/ui/v2/icon-button-v2"
import { useLanguage } from "@/context/language"
import { useModeDirectory, useModeWorkspaceAssets } from "@/pages/mode-workspace-context"
import { useGlobal } from "@/context/global"
import { ServerConnection } from "@/context/server"
import { useServerSync } from "@/context/server-sync"
import { useTabs } from "@/context/tabs"
import { useDirectoryPicker } from "@/components/directory-picker"
import { homeProjectDirectories, launchModeSession } from "@/pages/layout/helpers"
import { getFilename } from "@aigcfroge/core/util/path"
import { AssistantDashboardMain } from "@/pages/assistant-dashboard"
import { AssistantSidebar } from "@/components/assistant-feature-sidebar"
import {
  ChatAssetWorkbenchMain,
  CodingProjectColumnSidebar,
  CodingSessionListMain,
  CustomProjectColumnSidebar,
  CustomSessionListMain,
  WorkPresetCatalogMain,
  WorkProjectColumnSidebar,
} from "@/pages/mode-workspace-slots"

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

/** Chat project summary and location switcher. */
export function ChatProjectSidebar(props: { directory?: () => string; children?: ParentProps["children"] } = {}) {
  const language = useLanguage()
  const global = useGlobal()
  const pickDirectory = useDirectoryPicker()
  const { conn, ctx, directory: modeDirectory } = useChatFeatureData()
  const directory = () => props.directory?.() ?? modeDirectory()

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
        dirs.forEach((directory) => currentCtx.projects.open(directory))
        currentCtx.projects.touch(dirs[0])
        global.lastSession.set(currentCtx.sdk.scope, dirs[0])
      },
    })
  }

  return (
    <div class="flex min-h-0 items-center gap-1.5 px-3 py-2">
      <Icon name="folder" size="small" class="shrink-0 text-v2-icon-icon-muted" />
      <span class="min-w-0 flex-1 truncate text-v2-text-text-base text-11-regular">
        {directory() ? getFilename(directory()) || directory() : language.t("chat.feature.noLocation")}
      </span>
      {props.children}
      <IconButtonV2
        variant="ghost-muted"
        size="small"
        icon={<Icon name="folder-add-left" />}
        aria-label={language.t("sidebar.secondary.addProject")}
        onClick={addProject}
      />
    </div>
  )
}

/** Chat asset categories and counts. */
export function ChatFeatureList() {
  const language = useLanguage()
  const { selected: chatFeature, set: setChatFeature } = useChatFeature()

  // S3-3: the counts come from the workspace's single asset resource
  // (`ModeWorkspaceAssetCtx.assetCounts`). This component used to own a second
  // `DirectorySDK` context plus its own `createResource` over the same seven list
  // endpoints, then recompute the shadow rule with `systemCountFor` — the same rule
  // `mergeAssets` already applies, written twice, over a duplicated request set.
  // Reading the context removes both. `useModeSlotActive` is no longer needed here
  // either: the context's resource is gated upstream (`chatShown` latch), and an
  // inactive slot's sidebar reads the same numbers the workspace already holds.
  const counts = useModeWorkspaceAssets()
  const countFor = (feature: ChatFeatureID) => {
    const total = counts?.assetCounts()[feature] ?? 0
    return total > 0 ? total : undefined
  }

  return (
    <nav class="flex flex-col gap-px px-2 pb-2" aria-label={language.t("chat.feature.title")}>
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
  )
}

/** Chat mode-workspace sidebar, composed from the same project and feature sections as Session. */
export function ChatFeatureSidebar() {
  const language = useLanguage()
  const tabs = useTabs()
  const { conn, ctx, directory } = useChatFeatureData()

  function newSession() {
    const current = conn()
    const currentCtx = ctx()
    const currentDirectory = directory()
    if (!current || !currentCtx || !currentDirectory) return
    launchModeSession({
      mode: "chat",
      projects: currentCtx.projects,
      server: ServerConnection.key(current),
      directory: currentDirectory,
      tabs,
    })
  }

  return (
    <div class="flex min-h-0 shrink-0 flex-col">
      <ChatProjectSidebar />
      <div class="px-3 pb-2 pt-1">
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
      <ChatFeatureList />
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
  custom: {
    Sidebar: CustomProjectColumnSidebar,
    Main: CustomSessionListMain,
  },
}

export function modeSurface(mode: Mode) {
  return MODE_SURFACES[modeDefinition(mode).surface]
}
