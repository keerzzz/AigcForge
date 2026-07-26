export * as AssetWorkbench from "./asset-workbench"

import { For, Show, createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { Icon as IconV2 } from "@aigcfroge/ui/v2/icon"
import { useLanguage } from "@/context/language"
import { useChatWorkspace } from "@/context/chat-workspace"

import type { AssetKindId } from "@aigcfroge/schema/asset"

// -- Types --

export type AssetKind = "all" | AssetKindId

export type AssetOrigin = "system" | "project"

/** 表格资产输入：SDK Summary 结构 + 可选来源（缺省 "project"；系统级由 home 合并时标注）。 */
export type AssetInput = {
  kind: AssetKindId
  relativePath: string
  name: string
  description: string
  revision: string
  origin?: AssetOrigin
}

export type AssetRow = {
  kind: AssetKindId
  relativePath: string
  name: string
  description: string
  revision: string
  invalid: boolean
  origin: AssetOrigin
  errorTag?: "parse_error" | "bad_frontmatter" | "name_conflict"
}

// -- Pure logic (testable without JSX/DOM) --

export function buildRows(
  assets: readonly AssetInput[],
  invalid: readonly { relativePath: string; kind: AssetKindId; errorTag?: "parse_error" | "bad_frontmatter" | "name_conflict" }[],
): AssetRow[] {
  const valid: AssetRow[] = assets.map((a) => ({
    kind: a.kind,
    relativePath: a.relativePath,
    name: a.name,
    description: a.description,
    revision: a.revision,
    invalid: false,
    origin: a.origin ?? "project",
  }))
  const invalidRows: AssetRow[] = invalid.map((i) => ({
    kind: i.kind,
    relativePath: i.relativePath,
    name: "",
    description: "",
    revision: "",
    invalid: true,
    origin: "project",
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
  return [...rows].sort((a, b) => {
    if (a.invalid !== b.invalid) return a.invalid ? 1 : -1
    return a.name.localeCompare(b.name) || a.relativePath.localeCompare(b.relativePath)
  })
}

/** 系统级资产（server-sync 运行时数据）提取结果，kind 语义与项目级 AssetKindId 对齐。 */
export type SystemAsset = {
  kind: AssetKindId
  name: string
  description?: string
}

/**
 * 从 server-sync child store 提取系统级资产（M4 §3.1）：
 * command 列表二分 skill/command（source 为 optional，非 "skill" 含 "command"/"mcp"/undefined，均归 command），
 * mcp 为 record keyed by name（取 key，无 description），agent 过滤 hidden（UI 隐藏项不展示）。
 */
export function systemAssets(input: {
  commands: readonly { name: string; description?: string; source?: string }[]
  agents: readonly { name: string; description?: string; hidden?: boolean }[]
  mcp: Record<string, unknown>
}): SystemAsset[] {
  const skills = input.commands
    .filter((c) => c.source === "skill")
    .map((c) => ({ kind: "skill" as const, name: c.name, description: c.description ?? "" }))
  const commands = input.commands
    .filter((c) => c.source !== "skill")
    .map((c) => ({ kind: "command" as const, name: c.name, description: c.description ?? "" }))
  const mcps = Object.keys(input.mcp).map((name) => ({ kind: "mcp" as const, name, description: "" }))
  const agents = input.agents
    .filter((a) => !a.hidden)
    .map((a) => ({ kind: "agent" as const, name: a.name, description: a.description ?? "" }))
  return [...skills, ...commands, ...mcps, ...agents]
}

/**
 * 合并项目级 + 系统级资产（M4 §3.2）：按 kind+name 去重，project 优先（对齐服务端
 * command/index.ts 同名遮蔽先例；跨 kind 同名不冲突，故去重键含 kind）。
 * 输出每行 origin 确定：project 缺省补 "project"，system 恒 "system"。
 */
export function mergeAssets(project: readonly AssetInput[], system: readonly SystemAsset[]): AssetInput[] {
  const projectKeys = new Set(project.map((a) => `${a.kind}\0${a.name}`))
  const systemRows: AssetInput[] = system
    .filter((s) => !projectKeys.has(`${s.kind}\0${s.name}`))
    .map((s) => ({
      kind: s.kind,
      name: s.name,
      description: s.description ?? "",
      relativePath: s.name,
      revision: "",
      origin: "system",
    }))
  return [...project.map((a) => ({ ...a, origin: a.origin ?? ("project" as const) })), ...systemRows]
}

/** 系统级计数（M4 功能树）：与 mergeAssets 同规则剔除被项目级遮蔽的同名项，保证侧栏计数与表格行一致。 */
export function systemCountFor(system: readonly SystemAsset[], kind: AssetKindId, projectNames: ReadonlySet<string>): number {
  return system.filter((s) => s.kind === kind && !projectNames.has(s.name)).length
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
  assets: readonly AssetInput[]
  invalid: readonly { relativePath: string; kind: AssetKindId; errorTag?: "parse_error" | "bad_frontmatter" | "name_conflict" }[]
  onSelect?: (row: AssetRow) => void
  onInsert?: (row: AssetRow) => void
  /** 功能树联动：外部控制 kind 筛选（null 或 undefined 时用 store 内部值） */
  kindFilter?: AssetKind | null
}) {
  const language = useLanguage()
  const workspace = useChatWorkspace()
  const store = workspace ?? createAssetWorkbenchStore()

  // 功能树点击 → 同步 kind 筛选到 table
  createEffect(() => {
    const ext = props.kindFilter
    if (ext !== undefined && ext !== null && ext !== store.state.kindFilter) {
      store.setKindFilter(ext)
    }
  })

  const rows = createMemo(() =>
    sortRows(filterBySearch(filterByKind(buildRows(props.assets, props.invalid), store.state.kindFilter), store.state.search)),
  )

  // 功能筛选标签：用于 header 标题/搜索占位/新建按钮（响应式）
  const kindLabel = createMemo(() =>
    store.state.kindFilter === "all"
      ? language.t("asset.panel.all")
      : language.t(`chat.feature.${store.state.kindFilter}` as const),
  )

  return (
    <div data-component="asset-workbench" class="flex h-full min-h-0 flex-col bg-v2-background-bg-base">
      <div class="flex items-center gap-2 border-b border-v2-border-border-base px-4 py-3">
        <h2 class="flex-1 text-v2-text-text-base [font-weight:530]">
          {language.t("asset.panel.title", { kind: kindLabel() })}
        </h2>
        <label class="relative flex items-center">
          <IconV2 name="magnifying-glass" class="text-v2-icon-icon-muted" />
          <input
            class="ml-1 h-7 w-48 rounded-[6px] bg-v2-background-bg-layer-03 px-2 text-v2-text-text-base outline-0 placeholder:text-v2-text-text-faint"
            placeholder={language.t("asset.list.searchPlaceholder", { kind: kindLabel() })}
            aria-label={language.t("asset.list.searchPlaceholder", { kind: kindLabel() })}
            value={store.state.search}
            onInput={(e) => store.setSearch(e.currentTarget.value)}
          />
        </label>
        <ButtonV2 variant="neutral" icon="plus" disabled onClick={() => {}}>
          {language.t("asset.panel.new", { kind: kindLabel() })}
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
            <div class="flex items-center gap-2 px-4 py-1.5 text-v2-text-text-faint text-11-regular">
              <span class="w-20 shrink-0">{language.t("promptAsset.list.kind")}</span>
              <span class="flex-[35] truncate">{language.t("promptAsset.list.name")}</span>
              <span class="flex-[40] truncate">{language.t("promptAsset.list.description")}</span>
              <span class="flex-[20] text-right">{language.t("promptAsset.list.updated")}</span>
            </div>
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
                    <span
                      class="mr-1 rounded-[3px] bg-v2-background-bg-layer-04 px-1.5 py-0.5 text-[10px] text-v2-text-text-muted"
                      aria-label={language.t(row.origin === "system" ? "asset.origin.system" : "asset.origin.project")}
                    >
                      {language.t(row.origin === "system" ? "asset.origin.system" : "asset.origin.project")}
                    </span>
                    {row.name || row.relativePath}
                  </span>
                  <span class="min-w-0 flex-[40] truncate text-v2-text-text-muted">{row.description}</span>
                  <span class="relative flex shrink-0 flex-[20] items-center justify-end self-stretch">
                    <span class="text-v2-text-text-faint">—</span>
                    <Show when={!row.invalid && row.origin !== "system"}>
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
