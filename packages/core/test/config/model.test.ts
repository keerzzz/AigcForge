import { describe, expect, test } from "bun:test"
import { ConfigModel } from "@omnixa/schema/config/model"
import { Model } from "@omnixa/core/model"
import { Provider } from "@omnixa/schema/provider"
import { Schema } from "effect"

const decode = Schema.decodeUnknownSync(ConfigModel.Selection)

describe("ConfigModel.Selection", () => {
  test("normalizes short and explicit model selections", () => {
    expect(decode("openrouter/openai/gpt-5#high")).toEqual({
      providerID: Provider.ID.make("openrouter"),
      model: Model.ID.make("openai/gpt-5"),
      variant: Model.VariantID.make("high"),
    })
    expect(decode({ providerID: "anthropic", model: "claude-sonnet", variant: "high" })).toEqual({
      providerID: Provider.ID.make("anthropic"),
      model: Model.ID.make("claude-sonnet"),
      variant: Model.VariantID.make("high"),
    })
  })

  test("rejects malformed selections and reserved fragments", () => {
    expect(() => decode("gpt-5")).toThrow()
    expect(() => decode("openai/gpt-5#")).toThrow()
    expect(() => decode({ providerID: "openai", model: "gpt-5#high" })).toThrow()
  })

  test("retains logical groups through the shared config conversion and preserves physical group-prefixed providers", () => {
    const group = new Model.GroupRef({ type: "group", groupID: Model.GroupID.make("fallback") })
    expect(Model.fromConfig(decode("group:fallback"))).toEqual(group)
    expect(Model.fromConfig(decode({ type: "group", groupID: "fallback" }))).toEqual(group)
    expect(Model.fromConfig(decode("group:vendor/chat#high"))).toEqual(Model.Ref.parse("group:vendor/chat#high"))
  })
})
