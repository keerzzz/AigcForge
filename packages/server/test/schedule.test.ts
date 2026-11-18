import { expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { Model } from "@aigcfroge/core/model"
import { Provider } from "@aigcfroge/core/provider"
import { DeliveryTable, ScheduleTable } from "@aigcfroge/core/session/schedule.sql"
import { SessionInboxTable } from "@aigcfroge/core/session/sql"
import { InvalidRequestError } from "@aigcfroge/protocol/errors"
import { Schedule } from "@aigcfroge/schema/schedule"
import { Session } from "@aigcfroge/schema/session"
import { SessionIdentity } from "@aigcfroge/schema/session-identity"
import { useOfflineCatalog } from "../../core/test/fixture/models"
import { pollWithTimeout, testEffect } from "../../core/test/lib/effect"
import { AssetHttpFixture } from "./fixture/asset-http"

const it = testEffect(Layer.empty)
const model = Model.Ref.make({ id: Model.ID.make("schedule-fixture"), providerID: Provider.ID.make("test") })
const setup = () =>
  AssetHttpFixture.setup({ prefix: "aigcfroge-schedule-http-", assetDirectory: ".aigcfroge", files: [], model })

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
