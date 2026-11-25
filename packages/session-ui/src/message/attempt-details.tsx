import type { ModelSelection, SessionAttemptInfo, SessionMessageAssistant } from "@omnixa/client/promise"
import { useI18n } from "@omnixa/ui/context/i18n"
import { Icon } from "@omnixa/ui/icon"
import { IconButton } from "@omnixa/ui/icon-button"
import { Popover } from "@omnixa/ui/popover"
import { Tooltip } from "@omnixa/ui/tooltip"
import { For, Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useData } from "../context"

export function AssistantAttemptsPopover(props: { messages: readonly SessionMessageAssistant[] }) {
  const i18n = useI18n()
  const [state, setState] = createStore({ open: false })
  const messages = createMemo(() => props.messages.filter((message) => message.attempts?.length))

  const title = () =>
    i18n.plural(
      "ui.modelAttempts.title",
      messages().reduce((count, message) => count + (message.attempts?.length ?? 0), 0),
    )

  return (
    <Show when={messages().length}>
      <Tooltip appearance="compact" value={title()} placement="top" gutter={4}>
        <Popover
          open={state.open}
          onOpenChange={(open) => setState("open", open)}
          title={title()}
          placement="top-end"
          triggerAs={IconButton}
          triggerProps={{ variant: "ghost", size: "small", "aria-label": title() }}
          trigger={<Icon name="info" size="small" />}
          class="flex min-h-0 flex-col [&>[data-slot=popover-body]]:min-h-0 [&>[data-slot=popover-body]]:overflow-y-auto"
          style={{
            "max-width": "min(560px, calc(100vw - 24px))",
            width: "560px",
            "max-height": "min(70dvh, 640px, var(--kb-popper-content-available-height))",
          }}
        >
          <Show when={state.open}>
            <div class="flex min-w-0 flex-col gap-4">
              <For each={messages()}>{(message) => <AssistantAttemptDetails message={message} />}</For>
            </div>
          </Show>
        </Popover>
      </Tooltip>
    </Show>
  )
}

