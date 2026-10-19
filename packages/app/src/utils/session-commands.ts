import { createMemo, createResource, untrack } from "solid-js"
import type { Composition } from "@aigcfroge/schema/composition"
import { CompositionConsumerView } from "@aigcfroge/schema/composition-consumer-view"
import { useSDK } from "@/context/sdk"
import { decodeSnapshotResponse } from "@/utils/snapshot-decode"

type SessionLike = {
  readonly id?: string | undefined
  readonly mode?: string | undefined
  readonly parentID?: string | null | undefined
  readonly agent?: string | null | undefined
}

/**
 * The current Session Snapshot's consumer command catalog (S5 leg 4). Custom
 * sessions resolve their consumer through the frozen binding graph and fail
 * closed to an empty catalog when the binding is unsatisfied — the flat
 * snapshot command arrays are never shown. Non-custom sessions return
 * `undefined` so callers keep the live command store.
 */
export function useSessionSnapshotCommands(session: () => SessionLike | undefined) {
  const sdk = useSDK()
  const sessionID = () => session()?.id

  // The source stays truthy even with no session, and the fetcher declines instead.
  // A null source makes Solid's `load()` take a branch that returns before
  // `Transition.promises.delete(pr)`, while `loadEnd`'s delete is guarded by a
  // `loadedUnderTransition` the same call has already recomputed as false — so a
  // registered promise leaks into the running transition and never leaves it. This
  // component renders inside the session route, whose navigation IS that transition:
  // one leaked entry and the route never commits. Declining in the fetcher issues no
  // request either, which is all the null source bought.
  const [snapshot] = createResource(
    () => ({ sessionID: sessionID(), directory: sdk().directory }),
    async (source): Promise<Composition.Snapshot | undefined> => {
      if (!source.sessionID) return undefined
      try {
        const res = await sdk().client.session.composition({ sessionID: source.sessionID }, { throwOnError: false })
        return decodeSnapshotResponse(res.data)
      } catch {
        return undefined
      }
    },
  )

  // Reading the resource itself (`snapshot()` / `snapshot.latest` before the first
  // settle) registers the composition read as route-transition work: the session
  // route then waits for it, and the Custom pending acceptance requires the opposite
  // — the Session must stay visible while that read is pending. Do not re-add
  // `initialValue` to sidestep that: seeding pins `resolved` at creation, the
  // promise settles outside the transition, and revisiting a Session then resets
  // its timeline scroll to the top (`session-tab-switch-benchmark` hot case).
  // Subscribe to the state signal for reactivity and read the value untracked.
  const latest = () => {
    snapshot.state
    return untrack(() => snapshot.latest)
  }

  const commands = createMemo(() => {
    const current = session()
    if (!current) return undefined
    if (current.mode !== "custom") {
      // Keep the historical *suspending* read for non-Custom sessions. It registers
      // the composition request with the session route transition, and the timeline
      // scroll anchor relies on the route committing after that read settles: with a
      // non-suspending read, revisiting a Session commits first and its timeline
      // scroll stays at the top (`session-tab-switch-benchmark` hot case). This is
      // existing timing, not a new dependency; Custom sessions use `latest()` below
      // so their pending acceptance keeps the Session visible.
      void snapshot()
      return undefined
    }
    const snap = latest()
    if (!snap) return undefined
    const scope = CompositionConsumerView.resolveScope(snap, current)
    if (!CompositionConsumerView.isBindingSatisfied(snap, scope)) return []
    return CompositionConsumerView.getCommands(snap, scope)
  })

  return { commands, snapshot, latest }
}
