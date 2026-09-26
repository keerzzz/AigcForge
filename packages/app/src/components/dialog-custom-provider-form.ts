const PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/
const OPENAI_COMPATIBLE = "@ai-sdk/openai-compatible"
const ANTHROPIC = "@ai-sdk/anthropic"

// The UI offers one protocol per provider; each maps to the AI SDK package the
// backend loads via BUNDLED_PROVIDERS. Anything not "anthropic" stays on the
// OpenAI-compatible default, which is also the fallback when protocol is unset.
export type Protocol = "openai" | "anthropic"
const PROTOCOL_NPM: Record<Protocol, string> = {
  openai: OPENAI_COMPATIBLE,
  anthropic: ANTHROPIC,
}

export const protocolNpm = (protocol: Protocol | undefined) => PROTOCOL_NPM[protocol ?? "openai"]

// The request modalities a custom model may declare. Matches the literal set
// accepted by ConfigProviderV1.Model.modalities.input.
export type Modality = "text" | "audio" | "image" | "video" | "pdf"

type Translator = (key: string, vars?: Record<string, string | number | boolean>) => string

export type ModelErr = {
  id?: string
  name?: string
  contextWindow?: string
  maxOutput?: string
}

export type HeaderErr = {
  key?: string
  value?: string
}

export type ModelRow = {
  row: string
  id: string
  name: string
  contextWindow?: string
  maxOutput?: string
  input?: Modality[]
  err: ModelErr
}

export type HeaderRow = {
  row: string
  key: string
  value: string
  err: HeaderErr
}

export type FormState = {
  providerID: string
  name: string
  baseURL: string
  apiKey: string
  protocol?: Protocol
  models: ModelRow[]
  headers: HeaderRow[]
  err: {
    providerID?: string
    name?: string
    baseURL?: string
  }
}

type ValidateArgs = {
  form: FormState
  t: Translator
  disabledProviders: string[]
  existingProviderIDs: Set<string>
}

export function validateCustomProvider(input: ValidateArgs) {
  const providerID = input.form.providerID.trim()
  const name = input.form.name.trim()
  const baseURL = input.form.baseURL.trim()
  const apiKey = input.form.apiKey.trim()

  const env = apiKey.match(/^\{env:([^}]+)\}$/)?.[1]?.trim()
  const key = apiKey && !env ? apiKey : undefined

  const idError = !providerID
    ? input.t("provider.custom.error.providerID.required")
    : !PROVIDER_ID.test(providerID)
      ? input.t("provider.custom.error.providerID.format")
      : undefined

  const nameError = !name ? input.t("provider.custom.error.name.required") : undefined
  const urlError = !baseURL
    ? input.t("provider.custom.error.baseURL.required")
    : !/^https?:\/\//.test(baseURL)
      ? input.t("provider.custom.error.baseURL.format")
      : undefined

  const disabled = input.disabledProviders.includes(providerID)
  const existsError = idError
    ? undefined
    : input.existingProviderIDs.has(providerID) && !disabled
      ? input.t("provider.custom.error.providerID.exists")
      : undefined

  const seenModels = new Set<string>()
  const parsedModels = input.form.models.map((m) => {
    const id = m.id.trim()
    const idError = !id
      ? input.t("provider.custom.error.required")
      : seenModels.has(id)
        ? input.t("provider.custom.error.duplicate")
        : (() => {
            seenModels.add(id)
            return undefined
          })()
    const nameError = !m.name.trim() ? input.t("provider.custom.error.required") : undefined

    const ctx = parsePositiveInt(m.contextWindow)
    const out = parsePositiveInt(m.maxOutput)
    // ConfigProviderV1.Model.limit requires both context and output, so a row
    // must supply the pair together or neither.
    let contextWindowError = ctx.error ? input.t("provider.custom.error.number") : undefined
    let maxOutputError = out.error ? input.t("provider.custom.error.number") : undefined
    if (!contextWindowError && !maxOutputError) {
      if (ctx.value !== undefined && out.value === undefined) maxOutputError = input.t("provider.custom.error.required")
      if (out.value !== undefined && ctx.value === undefined)
        contextWindowError = input.t("provider.custom.error.required")
    }

    const limit =
      contextWindowError || maxOutputError || ctx.value === undefined || out.value === undefined
        ? undefined
        : { context: ctx.value, output: out.value }
    const modalities = m.input && m.input.length ? { input: [...m.input] } : undefined

    return {
      id,
      config: { name: m.name.trim(), ...(limit ? { limit } : {}), ...(modalities ? { modalities } : {}) },
      err: { id: idError, name: nameError, contextWindow: contextWindowError, maxOutput: maxOutputError } as ModelErr,
    }
  })
  const models = parsedModels.map((m) => m.err)
  const modelsValid = models.every((m) => !m.id && !m.name && !m.contextWindow && !m.maxOutput)
  const modelConfig = Object.fromEntries(parsedModels.map((m) => [m.id, m.config]))

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
    const valueError = !value ? input.t("provider.custom.error.required") : undefined
    return { key: keyError, value: valueError }
  })
  const headersValid = headers.every((h) => !h.key && !h.value)
  const headerConfig = Object.fromEntries(
    input.form.headers
      .map((h) => ({ key: h.key.trim(), value: h.value.trim() }))
      .filter((h) => !!h.key && !!h.value)
      .map((h) => [h.key, h.value]),
  )

  const err = {
    providerID: idError ?? existsError,
    name: nameError,
    baseURL: urlError,
  }

  const ok = !idError && !existsError && !nameError && !urlError && modelsValid && headersValid
  if (!ok) return { err, models, headers }

  return {
    err,
    models,
    headers,
    result: {
      providerID,
      name,
      key,
      config: {
        npm: protocolNpm(input.form.protocol),
        name,
        ...(env ? { env: [env] } : {}),
        options: {
          baseURL,
          ...(Object.keys(headerConfig).length ? { headers: headerConfig } : {}),
        },
        models: modelConfig,
      },
    },
  }
}

let row = 0

const nextRow = () => `row-${row++}`

// Parse an optional numeric form field. Empty is "not provided" (no error);
// anything that is not a positive safe integer is a format error.
function parsePositiveInt(raw?: string): { value?: number; error?: boolean } {
  const v = raw?.trim()
  if (!v) return {}
  if (!/^\d+$/.test(v)) return { error: true }
  const n = Number(v)
  if (!Number.isSafeInteger(n) || n <= 0) return { error: true }
  return { value: n }
}

export const modelRow = (): ModelRow => ({ row: nextRow(), id: "", name: "", err: {} })
export const headerRow = (): HeaderRow => ({ row: nextRow(), key: "", value: "", err: {} })
