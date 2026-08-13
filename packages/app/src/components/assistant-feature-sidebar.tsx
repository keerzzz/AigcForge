import { createMemo } from "solid-js"
import { useChatDirectory } from "@/pages/mode-workspace-context"
import { ModeLocationNewSession } from "@/components/mode-location-new-session"
import { AssistantNavTree } from "@/components/assistant-nav-tree"
import { useAssistantSelection } from "@/pages/mode-workspace-context"
import type { AssistantNavSelection } from "@/components/assistant-nav-model"

/**
 * Assistant 首页左栏（PRD §8.1）：Location + 新建 + 实体导航树
 * （提醒/记忆/知识库分类 + 计数）。导航树选中态写入 AssistantSelectionCtx，
 * 主区会话列表联动（提醒/记忆高亮来源会话，知识库退化为全量）。
 */
export function AssistantSidebar() {
  const { directory } = useChatDirectory()
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
