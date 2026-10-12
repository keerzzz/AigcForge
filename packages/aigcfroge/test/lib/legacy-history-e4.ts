/** Bun-only client of the E4 database; never starts a backend or invokes an importer. */
import path from "node:path"

const operation = process.argv[2]
const runDir = process.argv[3]
if ((operation !== "seed" && operation !== "inspect") || !runDir || !path.isAbsolute(runDir)) {
  throw new Error("Expected seed|inspect and an absolute isolated E4 run directory")
}
const directory = path.join(runDir, "workspace")
const dbPath = path.join(runDir, "e4.sqlite")
if (process.env.AIGCFROGE_DB !== dbPath || process.cwd() !== directory || !(await Bun.file(dbPath).exists())) {
  throw new Error("History fixture requires the existing isolated E4 database and workspace")
}
if (operation === "inspect" && !/^ses_history_http_e4_[a-f0-9]+$/.test(process.argv[4] ?? "")) {
  throw new Error("History inspect only accepts this fixture's Session IDs")
}

// Load backend services only after the launch boundary has been checked.
const { NodeFileSystem } = await import("@effect/platform-node")
const { Effect, FileSystem, Layer } = await import("effect")
const { eq } = await import("drizzle-orm")
const { Database } = await import("@aigcfroge/core/database/database")
const { ModelV2 } = await import("@aigcfroge/core/model")
const { ProviderV2 } = await import("@aigcfroge/core/provider")
const { SessionV2 } = await import("@aigcfroge/core/session")
const { SessionTable } = await import("@aigcfroge/core/session/sql")
const { LegacyHistory } = await import("./legacy-history")

const result = await Effect.runPromise(
  Effect.gen(function* () {
    const database = yield* Database.Service
    const filesystem = yield* FileSystem.FileSystem
    const seeded =
      operation === "seed"
        ? yield* LegacyHistory.seedLegacyTranscript(directory, `_e4_${crypto.randomUUID().replaceAll("-", "")}`)
        : undefined
    const sessionID = seeded?.sessionID ?? SessionV2.ID.make(process.argv[4] ?? "")
    if (seeded) {
      // The old transcript retains its original model. Only the current selection
      // points to the provider already owned and authenticated by the E4 harness.
      yield* database.db
        .update(SessionTable)
        .set({
          title: "E4 imported Assistant history",
          model: { id: ModelV2.ID.make("e4-deterministic"), providerID: ProviderV2.ID.make("e4-real") },
        })
        .where(eq(SessionTable.id, sessionID))
        .run()
        .pipe(Effect.orDie)
    }
    const stored = yield* LegacyHistory.persistedState(sessionID)
    if (!stored.usage) throw new Error("The isolated history Session is missing")
    return {
      sessionID,
      ...(seeded ? { userID: seeded.user, assistantID: seeded.assistant } : {}),
      source: {
        messages: stored.source.messages.length,
        parts: stored.source.parts.length,
        sha256: LegacyHistory.digest(stored.source),
      },
      usage: stored.usage,
      events: stored.events.map((event) => ({ id: event.id, type: event.type, seq: event.seq })),
      inputs: stored.inputs.map((input) => ({
        id: input.id,
        sessionID: input.session_id,
        kind: input.kind,
        delivery: input.delivery,
        admittedSeq: input.admitted_seq,
        promotedSeq: input.promoted_seq,
      })),
      replayFiles: {
        completed: yield* filesystem.exists(path.join(directory, "completed-replay.txt")),
        pending: yield* filesystem.exists(path.join(directory, "pending-replay.txt")),
      },
    }
  }).pipe(Effect.provide(Layer.mergeAll(Database.defaultLayer, NodeFileSystem.layer))),
)

console.log(`E4_HISTORY_RESULT:${JSON.stringify(result)}`)
