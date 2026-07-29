import { batch, createEffect, createMemo, createRoot, createSignal, For, onCleanup, Show, startTransition } from "solid-js"
import { createStore } from "solid-js/store"
import { useChatFeature } from "@/context/chat-feature"
import { useDialog } from "@aigcfroge/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useGlobal } from "@/context/global"
import { useTabs } from "@/context/tabs"
import { useServer, ServerConnection } from "@/context/server"
import { useChatDirectory } from "@/pages/mode-workspace-context"
import { useModeWorkspaceAssets } from "@/pages/mode-workspace-context"
import { AssetWorkbench } from "@/components/chat/asset-workbench"
import { AssetSessionSelector } from "@/components/chat/asset-session-selector"
import { ChatImportDialog, serializeImport, wrapImportContent } from "@/components/chat/chat-import-dialog"
import { AssetDeleteDialog } from "@/components/chat/asset-delete-dialog"
import { modeDraft, useMode } from "@/context/mode"
import { openProjectNewSession, projectForSession, sortedRootSessions, displayName, type HomeProjectSelection } from "@/pages/layout/helpers"
import { useServerSync, type ServerSync } from "@/context/server-sync"
import { useLayout, type LocalProject } from "@/context/layout"
import { useQuery } from "@tanstack/solid-query"
import { ScrollView } from "@aigcfroge/ui/scroll-view"
import { pathKey } from "@/utils/path-key"
import { useNavigate } from "@solidjs/router"
import { sessionTitle } from "@/utils/session-title"
import { SessionTabAvatar } from "@/pages/layout/session-tab-avatar"
import { Spinner } from "@aigcfroge/ui/spinner"
import {
  HOME_SESSION_LIMIT, HOME_ROW, HOME_SESSION_SEARCH_RESULTS_ID, HOME_SEARCH_RESULT_ROW,
  HOME_SEARCH_RESULT_TITLE, HOME_SEARCH_RESULT_META, HOME_SECTION_LABEL,
  HomeSessionSearch, HomeSessionRow, HomeSessionGroupHeader, HomeSessionSkeleton,
  HomeSessionRecord, HomeSessionGroup, buildHomeSessionRecords, groupSessions,
} from "@/pages/home"
import { useNotification } from "@/context/notification"
import { useMarked } from "@aigcfroge/ui/context/marked"
import { preloadMarkdown } from "@aigcfroge/session-ui/markdown-cache"
import { makeEventListener } from "@solid-primitives/event-listener"
import { DateTime } from "luxon"

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
    if (!conn) return undefined
    return global.ensureServerCtx(conn)
  })
  const focusedSync = () => focusedServerCtx()?.sync ?? sync()
  const projects = createMemo(() => focusedServerCtx()?.projects.list() ?? layout.projects.list())
  const projectByID = createMemo(
    () => new Map(projects().flatMap((project) => (project.id ? [[project.id, project] as const] : []))),
  )
  const projectDirectories = createMemo(() =>
    projects().flatMap((p) => [p.worktree, ...(p.sandboxes ?? [])]),
  )

  const search = createMemo(() => state.search.trim())

  // queryKey 已去 mode.currentMode（ADR-15 Step 7）
  const sessionLoad = useQuery(() => ({
    queryKey: ["home", "sessions", state.selection.server, ...projectDirectories()] as const,
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
      .filter((record) => record.session.title?.toLowerCase().includes(query) ?? false)
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

  function openNewSession() {
    const conn = focusedServer()
    if (!conn) return
    const directory = projects().find((p) => p.worktree)?.worktree
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
        server={state.selection.server}
        activeServer={state.selection.server === server.key}
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
