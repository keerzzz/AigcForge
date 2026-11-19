import type {
  LocationRef,
  ModelSourceConnectionRef,
  ProviderDefinitionInfo,
  ProviderDefinitionSaveInput,
  ProviderDefinitionSaveResult,
  ProviderDefinitionTargetRevision,
  ProviderDiscoveryPreviewInput,
  ProviderDiscoveryRead,
} from "@aigcfroge/client/promise"
import { Button } from "@aigcfroge/ui/button"
import { Checkbox } from "@aigcfroge/ui/checkbox"
import { Collapsible } from "@aigcfroge/ui/collapsible"
import { useDialog } from "@aigcfroge/ui/context/dialog"
import { Icon } from "@aigcfroge/ui/icon"
import { IconButton } from "@aigcfroge/ui/icon-button"
import { Select } from "@aigcfroge/ui/select"
import { Switch } from "@aigcfroge/ui/switch"
import { TextField } from "@aigcfroge/ui/text-field"
import { Match, Predicate } from "effect"
import { batch, createEffect, createMemo, For, on, onCleanup, Show, untrack } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useGlobal } from "@/runtime/server/runtime"
import { useLanguage } from "@/runtime/i18n/language"
import { showToast } from "@/shell/notifications/toast"
import { CustomManagedProviderIcon } from "@/providers/models/provider-group"
import {
  type FormState,
  type ModelOverrides,
  type ModelRow,
  headerRow,
  modelRow,
  providerPackages,
  providerProtocols,
  validateCustomProvider,
} from "./form"

type FormScope = { location?: LocationRef }

type PreviewRequestState = {
  generation: number
  key: string
  controller: AbortController | undefined
}

const statusLabels = {
  saved: "provider.custom.status.saved",
  unchanged: "provider.custom.status.unchanged",
  conflict: "provider.custom.status.conflict",
  failed: "provider.custom.status.failed",
  kept: "provider.custom.status.kept",
  created: "provider.custom.status.created",
  used: "provider.custom.status.used",
  skipped: "provider.custom.status.skipped",
  pending: "provider.custom.status.pending",
  ready: "provider.custom.status.ready",
  unavailable: "provider.custom.status.unavailable",
} as const

