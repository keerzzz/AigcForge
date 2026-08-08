import { createEffect, createMemo, Show, For, type Accessor } from "solid-js"
import { useParams } from "@solidjs/router"
import { getFilename } from "@aigcfroge/core/util/path"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { IconButtonV2 } from "@aigcfroge/ui/v2/icon-button-v2"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { TabsV2 } from "@aigcfroge/ui/v2/tabs-v2"
import { useLanguage } from "@/context/language"
import { modeDraft } from "@/context/mode"
import { useGlobal } from "@/context/global"
import { useTabs } from "@/context/tabs"
import { ServerConnection } from "@/context/server"
import { useServerSync } from "@/context/server-sync"
import { useSync } from "@/context/sync"
import { useDirectoryPicker } from "@/components/directory-picker"
import { useChatDirectory } from "@/pages/mode-workspace-context"
import { useWorkSecondaryTab } from "@/context/work-secondary-tab"
import { computeWorkSidebarGroups } from "@/pages/work-sidebar-groups"
import { SessionItem, SessionSkeleton } from "@/pages/layout/sidebar-items"
import { sortedRootSessions, openProjectNewSession, homeProjectDirectories } from "@/pages/layout/helpers"
import type { WorkspaceSidebarContext } from "@/pages/layout/sidebar-workspace"

/**
 * Work 会话详情页次级左栏（批次 1 §3.2）：Location + New Session 顶部（复用
 * WorkProjectColumnSidebar 顶部逻辑）+ 维度 Tab（工种/任务集/智能体）+ 会话列表。
 * 会话列表过滤 mode===work（对齐 ChatSessionList），按选中 Tab 维度分组。
 */
