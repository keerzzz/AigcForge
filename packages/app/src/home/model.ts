import { useGlobal, useServerCtx } from "@/runtime/server/runtime"
import { type HomeProjectSelection, useLayout } from "@/shell/state/layout"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useTabs } from "@/shell/tabs/tabs"
import { resolveNewSessionProject, toggleHomeProjectSelection } from "@/shell/layout/helpers"
import { createEffect, createMemo, on, startTransition, type Accessor } from "solid-js"
import type { SessionInfo } from "@aigcfroge/client/promise"
import { pathKey } from "@/workspaces/path-key"
import { addProjects } from "./projects/add"
import { ProductMode } from "@aigcfroge/schema/product-mode"
import { useNavigate } from "@solidjs/router"
import { ModeRoute } from "@/shell/routes/mode"
import { useLanguage } from "@/runtime/i18n/language"
import { showToast } from "@/shell/notifications/toast"

export function createHomeController(input: { mode?: Accessor<ProductMode.ID | undefined> } = {}) {
  const layout = useLayout()
  const global = useGlobal()
  const servers = useServers()
  const tabs = useTabs()
  const selection = layout.home.selection
  const navigate = useNavigate()
  const language = useLanguage()

  const currentMode = createMemo(() => {
    if (input.mode) return input.mode()

    const route = layout.route()

    return route.type === "mode" ? route.mode : layout.home.mode()
  })

  const focusedServer = createMemo<ServerConnection.Any | undefined>(
    () => servers.visible.find((conn) => ServerConnection.key(conn) === selection().server) ?? servers.visible[0],
  )

  const focusedServerCtx = useServerCtx(focusedServer)
  const focusedSync = () => focusedServerCtx()?.sync
  const projects = createMemo(() => focusedServerCtx()?.projects.list() ?? [])
  const recentlyClosed = createMemo(() => focusedServerCtx()?.projects.recentlyClosed() ?? [])
  const homedir = createMemo(() => focusedSync()?.data.path.home ?? "")
  const selectedProject = createMemo(() => projects().find((project) => project.worktree === selection().directory))

  const newSessionProject = createMemo(() =>
    resolveNewSessionProject(projects(), selection().directory, focusedServerCtx()?.projects.last()),
  )

  createEffect(
    on(
      [focusedServerCtx, () => newSessionProject()?.worktree, () => focusedServerCtx()?.sdk.connection.status()],
      ([ctx, directory, status]) => {
        if (!ctx || !directory || status !== "connected") return
        void ctx.data.location.vcs.sync({ directory }).catch(() => undefined)
      },
    ),
  )

  createEffect(() => {
    const list = servers.visible

    if (list.some((conn) => ServerConnection.key(conn) === selection().server)) return
    const conn = list[0]

    if (conn) setSelection({ server: ServerConnection.key(conn) })
  })
  createEffect(() => {
    const ctx = focusedServerCtx()
    const id = selectedProject()?.id

    if (!ctx || !id || ctx.sdk.connection.status() !== "connected") return
    // Selecting a project is the demand for its worktree inventory: the session filter spans its worktrees.
    void ctx.sync.worktrees.list(id).then(() => ctx.sync.worktrees.refresh(id))
  })
  createEffect(() => {
    // The project list is empty until the server store hydrates; clearing the restored
    // selection against it would persist the loss.
    if (!servers.hydrated()) return
    const current = selection()
    const directory = current.directory

    if (!directory) return
    const conn = servers.visible.find((conn) => ServerConnection.key(conn) === current.server)

    if (!conn) return

    if (
      global
        .ensureServerCtx(conn)
        .projects.list()
        .some((project) => pathKey(project.worktree) === pathKey(directory))
    )
      return
    setSelection({ server: current.server })
  })

  function setSelection(next: HomeProjectSelection) {
    layout.home.setSelection(next)
  }

  function openProjectNewSession(conn: ServerConnection.Any, directory: string) {
    const mode = currentMode()

    if (mode === undefined) return

    if (mode === "custom") {
      setSelection({ server: ServerConnection.key(conn), directory })
      navigate(ModeRoute.href(mode))

      return
    }

    if (!ProductMode.isGenericSessionMode(mode)) {
      showToast({ description: language.t("mode.navigation.customCreation") })

      return
    }

    const ctx = global.ensureServerCtx(conn)
    ctx.projects.open(directory)
    ctx.projects.touch(directory)
    void tabs.newDraft({ server: ServerConnection.key(conn), directory, mode })
  }

  function openProjectSession(conn: ServerConnection.Any, directory: string, session: SessionInfo) {
    const ctx = global.ensureServerCtx(conn)
    void ctx.data.session.message.sync(session.id).catch(() => undefined)
    void startTransition(() => {
      const tab = tabs.addSessionTab({ server: ServerConnection.key(conn), sessionId: session.id })
      tabs.select(tab)
      ctx.data.session.remember(session)
      ctx.projects.open(directory)
      ctx.projects.touch(directory)
    })
  }

  return {
    mode: {
      workspace: createMemo(() => {
        const route = layout.route()

        return route.type === "mode" ? route.mode : undefined
      }),
      current: currentMode,
      select: (mode: ProductMode.ID | undefined) => {
        if (layout.route().type === "mode") {
          if (mode === undefined) layout.home.setMode(undefined)

          navigate(mode ? ModeRoute.href(mode) : "/")

          return
        }

        layout.home.setMode(mode)
      },
    },
    selection: {
      value: selection,
      set: setSelection,
      focusServer: (conn: ServerConnection.Any) => setSelection({ server: ServerConnection.key(conn) }),
    },
    server: {
      list: () => servers.visible,
      health: (conn: ServerConnection.Any) => global.servers.health[ServerConnection.key(conn)],
      context: (conn: ServerConnection.Any) => global.ensureServerCtx(conn),
      focused: focusedServer,
      focusedContext: focusedServerCtx,
      focusedSync,
    },
    project: {
      list: projects,
      recentlyClosed,
      homedir,
      selected: selectedProject,
      newSession: newSessionProject,
      forServer: (conn: ServerConnection.Any) => global.ensureServerCtx(conn).projects.list(),
      select: (conn: ServerConnection.Any, directory: string) => {
        const key = ServerConnection.key(conn)

        if (global.servers.health[key]?.healthy === false) return

        if (
          !global
            .ensureServerCtx(conn)
            .projects.list()
            .some((project) => project.worktree === directory)
        )
          return
        setSelection(toggleHomeProjectSelection(selection(), key, directory))
      },
      add: (conn: ServerConnection.Any, directories: string[]) => {
        const directory = addProjects(global.ensureServerCtx(conn), directories)

        if (!directory) return
        setSelection({ server: ServerConnection.key(conn), directory })
      },
      openNewSession: () => {
        const conn = focusedServer()
        const route = layout.route()
        const custom = currentMode() === "custom"
        const project = custom && route.type === "mode" ? selectedProject() : newSessionProject()

        if (!conn) return

        if (!project) {
          if (custom) showToast({ description: language.t("home.custom.project.required") })

          return
        }

        openProjectNewSession(conn, project.worktree)
      },
      openProjectNewSession,
      openProjectSession,
    },
  }
}

export type HomeController = ReturnType<typeof createHomeController>
