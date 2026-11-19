export * as SessionShareTool from "./share.js"

import { ToolFailure } from "@aigcfroge/ai"
import type { Context } from "@aigcfroge/plugin/effect/plugin"
import type { SessionHooks } from "@aigcfroge/plugin/effect/session"
import { Effect, Option, Schema } from "effect"
import { FSUtil } from "@aigcfroge/util/fs-util"
import { Hash } from "@aigcfroge/util/hash"
import { MetaAgentService } from "../../meta-agent/service.js"
import { Permission } from "../../permission.js"
import { Session } from "../../session.js"
import { SessionShareV2 } from "../../session/share-v2.js"
import { SessionMessage } from "../../session/message.js"
import { serializedSelection } from "../../session/session.js"
import { TaskTool } from "./task.js"
import { SessionCommunication } from "@aigcfroge/schema/session-communication"

export const name = "share"

export const description =
  "Send feedback, a question, a reply, a Session reference or output, projected history, or one exact completed Judge Task result. Use scope text with text for a message. sourceSessionID defaults to this Session. A controlled child defaults to its Meta parent and may explicitly target a sibling in the same Meta control tree. replyTo routes to the exact saved sender. result requires the saved Task's messageID and Tool id in result_source. The target processes the content unless trigger is false."

export const Input = Schema.Struct({
  sourceSessionID: Schema.optionalKey(Session.ID).annotate({
    description: "Session to share content from. Defaults to this Session; a controlled child shares its own content.",
  }),
  targetSessionID: Schema.optionalKey(Session.ID).annotate({
    description:
      "Receiving Session. A child defaults to its Meta parent; a reply defaults to the saved sender. Required for other sends.",
  }),
  scope: SessionShareV2.Scope.annotate({
    description:
      "text sends a message supplied in text; reference shares the session ID; output shares its latest assistant text; full shares its context; result shares one exact saved Judge Task.",
  }),
  text: Schema.optionalKey(Schema.String).annotate({
    description: "Feedback, question, or reply, required for scope text.",
  }),
  replyTo: Schema.optionalKey(SessionCommunication.ID).annotate({
    description: "Reply to this exact received communication. The target must be its original sender.",
  }),
  delivery: Schema.optionalKey(Schema.Literals(["queue", "steer"])).annotate({
    description:
      "steer promotes at the next safe step boundary; queue waits until the target would become idle. Defaults to steer.",
  }),
  result_source: Schema.optionalKey(SessionShareV2.ResultSource).annotate({
    description: "Exact saved Judge Task locator, required for scope result. The Tool id belongs to this message.",
  }),
  trigger: Schema.optionalKey(Schema.Boolean).annotate({
    description: "Wake the target to process the content. Defaults to true; false only admits it to the inbox.",
  }),
})

export const ResultOutput = SessionShareV2.ResultOutput
export const Output = Schema.Union([Schema.String, ResultOutput])

