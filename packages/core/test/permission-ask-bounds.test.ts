import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer, Option } from "effect"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { AgentV2 } from "@aigcfroge/core/agent"
import { ApprovalPresence } from "@aigcfroge/core/permission/approval-presence"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { Location } from "@aigcfroge/core/location"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionStore } from "@aigcfroge/core/session/store"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { SessionV2 } from "@aigcfroge/core/session"
import { PermissionSaved } from "@aigcfroge/core/permission/saved"
import { PermissionV2 } from "@aigcfroge/core/permission"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

// ADR-20 §2.7: an `ask` may only wait while a capable responder is attached,
// and never longer than the configured TTL. Both bounds fail typed and clear
// the pending request.

const current = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
)
const sessions = SessionV2.layer.pipe(
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(Database.defaultLayer),
  Layer.provide(SessionStore.defaultLayer),
  Layer.provide(Project.defaultLayer),
  Layer.provide(SessionExecution.noopLayer),
)
const harness = (presence: Layer.Layer<ApprovalPresence.Service> = ApprovalPresence.locationLayer) =>
  PermissionV2.locationLayer.pipe(
  Layer.provideMerge(Database.defaultLayer),
  Layer.provideMerge(SessionStore.defaultLayer),
  Layer.provideMerge(EventV2.defaultLayer),
  Layer.provideMerge(current),
  Layer.provideMerge(sessions),
  Layer.provideMerge(SessionExecution.noopLayer),
  Layer.provideMerge(PermissionSaved.defaultLayer),
  Layer.provideMerge(presence),
)
const it = testEffect(harness())

const setup = (rules: PermissionV2.Ruleset) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: SessionV2.ID.make("ses_ask_ttl"),
        project_id: Project.ID.global,
        slug: "ses_ask_ttl",
        directory: AbsolutePath.make("/project"),
        title: "ask ttl",
        version: "test",
        mode: "custom",
        agent: AgentV2.ID.make("test"),
        attended: null,
        time_created: Date.now(),
        time_updated: Date.now(),
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    const agents = yield* AgentV2.Service
    yield* agents.transform((editor) =>
      editor.update(AgentV2.ID.make("test"), (agent) => {
        agent.permissions = [...rules]
      }),
    )
    return SessionV2.ID.make("ses_ask_ttl")
  })

describe("ApprovalPresence × ask bounds (ADR-20 §2.7)", () => {
  it.effect("rejects the ask immediately when no capable responder is attached", () =>
    Effect.gen(function* () {
      const presence = yield* ApprovalPresence.Service
      // No responder is bound for this runtime: the fact source reports zero.
      const sessionID = yield* setup([{ action: "bash", resource: "*", effect: "ask" }])
      const service = yield* PermissionV2.Service

      const exit = yield* service
        .assert({ sessionID, action: "bash", resources: ["/tmp/run.sh"], agent: AgentV2.ID.make("test") })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause) instanceof PermissionV2.RejectedError).toBe(true)
      }
      expect(yield* service.forSession(sessionID)).toHaveLength(0)
    }),
  )

  // Short-TTL variant runs on its own runtime (real clock, 10ms bound).
  it.effect("still resolves through reply while inside the TTL window", () =>
    Effect.gen(function* () {
      const presence = yield* ApprovalPresence.Service
      yield* presence.bindResponder()
      const sessionID = yield* setup([{ action: "bash", resource: "*", effect: "ask" }])
      const service = yield* PermissionV2.Service

      yield* service.ask({ sessionID, action: "bash", resources: ["/tmp/run.sh"], agent: AgentV2.ID.make("test") })
      const pending = yield* service.forSession(sessionID)
      expect(pending).toHaveLength(1)
      yield* service.reply({ requestID: pending[0]!.id, reply: "once" })
      expect(yield* service.forSession(sessionID)).toHaveLength(0)
    }),
  )
})

describe("ApprovalPresence × ask TTL (short, live clock)", () => {
  const itTtl = testEffect(harness(ApprovalPresence.make(10)))
  itTtl.live("expires the ask with a typed error once the TTL elapses unanswered", () =>
    Effect.gen(function* () {
      const presence = yield* ApprovalPresence.Service
      yield* presence.bindResponder() // attached but never answers
      expect(presence.ttlMs).toBe(10)
      const sessionID = yield* setup([{ action: "bash", resource: "*", effect: "ask" }])
      const service = yield* PermissionV2.Service

      const exit = yield* service
        .assert({ sessionID, action: "bash", resources: ["/tmp/run.sh"], agent: AgentV2.ID.make("test") })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause) instanceof PermissionV2.AskExpiredError).toBe(true)
      }
      expect(yield* service.forSession(sessionID)).toHaveLength(0)
    }),
  )
})
