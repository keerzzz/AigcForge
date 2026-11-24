import { lazy, onCleanup, Show, Suspense } from "solid-js"
import { Command, MenuItem, onIdle, Panel, SettingsPage, Slot, usePanel, type PanelTab, type Setup } from "../sdk"
import { Switch } from "@omnixa/ui/switch"
import type definition from "./index"
import { SessionContextUsage } from "./indicator"

const setup: Setup<typeof definition> = (ctx) => {
  const visible = () => ctx.stores.display.value.visible
  ctx.add(SettingsPage, {
    id: "display",
    page: "general",
    section: "general",
    get title() {
      return ctx.t("settings.show")
    },
    get entries() {
      return [{ id: "show-context", title: ctx.t("settings.show") }]
    },
    render: () => (
      <div data-component="settings-row">
        <div data-slot="settings-row-copy">
          <div data-slot="settings-row-title">{ctx.t("settings.show")}</div>
        </div>
        <div data-slot="settings-row-control">
          <Switch
            aria-label={ctx.t("settings.show")}
            checked={visible()}
            hideLabel
            onChange={(checked) =>
              ctx.stores.display.update((draft) => {
                draft.visible = checked
              })
            }
          >
            {ctx.t("settings.show")}
          </Switch>
        </div>
      </div>
    ),
  })
  const SessionContextTab = lazy(() => import("./tab"))
  // Compile the tab while the app idles, so the first open renders at once.
  onCleanup(onIdle(() => void SessionContextTab.preload()))

  // One tab object for every session, so neither strip updates nor a session switch remount its trigger; the label
  // reads the routed session from its state.
  const tab: PanelTab = {
    id: "main",
    get title() {
      return ctx.t("tab.title")
    },
    draggable: false,
    closable: "compact",
    first: true,
    fallback: true,
    label: (state) => (
      <div class="flex items-center gap-2">
        <SessionContextUsage session={state.session} variant="indicator" />
        <div>{ctx.t("tab.title")}</div>
      </div>
    ),
  }

  const open = () => {
    const session = ctx.sessions.current()

    if (!visible() || !session) return

    ctx.layout.open(`${ctx.id}:main`, session)
  }

  ctx.add(
    Command,
    (): Command => ({
      id: "open",
      title: ctx.t("tab.title"),
      section: "session",
      bind: "mod+alt+c",
      enabled: visible() && !!ctx.sessions.current(),
      run: open,
    }),
  )

  ctx.add(Slot, (): Slot | undefined =>
    visible()
      ? {
          at: "session.header",
          order: 10,
          render: (input) => <SessionContextUsage session={input.session} placement="bottom" />,
        }
      : undefined,
  )

  ctx.add(MenuItem, (): MenuItem | undefined => {
    const session = ctx.sessions.current()

    if (!visible() || !session) return

    return {
      id: "open",
      menu: "session.panel",
      title: ctx.t("tab.title"),
      icon: "status",
      keybind: "context.open",
      order: 30,
      run: open,
    }
  })

  ctx.add(Panel, (): Panel | undefined =>
    visible()
      ? {
          id: "main",
          region: "side",
          // Stored before extensions as "context", then under the extension's earlier id `usage`.
          legacy: { context: "main", "usage:context": "main" },
          mobile: { title: ctx.t("mobile.title"), order: 40, kind: "menu", icon: "status" },
          list: (input) => (input.open.includes("main") ? [tab] : []),
          render: (props) => {
            const panel = usePanel()

            return (
              <Show
                when={panel.placement() !== "mobile"}
                fallback={
                  <Suspense>
                    <SessionContextTab session={props.session} />
                  </Suspense>
                }
              >
                <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                  <Suspense>
                    <SessionContextTab session={props.session} />
                  </Suspense>
                </div>
              </Show>
            )
          },
        }
      : undefined,
  )
}

export default setup
