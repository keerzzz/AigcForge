import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer, Result, Stream } from "effect"
import { Config } from "../src/config"
import { Document, Info } from "@omnixa/schema/config"
import { ConfigMeta } from "../src/config/meta"
import { DoomLoop } from "../src/session/doom-loop"
import { Session } from "../src/session"
import { SessionMessage } from "../src/session/message"
import { Permission } from "../src/permission"
import { testEffect } from "./lib/effect"

const sessionID = Session.ID.make("ses_doom_loop")
const assistantMessageID = SessionMessage.ID.make("msg_doom_loop")
const source: Permission.Source = { type: "tool", messageID: assistantMessageID, id: "call_doom_loop" }

const configLayer = (meta: { enabled?: boolean; threshold?: number }) =>
  Layer.succeed(
    Config.Service,
    Config.Service.of({
      changes: () => Stream.empty,
      entries: () =>
        Effect.succeed([
          new Document({
            type: "document",
            info: Info.make({ meta: ConfigMeta.Info.make({ doom_loop: ConfigMeta.DoomLoop.make(meta) }) }),
          }),
        ]),
    }),
  )

const layerFor = (permission: Layer.Layer<Permission.Service>) =>
  DoomLoop.layer.pipe(Layer.provide(permission), Layer.provide(configLayer({})))

describe("DoomLoop", () => {
  const asserts: Permission.AssertInput[] = []
  const permission = Layer.mock(Permission.Service, {
    assert: (input) =>
      Effect.sync(() => {
        asserts.push(input)
      }),
  })
  const it = testEffect(layerFor(permission))

  it.effect("does not assert on fewer than 3 identical calls", () =>
    Effect.gen(function* () {
      asserts.length = 0
      const doomLoop = yield* DoomLoop.Service
      yield* doomLoop.check({
        sessionID,
        toolName: "edit",
        toolInput: { path: "a.ts" },
        providerExecuted: false,
        source,
      })
      yield* doomLoop.check({
        sessionID,
        toolName: "edit",
        toolInput: { path: "a.ts" },
        providerExecuted: false,
        source,
      })
      expect(asserts.length).toBe(0)
    }),
  )

  it.effect("asserts once with the doom_loop action after 3 identical calls", () =>
    Effect.gen(function* () {
      asserts.length = 0
      const doomLoop = yield* DoomLoop.Service
      for (let i = 0; i < 3; i++) {
        yield* doomLoop.check({
          sessionID,
          toolName: "edit",
          toolInput: { path: "a.ts" },
          providerExecuted: false,
          source,
        })
      }
      expect(asserts.length).toBe(1)
      expect(asserts[0]).toMatchObject({
        action: "doom_loop",
        resources: ["edit"],
        save: ["edit"],
        sessionID,
        source,
      })
    }),
  )

  it.effect("does not trigger when the tool input differs", () =>
    Effect.gen(function* () {
      asserts.length = 0
      const doomLoop = yield* DoomLoop.Service
      const calls = [
        { toolName: "edit", toolInput: { path: "a.ts" } },
        { toolName: "edit", toolInput: { path: "b.ts" } },
        { toolName: "edit", toolInput: { path: "a.ts" } },
      ]
      for (const call of calls) {
        yield* doomLoop.check({ sessionID, ...call, providerExecuted: false, source })
      }
      expect(asserts.length).toBe(0)
    }),
  )

  it.effect("counts semantically equal nested inputs with different key order", () =>
    Effect.gen(function* () {
      asserts.length = 0
      const doomLoop = yield* DoomLoop.Service
      yield* Effect.forEach(
        [
          { path: "a.ts", options: { first: 1, second: 2 } },
          { options: { second: 2, first: 1 }, path: "a.ts" },
          { path: "a.ts", options: { second: 2, first: 1 } },
        ],
        (toolInput) => doomLoop.check({ sessionID, toolName: "edit", toolInput, providerExecuted: false, source }),
      )
      expect(asserts).toHaveLength(1)
      expect(asserts[0]?.source).toEqual(source)
    }),
  )

  it.effect("does not trigger when the tool name differs", () =>
    Effect.gen(function* () {
      asserts.length = 0
      const doomLoop = yield* DoomLoop.Service
      for (let i = 0; i < 3; i++) {
        yield* doomLoop.check({
          sessionID,
          toolName: i === 2 ? "bash" : "edit",
          toolInput: { path: "a.ts" },
          providerExecuted: false,
          source,
        })
      }
      expect(asserts.length).toBe(0)
    }),
  )

  it.effect("does not trigger for provider-executed calls", () =>
    Effect.gen(function* () {
      asserts.length = 0
      const doomLoop = yield* DoomLoop.Service
      for (let i = 0; i < 3; i++) {
        yield* doomLoop.check({
          sessionID,
          toolName: "edit",
          toolInput: { path: "a.ts" },
          providerExecuted: true,
          source,
        })
      }
      expect(asserts.length).toBe(0)
    }),
  )

  it.effect("keeps a per-session ring buffer", () =>
    Effect.gen(function* () {
      asserts.length = 0
      const doomLoop = yield* DoomLoop.Service
      const other = Session.ID.make("ses_other")
      yield* doomLoop.check({
        sessionID,
        toolName: "edit",
        toolInput: { path: "a.ts" },
        providerExecuted: false,
        source,
      })
      yield* doomLoop.check({
        sessionID,
        toolName: "edit",
        toolInput: { path: "a.ts" },
        providerExecuted: false,
        source,
      })
      yield* doomLoop.check({
        sessionID: other,
        toolName: "edit",
        toolInput: { path: "a.ts" },
        providerExecuted: false,
        source,
      })
      expect(asserts.length).toBe(0)
    }),
  )

  it.effect("evicts the oldest session when the tracked buffer cap is reached", () =>
    Effect.gen(function* () {
      asserts.length = 0
      const doomLoop = yield* DoomLoop.Service
      const sessions = Array.from({ length: 40 }, (_, i) => Session.ID.make(`ses_cap_${i}`))
      for (const sid of sessions) {
        yield* doomLoop.check({
          sessionID: sid,
          toolName: "edit",
          toolInput: { path: "a.ts" },
          providerExecuted: false,
          source,
        })
      }
      expect(asserts.length).toBe(0)
      const first = sessions[0]
      const second = sessions[1]
      const later = sessions[39]
      yield* doomLoop.check({
        sessionID: later,
        toolName: "edit",
        toolInput: { path: "a.ts" },
        providerExecuted: false,
        source,
      })
      yield* doomLoop.check({
        sessionID: later,
        toolName: "edit",
        toolInput: { path: "a.ts" },
        providerExecuted: false,
        source,
      })
      expect(asserts.length).toBe(1)
      yield* doomLoop.check({
        sessionID: first,
        toolName: "edit",
        toolInput: { path: "a.ts" },
        providerExecuted: false,
        source,
      })
      yield* doomLoop.check({
        sessionID: first,
        toolName: "edit",
        toolInput: { path: "a.ts" },
        providerExecuted: false,
        source,
      })
      expect(asserts.length).toBe(1)
      yield* doomLoop.check({
        sessionID: second,
        toolName: "edit",
        toolInput: { path: "a.ts" },
        providerExecuted: false,
        source,
      })
      yield* doomLoop.check({
        sessionID: second,
        toolName: "edit",
        toolInput: { path: "a.ts" },
        providerExecuted: false,
        source,
      })
      yield* doomLoop.check({
        sessionID: second,
        toolName: "edit",
        toolInput: { path: "a.ts" },
        providerExecuted: false,
        source,
      })
      expect(asserts.length).toBe(2)
    }),
  )
})

