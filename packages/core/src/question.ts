export * as QuestionV2 from "./question"

import { Context, Deferred, Effect, Layer, Schema } from "effect"
import { EventV2 } from "./event"
import { Question } from "@aigcfroge/schema/question"
import { Identifier } from "./id/id"
import { withStatics } from "./schema"
import { SessionSchema } from "./session/schema"

export const ID = Question.ID.pipe(
  withStatics((schema) => ({ ascending: (id?: string) => schema.make(Identifier.ascending("question", id)) })),
)
export type ID = typeof ID.Type

export const Option = Question.Option
export type Option = Question.Option

export const Info = Question.Info
export type Info = Question.Info

export const Prompt = Question.Prompt
export type Prompt = Question.Prompt

export const Tool = Question.Tool
export type Tool = Question.Tool

export const Request = Question.Request
export type Request = Question.Request

export const Answer = Question.Answer
export type Answer = Question.Answer

export const Reply = Question.Reply
export type Reply = Question.Reply

export const Event = {
  Asked: EventV2.define({ type: "question.v2.asked", schema: Request.fields }),
  Replied: EventV2.define({
    type: "question.v2.replied",
    schema: {
      sessionID: SessionSchema.ID,
      requestID: ID,
      answers: Schema.Array(Answer),
    },
  }),
  Rejected: EventV2.define({
    type: "question.v2.rejected",
    schema: {
      sessionID: SessionSchema.ID,
      requestID: ID,
    },
  }),
}

export class RejectedError extends Schema.TaggedErrorClass<RejectedError>()("QuestionV2.RejectedError", {}) {
  override get message() {
    return "The user dismissed this question"
  }
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("QuestionV2.NotFoundError", {
  requestID: ID,
}) {
  override get message() {
    return `Question request not found: ${this.requestID}`
  }
}

export interface AskInput {
  readonly sessionID: SessionSchema.ID
  readonly questions: ReadonlyArray<Info>
  readonly tool?: Tool
}

export interface ReplyInput {
  readonly requestID: ID
  readonly answers: ReadonlyArray<Answer>
}

export interface Interface {
  readonly ask: (input: AskInput) => Effect.Effect<ReadonlyArray<Answer>, RejectedError>
  readonly reply: (input: ReplyInput) => Effect.Effect<void, NotFoundError>
  readonly reject: (requestID: ID) => Effect.Effect<void, NotFoundError>
  readonly list: () => Effect.Effect<ReadonlyArray<Request>>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/Question") {}

interface Pending {
  readonly request: Request
  readonly deferred: Deferred.Deferred<ReadonlyArray<Answer>, RejectedError>
}

/**
 * Location-owned pending prompts. The Location layer map must materialize this
 * layer once per embedded Location so replies cannot settle another Location's
 * deferred request.
 */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const pending = new Map<ID, Pending>()

    yield* Effect.addFinalizer(() =>
      Effect.forEach(pending.values(), (item) => Deferred.fail(item.deferred, new RejectedError()), {
        discard: true,
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            pending.clear()
          }),
        ),
      ),
    )

    const ask = Effect.fn("QuestionV2.ask")((input: AskInput) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const id = ID.ascending()
          const deferred = yield* Deferred.make<ReadonlyArray<Answer>, RejectedError>()
          const request: Request = { id, ...input }
          pending.set(id, { request, deferred })
          return yield* events.publish(Event.Asked, request).pipe(
            Effect.andThen(restore(Deferred.await(deferred))),
            Effect.ensuring(
              Effect.gen(function* () {
                if (!pending.delete(id)) return
                yield* events.publish(Event.Rejected, { sessionID: input.sessionID, requestID: id })
              }),
            ),
          )
        }),
      ),
    )

    const reply = Effect.fn("QuestionV2.reply")((input: ReplyInput) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const existing = pending.get(input.requestID)
          if (!existing) return yield* new NotFoundError({ requestID: input.requestID })
          pending.delete(input.requestID)
          yield* Deferred.succeed(existing.deferred, input.answers)
          yield* events.publish(Event.Replied, {
            sessionID: existing.request.sessionID,
            requestID: existing.request.id,
            answers: input.answers.map((answer) => [...answer]),
          })
        }),
      ),
    )

    const reject = Effect.fn("QuestionV2.reject")((requestID: ID) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const existing = pending.get(requestID)
          if (!existing) return yield* new NotFoundError({ requestID })
          pending.delete(requestID)
          yield* Deferred.fail(existing.deferred, new RejectedError())
          yield* events.publish(Event.Rejected, {
            sessionID: existing.request.sessionID,
            requestID: existing.request.id,
          })
        }),
      ),
    )

    const list = Effect.fn("QuestionV2.list")(function* () {
      return Array.from(pending.values(), (item) => item.request)
    })

    return Service.of({ ask, reply, reject, list })
  }),
)

export const locationLayer = layer
