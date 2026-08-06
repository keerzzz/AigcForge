import { For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { Dialog, DialogFooter } from "@aigcfroge/ui/v2/dialog-v2"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { useDialog } from "@aigcfroge/ui/context/dialog"
import { useLanguage } from "@/context/language"
import type { ImportParserClient } from "@/context/sdk-types"

type FileType = "code" | "config" | "document"
type ImportMode = "paste" | "file" | "folder"
type DialogPhase = "input" | "result"

interface ParseResult {
  candidates: Array<{ kind: string; name: string; description: string; template: string }>
  warnings: string[]
  errors: Array<{ section: string; reason: string }>
}

const CODE_EXTENSIONS = new Set([
  "c",
  "cpp",
  "css",
  "go",
  "h",
  "hpp",
  "java",
  "js",
  "jsx",
  "less",
  "py",
  "rs",
  "scss",
  "sh",
  "ts",
  "tsx",
  "zsh",
])
const CONFIG_EXTENSIONS = new Set(["cfg", "conf", "env", "ini", "json", "toml", "yaml", "yml"])
const DOCUMENT_EXTENSIONS = new Set(["adoc", "md", "rst", "text", "txt"])

export interface FileEntry {
  name: string
  relativePath: string
  size: number
  type: FileType
  content: string
}

export type ImportResult =
  | { type: "paste"; content: string }
  | { type: "file"; entries: FileEntry[] }
  | { type: "folder"; entries: FileEntry[] }

export interface ChatImportDialogProps {
  onImport: (result: ImportResult) => void
  client?: ImportParserClient
}

function detectFileType(name: string, mime: string): FileType | undefined {
  const extension = name.split(".").pop()?.toLowerCase() ?? ""
  if (CODE_EXTENSIONS.has(extension)) return "code"
  if (CONFIG_EXTENSIONS.has(extension)) return "config"
  if (DOCUMENT_EXTENSIONS.has(extension) || mime.startsWith("text/")) return "document"
  return undefined
}

function fileTypeIcon(type: FileType) {
  if (type === "code") return "mode-coding" as const
  if (type === "config") return "settings-gear" as const
  return "mode-chat" as const
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Serialize a folder without discarding file contents before the model reviews it. */
export function serializeFolder(entries: FileEntry[]) {
  const sorted = [...entries].sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  const root = sorted[0]?.relativePath.split("/")[0] ?? "imported"
  return [
    `Folder: ${root} (${sorted.length} files)`,
    "",
    ...sorted.flatMap((entry, index) => [
      `=== ${entry.relativePath} ===`,
      entry.content,
      ...(index < sorted.length - 1 ? [""] : []),
    ]),
  ].join("\n")
}

export function serializeImport(result: ImportResult) {
  if (result.type === "paste") return result.content
  if (result.type === "folder") return serializeFolder(result.entries)
  const entry = result.entries[0]
  if (!entry) return ""
  return `File: ${entry.name}\n\n${entry.content}`
}

/** Keep imported text outside the instruction trust boundary. */
export function wrapImportContent(text: string, instruction: string) {
  const escaped = text.replaceAll(/<\/untrusted_import>/gi, "<\\/untrusted_import>")
  return `<untrusted_import>\n${escaped}\n</untrusted_import>\n\n${instruction}`
}

function FileTreeRow(props: { entry: FileEntry; selected: boolean; onSelect: () => void }) {
  const depth = () => Math.max(0, props.entry.relativePath.split("/").length - 2)
  return (
    <button
      type="button"
      class="flex w-full items-center gap-2 rounded-[4px] py-1 pr-2 text-left hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-v2-border-border-focus"
      classList={{ "bg-v2-background-bg-layer-03": props.selected }}
      style={{ "padding-left": `${8 + depth() * 12}px` }}
      onClick={props.onSelect}
    >
      <Icon name={fileTypeIcon(props.entry.type)} size="small" class="shrink-0 text-v2-icon-icon-muted" />
      <span class="min-w-0 flex-1 truncate text-v2-text-text-base text-12-regular">{props.entry.name}</span>
      <span class="shrink-0 text-v2-text-text-faint text-11-regular">{formatSize(props.entry.size)}</span>
    </button>
  )
}

async function readEntry(file: File): Promise<FileEntry | undefined> {
  const type = detectFileType(file.name, file.type)
  if (!type) return undefined
  try {
    return {
      name: file.name,
      relativePath: file.webkitRelativePath || file.name,
      size: file.size,
      type,
      content: await file.text(),
    } satisfies FileEntry
  } catch {
    return undefined
  }
}

export function ChatImportDialog(props: ChatImportDialogProps) {
  const language = useLanguage()
  const dialog = useDialog()
  const [state, setState] = createStore({
    mode: "paste" as ImportMode,
    text: "",
    entries: [] as FileEntry[],
    selectedPath: "",
    skippedFiles: 0,
    loading: false,
    phase: "input" as DialogPhase,
    parseResult: undefined as ParseResult | undefined,
    parsing: false,
    parseError: undefined as string | undefined,
  })

  let fileInput: HTMLInputElement | undefined
  let folderInput: HTMLInputElement | undefined

  const selectedEntry = () =>
    state.entries.find((entry) => entry.relativePath === state.selectedPath) ?? state.entries[0]
  const totalSize = () => state.entries.reduce((sum, entry) => sum + entry.size, 0)
  const canImport = () => (state.mode === "paste" ? state.text.trim().length > 0 : state.entries.length > 0)
  const hasFatalErrors = () => state.parseResult && state.parseResult.candidates.length === 0 && state.parseResult.errors.length > 0

  function openFilePicker() {
    if (!fileInput) return
    fileInput.value = ""
    fileInput.click()
  }

  function openFolderPicker() {
    if (!folderInput) return
    folderInput.value = ""
    folderInput.click()
  }

  async function handleSingleFile(event: Event) {
    if (!(event.currentTarget instanceof HTMLInputElement)) return
    const file = event.currentTarget.files?.[0]
    if (!file) return

    setState({ mode: "file", loading: true, entries: [], selectedPath: "", skippedFiles: 0 })
    try {
      const entry = await readEntry(file)
      if (!entry) {
        setState({ skippedFiles: 1 })
        return
      }
      setState({ entries: [entry], selectedPath: entry.relativePath })
    } finally {
      setState({ loading: false })
    }
  }

  async function handleFolderSelect(event: Event) {
    if (!(event.currentTarget instanceof HTMLInputElement)) return
    const files = Array.from(event.currentTarget.files ?? [])
    if (files.length === 0) return

    setState({ mode: "folder", loading: true, entries: [], selectedPath: "", skippedFiles: 0 })
    try {
      const loaded = await Promise.all(files.map(readEntry))
      const entries = loaded
        .filter((entry): entry is FileEntry => entry !== undefined)
        .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
      setState({
        entries,
        selectedPath: entries[0]?.relativePath ?? "",
        skippedFiles: files.length - entries.length,
      })
    } finally {
      setState({ loading: false })
    }
  }

  function buildResult(): ImportResult {
    return state.mode === "paste"
      ? { type: "paste", content: state.text.trim() }
      : { type: state.mode, entries: state.entries }
  }

  async function handleParse() {
    const result = buildResult()
    const content = serializeImport(result)
    if (!content.trim() || !props.client) return

    setState({ parsing: true, parseError: undefined, parseResult: undefined })
    try {
      const response = await props.client.importParser.parse({ content }, { throwOnError: true })
      setState({
        parsing: false,
        phase: "result",
        parseResult: {
          candidates: response.data.candidates ?? [],
          warnings: response.data.warnings ?? [],
          errors: response.data.errors ?? [],
        },
      })
    } catch {
      setState({ parsing: false, parseError: "Parse failed" })
    }
  }

  /** Fallback to AI-assisted import (old flow). */
  function handleAiFallback() {
    props.onImport(buildResult())
    dialog.close()
  }

  /** Go back to input mode. */
  function handleBack() {
    setState({ phase: "input", parseResult: undefined, parseError: undefined })
  }

  function handleImport() {
    const result = buildResult()
    if (!serializeImport(result).trim()) return
    props.onImport(result)
    dialog.close()
  }

  // -- Result view --

  function ResultView() {
    const pr = state.parseResult
    if (!pr) return null

    return (
      <div class="flex min-h-[280px] flex-1 flex-col gap-3">
        <div class="flex items-center gap-2">
          <button type="button" onClick={handleBack} class="text-v2-text-text-muted hover:text-v2-text-text-base">
            <Icon name="chevron-left" size="small" />
          </button>
          <span class="text-v2-text-text-base text-13-semibold">{language.t("chatImport.parseResult")}</span>
        </div>

        <Show when={pr.warnings.length > 0}>
          <div class="rounded-[6px] border border-v2-state-border-warning bg-v2-state-bg-warning px-3 py-2">
            <For each={pr.warnings}>{(w) => <div class="text-v2-state-fg-warning text-11-regular">{w}</div>}</For>
          </div>
        </Show>

        <Show when={pr.candidates.length > 0}>
          <div class="flex flex-col gap-2">
            <For each={pr.candidates}>
              {(c, i) => (
                <div class="rounded-[6px] border border-v2-border-border-base p-3">
                  <div class="flex items-center gap-2">
                    <span class="rounded-[4px] bg-v2-background-bg-layer-03 px-1.5 py-0.5 text-v2-text-text-muted text-10-regular">
                      {c.kind}
                    </span>
                    <span class="text-v2-text-text-base text-12-semibold">{c.name || `Candidate ${i() + 1}`}</span>
                  </div>
                  <Show when={c.description}>
                    <div class="mt-1 text-v2-text-text-muted text-11-regular">{c.description}</div>
                  </Show>
                  <pre class="mt-2 max-h-[120px] overflow-auto whitespace-pre-wrap break-words rounded-[4px] bg-v2-background-bg-layer-02 p-2 font-mono text-v2-text-text-base text-11-regular">
                    {c.template}
                  </pre>
                </div>
              )}
            </For>
          </div>
        </Show>

        <Show when={pr.errors.length > 0}>
          <div class="rounded-[6px] border border-v2-state-border-danger bg-v2-state-bg-danger px-3 py-2">
            <For each={pr.errors}>
              {(e) => (
                <div class="text-v2-state-fg-danger text-11-regular">
                  [{e.section}] {e.reason}
                </div>
              )}
            </For>
          </div>
        </Show>

        <DialogFooter>
          <ButtonV2 variant="ghost" onClick={handleBack}>
            {language.t("common.goBack")}
          </ButtonV2>
          <ButtonV2 variant="ghost" onClick={handleAiFallback}>
            {language.t("chatImport.aiAssisted")}
          </ButtonV2>
          <ButtonV2 variant="contrast" disabled={hasFatalErrors()} onClick={handleImport}>
            {language.t("chatImport.applyImport")}
          </ButtonV2>
        </DialogFooter>
      </div>
    )
  }

  // -- Input view (original) --

  if (state.phase === "result") return <ResultView />

  return (
    <Dialog title={language.t("chatImport.title")} description={language.t("chatImport.description")} size="large" fit>
      <div class="flex min-h-[280px] flex-1 flex-col gap-3 px-4 pb-3">
        <div class="grid grid-cols-3 gap-1 rounded-[6px] bg-v2-background-bg-layer-02 p-0.5" role="group">
          <button
            type="button"
            class="rounded-[4px] px-2 py-1.5 text-12-regular transition-colors"
            classList={{
              "bg-v2-background-bg-base text-v2-text-text-base shadow-[var(--v2-elevation-flat)]":
                state.mode === "paste",
              "text-v2-text-text-muted hover:text-v2-text-text-base": state.mode !== "paste",
            }}
            aria-pressed={state.mode === "paste"}
            onClick={() => setState("mode", "paste")}
          >
            {language.t("chatImport.source.paste")}
          </button>
          <button
            type="button"
            class="rounded-[4px] px-2 py-1.5 text-12-regular transition-colors"
            classList={{
              "bg-v2-background-bg-base text-v2-text-text-base shadow-[var(--v2-elevation-flat)]":
                state.mode === "file",
              "text-v2-text-text-muted hover:text-v2-text-text-base": state.mode !== "file",
            }}
            aria-pressed={state.mode === "file"}
            onClick={openFilePicker}
          >
            {language.t("chatImport.source.file")}
          </button>
          <button
            type="button"
            class="rounded-[4px] px-2 py-1.5 text-12-regular transition-colors"
            classList={{
              "bg-v2-background-bg-base text-v2-text-text-base shadow-[var(--v2-elevation-flat)]":
                state.mode === "folder",
              "text-v2-text-text-muted hover:text-v2-text-text-base": state.mode !== "folder",
            }}
            aria-pressed={state.mode === "folder"}
            onClick={openFolderPicker}
          >
            {language.t("chatImport.source.folder")}
          </button>
        </div>

        <input
          ref={(element) => {
            fileInput = element
          }}
          type="file"
          accept=".md,.txt,.yaml,.yml,.json,.toml,.env,.ini,.cfg,.conf,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.c,.cpp,.h,.hpp,.css,.scss,.less,.sh,.zsh,text/*,application/json"
          class="hidden"
          onChange={handleSingleFile}
        />
        <input
          ref={(element) => {
            folderInput = element
            element.setAttribute("webkitdirectory", "")
          }}
          type="file"
          class="hidden"
          multiple
          onChange={handleFolderSelect}
        />

        <Show when={state.mode === "paste"}>
          <textarea
            autofocus
            class="min-h-0 flex-1 resize-none rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-layer-03 p-3 text-v2-text-text-base outline-0 placeholder:text-v2-text-text-faint focus-visible:border-v2-border-border-focus text-13-regular"
            value={state.text}
            onInput={(event) => setState("text", event.currentTarget.value)}
            placeholder={language.t("chatImport.pastePlaceholder")}
          />
        </Show>

        <Show when={state.mode !== "paste"}>
          <Show
            when={!state.loading}
            fallback={
              <div class="flex min-h-0 flex-1 items-center justify-center rounded-[6px] border border-v2-border-border-base text-v2-text-text-muted text-12-regular">
                {language.t("common.loading")}
              </div>
            }
          >
            <Show
              when={state.entries.length > 0}
              fallback={
                <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-[6px] border border-dashed border-v2-border-border-base px-6 text-center">
                  <span class="text-v2-text-text-muted text-12-regular">
                    {state.skippedFiles > 0
                      ? language.t("chatImport.unsupported")
                      : language.t(state.mode === "file" ? "chatImport.empty.file" : "chatImport.empty.folder")}
                  </span>
                  <ButtonV2
                    variant="neutral"
                    size="small"
                    onClick={state.mode === "file" ? openFilePicker : openFolderPicker}
                  >
                    {language.t("chatImport.chooseAgain")}
                  </ButtonV2>
                </div>
              }
            >
              <div class="flex min-h-0 flex-1 flex-col gap-2">
                <div class="flex shrink-0 items-center gap-3 rounded-[6px] border border-v2-border-border-base px-3 py-2">
                  <Icon
                    name={state.mode === "folder" ? "folder-add-left" : fileTypeIcon(state.entries[0].type)}
                    size="large"
                    class="shrink-0 text-v2-icon-icon-muted"
                  />
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-v2-text-text-base text-12-semibold">
                      {state.mode === "folder"
                        ? language.t("chatImport.folderSummary", {
                            count: state.entries.length,
                            size: formatSize(totalSize()),
                          })
                        : state.entries[0].name}
                    </div>
                    <div class="text-v2-text-text-faint text-11-regular">
                      {state.mode === "folder"
                        ? state.entries[0].relativePath.split("/")[0]
                        : formatSize(state.entries[0].size)}
                    </div>
                  </div>
                  <ButtonV2
                    variant="ghost"
                    size="small"
                    onClick={state.mode === "file" ? openFilePicker : openFolderPicker}
                  >
                    {language.t("chatImport.chooseAgain")}
                  </ButtonV2>
                </div>

                <Show when={state.skippedFiles > 0}>
                  <div class="shrink-0 text-v2-state-fg-warning text-11-regular">
                    {language.t("chatImport.skipped", { count: state.skippedFiles })}
                  </div>
                </Show>

                <Show
                  when={state.mode === "folder"}
                  fallback={
                    <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[6px] border border-v2-border-border-base">
                      <div class="shrink-0 border-b border-v2-border-border-base px-3 py-2 text-v2-text-text-muted text-11-semibold">
                        {language.t("chatImport.preview")}
                      </div>
                      <pre class="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-v2-text-text-base text-12-regular">
                        {state.entries[0].content}
                      </pre>
                    </div>
                  }
                >
                  <div class="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)] overflow-hidden rounded-[6px] border border-v2-border-border-base">
                    <div class="min-h-0 overflow-y-auto border-r border-v2-border-border-base p-1">
                      <For each={state.entries}>
                        {(entry) => (
                          <FileTreeRow
                            entry={entry}
                            selected={selectedEntry()?.relativePath === entry.relativePath}
                            onSelect={() => setState("selectedPath", entry.relativePath)}
                          />
                        )}
                      </For>
                    </div>
                    <div class="flex min-h-0 min-w-0 flex-col">
                      <div class="shrink-0 truncate border-b border-v2-border-border-base px-3 py-2 text-v2-text-text-muted text-11-semibold">
                        {selectedEntry()?.relativePath}
                      </div>
                      <pre class="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-v2-text-text-base text-12-regular">
                        {selectedEntry()?.content}
                      </pre>
                    </div>
                  </div>
                </Show>
              </div>
            </Show>
          </Show>
        </Show>

        <Show when={state.parseError}>
          <div class="rounded-[6px] border border-v2-state-border-danger bg-v2-state-bg-danger px-3 py-2 text-v2-state-fg-danger text-11-regular">
            {state.parseError}
          </div>
        </Show>
      </div>

      <DialogFooter>
        <ButtonV2 variant="ghost" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 variant="contrast" disabled={!canImport() || state.parsing || state.loading} onClick={handleParse}>
          {state.parsing ? language.t("common.loading") : language.t("chatImport.review")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
