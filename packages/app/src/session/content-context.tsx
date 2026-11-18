import { createContext, useContext } from "solid-js"
import { useParams } from "@solidjs/router"
import type { SessionTaskOperationReadonlyRef } from "@aigcfroge/client/promise"
import type { SessionCommunicationRef } from "@aigcfroge/session-ui/context"

/** The target identity and interaction of a conversation embedded in a source panel. */
export const SessionContentContext = createContext<{
  params: { readonly serverKey: string; readonly id: string }
  active: () => boolean
  interaction: "interactive" | "readonly"
  ownsRequest: (sessionID: string | undefined) => boolean
  openRequestOwner: (sessionID: string | undefined) => void
  openSession: (sessionID: string) => void
  navigateToSession: (sessionID: string) => void
  /** Opens a retained Task through the real source workspace and target server. */
  openTask?: (reference: SessionTaskOperationReadonlyRef) => void
  /** Opens one retained communication through the real source workspace and target server. */
  openCommunication?: (reference: SessionCommunicationRef) => void
}>()

export function useSessionContent() {
  return useContext(SessionContentContext)
}

/** Main content uses the route; embedded content reads its explicit target. */
export function useSessionParams() {
  return useSessionContent()?.params ?? useParams()
}
