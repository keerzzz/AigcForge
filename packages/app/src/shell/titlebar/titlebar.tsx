import { createEffect, createMemo, createResource, Match, Show, Switch, untrack } from "solid-js"
import { createStore, unwrap } from "solid-js/store"
import { Dynamic } from "solid-js/web"
import { useLocation, useNavigate } from "@solidjs/router"
import { IconButton } from "@aigcfroge/ui/icon-button"
import { Icon } from "@aigcfroge/ui/icon"
import { Keybind } from "@aigcfroge/ui/keybind"
import { Tooltip } from "@aigcfroge/ui/tooltip"

import { LayoutRoute, useLayout } from "@/shell/state/layout"
import { usePlatform } from "@/runtime/platform/platform"
import { useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { useSettings } from "@/settings/model"
import { WindowsAppMenu } from "./windows-menu"
import { applyPath, backPath, forwardPath, type HistoryLocation } from "./history"
import { TitlebarTabStrip } from "@/shell/titlebar/tab-strip"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createMediaQuery } from "@solid-primitives/media"
import { readSessionTabsRemovedDetail, SESSION_TABS_REMOVED_EVENT } from "@/shell/titlebar/session-events"
import { useGlobal } from "@/runtime/server/runtime"
import { createTabComposerState } from "@/composer/persistence"
import { base64Encode } from "@aigcfroge/util/encode"
import { ServerConnection } from "@/runtime/server/registry"
import { tabKey, useTabs } from "@/shell/tabs/tabs"
import "./titlebar.css"
import { TitlebarRightMount } from "@/shell/titlebar/right-slot"
import { MobileDrawer, MobileDrawerContent, MobileDrawerLabel, MobileDrawerTrigger } from "@/shell/mobile-drawer"
import { sessionTabTitle } from "./tab-title"
import { SessionTabAvatar } from "@/shell/layout/session-tab-avatar"
import { SessionProgressIndicatorV2 } from "@aigcfroge/session-ui/v2/session-progress-indicator-v2"
import { RecentlyClosedTabsMenu } from "./recently-closed-tabs-menu"
import { useSettingsDialog } from "@/settings/command"
import { rootSession } from "@/shell/routes/session"
import { TitlebarItem } from "@aigcfroge/gui-extensions/sdk"
import { useExtensionHost } from "@/runtime/extension/host"
import { TitlebarItems, useTitlebarItems } from "@/runtime/extension/titlebar-items"
import { ProductMode } from "@aigcfroge/schema/product-mode"
import { ModeRoute } from "@/shell/routes/mode"
import { showToast } from "@/shell/notifications/toast"
import { ProjectSidebar } from "@/shell/project-sidebar"
import devIcon from "../../../../desktop/icons/dev/64x64.png"
import betaIcon from "../../../../desktop/icons/beta/64x64.png"

const titlebarHeight = 36

const windowsTitlebarHeight = 44 // Includes the content inset; matches the native Windows overlay.

const minTitlebarZoom = 0.25

const windowsControlsBaseWidth = 138 // 3 native Windows caption buttons at 46px each.

// Native controls: 14px left inset, two 20px button pitches, and a 14px button.
const macTrafficLightsBaseWidth = 68

// iOS blurs page content just below the status bar in Home Screen web apps, so with a top safe area the phone
// titlebar row stays 16px clear of it, as ChatGPT's phone header does. Without one, 8px matches the content gap below.
const mobileTopClearance = "max(8px, min(16px, env(safe-area-inset-top, 0px) * 1000))"

