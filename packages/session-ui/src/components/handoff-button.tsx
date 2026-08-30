import { For } from "solid-js"

/**
 * Handoff button properties.
 * Each button represents one handoff target available from an agent.
 */
export interface HandoffAction {
  readonly label: string
  readonly agent: string
  readonly prompt: string
  readonly onClick: () => void
}

export function HandoffButton(props: { actions: HandoffAction[] }) {
  if (!props.actions.length) return null

  return (
    <div data-component="handoff-actions" class="flex flex-wrap gap-2 mt-2">
      <For each={props.actions}>
        {(action) => (
          <button
            data-component="handoff-button"
            data-agent={action.agent}
            onClick={action.onClick}
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-13-medium border transition-colors cursor-pointer
              border-border-base bg-bg-base hover:bg-bg-soft active:bg-bg-strong
              text-text-base hover:text-text-strong"
          >
            <span aria-hidden="true" class="text-11 opacity-60">
              →
            </span>
            <span>{action.label}</span>
          </button>
        )}
      </For>
    </div>
  )
}
