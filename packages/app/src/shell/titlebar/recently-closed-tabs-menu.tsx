import { createMemo, For, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Icon } from "@omnixa/ui/icon"
import { IconButton } from "@omnixa/ui/icon-button"
import { Menu } from "@omnixa/ui/menu"
import { Tooltip } from "@omnixa/ui/tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal, useServerCtx } from "@/runtime/server/runtime"
import { SessionTabAvatarView } from "@/shell/layout/session-tab-avatar"
import { listClosedTabs, type ClosedTab } from "@/shell/tabs/closed"
import { useTabs } from "@/shell/tabs/tabs"
import { sessionTabTitle } from "./tab-title"

export function RecentlyClosedTabsMenu(props: { onNewTab: () => void; tooltip?: JSX.Element }) {
  const language = useLanguage()
  const tabs = useTabs()

  const recent = createMemo(() =>
    listClosedTabs(tabs.closed, tabs.store).filter((entry) => entry.info?.prompted === true),
  )

  return (
    <Menu.Context modal={false}>
      <Tooltip placement="bottom" value={props.tooltip}>
        <Menu.Context.Trigger
          as={IconButton}
          type="button"
          variant="ghost-muted"
          size="large"
          class="shrink-0"
          icon={<Icon name="plus" />}
          onClick={props.onNewTab}
          aria-label={language.t("command.session.new")}
        />
      </Tooltip>
      <Menu.Context.Portal>
        <Menu.Context.Content class="max-h-[66.667dvh] w-56 max-w-56 overflow-y-auto">
          <Menu.Group>
            <Menu.GroupLabel>{language.t("home.recentlyClosed")}</Menu.GroupLabel>
            <For each={recent()}>
              {(entry) => (
                <RecentlyClosedTabItem
                  entry={entry}
                  onSelect={() => tabs.reopenClosedTab(entry.tab, { append: true })}
                />
              )}
            </For>
          </Menu.Group>
        </Menu.Context.Content>
      </Menu.Context.Portal>
    </Menu.Context>
  )
}

function RecentlyClosedTabItem(props: { entry: ClosedTab; onSelect: () => void }) {
  const global = useGlobal()
  const language = useLanguage()
  const [state, setState] = createStore({ truncated: false })
  const placement = language.direction() === "rtl" ? "left-start" : "right-start"

  const serverCtx = useServerCtx(() =>
    global.servers.list().find((item) => ServerConnection.key(item) === props.entry.tab.server),
  )

  const session = createMemo(() => serverCtx()?.data.session.get(props.entry.tab.sessionId))
  const directory = () => props.entry.info?.directory ?? session()?.location.directory ?? ""

  const project = createMemo(() => {
    const value = session()

    if (value) return serverCtx()?.projects.forSession(value)

    if (!directory()) return

    return serverCtx()?.projects.resolve({ worktree: directory(), expanded: false })
  })

  const title = () => sessionTabTitle(session()?.title ?? props.entry.info?.title, language.t("session.tab.session"))

  return (
    <Menu.Item class="max-w-56" onSelect={props.onSelect}>
      <span class="flex size-4 shrink-0 items-center justify-center">
        <SessionTabAvatarView project={project()} directory={directory()} unread={false} loading={false} />
      </span>
      <Tooltip
        placement={placement}
        value={<bdi dir="auto">{title()}</bdi>}
        disabled={!state.truncated}
        class="min-w-0 flex-1"
        contentClass="max-w-[min(480px,calc(100vw-32px))] break-words"
      >
        <span
          ref={(element) =>
            createResizeObserver(element, () => setState("truncated", element.scrollWidth > element.clientWidth))
          }
          dir="auto"
          class="block min-w-0 truncate text-start"
        >
          {title()}
        </span>
      </Tooltip>
    </Menu.Item>
  )
}
