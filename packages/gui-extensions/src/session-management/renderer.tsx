import { For, Show, createMemo, createSignal, lazy, onCleanup, Suspense } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@aigcfroge/ui/icon"
import { IconButton } from "@aigcfroge/ui/icon-button"
import { Switch } from "@aigcfroge/ui/switch"
import { showToast } from "@aigcfroge/ui/toast"
import { Tooltip } from "@aigcfroge/ui/tooltip"
import { errorMessage } from "@aigcfroge/util/error"
import type { SessionControllerSource } from "@aigcfroge/client/promise"
import {
  Command,
  createKeyed,
  LinkHandler,
  MenuItem,
  onIdle,
  Panel,
  SettingsPage,
  Slot,
  Style,
  usePanel,
  type PanelTab,
  type MountedSession,
  type SessionRef,
  type ServerRef,
  type SessionTargetRef,
  type Setup,
} from "../sdk"
import type definition from "./index"
import { isChildSession } from "./panel-drafts"
import { delegationRunning, executionStatus, operationRunning } from "./execution-status"
import { SessionProgressIndicatorV2 } from "@aigcfroge/session-ui/v2/session-progress-indicator-v2"
import delegationStyles from "./delegation-panel.css?inline"
import metaStyles from "./meta-agent-panel.css?inline"
import workflowStyles from "./workflow-run-panel.css?inline"
import artifactStyles from "./work-artifact-panel.css?inline"
import sessionStyles from "./session-panel.css?inline"
import compositionStyles from "./composition-panel.css?inline"

