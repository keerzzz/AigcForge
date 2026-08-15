export * as TaskTool from "./task"

import { ToolFailure } from "@aigcfroge/llm"
import { Cause, Effect, Exit, Layer, Option, Ref, Schema, Stream } from "effect"
import { AgentV2 } from "../agent"
import { Config } from "../config"
import { EventV2 } from "../event"
import { PermissionV2 } from "../permission"
import { ProductModeAgentPolicy } from "../product-mode-agent-policy"
import { SessionSchema } from "../session/schema"
import { SessionTask } from "../session/task"
import { Tool } from "./tool"
import { TaskDriver } from "./task-driver"
import { Tools } from "./tools"

/**
 * P2-b: compute a 0..1 completion ratio for a child session's task list. The
 * `task` delegation tool subscribes to the child's `task.updated` events and
 * reports this ratio as `recordProgress` for the parent's anchor task, so the
 * parent's pulse advances determinately as the child completes sub-tasks.
 * Only `completed` counts; `cancelled`/`failed`/`scheduled`/`pending` do not.
 */
export const childCompletionRatio = (
  tasks: ReadonlyArray<{ status: string }>,
): { progress: number; current: number; total: number } | undefined => {
  const total = tasks.length
  if (total === 0) return undefined
  const completed = tasks.filter((task) => task.status === "completed").length
  return { progress: completed / total, current: completed, total }
}

export const name = "task"

// Background delegation is gated behind an experimental env flag, mirroring V1's
// AIGCFROGE_EXPERIMENTAL_BACKGROUND_SUBAGENTS. When off, the `background` field is
// not advertised and any value is ignored.
const backgroundEnabled = () =>
  process.env.AIGCFROGE_EXPERIMENTAL_BACKGROUND_SUBAGENTS === "1" ||
  process.env.AIGCFROGE_EXPERIMENTAL_BACKGROUND_SUBAGENTS === "true"

export const Input = Schema.Struct({
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "Set only to resume a previous task: pass a prior task_id to continue that same subagent session instead of creating a fresh one.",
  }),
  parent_task_id: Schema.optional(Schema.String).annotate({
    description:
      "Link this delegation to an existing task created with taskwrite (track A). When omitted, an in_progress task is created automatically (track B) and written back when the subagent settles.",
  }),
  background: Schema.optional(Schema.Boolean).annotate({
    description:
      "Run the subagent in the background and return immediately. You will be notified when it completes; its result is injected back into this conversation. DO NOT poll or proactively check its progress.",
  }),
  attended: Schema.optional(Schema.Boolean).annotate({
    description:
      "true=attended (subagent asks shown to user for approval), false=unattended (asks auto-denied). Defaults to the subagent's config.",
  }),
  execution_type: Schema.optional(Schema.Literals(["subagent", "external-cli", "judge"])).annotate({
    description:
      "Execution mode: subagent (default) for internal agents, external-cli for CLI tools like claude-code, gemini, opencode, judge for multi-model arbitration (runs the same prompt across N models and merges the best result).",
  }),
  cli_target: Schema.optional(Schema.String).annotate({
    description: "CLI name when execution_type is 'external-cli'",
  }),
  judge_models: Schema.optional(Schema.Array(Schema.String)).annotate({
    description:
      "Model IDs when execution_type is 'judge'. Each entry is a model ID (e.g. openai/gpt-5, anthropic/claude-sonnet-4). A judge model merges the results. Defaults to the session's model and one alternative. Max 5.",
  }),
})

export const Output = Schema.Struct({
  sessionID: Schema.String,
  output: Schema.String,
  // External-CLI dispatches carry structured metadata so session-ui / TUI task
  // cards can render a CLI badge, status, and a link into the child Session.
  metadata: Schema.optional(
    Schema.Struct({
      sessionId: Schema.String,
      parentSessionId: Schema.String,
      cli: Schema.String,
      execution_type: Schema.Literal("external-cli"),
      status: Schema.String,
    }),
  ),
})
export type Output = typeof Output.Type

