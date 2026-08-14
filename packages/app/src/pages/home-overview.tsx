import { createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useQuery } from "@tanstack/solid-query"
import { ScrollView } from "@aigcfroge/ui/scroll-view"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { useDialog } from "@aigcfroge/ui/context/dialog"
import type { Session } from "@aigcfroge/sdk/v2/client"
import { useLanguage } from "@/context/language"
import { useGlobal } from "@/context/global"
import { useTabs } from "@/context/tabs"
import { useServer, ServerConnection } from "@/context/server"
import { useServerSync } from "@/context/server-sync"
import { useLayout, type LocalProject } from "@/context/layout"
import { modeDraft, useMode, type Mode } from "@/context/mode"
import { useNotification } from "@/context/notification"
import { useDirectoryPicker } from "@/components/directory-picker"
import {
  closeHomeProject,
  filterSessionsByMode,
  homeProjectDirectories,
  openProjectNewSession,
  openSessionRecord,
} from "@/pages/layout/helpers"
import {
  HOME_SECTION_LABEL,
  HOME_SESSION_LIMIT,
  buildHomeSessionRecords,
  groupSessions,
  matchesHomeSessionSearch,
  type HomeSessionRecord,
  HomeSessionGroupHeader,
  HomeProjectRow,
  HomeSessionRow,
  HomeSessionSearch,
  HomeSessionSkeleton,
} from "@/pages/home"
import { countByMode, countByProject, pinLastActive } from "@/pages/home-overview-model"
import { SessionModeBadge } from "@/components/session-mode-badge"
import { pathKey } from "@/utils/path-key"

const OVERVIEW_GRID = "mx-auto grid h-full w-full max-w-[1200px] grid-cols-[220px_minmax(0,1fr)] gap-4 px-6"
const MODE_FILTER_ROW =
  "flex h-7 min-w-0 cursor-default items-center gap-2 rounded-[6px] px-1.5 text-left text-[13px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none focus-visible:bg-v2-overlay-simple-overlay-hover data-[selected]:bg-v2-background-bg-layer-03 data-[selected]:text-v2-text-text-base"
const MODE_FILTER_COUNT = "ml-auto shrink-0 text-11-regular text-v2-text-text-faint"

