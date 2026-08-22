import { createAigcfrogeClient } from "@aigcfroge/sdk/v2/client"
import { ProductMode } from "@aigcfroge/schema/product-mode"
import type { ServerConnection } from "@/context/server"
import { decode64 } from "@/utils/base64"

export function authTokenFromCredentials(input: { username?: string; password: string }) {
  return btoa(`${input.username ?? "aigcfroge"}:${input.password}`)
}

export function authFromToken(token: string | null) {
  const decoded = decode64(token ?? undefined)
  if (!decoded) return
  const separator = decoded.indexOf(":")
  if (separator === -1) return
  return {
    username: decoded.slice(0, separator) || "aigcfroge",
    password: decoded.slice(separator + 1),
  }
}

export function createSdkForServer({
  server,
  ...config
}: Omit<NonNullable<Parameters<typeof createAigcfrogeClient>[0]>, "baseUrl"> & {
  server: ServerConnection.HttpBase
}) {
  const auth = (() => {
    if (!server.password) return
    return {
      Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}`,
    }
  })()

  return createAigcfrogeClient({
    ...config,
    headers: {
      [ProductMode.CAPABILITIES_HEADER]: ProductMode.CAPABILITY_CUSTOM_V1,
      ...(config.headers instanceof Headers
        ? Object.fromEntries(config.headers.entries())
        : Array.isArray(config.headers)
          ? Object.fromEntries(config.headers)
          : config.headers),
      ...auth,
    },
    baseUrl: server.url,
  })
}
