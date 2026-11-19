import { expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { Agent } from "@aigcfroge/core/agent"
import { Location } from "@aigcfroge/core/location"
import { Model } from "@aigcfroge/core/model"
import { Provider } from "@aigcfroge/core/provider"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { MetaAgent } from "@aigcfroge/schema/meta-agent"
import { SessionCommunication } from "@aigcfroge/schema/session-communication"
import { useOfflineCatalog } from "../../core/test/fixture/models"
import { testEffect } from "../../core/test/lib/effect"
import { AssetHttpFixture } from "./fixture/asset-http"

const it = testEffect(Layer.empty)
const model = Model.Ref.make({ id: Model.ID.make("communication-http"), providerID: Provider.ID.make("test") })
const setup = Effect.fnUntraced(function* () {
  const fixture = yield* AssetHttpFixture.setup({
    prefix: "communication-http-",
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
  const location = Location.Ref.make({ directory: AbsolutePath.make(fixture.directory) })
  const first = yield* fixture.sessions.create({
    location,
    agent: Agent.ID.make("meta"),
    model,
    executorPreference: new MetaAgent.ExecutorPreference({ agent: Agent.defaultID, model }),
  })
  const second = yield* fixture.sessions.create({
    location,
    agent: Agent.ID.make("meta"),
    model,
    executorPreference: new MetaAgent.ExecutorPreference({ agent: Agent.defaultID, model }),
  })
  const build = yield* fixture.sessions.create({ location, agent: Agent.defaultID, model })
  return { ...fixture, first, second, build }
})

it.live("serves authenticated communication send/reply/read/list from the original Inbox record", () =>
  Effect.gen(function* () {
    const fixture = yield* setup()
    const firstPath = `/api/session/${fixture.first.id}/communication`
    const secondPath = `/api/session/${fixture.second.id}/communication`
    expect((yield* fixture.request(firstPath, { authenticated: false })).status).toBe(401)
    const payload = {
      id: SessionCommunication.ID.create(),
      targetSessionID: fixture.second.id,
      content: { type: "text", text: "HTTP retained message 🚀" },
      trigger: false,
    }
    const sent = yield* fixture.request(firstPath, { body: payload })
    expect(sent.status).toBe(200)
    const receipt = Schema.decodeUnknownSync(Schema.Struct({ data: SessionCommunication.Receipt }))(
      yield* Effect.promise(() => sent.json()),
    ).data
    expect(receipt).toMatchObject({
      state: "pending",
      actor: { type: "user", sessionID: fixture.first.id },
      targetSessionID: fixture.second.id,
    })
    const retry = yield* fixture.request(firstPath, { body: payload })
    expect(retry.status).toBe(200)
    expect(
      Schema.decodeUnknownSync(Schema.Struct({ data: SessionCommunication.Receipt }))(
        yield* Effect.promise(() => retry.json()),
      ).data.body,
    ).toEqual(receipt.body)
    const listed = yield* fixture.request(secondPath)
    expect(listed.status).toBe(200)
    expect(
      Schema.decodeUnknownSync(Schema.Struct({ data: SessionCommunication.Page }))(
        yield* Effect.promise(() => listed.json()),
      ).data.items[0]?.id,
    ).toBe(receipt.id)
    const read = yield* fixture.request(`${secondPath}/${receipt.id}`)
    expect(read.status).toBe(200)
    expect(
      Schema.decodeUnknownSync(Schema.Struct({ data: SessionCommunication.Message }))(
        yield* Effect.promise(() => read.json()),
      ).data.text,
    ).toBe(receipt.text)
    const reply = yield* fixture.request(`${secondPath}/${receipt.id}/reply`, {
      body: {
        id: SessionCommunication.ID.create(),
        content: { type: "text", text: "HTTP actual reply" },
        trigger: false,
      },
    })
    expect(reply.status).toBe(200)
    const response = Schema.decodeUnknownSync(Schema.Struct({ data: SessionCommunication.Receipt }))(
      yield* Effect.promise(() => reply.json()),
    ).data
    expect(response).toMatchObject({
      replyTo: receipt.id,
      targetSessionID: fixture.first.id,
      actor: { sessionID: fixture.second.id },
    })
    expect(
      (yield* fixture.request(firstPath, {
        body: { ...payload, content: { type: "text", text: "Conflicting retry" } },
      })).status,
    ).toBe(409)
    expect(
      (yield* fixture.request(`/api/session/${fixture.build.id}/communication`, {
        body: { ...payload, id: SessionCommunication.ID.create() },
      })).status,
    ).toBe(400)
    expect((yield* fixture.request(`/api/session/${fixture.build.id}/communication/${receipt.id}`)).status).toBe(400)
    expect(yield* fixture.llm.requests()).toHaveLength(0)
  }),
)
