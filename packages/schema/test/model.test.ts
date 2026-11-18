import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Model } from "../src/model.js"
import { Provider } from "../src/provider.js"
import { ConfigModel } from "../src/config/model.js"

describe("Model.Selection", () => {
  test("preserves physical references and explicit logical group identity", () => {
    const physical = Model.Selection.parse("openrouter/openai/gpt-5#high")
    expect(physical).toEqual(Model.Ref.parse("openrouter/openai/gpt-5#high"))
    expect(Model.Selection.isGroup(physical)).toBe(false)
    const group = Model.Selection.parse("group:primary")
    expect(Schema.encodeSync(Model.Selection)(group)).toEqual({ type: "group", groupID: "primary" })
    expect(Model.Selection.isGroup(group)).toBe(true)
    expect(() => Model.Selection.parse("group:")).toThrow()
    expect(() => Schema.decodeUnknownSync(Model.Ref)(group)).toThrow()
    expect(Model.Selection.parse("group:vendor/model#high")).toEqual(Model.Ref.parse("group:vendor/model#high"))
    expect(() => Model.GroupID.make("vendor/model")).toThrow()
  })

  test("normalizes group and legacy config inputs at the original boundary", () => {
    const decode = Schema.decodeUnknownSync(ConfigModel.Selection)
    expect(Schema.encodeSync(ConfigModel.Selection)(decode("group:primary"))).toEqual({
      type: "group",
      groupID: "primary",
    })
    expect(Schema.encodeSync(ConfigModel.Selection)(decode({ type: "group", groupID: "primary" }))).toEqual({
      type: "group",
      groupID: "primary",
    })
    expect(Schema.encodeSync(ConfigModel.Selection)(decode("openai/gpt-5#high"))).toEqual({
      providerID: "openai",
      model: "gpt-5",
      variant: "high",
    })
    expect(Schema.encodeSync(ConfigModel.Selection)(decode("group:primary"))).toEqual({
      type: "group",
      groupID: "primary",
    })
    expect(() => decode("group:")).toThrow()
  })
})

describe("Model.Ref", () => {
  test("parses model references with optional variants", () => {
    const variant = Model.Ref.parse("openrouter/openai/gpt-5#high")
    expect(String(variant.providerID)).toBe("openrouter")
    expect(String(variant.id)).toBe("openai/gpt-5")
    expect(String(variant.variant)).toBe("high")

    const standard = Model.Ref.parse("anthropic/claude-sonnet")
    expect(String(standard.providerID)).toBe("anthropic")
    expect(String(standard.id)).toBe("claude-sonnet")
    expect(standard.variant).toBeUndefined()
  })

  test("rejects malformed model references", () => {
    expect(() => Model.Ref.parse("gpt-5")).toThrow()
    expect(() => Model.Ref.parse("openai/gpt-5#")).toThrow()
    expect(() => Model.Ref.parse("openai/gpt-5#high#extra")).toThrow()
  })
})

describe("Model.ReasoningField", () => {
  test("accepts suggested and custom fields", () => {
    const decode = Schema.decodeUnknownSync(Model.ReasoningField)

    for (const field of ["reasoning", "reasoning_content", "reasoning_text", "vendor_reasoning"])
      expect(decode(field)).toBe(field)
  })
})

describe("Model.Compatibility", () => {
  test("decodes model compatibility overrides", () => {
    const decode = Schema.decodeUnknownSync(Model.Compatibility)

    expect(decode({})).toEqual({})
    expect(
      decode({
        reasoningField: "vendor_reasoning",
        requireReasoning: true,
        maxTokensField: "max_completion_tokens",
        requireFinishReason: false,
        requireAssistantAfterTool: true,
      }),
    ).toEqual({
      reasoningField: "vendor_reasoning",
      requireReasoning: true,
      maxTokensField: "max_completion_tokens",
      requireFinishReason: false,
      requireAssistantAfterTool: true,
    })
  })

  test("keeps capability overrides that gate protocol features", () => {
    const decode = Schema.decodeUnknownSync(Model.Compatibility)

    for (const supportsEffortUpdates of [false, true]) {
      expect(decode({ supportsEffortUpdates, supportsThinkingBlockBinding: true })).toEqual({
        supportsEffortUpdates,
        supportsThinkingBlockBinding: true,
      })
    }
  })

  test("omits undefined protocol capability overrides when encoded", () => {
    expect(
      Schema.encodeSync(Model.Compatibility)({
        supportsEffortUpdates: undefined,
        supportsThinkingBlockBinding: undefined,
      }),
    ).toEqual({})
  })
})

describe("Model.Info", () => {
  test("provider compaction policy is a typed setting", () => {
    const model = Model.Info.default(Provider.ID.openai, Model.ID.make("gpt-5.4-mini"))
    expect(Schema.encodeSync(Model.Info)({ ...model, settings: { compaction: undefined } }).settings).toEqual({})
    expect(
      Schema.decodeUnknownSync(Model.Info)({ ...model, settings: { compaction: { type: "native" } } }).settings,
    ).toEqual({
      compaction: { type: "native" },
    })
    expect(Schema.decodeUnknownSync(Provider.Compaction)({ type: "summary" })).toEqual({ type: "summary" })
    expect(() => Schema.decodeUnknownSync(Provider.Compaction)({ type: "automatic" })).toThrow()
  })

  test("uses practical token limits for unknown models", () => {
    const model = Model.Info.default(Provider.ID.make("custom"), Model.ID.make("gpt-5.6"))

    expect(model.limit).toEqual({ context: 200_000, output: 32_000 })
  })
})

describe("Model.Settings", () => {
  test("preserves provider-specific model options", () => {
    expect(Schema.decodeUnknownSync(Model.Settings)({ providerOption: true })).toEqual({
      providerOption: true,
    })
  })
})
