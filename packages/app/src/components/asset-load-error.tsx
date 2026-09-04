import { Show } from "solid-js"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { useLanguage } from "@/context/language"

/**
 * Reports asset kinds that failed to load, with a retry.
 *
 * Shared by the Custom sidebar and the Chat asset workbench because both fetch several
 * asset lists at once and both must tell "the server did not answer" apart from "this
 * project has nothing" — collapsing those was P2-10, and the Chat surface had the same
 * hole one level up in `ModeWorkspace`.
 *
 * Renders nothing when `failed` is empty, so callers can mount it unconditionally.
 */
export function AssetLoadError(props: { failed: readonly string[]; total: number; onRetry: () => void }) {
  const language = useLanguage()
  return (
    <Show when={props.failed.length > 0}>
      <div
        data-slot="asset-load-error"
        class="flex items-center gap-2 rounded-md border border-v2-state-border-danger bg-v2-state-bg-danger px-2 py-1.5"
      >
        <Icon name="warning" size="small" class="shrink-0 text-v2-state-fg-danger" />
        <span class="min-w-0 flex-1 text-11-regular text-v2-state-fg-danger">
          {props.failed.length >= props.total
            ? language.t("asset.load.failed")
            : language.t("asset.load.partial", { kinds: props.failed.join(", ") })}
        </span>
        <ButtonV2 variant="neutral" size="small" onClick={props.onRetry}>
          {language.t("asset.load.retry")}
        </ButtonV2>
      </div>
    </Show>
  )
}
