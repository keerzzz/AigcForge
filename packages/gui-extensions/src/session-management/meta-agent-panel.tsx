import type { MetaAgentFactCategory, SessionControllerSource, ModelSelection } from "@omnixa/client/promise"
import { Button } from "@omnixa/ui/button"
import { Collapsible } from "@omnixa/ui/collapsible"
import { Icon } from "@omnixa/ui/icon"
import { IconButton } from "@omnixa/ui/icon-button"
import { Select } from "@omnixa/ui/select"
import { TextField } from "@omnixa/ui/text-field"
import { errorMessage } from "@omnixa/util/error"
import { For, Show, createMemo, onCleanup } from "solid-js"
import {
  createKeyed,
  useExtension,
  type MountedSession,
  type ServerRef,
  type SessionScreen,
  type SessionTargetRef,
} from "../sdk"
import { MetaCoordination } from "./meta-coordination"
import { MetaSchedule } from "./meta-schedule"
import { MetaGoals } from "./meta-goals"
import { MetaCommunication } from "./meta-communication"
import type SessionManagement from "./index"

type Props = {
  session: MountedSession
  screen: SessionScreen
  active: boolean
  pendingAgent?: (serverID: string, sessionID: string) => string | undefined
  onBack?: () => void
  openSource: (input: { sessionID: string; source: SessionControllerSource; server?: ServerRef }) => void
  openSession: (input: {
    source: MountedSession
    target: SessionTargetRef
    interaction: "interactive" | "readonly"
  }) => void
}

type MetaState = {
  loading: boolean
  readError: string
  error: string
  keyword: string | undefined
  category: MetaAgentFactCategory | undefined
  categoryEdited: boolean
  removal: string
  pending: boolean
  operation: symbol | undefined
  acknowledged: string
}

export function MetaAgentPanel(props: Props) {
  const ctx = useExtension<typeof SessionManagement>()

  const target = createMemo(() => {
    const saved = ctx.stores.meta(props.session).value?.target
    const server = ctx.servers.get(saved?.serverID ?? props.session.server.id)

    return server ? ctx.sessions.target({ server, sessionID: saved?.sessionID ?? props.session.id }) : undefined
  })

  return (
    <Show when={props.session.key} keyed>
      {(_key) => (
        <Show
          when={ctx.stores.meta(props.session).value}
          fallback={<p role="status">{ctx.t("session.meta.loading")}</p>}
        >
          <Show
            when={target()}
            keyed
            fallback={
              <p role="status">
                {ctx.t("session.content.serverUnavailable", {
                  server: ctx.stores.meta(props.session).value?.target?.serverID ?? props.session.server.id,
                })}
              </p>
            }
          >
            {(target) => <MetaAgentContent {...props} target={target} />}
          </Show>
        </Show>
      )}
    </Show>
  )
}

