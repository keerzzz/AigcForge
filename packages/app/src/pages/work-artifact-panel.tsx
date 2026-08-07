import { For, Show, createMemo, createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { Dialog } from "@aigcfroge/ui/v2/dialog-v2"
import { useDialog } from "@aigcfroge/ui/context/dialog"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useLayout } from "@/context/layout"
import { ResizeHandle } from "@aigcfroge/ui/resize-handle"
import { createSizing } from "@/pages/session/helpers"
import { useSessionLayout } from "@/pages/session/session-layout"
import { Markdown } from "@aigcfroge/session-ui/markdown"
import { ScrollView } from "@aigcfroge/ui/scroll-view"
import { TabsV2 } from "@aigcfroge/ui/v2/tabs-v2"
import { SessionContextTab } from "@/components/session"
import { draftFilename, findLatestAssistantMarkdown } from "@/pages/work-artifact-extract"
import { captureWorkArtifactAsCandidate } from "@/pages/work-asset-capture"
import { setProposeCandidate } from "@/components/chat/prompt-asset-store"
import { diffTextLines } from "@/utils/text-diff"
import { describeApplyError, isConflictError } from "@/pages/work-artifact-error"
import type { Message } from "@aigcfroge/sdk/v2/client"

/** 覆盖确认时的只读 diff 展示（新旧内容对比）。 */
function WorkDiffView(props: { oldText: string; newText: string }) {
  const lines = createMemo(() => diffTextLines(props.oldText, props.newText))
  return (
    <div class="flex max-h-48 min-h-0 flex-col overflow-y-auto rounded-lg border border-v2-border-border-base">
      <For each={lines()}>
        {(line) => (
          <div
            class={[
              "bg-v2-background-bg-base text-v2-text-text-muted text-12-regular",
              line.type === "add" && "bg-v2-state-fg-success/10 text-v2-state-fg-success",
              line.type === "del" && "bg-v2-state-fg-danger/10 text-v2-state-fg-danger",
            ].join(" ")}
          >
            <span class="mr-2 inline-block w-6 select-none text-right opacity-50">
              {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
            </span>
            <span class="whitespace-pre-wrap break-all">{line.text}</span>
          </div>
        )}
      </For>
    </div>
  )
}

/**
 * Work 右栏 Artifact 面板（简单形态）：标题 + WorkArtifactContent。
 * 会话页使用 WorkSessionPanel（Context + Artifact 双 Tab，见下）。
 */
export function WorkArtifactPanel() {
  const language = useLanguage()
  return (
    <div class="flex h-full min-h-0 w-72 shrink-0 flex-col border-l border-v2-border-border-base bg-v2-background-bg-base">
      <div class="flex items-center gap-1.5 border-b border-v2-border-border-base px-3 py-2">
        <Icon name="mode-work" size="small" class="shrink-0 text-v2-icon-icon-muted" />
        <span class="text-v2-text-text-base text-13-medium">{language.t("work.artifact.tab")}</span>
      </div>
      <WorkArtifactContent />
    </div>
  )
}

/**
 * Work Artifact Tab 内容：只读预览候选稿（assistant 消息正文）+ 应用到当前项目。
 * 点击应用 → 原子落盘到当前 Location；目标同名时弹覆盖确认。
 */
export function WorkArtifactContent() {
  const language = useLanguage()
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()
  const [applying, setApplying] = createSignal(false)
  const [applied, setApplied] = createSignal<{ sessionID: string; content: string }>()
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

  // 仅当当前会话的候选稿与已应用内容一致时才显示"已应用"（绑定 sessionID，跨会话不串）；
  // 修订候选稿或切换会话后回到可应用状态。
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
      await sdk().client.workArtifact.apply({
        sessionID: id,
        directory: sdk().directory,
        title: relativePath,
        relativePath,
        content,
        overwrite,
      })
      setApplied({ sessionID: id, content })
    } catch (error) {
      if (!isConflictError(error)) {
        console.error("[work-artifact] apply failed:", describeApplyError(error))
        return
      }
      const relativePath = draftFilename(content)
      const oldContent = await sdk().client.file
        .read({ path: relativePath })
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

  // M2 存为资产（D3 方案 A）：候选稿 -> prompt kind CandidateInfo -> setProposeCandidate
  // 注入 Chat propose store。不自动切 mode：session 页以 session.mode 为权威
  // （app.tsx session effect 锁回），用户手动切 Chat 后右栏自动显示审查（store 已在）。
  function onSaveAsset() {
    const id = sessionID()
    const content = candidate()
    if (!id || !content) return
    const candidateInfo = captureWorkArtifactAsCandidate(content)
    if (!candidateInfo) return
    setProposeCandidate(id, candidateInfo)
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
            <ScrollView class="min-h-0 flex-1">
              <div class="flex flex-col gap-3 p-3">
                <Markdown text={candidate()!} />
                <div class="flex gap-2">
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
            </ScrollView>
          </Show>
        }
      >
        <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
          <p class="text-v2-text-text-muted text-12-regular">{language.t("work.artifact.applied")}</p>
        </div>
    </Show>
  )
}

