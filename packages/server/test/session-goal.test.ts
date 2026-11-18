import { expect } from "bun:test"
import { TestLLM } from "@aigcfroge/ai/testing"
import { Model } from "@aigcfroge/core/model"
import { Provider } from "@aigcfroge/core/provider"
import { Agent } from "@aigcfroge/schema/agent"
import { Session } from "@aigcfroge/schema/session"
import { SessionGoal } from "@aigcfroge/schema/session-goal"
import { Effect, Layer, Schema } from "effect"
import { useOfflineCatalog } from "../../core/test/fixture/models"
import { awaitWithTimeout, testEffect } from "../../core/test/lib/effect"
import { AssetHttpFixture } from "./fixture/asset-http"

const it = testEffect(Layer.empty)
const model = Model.Ref.make({ id: Model.ID.make("goal-http"), providerID: Provider.ID.make("test") })
const goalResponse = Schema.decodeUnknownSync(Schema.Struct({ data: SessionGoal.Info }))
const goalsResponse = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Array(SessionGoal.Info) }))
const setup = Effect.fnUntraced(function* () {
  const fixture = yield* AssetHttpFixture.setup({
    prefix: "aigcfroge-goal-http-",
    assetDirectory: ".aigcfroge",
    files: [],
    model,
  })
  yield* useOfflineCatalog([
    {
      info: Provider.Info.make({
        ...Provider.Info.empty(model.providerID),
        activation: "enabled",
        package: "@aigcfroge/ai/providers/openai/responses",
      }),
      models: [Model.Info.make(Model.Info.default(model.providerID, model.id))],
    },
  ]).pipe(Effect.provideContext(fixture.local))
  return fixture
})

const createSession = Effect.fnUntraced(function* (
  fixture: Effect.Success<ReturnType<typeof setup>>,
  agent: "meta" | "build" | "plan" = "meta",
) {
  const response = yield* fixture.request("/api/session", {
    body: {
      title: "Goal HTTP fixture",
      location: { directory: fixture.directory },
      agent,
      model,
    },
  })
  expect(response.status).toBe(200)
  return Schema.decodeUnknownSync(Schema.Struct({ data: Session.Info }))(yield* Effect.promise(() => response.json()))
    .data
})

const info = Effect.fnUntraced(function* (response: Response) {
  expect(response.status).toBe(200)
  return goalResponse(yield* Effect.promise(() => response.json())).data
})

const waitForRound = Effect.fnUntraced(function* (
  fixture: Effect.Success<ReturnType<typeof setup>>,
  sessionID: Session.ID,
  count: number,
) {
  yield* awaitWithTimeout(fixture.llm.wait(count), "The Goal round did not reach the real Session runner")
  const response = yield* awaitWithTimeout(
    fixture.request(`/api/experimental/session/${sessionID}/wait`, { method: "POST" }),
    "The Goal round did not finish its Session drain",
  )
  expect(response.status).toBe(204)
})

const human = SessionGoal.Condition.make({
  id: "accept",
  kind: "human_acceptance",
  description: "Accept the saved Goal revision",
})

