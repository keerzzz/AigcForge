import { expect, test } from "bun:test"
import { LanguageModel, LLM, LLMEvent } from "@aigcfroge/ai"
import { OpenAIChat } from "@aigcfroge/ai/protocols/openai-chat"
import { TestLLM } from "@aigcfroge/ai/testing"
import { Agent } from "@aigcfroge/core/agent"
import { Bus } from "@aigcfroge/core/bus"
import { Database } from "@aigcfroge/core/database/database"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { EventTable } from "@aigcfroge/core/event/sql"
import { FileMutation } from "@aigcfroge/core/file-mutation"
import { LocationMutation } from "@aigcfroge/core/location-mutation"
import { Permission } from "@aigcfroge/core/permission"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath, RelativePath } from "@aigcfroge/core/schema"
import { Session } from "@aigcfroge/core/session"
import { WorkArtifact } from "@aigcfroge/core/session/artifact"
import { SessionEvent } from "@aigcfroge/core/session/event"
import { SessionGoal } from "@aigcfroge/core/session/goal"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionRunnerModel } from "@aigcfroge/core/session/runner/model"
import { SessionStep } from "@aigcfroge/core/session/runner/step"
import { SessionMessageTable, SessionTable } from "@aigcfroge/core/session/sql"
import { SessionTask } from "@aigcfroge/core/session/task"
import { Snapshot } from "@aigcfroge/core/snapshot"
import { ToolOutput } from "@aigcfroge/core/tool-output"
import { Money } from "@aigcfroge/schema/money"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { FSUtil } from "@aigcfroge/util/fs-util"
import { asc, eq } from "drizzle-orm"
import { Deferred, Effect, Exit, Fiber, Layer, Stream } from "effect"
import { awaitWithTimeout, testEffect } from "./lib/effect"
import { hostEnvironmentLayer } from "./fixture/environment"
import { tempLocationLayer } from "./fixture/location"

const it = testEffect(
  Layer.merge(
    WorkArtifact.layer.pipe(
      Layer.provide(LocationMutation.layer.pipe(Layer.provide(tempLocationLayer))),
      Layer.provide(FileMutation.layer.pipe(Layer.provide(hostEnvironmentLayer))),
      Layer.provideMerge(AppNodeBuilder.build(
        LayerNode.group([Database.node, Bus.node, SessionGoal.node, SessionProjector.node, ToolOutput.node, SessionTask.node, FSUtil.node]),
        [Bus.node.replace(Bus.configured({ persist: true }))],
      )),
    ),
    TestLLM.testLayer(),
  ),
)

test("P3 distinguishes absent prices from explicit free quotes", () => {
  const model = LanguageModel.make({ id: "quote-test", provider: "test", route: OpenAIChat.route })
  const options = { capabilities: { tools: true, input: ["text"], output: ["text"] }, limit: { context: 100_000, output: 1_000 }, cost: [] } satisfies Parameters<typeof SessionRunnerModel.resolved>[1]
  expect(SessionRunnerModel.resolved(model, options).quote).toEqual({ status: "unknown" })
  expect(SessionRunnerModel.resolved(model, { ...options, quote: { status: "free", prices: [] } }).quote).toEqual({ status: "free", prices: [] })
  expect(SessionRunnerModel.resolved(model, { ...options, cost: [{ input: Money.USDPerMillionTokens.make(0), output: Money.USDPerMillionTokens.make(0), cache: { read: Money.USDPerMillionTokens.make(0), write: Money.USDPerMillionTokens.make(0) } }] }).quote?.status).toBe("free")
})

