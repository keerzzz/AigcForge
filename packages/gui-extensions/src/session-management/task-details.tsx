import type { SessionTaskOperationInfo } from "@aigcfroge/client/promise"
import { Button } from "@aigcfroge/ui/button"
import { Collapsible } from "@aigcfroge/ui/collapsible"
import { Icon } from "@aigcfroge/ui/icon"
import { IconButton } from "@aigcfroge/ui/icon-button"
import { Badge } from "@aigcfroge/ui/badge"
import { Markdown } from "@aigcfroge/session-ui/markdown"
import { errorMessage } from "@aigcfroge/util/error"
import { For, Show, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import {
  createKeyed,
  createLatest,
  useExtension,
  type MountedSession,
  type SessionScreen,
  type SessionTargetRef,
} from "../sdk"
import type definition from "./index"
import type { CollaborationDraft } from "./panel-drafts"

type Props = {
  session: MountedSession
  screen: SessionScreen
  active: boolean
  pendingAgent?: (serverID: string, sessionID: string) => string | undefined
  binding: NonNullable<CollaborationDraft["task"]>
  openSession: (input: {
    source: MountedSession
    target: SessionTargetRef
    interaction: "interactive" | "readonly"
  }) => void
}

export function TaskDetails(props: Props) {
  return (
    <Show
      when={JSON.stringify([
        props.session.key,
        props.binding.serverID,
        props.binding.sourceSessionID,
        props.binding.taskID,
        props.binding.operationID,
      ])}
      keyed
    >
      {(_key) => <TaskDetailsContent {...props} />}
    </Show>
  )
}

function TaskDetailsContent(props: Props) {
  const ctx = useExtension<typeof definition>()

  const [state, setState] = createStore<{
    read: number
    selected: string | undefined
    result: string | undefined
    cancelling: string | undefined
    error: string
  }>({
    read: 0,
    selected: undefined,
    result: undefined,
    cancelling: undefined,
    error: "",
  })

  let live = true
  onCleanup(() => {
    live = false
  })

  const server = () => ctx.servers.get(props.binding.serverID)
  const data = () => server()?.data
  const sourceID = () => props.binding.sourceSessionID

  const operations = createMemo(() =>
    data()
      ?.session.task.operation.list(sourceID(), props.binding.taskID)
      ?.toSorted(
        (left, right) =>
          Number(left.createdAt) - Number(right.createdAt) || left.operationID.localeCompare(right.operationID),
      ),
  )

  const operationID = () => state.selected ?? props.binding.operationID ?? operations()?.at(-1)?.operationID

  const operation = () => {
    const id = operationID()

    return id ? data()?.session.task.operation.get(sourceID(), id) : undefined
  }

  const sourceAgent = createMemo(() => {
    const selected = operation()

    if (!selected) return

    return selected.source.type === "user_coordination" ? selected.selection.agent : selected.source.agent
  })

  const taskID = () => props.binding.taskID ?? operation()?.taskID
  const tasks = () => data()?.session.task.list(sourceID())
  const task = () => tasks()?.find((item) => item.id === taskID())
  const sourceInfo = () => data()?.session.get(sourceID())
  const title = () => task()?.content ?? operation()?.request.description ?? ctx.t("session.operation.title")

  const coordination = () => {
    const pending = props.pendingAgent?.(props.binding.serverID, sourceID())
    const identity = data()?.session.identity.get(sourceID())

    return (
      ctx.stores.display.value.meta &&
      (!pending || pending === identity?.agent) &&
      identity?.coordination?.available === true
    )
  }

  const owner = createMemo(
    () => {
      const current = server()

      if (!props.active || !current?.connected) return

      return {
        server: current,
        client: current.client,
        data: current.data,
        attempt: current.attempt,
        sourceID: sourceID(),
        location: JSON.stringify(sourceInfo()?.location),
        read: state.read,
      }
    },
    undefined,
    {
      equals: (previous, next) =>
        previous?.client === next?.client &&
        previous?.attempt === next?.attempt &&
        previous?.sourceID === next?.sourceID &&
        previous?.location === next?.location &&
        previous?.read === next?.read,
    },
  )

  const read = createLatest(owner, async (value, signal) => {
    if (!value.data.session.get(value.sourceID)) {
      await value.data.session.readback(value.sourceID)

      if (signal.aborted || ctx.signal.aborted) return
    }

    await Promise.all([
      value.data.session.task.sync(value.sourceID),
      value.data.session.task.operation.sync(value.sourceID),
      value.data.session.message.sync(value.sourceID),
      value.data.session.identity.sync(value.sourceID),
    ])

    if (signal.aborted || ctx.signal.aborted) return
  })

  // The shared Data owner folds SSE facts; only a visible detail requests their readback.
  createKeyed(
    () => owner(),
    (value) => {
      onCleanup(
        value.data.listen(({ details }) => {
          if (
            details.type !== "task.operation.reserved" &&
            details.type !== "task.operation.changed" &&
            details.type !== "task.updated" &&
            details.type !== "session.agent.selected"
          )
            return

          if (details.data.sessionID !== value.sourceID) return

          setState("read", (read) => read + 1)
        }),
      )
    },
  )

  const resultOwner = createMemo(() => {
    const current = owner()
    const selected = operation()

    if (
      !current ||
      selected?.result?.text !== undefined ||
      !selected?.result?.messageIDs?.length ||
      state.result !== selected.operationID
    )
      return

    return {
      owner: current,
      operationID: selected.operationID,
      result: selected.result,
      ids: selected.result.messageIDs,
    }
  })

  const resultRead = createLatest(resultOwner, async (value, signal) => {
    const messages = value.owner.data.session.message
    const sessionID = value.result.sessionID

    await value.owner.data.session.readback(sessionID)

    if (signal.aborted || ctx.signal.aborted) return
    await messages.sync(sessionID)

    if (signal.aborted || ctx.signal.aborted) return

    while (value.ids.some((id) => !messages.get(sessionID, id)) && messages.more(sessionID)) {
      await messages.loadMore(sessionID, { signal })

      if (signal.aborted || ctx.signal.aborted) return
    }
  })

  const resultMessages = createMemo(() => {
    const selected = operation()
    const result = selected?.result

    if (!selected || !result || state.result !== selected.operationID) return []

    return (result.messageIDs ?? []).flatMap((id) => {
      const message = data()?.session.message.get(result.sessionID, id)

      return message?.type === "assistant" ? [message] : []
    })
  })

  function openSession(sessionID: string, interaction: "interactive" | "readonly" = "readonly") {
    const current = server()

    if (!current) return

    props.openSession({
      source: props.session,
      target: ctx.sessions.target({ server: current, sessionID }),
      interaction,
    })
  }

  async function cancel(selected: SessionTaskOperationInfo) {
    const value = owner()

    if (!value || state.cancelling || selected.cancelIntent) return

    setState({ cancelling: selected.operationID, error: "" })

    try {
      await value.data.session.task.operation.cancel({
        sessionID: value.sourceID,
        operationID: selected.operationID,
      })

      if (!live || ctx.signal.aborted || server()?.client !== value.client || server()?.attempt !== value.attempt)
        return

      setState("read", (read) => read + 1)
    } catch (error) {
      if (!live || ctx.signal.aborted || server()?.client !== value.client || server()?.attempt !== value.attempt)
        return

      setState("error", errorMessage(error, ctx.t("session.tasks.error.unknown")))
    } finally {
      if (live && !ctx.signal.aborted) setState("cancelling", undefined)
    }
  }

  function time(value: SessionTaskOperationInfo["createdAt"]) {
    const date = new Date(value)

    return Number.isFinite(date.getTime()) ? date.toISOString() : ctx.t("session.meta.unknown")
  }

  return (
    <section
      data-component="session-delegation-panel"
      data-view="task-details"
      aria-label={ctx.t("session.taskDetails.title")}
    >
      <div data-slot="task-toolbar">
        <div class="flex min-w-0 items-center gap-2">
          <IconButton
            type="button"
            size="small"
            variant="ghost"
            icon={<Icon name="arrow-left" size="small" />}
            aria-label={ctx.t("session.taskDetails.back")}
            title={ctx.t("session.taskDetails.back")}
            onClick={() =>
              ctx.stores.collaboration(props.session).update((draft) => {
                draft.task = undefined
              })
            }
          />
          <h3>{ctx.t("session.taskDetails.title")}</h3>
        </div>
      </div>
      <p data-slot="task-detail-title">{title()}</p>
      <div data-slot="task-metadata">
        <Show when={task()}>
          {(item) => (
            <>
              <Badge data-status={item().status}>{ctx.t(`session.tasks.status.${item().status}`)}</Badge>
              <Badge>{ctx.t(`session.tasks.priority.${item().priority}`)}</Badge>
            </>
          )}
        </Show>
      </div>
      <div data-slot="task-form-actions">
        <Button type="button" size="small" variant="ghost" disabled={!server()} onClick={() => openSession(sourceID())}>
          {sourceInfo()?.title ?? sourceID()}
        </Button>
        <Button
          type="button"
          size="small"
          variant="ghost"
          disabled={!owner() || read.loading}
          onClick={() => {
            data()?.session.task.invalidate(sourceID())
            data()?.session.task.operation.invalidate(sourceID())
            setState("read", (read) => read + 1)
          }}
        >
          {ctx.t("session.tasks.reload")}
        </Button>
      </div>
      <Show when={!server()?.connected}>
        <p data-slot="task-progress" role="status">
          {ctx.t("session.tasks.offline")}
        </p>
      </Show>
      <Show when={read.loading}>
        <p data-slot="task-progress">{ctx.t("session.tasks.loading")}</p>
      </Show>
      <Show when={state.error || read.error || resultRead.error}>
        <p data-slot="task-error" role="alert">
          {state.error || errorMessage(read.error ?? resultRead.error, ctx.t("session.tasks.error.unknown"))}
        </p>
      </Show>
      <Show when={!read.loading && taskID() && tasks() && !task()}>
        <p data-slot="task-empty">{ctx.t("session.taskDetails.taskMissing")}</p>
      </Show>

      <section aria-label={ctx.t("session.taskDetails.operations")}>
        <Show when={operation()}>
          {(selected) => (
            <article
              data-slot="delegation-row"
              aria-label={ctx.t("session.operation.item", { id: selected().operationID })}
            >
              <div data-slot="task-metadata">
                <span>{ctx.t(`session.operation.phase.${selected().phase}`)}</span>
                <span>{sourceAgent()}</span>
                <span>{ctx.t(`session.operation.source.${selected().source.type}`)}</span>
                <Show when={selected().sourceSettlement}>
                  {(settlement) => <span>{ctx.t(`session.operation.taskUpdate.${settlement()}`)}</span>}
                </Show>
              </div>
              <Show when={selected().error}>
                {(error) => (
                  <p data-slot="task-error" role="status">
                    {error().message}
                  </p>
                )}
              </Show>
              <Show when={selected().result}>
                {(result) => (
                  <section aria-label={ctx.t("session.operation.result")}>
                    <h4 data-slot="collaboration-group-heading">{ctx.t("session.operation.result")}</h4>
                    <Button type="button" size="small" variant="ghost" onClick={() => openSession(result().sessionID)}>
                      {ctx.t("session.collaboration.openResult")}
                    </Button>
                    <Show
                      when={result().text !== undefined}
                      fallback={
                        <>
                          <Button
                            type="button"
                            size="small"
                            variant="ghost"
                            disabled={resultRead.loading || !owner()}
                            onClick={() => setState("result", selected().operationID)}
                          >
                            {ctx.t("session.operation.readResultText")}
                          </Button>
                          <Show when={state.result === selected().operationID}>
                            <Show when={resultRead.loading}>
                              <p data-slot="task-progress">{ctx.t("session.operation.resultLoading")}</p>
                            </Show>
                            <Show when={!resultRead.loading && !resultMessages().length}>
                              <p data-slot="task-empty">{ctx.t("session.operation.resultUnavailable")}</p>
                            </Show>
                            <For each={resultMessages()}>
                              {(message) => (
                                <Markdown
                                  text={message.content
                                    .filter((content) => content.type === "text")
                                    .map((content) => content.text)
                                    .join("\n")}
                                />
                              )}
                            </For>
                          </Show>
                        </>
                      }
                    >
                      <Markdown text={result().text ?? ""} />
                    </Show>
                  </section>
                )}
              </Show>
              <div data-slot="task-form-actions">
                <Show when={selected().targetSessionID}>
                  {(id) => (
                    <>
                      <Button
                        type="button"
                        size="small"
                        variant="ghost"
                        onClick={() => openSession(id(), "interactive")}
                      >
                        {data()?.session.get(id())?.title ?? id()}
                      </Button>
                      <Button
                        type="button"
                        size="small"
                        variant="ghost"
                        onClick={() => ctx.sessions.open({ source: props.session, server: server(), sessionID: id() })}
                      >
                        {ctx.t("session.collaboration.openSession")}
                      </Button>
                    </>
                  )}
                </Show>
                <Show when={selected().source.type === "model_tool"}>
                  <Button
                    type="button"
                    size="small"
                    variant="ghost"
                    onClick={() => {
                      const source = selected().source

                      if (source.type === "model_tool")
                        ctx.sessions.open({
                          source: props.session,
                          server: server(),
                          sessionID: source.sessionID,
                          reveal: source.id,
                        })
                    }}
                  >
                    {ctx.t("session.collaboration.openTool")}
                  </Button>
                </Show>
                <Show
                  when={
                    owner() &&
                    !selected().cancelIntent &&
                    !["settled", "failed", "cancelled", "superseded"].includes(selected().phase)
                  }
                >
                  <Button
                    type="button"
                    size="small"
                    variant="ghost"
                    disabled={!!state.cancelling}
                    onClick={() => void cancel(selected())}
                  >
                    {ctx.t("session.operation.cancel")}
                  </Button>
                </Show>
                <Show when={selected().cancelIntent}>
                  <span>{ctx.t("session.operation.cancelRequested")}</span>
                </Show>
                <Show when={coordination()}>
                  <Button
                    type="button"
                    size="small"
                    variant="ghost"
                    onClick={async () => {
                      await ctx.stores.meta(props.session).update((draft) => {
                        draft.target = { serverID: props.binding.serverID, sessionID: sourceID() }
                        draft.taskID = taskID()
                        draft.workerSessionID = selected().targetSessionID
                      })
                      await ctx.stores.collaboration(props.session).update((draft) => {
                        draft.view = "advanced"
                      })

                      if (ctx.signal.aborted) return
                      ctx.layout.open(`${ctx.id}:collaborations`, props.session)
                    }}
                  >
                    {ctx.t("session.operation.followup")}
                  </Button>
                </Show>
              </div>
              <Collapsible variant="ghost" data-slot="task-disclosure">
                <Collapsible.Trigger type="button">
                  <Collapsible.Arrow />
                  <span>{ctx.t("session.taskDetails.technical")}</span>
                </Collapsible.Trigger>
                <Collapsible.Content>
                  <div data-slot="task-metadata">
                    <code>{taskID()}</code>
                    <code>{selected().operationID}</code>
                  </div>
                  <Show when={selected().error}>
                    {(error) => (
                      <p data-slot="task-metadata">
                        <code>{error().code}</code>
                      </p>
                    )}
                  </Show>
                  <p data-slot="task-metadata">
                    {ctx.t("session.operation.created", { time: time(selected().createdAt) })}
                  </p>
                  <p data-slot="task-metadata">
                    {ctx.t("session.operation.updated", { time: time(selected().updatedAt) })}
                  </p>
                  <Show when={selected().predecessorID}>
                    {(id) => (
                      <div data-slot="task-form-actions">
                        <span>{ctx.t("session.operation.predecessor")}</span>
                        <Button
                          type="button"
                          size="small"
                          variant="ghost"
                          onClick={() => setState({ selected: id(), result: undefined, error: "" })}
                        >
                          <code>{id()}</code>
                        </Button>
                      </div>
                    )}
                  </Show>
                  <ol data-slot="operation-flow" aria-label={ctx.t("session.operation.flow")}>
                    <li>
                      <span>{ctx.t("session.operation.input")}</span>
                      <code>{selected().inputID}</code>
                    </li>
                    <Show when={selected().admission}>
                      {(admission) => (
                        <li>
                          <span>{ctx.t("session.operation.admitted")}</span>
                          <code>{admission().eventID}</code>
                        </li>
                      )}
                    </Show>
                    <Show when={selected().result}>
                      {(result) => (
                        <li>
                          <span>{ctx.t("session.operation.result")}</span>
                          <code>{result().resultEventID ?? result().inputID}</code>
                        </li>
                      )}
                    </Show>
                    <Show when={selected().sourceSettlement}>
                      {(settlement) => (
                        <li>
                          <span>{ctx.t("session.operation.sourceTaskUpdate")}</span>
                          <span>{ctx.t(`session.operation.taskUpdate.${settlement()}`)}</span>
                        </li>
                      )}
                    </Show>
                  </ol>
                  <Collapsible variant="ghost" data-slot="delegation-result">
                    <Collapsible.Trigger type="button">
                      <Collapsible.Arrow />
                      <span>{ctx.t("session.operation.input")}</span>
                    </Collapsible.Trigger>
                    <Collapsible.Content class="min-w-0 pb-2">
                      <div data-slot="task-metadata">
                        <code>{selected().inputID}</code>
                        <span>{ctx.t(`session.operation.delivery.${selected().request.delivery}`)}</span>
                      </div>
                      <pre>{selected().request.prompt}</pre>
                    </Collapsible.Content>
                  </Collapsible>
                  <Show when={selected().result}>
                    {(result) => (
                      <>
                        <div data-slot="task-metadata">
                          <code>{result().sessionID}</code>
                          <code>{result().inputID}</code>
                        </div>
                        <Show when={result().resultEventID}>
                          {(id) => (
                            <p data-slot="task-metadata">
                              <code>{id()}</code>
                            </p>
                          )}
                        </Show>
                        <Show when={result().sharedInputs?.length}>
                          <div data-slot="task-metadata">
                            <span>{ctx.t("session.operation.sharedInputs")}</span>
                            <For each={result().sharedInputs}>{(id) => <code>{id}</code>}</For>
                          </div>
                        </Show>
                      </>
                    )}
                  </Show>
                  <Show when={selected().result}>
                    <section aria-label={ctx.t("session.operation.consumers")}>
                      <h4 data-slot="collaboration-group-heading">{ctx.t("session.operation.consumers")}</h4>
                      <ul data-slot="task-list">
                        <For
                          each={selected().consumers}
                          fallback={<p data-slot="task-empty">{ctx.t("session.operation.noConsumers")}</p>}
                        >
                          {(consumer) => (
                            <li data-slot="task-row">
                              <div data-slot="task-row-content">
                                <Button
                                  type="button"
                                  size="small"
                                  variant="ghost"
                                  disabled={!server() || data()?.session.deleted(consumer.consumerSessionID)}
                                  onClick={() =>
                                    ctx.sessions.open({
                                      source: props.session,
                                      server: server(),
                                      sessionID: consumer.consumerSessionID,
                                      reveal: consumer.assistantMessageID,
                                    })
                                  }
                                >
                                  {ctx.t("session.operation.consumerStep")}
                                </Button>
                                <div data-slot="task-metadata">
                                  <code>{consumer.consumerSessionID}</code>
                                  <code>{consumer.assistantMessageID}</code>
                                  <code>{consumer.eventID}</code>
                                </div>
                                <p data-slot="task-metadata">{ctx.t("session.operation.resultDigest")}</p>
                                <code>{consumer.resultDigest}</code>
                              </div>
                            </li>
                          )}
                        </For>
                      </ul>
                    </section>
                  </Show>
                </Collapsible.Content>
              </Collapsible>
            </article>
          )}
        </Show>
      </section>
      <Collapsible variant="ghost" data-slot="task-disclosure">
        <Collapsible.Trigger type="button">
          <Collapsible.Arrow />
          <span>{ctx.t("session.taskDetails.operations")}</span>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <Show
            when={operations()?.length}
            fallback={<p data-slot="task-empty">{ctx.t("session.taskDetails.noOperations")}</p>}
          >
            <ul data-slot="task-list">
              <For each={operations()}>
                {(item) => (
                  <li data-slot="delegation-turn">
                    <Button
                      type="button"
                      size="small"
                      variant="ghost"
                      aria-pressed={operationID() === item.operationID}
                      onClick={() => setState({ selected: item.operationID, result: undefined, error: "" })}
                    >
                      {ctx.t(`session.operation.phase.${item.phase}`)}
                      <span>{ctx.t(`session.operation.source.${item.source.type}`)}</span>
                      <time dateTime={time(item.createdAt)}>{time(item.createdAt)}</time>
                    </Button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Collapsible.Content>
      </Collapsible>
      <Collapsible variant="ghost" data-slot="task-disclosure">
        <Collapsible.Trigger type="button">
          <Collapsible.Arrow />
          <span>{ctx.t("session.taskDetails.dependencies")}</span>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <Show
            when={task()?.dependsOn?.length}
            fallback={<p data-slot="task-empty">{ctx.t("session.taskDetails.noDependencies")}</p>}
          >
            <ul data-slot="task-list">
              <For each={task()?.dependsOn}>
                {(id) => (
                  <li data-slot="task-dependency">
                    <Button
                      type="button"
                      size="small"
                      variant="ghost"
                      disabled={!server()}
                      onClick={() => {
                        const current = server()

                        if (current)
                          ctx.sessions.openTask({
                            source: props.session,
                            target: { server: current, sourceSessionID: sourceID(), taskID: id },
                          })
                      }}
                    >
                      {tasks()?.find((item) => item.id === id)?.content ?? id}
                    </Button>
                    <Icon name="outline-arrow-right" size="small" />
                    <span>{title()}</span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Collapsible.Content>
      </Collapsible>
      <Show when={task()?.outputDigest}>
        {(text) => (
          <Collapsible variant="ghost" data-slot="delegation-result">
            <Collapsible.Trigger type="button">
              <Collapsible.Arrow />
              <span>{ctx.t("session.tasks.savedOutput")}</span>
            </Collapsible.Trigger>
            <Collapsible.Content class="min-w-0 pb-2">
              <Markdown text={text()} />
            </Collapsible.Content>
          </Collapsible>
        )}
      </Show>
    </section>
  )
}
