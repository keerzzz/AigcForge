import { Match, Show, Switch, createEffect, createMemo, createSignal } from "solid-js"
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
  workArtifactView,
} from "@/pages/work-artifact-extract"
import { captureWorkArtifactAsCandidate } from "@/pages/work-asset-capture"
import { setProposeCandidate } from "@/components/chat/prompt-asset-store"
import { showToast } from "@/utils/toast"
import { TextDiffView } from "@/pages/session/text-diff-view"
import { createActiveTabWriteback } from "@/pages/session/file-tab-strip"
import { WorkflowRuntimePanel } from "@/pages/session/workflow-runtime-panel"
import { describeApplyError, isConflictError } from "@/pages/work-artifact-error"
import type { Message } from "@aigcfroge/sdk/v2/client"
import { Schema } from "effect"
import { WorkReview } from "@aigcfroge/schema/work-review"
import { isRecord } from "@aigcfroge/core/util/record"
import { WorkReviewPanel } from "@/pages/work-review-panel"

const WORK_TABS = ["context", "artifact", "workflow"] as const
type WorkTab = (typeof WORK_TABS)[number]

const isWorkTab = (value: string | undefined): value is WorkTab =>
  typeof value === "string" && (WORK_TABS as readonly string[]).includes(value)

const decodeReviewRead = Schema.decodeUnknownOption(Schema.toCodecJson(WorkReview.ReadResult))

type ReviewReadRequest = {
  sessionID: string
  sessionEpoch: number
  readToken: number
  transitionToken: number
}
type ReviewTransitionRequest = { sessionID: string; sessionEpoch: number; token: number }

/** Read-only diff shown before confirming an overwrite. */
function WorkDiffView(props: { oldText: string; newText: string }) {
  return <TextDiffView oldText={props.oldText} newText={props.newText} variant="work" />
}

