import { createMemo, For, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useQuery } from "@tanstack/solid-query"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { buildKbTagTree, type AssistantNavSelection, type KbTagNode } from "./assistant-nav-model"
import type { KbNoteNote, PersonalMemoryInfo, ScheduleInfo } from "@aigcfroge/sdk/v2/client"

/**
 * Assistant 实体导航树（批次 2 G3 / D4，计划 §3.2，对齐 ChatFeatureSidebar）：
 * 提醒/记忆/知识库分类（tags 层级聚合）/悬空链接 + 计数。首页左栏
 * （mode-surfaces assistant Sidebar）与详情次级左栏（secondary-sidebar）
 * 共用；数据查询 key 与 dashboard 同源（react-query 共享缓存）。
 * 选中态由父级注入（首页 = AssistantSelectionCtx，详情 = 右栏面板状态）。
 */
export function AssistantNavTree(props: {
  selected: AssistantNavSelection
  onSelect: (selection: AssistantNavSelection) => void
}) {
  const language = useLanguage()
  const serverSDK = useServerSDK()

  const pendingQuery = useQuery(() => ({
    queryKey: ["assistant", "pending"] as const,
    queryFn: async () => {
      const res = await serverSDK().client.schedule.pending()
      return Array.isArray(res.data) ? res.data : []
    },
  }))
  const pending = createMemo(() => pendingQuery.data ?? [])

  const memoryQuery = useQuery(() => ({
    queryKey: ["assistant", "memory"] as const,
    queryFn: async () => {
      const res = await serverSDK().client.memory.list()
      return Array.isArray(res.data) ? res.data : []
    },
  }))
  const memories = createMemo(() => memoryQuery.data ?? [])

  const kbQuery = useQuery(() => ({
    queryKey: ["assistant", "kb"] as const,
    queryFn: async () => {
      const res = await serverSDK().client.kb.list({})
      return Array.isArray(res.data) ? res.data : []
    },
  }))
  const notes = createMemo(() => kbQuery.data ?? [])

  const danglingQuery = useQuery(() => ({
    queryKey: ["assistant", "dangling"] as const,
    queryFn: async () => {
      const res = await serverSDK().client.kb.dangling()
      return Array.isArray(res.data) ? res.data : []
    },
  }))
  const dangling = createMemo(() => danglingQuery.data ?? [])

  const kbTree = createMemo(() => buildKbTagTree(notes()))
  // 默认折叠全部实体分组：首页左栏按计划 §3.5 只显示计数，避免提醒/记忆正文
  // 与主区聚合重复渲染（e2e regression 曾因此 strict-mode 解析到 2 个元素）。
  const [collapsed, setCollapsed] = createStore<Record<string, boolean>>({ reminders: true, memory: true, kb: true })

  const isItemSelected = (kind: "reminders" | "memory" | "kb", itemId: string) => {
    const selection = props.selected
    return selection?.kind === kind && selection.itemId === itemId
  }

  return (
    <div class="flex min-h-0 flex-col">
      <div class="px-3 pb-1 pt-2 text-v2-text-text-muted text-11-regular [font-weight:440]">
        {language.t("assistant.nav.title")}
      </div>
      <nav class="flex flex-col gap-px px-2" aria-label={language.t("assistant.nav.title")}>
        {/* 提醒：pending 计数 + 列表 */}
        <NavSection
          id="reminders"
          icon="mode-assistant"
          label={language.t("assistant.nav.reminders")}
          count={pending().length}
          collapsed={collapsed.reminders ?? true}
          onToggle={() => setCollapsed("reminders", !(collapsed.reminders ?? true))}
        >
          <For each={pending()}>
            {(reminder: ScheduleInfo) => (
              <NavItem
                icon="mode-assistant"
                label={reminder.content ?? ""}
                selected={isItemSelected("reminders", reminder.id)}
                onClick={() => props.onSelect({ kind: "reminders", itemId: reminder.id })}
              />
            )}
          </For>
        </NavSection>

        {/* 记忆：pending + confirmed 计数 */}
        <NavSection
          id="memory"
          icon="status"
          label={language.t("assistant.nav.memory")}
          count={memories().length}
          collapsed={collapsed.memory ?? true}
          onToggle={() => setCollapsed("memory", !(collapsed.memory ?? true))}
        >
          <For each={memories()}>
            {(memory: PersonalMemoryInfo) => (
              <NavItem
                icon="status"
                label={memory.content ?? ""}
                selected={isItemSelected("memory", memory.id)}
                onClick={() => props.onSelect({ kind: "memory", itemId: memory.id })}
              />
            )}
          </For>
        </NavSection>

        {/* 知识库：tags 层级聚合 */}
        <NavSection
          id="kb"
          icon="edit"
          label={language.t("assistant.nav.kb")}
          count={notes().length}
          collapsed={collapsed.kb ?? true}
          onToggle={() => setCollapsed("kb", !(collapsed.kb ?? true))}
        >
          <For each={kbTree()}>
            {(node) => <KbTagNodeRow node={node} selected={props.selected} onSelect={props.onSelect} />}
          </For>
        </NavSection>

        {/* 悬空链接：计数（数组 length） */}
        <NavItem
          icon="outline-dots"
          label={language.t("assistant.nav.dangling")}
          count={dangling().length}
          selected={props.selected?.kind === "dangling"}
          onClick={() => props.onSelect({ kind: "dangling" })}
        />
      </nav>
    </div>
  )
}

