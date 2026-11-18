import { Option, Predicate, Schema } from "effect"

export class ConfigInvalidError extends Schema.Class<ConfigInvalidError>("App.ConfigInvalidError")({
  name: Schema.Literal("ConfigInvalidError"),
  data: Schema.Struct({
    path: Schema.optional(Schema.String),
    message: Schema.optional(Schema.String),
    issues: Schema.optional(Schema.Array(Schema.Struct({ message: Schema.String, path: Schema.Array(Schema.String) }))),
  }),
}) {}

export class ProviderModelNotFoundError extends Schema.Class<ProviderModelNotFoundError>(
  "App.ProviderModelNotFoundError",
)({
  name: Schema.Literal("ProviderModelNotFoundError"),
  data: Schema.Struct({
    providerID: Schema.String,
    modelID: Schema.String,
    suggestions: Schema.optional(Schema.Array(Schema.String)),
  }),
}) {}

const decodeNamedError = Schema.decodeUnknownOption(Schema.Union([ConfigInvalidError, ProviderModelNotFoundError]))

type Translator = (key: string, vars?: Record<string, string | number>) => string

function tr(translator: Translator | undefined, key: string, text: string, vars?: Record<string, string | number>) {
  if (!translator) return text
  const out = translator(key, vars)

  if (!out || out === key) return text

  return out
}

export function formatServerError(cause: unknown, translate?: Translator, fallback?: string) {
  const unwrapped = unwrapNamedError(cause)
  const named = decodeNamedError(unwrapped)

  if (Option.isSome(named)) {
    if (named.value.name === "ConfigInvalidError") return parseReadableConfigInvalidError(named.value, translate)

    return parseReadableProviderModelNotFoundError(named.value, translate)
  }

  if (
    Predicate.isObject(unwrapped) &&
    "message" in unwrapped &&
    Predicate.isString(unwrapped.message) &&
    unwrapped.message
  )
    return unwrapped.message

  if (cause instanceof Error && cause.message) return cause.message

  if (Predicate.isString(cause) && cause) return cause

  if (fallback) return fallback

  return tr(translate, "error.chain.unknown", "Unknown error")
}

function unwrapNamedError(cause: unknown) {
  if (!(cause instanceof Error) || !Predicate.isObject(cause.cause)) return cause

  if ("body" in cause.cause) return cause.cause.body

  return cause.cause
}

// Client-synthesized session not-found errors share one constructor and
// predicate so the message contract cannot drift between route session
// resolution (session-resolution.ts) and not-found fallback matching (session.tsx).
const sessionNotFoundMessage = (sessionID: string) => `Session not found: ${sessionID}`

export function sessionNotFoundError(sessionID: string) {
  return new Error(sessionNotFoundMessage(sessionID))
}

export function isLocalSessionNotFoundError(cause: unknown, sessionID: string) {
  return cause instanceof Error && cause.message === sessionNotFoundMessage(sessionID)
}

export function isSessionNotFoundError(cause: unknown, sessionID: string) {
  const unwrapped = unwrapNamedError(cause)

  return (
    Predicate.isTagged(unwrapped, "SessionNotFoundError") &&
    "sessionID" in unwrapped &&
    unwrapped.sessionID === sessionID
  )
}

export function parseReadableConfigInvalidError(errorInput: ConfigInvalidError, translator?: Translator) {
  const file = errorInput.data.path && errorInput.data.path !== "config" ? errorInput.data.path : "config"
  const detail = errorInput.data.message?.trim() ?? ""

  const issues = (errorInput.data.issues ?? [])
    .map((issue) => {
      const msg = issue.message.trim()

      if (!issue.path.length) return msg

      return `${issue.path.join(".")}: ${msg}`
    })
    .filter(Boolean)

  const msg = issues.length ? issues.join("\n") : detail

  if (!msg) return tr(translator, "error.chain.configInvalid", `Config file at ${file} is invalid`, { path: file })

  return tr(translator, "error.chain.configInvalidWithMessage", `Config file at ${file} is invalid: ${msg}`, {
    path: file,
    message: msg,
  })
}

function parseReadableProviderModelNotFoundError(errorInput: ProviderModelNotFoundError, translator?: Translator) {
  const p = errorInput.data.providerID.trim()
  const m = errorInput.data.modelID.trim()
  const list = (errorInput.data.suggestions ?? []).map((v) => v.trim()).filter(Boolean)
  const body = tr(translator, "error.chain.modelNotFound", `Model not found: ${p}/${m}`, { provider: p, model: m })
  const tail = tr(translator, "error.chain.checkConfig", "Check your config (aigcfroge.json) provider/model names")

  if (list.length) {
    const suggestions = list.slice(0, 5).join(", ")

    return [body, tr(translator, "error.chain.didYouMean", `Did you mean: ${suggestions}`, { suggestions }), tail].join(
      "\n",
    )
  }

  return [body, tail].join("\n")
}

export * as ServerErrors from "./errors"