const setup: Setup<typeof definition> = (ctx) => {
  ctx.add(Style, delegationStyles)
  ctx.add(Style, metaStyles)
  ctx.add(Style, workflowStyles)
  ctx.add(Style, artifactStyles)
  ctx.add(Style, sessionStyles)
  ctx.add(Style, compositionStyles)
  const Collaborations = lazy(() => import("./delegation-panel"))
  const Meta = lazy(() => import("./meta-agent-panel"))
  const Workflow = lazy(() => import("./workflow-run-panel"))
  const Artifacts = lazy(() => import("./work-artifact-panel"))
  const SessionContent = lazy(() => import("./session-panel"))
  const Composition = lazy(() => import("./composition-panel"))

  const [draftAgents, setDraftAgents] = createStore<
    Record<string, { owner: symbol; read: () => string | undefined } | undefined>
  >({})

  const pendingAgent = (serverID: string, sessionID: string) => draftAgents[`${serverID}\n${sessionID}`]?.read()

  const openMeta = async (input: { source: MountedSession; target: SessionTargetRef; toggle?: boolean }) => {
    const stored = ctx.stores.meta(input.source)
    const target = stored.value?.target
    const panel = `${ctx.id}:collaborations`
    const state = ctx.layout.state(panel, input.source)

    if (
      input.toggle &&
      target?.serverID === input.target.server.id &&
      target.sessionID === input.target.id &&
      (state === "active" || state === "visible")
    ) {
      ctx.layout.close(panel, input.source)

      return
    }

    try {
      stored.update((draft) => {
        draft.target = { serverID: input.target.server.id, sessionID: input.target.id }
        draft.taskID = undefined
        draft.workerSessionID = undefined
        draft.communicationID = undefined
      })

      if (ctx.signal.aborted) return

      ctx.stores.collaboration(input.source).update((draft) => {
        draft.view = "advanced"
      })

      if (ctx.signal.aborted) return
      ctx.layout.open(panel, input.source)
    } catch (error) {
      if (ctx.signal.aborted) return

      showToast({
        variant: "error",
        title: ctx.t("session.meta.openError"),
        description: errorMessage(error, ctx.t("common.requestFailed")),
      })
    }
  }

  ctx.add(Slot, {
    at: "session.composer.actions",
    render(input) {
      // The main Composer owns Meta activation; this reader only follows unsent Agent changes.
      createKeyed(
        () => input.active && `${input.session.server.id}\n${input.session.id}`,
        (key) => {
          const owner = Symbol()
          setDraftAgents(key, { owner, read: () => input.draftAgent })
          onCleanup(() => {
            if (draftAgents[key]?.owner === owner) setDraftAgents(key, undefined)
          })
        },
      )

      return <></>
    },
  })

  ctx.add(Slot, {
    at: "session.response.actions",
    render(input) {
      const [pending, setPending] = createSignal(false)
      let disposed = false
      onCleanup(() => {
        disposed = true
      })
      const metaChild = () => input.session.server.data.session.get(input.session.id)?.controller?.kind === "child"

      const fork = async () => {
        const captured = {
          target: input.session,
          source: input.source,
          boundary: input.boundary,
          userMessageID: input.userMessageID,
          assistantMessageID: input.assistantMessageID,
          contentID: input.contentID,
          text: input.text,
        }

        const server = captured.target.server
        const client = server.client
        const sessionID = captured.target.id
        const through = captured.boundary?.type === "through" ? captured.boundary.messageID : undefined
        const attempt = server.attempt

        if (
          disposed ||
          ctx.signal.aborted ||
          pending() ||
          !input.active ||
          !input.completed ||
          metaChild() ||
          through === undefined ||
          !server.connected
        )
          return

        setPending(true)

        try {
          const created = await client.session.fork({ sessionID, through }, { signal: ctx.signal })

          if (disposed || ctx.signal.aborted || server.attempt !== attempt) return
          server.data.session.remember(created)
          ctx.sessions.open({ source: captured.source, server, sessionID: created.id })
        } catch (error) {
          if (disposed || ctx.signal.aborted || server.attempt !== attempt) return
          showToast({
            variant: "error",
            title: ctx.t("session.response.fork.error"),
            description: errorMessage(error, ctx.t("common.requestFailed")),
          })
        } finally {
          if (!disposed && !ctx.signal.aborted) setPending(false)
        }
      }

      return (
        <Show when={input.active && input.completed && input.boundary?.type === "through" && !metaChild()}>
          <Tooltip
            value={ctx.t(
              !input.session.server.connected
                ? "session.response.fork.offline"
                : pending()
                  ? "session.response.fork.creating"
                  : "session.response.fork",
            )}
          >
            <IconButton
              icon={<Icon name="branch" size="small" />}
              variant="ghost-muted"
              size="small"
              aria-label={ctx.t("session.response.fork")}
              aria-busy={pending()}
              disabled={pending() || !input.session.server.connected}
              onClick={() => void fork()}
            />
          </Tooltip>
        </Show>
      )
    },
  })

  const sessionTabID = (target: { serverID: string; sessionID: string }) =>
    `session-${encodeURIComponent(`${target.serverID}\n${target.sessionID}`)}`

  const openSession = async (input: {
    source: MountedSession
    target: SessionTargetRef
    interaction: "interactive" | "readonly"
  }) => {
    const client = input.target.server.client
    const attempt = input.target.server.attempt

    try {
      if (!input.target.server.data.session.get(input.target.id))
        await input.target.server.data.session.readback(input.target.id)

      if (ctx.signal.aborted || input.target.server.client !== client || input.target.server.attempt !== attempt) return
      const info = input.target.server.data.session.get(input.target.id)
      const child = isChildSession(info)

      if (child)
        ctx.stores.collaboration(input.source).update((draft) => {
          draft.view = undefined
        })

      if (ctx.signal.aborted) return
      ctx.stores.views(input.source).update((draft) => {
        if (child) draft.selected = { serverID: input.target.server.id, sessionID: input.target.id }

        const saved = draft.targets.find(
          (target) => target.serverID === input.target.server.id && target.sessionID === input.target.id,
        )

        if (saved) {
          saved.interaction = input.interaction

          return
        }

        draft.targets.push({
          serverID: input.target.server.id,
          sessionID: input.target.id,
          interaction: input.interaction,
        })
      })

      if (ctx.signal.aborted) return
      ctx.layout.open(
        child
          ? `${ctx.id}:subagents`
          : `${ctx.id}:${sessionTabID({ serverID: input.target.server.id, sessionID: input.target.id })}`,
        input.source,
        { tab: ctx.layout.narrow() ? "open" : "select" },
      )
    } catch (error) {
      if (ctx.signal.aborted) return
      showToast({
        variant: "error",
        title: ctx.t("session.meta.openError"),
        description: errorMessage(error, ctx.t("common.requestFailed")),
      })
    }
  }

  const sessionTabs = new Map<string, Map<string, PanelTab>>()
  ctx.add(LinkHandler, {
    priority: 20,
    match(link) {
      return !!link.reference && !!link.session && ctx.sessions.current()?.key === link.session.key
    },
    async open(link) {
      const source = ctx.sessions.current()
      const reference = link.reference

      if (!source || !reference || source.key !== link.session?.key) return
      const server = ctx.servers.get(reference.serverID)

      if (!server) {
        showToast({
          variant: "error",
          title: ctx.t("session.content.serverUnavailable", { server: reference.serverID }),
        })

        return
      }

      const client = server.client
      const attempt = server.attempt

      try {
        await server.data.session.readback(reference.sessionID)

        if (
          ctx.signal.aborted ||
          ctx.sessions.current()?.key !== source.key ||
          server.client !== client ||
          server.attempt !== attempt
        )
          return
        await openSession({
          source,
          target: ctx.sessions.target({ server, sessionID: reference.sessionID }),
          interaction: "readonly",
        })
      } catch (error) {
        if (ctx.signal.aborted) return
        showToast({
          variant: "error",
          title: ctx.t("session.reference.openError"),
          description: errorMessage(error, ctx.t("common.requestFailed")),
        })
      }
    },
  })
  ctx.add(LinkHandler, {
    priority: 15,
    match(link) {
      return (
        ctx.stores.display.value.collaborations &&
        !!link.task &&
        !!link.session &&
        ctx.sessions.current()?.key === link.session.key
      )
    },
    async open(link) {
      const source = ctx.sessions.current()
      const target = link.task

      if (!source || !target || source.key !== link.session?.key) return

      try {
        ctx.stores.collaboration(source).update((draft) => {
          draft.view = undefined
          draft.source = undefined
          draft.task = {
            serverID: target.server.id,
            sourceSessionID: target.sourceSessionID,
            taskID: target.taskID,
            operationID: target.operationID,
          }
        })

        if (ctx.signal.aborted) return
        ctx.stores.views(source).update((draft) => {
          draft.selected = undefined
        })

        if (ctx.signal.aborted) return
        ctx.layout.open(`${ctx.id}:collaborations`, source)
      } catch (error) {
        if (ctx.signal.aborted) return

        showToast({
          variant: "error",
          title: ctx.t("session.taskDetails.openError"),
          description: errorMessage(error, ctx.t("common.requestFailed")),
        })
      }
    },
  })
  ctx.add(LinkHandler, {
    priority: 15,
    match(link) {
      return (
        ctx.stores.display.value.meta &&
        !!link.communication &&
        !!link.session &&
        ctx.sessions.current()?.key === link.session.key
      )
    },
    async open(link) {
      const source = ctx.sessions.current()
      const target = link.communication

      if (!source || !target || source.key !== link.session?.key) return

      try {
        ctx.stores.meta(source).update((draft) => {
          draft.target = { serverID: target.server.id, sessionID: target.sessionID }
          draft.communicationID = target.communicationID
          draft.taskID = undefined
          draft.workerSessionID = undefined
        })

        if (ctx.signal.aborted) return
        ctx.stores.collaboration(source).update((draft) => {
          draft.view = "advanced"
        })

        if (ctx.signal.aborted) return
        ctx.layout.open(`${ctx.id}:collaborations`, source)
      } catch (error) {
        if (ctx.signal.aborted) return
        showToast({
          variant: "error",
          title: ctx.t("session.communication.openError"),
          description: errorMessage(error, ctx.t("common.requestFailed")),
        })
      }
    },
  })
  ctx.add(LinkHandler, {
    priority: 10,
    match(link) {
      return !!link.sessionID && !!link.session && ctx.sessions.current()?.key === link.session.key
    },
    async open(link) {
      const source = ctx.sessions.current()

      if (!source || !link.sessionID || source.key !== link.session?.key) return

      await openSession({
        source,
        target: ctx.sessions.target({ server: source.server, sessionID: link.sessionID }),
        interaction: "readonly",
      })
    },
  })

  const pendingSessionTabs = new Map<string, Map<string, PanelTab>>()
  onCleanup(onIdle(() => void SessionContent.preload()))
  createKeyed(
    () => ctx.sessions.list().some((session) => ctx.layout.stored(session).some((id) => id.startsWith("session-"))),
    () => void SessionContent.preload(),
  )

  ctx.add(Panel, {
    id: "views",
    region: "side",
    get mobile() {
      const source = ctx.sessions.current()

      return source &&
        ctx.stores
          .views(source)
          .value?.targets.some(
            (binding) => !isChildSession(ctx.servers.get(binding.serverID)?.data.session.get(binding.sessionID)),
          )
        ? { title: ctx.t("session.content.title"), kind: "menu" as const, order: 54 }
        : undefined
    },
    list(input) {
      const ids = input.open.filter((id) => {
        if (!id.startsWith("session-")) return false
        const binding = ctx.stores.views(input.session).value?.targets.find((target) => sessionTabID(target) === id)
        const info = binding ? ctx.servers.get(binding.serverID)?.data.session.get(binding.sessionID) : undefined

        return !isChildSession(info)
      })

      if (!ids.length) {
        sessionTabs.delete(input.session.key)
        pendingSessionTabs.delete(input.session.key)

        return []
      }

      const saved = ctx.stores.views(input.session)

      if (!saved.ready() || !saved.value) {
        const previous = pendingSessionTabs.get(input.session.key)

        const pending = new Map(
          ids.map((id) => [id, previous?.get(id) ?? { id, title: ctx.t("session.content.loading"), hidden: true }]),
        )

        pendingSessionTabs.set(input.session.key, pending)

        return [...pending.values()]
      }

      pendingSessionTabs.delete(input.session.key)
      const previous = sessionTabs.get(input.session.key)

      const next = new Map(
        ids.flatMap((id) => {
          const binding = saved.value?.targets.find((target) => sessionTabID(target) === id)

          if (!binding) return []

          const serverID = binding.serverID
          const sessionID = binding.sessionID

          const tab: PanelTab = previous?.get(id) ?? {
            id,
            get title() {
              return ctx.t("session.content.tab", {
                title: ctx.servers.get(serverID)?.data.session.get(sessionID)?.title ?? sessionID,
                server: serverID,
              })
            },
            closable: "hover",
            fallback: true,
            dom: {
              tab: `session-side-panel-view-tab-${encodeURIComponent(input.session.key)}-${id}`,
              panel: `session-side-panel-view-tabpanel-${encodeURIComponent(input.session.key)}-${id}`,
            },
          }

          return [[id, tab] as const]
        }),
      )

      sessionTabs.set(input.session.key, next)

      return [...next.values()]
    },
    render(props) {
      const frame = usePanel()

      const binding = createMemo(() => {
        const targets = ctx.stores.views(props.session).value?.targets

        if (!targets) return undefined

        if (props.tab.id.startsWith("session-")) return targets.find((target) => sessionTabID(target) === props.tab.id)

        return targets.find((target) => {
          const state = ctx.layout.state(`${ctx.id}:${sessionTabID(target)}`, props.session)

          return state === "active" || state === "visible"
        })
      })

      return (
        <Suspense>
          <SessionContent
            session={props.session}
            screen={props.screen}
            active={frame.visible()}
            ready={ctx.stores.views(props.session).ready()}
            binding={binding()}
            openSession={openSession}
            onSelectTarget={(target) => {
              const server = ctx.servers.get(target.serverID)

              const saved = ctx.stores
                .views(props.session)
                .value?.targets.find(
                  (binding) => binding.serverID === target.serverID && binding.sessionID === target.sessionID,
                )

              if (server && saved)
                void openSession({
                  source: props.session,
                  target: ctx.sessions.target({ server, sessionID: target.sessionID }),
                  interaction: saved.interaction,
                })
            }}
          />
        </Suspense>
      )
    },
    close(input) {
      ctx.stores.views(input.session).update((draft) => {
        draft.targets = draft.targets.filter((target) => sessionTabID(target) !== input.tab.id)
      })
    },
  })

  const modules = [
    { id: "collaborations", icon: "task", bind: "mod+alt+q", View: Collaborations },
    { id: "subagents", icon: "subagent", bind: "mod+alt+a", View: Collaborations },
    { id: "workflow", icon: "branch", bind: "mod+alt+w", View: Workflow },
    { id: "artifacts", icon: "file-tree", bind: "mod+alt+f", View: Artifacts },
    { id: "composition", icon: "brain", bind: "mod+alt+t", View: Composition },
  ] as const

  modules.forEach((module, index) => {
    const panelID = module.id
    const title = () => ctx.t(`tab.${module.id}`)

    const tab: PanelTab = {
      id: panelID,
      get title() {
        return title()
      },
      label(state) {
        const running = () => {
          const session = state.session

          if (!session.server.connected) return 0
          const data = session.server.data.session
          const status = (id?: string) => executionStatus(session.server, id)

          if (module.id === "subagents")
            return data
              .family(session.id)
              .filter((id) => data.get(id)?.parentID === session.id && status(id) === "running").length

          if (module.id !== "collaborations") return 0

          return (
            (data.delegation.list(session.id) ?? []).filter((value) => delegationRunning(value, status)).length +
            (data.task.operation.list(session.id) ?? []).filter((value) => operationRunning(value, status)).length
          )
        }

        return (
          <span data-component="session-management-tab">
            <Icon name={module.icon} size="small" />
            <span>{title()}</span>
            <Show when={running()}>
              {(count) => (
                <span
                  data-slot="session-management-tab-status"
                  title={ctx.plural("session.dispatchMonitor.executions", count())}
                >
                  <span data-visible={state.active}>
                    <SessionProgressIndicatorV2 width={12} height={12} />
                  </span>
                  <span>{count()}</span>
                </span>
              )}
            </Show>
          </span>
        )
      },
      closable: "hover",
      fallback: true,
      dom: { tab: `session-side-panel-${panelID}-tab`, panel: `session-side-panel-${panelID}-tabpanel` },
    }

    const enabled = () => ctx.stores.display.value[module.id] !== false

    const available = (session: SessionRef) => {
      const info = session.server.data.session.get(session.id)

      if (module.id === "composition") return info?.mode === "custom"

      if (module.id === "workflow")
        return (
          info?.mode === "work" ||
          info?.mode === "custom" ||
          (info?.controller?.kind === "child" && info.controller.source.kind === "workflow") ||
          !!session.server.data.session.workflow.get(session.id)?.run ||
          !!ctx.stores.workflow(session).value?.source
        )

      if (module.id === "artifacts")
        return (
          info?.mode === "work" ||
          !!info?.workContract?.output?.artifact ||
          !!ctx.stores.artifact(session).value?.messageID
        )

      return true
    }

    const pendingTab: PanelTab = { ...tab, hidden: true }
    onCleanup(onIdle(() => void module.View.preload()))
    createKeyed(
      () => enabled() && ctx.sessions.list().some((session) => ctx.layout.stored(session).includes(panelID)),
      () => void module.View.preload(),
    )

    ctx.add(Panel, (): Panel | undefined =>
      enabled()
        ? {
            id: panelID,
            region: "side",
            normalize:
              module.id === "collaborations" || module.id === "subagents"
                ? (input) => {
                    if (module.id === "collaborations" && input.id === "advanced") {
                      ctx.stores.collaboration(input.session).update((draft) => {
                        draft.view = "advanced"
                      })

                      return "collaborations"
                    }

                    if (module.id === "collaborations" && input.id === "meta") return "collaborations"

                    if (!input.id.startsWith("session-")) return input.id

                    const binding = ctx.stores
                      .views(input.session)
                      .value?.targets.find((target) => sessionTabID(target) === input.id)

                    const info = binding
                      ? ctx.servers.get(binding.serverID)?.data.session.get(binding.sessionID)
                      : undefined

                    return isChildSession(info) ? "subagents" : input.id
                  }
                : undefined,
            get mobile() {
              const session = ctx.sessions.current()

              return session && available(session)
                ? { title: title(), kind: "menu" as const, order: 50 + index, icon: module.icon }
                : undefined
            },
            list: (input) => {
              if (!input.open.includes(panelID)) return []

              if (!input.session.server.data.session.get(input.session.id)) return [pendingTab]

              return available(input.session) ? [tab] : []
            },
            focus(input) {
              if (input.restored || module.id !== "workflow") return
              const info = input.session.server.data.session.get(input.session.id)
              const controller = info?.controller

              if (controller?.kind !== "child" || controller.source.kind !== "workflow" || !info?.parentID) return
              const source = controller.source
              const sessionID = info.parentID

              ctx.stores.workflow(input.session).update((draft) => {
                if (draft.source) return
                draft.source = { sessionID, runID: source.runID, stepRunID: source.stepRunID, inputID: source.inputID }
              })
            },
            render: (props) => {
              const frame = usePanel()

              const openSource = async (input: {
                sessionID: string
                source: SessionControllerSource
                server?: ServerRef
              }) => {
                const session = props.session
                const source = input.source

                const panel = ({ workflow: "workflow", subagent: "subagents", task: "collaborations" } as const)[
                  source.kind
                ]

                if (source.kind === "workflow")
                  ctx.stores.workflow(session).update((draft) => {
                    draft.source = {
                      sessionID: input.sessionID,
                      runID: source.runID,
                      stepRunID: source.stepRunID,
                      inputID: source.inputID,
                    }
                  })

                if (source.kind !== "workflow")
                  ctx.stores.collaboration(session).update((draft) => {
                    draft.view = undefined
                    draft.task = undefined
                    draft.source = { sessionID: input.sessionID, source, serverID: input.server?.id }
                  })

                if (ctx.signal.aborted) return

                if (panel === "collaborations" || panel === "subagents")
                  ctx.stores.views(session).update((draft) => {
                    draft.selected = undefined
                  })

                if (ctx.signal.aborted) return
                ctx.layout.open(`${ctx.id}:${panel}`, session)
              }

              if (module.id === "collaborations")
                return (
                  <Suspense>
                    <Show
                      when={
                        ctx.stores.display.value.meta &&
                        ctx.stores.collaboration(props.session).value?.view === "advanced"
                      }
                      fallback={
                        <Collaborations
                          session={props.session}
                          screen={props.screen}
                          active={frame.visible()}
                          pendingAgent={pendingAgent}
                          openAdvanced={() =>
                            void openMeta({
                              source: props.session,
                              target: ctx.sessions.target({
                                server: props.session.server,
                                sessionID: props.session.id,
                              }),
                            })
                          }
                          openSession={openSession}
                        />
                      }
                    >
                      <Meta
                        session={props.session}
                        screen={props.screen}
                        active={frame.visible()}
                        pendingAgent={pendingAgent}
                        openSource={(input) => void openSource(input)}
                        onBack={() =>
                          ctx.stores.collaboration(props.session).update((draft) => {
                            draft.view = undefined
                          })
                        }
                        openSession={openSession}
                      />
                    </Show>
                  </Suspense>
                )

              if (module.id === "workflow")
                return (
                  <Suspense>
                    <Workflow session={props.session} active={frame.visible()} openSession={openSession} />
                  </Suspense>
                )

              if (module.id === "subagents")
                return (
                  <Suspense>
                    <Collaborations
                      session={props.session}
                      screen={props.screen}
                      active={frame.visible()}
                      childrenOnly
                      pendingAgent={pendingAgent}
                      openAdvanced={() =>
                        void openMeta({
                          source: props.session,
                          target: ctx.sessions.target({ server: props.session.server, sessionID: props.session.id }),
                        })
                      }
                      openSession={openSession}
                    />
                  </Suspense>
                )

              if (module.id === "composition")
                return (
                  <Suspense>
                    <Composition
                      session={props.session}
                      active={frame.visible()}
                      openSession={openSession}
                      openPanel={(targetPanel) => ctx.layout.open(`${ctx.id}:${targetPanel}`, props.session)}
                    />
                  </Suspense>
                )

              return (
                <Suspense>
                  <module.View session={props.session} screen={props.screen} active={frame.visible()} />
                </Suspense>
              )
            },
          }
        : undefined,
    )
    ctx.add(MenuItem, (): MenuItem | undefined => {
      const session = ctx.sessions.current()

      if (!enabled() || !session || !available(session)) return

      return {
        id: module.id,
        menu: "session.panel",
        title: title(),
        icon: module.icon,
        keybind: `${ctx.id}.${module.id}`,
        order: 50 + index,
        run: async () => {
          if (module.id === "subagents")
            ctx.stores.views(session).update((draft) => {
              draft.selected = undefined
            })

          if (module.id === "collaborations") {
            ctx.stores.views(session).update((draft) => {
              draft.selected = undefined
            })
            ctx.stores.collaboration(session).update((draft) => {
              draft.view = undefined
              draft.task = undefined
              draft.source = undefined
            })
          }

          if (ctx.signal.aborted) return
          ctx.layout.open(`${ctx.id}:${module.id}`, session)
        },
      }
    })
    ctx.add(Command, (): Command => {
      const session = ctx.sessions.current()

      return {
        id: module.id,
        title: title(),
        section: "session",
        bind: module.bind,
        featured:
          module.id === "collaborations" &&
          !!session &&
          (!pendingAgent(session.server.id, session.id) || pendingAgent(session.server.id, session.id) === "meta") &&
          session.server.data.session.identity.get(session.id)?.coordination?.available === true
            ? true
            : undefined,
        enabled: enabled() && !!session && available(session),
        run: async () => {
          const current = ctx.sessions.current()

          if (!current) return

          if (module.id === "subagents")
            ctx.stores.views(current).update((draft) => {
              draft.selected = undefined
            })

          if (module.id === "collaborations") {
            ctx.stores.views(current).update((draft) => {
              draft.selected = undefined
            })
            ctx.stores.collaboration(current).update((draft) => {
              draft.view = undefined
              draft.task = undefined
              draft.source = undefined
            })
          }

          if (ctx.signal.aborted) return
          ctx.layout.open(`${ctx.id}:${module.id}`, current)
        },
      }
    })
  })

  ctx.add(SettingsPage, {
    id: "display",
    page: "general",
    section: "general",
    get title() {
      return ctx.t("settings.title")
    },
    get entries() {
      return (["collaborations", "subagents", "meta", "workflow", "artifacts", "composition"] as const).map(
        (module) => ({
          id: `show-${module}`,
          title: ctx.t(`show.${module}`),
        }),
      )
    },
    render: () => (
      <For each={["collaborations", "subagents", "meta", "workflow", "artifacts", "composition"] as const}>
        {(module) => (
          <div data-component="settings-row">
            <div data-slot="settings-row-copy">
              <div data-slot="settings-row-title">{ctx.t(`show.${module}`)}</div>
            </div>
            <div data-slot="settings-row-control">
              <Switch
                aria-label={ctx.t(`show.${module}`)}
                checked={ctx.stores.display.value[module] !== false}
                onChange={(checked) =>
                  ctx.stores.display.update((draft) => {
                    draft[module] = checked
                  })
                }
                hideLabel
              >
                {ctx.t(`show.${module}`)}
              </Switch>
            </div>
          </div>
        )}
      </For>
    ),
  })
}

export default setup
