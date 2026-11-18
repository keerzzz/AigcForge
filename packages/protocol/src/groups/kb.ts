import { KBNote } from "@aigcfroge/schema/kb-note"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { InvalidRequestError } from "../errors.js"
import { Authorization } from "../middleware/authorization.js"
import { InstanceContext, WorkspaceRouting } from "../middleware/workspace-routing.js"
import { described } from "./metadata.js"

// Fork-retained instance-scoped surface (see prompt-asset.ts for the conventions).
const root = "/kb"

// Matches the session group's pagination bound: negative limits must not reach
// SQLite (LIMIT -1 is unbounded and would list the whole table).
const NonNegativeLimit = Schema.optional(
  Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
)

export const KBGroup = HttpApiGroup.make("kb")
  .add(
    HttpApiEndpoint.get("kb.list", root, {
      query: Schema.Struct({
        scope: Schema.optional(KBNote.NoteScope),
        limit: NonNegativeLimit,
      }),
      success: described(Schema.Array(KBNote.Note), "Knowledge base notes"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "kb.list",
        summary: "List knowledge base notes",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("kb.get", `${root}/:id`, {
      params: Schema.Struct({ id: KBNote.NoteID }),
      error: InvalidRequestError,
      success: described(KBNote.Note, "A knowledge base note"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "kb.get",
        summary: "Read a knowledge base note",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("kb.create", root, {
      payload: Schema.Struct({
        title: KBNote.Title,
        content: Schema.String,
        scope: KBNote.NoteScope,
        tags: Schema.optional(Schema.Array(Schema.String)),
        aliases: Schema.optional(Schema.Array(Schema.String)),
        format: Schema.optional(KBNote.NoteFormat),
      }),
      success: described(KBNote.Note, "The created note"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "kb.create",
        summary: "Create a knowledge base note",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("kb.update", `${root}/:id`, {
      params: Schema.Struct({ id: KBNote.NoteID }),
      error: InvalidRequestError,
      payload: Schema.Struct({
        title: Schema.optional(KBNote.Title),
        content: Schema.optional(Schema.String),
        tags: Schema.optional(Schema.Array(Schema.String)),
        aliases: Schema.optional(Schema.Array(Schema.String)),
      }),
      success: described(KBNote.Note, "The updated note"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "kb.update",
        summary: "Update a knowledge base note",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("kb.remove", `${root}/:id/remove`, {
      params: Schema.Struct({ id: KBNote.NoteID }),
      error: InvalidRequestError,
      success: described(Schema.Void, "The removed note"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "kb.remove",
        summary: "Remove a knowledge base note",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("kb.backlinks", `${root}/:id/backlinks`, {
      params: Schema.Struct({ id: KBNote.NoteID }),
      error: InvalidRequestError,
      success: described(Schema.Array(KBNote.Note), "Notes that link to the given note"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "kb.backlinks",
        summary: "List backlinks of a note",
        description: "Notes whose [[wikilinks]] resolve to the given note (single-sided + derived).",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("kb.dangling", `${root}/dangling`, {
      success: described(Schema.Array(KBNote.DanglingLink), "Dangling wikilinks"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "kb.dangling",
        summary: "List dangling wikilinks",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("kb.search", `${root}/search`, {
      query: Schema.Struct({
        query: Schema.String,
        scope: Schema.optional(KBNote.NoteScope),
        limit: NonNegativeLimit,
      }),
      success: described(Schema.Array(KBNote.Note), "Matching notes"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "kb.search",
        summary: "Full-text search",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "kb",
      description: "Local knowledge base (assistant mode).",
    }),
  )
  .middleware(InstanceContext)
  .middleware(WorkspaceRouting)
  .middleware(Authorization)
