import { createMemo, createSignal, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { Dialog } from "@aigcfroge/ui/v2/dialog-v2"
import { useDialog } from "@aigcfroge/ui/context/dialog"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useSessionLayout } from "@/pages/session/session-layout"
import { Markdown } from "@aigcfroge/session-ui/markdown"
import { ScrollView } from "@aigcfroge/ui/scroll-view"
import { draftFilename, findLatestAssistantMarkdown } from "@/pages/work-artifact-extract"
import type { Message } from "@aigcfroge/sdk/v2/client"

/**
 * Work 右栏 Artifact 面板：只读预览候选稿（assistant 消息正文）+ 应用到当前项目。
 * 点击应用 → 原子落盘到当前 Location；目标同名时弹覆盖确认。
 */
export function WorkArtifactPanel() {
  const language = useLanguage()
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()
  const [applying, setApplying] = createSignal(false)
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

  async function apply(overwrite = false) {
    const id = sessionID()
    const content = candidate()
    if (!id || !content || applying()) return
    setApplying(true)
    try {
      const relativePath = draftFilename(content)
      await sdk().client.workArtifact.apply({
        sessionID: id,
        directory: sdk().directory,
        title: relativePath,
        relativePath,
        content,
        overwrite,
      })
      setAppliedPath(relativePath)
    } catch (error) {
      const status = typeof error === "object" && error !== null && "status" in error
        ? (error as { status: unknown }).status
        : undefined
      if (status === 409) {
        void dialog.show(() => (
          <Dialog title={language.t("work.artifact.conflict.title")} fit>
            <div class="flex min-h-0 flex-col gap-4 p-4" style={{ width: "400px" }}>
              <p class="text-v2-text-text-muted text-13-regular">
                {language.t("work.artifact.conflict.body", { path: draftFilename(content) })}
              </p>
              <div class="flex justify-end gap-2">
                <ButtonV2 variant="ghost" onClick={() => dialog.close()}>
                  {language.t("work.artifact.cancel")}
                </ButtonV2>
                <ButtonV2
                  variant="contrast"
                  onClick={() => {
                    dialog.close()
                    void apply(true)
                  }}
                >
                  {language.t("work.artifact.overwrite")}
                </ButtonV2>
              </div>
            </div>
          </Dialog>
        ))
      }
    } finally {
      setApplying(false)
    }
  }

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
                  disabled={applying()}
                  onClick={() => void apply()}
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
