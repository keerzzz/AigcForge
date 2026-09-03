import { createMemo, createResource } from "solid-js"
import { Schema } from "effect"
import { Composition } from "@aigcfroge/schema/composition"
import { CompositionConsumerView } from "@aigcfroge/schema/composition-consumer-view"
import { useSDK } from "@/context/sdk"

const decodeSnapshot = Schema.decodeUnknownOption(Composition.Snapshot)

function extractSnapshot(data: unknown): Composition.Snapshot | undefined {
  if (typeof data !== "object" || data === null) return undefined
  const direct = decodeSnapshot(data)
  if (direct._tag === "Some") return direct.value
  if ("snapshot" in data) {
    const nested = decodeSnapshot((data as { snapshot: unknown }).snapshot)
    if (nested._tag === "Some") return nested.value
  }
  return undefined
}

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
        return extractSnapshot(res.data)
      } catch {
        return undefined
      }
    },
  )

  const commands = createMemo(() => {
    const current = session()
    const snap = snapshot()
    if (!current || !snap) return undefined
    if (current.mode !== "custom") return undefined
    const scope = CompositionConsumerView.resolveScope(snap, current)
    if (!CompositionConsumerView.isBindingSatisfied(snap, scope)) return []
    return CompositionConsumerView.getCommands(snap, scope)
  })

  return { commands, snapshot }
}
