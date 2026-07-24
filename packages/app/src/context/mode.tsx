import { createContext, useContext, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"
import { ProductModeAgentPolicy } from "@aigcfroge/core/product-mode-agent-policy"

export const MODE_DEFINITIONS = [
  {
    id: "chat",
    href: "/mode/chat",
    icon: "mode-chat",
    labelKey: "mode.chat",
    descriptionKey: "mode.chat.description",
    surface: "chat",
  },
  {
    id: "coding",
    href: "/mode/coding",
    icon: "mode-coding",
    labelKey: "mode.coding",
    descriptionKey: "mode.coding.description",
    surface: "coding",
  },
  {
    id: "work",
    href: "/mode/work",
    icon: "mode-work",
    labelKey: "mode.work",
    descriptionKey: "mode.work.description",
    surface: "work",
  },
  {
    id: "assistant",
    href: "/mode/assistant",
    icon: "mode-assistant",
    labelKey: "mode.assistant",
    descriptionKey: "mode.assistant.description",
    surface: "assistant",
  },
] as const

export type Mode = (typeof MODE_DEFINITIONS)[number]["id"]
export type ModeDefinition = (typeof MODE_DEFINITIONS)[number]
export type ModeSurfaceSlot = ModeDefinition["surface"]

export const BUILTIN_MODES: readonly Mode[] = MODE_DEFINITIONS.map((definition) => definition.id)

export function isMode(value: unknown): value is Mode {
  return BUILTIN_MODES.some((mode) => mode === value)
}

export function modeDefinition(mode: Mode) {
  const definition = MODE_DEFINITIONS.find((definition) => definition.id === mode)
  if (!definition) throw new Error(`Missing mode definition for ${mode}`)
  return definition
}

export function modeHref(mode: Mode) {
  return modeDefinition(mode).href
}

export function modeDraft(mode: Mode) {
  return {
    mode,
    agent: ProductModeAgentPolicy.resolvePrimaryAgent(mode),
  }
}

type ModeContext = {
  currentMode: Mode
  setCurrentMode: (mode: Mode) => void
  secondarySidebarOpen: boolean
  toggleSecondarySidebar: () => void
}

const Ctx = createContext<ModeContext>()

export function ModeProvider(props: ParentProps) {
  const [state, setState] = persisted(
    {
      ...Persist.global("mode-view"),
      migrate: (value: unknown) => {
        if (!value || typeof value !== "object") return { currentMode: "coding" as const }
        const currentMode = (value as { currentMode?: unknown }).currentMode
        return { currentMode: typeof currentMode === "string" && isMode(currentMode) ? currentMode : "coding" }
      },
    },
    createStore({ currentMode: "coding" as Mode }),
  )

  const [secondaryOpen, setSecondaryOpen] = persisted(
    Persist.global("mode.secondarySidebarOpen"),
    // ADR-15 §3 + M2 Step 3：默认次级左侧边栏关闭。Home 内部已承载 ChatSidebar / HomeProjectColumn
    // 作为主区左列；SecondarySidebar 默认收起，避免与 Home 左栏重复（M1 遗留双渲染）。
    // persisted 仅影响无存储值的新用户；已持久化偏好的用户不受影响。
    createStore({ open: false }),
  )

  const ctx: ModeContext = {
    get currentMode() {
      return state.currentMode
    },
    setCurrentMode(mode) {
      setState("currentMode", mode)
    },
    get secondarySidebarOpen() {
      return secondaryOpen.open
    },
    toggleSecondarySidebar() {
      setSecondaryOpen("open", (open) => !open)
    },
  }

  return <Ctx.Provider value={ctx}>{props.children}</Ctx.Provider>
}

export function useMode() {
  const value = useContext(Ctx)
  if (!value) throw new Error("useMode must be used within a ModeProvider")
  return value
}
