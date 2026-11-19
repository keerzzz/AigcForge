import type { DatabaseSync } from "node:sqlite"
import type { EnableState } from "@aigcfroge/gui-extensions/sdk/bridge"

/** Explicit settings only: both startup readers and the manager resolve absent rows through the same SDK rule. */
export function readEnableState(db: DatabaseSync): readonly EnableState[] {
  return db
    .prepare("SELECT id, enabled FROM extension")
    .all()
    .flatMap((row) => {
      // Non-STRICT TEXT affinity permits blobs, which cannot match any string extension identity.
      if (typeof row.id !== "string") return []

      return [{ id: row.id, enabled: row.enabled === 1 }]
    })
}
