import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { Identifier } from "../../id/id"
import type { DatabaseMigration } from "../migration"

/**
 * Backfill legacy `todo` rows into the new `task` table. Runs after the
 * `task` table exists (20260801230425_add_task_table). Each row mints a stable
 * `tsk_`-prefixed, time-ordered id via Identifier.ascending("task"); position
 * and timestamps are preserved. The legacy `todo` table is left intact for
 * backward-compatible reads (deprecated, not dropped).
 */
export default {
  id: "20260802220000_backfill_task_table",
  up(tx) {
    return Effect.gen(function* () {
      const rows = yield* tx.all<{
        session_id: string
        content: string
        status: string
        priority: string
        position: number
        time_created: number
        time_updated: number
      }>(sql`SELECT session_id, content, status, priority, position, time_created, time_updated FROM \`todo\``)
      for (const row of rows) {
        yield* tx.run(
          sql`INSERT INTO \`task\` (id, session_id, content, status, priority, parent_id, position, time_created, time_updated)
              VALUES (${Identifier.ascending("task")}, ${row.session_id}, ${row.content}, ${row.status}, ${row.priority}, NULL, ${row.position}, ${row.time_created}, ${row.time_updated})`,
        )
      }
    })
  },
} satisfies DatabaseMigration.Migration
