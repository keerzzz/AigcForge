import { Global } from "@aigcfroge/util/global"
import { AIGCFROGE_CHANNEL, AIGCFROGE_VERSION } from "../version"
import { Hash } from "@aigcfroge/util/hash"
import { Service } from "@aigcfroge/client/effect/service"
import { Effect, FileSystem, Option, Schema } from "effect"
import { randomBytes } from "crypto"
import path from "path"
import { selfCommand } from "../util/process"
import { RemoteTunnel } from "./remote-tunnel"

// The CLI's service configuration file, plus the Service.EnsureOptions binding that
// points the client package's service operations at this CLI: which
// registration file (by channel), which version, and how to spawn aigcfroge.

export const Info = Schema.Struct({
  disabled: Schema.optional(Schema.Boolean),
  // Present when remote access is on. The route is generated, never user-set: the secret subdomain the service is
  // served on.
  remote: Schema.optional(Schema.Struct({ route: Schema.String })),
  hostname: Schema.optional(Schema.String),
  port: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(65_535))),
  password: Schema.optional(Schema.String),
  cors: Schema.optional(Schema.Array(Schema.String)),
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})
export type Info = typeof Info.Type

const keys = ["disabled", "remote", "hostname", "port", "password", "cors", "env"] as const
type Key = (typeof keys)[number]

const decodeInfo = Schema.decodeUnknownEffect(Schema.fromJsonString(Info))

export function filename(channel = AIGCFROGE_CHANNEL) {
  if (channel === "latest" || channel === "dev" || channel === "beta" || channel === "next") return "service.json"
  return `service-${channel.replace(/[^a-zA-Z0-9._-]/g, "-")}.json`
}

export function defaultPort(channel = AIGCFROGE_CHANNEL) {
  if (channel === "latest" || channel === "dev" || channel === "beta" || channel === "next") return 0xc0de
  if (channel === "local") return 0xc0df
  return 10_000 + (Number.parseInt(Hash.fast(channel).slice(0, 8), 16) % 50_000)
}

export function versionBelongsToChannel(
  version: string | undefined,
  channel = AIGCFROGE_CHANNEL,
  installedVersion = AIGCFROGE_VERSION,
) {
  if (version === undefined) return false
  if (version === installedVersion) return true
  const prefix = `0.0.0-${channel}-`
  if (!version.startsWith(prefix)) return false
  return /^\d+(?:\.\d+)?$/.test(version.slice(prefix.length))
}

function configKey(key: string): Key {
  if (
    key === "disabled" ||
    key === "remote" ||
    key === "hostname" ||
    key === "port" ||
    key === "password" ||
    key === "cors" ||
    key === "env"
  )
    return key
  throw new Error(`Unknown service config key: ${key}`)
}

const paths = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const global = yield* Global.Service
  const name = filename()
  return {
    fs,
    file: path.join(global.state, name),
    configFile: path.join(global.config, name),
  }
})

export const options = Effect.fnUntraced(function* (input: { readonly checkVersion?: boolean } = {}) {
  const { file } = yield* paths
  return {
    file,
    version: input.checkVersion ? AIGCFROGE_VERSION : undefined,
    env: (yield* read()).env,
    command: [...selfCommand(), "serve", "--service"],
  }
})

export const read = Effect.fn("cli.service-config.read")(function* () {
  const { fs, configFile } = yield* paths
  const text = yield* fs.readFileString(configFile).pipe(Effect.option)
  if (Option.isNone(text)) return {} as Info
  const info = yield* decodeInfo(text.value).pipe(Effect.option)
  return Option.isSome(info) ? info.value : ({} as Info)
})

// 64 random bits as 16 hex characters, a valid DNS label.
function route() {
  return randomBytes(8).toString("hex")
}

const write = Effect.fn("cli.service-config.write")(function* (value: Info) {
  const { fs, configFile } = yield* paths
  const temp = configFile + ".tmp"
  yield* fs.makeDirectory(path.dirname(configFile), { recursive: true })
  yield* fs.writeFileString(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 })
  yield* fs.rename(temp, configFile)
})

export const password = Effect.fn("cli.service-config.password")(function* (value?: string) {
  const existing = yield* read()
  if (value === undefined && existing.password) return existing.password
  const next = value ?? randomBytes(32).toString("base64url")

  // Keep one private credential across server restarts so discovered clients
  // can reconnect without exposing a password flag or environment variable.
  yield* write({ ...existing, password: next })
  return next
})

// Turns remote access on and returns its route, created once and kept so the remote URL survives restarts.
export const remote = Effect.fn("cli.service-config.remote")(function* () {
  const existing = yield* read()
  if (existing.remote) return existing.remote.route
  const next = route()
  yield* write({ ...existing, remote: { route: next } })
  return next
})

