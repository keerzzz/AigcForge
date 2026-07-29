import { Show, type VoidComponent } from "solid-js"
import { Icon } from "@aigcfroge/ui/v2/icon"

export interface SuggestionBarProps {
  show: boolean
  message: string
  onAccept: () => void
  onDismiss: () => void
}

export const SuggestionBar: VoidComponent<SuggestionBarProps> = (props) => {
  return (
    <Show when={props.show}>
      <div
        data-component="suggestion-bar"
        class="flex items-center gap-3 px-4 py-2 mx-4 mb-2 rounded-lg border
          border-border-base bg-bg-soft text-text-base text-13"
      >
        <Icon name="mode-chat" />
        <span class="flex-1">{props.message}</span>
        <button
          onClick={props.onAccept}
          class="px-3 py-1 rounded-md text-13-medium border transition-colors cursor-pointer
            border-border-base bg-bg-base hover:bg-bg-strong text-text-base hover:text-text-strong"
        >
          存为资产
        </button>
        <button
          onClick={props.onDismiss}
          aria-label="Dismiss"
          class="p-1 rounded transition-colors cursor-pointer hover:bg-bg-strong text-text-weak"
        >
          <Icon name="xmark-small" />
        </button>
      </div>
    </Show>
  )
}
