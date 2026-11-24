import { describe, expect } from "bun:test"
import { Cause, DateTime, Effect, Exit, Layer, Option, Schema } from "effect"
import path from "path"
import { eq } from "drizzle-orm"
import { MetaAgent } from "@omnixa/schema/meta-agent"
import { MetaAgentMemory } from "../src/agent/meta/memory"
import { Database } from "../src/database/database"
import { MetaAgentService } from "../src/meta-agent/service"
import { SessionComposition } from "../src/session/composition"
import { MetaAgentMemoryTable, MetaAgentSessionTable, MetaAgentTable } from "../src/meta-agent/sql"
import { ProjectTable } from "../src/project/sql"
import { Project } from "../src/project"
import { AbsolutePath } from "../src/schema"
import { SessionSchema } from "../src/session/schema"
import { ControllerConflictError } from "../src/session/error.js"
import { CorrectionExtractor } from "../src/session/correction-extractor.js"
import { ConfigMeta } from "../src/config/meta.js"
import { Document, Info } from "@omnixa/schema/config"
import { SessionTable } from "../src/session/sql"
import { Global } from "@omnixa/util/global"
import { it } from "./lib/effect"
import { tmpdir } from "./fixture/tmpdir"

const globalLayer = Layer.succeed(
  Global.Service,
  Global.Service.of(Global.make({ data: "/data", config: "/config", tmp: "/tmp/omnixa" })),
)

const sessionID = SessionSchema.ID.make("ses_memory")
const projectID = Project.ID.make("proj_memory")
const otherProjectID = Project.ID.make("proj_other")

function withTmp<A, E, R>(f: (directory: string) => Effect.Effect<A, E, R>) {
  return Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => f(tmp.path)))
}

const attached = (directory: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const now = DateTime.toEpochMillis(yield* DateTime.now)
    yield* db
      .insert(ProjectTable)
      .values({
        id: projectID,
        worktree: AbsolutePath.make(directory),
        sandboxes: [],
        time_created: now,
        time_updated: now,
      })
      .run()
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: projectID,
        directory: AbsolutePath.make(directory),
        title: "memory test",
        slug: sessionID,
        version: "0",
        time_created: now,
        time_updated: now,
      })
      .run()
    yield* db
      .insert(MetaAgentTable)
      .values({
        id: MetaAgent.ID.descending("mag_memory_test"),
        title: "Memory Test Agent",
        agent: "meta",
        model: { id: "gpt-4", providerID: "openai", variant: "default" },
        time_created: now,
        time_updated: now,
      })
      .run()
    yield* db
      .insert(MetaAgentSessionTable)
      .values({
        meta_agent_id: MetaAgent.ID.descending("mag_memory_test"),
        session_id: sessionID,
        role: "orchestrator",
        time_created: now,
      })
      .run()
  }).pipe(
    Effect.provide(Database.layer({ path: path.join(directory, "memory.sqlite") }).pipe(Layer.provide(globalLayer))),
  )

const serviceIn = (directory: string) => {
  const database = Database.layer({ path: path.join(directory, "memory.sqlite") }).pipe(Layer.provide(globalLayer))
  const memory = MetaAgentMemory.layer.pipe(
    Layer.provide(MetaAgentService.layer.pipe(Layer.provide(SessionComposition.layer))),
    Layer.provide(database),
  )
  return { database, memory }
}

const controlled = (directory: string) =>
  Effect.gen(function* () {
    yield* attached(directory)
    const db = (yield* Database.Service).db
    const metaID = MetaAgent.ID.descending("mag_memory_current")
    yield* db
      .insert(MetaAgentTable)
      .values({
        id: metaID,
        title: "Current Memory Agent",
        agent: "meta",
        model: { id: "gpt-4", providerID: "openai", variant: "default" },
      })
      .run()
    yield* db
      .insert(MetaAgentSessionTable)
      .values({ meta_agent_id: metaID, session_id: sessionID, role: "orchestrator" })
      .run()
    yield* db
      .update(SessionTable)
      .set({
        agent: "meta",
        controller: new SessionSchema.RootController({ kind: "root", metaAgentID: metaID, rootSessionID: sessionID }),
      })
      .where(eq(SessionTable.id, sessionID))
      .run()
    return metaID
  }).pipe(
    Effect.provide(Database.layer({ path: path.join(directory, "memory.sqlite") }).pipe(Layer.provide(globalLayer))),
  )

