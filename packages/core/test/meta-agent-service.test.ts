import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { Composition } from "@aigcfroge/schema/composition"
import { SessionIdentity } from "@aigcfroge/schema/session-identity"
import { CompositionDigest } from "@aigcfroge/core/composition/digest"
import { Database } from "@aigcfroge/core/database/database"
import { MetaAgent } from "@aigcfroge/schema/meta-agent"
import { MetaAgentService } from "@aigcfroge/core/meta-agent/service"
import { MetaAgentSessionTable } from "@aigcfroge/core/meta-agent/sql"
import { and, eq } from "drizzle-orm"
import { SessionSchema } from "@aigcfroge/core/session/schema"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { Agent } from "@aigcfroge/core/agent"
import { Model } from "@aigcfroge/core/model"
import { Project } from "@aigcfroge/core/project"
import { Provider } from "@aigcfroge/core/provider"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { testEffect } from "./lib/effect"
import { tempGlobalLayer } from "./fixture/global"
import { withEnv } from "./fixture/env"

// One database layer value: two `Database.layer()` calls are two independent
// in-memory databases, so the service and the test harness must share one.
const database = Database.layer().pipe(Layer.provide(tempGlobalLayer))
const testLayer = Layer.mergeAll(
  MetaAgentService.layer.pipe(Layer.provideMerge(SessionComposition.layer), Layer.provide(database)),
  database,
)

const it = testEffect(testLayer)

const coordinationFixture = Effect.gen(function* () {
  const service = yield* MetaAgentService.Service
  const { db } = yield* Database.Service
  const meta = yield* service.create({ title: "Meta", agent: "meta", model: { id: "test", providerID: "test" } })
  const id = SessionSchema.ID.create()
  const projectID = Project.ID.make("proj_coordination_fixture")
  const controller = new SessionSchema.RootController({ kind: "root", metaAgentID: meta.id, rootSessionID: id })
  yield* db
    .insert(ProjectTable)
    .values({ id: projectID, worktree: AbsolutePath.make("/tmp"), sandboxes: [] })
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({ id, project_id: projectID, directory: "/tmp", slug: id, version: "test", agent: "meta", controller })
    .pipe(Effect.orDie)
  yield* service.attach({ metaID: meta.id, sessionID: id, role: "orchestrator" })
  return { service, db, meta, id, projectID, controller }
})

