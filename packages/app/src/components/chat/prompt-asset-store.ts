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
  // 相等性守卫:若候选 materially 相同(同 sessionID + 同 kind/name/revision/status/content),跳过 setState
  // 避免 sync poll 每次写新对象引用致级联重渲染(F2)+ apply 后重置 applied/applying
  if (
    state.sessionID === sessionID &&
    state.candidate !== null &&
    state.candidate.kind === candidate.kind &&
    state.candidate.name === candidate.name &&
    state.candidate.description === candidate.description &&
    state.candidate.revision === candidate.revision &&
    state.candidate.status === candidate.status &&
    state.candidate.content === candidate.content &&
    JSON.stringify(state.candidate.candidate) === JSON.stringify(candidate.candidate)
  ) {
    return
  }
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
