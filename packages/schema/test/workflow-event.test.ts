import { describe, expect, test } from "bun:test"
import { Schema, SchemaAST } from "effect"
import { DurableEventManifest } from "../src/durable-event-manifest.js"
import { EventManifest } from "../src/event-manifest.js"
import { Event } from "../src/event.js"
import { WorkflowEvent } from "../src/workflow-event.js"

const data = {
  runID: "run_contract",
  sessionID: "session_contract",
  status: "pending" as const,
  revision: 1,
  timeUpdated: 1,
}

describe("Workflow update contract", () => {
  test("registers one canonical update for durable replay and the current public stream", () => {
    const definition = WorkflowEvent.Updated
    const key = Event.versionedType(definition.type, definition.durable.version)
    expect(WorkflowEvent.Definitions).toEqual([definition])
    expect(definition.durability).toBe("durable")
    expect(definition.durable).toEqual({ version: 1, aggregate: "runID" })
    expect(EventManifest.Durable).toBe(DurableEventManifest.Durable)
    expect(DurableEventManifest.Durable.get(key)).toBe(definition)
    expect(Array.from(EventManifest.Durable.values()).filter((item) => item === definition)).toHaveLength(1)
    expect(EventManifest.ServerDefinitions.filter((item) => item.type === definition.type)).toEqual([definition])
    expect(EventManifest.Definitions.filter((item) => item.type === definition.type)).toEqual([definition])
    expect(EventManifest.Server.get(definition.type)).toBe(definition)
    expect(EventManifest.Latest.get(definition.type)).toBe(definition)
    expect(EventManifest.isServer({ type: definition.type })).toBe(true)
  })

  test("omits undefined payload fields while preserving defined optional values", () => {
    const codec: Schema.Codec<unknown> = WorkflowEvent.Updated.data
    const encoded = Schema.encodeSync(codec)({ ...data, currentStepId: undefined, errorCategory: undefined })
    expect(encoded).toEqual(data)
    expect(encoded).not.toHaveProperty("currentStepId")
    expect(encoded).not.toHaveProperty("errorCategory")
    const defined = { ...data, status: "failed", currentStepId: "branch", errorCategory: "invalid_branch_output" }
    expect(Schema.encodeSync(codec)(Schema.decodeUnknownSync(codec)(defined))).toEqual(defined)
    expect(Schema.encodeSync(Schema.toCodecJson(codec))(Schema.decodeUnknownSync(codec)(defined))).toEqual(defined)
  })

  test("round-trips the original version 1 envelope and stable public identifier", () => {
    const envelope = {
      id: "evt_workflow_contract",
      type: WorkflowEvent.Updated.type,
      created: 1,
      durable: { aggregateID: data.runID, seq: 0, version: 1 },
      data,
    } satisfies typeof WorkflowEvent.Updated.Encoded
    const typed = Schema.decodeUnknownSync(Schema.toType(WorkflowEvent.Updated))({
      ...envelope,
      metadata: undefined,
      location: undefined,
      data: { ...data, currentStepId: undefined, errorCategory: undefined },
    })
    const encoded = Schema.encodeSync(WorkflowEvent.Updated)(typed)
    expect(encoded).toEqual(envelope)
    expect(encoded).not.toHaveProperty("metadata")
    expect(encoded).not.toHaveProperty("location")
    expect(encoded.data).not.toHaveProperty("currentStepId")
    expect(encoded.data).not.toHaveProperty("errorCategory")
    const decoded = Schema.decodeUnknownSync(WorkflowEvent.Updated)(encoded)
    expect(Schema.encodeSync(WorkflowEvent.Updated)(decoded)).toEqual(envelope)
    expect(Schema.encodeSync(Schema.toCodecJson(WorkflowEvent.Updated))(decoded)).toEqual(envelope)
    expect(SchemaAST.resolveIdentifier(WorkflowEvent.Updated.ast)).toBe(envelope.type)
    expect(SchemaAST.resolveIdentifier(Schema.toEncoded(WorkflowEvent.Updated).ast)).toBe(envelope.type)
    expect(() =>
      Schema.decodeUnknownSync(WorkflowEvent.Updated)({
        ...envelope,
        durable: { ...envelope.durable, version: 2 },
      }),
    ).toThrow()
  })

  test("keeps the existing status, revision, category and finite timestamp constraints", () => {
    ;[
      { ...data, status: "unknown" },
      { ...data, revision: 0 },
      { ...data, revision: 1.5 },
      { ...data, errorCategory: "unknown" },
      { ...data, timeUpdated: Number.POSITIVE_INFINITY },
    ].forEach((invalid) => {
      expect(() => Schema.decodeUnknownSync(WorkflowEvent.Updated.data)(invalid)).toThrow()
    })
  })
})
