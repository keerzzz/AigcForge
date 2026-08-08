import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"

// 批次 1 §8.1 WorkSecondarySidebar 组件契约。App 无 solid-testing-library
// （agent-task-hub.test.tsx 先例），此测试校验源码级 wiring 契约；
// 纯函数分组逻辑由 work-sidebar-groups.test.ts 行为覆盖。

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), "utf-8")
const component = read("work-secondary-sidebar.tsx")

describe("WorkSecondarySidebar (work secondary sidebar, batch 1)", () => {
  test("exports the WorkSecondarySidebar component", () => {
    expect(component).toContain("export function WorkSecondarySidebar")
  })

  test("uses kobalte TabsV2 for the dimension tabs (WAI-ARIA tablist)", () => {
    expect(component).toContain("<TabsV2")
    expect(component).toContain("TabsV2.List")
    expect(component).toContain("TabsV2.Trigger")
  })

  test("persists the selected tab through the work-secondary-tab context", () => {
    expect(component).toContain("useWorkSecondaryTab()")
    expect(component).toContain(".set(")
  })

  test("groups sessions with computeWorkSidebarGroups", () => {
    expect(component).toContain("computeWorkSidebarGroups")
  })

  test("reuses SessionItem for session rows", () => {
    expect(component).toContain("<SessionItem")
    expect(component).toContain('from "@/pages/layout/sidebar-items"')
  })

  test("filters the session list to work mode", () => {
    expect(component).toContain('=== "work"')
    expect(component).toContain("sortedRootSessions")
  })

  test("renders the task-set and agent tab empty states with i18n keys", () => {
    expect(component).toContain('language.t("work.sidebar.taskSet.empty")')
    expect(component).toContain('language.t("work.sidebar.agent.empty")')
  })

  test("renders the empty-session guidance with the i18n key", () => {
    expect(component).toContain('language.t("work.sidebar.empty")')
  })

  test("shows the cross-mode indicator when the routed session is not work", () => {
    expect(component).toContain('sessionMode() !== "work"')
    expect(component).toContain('language.t("work.sidebar.modeMismatch"')
  })

  test("keeps the tab labels behind i18n keys", () => {
    expect(component).toContain('language.t("work.sidebar.tab.trade")')
    expect(component).toContain('language.t("work.sidebar.tab.taskSet")')
    expect(component).toContain('language.t("work.sidebar.tab.agent")')
  })

  test("keeps group headers dense text (no card wrapper)", () => {
    expect(component).not.toContain('data-component="work-group-card"')
    expect(component).toContain("text-v2-text-text-muted")
  })

  test("shows a skeleton loading state without collapsing the layout", () => {
    expect(component).toContain("SessionSkeleton")
  })
})
