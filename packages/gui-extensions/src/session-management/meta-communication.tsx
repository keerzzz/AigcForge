import type { SessionCommunicationMessage } from "@aigcfroge/client/promise"
import { SessionCommunication } from "@aigcfroge/schema/session-communication"
import { Button } from "@aigcfroge/ui/button"
import { Collapsible } from "@aigcfroge/ui/collapsible"
import { Checkbox } from "@aigcfroge/ui/checkbox"
import { Select } from "@aigcfroge/ui/select"
import { TextField } from "@aigcfroge/ui/text-field"
import { errorMessage } from "@aigcfroge/util/error"
import { Option, Schema } from "effect"
import { For, Show, createMemo, onCleanup } from "solid-js"
import { unwrap } from "solid-js/store"
import { createLatest, useExtension, type MountedSession, type SessionTargetRef } from "../sdk"
import type definition from "./index"

class SendRequest extends Schema.Class<SendRequest>("SessionManagement.CommunicationSendRequest")({
  kind: Schema.Literal("send"),
  payload: Schema.toEncoded(SessionCommunication.Send),
}) {}

class ReplyRequest extends Schema.Class<ReplyRequest>("SessionManagement.CommunicationReplyRequest")({
  kind: Schema.Literal("reply"),
  communicationID: Schema.toEncoded(SessionCommunication.ID),
  payload: Schema.toEncoded(SessionCommunication.Reply),
}) {}

const Request = Schema.Union([Schema.Struct(SendRequest.fields), Schema.Struct(ReplyRequest.fields)])

const decodeRequest = Schema.decodeUnknownOption(Request)

class CommunicationDraft extends Schema.Class<CommunicationDraft>("SessionManagement.CommunicationDraft")({
  selected: Schema.optional(Schema.String),
  open: Schema.Boolean,
  replyTo: Schema.optional(Schema.String),
  targetSessionID: Schema.String,
  contentKind: Schema.Literals(["text", "session"]),
  text: Schema.String,
  contentSessionID: Schema.String,
  scope: Schema.Literals(["reference", "output", "full"]),
  delivery: Schema.Literals(["queue", "steer"]),
  trigger: Schema.Boolean,
  request: Schema.optional(Request),
  acknowledged: Schema.optional(Schema.String),
}) {}

type State = {
  read: number
  error: string
  pending: boolean
  token: symbol | undefined
  pendingOwner: (() => boolean) | undefined
  paging: boolean
  pageToken: symbol | undefined
  pageOwner: (() => boolean) | undefined
}

