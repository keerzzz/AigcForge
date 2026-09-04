import { describe, expect } from "bun:test"
import { DateTime, Effect, Exit, Layer } from "effect"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionInput } from "@aigcfroge/core/session/input"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { Prompt } from "@aigcfroge/core/session/prompt"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import * as SessionSchema from "@aigcfroge/core/session/schema"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { testEffect } from "./lib/effect"

// MECHANISM coverage for P1-5, not a RED.
//
// runner/llm.ts:889-898 carries a comment saying the skill promotion must reuse the admission
// timestamp, and then publishes SessionEvent.Prompted with `yield* DateTime.now` anyway. The
// synthetic promotion path 15 lines below (:913) does it correctly with `admitted.timeCreated`.
//
// These two tests pin the invariant that makes that divergence a defect rather than a style nit:
// matchesProjection (session/input.ts:563) compares the promoted event's time against the stored
// inbox row's time_created for every kind, skills included, so a promotion-time timestamp makes
// projectPrompted die with LifecycleConflict under a real clock.
//
// The runner-level RED cannot live here: promoteSkills is a closure inside SessionRunner's layer
// with no exported seam, so driving it needs the full harness in test/session-runner.test.ts.
// S3 must add it there and may then delete this file if it becomes redundant.

const it = testEffect(Layer.mergeAll(Database.defaultLayer, EventV2.defaultLayer, SessionProjector.defaultLayer))

const admitOneSkill = (suffix: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service
    const sessionID = SessionSchema.ID.make(`ses_p15${suffix}`)
    const id = SessionMessage.ID.make(`msg_p15${suffix}`)
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        slug: `p15${suffix}`,
        directory: "/project",
        title: "skill promotion timestamp",
        version: "test",
      })
      .run()
      .pipe(Effect.orDie)
    const admitted = yield* SessionInput.admitSkill(db, events, { id, sessionID, skill: "test-skill" })
    return { db, sessionID, id, admitted }
  })

describe("P1-5 MECHANISM: skill promotion must reuse the admission timestamp", () => {
  it.live("promoting with the admission timestamp projects cleanly", () =>
    Effect.gen(function* () {
      const { db, sessionID, id, admitted } = yield* admitOneSkill("ok")
      const exit = yield* Effect.exit(
        SessionInput.projectPrompted(db, {
          id,
          sessionID,
          prompt: Prompt.make({ text: "resolved skill body" }),
          delivery: admitted.delivery,
          timeCreated: admitted.timeCreated,
          promotedSeq: admitted.admittedSeq + 1,
        }),
      )
      expect(Exit.isSuccess(exit)).toBe(true)
    }),
  )

  it.live("promoting with promotion time instead of admission time is a lifecycle conflict", () =>
    Effect.gen(function* () {
      const { db, sessionID, id, admitted } = yield* admitOneSkill("bad")
      const promotionTime = DateTime.makeUnsafe(DateTime.toEpochMillis(admitted.timeCreated) + 60_000)
      const exit = yield* Effect.exit(
        SessionInput.projectPrompted(db, {
          id,
          sessionID,
          prompt: Prompt.make({ text: "resolved skill body" }),
          delivery: admitted.delivery,
          timeCreated: promotionTime,
          promotedSeq: admitted.admittedSeq + 1,
        }),
      )
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )
})
