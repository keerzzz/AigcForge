import type { Component } from "solid-js"
import { For, Show, createEffect, createMemo, createResource, createSignal } from "solid-js"
import { modeDefinition, modeDraft, type Mode, type ModeSurfaceSlot } from "@/context/mode"
import { chatFeature, setChatFeature, type ChatFeatureID } from "@/context/chat-feature"
import { type DirectorySDK } from "@/context/sdk"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { IconButtonV2 } from "@aigcfroge/ui/v2/icon-button-v2"
import { useLanguage } from "@/context/language"
import { ChatRightPanel } from "@/components/chat/chat-right-panel"
import { useGlobal } from "@/context/global"
import { ServerConnection, useServer } from "@/context/server"
import { useServerSync } from "@/context/server-sync"
import { useTabs } from "@/context/tabs"
import { useDialog } from "@aigcfroge/ui/context/dialog"
import { useDirectoryPicker } from "@/components/directory-picker"
import { homeProjectDirectories, openProjectNewSession } from "@/pages/layout/helpers"
import { getFilename } from "@aigcfroge/core/util/path"

export type ModeSurface = {
  Sidebar: Component
  RightPanel: Component
}

const CHAT_FEATURES = [
  { id: "prompt", icon: "mode-chat", label: "chat.feature.prompt" },
  { id: "skill", icon: "mode-work", label: "chat.feature.skill" },
  { id: "mcp", icon: "terminal", label: "chat.feature.mcp" },
  { id: "command", icon: "mode-coding", label: "chat.feature.command" },
  { id: "agent", icon: "mode-assistant", label: "chat.feature.agent" },
  { id: "workflow", icon: "mode-coding", label: "chat.feature.workflow" },
] as const satisfies ReadonlyArray<{ id: ChatFeatureID; icon: string; label: string }>

/** Chat 功能树共享数据：左栏导航 count + 右栏能力清单共用，directory 复用 code projects（B2）。 */
function useChatFeatureData() {
  const global = useGlobal()
  const server = useServer()
  const sync = useServerSync()

  const conn = createMemo(() => server.current ?? server.list[0])
  const ctx = createMemo(() => {
    const current = conn()
    if (!current) return
    return global.ensureServerCtx(current)
  })
  const directory = createMemo(() => {
    const current = ctx()
    if (!current) return
    return global.lastSession.directory(current.sdk.scope) ?? current.projects.list()[0]?.worktree
  })
  const directoryData = createMemo(() => {
    const current = directory()
    if (!current) return
    return sync().child(current)[0]
  })
  const selectedItems = createMemo(() => {
    const feature = chatFeature()
    const data = directoryData()
    if (!data) return []
    if (feature === "skill") return data.command.filter((item) => item.source === "skill").map((item) => item.name)
    if (feature === "mcp") return Object.keys(data.mcp ?? {}).sort((a, b) => a.localeCompare(b))
    if (feature === "command") return data.command.filter((item) => item.source !== "skill").map((item) => item.name)
    if (feature === "agent")
      return data.agent
        .filter((item) => !item.hidden)
        .map((item) => item.name)
        .sort((a, b) => a.localeCompare(b))
    return []
  })
  const featureCount = (feature: ChatFeatureID) => {
    const data = directoryData()
    if (!data || feature === "prompt" || feature === "workflow") return undefined
    if (feature === "skill") return data.command.filter((item) => item.source === "skill").length
    if (feature === "mcp") return Object.keys(data.mcp ?? {}).length
    if (feature === "command") return data.command.filter((item) => item.source !== "skill").length
    return data.agent.filter((item) => !item.hidden).length
  }
  return { conn, ctx, directory, directoryData, selectedItems, featureCount }
}

function ChatFeatureSidebar() {
  const language = useLanguage()
  const tabs = useTabs()
  const global = useGlobal()
  const pickDirectory = useDirectoryPicker()
  const { conn, ctx, directory, featureCount } = useChatFeatureData()

  // 提示词分类资产数量：查当前 Location 的 prompt asset（m1 §1.4）
  // 用 createEffect 而非 createMemo：ensureDirSdkContext 内部注册 onCleanup/onMount，
  // effect 有 cleanup 机制，directory 变化时正确释放旧 context（memo 无 cleanup 会泄漏 + owner 混乱）。
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
  const [assetCount] = createResource(dirSdk, async (sdk) => {
    if (!sdk) return 0
    const result = await sdk.client.promptAsset.list()
    return result.data?.assets?.length ?? 0
  })
  const countFor = (feature: ChatFeatureID) => {
    if (feature === "prompt") {
      const count = assetCount()
      return count ? count : undefined
    }
    return featureCount(feature)
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
          {directory() ? getFilename(directory()!) || directory() : language.t("chat.feature.noLocation")}
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

/** Chat 右栏能力清单（非"提示词"分类时由 Home 渲染，只读，m1 §1.4）。 */
export function ChatFeaturePanel() {
  const language = useLanguage()
  const dialog = useDialog()
  const { selectedItems } = useChatFeatureData()
  const selectedFeature = createMemo(() => CHAT_FEATURES.find((feature) => feature.id === chatFeature())!)

  function openMcp() {
    void import("@/components/dialog-select-mcp").then((module) => {
      void dialog.show(() => <module.DialogSelectMcp />)
    })
  }

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="flex h-7 items-center justify-between gap-2">
        <span class="truncate text-v2-text-text-base text-12-semibold">{language.t(selectedFeature().label)}</span>
        <Show when={chatFeature() === "mcp"}>
          <ButtonV2 variant="ghost-muted" size="small" onClick={openMcp}>
            {language.t("common.open")}
          </ButtonV2>
        </Show>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto py-1">
        <Show
          when={selectedItems().length > 0}
          fallback={<p class="py-2 text-v2-text-text-muted text-12-regular">{language.t("chat.feature.empty")}</p>}
        >
          <For each={selectedItems()}>
            {(item) => (
              <div class="truncate rounded-[6px] px-2 py-1.5 text-v2-text-text-muted text-12-regular">{item}</div>
            )}
          </For>
        </Show>
      </div>
    </div>
  )
}

function PlaceholderSidebar(props: { mode: Mode }) {
  const language = useLanguage()
  return (
    <div class="min-h-0 flex-1 overflow-y-auto px-2">
      <div class="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
        <Icon name={`mode-${props.mode}`} size="large" class="text-v2-icon-icon-muted opacity-40" />
        <p class="text-v2-text-text-muted text-13-regular">{language.t("sidebar.secondary.noResults")}</p>
      </div>
    </div>
  )
}

function PlaceholderPanel() {
  const language = useLanguage()
  return (
    <aside class="flex w-64 shrink-0 flex-col items-center justify-center gap-3 border-l border-v2-border-border-base bg-v2-background-bg-base p-6 text-center">
      <span class="text-v2-text-text-muted text-13-regular">{language.t("sidebar.secondary.noResults")}</span>
    </aside>
  )
}

const MODE_SURFACES: Record<ModeSurfaceSlot, ModeSurface> = {
  coding: {
    Sidebar: () => null,
    RightPanel: () => null,
  },
  chat: {
    Sidebar: ChatFeatureSidebar,
    RightPanel: ChatRightPanel,
  },
  work: {
    Sidebar: () => <PlaceholderSidebar mode="work" />,
    RightPanel: PlaceholderPanel,
  },
  assistant: {
    Sidebar: () => <PlaceholderSidebar mode="assistant" />,
    RightPanel: PlaceholderPanel,
  },
}

export function modeSurface(mode: Mode) {
  return MODE_SURFACES[modeDefinition(mode).surface]
}
