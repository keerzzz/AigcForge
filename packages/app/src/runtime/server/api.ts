import { Omnixa, type OmnixaClient } from "@omnixa/client/promise"
import { ProductMode } from "@omnixa/schema/product-mode"
import type { ServerConnection } from "@/runtime/server/registry"
import { decode64 } from "@/runtime/persistence/base64"

export function authTokenFromCredentials(input: { password: string }) {
  return btoa(`omnixa:${input.password}`)
}

export function authFromToken(token: string | null) {
  const decoded = decode64(token ?? undefined)

  if (!decoded) return
  const separator = decoded.indexOf(":")

  if (separator === -1) return

  return {
    password: decoded.slice(separator + 1),
  }
}

export function createApiForServer(input: {
  server: ServerConnection.HttpBase
  fetch?: typeof globalThis.fetch
}): OmnixaClient {
  const headers = new Headers({ [ProductMode.CAPABILITIES_HEADER]: ProductMode.CAPABILITY_CUSTOM_V1 })

  if (input.server.password)
    headers.set("Authorization", `Basic ${authTokenFromCredentials({ password: input.server.password })}`)

  return Omnixa.make({
    baseUrl: input.server.url,
    fetch: input.fetch,
    headers,
  })
}

export type ServerApi = OmnixaClient
