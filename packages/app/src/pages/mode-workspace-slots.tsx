import { batch, createEffect, createMemo, createRoot, createSignal, For, onCleanup, Show, startTransition } from "solid-js"
import { createStore } from "solid-js/store"
import { useChatFeature } from "@/context/chat-feature"
import { useDialog } from "@aigcfroge/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useGlobal } from "@/context/global"
import { useTabs } from "@/context/tabs"
import { useServer, ServerConnection } from "@/context/server"
import { useChatDirectory, useModeWorkspaceAssets, useCodingSelection } from "@/pages/mode-workspace-context"
import { AssetWorkbench } from "@/components/chat/asset-workbench"
import { AssetSessionSelector } from "@/components/chat/asset-session-selector"
import { ChatImportDialog, serializeImport, wrapImportContent } from "@/components/chat/chat-import-dialog"
import { AssetDeleteDialog } from "@/components/chat/asset-delete-dialog"
import { modeDraft, useMode } from "@/context/mode"
import { openProjectNewSession, projectForSession, sortedRootSessions, displayName, type HomeProjectSelection, closeHomeProject, toggleHomeProjectSelection, homeProjectDirectories } from "@/pages/layout/helpers"
import { useServerSync, type ServerSync } from "@/context/server-sync"
import { useLayout, type LocalProject } from "@/context/layout"
import { useQuery } from "@tanstack/solid-query"
import { ScrollView } from "@aigcfroge/ui/scroll-view"
import { pathKey } from "@/utils/path-key"
import { useNavigate } from "@solidjs/router"
import { sessionTitle } from "@/utils/session-title"
import { SessionTabAvatar } from "@/pages/layout/session-tab-avatar"
import { Spinner } from "@aigcfroge/ui/spinner"
import { useDirectoryPicker } from "@/components/directory-picker"
import { HomeProjectColumn, HOME_SESSION_LIMIT, HOME_ROW, HOME_SESSION_SEARCH_RESULTS_ID, HOME_SEARCH_RESULT_ROW,
  HOME_SEARCH_RESULT_TITLE, HOME_SEARCH_RESULT_META, HOME_SECTION_LABEL,
  HomeSessionSearch, HomeSessionRow, HomeSessionGroupHeader, HomeSessionSkeleton,
  HomeSessionRecord, HomeSessionGroup, buildHomeSessionRecords, groupSessions, matchesHomeSessionSearch,
} from "@/pages/home"
import { useNotification } from "@/context/notification"
import { useMarked } from "@aigcfroge/ui/context/marked"
import { preloadMarkdown } from "@aigcfroge/session-ui/markdown-cache"
import { makeEventListener } from "@solid-primitives/event-listener"
import { DateTime } from "luxon"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { IconButtonV2 } from "@aigcfroge/ui/v2/icon-button-v2"
import { getFilename } from "@aigcfroge/core/util/path"
import { WorkPreset } from "@aigcfroge/schema/work-preset"
import { buildWorkPresetCatalog } from "@/pages/work-preset-catalog"
import { presetLaunch } from "@/pages/work-preset-launch"