for (const fixture of [
  { finish: "stop", toolChoice: undefined, empty: false, rollback: false },
  { finish: "content-filter", toolChoice: undefined, empty: false, rollback: false },
  { finish: "stop", toolChoice: "none", empty: false, rollback: false },
  { finish: "stop", toolChoice: undefined, empty: true, rollback: false },
  { finish: "stop", toolChoice: undefined, empty: false, rollback: true },
] as const) {
  it.effect(
    `settles ${fixture.finish} with tool choice ${fixture.toolChoice ?? "default"}${fixture.empty ? " without settlement" : ""}${fixture.rollback ? " with completion rollback" : ""}`,
    () =>
      Effect.gen(function* () {
        const db = (yield* Database.Service).db
        const bus = yield* Bus.Service
        const llm = yield* TestLLM.Test
        const sessionID = Session.ID.create()
        const assistantMessageID = SessionMessage.ID.create()
        const start = Snapshot.ID.make("before")
        const end = Snapshot.ID.make("after")
        const files = [RelativePath.make("changed.ts")]
        let captures = 0
        let executions = 0
        let completed = 0
        const steps = yield* SessionStep.make.pipe(
          Effect.provide(
            Layer.mock(Snapshot.Service)({
              capture: () => Effect.sync(() => (captures++ === 0 ? start : end)),
              files: (input) => {
                expect(input).toEqual({ from: start, to: end })
                return Effect.succeed(files)
              },
            }),
          ),
        )
        yield* db
          .insert(ProjectTable)
          .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
          .run()
        yield* db
          .insert(SessionTable)
          .values({
            id: sessionID,
            project_id: Project.ID.global,
            slug: "step",
            directory: "/project",
            version: "test",
          })
          .run()
        const model = SessionRunnerModel.resolved(
          LanguageModel.make({ id: "test-model", provider: "test", route: OpenAIChat.route }),
          {
            capabilities: { tools: true, input: ["text"], output: ["text"] },
            limit: { context: 100_000, output: 1_000 },
            cost: [
              {
                input: Money.USDPerMillionTokens.make(1),
                output: Money.USDPerMillionTokens.make(2),
                cache: { read: Money.USDPerMillionTokens.make(0.1), write: Money.USDPerMillionTokens.make(0.5) },
              },
            ],
          },
        )
        yield* llm.push(
          fixture.empty
            ? [LLMEvent.finish({ reason: { normalized: "stop" } })]
            : TestLLM.complete(
                {
                  reason: { normalized: fixture.finish },
                  usage: {
                    inputTokens: 15,
                    outputTokens: 6,
                    nonCachedInputTokens: 10,
                    cacheReadInputTokens: 3,
                    cacheWriteInputTokens: 2,
                    reasoningTokens: 2,
                  },
                },
                LLMEvent.toolCall({ id: "call-test", name: "test", input: {} }),
              ),
        )
        if (fixture.rollback)
          yield* bus.project(SessionEvent.Step.Completed, () => Effect.die(new Error("Completion projection failed")))
        const result = yield* steps
          .attempt({
            isLocationClosed: () => false,
            sessionID,
            assistantMessageID,
            completeStep: Effect.sync(() => {
              completed++
            }),
            agent: Agent.defaultID,
            model,
            prepared: {
              retry: () => Effect.void,
              request: LLM.request({ model: model.model, prompt: "Run one tool", toolChoice: fixture.toolChoice }),
              options: {},
              executeTool: () =>
                Effect.sync(() => {
                  executions++
                  return { content: [{ type: "text", text: "Completed tool" }] }
                }),
            },
            retry: (_cause, _error, retry) =>
              Effect.succeed(retry ? { retry: true, attempt: 2, delay: 0 } : { retry: false }),
            recoverContinuation: true,
            recoverOverflow: Effect.succeed(false),
          })
          .pipe(Effect.exit)
        expect(Exit.isSuccess(result)).toBe(fixture.finish === "stop" && !fixture.rollback)
        expect(completed).toBe(fixture.finish === "stop" && !fixture.rollback ? 1 : 0)
        expect(executions).toBe(fixture.empty || fixture.toolChoice === "none" ? 0 : 1)
        if (Exit.isSuccess(result))
          expect(result.value).toEqual(
            SessionStep.Outcome.Completed({ needsContinuation: !fixture.empty && fixture.toolChoice !== "none" }),
          )
        expect(yield* llm.requests()).toHaveLength(1)
        expect(captures).toBe(fixture.empty ? 1 : 2)
        const message = yield* db
          .select()
          .from(SessionMessageTable)
          .where(eq(SessionMessageTable.id, assistantMessageID))
          .get()
        if (!fixture.empty)
          expect(message?.data).toMatchObject({
            finish: fixture.finish,
            tokens: { input: 10, output: 4, reasoning: 2, cache: { read: 3, write: 2 } },
            snapshot: { start, end, files },
            content: [{ type: "tool", state: { status: fixture.toolChoice === "none" ? "error" : "completed" } }],
          })
        if (!fixture.empty) expect(message?.data).toHaveProperty("cost", expect.closeTo(0.0000233, 10))
        const events = yield* db
          .select()
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, sessionID))
          .orderBy(asc(EventTable.seq))
          .all()
        const types = events.map((event) => event.type)
        const completion = events.filter((event) => event.type === "session.step.completed.1")
        expect(completion).toHaveLength(fixture.finish === "stop" && !fixture.rollback ? 1 : 0)
        if (fixture.finish === "stop" && !fixture.rollback) {
          expect(message?.data).toHaveProperty("completion", { id: completion[0].id, seq: completion[0].seq })
          expect(message?.seq).toBe(events.find((event) => event.type === "session.attempt.started.1")?.seq)
          expect(message?.seq).toBeLessThan(completion[0].seq)
        }
        if (fixture.empty) {
          expect(types).toEqual(["session.attempt.started.1", "session.attempt.ended.1", "session.step.started.1", "session.step.ended.1", "session.step.completed.1"])
          expect(message?.type).toBe("assistant")
          expect(message?.data).toMatchObject({ content: [] })
          expect(message?.data).toMatchObject({ finish: "unknown", cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, unknownPriceAttempts: 0, missingUsageAttempts: 1, attempts: [{ ordinal: 0, terminal: { status: "completed" } }] })
          return
        }
        const terminal = fixture.finish === "stop" ? "session.step.ended.1" : "session.step.failed.1"
        expect(types.filter((type) => type === "session.step.streamed.1")).toHaveLength(1)
        expect(types.filter((type) => type === terminal)).toHaveLength(1)
        expect(types.indexOf("session.step.streamed.1")).toBeLessThan(types.indexOf(terminal))
        if (fixture.finish === "stop" && !fixture.rollback)
          expect(types.indexOf(terminal)).toBeLessThan(types.indexOf("session.step.completed.1"))
        if (fixture.rollback) expect(message?.data).not.toHaveProperty("completion")
        expect(
          types.indexOf(fixture.toolChoice === "none" ? "session.tool.failed.2" : "session.tool.success.2"),
        ).toBeLessThan(types.indexOf(terminal))
      }),
  )
}

