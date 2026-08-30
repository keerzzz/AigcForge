export * as ProposeNoteTool from "./propose-note"

import { ToolFailure } from "@aigcfroge/llm"
import { Cause, Effect, Layer, Schema } from "effect"
import { KBNote } from "@aigcfroge/schema/kb-note"
import { KBService } from "../session/kb-service"
import { KBLink } from "../kb/link"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import { Tools } from "./tools"

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

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const kb = yield* KBService.Service
    const permission = yield* PermissionV2.Service

    const tool = Tool.make({
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
            source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
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
                  title: input.title,
                  scope,
                  format,
                  exists: nameConflict,
                  nameConflict,
                  danglingLinks,
                }
              }).pipe(
                Effect.catchCause((cause) =>
                  Effect.fail(new ToolFailure({ message: `propose_note failed: ${Cause.pretty(cause)}` })),
                ),
              ),
            ),
          ),
      toModelOutput: ({ output }) => [
        {
          type: "text" as const,
          text: output.nameConflict
            ? `A note titled "${output.title}" already exists in scope ${output.scope}. Ask the user whether to update it or choose a different title.`
            : `Note candidate "${output.title}" is ready for review.` +
              (output.danglingLinks.length > 0 ? ` Dangling links: ${output.danglingLinks.join(", ")}.` : "") +
              " Tell the user to review it; nothing is saved until they confirm.",
        },
      ],
    })

    yield* tools.register({ [name]: tool }).pipe(Effect.catch((err) => Effect.die(err)))
  }),
)
