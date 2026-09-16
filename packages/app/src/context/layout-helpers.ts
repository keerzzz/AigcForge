import type { Accessor } from "solid-js"
import { decode64 } from "@/utils/base64"
import { parseServerKey } from "@/utils/session-route"
import type { ServerConnection } from "./server"

export type LayoutRoute =
  | { type: "home" }
  | { type: "other" }
  | { type: "draft"; draftID: string; server?: ServerConnection.Key }
  | { type: "dir-new-sesssion"; dir: string; dirBase64: string; server?: ServerConnection.Key }
  | { type: "session"; sessionId: string; server?: ServerConnection.Key }

/**
 * Classifies the current pathname for the titlebar's home affordance and tab
 * tracking. `home` means `/` and nothing else.
 *
 * Before ADR-16, `/` redirected to `/mode/<persistedMode>`, so folding every
 * unrecognized path into `home` was correct. ADR-16 §1 made `/` a real page and
 * §4 kept `/mode/:mode` as a separate authoritative route, so an unrecognized
 * path is `other`: reporting it as `home` leaves the titlebar button rendered
 * pressed on a route it then refuses to navigate away from, because
 * `tabs.toggleHome` reads that flag to decide between "restore recent tab" and
 * "go to `/`".
 */
export const currentRoute = (pathname: string, search: string): LayoutRoute => {
  const parts = pathname.split("/").filter(Boolean)
  if (parts.length === 0) return { type: "home" }

  if (parts[0] === "new-session") {
    const draftID = new URLSearchParams(search).get("draftId")
    if (!draftID) return { type: "other" }
    return { type: "draft", draftID }
  }

  if (parts[0] === "server" && parts[2] === "session" && parts[3]) {
    const parsed = parseServerKey(parts[1])
    if (!parsed.ok) return { type: "other" }
    return {
      type: "session",
      sessionId: parts[3],
      server: parsed.key,
    }
  }

  const dirBase64 = parts[0]
  const dir = decode64(dirBase64)
  if (!dir) return { type: "other" }

  if (parts[1] !== "session") return { type: "other" }

  const id = parts[2]
  if (id) return { type: "session", sessionId: id }
  return { type: "dir-new-sesssion", dir, dirBase64 }
}

/**
 * Whether the secondary sidebar is mounted. Single source for two consumers that must agree:
 * `pages/layout.tsx` decides the panel's lifecycle with it, and `titlebar.tsx` decides whether
 * emitting `aria-controls` has a resolvable target. An IDREF that points at an unmounted node
 * is invalid at any time, so the attribute follows the mount, not the preference.
 */
export const secondarySidebarShown = (open: boolean, routeType: LayoutRoute["type"]) =>
  open && routeType === "session"

export function ensureSessionKey(key: string, touch: (key: string) => void, seed: (key: string) => void) {
  touch(key)
  seed(key)
  return key
}

export function createSessionKeyReader(sessionKey: string | Accessor<string>, ensure: (key: string) => void) {
  const key = typeof sessionKey === "function" ? sessionKey : () => sessionKey
  return () => {
    const value = key()
    ensure(value)
    return value
  }
}

export function pruneSessionKeys(input: {
  keep?: string
  max: number
  used: Map<string, number>
  view: string[]
  tabs: string[]
  assistant?: string[]
}) {
  if (!input.keep) return []

  const keys = new Set<string>([...input.view, ...input.tabs, ...(input.assistant ?? [])])
  if (keys.size <= input.max) return []

  const score = (key: string) => {
    if (key === input.keep) return Number.MAX_SAFE_INTEGER
    return input.used.get(key) ?? 0
  }

  return Array.from(keys)
    .sort((a, b) => score(b) - score(a))
    .slice(input.max)
}
