import type { DelegationLegacyState, SessionTaskOperationInfo } from "@omnixa/client/promise"
import type { ServerRef } from "../sdk"

/** Permission and form requests suspend execution even while the transport reports running. */
export function executionStatus(server: ServerRef, sessionID?: string) {
  if (!sessionID || !server.data.session.get(sessionID)) return undefined
  if (!server.connected) return "disconnected"
  if (
    (server.data.session.permission.list(sessionID)?.length ?? 0) > 0 ||
    (server.data.session.form.list(sessionID)?.length ?? 0) > 0
  )
    return "waiting"
  return server.data.session.status(sessionID)
}

/** A durable Task status is not an execution signal; use its actual operation or participant. */
export function delegationRunning(value: DelegationLegacyState, status: (sessionID?: string) => string | undefined) {
  return (
    value.delegation.status === "running" &&
    !value.softExpired &&
    value.participants.some(
      (participant) =>
        participant.runtimeStatus === "running" &&
        !["waiting", "disconnected"].includes(status(participant.childSessionID) ?? ""),
    )
  )
}

export function operationRunning(value: SessionTaskOperationInfo, status: (sessionID?: string) => string | undefined) {
  return value.phase === "running" && !["waiting", "disconnected"].includes(status(value.targetSessionID) ?? "")
}
