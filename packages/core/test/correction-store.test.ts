import { describe, expect } from "bun:test"
import { DateTime, Effect, Exit, Layer, Option, Schema } from "effect"
import { Bus } from "@aigcfroge/core/bus"
import { Config } from "@aigcfroge/core/config"
import { ConfigMeta } from "@aigcfroge/core/config/meta"
import { Document, Info } from "@aigcfroge/schema/config"
import { Database } from "@aigcfroge/core/database/database"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { Model } from "@aigcfroge/core/model"
import { Provider } from "@aigcfroge/core/provider"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { CorrectionStore } from "@aigcfroge/core/session/correction-store"
import { SessionEvent } from "@aigcfroge/core/session/event"
import { SessionInbox } from "@aigcfroge/core/session/inbox"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionStore } from "@aigcfroge/core/session/store"
import { Agent } from "@aigcfroge/schema/agent"
import { Money } from "@aigcfroge/schema/money"
import { Project } from "@aigcfroge/schema/project"
import { AbsolutePath } from "@aigcfroge/schema/schema"
import { Session } from "@aigcfroge/schema/session"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { testEffect } from "./lib/effect"

// One real global root owns the database and durable projector across Store scopes.
const fixture = AppNodeBuilder.build(
  LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, SessionInbox.node]),
  [Bus.node.replace(Bus.configured({ persist: true }))],
).pipe(Layer.provideMerge(Config.testLayer()))
const it = testEffect(fixture)

const withStore = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(Layer.fresh(CorrectionStore.layer)), Effect.scoped)

const seedSession = Effect.fnUntraced(function* () {
  const database = yield* Database.Service
  const bus = yield* Bus.Service
  const store = yield* SessionStore.Service
  const sessionID = Session.ID.create()
  const directory = AbsolutePath.make("/project")
  yield* database.db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: directory, sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* bus.publish(SessionEvent.Created, {
    sessionID,
    projectID: Project.ID.global,
    location: { directory },
    slug: "correction-store-test",
    version: "test",
  })
  expect(yield* store.get(sessionID)).toMatchObject({ id: sessionID, location: { directory } })
  return sessionID
})

const messages = Effect.fnUntraced(function* (sessionID: Session.ID) {
  const canonical = yield* SessionStore.Service
  return yield* canonical.messages({ sessionID, order: "asc" })
})

const checkpointOf = (message: SessionMessage.Info) => {
  if (message.type !== "synthetic") return undefined
  const metadata = Option.getOrUndefined(Schema.decodeUnknownOption(CorrectionStore.SnapshotMetadata)(message.metadata))
  if (metadata?.correctionSnapshot.version !== 2) return undefined
  return { message, data: metadata.correctionSnapshot }
}

const lastCheckpoint = Effect.fnUntraced(function* (sessionID: Session.ID) {
  const checkpoint = (yield* messages(sessionID))
    .flatMap((message) => {
      const checkpoint = checkpointOf(message)
      return checkpoint ? [checkpoint] : []
    })
    .at(-1)
  if (!checkpoint) return yield* Effect.die(new Error("Expected a real projected correction checkpoint"))
  return checkpoint
})

const sync = Effect.fnUntraced(function* (store: CorrectionStore.Interface, sessionID: Session.ID) {
  const bus = yield* Bus.Service
  return yield* store.syncSnapshot({
    sessionID,
    visibleIDs: (yield* messages(sessionID)).map((message) => message.id),
    publish: (snapshot) =>
      bus
        .publish(SessionEvent.Synthetic, {
          sessionID,
          text: snapshot.text,
          metadata: snapshot.metadata,
          description: "Correction data",
        })
        .pipe(Effect.map((event) => SessionMessage.ID.fromEvent(event.id))),
  })
})

const deliver = Effect.fnUntraced(function* (store: CorrectionStore.Interface, sessionID: Session.ID, text: string) {
  const database = yield* Database.Service
  const bus = yield* Bus.Service
  const inbox = yield* SessionInbox.Service
  const canonical = yield* SessionStore.Service
  const id = SessionMessage.ID.create()
  yield* inbox.admit({ id, sessionID, item: { type: "user", payload: { text }, delivery: "steer" } })
  expect(
    yield* SessionInbox.promote(database.db, bus, sessionID, "steer", (user) =>
      store.observe({ sessionID, source: { id: user.id, entries: [] } }),
    ),
  ).toBe(1)
  const projected = yield* canonical.message(id)
  expect(projected?.sessionID).toBe(sessionID)
  expect(projected?.message).toMatchObject({ type: "user", text, origin: { kind: "inbox-user", sessionID } })
  return id
})

