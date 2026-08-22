import { For, Show, createMemo, createResource, createSignal, onCleanup } from "solid-js"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { Icon } from "@aigcfroge/ui/v2/icon"
import type { WorkflowAssetStepRunInfo } from "@aigcfroge/sdk/v2/client"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import {
  canCancelRun,
  canCancelStep,
  canRetryStep,
  createWorkflowRuntimeAdapter,
  isWorkflowUpdatedForSession,
  workflowStatusKey,
  workflowStatusTone,
  type WorkflowMutationOutcome,
  type WorkflowRuntimeAdapter,
  type WorkflowStatusResponse,
} from "./workflow-runtime-model"

export function WorkflowRuntimePanel(props: { sessionID?: string; adapter?: WorkflowRuntimeAdapter }) {
  const language = useLanguage()
  const sdk = useSDK()
  const serverSDK = useServerSDK()
  const runtime = createMemo(() => props.adapter ?? createWorkflowRuntimeAdapter(sdk().client))
  const [actionNotice, setActionNotice] = createSignal<string | undefined>()
  const [status, { refetch }] = createResource(
    () => props.sessionID,
    async (sessionID): Promise<WorkflowStatusResponse> => runtime().get(sessionID),
  )

  const refreshOnWorkflowEvent = (event: { name: string; details: unknown }) => {
    if (event.name !== sdk().directory) return
    if (!props.sessionID || !isWorkflowUpdatedForSession(event.details, props.sessionID)) return
    void refetch()
  }

  const unsubscribe = serverSDK().event.listen(refreshOnWorkflowEvent)
  onCleanup(unsubscribe)

  // Every mutation ends with a reload: the server is the only authority on the
  // resulting run state, and a rejected optimistic revision must never leave
  // the panel showing what the user hoped for instead of what happened.
  const invoke = async (action: Promise<WorkflowMutationOutcome>) => {
    let result: WorkflowMutationOutcome
    try {
      result = await action
    } catch (error) {
      result = { outcome: "failed", message: error instanceof Error ? error.message : String(error) }
    }
    setActionNotice(
      result.outcome === "accepted"
        ? undefined
        : result.outcome === "conflict"
          ? language.t("workflowRuntime.mutationConflict")
          : language.t("workflowRuntime.mutationFailed", { message: result.message }),
    )
    await refetch()
  }

  const cancelRun = (run: NonNullable<WorkflowStatusResponse["run"]>) =>
    invoke(
      runtime().cancelRun({
        sessionID: run.sessionID,
        runID: run.id,
        expectedRunRevision: run.revision,
      }),
    )

  const cancelStep = (run: NonNullable<WorkflowStatusResponse["run"]>, step: WorkflowAssetStepRunInfo) =>
    invoke(
      runtime().cancelStep({
        sessionID: run.sessionID,
        runID: run.id,
        stepRunID: step.id,
        expectedRunRevision: run.revision,
        expectedStepRevision: step.revision,
      }),
    )

  const retryStep = (run: NonNullable<WorkflowStatusResponse["run"]>, step: WorkflowAssetStepRunInfo) =>
    invoke(
      runtime().retryStep({
        sessionID: run.sessionID,
        runID: run.id,
        stepRunID: step.id,
        expectedRunRevision: run.revision,
        expectedStepRevision: step.revision,
      }),
    )

  return (
    <section class="flex flex-col gap-3 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-02 p-3" data-component="workflow-runtime-panel">
      <div class="flex items-center justify-between gap-2">
        <div class="flex min-w-0 items-center gap-2">
          <Icon name="mode-custom" size="small" class="shrink-0 text-v2-text-text-base" />
          <h2 class="truncate text-12-medium text-v2-text-text-base">{language.t("workflowRuntime.title")}</h2>
        </div>
        <ButtonV2
          variant="ghost"
          size="small"
          aria-label={language.t("workflowRuntime.reload")}
          disabled={status.loading}
          onClick={() => void refetch()}
        >
          {language.t("workflowRuntime.reload")}
        </ButtonV2>
      </div>

      <Show when={status.loading}>
        <div class="flex items-center gap-2 text-12-regular text-v2-text-text-muted" data-component="workflow-runtime-loading">
          <span class="size-2 animate-pulse rounded-full bg-v2-state-fg-info" />
          {language.t("workflowRuntime.loading")}
        </div>
      </Show>

      <Show when={status.error}>
        <div class="flex items-center justify-between gap-2 rounded-md border border-v2-state-border-danger bg-v2-state-bg-danger p-2 text-12-regular text-v2-state-fg-danger" data-component="workflow-runtime-error">
          <span>{language.t("workflowRuntime.loadError")}</span>
          <ButtonV2 variant="ghost" size="small" onClick={() => void refetch()}>
            {language.t("workflowRuntime.tryAgain")}
          </ButtonV2>
        </div>
      </Show>

      <Show when={!status.loading && !status.error && status()?.run}>
        {(loaded) => {
          const run = () => loaded()!
          return (
            <div class="flex flex-col gap-3" data-component="workflow-runtime-content">
              <div class="flex flex-wrap items-center justify-between gap-2 border-b border-v2-border-border-faint pb-2">
                <div class="min-w-0">
                  <div class="truncate text-12-medium text-v2-text-text-base">{run().workflowName}</div>
                  <div class="font-mono text-10-regular text-v2-text-text-faint">
                    {language.t("workflowRuntime.revision", { revision: run().revision })}
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <StatusBadge status={run().status} label={language.t(workflowStatusKey(run().status))} />
                  <ButtonV2
                    variant="ghost-muted"
                    size="small"
                    disabled={!canCancelRun(run().status)}
                    onClick={() => void cancelRun(run())}
                  >
                    {language.t("workflowRuntime.cancelRun")}
                  </ButtonV2>
                </div>
              </div>

              <Show when={actionNotice()}>
                <div
                  class="rounded-md border border-v2-state-border-warning bg-v2-state-bg-warning p-2 text-11-regular text-v2-state-fg-warning"
                  data-component="workflow-runtime-action-notice"
                  role="status"
                >
                  {actionNotice()}
                </div>
              </Show>

              <div class="flex flex-col gap-1.5" data-component="workflow-runtime-steps">
                <For each={status()?.steps ?? []}>
                  {(step) => <StepRow run={run} step={step} cancelStep={cancelStep} retryStep={retryStep} language={language} />}
                </For>
              </div>
            </div>
          )
        }}
      </Show>

      <Show when={!status.loading && !status.error && !status()?.run}>
        <div class="flex flex-col items-center gap-1 py-3 text-center" data-component="workflow-runtime-empty">
          <span class="text-12-regular text-v2-text-text-muted">{language.t("workflowRuntime.empty")}</span>
          <span class="text-11-regular text-v2-text-text-faint">{language.t("workflowRuntime.emptyDescription")}</span>
        </div>
      </Show>
    </section>
  )
}

