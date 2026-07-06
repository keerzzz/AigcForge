export * as SessionInput from "./input"

import { and, asc, eq, isNull, lte } from "drizzle-orm"
import { DateTime, Effect, Schema } from "effect"
import { Admitted, Delivery } from "@aigcfroge/schema/session-input"
import type { Database } from "../database/database"
import type { EventV2 } from "../event"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { Prompt } from "./prompt"
import { SessionSchema } from "./schema"
import { SessionInputTable, SessionMessageTable } from "./sql"

type DatabaseService = Database.Interface["db"]

export { Admitted, Delivery }

const decodePrompt = Schema.decodeUnknownSync(Prompt)
const encodePrompt = Schema.encodeSync(Prompt)

const fromRow = (row: typeof SessionInputTable.$inferSelect): Admitted => {
  const base = {
    admittedSeq: row.admitted_seq,
    id: SessionMessage.ID.make(row.id),
    sessionID: SessionSchema.ID.make(row.session_id),
    delivery: row.delivery,
    timeCreated: DateTime.makeUnsafe(row.time_created),
    ...(row.promoted_seq === null ? {} : { promotedSeq: row.promoted_seq }),
  }
  if (row.kind === "shell") {
    if (row.command === null) throw new Error(`Shell input ${row.id} is missing its command`)
    return Admitted.make({ kind: "shell", ...base, command: row.command })
  }
  if (row.kind === "skill") {
    if (row.skill === null) throw new Error(`Skill input ${row.id} is missing its skill name`)
    return Admitted.make({ kind: "skill", ...base, skill: row.skill })
  }
  if (row.prompt === null) throw new Error(`Prompt input ${row.id} is missing its prompt`)
  return Admitted.make({ kind: "prompt", ...base, prompt: decodePrompt(row.prompt) })
}

export const find = Effect.fn("SessionInput.find")(function* (db: DatabaseService, id: SessionMessage.ID) {
  const row = yield* db.select().from(SessionInputTable).where(eq(SessionInputTable.id, id)).get().pipe(Effect.orDie)
  return row === undefined ? undefined : fromRow(row)
})

export class LifecycleConflict extends Schema.TaggedErrorClass<LifecycleConflict>()("SessionInput.LifecycleConflict", {
  id: SessionMessage.ID,
}) {}

export const admit = Effect.fn("SessionInput.admit")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  input: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
  },
) {
  const existing = yield* find(db, input.id)
  if (existing !== undefined) return existing
  const timestamp = yield* DateTime.now
  return yield* events
    .publish(SessionEvent.PromptAdmitted, {
      messageID: input.id,
      sessionID: input.sessionID,
      timestamp,
      prompt: input.prompt,
      delivery: input.delivery,
    })
    .pipe(
      Effect.flatMap((event) =>
        event.durable === undefined
          ? Effect.die("Prompt admission event is missing aggregate sequence")
          : Effect.succeed(
              Admitted.make({
                kind: "prompt",
                admittedSeq: event.durable.seq,
                id: input.id,
                sessionID: input.sessionID,
                prompt: input.prompt,
                delivery: input.delivery,
                timeCreated: timestamp,
              }),
            ),
      ),
      Effect.catchDefect((defect) =>
        find(db, input.id).pipe(Effect.flatMap((stored) => (stored ? Effect.succeed(stored) : Effect.die(defect)))),
      ),
    )
})