export const get = Effect.fn("cli.service-config.get")(function* (key?: string, name?: string) {
  if (key === undefined) {
    const { password: _password, ...safe } = yield* read()
    // The route is as sensitive as the password: it is the unguessable half of the remote address.
    return JSON.stringify(safe.remote === undefined ? safe : { ...safe, remote: {} }, null, 2)
  }
  const selected = configKey(key)
  if (selected !== "env" && name !== undefined) throw new Error(`Usage: aigcfroge service get ${selected}`)
  switch (selected) {
    case "disabled": {
      return String((yield* read()).disabled ?? false)
    }
    case "remote": {
      return String((yield* read()).remote !== undefined)
    }
    case "hostname": {
      return (yield* read()).hostname ?? ""
    }
    case "port": {
      const port = (yield* read()).port
      return port === undefined ? "" : String(port)
    }
    case "password": {
      return yield* password()
    }
    case "cors": {
      return JSON.stringify((yield* read()).cors ?? [], null, 2)
    }
    case "env": {
      const env = (yield* read()).env ?? {}
      return name === undefined ? JSON.stringify(env, null, 2) : (env[name] ?? "")
    }
  }
  throw new Error(`Unknown service config key: ${key}`)
})

export const set = Effect.fn("cli.service-config.set")(function* (key: string, value: string, nestedValue?: string) {
  const selected = configKey(key)
  if (selected !== "env" && nestedValue !== undefined)
    throw new Error(`Usage: aigcfroge service set ${selected} <value>`)
  switch (selected) {
    case "disabled": {
      if (value !== "true" && value !== "false") throw new Error("Disabled must be true or false")
      if (value === "true") yield* Service.stop(yield* options())
      yield* write({ ...(yield* read()), disabled: value === "true" })
      return
    }
    case "remote": {
      if (value !== "true" && value !== "false") throw new Error("Remote must be true or false")
      // A tunnel that cannot be created leaves remote access off instead of a service that keeps retrying.
      if (value === "true") yield* RemoteTunnel.ensure()
      yield* Service.stop(yield* options())
      if (value === "true") {
        yield* remote()
        return
      }
      // Disabling forgets the address, so enabling again issues a new unguessable one.
      const { remote: _remote, ...next } = yield* read()
      yield* write(next)
      return
    }
    case "hostname": {
      yield* Service.stop(yield* options())
      yield* write({ ...(yield* read()), hostname: value })
      return
    }
    case "port": {
      const port = Number(value)
      if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Port must be between 1 and 65535")
      yield* Service.stop(yield* options())
      yield* write({ ...(yield* read()), port })
      return
    }
    case "password": {
      yield* Service.stop(yield* options())
      yield* password(value)
      return
    }
    case "env": {
      if (nestedValue === undefined) throw new Error("Usage: aigcfroge service set env <key> <value>")
      yield* Service.stop(yield* options())
      const existing = yield* read()
      yield* write({ ...existing, env: { ...existing.env, [value]: nestedValue } })
      return
    }
    case "cors": {
      const cors = value.split(",").map((origin) => origin.trim())
      if (
        cors.some((origin) => {
          const url = URL.parse(origin)
          return !url || (url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== origin
        })
      )
        throw new Error("CORS must be a comma-separated list of HTTP(S) origins without paths or trailing slashes")
      yield* Service.stop(yield* options())
      yield* write({ ...(yield* read()), cors })
      return
    }
  }
})

export const unset = Effect.fn("cli.service-config.unset")(function* (key: string, name?: string) {
  const selected = configKey(key)
  if (selected !== "env" && name !== undefined) throw new Error(`Usage: aigcfroge service unset ${selected}`)
  switch (selected) {
    case "disabled": {
      const { disabled: _disabled, ...next } = yield* read()
      yield* write(next)
      return
    }
    case "remote": {
      yield* Service.stop(yield* options())
      const { remote: _remote, ...next } = yield* read()
      yield* write(next)
      return
    }
    case "hostname": {
      yield* Service.stop(yield* options())
      const { hostname: _hostname, ...next } = yield* read()
      yield* write(next)
      return
    }
    case "port": {
      yield* Service.stop(yield* options())
      const { port: _port, ...next } = yield* read()
      yield* write(next)
      return
    }
    case "password": {
      yield* Service.stop(yield* options())
      const { password: _password, ...next } = yield* read()
      yield* write(next)
      return
    }
    case "env": {
      if (name === undefined) throw new Error("Usage: aigcfroge service unset env <key>")
      yield* Service.stop(yield* options())
      const existing = yield* read()
      const { [name]: _removed, ...env } = existing.env ?? {}
      const { env: _existingEnv, ...rest } = existing
      yield* write(Object.keys(env).length === 0 ? rest : { ...rest, env })
      return
    }
    case "cors": {
      yield* Service.stop(yield* options())
      const { cors: _cors, ...next } = yield* read()
      yield* write(next)
      return
    }
  }
})

export * as ServiceConfig from "./service-config"
