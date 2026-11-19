import { createMemo, createSignal } from "solid-js"
import { LocalModelProvider, useLocal } from "../context/local"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { DialogIntegration } from "./dialog-integration"
import { DialogVariant } from "./dialog-variant"
import fuzzysort from "fuzzysort"
import { useConnected } from "./use-connected"
import { useData } from "../context/data"
import { isModelGroup, modelPreferenceKey, type ModelPreferenceModel } from "../model-preference"
import { useLocation } from "../context/location"

export function DialogModel(props: { providerID?: string; domain?: "session" | "executor" }) {
  return (
    <LocalModelProvider domain={props.domain ?? "session"}>
      <DialogModelContent {...props} />
    </LocalModelProvider>
  )
}

function DialogModelContent(props: { providerID?: string; domain?: "session" | "executor" }) {
  const local = useLocal()
  const data = useData()
  const dialog = useDialog()
  const location = useLocation()
  const [query, setQuery] = createSignal("")
  const favoritePriority = new Set(local.model.favorite().map(modelPreferenceKey))

  const connected = useConnected()
  const providers = createMemo(
    () => new Map((data.location.provider.list(location.ref) ?? []).map((item) => [item.id, item])),
  )
  const models = createMemo(() => data.location.model.list(location.ref) ?? [])
  const groups = createMemo(() => data.location.model.group.definition.list(location.ref)?.effective ?? [])

  const showExtra = createMemo(() => connected() && !props.providerID)

  const options = createMemo(() => {
    const needle = query().trim()
    const showSections = showExtra() && needle.length === 0
    const favorites = connected() ? local.model.favorite() : []
    const recents = local.model.recent()

    function toOptions(items: typeof favorites, category: string) {
      if (!showSections) return []
      return items.flatMap<DialogSelectOption<ModelPreferenceModel>>((item) => {
        if (isModelGroup(item)) {
          const group = groups().find(
            (group) => group.groupID === item.groupID && !group.unavailable && group.definition,
          )
          if (!group) return []
          return [
            {
              value: item,
              title: group.definition?.name ?? item.groupID,
              description: "Model group",
              category,
              onSelect: () => onSelect(item),
            },
          ]
        }
        const model = models().find((model) => model.providerID === item.providerID && model.id === item.modelID)
        if (!model) return []
        const provider = providers().get(model.providerID)
        return [
          {
            key: item,
            value: { providerID: model.providerID, modelID: model.id },
            title: model.name,
            releaseDate: model.time.released,
            description: provider?.name ?? model.providerID,
            category,
            footer: free(model) ? "Free" : undefined,
            onSelect: () => {
              onSelect({ providerID: model.providerID, modelID: model.id })
            },
          },
        ]
      })
    }

    const favoriteOptions = toOptions(favorites, "Favorites")
    const recentOptions = toOptions(
      recents.filter((item) => !favorites.some((fav) => modelPreferenceKey(fav) === modelPreferenceKey(item))),
      "Recent",
    )

    const modelOptions = sortModelOptions(
      models()
        .filter((model) => model.status !== "deprecated")
        .filter((model) => (props.providerID ? model.providerID === props.providerID : true))
        .map((model) => {
          const provider = providers().get(model.providerID)
          const key = modelPreferenceKey({ providerID: model.providerID, modelID: model.id })
          const favorite = favorites.some((item) => modelPreferenceKey(item) === key)
          return {
            value: { providerID: model.providerID, modelID: model.id },
            providerID: model.providerID,
            providerName: provider?.name ?? model.providerID,
            title: model.name,
            releaseDate: model.time.released,
            description: favorite ? "(Favorite)" : undefined,
            category: connected() ? (provider?.name ?? model.providerID) : undefined,
            footer: free(model) ? "Free" : undefined,
            onSelect() {
              onSelect({ providerID: model.providerID, modelID: model.id })
            },
          }
        })
        .filter((option) => {
          if (!showSections) return true
          if (favorites.some((item) => modelPreferenceKey(item) === modelPreferenceKey(option.value))) return false
          if (recents.some((item) => modelPreferenceKey(item) === modelPreferenceKey(option.value))) return false
          return true
        }),
      connected(),
    )

    const groupOptions = props.providerID
      ? []
      : groups().flatMap((group) => {
          if (group.unavailable || !group.definition) return []
          const value: ModelPreferenceModel = { type: "group", groupID: group.groupID }
          if (
            showSections &&
            [...favorites, ...recents].some((item) => modelPreferenceKey(item) === modelPreferenceKey(value))
          )
            return []
          return [
            {
              value,
              title: group.definition.name,
              category: "Model groups",
              description: `${group.definition.members.length} members`,
              onSelect: () => onSelect(value),
            },
          ]
        })
    const choices = [...modelOptions, ...groupOptions]

    if (needle) {
      return prioritizeFavorites(
        sortModelOptions(
          fuzzysort.go(needle, choices, { keys: ["title", "category"] }).map((item) => item.obj),
          false,
        ),
        favoritePriority,
      )
    }

    return [...favoriteOptions, ...recentOptions, ...choices]
  })

  const provider = createMemo(() => (props.providerID ? providers().get(props.providerID) : undefined))

  const title = createMemo(() => {
    const value = provider()
    if (!value) return props.domain === "executor" ? "Select executor model" : "Select model"
    return value.name
  })

  function onSelect(model: ModelPreferenceModel) {
    local.model.set(model, { recent: true })
    const list = local.model.variant.list()
    const cur = local.model.variant.current()
    if (props.domain !== "executor" && cur && list.includes(cur)) {
      dialog.clear()
      return
    }
    if (list.length > 0) {
      dialog.replace(() => (
        <LocalModelProvider domain={props.domain ?? "session"}>
          <DialogVariant />
        </LocalModelProvider>
      ))
      return
    }
    dialog.clear()
  }

  return (
    <DialogSelect<ReturnType<typeof options>[number]["value"]>
      options={options()}
      actions={[
        {
          command: "model.dialog.provider",
          title: connected() ? "Connect an integration" : "View all integrations",
          selection: "none",
          onTrigger() {
            dialog.replace(() => (
              <DialogIntegration
                onConnected={(providerID) =>
                  dialog.replace(() => <DialogModel providerID={providerID} domain={props.domain} />)
                }
              />
            ))
          },
        },
        {
          command: "model.dialog.favorite",
          title: "Favorite",
          hidden: !connected(),
          onTrigger: (option) => {
            local.model.toggleFavorite(option.value)
          },
        },
      ]}
      onFilter={setQuery}
      flat={true}
      skipFilter={true}
      title={title()}
      current={local.model.current()}
      focusCurrent={false}
    />
  )
}

