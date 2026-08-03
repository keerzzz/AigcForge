import { Index, Show, createEffect, createMemo, createSignal } from "solid-js"
import { CheckboxV2 } from "@aigcfroge/ui/v2/checkbox-v2"
import { useServerSync } from "@/context/server-sync"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"
import { showToast } from "@/utils/toast"
import {
  computeTodoProgress,
  flipTaskStatus,
  normalizePriority,
  normalizeStatus,
  type TodoProgressInput,
} from "@/pages/session/timeline/session-todo-progress-model"

/**
 * M2 pulse-line progress embedded in the timeline session-progress container
 * (plan §5.3 Layer 4 方案 B). Renders nothing when there are no todos, so the
 * existing `session-progress-whip` animation stays byte-for-byte untouched.
 *
 * Data source prefers id-bearing tasks from `task.updated` (stable ids so the
 * fold-over can PATCH by id and keep `outputDigest` through reconcile), falling
 * back to the three-field `todo.updated` projection for the V1 runtime. On
 * mount the container seeds the id-bearing store from `GET /session/:id/task`
 * and pulls the legacy projection via directory-sync for reload recovery.
 *
 * Interactivity (M2c): hovering a node shows its content via `title`; clicking
 * a node or the done/total stat expands a checkbox fold-over. Toggling a box
 * PATCHes the whole list back over `PATCH /session/:id/task` (reconcile), which
 * republishes `task.updated` and reconciles the local store. Entries without a
 * stable id (V1 projection) are read-only: reconciling them would mint fresh
 * ids and wipe the persisted `outputDigest`.
 */
export function SessionTodoProgress(props: { sessionID: () => string | undefined }) {
  const sync = useSync()
  const serverSync = useServerSync()
  const sdk = useSDK()
  const language = useLanguage()
  const [open, setOpen] = createSignal(false)

  const tasks = createMemo<TodoProgressInput[]>(() => {
    const id = props.sessionID()
    if (!id) return []
    const byId = serverSync().data.session_task[id]
    if (byId && byId.length > 0) {
      return byId.map((task) => ({ id: task.id, content: task.content, status: task.status, priority: task.priority }))
    }
    return (serverSync().data.session_todo[id] ?? []) as TodoProgressInput[]
  })

  const progress = createMemo(() => computeTodoProgress(tasks()))
  const hasAnchor = createMemo(() => progress().nodes.some((node) => node.anchor))

  // Reload recovery: pull once when the session mounts (directory-sync has
  // built-in retry; subsequent updates arrive via SSE task.updated/todo.updated).
  // The id-bearing task list comes from GET /session/:id/task (M2a); the legacy
  // three-field projection stays as the V1-runtime read-only fallback.
  createEffect(() => {
    const id = props.sessionID()
    if (!id) return
    void sync().session.todo(id)
    // Only seed when the SSE channel has not already delivered fresher
    // task.updated data, and re-check at resolve time so a late response
    // never clobbers a newer event.
    if (serverSync().data.session_task[id] !== undefined) return
    void sdk()
      .client.session.task.get({ sessionID: id, directory: sdk().directory })
      .then((response) => {
        if (serverSync().data.session_task[id] !== undefined) return
        serverSync().task.set(id, response.data ?? [])
      })
      .catch((err: unknown) => {
        // Degrades to the read-only todo projection; the next task.updated or
        // writeback round-trip reseeds the store.
        const description = err instanceof Error ? err.message : String(err)
        console.warn("SessionTodoProgress task recovery pull failed", description)
      })
  })

  // Fold-over writeback: flip one task's status and PATCH the whole list back.
  const writeback = (target: TodoProgressInput) => {
    const id = props.sessionID()
    if (!id) return
    // Never PATCH id-less entries (V1 three-field projection): the reconcile
    // would mint fresh ids and delete the stored rows, wiping outputDigest.
    // The fold-over renders such entries read-only instead (see disabled below).
    if (tasks().some((task) => task.id === undefined)) return
    const next = tasks().map((task) =>
      task.id === target.id ? { ...task, status: flipTaskStatus(normalizeStatus(task.status)) } : task,
    )
    void sdk()
      .client.session.task.update({
        sessionID: id,
        directory: sdk().directory,
        body: next.map((task) => ({
          id: task.id,
          content: task.content,
          status: normalizeStatus(task.status),
          priority: normalizePriority(task.priority),
        })),
      })
      .catch((err: unknown) => {
        const description = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("session.todo.writeback.failed.title"), description })
      })
  }

  const toggleOpen = () => setOpen((value) => !value)

  return (
    <Show when={progress().total > 0}>
      <div
        data-component="session-todo-progress"
        role="progressbar"
        aria-label={language.t("session.todo.progress", { done: progress().done, total: progress().total })}
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
            // Plan §5.5 deviation (see specs/v2/todo.md): hover uses the
            // native `title`, not TooltipV2 — the plan keeps `title` for
            // keyboard/screen readers (and the e2e regression asserts the
            // attribute), but native title also fires on hover, so a Kobalte
            // tooltip would double-render. TooltipV2.Trigger also hardcodes
            // `as="div"`, which cannot wrap the absolutely-positioned 8px
            // node without restructuring its geometry.
            <button
              type="button"
              data-component="session-todo-progress-node"
              data-state={node().status}
              data-anchor={node().anchor ? "true" : undefined}
              data-key={node().id}
              aria-label={node().content || undefined}
              title={node().content || undefined}
              tabIndex={0}
              onClick={toggleOpen}
              style={{ left: `${node().pct}%` }}
            />
          )}
        </Index>
        <Index each={progress().ellipsis}>
          {(pct) => (
            <span
              data-component="session-todo-progress-ellipsis"
              aria-hidden="true"
              title={language.t("session.todo.progress", { done: progress().done, total: progress().total })}
              style={{ left: `${pct()}%` }}
            >
              …
            </span>
          )}
        </Index>
        <button type="button" data-component="session-todo-progress-stats" aria-expanded={open()} onClick={toggleOpen}>
          {progress().done}/{progress().total}
        </button>
      </div>
      <Show when={open()}>
        <div data-component="session-todo-progress-panel" role="list">
          <Index each={tasks()}>
            {(task) => (
              <CheckboxV2
                data-slot="session-todo-progress-checkbox"
                checked={task().status === "completed"}
                indeterminate={task().status === "in_progress"}
                disabled={task().status === "cancelled" || task().id === undefined}
                onChange={() => writeback(task())}
                label={
                  <span data-slot="session-todo-progress-checkbox-label" data-status={task().status}>
                    {task().content}
                  </span>
                }
              />
            )}
          </Index>
        </div>
      </Show>
    </Show>
  )
}
