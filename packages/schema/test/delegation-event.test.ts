import { describe, expect, test } from "bun:test"
import { Schema, SchemaAST } from "effect"
import { Delegation } from "../src/delegation.js"
import { DelegationEvent } from "../src/delegation-event.js"
import { DurableEventManifest } from "../src/durable-event-manifest.js"
import { EventManifest } from "../src/event-manifest.js"
import { Event } from "../src/event.js"

const fixtures = [
  { definition: DelegationEvent.Created, data: { parentSessionID: "ses_parent", title: "Review", status: "draft" } },
  {
    definition: DelegationEvent.ParticipantAdded,
    data: {
      participantID: "par_reviewer",
      provider: "internal",
      target: "review",
      role: "reviewer",
      context: "fresh",
      phase: "provisioning",
    },
  },
  { definition: DelegationEvent.ParticipantBound, data: { participantID: "par_reviewer" } },
  { definition: DelegationEvent.ParticipantInterrupted, data: { participantID: "par_reviewer" } },
  { definition: DelegationEvent.ParticipantClosed, data: { participantID: "par_reviewer" } },
  {
    definition: DelegationEvent.TurnAdmitted,
    data: { turnID: "trn_review", seq: 0, kind: "review", participantIDs: ["par_reviewer"], delivery: "steer" },
  },
  {
    definition: DelegationEvent.TurnAppended,
    data: { turnID: "trn_review", seq: 0, kind: "review", participantIDs: ["par_reviewer"], delivery: "queue" },
  },
  { definition: DelegationEvent.DeliveryAdmitted, data: { status: "admitted" } },
  { definition: DelegationEvent.DeliveryStarted, data: {} },
  { definition: DelegationEvent.DeliveryCompleted, data: {} },
  { definition: DelegationEvent.DeliveryFailed, data: {} },
  { definition: DelegationEvent.DeliveryCancelled, data: {} },
  { definition: DelegationEvent.DeliveryRecoveryRequired, data: {} },
  {
    definition: DelegationEvent.RevisionRecorded,
    data: {
      turnID: "trn_review",
      participantID: "par_reviewer",
      commitSha: "abc123",
      revisionDigest: `rev_${"a".repeat(64)}`,
      changeKind: "rework",
    },
  },
  {
    definition: DelegationEvent.ReviewApproved,
    data: {
      turnID: "trn_review",
      participantID: "par_reviewer",
      reviewedRevisionDigest: `rev_${"a".repeat(64)}`,
      findings: [],
    },
  },
  {
    definition: DelegationEvent.ReviewChangesRequested,
    data: {
      turnID: "trn_review",
      participantID: "par_reviewer",
      reviewedRevisionDigest: `rev_${"a".repeat(64)}`,
      findings: [],
    },
  },
  {
    definition: DelegationEvent.ReviewRejected,
    data: {
      turnID: "trn_review",
      participantID: "par_reviewer",
      reviewedRevisionDigest: `rev_${"a".repeat(64)}`,
      findings: [],
    },
  },
  { definition: DelegationEvent.RejectionRetracted, data: { reason: "Evidence corrected" } },
  { definition: DelegationEvent.Closing, data: {} },
  { definition: DelegationEvent.Completed, data: {} },
  { definition: DelegationEvent.Cancelled, data: {} },
  { definition: DelegationEvent.Archived, data: {} },
  { definition: DelegationEvent.Unarchived, data: {} },
  { definition: DelegationEvent.Forked, data: { forkedDelegationID: "dlg_fork" } },
]

