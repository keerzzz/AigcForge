import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { Database } from "@aigcfroge/core/database/database"
import { DatabaseMigration } from "@aigcfroge/core/database/migration"
import { DelegationID, ParticipantID, TurnID } from "@aigcfroge/schema/delegation-id"
import { ID as SessionID } from "@aigcfroge/schema/session-id"
import { testEffect } from "./lib/effect"
import { seedDelegationParentSession, testDelegationBaseLayer } from "./delegation-test-support"
import { DelegationTable, DelegationParticipantTable, DelegationTurnTable } from "../src/delegation/sql"
import addDelegationTablesMigration from "../src/database/migration/20260904160809_add_delegation_tables"

const it = testEffect(testDelegationBaseLayer)

describe("Delegation Schema and Migration (Phase 1 Remediation)", () => {
  it.effect("clean DB: creates exactly three delegation tables and no delivery table (G1/G13)", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service

      // Query sqlite_master to verify tables created by DatabaseMigration
      const tables = yield* db.all<{ name: string }>(sql`
        SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'delegation%' ORDER BY name
      `)
      const tableNames = tables.map((t) => t.name)

      expect(tableNames).toEqual(["delegation", "delegation_participant", "delegation_turn"])
      // Explicit assertion: delivery projection table MUST NEVER exist!
      expect(tableNames).not.toContain("delegation_delivery")

      const dlgId = DelegationID.ID.make("dlg_mig_test")
      const parentId = SessionID.make("ses_p1")
      const parId = ParticipantID.make("par_mig_test")
      const trnId = TurnID.make("trn_mig_test")
      yield* seedDelegationParentSession(db, parentId)

      // Verify insertion and foreign key cascade (without active_turn_id or runtime_status)
      yield* db.insert(DelegationTable).values({
        id: dlgId,
        parent_session_id: parentId,
        title: "Migration test",
        status: "draft",
        rejection_blocked: 0,
        last_activity_at: Date.now(),
      })

      yield* db.insert(DelegationParticipantTable).values({
        id: parId,
        delegation_id: dlgId,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
        phase: "active",
        last_activity_at: Date.now(),
      })

      yield* db.insert(DelegationTurnTable).values({
        id: trnId,
        delegation_id: dlgId,
        seq: 1,
        kind: "task",
        status: "admitted",
        participant_ids: [parId],
        delivery: "steer",
      })

      const delegations = yield* db.select().from(DelegationTable)
      expect(delegations.length).toBe(1)
      expect(delegations[0]?.title).toBe("Migration test")

      const participants = yield* db.select().from(DelegationParticipantTable)
      expect(participants.length).toBe(1)
      expect(participants[0]?.role).toBe("implementer")

      const turns = yield* db.select().from(DelegationTurnTable)
      expect(turns.length).toBe(1)
      expect(turns[0]?.delivery).toBe("steer")

      // Test cascading delete: deleting delegation removes participant and turn
      yield* db.run(sql`DELETE FROM \`delegation\` WHERE \`id\` = 'dlg_mig_test'`)
      const remainingParticipants = yield* db.select().from(DelegationParticipantTable)
      const remainingTurns = yield* db.select().from(DelegationTurnTable)
      expect(remainingParticipants.length).toBe(0)
      expect(remainingTurns.length).toBe(0)
    }),
  )

  it.effect("negative assertions: forbidden derived fields are absent from sqlite schema", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service

      const delegationCols = yield* db.all<{ name: string }>(sql`PRAGMA table_info('delegation')`)
      const participantCols = yield* db.all<{ name: string }>(sql`PRAGMA table_info('delegation_participant')`)
      const turnCols = yield* db.all<{ name: string }>(sql`PRAGMA table_info('delegation_turn')`)

      // active_turn_id is derived from max(turn.seq) in memory, must never be persisted
      expect(delegationCols.map((c) => c.name)).not.toContain("active_turn_id")

      // runtime_status is Activation-derived in memory, must never be persisted
      expect(participantCols.map((c) => c.name)).not.toContain("runtime_status")
      expect(turnCols.map((c) => c.name)).toContain("prompt_summary")
      expect(turnCols.map((c) => c.name)).not.toContain("prompt")

      const foreignKeys = yield* db.all<{ table: string; from: string; to: string; on_delete: string }>(
        sql`PRAGMA foreign_key_list('delegation')`,
      )
      expect(foreignKeys.find((foreignKey) => foreignKey.from === "parent_session_id")).toMatchObject({
        table: "session",
        to: "id",
        on_delete: "CASCADE",
      })
    }),
  )

  it.effect("idempotency: re-applying delegation migration does not corrupt or erase data", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service

      const dlgId = DelegationID.ID.make("dlg_idempotency")
      const parentId = SessionID.make("ses_idempotency")
      yield* seedDelegationParentSession(db, parentId)

      yield* db.insert(DelegationTable).values({
        id: dlgId,
        parent_session_id: parentId,
        title: "Idempotency test",
        status: "draft",
        rejection_blocked: 0,
        last_activity_at: 1000,
      })

      // Re-apply migration via applyOnly (must be no-op since already recorded in migration table)
      yield* DatabaseMigration.applyOnly(db, [addDelegationTablesMigration])

      const rows = yield* db.select().from(DelegationTable)
      expect(rows.length).toBe(1)
      expect(rows[0]?.id).toBe(dlgId)
    }),
  )

  it.effect("rollback on failure: failed transaction leaves database in clean pre-migration state", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service

      const failingMigration: DatabaseMigration.Migration = {
        id: "20999999999999_failing_migration",
        up(tx) {
          return Effect.gen(function* () {
            yield* tx.run(`CREATE TABLE delegation_test_rollback (id text PRIMARY KEY)`)
            yield* Effect.fail(new Error("intentional migration failure"))
          })
        },
      }

      const result = yield* DatabaseMigration.applyOnly(db, [failingMigration]).pipe(Effect.exit)
      expect(result._tag).toBe("Failure")

      const table = yield* db.get<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'delegation_test_rollback'`,
      )
      expect(table).toBeUndefined()
    }),
  )
})
