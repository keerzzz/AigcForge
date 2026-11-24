import type { SessionInfo } from "@omnixa/client/promise"
import type { ProductMode } from "@omnixa/schema/product-mode"
import { useDialog } from "@omnixa/ui/context/dialog"
import { Button } from "@omnixa/ui/button"
import { DialogFooter, DialogHeader, DialogTitleGroup, Dialog } from "@omnixa/ui/dialog"
import { skipToken, useQuery, useQueryClient } from "@tanstack/solid-query"
import { type Accessor, createEffect, createMemo, type JSX, Show, startTransition, untrack } from "solid-js"
import { notifySessionTabsRemoved } from "@/shell/titlebar/session-events"
import { useCommand } from "@/shell/commands/command"
import {
  HOME_SESSION_LIMIT,
  loadHomeSessionIndex,
  mergeHomeSessionIndex,
  retainHomeSessions,
} from "@/home/sessions/index"
import type { LocalProject } from "@/shell/state/layout"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import type { ServerApi } from "@/runtime/server/api"
import type { ServerCtx } from "@/runtime/server/runtime"
import { sessionHasOpenTab, useTabs } from "@/shell/tabs/tabs"
import { errorMessage } from "@/shell/layout/helpers"
import { useSessionTabAvatarState } from "@/shell/layout/project-avatar-state"
import { sessionTreeIDs } from "@/session/requests/session-request-tree"
import { pathKey } from "@/workspaces/path-key"
import { fetchSessionExport, saveSessionExport, sessionExportFilename } from "@/session/commands/export"
import { usePlatform } from "@/runtime/platform/platform"
import { sessionLabel, sessionTitle } from "@/session/title"
import { showToast } from "@/shell/notifications/toast"
import { archiveHomeSession } from "./archive"
import type { HomeController } from "../model"
import { buildHomeSessionRecords, homeProjectForSession, homeSessionLocation, type HomeSessionRecord } from "./records"

export type { HomeSessionRecord } from "./records"

// Keep the immutable result opaque so Solid Query does not recursively unwrap every session on mount.
const selectSessions = (sessions: SessionInfo[]) => () => sessions

export type HomeSessionGroup = {
  id: "today" | "yesterday" | "older"
  title: string
  sessions: HomeSessionRecord[]
}

export type OpenSessionOptions = { background?: boolean }

type HomeSearchScope = {
  ctx: ServerCtx | undefined
  api: ServerApi | undefined
  store: ServerCtx["data"]["session"] | undefined
  project: string | undefined
  directory: string | undefined
  directories: string | undefined
  mode: ProductMode.ID | undefined
}