describe("MetaAgentService coordination", () => {
  it.live("MP01 accepts an active Meta root with its original owner and current captured agent", () =>
    Effect.gen(function* () {
      const fixture = yield* coordinationFixture
      const capability = yield* fixture.service.assertCoordination(fixture.id, { agent: Agent.ID.make("meta") })
      expect(capability).toEqual({ available: true, reasons: [], selection: { agent: Agent.ID.make("meta") } })
      expect(Schema.encodeSync(SessionIdentity.Coordination)(capability)).toEqual({
        available: true,
        reasons: [],
        selection: { agent: "meta" },
      })
      const mismatch = yield* fixture.service.coordination(fixture.id, { agent: Agent.ID.make("build") })
      expect(mismatch.available).toBe(false)
      expect(mismatch.reasons.map((reason) => reason.code)).toEqual([SessionIdentity.ReasonCodes.metaExecutionMismatch])
    }),
  )

  for (const agent of ["build", "plan"] as const) {
    it.live(`MP01 keeps a saved Meta controller inactive while ${agent} is selected`, () =>
      Effect.gen(function* () {
        const fixture = yield* coordinationFixture
        yield* fixture.db.update(SessionTable).set({ agent }).where(eq(SessionTable.id, fixture.id)).pipe(Effect.orDie)
        const capability = yield* fixture.service.coordination(fixture.id)
        expect(capability.available).toBe(false)
        expect(capability.selection.agent).toBe(Agent.ID.make(agent))
        expect(capability.reasons.map((reason) => reason.code)).toEqual([SessionIdentity.ReasonCodes.metaNotSelected])
        expect(yield* fixture.service.assertCoordination(fixture.id).pipe(Effect.flip)).toMatchObject({
          _tag: "Session.ControllerConflictError",
          kind: "meta-not-selected",
        })
        expect(yield* fixture.service.sessions(fixture.meta.id)).toMatchObject([
          { sessionID: fixture.id, role: "orchestrator" },
        ])
      }),
    )
  }

  it.live("MP01 rejects a Meta child or a root whose saved ownership is absent", () =>
    Effect.gen(function* () {
      const fixture = yield* coordinationFixture
      const childID = SessionSchema.ID.create()
      yield* fixture.db
        .insert(SessionTable)
        .values({
          id: childID,
          parent_id: fixture.id,
          project_id: fixture.projectID,
          directory: "/tmp",
          slug: childID,
          version: "test",
          agent: "meta",
        })
        .pipe(Effect.orDie)
      const child = yield* fixture.service.coordination(childID)
      expect(child.available).toBe(false)
      expect(child.reasons.map((reason) => reason.code)).toEqual([SessionIdentity.ReasonCodes.coordinationRootRequired])
      yield* fixture.service.detach({ metaID: fixture.meta.id, sessionID: fixture.id })
      const root = yield* fixture.service.coordination(fixture.id)
      expect(root.available).toBe(false)
      expect(root.reasons.map((reason) => reason.code)).toEqual([SessionIdentity.ReasonCodes.metaOwnerInvalid])
    }),
  )

  for (const name of ["share", "read"] as const) {
    it.live(`MP01 checks a Custom Meta's adopted root, digest and ${name} catalog`, () =>
      withEnv({ AIGCFROGE_CUSTOM_MODE: "true" }, () =>
        Effect.gen(function* () {
          const fixture = yield* coordinationFixture
          const composition = yield* SessionComposition.Service
          yield* fixture.db
            .update(SessionTable)
            .set({ mode: "custom" })
            .where(eq(SessionTable.id, fixture.id))
            .pipe(Effect.orDie)
          const missing = yield* fixture.service.coordination(fixture.id)
          expect(missing.available).toBe(false)
          expect(missing.reasons.map((reason) => reason.code)).toEqual([
            SessionIdentity.ReasonCodes.coordinationSnapshotUnavailable,
          ])
          const info = Agent.Info.make({ ...Agent.Info.default(Agent.ID.make("meta")), mode: "primary" })
          const snapshot = new Composition.SnapshotV2({
            version: 2,
            sessionID: fixture.id,
            digest: Composition.Digest.make("a".repeat(64)),
            createdAt: 1,
            data: new Composition.SnapshotDataV2({
              root: new Composition.BuiltinRoot({
                source: "builtin",
                id: "meta",
                revision: Composition.Revision.make(
                  CompositionDigest.computeDigest(Schema.encodeSync(Agent.Info)(info)),
                ),
              }),
              orchestrator: info,
              agents: [],
              executors: [],
              instructions: [],
              prompts: [],
              skills: [],
              commands: [],
              maxConcurrency: 1,
              bindings: {
                orchestrator: new Composition.SnapshotBindingData({
                  instructions: [],
                  prompts: [],
                  skills: [],
                  commands: [],
                }),
              },
              tools: CompositionDigest.captureTools(
                [{ type: "tool", name, description: name, inputSchema: { type: "object" }, placement: "direct" }],
                "/tmp",
                "test",
              ),
              mcp: new Composition.SnapshotMcpInfo({ bindings: [], tools: [] }),
            }),
          })
          yield* composition.attach(fixture.id, snapshot)
          const current = yield* fixture.service.assertCoordination(fixture.id)
          expect(current.selection.compositionDigest).toBe(snapshot.digest)
          const tool = yield* fixture.service.coordination(fixture.id, { agent: Agent.ID.make("meta"), tool: "share" })
          expect(tool.available).toBe(name === "share")
          expect(tool.reasons.map((reason) => reason.code)).toEqual(
            name === "share" ? [] : [SessionIdentity.ReasonCodes.coordinationToolUnavailable],
          )
          const changed = yield* fixture.service.coordination(fixture.id, {
            selection: { ...current.selection, compositionDigest: Composition.Digest.make("b".repeat(64)) },
          })
          expect(changed.available).toBe(false)
          expect(changed.reasons.map((reason) => reason.code)).toEqual([
            SessionIdentity.ReasonCodes.coordinationAgentChanged,
          ])
        }),
      ),
    )
  }
})

