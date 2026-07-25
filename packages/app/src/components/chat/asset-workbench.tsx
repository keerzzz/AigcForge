export * as AssetWorkbench from "./asset-workbench"

import { For, Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import type { PromptAssetInvalidEntry, PromptAssetSummary } from "@aigcfroge/sdk/v2/client"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { Icon as IconV2 } from "@aigcfroge/ui/v2/icon"
import { useLanguage } from "@/context/language"
import { useChatWorkspace } from "@/context/chat-workspace"

// -- Types --

export type AssetKind = "all" | "prompt"

export type AssetRow = {
  kind: "prompt"
  relativePath: string
  name: string
  description: string
  revision: string
  invalid: boolean
  errorTag?: "parse_error" | "bad_frontmatter" | "name_conflict"
}

// -- Pure logic (testable without JSX/DOM) --

export function buildRows(
  assets: readonly PromptAssetSummary[],
  invalid: readonly PromptAssetInvalidEntry[],
): AssetRow[] {
  const valid: AssetRow[] = assets.map((a) => ({
    kind: "prompt",
    relativePath: a.relativePath,
    name: a.name,
    description: a.description,
    revision: a.revision,
    invalid: false,
  }))
  const invalidRows: AssetRow[] = invalid.map((i) => ({
    kind: "prompt",
    relativePath: i.relativePath,
    name: "",
    description: "",
    revision: "",
    invalid: true,
    errorTag: i.errorTag,
  }))
  return [...valid, ...invalidRows]
}

export function filterByKind(rows: readonly AssetRow[], kind: AssetKind): AssetRow[] {
  if (kind === "all") return [...rows]
  return rows.filter((r) => r.kind === kind)
}

export function filterBySearch(rows: readonly AssetRow[], search: string): AssetRow[] {
  const q = search.trim().toLowerCase()
  if (!q) return [...rows]
  return rows.filter(
    (r) =>
      r.name.toLowerCase().includes(q) ||
      r.relativePath.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q),
  )
}

export function sortRows(rows: readonly AssetRow[]): AssetRow[] {
  // Invalid rows sink to the bottom; valid rows sort by name then path.
  // TODO(M2+): sort by updatedAt once Summary carries file mtime.
  return [...rows].sort((a, b) => {
    if (a.invalid !== b.invalid) return a.invalid ? 1 : -1
    return a.name.localeCompare(b.name) || a.relativePath.localeCompare(b.relativePath)
  })
}

// -- Store (UI state: filter / search / selection) --

export function createAssetWorkbenchStore() {
  const [state, setState] = createStore({
    kindFilter: "all" as AssetKind,
    search: "",
    selectedPath: undefined as string | undefined,
  })
  return {
    state,
    setKindFilter: (kind: AssetKind) => setState("kindFilter", kind),
    setSearch: (value: string) => setState("search", value),
    select: (path: string | undefined) => setState("selectedPath", path),
  }
}

// -- Component (v2 tokens; data injected via props, fetched by parent) --

export function AssetWorkbenchTable(props: {
  assets: readonly PromptAssetSummary[]
  invalid: readonly PromptAssetInvalidEntry[]
  onSelect?: (row: AssetRow) => void
  onInsert?: (row: AssetRow) => void
}) {
  const language = useLanguage()
  const workspace = useChatWorkspace()
  const store = workspace ?? createAssetWorkbenchStore()
  const rows = createMemo(() =>
    sortRows(filterBySearch(filterByKind(buildRows(props.assets, props.invalid), store.state.kindFilter), store.state.search)),
  )

  return (
    <div data-component="asset-workbench" class="flex h-full min-h-0 flex-col bg-v2-background-bg-base">
      <div class="flex items-center gap-2 border-b border-v2-border-border-base px-4 py-3">
        <h2 class="flex-1 text-v2-text-text-base [font-weight:530]">{language.t("promptAsset.panel.title")}</h2>
        <label class="relative flex items-center">
          <IconV2 name="magnifying-glass" class="text-v2-icon-icon-muted" />
          <input
            class="ml-1 h-7 w-48 rounded-[6px] bg-v2-background-bg-layer-03 px-2 text-v2-text-text-base outline-0 placeholder:text-v2-text-text-faint"
            placeholder={language.t("promptAsset.list.searchPlaceholder")}
            aria-label={language.t("promptAsset.list.searchPlaceholder")}
            value={store.state.search}
            onInput={(e) => store.setSearch(e.currentTarget.value)}
          />
        </label>
        <ButtonV2 variant="neutral" icon="plus" onClick={() => {}}>
          {language.t("promptAsset.panel.newPrompt")}
        </ButtonV2>
        <ButtonV2 variant="ghost" disabled onClick={() => {}}>
          {language.t("promptAsset.workbench.import")}
        </ButtonV2>
      </div>
      <div class="min-h-0 flex-1 overflow-auto">
        <Show
          when={rows().length > 0}
          fallback={
            <p class="px-4 py-6 text-v2-text-text-muted [font-weight:440]">{language.t("promptAsset.panel.noAssets")}</p>
          }
        >
          <div class="flex flex-col">
            <For each={rows()}>
              {(row) => (
                <div
                  role="button"
                  tabindex="0"
                  data-component="asset-row"
                  data-invalid={row.invalid ? "" : undefined}
                  data-selected={store.state.selectedPath === row.relativePath ? "" : undefined}
                  class="group flex cursor-default items-center gap-2 px-4 py-2 text-left hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-v2-border-border-focus data-[selected]:bg-v2-overlay-simple-overlay-hover"
                  onClick={() => {
                    store.select(row.relativePath)
                    props.onSelect?.(row)
                  }}
                  onKeyDown={(event: KeyboardEvent) => {
                    if (event.key !== "Enter" && event.key !== " ") return
                    event.preventDefault()
                    store.select(row.relativePath)
                    props.onSelect?.(row)
                  }}
                >
                  <span class="flex w-20 shrink-0 items-center gap-1">
                    <span class="rounded-[3px] bg-v2-background-bg-layer-04 px-1.5 py-0.5 text-[10px] text-v2-text-text-muted">
                      {row.kind}
                    </span>
                    <Show when={row.invalid}>
                      <span
                        class="text-v2-state-fg-danger"
                        aria-label={language.t("promptAsset.badge.invalid")}
                        title={row.errorTag}
                      >
                        ●
                      </span>
                    </Show>
                  </span>
                  <span class="min-w-0 flex-[35] truncate text-v2-text-text-base [font-weight:530]">
                    {row.name || row.relativePath}
                  </span>
                  <span class="min-w-0 flex-[40] truncate text-v2-text-text-muted">{row.description}</span>
                  <span class="relative flex shrink-0 flex-[20] items-center justify-end self-stretch">
                    <span class="text-v2-text-text-faint">—</span>
                    <Show when={!row.invalid}>
                      <ButtonV2
                        type="button"
                        variant="ghost-muted"
                        size="small"
                        class="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                        onClick={(event: MouseEvent) => {
                          event.stopPropagation()
                          props.onInsert?.(row)
                        }}
                      >
                        {language.t("promptAsset.workbench.insert")}
                      </ButtonV2>
                    </Show>
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  )
}
