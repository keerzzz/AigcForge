import { Show, createMemo, createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { Dialog } from "@aigcfroge/ui/v2/dialog-v2"
import { useDialog } from "@aigcfroge/ui/context/dialog"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useMode } from "@/context/mode"
import { createSizing } from "@/pages/session/helpers"
import { useSessionLayout } from "@/pages/session/session-layout"
import { Markdown } from "@aigcfroge/session-ui/markdown"
import { HtmlArtifact } from "@aigcfroge/session-ui/html-artifact"
import { ScrollView } from "@aigcfroge/ui/scroll-view"
import { TabsV2 } from "@aigcfroge/ui/v2/tabs-v2"
import { SessionRightPanel } from "@/components/session-right-panel"
import { SessionContextTab } from "@/components/session"
import {
  applyContentForDisk,
  detectArtifactFormat,
  draftFilename,
  extractHtmlBlock,
  findLatestAssistantMarkdown,
} from "@/pages/work-artifact-extract"
import { captureWorkArtifactAsCandidate } from "@/pages/work-asset-capture"
import { setProposeCandidate } from "@/components/chat/prompt-asset-store"
import { showToast } from "@/utils/toast"
import { TextDiffView } from "@/pages/session/text-diff-view"
import { createActiveTabWriteback } from "@/pages/session/file-tab-strip"
import { describeApplyError, isConflictError } from "@/pages/work-artifact-error"
import type { Message } from "@aigcfroge/sdk/v2/client"

/** Read-only diff shown before confirming an overwrite. */
function WorkDiffView(props: { oldText: string; newText: string }) {
  return <TextDiffView oldText={props.oldText} newText={props.newText} variant="work" />
}