function AssistantAttemptDetails(props: { message: SessionMessageAssistant }) {
  const i18n = useI18n()
  const data = useData()
  const number = createMemo(() => new Intl.NumberFormat(i18n.locale()))

  const money = createMemo(
    () => new Intl.NumberFormat(i18n.locale(), { style: "currency", currency: "USD", maximumFractionDigits: 6 }),
  )

  const time = createMemo(() => new Intl.DateTimeFormat(i18n.locale(), { dateStyle: "short", timeStyle: "medium" }))

  const modelLabel = (model: ModelSelection) => {
    if ("type" in model) {
      const group = data.store.modelGroups?.find((group) => group.groupID === model.groupID)

      return i18n.t("ui.message.modelGroup", { name: group?.definition?.name || model.groupID })
    }

    return `${data.store.provider?.all.get(model.providerID)?.models[model.id]?.name ?? model.id} (${model.providerID})${model.variant ? ` #${model.variant}` : ""}`
  }

  const firstOutput = (attempt: SessionAttemptInfo) =>
    attempt.observations.find((observation) => observation.firstOutputAt !== undefined)?.firstOutputAt

  const firstToken = (attempt: SessionAttemptInfo) =>
    attempt.observations.find((observation) => observation.firstTokenAt !== undefined)?.firstTokenAt

  const cost = (amount: number | undefined) =>
    amount === undefined ? i18n.t("ui.modelAttempts.notReported") : money().format(amount)

  const failureLabel = (failure: NonNullable<SessionAttemptInfo["reason"]>) =>
    [
      i18n.tDynamic(`ui.modelAttempts.failureReason.${failure.reason}`, failure.reason),
      ...(failure.classification
        ? [i18n.tDynamic(`ui.modelAttempts.failureClassification.${failure.classification}`, failure.classification)]
        : []),
    ].join(" · ")

  return (
    <section class="w-full min-w-0 text-13-regular">
      <div class="flex min-w-0 flex-col gap-4 pt-3">
        <dl class="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
          <dt class="text-text-weak">{i18n.t("ui.modelAttempts.messageID")}</dt>
          <dd class="break-all font-mono">{props.message.id}</dd>
          <dt class="text-text-weak">{i18n.t("ui.modelAttempts.knownCost")}</dt>
          <dd>{cost(props.message.cost)}</dd>
          <Show when={props.message.unknownPriceAttempts !== undefined}>
            <dt class="text-text-weak">{i18n.t("ui.modelAttempts.unknownPrices")}</dt>
            <dd>{number().format(props.message.unknownPriceAttempts ?? 0)}</dd>
          </Show>
          <Show when={props.message.missingUsageAttempts !== undefined}>
            <dt class="text-text-weak">{i18n.t("ui.modelAttempts.missingUsage")}</dt>
            <dd>{number().format(props.message.missingUsageAttempts ?? 0)}</dd>
          </Show>
        </dl>
        <For each={props.message.attempts}>
          {(attempt) => {
            const latency = () => {
              const token = firstToken(attempt)

              return token !== undefined && token >= attempt.started ? token - attempt.started : undefined
            }

            const rate = () => {
              const token = firstToken(attempt)
              const terminal = attempt.terminal

              if (
                token === undefined ||
                terminal?.providerEndedAt === undefined ||
                !terminal.usage ||
                terminal.providerEndedAt <= token
              )
                return

              return ((terminal.usage.output + terminal.usage.reasoning) * 1_000) / (terminal.providerEndedAt - token)
            }

            const quotaStatus = () => {
              const quota = attempt.quota

              if (!quota) return "unknown"

              if (quota.status !== "known") return quota.status

              if (quota.freshUntil !== undefined && quota.freshUntil <= attempt.started) return "stale"

              return "known"
            }

            return (
              <section class="flex min-w-0 flex-col gap-2 border-t border-border-weak pt-3">
                <h4 class="font-medium">
                  {i18n.t("ui.modelAttempts.attempt", {
                    ordinal: number().format(attempt.ordinal + 1),
                    model: modelLabel(attempt.model),
                  })}
                </h4>
                <dl class="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 [&>dd]:break-words">
                  <dt class="text-text-weak">{i18n.t("ui.modelAttempts.attemptID")}</dt>
                  <dd class="break-all font-mono">{attempt.attemptID}</dd>
                  <dt class="text-text-weak">{i18n.t("ui.modelAttempts.selection")}</dt>
                  <dd>{modelLabel(attempt.selection)}</dd>
                  <dt class="text-text-weak">{i18n.t("ui.modelAttempts.apiModel")}</dt>
                  <dd class="break-all font-mono">{attempt.apiModelID}</dd>
                  <dt class="text-text-weak">{i18n.t("ui.modelAttempts.connection")}</dt>
                  <dd>
                    {attempt.connection
                      ? i18n.t(
                          attempt.connection.type === "credential"
                            ? "ui.modelAttempts.account"
                            : "ui.modelAttempts.environment",
                          {
                            name:
                              attempt.connection.type === "credential"
                                ? attempt.connection.id
                                : attempt.connection.name,
                          },
                        )
                      : i18n.t("ui.modelAttempts.notObserved")}
                  </dd>
                  <dt class="text-text-weak">{i18n.t("ui.modelAttempts.status")}</dt>
                  <dd>{i18n.t(`ui.modelAttempts.status.${attempt.terminal?.status ?? "started"}`)}</dd>
                  <dt class="text-text-weak">{i18n.t("ui.modelAttempts.transition")}</dt>
                  <dd>{i18n.t(`ui.modelAttempts.transition.${attempt.transition}`)}</dd>
                  <Show when={attempt.reason}>
                    <dt class="text-text-weak">{i18n.t("ui.modelAttempts.transitionReason")}</dt>
                    <dd>{attempt.reason ? failureLabel(attempt.reason) : undefined}</dd>
                  </Show>
                  <dt class="text-text-weak">{i18n.t("ui.modelAttempts.started")}</dt>
                  <dd>{time().format(attempt.started)}</dd>
                  <Show when={attempt.terminal}>
                    <dt class="text-text-weak">{i18n.t("ui.modelAttempts.ended")}</dt>
                    <dd>{time().format(attempt.terminal?.ended ?? attempt.started)}</dd>
                    <dt class="text-text-weak">{i18n.t("ui.modelAttempts.duration")}</dt>
                    <dd>
                      {i18n.t("ui.modelAttempts.durationMs", {
                        ms: number().format((attempt.terminal?.ended ?? attempt.started) - attempt.started),
                      })}
                    </dd>
                    <dt class="text-text-weak">{i18n.t("ui.modelAttempts.delivery")}</dt>
                    <dd>{i18n.t(`ui.modelAttempts.delivery.${attempt.terminal?.delivery ?? "unknown"}`)}</dd>
                  </Show>
                  <Show when={firstOutput(attempt) !== undefined}>
                    <dt class="text-text-weak">{i18n.t("ui.modelAttempts.firstOutput")}</dt>
                    <dd>{time().format(firstOutput(attempt) ?? attempt.started)}</dd>
                  </Show>
                  <dt class="text-text-weak">{i18n.t("ui.modelAttempts.ttft")}</dt>
                  <dd>
                    {latency() === undefined
                      ? i18n.t("ui.modelAttempts.notObserved")
                      : i18n.t("ui.modelAttempts.durationMs", { ms: number().format(latency()!) })}
                  </dd>
                  <dt class="text-text-weak">{i18n.t("ui.modelAttempts.tps")}</dt>
                  <dd>
                    {rate() === undefined
                      ? i18n.t("ui.modelAttempts.notObserved")
                      : i18n.t("ui.modelAttempts.tokensPerSecond", { rate: number().format(rate()!) })}
                  </dd>
                  <Show when={attempt.terminal?.providerEndedAt !== undefined}>
                    <dt class="text-text-weak">{i18n.t("ui.modelAttempts.providerEnded")}</dt>
                    <dd>{time().format(attempt.terminal!.providerEndedAt!)}</dd>
                  </Show>
                  <Show when={attempt.quota}>
                    <dt class="text-text-weak">{i18n.t("ui.modelAttempts.quota")}</dt>
                    <dd>{i18n.t(`ui.modelAttempts.quota.status.${quotaStatus()}`)}</dd>
                    <dt class="text-text-weak">{i18n.t("ui.modelAttempts.quota.source")}</dt>
                    <dd>{attempt.quota?.source}</dd>
                    <Show when={attempt.quota?.reason}>
                      {(reason) => (
                        <>
                          <dt class="text-text-weak">{i18n.t("ui.modelAttempts.quota.reason")}</dt>
                          <dd>{i18n.t(`ui.modelAttempts.quota.reason.${reason()}`)}</dd>
                        </>
                      )}
                    </Show>
                    <Show when={attempt.quota?.observedAt !== undefined}>
                      <dt class="text-text-weak">{i18n.t("ui.modelAttempts.quota.observed")}</dt>
                      <dd>{time().format(attempt.quota!.observedAt!)}</dd>
                    </Show>
                    <Show when={attempt.quota?.freshUntil !== undefined}>
                      <dt class="text-text-weak">{i18n.t("ui.modelAttempts.quota.freshUntil")}</dt>
                      <dd>{time().format(attempt.quota!.freshUntil!)}</dd>
                    </Show>
                  </Show>
                  <dt class="text-text-weak">{i18n.t("ui.modelAttempts.quote")}</dt>
                  <dd>{i18n.t(`ui.modelAttempts.quote.${attempt.quote.status}`)}</dd>
                  <dt class="text-text-weak">{i18n.t("ui.modelAttempts.quoteOrigin")}</dt>
                  <dd>
                    {attempt.quoteOrigin
                      ? i18n.tDynamic(`ui.modelAttempts.quoteOrigin.${attempt.quoteOrigin}`, attempt.quoteOrigin)
                      : i18n.t("ui.modelAttempts.notReported")}
                  </dd>
                  <Show when={"source" in attempt.quote && attempt.quote.source}>
                    <dt class="text-text-weak">{i18n.t("ui.modelAttempts.quoteSource")}</dt>
                    <dd>{"source" in attempt.quote ? attempt.quote.source : undefined}</dd>
                  </Show>
                  <Show when={"validFrom" in attempt.quote && attempt.quote.validFrom !== undefined}>
                    <dt class="text-text-weak">{i18n.t("ui.modelAttempts.quoteValidFrom")}</dt>
                    <dd>{"validFrom" in attempt.quote ? time().format(attempt.quote.validFrom!) : undefined}</dd>
                  </Show>
                  <Show when={"validUntil" in attempt.quote && attempt.quote.validUntil !== undefined}>
                    <dt class="text-text-weak">{i18n.t("ui.modelAttempts.quoteValidUntil")}</dt>
                    <dd>{"validUntil" in attempt.quote ? time().format(attempt.quote.validUntil!) : undefined}</dd>
                  </Show>
                  <dt class="text-text-weak">{i18n.t("ui.modelAttempts.cost")}</dt>
                  <dd>
                    {attempt.quote.status === "unknown"
                      ? i18n.t("ui.modelAttempts.quote.unknown")
                      : cost(attempt.terminal?.cost)}
                  </dd>
                  <Show when={attempt.terminal?.failure}>
                    <dt class="text-text-weak">{i18n.t("ui.modelAttempts.failure")}</dt>
                    <dd>
                      {attempt.terminal?.failure ? failureLabel(attempt.terminal.failure) : undefined}
                      {attempt.terminal?.failure?.status !== undefined ? ` · ${attempt.terminal.failure.status}` : ""}
                    </dd>
                  </Show>
                </dl>
                <Show
                  when={attempt.terminal?.usage}
                  fallback={<p class="text-text-weak">{i18n.t("ui.modelAttempts.usageMissing")}</p>}
                >
                  {(usage) => (
                    <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                      <dt class="text-text-weak">{i18n.t("ui.modelAttempts.tokens.input")}</dt>
                      <dd>{number().format(usage().input)}</dd>
                      <dt class="text-text-weak">{i18n.t("ui.modelAttempts.tokens.output")}</dt>
                      <dd>{number().format(usage().output)}</dd>
                      <dt class="text-text-weak">{i18n.t("ui.modelAttempts.tokens.reasoning")}</dt>
                      <dd>{number().format(usage().reasoning)}</dd>
                      <dt class="text-text-weak">{i18n.t("ui.modelAttempts.tokens.cacheRead")}</dt>
                      <dd>{number().format(usage().cache.read)}</dd>
                      <dt class="text-text-weak">{i18n.t("ui.modelAttempts.tokens.cacheWrite")}</dt>
                      <dd>{number().format(usage().cache.write)}</dd>
                    </dl>
                  )}
                </Show>
                <Show when={attempt.preparedDeployment}>
                  <p class="break-all text-text-weak">
                    {i18n.t("ui.modelAttempts.prepared", {
                      route: attempt.preparedDeployment?.route ?? "",
                      protocol: attempt.preparedDeployment?.protocol ?? "",
                      endpoint: attempt.preparedDeployment?.endpoint ?? "",
                    })}
                  </p>
                </Show>
                <For each={attempt.observations}>
                  {(observation) => (
                    <p class="break-words text-text-weak">
                      {i18n.t("ui.modelAttempts.observation", {
                        time: time().format(observation.observedAt),
                        transport: observation.transport
                          ? i18n.tDynamic(`ui.modelAttempts.transport.${observation.transport}`, observation.transport)
                          : i18n.t("ui.modelAttempts.notObserved"),
                        delivery: observation.delivery
                          ? i18n.t(`ui.modelAttempts.delivery.${observation.delivery}`)
                          : i18n.t("ui.modelAttempts.notObserved"),
                      })}
                      <Show when={observation.deployment}>
                        <span class="block break-all">
                          {observation.deployment?.route} · {observation.deployment?.protocol} ·{" "}
                          {observation.deployment?.endpoint}
                        </span>
                      </Show>
                      <Show when={observation.gatewayReport}>
                        {(report) => (
                          <span class="block break-words">
                            {i18n.tDynamic(
                              `ui.modelAttempts.gatewayReport.${report().source}`,
                              i18n.t("ui.modelAttempts.gatewayReport"),
                            )}
                            <Show when={report().provider}>
                              <span class="block">
                                {i18n.t("ui.modelAttempts.gatewayProvider", { provider: report().provider! })}
                              </span>
                            </Show>
                            <Show when={report().model}>
                              <span class="block">
                                {i18n.t("ui.modelAttempts.gatewayModel", { model: report().model! })}
                              </span>
                            </Show>
                          </span>
                        )}
                      </Show>
                    </p>
                  )}
                </For>
                <Show when={attempt.terminal?.gatewayAttempts?.length}>
                  <div class="flex min-w-0 flex-col gap-2 border-t border-border-weak pt-2">
                    <p class="font-medium text-text-weak">{i18n.t("ui.modelAttempts.gatewayAttempts")}</p>
                    <For each={attempt.terminal?.gatewayAttempts ?? []}>
                      {(gatewayAttempt) => (
                        <div class="flex min-w-0 flex-col gap-1 text-text-weak">
                          <span>
                            {i18n.t("ui.modelAttempts.gatewayAttempt", {
                              ordinal: number().format(gatewayAttempt.ordinal + 1),
                              target:
                                [gatewayAttempt.provider, gatewayAttempt.model].filter(Boolean).join(" / ") ||
                                i18n.t("ui.modelAttempts.notReported"),
                            })}
                            {gatewayAttempt.status !== undefined ? ` · ${gatewayAttempt.status}` : ""}
                            {gatewayAttempt.durationMs !== undefined
                              ? ` · ${i18n.t("ui.modelAttempts.durationMs", { ms: number().format(gatewayAttempt.durationMs) })}`
                              : ""}
                          </span>
                          <Show when={gatewayAttempt.account}>
                            <span class="break-all">
                              {i18n.t("ui.modelAttempts.gatewayAccount", { account: gatewayAttempt.account! })}
                            </span>
                          </Show>
                          <span>
                            {gatewayAttempt.quote
                              ? i18n.t(`ui.modelAttempts.quote.${gatewayAttempt.quote.status}`)
                              : i18n.t("ui.modelAttempts.quote.unknown")}
                            {gatewayAttempt.cost !== undefined ? ` · ${cost(gatewayAttempt.cost)}` : ""}
                          </span>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
                <Show when={"prices" in attempt.quote && attempt.quote.prices.length}>
                  <div class="max-w-full overflow-x-auto">
                    <table class="w-full text-start tabular-nums">
                      <caption class="pb-1 text-start text-text-weak">{i18n.t("ui.modelAttempts.prices")}</caption>
                      <thead>
                        <tr>
                          <th class="pr-3 text-start">{i18n.t("ui.modelAttempts.priceTier")}</th>
                          <th class="pr-3 text-start">{i18n.t("ui.modelAttempts.tokens.input")}</th>
                          <th class="pr-3 text-start">{i18n.t("ui.modelAttempts.tokens.output")}</th>
                          <th class="pr-3 text-start">{i18n.t("ui.modelAttempts.tokens.cacheRead")}</th>
                          <th class="text-start">{i18n.t("ui.modelAttempts.tokens.cacheWrite")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={"prices" in attempt.quote ? attempt.quote.prices : []}>
                          {(price) => (
                            <tr>
                              <td class="pr-3">
                                {price.tier ? number().format(price.tier.size) : i18n.t("ui.modelAttempts.basePrice")}
                              </td>
                              <td class="pr-3">{money().format(price.input)}</td>
                              <td class="pr-3">{money().format(price.output)}</td>
                              <td class="pr-3">{money().format(price.cache.read)}</td>
                              <td>{money().format(price.cache.write)}</td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </Show>
              </section>
            )
          }}
        </For>
      </div>
    </section>
  )
}
