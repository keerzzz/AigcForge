export * as TaskTool from "./task"

import { ToolFailure } from "@aigcfroge/llm"
import { Cause, Effect, Exit, Layer, Option, Ref, Schema, Stream } from "effect"
import { DelegationID } from "@aigcfroge/schema/delegation-id"
import { ParticipantID, TurnID } from "@aigcfroge/schema/delegation-id"
import { AgentV2 } from "../agent"
import { Config } from "../config"
import { DelegationService } from "../delegation/service"
import { EventV2 } from "../event"
import { PermissionV2 } from "../permission"
import { ProductModeAgentPolicy } from "../product-mode-agent-policy"
import { SessionSchema } from "../session/schema"
import { SessionTask } from "../session/task"
import { SessionComposition } from "../session/composition"
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
  delegation_id: Schema.optional(Schema.String).annotate({
    description: "Optional persistent delegation ID to route this task turn into an existing delegation",
  }),
  new_delegation: Schema.optional(Schema.Boolean).annotate({
    description: "When true, create a fresh persistent delegation instead of reusing the currently active one",
  }),
  participant_id: Schema.optional(Schema.String),
  turn_id: Schema.optional(Schema.String),
  command: Schema.optional(
    Schema.Literals([
      "append",
      "steer",
      "interrupt",
      "close",
      "retry",
      "reconcile",
      "archive",
      "unarchive",
      "fork",
      "purge",
      "retract_rejection",
    ]),
  ),
})

