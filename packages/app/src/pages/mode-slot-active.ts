import { createContext, createEffect, useContext, type Accessor } from "solid-js"
import { useQueryClient, type QueryKey } from "@tanstack/solid-query"

// P2-14: `ModeWorkspace` mounts every mode's Sidebar and Main at once and hides the
// inactive ones with `display:none`. That is deliberate — it preserves each mode's UI
// state across switches — but it also means every mode's resources keep running. All
// five modes have at least one: `ChatFeatureSidebar`'s kind counts, coding's and
// work's session loads, work's workflow asset list, and the Custom sidebar's asset
// discovery plus the Builder's plan call. So opening Chat also issued the Custom
// asset requests.
//
// Plan §S6 REFACTOR is explicit about the shape of the fix: keep render-all, but put
// network/SDK/persist effects behind an active signal. This is that signal.

const ModeSlotActiveContext = createContext<Accessor<boolean>>()

export const ModeSlotActiveProvider = ModeSlotActiveContext.Provider

const ALWAYS_ACTIVE: Accessor<boolean> = () => true

/**
 * Whether the mode slot this component sits in is the one on screen.
 *
 * Defaults to always-active when there is no slot above, so the same components keep
 * working outside the workspace and session mode slots.
 */
export function useModeSlotActive(): Accessor<boolean> {
  return useContext(ModeSlotActiveContext) ?? ALWAYS_ACTIVE
}

/** Gate observers with the returned accessor and stop retries once none remain active. */
export function useModeQueryActivity(queryKey: Accessor<QueryKey>): Accessor<boolean> {
  const active = useModeSlotActive()
  const client = useQueryClient()
  createEffect(() => {
    if (active()) return
    // Solid Query updates observer options in a computed, before this effect.
    // Shared queries with another visible observer keep their ongoing request.
    void client.cancelQueries({ queryKey: queryKey(), type: "inactive" })
  })
  return active
}

/**
 * Gates a `createResource` source on slot activity.
 *
 * Returns `undefined` while inactive, which is how Solid is told not to run the
 * fetcher — an object source would otherwise always be truthy and always fetch.
 * Anything already loaded stays readable through the resource's `latest`.
 */
export function whenActive<T>(active: boolean, source: () => T): T | undefined {
  if (!active) return undefined
  return source()
}
