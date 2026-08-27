import type { PermissionRequest } from "@aigcfroge/sdk/v2/client"

export type PermissionReply = "once" | "always" | "reject"

/**
 * What a user may answer, keyed by which runtime owns the request.
 *
 * The two sets are deliberately NOT one flat union. A legacy request has no
 * ScopedGrant to issue, and a V2 request must not take the legacy `always`
 * path — `always` there would persist a project-wide rule instead of the
 * Session/Location grant the user actually picked, which is the exact
 * "rename `always` into a scoped grant" failure ADR-20 §2.1 forbids.
 *
 * Splitting them puts that rule in the type system: `always` on a V2 request and
 * `session`/`location` on a legacy one are compile errors, so no test has to
 * stand guard over which branch the JSX renders.
 */
export type LegacyDecision = "once" | "always" | "reject"
export type ScopedDecision = "once" | "session" | "location" | "reject"
export type PermissionDecision = LegacyDecision | ScopedDecision

/** A pending request paired with a decision its own runtime can actually take. */
export type PermissionDecisionInput =
  | { readonly request: Extract<PermissionPending, { kind: "legacy" }>; readonly decision: LegacyDecision }
  | { readonly request: Extract<PermissionPending, { kind: "v2" }>; readonly decision: ScopedDecision }

type Metadata = {
  description?: string
  cli_target?: string
  execution_type?: string
}

type Source = {
  type: "tool"
  messageID: string
  callID: string
}

export type PermissionV2Pending = {
  id: string
  sessionID: string
  action: string
  resources: string[]
  save?: string[]
  metadata?: Metadata
  source?: Source
}

export type PermissionPending =
  | { kind: "legacy"; request: PermissionRequest }
  | { kind: "v2"; request: PermissionV2Pending }

export type PermissionV2Event =
  | { revision: number; type: "asked"; request: PermissionV2Pending }
  | { revision: number; type: "replied"; sessionID: string; requestID: string }

export function applyPermissionV2Events(snapshot: PermissionV2Pending[], events: PermissionV2Event[]) {
  const pending = new Map(snapshot.map((request) => [`${request.sessionID}\0${request.id}`, request]))
  for (const event of events) {
    if (event.type === "asked") {
      pending.set(`${event.request.sessionID}\0${event.request.id}`, event.request)
      continue
    }
    pending.delete(`${event.sessionID}\0${event.requestID}`)
  }
  return [...pending.values()]
}

export type PermissionReplyRequest =
  | {
      kind: "legacy"
      input: { sessionID: string; permissionID: string; response: PermissionReply }
    }
  | {
      kind: "v2"
      input: { sessionID: string; requestID: string; reply: PermissionReply }
    }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const strings = (value: unknown) =>
  Array.isArray(value) && value.every((item): item is string => typeof item === "string") ? value : undefined

function metadata(value: unknown): Metadata | undefined {
  if (!isRecord(value)) return undefined
  const next = {
    ...(typeof value.description === "string" ? { description: value.description } : {}),
    ...(typeof value.cli_target === "string" ? { cli_target: value.cli_target } : {}),
    ...(typeof value.execution_type === "string" ? { execution_type: value.execution_type } : {}),
  }
  return Object.keys(next).length > 0 ? next : undefined
}

function source(value: unknown): Source | undefined {
  if (!isRecord(value)) return undefined
  if (value.type !== "tool" || typeof value.messageID !== "string" || typeof value.callID !== "string") return undefined
  return { type: "tool", messageID: value.messageID, callID: value.callID }
}

export function permissionPendingFromV2(value: unknown): PermissionV2Pending | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.id !== "string" || typeof value.sessionID !== "string" || typeof value.action !== "string")
    return undefined
  const resources = strings(value.resources)
  if (!resources) return undefined
  const save = value.save === undefined ? undefined : strings(value.save)
  if (value.save !== undefined && !save) return undefined
  const requestMetadata = metadata(value.metadata)
  const requestSource = value.source === undefined ? undefined : source(value.source)
  if (value.source !== undefined && !requestSource) return undefined
  return {
    id: value.id,
    sessionID: value.sessionID,
    action: value.action,
    resources,
    ...(save ? { save } : {}),
    ...(requestMetadata ? { metadata: requestMetadata } : {}),
    ...(requestSource ? { source: requestSource } : {}),
  }
}

export function permissionReplyFromV2(value: unknown) {
  if (!isRecord(value)) return undefined
  if (typeof value.sessionID !== "string" || typeof value.requestID !== "string") return undefined
  if (value.reply !== "once" && value.reply !== "always" && value.reply !== "reject") return undefined
  return { sessionID: value.sessionID, requestID: value.requestID, reply: value.reply }
}

/** Returns the narrowed legacy variant so callers can build a `LegacyDecision` pair. */
export function permissionPendingFromLegacy(
  request: PermissionRequest,
): Extract<PermissionPending, { kind: "legacy" }> {
  return { kind: "legacy", request }
}

export function permissionReply(request: PermissionPending, reply: PermissionReply): PermissionReplyRequest {
  if (request.kind === "legacy") {
    return {
      kind: "legacy",
      input: { sessionID: request.request.sessionID, permissionID: request.request.id, response: reply },
    }
  }
  return {
    kind: "v2",
    input: { sessionID: request.request.sessionID, requestID: request.request.id, reply },
  }
}

export * as PermissionPendingModel from "./permission-pending"

export type PermissionReplyClient = {
  permission: {
    respond(input: { sessionID: string; permissionID: string; response: PermissionReply }): Promise<unknown>
  }
  v2: {
    session: {
      permission: {
        reply(input: { sessionID: string; requestID: string; reply: PermissionReply }): Promise<unknown>
      }
    }
  }
}

export type ScopedGrantClient = {
  v2: {
    session: {
      permission: {
        grant(input: { sessionID: string; requestID: string; level: "session" | "location" }): Promise<unknown>
      }
    }
  }
}

function replyPermission(
  client: PermissionReplyClient,
  request: PermissionPending,
  reply: PermissionReply,
): PermissionReplyRequest["kind"] extends never ? never : Promise<unknown> {
  const next = permissionReply(request, reply)
  return next.kind === "legacy" ? client.permission.respond(next.input) : client.v2.session.permission.reply(next.input)
}

/**
 * Session/location are real ScopedGrants, never a legacy `always` reply.
 *
 * The pairing is enforced by `PermissionDecisionInput`, so there is no runtime
 * guard here for "scoped grant on a legacy request" — that combination cannot be
 * constructed. A `throw` would be unreachable code pretending to be a defence.
 */
export async function decidePermission(
  client: PermissionReplyClient & ScopedGrantClient,
  input: PermissionDecisionInput,
) {
  if (input.decision !== "session" && input.decision !== "location") {
    return replyPermission(client, input.request, input.decision)
  }
  const presented = permissionPresentation(input.request)
  return client.v2.session.permission.grant({
    sessionID: presented.sessionID,
    requestID: presented.id,
    level: input.decision,
  })
}

export function permissionPresentation(request: PermissionPending) {
  if (request.kind === "v2") return request.request
  return {
    id: request.request.id,
    sessionID: request.request.sessionID,
    action: request.request.permission,
    resources: request.request.patterns,
    metadata: metadata(request.request.metadata),
    source: request.request.tool ? { type: "tool" as const, ...request.request.tool } : undefined,
  }
}
