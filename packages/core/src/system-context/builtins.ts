export * as SystemContextBuiltIns from "./builtins"

import { desc, eq } from "drizzle-orm"
import { DateTime, Effect, Layer, Option, Schema } from "effect"
import { Config } from "../config"
import { Database } from "../database/database"
import { Location } from "../location"
import { MetaAgentMemoryTable } from "../meta-agent/sql"
import { ProjectV2 } from "../project"
import { InstructionContext } from "../instruction-context"
import { SystemContext } from "./index"
import { SystemContextRegistry } from "./registry"

const DEFAULT_MEMORY_ENABLED = false
const DEFAULT_MEMORY_TOP_N = 10

const MemoryFact = Schema.Struct({
  factCategory: Schema.Literals(["code_trap", "protocol", "api", "workflow"]),
  content: Schema.String,
})
type MemoryFact = typeof MemoryFact.Type

type MemorySettings = {
  readonly enabled: boolean
  readonly topN: number
}

const memorySettings = (documents: readonly Config.Entry[]) => {
  const configured = documents
    .filter((entry): entry is Config.Document => entry.type === "document")
    .flatMap((entry) => (entry.info.meta?.memory ? [entry.info.meta.memory] : []))
  return configured.reduce<MemorySettings>(
    (result, current) => ({
      enabled: current.enabled ?? result.enabled,
      topN: current.top_n ?? result.topN,
    }),
    { enabled: DEFAULT_MEMORY_ENABLED, topN: DEFAULT_MEMORY_TOP_N },
  )}

const loadMemoryFacts = (
  db: Database.Interface["db"],
  projectID: ProjectV2.ID,
  topN: number,
): Effect.Effect<ReadonlyArray<MemoryFact>> =>
  db
    .select()
    .from(MetaAgentMemoryTable)
    .where(eq(MetaAgentMemoryTable.project_id, projectID))
    .orderBy(desc(MetaAgentMemoryTable.time_updated))
    .limit(topN)
    .all()
    .pipe(
      Effect.map((rows) =>
        rows.map((row) => ({ factCategory: row.fact_category, content: row.content })),
      ),
      Effect.orDie,
    )

const renderFacts = (facts: ReadonlyArray<MemoryFact>) =>
  facts.length === 0
    ? "No project memory facts recorded."
    : [
        "Facts recorded by meta agent sessions in this project:",
        ...facts.map((fact) => `- [${fact.factCategory}] ${fact.content}`),
      ].join("\n")

const builtIns = Layer.effectDiscard(
  Effect.gen(function* () {
    const location = yield* Location.Service
    const registry = yield* SystemContextRegistry.Service
    const environment = [
      "<env>",
      `  Working directory: ${location.directory}`,
      `  Workspace root folder: ${location.project.directory}`,
      `  Is directory a git repo: ${location.vcs?.type === "git" ? "yes" : "no"}`,
      `  Platform: ${process.platform}`,
      "</env>",
    ].join("\n")
    const context = SystemContext.combine([
      SystemContext.make({
        key: SystemContext.Key.make("core/environment"),
        codec: Schema.toCodecJson(Schema.String),
        load: Effect.succeed(environment),
        baseline: (environment) =>
          ["Here is some useful information about the environment you are running in:", environment].join("\n"),
        update: (_previous, environment) => ["The environment you are running in is now:", environment].join("\n"),
      }),
      SystemContext.make({
        key: SystemContext.Key.make("core/date"),
        codec: Schema.toCodecJson(Schema.String),
        load: DateTime.nowAsDate.pipe(Effect.map((date) => date.toDateString())),
        baseline: (date) => `Today's date: ${date}`,
        update: (_previous, date) => `Today's date is now: ${date}`,
      }),
    ])

    // Memory injection is opt-in and Database-dependent. Both are resolved
    // softly so an environment without Database or config degrades to the
    // existing baseline (zero cache impact) instead of blocking other sources.
    const memory = yield* Effect.gen(function* () {
      const db = yield* Effect.serviceOption(Database.Service)
      const config = yield* Effect.serviceOption(Config.Service)
      if (Option.isNone(db) || Option.isNone(config)) return undefined
      const configured = memorySettings(yield* config.value.entries())
      if (!configured.enabled) return undefined
      return SystemContext.make({
        key: SystemContext.Key.make("core/memory"),
        codec: Schema.toCodecJson(Schema.Array(MemoryFact)),
        load: loadMemoryFacts(db.value.db, location.project.id, configured.topN),
        baseline: (facts) => ["Facts from the project's persistent memory:", renderFacts(facts)].join("\n"),
        update: (_previous, facts) => ["Project memory facts are now:", renderFacts(facts)].join("\n"),
      })
    })

    yield* registry.register({ key: SystemContext.Key.make("core/builtins"), load: Effect.succeed(context) })
    if (memory !== undefined) {
      yield* registry.register({
        key: SystemContext.Key.make("core/memory"),
        load: Effect.succeed(SystemContext.combine([memory])),
      })
    }
  }),
)

export const builtInsLayer = builtIns.pipe(Layer.provideMerge(SystemContextRegistry.layer))

export const layer = Layer.mergeAll(builtIns, InstructionContext.layer).pipe(
  Layer.provideMerge(SystemContextRegistry.layer),
)

export const locationLayer = layer
