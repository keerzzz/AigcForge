import type { Session } from "@aigcfroge/sdk/v2/client"
import {
  batch,
  createEffect,
  createMemo,
  createRoot,
  For,
  on,
  onCleanup,
  onMount,
  Show,
  startTransition,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createStore } from "solid-js/store"
import { useQuery } from "@tanstack/solid-query"
import { Spinner } from "@aigcfroge/ui/spinner"
import { ScrollView } from "@aigcfroge/ui/scroll-view"
import { ProjectAvatar } from "@aigcfroge/ui/v2/project-avatar-v2"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { Icon as IconV2 } from "@aigcfroge/ui/v2/icon"
import { IconButtonV2 } from "@aigcfroge/ui/v2/icon-button-v2"
import { MenuV2 } from "@aigcfroge/ui/v2/menu-v2"
import { getProjectAvatarVariant, useLayout, type LocalProject } from "@/context/layout"
import { useNavigate, type RouteSectionProps } from "@solidjs/router"
import { DateTime } from "luxon"
import { useDialog } from "@aigcfroge/ui/context/dialog"
import { useDirectoryPicker } from "@/components/directory-picker"
import { useServerManagementController } from "@/components/dialog-select-server"
import { DialogServerV2 } from "@/components/settings-v2/dialog-server-v2"
import { ServerConnection, useServer } from "@/context/server"
import { sessionHasOpenTab, useTabs } from "@/context/tabs"
import { useServerSync, type ServerSync } from "@/context/server-sync"
import { useLanguage } from "@/context/language"
import { useNotification } from "@/context/notification"
import {
  closeHomeProject,
  displayName,
  getProjectAvatarSource,
  homeProjectDirectories,
  openProjectNewSession,
  type HomeProjectSelection,
  projectForSession,
  sortedRootSessions,
  toggleHomeProjectSelection,
} from "@/pages/layout/helpers"
import { SessionTabAvatar } from "@/pages/layout/session-tab-avatar"
import { sessionTitle } from "@/utils/session-title"
import { pathKey } from "@/utils/path-key"
import { useGlobal } from "@/context/global"
import { useCommand } from "@/context/command"
import { ServerRowMenu } from "@/components/server/server-row-menu"
import { ServerHealthIndicator } from "@/components/server/server-row"
import { type ServerHealth } from "@/utils/server-health"
import { Persist, persisted } from "@/utils/persist"
import { useMarked } from "@aigcfroge/ui/context/marked"
import { preloadMarkdown } from "@aigcfroge/session-ui/markdown-cache"
import { MODE_DEFINITIONS, modeDraft, useMode, type Mode } from "@/context/mode"
import { ChatFeaturePanel, modeSurface } from "@/components/mode-surfaces"
import { chatFeature } from "@/context/chat-feature"

const HOME_SESSION_LIMIT = 64
const HOME_ROW_LAYOUT =
  "flex min-w-0 w-full shrink-0 cursor-default items-center rounded-[6px] bg-transparent text-left transition-[background-color,color,box-shadow] duration-[120ms] ease-in-out focus-visible:outline-none"
const HOME_ROW_BASE = `${HOME_ROW_LAYOUT} border-0`
const HOME_ROW = `${HOME_ROW_BASE} [font-weight:530] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover`
const HOME_PROJECT_NAV_LABEL = "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
const HOME_PROJECT_NAV_ROW = `${HOME_ROW_LAYOUT} h-7 gap-2 px-1.5 [font-weight:440] text-v2-text-text-muted hover:bg-v2-background-bg-layer-01 hover:text-v2-text-text-base hover:[box-shadow:inset_0_0_0_0.5px_var(--v2-border-border-muted)] data-[selected]:bg-v2-background-bg-layer-03 data-[selected]:text-v2-text-text-base data-[selected]:[box-shadow:inset_0_0_0_0.5px_var(--v2-border-border-muted)] data-[selected]:hover:bg-v2-background-bg-layer-03 focus-visible:bg-v2-background-bg-layer-01 focus-visible:text-v2-text-text-base focus-visible:[box-shadow:inset_0_0_0_0.5px_var(--v2-border-border-muted)]`
const HOME_SECTION_LABEL = "text-v2-text-text-muted [font-weight:440]"

type HomeSessionRecord = {
  session: Session
  project: LocalProject
  projectName: string
}

type HomeSessionGroup = {
  id: "today" | "yesterday" | "older"
  title: string
  sessions: HomeSessionRecord[]
}

const HOME_SESSION_SEARCH_RESULTS_ID = "home-session-search-results"
const HOME_SEARCH_RESULT_ROW =
  "flex h-10 w-full shrink-0 cursor-default items-center gap-2 border-0 py-3 pl-4 pr-6 text-left transition-[background-color] duration-[120ms] ease-in-out hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none"
const HOME_SEARCH_RESULT_TITLE =
  "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] leading-4 tracking-[-0.04px] text-v2-text-text-base [font-weight:530]"
const HOME_SEARCH_RESULT_META =
  "min-w-0 flex-[1_1_auto] overflow-hidden text-ellipsis whitespace-nowrap text-[13px] leading-4 tracking-[-0.04px] text-v2-text-text-muted [font-weight:440]"

let pendingHomeNavigation: { server: ServerConnection.Key; href: string } | undefined