export const admitShell = Effect.fn("SessionInput.admitShell")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  input: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly command: string
  },
) {
  const existing = yield* find(db, input.id)
  if (existing !== undefined) return existing
  const timestamp = yield* DateTime.now
  const delivery: Delivery = "queue"
  return yield* events
    .publish(SessionEvent.ShellAdmitted, {
      messageID: input.id,
      sessionID: input.sessionID,
      timestamp,
      command: input.command,
      delivery,
    })
    .pipe(
      Effect.flatMap((event) =>
        event.durable === undefined
          ? Effect.die("Shell admission event is missing aggregate sequence")
          : Effect.succeed(
              Admitted.make({
                kind: "shell",
                admittedSeq: event.durable.seq,
                id: input.id,
                sessionID: input.sessionID,
                command: input.command,
                delivery,
                timeCreated: timestamp,
              }),
            ),
      ),
      Effect.catchDefect((defect) =>
        find(db, input.id).pipe(Effect.flatMap((stored) => (stored ? Effect.succeed(stored) : Effect.die(defect)))),
      ),
    )
})

export const admitSkill = Effect.fn("SessionInput.admitSkill")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  input: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly skill: string
  },
) {
  const existing = yield* find(db, input.id)
  if (existing !== undefined) return existing
  const timestamp = yield* DateTime.now
  const delivery: Delivery = "steer"
  return yield* events
    .publish(SessionEvent.SkillAdmitted, {
      messageID: input.id,
      sessionID: input.sessionID,
      timestamp,
      skill: input.skill,
      delivery,
    })
    .pipe(
      Effect.flatMap((event) =>
        event.durable === undefined
          ? Effect.die("Skill admission event is missing aggregate sequence")
          : Effect.succeed(
              Admitted.make({
                kind: "skill",
                admittedSeq: event.durable.seq,
                id: input.id,
                sessionID: input.sessionID,
                skill: input.skill,
                delivery,
                timeCreated: timestamp,
              }),
            ),
      ),
      Effect.catchDefect((defect) =>
        find(db, input.id).pipe(Effect.flatMap((stored) => (stored ? Effect.succeed(stored) : Effect.die(defect)))),
      ),
    )
})

export const projectAdmitted = Effect.fn("SessionInput.projectAdmitted")(function* (
  db: DatabaseService,
  input: {
    readonly admittedSeq: number
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
    readonly timeCreated: DateTime.Utc
  },
) {
  const message = yield* db
    .select({ id: SessionMessageTable.id })
    .from(SessionMessageTable)
    .where(eq(SessionMessageTable.id, input.id))
    .get()
    .pipe(Effect.orDie)
  if (message !== undefined) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
  const stored = yield* db
    .insert(SessionInputTable)
    .values({
      id: input.id,
      session_id: input.sessionID,
      kind: "prompt",
      admitted_seq: input.admittedSeq,
      prompt: encodePrompt(input.prompt),
      delivery: input.delivery,
      time_created: DateTime.toEpochMillis(input.timeCreated),
    })
    .onConflictDoNothing()
    .returning({ id: SessionInputTable.id })
    .get()
    .pipe(Effect.orDie)
  if (!stored) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
})

export const projectShellAdmitted = Effect.fn("SessionInput.projectShellAdmitted")(function* (
  db: DatabaseService,
  input: {
    readonly admittedSeq: number
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly command: string
    readonly delivery: Delivery
    readonly timeCreated: DateTime.Utc
  },
) {
  const message = yield* db
    .select({ id: SessionMessageTable.id })
    .from(SessionMessageTable)
    .where(eq(SessionMessageTable.id, input.id))
    .get()
    .pipe(Effect.orDie)
  if (message !== undefined) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
  const stored = yield* db
    .insert(SessionInputTable)
    .values({
      id: input.id,
      session_id: input.sessionID,
      kind: "shell",
      admitted_seq: input.admittedSeq,
      command: input.command,
      delivery: input.delivery,
      time_created: DateTime.toEpochMillis(input.timeCreated),
    })
    .onConflictDoNothing()
    .returning({ id: SessionInputTable.id })
    .get()
    .pipe(Effect.orDie)
  if (!stored) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
})

