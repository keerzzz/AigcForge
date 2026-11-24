import { Wordmark } from "@omnixa/ui/wordmark"
import { useDialog } from "@omnixa/ui/context/dialog"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { ExternalLink } from "@/runtime/platform/external-link"
import { showToast } from "@/shell/notifications/toast"
export function SettingsAbout(_props: { active: boolean }) {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()

  let noticesButton: HTMLButtonElement | undefined

  const showNotices = async () => {
    // The license texts load only when someone reads them.
    const loaded = await import("./notices/dialog").catch(() => undefined)

    if (!loaded) {
      showToast({ variant: "error", title: language.t("settings.about.notices.loadFailed") })

      return
    }

    // dialog.show has no trigger for Kobalte to restore, so closing returns focus to the button by hand.
    void dialog.show(() => (
      <loaded.default
        onCloseAutoFocus={(event) => {
          if (!noticesButton?.isConnected) return
          event.preventDefault()
          noticesButton.focus({ preventScroll: true })
        }}
      />
    ))
  }

  return (
    <div class="settings-about-content">
      <Wordmark class="settings-about-wordmark" fade={false} muted={false} />
      <div class="settings-about-intro">
        <p>{language.t("settings.about.description")}</p>
        <p>
          {language.t("settings.about.version", {
            version: platform.version ?? language.t("settings.about.devVersion"),
          })}
        </p>
        <p>
          <ExternalLink href="https://github.com/keerzzz/AigcForge/blob/main/LICENSE">
            {language.t("settings.about.license")}
          </ExternalLink>
        </p>
      </div>
      <dl class="settings-about-details">
        <div>
          <dt>{language.t("settings.about.repository")}</dt>
          <dd>
            <ExternalLink href="https://github.com/keerzzz/AigcForge">keerzzz/AigcForge</ExternalLink>
          </dd>
        </div>
        <div>
          <dt>{language.t("settings.about.maintainer")}</dt>
          <dd>
            <ExternalLink href="https://github.com/keerzzz">keerzzz</ExternalLink>
          </dd>
        </div>
        <div>
          <dt>{language.t("settings.about.contributors")}</dt>
          <dd>
            <ExternalLink href="https://github.com/keerzzz/AigcForge/graphs/contributors">
              {language.t("settings.about.viewContributors")}
            </ExternalLink>
          </dd>
        </div>
        <div>
          <dt>{language.t("settings.about.upstream")}</dt>
          <dd>
            <ExternalLink href="https://github.com/anomalyco/opencode">OpenCode</ExternalLink>
          </dd>
        </div>
      </dl>
      <div class="settings-about-notices">
        <p>
          <button ref={noticesButton} type="button" class="settings-about-link" onClick={() => void showNotices()}>
            {language.t("settings.about.notices.title")}
          </button>
        </p>
      </div>
    </div>
  )
}
