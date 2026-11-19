import { type DelegationDeliveryInfo, type DelegationLegacyState } from "@aigcfroge/client/promise"
import { Button } from "@aigcfroge/ui/button"
import { Badge } from "@aigcfroge/ui/badge"
import { Collapsible } from "@aigcfroge/ui/collapsible"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@aigcfroge/ui/dialog"
import { Icon } from "@aigcfroge/ui/icon"
import { IconButton } from "@aigcfroge/ui/icon-button"
import { List } from "@aigcfroge/ui/list"
import { errorMessage } from "@aigcfroge/util/error"
import { Match, Option, Schema } from "effect"
import { For, Show, createMemo, onCleanup } from "solid-js"
import {
  createKeyed,
  createLatest,
  useExtension,
  type MountedSession,
  type ServerRef,
  type SessionScreen,
  type SessionTargetRef,
} from "../sdk"
import type definition from "./index"
import { TaskDetails } from "./task-details"
import { SessionPanel } from "./session-panel"

type DelegationAction = "interrupt" | "close" | "reconcile" | "retry"

type DelegationControl =
  | { action: Exclude<DelegationAction, "retry">; value: DelegationLegacyState }
  | { action: "retry"; value: DelegationLegacyState; participantID: string; turnID: string }

type DelegationPanelState = {
  loading: boolean
  read: number
  error: string | undefined
  controlPending: DelegationAction | undefined
  controlError: string | undefined
  controlAck: DelegationAction | undefined
  controlOwner: (() => boolean) | undefined
  resultOwner: (() => boolean) | undefined
  results: Record<string, { pending?: boolean; text?: string; error?: string } | undefined>
}

type Props = {
  session: MountedSession
  screen: SessionScreen
  active: boolean
  childrenOnly?: boolean
  openAdvanced: () => void
  pendingAgent?: (serverID: string, sessionID: string) => string | undefined
  openSession: (input: {
    source: MountedSession
    target: SessionTargetRef
    interaction: "interactive" | "readonly"
  }) => void
}

export function DelegationPanel(props: Props) {
  const ctx = useExtension<typeof definition>()

  const server = () => {
    const source = ctx.stores.collaboration(props.session).value?.source
    const id = source && (source.source.kind === "subagent") === !!props.childrenOnly ? source.serverID : undefined

    return id ? ctx.servers.get(id) : props.session.server
  }

  const selected = createMemo(() => {
    const saved = ctx.stores.views(props.session).value

    return saved?.selected
      ? saved.targets.find(
          (target) => target.serverID === saved.selected?.serverID && target.sessionID === saved.selected.sessionID,
        )
      : undefined
  })

  return (
    <Show
      when={props.childrenOnly ? selected() : undefined}
      keyed
      fallback={
        <Show
          when={!props.childrenOnly ? ctx.stores.collaboration(props.session).value?.task : undefined}
          fallback={
            <Show when={server()} keyed fallback={<p role="status">{ctx.t("session.tasks.offline")}</p>}>
              {(server) => <DelegationContent {...props} server={server} />}
            </Show>
          }
        >
          {(binding) => <TaskDetails {...props} binding={binding()} />}
        </Show>
      }
    >
      {(binding) => (
        <SessionPanel
          session={props.session}
          screen={props.screen}
          active={props.active}
          ready={ctx.stores.views(props.session).ready()}
          binding={binding}
          onBack={() =>
            void ctx.stores.views(props.session).update((draft) => {
              draft.selected = undefined
            })
          }
          onSelectTarget={(target) => {
            const saved = ctx.stores
              .views(props.session)
              .value?.targets.find(
                (binding) => binding.serverID === target.serverID && binding.sessionID === target.sessionID,
              )

            const server = ctx.servers.get(target.serverID)

            if (server)
              props.openSession({
                source: props.session,
                target: ctx.sessions.target({ server, sessionID: target.sessionID }),
                interaction: saved?.interaction ?? "readonly",
              })
          }}
          openSession={props.openSession}
        />
      )}
    </Show>
  )
}

