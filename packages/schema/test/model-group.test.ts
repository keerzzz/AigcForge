import { expect, test } from "bun:test"
import { Schema } from "effect"
import { ModelGroup } from "../src/model-group.js"
import { ProviderDefinition } from "../src/provider-definition.js"
import { Session } from "../src/session.js"
import { SessionMessage } from "../src/session-message.js"
import { SessionMessageID } from "../src/session-message-id.js"
import { SessionGoal } from "../src/session-goal.js"
import { SessionGoalID } from "../src/session-goal-id.js"
import { SessionEvent } from "../src/session-event.js"
import { SessionAttempt } from "../src/session-attempt.js"
import { ModelSource } from "../src/model-source.js"

test("P4 members preserve explicit connections and positive weights with historical defaults", () => {
  const member = { providerID: "a", id: "one" }
  const decode = Schema.decodeUnknownSync(ModelGroup.Member)
  expect(Schema.encodeSync(ModelGroup.Member)(decode(member))).toEqual(member)
  expect(Schema.encodeSync(ModelGroup.Member)(decode({ ...member, connections: [] })).connections).toEqual([])
  const weighted = {
    ...member,
    weight: 2,
    connections: [{ ref: { type: "credential", id: "cred_one" }, weight: 1.5 }],
  } satisfies typeof ModelGroup.Member.Encoded
  expect(Schema.encodeSync(ModelGroup.Member)(decode(weighted))).toEqual(weighted)
  ;[0, -1, Number.NaN, Number.POSITIVE_INFINITY].forEach((weight) => {
    expect(() => decode({ ...member, weight })).toThrow()
    expect(() => decode({ ...member, connections: [{ ref: { type: "env", name: "API_KEY" }, weight }] })).toThrow()
  })
  const definition = {
    name: "Primary",
    enabled: true,
    members: [weighted],
    strategy: "weight",
    affinity: "session",
  } satisfies typeof ModelGroup.Definition.Encoded
  expect(Schema.encodeSync(ModelGroup.Definition)(Schema.decodeUnknownSync(ModelGroup.Definition)(definition))).toEqual(
    definition,
  )
})

test("group writes retain the original target contract and reject unrelated operations", () => {
  expect(ModelGroup.Target).toBe(ProviderDefinition.Target)
  expect(ModelGroup.TargetRevision).toBe(ProviderDefinition.TargetRevision)
  expect(ModelGroup.Source).toBe(ProviderDefinition.Source)
  const input = {
    groupID: "primary",
    target: { scope: "project", path: "/workspace/aigcfroge.jsonc" },
    expectedDigest: null,
    patch: {
      set: {
        members: [
          { providerID: "a", id: "one" },
          { providerID: "b", id: "two" },
        ],
      },
    },
  } satisfies typeof ModelGroup.SaveInput.Encoded
  expect(Schema.encodeSync(ModelGroup.SaveInput)(ModelGroup.decodeSave(input))).toEqual(input)
  expect(() => ModelGroup.decodeSave({ ...input, credential: { type: "create", key: "secret" } })).toThrow()
  expect(() => ModelGroup.decodeSave({ ...input, patch: { unset: ["members"] } })).toThrow()
  expect(Schema.encodeSync(ModelGroup.Patch)(new ModelGroup.Patch({ set: undefined }))).toEqual({})
})