/**
 * Work 会话右栏（双 Tab，对齐 coding/chat panel 架构，PRD §10.2）：
 * Context Tab（对齐 Code 模式）+ Artifact Tab。
 * 显隐复用 view().reviewPanel.opened()（对齐 chat/code；session-header 的
 * sidebar-right icon 点击 toggle 此状态），默认展开、可折叠。
 */
export function WorkSessionPanel() {
  const language = useLanguage()
  const sessionLayout = useSessionLayout()
  const layout = useLayout()
  const size = createSizing()
  const [tab, setTab] = createSignal<"context" | "artifact">("artifact")
  const reviewOpen = createMemo(() => sessionLayout.view().reviewPanel.opened())
  return (
    <aside
      id="review-panel"
      aria-label={language.t("work.artifact.tab")}
      aria-hidden={!reviewOpen()}
      inert={!reviewOpen()}
      class="relative h-full min-w-0 shrink-0 overflow-hidden bg-v2-background-bg-base"
      classList={{
        "border-l border-v2-border-border-base": reviewOpen(),
        "pointer-events-none": !reviewOpen(),
        "transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
          !size.active(),
      }}
      style={{ width: reviewOpen() ? `${layout.workPanel.width()}px` : "0px" }}
    >
      {/* 内层宽度跟随拖拽值，折叠动画期间内容不挤压重排 */}
      <div
        class="flex h-full min-h-0 shrink-0 flex-col"
        style={{ width: `${layout.workPanel.width()}px` }}
      >
        <TabsV2 value={tab()} onChange={(value) => setTab(value === "context" ? "context" : "artifact")}>
          <TabsV2.List class="shrink-0 border-b border-v2-border-border-base px-2">
            <TabsV2.Trigger value="context">{language.t("session.tab.context")}</TabsV2.Trigger>
            <TabsV2.Trigger value="artifact">{language.t("work.artifact.tab")}</TabsV2.Trigger>
          </TabsV2.List>
          <TabsV2.Content value="context" class="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Show when={tab() === "context"}>
              <div class="flex-1 min-h-0 overflow-hidden">
                <SessionContextTab />
              </div>
            </Show>
          </TabsV2.Content>
          <TabsV2.Content value="artifact" class="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Show when={tab() === "artifact"}>
              <WorkArtifactContent />
            </Show>
          </TabsV2.Content>
        </TabsV2>
      </div>
      {/* 宽度拖拽：对齐 code/chat B 区 ResizeHandle（edge=start 贴面板左缘） */}
      <Show when={reviewOpen()}>
        <div onPointerDown={() => size.start()}>
          <ResizeHandle
            direction="horizontal"
            edge="start"
            size={layout.workPanel.width()}
            min={280}
            max={520}
            onResize={(width) => {
              size.touch()
              layout.workPanel.resize(width)
            }}
          />
        </div>
      </Show>
    </aside>
  )
}
