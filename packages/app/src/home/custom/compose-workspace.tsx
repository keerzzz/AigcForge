import {
  isCompositionResolveError,
  isConflictError,
  isInvalidRequestError,
  isNotFoundError,
  type AgentAssetInfo,
  type AgentAssetInvalidEntry,
  type AgentAssetSummary,
  type AssetPlacementTarget,
  type CustomCompositionPlanOutput,
  type CustomProfileSummary,
  type MCPAssetSummary,
  type ModelSelection,
  type SessionInfo,
  type WorkflowAssetInfo,
  type WorkflowAssetSummary,
} from "@omnixa/client/promise"
import { AssetPlacement } from "@omnixa/schema/asset-placement"
import { Composition } from "@omnixa/schema/composition"
import { CustomProfile } from "@omnixa/schema/custom-profile"
import { Session } from "@omnixa/schema/session"
import { Badge } from "@omnixa/ui/badge"
import { Button } from "@omnixa/ui/button"
import { Icon } from "@omnixa/ui/icon"
import { Select } from "@omnixa/ui/select"
import { TextField } from "@omnixa/ui/text-field"
import { resolveAgentColor } from "@omnixa/ui/theme"
import { Option, Schema } from "effect"
import { createEffect, createMemo, For, onCleanup, Show, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { normalizeAgentList } from "@/runtime/server/global-sync/utils"
import { errorMessage } from "@/shell/layout/helpers"
import { fromSelection, selectionKey } from "@/providers/models/key"
import type { HomeController } from "../model"
import {
  bindingCount,
  buildProfileCandidate,
  BUILTIN_ROOTS,
  composeDraftFromProfile,
  consumerKeyForAgent,
  diagnoseWorkflowSteps,
  findDanglingBindingConsumers,
  initialComposeDraft,
  MAX_COMPOSITION_AGENTS,
  requiresProfileForMcp,
  toTemporaryCompositionInput,
  validateMcpBindingInput,
  type ComposeDraft,
  type ScopedAssetKind,
  type StoredBinding,
  type StoredMcpBinding,
  type StoredRoot,
} from "./draft"
import { buildModelOptions, formatSelectedModelLabel, type CustomOwner } from "./shared"

const decodeProfileInfo = Schema.decodeUnknownSync(Schema.toCodecJson(CustomProfile.Info))
const sameProfile = Schema.toEquivalence(CustomProfile.Profile)
const scopes = ["location", "project", "global"] as const
const bindingKinds: readonly ScopedAssetKind[] = ["prompt", "skill", "command"]

type Confirmation = {
  sessionID: string
  plan: CustomCompositionPlanOutput
  model: ModelSelection | undefined
}

type PlanProgress =
  | { type: "idle" }
  | { type: "previewing" }
  | { type: "preview"; plan: CustomCompositionPlanOutput }
  | { type: "confirming"; confirmation: Confirmation; pending: boolean }
  | { type: "created"; session: SessionInfo; opening: boolean }

type SaveAttempt = {
  candidate: CustomProfile.Candidate
  draftPath: string
  baseRevision?: string
  received: boolean
}

type ProfileProgress =
  | { type: "idle" }
  | { type: "loading"; path: string }
  | { type: "saving"; attempt: SaveAttempt }
  | { type: "checking"; attempt: SaveAttempt; acknowledged?: CustomProfile.Info }
  | { type: "read-failed"; attempt: SaveAttempt; acknowledged?: CustomProfile.Info }
  | { type: "conflict"; path: string; current?: CustomProfile.Info }
  | { type: "saved"; info: CustomProfile.Info }
  | { type: "previewing"; info: CustomProfile.Info }
  | { type: "deleting"; path: string }

type ScopedCatalogEntry = {
  name: string
  description: string
  relativePath: string
  revision: string
}

export function ComposeWorkspace(props: {
  home: HomeController
  owner: CustomOwner
  active: () => boolean
  current: () => boolean
  storageReady: () => boolean
  draft: ComposeDraft
  updateDraft: (mutate: (current: ComposeDraft) => ComposeDraft) => void
  replaceDraft: (next: ComposeDraft) => void
  confirmDraftReplacement: () => Promise<boolean>
  openChatDraft: (prompt: string) => void
  model: () => ModelSelection | undefined
  defaultModel: () => ModelSelection | undefined
  modelsLoading: () => boolean
  modelError: () => string
  onSelectModel: (model: ModelSelection | undefined) => void
  onRetryModels: () => void
}) {
  const language = useLanguage()
  const lifetime = {
    active: true,
    agentRev: 0,
    profileRev: 0,
    profileListRev: 0,
    planRev: 0,
    workflowRev: 0,
    bindingRev: 0,
    mcpRev: 0,
    agentAbort: new AbortController(),
    agentReadAbort: new AbortController(),
    profileAbort: new AbortController(),
    planAbort: new AbortController(),
    workflowAbort: new AbortController(),
    bindingAbort: new AbortController(),
    mcpAbort: new AbortController(),
  }

  const [state, setState] = createStore<{
    agents: AgentAssetSummary[]
    invalidAgents: AgentAssetInvalidEntry[]
    agentsLoading: boolean
    agentsError: string
    agentReading: boolean
    agentContentError: string
    agentContent: AgentAssetInfo | undefined
    profiles: CustomProfileSummary[]
    profilesLoading: boolean
    profilesError: string
    baseProfile: CustomProfile.Info | undefined
    profileProgress: ProfileProgress
    profileError: string
    profileNotice: string
    deleteConfirm: boolean
    capturedRoot: Composition.Root | undefined
    previewProfile: CustomProfile.Info | undefined
    planProgress: PlanProgress
    planError: string
    workflows: WorkflowAssetSummary[]
    workflowsLoading: boolean
    workflowDetail: WorkflowAssetInfo | undefined
    workflowDetailError: string
    bindingKind: ScopedAssetKind
    bindingScope: AssetPlacement.Scope
    bindingItems: ScopedCatalogEntry[]
    bindingTarget: AssetPlacementTarget | undefined
    bindingLoading: boolean
    bindingError: string
    mcpAssets: MCPAssetSummary[]
    mcpLoading: boolean
    mcpSelectedAsset: string
    mcpServerName: string
    mcpTransport: "stdio" | "remote"
    mcpCommand: string
    mcpUrl: string
    mcpCredentialRef: string
    mcpFormError: string
  }>({
    agents: [],
    invalidAgents: [],
    agentsLoading: false,
    agentsError: "",
    agentReading: false,
    agentContentError: "",
    agentContent: undefined,
    profiles: [],
    profilesLoading: false,
    profilesError: "",
    baseProfile: undefined,
    profileProgress: { type: "idle" },
    profileError: "",
    profileNotice: "",
    deleteConfirm: false,
    capturedRoot: undefined,
    previewProfile: undefined,
    planProgress: { type: "idle" },
    planError: "",
    workflows: [],
    workflowsLoading: false,
    workflowDetail: undefined,
    workflowDetailError: "",
    bindingKind: "prompt",
    bindingScope: "location",
    bindingItems: [],
    bindingTarget: undefined,
    bindingLoading: false,
    bindingError: "",
    mcpAssets: [],
    mcpLoading: false,
    mcpSelectedAsset: "",
    mcpServerName: "",
    mcpTransport: "stdio",
    mcpCommand: "",
    mcpUrl: "",
    mcpCredentialRef: "",
    mcpFormError: "",
  })

  const current = () => lifetime.active && props.current() && props.active()
  const connected = () => props.owner.context?.sdk.connection.status() === "connected"
  const ready = () =>
    current() && props.storageReady() && connected() && !!props.owner.directory && !!props.owner.client

  const planBusy = () =>
    (state.planProgress.type === "confirming" && state.planProgress.pending) ||
    (state.planProgress.type === "created" && state.planProgress.opening)

  const planLocked = () =>
    planBusy() || state.planProgress.type === "confirming" || state.planProgress.type === "created"

  const profileBusy = () =>
    ["loading", "saving", "checking", "previewing", "deleting"].includes(state.profileProgress.type)

  const pendingProfileRead = () =>
    state.profileProgress.type === "read-failed" || state.profileProgress.type === "checking"

  const editingDisabled = () => planLocked() || (profileBusy() && state.profileProgress.type !== "previewing")

  const previewPlan = () => {
    if (state.planProgress.type === "preview") return state.planProgress.plan

    if (state.planProgress.type === "confirming") return state.planProgress.confirmation.plan

    return undefined
  }

  const savedProfile = () =>
    state.profileProgress.type === "saved" || state.profileProgress.type === "previewing"
      ? state.profileProgress.info
      : undefined

  const conflictState = () => (state.profileProgress.type === "conflict" ? state.profileProgress : undefined)
  const recoveryState = () => (state.profileProgress.type === "read-failed" ? state.profileProgress : undefined)

  const agentCatalog = createMemo(() =>
    normalizeAgentList(props.owner.context?.data.location.agent.list({ directory: props.owner.directory ?? "" }) ?? []),
  )

  const configuredAgents = createMemo(() =>
    agentCatalog().filter((agent) => agent.originKind === "user" && !agent.originRelativePath),
  )

  const agentAssetColor = (asset: AgentAssetSummary) => {
    const agent = agentCatalog().find(
      (agent) => agent.originRelativePath === asset.relativePath && agent.originRevision === asset.revision,
    )

    return agent ? resolveAgentColor(agent.name, agent.color).v2Color : "currentColor"
  }

  const liveMcpServers = createMemo(
    () => props.owner.context?.data.location.mcp.server.list({ directory: props.owner.directory ?? "" }) ?? [],
  )

  const memberRoles = createMemo(() =>
    props.draft.agents.map((agent) => {
      const fromCatalog = state.agents.find((item) => item.relativePath === agent.relativePath)
      const name =
        fromCatalog?.name ??
        agent.name ??
        agent.relativePath.replace(/\.md$/i, "").split("/").at(-1) ??
        agent.relativePath

      return {
        agent,
        name,
        consumerKey: consumerKeyForAgent(name, agent.relativePath),
      }
    }),
  )

  const consumerRoles = createMemo(() => [
    {
      key: "orchestrator",
      label: language.t("home.custom.compose.roleOrchestrator"),
      sublabel:
        props.draft.root.source === "builtin"
          ? language.t(`home.custom.root.${props.draft.root.id}`)
          : props.draft.root.id,
    },
    ...memberRoles().map((member) => ({
      key: member.consumerKey,
      label: member.name,
      sublabel: member.agent.relativePath,
    })),
  ])

  const activeConsumer = createMemo(() => {
    const selected = props.draft.selectedConsumer

    if (consumerRoles().some((role) => role.key === selected)) return selected

    return "orchestrator"
  })

  const activeBinding = createMemo<StoredBinding>(
    () => props.draft.bindings[activeConsumer()] ?? { prompts: [], skills: [], commands: [] },
  )

  const danglingConsumers = createMemo(() =>
    findDanglingBindingConsumers(
      props.draft.bindings,
      memberRoles().map((member) => member.consumerKey),
    ),
  )

  const workflowDiagnostics = createMemo(() => {
    if (!state.workflowDetail) return []

    return diagnoseWorkflowSteps(
      state.workflowDetail.steps,
      memberRoles().map((member) => ({ id: member.name, name: member.name })),
      props.draft.root.id,
    )
  })

  const modelOptions = createMemo(() => buildModelOptions({ owner: props.owner, selected: props.model(), language }))

  const modelLabel = () =>
    formatSelectedModelLabel({
      owner: props.owner,
      selected: props.model(),
      plan: previewPlan(),
      defaultModel: props.defaultModel(),
      language,
    })

  const profileOptions = createMemo(() => [
    { path: "", label: language.t("home.custom.profile.new") },
    ...state.profiles.map((profile) => ({
      path: profile.relativePath,
      label: `${profile.name} (${profile.relativePath})`,
    })),
  ])

  const candidateBuild = createMemo(() => buildProfileCandidate(props.draft, state.capturedRoot))

  const nameError = () =>
    props.draft.name && Option.isNone(Schema.decodeUnknownOption(CustomProfile.Name)(props.draft.name.trim()))
      ? language.t("home.custom.profile.name.invalid")
      : undefined

  const descriptionError = () =>
    Option.isNone(Schema.decodeUnknownOption(CustomProfile.Description)(props.draft.description))
      ? language.t("home.custom.profile.description.invalid")
      : undefined

  const isOverwrite = () => !!props.draft.baseRevision && props.draft.path.trim() === props.draft.profilePath

  onCleanup(() => {
    lifetime.active = false
    lifetime.agentAbort.abort()
    lifetime.agentReadAbort.abort()
    lifetime.profileAbort.abort()
    lifetime.planAbort.abort()
    lifetime.workflowAbort.abort()
    lifetime.bindingAbort.abort()
    lifetime.mcpAbort.abort()
  })

  // Any edit to the persisted draft invalidates any previous preview plan.
  createEffect(() => {
    if (props.draft.editVersion < 0) return
    untrack(() => {
      if (state.planProgress.type === "preview" || state.planProgress.type === "previewing") {
        cancelPreview()
      }
    })
  })

  // Load catalogs ONLY when Compose tab is active, storage is hydrated, and server is connected.
  createEffect(() => {
    const active = props.active()
    const hydrated = props.storageReady()
    const isConnected = connected()
    const attempt = props.owner.context?.sdk.connection.attempt()

    if (!active || !hydrated || !isConnected || attempt === undefined) {
      untrack(() => {
        if (!isConnected) handleDisconnect()
      })

      return
    }

    untrack(() => {
      void loadAgents()
      void loadProfiles()
      void loadWorkflows()
      void loadMcpAssets()
      void loadScopedBindingAssets(state.bindingKind, state.bindingScope)

      if (props.draft.kind === "profile" && props.draft.profilePath && !state.baseProfile) {
        void loadProfileBaseMetadata(props.draft.profilePath)
      }
    })
  })

  // Load workflow details when a workflow is selected while Compose tab is active.
  createEffect(() => {
    const workflowPath = props.draft.workflow?.relativePath
    const active = props.active()
    const hydrated = props.storageReady()
    const isConnected = connected()

    if (!active || !hydrated || !isConnected || !workflowPath) {
      untrack(() => {
        if (!workflowPath) setState({ workflowDetail: undefined, workflowDetailError: "" })
      })

      return
    }

    untrack(() => void loadWorkflowDetail(workflowPath))
  })

  function handleDisconnect() {
    lifetime.agentRev += 1
    lifetime.profileListRev += 1
    lifetime.profileRev += 1
    lifetime.workflowRev += 1
    lifetime.bindingRev += 1
    lifetime.mcpRev += 1
    lifetime.agentAbort.abort()
    lifetime.agentAbort = new AbortController()
    lifetime.agentReadAbort.abort()
    lifetime.profileAbort.abort()
    lifetime.profileAbort = new AbortController()
    lifetime.workflowAbort.abort()
    lifetime.workflowAbort = new AbortController()
    lifetime.bindingAbort.abort()
    lifetime.bindingAbort = new AbortController()
    lifetime.mcpAbort.abort()
    lifetime.mcpAbort = new AbortController()
    setState({ agentsLoading: false, agentReading: false, profilesLoading: false, capturedRoot: undefined })

    if (state.planProgress.type === "preview" || state.planProgress.type === "previewing") cancelPreview()

    const progress = state.profileProgress

    if (progress.type === "saving" || progress.type === "checking") {
      setState({
        profileProgress: {
          type: "read-failed",
          attempt: progress.attempt,
          acknowledged: progress.type === "checking" ? progress.acknowledged : undefined,
        },
        profileError: language.t(
          progress.attempt.received ? "home.custom.profile.error.readback" : "home.custom.profile.error.ack",
        ),
      })

      return
    }

    if (progress.type === "previewing") {
      setState("profileProgress", { type: "saved", info: progress.info })

      return
    }

    if (progress.type === "loading" || progress.type === "deleting") {
      setState("profileProgress", { type: "idle" })
    }
  }

  function cancelPreview() {
    lifetime.planRev += 1
    lifetime.planAbort.abort()
    lifetime.planAbort = new AbortController()
    setState({ planProgress: { type: "idle" }, planError: "", previewProfile: undefined })
  }

  function mutateDraft(fn: (draft: ComposeDraft) => ComposeDraft) {
    cancelPreview()
    setState({ profileError: "", profileNotice: "", deleteConfirm: false })
    props.updateDraft((draft) => ({
      ...fn(draft),
      dirty: true,
      editVersion: draft.editVersion + 1,
    }))
  }

  async function loadAgents() {
    const client = props.owner.client
    const directory = props.owner.directory
    const context = props.owner.context

    if (!ready() || !client || !directory || !context) return
    lifetime.agentAbort.abort()
    const controller = new AbortController()
    lifetime.agentAbort = controller
    const rev = ++lifetime.agentRev
    setState({ agentsLoading: true, agentsError: "" })

    const [assets, catalog] = await Promise.allSettled([
      client["agent-asset"].list({ directory }, { signal: controller.signal }),
      context.data.location.agent.sync({ directory }),
    ])

    if (!current() || rev !== lifetime.agentRev) return
    setState("agentsLoading", false)

    if (assets.status === "fulfilled") {
      setState({ agents: assets.value.assets, invalidAgents: assets.value.invalid })
    }

    if (assets.status === "rejected" || catalog.status === "rejected") {
      setState(
        "agentsError",
        errorMessage(
          assets.status === "rejected" ? assets.reason : catalog.status === "rejected" ? catalog.reason : undefined,
          language.t("home.custom.agents.error"),
        ),
      )
    }
  }

  async function viewAgentDefinition(asset: AgentAssetSummary) {
    const client = props.owner.client
    const directory = props.owner.directory

    if (!ready() || !client || !directory) return
    lifetime.agentReadAbort.abort()
    const controller = new AbortController()
    lifetime.agentReadAbort = controller
    setState({ agentReading: true, agentContentError: "", agentContent: undefined })

    try {
      const content = await client["agent-asset"].content(
        { directory, path: asset.relativePath },
        { signal: controller.signal },
      )

      if (current() && !controller.signal.aborted) setState({ agentReading: false, agentContent: content })
    } catch (error) {
      if (current() && !controller.signal.aborted) {
        setState({
          agentReading: false,
          agentContentError: errorMessage(error, language.t("home.custom.agents.contentError")),
        })
      }
    }
  }

  async function loadProfiles() {
    const client = props.owner.client
    const directory = props.owner.directory

    if (!ready() || !client || !directory) return
    const rev = ++lifetime.profileListRev
    setState({ profilesLoading: true, profilesError: "" })

    try {
      const answer = await client["custom-profile"].list({ directory }, { signal: lifetime.profileAbort.signal })

      if (!current() || rev !== lifetime.profileListRev) return
      setState({ profiles: answer.assets, profilesLoading: false })
    } catch (error) {
      if (!current() || rev !== lifetime.profileListRev) return
      setState({
        profilesLoading: false,
        profilesError: errorMessage(error, language.t("home.custom.profile.error.list")),
      })
    }
  }

  async function loadProfileBaseMetadata(path: string) {
    const client = props.owner.client
    const directory = props.owner.directory

    if (!ready() || !client || !directory) return

    try {
      const info = decodeProfileInfo(
        await client["custom-profile"].content({ directory, path }, { signal: lifetime.profileAbort.signal }),
      )

      if (!current()) return
      setState({
        baseProfile: info,
        profileProgress: props.draft.dirty ? { type: "idle" } : { type: "saved", info },
      })
    } catch {
      // Keep local unsaved draft intact even if base file was removed or unreadable.
    }
  }

  async function loadProfileIntoDraft(path: string, discardConfirmed = false) {
    const client = props.owner.client
    const directory = props.owner.directory

    if (!ready() || !client || !directory || editingDisabled() || pendingProfileRead()) return
    if (!discardConfirmed && !(await props.confirmDraftReplacement())) return
    if (!ready()) return
    const editVersion = props.draft.editVersion
    cancelPreview()
    const rev = ++lifetime.profileRev
    setState({ profileProgress: { type: "loading", path }, profileError: "", profileNotice: "", deleteConfirm: false })

    try {
      const info = decodeProfileInfo(
        await client["custom-profile"].content({ directory, path }, { signal: lifetime.profileAbort.signal }),
      )

      if (!current() || rev !== lifetime.profileRev || props.draft.editVersion !== editVersion) return
      const nameByPath = new Map(state.agents.map((item) => [item.relativePath, item.name]))
      props.replaceDraft(composeDraftFromProfile(info, nameByPath))
      setState({
        baseProfile: info,
        profileProgress: { type: "saved", info },
        capturedRoot: info.profile.root,
      })
    } catch (error) {
      if (!current() || rev !== lifetime.profileRev) return
      setState({
        profileProgress: { type: "idle" },
        profileError: errorMessage(error, language.t("home.custom.profile.error.content")),
      })
    }
  }

  async function startNewDraft(rootID: "build" | "plan" | "meta" = "build", discardConfirmed = false) {
    if (!discardConfirmed && !(await props.confirmDraftReplacement())) return
    if (!current()) return
    lifetime.profileRev += 1
    cancelPreview()
    props.replaceDraft(initialComposeDraft(rootID))
    setState({
      baseProfile: undefined,
      capturedRoot: undefined,
      profileProgress: { type: "idle" },
      profileError: "",
      profileNotice: "",
      deleteConfirm: false,
    })
  }

  async function loadWorkflows() {
    const client = props.owner.client
    const directory = props.owner.directory

    if (!ready() || !client || !directory) return
    lifetime.workflowAbort.abort()
    const controller = new AbortController()
    lifetime.workflowAbort = controller
    const rev = ++lifetime.workflowRev
    setState("workflowsLoading", true)

    try {
      const answer = await client["workflow-asset"].list({ directory }, { signal: controller.signal })

      if (!current() || rev !== lifetime.workflowRev) return
      setState({ workflows: answer.assets, workflowsLoading: false })
    } catch {
      if (!current() || rev !== lifetime.workflowRev) return
      setState("workflowsLoading", false)
    }
  }

  async function loadWorkflowDetail(path: string) {
    const client = props.owner.client
    const directory = props.owner.directory

    if (!ready() || !client || !directory) return

    try {
      const detail = await client["workflow-asset"].content(
        { directory, path },
        { signal: lifetime.workflowAbort.signal },
      )

      if (!current()) return
      setState({ workflowDetail: detail, workflowDetailError: "" })
    } catch (error) {
      if (!current()) return
      setState({
        workflowDetail: undefined,
        workflowDetailError: errorMessage(error, language.t("home.custom.agents.contentError")),
      })
    }
  }

  async function loadScopedBindingAssets(kind: ScopedAssetKind, scope: AssetPlacement.Scope) {
    const client = props.owner.client
    const directory = props.owner.directory

    if (!ready() || !client || !directory) return
    lifetime.bindingAbort.abort()
    const controller = new AbortController()
    lifetime.bindingAbort = controller
    const rev = ++lifetime.bindingRev
    setState({ bindingLoading: true, bindingError: "", bindingItems: [], bindingTarget: undefined })

    try {
      if (kind === "prompt") {
        const res = await client["prompt-asset"].list({ directory, scope }, { signal: controller.signal })

        if (!current() || rev !== lifetime.bindingRev) return
        setState({ bindingItems: res.assets, bindingTarget: res.target, bindingLoading: false })

        return
      }

      if (kind === "skill") {
        const res = await client["skill-asset"].list({ directory, scope }, { signal: controller.signal })

        if (!current() || rev !== lifetime.bindingRev) return
        setState({ bindingItems: res.assets, bindingTarget: res.target, bindingLoading: false })

        return
      }

      const res = await client["command-asset"].list({ directory, scope }, { signal: controller.signal })

      if (!current() || rev !== lifetime.bindingRev) return
      setState({ bindingItems: res.assets, bindingTarget: res.target, bindingLoading: false })
    } catch (error) {
      if (!current() || rev !== lifetime.bindingRev) return
      setState({ bindingLoading: false, bindingError: errorMessage(error, language.t("home.custom.assets.error")) })
    }
  }

  async function loadMcpAssets() {
    const client = props.owner.client
    const directory = props.owner.directory

    if (!ready() || !client || !directory) return
    lifetime.mcpAbort.abort()
    const controller = new AbortController()
    lifetime.mcpAbort = controller
    const rev = ++lifetime.mcpRev
    setState("mcpLoading", true)

    try {
      const res = await client["mcp-asset"].list({ directory }, { signal: controller.signal })

      if (!current() || rev !== lifetime.mcpRev) return
      setState({ mcpAssets: res.assets, mcpLoading: false })
    } catch {
      if (!current() || rev !== lifetime.mcpRev) return
      setState("mcpLoading", false)
    }
  }

  function selectRoot(next: StoredRoot) {
    setState("capturedRoot", undefined)
    mutateDraft((draft) => ({
      ...draft,
      root: next,
      agents:
        next.source === "asset"
          ? draft.agents.filter((agent) => agent.relativePath !== next.relativePath)
          : draft.agents,
    }))
  }

  function toggleMember(asset: AgentAssetSummary) {
    const exists = props.draft.agents.some((item) => item.relativePath === asset.relativePath)

    if (!exists && props.draft.agents.length >= MAX_COMPOSITION_AGENTS) return

    mutateDraft((draft) => ({
      ...draft,
      agents: exists
        ? draft.agents.filter((item) => item.relativePath !== asset.relativePath)
        : [
            ...draft.agents,
            { kind: "agent", relativePath: asset.relativePath, revision: asset.revision, name: asset.name },
          ],
    }))
  }

  function mountToActiveRole(kind: ScopedAssetKind, item: ScopedCatalogEntry) {
    const consumer = activeConsumer()
    const target = state.bindingTarget
      ? { scope: state.bindingTarget.scope, root: state.bindingTarget.root }
      : undefined

    mutateDraft((draft) => {
      const existing = draft.bindings[consumer] ?? { prompts: [], skills: [], commands: [] }
      const sameTarget = (refTarget: { scope: string; root: string } | undefined) =>
        (refTarget?.scope ?? "location") === (target?.scope ?? "location") &&
        (refTarget?.root ?? "") === (target?.root ?? "")

      const nextBinding: StoredBinding = {
        prompts:
          kind === "prompt"
            ? [
                ...existing.prompts.filter(
                  (ref) => !(ref.relativePath === item.relativePath && sameTarget(ref.target)),
                ),
                {
                  kind: "prompt",
                  relativePath: item.relativePath,
                  revision: item.revision,
                  ...(target ? { target } : {}),
                },
              ]
            : existing.prompts,
        skills:
          kind === "skill"
            ? [
                ...existing.skills.filter((ref) => !(ref.relativePath === item.relativePath && sameTarget(ref.target))),
                {
                  kind: "skill",
                  relativePath: item.relativePath,
                  revision: item.revision,
                  ...(target ? { target } : {}),
                },
              ]
            : existing.skills,
        commands:
          kind === "command"
            ? [
                ...existing.commands.filter(
                  (ref) => !(ref.relativePath === item.relativePath && sameTarget(ref.target)),
                ),
                {
                  kind: "command",
                  relativePath: item.relativePath,
                  revision: item.revision,
                  ...(target ? { target } : {}),
                },
              ]
            : existing.commands,
      }

      return {
        ...draft,
        bindings: {
          ...draft.bindings,
          [consumer]: nextBinding,
        },
      }
    })
  }

  function unmountFromActiveRole(kind: ScopedAssetKind, index: number) {
    const consumer = activeConsumer()

    mutateDraft((draft) => {
      const existing = draft.bindings[consumer]

      if (!existing) return draft

      return {
        ...draft,
        bindings: {
          ...draft.bindings,
          [consumer]: {
            prompts: kind === "prompt" ? existing.prompts.filter((_, i) => i !== index) : existing.prompts,
            skills: kind === "skill" ? existing.skills.filter((_, i) => i !== index) : existing.skills,
            commands: kind === "command" ? existing.commands.filter((_, i) => i !== index) : existing.commands,
          },
        },
      }
    })
  }

  function cleanDanglingBindings() {
    const dangling = new Set(danglingConsumers())

    if (dangling.size === 0) return

    mutateDraft((draft) => ({
      ...draft,
      bindings: Object.fromEntries(Object.entries(draft.bindings).filter(([key]) => !dangling.has(key))),
    }))
  }

  function addMcpBinding() {
    const asset = state.mcpAssets.find((item) => item.relativePath === state.mcpSelectedAsset)

    if (!asset) {
      setState("mcpFormError", language.t("home.custom.compose.mcpAddFromAsset"))

      return
    }

    const command = state.mcpCommand.trim().split(/\s+/).filter(Boolean)

    const next: StoredMcpBinding = {
      serverName: state.mcpServerName.trim() || asset.name,
      ref: { relativePath: asset.relativePath, revision: asset.revision },
      transport: state.mcpTransport,
      ...(state.mcpTransport === "stdio" ? { command } : { url: state.mcpUrl.trim() }),
      ...(state.mcpCredentialRef.trim() ? { credentialRef: state.mcpCredentialRef.trim() } : {}),
    }

    const checked = validateMcpBindingInput(next)

    if (!checked.valid) {
      setState("mcpFormError", checked.error ?? language.t("home.custom.profile.error.save"))

      return
    }

    setState({
      mcpFormError: "",
      mcpServerName: "",
      mcpCommand: "",
      mcpUrl: "",
      mcpCredentialRef: "",
    })
    mutateDraft((draft) => ({
      ...draft,
      mcpBindings: [...draft.mcpBindings.filter((item) => item.serverName !== next.serverName), next],
    }))
  }

  function removeMcpBinding(serverName: string) {
    mutateDraft((draft) => ({
      ...draft,
      mcpBindings: draft.mcpBindings.filter((item) => item.serverName !== serverName),
    }))
  }

  async function resolvePlan(profile?: CustomProfile.Info) {
    const client = props.owner.client
    const directory = props.owner.directory

    if (!ready() || !client || !directory || planLocked() || state.planProgress.type === "previewing") return

    if (!profile && requiresProfileForMcp(props.draft)) {
      setState("planError", language.t("home.custom.compose.saveRequiredForMcp"))

      return
    }

    const temporary = profile ? undefined : toTemporaryCompositionInput(props.draft)

    if (!profile && !temporary) {
      setState("planError", language.t("home.custom.error.preview"))

      return
    }

    cancelPreview()
    const rev = lifetime.planRev
    setState({ planProgress: { type: "previewing" }, previewProfile: profile })

    try {
      const plan = await client["custom-composition"].plan(
        {
          directory,
          payload: profile
            ? { source: "profile", profilePath: profile.relativePath, profileRevision: profile.revision }
            : temporary!,
        },
        { signal: lifetime.planAbort.signal },
      )

      if (!current() || rev !== lifetime.planRev) return

      if (plan.valid && plan.input.source === "temporary" && plan.input.root && plan.input.root.revision) {
        const captured = Schema.decodeUnknownSync(Composition.Root)(plan.input.root)
        setState("capturedRoot", captured)
      }

      setState("planProgress", { type: "preview", plan })
    } catch (error) {
      if (!current() || rev !== lifetime.planRev) return
      setState({
        planProgress: { type: "idle" },
        planError: errorMessage(error, language.t("home.custom.error.preview")),
      })
    }
  }

  async function openCreated(session: SessionInfo) {
    const context = props.owner.context
    const connection = props.owner.connection

    if (!context || !connection || !current()) return
    setState({ planProgress: { type: "created", session, opening: true }, planError: "" })

    try {
      context.data.session.invalidate(session.id)
      const canonical = await context.data.session.readback(session.id)

      if (!current()) return

      if (!canonical) throw new Error(language.t("home.custom.error.readback"))
      props.replaceDraft(initialComposeDraft("build"))
      props.home.project.openProjectSession(connection, canonical.location.directory, canonical)
    } catch (error) {
      if (!current()) return
      setState({
        planProgress: { type: "created", session, opening: false },
        planError: errorMessage(error, language.t("home.custom.error.readback")),
      })
    }
  }

  async function startSession() {
    const plan = previewPlan()

    if (state.planProgress.type !== "preview" || !plan?.valid || !ready()) return
    await adoptConfirmation({ sessionID: Session.ID.create(), plan, model: props.model() })
  }

  async function adoptConfirmation(confirmation: Confirmation) {
    const client = props.owner.client
    const context = props.owner.context
    const directory = props.owner.directory

    if (!ready() || !client || !context || !directory || planBusy()) return
    setState({ planProgress: { type: "confirming", confirmation, pending: true }, planError: "" })

    try {
      const payload = {
        sessionID: confirmation.sessionID,
        composition: confirmation.plan.input,
        expectedPlanDigest: confirmation.plan.digest,
      }
      const response = await client["custom-composition"].start(
        {
          directory,
          payload: confirmation.model ? { ...payload, model: confirmation.model } : payload,
        },
        { signal: lifetime.planAbort.signal },
      )

      if (!current()) return
      context.data.session.remember(response.session)
      await openCreated(response.session)
    } catch (error) {
      if (!current()) return

      if (
        isCompositionResolveError(error) ||
        (isInvalidRequestError(error) &&
          error.field === "model" &&
          (error.kind === "meta_model_missing" ||
            error.kind === "meta_model_unavailable" ||
            error.kind === "meta_model_invalid"))
      ) {
        setState({
          planProgress: { type: "idle" },
          planError: isCompositionResolveError(error)
            ? error.diagnostics?.map((item) => item.message).join("\n") || error.message
            : errorMessage(error, language.t("home.custom.error.rejected")),
        })

        return
      }

      setState({
        planProgress: { type: "confirming", confirmation, pending: false },
        planError: errorMessage(error, language.t("home.custom.error.create")),
      })
    }
  }

  async function readSavedProfile(attempt: SaveAttempt, acknowledged?: CustomProfile.Info) {
    const client = props.owner.client
    const directory = props.owner.directory

    if (!ready() || !client || !directory || planLocked()) return
    const rev = ++lifetime.profileRev
    const targetPath = acknowledged?.relativePath ?? attempt.candidate.relativePath
    setState({ profileProgress: { type: "checking", attempt, acknowledged }, profileError: "" })

    try {
      const [content, catalog] = await Promise.all([
        client["custom-profile"].content({ directory, path: targetPath }, { signal: lifetime.profileAbort.signal }),
        client["custom-profile"].list({ directory }, { signal: lifetime.profileAbort.signal }),
      ])

      if (!current() || rev !== lifetime.profileRev) return
      const info = decodeProfileInfo(content)
      setState("profiles", catalog.assets)

      if (
        info.name !== attempt.candidate.name ||
        info.description !== attempt.candidate.description ||
        info.relativePath !== attempt.candidate.relativePath ||
        !sameProfile(info.profile, attempt.candidate.profile) ||
        (acknowledged &&
          (info.relativePath !== acknowledged.relativePath || info.revision !== acknowledged.revision)) ||
        !catalog.assets.some(
          (entry) =>
            entry.relativePath === info.relativePath && entry.revision === info.revision && entry.name === info.name,
        )
      ) {
        cancelPreview()
        setState({
          profileProgress: { type: "conflict", path: info.relativePath, current: info },
          profileError: language.t("home.custom.profile.error.changed", { path: info.relativePath }),
        })

        return
      }

      const nameByPath = new Map(state.agents.map((item) => [item.relativePath, item.name]))
      const untouchedSinceSave =
        props.draft.name.trim() === attempt.candidate.name &&
        props.draft.description === attempt.candidate.description &&
        props.draft.path.trim() === attempt.draftPath

      if (untouchedSinceSave) {
        props.replaceDraft(composeDraftFromProfile(info, nameByPath))
      }

      if (!untouchedSinceSave) {
        props.updateDraft((draft) => ({
          ...draft,
          kind: "profile",
          profilePath: info.relativePath,
          baseRevision: info.revision,
          dirty: true,
        }))
      }

      setState({
        baseProfile: info,
        capturedRoot: info.profile.root,
        profileProgress: { type: "saved", info },
        profileError: "",
      })
    } catch (error) {
      if (!current() || rev !== lifetime.profileRev) return

      if (!attempt.received && isNotFoundError(error)) {
        setState({
          profileProgress: { type: "idle" },
          profileError: language.t("home.custom.profile.error.unconfirmed", { path: targetPath }),
        })

        return
      }

      setState({
        profileProgress: { type: "read-failed", attempt, acknowledged },
        profileError: errorMessage(
          error,
          language.t(acknowledged ? "home.custom.profile.error.readback" : "home.custom.profile.error.ack"),
        ),
      })
    }
  }

  async function readConflictProfile(path: string) {
    const client = props.owner.client
    const directory = props.owner.directory

    if (!ready() || !client || !directory) return
    const rev = ++lifetime.profileRev

    try {
      const info = decodeProfileInfo(
        await client["custom-profile"].content({ directory, path }, { signal: lifetime.profileAbort.signal }),
      )

      if (!current() || rev !== lifetime.profileRev) return
      setState("profileProgress", { type: "conflict", path: info.relativePath, current: info })
    } catch (error) {
      if (!current() || rev !== lifetime.profileRev) return
      setState({
        profileProgress: { type: "conflict", path },
        profileError: errorMessage(error, language.t("home.custom.profile.error.content")),
      })
    }
  }

  async function saveProfile(replacement?: CustomProfile.Info) {
    const client = props.owner.client
    const directory = props.owner.directory

    if (!ready() || !client || !directory || editingDisabled() || pendingProfileRead()) return
    const built = candidateBuild()

    if (!built.candidate) {
      setState("profileError", language.t("home.custom.profile.error.save"))

      return
    }

    const baseRevision = replacement?.revision ?? (isOverwrite() ? props.draft.baseRevision : undefined)
    const attempt: SaveAttempt = {
      candidate: replacement
        ? new CustomProfile.Candidate({ ...built.candidate, relativePath: replacement.relativePath })
        : built.candidate,
      draftPath: props.draft.path.trim(),
      received: false,
      baseRevision,
    }

    cancelPreview()
    const rev = ++lifetime.profileRev
    setState({ profileProgress: { type: "saving", attempt }, profileError: "", profileNotice: "" })

    try {
      const answer = await client["custom-profile"].apply(
        {
          directory,
          candidate: attempt.candidate,
          overwrite: !!attempt.baseRevision,
          baseRevision: attempt.baseRevision,
        },
        { signal: lifetime.profileAbort.signal },
      )

      if (!current() || rev !== lifetime.profileRev) return
      attempt.received = true
      await readSavedProfile(attempt, decodeProfileInfo(answer))
    } catch (error) {
      if (!current() || rev !== lifetime.profileRev) return

      if (isConflictError(error)) {
        // Preserve local unsaved edits while loading current server revision.
        setState({
          profileProgress: { type: "conflict", path: attempt.candidate.relativePath },
          profileError: errorMessage(
            error,
            language.t("home.custom.profile.error.changed", { path: attempt.candidate.relativePath }),
          ),
        })
        await readConflictProfile(attempt.candidate.relativePath)

        return
      }

      if (isInvalidRequestError(error)) {
        setState({
          profileProgress: { type: "idle" },
          profileError: errorMessage(error, language.t("home.custom.profile.error.save")),
        })

        return
      }

      await readSavedProfile(attempt)
    }
  }

  async function previewSavedProfile() {
    const client = props.owner.client
    const directory = props.owner.directory
    const before = savedProfile()

    if (!ready() || !client || !directory || !before || props.draft.dirty || editingDisabled()) return
    cancelPreview()
    const rev = ++lifetime.profileRev
    setState({ profileProgress: { type: "previewing", info: before }, profileError: "" })

    try {
      const info = decodeProfileInfo(
        await client["custom-profile"].content(
          { directory, path: before.relativePath },
          { signal: lifetime.profileAbort.signal },
        ),
      )

      if (!current() || rev !== lifetime.profileRev) return

      if (info.relativePath !== before.relativePath || info.revision !== before.revision) {
        cancelPreview()
        setState({
          profileProgress: { type: "conflict", path: before.relativePath, current: info },
          profileError: language.t("home.custom.profile.error.changed", { path: before.relativePath }),
        })

        return
      }

      await resolvePlan(info)

      if (!current() || rev !== lifetime.profileRev) return
      setState("profileProgress", { type: "saved", info })
    } catch (error) {
      if (!current() || rev !== lifetime.profileRev) return
      setState({
        profileProgress: { type: "saved", info: before },
        profileError: errorMessage(error, language.t("home.custom.profile.error.preview")),
      })
    }
  }

  async function deleteSavedProfile() {
    const client = props.owner.client
    const directory = props.owner.directory
    const target = state.baseProfile

    if (!ready() || !client || !directory || !target || editingDisabled()) return
    const rev = ++lifetime.profileRev
    setState({
      profileProgress: { type: "deleting", path: target.relativePath },
      profileError: "",
      deleteConfirm: false,
    })

    try {
      await client["custom-profile"].remove(
        {
          directory,
          relativePath: target.relativePath,
          baseRevision: target.revision,
        },
        { signal: lifetime.profileAbort.signal },
      )

      if (!current() || rev !== lifetime.profileRev) return
      await startNewDraft("build", true)
      setState("profileNotice", language.t("home.custom.compose.deleteProfileDone"))
      void loadProfiles()
    } catch (error) {
      if (!current() || rev !== lifetime.profileRev) return
      setState({
        profileProgress: { type: "saved", info: target },
        profileError: errorMessage(error, language.t("home.custom.compose.deleteProfileError")),
      })
    }
  }

  const rootSelected = (asset: AgentAssetSummary) =>
    props.draft.root.source === "asset" &&
    props.draft.root.relativePath === asset.relativePath &&
    props.draft.root.revision === asset.revision

  const memberSelected = (asset: AgentAssetSummary) =>
    props.draft.agents.some((ref) => ref.relativePath === asset.relativePath && ref.revision === asset.revision)

  const planRoot = () => {
    const input = previewPlan()?.input

    return input?.source === "temporary" ? input.root : state.previewProfile?.profile.root
  }

  return (
    <section role="region" aria-label={language.t("home.custom.title")} class="flex min-w-0 flex-col gap-3">
      {/* Entry header */}
      <div class="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div class="flex min-w-0 flex-col gap-0.5">
          <h2 class="text-[14px] font-medium leading-[var(--line-height-base)]">{language.t("home.custom.title")}</h2>
          <p class="text-v2-text-text-muted">{language.t("home.custom.compose.entryDescription")}</p>
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="small"
            variant="ghost"
            disabled={editingDisabled()}
            onClick={() => startNewDraft("build")}
          >
            {language.t("home.custom.compose.newBuiltin")}
          </Button>
          <Button
            type="button"
            size="small"
            variant="ghost"
            disabled={!props.owner.directory}
            title={language.t("home.custom.compose.aiBoundary")}
            onClick={() =>
              props.openChatDraft(
                language.t("home.custom.use.chatDraftPrompt", {
                  target: props.draft.name || props.draft.root.id,
                  task: language.t("home.custom.compose.aiBoundary"),
                }),
              )
            }
          >
            {language.t("home.custom.compose.aiDraft")}
          </Button>
          <Show when={props.draft.dirty}>
            <Button
              type="button"
              size="small"
              variant="ghost"
              disabled={editingDisabled()}
              onClick={() =>
                state.baseProfile
                  ? props.replaceDraft(composeDraftFromProfile(state.baseProfile))
                  : startNewDraft("build", true)
              }
            >
              {language.t("home.custom.compose.discard")}
            </Button>
          </Show>
        </div>
      </div>

      <p class="text-[12px] text-v2-text-text-muted">{language.t("home.custom.compose.aiBoundary")}</p>

      <Show when={props.owner.directory}>
        {(directory) => <bdi class="break-all text-[12px] text-v2-text-text-muted">{directory()}</bdi>}
      </Show>
      <Show when={!props.owner.directory}>
        <p role="status" class="text-v2-text-text-muted">
          {language.t("home.custom.project.required")}
        </p>
      </Show>
      <Show when={!connected()}>
        <p role="status" class="text-v2-text-text-muted">
          {language.t("home.custom.connection.required")}
        </p>
      </Show>

      <div data-component="custom-compose-grid">
        {/* 1. Root & Members */}
        <div data-component="custom-card">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 class="font-medium">{language.t("home.custom.root.label")}</h3>
            <Badge>
              {language.t("home.custom.compose.membersLimit", {
                count: props.draft.agents.length,
                max: MAX_COMPOSITION_AGENTS,
              })}
            </Badge>
          </div>
          <div role="group" aria-label={language.t("home.custom.root.label")} class="flex flex-wrap gap-1">
            <For each={BUILTIN_ROOTS}>
              {(rootID) => (
                <Button
                  type="button"
                  size="small"
                  variant={
                    props.draft.root.source === "builtin" && props.draft.root.id === rootID ? "neutral" : "ghost"
                  }
                  aria-pressed={props.draft.root.source === "builtin" && props.draft.root.id === rootID}
                  disabled={editingDisabled()}
                  onClick={() => selectRoot({ source: "builtin", id: rootID })}
                >
                  {language.t(`home.custom.root.${rootID}`)}
                </Button>
              )}
            </For>
          </div>
          <Show when={props.draft.root.source === "asset" ? props.draft.root : undefined}>
            {(root) => (
              <p class="break-all text-[12px] text-v2-text-text-muted">
                {language.t("home.custom.root.label")}: <bdi>{root().id}</bdi> ({root().relativePath})
              </p>
            )}
          </Show>

          <section
            role="region"
            aria-label={language.t("home.custom.agents.title")}
            class="flex min-w-0 flex-col gap-2"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h4 class="font-medium">{language.t("home.custom.agents.title")}</h4>
              <Button
                type="button"
                size="small"
                variant="ghost"
                disabled={!ready() || state.agentsLoading}
                onClick={() => void loadAgents()}
              >
                {language.t("home.custom.agents.refresh")}
              </Button>
            </div>
            <Show when={state.agentsLoading}>
              <p role="status">{language.t("home.custom.agents.loading")}</p>
            </Show>
            <Show when={state.agentsError}>
              <p role="alert">{state.agentsError}</p>
            </Show>
            <Show
              when={state.agents.length > 0}
              fallback={<p class="text-[12px] text-v2-text-text-muted">{language.t("home.custom.agents.empty")}</p>}
            >
              <ul class="flex min-w-0 flex-col gap-2">
                <For each={state.agents}>
                  {(asset) => (
                    <li class="flex min-w-0 flex-col gap-1 rounded-[4px] border border-v2-border-border-base p-2">
                      <div class="flex flex-wrap items-center gap-x-2">
                        <Icon
                          name="subagent"
                          size="small"
                          class="shrink-0 text-v2-icon-icon-base"
                          style={{ "--omnxa-core-color": agentAssetColor(asset) }}
                        />
                        <bdi class="break-all font-medium">{asset.name}</bdi>
                        <span class="text-[12px] text-v2-text-text-muted">
                          {asset.disabled
                            ? language.t("home.custom.agents.disabled")
                            : asset.hidden
                              ? language.t("home.custom.agents.hidden")
                              : asset.mode
                                ? language.t(`home.custom.agents.role.${asset.mode}`)
                                : language.t("home.custom.agents.invalid")}
                        </span>
                      </div>
                      <Show when={asset.description}>
                        <p class="break-words text-[12px] text-v2-text-text-muted">{asset.description}</p>
                      </Show>
                      <bdi class="break-all text-[12px] text-v2-text-text-muted">{asset.relativePath}</bdi>
                      <code class="break-all text-[11px] text-v2-text-text-muted">{asset.revision}</code>
                      <div class="flex flex-wrap gap-1">
                        <Button
                          type="button"
                          size="small"
                          variant={rootSelected(asset) ? "neutral" : "ghost"}
                          aria-pressed={rootSelected(asset)}
                          disabled={
                            editingDisabled() ||
                            asset.disabled ||
                            asset.hidden ||
                            asset.mode === "subagent" ||
                            asset.mode === undefined
                          }
                          onClick={() =>
                            selectRoot({
                              source: "asset",
                              kind: "agent",
                              id: asset.name,
                              relativePath: asset.relativePath,
                              revision: asset.revision,
                            })
                          }
                        >
                          {language.t(
                            rootSelected(asset) ? "home.custom.agents.rootSelected" : "home.custom.agents.root",
                          )}
                        </Button>
                        <Button
                          type="button"
                          size="small"
                          variant={memberSelected(asset) ? "neutral" : "ghost"}
                          aria-pressed={memberSelected(asset)}
                          disabled={
                            editingDisabled() ||
                            asset.disabled ||
                            asset.hidden ||
                            asset.mode === "primary" ||
                            asset.mode === undefined ||
                            props.draft.root.id === asset.name ||
                            (!memberSelected(asset) && props.draft.agents.length >= MAX_COMPOSITION_AGENTS)
                          }
                          onClick={() => toggleMember(asset)}
                        >
                          {language.t(memberSelected(asset) ? "home.custom.agents.remove" : "home.custom.agents.add")}
                        </Button>
                        <Button
                          type="button"
                          size="small"
                          variant="ghost"
                          disabled={!ready()}
                          onClick={() => void viewAgentDefinition(asset)}
                        >
                          {language.t("home.custom.agents.view")}
                        </Button>
                      </div>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <Show when={state.agentReading}>
              <p role="status">{language.t("home.custom.agents.contentLoading")}</p>
            </Show>
            <Show when={state.agentContentError}>
              <p role="alert">{state.agentContentError}</p>
            </Show>
            <Show when={state.agentContent}>
              {(detail) => (
                <div data-slot="custom-code-block">
                  <div>
                    {detail().name} · {detail().relativePath}
                  </div>
                  <Show when={detail().config}>
                    <pre>{detail().config}</pre>
                  </Show>
                  <pre>{detail().source}</pre>
                </div>
              )}
            </Show>
            <Show when={configuredAgents().length > 0}>
              <p class="text-[12px] font-medium">{language.t("home.custom.agents.config")}</p>
              <p class="text-[12px] text-v2-text-text-muted">{language.t("home.custom.agents.configHint")}</p>
            </Show>
          </section>

          <Show when={props.draft.agents.length > 0}>
            <div class="flex flex-col gap-1">
              <h4 class="text-[12px] font-medium">{language.t("home.custom.agents.selected.title")}</h4>
              <ul class="flex flex-col gap-1">
                <For each={props.draft.agents}>
                  {(agent) => (
                    <li class="flex flex-wrap items-center gap-2 text-[12px]">
                      <bdi class="break-all">{agent.relativePath}</bdi>
                      <code class="break-all text-[11px] text-v2-text-text-muted">{agent.revision}</code>
                      <Button
                        type="button"
                        size="small"
                        variant="ghost"
                        disabled={editingDisabled()}
                        onClick={() =>
                          mutateDraft((draft) => ({
                            ...draft,
                            agents: draft.agents.filter((item) => item.relativePath !== agent.relativePath),
                          }))
                        }
                      >
                        {language.t("home.custom.agents.remove")}
                      </Button>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </Show>
        </div>

        {/* 2. Per-role Equipment (Real Composition.Binding) */}
        <section
          role="region"
          aria-label={language.t("home.custom.compose.bindingsTitle")}
          data-component="custom-card"
        >
          <div class="flex flex-col gap-0.5">
            <h3 class="font-medium">{language.t("home.custom.compose.bindingsTitle")}</h3>
            <p class="text-[12px] text-v2-text-text-muted">{language.t("home.custom.compose.bindingsHint")}</p>
          </div>

          <Show when={danglingConsumers().length > 0}>
            <div role="alert" data-slot="custom-alert" class="flex flex-wrap items-center justify-between gap-2">
              <span>
                {language.t("home.custom.compose.danglingBindings", { roles: danglingConsumers().join(", ") })}
              </span>
              <Button
                type="button"
                size="small"
                variant="outline"
                disabled={editingDisabled()}
                onClick={cleanDanglingBindings}
              >
                {language.t("home.custom.compose.cleanDangling")}
              </Button>
            </div>
          </Show>

          <div role="group" aria-label={language.t("home.custom.compose.roleSelect")} class="flex flex-wrap gap-1.5">
            <For each={consumerRoles()}>
              {(role) => (
                <Button
                  type="button"
                  size="small"
                  variant={activeConsumer() === role.key ? "neutral" : "ghost"}
                  aria-pressed={activeConsumer() === role.key}
                  onClick={() => props.updateDraft((draft) => ({ ...draft, selectedConsumer: role.key }))}
                >
                  {role.label} ({bindingCount(props.draft.bindings[role.key])})
                </Button>
              )}
            </For>
          </div>
          <p class="text-[12px] text-v2-text-text-muted">
            {language.t("home.custom.compose.roleConsumerKey", { key: activeConsumer() })}
          </p>

          {/* Mounted bindings for active role */}
          <Show
            when={bindingCount(activeBinding()) > 0}
            fallback={
              <p class="text-[12px] text-v2-text-text-muted">{language.t("home.custom.compose.bindingsEmpty")}</p>
            }
          >
            <ul class="flex flex-col gap-1.5">
              <For each={activeBinding().prompts}>
                {(ref, index) => (
                  <li class="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-v2-border-border-base px-2 py-1 text-[12px]">
                    <span class="break-all">
                      <Badge>{language.t("home.custom.assets.kind.prompt")}</Badge>{" "}
                      <Show when={ref.target}>{(target) => <Badge>{target().scope}</Badge>}</Show>{" "}
                      <bdi>{ref.relativePath}</bdi>
                    </span>
                    <Button
                      type="button"
                      size="small"
                      variant="ghost"
                      disabled={editingDisabled()}
                      onClick={() => unmountFromActiveRole("prompt", index())}
                    >
                      {language.t("home.custom.compose.unmountAsset")}
                    </Button>
                  </li>
                )}
              </For>
              <For each={activeBinding().skills}>
                {(ref, index) => (
                  <li class="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-v2-border-border-base px-2 py-1 text-[12px]">
                    <span class="break-all">
                      <Badge>{language.t("home.custom.assets.kind.skill")}</Badge>{" "}
                      <Show when={ref.target}>{(target) => <Badge>{target().scope}</Badge>}</Show>{" "}
                      <bdi>{ref.relativePath}</bdi>
                    </span>
                    <Button
                      type="button"
                      size="small"
                      variant="ghost"
                      disabled={editingDisabled()}
                      onClick={() => unmountFromActiveRole("skill", index())}
                    >
                      {language.t("home.custom.compose.unmountAsset")}
                    </Button>
                  </li>
                )}
              </For>
              <For each={activeBinding().commands}>
                {(ref, index) => (
                  <li class="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-v2-border-border-base px-2 py-1 text-[12px]">
                    <span class="break-all">
                      <Badge>{language.t("home.custom.assets.kind.command")}</Badge>{" "}
                      <Show when={ref.target}>{(target) => <Badge>{target().scope}</Badge>}</Show>{" "}
                      <bdi>{ref.relativePath}</bdi>
                    </span>
                    <Button
                      type="button"
                      size="small"
                      variant="ghost"
                      disabled={editingDisabled()}
                      onClick={() => unmountFromActiveRole("command", index())}
                    >
                      {language.t("home.custom.compose.unmountAsset")}
                    </Button>
                  </li>
                )}
              </For>
            </ul>
          </Show>

          {/* Picker to mount Prompt / Skill / Command with explicit scope */}
          <div class="flex flex-wrap items-center gap-2 border-t border-v2-border-border-base pt-2">
            <div role="group" aria-label={language.t("home.custom.compose.mountAsset")} class="flex flex-wrap gap-1">
              <For each={bindingKinds}>
                {(kind) => (
                  <Button
                    type="button"
                    size="small"
                    variant={state.bindingKind === kind ? "neutral" : "ghost"}
                    aria-pressed={state.bindingKind === kind}
                    onClick={() => {
                      setState("bindingKind", kind)
                      void loadScopedBindingAssets(kind, state.bindingScope)
                    }}
                  >
                    {language.t(`home.custom.assets.kind.${kind}`)}
                  </Button>
                )}
              </For>
            </div>
            <div role="group" aria-label={language.t("home.custom.assets.scope.label")} class="flex flex-wrap gap-1">
              <For each={scopes}>
                {(scope) => (
                  <Button
                    type="button"
                    size="small"
                    variant={state.bindingScope === scope ? "neutral" : "ghost"}
                    aria-pressed={state.bindingScope === scope}
                    onClick={() => {
                      setState("bindingScope", scope)
                      void loadScopedBindingAssets(state.bindingKind, scope)
                    }}
                  >
                    {language.t(`home.custom.assets.scope.${scope}`)}
                  </Button>
                )}
              </For>
            </div>
          </div>

          <Show when={state.bindingLoading}>
            <p role="status" class="text-[12px] text-v2-text-text-muted">
              {language.t("home.custom.assets.loading")}
            </p>
          </Show>
          <Show when={state.bindingError}>
            <p role="alert" class="text-[12px]">
              {state.bindingError}
            </p>
          </Show>
          <Show
            when={state.bindingItems.length > 0}
            fallback={<p class="text-[12px] text-v2-text-text-muted">{language.t("home.custom.assets.empty")}</p>}
          >
            <ul class="flex flex-col gap-1">
              <For each={state.bindingItems}>
                {(item) => (
                  <li class="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                    <span class="min-w-0 break-all">
                      <strong>{item.name}</strong> · <bdi class="text-v2-text-text-muted">{item.relativePath}</bdi>
                    </span>
                    <Button
                      type="button"
                      size="small"
                      variant="outline"
                      disabled={editingDisabled()}
                      onClick={() => mountToActiveRole(state.bindingKind, item)}
                    >
                      {language.t("home.custom.compose.mountAsset")}
                    </Button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>

        {/* 3. Workflow Binding & Step-Executor Diagnostics */}
        <section
          role="region"
          aria-label={language.t("home.custom.compose.workflowTitle")}
          data-component="custom-card"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 class="font-medium">{language.t("home.custom.compose.workflowTitle")}</h3>
            <Select
              aria-label={language.t("home.custom.compose.workflowSelect")}
              options={[
                { path: "", label: language.t("home.custom.compose.workflowNone"), workflow: undefined },
                ...state.workflows.map((wf) => ({
                  path: wf.relativePath,
                  label: `${wf.name} (${wf.relativePath})`,
                  workflow: wf,
                })),
              ]}
              value={(option) => option.path}
              label={(option) => option.label}
              current={
                props.draft.workflow
                  ? {
                      path: props.draft.workflow.relativePath,
                      label: `${props.draft.workflow.name ?? props.draft.workflow.relativePath} (${props.draft.workflow.relativePath})`,
                      workflow: state.workflows.find((wf) => wf.relativePath === props.draft.workflow?.relativePath),
                    }
                  : { path: "", label: language.t("home.custom.compose.workflowNone"), workflow: undefined }
              }
              disabled={editingDisabled() || state.workflowsLoading}
              onSelect={(option) => {
                if (!option) return

                if (!option.workflow) {
                  mutateDraft((draft) => {
                    const { workflow: _, ...rest } = draft

                    return rest
                  })

                  return
                }

                mutateDraft((draft) => ({
                  ...draft,
                  workflow: {
                    kind: "workflow",
                    relativePath: option.workflow!.relativePath,
                    revision: option.workflow!.revision,
                    name: option.workflow!.name,
                  },
                }))
              }}
            />
          </div>

          <Show when={state.workflowDetailError}>
            <p role="alert" class="text-[12px]">
              {state.workflowDetailError}
            </p>
          </Show>

          <Show when={state.workflowDetail}>
            {(detail) => (
              <div class="flex flex-col gap-1.5 text-[12px]">
                <p class="text-v2-text-text-muted">
                  {detail().name} · <code>{detail().relativePath}</code>
                </p>
                <ul class="flex flex-col gap-1">
                  <For each={workflowDiagnostics()}>
                    {(step) => (
                      <li class="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-v2-border-border-base px-2 py-1">
                        <span>
                          <strong>{step.stepName}</strong> ({step.stepID}) → <code>{step.agent}</code>
                        </span>
                        <Show
                          when={step.matched}
                          fallback={
                            <span role="alert">
                              {step.matchesRootOnly
                                ? language.t("home.custom.compose.workflowStepRootOnly", { agent: step.agent })
                                : language.t("home.custom.compose.workflowStepMissing", { agent: step.agent })}
                            </span>
                          }
                        >
                          <Badge>{language.t("home.custom.compose.workflowStepMatched")}</Badge>
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
              </div>
            )}
          </Show>
        </section>

        {/* 4. External Capabilities (MCP) */}
        <section role="region" aria-label={language.t("home.custom.compose.mcpTitle")} data-component="custom-card">
          <h3 class="font-medium">{language.t("home.custom.compose.mcpTitle")}</h3>
          <p data-slot="custom-alert" class="text-v2-text-text-muted">
            {language.t("home.custom.compose.mcpProfileOnly")}
          </p>

          <Show
            when={props.draft.mcpBindings.length > 0}
            fallback={<p class="text-[12px] text-v2-text-text-muted">{language.t("home.custom.compose.mcpEmpty")}</p>}
          >
            <ul class="flex flex-col gap-1.5 text-[12px]">
              <For each={props.draft.mcpBindings}>
                {(binding) => (
                  <li class="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-v2-border-border-base px-2 py-1">
                    <span class="min-w-0 break-all">
                      <strong>{binding.serverName}</strong> · <Badge>{binding.transport}</Badge>{" "}
                      <code>{binding.ref.relativePath}</code>
                      <Show when={binding.url}>{(url) => <> · {url()}</>}</Show>
                      <Show when={binding.command}>{(cmd) => <> · {cmd().join(" ")}</>}</Show>
                      <Show when={binding.credentialRef}>{(cred) => <> · {cred()}</>}</Show>
                    </span>
                    <Button
                      type="button"
                      size="small"
                      variant="ghost"
                      disabled={editingDisabled()}
                      onClick={() => removeMcpBinding(binding.serverName)}
                    >
                      {language.t("home.custom.compose.mcpRemove")}
                    </Button>
                  </li>
                )}
              </For>
            </ul>
          </Show>

          <div class="flex flex-col gap-2 border-t border-v2-border-border-base pt-2">
            <div class="flex flex-wrap items-center gap-2">
              <Select
                aria-label={language.t("home.custom.compose.mcpAddFromAsset")}
                placeholder={language.t("home.custom.compose.mcpAddFromAsset")}
                options={state.mcpAssets.map((item) => ({
                  path: item.relativePath,
                  label: `${item.name} (${item.relativePath})`,
                  asset: item,
                }))}
                value={(option) => option.path}
                label={(option) => option.label}
                current={
                  state.mcpSelectedAsset
                    ? state.mcpAssets
                        .filter((item) => item.relativePath === state.mcpSelectedAsset)
                        .map((item) => ({
                          path: item.relativePath,
                          label: `${item.name} (${item.relativePath})`,
                          asset: item,
                        }))[0]
                    : undefined
                }
                disabled={editingDisabled() || state.mcpLoading}
                onSelect={(option) => {
                  if (!option) return
                  setState({
                    mcpSelectedAsset: option.path,
                    mcpServerName: option.asset.name,
                    mcpFormError: "",
                  })
                }}
              />
              <div role="group" aria-label={language.t("home.custom.compose.mcpTransport")} class="flex gap-1">
                <For each={["stdio", "remote"] as const}>
                  {(transport) => (
                    <Button
                      type="button"
                      size="small"
                      variant={state.mcpTransport === transport ? "neutral" : "ghost"}
                      aria-pressed={state.mcpTransport === transport}
                      disabled={editingDisabled()}
                      onClick={() => setState("mcpTransport", transport)}
                    >
                      {transport}
                    </Button>
                  )}
                </For>
              </div>
            </div>
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                type="text"
                data-slot="custom-input"
                aria-label={language.t("home.custom.compose.mcpServerName")}
                placeholder={language.t("home.custom.compose.mcpServerName")}
                disabled={editingDisabled()}
                value={state.mcpServerName}
                onInput={(event) => setState("mcpServerName", event.currentTarget.value)}
              />
              <Show
                when={state.mcpTransport === "stdio"}
                fallback={
                  <input
                    type="url"
                    data-slot="custom-input"
                    aria-label={language.t("home.custom.compose.mcpUrl")}
                    placeholder={language.t("home.custom.compose.mcpUrl")}
                    disabled={editingDisabled()}
                    value={state.mcpUrl}
                    onInput={(event) => setState("mcpUrl", event.currentTarget.value)}
                  />
                }
              >
                <input
                  type="text"
                  data-slot="custom-input"
                  aria-label={language.t("home.custom.compose.mcpCommand")}
                  placeholder={language.t("home.custom.compose.mcpCommand")}
                  disabled={editingDisabled()}
                  value={state.mcpCommand}
                  onInput={(event) => setState("mcpCommand", event.currentTarget.value)}
                />
              </Show>
              <input
                type="text"
                data-slot="custom-input"
                aria-label={language.t("home.custom.compose.mcpCredentialRef")}
                placeholder={language.t("home.custom.compose.mcpCredentialRef")}
                disabled={editingDisabled()}
                value={state.mcpCredentialRef}
                onInput={(event) => setState("mcpCredentialRef", event.currentTarget.value)}
              />
              <Button
                type="button"
                size="small"
                variant="outline"
                disabled={editingDisabled() || !state.mcpSelectedAsset}
                onClick={addMcpBinding}
              >
                {language.t("home.custom.compose.mcpAdd")}
              </Button>
            </div>
            <Show when={state.mcpFormError}>
              <p role="alert" class="text-[12px]">
                {state.mcpFormError}
              </p>
            </Show>
          </div>

          {/* Read-only live MCP servers status (never initiates probes/connections) */}
          <div class="flex flex-col gap-1 border-t border-v2-border-border-base pt-2 text-[12px]">
            <h4 class="font-medium text-v2-text-text-muted">{language.t("home.custom.compose.mcpRuntimeTitle")}</h4>
            <Show
              when={liveMcpServers().length > 0}
              fallback={<p class="text-v2-text-text-muted">{language.t("home.custom.compose.mcpRuntimeEmpty")}</p>}
            >
              <ul class="flex flex-wrap gap-1.5">
                <For each={liveMcpServers()}>
                  {(server) => (
                    <li data-slot="custom-chip">
                      <span>{server.name}</span>
                      <Badge>{server.status.status}</Badge>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        </section>

        {/* 5. Structured Relationship View (with full keyboard equivalents) */}
        <section role="region" aria-label={language.t("home.custom.compose.graphTitle")} data-component="custom-card">
          <div class="flex flex-col gap-0.5">
            <h3 class="font-medium">{language.t("home.custom.compose.graphTitle")}</h3>
            <p class="text-[12px] text-v2-text-text-muted">{language.t("home.custom.compose.graphHint")}</p>
          </div>
          <ul class="flex flex-col gap-1.5 text-[12px]">
            <For each={consumerRoles()}>
              {(role) => (
                <li class="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-v2-border-border-base px-2 py-1.5">
                  <div class="flex flex-wrap items-center gap-2">
                    <strong>{role.label}</strong>
                    <span class="text-v2-text-text-muted">{role.sublabel}</span>
                    <code>{role.key}</code>
                  </div>
                  <Button
                    type="button"
                    size="small"
                    variant="ghost"
                    onClick={() => props.updateDraft((draft) => ({ ...draft, selectedConsumer: role.key }))}
                  >
                    {language.t("home.custom.compose.bindingsTitle")}: {bindingCount(props.draft.bindings[role.key])}
                  </Button>
                </li>
              )}
            </For>
          </ul>
        </section>

        {/* 6. Model, Preview & Start */}
        <div data-component="custom-card">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-v2-text-text-muted">{language.t("home.custom.model.label")}</span>
            <Select
              aria-label={language.t("home.custom.model.label")}
              options={modelOptions()}
              value={(option) => option.key}
              label={(option) => option.label}
              optionDisabled={(option) => !!option.unavailable}
              current={modelOptions().find(
                (option) => option.key === (props.model() ? selectionKey(fromSelection(props.model()!)) : "default"),
              )}
              disabled={!ready() || planLocked() || props.modelsLoading()}
              onSelect={(option) => {
                if (!option) return
                cancelPreview()
                props.onSelectModel(option.model)
              }}
            />
            <Show when={props.modelsLoading()}>
              <span role="status" class="text-v2-text-text-muted">
                {language.t("home.custom.model.loading")}
              </span>
            </Show>
          </div>
          <p class="text-[12px] text-v2-text-text-muted">{language.t("home.custom.compose.modelSessionNote")}</p>

          <Show when={props.modelError()}>
            <div role="alert" class="flex flex-wrap items-center gap-2 text-[12px]">
              <span>{props.modelError()}</span>
              <Button type="button" size="small" variant="ghost" onClick={props.onRetryModels}>
                {language.t("home.custom.model.retry")}
              </Button>
            </div>
          </Show>

          <Show when={previewPlan()}>
            {(plan) => (
              <div class="flex min-w-0 flex-col gap-2" aria-label={language.t("home.custom.preview.title")}>
                <h3 class="font-medium">{language.t("home.custom.preview.title")}</h3>
                <dl class="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px]">
                  <dt class="text-v2-text-text-muted">{language.t("home.custom.source.label")}</dt>
                  <dd>
                    {language.t(
                      state.previewProfile
                        ? "home.custom.source.profile"
                        : planRoot()?.source === "asset"
                          ? "home.custom.source.asset"
                          : "home.custom.source.builtin",
                    )}
                  </dd>
                  <Show when={state.previewProfile}>
                    {(profile) => (
                      <>
                        <dt class="text-v2-text-text-muted">{language.t("home.custom.profile.path")}</dt>
                        <dd class="break-all">{profile().relativePath}</dd>
                        <dt class="text-v2-text-text-muted">{language.t("home.custom.profile.revision")}</dt>
                        <dd class="break-all font-mono">{profile().revision}</dd>
                      </>
                    )}
                  </Show>
                  <dt class="text-v2-text-text-muted">{language.t("home.custom.root.label")}</dt>
                  <dd>{plan().orchestrator?.name ?? props.draft.root.id}</dd>
                  <dt class="text-v2-text-text-muted">{language.t("home.custom.version.label")}</dt>
                  <dd class="break-all font-mono">
                    {planRoot()?.revision ?? language.t("home.custom.version.unavailable")}
                  </dd>
                  <dt class="text-v2-text-text-muted">{language.t("home.custom.model.label")}</dt>
                  <dd class="break-words">{modelLabel()}</dd>
                  <Show when={plan().mcp}>
                    {(mcp) => (
                      <>
                        <dt class="text-v2-text-text-muted">{language.t("home.custom.compose.mcpPlanRequested")}</dt>
                        <dd>{mcp().requested.length}</dd>
                        <dt class="text-v2-text-text-muted">{language.t("home.custom.compose.mcpPlanEffective")}</dt>
                        <dd>{mcp().effective.length}</dd>
                        <dt class="text-v2-text-text-muted">{language.t("home.custom.compose.mcpPlanDenied")}</dt>
                        <dd>{mcp().denied.length}</dd>
                      </>
                    )}
                  </Show>
                </dl>
                <div class="flex flex-col gap-1 text-[12px]">
                  <h4 class="font-medium">{language.t("home.custom.permissions.title")}</h4>
                  <Show
                    when={(plan().orchestrator?.permissions.length ?? 0) > 0}
                    fallback={<p class="text-v2-text-text-muted">{language.t("home.custom.permissions.empty")}</p>}
                  >
                    <ul class="flex flex-col gap-1">
                      <For each={plan().orchestrator?.permissions}>
                        {(rule) => (
                          <li class="flex flex-wrap gap-x-2">
                            <bdi class="break-all">{rule.action}</bdi>
                            <bdi class="break-all text-v2-text-text-muted">{rule.resource}</bdi>
                            <span>{language.t(`home.custom.permissions.${rule.effect}`)}</span>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                  <p class="text-v2-text-text-muted">{language.t("home.custom.permissions.live")}</p>
                </div>
                <For each={plan().diagnostics}>
                  {(diagnostic) => (
                    <p
                      role={diagnostic.severity === "blocking" || diagnostic.severity === "error" ? "alert" : "status"}
                      class="break-words text-[12px]"
                    >
                      {diagnostic.message}
                    </p>
                  )}
                </For>
              </div>
            )}
          </Show>

          <Show when={state.planError}>
            <p role="alert" class="break-words text-[12px]">
              {state.planError}
            </p>
          </Show>

          <div class="flex flex-wrap gap-2">
            <Show when={state.planProgress.type !== "created"}>
              <Button
                type="button"
                size="small"
                variant="outline"
                disabled={!ready() || planLocked() || state.planProgress.type === "previewing"}
                onClick={() => void resolvePlan()}
              >
                {language.t(
                  state.planProgress.type === "previewing"
                    ? "home.custom.preview.loading"
                    : "home.custom.preview.action",
                )}
              </Button>
              <Show when={state.planProgress.type === "preview"}>
                <Button
                  type="button"
                  size="small"
                  variant="contrast"
                  disabled={!ready() || !previewPlan()?.valid || planBusy()}
                  onClick={() => void startSession()}
                >
                  {language.t("home.custom.create")}
                </Button>
              </Show>
              <Show when={state.planProgress.type === "preview" || state.planProgress.type === "previewing"}>
                <Button type="button" size="small" variant="ghost" onClick={cancelPreview}>
                  {language.t("common.cancel")}
                </Button>
              </Show>
              <Show when={state.planProgress.type === "confirming" ? state.planProgress : undefined}>
                {(confirmed) => (
                  <Show
                    when={confirmed().pending}
                    fallback={
                      <Button
                        type="button"
                        size="small"
                        variant="contrast"
                        disabled={!ready()}
                        onClick={() => void adoptConfirmation(confirmed().confirmation)}
                      >
                        {language.t("home.custom.retryConfirmation")}
                      </Button>
                    }
                  >
                    <span role="status" class="text-v2-text-text-muted">
                      {language.t("home.custom.creating")}
                    </span>
                  </Show>
                )}
              </Show>
            </Show>
            <Show when={state.planProgress.type === "created" ? state.planProgress : undefined}>
              {(created) => (
                <>
                  <p role="status">{language.t("home.custom.created")}</p>
                  <Button
                    type="button"
                    size="small"
                    variant="contrast"
                    disabled={created().opening || !ready()}
                    onClick={() => void openCreated(created().session)}
                  >
                    {language.t(created().opening ? "home.custom.opening" : "home.custom.open")}
                  </Button>
                </>
              )}
            </Show>
          </div>
        </div>

        {/* 7. Custom Profile CAS Save / Conflict / Delete */}
        <section role="region" aria-label={language.t("home.custom.profile.title")} data-component="custom-card">
          <h3 class="font-medium leading-[var(--line-height-base)]">{language.t("home.custom.profile.title")}</h3>
          <div class="flex flex-wrap items-center gap-2">
            <Select
              aria-label={language.t("home.custom.profile.select")}
              options={profileOptions()}
              current={profileOptions().find((option) => option.path === (state.baseProfile?.relativePath ?? ""))}
              value={(option) => option.path}
              label={(option) => option.label}
              disabled={!ready() || editingDisabled() || pendingProfileRead()}
              onSelect={(option) => {
                if (!option) return

                if (!option.path) {
                  void startNewDraft("build")
                  return
                }
                void loadProfileIntoDraft(option.path)
              }}
            />
            <Button
              type="button"
              size="small"
              variant="ghost"
              disabled={!ready() || state.profilesLoading || editingDisabled()}
              onClick={() => void loadProfiles()}
            >
              {language.t(state.profilesLoading ? "home.custom.profile.loading" : "home.custom.profile.reload")}
            </Button>
          </div>

          <Show when={!state.profilesLoading && state.profiles.length === 0 && !state.profilesError}>
            <p class="text-[12px] text-v2-text-text-muted">{language.t("home.custom.profile.empty")}</p>
          </Show>
          <Show when={state.profilesError}>
            <p role="alert" class="break-words text-[12px]">
              {state.profilesError}
            </p>
          </Show>

          <div class="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField
              label={language.t("home.custom.profile.name")}
              value={props.draft.name}
              required
              maxLength={80}
              disabled={editingDisabled()}
              error={nameError()}
              validationState={nameError() ? "invalid" : "valid"}
              onChange={(name) => mutateDraft((draft) => ({ ...draft, name }))}
            />
            <TextField
              label={language.t("home.custom.profile.path")}
              placeholder={language.t("home.custom.profile.path.placeholder")}
              value={props.draft.path}
              required
              disabled={editingDisabled()}
              onChange={(path) => mutateDraft((draft) => ({ ...draft, path }))}
            />
          </div>
          <TextField
            label={language.t("home.custom.profile.description")}
            value={props.draft.description}
            maxLength={300}
            disabled={editingDisabled()}
            error={descriptionError()}
            validationState={descriptionError() ? "invalid" : "valid"}
            onChange={(description) => mutateDraft((draft) => ({ ...draft, description }))}
          />

          <Show when={candidateBuild().error === "missing_root_revision"}>
            <p class="text-[12px] text-v2-text-text-muted">{language.t("home.custom.profile.selection.required")}</p>
          </Show>

          <Show when={state.baseProfile}>
            {(base) => (
              <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px]">
                <dt class="text-v2-text-text-muted">{language.t("home.custom.profile.revision")}</dt>
                <dd class="break-all font-mono">{base().revision}</dd>
              </dl>
            )}
          </Show>

          <Show when={state.profileProgress.type === "saved" && !props.draft.dirty}>
            <p role="status" class="text-[12px] text-v2-text-text-muted">
              {language.t("home.custom.profile.saved")}
            </p>
          </Show>
          <Show when={state.profileNotice}>
            <p role="status" class="text-[12px] text-v2-text-text-muted">
              {state.profileNotice}
            </p>
          </Show>
          <Show when={state.profileError}>
            <p role="alert" class="break-words text-[12px]">
              {state.profileError}
            </p>
          </Show>

          {/* CAS Conflict recovery preserving local edits */}
          <Show when={conflictState()}>
            {(conflict) => (
              <div data-slot="custom-alert" class="flex flex-col gap-2">
                <Show when={conflict().current}>
                  {(serverInfo) => (
                    <p class="break-all font-mono">
                      {language.t("home.custom.profile.conflict.revision", { revision: serverInfo().revision })}
                    </p>
                  )}
                </Show>
                <div class="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="small"
                    variant="outline"
                    disabled={!ready() || editingDisabled()}
                    onClick={() => void loadProfileIntoDraft(conflict().path, true)}
                  >
                    {language.t("home.custom.profile.content.reload")}
                  </Button>
                  <Show when={conflict().current}>
                    {(serverInfo) => (
                      <Button
                        type="button"
                        size="small"
                        variant="contrast"
                        disabled={!ready() || editingDisabled() || !candidateBuild().candidate}
                        onClick={() => void saveProfile(serverInfo())}
                      >
                        {language.t("home.custom.profile.overwrite")}
                      </Button>
                    )}
                  </Show>
                </div>
              </div>
            )}
          </Show>

          {/* Lost-save-reply readback recovery */}
          <Show when={recoveryState()}>
            {(failed) => (
              <div class="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="small"
                  variant="outline"
                  disabled={!ready() || editingDisabled()}
                  onClick={() => void readSavedProfile(failed().attempt, failed().acknowledged)}
                >
                  {language.t("home.custom.profile.read.retry")}
                </Button>
              </div>
            )}
          </Show>

          <div class="flex flex-wrap gap-2">
            <Show when={!pendingProfileRead() && !conflictState()}>
              <Button
                type="button"
                size="small"
                variant="contrast"
                disabled={!ready() || editingDisabled() || !candidateBuild().candidate}
                onClick={() => void saveProfile()}
              >
                {language.t(
                  state.profileProgress.type === "saving"
                    ? "home.custom.profile.saving"
                    : isOverwrite()
                      ? "home.custom.profile.overwrite"
                      : "home.custom.profile.save",
                )}
              </Button>
            </Show>
            <Show when={savedProfile() && !conflictState() && !pendingProfileRead()}>
              <Button
                type="button"
                size="small"
                variant="outline"
                disabled={!ready() || editingDisabled() || props.draft.dirty}
                onClick={() => void previewSavedProfile()}
              >
                {language.t("home.custom.profile.preview")}
              </Button>
            </Show>
            <Show when={state.baseProfile}>
              {(base) => (
                <Show
                  when={state.deleteConfirm}
                  fallback={
                    <Button
                      type="button"
                      size="small"
                      variant="ghost"
                      disabled={!ready() || editingDisabled()}
                      onClick={() => setState("deleteConfirm", true)}
                    >
                      {language.t("home.custom.compose.deleteProfile")}
                    </Button>
                  }
                >
                  <div
                    role="alert"
                    data-slot="custom-alert"
                    class="flex w-full flex-wrap items-center justify-between gap-2"
                  >
                    <span>{language.t("home.custom.compose.deleteProfileConfirm", { path: base().relativePath })}</span>
                    <div class="flex gap-1.5">
                      <Button type="button" size="small" variant="contrast" onClick={() => void deleteSavedProfile()}>
                        {language.t("home.custom.compose.deleteProfile")}
                      </Button>
                      <Button
                        type="button"
                        size="small"
                        variant="ghost"
                        onClick={() => setState("deleteConfirm", false)}
                      >
                        {language.t("common.cancel")}
                      </Button>
                    </div>
                  </div>
                </Show>
              )}
            </Show>
          </div>
        </section>
      </div>
    </section>
  )
}

export default ComposeWorkspace