export function CustomProviderForm(
  props: {
    autofocus?: boolean
    directory?: string
    defaultLocation?: boolean
    providerID?: string
    modelID?: string
    targetPath?: string
    onSaved?: (providerID: string) => void
  } = {},
) {
  const dialog = useDialog()
  const data = useData()
  const sdk = useServerSDK()
  const global = useGlobal()
  const language = useLanguage()
  const definitions = data.location.provider.definition
  const discovery = data.location.provider.discovery
  const lifetime = { active: true, generation: 0 }

  const preview: PreviewRequestState = {
    generation: 0,
    key: "",
    controller: undefined,
  }

  // A form edits the Location it opened from, including while its parent route changes.
  const scope: FormScope = {
    location: props.defaultLocation || !props.directory ? undefined : { directory: props.directory },
  }

  const [state, setState] = createStore<{
    loading: boolean
    saving: boolean
    initialized: boolean
    targetPath?: string
    source?: ProviderDefinitionInfo
    request?: ProviderDefinitionSaveInput
    result?: ProviderDefinitionSaveResult
    confirmed: boolean
    error?: string
    sourceFingerprint?: string
    discoveryAuth: "active" | "none"
    connection?: ModelSourceConnectionRef
    fetching: boolean
    preview?: ProviderDiscoveryRead
    previewError?: string
    query: string
    selected: string[]
  }>({
    loading: true,
    saving: false,
    initialized: false,
    confirmed: false,
    targetPath: props.targetPath,
    discoveryAuth: "active",
    fetching: false,
    query: "",
    selected: [],
  })

  const [form, setForm] = createStore<FormState>({
    providerID: props.providerID ?? "",
    name: "",
    baseURL: "",
    protocol: "chat",
    credentialAction: "keep",
    credentialID: "",
    credentialLabel: "",
    envNames: "",
    apiKey: "",
    models: [modelRow()],
    headers: [headerRow()],
    discovery: { enabled: true, autoSync: false, listURL: "", listProtocol: "auto" },
    err: {},
  })

  const snapshot = () => definitions.list(scope.location)
  const target = () => snapshot()?.targets.find((item) => item.path === state.targetPath)
  const adoption = () => state.source?.definition.adoption
  const pending = () => adoption() !== undefined && adoption()?.phase !== "ready"
  const locked = () => state.saving || state.request !== undefined || pending()

  const sourceFingerprint = createMemo(() =>
    JSON.stringify({
      providerID: form.providerID.trim(),
      baseURL: form.baseURL.trim(),
      protocol: form.protocol,
      credentialAction: form.credentialAction,
      credentialID: form.credentialID,
      apiKey: form.apiKey.trim(),
      env: form.envNames,
      target: state.targetPath,
      headers: form.headers
        .filter((header) => header.key.trim() || header.value.trim())
        .map((header) => [header.key.trim(), header.value.trim(), header.configKey, header.redacted]),
      enabled: form.discovery?.enabled,
      listURL: form.discovery?.listURL.trim(),
      listProtocol: form.discovery?.listProtocol,
    }),
  )

  const storedSource = () =>
    state.source !== undefined &&
    state.sourceFingerprint === sourceFingerprint() &&
    state.discoveryAuth !== "none" &&
    form.credentialAction === "keep"

  const modelList = () =>
    state.preview ??
    (storedSource() ? discovery.get(form.providerID.trim(), state.connection, scope.location) : undefined)

  const managedModel = (model: ModelRow) =>
    modelList()?.managed.find(
      (item) => item.ref.id === (model.configID ?? model.id.trim()) && item.modelID === model.id.trim(),
    )

  const origin = (value: string | undefined) => (value ? language.t("provider.model.origin." + value) : undefined)

  const candidateAdded = (id: string, refs: ProviderDiscoveryRead["candidates"][number]["managedRefs"]) =>
    form.models.some(
      (model) =>
        model.seedState !== "missing" &&
        (model.id.trim() === id || refs.some((ref) => ref.id === (model.configID ?? model.id.trim()))),
    )

  const candidates = () =>
    modelList()?.candidates.filter((candidate) =>
      `${candidate.id} ${candidate.metadata.name ?? ""}`.toLowerCase().includes(state.query.trim().toLowerCase()),
    ) ?? []

  const connectionOptions = () => [
    { key: "active", label: language.t("provider.discovery.activeConnection"), connection: undefined },
    { key: "none", label: language.t("provider.discovery.noAuthentication"), connection: undefined },
    ...(state.source?.connections ?? []).flatMap<{ key: string; label: string; connection: ModelSourceConnectionRef }>(
      (connection) => {
        if (connection.type === "credential")
          return [
            {
              key: "credential:" + connection.id,
              label: connection.label,
              connection: { type: "credential" as const, id: connection.id },
            },
          ]

        if (connection.type === "env")
          return [
            {
              key: "env:" + connection.name,
              label: connection.name,
              connection: { type: "env" as const, name: connection.name },
            },
          ]

        return []
      },
    ),
  ]

  const connectionKey = () => {
    if (state.connection?.type === "credential") return "credential:" + state.connection.id

    if (state.connection?.type === "env") return "env:" + state.connection.name

    return state.discoveryAuth
  }

  const completed = () => {
    if (state.confirmed) return true
    const result = state.result

    if (!result || (result.definition.status !== "saved" && result.definition.status !== "unchanged")) return false
    const adopted = result.info?.definition.adoption

    return adopted?.phase === "ready" && adopted.submissionID === result.submissionID
  }

  const connections = () =>
    (snapshot()?.definitions.find((item) => item.providerID === form.providerID)?.connections ?? []).filter(
      (connection) => connection.type === "credential",
    )

  const needsKey = () =>
    state.result?.credential.status === "pending" ||
    state.result?.credential.status === "failed" ||
    (pending() &&
      adoption()?.credentialAction === "create" &&
      adoption()?.stage === "credential" &&
      !connections().some((connection) => connection.id === adoption()?.credentialID))

  const current = (api: typeof sdk.api, generation: number) =>
    lifetime.active && sdk.api === api && lifetime.generation === generation

  const targetLabel = (item: ProviderDefinitionTargetRevision) =>
    language.t("provider.custom.scope." + item.scope) + " · " + item.path

  onCleanup(() => {
    lifetime.active = false
    discardPreview()
  })
  createEffect(
    on(
      () => [sdk.api, sourceFingerprint(), connectionKey()],
      () => discardPreview(),
      { defer: true },
    ),
  )
  createEffect(() => {
    const api = sdk.api
    const providerID = form.providerID.trim()
    const connection = state.connection

    if (state.loading || !state.initialized || !storedSource() || sdk.connection.status() !== "connected") return
    untrack(
      () =>
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: Promise rejection values are opaque; the handler guards Error before producing display text.
        void discovery.sync(providerID, connection, scope.location).catch((error: unknown) => {
          if (!lifetime.active || sdk.api !== api) return
          setState("previewError", error instanceof Error ? error.message : String(error))
        }),
    )
  })
  createEffect(() => {
    const api = sdk.api

    if (sdk.connection.status() !== "connected") return
    untrack(() => void load(api))
  })

  function initialize(info: ProviderDefinitionInfo) {
    setState("source", info)

    const modelRows = Object.entries(info.definition.models ?? {}).map(([id, model]) => ({
      ...modelRow(),
      configID: id,
      id: model.modelID ?? id,
      name: model.name ?? "",
      seed: model.seed,
      seedModelID: model.modelID ?? id,
      overrides: {
        family: model.family ?? "",
        tools:
          model.capabilities?.tools === undefined
            ? ("auto" as const)
            : model.capabilities.tools
              ? ("supported" as const)
              : ("unsupported" as const),
        input: model.capabilities?.input?.join(", ") ?? "",
        output: model.capabilities?.output?.join(", ") ?? "",
        context: model.limit?.context?.toString() ?? "",
        inputLimit: model.limit?.input?.toString() ?? "",
        outputLimit: model.limit?.output?.toString() ?? "",
        compatibility: model.compatibility ? JSON.stringify(model.compatibility, null, 2) : "",
        cost:
          model.quote && model.quote.status !== "unknown"
            ? JSON.stringify(model.quote.prices, null, 2)
            : model.cost
              ? JSON.stringify(model.cost, null, 2)
              : "",
        quoteValidFrom:
          model.quote && model.quote.status !== "unknown" && model.quote.validFrom !== undefined
            ? new Date(model.quote.validFrom).toISOString()
            : "",
        quoteValidUntil:
          model.quote && model.quote.status !== "unknown" && model.quote.validUntil !== undefined
            ? new Date(model.quote.validUntil).toISOString()
            : "",
      },
    }))

    const headerRows = [
      ...Object.entries(info.definition.headers ?? {}).map(([key, value]) => ({ ...headerRow(), key, value })),
      ...info.redactedPaths.flatMap((path) => {
        const key = path[1]

        return path.length === 2 && path[0] === "headers" && key !== undefined
          ? [{ ...headerRow(), key, configKey: key, redacted: true }]
          : []
      }),
    ]

    setForm(
      reconcile({
        providerID: info.providerID,
        name: info.definition.name ?? info.providerID,
        baseURL: Predicate.isString(info.definition.settings?.baseURL) ? info.definition.settings.baseURL : "",
        protocol: providerProtocols.find((protocol) => providerPackages[protocol] === info.definition.package),
        credentialAction:
          info.definition.adoption?.phase !== "ready" && info.definition.adoption
            ? info.definition.adoption.credentialAction
            : "keep",
        credentialID: info.definition.adoption?.credentialID ?? "",
        credentialLabel: info.definition.adoption?.credentialLabel ?? "",
        envNames: info.definition.env?.join(", ") ?? "",
        apiKey: "",
        models: modelRows.length ? modelRows : [modelRow()],
        headers: headerRows.length ? headerRows : [headerRow()],
        discovery: {
          enabled: info.definition.discovery?.enabled ?? true,
          autoSync: info.definition.discovery?.autoSync ?? false,
          listURL: info.definition.discovery?.list?.url ?? "",
          listProtocol: info.definition.discovery?.list?.protocol ?? "auto",
        },
        err: {},
      }),
    )
    setState("sourceFingerprint", sourceFingerprint())
  }

  function discardPreview() {
    const key = form.apiKey.trim()

    if (preview.key !== key) {
      preview.key = key
      setForm(
        "models",
        produce((rows) =>
          rows.forEach((model) => {
            if (model.seedState !== "draft" || !model.seed || model.seed.identity.connection !== undefined) return
            model.seed = undefined
            model.seedState = "missing"
          }),
        ),
      )
    }

    preview.generation++
    preview.controller?.abort()
    preview.controller = undefined
    setState({ fetching: false, preview: undefined, previewError: undefined, selected: [] })
  }

  function adoptSeeds(info: ProviderDefinitionInfo) {
    setForm(
      "models",
      produce((rows) =>
        rows.forEach((model) => {
          const id = model.configID ?? model.id.trim()
          const saved = info.definition.models?.[id]

          if (!saved || model.id.trim() !== (saved.modelID ?? id)) return
          model.seed = saved.seed
          model.seedModelID = saved.modelID ?? id
          model.seedState = undefined
        }),
      ),
    )
  }

  async function fetchModels() {
    if (locked() || state.loading || state.fetching) return

    const output = validateCustomProvider({
      intent: "preview",
      form,
      t: language.t,
      existingProviderIDs: new Set(snapshot()?.definitions.map((item) => item.providerID) ?? []),
      editingProviderID: props.providerID,
      definition: state.source?.definition,
      redactedPaths: state.source?.redactedPaths,
    })

    setForm("err", output.err)
    output.headers.forEach((error, index) => setForm("headers", index, "err", error))

    if (!output.result) return
    const api = sdk.api
    discardPreview()
    const generation = preview.generation
    const controller = new AbortController()
    preview.controller = controller
    setState("fetching", true)

    const fresh = () =>
      lifetime.active && api === sdk.api && generation === preview.generation && !controller.signal.aborted

    try {
      if (storedSource()) {
        const providerID = form.providerID.trim()
        const connection = state.connection
        await api.provider.discovery.refresh(
          { providerID, connection, force: true, location: scope.location },
          { signal: controller.signal },
        )

        if (!fresh()) return
        discovery.invalidate(providerID, connection, scope.location)
        await discovery.sync(providerID, connection, scope.location)

        return
      }

      const result = output.result
      const selected = target()

      const credential: ProviderDiscoveryPreviewInput["credential"] = result.key
        ? { type: "key", key: result.key }
        : state.discoveryAuth === "none"
          ? { type: "none" }
          : state.connection
            ? { type: "connection", connection: state.connection }
            : form.credentialAction === "use"
              ? { type: "connection", connection: { type: "credential", id: form.credentialID } }
              : { type: "active" }

      const definition: ProviderDiscoveryPreviewInput["definition"] =
        state.source?.target && selected
          ? {
              type: "stored",
              target: { scope: selected.scope, path: selected.path },
              expectedDigest: selected.digest,
              patch: { set: result.definition, unset: result.unset },
            }
          : { type: "new", definition: result.definition }

      const response = await api.provider.discovery.preview(
        { providerID: result.providerID, definition, credential, location: scope.location },
        { signal: controller.signal },
      )

      if (!fresh()) return
      setState("preview", response.data)
    } catch (error) {
      if (fresh()) setState("previewError", error instanceof Error ? error.message : String(error))
    } finally {
      if (fresh()) {
        setState("fetching", false)
        preview.controller = undefined
      }
    }
  }

  function importModels() {
    const list = modelList()
    const inventory = list?.inventory

    if (!list || !inventory || locked()) return

    const selected = list.candidates.filter(
      (candidate) => state.selected.includes(candidate.id) && !candidateAdded(candidate.id, candidate.managedRefs),
    )

    if (!selected.length) return
    setForm(
      "models",
      produce((rows) => {
        const empty = rows.filter(
          (model) =>
            !model.id.trim() &&
            !model.name.trim() &&
            !Object.values(model.overrides ?? {}).some((value) => value && value !== "auto"),
        )

        empty.forEach((model) => rows.splice(rows.indexOf(model), 1))
        selected.forEach((candidate) => {
          const seed = {
            identity: inventory.identity,
            inventoryDigest: inventory.digest,
            observedAt: inventory.observedAt,
            metadata: candidate.metadata,
          }

          const existing = rows.find((model) => model.seedState === "missing" && model.id.trim() === candidate.id)

          if (existing) {
            existing.seed = seed
            existing.seedModelID = candidate.id
            existing.seedState = "draft"

            return
          }

          rows.push({
            ...modelRow(),
            id: candidate.id,
            configID: candidate.id,
            seedModelID: candidate.id,
            seedState: "draft",
            seed,
          })
        })
      }),
    )
    setState("selected", [])
  }

  const setOverride = <Key extends keyof ModelOverrides>(index: number, key: Key, value: ModelOverrides[Key]) => {
    setForm("models", index, "overrides", (overrides) => ({ ...overrides, [key]: value }))

    if (key === "cost" || key === "quoteValidFrom" || key === "quoteValidUntil")
      setForm("models", index, "overrides", "quoteReset", false)

    if (
      key === "context" ||
      key === "inputLimit" ||
      key === "outputLimit" ||
      key === "compatibility" ||
      key === "cost" ||
      key === "quoteValidFrom" ||
      key === "quoteValidUntil"
    )
      setForm("models", index, "err", key, undefined)
  }

  const restoreAuto = (index: number) =>
    setForm("models", index, (model) => ({
      ...model,
      name: "",
      err: {},
      overrides: {
        family: "",
        tools: "auto",
        input: "",
        output: "",
        context: "",
        inputLimit: "",
        outputLimit: "",
        compatibility: "",
        cost: "",
        quoteValidFrom: "",
        quoteValidUntil: "",
        quoteReset: true,
      } satisfies ModelOverrides,
    }))

  async function showModels(providerID: string, ids: readonly string[], api: typeof sdk.api, generation: number) {
    await global.models.ready.promise

    if (!current(api, generation)) return
    const existing = new Set(global.models.store.user.map((model) => model.providerID + ":" + model.modelID))
    global.models.show(ids.flatMap((id) => (existing.has(providerID + ":" + id) ? [] : [{ providerID, modelID: id }])))
  }

  async function load(api = sdk.api) {
    const generation = ++lifetime.generation
    setState({ loading: true, error: undefined })

    try {
      if (!scope.location) {
        await data.location.syncInfo()

        if (!current(api, generation)) return
        scope.location = data.location.default()
      }

      definitions.invalidate(scope.location)
      await definitions.sync(scope.location)

      if (!current(api, generation)) return
      const list = snapshot()

      if (!list) throw new Error(language.t("provider.custom.error.read"))
      const providerID = state.request?.providerID ?? props.providerID
      const path = state.request?.target.path ?? state.targetPath

      const info = list.definitions.find(
        (item) => item.providerID === providerID && (!path || item.target?.path === path),
      )

      if (!state.initialized) {
        if (props.providerID && info) initialize(info)
        setState(
          "targetPath",
          info?.target?.path ??
            state.targetPath ??
            list.targets.find((item) => item.scope === "global" && item.preferred && item.writable)?.path ??
            list.targets.find((item) => item.scope === "global" && item.writable)?.path,
        )

        if (props.providerID && info) setState("sourceFingerprint", sourceFingerprint())
        setState("initialized", true)
      }

      if (
        state.request &&
        info &&
        info.definition.adoption &&
        info.definition.adoption.submissionID === state.request.submissionID
      ) {
        setState("source", info)
        adoptSeeds(info)

        if (info.definition.adoption.phase !== "ready") {
          const request = state.request
          const saved = info.definition.adoption
          setState("request", {
            ...request,
            credential:
              saved.credentialAction === "create" && request.credential.type === "create"
                ? { ...request.credential, label: saved.credentialLabel, activate: saved.activate }
                : request.credential,
          })
        }

        if (info.definition.adoption.phase === "ready") {
          setState({ request: undefined, confirmed: true })
          await showModels(info.providerID, info.definition.adoption.addedModelIDs, api, generation)
        }
      }
    } catch (error) {
      if (!current(api, generation)) return
      setState("error", error instanceof Error ? error.message : String(error))
    } finally {
      if (current(api, generation)) setState({ loading: false, saving: false })
    }
  }

  function selectTarget(item: ProviderDefinitionTargetRevision | null) {
    if (!item || locked()) return
    setState("targetPath", item.path)

    if (!props.providerID) return

    const info = snapshot()?.definitions.find(
      (entry) => entry.providerID === props.providerID && entry.target?.path === item.path,
    )

    if (info) initialize(info)
  }

  const addModel = () =>
    setForm(
      "models",
      produce((rows) => {
        rows.push(modelRow())
      }),
    )

  const removeModel = (index: number) => {
    if (form.models.length <= 1) return
    setForm(
      "models",
      produce((rows) => {
        rows.splice(index, 1)
      }),
    )
  }

  const addHeader = () =>
    setForm(
      "headers",
      produce((rows) => {
        rows.push(headerRow())
      }),
    )

  const removeHeader = (index: number) => {
    if (form.headers.length <= 1) return
    setForm(
      "headers",
      produce((rows) => {
        rows.splice(index, 1)
      }),
    )
  }

  const setField = (key: "providerID" | "name" | "baseURL" | "apiKey" | "credentialLabel", value: string) => {
    setForm(key, value)

    if (key === "apiKey" || key === "credentialLabel") return
    setForm("err", key, undefined)
  }

  const setModel = (index: number, key: "id" | "name", value: string) =>
    batch(() => {
      setForm("models", index, key, value)
      setForm("models", index, "err", key, undefined)
    })

  const setHeader = (index: number, key: "key" | "value", value: string) =>
    batch(() => {
      setForm("headers", index, key, value)
      setForm("headers", index, "err", key, undefined)
    })

  async function refreshCatalog() {
    const api = sdk.api
    const generation = lifetime.generation
    setState({ loading: true, error: undefined })
    data.location.integration.invalidate(scope.location)
    data.location.provider.invalidate(scope.location)
    data.location.model.invalidate(scope.location)
    definitions.invalidate(scope.location)

    try {
      await Promise.all([
        data.location.integration.sync(scope.location),
        data.location.provider.sync(scope.location),
        data.location.model.sync(scope.location),
        definitions.sync(scope.location),
      ])
    } catch (error) {
      if (current(api, generation)) setState("error", error instanceof Error ? error.message : String(error))
    } finally {
      if (current(api, generation)) setState("loading", false)
    }
  }

  async function save(event: SubmitEvent) {
    event.preventDefault()

    if (state.saving || state.loading || completed()) return
    const selected = target()

    if (!selected?.writable) return

    const output = validateCustomProvider({
      form,
      t: language.t,
      existingProviderIDs: new Set(snapshot()?.definitions.map((item) => item.providerID) ?? []),
      editingProviderID: props.providerID ?? state.request?.providerID,
      definition: state.source?.definition,
      redactedPaths: state.source?.redactedPaths,
    })

    batch(() => {
      setForm("err", output.err)
      output.models.forEach((error, index) => setForm("models", index, "err", error))
      output.headers.forEach((error, index) => setForm("headers", index, "err", error))
    })

    if (!output.result) return
    discardPreview()
    const result = output.result
    const prior = pending() ? adoption() : undefined
    const action = prior?.credentialAction ?? result.credentialAction

    const credential: ProviderDefinitionSaveInput["credential"] = Match.value(action).pipe(
      Match.when("use", () => ({ type: "use" as const, credentialID: prior?.credentialID ?? result.credentialID })),
      Match.when("create", () => ({
        type: "create" as const,
        key: result.key,
        label: (prior?.credentialLabel ?? form.credentialLabel) || undefined,
        activate: prior?.activate ?? true,
      })),
      Match.when("keep", () => ({ type: "keep" as const })),
      Match.exhaustive,
    )

    const request: ProviderDefinitionSaveInput = state.request
      ? {
          ...state.request,
          credential:
            state.request.credential.type === "create" && needsKey()
              ? { ...state.request.credential, key: result.key }
              : state.request.credential,
        }
      : {
          providerID: result.providerID,
          submissionID: prior?.submissionID ?? crypto.randomUUID(),
          target: { scope: selected.scope, path: selected.path },
          expectedDigest: selected.digest,
          patch: prior ? {} : { set: result.definition, unset: result.unset },
          credential,
        }

    const api = sdk.api
    const generation = lifetime.generation
    setState({ saving: true, request, error: undefined, result: undefined })

    try {
      const response = await api.provider.definition.save({ ...request, location: scope.location })

      if (!current(api, generation)) return
      setState("result", response.data)

      if (response.data.info && response.data.definition.status !== "conflict") {
        setState("source", response.data.info)

        if (response.data.definition.status === "saved" || response.data.definition.status === "unchanged")
          adoptSeeds(response.data.info)
      }

      const saved = response.data.info?.definition.adoption

      if (saved?.phase !== "ready" && saved?.credentialAction === "create" && request.credential.type === "create")
        setState("request", {
          ...request,
          credential: { ...request.credential, label: saved.credentialLabel, activate: saved.activate },
        })

      if (response.data.definition.status === "failed" || response.data.definition.status === "conflict") {
        setState("request", undefined)

        if (response.data.definition.status === "conflict" || !response.data.info?.definition.adoption)
          setState("error", response.data.definition.message ?? language.t("provider.custom.status.failed"))

        return
      }

      if (response.data.info?.definition.adoption?.phase !== "ready") return
      setState("request", undefined)
      await showModels(response.data.providerID, response.data.addedModelIDs, api, generation)

      if (!current(api, generation)) return
      await refreshCatalog()

      if (!current(api, generation)) return
      props.onSaved?.(response.data.providerID)

      if (response.data.catalog.status !== "ready" || state.error) return
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("provider.custom.saved.title", { provider: result.name }),
        description: language.t("provider.custom.saved.description"),
      })
    } catch (error) {
      if (!current(api, generation)) return
      setState("error", error instanceof Error ? error.message : String(error))
    } finally {
      if (current(api, generation)) setState("saving", false)
    }
  }

  return (
    <div class="flex flex-col gap-6 px-2.5 pb-3 overflow-y-auto max-h-[60vh]">
      <div class="px-2.5 flex gap-4 items-center">
        <CustomManagedProviderIcon class="size-5 shrink-0" />
        <div class="text-16-medium text-text-strong">{language.t("provider.custom.title")}</div>
      </div>

      <form onSubmit={(event) => void save(event)} class="px-2.5 pb-6 flex flex-col gap-6">
        <p class="text-14-regular text-text-base">{language.t("provider.custom.description.native")}</p>
        <Show when={state.error}>
          <div role="alert" class="flex flex-col gap-2 text-13-regular text-text-base">
            <span>{state.error}</span>
            <Button
              type="button"
              size="small"
              variant="ghost"
              onClick={() => void load()}
              disabled={state.loading || state.saving}
            >
              {language.t(state.request ? "provider.custom.readback" : "common.retry")}
            </Button>
          </div>
        </Show>
        <Show when={state.result}>
          {(result) => (
            <div role="status" class="flex flex-col gap-2 text-13-regular text-text-base">
              <For
                each={[
                  { name: language.t("provider.custom.result.definition"), ...result().definition },
                  { name: language.t("provider.custom.result.credential"), ...result().credential },
                  { name: language.t("provider.custom.result.catalog"), ...result().catalog },
                ]}
              >
                {(step) => (
                  <div>
                    <span>
                      {step.name}: {language.t(statusLabels[step.status])}
                    </span>
                    <Show when={step.message}>
                      <p class="text-text-weak">{step.message}</p>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          )}
        </Show>
        <Show when={pending()}>
          <p role="status" class="text-13-regular text-text-base">
            {language.t("provider.custom.resume")}
          </p>
        </Show>
        <Show when={state.confirmed}>
          <p role="status" class="text-13-regular text-text-base">
            {language.t("provider.custom.readback.saved")}
          </p>
        </Show>

        <div class="flex flex-col gap-2">
          <span class="text-13-medium text-text-base">{language.t("provider.custom.scope.label")}</span>
          <Select
            options={snapshot()?.targets.filter((item) => item.writable) ?? []}
            current={target()}
            value={(item) => item.path}
            label={targetLabel}
            onSelect={selectTarget}
            disabled={locked() || state.loading}
            placeholder={language.t(state.loading ? "common.loading" : "provider.custom.scope.unavailable")}
            aria-label={language.t("provider.custom.scope.label")}
          />
          <Show when={state.source?.inherited.length}>
            <p class="text-12-regular text-text-weak">
              {language.t("provider.custom.inherited", {
                sources:
                  state.source?.inherited
                    .map((source) => source.path ?? language.t(`provider.custom.scope.${source.scope}`))
                    .join(", ") ?? "",
              })}
            </p>
          </Show>
        </div>

        <div class="flex flex-col gap-4">
          <TextField
            autofocus={props.autofocus ?? true}
            label={language.t("provider.custom.field.providerID.label")}
            placeholder={language.t("provider.custom.field.providerID.placeholder")}
            description={language.t("provider.custom.field.providerID.description")}
            value={form.providerID}
            onChange={(v) => setField("providerID", v)}
            validationState={form.err.providerID ? "invalid" : undefined}
            error={form.err.providerID}
            disabled={props.providerID !== undefined || locked() || state.loading}
          />
          <TextField
            label={language.t("provider.custom.field.name.label")}
            placeholder={language.t("provider.custom.field.name.placeholder")}
            value={form.name}
            onChange={(v) => setField("name", v)}
            validationState={form.err.name ? "invalid" : undefined}
            error={form.err.name}
            disabled={locked() || state.loading}
          />
          <div class="flex flex-col gap-2">
            <span class="text-13-medium text-text-base">{language.t("provider.custom.protocol.label")}</span>
            <Select
              options={[...providerProtocols]}
              current={form.protocol}
              label={(protocol) => language.t("provider.custom.protocol." + protocol)}
              onSelect={(protocol) => {
                if (protocol) setForm("protocol", protocol)
              }}
              placeholder={language.t("provider.custom.protocol.existing", {
                package: state.source?.definition.package ?? "",
              })}
              disabled={locked() || state.loading}
              aria-label={language.t("provider.custom.protocol.label")}
            />
          </div>
          <TextField
            label={language.t("provider.custom.field.baseURL.label")}
            placeholder={language.t("provider.custom.field.baseURL.placeholder")}
            value={form.baseURL}
            onChange={(v) => setField("baseURL", v)}
            validationState={form.err.baseURL ? "invalid" : undefined}
            error={form.err.baseURL}
            disabled={locked() || state.loading}
          />
          <div class="flex flex-col gap-2">
            <span class="text-13-medium text-text-base">{language.t("provider.custom.credential.label")}</span>
            <Select
              options={["keep", "use", "create"] as const}
              current={form.credentialAction}
              label={(action) => language.t("provider.custom.credential." + action)}
              onSelect={(action) => {
                if (!action) return
                batch(() => {
                  setForm("credentialAction", action)
                  setForm("apiKey", "")
                  setForm("err", "credentialID", undefined)
                })
              }}
              disabled={locked() || state.loading}
              aria-label={language.t("provider.custom.credential.label")}
            />
          </div>
          <TextField
            label={language.t("provider.custom.env.label")}
            description={language.t("provider.custom.env.description")}
            value={form.envNames}
            onChange={(value) => setForm("envNames", value)}
            disabled={locked() || state.loading}
          />
          <Show when={form.credentialAction === "use"}>
            <div class="flex flex-col gap-2">
              <Select
                options={connections()}
                current={connections().find((item) => item.id === form.credentialID)}
                value={(item) => item.id}
                label={(item) => item.label}
                onSelect={(item) => {
                  if (item) setForm("credentialID", item.id)
                }}
                disabled={locked() || state.loading}
                invalid={Boolean(form.err.credentialID)}
                placeholder={language.t("provider.custom.credential.choose")}
                aria-label={language.t("provider.custom.credential.choose")}
              />
              <Show when={form.err.credentialID}>
                <span class="text-12-regular text-text-error">{form.err.credentialID}</span>
              </Show>
            </div>
          </Show>
          <Show when={form.credentialAction === "create"}>
            <TextField
              label={language.t("provider.custom.field.apiKey.label")}
              placeholder={language.t("provider.custom.field.apiKey.placeholder")}
              description={language.t("provider.custom.field.apiKey.description")}
              value={form.apiKey}
              onChange={(v) => setField("apiKey", v)}
              type="password"
              autocomplete="new-password"
              disabled={state.saving || state.loading || (locked() && !needsKey() && !state.error)}
            />
            <TextField
              label={language.t("provider.custom.credential.accountLabel")}
              value={form.credentialLabel}
              onChange={(value) => setField("credentialLabel", value)}
              disabled={locked() || state.loading}
            />
          </Show>
        </div>

        <section
          class="flex min-w-0 flex-col gap-4 border-t border-border-weak-base pt-4"
          aria-label={language.t("provider.discovery.title")}
        >
          <div class="flex flex-col gap-1">
            <h3 class="text-14-medium text-text-strong">{language.t("provider.discovery.title")}</h3>
            <p class="text-12-regular text-text-weak">{language.t("provider.discovery.description")}</p>
          </div>
          <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
            <Switch
              checked={form.discovery?.enabled ?? true}
              onChange={(value) => setForm("discovery", "enabled", value)}
              disabled={locked() || state.loading}
            >
              {language.t("provider.discovery.source")}
            </Switch>
            <Switch
              checked={form.discovery?.autoSync ?? false}
              onChange={(value) => setForm("discovery", "autoSync", value)}
              disabled={locked() || state.loading}
            >
              {language.t("provider.discovery.autoSync")}
            </Switch>
          </div>
          <Collapsible variant="ghost" forceMount>
            <Collapsible.Trigger>
              <span>{language.t("provider.discovery.options")}</span>
              <Collapsible.Arrow />
            </Collapsible.Trigger>
            <Collapsible.Content class="data-[closed]:hidden">
              <div class="flex min-w-0 flex-col gap-4 pt-2">
                <div class="flex flex-col gap-2">
                  <span class="text-13-medium text-text-base">{language.t("provider.discovery.connection")}</span>
                  <Select
                    options={connectionOptions()}
                    current={connectionOptions().find((item) => item.key === connectionKey())}
                    value={(item) => item.key}
                    label={(item) => item.label}
                    onSelect={(item) => {
                      if (!item) return
                      setState({ connection: item.connection, discoveryAuth: item.key === "none" ? "none" : "active" })
                    }}
                    disabled={locked() || state.loading}
                    aria-label={language.t("provider.discovery.connection")}
                  />
                </div>
                <div class="flex flex-col gap-2">
                  <span class="text-13-medium text-text-base">{language.t("provider.discovery.protocol")}</span>
                  <Select
                    options={["auto", "openai", "anthropic"] as const}
                    current={form.discovery?.listProtocol ?? "auto"}
                    label={(value) => language.t("provider.discovery.protocol." + value)}
                    onSelect={(value) => {
                      if (value) setForm("discovery", "listProtocol", value)
                    }}
                    disabled={locked() || state.loading}
                    aria-label={language.t("provider.discovery.protocol")}
                  />
                </div>
                <TextField
                  label={language.t("provider.discovery.listURL")}
                  value={form.discovery?.listURL ?? ""}
                  onChange={(value) => {
                    setForm("discovery", "listURL", value)
                    setForm("err", "discoveryURL", undefined)
                  }}
                  validationState={form.err.discoveryURL ? "invalid" : undefined}
                  error={form.err.discoveryURL}
                  disabled={locked() || state.loading}
                />
              </div>
            </Collapsible.Content>
          </Collapsible>
          <div class="flex flex-wrap gap-2">
            <Button
              type="button"
              size="small"
              variant="neutral"
              onClick={() => void fetchModels()}
              disabled={locked() || state.loading || state.fetching || form.discovery?.enabled === false}
            >
              {language.t(modelList()?.inventory ? "provider.discovery.refresh" : "provider.discovery.fetch")}
            </Button>
            <Show when={state.fetching}>
              <Button type="button" size="small" variant="ghost" onClick={discardPreview}>
                {language.t("provider.discovery.cancel")}
              </Button>
            </Show>
          </div>
          <p role="status" class="text-12-regular text-text-weak">
            {language.t(
              "provider.discovery.phase." +
                (state.fetching
                  ? "fetching"
                  : form.discovery?.enabled === false
                    ? "disabled"
                    : (modelList()?.status.phase ?? "idle")),
            )}
          </p>
          <Show when={state.previewError}>
            <p role="alert" class="text-13-regular text-text-base">
              {state.previewError}
            </p>
          </Show>
          <Show when={modelList()}>
            {(list) => (
              <>
                <Show when={list().status.error}>
                  {(error) => (
                    <p role="alert" class="text-13-regular text-text-base">
                      {error().message}
                    </p>
                  )}
                </Show>
                <Show
                  when={
                    list().inventory?.complete &&
                    (list().status.phase === "failed" || list().status.phase === "partial")
                  }
                >
                  <p class="text-12-regular text-text-weak">
                    {language.t("provider.discovery.previousSuccess", {
                      time: new Date(list().inventory!.observedAt).toLocaleString(language.intl()),
                    })}
                  </p>
                </Show>
                <Show when={storedSource() && list().inventory && !list().status.cachePersisted}>
                  <p class="text-12-regular text-text-weak">{language.t("provider.discovery.cacheNotSaved")}</p>
                </Show>
                <Show when={list().inventory}>
                  <TextField
                    label={language.t("provider.discovery.search")}
                    type="search"
                    value={state.query}
                    onChange={(value) => setState("query", value)}
                    disabled={locked()}
                  />
                  <div class="flex max-h-52 flex-col gap-3 overflow-y-auto pr-1">
                    <Show
                      when={candidates().length}
                      fallback={
                        <p class="text-12-regular text-text-weak">
                          {language.t(
                            list().candidates.length ? "provider.discovery.noMatches" : "provider.discovery.empty",
                          )}
                        </p>
                      }
                    >
                      <For each={candidates()}>
                        {(candidate) => (
                          <div class="flex min-w-0 items-start justify-between gap-3">
                            <Checkbox
                              checked={state.selected.includes(candidate.id)}
                              disabled={locked() || candidateAdded(candidate.id, candidate.managedRefs)}
                              onChange={(checked) =>
                                setState("selected", (selected) =>
                                  checked ? [...selected, candidate.id] : selected.filter((id) => id !== candidate.id),
                                )
                              }
                            >
                              <span class="flex min-w-0 flex-col gap-1">
                                <span class="text-13-medium text-text-base break-all">
                                  {candidate.metadata.name ?? candidate.id}
                                </span>
                                <span class="text-12-regular text-text-weak break-all">{candidate.id}</span>
                              </span>
                            </Checkbox>
                            <span class="shrink-0 text-12-regular text-text-weak">
                              {language.t(
                                candidateAdded(candidate.id, candidate.managedRefs)
                                  ? "provider.discovery.alreadyAdded"
                                  : "provider.model.quote." + (candidate.metadata.quote?.status ?? "unknown"),
                              )}
                            </span>
                          </div>
                        )}
                      </For>
                    </Show>
                  </div>
                  <Button
                    type="button"
                    size="small"
                    variant="neutral"
                    class="self-start"
                    onClick={importModels}
                    disabled={locked() || !state.selected.length}
                  >
                    {language.t("provider.discovery.import")}
                  </Button>
                </Show>
              </>
            )}
          </Show>
        </section>

        <section
          class="flex min-w-0 flex-col gap-4 border-t border-border-weak-base pt-4"
          aria-label={language.t("provider.custom.models.label")}
        >
          <h3 class="text-14-medium text-text-strong">{language.t("provider.custom.models.label")}</h3>
          <For each={form.models}>
            {(m, i) => (
              <div class="flex min-w-0 flex-col gap-3" data-row={m.row}>
                <div class="flex flex-wrap items-start gap-3">
                  <div class="min-w-0 flex-1">
                    <TextField
                      label={language.t("provider.custom.models.id.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.models.id.placeholder")}
                      value={m.id}
                      onChange={(v) => setModel(i(), "id", v)}
                      validationState={m.err.id ? "invalid" : undefined}
                      error={m.err.id}
                      disabled={locked() || state.loading}
                    />
                  </div>
                  <div class="min-w-0 flex-1">
                    <TextField
                      label={language.t("provider.custom.models.name.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.models.name.placeholder")}
                      value={m.name}
                      description={origin(managedModel(m)?.origins.name)}
                      onChange={(v) => setModel(i(), "name", v)}
                      validationState={m.err.name ? "invalid" : undefined}
                      error={m.err.name}
                      disabled={locked() || state.loading}
                    />
                  </div>
                  <IconButton
                    type="button"
                    icon={<Icon name="trash" />}
                    variant="ghost"
                    class="mt-1.5"
                    onClick={() => removeModel(i())}
                    disabled={form.models.length <= 1 || locked() || state.loading}
                    aria-label={language.t("provider.custom.models.remove")}
                  />
                </div>
                <Show when={m.seed || managedModel(m)}>
                  <p class="text-12-regular text-text-weak">
                    {language.t(m.seed ? "provider.discovery.imported" : "provider.discovery.manual")}
                    <Show when={managedModel(m)}>
                      {(item) => <span> · {language.t("provider.discovery.membership." + item().membership)}</span>}
                    </Show>
                  </p>
                </Show>
                <Collapsible variant="ghost" forceMount defaultOpen={props.modelID === (m.configID ?? m.id)}>
                  <Collapsible.Trigger>
                    <span>{language.t("provider.model.overrides")}</span>
                    <Collapsible.Arrow />
                  </Collapsible.Trigger>
                  <Collapsible.Content class="data-[closed]:hidden">
                    <div class="flex min-w-0 flex-col gap-4 pt-2">
                      <Button
                        type="button"
                        size="small"
                        variant="ghost"
                        class="self-start"
                        onClick={() => restoreAuto(i())}
                        disabled={locked() || state.loading}
                      >
                        {language.t("provider.model.restoreAuto")}
                      </Button>
                      <TextField
                        label={language.t("provider.model.override.family")}
                        value={m.overrides?.family ?? ""}
                        placeholder={language.t("provider.model.override.auto")}
                        description={origin(managedModel(m)?.origins.family)}
                        onChange={(value) => setOverride(i(), "family", value)}
                        disabled={locked() || state.loading}
                      />
                      <div class="flex flex-col gap-2">
                        <span class="text-13-medium text-text-base">{language.t("provider.model.override.tools")}</span>
                        <Select
                          options={["auto", "supported", "unsupported"] as const}
                          current={m.overrides?.tools ?? "auto"}
                          label={(value) => language.t("provider.model.override." + value)}
                          onSelect={(value) => {
                            if (value) setOverride(i(), "tools", value)
                          }}
                          disabled={locked() || state.loading}
                          aria-label={language.t("provider.model.override.tools")}
                        />
                        <Show when={managedModel(m)?.origins.capabilities?.tools}>
                          {(value) => <p class="text-12-regular text-text-weak">{origin(value())}</p>}
                        </Show>
                      </div>
                      <For each={["input", "output"] as const}>
                        {(field) => (
                          <div class="flex flex-col gap-1">
                            <TextField
                              label={language.t("provider.model.override." + field)}
                              value={m.overrides?.[field] ?? ""}
                              placeholder={language.t("provider.model.override.auto")}
                              description={language.t("provider.model.override.modalities")}
                              onChange={(value) => setOverride(i(), field, value)}
                              disabled={locked() || state.loading}
                            />
                            <Show when={managedModel(m)?.origins.capabilities?.[field]}>
                              {(value) => <p class="text-12-regular text-text-weak">{origin(value())}</p>}
                            </Show>
                          </div>
                        )}
                      </For>
                      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <For
                          each={
                            [
                              { field: "context", key: "context" },
                              { field: "inputLimit", key: "input" },
                              { field: "outputLimit", key: "output" },
                            ] as const
                          }
                        >
                          {({ field, key }) => (
                            <TextField
                              label={language.t("provider.model.override." + field)}
                              value={m.overrides?.[field] ?? ""}
                              inputmode="numeric"
                              placeholder={language.t("provider.model.override.auto")}
                              description={origin(managedModel(m)?.origins.limit?.[key])}
                              onChange={(value) => setOverride(i(), field, value)}
                              validationState={m.err[field] ? "invalid" : undefined}
                              error={m.err[field]}
                              disabled={locked() || state.loading}
                            />
                          )}
                        </For>
                      </div>
                      <Collapsible variant="ghost" forceMount>
                        <Collapsible.Trigger>
                          <span>{language.t("provider.model.override.advanced")}</span>
                          <Collapsible.Arrow />
                        </Collapsible.Trigger>
                        <Collapsible.Content class="data-[closed]:hidden">
                          <div class="flex min-w-0 flex-col gap-4 pt-2">
                            <TextField
                              label={language.t("provider.model.override.compatibility")}
                              multiline
                              value={m.overrides?.compatibility ?? ""}
                              placeholder={language.t("provider.model.override.auto")}
                              onChange={(value) => setOverride(i(), "compatibility", value)}
                              validationState={m.err.compatibility ? "invalid" : undefined}
                              error={m.err.compatibility}
                              disabled={locked() || state.loading}
                            />
                            <TextField
                              label={language.t("provider.model.override.cost")}
                              multiline
                              value={m.overrides?.cost ?? ""}
                              placeholder={language.t("provider.model.override.auto")}
                              description={origin(managedModel(m)?.origins.quote)}
                              onChange={(value) => setOverride(i(), "cost", value)}
                              validationState={m.err.cost ? "invalid" : undefined}
                              error={m.err.cost}
                              disabled={locked() || state.loading}
                            />
                            <TextField
                              label={language.t("provider.model.override.quoteValidFrom")}
                              value={m.overrides?.quoteValidFrom ?? ""}
                              description={language.t("provider.model.override.quoteDate")}
                              onChange={(value) => setOverride(i(), "quoteValidFrom", value)}
                              validationState={m.err.quoteValidFrom ? "invalid" : undefined}
                              error={m.err.quoteValidFrom}
                              disabled={locked() || state.loading}
                            />
                            <TextField
                              label={language.t("provider.model.override.quoteValidUntil")}
                              value={m.overrides?.quoteValidUntil ?? ""}
                              description={language.t("provider.model.override.quoteDate")}
                              onChange={(value) => setOverride(i(), "quoteValidUntil", value)}
                              validationState={m.err.quoteValidUntil ? "invalid" : undefined}
                              error={m.err.quoteValidUntil}
                              disabled={locked() || state.loading}
                            />
                          </div>
                        </Collapsible.Content>
                      </Collapsible>
                    </div>
                  </Collapsible.Content>
                </Collapsible>
              </div>
            )}
          </For>
          <Button
            type="button"
            size="small"
            variant="ghost"
            icon="plus-small"
            onClick={addModel}
            class="self-start"
            disabled={locked() || state.loading}
          >
            {language.t("provider.custom.models.add")}
          </Button>
        </section>

        <section
          class="flex min-w-0 flex-col gap-4 border-t border-border-weak-base pt-4"
          aria-label={language.t("provider.custom.headers.label")}
        >
          <h3 class="text-14-medium text-text-strong">{language.t("provider.custom.headers.label")}</h3>
          <For each={form.headers}>
            {(h, i) => (
              <div class="flex gap-2 items-start" data-row={h.row}>
                <div class="flex-1">
                  <TextField
                    label={language.t("provider.custom.headers.key.label")}
                    hideLabel
                    placeholder={language.t("provider.custom.headers.key.placeholder")}
                    value={h.key}
                    onChange={(v) => setHeader(i(), "key", v)}
                    validationState={h.err.key ? "invalid" : undefined}
                    error={h.err.key}
                    disabled={locked() || state.loading}
                  />
                </div>
                <div class="flex-1">
                  <TextField
                    label={language.t("provider.custom.headers.value.label")}
                    hideLabel
                    placeholder={language.t(
                      h.redacted ? "provider.custom.headers.redacted" : "provider.custom.headers.value.placeholder",
                    )}
                    value={h.value}
                    onChange={(v) => setHeader(i(), "value", v)}
                    validationState={h.err.value ? "invalid" : undefined}
                    error={h.err.value}
                    type={h.redacted ? "password" : "text"}
                    disabled={locked() || state.loading}
                  />
                </div>
                <IconButton
                  type="button"
                  icon={<Icon name="trash" />}
                  variant="ghost"
                  class="mt-1.5"
                  onClick={() => removeHeader(i())}
                  disabled={form.headers.length <= 1 || locked() || state.loading}
                  aria-label={language.t("provider.custom.headers.remove")}
                />
              </div>
            )}
          </For>
          <Button
            type="button"
            size="small"
            variant="ghost"
            icon="plus-small"
            onClick={addHeader}
            class="self-start"
            disabled={locked() || state.loading}
          >
            {language.t("provider.custom.headers.add")}
          </Button>
        </section>

        <div class="flex flex-wrap gap-2 border-t border-border-weak-base pt-4">
          <Show when={!completed()}>
            <Button
              class="w-auto self-start"
              type="submit"
              size="large"
              variant="contrast"
              disabled={state.saving || state.loading || !target()?.writable}
            >
              {language.t(
                state.saving
                  ? "common.saving"
                  : pending() || state.request
                    ? "provider.custom.continue"
                    : "common.save",
              )}
            </Button>
          </Show>
          <Show when={completed()}>
            <Button type="button" variant="neutral" onClick={() => void refreshCatalog()} disabled={state.loading}>
              {language.t("provider.connect.console.refresh")}
            </Button>
          </Show>
          <Button type="button" variant="ghost" onClick={() => dialog.close()}>
            {language.t("provider.custom.done")}
          </Button>
        </div>
      </form>
    </div>
  )
}