export function createHomeSessionsController(home: HomeController, surface: "home" | "sidebar" = "home") {
  const tabs = useTabs()
  const command = useCommand()
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const queryClient = useQueryClient()

  const projectDirectories = createMemo(() => {
    const selected = home.selection.value().directory

    if (!selected) return
    const project = home.project.selected()

    return project ? directories(project) : [selected]
  })

  const searchScope = (): HomeSearchScope => {
    const ctx = home.server.focusedContext()
    const selected = projectDirectories()
    // The API getter can replace its client without replacing the SDK object.
    // Observe real reconnect signals; every ownership check still reads the getter.
    ctx?.sdk.connection.status()
    ctx?.sdk.connection.attempt()

    return {
      ctx,
      api: ctx?.sdk.api,
      store: ctx?.data.session,
      project: home.project.selected()?.id,
      directory: home.selection.value().directory,
      directories: selected ? [...new Set(selected.map(pathKey))].toSorted().join("\0") : undefined,
      mode: home.mode.current(),
    }
  }

  const matchesSearchScope = (scope: ReturnType<typeof searchScope> | undefined) => {
    if (!scope) return false
    const current = searchScope()

    return (
      scope.ctx === current.ctx &&
      scope.api === current.api &&
      scope.store === current.store &&
      scope.project === current.project &&
      scope.directory === current.directory &&
      scope.directories === current.directories &&
      scope.mode === current.mode
    )
  }

  const sessionLoad = useQuery(() => {
    const ctx = home.server.focusedContext()
    const conn = home.server.focused()
    const mode = home.mode.current()

    return {
      queryKey: ["home-sessions", conn, mode, surface] as const,
      enabled: !!ctx && ctx.sdk.connection.status() === "connected" && (surface === "home" || mode !== undefined),
      queryFn: ctx
        ? ({ signal }) =>
            loadHomeSessionIndex(
              (input, options) => ctx.sdk.api.session.list(input, options),
              signal,
              mode,
              surface === "sidebar" ? "message" : "updated",
              surface === "sidebar"
                ? async (sessions, signal) => {
                    // Older local servers omit the activity projection. Read one row per message type
                    // through their existing API; current servers return the projection with the list.
                    const resolved: SessionInfo[] = []
                    const pending = sessions.values()

                    await Promise.all(
                      Array.from({ length: Math.min(8, sessions.length) }, async () => {
                        for (const session of pending) {
                          if (session.time.message !== undefined) {
                            resolved.push(session)
                            continue
                          }

                          const latest = await Promise.all(
                            (["user", "assistant"] as const).map((type) =>
                              ctx.sdk.api.message.list(
                                { sessionID: session.id, limit: 1, order: "desc", type },
                                { signal },
                              ),
                            ),
                          )

                          const messages = latest.flatMap((response) => response.data.map((item) => item.time.created))

                          resolved.push({
                            ...session,
                            time: {
                              ...session.time,
                              message: messages.length ? Math.max(...messages) : session.time.created,
                            },
                          })
                        }
                      }),
                    )

                    return resolved
                  }
                : undefined,
            )
        : skipToken,
      retry: false,
      staleTime: 30_000,
      refetchOnMount: true,
      refetchOnReconnect: true,
      select: selectSessions,
    }
  })

  const indexedSessions = createMemo(() => {
    const ctx = home.server.focusedContext()
    const conn = home.server.focused()

    if (!ctx || !conn) return []

    const projected = new Map((sessionLoad.data?.() ?? []).map((session) => [session.id, session.time.message]))

    return retainHomeSessions(
      ctx.data.session.apply(
        mergeHomeSessionIndex(
          sessionLoad.isPending ? [] : (sessionLoad.data?.() ?? []),
          ctx.data.session.list(),
          home.mode.current(),
        ).map((session) => {
          if (surface !== "sidebar") return session
          const message = projected.get(session.id)

          return {
            ...session,
            time: {
              ...session.time,
              message:
                session.time.message === undefined && message === undefined
                  ? session.time.created
                  : Math.max(session.time.message ?? 0, message ?? 0),
            },
          }
        }),
      ),
      HOME_SESSION_LIMIT,
      Date.now(),
      surface === "sidebar" ? "message" : "updated",
    )
  })

  const allRecords = createMemo(() => {
    const records = buildHomeSessionRecords({
      sessions: indexedSessions,
      projectDirectories: surface === "home" ? projectDirectories : () => undefined,
      projects: home.project.list,
      resolveProject: (session) => home.server.focusedContext()?.projects.forSession(session),
      order: surface === "sidebar" ? "message" : "updated",
    })

    if (surface === "home") return records
    const project = home.project.selected()

    if (!project) return []

    return records.filter((record) => pathKey(record.project.worktree) === pathKey(project.worktree))
  })

  const records = createMemo(() => allRecords().slice(0, HOME_SESSION_LIMIT))
  const groups = createMemo(() => groupSessions(records(), language))
  const prefetched = new Set<string>()

  const location = (record: HomeSessionRecord) => {
    const branch = home.server.focusedContext()?.data.location.vcs.info(record.session.location)?.branch.current

    return homeSessionLocation(record.session.location.directory, branch)
  }

  const syncLocations = (record?: HomeSessionRecord) => {
    if (platform.platform !== "desktop") return
    const ctx = home.server.focusedContext()

    if (!ctx) return

    if (record) {
      void ctx.data.location.vcs.sync(record.session.location).catch(() => undefined)

      return
    }

    const locations = new Map(
      records().map((record) => [pathKey(record.session.location.directory), record.session.location] as const),
    )

    void Promise.allSettled(Array.from(locations.values(), (location) => ctx.data.location.vcs.sync(location)))
  }

  createEffect(() => {
    if (surface !== "home") return
    const ctx = home.server.focusedContext()
    const conn = home.server.focused()

    if (!ctx || !conn) return
    records()
      .slice(0, 2)
      .forEach((record) => {
        const key = `${ServerConnection.key(conn)}\0${record.session.id}`

        if (prefetched.has(key)) return
        prefetched.add(key)
        void untrack(() => ctx.data.session.sync(record.session.id)).catch(() => {})
      })
  })

  if (surface === "home")
    command.register("home.palette", () => [
      {
        id: "command.palette",
        title: language.t("command.palette"),
        hidden: true,
        onSelect: async () => {
          const conn = home.server.focused()

          if (!conn) return
          const ctx = home.server.focusedContext()

          if (!ctx) return
          const { HomeCommandPalette } = await import("./command-palette")
          void dialog.show(() => (
            <Show<ProductMode.ID | "all", (mode: ProductMode.ID | "all") => JSX.Element>
              when={home.mode.current() ?? "all"}
              keyed
            >
              {(mode) => (
                <HomeCommandPalette
                  mode={mode === "all" ? undefined : mode}
                  server={conn}
                  onSelectSession={(entry) => {
                    if (!entry.sessionID || !entry.directory || !entry.server) return
                    const sessionID = entry.sessionID
                    const server = entry.server
                    const directory = entry.project?.worktree ?? entry.directory
                    ctx.projects.open(directory)
                    ctx.projects.touch(directory)
                    void startTransition(() => {
                      const tab = tabs.addSessionTab({ server, sessionId: sessionID })
                      tabs.select(tab)
                    })
                  }}
                />
              )}
            </Show>
          ))
        },
      },
    ])

  const rename = async (server: ServerConnection.Key, session: SessionInfo, title: string) => {
    const conn = home.server.list().find((item) => ServerConnection.key(item) === server)
    const ctx = conn ? home.server.context(conn) : undefined

    if (!conn || !ctx) return false
    const next = title.trim()

    if (!next || next === sessionLabel(session)) return true

    return ctx.sdk.api.session
      .update({ sessionID: session.id, title: next })
      .then(() => {
        ctx.data.session.remember({ ...(ctx.data.session.get(session.id) ?? session), title: next })
        // Rename advances time.updated server-side; re-sync the canonical
        // record so date grouping and ordering do not go stale.
        ctx.data.session.invalidate(session.id)
        void ctx.data.session.sync(session.id).catch(() => {})
        queryClient.setQueriesData<SessionInfo[]>({ queryKey: ["home-sessions", conn], exact: false }, (current) =>
          current?.map((item) => (item.id === session.id ? { ...item, title: next } : item)),
        )

        return true
      })
      .catch((cause) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(cause, language.t("common.requestFailed")),
        })

        return false
      })
  }

  const exportSession = async (server: ServerConnection.Key, session: SessionInfo) => {
    const conn = home.server.list().find((item) => ServerConnection.key(item) === server)
    const ctx = conn ? home.server.context(conn) : undefined

    if (!ctx) return

    try {
      const data = await fetchSessionExport({ sessionID: session.id, api: ctx.sdk.api })
      const filename = sessionExportFilename(data.info)

      if (!(await saveSessionExport(filename, data, platform))) return
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("toast.session.export.success.title"),
        description: language.t("toast.session.export.success.description", { filename }),
      })
    } catch (cause) {
      showToast({
        variant: "error",
        title: language.t("toast.session.export.failed.title"),
        description: cause instanceof Error ? cause.message : language.t("toast.session.export.failed.description"),
      })
    }
  }

  const fork = async (server: ServerConnection.Key, session: SessionInfo) => {
    const conn = home.server.list().find((item) => ServerConnection.key(item) === server)
    const ctx = conn ? home.server.context(conn) : undefined

    if (!conn || !ctx) return
    const owner = ctx.sdk.api

    try {
      const [{ DialogFork }] = await Promise.all([
        import("@/session/commands/fork-dialog"),
        ctx.data.session.message.sync(session.id),
      ])

      if (home.server.context(conn) !== ctx || ctx.sdk.api !== owner) return
      void dialog.show(() => <DialogFork source={{ server: conn, session, scope: ctx.sdk.scope }} />)
    } catch (cause) {
      if (home.server.context(conn) !== ctx || ctx.sdk.api !== owner) return
      showToast({
        title: language.t("common.requestFailed"),
        description: errorMessage(cause, language.t("common.requestFailed")),
      })
    }
  }

  const copySessionID = async (session: SessionInfo) => {
    try {
      await (platform.writeClipboardText?.(session.id) ?? navigator.clipboard.writeText(session.id))
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("common.copied"),
        description: session.id,
      })
    } catch (cause) {
      showToast({
        variant: "error",
        title: language.t("toast.session.copyID.failed.title"),
        description: errorMessage(cause, language.t("toast.session.copyID.failed.description")),
      })
    }
  }

  const remove = async (server: ServerConnection.Key, session: SessionInfo) => {
    const conn = home.server.list().find((item) => ServerConnection.key(item) === server)
    const ctx = conn ? home.server.context(conn) : undefined

    if (!conn || !ctx) return false
    const ids = sessionTreeIDs(ctx.data.session.list(), session.id)

    return ctx.data.session
      .remove(session.id)
      .then(() => {
        notifySessionTabsRemoved({
          server: ServerConnection.key(conn),
          directory: session.location.directory,
          sessionIDs: ids,
        })

        return true
      })
      .catch((cause) => {
        showToast({
          title: language.t("session.delete.failed.title"),
          description: errorMessage(cause, language.t("session.delete.failed.title")),
        })

        return false
      })
      .finally(() => {
        void queryClient.invalidateQueries({ queryKey: ["home-sessions", conn], exact: false })
      })
  }

  function DeleteDialog(props: { server: ServerConnection.Key; session: SessionInfo }) {
    const name = () => sessionTitle(props.session.title) ?? language.t("command.session.new")

    const confirm = async () => {
      await remove(props.server, props.session)
      dialog.close()
    }

    return (
      <Dialog fit>
        <DialogHeader hideClose>
          <DialogTitleGroup
            title={language.t("session.delete.title")}
            description={language.t("session.delete.confirm", { name: name() })}
          />
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="danger" onClick={confirm}>
            {language.t("session.delete.button")}
          </Button>
        </DialogFooter>
      </Dialog>
    )
  }

  return {
    scope: { current: searchScope, matches: matchesSearchScope },
    mode: home.mode,
    copy: {
      language,
    },
    data: {
      records,
      groups,
      loading: () => (surface === "sidebar" && home.mode.current() === undefined) || sessionLoad.isPending,
      error: () =>
        sessionLoad.isError ? errorMessage(sessionLoad.error, language.t("common.requestFailed")) : undefined,
      searchRecords: allRecords,
    },
    platform: {
      desktop: platform.platform === "desktop",
    },
    location: {
      value: location,
      sync: syncLocations,
    },
    session: {
      showProjectName: () => !home.project.selected(),
      server: () => home.selection.value().server,
      canCreate: () => home.mode.current() !== undefined && !!home.project.newSession(),
      lookup: async (sessionID: string, scope = searchScope()) => {
        if (!scope.ctx || !scope.api) return
        const result = await scope.api.session.get({ sessionID })

        if (!matchesSearchScope(scope) || result.time.archived) return

        return buildHomeSessionRecords({
          sessions: () => [result],
          projectDirectories,
          projects: home.project.list,
          resolveProject: scope.ctx.projects.forSession,
        })[0]
      },
      create: home.project.openNewSession,
      open: (session: SessionInfo, options?: OpenSessionOptions, scope = searchScope()) => {
        if (!matchesSearchScope(scope)) return

        const project =
          surface === "sidebar"
            ? scope.ctx?.projects.forSession(session)
            : homeProjectForSession(session, home.project.list())

        const conn = home.server.focused()

        if (!conn) return
        const connKey = ServerConnection.key(conn)
        const directory = project?.worktree ?? session.location.directory
        const ctx = scope.ctx

        if (!ctx) return

        if (!options?.background) void ctx.data.session.message.sync(session.id).catch(() => undefined)
        // Commit cache/project changes with navigation instead of rebuilding
        // the outgoing Home list before leaving it.
        void startTransition(() => {
          if (!matchesSearchScope(scope)) return
          const tab = tabs.addSessionTab({ server: connKey, sessionId: session.id })

          if (!options?.background) tabs.select(tab)
          ctx.data.session.remember(session)
          ctx.projects.open(directory)

          if (!options?.background) ctx.projects.touch(directory)
        })
      },
      archive: async (session: SessionInfo) => {
        const conn = home.server.focused()
        const ctx = home.server.focusedContext()

        if (!conn || !ctx) return
        await archiveHomeSession({
          server: ServerConnection.key(conn),
          session,
          // TODO: Restore archiving when the V2 client exposes a session archive API.
          archive: async (_sessionID) => Promise.reject(new Error("Session archiving is unavailable")),
          remove() {},
          onError: (cause) =>
            showToast({
              title: language.t("common.requestFailed"),
              description: errorMessage(cause, language.t("common.requestFailed")),
            }),
        })
      },
      rename,
      fork,
      copyID: copySessionID,
      export: exportSession,
      showDelete: (server: ServerConnection.Key, session: SessionInfo) =>
        dialog.show(() => <DeleteDialog server={server} session={session} />),
    },
    tab: {
      isOpen: (record: HomeSessionRecord) => {
        const server = home.selection.value().server

        return !!server && sessionHasOpenTab(tabs.store, server, record.session)
      },
    },
  }
}

