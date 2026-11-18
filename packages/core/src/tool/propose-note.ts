export * as ProposeNoteTool from "./propose-note.js"

import type { Context } from "@aigcfroge/plugin/effect/plugin"
import { ToolFailure } from "@aigcfroge/ai"
import { Effect, Schema } from "effect"
import { KBNote } from "@aigcfroge/schema/kb-note"
import { KBLink } from "../kb/link.js"
import { Permission } from "../permission.js"
import { KBService } from "../session/kb-service.js"

export const name = "propose_note"

export const description = `Propose a knowledge base note candidate for the user to review.

The candidate is NOT saved — it lands in a pending review state; the user
confirms, edits, or rejects it before anything is written.

Call this when the user asks to save knowledge, take notes, summarize a
conversation into the knowledge base, or build an FAQ/timeline from material.

Input:
- title: unique title within the scope ([[links]] match by title)
- content: Markdown body, may contain [[wikilinks]]
- tags (optional): hierarchical tag array
- scope (optional): "global" (default) or "project"
- format (optional): note (default) | summary | faq | timeline`

export const Input = Schema.Struct({
  title: Schema.String,
  content: Schema.String,
  tags: Schema.optional(Schema.Array(Schema.String)),
  scope: Schema.optional(KBNote.NoteScope),
  format: Schema.optional(KBNote.NoteFormat),
})

export const Output = Schema.Struct({
  title: Schema.String,
  scope: KBNote.NoteScope,
  format: KBNote.NoteFormat,
  exists: Schema.Boolean,
  nameConflict: Schema.Boolean,
  danglingLinks: Schema.Array(Schema.String),
})

export const Plugin = {
  id: "aigcfroge.tool.propose_note",
  effect: Effect.fn("ProposeNoteTool.Plugin")(function* (ctx: Context) {
    const kb = yield* KBService.Service
    const permission = yield* Permission.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            permission
              .assert({
                action: name,
                resources: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool" as const, messageID: context.messageID, id: context.id },
              })
              .pipe(
                Effect.mapError(() => new ToolFailure({ message: "Permission denied: propose_note" })),
                Effect.andThen(
                  Effect.gen(function* () {
                    const scope = input.scope ?? "global"
                    const format = input.format ?? "note"
                    // Name conflict: the scope's unique-title invariant.
                    const existing = yield* kb.list({ scope })
                    const nameConflict = existing.some((note) => note.title === input.title)
                    // Dangling links: mechanical check against the current index.
                    const titles = KBLink.extractWikilinks(input.content)
                    const known = new Set(existing.map((note) => note.title))
                    const danglingLinks = KBLink.detectDangling(titles, known)
                    return {
                      output: {
                        title: input.title,
                        scope,
                        format,
                        exists: nameConflict,
                        nameConflict,
                        danglingLinks,
                      },
                      content: nameConflict
                        ? `A note titled "${input.title}" already exists in scope ${scope}. Ask the user whether to update it or choose a different title.`
                        : `Note candidate "${input.title}" is ready for review.` +
                          (danglingLinks.length > 0 ? ` Dangling links: ${danglingLinks.join(", ")}.` : "") +
                          " Tell the user to review it; nothing is saved until they confirm.",
                    }
                  }),
                ),
              ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