function errorDetails(error: unknown): { body: Record<string, unknown>; status?: number } {
  if (!isRecord(error)) return { body: {} }
  if (isRecord(error.cause)) {
    return {
      body: isRecord(error.cause.body) ? error.cause.body : {},
      status: typeof error.cause.status === "number" ? error.cause.status : undefined,
    }
  }
  if (isRecord(error.body)) return { body: error.body }
  return { body: error }
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

  const messagesReady = createMemo(() => {
    const id = sessionID()
    return !!id && sync().data.message[id] !== undefined
  })
  // Applied state belongs to the exact Session and candidate content.
  const appliedCurrent = createMemo(() => {
    const a = applied()
    const id = sessionID()
    const content = candidate()
    return a !== undefined && id !== undefined && content !== null && a.sessionID === id && a.content === content
  })
  const view = createMemo(() =>
    workArtifactView({
      ready: messagesReady(),
      hasCandidate: candidate() !== null,
      applied: appliedCurrent(),
    }),
  )
  const [reviewOpen, setReviewOpen] = createSignal(false)
  const [reviewReadState, setReviewReadState] = createSignal<{ sessionID: string; value: WorkReview.ReadResult }>()
  const reviewRead = createMemo(() => {
    const state = reviewReadState()
    if (!state || state.sessionID !== sessionID()) return undefined
    return state.value
  })
  const [reviewSessionEpoch, setReviewSessionEpoch] = createSignal(0)
  const [reviewReadToken, setReviewReadToken] = createSignal(0)
  const [reviewTransitionToken, setReviewTransitionToken] = createSignal(0)
  const [reviewLoading, setReviewLoading] = createSignal(false)
  const [reviewPending, setReviewPending] = createSignal<WorkReview.Command["action"]>()
  const [reviewNotice, setReviewNotice] = createSignal<WorkReviewPanel.Notice>()
  const [reviewSelectedAction, setReviewSelectedAction] = createSignal<WorkReview.Command["action"]>()
  let previousReviewSessionID = sessionID()

  createEffect(() => {
    const id = sessionID()
    if (id === previousReviewSessionID) return
    previousReviewSessionID = id
    setReviewSessionEpoch((epoch) => epoch + 1)
    setReviewReadToken((token) => token + 1)
    setReviewTransitionToken((token) => token + 1)
    setReviewOpen(false)
    setReviewReadState(undefined)
    setReviewLoading(false)
    setReviewPending(undefined)
    setReviewNotice(undefined)
    setReviewSelectedAction(undefined)
  })

  function beginReviewRead(id: string): ReviewReadRequest {
    const readToken = reviewReadToken() + 1
    setReviewReadToken(readToken)
    return {
      sessionID: id,
      sessionEpoch: reviewSessionEpoch(),
      readToken,
      transitionToken: reviewTransitionToken(),
    }
  }

  function isCurrentReviewRead(request: ReviewReadRequest) {
    return (
      reviewOpen() &&
      sessionID() === request.sessionID &&
      reviewSessionEpoch() === request.sessionEpoch &&
      reviewReadToken() === request.readToken &&
      reviewTransitionToken() === request.transitionToken
    )
  }

  function beginReviewTransition(id: string): ReviewTransitionRequest {
    const token = reviewTransitionToken() + 1
    setReviewTransitionToken(token)
    return { sessionID: id, sessionEpoch: reviewSessionEpoch(), token }
  }

  function isCurrentReviewTransition(request: ReviewTransitionRequest) {
    return (
      sessionID() === request.sessionID &&
      reviewSessionEpoch() === request.sessionEpoch &&
      reviewTransitionToken() === request.token
    )
  }

  const reviewActions = createMemo<ReadonlyArray<WorkReview.Command["action"]>>(() => {
    const read = reviewRead()
    if (!read || read.status === "unavailable") return []
    if (read.status === "none") return read.artifact ? ["submit"] : []
    if (!read.current) return read.review.state === "resolved" ? ["reopen"] : ["re_review"]
    if (read.review.state === "open") return ["request_changes", "approve"]
    if (read.review.state === "fix_requested") return ["respond"]
    if (read.review.state === "responded") return ["re_review"]
    return ["reopen"]
  })

  async function refreshReview(clearNotice = true) {
    const id = sessionID()
    if (!id || reviewPending() !== undefined) return
    const request = beginReviewRead(id)
    setReviewLoading(true)
    if (clearNotice) setReviewNotice(undefined)
    try {
      const result = await sdk().client.v2.session.workReview.get({ sessionID: id }, { throwOnError: true })
      const decoded = decodeReviewRead(result.data.data)
      if (!isCurrentReviewRead(request)) return
      if (decoded._tag === "None") {
        setReviewReadState(undefined)
        setReviewNotice({ kind: "read" })
        return
      }
      setReviewReadState({ sessionID: id, value: decoded.value })
      if (clearNotice) {
        setReviewNotice(undefined)
        setReviewSelectedAction(undefined)
      }
    } catch (error) {
      if (!isCurrentReviewRead(request)) return
      setReviewReadState(undefined)
      setReviewNotice(reviewNoticeFromError(error))
    } finally {
      if (isCurrentReviewRead(request)) {
        setReviewLoading(false)
      }
    }
  }

  function openReview() {
    setReviewOpen(true)
    if (reviewPending() === undefined) void refreshReview()
  }

  function closeReview() {
    setReviewOpen(false)
    setReviewReadToken((token) => token + 1)
    setReviewLoading(false)
  }

  function reviewCommand(action: WorkReview.Command["action"]): WorkReview.Command | undefined {
    const read = reviewRead()
    if (!read) return undefined
    if (action === "respond") {
      if (read.status !== "ready") return undefined
      return { action, expectedReviewRevision: read.review.revision }
    }
    const binding = read.status === "ready" ? read.artifact : read.status === "none" ? read.artifact : undefined
    if (!binding) return undefined
    return {
      action,
      expectedReviewRevision: read.status === "ready" ? read.review.revision : 0,
      artifactID: binding.artifactID,
      expectedArtifactRevision: binding.artifactRevision,
    }
  }

  async function transitionReview(action: WorkReview.Command["action"]) {
    if (reviewPending() !== undefined) return
    const command = reviewCommand(action)
    if (!command) return
    const id = sessionID()
    if (!id) return
    setReviewSelectedAction(action)
    setReviewPending(action)
    setReviewNotice(undefined)
    const request = beginReviewTransition(id)
    try {
      const result = await sdk().client.v2.session.workReview.transition(
        { sessionID: id, workReviewCommand: command },
        { throwOnError: true },
      )
      const decoded = decodeReviewRead(result.data.data)
      if (!isCurrentReviewTransition(request)) return
      if (decoded._tag === "None") {
        setReviewReadState(undefined)
        setReviewNotice({ kind: "read", action })
        setReviewPending(undefined)
        return
      }
      setReviewReadState({ sessionID: id, value: decoded.value })
      setReviewNotice(undefined)
      setReviewPending(undefined)
    } catch (error) {
      if (!isCurrentReviewTransition(request)) return
      const notice = reviewNoticeFromError(error, action)
      setReviewReadState(undefined)
      setReviewNotice(notice)
      setReviewPending(undefined)
      if (notice.kind === "conflict") await refreshReview(false)
    } finally {
      if (isCurrentReviewTransition(request)) setReviewPending(undefined)
    }
  }

  function reviewOpenButton() {
    return (
      <ButtonV2 type="button" variant="neutral" size="normal" data-action="work-review-open" onClick={openReview}>
        {language.t("work.review.open")}
      </ButtonV2>
    )
  }

  function reviewNoticeFromError(error: unknown, action?: WorkReview.Command["action"]): WorkReviewPanel.Notice {
    const details = errorDetails(error)
    const value = details.body
    const status = details.status
    const code = typeof value.code === "string" ? value.code : undefined
    const tag = typeof value._tag === "string" ? value._tag : undefined
    const committedRevision = typeof value.committedRevision === "number" ? value.committedRevision : undefined
    if (committedRevision !== undefined || code === "notification")
      return { kind: "committed", action, committedRevision }
    if (status === 401 || status === 403 || tag === "UnauthorizedError" || tag === "ForbiddenError")
      return { kind: "forbidden", action }
    if (status === 400 || tag === "InvalidRequestError" || tag === "UnsupportedProductModeError")
      return { kind: "invalid", action }
    if (status === 409 || tag === "ConflictError") return { kind: "conflict", action }
    if (tag === "SessionNotFoundError") return { kind: "read", action }
    return { kind: "network", action }
  }

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
      when={!reviewOpen()}
      fallback={
        <WorkReviewPanel.Panel
          read={reviewRead()}
          loading={reviewLoading()}
          pending={reviewPending()}
          notice={reviewNotice()}
          actions={reviewActions()}
          selectedAction={reviewSelectedAction()}
          onAction={(action) => void transitionReview(action)}
          onRefresh={() => void refreshReview()}
          onClose={closeReview}
        />
      }
    >
      <Switch>
        <Match when={view() === "loading"}>
          <div data-component="work-artifact-loading" aria-busy="true" class="flex min-h-0 flex-1 flex-col gap-2 p-3">
            <span class="sr-only">{language.t("common.loading")}</span>
            <div class="h-8 w-full animate-pulse rounded-md bg-v2-background-bg-layer-03" />
            <div class="h-24 w-full animate-pulse rounded-md bg-v2-background-bg-layer-02" />
            <div class="h-8 w-2/3 animate-pulse rounded-md bg-v2-background-bg-layer-03" />
          </div>
        </Match>
        <Match when={view() === "applied"}>
          <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
            <p class="text-v2-text-text-muted text-12-regular">{language.t("work.artifact.applied")}</p>
            {reviewOpenButton()}
          </div>
        </Match>
        <Match when={view() === "candidate"}>
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
              {reviewOpenButton()}
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
        </Match>
        <Match when={view() === "empty"}>
          <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
            <p class="text-v2-text-text-muted text-12-regular">{language.t("work.artifact.empty")}</p>
            {reviewOpenButton()}
          </div>
        </Match>
      </Switch>
    </Show>
  )
}

