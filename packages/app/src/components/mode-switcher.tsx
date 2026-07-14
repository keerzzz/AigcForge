import { For } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { IconButtonV2 } from "@aigcfroge/ui/v2/icon-button-v2"
import { TooltipV2 } from "@aigcfroge/ui/v2/tooltip-v2"
import { useLanguage } from "@/context/language"
import { MODE_DEFINITIONS, useMode } from "@/context/mode"
import { useDialog } from "@aigcfroge/ui/context/dialog"
import { DialogSettings } from "@/components/settings-v2"
import { usePlatform } from "@/context/platform"

export function ModeSwitcher() {
  const mode = useMode()
  const language = useLanguage()
  const dialog = useDialog()
  const navigate = useNavigate()
  const platform = usePlatform()

  return (
    <nav
      aria-label={language.t("mode.switcher")}
      class="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-v2-border-border-base bg-v2-background-bg-base px-2 pt-3"
    >
      <For each={MODE_DEFINITIONS}>
        {(item) => {
          const active = () => mode.currentMode === item.id
          return (
            <TooltipV2 value={language.t(item.labelKey)} placement="right" gutter={8}>
              <IconButtonV2
                variant={active() ? "neutral" : "ghost-muted"}
                size="large"
                class="size-10 rounded-[8px]"
                icon={<Icon name={item.icon} size="large" />}
                aria-label={language.t(item.labelKey)}
                aria-pressed={active()}
                onClick={() => navigate(item.href)}
              />
            </TooltipV2>
          )
        }}
      </For>

      <div class="mt-auto flex flex-col items-center gap-1 pb-4">
        <TooltipV2 value={language.t("sidebar.help")} placement="right" gutter={8}>
          <IconButtonV2
            variant="ghost-muted"
            size="large"
            class="size-10 rounded-[8px]"
            icon={<Icon name="help" size="large" />}
            aria-label={language.t("sidebar.help")}
            onClick={() => platform.openLink("https://aigcfroge.ai/desktop-feedback")}
          />
        </TooltipV2>

        <TooltipV2 value={language.t("sidebar.settings")} placement="right" gutter={8}>
          <IconButtonV2
            variant="ghost-muted"
            size="large"
            class="size-10 rounded-[8px]"
            icon={<Icon name="settings-gear" size="large" />}
            aria-label={language.t("sidebar.settings")}
            onClick={() => dialog.show(() => <DialogSettings />)}
          />
        </TooltipV2>
      </div>
    </nav>
  )
}
