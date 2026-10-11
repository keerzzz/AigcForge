import { afterEach, expect, test } from "bun:test"
import { Context, Effect } from "effect"
import { Credential } from "@aigcfroge/core/credential"
import { register, getCredential } from "@aigcfroge/core/session/runner/auth-seam"

// The seam is a module-level singleton (same pattern as TaskDriver).
// Reset to a no-op resolver after each test to prevent cross-test leakage.
afterEach(() => {
  register(() => Effect.succeed(undefined))
})

// Resolvers supply their own application dependencies at registration.
class TestAuth extends Context.Service<TestAuth, { readonly key: string }>()("@test/Auth") {}

test("auth seam returns credential from registered resolver", async () => {
  const key = Credential.Key.make({ type: "key", key: "test-key" })
  register((providerID) => Effect.succeed(providerID === "openai" ? { credential: key } : undefined))

  const result = await Effect.runPromise(getCredential("openai"))
  expect(result).toEqual(key)
})

test("auth seam returns undefined for unknown provider", async () => {
  const key = Credential.Key.make({ type: "key", key: "test-key" })
  register((providerID) => Effect.succeed(providerID === "openai" ? { credential: key } : undefined))

  const result = await Effect.runPromise(getCredential("anthropic"))
  expect(result).toBeUndefined()
})

test("auth seam resolver supplies its application context", async () => {
  register((providerID) =>
    Effect.gen(function* () {
      const auth = yield* TestAuth
      return { credential: Credential.Key.make({ type: "key", key: `${providerID}:${auth.key}` }) }
    }).pipe(Effect.provideService(TestAuth, { key: "secret" })),
  )

  const result = await Effect.runPromise(getCredential("openai"))
  expect(result).toEqual(Credential.Key.make({ type: "key", key: "openai:secret" }))
})
