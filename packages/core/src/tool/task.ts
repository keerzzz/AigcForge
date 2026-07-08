export * as TaskTool from "./task"

import { ToolFailure } from "@aigcfroge/llm"
import { Effect, Layer, Option, Ref, Schema } from "effect"
import { AgentV2 } from "../agent"
import { Config } from "../config"
import { PermissionV2 } from "../permission"
import { SessionSchema } from "../session/schema"
import { Tool } from "./tool"
import { TaskDriver } from "./task-driver"
import { Tools } from "./tools"

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
  background: Schema.optional(Schema.Boolean).annotate({
    description:
      "Run the subagent in the background and return immediately. You will be notified when it completes; its result is injected back into this conversation. DO NOT poll or proactively check its progress.",
  }),
  attended: Schema.optional(Schema.Boolean).annotate({
    description:
      "true=attended (subagent asks shown to user for approval), false=unattended (asks auto-denied). Defaults to the subagent's config.",
  }),
  execution_type: Schema.optional(Schema.Literals(["subagent", "external-cli"])).annotate({
    description:
      "Execution mode: subagent (default) for internal agents, external-cli for CLI tools like claude-code, gemini, opencode",
  }),
  cli_target: Schema.optional(Schema.String).annotate({
    description: "CLI name when execution_type is 'external-cli'",
  }),
})

export const Output = Schema.Struct({
  sessionID: Schema.String,
  output: Schema.String,
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

              // CLI execution mode: delegate to an external CLI tool instead of
              // creating a child Session. The CLI adapter is resolved through the
              // TaskDriver seam (registered at the composition root).
              if (input.execution_type === "external-cli") {
                if (!input.cli_target) {
                  return yield* new ToolFailure({
                    message: "cli_target is required when execution_type is 'external-cli'",
                  })
                }
                const text = yield* TaskDriver.executeCLI({
                  cliTarget: input.cli_target,
                  prompt: input.prompt,
                  sessionID: context.sessionID,
                }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message })))
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
                  })
                  return {
                    sessionID: child.id,
                    output: renderOutput({ sessionID: child.id, state: "running", text: BACKGROUND_STARTED }),
                  }
                }

                const text = yield* TaskDriver.delegate({ sessionID: child.id, prompt: input.prompt })
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
