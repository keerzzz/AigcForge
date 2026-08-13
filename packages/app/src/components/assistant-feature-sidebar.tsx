import { createMemo, Show } from "solid-js"
import { useQuery } from "@tanstack/solid-query"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useChatDirectory } from "@/pages/mode-workspace-context"
import { ModeLocationNewSession } from "@/components/mode-location-new-session"

/**
 * Assistant 次级左栏（计划 §3.9.1c）：共享 Location 模块 + 提醒/记忆/知识库
 * 概览树（Phase B 先落地提醒计数，Phase C/D 增加记忆与知识库分类）。
 */
export function AssistantSidebar() {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const { directory } = useChatDirectory()

  const pendingQuery = useQuery(() => ({
    queryKey: ["assistant", "pending"] as const,
    queryFn: async () => {
      const res = await serverSDK().client.schedule.pending()
      return res.data ?? []
    },
  }))
  const pendingCount = createMemo(() => pendingQuery.data?.length ?? 0)

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <ModeLocationNewSession directory={directory} mode="assistant" />
      <div class="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <div class="flex flex-col gap-2 px-3">
          <div class="flex min-w-0 items-center gap-1.5">
            <Icon name="mode-assistant" size="small" class="shrink-0 text-v2-icon-icon-muted" />
            <span class="min-w-0 flex-1 truncate text-v2-text-text-base text-12-medium">
              {language.t("assistant.dashboard.reminders")}
            </span>
            <ShowBadge count={pendingCount()} />
          </div>
          <Show when={pendingCount() === 0}>
            <p class="text-v2-text-text-muted text-11-regular">{language.t("assistant.dashboard.reminders.empty")}</p>
          </Show>
        </div>
      </div>
    </div>
  )
}

function ShowBadge(props: { count: number }) {
  if (props.count === 0) return null
  return (
    <span class="shrink-0 rounded-full bg-v2-background-bg-deep px-1.5 py-0.5 text-v2-text-text-muted text-10-regular">
      {props.count > 99 ? "99+" : String(props.count)}
    </span>
  )
}