/** Coding 左侧栏：项目列 + 服务器管理（复用 HomeProjectColumn，hooks 对齐旧 Home 组件） */
export function CodingProjectColumnSidebar() {
  const sync = useServerSync()
  const layout = useLayout()
  const mode = useMode()
  const dialog = useDialog()
  const server = useServer()
  const language = useLanguage()
  const global = useGlobal()
  const tabs = useTabs()
  const notification = useNotification()
  const pickDirectory = useDirectoryPicker()
  const codingSel = useCodingSelection()

  const focusedServer = createMemo(
    () => global.servers.list().find((conn) => ServerConnection.key(conn) === codingSel.selection.server) ?? server.current,
  )
  const focusedServerCtx = createMemo(() => {
    const conn = focusedServer()
    if (!conn) return undefined
    return global.ensureServerCtx(conn)
  })
  const projects = createMemo(() => focusedServerCtx()?.projects.list() ?? layout.projects.list())

  function focusServer(conn: ServerConnection.Any) {
    codingSel.selectServer(ServerConnection.key(conn))
  }
  function selectProject(conn: ServerConnection.Any, directory: string) {
    const key = ServerConnection.key(conn)
    if (!global.ensureServerCtx(conn).projects.list().some((p) => p.worktree === directory)) return
    codingSel.selectProject(key, directory)
  }
  function openNewSession(conn: ServerConnection.Any, dir: string) {
    const ctx = global.ensureServerCtx(conn)
    openProjectNewSession(
      ctx.projects,
      (s, d) => tabs.newDraft({ server: s, directory: d, ...modeDraft(mode.currentMode) }),
      ServerConnection.key(conn),
      dir,
    )
  }
  function chooseProject(conn: ServerConnection.Any) {
    pickDirectory({
      server: conn,
      title: language.t("command.project.open"),
      multiple: true,
      onSelect: (result) => {
        const dirs = homeProjectDirectories(result)
        if (!dirs[0]) return
        const ctx = global.ensureServerCtx(conn)
        dirs.forEach((d: string) => ctx.projects.open(d))
        ctx.projects.touch(dirs[0])
        codingSel.selectProject(ServerConnection.key(conn), dirs[0])
      },
    })
  }
  function editProject(conn: ServerConnection.Any, project: LocalProject) {
    void import("@/components/dialog-edit-project").then((x) => {
      void dialog.show(() => <x.DialogEditProject server={conn} project={project} />)
    })
  }
  function closeProject(conn: ServerConnection.Any, directory: string) {
    const next = closeHomeProject(codingSel.selection, ServerConnection.key(conn), global.ensureServerCtx(conn).projects, directory)
    if (next) codingSel.selectProject(next.server, next.directory ?? "")
  }
  function clearNotifications(conn: ServerConnection.Any, project: LocalProject) {
    if (ServerConnection.key(conn) !== server.key) return
    const dirs: string[] = [project.worktree, ...(project.sandboxes ?? [])]
    dirs.filter((d) => notification.project.unseenCount(d) > 0).forEach((d) => notification.project.markViewed(d))
  }
  function unseenCount(conn: ServerConnection.Any, project: LocalProject): number {
    if (ServerConnection.key(conn) !== server.key) return 0
    const dirs: string[] = [project.worktree, ...(project.sandboxes ?? [])]
    return dirs.reduce((t, d) => t + notification.project.unseenCount(d), 0)
  }

  // On first load (no project selected yet), default-select the project that
  // contains the last session's directory, so the project list highlights where
  // the user last worked. Runs once; later user selections are respected.
  let defaultSelectionApplied = false
  createEffect(() => {
    if (defaultSelectionApplied) return
    if (codingSel.selection.directory) {
      defaultSelectionApplied = true
      return
    }
    const conn = focusedServer()
    if (!conn) return
    const scope = focusedServerCtx()?.sdk.scope
    if (!scope) return
    const last = global.lastSession.directory(scope)
    if (!last) return
    const lastKey = pathKey(last)
    const project = projects().find(
      (p) => pathKey(p.worktree) === lastKey || (p.sandboxes ?? []).some((s) => pathKey(s) === lastKey),
    )
    defaultSelectionApplied = true
    if (project) codingSel.selectProject(ServerConnection.key(conn), project.worktree)
  })

  return (
    <HomeProjectColumn
      projects={projects()}
      selected={codingSel.selection}
      focusServer={focusServer}
      selectProject={selectProject}
      openNewSession={openNewSession}
      chooseProject={chooseProject}
      editProject={editProject}
      closeProject={closeProject}
      clearNotifications={clearNotifications}
      unseenCount={unseenCount}
      language={language}
    />
  )
}

