import { For, Show, createEffect, createMemo, on } from "solid-js"
import { useQuery, useQueryClient } from "@tanstack/solid-query"
import { TabsV2 } from "@aigcfroge/ui/v2/tabs-v2"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { IconButton } from "@aigcfroge/ui/icon-button"
import { TooltipKeybind } from "@/components/tooltip-keybind"
import { ScrollView } from "@aigcfroge/ui/scroll-view"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useCommand } from "@/context/command"
import { useMode } from "@/context/mode"
import { useSessionLayout } from "@/pages/session/session-layout"
import { useModeQueryActivity } from "@/pages/mode-slot-active"
import { SessionRightPanel } from "@/components/session-right-panel"
import { SessionContextTab, SessionContextTabTrigger } from "@/components/session"
import { createSizing } from "@/pages/session/helpers"
import { DeliveryList, MemoryInspector, ReminderList } from "@/components/assistant-entity-lists"
import { AssistantNoteEditor } from "@/components/assistant-note-editor"
import { AssistantKbTab } from "@/pages/session/assistant-kb-tab"
import { assistantQueryKey, assistantQueryOptions, invalidateAssistantQueries } from "@/utils/assistant-query"
import { openEntityPanel, type AssistantPanelTab } from "./assistant-session-panel-open"

const ENTITY_TABS: ReadonlyArray<{ id: AssistantPanelTab; label: string }> = [
  { id: "reminders", label: "assistant.panel.tab.reminders" },
  { id: "memory", label: "assistant.panel.tab.memory" },
  { id: "kb", label: "assistant.panel.tab.kb" },
  { id: "editor", label: "assistant.panel.tab.editor" },
]