export function MetaCommunication(props: {
  session: MountedSession
  target: SessionTargetRef
  active: boolean
  capable?: boolean
  openSession: (input: {
    source: MountedSession
    target: SessionTargetRef
    interaction: "interactive" | "readonly"
  }) => void
}) {
  const ctx = useExtension<typeof definition>()

  const stored = ctx.storage.store(`communication.${props.target.key}`, {
    schema: Schema.Struct(CommunicationDraft.fields),
    initial: {
      open: false,
      targetSessionID: "",
      contentKind: "text",
      text: "",
      contentSessionID: props.target.id,
      scope: "reference",
      delivery: "queue",
      trigger: true,
    },
  })

  const [state, write] = ctx.storage.memory<State>(`communication.${props.target.key}`, {
    initial: {
      read: 0,
      error: "",
      pending: false,
      token: undefined,
      pendingOwner: undefined,
      paging: false,
      pageToken: undefined,
      pageOwner: undefined,
    },
  })

  const lifecycle = { active: true }
  onCleanup(() => {
    lifecycle.active = false
  })

  const setState = (change: Partial<State>) =>
    write((draft) => {
      Object.assign(draft, change)
    })

  const data = () => props.target.server.data
  const draft = () => stored.value
  const selectedID = () => ctx.stores.meta(props.session).value?.communicationID ?? draft()?.selected

  const owner = createMemo(
    () =>
      props.active && props.target.server.connected && draft() && props.target.location
        ? {
            key: props.target.key,
            sessionID: props.target.id,
            serverID: props.target.server.id,
            client: props.target.server.client,
            data: props.target.server.data,
            attempt: props.target.server.attempt,
            directory: props.target.location.directory,
            workspace: props.target.location.workspaceID,
            location: JSON.stringify(props.target.location),
            agent: data().session.get(props.target.id)?.agent,
            selected: selectedID(),
            version: data().session.communication.version(props.target.id),
            read: state.read,
          }
        : undefined,
    undefined,
    {
      equals: (previous, next) =>
        previous?.key === next?.key &&
        previous?.client === next?.client &&
        previous?.attempt === next?.attempt &&
        previous?.location === next?.location &&
        previous?.agent === next?.agent &&
        previous?.selected === next?.selected &&
        previous?.version === next?.version &&
        previous?.read === next?.read,
    },
  )

  const read = createLatest(owner, async (value, signal) => {
    await Promise.all([
      value.data.session.communication.sync(value.sessionID),
      value.data.session.identity.sync(value.sessionID),
    ])

    if (signal.aborted || ctx.signal.aborted) return
    const id = value.selected ?? draft()?.request?.payload.id

    if (id && !value.data.session.communication.get(value.sessionID, id))
      await value.data.session.communication.readback(value.sessionID, id)

    if (signal.aborted || ctx.signal.aborted) return
  })

  const messages = () => data().session.communication.list(props.target.id)
  const capability = () => data().session.communication.capability(props.target.id)

  const available = () =>
    props.capable !== false && data().session.identity.get(props.target.id)?.coordination?.available === true

  const canSend = () => available() && capability()?.send === true
  const canReply = () => available() && capability()?.reply === true
  const pending = () => state.pending && state.pendingOwner?.() === true
  const paging = () => state.paging && state.pageOwner?.() === true
  const busy = () => pending() || paging()

  const selected = () => {
    const id = selectedID()

    return id ? data().session.communication.get(props.target.id, id) : messages()?.[0]
  }

  const peers = () =>
    data()
      .session.list()
      .filter((session) => session.id !== props.target.id)

  const acknowledgement = () => {
    const id = draft()?.acknowledged ?? draft()?.request?.payload.id

    return id ? data().session.communication.get(props.target.id, id) : undefined
  }

  const requestText = createMemo(() => {
    const content = draft()?.request?.payload.content

    return content?.type === "text" ? content.text : undefined
  })

  const requestSession = createMemo(() => {
    const content = draft()?.request?.payload.content

    return content?.type === "session" ? content : undefined
  })

  const mutationCurrent = (value: NonNullable<ReturnType<typeof owner>>) => {
    const server = ctx.servers.get(value.serverID)

    return (
      !ctx.signal.aborted &&
      server?.client === value.client &&
      server.attempt === value.attempt &&
      JSON.stringify(server.data.session.get(value.sessionID)?.location) === value.location
    )
  }

  function refresh() {
    data().session.communication.invalidate(props.target.id)
    setState({ read: state.read + 1, error: "" })
  }

  async function select(id: string, source: MountedSession = props.session) {
    const value = owner()

    if (!value) return
    await stored.update((draft) => {
      draft.selected = id
    })

    if (!mutationCurrent(value)) return
    await ctx.stores.meta(source).update((draft) => {
      if (draft.target?.serverID === value.serverID && draft.target.sessionID === value.sessionID)
        draft.communicationID = id
    })
  }

  async function compose(parent?: SessionCommunicationMessage) {
    const value = owner()

    if (!value || busy() || (parent ? !canReply() : !canSend())) return

    if (parent && parent.targetSessionID !== value.sessionID) return
    await stored.update((draft) => {
      draft.open = true
      draft.replyTo = parent?.id
      draft.targetSessionID = parent?.actor.sessionID ?? ""
      draft.contentKind = "text"
      draft.contentSessionID = value.sessionID
      draft.scope = "reference"
      draft.text = ""
      draft.request = undefined
      draft.acknowledged = undefined
    })

    if (mutationCurrent(value) && lifecycle.active) setState({ error: "" })
  }

  async function send() {
    const value = owner()
    const source = props.session
    const saved = draft()

    if (!value || !saved || busy() || (saved.replyTo ? !canReply() : !canSend())) return
    const captured = structuredClone(unwrap(saved))

    const content =
      captured.contentKind === "text"
        ? { type: "text", text: captured.text }
        : { type: "session", sessionID: captured.contentSessionID.trim(), scope: captured.scope }

    const payload = {
      id: SessionCommunication.ID.create(),
      content,
      delivery: captured.delivery,
      trigger: captured.trigger,
    }

    const request =
      captured.request ??
      Option.getOrUndefined(
        decodeRequest(
          captured.replyTo
            ? { kind: "reply", communicationID: captured.replyTo, payload }
            : { kind: "send", payload: { ...payload, targetSessionID: captured.targetSessionID.trim() } },
        ),
      )

    if (!request || (request.payload.content.type === "text" && !request.payload.content.text.trim())) {
      setState({ error: ctx.t("session.communication.invalid") })

      return
    }

    const token = Symbol()
    const current = () => mutationCurrent(value)
    setState({ pending: true, pendingOwner: current, token, error: "" })

    try {
      if (!captured.request) {
        await stored.update((draft) => {
          draft.request = request
        })

        if (!current() || state.token !== token) return
      }

      const input = {
        sessionID: value.sessionID,
        directory: value.directory,
        workspace: value.workspace,
        payload: request.payload,
      }

      const receipt =
        request.kind === "reply"
          ? await value.data.session.communication.reply(
              { ...input, communicationID: request.communicationID, payload: request.payload },
              { signal: ctx.signal },
            )
          : await value.data.session.communication.send({ ...input, payload: request.payload }, { signal: ctx.signal })

      if (!current() || state.token !== token) return
      await stored.update((draft) => {
        draft.acknowledged = receipt.id
        draft.selected = receipt.id
      })

      if (!current() || state.token !== token || !lifecycle.active || !props.active) return
      await select(receipt.id, source)

      if (current() && lifecycle.active && props.active) refresh()
    } catch (error) {
      if (current() && state.token === token)
        setState({ error: errorMessage(error, ctx.t("session.tasks.error.unknown")) })
    } finally {
      if (!ctx.signal.aborted && state.token === token) setState({ pending: false, token: undefined })
    }
  }

  async function more() {
    const value = owner()

    if (!value || busy()) return
    const token = Symbol()
    const current = () => mutationCurrent(value)
    setState({ paging: true, pageToken: token, pageOwner: current, error: "" })

    try {
      await value.data.session.communication.more(value.sessionID)
    } catch (error) {
      if (current() && state.pageToken === token)
        setState({ error: errorMessage(error, ctx.t("session.tasks.error.unknown")) })
    } finally {
      if (!ctx.signal.aborted && state.pageToken === token) setState({ paging: false, pageToken: undefined })
    }
  }

  function openSession(sessionID: string) {
    props.openSession({
      source: props.session,
      target: ctx.sessions.target({ server: props.target.server, sessionID }),
      interaction: "readonly",
    })
  }

  function time(value: SessionCommunicationMessage["createdAt"]) {
    const date = new Date(Number(value))

    return Number.isFinite(date.getTime()) ? date.toISOString() : ctx.t("session.meta.unknown")
  }

  return (
    <section data-slot="meta-communication" aria-label={ctx.t("session.communication.title")}>
      <div data-slot="task-toolbar">
        <h4>{ctx.t("session.communication.title")}</h4>
        <div data-slot="task-form-actions">
          <Button
            type="button"
            size="small"
            variant="ghost"
            disabled={!owner() || busy() || read.loading}
            onClick={refresh}
          >
            {ctx.t("session.meta.refresh")}
          </Button>
          <Show when={canSend()}>
            <Button
              type="button"
              size="small"
              variant="ghost"
              disabled={!owner() || busy()}
              onClick={() => void compose()}
            >
              {ctx.t("session.communication.new")}
            </Button>
          </Show>
        </div>
      </div>
      <Show when={read.loading}>
        <p data-slot="task-progress" role="status">
          {ctx.t("session.communication.loading")}
        </p>
      </Show>
      <Show when={state.error || read.error}>
        <p data-slot="task-error" role="alert">
          {state.error || errorMessage(read.error, ctx.t("session.tasks.error.unknown"))}
        </p>
      </Show>
      <Show when={capability() && (!canSend() || !canReply())}>
        <p data-slot="task-progress" role="status">
          {ctx.t("session.communication.historyOnly")}
        </p>
        <For each={capability()?.reasons}>{(reason) => <code>{reason}</code>}</For>
      </Show>
      <Show when={messages()}>
        <ul data-slot="task-list">
          <For each={messages()} fallback={<p data-slot="task-empty">{ctx.t("session.communication.empty")}</p>}>
            {(message) => (
              <li data-slot="task-row">
                <div data-slot="task-row-content">
                  <Button
                    type="button"
                    size="small"
                    variant="ghost"
                    aria-pressed={selected()?.id === message.id}
                    onClick={() => void select(message.id)}
                  >
                    {ctx.t(
                      message.actor.sessionID === props.target.id
                        ? "session.communication.sent"
                        : "session.communication.received",
                      {
                        session:
                          data().session.get(
                            message.actor.sessionID === props.target.id
                              ? message.targetSessionID
                              : message.actor.sessionID,
                          )?.title ??
                          (message.actor.sessionID === props.target.id
                            ? message.targetSessionID
                            : message.actor.sessionID),
                      },
                    )}
                  </Button>
                  <div data-slot="task-metadata">
                    <code>{message.id}</code>
                    <span>{ctx.t(`session.communication.state.${message.state}`)}</span>
                    <span>{ctx.t(`session.communication.scope.${message.contentSource.scope}`)}</span>
                    <time>{time(message.createdAt)}</time>
                  </div>
                </div>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={data().session.communication.next(props.target.id)}>
        <Button
          type="button"
          size="small"
          variant="ghost"
          aria-busy={paging()}
          disabled={!owner() || busy()}
          onClick={() => void more()}
        >
          {ctx.t("session.communication.more")}
        </Button>
      </Show>
      <Show when={selected()}>
        {(message) => (
          <article data-slot="communication-detail">
            <dl data-slot="meta-statistics">
              <dt>{ctx.t("session.communication.created")}</dt>
              <dd>
                <time>{time(message().createdAt)}</time>
              </dd>
              <dt>{ctx.t("session.communication.actor")}</dt>
              <dd>
                <Button
                  type="button"
                  size="small"
                  variant="ghost"
                  disabled={data().session.deleted(message().actor.sessionID)}
                  onClick={() => openSession(message().actor.sessionID)}
                >
                  {data().session.get(message().actor.sessionID)?.title ?? message().actor.sessionID}
                </Button>
              </dd>
              <dt>{ctx.t("session.communication.contentSource")}</dt>
              <dd>
                <Button
                  type="button"
                  size="small"
                  variant="ghost"
                  disabled={data().session.deleted(message().contentSource.sessionID)}
                  onClick={() => openSession(message().contentSource.sessionID)}
                >
                  {data().session.get(message().contentSource.sessionID)?.title ?? message().contentSource.sessionID}
                </Button>
              </dd>
              <dt>{ctx.t("session.communication.target")}</dt>
              <dd>
                <Button
                  type="button"
                  size="small"
                  variant="ghost"
                  disabled={data().session.deleted(message().targetSessionID)}
                  onClick={() => openSession(message().targetSessionID)}
                >
                  {data().session.get(message().targetSessionID)?.title ?? message().targetSessionID}
                </Button>
              </dd>
              <dt>{ctx.t("session.communication.delivery")}</dt>
              <dd>{ctx.t(`session.operation.delivery.${message().delivery}`)}</dd>
              <dt>{ctx.t("session.communication.execution")}</dt>
              <dd>
                {ctx.t(message().trigger ? "session.communication.requested" : "session.communication.notRequested")}
              </dd>
            </dl>
            <Show when={message().replyTo}>
              {(id) => (
                <div data-slot="task-form-actions">
                  <span>{ctx.t("session.communication.replyTo")}</span>
                  <Button
                    type="button"
                    size="small"
                    variant="ghost"
                    disabled={!owner()}
                    onClick={() => void select(id())}
                  >
                    <code>{id()}</code>
                  </Button>
                </div>
              )}
            </Show>
            <div data-slot="task-metadata">
              <code>{message().body.inputID}</code>
              <code>{message().body.digest}</code>
              <code>{message().requestDigest}</code>
            </div>
            <Collapsible variant="ghost" data-slot="meta-request" defaultOpen>
              <Collapsible.Trigger type="button">
                <Collapsible.Arrow />
                <span>{ctx.t("session.communication.content")}</span>
              </Collapsible.Trigger>
              <Collapsible.Content class="min-w-0 pb-2">
                <pre>{message().text}</pre>
              </Collapsible.Content>
            </Collapsible>
            <Show when={canReply() && message().targetSessionID === props.target.id}>
              <Button
                type="button"
                size="small"
                variant="neutral"
                disabled={!owner() || busy()}
                onClick={() => void compose(message())}
              >
                {ctx.t("session.communication.reply")}
              </Button>
            </Show>
          </article>
        )}
      </Show>
      <Show when={draft()?.open && draft()}>
        {(draft) => (
          <form
            data-slot="meta-coordination-form"
            onSubmit={(event) => {
              event.preventDefault()
              void send()
            }}
          >
            <Show when={!draft().request}>
              <Show
                when={draft().replyTo}
                fallback={
                  <>
                    <Select
                      aria-label={ctx.t("session.communication.target")}
                      options={peers()}
                      current={peers().find((session) => session.id === draft().targetSessionID)}
                      value={(session) => session.id}
                      label={(session) => session.title ?? session.id}
                      disabled={busy()}
                      onSelect={(session) => {
                        if (session)
                          void stored.update((draft) => {
                            draft.targetSessionID = session.id
                          })
                      }}
                    />
                    <TextField
                      label={ctx.t("session.communication.targetID")}
                      required
                      value={draft().targetSessionID}
                      disabled={busy()}
                      onChange={(id) =>
                        void stored.update((draft) => {
                          draft.targetSessionID = id
                        })
                      }
                    />
                  </>
                }
              >
                {(id) => (
                  <p data-slot="task-metadata">
                    {ctx.t("session.communication.replyTo")} <code>{id()}</code> {ctx.t("session.communication.target")}{" "}
                    <code>{draft().targetSessionID}</code>
                  </p>
                )}
              </Show>
              <Select
                aria-label={ctx.t("session.communication.contentKind")}
                options={["text", "session"] as const}
                current={draft().contentKind}
                value={(kind) => kind}
                label={(kind) => ctx.t(`session.communication.kind.${kind}`)}
                disabled={busy()}
                onSelect={(kind) => {
                  if (kind)
                    void stored.update((draft) => {
                      draft.contentKind = kind
                    })
                }}
              />
              <Show when={draft().contentKind === "text"}>
                <TextField
                  label={ctx.t("session.communication.message")}
                  required
                  multiline
                  value={draft().text}
                  disabled={busy()}
                  onChange={(text) =>
                    void stored.update((draft) => {
                      draft.text = text
                    })
                  }
                />
              </Show>
              <Show when={draft().contentKind === "session"}>
                <TextField
                  label={ctx.t("session.communication.contentSession")}
                  required
                  value={draft().contentSessionID}
                  disabled={busy()}
                  onChange={(id) =>
                    void stored.update((draft) => {
                      draft.contentSessionID = id
                    })
                  }
                />
                <Select
                  aria-label={ctx.t("session.communication.scope")}
                  options={["reference", "output", "full"] as const}
                  current={draft().scope}
                  value={(scope) => scope}
                  label={(scope) => ctx.t(`session.communication.scope.${scope}`)}
                  disabled={busy()}
                  onSelect={(scope) => {
                    if (scope)
                      void stored.update((draft) => {
                        draft.scope = scope
                      })
                  }}
                />
              </Show>
              <Select
                aria-label={ctx.t("session.communication.delivery")}
                options={["queue", "steer"] as const}
                current={draft().delivery}
                value={(delivery) => delivery}
                label={(delivery) => ctx.t(`session.operation.delivery.${delivery}`)}
                disabled={busy()}
                onSelect={(delivery) => {
                  if (delivery)
                    void stored.update((draft) => {
                      draft.delivery = delivery
                    })
                }}
              />
              <Checkbox
                checked={draft().trigger}
                disabled={busy()}
                onChange={(trigger) =>
                  void stored.update((draft) => {
                    draft.trigger = trigger
                  })
                }
              >
                {ctx.t("session.communication.execution")}
              </Checkbox>
            </Show>
            <Show when={draft().request}>
              {(request) => (
                <Collapsible variant="ghost" data-slot="meta-request" defaultOpen>
                  <Collapsible.Trigger type="button">
                    <Collapsible.Arrow />
                    <span>{ctx.t("session.communication.savedRequest")}</span>
                  </Collapsible.Trigger>
                  <Collapsible.Content class="min-w-0 pb-2">
                    <code>{request().payload.id}</code>
                    <Show when={requestText()}>{(text) => <pre>{text()}</pre>}</Show>
                    <Show when={requestSession()}>
                      {(content) => (
                        <div data-slot="task-metadata">
                          <code>{content().sessionID}</code>
                          <span>{ctx.t(`session.communication.scope.${content().scope}`)}</span>
                        </div>
                      )}
                    </Show>
                  </Collapsible.Content>
                </Collapsible>
              )}
            </Show>
            <Show when={acknowledgement()}>
              {(message) => (
                <p role="status">
                  {ctx.t("session.communication.saved")} <code>{message().id}</code>{" "}
                  {ctx.t(`session.communication.state.${message().state}`)}
                </p>
              )}
            </Show>
            <div data-slot="task-form-actions">
              <Show when={!draft().acknowledged}>
                <Button
                  type="submit"
                  size="small"
                  variant="neutral"
                  aria-busy={pending()}
                  disabled={!owner() || busy() || (draft().replyTo ? !canReply() : !canSend())}
                >
                  {ctx.t(
                    pending()
                      ? "session.communication.sending"
                      : draft().request
                        ? "session.coordination.retry"
                        : draft().replyTo
                          ? "session.communication.reply"
                          : "session.communication.send",
                  )}
                </Button>
              </Show>
              <Button
                type="button"
                size="small"
                variant="ghost"
                disabled={busy()}
                onClick={() =>
                  void stored.update((draft) => {
                    draft.open = false
                  })
                }
              >
                {ctx.t("session.communication.closeDraft")}
              </Button>
            </div>
          </form>
        )}
      </Show>
    </section>
  )
}
