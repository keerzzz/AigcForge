export * as MemoryTool from "./memory"

import { ToolFailure } from "@aigcfroge/llm"
import { Effect, Layer, Schema } from "effect"
import { MetaAgentMemory } from "../agent/meta/memory"
import { Location } from "../location"
import { Tool } from "./tool"
import { Tools } from "./tools"

const recordName = "memory_record"
const searchName = "memory_search"

export const RecordInput = Schema.Struct({
  fact_category: MetaAgentMemory.FactCategory.annotate({
    description: "The kind of fact being remembered: code_trap, protocol, api, or workflow",
  }),
  content: Schema.String.annotate({
    description:
      "One distilled fact (a few sentences). Stored verbatim for this project; other sessions of the same project can search it later.",
  }),
  source_session_id: Schema.String.pipe(Schema.optional).annotate({
    description: "Optional session that produced the fact",
  }),
  source_step_id: Schema.String.pipe(Schema.optional).annotate({
    description: "Optional meta agent step that produced the fact",
  }),
})

export const RecordOutput = Schema.Struct({
  id: Schema.String,
})

export const SearchInput = Schema.Struct({
  keyword: Schema.String.annotate({
    description: "Keyword to match against stored fact content (simple substring match)",
  }),
})

export const SearchOutput = Schema.Struct({
  records: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      fact_category: MetaAgentMemory.FactCategory,
      content: Schema.String,
      time_updated: Schema.Number,
    }),
  ),
})

const RECORD_DESCRIPTION = [
  "Persist one distilled fact into the project's cross-session memory for later retrieval.",
  "Only records for sessions that belong to a meta agent; other sessions are rejected.",
  "Do not dump raw tool output here - write a concise, reusable fact.",
].join(" ")

const SEARCH_DESCRIPTION = [
  "Search facts previously recorded with memory_record for this project.",
  "Returns matching facts ordered by update time; ranking is not semantic.",
].join(" ")

const failure = (error: unknown) =>
  new ToolFailure({
    message: error instanceof Error ? error.message : String(error),
  })

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const memory = yield* MetaAgentMemory.Service
    const location = yield* Location.Service

    yield* tools
      .register({
        [recordName]: Tool.make({
          description: RECORD_DESCRIPTION,
          input: RecordInput,
          output: RecordOutput,
          toModelOutput: ({ output }) => [{ type: "text", text: `Recorded memory fact ${output.id}` }],
          execute: (input, context) =>
            Effect.gen(function* () {
              const id = yield* memory
                .record({
                  sessionID: context.sessionID,
                  projectID: location.project.id,
                  factCategory: input.fact_category,
                  content: input.content,
                  sourceSessionID: input.source_session_id,
                  sourceStepID: input.source_step_id,
                })
                .pipe(Effect.mapError(failure))
              return { id }
            }),
        }),
        [searchName]: Tool.make({
          description: SEARCH_DESCRIPTION,
          input: SearchInput,
          output: SearchOutput,
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text:
                output.records.length === 0
                  ? "No matching memory facts."
                  : output.records
                      .map((record) => `[${record.fact_category}] ${record.content}`)
                      .join("\n"),
            },
          ],
          execute: (input) =>
            Effect.gen(function* () {
              const records = yield* memory
                .search({
                  projectID: location.project.id,
                  keyword: input.keyword,
                })
                .pipe(Effect.mapError(failure))
              return {
                records: records.map((record) => ({
                  id: record.id,
                  fact_category: record.factCategory,
                  content: record.content,
                  time_updated: record.timeUpdated,
                })),
              }
            }),
        }),
      })
      .pipe(Effect.orDie)
  }),
)
