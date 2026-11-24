import type { SessionExecutorPreference } from "@omnixa/client/promise"
import { fromSelection, sameKey } from "./key"

export function hasCustomAgent(items: Array<{ originKind?: "builtin" | "user"; native?: boolean }>) {
  return items.some((item) => item.originKind === "user" || (item.originKind === undefined && item.native === false))
}

export function resolveAgent<T extends { name: string }>(items: T[], name?: string) {
  return items.find((item) => item.name === name) ?? items[0]
}

export function sameExecutorPreference(
  a: SessionExecutorPreference | undefined,
  b: SessionExecutorPreference | undefined,
) {
  return (
    a?.agent === b?.agent &&
    sameKey(a?.model && fromSelection(a.model), b?.model && fromSelection(b.model)) &&
    (a?.model && !("type" in a.model) ? a.model.variant : undefined) ===
      (b?.model && !("type" in b.model) ? b.model.variant : undefined)
  )
}