// These publish the actual durable boundaries; no Ref counter or adjusted TestClock is used.
const endedStep = Effect.fnUntraced(function* (sessionID: Session.ID) {
  const bus = yield* Bus.Service
  const assistantMessageID = SessionMessage.ID.create()
  yield* bus.publish(SessionEvent.Step.Started, {
    sessionID,
    assistantMessageID,
    agent: Agent.ID.make("build"),
    model: { id: Model.ID.make("test-model"), providerID: Provider.ID.make("test-provider") },
    started: (yield* DateTime.nowAsDate).getTime(),
  })
  yield* bus.publish(SessionEvent.Step.Ended, {
    sessionID,
    assistantMessageID,
    finish: "stop",
    needsContinuation: false,
    cost: Money.USD.zero,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  })
  return assistantMessageID
})

const completedStep = Effect.fnUntraced(function* (sessionID: Session.ID) {
  const bus = yield* Bus.Service
  const canonical = yield* SessionStore.Service
  const assistantMessageID = yield* endedStep(sessionID)
  const event = yield* bus.publish(SessionEvent.Step.Completed, { sessionID, assistantMessageID })
  const projected = yield* canonical.message(assistantMessageID)
  expect(projected?.message).toMatchObject({
    type: "assistant",
    origin: { kind: "step", sessionID },
    completion: { id: event.id, seq: event.durable.seq },
  })
  return event
})

