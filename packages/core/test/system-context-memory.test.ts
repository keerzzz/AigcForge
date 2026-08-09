import { describe, expect } from "bun:test"
import { DateTime, Effect, Layer } from "effect"
import path from "path"
import { CacheShape } from "../src/cache/cache-shape"
import { Config } from "../src/config"
import { ConfigMeta } from "../src/config/meta"
import { Database } from "../src/database/database"
import { Location } from "../src/location"
import { MetaAgent } from "@aigcfroge/schema/meta-agent"
import { MetaAgentMemoryTable, MetaAgentTable } from "../src/meta-agent/sql"
import { ProjectV2 } from "../src/project"
import { AbsolutePath } from "../src/schema"
import { SystemContext } from "../src/system-context/index"
import { SystemContextRegistry } from "../src/system-context/registry"
import { SystemContextBuiltIns } from "../src/system-context/builtins"
import { it } from "./lib/effect"
import { tmpdir } from "./fixture/tmpdir"

function withTmp<A, E, R>(f: (directory: string) => Effect.Effect<A, E, R>) {
  return Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => f(tmp.path)))
}

const projectID = ProjectV2.ID.make("proj_system_context_memory")

const locationLayer = (directory: string) =>
  Layer.succeed(
    Location.Service,
    Location.Service.of({
      directory: AbsolutePath.make(directory),
      project: { id: projectID, directory: AbsolutePath.make(directory) },
    }),
  )

const memoryConfig = (memory: { enabled?: boolean; top_n?: number }) =>
  Layer.succeed(
    Config.Service,
    Config.Service.of({
      entries: () =>
        Effect.succeed([
          new Config.Document({
            type: "document",
            info: Config.Info.make({ meta: ConfigMeta.Info.make({ memory: ConfigMeta.Memory.make(memory) }) }),
          }),
        ]),
    }),
  )

const loadBaseline = (directory: string, extra: Layer.Layer<never, never, never>) => {
  const builtins = SystemContextBuiltIns.builtInsLayer.pipe(Layer.provide(locationLayer(directory)))
  return Effect.gen(function* () {
    const registry = yield* SystemContextRegistry.Service
    const combined = yield* registry.load()
    const generation = yield* SystemContext.initialize(combined)
    return generation.baseline
  }).pipe(Effect.provide(Layer.mergeAll(SystemContextRegistry.layer, builtins).pipe(Layer.provide(extra))))
}

const insertFact = (directory: string, input: {
  id: string
  projectID: ProjectV2.ID
  factCategory: "code_trap" | "protocol" | "api" | "workflow"
  content: string
  time: number
}) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(MetaAgentTable)
      .values({
        id: MetaAgent.ID.descending("mag_ctx"),
        title: "Context Memory Agent",
        agent: "meta",
        model: { id: "gpt-4", providerID: "openai", variant: "default" },
        time_created: input.time,
        time_updated: input.time,
      })
      .onConflictDoNothing()
      .run()
    yield* db
      .insert(MetaAgentMemoryTable)
      .values({
        id: input.id,
        project_id: input.projectID,
        meta_agent_id: MetaAgent.ID.descending("mag_ctx"),
        fact_category: input.factCategory,
        content: input.content,
        time_created: input.time,
        time_updated: input.time,
      })
      .run()
  })

describe("SystemContext memory source", () => {
  it.live("stays byte-identical to the current baseline when memory is disabled", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const database = Database.layerFromPath(path.join(directory, "memory.sqlite"))
        yield* insertFact(directory, {
          id: "mem_ctx_1",
          projectID,
          factCategory: "protocol",
          content: "should not leak into the disabled baseline",
          time: 1,
        }).pipe(Effect.provide(database))

        const disabledWithData = yield* loadBaseline(directory, Layer.mergeAll(database, memoryConfig({ enabled: false })))
        const defaults = yield* loadBaseline(directory, database)
        expect(disabledWithData).toBe(defaults)
        expect(disabledWithData).not.toContain("should not leak")
        expect(CacheShape.capture(disabledWithData, [], 0).prefixHash).toBe(CacheShape.capture(defaults, [], 0).prefixHash)
      }),
    ),
  )

  it.live("injects TOP-N facts ordered by update time when enabled", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const database = Database.layerFromPath(path.join(directory, "memory.sqlite"))
        const base = DateTime.toEpochMillis(yield* DateTime.now)
        yield* Effect.all(
          [
            insertFact(directory, { id: "mem_ctx_1", projectID, factCategory: "api", content: "oldest fact", time: base - 2000 }),
            insertFact(directory, { id: "mem_ctx_2", projectID, factCategory: "protocol", content: "middle fact", time: base - 1000 }),
            insertFact(directory, { id: "mem_ctx_3", projectID, factCategory: "workflow", content: "newest fact", time: base }),
          ].map((effect) => effect.pipe(Effect.provide(database))),
        )

        const baseline = yield* loadBaseline(directory, Layer.mergeAll(database, memoryConfig({ enabled: true })))
        const newest = baseline.indexOf("newest fact")
        const middle = baseline.indexOf("middle fact")
        const oldest = baseline.indexOf("oldest fact")
        expect(newest).toBeGreaterThan(-1)
        expect(middle).toBeGreaterThan(-1)
        expect(oldest).toBeGreaterThan(-1)
        expect(newest).toBeLessThan(middle)
        expect(middle).toBeLessThan(oldest)
      }),
    ),
  )

  it.live("limits the injected facts to the configured top_n", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const database = Database.layerFromPath(path.join(directory, "memory.sqlite"))
        yield* Effect.all(
          [0, 1, 2].map((i) =>
            insertFact(directory, {
              id: `mem_ctx_top_${i}`,
              projectID,
              factCategory: "api",
              content: `fact ${i}`,
              time: 1000 + i,
            }).pipe(Effect.provide(database)),
          ),
        )

        const baseline = yield* loadBaseline(directory, Layer.mergeAll(database, memoryConfig({ enabled: true, top_n: 2 })))
        expect(baseline).toContain("fact 2")
        expect(baseline).toContain("fact 1")
        expect(baseline).not.toContain("fact 0")
      }),
    ),
  )

  it.live("loads other sources without a Database service", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const baseline = yield* loadBaseline(directory, memoryConfig({ enabled: true }))
        expect(baseline).toContain("Working directory")
        expect(baseline).not.toContain("persistent memory")
      }),
    ),
  )

  it.live("ignores memory rows from other projects", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const database = Database.layerFromPath(path.join(directory, "memory.sqlite"))
        yield* insertFact(directory, {
          id: "mem_ctx_other",
          projectID: ProjectV2.ID.make("proj_other"),
          factCategory: "protocol",
          content: "other project fact",
          time: 1,
        }).pipe(Effect.provide(database))

        const baseline = yield* loadBaseline(directory, Layer.mergeAll(database, memoryConfig({ enabled: true })))
        expect(baseline).not.toContain("other project fact")
      }),
    ),
  )
})
