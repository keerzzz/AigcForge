import {
  Content,
  Item,
  ItemIndicator,
  ItemLabel,
  Listbox,
  Portal,
  Root,
  Section,
  Trigger,
  Value,
} from "@kobalte/core/select"
import { Show, createMemo, onCleanup, splitProps, type ComponentProps, type JSX } from "solid-js"
import "./select.css"

function groupOptions<T>(options: T[], groupBy?: (x: T) => string): { category: string; options: T[] }[] {
  if (!groupBy) {
    return [{ category: "", options }]
  }

  const map = new Map<string, T[]>()

  for (const opt of options) {
    const key = groupBy(opt)
    const arr = map.get(key)

    if (arr) arr.push(opt)
    else map.set(key, [opt])
  }

  return [...map.entries()].map(([category, opts]) => ({ category, options: opts }))
}

const ChevronDown = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path
      d="M11 9.5L8 6.5L5 9.5"
      stroke="currentColor"
      stroke-width="1"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
)

const CheckSmall = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path
      d="M3.53564 8.17857L6.39279 11.75L12.4642 4.25"
      stroke="currentColor"
      stroke-width="1"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
)

export type SelectProps<T> = Omit<
  ComponentProps<typeof Root<T, { category: string; options: T[] }>>,
  "value" | "onSelect" | "children" | "options" | "itemComponent" | "sectionComponent" | "defaultValue" | "multiple"
> & {
  placeholder?: string
  options: T[]
  /** Selected option (single selection). */
  current?: T
  value?: (x: T) => string
  label?: (x: T) => string
  groupBy?: (x: T) => string
  onSelect?: (value: T | null) => void
  onHighlight?: (value: T | undefined) => void | (() => void)
  invalid?: boolean
  numeric?: boolean
  children?: (item: T) => JSX.Element
  valueClass?: string
  contentClass?: string
}

type SelectHighlightState = {
  key?: string
  cleanup?: void | (() => void)
}

type SelectOption<T> = {
  key: string
  value: T
}

export function Select<T>(props: SelectProps<T>) {
  const [local, others] = splitProps(props, [
    "class",
    "classList",
    "placeholder",
    "options",
    "current",
    "value",
    "label",
    "groupBy",
    "onSelect",
    "onHighlight",
    "onOpenChange",
    "children",
    "invalid",
    "numeric",
    "disabled",
    "valueClass",
    "contentClass",
    "placement",
    "gutter",
    "sameWidth",
    "flip",
    "slide",
    "fitViewport",
    "optionDisabled",
  ])

  const state: SelectHighlightState = {}

  const stop = () => {
    state.cleanup?.()
    state.cleanup = undefined
    state.key = undefined
  }

  const keyFor = (item: T) => (local.value ? local.value(item) : String(item))
  // Kobalte interpolates keys into CSS selectors and skips optionValue for primitive options.
  const optionFor = (value: T) => ({ key: encodeURIComponent(JSON.stringify(keyFor(value))), value })

  const move = (item: T | undefined) => {
    if (!local.onHighlight) return

    if (!item) {
      stop()

      return
    }

    const key = keyFor(item)

    if (state.key === key) return
    state.cleanup?.()
    state.cleanup = local.onHighlight(item)
    state.key = key
  }

  onCleanup(stop)

  const current = createMemo(() => {
    const value = local.current

    if (value === undefined) return undefined

    if (value === null) return null

    return optionFor(value)
  })

  const grouped = createMemo(() => {
    const groupBy = local.groupBy

    return groupOptions(local.options.map(optionFor), groupBy ? (option) => groupBy(option.value) : undefined)
  })

  return (
    <Root<SelectOption<T>, { category: string; options: SelectOption<T>[] }>
      {...others}
      multiple={false}
      allowDuplicateSelectionEvents={false}
      disabled={local.disabled}
      data-component="select-v2-root"
      placement={local.placement ?? "bottom-end"}
      gutter={local.gutter ?? 4}
      sameWidth={local.sameWidth ?? false}
      flip={local.flip ?? true}
      slide={local.slide ?? true}
      fitViewport={local.fitViewport ?? false}
      value={current()}
      options={grouped()}
      optionValue="key"
      optionTextValue={(option) => (local.label ? local.label(option.value) : String(option.value))}
      optionDisabled={(option) => {
        const disabled = local.optionDisabled

        if (disabled === undefined || option.value == null) return false
        // SAFETY: The nullish guard preserves Kobalte's getDisabled boundary before using its non-null option contract.
        const value = option.value as Exclude<T, null>

        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- SAFETY: Kobalte's optionDisabled API accepts a property key or callback; dispatch this declared union without changing its behavior.
        return typeof disabled === "function" ? disabled(value) : Boolean(value[disabled])
      }}
      optionGroupChildren="options"
      placeholder={local.placeholder}
      sectionComponent={(sectionProps) => (
        <Section>
          <Show when={sectionProps.section.rawValue.category}>
            <div data-slot="menu-v2-group-label">{sectionProps.section.rawValue.category}</div>
          </Show>
        </Section>
      )}
      itemComponent={(itemProps) => (
        <Item
          {...itemProps}
          data-component="menu-v2-item"
          onPointerEnter={() => move(itemProps.item.rawValue.value)}
          onPointerMove={() => move(itemProps.item.rawValue.value)}
          onFocus={() => move(itemProps.item.rawValue.value)}
        >
          <ItemLabel data-slot="menu-v2-item-content" as="span">
            {local.children
              ? local.children(itemProps.item.rawValue.value)
              : local.label
                ? local.label(itemProps.item.rawValue.value)
                : String(itemProps.item.rawValue.value)}
          </ItemLabel>
          <ItemIndicator data-slot="menu-v2-item-indicator" forceMount>
            <CheckSmall />
          </ItemIndicator>
        </Item>
      )}
      onChange={(next) => {
        local.onSelect?.(next === null ? null : next.value)
        stop()
      }}
      onOpenChange={(open) => {
        local.onOpenChange?.(open)

        if (!open) stop()
      }}
    >
      <Trigger
        as="div"
        aria-label={props["aria-label"]}
        aria-labelledby={props["aria-labelledby"]}
        data-component="select-v2"
        data-appearance="inline"
        data-invalid={local.invalid ? "" : undefined}
        data-numeric={local.numeric ? "" : undefined}
        disabled={local.disabled}
        data-disabled={local.disabled ? "" : undefined}
        classList={{
          ...local.classList,
          [local.class ?? ""]: !!local.class,
        }}
      >
        <div data-slot="select-v2-value">
          <Value<SelectOption<T>> data-slot="select-v2-value-text" class={local.valueClass}>
            {(st) => {
              const selected = st.selectedOption()?.value

              if (local.label && selected != null) return local.label(selected)

              return selected != null ? String(selected) : ""
            }}
          </Value>
        </div>
        <span data-slot="select-v2-chevron" aria-hidden="true">
          <ChevronDown />
        </span>
      </Trigger>
      <Portal>
        {/* Kobalte's dialog observer keeps top-layer portals accessible. */}
        <Content
          class={local.contentClass}
          data-component="menu-v2-content"
          data-slot="select-v2-content"
          data-kb-top-layer=""
        >
          <Listbox data-slot="select-v2-listbox" />
        </Content>
      </Portal>
    </Root>
  )
}
