import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Model } from "../src/model.js"
import { ModelSource } from "../src/model-source.js"
import { ProviderDiscovery } from "../src/provider-discovery.js"
import { ProviderDefinition } from "../src/provider-definition.js"
import { ConfigProvider } from "../src/config/provider.js"

const identity = {
  providerID: "relay",
  connection: { type: "credential", id: "cred_account" },
  listURL: "https://relay.example/gateway/v1/models",
  protocol: "openai",
  auth: "bearer",
  configurationDigest: "configuration-one",
} as const

describe("ProviderDiscovery", () => {
  test("retains the canonical Model metadata values through its facade", () => {
    expect(Model.Family).toBe(ModelSource.Family)
    expect(Model.ReasoningField).toBe(ModelSource.ReasoningField)
    expect(Model.MaxTokensField).toBe(ModelSource.MaxTokensField)
    expect(Model.Compatibility).toBe(ModelSource.Compatibility)
    expect(Model.Capabilities).toBe(ModelSource.Capabilities)
    expect(Model.Cost).toBe(ModelSource.Cost)
    expect(Model.Compatibility.ast.annotations?.identifier).toBe("Model.Compatibility")
    expect(ModelSource.Identity.ast.annotations?.identifier).toBe("ModelSource.Identity")
    expect(ProviderDiscovery.Read.ast.annotations?.identifier).toBe("ProviderDiscovery.Read")
  })

  test("omits absent metadata and retains false and unknown price", () => {
    const input = { compatibility: { requireReasoning: false }, capabilities: { tools: false }, quote: { status: "unknown" } } as const
    const decoded = Schema.decodeUnknownSync(ModelSource.Metadata)(input)
    expect(Schema.encodeSync(ModelSource.Metadata)(decoded)).toEqual(input)
    expect(Schema.encodeSync(ModelSource.Metadata)(ModelSource.Metadata.make({}))).toEqual({})
    expect(Schema.decodeUnknownSync(ModelSource.Quote)({ status: "free", prices: [] })).toEqual({ status: "free", prices: [] })
    expect(() => Schema.decodeUnknownSync(ModelSource.Quote)({ status: "known" })).toThrow()
    expect(() => Schema.decodeUnknownSync(ModelSource.Quote)({ status: "free" })).toThrow()
  })

  test("distinguishes new drafts from stored patches and rejects unintended fields", () => {
    const stored = {
      providerID: "relay",
      definition: {
        type: "stored",
        target: { scope: "project", path: "/project/aigcfroge.jsonc" },
        expectedDigest: "file-one",
        patch: { set: { settings: { baseURL: "https://relay.example/gateway/v1" } }, unset: [["discovery", "list", "url"]] },
      },
      credential: { type: "active" },
    } as const
    expect(Schema.encodeSync(ProviderDiscovery.PreviewInput)(ProviderDiscovery.decodePreview(stored))).toEqual(stored)
    const draft = { providerID: "relay", definition: { type: "new", definition: { package: "@aigcfroge/ai/providers/openai-compatible", settings: { baseURL: "https://relay.example/v1" } } }, credential: { type: "key", key: "draft-key" } } as const
    expect(Schema.encodeSync(ProviderDiscovery.PreviewInput)(ProviderDiscovery.decodePreview(draft))).toEqual(draft)
    expect(() => ProviderDiscovery.decodePreview({ ...draft, extra: true })).toThrow()
    expect(() => ProviderDiscovery.decodePreview({ ...draft, definition: draft.definition.definition })).toThrow()
    expect(() => ProviderDiscovery.decodePreview({ ...draft, definition: { type: "new", definition: { adoption: {} } } })).toThrow()
  })

  test("preserves multiple managed aliases for one discovered API model", () => {
    const input = {
      status: { providerID: "relay", identity, phase: "ready", cachePersisted: true, generation: 2 },
      inventory: { identity, complete: true, digest: "inventory-one", observedAt: 1, models: [{ id: "api-model", metadata: {} }] },
      candidates: [{ id: "api-model", metadata: {}, managedRefs: [{ providerID: "relay", id: "chat" }, { providerID: "relay", id: "reasoning" }], membership: "present" }],
      managed: [{ ref: { providerID: "relay", id: "chat" }, modelID: "api-model", metadata: { capabilities: { tools: false } }, origins: { capabilities: { tools: "live" } }, membership: "present" }],
    } as const
    const decoded = Schema.decodeUnknownSync(ProviderDiscovery.Read)(input)
    expect(Schema.encodeSync(ProviderDiscovery.Read)(decoded)).toEqual(input)
    expect(decoded.candidates[0].managedRefs).toHaveLength(2)
  })

  test("persists discovery controls and an identity-bound import seed", () => {
    const input = { discovery: { enabled: false, autoSync: false }, models: { chat: { modelID: "api-model", seed: { identity, inventoryDigest: "inventory-one", observedAt: 1, metadata: { name: "Live model" } } } } } as const
    expect(Schema.encodeSync(ConfigProvider.Info)(Schema.decodeUnknownSync(ConfigProvider.Info)(input))).toEqual(input)
    expect(() => Schema.decodeUnknownSync(ConfigProvider.Info)({ discovery: { intervalMs: 0 } })).toThrow()
    expect(() => Schema.decodeUnknownSync(ProviderDefinition.UnsetPath)(["models", "chat", "seed", "identity"])).toThrow()
  })
})
