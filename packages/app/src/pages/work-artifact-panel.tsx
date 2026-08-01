import { createMemo, createSignal, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { useSync } from "@/context/sync"
import { useSessionLayout } from "@/pages/session/session-layout"
import { Markdown } from "@aigcfroge/session-ui/markdown"
import { ScrollView } from "@aigcfroge/ui/scroll-view"
import { findLatestAssistantMarkdown } from "@/pages/work-artifact-extract"
import type { Message } from "@aigcfroge/sdk/v2/client"

/**
 * Work 右栏 Artifact 面板：只读预览候选稿（assistant 消息正文）+ 应用入口。
 * 内容随会话消息实时更新；Phase E 填充同名冲突与落盘动作。
 */
export function WorkArtifactPanel() {
  const language = useLanguage()
  const sync = useSync()
  const [appliedPath, setAppliedPath] = createSignal<string | undefined>()
  let sessionLayout: ReturnType<typeof useSessionLayout> | undefined
  try {
    sessionLayout = useSessionLayout()
  } catch {
    sessionLayout = undefined
  }
  const sessionID = createMemo(() => sessionLayout?.params.id)

  const candidate = createMemo(() => {
    const id = sessionID()
    if (!id) return null
    const data = sync().data
    const messages = (data.message?.[id] ?? []) as readonly Message[]
    return findLatestAssistantMarkdown(messages, data.part)
  })

  return (
    <div class="flex h-full min-h-0 w-72 shrink-0 flex-col border-l border-v2-border-border-base bg-v2-background-bg-base">
      <div class="flex items-center gap-1.5 border-b border-v2-border-border-base px-3 py-2">
        <Icon name="mode-work" size="small" class="shrink-0 text-v2-icon-icon-muted" />
        <span class="text-v2-text-text-base text-13-medium">{language.t("work.artifact.tab")}</span>
      </div>
      <Show
        when={appliedPath()}
        fallback={
          <Show
            when={candidate()}
            fallback={
              <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
                <p class="text-v2-text-text-muted text-12-regular">{language.t("work.artifact.empty")}</p>
              </div>
            }
          >
            <ScrollView class="min-h-0 flex-1">
              <div class="flex flex-col gap-3 p-3">
                <Markdown text={candidate()!} />
                <ButtonV2
                  variant="contrast"
                  size="normal"
                  icon="check"
                  class="w-full"
                  onClick={() => setAppliedPath("pending")}
                >
                  {language.t("work.artifact.apply")}
                </ButtonV2>
              </div>
            </ScrollView>
          </Show>
        }
      >
        <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
          <p class="text-v2-text-text-muted text-12-regular">{language.t("work.artifact.applied")}</p>
        </div>
      </Show>
    </div>
  )
}
