import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Event } from "../src/event.js"
import { EventLog } from "../src/event-log.js"

describe("public event schemas", () => {
  test("definition is pure", () => {
    const definitions = Event.inventory()
    Event.ephemeral({ type: "test.pure", schema: { value: Schema.String } })
    expect(definitions).toEqual([])
  })

  test("latest selection is independent of declaration order", () => {
    const historical = Event.durable({
      type: "test.versioned",
      durable: { aggregate: "id", version: 1 },
      schema: { id: Schema.String },
    })
    const current = Event.durable({
      type: "test.versioned",
      durable: { aggregate: "id", version: 2 },
      schema: { id: Schema.String, value: Schema.String },
    })

    expect(Event.latest([historical, current]).get(current.type)).toBe(current)
    expect(Event.latest([current, historical]).get(current.type)).toBe(current)
  })

  test("durable definitions are indexed by type and version", () => {
    const definition = Event.durable({
      type: "test.durable",
      durable: { aggregate: "id", version: 1 },
      schema: { id: Schema.String },
    })

    expect(Event.durableMap([definition]).get("test.durable.1")).toBe(definition)
  })

  test("durable versions stay exact across codec, type-side, and constructor boundaries", () => {
    ;([1, 2] as const).forEach((version) => {
      const definition = Event.durable({
        type: "test.version-contract",
        durable: { aggregate: "id", version },
        schema: { id: Schema.String },
      })
      const envelope = {
        id: "evt_version_contract",
        type: definition.type,
        created: 1,
        durable: { aggregateID: "aggregate", seq: 0, version },
        data: { id: "aggregate" },
      } satisfies typeof definition.Encoded
      const decoded = Schema.decodeUnknownSync(definition)(envelope)

      expect(decoded.durable.version === version).toBe(true)
      expect(Schema.encodeSync(definition)(decoded)).toEqual(envelope)
      expect(Schema.encodeSync(definition)(definition.make(decoded))).toEqual(envelope)
      expect(Schema.encodeSync(definition)(Schema.decodeUnknownSync(Schema.toType(definition))(envelope))).toEqual(
        envelope,
      )
      ;[version === 1 ? 2 : 1, 0, 1.5].forEach((invalid) => {
        const wrong = { ...envelope, durable: { ...envelope.durable, version: invalid } }
        expect(() => Schema.decodeUnknownSync(definition)(wrong)).toThrow()
        expect(() => Schema.encodeUnknownSync(definition)(wrong)).toThrow()
        expect(() => Schema.decodeUnknownSync(Schema.toType(definition))(wrong)).toThrow()
        expect(() => {
          // @ts-expect-error Invalid constructor input is exercised at runtime.
          definition.make(wrong)
        }).toThrow()
      })
    })
  })

  test("synced marker encodes the captured watermark", () => {
    expect(
      Schema.encodeSync(EventLog.Synced)({
        type: "log.synced",
        aggregateID: "ses_test",
        seq: Event.Seq.make(1),
      }),
    ).toEqual({ type: "log.synced", aggregateID: "ses_test", seq: 1 })
    expect(Schema.encodeSync(EventLog.Synced)({ type: "log.synced", aggregateID: "ses_test" })).toEqual({
      type: "log.synced",
      aggregateID: "ses_test",
    })
  })
})
