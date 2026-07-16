import { createMemo, createEffect, on, onCleanup, For, Show } from "solid-js"
import { useSync } from "@/context/sync"
import { checksum } from "@aigcfroge/core/util/encode"
import { findLast } from "@aigcfroge/core/util/array"
import { same } from "@/utils/same"
import { Icon } from "@aigcfroge/ui/icon"
import { AccordionV2 } from "@aigcfroge/ui/v2/accordion-v2"
import { StickyAccordionHeader } from "@aigcfroge/ui/sticky-accordion-header"
import { File } from "@aigcfroge/session-ui/file"
import { Markdown } from "@aigcfroge/session-ui/markdown"
import { ScrollView } from "@aigcfroge/ui/scroll-view"
import type { Message, Part, UserMessage } from "@aigcfroge/sdk/v2/client"
import { useLanguage } from "@/context/language"
import { useProviders } from "@/hooks/use-providers"
import { useSessionLayout } from "@/pages/session/session-layout"
import { getSessionContextMetrics } from "./session-context-metrics"
import { estimateSessionContextBreakdown, type SessionContextBreakdownKey } from "./session-context-breakdown"
import { createSessionContextFormatter } from "./session-context-format"
import { SessionToolActivity } from "./session-tool-activity"
import { SessionCacheDiagnostics } from "./session-cache-diagnostics"
import { Tag } from "@aigcfroge/ui/v2/badge-v2"

const BREAKDOWN_COLOR: Record<SessionContextBreakdownKey, string> = {
  system: "var(--syntax-info)",
  user: "var(--syntax-success)",
  assistant: "var(--syntax-property)",
  tool: "var(--syntax-warning)",
  other: "var(--syntax-comment)",
}

