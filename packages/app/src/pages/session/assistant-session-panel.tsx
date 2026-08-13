import { createMemo, For, Show } from "solid-js"
import { useQuery } from "@tanstack/solid-query"
import { TabsV2 } from "@aigcfroge/ui/v2/tabs-v2"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { IconButtonV2 } from "@aigcfroge/ui/v2/icon-button-v2"
import { ScrollView } from "@aigcfroge/ui/scroll-view"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useSessionLayout } from "@/pages/session/session-layout"
import { SessionContextTab } from "@/components/session"
import { DeliveryList, MemoryInspector, ReminderList } from "@/components/assistant-entity-lists"
import { AssistantNoteEditor } from "@/components/assistant-note-editor"
import { AssistantKbTab } from "@/pages/session/assistant-kb-tab"
import { assistantQueryKey } from "@/utils/assistant-query"
import { openEntityPanel, type AssistantPanelTab } from "./assistant-session-panel-open"

const TABS: ReadonlyArray<{ id: AssistantPanelTab; label: string }> = [
  { id: "reminders", label: "assistant.panel.tab.reminders" },
  { id: "memory", label: "assistant.panel.tab.memory" },
  { id: "kb", label: "assistant.panel.tab.kb" },
  { id: "editor", label: "assistant.panel.tab.editor" },
  { id: "context", label: "assistant.panel.tab.context" },
]

/** Five-tab Assistant session panel without a file-tree region. */
export function AssistantSessionPanel() {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const { params, assistant } = useSessionLayout()

  const sessionID = createMemo(() => params.id)
  const opened = assistant().opened
  const tab = assistant().tab
  const target = assistant().target

  const selectTab = (value: string | number) => {
    const next = TABS.find((item) => item.id === value)
    if (!next) return
    openEntityPanel(assistant(), next.id)
  }

  const close = () => assistant().close()

  const remindersQuery = useQuery(() => ({
    queryKey: assistantQueryKey(serverSDK().scope, "panel", "reminders", sessionID()),
    queryFn: async () => {
      const id = sessionID()
      if (!id) return []
      const res = await serverSDK().client.schedule.list({ sessionID: id })
      return Array.isArray(res.data) ? res.data.filter((item) => item.status !== "cancelled") : []
    },
  }))
  const reminders = createMemo(() => remindersQuery.data ?? [])

  const inboxQuery = useQuery(() => ({
    queryKey: assistantQueryKey(serverSDK().scope, "panel", "inbox", sessionID()),
    queryFn: async () => {
      const id = sessionID()
      if (!id) return []
      const res = await serverSDK().client.delivery.inbox({ sessionID: id })
      return Array.isArray(res.data) ? res.data : []
    },
  }))
  const inbox = createMemo(() => inboxQuery.data ?? [])

  function cancelReminder(id: string) {
    void serverSDK().client.schedule
      .cancel({ id })
      .then(() => remindersQuery.refetch())
      .catch(console.error)
  }

  function markRead(deliveryKey: string) {
    void serverSDK().client.delivery
      .read({ deliveryKey })
      .then(() => inboxQuery.refetch())
      .catch(console.error)
  }

  const memoryQuery = useQuery(() => ({
    queryKey: assistantQueryKey(serverSDK().scope, "memory"),
    queryFn: async () => {
      const res = await serverSDK().client.memory.list()
      return Array.isArray(res.data) ? res.data : []
    },
  }))
  const memories = createMemo(() => memoryQuery.data ?? [])
  const pendingMemories = createMemo(() => memories().filter((m) => m.status === "pending"))
  const confirmedMemories = createMemo(() => memories().filter((m) => m.status === "confirmed"))

  function confirmMemory(id: string) {
    void serverSDK().client.memory.confirm({ id }).then(() => memoryQuery.refetch()).catch(console.error)
  }
  function rejectMemory(id: string) {
    void serverSDK().client.memory.reject({ id }).then(() => memoryQuery.refetch()).catch(console.error)
  }
  function removeMemory(id: string) {
    void serverSDK().client.memory.remove({ id }).then(() => memoryQuery.refetch()).catch(console.error)
  }

  return (
    <aside
      data-component="assistant-session-panel"
      aria-label={language.t("assistant.panel.title")}
      aria-hidden={!opened()}
      inert={!opened()}
      class="relative min-w-0 h-full flex shrink-0 overflow-hidden bg-v2-background-bg-base"
      classList={{
        "flex-1": opened(),
        "pointer-events-none": !opened(),
      }}
      style={{ width: opened() ? "auto" : "0px" }}
    >
      <Show when={opened()}>
        <div class="flex h-full min-w-0 flex-1 flex-col">
          <div class="flex shrink-0 items-center gap-1 border-b border-v2-border-border-base py-1 pl-2 pr-1">
            <TabsV2 value={tab()} onChange={selectTab} class="min-w-0 flex-1">
              <TabsV2.List class="no-scrollbar flex gap-0.5 overflow-x-auto" aria-label={language.t("assistant.panel.title")}>
                <For each={TABS}>
                  {(item) => (
                    <TabsV2.Trigger value={item.id} class="shrink-0">
                      <span class="whitespace-nowrap">{language.t(item.label)}</span>
                    </TabsV2.Trigger>
                  )}
                </For>
              </TabsV2.List>
            </TabsV2>
            <IconButtonV2
              variant="ghost-muted"
              size="small"
              icon={<Icon name="xmark-small" />}
              aria-label={language.t("assistant.panel.close")}
              onClick={close}
            />
          </div>

          <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Show when={tab() === "reminders"}>
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
                    <h2 class="text-v2-text-text-base text-13-medium">{language.t("assistant.panel.reminders.history")}</h2>
                    <Show when={inbox().length > 0} fallback={<p class="text-v2-text-text-muted text-13-regular">{language.t("assistant.panel.reminders.historyEmpty")}</p>}>
                      <DeliveryList records={inbox()} onMarkRead={markRead} />
                    </Show>
                  </section>
                </div>
              </ScrollView>
            </Show>

            <Show when={tab() === "memory"}>
              <ScrollView class="min-h-0 flex-1">
                <div class="flex min-w-0 flex-col gap-6 px-3 py-4">
                  <section class="flex min-w-0 flex-col gap-3">
                    <h2 class="text-v2-text-text-base text-13-medium">{language.t("assistant.panel.tab.memory")}</h2>
                    <Show
                      when={pendingMemories().length > 0 || confirmedMemories().length > 0}
                      fallback={
                        <p class="text-v2-text-text-muted text-13-regular">{language.t("assistant.panel.memory.empty")}</p>
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

            <Show when={tab() === "kb"}>
              <div class="flex min-h-0 flex-1 flex-col px-3 py-4">
                <AssistantKbTab
                  target={target()}
                  onEditNote={(note) => openEntityPanel(assistant(), "editor", note.id)}
                />
              </div>
            </Show>

            <Show when={tab() === "editor"}>
              <div class="flex min-h-0 flex-1 flex-col px-3 py-4">
                <AssistantNoteEditor noteId={target()} onSaved={() => openEntityPanel(assistant(), "kb")} />
              </div>
            </Show>

            <Show when={tab() === "context"}>
              <div class="relative min-h-0 flex-1 overflow-hidden">
                <SessionContextTab />
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </aside>
  )
}
