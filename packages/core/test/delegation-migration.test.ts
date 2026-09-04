import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { Database } from "@aigcfroge/core/database/database"
import { DelegationID, ParticipantID, TurnID } from "@aigcfroge/schema/delegation-id"
import { ID as SessionID } from "@aigcfroge/schema/session-id"
import { testEffect } from "./lib/effect"
import { testDelegationBaseLayer } from "./delegation-test-support"
import { DelegationTable, DelegationParticipantTable, DelegationTurnTable } from "../src/delegation/sql"

const it = testEffect(testDelegationBaseLayer)

describe("Delegation Schema and Migration (Phase 1)", () => {
  it.effect("applies migration to create exactly three delegation tables and no delivery table (G1/G13)", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service

      // Query sqlite_master to verify tables created by DatabaseMigration
      const tables = yield* db.all<{ name: string }>(sql`
        SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'delegation%'
      `)
      const tableNames = tables.map((t) => t.name).sort()

      expect(tableNames).toContain("delegation")
      expect(tableNames).toContain("delegation_participant")
      expect(tableNames).toContain("delegation_turn")
      // Explicit assertion: delivery projection table MUST NEVER exist!
      expect(tableNames).not.toContain("delegation_delivery")

      const dlgId = DelegationID.ID.make("dlg_mig_test")
      const parentId = SessionID.make("ses_p1")
      const parId = ParticipantID.make("par_mig_test")
      const trnId = TurnID.make("trn_mig_test")

      // Verify insertion and foreign key cascade
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
        runtime_status: "idle",
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
})
