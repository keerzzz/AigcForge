import { Index, Show, createEffect, createMemo } from "solid-js"
import { useServerSync } from "@/context/server-sync"
import { useSync } from "@/context/sync"
import {
  computeTodoProgress,
  type TodoProgressInput,
} from "@/pages/session/timeline/session-todo-progress-model"

/**
 * M2 pulse-line progress embedded in the timeline session-progress container
 * (plan §5.3 Layer 4 方案 B). Renders nothing when there are no todos, so the
 * existing `session-progress-whip` animation stays byte-for-byte untouched.
 * Data source is `serverSync().data.session_todo` (SSE `todo.updated`
 * projection for both V1 and V2 runtimes); the container pulls once on mount
 * for reload recovery. Node interaction (hover tooltip / checkbox panel) is
 * wired by the parent via `data-state` + `title`, and the interactive overlay
 * in M2c.
 */
export function SessionTodoProgress(props: { sessionID: () => string | undefined }) {
  const sync = useSync()
  const serverSync = useServerSync()

  const todos = createMemo<TodoProgressInput[]>(() => {
    const id = props.sessionID()
    if (!id) return []
    return (serverSync().data.session_todo[id] ?? []) as TodoProgressInput[]
  })

  const progress = createMemo(() => computeTodoProgress(todos()))
  const hasAnchor = createMemo(() => progress().nodes.some((node) => node.anchor))

  // Reload recovery: pull once when the session mounts (directory-sync has
  // built-in retry; subsequent updates arrive via SSE todo.updated).
  createEffect(() => {
    const id = props.sessionID()
    if (id) sync().session.todo(id)
  })

  return (
    <Show when={progress().total > 0}>
      <div
        data-component="session-todo-progress"
        role="progressbar"
        aria-label={`${progress().done} of ${progress().total}`}
        aria-valuemin={0}
        aria-valuemax={progress().total}
        aria-valuenow={progress().done}
      >
        <div
          data-component="session-todo-progress-fill"
          data-anchor={hasAnchor() ? "true" : undefined}
          style={{
            "clip-path": `inset(0 ${100 - progress().doneRatio * 100}% 0 0 round 999px)`,
          }}
        />
        <Index each={progress().nodes}>
          {(node) => (
            <button
              type="button"
              data-component="session-todo-progress-node"
              data-state={node().status}
              data-anchor={node().anchor ? "true" : undefined}
              data-key={node().id}
              tabIndex={-1}
              title={node().content || undefined}
              aria-label={node().content || undefined}
              style={{ left: `${node().pct}%` }}
            />
          )}
        </Index>
        <span data-component="session-todo-progress-stats" aria-hidden="true">
          {progress().done}/{progress().total}
        </span>
      </div>
    </Show>
  )
}