test("attempt contracts preserve missing usage and real free quotes independently", () => {
  const started = {
    ordinal: 0,
    attemptID: "attempt-1",
    agent: "build",
    selection: { type: "group", groupID: "primary" },
    model: { providerID: "a", id: "one" },
    apiModelID: "api-one",
    quote: { status: "unknown" },
    goalRefs: [],
    transition: "initial",
    started: 100,
  }
  const value = Schema.decodeUnknownSync(SessionAttempt.Info)({
    ...started,
    observations: [],
    terminal: { status: "failed", ended: 200, outputStarted: false },
  })
  const encoded = Schema.encodeSync(SessionAttempt.Info)(value)
  expect(encoded.quote).toEqual({ status: "unknown" })
  expect(encoded.terminal).not.toHaveProperty("usage")
  expect(encoded.terminal).not.toHaveProperty("cost")
  expect(encoded).not.toHaveProperty("groupMemberIndex")
  expect(Schema.decodeUnknownSync(SessionAttempt.Info)({ ...started, groupMemberIndex: 1, observations: [] }).groupMemberIndex).toBe(1)
  expect(() => Schema.decodeUnknownSync(SessionAttempt.Info)({ ...started, groupMemberIndex: -1, observations: [] })).toThrow()
  expect(
    Schema.decodeUnknownSync(SessionAttempt.Info)({
      ...started,
      quote: { status: "free", prices: [] },
      observations: [],
    }).quote.status,
  ).toBe("free")
  expect(SessionEvent.Attempt.Started.type).toBe("session.attempt.started")
  expect(SessionEvent.Attempt.Observed.durability).toBe("durable")
  expect(SessionEvent.Attempt.Ended.durability).toBe("durable")
  const measured = Schema.decodeUnknownSync(SessionAttempt.Info)({
    ...started,
    observations: [{ observedAt: 150, firstTokenAt: 150, gatewayReport: { source: "response-headers", provider: "upstream", model: "early" }, event: { id: "evt_one", seq: 1 } }],
    terminal: { status: "completed", ended: 200, providerEndedAt: 190, outputStarted: true },
  })
  expect(measured.observations[0]?.firstTokenAt).toBe(150)
  expect(measured.observations[0]?.gatewayReport?.model).toBe("early")
  expect(measured.terminal?.providerEndedAt).toBe(190)
  const quota = { status: "known", source: "copilot", connection: { type: "credential", id: "cred_one" }, observedAt: 100, freshUntil: 200, windows: [{ id: "premium", unit: "requests", scope: "model", modelIDs: ["one"], usedRatio: 0.4, resetAt: 300 }] } satisfies typeof ModelSource.Quota.Encoded
  expect(Schema.encodeSync(ModelSource.Quota)(Schema.decodeUnknownSync(ModelSource.Quota)(quota))).toEqual(quota)
  expect(() => Schema.decodeUnknownSync(ModelSource.Quota)({ ...quota, windows: [{ id: "bad", unit: "requests", scope: "account", usedRatio: Number.NaN }] })).toThrow()
})

test("canonical leaf identities and group Session reads retain historical physical messages", () => {
  expect(SessionMessage.ID).toBe(SessionMessageID.ID)
  expect(SessionGoal.AttemptRef).toBe(SessionGoalID.AttemptRef)
  const session = Schema.decodeUnknownSync(Session.Info)({
    id: "ses_one",
    projectID: "global",
    model: { type: "group", groupID: "primary" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
    location: { directory: "/workspace" },
  })
  expect(Schema.encodeSync(Session.Info)(session).model).toEqual({ type: "group", groupID: "primary" })
  expect(session.unknownPriceAttempts).toBeUndefined()
  const assistant = Schema.decodeUnknownSync(SessionMessage.Assistant)({
    id: "msg_old",
    type: "assistant",
    agent: "build",
    model: { providerID: "a", id: "one" },
    content: [],
    time: { created: 0 },
  })
  expect(assistant.attempts).toBeUndefined()
  expect(() =>
    Schema.decodeUnknownSync(SessionMessage.Assistant)({
      ...Schema.encodeSync(SessionMessage.Assistant)(assistant),
      model: { type: "group", groupID: "primary" },
    }),
  ).toThrow()
})

test("creation and forks serialize frozen group behavior while old events omit it", () => {
  const groupBehavior = {
    groupID: "primary",
    members: [{ providerID: "a", id: "one" }],
    strategy: "order",
    affinity: "turn",
    behaviorDigest: "first",
  } satisfies typeof ModelGroup.BehaviorSnapshot.Encoded
  const created = {
    sessionID: "ses_one",
    projectID: "global",
    location: { directory: "/workspace" },
    slug: "one",
    version: "test",
    model: { type: "group", groupID: "primary" },
  }
  const forked = {
    sessionID: "ses_two",
    parentID: "ses_one",
    boundary: { type: "through", messageID: "msg_one" },
    model: { type: "group", groupID: "primary" },
  }
  const create = Schema.decodeUnknownSync(SessionEvent.Created.data)({ ...created, groupBehavior })
  const fork = Schema.decodeUnknownSync(SessionEvent.Forked.data)({ ...forked, groupBehavior })
  expect(Schema.encodeSync(SessionEvent.Created.data)(create).groupBehavior).toEqual(groupBehavior)
  expect(Schema.encodeSync(SessionEvent.Forked.data)(fork).groupBehavior).toEqual(groupBehavior)
  expect(
    Schema.encodeSync(SessionEvent.Created.data)(Schema.decodeUnknownSync(SessionEvent.Created.data)(created)),
  ).not.toHaveProperty("groupBehavior")
  expect(
    Schema.encodeSync(SessionEvent.Forked.data)(Schema.decodeUnknownSync(SessionEvent.Forked.data)(forked)),
  ).not.toHaveProperty("groupBehavior")
})
