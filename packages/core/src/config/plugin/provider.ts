export * as ConfigProviderPlugin from "./provider.js"

import { define } from "@aigcfroge/plugin/effect/plugin"
import { Document, type Entry } from "@aigcfroge/schema/config"
import { ConfigProvider } from "@aigcfroge/schema/config/provider"
import { Money } from "@aigcfroge/schema/money"
import { Effect, Option } from "effect"
import { Config } from "../../config.js"
import { Model } from "../../model.js"
import { Provider } from "../../provider.js"
import { Variant } from "../../variant.js"
import { ConfigEntryObserver } from "./entry-observer.js"
import { ProviderDiscovery } from "../../provider/discovery.js"
import { Integration } from "../../integration.js"

type SourceDefinition = {
  readonly providerID: string
  readonly models: ReadonlyMap<string, { readonly inherit: boolean; readonly base?: Model.Info }>
}

export const Plugin = define({
  id: "aigcfroge.config.provider",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const catalog = yield* Model.Service
    const discovery = Option.getOrUndefined(yield* Effect.serviceOption(ProviderDiscovery.Service))
    const loaded = yield* ConfigEntryObserver.observe(
      config,
      ctx.event,
      ctx.integration.reload().pipe(Effect.andThen(ctx.provider.reload())),
    )
    yield* ctx.integration.transform((integrations) => {
      for (const [id, provider] of configuredProviders(loaded.entries)) {
        const integrationID = id
        if (!integrations.get(integrationID)) {
          integrations.method.update({
            integrationID,
            method: { type: "key", label: "Manually enter API Key" },
          })
        }
        integrations.update(integrationID, (integration) => {
          integration.name = provider.name ?? integration.name
        })
        if (provider.env !== undefined) {
          integrations.method.update({
            integrationID,
            method: { type: "env", names: [...provider.env] },
          })
        }
      }
    })

    const sources = {
      defaultModel: undefined as Document["info"]["model"],
      models: new Map<string, Map<ConfigProvider.Info, SourceDefinition>>(),
    }
    yield* ctx.provider.transform((providers) => {
      const next = new Map<ConfigProvider.Info, SourceDefinition>()
      const configured = configuredProviders(loaded.entries)
      discovery?.setDefaults(providers.list().map((record) => record.provider), providers.scope)
      // An unfinished lower layer also suspends the instance while its credential
      // is changing; a higher layer must not expose that credential prematurely.
      const pending = new Set(configured.filter(([, item]) => item.adoption && item.adoption.phase !== "ready").map(([id]) => id))
      const disabled = new Map(configured.flatMap(([id, item]) => item.disabled === undefined ? [] : [[id, item.disabled] as const]))
      for (const [id, item] of configured) {
        const providerID = id
        const current = providers.get(providerID)
        const source = providers.get(item.canonical ?? current?.provider.canonical ?? providerID)
        const changed = item.canonical !== undefined && item.canonical !== current?.provider.canonical
        providers.update(providerID, (provider) => {
          if (changed && source && source.provider !== provider)
            Object.assign(provider, structuredClone(source.provider), {
              id: provider.id,
              integrationID: provider.integrationID,
            })
          provider.activation = pending.has(id) || disabled.get(id) === true ? "disabled" : "enabled"
          if (item.canonical !== undefined) provider.canonical = item.canonical
          if (item.name !== undefined) provider.name = item.name
          if (item.package !== undefined) provider.package = item.package
          if (item.settings !== undefined) provider.settings = Provider.mergeOverlay(provider.settings, item.settings)
          if (item.headers !== undefined) provider.headers = Provider.mergeHeaders(provider.headers, item.headers)
          if (item.body !== undefined) provider.body = Provider.mergeOverlay(provider.body, item.body)
        })
        const definitions = new Map<string, { readonly inherit: boolean; readonly base?: Model.Info }>()
        for (const [id, config] of Object.entries(item.models ?? {})) {
          const base = source?.models.get(config.modelID ?? id) ?? source?.models.get(id)
          const inherit = changed || !current?.models.has(id)
          // Bind the source at this point in the provider fold. Later source edits/removal
          // and its credential availability must not change an already-defined alias.
          definitions.set(id, { inherit, base: base && structuredClone(base) })
          if (!inherit) continue
          providers.models.update(providerID, id, (model) => {
            if (base) Object.assign(model, structuredClone(base))
            if (item.package !== undefined) model.package = undefined
            if (item.settings?.baseURL !== undefined && model.settings) delete model.settings.baseURL
          })
        }
        next.set(item, { providerID, models: definitions })
      }
      sources.defaultModel = Config.latest(loaded.entries, "model")
      sources.models.set(Provider.connectionKey(providers.scope), next)
    })

    // Keep explicit model overrides in their late registration position, after external
    // model transforms. They can recreate or re-enable a model within an available provider.
    yield* catalog.transform((models) => {
      const definitions = sources.models.get(Provider.connectionKey(models.scope)) ?? []
      const configuredDefault = sources.defaultModel
      if (configuredDefault !== undefined) models.default.select(Model.fromConfig(configuredDefault))
      for (const [item, definition] of definitions) {
        const providerID = Provider.ID.make(definition.providerID)
        for (const [id, config] of Object.entries(item.models ?? {})) {
          const modelID = Model.ID.make(id)
          const source = definition.models.get(id)
          const inherit = source?.inherit || !models.get(providerID, modelID)
          models.update(providerID, modelID, (model) => {
            if (inherit && source?.base) {
              Object.assign(model, structuredClone(source.base))
              if (item.package !== undefined) model.package = undefined
              if (item.settings?.baseURL !== undefined && model.settings) delete model.settings.baseURL
            }
            if (config.family !== undefined) model.family = config.family
            if (config.name !== undefined) model.name = config.name
            if (config.modelID !== undefined) model.modelID = config.modelID
            if (config.compatibility !== undefined)
              model.compatibility = { ...model.compatibility, ...config.compatibility }
            if (config.package !== undefined) model.package = config.package
            if (config.settings !== undefined) model.settings = Provider.mergeOverlay(model.settings, config.settings)
            if (config.headers !== undefined) model.headers = Provider.mergeHeaders(model.headers, config.headers)
            if (config.body !== undefined) model.body = Provider.mergeOverlay(model.body, config.body)
            if (config.capabilities !== undefined)
              model.capabilities = Model.mergeCapabilities(config.capabilities, model.capabilities)
            if (config.variants !== undefined) {
              model.variants ??= []
              for (const variant of config.variants) {
                let existing = model.variants.find((item) => item.id === variant.id)
                if (!existing) {
                  existing = { id: variant.id }
                  model.variants.push(existing)
                }
                if (variant.settings !== undefined)
                  existing.settings = Provider.mergeOverlay(existing.settings, variant.settings)
                if (variant.headers !== undefined)
                  existing.headers = Provider.mergeHeaders(existing.headers, variant.headers)
                if (variant.body !== undefined) existing.body = Provider.mergeOverlay(existing.body, variant.body)
              }
            }
            if (config.cost !== undefined) {
              model.cost = (Array.isArray(config.cost) ? config.cost : [config.cost]).map((cost) => ({
                tier: cost.tier && { ...cost.tier },
                input: cost.input,
                output: cost.output,
                cache: {
                  read: cost.cache?.read ?? Money.USDPerMillionTokens.zero,
                  write: cost.cache?.write ?? Money.USDPerMillionTokens.zero,
                },
              }))
            }
            if (config.disabled !== undefined) model.enabled = !config.disabled
            if (config.limit !== undefined) model.limit = { ...model.limit, ...config.limit }
            if (config.quote !== undefined) {
              model.metadata = { ...model.metadata, quote: config.quote.status === "unknown" ? config.quote : {
                ...config.quote, prices: config.quote.prices.map((cost) => ({ ...cost, cache: { ...cost.cache } })),
              } }
              model.origins = { ...model.origins, quote: "user" }
              if (config.quote.status !== "unknown") model.cost = config.quote.prices.map((cost) => ({ ...cost, cache: { ...cost.cache } }))
            }
          })
          if (config.variants === undefined && !source?.base)
            models.update(providerID, modelID, (model) => {
              model.variants = [
                ...Variant.resolve({
                  ...model,
                  package: model.package ?? models.provider.get(providerID)?.provider.package,
                }),
              ]
            })
        }
      }
      if (discovery) {
        for (const [providerID, ids] of Map.groupBy(
          Array.from(definitions, ([item, definition]) => Object.keys(item.models ?? {}).map((id) => ({ providerID: definition.providerID, id }))).flat(),
          (member) => member.providerID,
        )) {
          for (const id of new Set(ids.map((member) => member.id))) {
            models.update(Provider.ID.make(providerID), Model.ID.make(id), (model) => discovery.apply(Provider.ID.make(providerID), Model.ID.make(id), model, models.connection(models.provider.get(Provider.ID.make(providerID))?.provider.integrationID ?? Integration.ID.make(providerID))))
          }
        }
      }
    })
  }),
})

function configuredProviders(entries: readonly Entry[]) {
  return entries
    .filter((entry): entry is Document => entry.type === "document")
    .flatMap((file) => Object.entries(file.info.providers ?? {}))
}
