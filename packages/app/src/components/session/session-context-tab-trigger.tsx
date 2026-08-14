import { Show, type Accessor } from "solid-js"
import { TabsV2 } from "@aigcfroge/ui/v2/tabs-v2"
import { IconButton } from "@aigcfroge/ui/icon-button"
import { TooltipKeybind } from "@/components/tooltip-keybind"
import { SessionContextUsage } from "@/components/session-context-usage"
import { SessionContextTab } from "./session-context-tab"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"

/** Dynamic context tab trigger shared by the coding/chat/assistant right panels. */
export function SessionContextTabTrigger(props: { contextOpen: Accessor<boolean>; onClose: () => void }) {
  const language = useLanguage()
  const command = useCommand()
  return (
    <Show when={props.contextOpen()}>
      <TabsV2.Trigger
        value="context"
        closeButton={
          <TooltipKeybind
            title={language.t("common.closeTab")}
            keybind={command.keybind("tab.close")}
            placement="bottom"
            gutter={10}
          >
            <IconButton
              icon="close-small"
              variant="ghost"
              class="h-5 w-5"
              onClick={props.onClose}
              aria-label={language.t("common.closeTab")}
            />
          </TooltipKeybind>
        }
        hideCloseButton
        onMiddleClick={props.onClose}
      >
        <div class="flex items-center gap-2">
          <SessionContextUsage variant="indicator" />
          <div>{language.t("session.tab.context")}</div>
        </div>
      </TabsV2.Trigger>
    </Show>
  )
}

/** Dynamic context tab content shared by the coding/chat right panels. */
export function SessionContextTabPanel(props: {
  contextOpen: Accessor<boolean>
  active: Accessor<string | undefined>
}) {
  return (
    <Show when={props.contextOpen()}>
      <TabsV2.Content value="context" class="flex flex-col h-full overflow-hidden contain-strict">
        <Show when={props.active() === "context"}>
          <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
            <SessionContextTab />
          </div>
        </Show>
      </TabsV2.Content>
    </Show>
  )
}
