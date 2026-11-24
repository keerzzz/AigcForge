import {
  isCompositionResolveError,
  isInvalidRequestError,
  type CompositionHealth,
  type CustomCompositionPlanOutput,
  type CustomProfileInfo,
  type CustomProfileInvalidEntry,
  type CustomProfileSummary,
  type ModelSelection,
  type SessionInfo,
} from "@omnixa/client/promise"
import { Composition } from "@omnixa/schema/composition"
import { Button } from "@omnixa/ui/button"
import { Icon } from "@omnixa/ui/icon"
import { Select } from "@omnixa/ui/select"
import { createEffect, createMemo, For, onCleanup, Show, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { errorMessage } from "@/shell/layout/helpers"
import { fromSelection, selectionKey } from "@/providers/models/key"
import type { HomeController } from "../model"
import {
  BUILTIN_ROOTS,
  buildFirstPromptPayload,
  composeDraftFromProfile,
  initialComposeDraft,
  nextInputIDAfterEdit,
  preparePendingTaskStart,
  type BuiltinRootID,
  type ComposeDraft,
  type CustomWorkspaceState,
  type PendingTaskStart,
  type SelectedUse,
  type TaskMaterial,
} from "./draft"
import { uploadAttachment } from "@/composer/attachments/destination"
import { uuid } from "@/runtime/persistence/uuid"
import { Schema } from "effect"
import { Model } from "@omnixa/schema/model"
import { buildModelOptions, formatSelectedModelLabel, type CustomOwner } from "./shared"

type Progress =
  | { type: "idle" }
  | { type: "previewing" }
  | { type: "preview"; plan: CustomCompositionPlanOutput }
  | { type: "confirming"; confirmation: PendingTaskStart; pending: boolean }
  | { type: "admitting"; session: SessionInfo; confirmation: PendingTaskStart }
  | { type: "admit-unknown"; session: SessionInfo; confirmation: PendingTaskStart }
  | { type: "created"; session: SessionInfo; opening: boolean }

export function CustomUseHome(props: {
  home: HomeController
  owner: CustomOwner
  active: () => boolean
  current: () => boolean
  storageReady: () => boolean
  workspace: CustomWorkspaceState
  setSelectedUse: (next: SelectedUse) => void
  setTaskInput: (text: string, materials: TaskMaterial[], pending?: PendingTaskStart) => void
  setPendingStart: (pending: PendingTaskStart | undefined) => void
  openCompose: (draft?: ComposeDraft) => void
  openAssets: () => void
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
    listRevision: 0,
    detailRevision: 0,
    healthRevision: 0,
    previewRevision: 0,
    listAbort: new AbortController(),
    detailAbort: new AbortController(),
    healthAbort: new AbortController(),
    previewAbort: new AbortController(),
    uploadAbort: new AbortController(),
    summaryElement: undefined as HTMLElement | undefined,
  }

  const [state, setState] = createStore<{
    profiles: CustomProfileSummary[]
    invalidProfiles: CustomProfileInvalidEntry[]
    listing: boolean
    listError: string
    search: string
    filter: "all" | "builtin" | "profiles" | "solo" | "team"
    profileCards: Record<string, { info?: CustomProfileInfo; loading: boolean; error: string }>
    materialPath: string
    summaryOpen: boolean
    selectedProfile: CustomProfileInfo | undefined
    profileLoading: boolean
    profileError: string
    health: CompositionHealth | undefined
    healthLoading: boolean
    healthError: string
    progress: Progress
    uploading: string
    recovering: boolean
    error: string
  }>({
    profiles: [],
    invalidProfiles: [],
    listing: false,
    listError: "",
    search: "",
    filter: "all",
    profileCards: {},
    materialPath: "",
    summaryOpen: false,
    selectedProfile: undefined,
    profileLoading: false,
    profileError: "",
    health: undefined,
    healthLoading: false,
    healthError: "",
    progress: { type: "idle" },
    uploading: "",
    recovering: false,
    error: "",
  })

  const current = () => lifetime.active && props.current() && props.active()
  const connected = () => props.owner.context?.sdk.connection.status() === "connected"
  const ready = () =>
    current() && props.storageReady() && connected() && !!props.owner.directory && !!props.owner.client

  const busy = () =>
    !!state.uploading ||
    state.recovering ||
    state.progress.type === "previewing" ||
    (state.progress.type === "confirming" && state.progress.pending) ||
    state.progress.type === "admitting" ||
    (state.progress.type === "created" && state.progress.opening)

  const previewPlan = () => {
    if (state.progress.type === "preview") return state.progress.plan

    return undefined
  }

  const hasTaskContent = () => props.workspace.taskText.trim().length > 0 || props.workspace.taskMaterials.length > 0

  const modelOptions = createMemo(() =>
    buildModelOptions({
      owner: props.owner,
      selected: props.model(),
      language,
    }),
  )

  const modelLabel = () =>
    formatSelectedModelLabel({
      owner: props.owner,
      selected: props.model(),
      plan: previewPlan(),
      defaultModel: props.defaultModel(),
      language,
    })

  const queryText = () => state.search.trim().toLowerCase()

  const filteredBuiltins = createMemo(() => {
    if (state.filter === "profiles" || state.filter === "team") return []
    const q = queryText()

    return BUILTIN_ROOTS.filter((id) => {
      if (!q) return true
      const title = language.t(`home.custom.root.${id}`).toLowerCase()
      const desc = language.t(`home.custom.use.builtin.${id}.desc`).toLowerCase()

      return id.includes(q) || title.includes(q) || desc.includes(q)
    })
  })

  const filteredProfiles = createMemo(() => {
    if (state.filter === "builtin") return []
    const q = queryText()

    return state.profiles.filter((profile) => {
      const info = cardInfo(profile)
      if (info && state.filter === "solo" && info.profile.agents.length > 0) return false
      if (info && state.filter === "team" && info.profile.agents.length === 0) return false
      if (!q) return true

      return (
        profile.name.toLowerCase().includes(q) ||
        profile.description.toLowerCase().includes(q) ||
        profile.relativePath.toLowerCase().includes(q)
      )
    })
  })

  const visibleCards = new Map<Element, CustomProfileSummary>()
  const observer = new IntersectionObserver((entries) => {
    entries
      .filter((entry) => entry.isIntersecting)
      .forEach((entry) => {
        const profile = visibleCards.get(entry.target)
        if (!profile || !ready()) return
        observer.unobserve(entry.target)
        void loadCardDetail(profile)
      })
  })

  function cardInfo(profile: CustomProfileSummary) {
    const info = state.profileCards[profile.relativePath]?.info ?? state.selectedProfile
    return info?.relativePath === profile.relativePath && info.revision === profile.revision ? info : undefined
  }

  async function loadCardDetail(profile: CustomProfileSummary) {
    const client = props.owner.client
    const directory = props.owner.directory
    if (!ready() || !client || !directory || cardInfo(profile)) return
    if (state.profileCards[profile.relativePath]?.loading) return
    const revision = lifetime.listRevision
    const signal = lifetime.listAbort.signal
    setState("profileCards", profile.relativePath, { loading: true, error: "" })
    try {
      const info = await client["custom-profile"].content({ directory, path: profile.relativePath }, { signal })
      if (!current() || signal.aborted || revision !== lifetime.listRevision) return
      setState("profileCards", profile.relativePath, { info, loading: false, error: "" })
    } catch (error) {
      if (!current() || signal.aborted || revision !== lifetime.listRevision) return
      setState("profileCards", profile.relativePath, {
        loading: false,
        error: errorMessage(error, language.t("home.custom.profile.error.content")),
      })
    }
  }

  const equipment = (info: CustomProfileInfo) =>
    Object.values(info.profile.bindings ?? {}).reduce(
      (counts, binding) => ({
        prompts: counts.prompts + (binding.prompts?.length ?? 0),
        skills: counts.skills + (binding.skills?.length ?? 0),
        commands: counts.commands + (binding.commands?.length ?? 0),
      }),
      { prompts: 0, skills: 0, commands: 0 },
    )

  onCleanup(() => {
    lifetime.active = false
    observer.disconnect()
    visibleCards.clear()
    lifetime.listAbort.abort()
    lifetime.detailAbort.abort()
    lifetime.healthAbort.abort()
    lifetime.previewAbort.abort()
    lifetime.uploadAbort.abort()
  })

  createEffect(() => {
    if (props.workspace.pendingStart || busy()) return
    if (state.progress.type !== "confirming" && state.progress.type !== "admit-unknown") return
    untrack(() => setState({ progress: { type: "idle" }, error: "" }))
  })

  // Load saved profiles only when Surface ① is active and persisted storage has hydrated.
  createEffect(() => {
    const active = props.active()
    const hydrated = props.storageReady()
    const attempt = props.owner.context?.sdk.connection.attempt()
    const isConnected = connected()

    if (!active || !hydrated || !isConnected || attempt === undefined) {
      untrack(() => {
        lifetime.listRevision += 1
        lifetime.detailRevision += 1
        lifetime.healthRevision += 1
        lifetime.listAbort.abort()
        lifetime.listAbort = new AbortController()
        lifetime.detailAbort.abort()
        lifetime.detailAbort = new AbortController()
        lifetime.healthAbort.abort()
        lifetime.healthAbort = new AbortController()

        if (!isConnected && (state.progress.type === "preview" || state.progress.type === "previewing")) {
          cancelPreview()
        }
      })

      return
    }

    untrack(() => void loadProfiles())
  })

  // Load selected profile content on-demand when a profile is selected while Surface ① is active.
  createEffect(() => {
    const selected = props.workspace.selectedUse
    const active = props.active()
    const hydrated = props.storageReady()
    const isConnected = connected()

    if (!active || !hydrated || !isConnected || selected.kind !== "profile") {
      untrack(() => {
        if (selected.kind !== "profile") {
          setState({ selectedProfile: undefined, profileError: "", health: undefined, healthError: "" })
        }
      })

      return
    }

    const path = selected.path
    untrack(() => void loadProfileDetail(path))
  })

  function cancelPreview() {
    lifetime.previewRevision += 1
    lifetime.previewAbort.abort()
    lifetime.previewAbort = new AbortController()
    setState({ progress: { type: "idle" }, error: "" })
  }

  async function loadProfiles() {
    const client = props.owner.client
    const directory = props.owner.directory

    if (!ready() || !client || !directory) return
    lifetime.listAbort.abort()
    const controller = new AbortController()
    lifetime.listAbort = controller
    const revision = ++lifetime.listRevision
    setState({ listing: true, listError: "", profileCards: {} })

    try {
      const answer = await client["custom-profile"].list({ directory }, { signal: controller.signal })

      if (!current() || revision !== lifetime.listRevision) return
      setState({ profiles: answer.assets, invalidProfiles: answer.invalid, listing: false })
    } catch (error) {
      if (!current() || revision !== lifetime.listRevision) return
      setState({ listing: false, listError: errorMessage(error, language.t("home.custom.profile.error.list")) })
    }
  }

  async function loadProfileDetail(path: string) {
    const client = props.owner.client
    const directory = props.owner.directory

    if (!ready() || !client || !directory) return
    lifetime.detailAbort.abort()
    const controller = new AbortController()
    lifetime.detailAbort = controller
    const revision = ++lifetime.detailRevision
    setState({
      profileLoading: true,
      profileError: "",
      selectedProfile: undefined,
      health: undefined,
      healthError: "",
    })

    const cached = state.profileCards[path]?.info
    if (
      cached &&
      state.profiles.some((profile) => profile.relativePath === path && profile.revision === cached.revision)
    ) {
      setState({ selectedProfile: cached, profileLoading: false })
      return
    }

    try {
      const info = await client["custom-profile"].content({ directory, path }, { signal: controller.signal })

      if (!current() || revision !== lifetime.detailRevision) return
      setState({ selectedProfile: info, profileLoading: false })
    } catch (error) {
      if (!current() || revision !== lifetime.detailRevision) return
      setState({
        profileLoading: false,
        profileError: errorMessage(error, language.t("home.custom.profile.error.content")),
      })
    }
  }

  async function checkHealth() {
    const selected = props.workspace.selectedUse
    const client = props.owner.client
    const directory = props.owner.directory

    if (!ready() || !client || !directory || selected.kind !== "profile" || state.healthLoading) return
    lifetime.healthAbort.abort()
    const controller = new AbortController()
    lifetime.healthAbort = controller
    const revision = ++lifetime.healthRevision
    setState({ healthLoading: true, healthError: "", health: undefined })

    try {
      const health = await client["custom-composition"].health(
        { directory, path: selected.path },
        { signal: controller.signal },
      )

      if (!current() || revision !== lifetime.healthRevision) return
      setState({ health, healthLoading: false })
    } catch (error) {
      if (!current() || revision !== lifetime.healthRevision) return
      setState({ healthLoading: false, healthError: errorMessage(error, language.t("home.custom.use.healthError")) })
    }
  }

  function selectTarget(next: SelectedUse) {
    if (busy()) return
    cancelPreview()
    props.setSelectedUse(next)
  }

  function viewConfiguration(next: SelectedUse) {
    selectTarget(next)
    setState("summaryOpen", true)
    if (window.matchMedia("(max-width: 1023px)").matches) {
      lifetime.summaryElement?.scrollIntoView({ block: "start" })
    }
    lifetime.summaryElement?.focus({ preventScroll: true })
  }

  function updateTaskText(nextText: string) {
    const nextPending = nextInputIDAfterEdit(props.workspace.pendingStart, nextText, props.workspace.taskMaterials)
    props.setTaskInput(nextText, [...props.workspace.taskMaterials], nextPending)
  }

  function addPathMaterial() {
    const cleaned = state.materialPath.trim()

    if (!cleaned) return
    const name = cleaned.replaceAll("\\", "/").split("/").at(-1) ?? cleaned
    const next: TaskMaterial[] = [
      ...props.workspace.taskMaterials,
      {
        id: `mat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        kind: "file",
        path: cleaned,
        name,
        mime: "text/plain",
      },
    ]
    const nextPending = nextInputIDAfterEdit(props.workspace.pendingStart, props.workspace.taskText, next)
    props.setTaskInput(props.workspace.taskText, next, nextPending)
    setState("materialPath", "")
  }

  async function attachUploadedFiles(files: FileList | null) {
    const client = props.owner.client
    const connection = props.owner.connection
    const directory = props.owner.directory
    if (!files?.length || !ready() || busy() || !client || !connection || !directory) return
    const selected = Array.from(files)
    const signal = lifetime.uploadAbort.signal
    setState("error", "")
    for (const file of selected) {
      if (!ready() || signal.aborted) return
      setState("uploading", file.name)
      try {
        const image = file.type.startsWith("image/")
        const path = image
          ? file.name
          : await uploadAttachment(client, { ...connection.http }, { directory }, file, () => {}, signal)
        const dataUrl = image
          ? await new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              const abort = () => reader.abort()
              signal.addEventListener("abort", abort, { once: true })
              reader.onloadend = () => signal.removeEventListener("abort", abort)
              reader.onload = () => resolve(String(reader.result))
              reader.onerror = () => reject(reader.error)
              reader.onabort = () => reject(new DOMException("Upload aborted", "AbortError"))
              reader.readAsDataURL(file)
            })
          : undefined
        if (!ready() || signal.aborted) return
        const next: TaskMaterial[] = [
          ...props.workspace.taskMaterials,
          {
            id: uuid(),
            kind: image ? "image" : "file",
            path,
            name: file.name,
            mime: file.type || "application/octet-stream",
            ...(dataUrl ? { dataUrl } : {}),
          },
        ]
        props.setTaskInput(
          props.workspace.taskText,
          next,
          nextInputIDAfterEdit(props.workspace.pendingStart, props.workspace.taskText, next),
        )
      } catch (error) {
        if (!current() || signal.aborted) return
        setState("error", errorMessage(error, language.t("prompt.toast.uploadFailed.title")))
      } finally {
        if (current()) setState("uploading", "")
      }
    }
  }

  function removeMaterial(id: string) {
    const next = props.workspace.taskMaterials.filter((item) => item.id !== id)
    const nextPending = nextInputIDAfterEdit(props.workspace.pendingStart, props.workspace.taskText, next)
    props.setTaskInput(props.workspace.taskText, next, nextPending)
  }

  async function previewSelection() {
    const client = props.owner.client
    const directory = props.owner.directory
    const selected = props.workspace.selectedUse

    if (!ready() || !client || !directory || busy()) return
    cancelPreview()
    const revision = lifetime.previewRevision
    setState({ progress: { type: "previewing" }, error: "" })

    try {
      let profileInfo = state.selectedProfile

      if (selected.kind === "profile") {
        profileInfo = await client["custom-profile"].content(
          { directory, path: selected.path },
          { signal: lifetime.previewAbort.signal },
        )

        if (!current() || revision !== lifetime.previewRevision) return
        setState("selectedProfile", profileInfo)
      }

      const payload =
        selected.kind === "profile" && profileInfo
          ? {
              source: "profile" as const,
              profilePath: profileInfo.relativePath,
              profileRevision: profileInfo.revision,
            }
          : {
              source: "temporary" as const,
              root: new Composition.BuiltinRoot({
                source: "builtin",
                id: selected.kind === "builtin" ? selected.id : "build",
              }),
              agents: [],
              bindings: {},
              presentation: "native" as const,
              requestedCapabilities: [],
            }

      const plan = await client["custom-composition"].plan(
        { directory, payload },
        { signal: lifetime.previewAbort.signal },
      )

      if (!current() || revision !== lifetime.previewRevision) return
      setState("progress", { type: "preview", plan })
    } catch (error) {
      if (!current() || revision !== lifetime.previewRevision) return
      setState({ progress: { type: "idle" }, error: errorMessage(error, language.t("home.custom.error.preview")) })
    }
  }

  async function openCreated(session: SessionInfo) {
    const context = props.owner.context
    const connection = props.owner.connection

    if (!context || !connection || !current()) return
    setState({ progress: { type: "created", session, opening: true }, error: "" })

    try {
      context.data.session.invalidate(session.id)
      const canonical = await context.data.session.readback(session.id)

      if (!current()) return

      if (!canonical) throw new Error(language.t("home.custom.error.readback"))
      props.setPendingStart(undefined)
      setState("progress", { type: "idle" })
      props.home.project.openProjectSession(connection, canonical.location.directory, canonical)
    } catch (error) {
      if (!current()) return
      const pending = props.workspace.pendingStart
      if (pending) props.setPendingStart({ ...pending, stage: "created_open_failed", createdSessionID: session.id })
      setState({
        progress: { type: "created", session, opening: false },
        error: errorMessage(error, language.t("home.custom.error.readback")),
      })
    }
  }

  async function admitFirstPrompt(session: SessionInfo, confirmation: PendingTaskStart) {
    const context = props.owner.context
    const directory = props.owner.directory
    if (!context || !directory || !current()) return
    setState({ progress: { type: "admitting", session, confirmation }, error: "" })
    const pending = { ...confirmation, stage: "admitting" as const, createdSessionID: session.id }
    props.setPendingStart(pending)
    try {
      await context.data.session.prompt(
        buildFirstPromptPayload({
          sessionID: session.id,
          firstInputID: pending.firstInputID,
          directory,
          text: pending.text,
          materials: pending.materials,
        }),
      )
      if (!current()) return
      props.setTaskInput("", [], { ...pending, stage: "admitted" })
      await openCreated(session)
    } catch (error) {
      if (!current()) return
      props.setPendingStart({ ...pending, stage: "admit_unknown" })
      setState({
        progress: { type: "admit-unknown", session, confirmation: pending },
        error: errorMessage(error, language.t("home.custom.use.admitUnknown")),
      })
    }
  }

  async function startConfirmed() {
    const plan = previewPlan()

    if (state.progress.type !== "preview" || !plan?.valid || !ready()) return
    const pending: PendingTaskStart = {
      ...preparePendingTaskStart(undefined, props.workspace.taskText, props.workspace.taskMaterials),
      composition: Schema.decodeUnknownSync(Composition.CompositionInput)(plan.input),
      expectedPlanDigest: Schema.decodeUnknownSync(Composition.Digest)(plan.digest),
      ...(props.model() ? { model: Schema.decodeUnknownSync(Model.Selection)(props.model()) } : {}),
    }
    props.setPendingStart(pending)
    await executeStart(pending)
  }

  async function executeStart(confirmation: PendingTaskStart) {
    const client = props.owner.client
    const context = props.owner.context
    const directory = props.owner.directory

    if (
      !ready() ||
      !client ||
      !context ||
      !directory ||
      busy() ||
      !confirmation.composition ||
      !confirmation.expectedPlanDigest
    )
      return
    setState({ progress: { type: "confirming", confirmation, pending: true }, error: "" })

    try {
      const payload = {
        sessionID: confirmation.sessionID,
        composition: confirmation.composition,
        expectedPlanDigest: confirmation.expectedPlanDigest,
      }
      const response = await client["custom-composition"].start(
        {
          directory,
          payload: confirmation.model ? { ...payload, model: confirmation.model } : payload,
        },
        { signal: lifetime.previewAbort.signal },
      )

      if (!current()) return
      // Creation ACK recorded: never repeat `start` if prompt admission or open readback fails.
      context.data.session.remember(response.session)
      props.setPendingStart({ ...confirmation, createdSessionID: response.session.id, stage: "admitted" })

      if (confirmation.text.trim().length > 0 || confirmation.materials.length > 0) {
        await admitFirstPrompt(response.session, confirmation)

        return
      }

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
        props.setPendingStart(undefined)
        setState({
          progress: { type: "idle" },
          error: isCompositionResolveError(error)
            ? error.diagnostics?.map((item) => item.message).join("\n") || error.message
            : errorMessage(error, language.t("home.custom.error.rejected")),
        })

        return
      }

      setState({
        progress: { type: "confirming", confirmation, pending: false },
        error: errorMessage(error, language.t("home.custom.error.create")),
      })
    }
  }

  function editSelectedInCompose() {
    const selected = props.workspace.selectedUse

    if (selected.kind === "profile" && state.selectedProfile) {
      props.openCompose(composeDraftFromProfile(state.selectedProfile))

      return
    }

    if (selected.kind === "builtin") {
      props.openCompose(initialComposeDraft(selected.id))

      return
    }

    props.openCompose()
  }

  function discussInChat() {
    const selected = props.workspace.selectedUse
    const target =
      selected.kind === "profile"
        ? (state.selectedProfile?.name ?? selected.path)
        : language.t(`home.custom.root.${selected.id}`)
    const task = props.workspace.taskText.trim() || language.t("home.custom.use.discussionPlaceholder")
    props.openChatDraft(language.t("home.custom.use.chatDraftPrompt", { target, task }))
  }

  const selectedLabel = () => {
    const selected = props.workspace.selectedUse

    if (selected.kind === "builtin") return language.t(`home.custom.root.${selected.id}`)

    return (
      state.selectedProfile?.name ??
      state.profiles.find((item) => item.relativePath === selected.path)?.name ??
      selected.path
    )
  }

  async function recoverPending(openOnly = false) {
    const pending = props.workspace.pendingStart
    const context = props.owner.context
    if (!pending || !ready() || busy() || !context) return
    if (pending.stage === "creating" && pending.composition && !pending.createdSessionID) {
      await executeStart(pending)
      return
    }
    setState({ recovering: true, error: "" })
    try {
      const sessionID = pending.createdSessionID ?? pending.sessionID
      context.data.session.invalidate(sessionID)
      const session = await context.data.session.readback(sessionID)
      if (!current()) return
      if (!session) throw new Error(language.t("home.custom.error.readback"))
      setState("recovering", false)
      if (
        !openOnly &&
        (pending.stage === "admitting" || pending.stage === "admit_unknown" || pending.stage === "creating")
      ) {
        await admitFirstPrompt(session, pending)
        return
      }
      await openCreated(session)
    } catch (error) {
      if (current())
        setState({ error: errorMessage(error, language.t("home.custom.error.readback")), recovering: false })
    }
  }

  return (
    <section role="region" aria-label={language.t("home.custom.use.title")} data-component="custom-use-home">
      <div class="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div class="flex min-w-0 flex-col gap-0.5">
          <h2 class="text-[14px] font-medium leading-[var(--line-height-base)]">
            {language.t("home.custom.use.title")}
          </h2>
          <p class="text-v2-text-text-muted">{language.t("home.custom.use.description")}</p>
        </div>
        <div class="flex flex-wrap gap-1.5">
          <Button type="button" size="small" variant="outline" onClick={props.openAssets}>
            {language.t("home.custom.tabs.assets")}
          </Button>
          <Button
            type="button"
            size="small"
            variant="outline"
            onClick={() => props.openCompose(initialComposeDraft("build"))}
          >
            {language.t("home.custom.use.newInCompose")}
          </Button>
        </div>
      </div>

      <Show when={!props.owner.directory}>
        <p role="status" data-slot="custom-alert" class="text-v2-text-text-muted">
          {language.t("home.custom.project.required")}
        </p>
      </Show>
      <Show when={!connected()}>
        <p role="status" data-slot="custom-alert" class="text-v2-text-text-muted">
          {language.t("home.custom.connection.required")}
        </p>
      </Show>

      <div data-component="custom-use-layout">
        <div data-slot="custom-use-main">
          <section data-component="custom-team-catalog" aria-label={language.t("home.custom.use.catalogTitle")}>
            <div data-slot="custom-catalog-heading">
              <h3>{language.t("home.custom.use.catalogTitle")}</h3>
              <span>
                {language.plural("home.custom.use.catalogCount", state.profiles.length + BUILTIN_ROOTS.length)}
              </span>
            </div>
            <div data-slot="custom-catalog-controls">
              <input
                type="search"
                data-slot="custom-input"
                aria-label={language.t("home.custom.use.search")}
                placeholder={language.t("home.custom.use.search")}
                value={state.search}
                onInput={(event) => setState("search", event.currentTarget.value)}
              />
              <Button
                type="button"
                size="small"
                variant="ghost"
                disabled={!ready() || state.listing}
                onClick={() => void loadProfiles()}
              >
                {language.t(state.listing ? "home.custom.profile.loading" : "home.custom.profile.reload")}
              </Button>
              <div role="group" aria-label={language.t("home.custom.use.search")} data-slot="custom-catalog-filters">
                <For each={["all", "team", "solo", "profiles", "builtin"] as const}>
                  {(kind) => (
                    <Button
                      type="button"
                      size="small"
                      variant={state.filter === kind ? "neutral" : "ghost"}
                      aria-pressed={state.filter === kind}
                      onClick={() => setState("filter", kind)}
                    >
                      {language.t(`home.custom.use.filter.${kind}`)}
                    </Button>
                  )}
                </For>
              </div>
            </div>
            <Show when={state.filter !== "builtin"}>
              <h4 data-slot="custom-catalog-section">{language.t("home.custom.use.profilesTitle")}</h4>
              <Show when={state.listError}>
                <p role="alert" data-slot="custom-alert">
                  {state.listError}
                </p>
              </Show>
              <Show
                when={filteredProfiles().length > 0}
                fallback={
                  <div data-slot="custom-catalog-empty" role="status">
                    <Icon name="branch" size="large" />
                    <p>
                      {language.t(
                        !props.owner.directory
                          ? "home.custom.use.projectEmpty"
                          : !connected()
                            ? "home.custom.connection.required"
                            : state.listing
                              ? "home.custom.profile.loading"
                              : state.listError
                                ? "home.custom.profile.error.list"
                                : state.search || state.filter === "solo" || state.filter === "team"
                                  ? "home.custom.use.noMatches"
                                  : "home.custom.use.profilesEmpty",
                      )}
                    </p>
                    <Button
                      type="button"
                      size="small"
                      variant="outline"
                      onClick={() => props.openCompose(initialComposeDraft("build"))}
                    >
                      {language.t("home.custom.compose.newBuiltin")}
                    </Button>
                  </div>
                }
              >
                <div data-slot="custom-team-grid">
                  <For each={filteredProfiles()}>
                    {(profile) => {
                      const selected = () =>
                        props.workspace.selectedUse.kind === "profile" &&
                        props.workspace.selectedUse.path === profile.relativePath
                      const info = () => cardInfo(profile)
                      return (
                        <article
                          data-component="custom-team-card"
                          data-selected={selected()}
                          ref={(element) => {
                            visibleCards.set(element, profile)
                            observer.observe(element)
                            onCleanup(() => {
                              observer.unobserve(element)
                              visibleCards.delete(element)
                            })
                          }}
                        >
                          <button
                            type="button"
                            data-slot="custom-team-select"
                            aria-pressed={selected()}
                            disabled={busy()}
                            onClick={() => selectTarget({ kind: "profile", path: profile.relativePath })}
                          >
                            <div data-slot="custom-team-heading">
                              <span data-slot="custom-team-icon">
                                <Icon name="branch" />
                              </span>
                              <strong>
                                <bdi>{profile.name}</bdi>
                              </strong>
                            </div>
                            <span
                              data-slot="custom-team-status"
                              data-tone={selected() && state.health ? state.health.status : "neutral"}
                            >
                              {language.t(
                                selected() && state.health
                                  ? `home.custom.use.status.${state.health.status}`
                                  : "home.custom.use.status.unchecked",
                              )}
                            </span>
                            <p data-slot="custom-team-description">
                              {profile.description || language.t("home.custom.use.descriptionEmpty")}
                            </p>
                            <Show
                              when={info()}
                              fallback={
                                <p data-slot="custom-team-capabilities">
                                  {language.t(
                                    state.profileCards[profile.relativePath]?.error
                                      ? "home.custom.use.detailsFailed"
                                      : "home.custom.use.detailsLoading",
                                  )}
                                </p>
                              }
                            >
                              {(value) => (
                                <div data-slot="custom-team-capabilities">
                                  <span>{language.t("home.custom.use.equipment", equipment(value()))}</span>
                                  <span>
                                    {value().profile.workflow?.relativePath ??
                                      language.t("home.custom.compose.workflowNone")}
                                  </span>
                                </div>
                              )}
                            </Show>
                          </button>
                          <div data-slot="custom-team-footer">
                            <span>
                              {selected()
                                ? language.t("home.custom.use.selected")
                                : info()
                                  ? language.t(
                                      info()!.profile.agents.length > 0
                                        ? "home.custom.use.filter.team"
                                        : "home.custom.use.filter.solo",
                                    )
                                  : language.t("home.custom.source.profile")}
                            </span>
                            <Show when={info()}>
                              {(value) => (
                                <span>
                                  {language.plural("home.custom.use.roles", value().profile.agents.length + 1)}
                                </span>
                              )}
                            </Show>
                            <Show
                              when={state.profileCards[profile.relativePath]?.error}
                              fallback={
                                <Button
                                  type="button"
                                  size="small"
                                  variant="ghost"
                                  disabled={busy()}
                                  onClick={() => viewConfiguration({ kind: "profile", path: profile.relativePath })}
                                >
                                  {language.t("home.custom.use.viewConfig")}
                                </Button>
                              }
                            >
                              <Button
                                type="button"
                                size="small"
                                variant="ghost"
                                disabled={!ready()}
                                onClick={() => void loadCardDetail(profile)}
                              >
                                {language.t("home.custom.use.retryDetails")}
                              </Button>
                            </Show>
                          </div>
                        </article>
                      )
                    }}
                  </For>
                </div>
              </Show>
              <Show when={state.invalidProfiles.length > 0}>
                <details data-slot="custom-alert">
                  <summary>
                    {language.t("home.custom.use.invalidProfiles", { count: state.invalidProfiles.length })}
                  </summary>
                  <ul>
                    <For each={state.invalidProfiles}>
                      {(entry) => (
                        <li>
                          <code>{entry.relativePath}</code> · {entry.errorTag}
                        </li>
                      )}
                    </For>
                  </ul>
                </details>
              </Show>
            </Show>
            <Show when={filteredBuiltins().length > 0}>
              <h4 data-slot="custom-catalog-section">{language.t("home.custom.use.builtinTitle")}</h4>
              <div data-slot="custom-team-grid">
                <For each={filteredBuiltins()}>
                  {(id: BuiltinRootID) => {
                    const selected = () =>
                      props.workspace.selectedUse.kind === "builtin" && props.workspace.selectedUse.id === id
                    return (
                      <article data-component="custom-team-card" data-selected={selected()}>
                        <button
                          type="button"
                          data-slot="custom-team-select"
                          aria-pressed={selected()}
                          disabled={busy()}
                          onClick={() => selectTarget({ kind: "builtin", id })}
                        >
                          <div data-slot="custom-team-heading">
                            <span data-slot="custom-team-icon">
                              <Icon name="branch" />
                            </span>
                            <strong>{language.t(`home.custom.root.${id}`)}</strong>
                          </div>
                          <span data-slot="custom-team-status" data-tone="neutral">
                            {language.t("home.custom.use.zeroAssets")}
                          </span>
                          <p data-slot="custom-team-description">{language.t(`home.custom.use.builtin.${id}.desc`)}</p>
                          <div data-slot="custom-team-capabilities">
                            <span>{language.t(`home.custom.use.capability.${id}`)}</span>
                          </div>
                        </button>
                        <div data-slot="custom-team-footer">
                          <span>
                            {language.t(selected() ? "home.custom.use.selected" : "home.custom.source.builtin")}
                          </span>
                          <span>{language.plural("home.custom.use.roles", 1)}</span>
                          <Button
                            type="button"
                            size="small"
                            variant="ghost"
                            disabled={busy()}
                            onClick={() => viewConfiguration({ kind: "builtin", id })}
                          >
                            {language.t("home.custom.use.viewConfig")}
                          </Button>
                        </div>
                      </article>
                    )
                  }}
                </For>
              </div>
            </Show>
          </section>

          {/* Step 2: Task Instructions, Materials, Model & Actions */}
          <div data-component="custom-card">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <label for="custom-use-task-input" class="font-medium">
                {language.t("home.custom.use.taskLabel")} · <bdi>{selectedLabel()}</bdi>
              </label>
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-[12px] text-v2-text-text-muted">{language.t("home.custom.model.label")}</span>
                <Select
                  aria-label={language.t("home.custom.model.label")}
                  options={modelOptions()}
                  value={(option) => option.key}
                  label={(option) => option.label}
                  optionDisabled={(option) => !!option.unavailable}
                  current={modelOptions().find(
                    (option) =>
                      option.key === (props.model() ? selectionKey(fromSelection(props.model()!)) : "default"),
                  )}
                  disabled={!ready() || busy() || props.modelsLoading()}
                  onSelect={(option) => {
                    if (!option) return
                    cancelPreview()
                    props.onSelectModel(option.model)
                  }}
                />
              </div>
            </div>

            <Show when={props.modelError()}>
              <div role="alert" class="flex flex-wrap items-center gap-2 text-[12px]">
                <span>{props.modelError()}</span>
                <Button type="button" size="small" variant="ghost" onClick={props.onRetryModels}>
                  {language.t("home.custom.model.retry")}
                </Button>
              </div>
            </Show>

            <textarea
              id="custom-use-task-input"
              data-slot="custom-textarea"
              aria-label={language.t("home.custom.use.taskLabel")}
              placeholder={language.t("home.custom.use.taskPlaceholder")}
              disabled={busy()}
              value={props.workspace.taskText}
              onInput={(event) => updateTaskText(event.currentTarget.value)}
            />

            {/* Materials & Attachments */}
            <div class="flex min-w-0 flex-col gap-1.5">
              <div class="flex min-w-0 flex-wrap items-center gap-2">
                <input
                  type="text"
                  data-slot="custom-input"
                  class="min-w-[160px] flex-1"
                  aria-label={language.t("home.custom.use.materialsTitle")}
                  placeholder={language.t("home.custom.use.materialPathPlaceholder")}
                  disabled={busy()}
                  value={state.materialPath}
                  onInput={(event) => setState("materialPath", event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return
                    event.preventDefault()
                    addPathMaterial()
                  }}
                />
                <Button
                  type="button"
                  size="small"
                  variant="ghost"
                  disabled={busy() || !state.materialPath.trim()}
                  onClick={addPathMaterial}
                >
                  {language.t("home.custom.use.materialAdd")}
                </Button>
                <label class="inline-flex cursor-pointer items-center gap-1 rounded-[4px] border border-v2-border-border-base px-2 py-1 text-[12px] hover:bg-v2-background-bg-layer-01">
                  <Icon name="paperclip" size="small" />
                  <span>{language.t("home.custom.use.materialUpload")}</span>
                  <input
                    type="file"
                    class="sr-only"
                    multiple
                    disabled={busy()}
                    onChange={(event) => {
                      attachUploadedFiles(event.currentTarget.files)
                      event.currentTarget.value = ""
                    }}
                  />
                </label>
              </div>
              <Show when={props.workspace.taskMaterials.length > 0}>
                <div class="flex flex-wrap gap-1.5">
                  <For each={props.workspace.taskMaterials}>
                    {(item) => (
                      <span data-slot="custom-chip">
                        <Icon name={item.kind === "image" ? "photo" : "file"} size="small" />
                        <bdi class="max-w-[200px] truncate" title={item.path}>
                          {item.name}
                        </bdi>
                        <button
                          type="button"
                          class="text-v2-text-text-muted hover:text-v2-text-text-base"
                          aria-label={language.t("home.custom.use.materialRemove", { name: item.name })}
                          disabled={busy()}
                          onClick={() => removeMaterial(item.id)}
                        >
                          ×
                        </button>
                      </span>
                    )}
                  </For>
                </div>
              </Show>
            </div>

            {/* Preview Plan Output */}
            <Show when={previewPlan()}>
              {(plan) => (
                <div
                  data-slot="custom-alert"
                  class="flex min-w-0 flex-col gap-2"
                  aria-label={language.t("home.custom.preview.title")}
                >
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <h3 class="font-medium">{language.t("home.custom.preview.title")}</h3>
                    <code class="text-[11px] text-v2-text-text-muted">{plan().digest.slice(0, 12)}</code>
                  </div>
                  <dl class="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                    <dt class="text-v2-text-text-muted">{language.t("home.custom.root.label")}</dt>
                    <dd>{plan().orchestrator?.name ?? selectedLabel()}</dd>
                    <dt class="text-v2-text-text-muted">{language.t("home.custom.model.label")}</dt>
                    <dd class="break-words">{modelLabel()}</dd>
                    <dt class="text-v2-text-text-muted">{language.t("home.custom.permissions.title")}</dt>
                    <dd class="text-v2-text-text-muted">{language.t("home.custom.permissions.live")}</dd>
                  </dl>
                  <For each={plan().diagnostics}>
                    {(diagnostic) => (
                      <p
                        role={
                          diagnostic.severity === "blocking" || diagnostic.severity === "error" ? "alert" : "status"
                        }
                      >
                        {diagnostic.message}
                      </p>
                    )}
                  </For>
                </div>
              )}
            </Show>

            <Show when={state.error}>
              <p role="alert" data-slot="custom-alert">
                {state.error}
              </p>
            </Show>

            {/* Primary & Secondary Action Bar */}
            <div data-slot="custom-task-actions" class="flex flex-wrap items-center gap-2">
              <Show
                when={
                  (state.progress.type === "idle" && !props.workspace.pendingStart) ||
                  state.progress.type === "previewing"
                }
              >
                <Button
                  type="button"
                  size="small"
                  variant="contrast"
                  disabled={!ready() || busy() || state.profileLoading}
                  onClick={() => void previewSelection()}
                >
                  {language.t(
                    state.progress.type === "previewing" ? "home.custom.preview.loading" : "home.custom.use.startTask",
                  )}
                </Button>
              </Show>

              <Show when={state.progress.type === "preview"}>
                <Button
                  type="button"
                  size="small"
                  variant="contrast"
                  disabled={!ready() || !previewPlan()?.valid || busy()}
                  onClick={() => void startConfirmed()}
                >
                  {language.t(hasTaskContent() ? "home.custom.use.confirmStart" : "home.custom.use.startEmpty")}
                </Button>
                <Button type="button" size="small" variant="ghost" onClick={cancelPreview}>
                  {language.t("common.cancel")}
                </Button>
              </Show>

              <Show when={state.progress.type === "confirming" ? state.progress : undefined}>
                {(confirming) => (
                  <Show
                    when={confirming().pending}
                    fallback={
                      <Button
                        type="button"
                        size="small"
                        variant="contrast"
                        disabled={!ready()}
                        onClick={() => void recoverPending()}
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

              <Show when={state.progress.type === "admitting"}>
                <span role="status" class="text-v2-text-text-muted">
                  {language.t("home.custom.use.admitting")}
                </span>
              </Show>

              <Show when={state.progress.type === "admit-unknown"}>
                <>
                  <Button
                    type="button"
                    size="small"
                    variant="contrast"
                    disabled={!ready()}
                    onClick={() => void recoverPending()}
                  >
                    {language.t("home.custom.use.retryAdmit")}
                  </Button>
                  <Button
                    type="button"
                    size="small"
                    variant="outline"
                    disabled={!ready()}
                    onClick={() => void recoverPending(true)}
                  >
                    {language.t("home.custom.use.openWithoutRetry")}
                  </Button>
                </>
              </Show>

              <Show when={state.progress.type === "created" ? state.progress : undefined}>
                {(created) => (
                  <Button
                    type="button"
                    size="small"
                    variant="contrast"
                    disabled={!ready() || created().opening}
                    onClick={() => void openCreated(created().session)}
                  >
                    {language.t(created().opening ? "home.custom.opening" : "home.custom.open")}
                  </Button>
                )}
              </Show>

              <Show when={state.progress.type === "idle" && props.workspace.pendingStart}>
                {(pending) => (
                  <Button
                    type="button"
                    size="small"
                    variant="contrast"
                    disabled={!ready() || busy()}
                    onClick={() => void recoverPending()}
                  >
                    {language.t(
                      pending().stage === "creating"
                        ? "home.custom.retryConfirmation"
                        : pending().stage === "admitting" || pending().stage === "admit_unknown"
                          ? "home.custom.use.retryAdmit"
                          : "home.custom.open",
                    )}
                  </Button>
                )}
              </Show>
              <Show when={state.recovering}>
                <span role="status">{language.t("home.custom.use.recovering")}</span>
              </Show>
              <Show when={state.uploading}>
                <span role="status">{language.t("home.custom.use.uploading", { filename: state.uploading })}</span>
              </Show>

              <Button
                type="button"
                size="small"
                variant="ghost"
                disabled={!props.owner.directory}
                onClick={discussInChat}
              >
                {language.t("home.custom.use.discussChat")}
              </Button>

              <Button
                type="button"
                size="small"
                variant="ghost"
                disabled
                title={language.t("home.custom.use.workUnavailableHint")}
              >
                {language.t("home.custom.use.workUnavailable")}
              </Button>
            </div>

            <p class="text-[12px] text-v2-text-text-muted">{language.t("home.custom.use.workUnavailableHint")}</p>
          </div>
        </div>
        <aside
          data-component="custom-composition-sidebar"
          aria-label={language.t("home.custom.use.summaryTitle")}
          tabindex="-1"
          ref={(element) => (lifetime.summaryElement = element)}
        >
          <div data-slot="custom-summary-header">
            <h3>{language.t("home.custom.use.summaryTitle")}</h3>
            <Button
              type="button"
              size="small"
              variant="outline"
              disabled={busy() || (props.workspace.selectedUse.kind === "profile" && !state.selectedProfile)}
              onClick={editSelectedInCompose}
            >
              {language.t("home.custom.use.editInCompose")}
            </Button>
          </div>
          <div data-slot="custom-summary-section">
            <h4>
              <bdi>{selectedLabel()}</bdi>
            </h4>
            <p>
              {props.workspace.selectedUse.kind === "builtin"
                ? language.t(`home.custom.use.builtin.${props.workspace.selectedUse.id}.desc`)
                : state.selectedProfile?.description}
            </p>
            <Show when={state.profileLoading}>
              <p role="status">{language.t("home.custom.profile.reading")}</p>
            </Show>
            <Show when={state.profileError}>
              <p role="alert">{state.profileError}</p>
            </Show>
            <Show when={props.workspace.selectedUse.kind === "profile"}>
              <Button
                type="button"
                size="small"
                variant="outline"
                disabled={!ready() || state.healthLoading}
                onClick={() => void checkHealth()}
              >
                {language.t(state.healthLoading ? "home.custom.use.checkingHealth" : "home.custom.use.checkHealth")}
              </Button>
            </Show>
            <Show when={state.health}>
              {(health) => (
                <div role="status" data-slot="custom-alert">
                  <p>
                    {language.t(
                      health().status === "healthy"
                        ? "home.custom.use.healthOk"
                        : health().status === "degraded"
                          ? "home.custom.use.healthDegraded"
                          : "home.custom.use.healthBroken",
                    )}
                  </p>
                  <For each={health().diagnostics}>{(item) => <p>{item.message}</p>}</For>
                </div>
              )}
            </Show>
            <Show when={state.healthError}>
              <p role="alert">{state.healthError}</p>
            </Show>
          </div>
          <Show
            when={props.workspace.selectedUse.kind === "builtin" || state.selectedProfile}
            fallback={
              <p data-slot="custom-summary-section" role="status">
                {language.t(
                  !props.owner.directory
                    ? "home.custom.project.required"
                    : state.profileError
                      ? "home.custom.use.detailsFailed"
                      : "home.custom.profile.reading",
                )}
              </p>
            }
          >
            <section data-slot="custom-summary-section" aria-label={language.t("home.custom.use.rolesTitle")}>
              <h4>{language.t("home.custom.use.rolesTitle")}</h4>
              <div data-slot="custom-summary-role">
                <Icon name="branch" />
                <div>
                  <strong>{language.t("home.custom.compose.roleOrchestrator")}</strong>
                  <p>
                    {previewPlan()?.orchestrator?.name ??
                      (state.selectedProfile?.profile.root?.source === "builtin"
                        ? language.t(`home.custom.root.${state.selectedProfile.profile.root.id}`)
                        : state.selectedProfile?.profile.root?.id) ??
                      (props.workspace.selectedUse.kind === "builtin"
                        ? selectedLabel()
                        : language.t("home.custom.root.meta"))}
                  </p>
                </div>
              </div>
              <For each={state.selectedProfile?.profile.agents ?? []}>
                {(agent) => (
                  <div data-slot="custom-summary-role">
                    <Icon name="branch" />
                    <div>
                      <bdi>
                        {previewPlan()?.agents?.find((member) => member.relativePath === agent.relativePath)?.name ??
                          agent.relativePath}
                      </bdi>
                      <p>{language.t("home.custom.use.member")}</p>
                    </div>
                  </div>
                )}
              </For>
            </section>
            <section data-slot="custom-summary-section" aria-label={language.t("home.custom.compose.bindingsTitle")}>
              <h4>{language.t("home.custom.compose.bindingsTitle")}</h4>
              <Show
                when={Object.keys(state.selectedProfile?.profile.bindings ?? {}).length > 0}
                fallback={<p>{language.t("home.custom.compose.bindingsEmpty")}</p>}
              >
                <For each={Object.entries(state.selectedProfile?.profile.bindings ?? {})}>
                  {([consumer, binding]) => (
                    <div data-slot="custom-summary-binding">
                      <strong>
                        {consumer === "orchestrator"
                          ? language.t("home.custom.compose.roleOrchestrator")
                          : (previewPlan()?.agents?.find(
                              (member) =>
                                (member.consumerKey ??
                                  Composition.consumerKeyForAgent(member.name, member.relativePath)) === consumer,
                            )?.name ?? consumer)}
                      </strong>
                      <div data-slot="custom-summary-equipment">
                        <For
                          each={[...(binding.prompts ?? []), ...(binding.skills ?? []), ...(binding.commands ?? [])]}
                        >
                          {(ref) => (
                            <span title={ref.relativePath}>
                              <bdi>{ref.relativePath.split(/[\\/]/).at(-1)}</bdi>
                            </span>
                          )}
                        </For>
                      </div>
                    </div>
                  )}
                </For>
              </Show>
            </section>
            <section data-slot="custom-summary-section" aria-label={language.t("home.custom.compose.workflowTitle")}>
              <h4>{language.t("home.custom.compose.workflowTitle")}</h4>
              <p>
                <bdi>
                  {previewPlan()?.workflow?.name ??
                    state.selectedProfile?.profile.workflow?.relativePath ??
                    language.t("home.custom.compose.workflowNone")}
                </bdi>
              </p>
              <Show when={previewPlan()?.workflow?.steps}>
                {(steps) => (
                  <ol data-slot="custom-summary-steps">
                    <For each={steps()}>
                      {(step) => (
                        <li>
                          <bdi>{step.name ?? step.id}</bdi>
                        </li>
                      )}
                    </For>
                  </ol>
                )}
              </Show>
            </section>
            <section data-slot="custom-summary-section" aria-label={language.t("home.custom.compose.mcpTitle")}>
              <h4>{language.t("home.custom.compose.mcpTitle")}</h4>
              <Show
                when={(state.selectedProfile?.profile.mcpBindings?.length ?? 0) > 0}
                fallback={<p>{language.t("home.custom.use.mcpEmpty")}</p>}
              >
                <For each={state.selectedProfile?.profile.mcpBindings ?? []}>
                  {(binding) => (
                    <p>
                      <bdi>{binding.serverName}</bdi>
                    </p>
                  )}
                </For>
              </Show>
              <p>{language.t("home.custom.permissions.live")}</p>
            </section>
          </Show>
          <div data-slot="custom-summary-section">
            <Button
              type="button"
              size="small"
              variant="ghost"
              aria-expanded={state.summaryOpen}
              onClick={() => setState("summaryOpen", !state.summaryOpen)}
            >
              {language.t(state.summaryOpen ? "home.custom.use.summaryCollapse" : "home.custom.use.summaryExpand")}
            </Button>
            <Show when={state.summaryOpen}>
              <dl data-slot="custom-summary-source">
                <dt>{language.t("home.custom.source.label")}</dt>
                <dd>
                  {language.t(
                    props.workspace.selectedUse.kind === "builtin"
                      ? "home.custom.source.builtin"
                      : "home.custom.source.profile",
                  )}
                </dd>
                <Show when={state.selectedProfile}>
                  {(info) => (
                    <>
                      <dt>{language.t("home.custom.profile.path")}</dt>
                      <dd>
                        <bdi>{info().relativePath}</bdi>
                      </dd>
                      <dt>{language.t("home.custom.profile.revision")}</dt>
                      <dd>
                        <code>{info().revision}</code>
                      </dd>
                    </>
                  )}
                </Show>
              </dl>
            </Show>
          </div>
        </aside>
      </div>
    </section>
  )
}
