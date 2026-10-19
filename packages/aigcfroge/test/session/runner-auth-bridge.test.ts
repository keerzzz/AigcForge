import { expect } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { CrossSpawnSpawner } from "@aigcfroge/core/cross-spawn-spawner"
import { EffectBridge } from "@/effect/bridge"
import { InstanceRef } from "@/effect/instance-ref"
import { Provider } from "@/provider/provider"
import { resolveTransport } from "@/session/runner-auth-bridge"
import { TestInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    CrossSpawnSpawner.defaultLayer,
    Layer.mock(Provider.Service, {
      getProvider: (id) =>
        Effect.gen(function* () {
          const bridge = yield* EffectBridge.make()
          return {
            id,
            name: "Test OAuth",
            source: "custom" as const,
            env: [],
            models: {},
            options:
              id === "missing"
                ? {}
                : {
                    fetch: async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
                      const instance = await bridge.promise(InstanceRef)
                      return Response.json({
                        directory: instance?.directory,
                        input: String(input),
                        method: init?.method,
                      })
                    },
                  },
          }
        }),
    }),
  ),
)

it.instance("OAuth transports retain their Session Location when used after another Location resolves", () =>
  Effect.gen(function* () {
    const firstDirectory = (yield* TestInstance).directory
    const secondDirectory = yield* tmpdirScoped()
    const first = yield* resolveTransport("openai", { directory: AbsolutePath.make(firstDirectory) })
    const second = yield* resolveTransport("openai", { directory: AbsolutePath.make(secondDirectory) })
    const firstResponse = yield* Effect.promise(() =>
      first.fetch("https://provider.invalid/v1/responses", { method: "POST" }),
    )
    const secondResponse = yield* Effect.promise(() =>
      second.fetch("https://provider.invalid/v1/responses", { method: "POST" }),
    )
    expect(yield* Effect.promise(() => firstResponse.json())).toEqual({
      directory: firstDirectory,
      input: "https://provider.invalid/v1/responses",
      method: "POST",
    })
    expect(yield* Effect.promise(() => secondResponse.json())).toEqual({
      directory: secondDirectory,
      input: "https://provider.invalid/v1/responses",
      method: "POST",
    })
  }),
)

it.instance("OAuth resolution fails before sending when its plugin transport is unavailable", () =>
  Effect.gen(function* () {
    const result = yield* resolveTransport("missing", {
      directory: AbsolutePath.make((yield* TestInstance).directory),
    }).pipe(Effect.exit)
    expect(Exit.isFailure(result)).toBe(true)
  }),
)
