import { Show } from "solid-js"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { Icon } from "@aigcfroge/ui/icon"
import { useLanguage } from "@/context/language"

export function GitStatusBar(props: {
  branch: string | undefined
  /**
   * The Location has no repository at all. This is the ADR-23 `missing` VCS
   * datum made visible (plan §11.2): a non-Git Location states so explicitly
   * instead of rendering an empty branch. It is deliberately distinct from a
   * Git Location whose branch has not loaded yet, which still renders nothing.
   */
  noVcs?: boolean
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
    <Show when={props.branch || props.noVcs}>
      <div class="flex items-center gap-2 px-3 py-1.5 border-b border-border-base bg-surface-base">
        <Show
          when={props.branch}
          fallback={
            <div class="flex items-center gap-1 min-w-0 shrink-0">
              <Icon name="branch" size="small" class="text-icon-weak shrink-0" />
              <span data-component="git-status-bar-no-vcs" class="text-12-medium text-text-weak truncate">
                {language.t("git.statusBar.noVcs")}
              </span>
            </div>
          }
        >
          <div class="flex items-center gap-1 min-w-0 shrink-0">
            <span class="font-mono text-11-regular text-accent-base shrink-0">git</span>
            <span data-component="git-status-bar-branch" class="text-12-medium text-text-strong truncate">
              {props.branch}
            </span>
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
        </Show>

        <div class="flex-1 min-w-0" />

        <Show when={!!props.branch && props.stagedCount > 0}>
          <ButtonV2 size="small" variant="ghost" onClick={props.onUnstageAll}>
            {language.t("git.statusBar.unstageAll")}
          </ButtonV2>
        </Show>
        <Show when={!!props.branch && props.unstagedCount > 0}>
          <ButtonV2 size="small" variant="ghost" onClick={props.onStageAll}>
            {language.t("git.statusBar.stageAll")}
          </ButtonV2>
        </Show>
      </div>
    </Show>
  )
}