it.effect("does not complete a pending start snapshot when cancelled and completes its settled counterpart once", () =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const llm = yield* TestLLM.Test
    const sessionID = Session.ID.create()
    const cancelledID = SessionMessage.ID.create()
    const normalID = SessionMessage.ID.create()
    const start = Snapshot.ID.make("before")
    const end = Snapshot.ID.make("after")
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const providerEvent = yield* Deferred.make<void>()
    const providerClosed = yield* Deferred.make<void>()
    let captures = 0
    let captureCancelled = false
    let completed = 0
    const steps = yield* SessionStep.make.pipe(
      Effect.provide(
        Layer.mock(Snapshot.Service)({
          capture: () =>
            Effect.suspend(() => {
              const index = captures++
              if (index > 0) return Effect.succeed(index === 1 ? start : end)
              return Deferred.succeed(entered, undefined).pipe(
                Effect.andThen(Deferred.await(release)),
                Effect.as(start),
                Effect.onExit((exit) =>
                  Effect.sync(() => {
                    captureCancelled = Exit.hasInterrupts(exit)
                  }),
                ),
              )
            }),
          files: (input) => {
            expect(input).toEqual({ from: start, to: end })
            return Effect.succeed([])
          },
        }),
      ),
    )
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .run()
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        slug: "step-readiness",
        directory: "/project",
        version: "test",
      })
      .run()
    const model = SessionRunnerModel.resolved(
      LanguageModel.make({ id: "test-model", provider: "test", route: OpenAIChat.route }),
      {
        capabilities: { tools: true, input: ["text"], output: ["text"] },
        limit: { context: 100_000, output: 1_000 },
        cost: [
          {
            input: Money.USDPerMillionTokens.make(1),
            output: Money.USDPerMillionTokens.make(2),
            cache: { read: Money.USDPerMillionTokens.make(0.1), write: Money.USDPerMillionTokens.make(0.5) },
          },
        ],
      },
    )
    const attempt = (assistantMessageID: SessionMessage.ID) =>
      steps.attempt({
        isLocationClosed: () => false,
        sessionID,
        assistantMessageID,
        agent: Agent.defaultID,
        model,
        completeStep: Effect.sync(() => {
          completed++
        }),
        prepared: {
          retry: () => Effect.void,
          request: LLM.request({ model: model.model, prompt: "Wait for the start snapshot" }),
          options: {},
          executeTool: () => Effect.die(new Error("Readiness keeper must not execute tools")),
        },
        retry: (_cause, _error, retry) =>
          Effect.succeed(retry ? { retry: true, attempt: 2, delay: 0 } : { retry: false }),
        recoverContinuation: true,
        recoverOverflow: Effect.succeed(false),
      })
    const events = () =>
      db.select().from(EventTable).where(eq(EventTable.aggregate_id, sessionID)).orderBy(asc(EventTable.seq)).all()
    yield* llm.push(
      Stream.fromIterable(TestLLM.stop()).pipe(
        Stream.tap(() => Deferred.succeed(providerEvent, undefined)),
        Stream.ensuring(Deferred.succeed(providerClosed, undefined)),
      ),
    )
    yield* Effect.gen(function* () {
      const running = yield* attempt(cancelledID).pipe(Effect.forkIn(yield* Effect.scope))
      yield* awaitWithTimeout(Deferred.await(entered), "Start snapshot did not enter its pending capture")
      yield* awaitWithTimeout(llm.wait(1), "Pending attempt did not request the model")
      yield* awaitWithTimeout(Deferred.await(providerEvent), "Pending attempt did not receive a provider event")
      expect(yield* Deferred.isDone(release)).toBe(false)
      expect(captures).toBe(1)
      yield* awaitWithTimeout(Fiber.interrupt(running), "Pending start snapshot cancellation did not settle")
      const cancelled = yield* Fiber.await(running)
      expect(Exit.isFailure(cancelled)).toBe(true)
      expect(Exit.hasInterrupts(cancelled)).toBe(true)
      expect(captureCancelled).toBe(true)
      expect(yield* Deferred.isDone(providerClosed)).toBe(true)
      expect(yield* Deferred.isDone(release)).toBe(false)
      expect(completed).toBe(0)
      const beforeRelease = yield* events()
      expect(beforeRelease.map((event) => event.type)).toEqual(["session.attempt.started.1", "session.attempt.ended.1", "session.step.started.1", "session.step.failed.1"])
      expect(
        yield* db.select().from(SessionMessageTable).where(eq(SessionMessageTable.id, cancelledID)).get(),
      ).toMatchObject({ data: { finish: "error", missingUsageAttempts: 1, attempts: [{ ordinal: 0, terminal: { status: "cancelled", outputStarted: false, delivery: "unknown" } }] } })
      // The attempt and its scoped fibers are joined before readiness is released.
      yield* Deferred.succeed(release, undefined)
      expect(yield* events()).toEqual(beforeRelease)
      expect(completed).toBe(0)
    }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)))
    yield* llm.push(TestLLM.stop())
    const normal = yield* awaitWithTimeout(attempt(normalID), "Settled start snapshot did not complete normally")
    expect(normal).toEqual(SessionStep.Outcome.Completed({ needsContinuation: false }))
    expect(completed).toBe(1)
    expect(captures).toBe(3)
    expect(yield* llm.requests()).toHaveLength(2)
    const recorded = yield* events()
    const completions = recorded.filter((event) => event.type === "session.step.completed.1")
    expect(completions).toHaveLength(1)
    expect(completions[0].data).toMatchObject({ sessionID, assistantMessageID: normalID })
    const message = yield* db.select().from(SessionMessageTable).where(eq(SessionMessageTable.id, normalID)).get()
    expect(message?.data).toHaveProperty("completion", { id: completions[0].id, seq: completions[0].seq })
    expect(message?.seq).toBe(recorded.find((event) => event.type === "session.attempt.started.1" && event.data.assistantMessageID === normalID)?.seq)
    expect(message?.seq).toBeLessThan(completions[0].seq)
    expect(
      yield* db.select().from(SessionMessageTable).where(eq(SessionMessageTable.id, cancelledID)).get(),
    ).toMatchObject({ data: { missingUsageAttempts: 1, attempts: [{ terminal: { status: "cancelled" } }] } })
    // CorrectionStore ages only these canonical completion witnesses; no age counter is simulated here.
  }),
)

