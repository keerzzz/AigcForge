export * as WorkPreset from "./work-preset"

import { Schema } from "effect"

export const Category = Schema.Literals(["it-development", "video-creation", "academic", "general-office"]).annotate({
  identifier: "WorkPreset.Category",
})
export type Category = typeof Category.Type

export const OutputType = Schema.Literals(["markdown", "table", "mixed"]).annotate({
  identifier: "WorkPreset.OutputType",
})
export type OutputType = typeof OutputType.Type

export const Question = Schema.Struct({
  key: Schema.String,
  prompt: Schema.String,
  required: Schema.Boolean,
  options: Schema.optional(Schema.Array(Schema.String)),
}).annotate({ identifier: "WorkPreset.Question" })
export type Question = typeof Question.Type

export const ArtifactSpec = Schema.Struct({
  title: Schema.String,
  filename: Schema.String,
  relativeDir: Schema.optional(Schema.String),
}).annotate({ identifier: "WorkPreset.ArtifactSpec" })
export type ArtifactSpec = typeof ArtifactSpec.Type

export const Preset = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  category: Category,
  description: Schema.String,
  guided: Schema.Boolean,
  guidance: Schema.String,
  questions: Schema.Array(Question),
  outputType: OutputType,
  artifact: ArtifactSpec,
}).annotate({ identifier: "WorkPreset.Preset" })
export type Preset = typeof Preset.Type
