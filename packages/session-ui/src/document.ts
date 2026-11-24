import type { FileDiffInfo, SessionMessageInfo, SessionStatus } from "@omnixa/client/promise"

export type SessionDocument = {
  sessionID: string
  messages: SessionMessageInfo[]
  status: SessionStatus
  diffs: FileDiffInfo[]
}
