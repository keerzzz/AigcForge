export * as TaskTool from "./task"

import { ToolFailure } from "@aigcfroge/llm"
import { Effect, Layer, Schema } from "effect"
import { AgentV2 } from "../agent"
import { PermissionV2 } from "../permission"
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
  background: Schema.optional(Schema.Boolean).annotate({
    description:
      "Run the subagent in the background and return immediately. You will be notified when it completes; its result is injected back into this conversation. DO NOT poll or proactively check its progress.",
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

export const description = backgroundEnabled()
  ? [FOREGROUND_DESCRIPTION, "", BACKGROUND_DESCRIPTION].join("\n")
  : FOREGROUND_DESCRIPTION

const renderOutput = (input: { sessionID: string; state: "completed" | "error" | "running"; text: string }) => {
  const tag = input.state === "error" ? "task_error" : "task_result"
  return [`<task id="${input.sessionID}" state="${input.state}">`, `<${tag}>`, input.text, `</${tag}>`, "</task>"].join(
    "\n",
  )
}

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const agents = yield* AgentV2.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description,
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [{ type: "text", text: output.output }],
          execute: (input, context) =>
            Effect.gen(function* () {
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

              const child = yield* TaskDriver.createChild({
                parentID: context.sessionID,
                agent: subagent.id,
              })

              // Background delegation: schedule the child, inject its result into
              // the parent when it settles, and return immediately. Gated by the
              // experimental flag; ignored otherwise.
              if (input.background === true && backgroundEnabled()) {
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

              const text = yield* TaskDriver.delegate({ sessionID: child.id, prompt: input.prompt }).pipe(
                Effect.onInterrupt(() => TaskDriver.interrupt(child.id)),
              )
              return {
                sessionID: child.id,
                output: renderOutput({ sessionID: child.id, state: "completed", text }),
              }
            }),
        }),
      })
      .pipe(Effect.orDie)
  }),
)
