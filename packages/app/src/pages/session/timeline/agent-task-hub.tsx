import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { Popover as KobaltePopover } from "@kobalte/core/popover"
import { CheckboxV2 } from "@aigcfroge/ui/v2/checkbox-v2"
import { Button } from "@aigcfroge/ui/button"
import { TextField } from "@aigcfroge/ui/text-field"
import { Icon } from "@aigcfroge/ui/icon"
import { useLanguage } from "@/context/language"
import { useLocal } from "@/context/local"
import { useServerSync } from "@/context/server-sync"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { showToast } from "@/utils/toast"
import type { SessionTaskInfo, SessionTaskWriteInfo } from "@aigcfroge/sdk/v2/client"
import {
  aggregateAgentTasks,
  newScheduledTask,
  scheduledAgentTasks,
  sessionCountForAgent,
  unassignedTasks,
  withoutTask,
  type AgentTaskRow,
} from "@/pages/session/timeline/agent-task-hub-model"
import {
  formatFullTime,
  isScheduledActive,
  isScheduledTask,
  scheduledToggleStatus,
} from "@/pages/session/timeline/session-scheduled-tasks-model"

/** Sentinel key for the "未归属" pseudo-entry in the agent list. */
const UNASSIGNED = "__unassigned__"

type HubAgentRow = { key: string; label: string; detail?: string }

/**
 * M4 AgentTaskHub (plan §5.3 Layer 4 + §8 M4, entry §5.7): an Agent-视角
 * aggregation popover with the Accio agent-panel three-zone layout.
 * Step 4 turns zone 2 into the agent detail: the selected agent's tasks with
 * scheduled-task management (pause/resume checkbox + delete) and a
 * create-scheduled-task form.
 *
 * Data source: on open, `GET /agent-task` seeds the session_task store with
 * every session's tasks; the store is the reactive source (task.updated SSE).
 * Writebacks PATCH `session.task.update` with a minimal shape — the server
 * reconcile preserves omitted schedule/agent fields, so toggle/delete never
 * clobber the schedule (task.ts preserve-omitted semantics).
 */
