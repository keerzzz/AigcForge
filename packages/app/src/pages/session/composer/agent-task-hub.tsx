import { For, Show, createMemo, createSignal } from "solid-js"
import { Popover as KobaltePopover } from "@kobalte/core/popover"
import { useLanguage } from "@/context/language"
import { useLocal } from "@/context/local"
import { useServerSync } from "@/context/server-sync"
import { aggregateAgentTasks, activeTaskCount } from "@/pages/session/composer/agent-task-hub-model"

/**
 * M4 AgentTaskHub (plan §5.3 Layer 4 + §8 M4): an Agent-视角 aggregation panel
 * with the Accio agent-panel three-zone layout:
 *
 *   1. 我的智能体 — selectable agent list (from the current mode's orchestrator
 *      set via `local.agent.list()`).
 *   2. 任务衍生 — the selected agent's tasks aggregated across every session
 *      (session_task store), with an active-work count.
 *   3. 新建 — placeholder entry; the spawn action lands in M5 (task_spawn).
 */
export function AgentTaskHub(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  anchorRef: () => HTMLButtonElement | undefined
}) {
  const language = useLanguage()
  const local = useLocal()
  const serverSync = useServerSync()

  const agents = createMemo(() => local.agent.list())
  const [selected, setSelected] = createSignal<string | undefined>(local.agent.current()?.name)

  const rows = createMemo(() => aggregateAgentTasks(serverSync().data.session_task, selected()))
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
                <For each={agents()}>
                  {(agent) => (
                    <button
                      type="button"
                      data-component="agent-task-hub-agent"
                      data-selected={agent.name === selected() ? "true" : undefined}
                      class="flex items-center justify-between gap-2 px-2 py-1 rounded-md text-left text-13-regular text-text-base hover:bg-surface-base-active"
                      onClick={() => setSelected(agent.name)}
                    >
                      <span class="truncate">{agent.name}</span>
                      <span class="text-11-regular text-text-weak">{agent.mode}</span>
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
