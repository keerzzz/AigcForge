import { Suspense, type ParentProps } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { Titlebar } from "@/shell/titlebar/titlebar"
import { usePlatform } from "@/runtime/platform/platform"
import { ToastRegion } from "@/shell/notifications/toast"
import { UploadToastHost } from "@/composer/attachments/uploads"
import { TitlebarRightProvider } from "@/shell/titlebar/right-slot"
import { useSettingsSurface } from "@/settings/surface"
import { useSettings } from "@/settings/model"
import { ExtensionServerCover } from "@/runtime/extension/server-shell"
import { ExtensionSlot } from "@/runtime/extension/render"
import { Modes } from "./mode-navigation"
import { useLayout } from "./state/layout"
import { useCommand } from "./commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { ShellFooter, ShellFooterProvider } from "./footer"

export default function Layout(props: ParentProps) {
  const platform = usePlatform()
  const settings = useSettingsSurface()
  const preferences = useSettings()
  const mobile = createMediaQuery("(max-width: 767px)")
  const layout = useLayout()
  const command = useCommand()
  const language = useLanguage()

  command.register(() => [
    {
      id: "sidebar.toggle",
      title: language.t("desktop.menu.toggleSidebar"),
      category: language.t("command.category.view"),
      keybind: "mod+b",
      disabled: layout.route().type !== "session" || mobile(),
      onSelect: () => {
        if (layout.route().type !== "session" || mobile()) return

        layout.sidebar.toggle()
      },
    },
  ])

  const bottomTitlebar = () => mobile() && preferences.general.mobileTitlebarPosition() === "bottom"

  return (
    <TitlebarRightProvider>
      <ShellFooterProvider>
        <div
          class="relative bg-v2-background-bg-deep flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
          style={{
            // Mobile panels only need clearance for their outer border.
            "--shell-inline-inset": mobile() ? "1px" : "8px",
            // A bottom mobile titlebar leaves main's top edge to the safe area. Native Windows chrome supplies the gap;
            // retain outer-outline clearance.
            "--shell-top-inset": bottomTitlebar()
              ? "0px"
              : platform.platform === "desktop" && platform.os === "windows"
                ? "1px"
                : "8px",
            "--shell-bottom-inset": bottomTitlebar()
              ? "8px"
              : "max(0px, calc(8px - var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))))",
          }}
        >
          <Titlebar />
          <div class="flex flex-1 min-h-0 min-w-0 flex-row">
            <Modes.ModeNavigation />
            {/* Size containment collapses percentage-height descendants in WebKit. */}
            <main
              class="flex-1 min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-content"
              style={{
                "padding-top": bottomTitlebar() ? "env(safe-area-inset-top, 0px)" : "0px",
                "padding-bottom":
                  bottomTitlebar() || settings.active()
                    ? "0px"
                    : "var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))",
                "--settings-bottom-inset": bottomTitlebar()
                  ? "40px"
                  : "var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))",
              }}
            >
              <ExtensionServerCover>
                <Suspense>{props.children}</Suspense>
              </ExtensionServerCover>
            </main>
          </div>
          <ShellFooter />
          <ExtensionSlot at="window.bottom" input={{}} />
          <ToastRegion />
          <UploadToastHost />
        </div>
      </ShellFooterProvider>
    </TitlebarRightProvider>
  )
}
