export * as AssetWorkbench from "./asset-workbench"

import { For, Show, Suspense, createEffect, createMemo, lazy } from "solid-js"
import { createStore } from "solid-js/store"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { Icon as IconV2 } from "@aigcfroge/ui/v2/icon"
import { useLanguage } from "@/context/language"
import { useChatWorkspace } from "@/context/chat-workspace"

import type { AssetKindId } from "@aigcfroge/schema/asset"

/**
 * TooltipV2 lazily imported to avoid Kobalte client-only API crash in bun test
 * (see test strategy A: only pure functions are tested, JSX rendering relies on dev server).
 */
const TooltipV2 = lazy(() => import("@aigcfroge/ui/v2/tooltip-v2").then((m) => ({ default: m.TooltipV2 })))

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

export function filterByOrigin(rows: readonly AssetRow[], origin: AssetOrigin | "all"): AssetRow[] {
  if (origin === "all") return [...rows]
  return rows.filter((r) => (r.origin ?? "project") === origin)
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

/** 新建按钮 disabled 判定：未传入 onNew callback 时保持 disabled（向后兼容）。 */
export function isNewButtonDisabled(onNew: (() => void) | undefined): boolean {
  return onNew === undefined
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
    originFilter: "all" as AssetOrigin | "all",
  })
  return {
    state,
    setKindFilter: (kind: AssetKind) => setState("kindFilter", kind),
    setSearch: (value: string) => setState("search", value),
    select: (path: string | undefined) => setState("selectedPath", path),
    setOriginFilter: (origin: AssetOrigin | "all") => setState("originFilter", origin),
  }
}

// -- Component (v2 tokens; data injected via props, fetched by parent) --