/** Coding 主区：全功能会话列表（queryKey 已去 mode，records memo 按 mode 过滤） */
export function CodingSessionListMain() {
  const sync = useServerSync()
  const layout = useLayout()
  const mode = useMode()
  const dialog = useDialog()
  const navigate = useNavigate()
  const server = useServer()
  const language = useLanguage()
  const global = useGlobal()
  const tabs = useTabs()
  const notification = useNotification()
  const marked = useMarked()
  const codingSel = useCodingSelection()

  let focusSessionSearch: (() => void) | undefined
  const [state, setState] = createStore({
    search: "",
    searchFocused: false,
  })

  const focusedServer = createMemo(
    () => global.servers.list().find((conn) => ServerConnection.key(conn) === codingSel.selection.server) ?? server.current,
  )
  const focusedServerCtx = createMemo(() => {
    const conn = focusedServer()
    if (!conn) return undefined
    return global.ensureServerCtx(conn)
  })
  const focusedSync = () => focusedServerCtx()?.sync ?? sync()
  const focusedScope = createMemo(() => focusedServerCtx()?.sdk.scope)
  const projects = createMemo(() => focusedServerCtx()?.projects.list() ?? layout.projects.list())
  const selectedProject = createMemo(() =>
    projects().find((project) => project.worktree === codingSel.selection.directory),
  )
  const projectByID = createMemo(
    () => new Map(projects().flatMap((project) => (project.id ? [[project.id, project] as const] : []))),
  )
  const projectDirectories = createMemo(() => {
    const selected = selectedProject()
    if (!selected) return projects().flatMap((p) => [p.worktree, ...(p.sandboxes ?? [])])
    return [selected.worktree, ...(selected.sandboxes ?? [])]
  })

  const search = createMemo(() => state.search.trim())

  // queryKey 已去 mode.currentMode（ADR-15 Step 7）
  const sessionLoad = useQuery(() => ({
    queryKey: ["home", "sessions", codingSel.selection.server, ...projectDirectories()] as const,
    queryFn: async () => {
      await Promise.all(
        projectDirectories().map((directory) =>
          focusedSync().project.loadSessions(directory, { limit: HOME_SESSION_LIMIT }),
        ),
      )
      return null
    },
  }))

  const allRecords = createMemo(() => {
    const syncInstance = focusedSync()
    if (!syncInstance) return []
    return buildHomeSessionRecords({
      sync: syncInstance,
      projectDirectories,
      projects,
      projectByID,
    })
  })

  const records = createMemo(() => {
    const current = mode.currentMode
    const all = allRecords()
    if (!all) return []
    return all
      .filter((r) => {
        if (r.session.mode === undefined) return current === "coding"
        return r.session.mode === current
      })
      .slice(0, HOME_SESSION_LIMIT)
  })

  const searchResults = createMemo(() => {
    const query = search().toLowerCase()
    if (!query) return []
    const current = mode.currentMode
    const all = allRecords()
    if (!all) return []
    return all
      .filter((r) => {
        if (r.session.mode === undefined) return current === "coding"
        return r.session.mode === current
      })
      .filter((record) => matchesHomeSessionSearch(record, query))
  })

  const searchOpen = createMemo(() => state.searchFocused && search().length > 0)
  const groups = createMemo(() => groupSessions(records(), language))

  const prefetched = new Set<string>()
  const disposeRoots = new Set<() => void>()
  onCleanup(() => {
    for (const dispose of disposeRoots) dispose()
    disposeRoots.clear()
  })

  createEffect(() => {
    const ctx = focusedServerCtx()
    if (!ctx) return
    prefetched.clear()
    for (const dispose of disposeRoots) dispose()
    disposeRoots.clear()
    records()
      .slice(0, 2)
      .forEach((record) => {
        const key = `${ServerConnection.key(focusedServer()!)}\0${record.session.id}`
        if (prefetched.has(key)) return
        prefetched.add(key)
        createRoot((dispose) => {
          disposeRoots.add(dispose)
          try {
            const directory = ctx.sync.ensureDirSyncContext(record.session.directory)
            void directory.session
              .sync(record.session.id)
              .then(() => {
                const store = ctx.sync.child(record.session.directory)[0]
                return Promise.all(
                  (store.message[record.session.id] ?? []).flatMap((message) =>
                    (store.part[message.id] ?? []).flatMap((part) => {
                      if (part.type !== "text" || !part.text) return []
                      return preloadMarkdown(part.text, part.id, marked)
                    }),
                  ),
                )
              })
              .catch(() => {})
              .finally(dispose)
          } catch {
            dispose()
          }
        })
      })
  })

  function closeSearch() {
    setState("search", "")
    setState("searchFocused", false)
  }

  function openSession(session: any) {
    const conn = focusedServer()
    if (!conn) return
    const ctx = global.ensureServerCtx(conn)
    const project = projectForSession(session, projects(), projectByID())
    const directory = project?.worktree ?? session.directory
    global.sessionPlacement.set({
      server: ServerConnection.key(conn),
      leafID: session.id,
      rootID: session.id,
      directory: session.directory,
    })
    ctx.projects.open(directory)
    ctx.projects.touch(directory)
    void startTransition(() => {
      const tab = tabs.addSessionTab({ server: ServerConnection.key(conn), sessionId: session.id })
      tabs.select(tab)
    })
  }

  function selectSearchSession(session: any) {
    openSession(session)
    closeSearch()
  }

  const newSessionDirectory = createMemo(() => {
    const selected = selectedProject()
    const last = focusedScope() ? global.lastSession.directory(focusedScope()!) : undefined
    if (selected && last) {
      const lastKey = pathKey(last)
      const containsLast =
        pathKey(selected.worktree) === lastKey || (selected.sandboxes ?? []).some((s) => pathKey(s) === lastKey)
      if (containsLast) return last
    }
    if (selected) return selected.worktree
    if (last) return last
    return projects()[0]?.worktree
  })

  function openNewSession() {
    const conn = focusedServer()
    if (!conn) return
    const directory = newSessionDirectory()
    if (!directory) return
    const ctx = global.ensureServerCtx(conn)
    openProjectNewSession(
      ctx.projects,
      (serverKey, draftDirectory) => tabs.newDraft({ server: serverKey, directory: draftDirectory, ...modeDraft(mode.currentMode) }),
      ServerConnection.key(conn),
      directory,
    )
  }

  return (
    <>
      <HomeSessionSearch
        value={state.search}
        placeholder={language.t("home.sessions.search.placeholder")}
        open={searchOpen()}
        loading={sessionLoad.isLoading}
        results={searchResults()}
        server={codingSel.selection.server}
        activeServer={codingSel.selection.server === server.key}
        noResultsLabel={language.t("home.sessions.search.noResults", { query: search() })}
        bindFocus={(focus) => { focusSessionSearch = focus }}
        onInput={(value) => setState("search", value)}
        onFocus={() => setState("searchFocused", true)}
        onClose={closeSearch}
        onSelect={selectSearchSession}
      />
      <ScrollView class="mt-3 min-h-0 flex-1">
        <div class="pt-3 flex flex-col gap-6">
          <Show
            when={!sessionLoad.isLoading}
            fallback={<HomeSessionSkeleton label={language.t("common.loading")} />}
          >
            <Show
              when={groups().length > 0}
              fallback={
                <div class="flex min-w-0 flex-col gap-4">
                  <HomeSessionGroupHeader
                    title={language.t("home.sessions.empty")}
                    onNewSession={openNewSession}
                  />
                </div>
              }
            >
              <For each={groups()}>
                {(group, index) => (
                  <div class="flex min-w-0 flex-col gap-4">
                    <HomeSessionGroupHeader
                      title={group.title}
                      onNewSession={index() === 0 ? openNewSession : undefined}
                    />
                    <div class="flex min-w-0 flex-col gap-px">
                      <For each={group.sessions}>
                        {(record) => (
                          <HomeSessionRow
                            record={record}
                            server={codingSel.selection.server}
                            activeServer={codingSel.selection.server === server.key}
                            onClick={() => openSession(record.session)}
                          />
                        )}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </div>
      </ScrollView>
    </>
  )
}

/** Chat 主区：资产工作台（ADR-15 Main slot for chat mode） */
export function ChatAssetWorkbenchMain() {
  const assets = useModeWorkspaceAssets()
  const { selected: chatFeature } = useChatFeature()
  const dialog = useDialog()
  const language = useLanguage()
  const global = useGlobal()
  const tabs = useTabs()
  const server = useServer()
  const { ctx: chatCtx, directory: chatDirectory } = useChatDirectory()

  const conn = createMemo(() => server.current ?? global.servers.list()[0])
  const chatDir = () => chatDirectory() ?? ""

  function onNewAsset() {
    const c = conn()
    const dir = chatDir()
    if (!c || !dir) return
    const ctx = global.ensureServerCtx(c)
    const seedPrompt = language.t("asset.panel.newSeed", { kind: chatFeature() })
    openProjectNewSession(
      ctx.projects,
      (serverKey, draftDirectory) =>
        tabs.newDraft({ server: serverKey, directory: draftDirectory, ...modeDraft("chat") }, seedPrompt),
      ServerConnection.key(c),
      dir,
    )
  }

  function onImportAsset() {
    const c = conn()
    const dir = chatDir()
    if (!c || !dir) return
    void dialog.show(() => (
      <ChatImportDialog
        client={assets?.chatDirSdk()?.client}
        onImport={(result) => {
          const content = serializeImport(result)
          if (!content) return
          const ctx = global.ensureServerCtx(c)
          const prompt = wrapImportContent(content, language.t("chatImport.untrustedInstruction"))
          openProjectNewSession(
            ctx.projects,
            (serverKey, draftDirectory) =>
              tabs.newDraft({ server: serverKey, directory: draftDirectory, ...modeDraft("chat") }, prompt),
            ServerConnection.key(c),
            dir,
          )
        }}
      />
    ))
  }

  function onDeleteAsset(row: AssetWorkbench.AssetRow) {
    const sdk = assets?.chatDirSdk()
    if (!sdk) return
    void dialog.show(() => (
      <AssetDeleteDialog
        asset={row}
        onDelete={async () => {
          const shared = {
            sessionID: "ses-home-delete",
            relativePath: row.relativePath,
          }
          try {
            switch (row.kind) {
              case "prompt":
                await sdk.client.promptAsset.delete(shared, { throwOnError: true }); break
              case "skill":
                await sdk.client.skillAsset.delete(shared, { throwOnError: true }); break
              case "mcp":
                await sdk.client.mcpAsset.delete(shared, { throwOnError: true }); break
              case "command":
                await sdk.client.commandAsset.delete(shared, { throwOnError: true }); break
              case "agent":
                await sdk.client.agentAsset.delete(shared, { throwOnError: true }); break
              case "workflow":
                await sdk.client.workflowAsset.delete(shared, { throwOnError: true }); break
              case "plugin":
                await sdk.client.pluginAsset.delete(shared, { throwOnError: true }); break
            }
          } catch {
            return
          }
          assets?.refetchAssets()
        }}
      />
    ))
  }

  return (
    <AssetWorkbench.AssetWorkbenchTable
      assets={assets?.mergedAssetData().assets ?? []}
      invalid={assets?.mergedAssetData().invalid ?? []}
      kindFilter={chatFeature() as AssetWorkbench.AssetKind}
      onNew={onNewAsset}
      onImport={onImportAsset}
      onDelete={onDeleteAsset}
      onInsert={(row) => dialog.show(() => <AssetSessionSelector asset={row} />)}
    />
  )
}

/** Work 主区占位 */
export function PlaceholderMain(props: { mode: string }) {
  const language = useLanguage()
  return (
    <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-v2-text-text-muted text-13-regular">
      <span>{language.t("sidebar.secondary.noResults")}</span>
    </div>
  )
}

/** Work 侧栏：项目 Location 选择器 + 新建会话 */
export function WorkProjectColumnSidebar() {
  const language = useLanguage()
  const global = useGlobal()
  const tabs = useTabs()
  const pickDirectory = useDirectoryPicker()
  const { conn, ctx, directory } = useChatDirectory()

  function newSession() {
    const c = conn()
    const currentCtx = ctx()
    const dir = directory()
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
        if (!dirs[0]) return
        dirs.forEach((dir) => currentCtx.projects.open(dir))
        currentCtx.projects.touch(dirs[0])
        global.lastSession.set(currentCtx.sdk.scope, dirs[0])
      },
    })
  }

  return (
    <div class="flex min-h-0 shrink-0 flex-col">
      <div class="flex items-center gap-1.5 border-b border-v2-border-border-base px-3 pb-3 pt-3">
        <Icon name="mode-work" size="small" class="shrink-0 text-v2-icon-icon-muted" />
        <span class="shrink-0 text-v2-text-text-muted text-11-regular">{language.t("chat.feature.project")}</span>
        <span class="min-w-0 flex-1 truncate text-v2-text-text-base text-11-regular">
          {directory() ? getFilename(directory()) || directory() : language.t("work.preset.noLocation")}
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

/** Work 主区：预设卡片库（4 分类 + 预留预设无创建入口） */
export function WorkPresetCatalogMain() {
  const language = useLanguage()
  const global = useGlobal()
  const tabs = useTabs()
  const { conn, ctx, directory } = useChatDirectory()
  const { categories } = buildWorkPresetCatalog()

  function startPreset(preset: WorkPreset.Preset) {
    const c = conn()
    const currentCtx = ctx()
    const dir = directory()
    if (!c || !currentCtx || !dir) return
    openProjectNewSession(
      currentCtx.projects,
      (serverKey, draftDirectory) =>
        tabs.newDraft({ server: serverKey, directory: draftDirectory, ...modeDraft("work") }, presetLaunch(preset)),
      ServerConnection.key(c),
      dir,
    )
  }

  return (
    <ScrollView class="min-h-0 flex-1">
      <div class="flex min-h-0 flex-col gap-6 px-6 py-5">
        <div class="flex flex-col gap-1">
          <h1 class="text-v2-text-text-base text-16-medium">{language.t("work.preset.title")}</h1>
          <p class="text-v2-text-text-muted text-13-regular">{language.t("work.preset.subtitle")}</p>
        </div>
        <For each={categories}>
          {(category) => (
            <section class="flex min-w-0 flex-col gap-3">
              <h2 class="text-v2-text-text-base text-13-medium">{language.t(category.labelKey)}</h2>
              <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                <For each={category.presets}>
                  {(preset) => (
                    <button
                      type="button"
                      class="group flex min-w-0 flex-col gap-2 rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-02 p-4 text-left transition-colors hover:border-v2-border-border-strong hover:bg-v2-background-bg-layer-03 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus"
                      disabled={!directory()}
                      onClick={() => startPreset(preset)}
                    >
                      <span class="text-v2-text-text-base text-13-medium">{preset.title}</span>
                      <span class="text-v2-text-text-muted text-12-regular">{preset.description}</span>
                      <span class="text-v2-text-text-faint text-11-regular">
                        {language.t("work.preset.questions", { count: preset.questions.length })}
                      </span>
                    </button>
                  )}
                </For>
                <For each={category.reserved}>
                  {(title) => (
                    <div
                      aria-disabled="true"
                      class="flex min-w-0 flex-col gap-2 rounded-lg border border-dashed border-v2-border-border-base bg-v2-background-bg-base p-4 opacity-60"
                    >
                      <span class="text-v2-text-text-muted text-13-medium">{title}</span>
                      <span class="text-v2-text-text-faint text-11-regular">{language.t("work.preset.comingSoon")}</span>
                    </div>
                  )}
                </For>
              </div>
            </section>
          )}
        </For>
      </div>
    </ScrollView>
  )
}