/** Assistant session panel with dynamic entity tabs, a context tab, and the default project file-tree. */
export function AssistantSessionPanel() {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const queryClient = useQueryClient()
  const command = useCommand()
  const mode = useMode()
  const slotActive = useModeQueryActivity(() => assistantQueryKey(serverSDK().scope))
  const { params, assistant, tabs, view } = useSessionLayout()
  const size = createSizing()

  const sessionID = createMemo(() => params.id)
  const target = assistant().target
  const openTabs = createMemo(() => tabs().all())
  const contextOpen = createMemo(() => openTabs().includes("context"))
  const activeTab = createMemo(() => tabs().active())

  // Default to the reminders tab only when the panel opens empty. Scoping the
  // effect to the open state keeps closing the last tab from immediately
  // reopening it (the tab list change alone no longer re-triggers this).
  createEffect(
    on(
      () => view().reviewPanel.opened(),
      (open) => {
        if (mode.currentMode === "assistant" && open && tabs().all().length === 0) {
          void tabs().open("reminders")
        }
      },
    ),
  )

  const selectTab = (value: string | number) => {
    if (!slotActive()) return
    const tab = String(value)
    if (!openTabs().includes(tab)) return
    if (tab !== "context" && !ENTITY_TABS.some((item) => item.id === tab)) return
    tabs().setActive(tab)
    assistant().setTarget(undefined)
  }

  const closeTab = (tab: string) => tabs().close(tab)

  const remindersQuery = useQuery(() => ({
    enabled: slotActive() && !!sessionID(),
    ...assistantQueryOptions(serverSDK().scope, "panel", "reminders", sessionID()),
    queryFn: async () => {
      const id = sessionID()
      if (!id) return []
      const res = await serverSDK().client.schedule.list({ sessionID: id })
      return Array.isArray(res.data) ? res.data.filter((item) => item.status !== "cancelled") : []
    },
  }))
  const reminders = createMemo(() => remindersQuery.data ?? [])

  const inboxQuery = useQuery(() => ({
    enabled: slotActive() && !!sessionID(),
    ...assistantQueryOptions(serverSDK().scope, "panel", "inbox", sessionID()),
    queryFn: async () => {
      const id = sessionID()
      if (!id) return []
      const res = await serverSDK().client.delivery.inbox({ sessionID: id })
      return Array.isArray(res.data) ? res.data : []
    },
  }))
  const inbox = createMemo(() => inboxQuery.data ?? [])

  function cancelReminder(id: string) {
    const sdk = serverSDK()
    const origin = sessionID()
    if (!origin) return
    const keys = [assistantQueryKey(sdk.scope, "pending"), assistantQueryKey(sdk.scope, "panel", "reminders", origin)]
    void sdk.client.schedule
      .cancel({ id })
      .then(() => invalidateAssistantQueries(queryClient, keys))
      .catch(console.error)
  }

  function markRead(deliveryKey: string) {
    const sdk = serverSDK()
    const origin = sessionID()
    if (!origin) return
    const keys = [assistantQueryKey(sdk.scope, "recent"), assistantQueryKey(sdk.scope, "panel", "inbox", origin)]
    void sdk.client.delivery
      .read({ deliveryKey })
      .then(() => invalidateAssistantQueries(queryClient, keys))
      .catch(console.error)
  }

  const memoryQuery = useQuery(() => ({
    enabled: slotActive(),
    ...assistantQueryOptions(serverSDK().scope, "memory"),
    queryFn: async () => {
      const res = await serverSDK().client.memory.list()
      return Array.isArray(res.data) ? res.data : []
    },
  }))
  const memories = createMemo(() => memoryQuery.data ?? [])
  const pendingMemories = createMemo(() => memories().filter((m) => m.status === "pending"))
  const confirmedMemories = createMemo(() => memories().filter((m) => m.status === "confirmed"))

  function confirmMemory(id: string) {
    const sdk = serverSDK()
    const keys = [assistantQueryKey(sdk.scope, "memory")]
    void sdk.client.memory
      .confirm({ id })
      .then(() => invalidateAssistantQueries(queryClient, keys))
      .catch(console.error)
  }
  function rejectMemory(id: string) {
    const sdk = serverSDK()
    const keys = [assistantQueryKey(sdk.scope, "memory")]
    void sdk.client.memory
      .reject({ id })
      .then(() => invalidateAssistantQueries(queryClient, keys))
      .catch(console.error)
  }
  function removeMemory(id: string) {
    const sdk = serverSDK()
    const keys = [assistantQueryKey(sdk.scope, "memory")]
    void sdk.client.memory
      .remove({ id })
      .then(() => invalidateAssistantQueries(queryClient, keys))
      .catch(console.error)
  }

  const closeButton = (tab: string) => (
    <TooltipKeybind
      title={language.t("common.closeTab")}
      keybind={command.keybind("tab.close")}
      placement="bottom"
      gutter={10}
    >
      <IconButton
        icon="close-small"
        variant="ghost"
        class="h-5 w-5"
        onClick={() => closeTab(tab)}
        aria-label={language.t("common.closeTab")}
      />
    </TooltipKeybind>
  )

  return (
    <SessionRightPanel modeID="assistant" size={size} ariaLabel={language.t("assistant.panel.title")}>
      <TabsV2 value={activeTab()} onChange={selectTab} class="flex min-h-0 flex-1 flex-col">
        <TabsV2.List
          class="no-scrollbar flex gap-0.5 overflow-x-auto border-b border-v2-border-border-base px-1"
          aria-label={language.t("assistant.panel.title")}
        >
          <For each={ENTITY_TABS}>
            {(item) => (
              // Keep the finite trigger collection registered. Kobalte otherwise
              // falls back to the first tab before a newly opened trigger registers.
              <span style={{ display: openTabs().includes(item.id) ? "contents" : "none" }}>
                <TabsV2.Trigger
                  value={item.id}
                  class="shrink-0"
                  disabled={!openTabs().includes(item.id)}
                  closeButton={closeButton(item.id)}
                  hideCloseButton
                  onMiddleClick={() => closeTab(item.id)}
                >
                  <span class="whitespace-nowrap">{language.t(item.label)}</span>
                </TabsV2.Trigger>
              </span>
            )}
          </For>
          <SessionContextTabTrigger contextOpen={contextOpen} onClose={() => closeTab("context")} forceMount />
        </TabsV2.List>

        <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Show when={activeTab() === "reminders"}>
            <ScrollView class="min-h-0 flex-1">
              <div class="flex min-w-0 flex-col gap-6 px-3 py-4">
                <section class="flex min-w-0 flex-col gap-3">
                  <h2 class="text-v2-text-text-base text-13-medium">{language.t("assistant.panel.tab.reminders")}</h2>
                  <ReminderList
                    pending={reminders()}
                    error={remindersQuery.isError}
                    loading={remindersQuery.isLoading}
                    onCancel={cancelReminder}
                    emptyLabel={language.t("assistant.dashboard.reminders.empty")}
                    errorLabel={language.t("assistant.dashboard.loadError")}
                    showStatus
                    targetId={target()}
                  />
                </section>
                <section class="flex min-w-0 flex-col gap-3">
                  <h2 class="text-v2-text-text-base text-13-medium">
                    {language.t("assistant.panel.reminders.history")}
                  </h2>
                  <Show
                    when={inbox().length > 0}
                    fallback={
                      <p class="text-v2-text-text-muted text-13-regular">
                        {language.t("assistant.panel.reminders.historyEmpty")}
                      </p>
                    }
                  >
                    <DeliveryList records={inbox()} onMarkRead={markRead} />
                  </Show>
                </section>
              </div>
            </ScrollView>
          </Show>

          <Show when={activeTab() === "memory"}>
            <ScrollView class="min-h-0 flex-1">
              <div class="flex min-w-0 flex-col gap-6 px-3 py-4">
                <section class="flex min-w-0 flex-col gap-3">
                  <h2 class="text-v2-text-text-base text-13-medium">{language.t("assistant.panel.tab.memory")}</h2>
                  <Show
                    when={pendingMemories().length > 0 || confirmedMemories().length > 0}
                    fallback={
                      <p class="text-v2-text-text-muted text-13-regular">
                        {language.t("assistant.panel.memory.empty")}
                      </p>
                    }
                  >
                    <MemoryInspector
                      pending={pendingMemories()}
                      confirmed={confirmedMemories()}
                      onConfirm={confirmMemory}
                      onReject={rejectMemory}
                      onRemove={removeMemory}
                      targetId={target()}
                    />
                  </Show>
                </section>
              </div>
            </ScrollView>
          </Show>

          <Show when={activeTab() === "kb"}>
            <div class="flex min-h-0 flex-1 flex-col px-3 py-4">
              <AssistantKbTab
                target={target()}
                onEditNote={(note) =>
                  openEntityPanel({
                    view: view(),
                    tabs: tabs(),
                    assistant: assistant(),
                    kind: "editor",
                    itemId: note.id,
                  })
                }
              />
            </div>
          </Show>

          <Show when={activeTab() === "editor"}>
            <div class="flex min-h-0 flex-1 flex-col px-3 py-4">
              <AssistantNoteEditor
                noteId={target()}
                onSaved={() => openEntityPanel({ view: view(), tabs: tabs(), assistant: assistant(), kind: "kb" })}
              />
            </div>
          </Show>

          <Show when={activeTab() === "context"}>
            <div class="relative min-h-0 flex-1 overflow-hidden">
              <SessionContextTab />
            </div>
          </Show>
        </div>
      </TabsV2>
    </SessionRightPanel>
  )
}
