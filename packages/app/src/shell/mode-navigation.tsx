import { createMemo, For } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { ProductMode } from "@omnixa/schema/product-mode"
import { Icon } from "@omnixa/ui/icon"
import { type IconName } from "@omnixa/ui/icons/catalog"
import { Button } from "@omnixa/ui/button"
import { Tooltip } from "@omnixa/ui/tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import { useLayout } from "@/shell/state/layout"
import { useTabs } from "@/shell/tabs/tabs"
import { ModeRoute } from "./routes/mode"
import "./mode-navigation.css"

const icons = {
  chat: "rail-chat",
  coding: "rail-coding",
  work: "rail-work",
  assistant: "rail-assistant",
  custom: "rail-custom",
} satisfies Record<ProductMode.ID, IconName>

export function ModeNavigation() {
  const language = useLanguage()
  const navigate = useNavigate()
  const layout = useLayout()
  const tabs = useTabs()
  const global = useGlobal()
  const opened = layout.navigation.opened

  const current = createMemo(() => {
    const route = layout.route()

    if (route.type === "mode") return ModeRoute.sourceMode(route, undefined, undefined)

    if (route.type === "draft") {
      const draft = tabs.store.find((tab) => tab.type === "draft" && tab.draftID === route.draftID)

      return ModeRoute.sourceMode(route, draft?.type === "draft" ? draft : undefined, undefined)
    }

    if (route.type !== "session") return
    const conn = global.servers.list().find((item) => ServerConnection.key(item) === route.server)

    return ModeRoute.sourceMode(
      route,
      tabs.pendingSession(route.server, route.sessionId)?.draft,
      conn ? global.ensureServerCtx(conn).data.session.get(route.sessionId) : undefined,
    )
  })

  const label = (mode: ProductMode.ID) =>
    mode === "custom" ? language.t("home.sessions.mode.custom") : language.t(`newSession.mode.${mode}`)

  return (
    <div class="mode-navigation [app-region:no-drag]" data-opened={opened()}>
      <nav
        id="global-mode-navigation"
        aria-label={language.t("mode.navigation.label")}
        aria-hidden={!opened()}
        inert={!opened()}
        class="mode-navigation-rail"
      >
        <For each={ProductMode.ID.literals}>
          {(mode) => (
            <Tooltip value={label(mode)} placement="right">
              <Button
                type="button"
                variant="ghost-muted"
                size="large"
                class="mode-navigation-item"
                aria-label={label(mode)}
                aria-current={current() === mode ? "page" : undefined}
                onClick={() => navigate(ModeRoute.href(mode))}
              >
                <Icon name={icons[mode]} size="large" />
                <span data-slot="active-indicator" aria-hidden="true" />
              </Button>
            </Tooltip>
          )}
        </For>
      </nav>
    </div>
  )
}

export * as Modes from "./mode-navigation"
