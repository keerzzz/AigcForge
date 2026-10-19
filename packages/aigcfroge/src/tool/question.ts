import { Effect } from "effect"
import { Location } from "@aigcfroge/core/location"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { QuestionV2 } from "@aigcfroge/core/question"
import { AbsolutePath } from "@aigcfroge/core/schema"
// Both runtime tool entrypoints are named QuestionTool; share the native contract.
import { QuestionTool as NativeQuestionTool } from "@aigcfroge/core/tool/question"
import { InstanceState } from "@/effect/instance-state"
import { EffectBridge } from "@/effect/bridge"
import { Tool } from "./tool"

export const Parameters = NativeQuestionTool.Input

type Metadata = {
  answers: ReadonlyArray<QuestionV2.Answer>
}

export const QuestionTool = Tool.define<typeof Parameters, Metadata, LocationServiceMap>(
  "question",
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap

    return {
      description: NativeQuestionTool.description,
      parameters: Parameters,
      formatValidationError: () =>
        [
          `Each question in the "questions" array must be an object with these fields:`,
          `- question (string, required): The question text`,
          `- header (string, required): A short label`,
          `- options (array, required): Choices shaped as { label: string, description: string }`,
          `- multiple (boolean, optional): Whether multiple selections are allowed`,
          `Please rebuild the entire "questions" array with valid objects.`,
        ].join("\n"),
      execute: (params: typeof Parameters.Type, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const location = Location.Ref.make({
            directory: AbsolutePath.make(yield* InstanceState.directory),
            workspaceID: yield* InstanceState.workspaceID,
          })
          const answers = yield* QuestionV2.Service.pipe(
            Effect.flatMap((question) =>
              question.ask({
                sessionID: ctx.sessionID,
                questions: params.questions,
                tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
              }),
            ),
            Effect.provide(locations.get(location)),
            EffectBridge.interruptOnSignal(ctx.abort),
          )

          return {
            title: `Asked ${params.questions.length} question${params.questions.length > 1 ? "s" : ""}`,
            output: NativeQuestionTool.toModelOutput(params.questions, answers),
            metadata: { answers },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
