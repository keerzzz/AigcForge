import { Index, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js"
import { CheckboxV2 } from "@aigcfroge/ui/v2/checkbox-v2"
import { useServerSync } from "@/context/server-sync"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"
import { useMode } from "@/context/mode"
import { showToast } from "@/utils/toast"
import { Identifier } from "@/utils/id"
import {
  computeProgressLedger,
  computeTodoProgress,
  flipTaskWriteStatus,
  pickProgressTodos,
  preserveStatus,
  sameTodoList,
  type TodoProgressInput,
} from "@/pages/session/timeline/session-todo-progress-model"

/**
 * M7 unified track (plan §5.8 决策 1-6). Renders ONLY the interactive task
 * strip — the environment pulse (no-todo state) stays in message-timeline's
 * `session-progress` container, so the two states are mutually exclusive and
 * the old `:has()` whip-freeze hack (the M7-④ white-block root cause) is gone.
 *
 * The strip is a 34px band under the title row: a 「任务列表」 label + `done/total`
 * stats row on top, and a 2px track filled to `fillEndPct` with 10px nodes
 * centered on the line below. `working` decides indeterminate activity between
 * the completed frontier and anchor vs idle static retention.
 */
export function SessionTodoProgress(props: {
  sessionID: () => string | undefined
  /** workingStatus() !== "hidden" — task pulse on, or idle static retention. */
  working: () => boolean
  /** Agent tint for the environment pulse (kept; message-timeline uses it). */
  tint: () => string | undefined
}) {
  const sync = useSync()
  const serverSync = useServerSync()
  const sdk = useSDK()
  const language = useLanguage()
  const mode = useMode()
  const [open, setOpen] = createSignal(false)
  let trackRef: HTMLDivElement | undefined

  const tasks = createMemo<readonly TodoProgressInput[]>(() => {
    const id = props.sessionID()
    if (!id) return []
    const data = serverSync().data
    // M7 ⑦: pick the fresher source (plan §5.8 decision 7). task (id-bearing)
    // wins when both agree so the fold-over stays writable; a standalone V1
    // todo.updated outranks the seeded task pull instead of being frozen out.
    return pickProgressTodos(
      data.session_task[id]?.map((task) => ({
        id: task.id,
        content: task.content,
        status: task.status,
        priority: task.priority,
        // The SDK types revision as number | "NaN" | "Infinity" | ... (JSON
        // edge cases); narrow to a real number so expectedRevision is clean.
        revision: typeof task.revision === "number" ? task.revision : undefined,
        // M1.5: Work step digest rides the ledger projection (D5 passthrough).
        outputDigest: task.outputDigest,
      })),
      data.session_task_updated_at[id],
      (data.session_todo[id] ?? []) as TodoProgressInput[],
      data.session_todo_updated_at[id],
    )
  })

  const progress = createMemo(() => {
    // P2: apply a determinate progress when the session's active task has a
    // current progress snapshot. Match the snapshot's taskID against the first
    // in_progress task (the anchor) so a stale snapshot for a different task
    // can't move the pulse.
    const id = props.sessionID()
    const snapshot = id ? serverSync().data.session_task_progress[id] : undefined
    const anchorTask = snapshot ? tasks().find((task) => task.status === "in_progress") : undefined
    const anchorProgress =
      snapshot && anchorTask && snapshot.taskID === anchorTask.id ? snapshot.progress : undefined
    return computeTodoProgress(tasks(), anchorProgress)
  })
  const allDone = createMemo(() => progress().total > 0 && progress().done === progress().total)

  // M1.5 D5: the Work ProgressLedger is a pure projection of the same task
  // list — currentStepIndex + canResume drive the mode-aware resume button.
  const ledger = createMemo(() => computeProgressLedger(tasks()))

  // M1.5 D4: dialogue-level resume — clicking the button sends a preset prompt
  // through the same SDK channel the composer uses (promptAsync); no new send
  // path. The orchestrator reads the task list and resumes from the digest.
  const onResume = () => {
    const id = props.sessionID()
    if (!id) return
    void sdk()
      .client.session.promptAsync({
        sessionID: id,
        directory: sdk().directory,
        messageID: Identifier.ascending("message"),
        parts: [{ type: "text", text: language.t("work.resume.prompt") }],
      })
      .catch((err: unknown) => {
        const description = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("session.todo.writeback.failed.title"), description })
      })
  }

  // Reload recovery: pull once when the session mounts (directory-sync has
  // built-in retry; subsequent updates arrive via SSE task.updated/todo.updated).
  // NIT (Step 1 approval): if the live todo source already holds data that
  // diverges from the persisted TaskTable pull, discard the seed so a stale
  // V1 task pull can never shadow the fresher todo channel.
  createEffect(() => {
    const id = props.sessionID()
    if (!id) return
    void sync().session.todo(id)
    if (serverSync().data.session_task[id] !== undefined) return
    void sdk()
      .client.session.task.get({ sessionID: id, directory: sdk().directory })
      .then((response) => {
        if (serverSync().data.session_task[id] !== undefined) return
        const tasks = response.data ?? []
        // Only discard a diverging seed when the live todo source actually has
        // data — an empty todo pull is not a divergence signal.
        const liveTodo = serverSync().data.session_todo[id]
        if (
          liveTodo &&
          liveTodo.length > 0 &&
          !sameTodoList(tasks as TodoProgressInput[], liveTodo as TodoProgressInput[])
        ) {
          return
        }
        serverSync().task.set(id, tasks)
      })
      .catch((err: unknown) => {
        // Degrades to the read-only todo projection; the next task.updated or
        // writeback round-trip reseeds the store.
        const description = err instanceof Error ? err.message : String(err)
        console.warn("SessionTodoProgress task recovery pull failed", description)
      })
  })

  // Fold-over dismiss layer (M7 decision 6): click outside the strip + panel closes.
  createEffect(() => {
    if (!open()) return
    const handler = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null
      if (target && trackRef?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener("pointerdown", handler)
    onCleanup(() => document.removeEventListener("pointerdown", handler))
  })

  // Fold-over writeback: flip ONE task's status via the single-task patch
  // endpoint (differential-review HIGH-2). A full-list reconcile from the
  // cached list would delete a task appended server-side but not yet delivered
  // by SSE; a single-task patch touches only the flipped row, so unrelated
  // tasks — including their six-state status (HIGH-1) — are never rewritten.
  const writeback = (target: TodoProgressInput) => {
    const id = props.sessionID()
    if (!id) return
    // Never PATCH id-less entries (V1 three-field projection): the reconcile
    // would mint fresh ids and delete the stored rows, wiping outputDigest.
    // The fold-over renders such entries read-only instead (see disabled below).
    if (target.id === undefined) return
    if (tasks().some((task) => task.id === undefined)) return
    void sdk()
      .client.session.task.patch({
        sessionID: id,
        taskID: target.id,
        directory: sdk().directory,
        status: flipTaskWriteStatus(preserveStatus(target.status)),
        // P3-e: expectedRevision guards against a stale fold-over overwriting a
        // concurrent task write. Undefined (legacy id-less todo source) skips the
        // guard, but writeback already aborts for id-less entries above.
        expectedRevision: target.revision,
      })
      .catch((err: unknown) => {
        const description = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("session.todo.writeback.failed.title"), description })
      })
  }

  const toggleOpen = () => setOpen((value) => !value)

  // Task pulse is indeterminate activity between the completed frontier and
  // anchor. It deliberately does not estimate LLM completion. P2: when a
  // determinate progressPct is available, the pulse rests at that position
  // instead of sweeping (data-determinate + --pulse-progress-pct).
  const pulseStyle = createMemo<JSX.CSSProperties | undefined>(() => {
    const pulse = progress().pulse
    if (!pulse) return undefined
    return {
      "--pulse-from-pct": `${pulse.fromPct}%`,
      "--pulse-to-pct": `${pulse.toPct}%`,
      ...(pulse.progressPct !== undefined ? { "--pulse-progress-pct": `${pulse.progressPct}%` } : {}),
    }
  })

  // No task strip to render (the container's env pulse owns this state). The
  // <Show> keeps the conditional reactive — a top-level early `return null`
  // would evaluate once at mount and never re-render when the store populates.
  return (
    <Show when={tasks().length > 0}>
      <div
        ref={trackRef}
        data-component="session-todo-progress"
        role="progressbar"
        aria-label={language.t("session.todo.progress", { done: progress().done, total: progress().total })}
        aria-valuemin={0}
        aria-valuemax={progress().total}
        aria-valuenow={progress().done}
      >
        <span data-component="session-todo-progress-label">{language.t("session.todo.list")}</span>
        <div data-component="session-progress-track-area">
          <div data-component="session-todo-progress-track" />
          <div data-component="session-todo-progress-fill" style={{ width: `${progress().fillEndPct}%` }} />
          <Show when={props.working() && progress().pulse}>
            <div
              data-component="session-todo-progress-pulse"
              data-determinate={progress().pulse?.progressPct !== undefined ? "true" : undefined}
              style={pulseStyle()}
            />
          </Show>
          <Index each={progress().nodes}>
            {(node) => (
              // Plan §5.5 deviation (see specs/v2/todo.md): hover uses the
              // native `title`, not TooltipV2 — the plan keeps `title` for
              // keyboard/screen readers (and the e2e regression asserts the
              // attribute), but native title also fires on hover, so a Kobalte
              // tooltip would double-render. TooltipV2.Trigger also hardcodes
              // `as="div"`, which cannot wrap the absolutely-positioned 10px
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
              >
                <Show when={node().status === "completed"}>
                  <svg data-component="session-todo-progress-check" viewBox="0 0 10 10" aria-hidden="true" fill="none">
                    <path d="M2.5 5.2 4.4 7l3.1-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                  </svg>
                </Show>
              </button>
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
        </div>
        <button
          type="button"
          data-component="session-todo-progress-stats"
          data-complete={allDone() ? "true" : undefined}
          aria-expanded={open()}
          onClick={toggleOpen}
        >
          {progress().done}/{progress().total}
        </button>
        {/* M1.5 D2/D4: resume entry point — work mode only, so Coding/Chat
            sessions never surface it (mode-aware guard). */}
        <Show when={ledger().canResume && mode.currentMode === "work"}>
          <button
            type="button"
            data-component="session-todo-progress-resume"
            class="mt-2 w-fit rounded-md border border-border-strong-base bg-v2-background-bg-layer-01 px-3 py-1.5 text-12-regular text-text-base transition-colors hover:bg-v2-background-bg-layer-02"
            onClick={onResume}
          >
            {language.t("work.resume.button")}
          </button>
        </Show>
        <Show when={open()}>
          <div data-component="session-todo-progress-panel" role="list">
            <Index each={tasks()}>
              {(task) => (
                <div class="flex flex-col gap-0.5">
                  <CheckboxV2
                    data-slot="session-todo-progress-checkbox"
                    checked={task().status === "completed"}
                    indeterminate={task().status === "in_progress"}
                    disabled={
                      // scheduled/cancelled/failed have their own management UI
                      // (the header scheduled-tasks popover / Agent Hub), so the
                      // fold-over never rewrites them (HIGH-1 six-state guard).
                      task().status === "cancelled" ||
                      task().status === "scheduled" ||
                      task().status === "failed" ||
                      task().id === undefined
                    }
                    onChange={() => writeback(task())}
                    label={
                      <span data-slot="session-todo-progress-checkbox-label" data-status={task().status}>
                        {task().content}
                      </span>
                    }
                  />
                  <Show when={task().outputDigest}>
                    <span
                      data-slot="step-digest"
                      class="pl-6 text-12-regular text-text-weak"
                      aria-label={`${language.t("work.step.digest")}: ${task().outputDigest}`}
                    >
                      {task().outputDigest}
                    </span>
                  </Show>
                </div>
              )}
            </Index>
          </div>
        </Show>
      </div>
    </Show>
  )
}
