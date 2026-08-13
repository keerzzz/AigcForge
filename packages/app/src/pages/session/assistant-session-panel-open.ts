import type { Accessor } from "solid-js"
import type { AssistantPanelTab } from "@/utils/assistant-panel"

export type { AssistantPanelState, AssistantPanelTab } from "@/utils/assistant-panel"

/** Session-scoped Assistant panel state exposed by the layout store. */
export type AssistantPanelHandle = {
  opened: Accessor<boolean>
  tab: Accessor<AssistantPanelTab>
  target: Accessor<string | undefined>
  open: (tab: AssistantPanelTab, target?: string) => void
  close: () => void
}

/** Opens an Assistant panel tab and optionally targets one entity. */
export function openEntityPanel(handle: AssistantPanelHandle, kind: AssistantPanelTab, itemId?: string) {
  handle.open(kind, itemId)
}

/** Closes the active tab or opens the requested tab. */
export function toggleEntityPanel(handle: AssistantPanelHandle, kind: AssistantPanelTab) {
  if (handle.opened() && handle.tab() === kind) {
    handle.close()
    return
  }
  handle.open(kind)
}
