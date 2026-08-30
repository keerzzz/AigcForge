import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { useSDK } from "@/context/sdk"
import { useTabs } from "@/context/tabs"
import { useGlobal } from "@/context/global"
import { useServer, ServerConnection } from "@/context/server"
import { launchModeSession } from "@/pages/layout/helpers"
import { useCustomDraft } from "@/context/custom-draft"
import { showToast } from "@/utils/toast"
import { Schema } from "effect"
import { Snapshot } from "@aigcfroge/schema/composition"
import { WorkflowRuntimePanel } from "@/pages/session/workflow-runtime-panel"

export interface CustomSessionPanelProps {
  sessionID?: string
  directory?: string
}

function parseErrorDetails(err: unknown): { status?: number; message?: string } {
  if (typeof err === "object" && err !== null) {
    const status = "status" in err && typeof err.status === "number" ? err.status : undefined
    const message = "message" in err && typeof err.message === "string" ? err.message : undefined
    return { status, message }
  }
  return { message: String(err) }
}

const decodeSnapshot = Schema.decodeUnknownOption(Snapshot)

function extractSnapshot(data: unknown): Snapshot | undefined {
  if (typeof data !== "object" || data === null) return undefined
  const directDecoded = decodeSnapshot(data)
  if (directDecoded._tag === "Some") return directDecoded.value
  if ("snapshot" in data) {
    const nestedDecoded = decodeSnapshot((data as { snapshot: unknown }).snapshot)
    if (nestedDecoded._tag === "Some") return nestedDecoded.value
  }
  return undefined
}