const FOREGROUND_DESCRIPTION = [
  "Launch a new subagent to handle a complex, multi-step task autonomously.",
  "",
  "You must specify a subagent_type to select which agent handles the task. The subagent runs in the same workspace as this Session, receives your prompt as its only instruction, and returns a single final message once it settles.",
  "",
  "When NOT to use this tool:",
  "- To read a specific file, use the read tool directly.",
  "- To search for a symbol or pattern, use grep/glob directly.",
  "",
  "Usage notes:",
  "- The subagent starts with a fresh context, so the prompt must contain a highly detailed, self-contained task description and state exactly what the subagent should return.",
  "- The subagent's final message is returned to you as the tool result; it is not shown to the user. Relay what matters in your own words.",
  "- Tell the subagent whether to write code or only research, and how to verify its work.",
].join("\n")

const BACKGROUND_DESCRIPTION = [
  "Set background=true to launch the subagent asynchronously and return immediately.",
  "Use background only for independent work that can run while you continue elsewhere.",
  "You will be notified automatically when it finishes; its result is injected back into this conversation.",
  "DO NOT sleep, poll for progress, or duplicate the background task's work.",
].join(" ")

const BACKGROUND_STARTED = [
  "The subagent is working in the background. You will be notified automatically when it finishes and its result is injected here.",
  "DO NOT sleep, poll for progress, ask the task for status, or duplicate its work.",
  "Work on non-overlapping tasks, or briefly tell the user what you launched and end your response.",
].join("\n")

const BACKGROUND_UPDATED = [
  "Additional context sent to the running background task.",
  "The task is still working in the background. You will be notified automatically when it finishes.",
  "DO NOT sleep, poll for progress, ask the task for status, or duplicate its work.",
  "Work on non-overlapping tasks, or briefly tell the user what you sent and end your response.",
].join("\n")

export const description = backgroundEnabled()
  ? [FOREGROUND_DESCRIPTION, "", BACKGROUND_DESCRIPTION].join("\n")
  : FOREGROUND_DESCRIPTION

