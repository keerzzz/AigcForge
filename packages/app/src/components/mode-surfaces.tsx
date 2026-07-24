import type { Component } from "solid-js"
import { createMemo } from "solid-js"
import { modeDefinition, modeDraft, type Mode, type ModeSurfaceSlot } from "@/context/mode"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { IconButtonV2 } from "@aigcfroge/ui/v2/icon-button-v2"
import { useLanguage } from "@/context/language"
import { ChatRightPanel } from "@/components/chat/chat-right-panel"
import { useGlobal } from "@/context/global"
import { ServerConnection, useServer } from "@/context/server"
import { useTabs } from "@/context/tabs"
import { useDirectoryPicker } from "@/components/directory-picker"
import { homeProjectDirectories, openProjectNewSession } from "@/pages/layout/helpers"
import { getFilename } from "@aigcfroge/core/util/path"

export type ModeSurface = {
  Sidebar: Component
  RightPanel: Component
}

/**
 * Chat 首页 Location 解析：当前 server 的 lastSession 目录，回退首个 project worktree。
 * ChatSidebar（左栏 Location 展示）与 Home 资产 fetch 共用此 hook，确保展示目录与资产列表目录一致。
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

/**
 * Chat 首页左栏：Location 展示 + New Session + Add Project（M2 Step 3：移除功能树导航）。
 * 功能树已删（chat-feature.ts）；chat 会话列表由 SecondarySidebar 的 ChatSessionList 承载。
 */
function ChatSidebar() {
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
    Sidebar: ChatSidebar,
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
