import { expect } from "bun:test"
import { eq, sql } from "drizzle-orm"
import { ConfigProvider, Context, Effect, Layer, Schema } from "effect"
import { HttpServer } from "effect/unstable/http"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionLegacyHistory } from "@aigcfroge/core/session/legacy-history"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { MessageTable, PartTable, SessionMessageTable } from "@aigcfroge/core/session/sql"
import { PartID, SessionV1 } from "@aigcfroge/core/v1/session"
import { createAigcfrogeClient } from "@aigcfroge/sdk/v2"
import { InvalidRequestError } from "@aigcfroge/server/errors"
import { AIGCFROGE_V2_RUNTIME, AppLayer } from "../../src/effect/app-runtime"
import { resetDatabase } from "../fixture/db"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { LegacyHistory } from "../lib/legacy-history"
import { TestLLMServer } from "../lib/llm-server"
import { httpApiLayer } from "./httpapi-layer"

const state = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* Effect.promise(() => resetDatabase())
    yield* Effect.addFinalizer(() => Effect.promise(() => resetDatabase()))
  }),
)

// Exercise the production routes over Node HTTP with the generated SDK. The
// provider fixture below has its own memo map so its router and listener are separate.
const it = testEffect(
  Layer.mergeAll(httpApiLayer, AppLayer, LocationServiceMap.layer, EventV2.defaultLayer).pipe(
    Layer.provide(state),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          AIGCFROGE_SERVER_USERNAME: "aigcfroge",
          AIGCFROGE_SERVER_PASSWORD: "unsupported-history-test",
        }),
      ),
    ),
  ),
)
const authorization = `Basic ${Buffer.from("aigcfroge:unsupported-history-test").toString("base64")}`

it.live("unsupported Assistant history returns safe typed HTTP errors without importing or dispatching", () =>
  Effect.gen(function* () {
    expect(AIGCFROGE_V2_RUNTIME).toBe(false)
    const sessions = yield* SessionV2.Service
    const execution = yield* SessionExecution.Service
    const db = (yield* Database.Service).db
    const provider = Context.get(
      yield* Layer.buildWithMemoMap(TestLLMServer.layer, yield* Layer.makeMemoMap, yield* Effect.scope),
      TestLLMServer,
    )
    yield* provider.text("Unexpected provider dispatch.")
    const baseUrl = HttpServer.formatAddress((yield* HttpServer.HttpServer).address)

    yield* Effect.forEach(["mixed", "system", "remote-media", "tool-media", "tail"] as const, (kind) =>
      Effect.gen(function* () {
        const directory = yield* tmpdirScoped({ config: LegacyHistory.providerConfig(provider.url) })
        const seeded = yield* seedRejectedHistory(directory, kind)
        const before = yield* LegacyHistory.persistedState(seeded.sessionID)
        const canonical = yield* db
          .select()
          .from(SessionMessageTable)
          .where(eq(SessionMessageTable.session_id, seeded.sessionID))
          .all()
          .pipe(Effect.orDie)
        const rejected = yield* sessions.get(seeded.sessionID).pipe(
          Effect.as(false),
          Effect.catchDefect((error) =>
            error instanceof SessionLegacyHistory.ImportError ? Effect.succeed(true) : Effect.die(error),
          ),
        )
        expect(rejected).toBe(true)
        const sdk = createAigcfrogeClient({ baseUrl, directory, headers: { authorization } })
        const adopted = yield* Effect.promise(() => sdk.v2.session.create({ id: seeded.sessionID }))
        expect(adopted.response.status).toBe(200)
        expect(adopted.data?.data.id).toBe(seeded.sessionID)
        expect(yield* LegacyHistory.persistedState(seeded.sessionID)).toEqual(before)
        const responses = [
          yield* Effect.promise(() => sdk.v2.session.get({ sessionID: seeded.sessionID })),
          yield* Effect.promise(() => sdk.v2.session.messages({ sessionID: seeded.sessionID })),
          yield* Effect.promise(() =>
            sdk.v2.session.prompt({
              sessionID: seeded.sessionID,
              id: `msg_unsupported_${kind}_canonical`,
              prompt: { text: "This input must not be admitted." },
            }),
          ),
          yield* Effect.promise(() =>
            sdk.session.promptAsync({
              sessionID: seeded.sessionID,
              messageID: `msg_unsupported_${kind}_legacy`,
              parts: [{ type: "text", text: "This legacy input must not be admitted." }],
            }),
          ),
        ]
        responses.forEach((response) => expectUnsupported(response.response.status, response.error))
        expect(yield* LegacyHistory.persistedState(seeded.sessionID)).toEqual(before)
        expect(
          yield* db
            .select()
            .from(SessionMessageTable)
            .where(eq(SessionMessageTable.session_id, seeded.sessionID))
            .all()
            .pipe(Effect.orDie),
        ).toEqual(canonical)
        expect(yield* execution.isActive(seeded.sessionID)).toBe(false)
        expect(yield* provider.calls).toBe(0)
        expect(yield* provider.pending).toBe(1)

        // Raw V1 inspection and deletion remain available for a rejected Session.
        const legacy = yield* Effect.promise(() => sdk.session.get({ sessionID: seeded.sessionID }))
        expect(legacy.response.status).toBe(200)
        expect(legacy.data?.id).toBe(seeded.sessionID)
        const removed = yield* Effect.promise(() => sdk.session.delete({ sessionID: seeded.sessionID }))
        expect(removed.response.status).toBe(200)
        const missing = yield* Effect.promise(() => sdk.v2.session.get({ sessionID: seeded.sessionID }))
        expect(missing.response.status).toBe(404)
      }).pipe(Effect.scoped),
    )
  }),
)

