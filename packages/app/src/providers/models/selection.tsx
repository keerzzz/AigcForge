import type { SessionExecutorPreference, SessionInfo } from "@aigcfroge/client/promise"
import { createSimpleContext } from "@aigcfroge/ui/context"
import { base64Encode } from "@aigcfroge/util/encode"
import { useSessionParams } from "@/session/content-context"
import { batch, createEffect, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { Schema, SchemaGetter } from "effect"
import { useModels } from "@/providers/models/models"
import { useSettings } from "@/settings/model"
import { useProviders } from "@/providers/catalog/providers"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import { hasCustomAgent, resolveAgent, sameExecutorPreference } from "./agent"
import { cycleModelVariant, getConfiguredAgentVariant, resolveModelVariant } from "./variant"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useData } from "@/runtime/server/current"
import { normalizeAgentList } from "@/runtime/server/global-sync/utils"
import { useServerSDK } from "@/runtime/server/client"
import { ScopedKey, type ServerScope } from "@/runtime/server/scope"
import { useConfiguredModel } from "./configured"
import type { ServerApi } from "@/runtime/server/api"
import type { Agent } from "@/runtime/server/types"
import { useLanguage } from "@/runtime/i18n/language"
import { errorMessage } from "@/shell/layout/helpers"
import { ModelKey, fromSelection, isGroup, sameKey, toSelection } from "./key"

type CompositionSnapshot = Awaited<
  ReturnType<ServerApi["session-instance"]["session"]["instance"]["session"]["composition"]>
>

export type { ModelKey } from "./key"

const ChoiceSchema = Schema.Struct({
  model: Persistence.optional(ModelKey),
  modelLabel: Persistence.optional(
    Schema.Struct({ name: Schema.String, providerName: Schema.optional(Schema.String) }),
  ),
  variant: Persistence.optional(Schema.NullOr(Schema.String)),
})

const StateSchema = Schema.Struct({
  ...ChoiceSchema.fields,
  agent: Persistence.optional(Schema.String),
  choices: Persistence.optional(Schema.Record(Schema.String, ChoiceSchema)),
  executorPreference: Persistence.optional(
    Schema.Struct({
      agent: Schema.String,
      model: Schema.optional(
        Schema.Union([
          Schema.Struct({ id: Schema.String, providerID: Schema.String, variant: Schema.optional(Schema.String) }),
          Schema.Struct({ type: Schema.Literal("group"), groupID: Schema.String }),
        ]),
      ),
    }),
  ),
})

type State = typeof StateSchema.Type

const SessionsSchema = Schema.Record(
  Schema.String,
  Schema.mutableKey(Persistence.fallback(Schema.UndefinedOr(StateSchema), () => undefined)),
)

const Current = Persistence.struct({ session: SessionsSchema })

export const ModelSelectionSchema = Persistence.migrate(
  Current,
  Persistence.legacy({
    session: Persistence.optional(Schema.Record(Schema.String, Schema.Unknown)),
    pick: Persistence.optional(Schema.Record(Schema.String, Schema.Unknown)),
  }).pipe(
    Schema.decode({
      decode: SchemaGetter.transform((value) => ({
        session:
          value.session ??
          Object.fromEntries(Object.entries(value.pick ?? {}).filter(([key]) => key !== WORKSPACE_KEY)),
      })),
      encode: SchemaGetter.transform((value) => value),
    }),
  ),
)

const WORKSPACE_KEY = "__workspace__"

const handoff = new Map<string, State>()

const handoffKey = (scope: ServerScope, dir: string, id: string) => ScopedKey.from(scope, dir, id)

const clone = (value: State | undefined) => {
  if (!value) return

  return {
    ...value,
    model: value.model ? { ...value.model } : undefined,
    executorPreference: value.executorPreference
      ? {
          ...value.executorPreference,
          model: value.executorPreference.model ? { ...value.executorPreference.model } : undefined,
        }
      : undefined,
    choices: value.choices
      ? Object.fromEntries(
          Object.entries(value.choices).map(([name, choice]) => [
            name,
            { ...choice, model: choice.model ? { ...choice.model } : undefined },
          ]),
        )
      : undefined,
  } satisfies State
}

