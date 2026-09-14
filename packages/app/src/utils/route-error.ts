/**
 * Typed route-resolution failures (closure plan §7.1). The session route
 * resolver never throws into the render tree and never falls back to the
 * currently selected server: it returns one of these values instead, so the UI
 * can show a recoverable error surface with sanitized diagnostics.
 *
 * Transport errors arrive as `Error` from the SDK's `throwOnError` path with
 * `cause = { body, status }` (packages/sdk/js/src/error-interceptor.ts), which
 * is what `isNotFound` reads. Diagnostics carry status + message only — never
 * request bodies, headers, or credentials.
 */
export type RouteErrorKind =
  | "unknown-route"
  | "invalid-server-key"
  | "unknown-server"
  | "session-not-found"
  | "parent-not-found"
  | "location-unresolved"
  | "session-load-failed"

export interface RouteError {
  kind: RouteErrorKind
  sessionID?: string
  parentID?: string
  serverKey?: string
  status?: number
  detail?: string
}

type ErrorCause = { status?: unknown; body?: unknown }

function causeOf(error: unknown): ErrorCause | undefined {
  if (!(error instanceof Error)) return undefined
  const cause = error.cause
  if (typeof cause !== "object" || cause === null) return undefined
  return cause as ErrorCause
}

/** True when the server answered 404, by status or by the NotFoundError body name. */
export function isNotFound(error: unknown): boolean {
  const cause = causeOf(error)
  if (cause?.status === 404) return true
  const body = cause?.body
  if (typeof body !== "object" || body === null) return false
  return "name" in body && body.name === "NotFoundError"
}

/** Sanitized failure summary for the diagnostics block. */
export function describeFailure(error: unknown): { status?: number; detail: string } {
  const cause = causeOf(error)
  const status = typeof cause?.status === "number" ? cause.status : undefined
  const message = error instanceof Error ? error.message : String(error)
  return { status, detail: message.slice(0, 300) }
}

/** Diagnostics payload offered by the "copy diagnostics" action — safe to paste. */
export function routeDiagnostics(error: RouteError): string {
  return JSON.stringify(
    {
      kind: error.kind,
      sessionID: error.sessionID,
      parentID: error.parentID,
      serverKey: error.serverKey,
      status: error.status,
      detail: error.detail,
    },
    null,
    2,
  )
}

/**
 * i18n key segment per failure kind. The kinds are kebab-case protocol values
 * (they appear in DOM attributes and diagnostics); the dictionary segments are
 * camelCase. Keeping the map explicit — rather than transforming the kind at
 * the call site — is what `route-error-i18n.test.ts` guards.
 */
export const routeErrorKey: Record<RouteErrorKind, string> = {
  "unknown-route": "unknownRoute",
  "invalid-server-key": "invalidServerKey",
  "unknown-server": "unknownServer",
  "session-not-found": "sessionNotFound",
  "parent-not-found": "parentNotFound",
  "location-unresolved": "locationUnresolved",
  "session-load-failed": "sessionLoadFailed",
}
