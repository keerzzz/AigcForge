export * as KBHandlers from "./kb"

import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { KBNote } from "@aigcfroge/schema/kb-note"
import { KBService } from "@aigcfroge/core/session/kb-service"
import { Global } from "@aigcfroge/core/global"
import { InstanceHttpApi } from "../api"
import { InvalidRequestError } from "../errors"

export const kbHandlers = HttpApiBuilder.group(InstanceHttpApi, "kb", (handlers) =>
  Effect.gen(function* () {
    const kb = yield* KBService.Service

    const list = Effect.fn("KBHttpApi.list")(function* (ctx: { query: { scope?: KBNote.NoteScope; limit?: number } }) {
      return yield* kb.list({ scope: ctx.query.scope, limit: ctx.query.limit ?? 100 })
    })

    const get = Effect.fn("KBHttpApi.get")(function* (ctx: { params: { id: string } }) {
      const note = yield* kb.get(ctx.params.id as KBNote.NoteID)
      if (!note) return yield* Effect.fail(new InvalidRequestError({ message: `Note ${ctx.params.id} not found` }))
      return note
    })

    const create = Effect.fn("KBHttpApi.create")(function* (ctx: {
      payload: {
        readonly title: string
        readonly content: string
        readonly scope: KBNote.NoteScope
        readonly tags?: readonly string[]
        readonly aliases?: readonly string[]
        readonly format?: KBNote.NoteFormat
      }
    }) {
      const created = yield* kb.create({
        title: ctx.payload.title,
        content: ctx.payload.content,
        scope: ctx.payload.scope,
        tags: ctx.payload.tags ?? [],
        ...(ctx.payload.aliases ? { aliases: ctx.payload.aliases } : {}),
        ...(ctx.payload.format ? { format: ctx.payload.format } : {}),
        baseDir: ctx.payload.scope === "global" ? Global.Path.config : undefined,
      })
      return created
    })

    const update = Effect.fn("KBHttpApi.update")(function* (ctx: {
      params: { id: string }
      payload: { readonly title?: string; readonly content?: string; readonly tags?: readonly string[]; readonly aliases?: readonly string[] }
    }) {
      const updated = yield* kb.update({
        id: ctx.params.id as KBNote.NoteID,
        ...(ctx.payload.title !== undefined ? { title: ctx.payload.title } : {}),
        ...(ctx.payload.content !== undefined ? { content: ctx.payload.content } : {}),
        ...(ctx.payload.tags !== undefined ? { tags: ctx.payload.tags } : {}),
        ...(ctx.payload.aliases !== undefined ? { aliases: ctx.payload.aliases } : {}),
      })
      if (!updated) return yield* Effect.fail(new InvalidRequestError({ message: `Note ${ctx.params.id} not found` }))
      return updated
    })

    const remove = Effect.fn("KBHttpApi.remove")(function* (ctx: { params: { id: string } }) {
      yield* kb.remove(ctx.params.id as KBNote.NoteID)
    })

    const dangling = Effect.fn("KBHttpApi.dangling")(function* () {
      return yield* kb.listDangling()
    })

    const search = Effect.fn("KBHttpApi.search")(function* (ctx: {
      query: { readonly query: string; readonly scope?: KBNote.NoteScope; readonly limit?: number }
    }) {
      return yield* kb.search(ctx.query.query, { scope: ctx.query.scope, limit: ctx.query.limit ?? 20 })
    })

    return handlers
      .handle("list", list)
      .handle("get", get)
      .handle("create", create)
      .handle("update", update)
      .handle("remove", remove)
      .handle("dangling", dangling)
      .handle("search", search)
  }),
)
