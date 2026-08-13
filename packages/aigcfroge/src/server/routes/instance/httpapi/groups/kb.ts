export * as KBApiGroup from "./kb"

import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { KBNote } from "@aigcfroge/schema/kb-note"
import { described } from "./metadata"
import { InvalidRequestError } from "../errors"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"

// Matches the session group's pagination bound: negative limits must not reach
// SQLite (LIMIT -1 is unbounded and would list the whole table).
const NonNegativeLimit = Schema.optional(
  Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
)

const root = "/kb"

export const KBApi = HttpApi.make("kb").add(
  HttpApiGroup.make("kb")
    .add(
      HttpApiEndpoint.get("list", root, {
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
      HttpApiEndpoint.get("get", `${root}/:id`, {
        params: Schema.Struct({ id: KBNote.NoteID }),
        error: InvalidRequestError,
        success: described(KBNote.Note, "A knowledge base note"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "kb.get",
          summary: "Read a knowledge base note",
        }),
      ),
      HttpApiEndpoint.post("create", root, {
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
      HttpApiEndpoint.post("update", `${root}/:id`, {
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
      HttpApiEndpoint.post("remove", `${root}/:id/remove`, {
        params: Schema.Struct({ id: KBNote.NoteID }),
        error: InvalidRequestError,
        success: described(Schema.Void, "The removed note"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "kb.remove",
          summary: "Remove a knowledge base note",
        }),
      ),
      HttpApiEndpoint.get("dangling", `${root}/dangling`, {
        success: described(Schema.Array(KBNote.DanglingLink), "Dangling wikilinks"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "kb.dangling",
          summary: "List dangling wikilinks",
        }),
      ),
      HttpApiEndpoint.get("search", `${root}/search`, {
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
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
