import { useDialog } from "@aigcfroge/ui/context/dialog"
import { useGlobal } from "@/context/global"
import { useLanguage } from "@/context/language"
import { ServerConnection } from "@/context/server"
import { usePlatform } from "@/context/platform"
import { showToast } from "@/utils/toast"
import { lazy } from "solid-js"
import { DialogSelectDirectory } from "./dialog-select-directory"
import { directoryPickerKind, validateDirectorySelection } from "./directory-picker-policy"

const DialogSelectDirectoryV2 = lazy(() =>
  import("./dialog-select-directory-v2").then((module) => ({ default: module.DialogSelectDirectoryV2 })),
)

type DirectoryPickerInput = {
  server: ServerConnection.Any
  title?: string
  multiple?: boolean
  onSelect: (result: string | string[] | null) => void
}

export function useDirectoryPicker() {
  const platform = usePlatform()
  const dialog = useDialog()
  const global = useGlobal()
  const language = useLanguage()

  return (input: DirectoryPickerInput) => {
    if (directoryPickerKind(platform.platform, input.server) === "native" && platform.platform === "desktop") {
      void platform
        .openDirectoryPickerDialog({ title: input.title, multiple: input.multiple })
        .then(async (result) => {
          const sdk = global.ensureServerCtx(input.server).sdk
          try {
            input.onSelect(
              await validateDirectorySelection(result, (directory) =>
                sdk.client.file.list({ directory, path: "" }).then((response) => response.data),
              ),
            )
          } catch {
            showToast({ title: language.t("dialog.directory.readError") })
          }
        })
      return
    }

    let selected = false
    const onSelect = (result: string | string[] | null) => {
      selected = result !== null
      input.onSelect(result)
    }
    const cancel = () => {
      if (!selected) input.onSelect(null)
    }
    if (platform.platform === "desktop" && true) {
      void dialog.show(() => <DialogSelectDirectoryV2 {...input} onSelect={onSelect} />, cancel)
      return
    }
    void dialog.show(() => <DialogSelectDirectory {...input} onSelect={onSelect} />, cancel)
  }
}
