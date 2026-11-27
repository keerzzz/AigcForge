import { expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Layer, Schema } from "effect"
import { TestLLM } from "@omnixa/ai/testing"
import { Model } from "@omnixa/core/model"
import { Provider } from "@omnixa/core/provider"
import { SessionInputResult } from "@omnixa/core/session/input-result"
import { SessionMessage } from "@omnixa/core/session/message"
import { DeliveryTable, ScheduleTable } from "@omnixa/core/session/schedule.sql"
import { SessionInboxTable } from "@omnixa/core/session/sql"
import { InvalidRequestError } from "@omnixa/protocol/errors"
import { Schedule } from "@omnixa/schema/schedule"
import { Session } from "@omnixa/schema/session"
import { SessionIdentity } from "@omnixa/schema/session-identity"
import { SessionTask } from "@omnixa/schema/session-task"
import { useOfflineCatalog } from "../../core/test/fixture/models"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../../core/test/lib/effect"
import { AssetHttpFixture } from "./fixture/asset-http"

const it = testEffect(Layer.empty)
const model = Model.Ref.make({ id: Model.ID.make("schedule-fixture"), providerID: Provider.ID.make("test") })
const setup = () =>
  AssetHttpFixture.setup({ prefix: "omnixa-schedule-http-", assetDirectory: ".omnixa", files: [], model })
const registerCatalog = (fixture: Effect.Success<ReturnType<typeof setup>>) =>
  useOfflineCatalog([
    {
      info: Provider.Info.make({
        ...Provider.Info.empty(model.providerID),
        activation: "enabled",
        package: "@omnixa/ai/providers/openai/responses",
      }),
      models: [Model.Info.make(Model.Info.default(model.providerID, model.id))],
    },
  ]).pipe(Effect.provideContext(fixture.local))

it.live("AC17 serves Schedule rules and the six retained reminder endpoints without a model call", () =>
  Effect.gen(function* () {
    const fixture = yield* setup()
    const createdSession = yield* fixture.request("/api/session", {
      body: {
        location: { directory: fixture.directory },
        mode: "assistant",
        agent: "build",
      },
    })
    expect(createdSession.status).toBe(200)
    const source = Schema.decodeUnknownSync(Schema.Struct({ data: Session.Info }))(
      yield* Effect.promise(() => createdSession.json()),
    ).data
    expect((yield* fixture.request("/schedule/pending", { authenticated: false })).status).toBe(401)
    const created = yield* fixture.request("/schedule/rule", {
      body: {
        sessionID: source.id,
        kind: "reminder",
        content: "HTTP reminder",
        dueAt: Date.now() + 60_000,
        timezone: "UTC",
      },
    })
    expect(created.status).toBe(200)
    const rule = Schema.decodeUnknownSync(Schedule.Rule)(yield* Effect.promise(() => created.json()))
    const pending = yield* fixture.request("/schedule/pending")
    expect(pending.status).toBe(200)
    expect(
      Schema.decodeUnknownSync(Schema.Array(Schedule.Info))(yield* Effect.promise(() => pending.json())),
    ).toHaveLength(1)
    const listed = yield* fixture.request(`/schedule/${source.id}`)
    expect(
      Schema.decodeUnknownSync(Schema.Array(Schedule.Info))(yield* Effect.promise(() => listed.json()))[0]?.id,
    ).toBe(rule.id)
    const read = yield* fixture.request(`/schedule/rule/${rule.id}`)
    expect(Schema.decodeUnknownSync(Schedule.Rule)(yield* Effect.promise(() => read.json())).revision).toBe(
      rule.revision,
    )
    const claimed = yield* fixture.request(`/schedule/rule/${rule.id}/run`, {
      body: { expectedRevision: rule.revision },
    })
    expect(claimed.status).toBe(200)
    const run = Schema.decodeUnknownSync(Schedule.Occurrence)(yield* Effect.promise(() => claimed.json()))
    const completed = yield* pollWithTimeout(
      Effect.gen(function* () {
        const response = yield* fixture.request(`/schedule/rule/${rule.id}/runs`)
        expect(response.status).toBe(200)
        return Schema.decodeUnknownSync(Schema.Array(Schedule.Occurrence))(
          yield* Effect.promise(() => response.json()),
        ).find((item) => item.id === run.id && item.status === "completed")
      }),
      "The reminder occurrence did not commit its Delivery",
    )
    expect(completed.deliveryKey).toBeDefined()
    const recent = yield* fixture.request("/delivery/recent")
    expect(
      Schema.decodeUnknownSync(Schema.Array(Schedule.Delivery))(yield* Effect.promise(() => recent.json())),
    ).toHaveLength(1)
    const inbox = yield* fixture.request(`/delivery/${source.id}`)
    const delivery = Schema.decodeUnknownSync(Schema.Array(Schedule.Delivery))(
      yield* Effect.promise(() => inbox.json()),
    )[0]
    if (!delivery) return yield* Effect.die(new Error("Expected one delivery"))
    expect(delivery.content).toBe("HTTP reminder")
    expect(
      (yield* fixture.request(`/delivery/${encodeURIComponent(delivery.deliveryKey)}/read`, { body: {} })).status,
    ).toBe(200)
    expect((yield* fixture.database.db.select().from(DeliveryTable).get())?.is_read).toBe(true)
    const next = yield* fixture.request("/schedule/rule", {
      body: {
        sessionID: source.id,
        kind: "reminder",
        content: "cancel me",
        dueAt: Date.now() + 60_000,
        timezone: "UTC",
      },
    })
    const cancellation = Schema.decodeUnknownSync(Schedule.Rule)(yield* Effect.promise(() => next.json()))
    const cancelled = yield* fixture.request(`/schedule/${cancellation.id}/cancel`, { body: {} })
    expect(cancelled.status).toBe(200)
    expect(Schema.decodeUnknownSync(Schedule.Info)(yield* Effect.promise(() => cancelled.json())).status).toBe(
      "cancelled",
    )
    expect((yield* fixture.request("/schedule/sch_missing/cancel", { body: {} })).status).toBe(400)
    expect(yield* fixture.llm.requests()).toHaveLength(0)
    return undefined
  }),
)