export const projectSkillAdmitted = Effect.fn("SessionInput.projectSkillAdmitted")(function* (
  db: DatabaseService,
  input: {
    readonly admittedSeq: number
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly skill: string
    readonly delivery: Delivery
    readonly timeCreated: DateTime.Utc
  },
) {
  const message = yield* db
    .select({ id: SessionMessageTable.id })
    .from(SessionMessageTable)
    .where(eq(SessionMessageTable.id, input.id))
    .get()
    .pipe(Effect.orDie)
  if (message !== undefined) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
  const stored = yield* db
    .insert(SessionInputTable)
    .values({
      id: input.id,
      session_id: input.sessionID,
      kind: "skill",
      admitted_seq: input.admittedSeq,
      skill: input.skill,
      delivery: input.delivery,
      time_created: DateTime.toEpochMillis(input.timeCreated),
    })
    .onConflictDoNothing()
    .returning({ id: SessionInputTable.id })
    .get()
    .pipe(Effect.orDie)
  if (!stored) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
})

export const pendingSkillSteers = Effect.fn("SessionInput.pendingSkillSteers")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  cutoff: number,
) {
  const rows = yield* db
    .select()
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        isNull(SessionInputTable.promoted_seq),
        eq(SessionInputTable.kind, "skill"),
        eq(SessionInputTable.delivery, "steer"),
        lte(SessionInputTable.admitted_seq, cutoff),
      ),
    )
    .orderBy(asc(SessionInputTable.admitted_seq))
    .all()
    .pipe(Effect.orDie)
  return rows.map(fromRow)
})

export const projectPrompted = Effect.fn("SessionInput.projectPrompted")(function* (
  db: DatabaseService,
  input: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
    readonly timeCreated: DateTime.Utc
    readonly promotedSeq: number
  },
) {
  const updated = yield* db
    .update(SessionInputTable)
    .set({ promoted_seq: input.promotedSeq })
    .where(
      and(
        eq(SessionInputTable.id, input.id),
        eq(SessionInputTable.session_id, input.sessionID),
        isNull(SessionInputTable.promoted_seq),
      ),
    )
    .returning()
    .get()
    .pipe(Effect.orDie)
  if (updated) {
    const stored = fromRow(updated)
    if (!matchesProjection(stored, input)) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
    return
  }

  const stored = yield* find(db, input.id)
  if (stored) {
    if (!matchesProjection(stored, input) || stored.promotedSeq !== input.promotedSeq)
      return yield* Effect.die(new LifecycleConflict({ id: input.id }))
    return
  }

  yield* db
    .insert(SessionInputTable)
    .values({
      id: input.id,
      session_id: input.sessionID,
      kind: "prompt",
      prompt: encodePrompt(input.prompt),
      delivery: input.delivery,
      admitted_seq: input.promotedSeq,
      promoted_seq: input.promotedSeq,
      time_created: DateTime.toEpochMillis(input.timeCreated),
    })
    .run()
    .pipe(Effect.orDie)
})

export const hasPending = Effect.fn("SessionInput.hasPending")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  delivery: Delivery,
  kind: Admitted["kind"] = "prompt",
) {
  const row = yield* db
    .select({ id: SessionInputTable.id })
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        isNull(SessionInputTable.promoted_seq),
        eq(SessionInputTable.kind, kind),
        eq(SessionInputTable.delivery, delivery),
      ),
    )
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  return row !== undefined
})

export const equivalent = (
  input: Admitted,
  expected: {
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
  },
) => input.delivery === expected.delivery && matchesPrompt(input, expected)

export const equivalentShell = (
  input: Admitted,
  expected: {
    readonly sessionID: SessionSchema.ID
    readonly command: string
    readonly delivery: Delivery
  },
) =>
  input.kind === "shell" &&
  input.delivery === expected.delivery &&
  input.sessionID === expected.sessionID &&
  input.command === expected.command

export const equivalentSkill = (
  input: Admitted,
  expected: {
    readonly sessionID: SessionSchema.ID
    readonly skill: string
    readonly delivery: Delivery
  },
) =>
  input.kind === "skill" &&
  input.delivery === expected.delivery &&
  input.sessionID === expected.sessionID &&
  input.skill === expected.skill

