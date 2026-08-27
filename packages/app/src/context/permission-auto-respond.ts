import { base64Encode } from "@aigcfroge/core/util/encode"
import type { Event, PermissionRequest } from "@aigcfroge/sdk/v2/client"

/**
 * The one place that decides which ask events this store may answer, and it may
 * answer **only the V1 ask**.
 *
 * Why this needs to be a guarded, typed seam rather than an inline string
 * compare: both asks travel the same SSE stream in the same shape. The instance
 * event route renames the EventV2 envelope's `data` to `properties` for every
 * event it forwards (`aigcfroge/src/server/routes/instance/httpapi/handlers/event.ts:58`),
 * so a `permission.v2.asked` reaches this store as
 * `{ type, properties: { id, sessionID, action, resources, ... } }` — structurally
 * indistinguishable from a V1 ask at the callback boundary. Nothing else on the
 * client filters it. The event-type string was the entire boundary.
 *
 * That boundary must hold, because this store is not an authorization source:
 * its state is browser-local, has no expiry, no revocation record, and answers
 * with a reply the server cannot tell apart from a human click. ADR-20 puts
 * scoped authorization in `ScopedGrant` (expiry, revocation, audit) precisely so
 * that a persisted UI toggle can never stand in for one. Letting this store
 * answer V2 asks would route MCP and every scoped-grant consultation around that
 * model.
 *
 * The declared `PermissionRequest` return type is the enforcement, not the
 * comment: widening the guard to admit `permission.v2.asked` makes the returned
 * union stop assigning to the V1 request shape, so the mistake fails typecheck
 * instead of shipping. The mistake is plausible — "V2 sessions ignore my
 * auto-accept toggle" reads like a bug report, and answering it is a hole.
 */
export function autoRespondableAsk(event: Event | undefined): PermissionRequest | undefined {
  if (event?.type !== "permission.asked") return undefined
  return event.properties
}

export function acceptKey(sessionID: string, directory?: string) {
  if (!directory) return sessionID
  return `${base64Encode(directory)}/${sessionID}`
}

export function directoryAcceptKey(directory: string) {
  return `${base64Encode(directory)}/*`
}

function accepted(autoAccept: Record<string, boolean>, sessionID: string, directory?: string) {
  const key = acceptKey(sessionID, directory)
  const directoryKey = directory ? directoryAcceptKey(directory) : undefined
  return autoAccept[key] ?? autoAccept[sessionID] ?? (directoryKey ? autoAccept[directoryKey] : undefined)
}

export function isDirectoryAutoAccepting(autoAccept: Record<string, boolean>, directory: string) {
  const key = directoryAcceptKey(directory)
  return autoAccept[key] ?? false
}

function sessionLineage(session: { id: string; parentID?: string }[], sessionID: string) {
  const parent = session.reduce((acc, item) => {
    if (item.parentID) acc.set(item.id, item.parentID)
    return acc
  }, new Map<string, string>())
  const seen = new Set([sessionID])
  const ids = [sessionID]

  for (const id of ids) {
    const parentID = parent.get(id)
    if (!parentID || seen.has(parentID)) continue
    seen.add(parentID)
    ids.push(parentID)
  }

  return ids
}

export function autoRespondsPermission(
  autoAccept: Record<string, boolean>,
  session: { id: string; parentID?: string }[],
  permission: { sessionID: string },
  directory?: string,
) {
  const value = sessionLineage(session, permission.sessionID)
    .map((id) => accepted(autoAccept, id, directory))
    .find((item): item is boolean => item !== undefined)
  return value ?? false
}