it.live("AC01 rejects Build root coordination and caller-supplied legacy child targets", () =>
  Effect.gen(function* () {
    const fixture = yield* setup()
    const created = yield* fixture.request("/api/session", {
      body: { location: { directory: fixture.directory }, agent: "build" },
    })
    expect(created.status).toBe(200)
    const source = Schema.decodeUnknownSync(Schema.Struct({ data: Session.Info }))(
      yield* Effect.promise(() => created.json()),
    ).data
    const payload = {
      sessionID: source.id,
      kind: "prompt",
      content: "cross-session work",
      dueAt: Date.now() + 60_000,
      timezone: "UTC",
      target: { policy: "existing", sessionID: source.id },
    }
    expect((yield* fixture.request("/schedule/rule", { body: payload })).status).toBe(400)
    expect(
      (yield* fixture.request("/schedule/rule", {
        body: { ...payload, target: { policy: "legacy_child", agentID: "build" } },
      })).status,
    ).toBe(400)
    const rules = yield* fixture.request(`/schedule/rules/${source.id}`)
    expect(
      Schema.decodeUnknownSync(Schema.Array(Schedule.Rule))(yield* Effect.promise(() => rules.json())),
    ).toHaveLength(0)
    yield* registerCatalog(fixture)
    const createdMeta = yield* fixture.request("/api/session", {
      body: {
        location: { directory: fixture.directory },
        agent: "meta",
        model,
      },
    })
    expect(createdMeta.status).toBe(200)
    const meta = Schema.decodeUnknownSync(Schema.Struct({ data: Session.Info }))(
      yield* Effect.promise(() => createdMeta.json()),
    ).data
    const identity = yield* fixture.request(`/session/${meta.id}/identity`)
    expect(identity.status).toBe(200)
    expect(
      Schema.decodeUnknownSync(SessionIdentity.Identity)(yield* Effect.promise(() => identity.json())).coordination,
    ).toMatchObject({ available: true, reasons: [], selection: { agent: "meta" } })
    const beforeLegacy = {
      rules: yield* fixture.database.db.select().from(ScheduleTable).all().pipe(Effect.orDie),
      inputs: yield* fixture.database.db.select().from(SessionInboxTable).all().pipe(Effect.orDie),
    }
    const legacy = { ...payload, sessionID: meta.id, target: { policy: "legacy_child", agentID: "build" } }
    const rejected = yield* fixture.request("/schedule/rule", { body: legacy })
    expect(rejected.status).toBe(400)
    const schemaError = yield* Schema.decodeUnknownEffect(Schedule.Create)(legacy).pipe(Effect.flip)
    expect(Schema.decodeUnknownSync(InvalidRequestError)(yield* Effect.promise(() => rejected.json()))).toMatchObject({
      _tag: "InvalidRequestError",
      kind: "Payload",
      message: schemaError.message,
    })
    expect(yield* fixture.database.db.select().from(ScheduleTable).all().pipe(Effect.orDie)).toEqual(beforeLegacy.rules)
    expect(yield* fixture.database.db.select().from(SessionInboxTable).all().pipe(Effect.orDie)).toEqual(
      beforeLegacy.inputs,
    )
    expect(yield* fixture.llm.requests()).toHaveLength(0)
  }),
)