function directories(project: LocalProject) {
  return [project.worktree, ...(project.sandboxes ?? [])]
}

export function homeSessionSearchKey(record: HomeSessionRecord) {
  return `${pathKey(record.session.location.directory)}:${record.session.id}`
}

// Calendar day in the local time zone, comparable as a number.
function localDay(date: Date) {
  return date.getFullYear() * 10_000 + date.getMonth() * 100 + date.getDate()
}

function groupSessions(records: HomeSessionRecord[], language: ReturnType<typeof useLanguage>): HomeSessionGroup[] {
  const now = new Date()
  const today = localDay(now)
  const yesterday = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))

  const day = (record: HomeSessionRecord) =>
    localDay(new Date(record.session.time.updated ?? record.session.time.created))

  const todaySessions = records.filter((record) => day(record) === today)
  const yesterdaySessions = records.filter((record) => day(record) === yesterday)
  const olderSessions = records.filter((record) => day(record) !== today && day(record) !== yesterday)

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

export type HomeSessionsController = ReturnType<typeof createHomeSessionsController>

export function HomeSessionStatusController(props: {
  server: ServerConnection.Key
  record: HomeSessionRecord
  isOpenTab: (record: HomeSessionRecord) => boolean
  render: (state: { unread: Accessor<boolean>; loading: Accessor<boolean>; open: Accessor<boolean> }) => JSX.Element
}) {
  const avatar = useSessionTabAvatarState(
    () => props.server,
    () => props.record.session.id,
    () => true,
  )

  return props.render({
    unread: avatar.unread,
    loading: avatar.loading,
    open: () => props.isOpenTab(props.record),
  })
}
