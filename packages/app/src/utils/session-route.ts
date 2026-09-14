import { base64Encode } from "@aigcfroge/core/util/encode"
import { ServerConnection } from "@/context/server"
import { decode64 } from "@/utils/base64"

export function sessionHref(server: ServerConnection.Key, sessionID: string) {
  return `/server/${base64Encode(server)}/session/${sessionID}`
}

/**
 * Non-throwing server-key parse (plan §7.1): route resolution must fail closed
 * with a typed error, so callers get a value instead of an exception. The
 * round-trip check rejects malformed segments that happen to decode.
 */
export function parseServerKey(segment: string | undefined): { ok: true; key: ServerConnection.Key } | { ok: false } {
  const key = decode64(segment)
  if (!key || base64Encode(key) !== segment) return { ok: false }
  // Old bookmarks may carry the raw `localhost` spelling — canonicalize on the
  // way in so route keys always compare equal to registry keys (plan §7.1 附则).
  return { ok: true, key: ServerConnection.canonicalKey(ServerConnection.Key.make(key)) }
}

/** Throwing variant for callers outside the route resolver that must not continue. */
export function requireServerKey(segment: string | undefined) {
  const parsed = parseServerKey(segment)
  if (!parsed.ok) throw new Error("Invalid server route")
  return parsed.key
}

/**
 * Legacy → canonical redirect keeps only explicitly declared fields (plan §7.1).
 * The whitelist is the session-scoped injection params the target route actually
 * consumes, plus a message anchor. Everything else is dropped — notably
 * `prompt`, which the session route ignores for an existing session, so keeping
 * it would park user content in the URL and browser history.
 */
export const LEGACY_REDIRECT_QUERY_WHITELIST = ["insert", "insertKind"] as const

export function legacyRedirectSuffix(input: { query: Record<string, string | undefined>; hash: string }): string {
  const params = new URLSearchParams()
  for (const key of LEGACY_REDIRECT_QUERY_WHITELIST) {
    const value = input.query[key]
    if (value) params.set(key, value)
  }
  const query = params.toString()
  const anchor = /^#[A-Za-z0-9_-]+$/.test(input.hash) ? input.hash : ""
  return `${query ? `?${query}` : ""}${anchor}`
}
