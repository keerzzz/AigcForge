import { describe, expect } from "bun:test"
import path from "path"
import { rm } from "node:fs/promises"
import { Context, Deferred, Effect, Fiber, Layer, Option, Schema, Scope, Stream, Struct } from "effect"
import { eq } from "drizzle-orm"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { makeGlobalNode, makeLocationNode } from "@aigcfroge/util/effect/app-node"
import { Agent } from "@aigcfroge/core/agent"
import { Bus } from "@aigcfroge/core/bus"
import { CompositionResolver } from "@aigcfroge/core/composition-resolver"
import { CompositionDigest } from "@aigcfroge/core/composition/digest"
import { Config } from "@aigcfroge/core/config"
import { Database } from "@aigcfroge/core/database/database"
import { DelegationService } from "@aigcfroge/core/delegation/service"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { EventSequenceTable, EventTable } from "@aigcfroge/core/event/sql"
import { Location } from "@aigcfroge/core/location"
import { MetaAgentSessionTable, MetaAgentTable } from "@aigcfroge/core/meta-agent/sql"
import { Model } from "@aigcfroge/core/model"
import { Plugin } from "@aigcfroge/core/plugin"
import { Project } from "@aigcfroge/core/project"
import { Provider } from "@aigcfroge/core/provider"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Session } from "@aigcfroge/core/session"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { SessionEvent } from "@aigcfroge/core/session/event"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionErrors } from "@aigcfroge/core/session/error"
import { SessionInbox } from "@aigcfroge/core/session/inbox"
import { SessionSchema } from "@aigcfroge/core/session/schema"
import { SessionCompositionSnapshotTable, SessionTable } from "@aigcfroge/core/session/sql"
import { SessionStore } from "@aigcfroge/core/session/store"
import { Skill } from "@aigcfroge/core/skill"
import { Composition } from "@aigcfroge/schema/composition"
import { CustomProfile } from "@aigcfroge/schema/custom-profile"
import { Workspace } from "@aigcfroge/schema/workspace"
import { Hash } from "@aigcfroge/util/hash"
import { AssetYaml } from "@aigcfroge/core/util/asset-yaml"
import { offlineModels, useOfflineCatalog } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { CompositionFixture } from "./lib/composition"
import { awaitWithTimeout, testEffect } from "./lib/effect"
import { withCustomMode } from "./lib/product-mode"
import { globalProjectNode } from "./lib/project"

const makeFixture = () => ({
  snapshots: new Map<string, Composition.SnapshotV2>(),
  profiles: new Map<string, string>(),
  freezes: new Array<Composition.FreezeInput>(),
  beforeFreeze: new Array<Effect.Effect<void>>(),
  beforeProjectResolve: new Map<string, Effect.Effect<void>>(),
  active: new Set<Session.ID>(),
})

class Fixture extends Context.Service<Fixture, ReturnType<typeof makeFixture>>()("test/SessionCustomLifecycle") {}
// Location builds use their own local cache. A global graph dependency keeps
// resolver, execution, and test setup on one fixture within each test Scope.
const fixtureNode = makeGlobalNode({
  service: Fixture,
  layer: Layer.effect(Fixture, Effect.sync(makeFixture)),
  deps: [],
})

const projectNode = makeGlobalNode({
  service: Project.Service,
  layer: Layer.effect(
    Project.Service,
    Effect.gen(function* () {
      const project = yield* Project.Service
      const fixture = yield* Fixture
      return Project.Service.of({
        ...project,
        resolve: Effect.fn("SessionCustomLifecycle.resolveProject")(function* (directory) {
          const beforeResolve = fixture.beforeProjectResolve.get(directory)
          if (beforeResolve) yield* beforeResolve
          return yield* project.resolve(directory)
        }),
      })
    }),
  ),
  deps: [globalProjectNode, fixtureNode],
})

// Freeze and execution activity use fixtures. Session, Bus, projectors, snapshot
// storage, dependency validation, and canonical executor selection stay real.
const resolverLayer = Layer.effect(
  CompositionResolver.Service,
  Effect.gen(function* () {
    const fixture = yield* Fixture
    return CompositionResolver.Service.of({
      resolve: () => Effect.die(new Error("Lifecycle tests freeze directly")),
      checkHealth: () => Effect.die(new Error("Lifecycle tests do not query asset health")),
      freeze: Effect.fn("SessionCustomLifecycle.freeze")(function* (input) {
        fixture.freezes.push(input)
        yield* Effect.forEach(fixture.beforeFreeze, (effect) => effect, { discard: true })
        if (input.input.source === "profile") {
          const file = fixture.profiles.get(input.input.profilePath)
          if (file === undefined || !(yield* Effect.promise(() => Bun.file(file).exists())))
            return yield* new Composition.ResolveError({ code: "profile_missing", message: "Profile was deleted" })
        }
        const snapshot = fixture.snapshots.get("seed")
        if (!snapshot) return yield* Effect.die(new Error("Missing lifecycle snapshot fixture"))
        return new Composition.SnapshotV2({
          ...snapshot,
          sessionID: input.sessionID,
          digest: CompositionDigest.computeCompositionDigest(input.input),
          profilePath: input.input.source === "profile" ? input.input.profilePath : undefined,
          profileRevision: input.input.source === "profile" ? input.input.profileRevision : undefined,
        })
      }),
    })
  }),
)

const executionLayer = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const fixture = yield* Fixture
    return SessionExecution.Service.of({
      active: Effect.sync(() => new Set(fixture.active)),
      isActive: (sessionID) => Effect.sync(() => fixture.active.has(sessionID)),
      resume: () => Effect.void,
      wake: () => Effect.void,
      interrupt: () => Effect.succeed(false),
      awaitIdle: () => Effect.void,
    })
  }),
)

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      Session.node,
      SessionStore.node,
      SessionComposition.node,
      DelegationService.node,
      fixtureNode,
    ]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      Project.node.replace(projectNode),
      Config.node.replace(Config.configured({ project: false, global: false })),
      CompositionResolver.node.replace(
        makeLocationNode({ service: CompositionResolver.Service, layer: resolverLayer, deps: [fixtureNode] }),
      ),
      SessionExecution.node.replace(
        makeGlobalNode({ service: SessionExecution.Service, layer: executionLayer, deps: [fixtureNode] }),
      ),
      offlineModels,
    ],
  ),
)

const executor = Agent.Info.make({
  ...Agent.Info.empty(Agent.ID.make("asset_coder")),
  name: Agent.Name.make("coder"),
  system: "Use the frozen implementation policy.",
  permissions: [{ action: "read", resource: "*", effect: "allow" }],
})