const renderOutput = (input: {
  sessionID: string
  state: "completed" | "error" | "running"
  summary?: string
  text: string
}) => {
  const tag = input.state === "error" ? "task_error" : "task_result"
  return [
    `<task id="${input.sessionID}" state="${input.state}">`,
    ...(input.summary ? [`<summary>${input.summary}</summary>`] : []),
    `<${tag}>`,
    input.text,
    `</${tag}>`,
    "</task>",
  ].join("\n")
}

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const agents = yield* AgentV2.Service
    const permission = yield* PermissionV2.Service
    const config = yield* Config.Service
    const tasks = yield* SessionTask.Service
    const events = yield* EventV2.Service
    const configEntries = yield* config.entries()
    const configAttendedDefault = Config.latest(configEntries, "subagent_attended_default")

    yield* tools
      .register({
        [name]: Tool.make({
          description,
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [{ type: "text", text: output.output }],
          execute: (input, context) =>
            Effect.gen(function* () {
              // Prevent recursive delegation: a child Session cannot spawn its own
              // subagents through the task tool.
              if (yield* TaskDriver.isChildSession(context.sessionID)) {
                return yield* new ToolFailure({
                  message: "Task tool cannot be used in child sessions (prevents recursive delegation)",
                })
              }

              const subagent = yield* agents.resolve(input.subagent_type)
              if (!subagent)
                return yield* new ToolFailure({
                  message: `Unknown agent type: ${input.subagent_type} is not a valid agent type`,
                })

              // Non-CLI delegations assert on the subagent type. External-CLI mode
              // branches to its own assert (below) that carries the CLI target.
              const cliTarget = input.cli_target
              if (input.execution_type !== "external-cli") {
                // The child Session inherits this Session's mode, and mode policy
                // gates which agents may be primary there. Check it here so a
                // disallowed delegation returns a readable tool failure instead of
                // dying inside child-session creation (ADR-13 Amendment-2 §1b.3).
                const mode = yield* TaskDriver.sessionMode(context.sessionID)
                const verdict = ProductModeAgentPolicy.checkPrimaryAgent(mode ?? "coding", input.subagent_type)
                if (!verdict.allowed) {
                  return yield* new ToolFailure({ message: verdict.error.message })
                }
                yield* permission
                  .assert({
                    action: name,
                    resources: [input.subagent_type],
                    save: ["*"],
                    sessionID: context.sessionID,
                    agent: context.agent,
                    source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
                  })
                  .pipe(Effect.mapError((error) => new ToolFailure({ message: `Task permission denied`, error })))
              }

              // CLI execution mode: delegate to an external CLI tool instead of
              // creating a child Session. The CLI adapter is resolved through the
              // TaskDriver seam (registered at the composition root).
              if (input.execution_type === "external-cli") {
                if (!cliTarget) {
                  return yield* new ToolFailure({
                    message: "cli_target is required when execution_type is 'external-cli'",
                  })
                }
                yield* permission
                  .assert({
                    action: name,
                    resources: [cliTarget],
                    save: ["*"],
                    sessionID: context.sessionID,
                    agent: context.agent,
                    source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
                    metadata: { description: input.description, execution_type: "external-cli" },
                  })
                  .pipe(Effect.mapError((error) => new ToolFailure({ message: `Task permission denied`, error })))
                // Track B: a fresh CLI delegation auto-creates an in_progress task so
                // the todo dashboard mirrors the delegation; it is settled with the CLI
                // outcome once the dispatch returns.
                let cliTaskID: string | undefined = input.parent_task_id
                if (cliTaskID === undefined) {
                  const created = yield* tasks
                    .append({
                      sessionID: context.sessionID,
                      tasks: [{ content: input.description, status: "in_progress", priority: "medium" }],
                    })
                    .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message })))
                  cliTaskID = created.at(-1)?.id
                }
                // Settle the linked task from the dispatch exit (same
                // classification as the track-B writeback in
                // TaskDriver.delegate): success → completed/failed per the CLI
                // status, interrupt-only → cancelled, anything else → failed.
                // onExit finalizers run uninterruptibly on interruption too
                // (Effect.exit's continuation does NOT resume once the fiber
                // is interrupted), so a CliUnavailableError or a parent-fiber
                // abort still settles the claim instead of leaking an
                // in_progress row.
                const result = yield* TaskDriver.executeCLI({
                  cliTarget,
                  prompt: input.prompt,
                  description: input.description,
                  sessionID: context.sessionID,
                  taskID: input.task_id ? SessionSchema.ID.make(input.task_id) : undefined,
                }).pipe(
                  Effect.mapError((error) => new ToolFailure({ message: error.message })),
                  Effect.onExit((exit) => {
                    if (cliTaskID === undefined) return Effect.void
                    return tasks
                      .patch({
                        sessionID: context.sessionID,
                        id: cliTaskID,
                        status: Exit.isSuccess(exit)
                          ? exit.value.status === "failed"
                            ? "failed"
                            : "completed"
                          : Cause.hasInterruptsOnly(exit.cause)
                            ? "cancelled"
                            : "failed",
                        outputDigest:
                          Exit.isSuccess(exit) && exit.value.status !== "failed" ? exit.value.sessionID : undefined,
                      })
                      .pipe(Effect.orDie, Effect.asVoid)
                  }),
                )
                return {
                  sessionID: result.sessionID,
                  output: renderOutput({
                    sessionID: result.sessionID,
                    state: result.status === "failed" ? "error" : "completed",
                    text: result.text,
                  }),
                  metadata: {
                    sessionId: result.sessionID,
                    parentSessionId: context.sessionID,
                    cli: cliTarget,
                    execution_type: "external-cli",
                    status: result.status,
                  } as const,
                }
              }

              // Judge mode: parallel dispatch across multiple models, results
              // merged by Judge LLM. Short-circuits before createChild.
              if (input.execution_type === "judge") {
                const models = input.judge_models
                if (!models || models.length === 0) {
                  return yield* new ToolFailure({
                    message: "judge_models is required when execution_type is 'judge'",
                  })
                }
                // Track A linkage: claim the parent task for the run (only a
                // pending row flips — an already-claimed or terminal task is
                // left alone), then settle it from the dispatch exit with the
                // same classification as the CLI path above.
                const judgeTaskID = input.parent_task_id
                if (judgeTaskID !== undefined) {
                  yield* tasks
                    .patch({
                      sessionID: context.sessionID,
                      id: judgeTaskID,
                      status: "in_progress",
                      expect: ["pending"],
                    })
                    .pipe(Effect.orDie, Effect.asVoid)
                }
                const text = yield* TaskDriver.delegateJudge({
                  parentID: context.sessionID,
                  models,
                  prompt: input.prompt,
                  description: input.description,
                }).pipe(
                  Effect.catchTag("TaskDriver.DelegateError", (error) => new ToolFailure({ message: error.message })),
                  Effect.onExit((exit) => {
                    if (judgeTaskID === undefined) return Effect.void
                    return tasks
                      .patch({
                        sessionID: context.sessionID,
                        id: judgeTaskID,
                        status: Exit.isSuccess(exit)
                          ? "completed"
                          : Cause.hasInterruptsOnly(exit.cause)
                            ? "cancelled"
                            : "failed",
                      })
                      .pipe(Effect.orDie, Effect.asVoid)
                  }),
                )
                return {
                  sessionID: context.sessionID,
                  output: renderOutput({ sessionID: context.sessionID, state: "completed", text }),
                }
              }

              // Resume a prior subagent Session when a well-formed task_id is
              // supplied; a malformed id is ignored and a fresh child is created.
              // The id is only a branded string here — createChild is idempotent,
              // so a never-seen id mints a fresh child under it and an existing one
              // is returned as-is (then rejected below if it belongs elsewhere).
              const resumeID = input.task_id
                ? Option.getOrUndefined(Schema.decodeUnknownOption(SessionSchema.ID)(input.task_id))
                : undefined

              // ── Dual-track todo linkage ──
              // Track A: an explicit parent_task_id links to an existing task
              // minted by taskwrite. Track B: a fresh delegation auto-creates an
              // in_progress task (content = description) so the todo dashboard
              // mirrors the delegation tree. A resumed delegation (task_id) has no
              // persisted child-session linkage yet (M2 adds it via outputDigest
              // persistence), so no new task is created for it; the prior track-B
              // task was already settled by its own delegation's onSettle (or stays
              // in_progress if that delegation was interrupted — M2 closes this gap).
              let taskID: string | undefined = input.parent_task_id
              if (taskID === undefined && resumeID === undefined) {
                // Track B: append atomically in one transaction so concurrent
                // task calls in the same provider turn never drop each other's rows.
                // The write is a plain in_progress task (no recurrence), so the
                // dead-job guard can't fire; map the typed error to ToolFailure
                // to keep the tool's error surface uniform.
                const created = yield* tasks
                  .append({
                    sessionID: context.sessionID,
                    tasks: [{ content: input.description, status: "in_progress", priority: "medium" }],
                  })
                  .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message })))
                taskID = created.at(-1)?.id
              }
              let onSettle: ((outcome: TaskDriver.SettleOutcome) => Effect.Effect<void>) | undefined
              if (taskID !== undefined) {
                const linkedTaskID = taskID
                onSettle = (outcome) =>
                  tasks
                    .patch({
                      sessionID: context.sessionID,
                      id: linkedTaskID,
                      status: outcome.status,
                      outputDigest: outcome.outputDigest,
                    })
                    // The settle writes a terminal status (never `scheduled`),
                    // so the schedule invariant can't trip; a failure here is a
                    // defect, not a client error.
                    .pipe(Effect.orDie, Effect.asVoid)
              }

              // Tracks the current attempt's child so an abort can stop it and a
              // retry can cancel the orphan a failed prior attempt left behind.
              const activeChild = yield* Ref.make(Option.none<SessionSchema.ID>())

              const delegateOnce = Effect.gen(function* () {
                // Before a retry, cancel the orphan child a prior fresh attempt
                // created and abandoned. A resumed task_id keeps the same id across
                // attempts, so there is no orphan to clean up.
                if (resumeID === undefined) {
                  const previous = yield* Ref.getAndSet(activeChild, Option.none())
                  if (Option.isSome(previous)) yield* TaskDriver.cancel(previous.value)
                }

                const child = yield* TaskDriver.createChild({
                  parentID: context.sessionID,
                  agent: subagent.id,
                  id: resumeID,
                  attended: input.attended ?? subagent.attended ?? configAttendedDefault ?? false,
                })
                // A resumed id must belong to this session; refuse to drive
                // another Session on the model's behalf.
                if (child.parentID !== context.sessionID)
                  return yield* new ToolFailure({
                    message: `task_id ${input.task_id} does not belong to this session`,
                  })
                yield* Ref.set(activeChild, Option.some(child.id))

                // Background delegation: schedule the child, inject its result into
                // the parent when it settles, and return immediately. Gated by the
                // experimental flag; ignored otherwise. Background failures are
                // handled by the injection path, not retried here.
                if (input.background === true && backgroundEnabled()) {
                  // Resume against an in-flight background task: append the prompt
                  // to the running job's queue rather than starting a new one.
                  if (resumeID !== undefined) {
                    const extended = yield* TaskDriver.extendBackground({
                      parentID: context.sessionID,
                      sessionID: child.id,
                      prompt: input.prompt,
                      description: input.description,
                    })
                    if (extended) {
                      return {
                        sessionID: child.id,
                        output: renderOutput({
                          sessionID: child.id,
                          state: "running",
                          summary: "Background task updated",
                          text: BACKGROUND_UPDATED,
                        }),
                      }
                    }
                  }
                  // No resume, or the prior background job already settled — start
                  // a fresh background delegation.
                  yield* TaskDriver.delegateBackground({
                    parentID: context.sessionID,
                    sessionID: child.id,
                    prompt: input.prompt,
                    description: input.description,
                    taskID,
                    onSettle,
                  })
                  return {
                    sessionID: child.id,
                    output: renderOutput({ sessionID: child.id, state: "running", text: BACKGROUND_STARTED }),
                  }
                }

                // P2-b: observe the child session's task list and bubble up its
                // completion ratio as progress for the parent's anchor task. The
                // observer is forked into a scope that closes when delegate returns,
                // so it is interrupted on settle (no progress events after the
                // child drains). Background/judge/CLI paths skip this (they don't
                // await delegate here).
                const text = yield* Effect.gen(function* () {
                  if (taskID !== undefined) {
                    yield* events.subscribe(SessionTask.Event.Updated).pipe(
                      Stream.filter((event) => event.data.sessionID === child.id),
                      Stream.runForEach((event) =>
                        Effect.gen(function* () {
                          const ratio = childCompletionRatio(event.data.tasks)
                          if (!ratio) return
                          yield* tasks.recordProgress({
                            sessionID: context.sessionID,
                            taskID,
                            phase: "streaming",
                            progress: ratio.progress,
                            current: ratio.current,
                            total: ratio.total,
                          })
                        }),
                      ),
                      Effect.forkScoped,
                    )
                  }
                  return yield* TaskDriver.delegate({
                    sessionID: child.id,
                    parentID: context.sessionID,
                    prompt: input.prompt,
                    taskID,
                    onSettle,
                  })
                }).pipe(Effect.scoped)
                return {
                  sessionID: child.id,
                  output: renderOutput({ sessionID: child.id, state: "completed", text }),
                }
              })

              // Retry once when the child's own drain crashed (DelegateError
              // "error"); a cancelled drain (user interrupt) is not retried. On
              // abort, stop the current child. A surviving DelegateError becomes a
              // tool failure.
              return yield* delegateOnce.pipe(
                Effect.retry({
                  times: 1,
                  while: (error) => error instanceof TaskDriver.DelegateError && error.reason === "error",
                }),
                Effect.catchTag(
                  "TaskDriver.DelegateError",
                  (error) => new ToolFailure({ message: `Subagent task ${error.reason}`, error }),
                ),
                Effect.onInterrupt(() =>
                  Ref.get(activeChild).pipe(
                    Effect.flatMap((current) =>
                      Option.isSome(current) ? TaskDriver.cancel(current.value) : Effect.void,
                    ),
                  ),
                ),
              )
            }),
        }),
      })
      .pipe(Effect.orDie)
  }),
)
