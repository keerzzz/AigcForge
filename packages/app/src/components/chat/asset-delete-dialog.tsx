import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { Dialog } from "@aigcfroge/ui/v2/dialog-v2"
import { useDialog } from "@aigcfroge/ui/context/dialog"
import { useLanguage } from "@/context/language"
import type { AssetRow } from "./asset-workbench"

export function AssetDeleteDialog(props: {
  asset: AssetRow
  onDelete: () => Promise<boolean> | boolean
}) {
  const language = useLanguage()
  const dialog = useDialog()

  async function handleDelete() {
    const ok = await props.onDelete()
    if (ok) dialog.close()
  }

  return (
    <Dialog title={language.t("promptAsset.asset.deleteConfirm")} fit>
      <div class="flex min-h-0 flex-col gap-4 p-4" style={{ width: "400px" }}>
        <div class="flex flex-col gap-2">
          <div class="flex gap-2 text-13-regular">
            <span class="text-v2-text-text-faint">{language.t("promptAsset.list.kind")}:</span>
            <span class="text-v2-text-text-base">{props.asset.kind}</span>
          </div>
          <div class="flex gap-2 text-13-regular">
            <span class="text-v2-text-text-faint">{language.t("promptAsset.list.name")}:</span>
            <span class="text-v2-text-text-base">{props.asset.name || props.asset.relativePath}</span>
          </div>
          <div class="flex gap-2 text-13-regular">
            <span class="text-v2-text-text-faint">{language.t("promptAsset.list.description")}:</span>
            <span class="text-v2-text-text-base">{props.asset.description || "—"}</span>
          </div>
          <div class="flex gap-2 text-13-regular">
            <span class="text-v2-text-text-faint">{language.t("promptAsset.list.path")}:</span>
            <span class="text-v2-text-text-base">{props.asset.relativePath}</span>
          </div>
        </div>
        <p class="text-v2-state-fg-danger text-13-regular">
          {language.t("promptAsset.asset.deleteIrreversible")}
        </p>
        <div class="flex justify-end gap-2">
          <ButtonV2 variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </ButtonV2>
          <ButtonV2 variant="contrast" onClick={handleDelete}>
            {language.t("promptAsset.workbench.delete")}
          </ButtonV2>
        </div>
      </div>
    </Dialog>
  )
}