/** Global session overview with mode/project filters and a last-active pin. */
export function HomeOverview() {
  const sync = useServerSync()
  const layout = useLayout()
  const mode = useMode()
  const server = useServer()
  const language = useLanguage()
  const global = useGlobal()
  const tabs = useTabs()

  const [state, setState] = createStore({
    search: "",
    searchFocused: false,
    modeFilter: "all" as "all" | Mode,
    projectFilter: undefined as string | undefined,
  })

  const focusedServer = createMemo(() => server.current)
  const focusedServerCtx = createMemo(() => {
    const conn = focusedServer()
    if (!conn) return undefined
    return global.ensureServerCtx(conn)
  })
  const focusedSync = () => focusedServerCtx()?.sync ?? sync()
  const focusedScope = createMemo(() => focusedServerCtx()?.sdk.scope)
  const projects = createMemo(() => focusedServerCtx()?.projects.list() ?? layout.projects.list())
  const projectByID = createMemo(
    () => new Map(projects().flatMap((project) => (project.id ? [[project.id, project] as const] : []))),
  )
  const selectedProject = createMemo(() => projects().find((project) => project.worktree === state.projectFilter))
  // Load the complete current-server set once; filters and counts stay in memory.
  const projectDirectories = createMemo(() => projects().flatMap((project) => [project.worktree, ...(project.sandboxes ?? [])]))
  const activeServer = () => {
    const conn = focusedServer()
    return conn ? ServerConnection.key(conn) === server.key : false
  }

  const sessionLoad = useQuery(() => ({
    queryKey: ["home", "overview-sessions", server.key, ...projectDirectories()] as const,
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
    return buildHomeSessionRecords({ sync: syncInstance, projectDirectories, projects, projectByID })
  })

  const filteredRecords = createMemo(() => {
    const all = allRecords()
    const byProject = state.projectFilter
      ? all.filter((record) => record.project.worktree === state.projectFilter)
      : all
    if (state.modeFilter === "all") return byProject.slice(0, HOME_SESSION_LIMIT)
    return filterSessionsByMode(byProject, state.modeFilter).slice(0, HOME_SESSION_LIMIT)
  })

  const lastActive = createMemo(() => {
    const scope = focusedScope()
    return scope ? global.lastActiveSession.get(scope) : undefined
  })
  const pinned = createMemo(() => pinLastActive(filteredRecords(), lastActive()))
  const groups = createMemo(() => groupSessions(pinned().rest, language))
  const counts = createMemo(() => countByMode(allRecords()))
  const projectCounts = createMemo(() => countByProject(allRecords()))

  const search = createMemo(() => state.search.trim())
  const searchResults = createMemo(() => {
    const query = search().toLowerCase()
    if (!query) return []
    return allRecords().filter((record) => matchesHomeSessionSearch(record, query))
  })
  const searchOpen = createMemo(() => state.searchFocused && search().length > 0)

  function openSession(record: HomeSessionRecord) {
    const conn = focusedServer()
    const ctx = focusedServerCtx()
    if (!conn || !ctx) return
    openSessionRecord({
      record,
      server: ServerConnection.key(conn),
      global,
      tabs,
      projects: ctx.projects,
      projectByID: projectByID(),
    })
  }

  const newSessionDirectory = createMemo(() => {
    const selected = selectedProject()
    const scope = focusedScope()
    const last = scope ? global.lastSession.directory(scope) : undefined
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
    const ctx = focusedServerCtx()
    if (!conn || !ctx) return
    const directory = newSessionDirectory()
    if (!directory) return
    openProjectNewSession(
      ctx.projects,
      (serverKey, draftDirectory) =>
        tabs.newDraft({ server: serverKey, directory: draftDirectory, ...modeDraft(mode.currentMode) }),
      ServerConnection.key(conn),
      directory,
    )
  }

  function closeSearch() {
    setState("search", "")
    setState("searchFocused", false)
  }

  function selectSearchSession(session: Session) {
    const record = searchResults().find((item) => item.session.id === session.id)
    if (!record) return
    openSession(record)
    closeSearch()
  }

  return (
    <div class={OVERVIEW_GRID} data-component="home-overview">
      <Show when={focusedServer()} fallback={<div />}>
        {(conn) => (
          <HomeOverviewSidebar
            server={conn()}
            projects={projects()}
            selectedDirectory={state.projectFilter}
            total={allRecords().length}
            counts={counts()}
            projectCounts={projectCounts()}
            modeFilter={state.modeFilter}
            onModeFilter={(modeFilter) => setState("modeFilter", modeFilter)}
            onSelectProject={(directory) => setState("projectFilter", directory)}
          />
        )}
      </Show>
      <div class="flex min-h-0 flex-col">
        <HomeSessionSearch
          value={state.search}
          placeholder={language.t("home.sessions.search.placeholder")}
          open={searchOpen()}
          loading={sessionLoad.isLoading}
          results={searchResults()}
          server={server.key}
          activeServer={activeServer()}
          noResultsLabel={language.t("home.sessions.search.noResults", { query: search() })}
          bindFocus={() => {}}
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
                when={pinned().pinned || groups().length > 0}
                fallback={
                  <div class="flex min-w-0 flex-col gap-4">
                    <HomeSessionGroupHeader title={language.t("home.sessions.empty")} onNewSession={openNewSession} />
                  </div>
                }
              >
                <Show when={pinned().pinned}>
                  {(pinnedRecord) => (
                    <div class="flex min-w-0 flex-col gap-4">
                      <HomeSessionGroupHeader title={language.t("home.overview.continue")} />
                      <div class="flex min-w-0 flex-col gap-px">
                        <HomeSessionRow
                          record={pinnedRecord()}
                          server={server.key}
                          activeServer={activeServer()}
                          onClick={() => openSession(pinnedRecord())}
                          badge={<SessionModeBadge mode={pinnedRecord().session.mode} />}
                        />
                      </div>
                    </div>
                  )}
                </Show>
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
                              server={server.key}
                              activeServer={activeServer()}
                              onClick={() => openSession(record)}
                              badge={<SessionModeBadge mode={record.session.mode} />}
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
      </div>
    </div>
  )
}

/** Home sidebar with mode counts and project filters, reusing HomeProjectRow. */
export function HomeOverviewSidebar(props: {
  server: ServerConnection.Any
  projects: LocalProject[]
  selectedDirectory: string | undefined
  total: number
  counts: Record<Mode, number>
  projectCounts: Map<string, number>
  modeFilter: "all" | Mode
  onModeFilter: (mode: "all" | Mode) => void
  onSelectProject: (directory: string | undefined) => void
}) {
  const global = useGlobal()
  const server = useServer()
  const language = useLanguage()
  const tabs = useTabs()
  const mode = useMode()
  const dialog = useDialog()
  const notification = useNotification()
  const pickDirectory = useDirectoryPicker()

  function openNewSession(conn: ServerConnection.Any, directory: string) {
    const ctx = global.ensureServerCtx(conn)
    openProjectNewSession(
      ctx.projects,
      (s, d) => tabs.newDraft({ server: s, directory: d, ...modeDraft(mode.currentMode) }),
      ServerConnection.key(conn),
      directory,
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
        props.onSelectProject(dirs[0])
      },
    })
  }
  function editProject(conn: ServerConnection.Any, project: LocalProject) {
    void import("@/components/dialog-edit-project").then((x) => {
      void dialog.show(() => <x.DialogEditProject server={conn} project={project} />)
    })
  }
  function closeProject(conn: ServerConnection.Any, directory: string) {
    closeHomeProject(undefined, ServerConnection.key(conn), global.ensureServerCtx(conn).projects, directory)
    if (props.selectedDirectory === directory) props.onSelectProject(undefined)
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

  const filters = createMemo<Array<{ id: "all" | Mode; label: string; count: number }>>(() => [
    { id: "all", label: language.t("home.overview.all"), count: props.total },
    { id: "coding", label: language.t("mode.coding"), count: props.counts.coding },
    { id: "chat", label: language.t("mode.chat"), count: props.counts.chat },
    { id: "work", label: language.t("mode.work"), count: props.counts.work },
    { id: "assistant", label: language.t("mode.assistant"), count: props.counts.assistant },
  ])

  return (
    <aside
      class="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto py-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      aria-label={language.t("home.overview.title")}
    >
      <div class="flex min-w-0 flex-col gap-1">
        <div class={`${HOME_SECTION_LABEL} pl-1.5`}>{language.t("home.overview.modeFilter")}</div>
        <For each={filters()}>
          {(filter) => (
            <button
              type="button"
              data-component="home-overview-mode-filter"
              class={MODE_FILTER_ROW}
              data-selected={props.modeFilter === filter.id ? "" : undefined}
              aria-current={props.modeFilter === filter.id ? "page" : undefined}
              onClick={() => props.onModeFilter(filter.id)}
            >
              <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{filter.label}</span>
              <span class={MODE_FILTER_COUNT}>{filter.count}</span>
            </button>
          )}
        </For>
      </div>
      <div class="h-px bg-v2-border-border-base" />
      <div class="flex min-w-0 flex-col gap-1">
        <div class={`${HOME_SECTION_LABEL} pl-1.5`}>{language.t("home.overview.projectFilter")}</div>
        <button
          type="button"
          data-component="home-overview-project-all"
          class={MODE_FILTER_ROW}
          data-selected={props.selectedDirectory === undefined ? "" : undefined}
          aria-current={props.selectedDirectory === undefined ? "page" : undefined}
          onClick={() => props.onSelectProject(undefined)}
        >
          <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{language.t("home.overview.allProjects")}</span>
          <span class={MODE_FILTER_COUNT}>{props.total}</span>
        </button>
        <For each={props.projects}>
          {(project) => (
            <HomeProjectRow
              project={project}
              server={props.server}
              selected={props.selectedDirectory === project.worktree}
              unseenCount={unseenCount(props.server, project)}
              count={props.projectCounts.get(project.worktree) ?? 0}
              selectProject={(_conn, directory) =>
                props.onSelectProject(props.selectedDirectory === directory ? undefined : directory)
              }
              openNewSession={openNewSession}
              editProject={editProject}
              closeProject={closeProject}
              clearNotifications={clearNotifications}
              language={language}
            />
          )}
        </For>
      </div>
      <div class="mt-1 flex flex-col gap-1">
        <ButtonV2
          onClick={() => chooseProject(props.server)}
          variant="neutral"
          class="w-full justify-start h-8 text-11-medium"
          icon="folder-add-left"
        >
          {language.t("home.project.add")}
        </ButtonV2>
      </div>
    </aside>
  )
}
