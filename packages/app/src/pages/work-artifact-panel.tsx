import { createSignal, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { Icon } from "@aigcfroge/ui/v2/icon"

/**
 * Work 右栏 Artifact 面板（M1 Phase D 填充候选稿预览 + 应用按钮）。
 * Phase C 先提供空态占位，注册进 MODE_SURFACES.work.RightPanel。
 */
export function WorkArtifactPanel() {
  const language = useLanguage()
  const [appliedPath, setAppliedPath] = createSignal<string | undefined>()

  return (
    <div class="flex h-full min-h-0 w-72 shrink-0 flex-col border-l border-v2-border-border-base bg-v2-background-bg-base">
      <div class="flex items-center gap-1.5 border-b border-v2-border-border-base px-3 py-2">
        <Icon name="mode-work" size="small" class="shrink-0 text-v2-icon-icon-muted" />
        <span class="text-v2-text-text-base text-13-medium">{language.t("work.artifact.tab")}</span>
      </div>
      <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <Show when={appliedPath()} fallback={<p class="text-v2-text-text-muted text-12-regular">{language.t("work.artifact.empty")}</p>}>
          <p class="text-v2-text-text-muted text-12-regular">{language.t("work.artifact.applied")}</p>
        </Show>
      </div>
    </div>
  )
}
