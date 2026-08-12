export * as MemoryHandlers from "./memory"

import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { PersonalMemory as PersonalMemorySchema } from "@aigcfroge/schema/personal-memory"
import { PersonalMemory } from "@aigcfroge/core/session/personal-memory"
import { InstanceHttpApi } from "../api"
import { InvalidRequestError } from "../errors"

export const memoryHandlers = HttpApiBuilder.group(InstanceHttpApi, "memory", (handlers) =>
  Effect.gen(function* () {
    const memories = yield* PersonalMemory.Service

    const list = Effect.fn("MemoryHttpApi.list")(function* () {
      return yield* memories.list()
    })

    const pending = Effect.fn("MemoryHttpApi.pending")(function* () {
      return yield* memories.listPending()
    })

    const confirm = Effect.fn("MemoryHttpApi.confirm")(function* (ctx: { params: { id: string } }) {
      const confirmed = yield* memories.confirm(ctx.params.id as PersonalMemorySchema.ID)
      if (!confirmed) {
        return yield* Effect.fail(
          new InvalidRequestError({ message: `Memory ${ctx.params.id} not found or not pending` }),
        )
      }
      return confirmed
    })

    const reject = Effect.fn("MemoryHttpApi.reject")(function* (ctx: { params: { id: string } }) {
      const rejected = yield* memories.reject(ctx.params.id as PersonalMemorySchema.ID)
      if (!rejected) {
        return yield* Effect.fail(
          new InvalidRequestError({ message: `Memory ${ctx.params.id} not found or not pending` }),
        )
      }
      return rejected
    })

    const edit = Effect.fn("MemoryHttpApi.edit")(function* (ctx: {
      params: { id: string }
      payload: { content?: string; trustLevel?: PersonalMemorySchema.TrustLevel; sensitivityLevel?: PersonalMemorySchema.SensitivityLevel }
    }) {
      const edited = yield* memories.edit({
        id: ctx.params.id as PersonalMemorySchema.ID,
        ...(ctx.payload.content !== undefined ? { content: ctx.payload.content } : {}),
        ...(ctx.payload.trustLevel !== undefined ? { trustLevel: ctx.payload.trustLevel } : {}),
        ...(ctx.payload.sensitivityLevel !== undefined ? { sensitivityLevel: ctx.payload.sensitivityLevel } : {}),
      })
      if (!edited) {
        return yield* Effect.fail(new InvalidRequestError({ message: `Memory ${ctx.params.id} not found` }))
      }
      return edited
    })

    const remove = Effect.fn("MemoryHttpApi.remove")(function* (ctx: { params: { id: string } }) {
      const removed = yield* memories.remove(ctx.params.id as PersonalMemorySchema.ID)
      if (!removed) {
        return yield* Effect.fail(new InvalidRequestError({ message: `Memory ${ctx.params.id} not found or not confirmed` }))
      }
      return removed
    })

    return handlers
      .handle("list", list)
      .handle("pending", pending)
      .handle("confirm", confirm)
      .handle("reject", reject)
      .handle("edit", edit)
      .handle("remove", remove)
  }),
)
