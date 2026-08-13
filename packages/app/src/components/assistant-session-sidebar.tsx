import { createMemo, For, Show, type Accessor } from "solid-js"
import { useParams } from "@solidjs/router"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { useLanguage } from "@/context/language"
import { ModeLocationNewSession } from "@/components/mode-location-new-session"
import { useServerSync } from "@/context/server-sync"
import { useServerSDK } from "@/context/server-sdk"
import { useLayout } from "@/context/layout"
import { SessionRouteKey, SessionStateKey } from "@/utils/server-scope"
import { sortedRootSessions } from "@/pages/layout/helpers"
import { SessionItem, SessionSkeleton } from "@/pages/layout/sidebar-items"
import { AssistantNavTree } from "@/components/assistant-nav-tree"
import { openEntityPanel } from "@/pages/session/assistant-session-panel-open"
import type { WorkspaceSidebarContext } from "@/pages/layout/sidebar-workspace"
import type { ServerConnection } from "@/context/server"
import type { AssistantNavSelection } from "@/components/assistant-nav-model"

/** Assistant session sidebar with mode-scoped sessions and entity navigation. */
export function AssistantSessionSidebar(props: {
  directory: Accessor<string>
  sortNow: Accessor<number>
  ctx: WorkspaceSidebarContext
  serverKey?: ServerConnection.Key
}) {
  const language = useLanguage()
  const sync = useServerSync()
  const params = useParams()
  const serverSDK = useServerSDK()
  const layout = useLayout()
  // This shell renders outside SDKProvider, so derive the same scoped key that
  // useSessionLayout would create from its directory SDK context.
  const sessionKey = createMemo(() =>
    SessionStateKey.from(serverSDK().scope, SessionRouteKey.fromRoute(base64Encode(props.directory()), params.id)),
  )
  const assistant = createMemo(() => layout.assistant(sessionKey))

  const store = createMemo(() => {
    const directory = props.directory()
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
    const tab = assistant().tab()
    const target = assistant().target()
    if (tab === "reminders" || tab === "memory" || tab === "kb") {
      return target ? { kind: tab, itemId: target } : { kind: tab }
    }
    if (tab === "context") return undefined
    return undefined
  })

  const onSelect = (next: AssistantNavSelection) => {
    const handle = assistant()
    if (!next) {
      handle.close()
      return
    }
    if (next.kind === "reminders" || next.kind === "memory" || next.kind === "kb") {
      openEntityPanel(handle, next.kind, next.itemId)
      return
    }
    openEntityPanel(handle, "kb")
  }

  return (
    <div class="flex min-h-0 flex-1 flex-col" data-component="assistant-session-sidebar">
      <ModeLocationNewSession directory={props.directory} mode="assistant" />
      <div class="px-3 pb-1 pt-2 text-v2-text-text-muted text-11-regular [font-weight:440]">
        {language.t("assistant.nav.sessions")}
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-2">
        <Show when={store()?.status !== "loading"} fallback={<SessionSkeleton />}>
          <Show
            when={sessions().length > 0}
            fallback={
              <p class="px-1 py-2 text-v2-text-text-muted text-12-regular">{language.t("assistant.nav.sessionsEmpty")}</p>
            }
          >
            <div class="flex min-w-0 flex-col gap-px">
              <For each={sessions()}>
                {(session) => (
                  <SessionItem
                    session={session}
                    list={sessions()}
                    navList={props.ctx.navList}
                    slug={base64Encode(props.directory())}
                    serverKey={props.serverKey}
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
      {/* Keep a large knowledge tree from collapsing the session list. */}
      <div
        class="min-h-0 shrink-0 overflow-y-auto border-t border-v2-border-border-base py-1"
        style={{ "max-height": "45%" }}
      >
        <AssistantNavTree selected={selected()} onSelect={onSelect} />
      </div>
    </div>
  )
}
