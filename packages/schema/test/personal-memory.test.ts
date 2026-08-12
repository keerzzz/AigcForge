import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { PersonalMemory } from "../src/index"

const valid = {
  id: "pm_abc123",
  content: "User prefers concise answers",
  source: "explicit",
  trustLevel: "high",
  sensitivityLevel: "low",
  status: "pending",
  createdAt: 1,
  updatedAt: 2,
}

describe("PersonalMemory.Info", () => {
  test("decodes a valid pending proposal", () => {
    const s = Schema.decodeUnknownSync(PersonalMemory.Info)(valid)
    expect(s.id).toBe("pm_abc123")
    expect(s.content).toBe("User prefers concise answers")
    expect(s.source).toBe("explicit")
    expect(s.status).toBe("pending")
  })

  test("rejects an unknown source", () => {
    expect(() => Schema.decodeUnknownSync(PersonalMemory.Info)({ ...valid, source: "inferred" })).toThrow()
  })

  test("rejects an unknown status", () => {
    expect(() => Schema.decodeUnknownSync(PersonalMemory.Info)({ ...valid, status: "approved" })).toThrow()
  })

  test("rejects a malformed id prefix", () => {
    expect(() => Schema.decodeUnknownSync(PersonalMemory.Info)({ ...valid, id: "mem_wrong" })).toThrow()
  })

  test("omits optional audit fields without error", () => {
    const s = Schema.decodeUnknownSync(PersonalMemory.Info)(valid)
    expect(s.sourceSessionID).toBeUndefined()
    expect(s.confirmedAt).toBeUndefined()
    expect(s.createdBy).toBeUndefined()
  })

  test("source/status literal sets match the contract", () => {
    const source = Schema.decodeUnknownSync(PersonalMemory.Source)
    for (const value of ["explicit", "derived"]) expect(source(value)).toBe(value)
    const status = Schema.decodeUnknownSync(PersonalMemory.Status)
    for (const value of ["pending", "confirmed", "rejected", "deleted"]) expect(status(value)).toBe(value)
  })
})