export function Titlebar() {
  const platform = usePlatform()
  const command = useCommand()
  const language = useLanguage()
  const settings = useSettings()
  const openSettings = useSettingsDialog()
  const navigate = useNavigate()
  const location = useLocation()
  const mobile = createMediaQuery("(max-width: 767px)")
  const bottom = createMemo(() => mobile() && settings.general.mobileTitlebarPosition() === "bottom")
  const mobileTop = createMemo(() => platform.platform === "web" && mobile() && !bottom())

  const mac = createMemo(() => platform.platform === "desktop" && platform.os === "macos")
  const windows = createMemo(() => platform.platform === "desktop" && platform.os === "windows")
  const linux = createMemo(() => platform.platform === "desktop" && platform.os === "linux")
  const macTrafficLights = createMemo(() => mac() && !platform.windowFullscreen?.())
  const zoom = () => platform.webviewZoom?.() ?? 1
  const titlebarZoom = () => (windows() ? Math.max(zoom(), minTitlebarZoom) : zoom())

  const minHeight = () => {
    if (mac()) return `${titlebarHeight / zoom()}px`

    if (windows()) return `env(titlebar-area-height, ${windowsTitlebarHeight / Math.min(titlebarZoom(), 1)}px)`

    return undefined
  }

  const windowsControlsWidth = () => `${windowsControlsBaseWidth / Math.max(titlebarZoom(), 1)}px`

  const [history, setHistory] = createStore<{
    stack: HistoryLocation[]
    index: number
    action: "back" | "forward" | undefined
  }>({
    stack: [],
    index: 0,
    action: undefined,
  })

  const path = () => `${location.pathname}${location.search}${location.hash}`

  createEffect(() => {
    const current = { url: path(), state: location.state }

    untrack(() => {
      const next = applyPath(history, current)

      if (next === history) return
      setHistory(next)
    })
  })

  const titlebarItems = useTitlebarItems()

  const back = () => {
    const next = backPath(history)

    if (!next) return
    setHistory(next.state)
    navigate(next.to.url, { state: unwrap(next.to.state) })
  }

  const forward = () => {
    const next = forwardPath(history)

    if (!next) return
    setHistory(next.state)
    navigate(next.to.url, { state: unwrap(next.to.state) })
  }

  command.register(() => [
    {
      id: "common.goBack",
      title: language.t("common.goBack"),
      category: language.t("command.category.view"),
      keybind: "mod+[",
      onSelect: back,
    },
    {
      id: "common.goForward",
      title: language.t("common.goForward"),
      category: language.t("command.category.view"),
      keybind: "mod+]",
      onSelect: forward,
    },
  ])

  return (
    <header
      data-slot="titlebar-v2"
      classList={{
        "shrink-0 relative flex flex-row h-9 bg-v2-background-bg-deep overflow-visible": true,
        "order-last": bottom(),
      }}
      style={{
        height:
          platform.platform === "web"
            ? bottom()
              ? "calc(28px + max(8px, var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))))"
              : mobileTop()
                ? `calc(28px + ${mobileTopClearance} + env(safe-area-inset-top, 0px))`
                : "calc(28px + max(8px, env(safe-area-inset-top, 0px)))"
            : undefined,
        "padding-top": bottom()
          ? "0px"
          : mobileTop()
            ? `calc(${mobileTopClearance} + env(safe-area-inset-top, 0px))`
            : "env(safe-area-inset-top, 0px)",
        "padding-bottom": bottom() ? "var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))" : "0px",
        "min-height": minHeight(),
        // Keep native macOS traffic lights clear even when the desktop window is narrow.
        "padding-left": macTrafficLights() ? `${macTrafficLightsBaseWidth / zoom()}px` : 0,
        width: windows() ? `env(titlebar-area-width, calc(100vw - ${windowsControlsWidth()}))` : undefined,
        "max-width": windows() ? `env(titlebar-area-width, calc(100vw - ${windowsControlsWidth()}))` : undefined,
        // Native Windows caption controls remain on the physical right in both writing directions.
        "margin-right": windows() ? "auto" : undefined,
      }}
      data-tauri-drag-region
    >
      <Switch>
        <Match when>
          {(_) => {
            const layout = useLayout()
            const global = useGlobal()

            const tabs = useTabs()
            const tabsStore = tabs.store
            const tabsStoreActions = tabs

            const preparing = createMemo(() => {
              const route = layout.route()

              return route.type === "session" && !!tabs.pendingSession(route.server, route.sessionId)
            })

            const [resolvedSession] = createResource(
              () => {
                const route = layout.route()

                if (route.type !== "session") return undefined

                if (preparing()) return undefined
                const conn = global.servers.list().find((item) => ServerConnection.key(item) === route.server)

                return conn ? { route, ctx: global.ensureServerCtx(conn) } : undefined
              },
              async ({ route, ctx }) => {
                const info = await ctx.sdk.api.session
                  .get({ sessionID: route.sessionId })
                  .catch(() => ctx.data.session.get(route.sessionId))

                if (!info) return
                ctx.data.session.remember(info)

                const rootID = await rootSession(info, async (id) => {
                  const cached = ctx.data.session.get(id)

                  if (cached) return cached
                  const ancestor = await ctx.sdk.api.session.get({ sessionID: id })
                  ctx.data.session.remember(ancestor)

                  return ancestor
                })
                  .then((root) => root.id)
                  .catch(() => ctx.data.session.root(info.id))

                return { info, rootID }
              },
            )

            const session = createMemo(() => {
              const route = layout.route()

              if (route.type !== "session") return

              if (preparing()) return
              const conn = global.servers.list().find((item) => ServerConnection.key(item) === route.server)
              const cached = conn ? global.ensureServerCtx(conn).data.session.get(route.sessionId) : undefined

              if (cached) return cached
              const resolved = resolvedSession()

              return resolved?.info.id === route.sessionId ? resolved.info : undefined
            })

            const matchRoute = (route: LayoutRoute) => {
              if (route.type === "home") return

              if (route.type === "draft") {
                return tabsStore.find((item) => item.type === "draft" && item.draftID === route.draftID)
              }

              if (route.type === "session") {
                const main = tabsStore.find(
                  (item) =>
                    item.type === "session" &&
                    item.server === route.server &&
                    (item.sessionId === route.sessionId || item.routeSessionId === route.sessionId),
                )

                if (main) return main
                const s = session()

                if (s?.parentID) {
                  const resolved = resolvedSession()
                  const parentID = resolved?.info.id === s.id ? resolved.rootID : s.parentID

                  const parent = tabsStore.find(
                    (item) => item.type === "session" && item.server === route.server && item.sessionId === parentID,
                  )

                  if (parent) return parent
                }
              }
            }

            const currentTab = () => matchRoute(layout.route())

            createEffect(() => {
              const route = layout.route()

              if (!tabs.ready()) return
              const tab = currentTab()

              if (tab) {
                const current = session()

                if (
                  route.type === "session" &&
                  tab.type === "session" &&
                  (route.sessionId === tab.sessionId || current?.id === route.sessionId)
                ) {
                  tabs.rememberSessionRoute(tab, route.sessionId, current?.parentID)
                }

                tabs.remember(tab)

                return
              }

              if (route.type === "session") {
                if (tabs.pendingSession(route.server, route.sessionId)) {
                  tabsStoreActions.addSessionTab({ server: route.server, sessionId: route.sessionId })

                  return
                }

                const s = session()

                if (!s) return
                const resolved = resolvedSession()

                if (s.parentID && resolved?.info.id !== s.id) return
                const sessionId = resolved?.info.id === s.id ? resolved.rootID : s.id
                const next = { server: route.server, sessionId }
                tabsStoreActions.addSessionTab(next)
              }
            })

            makeEventListener(window, SESSION_TABS_REMOVED_EVENT, (event) => {
              const detail = readSessionTabsRemovedDetail(event)

              if (!detail) return
              tabsStoreActions.removeSessions(detail)
            })

            const startDraft = (
              draft: Parameters<typeof tabs.newDraft>[0],
              model?: Parameters<typeof tabs.newDraft>[2],
            ) => {
              const mode = draft.mode

              if (!ProductMode.isID(mode) || !ProductMode.isGenericSessionMode(mode)) {
                showToast({
                  description: language.t(
                    mode === "custom" ? "mode.navigation.customCreation" : "newSession.mode.unsupported",
                  ),
                })

                return
              }

              void tabs.newDraft({ ...draft, mode }, "", model)
            }

            const openNewTab = async () => {
              const route = layout.route()

              switch (route.type) {
                case "session": {
                  const pending = tabs.pendingSession(route.server, route.sessionId)

                  if (pending) {
                    const model = tabs.stateValue(pending.draft, "prompt")?.model.current()
                    startDraft(
                      {
                        server: route.server,
                        directory: pending.draft.directory,
                        mode: ModeRoute.sourceMode(route, pending.draft, undefined),
                      },
                      model,
                    )

                    return
                  }

                  const activeSession = session()

                  if (!activeSession) return

                  const sessionTab = {
                    type: "session" as const,
                    server: route.server,
                    sessionId: activeSession.id,
                  }

                  const draft = {
                    server: sessionTab.server,
                    directory: activeSession.location.directory,
                    mode: ModeRoute.sourceMode(route, undefined, activeSession),
                  }
                  const ctx = global.serverCtx(sessionTab.server)
                  const composer = ctx
                    ? createTabComposerState(tabs, sessionTab, ctx.sdk.scope, {
                        dir: base64Encode(draft.directory),
                        id: activeSession.id,
                      })
                    : undefined

                  if (composer && !composer.ready()) await composer.ready.promise
                  startDraft(draft, composer?.model.current())

                  return
                }

                case "draft": {
                  const activeTab = currentTab()

                  if (activeTab?.type !== "draft") return

                  const model = tabs.stateValue(activeTab, "prompt")?.model.current()
                  startDraft(
                    {
                      server: activeTab.server,
                      directory: activeTab.directory,
                      mode: ModeRoute.sourceMode(route, activeTab, undefined),
                    },
                    model,
                  )

                  return
                }

                case "settings":
                case "connect":
                case "home":
                case "mode": {
                  const mode = route.type === "mode" ? route.mode : layout.home.mode()

                  if (mode === undefined) {
                    showToast({ description: language.t("newSession.mode.placeholder") })
                    navigate("/")

                    return
                  }

                  const selection = layout.home.selection()

                  const conn =
                    global.servers.list().find((item) => ServerConnection.key(item) === selection.server) ??
                    global.servers.list()[0]

                  const projects = conn ? global.ensureServerCtx(conn).projects : undefined

                  const project =
                    projects?.list().find((item) => item.worktree === selection.directory) ??
                    projects?.list().find((item) => item.worktree === projects.last()) ??
                    projects?.list()[0]

                  if (conn && project) {
                    if (mode === "custom") {
                      if (route.type !== "mode")
                        layout.home.setSelection({ server: ServerConnection.key(conn), directory: project.worktree })
                      navigate(ModeRoute.href(mode))

                      return
                    }

                    startDraft({
                      server: ServerConnection.key(conn),
                      directory: project.worktree,
                      mode,
                    })

                    return
                  }
                }
              }
            }

            const toggleHome = () => tabs.toggleHome({ home: layout.route().type === "home", current: currentTab() })

            const homeButton = () => (
              <Tooltip
                placement="bottom"
                value={
                  <>
                    {language.t("home.title")}
                    <Keybind keys={command.keybindParts("home.toggle")} variant="neutral" />
                  </>
                }
                class="shrink-0"
              >
                <IconButton
                  type="button"
                  variant="ghost-muted"
                  size="large"
                  class="!w-9 shrink-0"
                  icon={<Icon name="grid-plus" />}
                  state={layout.route().type === "home" ? "pressed" : undefined}
                  onClick={toggleHome}
                  aria-label={language.t("home.title")}
                  aria-pressed={layout.route().type === "home"}
                />
              </Tooltip>
            )

            command.register("titlebar-home", () => [
              {
                id: "home.toggle",
                title: language.t("home.title"),
                category: language.t("command.category.view"),
                keybind: windows() ? "alt+home" : "mod+b",
                hidden: true,
                onSelect: () => {
                  if (layout.route().type !== "home") layout.home.searchFocus.request()
                  toggleHome()
                },
              },
            ])

            command.register("tabs", () => {
              const current = currentTab()

              return [
                {
                  id: "tab.new",
                  category: "tab",
                  title: language.t("command.session.new"),
                  keybind: "mod+t,mod+n",
                  hidden: true,
                  onSelect: openNewTab,
                },
                current && {
                  id: "tab.close",
                  category: "tab",
                  title: language.t("command.tab.close"),
                  keybind: "mod+w",
                  hidden: true,
                  onSelect: () => {
                    tabsStoreActions.closeTab(tabsStore.findIndex((tab) => current === tab))
                  },
                },
                {
                  id: "tab.reopenClosed",
                  category: language.t("command.category.file"),
                  title: language.t("command.tab.reopenClosed"),
                  keybind: "mod+shift+t",
                  onSelect: () => tabsStoreActions.reopenClosedTab(),
                },
              ].filter((v) => v !== undefined)
            })

            const [mobileTabs, setMobileTabs] = createStore({ open: false, present: false, settings: false })

            const currentProject = createMemo(() => {
              const tab = currentTab()
              const value = session()

              if (!tab || !value) return
              const conn = global.servers.list().find((item) => ServerConnection.key(item) === tab.server)

              return conn ? global.ensureServerCtx(conn).projects.forSession(value) : undefined
            })

            const currentTitle = () => {
              const tab = currentTab()

              if (!tab) return language.t("home.title")

              if (tab.type === "draft") return language.t("session.tab.session")
              const value = session()

              return sessionTabTitle(
                value ? value.title : tabs.info[tabKey(tab)]?.title,
                language.t("session.tab.session"),
              )
            }

            createEffect(() => {
              path()
              mobile()
              setMobileTabs("open", false)

              // Switching to desktop disposes the drawer before it can report its final presence.
              if (!mobile()) setMobileTabs("present", false)
            })

            return (
              <div
                class="h-full flex-1 overflow-hidden flex flex-row items-center gap-1.5 px-2 md:pe-3"
                classList={{
                  "pt-[max(0px,calc(8px-env(safe-area-inset-top,0px)))]": !bottom() && !windows() && !mobileTop(),
                  "pb-[max(0px,calc(8px-var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px))))]": bottom(),
                  "pl-4": macTrafficLights(),
                  // Center the 20px app icon over the sidebar's 16px icon column.
                  "ps-3.5": windows(),
                }}
              >
                <Show when={!mobile()}>
                  <ChannelIndicator />
                </Show>
                <Show when={windows() || linux()}>
                  <WindowsAppMenu command={command} platform={platform} />
                </Show>
                <Show when={!mobile()}>{homeButton()}</Show>

                <Show
                  when={!mobile()}
                  fallback={
                    <MobileDrawer
                      open={mobileTabs.open}
                      onOpenChange={(open) => setMobileTabs("open", open)}
                      onContentPresentChange={(present) => {
                        setMobileTabs("present", present)

                        if (present || !mobileTabs.settings) return
                        setMobileTabs("settings", false)
                        openSettings()
                      }}
                    >
                      <MobileDrawerTrigger
                        data-slot="mobile-tabs-trigger"
                        class="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-[6px] px-2 text-[13px] leading-4 text-v2-text-text-base focus-visible:outline-none [app-region:no-drag]"
                        aria-label={language.t("titlebar.tabs")}
                      >
                        <Show when={currentTab()} fallback={<Icon name="grid-plus" class="shrink-0" />}>
                          {(tab) => (
                            <span
                              data-slot="project-avatar-slot"
                              class="flex size-4 shrink-0 items-center justify-center"
                            >
                              <Show
                                when={session()}
                                fallback={
                                  tab().type === "draft" ? (
                                    <Icon name="edit" />
                                  ) : (
                                    <Show
                                      when={preparing()}
                                      fallback={
                                        <span
                                          class="block size-4 rounded-[3px] border border-v2-border-border-muted"
                                          aria-hidden="true"
                                        />
                                      }
                                    >
                                      <SessionProgressIndicatorV2 />
                                    </Show>
                                  )
                                }
                              >
                                {(value) => (
                                  <SessionTabAvatar
                                    project={currentProject()}
                                    directory={value().location.directory}
                                    sessionId={value().id}
                                    server={tab().server}
                                  />
                                )}
                              </Show>
                            </span>
                          )}
                        </Show>
                        <span data-slot="mobile-tab-title" dir="auto" class="min-w-0 flex-1 truncate text-start">
                          {currentTitle()}
                        </span>
                        <span class="shrink-0 text-v2-text-text-muted">{tabsStore.length}</span>
                      </MobileDrawerTrigger>
                      <MobileDrawerContent>
                        <MobileDrawerLabel class="sr-only">{language.t("titlebar.tabs")}</MobileDrawerLabel>
                        <div
                          data-slot="mobile-tabs-drawer"
                          data-projects={layout.route().type === "session" ? "true" : undefined}
                          data-corvu-no-drag
                        >
                          <Show when={layout.route().type === "session" && (mobileTabs.open || mobileTabs.present)}>
                            <div data-slot="mobile-projects-drawer">
                              <ProjectSidebar onNavigate={() => setMobileTabs("open", false)} />
                            </div>
                          </Show>
                          <div data-slot="mobile-tabs-drawer-list">
                            <Show when={layout.route().type === "session"}>
                              <div class="shrink-0 px-1.5 py-1 text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
                                {language.t("titlebar.tabs")}
                              </div>
                            </Show>
                            <TitlebarTabStrip
                              orientation="vertical"
                              tabs={tabsStore}
                              currentTab={currentTab()}
                              onNavigate={(tab) => {
                                tabs.select(tab)
                                setMobileTabs("open", false)
                              }}
                              onClose={(tab) => {
                                const index = tabsStore.findIndex((item) => tabKey(item) === tabKey(tab))

                                if (index !== -1) tabsStoreActions.closeTab(index)
                              }}
                              onReorder={(keys) => tabsStoreActions.reorder(keys)}
                            />
                          </div>
                          <button
                            type="button"
                            data-action="mobile-tabs-new-session"
                            class="flex h-7 w-full shrink-0 items-center gap-2 rounded-[6px] px-2 text-[13px] leading-4 text-v2-text-text-base hover:bg-v2-background-bg-layer-02 focus-visible:outline-none focus-visible:bg-v2-background-bg-layer-02"
                            onClick={() => {
                              void openNewTab()
                              setMobileTabs("open", false)
                            }}
                          >
                            <Icon name="plus" />
                            {language.t("command.session.new")}
                          </button>
                          <div class="flex shrink-0 flex-col gap-1 border-t border-v2-border-border-muted pt-2">
                            <button
                              type="button"
                              data-action="mobile-tabs-home"
                              data-state={layout.route().type === "home" ? "pressed" : undefined}
                              aria-current={layout.route().type === "home" ? "page" : undefined}
                              class="flex h-7 w-full items-center gap-2 rounded-[6px] px-2 text-[13px] leading-4 text-v2-text-text-faint data-[state=pressed]:text-v2-text-text-base focus-visible:outline-none"
                              onClick={() => {
                                if (layout.route().type !== "home") toggleHome()
                                setMobileTabs("open", false)
                              }}
                            >
                              <Icon name="grid-plus" />
                              {language.t("home.title")}
                            </button>
                            <div class="flex items-center gap-1">
                              <button
                                type="button"
                                data-action="mobile-tabs-settings"
                                class="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-[6px] px-2 text-[13px] leading-4 text-v2-text-text-faint hover:bg-v2-background-bg-layer-02 focus-visible:outline-none focus-visible:bg-v2-background-bg-layer-02"
                                onClick={() => setMobileTabs({ open: false, settings: true })}
                              >
                                <Icon name="settings-gear" size="small" />
                                {language.t("sidebar.settings")}
                              </button>
                              <button
                                type="button"
                                data-action="mobile-tabs-help"
                                class="flex h-7 shrink-0 items-center gap-2 rounded-[6px] px-2 text-[13px] leading-4 text-v2-text-text-faint hover:bg-v2-background-bg-layer-02 focus-visible:outline-none focus-visible:bg-v2-background-bg-layer-02"
                                onClick={() => {
                                  setMobileTabs("open", false)
                                  platform.openExternal("https://aigcfroge.ai/desktop-feedback")
                                }}
                              >
                                <Icon name="help" size="small" />
                                {language.t("sidebar.help")}
                              </button>
                            </div>
                          </div>
                        </div>
                      </MobileDrawerContent>
                    </MobileDrawer>
                  }
                >
                  <TitlebarTabStrip
                    tabs={tabsStore}
                    currentTab={currentTab()}
                    onNavigate={(tab, el) => {
                      tabs.select(tab)
                      el?.scrollIntoView({ behavior: "instant" })
                    }}
                    onClose={(tab) => {
                      const index = tabsStore.findIndex((item) => tabKey(item) === tabKey(tab))

                      if (index !== -1) tabsStoreActions.closeTab(index)
                    }}
                    onReorder={(keys) => tabsStoreActions.reorder(keys)}
                  />
                  <RecentlyClosedTabsMenu
                    onNewTab={openNewTab}
                    tooltip={
                      <>
                        {language.t("command.session.new")}
                        <Keybind keys={command.keybindParts("tab.new")} variant="neutral" />
                      </>
                    }
                  />
                </Show>
                <Show when={!mobile()}>
                  <div class="flex-1" />
                </Show>
                <div class="relative z-20 flex shrink-0 items-center justify-end gap-0 overflow-visible">
                  <TitlebarItems items={titlebarItems} />
                  <TitlebarRightMount />
                </div>
              </div>
            )
          }}
        </Match>
      </Switch>
    </header>
  )
}

