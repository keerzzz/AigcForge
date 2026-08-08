import { createContext, useContext, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"

/**
 * Work 会话详情页次级左栏当前选中的维度 Tab（批次 1 §3.3）。
 *
 * 持久化：用户上次退出时选择的 Tab 在下次进入 work 会话详情页时自动恢复。
 * 经 WorkSecondaryTabProvider 提供（persisted 需 usePlatform，须在组件树内）。
 * 默认 "trade"；未识别的持久化值回退 "trade"。
 */
export type WorkSecondaryTabID = "trade" | "taskSet" | "agent"

const TAB_IDS: readonly WorkSecondaryTabID[] = ["trade", "taskSet", "agent"]

function isWorkSecondaryTabID(value: unknown): value is WorkSecondaryTabID {
  return typeof value === "string" && (TAB_IDS as readonly string[]).includes(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

type WorkSecondaryTabContext = {
  selected: () => WorkSecondaryTabID
  set: (tab: WorkSecondaryTabID) => void
}

const Ctx = createContext<WorkSecondaryTabContext>()

export function WorkSecondaryTabProvider(props: ParentProps) {
  const [state, setState] = persisted(
    {
      ...Persist.global("mode.secondaryWorkTab", ["mode.secondaryWorkTab.v1"]),
      migrate: (value: unknown) => {
        if (!isRecord(value)) return { selected: "trade" as const }
        return { selected: isWorkSecondaryTabID(value.selected) ? value.selected : ("trade" as WorkSecondaryTabID) }
      },
    },
    createStore({ selected: "trade" as WorkSecondaryTabID }),
  )

  const ctx: WorkSecondaryTabContext = {
    selected: () => state.selected,
    set: (tab) => setState("selected", tab),
  }

  return <Ctx.Provider value={ctx}>{props.children}</Ctx.Provider>
}

export function useWorkSecondaryTab() {
  const value = useContext(Ctx)
  if (!value) throw new Error("useWorkSecondaryTab must be used within a WorkSecondaryTabProvider")
  return value
}
