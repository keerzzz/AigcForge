import { createEffect, createMemo, For, on, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Schema } from "effect"
import { Checkbox } from "@aigcfroge/ui/checkbox"
import { Button } from "@aigcfroge/ui/button"
import { DockTray } from "@aigcfroge/ui/dock-surface"
import { Icon } from "@aigcfroge/ui/icon"
import { Keybind } from "@aigcfroge/ui/keybind"
import { Tooltip } from "@aigcfroge/ui/tooltip"
import { useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useSessionContent } from "../content-context"

export type SessionTaskSource = {
  readonly sessionID: string
  readonly messageID: string
  readonly toolCallID: string
}

export function SessionTodoDock(props: {
  sessionID: string
  onOpenSource?: (source: SessionTaskSource) => void
  onOpenTask?: (taskID: string) => void
}) {
  const language = useLanguage()
  const data = useData()
  const server = useServerSDK()
  const command = useCommand()
  const embedded = useSessionContent()
  const [state, setState] = createStore({ collapsed: false, failed: false })
  const tasks = createMemo(() => data.session.task.list(props.sessionID) ?? [])
  const done = createMemo(() => tasks().filter((task) => task.status === "completed").length)
  const toggle = () => setState("collapsed", !state.collapsed)

  // Embedded conversations do not publish global commands, like their composer.
  if (!embedded)
    command.register(() => [
      {
        id: "session.tasks.toggle",
        title: language.t(state.collapsed ? "session.tasks.expand" : "session.tasks.collapse"),
        category: language.t("command.category.view"),
        keybind: "mod+alt+j",
        disabled: tasks().length === 0,
        onSelect: toggle,
      },
    ])

  const sources = createMemo(() => {
    const result = new Map<string, SessionTaskSource[]>()

    data.session.message.list(props.sessionID).forEach((message) => {
      if (message.type !== "assistant") return

      message.content.forEach((tool) => {
        if (tool.type !== "tool" || tool.name !== "task" || tool.state.status === "streaming") return

        const taskID = tool.state.metadata?.parentTaskID

        if (!Schema.is(Schema.String)(taskID)) return

        result.set(taskID, [
          ...(result.get(taskID) ?? []),
          { sessionID: props.sessionID, messageID: message.id, toolCallID: tool.id },
        ])
      })
    })

    return result
  })

  const active = createMemo(
    () =>
      tasks().find((task) => task.status === "in_progress") ??
      tasks().find((task) => task.status === "pending") ??
      tasks()
        .filter((task) => task.status === "completed")
        .at(-1) ??
      tasks()[0],
  )

  // Data owns the task snapshot and rejects stale reads. The dock only requests refreshes.
  createEffect(
    on(
      () =>
        [
          props.sessionID,
          data.session.get(props.sessionID)?.location.directory,
          server.connection.status(),
          server.connection.attempt(),
        ] as const,
      ([sessionID, directory, status]) => {
        if (!directory || status !== "connected") return

        let live = true

        const refresh = () => {
          data.session.task.invalidate(sessionID)
          void data.session.task.sync(sessionID).then(
            () => {
              if (live) setState("failed", false)
            },
            () => {
              if (live) setState("failed", true)
            },
          )
        }

        refresh()
        onCleanup(
          data.on("task.updated", (event) => {
            if (event.data.sessionID === sessionID) refresh()
          }),
        )
        onCleanup(() => {
          live = false
        })
      },
    ),
  )

  createEffect(
    on(
      () => tasks().length > 0 && tasks().every((task) => task.status === "completed" || task.status === "cancelled"),
      (complete, previous) => {
        if (complete || previous) setState("collapsed", complete)
      },
    ),
  )

  return (
    <Show when={tasks().length || (state.failed && data.session.task.list(props.sessionID) === undefined)}>
      <DockTray
        data-component="session-todo-dock"
        role="region"
        aria-label={language.t("session.tasks.title")}
        class="mb-2"
      >
        <Tooltip
          value={
            <>
              {language.t(state.collapsed ? "session.tasks.expand" : "session.tasks.collapse")}
              <Show when={!embedded && command.keybindParts("session.tasks.toggle").length > 0}>
                <Keybind keys={command.keybindParts("session.tasks.toggle")} variant="neutral" />
              </Show>
            </>
          }
          class="w-full"
          placement="top"
        >
          <Button
            type="button"
            variant="ghost"
            class="min-h-10 w-full justify-start gap-2 px-3 py-2 text-start text-13-regular"
            aria-label={language.t(state.collapsed ? "session.tasks.expand" : "session.tasks.collapse")}
            aria-expanded={!state.collapsed}
            onClick={toggle}
          >
            <span class="shrink-0 text-text-strong">
              <Show when={tasks().length} fallback={language.t("session.tasks.title")}>
                {language.plural("session.todo.progress", tasks().length, { done: done(), total: tasks().length })}
              </Show>
            </span>
            <Show when={state.collapsed}>
              <span class="min-w-0 flex-1 truncate text-text-weak">{active()?.content}</span>
            </Show>
            <Icon
              name="chevron-down"
              size="small"
              class="ml-auto shrink-0"
              classList={{ "rotate-180": state.collapsed }}
            />
          </Button>
        </Tooltip>
        <Show when={state.failed}>
          <div role="status" class="px-3 pb-2 text-13-regular text-text-weak">
            {language.t("session.todo.error")}
            <Button
              type="button"
              variant="ghost"
              size="small"
              onClick={() => {
                data.session.task.invalidate(props.sessionID)
                void data.session.task.sync(props.sessionID).then(
                  () => setState("failed", false),
                  () => setState("failed", true),
                )
              }}
            >
              {language.t("common.retry")}
            </Button>
          </div>
        </Show>
        <Show when={!state.collapsed}>
          <ul class="max-h-40 space-y-1.5 overflow-y-auto px-3 pb-3">
            <For each={tasks()}>
              {(task) => (
                <li
                  class="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 text-13-regular [&>[data-component=checkbox]]:flex-[1_1_16ch] [&_[data-component=checkbox]]:min-w-0 [&_[data-slot=checkbox-checkbox-content]]:min-w-0"
                  aria-label={language.t("session.tasks.item", { name: task.content })}
                >
                  <Checkbox
                    readOnly
                    checked={task.status === "completed"}
                    indeterminate={task.status === "in_progress"}
                    icon={
                      task.status === "in_progress" ? <span class="size-1.5 rounded-full bg-icon-base" /> : undefined
                    }
                  >
                    <span
                      class="[overflow-wrap:anywhere]"
                      classList={{
                        "line-through text-text-weak": task.status === "completed" || task.status === "cancelled",
                      }}
                    >
                      {task.content}
                    </span>
                  </Checkbox>
                  <span class="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2 text-text-weak">
                    <span>{language.t(`session.tasks.status.${task.status}`)}</span>
                    <Show when={props.onOpenTask}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="small"
                        aria-label={language.t("session.tasks.openDetails", { name: task.content })}
                        onClick={() => props.onOpenTask?.(task.id)}
                      >
                        {language.t("session.tasks.details")}
                      </Button>
                    </Show>
                    <Show when={props.onOpenSource}>
                      <For each={sources().get(task.id) ?? []}>
                        {(source, index) => (
                          <Button
                            type="button"
                            variant="ghost"
                            size="small"
                            title={source.toolCallID}
                            aria-label={language.t("session.todo.openSource", {
                              name: task.content,
                              id: source.toolCallID,
                            })}
                            onClick={() => props.onOpenSource?.(source)}
                          >
                            {(sources().get(task.id)?.length ?? 0) > 1
                              ? language.t("session.todo.sourceNumber", { number: index() + 1 })
                              : language.t("session.todo.source")}
                          </Button>
                        )}
                      </For>
                    </Show>
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </DockTray>
    </Show>
  )
}
