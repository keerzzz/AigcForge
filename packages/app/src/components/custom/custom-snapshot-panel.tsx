import { createEffect, createMemo, createResource, createSignal, For, on, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { useSDK } from "@/context/sdk"
import { useTabs } from "@/context/tabs"
import { useGlobal } from "@/context/global"
import { useServer, ServerConnection } from "@/context/server"
import { openSessionByID } from "@/pages/layout/helpers"
import { useCustomDraft } from "@/context/custom-draft"
import { useLayout } from "@/context/layout"
import { currentRoute } from "@/context/layout-helpers"
import { useMode } from "@/context/mode"
import { showToast } from "@/utils/toast"
import type { Snapshot } from "@aigcfroge/schema/composition"
import { decodeSnapshotResponse } from "@/utils/snapshot-decode"
import { WorkflowRuntimePanel } from "@/pages/session/workflow-runtime-panel"
import { SessionRightPanel } from "@/components/session-right-panel"
import { createSizing } from "@/pages/session/helpers"
import { classifySnapshotFailure, evaluateStartGate, parseErrorDetails, type SnapshotFetch } from "./custom-plan-state"
import { useModeSlotActive, whenActive } from "@/pages/mode-slot-active"

export interface CustomSessionPanelProps {
  sessionID?: string
  directory?: string
}

export function CustomSessionPanel(props: CustomSessionPanelProps) {
  const slotActive = useModeSlotActive()
  const language = useLanguage()
  const sdk = useSDK()
  const tabs = useTabs()
  const global = useGlobal()
  const server = useServer()
  const draft = useCustomDraft()
  const layout = useLayout()
  const mode = useMode()
  const size = createSizing()

  const [upgrading, setUpgrading] = createSignal(false)
  const [upgradeError, setUpgradeError] = createSignal<string | undefined>()
  const [copied, setCopied] = createSignal(false)
  createEffect(
    on([draft, () => props.sessionID], () => {
      setUpgrading(false)
      setUpgradeError(undefined)
      setCopied(false)
    }),
  )

  // Fetch snapshot for the session. `throwOnError: true` so the status reaches
  // `classifySnapshotFailure`: only a 404 means "this session has no snapshot", and
  // the panel must not render a 400 (a snapshot the server could not decode) or a
  // dropped connection as the same thing. See custom-plan-state.ts (P2-11).
  const source = createMemo(() =>
    whenActive(slotActive(), () => ({ sessionID: props.sessionID, directory: props.directory, sdk: sdk() })),
  )
  const [snapshotFetch, { refetch: refetchSnapshot }] = createResource(
    source,
    async (source): Promise<SnapshotFetch<Snapshot> & { source: typeof source }> => {
      if (!source.sessionID) return { source, state: "absent" }
      try {
        const res = await source.sdk.client.session.composition({ sessionID: source.sessionID }, { throwOnError: true })
        const decoded = decodeSnapshotResponse(res.data)
        if (decoded === undefined) {
          // 2xx whose body is not a Snapshot: server/client schema drift, not an
          // absent composition.
          return { source, state: "failed", message: language.t("custom.snapshot.undecodable") }
        }
        return { source, state: "ready", snapshot: decoded }
      } catch (err: unknown) {
        return { source, ...classifySnapshotFailure(err) }
      }
    },
    // `latest` only avoids suspending after the first settle. Without an initial
    // value the first read is a real `read()` and the whole route body is replaced
    // by the route-level `surface-pending` fallback until the snapshot arrives —
    // the session must stay visible while this panel waits. See the pending-state
    // E3 in `custom-snapshot-states.spec.ts`.
    { initialValue: undefined },
  )

  const result = createMemo(() => {
    const fetched = snapshotFetch.latest
    return fetched?.source === source() ? fetched : undefined
  })
  const snapshot = createMemo(() => {
    const fetched = result()
    return fetched?.state === "ready" ? fetched.snapshot : undefined
  })
  const snapshotError = createMemo(() => {
    const fetched = result()
    return fetched?.state === "failed" ? fetched.message : undefined
  })

  const digest = createMemo(() => snapshot()?.digest ?? "")
  const snapshotV2 = createMemo(() => {
    const s = snapshot()
    return s && s.version === 2 ? s : undefined
  })

  // Commands are consumer-bound in the V2 binding graph; the panel shows each
  // command next to the consumer it is frozen for (S5 leg 4).
  const commandEntries = createMemo(() => {
    const snap = snapshot()
    if (!snap || snap.version !== 2) return []
    return Object.entries(snap.data.bindings ?? {}).flatMap(([consumer, binding]) =>
      binding.commands.map((command) => ({ consumer, command })),
    )
  })

  function handleCopyDigest() {
    if (!digest()) return
    void navigator.clipboard?.writeText(digest())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const canUpgrade = () => !upgrading() && !snapshotFetch.loading && snapshot() !== undefined

  // A completion belongs to the Session the user is still looking at. The old
  // component can be unmounted or kept for another tab while its request settles,
  // so `source()` alone cannot see the route move; compare the live route owner.
  const onSameSession = (sessionID: string, serverKey: ServerConnection.Key) => {
    // The router's committed route can lag behind the address bar while a route
    // transition is waiting on another request. The user has already left this
    // Session at that point, so read the live URL instead of the transition view.
    const route = globalThis.location
      ? currentRoute(globalThis.location.pathname, globalThis.location.search)
      : layout.route()
    return (
      route.type === "session" &&
      route.sessionId === sessionID &&
      (!route.server || ServerConnection.sameKey(route.server, serverKey))
    )
  }

  async function handleUpgrade() {
    if (!canUpgrade()) return
    const currentSource = source()
    const currentSnapshot = snapshot()
    if (!currentSource?.sessionID || !currentSnapshot) return
    const currentSessionID = currentSource.sessionID
    const s = currentSource.sdk
    const dir = currentSource.directory ?? s.directory
    const currentServer = server.list.find((connection) => server.scope(ServerConnection.key(connection)) === s.scope)
    if (!dir || !currentServer) return
    const currentServerKey = ServerConnection.key(currentServer)
    const currentDraft = draft()
    currentDraft.loadFromSnapshot(currentSnapshot)
    const composition = currentDraft.composition

    setUpgrading(true)
    setUpgradeError(undefined)

    try {
      // Reconstructing an editable draft can change the input (for example profile
      // to temporary). Its new plan, rather than the old snapshot, owns the digest.
      const planned = await s.client.customComposition.plan(
        { directory: dir, body: composition },
        { throwOnError: true },
      )
      if (source() !== currentSource || draft() !== currentDraft) return
      if (!onSameSession(currentSessionID, currentServerKey)) return
      const gate = evaluateStartGate({
        starting: false,
        hasSdk: true,
        result: { plan: planned.data },
        draft: {
          source: composition.source,
          agentCount: composition.source === "temporary" ? composition.agents.length : 0,
        },
      })
      if (!gate.canStart) {
        setUpgradeError(language.t(`custom.builder.startBlocker.${gate.blocker}`))
        return
      }
      const res = await s.client.customComposition.upgrade(
        {
          directory: dir,
          compositionUpgradeInput: {
            sessionID: currentSessionID,
            composition,
            expectedPlanDigest: planned.data?.digest,
          },
        },
        { throwOnError: true },
      )

      if (source() !== currentSource || draft() !== currentDraft) return
      if (!onSameSession(currentSessionID, currentServerKey)) return
      // Upgrade creates a new Session on the source server. Open the returned ID
      // through that same owner, even when the global server selection differs.
      const upgraded = res.data?.session
      if (upgraded?.id) {
        const ctx = global.ensureServerCtx(currentServer)
        openSessionByID({
          sessionID: upgraded.id,
          sessionDirectory: upgraded.location.directory,
          projectDirectory: dir,
          server: currentServerKey,
          global,
          tabs,
          projects: ctx.projects,
        })
        showToast(language.t("custom.snapshot.upgradeSuccess"))
      }
    } catch (err: unknown) {
      if (draft() !== currentDraft || !onSameSession(currentSessionID, currentServerKey) || sdk() !== s) return
      const { status, message } = parseErrorDetails(err)
      const msg = message ?? String(err)
      if (status === 409 || msg.includes("busy") || msg.includes("SessionBusyError")) {
        setUpgradeError(language.t("custom.snapshot.busyError"))
        return
      }
      setUpgradeError(msg)
    } finally {
      if (draft() === currentDraft && onSameSession(currentSessionID, currentServerKey) && sdk() === s)
        setUpgrading(false)
    }
  }

  return (
    <SessionRightPanel modeID="custom" size={size} ariaLabel={language.t("custom.snapshot.panelTitle")}>
      <div class="flex flex-col gap-4 h-full p-4 overflow-y-auto bg-v2-background-bg-layer-01">
        {/* Header */}
        <div class="flex items-center justify-between border-b border-v2-border-border-base pb-3">
          <div class="flex items-center gap-2">
            <Icon name="mode-custom" size="small" class="text-v2-text-text-base" />
            <span class="text-v2-text-text-base text-14-medium">{language.t("custom.snapshot.panelTitle")}</span>
          </div>
          <ButtonV2
            variant="neutral"
            size="small"
            icon="edit"
            disabled={!canUpgrade()}
            loading={upgrading()}
            onClick={handleUpgrade}
          >
            {language.t("custom.snapshot.upgradeButton")}
          </ButtonV2>
        </div>

        <Show when={upgradeError()}>
          <div class="rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-12-regular text-rose-300 flex items-center justify-between">
            <span>{upgradeError()}</span>
            <button
              type="button"
              class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus"
              aria-label={language.t("common.dismiss")}
              onClick={() => setUpgradeError(undefined)}
            >
              <Icon name="close" size="small" />
            </button>
          </div>
        </Show>

        {/* A failed composition read is reported; only a 404 renders as "no snapshot". The
            read is retryable in place: a server error is not the same as an absent snapshot,
            so the panel keeps the failure visible as an alert and re-reads the same session. */}
        <Show when={snapshotError()}>
          {(message) => (
            <div
              role="alert"
              class="flex items-center gap-2 rounded-md border border-v2-state-border-danger bg-v2-state-bg-danger p-3 text-12-regular text-v2-state-fg-danger"
            >
              <Icon name="warning" size="small" class="shrink-0" />
              <span class="min-w-0 flex-1">{language.t("custom.snapshot.loadFailed", { message: message() })}</span>
              <ButtonV2 variant="neutral" size="small" onClick={() => void refetchSnapshot()}>
                {language.t("assistant.citation.retry")}
              </ButtonV2>
            </div>
          )}
        </Show>

        <Show when={mode.currentMode === "custom"}>
          <WorkflowRuntimePanel sessionID={props.sessionID} />
        </Show>

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

          {/* Root agent, as frozen. Custom's root is protocol-fixed (D3), so this
            reports what the snapshot holds and never falls back to draft state. */}
          <div class="flex items-center justify-between rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-02 p-3">
            <span class="text-v2-text-text-muted text-11-medium uppercase tracking-wider">
              {language.t("custom.snapshot.rootAgent")}
            </span>
            <span class="font-mono text-12-medium text-blue-400">
              {(() => {
                const snap = snapshot()
                if (!snap) return "-"
                if (snap.version === 1) return snap.data.agentID
                return snap.data.agents[0]?.name ?? snap.data.agents[0]?.id ?? "-"
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
                <span class="text-v2-text-text-faint text-11-regular">
                  {language.t("custom.builder.noBoundPrompts")}
                </span>
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
                <span class="text-v2-text-text-faint text-11-regular">
                  {language.t("custom.builder.noBoundSkills")}
                </span>
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

          {/* Commands list (per consumer binding) */}
          <div class="flex flex-col gap-2 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-02 p-3">
            <span class="text-v2-text-text-muted text-11-medium uppercase tracking-wider">
              {language.t("custom.sidebar.commands")} ({commandEntries().length})
            </span>
            <Show
              when={commandEntries().length > 0}
              fallback={
                <span class="text-v2-text-text-faint text-11-regular">{language.t("custom.sidebar.noCommands")}</span>
              }
            >
              <div class="flex flex-col gap-1.5">
                <For each={commandEntries()}>
                  {(entry) => (
                    <div class="flex items-center justify-between rounded bg-v2-background-bg-layer-01 px-2 py-1 text-11-regular border border-v2-border-border-faint">
                      <span class="font-medium text-v2-text-text-base">{entry.command.name}</span>
                      <span class="font-mono text-10-regular text-purple-300 bg-purple-500/10 px-1.5 py-0.5 rounded">
                        {entry.consumer}
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </SessionRightPanel>
  )
}
