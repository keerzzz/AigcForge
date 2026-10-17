import { createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useQuery, useQueryClient, type QueryKey } from "@tanstack/solid-query"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { IconButtonV2 } from "@aigcfroge/ui/v2/icon-button-v2"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { ScrollView } from "@aigcfroge/ui/scroll-view"
import { useLanguage } from "@/context/language"
import { useGlobal } from "@/context/global"
import { useTabs } from "@/context/tabs"
import { useServer, ServerConnection } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useModeDirectory, useAssistantSelection } from "@/pages/mode-workspace-context"
import { useServerSync } from "@/context/server-sync"
import { useLayout } from "@/context/layout"
import { launchModeSession, openSessionRecord, filterSessionsByMode } from "@/pages/layout/helpers"
import { DeliveryList, MemoryInspector, ReminderList } from "@/components/assistant-entity-lists"
import { sessionHighlightIDs } from "@/components/assistant-nav-model"
import {
  assistantKbQueryKeys,
  assistantQueryKey,
  assistantQueryOptions,
  invalidateAssistantQueries,
} from "@/utils/assistant-query"
import {
  HOME_SESSION_LIMIT,
  HomeSessionRow,
  HomeSessionGroupHeader,
  HomeSessionSkeleton,
  buildHomeSessionRecords,
  groupSessions,
  type HomeSessionRecord,
} from "@/pages/home-shared"
import type { KbNoteNote } from "@aigcfroge/sdk/v2/client"
import { useModeQueryActivity } from "@/pages/mode-slot-active"
import { mutationErrorMessage } from "./assistant-dashboard-model"
import { AssistantMutation } from "@/utils/assistant-mutation"

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
  const [mutationError, setMutationError] = createSignal<string>()
  const queryClient = useQueryClient()
  let disposed = false
  onCleanup(() => {
    disposed = true
  })

  async function runMutation(
    action: () => Promise<unknown>,
    keys: ReadonlyArray<QueryKey>,
    current: () => boolean = () => true,
  ) {
    const scope = serverSDK().scope
    setMutationError(undefined)
    try {
      await action()
      await invalidateAssistantQueries(queryClient, keys)
      return true
    } catch (error) {
      if (!disposed && serverSDK().scope === scope && current()) {
        setMutationError(mutationErrorMessage(error, language.t("assistant.dashboard.actionError")))
      }
      return false
    }
  }

  // All five of these are Assistant-only, and `ModeWorkspace` keeps every mode's slot
  // mounted, so without this gate opening Coding also asked the server for the Assistant's
  // reminders, memory and knowledge base. Same shape as the coding and work session loads
  // in `mode-workspace-slots.tsx`.
  const slotActive = useModeQueryActivity(() => assistantQueryKey(serverSDK().scope))
  const pendingQuery = useQuery(() => ({
    enabled: slotActive(),
    ...assistantQueryOptions(serverSDK().scope, "pending"),
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
    enabled: slotActive(),
    ...assistantQueryOptions(serverSDK().scope, "recent"),
    queryFn: async () => {
      const res = await serverSDK().client.delivery.recent({ limit: 6 })
      return Array.isArray(res.data) ? res.data : []
    },
  }))
  const recent = createMemo(() => recentQuery.data ?? [])

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
    void runMutation(() => sdk.client.memory.confirm({ id }), [assistantQueryKey(sdk.scope, "memory")])
  }
  function rejectMemory(id: string) {
    const sdk = serverSDK()
    void runMutation(() => sdk.client.memory.reject({ id }), [assistantQueryKey(sdk.scope, "memory")])
  }
  function removeMemory(id: string) {
    const sdk = serverSDK()
    void runMutation(() => sdk.client.memory.remove({ id }), [assistantQueryKey(sdk.scope, "memory")])
  }

  const kbQuery = useQuery(() => ({
    enabled: slotActive(),
    ...assistantQueryOptions(serverSDK().scope, "kb"),
    queryFn: async () => {
      const res = await serverSDK().client.kb.list({})
      return Array.isArray(res.data) ? res.data : []
    },
  }))
  const notes = createMemo(() => kbQuery.data ?? [])
  const [editor, setEditor] = createStore({
    scope: serverSDK().scope,
    note: undefined as KbNoteNote | undefined,
    title: "",
    content: "",
    creating: false,
  })
  let editorVersion = 0
  const noteMutation = AssistantMutation.create({ client: queryClient, onComplete: closeEditor })

  function openEditor(note: KbNoteNote) {
    editorVersion += 1
    noteMutation.reset()
    setEditor({
      scope: serverSDK().scope,
      note,
      title: note.title,
      content: note.content,
      creating: false,
    })
  }
  function startCreate() {
    editorVersion += 1
    noteMutation.reset()
    setEditor({ scope: serverSDK().scope, note: undefined, title: "", content: "", creating: true })
  }
  function closeEditor() {
    // A cancelled draft and a new draft can both have no note ID; their instances still differ.
    editorVersion += 1
    noteMutation.reset()
    setEditor({ note: undefined, creating: false })
  }
  function saveNote() {
    const sdk = serverSDK()
    if (noteMutation.blocked() || editor.scope !== sdk.scope || (!editor.creating && !editor.note)) return
    const version = editorVersion
    const id = editor.note?.id
    const input = { title: editor.title, content: editor.content }
    const current = () => !disposed && editorVersion === version
    setMutationError(undefined)
    void noteMutation
      .run(
        () => (id ? sdk.client.kb.update({ id, ...input }) : sdk.client.kb.create({ ...input, scope: "global" })),
        assistantKbQueryKeys(sdk.scope),
        current,
      )
      .catch(console.error)
  }
  function deleteNote(id: string) {
    const sdk = serverSDK()
    if (noteMutation.blocked() || editor.scope !== sdk.scope || editor.note?.id !== id) return
    const version = editorVersion
    const current = () => !disposed && editorVersion === version
    setMutationError(undefined)
    void noteMutation
      .run(() => sdk.client.kb.remove({ id }), assistantKbQueryKeys(sdk.scope), current)
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
    enabled: slotActive(),
    queryKey: [serverSDK().scope, "home", "assistant-sessions", ...projectDirectories()] as const,
    queryFn: async () => {
      // `rethrow` keeps the failure here instead of only a toast: without it the dashboard
      // rendered "no assistant sessions" for a list that never loaded.
      await Promise.all(
        projectDirectories().map((d) => sync().project.loadSessions(d, { limit: HOME_SESSION_LIMIT, rethrow: true })),
      )
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
    launchModeSession({
      mode: "assistant",
      projects: currentCtx.projects,
      server: ServerConnection.key(c),
      directory: dir,
      tabs,
    })
  }

  function cancelReminder(id: string) {
    const sdk = serverSDK()
    const sessionID = pending().find((item) => item.id === id)?.sessionID
    void runMutation(
      () => sdk.client.schedule.cancel({ id }),
      [
        assistantQueryKey(sdk.scope, "pending"),
        ...(sessionID ? [assistantQueryKey(sdk.scope, "panel", "reminders", sessionID)] : []),
      ],
    )
  }

  function markRead(deliveryKey: string) {
    const sdk = serverSDK()
    const sessionID = recent().find((item) => item.deliveryKey === deliveryKey)?.sessionID
    void runMutation(
      () => sdk.client.delivery.read({ deliveryKey }),
      [
        assistantQueryKey(sdk.scope, "recent"),
        ...(sessionID ? [assistantQueryKey(sdk.scope, "panel", "inbox", sessionID)] : []),
      ],
    )
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

        <Show when={mutationError()}>
          <div
            data-component="assistant-mutation-error"
            role="alert"
            class="flex items-center gap-2 rounded-md border border-v2-state-border-danger bg-v2-state-bg-danger px-3 py-2"
          >
            <Icon name="warning" size="small" class="shrink-0 text-v2-state-fg-danger" />
            <span class="min-w-0 flex-1 text-v2-state-fg-danger text-12-regular">{mutationError()}</span>
            <IconButtonV2
              variant="ghost-muted"
              size="small"
              icon={<Icon name="close" />}
              aria-label={language.t("common.dismiss")}
              onClick={() => setMutationError(undefined)}
            />
          </div>
        </Show>

        <section class="flex min-w-0 flex-col gap-3">
          <h2 class="text-v2-text-text-base text-13-medium">{language.t("assistant.dashboard.reminders")}</h2>
          <ReminderList
            pending={pending()}
            error={pendingQuery.isError}
            loading={pendingQuery.isLoading}
            onCancel={cancelReminder}
            onRetry={() => void pendingQuery.refetch()}
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
            <div role="alert" class="flex min-w-0 items-center gap-2">
              <p class="min-w-0 flex-1 text-v2-text-text-muted text-13-regular">
                {language.t("assistant.dashboard.loadError")}
              </p>
              <ButtonV2 variant="neutral" size="small" onClick={() => void memoryQuery.refetch()}>
                {language.t("assistant.citation.retry")}
              </ButtonV2>
            </div>
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

          <Show when={editor.scope === serverSDK().scope && (editor.creating || editor.note !== undefined)}>
            <div class="flex min-w-0 flex-col gap-2 rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-02 p-3">
              <Show when={noteMutation.state.phase === "write-failed" || noteMutation.state.phase === "refresh-failed"}>
                <div data-component="assistant-mutation-error" role="alert" class="flex min-w-0 items-center gap-2">
                  <p class="min-w-0 flex-1 text-v2-state-fg-danger text-12-regular">
                    {noteMutation.state.phase === "refresh-failed"
                      ? language.t("assistant.editor.refreshError")
                      : mutationErrorMessage(noteMutation.state.error, language.t("assistant.dashboard.actionError"))}
                  </p>
                  <Show when={noteMutation.state.phase === "refresh-failed"}>
                    <ButtonV2
                      variant="neutral"
                      size="small"
                      onClick={() => void noteMutation.retry().catch(console.error)}
                    >
                      {language.t("common.refresh")}
                    </ButtonV2>
                  </Show>
                </div>
              </Show>
              <input
                class="w-full rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-2 py-1 text-v2-text-text-base text-13-regular focus:outline-none"
                aria-label={language.t("assistant.kb.titlePlaceholder")}
                placeholder={language.t("assistant.kb.titlePlaceholder")}
                value={editor.title}
                disabled={noteMutation.blocked()}
                onInput={(event) => setEditor("title", event.currentTarget.value)}
              />
              <textarea
                class="min-h-24 w-full resize-y rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-2 py-1 text-v2-text-text-base text-13-regular focus:outline-none"
                aria-label={language.t("assistant.kb.contentPlaceholder")}
                placeholder={language.t("assistant.kb.contentPlaceholder")}
                value={editor.content}
                disabled={noteMutation.blocked()}
                onInput={(event) => setEditor("content", event.currentTarget.value)}
              />
              <div class="flex items-center gap-2">
                <IconButtonV2
                  variant="neutral"
                  size="small"
                  icon={<Icon name="status-active" />}
                  aria-label={language.t("assistant.kb.save")}
                  disabled={noteMutation.blocked()}
                  onClick={saveNote}
                />
                <IconButtonV2
                  variant="ghost-muted"
                  size="small"
                  icon={<Icon name="xmark-small" />}
                  aria-label={language.t("assistant.kb.cancel")}
                  onClick={closeEditor}
                />
                <Show when={editor.note !== undefined}>
                  <IconButtonV2
                    variant="ghost-muted"
                    size="small"
                    icon={<Icon name="xmark-small" />}
                    aria-label={language.t("assistant.kb.delete")}
                    disabled={noteMutation.blocked()}
                    onClick={() => {
                      const editingNote = editor.note
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
                    <span class="min-w-0 flex-1 truncate text-v2-text-text-base text-13-regular">
                      {note.title ?? ""}
                    </span>
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
          <Show when={sessionLoad.isError}>
            <div role="alert" class="flex min-w-0 items-center gap-2">
              <p class="min-w-0 flex-1 text-v2-text-text-muted text-13-regular">
                {language.t("assistant.dashboard.loadError")}
              </p>
              <ButtonV2 variant="neutral" size="small" onClick={() => void sessionLoad.refetch()}>
                {language.t("assistant.citation.retry")}
              </ButtonV2>
            </div>
          </Show>
          <Show
            when={!sessionLoad.isLoading}
            fallback={<HomeSessionSkeleton label={language.t("assistant.dashboard.title")} />}
          >
            <Show when={!sessionLoad.isError && groups().length > 0}>
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
