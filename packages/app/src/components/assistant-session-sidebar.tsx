import { createMemo, For, Show, type Accessor } from "solid-js"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { useLanguage } from "@/context/language"
import { ModeLocationNewSession } from "@/components/mode-location-new-session"
import { useServerSync } from "@/context/server-sync"
import type { SessionContribution } from "@/context/route-contribution"
import { sortedRootSessions } from "@/pages/layout/helpers"
import { SessionItem, SessionSkeleton } from "@/pages/layout/sidebar-items"
import { AssistantNavTree } from "@/components/assistant-nav-tree"
import type { WorkspaceSidebarContext } from "@/pages/layout/sidebar-workspace"
import type { AssistantNavSelection } from "@/components/assistant-nav-model"

/** Assistant session sidebar with mode-scoped sessions and entity navigation. */
export function AssistantSessionSidebar(props: {
  target: Accessor<SessionContribution>
  sortNow: Accessor<number>
  ctx: WorkspaceSidebarContext
}) {
  const language = useLanguage()
  const sync = useServerSync()
  // The shell and canonical Session intentionally have separate Layout owners.
  // Selection and mutations therefore come from the Session's published handle.
  const panel = () => props.target().assistantPanel

  const store = createMemo(() => {
    const directory = props.target().directory
    if (!directory) return undefined
    return sync().child(directory, { bootstrap: false })[0]
  })

  const sessions = createMemo(() => {
    const current = store()
    if (!current) return []
    return sortedRootSessions(current, props.sortNow()).filter((session) => (session.mode ?? "coding") === "assistant")
  })

  // Entity tabs map to navigation selections; context and editor have no tree node.
  const selected = createMemo<AssistantNavSelection>(() => {
    const active = panel().active()
    const target = panel().target()
    if (active === "reminders" || active === "memory" || active === "kb") {
      return target ? { kind: active, itemId: target } : { kind: active }
    }
    return undefined
  })

  const onSelect = (next: AssistantNavSelection) => {
    if (!next) return
    if (next.kind === "reminders" || next.kind === "memory" || next.kind === "kb") {
      panel().open(next.kind, next.itemId)
      return
    }
    panel().open("kb")
  }

  return (
    <div class="flex min-h-0 flex-1 flex-col" data-component="assistant-session-sidebar">
      <ModeLocationNewSession
        directory={() => props.target().directory}
        server={() => props.target().server}
        mode="assistant"
      />
      {/* Entity navigation module sits above the session list, capped so a large
          knowledge tree cannot collapse the conversations below. */}
      <div
        class="min-h-0 shrink-0 overflow-y-auto border-b border-v2-border-border-base py-1"
        style={{ "max-height": "45%" }}
      >
        <AssistantNavTree selected={selected()} onSelect={onSelect} />
      </div>
      <div class="px-3 pb-1 pt-2 text-v2-text-text-muted text-11-regular [font-weight:440]">
        {language.t("assistant.nav.sessions")}
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-2">
        <Show when={store()?.status !== "loading"} fallback={<SessionSkeleton />}>
          <Show
            when={sessions().length > 0}
            fallback={
              <p class="px-1 py-2 text-v2-text-text-muted text-12-regular">
                {language.t("assistant.nav.sessionsEmpty")}
              </p>
            }
          >
            <div class="flex min-w-0 flex-col gap-px">
              <For each={sessions()}>
                {(session) => (
                  <SessionItem
                    session={session}
                    list={sessions()}
                    navList={sessions}
                    slug={base64Encode(props.target().directory)}
                    serverKey={props.target().server}
                    status={props.target().sessionStatus}
                    sidebarExpanded={props.ctx.sidebarExpanded}
                    clearHoverProjectSoon={props.ctx.clearHoverProjectSoon}
                    prefetchSession={props.ctx.prefetchSession}
                    archiveSession={props.ctx.archiveSession}
                  />
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  )
}
