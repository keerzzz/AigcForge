import { createSignal, For, Show } from "solid-js"
import { Icon } from "@aigcfroge/ui/icon"
import { Popover } from "@aigcfroge/ui/popover"
import { useLanguage } from "@/context/language"
import type { StatusBarSource } from "./types"
import type { StatusBarMetric, MetricGroup } from "./metrics"
import { METRIC_GROUP_I18N } from "./metrics"

function MetricsPopover(props: {
  metrics: StatusBarMetric[]
  pinnedIDs: string[]
  onToggle: (id: string) => void
  language: ReturnType<typeof useLanguage>
}) {
  const t = props.language.t

  const grouped = () => {
    const map = props.metrics
      .filter((metric) => metric.available())
      .reduce((groups, metric) => {
        groups.set(metric.group, [...(groups.get(metric.group) ?? []), metric])
        return groups
      }, new Map<MetricGroup, StatusBarMetric[]>())
    return Array.from(map.entries())
  }

  return (
    <div
      class="flex flex-col gap-1 py-1 rounded-lg bg-v2-background-bg-layer-01 shadow-[var(--v2-elevation-floating)] border border-v2-border-border-base min-w-[280px]"
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
                  <span class="text-11-regular text-text-base flex-1 truncate">{t(metric.labelKey)}</span>
                  <span class="text-11-regular text-text-weak">{metric.value()}</span>
                  <button
                    type="button"
                    class="size-5 shrink-0 flex items-center justify-center rounded-sm text-v2-icon-icon-muted hover:text-v2-icon-icon-base focus-visible:outline focus-visible:outline-1 focus-visible:outline-v2-border-border-active transition-colors"
                    classList={{
                      "opacity-30 hover:opacity-80": !props.pinnedIDs.includes(metric.id),
                      "opacity-100": props.pinnedIDs.includes(metric.id),
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      props.onToggle(metric.id)
                    }}
                    aria-label={
                      props.pinnedIDs.includes(metric.id) ? t("statusBar.metrics.unpin") : t("statusBar.metrics.pin")
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
  )
}

export function StatusBar(props: { source: StatusBarSource }) {
  const language = useLanguage()
  const [popoverOpen, setPopoverOpen] = createSignal(false)
  const [anchorRect, setAnchorRect] = createSignal<DOMRect | undefined>()

  const pinnedIDs = () => props.source.pinnedMetrics().map((m) => m.id)

  return (
    <Popover
      open={popoverOpen()}
      onOpenChange={(open) => {
        setPopoverOpen(open)
        if (!open) setAnchorRect(undefined)
      }}
      getAnchorRect={(anchor) => anchorRect() ?? anchor?.getBoundingClientRect()}
      flip
      slide
      fitViewport
      overflowPadding={8}
      restoreFocusOnOutsideClose
      triggerAs="div"
      triggerProps={{
        role: "button",
        tabindex: "0",
        "aria-label": language.t("statusBar.metrics.details"),
        "aria-expanded": popoverOpen(),
        onPointerDown: (event: PointerEvent) => {
          if (event.button !== 0) return
          setAnchorRect(new DOMRect(event.clientX, event.clientY, 0, 0))
        },
        onKeyDown: (event: KeyboardEvent) => {
          if (event.key === "Enter" || event.key === " ") setAnchorRect(undefined)
        },
        class:
          "h-6 shrink-0 flex items-center gap-4 px-3 border-t border-v2-border-border-base bg-v2-background-bg-base select-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-v2-border-border-active",
      }}
      trigger={
        <div data-component="status-bar" class="contents">
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
                <Show when={model().variant}>{(v) => <span class="opacity-60"> · {v()}</span>}</Show>
              </span>
            )}
          </Show>

          <Show when={props.source.permission()}>
            {(permission) => (
              <span
                data-component="status-bar-permission"
                data-kind={permission().kind}
                class="text-xs"
                classList={{
                  "text-icon-warning-base": permission().kind === "full",
                  "text-icon-critical-base": permission().kind === "blocked",
                  "text-icon-weak": permission().kind === "degraded",
                }}
                aria-label={`${language.t("statusBar.permission.aria")}: ${language.t(`statusBar.permission.${permission().kind}`)}${permission().reason ? ` (${permission().reason})` : ""}`}
                title={
                  permission().reason
                    ? `${language.t(`statusBar.permission.${permission().kind}`)} · ${permission().reason}`
                    : language.t(`statusBar.permission.${permission().kind}`)
                }
              >
                {language.t(`statusBar.permission.${permission().kind}`)}
              </span>
            )}
          </Show>

          <div class="flex items-center gap-4">
            <For each={props.source.pinnedMetrics()}>
              {(metric) => <span class="text-xs text-text-weak">{metric.value()}</span>}
            </For>
          </div>

          <div class="flex-1" />

          <Show when={props.source.label()}>
            {(label) => (
              <div class="contents">
                <button
                  type="button"
                  class="shrink-0 flex items-center gap-1 px-1.5 rounded-sm text-xs text-text-weak hover:text-text-base hover:bg-v2-background-bg-hover transition-colors"
                  onClick={(e) => {
                    e.stopPropagation()
                    props.source.openContext()
                  }}
                  aria-label={language.t("statusBar.openContext")}
                >
                  <Icon name="checklist" size="small" />
                </button>
                <span class="text-xs text-text-weak truncate">{label()}</span>
              </div>
            )}
          </Show>
        </div>
      }
      class="[&_[data-slot=popover-body]]:p-0 w-auto max-w-[calc(100vw-40px)] bg-transparent border-0 shadow-none rounded-xl"
      gutter={4}
      placement="top-start"
    >
      <Show when={popoverOpen()}>
        <MetricsPopover
          metrics={props.source.allMetrics()}
          pinnedIDs={pinnedIDs()}
          onToggle={(id) => {
            props.source.togglePin(id)
          }}
          language={language}
        />
      </Show>
    </Popover>
  )
}