describe("Delegation durable contracts", () => {
  test("registers every canonical definition exactly once in durable and public manifests", () => {
    expect(fixtures.map((fixture) => fixture.definition)).toEqual([...DelegationEvent.Definitions])
    expect(EventManifest.Durable).toBe(DurableEventManifest.Durable)
    expect(new Set(DelegationEvent.Definitions.map((definition) => definition.type)).size).toBe(
      DelegationEvent.Definitions.length,
    )
    DelegationEvent.Definitions.forEach((definition) => {
      const key = Event.versionedType(definition.type, definition.durable.version)
      expect(DurableEventManifest.Durable.get(key)).toBe(definition)
      expect(EventManifest.Durable.get(key)).toBe(definition)
      expect(Array.from(EventManifest.Durable.values()).filter((item) => item === definition)).toHaveLength(1)
      expect(definition.durability).toBe("durable")
      expect(definition.durable).toEqual({ version: 1, aggregate: "delegationID" })
      expect(definition.ast.annotations?.identifier).toBe(definition.type)
      expect(EventManifest.ServerDefinitions.filter((item) => item.type === definition.type)).toEqual([definition])
      expect(EventManifest.Definitions.filter((item) => item.type === definition.type)).toEqual([definition])
      expect(EventManifest.Server.get(definition.type)).toBe(definition)
      expect(EventManifest.Latest.get(definition.type)).toBe(definition)
    })
  })

  fixtures.forEach((fixture) => {
    test(`${fixture.definition.type} round-trips its version 1 envelope and omits undefined payload fields`, () => {
      const delivery = fixture.definition.type.startsWith("delegation.delivery_")
        ? {
            turnID: "trn_review",
            participantID: "par_reviewer",
            deliveryOrigin: "review",
            senderParticipantID: "par_sender",
            attempt: 1,
          }
        : {}
      const data = {
        delegationID: "dlg_contract",
        timestamp: 1,
        ...delivery,
        ...fixture.data,
      }
      const codec: Schema.Codec<unknown> = fixture.definition.data
      const optionalKeys = Object.keys(fixture.definition.data.fields).filter((key) => !Object.hasOwn(data, key))
      const explicit = { ...data, ...Object.fromEntries(optionalKeys.map((key) => [key, undefined])) }
      const encoded = Schema.encodeSync(codec)(explicit)
      expect(encoded).toEqual(data)
      optionalKeys.forEach((key) => {
        expect(encoded).not.toHaveProperty(key)
      })

      const envelope: Schema.Codec<unknown> = fixture.definition
      const event = {
        id: "evt_contract",
        type: fixture.definition.type,
        created: 1,
        durable: { aggregateID: data.delegationID, seq: 0, version: 1 },
        data,
      }
      expect(Schema.encodeSync(envelope)(Schema.decodeUnknownSync(envelope)(event))).toEqual(event)
      expect(() =>
        Schema.decodeUnknownSync(envelope)({ ...event, durable: { ...event.durable, version: 2 } }),
      ).toThrow()
    })
  })

  test("omits undefined optional fields inside all review finding payloads", () => {
    ;[DelegationEvent.ReviewApproved, DelegationEvent.ReviewChangesRequested, DelegationEvent.ReviewRejected].forEach(
      (definition) => {
        const codec: Schema.Codec<unknown> = definition.data
        const data = {
          delegationID: "dlg_contract",
          turnID: "trn_review",
          participantID: "par_reviewer",
          reviewedRevisionDigest: `rev_${"a".repeat(64)}`,
          findings: [{ severity: "blocking", summary: "Review evidence" }],
          timestamp: 1,
        }
        expect(
          Schema.encodeSync(codec)({
            ...data,
            summary: undefined,
            findings: [{ ...data.findings[0], file: undefined, line: undefined, message: undefined }],
          }),
        ).toEqual(data)
      },
    )
  })

  const records = [
    {
      name: "Info",
      identifier: "Delegation.Info",
      schema: Delegation.Info,
      data: {
        id: "dlg_contract",
        parentSessionID: "ses_parent",
        title: "Review",
        status: "draft",
        rejectionBlocked: false,
        lastActivityAt: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    },
    {
      name: "ParticipantInfo",
      identifier: "Delegation.ParticipantInfo",
      schema: Delegation.ParticipantInfo,
      data: {
        id: "par_reviewer",
        delegationID: "dlg_contract",
        provider: "internal",
        target: "review",
        role: "reviewer",
        context: "fresh",
        phase: "provisioning",
        lastActivityAt: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    },
    {
      name: "TurnInfo",
      identifier: "Delegation.TurnInfo",
      schema: Delegation.TurnInfo,
      data: {
        id: "trn_review",
        delegationID: "dlg_contract",
        seq: 0,
        kind: "review",
        status: "admitted",
        participantIDs: ["par_reviewer"],
        delivery: "steer",
        createdAt: 1,
        updatedAt: 1,
      },
    },
  ] as const
  records.forEach((record) => {
    test(`${record.name} retains its public identifier on storage and HTTP encoded schemas`, () => {
      expect(SchemaAST.resolveIdentifier(record.schema.ast)).toBe(record.identifier)
      expect(SchemaAST.resolveIdentifier(Schema.toEncoded(record.schema).ast)).toBe(record.identifier)
      expect(SchemaAST.resolveIdentifier(Schema.toEncoded(Schema.toCodecJson(record.schema)).ast)).toBe(
        record.identifier,
      )
    })

    test(`${record.name} omits undefined record fields and round-trips its HTTP JSON codec`, () => {
      const optionalKeys = Object.keys(record.schema.fields).filter((key) => !Object.hasOwn(record.data, key))
      const codec: Schema.Codec<unknown> = record.schema
      const value = Schema.decodeUnknownSync(record.schema)(record.data)
      Object.assign(value, Object.fromEntries(optionalKeys.map((key) => [key, undefined])))
      expect(Schema.encodeSync(codec)(value)).toEqual(record.data)
      const http = Schema.toCodecJson(codec)
      expect(Schema.encodeSync(http)(value)).toEqual(record.data)
      expect(Schema.encodeSync(codec)(Schema.decodeUnknownSync(http)(record.data))).toEqual(record.data)
      const json = Schema.fromJsonString(http)
      const encoded = Schema.encodeSync(json)(value)
      expect(Schema.encodeSync(codec)(Schema.decodeUnknownSync(json)(encoded))).toEqual(record.data)
      optionalKeys.forEach((key) => {
        expect(encoded).not.toContain(`"${key}"`)
      })
    })
  })
})
