import { Badge } from "@omnixa/ui/badge"
import { Icon } from "@omnixa/ui/icon"
import { iconNames, type IconName } from "@omnixa/ui/icons/provider"
import { ProviderIcon } from "@omnixa/ui/provider-icon"
import type { JSX } from "solid-js"
import { For, Match, Show, Switch } from "solid-js"
import customManagedProvider from "@/providers/custom-managed-provider.svg"
import "@/settings/settings.css"

type ModelProvider = { id: string; canonical?: string; name: string }

type ModelItem = { provider: ModelProvider & { integrationID?: string }; cost?: { input: number } }

type ModelGroup<T> = { category: string; items: T[] }

export function CustomManagedProviderIcon(props: { class?: string }) {
  return <img data-component="custom-managed-provider-icon" src={customManagedProvider} alt="" class={props.class} />
}

export function ProviderModelIcon(props: { provider: ModelProvider; class?: string }) {
  const icon = () =>
    [props.provider.canonical, props.provider.canonical?.replace(/-token-plan$/, ""), props.provider.id].find(
      (id): id is IconName => !!id && id !== "synthetic" && iconNames.some((name) => name === id),
    )

  return (
    <Switch>
      <Match when={icon()} keyed>
        {(id) => <ProviderIcon id={id} width={16} height={16} class={props.class} />}
      </Match>
      <Match when={true}>
        <CustomManagedProviderIcon class={`size-4 ${props.class ?? ""}`} />
      </Match>
    </Switch>
  )
}

/** Provider sections for a model list. */
export function ProviderModelSections<T extends ModelItem>(props: {
  groups: ModelGroup<T>[]
  expanded: (key: string) => boolean
  disabled: boolean
  onExpandedChange: (key: string, expanded: boolean) => void
  rows: (items: T[]) => JSX.Element
  /** Trailing control in a direct provider's header. */
  action?: (group: ModelGroup<T>) => JSX.Element
  ref?: (providerID: string, element: HTMLElement) => void
}) {
  function Header(input: { id: string; icon: JSX.Element; title: JSX.Element; badge?: string; action?: JSX.Element }) {
    return (
      <h3 class="settings-models-group-header" classList={{ "justify-between": !!input.action }}>
        <button
          type="button"
          class="settings-models-group-trigger"
          aria-expanded={props.expanded(input.id)}
          disabled={props.disabled}
          onClick={() => props.onExpandedChange(input.id, !props.expanded(input.id))}
        >
          <span class="settings-models-group-chevron">
            <Icon name="chevron-down" size="small" classList={{ collapsed: !props.expanded(input.id) }} />
          </span>
          <span class="settings-models-group-label">
            {input.icon}
            <bdi class="settings-models-group-title">{input.title}</bdi>
            <Show when={input.badge}>{(badge) => <Badge>{badge()}</Badge>}</Show>
          </span>
        </button>
        {input.action}
      </h3>
    )
  }

  return (
    <For each={props.groups}>
      {(group) => (
        <section
          ref={(element) => props.ref?.(group.category, element)}
          class="settings-section"
          data-component="settings-models-provider"
          data-expanded={props.expanded(group.category) ? "" : undefined}
        >
          <Header
            id={group.category}
            icon={<ProviderModelIcon provider={group.items[0].provider} class="shrink-0" />}
            title={group.items[0].provider.name}
            action={props.action?.(group)}
          />
          <Show when={props.expanded(group.category)}>{props.rows(group.items)}</Show>
        </section>
      )}
    </For>
  )
}
