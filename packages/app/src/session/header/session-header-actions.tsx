import { For, Show } from "solid-js"
import { Icon } from "@aigcfroge/ui/icon"
import { IconButton } from "@aigcfroge/ui/icon-button"
import { Keybind } from "@aigcfroge/ui/keybind"
import { Tooltip } from "@aigcfroge/ui/tooltip"
import { useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { useSessionLayout } from "@/session/session-layout"
import { useLayout } from "@/shell/state/layout"

export function SessionReviewToggle() {
  const command = useCommand()
  const language = useLanguage()
  const sessionLayout = useSessionLayout()
  const layout = useLayout()

  return (
    <SessionHeaderActions
      state={{
        projectLabel: language.t("home.projects"),
        projectKeybind: command.keybindParts("sidebar.toggle"),
        projectVisible: true,
        projectOpened: layout.sidebar.opened(),
        onProjectToggle: () => layout.sidebar.toggle(),
        reviewLabel: language.t("command.review.toggle"),
        reviewKeybind: command.keybindParts("review.toggle"),
        reviewVisible: true,
        reviewOpened: sessionLayout.view().side.opened(),
        onReviewToggle: () => sessionLayout.view().side.toggle(),
      }}
    />
  )
}

export type SessionHeaderActionsState = {
  projectLabel: string
  projectKeybind: string[]
  projectVisible: boolean
  projectOpened: boolean
  onProjectToggle: () => void
  reviewLabel: string
  reviewKeybind: string[]
  reviewVisible: boolean
  reviewOpened: boolean
  onReviewToggle: () => void
}

export function SessionHeaderActions(props: { state: SessionHeaderActionsState }) {
  return (
    <div class="flex items-center gap-2 rtl:flex-row-reverse">
      <For
        each={[
          {
            field: "project" as const,
            controls: "shell-project-sidebar",
            icon: "layout-left",
          },
          {
            field: "review" as const,
            controls: "session-side-panel-tabs",
            icon: "sidebar-right",
          },
        ]}
      >
        {(action) => (
          <Show when={props.state[`${action.field}Visible`]}>
            <Tooltip
              class="shrink-0"
              placement="bottom"
              value={
                <>
                  {props.state[`${action.field}Label`]}
                  <Show when={props.state[`${action.field}Keybind`].length > 0}>
                    <Keybind keys={props.state[`${action.field}Keybind`]} variant="neutral" />
                  </Show>
                </>
              }
            >
              <IconButton
                type="button"
                variant="ghost-muted"
                size="large"
                class="shrink-0"
                style={{
                  // This fixed control sits above moving panel contents.
                  "--v2-overlay-simple-overlay-hover": "var(--v2-background-bg-layer-01)",
                  "--v2-overlay-simple-overlay-pressed": "var(--v2-background-bg-layer-02)",
                }}
                state={props.state[`${action.field}Opened`] ? "pressed" : undefined}
                onClick={() =>
                  action.field === "project" ? props.state.onProjectToggle() : props.state.onReviewToggle()
                }
                aria-label={props.state[`${action.field}Label`]}
                aria-expanded={props.state[`${action.field}Opened`]}
                aria-controls={action.controls}
                icon={<Icon name={action.icon} />}
              />
            </Tooltip>
          </Show>
        )}
      </For>
    </div>
  )
}
