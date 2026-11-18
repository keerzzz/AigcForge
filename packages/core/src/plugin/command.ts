export * as CommandPlugin from "./command.js"

import { define } from "@aigcfroge/plugin/effect/plugin"
import { Effect, Schema, Stream } from "effect"
import { Bus } from "../bus.js"
import { Location } from "../location.js"
import { Mcp } from "../mcp/index.js"
import { MetaAgentService } from "../meta-agent/service.js"
import { SessionGoal } from "../session/goal.js"
import { SessionExecution } from "../session/execution.js"
import { ScheduleService } from "../session/schedule-service.js"
import PROMPT_INITIALIZE from "./command/initialize.txt"
import PROMPT_REVIEW from "./command/review.txt"

export const Plugin = define({
  id: "aigcfroge.command",
  effect: Effect.fn(function* (ctx) {
    const location = yield* Location.Service
    const mcp = yield* Mcp.Service
    const bus = yield* Bus.Service
    const loaded = { prompts: [] as Mcp.Prompt[] }
    yield* bus.subscribe(Mcp.PromptsChanged).pipe(
      Stream.runForEach(() =>
        mcp.prompts().pipe(
          Effect.tap((prompts) => Effect.sync(() => (loaded.prompts = prompts))),
          Effect.andThen(ctx.command.reload()),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
    loaded.prompts = yield* mcp.prompts()
    yield* ctx.command.transform((editor) => {
      editor.add({
        name: "init",
        description: "guided AGENTS.md setup",
        execute: (input) =>
          ctx.session
            .prompt({
              ...input.prompt,
              sessionID: input.sessionID,
              text: append(PROMPT_INITIALIZE.replace("${path}", location.project.directory), input.prompt.text),
              delivery: input.delivery,
            })
            .pipe(Effect.asVoid),
      })
      editor.add({
        name: "review",
        description: "review changes [commit|branch|pr], defaults to uncommitted",
        execute: (input) =>
          ctx.session
            .prompt({
              ...input.prompt,
              sessionID: input.sessionID,
              text: append(PROMPT_REVIEW.replace("${path}", location.project.directory), input.prompt.text),
              delivery: input.delivery,
            })
            .pipe(Effect.asVoid),
      })
      for (const prompt of loaded.prompts) {
        editor.add({
          name: mcpCommandName(prompt.server, prompt.name),
          description: prompt.description,
          execute: (input) =>
            Effect.gen(function* () {
              const args = parseArguments(input.prompt.text)
              const result = yield* mcp.prompt({
                server: prompt.server,
                name: prompt.name,
                args: Object.fromEntries(
                  (prompt.arguments ?? []).map((argument, index) => [argument.name, args[index] ?? ""]),
                ),
              })
              if (!result) return yield* Effect.fail(new Error(`MCP prompt not found: ${prompt.server}:${prompt.name}`))
              yield* ctx.session.prompt({
                ...input.prompt,
                sessionID: input.sessionID,
                text: result.messages
                  .map((message) => promptMessageText(message.content))
                  .join("\n")
                  .trim(),
                delivery: input.delivery,
              })
            }).pipe(Effect.asVoid),
        })
      }
    })
  }),
})

export const MetaCommands = define({
  id: "aigcfroge.command.meta",
  effect: Effect.fn("MetaCommands.Plugin")(function* (ctx) {
    const goals = yield* SessionGoal.Service
    const execution = yield* SessionExecution.Service
    const schedules = yield* ScheduleService.Service
    const metas = yield* MetaAgentService.Service
    yield* ctx.command.transform((editor) => {
      editor.add({
        name: "goal",
        description: "Goal status; /goal <objective>; /goal {objective,conditions,budget}; /goal pause|resume|cancel",
        execute: (input) =>
          Effect.gen(function* () {
            const text = input.prompt.text.trim()
            yield* metas.assertCoordination(input.sessionID)
            const saved = yield* goals.list(input.sessionID)
            if (text === "") {
              yield* ctx.session.synthetic({
                sessionID: input.sessionID,
                text: JSON.stringify(Schema.encodeSync(Schema.Array(SessionGoal.Info))(saved)),
                resume: false,
              })
              return
            }
            const current =
              saved.find((goal) => goal.status === "active") ?? saved.findLast((goal) => goal.status === "paused")
            if (text === "pause" || text === "resume" || text === "cancel") {
              if (!current) return yield* Effect.fail(new Error("This Session has no active or paused Goal"))
              const ref = { sessionID: input.sessionID, goalID: current.id, expectedRevision: current.revision }
              if (text === "pause") {
                yield* goals.pause(ref)
                return
              }
              if (text === "cancel") {
                yield* goals.cancel(ref)
                return
              }
              const resumed = yield* goals.resume(ref)
              const advanced = yield* goals.advance({ sessionID: input.sessionID, goalID: resumed.id })
              if (advanced.state === "admitted") yield* execution.wake(input.sessionID)
              return
            }
            const config = text.startsWith("{")
              ? yield* Schema.decodeUnknownEffect(Schema.fromJsonString(SessionGoal.CreateInput))(text)
              : SessionGoal.CreateInput.make({
                  objective: text,
                  conditions: [
                    SessionGoal.Condition.make({ id: "acceptance", kind: "human_acceptance", description: text }),
                  ],
                  budget: {},
                })
            const goal = yield* goals.set({ ...config, sessionID: input.sessionID })
            const advanced = yield* goals.advance({ sessionID: input.sessionID, goalID: goal.id })
            if (advanced.state === "admitted") yield* execution.wake(input.sessionID)
          }),
      })
      editor.add({
        name: "schedule",
        description: "Read schedules or ask Meta to create/change one using an explicit timezone and target",
        execute: (input) =>
          Effect.gen(function* () {
            yield* metas.assertCoordination(input.sessionID)
            if (input.prompt.text.trim() === "") {
              yield* ctx.session.synthetic({
                sessionID: input.sessionID,
                text: JSON.stringify(yield* schedules.listRules(input.sessionID)),
                resume: false,
              })
              return
            }
            yield* ctx.session.prompt({
              ...input.prompt,
              sessionID: input.sessionID,
              text:
                "Manage a persistent Schedule with the schedule tool. Resolve the requested timezone and target; use the saved rule revision for edits.\n" +
                input.prompt.text,
              delivery: input.delivery,
            })
          }),
      })
    })
  }),
})

function append(template: string, input: string) {
  const value = input.trim()
  if (template.includes("$ARGUMENTS")) return template.replaceAll("$ARGUMENTS", () => value)
  return [template, value].filter(Boolean).join("\n\n")
}

function parseArguments(input: string) {
  return (input.match(argsRegex) ?? []).map((argument) => argument.replace(quoteTrimRegex, ""))
}

function promptMessageText(content: unknown) {
  if (typeof content === "string") return content
  if (!content || typeof content !== "object") return ""
  if (!("type" in content) || content.type !== "text") return ""
  if (!("text" in content) || typeof content.text !== "string") return ""
  return content.text
}

function mcpCommandName(server: string, prompt: string) {
  return `${sanitize(server)}:${sanitize(prompt)}`
}

function sanitize(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_")
}

const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const quoteTrimRegex = /^["']|["']$/g
