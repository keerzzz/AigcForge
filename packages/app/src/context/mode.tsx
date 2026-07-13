import { createContext, useContext, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"

export const BUILTIN_MODES = ["chat", "coding", "work", "assistant"] as const
export type Mode = (typeof BUILTIN_MODES)[number]

export function isMode(value: unknown): value is Mode {
  return BUILTIN_MODES.some((mode) => mode === value)
}

export function modeHref(mode: Mode) {
  return `/mode/${mode}`
}

export type ModeConfig = {
  id: Mode
  labelKey: string
  descriptionKey: string
}

export const MODE_CONFIGS: ModeConfig[] = [
  { id: "chat", labelKey: "mode.chat", descriptionKey: "mode.chat.desc" },
  { id: "coding", labelKey: "mode.coding", descriptionKey: "mode.coding.desc" },
  { id: "work", labelKey: "mode.work", descriptionKey: "mode.work.desc" },
  { id: "assistant", labelKey: "mode.assistant", descriptionKey: "mode.assistant.desc" },
]

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
    createStore({ open: true }),
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
