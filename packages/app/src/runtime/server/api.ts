import { AigcForge, type AigcForgeClient } from "@aigcfroge/client/promise"
import { ProductMode } from "@aigcfroge/schema/product-mode"
import type { ServerConnection } from "@/runtime/server/registry"
import { decode64 } from "@/runtime/persistence/base64"

export function authTokenFromCredentials(input: { password: string }) {
  return btoa(`aigcfroge:${input.password}`)
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
}): AigcForgeClient {
  const headers = new Headers({ [ProductMode.CAPABILITIES_HEADER]: ProductMode.CAPABILITY_CUSTOM_V1 })

  if (input.server.password)
    headers.set("Authorization", `Basic ${authTokenFromCredentials({ password: input.server.password })}`)

  return AigcForge.make({
    baseUrl: input.server.url,
    fetch: input.fetch,
    headers,
  })
}

export type ServerApi = AigcForgeClient
