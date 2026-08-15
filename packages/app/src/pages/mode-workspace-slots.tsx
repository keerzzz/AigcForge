import { createEffect, createMemo, createResource, createRoot, createSignal, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useChatFeature } from "@/context/chat-feature"
import { useDialog } from "@aigcfroge/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useGlobal } from "@/context/global"
import { useTabs } from "@/context/tabs"
import { useServer, ServerConnection } from "@/context/server"
import { type DirectorySDK } from "@/context/sdk"
import { useModeDirectory, useModeWorkspaceAssets, useCodingSelection } from "@/pages/mode-workspace-context"
import { AssetWorkbench } from "@/components/chat/asset-workbench"
import { AssetSessionSelector } from "@/components/chat/asset-session-selector"
import { ChatImportDialog, serializeImport, wrapImportContent } from "@/components/chat/chat-import-dialog"
import { AssetDeleteDialog } from "@/components/chat/asset-delete-dialog"
import { modeDraft, useMode } from "@/context/mode"
import { ProductModeAgentPolicy } from "@aigcfroge/core/product-mode-agent-policy"
import { openProjectNewSession, openSessionRecord, closeHomeProject, homeProjectDirectories, filterSessionsByMode } from "@/pages/layout/helpers"
import { useServerSync } from "@/context/server-sync"
import { useLayout, type LocalProject } from "@/context/layout"
import { useQuery } from "@tanstack/solid-query"
import { ScrollView } from "@aigcfroge/ui/scroll-view"
import { pathKey } from "@/utils/path-key"
import { useDirectoryPicker } from "@/components/directory-picker"
import { HomeProjectColumn, HOME_SESSION_LIMIT, HomeSessionSearch, HomeSessionRow, HomeSessionGroupHeader, HomeSessionSkeleton,
  buildHomeSessionRecords, groupSessions, matchesHomeSessionSearch, type HomeSessionRecord,
} from "@/pages/home"
import { useNotification } from "@/context/notification"
import { useMarked } from "@aigcfroge/ui/context/marked"
import { preloadMarkdown } from "@aigcfroge/session-ui/markdown-cache"
import { WorkPreset } from "@aigcfroge/schema/work-preset"
import type { Session, WorkflowAssetSummary } from "@aigcfroge/sdk/v2/client"
import { assetVersion } from "@/components/chat/prompt-asset-store"
import { buildWorkPresetCatalog } from "@/pages/work-preset-catalog"
import { presetLaunch, workflowLaunch } from "@/pages/work-preset-launch"
import { ModeLocationNewSession } from "@/components/mode-location-new-session"

