import { describe, expect, test } from "bun:test"
import { computeWorkSidebarGroups, WORK_SIDEBAR_CATEGORY_ORDER } from "./work-sidebar-groups"
import type { WorkPreset } from "@aigcfroge/schema/work-preset"

const session = (id: string, presetCategoryId?: WorkPreset.Category) => ({
  id,
  ...(presetCategoryId ? { presetCategoryId } : {}),
})

describe("computeWorkSidebarGroups (Work sidebar trade dimension)", () => {
  test("groups sessions by the 4 canonical categories in canonical order", () => {
    const groups = computeWorkSidebarGroups([
      session("s-video", "video-creation"),
      session("s-it", "it-development"),
      session("s-academic", "academic"),
      session("s-office", "general-office"),
    ])

    expect([...groups.map((group) => group.category)]).toEqual([...WORK_SIDEBAR_CATEGORY_ORDER])
  })

  test("sessions without presetCategoryId fall into the uncategorized group", () => {
    const groups = computeWorkSidebarGroups([session("s-legacy"), session("s-it", "it-development")])

    const uncategorized = groups.find((group) => group.category === "uncategorized")
    expect(uncategorized?.sessions.map((item) => item.id)).toEqual(["s-legacy"])
    expect(uncategorized?.labelKey).toBe("work.sidebar.uncategorized")
  })

  test("uncategorized group sorts last after the 4 categories", () => {
    const groups = computeWorkSidebarGroups([
      session("s-legacy"),
      session("s-it", "it-development"),
      session("s-office", "general-office"),
    ])

    expect(groups.at(-1)?.category).toBe("uncategorized")
  })

  test("returns an empty array for no sessions", () => {
    expect(computeWorkSidebarGroups([])).toEqual([])
  })

  test("counts sessions per group", () => {
    const groups = computeWorkSidebarGroups([
      session("s-it-1", "it-development"),
      session("s-it-2", "it-development"),
      session("s-legacy"),
    ])

    expect(groups.find((group) => group.category === "it-development")?.sessions).toHaveLength(2)
    expect(groups.find((group) => group.category === "uncategorized")?.sessions).toHaveLength(1)
  })

  test("drops empty categories entirely", () => {
    const groups = computeWorkSidebarGroups([session("s-office", "general-office")])

    expect(groups.map((group) => group.category)).toEqual(["general-office"])
  })

  test("exposes per-category label keys for i18n", () => {
    const groups = computeWorkSidebarGroups([session("s-it", "it-development")])

    expect(groups[0]?.labelKey).toBe("work.preset.category.it-development")
  })
})
