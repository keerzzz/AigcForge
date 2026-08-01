export * as WorkPresetTool from "./work-preset"

import { ToolFailure } from "@aigcfroge/llm"
import { Effect, Layer, Schema } from "effect"
import { WorkPreset } from "@aigcfroge/schema/work-preset"
import { WorkPresetRegistry } from "../session/work-preset"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "work-preset"

export const description = `Load the guidance and clarifying questions for an official Work preset by id.

Call this tool at the start of a Work session to load the preset's guidance (injected as system guidance), the clarifying questions to ask the user, and the target artifact spec. The preset id comes from the official preset catalog shown in Work mode.

Usage:
- \`presetID\`: The preset id from the Work preset catalog, e.g. "storyboard-video".`

export const Input = Schema.Struct({
  presetID: Schema.String,
})

export const Output = Schema.Struct({
  preset: WorkPreset.Preset,
})

export const toModelOutput = ({ output }: { output: { preset: WorkPreset.Preset } }) => {
  const questions = output.preset.questions
    .map((q) => `- ${q.prompt}${q.options?.length ? ` (options: ${q.options.join(", ")})` : ""}${q.required ? " [required]" : ""}`)
    .join("\n")
  return [
    {
      type: "text" as const,
      text: `Preset "${output.preset.title}" loaded.\n\nGuidance:\n${output.preset.guidance}\n\nClarifying questions:\n${questions}\n\nAsk the user these questions one batch at a time (max 5), then produce the document as your message.`,
    },
  ]
}

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description,
          input: Input,
          output: Output,
          toModelOutput,
          execute: (input) =>
            Effect.gen(function* () {
              const preset = WorkPresetRegistry.byId(input.presetID)
              if (!preset) return yield* Effect.fail(new ToolFailure({ message: `Unknown work preset: ${input.presetID}` }))
              return { preset }
            }),
        }),
      })
      .pipe(Effect.orDie)
  }),
)
