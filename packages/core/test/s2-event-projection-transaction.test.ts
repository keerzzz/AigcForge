import { describe, expect } from "bun:test"
import { Context, Effect, Layer, Schema } from "effect"
import { eq, sql } from "drizzle-orm"
import path from "path"
import { CompositionResolver } from "@aigcfroge/core/composition-resolver"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { EventTable } from "@aigcfroge/core/event/sql"
import { Location } from "@aigcfroge/core/location"
import { ProjectV2 } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { SessionContextEpoch } from "@aigcfroge/core/session/context-epoch"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionStore } from "@aigcfroge/core/session/store"
import { SessionCompositionSnapshotTable, SessionContextEpochTable, SessionTable } from "@aigcfroge/core/session/sql"
import { SystemContext } from "@aigcfroge/core/system-context/index"
import { WorkflowRun } from "@aigcfroge/core/workflow/workflow-run"
import { WorkflowRunTable } from "@aigcfroge/core/workflow/sql"
import { Composition } from "@aigcfroge/schema/composition"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { withCustomModeEnabled } from "./lib/product-mode"

withCustomModeEnabled()

const mockDigest = Composition.Digest.make("1".repeat(64))
const mockRevision = Composition.Revision.make("2".repeat(64))
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })

const makeSnapshot = (sessionID: SessionV2.ID) =>
  new Composition.SnapshotV1({
    version: 1,
    digest: mockDigest,
    sessionID,
    createdAt: 1,
    data: new Composition.SnapshotDataV1({
      agentID: "code-reviewer",
      instructions: [],
      prompts: [],
      skills: [],
      tools: new Composition.SnapshotToolInfo({ fingerprints: [], catalogDigest: mockDigest, catalog: [] }),
    }),
  })

const compositionInput = new Composition.TemporaryInput({
  source: "temporary",
  agents: [
    new Composition.AgentRef({ kind: "agent", relativePath: "agents/code-reviewer.md", revision: mockRevision }),
  ],
  bindings: {},
  presentation: "native",
  requestedCapabilities: [],
})

const contextSource = (value: string) =>
  SystemContext.make({
    key: SystemContext.Key.make("test/context"),
    codec: Schema.String,
    load: Effect.succeed(value),
    baseline: (current) => current,
    update: (_previous, current) => current,
  })

const workflow = new Composition.WorkflowInfo({
  name: "transaction-regression",
  description: "Event projection transaction regression",
  relativePath: "transaction-regression.yaml",
  revision: mockRevision,
  steps: [new WorkflowAsset.StepDef({ id: "step", name: "Step", agent: "code-reviewer", next: "END" })],
})

const seedSession = (db: Database.Interface["db"], sessionID: SessionV2.ID, mode: "coding" | "custom" = "coding") =>
  Effect.gen(function* () {
    yield* db
      .insert(ProjectTable)
      .values({ id: ProjectV2.ID.global, worktree: location.directory, sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: ProjectV2.ID.global,
        slug: sessionID,
        directory: location.directory,
        title: "Transaction regression",
        mode,
        version: "test",
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
  })

const runInIndependentDomains = <A, E>(
  file: string,
  use: (services: {
    primary: Context.Context<Database.Service | EventV2.Service>
    secondary: Context.Context<Database.Service | WorkflowRun.Service | SessionV2.Service>
  }) => Effect.Effect<A, E>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const primaryDatabase = Database.layerFromPath(file)
      const secondaryDatabase = Database.layerFromPath(file)
      const primaryEvents = EventV2.layer.pipe(Layer.provide(primaryDatabase))
      const primary = yield* Layer.build(
        Layer.mergeAll(
          primaryDatabase,
          primaryEvents,
          SessionProjector.layer.pipe(Layer.provide(primaryDatabase), Layer.provide(primaryEvents)),
        ),
      )
      const secondaryEvents = EventV2.layer.pipe(Layer.provide(primaryDatabase))
      const secondaryStore = SessionStore.layer.pipe(Layer.provide(secondaryDatabase))
      const secondaryComposition = SessionComposition.layer.pipe(Layer.provide(secondaryDatabase))
      const secondaryProject = Layer.mock(ProjectV2.Service, {
        resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
      })
      const resolver = Layer.mock(CompositionResolver.Service, {
        freeze: (input) => Effect.succeed(makeSnapshot(SessionV2.ID.make(input.sessionID ?? "ses_missing"))),
      })
      const secondarySessions = SessionV2.layer.pipe(
        Layer.provide(secondaryDatabase),
        Layer.provide(secondaryEvents),
        Layer.provide(secondaryStore),
        Layer.provide(secondaryComposition),
        Layer.provide(secondaryProject),
        Layer.provide(SessionExecution.noopLayer),
        Layer.provide(resolver),
      )
      const secondary = yield* Layer.build(
        Layer.mergeAll(
          secondaryDatabase,
          WorkflowRun.layer.pipe(Layer.provide(secondaryDatabase), Layer.provide(secondaryEvents)),
          secondaryStore,
          secondaryComposition,
          secondaryProject,
          resolver,
          SessionExecution.noopLayer,
          secondarySessions,
        ),
      )
      yield* Context.get(primary, Database.Service).db.run(sql`PRAGMA busy_timeout = 500`)
      yield* Context.get(secondary, Database.Service).db.run(sql`PRAGMA busy_timeout = 500`)
      return yield* use({ primary, secondary })
    }),
  )

