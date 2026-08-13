import { createMemo, createSignal, For, Show } from "solid-js"
import { useQuery } from "@tanstack/solid-query"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { IconButtonV2 } from "@aigcfroge/ui/v2/icon-button-v2"
import { ScrollView } from "@aigcfroge/ui/scroll-view"
import { useLanguage } from "@/context/language"
import { useGlobal } from "@/context/global"
import { useTabs } from "@/context/tabs"
import { useServer, ServerConnection } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useModeDirectory, useAssistantSelection } from "@/pages/mode-workspace-context"
import { modeDraft } from "@/context/mode"
import { useServerSync } from "@/context/server-sync"
import { useLayout } from "@/context/layout"
import { openProjectNewSession, openSessionRecord, filterSessionsByMode } from "@/pages/layout/helpers"
import { DeliveryList, MemoryInspector, ReminderList } from "@/components/assistant-entity-lists"
import { sessionHighlightIDs } from "@/components/assistant-nav-model"
import { assistantQueryKey } from "@/utils/assistant-query"
import {
  HOME_SESSION_LIMIT,
  HomeSessionRow,
  HomeSessionGroupHeader,
  HomeSessionSkeleton,
  buildHomeSessionRecords,
  groupSessions,
  type HomeSessionRecord,
} from "@/pages/home"
import type { KbNoteNote } from "@aigcfroge/sdk/v2/client"