export function CustomSessionPanel(props: CustomSessionPanelProps) {
  const language = useLanguage()
  const sdk = useSDK()
  const tabs = useTabs()
  const global = useGlobal()
  const server = useServer()
  const draft = useCustomDraft()

  const [upgrading, setUpgrading] = createSignal(false)
  const [upgradeError, setUpgradeError] = createSignal<string | undefined>()
  const [copied, setCopied] = createSignal(false)

  // Fetch snapshot for the session
  const [snapshot] = createResource(
    () => ({ sessionID: props.sessionID, directory: props.directory }),
    async (source): Promise<Snapshot | undefined> => {
      if (!source.sessionID) return undefined
      try {
        const s = sdk()
        const res = await s.client.session.composition({ sessionID: source.sessionID }, { throwOnError: false })
        return extractSnapshot(res.data)
      } catch {
        return undefined
      }
    },
  )

  const digest = createMemo(() => snapshot()?.digest ?? "")
  const snapshotV2 = createMemo(() => {
    const s = snapshot()
    return s && s.version === 2 ? s : undefined
  })

  function handleCopyDigest() {
    if (!digest()) return
    void navigator.clipboard?.writeText(digest())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleUpgrade() {
    const currentSessionID = props.sessionID
    const s = sdk()
    const dir = props.directory ?? s.directory
    const currentServer = server.current
    if (!currentSessionID || !dir || !currentServer) return

    const currentSnapshot = snapshot()
    if (currentSnapshot) {
      draft.loadFromSnapshot(currentSnapshot)
    }

    setUpgrading(true)
    setUpgradeError(undefined)

    try {
      const res = await s.client.customComposition.upgrade(
        {
          directory: dir,
          compositionUpgradeInput: {
            sessionID: currentSessionID,
            composition: draft.composition,
            expectedPlanDigest: currentSnapshot?.digest,
          },
        },
        { throwOnError: true },
      )

      if (res.data?.session?.id) {
        const ctx = global.ensureServerCtx(currentServer)
        launchModeSession({
          mode: "custom",
          projects: ctx.projects,
          server: ServerConnection.key(currentServer),
          directory: dir,
          tabs,
        })
        showToast(language.t("custom.snapshot.upgradeSuccess"))
      }
    } catch (err: unknown) {
      const { status, message } = parseErrorDetails(err)
      const msg = message ?? String(err)
      if (status === 409 || msg.includes("busy") || msg.includes("SessionBusyError")) {
        setUpgradeError(language.t("custom.snapshot.busyError"))
        return
      }
      setUpgradeError(msg)
    } finally {
      setUpgrading(false)
    }
  }

  return (
    <div class="flex flex-col gap-4 h-full p-4 overflow-y-auto bg-v2-background-bg-layer-01">
      {/* Header */}
      <div class="flex items-center justify-between border-b border-v2-border-border-base pb-3">
        <div class="flex items-center gap-2">
          <Icon name="mode-custom" size="small" class="text-v2-text-text-base" />
          <span class="text-v2-text-text-base text-14-medium">{language.t("custom.snapshot.panelTitle")}</span>
        </div>
        <ButtonV2 variant="neutral" size="small" icon="edit" loading={upgrading()} onClick={handleUpgrade}>
          {language.t("custom.snapshot.upgradeButton")}
        </ButtonV2>
      </div>

      <Show when={upgradeError()}>
        <div class="rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-12-regular text-rose-300 flex items-center justify-between">
          <span>{upgradeError()}</span>
          <button type="button" onClick={() => setUpgradeError(undefined)}>
            <Icon name="close" size="small" />
          </button>
        </div>
      </Show>

      <WorkflowRuntimePanel sessionID={props.sessionID} />

      {/* Snapshot Metadata Cards */}
      <div class="flex flex-col gap-3">
        {/* Digest */}
        <div class="flex flex-col gap-1 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-02 p-3">
          <div class="flex items-center justify-between">
            <span class="text-v2-text-text-muted text-11-medium uppercase tracking-wider">
              {language.t("custom.snapshot.digest")}
            </span>
            <button
              type="button"
              class="text-11-medium text-v2-text-text-muted hover:text-v2-text-text-base flex items-center gap-1"
              onClick={handleCopyDigest}
            >
              <Icon name={copied() ? "check" : "copy"} size="small" />
              <span>{copied() ? language.t("common.copied") : language.t("common.copy")}</span>
            </button>
          </div>
          <span class="font-mono text-12-regular text-v2-text-text-base break-all select-all">{digest() || "-"}</span>
        </div>

        {/* Agent ID */}
        <div class="flex items-center justify-between rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-02 p-3">
          <span class="text-v2-text-text-muted text-11-medium uppercase tracking-wider">
            {language.t("custom.builder.primaryAgent")}
          </span>
          <span class="font-mono text-12-medium text-blue-400">
            {(() => {
              const snap = snapshot()
              if (!snap) return draft.state.primaryAgent ?? "coder"
              if (snap.version === 1) return snap.data.agentID
              return snap.data.agents[0]?.name ?? snap.data.agents[0]?.id ?? draft.state.primaryAgent ?? "coder"
            })()}
          </span>
        </div>

        {/* Workflow Info (v2) */}
        <Show when={snapshotV2()?.data.workflow}>
          <div class="flex flex-col gap-2 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-02 p-3">
            <div class="flex items-center justify-between">
              <span class="text-v2-text-text-muted text-11-medium uppercase tracking-wider">
                Workflow ({snapshotV2()?.data.workflow?.name})
              </span>
              <span class="rounded bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 font-mono text-10-regular text-amber-300">
                {snapshotV2()?.data.workflow?.steps.length} steps
              </span>
            </div>
            <div class="flex flex-col gap-1.5 mt-1">
              <For each={snapshotV2()?.data.workflow?.steps ?? []}>
                {(step) => (
                  <div class="flex items-center justify-between rounded bg-v2-background-bg-layer-01 px-2 py-1 text-11-regular border border-v2-border-border-faint">
                    <span class="font-medium text-v2-text-text-base">{step.name || step.id}</span>
                    <span class="font-mono text-10-regular text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">
                      {step.agent}
                    </span>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* Agent Pool list (v2) */}
        <Show when={(snapshotV2()?.data.agents ?? []).length > 1}>
          <div class="flex flex-col gap-2 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-02 p-3">
            <span class="text-v2-text-text-muted text-11-medium uppercase tracking-wider">
              Agent Pool ({(snapshotV2()?.data.agents ?? []).length})
            </span>
            <div class="flex flex-wrap gap-1.5">
              <For each={snapshotV2()?.data.agents ?? []}>
                {(ag) => (
                  <span class="rounded bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 font-mono text-11-regular text-blue-300">
                    {ag.name || ag.id}
                  </span>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* Prompts list */}
        <div class="flex flex-col gap-2 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-02 p-3">
          <span class="text-v2-text-text-muted text-11-medium uppercase tracking-wider">
            {language.t("custom.sidebar.prompts")} ({(snapshot()?.data.prompts ?? []).length})
          </span>
          <Show
            when={(snapshot()?.data.prompts ?? []).length > 0}
            fallback={
              <span class="text-v2-text-text-faint text-11-regular">{language.t("custom.builder.noBoundPrompts")}</span>
            }
          >
            <div class="flex flex-wrap gap-1.5">
              <For each={snapshot()?.data.prompts ?? []}>
                {(prompt) => (
                  <span class="rounded bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 font-mono text-11-regular text-purple-300">
                    {prompt.relativePath}
                  </span>
                )}
              </For>
            </div>
          </Show>
        </div>

        {/* Skills list */}
        <div class="flex flex-col gap-2 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-02 p-3">
          <span class="text-v2-text-text-muted text-11-medium uppercase tracking-wider">
            {language.t("custom.sidebar.skills")} ({(snapshot()?.data.skills ?? []).length})
          </span>
          <Show
            when={(snapshot()?.data.skills ?? []).length > 0}
            fallback={
              <span class="text-v2-text-text-faint text-11-regular">{language.t("custom.builder.noBoundSkills")}</span>
            }
          >
            <div class="flex flex-wrap gap-1.5">
              <For each={snapshot()?.data.skills ?? []}>
                {(skill) => (
                  <span class="rounded bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 font-mono text-11-regular text-emerald-300">
                    {skill.name}
                  </span>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}