it.live("executes a scheduled prompt rule through HTTP and settles the same Occurrence from the target result", () =>
  Effect.gen(function* () {
    const fixture = yield* setup()
    yield* registerCatalog(fixture)
    const metaResponse = yield* fixture.request("/api/session", {
      body: { title: "Schedule Meta HTTP", location: { directory: fixture.directory }, agent: "meta", model },
    })
    expect(metaResponse.status).toBe(200)
    const meta = Schema.decodeUnknownSync(Schema.Struct({ data: Session.Info }))(
      yield* Effect.promise(() => metaResponse.json()),
    ).data
    const targetResponse = yield* fixture.request("/api/session", {
      body: {
        title: "Schedule Target HTTP",
        location: { directory: fixture.directory },
        mode: "coding",
        agent: "build",
        model,
      },
    })
    expect(targetResponse.status).toBe(200)
    const target = Schema.decodeUnknownSync(Schema.Struct({ data: Session.Info }))(
      yield* Effect.promise(() => targetResponse.json()),
    ).data
    const promptText = "Run the scheduled coding prompt"
    const targetOutput = "Scheduled prompt execution finished."
    const metaOutput = "Meta consumed the scheduled task result."
    yield* fixture.llm.push(
      TestLLM.textWithUsage(targetOutput, "schedule-target-done", 4),
      TestLLM.textWithUsage(metaOutput, "schedule-meta-done", 3),
    )
    const createdRule = yield* fixture.request("/schedule/rule", {
      body: {
        sessionID: meta.id,
        kind: "prompt",
        content: promptText,
        dueAt: Date.now() + 60_000,
        timezone: "UTC",
        target: { policy: "existing", sessionID: target.id },
      },
    })
    expect(createdRule.status).toBe(200)
    const rule = Schema.decodeUnknownSync(Schedule.Rule)(yield* Effect.promise(() => createdRule.json()))
    const triggered = yield* fixture.request(`/schedule/rule/${rule.id}/run`, {
      body: { expectedRevision: rule.revision },
    })
    expect(triggered.status).toBe(200)
    const run = Schema.decodeUnknownSync(Schedule.Occurrence)(yield* Effect.promise(() => triggered.json()))
    expect(run.ruleRevision).toBe(rule.revision)
    yield* awaitWithTimeout(fixture.llm.wait(2), "The scheduled prompt and its receipt did not reach the model")
    expect(
      (yield* awaitWithTimeout(
        fixture.request(`/api/experimental/session/${target.id}/wait`, { method: "POST" }),
        "Target session did not finish draining",
      )).status,
    ).toBe(204)
    expect(
      (yield* awaitWithTimeout(
        fixture.request(`/api/experimental/session/${meta.id}/wait`, { method: "POST" }),
        "Meta session did not finish draining",
      )).status,
    ).toBe(204)
    const settled = yield* pollWithTimeout(
      Effect.gen(function* () {
        const response = yield* fixture.request(`/schedule/rule/${rule.id}/runs`)
        expect(response.status).toBe(200)
        return Schema.decodeUnknownSync(Schema.Array(Schedule.Occurrence))(
          yield* Effect.promise(() => response.json()),
        ).find((item) => item.id === run.id && item.status === "completed" && item.sourceSettlement === "completed")
      }),
      "The scheduled prompt occurrence did not settle with its target result",
    )
    expect(settled).toMatchObject({
      id: run.id,
      scheduleID: rule.id,
      operationID: run.operationID,
      inputID: run.inputID,
      targetSessionID: target.id,
      status: "completed",
      sourceSettlement: "completed",
      output: targetOutput,
      admission: {
        targetSessionID: target.id,
        inputID: run.inputID,
        operationID: run.operationID,
      },
      result: {
        sessionID: target.id,
        inputID: run.inputID,
        text: targetOutput,
      },
    })
    const finalRuleResponse = yield* fixture.request(`/schedule/rule/${rule.id}`)
    expect(finalRuleResponse.status).toBe(200)
    const finalRule = Schema.decodeUnknownSync(Schedule.Rule)(yield* Effect.promise(() => finalRuleResponse.json()))
    expect(finalRule).toMatchObject({
      id: rule.id,
      status: "completed",
      taskID: settled.taskID,
    })
    expect(finalRule.activeOccurrenceID).toBeUndefined()
    const operationResponse = yield* fixture.request(`/session/${meta.id}/task/operations/${run.operationID}`)
    expect(operationResponse.status).toBe(200)
    const operation = Schema.decodeUnknownSync(SessionTask.OperationInfo)(
      yield* Effect.promise(() => operationResponse.json()),
    )
    expect(operation).toMatchObject({
      operationID: run.operationID,
      inputID: run.inputID,
      targetSessionID: target.id,
      taskID: settled.taskID,
      phase: "settled",
      sourceSettlement: "settled",
    })
    const tasksResponse = yield* fixture.request(`/session/${meta.id}/task`)
    expect(tasksResponse.status).toBe(200)
    expect(
      Schema.decodeUnknownSync(Schema.Array(SessionTask.Info))(yield* Effect.promise(() => tasksResponse.json())).find(
        (task) => task.id === settled.taskID,
      ),
    ).toMatchObject({
      id: settled.taskID,
      status: "completed",
      operationRef: { sourceSessionID: meta.id, operationID: run.operationID },
    })
    const inputResult = yield* SessionInputResult.read(fixture.database.db, {
      sessionID: target.id,
      inputID: SessionMessage.ID.make(run.inputID),
    })
    if (inputResult.status !== "completed") throw new Error(`Scheduled input ended as ${inputResult.status}`)
    expect(inputResult.sharedInputs).toEqual([run.inputID])
    expect(settled.result?.messageIDs).toEqual([inputResult.assistant.id])
    expect(operation.result).toEqual(settled.result)
    const targetMessagesResponse = yield* fixture.request(`/api/session/${target.id}/message?order=asc`)
    expect(targetMessagesResponse.status).toBe(200)
    const targetMessages = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Array(SessionMessage.Info) }))(
      yield* Effect.promise(() => targetMessagesResponse.json()),
    ).data
    expect(targetMessages.find((item) => item.id === run.inputID)).toMatchObject({
      type: "user",
      text: promptText,
    })
    expect(targetMessages.find((item) => item.id === inputResult.assistant.id)).toMatchObject({
      type: "assistant",
      content: expect.arrayContaining([expect.objectContaining({ type: "text", text: targetOutput })]),
    })
    const metaMessagesResponse = yield* fixture.request(`/api/session/${meta.id}/message?order=asc`)
    expect(metaMessagesResponse.status).toBe(200)
    const metaMessages = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Array(SessionMessage.Info) }))(
      yield* Effect.promise(() => metaMessagesResponse.json()),
    ).data
    const notice = metaMessages
      .filter((item) => item.type === "synthetic")
      .find((item) => item.text.includes(`<task operation="${run.operationID}" state="settled">`))
    if (!notice) throw new Error(`No completion notice for ${run.operationID}`)
    expect(notice.text).toContain(targetOutput)
    expect(
      yield* fixture.database.db
        .select()
        .from(SessionInboxTable)
        .where(eq(SessionInboxTable.session_id, target.id))
        .all()
        .pipe(Effect.orDie),
    ).toEqual([])
    expect(
      yield* fixture.database.db
        .select()
        .from(SessionInboxTable)
        .where(eq(SessionInboxTable.session_id, meta.id))
        .all()
        .pipe(Effect.orDie),
    ).toEqual([])
    const requests = yield* fixture.llm.requests()
    expect(requests).toHaveLength(2)
    expect(requests[0].messages.find((message) => message.id === run.inputID)).toMatchObject({
      role: "user",
      content: expect.arrayContaining([expect.objectContaining({ type: "text", text: promptText })]),
    })
    expect(requests[1].messages.find((message) => message.id === notice.id)).toMatchObject({
      role: "user",
      content: expect.arrayContaining([expect.objectContaining({ type: "text", text: notice.text })]),
    })
  }),
)