function StepRow(props: {
  run: () => NonNullable<WorkflowStatusResponse["run"]>
  step: WorkflowAssetStepRunInfo
  cancelStep: (run: NonNullable<WorkflowStatusResponse["run"]>, step: WorkflowAssetStepRunInfo) => Promise<void>
  retryStep: (run: NonNullable<WorkflowStatusResponse["run"]>, step: WorkflowAssetStepRunInfo) => Promise<void>
  language: ReturnType<typeof useLanguage>
}) {
  return (
    <div class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-v2-border-border-faint bg-v2-background-bg-layer-01 px-2 py-2" data-component="workflow-runtime-step" data-status={props.step.status}>
      <div class="min-w-0 flex-1">
        <div class="truncate text-11-medium text-v2-text-text-base">{props.step.stepId}</div>
        <div class="flex flex-wrap items-center gap-2 text-10-regular text-v2-text-text-faint">
          <span>{props.step.agentId}</span>
          <span>{props.language.t("workflowRuntime.attempt", { attempt: props.step.attempt })}</span>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <StatusBadge status={props.step.status} label={props.language.t(workflowStatusKey(props.step.status))} />
        <Show when={canCancelStep(props.step.status)}>
          <ButtonV2 variant="ghost-muted" size="small" onClick={() => void props.cancelStep(props.run(), props.step)}>
            {props.language.t("workflowRuntime.cancelStep")}
          </ButtonV2>
        </Show>
        <Show when={canRetryStep(props.step.status, props.run().status)}>
          <ButtonV2 variant="ghost-muted" size="small" onClick={() => void props.retryStep(props.run(), props.step)}>
            {props.language.t("workflowRuntime.retryStep")}
          </ButtonV2>
        </Show>
      </div>
    </div>
  )
}

function StatusBadge(props: { status: Parameters<typeof workflowStatusTone>[0]; label: string }) {
  return (
    <span
      class="rounded border px-1.5 py-0.5 font-mono text-10-regular"
      classList={{
        "border-v2-border-border-faint text-v2-text-text-muted": workflowStatusTone(props.status) === "neutral",
        "border-v2-state-border-info bg-v2-state-bg-info text-v2-state-fg-info": workflowStatusTone(props.status) === "info",
        "border-v2-state-border-warning bg-v2-state-bg-warning text-v2-state-fg-warning": workflowStatusTone(props.status) === "warning",
        "border-v2-state-border-success bg-v2-state-bg-success text-v2-state-fg-success": workflowStatusTone(props.status) === "success",
        "border-v2-state-border-danger bg-v2-state-bg-danger text-v2-state-fg-danger": workflowStatusTone(props.status) === "danger",
      }}
      data-status={props.status}
    >
      {props.label}
    </span>
  )
}
