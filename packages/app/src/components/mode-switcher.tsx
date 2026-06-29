import { For } from "solid-js"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { IconButtonV2 } from "@aigcfroge/ui/v2/icon-button-v2"
import { TooltipV2 } from "@aigcfroge/ui/v2/tooltip-v2"
import { useLanguage } from "@/context/language"
import { useMode, MODES, type Mode } from "@/context/mode"

const MODE_ICONS: Record<Mode, string> = {
  chat: "mode-chat",
  coding: "mode-coding",
  work: "mode-work",
  assistant: "mode-assistant",
}

export function ModeSwitcher() {
  const mode = useMode()
  const language = useLanguage()

  return (
    <nav
      aria-label={language.t("mode.switcher")}
      class="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-v2-border-border-base bg-v2-background-bg-base px-2 pt-3"
    >
      <For each={MODES}>
        {(m) => {
          const active = () => mode.currentMode === m
          return (
            <TooltipV2 value={language.t(`mode.${m}` as const)} placement="right" gutter={8}>
              <IconButtonV2
                variant={active() ? "neutral" : "ghost-muted"}
                size="large"
                class="size-10 rounded-[8px]"
                icon={<Icon name={MODE_ICONS[m]} size="large" />}
                aria-label={language.t(`mode.${m}` as const)}
                aria-pressed={active()}
                onClick={() => mode.setCurrentMode(m)}
              />
            </TooltipV2>
          )
        }}
      </For>
      <div class="mt-auto pb-4">
        <TooltipV2
          value={language.t(mode.secondarySidebarOpen ? "sidebar.secondary.hide" : "sidebar.secondary.show")}
          placement="right"
          gutter={8}
        >
          <IconButtonV2
            variant="ghost-muted"
            size="large"
            class="size-10 rounded-[8px]"
            icon={<Icon name="sidebar-right" size="large" />}
            aria-label={language.t(mode.secondarySidebarOpen ? "sidebar.secondary.hide" : "sidebar.secondary.show")}
            aria-pressed={mode.secondarySidebarOpen}
            onClick={() => mode.toggleSecondarySidebar()}
          />
        </TooltipV2>
      </div>
    </nav>
  )
}