describe("CorrectionStore durable projection lifecycle", () => {
  it.effect("keeps disabled data hidden and derives completed age when the same epoch resumes", () =>
    Effect.gen(function* () {
      const sessionID = yield* seedSession()
      const config = yield* Config.Test
      const database = yield* Database.Service
      const bus = yield* Bus.Service
      const inbox = yield* SessionInbox.Service
      yield* withStore(
        Effect.gen(function* () {
          const store = yield* CorrectionStore.Service
          yield* store.record({
            sessionID,
            entry: { key: "raw", correct: "Keep the search small", source: "user-correction", extractLayer: 3 },
          })
          yield* sync(store, sessionID)
        }),
      )
      yield* config.setEntries([
        new Document({
          type: "document",
          info: Info.make({
            meta: ConfigMeta.Info.make({ correction_store: ConfigMeta.CorrectionStore.make({ enabled: false }) }),
          }),
        }),
      ])
      yield* withStore(
        Effect.gen(function* () {
          const store = yield* CorrectionStore.Service
          expect(store.enabled).toBe(false)
          const count = (yield* messages(sessionID)).length
          yield* store.record({
            sessionID,
            entry: { key: "ignored", correct: "POST", source: "user-correction", extractLayer: 2 },
          })
          expect((yield* messages(sessionID)).length).toBe(count)
          expect(yield* store.facts(sessionID)).toEqual([])
          const snapshot = yield* store.snapshot(sessionID)
          expect(snapshot.current).toBeUndefined()
          expect(snapshot.owned.size).toBeGreaterThan(0)
          yield* Effect.forEach(Array.from({ length: 6 }), () => completedStep(sessionID))
          const id = SessionMessage.ID.create()
          yield* inbox.admit({
            id,
            sessionID,
            item: { type: "user", payload: { text: "should be POST not GET" }, delivery: "steer" },
          })
          yield* SessionInbox.promote(database.db, bus, sessionID, "steer")
        }),
      )
      yield* config.setEntries([])
      yield* withStore(
        Effect.gen(function* () {
          const store = yield* CorrectionStore.Service
          expect(store.enabled).toBe(true)
          expect(yield* store.facts(sessionID)).toEqual([])
          expect(yield* sync(store, sessionID)).toBe(true)
          expect((yield* store.snapshot(sessionID)).current?.facts).toEqual([])
        }),
      )
    }),
  )

  it.effect("treats another configured epoch as a barrier and admits only subsequent sources", () =>
    Effect.gen(function* () {
      const sessionID = yield* seedSession()
      const config = yield* Config.Test
      yield* withStore(
        Effect.gen(function* () {
          const store = yield* CorrectionStore.Service
          yield* store.record({
            sessionID,
            entry: { key: "old", correct: "OLD_CONFIG_FACT", source: "user-correction", extractLayer: 2 },
          })
          yield* sync(store, sessionID)
        }),
      )
      yield* config.setEntries([
        new Document({
          type: "document",
          info: Info.make({
            meta: ConfigMeta.Info.make({ correction_store: ConfigMeta.CorrectionStore.make({ max_entries: 2 }) }),
          }),
        }),
      ])
      yield* withStore(
        Effect.gen(function* () {
          const store = yield* CorrectionStore.Service
          expect(yield* store.facts(sessionID)).toEqual([])
          expect((yield* store.snapshot(sessionID)).current).toBeUndefined()
          yield* store.record({
            sessionID,
            entry: { key: "new", correct: "NEW_CONFIG_FACT", source: "user-correction", extractLayer: 2 },
          })
          yield* sync(store, sessionID)
          expect(yield* store.facts(sessionID)).toEqual([{ key: "new", correct: "NEW_CONFIG_FACT" }])
          expect((yield* store.snapshot(sessionID)).current?.text).not.toContain("OLD_CONFIG_FACT")
        }),
      )
      yield* withStore(
        Effect.gen(function* () {
          const store = yield* CorrectionStore.Service
          expect(yield* store.facts(sessionID)).toEqual([{ key: "new", correct: "NEW_CONFIG_FACT" }])
          expect(yield* sync(store, sessionID)).toBe(false)
        }),
      )
    }),
  )

  it.effect("restores the same source and age across staged, cleared and committed insertion cuts", () =>
    Effect.gen(function* () {
      const sessionID = yield* seedSession()
      const bus = yield* Bus.Service
      const canonical = yield* SessionStore.Service
      yield* withStore(
        Effect.gen(function* () {
          const store = yield* CorrectionStore.Service
          yield* store.record({
            sessionID,
            entry: { key: "raw", correct: "Keep the search small", source: "user-correction", extractLayer: 3 },
          })
          yield* sync(store, sessionID)
          yield* completedStep(sessionID)
          yield* sync(store, sessionID)
          const assistantMessageID = SessionMessage.ID.create()
          const started = {
            sessionID,
            assistantMessageID,
            agent: Agent.ID.make("build"),
            model: { id: Model.ID.make("test-model"), providerID: Provider.ID.make("test-provider") },
            started: 0,
          }
          const first = yield* bus.publish(SessionEvent.Step.Started, started)
          const boundaryID = yield* deliver(store, sessionID, "should be POST not GET")
          const boundary = yield* canonical.message(boundaryID)
          if (!boundary) return yield* Effect.die(new Error("Correction revert boundary missing"))
          yield* bus.publish(SessionEvent.Step.Started, started)
          yield* bus.publish(SessionEvent.Step.Completed, { sessionID, assistantMessageID })
          expect((yield* canonical.message(assistantMessageID))?.seq).toBe(first.durable.seq)
          yield* sync(store, sessionID)
          expect(yield* store.facts(sessionID)).toHaveLength(2)
          const stage = { sessionID, revert: { messageID: boundaryID } }
          yield* bus.publish(SessionEvent.RevertEvent.Staged, stage)
          expect(yield* store.facts(sessionID)).toEqual([{ key: "raw", correct: "Keep the search small" }])
          yield* withStore(
            Effect.gen(function* () {
              const cold = yield* CorrectionStore.Service
              expect(yield* cold.facts(sessionID)).toEqual(yield* store.facts(sessionID))
            }),
          )
          yield* bus.publish(SessionEvent.RevertEvent.Cleared, { sessionID })
          expect(yield* store.facts(sessionID)).toHaveLength(2)
          yield* bus.publish(SessionEvent.RevertEvent.Staged, stage)
          yield* bus.publish(SessionEvent.RevertEvent.Committed, {
            sessionID,
            to: boundaryID,
            boundarySeq: boundary.seq,
          })
          const retained = (yield* canonical.message(assistantMessageID))?.message
          if (retained?.type !== "assistant")
            return yield* Effect.die(new Error("Retained correction Assistant missing"))
          expect(retained.completion).toBeUndefined()
          expect(yield* store.facts(sessionID)).toEqual([{ key: "raw", correct: "Keep the search small" }])
        }),
      )
      yield* withStore(
        Effect.gen(function* () {
          const store = yield* CorrectionStore.Service
          expect(yield* store.facts(sessionID)).toEqual([{ key: "raw", correct: "Keep the search small" }])
          yield* Effect.forEach(Array.from({ length: 4 }), () => completedStep(sessionID))
          expect(yield* store.facts(sessionID)).toHaveLength(1)
          yield* completedStep(sessionID)
          expect(yield* store.facts(sessionID)).toEqual([])
        }),
      )
    }),
  )

  it.effect("restores mixed original User and record sources in a fresh Store scope", () =>
    Effect.gen(function* () {
      const sessionID = yield* seedSession()
      const otherSessionID = yield* seedSession()
      const warm = yield* withStore(
        Effect.gen(function* () {
          const store = yield* CorrectionStore.Service
          const userID = yield* deliver(store, sessionID, "./good not ./bad")
          yield* store.record({
            sessionID,
            entry: {
              key: "ref",
              correct: "./ref-correct",
              wrong: "./ref-wrong",
              source: "reference-checker",
              extractLayer: 1,
            },
          })
          yield* store.record({
            sessionID,
            entry: { key: "verify", correct: "packages/core typecheck", source: "verifier", extractLayer: 1 },
          })
          expect(yield* sync(store, sessionID)).toBe(true)
          const snapshot = yield* store.snapshot(sessionID)
          const checkpoint = yield* lastCheckpoint(sessionID)
          expect(snapshot.current?.facts).toEqual([
            { key: "user:./good", correct: "./good" },
            { key: "ref", correct: "./ref-correct" },
            { key: "verify", correct: "packages/core typecheck" },
          ])
          expect(snapshot.current?.text).not.toContain("./bad")
          expect(snapshot.current?.text).not.toContain("./ref-wrong")
          expect(checkpoint.message.metadata?.correctionSnapshot).not.toHaveProperty("entries")
          expect(checkpoint.message.metadata?.correctionSnapshot).not.toHaveProperty("completed")
          expect(checkpoint.message.metadata?.correctionSnapshot).not.toHaveProperty("wrong")
          const originals = (yield* messages(sessionID)).filter(
            (message): message is SessionMessage.Synthetic =>
              message.type === "synthetic" && Schema.is(CorrectionStore.SourceMetadata)(message.metadata),
          )
          expect(originals).toHaveLength(2)
          expect(originals.some((message) => message.text.includes("./ref-wrong"))).toBe(true)
          expect(originals.every((message) => snapshot.owned.has(message.id))).toBe(true)
          expect(checkpoint.data.slots[0].sourceID).toBe(userID)
          return { service: store, snapshot, checkpointID: checkpoint.message.id }
        }),
      )
      yield* withStore(
        Effect.gen(function* () {
          const cold = yield* CorrectionStore.Service
          expect(cold).not.toBe(warm.service)
          expect(yield* cold.facts(sessionID)).toEqual(warm.snapshot.current?.facts ?? [])
          expect((yield* cold.snapshot(sessionID)).current).toEqual(warm.snapshot.current)
          expect(yield* cold.check({ sessionID, toolName: "edit", toolInput: { path: "./ref-wrong" } })).toContain(
            "./ref-correct",
          )
          expect(yield* cold.facts(otherSessionID)).toEqual([])
          expect(yield* sync(cold, sessionID)).toBe(false)
          expect((yield* lastCheckpoint(sessionID)).message.id).toBe(warm.checkpointID)
        }),
      )
    }),
  )

  it.effect("consumes a genuine same-key User no-op without replacing wrong, source or birth", () =>
    Effect.gen(function* () {
      const sessionID = yield* seedSession()
      const saved = yield* withStore(
        Effect.gen(function* () {
          const store = yield* CorrectionStore.Service
          const first = yield* deliver(store, sessionID, "./good not ./bad-one")
          yield* sync(store, sessionID)
          const before = yield* lastCheckpoint(sessionID)
          const current = (yield* store.snapshot(sessionID)).current
          const step = yield* completedStep(sessionID)
          yield* store.completeStep(sessionID)
          const second = yield* deliver(store, sessionID, "./good not ./bad-two")
          expect(yield* sync(store, sessionID)).toBe(false)
          const receipt = yield* lastCheckpoint(sessionID)
          expect(receipt.message.id).not.toBe(before.message.id)
          expect(receipt.message.text).toBe("")
          expect(receipt.data.current).toBe(current?.id ?? null)
          expect(receipt.data.throughSource).toBe(second)
          expect(receipt.data.slots).toEqual(before.data.slots)
          expect(receipt.data.slots[0].sourceID).toBe(first)
          expect(receipt.data.slots[0].birthAfter).toBeNull()
          expect(receipt.data.normalHead).toBe(step.id)
          expect(yield* store.check({ sessionID, toolName: "edit", toolInput: "./bad-one" })).toContain("./good")
          expect(yield* store.check({ sessionID, toolName: "edit", toolInput: "./bad-two" })).toBe("")
          return { current, receiptID: receipt.message.id }
        }),
      )
      yield* withStore(
        Effect.gen(function* () {
          const store = yield* CorrectionStore.Service
          expect((yield* store.snapshot(sessionID)).current).toEqual(saved.current)
          expect(yield* sync(store, sessionID)).toBe(false)
          expect((yield* lastCheckpoint(sessionID)).message.id).toBe(saved.receiptID)
          expect(yield* store.check({ sessionID, toolName: "edit", toolInput: "./bad-one" })).toContain("./good")
          expect(yield* store.check({ sessionID, toolName: "edit", toolInput: "./bad-two" })).toBe("")
        }),
      )
    }),
  )

  it.effect("counts first normal use as age1 and expires L3 at age6 without no-op rebirth", () =>
    Effect.gen(function* () {
      const sessionID = yield* seedSession()
      yield* withStore(
        Effect.gen(function* () {
          const store = yield* CorrectionStore.Service
          yield* store.record({
            sessionID,
            entry: {
              key: "raw-old",
              correct: "Keep the algorithm simple",
              wrong: "./bad-one",
              source: "user-correction",
              extractLayer: 3,
            },
          })
          yield* sync(store, sessionID)
          const first = yield* completedStep(sessionID)
          yield* store.completeStep(sessionID)
          expect(yield* store.facts(sessionID)).toEqual([{ key: "raw-old", correct: "Keep the algorithm simple" }])
          yield* store.record({
            sessionID,
            entry: { key: "raw-new", correct: "Prefer the smaller search", source: "user-correction", extractLayer: 3 },
          })
          expect((yield* lastCheckpoint(sessionID)).data.slots[1].birthAfter).toBe(first.id)
          yield* Effect.forEach(Array.from({ length: 4 }), () =>
            completedStep(sessionID).pipe(Effect.tap(() => store.completeStep(sessionID))),
          )
          const before = yield* lastCheckpoint(sessionID)
          yield* store.record({
            sessionID,
            entry: {
              key: "raw-old",
              correct: "Keep the algorithm simple",
              wrong: "./bad-two",
              source: "verifier",
              extractLayer: 1,
            },
          })
          expect((yield* lastCheckpoint(sessionID)).data.slots[0]).toEqual(before.data.slots[0])
          expect(yield* store.facts(sessionID)).toHaveLength(2)
          expect(yield* store.check({ sessionID, toolName: "edit", toolInput: "./bad-one" })).toContain(
            "Keep the algorithm simple",
          )
          expect(yield* store.check({ sessionID, toolName: "edit", toolInput: "./bad-two" })).toBe("")
          yield* completedStep(sessionID)
          yield* store.completeStep(sessionID)
          expect(yield* store.facts(sessionID)).toEqual([{ key: "raw-new", correct: "Prefer the smaller search" }])
          yield* sync(store, sessionID)
        }),
      )
      yield* withStore(
        Effect.gen(function* () {
          const store = yield* CorrectionStore.Service
          expect(yield* store.facts(sessionID)).toEqual([{ key: "raw-new", correct: "Prefer the smaller search" }])
          yield* completedStep(sessionID)
          yield* store.completeStep(sessionID)
          expect(yield* store.facts(sessionID)).toEqual([])
          yield* sync(store, sessionID)
          expect((yield* store.snapshot(sessionID)).current?.facts).toEqual([])
        }),
      )
    }),
  )

  it.effect("does not count checks, Ended or repeated completeStep calls as normal completion", () =>
    Effect.gen(function* () {
      const sessionID = yield* seedSession()
      yield* withStore(
        Effect.gen(function* () {
          const store = yield* CorrectionStore.Service
          yield* store.record({
            sessionID,
            entry: {
              key: "raw",
              correct: "Keep the search small",
              wrong: "./old-path",
              source: "user-correction",
              extractLayer: 3,
            },
          })
          const assistantMessageID = yield* endedStep(sessionID)
          const canonical = yield* SessionStore.Service
          const row = yield* canonical.message(assistantMessageID)
          expect(row?.message).toMatchObject({ type: "assistant" })
          if (row?.message.type !== "assistant") return yield* Effect.die(new Error("Expected real Assistant row"))
          expect(row.message.time.completed).toBeDefined()
          expect(row.message.completion).toBeUndefined()
          const warnings = yield* Effect.forEach(Array.from({ length: 12 }), () =>
            store
              .completeStep(sessionID)
              .pipe(Effect.andThen(store.check({ sessionID, toolName: "edit", toolInput: { path: "./old-path" } }))),
          )
          expect(warnings.every((warning) => warning.includes("Keep the search small"))).toBe(true)
          expect(yield* store.facts(sessionID)).toEqual([{ key: "raw", correct: "Keep the search small" }])
        }),
      )
    }),
  )

  it.effect("expires detector interception at age11 while keeping structured facts", () =>
    Effect.gen(function* () {
      const sessionID = yield* seedSession()
      yield* withStore(
        Effect.gen(function* () {
          const store = yield* CorrectionStore.Service
          yield* store.record({
            sessionID,
            entry: {
              key: "detector",
              correct: "./new.ts",
              wrong: "./old.ts",
              source: "reference-checker",
              extractLayer: 1,
            },
          })
          yield* store.record({
            sessionID,
            entry: { key: "method", correct: "POST", wrong: "GET", source: "user-correction", extractLayer: 2 },
          })
          yield* Effect.forEach(Array.from({ length: 10 }), () =>
            completedStep(sessionID).pipe(Effect.tap(() => store.completeStep(sessionID))),
          )
          expect(yield* store.check({ sessionID, toolName: "read", toolInput: "./old.ts" })).toContain("./new.ts")
          yield* completedStep(sessionID)
          yield* store.completeStep(sessionID)
          expect(yield* store.check({ sessionID, toolName: "read", toolInput: "./old.ts" })).toBe("")
          expect(yield* store.check({ sessionID, toolName: "request", toolInput: "GET" })).toContain("POST")
          expect(yield* store.facts(sessionID)).toHaveLength(2)
        }),
      )
    }),
  )

  it.effect("keeps default FIFO through no-op and replacement, then restores the same ring cold", () =>
    Effect.gen(function* () {
      const sessionID = yield* seedSession()
      yield* withStore(
        Effect.gen(function* () {
          const store = yield* CorrectionStore.Service
          yield* Effect.forEach(
            Array.from({ length: 20 }, (_, index) => index),
            (index) =>
              store.record({
                sessionID,
                entry: { key: String(index), correct: "value" + index, source: "user-correction", extractLayer: 2 },
              }),
          )
          const before = yield* lastCheckpoint(sessionID)
          yield* store.record({
            sessionID,
            entry: { key: "0", correct: "value0", wrong: "./unaccepted", source: "verifier", extractLayer: 1 },
          })
          expect((yield* lastCheckpoint(sessionID)).data.slots).toEqual(before.data.slots)
          yield* store.record({
            sessionID,
            entry: { key: "0", correct: "replacement", source: "user-correction", extractLayer: 2 },
          })
          expect((yield* store.facts(sessionID))[0]).toEqual({ key: "0", correct: "replacement" })
          yield* store.record({
            sessionID,
            entry: { key: "20", correct: "value20", source: "user-correction", extractLayer: 2 },
          })
          expect(yield* store.facts(sessionID)).toHaveLength(20)
          expect((yield* store.facts(sessionID))[0]).toEqual({ key: "1", correct: "value1" })
          expect((yield* store.facts(sessionID)).at(-1)).toEqual({ key: "20", correct: "value20" })
          expect((yield* lastCheckpoint(sessionID)).data.slots).toHaveLength(20)
          yield* sync(store, sessionID)
        }),
      )
      yield* withStore(
        Effect.gen(function* () {
          const store = yield* CorrectionStore.Service
          expect(yield* store.facts(sessionID)).toHaveLength(20)
          expect((yield* store.facts(sessionID))[0]).toEqual({ key: "1", correct: "value1" })
          expect((yield* store.facts(sessionID)).at(-1)).toEqual({ key: "20", correct: "value20" })
          expect(yield* sync(store, sessionID)).toBe(false)
        }),
      )
    }),
  )

  it.effect("does not publish initial all-empty extraction state in warm or cold scope", () =>
    Effect.gen(function* () {
      const sessionID = yield* seedSession()
      yield* withStore(
        Effect.gen(function* () {
          const store = yield* CorrectionStore.Service
          yield* deliver(store, sessionID, "Please list the files.")
          expect(yield* sync(store, sessionID)).toBe(false)
          expect(yield* sync(store, sessionID)).toBe(false)
          expect(yield* store.facts(sessionID)).toEqual([])
          expect((yield* store.snapshot(sessionID)).current).toBeUndefined()
          expect((yield* messages(sessionID)).filter((message) => message.type === "synthetic")).toEqual([])
        }),
      )
      yield* withStore(
        Effect.gen(function* () {
          const store = yield* CorrectionStore.Service
          expect(yield* sync(store, sessionID)).toBe(false)
          expect((yield* messages(sessionID)).filter((message) => message.type === "synthetic")).toEqual([])
        }),
      )
    }),
  )

  it.effect("commits empty extraction receipts against existing state without a second current", () =>
    Effect.gen(function* () {
      const sessionID = yield* seedSession()
      const saved = yield* withStore(
        Effect.gen(function* () {
          const store = yield* CorrectionStore.Service
          yield* store.record({
            sessionID,
            entry: { key: "method", correct: "POST", wrong: "GET", source: "user-correction", extractLayer: 2 },
          })
          yield* sync(store, sessionID)
          const before = yield* lastCheckpoint(sessionID)
          const current = (yield* store.snapshot(sessionID)).current
          const id = yield* deliver(store, sessionID, "Please list the files.")
          expect(yield* sync(store, sessionID)).toBe(false)
          const receipt = yield* lastCheckpoint(sessionID)
          expect(receipt.message.id).not.toBe(before.message.id)
          expect(receipt.message.text).toBe("")
          expect(receipt.data.throughSource).toBe(id)
          expect(receipt.data.slots).toEqual(before.data.slots)
          expect(receipt.data.current).toBe(current?.id ?? null)
          expect((yield* store.snapshot(sessionID)).current).toEqual(current)
          expect(yield* sync(store, sessionID)).toBe(false)
          expect((yield* lastCheckpoint(sessionID)).message.id).toBe(receipt.message.id)
          return { current, receiptID: receipt.message.id }
        }),
      )
      yield* withStore(
        Effect.gen(function* () {
          const store = yield* CorrectionStore.Service
          expect((yield* store.snapshot(sessionID)).current).toEqual(saved.current)
          expect(yield* sync(store, sessionID)).toBe(false)
          expect((yield* lastCheckpoint(sessionID)).message.id).toBe(saved.receiptID)
        }),
      )
    }),
  )

  it.effect("retains expired ring refs and receipts even when current facts are empty", () =>
    Effect.gen(function* () {
      const sessionID = yield* seedSession()
      const saved = yield* withStore(
        Effect.gen(function* () {
          const store = yield* CorrectionStore.Service
          yield* store.record({
            sessionID,
            entry: { key: "raw", correct: "Keep the algorithm simple", source: "user-correction", extractLayer: 3 },
          })
          yield* sync(store, sessionID)
          yield* Effect.forEach(Array.from({ length: 6 }), () =>
            completedStep(sessionID).pipe(Effect.tap(() => store.completeStep(sessionID))),
          )
          expect(yield* store.facts(sessionID)).toEqual([])
          expect(yield* sync(store, sessionID)).toBe(true)
          const expired = yield* lastCheckpoint(sessionID)
          const current = (yield* store.snapshot(sessionID)).current
          expect(current?.facts).toEqual([])
          expect(current?.text).not.toContain("Keep the algorithm simple")
          expect(expired.data.slots).toHaveLength(1)
          const id = yield* deliver(store, sessionID, "Please list the files.")
          expect(yield* sync(store, sessionID)).toBe(false)
          const receipt = yield* lastCheckpoint(sessionID)
          expect(receipt.message.id).not.toBe(expired.message.id)
          expect(receipt.message.text).toBe("")
          expect(receipt.data.current).toBe(current?.id ?? null)
          expect(receipt.data.throughSource).toBe(id)
          expect(receipt.data.slots).toEqual(expired.data.slots)
          return { current, receiptID: receipt.message.id, slots: receipt.data.slots }
        }),
      )
      yield* withStore(
        Effect.gen(function* () {
          const store = yield* CorrectionStore.Service
          expect(yield* store.facts(sessionID)).toEqual([])
          expect((yield* store.snapshot(sessionID)).current).toEqual(saved.current)
          expect(yield* sync(store, sessionID)).toBe(false)
          const receipt = yield* lastCheckpoint(sessionID)
          expect(receipt.message.id).toBe(saved.receiptID)
          expect(receipt.data.slots).toEqual(saved.slots)
        }),
      )
    }),
  )

  it.effect("recovers a genuinely delivered source cold after derived publication fails", () =>
    Effect.gen(function* () {
      const sessionID = yield* seedSession()
      const sourceID = yield* withStore(
        Effect.gen(function* () {
          const store = yield* CorrectionStore.Service
          const id = yield* deliver(store, sessionID, "./good not ./bad")
          const failed = yield* store
            .syncSnapshot({
              sessionID,
              visibleIDs: (yield* messages(sessionID)).map((message) => message.id),
              publish: () => Effect.fail(new Error("derived publication failed")),
            })
            .pipe(Effect.exit)
          expect(Exit.isFailure(failed)).toBe(true)
          expect(yield* store.facts(sessionID)).toEqual([])
          expect((yield* store.snapshot(sessionID)).current).toBeUndefined()
          expect((yield* messages(sessionID)).flatMap((message) => (checkpointOf(message) ? [message] : []))).toEqual(
            [],
          )
          return id
        }),
      )
      yield* withStore(
        Effect.gen(function* () {
          const store = yield* CorrectionStore.Service
          expect(yield* sync(store, sessionID)).toBe(true)
          const current = (yield* store.snapshot(sessionID)).current
          expect(current?.facts).toEqual([{ key: "user:./good", correct: "./good" }])
          expect(current?.text).not.toContain("./bad")
          expect((yield* lastCheckpoint(sessionID)).data.slots[0].sourceID).toBe(sourceID)
          expect(yield* sync(store, sessionID)).toBe(false)
          expect((yield* store.snapshot(sessionID)).current?.id).toBe(current?.id)
        }),
      )
    }),
  )

  it.effect("treats latest owned unsupported or malformed snapshot versions as hidden barriers", () =>
    Effect.forEach([3, undefined, "broken"], (version) =>
      Effect.gen(function* () {
        const sessionID = yield* seedSession()
        const id = yield* withStore(
          Effect.gen(function* () {
            const store = yield* CorrectionStore.Service
            yield* store.record({
              sessionID,
              entry: { key: "old", correct: "POST", wrong: "GET", source: "user-correction", extractLayer: 2 },
            })
            yield* sync(store, sessionID)
            expect((yield* store.snapshot(sessionID)).current).toBeDefined()
            const bus = yield* Bus.Service
            const canonical = yield* SessionStore.Service
            const event = yield* bus.publish(SessionEvent.Synthetic, {
              sessionID,
              text: "Unknown owned snapshot body must remain hidden",
              metadata: { correctionSnapshot: { owner: "CorrectionStore", version } },
            })
            const id = SessionMessage.ID.fromEvent(event.id)
            const row = yield* canonical.message(id)
            if (!row) return yield* Effect.die(new Error("Missing owned barrier"))
            expect(CorrectionStore.isCorrectionHistory(row.message)).toBe(true)
            expect(yield* store.facts(sessionID)).toEqual([])
            expect((yield* store.snapshot(sessionID)).current).toBeUndefined()
            expect((yield* store.snapshot(sessionID)).owned.has(id)).toBe(true)
            return id
          }),
        )
        yield* withStore(
          Effect.gen(function* () {
            const store = yield* CorrectionStore.Service
            expect(yield* store.facts(sessionID)).toEqual([])
            expect((yield* store.snapshot(sessionID)).current).toBeUndefined()
            expect((yield* store.snapshot(sessionID)).owned.has(id)).toBe(true)
            expect(yield* sync(store, sessionID)).toBe(false)
          }),
        )
      }),
    ),
  )

  it.effect("hides a recognized future record-source envelope without activating its body", () =>
    Effect.gen(function* () {
      const sessionID = yield* seedSession()
      const bus = yield* Bus.Service
      const event = yield* bus.publish(SessionEvent.Synthetic, {
        sessionID,
        text: JSON.stringify({
          key: "future",
          correct: "Do not activate",
          wrong: "./wrong",
          source: "user-correction",
          extractLayer: 3,
        }),
        metadata: { correctionSource: { kind: "record", version: 2 } },
      })
      const id = SessionMessage.ID.fromEvent(event.id)
      yield* withStore(
        Effect.gen(function* () {
          const store = yield* CorrectionStore.Service
          const canonical = yield* SessionStore.Service
          const row = yield* canonical.message(id)
          if (!row) return yield* Effect.die(new Error("Missing future source"))
          expect(CorrectionStore.isCorrectionHistory(row.message)).toBe(true)
          expect(yield* store.facts(sessionID)).toEqual([])
          expect((yield* store.snapshot(sessionID)).owned.has(id)).toBe(true)
          expect((yield* store.snapshot(sessionID)).current).toBeUndefined()
          expect(yield* sync(store, sessionID)).toBe(false)
        }),
      )
      yield* withStore(
        Effect.gen(function* () {
          const store = yield* CorrectionStore.Service
          expect(yield* store.facts(sessionID)).toEqual([])
          expect((yield* store.snapshot(sessionID)).owned.has(id)).toBe(true)
        }),
      )
    }),
  )

  it.effect("keeps an unmarked historical User inactive despite supplied observe entries", () =>
    Effect.gen(function* () {
      const sessionID = yield* seedSession()
      const id = SessionMessage.ID.create()
      const inbox = yield* SessionInbox.Service
      const database = yield* Database.Service
      const bus = yield* Bus.Service
      const canonical = yield* SessionStore.Service
      yield* inbox.admit({
        id,
        sessionID,
        item: { type: "user", payload: { text: "./good not ./bad" }, delivery: "steer" },
      })
      yield* SessionInbox.promote(database.db, bus, sessionID, "steer")
      expect((yield* canonical.message(id))?.message.origin?.kind).toBe("historical")
      yield* withStore(
        Effect.gen(function* () {
          const store = yield* CorrectionStore.Service
          yield* store.observe({
            sessionID,
            source: { id, entries: [{ key: "fake", correct: "POST", source: "user-correction", extractLayer: 2 }] },
          })
          expect(yield* store.facts(sessionID)).toEqual([])
          expect(yield* sync(store, sessionID)).toBe(false)
          expect((yield* store.snapshot(sessionID)).current).toBeUndefined()
        }),
      )
      yield* withStore(
        Effect.gen(function* () {
          const store = yield* CorrectionStore.Service
          expect(yield* store.facts(sessionID)).toEqual([])
          expect(yield* sync(store, sessionID)).toBe(false)
        }),
      )
    }),
  )
})