export function prioritizeFavorites<T extends { value: ModelPreferenceModel }>(options: T[], favorites: Set<string>) {
  return options.toSorted(
    (a, b) => Number(favorites.has(modelPreferenceKey(b.value))) - Number(favorites.has(modelPreferenceKey(a.value))),
  )
}

export function sortModelOptions<
  T extends {
    providerID?: string
    providerName?: string
    releaseDate?: string | number
    title: string
    footer?: string
  },
>(options: T[], grouped = true) {
  return options.toSorted((a, b) => {
    const provider = grouped
      ? Number(b.providerID === "aigcfroge-go") - Number(a.providerID === "aigcfroge-go") ||
        Number(b.providerID === "aigcfroge") - Number(a.providerID === "aigcfroge")
      : 0
    if (provider !== 0) return provider

    const name = grouped ? (a.providerName ?? "").localeCompare(b.providerName ?? "") : 0
    if (name !== 0) return name

    const free = Number(b.footer === "Free") - Number(a.footer === "Free")
    if (free !== 0) return free

    const release = Number(b.releaseDate ?? 0) - Number(a.releaseDate ?? 0)
    if (release !== 0) return release

    return a.title.localeCompare(b.title)
  })
}

function free(model: { cost: Array<{ input: number }> }) {
  return model.cost.length > 0 && model.cost.every((cost) => cost.input === 0)
}
