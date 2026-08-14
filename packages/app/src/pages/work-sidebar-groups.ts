import { WorkPreset } from "@aigcfroge/schema/work-preset"

/** Work category groups: four preset categories plus uncategorized sessions. */
export const WORK_SIDEBAR_CATEGORY_ORDER: readonly WorkPreset.Category[] = [
  "it-development",
  "video-creation",
  "academic",
  "general-office",
]

export type WorkSidebarCategory = WorkPreset.Category | "uncategorized"

export type WorkSidebarGroupInput = {
  id: string
  presetCategoryId?: WorkPreset.Category
}

export type WorkSidebarGroup<T extends WorkSidebarGroupInput = WorkSidebarGroupInput> = {
  category: WorkSidebarCategory
  labelKey: string
  sessions: readonly T[]
}

const categoryLabelKey = (category: WorkPreset.Category) => `work.preset.category.${category}`

export function computeWorkSidebarGroups<T extends WorkSidebarGroupInput>(
  sessions: readonly T[],
): WorkSidebarGroup<T>[] {
  const byCategory = new Map<WorkSidebarCategory, T[]>()
  for (const session of sessions) {
    const category: WorkSidebarCategory = session.presetCategoryId ?? "uncategorized"
    const group = byCategory.get(category)
    if (group) group.push(session)
    else byCategory.set(category, [session])
  }
  const groups: WorkSidebarGroup<T>[] = []
  for (const category of WORK_SIDEBAR_CATEGORY_ORDER) {
    const sessionsInGroup = byCategory.get(category)
    if (sessionsInGroup?.length) {
      groups.push({ category, labelKey: categoryLabelKey(category), sessions: sessionsInGroup })
    }
  }
  const uncategorized = byCategory.get("uncategorized")
  if (uncategorized?.length) {
    groups.push({ category: "uncategorized", labelKey: "work.sidebar.uncategorized", sessions: uncategorized })
  }
  return groups
}
