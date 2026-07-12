import { afterEach, expect, test } from "bun:test"
import { Context, Effect } from "effect"
import { Credential } from "@aigcfroge/core/credential"
import { register, getCredential } from "@aigcfroge/core/session/runner/auth-seam"

// The seam is a module-level singleton (same pattern as TaskDriver).
// Reset to a no-op resolver after each test to prevent cross-test leakage.
afterEach(() => {
  register(() => Effect.succeed(undefined))
})

// getCredential returns Effect<..., unknown> because the resolver's requirements
// are open (the resolver runs in the caller's context). Cast away the unknown
// requirement for testing - same pattern as model.ts:240.
const runCredential = (providerID: string) =>
  getCredential(providerID) as unknown as Effect.Effect<Credential.Value | undefined>

// Test service to verify that the resolver Effect inherits the caller's context.
// This is the core design intent: the V2 runner provides Auth.Service, and the
// resolver (installed by the app layer) reads it via that inherited context.
class TestAuth extends Context.Service<TestAuth, { readonly key: string }>()("@test/Auth") {}

test("auth seam returns credential from registered resolver", async () => {
  const key = Credential.Key.make({ type: "key", key: "test-key" })
  register((providerID) => Effect.succeed(providerID === "openai" ? key : undefined))

  const result = await Effect.runPromise(runCredential("openai"))
  expect(result).toEqual(key)
})

test("auth seam returns undefined for unknown provider", async () => {
  const key = Credential.Key.make({ type: "key", key: "test-key" })
  register((providerID) => Effect.succeed(providerID === "openai" ? key : undefined))

  const result = await Effect.runPromise(runCredential("anthropic"))
  expect(result).toBeUndefined()
})

test("auth seam resolver inherits caller Effect context", async () => {
  // The resolver runs in the caller's context, not the registrant's.
  // If context propagation is broken, yield* TestAuth fails with "Service not found".
  register((providerID) =>
    Effect.gen(function* () {
      const auth = yield* TestAuth
      return Credential.Key.make({ type: "key", key: `${providerID}:${auth.key}` })
    }),
  )

  const result = await Effect.runPromise(
    (getCredential("openai") as unknown as Effect.Effect<
      Credential.Value | undefined,
      never,
      TestAuth
    >).pipe(Effect.provideService(TestAuth, { key: "secret" })),
  )
  expect(result).toEqual(Credential.Key.make({ type: "key", key: "openai:secret" }))
})