export const Output = Schema.Struct({
  sessionID: Schema.String,
  output: Schema.String,
  delegationID: Schema.optional(Schema.String),
  turnID: Schema.optional(Schema.String),
  participantID: Schema.optional(Schema.String),
  // External-CLI dispatches carry structured metadata so session-ui / TUI task
  // cards can render a CLI badge, status, and a link into the child Session.
  metadata: Schema.optional(
    Schema.Struct({
      sessionId: Schema.optional(Schema.String),
      parentSessionId: Schema.optional(Schema.String),
      cli: Schema.optional(Schema.String),
      execution_type: Schema.optional(Schema.Literal("external-cli")),
      status: Schema.optional(Schema.String),
      delegationID: Schema.optional(Schema.String),
      turnID: Schema.optional(Schema.String),
      participantID: Schema.optional(Schema.String),
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

const toToolFailure = (error: unknown) =>
  error instanceof ToolFailure
    ? error
    : new ToolFailure({
        message: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error ? { error } : {}),
      })

const mapDelegationDispatchError = (error: unknown) =>
  error instanceof TaskDriver.DelegateError ? error : toToolFailure(error)

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const agents = yield* AgentV2.Service
    const permission = yield* PermissionV2.Service
    const config = yield* Config.Service
    const delegation = yield* DelegationService.Service
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

              if (input.command && input.command !== "append" && input.command !== "steer") {
                const delegationID = Option.getOrUndefined(
                  Schema.decodeUnknownOption(DelegationID.ID)(input.delegation_id),
                )
                if (!delegationID) return yield* new ToolFailure({ message: "delegation_id is required for command" })
                const action =
                  input.command === "interrupt"
                    ? "task_interrupt"
                    : input.command === "close"
                      ? "task_close"
                      : input.command === "archive" || input.command === "unarchive"
                        ? "task_archive"
                        : input.command === "fork"
                          ? "task_fork"
                          : input.command === "purge"
                            ? "task_purge"
                            : "task_reconcile"
                yield* permission
                  .assert({
                    action,
                    resources: [delegationID],
                    sessionID: context.sessionID,
                    agent: context.agent,
                    source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
                  })
                  .pipe(Effect.mapError((error) => new ToolFailure({ message: `Task permission denied`, error })))
                if (input.command === "retry") {
                  const participantID = Option.getOrUndefined(
                    Schema.decodeUnknownOption(ParticipantID)(input.participant_id),
                  )
                  const turnID = Option.getOrUndefined(Schema.decodeUnknownOption(TurnID)(input.turn_id))
                  if (!participantID || !turnID)
                    return yield* new ToolFailure({ message: "retry requires participant_id and turn_id" })
                  yield* delegation
                    .retry({ delegationID, participantID, turnID })
                    .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error })))
                } else if (input.command === "reconcile")
                  yield* delegation
                    .reconcile({ delegationID })
                    .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error })))
                else if (input.command === "retract_rejection") {
                  yield* delegation
                    .retractRejection({ delegationID, reason: input.prompt })
                    .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error })))
                } else if (input.command === "close")
                  yield* delegation
                    .close({ delegationID, reason: input.prompt })
                    .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error })))
                else if (input.command === "archive")
                  yield* delegation
                    .archive({ delegationID })
                    .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error })))
                else if (input.command === "unarchive")
                  yield* delegation
                    .unarchive({ delegationID })
                    .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error })))
                else if (input.command === "fork")
                  yield* delegation
                    .fork({ delegationID, reason: input.prompt })
                    .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error })))
                else if (input.command === "purge")
                  yield* delegation
                    .delete({ delegationID, purge: true })
                    .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error })))
                else if (input.command === "interrupt") {
                  const participantID = Option.getOrUndefined(
                    Schema.decodeUnknownOption(ParticipantID)(input.participant_id),
                  )
                  yield* TaskDriver.interruptDelegation(delegationID, participantID).pipe(
                    Effect.mapError((error) => new ToolFailure({ message: String(error) })),
                  )
                }
                return {
                  sessionID: context.sessionID,
                  delegationID,
                  output: renderOutput({
                    sessionID: context.sessionID,
                    state: "completed",
                    text: `${input.command} accepted`,
                  }),
                }
              }

              const subagent = yield* agents.resolve(input.subagent_type)
              if (!subagent)
                return yield* new ToolFailure({
                  message: `Unknown agent type: ${input.subagent_type} is not a valid agent type`,
                })

              // Non-CLI delegations assert on the subagent type. External-CLI mode
              // branches to its own assert (below) that carries the CLI target.
              const cliTarget = input.cli_target
              const mode = yield* TaskDriver.sessionMode(context.sessionID)
              if (mode === "custom") {
                if (input.execution_type === "external-cli") {
                  return yield* new ToolFailure({
                    message: "External CLI execution is not permitted in Custom mode",
                  })
                }
                if (input.execution_type === "judge") {
                  return yield* new ToolFailure({
                    message: "Judge execution is not permitted in Custom mode",
                  })
                }
                if (input.background === true) {
                  return yield* new ToolFailure({
                    message: "Background subagent delegation is not permitted in Custom mode",
                  })
                }
                const composition = yield* Effect.serviceOption(SessionComposition.Service)
                // Tier-1 fail-closed: in Custom mode the delegation gate is
                // mandatory — an unreachable SessionComposition service fails the
                // tool instead of silently skipping the check.
                if (Option.isNone(composition)) {
                  return yield* new ToolFailure({ message: "Custom session snapshot service unavailable" })
                }
                yield* composition.value.assertAgentAllowed(context.sessionID, input.subagent_type).pipe(
                  Effect.catchTag("SessionComposition.AgentDelegationForbiddenError", (err) =>
                    Effect.fail(
                      new ToolFailure({
                        message: `Agent '${input.subagent_type}' is not permitted in this Custom session. Allowed agent is '${err.allowedAgentID}'.`,
                      }),
                    ),
                  ),
                  Effect.catchTag("SessionComposition.SnapshotNotFoundError", () =>
                    Effect.fail(new ToolFailure({ message: "Custom session snapshot not found" })),
                  ),
                  Effect.catchTag("SessionComposition.SnapshotDecodeError", (err) =>
                    Effect.fail(
                      new ToolFailure({ message: `Failed to decode custom session snapshot: ${err.details}` }),
                    ),
                  ),
                )
              }

              if (input.execution_type !== "external-cli") {
                // The child Session inherits this Session's mode, and mode policy
                // gates which agents may be primary there. Check it here so a
                // disallowed delegation returns a readable tool failure instead of
                // dying inside child-session creation (ADR-13 Amendment-2 §1b.3).
                if (mode !== "custom") {
                  const verdict = ProductModeAgentPolicy.checkPrimaryAgent(mode ?? "coding", input.subagent_type)
                  if (!verdict.allowed) {
                    return yield* new ToolFailure({ message: verdict.error.message })
                  }
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
                const requestedDelegationID = input.delegation_id
                  ? Option.getOrUndefined(Schema.decodeUnknownOption(DelegationID.ID)(input.delegation_id))
                  : undefined
                if (input.delegation_id && requestedDelegationID === undefined) {
                  return yield* new ToolFailure({ message: `Invalid delegation_id: ${input.delegation_id}` })
                }
                const delegationState = yield* delegation
                  .resolve({
                    parentSessionID: context.sessionID,
                    title: input.description,
                    delegationID: requestedDelegationID,
                    newDelegation: input.new_delegation,
                  })
                  .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error })))
                const participantRole = cliTarget === "codex" ? ("reviewer" as const) : ("implementer" as const)
                const participant =
                  [...delegationState.participants.values()].find(
                    (candidate) =>
                      candidate.provider === "external" &&
                      candidate.target === cliTarget &&
                      candidate.role === participantRole,
                  ) ??
                  (yield* delegation
                    .addParticipant({
                      delegationID: delegationState.delegation.id,
                      provider: "external",
                      target: cliTarget,
                      role: participantRole,
                      context: "fresh",
                    })
                    .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error }))))
                const turn = yield* delegation
                  .appendTurn({
                    delegationID: delegationState.delegation.id,
                    kind: participantRole === "reviewer" ? "review" : "task",
                    promptSummary: input.description,
                    participantIDs: [participant.id],
                    delivery: "steer",
                    origin: {
                      deliveryOrigin: "task",
                      senderParticipantID: participant.id,
                    },
                  })
                  .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error })))
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
                const result = yield* TaskDriver.dispatchDelegation({
                  delegationID: delegationState.delegation.id,
                  participantID: participant.id,
                  turnID: turn.id,
                  parentID: context.sessionID,
                  prompt: input.prompt,
                  description: input.description,
                  background: false,
                  queue: false,
                  taskID: input.task_id ? SessionSchema.ID.make(input.task_id) : undefined,
                  delivery: {
                    delegationID: delegationState.delegation.id,
                    participantID: participant.id,
                    turnID: turn.id,
                    deliveryOrigin: "task",
                    senderParticipantID: participant.id,
                    delivery: "steer",
                    attempt: 1,
                  },
                  execution: "external",
                  cliTarget,
                  permissionSource: {
                    type: "tool",
                    messageID: context.assistantMessageID,
                    callID: context.toolCallID,
                  },
                  onSettle: (outcome) =>
                    cliTaskID === undefined
                      ? Effect.void
                      : tasks
                          .patch({
                            sessionID: context.sessionID,
                            id: cliTaskID,
                            status: outcome.status,
                            outputDigest: outcome.outputDigest,
                          })
                          .pipe(Effect.orDie, Effect.asVoid),
                }).pipe(Effect.mapError(toToolFailure))
                if (result.executorFailed) {
                  return yield* new ToolFailure({ message: result.text ?? "External CLI failed" })
                }
                const outputText = result.text ?? (result.status === "running" ? BACKGROUND_STARTED : "")
                return {
                  sessionID: result.sessionID,
                  delegationID: delegationState.delegation.id,
                  turnID: turn.id,
                  participantID: participant.id,
                  output: renderOutput({
                    sessionID: result.sessionID,
                    state: result.status === "failed" ? "error" : result.status === "running" ? "running" : "completed",
                    text: outputText,
                  }),
                  metadata: {
                    sessionId: result.sessionID,
                    parentSessionId: context.sessionID,
                    cli: cliTarget,
                    execution_type: "external-cli",
                    status: result.providerStatus ?? result.status,
                    delegationID: delegationState.delegation.id,
                    participantID: participant.id,
                    turnID: turn.id,
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

              const requestedDelegationID = input.delegation_id
                ? Option.getOrUndefined(Schema.decodeUnknownOption(DelegationID.ID)(input.delegation_id))
                : undefined
              if (input.delegation_id && requestedDelegationID === undefined) {
                return yield* new ToolFailure({ message: `Invalid delegation_id: ${input.delegation_id}` })
              }
              const state = yield* delegation
                .resolve({
                  parentSessionID: context.sessionID,
                  title: input.description,
                  delegationID: requestedDelegationID,
                  newDelegation: input.new_delegation,
                })
                .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error })))
              const delegationInfo = state.delegation

              // task_id is a compatibility locator only. Durable participant
              // ownership is authoritative and rejects cross-Delegation reuse.
              const requestedChildID = input.task_id
                ? Option.getOrUndefined(Schema.decodeUnknownOption(SessionSchema.ID)(input.task_id))
                : undefined
              const matchingParticipants = [...state.participants.values()].filter(
                (participant) =>
                  participant.provider === "internal" &&
                  participant.target === subagent.id &&
                  participant.role === "implementer",
              )
              const requestedParticipant = requestedChildID
                ? [...state.participants.values()].find(
                    (participant) => participant.childSessionID === requestedChildID,
                  )
                : undefined
              if (requestedChildID && requestedParticipant === undefined && state.participants.size > 0) {
                return yield* new ToolFailure({
                  message: `task_id ${input.task_id} does not belong to delegation ${delegationInfo.id}`,
                })
              }
              if (
                requestedParticipant &&
                !matchingParticipants.some((participant) => participant.id === requestedParticipant.id)
              ) {
                return yield* new ToolFailure({
                  message: `task_id ${input.task_id} is not the requested participant in delegation ${delegationInfo.id}`,
                })
              }
              const boundParticipant =
                requestedParticipant ?? matchingParticipants.find((participant) => participant.childSessionID)
              if (
                requestedChildID &&
                boundParticipant?.childSessionID &&
                boundParticipant.childSessionID !== requestedChildID
              ) {
                return yield* new ToolFailure({
                  message: `task_id ${input.task_id} does not belong to delegation ${delegationInfo.id}`,
                })
              }
              const child = yield* TaskDriver.createChild({
                parentID: context.sessionID,
                agent: subagent.id,
                id: requestedChildID ?? boundParticipant?.childSessionID,
                attended: input.attended ?? subagent.attended ?? configAttendedDefault ?? false,
              })
              if (child.parentID !== context.sessionID) {
                return yield* new ToolFailure({
                  message: `task_id ${input.task_id ?? child.id} does not belong to this session`,
                })
              }
              const participant = boundParticipant
                ? boundParticipant
                : yield* delegation
                    .addParticipant({
                      delegationID: delegationInfo.id,
                      provider: "internal",
                      target: subagent.id,
                      role: "implementer",
                      context: "fresh",
                      childSessionID: child.id,
                    })
                    .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error })))
              if (participant.childSessionID !== child.id) {
                return yield* new ToolFailure({
                  message: `Child Session ${child.id} is not bound to delegation ${delegationInfo.id}`,
                })
              }
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
              if (taskID === undefined) {
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

              const shouldQueue =
                input.background === true && backgroundEnabled() && (yield* TaskDriver.isRunning(child.id))
              const turn = yield* delegation
                .appendTurn({
                  delegationID: delegationInfo.id,
                  kind: "task",
                  promptSummary: input.description,
                  participantIDs: [participant.id],
                  delivery: shouldQueue ? "queue" : "steer",
                  origin: { deliveryOrigin: "meta", senderParticipantID: participant.id },
                })
                .pipe(
                  Effect.mapError((error) => new ToolFailure({ message: error.message, error })),
                  Effect.tapError(() =>
                    onSettle ? onSettle({ status: "failed", outputDigest: "turn admission failed" }) : Effect.void,
                  ),
                )

              const attempt = yield* Ref.make(1)

              const delegateOnce = Effect.gen(function* () {
                const delivery = {
                  delegationID: delegationInfo.id,
                  participantID: participant.id,
                  turnID: turn.id,
                  deliveryOrigin: "meta",
                  senderParticipantID: participant.id,
                  delivery: turn.delivery,
                  attempt: yield* Ref.getAndUpdate(attempt, (current) => current + 1),
                }
                const background = input.background === true && backgroundEnabled()

                // Persistent delegation execution has one owner. TaskTool only
                // supplies the already-admitted Turn, full prompt, and linkage;
                // DelegationExecution routes it to the existing TaskDriver seam.
                const dispatch = yield* Effect.gen(function* () {
                  if (!background && taskID !== undefined) {
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
                  return yield* TaskDriver.dispatchDelegation({
                    delegationID: delegationInfo.id,
                    participantID: participant.id,
                    turnID: turn.id,
                    parentID: context.sessionID,
                    sessionID: child.id,
                    prompt: input.prompt,
                    description: input.description,
                    background,
                    queue: shouldQueue,
                    taskID,
                    stepID: child.stepID,
                    delivery,
                    execution: "internal",
                    onSettle,
                  }).pipe(Effect.mapError(mapDelegationDispatchError))
                }).pipe(Effect.scoped)

                return {
                  sessionID: dispatch.sessionID,
                  delegationID: delegationInfo.id,
                  participantID: participant.id,
                  turnID: turn.id,
                  output: renderOutput({
                    sessionID: dispatch.sessionID,
                    state:
                      dispatch.status === "failed" ? "error" : dispatch.status === "running" ? "running" : "completed",
                    summary:
                      dispatch.status === "running" ? (shouldQueue ? "Background task updated" : undefined) : undefined,
                    text: dispatch.text ?? (shouldQueue ? BACKGROUND_UPDATED : BACKGROUND_STARTED),
                  }),
                  metadata: {
                    sessionId: dispatch.sessionID,
                    parentSessionId: context.sessionID,
                    status: dispatch.status,
                    delegationID: delegationInfo.id,
                    participantID: participant.id,
                    turnID: turn.id,
                  },
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
                Effect.mapError((error) =>
                  error instanceof TaskDriver.DelegateError
                    ? new ToolFailure({ message: `Subagent task ${error.reason}`, error })
                    : toToolFailure(error),
                ),
                Effect.onInterrupt(() => TaskDriver.cancel(child.id)),
              )
            }),
        }),
      })
      .pipe(Effect.orDie)
  }),
)
