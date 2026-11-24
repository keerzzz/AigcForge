import { createMemo, on, onCleanup, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { JSX } from "solid-js"
import { checksum } from "@omnixa/util/encode"
import { Icon } from "@omnixa/ui/icon"
import { Button } from "@omnixa/ui/button"
import { Collapsible } from "@omnixa/ui/collapsible"
import { Accordion } from "@omnixa/ui/accordion"
import { StickyAccordionHeader } from "@omnixa/ui/sticky-accordion-header"
import { ScrollView } from "@omnixa/ui/scroll-view"
import { showToast } from "@omnixa/ui/toast"
import { useI18n } from "@omnixa/ui/context/i18n"
import { File } from "@omnixa/session-ui/file"
import { Markdown } from "@omnixa/session-ui/markdown"
import type { SessionMessageInfo } from "@omnixa/client/promise"
import { TokenUsage } from "@omnixa/schema/token-usage"
import { createKeyed, useExtension, usePanel, type MountedSession } from "../sdk"
import { catalogModel, syncCatalog } from "./catalog"
import { fetchSessionExport, sessionExportFilename } from "./export"
import { createSessionContextFormatter } from "./format"
import { sessionContextUsage } from "./usage"

function Stat(props: { label: string; value: JSX.Element }) {
  return (
    <div class="flex min-w-0 flex-col gap-1">
      <div class="text-12-regular text-v2-text-text-muted">{props.label}</div>
      <div class="min-w-0 break-words text-13-medium text-text-strong tabular-nums">{props.value}</div>
    </div>
  )
}

function RawMessageContent(props: { message: SessionMessageInfo; onRendered: () => void }) {
  const file = createMemo(() => {
    const contents = JSON.stringify(props.message, null, 2)

    return {
      name: `${props.message.type}-${props.message.id}.json`,
      contents,
      cacheKey: checksum(contents),
    }
  })

  return (
    <File
      mode="text"
      file={file()}
      overflow="wrap"
      class="select-text"
      onRendered={() => requestAnimationFrame(props.onRendered)}
    />
  )
}

function RawMessage(props: {
  message: SessionMessageInfo
  onRendered: () => void
  time: (value: number | undefined) => string
}) {
  return (
    <Accordion.Item value={props.message.id}>
      <StickyAccordionHeader>
        <Accordion.Trigger>
          <div class="flex items-center justify-between gap-2 w-full">
            <div class="min-w-0 truncate">
              {props.message.type} <span class="text-text-base">• {props.message.id}</span>
            </div>
            <div class="flex items-center gap-3">
              <div class="shrink-0 text-12-regular text-text-weak">{props.time(props.message.time.created)}</div>
              <Icon name="chevron-grabber-vertical" size="small" class="shrink-0 text-text-weak" />
            </div>
          </div>
        </Accordion.Trigger>
      </StickyAccordionHeader>
      <Accordion.Content class="bg-background-base">
        <div class="p-3">
          <RawMessageContent message={props.message} onRendered={props.onRendered} />
        </div>
      </Accordion.Content>
    </Accordion.Item>
  )
}

const emptyMessages: SessionMessageInfo[] = []

export default function SessionContextTab(props: { session: MountedSession }) {
  const ctx = useExtension()
  const layout = ctx.layout
  const system = ctx.system
  const i18n = useI18n()
  const data = () => props.session.server.data
  const panel = usePanel()

  const [metrics, setMetrics] = createStore<{
    owner: symbol | undefined
    read: symbol | undefined
    error: string
    loading: boolean
    step: SessionMessageInfo | undefined
    stepOwner: symbol | undefined
    stepRead: symbol | undefined
    stepError: { owner: symbol | undefined; message: string }
  }>({
    owner: undefined,
    read: undefined,
    error: "",
    loading: false,
    step: undefined,
    stepOwner: undefined,
    stepRead: undefined,
    stepError: { owner: undefined, message: "" },
  })

  const metricOwner = createMemo(
    () =>
      panel.visible() && props.session.server.connected && props.session.id
        ? {
            key: Symbol(),
            client: props.session.server.client,
            data: data(),
            id: props.session.id,
            directory: props.session.directory,
          }
        : undefined,
    undefined,
    {
      equals: (a, b) =>
        a?.id === b?.id && a?.client === b?.client && a?.data === b?.data && a?.directory === b?.directory,
    },
  )

  const cache = () => (props.session.id ? data().session.cache.get(props.session.id) : undefined)
  const meta = () => (props.session.id ? data().session.meta.get(props.session.id) : undefined)

  const current = (owner: NonNullable<ReturnType<typeof metricOwner>>) =>
    !ctx.signal.aborted &&
    metricOwner() === owner &&
    panel.visible() &&
    props.session.server.connected &&
    props.session.server.client === owner.client &&
    data() === owner.data &&
    props.session.id === owner.id &&
    props.session.directory === owner.directory

  const readMetrics = async () => {
    const owner = metricOwner()

    if (!owner) return
    const read = Symbol()
    setMetrics({ owner: owner.key, read, loading: true, error: "" })

    try {
      owner.data.session.cache.invalidate(owner.id)
      owner.data.session.meta.invalidate(owner.id)
      await Promise.all([owner.data.session.cache.sync(owner.id), owner.data.session.meta.sync(owner.id)])

      if (current(owner) && metrics.read === read) setMetrics("error", "")
    } catch (error) {
      if (current(owner) && metrics.read === read)
        setMetrics("error", error instanceof Error ? error.message : ctx.t("recorded.readFailed"))
    } finally {
      if (current(owner) && metrics.read === read) setMetrics("loading", false)
    }
  }

  // Fetch only while the Context panel is visible, and revalidate on a recorded completion.
  createKeyed(metricOwner, (owner) => {
    if (!owner) return
    void readMetrics()
    onCleanup(
      owner.data.on("session.step.ended", (event) => {
        if (event.data.sessionID === owner.id) void readMetrics()
      }),
    )
  })

  const openStep = async (messageID: string) => {
    const owner = metricOwner()

    if (!owner) return
    const read = Symbol()
    setMetrics({ stepRead: read, stepError: { owner: owner.key, message: "" } })

    try {
      const message = await owner.client.session.message.get({ sessionID: owner.id, messageID })

      if (current(owner) && metrics.stepRead === read)
        setMetrics({ step: message, stepOwner: owner.key, stepError: { owner: owner.key, message: "" } })
    } catch (error) {
      if (current(owner) && metrics.stepRead === read)
        setMetrics("stepError", "message", error instanceof Error ? error.message : ctx.t("recorded.readFailed"))
    }
  }

  syncCatalog(() => props.session)

  const info = createMemo(() => (props.session.id ? data().session.get(props.session.id) : undefined))

  const messages = createMemo(
    () => {
      const id = props.session.id

      if (!id) return emptyMessages

      return data().session.message.list(id)
    },
    emptyMessages,
    { equals: same },
  )

  const usd = createMemo(
    () =>
      new Intl.NumberFormat(i18n.locale(), {
        style: "currency",
        currency: "USD",
      }),
  )

  const context = createMemo(() => {
    const current = sessionContextUsage(messages())

    if (!current) return
    const entry = catalogModel(props.session, current.model)
    const limit = entry?.model?.limit.context

    return {
      message: current.message,
      tokens: current.tokens,
      providerLabel: entry?.provider.name ?? current.model.providerID,
      modelLabel: entry?.model?.name ?? current.model.id,
      limit,
      input: current.tokens?.input,
      total: current.total,
      usage: current.total !== undefined && limit ? Math.round((current.total / limit) * 100) : null,
      remaining: current.total !== undefined && limit !== undefined ? Math.max(0, limit - current.total) : undefined,
    }
  })

  const formatter = createMemo(() => createSessionContextFormatter(i18n.locale()))

  const cost = createMemo(() => {
    const value = info()?.cost

    return value === undefined ? "—" : usd().format(value)
  })

  const cumulativeTokens = createMemo(() => {
    const tokens = info()?.tokens

    return tokens ? TokenUsage.total(tokens) : undefined
  })

  const counts = createMemo(() => {
    const all = messages()
    const user = all.reduce((count, message) => count + (message.type === "user" ? 1 : 0), 0)
    const assistant = all.reduce((count, message) => count + (message.type === "assistant" ? 1 : 0), 0)

    return {
      all: all.length,
      user,
      assistant,
    }
  })

  const systemPrompt = createMemo(() => {
    const system = messages().findLast((message) => message.type === "system")?.text

    if (!system) return
    const trimmed = system.trim()

    if (!trimmed) return

    return trimmed
  })

  const providerLabel = createMemo(() => {
    const c = context()

    if (!c) return "—"

    return c.providerLabel
  })

  const modelLabel = createMemo(() => {
    const c = context()

    if (!c) return "—"

    return c.modelLabel
  })

  const requestStats = [
    { label: "stats.totalTokens", value: () => formatter().number(context()?.total) },
    { label: "stats.limit", value: () => formatter().number(context()?.limit) },
    { label: "stats.usage", value: () => formatter().percent(context()?.usage) },
    { label: "stats.remainingTokens", value: () => formatter().number(context()?.remaining) },
    { label: "stats.inputTokens", value: () => formatter().number(context()?.input) },
    { label: "stats.outputTokens", value: () => formatter().number(context()?.tokens?.output) },
    { label: "stats.reasoningTokens", value: () => formatter().number(context()?.tokens?.reasoning) },
    { label: "stats.cacheReadTokens", value: () => formatter().number(context()?.tokens?.cache.read) },
    { label: "stats.cacheWriteTokens", value: () => formatter().number(context()?.tokens?.cache.write) },
    { label: "stats.provider", value: providerLabel },
    { label: "stats.model", value: modelLabel },
  ]

  const cumulativeStats = [
    { label: "stats.totalTokens", value: () => formatter().number(cumulativeTokens()) },
    { label: "stats.inputTokens", value: () => formatter().number(info()?.tokens?.input) },
    { label: "stats.outputTokens", value: () => formatter().number(info()?.tokens?.output) },
    { label: "stats.reasoningTokens", value: () => formatter().number(info()?.tokens?.reasoning) },
    { label: "stats.cacheReadTokens", value: () => formatter().number(info()?.tokens?.cache.read) },
    { label: "stats.cacheWriteTokens", value: () => formatter().number(info()?.tokens?.cache.write) },
    { label: "stats.totalCost", value: cost },
    {
      label: "stats.missingUsageAttempts",
      value: () => formatter().number(info()?.missingUsageAttempts),
    },
  ]

  const stats = [
    { label: "stats.session", value: () => info()?.title ?? (props.session.id || "—") },
    { label: "stats.messages", value: () => counts().all.toLocaleString(i18n.locale()) },
    { label: "stats.userMessages", value: () => counts().user.toLocaleString(i18n.locale()) },
    { label: "stats.assistantMessages", value: () => counts().assistant.toLocaleString(i18n.locale()) },
    { label: "stats.sessionCreated", value: () => formatter().time(info()?.time.created) },
    { label: "stats.lastActivity", value: () => formatter().time(context()?.message.time.created) },
  ] satisfies { label: string; value: () => JSX.Element }[]

  const exportSession = async () => {
    const sessionID = props.session.id

    if (!sessionID) return

    try {
      const data = await fetchSessionExport({
        sessionID,
        api: props.session.server.client,
      })

      const filename = sessionExportFilename(data.info)

      if (!(await system.save({ name: filename, content: JSON.stringify(data, null, 2) }))) return
      showToast({
        variant: "success",
        // Solid resolves JSX accessors under the toast's render owner, not this imperative call site.
        icon: () => <Icon name="circle-check" />,
        title: ctx.t("export.success.title"),
        description: ctx.t("export.success.description", { filename }),
      })
    } catch (err) {
      showToast({
        variant: "error",
        title: ctx.t("export.failed.title"),
        description: err instanceof Error ? err.message : ctx.t("export.failed.description"),
      })
    }
  }

  let scroll: HTMLDivElement | undefined
  let frame: number | undefined
  let pending: { x: number; y: number } | undefined

  const restoreScroll = () => {
    const el = scroll

    if (!el) return

    const s = layout.scroll.get(props.session, "context")

    if (!s) return

    if (el.scrollTop !== s.y) el.scrollTop = s.y

    if (el.scrollLeft !== s.x) el.scrollLeft = s.x
  }

  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    pending = {
      x: event.currentTarget.scrollLeft,
      y: event.currentTarget.scrollTop,
    }

    if (frame !== undefined) return

    frame = requestAnimationFrame(() => {
      frame = undefined

      const next = pending
      pending = undefined

      if (!next) return

      layout.scroll.set(props.session, "context", next)
    })
  }

  // Restores the stored scroll a frame after the messages change; on mount the viewport ref restores it.
  createKeyed(
    createMemo(on(messages, (list) => list, { defer: true })),
    () => void requestAnimationFrame(restoreScroll),
  )

  onCleanup(() => {
    if (frame === undefined) return
    cancelAnimationFrame(frame)
  })

  return (
    <ScrollView
      class="@container h-full"
      viewportRef={(el) => {
        scroll = el
        restoreScroll()
      }}
      onScroll={handleScroll}
    >
      <div data-slot="session-usage-content" class="px-4 pt-4 pb-6 flex flex-col gap-6 md:px-6 md:pb-10">
        <section aria-label={ctx.t("usage.latest.title")} class="flex min-w-0 flex-col gap-3">
          <h3 class="text-13-medium text-text-strong">{ctx.t("usage.latest.title")}</h3>
          <p class="text-12-regular text-v2-text-text-muted">{ctx.t("usage.latest.scope")}</p>
          <div class="grid grid-cols-2 gap-4">
            <For each={requestStats}>{(stat) => <Stat label={ctx.t(stat.label)} value={stat.value()} />}</For>
          </div>
        </section>
        <section aria-label={ctx.t("usage.session.title")} class="flex min-w-0 flex-col gap-3">
          <h3 class="text-13-medium text-text-strong">{ctx.t("usage.session.title")}</h3>
          <p class="text-12-regular text-v2-text-text-muted">{ctx.t("usage.session.scope")}</p>
          <div class="grid grid-cols-2 gap-4">
            <For each={cumulativeStats}>{(stat) => <Stat label={ctx.t(stat.label)} value={stat.value()} />}</For>
          </div>
          <Show when={info()?.missingUsageAttempts}>
            <p class="text-12-regular text-v2-text-text-muted">{ctx.t("usage.session.partial")}</p>
          </Show>
          <Show when={info()?.unknownPriceAttempts}>
            <p class="text-12-regular text-v2-text-text-muted">{ctx.t("usage.session.partialCost")}</p>
          </Show>
          <Show
            when={info() && (info()?.missingUsageAttempts === undefined || info()?.unknownPriceAttempts === undefined)}
          >
            <p class="text-12-regular text-v2-text-text-muted">{ctx.t("usage.session.coverageUnknown")}</p>
          </Show>
        </section>
        <section aria-label={ctx.t("usage.session.info")} class="min-w-0">
          <Collapsible variant="ghost">
            <Collapsible.Trigger type="button">
              <Collapsible.Arrow />
              {ctx.t("usage.session.info")}
            </Collapsible.Trigger>
            <Collapsible.Content>
              <div class="grid grid-cols-1 @[32rem]:grid-cols-2 gap-4 pt-2">
                <For each={stats}>{(stat) => <Stat label={ctx.t(stat.label)} value={stat.value()} />}</For>
              </div>
            </Collapsible.Content>
          </Collapsible>
        </section>
        <section aria-label={ctx.t("recorded.title")} class="min-w-0">
          <Collapsible variant="ghost">
            <Collapsible.Trigger type="button">
              <Collapsible.Arrow />
              {ctx.t("recorded.title")}
            </Collapsible.Trigger>
            <Collapsible.Content>
              <div class="flex min-w-0 flex-col gap-3 pt-2">
                <div class="flex items-center justify-end gap-2">
                  <Button
                    size="small"
                    variant="ghost"
                    disabled={!metricOwner() || (metrics.owner === metricOwner()?.key && metrics.loading)}
                    onClick={() => void readMetrics()}
                  >
                    {ctx.t("recorded.refresh")}
                  </Button>
                </div>
                <p class="text-12-regular text-text-weak">{ctx.t("recorded.scope")}</p>
                <Show when={metrics.owner === metricOwner()?.key ? metrics.error : undefined}>
                  {(error) => <p role="alert">{error()}</p>}
                </Show>
                <Show when={metrics.stepError.owner === metricOwner()?.key ? metrics.stepError.message : undefined}>
                  {(error) => <p role="alert">{error()}</p>}
                </Show>
                <Show when={cache()}>
                  {(usage) => (
                    <>
                      <div class="grid grid-cols-1 @[32rem]:grid-cols-2 gap-4">
                        <Stat
                          label={ctx.t("recorded.confidence")}
                          value={ctx.t(`recorded.confidence.${usage().confidence}`)}
                        />
                        <Stat
                          label={ctx.t("recorded.hitRate")}
                          value={
                            usage().perStep.length
                              ? formatter().percent(usage().sessionHitRate)
                              : ctx.t("recorded.unknown")
                          }
                        />
                        <Stat
                          label={ctx.t("recorded.cacheTokens")}
                          value={
                            usage().perStep.length
                              ? `${formatter().number(usage().sessionCacheRead)} / ${formatter().number(usage().sessionCacheWrite)}`
                              : ctx.t("recorded.unknown")
                          }
                        />
                        <Stat
                          label={ctx.t("recorded.inputTokens")}
                          value={
                            usage().perStep.length
                              ? formatter().number(usage().sessionTotalInput)
                              : ctx.t("recorded.unknown")
                          }
                        />
                      </div>
                      <For each={usage().perStep}>
                        {(step) => {
                          const message = () =>
                            messages().find((message) => message.id === step.assistantMessageID) ??
                            (metrics.stepOwner === metricOwner()?.key && metrics.step?.id === step.assistantMessageID
                              ? metrics.step
                              : undefined)

                          const elapsed = () => {
                            const value = message()

                            return value?.type === "assistant" && value.time.completed !== undefined
                              ? `${formatter().number((value.time.completed - value.time.created) / 1000)} s`
                              : ctx.t("recorded.unknown")
                          }

                          return (
                            <div class="flex flex-wrap items-center gap-2 text-12-regular">
                              <Button
                                size="small"
                                variant="ghost"
                                onClick={() => void openStep(step.assistantMessageID)}
                              >
                                {ctx.t("recorded.openStep")}: {step.assistantMessageID}
                              </Button>
                              <span>{formatter().percent(step.hitRate)}</span>
                              <span>
                                {ctx.t("recorded.elapsed")}: {elapsed()}
                              </span>
                            </div>
                          )
                        }}
                      </For>
                    </>
                  )}
                </Show>
                <Show when={meta()?.stats}>
                  {(stats) => (
                    <div class="grid grid-cols-1 @[32rem]:grid-cols-2 gap-4">
                      <Stat
                        label={ctx.t("recorded.metaTokens")}
                        value={
                          stats().totalTokens === undefined
                            ? ctx.t("recorded.unknown")
                            : formatter().number(stats().totalTokens)
                        }
                      />
                      <Stat label={ctx.t("recorded.knownTokens")} value={formatter().number(stats().recordedTokens)} />
                      <Stat label={ctx.t("recorded.unknownSessions")} value={stats().unknownTokenSessionCount} />
                      <Stat label={ctx.t("recorded.attempts")} value={ctx.t("recorded.unknown")} />
                    </div>
                  )}
                </Show>
                <Show when={metrics.stepOwner === metricOwner()?.key ? metrics.step : undefined}>
                  {(message) => <RawMessageContent message={message()} onRendered={restoreScroll} />}
                </Show>
              </div>
            </Collapsible.Content>
          </Collapsible>
        </section>

        <Show when={systemPrompt()}>
          {(prompt) => (
            <div class="flex flex-col gap-2">
              <div class="text-12-regular text-text-weak">{ctx.t("systemPrompt.title")}</div>
              <div class="border border-border-base rounded-md bg-surface-base px-3 py-2">
                <Markdown text={prompt()} class="text-12-regular" />
              </div>
            </div>
          )}
        </Show>

        <section aria-label={ctx.t("rawMessages.title")} class="min-w-0">
          <Collapsible variant="ghost" class="gap-2">
            <div class="flex items-center justify-between">
              <Collapsible.Trigger type="button">
                <Collapsible.Arrow />
                {ctx.t("rawMessages.title")}
              </Collapsible.Trigger>
              <Button
                size="small"
                variant="ghost"
                class="shrink-0 whitespace-nowrap gap-1.5 px-2 text-text-weak hover:text-text-base"
                onClick={exportSession}
              >
                <Icon name="download" size="small" />
                <span>{ctx.t("export.session")}</span>
              </Button>
            </div>
            <Collapsible.Content>
              <Accordion multiple>
                <For each={messages()}>
                  {(message) => <RawMessage message={message} onRendered={restoreScroll} time={formatter().time} />}
                </For>
              </Accordion>
            </Collapsible.Content>
          </Collapsible>
        </section>
      </div>
    </ScrollView>
  )
}

function same<T>(a: readonly T[] | undefined, b: readonly T[] | undefined) {
  if (a === b) return true

  if (!a || !b) return false

  if (a.length !== b.length) return false

  return a.every((x, i) => x === b[i])
}
