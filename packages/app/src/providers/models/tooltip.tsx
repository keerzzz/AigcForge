import type { ModelSourceMetadata, ModelSourceOrigins } from "@omnixa/client/promise"
import { For, Show, type Component, type JSX } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"

type InputKey = "text" | "image" | "audio" | "video" | "pdf"

type InputMap = Record<InputKey, boolean>

type ModelInfo = {
  id: string
  name: string
  provider: {
    name: string
  }
  capabilities?: {
    reasoning: boolean
    input: InputMap
  }
  modalities?: {
    input: Array<string>
  }
  reasoning?: boolean
  metadata?: ModelSourceMetadata
  origins?: ModelSourceOrigins
  limit: {
    context: number
  }
}

function ModelTooltipRow(props: { name: JSX.Element; value: JSX.Element; source?: JSX.Element }) {
  return (
    <div class="flex min-w-0 items-center gap-4">
      <span class="shrink-0 text-v2-text-text-muted">{props.name}</span>
      <span class="ml-auto flex min-w-0 flex-col gap-0.5 text-right text-v2-text-text-base">
        <span class="break-words">{props.value}</span>
        <Show when={props.source}>
          <span class="text-11-regular text-v2-text-text-muted">{props.source}</span>
        </Show>
      </span>
    </div>
  )
}

export const ModelTooltip: Component<{ model: ModelInfo; latest?: boolean; free?: boolean; v2?: boolean }> = (
  props,
) => {
  const language = useLanguage()

  const sourceName = (model: ModelInfo) => {
    const value = `${model.id} ${model.name}`.toLowerCase()

    if (/claude|anthropic/.test(value)) return language.t("model.provider.anthropic")

    if (/gpt|o[1-4]|codex|openai/.test(value)) return language.t("model.provider.openai")

    if (/gemini|palm|bard|google/.test(value)) return language.t("model.provider.google")

    if (/grok|xai/.test(value)) return language.t("model.provider.xai")

    if (/llama|meta/.test(value)) return language.t("model.provider.meta")

    return model.provider.name
  }

  const inputLabel = (value: string) => {
    if (value === "text") return language.t("model.input.text")

    if (value === "image") return language.t("model.input.image")

    if (value === "audio") return language.t("model.input.audio")

    if (value === "video") return language.t("model.input.video")

    if (value === "pdf") return language.t("model.input.pdf")

    return value
  }

  const title = () => {
    const tags: Array<string> = []

    if (props.latest) tags.push(language.t("model.tag.latest"))

    if (props.free) tags.push(language.t("model.tag.free"))
    const suffix = tags.length ? ` (${tags.join(", ")})` : ""

    return `${sourceName(props.model)} ${props.model.name}${suffix}`
  }

  const name = () => {
    const tags: Array<string> = []

    if (props.latest) tags.push(language.t("model.tag.latest"))

    if (props.free) tags.push(language.t("model.tag.free"))
    const suffix = tags.length ? ` (${tags.join(", ")})` : ""

    return `${props.model.name}${suffix}`
  }

  const inputs = () => {
    if (props.model.capabilities) {
      const input = props.model.capabilities.input
      const order: Array<InputKey> = ["text", "image", "audio", "video", "pdf"]
      const entries = order.flatMap((key) => (input[key] ? [inputLabel(key)] : []))

      return entries.length ? entries.join(", ") : undefined
    }

    const raw = props.model.modalities?.input

    if (!raw) return
    const entries = raw.map((value) => inputLabel(value))

    return entries.length ? entries.join(", ") : undefined
  }

  const reasoning = () => {
    if (props.model.capabilities)
      return props.model.capabilities.reasoning
        ? language.t("model.tooltip.reasoning.allowed")
        : language.t("model.tooltip.reasoning.none")

    return props.model.reasoning
      ? language.t("model.tooltip.reasoning.allowed")
      : language.t("model.tooltip.reasoning.none")
  }

  const context = () => language.t("model.tooltip.context", { limit: props.model.limit.context.toLocaleString() })
  const source = (value: string | undefined) => (value ? language.t("provider.model.origin." + value) : undefined)

  const contextLimit = () =>
    props.model.metadata?.limit?.context !== undefined
      ? props.model.metadata.limit.context.toLocaleString(language.intl())
      : props.model.origins?.limit?.context === "runtime-default"
        ? props.model.limit.context.toLocaleString(language.intl())
        : language.t("provider.model.unknown")

  const modalities = (field: "input" | "output") => {
    const value = props.model.metadata?.capabilities?.[field]

    if (value === undefined) return language.t("provider.model.unknown")

    return value.length ? value.map(inputLabel).join(", ") : language.t("provider.model.modalities.none")
  }

  const prices = () => {
    const quote = props.model.metadata?.quote

    return quote && quote.status !== "unknown" ? quote.prices : []
  }

  if (props.v2) {
    return (
      <div class="flex w-[280px] max-w-[calc(100vw_-_32px)] flex-col gap-2">
        <ModelTooltipRow
          name={language.t("model.tooltip.model")}
          value={name()}
          source={source(props.model.origins?.name)}
        />
        <ModelTooltipRow name={language.t("model.tooltip.provider")} value={props.model.provider.name} />
        <ModelTooltipRow
          name={language.t("model.tooltip.inputs")}
          value={modalities("input")}
          source={source(props.model.origins?.capabilities?.input)}
        />
        <ModelTooltipRow
          name={language.t("provider.model.outputs")}
          value={modalities("output")}
          source={source(props.model.origins?.capabilities?.output)}
        />
        <ModelTooltipRow
          name={language.t("provider.model.tools")}
          value={
            props.model.metadata?.capabilities?.tools === undefined
              ? language.t("provider.model.unknown")
              : language.t(
                  props.model.metadata.capabilities.tools
                    ? "provider.model.override.supported"
                    : "provider.model.override.unsupported",
                )
          }
          source={source(props.model.origins?.capabilities?.tools)}
        />
        <ModelTooltipRow
          name={language.t("model.tooltip.context.label")}
          value={contextLimit()}
          source={source(props.model.origins?.limit?.context)}
        />
        <ModelTooltipRow
          name={language.t("provider.model.price")}
          value={language.t("provider.model.quote." + (props.model.metadata?.quote?.status ?? "unknown"))}
          source={source(props.model.origins?.quote)}
        />
        <For each={prices()}>
          {(price) => (
            <div class="flex flex-col gap-0.5 text-11-regular text-v2-text-text-muted">
              <Show when={price.tier}>
                {(tier) => <span>{language.t("provider.model.priceTier", { tokens: tier().size })}</span>}
              </Show>
              <p>{language.t("provider.model.prices", { input: price.input, output: price.output })}</p>
            </div>
          )}
        </For>
      </div>
    )
  }

  return (
    <div class="flex flex-col gap-1 py-1">
      <div class="text-13-medium">{title()}</div>
      <Show when={inputs()}>
        {(value) => (
          <div class="text-12-regular text-text-invert-base">
            {language.t("model.tooltip.allows", { inputs: value() })}
          </div>
        )}
      </Show>
      <div class="text-12-regular text-text-invert-base">{reasoning()}</div>
      <div class="text-12-regular text-text-invert-base">{context()}</div>
    </div>
  )
}