function MetaAgentContent(props: Props & { target: SessionTargetRef }) {
  const ctx = useExtension<typeof SessionManagement>()
  const data = () => props.target.server.data
  const stored = ctx.stores.meta(props.session)
  const lifecycle = { active: true, read: 0 }

  const [state, write] = ctx.storage.memory<MetaState>(`meta.${props.target.key}`, {
    initial: {
      loading: false,
      readError: "",
      error: "",
      keyword: undefined,
      category: undefined,
      categoryEdited: false,
      removal: "",
      pending: false,
      operation: undefined,
      acknowledged: "",
    },
  })

  const setState = (change: Partial<MetaState>) =>
    write((draft) => {
      Object.assign(draft, change)
    })

  const keyword = () => state.keyword ?? stored.value?.keyword ?? ""
  const category = () => (state.categoryEdited ? state.category : stored.value?.category)
  const error = () => state.error || state.readError

  const owner = createMemo(
    () => ({
      client: props.target.server.client,
      data: props.target.server.data,
      connected: props.target.server.connected,
      attempt: props.target.server.attempt,
      serverID: props.target.server.id,
      sessionID: props.target.id,
      directory: props.target.location?.directory,
      workspaceID: props.target.location?.workspaceID,
      location: JSON.stringify(props.target.location),
    }),
    undefined,
    {
      equals: (prior, next) =>
        prior?.client === next.client &&
        prior?.connected === next.connected &&
        prior?.attempt === next.attempt &&
        prior?.sessionID === next.sessionID &&
        prior?.directory === next.directory &&
        prior?.workspaceID === next.workspaceID,
    },
  )

  const current = (value: ReturnType<typeof owner>) =>
    !ctx.signal.aborted && lifecycle.active && props.active && owner() === value

  const mutationCurrent = (value: ReturnType<typeof owner>, token: symbol) => {
    const server = ctx.servers.get(value.serverID)

    return (
      state.operation === token &&
      server?.client === value.client &&
      server.attempt === value.attempt &&
      server.data.session.get(value.sessionID)?.location.directory === value.directory &&
      JSON.stringify(server.data.session.get(value.sessionID)?.location) === value.location
    )
  }

  const meta = () => data().session.meta.get(props.target.id)
  const facts = () => data().session.projectMemory.list(props.target.id)
  const controller = () => meta()?.controller ?? data().session.get(props.target.id)?.controller

  const modelLabel = (model: ModelSelection) => {
    if (!("type" in model)) return `${model.providerID}/${model.id}`

    const read = data().location.model.group.definition.list(props.target.location)
    const group = read?.effective.find((group) => group.groupID === model.groupID)
    const unavailable = group ? group.unavailable : read ? "missing" : undefined
    const name = group?.definition?.name || model.groupID

    return unavailable
      ? ctx.t("session.meta.modelGroupUnavailable", {
          name,
          reason: ctx.t(`session.meta.modelGroup.${unavailable}`),
        })
      : ctx.t("session.meta.modelGroup", { name })
  }

  const modelVariant = (model: ModelSelection) => ("type" in model ? undefined : model.variant)

  const capable = () => {
    const pending = props.pendingAgent?.(props.target.server.id, props.target.id)
    const identity = data().session.identity.get(props.target.id)

    return (!pending || pending === identity?.agent) && identity?.coordination?.available === true
  }

  const child = createMemo(() => {
    const value = controller()

    return value?.kind === "child" ? value : undefined
  })

  const categories = () =>
    ([undefined, "code_trap", "protocol", "api", "workflow"] as const).map((value) => ({
      value,
      label: value === undefined ? ctx.t("session.meta.category.all") : ctx.t(`session.meta.category.${value}`),
    }))

  async function load() {
    if (ctx.signal.aborted || !lifecycle.active || !props.active || !props.target.server.connected || !stored.value)
      return
    const value = owner()
    const read = ++lifecycle.read
    setState({ loading: true, readError: "" })

    try {
      data().session.meta.invalidate(value.sessionID)
      data().session.projectMemory.invalidate(value.sessionID)
      await Promise.all([
        data().session.meta.sync(value.sessionID),
        data().session.identity.sync(value.sessionID),
        data().session.task.operation.sync(value.sessionID),
        data()
          .location.model.group.definition.sync(props.target.location)
          .catch(() => undefined),
        data().session.projectMemory.sync(value.sessionID, {
          category: category(),
          keyword: keyword().trim() || undefined,
        }),
      ])

      if (!current(value) || read !== lifecycle.read) return

      // The Meta roster contains identities and roles; each saved Session owns its controller and outcome.
      const sessions = await Promise.allSettled(
        [...new Set([value.sessionID, ...(meta()?.sessions ?? []).map((attached) => attached.sessionID)])].map(
          (sessionID) => value.data.session.readback(sessionID),
        ),
      )

      if (!current(value) || read !== lifecycle.read) return
      const failed = sessions.find((session) => session.status === "rejected")

      if (failed?.status === "rejected")
        setState({ readError: errorMessage(failed.reason, ctx.t("session.tasks.error.unknown")) })
    } catch (error) {
      if (current(value) && read === lifecycle.read)
        setState({ readError: errorMessage(error, ctx.t("session.tasks.error.unknown")) })
    } finally {
      if (current(value) && read === lifecycle.read) setState({ loading: false })
    }
  }

  async function remove() {
    if (ctx.signal.aborted || !state.removal || state.pending || !props.active || !props.target.server.connected) return
    const value = owner()
    const id = state.removal
    const token = Symbol()
    setState({ pending: true, operation: token, error: "", acknowledged: "" })

    try {
      await data().session.projectMemory.remove({ sessionID: value.sessionID, id })

      if (!mutationCurrent(value, token)) return
      setState({ acknowledged: id, removal: "" })

      if (lifecycle.active && props.active) await load()
    } catch (error) {
      if (mutationCurrent(value, token)) setState({ error: errorMessage(error, ctx.t("session.tasks.error.unknown")) })
    } finally {
      if (state.operation === token) setState({ pending: false, operation: undefined })
    }
  }

  // Reads follow the visible panel and the existing server generation; closing the view keeps mutation state.
  createKeyed(
    () => props.active && stored.value && owner(),
    (value) => {
      void load()
      onCleanup(
        value.data.listen(({ details }) => {
          if (details.type !== "session.step.ended" && details.type !== "session.usage.updated") return
          const sessionID = details.data.sessionID

          if (sessionID === value.sessionID || meta()?.sessions.some((session) => session.sessionID === sessionID))
            void load()
        }),
      )
    },
  )
  onCleanup(() => {
    lifecycle.active = false
    setState({ loading: false })
  })

  return (
    <Show when={props.active}>
      <section data-component="meta-agent-panel" aria-label={ctx.t("session.meta.advanced")}>
        <div data-slot="task-toolbar">
          <Show when={props.onBack}>
            <IconButton
              type="button"
              size="small"
              variant="ghost-muted"
              aria-label={ctx.t("session.taskDetails.back")}
              title={ctx.t("session.taskDetails.back")}
              icon={<Icon name="outline-arrow-left" size="small" />}
              onClick={() => props.onBack?.()}
            />
          </Show>
          <h3>{ctx.t("session.meta.advanced")}</h3>
          <Button
            type="button"
            size="small"
            variant="ghost"
            disabled={state.loading || state.pending || !props.target.server.connected}
            onClick={() => void load()}
          >
            {ctx.t("session.meta.refresh")}
          </Button>
        </div>
        <Show when={error()}>
          {(error) => (
            <p data-slot="task-error" role="alert">
              {error()}
            </p>
          )}
        </Show>
        <Show when={state.loading}>
          <p data-slot="task-progress">{ctx.t("session.meta.loading")}</p>
        </Show>
        <Show when={!props.target.server.connected}>
          <p data-slot="task-progress" role="status">
            {ctx.t("session.collaboration.status.disconnected")}
          </p>
        </Show>
        <MetaGoals session={props.session} target={props.target} active={props.active} capable={capable()} />
        <MetaCommunication
          session={props.session}
          target={props.target}
          active={props.active}
          capable={capable()}
          openSession={props.openSession}
        />
        <MetaSchedule session={props.session} target={props.target} active={props.active} capable={capable()} />
        <MetaCoordination
          session={props.session}
          target={props.target}
          screen={props.screen}
          active={props.active}
          capable={capable()}
          openSession={props.openSession}
        />
        <Collapsible variant="ghost" data-slot="meta-recorded-details">
          <Collapsible.Trigger type="button">
            <Collapsible.Arrow />
            <span>{ctx.t("session.collaboration.details")}</span>
          </Collapsible.Trigger>
          <Collapsible.Content class="min-w-0 pb-2">
            <Show when={controller()}>
              {(relation) => (
                <div data-slot="task-form-actions">
                  <span>{ctx.t("session.meta.root")}</span>
                  <code>{relation().rootSessionID}</code>
                  <Show when={relation().rootSessionID !== props.target.id}>
                    <Button
                      type="button"
                      size="small"
                      variant="ghost"
                      onClick={() =>
                        ctx.sessions.open({
                          source: props.session,
                          server: props.target.server,
                          sessionID: relation().rootSessionID,
                        })
                      }
                    >
                      {ctx.t("session.meta.openRoot")}
                    </Button>
                  </Show>
                </div>
              )}
            </Show>
            <Show when={child()}>
              {(relation) => (
                <MetaSource
                  source={relation().source}
                  sessionID={data().session.get(props.target.id)?.parentID}
                  open={(input) => props.openSource({ ...input, server: props.target.server })}
                />
              )}
            </Show>
            <Show when={meta()?.owner}>
              {(metaOwner) => (
                <>
                  <h4>{metaOwner().title}</h4>
                  <div data-slot="task-metadata">
                    <code>{metaOwner().id}</code>
                    <span>{metaOwner().agent}</span>
                    <span>{modelLabel(metaOwner().model)}</span>
                    <Show when={modelVariant(metaOwner().model)}>{(variant) => <span>{variant()}</span>}</Show>
                  </div>
                  <Show when={child()}>
                    {(controller) => (
                      <p>
                        {ctx.t("session.meta.executor")}: {controller().executor.agent} ·{" "}
                        {modelLabel(controller().executor.model)} · {controller().executor.source}
                      </p>
                    )}
                  </Show>
                  <Show when={meta()?.stats}>
                    {(stats) => (
                      <>
                        <p>{ctx.t("session.meta.recorded")}</p>
                        <dl data-slot="meta-statistics">
                          <dt>{ctx.t("session.meta.sessions")}</dt>
                          <dd>{stats().totalSessions}</dd>
                          <dt>{ctx.t("session.meta.totalTokens")}</dt>
                          <dd>
                            {stats().totalTokens?.toLocaleString(ctx.locale.locale()) ?? ctx.t("session.meta.unknown")}
                          </dd>
                          <dt>{ctx.t("session.meta.recordedTokens")}</dt>
                          <dd>{stats().recordedTokens.toLocaleString(ctx.locale.locale())}</dd>
                          <dt>{ctx.t("session.meta.unknownSessions")}</dt>
                          <dd>{stats().unknownTokenSessionCount}</dd>
                          <dt>{ctx.t("session.meta.steps")}</dt>
                          <dd>{stats().stepCount}</dd>
                          <dt>{ctx.t("session.meta.unknownSteps")}</dt>
                          <dd>{stats().unknownStepCount}</dd>
                          <dt>{ctx.t("session.meta.attemptCoverage")}</dt>
                          <dd>{ctx.t("session.meta.unknown")}</dd>
                        </dl>
                      </>
                    )}
                  </Show>
                  <ul data-slot="task-list">
                    <For
                      each={meta()?.sessions}
                      fallback={<p data-slot="task-empty">{ctx.t("session.meta.sessions.empty")}</p>}
                    >
                      {(attached) => {
                        const saved = () => data().session.get(attached.sessionID)

                        const relation = createMemo(() => {
                          const value = saved()?.controller

                          return value?.kind === "child" ? value : undefined
                        })

                        const status = () => {
                          const session = saved()

                          if (!session) return undefined

                          if (!props.target.server.connected) return "disconnected"

                          if (
                            (data().session.permission.list(session.id)?.length ?? 0) > 0 ||
                            (data().session.form.list(session.id)?.length ?? 0) > 0
                          )
                            return "waiting"

                          if (data().session.status(session.id) === "running") return "running"

                          if (session.time.archived !== undefined) return "archived"

                          if (session.outcome === "succeeded") return "completed"

                          if (session.outcome === "failed") return "failed"

                          if (session.outcome === "interrupted") return "cancelled"

                          return "idle"
                        }

                        return (
                          <li
                            data-slot="task-row"
                            aria-label={ctx.t("session.content.session", { id: attached.sessionID })}
                          >
                            <div data-slot="task-row-content">
                              <code>{attached.sessionID}</code>
                              <p>{ctx.t(`session.meta.role.${attached.role}`)}</p>
                              <Show when={status()}>
                                {(value) => (
                                  <p>
                                    {ctx.t("session.collaboration.sessionStatus", {
                                      status: ctx.t(`session.collaboration.status.${value()}`),
                                    })}
                                  </p>
                                )}
                              </Show>
                              <Show when={!saved()}>
                                <p data-slot="task-progress">
                                  {ctx.t(
                                    state.loading
                                      ? "session.collaboration.childLoading"
                                      : "session.collaboration.childUnavailable",
                                  )}
                                </p>
                              </Show>
                              <Show when={relation()}>
                                {(value) => (
                                  <>
                                    <div data-slot="task-metadata">
                                      <span>{ctx.t("session.meta.root")}</span>
                                      <code>{value().rootSessionID}</code>
                                    </div>
                                    <p>
                                      {ctx.t("session.meta.executor")}: {value().executor.agent} ·{" "}
                                      {modelLabel(value().executor.model)} · {value().executor.source}
                                    </p>
                                    <MetaSource
                                      source={value().source}
                                      sessionID={saved()?.parentID}
                                      open={(input) => props.openSource({ ...input, server: props.target.server })}
                                    />
                                  </>
                                )}
                              </Show>
                              <Show when={attached.resultSummary}>{(result) => <pre>{result()}</pre>}</Show>
                            </div>
                            <div data-slot="task-form-actions">
                              <Show when={saved()}>
                                <Button
                                  type="button"
                                  size="small"
                                  variant="ghost"
                                  onClick={() =>
                                    props.openSession({
                                      source: props.session,
                                      target: ctx.sessions.target({
                                        server: props.target.server,
                                        sessionID: attached.sessionID,
                                      }),
                                      interaction: saved()?.parentID ? "readonly" : "interactive",
                                    })
                                  }
                                >
                                  {ctx.t("session.collaboration.viewSession")}
                                </Button>
                              </Show>
                              <Button
                                type="button"
                                size="small"
                                variant="ghost"
                                onClick={() =>
                                  ctx.sessions.open({
                                    source: props.session,
                                    server: props.target.server,
                                    sessionID: attached.sessionID,
                                  })
                                }
                              >
                                {ctx.t("session.collaboration.openSession")}
                              </Button>
                            </div>
                          </li>
                        )
                      }}
                    </For>
                  </ul>
                </>
              )}
            </Show>
          </Collapsible.Content>
        </Collapsible>
        <section aria-label={ctx.t("session.meta.facts")}>
          <h4>{ctx.t("session.meta.facts")}</h4>
          <p>{ctx.t("session.meta.projectScope", { id: data().session.get(props.target.id)?.projectID ?? "" })}</p>
          <form
            data-slot="task-form-actions"
            onSubmit={(event) => {
              event.preventDefault()
              void load()
            }}
          >
            <TextField
              label={ctx.t("session.meta.search")}
              value={keyword()}
              onChange={(keyword) => {
                setState({ keyword })
                void stored.update((draft) => {
                  draft.keyword = keyword
                })
              }}
            />
            <Select
              aria-label={ctx.t("session.meta.category")}
              options={categories()}
              current={categories().find((item) => item.value === category())}
              value={(item) => item.value ?? "all"}
              label={(item) => item.label}
              onSelect={(item) => {
                if (!item) return
                setState({ category: item.value, categoryEdited: true })
                void stored.update((draft) => {
                  draft.category = item.value
                })
              }}
            />
            <Button type="submit" size="small" variant="ghost" disabled={state.loading || state.pending}>
              {ctx.t("session.meta.search")}
            </Button>
          </form>
          <Show when={state.acknowledged}>
            <p role="status">{ctx.t("session.meta.removed")}</p>
          </Show>
          <Show when={facts()}>
            {(items) => (
              <ul data-slot="task-list">
                <For each={items()} fallback={<p data-slot="task-empty">{ctx.t("session.meta.empty")}</p>}>
                  {(fact) => (
                    <li data-slot="task-row">
                      <div data-slot="task-row-content">
                        <p>{fact.content}</p>
                        <div data-slot="task-metadata">
                          <code>{fact.id}</code>
                          <span>{ctx.t(`session.meta.category.${fact.factCategory}`)}</span>
                          <code>{fact.metaAgentID}</code>
                          <Show when={fact.sourceStepID}>{(id) => <code>{id()}</code>}</Show>
                        </div>
                        <Show when={fact.sourceSessionID}>
                          {(id) => (
                            <Button
                              type="button"
                              size="small"
                              variant="ghost"
                              onClick={() =>
                                ctx.sessions.open({
                                  source: props.session,
                                  server: props.target.server,
                                  sessionID: id(),
                                })
                              }
                            >
                              {ctx.t("session.meta.openSource")}
                            </Button>
                          )}
                        </Show>
                      </div>
                      <Button
                        type="button"
                        size="small"
                        variant="ghost"
                        disabled={state.pending}
                        onClick={() => setState({ removal: fact.id })}
                      >
                        {ctx.t("session.tasks.remove")}
                      </Button>
                    </li>
                  )}
                </For>
              </ul>
            )}
          </Show>
          <Show when={state.removal}>
            <div data-slot="task-form-actions">
              <p>{ctx.t("session.meta.removeConfirm")}</p>
              <Button
                type="button"
                size="small"
                variant="contrast"
                disabled={state.pending}
                onClick={() => void remove()}
              >
                {ctx.t("session.meta.remove")}
              </Button>
              <Button type="button" size="small" variant="ghost" onClick={() => setState({ removal: "" })}>
                {ctx.t("session.tasks.cancel")}
              </Button>
            </div>
          </Show>
        </section>
      </section>
    </Show>
  )
}