it.effect("settles a typed decline when the location is closed", () =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const llm = yield* TestLLM.Test
    const sessionID = Session.ID.create()
    const assistantMessageID = SessionMessage.ID.create()
    const start = Snapshot.ID.make("before")
    let executions = 0
    let completed = 0

    const steps = yield* SessionStep.make.pipe(
      Effect.provide(
        Layer.mock(Snapshot.Service)({
          capture: () => Effect.succeed(start),
          files: () => Effect.succeed([]),
        }),
      ),
    )

    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .run()
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        slug: "step-decline-closed",
        directory: "/project",
        version: "test",
      })
      .run()

    const model = SessionRunnerModel.resolved(
      LanguageModel.make({ id: "test-model", provider: "test", route: OpenAIChat.route }),
      {
        capabilities: { tools: true, input: ["text"], output: ["text"] },
        limit: { context: 100_000, output: 1_000 },
        cost: [
          {
            input: Money.USDPerMillionTokens.make(1),
            output: Money.USDPerMillionTokens.make(2),
            cache: { read: Money.USDPerMillionTokens.make(0.1), write: Money.USDPerMillionTokens.make(0.5) },
          },
        ],
      },
    )

    yield* llm.push(
      TestLLM.complete(
        { reason: { normalized: "stop" } },
        LLMEvent.toolCall({ id: "call-declined", name: "declined_tool", input: {} }),
      ),
    )

    const result = yield* steps
      .attempt({
        isLocationClosed: () => true,
        sessionID,
        assistantMessageID,
        completeStep: Effect.sync(() => {
          completed++
        }),
        agent: Agent.defaultID,
        model,
        prepared: {
          retry: () => Effect.void,
          request: LLM.request({ model: model.model, prompt: "Run tool and decline" }),
          options: {},
          executeTool: () =>
            Effect.gen(function* () {
              executions++
              return yield* new Permission.DeclinedError()
            }),
        },
        retry: () => Effect.succeed({ retry: false }),
        recoverContinuation: true,
        recoverOverflow: Effect.succeed(false),
      })
      .pipe(Effect.exit)

    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value).toEqual(SessionStep.Outcome.Completed({ needsContinuation: true }))
    }
    expect(executions).toBe(1)
    expect(completed).toBe(0)
    expect(yield* llm.requests()).toHaveLength(1)

    const events = yield* db
      .select()
      .from(EventTable)
      .where(eq(EventTable.aggregate_id, sessionID))
      .orderBy(asc(EventTable.seq))
      .all()
    const completedEvents = events.filter((event) => event.type === "session.step.completed.1")
    expect(completedEvents).toHaveLength(0)

    const message = yield* db
      .select()
      .from(SessionMessageTable)
      .where(eq(SessionMessageTable.id, assistantMessageID))
      .get()
    expect(message?.data).toBeDefined()
    expect(message?.data).toMatchObject({
      finish: "error",
      error: { type: "aborted", message: "Step interrupted" },
      content: [
        {
          type: "tool",
          state: {
            status: "error",
            error: {
              type: "aborted",
              message: "Interaction cancelled because the location shut down",
            },
          },
        },
      ],
    })
    expect(message?.data).not.toHaveProperty("completion")
  }),
)

