import { createContext, createMemo, Show, useContext, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@omnixa/ui/button"
import { Icon } from "@omnixa/ui/icon"
import { Popover } from "@omnixa/ui/popover"
import { Tooltip } from "@omnixa/ui/tooltip"
import { getFilename } from "@omnixa/util/path"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection, serverName, useServers } from "@/runtime/server/registry"
import { useLanguage } from "@/runtime/i18n/language"
import { useLayout } from "./state/layout"
import { useTabs } from "./tabs/tabs"
import { resolveNewSessionProject } from "./layout/helpers"
import { showToast } from "./notifications/toast"
import "./footer.css"

const context = createContext<{
  navigation: () => HTMLElement | undefined
  actions: () => HTMLElement | undefined
  setNavigation: (element: HTMLElement) => void
  setActions: (element: HTMLElement) => void
}>()

export function ShellFooterProvider(props: ParentProps) {
  const [mounts, setMounts] = createStore<{ navigation?: HTMLElement; actions?: HTMLElement }>({})

  return (
    <context.Provider
      value={{
        navigation: () => mounts.navigation,
        actions: () => mounts.actions,
        setNavigation: (element) => setMounts("navigation", element),
        setActions: (element) => setMounts("actions", element),
      }}
    >
      {props.children}
    </context.Provider>
  )
}

export const useShellFooter = () => useContext(context)

export function ShellFooter() {
  const mounts = useShellFooter()!
  const layout = useLayout()
  const tabs = useTabs()
  const global = useGlobal()
  const servers = useServers()
  const language = useLanguage()
  const [state, setState] = createStore({ copied: false })
  const draft = createMemo(() => {
    const route = layout.route()

    return route.type === "draft"
      ? tabs.store.find((tab) => tab.type === "draft" && tab.draftID === route.draftID)
      : undefined
  })
  const connection = createMemo(() => {
    const route = layout.route()
    const tab = draft()
    const key =
      route.type === "session" ? route.server : tab?.type === "draft" ? tab.server : layout.home.selection().server

    return (
      (route.type === "session" || tab ? global.servers.list() : servers.visible).find(
        (conn) => ServerConnection.key(conn) === key,
      ) ?? (route.type === "session" || tab ? undefined : servers.visible[0])
    )
  })
  const controller = createMemo(() => {
    const conn = connection()

    return conn ? global.serverCtx(ServerConnection.key(conn)) : undefined
  })
  const location = createMemo(() => {
    const route = layout.route()
    const tab = draft()
    const ctx = controller()

    if (route.type === "session") return ctx?.data.session.get(route.sessionId)?.location
    if (tab?.type === "draft") return { directory: tab.directory }
    const selected = layout.home.selection().directory

    if (route.type === "mode" && route.mode === "custom") return selected ? { directory: selected } : undefined
    const project = resolveNewSessionProject(ctx?.projects.list() ?? [], selected, ctx?.projects.last())

    return project ? { directory: project.worktree } : undefined
  })
  const positionLabel = () =>
    language.t(
      layout.route().type === "session"
        ? "shell.footer.sessionLocation"
        : draft()
          ? "shell.footer.draftLocation"
          : "shell.footer.newLocation",
    )
  const status = () => controller()?.sdk.connection.status() ?? "disconnected"
  const branch = () => {
    const ref = location()

    return ref ? controller()?.data.location.vcs.info(ref)?.branch.current : undefined
  }

  return (
    <footer class="shell-footer [app-region:no-drag]" aria-label={language.t("shell.footer.label")}>
      <Tooltip value={language.t(layout.navigation.opened() ? "mode.navigation.collapse" : "mode.navigation.expand")}>
        <Button
          type="button"
          variant="ghost-muted"
          size="small"
          class="shell-footer-toggle"
          aria-label={language.t(layout.navigation.opened() ? "mode.navigation.collapse" : "mode.navigation.expand")}
          aria-expanded={layout.navigation.opened()}
          aria-controls="global-mode-navigation"
          onClick={() => layout.navigation.toggle()}
        >
          <Icon name={layout.navigation.opened() ? "chevron-left" : "chevron-right"} />
        </Button>
      </Tooltip>
      <div class="shell-footer-environment">
        <span class="shell-footer-connection" title={connection() ? serverName(connection()) : undefined}>
          <span class="shell-footer-status" data-state={status()} aria-hidden="true" />
          <span class="shell-footer-server">
            {connection() ? serverName(connection()) : language.t("shell.footer.noServer")}
          </span>
          <span class="shell-footer-state">
            {language.t(
              status() === "connected"
                ? "shell.footer.connected"
                : status() === "reconnecting"
                  ? "shell.footer.reconnecting"
                  : status() === "connecting"
                    ? "shell.footer.connecting"
                    : "shell.footer.disconnected",
            )}
          </span>
        </span>
        <Popover
          placement="top-start"
          onOpenChange={(open) => {
            if (open) setState("copied", false)
          }}
          title={positionLabel()}
          triggerAs={Button}
          triggerProps={{
            variant: "ghost-muted",
            size: "small",
            class: "shell-footer-location",
            disabled: !location(),
          }}
          trigger={
            <>
              <span class="shell-footer-position">{positionLabel()}</span>
              <span class="shell-footer-project">
                {location() ? getFilename(location()!.directory) : language.t("shell.footer.noLocation")}
              </span>
              <Show when={branch()}>
                {(name) => (
                  <span class="shell-footer-branch">
                    <Icon name="branch" size="small" />
                    <span>{name()}</span>
                  </span>
                )}
              </Show>
            </>
          }
        >
          <div class="shell-footer-location-detail">
            <code>{location()?.directory}</code>
            <Button
              type="button"
              variant="outline"
              size="small"
              onClick={() => {
                const directory = location()?.directory

                if (!directory) return
                void navigator.clipboard.writeText(directory).then(
                  () => setState("copied", true),
                  () => showToast({ description: language.t("shell.footer.copyFailed") }),
                )
              }}
            >
              {language.t(state.copied ? "shell.footer.copied" : "shell.footer.copyPath")}
            </Button>
          </div>
        </Popover>
      </div>
      <div ref={mounts.setNavigation} class="shell-footer-navigation" />
      <div ref={mounts.setActions} class="shell-footer-actions" />
    </footer>
  )
}
