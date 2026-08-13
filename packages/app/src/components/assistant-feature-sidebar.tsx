import { createMemo } from "solid-js"
import { useModeDirectory } from "@/pages/mode-workspace-context"
import { ModeLocationNewSession } from "@/components/mode-location-new-session"
import { AssistantNavTree } from "@/components/assistant-nav-tree"
import { useAssistantSelection } from "@/pages/mode-workspace-context"
import type { AssistantNavSelection } from "@/components/assistant-nav-model"

/** Assistant home sidebar with location, new-session, and entity navigation. */
export function AssistantSidebar() {
  const { directory } = useModeDirectory()
  const { selection, select } = useAssistantSelection()

  const onSelect = (next: AssistantNavSelection) => {
    if (
      next &&
      next.kind !== "dangling" &&
      next.kind === selection?.kind &&
      next.itemId === selection?.itemId
    ) {
      select(undefined)
      return
    }
    select(next)
  }

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <ModeLocationNewSession directory={directory} mode="assistant" />
      <div class="min-h-0 flex-1 overflow-y-auto py-2">
        <AssistantNavTree selected={selection} onSelect={onSelect} />
      </div>
    </div>
  )
}