it.effect("interrupts a typed decline while the location is open", () =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const llm = yield* TestLLM.Test
    const sessionID = Session.ID.create()
    const assistantMessageID = SessionMessage.ID.create()
    const start = Snapshot.ID.make("before")
    let executions = 0
    let completed = 0

    const steps = yield* SessionStep.make.pipe(
      Effect.provide(
        Layer.mock(Snapshot.Service)({
          capture: () => Effect.succeed(start),
          files: () => Effect.succeed([]),
        }),
      ),
    )

    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .run()
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        slug: "step-decline-open",
        directory: "/project",
        version: "test",
      })
      .run()

    const model = SessionRunnerModel.resolved(
      LanguageModel.make({ id: "test-model", provider: "test", route: OpenAIChat.route }),
      {
        capabilities: { tools: true, input: ["text"], output: ["text"] },
        limit: { context: 100_000, output: 1_000 },
        cost: [
          {
            input: Money.USDPerMillionTokens.make(1),
            output: Money.USDPerMillionTokens.make(2),
            cache: { read: Money.USDPerMillionTokens.make(0.1), write: Money.USDPerMillionTokens.make(0.5) },
          },
        ],
      },
    )

    yield* llm.push(
      TestLLM.complete(
        { reason: { normalized: "stop" } },
        LLMEvent.toolCall({ id: "call-declined", name: "declined_tool", input: {} }),
      ),
    )

    const result = yield* steps
      .attempt({
        isLocationClosed: () => false,
        sessionID,
        assistantMessageID,
        completeStep: Effect.sync(() => {
          completed++
        }),
        agent: Agent.defaultID,
        model,
        prepared: {
          retry: () => Effect.void,
          request: LLM.request({ model: model.model, prompt: "Run tool and decline" }),
          options: {},
          executeTool: () =>
            Effect.gen(function* () {
              executions++
              return yield* new Permission.DeclinedError()
            }),
        },
        retry: () => Effect.succeed({ retry: false }),
        recoverContinuation: true,
        recoverOverflow: Effect.succeed(false),
      })
      .pipe(Effect.exit)

    expect(Exit.isFailure(result)).toBe(true)
    expect(Exit.hasInterrupts(result)).toBe(true)
    expect(executions).toBe(1)
    expect(completed).toBe(0)
    expect(yield* llm.requests()).toHaveLength(1)

    const events = yield* db
      .select()
      .from(EventTable)
      .where(eq(EventTable.aggregate_id, sessionID))
      .orderBy(asc(EventTable.seq))
      .all()
    const completedEvents = events.filter((event) => event.type === "session.step.completed.1")
    expect(completedEvents).toHaveLength(0)

    const message = yield* db
      .select()
      .from(SessionMessageTable)
      .where(eq(SessionMessageTable.id, assistantMessageID))
      .get()
    expect(message?.data).toBeDefined()
    expect(message?.data).toMatchObject({
      finish: "error",
      error: { type: "aborted", message: "Step interrupted" },
      content: [
        {
          type: "tool",
          state: {
            status: "error",
            error: {
              type: "aborted",
              message: "The user declined this tool call",
            },
          },
        },
      ],
    })
    expect(message?.data).not.toHaveProperty("completion")
  }),
)
