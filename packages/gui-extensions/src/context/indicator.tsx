import { Show, createMemo, type ComponentProps, type JSX } from "solid-js"
import { ProgressCircle } from "@aigcfroge/ui/progress-circle"
import { IconButton } from "@aigcfroge/ui/icon-button"
import { Button } from "@aigcfroge/ui/button"
import { useSessionControlsExpanded } from "@aigcfroge/session-ui/context/controls"
import { Tooltip } from "@aigcfroge/ui/tooltip"
import { useI18n } from "@aigcfroge/ui/context/i18n"
import { useExtension, type MountedSession } from "../sdk"
import { catalogModel, syncCatalog } from "./catalog"
import { sessionContextUsage } from "./usage"
import { createSessionContextFormatter } from "./format"

function ContextTooltipRow(props: { name: JSX.Element; value: JSX.Element }) {
  return (
    <div class="flex min-w-0 items-center gap-4">
      <span class="shrink-0 text-v2-text-text-muted">{props.name}</span>
      <span class="ml-auto min-w-0 truncate text-right text-v2-text-text-base">{props.value}</span>
    </div>
  )
}

export function SessionContextUsage(props: {
  session: MountedSession
  variant?: "button" | "indicator"
  placement?: ComponentProps<typeof Tooltip>["placement"]
}) {
  const ctx = useExtension()
  const layout = ctx.layout
  const i18n = useI18n()
  const expanded = useSessionControlsExpanded()
  syncCatalog(() => props.session)

  const variant = createMemo(() => props.variant ?? "button")

  const messages = createMemo(() =>
    props.session.id ? props.session.server.data.session.message.list(props.session.id) : [],
  )

  const info = createMemo(() =>
    props.session.id ? props.session.server.data.session.get(props.session.id) : undefined,
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
    const model = catalogModel(props.session, current.model)?.model

    return {
      total: current.total,
      usage:
        current.total !== undefined && model?.limit.context
          ? Math.round((current.total / model.limit.context) * 100)
          : null,
    }
  })

  const formatter = createMemo(() => createSessionContextFormatter(i18n.locale()))

  const cost = createMemo(() => {
    const value = info()?.cost

    return value === undefined ? "—" : usd().format(value)
  })

  const openContext = () => {
    if (!props.session.id) return
    if (layout.narrow()) {
      layout.open(`${ctx.id}:main`, props.session)
      return
    }
    layout.toggle(`${ctx.id}:main`, props.session)
  }

  const circle = () => (
    <div class="flex items-center justify-center">
      <ProgressCircle
        appearance="indicator"
        size={16}
        strokeWidth={2}
        percentage={context()?.usage ?? 0}
        style={{
          "--progress-circle-background": "var(--v2-background-bg-layer-04, var(--border-weak-base))",
          "--progress-circle-background-overlay": "var(--v2-overlay-simple-overlay-pressed, transparent)",
          "--progress-circle-progress": "var(--v2-icon-icon-base, var(--icon-base))",
        }}
      />
    </div>
  )

  const compactCircle = () => (
    <div class="flex items-center justify-center">
      <ProgressCircle appearance="compact" percentage={context()?.usage ?? 0} />
    </div>
  )

  const tooltipValue = () => (
    <div class="flex w-[120px] flex-col gap-2">
      <ContextTooltipRow name={ctx.t("usage.cost")} value={cost()} />
      <ContextTooltipRow name={ctx.t("usage.usage")} value={formatter().percent(context()?.usage)} />
      <ContextTooltipRow name={ctx.t("usage.tokens")} value={formatter().number(context()?.total)} />
    </div>
  )

  return (
    <Show when={props.session.id}>
      <Tooltip value={tooltipValue()} placement={expanded() ? "top" : (props.placement ?? "top")} shift={-8}>
        <Show
          when={variant() === "indicator"}
          fallback={
            <Show
              when={expanded()}
              fallback={
                <IconButton
                  type="button"
                  variant="ghost-muted"
                  size="large"
                  icon={compactCircle()}
                  onClick={openContext}
                  aria-label={ctx.t("usage.view")}
                />
              }
            >
              <Button
                type="button"
                variant="ghost-muted"
                size="small"
                onClick={openContext}
                aria-label={ctx.t("usage.view")}
                class="flex items-center gap-2 whitespace-nowrap text-13-regular tabular-nums"
              >
                <span>
                  {ctx.t("usage.usage")} {formatter().percent(context()?.usage)}
                </span>
                <span>
                  {ctx.t("usage.cost")} {cost()}
                </span>
              </Button>
            </Show>
          }
        >
          {circle()}
        </Show>
      </Tooltip>
    </Show>
  )
}
