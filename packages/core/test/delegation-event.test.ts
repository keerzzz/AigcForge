import { describe, expect, test } from "bun:test"
import { DelegationEvent } from "@aigcfroge/schema/delegation-event"

describe("Delegation event facade", () => {
  test("re-exports the exact canonical schema namespace and all runtime contracts", async () => {
    const facade = await import("../src/delegation/event")
    const canonical = await import("@aigcfroge/schema/delegation-event")

    expect(facade.DelegationEvent).toBe(DelegationEvent)
    expect(facade.Definitions).toBe(DelegationEvent.Definitions)
    expect(Object.keys(facade).toSorted()).toEqual(Object.keys(canonical).toSorted())
    Object.entries(canonical).forEach(([key, value]) => {
      expect(Object.getOwnPropertyDescriptor(facade, key)?.value).toBe(value)
    })
    facade.Definitions.forEach((definition, index) => {
      expect(definition).toBe(DelegationEvent.Definitions[index])
      expect(definition.data).toBe(DelegationEvent.Definitions[index]?.data)
    })
  })
})
