import { Show } from "solid-js"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { useLanguage } from "@/context/language"

export function GitStatusBar(props: {
  branch: string | undefined
  ahead?: number
  behind?: number
  stagedCount: number
  unstagedCount: number
  hasChanges: boolean
  onStageAll: () => void
  onUnstageAll: () => void
}) {
  const language = useLanguage()

  return (
    <Show when={props.branch}>
      <div class="flex items-center gap-2 px-3 py-1.5 border-b border-border-base bg-surface-base">
        <div class="flex items-center gap-1 min-w-0 shrink-0">
          <span class="font-mono text-11-regular text-accent-base shrink-0">git</span>
          <span class="text-12-medium text-text-strong truncate">{props.branch}</span>
        </div>

        <Show when={props.ahead !== undefined && props.ahead > 0}>
          <span class="text-11-regular text-text-weaker shrink-0">
            {language.t("git.ahead", { count: String(props.ahead) })}
          </span>
        </Show>
        <Show when={props.behind !== undefined && props.behind > 0}>
          <span class="text-11-regular text-text-weaker shrink-0">
            {language.t("git.behind", { count: String(props.behind) })}
          </span>
        </Show>

        <div class="flex-1 min-w-0" />

        <Show when={props.stagedCount > 0}>
          <ButtonV2 size="small" variant="ghost" onClick={props.onUnstageAll}>
            {language.t("git.statusBar.unstageAll")}
          </ButtonV2>
        </Show>
        <Show when={props.unstagedCount > 0}>
          <ButtonV2 size="small" variant="ghost" onClick={props.onStageAll}>
            {language.t("git.statusBar.stageAll")}
          </ButtonV2>
        </Show>
      </div>
    </Show>
  )
}
