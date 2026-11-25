import { type Accessor, createEffect, createMemo, on, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Key } from "@solid-primitives/keyed"
import { Slot } from "@omnixa/gui-extensions/sdk"
import { Spinner } from "@omnixa/ui/spinner"
import { Badge } from "@omnixa/ui/badge"
import { Button } from "@omnixa/ui/button"
import { Collapsible } from "@omnixa/ui/collapsible"
import { useI18n } from "@omnixa/ui/context/i18n"
import { Tooltip } from "@omnixa/ui/tooltip"
import { useQuery } from "@tanstack/solid-query"
import { useExtensionHost } from "@/runtime/extension/host"
import { ExtensionSlot } from "@/runtime/extension/render"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { formatServerError, sessionNotFoundError } from "@/runtime/server/errors"
import type { Notification } from "@/shell/notifications/notification"
import { createHomeController, type HomeController } from "@/home/model"
import { createHomeProjectsController } from "@/home/projects/controller"
import { HomeProjects } from "@/home/projects/region"
import { createHomeSessionsController } from "@/home/sessions/controller"
import { HomeSessionRow, type HomeSessionRowUI } from "@/home/sessions/view"
import { matchesHomeSessionMode, parseHomeSessionIndex } from "@/home/sessions/index"
import { buildHomeSessionRecords, type HomeSessionRecord } from "@/home/sessions/records"
import { ModeRoute } from "@/shell/routes/mode"
import { useLayout, type LocalProject } from "@/shell/state/layout"
import { pathKey } from "@/workspaces/path-key"

export function ProjectSidebar(props: { onNavigate?: () => void } = {}) {
  const host = useExtensionHost()

  return (
    <Show
      when={host.items(Slot).some((item) => item.value.at === "window.sidebar")}
      fallback={<BuiltinProjectSidebar onNavigate={props.onNavigate} />}
    >
      <ExtensionSlot at="window.sidebar" input={{}} />
    </Show>
  )
}

function BuiltinProjectSidebar(props: { onNavigate?: () => void }) {
  const layout = useLayout()
  const global = useGlobal()

  const mode = createMemo(() => {
    const route = layout.route()

    if (route.type !== "session") return undefined

    return ModeRoute.sourceMode(route, undefined, global.serverCtx(route.server)?.data.session.get(route.sessionId))
  })

  const home = createHomeController({ mode })
  const projects = createHomeProjectsController(home)

  const notifications = (server: ServerConnection.Any, project: LocalProject) =>
    [...new Set([project.worktree, ...(project.sandboxes ?? [])])].flatMap((directory) =>
      home.server.context(server).notification.project.unseen(directory),
    )

  const unseen = (server: ServerConnection.Any, project: LocalProject) => {
    const current = mode()

    if (current === undefined) return []
    const ctx = home.server.context(server)

    return notifications(server, project).filter((notification) => {
      const session = notification.session ? ctx.data.session.get(notification.session) : undefined

      return !!session && matchesHomeSessionMode(session, current)
    })
  }

  return (
    <HomeProjects
      projects={projects}
      docked
      unseenCount={(server, project) => unseen(server, project).length}
      onClearNotifications={(server, project) => {
        const ctx = home.server.context(server)

        new Set(
          unseen(server, project).flatMap((notification) => (notification.session ? [notification.session] : [])),
        ).forEach((id) => ctx.notification.session.markViewed(id))
      }}
      projectStatus={(server, project) => (
        <ProjectNotificationStatus
          home={home}
          server={server}
          count={unseen(server, project).length}
          notifications={notifications(server, project)}
          sessionIDs={[
            ...new Set(
              home.project
                .forServer(server)
                .flatMap((project) => notifications(server, project))
                .flatMap((notification) => (notification.session ? [notification.session] : [])),
            ),
          ].toSorted()}
        />
      )}
      onToggleProject={(server, project) => {
        const ctx = home.server.context(server)

        if (project.expanded) {
          ctx.projects.collapse(project.worktree)

          return
        }

        ctx.projects.expand(project.worktree)
      }}
      projectChildren={(server, project) => (
        <ProjectSessions home={home} server={server} project={project} onNavigate={props.onNavigate} />
      )}
    />
  )
}

function ProjectNotificationStatus(props: {
  home: HomeController
  server: ServerConnection.Any
  count: number
  notifications: Notification[]
  sessionIDs: string[]
}) {
  const ctx = createMemo(() => props.home.server.context(props.server))
  const language = useI18n()

  const unresolved = createMemo(() =>
    props.notifications.some((notification) => !!notification.session && !ctx().data.session.get(notification.session)),
  )

  const request = useQuery(() => ({
    queryKey: ["project-notification-sessions", props.server, ctx().sdk.connection.attempt(), props.sessionIDs],
    enabled:
      ctx().notification.ready() &&
      props.home.mode.current() !== undefined &&
      ctx().sdk.connection.status() === "connected" &&
      props.sessionIDs.some((id) => !ctx().data.session.get(id)),
    queryFn: async () => {
      const owner = ctx()

      const results = await Promise.allSettled(
        props.sessionIDs
          .filter((id) => !owner.data.session.get(id))
          .map(async (id) => {
            await owner.data.session.sync(id)

            if (!owner.data.session.get(id)) throw sessionNotFoundError(id)
          }),
      )

      const rejected = results.find((result) => result.status === "rejected")

      if (rejected) throw rejected.reason

      return true
    },
    retry: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  }))

  return (
    <>
      <Show when={props.count > 0}>
        <Badge class="shrink-0 tabular-nums">{props.count}</Badge>
      </Show>
      <Show when={unresolved() || !ctx().notification.ready() || props.home.mode.current() === undefined}>
        <Show
          when={request.isFetching || !ctx().notification.ready() || props.home.mode.current() === undefined}
          fallback={
            <Tooltip value={formatServerError(request.error, language.t, language.t("common.requestFailed"))}>
              <Button
                variant="ghost-muted"
                size="small"
                disabled={ctx().sdk.connection.status() !== "connected"}
                onPointerDown={(event: MouseEvent) => event.stopPropagation()}
                onClick={(event: MouseEvent) => {
                  event.preventDefault()
                  event.stopPropagation()
                  void request.refetch()
                }}
              >
                {language.t("common.retry")}
              </Button>
            </Tooltip>
          }
        >
          <Spinner class="size-3 shrink-0" aria-label={language.t("common.loading")} />
        </Show>
      </Show>
    </>
  )
}

