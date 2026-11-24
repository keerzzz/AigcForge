export * as WorkPresetTool from "./work-preset.js"

import type { Context } from "@omnixa/plugin/effect/plugin"
import { ToolFailure } from "@omnixa/ai"
import { Effect, Schema } from "effect"
import { WorkPreset } from "@omnixa/schema/work-preset"
import { WorkPresetRegistry } from "../session/work-preset.js"

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

const toModelContent = (preset: WorkPreset.Preset) => {
  const questions = preset.questions
    .map(
      (q) =>
        `- ${q.prompt}${q.options?.length ? ` (options: ${q.options.join(", ")})` : ""}${q.required ? " [required]" : ""}`,
    )
    .join("\n")
  return `Preset "${preset.title}" loaded.\n\nGuidance:\n${preset.guidance}\n\nClarifying questions:\n${questions}\n\nAsk the user these questions one batch at a time (max 5), then produce the document as your message.`
}

export const Plugin = {
  id: "omnixa.tool.work-preset",
  effect: Effect.fn("WorkPresetTool.Plugin")(function* (ctx: Context) {
    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input) =>
            Effect.gen(function* () {
              const preset = WorkPresetRegistry.byId(input.presetID)
              if (!preset)
                return yield* Effect.fail(new ToolFailure({ message: `Unknown work preset: ${input.presetID}` }))
              return { output: { preset }, content: toModelContent(preset) }
            }),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
