import { describe, expect } from "bun:test"
import { Cause, DateTime, Effect, Exit, Layer, Option } from "effect"
import path from "path"
import { MetaAgent } from "@aigcfroge/schema/meta-agent"
import { MetaAgentMemory } from "../src/agent/meta/memory"
import { Database } from "../src/database/database"
import { MetaAgentService } from "../src/meta-agent/service"
import { MetaAgentSessionTable, MetaAgentTable } from "../src/meta-agent/sql"
import { ProjectTable } from "../src/project/sql"
import { ProjectV2 } from "../src/project"
import { AbsolutePath } from "../src/schema"
import { SessionSchema } from "../src/session/schema"
import { SessionTable } from "../src/session/sql"
import { it } from "./lib/effect"
import { tmpdir } from "./fixture/tmpdir"

const sessionID = SessionSchema.ID.make("ses_memory")
const projectID = ProjectV2.ID.make("proj_memory")
const otherProjectID = ProjectV2.ID.make("proj_other")

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
  }).pipe(Effect.provide(Database.layerFromPath(path.join(directory, "memory.sqlite"))))

const serviceIn = (directory: string) => {
  const database = Database.layerFromPath(path.join(directory, "memory.sqlite"))
  const memory = MetaAgentMemory.layer.pipe(Layer.provide(MetaAgentService.layer), Layer.provide(database))
  return { database, memory }
}

describe("MetaAgentMemory", () => {
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
          return yield* Effect.void
        }).pipe(Effect.provide(memory))
      }),
    ),
  )
})
