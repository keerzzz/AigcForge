import { expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Layer, Schema } from "effect"
import { TestLLM } from "@omnixa/ai/testing"
import { Agent } from "@omnixa/core/agent"
import { Location } from "@omnixa/core/location"
import { Model } from "@omnixa/core/model"
import { Provider } from "@omnixa/core/provider"
import { AbsolutePath } from "@omnixa/core/schema"
import { SessionMessage } from "@omnixa/core/session/message"
import { SessionInboxTable } from "@omnixa/core/session/sql"
import { MetaAgent } from "@omnixa/schema/meta-agent"
import { SessionCommunication } from "@omnixa/schema/session-communication"
import { useOfflineCatalog } from "../../core/test/fixture/models"
import { awaitWithTimeout, testEffect } from "../../core/test/lib/effect"
import { AssetHttpFixture } from "./fixture/asset-http"

const it = testEffect(Layer.empty)
const model = Model.Ref.make({ id: Model.ID.make("communication-http"), providerID: Provider.ID.make("test") })
const setup = Effect.fnUntraced(function* () {
  const fixture = yield* AssetHttpFixture.setup({
    prefix: "communication-http-",
    assetDirectory: ".omnixa",
    files: [],
    model,
  })
  yield* useOfflineCatalog([
    {
      info: Provider.Info.make({
        ...Provider.Info.empty(model.providerID),
        activation: "enabled",
        package: "@omnixa/ai/providers/openai/responses",
      }),
      models: [Model.Info.make(Model.Info.default(model.providerID, model.id))],
    },
  ]).pipe(Effect.provideContext(fixture.local))
  const location = Location.Ref.make({ directory: AbsolutePath.make(fixture.directory) })
  const first = yield* fixture.sessions.create({
    location,
    title: "Communication First Meta",
    agent: Agent.ID.make("meta"),
    model,
    executorPreference: new MetaAgent.ExecutorPreference({ agent: Agent.defaultID, model }),
  })
  const second = yield* fixture.sessions.create({
    location,
    title: "Communication Second Meta",
    agent: Agent.ID.make("meta"),
    model,
    executorPreference: new MetaAgent.ExecutorPreference({ agent: Agent.defaultID, model }),
  })
  const build = yield* fixture.sessions.create({
    location,
    title: "Communication Build",
    agent: Agent.defaultID,
    model,
  })
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

it.live("wakes the target session on trigger=true, consumes the message, and links replies to the exact replyTo", () =>
  Effect.gen(function* () {
    const fixture = yield* setup()
    const firstPath = `/api/session/${fixture.first.id}/communication`
    const secondPath = `/api/session/${fixture.second.id}/communication`
    const inboundText = "Please verify the HTTP communication wake"
    const toolReplyText = "Target consumed message and replied via share tool"
    const httpReplyText = "HTTP follow-up reply consumed by sender"
    const communicationID = SessionCommunication.ID.create()
    yield* fixture.llm.push(
      TestLLM.tool("share-reply-1", "share", {
        scope: "text",
        text: toolReplyText,
        replyTo: communicationID,
        trigger: false,
      }),
      TestLLM.text("Target finished consuming and replying.", "second-reply-done"),
    )
    const sent = yield* fixture.request(firstPath, {
      body: {
        id: communicationID,
        targetSessionID: fixture.second.id,
        content: { type: "text", text: inboundText },
        trigger: true,
      },
    })
    expect(sent.status).toBe(200)
    const receipt = Schema.decodeUnknownSync(Schema.Struct({ data: SessionCommunication.Receipt }))(
      yield* Effect.promise(() => sent.json()),
    ).data
    expect(receipt).toMatchObject({
      state: "pending",
      admission: "admitted",
      wake: "requested",
      actor: { type: "user", sessionID: fixture.first.id },
      targetSessionID: fixture.second.id,
    })
    yield* awaitWithTimeout(fixture.llm.wait(2), "Target session did not consume the communication and run share reply")
    expect(
      (yield* awaitWithTimeout(
        fixture.request(`/api/experimental/session/${fixture.second.id}/wait`, { method: "POST" }),
        "Target session did not finish draining",
      )).status,
    ).toBe(204)
    const consumedResponse = yield* fixture.request(`${secondPath}/${receipt.id}`)
    expect(consumedResponse.status).toBe(200)
    expect(
      Schema.decodeUnknownSync(Schema.Struct({ data: SessionCommunication.Message }))(
        yield* Effect.promise(() => consumedResponse.json()),
      ).data,
    ).toMatchObject({
      id: receipt.id,
      state: "visible",
      text: inboundText,
      actor: { type: "user", sessionID: fixture.first.id },
      targetSessionID: fixture.second.id,
    })
    expect(
      yield* fixture.database.db
        .select()
        .from(SessionInboxTable)
        .where(eq(SessionInboxTable.session_id, fixture.second.id))
        .all()
        .pipe(Effect.orDie),
    ).toEqual([])
    const secondMessagesResponse = yield* fixture.request(`/api/session/${fixture.second.id}/message?order=asc`)
    expect(secondMessagesResponse.status).toBe(200)
    const secondMessages = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Array(SessionMessage.Info) }))(
      yield* Effect.promise(() => secondMessagesResponse.json()),
    ).data
    expect(secondMessages.find((item) => item.id === receipt.body.inputID)).toMatchObject({
      type: "synthetic",
      text: inboundText,
    })
    const firstInboxList = yield* fixture.request(firstPath)
    expect(firstInboxList.status).toBe(200)
    const toolReply = Schema.decodeUnknownSync(Schema.Struct({ data: SessionCommunication.Page }))(
      yield* Effect.promise(() => firstInboxList.json()),
    ).data.items.find((item) => item.replyTo === receipt.id)
    expect(toolReply).toMatchObject({
      replyTo: receipt.id,
      state: "pending",
      text: toolReplyText,
      actor: { type: "tool", sessionID: fixture.second.id, agent: "meta" },
      targetSessionID: fixture.first.id,
    })
    yield* fixture.llm.push(
      TestLLM.text("Sender consumed the tool reply.", "first-tool-reply-done"),
      TestLLM.text("Sender consumed the HTTP reply.", "first-reply-done"),
    )
    const httpReplyResponse = yield* fixture.request(`${secondPath}/${receipt.id}/reply`, {
      body: {
        id: SessionCommunication.ID.create(),
        content: { type: "text", text: httpReplyText },
        trigger: true,
      },
    })
    expect(httpReplyResponse.status).toBe(200)
    const httpReply = Schema.decodeUnknownSync(Schema.Struct({ data: SessionCommunication.Receipt }))(
      yield* Effect.promise(() => httpReplyResponse.json()),
    ).data
    expect(httpReply).toMatchObject({
      replyTo: receipt.id,
      admission: "admitted",
      wake: "requested",
      actor: { type: "user", sessionID: fixture.second.id },
      targetSessionID: fixture.first.id,
    })
    yield* awaitWithTimeout(fixture.llm.wait(4), "Sender session did not consume both replies")
    expect(
      (yield* awaitWithTimeout(
        fixture.request(`/api/experimental/session/${fixture.first.id}/wait`, { method: "POST" }),
        "Sender session did not finish draining",
      )).status,
    ).toBe(204)
    expect(
      yield* fixture.database.db
        .select()
        .from(SessionInboxTable)
        .where(eq(SessionInboxTable.session_id, fixture.first.id))
        .all()
        .pipe(Effect.orDie),
    ).toEqual([])
    const readToolReply = yield* fixture.request(`${firstPath}/${toolReply?.id}`)
    expect(readToolReply.status).toBe(200)
    expect(
      Schema.decodeUnknownSync(Schema.Struct({ data: SessionCommunication.Message }))(
        yield* Effect.promise(() => readToolReply.json()),
      ).data,
    ).toMatchObject({
      id: toolReply?.id,
      replyTo: receipt.id,
      state: "visible",
      text: toolReplyText,
      actor: { type: "tool", sessionID: fixture.second.id, agent: "meta" },
      targetSessionID: fixture.first.id,
    })
    const readHttpReply = yield* fixture.request(`${firstPath}/${httpReply.id}`)
    expect(readHttpReply.status).toBe(200)
    expect(
      Schema.decodeUnknownSync(Schema.Struct({ data: SessionCommunication.Message }))(
        yield* Effect.promise(() => readHttpReply.json()),
      ).data,
    ).toMatchObject({
      id: httpReply.id,
      replyTo: receipt.id,
      state: "visible",
      text: httpReplyText,
      actor: { type: "user", sessionID: fixture.second.id },
      targetSessionID: fixture.first.id,
    })
    const requests = yield* fixture.llm.requests()
    expect(requests).toHaveLength(4)
    expect(JSON.stringify(requests[0].messages)).toContain(inboundText)
    expect(JSON.stringify(requests[2].messages)).toContain(toolReplyText)
    expect(JSON.stringify(requests[3].messages)).toContain(httpReplyText)
  }),
)
