export * as MemoryTool from "./memory.js"

import type { Context } from "@aigcfroge/plugin/effect/plugin"
import { ToolFailure } from "@aigcfroge/ai"
import { Effect, Schema } from "effect"
import { MetaAgentMemory } from "../agent/meta/memory.js"
import { Location } from "../location.js"
import { Permission } from "../permission.js"
import type { Tool } from "../tool.js"

const recordName = "memory_record"
const searchName = "memory_search"
const queryName = "memory_query"
const deleteName = "memory_delete"

export const RecordInput = Schema.Struct({
  fact_category: MetaAgentMemory.FactCategory.annotate({
    description: "The kind of fact being remembered: code_trap, protocol, api, or workflow",
  }),
  content: MetaAgentMemory.Content.annotate({
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

function results(records: ReadonlyArray<MetaAgentMemory.MemoryRecord>, identify = false) {
  const invalid = records.map(MetaAgentMemory.invalidForModel).find((error) => error !== undefined)
  if (invalid) return invalid
  return {
    output: {
      records: records.map((record) => ({
        id: record.id,
        fact_category: record.factCategory,
        content: record.content,
        time_updated: record.timeUpdated,
      })),
    },
    content:
      records.length === 0
        ? "No matching memory facts."
        : records
            .map((record) => `[${record.factCategory}] ${identify ? `${record.id}: ` : ""}${record.content}`)
            .join("\n"),
  }
}

export const Plugin = {
  id: "aigcfroge.tool.memory",
  effect: Effect.fn("MemoryTool.Plugin")(function* (ctx: Context) {
    const memory = yield* MetaAgentMemory.Service
    const location = yield* Location.Service
    const permission = yield* Permission.Service
    const authorize = (action: string, context: Tool.Context) =>
      permission
        .assert({
          action,
          resources: [location.project.id],
          sessionID: context.sessionID,
          agent: context.agent,
          source: { type: "tool", messageID: context.messageID, id: context.id },
        })
        .pipe(Effect.mapError(failure))

    yield* ctx.tool
      .transform((editor) => {
        editor.add({
          name: recordName,
          options: { codemode: false },
          description: RECORD_DESCRIPTION,
          input: RecordInput,
          output: RecordOutput,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* authorize(recordName, context)
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
              return { output: { id }, content: `Recorded memory fact ${id}` }
            }),
        })

        editor.add({
          name: searchName,
          options: { codemode: false },
          description: SEARCH_DESCRIPTION,
          input: SearchInput,
          output: SearchOutput,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* authorize(searchName, context)
              const records = yield* memory
                .search({
                  projectID: location.project.id,
                  keyword: input.keyword,
                })
                .pipe(Effect.mapError(failure))
              const result = results(records)
              if (result instanceof MetaAgentMemory.InvalidFactError) return yield* failure(result)
              return result
            }),
        })

        editor.add({
          name: queryName,
          options: { codemode: false },
          description:
            "List distilled memory facts for this project, optionally filtered by category, ordered by update time.",
          input: Schema.Struct({ fact_category: Schema.optional(MetaAgentMemory.FactCategory) }),
          output: SearchOutput,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* authorize(queryName, context)
              const records = yield* memory
                .query({ projectID: location.project.id, factCategory: input.fact_category })
                .pipe(Effect.mapError(failure))
              const result = results(records, true)
              if (result instanceof MetaAgentMemory.InvalidFactError) return yield* failure(result)
              return result
            }),
        })

        editor.add({
          name: deleteName,
          options: { codemode: false },
          description:
            "Delete a memory fact from this project. Missing or other-project IDs are unchanged. The returned ID acknowledges the request; copies in prior conversation history remain.",
          input: RecordOutput,
          output: RecordOutput,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* authorize(deleteName, context)
              yield* memory.remove(input.id, location.project.id).pipe(Effect.mapError(failure))
              return { output: { id: input.id }, content: "Processed the memory deletion request for this project." }
            }),
        })
      })
      .pipe(Effect.orDie)
  }),
}
