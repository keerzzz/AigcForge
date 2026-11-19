import { Switch } from "@aigcfroge/ui/switch"
import { useExtension } from "../sdk"
import type definition from "./index"

export default function DisplayRow() {
  const ctx = useExtension<typeof definition>()

  return (
    <>
      <div data-component="settings-row">
        <div data-slot="settings-row-copy">
          <div data-slot="settings-row-title">{ctx.t("settings.display.title")}</div>
        </div>
        <div data-slot="settings-row-control" data-action="settings-file-display">
          <Switch
            aria-label={ctx.t("settings.display.title")}
            checked={ctx.stores.display.value.visible}
            onChange={(visible) =>
              ctx.stores.display.update((draft) => {
                draft.visible = visible
              })
            }
            hideLabel
          >
            {ctx.t("settings.display.title")}
          </Switch>
        </div>
      </div>
      <div data-component="settings-row">
        <div data-slot="settings-row-copy">
          <div data-slot="settings-row-title">{ctx.t("settings.preview.title")}</div>
          <div data-slot="settings-row-description">{ctx.t("settings.preview.description")}</div>
        </div>
        <div data-slot="settings-row-control" data-action="settings-file-preview">
          <Switch
            aria-label={ctx.t("settings.preview.title")}
            checked={ctx.stores.preview.value.enabled}
            onChange={(enabled) =>
              ctx.stores.preview.update((draft) => {
                draft.enabled = enabled
              })
            }
            hideLabel
          >
            {ctx.t("settings.preview.title")}
          </Switch>
        </div>
      </div>
    </>
  )
}
