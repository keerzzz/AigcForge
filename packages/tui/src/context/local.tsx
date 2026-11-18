import { createStore } from "solid-js/store"
import { dedupeWith } from "effect/Array"
import { createSimpleContext } from "./helper"
import { batch, createMemo, onCleanup, type ParentProps } from "solid-js"
import type { ModelSelection, SessionExecutorPreference } from "@aigcfroge/client/promise"
import { useEvent } from "./event"
import path from "path"
import { useTuiPaths } from "./runtime"
import { useArgs } from "./args"
import { RGBA } from "@opentui/core"
import { readJson, writeJsonAtomic } from "../util/persistence"
import {
  createModelPreferenceRepository,
  cycleModelVariant,
  favoriteModels,
  isModelGroup,
  modelPreferenceKey,
  modelSelectionKey,
  normalizeModelVariant,
  recentModels,
  toModelPreference,
  toModelSelection,
  type ModelPreference,
  type ModelPreferenceModel,
  type ModelPreferenceSelection,
} from "../model-preference"
import { useTheme } from "./theme"
import { useToast } from "../ui/toast"
import { useRoute } from "./route"
import { useData } from "./data"
import { useClient } from "./client"
import { usePermission } from "./permission"
import { useLocation } from "./location"
import { parse } from "../util/model"
import { ProductMode } from "@aigcfroge/schema/product-mode"