/** Previews the latest Work artifact and applies it through the typed API. */
export function WorkArtifactContent() {
  const language = useLanguage()
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()
  const [applying, setApplying] = createSignal(false)
  const [applied, setApplied] = createSignal<{ sessionID: string; content: string }>()
  const sessionLayout = useSessionLayout()
  const sessionID = createMemo(() => sessionLayout.params.id)

  const candidate = createMemo(() => {
    const id = sessionID()
    if (!id) return null
    const data = sync().data
    const messages = (data.message?.[id] ?? []) as readonly Message[]
    return findLatestAssistantMarkdown(messages, data.part)
  })

  // Applied state belongs to the exact Session and candidate content.
  const appliedCurrent = createMemo(() => {
    const a = applied()
    const id = sessionID()
    const content = candidate()
    return a !== undefined && id !== undefined && content !== null && a.sessionID === id && a.content === content
  })

  async function apply(overwrite = false) {
    const id = sessionID()
    const content = candidate()
    if (!id || !content || applying()) return
    setApplying(true)
    try {
      const relativePath = draftFilename(content)
      await sdk().client.workArtifact.apply(
        {
          sessionID: id,
          directory: sdk().directory,
          title: relativePath,
          relativePath,
          content: applyContentForDisk(content),
          overwrite,
        },
        { throwOnError: true },
      )
      setApplied({ sessionID: id, content })
    } catch (error) {
      if (!isConflictError(error)) {
        console.error("[work-artifact] apply failed:", describeApplyError(error))
        showToast({
          title: language.t("common.requestFailed"),
          description: describeApplyError(error),
        })
        return
      }
      const relativePath = draftFilename(content)
      const oldContent = await sdk()
        .client.file.read({ path: relativePath })
        .then((r) => (r.data?.type === "text" ? r.data.content : undefined))
        .catch(() => undefined)
      void dialog.show(() => (
        <Dialog title={language.t("work.artifact.conflict.title")} fit>
          <div class="flex min-h-0 flex-col gap-4 p-4" style={{ width: "520px" }}>
            <p class="text-v2-text-text-muted text-13-regular">
              {language.t("work.artifact.conflict.body", { path: relativePath })}
            </p>
            <Show when={oldContent !== undefined}>
              <WorkDiffView oldText={oldContent ?? ""} newText={content} />
            </Show>
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
    } finally {
      setApplying(false)
    }
  }

  // Queue the candidate for Chat review without changing the authoritative Session mode.
  function onSaveAsset() {
    const id = sessionID()
    const content = candidate()
    if (!id || !content) return
    const candidateInfo = captureWorkArtifactAsCandidate(content, {
      name: language.t("work.asset.fallbackName"),
      description: language.t("work.asset.fallbackDescription"),
    })
    if (!candidateInfo) return
    setProposeCandidate(id, candidateInfo)
    showToast({ title: language.t("work.asset.save.success") })
  }

  return (
    <Show
      when={appliedCurrent()}
      fallback={
        <Show
          when={candidate()}
          fallback={
            <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
              <p class="text-v2-text-text-muted text-12-regular">{language.t("work.artifact.empty")}</p>
            </div>
          }
        >
          <div class="flex min-h-0 flex-1 flex-col">
            <Show
              when={detectArtifactFormat(candidate()!) === "html"}
              fallback={
                <ScrollView class="min-h-0 flex-1">
                  <div class="p-3">
                    <Markdown text={candidate()!} />
                  </div>
                </ScrollView>
              }
            >
              {/* The iframe owns scrolling so the action bar remains visible. */}
              <div class="min-h-0 flex-1 overflow-hidden p-3">
                <HtmlArtifact
                  html={extractHtmlBlock(candidate()!) ?? ""}
                  labels={{
                    preview: language.t("work.artifact.html.preview"),
                    code: language.t("work.artifact.html.code"),
                    renderError: language.t("work.artifact.html.renderError"),
                    viewCode: language.t("work.artifact.html.viewCode"),
                  }}
                />
              </div>
            </Show>
            <div class="flex shrink-0 gap-2 p-3 pt-0">
              <ButtonV2
                variant="contrast"
                size="normal"
                icon="folder-add-left"
                class="flex-1"
                disabled={applying()}
                onClick={() => void apply()}
              >
                {language.t("work.artifact.apply")}
              </ButtonV2>
              <Show when={candidate() !== null && !appliedCurrent()}>
                <ButtonV2
                  variant="neutral"
                  size="normal"
                  class="flex-1"
                  data-component="work-save-asset-button"
                  onClick={onSaveAsset}
                >
                  {language.t("work.asset.save")}
                </ButtonV2>
              </Show>
            </div>
          </div>
        </Show>
      }
    >
      <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <p class="text-v2-text-text-muted text-12-regular">{language.t("work.artifact.applied")}</p>
      </div>
    </Show>
  )
}

/** Work session panel with Context, Artifact, and the default project file-tree. */
export function WorkSessionPanel() {
  const language = useLanguage()
  const mode = useMode()
  const size = createSizing()
  const { tabs } = useSessionLayout()
  const activeTab = createMemo(() => {
    if (mode.currentMode !== "work") return "artifact"
    const active = tabs().active()
    if (active === "context" || active === "artifact") return active
    return "artifact"
  })
  // Keep the shared session tab store authoritative so the global context entry
  // points (stats bar / context usage) switch this panel too.
  createActiveTabWriteback({
    enabled: () => mode.currentMode === "work",
    activeTab,
    fallbackTab: () => "artifact",
    getActive: () => tabs()?.active(),
    setActive: (tab) => tabs()?.setActive(tab),
  })
  const selectTab = (value: string | number) => {
    const tab = String(value)
    if (tab !== "context" && tab !== "artifact") return
    tabs().setActive(tab)
  }
  return (
    <SessionRightPanel
      size={size}
      ariaLabel={language.t("work.artifact.tab")}
    >
      <TabsV2 value={activeTab()} onChange={selectTab} class="flex min-h-0 flex-1 flex-col">
        <TabsV2.List class="shrink-0 border-b border-v2-border-border-base">
          <TabsV2.Trigger value="context">{language.t("session.tab.context")}</TabsV2.Trigger>
          <TabsV2.Trigger value="artifact">{language.t("work.artifact.tab")}</TabsV2.Trigger>
        </TabsV2.List>
        <TabsV2.Content value="context" class="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Show when={activeTab() === "context"}>
            <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
              <SessionContextTab />
            </div>
          </Show>
        </TabsV2.Content>
        <TabsV2.Content value="artifact" class="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Show when={activeTab() === "artifact"}>
            <WorkArtifactContent />
          </Show>
        </TabsV2.Content>
      </TabsV2>
    </SessionRightPanel>
  )
}
