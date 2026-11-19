import type {
  FileDiffInfo,
  SessionInfo,
  SessionStatus,
  ShellOutputInput,
  ShellOutputOutput,
  SessionTaskOperationReadonlyRef,
  SessionCommunicationReadInput,
  SessionCommunicationMessage,
  ModelGroupCurrent,
} from "@aigcfroge/client/promise"
import type { SessionReference } from "@aigcfroge/schema/session-reference"
import { createSimpleContext } from "@aigcfroge/ui/context"
import { PreloadMultiFileDiffResult } from "@pierre/diffs/ssr"

export type SessionSummary = Pick<SessionInfo, "id" | "parentID" | "title" | "time">

type ProviderCatalog = {
  all: Map<string, { models: Record<string, { name: string }> }>
  default: {
    [key: string]: string
  }
  connected: Array<string>
}

type Data = {
  agent?: {
    name: string
    color?: string
  }[]
  provider?: ProviderCatalog
  modelGroups?: readonly ModelGroupCurrent[]
  session: SessionSummary[]
  session_status: {
    [sessionID: string]: SessionStatus
  }
  session_diff: {
    [sessionID: string]: FileDiffInfo[]
  }
  session_diff_preload?: {
    [sessionID: string]: PreloadMultiFileDiffResult<unknown, undefined>[]
  }
}

export type NavigateToSessionFn = (sessionID: string) => void

export type SessionHrefFn = (sessionID: string) => string

/** An exact saved communication as viewed by one of its participating Sessions. */
export type SessionCommunicationRef = Pick<SessionCommunicationReadInput, "sessionID" | "communicationID">

/** The original server Data reports whether a displayed reference is loaded, deleted or disconnected. */
export type SessionReferenceState = { title: string; status: "available" | "missing" | "disconnected" | "unknown" }

export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "Data",
  init: (props: {
    data: Data
    directory: string
    sessionID?: string
    shellRunning?: (id: string) => boolean
    shellOutput?: (input: ShellOutputInput) => Promise<ShellOutputOutput>
    onNavigateToSession?: NavigateToSessionFn
    onSessionHref?: SessionHrefFn
    onOpenTask?: (reference: SessionTaskOperationReadonlyRef) => void
    onCommunication?: (reference: SessionCommunicationRef) => SessionCommunicationMessage | undefined
    onOpenCommunication?: (reference: SessionCommunicationRef) => void
    onOpenSessionReference?: (reference: SessionReference.RefEncoded) => void
    onSessionReferenceState?: (reference: SessionReference.RefEncoded) => SessionReferenceState
  }) => {
    return {
      get store() {
        return props.data
      },
      get directory() {
        return props.directory
      },
      get sessionID() {
        return props.sessionID
      },
      navigateToSession: props.onNavigateToSession,
      sessionHref: props.onSessionHref,
      shellRunning: props.shellRunning,
      shellOutput: props.shellOutput,
      openTask: props.onOpenTask,
      communication: props.onCommunication,
      openCommunication: props.onOpenCommunication,
      openSessionReference: props.onOpenSessionReference,
      sessionReferenceState: props.onSessionReferenceState,
    }
  },
})