it.live("unrelated stored-history defects remain HTTP 500 rather than unsupported-history errors", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const seeded = yield* seedRejectedHistory(directory, "corrupt")
    const before = yield* LegacyHistory.persistedState(seeded.sessionID)
    const sdk = createAigcfrogeClient({
      baseUrl: HttpServer.formatAddress((yield* HttpServer.HttpServer).address),
      directory,
      headers: { authorization },
    })
    const responses = [
      yield* Effect.promise(() => sdk.v2.session.get({ sessionID: seeded.sessionID })),
      yield* Effect.promise(() =>
        sdk.v2.session.prompt({ sessionID: seeded.sessionID, prompt: { text: "Must not be admitted." } }),
      ),
      yield* Effect.promise(() =>
        sdk.session.promptAsync({
          sessionID: seeded.sessionID,
          parts: [{ type: "text", text: "Must not be admitted." }],
        }),
      ),
    ]
    responses.forEach((response) => {
      expect(response.response.status).toBe(500)
      expect(JSON.stringify(response.error)).not.toContain("unsupported-history")
      expect(JSON.stringify(response.error)).not.toContain("private-invalid-role")
    })
    expect(yield* LegacyHistory.persistedState(seeded.sessionID)).toEqual(before)
  }),
)

function expectUnsupported(status: number, body: unknown) {
  expect(status).toBe(400)
  const error = Schema.decodeUnknownSync(Schema.toCodecJson(InvalidRequestError))(body)
  expect({ type: error._tag, message: error.message, kind: error.kind, field: error.field }).toEqual({
    type: "InvalidRequestError",
    message: "This session's legacy history cannot be adopted. Its source history has been preserved.",
    kind: "unsupported-history",
    field: "sessionID",
  })
}

const seedRejectedHistory = Effect.fnUntraced(function* (
  directory: string,
  kind: "mixed" | "system" | "remote-media" | "tool-media" | "tail" | "corrupt",
) {
  const sessions = yield* SessionV2.Service
  const seeded = yield* LegacyHistory.seedLegacyTranscript(directory, `_unsupported_${kind}`)
  // Deletion in the test is deliberate; cleanup must also work before it is reached.
  yield* Effect.addFinalizer(() =>
    sessions.remove(seeded.sessionID).pipe(
      Effect.catchTag("Session.NotFoundError", () => Effect.void),
      Effect.orDie,
    ),
  )
  const db = (yield* Database.Service).db
  if (kind === "mixed") {
    yield* db
      .insert(SessionMessageTable)
      .values({
        id: SessionMessage.ID.make("msg_unsupported_mixed_canonical"),
        session_id: seeded.sessionID,
        type: "user",
        seq: 1,
        time_created: 0,
        time_updated: 0,
        data: { ...{ text: "Private canonical source marker.", time: { created: 0 } } },
      })
      .run()
      .pipe(Effect.orDie)
    return seeded
  }
  if (kind === "system" || kind === "corrupt") {
    const user = yield* db.select().from(MessageTable).where(eq(MessageTable.id, seeded.user)).get().pipe(Effect.orDie)
    if (!user) return yield* Effect.die("Missing legacy user fixture")
    if (kind === "system") {
      yield* db
        .update(MessageTable)
        .set({ data: { ...user.data, ...{ system: "Private legacy system marker." } } })
        .where(eq(MessageTable.id, seeded.user))
        .run()
        .pipe(Effect.orDie)
      return seeded
    }
    yield* db.run(
      sql`UPDATE message SET data = json_set(data, '$.role', 'private-invalid-role') WHERE id = ${seeded.user}`,
    )
    return seeded
  }
  if (kind === "tail") {
    const assistant = yield* db
      .select()
      .from(MessageTable)
      .where(eq(MessageTable.id, seeded.assistant))
      .get()
      .pipe(Effect.orDie)
    if (!assistant) return yield* Effect.die("Missing legacy assistant fixture")
    yield* db
      .update(MessageTable)
      .set({ data: { ...assistant.data, ...{ summary: true } } })
      .where(eq(MessageTable.id, seeded.assistant))
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(PartTable)
      .values({
        id: PartID.make("prt_unsupported_tail_compaction"),
        message_id: seeded.user,
        session_id: seeded.sessionID,
        time_created: 1,
        time_updated: 1,
        data: {
          ...({ type: "compaction", auto: true, tail_start_id: seeded.user } satisfies Omit<
            SessionV1.CompactionPart,
            "id" | "sessionID" | "messageID"
          >),
        },
      })
      .run()
      .pipe(Effect.orDie)
    return seeded
  }
  const attachment = {
    id: PartID.make(`prt_unsupported_${kind}_file`),
    sessionID: seeded.sessionID,
    messageID: kind === "remote-media" ? seeded.user : seeded.assistant,
    type: "file" as const,
    mime: "image/png",
    url: "https://example.invalid/private-history.png?token=private-media-marker",
  } satisfies SessionV1.FilePart
  yield* db
    .insert(PartTable)
    .values({
      id: PartID.make(`prt_unsupported_${kind}`),
      message_id: attachment.messageID,
      session_id: seeded.sessionID,
      time_created: 2,
      time_updated: 3,
      data:
        kind === "remote-media"
          ? { ...attachment }
          : {
              ...({
                type: "tool",
                callID: "unsupported-tool-media",
                tool: "read",
                state: {
                  status: "completed",
                  input: {},
                  output: "Private tool output marker.",
                  title: "Historical media",
                  metadata: {},
                  time: { start: 2, end: 3 },
                  attachments: [attachment],
                },
              } satisfies Omit<SessionV1.ToolPart, "id" | "sessionID" | "messageID">),
            },
    })
    .run()
    .pipe(Effect.orDie)
  return seeded
})