describe("MetaAgentService", () => {
  it.effect("create returns a meta agent with the given properties", () =>
    Effect.gen(function* () {
      const svc = yield* MetaAgentService.Service
      const created = yield* svc.create({
        title: "Test Meta Agent",
        agent: "meta",
        model: { id: "gpt-4", providerID: "openai" },
      })
      expect(created.title).toBe("Test Meta Agent")
      expect(created.agent).toBe(Agent.ID.make("meta"))
      expect(created.model).toMatchObject({ id: Model.ID.make("gpt-4"), providerID: Provider.ID.make("openai") })
      expect(created.id).toStartWith("mag_")
    }),
  )

  it.effect("get returns undefined for unknown id", () =>
    Effect.gen(function* () {
      const svc = yield* MetaAgentService.Service
      const result = yield* svc.get(MetaAgent.ID.make("mag_nonexistent"))
      expect(result).toBeUndefined()
    }),
  )

  it.effect("get returns a previously created meta agent", () =>
    Effect.gen(function* () {
      const svc = yield* MetaAgentService.Service
      const created = yield* svc.create({
        title: "Get Test",
        agent: "build",
        model: { id: "claude-3", providerID: "anthropic" },
      })
      const fetched = yield* svc.get(created.id)
      expect(fetched).toMatchObject({ id: created.id, title: "Get Test", agent: "build" })
    }),
  )

  it.effect("list returns all created meta agents", () =>
    Effect.gen(function* () {
      const svc = yield* MetaAgentService.Service
      yield* svc.create({ title: "A1", agent: "build", model: { id: "m1", providerID: "p1" } })
      yield* svc.create({ title: "A2", agent: "explore", model: { id: "m2", providerID: "p2" } })
      const list = yield* svc.list()
      expect(list.length).toBeGreaterThanOrEqual(2)
      const titles = list.map((m) => m.title)
      expect(titles).toContain("A1")
      expect(titles).toContain("A2")
    }),
  )

  it.effect("remove deletes a meta agent", () =>
    Effect.gen(function* () {
      const svc = yield* MetaAgentService.Service
      const created = yield* svc.create({
        title: "To Delete",
        agent: "general",
        model: { id: "m", providerID: "p" },
      })
      yield* svc.remove(created.id)
      const fetched = yield* svc.get(created.id)
      expect(fetched).toBeUndefined()
    }),
  )

  it.effect("attach/detach works with real sessions", () =>
    Effect.gen(function* () {
      const svc = yield* MetaAgentService.Service
      const { db } = yield* Database.Service
      const created = yield* svc.create({
        title: "Attach Test",
        agent: "meta",
        model: { id: "gpt-4", providerID: "openai" },
      })
      const pid = Project.ID.make("proj_attach_test")
      const sid = SessionSchema.ID.make("ses_attach_sess")
      yield* db.insert(ProjectTable).values({
        id: pid,
        worktree: AbsolutePath.make("/tmp"),
        sandboxes: [],
        time_created: 1,
        time_updated: 1,
      })
      yield* db.insert(SessionTable).values({
        id: sid,
        project_id: pid,
        directory: AbsolutePath.make("/tmp"),
        title: "t",
        slug: sid,
        version: "0",
        time_created: Date.now(),
        time_updated: Date.now(),
      })
      yield* svc.attach({ metaID: created.id, sessionID: sid, role: "worker" })
      const sessions = yield* svc.sessions(created.id)
      expect(sessions.length).toBe(1)
      expect(sessions[0].sessionID).toBe(sid)
      expect(sessions[0].role).toBe("worker")
      yield* svc.detach({ metaID: created.id, sessionID: sid })
      expect((yield* svc.sessions(created.id)).length).toBe(0)
    }),
  )

  it.effect("stats returns counts for attached sessions", () =>
    Effect.gen(function* () {
      const svc = yield* MetaAgentService.Service
      const { db } = yield* Database.Service
      const created = yield* svc.create({
        title: "Stats Test",
        agent: "meta",
        model: { id: "gpt-4", providerID: "openai" },
      })
      const pid = Project.ID.make("proj_stats_test")
      yield* db.insert(ProjectTable).values({
        id: pid,
        worktree: AbsolutePath.make("/tmp"),
        sandboxes: [],
        time_created: 1,
        time_updated: 1,
      })
      const sid1 = SessionSchema.ID.make("ses_stats_s1")
      const sid2 = SessionSchema.ID.make("ses_stats_s2")
      yield* db.insert(SessionTable).values({
        id: sid1,
        project_id: pid,
        directory: AbsolutePath.make("/t"),
        title: "t",
        slug: sid1,
        version: "0",
        time_created: 1,
        time_updated: 1,
      })
      yield* db.insert(SessionTable).values({
        id: sid2,
        project_id: pid,
        directory: AbsolutePath.make("/t"),
        title: "t",
        slug: sid2,
        version: "0",
        time_created: 1,
        time_updated: 1,
      })
      yield* svc.attach({ metaID: created.id, sessionID: sid1 })
      yield* svc.attach({ metaID: created.id, sessionID: sid2 })
      const stats = yield* svc.stats(created.id)
      expect(stats.totalSessions).toBe(2)
      expect(stats.totalTokens).toBeUndefined()
      expect(stats.recordedTokens).toBe(0)
      expect(stats.unknownTokenSessionCount).toBe(2)
      yield* db
        .update(MetaAgentSessionTable)
        .set({ tokens_used: 5 })
        .where(and(eq(MetaAgentSessionTable.meta_agent_id, created.id), eq(MetaAgentSessionTable.session_id, sid1)))
      expect(yield* svc.stats(created.id)).toMatchObject({
        totalTokens: undefined,
        recordedTokens: 5,
        unknownTokenSessionCount: 1,
      })
      yield* db
        .update(MetaAgentSessionTable)
        .set({ tokens_used: 0 })
        .where(and(eq(MetaAgentSessionTable.meta_agent_id, created.id), eq(MetaAgentSessionTable.session_id, sid2)))
      expect(yield* svc.stats(created.id)).toMatchObject({
        totalTokens: 5,
        recordedTokens: 5,
        unknownTokenSessionCount: 0,
      })
      const other = yield* svc.create({
        title: "Other Meta",
        agent: "meta",
        model: { id: "other", providerID: "test" },
      })
      yield* svc.attach({ metaID: other.id, sessionID: sid1 })
      expect(yield* svc.stats(other.id)).toMatchObject({
        totalTokens: undefined,
        recordedTokens: 0,
        unknownTokenSessionCount: 1,
      })
      expect(yield* svc.stats(created.id)).toMatchObject({ totalTokens: 5, unknownTokenSessionCount: 0 })
    }),
  )
})
