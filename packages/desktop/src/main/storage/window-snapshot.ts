import { existsSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import type { WindowSnapshot } from "../../shared/ipc-transport"
import { migrateDatabase } from "./migration"
import { readEnableState } from "../extension/enable-state"

// Before the storage layer exists, nothing has been written in this process and every namespace is at revision 0.
export function readWindowSnapshot(userData: string, names: readonly string[]): WindowSnapshot {
  const file = path.join(userData, "drafts.sqlite")

  if (!existsSync(file)) return { storage: {}, extensions: [] }

  try {
    const db = new DatabaseSync(file)

    try {
      migrateDatabase(db)

      const rows = db.prepare("SELECT key, value FROM state WHERE name = ?")

      return {
        storage: Object.fromEntries(
          names.map((name) => [
            name,
            {
              // Non-STRICT TEXT affinity permits blobs; window state contains only text keys and values.
              items: Object.fromEntries(
                rows.all(name).map((row) => {
                  if (typeof row.key !== "string" || typeof row.value !== "string") {
                    throw new TypeError("Invalid persisted window state")
                  }
                  return [row.key, row.value]
                }),
              ),
              revision: 0,
            },
          ]),
        ),
        extensions: readEnableState(db),
      }
    } finally {
      db.close()
    }
  } catch {
    return { storage: {} }
  }
}