function NavSection(props: {
  id: string
  icon: string
  label: string
  count: number
  collapsed: boolean
  onToggle: () => void
  children: JSX.Element
}) {
  return (
    <section data-nav-section={props.id}>
      <button
        type="button"
        class="flex h-8 w-full cursor-default items-center gap-2 rounded-[6px] px-2 text-left text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus"
        aria-expanded={!props.collapsed}
        onClick={props.onToggle}
      >
        <Icon
          name="chevron-down"
          size="small"
          class="shrink-0 text-v2-icon-icon-muted transition-transform duration-150"
          style={{ transform: props.collapsed ? "rotate(-90deg)" : undefined }}
        />
        <Icon name={props.icon} size="small" class="shrink-0" />
        <span class="min-w-0 flex-1 truncate text-13-regular">{props.label}</span>
        <Show when={props.count > 0}>
          <span class="shrink-0 text-v2-text-text-faint text-11-regular">{props.count}</span>
        </Show>
      </button>
      <Show when={!props.collapsed}>
        <div class="flex flex-col gap-px pl-2">{props.children}</div>
      </Show>
    </section>
  )
}

function KbTagNodeRow(props: {
  node: KbTagNode
  selected: AssistantNavSelection
  onSelect: (selection: AssistantNavSelection) => void
}) {
  return (
    <div class="flex min-w-0 flex-col">
      <NavItem
        icon="folder"
        label={props.node.tag === "__untagged__" ? "" : props.node.tag}
        untagged={props.node.tag === "__untagged__"}
        count={props.node.count}
        selected={false}
        onClick={() => props.onSelect({ kind: "kb" })}
      />      <For each={props.node.children ?? []}>
        {(child) => (
          <div class="flex min-w-0 flex-col">
            <NavItem
              icon="folder"
              label={`${props.node.tag}/${child.tag}`}
              count={child.count}
              selected={false}
              onClick={() => props.onSelect({ kind: "kb" })}
              class="pl-6"
            />
            <For each={child.notes}>
              {(note: KbNoteNote) => (
                <NavItem
                  icon="edit"
                  label={note.title ?? ""}
                  selected={props.selected?.kind === "kb" && props.selected.itemId === note.id}
                  onClick={() => props.onSelect({ kind: "kb", itemId: note.id })}
                  class="pl-8"
                />
              )}
            </For>
          </div>
        )}
      </For>
      <For each={props.node.notes}>
        {(note: KbNoteNote) => (
          <NavItem
            icon="edit"
            label={note.title ?? ""}
            selected={props.selected?.kind === "kb" && props.selected.itemId === note.id}
            onClick={() => props.onSelect({ kind: "kb", itemId: note.id })}
            class={props.node.children?.length ? "pl-8" : undefined}
          />
        )}
      </For>
    </div>
  )
}

function NavItem(props: {
  icon: string
  label: string
  selected: boolean
  onClick: () => void
  count?: number
  untagged?: boolean
  class?: string
}) {
  const language = useLanguage()
  return (
    <button
      type="button"
      data-selected={props.selected ? "" : undefined}
      aria-current={props.selected ? "page" : undefined}
      class={`flex h-8 w-full cursor-default items-center gap-2 rounded-[6px] px-2 text-left text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus data-[selected]:bg-v2-background-bg-layer-03 data-[selected]:text-v2-text-text-base ${props.class ?? ""}`}
      onClick={props.onClick}
    >
      <Icon name={props.icon} size="small" class="shrink-0" />
      <span class="min-w-0 flex-1 truncate text-13-regular">
        {props.untagged ? language.t("assistant.nav.untagged") : props.label}
      </span>
      <Show when={props.count !== undefined && props.count > 0}>
        <span class="shrink-0 text-v2-text-text-faint text-11-regular">{props.count}</span>
      </Show>
    </button>
  )
}