const context = createSimpleContext({
  name: "Local",
  init: () => {
    const data = useData()
    const client = useClient()
    const toast = useToast()
    const theme = useTheme()
    const route = useRoute()
    const paths = useTuiPaths()
    const args = useArgs()
    const event = useEvent()
    const permission = usePermission()
    const location = useLocation()

    const models = () => data.location.model.list(location.ref)
    const groups = () => data.location.model.group.definition.list(location.ref)
    const providers = () => data.location.provider.list(location.ref)

    function isModelValid(model: ModelPreferenceModel) {
      if (isModelGroup(model))
        return !!groups()?.effective.some((item) => item.groupID === model.groupID && !item.unavailable && item.definition)
      return !!models()?.some((item) => item.providerID === model.providerID && item.id === model.modelID)
    }

    function getFirstValidModel(...modelFns: (() => ModelPreferenceModel | undefined)[]) {
      for (const modelFn of modelFns) {
        const model = modelFn()
        if (model && (isModelGroup(model) || isModelValid(model))) return model
      }
    }

    function createAgent() {
      const agents = createMemo(() => {
        const session = route.data.type === "session" ? data.session.get(route.data.sessionID) : undefined
        const controller = session?.controller
        return (data.location.agent.list(location.ref) ?? []).filter((agent) =>
          controller?.kind === "child"
            ? agent.id === controller.executor.agent
            : agent.mode !== "subagent" && !agent.hidden &&
              (agent.ordinaryModes?.includes(session?.mode ?? ProductMode.Default) ?? true),
        )
      })
      const visibleAgents = createMemo(() =>
        (data.location.agent.list(location.ref) ?? []).filter((agent) => !agent.hidden),
      )
      const [agentStore, setAgentStore] = createStore({
        current: undefined as string | undefined,
        draftBySession: {} as Record<string, { agent?: string } | undefined>,
      })
      onCleanup(event.on("session.deleted", (evt) => setAgentStore("draftBySession", evt.data.sessionID, undefined)))
      onCleanup(
        event.on("session.agent.selected", (evt) => {
          // Keep an entry after acknowledgment: CLI defaults must not override a user's later choice.
          if (agentStore.draftBySession[evt.data.sessionID]?.agent === evt.data.agent)
            setAgentStore("draftBySession", evt.data.sessionID, { agent: undefined })
        }),
      )
      const colors = createMemo(() => {
        const step = 200
        return dedupeWith(
          theme.categorical.map((scale) => scale[step]),
          (first, second) => first.equals(second),
        )
      })
      return {
        list() {
          return agents()
        },
        current() {
          const controller =
            route.data.type === "session" ? data.session.get(route.data.sessionID)?.controller : undefined
          if (controller?.kind === "child") return agents().find((agent) => agent.id === controller.executor.agent)
          const draft = route.data.type === "session" ? agentStore.draftBySession[route.data.sessionID] : undefined
          const selected =
            route.data.type === "session"
              ? (draft?.agent ??
                (draft ? undefined : args.agent) ??
                data.session.get(route.data.sessionID)?.agent ??
                agentStore.current)
              : (agentStore.current ?? args.agent)
          return selected ? agents().find((agent) => agent.id === selected) : agents().at(0)
        },
        set(id: string) {
          if (route.data.type === "session" && data.session.get(route.data.sessionID)?.controller?.kind === "child") {
            if (id !== this.current()?.id)
              toast.show({
                variant: "warning",
                message: "Child Agent selection is fixed by its adopted binding",
                duration: 3000,
              })
            return
          }
          if (!agents().some((agent) => agent.id === id))
            return toast.show({
              variant: "warning",
              message: `Agent not found: ${id}`,
              duration: 3000,
            })
          batch(() => {
            const changed = this.current()?.id !== id
            if (changed) model.remember()
            setAgentStore("current", id)
            if (route.data.type === "session") setAgentStore("draftBySession", route.data.sessionID, { agent: id })
            // Retain both selections while agent and model commits arrive separately.
            const selected = changed && route.data.type === "session" ? model.current() : undefined
            if (selected) model.set(selected)
          })
        },
        move(direction: 1 | -1) {
          batch(() => {
            const current = this.current()
            if (!current) return
            let next = agents().findIndex((agent) => agent.id === current.id) + direction
            if (next < 0) next = agents().length - 1
            if (next >= agents().length) next = 0
            const value = agents()[next]
            this.set(value.id)
          })
        },
        color(id: string) {
          const index = visibleAgents().findIndex((agent) => agent.id === id)
          if (index === -1) return colors()[0]
          const agent = visibleAgents()[index]

          if (agent?.color) return RGBA.fromHex(agent.color)
          return colors()[index % colors().length]
        },
      }
    }

    const agent = createAgent()

    function createModel() {
      const [preferences, setPreferences] = createStore<ModelPreference & { ready: boolean }>({
        ready: false,
        recent: [],
        favorite: [],
        variant: {},
      })
      const [selectionState, setSelectionState] = createStore<{
        newSessionModelByLocationAgent: Record<string, ModelPreferenceSelection | undefined>
        selectionBySessionAgent: Record<string, Record<string, ModelPreferenceSelection | undefined> | undefined>
        executorBySession: Record<string, SessionExecutorPreference | undefined>
        executorByLocation: Record<string, SessionExecutorPreference | undefined>
      }>({
        newSessionModelByLocationAgent: {},
        selectionBySessionAgent: {},
        executorBySession: {},
        executorByLocation: {},
      })

      const repository = createModelPreferenceRepository(path.join(paths.state, "model.json"))
      const pendingSelectionCommits = new Map<
        string,
        { agentID: string; selection: string; owner?: typeof client.api }
      >()
      const lifetime = { active: true }
      onCleanup(() => {
        lifetime.active = false
        pendingSelectionCommits.clear()
      })
      const selectionKey = (value: ModelPreferenceSelection) =>
        modelSelectionKey(toModelSelection(value, value.variant))

      function applyPreferences(value: ModelPreference) {
        batch(() => {
          setPreferences("recent", value.recent)
          setPreferences("favorite", value.favorite)
          setPreferences("variant", value.variant)
          setPreferences("ready", true)
        })
      }

      onCleanup(repository.subscribe(applyPreferences))

      const configuredModel = createMemo(() => {
        const entry = data.location.config
          .list(location.ref)
          ?.findLast((entry) => entry.type === "document" && entry.info.model !== undefined)
        const configured = entry?.type === "document" ? entry.info.model : undefined
        if (!configured) return
        if (typeof configured === "string") return parse(configured)
        if ("type" in configured)
          return { type: "group" as const, groupID: configured.groupID }
        return { providerID: configured.providerID, modelID: configured.model, variant: configured.variant }
      })

      const fallbackModel = createMemo(() => {
        if (args.model) {
          const selected = parse(args.model)
          if (isModelGroup(selected) || isModelValid(selected)) return selected
        }

        const configured = configuredModel()
        if (configured && (isModelGroup(configured) || isModelValid(configured))) return configured

        for (const item of preferences.recent) {
          if (isModelValid(item)) {
            return item
          }
        }

        const preferred = groups()?.defaultSelection
        if (preferred) return toModelPreference(preferred)
        const model = models()?.[0]
        if (!model) return undefined
        return {
          providerID: model.providerID,
          modelID: model.id,
        }
      })

      const newSessionModel = createMemo(() => {
        const a = agent.current()
        return getFirstValidModel(
          () => a && selectionState.newSessionModelByLocationAgent[locationAgentKey(a.id)],
          () => a?.model && toModelPreference(a.model),
          fallbackModel,
        )
      })

      const currentSelection = createMemo<ModelPreferenceSelection | undefined>(() => {
        if (route.data.type === "session") return sessionSelection(route.data.sessionID)
        const id = agent.current()?.id
        const saved = id && selectionState.newSessionModelByLocationAgent[locationAgentKey(id)]
        if (saved) return saved
        const model = newSessionModel()
        if (!model) return
        return preferredSelection(model)
      })

      const currentModel = createMemo(() => {
        const selection = currentSelection()
        if (!selection) return
        if (isModelGroup(selection)) return { type: "group" as const, groupID: selection.groupID }
        return { providerID: selection.providerID, modelID: selection.modelID }
      })

      function locationAgentKey(agentID: string) {
        const ref = location.ref ?? data.location.default()
        return `${JSON.stringify([ref.directory, ref.workspaceID])}:${agentID}`
      }

      function preferredSelection(model: ModelPreferenceModel): ModelPreferenceSelection {
        if (isModelGroup(model)) return { type: "group", groupID: model.groupID }
        const configured = agent.current()?.model
        const fallback = configuredModel()
        const requested: ModelPreferenceSelection | undefined = args.model ? parse(args.model) : undefined
        const preferred = preferences.variant[modelPreferenceKey(model)]
        const selected =
          (requested && !isModelGroup(requested) && modelPreferenceKey(requested) === modelPreferenceKey(model)
            ? requested.variant
            : undefined) ??
          preferred ??
          (configured && !isModelGroup(configured) && configured.providerID === model.providerID && configured.id === model.modelID
            ? configured.variant
            : undefined) ??
          (fallback && !isModelGroup(fallback) && fallback.providerID === model.providerID && fallback.modelID === model.modelID
            ? fallback.variant
            : undefined)
        const variant = agent.current()?.id === "meta" ? selected : normalizeModelVariant(selected)
        const info = models()?.find((item) => item.providerID === model.providerID && item.id === model.modelID)
        return {
          ...model,
          variant: variant === "default" || info?.variants.some((item) => item.id === variant) ? variant : undefined,
        }
      }

      function durableSelection(sessionID: string): ModelPreferenceSelection | undefined {
        const model = data.session.get(sessionID)?.model
        if (!model) return
        if (isModelGroup(model)) return toModelPreference(model)
        return {
          providerID: model.providerID,
          modelID: model.id,
          variant: data.session.get(sessionID)?.agent === "meta" ? model.variant : normalizeModelVariant(model.variant),
        }
      }

      function sessionSelection(sessionID: string) {
        const current = agent.current()
        if (!current) return
        const session = data.session.get(sessionID)
        const selected =
          selectionState.selectionBySessionAgent[sessionID]?.[current.id] ??
          (!session?.agent || session.agent === current.id ? durableSelection(sessionID) : undefined)
        if (selected) return selected
        const model = newSessionModel()
        return model && preferredSelection(model)
      }

      function setSessionSelection(sessionID: string, agentID: string, selection: ModelPreferenceSelection | undefined) {
        setSelectionState("selectionBySessionAgent", sessionID, {
          ...selectionState.selectionBySessionAgent[sessionID],
          [agentID]: selection,
        })
      }

      function setSessionDraft(sessionID: string, selection: ModelPreferenceSelection) {
        const current = agent.current()
        if (!current) return
        const durable = durableSelection(sessionID)
        const session = data.session.get(sessionID)
        setSessionSelection(
          sessionID,
          current.id,
          (!session?.agent || session.agent === current.id) &&
            durable &&
            selectionKey(durable) === selectionKey(selection)
            ? undefined
            : selection,
        )
      }

      function selectModel(model: ModelPreferenceModel) {
        if (route.data.type === "session") {
          const sessionID = route.data.sessionID
          const current = sessionSelection(sessionID)
          setSessionDraft(
            sessionID,
            current && modelPreferenceKey(current) === modelPreferenceKey(model)
              ? current
              : preferredSelection(model),
          )
          return true
        }
        const current = agent.current()
        if (!current) return false
        setSelectionState("newSessionModelByLocationAgent", locationAgentKey(current.id), model)
        return true
      }

      function reconcileSessionSelection(sessionID: string) {
        const expected = pendingSelectionCommits.get(sessionID)
        const durable = durableSelection(sessionID)
        if (
          !lifetime.active ||
          expected?.owner !== client.api ||
          !durable ||
          data.session.get(sessionID)?.agent !== expected.agentID
        )
          return
        if (selectionKey(durable) !== expected.selection) return
        pendingSelectionCommits.delete(sessionID)
        // Inactive agents keep their remembered choices after another agent commits.
        if (
          route.data.type !== "session" ||
          route.data.sessionID !== sessionID ||
          agent.current()?.id !== expected.agentID
        )
          return
        const draft = selectionState.selectionBySessionAgent[sessionID]?.[expected.agentID]
        if (draft && selectionKey(draft) === expected.selection)
          setSessionSelection(sessionID, expected.agentID, undefined)
      }

      onCleanup(event.on("session.model.selected", (evt) => reconcileSessionSelection(evt.data.sessionID)))
      onCleanup(event.on("session.agent.selected", (evt) => reconcileSessionSelection(evt.data.sessionID)))

      onCleanup(
        event.on("session.deleted", (evt) => {
          pendingSelectionCommits.delete(evt.data.sessionID)
          setSelectionState("selectionBySessionAgent", evt.data.sessionID, undefined)
        }),
      )

      const legacy = {
        current: currentModel,
        selection: currentSelection,
        remember() {
          const current = agent.current()
          const selection = currentSelection()
          if (!current || !selection) return
          if (route.data.type !== "session") {
            setSelectionState("newSessionModelByLocationAgent", locationAgentKey(current.id), { ...selection })
            return
          }
          setSessionSelection(route.data.sessionID, current.id, { ...selection })
        },
        available(model = currentModel()) {
          return model ? isModelValid(model) : false
        },
        trackSessionCommit(
          sessionID: string,
          value: ModelSelection,
          agentID: string,
        ) {
          const committed = {
            agentID,
            selection: modelSelectionKey(value),
            owner: client.api,
          }
          pendingSelectionCommits.set(sessionID, committed)
          // An unchanged model emits no event; the agent may be the only durable change.
          reconcileSessionSelection(sessionID)
          return () => {
            if (pendingSelectionCommits.get(sessionID) === committed) pendingSelectionCommits.delete(sessionID)
          }
        },
        get ready() {
          return preferences.ready
        },
        get catalogReady() {
          return models() !== undefined && groups() !== undefined
        },
        recent() {
          return preferences.recent
        },
        favorite() {
          return preferences.favorite
        },
        parsed: createMemo(() => {
          const value = currentSelection()
          if (!value) {
            return {
              provider: "Connect a provider",
              model: "No provider selected",
              reasoning: false,
            }
          }
          if (isModelGroup(value)) {
            const group = groups()?.effective.find((item) => item.groupID === value.groupID)
            return {
              provider: "Model group",
              model: group?.definition?.name ?? `${value.groupID} (unavailable)`,
              reasoning: false,
            }
          }
          const provider = providers()?.find((item) => item.id === value.providerID)
          const info = models()?.find((item) => item.providerID === value.providerID && item.id === value?.modelID)
          return {
            provider: provider?.name ?? value.providerID,
            model: info?.name ?? `${value.modelID} (unavailable)`,
            reasoning: (info?.variants?.length ?? 0) !== 0,
          }
        }),
        cycle(direction: 1 | -1) {
          const current = currentSelection()
          if (!current) return
          const recent = preferences.recent.filter(isModelValid)
          const index = recent.findIndex((x) => modelPreferenceKey(x) === modelPreferenceKey(current))
          let next = index === -1 ? (direction === 1 ? 0 : recent.length - 1) : index + direction
          if (next < 0) next = recent.length - 1
          if (next >= recent.length) next = 0
          const val = recent[next]
          if (!val) return
          selectModel({ ...val })
        },
        cycleFavorite(direction: 1 | -1) {
          const favorites = preferences.favorite.filter((item) => isModelValid(item))
          if (!favorites.length) {
            toast.show({
              variant: "info",
              message: "Add a favorite model to use this shortcut",
              duration: 3000,
            })
            return
          }
          const current = currentSelection()
          let index = -1
          if (current) {
            index = favorites.findIndex((x) => modelPreferenceKey(x) === modelPreferenceKey(current))
          }
          if (index === -1) {
            index = direction === 1 ? 0 : favorites.length - 1
          } else {
            index += direction
            if (index < 0) index = favorites.length - 1
            if (index >= favorites.length) index = 0
          }
          const next = favorites[index]
          if (!next) return
          if (!selectModel({ ...next })) return
          setPreferences("recent", recentModels(next, preferences.recent))
          void repository.addRecent(next).catch(() => undefined)
        },
        set(model: ModelPreferenceModel, options?: { recent?: boolean }) {
          batch(() => {
            if (!isModelValid(model)) return
            if (!selectModel(model)) return
            if (options?.recent) {
              setPreferences("recent", recentModels(model, preferences.recent))
              void repository.addRecent(model).catch(() => undefined)
            }
          })
        },
        toggleFavorite(model: ModelPreferenceModel) {
          batch(() => {
            if (!isModelValid(model)) return
            const exists = preferences.favorite.some(
              (x) => modelPreferenceKey(x) === modelPreferenceKey(model),
            )
            setPreferences("favorite", favoriteModels(model, preferences.favorite, !exists))
            void repository.setFavorite(model, !exists).catch(() => undefined)
          })
        },
        variant: {
          selected() {
            return currentSelection()?.variant
          },
          current() {
            return this.selected()
          },
          list() {
            const m = currentSelection()
            if (!m || isModelGroup(m)) return []
            const info = models()?.find((item) => item.providerID === m.providerID && item.id === m.modelID)
            return info?.variants?.map((variant) => variant.id) ?? []
          },
          set(value: string | undefined) {
            const m = currentSelection()
            if (!m || isModelGroup(m)) return
            if (route.data.type === "session") {
              setSessionDraft(route.data.sessionID, { ...m, variant: normalizeModelVariant(value) })
            }
            setPreferences("variant", modelPreferenceKey(m), value ?? "default")
            void repository.saveVariant(m, value).catch(() => undefined)
          },
          cycle() {
            const variants = this.list()
            if (variants.length === 0) return
            this.set(cycleModelVariant(this.current(), variants))
          },
        },
      }

      function controlledSession() {
        return route.data.type === "session" ? data.session.get(route.data.sessionID) : undefined
      }

      function controlled() {
        return locked() || agent.current()?.id === "meta"
      }

      function locked() {
        return controlledSession()?.controller?.kind === "child"
      }

      const slot = (domain: "session" | "executor", id: string) => JSON.stringify(["canonical", domain, id])
      const refKey = (value: ModelSelection | undefined) => JSON.stringify(
        value ? isModelGroup(value) ? ["group", value.groupID] : [value.providerID, value.id, value.variant ?? null] : null,
      )
      const preferenceKey = (value: SessionExecutorPreference | undefined) =>
        JSON.stringify(value ? [value.agent, refKey(value.model)] : null)
      const selectionRef = (value: ModelPreferenceSelection) => toModelSelection(value, value.variant)
      const adaptedRef = toModelPreference

      function executorPreference() {
        if (!controlled() || locked()) return
        return route.data.type === "session"
          ? (selectionState.executorBySession[route.data.sessionID] ?? controlledSession()?.executorPreference)
          : selectionState.executorByLocation[locationAgentKey("canonical")]
      }

      function writeExecutor(value: SessionExecutorPreference | undefined) {
        if (route.data.type === "session") {
          setSelectionState("executorBySession", route.data.sessionID, value)
          return
        }
        setSelectionState("executorByLocation", locationAgentKey("canonical"), value)
      }

      function canonicalSelection(domain: "session" | "executor"): ModelPreferenceSelection | undefined {
        if (!controlled()) return
        const current = controlledSession()
        if (domain === "executor") {
          if (locked()) return
          const preferred = executorPreference()
          if (preferred?.model) return adaptedRef(preferred.model)
          const configured = (data.location.agent.list(location.ref) ?? []).find(
            (item) => item.id === preferred?.agent,
          )?.model
          return configured ? adaptedRef(configured) : canonicalSelection("session")
        }
        if (current?.controller?.kind === "child") return adaptedRef(current.controller.executor.model)
        return currentSelection()
      }

      function writeCanonicalSelection(domain: "session" | "executor", value: ModelPreferenceSelection) {
        const current = canonicalSelection(domain)
        if (locked()) {
          if (!current || refKey(selectionRef(current)) !== refKey(selectionRef(value)))
            toast.show({
              variant: "warning",
              message: "Child Agent selection is fixed by its adopted binding",
              duration: 3000,
            })
          return
        }
        if (domain === "executor") {
          const preference = executorPreference()
          if (!preference) return
          writeExecutor({ agent: preference.agent, model: selectionRef(value) })
          return
        }
        const id = agent.current()?.id
        if (!id) return
        if (route.data.type !== "session") {
          setSelectionState("newSessionModelByLocationAgent", locationAgentKey(id), value)
          return
        }
        const session = controlledSession()
        setSessionSelection(
          route.data.sessionID,
          id,
          session?.agent === id && session.model && refKey(session.model) === refKey(selectionRef(value))
            ? undefined
            : value,
        )
      }

      function trackCanonical(sessionID: string, domain: "session" | "executor", agentID: string, value: string) {
        const key = slot(domain, sessionID)
        const committed = { agentID, selection: value, owner: client.api }
        pendingSelectionCommits.set(key, committed)
        // Even an unchanged choice must stay captured while its mutation is pending.
        if (route.data.type === "session" && route.data.sessionID === sessionID) {
          const selected = canonicalSelection(domain)
          if (domain === "session" && selected && refKey(selectionRef(selected)) === value)
            setSessionSelection(sessionID, agentID, { ...selected })
          const preference = executorPreference()
          if (domain === "executor" && preference && preferenceKey(preference) === value)
            setSelectionState("executorBySession", sessionID, {
              ...preference,
              model: preference.model ? { ...preference.model } : undefined,
            })
        }
        return (outcome: "acknowledge" | "cancel") => {
          if (!lifetime.active || pendingSelectionCommits.get(key) !== committed) return
          pendingSelectionCommits.delete(key)
          if (outcome !== "acknowledge" || client.api !== committed.owner) return
          // Successful ACK/readback may retain an effective-equivalent raw Ref.
          if (domain === "executor") {
            const draft = selectionState.executorBySession[sessionID]
            if (draft && preferenceKey(draft) === committed.selection)
              setSelectionState("executorBySession", sessionID, undefined)
            return
          }
          if (route.data.type !== "session" || route.data.sessionID !== sessionID || agent.current()?.id !== agentID)
            return
          const draft = selectionState.selectionBySessionAgent[sessionID]?.[agentID]
          if (draft && refKey(selectionRef(draft)) === committed.selection)
            setSessionSelection(sessionID, agentID, undefined)
        }
      }

      const executorAgent = {
        list() {
          const catalog = data.location.agent.list(location.ref) ?? []
          if (locked()) return catalog.filter((item) => item.id === controlledSession()?.agent)
          return catalog.filter((item) => item.id !== "meta" && item.mode !== "primary" && !item.hidden &&
            (item.ordinaryModes?.includes(controlledSession()?.mode ?? ProductMode.Default) ?? true))
        },
        current() {
          if (locked())
            return (data.location.agent.list(location.ref) ?? []).find((item) => item.id === controlledSession()?.agent)
          const selected = executorPreference()?.agent
          return this.list().find((item) => item.id === selected)
        },
        set(id: string) {
          if (locked()) {
            if (id !== controlledSession()?.agent)
              toast.show({
                variant: "warning",
                message: "Child Agent selection is fixed by its adopted binding",
                duration: 3000,
              })
            return
          }
          if (!this.list().some((item) => item.id === id))
            return toast.show({ variant: "warning", message: "Executor not found: " + id, duration: 3000 })
          const previous = executorPreference()
          if (previous?.agent === id) return
          batch(() => {
            if (previous?.model) {
              if (route.data.type === "session")
                setSessionSelection(route.data.sessionID, slot("executor", previous.agent), adaptedRef(previous.model))
              if (route.data.type !== "session")
                setSelectionState(
                  "newSessionModelByLocationAgent",
                  locationAgentKey(slot("executor", previous.agent)),
                  adaptedRef(previous.model),
                )
            }
            const remembered =
              route.data.type === "session"
                ? selectionState.selectionBySessionAgent[route.data.sessionID]?.[slot("executor", id)]
                : selectionState.newSessionModelByLocationAgent[locationAgentKey(slot("executor", id))]
            writeExecutor({ agent: id, model: remembered ? selectionRef(remembered) : undefined })
          })
        },
        move(direction: 1 | -1) {
          const choices = this.list()
          if (choices.length === 0) return
          const index = choices.findIndex((item) => item.id === this.current()?.id)
          const next = choices[(index + direction + choices.length) % choices.length]
          if (next) this.set(next.id)
        },
        color: agent.color,
      }

      function canonicalModel(domain: "session" | "executor") {
        const selected = createMemo(() => canonicalSelection(domain))
        const current = createMemo(() => {
          const value = selected()
          if (value && isModelGroup(value)) return { type: "group" as const, groupID: value.groupID }
          return value && { providerID: value.providerID, modelID: value.modelID }
        })
        const set = (value: ModelPreferenceModel, options?: { recent?: boolean }) => {
          if (!isModelValid(value)) return
          const previous = selected()
          const configured =
            domain === "executor"
              ? (data.location.agent.list(location.ref) ?? []).find((item) => item.id === executorPreference()?.agent)
                  ?.model
              : (data.location.agent.list(location.ref) ?? []).find((item) => item.id === "meta")?.model
          writeCanonicalSelection(
            domain,
            previous && modelPreferenceKey(previous) === modelPreferenceKey(value)
              ? previous
              : isModelGroup(value)
                ? { type: "group", groupID: value.groupID }
              : {
                  ...value,
                  variant:
                    configured && !isModelGroup(configured) && configured.providerID === value.providerID && configured.id === value.modelID
                      ? configured.variant
                      : undefined,
                },
          )
          if (options?.recent) {
            setPreferences("recent", recentModels(value, preferences.recent))
            void repository.addRecent(value).catch(() => undefined)
          }
        }
        const cycle = (direction: 1 | -1, choices: ModelPreferenceModel[]) => {
          const available = choices.filter(isModelValid)
          if (available.length === 0) return
          const value = current()
          const index = available.findIndex(
            (item) => value && modelPreferenceKey(item) === modelPreferenceKey(value),
          )
          const next =
            available[
              index === -1
                ? direction === 1
                  ? 0
                  : available.length - 1
                : (index + direction + available.length) % available.length
            ]
          if (next) set(next)
        }
        return {
          ...legacy,
          get ready() {
            return legacy.ready
          },
          get catalogReady() {
            return legacy.catalogReady
          },
          current,
          selection: selected,
          set,
          remember() {
            const value = selected()
            const preference = executorPreference()
            if (!value || domain !== "executor" || !preference?.model || route.data.type !== "session") return
            setSessionSelection(route.data.sessionID, slot(domain, preference.agent), value)
          },
          available(value = selected()) {
            return value ? isModelValid(value) : false
          },
          parsed: createMemo(() => {
            const value = selected()
            if (value && isModelGroup(value)) {
              const group = groups()?.effective.find((item) => item.groupID === value.groupID)
              return { provider: "Model group", model: group?.definition?.name ?? `${value.groupID} (unavailable)`, reasoning: false }
            }
            const provider = providers()?.find((item) => item.id === value?.providerID)
            const info = models()?.find((item) => item.providerID === value?.providerID && item.id === value?.modelID)
            return {
              provider: value ? (provider?.name ?? value.providerID) : "Connect a provider",
              model: value ? (info?.name ?? value.modelID + " (unavailable)") : "No provider selected",
              reasoning: (info?.variants.length ?? 0) !== 0,
            }
          }),
          cycle(direction: 1 | -1) {
            cycle(direction, preferences.recent)
          },
          cycleFavorite(direction: 1 | -1) {
            cycle(direction, preferences.favorite)
          },
          trackSessionCommit(sessionID: string, value: ModelSelection, agentID: string) {
            return trackCanonical(sessionID, domain, agentID, refKey(value))
          },
          variant: {
            selected() {
              return selected()?.variant
            },
            current() {
              return selected()?.variant
            },
            list() {
              const value = selected()
              if (!value || isModelGroup(value)) return []
              return (
                models()
                  ?.find((item) => item.providerID === value?.providerID && item.id === value?.modelID)
                  ?.variants.map((item) => item.id) ?? []
              )
            },
            set(value: string | undefined) {
              const model = selected()
              if (!model || isModelGroup(model)) return
              writeCanonicalSelection(domain, { ...model, variant: value })
            },
            cycle() {
              const variants = this.list()
              if (variants.length === 0) return
              const index = variants.indexOf(this.current() ?? "")
              this.set(variants[index + 1])
            },
          },
        }
      }

      onCleanup(
        event.on("session.deleted", (evt) => {
          pendingSelectionCommits.delete(slot("session", evt.data.sessionID))
          pendingSelectionCommits.delete(slot("executor", evt.data.sessionID))
          setSelectionState("executorBySession", evt.data.sessionID, undefined)
        }),
      )

      return {
        ...legacy,
        get ready() {
          return legacy.ready
        },
        get catalogReady() {
          return legacy.catalogReady
        },
        canonical: {
          active: () => lifetime.active,
          enabled: controlled,
          meta: () => agent.current()?.id === "meta" && !locked(),
          locked,
          agent,
          model: canonicalModel("session"),
          executor: {
            agent: executorAgent,
            model: canonicalModel("executor"),
            preference: executorPreference,
            trackCommit(sessionID: string, value: SessionExecutorPreference) {
              return trackCanonical(sessionID, "executor", value.agent, preferenceKey(value))
            },
          },
          reconcile(sessionID: string) {
            reconcileSessionSelection(sessionID)
          },
        },
      }
    }

    const model = createModel()

    function createSession() {
      const [sessionStore, setSessionStore] = createStore<{
        ready: boolean
        pinned: string[]
      }>({
        ready: false,
        pinned: [],
      })

      const filePath = path.join(paths.state, "session.json")
      const state = {
        pending: false,
      }

      function save() {
        if (!sessionStore.ready) {
          state.pending = true
          return
        }
        state.pending = false
        void writeJsonAtomic(filePath, {
          pinned: sessionStore.pinned,
        })
      }

      readJson<unknown>(filePath)
        .then((x) => {
          if (!x || typeof x !== "object") return
          const pinned = (x as Record<string, unknown>).pinned
          if (Array.isArray(pinned))
            setSessionStore(
              "pinned",
              pinned.filter((item): item is string => typeof item === "string"),
            )
        })
        .catch(() => {})
        .finally(() => {
          setSessionStore("ready", true)
          if (state.pending) save()
        })

      const slots = createMemo(() => {
        const existing = new Set(
          data.session
            .list()
            .filter((x) => x.parentID === undefined)
            .map((x) => x.id),
        )
        return sessionStore.pinned.filter((id) => existing.has(id)).slice(0, 9)
      })

      function prune(sessionID: string) {
        batch(() => {
          if (sessionStore.pinned.includes(sessionID)) {
            setSessionStore(
              "pinned",
              sessionStore.pinned.filter((x) => x !== sessionID),
            )
          }
          save()
        })
      }

      event.on("session.deleted", (evt) => {
        prune(evt.data.sessionID)
      })

      return {
        get ready() {
          return sessionStore.ready
        },
        pinned() {
          return sessionStore.pinned
        },
        slots,
        isPinned(sessionID: string) {
          return sessionStore.pinned.includes(sessionID)
        },
        togglePin(sessionID: string) {
          batch(() => {
            const exists = sessionStore.pinned.includes(sessionID)
            const next = exists
              ? sessionStore.pinned.filter((x) => x !== sessionID)
              : [...sessionStore.pinned, sessionID]
            setSessionStore("pinned", next)
            save()
          })
        },
        quickSwitch(slot: number) {
          const target = slots()[slot - 1]
          if (!target) return
          if (route.data.type === "session" && route.data.sessionID === target) return
          route.navigate({ type: "session", sessionID: target })
        },
      }
    }

    const session = createSession()

    const result = {
      get model() {
        return model.canonical.enabled() ? model.canonical.model : model
      },
      agent,
      selection: model.canonical,
      executor: model.canonical.executor,
      meta: model.canonical.meta,
      locked: model.canonical.locked,
      session,
      permission,
    }
    return result
  },
})

export const useLocal = context.use
export const LocalProvider = context.provider

export function LocalModelProvider(props: ParentProps<{ domain: "session" | "executor" }>) {
  const local = useLocal()
  return (
    <context.context.Provider
      value={{ ...local, model: props.domain === "executor" ? local.executor.model : local.model }}
    >
      {props.children}
    </context.context.Provider>
  )
}