const matchesPrompt = (input: Admitted, expected: { readonly sessionID: SessionSchema.ID; readonly prompt: Prompt }) =>
  input.kind === "prompt" &&
  input.sessionID === expected.sessionID &&
  JSON.stringify(encodePrompt(input.prompt)) === JSON.stringify(encodePrompt(expected.prompt))

const matchesProjection = (
  input: Admitted,
  expected: {
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
    readonly timeCreated: DateTime.Utc
  },
) =>
  // Skill rows do not store the resolved prompt content (only the invocation name), so the
  // prompt-equality check does not apply; identity + delivery + time are the durable match.
  (input.kind === "skill"
    ? input.sessionID === expected.sessionID && input.delivery === expected.delivery
    : equivalent(input, expected)) &&
  DateTime.toEpochMillis(input.timeCreated) === DateTime.toEpochMillis(expected.timeCreated)

const publish = Effect.fn("SessionInput.publish")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
  rows: ReadonlyArray<typeof SessionInputTable.$inferSelect>,
) {
  for (const row of rows) {
    const id = SessionMessage.ID.make(row.id)
    if (row.prompt === null) return yield* Effect.die(`Prompt input ${row.id} is missing its prompt`)
    yield* events
      .publish(SessionEvent.Prompted, {
        sessionID,
        timestamp: DateTime.makeUnsafe(row.time_created),
        messageID: id,
        prompt: decodePrompt(row.prompt),
        delivery: row.delivery,
      })
      .pipe(
        Effect.catchDefect((defect) =>
          defect instanceof LifecycleConflict
            ? find(db, id).pipe(
                Effect.flatMap((stored) => (stored?.promotedSeq === undefined ? Effect.die(defect) : Effect.void)),
              )
            : Effect.die(defect),
        ),
      )
  }
  return rows.length
})

export const promoteSteers = Effect.fn("SessionInput.promoteSteers")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
  cutoff: number,
) {
  const rows = yield* db
    .select()
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        isNull(SessionInputTable.promoted_seq),
        eq(SessionInputTable.kind, "prompt"),
        eq(SessionInputTable.delivery, "steer"),
        lte(SessionInputTable.admitted_seq, cutoff),
      ),
    )
    .orderBy(asc(SessionInputTable.admitted_seq))
    .all()
    .pipe(Effect.orDie)
  return yield* publish(db, events, sessionID, rows)
})

export const promoteNextQueued = Effect.fn("SessionInput.promoteNextQueued")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
) {
  const row = yield* db
    .select()
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        isNull(SessionInputTable.promoted_seq),
        eq(SessionInputTable.kind, "prompt"),
        eq(SessionInputTable.delivery, "queue"),
      ),
    )
    .orderBy(asc(SessionInputTable.admitted_seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  return row === undefined ? false : yield* publish(db, events, sessionID, [row]).pipe(Effect.as(true))
})

export const nextPendingShell = Effect.fn("SessionInput.nextPendingShell")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
) {
  const row = yield* db
    .select()
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        isNull(SessionInputTable.promoted_seq),
        eq(SessionInputTable.kind, "shell"),
        eq(SessionInputTable.delivery, "queue"),
      ),
    )
    .orderBy(asc(SessionInputTable.admitted_seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  return row === undefined ? undefined : fromRow(row)
})

export const markPromoted = Effect.fn("SessionInput.markPromoted")(function* (
  db: DatabaseService,
  input: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly promotedSeq: number
  },
) {
  yield* db
    .update(SessionInputTable)
    .set({ promoted_seq: input.promotedSeq })
    .where(
      and(
        eq(SessionInputTable.id, input.id),
        eq(SessionInputTable.session_id, input.sessionID),
        isNull(SessionInputTable.promoted_seq),
      ),
    )
    .run()
    .pipe(Effect.orDie)
})
