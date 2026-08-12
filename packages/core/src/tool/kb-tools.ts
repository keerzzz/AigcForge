export * as KBTools from "./kb-tools"

import { ToolFailure } from "@aigcfroge/llm"
import { Effect, Layer, Schema } from "effect"
import { KBNote } from "@aigcfroge/schema/kb-note"
import { Global } from "../global"
import { Location } from "../location"
import { KBService } from "../session/kb-service"
import { Tool } from "./tool"
import { Tools } from "./tools"

/**
 * Knowledge base tools (Phase D): create/search/read/update/delete/
 * list_dangling. The `.md` file mirror lands in <config>/knowledge-base
 * (global scope) or <directory>/.aigcfroge/knowledge-base (project scope).
 */

export const kbCreateName = "kb_create"
export const kbSearchName = "kb_search"
export const kbReadName = "kb_read"
export const kbUpdateName = "kb_update"
export const kbDeleteName = "kb_delete"
export const kbListDanglingName = "kb_list_dangling"

const NoteInput = Schema.Struct({
  title: Schema.String,
  content: Schema.String,
  scope: KBNote.NoteScope,
  tags: Schema.optional(Schema.Array(Schema.String)),
  aliases: Schema.optional(Schema.Array(Schema.String)),
  format: Schema.optional(KBNote.NoteFormat),
})

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const kb = yield* KBService.Service
    const location = yield* Location.Service

    const createTool = Tool.make({
      description: `Create a knowledge base note. The note is stored in the knowledge base,
its [[wikilinks]] are indexed, and a matching .md file is written (Obsidian-compatible).
Call this only after the user confirmed the note title and content.

Input:
- title: unique title within the scope ([[links]] match by title)
- content: Markdown body, may contain [[wikilinks]]
- scope: "global" (user-level) or "project" (current project)
- tags (optional): hierarchical tag array (e.g. ["work", "work/project-a"])
- aliases (optional): alternate titles [[aliases]] can link to
- format (optional): note (default) | summary | faq | timeline`,
      input: NoteInput,
      output: Schema.Struct({
        id: Schema.String,
        title: Schema.String,
        scope: KBNote.NoteScope,
        danglingLinks: Schema.Array(Schema.String),
      }),
      execute: (input) =>
        Effect.gen(function* () {
          const created = yield* kb.create({
            title: input.title,
            content: input.content,
            scope: input.scope,
            tags: input.tags ?? [],
            ...(input.aliases ? { aliases: input.aliases } : {}),
            ...(input.format ? { format: input.format } : {}),
            baseDir: input.scope === "global" ? Global.Path.config : location.directory,
          })
          const links = yield* kb.linksFrom(created.id)
          return {
            id: created.id,
            title: created.title,
            scope: created.scope,
            danglingLinks: links.filter((l) => l.dangling).map((l) => l.targetTitle),
          }
        }).pipe(
          Effect.catch((err) => Effect.fail(new ToolFailure({ message: `kb_create failed: ${(err as Error).message}` }))),
        ),
      toModelOutput: ({ output }) => [
        {
          type: "text" as const,
          text:
            output.danglingLinks.length > 0
              ? `Note "${output.title}" created. Dangling links: ${output.danglingLinks.join(", ")}.`
              : `Note "${output.title}" created.`,
        },
      ],
    })

    const searchTool = Tool.make({
      description: `Search the knowledge base. FTS5 word search for Latin, exact substring
fallback for Chinese phrases.`,
      input: Schema.Struct({
        query: Schema.String,
        scope: Schema.optional(KBNote.NoteScope),
      }),
      output: Schema.Struct({
        results: Schema.Array(
          Schema.Struct({
            id: Schema.String,
            title: Schema.String,
            preview: Schema.String,
          }),
        ),
      }),
      execute: (input) =>
        Effect.gen(function* () {
          const notes = yield* kb.search(input.query, { scope: input.scope, limit: 8 })
          return {
            results: notes.map((note) => ({
              id: note.id,
              title: note.title,
              preview: note.content.slice(0, 200),
            })),
          }
        }).pipe(
          Effect.catch((err) => Effect.fail(new ToolFailure({ message: `kb_search failed: ${(err as Error).message}` }))),
        ),
      toModelOutput: ({ output }) => [
        {
          type: "text" as const,
          text:
            output.results.length === 0
              ? "No matching notes in the knowledge base."
              : output.results.map((r) => `- ${r.title} (${r.id}): ${r.preview}`).join("\n"),
        },
      ],
    })

    const readTool = Tool.make({
      description: `Read a knowledge base note by its id.`,
      input: Schema.Struct({ id: Schema.String }),
      output: Schema.Struct({
        title: Schema.String,
        content: Schema.String,
        tags: Schema.Array(Schema.String),
        format: KBNote.NoteFormat,
      }),
      execute: (input) =>
        Effect.gen(function* () {
          const note = yield* kb.get(input.id as KBNote.NoteID)
          if (!note) return yield* Effect.fail(new ToolFailure({ message: `Note ${input.id} not found` }))
          return { title: note.title, content: note.content, tags: note.tags, format: note.format }
        }),
      toModelOutput: ({ output }) => [
        {
          type: "text" as const,
          text: `# ${output.title}\n\n${output.content}\n\nTags: ${output.tags.join(", ") || "-"}`,
        },
      ],
    })

    const updateTool = Tool.make({
      description: `Update a knowledge base note (content/title/tags/aliases). Links are re-indexed.`,
      input: Schema.Struct({
        id: Schema.String,
        title: Schema.optional(Schema.String),
        content: Schema.optional(Schema.String),
        tags: Schema.optional(Schema.Array(Schema.String)),
        aliases: Schema.optional(Schema.Array(Schema.String)),
      }),
      output: Schema.Struct({ id: Schema.String, updated: Schema.Boolean }),
      execute: (input) =>
        Effect.gen(function* () {
          const updated = yield* kb.update({
            id: input.id as KBNote.NoteID,
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.content !== undefined ? { content: input.content } : {}),
            ...(input.tags !== undefined ? { tags: input.tags } : {}),
            ...(input.aliases !== undefined ? { aliases: input.aliases } : {}),
          })
          return { id: input.id, updated: updated !== undefined }
        }).pipe(
          Effect.catch((err) => Effect.fail(new ToolFailure({ message: `kb_update failed: ${(err as Error).message}` }))),
        ),
      toModelOutput: ({ output }) => [
        { type: "text" as const, text: output.updated ? `Note ${output.id} updated.` : `Note ${output.id} not found.` },
      ],
    })

    const deleteTool = Tool.make({
      description: `Delete a knowledge base note. Its outgoing links are removed; incoming
links pointing at it become dangling.`,
      input: Schema.Struct({ id: Schema.String }),
      output: Schema.Struct({ id: Schema.String, deleted: Schema.Boolean }),
      execute: (input) =>
        Effect.gen(function* () {
          const prior = yield* kb.get(input.id as KBNote.NoteID)
          if (!prior) return { id: input.id, deleted: false }
          yield* kb.remove(prior.id)
          return { id: input.id, deleted: true }
        }),
      toModelOutput: ({ output }) => [
        { type: "text" as const, text: output.deleted ? `Note ${output.id} deleted.` : `Note ${output.id} not found.` },
      ],
    })

    const listDanglingTool = Tool.make({
      description: `List dangling wikilinks: [[titles]] that reference notes which do not exist yet.`,
      input: Schema.Struct({}),
      output: Schema.Struct({
        dangling: Schema.Array(
          Schema.Struct({ sourceTitle: Schema.String, targetTitle: Schema.String }),
        ),
      }),
      execute: () =>
        Effect.gen(function* () {
          const dangling = yield* kb.listDangling()
          return { dangling: dangling.map((d) => ({ sourceTitle: d.sourceTitle, targetTitle: d.targetTitle })) }
        }),
      toModelOutput: ({ output }) => [
        {
          type: "text" as const,
          text:
            output.dangling.length === 0
              ? "No dangling links."
              : output.dangling.map((d) => `- ${d.sourceTitle} → [[${d.targetTitle}]]`).join("\n"),
        },
      ],
    })

    yield* tools.register({
      [kbCreateName]: createTool,
      [kbSearchName]: searchTool,
      [kbReadName]: readTool,
      [kbUpdateName]: updateTool,
      [kbDeleteName]: deleteTool,
      [kbListDanglingName]: listDanglingTool,
    })
  }),
)