function buildHomeSessionRecords(input: {
  sync: Pick<ServerSync, "child">
  projectDirectories: () => string[]
  projects: () => LocalProject[]
  projectByID: () => Map<string, LocalProject>
}) {
  return [
    ...new Map(
      input
        .projectDirectories()
        .flatMap((directory) => sortedRootSessions(input.sync.child(directory, { bootstrap: false })[0], Date.now()))
        .map((session) => [`${pathKey(session.directory)}:${session.id}`, session] as const),
    ).values(),
  ]
    .sort((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
    .flatMap((session) => {
      const project = projectForSession(session, input.projects(), input.projectByID())
      if (!project) return []
      return {
        session,
        project,
        projectName: displayName(project),
      }
    })
}

function matchesHomeSessionSearch(record: HomeSessionRecord, query: string) {
  return `${record.session.title} ${record.projectName}`.toLowerCase().includes(query)
}

function homeSessionSearchKey(record: HomeSessionRecord) {
  return `${pathKey(record.session.directory)}:${record.session.id}`
}

export function Home(props: Partial<RouteSectionProps> & { modeEntry?: boolean } = {}) {
  const sync = useServerSync()
  const layout = useLayout()
  const pickDirectory = useDirectoryPicker()
  const mode = useMode()
  const dialog = useDialog()
  const navigate = useNavigate()
  const server = useServer()
  const language = useLanguage()
  const global = useGlobal()
  const tabs = useTabs()
  const command = useCommand()
  const notification = useNotification()
  const marked = useMarked()
  let focusSessionSearch: (() => void) | undefined
  const [state, setState] = createStore({
    search: "",
    selection: { server: server.key } as HomeProjectSelection,
    searchFocused: false,
  })

  const focusedServer = createMemo(
    () => global.servers.list().find((conn) => ServerConnection.key(conn) === state.selection.server) ?? server.current,
  )
  const focusedServerCtx = createMemo(() => {
    const conn = focusedServer()
    if (!conn) return
    return global.ensureServerCtx(conn)
  })
  const focusedSync = () => focusedServerCtx()?.sync ?? sync()
  const projects = createMemo(() => focusedServerCtx()?.projects.list() ?? layout.projects.list())
  const selectedProject = createMemo(() => projects().find((project) => project.worktree === state.selection.directory))
  const focusedScope = createMemo(() => focusedServerCtx()?.sdk.scope)
  // Directory for global "new session" entry points (mode cards, session-group header "+").
  // Priority: if the selected project contains the last session's directory, continue there
  // (preserves the workspace the user was last working in); otherwise fall back to the
  // selected project root, then the last session directory, then the first project.
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
  const directories = (project: LocalProject) => [project.worktree, ...(project.sandboxes ?? [])]
  const projectDirectories = createMemo(() => {
    const project = selectedProject()
    if (!project) return projects().flatMap(directories)
    return directories(project)
  })
  const search = createMemo(() => state.search.trim())
  const sessionLoad = useQuery(() => ({
    queryKey: ["home", "sessions", mode.currentMode, state.selection.server, ...projectDirectories()] as const,
    queryFn: async () => {
      await Promise.all(
        projectDirectories().map((directory) =>
          focusedSync().project.loadSessions(directory, { limit: HOME_SESSION_LIMIT, mode: mode.currentMode }),
        ),
      )
      return null
    },
  }))

  const projectByID = createMemo(
    () => new Map(projects().flatMap((project) => (project.id ? [[project.id, project] as const] : []))),
  )
  const allRecords = createMemo(() => {
    const sync = focusedSync()
    if (!sync) return []
    return buildHomeSessionRecords({
      sync,
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
        // Include sessions that match currentMode, or have no mode (backward compat → treat as "coding")
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
    // Clear prefetch state on server switch
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

  function setSelection(next: HomeProjectSelection) {
    batch(() => {
      if (state.selection.server !== next.server) setState("selection", "server", next.server)
      if (state.selection.directory !== next.directory) setState("selection", "directory", next.directory)
    })
  }

  // On first load (no project selected yet), default-select the project that
  // contains the last session's directory, so the project list highlights where
  // the user last worked. Runs once; later user selections are respected.
  let defaultSelectionApplied = false
  createEffect(() => {
    if (defaultSelectionApplied) return
    if (state.selection.directory) {
      defaultSelectionApplied = true
      return
    }
    const scope = focusedScope()
    if (!scope) return
    const last = global.lastSession.directory(scope)
    if (!last) return
    const lastKey = pathKey(last)
    const project = projects().find(
      (p) => pathKey(p.worktree) === lastKey || (p.sandboxes ?? []).some((s) => pathKey(s) === lastKey),
    )
    defaultSelectionApplied = true
    if (project) setSelection({ server: state.selection.server, directory: project.worktree })
  })

  // chat 模式：功能树 Location 切换（lastSession.directory 变化）联动右侧会话列表（m1 §1.4）
  createEffect(() => {
    if (mode.currentMode !== "chat") return
    const scope = focusedScope()
    if (!scope) return
    const dir = global.lastSession.directory(scope)
    if (!dir) return
    const conn = focusedServer()
    if (!conn) return
    if (state.selection.directory === dir) return
    setSelection({ server: ServerConnection.key(conn), directory: dir })
  })

  function closeSearch() {
    setState("search", "")
    setState("searchFocused", false)
  }

  function selectSearchSession(session: Session) {
    openSession(session)
    closeSearch()
  }

  command.register("home", () => [
    {
      id: "home.sessions.search.focus",
      title: language.t("home.sessions.search.placeholder"),
      keybind: "mod+f",
      hidden: true,
      onSelect: () => focusSessionSearch?.(),
    },
  ])

  createEffect(() => {
    const list = global.servers.list()
    if (list.some((conn) => ServerConnection.key(conn) === state.selection.server)) return
    const conn = list.find((conn) => ServerConnection.key(conn) === server.key) ?? list[0]
    if (conn) setSelection({ server: ServerConnection.key(conn) })
  })

  createEffect(() => {
    const pending = pendingHomeNavigation
    if (!pending || pending.server !== server.key) return
    pendingHomeNavigation = undefined
    navigate(pending.href)
  })

  function focusServer(conn: ServerConnection.Any) {
    setSelection({ server: ServerConnection.key(conn) })
  }

  function selectProject(conn: ServerConnection.Any, directory: string) {
    const key = ServerConnection.key(conn)
    if (
      !global
        .ensureServerCtx(conn)
        .projects.list()
        .some((project) => project.worktree === directory)
    )
      return
    setSelection(toggleHomeProjectSelection(state.selection, key, directory))
  }

  function addProjects(conn: ServerConnection.Any, directories: string[]) {
    const directory = directories[0]
    if (!directory) return
    const ctx = global.ensureServerCtx(conn)
    directories.forEach(ctx.projects.open)
    ctx.projects.touch(directory)
    setSelection({ server: ServerConnection.key(conn), directory })
  }

  function openNewSession() {
    const conn = focusedServer()
    if (!conn) return console.warn("openNewSession: no server available")
    const directory = newSessionDirectory() || projects().find((p) => p.worktree)?.worktree
    if (!directory) return console.warn("openNewSession: no directory available")
    openProjectNewSessionFn(conn, directory)
  }

  function openProjectNewSessionFn(conn: ServerConnection.Any, directory: string) {
    const ctx = global.ensureServerCtx(conn)
    openProjectNewSession(
      ctx.projects,
      (server, draftDirectory) => tabs.newDraft({ server, directory: draftDirectory, ...modeDraft(mode.currentMode) }),
      ServerConnection.key(conn),
      directory,
    )
  }

  function editProject(conn: ServerConnection.Any, project: LocalProject) {
    void import("@/components/dialog-edit-project").then((x) => {
      void dialog.show(() => <x.DialogEditProject server={conn} project={project} />)
    })
  }

  function unseenCount(conn: ServerConnection.Any, project: LocalProject) {
    if (ServerConnection.key(conn) !== server.key) return 0
    return directories(project).reduce((total, directory) => total + notification.project.unseenCount(directory), 0)
  }

  function clearNotifications(conn: ServerConnection.Any, project: LocalProject) {
    if (ServerConnection.key(conn) !== server.key) return
    directories(project)
      .filter((directory) => notification.project.unseenCount(directory) > 0)
      .forEach((directory) => notification.project.markViewed(directory))
  }

  function openSession(session: Session) {
    const project = projectForSession(session, projects(), projectByID())
    const conn = focusedServer()
    if (!conn) return
    const directory = project?.worktree ?? session.directory
    const ctx = global.ensureServerCtx(conn)
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

  function chooseProject(conn: ServerConnection.Any) {
    function resolve(result: string | string[] | null) {
      addProjects(conn, homeProjectDirectories(result))
    }

    pickDirectory({
      server: conn,
      title: language.t("command.project.open"),
      multiple: true,
      onSelect: resolve,
    })
  }

  function enterMode(selected: Mode) {
    // 首页就地分流（m1 §1.4）：点卡片只切 currentMode，不跳路由，下方左右栏就地切换
    mode.setCurrentMode(selected)
  }

  return (
    <div class="rounded-[10px] shadow-[var(--v2-elevation-raised)] m-2 min-h-0 lg:overflow-hidden bg-v2-background-bg-base self-stretch flex-1 flex flex-col">
      <Show when={!props.modeEntry}>
        <div class="shrink-0 px-6 pt-6 lg:pt-12">
          <HomeModeCards mode={mode} language={language} enterMode={enterMode} />
        </div>
      </Show>
      <div
        class={`mx-auto grid h-full w-full grid-rows-[auto_minmax(0,1fr)_auto] gap-4 px-3 pb-3 lg:grid-rows-1 lg:px-6 lg:pb-16 ${
          props.modeEntry
            ? "max-w-[720px] lg:grid-cols-1"
            : "max-w-[1080px] lg:grid-cols-[280px_minmax(0,720px)] lg:gap-8"
        }`}
      >
        <Show
          when={mode.currentMode === "coding"}
          fallback={<Dynamic component={modeSurface(mode.currentMode).Sidebar} />}
        >
          <HomeProjectColumn
            projects={projects()}
            selected={state.selection}
            focusServer={focusServer}
            selectProject={selectProject}
            openNewSession={openProjectNewSessionFn}
            chooseProject={(conn) => {
              chooseProject(conn)
            }}
            editProject={editProject}
            closeProject={(conn, directory) => {
              const next = closeHomeProject(
                state.selection,
                ServerConnection.key(conn),
                global.ensureServerCtx(conn).projects,
                directory,
              )
              if (next) setSelection(next)
            }}
            clearNotifications={clearNotifications}
            unseenCount={unseenCount}
            language={language}
          />
        </Show>

        <section
          class="min-h-0 min-w-0 flex-1 flex flex-col pt-6 lg:pt-12"
          aria-label={language.t("sidebar.project.recentSessions")}
        >
          <Show
            when={!(mode.currentMode === "chat" && chatFeature() !== "prompt")}
            fallback={<ChatFeaturePanel />}
          >
          <HomeSessionSearch
            value={state.search}
            placeholder={language.t("home.sessions.search.placeholder")}
            open={searchOpen()}
            loading={sessionLoad.isLoading}
            results={searchResults()}
            server={state.selection.server}
            activeServer={state.selection.server === server.key}
            noResultsLabel={language.t("home.sessions.search.noResults", { query: search() })}
            bindFocus={(focus) => {
              focusSessionSearch = focus
            }}
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
                        actionLabel={
                          mode.currentMode === "chat" ? language.t("promptAsset.panel.newPrompt") : undefined
                        }
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
                          actionLabel={
                            mode.currentMode === "chat" ? language.t("promptAsset.panel.newPrompt") : undefined
                          }
                        />
                        <div class="flex min-w-0 flex-col gap-px">
                          <For each={group.sessions}>
                            {(record) => (
                              <HomeSessionRow
                                record={record}
                                server={state.selection.server}
                                activeServer={state.selection.server === server.key}
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
          </Show>
        </section>
      </div>
    </div>
  )
}

function HomeModeCards(props: {
  mode: ReturnType<typeof useMode>
  language: ReturnType<typeof useLanguage>
  enterMode: (m: Mode) => void
}) {
  return (
    <div class="flex flex-col gap-3">
      <h2 class="text-v2-text-text-base [font-weight:600]">{props.language.t("home.modes.title")}</h2>
      <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <For each={MODE_DEFINITIONS}>
          {(m) => {
            const active = () => props.mode.currentMode === m.id

            return (
              <button
                type="button"
                aria-label={props.language.t(m.labelKey)}
                class="relative flex cursor-default items-center gap-3.5 rounded-lg border p-4 text-left transition-[all] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus"
                classList={{
                  "bg-v2-background-bg-layer-01 border-v2-border-border-base hover:bg-v2-overlay-simple-overlay-hover hover:border-v2-border-border-hover shadow-[var(--v2-elevation-base)]":
                    !active(),
                  "bg-v2-background-bg-layer-02 border-v2-border-border-focus shadow-inner ring-1 ring-v2-border-border-focus":
                    active(),
                }}
                onClick={() => props.enterMode(m.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    props.enterMode(m.id)
                  }
                }}
              >
                {/* Active Indicator Strip on Left */}
                <Show when={active()}>
                  <div class="absolute left-0 top-0 bottom-0 w-0.5 bg-v2-border-border-focus rounded-l-lg" />
                </Show>

                <IconV2 name={m.icon} size="large" class="shrink-0 text-v2-icon-icon-base" />
                <div class="flex min-w-0 flex-col gap-0.5 flex-1 pr-14">
                  <span class="text-v2-text-text-base [font-weight:600]">{props.language.t(m.labelKey)}</span>
                  <span class="text-11-regular text-v2-text-text-muted [font-weight:440]">
                    {props.language.t(m.descriptionKey)}
                  </span>
                </div>
              </button>
            )
          }}
        </For>
      </div>
    </div>
  )
}

function HomeProjectColumn(props: {
  projects: LocalProject[]
  selected: HomeProjectSelection
  focusServer: (server: ServerConnection.Any) => void
  selectProject: (server: ServerConnection.Any, directory: string) => void
  openNewSession: (server: ServerConnection.Any, directory: string) => void
  chooseProject: (server: ServerConnection.Any) => void
  editProject: (server: ServerConnection.Any, project: LocalProject) => void
  closeProject: (server: ServerConnection.Any, directory: string) => void
  clearNotifications: (server: ServerConnection.Any, project: LocalProject) => void
  unseenCount: (server: ServerConnection.Any, project: LocalProject) => number
  language: ReturnType<typeof useLanguage>
}) {
  const global = useGlobal()
  const dialog = useDialog()
  const controller = useServerManagementController({ navigateOnAdd: false })
  const [state, setState] = persisted(
    Persist.global("home.servers", ["home.servers.v1"]),
    createStore({ collapsed: {} as Record<string, boolean> }),
  )
  return (
    <aside
      class="mt-6 flex min-w-0 flex-col gap-4 lg:mt-14 lg:pt-[52px]"
      aria-label={props.language.t("home.projects")}
    >
      <div class="flex h-7 min-w-0 items-center justify-between pl-1.5">
        <div class={HOME_SECTION_LABEL}>{props.language.t("home.projects")}</div>
      </div>
      <Show
        when={global.servers.list().length > 1}
        fallback={<HomeProjectList {...props} server={global.servers.list()[0]} />}
      >
        <For each={global.servers.list()}>
          {(item) => {
            const key = ServerConnection.key(item)
            const healthy = () => !!global.servers.health[key]?.healthy
            const serverCtx = global.ensureServerCtx(item)
            const collapsed = () => state.collapsed[key]
            return (
              <div class="flex max-h-[min(572px,calc(100vh_-_300px))] min-w-0 flex-col gap-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <HomeServerRow
                  server={item}
                  selected={props.selected.server === key && !props.selected.directory}
                  healthy={healthy()}
                  collapsed={collapsed()}
                  health={global.servers.health[key]}
                  controller={controller}
                  focusServer={props.focusServer}
                  chooseProject={props.chooseProject}
                  openEdit={(server) => dialog.show(() => <DialogServerV2 mode="edit" server={server} />)}
                  toggleCollapsed={() => setState("collapsed", key, !state.collapsed[key])}
                  language={props.language}
                />
                <Show when={healthy() && !collapsed()}>
                  <div class="mx-3 h-px bg-v2-border-border-base" />
                  <HomeProjectList {...props} server={item} projects={serverCtx.projects.list()} />
                </Show>
              </div>
            )
          }}
        </For>
      </Show>

      {/* Prominent Add Project Button */}
      <Show when={global.servers.list().length === 1}>
        <div class="flex flex-col gap-1 mt-1">
          <ButtonV2
            onClick={() => props.chooseProject(global.servers.list()[0])}
            variant="neutral"
            class="w-full justify-start h-8 text-11-medium"
            icon="folder-add-left"
          >
            {props.language.t("home.project.add")}
          </ButtonV2>
        </div>
      </Show>
    </aside>
  )
}

function HomeServerRow(props: {
  server: ServerConnection.Any
  selected: boolean
  healthy: boolean
  collapsed: boolean
  health: ServerHealth | undefined
  controller: ReturnType<typeof useServerManagementController>
  focusServer: (server: ServerConnection.Any) => void
  chooseProject: (server: ServerConnection.Any) => void
  openEdit: (server: ServerConnection.Http) => void
  toggleCollapsed: () => void
  language: ReturnType<typeof useLanguage>
}) {
  const [state, setState] = createStore({ menuOpen: false })
  return (
    <div class="group/server relative flex h-7 min-w-0 items-center rounded-[6px]">
      <button
        type="button"
        class={`${HOME_PROJECT_NAV_ROW} pr-16 disabled:opacity-60`}
        data-selected={props.selected ? "" : undefined}
        disabled={!props.healthy}
        onClick={() => props.focusServer(props.server)}
      >
        <Show when={props.healthy}>
          <span
            data-action="home-server-collapse"
            class="inline-flex -ml-0.5 -mr-1.5 size-5 shrink-0 items-center justify-center rounded-[4px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover"
            aria-label={
              props.collapsed ? props.language.t("home.server.expand") : props.language.t("home.server.collapse")
            }
            aria-expanded={!props.collapsed}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              props.toggleCollapsed()
            }}
            onPointerDown={(event) => event.preventDefault()}
          >
            <IconV2
              name="chevron-down"
              size="small"
              class="transition-transform duration-150 ease-in-out"
              style={{ transform: `rotate(${props.collapsed ? -90 : 0}deg)` }}
            />
          </span>
        </Show>
        <div class="flex size-4 shrink-0 items-center justify-center -mr-0.5">
          <ServerHealthIndicator health={props.health} />
        </div>
        <span class="flex min-w-0 items-center gap-1">
          <span class={HOME_PROJECT_NAV_LABEL}>{props.server.displayName ?? new URL(props.server.http.url).host}</span>
          <Show when={props.server.label}>
            {(label) => (
              <span class="shrink-0 rounded-[3px] border border-v2-border-border-base px-1 py-0.5 text-[9px] leading-none text-v2-text-text-muted">
                {label()}
              </span>
            )}
          </Show>
        </span>
      </button>
      <div
        class="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover/server:opacity-100 focus-within:opacity-100 data-[menu=true]:opacity-100"
        data-menu={state.menuOpen}
      >
        <ServerRowMenu
          server={props.server}
          controller={props.controller}
          onEdit={props.openEdit}
          open={state.menuOpen}
          onOpenChange={(open) => setState("menuOpen", open)}
        />
        <IconButtonV2
          data-action="home-add-project"
          variant="ghost-muted"
          size="small"
          icon={<IconV2 name="folder-add-left" />}
          aria-label={props.language.t("home.project.add")}
          onClick={() => props.chooseProject(props.server)}
        />
      </div>
    </div>
  )
}

function HomeProjectList(props: {
  server: ServerConnection.Any
  projects: LocalProject[]
  selected: HomeProjectSelection
  selectProject: (server: ServerConnection.Any, directory: string) => void
  openNewSession: (server: ServerConnection.Any, directory: string) => void
  editProject: (server: ServerConnection.Any, project: LocalProject) => void
  closeProject: (server: ServerConnection.Any, directory: string) => void
  clearNotifications: (server: ServerConnection.Any, project: LocalProject) => void
  unseenCount: (server: ServerConnection.Any, project: LocalProject) => number
  language: ReturnType<typeof useLanguage>
}) {
  return (
    <div class="flex min-w-0 flex-col gap-1">
      <For each={props.projects}>
        {(project) => (
          <HomeProjectRow
            project={project}
            server={props.server}
            selected={
              props.selected.server === ServerConnection.key(props.server) &&
              props.selected.directory === project.worktree
            }
            unseenCount={props.unseenCount(props.server, project)}
            selectProject={props.selectProject}
            openNewSession={props.openNewSession}
            editProject={props.editProject}
            closeProject={props.closeProject}
            clearNotifications={props.clearNotifications}
            language={props.language}
          />
        )}
      </For>
    </div>
  )
}

function HomeProjectRow(props: {
  project: LocalProject
  server: ServerConnection.Any
  selected: boolean
  unseenCount: number
  selectProject: (server: ServerConnection.Any, directory: string) => void
  openNewSession: (server: ServerConnection.Any, directory: string) => void
  editProject: (server: ServerConnection.Any, project: LocalProject) => void
  closeProject: (server: ServerConnection.Any, directory: string) => void
  clearNotifications: (server: ServerConnection.Any, project: LocalProject) => void
  language: ReturnType<typeof useLanguage>
}) {
  const [state, setState] = createStore({ menuOpen: false })
  return (
    <div class="group/project relative flex h-7 min-w-0 items-center rounded-[6px]">
      <button
        type="button"
        data-component="home-project-row"
        class={`${HOME_PROJECT_NAV_ROW} pr-16`}
        data-selected={props.selected ? "" : undefined}
        aria-current={props.selected ? "page" : undefined}
        onClick={() => props.selectProject(props.server, props.project.worktree)}
      >
        <HomeProjectAvatar project={props.project} />
        <span class={HOME_PROJECT_NAV_LABEL}>{displayName(props.project)}</span>
      </button>
      <div
        class="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover/project:opacity-100 focus-within:opacity-100 data-[menu=true]:opacity-100"
        data-menu={state.menuOpen}
      >
        <IconButtonV2
          data-action="home-project-new-session"
          variant="ghost-muted"
          size="small"
          icon={<IconV2 name="edit" />}
          aria-label={props.language.t("command.session.new")}
          onClick={() => props.openNewSession(props.server, props.project.worktree)}
        />
        <MenuV2
          gutter={4}
          modal={false}
          placement="bottom-end"
          open={state.menuOpen}
          onOpenChange={(open) => setState("menuOpen", open)}
        >
          <MenuV2.Trigger
            as={IconButtonV2}
            data-action="home-project-menu"
            variant="ghost-muted"
            size="small"
            icon={<IconV2 name="outline-dots" />}
            aria-label={props.language.t("common.moreOptions")}
          />
          <MenuV2.Portal>
            <MenuV2.Content>
              <MenuV2.Item onSelect={() => props.openNewSession(props.server, props.project.worktree)}>
                {props.language.t("command.session.new")}
              </MenuV2.Item>
              <MenuV2.Item onSelect={() => props.editProject(props.server, props.project)}>
                {props.language.t("common.edit")}
              </MenuV2.Item>
              <MenuV2.Item
                disabled={props.unseenCount === 0}
                onSelect={() => props.clearNotifications(props.server, props.project)}
              >
                {props.language.t("sidebar.project.clearNotifications")}
              </MenuV2.Item>
              <MenuV2.Separator />
              <MenuV2.Item onSelect={() => props.closeProject(props.server, props.project.worktree)}>
                {props.language.t("common.close")}
              </MenuV2.Item>
            </MenuV2.Content>
          </MenuV2.Portal>
        </MenuV2>
      </div>
    </div>
  )
}

function HomeProjectAvatar(props: { project: LocalProject }) {
  const name = createMemo(() => displayName(props.project))
  return (
    <ProjectAvatar
      fallback={name()}
      src={getProjectAvatarSource(props.project.id, props.project.icon)}
      variant={getProjectAvatarVariant(props.project.icon?.color)}
    />
  )
}

function HomeSessionLeading(props: {
  project: LocalProject
  session: Session
  server: ServerConnection.Key
  activeServer: boolean
}) {
  const tabs = useTabs()
  const hasOpenTab = createMemo(() => sessionHasOpenTab(tabs.store, props.server, props.session))
  return (
    <div class="relative shrink-0">
      <Show when={hasOpenTab()}>
        <span
          aria-hidden="true"
          class="pointer-events-none absolute top-1/2 h-[7px] w-[3px] -translate-y-1/2 rounded-[2px] bg-v2-background-bg-layer-04"
          style={{ right: "calc(100% + 12px)" }}
        />
      </Show>
      <SessionTabAvatar
        project={props.project}
        directory={props.session.directory}
        sessionId={props.session.id}
        activeServer={props.activeServer}
      />
    </div>
  )
}

function HomeSessionSearch(props: {
  value: string
  placeholder: string
  open: boolean
  loading: boolean
  results: HomeSessionRecord[]
  server: ServerConnection.Key
  activeServer: boolean
  noResultsLabel: string
  bindFocus: (focus: () => void) => void
  onInput: (value: string) => void
  onFocus: () => void
  onClose: () => void
  onSelect: (session: Session) => void
}) {
  const language = useLanguage()
  const [store, setStore] = createStore({ active: "" })
  let root: HTMLDivElement | undefined
  let input: HTMLInputElement | undefined
  let listRef: HTMLDivElement | undefined

  const focusInput = () => {
    input?.focus()
    props.onFocus()
  }

  onMount(() => {
    props.bindFocus(focusInput)
  })

  const syncActive = (results: HomeSessionRecord[]) => {
    if (results.length === 0) {
      setStore("active", "")
      return
    }
    if (!results.some((record) => homeSessionSearchKey(record) === store.active)) {
      setStore("active", homeSessionSearchKey(results[0]))
    }
  }

  createEffect(() => syncActive(props.results))

  createEffect(
    on(
      () => props.value,
      () => syncActive(props.results),
    ),
  )

  const scrollActiveIntoView = () => {
    const key = store.active
    if (!key || !listRef) return
    const element = listRef.querySelector<HTMLElement>(`[data-key="${key}"]`)
    element?.scrollIntoView({ block: "nearest" })
  }

  const moveActive = (delta: number) => {
    const results = props.results
    if (results.length === 0) return
    const index = results.findIndex((record) => homeSessionSearchKey(record) === store.active)
    const start = index === -1 ? 0 : index
    const next = (start + delta + results.length) % results.length
    setStore("active", homeSessionSearchKey(results[next]))
    scrollActiveIntoView()
  }

  const selectActive = () => {
    const record = props.results.find((item) => homeSessionSearchKey(item) === store.active)
    if (!record) return
    props.onSelect(record.session)
  }

  onCleanup(
    makeEventListener(document, "pointerdown", (event) => {
      if (!props.open) return
      const target = event.target
      if (!(target instanceof Node)) return
      if (root?.contains(target)) return
      props.onClose()
    }),
  )

  return (
    <div class="ml-4 mr-2 w-[calc(100%_-_24px)]">
      <div ref={root} data-component="home-session-search" class="relative z-10 w-full">
        <Show when={props.open}>
          <div
            data-component="home-session-search-panel"
            class="absolute flex flex-col rounded-[12px] bg-v2-background-bg-base shadow-[var(--v2-elevation-floating)]"
            style={{
              top: "-6px",
              left: "-6px",
              width: "calc(100% + 14px)",
            }}
          >
            <div class="flex flex-col pt-9">
              <div id={HOME_SESSION_SEARCH_RESULTS_ID} role="listbox" class="flex flex-col gap-4 pt-4 pb-2">
                <Show
                  when={!props.loading}
                  fallback={
                    <div class="flex items-center justify-center px-4 py-3 text-v2-text-text-muted [font-weight:440]">
                      <Spinner class="size-4" />
                    </div>
                  }
                >
                  <Show
                    when={props.results.length > 0}
                    fallback={
                      <p class="my-1.5 px-4 text-[13px] leading-4 tracking-[-0.04px] text-v2-text-text-muted [font-weight:440]">
                        {props.noResultsLabel}
                      </p>
                    }
                  >
                    <div class="flex flex-col">
                      <p class="my-1.5 px-4 text-[13px] leading-4 tracking-[-0.04px] text-v2-text-text-muted [font-weight:440]">
                        {language.t("home.sessions.search.sessions")}
                      </p>
                      <div ref={listRef} class="flex max-h-80 flex-col gap-px overflow-y-auto">
                        <For each={props.results}>
                          {(record) => (
                            <HomeSessionSearchResultRow
                              record={record}
                              server={props.server}
                              activeServer={props.activeServer}
                              selected={store.active === homeSessionSearchKey(record)}
                              onHighlight={() => setStore("active", homeSessionSearchKey(record))}
                              onSelect={(session) => props.onSelect(session)}
                            />
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                </Show>
              </div>
            </div>
          </div>
        </Show>
        <label
          class="relative z-20 flex h-9 w-full items-center gap-2 rounded-[6px] py-1 pl-3 pr-2 text-v2-icon-icon-muted transition-[background-color,box-shadow] duration-[120ms] ease-in-out"
          classList={{
            "bg-v2-background-bg-layer-03 focus-within:bg-v2-background-bg-layer-03 focus-within:shadow-[0_0_0_0.5px_var(--v2-border-border-focus),var(--v2-elevation-raised)]":
              !props.open,
            "bg-transparent shadow-[0_0_0_0.5px_var(--v2-border-border-focus)]": props.open,
          }}
        >
          <IconV2 name="magnifying-glass" />
          <input
            ref={input}
            class="relative z-20 min-w-0 flex-1 border-0 bg-transparent text-v2-text-text-base outline-0 [font-weight:440] placeholder:text-v2-text-text-faint"
            value={props.value}
            placeholder={props.placeholder}
            aria-label={props.placeholder}
            aria-expanded={props.open}
            aria-controls={HOME_SESSION_SEARCH_RESULTS_ID}
            aria-autocomplete="list"
            aria-activedescendant={
              store.active && props.open ? `home-session-search-option-${store.active}` : undefined
            }
            onFocus={() => props.onFocus()}
            onInput={(event) => props.onInput(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault()
                props.onClose()
                input?.blur()
                return
              }
              if (!props.open || props.results.length === 0) return
              if (event.altKey || event.metaKey) return
              if (event.key === "ArrowDown") {
                event.preventDefault()
                moveActive(1)
                return
              }
              if (event.key === "ArrowUp") {
                event.preventDefault()
                moveActive(-1)
                return
              }
              if (event.key === "Enter" && !event.isComposing) {
                event.preventDefault()
                selectActive()
              }
            }}
          />
          <Show when={props.value}>
            <IconButtonV2
              type="button"
              variant="ghost-muted"
              size="small"
              class="relative z-20 shrink-0"
              icon={<IconV2 name="close" size="large" class="text-v2-icon-icon-muted" />}
              aria-label={props.placeholder}
              onClick={() => {
                props.onClose()
                input?.focus()
              }}
            />
          </Show>
        </label>
      </div>
    </div>
  )
}

function HomeSessionSearchResultRow(props: {
  record: HomeSessionRecord
  server: ServerConnection.Key
  activeServer: boolean
  selected: boolean
  onHighlight: () => void
  onSelect: (session: Session) => void
}) {
  const title = createMemo(() => sessionTitle(props.record.session.title) || props.record.session.id)

  const key = () => homeSessionSearchKey(props.record)

  return (
    <button
      type="button"
      id={`home-session-search-option-${key()}`}
      data-key={key()}
      data-component="home-session-search-row"
      role="option"
      aria-selected={props.selected}
      classList={{
        [HOME_SEARCH_RESULT_ROW]: true,
        "bg-v2-overlay-simple-overlay-hover": props.selected,
      }}
      onMouseEnter={() => props.onHighlight()}
      onClick={() => props.onSelect(props.record.session)}
    >
      <HomeSessionLeading
        project={props.record.project}
        session={props.record.session}
        server={props.server}
        activeServer={props.activeServer}
      />
      <div class="flex min-w-0 flex-1 items-center gap-1.5">
        <span
          class={`${HOME_SEARCH_RESULT_TITLE} ${props.record.projectName ? "max-w-[min(70%,480px)] flex-[0_1_auto]" : "flex-[1_1_auto]"}`}
        >
          {title()}
        </span>
        <Show when={props.record.projectName}>
          <span class={HOME_SEARCH_RESULT_META}>{props.record.projectName}</span>
        </Show>
      </div>
    </button>
  )
}

function HomeSessionGroupHeader(props: { title: string; onNewSession?: () => void; actionLabel?: string }) {
  const language = useLanguage()
  return (
    <div class="flex h-7 min-w-0 items-center gap-3 pl-4 pr-2">
      <div class={`${HOME_SECTION_LABEL} shrink-0 uppercase tracking-wider text-11-bold`}>{props.title}</div>
      <div class="flex-1 h-px bg-v2-border-border-muted opacity-40" />
      <Show when={props.onNewSession}>
        <ButtonV2
          data-action="home-new-session"
          variant="ghost-muted"
          size="normal"
          icon="edit"
          class="h-7 px-2 [font-weight:530] shrink-0"
          onClick={() => props.onNewSession?.()}
        >
          {props.actionLabel ?? language.t("command.session.new")}
        </ButtonV2>
      </Show>
    </div>
  )
}

function HomeSessionRow(props: {
  record: HomeSessionRecord
  server: ServerConnection.Key
  activeServer: boolean
  onClick: () => void
}) {
  const title = createMemo(() => sessionTitle(props.record.session.title) || props.record.session.id)

  const relativeTime = createMemo(() => {
    const timeMs = props.record.session.time.updated ?? props.record.session.time.created ?? Date.now()
    const dt = DateTime.fromMillis(timeMs)
    const now = DateTime.local()
    const diff = now.diff(dt, ["days", "hours", "minutes"])
    if (diff.days > 0) return `${Math.floor(diff.days)}d ago`
    if (diff.hours > 0) return `${Math.floor(diff.hours)}h ago`
    return `${Math.max(Math.floor(diff.minutes), 1)}m ago`
  })

  return (
    <button
      type="button"
      data-component="home-session-row"
      class={`${HOME_ROW} h-10 gap-2 px-6 py-3 pl-4 flex items-center justify-between group`}
      onClick={props.onClick}
    >
      <div class="flex items-center gap-2 min-w-0 flex-1">
        <HomeSessionLeading
          project={props.record.project}
          session={props.record.session}
          server={props.server}
          activeServer={props.activeServer}
        />
        <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-v2-text-text-base [font-weight:530] group-hover:translate-x-0.5 transition-transform duration-150">
          {title()}
        </span>
      </div>
      <span class="text-11-regular text-v2-text-text-muted opacity-80 shrink-0 font-mono select-none pl-2">
        {relativeTime()}
      </span>
    </button>
  )
}

function HomeSessionSkeleton(props: { label: string }) {
  return (
    <div class="flex min-w-0 flex-col gap-4">
      <div class="flex h-7 min-w-0 items-center justify-between px-4">
        <div class={HOME_SECTION_LABEL}>{props.label}</div>
      </div>
      <div class="flex min-w-0 flex-col gap-px" aria-hidden="true">
        <For each={[0, 1, 2, 3]}>{() => <div class="h-10 rounded-[6px] bg-v2-background-bg-deep opacity-70" />}</For>
      </div>
    </div>
  )
}

function groupSessions(records: HomeSessionRecord[], language: ReturnType<typeof useLanguage>): HomeSessionGroup[] {
  records = records ?? []
  const now = DateTime.local()
  const yesterday = now.minus({ days: 1 })
  const todaySessions = records.filter((record) =>
    DateTime.fromMillis(record.session.time.updated ?? record.session.time.created).hasSame(now, "day"),
  )
  const yesterdaySessions = records.filter((record) =>
    DateTime.fromMillis(record.session.time.updated ?? record.session.time.created).hasSame(yesterday, "day"),
  )
  const olderSessions = records.filter((record) => {
    const time = DateTime.fromMillis(record.session.time.updated ?? record.session.time.created)
    return !time.hasSame(now, "day") && !time.hasSame(yesterday, "day")
  })
  const olderTitle =
    todaySessions.length === 0 && yesterdaySessions.length === 0
      ? language.t("sidebar.project.recentSessions")
      : language.t("home.sessions.group.older")

  return [
    { id: "today" as const, title: language.t("home.sessions.group.today"), sessions: todaySessions },
    { id: "yesterday" as const, title: language.t("home.sessions.group.yesterday"), sessions: yesterdaySessions },
    { id: "older" as const, title: olderTitle, sessions: olderSessions },
  ].filter((group) => group.sessions.length > 0)
}