export function AgentTaskHub(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  anchorRef: () => HTMLButtonElement | undefined
  sessionID: () => string | undefined
}) {
  const language = useLanguage()
  const local = useLocal()
  const serverSync = useServerSync()
  const sync = useSync()
  const sdk = useSDK()

  createEffect(() => {
    if (!props.open) return
    void loadCrossSessionTasks()
  })

  const loadCrossSessionTasks = async () => {
    try {
      const result = await sdk().client.agentTask.list({ directory: sdk().directory })
      const tasks = result.data ?? []
      const bySession = new Map<string, SessionTaskInfo[]>()
      for (const task of tasks) {
        const list = bySession.get(task.sessionID) ?? []
        list.push(task)
        bySession.set(task.sessionID, list)
      }
      for (const [sessionID, list] of bySession) serverSync().task.set(sessionID, list)
    } catch (error) {
      const description = error instanceof Error ? error.message : String(error)
      showToast({ title: language.t("session.agentHub.loadFailed"), description })
    }
  }

  const store = serverSync().data.session_task
  const agents = createMemo(() => sync().data.agent.filter((agent) => agent.mode !== "subagent" && !agent.hidden))
  const sessions = createMemo(() => sync().data.session)
  const unassigned = createMemo(() => unassignedTasks(store))
  const agentRows = createMemo<readonly HubAgentRow[]>(() => [
    ...agents().map((agent) => ({ key: agent.name, label: agent.name, detail: agent.mode })),
    ...(unassigned().length > 0
      ? [{ key: UNASSIGNED, label: language.t("session.agentHub.unassigned"), detail: undefined }]
      : []),
  ])

  const [selected, setSelected] = createSignal(local.agent.current()?.name)
  const isUnassigned = () => selected() === UNASSIGNED
  const agentName = () => (isUnassigned() ? undefined : selected())

  const taskRows = createMemo(() => (isUnassigned() ? unassigned() : aggregateAgentTasks(store, selected())))
  const scheduled = createMemo(() => (isUnassigned() ? [] : scheduledAgentTasks(store, selected())))
  const sessionCount = createMemo(() => {
    const agent = agentName()
    if (!agent) return 0
    return sessionCountForAgent(sessions(), agent)
  })
  const selectedLabel = () => (isUnassigned() ? language.t("session.agentHub.unassigned") : agentName() ?? "")

  // ── writebacks (task_schedule semantics over PATCH /session/:id/task) ──

  const minimal = (tasks: readonly SessionTaskInfo[]): SessionTaskWriteInfo[] =>
    tasks.map((task) => ({ id: task.id, content: task.content, status: task.status, priority: task.priority }))

  const patch = (sessionID: string, body: SessionTaskWriteInfo[]) =>
    sdk()
      .client.session.task.update({ sessionID, directory: sdk().directory, body })
      .catch((err: unknown) => {
        const description = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("session.scheduled.writeback.failed.title"), description })
      })

  // pause/resume: flip the target's status scheduled↔cancelled.
  const toggleTask = (row: AgentTaskRow, checked: boolean) => {
    const all = serverSync().data.session_task[row.sessionID] ?? []
    void patch(
      row.sessionID,
      all.map((task) => ({
        id: task.id,
        content: task.content,
        status: task.id === row.id ? scheduledToggleStatus(checked) : task.status,
        priority: task.priority,
      })),
    )
  }

  // remove: drop the target so reconcile deletes it server-side.
  const removeTask = (row: AgentTaskRow) => {
    const all = serverSync().data.session_task[row.sessionID] ?? []
    void patch(row.sessionID, minimal(withoutTask(all, row.id)))
  }

  // ── create a scheduled task (attaches to the hub's anchor session) ──

  const [creating, setCreating] = createSignal(false)
  const [content, setContent] = createSignal("")
  const [cron, setCron] = createSignal("")
  const [at, setAt] = createSignal("")

  const canCreate = createMemo(() => {
    if (isUnassigned() || !props.sessionID()) return false
    return content().trim().length > 0 && (cron().trim().length > 0 || at().length > 0)
  })

  const submitCreate = () => {
    const sessionID = props.sessionID()
    const agent = agentName()
    if (!sessionID || !agent || !canCreate()) return
    const all = serverSync().data.session_task[sessionID] ?? []
    const created = newScheduledTask({
      content: content().trim(),
      agentID: agent,
      ...(cron().trim().length > 0 ? { recurrence: { cron: cron().trim(), enabled: true } } : {}),
      ...(at().length > 0 ? { scheduledAt: new Date(at()).getTime() } : {}),
    })
    void patch(sessionID, [...minimal(all), created])
    setCreating(false)
    setContent("")
    setCron("")
    setAt("")
  }

  // SDK number fields are `number | "NaN" | ...`; guard before formatting.
  const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)

  const scheduleInfo = (row: AgentTaskRow): string => {
    const description = row.recurrence ? row.recurrence.cron : language.t("session.scheduled.oneshot")
    return finite(row.nextRun) ? `${description} · ${formatFullTime(row.nextRun, language.intl())}` : description
  }

  return (
    <KobaltePopover
      open={props.open}
      anchorRef={props.anchorRef}
      placement="bottom-end"
      gutter={4}
      modal={false}
      onOpenChange={props.onOpenChange}
    >
      <KobaltePopover.Portal>
        <KobaltePopover.Content
          data-component="popover-content"
          style={{ "min-width": "320px", "max-height": "min(70vh, 520px)" }}
        >
          <div class="flex flex-col p-3 gap-3" data-component="agent-task-hub">
            {/* Zone 1: my agents */}
            <div class="flex flex-col gap-1">
              <div class="text-13-medium text-text-strong">{language.t("session.agentHub.agents")}</div>
              <div class="flex flex-col gap-0.5" data-component="agent-task-hub-agents">
                <For each={agentRows()}>
                  {(row) => (
                    <button
                      type="button"
                      data-component="agent-task-hub-agent"
                      data-selected={row.key === selected() ? "true" : undefined}
                      class="flex items-center justify-between gap-2 px-2 py-1 rounded-md text-left text-13-regular text-text-base hover:bg-surface-base-active"
                      onClick={() => setSelected(row.key)}
                    >
                      <span class="truncate">{row.label}</span>
                      {row.detail ? <span class="text-11-regular text-text-weak">{row.detail}</span> : null}
                    </button>
                  )}
                </For>
              </div>
            </div>
            {/* Zone 2: selected agent's tasks with scheduled-task management */}
            <Show when={selected() !== undefined}>
              <div class="flex flex-col gap-2" data-component="agent-task-hub-detail">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-13-medium text-text-strong truncate">{selectedLabel()}</span>
                  <span class="text-11-regular text-text-weak shrink-0">
                    {language.t("session.agentHub.detailCounts", { sessions: sessionCount(), tasks: scheduled().length })}
                  </span>
                </div>
                <Show
                  when={taskRows().length > 0}
                  fallback={
                    <div class="text-12-regular text-text-weak" data-component="agent-task-hub-empty">
                      {language.t("session.agentHub.empty")}
                    </div>
                  }
                >
                  <div class="flex flex-col gap-1 overflow-y-auto" data-component="agent-task-hub-tasks">
                    <For each={taskRows()}>
                      {(row) =>
                        isScheduledTask(row) ? (
                          <div class="flex items-center gap-1" data-component="agent-task-hub-scheduled">
                            <CheckboxV2
                              checked={isScheduledActive(row.status)}
                              onChange={(checked) => toggleTask(row, checked)}
                              label={<span class="truncate">{row.content}</span>}
                              description={scheduleInfo(row)}
                            />
                            <button
                              type="button"
                              data-component="agent-task-hub-task-delete"
                              aria-label={language.t("session.agentHub.deleteTask")}
                              class="shrink-0 text-12-regular text-text-weak hover:text-text-strong px-1"
                              onClick={() => removeTask(row)}
                            >
                              <Icon name="close" class="size-3" />
                            </button>
                          </div>
                        ) : (
                          <div
                            data-component="agent-task-hub-task"
                            data-status={row.status}
                            class="flex items-center justify-between gap-2 text-12-regular"
                          >
                            <span class="truncate text-text-base">{row.content}</span>
                            <span class="text-11-regular text-text-weak">{row.status}</span>
                          </div>
                        )
                      }
                    </For>
                  </div>
                </Show>
                <Show when={agentName()}>
                  <Show when={creating()}>
                    <div class="flex flex-col gap-2" data-component="agent-task-hub-create-form">
                      <TextField
                        value={content()}
                        onInput={(event) => setContent(event.currentTarget.value)}
                        placeholder={language.t("session.agentHub.taskContent")}
                      />
                      <div class="flex gap-2">
                        <TextField
                          value={cron()}
                          onInput={(event) => setCron(event.currentTarget.value)}
                          placeholder={language.t("session.agentHub.taskCron")}
                          class="flex-1"
                        />
                        <TextField
                          type="datetime-local"
                          value={at()}
                          onInput={(event) => setAt(event.currentTarget.value)}
                          aria-label={language.t("session.agentHub.taskAt")}
                          class="flex-1"
                        />
                      </div>
                      <Button
                        variant="primary"
                        size="normal"
                        class="w-full"
                        disabled={!canCreate()}
                        onClick={submitCreate}
                      >
                        {language.t("session.agentHub.newTask")}
                      </Button>
                    </div>
                  </Show>
                  <Button
                    variant="secondary"
                    size="normal"
                    class="w-full"
                    onClick={() => setCreating(!creating())}
                  >
                    {creating() ? language.t("common.cancel") : language.t("session.agentHub.newTask")}
                  </Button>
                </Show>
              </div>
            </Show>
            {/* Zone 3: new entry placeholder (spawn lands in M5) */}
            <button
              type="button"
              disabled
              data-component="agent-task-hub-new"
              class="w-full px-2 py-1.5 rounded-md text-left text-12-regular text-text-weak"
              title={language.t("session.agentHub.new.tooltip")}
            >
              {language.t("session.agentHub.new")}
            </button>
          </div>
        </KobaltePopover.Content>
      </KobaltePopover.Portal>
    </KobaltePopover>
  )
}
