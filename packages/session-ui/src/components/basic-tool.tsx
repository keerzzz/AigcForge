import {
  children,
  createEffect,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
  type Accessor,
  type JSX,
} from "solid-js"
import { animate, type AnimationPlaybackControls } from "motion"
import { useI18n } from "@aigcfroge/ui/context/i18n"
import { createStore } from "solid-js/store"
import { Collapsible } from "@aigcfroge/ui/collapsible"
import { Icon, type IconProps } from "@aigcfroge/ui/icon"
import { TextShimmerV2 } from "@aigcfroge/ui/v2/text-shimmer-v2"

export type TriggerTitle = {
  title: string
  titleClass?: string
  subtitle?: string
  subtitleClass?: string
  args?: string[]
  argsClass?: string
  action?: JSX.Element
}

const isTriggerTitle = (val: any): val is TriggerTitle => {
  return (
    typeof val === "object" && val !== null && "title" in val && (typeof Node === "undefined" || !(val instanceof Node))
  )
}

export interface BasicToolProps {
  icon: IconProps["name"]
  trigger: TriggerTitle | JSX.Element | ((open: Accessor<boolean>) => JSX.Element)
  children?: JSX.Element
  status?: string
  hideDetails?: boolean
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  forceOpen?: boolean
  defer?: boolean
  locked?: boolean
  animated?: boolean
  onSubtitleClick?: () => void
  onTriggerClick?: JSX.EventHandlerUnion<HTMLElement, MouseEvent>
  triggerHref?: string
  clickable?: boolean
}

// Status text is announced to assistive tech; the shimmer only conveys state visually.
const statusKey: Record<
  string,
  "ui.tool.status.pending" | "ui.tool.status.running" | "ui.tool.status.completed" | "ui.tool.status.failed"
> = {
  pending: "ui.tool.status.pending",
  running: "ui.tool.status.running",
  completed: "ui.tool.status.completed",
  error: "ui.tool.status.failed",
}

const SPRING = { type: "spring" as const, visualDuration: 0.35, bounce: 0 }
const deferredMounts: Array<{ active: boolean; fn: () => void }> = []
let deferredFrame: number | undefined

function flushDeferredMounts() {
  while (deferredMounts.length > 0) {
    // Timeline tools are mounted top-to-bottom, but the viewport starts at the latest turn.
    // Pop from the end so heavy default-open bodies near the bottom become interactive first.
    const item = deferredMounts.pop()!
    if (item.active) {
      deferredFrame = deferredMounts.length > 0 ? requestAnimationFrame(flushDeferredMounts) : undefined
      item.fn()
      return
    }
  }
  deferredFrame = undefined
}

function scheduleDeferredFlush() {
  if (deferredFrame !== undefined) return
  deferredFrame = requestAnimationFrame(() => {
    deferredFrame = requestAnimationFrame(flushDeferredMounts)
  })
}

function scheduleDeferredMount(fn: () => void) {
  const item = { active: true, fn }
  deferredMounts.push(item)
  scheduleDeferredFlush()
  return () => {
    item.active = false
  }
}

function scheduleFrameMount(fn: () => void) {
  const frame = requestAnimationFrame(fn)
  return () => cancelAnimationFrame(frame)
}

