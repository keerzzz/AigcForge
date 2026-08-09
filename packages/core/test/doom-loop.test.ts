import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer, Option } from "effect"
import { Config } from "../src/config"
import { ConfigMeta } from "../src/config/meta"
import { DoomLoop } from "../src/session/doom-loop"
import { SessionV2 } from "../src/session"
import { SessionMessage } from "../src/session/message"
import { PermissionV2 } from "../src/permission"
import { testEffect } from "./lib/effect"

const sessionID = SessionV2.ID.make("ses_doom_loop")
const assistantMessageID = SessionMessage.ID.make("msg_doom_loop")
const source: PermissionV2.Source = { type: "tool", messageID: assistantMessageID, callID: "call_doom_loop" }

const configLayer = (meta: { enabled?: boolean; threshold?: number }) =>
  Layer.succeed(
    Config.Service,
    Config.Service.of({
      entries: () =>
        Effect.succeed([
          new Config.Document({
            type: "document",
            info: Config.Info.make({ meta: ConfigMeta.Info.make({ doom_loop: ConfigMeta.DoomLoop.make(meta) }) }),
          }),
        ]),
    }),
  )

const layerFor = (permission: Layer.Layer<PermissionV2.Service, never>) =>
  DoomLoop.layer.pipe(Layer.provide(permission), Layer.provide(configLayer({})))

describe("DoomLoop", () => {
  const asserts: PermissionV2.AssertInput[] = []
  const permission = Layer.mock(PermissionV2.Service, {
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
      yield* doomLoop.check({ sessionID, toolName: "edit", toolInput: { path: "a.ts" }, providerExecuted: false, source })
      yield* doomLoop.check({ sessionID, toolName: "edit", toolInput: { path: "a.ts" }, providerExecuted: false, source })
      expect(asserts.length).toBe(0)
    }),
  )

  it.effect("asserts once with the doom_loop action after 3 identical calls", () =>
    Effect.gen(function* () {
      asserts.length = 0
      const doomLoop = yield* DoomLoop.Service
      for (let i = 0; i < 3; i++) {
        yield* doomLoop.check({ sessionID, toolName: "edit", toolInput: { path: "a.ts" }, providerExecuted: false, source })
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
        yield* doomLoop.check({ sessionID, toolName: "edit", toolInput: { path: "a.ts" }, providerExecuted: true, source })
      }
      expect(asserts.length).toBe(0)
    }),
  )

  it.effect("keeps a per-session ring buffer", () =>
    Effect.gen(function* () {
      asserts.length = 0
      const doomLoop = yield* DoomLoop.Service
      const other = SessionV2.ID.make("ses_other")
      yield* doomLoop.check({ sessionID, toolName: "edit", toolInput: { path: "a.ts" }, providerExecuted: false, source })
      yield* doomLoop.check({ sessionID, toolName: "edit", toolInput: { path: "a.ts" }, providerExecuted: false, source })
      yield* doomLoop.check({ sessionID: other, toolName: "edit", toolInput: { path: "a.ts" }, providerExecuted: false, source })
      expect(asserts.length).toBe(0)
    }),
  )
})

describe("DoomLoop threshold", () => {
  const asserts: PermissionV2.AssertInput[] = []
  const permission = Layer.mock(PermissionV2.Service, {
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
      yield* doomLoop.check({ sessionID, toolName: "edit", toolInput: { path: "a.ts" }, providerExecuted: false, source })
      expect(asserts.length).toBe(0)
      yield* doomLoop.check({ sessionID, toolName: "edit", toolInput: { path: "a.ts" }, providerExecuted: false, source })
      expect(asserts.length).toBe(1)
    }),
  )
})

describe("DoomLoop disabled", () => {
  const asserts: PermissionV2.AssertInput[] = []
  const permission = Layer.mock(PermissionV2.Service, {
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
        yield* doomLoop.check({ sessionID, toolName: "edit", toolInput: { path: "a.ts" }, providerExecuted: false, source })
      }
      expect(asserts.length).toBe(0)
    }),
  )
})

describe("DoomLoop deny", () => {
  const denied = Layer.mock(PermissionV2.Service, {
    assert: () => Effect.fail(new PermissionV2.DeniedError({ rules: [{ action: "doom_loop", resource: "*", effect: "deny" }] })),
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
        if (Exit.isFailure(exit)) failed = Cause.findErrorOption(exit.cause).pipe(Option.getOrUndefined)
      }
      expect(failed).toBeInstanceOf(PermissionV2.DeniedError)
    }),
  )
})