it.live("serves Goal lifecycle, exact retry, revision conflicts and the stored Session owner through HTTP", () =>
  Effect.gen(function* () {
    const fixture = yield* setup()
    const session = yield* createSession(fixture)
    expect(session.agent).toBe(Agent.ID.make("meta"))
    expect(session.controller).toMatchObject({ kind: "root", rootSessionID: session.id })
    const path = `/api/session/${session.id}/goal`
    const payload = {
      goalID: SessionGoal.ID.create(),
      objective: "Review the implementation",
      conditions: [human],
      budget: { rounds: 2 },
    }
    expect((yield* fixture.request(path, { authenticated: false })).status).toBe(401)
    yield* fixture.llm.push(TestLLM.textWithUsage("The saved Goal still needs the user's acceptance.", "goal-first", 3))
    const created = yield* info(yield* fixture.request(path, { body: payload }))
    expect(created).toMatchObject({
      id: payload.goalID,
      sessionID: session.id,
      agent: "meta",
      revision: 1,
      status: "active",
    })
    expect(created.rounds).toHaveLength(1)
    yield* waitForRound(fixture, session.id, 1)
    const retried = yield* info(yield* fixture.request(path, { body: payload }))
    expect(retried.id).toBe(created.id)
    expect(retried.rounds.map((round) => round.inputID)).toEqual(created.rounds.map((round) => round.inputID))
    expect((yield* fixture.request(path, { body: { ...payload, objective: "Conflicting retry" } })).status).toBe(409)
    expect((yield* fixture.request(path, { body: { ...payload, goalID: SessionGoal.ID.create() } })).status).toBe(409)
    const other = yield* createSession(fixture)
    expect((yield* fixture.request(`/api/session/${other.id}/goal`, { body: payload })).status).toBe(409)
    const goalPath = `${path}/${created.id}`
    const read = yield* info(yield* fixture.request(goalPath))
    expect(read).toMatchObject({
      id: created.id,
      objective: payload.objective,
      revision: 1,
      accounting: { coordinator: { steps: 1, attempts: 1 } },
    })
    const paused = yield* info(yield* fixture.request(`${goalPath}/pause`, { body: { expectedRevision: 1 } }))
    expect(paused).toMatchObject({ status: "paused", pauseReason: "user", pauseVersion: 1 })
    const edited = yield* info(
      yield* fixture.request(goalPath, {
        method: "PATCH",
        body: { expectedRevision: 1, objective: "Review the revised implementation" },
      }),
    )
    expect(edited).toMatchObject({ objective: "Review the revised implementation", revision: 2, status: "paused" })
    expect(
      (yield* fixture.request(goalPath, { method: "PATCH", body: { expectedRevision: 1, objective: "Stale edit" } }))
        .status,
    ).toBe(409)
    expect((yield* fixture.request(`${goalPath}/pause`, { body: { expectedRevision: 1 } })).status).toBe(409)
    expect((yield* fixture.request(`${goalPath}/resume`, { body: { expectedRevision: 1 } })).status).toBe(409)
    yield* fixture.llm.push(TestLLM.textWithUsage("The second saved Goal still needs acceptance.", "goal-second", 3))
    const next = yield* info(
      yield* fixture.request(path, {
        body: { ...payload, goalID: SessionGoal.ID.create(), objective: "Review another result" },
      }),
    )
    yield* waitForRound(fixture, session.id, 2)
    expect((yield* fixture.request(`${goalPath}/resume`, { body: { expectedRevision: 2 } })).status).toBe(409)
    expect(
      (yield* info(yield* fixture.request(`${path}/${next.id}/cancel`, { body: { expectedRevision: 1 } }))).status,
    ).toBe("cancelled")
    expect((yield* info(yield* fixture.request(`${goalPath}/resume`, { body: { expectedRevision: 2 } }))).status).toBe(
      "active",
    )
    expect((yield* info(yield* fixture.request(`${goalPath}/cancel`, { body: { expectedRevision: 2 } }))).status).toBe(
      "cancelled",
    )
    expect((yield* fixture.request(`${goalPath}/resume`, { body: { expectedRevision: 2 } })).status).toBe(409)
    const listed = yield* fixture.request(path)
    expect(listed.status).toBe(200)
    expect(
      goalsResponse(yield* Effect.promise(() => listed.json())).data.map((goal) => ({
        id: goal.id,
        status: goal.status,
      })),
    ).toEqual([
      { id: created.id, status: "cancelled" },
      { id: next.id, status: "cancelled" },
    ])
    expect(yield* fixture.llm.requests()).toHaveLength(2)
  }),
)

