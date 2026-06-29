import { createContext, createMemo, useContext, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"
import type { ServerConnection } from "@/context/server"

export const MODES = ["chat", "coding", "work", "assistant"] as const
export type Mode = (typeof MODES)[number]

type ModePlacement = { server: ServerConnection.Key; sessionId: string }
type ActiveSessionMap = Partial<Record<Mode, ModePlacement>>

type ModeContext = {
  currentMode: Mode
  setCurrentMode: (m: Mode) => void
  activeSessionId: (m: Mode) => () => ModePlacement | undefined
  setActiveSessionId: (m: Mode, p: ModePlacement) => void
  secondarySidebarOpen: boolean
  toggleSecondarySidebar: () => void
}

const Ctx = createContext<ModeContext>()

export function ModeProvider(props: ParentProps) {
  const [state, setState] = persisted(
    Persist.global("mode-view"),
    createStore({ currentMode: "coding" as Mode, activeSessionId: {} as ActiveSessionMap }),
  )

  const [secondaryOpen, setSecondaryOpen] = persisted(
    Persist.global("mode.secondarySidebarOpen"),
    createStore({ open: true }),
  )

  const activeSessionMemos: Partial<Record<Mode, () => ModePlacement | undefined>> = {}

  const ctx: ModeContext = {
    get currentMode() {
      return state.currentMode
    },
    setCurrentMode(m: Mode) {
      setState("currentMode", m)
    },
    activeSessionId(m: Mode) {
      const existing = activeSessionMemos[m]
      if (existing) return existing
      const memo = createMemo(() => state.activeSessionId[m])
      activeSessionMemos[m] = memo
      return memo
    },
    setActiveSessionId(m: Mode, p: ModePlacement) {
      setState("activeSessionId", m, p)
    },
    get secondarySidebarOpen() {
      return secondaryOpen.open
    },
    toggleSecondarySidebar() {
      setSecondaryOpen("open", (v) => !v)
    },
  }

  return <Ctx.Provider value={ctx}>{props.children}</Ctx.Provider>
}

export function useMode() {
  const value = useContext(Ctx)
  if (!value) throw new Error("useMode must be used within a ModeProvider")
  return value
}

export function tryUseMode() {
  return useContext(Ctx)
}
