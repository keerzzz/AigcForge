export * as KBTools from "./kb-tools.js"

import type { Context } from "@aigcfroge/plugin/effect/plugin"
import { ToolFailure } from "@aigcfroge/ai"
import { Effect, Schema } from "effect"
import { KBNote } from "@aigcfroge/schema/kb-note"
import { Global } from "@aigcfroge/util/global"
import { Location } from "../location.js"
import { Permission } from "../permission.js"
import { KBService } from "../session/kb-service.js"
import { Tool } from "../tool.js"

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
  title: KBNote.Title,
  content: Schema.String,
  scope: KBNote.NoteScope,
  tags: Schema.optional(Schema.Array(Schema.String)),
  aliases: Schema.optional(Schema.Array(Schema.String)),
  format: Schema.optional(KBNote.NoteFormat),
})

export const Plugin = {
  id: "aigcfroge.tool.kb_tools",
  effect: Effect.fn("KBTools.Plugin")(function* (ctx: Context) {
    const kb = yield* KBService.Service
    const location = yield* Location.Service
    const permission = yield* Permission.Service

    // Runtime permission gate (review BLOCKER #1): every tool self-asserts its
    // action so the configured agent ruleset (assistant whitelist / meta write
    // convergence) is enforced per invocation — matching question/webfetch.
    const assertTool = (action: string, context: Tool.Context) =>
      permission
        .assert({
          action,
          resources: ["*"],
          sessionID: context.sessionID,
          agent: context.agent,
          source: { type: "tool" as const, messageID: context.messageID, id: context.id },
        })
        .pipe(Effect.mapError(() => new ToolFailure({ message: `Permission denied: ${action}` })))

    yield* ctx.tool
      .transform((editor) => {
        editor.add({
          name: kbCreateName,
          options: { codemode: false },
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
          execute: (input, context) =>
            assertTool(kbCreateName, context).pipe(
              Effect.andThen(
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
                  const danglingLinks = links.filter((l) => l.dangling).map((l) => l.targetTitle)
                  return {
                    output: {
                      id: created.id,
                      title: created.title,
                      scope: created.scope,
                      danglingLinks,
                    },
                    content:
                      danglingLinks.length > 0
                        ? `Note "${created.title}" created. Dangling links: ${danglingLinks.join(", ")}.`
                        : `Note "${created.title}" created.`,
                  }
                }),
              ),
            ),
        })

        editor.add({
          name: kbSearchName,
          options: { codemode: false },
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
          execute: (input, context) =>
            assertTool(kbSearchName, context).pipe(
              Effect.andThen(
                Effect.gen(function* () {
                  const notes = yield* kb.search(input.query, { scope: input.scope, limit: 8 })
                  const results = notes.map((note) => ({
                    id: note.id,
                    title: note.title,
                    preview: note.content.slice(0, 200),
                  }))
                  return {
                    output: { results },
                    content:
                      results.length === 0
                        ? "No matching notes in the knowledge base."
                        : results.map((r) => `- ${r.title} (${r.id}): ${r.preview}`).join("\n"),
                  }
                }),
              ),
            ),
        })

        editor.add({
          name: kbReadName,
          options: { codemode: false },
          description: `Read a knowledge base note by its id.`,
          input: Schema.Struct({ id: KBNote.NoteID }),
          output: Schema.Struct({
            title: Schema.String,
            content: Schema.String,
            tags: Schema.Array(Schema.String),
            format: KBNote.NoteFormat,
          }),
          execute: (input, context) =>
            assertTool(kbReadName, context).pipe(
              Effect.andThen(
                Effect.gen(function* () {
                  const note = yield* kb.get(input.id)
                  if (!note) return yield* Effect.fail(new ToolFailure({ message: `Note ${input.id} not found` }))
                  return {
                    output: { title: note.title, content: note.content, tags: note.tags, format: note.format },
                    content: `# ${note.title}\n\n${note.content}\n\nTags: ${note.tags.join(", ") || "-"}`,
                  }
                }),
              ),
            ),
        })

        editor.add({
          name: kbUpdateName,
          options: { codemode: false },
          description: `Update a knowledge base note (content/title/tags/aliases). Links are re-indexed.`,
          input: Schema.Struct({
            id: KBNote.NoteID,
            title: Schema.optional(KBNote.Title),
            content: Schema.optional(Schema.String),
            tags: Schema.optional(Schema.Array(Schema.String)),
            aliases: Schema.optional(Schema.Array(Schema.String)),
          }),
          output: Schema.Struct({ id: Schema.String, updated: Schema.Boolean }),
          execute: (input, context) =>
            assertTool(kbUpdateName, context).pipe(
              Effect.andThen(
                Effect.gen(function* () {
                  // The mirror directory follows the note's own scope (review fix):
                  // unconditional Global.Path.config wrote project-note mirrors into
                  // the config dir and left the real project file stale.
                  const prior = yield* kb.get(input.id)
                  if (!prior)
                    return { output: { id: input.id, updated: false }, content: `Note ${input.id} not found.` }
                  const updated = yield* kb.update({
                    id: input.id,
                    ...(input.title !== undefined ? { title: input.title } : {}),
                    ...(input.content !== undefined ? { content: input.content } : {}),
                    ...(input.tags !== undefined ? { tags: input.tags } : {}),
                    ...(input.aliases !== undefined ? { aliases: input.aliases } : {}),
                    baseDir: prior.scope === "global" ? Global.Path.config : location.directory,
                  })
                  const changed = updated !== undefined
                  return {
                    output: { id: input.id, updated: changed },
                    content: changed ? `Note ${input.id} updated.` : `Note ${input.id} not found.`,
                  }
                }),
              ),
            ),
        })

        editor.add({
          name: kbDeleteName,
          options: { codemode: false },
          description: `Delete a knowledge base note. Its outgoing links are removed; incoming
links pointing at it become dangling.`,
          input: Schema.Struct({ id: KBNote.NoteID }),
          output: Schema.Struct({ id: Schema.String, deleted: Schema.Boolean }),
          execute: (input, context) =>
            assertTool(kbDeleteName, context).pipe(
              Effect.andThen(
                Effect.gen(function* () {
                  const prior = yield* kb.get(input.id)
                  if (!prior)
                    return { output: { id: input.id, deleted: false }, content: `Note ${input.id} not found.` }
                  yield* kb.remove({
                    id: prior.id,
                    baseDir: prior.scope === "global" ? Global.Path.config : location.directory,
                  })
                  return { output: { id: input.id, deleted: true }, content: `Note ${input.id} deleted.` }
                }),
              ),
            ),
        })

        editor.add({
          name: kbListDanglingName,
          options: { codemode: false },
          description: `List dangling wikilinks: [[titles]] that reference notes which do not exist yet.`,
          input: Schema.Struct({}),
          output: Schema.Struct({
            dangling: Schema.Array(Schema.Struct({ sourceTitle: Schema.String, targetTitle: Schema.String })),
          }),
          execute: (_input, context) =>
            assertTool(kbListDanglingName, context).pipe(
              Effect.andThen(
                Effect.gen(function* () {
                  const dangling = yield* kb.listDangling()
                  const rows = dangling.map((d) => ({ sourceTitle: d.sourceTitle, targetTitle: d.targetTitle }))
                  return {
                    output: { dangling: rows },
                    content:
                      rows.length === 0
                        ? "No dangling links."
                        : rows.map((d) => `- ${d.sourceTitle} → [[${d.targetTitle}]]`).join("\n"),
                  }
                }),
              ),
            ),
        })
      })
      .pipe(Effect.orDie)
  }),
}
