import { ServerConnection } from "@/context/server"
import type { Platform } from "@/context/platform"

export function directoryPickerKind(platform: Platform["platform"], server: ServerConnection.Any) {
  if (platform === "desktop" && ServerConnection.local(server)) return "native" as const
  return "server" as const
}

/**
 * Native pickers return an OS path without asking the server whether it can
 * read it. Validate at the same boundary before the result enters the project
 * registry; a rejected path must never become a registration that only fails
 * later at session load.
 */
export async function validateDirectorySelection(
  result: string | string[] | null,
  list: (directory: string) => Promise<unknown>,
) {
  if (result === null) return null
  const directories = Array.isArray(result) ? result : [result]
  await Promise.all(directories.map((directory) => list(directory)))
  return result
}
