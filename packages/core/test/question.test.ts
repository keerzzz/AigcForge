import { describe, expect } from "bun:test"
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Schema, Scope } from "effect"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { QuestionV2 } from "@aigcfroge/core/question"
import { SessionV2 } from "@aigcfroge/core/session"
import { testEffect } from "./lib/effect"

const questions = QuestionV2.layer.pipe(Layer.provide(EventV2.defaultLayer))
const it = testEffect(Layer.mergeAll(Database.defaultLayer, EventV2.defaultLayer, questions))

const sessionID = SessionV2.ID.make("ses_question_test")
const question: QuestionV2.Info = {
  question: "Which option?",
  header: "Option",
  options: [{ label: "One", description: "First option" }],
}

const waitForAsk = Effect.fn("QuestionV2Test.waitForAsk")(function* (
  service: QuestionV2.Interface,
  input: QuestionV2.AskInput,
) {
  const events = yield* EventV2.Service
  const pending = yield* service.list()
  const asked = yield* Deferred.make<QuestionV2.Request>()
  const unsubscribe = yield* events.listen((event) => {
    if (event.type !== QuestionV2.Event.Asked.type) return Effect.void
    const request = Schema.decodeUnknownSync(QuestionV2.Request)(event.data)
    if (request.sessionID !== input.sessionID || pending.some((item) => item.id === request.id)) return Effect.void
    return Deferred.succeed(asked, request).pipe(Effect.asVoid)
  })
  yield* Effect.addFinalizer(() => unsubscribe)
  const scope = yield* Effect.scope
  const fiber = yield* service.ask(input).pipe(Effect.forkIn(scope))
  return { fiber, request: yield* Deferred.await(asked) }
})

