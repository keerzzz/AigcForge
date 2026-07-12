export * as McpAuthV2 from "./v2-auth"

import { Effect, Layer, Schema, Context } from "effect"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { EffectFlock } from "@aigcfroge/core/util/effect-flock"
import { Global } from "@aigcfroge/core/global"
import path from "path"

export const Tokens = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.optional(Schema.String),
  expiresAt: Schema.optional(Schema.Number),
  scope: Schema.optional(Schema.String),
})
export type Tokens = Schema.Schema.Type<typeof Tokens>

export const ClientInfo = Schema.Struct({
  clientId: Schema.String,
  clientSecret: Schema.optional(Schema.String),
  clientIdIssuedAt: Schema.optional(Schema.Number),
  clientSecretExpiresAt: Schema.optional(Schema.Number),
})
export type ClientInfo = Schema.Schema.Type<typeof ClientInfo>

export const Entry = Schema.Struct({
  tokens: Schema.optional(Tokens),
  clientInfo: Schema.optional(ClientInfo),
  codeVerifier: Schema.optional(Schema.String),
  oauthState: Schema.optional(Schema.String),
  serverUrl: Schema.optional(Schema.String),
})
export type Entry = Schema.Schema.Type<typeof Entry>

const decodeAuthData = Schema.decodeUnknownOption(Schema.Record(Schema.String, Entry))
type AuthData = Record<string, Entry>
const filepath = path.join(Global.Path.data, "mcp-auth.json")
const lockKey = `mcp-auth:${filepath}`

export interface Interface {
  readonly all: () => Effect.Effect<Record<string, Entry>>
  readonly get: (mcpName: string) => Effect.Effect<Entry | undefined>
  readonly getForUrl: (mcpName: string, serverUrl: string) => Effect.Effect<Entry | undefined>
  readonly set: (mcpName: string, entry: Entry, serverUrl?: string) => Effect.Effect<void>
  readonly remove: (mcpName: string) => Effect.Effect<void>
  readonly updateTokens: (mcpName: string, tokens: Tokens, serverUrl?: string) => Effect.Effect<void>
  readonly updateClientInfo: (mcpName: string, clientInfo: ClientInfo, serverUrl?: string) => Effect.Effect<void>
  readonly updateCodeVerifier: (mcpName: string, codeVerifier: string) => Effect.Effect<void>
  readonly clearCodeVerifier: (mcpName: string) => Effect.Effect<void>
  readonly updateOAuthState: (mcpName: string, oauthState: string) => Effect.Effect<void>
  readonly getOAuthState: (mcpName: string) => Effect.Effect<string | undefined>
  readonly clearOAuthState: (mcpName: string) => Effect.Effect<void>
  readonly isTokenExpired: (mcpName: string) => Effect.Effect<boolean | null>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/McpAuth") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const flock = yield* EffectFlock.Service

    const read = Effect.fn("McpAuthV2.read")(function* () {
      return yield* fs.readJson(filepath).pipe(
        Effect.map((data): AuthData => {
          const decoded = decodeAuthData(data)
          return decoded._tag === "Some" ? decoded.value : {}
        }),
        Effect.catch(() => Effect.succeed({} as AuthData)),
      )
    })

    const all = Effect.fn("McpAuthV2.all")(function* () {
      return yield* read().pipe(flock.withLock(lockKey), Effect.orDie)
    })

    const mutate = Effect.fn("McpAuthV2.mutate")(function* (update: (data: AuthData) => AuthData | undefined) {
      yield* Effect.gen(function* () {
        const next = update(yield* read())
        if (!next) return
        yield* fs.writeJson(filepath, next, 0o600).pipe(Effect.orDie)
      }).pipe(flock.withLock(lockKey), Effect.orDie)
    })

    const get = Effect.fn("McpAuthV2.get")(function* (mcpName: string) {
      const data = yield* all()
      return data[mcpName]
    })

    const getForUrl = Effect.fn("McpAuthV2.getForUrl")(function* (mcpName: string, serverUrl: string) {
      const entry = yield* get(mcpName)
      if (!entry?.serverUrl || entry.serverUrl !== serverUrl) return undefined
      return entry
    })

    const set = Effect.fn("McpAuthV2.set")(function* (mcpName: string, entry: Entry, serverUrl?: string) {
      yield* mutate((data) => ({ ...data, [mcpName]: serverUrl ? { ...entry, serverUrl } as Entry : entry }))
    })

    const remove = Effect.fn("McpAuthV2.remove")(function* (mcpName: string) {
      yield* mutate((data) => {
        const next = { ...data }
        delete next[mcpName]
        return next
      })
    })

    const updateField = <K extends keyof Entry>(field: K) =>
      Effect.fn(`McpAuthV2.${String(field)}`)(function* (mcpName: string, value: NonNullable<Entry[K]>, serverUrl?: string) {
        yield* mutate((data) => {
          const existing = data[mcpName]
          return { ...data, [mcpName]: { ...(existing ?? {}), [field]: value, ...(serverUrl ? { serverUrl } : {}) } as Entry }
        })
      })

    const clearField = (field: keyof Entry) =>
      Effect.fn(`McpAuthV2.clear.${String(field)}`)(function* (mcpName: string) {
        yield* mutate((data) => {
          const entry = data[mcpName]
          if (!entry) return undefined
          const next = { ...entry }
          delete (next as any)[field]
          return { ...data, [mcpName]: next }
        })
      })

    return Service.of({
      all, get, getForUrl, set, remove,
      updateTokens: updateField("tokens"),
      updateClientInfo: updateField("clientInfo"),
      updateCodeVerifier: updateField("codeVerifier"),
      updateOAuthState: updateField("oauthState"),
      clearCodeVerifier: clearField("codeVerifier"),
      clearOAuthState: clearField("oauthState"),
      getOAuthState: Effect.fn("McpAuthV2.getOAuthState")(function* (mcpName: string) {
        const entry = yield* get(mcpName)
        return entry?.oauthState
      }),
      isTokenExpired: Effect.fn("McpAuthV2.isTokenExpired")(function* (mcpName: string) {
        const entry = yield* get(mcpName)
        if (!entry?.tokens) return null
        if (!entry.tokens.expiresAt) return false
        return entry.tokens.expiresAt < Date.now() / 1000
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(EffectFlock.defaultLayer), Layer.provide(FSUtil.defaultLayer))
