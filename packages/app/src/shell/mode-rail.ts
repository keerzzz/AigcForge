import { Schema } from "effect"
import { type IconName, isIconName } from "@omnixa/ui/icons/catalog"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { uuid } from "@/runtime/persistence/uuid"

export const CUSTOM_MODE_ICON_POOL = [
  "flask",
  "globe",
  "branch-out",
  "workspace-isolated",
  "graduation-cap",
  "window-analytics",
  "code-slash",
  "review",
  "monitor",
  "archive",
  "folder",
  "outline-sliders",
] as const satisfies readonly IconName[]

export const CustomRailModeSchema = Persistence.struct({
  id: Schema.String,
  label: Schema.String,
  icon: Schema.String,
})

export const ModeRailStateSchema = Persistence.struct({
  items: Persistence.array(CustomRailModeSchema),
})

export type CustomRailMode = typeof CustomRailModeSchema.Type

export function resolveRailIcon(name: string): IconName {
  return isIconName(name) ? name : CUSTOM_MODE_ICON_POOL[0]
}

export function nextCycleIcon(used: readonly IconName[]): IconName {
  const taken = new Set<IconName>(used)
  const unused = CUSTOM_MODE_ICON_POOL.find((icon) => !taken.has(icon))
  if (unused) return unused
  return CUSTOM_MODE_ICON_POOL[used.length % CUSTOM_MODE_ICON_POOL.length]
}

export function customModeHref(id: string, options?: { compose?: boolean }) {
  const params = new URLSearchParams({ rail: id })
  if (options?.compose) params.set("tab", "compose")
  return `/mode/custom?${params.toString()}`
}

export function activeRailModeID(search: string) {
  const value = new URLSearchParams(search).get("rail")?.trim()
  return value ? value : undefined
}

export function useModeRail() {
  const [store, setStore] = persisted(Persist.global("mode.rail"), ModeRailStateSchema, { items: [] })

  const items = () => store.items

  const addMode = (input: { label: string; icon?: IconName }) => {
    const label = input.label.trim()
    if (!label) return undefined
    const used = store.items.map((item) => resolveRailIcon(item.icon))
    const entry: CustomRailMode = {
      id: uuid(),
      label,
      icon: input.icon ?? nextCycleIcon(used),
    }
    setStore("items", [...store.items, entry])
    return entry
  }

  const updateModeIcon = (id: string, icon: IconName) => {
    setStore(
      "items",
      store.items.map((item) => (item.id === id ? { ...item, icon } : item)),
    )
  }

  const removeMode = (id: string) => {
    setStore(
      "items",
      store.items.filter((item) => item.id !== id),
    )
  }

  return {
    items,
    addMode,
    updateModeIcon,
    removeMode,
  }
}