describe("DoomLoop threshold", () => {
  const asserts: Permission.AssertInput[] = []
  const permission = Layer.mock(Permission.Service, {
    assert: (input) =>
      Effect.sync(() => {
        asserts.push(input)
      }),
  })
  const it = testEffect(DoomLoop.layer.pipe(Layer.provide(permission), Layer.provide(configLayer({ threshold: 2 }))))

  it.effect("honors the configured threshold", () =>
    Effect.gen(function* () {
      asserts.length = 0
      const doomLoop = yield* DoomLoop.Service
      yield* doomLoop.check({
        sessionID,
        toolName: "edit",
        toolInput: { path: "a.ts" },
        providerExecuted: false,
        source,
      })
      expect(asserts.length).toBe(0)
      yield* doomLoop.check({
        sessionID,
        toolName: "edit",
        toolInput: { path: "a.ts" },
        providerExecuted: false,
        source,
      })
      expect(asserts.length).toBe(1)
    }),
  )
})

describe("DoomLoop disabled", () => {
  const asserts: Permission.AssertInput[] = []
  const permission = Layer.mock(Permission.Service, {
    assert: (input) =>
      Effect.sync(() => {
        asserts.push(input)
      }),
  })
  const it = testEffect(DoomLoop.layer.pipe(Layer.provide(permission), Layer.provide(configLayer({ enabled: false }))))

  it.effect("does nothing when disabled", () =>
    Effect.gen(function* () {
      asserts.length = 0
      const doomLoop = yield* DoomLoop.Service
      for (let i = 0; i < 3; i++) {
        yield* doomLoop.check({
          sessionID,
          toolName: "edit",
          toolInput: { path: "a.ts" },
          providerExecuted: false,
          source,
        })
      }
      expect(asserts.length).toBe(0)
    }),
  )
})

describe("DoomLoop deny", () => {
  const denied = Layer.mock(Permission.Service, {
    // Base semantics: a user decline travels as a defect (tool/AGENTS.md), so the
    // mock dies with DeclinedError instead of failing with a typed error.
    assert: (input: Permission.AssertInput) => {
      void input
      return Effect.die(new Permission.DeclinedError({}))
    },
  })
  const it = testEffect(layerFor(denied))

  it.effect("fails with DeniedError when the rule denies", () =>
    Effect.gen(function* () {
      const doomLoop = yield* DoomLoop.Service
      let failed: unknown
      for (let i = 0; i < 3; i++) {
        const exit = yield* doomLoop
          .check({ sessionID, toolName: "edit", toolInput: { path: "a.ts" }, providerExecuted: false, source })
          .pipe(Effect.exit)
        if (Exit.isFailure(exit)) {
          const defect = Cause.findDefect(exit.cause)
          if (Result.isSuccess(defect)) failed = defect.success
        }
      }
      expect(failed).toBeInstanceOf(Permission.DeclinedError)
    }),
  )
})
