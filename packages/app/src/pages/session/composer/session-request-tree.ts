import type { PermissionRequest, QuestionRequest, Session } from "@aigcfroge/sdk/v2/client"
import { PermissionPendingModel } from "@/context/global-sync/permission-pending"

function sessionTreeRequest<T>(
  session: Session[],
  request: Record<string, T[] | undefined>,
  sessionID?: string,
  include: (item: T) => boolean = () => true,
) {
  if (!sessionID) return undefined

  const map = session.reduce((acc, item) => {
    if (!item.parentID) return acc
    const list = acc.get(item.parentID)
    if (list) list.push(item.id)
    if (!list) acc.set(item.parentID, [item.id])
    return acc
  }, new Map<string, string[]>())

  const seen = new Set([sessionID])
  const ids = [sessionID]
  for (const id of ids) {
    const list = map.get(id)
    if (!list) continue
    for (const child of list) {
      if (seen.has(child)) continue
      seen.add(child)
      ids.push(child)
    }
  }

  const id = ids.find((id) => request[id]?.some(include))
  if (!id) return
  return request[id]?.find(include)
}

export function sessionPermissionRequest(
  session: Session[],
  request: Record<string, PermissionRequest[] | undefined>,
  sessionID?: string,
  include?: (item: PermissionRequest) => boolean,
) {
  return sessionTreeRequest(session, request, sessionID, include)
}

export function sessionPendingPermissionRequest(
  session: Session[],
  legacy: Record<string, PermissionRequest[] | undefined>,
  v2: Record<string, PermissionPendingModel.PermissionV2Pending[] | undefined>,
  sessionID?: string,
  includeLegacy: (item: PermissionRequest) => boolean = () => true,
): PermissionPendingModel.PermissionPending | undefined {
  if (!sessionID) return undefined

  const children = session.reduce((acc, item) => {
    if (!item.parentID) return acc
    const list = acc.get(item.parentID)
    if (list) list.push(item.id)
    if (!list) acc.set(item.parentID, [item.id])
    return acc
  }, new Map<string, string[]>())
  const seen = new Set([sessionID])
  const ids = [sessionID]
  for (const id of ids) {
    const list = children.get(id)
    if (!list) continue
    for (const child of list) {
      if (seen.has(child)) continue
      seen.add(child)
      ids.push(child)
    }
  }

  for (const id of ids) {
    const v2Request = v2[id]?.[0]
    if (v2Request) return { kind: "v2", request: v2Request }
    const legacyRequest = legacy[id]?.find(includeLegacy)
    if (legacyRequest) return PermissionPendingModel.permissionPendingFromLegacy(legacyRequest)
  }
  return undefined
}

export function sessionQuestionRequest(
  session: Session[],
  request: Record<string, QuestionRequest[] | undefined>,
  sessionID?: string,
  include?: (item: QuestionRequest) => boolean,
) {
  return sessionTreeRequest(session, request, sessionID, include)
}
