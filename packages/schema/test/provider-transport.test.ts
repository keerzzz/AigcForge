import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Provider } from "../src/provider"

/**
 * S3b RED — the provider transport deadlines have no typed owner.
 *
 * `settings` is `Schema.Record(Schema.String, Schema.Unknown)`, so every value below decodes
 * today, including the ones that cannot mean anything: `timeout: 0` (is that "immediately" or
 * "disabled"?), `timeout: -1`, `timeout: "5s"`. `packages/core/src/provider.ts` then widens the
 * same field to `any`, and `aisdk.ts` reads `timeout` and `chunkTimeout` out of that untyped bag
 * while `headerTimeout` — which V1 has and honours — is silently ignored.
 *
 * The point of naming the three fields here rather than in core is that the API shape is one
 * contract shared by config, catalog, model and the adapter. Naming them must not close the
 * record: providers legitimately carry their own options (`apiKey`, `region`, nested
 * credential objects), and those have to keep decoding untouched.
 */
const aisdk = (settings: Record<string, unknown>) => ({ type: "aisdk", package: "@ai-sdk/openai", settings })

const decode = Schema.decodeUnknownSync(Provider.AISDK)

describe("provider transport deadlines are typed", () => {
  test("accepts all three deadlines in milliseconds", () => {
    const value = decode(aisdk({ timeout: 120_000, headerTimeout: 10_000, chunkTimeout: 60_000 }))
    expect(value.settings).toMatchObject({ timeout: 120_000, headerTimeout: 10_000, chunkTimeout: 60_000 })
  })

  test("accepts false as the explicit way to switch a deadline off", () => {
    // Explicit rather than magic: `0` is not a value, so nothing has to guess whether it means
    // "no wait" or "no limit".
    const value = decode(aisdk({ timeout: false, headerTimeout: false, chunkTimeout: false }))
    expect(value.settings).toMatchObject({ timeout: false, headerTimeout: false, chunkTimeout: false })
  })

  test("accepts them omitted", () => {
    expect(decode(aisdk({})).settings).toEqual({})
  })

  test("keeps provider-specific options alongside the deadlines", () => {
    const value = decode(
      aisdk({
        timeout: 30_000,
        apiKey: "sk-test",
        region: "us-east-1",
        credentials: { accessKeyId: "a", secretAccessKey: "b" },
      }),
    )
    expect(value.settings).toMatchObject({
      timeout: 30_000,
      apiKey: "sk-test",
      region: "us-east-1",
      credentials: { accessKeyId: "a", secretAccessKey: "b" },
    })
  })

  test("rejects zero, which would have to mean two things at once", () => {
    expect(() => decode(aisdk({ timeout: 0 }))).toThrow()
    expect(() => decode(aisdk({ headerTimeout: 0 }))).toThrow()
    expect(() => decode(aisdk({ chunkTimeout: 0 }))).toThrow()
  })

  test("rejects negative and non-integer deadlines", () => {
    expect(() => decode(aisdk({ timeout: -1 }))).toThrow()
    expect(() => decode(aisdk({ headerTimeout: 1.5 }))).toThrow()
  })

  test("rejects a deadline that is not a number or false", () => {
    expect(() => decode(aisdk({ timeout: "5s" }))).toThrow()
    expect(() => decode(aisdk({ chunkTimeout: true }))).toThrow()
    expect(() => decode(aisdk({ headerTimeout: null }))).toThrow()
  })

  test("the native api carries the same contract", () => {
    const native = Schema.decodeUnknownSync(Provider.Native)({ type: "native", settings: { headerTimeout: 10_000 } })
    expect(native.settings).toMatchObject({ headerTimeout: 10_000 })
    expect(() =>
      Schema.decodeUnknownSync(Provider.Native)({ type: "native", settings: { headerTimeout: 0 } }),
    ).toThrow()
  })
})
