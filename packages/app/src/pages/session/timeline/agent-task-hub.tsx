import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { Popover as KobaltePopover } from "@kobalte/core/popover"
import { useLanguage } from "@/context/language"
import { useLocal } from "@/context/local"
import { useServerSync } from "@/context/server-sync"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { showToast } from "@/utils/toast"
import type { SessionTaskInfo } from "@aigcfroge/sdk/v2/client"
import {
  aggregateAgentTasks,
  activeTaskCount,
  unassignedTasks,
} from "@/pages/session/timeline/agent-task-hub-model"

/** Sentinel key for the "未归属" pseudo-entry in the agent list. */
const UNASSIGNED = "__unassigned__"

type HubAgentRow = { key: string; label: string; detail?: string }

/**
 * M4 AgentTaskHub (plan §5.3 Layer 4 + §8 M4, entry §5.7): an Agent-视角
 * aggregation popover with the Accio agent-panel three-zone layout:
 *
 *   1. 我的智能体 — every user agent (non-subagent, non-hidden) plus a
 *      "未归属" pseudo-entry when unassigned tasks exist.
 *   2. 任务衍生 — the selected agent's tasks aggregated across every session,
 *      with an active-work count.
 *   3. 新建 — placeholder entry; the spawn action lands in M5 (task_spawn).
 *
 * Data source (Step 3): on open, `GET /agent-task` seeds the session_task store
 * with every session's tasks, so aggregation is not limited to sessions already
 * loaded. The store stays the reactive source (task.updated SSE refreshes it).
 */
export function AgentTaskHub(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  anchorRef: () => HTMLButtonElement | undefined
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
  const unassigned = createMemo(() => unassignedTasks(store))
  const agentRows = createMemo<readonly HubAgentRow[]>(() => [
    ...agents().map((agent) => ({ key: agent.name, label: agent.name, detail: agent.mode })),
    ...(unassigned().length > 0
      ? [{ key: UNASSIGNED, label: language.t("session.agentHub.unassigned"), detail: undefined }]
      : []),
  ])

  const [selected, setSelected] = createSignal(local.agent.current()?.name)

  const rows = createMemo(() =>
    selected() === UNASSIGNED ? unassigned() : aggregateAgentTasks(store, selected()),
  )
  const active = createMemo(() => activeTaskCount(rows()))

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
        <KobaltePopover.Content data-component="popover-content" style={{ "min-width": "320px" }}>
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
            {/* Zone 2: derived tasks for the selected agent */}
            <div class="flex flex-col gap-1">
              <div class="flex items-center justify-between text-13-medium text-text-strong">
                <span>{language.t("session.agentHub.derived")}</span>
                <span class="text-11-regular text-text-weak">{active()} {language.t("session.agentHub.active")}</span>
              </div>
              <Show
                when={rows().length > 0}
                fallback={
                  <div class="text-12-regular text-text-weak" data-component="agent-task-hub-empty">
                    {language.t("session.agentHub.empty")}
                  </div>
                }
              >
                <div class="flex flex-col gap-1" data-component="agent-task-hub-tasks">
                  <For each={rows()}>
                    {(row) => (
                      <div
                        data-component="agent-task-hub-task"
                        data-status={row.status}
                        class="flex items-center justify-between gap-2 text-12-regular"
                      >
                        <span class="truncate text-text-base">{row.content}</span>
                        <span class="text-11-regular text-text-weak">{row.status}</span>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
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
