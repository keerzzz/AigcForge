import { For, Show, createMemo } from "solid-js"
import { Button } from "@omnixa/ui/button"
import { Icon } from "@omnixa/ui/icon"
import { IconButton } from "@omnixa/ui/icon-button"
import { Keybind } from "@omnixa/ui/keybind"
import { Tooltip } from "@omnixa/ui/tooltip"
import { Command, MenuItem, Panel, Slot, Style, type PanelTab, type Setup } from "../sdk"
import type definition from "."
import css from "./style.css?inline"

const setup: Setup<typeof definition> = (ctx) => {
  const key = `${ctx.id}:new`

  ctx.add(
    Command,
    (): Command => ({
      id: "open",
      title: ctx.t("session.tab.add"),
      section: "session",
      bind: "mod+alt+n",
      enabled: !!ctx.sessions.current(),
      run: () => {
        const session = ctx.sessions.current()

        if (session) ctx.layout.open(key, session, { tab: "select" })
      },
    }),
  )

  const tab: PanelTab = {
    id: "new",
    get title() {
      return ctx.t("tab.title")
    },
    transient: true,
    draggable: false,
    closable: "hover",
  }

  ctx.add(Style, css)
  ctx.add(Panel, {
    id: "main",
    region: "side",
    list: (input) => (input.open.includes(tab.id) ? [tab] : []),
    render: () => {
      const items = createMemo(() =>
        ctx
          .list(MenuItem)
          .flatMap((item) => (item.menu === "session.panel" ? [item] : []))
          .toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0)),
      )

      return (
        <div data-component="session-panel-launcher">
          <div data-slot="launcher-content">
            <h2>{ctx.t("heading")}</h2>
            <Show when={items().length > 0} fallback={<p>{ctx.t("empty")}</p>}>
              <div data-slot="launcher-items">
                <For each={items()}>
                  {(item) => {
                    const keys = createMemo(() => (item.keybind ? [...ctx.keybinds.keybind(item.keybind)] : []))

                    return (
                      <Button variant="ghost" size="large" aria-label={item.title} onClick={() => item.run()}>
                        <Show when={item.icon}>{(icon) => <Icon name={icon()} size="small" />}</Show>
                        <span>{item.title}</span>
                        <Show when={keys().length > 0}>
                          <Keybind keys={keys()} variant="neutral" />
                        </Show>
                      </Button>
                    )
                  }}
                </For>
              </div>
            </Show>
          </div>
        </div>
      )
    },
  })
  ctx.add(Slot, {
    at: "session.panel.end",
    order: -100,
    render: (input) => (
      <Tooltip
        value={
          <>
            {ctx.t("session.tab.add")}
            <Show when={ctx.keybinds.keybind(`${ctx.id}.open`).length > 0}>
              <Keybind keys={[...ctx.keybinds.keybind(`${ctx.id}.open`)]} variant="neutral" />
            </Show>
          </>
        }
        placement="bottom"
        class="flex items-center"
      >
        <IconButton
          icon={<Icon name="plus" />}
          variant="ghost-muted"
          size="large"
          aria-label={ctx.t("session.tab.add")}
          onClick={() => ctx.layout.open(key, input.session, { tab: "select" })}
        />
      </Tooltip>
    ),
  })
}

export default setup
