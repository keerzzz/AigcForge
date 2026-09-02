import { describe, expect, test } from "bun:test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { resolveProviderDirectory } from "@/hooks/provider-location"

const encoded = base64Encode("/repo/from-route")

describe("resolveProviderDirectory", () => {
  test("prefers the SDK Location over the route param", () => {
    // Both are present on the `/:dir/...` routes; the SDK is the Location owner, so
    // a stale or unrelated URL segment must not decide which providers are listed.
    expect(resolveProviderDirectory({ sdkDirectory: "/repo/from-sdk", routeParam: encoded })).toBe("/repo/from-sdk")
  })

  test("falls back to the route param where there is no SDK context", () => {
    // `ModelsProvider` wraps `Layout`, which is where `SDKProvider` is mounted, so
    // `context/models.tsx` reaches this with no SDK above it.
    expect(resolveProviderDirectory({ sdkDirectory: undefined, routeParam: encoded })).toBe("/repo/from-route")
  })

  test("reports no Location when neither source has one", () => {
    // This is the target Session and draft routes before the fix: no `:dir` in the
    // URL, so the caller correctly falls back to the server-global provider list.
    expect(resolveProviderDirectory({ sdkDirectory: undefined, routeParam: undefined })).toBe("")
    expect(resolveProviderDirectory({ sdkDirectory: "", routeParam: undefined })).toBe("")
  })

  test("treats an undecodable route param as no Location rather than passing it through", () => {
    expect(resolveProviderDirectory({ sdkDirectory: undefined, routeParam: "!!!not-base64!!!" })).toBe("")
  })

  test("still prefers the SDK Location when the route param is undecodable", () => {
    expect(resolveProviderDirectory({ sdkDirectory: "/repo", routeParam: "!!!" })).toBe("/repo")
  })
})
