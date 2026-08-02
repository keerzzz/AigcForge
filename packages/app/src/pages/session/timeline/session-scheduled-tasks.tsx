import { Show, createMemo, createSignal } from "solid-js"
import { CheckboxV2 } from "@aigcfroge/ui/v2/checkbox-v2"
import { Popover as KobaltePopover } from "@kobalte/core/popover"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import {
  formatFullTime,
  formatNextRun,
  isScheduledActive,
  isScheduledTask,
  nextScheduledRun,
  scheduledToggleStatus,
} from "@/pages/session/timeline/session-scheduled-tasks-model"

/**
 * M3b-2 scheduled-task UI (plan §5.6). Two pieces, one file:
 *
 * - `SessionScheduledChip` — a `⚡ 9:00` timestamp in the session title row
 *   showing the earliest upcoming trigger across the session's scheduled tasks
 *   (constant display, §5.6 "标题左侧").
 * - `SessionScheduledTasksPopover` — the dot-grid "定时任务" popover listing
 *   every scheduled task with an interactive checkbox that PATCHes the
 *   reconciled list back over `PATCH /session/:id/task` (same writeback path as
 *   the M2c todo fold-over).
 *
 * Data source is the id-bearing `session_task` store (task.updated); the
 * writeback omits schedule fields, which the server preserves on reconcile.
 */
export function SessionScheduledChip(props: { sessionID: () => string | undefined }) {
  const serverSync = useServerSync()
  const language = useLanguage()

  const nextRun = createMemo(() => {
    const id = props.sessionID()
    if (!id) return undefined
    const tasks = serverSync().data.session_task[id] ?? []
    return nextScheduledRun(tasks)
  })

  return (
    <Show when={nextRun()} keyed>
      {(run) => (
        <span
          data-component="session-scheduled-chip"
          class="shrink-0 flex items-center gap-1 text-12-regular text-text-weak"
          title={formatFullTime(run, language.intl())}
          aria-label={language.t("session.scheduled.chip.aria", { time: formatFullTime(run, language.intl()) })}
        >
          <span aria-hidden="true">⚡</span>
          {formatNextRun(run, language.intl())}
        </span>
      )}
    </Show>
  )
}

export function SessionScheduledTasksPopover(props: {
  sessionID: () => string | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
  anchorRef: () => HTMLButtonElement | undefined
}) {
  const language = useLanguage()
  const serverSync = useServerSync()
  const sdk = useSDK()
  const [dismiss, setDismiss] = createSignal<"escape" | "outside" | null>(null)

  const tasks = createMemo(() => {
    const id = props.sessionID()
    if (!id) return []
    return (serverSync().data.session_task[id] ?? []).filter(isScheduledTask)
  })

  // SDK number fields are `number | "NaN" | ...`; guard before formatting.
  const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)

  // Checkbox writeback: flip the target task's status and PATCH the full list
  // back (reconcile). The server preserves omitted schedule fields, and the
  // republished task.updated refreshes the store — no manual set here.
  const writeback = (targetID: string, checked: boolean) => {    const id = props.sessionID()
    if (!id) return
    const all = serverSync().data.session_task[id] ?? []
    void sdk()
      .client.session.task.update({
        sessionID: id,
        directory: sdk().directory,
        body: all.map((task) => ({
          id: task.id,
          content: task.content,
          status: task.id === targetID ? scheduledToggleStatus(checked) : task.status,
          priority: task.priority,
        })),
      })
      .catch((err: unknown) => {
        const description = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("session.scheduled.writeback.failed.title"), description })
      })
  }

  return (
    <KobaltePopover
      open={props.open}
      anchorRef={props.anchorRef}
      placement="bottom-end"
      gutter={4}
      modal={false}
      onOpenChange={(open) => {
        if (open) setDismiss(null)
        props.onOpenChange(open)
      }}
    >
      <KobaltePopover.Portal>
        <KobaltePopover.Content
          data-component="popover-content"
          style={{ "min-width": "300px" }}
          onEscapeKeyDown={(event) => {
            setDismiss("escape")
            props.onOpenChange(false)
            event.preventDefault()
            event.stopPropagation()
          }}
          onPointerDownOutside={() => {
            setDismiss("outside")
            props.onOpenChange(false)
          }}
          onFocusOutside={() => {
            setDismiss("outside")
            props.onOpenChange(false)
          }}
          onCloseAutoFocus={(event) => {
            if (dismiss() === "outside") event.preventDefault()
            setDismiss(null)
          }}
        >
          <div class="flex flex-col p-3 gap-2" data-component="session-scheduled-popover">
            <div class="text-13-medium text-text-strong">{language.t("session.scheduled.title")}</div>
            <Show when={tasks().length > 0} fallback={<div class="text-12-regular text-text-weak">{language.t("session.scheduled.empty")}</div>}>
              <div class="flex flex-col gap-1" data-component="session-scheduled-list">
                <Show when={tasks().length > 0}>
                  {tasks().map((task) => {
                    const description = task.recurrence
                      ? task.recurrence.cron
                      : language.t("session.scheduled.oneshot")
                    const suffix = finite(task.nextRun)
                      ? ` · ${formatFullTime(task.nextRun, language.intl())}`
                      : ""
                    return (
                      <CheckboxV2
                        checked={isScheduledActive(task.status)}
                        onChange={(checked) => writeback(task.id, checked)}
                        label={<span class="truncate">{task.content}</span>}
                        description={`${description}${suffix}`}
                      />
                    )
                  })}
                </Show>
              </div>
            </Show>
          </div>
        </KobaltePopover.Content>
      </KobaltePopover.Portal>
    </KobaltePopover>
  )
}
