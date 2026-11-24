export * as ToolIntegrityPlugin from "./tool-integrity.js"

import { define } from "@omnixa/plugin/effect/plugin"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { Tool } from "@omnixa/schema/tool"
import { DoomLoop } from "../session/doom-loop.js"
import { ReferenceChecker } from "../session/reference-checker.js"
import { Verifier } from "../session/verifier.js"
import { EditTool } from "../tool/plugin/edit.js"
import { WriteTool } from "../tool/plugin/write.js"
import { PatchTool } from "../tool/plugin/patch.js"
import { normalizeContent } from "../tool/runtime.js"

export const Plugin = define({
  id: "omnixa.tool-integrity",
  effect: Effect.fn("ToolIntegrityPlugin.activate")(function* (ctx) {
    const services = yield* Layer.build(Layer.mergeAll(DoomLoop.layer, ReferenceChecker.layer, Verifier.layer))
    const doom = Context.get(services, DoomLoop.Service)
    const references = Context.get(services, ReferenceChecker.Service)
    const verifier = Context.get(services, Verifier.Service)
    yield* ctx.tool.hook("execute.before", (event) =>
      event.tool === "execute"
        ? Effect.void
        : doom
            .check({
              sessionID: event.sessionID,
              agent: event.agent,
              toolName: event.tool,
              toolInput: event.input,
              providerExecuted: false,
              source: { type: "tool", messageID: event.messageID, id: event.id },
            })
            .pipe(Effect.mapError((error) => new Tool.Error({ message: error.message, error }))),
    )
    yield* ctx.tool.hook("execute.after", (event) =>
      Effect.gen(function* () {
        if (event.status !== "completed") return
        const files = (() => {
          if (event.tool === WriteTool.name) {
            const output = Schema.decodeUnknownOption(WriteTool.Output)(event.result.output)
            return Option.isSome(output) ? [output.value.target] : undefined
          }
          if (event.tool === EditTool.name) {
            const output = Schema.decodeUnknownOption(EditTool.Output)(event.result.output)
            return Option.isSome(output) ? output.value.files.map((file) => file.file) : undefined
          }
          if (event.tool === PatchTool.name) {
            const output = Schema.decodeUnknownOption(PatchTool.Output)(event.result.output)
            return Option.isSome(output) ? output.value.applied.map((file) => file.target) : undefined
          }
          return []
        })()
        if (files?.length === 0) return
        const input = {
          sessionID: event.sessionID,
          agent: event.agent,
          toolName: event.tool,
          source: { type: "tool" as const, messageID: event.messageID, id: event.id },
          files: files ?? [],
        }
        const referenced = files === undefined ? undefined : yield* references.check(input)
        const checked = files === undefined ? undefined : yield* verifier.verify(input)
        const reports =
          files === undefined
            ? ["[工具检查] 未检查：工具结果未提供可验证的变更文件。"]
            : [referenced ?? "", checked?.text ?? ""]
        const text = [
          ...reports,
          `[验证来源] verification.source=${JSON.stringify({ messageID: input.source.messageID, id: input.source.id })}`,
        ]
          .filter(Boolean)
          .join("\n")
        event.result = {
          ...event.result,
          ...(text
            ? { content: [...normalizeContent(event.result.content, event.result.output), { type: "text", text }] }
            : {}),
          metadata: {
            ...event.result.metadata,
            verification: Schema.encodeSync(Schema.toCodecJson(Verifier.Result))(
              checked?.result ??
                new Verifier.Result({
                  sessionID: input.sessionID,
                  toolName: input.toolName,
                  source: input.source,
                  status: "unchecked",
                  files: [],
                  packages: [],
                }),
            ),
          },
        }
      }),
    )
  }),
})