export function AssetWorkbenchTable(props: {
  assets: readonly AssetInput[]
  invalid: readonly { relativePath: string; kind: AssetKindId; errorTag?: "parse_error" | "bad_frontmatter" | "name_conflict" }[]
  onSelect?: (row: AssetRow) => void
  onInsert?: (row: AssetRow) => void
  /** 新建按钮回调：传入时按钮非 disabled，点击触发新建流程。 */
  onNew?: () => void
  /** 导入按钮回调：传入时按钮非 disabled，点击触发导入对话框。 */
  onImport?: () => void
  /** Delete 按钮回调：传入时行 hover 显示 Delete 按钮。 */
  onDelete?: (row: AssetRow) => void
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

  const rows = createMemo(() => {
    const byKind = filterByKind(filterBySearch(buildRows(props.assets, props.invalid), store.state.search), store.state.kindFilter)
    return sortRows(filterByOrigin(byKind, store.state.originFilter))
  })

  // 功能筛选标签：用于 header 标题/搜索占位/新建按钮（响应式）
  const kindLabel = createMemo(() =>
    store.state.kindFilter === "all"
      ? language.t("asset.panel.all")
      : language.t(`chat.feature.${store.state.kindFilter}` as const),
  )

  return (
    <div data-component="asset-workbench" class="flex h-full min-h-0 flex-col bg-v2-background-bg-base">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-v2-border-border-base px-3 py-2.5 lg:px-4 lg:py-3">
        <h2 class="flex-1 text-v2-text-text-base [font-weight:530] min-w-[120px]">
          {language.t("asset.panel.title", { kind: kindLabel() })}
        </h2>
        <label class="relative flex items-center">
          <IconV2 name="magnifying-glass" class="text-v2-icon-icon-muted shrink-0" />
          <input
            class="ml-1 h-7 w-36 lg:w-48 rounded-[6px] bg-v2-background-bg-layer-03 pr-6 pl-2 text-v2-text-text-base outline-0 placeholder:text-v2-text-text-faint text-12-regular lg:text-13-regular"
            placeholder={language.t("asset.list.searchPlaceholder", { kind: kindLabel() })}
            aria-label={language.t("asset.list.searchPlaceholder", { kind: kindLabel() })}
            value={store.state.search}
            onInput={(e) => store.setSearch(e.currentTarget.value)}
          />
          <Show when={store.state.search.length > 0}>
            <button
              type="button"
              class="absolute right-1 top-1/2 -translate-y-1/2 flex size-4 items-center justify-center rounded-[3px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus"
              onClick={() => store.setSearch("")}
              aria-label={language.t("common.clear")}
            >
              <IconV2 name="close" size="normal" class="text-v2-icon-icon-muted" />
            </button>
          </Show>
        </label>
        <div class="flex items-center gap-0.5 shrink-0 order-last lg:order-none">
          {(["all", "project", "system"] as const).map((origin) => (
            <button
              type="button"
              class={`h-6 rounded-[4px] px-2 text-11-regular outline-0 transition-colors focus-visible:ring-2 focus-visible:ring-v2-border-border-focus ${
                store.state.originFilter === origin
                  ? "bg-v2-background-bg-layer-04 text-v2-text-text-base"
                  : "text-v2-text-text-faint hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-muted"
              }`}
              onClick={() => store.setOriginFilter(origin)}
            >
              {origin === "all" ? language.t("asset.origin.all") : language.t(`asset.origin.${origin}`)}
            </button>
          ))}
        </div>
        <ButtonV2 variant="neutral" icon="plus" disabled={isNewButtonDisabled(props.onNew)} onClick={() => props.onNew?.()}>
          {language.t("asset.panel.new", { kind: kindLabel() })}
        </ButtonV2>
        <ButtonV2 variant="ghost" disabled={!props.onImport} onClick={() => props.onImport?.()}>
          {language.t("promptAsset.workbench.import")}
        </ButtonV2>
      </div>
      <div class="min-h-0 flex-1 overflow-auto no-scrollbar">
        <Show
          when={rows().length > 0}
          fallback={
            <p class="px-4 py-6 text-v2-text-text-muted [font-weight:440]">{language.t("promptAsset.panel.noAssets")}</p>
          }
        >
          <Suspense>
          <div class="flex flex-col">
            <div class="flex items-center gap-2 px-3 py-1.5 lg:px-4 text-v2-text-text-faint text-11-regular">
              <span class="w-16 lg:w-20 shrink-0">{language.t("promptAsset.list.kind")}</span>
              <span class="flex-[35] truncate">{language.t("promptAsset.list.name")}</span>
              <span class="hidden sm:flex sm:flex-[40] truncate">{language.t("promptAsset.list.description")}</span>
              <span class="hidden sm:flex sm:flex-[20] sm:justify-end">{language.t("promptAsset.list.updated")}</span>
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
                    <span class="flex w-16 lg:w-20 shrink-0 items-center gap-1">
                      <span class="rounded-[3px] bg-v2-background-bg-layer-04 px-1.5 py-0.5 text-[10px] text-v2-text-text-muted">
                        {row.kind}
                      </span>
                      <Show when={row.invalid}>
                        <TooltipV2 value={row.errorTag}>
                          <span class="text-v2-state-fg-danger" aria-label={language.t("promptAsset.badge.invalid")}>●</span>
                        </TooltipV2>
                      </Show>
                    </span>
                    <span class="min-w-0 flex-1 truncate sm:flex-[35] text-v2-text-text-base [font-weight:530]">
                      <Show when={row.origin === "system"}
                        fallback={
                          <span
                            class="mr-1 rounded-[3px] bg-v2-background-bg-layer-04 px-1.5 py-0.5 text-[10px] text-v2-text-text-muted"
                            aria-label={language.t("asset.origin.project")}
                          >
                            {language.t("asset.origin.project")}
                          </span>
                        }
                      >
                        <TooltipV2
                          value={language.t("asset.origin.systemTooltip", { kind: language.t("chat.feature." + row.kind) })}
                        >
                          <span
                            class="mr-1 rounded-[3px] bg-v2-background-bg-layer-04 px-1.5 py-0.5 text-[10px] text-v2-text-text-muted"
                            aria-label={language.t("asset.origin.system")}
                          >
                            {language.t("asset.origin.system")}
                          </span>
                        </TooltipV2>
                      </Show>
                      {row.name || row.relativePath}
                    </span>
                    <span class="min-w-0 hidden sm:block sm:flex-[40] truncate text-v2-text-text-muted">{row.description}</span>
                    <span class="relative hidden sm:flex shrink-0 sm:flex-[20] items-center justify-end gap-1 self-stretch">
                      <Show when={!row.invalid && row.origin !== "system"}>
                        <ButtonV2
                          type="button"
                          variant="ghost-muted"
                          size="small"
                          class="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                          onClick={(event: MouseEvent) => {
                            event.stopPropagation()
                            props.onInsert?.(row)
                          }}
                        >
                          {language.t("promptAsset.workbench.insert")}
                        </ButtonV2>
                        <ButtonV2
                          type="button"
                          variant="ghost-muted"
                          size="small"
                          class="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                          onClick={(event: MouseEvent) => {
                            event.stopPropagation()
                            props.onDelete?.(row)
                          }}
                        >
                          {language.t("promptAsset.workbench.delete")}
                        </ButtonV2>
                      </Show>
                    </span>
                  </div>
                )}
            </For>
          </div>
          </Suspense>
        </Show>
      </div>
    </div>
  )
}
