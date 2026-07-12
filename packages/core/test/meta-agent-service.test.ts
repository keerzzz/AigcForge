import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@aigcfroge/core/database/database"
import { MetaAgent } from "@aigcfroge/schema/meta-agent"
import { MetaAgentService } from "@aigcfroge/core/meta-agent/service"
import { SessionSchema } from "@aigcfroge/core/session/schema"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AgentV2 } from "@aigcfroge/core/agent"
import { ModelV2 } from "@aigcfroge/core/model"
import { ProjectV2 } from "@aigcfroge/core/project"
import { ProviderV2 } from "@aigcfroge/core/provider"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { testEffect } from "./lib/effect"

const testLayer = Layer.mergeAll(
  MetaAgentService.layer.pipe(Layer.provide(Database.defaultLayer)),
  Database.defaultLayer,
)

const it = testEffect(testLayer as any)

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
      expect(created.agent).toBe(AgentV2.ID.make("meta"))
      expect(created.model.id).toBe(ModelV2.ID.make("gpt-4"))
      expect(created.model.providerID).toBe(ProviderV2.ID.make("openai"))
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
        title: "Attach Test", agent: "meta", model: { id: "gpt-4", providerID: "openai" },
      })
      const pid = ProjectV2.ID.make("proj_attach_test")
      const sid = SessionSchema.ID.make("ses_attach_sess")
      yield* db.insert(ProjectTable).values({
        id: pid, worktree: AbsolutePath.make("/tmp"), sandboxes: [], time_created: 1, time_updated: 1,
      })
      yield* db.insert(SessionTable).values({
        id: sid, project_id: pid, directory: AbsolutePath.make("/tmp"), title: "t", slug: sid, version: "0",
        time_created: Date.now(), time_updated: Date.now(),
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
        title: "Stats Test", agent: "meta", model: { id: "gpt-4", providerID: "openai" },
      })
      const pid = ProjectV2.ID.make("proj_stats_test")
      yield* db.insert(ProjectTable).values({
        id: pid, worktree: AbsolutePath.make("/tmp"), sandboxes: [], time_created: 1, time_updated: 1,
      })
      const sid1 = SessionSchema.ID.make("ses_stats_s1")
      const sid2 = SessionSchema.ID.make("ses_stats_s2")
      yield* db.insert(SessionTable).values({ id: sid1, project_id: pid, directory: AbsolutePath.make("/t"), title: "t", slug: sid1, version: "0", time_created: 1, time_updated: 1 })
      yield* db.insert(SessionTable).values({ id: sid2, project_id: pid, directory: AbsolutePath.make("/t"), title: "t", slug: sid2, version: "0", time_created: 1, time_updated: 1 })
      yield* svc.attach({ metaID: created.id, sessionID: sid1 })
      yield* svc.attach({ metaID: created.id, sessionID: sid2 })
      const stats = yield* svc.stats(created.id)
      expect(stats.totalSessions).toBe(2)
    }),
  )
})
