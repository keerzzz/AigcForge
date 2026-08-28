import { createMemo, createResource, createSignal, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { TabsV2 } from "@aigcfroge/ui/v2/tabs-v2"
import { useCustomDraft } from "@/context/custom-draft"
import { WorkflowTab, InstructionsTab, CapabilitiesTab, PermissionsTab, DiagnosticsTab, McpTab } from "./custom-preview-tabs"
import { useModeDirectory } from "@/pages/mode-workspace-context"
import { useTabs } from "@/context/tabs"
import { ServerConnection } from "@/context/server"
import { launchModeSession } from "@/pages/layout/helpers"
import type { DirectorySDK } from "@/context/sdk"
import type { CompositionPlan, CompositionDiagnostic } from "@aigcfroge/sdk/v2/client"

export interface CustomPreviewColumnProps {
  dirSdk: () => DirectorySDK | undefined
}

function parseErrorDetails(err: unknown): { status?: number; message?: string } {
  if (typeof err === "object" && err !== null) {
    const status = "status" in err && typeof err.status === "number" ? err.status : undefined
    const message = "message" in err && typeof err.message === "string" ? err.message : undefined
    return { status, message }
  }
  return { message: String(err) }
}

export interface PlanFailure {
  error: string
  disabled?: boolean
  unsupported?: boolean
}

/**
 * Classifies a failed `customComposition.plan` call.
 *
 * `disabled` is what downgrades the surface from a red error to the amber
 * opt-in notice and what keeps `canStart` false, so misclassifying it
 * re-enables Start against a server that will refuse. It is currently derived by
 * matching the English text of `ProductModePolicy.CUSTOM_MODE_DISABLED_MESSAGE`,
 * because the four server-side constructions of this error pass only `message` —
 * `InvalidRequestError.kind` exists and is populated elsewhere
 * (`"permission-override"`, `"Query"`), just not on this branch. So the
 * structured signal is available and unadopted, not missing. Until it is
 * adopted, this classification is sensitive to a server-side reword or a
 * localization pass, which is why it is a pinned pure function rather than an
 * inline branch — see technical-debt §4 for the fix and its trigger.
 */
export const DISABLED_MESSAGE_MARKER = "Custom mode is disabled"

export function classifyPlanFailure(err: unknown): PlanFailure {
  const { status, message } = parseErrorDetails(err)
  const msg = message ?? String(err)
  if (status === 404) return { unsupported: true, error: "This server does not support custom compositions" }
  if (msg.includes(DISABLED_MESSAGE_MARKER)) return { disabled: true, error: msg }
  return { error: msg }
}

export function CustomPlanPreviewColumn(props: CustomPreviewColumnProps) {
  const language = useLanguage()
  const tabs = useTabs()
  const { conn, ctx, directory } = useModeDirectory()
  const draft = useCustomDraft()
  const [activeTab, setActiveTab] = createSignal("workflow")
  const [starting, setStarting] = createSignal(false)
  const [errorMessage, setErrorMessage] = createSignal<string | undefined>()

  const [planResult, { refetch: refetchPlan }] = createResource(
    () => ({
      sdk: props.dirSdk(),
      composition: draft.composition,
    }),
    async (source): Promise<{ plan?: CompositionPlan; error?: string; disabled?: boolean; unsupported?: boolean }> => {
      if (!source.sdk) return {}
      try {
        const res = await source.sdk.client.customComposition.plan({
          directory: source.sdk.directory,
          body: source.composition,
        })
        return { plan: res.data }
      } catch (err: unknown) {
        return classifyPlanFailure(err)
      }
    },
  )

  /**
   * Read the latest settled value, never the suspending call.
   *
   * Reading a pending resource suspends to the nearest boundary, and the only
   * one above this component is `pages/layout.tsx:43` — a `<Suspense>` with no
   * fallback wrapping the whole `<main>`. So a pending plan blanked the entire
   * mode workspace on first load, and a `Recalculate` unmounted this column
   * mid-refetch, which is why `McpTab`'s own loading branch
   * (`custom-preview-tabs.tsx`, state `"loading"`) could never render: the
   * component did not exist while the request was in flight.
   *
   * With `.latest` the column stays mounted and each panel renders its own
   * loading state from `planResult.loading`. The app-wide fallback-less
   * `<Suspense>` is a separate, pre-existing problem — see technical-debt §4.
   */
  const result = createMemo(() => planResult.latest)
  const plan = createMemo(() => result()?.plan)
  const blockingCount = createMemo(
    () => (plan()?.diagnostics ?? []).filter((d: CompositionDiagnostic) => d.severity === "blocking").length,
  )
  const canStart = createMemo(() => {
    if (starting()) return false
    if (!props.dirSdk()) return false
    if (result()?.disabled || result()?.unsupported) return false
    if (blockingCount() > 0) return false
    if (draft.state.source === "temporary" && draft.state.agents.length === 0) return false
    return true
  })

  async function handleStart() {
    const sdk = props.dirSdk()
    const currentConn = conn()
    const currentCtx = ctx()
    const dir = directory()
    if (!sdk || !currentConn || !currentCtx || !dir) return

    setStarting(true)
    setErrorMessage(undefined)

    try {
      const res = await sdk.client.customComposition.start(
        {
          directory: dir,
          compositionStartInput: {
            composition: draft.composition,
            expectedPlanDigest: plan()?.digest,
            title: draft.state.title || undefined,
          },
        },
        { throwOnError: true },
      )

      if (res.data?.session?.id) {
        launchModeSession({
          mode: "custom",
          projects: currentCtx.projects,
          server: ServerConnection.key(currentConn),
          directory: dir,
          tabs,
        })
      }
    } catch (err: unknown) {
      const { message } = parseErrorDetails(err)
      setErrorMessage(message ?? String(err))
    } finally {
      setStarting(false)
    }
  }

  return (
    <div class="flex flex-col gap-4 h-full">
      {/* Title & Start Action Bar */}
      <div class="flex flex-col gap-3 rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-02 p-4">
        <div class="flex items-center justify-between gap-3">
          <input
            type="text"
            class="flex-1 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-03 px-3 py-1.5 text-13-regular text-v2-text-text-base placeholder:text-v2-text-text-muted focus:border-v2-border-border-focus focus:outline-none"
            placeholder={language.t("custom.builder.titlePlaceholder")}
            value={draft.state.title}
            onInput={(e) => draft.setTitle(e.currentTarget.value)}
          />
          <ButtonV2
            variant="contrast"
            size="normal"
            icon="enter"
            disabled={!canStart()}
            loading={starting()}
            onClick={handleStart}
          >
            {language.t("custom.builder.startSession")}
          </ButtonV2>
        </div>

        <div class="flex items-center justify-between text-11-regular text-v2-text-text-muted border-t border-v2-border-border-base pt-2">
          <div class="flex items-center gap-2">
            <span>{language.t("custom.builder.planDigest")}:</span>
            <Show
              when={plan()?.digest}
              fallback={<span class="font-mono text-v2-text-text-faint">-</span>}
            >
              <span class="rounded bg-v2-background-bg-layer-03 px-1.5 py-0.5 font-mono text-11-medium text-v2-text-text-base">
                {plan()?.digest.slice(0, 8)}
              </span>
            </Show>
          </div>
          <button
            type="button"
            class="hover:text-v2-text-text-base text-11-medium"
            onClick={() => refetchPlan()}
          >
            {language.t("custom.builder.recalculatePlan")}
          </button>
        </div>
      </div>

      {/* Warning / Error banners */}
      <Show when={result()?.disabled}>
        <div class="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-12-regular text-amber-300 flex items-center gap-2">
          <Icon name="warning" size="small" class="shrink-0" />
          <span>{language.t("custom.builder.flagDisabledWarning")}</span>
        </div>
      </Show>

      <Show when={result()?.unsupported}>
        <div class="rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-12-regular text-rose-300 flex items-center gap-2">
          <Icon name="warning" size="small" class="shrink-0" />
          <span>{language.t("custom.builder.unsupportedServerWarning")}</span>
        </div>
      </Show>

      <Show when={errorMessage()}>
        <div class="rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-12-regular text-rose-300 flex items-center justify-between">
          <span>{errorMessage()}</span>
          <button type="button" onClick={() => setErrorMessage(undefined)}>
            <Icon name="close" size="small" />
          </button>
        </div>
      </Show>

      {/* Plan preview tabs */}
      <div class="flex-1 min-h-0 flex flex-col rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-02 overflow-hidden">
        <TabsV2 value={activeTab()} onChange={setActiveTab} class="flex flex-col h-full">
          <div class="flex items-center overflow-x-auto border-b border-v2-border-border-base px-2 bg-v2-background-bg-layer-03">
            <TabsV2.Trigger value="workflow">
              {language.t("custom.builder.tab.workflow")}
            </TabsV2.Trigger>
            <TabsV2.Trigger value="instructions">
              {language.t("custom.builder.tab.instructions")}
            </TabsV2.Trigger>
            <TabsV2.Trigger value="capabilities">
              {language.t("custom.builder.tab.capabilities")}
            </TabsV2.Trigger>
            <TabsV2.Trigger value="permissions">
              {language.t("custom.builder.tab.permissions")}
            </TabsV2.Trigger>
            <TabsV2.Trigger value="mcp">
              <div class="flex items-center gap-1.5">
                <span>{language.t("custom.builder.tab.mcp")}</span>
                <Show when={(plan()?.mcp?.requested.length ?? 0) > 0}>
                  <span class="rounded-full bg-v2-background-bg-layer-01 px-1.5 py-0.2 text-10-bold text-v2-text-text-muted">
                    {plan()?.mcp?.requested.length}
                  </span>
                </Show>
              </div>
            </TabsV2.Trigger>
            <TabsV2.Trigger value="diagnostics">
              <div class="flex items-center gap-1.5">
                <span>{language.t("custom.builder.tab.diagnostics")}</span>
                <Show when={(plan()?.diagnostics ?? []).length > 0}>
                  <span
                    class={`rounded-full px-1.5 py-0.2 text-10-bold ${blockingCount() > 0 ? "bg-rose-500 text-white" : "bg-v2-background-bg-layer-01 text-v2-text-text-muted"}`}
                  >
                    {(plan()?.diagnostics ?? []).length}
                  </span>
                </Show>
              </div>
            </TabsV2.Trigger>
          </div>

          <div class="flex-1 min-h-0 overflow-y-auto p-4">
            <TabsV2.Content value="workflow">
              <WorkflowTab plan={plan()} />
            </TabsV2.Content>
            <TabsV2.Content value="instructions">
              <InstructionsTab plan={plan()} />
            </TabsV2.Content>
            <TabsV2.Content value="capabilities">
              <CapabilitiesTab plan={plan()} />
            </TabsV2.Content>
            <TabsV2.Content value="permissions">
              <PermissionsTab plan={plan()} />
            </TabsV2.Content>
            <TabsV2.Content value="mcp">
              <McpTab plan={plan()} loading={planResult.loading} error={result()?.error} />
            </TabsV2.Content>
            <TabsV2.Content value="diagnostics">
              <DiagnosticsTab plan={plan()} />
            </TabsV2.Content>
          </div>
        </TabsV2>
      </div>
    </div>
  )
}