/** Work session panel with Context, Artifact, and the default project file-tree. */
export function WorkSessionPanel() {
  const language = useLanguage()
  const mode = useMode()
  const size = createSizing()
  const { tabs, params } = useSessionLayout()
  const activeTab = createMemo(() => {
    if (mode.currentMode !== "work") return "artifact"
    const active = tabs().active()
    if (isWorkTab(active)) return active
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
    if (!isWorkTab(tab)) return
    tabs().setActive(tab)
  }
  return (
    <SessionRightPanel modeID="work" size={size} ariaLabel={language.t("work.artifact.tab")}>
      <TabsV2 value={activeTab()} onChange={selectTab} class="flex min-h-0 flex-1 flex-col">
        <TabsV2.List class="shrink-0 border-b border-v2-border-border-base">
          <TabsV2.Trigger value="context">{language.t("session.tab.context")}</TabsV2.Trigger>
          <TabsV2.Trigger value="artifact">{language.t("work.artifact.tab")}</TabsV2.Trigger>
          <TabsV2.Trigger value="workflow">{language.t("workflowRuntime.title")}</TabsV2.Trigger>
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
        <TabsV2.Content value="workflow" class="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Show when={activeTab() === "workflow"}>
            <div class="min-h-0 flex-1 overflow-y-auto p-3">
              <WorkflowRuntimePanel sessionID={params.id} />
            </div>
          </Show>
        </TabsV2.Content>
      </TabsV2>
    </SessionRightPanel>
  )
}
