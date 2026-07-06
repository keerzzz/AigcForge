export * as TaskTool from "./task"

import { ToolFailure } from "@aigcfroge/llm"
import { Effect, Layer, Schema } from "effect"
import { AgentV2 } from "../agent"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import { TaskDriver } from "./task-driver"
import { Tools } from "./tools"

export const name = "task"

export const Input = Schema.Struct({
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
})

export const Output = Schema.Struct({
  sessionID: Schema.String,
  output: Schema.String,
})
export type Output = typeof Output.Type

export const description = [
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

const renderOutput = (input: { sessionID: string; state: "completed" | "error"; text: string }) =>
  [
    `<task id="${input.sessionID}" state="${input.state}">`,
    `<${input.state === "error" ? "task_error" : "task_result"}>`,
    input.text,
    `</${input.state === "error" ? "task_error" : "task_result"}>`,
    "</task>",
  ].join("\n")

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