function ChannelIndicator() {
  const language = useLanguage()
  const platform = usePlatform()
  const host = useExtensionHost()
  const channel = import.meta.env.VITE_AIGCFROGE_CHANNEL

  if (!channel || channel === "prod") return null

  const label = () => language.t(`titlebar.channel.${channel}`)

  // An extension may turn the dev badge into a toggle (the debug bar does).
  const debug = () =>
    channel === "dev" || channel === "local"
      ? host.list(TitlebarItem).find((item) => item.placement === "channel")
      : undefined

  return (
    <Tooltip
      placement="bottom"
      value={label()}
      class={`shrink-0 me-1.5 [app-region:no-drag] ${platform.platform === "web" ? "ps-2.5" : ""}`}
    >
      <Dynamic
        component={debug() ? "button" : "div"}
        type={debug() ? "button" : undefined}
        data-slot="channel-indicator"
        class="flex h-7 w-5 shrink-0 items-center rounded-[6px] [app-region:no-drag]"
        classList={{
          "cursor-pointer hover:bg-v2-background-bg-layer-02 focus-visible:outline-none focus-visible:bg-v2-background-bg-layer-02":
            !!debug(),
        }}
        onClick={() => debug()?.run?.()}
        aria-label={debug()?.label}
        aria-pressed={debug()?.pressed}
      >
        <img
          src={channel === "beta" ? betaIcon : devIcon}
          alt={debug() ? "" : label()}
          class="size-5 shrink-0 rounded-[4px] shadow-[var(--v2-elevation-raised)]"
          draggable={false}
        />
      </Dynamic>
    </Tooltip>
  )
}
