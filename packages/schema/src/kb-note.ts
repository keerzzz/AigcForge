export * as KBNote from "./kb-note"

import { Schema } from "effect"
import { descending } from "./identifier"
import { withStatics } from "./schema"

/**
 * Knowledge base contracts (Assistant PRD §7.4, M2): Obsidian-compatible notes
 * with bidirectional links. The `.md` file is the content source of truth
 * (ADR-14 §2); SQLite holds the FTS5 index and the link edge truth (ADR-14 §3).
 * Backlinks are single-sided storage + index derivation — never double-written.
 */

export const NoteID = Schema.String.check(Schema.isStartsWith("kb_")).pipe(
  Schema.brand("KBNoteID"),
  withStatics((schema) => ({
    create: () => schema.make("kb_" + descending()),
  })),
)
export type NoteID = typeof NoteID.Type

/** note | summary | faq | timeline (study_guide/briefing/mindmap deferred). */
export const NoteFormat = Schema.Literals(["note", "summary", "faq", "timeline", "study_guide", "briefing", "mindmap"]).annotate({
  identifier: "KBNoteFormat",
})
export type NoteFormat = typeof NoteFormat.Type

export const NoteScope = Schema.Literals(["global", "project"]).annotate({ identifier: "KBNoteScope" })
export type NoteScope = typeof NoteScope.Type

export const LinkType = Schema.Literals(["reference", "supports", "contradicts", "derived_from"]).annotate({
  identifier: "KBLinkType",
})
export type LinkType = typeof LinkType.Type

export class Note extends Schema.Class<Note>("KBNote.Note")({
  id: NoteID,
  /** Unique within its scope — the [[link]] match key. */
  title: Schema.String,
  content: Schema.String.annotate({ description: "Markdown body (may contain [[wikilinks]])" }),
  scope: NoteScope,
  tags: Schema.Array(Schema.String),
  aliases: Schema.optional(Schema.Array(Schema.String)),
  format: NoteFormat,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}) {}

export class Link extends Schema.Class<Link>("KBNote.Link")({
  sourceNoteID: NoteID,
  /** Resolved target note, null when dangling. */
  targetNoteID: Schema.optional(NoteID),
  targetTitle: Schema.String.annotate({ description: "Target title, used for dangling detection" }),
  linkType: LinkType,
  dangling: Schema.Boolean,
}) {}

/** Dangling-link report: the unresolved [[title]] and where it is referenced from. */
export class DanglingLink extends Schema.Class<DanglingLink>("KBNote.DanglingLink")({
  sourceNoteID: NoteID,
  sourceTitle: Schema.String,
  targetTitle: Schema.String,
}) {}
