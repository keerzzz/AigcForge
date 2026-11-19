export * as LegacyMainMigration from "./legacy-main-migration.js"

import { sql } from "drizzle-orm"
import { DateTime, Effect } from "effect"
import { supportsForeignKeyToggle } from "#sqlite"
import type { EffectDrizzleSqlite } from "./drizzle.js"
import type { DatabaseMigration } from "./migration.js"
import { LegacyMainHistory } from "./legacy-main-history.js"
import schema from "./schema.gen.js"

type Database = EffectDrizzleSqlite.EffectSQLiteDatabase
type Transaction = Parameters<DatabaseMigration.Migration["up"]>[0]
type Column = { name: string; type: string; notnull: number; dflt_value: string | null; pk: number; hidden: number }

const prefix = "_legacy_main_"
const markers = ["20260629103917_meta_agent", "20260906023000_harden_external_cli_session_id"]
const projected = new Set(["event", "event_sequence", "session_message", "session_pending", "session_inbox"])
const legacyOnly = new Set([
  "session",
  "message",
  "part",
  "todo",
  "session_share",
  "session_input",
  "data_migration",
  "migration",
  "event_commit_probe",
  "kb_note_fts",
])

export const matches = Effect.fn("LegacyMainMigration.matches")(function* (db: Database) {
  if (!(yield* db.get(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'migration'`))) return false
  const found = yield* db.all<{ id: string }>(sql`
    SELECT id FROM migration WHERE id IN (${sql.join(
      markers.map((id) => sql`${id}`),
      sql`, `,
    )})
  `)
  if (found.length > 0 && found.length !== markers.length)
    return yield* new LegacyMainHistory.RecoveryError({ reason: "Unsupported legacy main migration lineage" })
  return found.length === markers.length
})

const copy = Effect.fn("LegacyMainMigration.copy")(function* (tx: Transaction, source: string, target: string) {
  const sourceCount = yield* tx.get<{ count: number }>(sql`SELECT count(*) AS count FROM ${sql.identifier(source)}`)
  // The fresh schema has no seeded rows; empty archived tables need no column conversion.
  if (sourceCount?.count === 0) return undefined
  const before = yield* tx.all<Column>(sql`SELECT * FROM pragma_table_xinfo(${source})`)
  const after = yield* tx.all<Column>(sql`SELECT * FROM pragma_table_xinfo(${target})`)
  const columns = new Map(after.map((column) => [column.name, column]))
  for (const column of before) {
    const expected = columns.get(column.name)
    if (
      !expected ||
      column.hidden !== 0 ||
      expected.hidden !== 0 ||
      column.type.toUpperCase() !== expected.type.toUpperCase() ||
      column.pk !== expected.pk ||
      column.notnull < expected.notnull ||
      column.dflt_value !== expected.dflt_value
    )
      return yield* new LegacyMainHistory.RecoveryError({
        reason: `Unsupported legacy column: ${target}.${column.name}`,
      })
  }
  if (
    after.some(
      (column) => !before.some((source) => source.name === column.name) && column.notnull && column.dflt_value === null,
    )
  )
    return yield* new LegacyMainHistory.RecoveryError({ reason: `Legacy table lacks required columns: ${target}` })

  const fields = sql.join(
    before.map((column) => sql.identifier(column.name)),
    sql`, `,
  )
  yield* tx.run(sql`INSERT INTO ${sql.identifier(target)} (${fields}) SELECT ${fields} FROM ${sql.identifier(source)}`)
  const targetCount = yield* tx.get<{ count: number }>(sql`SELECT count(*) AS count FROM ${sql.identifier(target)}`)
  const mismatch = yield* tx.get(sql`
    SELECT ${fields} FROM ${sql.identifier(source)}
    EXCEPT SELECT ${fields} FROM ${sql.identifier(target)} LIMIT 1
  `)
  if (sourceCount?.count !== targetCount?.count || mismatch)
    return yield* new LegacyMainHistory.RecoveryError({ reason: `Legacy table copy was not exact: ${target}` })
  return undefined
})

export const restore = Effect.fn("LegacyMainMigration.restore")(function* (
  db: Database,
  migrations: readonly DatabaseMigration.Migration[],
) {
  if (!supportsForeignKeyToggle)
    return yield* new LegacyMainHistory.RecoveryError({
      reason: "Legacy main recovery requires a local SQLite database",
    })
  const existing = yield* db.all<{ name: string; type: string }>(sql`
    SELECT name, type FROM pragma_table_list
    WHERE schema = 'main' AND name NOT LIKE 'sqlite_%' AND substr(name, 1, 1) <> '_'
  `)
  const tables = existing.filter((table) => table.type !== "shadow")
  const names = new Set(tables.map((table) => table.name))
  if (["session", "message", "part", "event"].some((name) => !names.has(name)))
    return yield* new LegacyMainHistory.RecoveryError({ reason: "Legacy main recovery is missing source tables" })
  if (tables.some((table) => table.type !== "table" && !(table.type === "virtual" && table.name === "kb_note_fts")))
    return yield* new LegacyMainHistory.RecoveryError({
      reason: "Legacy main recovery found an unsupported table kind",
    })
  if (yield* db.get(sql`SELECT 1 FROM sqlite_master WHERE substr(name, 1, ${prefix.length}) = ${prefix} LIMIT 1`))
    return yield* new LegacyMainHistory.RecoveryError({
      reason: "Legacy main archive already exists beside source tables",
    })
  if (names.has("session_v2") && (yield* db.get(sql`SELECT 1 FROM session_v2 LIMIT 1`)))
    return yield* new LegacyMainHistory.RecoveryError({
      reason: "Legacy main and current Session data cannot be merged implicitly",
    })
  for (const name of ["session_pending", "session_inbox", "instruction_state", "instruction_entry", "instruction_blob"])
    if (names.has(name) && (yield* db.get(sql`SELECT 1 FROM ${sql.identifier(name)} LIMIT 1`)))
      return yield* new LegacyMainHistory.RecoveryError({
        reason: `Legacy main recovery found current state in ${name}`,
      })
  const triggers = yield* db.all<{ tbl_name: string }>(sql`SELECT tbl_name FROM sqlite_master WHERE type = 'trigger'`)
  if (triggers.some((trigger) => names.has(trigger.tbl_name)))
    return yield* new LegacyMainHistory.RecoveryError({
      reason: "Legacy main recovery found unsupported source triggers",
    })

  const foreignKeys = yield* db.get<{ foreign_keys: number }>(sql`PRAGMA foreign_keys`)
  yield* db.run(sql`PRAGMA foreign_keys = OFF`)
  yield* db
    .transaction((tx) =>
      Effect.gen(function* () {
        const indexes = yield* tx.all<{ name: string; tbl_name: string }>(sql`
          SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL
        `)
        // Archived rows and primary keys survive; the current schema owns the public index names.
        for (const index of indexes)
          if (names.has(index.tbl_name)) yield* tx.run(sql`DROP INDEX ${sql.identifier(index.name)}`)
        for (const table of tables)
          yield* tx.run(sql`ALTER TABLE ${sql.identifier(table.name)} RENAME TO ${sql.identifier(prefix + table.name)}`)

        yield* schema.up(tx)
        const current = yield* tx.all<{ name: string }>(sql`
          SELECT name FROM sqlite_master
          WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND substr(name, 1, 1) <> '_'
        `)
        const currentNames = new Set(current.map((table) => table.name))
        if (tables.some((table) => !currentNames.has(table.name) && !legacyOnly.has(table.name)))
          return yield* new LegacyMainHistory.RecoveryError({
            reason: "Legacy main recovery found an unknown source table",
          })
        for (const table of current) {
          if (projected.has(table.name)) continue
          const source = table.name === "session_v2" ? "session" : table.name
          if (names.has(source)) yield* copy(tx, prefix + source, table.name)
        }

        yield* LegacyMainHistory.restore(tx)
        const violation = yield* tx.get<{ table: string }>(sql`SELECT "table" FROM pragma_foreign_key_check LIMIT 1`)
        if (violation)
          return yield* new LegacyMainHistory.RecoveryError({
            reason: `Legacy recovery left an invalid relation in ${violation.table}`,
          })

        // This journal certifies the schema and data just materialized, not skipped CREATE statements.
        // The original migration journal is retained under the same archive prefix as its source data.
        yield* tx.run(sql`CREATE TABLE migration (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`)
        const completed = (yield* DateTime.nowAsDate).getTime()
        for (const migration of migrations)
          yield* tx.run(sql`INSERT INTO migration (id, time_completed) VALUES (${migration.id}, ${completed})`)
      }),
    )
    .pipe(
      Effect.ensuring(
        db
          .run(foreignKeys?.foreign_keys === 1 ? "PRAGMA foreign_keys = ON" : "PRAGMA foreign_keys = OFF")
          .pipe(Effect.orDie),
      ),
    )
})
