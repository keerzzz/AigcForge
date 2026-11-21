import { createContext, useContext, type ParentProps } from "solid-js"

// Header and status-bar hosts use the same controls and actions, with different available space.
const context = createContext<() => boolean>()

export function SessionControlsProvider(props: ParentProps<{ expanded: boolean }>) {
  return <context.Provider value={() => props.expanded}>{props.children}</context.Provider>
}

export function useSessionControlsExpanded() {
  return useContext(context) ?? (() => false)
}
