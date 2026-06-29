import { createSignal, For, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { Icon } from "@aigcfroge/ui/icon"
import { useLanguage } from "@/context/language"
import type { StatusBarSource } from "./types"
import type { StatusBarMetric, MetricGroup } from "./metrics"
import { METRIC_GROUP_I18N } from "./metrics"

function MetricsPopover(props: {
  metrics: StatusBarMetric[]
  pinnedIDs: string[]
  triggerEl: HTMLElement | undefined
  onToggle: (id: string) => void
  language: ReturnType<typeof useLanguage>
}) {
  const t = props.language.t

  const grouped = () => {
    const map = props.metrics.filter((metric) => metric.available()).reduce((groups, metric) => {
      groups.set(metric.group, [...(groups.get(metric.group) ?? []), metric])
      return groups
    }, new Map<MetricGroup, StatusBarMetric[]>())
    return Array.from(map.entries())
  }

  const style = () => {
    if (!props.triggerEl) return { visibility: "hidden" } as Record<string, string>
    const rect = props.triggerEl.getBoundingClientRect()
    return {
      position: "fixed",
      bottom: `${window.innerHeight - rect.top + 4}px`,
      left: `${rect.left}px`,
      "min-width": "280px",
    }
  }

  const theme = () => props.triggerEl?.closest("[data-theme]")?.getAttribute("data-theme") ?? undefined

  return (
    <Portal>
      <div
        data-theme={theme()}
        class="z-50 flex flex-col gap-1 py-1 rounded-lg bg-v2-background-bg-layer-01 shadow-[var(--v2-elevation-floating)] border border-v2-border-border-base"
        style={style()}
        onClick={(event) => event.stopPropagation()}
      >
        <For each={grouped()}>
          {([group, items]) => (
            <div>
              <div class="text-10-regular text-text-weak uppercase px-2 py-0.5">
                {t(METRIC_GROUP_I18N[group] ?? group)}
              </div>
              <For each={items}>
                {(metric) => (
                  <div class="flex items-center gap-2 w-full px-2 py-0.5 rounded-sm">
                    <span class="text-11-regular text-text-base flex-1 truncate">
                      {t(metric.labelKey)}
                    </span>
                    <span class="text-11-regular text-text-weak">{metric.value()}</span>
                    <button
                      type="button"
                      class="size-5 shrink-0 flex items-center justify-center rounded-sm text-v2-icon-icon-muted hover:text-v2-icon-icon-base focus-visible:outline focus-visible:outline-1 focus-visible:outline-v2-border-border-active transition-colors"
                      classList={{ "opacity-30 hover:opacity-80": !props.pinnedIDs.includes(metric.id), "opacity-100": props.pinnedIDs.includes(metric.id) }}
                      onClick={(e) => {
                        e.stopPropagation()
                        props.onToggle(metric.id)
                      }}
                      aria-label={
                        props.pinnedIDs.includes(metric.id)
                          ? t("statusBar.metrics.unpin")
                          : t("statusBar.metrics.pin")
                      }
                    >
                      <Icon name={props.pinnedIDs.includes(metric.id) ? "check-small" : "plus-small"} size="small" />
                    </button>
                  </div>
                )}
              </For>
            </div>
          )}
        </For>
      </div>
    </Portal>
  )
}

export function StatusBar(props: { source: StatusBarSource }) {
  const language = useLanguage()
  const [popoverOpen, setPopoverOpen] = createSignal(false)

  let triggerRef: HTMLDivElement | undefined

  const pinnedIDs = () => props.source.pinnedMetrics().map((m) => m.id)

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      setPopoverOpen(false)
      return
    }
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    setPopoverOpen((open) => !open)
  }

  return (
    <div
      ref={triggerRef}
      role="button"
      tabindex="0"
      aria-label={language.t("statusBar.metrics.details")}
      aria-expanded={popoverOpen()}
      class="h-6 shrink-0 flex items-center gap-4 px-3 border-t border-v2-border-border-base bg-v2-background-bg-base select-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-v2-border-border-active"
      onClick={() => setPopoverOpen((open) => !open)}
      onKeyDown={onKeyDown}
    >
      <span class="flex items-center gap-1.5">
        <span
          class="text-xs"
          classList={{
            "text-icon-success-base": props.source.connection().state === "online",
            "text-icon-critical-base": props.source.connection().state === "offline",
            "text-icon-weak": props.source.connection().state === "reconnecting",
          }}
        >
          ●
        </span>
        <span class="text-xs text-text-weak">{props.source.connection().serverName}</span>
      </span>

      <Show when={props.source.model()}>
        {(model) => (
          <span class="text-xs text-text-weak">
            {model().displayName}
            <Show when={model().variant}>
              {(v) => <span class="opacity-60"> · {v()}</span>}
            </Show>
          </span>
        )}
      </Show>

      <div
        class="flex items-center gap-4"
      >
        <For each={props.source.pinnedMetrics()}>
          {(metric) => (
            <span class="text-xs text-text-weak">{metric.value()}</span>
          )}
        </For>

        <Show when={popoverOpen()}>
          <MetricsPopover
            metrics={props.source.allMetrics()}
            pinnedIDs={pinnedIDs()}
            triggerEl={triggerRef}
            onToggle={(id) => {
              props.source.togglePin(id)
            }}
            language={language}
          />
        </Show>
      </div>

      <div class="flex-1" />

      <span class="text-xs text-text-weak truncate">
        {props.source.label()}
      </span>
    </div>
  )
}