it.live("requires authenticated acceptance of the exact current Goal revision and evidence set", () =>
  Effect.gen(function* () {
    const fixture = yield* setup()
    const session = yield* createSession(fixture)
    const path = `/api/session/${session.id}/goal`
    yield* fixture.llm.push(TestLLM.textWithUsage("APPROVED: the Goal is complete.", "goal-model-approval", 3))
    const created = yield* info(
      yield* fixture.request(path, {
        body: { objective: "Accept the actual saved result", conditions: [human], budget: {} },
      }),
    )
    yield* waitForRound(fixture, session.id, 1)
    const goalPath = `${path}/${created.id}`
    const waiting = yield* info(yield* fixture.request(goalPath))
    expect(waiting.status).toBe("active")
    expect(waiting.evidence).toEqual([])
    expect(waiting.satisfiedConditionIDs).toEqual([])
    const confirmation = {
      expectedRevision: waiting.revision,
      evidenceIDs: waiting.currentEvidenceIDs,
      evidenceSetDigest: waiting.evidenceSetDigest,
    }
    expect((yield* fixture.request(`${goalPath}/confirm`, { body: confirmation, authenticated: false })).status).toBe(
      401,
    )
    expect(
      (yield* fixture.request(`${goalPath}/confirm`, {
        body: { ...confirmation, evidenceIDs: ["fabricated-producer"] },
      })).status,
    ).toBe(409)
    expect(
      (yield* fixture.request(`${goalPath}/confirm`, { body: { ...confirmation, evidenceSetDigest: "0".repeat(64) } }))
        .status,
    ).toBe(409)
    const edited = yield* info(
      yield* fixture.request(goalPath, {
        method: "PATCH",
        body: { expectedRevision: waiting.revision, objective: "Accept the revised saved result" },
      }),
    )
    expect((yield* fixture.request(`${goalPath}/confirm`, { body: confirmation })).status).toBe(409)
    const current = yield* info(yield* fixture.request(goalPath))
    const accepted = yield* info(
      yield* fixture.request(`${goalPath}/confirm`, {
        body: {
          expectedRevision: edited.revision,
          evidenceIDs: current.currentEvidenceIDs,
          evidenceSetDigest: current.evidenceSetDigest,
        },
      }),
    )
    expect(accepted).toMatchObject({
      status: "completed",
      revision: edited.revision,
      satisfiedConditionIDs: [human.id],
    })
    expect(accepted.evidence).toMatchObject([
      { kind: "human_acceptance", source: "authenticated_user", revision: edited.revision, evidenceIDs: [] },
    ])
    expect((yield* info(yield* fixture.request(goalPath))).status).toBe("completed")
    expect((yield* fixture.request(`${goalPath}/resume`, { body: { expectedRevision: edited.revision } })).status).toBe(
      409,
    )
    expect(yield* fixture.llm.requests()).toHaveLength(1)
  }),
)

it.live("maps invalid Goal admission and missing Session errors without dispatching a model", () =>
  Effect.gen(function* () {
    const fixture = yield* setup()
    const sessions = yield* Effect.forEach(["build", "plan", "meta"] as const, (agent) => createSession(fixture, agent))
    const payload = { objective: "A saved acceptance requirement", conditions: [human], budget: {} }
    yield* Effect.forEach(
      sessions.filter((session) => session.agent !== Agent.ID.make("meta")),
      (session) =>
        Effect.gen(function* () {
          const response = yield* fixture.request(`/api/session/${session.id}/goal`, { body: payload })
          expect(response.status).toBe(400)
          expect(yield* Effect.promise(() => response.json())).toMatchObject({ _tag: "InvalidRequestError" })
        }),
    )
    const meta = sessions.find((session) => session.agent === Agent.ID.make("meta"))
    if (!meta) return yield* Effect.die(new Error("The HTTP fixture did not create its Meta Session"))
    const path = `/api/session/${meta.id}/goal`
    const duplicate = yield* fixture.request(path, { body: { ...payload, conditions: [human, human] } })
    expect(duplicate.status).toBe(400)
    expect(yield* Effect.promise(() => duplicate.json())).toMatchObject({
      _tag: "InvalidRequestError",
      field: "goal",
      kind: "duplicate_condition",
    })
    const command = yield* fixture.request(path, {
      body: {
        ...payload,
        conditions: [
          { id: "command", kind: "command_result", command: "bun test", cwd: "relative", exit: 0, outputIncludes: [] },
        ],
      },
    })
    expect(command.status).toBe(400)
    expect(yield* Effect.promise(() => command.json())).toMatchObject({
      _tag: "InvalidRequestError",
      field: "goal",
      kind: "invalid_command_condition",
    })
    expect((yield* fixture.request(path, { body: { ...payload, budget: { rounds: 0 } } })).status).toBe(400)
    const missing = yield* fixture.request(`${path}/${SessionGoal.ID.create()}`)
    expect(missing.status).toBe(200)
    expect(yield* Effect.promise(() => missing.json())).toEqual({ data: null })
    const unknownSession = yield* fixture.request(`/api/session/${Session.ID.create()}/goal`)
    expect(unknownSession.status).toBe(404)
    expect(yield* Effect.promise(() => unknownSession.json())).toMatchObject({ _tag: "SessionNotFoundError" })
    const listed = yield* fixture.request(path)
    expect(goalsResponse(yield* Effect.promise(() => listed.json())).data).toEqual([])
    expect(yield* fixture.llm.requests()).toHaveLength(0)
  }),
)
