import type { PermissionRequest, QuestionV2Request, Session, ToolPart } from "@aigcfroge/sdk/v2/client"
import { PermissionPendingModel } from "@/context/global-sync/permission-pending"
import { ScopedKey, type ServerScope } from "@/utils/server-scope"

function sessionTreeLevels(session: Session[], sessionID?: string) {
  if (!sessionID) return []

  const children = session.reduce((acc, item) => {
    if (!item.parentID) return acc
    const list = acc.get(item.parentID)
    if (list) list.push(item.id)
    if (!list) acc.set(item.parentID, [item.id])
    return acc
  }, new Map<string, string[]>())
  const seen = new Set([sessionID])
  const levels = [[sessionID]]
  for (const ids of levels) {
    const next = ids
      .flatMap((id) => children.get(id) ?? [])
      .filter((id) => {
        if (seen.has(id)) return false
        seen.add(id)
        return true
      })
    if (next.length) levels.push(next)
  }
  return levels
}

function sessionTreeRequest<T>(
  session: Session[],
  request: Record<string, T[] | undefined>,
  sessionID?: string,
  include: (item: T) => boolean = () => true,
) {
  for (const id of sessionTreeLevels(session, sessionID).flat()) {
    const item = request[id]?.find(include)
    if (item !== undefined) return item
  }
  return undefined
}

function pendingPermissions(
  legacy: PermissionRequest[] = [],
  v2: PermissionPendingModel.PermissionV2Pending[] = [],
  includeLegacy: (item: PermissionRequest) => boolean = () => true,
): PermissionPendingModel.PermissionPending[] {
  return [
    ...v2.map((request) => ({ kind: "v2" as const, request })),
    ...legacy.filter(includeLegacy).map(PermissionPendingModel.permissionPendingFromLegacy),
  ]
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
  includeLegacy?: (item: PermissionRequest) => boolean,
): PermissionPendingModel.PermissionPending | undefined {
  for (const id of sessionTreeLevels(session, sessionID).flat()) {
    const request = pendingPermissions(legacy[id], v2[id], includeLegacy)[0]
    if (request) return request
  }
}

export function sessionQuestionRequest(
  session: Session[],
  request: Record<string, QuestionV2Request[] | undefined>,
  sessionID?: string,
  include?: (item: QuestionV2Request) => boolean,
) {
  return sessionTreeRequest(session, request, sessionID, include)
}

type SessionRequestSource = {
  session: Session[]
  sessionID?: string
  scope: ServerScope
  directory: string
  question: Record<string, QuestionV2Request[] | undefined>
  legacyPermission: Record<string, PermissionRequest[] | undefined>
  v2Permission: Record<string, PermissionPendingModel.PermissionV2Pending[] | undefined>
  includeLegacyPermission?: (item: PermissionRequest) => boolean
}

export type SessionPendingRequest =
  | {
      readonly domain: "permission"
      readonly key: ScopedKey
      readonly ownerSessionID: string
      readonly request: PermissionPendingModel.PermissionPending
    }
  | {
      readonly domain: "question"
      readonly key: ScopedKey
      readonly ownerSessionID: string
      readonly request: QuestionV2Request
    }

export type SessionActiveRequest = SessionPendingRequest

export function sessionPendingRequests(input: SessionRequestSource): SessionPendingRequest[] {
  // Visit parent levels first, then permissions before questions at each level.
  // Preserve each store's recorded order. The active selector below consumes
  // this same ordered list, so discovery and arbitration cannot drift.
  return sessionTreeLevels(input.session, input.sessionID).flatMap((ids): SessionPendingRequest[] => [
    ...ids.flatMap((id) =>
      pendingPermissions(input.legacyPermission[id], input.v2Permission[id], input.includeLegacyPermission).map(
        (request): SessionPendingRequest => ({
          domain: "permission",
          key: ScopedKey.from(
            input.scope,
            input.directory,
            request.request.sessionID,
            "permission",
            request.kind,
            request.request.id,
          ),
          ownerSessionID: request.request.sessionID,
          request,
        }),
      ),
    ),
    ...ids.flatMap((id) =>
      (input.question[id] ?? []).map(
        (request): SessionPendingRequest => ({
          domain: "question",
          key: ScopedKey.from(input.scope, input.directory, request.sessionID, "question", request.id),
          ownerSessionID: request.sessionID,
          request,
        }),
      ),
    ),
  ])
}

export function sessionQuestionToolRequest(
  requests: readonly SessionPendingRequest[],
  part: Pick<ToolPart, "sessionID" | "messageID" | "callID">,
) {
  const matches = requests.filter(
    (item) =>
      item.domain === "question" &&
      item.ownerSessionID === part.sessionID &&
      item.request.tool?.messageID === part.messageID &&
      item.request.tool.callID === part.callID,
  )
  // A tool call without one exact pending owner cannot safely select a decision surface.
  return matches.length === 1 ? matches[0] : undefined
}

export function selectSessionRequest(
  requests: readonly SessionPendingRequest[],
  input: { selectedKey?: string; previousActiveKey?: string },
): SessionPendingRequest | undefined {
  return (
    requests.find((request) => request.key === input.selectedKey) ??
    requests.find((request) => request.key === input.previousActiveKey) ??
    requests[0]
  )
}

export function sessionActiveRequest(
  input: SessionRequestSource & {
    selectedKey?: string
    previousActiveKey?: string
  },
): SessionActiveRequest | undefined {
  return selectSessionRequest(sessionPendingRequests(input), input)
}