const setup = Effect.gen(function* () {
  const tmp = yield* tmpdirScoped()
  const location = Location.Ref.make({ directory: AbsolutePath.make(tmp.path) })
  const fixture = yield* Fixture
  const scope = yield* Scope.Scope
  const model = Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("meta") })
  fixture.beforeFreeze.push(
    Effect.gen(function* () {
      yield* useOfflineCatalog([
        {
          info: Provider.Info.make({
            ...Provider.Info.empty(model.providerID),
            activation: "enabled",
            package: "@aigcfroge/ai/providers/openai/responses",
          }),
          models: [model, Model.Ref.parse("test/new-model")].map((ref) =>
            Model.Info.make(Model.Info.default(ref.providerID, ref.id)),
          ),
        },
      ]).pipe(
        Effect.provideService(Provider.Service, Option.getOrThrow(yield* Effect.serviceOption(Provider.Service))),
        Effect.provideService(Plugin.Service, Option.getOrThrow(yield* Effect.serviceOption(Plugin.Service))),
      )
      const models = Option.getOrThrow(yield* Effect.serviceOption(Model.Service))
      yield* models.transform((editor) => editor.default.set(model.providerID, model.id))
    }).pipe(Effect.provideService(Scope.Scope, scope)),
  )
  const session = yield* Session.Service
  const compositions = yield* SessionComposition.Service
  const delegations = yield* DelegationService.Service
  const database = yield* Database.Service
  const bus = yield* Bus.Service
  const seed = yield* session.create({ location })
  const snapshot = yield* CompositionFixture.attach(seed.id, executor)
  fixture.snapshots.set("seed", snapshot)
  yield* database.db.delete(SessionTable).where(eq(SessionTable.id, seed.id)).run().pipe(Effect.orDie)
  yield* bus.remove(seed.id)
  const composition = new Composition.TemporaryInput({
    source: "temporary",
    agents: snapshot.data.agents.map(
      (agent) =>
        new Composition.AgentRef({ kind: "agent", relativePath: agent.relativePath, revision: agent.revision }),
    ),
    bindings: {},
    presentation: "native",
    requestedCapabilities: [],
  })
  return { fixture, session, compositions, delegations, database, bus, location, composition, model }
})

const events = (session: Session.Interface, sessionID: Session.ID) =>
  session.log({ sessionID }).pipe(
    Stream.filter((event): event is SessionEvent.DurableEvent => !Bus.isSynced(event)),
    Stream.runCollect,
  )

