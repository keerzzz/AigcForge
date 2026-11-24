import { showToast } from "@omnixa/ui/toast"
import { Icon } from "@omnixa/ui/icon"
import { createMemo, createSignal, getOwner, lazy, onCleanup, runWithOwner, Show, Suspense } from "solid-js"
import {
  Command,
  createKeyed,
  LinkHandler,
  MenuItem,
  onIdle,
  Panel,
  SettingsPage,
  Style,
  type PanelTab,
  type Setup,
} from "../sdk"
import { Browser } from "./contract"
import type definition from "./index"
import type { Model } from "./model"
import { PageIcon } from "./page-icon"
import barStyles from "./bar.css?inline"
import commentStyles from "./comment.css?inline"
import tabStyles from "./tabs.css?inline"

const setup: Setup<typeof definition> = (ctx) => {
  const sessions = ctx.sessions
  const visible = () => ctx.stores.display.value.visible

  const showHidden = () => {
    showToast({
      title: ctx.t("settings.display.hidden"),
      actions: [{ label: ctx.t("settings.display.restore"), onClick: () => ctx.layout.settings("general") }],
    })
  }

  const DisplayRow = lazy(() => import("./display"))
  onCleanup(onIdle(() => void DisplayRow.preload()))
  ctx.add(SettingsPage, {
    id: "display",
    page: "general",
    section: "general",
    get title() {
      return ctx.t("settings.display.title")
    },
    get entries() {
      return [
        { id: "settings-browser-display", title: ctx.t("settings.display.title"), keywords: "browser sidebar panel" },
      ]
    },
    render: () => (
      <Suspense>
        <DisplayRow />
      </Suspense>
    ),
  })

  if (ctx.build.platform !== "desktop") {
    const key = `${ctx.id}:web`

    const tab: PanelTab = {
      id: "web",
      get title() {
        return ctx.t("tab.title")
      },
      label: () => (
        <div class="flex min-w-0 items-center gap-1.5">
          <PageIcon icon={undefined} />
          <span class="truncate">{ctx.t("tab.title")}</span>
        </div>
      ),
      group: "browser",
      dom: { tab: "session-side-panel-browser-tab-web", panel: "session-side-panel-browser-tabpanel" },
    }

    const open = () => {
      const session = sessions.current()

      if (session) ctx.layout.open(key, session, { tab: "select" })
    }

    ctx.add(Command, (): Command | undefined => {
      if (!visible() || !sessions.current()) return undefined

      return {
        id: "open",
        title: ctx.t("command.open"),
        group: ctx.t("command.category.view"),
        bind: "mod+shift+b",
        run: open,
      }
    })
    ctx.add(MenuItem, (): MenuItem | undefined => {
      if (!visible() || !sessions.current()) return undefined

      return {
        menu: "session.panel",
        id: "open",
        title: ctx.t("tab.title"),
        icon: "outline-globe",
        keybind: "browser.open",
        order: 20,
        run: open,
      }
    })
    createKeyed(visible, () => {
      ctx.add(Panel, {
        id: "web",
        region: "side",
        mobile: {
          get title() {
            return ctx.t("tab.title")
          },
          order: 30,
          kind: "menu",
          icon: "outline-globe",
        },
        list: (input) => (input.open.includes(tab.id) ? [tab] : []),
        render: () => (
          <aside
            id="browser-panel"
            class="relative flex size-full min-w-0 flex-col overflow-hidden bg-v2-background-bg-base"
          >
            <div class="flex h-full flex-col items-center justify-center gap-4 px-6 py-12 text-center">
              <Icon name="outline-globe" size="large" class="text-v2-icon-icon-muted" />
              <h2 class="text-14-medium text-v2-text-text-base">{ctx.t("tab.title")}</h2>
              <p class="text-12-regular text-v2-text-text-muted">{ctx.t("web.desktop")}</p>
            </div>
          </aside>
        ),
      })
    })

    return
  }

  const [model, setModel] = createSignal<Model>()
  // Settings > Shortcuts lists the command while the native pane loads.
  ctx.add(Command, (): Command | undefined => {
    if (!visible()) return undefined
    const view = sessions.current()

    if (!view) return undefined
    const value = model()

    return {
      id: "open",
      title: ctx.t("command.open"),
      group: ctx.t("command.category.view"),
      bind: "mod+shift+b",
      enabled: !!value?.available(view),
      run: () => value?.open(view),
    }
  })

  // Tab trigger styles render with the strip, before the pane chunk loads.
  ctx.add(Style, tabStyles)
  ctx.add(Style, commentStyles)
  ctx.add(Style, barStyles)
  // Everything here serves a mounted session, so the attachment model and the pane's protocol
  // schemas load when the first session opens instead of at startup.
  const opened = createMemo((seen: boolean) => seen || !!sessions.current(), false)
  createKeyed(opened, () => {
    const owner = getOwner()
    void import("./model").then((module) => {
      if (ctx.signal.aborted) return
      const created = runWithOwner(owner, () => module.createModel(ctx))
      setModel(() => created)
    })
  })

  ctx.provide(Browser, {
    attached: (session) => model()?.attached(session) ?? false,
    canOpen: (session, path) => visible() && (model()?.canOpen(session, path) ?? false),
    open: (session, url) => {
      if (!visible()) return showHidden()
      model()?.openURL(session, url)
    },
    openFile: (session, path) => {
      if (!visible()) return showHidden()
      model()?.openFile(session, path)
    },
  })

  ctx.add(Command, (): Command | undefined => {
    if (!visible()) return undefined
    const pane = model()?.pane()

    if (!pane) return undefined

    return {
      id: "reload",
      title: ctx.t("command.reload"),
      group: ctx.t("command.category.view"),
      bind: "f5",
      editable: true,
      enabled: pane.visible() && !!pane.address(),
      run: pane.reload,
    }
  })

  // The system browser's address shortcut. While the page has focus, the page claims it and main forwards it; here it
  // covers focus elsewhere in the pane. Ctrl+L focuses the composer outside the pane on Windows and Linux.
  ctx.add(Command, (): Command | undefined => {
    if (!visible()) return undefined
    const pane = model()?.pane()

    if (!pane) return undefined

    return {
      id: "address",
      title: ctx.t("command.address"),
      group: ctx.t("command.category.view"),
      bind: "mod+l",
      scope: "#browser-panel",
      editable: true,
      enabled: pane.visible(),
      run: pane.focusAddress,
    }
  })

  // Ctrl+Shift+C copies in the terminal, so only the focused page claims it, as in Chromium.
  ctx.add(Command, (): Command | undefined => {
    if (!visible()) return undefined
    const pane = model()?.pane()

    if (!pane) return undefined

    return {
      id: "inspect",
      title: ctx.t("command.inspect"),
      group: ctx.t("command.category.view"),
      enabled: pane.visible() && pane.inspectable(),
      run: pane.inspect,
    }
  })

  ctx.add(MenuItem, (): MenuItem | undefined => {
    if (!visible()) return undefined
    const view = sessions.current()
    const value = model()

    if (!view || !value?.available(view)) return undefined

    return {
      menu: "session.panel",
      id: "open",
      title: ctx.t("tab.title"),
      icon: "outline-globe",
      keybind: "browser.open",
      order: 20,
      run: () => value.open(view),
    }
  })

  // Workspace HTML links reach the pane through the file extension, which resolves the path first.
  // A composer chip for a comment on a picked element.
  ctx.add(LinkHandler, {
    priority: 10,
    match: (link) => link.origin === ctx.id && !!link.session,
    open(link) {
      if (!visible()) return showHidden()

      if (link.session) model()?.reveal(link.session, link.href)
    },
  })

  // Stable tab objects with live labels, so title and URL changes never remount a trigger.
  const tabs = new Map<string, Map<string, PanelTab>>()

  const create = (session: string, id: string): PanelTab => {
    const text = () => {
      const tab = model()?.tab({ key: session }, id)

      return !tab?.url || tab.url === "about:blank" ? ctx.t("tab.new") : tab.title || tab.url
    }

    const icon = () => model()?.page({ key: session }, id)?.icon

    return {
      id,
      get title() {
        return text()
      },
      label: () => (
        <div class="flex min-w-0 items-center gap-1.5">
          <PageIcon icon={icon()} />
          <span class="min-w-0 max-w-40 truncate">{text()}</span>
        </div>
      ),
      // Listed only to hold the restored selection until the desktop's first inventory names the tab.
      get hidden() {
        return !model()?.tab({ key: session }, id)
      },
      group: "browser",
      dom: { tab: `session-side-panel-browser-tab-${id}`, panel: "session-side-panel-browser-tabpanel" },
    }
  }

  const SessionBrowserPane = lazy(() => import("./panel"))
  onCleanup(onIdle(() => void SessionBrowserPane.preload()))
  createKeyed(visible, () => {
    ctx.add(Panel, {
      id: "main",
      region: "side",
      list(input) {
        // While the model loads, the stored tabs hold the strip and its selection, as before the first inventory.
        const ids = model()?.tabs(input.session, input.open) ?? input.open

        if (ids.length === 0) {
          tabs.delete(input.session.key)

          return []
        }

        const previous = tabs.get(input.session.key)
        const next = new Map(ids.map((id) => [id, previous?.get(id) ?? create(input.session.key, id)]))
        tabs.set(input.session.key, next)

        return [...next.values()]
      },
      // The pane shows nothing until the desktop's first inventory names its tabs.
      render: (props) => (
        <Show when={model()}>
          {(value) => (
            <Show when={!value().pending(props.session)}>
              <Suspense>
                <SessionBrowserPane
                  tab={() => props.tab}
                  session={props.session}
                  screen={props.screen}
                  model={value()}
                />
              </Suspense>
            </Show>
          )}
        </Show>
      ),
      close: (input) => model()?.closeTab(input.session, input.tab.id),
      focus: (input) => model()?.focusTab(input.session, input.tab.id),
    })
  })
}

export default setup
