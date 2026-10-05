import { describe, expect } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Schema } from "effect"
import { CrossSpawnSpawner } from "@aigcfroge/core/cross-spawn-spawner"
import { EventV2 } from "@aigcfroge/core/event"
import { Location } from "@aigcfroge/core/location"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { QuestionV2 } from "@aigcfroge/core/question"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { WorkspaceV2 } from "@aigcfroge/core/workspace"
import { Agent } from "../../src/agent/agent"
import { WorkspaceRef } from "../../src/effect/instance-ref"
import { Provider } from "../../src/provider/provider"
import { Session } from "../../src/session/session"
import { SessionID, MessageID } from "../../src/session/schema"
import { PlanExitTool } from "../../src/tool/plan"
import { QuestionTool } from "../../src/tool/question"
import { Truncate } from "@/tool/truncate"
import { TestInstance } from "../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../lib/effect"

const ctx = {
  sessionID: SessionID.make("ses_test-session"),
  messageID: MessageID.make("msg_test-message"),
  callID: "test-call",
  agent: "test-agent",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const it = testEffect(
  Layer.mergeAll(
    LocationServiceMap.layer,
    EventV2.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Truncate.defaultLayer,
    Agent.defaultLayer,
    Session.defaultLayer,
    Provider.defaultLayer,
  ),
)

const questionOwner = Effect.fn("QuestionToolTest.owner")(function* (workspaceID?: WorkspaceV2.ID) {
  const instance = yield* TestInstance
  const locations = yield* LocationServiceMap
  const location = Location.Ref.make({ directory: AbsolutePath.make(instance.directory), workspaceID })
  const question = yield* QuestionV2.Service.pipe(Effect.provide(locations.get(location)))
  return { location, question }
})

const questionAsked = Effect.fn("QuestionToolTest.asked")(function* (sessionID: SessionID) {
  const events = yield* EventV2.Service
  const asked = yield* Deferred.make<{ request: QuestionV2.Request; location: Location.Ref | undefined }>()
  const off = yield* events.listen((event) => {
    if (event.type !== QuestionV2.Event.Asked.type) return Effect.void
    const request = Schema.decodeUnknownSync(QuestionV2.Request)(event.data)
    if (request.sessionID !== sessionID) return Effect.void
    return Deferred.succeed(asked, { request, location: event.location }).pipe(Effect.asVoid)
  })
  yield* Effect.addFinalizer(() => off)
  return awaitWithTimeout(Deferred.await(asked), "tool did not publish a native question request")
})

describe("tool.question", () => {
  it.instance("executes through the canonical Location owner with valid question parameters", () =>
    Effect.gen(function* () {
      const owner = yield* questionOwner()
      const asked = yield* questionAsked(ctx.sessionID)
      const tool = yield* (yield* QuestionTool).init()
      const questions = [
        {
          question: "What is your favorite color?",
          header: "Color",
          options: [
            { label: "Red", description: "The color of passion" },
            { label: "Blue", description: "The color of sky" },
          ],
          multiple: false,
        },
      ]

      const scope = yield* Effect.scope
      const fiber = yield* tool.execute({ questions }, ctx).pipe(Effect.forkIn(scope))
      const event = yield* asked
      expect(event.location).toEqual(owner.location)
      expect(event.request).toEqual({
        id: expect.stringMatching(/^que_/),
        sessionID: ctx.sessionID,
        questions,
        tool: { messageID: ctx.messageID, callID: ctx.callID },
      })
      expect(yield* owner.question.list()).toEqual([event.request])
      yield* owner.question.reply({ requestID: event.request.id, answers: [["Red"]] })

      const result = yield* awaitWithTimeout(Fiber.join(fiber), "native reply did not settle the default question tool")
      expect(result.title).toBe("Asked 1 question")
      expect(result.output).toContain('"What is your favorite color?"="Red"')
      expect(result.metadata.answers).toEqual([["Red"]])
      expect(yield* owner.question.list()).toEqual([])
    }),
  )

  it.instance("accepts a header over 12 characters and preserves the full workspace Location ref", () =>
    Effect.gen(function* () {
      const workspaceID = WorkspaceV2.ID.ascending()
      const owner = yield* questionOwner(workspaceID)
      const implicitLocal = yield* questionOwner()
      const asked = yield* questionAsked(ctx.sessionID)
      const tool = yield* (yield* QuestionTool).init()
      const questions = [
        {
          question: "What is your favorite animal?",
          header: "This Header is Over 12",
          options: [{ label: "Dog", description: "Man's best friend" }],
        },
      ]

      const scope = yield* Effect.scope
      const fiber = yield* tool
        .execute({ questions }, ctx)
        .pipe(Effect.provideService(WorkspaceRef, workspaceID), Effect.forkIn(scope))
      const event = yield* asked
      expect(event.location).toEqual(owner.location)
      expect(event.request.questions).toEqual(questions)
      expect(yield* owner.question.list()).toEqual([event.request])
      expect(yield* implicitLocal.question.list()).toEqual([])
      expect(
        yield* implicitLocal.question.reply({ requestID: event.request.id, answers: [["Dog"]] }).pipe(Effect.flip),
      ).toEqual(new QuestionV2.NotFoundError({ requestID: event.request.id }))
      expect(yield* owner.question.list()).toEqual([event.request])
      yield* owner.question.reply({ requestID: event.request.id, answers: [["Dog"]] })

      const result = yield* awaitWithTimeout(
        Fiber.join(fiber),
        "workspace reply did not settle the default question tool",
      )
      expect(result.output).toContain('"What is your favorite animal?"="Dog"')
      expect(result.metadata.answers).toEqual([["Dog"]])
      expect(yield* owner.question.list()).toEqual([])
    }),
  )
})

describe("tool.plan_exit", () => {
  it.instance("a native No reply rejects the plan exit without switching to build", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ title: "Plan exit rejection", agent: "plan" })
      yield* Effect.addFinalizer(() => sessions.remove(session.id).pipe(Effect.orDie))
      const owner = yield* questionOwner()
      const asked = yield* questionAsked(session.id)
      const events = yield* EventV2.Service
      const replies: EventV2.Payload[] = []
      const off = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === QuestionV2.Event.Replied.type) replies.push(event)
        }),
      )
      yield* Effect.addFinalizer(() => off)
      const tool = yield* (yield* PlanExitTool).init()
      const scope = yield* Effect.scope
      const fiber = yield* tool.execute({}, { ...ctx, sessionID: session.id, agent: "plan" }).pipe(Effect.forkIn(scope))
      const event = yield* asked

      expect(event.location).toEqual(owner.location)
      expect(event.request).toMatchObject({
        sessionID: session.id,
        questions: [
          {
            header: "Build Agent",
            custom: false,
            options: [
              { label: "Yes", description: "Switch to build agent and start implementing the plan" },
              { label: "No", description: "Stay with plan agent to continue refining the plan" },
            ],
          },
        ],
        tool: { messageID: ctx.messageID, callID: ctx.callID },
      })
      expect(yield* owner.question.list()).toEqual([event.request])
      expect(yield* sessions.messages({ sessionID: session.id })).toEqual([])
      yield* owner.question.reply({ requestID: event.request.id, answers: [["No"]] })

      const exit = yield* awaitWithTimeout(Fiber.await(fiber), "native No reply did not settle the plan exit")
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(QuestionV2.RejectedError)
      expect(replies.map((reply) => reply.data)).toEqual([
        { sessionID: session.id, requestID: event.request.id, answers: [["No"]] },
      ])
      expect(yield* owner.question.list()).toEqual([])
      expect(yield* sessions.messages({ sessionID: session.id })).toEqual([])
      expect((yield* sessions.get(session.id)).agent).toBe("plan")
    }),
  )
})
