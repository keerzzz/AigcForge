# ADR-10: V2 Schema Versioning and Compatibility

## Context

The V2 session event sourcing layer uses SQLite with Drizzle ORM migrations. The schema has evolved through 14+ incremental migrations since V2 was introduced, each adding columns, indexes, or tables. The original `schema-changelog.md` (2026-06-01 entry) declared V2 databases as "disposable experimental state" — explicitly allowing data resets across incompatible schema iterations.

Now that V2 is production-bound, that disposable stance is no longer viable. Users expect schema changes to be backward-compatible without data loss. This ADR defines the versioning contract.

## Decision

### 1. All schema changes go through TypeScript migrations

Every schema change must be a TypeScript migration file in `packages/core/src/database/migration/`, generated or verified by `bun script/migration.ts --check`. No hand-written SQL schema changes outside the migration system.

### 2. Backward-compatible changes require only a migration

The following changes are always backward-compatible and need only a single migration:

- **Add a table** — new table, no existing data affected.
- **Add a column** — `ALTER TABLE ... ADD COLUMN` with nullable or default.
- **Add an index** — `CREATE INDEX` / `CREATE UNIQUE INDEX`, no table rewrite.
- **Add a foreign key** — new table only; SQLite ignores `ADD CONSTRAINT` so existing table FK changes require a full table rebuild (see §3).
- **Widen a column type** — only if the new type can represent all existing values (e.g. `INTEGER` → `REAL` is safe; `TEXT` → `INTEGER` is not).

### 3. Incompatible changes require a two-phase ADR

The following changes require an explicit ADR and MUST NOT be applied as a single migration:

- **Drop a column** — SQLite does not support `DROP COLUMN`. Requires table-level rewrite.
- **Change a column type to a narrower or incompatible type** — e.g. `TEXT` → `INTEGER`, `INTEGER` → `TEXT` that would lose precision.
- **Rename a table or column** — SQLite supports `ALTER TABLE RENAME` but all query references must be updated atomically.
- **Merge or split tables** — event schema changes requiring dual-write.

The required two-phase plan:

```
Phase 1 (dual-write):       Old columns written alongside new.
                              All reads still use old path.
Phase 2 (backfill):          Backfill existing rows to new columns.
Phase 3 (switch):            Switch all reads to new path.
                              Old columns removed in a follow-up release.
```

### 4. Down migrations are forbidden

SQLite does not support DDL transactions. A failed migration is handled by restoring from backup, not by rolling back schema changes. Every migration must be idempotent and safe to re-run on a partially-applied state.

### 5. Migration script is the single source of truth

`bun script/migration.ts` generates both:

- Incremental migrations (`packages/core/src/database/migration/`)
- The full schema snapshot (`packages/core/src/database/schema.gen.ts`)

The `--check` flag verifies that all declared schema changes have a matching migration. CI should run `bun script/migration.ts --check` to catch drift.

## Consequences

1. **Data reset is no longer a supported upgrade path.** All upgrades must be forward-compatible via migration.
2. **Adding columns is cheap.** Adding a nullable column or one with a default is a safe single-line migration and should be preferred over creating parallel tables.
3. **Removing columns is expensive.** It requires a full ADR. This encourages thinking carefully about the initial schema design.
4. **The migration registry (`migration.gen.ts`) must be consistent in CI.** The `--check` script catches stale registries before deployment.
5. **Existing pre-production databases with un-applied migrations will be handled by `DatabaseMigration.apply()`**, which detects the schema state and runs pending migrations in order. No manual intervention required.
