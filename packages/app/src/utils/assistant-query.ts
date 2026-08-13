import type { ServerScope } from "@/utils/server-scope"

export function assistantQueryKey<const Parts extends readonly unknown[]>(scope: ServerScope, ...parts: Parts) {
  return [scope, "assistant", ...parts] as const
}
