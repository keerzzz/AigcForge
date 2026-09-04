import { pathKey } from "@/utils/path-key"
import { ScopedKey, type ServerScope } from "@/utils/server-scope"

// Location identity for the Custom draft, split out of `custom-draft.tsx` so the
// keying can be tested — `persisted()` reaches `usePlatform()`, so store creation
// itself is not unit-testable, but the key derivation is the part that was wrong.
//
// What was wrong (all three at once, `custom-draft.tsx:349-362`):
//   1. the in-memory map keyed on the directory with no server, so two servers
//      sharing a directory path shared one draft;
//   2. persistence used ONE global localStorage slot for every directory, so the
//      last project to save overwrote the rest and switching projects loaded
//      someone else's draft;
//   3. the key was evaluated once, and all three mount sites pass `?? ""`, so a
//      not-yet-ready SDK pinned the store under an empty key permanently.

export const DRAFT_PERSIST_KEY = "custom-draft"

/**
 * Identity of one Custom draft: a server scope plus a normalized directory.
 *
 * Returns `undefined` when the directory is not known yet. Callers must not cache
 * anything under that — an empty directory is a moment in time, not a Location.
 */
export function customDraftKey(input: { scope: ServerScope; directory: string }): string | undefined {
  const directory = pathKey(input.directory)
  if (!directory) return undefined
  return ScopedKey.from(input.scope, directory)
}