export const Plugin = {
  id: "aigcfroge.tool.share",
  effect: Effect.fn("SessionShareTool.Plugin")(function* (ctx: Context) {
    const sessions = yield* Session.Service
    const share = yield* SessionShareV2.Service
    const permission = yield* Permission.Service
    const files = yield* FSUtil.Service
    const metas = yield* MetaAgentService.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const session = yield* sessions
                .get(context.sessionID)
                .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error })))
              const reply = input.replyTo
                ? yield* share
                    .read({ sessionID: context.sessionID, communicationID: input.replyTo })
                    .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error })))
                : undefined
              if (input.replyTo && (!reply || reply.targetSessionID !== context.sessionID))
                return yield* new ToolFailure({
                  message: "Only the receiving Session may reply to the exact saved communication",
                })
              const sourceSessionID = input.sourceSessionID ?? context.sessionID
              const targetSessionID =
                input.targetSessionID ??
                reply?.actor.sessionID ??
                (session.controller?.kind === "child" ? session.controller.rootSessionID : undefined)
              if (!targetSessionID)
                return yield* new ToolFailure({ message: "targetSessionID is required when sending from a Meta root" })
              if (reply && targetSessionID !== reply.actor.sessionID)
                return yield* new ToolFailure({ message: "A reply must target the exact saved sender" })
              const route = { sourceSessionID, targetSessionID }
              const capability = yield* metas
                .assertCommunication(context.sessionID, route, { agent: context.agent, tool: name })
                .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error })))
              yield* permission
                .assert({
                  action: name,
                  resources: [sourceSessionID, targetSessionID],
                  save: [sourceSessionID, targetSessionID],
                  metadata: route,
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source: { type: "tool", messageID: context.messageID, id: context.id },
                })
                .pipe(Effect.mapError((error) => new ToolFailure({ message: "Permission denied: share", error })))
              const actor = new SessionCommunication.ToolActor({
                type: "tool",
                sessionID: context.sessionID,
                agent: context.agent,
                messageID: context.messageID,
                id: context.id,
              })
              const communicationID = SessionCommunication.ID.make(
                `com_${Hash.sha256(JSON.stringify([context.sessionID, context.messageID, context.id]))}`,
              )
              if (input.scope === "result") {
                if (!input.result_source)
                  return yield* new ToolFailure({ message: "scope result requires result_source" })
                const resultSource = input.result_source
                const retained = yield* share.read({ sessionID: context.sessionID, communicationID }).pipe(
                  Effect.catchTag("SessionCommunication.Error", (error) =>
                    error.reason === "unavailable" ? Effect.succeed(undefined) : Effect.fail(error),
                  ),
                  Effect.mapError((error) => new ToolFailure({ message: error.message, error })),
                )
                const resultContent = retained
                  ? new SessionShareV2.ResultContent({
                      result_source: resultSource,
                      basis: retained.contentSource.basis ?? "original",
                      text: retained.text,
                    })
                  : yield* Effect.gen(function* () {
                      yield* sessions
                        .get(sourceSessionID)
                        .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error })))
                      const message = yield* sessions.message({
                        sessionID: sourceSessionID,
                        messageID: resultSource.messageID,
                      })
                      if (message?.type !== "assistant")
                        return yield* new ToolFailure({
                          message: "result_source must locate a saved assistant message in the source Session",
                        })
                      const tool = message.content.find((part) => part.type === "tool" && part.id === resultSource.id)
                      if (tool?.type !== "tool" || tool.name !== TaskTool.name || tool.state.status !== "completed")
                        return yield* new ToolFailure({
                          message: "result_source must locate a completed Task in the saved message",
                        })
                      const text =
                        tool.state.metadata?.truncated === true && typeof tool.state.metadata.outputPath === "string"
                          ? yield* files
                              .readFileString(tool.state.metadata.outputPath)
                              .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error })))
                          : tool.state.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
                      const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(TaskTool.JudgeOutput))(text)
                      if (Option.isNone(decoded))
                        return yield* new ToolFailure({
                          message: "The saved Task does not contain a complete Judge result",
                        })
                      const result = decoded.value
                      if (
                        result.sessionID !== sourceSessionID ||
                        result.source.type !== "tool" ||
                        result.source.messageID !== message.id ||
                        result.source.id !== resultSource.id
                      )
                        return yield* new ToolFailure({
                          message: "The saved Judge result does not belong to result_source",
                        })
                      const summary = result.summary
                      const basis =
                        summary?.status === "completed" && summary.result?.text.trim()
                          ? ("summary" as const)
                          : summary?.status === "partial" && summary.result?.text.trim()
                            ? ("summary_partial" as const)
                            : ("original" as const)
                      const quality = {
                        status: result.status,
                        taskSettlement: result.taskSettlement,
                        arbitration: result.arbitration === "none" ? "none" : result.arbitration.status,
                        summary: summary?.status ?? "not_requested",
                      }
                      const encoded = Schema.encodeSync(TaskTool.JudgeOutput)(result)
                      const sources = {
                        task: result.source,
                        workers: encoded.workers.map((worker) => ({ ...worker, text: undefined })),
                        arbitration:
                          encoded.arbitration === "none"
                            ? "none"
                            : {
                                ...encoded.arbitration,
                                result: encoded.arbitration.result
                                  ? { ...encoded.arbitration.result, text: undefined }
                                  : undefined,
                              },
                        summary: encoded.summary
                          ? {
                              ...encoded.summary,
                              result: encoded.summary.result
                                ? { ...encoded.summary.result, text: undefined }
                                : undefined,
                            }
                          : undefined,
                      }
                      const body = `[Shared Task result from session ${sourceSessionID}]\n${JSON.stringify({ result_source: resultSource, basis, quality, sources })}\n\n${basis === "original" ? text : summary?.result?.text}`
                      return new SessionShareV2.ResultContent({ result_source: resultSource, basis, text: body })
                    })
                const delivered = yield* serializedSelection(
                  capability.rootSessionID,
                  Effect.gen(function* () {
                    yield* metas.assertCommunication(context.sessionID, route, {
                      agent: context.agent,
                      selection: capability.selection,
                      tool: name,
                    })
                    return yield* share.share({
                      actorSessionID: context.sessionID,
                      actor,
                      communicationID,
                      delivery: input.delivery ?? "steer",
                      replyTo: input.replyTo,
                      sourceSessionID,
                      targetSessionID,
                      scope: "result",
                      trigger: input.trigger ?? true,
                      inboxID: SessionMessage.ID.make(
                        `msg_share_${Hash.sha256(JSON.stringify([context.sessionID, { type: "tool", messageID: context.messageID, id: context.id }, sourceSessionID, targetSessionID, resultSource]))}`,
                      ),
                      result: resultContent,
                    })
                  }),
                ).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error })))
                if (!(delivered instanceof SessionShareV2.ResultOutput))
                  return yield* new ToolFailure({ message: "Exact result share did not return its admission" })
                return {
                  output: delivered,
                  content: JSON.stringify(Schema.encodeSync(ResultOutput)(delivered)),
                  metadata: Schema.encodeSync(ResultOutput)(delivered),
                }
              }
              const payload =
                input.scope === "text"
                  ? input.text === undefined
                    ? undefined
                    : { scope: input.scope, text: input.text }
                  : { scope: input.scope }
              if (!payload) return yield* new ToolFailure({ message: "scope text requires text" })
              const delivered = yield* serializedSelection(
                capability.rootSessionID,
                Effect.gen(function* () {
                  yield* metas.assertCommunication(context.sessionID, route, {
                    agent: context.agent,
                    selection: capability.selection,
                    tool: name,
                  })
                  return yield* share.share({
                    actorSessionID: context.sessionID,
                    actor,
                    communicationID,
                    delivery: input.delivery ?? "steer",
                    replyTo: input.replyTo,
                    sourceSessionID,
                    targetSessionID,
                    ...payload,
                    trigger: input.trigger ?? true,
                  })
                }),
              ).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error })))
              const output = `Shared ${payload.scope} from session ${sourceSessionID} to ${targetSessionID}`
              return {
                output,
                content:
                  payload.scope === "text" && delivered instanceof SessionCommunication.Receipt
                    ? `${output}\nCommunication ID: ${delivered.id}`
                    : output,
                metadata: {
                  actorSessionID: context.sessionID,
                  contentSourceSessionID: sourceSessionID,
                  sourceSessionID,
                  targetSessionID,
                  scope: payload.scope,
                  ...(delivered instanceof SessionCommunication.Receipt
                    ? {
                        communication: Schema.encodeSync(SessionCommunication.Record)(
                          new SessionCommunication.Record(delivered),
                        ),
                      }
                    : {}),
                },
              }
            }),
        }),
      )
      .pipe(Effect.orDie)

    const hook = (event: SessionHooks["context"]) =>
      Effect.gen(function* () {
        const tool = event.tools[name]
        if (!tool) return
        const session = yield* sessions.get(event.sessionID).pipe(Effect.orDie)
        if (session.controller?.kind !== "child") return
        tool.description = [
          tool.description,
          `Your controlling Meta Session is ${session.controller.rootSessionID}.`,
          "Use scope text to report progress or ask Meta for input while working. Omit targetSessionID for Meta, or specify a known sibling in the same Meta group.",
          "Replies and follow-up inputs enter your existing Session at safe boundaries. If your next step requires an answer, send the question and finish the current response so Meta can reply.",
        ].join("\n")
      })
    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
  }),
}
