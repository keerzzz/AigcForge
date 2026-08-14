import { Show, type VoidComponent } from "solid-js"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { useLanguage } from "@/context/language"

export interface SuggestionBarProps {
  show: boolean
  message: string
  onAccept: () => void
  onDismiss: () => void
}

export const SuggestionBar: VoidComponent<SuggestionBarProps> = (props) => {
  const language = useLanguage()
  return (
    <Show when={props.show}>
      <div
        data-component="suggestion-bar"
        class="flex items-center gap-3 px-4 py-2 mx-4 mb-2 rounded-lg border
          border-v2-border-border-base bg-v2-background-bg-layer-02 text-v2-text-text-base text-13-regular"
      >
        <Icon name="mode-chat" />
        <span class="flex-1">{props.message}</span>
        <button
          onClick={props.onAccept}
          class="px-3 py-1 rounded-md text-13-medium border transition-colors cursor-pointer
            border-v2-border-border-base bg-v2-background-bg-base hover:bg-v2-background-bg-layer-03 text-v2-text-text-base"
        >
          {language.t("chatCapture.captureAsAsset")}
        </button>
        <button
          onClick={props.onDismiss}
          aria-label={language.t("common.dismiss")}
          class="p-1 rounded transition-colors cursor-pointer hover:bg-v2-background-bg-layer-03 text-v2-text-text-muted"
        >
          <Icon name="xmark-small" />
        </button>
      </div>
    </Show>
  )
}
