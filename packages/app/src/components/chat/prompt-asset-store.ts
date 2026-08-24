import { createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { sameCandidateInfo, type CandidateInfo } from "./prompt-asset-candidate"

export type ApplyWarning = {
  code: "wildcard_allow" | "dangerous_allow"
  action: string
  resource: string
}

export type ProposeCandidateState = {
  candidate: CandidateInfo | null
  sessionID: string | null
  applying: boolean
  applied: boolean
  appliedWarnings: ReadonlyArray<ApplyWarning>
}

const [state, setState] = createStore<ProposeCandidateState>({
  candidate: null,
  sessionID: null,
  applying: false,
  applied: false,
  appliedWarnings: [],
})

export function setProposeCandidate(sessionID: string, candidate: CandidateInfo) {
  // sync poll can emit equivalent objects repeatedly; skip the update only when the full
  // candidate (path, conflicts, per-kind config) is identical.
  if (state.sessionID === sessionID && state.candidate !== null && sameCandidateInfo(state.candidate, candidate)) return
  setState({ candidate, sessionID, applying: false, applied: false, appliedWarnings: [] })
}

export function clearProposeCandidate() {
  setState({ candidate: null, sessionID: null, applying: false, applied: false, appliedWarnings: [] })
}

export function setApplying(value: boolean) {
  setState("applying", value)
}

export function setApplied(warnings: ReadonlyArray<ApplyWarning> = []) {
  setState({ applying: false, applied: true, appliedWarnings: warnings })
}

export function useProposeCandidate() {
  return state
}

/** Module-level version counter bumped after each asset apply. Allows remote consumers (ChatFeatureSidebar counts) to refetch. */
const [assetVersion, setAssetVersion] = createSignal(0)
export function bumpAssetVersion() {
  setAssetVersion((v) => v + 1)
}
export { assetVersion }