function MetaSource(props: {
  source: SessionControllerSource
  sessionID: string | undefined
  open: Props["openSource"]
}) {
  const ctx = useExtension<typeof SessionManagement>()

  const fields = createMemo(() => {
    const source = props.source

    if (source.kind === "task")
      return [
        { label: "session.meta.source.delegation", value: source.delegationID },
        { label: "session.meta.source.participant", value: source.participantID },
      ]

    if (source.kind === "subagent")
      return [
        { label: "session.meta.source.assistant", value: source.assistantMessageID },
        { label: "session.meta.source.tool", value: source.toolCallID },
      ]

    return [
      { label: "session.meta.source.run", value: source.runID },
      { label: "session.meta.source.step", value: source.stepRunID },
      { label: "session.meta.source.input", value: source.inputID },
    ]
  })

  return (
    <div>
      <dl data-slot="meta-statistics">
        <dt>{ctx.t("session.meta.source")}</dt>
        <dd>{ctx.t(`session.collaboration.source.${props.source.kind}`)}</dd>
        <Show when={props.sessionID}>
          {(id) => (
            <>
              <dt>{ctx.t("session.meta.source.session")}</dt>
              <dd>
                <code>{id()}</code>
              </dd>
            </>
          )}
        </Show>
        <For each={fields()}>
          {(field) => (
            <>
              <dt>{ctx.t(field.label)}</dt>
              <dd>
                <code>{field.value}</code>
              </dd>
            </>
          )}
        </For>
      </dl>
      <Show when={!props.sessionID}>
        <p data-slot="task-progress">{ctx.t("session.meta.source.unavailable")}</p>
      </Show>
      <Button
        type="button"
        size="small"
        variant="ghost"
        disabled={!props.sessionID}
        onClick={() => {
          const sessionID = props.sessionID

          if (sessionID) props.open({ sessionID, source: props.source })
        }}
      >
        {ctx.t(`session.meta.openSource.${props.source.kind}`)}
      </Button>
    </div>
  )
}

export default MetaAgentPanel
