import { createSignal } from "solid-js"
import type { CompositionSnapshotV2 } from "@aigcfroge/client/promise"
import type { ServerScope } from "@/runtime/server/scope"
import { composeDraftFromSnapshot, type ComposeDraft } from "./draft"

type StagedEdit = {
  scope: ServerScope
  directory: string
  key: string
  draft: ComposeDraft
  nonce: number
}

const [staged, setStaged] = createSignal<StagedEdit | undefined>(undefined)

let sequence = 0

function handoffKey(scope: ServerScope, directory: string) {
  return `${scope}\u0000${directory}`
}

/**
 * Stages a read-only Session SnapshotV2 into a new Compose draft for the exact
 * server + Location without mutating the historical Session.
 */
export function stageComposeDraftFromSnapshot(scope: ServerScope, directory: string, snapshot: CompositionSnapshotV2) {
  sequence += 1
  setStaged({
    scope,
    directory,
    key: handoffKey(scope, directory),
    draft: composeDraftFromSnapshot(snapshot),
    nonce: sequence,
  })
}

export function peekPendingComposeHandoff(scope: ServerScope) {
  const value = staged()

  if (!value || value.scope !== scope) return undefined

  return value
}

export function peekStagedComposeDraft(scope: ServerScope, directory: string) {
  const value = staged()

  if (!value || value.key !== handoffKey(scope, directory)) return undefined

  return value
}

export function clearStagedComposeDraft(nonce: number) {
  const value = staged()

  if (value?.nonce === nonce) setStaged(undefined)
}
