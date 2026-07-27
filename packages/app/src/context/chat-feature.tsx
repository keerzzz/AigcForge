import { createContext, useContext, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"

/**
 * Chat 模式功能树当前选中的功能分类（m1 §1.4 + M2 Step 3 复活）。
 *
 * 持久化：用户上次退出的选择在下次进入 chat 首页时自动恢复（产品需求）。
 * 经 ChatFeatureProvider 提供（persisted 需 usePlatform，须在组件树内）。
 * 默认 "prompt"；未识别的持久化值回退 "prompt"。
 */
export type ChatFeatureID = "prompt" | "skill" | "mcp" | "command" | "agent" | "workflow" | "plugin"

const FEATURE_IDS: readonly ChatFeatureID[] = ["prompt", "skill", "mcp", "command", "agent", "workflow", "plugin"]

function isChatFeatureID(value: unknown): value is ChatFeatureID {
  return typeof value === "string" && (FEATURE_IDS as readonly string[]).includes(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

type ChatFeatureContext = {
  selected: () => ChatFeatureID
  set: (feature: ChatFeatureID) => void
}

const Ctx = createContext<ChatFeatureContext>()

export function ChatFeatureProvider(props: ParentProps) {
  const [state, setState] = persisted(
    {
      ...Persist.global("chat.feature", ["chat.feature.v1"]),
      migrate: (value: unknown) => {
        if (!isRecord(value)) return { selected: "prompt" as const }
        return { selected: isChatFeatureID(value.selected) ? value.selected : ("prompt" as ChatFeatureID) }
      },
    },
    createStore({ selected: "prompt" as ChatFeatureID }),
  )

  const ctx: ChatFeatureContext = {
    selected: () => state.selected,
    set: (feature) => setState("selected", feature),
  }

  return <Ctx.Provider value={ctx}>{props.children}</Ctx.Provider>
}

export function useChatFeature() {
  const value = useContext(Ctx)
  if (!value) throw new Error("useChatFeature must be used within a ChatFeatureProvider")
  return value
}
