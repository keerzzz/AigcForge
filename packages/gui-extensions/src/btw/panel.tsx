import { createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import { Button } from "@omnixa/ui/button"
import { Icon } from "@omnixa/ui/icon"
import { IconButton } from "@omnixa/ui/icon-button"
import { ScrollView } from "@omnixa/ui/scroll-view"
import { Textarea } from "@omnixa/ui/textarea"
import { TextShimmer } from "@omnixa/ui/text-shimmer"
import { Tooltip } from "@omnixa/ui/tooltip"
import { showToast } from "@omnixa/ui/toast"
import { Markdown } from "@omnixa/session-ui/markdown"
import { base64Decode } from "@omnixa/util/encode"
import { errorMessage } from "@omnixa/util/error"
import { createKeyed, createLatest, useExtension, usePanel, type MountedSession, type SessionScreen } from "../sdk"
import type Btw from "./index"
import type { BtwModel } from "./model"

export default function SessionBtwPanel(props: {
  btw: BtwModel
  session: MountedSession
  screen: SessionScreen
  id: string
}) {
  const ctx = useExtension<typeof Btw>()
  const frame = usePanel()
  const identity = () => props.session.key + "\n" + props.id
  const chat = () => props.btw.entry(props.session, props.id)
  const target = createMemo(() => props.btw.target(props.session, props.id))
  const [referenceID, setReferenceID] = createSignal<string>()
  const referenceOpen = () => referenceID() === identity()
  const [revision, setRevision] = createSignal({ key: "", value: 0 })

  const refresh = () =>
    setRevision((previous) => ({
      key: identity(),
      value: previous.key === identity() ? previous.value + 1 : 1,
    }))

  const [copied, setCopied] = createSignal<{ key: string; text: string }>()
  const [inserting, setInserting] = createSignal<string>()
  let disposed = false
  onCleanup(() => {
    disposed = true
  })

  // Finish a visible reading interval in the persisted read cursor when its view releases visibility.
  createKeyed(
    () => (frame.visible() ? { session: props.session, id: props.id, key: identity() } : undefined),
    (visible) => onCleanup(() => props.btw.markRead(visible.session, visible.id)),
    { equals: (previous, next) => previous.key === next.key },
  )

  const query = createMemo(
    () => {
      const current = target()
      const firstID = chat()?.intent?.firstID

      if (!frame.visible() || !current?.server.connected || !firstID) return

      return {
        key: identity(),
        token: Symbol(),
        session: props.session,
        id: props.id,
        firstID,
        client: current.server.client,
        data: current.server.data,
        attempt: current.server.attempt,
        waiting: props.btw.pending(props.session, props.id),
        admitted: chat()?.admitted,
        attempted: chat()?.attempted,
        pending: current.server.data.session.pending.list(current.id).some((item) => item.id === firstID),
        promoted: current.server.data.session.message.get(current.id, firstID)?.type === "user",
        revision: revision().key === identity() ? revision().value : 0,
      }
    },
    undefined,
    {
      equals: (previous, next) =>
        previous?.key === next?.key &&
        previous?.client === next?.client &&
        previous?.data === next?.data &&
        previous?.attempt === next?.attempt &&
        previous?.firstID === next?.firstID &&
        previous?.waiting === next?.waiting &&
        previous?.admitted === next?.admitted &&
        previous?.attempted === next?.attempted &&
        previous?.pending === next?.pending &&
        previous?.promoted === next?.promoted &&
        previous?.revision === next?.revision,
    },
  )

  const first = createLatest(query, async (input, signal) => ({
    token: input.token,
    state: await props.btw.first(input.session, input.id, signal),
  }))

  const state = () => {
    const value = first.latest
    const current = query()

    // createLatest stores proxy object results; a scalar token preserves the query generation's identity.
    return value?.token === current?.token ? value?.state : undefined
  }

  const reference = createLatest(
    () => (referenceOpen() ? query() : undefined),
    async (input, signal) => {
      const value = await props.btw.reference(input.session, input.id, signal)

      if (signal.aborted || ctx.signal.aborted || !value) return

      return {
        key: input.key,
        token: input.token,
        value,
        text: value.kind === "legacy" ? value.text : base64Decode(value.reference.file.data),
      }
    },
  )

  const referenceValue = () => {
    const value = reference.latest

    return value?.key === identity() && value.token === query()?.token ? value : undefined
  }

  const interactive = () =>
    !!chat()?.admitted ||
    state()?.state === "pending" ||
    state()?.state === "promoted" ||
    state()?.state === "cancelled" ||
    state()?.state === "unknown"

  const retryable = () =>
    state()?.state === "reserved" ||
    state()?.state === "unsubmitted" ||
    (state()?.state === "missing" && !chat()?.admitted && !chat()?.attempted)

  const copy = async () => {
    const captured = { key: identity(), text: props.btw.answer(props.session, props.id) }

    if (!captured.text) {
      showToast({ title: ctx.t("answer.empty") })

      return
    }

    try {
      await ctx.system.copy(captured.text)

      if (disposed || ctx.signal.aborted || captured.key !== identity()) return
      setCopied({ key: captured.key, text: captured.text })
    } catch (error) {
      if (!disposed && !ctx.signal.aborted) showToast({ title: errorMessage(error, ctx.t("common.requestFailed")) })
    }
  }

  const inserted = async () => {
    const captured = {
      session: props.session,
      id: props.id,
      key: identity(),
      text: props.btw.answer(props.session, props.id),
    }

    if (!captured.text) {
      showToast({ title: ctx.t("answer.empty") })

      return
    }

    if (inserting() === captured.key) return
    setInserting(captured.key)

    try {
      await props.btw.insert(captured.session, captured.id, captured.text)

      if (disposed || ctx.signal.aborted || captured.key !== identity()) return
      showToast({ title: ctx.t("source.inserted") })
    } catch (error) {
      if (!disposed && !ctx.signal.aborted) showToast({ title: errorMessage(error, ctx.t("common.requestFailed")) })
    } finally {
      if (!disposed && !ctx.signal.aborted && inserting() === captured.key) setInserting(undefined)
    }
  }

  const copiedAnswer = () =>
    copied()?.key === identity() && copied()?.text === props.btw.answer(props.session, props.id)

  return (
    <section
      class="flex h-full min-h-0 flex-col bg-v2-background-bg-base"
      data-slot="session-btw-panel"
      aria-label={ctx.t("tab.title")}
    >
      <Show
        when={props.btw.saved(props.session).ready()}
        fallback={
          <p class="px-4 py-3" role="status">
            {ctx.t("loading")}
          </p>
        }
      >
        <Switch>
          <Match when={props.id === "main"}>
            <div class="border-b border-v2-border-border-base px-4 py-3 text-14-medium">{ctx.t("list.title")}</div>
            <ScrollView class="min-h-0 flex-1">
              <div data-slot="session-btw-list" aria-label={ctx.t("list.title")} class="flex flex-col gap-1 px-3 py-3">
                <Show
                  when={props.btw.saved(props.session).value?.chats.length}
                  fallback={<p class="px-1 text-13-regular text-text-weak">{ctx.t("list.empty")}</p>}
                >
                  <For each={props.btw.saved(props.session).value?.chats}>
                    {(item) => (
                      <Button
                        type="button"
                        variant="ghost"
                        class="!h-auto min-h-9 justify-between gap-2 !whitespace-normal !text-left"
                        aria-label={props.btw.title(props.session, item.id)}
                        onClick={() => props.btw.open(props.session, item.id)}
                      >
                        <span class="min-w-0 break-words">{props.btw.title(props.session, item.id)}</span>
                        <Show when={props.btw.unread(props.session, item.id)}>
                          <span
                            data-slot="session-btw-unread"
                            role="status"
                            aria-label={ctx.t("unread")}
                            class="size-1.5 shrink-0 rounded-full bg-v2-state-fg-accent"
                          />
                        </Show>
                      </Button>
                    )}
                  </For>
                </Show>
              </div>
            </ScrollView>
          </Match>
          <Match when={chat()}>
            <div class="flex shrink-0 flex-col gap-2 border-b border-v2-border-border-base px-4 py-3">
              <div class="flex min-w-0 items-start justify-between gap-2">
                <h3 class="min-w-0 break-words text-13-medium">{props.btw.title(props.session, props.id)}</h3>
                <Show when={chat()?.answer || chat()?.request}>
                  <Tooltip value={copiedAnswer() ? ctx.t("common.copied") : ctx.t("copy")}>
                    <IconButton
                      type="button"
                      size="small"
                      variant="ghost-muted"
                      icon={<Icon name={copiedAnswer() ? "check" : "outline-copy"} />}
                      aria-label={copiedAnswer() ? ctx.t("common.copied") : ctx.t("copy")}
                      onClick={() => void copy()}
                    />
                  </Tooltip>
                </Show>
              </div>
              <Show when={chat()?.request}>
                <div class="flex flex-wrap items-center gap-1">
                  <Button
                    type="button"
                    size="small"
                    variant="ghost"
                    disabled={!target()?.server.connected}
                    onClick={() => {
                      const current = target()

                      if (current)
                        ctx.sessions.open({ source: props.session, server: current.server, sessionID: current.id })
                    }}
                  >
                    {ctx.t("main.open")}
                  </Button>
                  <Button
                    type="button"
                    size="small"
                    variant="ghost"
                    aria-expanded={referenceOpen()}
                    aria-controls={"session-btw-reference-" + encodeURIComponent(identity())}
                    disabled={!target()?.server.connected}
                    onClick={() => setReferenceID(referenceOpen() ? undefined : identity())}
                  >
                    {ctx.t("reference.view")}
                  </Button>
                  <Button
                    type="button"
                    size="small"
                    variant="ghost"
                    disabled={inserting() === identity() || !target()?.server.connected}
                    onClick={() => void inserted()}
                  >
                    {ctx.t("source.insert")}
                  </Button>
                </div>
              </Show>
            </div>

            <Switch>
              <Match when={!chat()?.intent}>
                <ScrollView class="min-h-0 flex-1">
                  <div class="px-4 py-4">
                    <Show
                      when={chat()?.answer}
                      fallback={<p class="text-13-regular text-text-weak">{ctx.t("error")}</p>}
                    >
                      {(answer) => <Markdown text={answer()} class="text-14-regular" />}
                    </Show>
                    <Button
                      type="button"
                      size="small"
                      variant="outline"
                      class="mt-4"
                      onClick={() => void props.btw.continueLegacy(props.session, props.id)}
                    >
                      {ctx.t("legacy.continue")}
                    </Button>
                  </div>
                </ScrollView>
              </Match>
              <Match when={!chat()?.request}>
                <form
                  class="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 py-4"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void props.btw.submit(props.session, props.id)
                  }}
                >
                  <label for={"session-btw-question-" + encodeURIComponent(identity())} class="text-13-medium">
                    {ctx.t("question.label")}
                  </label>
                  <Textarea
                    id={"session-btw-question-" + encodeURIComponent(identity())}
                    class="!w-full"
                    rows={5}
                    aria-label={ctx.t("question.label")}
                    placeholder={ctx.t("question.placeholder")}
                    value={chat()?.question ?? ""}
                    disabled={props.btw.pending(props.session, props.id)}
                    autofocus={frame.visible()}
                    onInput={(event) => props.btw.edit(props.session, props.id, event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.isComposing || event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return
                      event.preventDefault()
                      void props.btw.submit(props.session, props.id)
                    }}
                  />
                  <Show when={chat()?.legacyID}>
                    <p class="text-12-regular text-text-weak">{ctx.t("legacy.material")}</p>
                  </Show>
                  <Show when={chat()?.error}>
                    {(error) => (
                      <p role="alert" class="text-13-regular text-text-weak">
                        {error()}
                      </p>
                    )}
                  </Show>
                  <Button
                    type="submit"
                    variant="neutral"
                    class="self-start"
                    disabled={!chat()?.question.trim() || props.btw.pending(props.session, props.id)}
                  >
                    {ctx.t("question.start")}
                  </Button>
                </form>
              </Match>
              <Match when={chat()?.request}>
                <Show when={props.btw.pending(props.session, props.id)}>
                  <div role="status" class="shrink-0 px-4 py-2 text-13-regular">
                    <TextShimmer text={ctx.t("creating")} active />
                  </div>
                </Show>
                <Show when={!props.btw.pending(props.session, props.id) && !referenceOpen()}>
                  <Show when={chat()?.error}>
                    {(error) => (
                      <p role="alert" class="shrink-0 px-4 py-2 text-13-regular text-text-weak">
                        {error()}
                      </p>
                    )}
                  </Show>
                  <Show when={retryable()}>
                    <div class="flex shrink-0 flex-col items-start gap-2 px-4 py-3">
                      <p class="text-13-regular text-text-weak">{ctx.t("first.reserved")}</p>
                      <Button
                        type="button"
                        size="small"
                        variant="outline"
                        disabled={first.loading}
                        onClick={() => void props.btw.retry(props.session, props.id)}
                      >
                        {ctx.t("first.retry")}
                      </Button>
                    </div>
                  </Show>
                  <Show
                    when={
                      state()?.state === "pending" &&
                      target()?.server.data.session.status(target()?.id ?? "") === "idle"
                    }
                  >
                    <Button
                      type="button"
                      size="small"
                      variant="outline"
                      class="mx-4 my-2 self-start"
                      disabled={first.loading}
                      onClick={() => void props.btw.retry(props.session, props.id)}
                    >
                      {ctx.t("first.resume")}
                    </Button>
                  </Show>
                  <Show when={state()?.state === "cancelled"}>
                    <p role="status" class="shrink-0 px-4 py-2 text-13-regular text-text-weak">
                      {ctx.t("first.cancelled")}
                    </p>
                  </Show>
                  <Show when={state()?.state === "unknown"}>
                    <p role="status" class="shrink-0 px-4 py-2 text-13-regular text-text-weak">
                      {ctx.t("first.unknown")}
                    </p>
                  </Show>
                  <Show when={state()?.state === "missing" && (chat()?.admitted || chat()?.attempted)}>
                    <p role="status" class="shrink-0 px-4 py-2 text-13-regular text-text-weak">
                      {ctx.t("first.missing")}
                    </p>
                  </Show>
                  <Show when={first.error}>
                    <Button type="button" size="small" variant="ghost" class="mx-4 my-2 self-start" onClick={refresh}>
                      {ctx.t("first.check")}
                    </Button>
                  </Show>
                </Show>

                <div
                  class="flex min-h-0 flex-1 flex-col"
                  classList={{ hidden: referenceOpen() }}
                  data-slot="session-btw-content"
                >
                  <Show
                    when={target()}
                    fallback={
                      <p role="status" class="px-4 py-3 text-13-regular text-text-weak">
                        {ctx.t("server.unavailable")}
                      </p>
                    }
                  >
                    {(current) =>
                      ctx.sessions.content({
                        get source() {
                          return props.session
                        },
                        get screen() {
                          return props.screen
                        },
                        get target() {
                          return current()
                        },
                        get active() {
                          return frame.visible() && !referenceOpen()
                        },
                        get interaction() {
                          return interactive() ? "interactive" : "readonly"
                        },
                      })
                    }
                  </Show>
                </div>

                <Show when={referenceOpen()}>
                  <div
                    id={"session-btw-reference-" + encodeURIComponent(identity())}
                    class="flex min-h-0 flex-1 flex-col"
                    data-slot="session-btw-reference"
                  >
                    <div class="flex items-center justify-between gap-2 px-4 py-3">
                      <h4 class="text-13-medium">{ctx.t("reference.title")}</h4>
                      <IconButton
                        type="button"
                        size="small"
                        variant="ghost-muted"
                        icon={<Icon name="close-small" />}
                        aria-label={ctx.t("reference.hide")}
                        onClick={() => setReferenceID(undefined)}
                      />
                    </div>
                    <ScrollView class="min-h-0 flex-1">
                      <div class="px-4 pb-4 text-13-regular">
                        <Show when={reference.loading && !referenceValue()}>
                          <p role="status">{ctx.t("loading")}</p>
                        </Show>
                        <Show when={reference.error}>
                          <p role="alert">{ctx.t("reference.error")}</p>
                        </Show>
                        <Show when={referenceValue()}>
                          {(value) => (
                            <>
                              <Show when={value().value.kind === "consultation" ? value().value.reference : undefined}>
                                {(source) => (
                                  <dl class="mb-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
                                    <dt class="text-text-weak">{ctx.t("reference.source")}</dt>
                                    <dd class="break-all">{source().sourceSessionID}</dd>
                                    <dt class="text-text-weak">{ctx.t("reference.boundary")}</dt>
                                    <dd class="break-all">
                                      {source().boundary.type} {source().boundary.messageID}
                                    </dd>
                                    <dt class="text-text-weak">{ctx.t("reference.digest")}</dt>
                                    <dd class="break-all">{source().digest}</dd>
                                    <Show when={source().omissions.length}>
                                      <dt class="text-text-weak">{ctx.t("reference.omissions")}</dt>
                                      <dd>
                                        <For each={source().omissions}>
                                          {(item) => (
                                            <p>
                                              {item.messageID}: {item.reason}
                                            </p>
                                          )}
                                        </For>
                                      </dd>
                                    </Show>
                                  </dl>
                                )}
                              </Show>
                              <pre class="whitespace-pre-wrap break-words font-mono text-12-regular">
                                {value().text}
                              </pre>
                            </>
                          )}
                        </Show>
                      </div>
                    </ScrollView>
                  </div>
                </Show>
              </Match>
            </Switch>
          </Match>
        </Switch>
      </Show>
    </section>
  )
}