function RawMessageContent(props: { message: Message; getParts: (id: string) => Part[]; onRendered: () => void }) {
  const file = createMemo(() => {
    const parts = props.getParts(props.message.id)
    const contents = JSON.stringify({ message: props.message, parts }, null, 2)
    return {
      name: `${props.message.role}-${props.message.id}.json`,
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
  message: Message
  getParts: (id: string) => Part[]
  onRendered: () => void
  time: (value: number | undefined) => string
}) {
  return (
    <AccordionV2.Item value={props.message.id}>
      <StickyAccordionHeader>
        <AccordionV2.Trigger>
          <div class="flex items-center justify-between gap-2 w-full">
            <div class="min-w-0 truncate">
              {props.message.role} <span class="text-text-base">• {props.message.id}</span>
            </div>
            <div class="flex items-center gap-3">
              <div class="shrink-0 text-12-regular text-text-weak">{props.time(props.message.time.created)}</div>
              <Icon name="chevron-grabber-vertical" size="small" class="shrink-0 text-text-weak" />
            </div>
          </div>
        </AccordionV2.Trigger>
      </StickyAccordionHeader>
      <AccordionV2.Content class="bg-background-base">
        <div class="p-3">
          <RawMessageContent message={props.message} getParts={props.getParts} onRendered={props.onRendered} />
        </div>
      </AccordionV2.Content>
    </AccordionV2.Item>
  )
}

const emptyMessages: Message[] = []
const emptyUserMessages: UserMessage[] = []

export function SessionContextTab() {
  const sync = useSync()
  const language = useLanguage()
  const providers = useProviders()
  const { params, view } = useSessionLayout()

  const info = createMemo(() => (params.id ? sync().session.get(params.id) : undefined))

  const messages = createMemo(
    () => {
      const id = params.id
      if (!id) return emptyMessages
      return (sync().data.message[id] ?? [])
    },
    emptyMessages,
    { equals: same },
  )

  const userMessages = createMemo(
    () => messages().filter((m) => m.role === "user"),
    emptyUserMessages,
    { equals: same },
  )

  const visibleUserMessages = createMemo(
    () => {
      const revert = info()?.revert?.messageID
      if (!revert) return userMessages()
      return userMessages().filter((m) => m.id < revert)
    },
    emptyUserMessages,
    { equals: same },
  )

  const usd = createMemo(
    () =>
      new Intl.NumberFormat(language.intl(), {
        style: "currency",
        currency: "USD",
      }),
  )

  const metrics = createMemo(() => getSessionContextMetrics(messages(), [...providers.all().values()]))
  const ctx = createMemo(() => metrics().context)
  const formatter = createMemo(() => createSessionContextFormatter(language.intl()))

  const cost = createMemo(() => {
    return usd().format(metrics().totalCost)
  })

  const counts = createMemo(() => {
    const all = messages()
    const user = all.reduce((count, x) => count + (x.role === "user" ? 1 : 0), 0)
    const assistant = all.reduce((count, x) => count + (x.role === "assistant" ? 1 : 0), 0)
    return {
      all: all.length,
      user,
      assistant,
    }
  })

  const systemPrompt = createMemo(() => {
    const msg = findLast(visibleUserMessages(), (m) => !!m.system)
    const system = msg?.system
    if (!system) return
    const trimmed = system.trim()
    if (!trimmed) return
    return trimmed
  })

  const providerLabel = createMemo(() => {
    const c = ctx()
    if (!c) return "—"
    return c.providerLabel
  })

  const modelLabel = createMemo(() => {
    const c = ctx()
    if (!c) return "—"
    return c.modelLabel
  })

  const breakdown = createMemo(
    on(
      () => [ctx()?.message.id, ctx()?.input, messages().length, systemPrompt()],
      () => {
        const c = ctx()
        if (!c?.input) return []
        return estimateSessionContextBreakdown({
          messages: messages(),
          parts: sync().data.part as Record<string, Part[] | undefined>,
          input: c.input,
          systemPrompt: systemPrompt(),
        })
      },
    ),
  )

  const breakdownLabel = (key: SessionContextBreakdownKey) => {
    if (key === "system") return language.t("context.breakdown.system")
    if (key === "user") return language.t("context.breakdown.user")
    if (key === "assistant") return language.t("context.breakdown.assistant")
    if (key === "tool") return language.t("context.breakdown.tool")
    return language.t("context.breakdown.other")
  }


  let scroll: HTMLDivElement | undefined
  let frame: number | undefined
  let pending: { x: number; y: number } | undefined
  const getParts = (id: string) => (sync().data.part[id] ?? [])

  const allParts = createMemo(
    () => {
      const msgs = messages()
      const parts: Part[] = []
      for (const msg of msgs) {
        const msgParts = sync().data.part[msg.id]
        if (msgParts) parts.push(...msgParts)
      }
      return parts
    },
    [],
    { equals: same },
  )

  const restoreScroll = () => {
    const el = scroll
    if (!el) return

    const s = view().scroll("context")
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

      view().setScroll("context", next)
    })
  }

  createEffect(
    on(
      () => messages().length,
      () => {
        requestAnimationFrame(restoreScroll)
      },
      { defer: true },
    ),
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
      <div class="px-6 pt-4 pb-10 flex flex-col gap-6">
        {/* Overview Row */}
        <div class="flex flex-wrap items-center gap-2">
          <Tag>
            <span class="text-text-weak">{language.t("context.stats.session")}:</span>
            <span class="text-text-strong font-medium truncate max-w-48">
              {info()?.title ?? params.id ?? "—"}
            </span>
          </Tag>
          <Tag>
            <span class="text-text-weak">{language.t("context.stats.provider")}:</span>
            <span class="text-text-strong font-medium">
              {providerLabel()}
            </span>
          </Tag>
          <Tag>
            <span class="text-text-weak">{language.t("context.stats.model")}:</span>
            <span class="text-text-strong font-medium">
              {modelLabel()}
            </span>
          </Tag>
          <Tag>
            <span class="text-text-weak">{language.t("status.popover.trigger")}:</span>
            <div class="flex items-center gap-1">
              <span
                class="size-1.5 rounded-full"
                style={{
                  "background-color":
                    sync().data.session_status[params.id ?? ""]?.type === "busy"
                      ? "var(--syntax-success)"
                      : "var(--syntax-comment)",
                }}
              />
              <span class="text-text-strong font-medium">
                {sync().data.session_status[params.id ?? ""]?.type === "busy"
                  ? language.t("context.status.active")
                  : language.t("context.status.idle")}
              </span>
            </div>
          </Tag>
        </div>

        {/* Core Metrics Cards */}
        <div class="grid grid-cols-1 @[32rem]:grid-cols-2 gap-3">
          <div class="p-3.5 border border-border-weaker-base rounded-lg bg-surface-raised-base flex flex-col gap-1 shadow-[var(--v2-elevation-raised)]">
            <span class="text-12-regular text-text-weak">{language.t("context.stats.usage")}</span>
            <span class="text-24-medium text-text-strong tracking-tight">
              {formatter().percent(ctx()?.usage)}
            </span>
            <span class="text-11-regular text-text-weaker">
              {formatter().number(ctx()?.total)} / {formatter().number(ctx()?.limit)} tokens
            </span>
          </div>
          <div class="p-3.5 border border-border-weaker-base rounded-lg bg-surface-raised-base flex flex-col gap-1 shadow-[var(--v2-elevation-raised)]">
            <span class="text-12-regular text-text-weak">{language.t("context.stats.totalCost")}</span>
            <span class="text-24-medium text-text-strong tracking-tight">
              {cost()}
            </span>
            <span class="text-11-regular text-text-weaker">
              {counts().all.toLocaleString(language.intl())} {language.t("context.stats.messages")}
            </span>
          </div>
        </div>

        {/* Token Details */}
        <div class="flex flex-col gap-2">
          <span class="text-12-bold uppercase tracking-wider text-text-weak">{language.t("context.section.tokens")}</span>
          <div class="grid grid-cols-2 @[32rem]:grid-cols-4 gap-3 bg-surface-raised-base border border-border-weaker-base rounded-lg p-3">
            <div class="flex flex-col gap-0.5">
              <span class="text-11-regular text-text-weak">{language.t("context.stats.inputTokens")}</span>
              <span class="text-13-medium text-text-strong">{formatter().number(ctx()?.input)}</span>
            </div>
            <div class="flex flex-col gap-0.5">
              <span class="text-11-regular text-text-weak">{language.t("context.stats.outputTokens")}</span>
              <span class="text-13-medium text-text-strong">{formatter().number(ctx()?.output)}</span>
            </div>
            <div class="flex flex-col gap-0.5">
              <span class="text-11-regular text-text-weak">{language.t("context.stats.reasoningTokens")}</span>
              <span class="text-13-medium text-text-strong">{formatter().number(ctx()?.reasoning)}</span>
            </div>
            <div class="flex flex-col gap-0.5">
              <span class="text-11-regular text-text-weak">{language.t("context.stats.cacheTokens")}</span>
              <span class="text-13-medium text-text-strong">
                {formatter().number(ctx()?.cacheRead)} / {formatter().number(ctx()?.cacheWrite)}
              </span>
            </div>
          </div>
        </div>

        <Show when={breakdown().length > 0}>
          <div class="flex flex-col gap-2">
            <div class="text-12-regular text-text-weak">{language.t("context.breakdown.title")}</div>
            <div class="h-2 w-full rounded-full bg-surface-base overflow-hidden flex">
              <For each={breakdown()}>
                {(segment) => (
                  <div
                    class="h-full"
                    style={{
                      width: `${segment.width}%`,
                      "background-color": BREAKDOWN_COLOR[segment.key],
                    }}
                  />
                )}
              </For>
            </div>
            <div class="flex flex-wrap gap-x-3 gap-y-1">
              <For each={breakdown()}>
                {(segment) => (
                  <div class="flex items-center gap-1 text-11-regular text-text-weak">
                    <div class="size-2 rounded-sm" style={{ "background-color": BREAKDOWN_COLOR[segment.key] }} />
                    <div>{breakdownLabel(segment.key)}</div>
                    <div class="text-text-weaker">{segment.percent.toLocaleString(language.intl())}%</div>
                  </div>
                )}
              </For>
            </div>
            <div class="hidden text-11-regular text-text-weaker">{language.t("context.breakdown.note")}</div>
          </div>
        </Show>

        <Show when={params.id}>{(id) => (
          <>
            <SessionToolActivity parts={allParts} />
            <SessionCacheDiagnostics sessionID={id()} />
          </>
        )}
        </Show>

        {/* Activity & Messages */}
        <div class="flex flex-col gap-2">
          <span class="text-12-bold uppercase tracking-wider text-text-weak">{language.t("context.section.activity")}</span>
          <div class="grid grid-cols-1 @[32rem]:grid-cols-2 gap-3 bg-surface-raised-base border border-border-weaker-base rounded-lg p-3">
            <div class="grid grid-cols-2 gap-2">
              <div class="flex flex-col gap-0.5">
                <span class="text-11-regular text-text-weak">{language.t("context.stats.userMessages")}</span>
                <span class="text-13-medium text-text-strong">{counts().user.toLocaleString(language.intl())}</span>
              </div>
              <div class="flex flex-col gap-0.5">
                <span class="text-11-regular text-text-weak">{language.t("context.stats.assistantMessages")}</span>
                <span class="text-13-medium text-text-strong">{counts().assistant.toLocaleString(language.intl())}</span>
              </div>
            </div>
            <div class="flex flex-col gap-1 text-11-regular">
              <div class="flex justify-between">
                <span class="text-text-weak">{language.t("context.stats.sessionCreated")}:</span>
                <span class="text-text-strong font-medium">{formatter().time(info()?.time.created)}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-text-weak">{language.t("context.stats.lastActivity")}:</span>
                <span class="text-text-strong font-medium">{formatter().time(ctx()?.message.time.created)}</span>
              </div>
            </div>
          </div>
        </div>

        <Show when={systemPrompt()}>
          {(prompt) => (
            <div class="flex flex-col gap-2">
              <div class="text-12-regular text-text-weak">{language.t("context.systemPrompt.title")}</div>
              <div class="border border-border-base rounded-md bg-surface-base px-3 py-2">
                <Markdown text={prompt()} class="text-12-regular" />
              </div>
            </div>
          )}
        </Show>

        <div class="flex flex-col gap-2">
          <div class="text-12-regular text-text-weak">{language.t("context.rawMessages.title")}</div>
          <AccordionV2 multiple>
            <For each={messages()}>
              {(message) => (
                <RawMessage message={message} getParts={getParts} onRendered={restoreScroll} time={formatter().time} />
              )}
            </For>
          </AccordionV2>
        </div>
      </div>
    </ScrollView>
  )
}
