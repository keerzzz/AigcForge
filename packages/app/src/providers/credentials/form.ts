import type { ModelSourceSeed, ProviderDefinitionInfo, ProviderDefinitionSaveInput } from "@aigcfroge/client/promise"
import { ConfigProvider } from "@aigcfroge/schema/config/provider"
import { Option, Schema } from "effect"

const PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/

export const providerProtocols = ["chat", "responses", "messages"] as const

export type ProviderProtocol = (typeof providerProtocols)[number]

export const providerPackages = {
  chat: "@aigcfroge/ai/providers/openai-compatible",
  responses: "@aigcfroge/ai/providers/openai-compatible/responses",
  messages: "@aigcfroge/ai/providers/anthropic-compatible",
} as const

type Translator = (key: string, vars?: Record<string, string | number | boolean>) => string

export type ModelErr = {
  id?: string
  name?: string
  context?: string
  inputLimit?: string
  outputLimit?: string
  compatibility?: string
  cost?: string
  quoteValidFrom?: string
  quoteValidUntil?: string
}

export type ModelOverrides = {
  family?: string
  tools?: "auto" | "supported" | "unsupported"
  input?: string
  output?: string
  context?: string
  inputLimit?: string
  outputLimit?: string
  compatibility?: string
  cost?: string
  quoteValidFrom?: string
  quoteValidUntil?: string
  quoteReset?: boolean
}

export type HeaderErr = {
  key?: string
  value?: string
}

export type ModelRow = {
  row: string
  id: string
  name: string
  configID?: string
  seed?: ModelSourceSeed
  seedModelID?: string
  seedState?: "draft" | "missing"
  overrides?: ModelOverrides
  err: ModelErr
}

export type HeaderRow = {
  row: string
  key: string
  value: string
  configKey?: string
  redacted?: boolean
  err: HeaderErr
}

export type FormState = {
  providerID: string
  name: string
  baseURL: string
  protocol: ProviderProtocol | undefined
  credentialAction: "keep" | "use" | "create"
  credentialID: string
  credentialLabel?: string
  envNames?: string
  apiKey: string
  models: ModelRow[]
  headers: HeaderRow[]
  discovery?: {
    enabled: boolean
    autoSync: boolean
    listURL: string
    listProtocol: "auto" | "openai" | "anthropic"
  }
  err: {
    providerID?: string
    name?: string
    baseURL?: string
    credentialID?: string
    discoveryURL?: string
  }
}

type ValidateArgs = {
  intent?: "preview"
  form: FormState
  t: Translator
  existingProviderIDs: Set<string>
  editingProviderID?: string
  definition?: ProviderDefinitionInfo["definition"]
  redactedPaths?: ReadonlyArray<ReadonlyArray<string>>
}

type FormDefinition = {
  -readonly [Key in keyof NonNullable<ProviderDefinitionSaveInput["patch"]["set"]>]: NonNullable<
    ProviderDefinitionSaveInput["patch"]["set"]
  >[Key]
}

type FormModel = {
  -readonly [Key in keyof NonNullable<FormDefinition["models"]>[string]]: NonNullable<
    FormDefinition["models"]
  >[string][Key]
}

