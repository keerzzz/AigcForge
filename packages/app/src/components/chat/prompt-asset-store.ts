import { createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { sameCandidateInfo, type CandidateInfo } from "./prompt-asset-candidate"

export type ProposeCandidateState = {
  candidate: CandidateInfo | null
  sessionID: string | null
  applying: boolean
  applied: boolean
}

const [state, setState] = createStore<ProposeCandidateState>({
  candidate: null,
  sessionID: null,
  applying: false,
  applied: false,
})

export function setProposeCandidate(sessionID: string, candidate: CandidateInfo) {
  // sync poll can emit equivalent objects repeatedly; skip the update only when the full
  // candidate (path, conflicts, per-kind config) is identical.
  if (state.sessionID === sessionID && state.candidate !== null && sameCandidateInfo(state.candidate, candidate)) return
  setState({ candidate, sessionID, applying: false, applied: false })
}

export function clearProposeCandidate() {
  setState({ candidate: null, sessionID: null, applying: false, applied: false })
}

export function setApplying(value: boolean) {
  setState("applying", value)
}

export function setApplied() {
  setState({ applying: false, applied: true })
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
