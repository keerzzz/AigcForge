import type { Accessor } from "solid-js"
import type { AssistantPanelTab } from "@/utils/assistant-panel"

export type { AssistantPanelState, AssistantPanelTab } from "@/utils/assistant-panel"

/** Session-scoped Assistant target exposed by the layout store. */
export type AssistantPanelHandle = {
  target: Accessor<string | undefined>
  setTarget: (target?: string) => void
}

/** Opens an Assistant entity tab: reveals the panel, activates the tab, targets an item. */
export function openEntityPanel(args: {
  view: { reviewPanel: { open: () => void } }
  tabs: { open: (tab: string) => void; setActive: (tab: string | undefined) => void }
  assistant: AssistantPanelHandle
  kind: AssistantPanelTab
  itemId?: string
}) {
  args.view.reviewPanel.open()
  args.assistant.setTarget(args.itemId)
  void args.tabs.open(args.kind)
  args.tabs.setActive(args.kind)
}
