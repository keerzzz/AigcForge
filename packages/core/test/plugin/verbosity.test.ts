import { expect } from "bun:test"
import { Effect } from "effect"
import { Agent } from "@aigcfroge/core/agent"
import { Model } from "@aigcfroge/core/model"
import { Plugin } from "@aigcfroge/core/plugin"
import { PluginHooks } from "@aigcfroge/core/plugin/hooks"
import { PluginHost } from "@aigcfroge/core/plugin/host"
import { VerbosityPlugin } from "@aigcfroge/core/plugin/verbosity"
import { Provider } from "@aigcfroge/core/provider"
import { Session } from "@aigcfroge/core/session"
import type { SessionHooks } from "@aigcfroge/plugin/effect/session"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const ref = (providerID: string, id: string, variant?: string) =>
  Model.Ref.make({
    providerID: Provider.ID.make(providerID),
    id: Model.ID.make(id),
    ...(variant ? { variant: Model.VariantID.make(variant) } : {}),
  })
const request = (model: Model.Ref, options: SessionHooks["context"]["options"] = {}): SessionHooks["context"] => ({
  sessionID: Session.ID.make("ses_verbosity"),
  agent: Agent.ID.make("build"),
  model,
  system: [],
  messages: [],
  tools: {},
  options,
})