function DelegationContent(props: Props & { server: ServerRef }) {
  const ctx = useExtension<typeof definition>()
  const stored = () => ctx.stores.collaboration(props.session)
  const source = () => {
    const value = stored().value?.source

    return value && (value.source.kind === "subagent") === !!props.childrenOnly ? value : undefined
  }
  const targetID = () => source()?.sessionID ?? props.session.id
  const target = () => ctx.sessions.target({ server: props.server, sessionID: targetID() })
  const tasks = createMemo(() => props.server.data.session.task.list(targetID()) ?? [])
  const operations = createMemo(() => props.server.data.session.task.operation.list(targetID()) ?? [])

  const taskSource = () => {
    const value = source()?.source

    return value?.kind === "task" ? value : undefined
  }

  const subagentSource = () => {
    const value = source()?.source

    return value?.kind === "subagent" ? value : undefined
  }

  const memory = createMemo(() =>
    ctx.storage.memory<DelegationPanelState>(`delegations.${props.session.key}`, {
      initial: {
        loading: false,
        read: 0,
        error: undefined,
        controlPending: undefined,
        controlError: undefined,
        controlAck: undefined,
        controlOwner: undefined,
        resultOwner: undefined,
        results: {},
      },
    }),
  )

  const state = () => memory()[0]
  const connected = () => props.server.connected

  const sessionStatus = (id: string | undefined) => {
    if (!id || !props.server.data.session.get(id)) return undefined

    if (!connected()) return "disconnected"

    if (
      (props.server.data.session.permission.list(id)?.length ?? 0) > 0 ||
      (props.server.data.session.form.list(id)?.length ?? 0) > 0
    )
      return "waiting"

    return props.server.data.session.status(id)
  }

  const response = (id: string | undefined) => {
    if (!id) return undefined

    const latest = props.server.data.session.message
      .list(id)
      .findLast(
        (message) =>
          message.type === "assistant" && message.content.some((part) => part.type === "text" && part.text.trim()),
      )

    if (latest?.type !== "assistant") return undefined

    return latest.content
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n")
      .trim()
  }

  const delegations = createMemo(() => {
    if (!props.active) return undefined
    const selected = source()?.source
    const items = props.server.data.session.delegation.list(targetID())

    if (!selected) return items

    if (selected.kind !== "task") return []

    return items?.filter((item) => item.delegation.id === selected.delegationID)
  })

  const receipts = createMemo(() => (props.active ? props.server.data.session.delegation.receipts(targetID()) : []))

  const calls = createMemo(() =>
    props.active
      ? props.server.data.session.message.list(targetID()).flatMap((message) =>
          message.type === "assistant"
            ? message.content.flatMap((tool) => {
                if (tool.type !== "tool" || tool.name !== "subagent") return []
                const selected = source()?.source

                if (
                  selected &&
                  (selected.kind !== "subagent" ||
                    selected.assistantMessageID !== message.id ||
                    selected.toolCallID !== tool.id)
                )
                  return []

                const metadata = tool.state.status === "streaming" ? undefined : tool.state.metadata

                return [
                  {
                    key: JSON.stringify([target().key, message.id, tool.id]),
                    parentSessionID: targetID(),
                    messageID: message.id,
                    tool,
                    childID: Option.getOrUndefined(Schema.decodeUnknownOption(Schema.String)(metadata?.sessionID)),
                  },
                ]
              })
            : [],
        )
      : [],
  )

  const subagents = createMemo(() => {
    const groups = new Map<string, ReturnType<typeof calls>>()

    calls().forEach((call) => {
      const key = call.childID ? JSON.stringify([target().key, call.childID]) : call.key
      const existing = groups.get(key)

      if (existing) existing.push(call)

      if (!existing) groups.set(key, [call])
    })

    return Array.from(groups, ([key, items]) => ({ key, childID: items[0]?.childID, calls: items }))
  })

  const related = createMemo(() => {
    if (!props.active || source()) return []

    const represented = new Set([
      ...calls().flatMap((call) => (call.childID ? [call.childID] : [])),
      ...(delegations() ?? []).flatMap((value) =>
        value.participants.flatMap((participant) => (participant.childSessionID ? [participant.childSessionID] : [])),
      ),
    ])

    const family = props.server.data.session.family(targetID()).flatMap((id) => {
      const info = props.server.data.session.get(id)

      return info?.parentID ? [info] : []
    })

    const descendants = new Set([targetID()])

    let previousSize = 0

    // A family also contains siblings when this panel is opened on a child.
    // Grow only the branch rooted at this panel's actual session.
    while (previousSize !== descendants.size) {
      previousSize = descendants.size
      family.forEach((child) => {
        if (child.parentID && descendants.has(child.parentID)) descendants.add(child.id)
      })
    }

    return family.filter((child) => descendants.has(child.id) && !represented.has(child.id))
  })

  const sourceFound = () => {
    const selected = source()?.source

    if (!selected) return true

    if (selected.kind === "subagent") return calls().length > 0

    return delegations()?.some((item) =>
      item.participants.some((participant) => participant.id === selected.participantID),
    )
  }

  const openRoots = createMemo(() => {
    if (!props.active) return []

    const represented = new Set([
      ...calls().flatMap((call) => (call.childID ? [`${props.server.id}\n${call.childID}`] : [])),
      ...related().map((child) => `${props.server.id}\n${child.id}`),
      ...(delegations() ?? []).flatMap((value) =>
        value.participants.flatMap((participant) =>
          participant.childSessionID ? [`${props.server.id}\n${participant.childSessionID}`] : [],
        ),
      ),
      ...operations().flatMap((operation) =>
        operation.targetSessionID ? [`${props.server.id}\n${operation.targetSessionID}`] : [],
      ),
    ])

    const opened = ctx.sessions
      .list()
      .filter((session) => {
        const info = session.server.data.session.get(session.id)

        return !!info && !info.parentID && !session.pending && session.key !== props.session.key
      })
      .map((session) => ctx.sessions.target({ server: session.server, sessionID: session.id }))

    const retained = (ctx.stores.views(props.session).value?.targets ?? []).flatMap((binding) => {
      const server = ctx.servers.get(binding.serverID)

      return server ? [ctx.sessions.target({ server, sessionID: binding.sessionID })] : []
    })

    return [
      ...new Map(
        [...opened, ...retained].flatMap((session) =>
          session.key !== props.session.key && !represented.has(`${session.server.id}\n${session.id}`)
            ? [[session.key, session] as const]
            : [],
        ),
      ).values(),
    ]
  })

  const controlPending = () => state().controlPending
  const controlAck = () => (state().controlOwner?.() ? state().controlAck : undefined)
  const controlError = () => (state().controlOwner?.() ? state().controlError : undefined)

  const resultKey = (record: DelegationDeliveryInfo) =>
    JSON.stringify([
      record.delegationID,
      record.turnID,
      record.participantID,
      record.deliveryOrigin,
      record.senderParticipantID,
      record.attempt,
    ])

  const resultState = (record: DelegationDeliveryInfo) =>
    state().resultOwner?.() ? state().results[resultKey(record)] : undefined

  async function readResult(record: DelegationDeliveryInfo) {
    if (!props.active || !connected() || resultState(record)?.pending) return
    const server = props.server
    const client = server.client
    const attempt = server.attempt
    const sessionID = targetID()
    const directory = target().location?.directory
    const ui = memory()

    const current = () =>
      !ctx.signal.aborted &&
      targetID() === sessionID &&
      ctx.servers.get(server.id)?.client === client &&
      ctx.servers.get(server.id)?.attempt === attempt &&
      ctx.servers.get(server.id)?.data.session.get(sessionID)?.location.directory === directory

    const owner = ui[0].resultOwner?.() ? ui[0].resultOwner : current

    if (ui[0].resultOwner !== owner)
      ui[1]((state) => {
        state.resultOwner = owner
        state.results = {}
      })
    ui[1]((state) => {
      state.results[resultKey(record)] = { pending: true }
    })

    try {
      const result = await server.data.session.delegation.readResult(sessionID, record)

      if (!current() || ui[0].resultOwner !== owner) return
      ui[1]((state) => {
        state.results[resultKey(record)] = {
          pending: false,
          text: result.text,
          error: result.available ? undefined : ctx.t("session.collaboration.resultUnavailable"),
        }
      })
    } catch (error) {
      if (!current() || ui[0].resultOwner !== owner) return
      ui[1]((state) => {
        state.results[resultKey(record)] = {
          pending: false,
          error: errorMessage(error, ctx.t("session.tasks.error.unknown")),
        }
      })
    }
  }

  async function loadCollaborations(signal = ctx.signal) {
    if (!props.active || !connected() || signal.aborted) return
    const server = props.server
    const client = server.client
    const attempt = server.attempt
    const sessionID = targetID()
    const ui = memory()
    const read = ui[0].read + 1
    ui[1]((state) => {
      state.read = read
      state.loading = true
      state.error = undefined
    })

    try {
      if (!server.data.session.get(sessionID)) {
        await server.data.session.readback(sessionID)

        if (signal.aborted) return
      }

      server.data.session.delegation.invalidate(sessionID)
      await Promise.all([
        server.data.session.readback(sessionID, { children: true }),
        server.data.session.message.sync(sessionID),
        server.data.session.delegation.sync(sessionID),
        server.data.session.task.sync(sessionID),
        server.data.session.task.operation.sync(sessionID),
        server.data.session.identity.sync(sessionID),
      ])

      if (signal.aborted) return
    } catch (error) {
      if (signal.aborted) return

      if (
        ctx.servers.get(server.id)?.client !== client ||
        ctx.servers.get(server.id)?.attempt !== attempt ||
        targetID() !== sessionID
      )
        return

      if (ui[0].read === read)
        ui[1]((state) => {
          state.error = errorMessage(error, ctx.t("session.tasks.error.unknown"))
        })
    } finally {
      if (!signal.aborted && ui[0].read === read)
        ui[1]((state) => {
          state.loading = false
        })
    }
  }

  async function loadHistory() {
    if (!props.active || !connected()) return

    const server = props.server
    const client = server.client
    const attempt = server.attempt
    const sessionID = targetID()
    const ui = memory()

    try {
      await server.data.session.message.loadMore(sessionID, { signal: ctx.signal })

      if (ctx.signal.aborted) return
    } catch (error) {
      if (
        ctx.signal.aborted ||
        targetID() !== sessionID ||
        props.server.client !== client ||
        props.server.attempt !== attempt
      )
        return

      ui[1]((state) => {
        state.error = errorMessage(error, ctx.t("session.tasks.error.unknown"))
      })
    }
  }

  async function control(request: DelegationControl) {
    if (controlPending() || !connected()) return
    const serverID = props.server.id
    const client = props.server.client
    const attempt = props.server.attempt
    const sessionID = targetID()
    const directory = target().location?.directory
    const key = props.session.key
    const ui = memory()

    const current = () => {
      const server = ctx.servers.get(serverID)

      return (
        server?.client === client &&
        server.attempt === attempt &&
        server.data.session.get(sessionID)?.location.directory === directory
      )
    }

    const input = { delegationID: request.value.delegation.id, directory }
    ui[1]((state) => {
      state.controlPending = request.action
      state.controlError = undefined
      state.controlAck = undefined
      state.controlOwner = current
    })

    try {
      const updated = await Match.value(request).pipe(
        Match.when({ action: "interrupt" }, () => client.delegation.interrupt(input)),
        Match.when({ action: "close" }, () => client.delegation.close(input)),
        Match.when({ action: "retry" }, (request) =>
          client.delegation.retry({ ...input, participantID: request.participantID, turnID: request.turnID }),
        ),
        Match.when({ action: "reconcile" }, () => client.delegation.reconcile({ ...input, decision: "resume" })),
        Match.exhaustive,
      )

      if (ui[0].controlOwner !== current || !current()) return
      // Native/API execution outlives a renderer generation; settle the original memory owner only.
      ctx.servers.get(serverID)?.data.session.delegation.remember(sessionID, updated)
      ui[1]((state) => {
        state.controlAck = request.action
      })

      if (!ctx.signal.aborted && props.session.key === key && props.active) void loadCollaborations()
    } catch (error) {
      if (ui[0].controlOwner !== current || !current()) return
      ui[1]((state) => {
        state.controlError = errorMessage(error, ctx.t("session.tasks.error.unknown"))
      })

      if (!ctx.signal.aborted && props.session.key === key && props.active) void loadCollaborations()
    } finally {
      if (ui[0].controlOwner === current)
        ui[1]((state) => {
          state.controlPending = undefined
        })
    }
  }

  function openResult(id: string) {
    if (ctx.layout.side.opened(props.session)) ctx.layout.side.toggle(props.session)
    ctx.sessions.open({ source: props.session, server: props.server, sessionID: targetID(), reveal: id })
  }

  // Reads stop with panel visibility; the existing Data/SSE owner stays shared with the Session.
  createKeyed(
    () =>
      props.active && connected() && stored().value && target().location
        ? {
            key: target().key,
            sessionID: targetID(),
            client: props.server.client,
            data: props.server.data,
            attempt: props.server.attempt,
            directory: target().location?.directory,
          }
        : undefined,
    (source) => {
      const controller = new AbortController()

      onCleanup(() => controller.abort())
      void loadCollaborations(controller.signal)
      onCleanup(
        source.data.on("task.updated", (event) => {
          if (event.data.sessionID === source.sessionID) void loadCollaborations(controller.signal)
        }),
      )
      onCleanup(
        source.data.listen((event) => {
          if (!event.details.type.startsWith("delegation.") || !("delegationID" in event.details.data)) return
          const id = event.details.data.delegationID

          if (
            ("parentSessionID" in event.details.data && event.details.data.parentSessionID === source.sessionID) ||
            delegations()?.some((item) => item.delegation.id === id)
          )
            void loadCollaborations(controller.signal)
        }),
      )
    },
    {
      equals: (previous, next) =>
        previous.key === next.key &&
        previous.client === next.client &&
        previous.attempt === next.attempt &&
        previous.directory === next.directory,
    },
  )

  return (
    <section
      data-component="session-delegation-panel"
      data-slot="delegation-list"
      aria-label={ctx.t(props.childrenOnly ? "tab.subagents" : "session.collaboration.title")}
    >
      <div data-slot="task-toolbar">
        <h3>{ctx.t(props.childrenOnly ? "tab.subagents" : "session.collaboration.title")}</h3>
        <div data-slot="task-form-actions">
          <IconButton
            type="button"
            size="small"
            variant="ghost"
            disabled={!connected() || state().loading}
            onClick={() => void loadCollaborations()}
            aria-label={ctx.t("session.collaboration.reload")}
            title={ctx.t("session.collaboration.reload")}
            icon={<Icon name="refresh" size="small" />}
          />
          <Show when={!props.childrenOnly && ctx.stores.display.value.meta}>
            <Button type="button" size="small" variant="ghost" onClick={props.openAdvanced}>
              {ctx.t("session.meta.advanced")}
            </Button>
          </Show>
        </div>
      </div>
      <Show when={!props.childrenOnly && tasks().length}>
        <section data-slot="task-flow">
          <h4>{ctx.t("session.tasks.title")}</h4>
          <ol>
            <For each={tasks()}>
              {(task) => (
                <li data-state={task.status}>
                  <span data-slot="task-running-indicator" aria-hidden="true">
                    <Show when={task.status === "completed"}>
                      <Icon name="check" size="small" />
                    </Show>
                  </span>
                  <Button
                    type="button"
                    size="small"
                    variant="ghost"
                    onClick={() =>
                      ctx.sessions.openTask({
                        source: props.session,
                        target: { server: props.server, sourceSessionID: targetID(), taskID: task.id },
                      })
                    }
                  >
                    {task.content}
                  </Button>
                  <Badge>{ctx.t(`session.tasks.status.${task.status}`)}</Badge>
                </li>
              )}
            </For>
          </ol>
        </section>
      </Show>
      <Show when={!props.childrenOnly && operations().length}>
        <section data-slot="dispatch-flow">
          <h4>{ctx.t("session.operation.flow")}</h4>
          <For each={operations()}>
            {(operation) => (
              <article data-state={operation.phase}>
                <span data-slot="task-running-indicator" aria-hidden="true" />
                <div data-slot="task-row-content">
                  <Button
                    type="button"
                    size="small"
                    variant="ghost"
                    onClick={() =>
                      ctx.sessions.openTask({
                        source: props.session,
                        target: {
                          server: props.server,
                          sourceSessionID: targetID(),
                          operationID: operation.operationID,
                        },
                      })
                    }
                  >
                    {operation.request.description ?? operation.request.prompt}
                  </Button>
                  <div data-slot="task-metadata">
                    <span>{operation.source.agent}</span>
                    <Icon name="outline-arrow-right" size="small" />
                    <span>
                      {operation.targetSessionID
                        ? (props.server.data.session.get(operation.targetSessionID)?.title ?? operation.targetSessionID)
                        : operation.request.target.type === "new_root"
                          ? (operation.request.target.title ?? operation.request.target.agent)
                          : (props.server.data.session.get(operation.request.target.sessionID)?.title ??
                            operation.request.target.sessionID)}
                    </span>
                    <Badge>{ctx.t(`session.operation.phase.${operation.phase}`)}</Badge>
                  </div>
                </div>
                <Show when={operation.targetSessionID}>
                  {(id) => (
                    <Button
                      type="button"
                      size="small"
                      variant="ghost"
                      onClick={() =>
                        props.openSession({
                          source: props.session,
                          target: ctx.sessions.target({ server: props.server, sessionID: id() }),
                          interaction: props.server.data.session.get(id())?.parentID ? "readonly" : "interactive",
                        })
                      }
                    >
                      {ctx.t("session.collaboration.viewSession")}
                    </Button>
                  )}
                </Show>
              </article>
            )}
          </For>
        </section>
      </Show>
      <Show when={source()}>
        {(selected) => (
          <section aria-label={ctx.t("session.collaboration.sourceTitle")}>
            <div data-slot="task-metadata">
              <span>{ctx.t(`session.collaboration.source.${selected().source.kind}`)}</span>
              <code>{selected().sessionID}</code>
              <Show when={taskSource()}>
                {(value) => (
                  <>
                    <code>{value().delegationID}</code>
                    <code>{value().participantID}</code>
                  </>
                )}
              </Show>
              <Show when={subagentSource()}>
                {(value) => (
                  <>
                    <code>{value().assistantMessageID}</code>
                    <code>{value().toolCallID}</code>
                  </>
                )}
              </Show>
            </div>
            <Button
              type="button"
              size="small"
              variant="ghost"
              onClick={() =>
                void stored().update((draft) => {
                  draft.source = undefined
                })
              }
            >
              {ctx.t("session.collaboration.clearSource")}
            </Button>
            <Show when={!state().loading && !sourceFound()}>
              <p data-slot="task-progress" role="status">
                {ctx.t("session.collaboration.sourceMissing")}
              </p>
            </Show>
          </section>
        )}
      </Show>
      <Show when={state().loading && !delegations()}>
        <p data-slot="task-progress">{ctx.t("session.collaboration.loading")}</p>
      </Show>
      <Show when={state().error}>
        {(message) => (
          <p data-slot="task-error" role="alert">
            {ctx.t("session.collaboration.error.load", { message: message() })}
          </p>
        )}
      </Show>
      <Show when={controlError()}>
        {(message) => (
          <p data-slot="task-error" role="alert">
            {ctx.t("session.collaboration.error.action", { message: message() })}
          </p>
        )}
      </Show>
      <Show when={controlPending() || controlAck()}>
        {(action) => (
          <p data-slot="task-progress" role="status">
            {ctx.t(controlPending() ? "session.collaboration.pending" : `session.collaboration.ack.${action()}`)}
          </p>
        )}
      </Show>
      <Show when={props.childrenOnly && subagents().length > 0}>
        <section data-slot="subagent-group" aria-label={ctx.t("session.collaboration.subagents")}>
          <For each={subagents().map((group) => group.key)}>
            {(key) => {
              const group = createMemo(() => subagents().find((group) => group.key === key))
              const childID = () => group()?.childID

              const child = () => {
                const id = childID()

                return id ? props.server.data.session.get(id) : undefined
              }

              const owned = () => child()?.parentID === targetID()

              const source = createMemo(() => {
                const id = childID()

                if (!props.active || !connected() || !id) return undefined

                return {
                  key: target().key,
                  data: props.server.data,
                  client: props.server.client,
                  attempt: props.server.attempt,
                  read: state().read,
                  childID: id,
                }
              })

              const metadata = createLatest(source, async (value, signal) => {
                if (!value.data.session.get(value.childID)) {
                  await value.data.session.readback(value.childID)

                  if (signal.aborted) return
                }

                if (value.data.session.get(value.childID)?.parentID !== targetID()) return

                await value.data.session.message.sync(value.childID)

                if (signal.aborted) return
              })

              const status = () => sessionStatus(owned() ? childID() : undefined)

              const preview = () => {
                const text = response(owned() ? childID() : undefined)

                if (text) return text

                const state = group()?.calls.at(-1)?.tool.state

                if (!state || state.status === "streaming") return undefined

                const description = Option.getOrUndefined(
                  Schema.decodeUnknownOption(Schema.String)(state.input.description).pipe(
                    Option.filter((value) => value.trim() !== child()?.title?.trim()),
                  ),
                )

                // The core's running result acknowledges background admission, not a child response.
                if (
                  state.status === "running" ||
                  (state.status === "completed" && state.metadata?.status === "running")
                )
                  return description

                const output = state.content
                  ?.flatMap((part) => (part.type === "text" ? [part.text] : []))
                  .join("\n")
                  .trim()

                const opening = `<subagent sessionID="${childID()}" state="completed">\n`
                const closing = "\n</subagent>"

                // Only unwrap the core's completed tool result for this exact child.
                if (
                  state.status === "completed" &&
                  state.metadata?.status === "completed" &&
                  childID() &&
                  output?.startsWith(opening) &&
                  output.endsWith(closing)
                )
                  return output.slice(opening.length, -closing.length).trim() || description

                return output || (state.status === "error" ? state.error.message : description)
              }

              return (
                <article
                  data-slot="subagent-session"
                  data-state={status()}
                  aria-label={ctx.t("session.collaboration.subagent", { id: childID() ?? key })}
                >
                  <Button
                    type="button"
                    size="small"
                    variant="ghost"
                    data-slot="subagent-row"
                    aria-label={child()?.title ?? ctx.t("session.collaboration.status.starting")}
                    disabled={!owned() || !childID() || !ctx.stores.views(props.session).ready()}
                    onClick={() => {
                      const id = childID()

                      if (id)
                        props.openSession({
                          source: props.session,
                          target: ctx.sessions.target({ server: props.server, sessionID: id }),
                          interaction: "readonly",
                        })
                    }}
                  >
                    <Icon name="subagent" size="normal" class="subagent-row-icon" />
                    <span data-slot="subagent-row-copy">
                      <span data-slot="subagent-row-title">
                        <h4>{child()?.title ?? ctx.t("session.collaboration.status.starting")}</h4>
                        <Show when={status()}>
                          {(value) => (
                            <Badge
                              data-slot="subagent-session-status"
                              variant={value() === "running" ? "accent" : "neutral"}
                            >
                              {ctx.t(`session.collaboration.status.${value()}`)}
                            </Badge>
                          )}
                        </Show>
                      </span>
                      <Show when={preview()}>{(text) => <span data-slot="subagent-row-preview">{text()}</span>}</Show>
                    </span>
                    <Icon name="chevron-right" size="small" class="subagent-row-chevron" />
                  </Button>
                  <Show when={childID() && !child() && connected()}>
                    <p data-slot="task-progress" role={metadata.error ? "alert" : "status"}>
                      {ctx.t(
                        metadata.error
                          ? "session.collaboration.childUnavailable"
                          : "session.collaboration.childLoading",
                      )}
                    </p>
                  </Show>
                  <Show when={child() && !owned()}>
                    <p data-slot="task-error" role="alert">
                      {ctx.t("session.collaboration.childMismatch")}
                    </p>
                  </Show>
                  <Collapsible variant="ghost" data-slot="subagent-call-records">
                    <Collapsible.Trigger type="button">
                      <Collapsible.Arrow />
                      <span>{ctx.t("session.collaboration.details")}</span>
                    </Collapsible.Trigger>
                    <Collapsible.Content>
                      <div data-slot="task-form-actions">
                        <Show when={owned() && childID()}>
                          {(id) => (
                            <Button
                              type="button"
                              size="small"
                              variant="ghost"
                              onClick={() =>
                                ctx.sessions.open({
                                  source: props.session,
                                  server: props.server,
                                  sessionID: id(),
                                })
                              }
                            >
                              {ctx.t("session.collaboration.openSession")}
                            </Button>
                          )}
                        </Show>
                      </div>
                      <For each={group()?.calls.map((call) => call.key)}>
                        {(key) => (
                          <Show when={calls().find((call) => call.key === key)}>
                            {(call) => {
                              const input = () => {
                                const state = call().tool.state

                                return state.status === "streaming" ? undefined : state.input
                              }

                              const description = createMemo(() =>
                                Option.getOrUndefined(Schema.decodeUnknownOption(Schema.String)(input()?.description)),
                              )

                              const agent = createMemo(() =>
                                Option.getOrUndefined(Schema.decodeUnknownOption(Schema.String)(input()?.agent)),
                              )

                              const status = () => {
                                const state = call().tool.state

                                if (state.status === "streaming") return "starting"

                                if (state.status === "completed" && state.metadata?.status === "running")
                                  return "background"

                                return state.status
                              }

                              const output = () => {
                                const state = call().tool.state

                                return state.status === "completed" || state.status === "error"
                                  ? state.content
                                      ?.flatMap((item) => (item.type === "text" ? [item.text] : []))
                                      .join("\n")
                                  : undefined
                              }

                              const failure = () => {
                                const state = call().tool.state

                                return state.status === "error" ? state.error.message : undefined
                              }

                              return (
                                <div data-slot="subagent-call">
                                  <Show when={description()}>{(value) => <p>{value()}</p>}</Show>
                                  <div data-slot="task-metadata">
                                    <span>
                                      {ctx.t("session.collaboration.call", {
                                        status: ctx.t(`session.collaboration.status.${status()}`),
                                      })}
                                    </span>
                                    <Show when={agent()}>{(value) => <span>{value()}</span>}</Show>
                                    <Collapsible variant="ghost" data-slot="task-disclosure">
                                      <Collapsible.Trigger type="button">
                                        <Collapsible.Arrow />
                                        {ctx.t("session.collaboration.details")}
                                      </Collapsible.Trigger>
                                      <Collapsible.Content>
                                        <code>{call().parentSessionID}</code>
                                        <code>{call().messageID}</code>
                                        <code>{call().tool.id}</code>
                                      </Collapsible.Content>
                                    </Collapsible>
                                  </div>
                                  <Show when={output() !== undefined || failure() !== undefined}>
                                    <Collapsible variant="ghost" data-slot="delegation-result">
                                      <Collapsible.Trigger type="button">
                                        <Collapsible.Arrow />
                                        {ctx.t("session.collaboration.openToolOutput")}
                                      </Collapsible.Trigger>
                                      <Collapsible.Content>
                                        <Show when={output() !== undefined}>
                                          <pre>{output()}</pre>
                                        </Show>
                                        <Show when={failure() !== undefined}>
                                          <pre>{failure()}</pre>
                                        </Show>
                                      </Collapsible.Content>
                                    </Collapsible>
                                  </Show>
                                  <div data-slot="task-form-actions">
                                    <Button
                                      type="button"
                                      size="small"
                                      variant="ghost"
                                      onClick={() => openResult(call().tool.id)}
                                    >
                                      {ctx.t("session.collaboration.openTool")}
                                    </Button>
                                  </div>
                                </div>
                              )
                            }}
                          </Show>
                        )}
                      </For>
                    </Collapsible.Content>
                  </Collapsible>
                </article>
              )
            }}
          </For>
        </section>
      </Show>
      <Show when={props.childrenOnly && related().length > 0}>
        <section data-slot="collaboration-related-group" aria-label={ctx.t("session.collaboration.related")}>
          <h3>{ctx.t("session.collaboration.related")}</h3>
          <For each={related()}>
            {(child) => {
              const source = createMemo(() =>
                props.active && connected()
                  ? {
                      key: target().key,
                      data: props.server.data,
                      client: props.server.client,
                      attempt: props.server.attempt,
                      read: state().read,
                      childID: child.id,
                    }
                  : undefined,
              )

              createLatest(source, async (value, signal) => {
                await value.data.session.message.sync(value.childID)

                if (signal.aborted) return
              })

              const status = () => sessionStatus(child.id)

              return (
                <article data-slot="collaboration-related-session" data-state={status()}>
                  <Button
                    type="button"
                    size="small"
                    variant="ghost"
                    data-slot="subagent-row"
                    aria-label={child.title}
                    disabled={!ctx.stores.views(props.session).ready()}
                    onClick={() =>
                      props.openSession({
                        source: props.session,
                        target: ctx.sessions.target({ server: props.server, sessionID: child.id }),
                        interaction: "readonly",
                      })
                    }
                  >
                    <Icon name="subagent" size="normal" class="subagent-row-icon" />
                    <span data-slot="subagent-row-copy">
                      <span data-slot="subagent-row-title">
                        <h4>{child.title}</h4>
                        <Show when={status()}>
                          {(value) => (
                            <Badge
                              data-slot="subagent-session-status"
                              variant={value() === "running" ? "accent" : "neutral"}
                            >
                              {ctx.t(`session.collaboration.status.${value()}`)}
                            </Badge>
                          )}
                        </Show>
                      </span>
                      <Show when={response(child.id)}>
                        {(text) => <span data-slot="subagent-row-preview">{text()}</span>}
                      </Show>
                    </span>
                    <Icon name="chevron-right" size="small" class="subagent-row-chevron" />
                  </Button>
                </article>
              )
            }}
          </For>
        </section>
      </Show>
      <Show
        when={
          !state().loading &&
          delegations() &&
          !delegations()?.length &&
          (!props.childrenOnly || !subagents().length) &&
          (!props.childrenOnly || !related().length) &&
          (props.childrenOnly || !tasks().length) &&
          (props.childrenOnly || !operations().length)
        }
      >
        <p data-slot="task-empty">
          {ctx.t(props.childrenOnly ? "session.collaboration.childrenEmpty" : "session.collaboration.empty")}
        </p>
      </Show>
      <Show when={!props.childrenOnly && delegations()?.length}>
        <h3 data-slot="collaboration-group-heading">{ctx.t("session.collaboration.delegations")}</h3>
      </Show>
      <Show when={!props.childrenOnly ? delegations() : undefined}>
        {(items) => (
          <For each={items()}>
            {(value) => (
              <article
                data-slot="delegation-row"
                data-state={value.delegation.status}
                aria-label={ctx.t("session.collaboration.delegation", { id: value.delegation.id })}
              >
                <h4>
                  <span data-slot="task-running-indicator" aria-hidden="true" />
                  {value.delegation.title}
                </h4>
                <div data-slot="task-metadata">
                  <Collapsible variant="ghost" data-slot="task-disclosure">
                    <Collapsible.Trigger type="button">
                      <Collapsible.Arrow />
                      {ctx.t("session.collaboration.details")}
                    </Collapsible.Trigger>
                    <Collapsible.Content>
                      <code>{value.delegation.id}</code>
                    </Collapsible.Content>
                  </Collapsible>
                  <Badge>{ctx.t(`session.collaboration.status.${value.delegation.status}`)}</Badge>
                  <Show when={value.softExpired}>
                    <span>{ctx.t("session.collaboration.softExpired")}</span>
                  </Show>
                </div>
                <Show when={value.delegation.latestRevisionDigest}>
                  {(digest) => (
                    <Collapsible variant="ghost" data-slot="delegation-revision">
                      <Collapsible.Trigger type="button">
                        <Collapsible.Arrow />
                        {ctx.t("session.collaboration.revisionDetails")}
                      </Collapsible.Trigger>
                      <Collapsible.Content>
                        <code>{digest()}</code>
                      </Collapsible.Content>
                    </Collapsible>
                  )}
                </Show>
                <Show when={value.delegation.rejectionBlocked}>
                  <p data-slot="task-error">
                    {value.delegation.rejectionReason ?? ctx.t("session.collaboration.rejectionBlocked")}
                  </p>
                </Show>
                <Show when={value.barrier}>
                  {(barrier) => (
                    <p>
                      {ctx.t(
                        barrier().passed ? "session.collaboration.reviewPassed" : "session.collaboration.reviewBlocked",
                      )}
                      {barrier().reason ? ` · ${barrier().reason}` : ""}
                    </p>
                  )}
                </Show>
                <Show when={value.reviews?.length}>
                  <Collapsible variant="ghost" data-slot="delegation-review">
                    <Collapsible.Trigger type="button">
                      <Collapsible.Arrow />
                      <span>{ctx.t("session.collaboration.reviewDetails")}</span>
                    </Collapsible.Trigger>
                    <Collapsible.Content>
                      <For each={value.reviews}>
                        {(review) => (
                          <p data-slot="delegation-review">
                            <code>{review.participantID}</code> · {review.verdict} ·{" "}
                            <code>{review.reviewedRevisionDigest}</code>
                            <Show when={review.summary}> · {review.summary}</Show>
                            <For each={review.findings}>
                              {(finding) => (
                                <span>
                                  {" "}
                                  · {finding.severity}: {finding.summary}
                                </span>
                              )}
                            </For>
                          </p>
                        )}
                      </For>
                    </Collapsible.Content>
                  </Collapsible>
                </Show>
                <ul data-slot="task-list">
                  <For each={value.participants}>
                    {(participant) => (
                      <li
                        data-slot="delegation-participant"
                        aria-current={taskSource()?.participantID === participant.id ? "true" : undefined}
                        aria-label={ctx.t("session.collaboration.participant", {
                          target: participant.target,
                          id: participant.id,
                        })}
                      >
                        <div data-slot="task-row-content">
                          <p>{participant.target}</p>
                          <div data-slot="task-metadata">
                            <Collapsible variant="ghost" data-slot="task-disclosure">
                              <Collapsible.Trigger type="button">
                                <Collapsible.Arrow />
                                {ctx.t("session.collaboration.details")}
                              </Collapsible.Trigger>
                              <Collapsible.Content>
                                <code>{participant.id}</code>
                                <Show when={participant.externalThreadID}>{(id) => <code>{id()}</code>}</Show>
                              </Collapsible.Content>
                            </Collapsible>
                            <span>{participant.provider}</span>
                            <span>{ctx.t(`session.collaboration.role.${participant.role}`)}</span>
                            <Badge>{ctx.t(`session.collaboration.status.${participant.phase}`)}</Badge>
                            <Show when={participant.runtimeStatus}>
                              {(status) => <span>{ctx.t(`session.collaboration.status.${status()}`)}</span>}
                            </Show>
                          </div>
                        </div>
                        <Show when={participant.childSessionID}>
                          {(id) => (
                            <div data-slot="task-form-actions">
                              <Button
                                type="button"
                                size="small"
                                variant="ghost"
                                disabled={!ctx.stores.views(props.session).ready()}
                                onClick={() =>
                                  props.openSession({
                                    source: props.session,
                                    target: ctx.sessions.target({ server: props.server, sessionID: id() }),
                                    interaction: "readonly",
                                  })
                                }
                              >
                                {ctx.t("session.collaboration.viewSession")}
                              </Button>
                              <Button
                                type="button"
                                size="small"
                                variant="ghost"
                                onClick={() =>
                                  ctx.sessions.open({
                                    source: props.session,
                                    server: props.server,
                                    sessionID: id(),
                                  })
                                }
                              >
                                {ctx.t("session.collaboration.openSession")}
                              </Button>
                            </div>
                          )}
                        </Show>
                        <For
                          each={receipts().filter(
                            (record) =>
                              record.receipt.delegationID === value.delegation.id &&
                              record.receipt.participantID === participant.id &&
                              !value.deliveries?.some(
                                (delivery) =>
                                  delivery.participantID === participant.id &&
                                  delivery.receipt?.inputID === record.receipt.inputID,
                              ),
                          )}
                        >
                          {(record) => (
                            <div data-slot="delegation-receipt">
                              <span>
                                {ctx.t("session.collaboration.attempt", {
                                  attempt: record.receipt.attempt,
                                  status: ctx.t(`session.collaboration.status.${record.status}`),
                                })}
                              </span>
                              <Show when={record.text !== undefined}>
                                <Collapsible variant="ghost" data-slot="delegation-result">
                                  <Collapsible.Trigger type="button">
                                    <Collapsible.Arrow />
                                    {ctx.t("session.collaboration.openToolOutput")}
                                  </Collapsible.Trigger>
                                  <Collapsible.Content>
                                    <pre>{record.text}</pre>
                                  </Collapsible.Content>
                                </Collapsible>
                              </Show>
                              <Button
                                type="button"
                                size="small"
                                variant="ghost"
                                onClick={() => openResult(record.source.id)}
                              >
                                {ctx.t("session.collaboration.openTool")}
                              </Button>
                            </div>
                          )}
                        </For>
                        <For each={value.deliveries?.filter((record) => record.participantID === participant.id)}>
                          {(record) => {
                            const source = () =>
                              record.source?.type === "tool"
                                ? record.source
                                : receipts().find(
                                    (local) =>
                                      local.receipt.delegationID === record.delegationID &&
                                      local.receipt.participantID === record.participantID &&
                                      local.receipt.inputID === record.receipt?.inputID,
                                  )?.source

                            return (
                              <div data-slot="delegation-receipt">
                                <span>
                                  {ctx.t("session.collaboration.attempt", {
                                    attempt: record.attempt,
                                    status: ctx.t(`session.collaboration.status.${record.status}`),
                                  })}
                                </span>
                                <Show when={!record.current}>
                                  <span>{ctx.t("session.collaboration.previousAttempt")}</span>
                                </Show>
                                <Collapsible variant="ghost" data-slot="task-disclosure">
                                  <Collapsible.Trigger type="button">
                                    <Collapsible.Arrow />
                                    {ctx.t("session.collaboration.details")}
                                  </Collapsible.Trigger>
                                  <Collapsible.Content>
                                    <Show when={record.parentTaskID}>{(id) => <code>{id()}</code>}</Show>
                                    <Show when={record.externalTurnID}>{(id) => <code>{id()}</code>}</Show>
                                  </Collapsible.Content>
                                </Collapsible>
                                <Show when={record.summary}>{(text) => <p>{text()}</p>}</Show>
                                <Button
                                  type="button"
                                  size="small"
                                  variant="ghost"
                                  disabled={!connected() || resultState(record)?.pending}
                                  onClick={() => void readResult(record)}
                                >
                                  {ctx.t("session.collaboration.openResult")}
                                </Button>
                                <Show when={source()}>
                                  {(source) => (
                                    <Button
                                      type="button"
                                      size="small"
                                      variant="ghost"
                                      onClick={() => openResult(source().id)}
                                    >
                                      {ctx.t("session.collaboration.openTool")}
                                    </Button>
                                  )}
                                </Show>
                                <Show when={resultState(record)?.text !== undefined}>
                                  <pre data-slot="delegation-full-result">{resultState(record)?.text}</pre>
                                </Show>
                                <Show when={resultState(record)?.error}>
                                  {(error) => (
                                    <p role="alert" data-slot="task-error">
                                      {error()}
                                    </p>
                                  )}
                                </Show>
                                <Show
                                  when={
                                    record.current &&
                                    record.provider === "internal" &&
                                    ["failed", "cancelled", "recovery_required"].includes(record.status)
                                  }
                                >
                                  <Button
                                    type="button"
                                    size="small"
                                    variant="ghost"
                                    disabled={!connected() || !!controlPending()}
                                    onClick={() =>
                                      void control({
                                        action: "retry",
                                        value,
                                        participantID: record.participantID,
                                        turnID: record.turnID,
                                      })
                                    }
                                  >
                                    {ctx.t("session.collaboration.retry")}
                                  </Button>
                                </Show>
                              </div>
                            )
                          }}
                        </For>
                      </li>
                    )}
                  </For>
                </ul>
                <For each={value.turns}>
                  {(turn) => (
                    <div data-slot="delegation-turn">
                      <span>
                        {ctx.t("session.collaboration.dispatch", {
                          seq: turn.seq,
                          kind: ctx.t(`session.collaboration.kind.${turn.kind}`),
                          status: ctx.t(`session.collaboration.status.${turn.status}`),
                        })}
                      </span>
                      <Collapsible variant="ghost" data-slot="task-disclosure">
                        <Collapsible.Trigger type="button">
                          <Collapsible.Arrow />
                          {ctx.t("session.collaboration.details")}
                        </Collapsible.Trigger>
                        <Collapsible.Content>
                          <code>{turn.id}</code>
                        </Collapsible.Content>
                      </Collapsible>
                      <Show when={turn.promptSummary}>{(summary) => <p>{summary()}</p>}</Show>
                    </div>
                  )}
                </For>
                <div data-slot="task-form-actions">
                  <Show when={value.delegation.status === "running"}>
                    <Button
                      type="button"
                      size="small"
                      variant="ghost"
                      disabled={!connected() || !!controlPending()}
                      onClick={() => void control({ action: "interrupt", value })}
                    >
                      {ctx.t("session.collaboration.interrupt")}
                    </Button>
                  </Show>
                  <Show when={value.delegation.status === "recovery_required"}>
                    <Button
                      type="button"
                      size="small"
                      variant="ghost"
                      disabled={!connected() || !!controlPending()}
                      onClick={() => void control({ action: "reconcile", value })}
                    >
                      {ctx.t("session.collaboration.reconcile")}
                    </Button>
                  </Show>
                  <Show when={!["archived", "completed", "cancelled"].includes(value.delegation.status)}>
                    <Button
                      type="button"
                      size="small"
                      variant="ghost"
                      disabled={!connected() || !!controlPending()}
                      onClick={() => void control({ action: "close", value })}
                    >
                      {ctx.t("session.collaboration.close")}
                    </Button>
                  </Show>
                </div>
              </article>
            )}
          </For>
        )}
      </Show>
      <Show when={props.server.data.session.message.more(targetID())}>
        <div data-slot="collaboration-history">
          <p data-slot="task-progress">{ctx.t("session.collaboration.history")}</p>
          <Button
            type="button"
            size="small"
            variant="ghost"
            disabled={!connected() || props.server.data.session.message.loading(targetID())}
            onClick={() => void loadHistory()}
          >
            {ctx.t("session.collaboration.loadHistory")}
          </Button>
        </div>
      </Show>
      <Show when={!props.childrenOnly}>
        <div data-slot="session-content-sources">
          <Button
            type="button"
            size="small"
            variant="ghost"
            disabled={!ctx.stores.views(props.session).ready()}
            onClick={() =>
              ctx.dialogs.open((dialog) => (
                <Dialog>
                  <DialogHeader>
                    <DialogTitleGroup
                      title={ctx.t("session.content.openSessions")}
                      description={ctx.t("session.content.openSessionsHint")}
                    />
                  </DialogHeader>
                  <DialogBody>
                    <List
                      class="flex-1 px-3 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
                      search={{ placeholder: ctx.t("common.search.placeholder"), autofocus: true }}
                      items={openRoots().map((session) => ({
                        session,
                        title: session.server.data.session.get(session.id)?.title ?? session.id,
                        server: session.server.name,
                      }))}
                      key={(item) => item.session.key}
                      filterKeys={["title", "server", "session.id"]}
                      groupBy={(item) => item.server}
                      emptyMessage={openRoots().length ? undefined : ctx.t("session.content.empty")}
                      onSelect={(item) => {
                        if (!item) return
                        dialog.close()
                        props.openSession({
                          source: props.session,
                          target: ctx.sessions.target({ server: item.session.server, sessionID: item.session.id }),
                          interaction:
                            ctx.stores
                              .views(props.session)
                              .value?.targets.find(
                                (binding) =>
                                  binding.serverID === item.session.server.id && binding.sessionID === item.session.id,
                              )?.interaction ??
                            (item.session.server.data.session.get(item.session.id)?.parentID
                              ? "readonly"
                              : "interactive"),
                        })
                      }}
                    >
                      {(item) => <span class="min-w-0 flex-1 truncate text-start font-normal">{item.title}</span>}
                    </List>
                  </DialogBody>
                </Dialog>
              ))
            }
          >
            {ctx.t("session.content.attach")}
          </Button>
          <Show when={!ctx.stores.views(props.session).ready()}>
            <p data-slot="task-progress" role="status">
              {ctx.t("session.content.loading")}
            </p>
          </Show>
        </div>
      </Show>
    </section>
  )
}

export default DelegationPanel
