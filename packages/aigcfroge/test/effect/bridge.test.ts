import { expect } from "bun:test"
import { getEventListeners } from "node:events"
import { Deferred, Effect, Exit, Layer, Ref } from "effect"
import { EffectBridge } from "../../src/effect/bridge"
import { InstanceRef } from "../../src/effect/instance-ref"
import { TestInstance } from "../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

it.live("EffectBridge interrupts an admitted callback and completes its finalizer on AbortSignal", () =>
  Effect.gen(function* () {
    const bridge = yield* EffectBridge.make()
    const ready = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const finalized = yield* Deferred.make<void>()
    const controller = new AbortController()
    const outcome = yield* Effect.sync(() =>
      bridge
        .promise(
          Deferred.succeed(ready, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.ensuring(Deferred.succeed(finalized, undefined)),
            EffectBridge.interruptOnSignal(controller.signal),
          ),
        )
        .then(
          () => "completed",
          () => "interrupted",
        ),
    )
    yield* Effect.addFinalizer(() =>
      Deferred.succeed(release, undefined).pipe(Effect.andThen(Effect.promise(() => outcome)), Effect.asVoid),
    )
    yield* awaitWithTimeout(Deferred.await(ready), "callback did not start")
    controller.abort()
    yield* awaitWithTimeout(Deferred.await(finalized), "aborted callback did not finalize")
    expect(yield* Effect.promise(() => outcome)).toBe("interrupted")
  }),
)

it.live("EffectBridge does not start work for an already aborted signal", () =>
  Effect.gen(function* () {
    const bridge = yield* EffectBridge.make()
    const started = yield* Ref.make(false)
    const controller = new AbortController()
    controller.abort()
    const outcome = yield* Effect.promise(() =>
      bridge.promise(Ref.set(started, true).pipe(EffectBridge.interruptOnSignal(controller.signal))).then(
        () => "completed",
        () => "interrupted",
      ),
    )
    expect(outcome).toBe("interrupted")
    expect(yield* Ref.get(started)).toBe(false)
  }),
)

it.instance("EffectBridge preserves instance context when a live signal is supplied", () =>
  Effect.gen(function* () {
    const instance = yield* TestInstance
    const bridge = yield* EffectBridge.make()
    const controller = new AbortController()
    const directory = yield* Effect.promise(() =>
      bridge.promise(
        Effect.map(InstanceRef, (ref) => ref?.directory).pipe(EffectBridge.interruptOnSignal(controller.signal)),
      ),
    )
    expect(directory).toBe(instance.directory)
  }),
)

it.live("EffectBridge releases listeners when work aborts before callback registration", () =>
  Effect.gen(function* () {
    const controller = new AbortController()
    const exit = yield* awaitWithTimeout(
      Effect.sync(() => controller.abort()).pipe(
        Effect.andThen(Effect.never),
        EffectBridge.interruptOnSignal(controller.signal),
      ),
      "synchronous abort did not interrupt the waiting callback",
    ).pipe(Effect.exit)
    expect(Exit.hasInterrupts(exit)).toBe(true)
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0)
  }),
)