it.effect("sets known OpenAI Responses defaults without overriding configured or unknown models", () =>
  Effect.gen(function* () {
    const providers = yield* Provider.Service
    const plugins = yield* Plugin.Service
    const hooks = yield* PluginHooks.Service
    yield* providers.transform((editor) => {
      editor.add({
        info: { ...Provider.Info.empty(Provider.ID.make("openai")), package: "@aigcfroge/ai/providers/openai" },
        models: [
          { ...Model.Info.default(Provider.ID.make("openai"), Model.ID.make("gpt-5.5")) },
          { ...Model.Info.default(Provider.ID.make("openai"), Model.ID.make("gpt-5.6-luna-fast")) },
          { ...Model.Info.default(Provider.ID.make("openai"), Model.ID.make("gpt-5.2-codex")) },
          { ...Model.Info.default(Provider.ID.make("openai"), Model.ID.make("gpt-5-mini-fast")) },
          { ...Model.Info.default(Provider.ID.make("openai"), Model.ID.make("gpt-6-astra-pro")) },
          { ...Model.Info.default(Provider.ID.make("openai"), Model.ID.make("gpt-4o")) },
          { ...Model.Info.default(Provider.ID.make("openai"), Model.ID.make("gpt-7")) },
          { ...Model.Info.default(Provider.ID.make("openai"), Model.ID.make("gpt-5.7")) },
          { ...Model.Info.default(Provider.ID.make("openai"), Model.ID.make("gpt-5.5-chat")) },
          { ...Model.Info.default(Provider.ID.make("openai"), Model.ID.make("gpt-5.4-image-2")) },
          {
            ...Model.Info.default(Provider.ID.make("openai"), Model.ID.make("gpt-6-astra")),
            variants: [{ id: Model.VariantID.make("quiet"), settings: { textVerbosity: null } }],
          },
          {
            ...Model.Info.default(Provider.ID.make("openai"), Model.ID.make("chat")),
            modelID: Model.ID.make("gpt-5.5"),
            package: "@aigcfroge/ai/providers/openai/chat",
          },
        ],
      })
      editor.add({
        info: {
          ...Provider.Info.empty(Provider.ID.make("aigcfroge")),
          package: "@aigcfroge/ai/providers/openai-compatible",
        },
        models: [
          {
            ...Model.Info.default(Provider.ID.make("aigcfroge"), Model.ID.make("astra-alias")),
            modelID: Model.ID.make("gpt-6-astra"),
            package: "@aigcfroge/ai/providers/openai/responses",
          },
          {
            ...Model.Info.default(Provider.ID.make("aigcfroge"), Model.ID.make("no-default")),
            modelID: Model.ID.make("gpt-6-astra"),
            package: "@aigcfroge/ai/providers/openai/responses",
            settings: { textVerbosity: null },
          },
        ],
      })
      editor.add({
        info: { ...Provider.Info.empty(Provider.ID.make("openrouter")), package: "@aigcfroge/ai/providers/openrouter" },
        models: [Model.Info.default(Provider.ID.make("openrouter"), Model.ID.make("gpt-5.5"))],
      })
      editor.add({
        info: {
          ...Provider.Info.empty(Provider.ID.make("configured")),
          package: "@aigcfroge/ai/providers/openai",
          settings: { textVerbosity: "medium" },
        },
        models: [Model.Info.default(Provider.ID.make("configured"), Model.ID.make("gpt-5.5"))],
      })
      for (const [providerID, packageName, modelID] of [
        ["azure", "@aigcfroge/ai/providers/azure/responses", "gpt-5.5"],
        ["bedrock-mantle", "@aigcfroge/ai/providers/amazon-bedrock/mantle/responses", "openai.gpt-6-sol"],
        ["cloudflare", "@aigcfroge/ai/providers/cloudflare-ai-gateway", "openai/gpt-5.6-sol"],
        ["vercel", "@aigcfroge/ai/providers/vercel-ai-gateway", "openai/gpt-6-astra-fast"],
        ["azure-chat", "@aigcfroge/ai/providers/azure/chat", "gpt-5.5"],
        ["bedrock-converse", "@aigcfroge/ai/providers/amazon-bedrock", "global.openai.gpt-6-sol"],
        ["cloudflare-chat", "@aigcfroge/ai/providers/cloudflare-ai-gateway", "workers-ai/gpt-5.5"],
        ["vercel-other", "@aigcfroge/ai/providers/vercel-ai-gateway", "anthropic/gpt-5.5"],
      ] as const) {
        editor.add({
          info: { ...Provider.Info.empty(Provider.ID.make(providerID)), package: packageName },
          models: [
            {
              ...Model.Info.default(Provider.ID.make(providerID), Model.ID.make("selected")),
              modelID: Model.ID.make(modelID),
            },
          ],
        })
      }
    })
    yield* VerbosityPlugin.Plugin.effect(yield* PluginHost.make(plugins))

    for (const kind of ["context", "compaction", "generate", "title"] as const) {
      const event = request(ref("openai", "gpt-5.5"))
      yield* hooks.trigger("session", kind, event)
      expect(event.options.textVerbosity).toBe("low")
    }

    for (const id of ["gpt-5.6-luna-fast", "gpt-5.2-codex", "gpt-5-mini-fast", "gpt-6-astra-pro"]) {
      const event = request(ref("openai", id))
      yield* hooks.trigger("session", "context", event)
      expect(event.options.textVerbosity).toBe("low")
    }

    for (const model of [
      ref("openai", "gpt-4o"),
      ref("openai", "gpt-7"),
      ref("openai", "gpt-5.7"),
      ref("openai", "gpt-5.5-chat"),
      ref("openai", "gpt-5.4-image-2"),
      ref("openai", "chat"),
      ref("openrouter", "gpt-5.5"),
      ref("configured", "gpt-5.5"),
      ref("azure-chat", "selected"),
      ref("bedrock-converse", "selected"),
      ref("cloudflare-chat", "selected"),
      ref("vercel-other", "selected"),
      ref("openai", "gpt-6-astra", "quiet"),
      ref("aigcfroge", "no-default"),
    ]) {
      const event = request(model)
      yield* hooks.trigger("session", "context", event)
      expect(event.options.textVerbosity).toBeUndefined()
    }

    const alias = request(ref("aigcfroge", "astra-alias"))
    yield* hooks.trigger("session", "context", alias)
    expect(alias.options.textVerbosity).toBe("low")

    for (const providerID of ["azure", "bedrock-mantle", "cloudflare", "vercel"]) {
      const event = request(ref(providerID, "selected"))
      yield* hooks.trigger("session", "context", event)
      expect(event.options.textVerbosity).toBe("low")
    }

    const overridden = request(ref("openai", "gpt-5.5"), { textVerbosity: "high" })
    yield* hooks.trigger("session", "context", overridden)
    expect(overridden.options.textVerbosity).toBe("high")
  }),
)