export function validateCustomProvider(input: ValidateArgs) {
  const providerID = input.form.providerID.trim()
  const name = input.form.name.trim()
  const baseURL = input.form.baseURL.trim()
  const apiKey = input.form.apiKey.trim()

  const env = apiKey.match(/^\{env:([^}]+)\}$/)?.[1]?.trim()
  const key = input.form.credentialAction === "create" && apiKey && !env ? apiKey : undefined
  const envNames = input.form.envNames
    ?.split(",")
    .map((name) => name.trim())
    .filter(Boolean)

  const idError = !providerID
    ? input.t("provider.custom.error.providerID.required")
    : !PROVIDER_ID.test(providerID)
      ? input.t("provider.custom.error.providerID.format")
      : undefined

  const nameError = !name && input.intent !== "preview" ? input.t("provider.custom.error.name.required") : undefined

  const urlError =
    !baseURL && (input.form.protocol !== undefined || !input.editingProviderID)
      ? input.t("provider.custom.error.baseURL.required")
      : baseURL && !/^https?:\/\//.test(baseURL)
        ? input.t("provider.custom.error.baseURL.format")
        : undefined

  const existsError = idError
    ? undefined
    : input.existingProviderIDs.has(providerID) && input.editingProviderID !== providerID
      ? input.t("provider.custom.error.providerID.exists")
      : undefined

  const credentialError =
    input.form.credentialAction === "use" && !input.form.credentialID
      ? input.t("provider.custom.error.credential.required")
      : undefined

  const listURL = input.form.discovery?.listURL.trim()

  const discoveryURL =
    listURL && !/^https?:\/\//.test(listURL) ? input.t("provider.custom.error.baseURL.format") : undefined

  const seenModels = new Set<string>()

  const parsedModels = input.form.models.map((m) => {
    if (input.intent === "preview") return { err: {}, definition: {}, unset: [] }

    const id = m.id.trim()
    const catalogID = m.configID ?? id

    if (!id && !m.name.trim() && input.editingProviderID) return { err: {}, definition: {}, unset: [] }

    const idError = !id
      ? input.t("provider.custom.error.required")
      : seenModels.has(catalogID)
        ? input.t("provider.custom.error.duplicate")
        : (() => {
            seenModels.add(catalogID)

            return undefined
          })()

    const original = input.definition?.models?.[catalogID]
    const definition: FormModel = {}
    const err: ModelErr = { id: idError, name: undefined }
    const overrides = m.overrides

    const limits = [
      { field: "context", key: "context" },
      { field: "inputLimit", key: "input" },
      { field: "outputLimit", key: "output" },
    ] as const

    const limit = Object.fromEntries(
      limits.flatMap(({ field, key }) => {
        const value = overrides?.[field]?.trim()

        if (!value) return []
        const number = Number(value)

        if (!Number.isInteger(number)) {
          err[field] = input.t("provider.model.override.invalidLimit")

          return []
        }

        return [[key, number]]
      }),
    )

    if (m.name.trim()) definition.name = m.name.trim()

    if ((m.configID && (m.configID !== id || original?.modelID !== undefined)) || m.seed) definition.modelID = id

    if (m.seed && (m.seedModelID === undefined || m.seedModelID === id)) definition.seed = m.seed

    if (overrides?.family?.trim()) definition.family = overrides.family.trim()

    if (overrides?.tools && overrides.tools !== "auto")
      definition.capabilities = { tools: overrides.tools === "supported" }

    if (overrides?.input?.trim())
      definition.capabilities = {
        ...definition.capabilities,
        input: overrides.input
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      }

    if (overrides?.output?.trim())
      definition.capabilities = {
        ...definition.capabilities,
        output: overrides.output
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      }

    if (Object.keys(limit).length) definition.limit = limit

    if (overrides?.compatibility?.trim()) {
      const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(ConfigProvider.Model.fields.compatibility), {
        onExcessProperty: "error",
      })(overrides.compatibility)

      if (Option.isNone(decoded)) err.compatibility = input.t("provider.model.override.invalidCompatibility")

      if (Option.isSome(decoded)) definition.compatibility = decoded.value
    }

    if (overrides?.cost?.trim()) {
      const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(ConfigProvider.Model.fields.cost), {
        onExcessProperty: "error",
      })(overrides.cost)

      if (Option.isNone(decoded)) err.cost = input.t("provider.model.override.invalidCost")

      if (Option.isSome(decoded)) definition.cost = decoded.value
    }

    const quoteSource = original?.quote ?? m.seed?.metadata.quote
    const quote = quoteSource?.status === "unknown" ? undefined : quoteSource
    const originalPrices =
      original?.quote && original.quote.status !== "unknown" ? original.quote.prices : original?.cost
    const costChanged =
      overrides?.cost !== undefined &&
      overrides.cost.trim() !== (originalPrices ? JSON.stringify(originalPrices, null, 2) : "").trim()

    const dates = (
      [
        { field: "quoteValidFrom", key: "validFrom" },
        { field: "quoteValidUntil", key: "validUntil" },
      ] as const
    ).map((entry) => {
      const text = overrides?.[entry.field]

      if (text === undefined)
        return {
          ...entry,
          value: original?.quote && original.quote.status !== "unknown" ? original.quote[entry.key] : undefined,
        }

      if (!text.trim()) return { ...entry, value: undefined }

      const value = Date.parse(text)

      if (!Number.isFinite(value)) err[entry.field] = input.t("provider.model.override.invalidQuoteDate")

      return { ...entry, value: Number.isFinite(value) ? value : undefined }
    })

    const hasDates = dates.some((date) => date.value !== undefined)
    const clearQuote =
      overrides?.quoteReset || (original?.quote !== undefined && costChanged && !overrides?.cost?.trim() && !hasDates)

    const editQuote =
      hasDates ||
      (original?.quote !== undefined && costChanged) ||
      dates.some((date) => overrides?.[date.field] !== undefined && quote?.[date.key] !== undefined)

    if (!clearQuote && editQuote) {
      const priced = original?.quote?.status === "unknown" && !costChanged ? undefined : definition.cost

      const prices = priced
        ? (Array.isArray(priced) ? priced : [priced]).map((cost) => ({
            ...cost,
            cache: { read: cost.cache?.read ?? 0, write: cost.cache?.write ?? 0 },
          }))
        : quote?.prices

      if (prices) {
        definition.quote = {
          ...(!costChanged ? quote : undefined),
          status:
            prices.length === 0
              ? (quote?.status ?? "known")
              : prices.every(
                    (price) =>
                      price.input === 0 && price.output === 0 && price.cache.read === 0 && price.cache.write === 0,
                  )
                ? "free"
                : "known",
          prices,
          validFrom: dates[0].value,
          validUntil: dates[1].value,
        }
        delete definition.cost
      }

      if (!prices)
        dates
          .filter((date) => date.value !== undefined)
          .forEach((date) => {
            err[date.field] = input.t("provider.model.override.quoteNeedsPrice")
          })
    }

    const unset: NonNullable<ProviderDefinitionSaveInput["patch"]["unset"]> = [
      ...(!m.name.trim() && original?.name !== undefined ? [["models", catalogID, "name"] as const] : []),
      ...(overrides?.family !== undefined && !overrides.family.trim() && original?.family !== undefined
        ? [["models", catalogID, "family"] as const]
        : []),
      ...(overrides?.tools === "auto" && original?.capabilities?.tools !== undefined
        ? [["models", catalogID, "capabilities", "tools"] as const]
        : []),
      ...(["input", "output"] as const).flatMap((key) =>
        overrides?.[key] !== undefined && !overrides[key]?.trim() && original?.capabilities?.[key] !== undefined
          ? [["models", catalogID, "capabilities", key] as const]
          : [],
      ),
      ...limits.flatMap(({ field, key }) =>
        overrides?.[field] !== undefined && !overrides[field]?.trim() && original?.limit?.[key] !== undefined
          ? [["models", catalogID, "limit", key] as const]
          : [],
      ),
      ...(["compatibility", "cost"] as const).flatMap((key) =>
        overrides?.[key] !== undefined && !overrides[key]?.trim() && original?.[key] !== undefined
          ? [["models", catalogID, key] as const]
          : [],
      ),
      ...(clearQuote && original?.quote !== undefined ? [["models", catalogID, "quote"] as const] : []),
      ...(definition.quote && original?.cost !== undefined ? [["models", catalogID, "cost"] as const] : []),
      ...(!clearQuote
        ? dates.flatMap((date) =>
            overrides?.[date.field] !== undefined &&
            !overrides[date.field]?.trim() &&
            original?.quote &&
            original.quote.status !== "unknown" &&
            original.quote[date.key] !== undefined
              ? [["models", catalogID, "quote", date.key] as const]
              : [],
          )
        : []),
      ...(definition.quote && costChanged && original?.quote && original.quote.status !== "unknown"
        ? (["source", "observedAt"] as const).flatMap((field) =>
            original.quote && original.quote.status !== "unknown" && original.quote[field] !== undefined
              ? [["models", catalogID, "quote", field] as const]
              : [],
          )
        : []),
      ...(original?.seed && m.seedModelID !== undefined && m.seedModelID !== id
        ? [["models", catalogID, "seed"] as const]
        : []),
    ]

    return { err, definition, unset }
  })

  const models = parsedModels.map((m) => m.err)
  const modelsValid = models.every((m) => Object.values(m).every((error) => !error))

  const modelConfig = Object.fromEntries(
    input.intent === "preview"
      ? []
      : input.form.models.flatMap((model, index) =>
          model.id.trim() ? [[model.configID ?? model.id.trim(), parsedModels[index].definition]] : [],
        ),
  )

  const seenHeaders = new Set<string>()

  const headers = input.form.headers.map((h) => {
    const key = h.key.trim()
    const value = h.value.trim()

    if (!key && !value) return {}

    const keyError = !key
      ? input.t("provider.custom.error.required")
      : seenHeaders.has(key.toLowerCase())
        ? input.t("provider.custom.error.duplicate")
        : (() => {
            seenHeaders.add(key.toLowerCase())

            return undefined
          })()

    const valueError =
      !value && !(h.redacted && key === h.configKey) ? input.t("provider.custom.error.required") : undefined

    return { key: keyError, value: valueError }
  })

  const headersValid = headers.every((h) => !h.key && !h.value)

  const headerConfig = Object.fromEntries(
    input.form.headers.flatMap((header) => {
      const key = header.key.trim()
      const value = header.value.trim()

      return key && value ? [[key, value]] : []
    }),
  )

  const unset: NonNullable<ProviderDefinitionSaveInput["patch"]["unset"]> = [
    ...(input.definition?.env?.length && input.form.envNames !== undefined && !envNames?.length && !env
      ? [["env"] as const]
      : []),
    ...(input.intent === "preview" ? [] : Object.keys(input.definition?.models ?? {})).flatMap((id) =>
      id in modelConfig ? [] : [["models", id] as const],
    ),
    ...parsedModels.flatMap((model) => model.unset),
    ...(input.form.discovery && !listURL && input.definition?.discovery?.list?.url !== undefined
      ? [["discovery", "list", "url"] as const]
      : []),
    ...(input.form.discovery?.listProtocol === "auto" && input.definition?.discovery?.list?.protocol !== undefined
      ? [["discovery", "list", "protocol"] as const]
      : []),
    ...Array.from(
      new Set([
        ...Object.keys(input.definition?.headers ?? {}),
        ...(input.redactedPaths ?? []).flatMap((path) => {
          const name = path[1]

          return path.length === 2 && path[0] === "headers" && name !== undefined ? [name] : []
        }),
      ]),
    ).flatMap((name) =>
      input.form.headers.some((row) => row.key.trim() === name) ? [] : [["headers", name] as const],
    ),
  ]

  const err = {
    providerID: idError ?? existsError,
    name: nameError,
    baseURL: urlError,
    credentialID: credentialError,
    discoveryURL,
  }

  const ok =
    !idError &&
    !existsError &&
    !nameError &&
    !urlError &&
    !credentialError &&
    !discoveryURL &&
    modelsValid &&
    headersValid

  if (!ok) return { err, models, headers }

  const definition: FormDefinition = { name }

  if (input.intent !== "preview") definition.models = modelConfig

  if (input.form.protocol) definition.package = providerPackages[input.form.protocol]

  if (env) definition.env = [env]

  if (!env && envNames?.length) definition.env = envNames

  if (baseURL) definition.settings = { baseURL }

  if (Object.keys(headerConfig).length) definition.headers = headerConfig

  if (input.form.discovery) {
    definition.discovery = {
      enabled: input.form.discovery.enabled,
      autoSync: input.form.discovery.autoSync,
    }

    if (listURL) definition.discovery = { ...definition.discovery, list: { url: listURL } }

    if (input.form.discovery.listProtocol !== "auto")
      definition.discovery = {
        ...definition.discovery,
        list: { ...definition.discovery.list, protocol: input.form.discovery.listProtocol },
      }
  }

  const credentialAction: FormState["credentialAction"] = env
    ? "keep"
    : key
      ? "create"
      : input.form.credentialAction === "use"
        ? "use"
        : "keep"

  return {
    err,
    models,
    headers,
    result: {
      providerID,
      name,
      key,
      credentialAction,
      credentialID: input.form.credentialID,
      definition,
      unset,
    },
  }
}

let row = 0

const nextRow = () => `row-${row++}`

export const modelRow = (): ModelRow => ({ row: nextRow(), id: "", name: "", err: {} })

export const headerRow = (): HeaderRow => ({ row: nextRow(), key: "", value: "", err: {} })
