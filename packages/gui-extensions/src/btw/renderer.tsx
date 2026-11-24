import { createMemo, lazy, onCleanup, Show, Suspense } from "solid-js"
import { Icon } from "@omnixa/ui/icon"
import { IconButton } from "@omnixa/ui/icon-button"
import { Tooltip } from "@omnixa/ui/tooltip"
import { showToast } from "@omnixa/ui/toast"
import { errorMessage } from "@omnixa/util/error"
import { Command, createKeyed, MenuItem, onIdle, Panel, Slot, type PanelTab, type Setup } from "../sdk"
import type Btw from "./index"
import { createBtw } from "./model"

const setup: Setup<typeof Btw> = (ctx) => {
  const SessionBtwPanel = lazy(() => import("./panel"))
  onCleanup(onIdle(() => void SessionBtwPanel.preload()))
  const btw = createBtw(ctx)
  const mounted = createMemo(() => !!ctx.sessions.current())
  const tabs = new Map<string, Map<string, PanelTab>>()

  const launcher: PanelTab = {
    id: "main",
    get title() {
      return ctx.t("list.title")
    },
    transient: true,
    closable: "hover",
    label: () => (
      <div class="flex min-w-0 items-center gap-1.5">
        <Icon name="bubble-5" size="small" />
        <span class="truncate">{ctx.t("list.title")}</span>
      </div>
    ),
  }

  // Sync chunk readiness with restored layouts; neither this nor tab restoration executes a Session.
  createKeyed(
    () => ctx.sessions.list().some((session) => ctx.layout.stored(session).length > 0),
    () => void SessionBtwPanel.preload(),
  )
  createKeyed(
    () => [...ctx.sessions.list().map((session) => session.key), ctx.sessions.current()?.key].join("\u0000"),
    () => {
      const keep = new Set([...ctx.sessions.list().map((session) => session.key), ctx.sessions.current()?.key])
      tabs.forEach((_cache, key) => {
        if (!keep.has(key)) tabs.delete(key)
      })
    },
  )

  const openList = () => {
    const session = ctx.sessions.current()

    if (session) ctx.layout.open(ctx.id + ":main", session)
  }

  ctx.add(
    Command,
    (): Command => ({
      id: "ask",
      title: ctx.t("command.title"),
      description: ctx.t("command.description"),
      group: ctx.t("command.category.session"),
      section: "session",
      slash: { name: "btw", arguments: true },
      hidden: true,
      enabled: mounted(),
      run: (input) => btw.ask(input),
    }),
  )
  ctx.add(
    Command,
    (): Command => ({
      id: "open",
      title: ctx.t("list.title"),
      group: ctx.t("command.category.session"),
      section: "session",
      bind: "mod+alt+b",
      enabled: mounted(),
      run: openList,
    }),
  )
  ctx.add(MenuItem, {
    id: "open",
    menu: "session.panel",
    get title() {
      return ctx.t("list.title")
    },
    icon: "bubble-5",
    keybind: "btw.open",
    run: openList,
  })

  ctx.add(Slot, {
    at: "session.response.actions",
    render(input) {
      return (
        <Show when={input.active && input.completed && input.boundary}>
          <Tooltip value={ctx.t("action.title")}>
            <IconButton
              size="small"
              variant="ghost-muted"
              icon={<Icon name="bubble-5" size="small" />}
              aria-label={ctx.t("action.title")}
              disabled={!input.session.server.connected}
              onClick={() => {
                const boundary = input.boundary ? { ...input.boundary } : undefined

                if (!input.active || !input.completed || !boundary) return
                // oxlint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: errorMessage checks the Promise rejection and produces display text.
                void btw.draft({ source: input.source, target: input.session, boundary }).catch((error: unknown) => {
                  if (!ctx.signal.aborted) showToast({ title: errorMessage(error, ctx.t("common.requestFailed")) })
                })
              }}
            />
          </Tooltip>
        </Show>
      )
    },
  })

  ctx.add(Panel, {
    id: "main",
    region: "side",
    transient: true,
    legacy: { btw: "main" },
    get mobile(): Panel["mobile"] {
      return { title: ctx.t("list.title"), kind: "menu", order: 55 }
    },
    list(input) {
      const saved = btw.saved(input.session)
      const cache = tabs.get(input.session.key) ?? new Map<string, PanelTab>()
      tabs.set(input.session.key, cache)

      return input.open.flatMap((id) => {
        if (id === "main") return [launcher]

        if (saved.ready() && !saved.value?.chats.some((chat) => chat.id === id)) return []
        const existing = cache.get(id)

        if (existing) return [existing]

        const tab: PanelTab = {
          id,
          get title() {
            const chat = saved.value?.chats.find((item) => item.id === id)
            const server = chat?.intent ? ctx.servers.get(chat.intent.serverID) : undefined

            return server?.data.session.get(chat?.intent?.targetID ?? "")?.title || chat?.question || ctx.t("tab.title")
          },
          get hidden() {
            return !saved.ready()
          },
          closable: "hover",
          fallback: true,
          dom: {
            tab: "session-btw-tab-" + encodeURIComponent(input.session.key) + "-" + id,
            panel: "session-btw-tabpanel-" + encodeURIComponent(input.session.key) + "-" + id,
          },
          label: (state) => (
            <div class="flex min-w-0 items-center gap-1.5">
              <Icon name="bubble-5" size="small" />
              <span class="truncate">{btw.title(state.session, id)}</span>
              <Show when={!state.active && btw.unread(state.session, id)}>
                <span
                  data-slot="session-btw-unread"
                  role="status"
                  aria-label={ctx.t("unread")}
                  class="size-1.5 shrink-0 rounded-full bg-v2-state-fg-accent"
                />
              </Show>
            </div>
          ),
        }

        cache.set(id, tab)

        return [tab]
      })
    },
    render: (props) => (
      <Suspense>
        <SessionBtwPanel btw={btw} session={props.session} screen={props.screen} id={props.tab.id} />
      </Suspense>
    ),
    focus: (input) => btw.markRead(input.session, input.tab.id),
    close(input) {
      btw.markRead(input.session, input.tab.id)
      tabs.get(input.session.key)?.delete(input.tab.id)
    },
  })
}

export default setup
