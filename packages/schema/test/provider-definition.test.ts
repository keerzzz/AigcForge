import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ProviderDefinition } from "../src/provider-definition.js"
import { ConfigProvider } from "../src/config/provider.js"

describe("ProviderDefinition", () => {
  test("keeps the authored patch distinct from adoption and omits optional fields", () => {
    const decode = ProviderDefinition.decodeSave
    const input = {
      providerID: "manual",
      submissionID: "submission-one",
      target: { scope: "project", path: "/project/omnixa.jsonc" },
      expectedDigest: null,
      patch: { set: { name: "Manual", models: { chat: { modelID: "api-chat" } } }, unset: [["settings", "timeout"]] },
      credential: { type: "keep" },
    } as const
    expect(Schema.encodeSync(ProviderDefinition.SaveInput)(decode(input))).toEqual(input)
    expect(decode({ ...input, patch: { unset: [["models", "chat", "quote", "validUntil"]] } }).patch.unset).toEqual([
      ["models", "chat", "quote", "validUntil"],
    ])
    expect(() => decode({ ...input, patch: { set: { adoption: {} } } })).toThrow()
    expect(() => decode({ ...input, patch: { unset: [["adoption"]] } })).toThrow()
    expect(() => decode({ ...input, patch: { set: { models: { chat: { limit: { context: "long" } } } } } })).toThrow()
    expect(() => decode({ ...input, extra: true })).toThrow()
  })

  test("retains a safe ready receipt with a credential reference", () => {
    const input = {
      disabled: false,
      adoption: {
        phase: "ready",
        submissionID: "completed-submission",
        targetDefinitionDigest: "definition-digest",
        stage: "complete",
        credentialAction: "create",
        credentialID: "cred_saved",
        credentialLabel: "Work",
        activate: true,
        addedModelIDs: ["chat"],
      },
    } as const
    const decoded = Schema.decodeUnknownSync(ConfigProvider.Info)(input)
    expect(Schema.encodeSync(ConfigProvider.Info)(decoded)).toEqual(input)
    const encoded = Schema.encodeSync(ProviderDefinition.Patch)(
      ProviderDefinition.Patch.make({ set: undefined, unset: undefined }),
    )
    expect(encoded).toEqual({})
    expect(ProviderDefinition.Info.ast.annotations?.identifier).toBe("ProviderDefinition.Info")
    expect(ProviderDefinition.SaveInput.ast.annotations?.identifier).toBe("ProviderDefinition.SaveInput")
  })
})
