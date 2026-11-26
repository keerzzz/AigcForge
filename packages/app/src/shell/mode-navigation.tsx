import { createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { useLocation, useNavigate } from "@solidjs/router"
import { ProductMode } from "@omnixa/schema/product-mode"
import { Button } from "@omnixa/ui/button"
import { useDialog } from "@omnixa/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@omnixa/ui/dialog"
import { Icon } from "@omnixa/ui/icon"
import { IconButton } from "@omnixa/ui/icon-button"
import { type IconName } from "@omnixa/ui/icons/catalog"
import { TextField } from "@omnixa/ui/text-field"
import { Tooltip } from "@omnixa/ui/tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useGlobal } from "@/runtime/server/runtime"
import { useSettingsSurface } from "@/settings/surface"
import { useLayout } from "@/shell/state/layout"
import { useTabs } from "@/shell/tabs/tabs"
import {
  CUSTOM_MODE_ICON_POOL,
  type CustomRailMode,
  activeRailModeID,
  customModeHref,
  nextCycleIcon,
  resolveRailIcon,
  useModeRail,
} from "./mode-rail"
import { ModeRoute } from "./routes/mode"
import "./mode-navigation.css"

const REPO_URL = "https://github.com/keerzzz/AigcForge"
const HELP_URL = "https://github.com/keerzzz/AigcForge/issues/new"

const builtinIcons = {
  chat: "rail-chat",
  coding: "rail-coding",
  work: "rail-work",
  assistant: "rail-assistant",
  custom: "rail-custom",
} satisfies Record<ProductMode.ID, IconName>

export function RailNavButton(props: {
  icon: IconName
  label: string
  active?: boolean
  iconSize?: "normal" | "large"
  onClick: () => void
}) {
  return (
    <Tooltip value={props.label} placement="right">
      <Button
        type="button"
        variant="ghost-muted"
        size="large"
        class="mode-navigation-item"
        aria-label={props.label}
        aria-current={props.active ? "page" : undefined}
        onClick={props.onClick}
      >
        <Icon name={props.icon} size={props.iconSize ?? "large"} />
        <span data-slot="active-indicator" aria-hidden="true" />
      </Button>
    </Tooltip>
  )
}

function AddModeDialog(props: {
  items: () => readonly CustomRailMode[]
  onAdd: (input: { label: string; icon: IconName }) => CustomRailMode | undefined
  onUpdateIcon: (id: string, icon: IconName) => void
  onRemove: (id: string) => void
  onNavigate: (href: string) => void
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const [state, setState] = createStore<{ label: string; icon: IconName }>({
    label: "",
    icon: nextCycleIcon(props.items().map((item) => resolveRailIcon(item.icon))),
  })

  const submit = (event: SubmitEvent) => {
    event.preventDefault()
    const created = props.onAdd({ label: state.label, icon: state.icon })
    if (!created) return
    dialog.close()
    props.onNavigate(customModeHref(created.id, { compose: true }))
  }

  const cycleExistingIcon = (item: CustomRailMode) => {
    const current = resolveRailIcon(item.icon)
    const index = CUSTOM_MODE_ICON_POOL.findIndex((icon) => icon === current)
    const next = CUSTOM_MODE_ICON_POOL[(index + 1) % CUSTOM_MODE_ICON_POOL.length]
    props.onUpdateIcon(item.id, next)
  }

  return (
    <Dialog size="normal" fit>
      <DialogHeader closeLabel={language.t("common.close")}>
        <DialogTitle>{language.t("mode.navigation.add.title")}</DialogTitle>
      </DialogHeader>
      <form onSubmit={submit} class="flex min-h-0 w-full flex-1 flex-col">
        <DialogBody class="min-h-0 flex-1">
          <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-1 pb-2">
            <p class="text-13-regular text-text-weak">{language.t("mode.navigation.add.description")}</p>
            <TextField
              autofocus
              label={language.t("mode.navigation.add.name.label")}
              placeholder={language.t("mode.navigation.add.name.placeholder")}
              value={state.label}
              onChange={(value) => setState("label", value)}
            />
            <div class="flex flex-col gap-2">
              <span class="text-13-medium text-text-base">{language.t("mode.navigation.add.icon.label")}</span>
              <div
                role="radiogroup"
                aria-label={language.t("mode.navigation.add.icon.label")}
                class="grid grid-cols-6 gap-2"
              >
                <For each={CUSTOM_MODE_ICON_POOL}>
                  {(icon) => {
                    const selected = () => state.icon === icon
                    return (
                      <button
                        type="button"
                        role="radio"
                        aria-label={icon}
                        aria-checked={selected()}
                        onClick={() => setState("icon", icon)}
                        class="flex h-10 items-center justify-center rounded-md border transition-colors focus-visible:border-v2-border-border-focus focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_1px_var(--v2-border-border-focus)]"
                        classList={{
                          "border-v2-border-border-focus bg-v2-background-bg-layer-02 text-v2-icon-icon-base":
                            selected(),
                          "border-v2-border-border-base bg-transparent text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover":
                            !selected(),
                        }}
                      >
                        <Icon name={icon} size="normal" />
                      </button>
                    )
                  }}
                </For>
              </div>
            </div>
            <Show when={props.items().length > 0}>
              <div class="flex flex-col gap-2 border-t border-border-weak-base pt-3">
                <span class="text-13-medium text-text-base">{language.t("mode.navigation.add.existing")}</span>
                <div class="flex max-h-40 flex-col gap-1.5 overflow-y-auto">
                  <For each={props.items()}>
                    {(item) => (
                      <div class="flex items-center justify-between gap-2 rounded-md border border-v2-border-border-base px-2.5 py-1.5">
                        <div class="flex min-w-0 items-center gap-2">
                          <Icon
                            name={resolveRailIcon(item.icon)}
                            size="small"
                            class="shrink-0 text-v2-icon-icon-base"
                          />
                          <span class="truncate text-13-medium text-text-base">{item.label}</span>
                        </div>
                        <div class="flex shrink-0 items-center gap-1">
                          <IconButton
                            type="button"
                            variant="ghost"
                            icon={<Icon name="outline-sliders" size="small" />}
                            aria-label={language.t("mode.navigation.add.cycleIcon", { name: item.label })}
                            onClick={() => cycleExistingIcon(item)}
                          />
                          <IconButton
                            type="button"
                            variant="ghost"
                            icon={<Icon name="trash" size="small" />}
                            aria-label={language.t("mode.navigation.add.remove", { name: item.label })}
                            onClick={() => props.onRemove(item.id)}
                          />
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" variant="contrast" disabled={!state.label.trim()}>
            {language.t("mode.navigation.add.submit")}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}

function HelpDialog(props: {
  onOpenShortcuts: () => void
  onOpenAbout: () => void
  onOpenExternal: (url: string) => void
}) {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()

  const items: {
    icon: IconName
    label: string
    external?: boolean
    action: () => void
  }[] = [
    {
      icon: "keyboard",
      label: language.t("settings.shortcuts.title"),
      action: () => {
        dialog.close()
        props.onOpenShortcuts()
      },
    },
    {
      icon: "info",
      label: language.t("settings.tab.about"),
      action: () => {
        dialog.close()
        props.onOpenAbout()
      },
    },
    {
      icon: "globe",
      label: language.t("settings.about.repository"),
      external: true,
      action: () => {
        dialog.close()
        props.onOpenExternal(REPO_URL)
      },
    },
    {
      icon: "help",
      label: language.t("sidebar.help.reportIssue"),
      external: true,
      action: () => {
        dialog.close()
        props.onOpenExternal(HELP_URL)
      },
    },
  ]

  return (
    <Dialog size="normal" fit>
      <DialogHeader closeLabel={language.t("common.close")}>
        <DialogTitle>{language.t("sidebar.help")}</DialogTitle>
      </DialogHeader>
      <DialogBody class="min-h-0 flex-1">
        <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-1 pb-2">
          <div class="flex items-center justify-between gap-2 text-13-regular text-text-weak">
            <span>{language.t("sidebar.help.description")}</span>
            <span class="shrink-0">
              {language.t("settings.about.version", {
                version: platform.version ?? language.t("settings.about.devVersion"),
              })}
            </span>
          </div>
          <div class="flex flex-col gap-1.5">
            <For each={items}>
              {(item) => (
                <button
                  type="button"
                  onClick={item.action}
                  class="flex w-full items-center justify-between gap-3 rounded-md border border-v2-border-border-base px-3 py-2.5 text-left text-13-medium text-text-base transition-colors hover:bg-v2-overlay-simple-overlay-hover focus-visible:border-v2-border-border-focus focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_1px_var(--v2-border-border-focus)]"
                >
                  <span class="flex min-w-0 items-center gap-2.5">
                    <Icon name={item.icon} size="small" class="shrink-0 text-v2-icon-icon-muted" />
                    <span class="truncate">{item.label}</span>
                  </span>
                  <Show when={item.external}>
                    <Icon name="arrow-up-right" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                  </Show>
                </button>
              )}
            </For>
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={() => dialog.close()}>
          {language.t("common.close")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

export function ModeNavigation() {
  const language = useLanguage()
  const navigate = useNavigate()
  const location = useLocation()
  const layout = useLayout()
  const tabs = useTabs()
  const global = useGlobal()
  const settings = useSettingsSurface()
  const platform = usePlatform()
  const dialog = useDialog()
  const rail = useModeRail()
  const mobile = createMediaQuery("(max-width: 767px)")
  const opened = layout.navigation.opened

  const activeCustomID = createMemo(() => {
    const route = layout.route()
    if (route.type !== "mode" || route.mode !== "custom") return undefined
    const id = activeRailModeID(location.search)
    if (!id) return undefined
    return rail.items().some((item) => item.id === id) ? id : undefined
  })

  const current = createMemo(() => {
    const route = layout.route()

    if (route.type === "mode") return ModeRoute.sourceMode(route, undefined, undefined)

    if (route.type === "draft") {
      const draft = tabs.store.find((tab) => tab.type === "draft" && tab.draftID === route.draftID)

      return ModeRoute.sourceMode(route, draft?.type === "draft" ? draft : undefined, undefined)
    }

    if (route.type !== "session") return

    return ModeRoute.sourceMode(
      route,
      tabs.pendingSession(route.server, route.sessionId)?.draft,
      global.serverCtx(route.server)?.data.session.get(route.sessionId),
    )
  })

  const label = (mode: ProductMode.ID) =>
    mode === "custom" ? language.t("home.sessions.mode.custom") : language.t(`newSession.mode.${mode}`)

  const openAddMode = () => {
    void dialog.show(() => (
      <AddModeDialog
        items={rail.items}
        onAdd={rail.addMode}
        onUpdateIcon={rail.updateModeIcon}
        onRemove={rail.removeMode}
        onNavigate={(href) => navigate(href)}
      />
    ))
  }

  return (
    <div class="mode-navigation [app-region:no-drag]" data-opened={opened()}>
      <nav
        id="global-mode-navigation"
        aria-label={language.t("mode.navigation.label")}
        aria-hidden={!opened()}
        inert={!opened()}
        class="mode-navigation-rail"
      >
        <div class="mode-navigation-section">
          <For each={ProductMode.ID.literals}>
            {(mode) => (
              <RailNavButton
                icon={builtinIcons[mode]}
                label={label(mode)}
                active={current() === mode && activeCustomID() === undefined}
                onClick={() => navigate(ModeRoute.href(mode))}
              />
            )}
          </For>
        </div>

        <Show when={!mobile()}>
          <div class="mode-navigation-custom" aria-label={language.t("mode.navigation.custom.label")}>
            <For each={rail.items()}>
              {(item) => (
                <RailNavButton
                  icon={resolveRailIcon(item.icon)}
                  label={item.label}
                  iconSize="normal"
                  active={activeCustomID() === item.id}
                  onClick={() => navigate(customModeHref(item.id))}
                />
              )}
            </For>
            <RailNavButton
              icon="plus"
              iconSize="normal"
              label={language.t("mode.navigation.add")}
              onClick={openAddMode}
            />
          </div>

          <div class="mode-navigation-footer">
            <RailNavButton
              icon="settings-gear"
              iconSize="normal"
              label={language.t("sidebar.settings")}
              active={settings.active()}
              onClick={() => settings.open()}
            />
            <RailNavButton
              icon="help"
              iconSize="normal"
              label={language.t("sidebar.help")}
              onClick={() =>
                dialog.show(() => (
                  <HelpDialog
                    onOpenShortcuts={() => settings.open("shortcuts")}
                    onOpenAbout={() => settings.open("about")}
                    onOpenExternal={(url) => platform.openExternal(url)}
                  />
                ))
              }
            />
          </div>
        </Show>
      </nav>
    </div>
  )
}

export * as Modes from "./mode-navigation"