export function BasicTool(props: BasicToolProps) {
  const i18n = useI18n()
  const [state, setState] = createStore({
    open: props.defaultOpen ?? false,
    ready: !props.defer && (props.defaultOpen ?? false),
  })
  const open = () => props.open ?? state.open
  const ready = () => state.ready
  const pending = () => props.status === "pending" || props.status === "running"
  const hasChildren = () => "children" in props
  // Discover visible content without constructing a hidden or deferred body early.
  const resolved = children(() => (props.hideDetails || (props.defer && !ready()) ? undefined : props.children))
  const expandable = () =>
    !props.hideDetails &&
    (props.defer
      ? hasChildren()
      : resolved
          .toArray()
          .some((child) =>
            typeof child === "string" ? child.trim().length > 0 : child != null && typeof child !== "boolean",
          ))
  const dynamicTrigger = typeof props.trigger === "function" ? props.trigger(open) : undefined
  const statusLabel = () => {
    const key = props.status ? statusKey[props.status] : undefined
    return key ? i18n.t(key) : undefined
  }

  let cancelReady: (() => void) | undefined

  const cancel = () => {
    cancelReady?.()
    cancelReady = undefined
  }

  const scheduleReady = (initial = false) => {
    cancel()
    cancelReady = (initial ? scheduleDeferredMount : scheduleFrameMount)(() => {
      cancelReady = undefined
      if (!open()) return
      setState("ready", true)
    })
  }

  onCleanup(cancel)

  onMount(() => {
    if (props.defer && open()) scheduleReady(true)
  })

  const setOpen = (value: boolean) => {
    if (props.open === undefined) setState("open", value)
    props.onOpenChange?.(value)
  }

  createEffect(() => {
    if (!props.forceOpen) return
    if (open()) return
    setOpen(true)
  })

  // Output can enable deferred rendering without changing a controlled open value.
  createEffect(
    on(
      [open, () => props.defer],
      ([value, deferred]) => {
        if (!deferred) return
        if (!value) {
          cancel()
          setState("ready", false)
          return
        }

        scheduleReady()
      },
      { defer: true },
    ),
  )

  // Animated height for collapsible open/close
  let contentRef: HTMLDivElement | undefined
  let heightAnim: AnimationPlaybackControls | undefined
  const initialOpen = open()

  createEffect(
    on(
      open,
      (isOpen) => {
        if (!props.animated || !contentRef) return
        heightAnim?.stop()
        if (isOpen) {
          contentRef.style.overflow = "hidden"
          heightAnim = animate(contentRef, { height: "auto" }, SPRING)
          void heightAnim.finished.then(() => {
            if (!contentRef || !open()) return
            contentRef.style.overflow = "visible"
            contentRef.style.height = "auto"
          })
        } else {
          contentRef.style.overflow = "hidden"
          heightAnim = animate(contentRef, { height: "0px" }, SPRING)
        }
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    heightAnim?.stop()
  })

  const handleOpenChange = (value: boolean) => {
    if (pending()) return
    if (props.locked && !value) return
    setOpen(value)
  }

  const trigger = () => (
    <div
      data-component="tool-trigger"
      data-clickable={props.clickable ? "true" : undefined}
      data-hide-details={props.hideDetails ? "true" : undefined}
    >
      <div data-slot="basic-tool-tool-trigger-content">
        <span data-slot="basic-tool-tool-indicator">
          <Icon name={props.icon} size="small" />
        </span>
        <div data-slot="basic-tool-tool-info">
          <Switch>
            <Match when={dynamicTrigger !== undefined}>{dynamicTrigger}</Match>
            <Match when={isTriggerTitle(props.trigger) && props.trigger}>
              {(title) => (
                <div data-slot="basic-tool-tool-info-structured">
                  <div data-slot="basic-tool-tool-info-main">
                    <span
                      data-slot="basic-tool-tool-title"
                      classList={{
                        [title().titleClass ?? ""]: !!title().titleClass,
                      }}
                    >
                      <TextShimmerV2 text={title().title} active={pending()} />
                    </span>
                    <Show when={!pending()}>
                      <Show when={title().subtitle}>
                        <span
                          data-slot="basic-tool-tool-subtitle"
                          classList={{
                            [title().subtitleClass ?? ""]: !!title().subtitleClass,
                            clickable: !!props.onSubtitleClick,
                          }}
                          onClick={(e) => {
                            if (props.onSubtitleClick) {
                              e.stopPropagation()
                              props.onSubtitleClick()
                            }
                          }}
                        >
                          {title().subtitle}
                        </span>
                      </Show>
                      <Show when={title().args?.length}>
                        <For each={title().args}>
                          {(arg) => (
                            <span
                              data-slot="basic-tool-tool-arg"
                              classList={{
                                [title().argsClass ?? ""]: !!title().argsClass,
                              }}
                            >
                              {arg}
                            </span>
                          )}
                        </For>
                      </Show>
                    </Show>
                  </div>
                  <Show when={!pending() && title().action}>
                    <span data-slot="basic-tool-tool-action">{title().action}</span>
                  </Show>
                </div>
              )}
            </Match>
            <Match when={true}>{props.trigger as JSX.Element}</Match>
          </Switch>
        </div>
        <Show when={statusLabel()}>
          <span data-slot="basic-tool-tool-status" class="sr-only">
            {/* Pad the label so it stays a discrete token for assistive tech, not glued
                to the tool title or to the revealed body text. */}{" "}
            {statusLabel()}{" "}
          </span>
        </Show>
      </div>
      <Show when={expandable() && !props.locked && !pending()}>
        <Collapsible.Arrow />
      </Show>
    </div>
  )

  return (
    <Collapsible open={open()} onOpenChange={handleOpenChange} class="tool-collapsible">
      <Show
        when={expandable()}
        fallback={
          // Not a disclosure: a real link/action stays a native control, so nothing
          // claims aria-expanded/aria-controls for a body that does not exist.
          <Switch>
            <Match when={props.triggerHref}>
              <a
                data-component="tool-trigger-link"
                data-slot="collapsible-action"
                data-hide-details={props.hideDetails ? "true" : undefined}
                href={props.triggerHref}
                onClick={props.onTriggerClick}
              >
                {trigger()}
              </a>
            </Match>
            <Match when={props.onTriggerClick}>
              <button
                type="button"
                data-component="tool-trigger-button"
                data-slot="collapsible-action"
                data-hide-details={props.hideDetails ? "true" : undefined}
                onClick={props.onTriggerClick}
              >
                {trigger()}
              </button>
            </Match>
            <Match when={true}>{trigger()}</Match>
          </Switch>
        }
      >
        <Show
          when={props.triggerHref}
          fallback={
            <Collapsible.Trigger
              data-hide-details={props.hideDetails ? "true" : undefined}
              onClick={props.onTriggerClick}
            >
              {trigger()}
            </Collapsible.Trigger>
          }
        >
          {(href) => (
            <Collapsible.Trigger
              as="a"
              href={href()}
              data-hide-details={props.hideDetails ? "true" : undefined}
              onClick={props.onTriggerClick}
            >
              {trigger()}
            </Collapsible.Trigger>
          )}
        </Show>
      </Show>
      <Show when={hasChildren() && !props.hideDetails}>
        <Switch>
          <Match when={props.animated}>
            <div
              ref={contentRef}
              data-slot="collapsible-content"
              data-animated
              style={{
                height: initialOpen ? "auto" : "0px",
                overflow: initialOpen ? "visible" : "hidden",
              }}
            >
              <Show when={!props.defer || ready()}>{resolved()}</Show>
            </div>
          </Match>
          <Match when={true}>
            <Collapsible.Content>
              <Show when={!props.defer || ready()}>{resolved()}</Show>
            </Collapsible.Content>
          </Match>
        </Switch>
      </Show>
    </Collapsible>
  )
}

function label(input: Record<string, unknown> | undefined) {
  const keys = ["description", "query", "url", "filePath", "path", "pattern", "name"]
  return keys.map((key) => input?.[key]).find((value): value is string => typeof value === "string" && value.length > 0)
}

function args(input: Record<string, unknown> | undefined) {
  if (!input) return []
  const skip = new Set(["description", "query", "url", "filePath", "path", "pattern", "name"])
  return Object.entries(input)
    .filter(([key]) => !skip.has(key))
    .flatMap(([key, value]) => {
      if (typeof value === "string") return [`${key}=${value}`]
      if (typeof value === "number") return [`${key}=${value}`]
      if (typeof value === "boolean") return [`${key}=${value}`]
      return []
    })
    .slice(0, 3)
}

export function GenericTool(
  props: Omit<BasicToolProps, "icon" | "trigger" | "children" | "defer"> & {
    tool: string
    input?: Record<string, unknown>
    output?: string
    deferContent?: boolean
  },
) {
  const i18n = useI18n()

  return (
    <BasicTool
      {...props}
      icon="mcp"
      defer={props.deferContent && !!props.output}
      trigger={{
        title: i18n.t("ui.basicTool.called", { tool: props.tool }),
        subtitle: label(props.input),
        args: args(props.input),
      }}
    >
      <Show when={props.output}>
        {(output) => (
          <div data-component="tool-output" data-scrollable>
            <pre>
              <code>{output()}</code>
            </pre>
          </div>
        )}
      </Show>
    </BasicTool>
  )
}
