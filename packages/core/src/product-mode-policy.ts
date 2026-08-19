export * as ProductModePolicy from "./product-mode-policy"

import { Effect, Schema } from "effect"
import { ProductMode } from "@aigcfroge/schema/product-mode"

export const CAPABILITY_CUSTOM_V1 = "product-mode-custom-v1"
export const CAPABILITIES_HEADER = "x-aigcfroge-capabilities"

export class UnsupportedProductModeError extends Schema.TaggedErrorClass<UnsupportedProductModeError>()(
  "UnsupportedProductModeError",
  {
    mode: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 400 },
) {}

export function parseCapabilities(header: string | undefined | null): Set<string> {
  if (!header) return new Set()
  return new Set(
    header
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  )
}

export function isCustomCapable(header: string | undefined | null): boolean {
  const caps = parseCapabilities(header)
  return caps.has(CAPABILITY_CUSTOM_V1)
}

export function isModeSupported(mode: string | undefined, header?: string | null): boolean {
  const resolved = mode ?? ProductMode.Default
  if (resolved === "custom") {
    return isCustomCapable(header)
  }
  return resolved === "chat" || resolved === "coding" || resolved === "work" || resolved === "assistant"
}

export function assertCreationSupported(mode: string | undefined): Effect.Effect<void, UnsupportedProductModeError> {
  const resolved = mode ?? ProductMode.Default
  if (resolved === "custom") {
    return Effect.fail(
      new UnsupportedProductModeError({
        mode: resolved,
        message: `Generic session creation is not supported for mode "${resolved}". Custom sessions require atomic snapshot creation via M1 composition start.`,
      }),
    )
  }
  if (resolved === "chat" || resolved === "coding" || resolved === "work" || resolved === "assistant") {
    return Effect.void
  }
  return Effect.fail(
    new UnsupportedProductModeError({
      mode: resolved,
      message: `Unknown or unsupported product mode "${resolved}"`,
    }),
  )
}

export function assertRuntimeSupported(mode: string | undefined): Effect.Effect<void, UnsupportedProductModeError> {
  const resolved = mode ?? ProductMode.Default
  if (
    resolved === "custom" ||
    resolved === "chat" ||
    resolved === "coding" ||
    resolved === "work" ||
    resolved === "assistant"
  ) {
    return Effect.void
  }
  return Effect.fail(
    new UnsupportedProductModeError({
      mode: resolved,
      message: `Unknown or unsupported product mode "${resolved}"`,
    }),
  )
}

export function isV2Mode(mode: string | undefined): boolean {
  return mode === "custom"
}

export function shouldUseV2Runtime(mode: string | undefined, globalFlag: boolean): boolean {
  if (mode === "custom") return true
  return globalFlag
}

export function isSessionSupported(
  session: { readonly mode?: string } | undefined | null,
  header?: string | null,
): boolean {
  if (!session) return true
  return isModeSupported(session.mode, header)
}

export function filterSupportedSessions<T extends { readonly mode?: string }>(
  sessions: readonly T[],
  header?: string | null,
): T[] {
  return sessions.filter((session) => isSessionSupported(session, header))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function extractSessionID(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined
  if (typeof data.sessionID === "string") return data.sessionID
  if (typeof data.sessionId === "string") return data.sessionId
  if (typeof data.session_id === "string") return data.session_id
  if (isRecord(data.session) && typeof data.session.id === "string") return data.session.id
  if (isRecord(data.info) && typeof data.info.id === "string") return data.info.id
  return undefined
}

export function extractMode(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined
  if (typeof data.mode === "string") return data.mode
  if (isRecord(data.info) && typeof data.info.mode === "string") return data.info.mode
  if (isRecord(data.session) && typeof data.session.mode === "string") return data.session.mode
  return undefined
}

/**
 * Builds the per-connection SSE filter used by every event stream.
 *
 * `customSessionIDs` is the complete set of custom sessions at connect time;
 * payloads that carry their own mode keep the set current afterwards, so a
 * session that becomes (or stops being) custom mid-stream is still classified
 * correctly without a per-event database read.
 */
export function eventFilter(
  header: string | undefined | null,
  sessionModes: ReadonlyMap<string, string> = new Map(),
): (data: unknown) => boolean {
  const modes = new Map(sessionModes)
  const lookupMode = (sessionID: string) => modes.get(sessionID)
  return (data: unknown) => {
    const mode = extractMode(data)
    if (mode !== undefined) {
      const sessionID = extractSessionID(data)
      if (sessionID !== undefined) modes.set(sessionID, mode)
    }
    return isEventPayloadSupported(data, header, lookupMode)
  }
}

/**
 * Whether an event payload may be delivered to a client with the given capabilities.
 *
 * Resolution order:
 *  1. capable clients see everything;
 *  2. a payload that carries its own mode is judged on that mode alone;
 *  3. otherwise the payload's session is looked up in `lookupMode`.
 *
 * `lookupMode` must be a complete session membership lookup. An event carrying
 * an unknown session ID is rejected rather than treated as a non-custom event.
 */
export function isEventPayloadSupported(
  data: unknown,
  header?: string | null,
  lookupMode?: (sessionID: string) => string | undefined,
): boolean {
  if (isCustomCapable(header)) return true
  const mode = extractMode(data)
  if (mode !== undefined) return mode !== "custom"

  const sessionID = extractSessionID(data)
  if (sessionID === undefined) return true
  const resolvedMode = lookupMode?.(sessionID)
  return resolvedMode !== undefined && resolvedMode !== "custom"
}
