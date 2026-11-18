export * as LLM from "./llm.js"

import { Schema } from "effect"

export const FinishReason = Schema.Literals(["stop", "length", "tool-calls", "content-filter", "error", "unknown"])
export type FinishReason = typeof FinishReason.Type

/** Fork-retained wire type (ADR-25 era): provider metadata map carried on messages. */
export const ProviderMetadata = Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))
export type ProviderMetadata = Schema.Schema.Type<typeof ProviderMetadata>

/** Fork-retained tool content union (ADR-25 era), consumed by the v2 message contracts. */
export interface ToolTextContent extends Schema.Schema.Type<typeof ToolTextContent> {}
export const ToolTextContent = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
}).annotate({ identifier: "Tool.TextContent" })

export interface ToolFileContent extends Schema.Schema.Type<typeof ToolFileContent> {}
export const ToolFileContent = Schema.Struct({
  type: Schema.Literal("file"),
  uri: Schema.String,
  mime: Schema.String,
  name: Schema.optional(Schema.String),
}).annotate({ identifier: "Tool.FileContent" })

export const ToolContent = Schema.Union([ToolTextContent, ToolFileContent]).pipe(Schema.toTaggedUnion("type"))
export type ToolContent = Schema.Schema.Type<typeof ToolContent>