export function WorkSecondarySidebar(props: {
  directory: Accessor<string>
  sortNow: Accessor<number>
  ctx: WorkspaceSidebarContext
  serverKey?: ServerConnection.Key
}) {
  const language = useLanguage()
  const sync = useServerSync()
  const dirSync = useSync()
  const params = useParams()
  const { selected: tab, set: setTab } = useWorkSecondaryTab()

  // 跨模式指示器（计划 §3.7）：复用 session.tsx:1626 `info()?.mode` 读取路径
  const sessionMode = createMemo(() => (params.id ? dirSync().session.get(params.id)?.mode : undefined))

  const store = createMemo(() => {
    const directory = props.directory()
    if (!directory) return
    return sync().child(directory, { bootstrap: false })[0]
  })

  const sessions = createMemo(() => {
    const current = store()
    if (!current) return []
    return sortedRootSessions(current, props.sortNow()).filter((session) => (session.mode ?? "coding") === "work")
  })

  const groups = createMemo(() => computeWorkSidebarGroups(sessions()))

  createEffect(() => {
    const directory = props.directory()
    if (!directory) return
    void sync().project.loadSessions(directory, { mode: "work" })
  })

  const switchTab = (value: string | number) => {
    if (value === "trade" || value === "taskSet" || value === "agent") setTab(value)
  }

  return (
    <div class="flex min-h-0 flex-1 flex-col" data-component="work-secondary-sidebar">
      <WorkLocationNewSession directory={props.directory} />
      <Show when={sessionMode() !== "work"}>
        <div
          data-component="work-sidebar-mode-mismatch"
          class="border-b border-v2-border-border-base bg-v2-background-bg-layer-02 px-3 py-1.5 text-v2-text-text-muted text-11-regular"
        >
          {language.t("work.sidebar.modeMismatch", { mode: sessionMode() ?? language.t("mode.coding") })}
        </div>
      </Show>
      <TabsV2 value={tab()} onChange={switchTab}>
        <TabsV2.List class="shrink-0 gap-0 border-b border-v2-border-border-base px-2 pt-1" aria-label={language.t("work.sidebar.tab.trade")}>
          <TabsV2.Trigger value="trade">
            <span>{language.t("work.sidebar.tab.trade")}</span>
            <span class="min-w-[2ch] text-v2-text-text-faint text-11-regular">{sessions().length}</span>
          </TabsV2.Trigger>
          <TabsV2.Trigger value="taskSet">{language.t("work.sidebar.tab.taskSet")}</TabsV2.Trigger>
          <TabsV2.Trigger value="agent">{language.t("work.sidebar.tab.agent")}</TabsV2.Trigger>
        </TabsV2.List>
      </TabsV2>
      <div class="min-h-0 flex-1 overflow-y-auto px-2">
        <Show when={tab() === "trade"}>
          <Show when={store()?.status !== "loading"} fallback={<SessionSkeleton />}>
            <Show
              when={sessions().length > 0}
              fallback={
                <div class="flex flex-col items-center gap-2 px-4 py-10 text-center">
                  <p class="text-v2-text-text-muted text-12-regular">{language.t("work.sidebar.empty")}</p>
                </div>
              }
            >
              <For each={groups()}>
                {(group) => (
                  <div class="flex min-w-0 flex-col gap-px">
                    <div class="flex items-baseline gap-1.5 px-1 pb-1 pt-2">
                      <span class="text-v2-text-text-muted text-11-regular [font-weight:440]">
                        {language.t(group.labelKey)}
                      </span>
                      <span class="min-w-[2ch] text-v2-text-text-faint text-11-regular">{group.sessions.length}</span>
                    </div>
                    <For each={group.sessions}>
                      {(session) => (
                        <SessionItem
                          session={session}
                          list={sessions()}
                          navList={props.ctx.navList}
                          slug={base64Encode(props.directory())}
                          serverKey={props.serverKey}
                          sidebarExpanded={props.ctx.sidebarExpanded}
                          clearHoverProjectSoon={props.ctx.clearHoverProjectSoon}
                          prefetchSession={props.ctx.prefetchSession}
                          archiveSession={props.ctx.archiveSession}
                        />
                      )}
                    </For>
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </Show>
        <Show when={tab() === "taskSet"}>
          <div class="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <Icon name="mode-work" size="small" class="text-v2-icon-icon-muted opacity-40" />
            <p class="text-v2-text-text-muted text-12-regular">{language.t("work.sidebar.taskSet.empty")}</p>
          </div>
        </Show>
        <Show when={tab() === "agent"}>
          <div class="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <Icon name="mode-work" size="small" class="text-v2-icon-icon-muted opacity-40" />
            <p class="text-v2-text-text-muted text-12-regular">{language.t("work.sidebar.agent.empty")}</p>
          </div>
        </Show>
      </div>
    </div>
  )
}

/**
 * Work Location 栏 + New Session（批次 1 §3.2 顶部，抽取自
 * WorkProjectColumnSidebar，work 首页与会话详情页共用）。
 */
export function WorkLocationNewSession(props: { directory: Accessor<string | undefined> }) {
  const language = useLanguage()
  const global = useGlobal()
  const tabs = useTabs()
  const pickDirectory = useDirectoryPicker()
  const { conn, ctx } = useChatDirectory()

  function newSession() {
    const c = conn()
    const currentCtx = ctx()
    const dir = props.directory()
    if (!c || !currentCtx || !dir) return
    openProjectNewSession(
      currentCtx.projects,
      (serverKey, draftDirectory) =>
        tabs.newDraft({ server: serverKey, directory: draftDirectory, ...modeDraft("work") }),
      ServerConnection.key(c),
      dir,
    )
  }

  function addProject() {
    const c = conn()
    const currentCtx = ctx()
    if (!c || !currentCtx) return
    pickDirectory({
      server: c,
      title: language.t("command.project.open"),
      multiple: true,
      onSelect: (result) => {
        const dirs = homeProjectDirectories(result)
        const directory = dirs[0]
        if (!directory) return
        dirs.forEach((dir) => currentCtx.projects.open(dir))
        currentCtx.projects.touch(directory)
        global.lastSession.set(currentCtx.sdk.scope, directory)
      },
    })
  }

  return (
    <div class="flex min-h-0 shrink-0 flex-col">
      <div class="flex items-center gap-1.5 border-b border-v2-border-border-base px-3 pb-3 pt-3">
        <Icon name="mode-work" size="small" class="shrink-0 text-v2-icon-icon-muted" />
        <span class="shrink-0 text-v2-text-text-muted text-11-regular">{language.t("chat.feature.project")}</span>
        <span class="min-w-0 flex-1 truncate text-v2-text-text-base text-11-regular">
          {props.directory() ? getFilename(props.directory()) || props.directory() : language.t("work.preset.noLocation")}
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
          disabled={!props.directory()}
          onClick={newSession}
        >
          {language.t("command.session.new")}
        </ButtonV2>
      </div>
    </div>
  )
}
