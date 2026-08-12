import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@aigcfroge/core/database/database"
import { PersonalMemory } from "@aigcfroge/core/session/personal-memory"
import { testEffect } from "./lib/effect"

const it = testEffect(PersonalMemory.layer.pipe(Layer.provideMerge(Database.defaultLayer)))

const makeInput = (overrides: Partial<Parameters<PersonalMemory.Interface["propose"]>[0]> = {}) => ({
  content: "User prefers concise answers",
  source: "explicit" as const,
  trustLevel: "high" as const,
  sensitivityLevel: "low" as const,
  ...overrides,
})

describe("PersonalMemory", () => {
  it.effect("propose creates a pending entry (confirm-first: never auto-confirmed)", () =>
    Effect.gen(function* () {
      const memories = yield* PersonalMemory.Service
      const created = yield* memories.propose(makeInput())

      expect(created.status).toBe("pending")
      expect(created.content).toBe("User prefers concise answers")
      expect(created.source).toBe("explicit")
      expect(created.sourceSessionID).toBeUndefined()

      expect(yield* memories.listConfirmed()).toHaveLength(0)
      expect(yield* memories.listPending()).toHaveLength(1)
    }),
  )

  it.effect("confirm promotes a pending entry to confirmed (injectable set)", () =>
    Effect.gen(function* () {
      const memories = yield* PersonalMemory.Service
      const created = yield* memories.propose(makeInput({ source: "derived", trustLevel: "medium" }))

      // Derived entries stay pending until confirmed.
      expect((yield* memories.listPending())[0]?.status).toBe("pending")
      expect(yield* memories.listConfirmed()).toHaveLength(0)

      const confirmed = yield* memories.confirm(created.id)
      expect(confirmed?.status).toBe("confirmed")
      expect(confirmed?.confirmedAt).toBeDefined()
      expect(yield* memories.listPending()).toHaveLength(0)
      expect(yield* memories.listConfirmed()).toHaveLength(1)
    }),
  )

  it.effect("reject moves a pending entry to rejected (terminal, audit keeps the row)", () =>
    Effect.gen(function* () {
      const memories = yield* PersonalMemory.Service
      const created = yield* memories.propose(makeInput())

      const rejected = yield* memories.reject(created.id)
      expect(rejected?.status).toBe("rejected")
      // A rejected entry can never be confirmed.
      expect(yield* memories.confirm(created.id)).toBeUndefined()
      expect(yield* memories.list()).toHaveLength(1)
    }),
  )

  it.effect("edit updates content on pending or confirmed entries", () =>
    Effect.gen(function* () {
      const memories = yield* PersonalMemory.Service
      const created = yield* memories.propose(makeInput())

      const edited = yield* memories.edit({ id: created.id, content: "User prefers Chinese answers" })
      expect(edited?.content).toBe("User prefers Chinese answers")

      yield* memories.confirm(created.id)
      const editedConfirmed = yield* memories.edit({ id: created.id, trustLevel: "low" })
      expect(editedConfirmed?.trustLevel).toBe("low")
    }),
  )

  it.effect("remove soft-deletes a confirmed entry (audit trail preserved)", () =>
    Effect.gen(function* () {
      const memories = yield* PersonalMemory.Service
      const created = yield* memories.propose(makeInput())
      yield* memories.confirm(created.id)

      const removed = yield* memories.remove(created.id)
      expect(removed?.status).toBe("deleted")
      // Deleted entries leave the injectable set.
      expect(yield* memories.listConfirmed()).toHaveLength(0)
      // But the row stays for audit.
      expect(yield* memories.list()).toHaveLength(1)
    }),
  )
})
