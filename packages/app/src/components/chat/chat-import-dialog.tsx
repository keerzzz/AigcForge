import { createSignal } from "solid-js"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { Dialog } from "@aigcfroge/ui/v2/dialog-v2"
import { useDialog } from "@aigcfroge/ui/context/dialog"
import { useLanguage } from "@/context/language"

/** 包裹导入内容为 untrusted 格式：<untrusted_import> 标签 + 调用方提供的系统指令（i18n）。 */
export function wrapImportContent(text: string, instruction: string): string {
  return `<untrusted_import>\n${text}\n</untrusted_import>\n\n${instruction}`
}

export function ChatImportDialog(props: { onImport: (content: string) => void }) {
  const language = useLanguage()
  const dialog = useDialog()
  const [text, setText] = createSignal("")
  let fileInput: HTMLInputElement | undefined

  function handleFileSelect(e: Event) {
    if (!(e.target instanceof HTMLInputElement)) return
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== "string") return
      setText(result)
    }
    reader.readAsText(file)
  }

  function handleImport() {
    const content = text().trim()
    if (!content) return
    const wrapped = wrapImportContent(content, language.t("chatImport.untrustedInstruction"))
    props.onImport(wrapped)
    dialog.close()
  }

  return (
    <Dialog title={language.t("promptAsset.workbench.import")} fit>
      <div class="flex min-h-0 flex-col gap-3 p-4" style={{ width: "480px" }}>
        <textarea
          class="h-32 w-full resize-y rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-layer-03 p-3 text-v2-text-text-base outline-0 placeholder:text-v2-text-text-faint focus-visible:border-v2-border-border-focus text-13-regular"
          value={text()}
          onInput={(e) => setText(e.currentTarget.value)}
        />
        <div class="flex items-center gap-2">
          <input
            ref={(el) => { fileInput = el }}
            type="file"
            class="hidden"
            onChange={handleFileSelect}
          />
          <ButtonV2 variant="neutral" onClick={() => fileInput?.click()}>
            {language.t("dialog.directory.action.selectFile")}
          </ButtonV2>
        </div>
        <ButtonV2 variant="contrast" disabled={!text().trim()} onClick={handleImport}>
          {language.t("promptAsset.workbench.import")}
        </ButtonV2>
      </div>
    </Dialog>
  )
}