const it = testEffect(Layer.empty)

describe("EventV2 projection transaction handle", () => {
  it.live("commits WorkflowRun through EventV2's transaction across independent build domains", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => tmpdir()).pipe(
        Effect.flatMap((tmp) =>
          runInIndependentDomains(path.join(tmp.path, "workflow.sqlite"), ({ secondary }) =>
            Effect.gen(function* () {
              const service = Context.get(secondary, WorkflowRun.Service)
              const db = Context.get(secondary, Database.Service).db
              const sessionID = SessionV2.ID.make("ses_tx_workflow")
              yield* seedSession(db, sessionID)
              const run = yield* service.getOrCreate({
                sessionID,
                workflow,
                requestID: "request-tx-workflow",
              })
              expect(run.status).toBe("pending")
              expect(
                yield* Context.get(secondary, Database.Service).db.select().from(WorkflowRunTable).all(),
              ).toHaveLength(1)
            }),
          ).pipe(Effect.ensuring(Effect.promise(() => tmp[Symbol.asyncDispose]()))),
        ),
      )
    }),
  )

  it.live("advances a context epoch through EventV2's transaction across independent build domains", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => tmpdir()).pipe(
        Effect.flatMap((tmp) =>
          runInIndependentDomains(path.join(tmp.path, "context.sqlite"), ({ primary, secondary }) =>
            Effect.gen(function* () {
              const db = Context.get(secondary, Database.Service).db
              const events = Context.get(primary, EventV2.Service)
              const sessionID = SessionV2.ID.make("ses_tx_context")
              yield* seedSession(db, sessionID)
              yield* SessionContextEpoch.initialize(db, Effect.succeed(contextSource("before")), sessionID)
              yield* SessionContextEpoch.prepare(db, events, Effect.succeed(contextSource("after")), sessionID)
              expect(
                yield* db
                  .select({ snapshot: SessionContextEpochTable.snapshot })
                  .from(SessionContextEpochTable)
                  .where(eq(SessionContextEpochTable.session_id, sessionID))
                  .get(),
              ).toMatchObject({ snapshot: { "test/context": { value: "after" } } })
            }),
          ).pipe(Effect.ensuring(Effect.promise(() => tmp[Symbol.asyncDispose]()))),
        ),
      )
    }),
  )

  it.live("creates a custom session and snapshot through one EventV2 transaction", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => tmpdir()).pipe(
        Effect.flatMap((tmp) =>
          runInIndependentDomains(path.join(tmp.path, "custom.sqlite"), ({ secondary }) =>
            Effect.gen(function* () {
              const sessions = Context.get(secondary, SessionV2.Service)
              const db = Context.get(secondary, Database.Service).db
              const sessionID = SessionV2.ID.make("ses_tx_custom")
              const created = yield* sessions
                .createCustom({
                  id: sessionID,
                  location,
                  composition: compositionInput,
                })
                .pipe(Effect.provide(secondary))
              expect(created.session.id).toBe(sessionID)
              expect(
                yield* db
                  .select()
                  .from(SessionCompositionSnapshotTable)
                  .where(eq(SessionCompositionSnapshotTable.session_id, sessionID))
                  .get(),
              ).toBeDefined()
              expect(
                yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, sessionID)).all(),
              ).toHaveLength(1)
            }),
          ).pipe(Effect.ensuring(Effect.promise(() => tmp[Symbol.asyncDispose]()))),
        ),
      )
    }),
  )
})