describe("MetaAgentMemory", () => {
  it.live("rejects an ambiguous legacy writer without changing earlier facts or associations", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const metaID = yield* controlled(directory)
        const services = serviceIn(directory)
        return yield* Effect.gen(function* () {
          const memory = yield* MetaAgentMemory.Service
          const database = yield* Database.Service
          const id = yield* memory.record({ sessionID, projectID, factCategory: "api", content: "Earlier fact" })
          yield* database.db.update(SessionTable).set({ controller: null }).where(eq(SessionTable.id, sessionID)).run()
          const result = yield* memory
            .record({ sessionID, projectID, factCategory: "api", content: "Ambiguous fact" })
            .pipe(Effect.exit)
          expect(Option.getOrUndefined(Exit.findErrorOption(result))).toMatchObject({
            _tag: "MetaAgentMemory.AmbiguousOwnerError",
            sessionID,
          })
          expect(yield* memory.query({ projectID })).toMatchObject([
            { id, metaAgentID: metaID, content: "Earlier fact" },
          ])
          expect(
            yield* database.db
              .select()
              .from(MetaAgentSessionTable)
              .where(eq(MetaAgentSessionTable.session_id, sessionID))
              .all(),
          ).toHaveLength(2)
        }).pipe(Effect.provide(Layer.merge(services.database, services.memory)))
      }),
    ),
  )

  it.live("verifies provided source Sessions and rejects unknown references before insertion", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* attached(directory)
        const services = serviceIn(directory)
        return yield* Effect.gen(function* () {
          const memory = yield* MetaAgentMemory.Service
          const database = yield* Database.Service
          const sourceID = SessionSchema.ID.make("ses_memory_source")
          const foreignID = SessionSchema.ID.make("ses_memory_foreign")
          yield* database.db
            .insert(ProjectTable)
            .values({ id: otherProjectID, worktree: AbsolutePath.make(directory), sandboxes: [] })
            .run()
          yield* database.db
            .insert(SessionTable)
            .values(
              [sourceID, foreignID].map((id) => ({
                id,
                project_id: id === sourceID ? projectID : otherProjectID,
                directory: AbsolutePath.make(directory),
                title: "Source fixture",
                slug: id,
                version: "keeper",
              })),
            )
            .run()
          const id = yield* memory.record({
            sessionID,
            projectID,
            factCategory: "api",
            content: "Verifiable source",
            sourceSessionID: sourceID,
          })
          expect(yield* memory.query({ projectID })).toMatchObject([
            { id, sourceSessionID: sourceID, sourceStepID: undefined },
          ])
          yield* Effect.forEach(
            [
              { sourceSessionID: "ses_missing", reason: "session_missing" },
              { sourceSessionID: foreignID, reason: "project_mismatch" },
              { sourceStepID: "stp_missing", reason: "step_missing" },
              { sourceSessionID: "", reason: "session_missing" },
            ],
            (source) =>
              Effect.gen(function* () {
                const result = yield* memory
                  .record({ sessionID, projectID, factCategory: "api", content: "Invalid source", ...source })
                  .pipe(Effect.exit)
                expect(Option.getOrUndefined(Exit.findErrorOption(result))).toMatchObject({
                  _tag: "MetaAgentMemory.InvalidSourceError",
                  reason: source.reason,
                })
                expect((yield* memory.query({ projectID })).map((fact) => fact.id)).toEqual([id])
              }),
          )
        }).pipe(Effect.provide(Layer.merge(services.database, services.memory)))
      }),
    ),
  )
  it.live("limits optional project deletion atomically and retains legacy id-only deletion", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* attached(directory)
        return yield* Effect.gen(function* () {
          const service = yield* MetaAgentMemory.Service
          const foreign = yield* service.record({
            sessionID,
            projectID: otherProjectID,
            factCategory: "api",
            content: "foreign project fact",
          })
          const owned = yield* service.record({ sessionID, projectID, factCategory: "api", content: "owned fact" })
          yield* service.remove(foreign, projectID)
          expect((yield* service.query({ projectID: otherProjectID })).map((fact) => fact.id)).toEqual([foreign])
          yield* service.remove(owned, projectID)
          yield* service.remove(owned, projectID)
          yield* service.remove("missing", projectID)
          expect(yield* service.query({ projectID })).toEqual([])
          expect(yield* service.remove(foreign)).toBeUndefined()
          expect(yield* service.query({ projectID: otherProjectID })).toEqual([])
        }).pipe(Effect.provide(serviceIn(directory).memory))
      }),
    ),
  )
  it.live(
    "records a fact and returns a stable id",
    () =>
      withTmp((directory) =>
        Effect.gen(function* () {
          yield* attached(directory)
          const { memory } = serviceIn(directory)
          return yield* Effect.gen(function* () {
            const service = yield* MetaAgentMemory.Service
            const id = yield* service.record({
              sessionID,
              projectID,
              factCategory: "protocol",
              content: "Never run tests from the repo root",
            })
            expect(id).toBeDefined()
            const rows = yield* service.query({ projectID })
            expect(rows.length).toBe(1)
            expect(rows[0]).toMatchObject({
              id,
              projectID,
              factCategory: "protocol",
              content: "Never run tests from the repo root",
            })
            expect(rows[0].metaAgentID).toBe(MetaAgent.ID.descending("mag_memory_test"))
            return yield* Effect.void
          }).pipe(Effect.provide(memory))
        }),
      ),
    // Windows CI runners are slow: a memory-write I/O test flaked at bun's 5s default.
    10_000,
  )

  it.live("records using the controlled Meta owner when a legacy mapping was inserted first", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const metaID = yield* controlled(directory)
        const services = serviceIn(directory)
        return yield* Effect.gen(function* () {
          const memory = yield* MetaAgentMemory.Service
          const database = yield* Database.Service
          const id = yield* memory.record({ sessionID, projectID, factCategory: "api", content: "Current owner fact" })
          const records = yield* memory.query({ projectID })
          expect(records).toHaveLength(1)
          expect(records[0]).toMatchObject({ id, metaAgentID: metaID })
          expect(
            yield* database.db
              .select()
              .from(MetaAgentSessionTable)
              .where(eq(MetaAgentSessionTable.session_id, sessionID))
              .all(),
          ).toHaveLength(2)
        }).pipe(Effect.provide(Layer.merge(services.database, services.memory)))
      }),
    ),
  )
  ;["missing", "wrong role"].forEach((kind) => {
    it.live(`rejects a controlled Meta owner with a ${kind} association before recording`, () =>
      withTmp((directory) =>
        Effect.gen(function* () {
          const metaID = yield* controlled(directory)
          const services = serviceIn(directory)
          return yield* Effect.gen(function* () {
            const db = (yield* Database.Service).db
            yield* kind === "missing"
              ? db.delete(MetaAgentSessionTable).where(eq(MetaAgentSessionTable.meta_agent_id, metaID)).run()
              : db
                  .update(MetaAgentSessionTable)
                  .set({ role: "worker" })
                  .where(eq(MetaAgentSessionTable.meta_agent_id, metaID))
                  .run()
            const memory = yield* MetaAgentMemory.Service
            const result = yield* memory
              .record({ sessionID, projectID, factCategory: "api", content: "Invalid owner fact" })
              .pipe(Effect.exit)
            expect(Option.getOrUndefined(Exit.findErrorOption(result))).toBeInstanceOf(ControllerConflictError)
            expect(Option.getOrUndefined(Exit.findErrorOption(result))).toMatchObject({ kind: "meta_owner_invalid" })
            expect(yield* memory.query({ projectID })).toHaveLength(0)
          }).pipe(Effect.provide(Layer.merge(services.database, services.memory)))
        }),
      ),
    )
  })

  it.live("rejects a child memory record with an unverified actual subagent source", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const metaID = yield* controlled(directory)
        const services = serviceIn(directory)
        return yield* Effect.gen(function* () {
          const db = (yield* Database.Service).db
          const childID = SessionSchema.ID.make("ses_memory_unverified_child")
          yield* db
            .insert(SessionTable)
            .values({
              id: childID,
              project_id: projectID,
              parent_id: sessionID,
              directory: AbsolutePath.make(directory),
              title: "Unverified memory child",
              slug: childID,
              version: "keeper",
              agent: "build",
              model: { id: "gpt-4", providerID: "openai", variant: "default" },
              controller: Schema.decodeUnknownSync(SessionSchema.ChildController)({
                kind: "child",
                metaAgentID: metaID,
                rootSessionID: sessionID,
                executor: {
                  agent: "build",
                  model: { id: "gpt-4", providerID: "openai", variant: "default" },
                  source: "tool",
                },
                source: {
                  kind: "subagent",
                  assistantMessageID: "msg_memory_unverified",
                  toolCallID: "call_memory_unverified",
                },
              }),
            })
            .run()
          yield* db
            .insert(MetaAgentSessionTable)
            .values({ meta_agent_id: metaID, session_id: childID, role: "worker" })
            .run()
          const memory = yield* MetaAgentMemory.Service
          const result = yield* memory
            .record({ sessionID: childID, projectID, factCategory: "api", content: "Unverified child fact" })
            .pipe(Effect.exit)
          expect(Option.getOrUndefined(Exit.findErrorOption(result))).toBeInstanceOf(ControllerConflictError)
          expect(Option.getOrUndefined(Exit.findErrorOption(result))).toMatchObject({
            kind: "meta_child_source_invalid",
          })
          expect(yield* memory.query({ projectID })).toHaveLength(0)
        }).pipe(Effect.provide(Layer.merge(services.database, services.memory)))
      }),
    ),
  )

  it.live("rejects records for sessions without a meta agent mapping", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const { memory } = serviceIn(directory)
        return yield* Effect.gen(function* () {
          const service = yield* MetaAgentMemory.Service
          const result = yield* service
            .record({ sessionID, projectID, factCategory: "api", content: "x" })
            .pipe(Effect.exit)
          if (Exit.isFailure(result)) {
            const error = Cause.findErrorOption(result.cause).pipe(Option.getOrUndefined)
            expect(error).toBeInstanceOf(MetaAgentMemory.NotMetaSessionError)
          } else {
            expect.unreachable("record should fail for non-meta sessions")
          }
          return yield* Effect.void
        }).pipe(Effect.provide(memory))
      }),
    ),
  )

  it.live("queries filtered by fact category and ordered by update time", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* attached(directory)
        const { memory } = serviceIn(directory)
        return yield* Effect.gen(function* () {
          const service = yield* MetaAgentMemory.Service
          yield* service.record({ sessionID, projectID, factCategory: "api", content: "api fact" })
          yield* service.record({ sessionID, projectID, factCategory: "protocol", content: "protocol fact" })
          yield* service.record({ sessionID, projectID, factCategory: "api", content: "api fact 2" })
          const api = yield* service.query({ projectID, factCategory: "api" })
          expect(api.map((row) => row.content)).toEqual(["api fact", "api fact 2"])
          const all = yield* service.query({ projectID })
          expect(all.length).toBe(3)
          return yield* Effect.void
        }).pipe(Effect.provide(memory))
      }),
    ),
  )

  it.live("searches by keyword with LIKE", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* attached(directory)
        const { memory } = serviceIn(directory)
        return yield* Effect.gen(function* () {
          const service = yield* MetaAgentMemory.Service
          yield* service.record({
            sessionID,
            projectID,
            factCategory: "code_trap",
            content: "Compaction template must stay private",
          })
          yield* service.record({
            sessionID,
            projectID,
            factCategory: "workflow",
            content: "Run bun typecheck before push",
          })
          const hits = yield* service.search({ projectID, keyword: "typecheck" })
          expect(hits.length).toBe(1)
          expect(hits[0].content).toContain("typecheck")
          const none = yield* service.search({ projectID, keyword: "missing-term" })
          expect(none.length).toBe(0)
          return yield* Effect.void
        }).pipe(Effect.provide(memory))
      }),
    ),
  )

  it.live("isolates facts between projects", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* attached(directory)
        const { memory } = serviceIn(directory)
        return yield* Effect.gen(function* () {
          const service = yield* MetaAgentMemory.Service
          yield* service.record({ sessionID, projectID, factCategory: "api", content: "project-scoped fact" })
          yield* service.record({
            sessionID,
            projectID: otherProjectID,
            factCategory: "api",
            content: "project-scoped fact",
          })
          const rows = yield* service.query({ projectID })
          expect(rows.length).toBe(1)
          expect(rows[0].projectID).toBe(projectID)
          const others = yield* service.search({ projectID: otherProjectID, keyword: "project-scoped" })
          expect(others.length).toBe(1)
          expect(others[0].projectID).toBe(otherProjectID)
          return yield* Effect.void
        }).pipe(Effect.provide(memory))
      }),
    ),
  )

  it.live("rejects credential content before project fact insert", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* attached(directory)
        const memory = serviceIn(directory).memory
        return yield* Effect.gen(function* () {
          const service = yield* MetaAgentMemory.Service
          yield* Effect.forEach(
            [
              "sk-aaaaaaaaaaaaaaaaaaaaaaaa",
              "AKIAABCDEFGHIJKLMNOP",
              "Bearer MC03_PUBLIC_SENTINEL",
              "eyJMC03.public.fixture",
              "password=MC03_PUBLIC_SENTINEL",
              "secret=MC03_PUBLIC_SENTINEL",
              "token=MC03_PUBLIC_SENTINEL",
              "api_key=MC03_PUBLIC_SENTINEL",
            ],
            (content) =>
              Effect.gen(function* () {
                const result = yield* service
                  .record({ sessionID, projectID, factCategory: "api", content })
                  .pipe(Effect.exit)
                const rows = yield* service.query({ projectID })
                expect(rows.length).toBe(0)
                expect(Exit.isFailure(result)).toBe(true)
                const error = Exit.isFailure(result)
                  ? Cause.findErrorOption(result.cause).pipe(Option.getOrUndefined)
                  : undefined
                expect(error).toMatchObject({
                  _tag: "MetaAgentMemory.SensitiveContentError",
                  message: "Project memory facts cannot contain credential material.",
                })
              }),
          )
        }).pipe(Effect.provide(memory))
      }),
    ),
  )

  it.live("allows safe credential-file references while Correction retains source-path restrictions", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* attached(directory)
        const memory = serviceIn(directory).memory
        return yield* Effect.gen(function* () {
          const service = yield* MetaAgentMemory.Service
          const id = yield* service.record({
            sessionID,
            projectID,
            factCategory: "protocol",
            content: "Do not commit .env or auth.json files.",
          })
          expect(yield* service.query({ projectID })).toMatchObject([
            { id, content: "Do not commit .env or auth.json files." },
          ])
          expect(CorrectionExtractor.extractCorrections("should be ./safe not .env")).toEqual([])
          expect(CorrectionExtractor.extractCorrections("should be ./safe not auth.json")).toEqual([])
        }).pipe(Effect.provide(memory))
      }),
    ),
  )

  it.live("loads only the project's latest SQL-limited facts and rejects unsafe legacy copies", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* attached(directory)
        const memory = serviceIn(directory).memory
        const database = serviceIn(directory).database
        return yield* Effect.gen(function* () {
          const service = yield* MetaAgentMemory.Service
          const db = (yield* Database.Service).db
          const first = yield* service.record({ sessionID, projectID, factCategory: "workflow", content: "old fact" })
          const second = yield* service.record({
            sessionID,
            projectID,
            factCategory: "protocol",
            content: "latest data",
          })
          yield* db
            .update(MetaAgentMemoryTable)
            .set({ time_updated: 1 })
            .where(eq(MetaAgentMemoryTable.id, first))
            .run()
          yield* db
            .update(MetaAgentMemoryTable)
            .set({ time_updated: 2, source_session_id: "declared-session" })
            .where(eq(MetaAgentMemoryTable.id, second))
            .run()
          yield* service.record({ sessionID, projectID: otherProjectID, factCategory: "api", content: "other project" })
          expect(yield* service.latest({ projectID, topN: 1 })).toMatchObject([
            { id: second, projectID, metaAgentID: "mag_memory_test", sourceSessionID: "declared-session" },
          ])
          expect((yield* service.latest({ projectID, topN: 2 })).map((fact) => fact.id)).toEqual([second, first])
          expect((yield* service.query({ projectID })).map((fact) => fact.id)).toEqual([first, second])
          yield* Effect.forEach(
            [
              { content: "api_key=MC03_LEGACY_PUBLIC_FIXTURE", reason: "credential" },
              { content: "x".repeat(2001), reason: "content_length" },
            ] as const,
            (invalid) =>
              Effect.gen(function* () {
                yield* db
                  .update(MetaAgentMemoryTable)
                  .set({ content: invalid.content })
                  .where(eq(MetaAgentMemoryTable.id, second))
                  .run()
                const result = yield* service.latest({ projectID, topN: 2 }).pipe(Effect.exit)
                expect(Exit.isFailure(result)).toBe(true)
                const error = Exit.isFailure(result)
                  ? Cause.findErrorOption(result.cause).pipe(Option.getOrUndefined)
                  : undefined
                expect(error).toMatchObject({
                  _tag: "MetaAgentMemory.InvalidFactError",
                  id: second,
                  reason: invalid.reason,
                })
                expect(error?.message).not.toContain(invalid.content)
                const preserved = yield* service.query({ projectID })
                expect(preserved.find((fact) => fact.id === second)?.content).toBe(invalid.content)
              }),
          )
          yield* db
            .update(MetaAgentMemoryTable)
            .set({ content: "safe newest", time_updated: 2 })
            .where(eq(MetaAgentMemoryTable.id, second))
            .run()
          yield* db
            .update(MetaAgentMemoryTable)
            .set({ content: "api_key=MC03_OUTSIDE_LIMIT_PUBLIC", time_updated: 1 })
            .where(eq(MetaAgentMemoryTable.id, first))
            .run()
          expect(yield* service.latest({ projectID, topN: 1 })).toMatchObject([{ id: second, content: "safe newest" }])
          expect(yield* service.latest({ projectID, topN: 2 }).pipe(Effect.flip)).toMatchObject({
            id: first,
            reason: "credential",
          })
        }).pipe(Effect.provide(Layer.mergeAll(memory, database)))
      }),
    ),
  )

  it.live("preserves per-field memory settings precedence and the shared content codec", () =>
    Effect.sync(() => {
      expect(MetaAgentMemory.settings([])).toEqual({ enabled: false, topN: 10 })
      expect(
        MetaAgentMemory.settings([
          new Document({
            type: "document",
            info: Info.make({
              meta: ConfigMeta.Info.make({ memory: ConfigMeta.Memory.make({ enabled: true, top_n: 2 }) }),
            }),
          }),
          new Document({
            type: "document",
            info: Info.make({ meta: ConfigMeta.Info.make({ memory: ConfigMeta.Memory.make({ enabled: false }) }) }),
          }),
        ]),
      ).toEqual({ enabled: false, topN: 2 })
      expect(Schema.is(MetaAgentMemory.Content)("x".repeat(2000))).toBe(true)
      expect(Schema.is(MetaAgentMemory.Content)("x".repeat(2001))).toBe(false)
    }),
  )

  it.live("remove is idempotent and a duplicate id inserts once", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        yield* attached(directory)
        const { memory } = serviceIn(directory)
        return yield* Effect.gen(function* () {
          const service = yield* MetaAgentMemory.Service
          const id = yield* service.record({ sessionID, projectID, factCategory: "workflow", content: "first" })
          yield* service.remove(id)
          yield* service.remove(id)
          expect((yield* service.query({ projectID })).length).toBe(0)
          const id2 = yield* service.record({ id, sessionID, projectID, factCategory: "workflow", content: "second" })
          expect(id2).toBe(id)
          const rows = yield* service.query({ projectID })
          expect(rows.length).toBe(1)
          expect(rows[0].content).toBe("second")
          const repeated = yield* service.record({
            id,
            sessionID,
            projectID,
            factCategory: "workflow",
            content: "third",
          })
          expect(repeated).toBe(id)
          const unchanged = yield* service.query({ projectID })
          expect(unchanged).toHaveLength(1)
          expect(unchanged[0].content).toBe("second")
          return yield* Effect.void
        }).pipe(Effect.provide(memory))
      }),
    ),
  )
})