/** Assistant dashboard for reminders, deliveries, memory, notes, and Sessions. */
export function AssistantDashboardMain() {
  const language = useLanguage()
  const tabs = useTabs()
  const sync = useServerSync()
  const global = useGlobal()
  const server = useServer()
  const serverSDK = useServerSDK()
  const layout = useLayout()
  const { conn, ctx, directory } = useModeDirectory()
  const { selection } = useAssistantSelection()

  const pendingQuery = useQuery(() => ({
    queryKey: assistantQueryKey(serverSDK().scope, "pending"),
    queryFn: async () => {
      const res = await serverSDK().client.schedule.pending()
      // Defensive: a mock or unexpected response shape can hand back a non-array
      // (the workspace renders all mode surfaces, so a crash here takes down
      // every mode) — normalize to an empty list instead of crashing `.filter`.
      return Array.isArray(res.data) ? res.data : []
    },
  }))
  const pending = createMemo(() => pendingQuery.data ?? [])

  const recentQuery = useQuery(() => ({
    queryKey: assistantQueryKey(serverSDK().scope, "recent"),
    queryFn: async () => {
      const res = await serverSDK().client.delivery.recent({ limit: 6 })
      return Array.isArray(res.data) ? res.data : []
    },
  }))
  const recent = createMemo(() => recentQuery.data ?? [])

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

  const kbQuery = useQuery(() => ({
    queryKey: assistantQueryKey(serverSDK().scope, "kb"),
    queryFn: async () => {
      const res = await serverSDK().client.kb.list({})
      return Array.isArray(res.data) ? res.data : []
    },
  }))
  const notes = createMemo(() => kbQuery.data ?? [])
  const [editing, setEditing] = createSignal<KbNoteNote | undefined>()
  const [editTitle, setEditTitle] = createSignal("")
  const [editContent, setEditContent] = createSignal("")
  const [creating, setCreating] = createSignal(false)

  function openEditor(note: KbNoteNote) {
    setEditing(note)
    setEditTitle(note.title)
    setEditContent(note.content)
    setCreating(false)
  }
  function startCreate() {
    setEditing(undefined)
    setEditTitle("")
    setEditContent("")
    setCreating(true)
  }
  function saveNote() {
    const editingNote = editing()
    const sdk = serverSDK()
    if (creating() || !editingNote) {
      void sdk.client.kb
        .create({ title: editTitle(), content: editContent(), scope: "global" })
        .then(() => {
          setCreating(false)
          setEditing(undefined)
          void kbQuery.refetch()
        })
        .catch(console.error)
      return
    }
    void sdk.client.kb
      .update({ id: editingNote.id, content: editContent() })
      .then(() => {
        setEditing(undefined)
        void kbQuery.refetch()
      })
      .catch(console.error)
  }
  function deleteNote(id: string) {
    void serverSDK().client.kb
      .remove({ id })
      .then(() => {
        setEditing(undefined)
        void kbQuery.refetch()
      })
      .catch(console.error)
  }

  const projects = createMemo(() => ctx()?.projects.list() ?? layout.projects.list())
  const projectByID = createMemo(
    () => new Map(projects().flatMap((project) => (project.id ? [[project.id, project] as const] : []))),
  )
  const projectDirectories = createMemo(() => {
    const dir = directory()
    return dir ? [dir] : []
  })
  const sessionLoad = useQuery(() => ({
    queryKey: [serverSDK().scope, "home", "assistant-sessions", ...projectDirectories()] as const,
    queryFn: async () => {
      await Promise.all(projectDirectories().map((d) => sync().project.loadSessions(d, { limit: HOME_SESSION_LIMIT })))
      return null
    },
  }))
  const records = createMemo(() => {
    const all = buildHomeSessionRecords({ sync: sync(), projectDirectories, projects, projectByID })
    return filterSessionsByMode(all, "assistant").slice(0, HOME_SESSION_LIMIT)
  })
  const groups = createMemo(() => groupSessions(records(), language))
  const highlightedSessions = createMemo(() =>
    sessionHighlightIDs({ selection: selection, reminders: pending(), memories: memories() }),
  )
  const activeConnKey = createMemo(() => {
    const c = conn()
    return c ? ServerConnection.key(c) : server.key
  })

  function openAssistantSession(record: HomeSessionRecord) {
    const c = conn()
    const currentCtx = ctx()
    if (!c || !currentCtx) return
    openSessionRecord({
      record,
      server: ServerConnection.key(c),
      global,
      tabs,
      projects: currentCtx.projects,
      projectByID: projectByID(),
    })
  }

  function newAssistantSession() {
    const c = conn()
    const currentCtx = ctx()
    const dir = directory()
    if (!c || !currentCtx || !dir) return
    openProjectNewSession(
      currentCtx.projects,
      (serverKey, draftDirectory) =>
        tabs.newDraft({ server: serverKey, directory: draftDirectory, ...modeDraft("assistant") }),
      ServerConnection.key(c),
      dir,
    )
  }

  function cancelReminder(id: string) {
    void serverSDK().client.schedule.cancel({ id }).then(() => pendingQuery.refetch()).catch(console.error)
  }

  function markRead(deliveryKey: string) {
    void serverSDK().client.delivery.read({ deliveryKey }).then(() => recentQuery.refetch()).catch(console.error)
  }

  return (
    <ScrollView class="min-h-0 flex-1">
      <div class="flex min-h-0 flex-col gap-6 px-6 py-5">
        <div class="flex items-start justify-between gap-3">
          <div class="flex flex-col gap-1">
            <h1 class="text-v2-text-text-base text-16-medium">{language.t("assistant.dashboard.title")}</h1>
            <p class="text-v2-text-text-muted text-13-regular">{language.t("assistant.dashboard.subtitle")}</p>
          </div>
          <IconButtonV2
            variant="neutral"
            size="normal"
            icon={<Icon name="grid-plus" />}
            aria-label={language.t("assistant.dashboard.new")}
            onClick={newAssistantSession}
          />
        </div>

        <section class="flex min-w-0 flex-col gap-3">
          <h2 class="text-v2-text-text-base text-13-medium">{language.t("assistant.dashboard.reminders")}</h2>
          <ReminderList
            pending={pending()}
            error={pendingQuery.isError}
            loading={pendingQuery.isLoading}
            onCancel={cancelReminder}
            emptyLabel={language.t("assistant.dashboard.reminders.empty")}
            errorLabel={language.t("assistant.dashboard.loadError")}
          />
        </section>

        <Show when={recentQuery.isError}>
          <section class="flex min-w-0 flex-col gap-3">
            <h2 class="text-v2-text-text-base text-13-medium">{language.t("assistant.dashboard.recent")}</h2>
            <p class="text-v2-text-text-muted text-13-regular">{language.t("assistant.dashboard.loadError")}</p>
          </section>
        </Show>
        <Show when={!recentQuery.isError && recent().length > 0}>
          <section class="flex min-w-0 flex-col gap-3">
            <h2 class="text-v2-text-text-base text-13-medium">{language.t("assistant.dashboard.recent")}</h2>
            <DeliveryList records={recent()} onMarkRead={markRead} />
          </section>
        </Show>

        <Show when={memoryQuery.isError}>
          <section class="flex min-w-0 flex-col gap-3">
            <h2 class="text-v2-text-text-base text-13-medium">{language.t("assistant.memory.title")}</h2>
            <p class="text-v2-text-text-muted text-13-regular">{language.t("assistant.dashboard.loadError")}</p>
          </section>
        </Show>
        <Show when={!memoryQuery.isError && memories().length > 0}>
          <section class="flex min-w-0 flex-col gap-3">
            <h2 class="text-v2-text-text-base text-13-medium">{language.t("assistant.memory.title")}</h2>
            <MemoryInspector
              pending={pendingMemories()}
              confirmed={confirmedMemories()}
              onConfirm={confirmMemory}
              onReject={rejectMemory}
              onRemove={removeMemory}
            />
          </section>
        </Show>

        <section class="flex min-w-0 flex-col gap-3">
          <div class="flex min-w-0 items-center justify-between gap-3">
            <h2 class="text-v2-text-text-base text-13-medium">{language.t("assistant.kb.title")}</h2>
            <IconButtonV2
              variant="ghost-muted"
              size="small"
              icon={<Icon name="grid-plus" />}
              aria-label={language.t("assistant.kb.new")}
              onClick={startCreate}
            />
          </div>

          <Show when={creating() || editing() !== undefined}>
            <div class="flex min-w-0 flex-col gap-2 rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-02 p-3">
              <input
                class="w-full rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-2 py-1 text-v2-text-text-base text-13-regular focus:outline-none"
                aria-label={language.t("assistant.kb.titlePlaceholder")}
                placeholder={language.t("assistant.kb.titlePlaceholder")}
                value={editTitle()}
                onInput={(event) => setEditTitle(event.currentTarget.value)}
                disabled={!creating()}
              />
              <textarea
                class="min-h-24 w-full resize-y rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-2 py-1 text-v2-text-text-base text-13-regular focus:outline-none"
                aria-label={language.t("assistant.kb.contentPlaceholder")}
                placeholder={language.t("assistant.kb.contentPlaceholder")}
                value={editContent()}
                onInput={(event) => setEditContent(event.currentTarget.value)}
              />
              <div class="flex items-center gap-2">
                <IconButtonV2
                  variant="neutral"
                  size="small"
                  icon={<Icon name="status-active" />}
                  aria-label={language.t("assistant.kb.save")}
                  onClick={saveNote}
                />
                <IconButtonV2
                  variant="ghost-muted"
                  size="small"
                  icon={<Icon name="xmark-small" />}
                  aria-label={language.t("assistant.kb.cancel")}
                  onClick={() => {
                    setCreating(false)
                    setEditing(undefined)
                  }}
                />
                <Show when={editing() !== undefined}>
                  <IconButtonV2
                    variant="ghost-muted"
                    size="small"
                    icon={<Icon name="xmark-small" />}
                    aria-label={language.t("assistant.kb.delete")}
                    onClick={() => {
                      const editingNote = editing()
                      if (editingNote) deleteNote(editingNote.id)
                    }}
                  />
                </Show>
              </div>
            </div>
          </Show>

          <Show when={kbQuery.isError}>
            <p class="text-v2-text-text-muted text-13-regular">{language.t("assistant.dashboard.loadError")}</p>
          </Show>
          <Show when={!kbQuery.isError && notes().length > 0}>
            <div class="flex min-w-0 flex-col gap-px">
              <For each={notes()}>
                {(note: KbNoteNote) => (
                  <button
                    type="button"
                    class="flex min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-v2-background-bg-layer-02 focus-visible:outline-none"
                    onClick={() => openEditor(note)}
                  >
                    <Icon name="edit" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                    <span class="min-w-0 flex-1 truncate text-v2-text-text-base text-13-regular">{note.title ?? ""}</span>
                    <span class="shrink-0 text-v2-text-text-faint text-11-regular">{note.format}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
          <Show when={!kbQuery.isError && !kbQuery.isLoading && notes().length === 0}>
            <p class="text-v2-text-text-muted text-13-regular">{language.t("assistant.kb.empty")}</p>
          </Show>
        </section>

        <section class="flex min-w-0 flex-col gap-3">
          <Show when={!sessionLoad.isLoading} fallback={<HomeSessionSkeleton label={language.t("assistant.dashboard.title")} />}>
            <Show when={groups().length > 0}>
              <div class="flex min-w-0 flex-col gap-px">
                <For each={groups()}>
                  {(group) => (
                    <div class="flex min-w-0 flex-col gap-2">
                      <HomeSessionGroupHeader title={group.title} />
                      <For each={group.sessions}>
                        {(record) => (
                          <HomeSessionRow
                            record={record}
                            server={activeConnKey()}
                            activeServer={activeConnKey() === server.key}
                            highlighted={highlightedSessions().has(record.session.id)}
                            onClick={() => openAssistantSession(record)}
                          />
                        )}
                      </For>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </section>
      </div>
    </ScrollView>
  )
}
