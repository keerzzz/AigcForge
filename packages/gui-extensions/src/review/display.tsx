import { Switch } from "@omnixa/ui/switch"
import { useExtension } from "../sdk"
import type definition from "./index"

export default function DisplayRow() {
  const ctx = useExtension<typeof definition>()

  return (
    <div data-component="settings-row">
      <div data-slot="settings-row-copy">
        <div data-slot="settings-row-title">{ctx.t("settings.display.title")}</div>
      </div>
      <div data-slot="settings-row-control" data-action="settings-review-display">
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
  )
}