export const { use: useLocal, provider: LocalProvider } = createSimpleContext({
  name: "Local",
  init: () => {
    const params = useSessionParams()
    const sdk = useWorkspaceLocation()
    const data = useData()
    const serverSDK = useServerSDK()
    const providers = useProviders(() => sdk().directory)
    const models = useModels()
    const settings = useSettings()
    const configuredModel = useConfiguredModel()
    const language = useLanguage()
    let disposed = false
    onCleanup(() => {
      disposed = true
    })

    const id = createMemo(() => params.id || undefined)
    const durable = () => (id() ? data.session.get(id()!) : undefined)
    const mode = () => durable()?.mode ?? "coding"
    const metaSelected = () => !locked() && agent.current()?.name === "meta"
    const locked = () => durable()?.controller?.kind === "child"

    const frozen = () => {
      const session = durable()

      return (
        session?.mode === "custom" ||
        (session?.controller?.kind === "child" && session.controller.source.kind === "workflow")
      )
    }

    const [adopted, setAdopted] = createStore<{
      requested: boolean
      refresh: number
      loading: boolean
      error: string
      snapshot: CompositionSnapshot | undefined
    }>({ requested: false, refresh: 0, loading: false, error: "", snapshot: undefined })

    const compositionSource = createMemo(
      () => {
        const session = durable()

        if (!session || (!frozen() && !adopted.requested)) return

        return {
          sessionID: session.id,
          directory: session.location.directory,
          api: serverSDK.api,
          status: serverSDK.connection.status(),
          attempt: serverSDK.connection.attempt(),
          refresh: adopted.refresh,
        }
      },
      undefined,
      {
        equals: (previous, next) =>
          previous?.sessionID === next?.sessionID &&
          previous?.directory === next?.directory &&
          previous?.api === next?.api &&
          previous?.status === next?.status &&
          previous?.attempt === next?.attempt &&
          previous?.refresh === next?.refresh,
      },
    )

    createEffect(() => {
      const source = compositionSource()
      setAdopted({ snapshot: undefined, loading: false, error: "" })

      if (!source || source.status !== "connected") return
      const request = new AbortController()
      onCleanup(() => request.abort())
      setAdopted("loading", true)
      void source.api["session-instance"].session.instance.session
        .composition({ sessionID: source.sessionID, directory: source.directory }, { signal: request.signal })
        .then(
          (snapshot) => {
            if (!request.signal.aborted) setAdopted({ snapshot, loading: false })
          },
          (error) => {
            if (!request.signal.aborted)
              setAdopted({ loading: false, error: errorMessage(error, language.t("session.composition.error")) })
          },
        )
    })

    const composition = {
      snapshot: () => adopted.snapshot,
      loading: () => adopted.loading,
      error: () => adopted.error,
      load() {
        if (adopted.loading) return
        setAdopted({ requested: true, refresh: adopted.refresh + 1 })
      },
    }

    const locationAgents = createMemo(() =>
      normalizeAgentList(data.location.agent.list({ directory: sdk().directory }) ?? []),
    )

    const allAgents = createMemo<Agent[]>(() => {
      if (!frozen())
        return locationAgents().filter(
          (item) =>
            !item.hidden && (locked() || item.ordinaryModes === undefined || item.ordinaryModes.includes(mode())),
        )
      const snapshot = adopted.snapshot

      const captured =
        snapshot?.version === 2
          ? normalizeAgentList([
              ...(snapshot.data.orchestrator ? [snapshot.data.orchestrator] : []),
              ...(snapshot.data.executors ?? []).map((executor) => executor.info),
            ])
          : []

      const session = durable()

      if (!session?.agent || captured.some((agent) => agent.name === session.agent)) return captured

      return session?.agent
        ? ([
            ...captured,
            {
              name: session.agent,
              mode: locked() ? "subagent" : "primary",
              permission: [],
              options: {},
              model: session.model ? fromSelection(session.model) : undefined,
              variant: session.model && !("type" in session.model) ? session.model.variant : undefined,
            },
          ] satisfies Agent[])
        : []
    })

    const list = createMemo(() =>
      allAgents().filter((item) => (locked() || frozen() ? item.name === durable()?.agent : item.mode !== "subagent")),
    )

    const executorList = createMemo(() =>
      frozen()
        ? normalizeAgentList(
            adopted.snapshot?.version === 2
              ? (adopted.snapshot.data.executors ?? []).map((executor) => executor.info)
              : [],
          ).filter((item) => !item.hidden && item.mode !== "primary")
        : allAgents().filter((item) => item.mode !== "primary"),
    )

    const connected = createMemo(() => new Set(providers.connected().map((item) => item.id)))
    const groupRead = () => data.location.model.group.definition.list({ directory: sdk().directory })
    const groups = () => groupRead()?.effective ?? []

    createEffect(() => {
      const directory = sdk().directory

      if (serverSDK.connection.status() !== "connected") return
      void data.location.model.group.definition.sync({ directory }).catch(() => undefined)
    })

    const [saved, setSaved, , savedReady] = persisted(
      Persist.serverWorkspace(serverSDK.scope, sdk().directory, "model-selection"),
      ModelSelectionSchema,
      { session: {} },
    )

    const [store, setStore] = createStore<{
      current?: string
      draftID?: string
      draft?: State
      promoting?: State
    }>({
      current: list()[0]?.name,
      draft: undefined,
    })

    const validModel = (model: ModelKey) => {
      if (isGroup(model)) return groups().some((group) => group.groupID === model.groupID && !group.unavailable)
      const provider = providers.all().get(model.providerID)

      return !!provider?.models[model.modelID] && connected().has(model.providerID)
    }

    const firstModel = (...items: Array<() => ModelKey | undefined>) => {
      for (const item of items) {
        const model = item()

        if (!model) continue

        if (isGroup(model) || validModel(model)) return model
      }
    }

    const pickAgent = (name: string | undefined) => {
      return resolveAgent(list(), name)
    }

    createEffect(() => {
      const items = list()

      if (items.length === 0) {
        if (store.current !== undefined) setStore("current", undefined)

        return
      }

      if (items.some((item) => item.name === store.current)) return
      setStore("current", items[0]?.name)
    })

    const scope = createMemo<State | undefined>(() => {
      const session = id()

      if (!session) return store.draftID ? saved.session[`draft:${store.draftID}`] : store.draft

      return saved.session[session] ?? handoff.get(handoffKey(serverSDK.scope, sdk().directory, session))
    })

    createEffect(() => {
      const session = id()

      if (!session || !savedReady()) return

      const key = handoffKey(serverSDK.scope, sdk().directory, session)
      const next = handoff.get(key)

      if (!next) return

      if (saved.session[session] !== undefined) {
        handoff.delete(key)
        setStore("promoting", undefined)

        return
      }

      setSaved("session", session, clone(next))
      handoff.delete(key)
      setStore("promoting", undefined)
    })

    const recentModel = () => {
      for (const item of models.recent.list()) {
        if (validModel(item)) return item
      }
    }

    const defaultModel = () => {
      for (const provider of providers.connected()) {
        const first = Object.values(provider.models)[0]

        if (!first) continue
        const model = { providerID: provider.id, modelID: first.id }

        if (validModel(model)) return model
      }
    }

    const fallback = createMemo(() => firstModel(configuredModel, recentModel, defaultModel))

    const preference = () => scope()?.executorPreference ?? durable()?.executorPreference

    const executorAgent = () => {
      const name = preference()?.agent

      return name ? executorList().find((item) => item.name === name) : resolveAgent(executorList(), "build")
    }

    const executorPreference = () => {
      if (!metaSelected()) return

      return preference()
    }

    const selectionChoices = () => {
      const state = scope()
      const choices = { ...state?.choices }

      if (
        state?.agent !== "meta" ||
        !state.executorPreference ||
        Object.keys(choices).some((key) => key.startsWith("executor:"))
      )
        return choices

      // Legacy Meta choices belonged to executors before the Agent domains were separated.
      return Object.fromEntries(Object.entries(choices).map(([name, choice]) => [`executor:${name}`, choice]))
    }

    const agent = {
      ready: () =>
        frozen()
          ? !!durable()?.agent || adopted.snapshot !== undefined
          : data.location.agent.list({ directory: sdk().directory }) !== undefined,
      available: allAgents,
      list,
      visible: () => !locked() || settings.visibility.customAgents() || hasCustomAgent(list()),
      current() {
        if (locked()) return list().find((item) => item.name === durable()?.agent)

        const selected = scope()?.agent ?? durable()?.agent ?? store.current

        const unavailable =
          !frozen() && selected === durable()?.agent
            ? locationAgents().find((item) => item.name === selected && item.ordinaryModes?.includes(mode()) === false)
            : undefined

        return unavailable ?? pickAgent(selected)
      },
      set(name: string | undefined) {
        if (locked()) return
        const item = pickAgent(name)

        if (!item) {
          setStore("current", undefined)

          return
        }

        batch(() => {
          const previous = snapshot()

          if (previous.agent === item.name) return
          const choices = selectionChoices()

          if (previous.agent)
            choices[previous.agent] = {
              model: previous.model,
              modelLabel: previous.modelLabel,
              variant: previous.variant,
            }

          if (item.name === "meta") {
            const selected = executorAgent()

            if (selected) choices[`executor:${selected.name}`] ??= {}
          }

          setStore("current", item.name)

          const next = {
            agent: item.name,
            model: choices[item.name]?.model,
            modelLabel: choices[item.name]?.modelLabel,
            variant: choices[item.name]?.variant,
            choices,
          } satisfies State

          write(next)
          // Pin both choices while the agent and model acknowledgments arrive separately.
          const selected = key()

          if (selected) model.set(selected)
        })
      },
      move(direction: 1 | -1) {
        const items = list()

        if (items.length === 0) {
          setStore("current", undefined)

          return
        }

        let next = items.findIndex((item) => item.name === agent.current()?.name) + direction

        if (next < 0) next = items.length - 1

        if (next >= items.length) next = 0
        const item = items[next]

        if (!item) return
        agent.set(item.name)
      },
    }

    const explicitModel = () => {
      if (locked()) {
        const value = durable()?.model

        return value ? fromSelection(value) : undefined
      }

      const local = scope()?.model

      if (local) return local
      const session = durable()
      const current = agent.current()

      if (session?.agent && current && session.agent !== current.name) return undefined
      const value = session?.model

      return value ? fromSelection(value) : undefined
    }

    const key = createMemo(() => {
      if (!configuredModel.ready()) return
      const explicit = explicitModel()

      return explicit ?? firstModel(() => agent.current()?.model, fallback)
    })

    const current = createMemo(() => {
      const selected = key()

      return selected && validModel(selected) ? models.find(selected) : undefined
    })

    const displayIdentity = (selected: ModelKey, label?: State["modelLabel"]) => {
      if (isGroup(selected)) {
        const group = groups().find((group) => group.groupID === selected.groupID)
        const unavailable = group ? group.unavailable : groupRead() ? "missing" : undefined

        return {
          type: "group" as const,
          groupID: selected.groupID,
          name: group?.definition?.name ?? label?.name ?? selected.groupID,
          unavailable: unavailable ? language.t(`model.group.unavailable.${unavailable}`) : undefined,
        }
      }

      const item = validModel(selected) ? models.find(selected) : undefined

      if (item) return { id: item.id, name: item.name, provider: item.provider }

      const authored = data.location.provider.definition
        ?.list({ directory: sdk().directory })
        ?.definitions.filter((item) => item.providerID === selected.providerID)
        .at(-1)

      return {
        id: selected.modelID,
        name: label?.name ?? authored?.definition.models?.[selected.modelID]?.name ?? selected.modelID,
        provider: {
          id: selected.providerID,
          name: label?.providerName ?? authored?.definition.name ?? selected.providerID,
        },
        unavailable: authored?.definition.disabled
          ? language.t("model.selection.disabled")
          : language.t("model.selection.unavailable"),
      }
    }

    const identity = () => {
      const selected = key()

      return selected ? displayIdentity(selected, scope()?.modelLabel) : undefined
    }

    const modelLabel = (selected: ModelKey, label?: State["modelLabel"]) => {
      const identity = displayIdentity(selected, label)

      return { name: identity.name, providerName: identity.type === "group" ? undefined : identity.provider.name }
    }

    const configured = () => {
      const item = agent.current()
      const model = current()

      if (!item || !model || (item.model && isGroup(item.model))) return
      const global = configuredModel()

      return (
        getConfiguredAgentVariant({
          agent: { model: item.model, variant: item.variant },
          model: { providerID: model.provider.id, modelID: model.id, variants: model.variants },
        }) ??
        getConfiguredAgentVariant({
          agent: {
            model: global && !isGroup(global) ? global : undefined,
            variant: global && !isGroup(global) ? global.variant : undefined,
          },
          model: { providerID: model.provider.id, modelID: model.id, variants: model.variants },
        })
      )
    }

    const selected = () => {
      const draft = scope()

      if (draft?.model) return draft.variant
      const session = durable()
      const current = agent.current()

      if (session?.agent && current && session.agent !== current.name) return undefined
      const value = session?.model

      if (value) return "type" in value ? null : (value.variant ?? null)
    }

    const snapshot = () => {
      const selected = key()

      return {
        agent: agent.current()?.name,
        executorPreference: executorPreference(),
        model: selected,
        modelLabel: selected
          ? modelLabel(selected, sameKey(scope()?.model, selected) ? scope()?.modelLabel : undefined)
          : undefined,
        variant: selected ? (model.variant.current() ?? null) : undefined,
      } satisfies State
    }

    const write = (next: Partial<State>) => {
      const state = {
        ...clone(snapshot()),
        ...scope(),
        agent: agent.current()?.name,
        ...next,
      } satisfies State

      const session = id()

      if (session) {
        setSaved("session", session, state)

        return
      }

      if (store.draftID) {
        setSaved("session", `draft:${store.draftID}`, state)

        return
      }

      setStore("draft", state)
    }

    const recentKeys = createMemo(() => models.recent.list().filter(validModel))
    const recent = createMemo(() => recentKeys().map(models.find).filter(Boolean))
    const pending = new Map<string, { owner: typeof serverSDK.api; selection: State; requiresCanonicalAck: boolean }>()

    const sameSelection = (a: State, b: State) =>
      a.agent === b.agent &&
      sameKey(a.model, b.model) &&
      (a.variant ?? undefined) === (b.variant ?? undefined) &&
      sameExecutorPreference(a.executorPreference, b.executorPreference)

    const sessionSelection = (session: SessionInfo) => ({
      agent: session.agent,
      executorPreference: session.agent === "meta" ? session.executorPreference : undefined,
      model: session.model ? fromSelection(session.model) : undefined,
      variant: session.model && !("type" in session.model) ? session.model.variant : undefined,
    })

    const canonicalAckMatches = (expected: State, actual: State) => {
      const effective = (value: State) => ({
        ...value,
        variant: value.variant ?? "default",
        executorPreference: value.executorPreference
          ? {
              ...value.executorPreference,
              model:
                value.executorPreference.model && !("type" in value.executorPreference.model)
                  ? {
                      ...value.executorPreference.model,
                      variant: value.executorPreference.model.variant ?? "default",
                    }
                  : value.executorPreference.model,
            }
          : undefined,
      })

      return sameSelection(effective(expected), effective(actual))
    }

    const reconcile = (sessionID: string) => {
      const key = handoffKey(serverSDK.scope, sdk().directory, sessionID)
      const draft = saved.session[sessionID] ?? handoff.get(key)
      const session = data.session.get(sessionID)

      const commit = pending.get(sessionID)
      // First activation and historical roots require the mutation's adopted readback.

      if (session?.controller?.kind === "root" || commit?.requiresCanonicalAck) return

      if (!session?.model || !draft || (!draft.model && !draft.executorPreference && !draft.agent)) return
      const actual = sessionSelection(session)

      const overlay = {
        agent: draft.agent ?? actual.agent,
        model: draft.model ?? actual.model,
        variant: draft.model ? draft.variant : actual.variant,
        executorPreference: draft.executorPreference ?? actual.executorPreference,
      }

      // Legacy selection acknowledgments must own a ticket before releasing local choices.
      if (!session.controller && !commit) return

      if (commit && commit.owner !== serverSDK.api) return
      const expected = commit?.selection ?? overlay

      if (!sameSelection(expected, actual)) return
      pending.delete(sessionID)

      if (!session.controller && id() !== sessionID) return

      if (!sameSelection(overlay, expected)) return
      setSaved("session", sessionID, {
        agent: undefined,
        model: undefined,
        variant: undefined,
        executorPreference: undefined,
        choices: draft.choices,
      })
      handoff.delete(key)
    }

    onCleanup(serverSDK.event.on("session.model.selected", (event) => reconcile(event.data.sessionID)))
    onCleanup(serverSDK.event.on("session.executor.selected", (event) => reconcile(event.data.sessionID)))
    createEffect(() => {
      const session = id()

      if (session && savedReady()) reconcile(session)
    })
    onCleanup(serverSDK.event.on("session.agent.selected", (event) => reconcile(event.data.sessionID)))
    onCleanup(
      serverSDK.event.on("session.deleted", (event) => {
        pending.delete(event.data.sessionID)
        setSaved("session", event.data.sessionID, undefined)
      }),
    )

    const model = {
      ready: Object.assign(
        () => {
          const selected = key()

          return (
            models.ready() && configuredModel.ready() && (!selected || !isGroup(selected) || groupRead() !== undefined)
          )
        },
        { promise: models.ready.promise },
      ),
      current,
      identity,
      key,
      groups,
      recent,
      list: models.list,
      trackSessionCommit(
        sessionID: string,
        selection: { agent: string; model: ModelKey; variant?: string; executorPreference?: SessionExecutorPreference },
        submissionCurrent?: () => boolean,
      ) {
        const commit = {
          owner: serverSDK.api,
          selection,
          requiresCanonicalAck: selection.agent === "meta" || data.session.get(sessionID)?.controller?.kind === "root",
        }

        pending.set(sessionID, commit)

        if (!disposed && commit.requiresCanonicalAck && id() === sessionID && sameSelection(snapshot(), selection))
          setSaved("session", sessionID, { ...clone(scope()), ...selection, variant: selection.variant ?? null })

        if (!disposed) reconcile(sessionID)

        return (canonical?: SessionInfo): "acknowledged" | "failed" | "stale" | void => {
          // A created Session owns its first send after the Draft view transfers and unmounts.
          if (serverSDK.api !== commit.owner || (submissionCurrent ? !submissionCurrent() : disposed))
            return commit.requiresCanonicalAck ? "stale" : undefined

          if (pending.get(sessionID) !== commit) return commit.requiresCanonicalAck ? "stale" : undefined

          if (!commit.requiresCanonicalAck || !canonical) {
            pending.delete(sessionID)

            return commit.requiresCanonicalAck ? "failed" : undefined
          }

          if (canonical.id !== sessionID || canonical.controller?.kind !== "root" || !canonical.model) return "failed"
          const actual = sessionSelection(canonical)
          const current = data.session.get(sessionID)

          if (current?.controller?.kind !== "root" || !current.model) return "failed"

          // An adopted read can precede a same-owner event that changes either selection.
          if (!sameSelection(sessionSelection(current), actual) || !canonicalAckMatches(selection, actual))
            return "failed"
          pending.delete(sessionID)

          if (!disposed && id() === sessionID && sameSelection(snapshot(), selection)) {
            setSaved("session", sessionID, {
              agent: undefined,
              model: undefined,
              variant: undefined,
              executorPreference: undefined,
              choices: saved.session[sessionID]?.choices,
            })
            handoff.delete(handoffKey(serverSDK.scope, sdk().directory, sessionID))
          }

          return "acknowledged"
        }
      },
      cycle(direction: 1 | -1) {
        const items = recentKeys()
        const item = key()

        if (!item) return

        const index = items.findIndex((entry) => sameKey(entry, item))
        let next = index === -1 ? (direction === 1 ? 0 : items.length - 1) : index + direction

        if (next < 0) next = items.length - 1

        if (next >= items.length) next = 0

        const entry = items[next]

        if (!entry) return
        model.set(entry)
      },
      set(item: ModelKey | undefined, options?: { recent?: boolean }) {
        if (locked()) return
        batch(() => {
          if (item && !validModel(item)) return
          const previous = key()
          const same = item && sameKey(previous, item)
          write({
            model: item,
            modelLabel: item ? modelLabel(item) : undefined,
            variant: same ? (model.variant.current() ?? null) : undefined,
          })

          if (!item) return

          // A session draft owns its variant even when preferences change in another session.
          if (id() && !same) write({ variant: model.variant.current() ?? null })
          models.setVisibility(item, true)

          if (!options?.recent) return
          models.recent.push(item)
        })
      },
      visible(item: ModelKey) {
        return models.visible(item)
      },
      setVisibility(item: ModelKey, visible: boolean) {
        models.setVisibility(item, visible)
      },
      variant: {
        configured,
        selected,
        current() {
          const selectedKey = key()

          if (selectedKey && isGroup(selectedKey)) return
          const model = current()

          if (!model && explicitModel()) return this.selected() ?? undefined

          if (metaSelected() || locked()) {
            const value = this.selected()

            if (value === null) return
            const chosen = value ?? this.configured()

            return chosen
          }

          return resolveModelVariant({
            variants: this.list(),
            selected: this.selected(),
            configured: this.configured(),
            preferred: model ? models.variant.get({ providerID: model.provider.id, modelID: model.id }) : undefined,
          })
        },
        list() {
          const item = current()

          if (!item?.variants) return []

          return Object.keys(item.variants)
        },
        set(value: string | undefined) {
          if (locked()) return
          batch(() => {
            const model = current()

            if (!model) return
            write({ model: { providerID: model.provider.id, modelID: model.id }, variant: value ?? null })
            models.variant.set({ providerID: model.provider.id, modelID: model.id }, value)
          })
        },
        cycle() {
          const items = this.list()

          if (items.length === 0) return

          if (metaSelected()) {
            const selected = this.current()
            this.set(items[selected === undefined ? 0 : items.indexOf(selected) + 1])

            return
          }

          this.set(
            cycleModelVariant({
              variants: items,
              selected: this.current() ?? null,
              configured: undefined,
            }),
          )
        },
      },
    }

    const selectExecutor = (next: SessionExecutorPreference | undefined) => {
      if (!metaSelected() || locked()) return

      if (next && !executorList().some((item) => item.name === next.agent)) return
      const previous = executorPreference()
      const choices = selectionChoices()

      if (previous && previous.agent !== next?.agent) {
        const selected = previous.model && fromSelection(previous.model)
        const stored = choices[`executor:${previous.agent}`]
        choices[`executor:${previous.agent}`] = {
          model: selected,
          modelLabel: selected
            ? modelLabel(selected, sameKey(stored?.model, selected) ? stored?.modelLabel : undefined)
            : undefined,
          variant: previous.model && !("type" in previous.model) ? previous.model.variant : undefined,
        }
      }

      const chosen = next && previous?.agent !== next.agent ? choices[`executor:${next.agent}`] : undefined

      const preference =
        next && !next.model && chosen?.model
          ? { agent: next.agent, model: toSelection(chosen.model, chosen.variant ?? undefined) }
          : next

      if (preference?.model) {
        const selected = fromSelection(preference.model)
        const stored = choices[`executor:${preference.agent}`]
        choices[`executor:${preference.agent}`] = {
          model: selected,
          modelLabel: modelLabel(selected, sameKey(stored?.model, selected) ? stored?.modelLabel : undefined),
          variant: "type" in preference.model ? undefined : preference.model.variant,
        }
      }

      write({ choices, executorPreference: preference })
    }

    const executorKey = createMemo(() => {
      if (!metaSelected()) return
      const preferred = preference()?.model

      if (preferred) return fromSelection(preferred)
      const selected = executorAgent()

      if (!selected) return

      return selected.model ?? key()
    })

    const executorCurrent = createMemo(() => {
      const selected = executorKey()

      return selected && validModel(selected) ? models.find(selected) : undefined
    })

    const executorModel = {
      ...model,
      ready: Object.assign(
        () => {
          const selected = executorKey()

          return (
            models.ready() && configuredModel.ready() && (!selected || !isGroup(selected) || groupRead() !== undefined)
          )
        },
        { promise: models.ready.promise },
      ),
      current: executorCurrent,
      key: executorKey,
      identity: () => {
        const selected = executorKey()

        if (!selected || !configuredModel.ready()) return
        const choice = selectionChoices()[`executor:${preference()?.agent}`]

        return displayIdentity(selected, sameKey(choice?.model, selected) ? choice?.modelLabel : undefined)
      },
      set(item: ModelKey | undefined, options?: { recent?: boolean }) {
        if (!metaSelected()) return
        const selected = executorAgent()

        if (!selected || (item && !validModel(item))) return
        const previous = preference()?.model
        const previousKey = previous && fromSelection(previous)
        selectExecutor({
          agent: selected.name,
          model: item
            ? toSelection(
                item,
                previous && !("type" in previous) && sameKey(previousKey, item) ? previous.variant : undefined,
              )
            : undefined,
        })

        if (item) models.setVisibility(item, true)

        if (item && options?.recent) models.recent.push(item)
      },
      cycle(direction: 1 | -1) {
        const items = recentKeys()
        const value = executorKey()
        const index = items.findIndex((item) => sameKey(item, value))
        const next =
          items[
            index === -1 ? (direction === 1 ? 0 : items.length - 1) : (index + direction + items.length) % items.length
          ]

        if (next) executorModel.set(next)
      },
      variant: {
        configured: () => {
          const selected = executorKey()

          return selected && isGroup(selected) ? undefined : executorAgent()?.variant
        },
        selected: () => {
          const selected = preference()?.model

          return selected ? ("type" in selected ? null : (selected.variant ?? null)) : undefined
        },
        current() {
          const selected = executorKey()

          if (selected && isGroup(selected)) return
          const preferred = preference()?.model

          if (preferred && !("type" in preferred)) return preferred.variant
          const value = executorAgent()

          if (value?.model) return value.variant

          return model.variant.current()
        },
        list: () => Object.keys(executorCurrent()?.variants ?? {}),
        set(value: string | undefined) {
          const selected = executorCurrent()

          if (!selected) return
          executorModel.set({ modelID: selected.id, providerID: selected.provider.id, variant: value })
          const currentPreference = preference()

          if (currentPreference?.model && !("type" in currentPreference.model))
            selectExecutor({ ...currentPreference, model: { ...currentPreference.model, variant: value } })
        },
        cycle() {
          const items = this.list()
          const selected = this.current()
          this.set(items[selected === undefined ? 0 : items.indexOf(selected) + 1])
        },
      },
    }

    const result = {
      slug: createMemo(() => base64Encode(sdk().directory)),
      model,
      agent,
      composition,
      metaSelected,
      locked,
      executor: {
        model: executorModel,
        preference: executorPreference,
        set: selectExecutor,
      },
      session: {
        ready: savedReady,
        bindDraft(draftID: string, initialModel?: ModelKey) {
          setStore("draftID", draftID)
          if (!savedReady() || !initialModel || saved.session[`draft:${draftID}`]) return

          write({
            model: initialModel,
            variant: "type" in initialModel ? null : (initialModel.variant ?? null),
          })
        },
        draftID: () => store.draftID,
        choices: () => scope()?.choices,
        reset() {
          setStore({ draft: undefined, promoting: undefined })
        },
        promote(dir: string, session: string, state?: State) {
          const next = clone(state ?? snapshot())

          if (!next) return
          // Creation already owns the active selection; keep only agent memory once it is in the read model.
          // Otherwise a first-message command's configured overrides would stay hidden behind this handoff.
          const created = data.session.get(session)
          const selection = created?.model

          const committed =
            selection &&
            sameSelection(next, {
              agent: created.agent,
              executorPreference: created.executorPreference,
              model: fromSelection(selection),
              variant: "type" in selection ? undefined : selection.variant,
            })
              ? { choices: next.choices }
              : next

          const key = handoffKey(serverSDK.scope, dir, session)
          handoff.set(key, committed)

          if (dir === sdk().directory) {
            setSaved("session", session, {
              agent: undefined,
              model: undefined,
              variant: undefined,
              executorPreference: undefined,
              ...committed,
            })
          }

          setStore("promoting", committed)

          if (store.draftID) setSaved("session", `draft:${store.draftID}`, undefined)
          setStore("draft", undefined)
        },
        restore(msg: { sessionID: string; agent: string; model: ModelKey }) {
          const session = id()

          if (!session) return

          if (msg.sessionID !== session) return

          if (durable()?.model) return

          if (saved.session[session] !== undefined) return

          if (handoff.has(handoffKey(serverSDK.scope, sdk().directory, session))) return

          setSaved("session", session, {
            agent: msg.agent,
            model: msg.model,
            variant: "type" in msg.model ? null : (msg.model.variant ?? null),
          })
        },
      },
    }

    return result
  },
})

type SessionCommit = ReturnType<typeof useLocal>["model"]["trackSessionCommit"]

export type ModelSelection = Omit<ReturnType<typeof useLocal>["model"], "trackSessionCommit" | "identity"> & {
  identity?: ReturnType<typeof useLocal>["model"]["identity"]
  trackSessionCommit?: (
    ...args: Parameters<SessionCommit>
  ) => (...args: Parameters<ReturnType<SessionCommit>>) => ReturnType<ReturnType<SessionCommit>> | void
}
