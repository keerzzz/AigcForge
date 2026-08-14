import { createContext, createMemo, For, Show, useContext, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useQuery } from "@tanstack/solid-query"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { buildKbTagTree, type AssistantNavSelection, type KbTagNode } from "./assistant-nav-model"
import type { KbNoteNote, PersonalMemoryInfo, ScheduleInfo } from "@aigcfroge/sdk/v2/client"
import { assistantQueryKey } from "@/utils/assistant-query"

/**
 * Provides the reactive selection straight to note leaves so the intermediate
 * tag-tree nodes don't re-evaluate when the selection changes (session switch).
 */
const SelectionContext = createContext<Accessor<AssistantNavSelection>>()

/** Entity navigation shared by the Assistant home and session sidebars. */
export function AssistantNavTree(props: {
  selected: AssistantNavSelection
  onSelect: (selection: AssistantNavSelection) => void
}) {
  const language = useLanguage()
  const serverSDK = useServerSDK()

  const pendingQuery = useQuery(() => ({
    queryKey: assistantQueryKey(serverSDK().scope, "pending"),
    queryFn: async () => {
      const res = await serverSDK().client.schedule.pending()
      return Array.isArray(res.data) ? res.data : []
    },
  }))
  const pending = createMemo(() => pendingQuery.data ?? [])

  const memoryQuery = useQuery(() => ({
    queryKey: assistantQueryKey(serverSDK().scope, "memory"),
    queryFn: async () => {
      const res = await serverSDK().client.memory.list()
      return Array.isArray(res.data) ? res.data : []
    },
  }))
  const memories = createMemo(() => memoryQuery.data ?? [])

  const kbQuery = useQuery(() => ({
    queryKey: assistantQueryKey(serverSDK().scope, "kb"),
    queryFn: async () => {
      const res = await serverSDK().client.kb.list({})
      return Array.isArray(res.data) ? res.data : []
    },
  }))
  const notes = createMemo(() => kbQuery.data ?? [])

  const danglingQuery = useQuery(() => ({
    queryKey: assistantQueryKey(serverSDK().scope, "dangling"),
    queryFn: async () => {
      const res = await serverSDK().client.kb.dangling()
      return Array.isArray(res.data) ? res.data : []
    },
  }))
  const dangling = createMemo(() => danglingQuery.data ?? [])

  const kbTree = createMemo(() => buildKbTagTree(notes()))
  const selection = createMemo(() => props.selected)
  // Collapsed groups avoid duplicating entity content already shown by the dashboard.
  const [collapsed, setCollapsed] = createStore<Record<string, boolean>>({ reminders: true, memory: true, kb: true })

  const isItemSelected = (kind: "reminders" | "memory" | "kb", itemId: string) => {
    const current = selection()
    return current?.kind === kind && current.itemId === itemId
  }

  return (
    <SelectionContext.Provider value={selection}>
      <div class="flex min-h-0 flex-col">
      <div class="px-3 pb-1 pt-2 text-v2-text-text-muted text-11-regular [font-weight:440]">
        {language.t("assistant.nav.title")}
      </div>
      <nav class="flex flex-col gap-px px-2" aria-label={language.t("assistant.nav.title")}>
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

        <NavSection
          id="kb"
          icon="edit"
          label={language.t("assistant.nav.kb")}
          count={notes().length}
          collapsed={collapsed.kb ?? true}
          onToggle={() => setCollapsed("kb", !(collapsed.kb ?? true))}
        >
          <For each={kbTree()}>
            {(node) => <KbTagNodeRow node={node} onSelect={props.onSelect} />}
          </For>
        </NavSection>

        <NavItem
          icon="outline-dots"
          label={language.t("assistant.nav.dangling")}
          count={dangling().length}
          selected={selection()?.kind === "dangling"}
          onClick={() => props.onSelect({ kind: "dangling" })}
        />
      </nav>
      </div>
    </SelectionContext.Provider>
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
  parentPath?: string
  onSelect: (selection: AssistantNavSelection) => void
}) {
  const path = () => (props.parentPath ? `${props.parentPath}/${props.node.tag}` : props.node.tag)
  return (
    <div class="flex min-w-0 flex-col">
      <NavItem
        icon="folder"
        label={props.node.tag === "__untagged__" ? "" : path()}
        untagged={props.node.tag === "__untagged__"}
        count={props.node.count}
        selected={false}
        onClick={() => props.onSelect({ kind: "kb" })}
      />
      <div class="flex min-w-0 flex-col pl-2">
        <For each={props.node.children ?? []}>
          {(child) => <KbTagNodeRow node={child} parentPath={path()} onSelect={props.onSelect} />}
        </For>
      </div>
      <div class="flex min-w-0 flex-col pl-4">
        <For each={props.node.notes}>
          {(note: KbNoteNote) => <KbNoteRow note={note} onSelect={props.onSelect} />}
        </For>
      </div>
    </div>
  )
}

function KbNoteRow(props: {
  note: KbNoteNote
  onSelect: (selection: AssistantNavSelection) => void
}) {
  const { note } = props
  const selection = useContext(SelectionContext)!
  const selected = createMemo(() => {
    const current = selection()
    return current?.kind === "kb" && current.itemId === note.id
  })
  return (
    <NavItem
      icon="edit"
      label={note.title ?? ""}
      selected={selected()}
      onClick={() => props.onSelect({ kind: "kb", itemId: note.id })}
    />
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