/** Coding project and server navigation built on HomeProjectColumn. */
export function CodingProjectColumnSidebar() {
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

/** Coding Session list with project selection, search, and prefetch. */
export function CodingSessionListMain() {
  const sync = useServerSync()
  const layout = useLayout()
  const mode = useMode()
  const server = useServer()
  const language = useLanguage()
  const global = useGlobal()
  const tabs = useTabs()
  const marked = useMarked()
  const codingSel = useCodingSelection()

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

  // Keep one Session cache across mode changes; mode filtering stays in memory.
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
    return filterSessionsByMode(all, current).slice(0, HOME_SESSION_LIMIT)
  })

  const searchResults = createMemo(() => {
    const query = search().toLowerCase()
    if (!query) return []
    const current = mode.currentMode
    const all = allRecords()
    if (!all) return []
    return filterSessionsByMode(all, current).filter((record) => matchesHomeSessionSearch(record, query))
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

  function openSession(record: HomeSessionRecord) {
    const conn = focusedServer()
    if (!conn) return
    const ctx = global.ensureServerCtx(conn)
    openSessionRecord({
      record,
      server: ServerConnection.key(conn),
      global,
      tabs,
      projects: ctx.projects,
      projectByID: projectByID(),
    })
  }

  function selectSearchSession(session: Session) {
    const record = searchResults().find((item) => item.session.id === session.id)
    if (!record) return
    openSession(record)
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
                            onClick={() => openSession(record)}
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

/** Chat asset workbench main surface. */
export function ChatAssetWorkbenchMain() {
  const assets = useModeWorkspaceAssets()
  const { selected: chatFeature } = useChatFeature()
  const dialog = useDialog()
  const language = useLanguage()
  const global = useGlobal()
  const tabs = useTabs()
  const server = useServer()
  const { directory: chatDirectory } = useModeDirectory()

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
            baseRevision: row.revision ?? undefined,
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
          } catch (err) {
            const message = err instanceof Error ? err.message : undefined
            console.error("Failed to delete asset:", err)
            dialog.show(() => (
              <div class="p-4 text-v2-state-fg-danger text-13-regular">
                {message ?? language.t("promptAsset.error.deleteFailed")}
              </div>
            ))
            return false
          }
          assets?.refetchAssets()
          return true
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

/** Work location and new-session controls. */
export function WorkProjectColumnSidebar() {
  const { directory } = useModeDirectory()
  return <ModeLocationNewSession directory={directory} mode="work" />
}

/** Work home surface for recent Sessions, workflows, and presets. */
export function WorkPresetCatalogMain() {
  const language = useLanguage()
  const tabs = useTabs()
  const layout = useLayout()
  const sync = useServerSync()
  const global = useGlobal()
  const server = useServer()
  const { conn, ctx, directory } = useModeDirectory()
  const { categories } = buildWorkPresetCatalog()

  const projects = createMemo(() => ctx()?.projects.list() ?? layout.projects.list())
  const projectByID = createMemo(
    () => new Map(projects().flatMap((project) => (project.id ? [[project.id, project] as const] : []))),
  )
  const projectDirectories = createMemo(() => {
    const dir = directory()
    return dir ? [dir] : []
  })
  const sessionLoad = useQuery(() => ({
    queryKey: [ctx()?.sdk.scope, "home", "work-sessions", ...projectDirectories()] as const,
    queryFn: async () => {
      await Promise.all(
        projectDirectories().map((d) => sync().project.loadSessions(d, { limit: HOME_SESSION_LIMIT })),
      )
      return null
    },
  }))
  const workRecords = createMemo(() => {
    const records = buildHomeSessionRecords({ sync: sync(), projectDirectories, projects, projectByID })
    return filterSessionsByMode(records, "work").slice(0, HOME_SESSION_LIMIT)
  })
  const workGroups = createMemo(() => groupSessions(workRecords(), language))
  const activeConnKey = createMemo(() => {
    const c = conn()
    return c ? ServerConnection.key(c) : server.key
  })

  function openWorkSession(record: HomeSessionRecord) {
    const c = conn()
    const currentCtx = ctx()
    if (!c || !currentCtx) return
    openSessionRecord({
      record,
      server: ServerConnection.key(c),
      global,
      tabs,
      projects: currentCtx.projects,
      projectByID: projectByID(),
    })
  }

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
  const [workflowAssets] = createResource(
    () => ({ sdk: dirSdk(), version: assetVersion() }),
    async (source) => {
      if (!source.sdk) return []
      const res = await source.sdk.client.workflowAsset.list()
      return res.data?.assets ?? []
    },
  )

  function startWorkflow(asset: WorkflowAssetSummary) {
    const c = conn()
    const currentCtx = ctx()
    const dir = directory()
    const sdk = dirSdk()
    if (!c || !currentCtx || !dir || !sdk) return
    // If workflow content fails to load, the orchestrator can clarify from its metadata.
    void sdk.client.workflowAsset
      .content({ path: asset.relativePath })
      .then((res) =>
        openProjectNewSession(
          currentCtx.projects,
          (serverKey, draftDirectory) =>
            tabs.newDraft(
              { server: serverKey, directory: draftDirectory, ...modeDraft("work"), agent: ProductModeAgentPolicy.WORK_ORCHESTRATOR },
              workflowLaunch({ name: asset.name, description: asset.description, steps: res.data?.steps ?? [] }),
            ),
          ServerConnection.key(c),
          dir,
        ),
      )
      .catch((error) => {
        console.error("[work-home] workflow content load failed", error)
        openProjectNewSession(
          currentCtx.projects,
          (serverKey, draftDirectory) =>
            tabs.newDraft(
              { server: serverKey, directory: draftDirectory, ...modeDraft("work"), agent: ProductModeAgentPolicy.WORK_ORCHESTRATOR },
              workflowLaunch({ name: asset.name, description: asset.description, steps: [] }),
            ),
          ServerConnection.key(c),
          dir,
        )
      })
  }

  function startPreset(preset: WorkPreset.Preset) {
    const c = conn()
    const currentCtx = ctx()
    const dir = directory()
    if (!c || !currentCtx || !dir) return
    openProjectNewSession(
      currentCtx.projects,
      (serverKey, draftDirectory) =>
        tabs.newDraft(
          {
            server: serverKey,
            directory: draftDirectory,
            ...modeDraft("work"),
            agent: ProductModeAgentPolicy.WORK_ORCHESTRATOR,
            presetCategoryId: preset.category,
          },
          presetLaunch(preset),
        ),
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

        <Show when={!sessionLoad.isLoading && workGroups().length > 0}>
          <section class="flex min-w-0 flex-col gap-3">
            <h2 class="text-v2-text-text-base text-13-medium">{language.t("work.home.continue")}</h2>
            <div class="flex min-w-0 flex-col gap-px">
              <For each={workGroups()}>
                {(group) => (
                  <div class="flex min-w-0 flex-col gap-2">
                    <HomeSessionGroupHeader title={group.title} />
                    <For each={group.sessions}>
                      {(record) => (
                        <HomeSessionRow
                          record={record}
                          server={activeConnKey()}
                          activeServer={activeConnKey() === server.key}
                          onClick={() => openWorkSession(record)}
                        />
                      )}
                    </For>
                  </div>
                )}
              </For>
            </div>
          </section>
        </Show>

        <Show when={(workflowAssets() ?? []).length > 0}>
          <section class="flex min-w-0 flex-col gap-3">
            <h2 class="text-v2-text-text-base text-13-medium">{language.t("work.asset.title")}</h2>
            <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              <For each={workflowAssets()}>
                {(asset) => (
                  <button
                    type="button"
                    class="group flex min-w-0 flex-col gap-2 rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-02 p-4 text-left transition-colors hover:border-v2-border-border-strong hover:bg-v2-background-bg-layer-03 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus"
                    disabled={!directory()}
                    onClick={() => startWorkflow(asset)}
                  >
                    <span class="text-v2-text-text-base text-13-medium">{asset.name}</span>
                    <span class="text-v2-text-text-muted text-12-regular">{asset.description}</span>
                    <span class="text-v2-text-text-faint text-11-regular">{language.t("work.asset.guidedBadge")}</span>
                  </button>
                )}
              </For>
            </div>
          </section>
        </Show>

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
