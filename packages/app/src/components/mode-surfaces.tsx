import type { Component } from "solid-js"
import { For, Show, createEffect, createMemo, createResource, createSignal } from "solid-js"
import { modeDefinition, modeDraft, type Mode, type ModeSurfaceSlot } from "@/context/mode"
import { useChatFeature, type ChatFeatureID } from "@/context/chat-feature"
import { type DirectorySDK } from "@/context/sdk"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { IconButtonV2 } from "@aigcfroge/ui/v2/icon-button-v2"
import { useLanguage } from "@/context/language"
import { ChatRightPanel } from "@/components/chat/chat-right-panel"
import { AssetWorkbench } from "@/components/chat/asset-workbench"
import { useGlobal } from "@/context/global"
import { ServerConnection, useServer } from "@/context/server"
import { useServerSync } from "@/context/server-sync"
import { useTabs } from "@/context/tabs"
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

/**
 * Chat 首页 Location 解析：当前 server 的 lastSession 目录，回退首个 project worktree。
 * ChatSidebar / ChatFeatureSidebar / Home 资产 fetch 共用，确保 Location 展示与资产列表目录一致。
 */
export function useChatDirectory() {
  const global = useGlobal()
  const server = useServer()
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
  return { conn, ctx, directory }
}

/** Chat 功能树共享数据：左栏导航 count，directory 复用 useChatDirectory（B2）。 */
function useChatFeatureData() {
  const sync = useServerSync()
  const { conn, ctx, directory } = useChatDirectory()

  // M4：child 必须带 { mcp: true } 才会加载 command/mcp（bootstrap.ts 门控），agent 随普通 bootstrap。
  const directoryData = createMemo(() => {
    const current = directory()
    if (!current) return
    return sync().child(current, { mcp: true })[0]
  })

  return { conn, ctx, directory, directoryData }
}

/**
 * Chat 首页左栏（Home L461）：Location + New Session + Add Project（瘦版，无功能树）。
 * 功能树在 SecondarySidebar 的 ChatFeatureSidebar（全貌）。两者 Location/New Session 一致，
 * 对齐 code 模式（HomeProjectColumn + SecondarySidebar 项目列表也并存）。
 */
export function ChatSidebar() {
  const language = useLanguage()
  const tabs = useTabs()
  const global = useGlobal()
  const pickDirectory = useDirectoryPicker()
  const { conn, ctx, directory } = useChatDirectory()

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
    </div>
  )
}

/**
 * Chat 次级左侧边栏（SecondarySidebar）：Location + New Session + 功能树（分类+计数）+ Add Project。
 * M1 全貌恢复（M2 Step 3 按产品反馈复活）。功能树点击切换 KindFilter，AssetWorkbenchTable 按 kind 展示对应资产。
 */
function ChatFeatureSidebar() {
  const language = useLanguage()
  const tabs = useTabs()
  const global = useGlobal()
  const pickDirectory = useDirectoryPicker()
  const { selected: chatFeature, set: setChatFeature } = useChatFeature()
  const { conn, ctx, directory, directoryData } = useChatFeatureData()

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
  // 全量资产计数：并发取 5 种 kind 的项目级资产（M3）；M4 带 name 集合供系统级计数去重。
  const [kindCounts] = createResource(dirSdk, async (sdk) => {
    if (!sdk) return { counts: {} as Record<string, number>, names: {} as Record<string, Set<string>> }
    const [p, s, m, c, a] = await Promise.all([
      sdk.client.promptAsset.list(),
      sdk.client.skillAsset.list(),
      sdk.client.mcpAsset.list(),
      sdk.client.commandAsset.list(),
      sdk.client.agentAsset.list(),
    ])
    const byKind = {
      prompt: p.data?.assets ?? [],
      skill: s.data?.assets ?? [],
      mcp: m.data?.assets ?? [],
      command: c.data?.assets ?? [],
      agent: a.data?.assets ?? [],
    }
    return {
      counts: Object.fromEntries(Object.entries(byKind).map(([kind, assets]) => [kind, assets.length])),
      names: Object.fromEntries(Object.entries(byKind).map(([kind, assets]) => [kind, new Set(assets.map((x) => x.name))])),
    }
  })
  // M4：计数 = 项目级 + 系统级（server-sync 运行时数据，按 kind+name 去重，与表格 mergeAssets 同规则）。
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
