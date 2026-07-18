import { createStore } from "solid-js/store"
import type { CandidateInfo } from "./prompt-asset-candidate"

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
  setState({ candidate, sessionID, applying: false, applied: false })
}

export function clearProposeCandidate() {
  setState({ candidate: null, sessionID: null, applying: false, applied: false })
}

export function setApplying(v: boolean) {
  setState("applying", v)
}

export function setApplied() {
  setState({ applying: false, applied: true })
}

export function useProposeCandidate() {
  return state
}
