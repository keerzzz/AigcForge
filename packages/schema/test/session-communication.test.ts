import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { SessionCommunication } from "../src/session-communication.js"
import { SessionEvent } from "../src/session-event.js"
import { SessionID } from "../src/session-id.js"
import { SessionMessage } from "../src/session-message.js"

describe("SessionCommunication canonical contracts", () => {
  test("generates and validates its exact public ID prefix", () => {
    expect(SessionCommunication.ID.create()).toStartWith("com_")
    expect(() => SessionCommunication.ID.make("comwrong")).toThrow()
    expect(() => SessionCommunication.Digest.make("not-a-digest")).toThrow()
  })

  test("keeps public intent separate from trusted actor and carrier provenance", () => {
    const id = SessionCommunication.ID.create()
    const request = new SessionCommunication.Send({
      id,
      targetSessionID: SessionID.make("ses_target"),
      content: new SessionCommunication.TextContent({ type: "text", text: "message" }),
      delivery: undefined,
      trigger: undefined,
    })
    expect(Schema.encodeSync(SessionCommunication.Send)(request)).toEqual({
      id,
      targetSessionID: "ses_target",
      content: { type: "text", text: "message" },
    })
    expect(Object.keys(SessionCommunication.Send.fields)).not.toContain("actor")
    expect(Object.keys(SessionCommunication.Reply.fields)).not.toContain("targetSessionID")
    const record = new SessionCommunication.Record({
      id,
      actor: new SessionCommunication.UserActor({ type: "user", sessionID: SessionID.make("ses_actor") }),
      contentSource: new SessionCommunication.ContentSource({
        sessionID: SessionID.make("ses_content"),
        scope: "output",
      }),
      targetSessionID: request.targetSessionID,
      body: new SessionCommunication.BodyRef({
        sessionID: request.targetSessionID,
        inputID: SessionMessage.ID.make("msg_carrier"),
        digest: SessionCommunication.Digest.make("a".repeat(64)),
      }),
      requestDigest: SessionCommunication.Digest.make("b".repeat(64)),
      delivery: "queue",
      trigger: false,
      createdAt: 10,
    })
    const event = Schema.decodeUnknownSync(SessionEvent.InboxEnqueued.data)({
      sessionID: request.targetSessionID,
      inboxID: record.body.inputID,
      item: { type: "synthetic", payload: { text: "message" }, delivery: "queue" },
      communication: Schema.encodeSync(SessionCommunication.Record)(record),
    })
    expect(event.communication).toBeInstanceOf(SessionCommunication.Record)
    expect(event.communication?.actor.sessionID).toBe(SessionID.make("ses_actor"))
    expect(event.communication?.contentSource.sessionID).toBe(SessionID.make("ses_content"))
    expect(Schema.encodeSync(SessionCommunication.Record)(record)).not.toHaveProperty("replyTo")
  })
})
