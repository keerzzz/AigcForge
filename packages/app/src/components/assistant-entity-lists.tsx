import { For, Show } from "solid-js"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { IconButtonV2 } from "@aigcfroge/ui/v2/icon-button-v2"
import { useLanguage } from "@/context/language"
import type { PersonalMemoryInfo, ScheduleDelivery, ScheduleInfo } from "@aigcfroge/sdk/v2/client"

/** Shared Assistant entity lists used by the dashboard and session panel. */

export const formatDueAt = (dueAt: number | "-Infinity" | "Infinity" | "NaN") =>
  new Date(typeof dueAt === "number" ? dueAt : Date.now()).toLocaleString()

const STATUS_LABEL: Record<ScheduleInfo["status"], string> = {
  pending: "assistant.reminder.status.pending",
  running: "assistant.reminder.status.running",
  completed: "assistant.reminder.status.completed",
  cancelled: "assistant.reminder.status.cancelled",
  failed: "assistant.reminder.status.failed",
}

export function ReminderList(props: {
  pending: ScheduleInfo[]
  error?: boolean
  loading?: boolean
  onCancel: (id: string) => void
  emptyLabel: string
  errorLabel: string
  showStatus?: boolean
  /** Highlights the row targeted by openEntityPanel. */
  targetId?: string
}) {
  const language = useLanguage()
  return (
    <div class="flex min-w-0 flex-col gap-2 rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-02 p-3">
      <Show when={props.error}>
        <p class="text-v2-text-text-muted text-13-regular">{props.errorLabel}</p>
      </Show>
      <Show when={!props.error}>
        <Show
          when={props.pending.length > 0}
          fallback={props.loading ? null : <p class="text-v2-text-text-muted text-13-regular">{props.emptyLabel}</p>}
        >
          <p class="text-v2-text-text-base text-13-medium">
            {language.t("assistant.dashboard.pendingCount", { count: String(props.pending.length) })}
          </p>
          <div class="flex min-w-0 flex-col gap-px">
            <For each={props.pending}>
              {(reminder: ScheduleInfo) => (
                <div
                  class="flex min-w-0 items-center gap-2 rounded-[4px] py-1"
                  data-targeted={reminder.id === props.targetId ? "" : undefined}
                  classList={{ "bg-v2-background-bg-layer-03": reminder.id === props.targetId }}
                >
                  <Icon name="mode-assistant" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                  <span class="min-w-0 flex-1 truncate text-v2-text-text-base text-13-regular">
                    {reminder.content ?? ""}
                  </span>
                  <span class="shrink-0 text-v2-text-text-muted text-11-regular">
                    {formatDueAt(reminder.dueAt)} · {reminder.timezone ?? ""}
                  </span>
                  <Show when={props.showStatus}>
                    <span class="shrink-0 rounded-[3px] border border-v2-border-border-base px-1 py-0.5 text-10-regular text-v2-text-text-muted">
                      {language.t(STATUS_LABEL[reminder.status])}
                    </span>
                  </Show>
                  <IconButtonV2
                    variant="ghost-muted"
                    size="small"
                    icon={<Icon name="xmark-small" />}
                    aria-label={language.t("assistant.dashboard.cancelReminder")}
                    onClick={() => props.onCancel(reminder.id)}
                  />
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  )
}

export function MemoryInspector(props: {
  pending: PersonalMemoryInfo[]
  confirmed: PersonalMemoryInfo[]
  onConfirm: (id: string) => void
  onReject: (id: string) => void
  onRemove: (id: string) => void
  /** Highlights the row targeted by openEntityPanel. */
  targetId?: string
}) {
  const language = useLanguage()
  return (
    <>
      <Show when={props.pending.length > 0}>
        <div class="flex min-w-0 flex-col gap-2">
          <p class="text-v2-text-text-muted text-12-regular">{language.t("assistant.memory.pending")}</p>
          <div class="flex min-w-0 flex-col gap-px">
            <For each={props.pending}>
              {(memory: PersonalMemoryInfo) => (
                <div
                  class="flex min-w-0 items-center gap-2 rounded-[4px] py-1"
                  data-targeted={memory.id === props.targetId ? "" : undefined}
                  classList={{ "bg-v2-background-bg-layer-03": memory.id === props.targetId }}
                >
                  <Icon name="status" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                  <span class="min-w-0 flex-1 truncate text-v2-text-text-base text-13-regular">
                    {memory.content ?? ""}
                  </span>
                  <span class="shrink-0 text-v2-text-text-faint text-11-regular">{memory.source}</span>
                  <IconButtonV2
                    variant="neutral"
                    size="small"
                    icon={<Icon name="status-active" />}
                    aria-label={language.t("assistant.memory.confirm")}
                    onClick={() => props.onConfirm(memory.id)}
                  />
                  <IconButtonV2
                    variant="ghost-muted"
                    size="small"
                    icon={<Icon name="xmark-small" />}
                    aria-label={language.t("assistant.memory.reject")}
                    onClick={() => props.onReject(memory.id)}
                  />
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
      <Show when={props.confirmed.length > 0}>
        <div class="flex min-w-0 flex-col gap-2">
          <p class="text-v2-text-text-muted text-12-regular">{language.t("assistant.memory.confirmed")}</p>
          <div class="flex min-w-0 flex-col gap-px">
            <For each={props.confirmed}>
              {(memory: PersonalMemoryInfo) => (
                <div class="flex min-w-0 items-center gap-2 py-1">
                  <Icon name="status-active" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                  <span class="min-w-0 flex-1 truncate text-v2-text-text-base text-13-regular">
                    {memory.content ?? ""}
                  </span>
                  <IconButtonV2
                    variant="ghost-muted"
                    size="small"
                    icon={<Icon name="xmark-small" />}
                    aria-label={language.t("assistant.memory.delete")}
                    onClick={() => props.onRemove(memory.id)}
                  />
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </>
  )
}

export function DeliveryList(props: { records: ScheduleDelivery[]; onMarkRead: (deliveryKey: string) => void }) {
  const language = useLanguage()
  return (
    <div class="flex min-w-0 flex-col gap-px">
      <For each={props.records}>
        {(delivery: ScheduleDelivery) => (
          <div class="flex min-w-0 items-center gap-2 py-1">
            <Icon name="status-active" size="small" class="shrink-0 text-v2-icon-icon-muted" />
            <span class="min-w-0 flex-1 truncate text-v2-text-text-base text-13-regular">{delivery.content ?? ""}</span>
            <span class="shrink-0 text-v2-text-text-muted text-11-regular">{formatDueAt(delivery.deliveredAt)}</span>
            <Show when={delivery.caughtUp}>
              <span class="shrink-0 text-v2-text-text-faint text-11-regular">
                {language.t("assistant.dashboard.caughtUp")}
              </span>
            </Show>
            <IconButtonV2
              variant="ghost-muted"
              size="small"
              icon={<Icon name="status-active" />}
              aria-label={language.t("assistant.dashboard.markRead")}
              onClick={() => props.onMarkRead(delivery.deliveryKey)}
            />
          </div>
        )}
      </For>
    </div>
  )
}