describe("Session Custom lifecycle", () => {
  for (const id of ["build", "plan", "asset-root"] as const) {
    for (const source of ["temporary", "profile"] as const) {
      it.live(
        `adopts and forks the ${source} ${id === "asset-root" ? "asset" : "builtin"} ${id} root, keeps exact retry identity and rejects Meta control`,
        () =>
          withCustomMode(
            "true",
            Effect.gen(function* () {
              const f = yield* setup
              const seed = f.fixture.snapshots.get("seed")
              if (!seed) throw new Error("Expected the lifecycle snapshot")
              const info = Agent.Info.make({
                ...Agent.Info.default(Agent.ID.make(id)),
                name: Agent.Name.make(id === "asset-root" ? id : id === "build" ? "Build" : "Plan"),
                mode: id === "build" ? "all" : "primary",
                system: `Adopt the frozen ${id} definition.`,
                ...(id === "asset-root"
                  ? { originRelativePath: "root.md", originRevision: Composition.Revision.make("a".repeat(64)) }
                  : {}),
              })
              const root =
                id === "asset-root"
                  ? new Composition.AssetRoot({
                      source: "asset",
                      id: info.id,
                      kind: "agent",
                      relativePath: "root.md",
                      revision: Composition.Revision.make("a".repeat(64)),
                    })
                  : new Composition.BuiltinRoot({
                      source: "builtin",
                      id,
                      revision: Composition.Revision.make(
                        CompositionDigest.computeDigest(Schema.encodeSync(Agent.Info)(info)),
                      ),
                    })
              const snapshot = new Composition.SnapshotV2({
                ...seed,
                data: new Composition.SnapshotDataV2({
                  ...seed.data,
                  sourceLocation: f.location,
                  root,
                  orchestrator: info,
                  agents: [],
                  executors: [],
                  bindings: {
                    orchestrator: new Composition.SnapshotBindingData({
                      instructions: [],
                      prompts: [],
                      skills: [],
                      commands: [],
                    }),
                  },
                }),
              })
              f.fixture.snapshots.set("seed", snapshot)
              const relativePath = `${id}-profile.yaml`
              const file = path.join(f.location.directory, relativePath)
              const profileYaml = AssetYaml.stringify(
                Schema.encodeSync(CustomProfile.Profile)(
                  new CustomProfile.Profile({
                    kind: "custom-profile",
                    name: CustomProfile.Name.make(`${id} Profile`),
                    description: CustomProfile.Description.make("Frozen Profile adoption"),
                    root,
                    agents: [],
                    bindings: {},
                    presentation: "native",
                    requestedCapabilities: [],
                  }),
                ),
              )
              if (source === "profile") {
                yield* Effect.promise(() => Bun.write(file, profileYaml))
                f.fixture.profiles.set(relativePath, file)
              }
              const composition =
                source === "temporary"
                  ? new Composition.TemporaryInput({ ...f.composition, root, agents: [], bindings: {} })
                  : new Composition.ProfileInput({
                      source: "profile",
                      profilePath: relativePath,
                      profileRevision: Composition.Revision.make(Hash.sha256(profileYaml)),
                    })
              const input = {
                id: Session.ID.create(),
                location: f.location,
                composition,
                expectedPlanDigest: CompositionDigest.computeCompositionDigest(composition),
              }
              expect((yield* f.session.list()).data).toEqual([])
              const created = yield* f.session.createCustom(input)
              expect(created.session.agent).toBe(info.id)
              expect(created.session.model).toBeUndefined()
              expect(created.session.controller).toBeUndefined()
              expect(created.snapshot.data).toEqual(snapshot.data)
              expect(created.snapshot.profilePath).toBe(source === "profile" ? relativePath : undefined)
              expect(created.snapshot.profileRevision).toBe(
                source === "profile" ? Composition.Revision.make(Hash.sha256(profileYaml)) : undefined,
              )
              expect(
                yield* f.database.db
                  .select()
                  .from(MetaAgentSessionTable)
                  .where(eq(MetaAgentSessionTable.session_id, created.session.id))
                  .all(),
              ).toEqual([])
              f.fixture.snapshots.set(
                "seed",
                new Composition.SnapshotV2({
                  ...snapshot,
                  data: new Composition.SnapshotDataV2({
                    ...snapshot.data,
                    orchestrator: Agent.Info.make({ ...info, system: "A later definition." }),
                  }),
                }),
              )
              if (source === "profile") yield* Effect.promise(() => rm(file))
              const retried = yield* f.session.createCustom({
                ...input,
                location: Location.Ref.make({
                  ...f.location,
                  directory: AbsolutePath.make(`${f.location.directory}/.`),
                }),
              })
              // Plan reminders may update activity while an exact retry preserves adoption identity.
              expect(Struct.omit(retried.session, ["time"])).toEqual(Struct.omit(created.session, ["time"]))
              expect(retried.snapshot).toEqual(created.snapshot)
              expect((yield* f.compositions.assertDependency(created.session.id)).profileRevision).toBe(
                created.snapshot.profileRevision,
              )
              expect(yield* f.session.get(created.session.id)).toMatchObject({
                agent: info.id,
                controller: undefined,
                location: f.location,
              })
              expect(f.fixture.freezes).toHaveLength(1)
              if (composition.source === "profile") {
                expect(
                  yield* f.session
                    .createCustom({
                      ...input,
                      composition: new Composition.ProfileInput({
                        ...composition,
                        profileRevision: Composition.Revision.make("f".repeat(64)),
                      }),
                    })
                    .pipe(Effect.flip),
                ).toMatchObject({ reason: "composition_input_mismatch" })
                expect(f.fixture.freezes).toHaveLength(1)
              }
              yield* f.session.prompt({ sessionID: created.session.id, text: "First explicit input", resume: false })
              yield* SessionInbox.promote(f.database.db, f.bus, created.session.id, "steer")
              const forked = yield* f.session.fork({ sessionID: created.session.id })
              expect(forked.agent).toBe(info.id)
              expect(forked.controller).toBeUndefined()
              const inherited = yield* f.compositions.get(forked.id)
              expect(inherited.data).toEqual(snapshot.data)
              expect(inherited.profilePath).toBe(created.snapshot.profilePath)
              expect(inherited.profileRevision).toBe(created.snapshot.profileRevision)
              expect(f.fixture.freezes).toHaveLength(1)
              const stored = Effect.all({
                // Plan reminders enqueue asynchronously and update this activity timestamp.
                sessions: f.database.db
                  .select()
                  .from(SessionTable)
                  .all()
                  .pipe(Effect.map((rows) => rows.map((row) => Struct.omit(row, ["time_updated"])))),
                snapshots: f.database.db.select().from(SessionCompositionSnapshotTable).all(),
                metas: f.database.db.select().from(MetaAgentTable).all(),
                associations: f.database.db.select().from(MetaAgentSessionTable).all(),
              })
              const before = yield* stored
              yield* Effect.forEach(
                [
                  Location.Ref.make({
                    ...f.location,
                    directory: AbsolutePath.make(path.join(f.location.directory, "other")),
                  }),
                  Location.Ref.make({ ...f.location, workspaceID: Workspace.ID.create() }),
                ],
                (location) =>
                  Effect.gen(function* () {
                    expect(yield* f.session.createCustom({ ...input, location }).pipe(Effect.flip)).toMatchObject({
                      _tag: "Session.CompositionConflictError",
                      reason: "composition_source_mismatch",
                    })
                    expect(f.fixture.freezes).toHaveLength(1)
                    expect(yield* stored).toEqual(before)
                  }),
                { discard: true },
              )
              const rejected = yield* f.session
                .fork({
                  id: Session.ID.create(),
                  sessionID: created.session.id,
                  control: "meta",
                  model: f.model,
                  expectedSource: new SessionSchema.ForkExpectedSource({
                    sourceSessionID: created.session.id,
                    mode: created.session.mode,
                    agent: created.session.agent,
                    controller: created.session.controller,
                    model: created.session.model,
                    compositionDigest: created.snapshot.digest,
                  }),
                })
                .pipe(Effect.flip)
              expect(rejected).toBeInstanceOf(SessionErrors.ControllerConflictError)
              expect(rejected).toMatchObject({ field: "agent", kind: "meta_root_agent_conflict" })
              expect(yield* stored).toEqual(before)
            }),
          ),
      )
    }
  }

  it.live("publishes a new Custom root only after its snapshot is committed", () =>
    withCustomMode(
      "true",
      Effect.gen(function* () {
        const f = yield* setup
        const id = Session.ID.create()
        const observed = new Array<{ session: boolean; snapshot: boolean }>()
        const store = yield* SessionStore.Service
        const unsubscribe = yield* f.bus.listen((event) =>
          Effect.gen(function* () {
            if (!Schema.is(SessionEvent.Created)(event) || event.data.sessionID !== id) return
            observed.push({
              session: (yield* store.get(id))?.mode === "custom",
              snapshot: yield* f.compositions.exists(id),
            })
          }),
        )
        yield* Effect.addFinalizer(() => unsubscribe)
        const created = yield* f.session.createCustom({ id, location: f.location, composition: f.composition })
        const second = yield* f.session.createCustom({ location: f.location, composition: f.composition })

        expect(created.session).toMatchObject({ id, mode: "custom", agent: "meta", location: f.location })
        expect(created.snapshot).toEqual(yield* f.compositions.get(id))
        expect(created.snapshot.sessionID).toBe(id)
        expect(second.session.id).not.toBe(id)
        expect(second.snapshot.sessionID).toBe(second.session.id)
        expect(observed).toEqual([{ session: true, snapshot: true }])
        expect(yield* events(f.session, id)).toMatchObject([
          { type: "session.created", data: { mode: "custom", agent: "meta" } },
        ])
        expect((yield* events(f.session, id))[0].data).not.toHaveProperty("snapshot")
      }),
    ),
  )

  it.live("adopts exact retries without freezing again and rejects a changed composition", () =>
    withCustomMode(
      "true",
      Effect.gen(function* () {
        const f = yield* setup
        const input = { id: Session.ID.create(), location: f.location, composition: f.composition }
        const first = yield* f.session.createCustom(input)
        const retried = yield* f.session.createCustom({ ...input, title: "Retry metadata is not identity" })
        expect(retried).toEqual(first)
        expect(f.fixture.freezes).toHaveLength(1)
        expect(yield* events(f.session, first.session.id)).toHaveLength(1)

        const changed = new Composition.TemporaryInput({ ...f.composition, requestedCapabilities: ["write"] })
        expect(yield* f.session.createCustom({ ...input, composition: changed }).pipe(Effect.flip)).toMatchObject({
          _tag: "Session.CompositionConflictError",
          reason: "composition_input_mismatch",
        })
        expect(
          yield* f.session
            .createCustom({ ...input, expectedPlanDigest: Composition.Digest.make("b".repeat(64)) })
            .pipe(Effect.flip),
        ).toMatchObject({ _tag: "Composition.ResolveError", code: "plan_digest_mismatch" })
        expect(yield* f.compositions.get(first.session.id)).toEqual(first.snapshot)
        expect(f.fixture.freezes).toHaveLength(1)
        expect(yield* events(f.session, first.session.id)).toHaveLength(1)
      }),
    ),
  )

  it.live("adopts an existing ordinary Session before resolving a Custom parent or requested mode", () =>
    withCustomMode(
      "true",
      Effect.gen(function* () {
        const f = yield* setup
        const root = yield* f.session.createCustom({ location: f.location, composition: f.composition })
        const ordinary = yield* f.session.create({ location: f.location, mode: "chat", title: "Keep ordinary" })
        const row = yield* f.database.db.select().from(SessionTable).where(eq(SessionTable.id, ordinary.id)).get()
        const log = yield* events(f.session, ordinary.id)
        const sessions = (yield* f.session.list()).data
        const snapshots = yield* f.database.db.select().from(SessionCompositionSnapshotTable).all()
        const recorded = yield* f.database.db.select().from(EventTable).all()
        const freezes = f.fixture.freezes.length

        expect(yield* f.session.create({ id: ordinary.id, parentID: root.session.id, agent: executor.id })).toEqual(
          ordinary,
        )
        expect(yield* f.session.create({ id: ordinary.id, location: f.location, mode: "custom" })).toEqual(ordinary)
        expect(yield* f.database.db.select().from(SessionTable).where(eq(SessionTable.id, ordinary.id)).get()).toEqual(
          row,
        )
        expect(yield* events(f.session, ordinary.id)).toEqual(log)
        expect((yield* f.session.list()).data).toEqual(sessions)
        expect(yield* f.compositions.read(ordinary.id)).toBeUndefined()
        expect(yield* f.database.db.select().from(SessionCompositionSnapshotTable).all()).toEqual(snapshots)
        expect(yield* f.database.db.select().from(EventTable).all()).toEqual(recorded)
        expect(f.fixture.freezes).toHaveLength(freezes)
      }),
    ),
  )

  it.live("adopts an ordinary Session that wins after a Custom child creation reads the missing ID", () =>
    withCustomMode(
      "true",
      Effect.gen(function* () {
        const f = yield* setup
        const root = yield* f.session.createCustom({ location: f.location, composition: f.composition })
        const delegation = yield* f.delegations.create({
          parentSessionID: root.session.id,
          agent: executor.id,
          title: "Generic child creation",
        })
        const participant = yield* f.delegations.addParticipant({
          delegationID: delegation.id,
          provider: "internal",
          target: executor.id,
          role: "implementer",
          context: "fresh",
        })
        const childSource = new SessionSchema.TaskControllerSource({
          kind: "task",
          delegationID: delegation.id,
          participantID: participant.id,
        })
        const id = Session.ID.create()
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
        // Project resolution follows the missing-ID read and frozen selection,
        // before Bus takes its durable lock or starts the projection transaction.
        f.fixture.beforeProjectResolve.set(
          f.location.directory,
          Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.asVoid),
        )
        const child = yield* f.session
          .create({ id, parentID: root.session.id, agent: executor.id, source: childSource })
          .pipe(Effect.forkIn(yield* Scope.Scope, { startImmediately: true }))
        yield* awaitWithTimeout(Deferred.await(entered), "Custom child did not reach project resolution")
        const tmp = yield* tmpdirScoped()
        const ordinary = yield* f.session.create({
          id,
          location: Location.Ref.make({ directory: AbsolutePath.make(tmp.path) }),
          mode: "chat",
          title: "Ordinary winner",
        })
        const row = yield* f.database.db.select().from(SessionTable).where(eq(SessionTable.id, id)).get()
        const log = yield* events(f.session, id)
        const snapshots = yield* f.database.db.select().from(SessionCompositionSnapshotTable).all()
        const recorded = yield* f.database.db.select().from(EventTable).all()

        yield* Deferred.succeed(release, undefined)
        expect(yield* awaitWithTimeout(Fiber.join(child), "Custom child did not adopt the ordinary winner")).toEqual(
          ordinary,
        )
        expect(yield* f.database.db.select().from(SessionTable).where(eq(SessionTable.id, id)).get()).toEqual(row)
        expect(yield* events(f.session, id)).toEqual(log)
        expect((yield* f.session.list()).data).toHaveLength(2)
        expect(yield* f.compositions.read(id)).toBeUndefined()
        expect(yield* f.database.db.select().from(SessionCompositionSnapshotTable).all()).toEqual(snapshots)
        expect(yield* f.database.db.select().from(EventTable).all()).toEqual(recorded)
        expect(f.fixture.freezes).toHaveLength(1)
      }),
    ),
  )

  it.live("retries a frozen profile after its file is deleted while a new start fails", () =>
    withCustomMode(
      "true",
      Effect.gen(function* () {
        const f = yield* setup
        const file = path.join(f.location.directory, "profile.yaml")
        yield* Effect.promise(() => Bun.write(file, "profile fixture"))
        f.fixture.profiles.set("profile.yaml", file)
        const composition = new Composition.ProfileInput({
          source: "profile",
          profilePath: "profile.yaml",
          profileRevision: Composition.Revision.make("a".repeat(64)),
        })
        const input = { id: Session.ID.create(), location: f.location, composition }
        const first = yield* f.session.createCustom(input)
        yield* Effect.promise(() => rm(file))
        expect(yield* f.session.createCustom(input)).toEqual(first)
        expect(f.fixture.freezes).toHaveLength(1)
        expect(yield* f.session.createCustom({ location: f.location, composition }).pipe(Effect.flip)).toMatchObject({
          _tag: "Composition.ResolveError",
          code: "profile_missing",
        })
        expect(yield* f.compositions.get(first.session.id)).toEqual(first.snapshot)
        expect((yield* f.session.list()).data.map((session) => session.id)).toEqual([first.session.id])
      }),
    ),
  )

  for (const source of ["temporary", "profile"] as const) {
    it.live(`rolls back the ${source} Session and event when snapshot insertion fails`, () =>
      withCustomMode(
        "true",
        Effect.gen(function* () {
          const f = yield* setup
          const id = Session.ID.create()
          const seed = f.fixture.snapshots.get("seed")
          if (!seed?.data.orchestrator) throw new Error("Expected the frozen lifecycle root")
          const root = new Composition.BuiltinRoot({
            source: "builtin",
            id: "meta",
            revision: Composition.Revision.make(
              CompositionDigest.computeDigest(Schema.encodeSync(Agent.Info)(seed.data.orchestrator)),
            ),
          })
          const profileYaml = AssetYaml.stringify(
            Schema.encodeSync(CustomProfile.Profile)(
              new CustomProfile.Profile({
                kind: "custom-profile",
                name: CustomProfile.Name.make("Atomic Profile"),
                description: CustomProfile.Description.make("Profile snapshot insertion failure"),
                root,
                agents: f.composition.agents,
                bindings: f.composition.bindings,
                presentation: "native",
                requestedCapabilities: [],
              }),
            ),
          )
          if (source === "profile") {
            const file = path.join(f.location.directory, "atomic-profile.yaml")
            yield* Effect.promise(() => Bun.write(file, profileYaml))
            f.fixture.profiles.set("atomic-profile.yaml", file)
            f.fixture.snapshots.set(
              "seed",
              new Composition.SnapshotV2({
                ...seed,
                data: new Composition.SnapshotDataV2({ ...seed.data, sourceLocation: f.location, root }),
              }),
            )
          }
          const composition =
            source === "temporary"
              ? f.composition
              : new Composition.ProfileInput({
                  source: "profile",
                  profilePath: "atomic-profile.yaml",
                  profileRevision: Composition.Revision.make(Hash.sha256(profileYaml)),
                })
          // An earlier projector writes the same key. The owner's snapshot insert
          // then fails inside the real Bus transaction, after Session projection.
          yield* f.bus.project(SessionEvent.Created, (event) => {
            if (event.data.sessionID !== id) return Effect.void
            const snapshot = f.fixture.snapshots.get("seed")
            if (!snapshot) return Effect.die(new Error("Missing snapshot fixture"))
            return SessionComposition.insertSnapshot(f.database.db, id, snapshot)
          })
          expect(
            (yield* f.session.createCustom({ id, location: f.location, composition }).pipe(Effect.exit))._tag,
          ).toBe("Failure")
          const store = yield* SessionStore.Service
          expect(yield* store.get(id)).toBeUndefined()
          expect(yield* f.compositions.read(id)).toBeUndefined()
          expect(yield* f.database.db.select().from(EventTable).where(eq(EventTable.aggregate_id, id)).all()).toEqual(
            [],
          )
          expect(
            yield* f.database.db.select().from(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, id)).get(),
          ).toBeUndefined()
          expect(
            yield* f.database.db
              .select()
              .from(MetaAgentSessionTable)
              .where(eq(MetaAgentSessionTable.session_id, id))
              .all(),
          ).toEqual([])
        }),
      ),
    )
  }

  it.live("rejects generic Custom roots and canonicalizes frozen child executors", () =>
    withCustomMode(
      "true",
      Effect.gen(function* () {
        const f = yield* setup
        expect(yield* f.session.create({ location: f.location, mode: "custom" }).pipe(Effect.flip)).toMatchObject({
          _tag: "Session.CompositionConflictError",
          reason: "custom_root_requires_composition",
        })
        const root = yield* f.session.createCustom({ location: f.location, composition: f.composition })
        const delegation = yield* f.delegations.create({
          parentSessionID: root.session.id,
          agent: executor.id,
          title: "Generic frozen executor selection",
        })
        const participant = yield* f.delegations.addParticipant({
          delegationID: delegation.id,
          provider: "internal",
          target: executor.id,
          role: "implementer",
          context: "fresh",
        })
        const childSource = new SessionSchema.TaskControllerSource({
          kind: "task",
          delegationID: delegation.id,
          participantID: participant.id,
        })
        yield* Effect.forEach([undefined, Agent.ID.make("meta")], (agent) =>
          Effect.gen(function* () {
            expect(
              yield* f.session.create({ parentID: root.session.id, agent, source: childSource }).pipe(Effect.flip),
            ).toMatchObject({
              _tag: "Session.CompositionConflictError",
              reason: "custom_executor_required",
            })
          }),
        )
        expect(
          yield* f.session
            .create({ parentID: root.session.id, agent: Agent.ID.make("unselected"), source: childSource })
            .pipe(Effect.flip),
        ).toMatchObject({ _tag: "SessionComposition.AgentDelegationForbiddenError", agentID: "unselected" })
        expect(
          yield* f.session
            .create({ parentID: root.session.id, agent: executor.id, mode: "chat", source: childSource })
            .pipe(Effect.flip),
        ).toMatchObject({ _tag: "Session.CompositionConflictError", reason: "custom_parent_mode_mismatch" })
        const id = Session.ID.create()
        const child = yield* f.session.create({
          id,
          parentID: root.session.id,
          agent: Agent.ID.make("coder"),
          source: childSource,
        })
        yield* f.delegations.bindParticipant({
          delegationID: delegation.id,
          participantID: participant.id,
          childSessionID: child.id,
        })
        expect(child).toMatchObject({
          parentID: root.session.id,
          mode: "custom",
          agent: executor.id,
          attended: false,
          location: f.location,
        })
        expect(yield* f.compositions.get(child.id)).toEqual({ ...root.snapshot, sessionID: child.id })
        expect(
          yield* f.session.create({ id, parentID: root.session.id, agent: executor.id, source: childSource }),
        ).toEqual(child)
        const other = yield* f.session.createCustom({ location: f.location, composition: f.composition })
        const otherDelegation = yield* f.delegations.create({
          parentSessionID: other.session.id,
          agent: executor.id,
          title: "Different generic frozen owner",
        })
        const otherParticipant = yield* f.delegations.addParticipant({
          delegationID: otherDelegation.id,
          provider: "internal",
          target: executor.id,
          role: "implementer",
          context: "fresh",
        })
        const otherSource = new SessionSchema.TaskControllerSource({
          kind: "task",
          delegationID: otherDelegation.id,
          participantID: otherParticipant.id,
        })
        expect(
          yield* f.session
            .create({
              id,
              parentID: root.session.id,
              agent: executor.id,
              source: otherSource,
            })
            .pipe(Effect.flip),
        ).toMatchObject({ _tag: "Session.ControllerConflictError", kind: "meta_child_source_invalid" })
        expect(
          yield* f.session
            .create({
              id,
              parentID: other.session.id,
              agent: executor.id,
              source: otherSource,
            })
            .pipe(Effect.flip),
        ).toMatchObject({ _tag: "Session.CompositionConflictError" })
        expect(yield* events(f.session, child.id)).toHaveLength(1)
        expect((yield* f.session.list()).data).toHaveLength(3)
      }),
    ),
  )

  it.live("forks Custom roots as meta and child forks as explicit frozen executors", () =>
    withCustomMode(
      "true",
      Effect.gen(function* () {
        const f = yield* setup
        const root = yield* f.session.createCustom({ location: f.location, composition: f.composition })
        const delegation = yield* f.delegations.create({
          parentSessionID: root.session.id,
          agent: executor.id,
          title: "Generic child fork source",
        })
        const participant = yield* f.delegations.addParticipant({
          delegationID: delegation.id,
          provider: "internal",
          target: executor.id,
          role: "implementer",
          context: "fresh",
        })
        const child = yield* f.session.create({
          parentID: root.session.id,
          agent: executor.id,
          source: new SessionSchema.TaskControllerSource({
            kind: "task",
            delegationID: delegation.id,
            participantID: participant.id,
          }),
        })
        yield* f.delegations.bindParticipant({
          delegationID: delegation.id,
          participantID: participant.id,
          childSessionID: child.id,
        })
        yield* f.session.prompt({ sessionID: child.id, text: "First", resume: false })
        yield* SessionInbox.promote(f.database.db, f.bus, child.id, "steer")
        yield* f.session.prompt({ sessionID: child.id, text: "Second", resume: false })
        yield* SessionInbox.promote(f.database.db, f.bus, child.id, "steer")
        const rootFork = yield* f.session.fork({ sessionID: child.id })
        expect(rootFork).toMatchObject({ mode: "custom", agent: "meta", fork: { sessionID: child.id } })
        expect(rootFork.parentID).toBeUndefined()
        expect(yield* f.compositions.get(rootFork.id)).toEqual({ ...root.snapshot, sessionID: rootFork.id })
        expect(yield* f.session.fork({ sessionID: child.id, id: rootFork.id, agent: Agent.ID.make("meta") })).toEqual(
          rootFork,
        )
        expect(yield* f.session.fork({ sessionID: child.id, agent: executor.id }).pipe(Effect.flip)).toMatchObject({
          _tag: "Session.CompositionConflictError",
          reason: "custom_root_requires_meta",
        })
        yield* Effect.forEach([undefined, Agent.ID.make("meta")], (agent) =>
          Effect.gen(function* () {
            expect(yield* f.session.fork({ sessionID: child.id, child: true, agent }).pipe(Effect.flip)).toMatchObject({
              _tag: "Session.CompositionConflictError",
              reason: "custom_executor_required",
            })
          }),
        )
        expect(
          yield* f.session
            .fork({ sessionID: child.id, child: true, agent: Agent.ID.make("unselected") })
            .pipe(Effect.flip),
        ).toMatchObject({ _tag: "SessionComposition.AgentDelegationForbiddenError", agentID: "unselected" })
        const childFork = yield* f.session.fork({ sessionID: child.id, child: true, agent: Agent.ID.make("coder") })
        expect(childFork).toMatchObject({ parentID: child.id, mode: "custom", agent: executor.id, attended: false })
        expect(yield* f.compositions.get(childFork.id)).toEqual({ ...root.snapshot, sessionID: childFork.id })
        expect(
          yield* f.session.fork({ sessionID: child.id, id: childFork.id, child: true, agent: executor.id }),
        ).toEqual(childFork)
        expect(yield* events(f.session, childFork.id)).toHaveLength(1)
        expect(f.fixture.freezes).toHaveLength(1)
        expect((yield* events(f.session, rootFork.id)).map((event) => event.type)).toEqual(["session.forked"])
        expect((yield* f.session.context(rootFork.id)).map((message) => message.type)).toEqual(["user", "user"])
        yield* f.session.prompt({ sessionID: rootFork.id, text: "Continue", resume: false })
        yield* SessionInbox.promote(f.database.db, f.bus, rootFork.id, "steer")
        const context = yield* f.session.context(rootFork.id)
        expect(context).toMatchObject([{ text: "First" }, { text: "Second" }, { text: "Continue" }])
        const log = yield* events(f.session, rootFork.id)
        expect(log[1].durable.seq).toBeGreaterThan(log[0].durable.seq)
        expect(log[2].durable.seq).toBeGreaterThan(log[1].durable.seq)
      }),
    ),
  )

  it.live("rejects invalid Custom Agent changes before publishing and canonicalizes a selected alias", () =>
    withCustomMode(
      "true",
      Effect.gen(function* () {
        const f = yield* setup
        const root = yield* f.session.createCustom({ location: f.location, composition: f.composition })
        const delegation = yield* f.delegations.create({
          parentSessionID: root.session.id,
          agent: executor.id,
          title: "Generic child agent selection",
        })
        const participant = yield* f.delegations.addParticipant({
          delegationID: delegation.id,
          provider: "internal",
          target: executor.id,
          role: "implementer",
          context: "fresh",
        })
        const child = yield* f.session.create({
          parentID: root.session.id,
          agent: executor.id,
          source: new SessionSchema.TaskControllerSource({
            kind: "task",
            delegationID: delegation.id,
            participantID: participant.id,
          }),
        })
        yield* f.delegations.bindParticipant({
          delegationID: delegation.id,
          participantID: participant.id,
          childSessionID: child.id,
        })
        const roots = yield* events(f.session, root.session.id)
        const children = yield* events(f.session, child.id)
        yield* Effect.forEach([executor.id, Agent.ID.make("unselected")], (agent) =>
          Effect.gen(function* () {
            expect(yield* f.session.switchAgent({ sessionID: root.session.id, agent }).pipe(Effect.flip)).toMatchObject(
              {
                _tag: "SessionComposition.AgentDelegationForbiddenError",
                agentID: agent,
              },
            )
          }),
        )
        yield* Effect.forEach([Agent.ID.make("meta"), Agent.ID.make("unselected")], (agent) =>
          Effect.gen(function* () {
            expect(yield* f.session.switchAgent({ sessionID: child.id, agent }).pipe(Effect.flip)).toMatchObject({
              _tag: "SessionComposition.AgentDelegationForbiddenError",
              agentID: agent,
            })
          }),
        )
        expect(yield* f.session.get(root.session.id)).toEqual(root.session)
        expect(yield* f.session.get(child.id)).toEqual(child)
        expect(yield* events(f.session, root.session.id)).toEqual(roots)
        expect(yield* events(f.session, child.id)).toEqual(children)

        // A historical invalid selection can be repaired only by a frozen executor.
        yield* f.bus.publish(SessionEvent.AgentSelected, {
          sessionID: child.id,
          agent: Agent.ID.make("unselected"),
          previous: child.agent,
        })
        yield* f.session.switchAgent({ sessionID: child.id, agent: Agent.ID.make("coder") })
        expect(yield* f.session.get(child.id)).toMatchObject({ agent: executor.id })
        const log = yield* events(f.session, child.id)
        expect(log.at(-1)).toMatchObject({
          type: "session.agent.selected",
          data: { agent: executor.id, previous: "unselected" },
        })
        yield* f.session.switchAgent({ sessionID: child.id, agent: Agent.ID.make("coder") })
        expect(yield* events(f.session, child.id)).toEqual(log)
      }),
    ),
  )

  it.live("requires a runnable frozen selection before changing a Custom model", () =>
    withCustomMode(
      "true",
      Effect.gen(function* () {
        const f = yield* setup
        const root = yield* f.session.createCustom({ location: f.location, composition: f.composition })
        const delegation = yield* f.delegations.create({
          parentSessionID: root.session.id,
          agent: executor.id,
          title: "Generic child model selection",
        })
        const participant = yield* f.delegations.addParticipant({
          delegationID: delegation.id,
          provider: "internal",
          target: executor.id,
          role: "implementer",
          context: "fresh",
        })
        const child = yield* f.session.create({
          parentID: root.session.id,
          agent: executor.id,
          source: new SessionSchema.TaskControllerSource({
            kind: "task",
            delegationID: delegation.id,
            participantID: participant.id,
          }),
        })
        yield* f.delegations.bindParticipant({
          delegationID: delegation.id,
          participantID: participant.id,
          childSessionID: child.id,
        })
        const model = Model.Ref.parse("test/new-model")
        yield* f.session.switchModel({ sessionID: root.session.id, model })
        yield* f.session.switchModel({ sessionID: child.id, model })
        expect(yield* f.session.get(root.session.id)).toMatchObject({ model })
        expect(yield* f.session.get(child.id)).toMatchObject({ model })

        yield* f.bus.publish(SessionEvent.AgentSelected, {
          sessionID: child.id,
          agent: Agent.ID.make("meta"),
          previous: child.agent,
        })
        const invalid = yield* f.session.get(child.id)
        const log = yield* events(f.session, child.id)
        expect(yield* f.session.switchModel({ sessionID: child.id, model }).pipe(Effect.flip)).toMatchObject({
          _tag: "SessionComposition.AgentDelegationForbiddenError",
          agentID: "meta",
        })
        expect(yield* f.session.get(child.id)).toEqual(invalid)
        expect(yield* events(f.session, child.id)).toEqual(log)

        yield* f.database.db
          .delete(SessionCompositionSnapshotTable)
          .where(eq(SessionCompositionSnapshotTable.session_id, root.session.id))
          .run()
          .pipe(Effect.orDie)
        const roots = yield* events(f.session, root.session.id)
        expect(
          yield* f.session.switchAgent({ sessionID: root.session.id, agent: Agent.ID.make("meta") }).pipe(Effect.flip),
        ).toMatchObject({ _tag: "SessionComposition.SnapshotNotFoundError", sessionID: root.session.id })
        expect(yield* f.session.switchModel({ sessionID: root.session.id, model }).pipe(Effect.flip)).toMatchObject({
          _tag: "SessionComposition.SnapshotNotFoundError",
          sessionID: root.session.id,
        })
        expect(yield* events(f.session, root.session.id)).toEqual(roots)
      }),
    ),
  )

  it.live("blocks Custom lifecycle writes while the runtime kill switch is off", () =>
    withCustomMode(
      "true",
      Effect.gen(function* () {
        const f = yield* setup
        const root = yield* f.session.createCustom({ location: f.location, composition: f.composition })
        const delegation = yield* f.delegations.create({
          parentSessionID: root.session.id,
          agent: executor.id,
          title: "Generic child kill switch",
        })
        const participant = yield* f.delegations.addParticipant({
          delegationID: delegation.id,
          provider: "internal",
          target: executor.id,
          role: "implementer",
          context: "fresh",
        })
        const child = yield* f.session.create({
          parentID: root.session.id,
          agent: executor.id,
          source: new SessionSchema.TaskControllerSource({
            kind: "task",
            delegationID: delegation.id,
            participantID: participant.id,
          }),
        })
        yield* f.delegations.bindParticipant({
          delegationID: delegation.id,
          participantID: participant.id,
          childSessionID: child.id,
        })
        const blockedParticipant = yield* f.delegations.addParticipant({
          delegationID: delegation.id,
          provider: "internal",
          target: executor.id,
          role: "implementer",
          context: "fresh",
        })
        const childSource = new SessionSchema.TaskControllerSource({
          kind: "task",
          delegationID: delegation.id,
          participantID: blockedParticipant.id,
        })
        const source = yield* f.session.create({ location: f.location })
        yield* f.session.prompt({ sessionID: child.id, text: "Forkable input", resume: false })
        yield* SessionInbox.promote(f.database.db, f.bus, child.id, "steer")
        const roots = yield* events(f.session, root.session.id)
        const children = yield* events(f.session, child.id)
        const sources = yield* events(f.session, source.id)
        const sessions = (yield* f.session.list()).data
        const pending = yield* f.session.inbox(child.id)
        const rows = yield* f.database.db.select().from(EventTable).all()
        const snapshots = yield* f.database.db.select().from(SessionCompositionSnapshotTable).all()
        const freezes = f.fixture.freezes.length
        const model = Model.Ref.parse("test/new-model")
        yield* withCustomMode(
          "false",
          Effect.gen(function* () {
            yield* Effect.forEach(
              [
                f.session.createCustom({ location: f.location, composition: f.composition }).pipe(Effect.asVoid),
                f.session
                  .createCustom({ id: root.session.id, location: f.location, composition: f.composition })
                  .pipe(Effect.asVoid),
                f.session
                  .create({ parentID: root.session.id, agent: executor.id, source: childSource })
                  .pipe(Effect.asVoid),
                f.session.fork({ sessionID: child.id }).pipe(Effect.asVoid),
                f.session.fork({ sessionID: child.id, child: true, agent: executor.id }).pipe(Effect.asVoid),
                f.session.upgradeCustom({ sessionID: source.id, composition: f.composition }).pipe(Effect.asVoid),
                f.session.switchAgent({ sessionID: root.session.id, agent: Agent.ID.make("meta") }),
                f.session.switchAgent({ sessionID: child.id, agent: Agent.ID.make("coder") }),
                f.session.switchModel({ sessionID: root.session.id, model }),
                f.session.switchModel({ sessionID: child.id, model }),
                f.session.prompt({ sessionID: child.id, text: "Blocked input", resume: false }).pipe(Effect.asVoid),
                f.session
                  .skill({ sessionID: child.id, skill: Skill.ID.make("missing-skill"), resume: false })
                  .pipe(Effect.asVoid),
                f.session.resume(child.id),
                f.session.compact({ sessionID: child.id }).pipe(Effect.asVoid),
              ].map((operation: Effect.Effect<void, { readonly _tag: string }>) =>
                operation.pipe(Effect.mapError((error) => error._tag)),
              ),
              (operation) =>
                Effect.gen(function* () {
                  expect(yield* operation.pipe(Effect.flip)).toBe("UnsupportedProductModeError")
                }),
            )
          }),
        )
        expect(f.fixture.freezes).toHaveLength(freezes)
        expect((yield* f.session.list()).data).toEqual(sessions)
        expect(yield* f.session.inbox(child.id)).toEqual(pending)
        expect(yield* f.database.db.select().from(EventTable).all()).toEqual(rows)
        expect(yield* f.database.db.select().from(SessionCompositionSnapshotTable).all()).toEqual(snapshots)
        expect(yield* events(f.session, root.session.id)).toEqual(roots)
        expect(yield* events(f.session, child.id)).toEqual(children)
        expect(yield* events(f.session, source.id)).toEqual(sources)
        expect(yield* f.compositions.get(root.session.id)).toEqual(root.snapshot)
      }),
    ),
  )

  it.live("upgrades an ordinary idle Session into independent roots without changing the source", () =>
    withCustomMode(
      "true",
      Effect.gen(function* () {
        const f = yield* setup
        const source = yield* f.session.create({ location: f.location, mode: "work", title: "Source" })
        yield* f.session.prompt({ sessionID: source.id, text: "Keep source history", resume: false })
        yield* SessionInbox.promote(f.database.db, f.bus, source.id, "steer")
        const before = yield* f.session.get(source.id)
        const row = yield* f.database.db.select().from(SessionTable).where(eq(SessionTable.id, source.id)).get()
        const history = yield* f.session.context(source.id)
        const log = yield* events(f.session, source.id)
        const first = yield* f.session.upgradeCustom({ sessionID: source.id, composition: f.composition })
        const second = yield* f.session.upgradeCustom({
          sessionID: source.id,
          composition: f.composition,
          title: "Independent root",
        })

        expect(first.session).toMatchObject({ mode: "custom", agent: "meta", title: "Source", location: f.location })
        expect(first.session.parentID).toBeUndefined()
        expect(first.session.fork).toBeUndefined()
        expect(first.session.id).not.toBe(source.id)
        expect(second.session.id).not.toBe(first.session.id)
        expect(second.session).toMatchObject({ mode: "custom", agent: "meta", title: "Independent root" })
        expect(first.snapshot.sessionID).toBe(first.session.id)
        expect(first.snapshot).toEqual(yield* f.compositions.get(first.session.id))
        expect(second.snapshot).toEqual(yield* f.compositions.get(second.session.id))
        expect(second.snapshot.sessionID).toBe(second.session.id)
        expect(yield* f.session.get(source.id)).toEqual(before)
        expect(yield* f.database.db.select().from(SessionTable).where(eq(SessionTable.id, source.id)).get()).toEqual(
          row,
        )
        expect(yield* f.session.context(source.id)).toEqual(history)
        expect(yield* events(f.session, source.id)).toEqual(log)
        expect(yield* f.compositions.read(source.id)).toBeUndefined()
        expect(yield* f.session.context(first.session.id)).toEqual([])
        expect((yield* events(f.session, first.session.id)).map((event) => event.type)).toEqual(["session.created"])
      }),
    ),
  )

  it.live("rejects missing, Custom, and busy sources before freezing an upgrade", () =>
    withCustomMode(
      "true",
      Effect.gen(function* () {
        const f = yield* setup
        expect(
          yield* f.session
            .upgradeCustom({ sessionID: Session.ID.create(), composition: f.composition })
            .pipe(Effect.flip),
        ).toBeInstanceOf(Session.NotFoundError)
        const custom = yield* f.session.createCustom({ location: f.location, composition: f.composition })
        const freezes = f.fixture.freezes.length
        expect(
          yield* f.session
            .upgradeCustom({ sessionID: custom.session.id, composition: f.composition })
            .pipe(Effect.flip),
        ).toMatchObject({ _tag: "Session.UpgradeSourceModeError", mode: "custom" })
        const source = yield* f.session.create({ location: f.location })
        f.fixture.active.add(source.id)
        expect(
          yield* f.session.upgradeCustom({ sessionID: source.id, composition: f.composition }).pipe(Effect.flip),
        ).toEqual(new Session.BusyError({ sessionID: source.id }))
        expect(f.fixture.freezes).toHaveLength(freezes)
        expect((yield* f.session.list()).data).toHaveLength(2)
      }),
    ),
  )

  it.live("rolls back an upgrade when the source becomes busy at commit", () =>
    withCustomMode(
      "true",
      Effect.gen(function* () {
        const f = yield* setup
        const source = yield* f.session.create({ location: f.location, mode: "assistant" })
        const before = yield* f.session.get(source.id)
        // The source becomes active after admission but before the start commits.
        f.fixture.beforeFreeze.push(
          Effect.sync(() => {
            f.fixture.active.add(source.id)
          }),
        )
        expect(
          yield* f.session.upgradeCustom({ sessionID: source.id, composition: f.composition }).pipe(Effect.flip),
        ).toEqual(new Session.BusyError({ sessionID: source.id }))
        const attempted = f.fixture.freezes.at(-1)?.sessionID
        if (!attempted) return yield* Effect.die(new Error("Upgrade did not reach freeze"))
        const id = Session.ID.make(attempted)
        const store = yield* SessionStore.Service
        expect(f.fixture.freezes).toHaveLength(1)
        expect(yield* store.get(id)).toBeUndefined()
        expect(yield* f.compositions.read(id)).toBeUndefined()
        expect(yield* f.database.db.select().from(EventTable).where(eq(EventTable.aggregate_id, id)).all()).toEqual([])
        expect(
          yield* f.database.db.select().from(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, id)).get(),
        ).toBeUndefined()
        expect(yield* f.session.get(source.id)).toEqual(before)
      }),
    ),
  )

  it.live("rolls back an upgrade when the source moves during freeze", () =>
    withCustomMode(
      "true",
      Effect.gen(function* () {
        const f = yield* setup
        const source = yield* f.session.create({ location: f.location, mode: "chat", title: "Movable source" })
        const destination = Location.Ref.make({
          directory: AbsolutePath.make(path.join(f.location.directory, "moved")),
        })
        // A real durable move lands while resolution is in progress. The start
        // commit must reject its old placement without rolling back the move.
        f.fixture.beforeFreeze.push(
          f.bus
            .publish(SessionEvent.Moved, {
              sessionID: source.id,
              location: destination,
              projectID: source.projectID,
            })
            .pipe(Effect.asVoid),
        )
        expect(
          yield* f.session.upgradeCustom({ sessionID: source.id, composition: f.composition }).pipe(Effect.flip),
        ).toMatchObject({
          _tag: "Session.UpgradeSourceMovedError",
          sessionID: source.id,
          expected: f.location,
          actual: destination,
        })
        const attempted = f.fixture.freezes.at(-1)?.sessionID
        if (!attempted) return yield* Effect.die(new Error("Upgrade did not reach freeze"))
        const id = Session.ID.make(attempted)
        const store = yield* SessionStore.Service
        expect(yield* store.get(id)).toBeUndefined()
        expect(yield* f.compositions.read(id)).toBeUndefined()
        expect(yield* f.session.get(source.id)).toMatchObject({
          location: destination,
          mode: "chat",
          title: source.title,
        })
        expect((yield* f.session.list()).data.map((session) => session.id)).toEqual([source.id])
        expect((yield* events(f.session, source.id)).map((event) => event.type)).toEqual([
          "session.created",
          "session.moved",
        ])
        expect(yield* f.database.db.select().from(EventTable).where(eq(EventTable.aggregate_id, id)).all()).toEqual([])
        expect(
          yield* f.database.db.select().from(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, id)).get(),
        ).toBeUndefined()
      }),
    ),
  )
})