describe("QuestionV2", () => {
  it.effect("publishes lifecycle events and settles a pending reply", () =>
    Effect.gen(function* () {
      const service = yield* QuestionV2.Service
      const events = yield* EventV2.Service
      const published: EventV2.Payload[] = []
      const unsubscribe = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type.startsWith("question.v2.")) published.push(event)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      expect(yield* service.list()).toEqual([])
      const { fiber, request } = yield* waitForAsk(service, { sessionID, questions: [question] })

      expect(request).toEqual({ id: expect.stringMatching(/^que_/), sessionID, questions: [question] })
      expect(yield* service.list()).toEqual([request])
      yield* service.reply({ requestID: request.id, answers: [["One"]] })

      expect(yield* Fiber.join(fiber)).toEqual([["One"]])
      expect(yield* service.list()).toEqual([])
      expect(published.map((event) => [event.type, event.data])).toEqual([
        [QuestionV2.Event.Asked.type, request],
        [QuestionV2.Event.Replied.type, { sessionID, requestID: request.id, answers: [["One"]] }],
      ])
    }),
  )

  it.effect("publishes rejection, fails the ask, and rejects unknown IDs", () =>
    Effect.gen(function* () {
      const service = yield* QuestionV2.Service
      const events = yield* EventV2.Service
      const published: EventV2.Payload[] = []
      const unsubscribe = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === QuestionV2.Event.Rejected.type) published.push(event)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const { fiber, request } = yield* waitForAsk(service, { sessionID, questions: [question] })

      yield* service.reject(request.id)
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(exit.cause.toString()).toContain("QuestionV2.RejectedError")
      expect(published.map((event) => event.data)).toEqual([{ sessionID, requestID: request.id }])
      expect(yield* service.list()).toEqual([])

      const unknown = QuestionV2.ID.ascending("que_unknown")
      expect(yield* service.reply({ requestID: unknown, answers: [] }).pipe(Effect.flip)).toEqual(
        new QuestionV2.NotFoundError({ requestID: unknown }),
      )
      const missing = yield* service.reject(unknown).pipe(Effect.flip)
      expect(missing).toEqual(new QuestionV2.NotFoundError({ requestID: unknown }))
      expect(missing.message).toBe(`Question request not found: ${unknown}`)
    }),
  )

  it.effect("preserves multiple questions and ordered multi-select answers", () =>
    Effect.gen(function* () {
      const service = yield* QuestionV2.Service
      const prompts = [
        {
          ...question,
          options: [...question.options, { label: "Two", description: "Second option" }],
          multiple: true,
        },
        {
          question: "Which environment?",
          header: "Environment",
          options: [
            { label: "Dev", description: "Development" },
            { label: "Prod", description: "Production" },
          ],
          custom: false,
        },
      ]
      const tool = { messageID: "msg_question_test", callID: "question-call" }
      const asked = yield* waitForAsk(service, { sessionID, questions: prompts, tool })

      expect(asked.request).toEqual({ id: expect.stringMatching(/^que_/), sessionID, questions: prompts, tool })
      expect(yield* service.list()).toEqual([asked.request])
      const answers = [["Two", "One"], ["Prod"]]
      yield* service.reply({ requestID: asked.request.id, answers })

      expect(yield* Fiber.join(asked.fiber)).toEqual(answers)
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("lists all pending requests and removes only the settled request", () =>
    Effect.gen(function* () {
      const service = yield* QuestionV2.Service
      const first = yield* waitForAsk(service, { sessionID, questions: [question] })
      const second = yield* waitForAsk(service, {
        sessionID: SessionV2.ID.make("ses_question_second"),
        questions: [question],
      })

      expect(first.request.id).not.toBe(second.request.id)
      expect(yield* service.list()).toEqual([first.request, second.request])
      yield* service.reply({ requestID: second.request.id, answers: [["One"]] })

      expect(yield* Fiber.join(second.fiber)).toEqual([["One"]])
      expect(yield* service.list()).toEqual([first.request])
      yield* service.reject(first.request.id)

      const exit = yield* Fiber.await(first.fiber)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(QuestionV2.RejectedError)
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("isolates pending requests by location-layer instance and rejects them on finalization", () =>
    Effect.gen(function* () {
      const firstScope = yield* Scope.make()
      const secondScope = yield* Scope.make()
      const first = Context.get(
        yield* Layer.buildWithScope(Layer.fresh(QuestionV2.layer), firstScope),
        QuestionV2.Service,
      )
      const second = Context.get(
        yield* Layer.buildWithScope(Layer.fresh(QuestionV2.layer), secondScope),
        QuestionV2.Service,
      )
      const { fiber, request } = yield* waitForAsk(first, { sessionID, questions: [question] })

      expect(yield* second.list()).toEqual([])
      expect(yield* second.reply({ requestID: request.id, answers: [["One"]] }).pipe(Effect.flip)).toEqual(
        new QuestionV2.NotFoundError({ requestID: request.id }),
      )

      yield* Scope.close(firstScope, Exit.void)
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(exit.cause.toString()).toContain("QuestionV2.RejectedError")
      yield* Scope.close(secondScope, Exit.void)
    }),
  )
})

describe("QuestionV2 decision ownership (AI-TDD-S03)", () => {
  it.effect("R03: concurrent reply and reject publish exactly one terminal event", () =>
    Effect.gen(function* () {
      const service = yield* QuestionV2.Service
      const events = yield* EventV2.Service
      const terminal: string[] = []
      const off = yield* events.listen((event) => {
        if (event.type !== QuestionV2.Event.Replied.type && event.type !== QuestionV2.Event.Rejected.type)
          return Effect.void
        terminal.push(event.type)
        // A real asynchronous subscriber exposes both replies' settlement window.
        return Effect.yieldNow
      })
      yield* Effect.addFinalizer(() => off)
      const asked = yield* waitForAsk(service, { sessionID, questions: [question] })
      const results = yield* Effect.all(
        [service.reply({ requestID: asked.request.id, answers: [["One"]] }), service.reject(asked.request.id)].map(
          Effect.exit,
        ),
        { concurrency: "unbounded" },
      )

      expect(results.filter(Exit.isSuccess)).toHaveLength(1)
      expect(results.filter(Exit.isFailure)).toHaveLength(1)
      expect(terminal).toHaveLength(1)
      expect(yield* service.list()).toEqual([])
      yield* Fiber.await(asked.fiber)
    }),
  )

  for (const decision of ["reply", "reject"] as const) {
    it.effect(`R06: ${decision} notification failure cannot strand its waiting caller`, () =>
      Effect.gen(function* () {
        const service = yield* QuestionV2.Service
        const events = yield* EventV2.Service
        const asked = yield* waitForAsk(service, { sessionID, questions: [question] })
        const off = yield* events.listen((event) =>
          event.type === QuestionV2.Event.Replied.type || event.type === QuestionV2.Event.Rejected.type
            ? Effect.die("decision notification failed")
            : Effect.void,
        )
        yield* Effect.addFinalizer(() => off)
        const result = yield* (
          decision === "reply"
            ? service.reply({ requestID: asked.request.id, answers: [["One"]] })
            : service.reject(asked.request.id)
        ).pipe(Effect.exit)

        expect(Exit.isFailure(result)).toBe(true)
        expect(yield* service.list()).toEqual([])
        const answer = yield* Fiber.await(asked.fiber)
        expect(Exit.isSuccess(answer)).toBe(decision === "reply")
      }),
    )
  }

  it.effect("R06: failed admission and cancelled asks leave no orphan pending entry", () =>
    Effect.gen(function* () {
      const service = yield* QuestionV2.Service
      const events = yield* EventV2.Service
      const off = yield* events.listen((event) =>
        event.type === QuestionV2.Event.Asked.type ? Effect.die("ask publication failed") : Effect.void,
      )
      yield* Effect.addFinalizer(() => off)
      const failed = yield* service.ask({ sessionID, questions: [question] }).pipe(Effect.exit)
      expect(Exit.isFailure(failed)).toBe(true)
      expect(yield* service.list()).toEqual([])
      yield* off

      const asked = yield* waitForAsk(service, { sessionID, questions: [question] })
      yield* Fiber.interrupt(asked.fiber)
      expect(yield* service.list()).toEqual([])
      expect(yield* service.reject(asked.request.id).pipe(Effect.flip)).toEqual(
        new QuestionV2.NotFoundError({ requestID: asked.request.id }),
      )
    }),
  )
})

it.effect("R06: withdrawing a question publishes one closure without rejecting another pending question", () =>
  Effect.gen(function* () {
    const service = yield* QuestionV2.Service
    const events = yield* EventV2.Service
    const rejected: unknown[] = []
    const off = yield* events.listen((event) =>
      Effect.sync(() => {
        if (event.type === QuestionV2.Event.Rejected.type) rejected.push(event.data)
      }),
    )
    yield* Effect.addFinalizer(() => off)
    const first = yield* waitForAsk(service, { sessionID, questions: [question] })
    const second = yield* waitForAsk(service, { sessionID, questions: [question] })
    yield* Fiber.interrupt(first.fiber)
    expect(yield* service.list()).toEqual([second.request])
    expect(rejected).toEqual([{ sessionID, requestID: first.request.id }])
    yield* service.reply({ requestID: second.request.id, answers: [["One"]] })
    expect(yield* Fiber.join(second.fiber)).toEqual([["One"]])
    expect(rejected).toHaveLength(1)
  }),
)
