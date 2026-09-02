// Pure fold for the Custom Builder's asset sidebar, split out of
// `custom-sidebar.tsx` so it can be tested without importing a `.tsx` (see
// custom-plan-state.ts for why that matters).
//
// P2-10: the sidebar used to wrap each of the five list calls in
// `.catch(() => ({ data: { assets: [] } }))` and the whole batch in `catch {}`, so
// any failure arrived as an empty array. "The server did not answer" and "this
// project has no agents" became the same screen — no message, no retry — and
// P2-13 made it worse: the zero-agents branch offers a "create starter agent"
// button, so a failed fetch invited the user to fix it by adding a fake asset.
//
// Keeping the successful lists matters: one failing kind must not blank the other
// four. So failures are collected per kind and reported alongside the data.

export const ASSET_KINDS = ["agents", "workflows", "prompts", "skills", "commands"] as const
export type AssetKind = (typeof ASSET_KINDS)[number]

export type ListOutcome<T> = { ok: true; assets: T[] } | { ok: false }

/**
 * Narrows one settled list call. A rejection and a 2xx body without `assets` are
 * NOT the same thing: the first is a failure to report, the second is a genuine
 * empty list, so only the rejection sets `ok: false`.
 */
export const listOutcome = <T>(
  result: PromiseSettledResult<{ data?: { assets?: T[] } | undefined }>,
): ListOutcome<T> =>
  result.status === "fulfilled" ? { ok: true, assets: result.value.data?.assets ?? [] } : { ok: false }

export type AssetCatalog<A, W, P, S, C> = {
  agents: A[]
  workflows: W[]
  prompts: P[]
  skills: S[]
  commands: C[]
  failed: AssetKind[]
}

export function foldAssetCatalog<A, W, P, S, C>(outcomes: {
  agents: ListOutcome<A>
  workflows: ListOutcome<W>
  prompts: ListOutcome<P>
  skills: ListOutcome<S>
  commands: ListOutcome<C>
}): AssetCatalog<A, W, P, S, C> {
  const failed: AssetKind[] = []
  const take = <T>(kind: AssetKind, outcome: ListOutcome<T>): T[] => {
    if (!outcome.ok) {
      failed.push(kind)
      return []
    }
    return outcome.assets
  }
  return {
    agents: take("agents", outcomes.agents),
    workflows: take("workflows", outcomes.workflows),
    prompts: take("prompts", outcomes.prompts),
    skills: take("skills", outcomes.skills),
    commands: take("commands", outcomes.commands),
    failed,
  }
}

export type CatalogStatus = "loading" | "ready" | "partial" | "error"

/**
 * Which of the four states the sidebar is in.
 *
 * `failed === undefined` means nothing has settled yet — either a read in flight
 * or no directory SDK at all. Both report `loading`, never `ready`: a `ready` here
 * would let `showsEmptyState` offer the starter prompt before anything was ever
 * read. A refetch over data already on screen keeps showing it rather than
 * flashing a skeleton, which is why `loading` is only consulted in that branch.
 */
export function catalogStatus(input: { loading: boolean; failed: readonly AssetKind[] | undefined }): CatalogStatus {
  if (input.failed === undefined) return "loading"
  if (input.failed.length >= ASSET_KINDS.length) return "error"
  if (input.failed.length > 0) return "partial"
  return "ready"
}

/**
 * Whether the "no agents yet" prompt may be shown. It must require a clean read:
 * offering it after a failed fetch is what turned P2-10 into P2-13.
 */
export const showsEmptyState = (input: { status: CatalogStatus; agentCount: number }) =>
  input.status === "ready" && input.agentCount === 0