function ProjectSessions(props: {
  home: HomeController
  server: ServerConnection.Any
  project: LocalProject
  onNavigate?: () => void
}) {
  const layout = useLayout()
  const ui = useI18n()

  const current = createMemo(() => {
    const route = layout.route()

    if (route.type !== "session" || route.server !== ServerConnection.key(props.server)) return

    return route.sessionId
  })

  const ctx = createMemo(() => props.home.server.context(props.server))

  const home = {
    ...props.home,
    selection: {
      ...props.home.selection,
      value: () => ({ server: ServerConnection.key(props.server), directory: props.project.worktree }),
    },
    server: {
      ...props.home.server,
      focused: () => props.server,
      focusedContext: ctx,
      focusedSync: () => ctx().sync,
    },
    project: {
      ...props.home.project,
      list: () => ctx().projects.list(),
      selected: () => props.project,
    },
  } satisfies HomeController

  const sessions = createHomeSessionsController(home, "sidebar")
  const [rowUI, setRowUI] = createStore<HomeSessionRowUI>({ menu: undefined, editor: undefined })

  const [view, setView] = createStore<{ sessionID: string | undefined; expanded: boolean }>({
    sessionID: undefined,
    expanded: false,
  })

  createEffect(on(home.mode.current, () => setView("expanded", false)))

  const records = createMemo(() => {
    const items = sessions.data.records()
    const id = current()
    const info = id ? ctx().data.session.get(id) : undefined
    const session = info ? ctx().data.session.apply(parseHomeSessionIndex([info], home.mode.current()))[0] : undefined

    if (!session || items.some((record) => record.session.id === session.id)) return items

    const project = ctx().projects.forSession(session)

    if (!project || pathKey(project.worktree) !== pathKey(props.project.worktree)) return items

    return buildHomeSessionRecords({
      sessions: () => [...items.map((record) => record.session), session],
      projectDirectories: () => undefined,
      projects: home.project.list,
      resolveProject: ctx().projects.forSession,
      order: "message",
    })
  })

  const watermark = createMemo(() => Math.max(5, records().findIndex((record) => record.session.id === current()) + 1))

  const renderSession = (record: Accessor<HomeSessionRecord>) => (
    <HomeSessionRow
      record={record()}
      statusPlacement="trailing"
      current={current() === record().session.id}
      server={ServerConnection.key(props.server)}
      language={sessions.copy.language}
      desktop={sessions.platform.desktop}
      location={sessions.location.value}
      showProjectName={false}
      isOpenTab={sessions.tab.isOpen}
      onOpenSession={(session, options) => {
        sessions.session.open(session, options)

        if (!options?.background) props.onNavigate?.()
      }}
      onRevealLocations={sessions.location.sync}
      onArchiveSession={sessions.session.archive}
      onRenameSession={sessions.session.rename}
      onForkSession={sessions.session.fork}
      onCopySessionID={sessions.session.copyID}
      onExportSession={sessions.session.export}
      onDeleteSession={sessions.session.showDelete}
      rowUI={rowUI}
      setRowUI={setRowUI}
      showLocations={false}
      hoveredSession={view.sessionID}
      onHoverSession={(sessionID) => setView("sessionID", sessionID)}
    />
  )

  return (
    <div
      class="flex min-w-0 flex-col gap-px py-1"
      aria-label={sessions.copy.language.t("sidebar.project.recentSessions")}
    >
      <Show
        when={!sessions.data.loading()}
        fallback={
          <div class="flex h-10 items-center gap-2 px-3 text-v2-text-text-muted" role="status">
            <Spinner class="size-3.5 shrink-0" />
            {sessions.copy.language.t("common.loading")}
          </div>
        }
      >
        <Show
          when={!sessions.data.error()}
          fallback={
            <div class="px-3 py-2 text-v2-text-text-muted" role="alert">
              {sessions.data.error()}
            </div>
          }
        >
          <Show
            when={records().length > 0}
            fallback={
              <div class="px-3 py-2 text-v2-text-text-muted">{sessions.copy.language.t("home.sessions.empty")}</div>
            }
          >
            <Collapsible
              variant="ghost"
              open={view.expanded}
              onOpenChange={(expanded) => setView("expanded", expanded)}
            >
              <Key each={records().slice(0, watermark())} by={(record) => record.session.id}>
                {renderSession}
              </Key>
              <Collapsible.Content>
                <Key each={records().slice(watermark())} by={(record) => record.session.id}>
                  {renderSession}
                </Key>
              </Collapsible.Content>
              <Show when={view.expanded || records().length > watermark()}>
                <Collapsible.Trigger as={Button} variant="ghost-muted" size="small" class="justify-start px-3">
                  {ui.t(view.expanded ? "ui.sessionTurn.diffs.showLess" : "ui.common.showMore")}
                </Collapsible.Trigger>
              </Show>
            </Collapsible>
          </Show>
        </Show>
      </Show>
    </div>
  )
}

export * as ProjectNavigation from "./project-sidebar"
