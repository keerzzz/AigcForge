import { Show, createEffect, createMemo, createSignal, For, onCleanup, onMount, untrack, type Accessor } from "solid-js"
import { Dynamic } from "solid-js/web"
import { createStore, produce } from "solid-js/store"
import { useParams } from "@solidjs/router"
import { getFilename } from "@aigcfroge/core/util/path"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { IconButtonV2 } from "@aigcfroge/ui/v2/icon-button-v2"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { MenuV2 } from "@aigcfroge/ui/v2/menu-v2"
import { Dialog } from "@aigcfroge/ui/v2/dialog-v2"
import { Button } from "@aigcfroge/ui/button"
import {
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  SortableProvider,
  closestCenter,
} from "@thisbeyond/solid-dnd"
import { ConstrainDragXAxis } from "@/utils/solid-dnd"
import { useLanguage } from "@/context/language"
import { useMode, type Mode } from "@/context/mode"
import { MODE_SURFACES } from "@/components/mode-surfaces"
import { useGlobal } from "@/context/global"
import { useTabs } from "@/context/tabs"
import { ServerConnection, useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { useDirectoryPicker } from "@/components/directory-picker"
import { useNotification } from "@/context/notification"
import { useDialog } from "@aigcfroge/ui/context/dialog"
import { useLayout, type LocalProject } from "@/context/layout"
import { displayName, errorMessage, homeProjectDirectories, openProjectNewSession, sortedRootSessions } from "@/pages/layout/helpers"
import { SortableWorkspace, LocalWorkspace, WorkspaceDragOverlay } from "@/pages/layout/sidebar-workspace"
import type { WorkspaceSidebarContext } from "@/pages/layout/sidebar-workspace"
import { ProjectIcon } from "@/pages/layout/sidebar-items"
import { createInlineEditorController } from "@/pages/layout/inline-editor"
import { pathKey } from "@/utils/path-key"
import { Persist, persisted } from "@/utils/persist"
import { showToast } from "@/utils/toast"
import { formatServerError } from "@/utils/server-errors"
import { toasterV2 } from "@aigcfroge/ui/v2/toast-v2"
import { clearWorkspaceTerminals } from "@/context/terminal"
import { Worktree as WorktreeState } from "@/utils/worktree"
import type { Session } from "@aigcfroge/sdk/v2/client"

// Auto-sync decision logic lives in ./secondary-sidebar-autosync (pure function,
// testable in isolation). The effect below only wires it into Solid's reactivity
// (currentDir → store updates via untrack).
import { computeAutoSync } from "./secondary-sidebar-autosync"

function SecondarySidebar() {
  const language = useLanguage()
  const mode = useMode()
  const global = useGlobal()
  const tabs = useTabs()
  const server = useServer()
  const params = useParams()
  const sync = useServerSync()
  const dialog = useDialog()
  const pickDirectory = useDirectoryPicker()

  const [state, setState] = createStore({
    search: "",
    searchOpen: false,
  })

  const [expanded, setExpanded] = persisted(
    Persist.global("sidebar.secondary.workspaceExpanded"),
    createStore({} as Record<string, boolean>),
  )

  const [collapsed, setCollapsed] = persisted(
    Persist.global("sidebar.secondary.projectCollapsed"),
    createStore({} as Record<string, boolean>),
  )

  const conn = createMemo(() => server.current)
  const serverKey = createMemo(() => {
    const c = conn()
    if (!c) return undefined
    return ServerConnection.key(c)
  })
  const ctx = createMemo(() => {
    const c = conn()
    if (!c) return undefined
    return global.ensureServerCtx(c)
  })
  const projects = createMemo(() => ctx()?.projects.list() ?? [])
  const currentDir = createMemo(() => {
    const key = serverKey()
    if (key && params.id) return global.sessionPlacement.get(key, params.id)?.directory ?? params.dir ?? ""
    return params.dir ?? ""
  })

  // When navigating to a session (via the current-directory signal), auto-expand
  // the project (and workspace) that contains it, and collapse other projects.
  // This ensures the secondary sidebar always shows the conversation list of the
  // project the user is currently viewing, without requiring a manual click.
  //
  // `untrack` is essential: without it, reading `collapsed`/`expanded` here would
  // subscribe this effect to those stores, so a user's manual toggle would re-run
  // this effect and immediately overwrite their choice (collapse forced back to
  // false for the active project, true for others) — making the toggle appear dead.
  // untrack keeps the effect driven only by navigation (currentDir / project list).
  createEffect(() => {
    const dir = currentDir()
    if (!dir) return
    const list = ctx()?.projects.list() ?? []
    if (list.length === 0) return

    untrack(() => {
      for (const { worktree, collapsed: wantCollapsed, expandWorktree } of computeAutoSync(dir, list)) {
        if (collapsed[worktree] !== wantCollapsed) setCollapsed(worktree, wantCollapsed)
        if (expandWorktree !== undefined && expanded[expandWorktree] !== true) setExpanded(expandWorktree, true)
      }
    })
  })

  const searchQuery = createMemo(() => state.search.trim().toLowerCase())
  const searchResults = createMemo(() => {
    const query = searchQuery()
    if (!query) return []
    return projects().filter((p) => displayName(p).toLowerCase().includes(query))
  })

  function closeSearch() {
    setState("search", "")
    setState("searchOpen", false)
  }

  function newSessionInProject(project: LocalProject) {
    const c = conn()
    if (!c) return
    const ctxInst = global.ensureServerCtx(c)
    openProjectNewSession(ctxInst.projects, (s, d) => tabs.newDraft({ server: s, directory: d, mode: mode.currentMode }), ServerConnection.key(c), project.worktree)
  }

  function openProjectNewSessionFn(c: ServerConnection.Any, directory: string) {
    const ctxInst = global.ensureServerCtx(c)
    openProjectNewSession(ctxInst.projects, (s, d) => tabs.newDraft({ server: s, directory: d, mode: mode.currentMode }), ServerConnection.key(c), directory)
  }

  function addProject() {
    const c = conn()
    if (!c) return
    pickDirectory({
      server: c,
      title: language.t("command.project.open"),
      multiple: true,
      onSelect: (result) => {
        const dirs = homeProjectDirectories(result)
        const directory = dirs[0]
        if (!directory) return
        const ctxInst = global.ensureServerCtx(c)
        dirs.forEach((d) => ctxInst.projects.open(d))
        ctxInst.projects.touch(directory)
      },
    })
  }

  const [sortNow, setSortNow] = createSignal(Date.now())
  let sortNowInterval: ReturnType<typeof setInterval> | undefined
  const sortNowTimeout = setTimeout(() => {
    setSortNow(Date.now())
    sortNowInterval = setInterval(() => setSortNow(Date.now()), 60_000)
  }, 60_000)
  onCleanup(() => {
    clearTimeout(sortNowTimeout)
    if (sortNowInterval) clearInterval(sortNowInterval)
  })

  const navList = createMemo(() => {
    return projects().flatMap((p) => {
      const dirs = [p.worktree, ...(p.sandboxes ?? [])]
      return dirs.flatMap((d) => {
        const [store] = sync().child(d, { bootstrap: false })
        return sortedRootSessions(store, sortNow())
      })
    })
  })

  const [workspaceNameStore, setWorkspaceNameStore] = persisted(
    Persist.global("sidebar.secondary.workspaceName"),
    createStore({} as Record<string, string>),
  )

  function workspaceName(directory: string, _projectId?: string, branch?: string) {
    const key = pathKey(directory)
    return workspaceNameStore[key] ?? workspaceNameStore[directory] ?? branch ?? undefined
  }

  function renameWorkspace(directory: string, next: string, _projectId?: string, _branch?: string) {
    const key = pathKey(directory)
    setWorkspaceNameStore(key, next)
  }

  const createWorkspace = async (project: LocalProject) => {
    const result = await serverSDK()
      .client.worktree.create({ directory: project.worktree })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("workspace.create.failed.title"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
        return undefined
      })
    if (!result?.directory) return
    const branchName = result.branch ?? getFilename(result.directory)
    setWorkspaceNameStore(pathKey(result.directory), branchName)
    WorktreeState.pending(serverSDK().scope, result.directory)
    setExpanded(pathKey(result.directory), true)
    sync().set(
      "project",
      produce((draft) => {
        const target = draft.find((p) => p.worktree === project.worktree)
        if (!target) return
        const sandboxes = new Set(target.sandboxes ?? [])
        sandboxes.add(result.directory)
        target.sandboxes = [...sandboxes]
      }),
    )
    sync().child(result.directory)
  }

  const inlineEditor = createInlineEditorController()

  const serverSDK = useServerSDK()
  const [busy, setBusy] = createStore({} as Record<string, boolean>)

  function isBusy(directory: string) {
    return busy[pathKey(directory)] ?? false
  }

  function setBusyState(directory: string, value: boolean) {
    setBusy(pathKey(directory), value)
  }

  const deleteWorkspace = async (root: string, directory: string) => {
    if (directory === root) return
    setBusyState(directory, true)
    const result = await serverSDK()
      .client.worktree.remove({ directory: root, worktreeRemoveInput: { directory } })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("workspace.delete.failed.title"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
        return false
      })
    setBusyState(directory, false)
    if (!result) return
    sync().set(
      "project",
      produce((draft) => {
        const project = draft.find((item) => item.worktree === root)
        if (!project) return
        project.sandboxes = (project.sandboxes ?? []).filter((sandbox) => sandbox !== directory)
      }),
    )
    const connInst = conn()
    if (!connInst) return
    global.ensureServerCtx(connInst).projects.close(directory)
    global.ensureServerCtx(connInst).projects.open(root)
  }

  const resetWorkspace = async (root: string, directory: string) => {
    if (directory === root) return
    setBusyState(directory, true)
    const progress = showToast({
      persistent: true,
      title: language.t("workspace.resetting.title"),
      description: language.t("workspace.resetting.description"),
    })
    const dismiss = () => toasterV2.dismiss(progress)
    const sessions: Session[] = await serverSDK()
      .client.session.list({ directory })
      .then((x) => x.data ?? [])
      .catch(() => [])
    clearWorkspaceTerminals(
      directory,
      sessions.map((s) => s.id),
      undefined,
      serverSDK().scope,
    )
    await serverSDK()
      .client.instance.dispose({ directory })
      .catch(() => undefined)
    const result = await serverSDK()
      .client.worktree.reset({ directory: root, worktreeResetInput: { directory } })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("workspace.reset.failed.title"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
        return false
      })
    if (!result) {
      setBusyState(directory, false)
      dismiss()
      return
    }
    const archivedAt = Date.now()
    await Promise.all(
      sessions
        .filter((session) => session.time.archived === undefined)
        .map((session) =>
          serverSDK()
            .client.session.update({
              sessionID: session.id,
              directory: session.directory,
              time: { archived: archivedAt },
            })
            .catch(() => undefined),
        ),
    )
    setBusyState(directory, false)
    dismiss()
    showToast({
      title: language.t("workspace.reset.success.title"),
      description: language.t("workspace.reset.success.description"),
      actions: [
        {
          label: language.t("command.session.new"),
          onClick: () => {
            const c = conn()
            if (c) openProjectNewSessionFn(c, directory)
          },
        },
        {
          label: language.t("common.dismiss"),
          onClick: "dismiss",
        },
      ],
    })
  }

  function DialogDeleteWorkspace(props: { root: string; directory: string }) {
    const name = createMemo(() => getFilename(props.directory))
    const [data, setData] = createStore({
      status: "loading" as "loading" | "ready" | "error",
      dirty: false,
    })
    onMount(() => {
      serverSDK()
        .client.vcs.status({ directory: props.directory })
        .then((x) => {
          const files = x.data ?? []
          setData({ status: "ready", dirty: files.length > 0 })
        })
        .catch(() => setData({ status: "error", dirty: false }))
    })
    const handleDelete = () => {
      dialog.close()
      void deleteWorkspace(props.root, props.directory)
    }
    const description = () => {
      if (data.status === "loading") return language.t("workspace.status.checking")
      if (data.status === "error") return language.t("workspace.status.error")
      if (!data.dirty) return language.t("workspace.status.clean")
      return language.t("workspace.status.dirty")
    }
    return (
      <Dialog title={language.t("workspace.delete.title")} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-text-strong">
              {language.t("workspace.delete.confirm", { name: name() })}
            </span>
            <span class="text-12-regular text-text-weak">{description()}</span>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" disabled={data.status === "loading"} onClick={handleDelete}>
              {language.t("workspace.delete.button")}
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  function DialogResetWorkspace(props: { root: string; directory: string }) {
    const name = createMemo(() => getFilename(props.directory))
    const [state, setState] = createStore({
      status: "loading" as "loading" | "ready" | "error",
      dirty: false,
      sessions: [] as Session[],
    })
    const refresh = async () => {
      const sessions = await serverSDK()
        .client.session.list({ directory: props.directory })
        .then((x) => x.data ?? [])
        .catch(() => [])
      setState("sessions", sessions.filter((session) => session.time.archived === undefined))
    }
    onMount(() => {
      serverSDK()
        .client.vcs.status({ directory: props.directory })
        .then((x) => {
          const files = x.data ?? []
          setState({ status: "ready", dirty: files.length > 0 })
          void refresh()
        })
        .catch(() => setState({ status: "error", dirty: false }))
    })
    const handleReset = () => {
      dialog.close()
      void resetWorkspace(props.root, props.directory)
    }
    const archivedCount = () => state.sessions.length
    const description = () => {
      if (state.status === "loading") return language.t("workspace.status.checking")
      if (state.status === "error") return language.t("workspace.status.error")
      if (!state.dirty) return language.t("workspace.status.clean")
      return language.t("workspace.status.dirty")
    }
    const archivedLabel = () => {
      const count = archivedCount()
      if (count === 0) return language.t("workspace.reset.archived.none")
      if (count === 1) return language.t("workspace.reset.archived.one")
      return language.t("workspace.reset.archived.many", { count })
    }
    return (
      <Dialog title={language.t("workspace.reset.title")} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-text-strong">
              {language.t("workspace.reset.confirm", { name: name() })}
            </span>
            <span class="text-12-regular text-text-weak">{description()}</span>
            <span class="text-12-regular text-text-weak">{archivedLabel()}</span>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" disabled={state.status === "loading"} onClick={handleReset}>
              {language.t("workspace.reset.button")}
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  const sidebarCtx: WorkspaceSidebarContext = {
    currentDir,
    navList,
    sidebarExpanded: () => true,
    sidebarHovering: () => true,
    clearHoverProjectSoon: () => {},
    prefetchSession: () => {},
    archiveSession: async (session) => {
      const [, setStore] = sync().child(session.directory, { bootstrap: false })
      const archivedAt = Date.now()
      const result = await serverSDK()
        .client.session.update({
          directory: session.directory,
          sessionID: session.id,
          time: { archived: archivedAt },
        })
        .catch((error) => {
          showToast({
            title: language.t("common.requestFailed"),
            description: formatServerError(error, language.t),
          })
          return undefined
        })
      if (!result) return
      setStore(
        produce((draft) => {
          const idx = draft.session.findIndex((s: Session) => s.id === session.id)
          if (idx !== -1) draft.session.splice(idx, 1)
        }),
      )
      if (session.id === params.id) {
        const tabIdx = tabs.store.findIndex(
          (t) => t.type === "session" && t.sessionId === session.id,
        )
        if (tabIdx !== -1) tabs.removeTab(tabIdx)
      }
    },
    workspaceName,
    renameWorkspace,
    editorOpen: inlineEditor.editorOpen,
    openEditor: inlineEditor.openEditor,
    closeEditor: inlineEditor.closeEditor,
    setEditor: inlineEditor.setEditor,
    InlineEditor: inlineEditor.InlineEditor,
    isBusy,
    workspaceExpanded: (directory, local) => {
      return expanded[directory] ?? local
    },
    setWorkspaceExpanded: (directory, value) => {
      setExpanded(directory, value)
    },
    showResetWorkspaceDialog: (root, directory) =>
      dialog.show(() => <DialogResetWorkspace root={root} directory={directory} />),
    showDeleteWorkspaceDialog: (root, directory) =>
      dialog.show(() => <DialogDeleteWorkspace root={root} directory={directory} />),
    setScrollContainerRef: () => {},
  }

  return (
    <aside
      role="complementary"
      aria-label={language.t("sidebar.secondary.projectList")}
      class="flex w-64 shrink-0 flex-col border-r border-v2-border-border-base bg-v2-background-bg-base"
    >
      <div class="flex items-center justify-between gap-1 px-3 pt-3 pb-2">
        <ButtonV2
          variant="neutral"
          size="normal"
          icon="edit"
          class="flex-1"
          onClick={() => {
            const c = conn()
            if (!c) return
            // Prefer the active session's directory, then the last session's
            // directory (persisted), so "new session" continues where the user
            // last worked instead of always landing on the first project.
            const scope = ctx()?.sdk.scope
            const dir = currentDir() || (scope ? global.lastSession.directory(scope) : undefined)
            if (dir) {
              openProjectNewSessionFn(c, dir)
              return
            }
            const project = projects()[0]
            if (project) newSessionInProject(project)
          }}
        >
          {language.t("sidebar.secondary.newSession")}
        </ButtonV2>
        <IconButtonV2
          variant="ghost-muted"
          size="normal"
          icon={<Icon name="magnifying-glass" />}
          aria-label={language.t("sidebar.secondary.search")}
          aria-expanded={state.searchOpen}
          onClick={() => {
            if (state.searchOpen) {
              closeSearch()
              return
            }
            setState("searchOpen", true)
          }}
        />
      </div>

      <Show when={state.searchOpen}>
        <div class="flex flex-col gap-2 px-3 pb-2">
          <div class="flex items-center gap-2 rounded-[6px] bg-v2-background-bg-layer-03 px-2 py-1.5">
            <Icon name="magnifying-glass" size="small" class="shrink-0 text-v2-icon-icon-muted" />
            <input
              class="min-w-0 flex-1 border-0 bg-transparent text-v2-text-text-base outline-0 [font-weight:440] placeholder:text-v2-text-text-faint"
              placeholder={language.t("sidebar.secondary.search")}
              value={state.search}
              aria-label={language.t("sidebar.secondary.search")}
              role="searchbox"
              onInput={(e) => setState("search", e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") closeSearch()
              }}
            />
            <Show when={state.search}>
              <IconButtonV2
                variant="ghost-muted"
                size="small"
                icon={<Icon name="close" size="large" />}
                aria-label={language.t("sidebar.secondary.search")}
                onClick={closeSearch}
              />
            </Show>
          </div>
          <Show when={searchQuery()}>
            <div role="listbox" class="flex max-h-48 flex-col gap-px overflow-y-auto">
              <Show
                when={searchResults().length > 0}
                fallback={
                  <p class="px-1 py-2 text-[13px] text-v2-text-text-muted [font-weight:440]">
                    {language.t("sidebar.secondary.noResults")}
                  </p>
                }
              >
                <For each={searchResults()}>
                  {(project) => (
                    <button
                      type="button"
                      role="option"
                      class="flex cursor-default items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none"
                      onClick={() => {
                        closeSearch()
                        const c = conn()
                        if (c) openProjectNewSessionFn(c, project.worktree)
                      }}
                    >
                      {displayName(project)}
                    </button>
                  )}
                </For>
              </Show>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={mode.currentMode === "coding"}>
        <div class="flex items-center justify-between px-3 pt-1 pb-1">
          <span class="text-v2-text-text-muted [font-weight:440]">{language.t("sidebar.secondary.projectList")}</span>
          <IconButtonV2
            variant="ghost-muted"
            size="small"
            icon={<Icon name="folder-add-left" />}
            aria-label={language.t("sidebar.secondary.addProject")}
            onClick={addProject}
          />
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto px-2">
          <For each={projects()}>
            {(project) => (
              <SecondaryProjectRow
                project={project}
                ctx={sidebarCtx}
                sortNow={sortNow}
                serverKey={serverKey()}
                currentDir={currentDir}
                collapsed={collapsed[project.worktree] ?? false}
                onToggleCollapse={() => setCollapsed(project.worktree, !(collapsed[project.worktree] ?? false))}
                onCreateWorkspace={() => createWorkspace(project)}
                currentMode={mode.currentMode}
              />
            )}
          </For>
        </div>
      </Show>
      <Show when={mode.currentMode !== "coding"}>
        <Dynamic component={MODE_SURFACES[mode.currentMode]?.Sidebar ?? MODE_SURFACES.chat.Sidebar} />
      </Show>
    </aside>
  )
}

function SecondaryProjectRow(props: {
  project: LocalProject
  ctx: WorkspaceSidebarContext
  sortNow: Accessor<number>
  onCreateWorkspace: () => void
  serverKey?: ServerConnection.Key
  currentDir: Accessor<string>
  collapsed: boolean
  onToggleCollapse: () => void
  currentMode: Mode
}) {
  const language = useLanguage()
  const global = useGlobal()
  const server = useServer()
  const layout = useLayout()
  const notification = useNotification()
  const dialog = useDialog()
  const tabs = useTabs()

  const conn = createMemo(() => server.current)

  const workspaces = createMemo(() => {
    const dirs = [props.project.worktree, ...(props.project.sandboxes ?? [])]
    return dirs
  })

  const workspaceEnabled = createMemo(() => {
    return props.project.vcs === "git" && layout.sidebar.workspaces(props.project.worktree)()
  })

  const sortableIds = createMemo(() =>
    workspaces().map((d) => pathKey(d)),
  )

  const [menu, setMenu] = createStore({ open: false })

  const unseen = createMemo(() => {
    if (!conn()) return 0
    const dirs = [props.project.worktree, ...(props.project.sandboxes ?? [])]
    return dirs.reduce((total, d) => total + notification.project.unseenCount(d), 0)
  })

  const isActiveProject = createMemo(() => {
    const directory = props.currentDir()
    if (!directory) return false
    return workspaces().some((d) => pathKey(d) === pathKey(directory))
  })

  function navigateToNewSession() {
    const c = conn()
    if (!c) return
    const cctx = global.ensureServerCtx(c)
    openProjectNewSession(cctx.projects, (s, d) => tabs.newDraft({ server: s, directory: d, mode: props.currentMode }), ServerConnection.key(c), props.project.worktree)
  }

  function newSessionInDir(directory: string) {
    return () => {
      const c = conn()
      if (!c) return
      const cctx = global.ensureServerCtx(c)
      props.ctx.setWorkspaceExpanded(directory, true)
      openProjectNewSession(cctx.projects, (s, d) => tabs.newDraft({ server: s, directory: d, mode: props.currentMode }), ServerConnection.key(c), directory)
    }
  }

  function editProject() {
    const c = conn()
    if (!c) return
    void import("@/components/dialog-edit-project").then((x) => {
      void dialog.show(() => <x.DialogEditProject server={c} project={props.project} />)
    })
  }

  function clearNotifications() {
    if (!conn()) return
    const dirs = [props.project.worktree, ...(props.project.sandboxes ?? [])]
    dirs
      .filter((d) => notification.project.unseenCount(d) > 0)
      .forEach((d) => notification.project.markViewed(d))
  }

  function closeProject() {
    const c = conn()
    if (!c) return
    const cctx = global.ensureServerCtx(c)
    cctx.projects.close(props.project.worktree)
  }

  function toggleWorkspaces() {
    const enabled = layout.sidebar.workspaces(props.project.worktree)()
    if (enabled) {
      layout.sidebar.toggleWorkspaces(props.project.worktree)
      return
    }
    if (props.project.vcs !== "git") return
    layout.sidebar.toggleWorkspaces(props.project.worktree)
  }

  return (
    <div class="flex min-w-0 flex-col">
      <div
        class="group/project relative flex h-7 min-w-0 cursor-default items-center rounded-[6px]"
        classList={{
          "bg-v2-overlay-simple-overlay-hover": isActiveProject(),
        }}
      >
        <button
          type="button"
          aria-expanded={!props.collapsed}
          class="flex h-full min-w-0 flex-1 cursor-default items-center rounded-[6px] border-0 bg-transparent p-0 pr-14 text-left hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus"
          onClick={() => {
            if (menu.open) return
            props.onToggleCollapse()
          }}
        >
          <div
            class="flex shrink-0 items-center justify-center px-1 transition-transform duration-150"
            classList={{
              "-rotate-90": props.collapsed,
            }}
          >
            <Icon name="chevron-down" size="small" class="text-v2-icon-icon-muted" />
          </div>
          <ProjectIcon project={props.project} class="size-5! rounded!" />
          <div class="flex min-w-0 flex-1 items-center gap-1.5">
            <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-v2-text-text-base [font-weight:530]">
              {displayName(props.project)}
            </span>
            <Show when={unseen() > 0}>
              <span class="size-1.5 shrink-0 rounded-full bg-v2-icon-icon-interactive-base" />
            </Show>
          </div>
        </button>
        <div
          class="pointer-events-none absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover/project:pointer-events-auto group-hover/project:opacity-100 group-focus-within/project:pointer-events-auto group-focus-within/project:opacity-100 data-[menu=true]:pointer-events-auto data-[menu=true]:opacity-100"
          data-menu={menu.open}
          data-stop="project-collapse"
        >
          <IconButtonV2
            variant="ghost-muted"
            size="small"
            icon={<Icon name="edit" />}
            aria-label={language.t("command.session.new")}
            onClick={navigateToNewSession}
          />
          <MenuV2
            gutter={4}
            modal={false}
            placement="bottom-end"
            open={menu.open}
            onOpenChange={(open) => setMenu("open", open)}
          >
            <MenuV2.Trigger
              as={IconButtonV2}
              variant="ghost-muted"
              size="small"
              icon={<Icon name="outline-dots" />}
              aria-label={language.t("common.moreOptions")}
            />
            <MenuV2.Portal>
              <MenuV2.Content>
                <MenuV2.Item onSelect={navigateToNewSession}>
                  {language.t("command.session.new")}
                </MenuV2.Item>
                <MenuV2.Item onSelect={editProject}>{language.t("common.edit")}</MenuV2.Item>
                <MenuV2.Item disabled={unseen() === 0} onSelect={clearNotifications}>
                  {language.t("sidebar.project.clearNotifications")}
                </MenuV2.Item>
                <MenuV2.Item disabled={props.project.vcs !== "git"} onSelect={toggleWorkspaces}>
                  {language.t(
                    workspaceEnabled() ? "sidebar.workspaces.disable" : "sidebar.workspaces.enable",
                  )}
                </MenuV2.Item>
                <MenuV2.Separator />
                <MenuV2.Item onSelect={closeProject}>{language.t("common.close")}</MenuV2.Item>
              </MenuV2.Content>
            </MenuV2.Portal>
          </MenuV2>
        </div>
      </div>

      <Show when={!props.collapsed}>
        <Show
          when={workspaceEnabled()}
          fallback={
            <div class="pl-2">
              <LocalWorkspace ctx={props.ctx} project={props.project} sortNow={props.sortNow} serverKey={props.serverKey} />
            </div>
          }
        >
          <div class="shrink-0 px-2 py-3">
            <ButtonV2
              variant="neutral"
              size="normal"
              icon="plus"
              class="w-full"
              onClick={() => {
                props.onCreateWorkspace()
              }}
            >
              {language.t("workspace.new")}
            </ButtonV2>
          </div>
          <div class="relative">
            <DragDropProvider
              onDragStart={() => {}}
              onDragEnd={() => {}}
              collisionDetector={closestCenter}
            >
              <DragDropSensors />
              <ConstrainDragXAxis />
              <div class="flex flex-col gap-4 overflow-y-auto py-2">
                <SortableProvider ids={sortableIds()}>
                  <For each={workspaces()}>
                    {(dir) => (
                      <SortableWorkspace
                        ctx={props.ctx}
                        directory={dir}
                        project={props.project}
                        sortNow={props.sortNow}
                        serverKey={props.serverKey}
                        navigateToNewSession={newSessionInDir(dir)}
                      />
                    )}
                  </For>
                </SortableProvider>
              </div>
              <DragOverlay>
                <WorkspaceDragOverlay
                  sidebarProject={() => props.project}
                  activeWorkspace={() => undefined}
                  workspaceLabel={(d) => {
                    return props.ctx.workspaceName(d, props.project.id) ?? getFilename(d)
                  }}
                />
              </DragOverlay>
            </DragDropProvider>
          </div>
        </Show>
      </Show>
    </div>
  )
}

export { SecondarySidebar }
