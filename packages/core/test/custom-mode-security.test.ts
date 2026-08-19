import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AgentV2 } from "@aigcfroge/core/agent"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { Location } from "@aigcfroge/core/location"
import { PermissionV2 } from "@aigcfroge/core/permission"
import { PermissionEffective } from "@aigcfroge/core/permission/effective"
import { ProductModeAgentPolicy } from "@aigcfroge/core/product-mode-agent-policy"
import { Project, ProjectV2 } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { ProjectSchema } from "@aigcfroge/core/project/schema"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionSchema } from "@aigcfroge/core/session/schema"
import { SessionStore } from "@aigcfroge/core/session/store"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionTask } from "@aigcfroge/core/session/task"
import { TaskDriver } from "@aigcfroge/core/tool/task-driver"
import { TaskTool } from "@aigcfroge/core/tool/task"
import { ToolRegistry } from "@aigcfroge/core/tool/registry"
import { Config } from "@aigcfroge/core/config"
import { Composition } from "@aigcfroge/schema/composition"
import { testEffect } from "./lib/effect"

const location = Location.layer({ directory: AbsolutePath.make("/workspace") }).pipe(
  Layer.provide(Project.defaultLayer),
)

const sessionComposition = SessionComposition.layer.pipe(Layer.provide(Database.defaultLayer))

const config = Layer.succeed(
  Config.Service,
  Config.Service.of({
    entries: () => Effect.succeed([]),
  }),
)

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: () => Effect.void,
    ask: () => Effect.die("unused"),
    effectiveRules: () => Effect.succeed([]),
    reply: () => Effect.void,
    get: () => Effect.succeed(undefined),
    forSession: () => Effect.succeed([]),
    list: () => Effect.succeed([]),
  }),
)

const mockDigest = Composition.Digest.make("a".repeat(64))
const mockCatalogDigest = Composition.Digest.make("b".repeat(64))

const mockSnapshot = (sessionID: SessionV2.ID, allowedAgentID: string = "custom-coder") =>
  new Composition.Snapshot({
    version: 1,
    digest: mockDigest,
    sessionID,
    createdAt: Date.now(),
    data: new Composition.SnapshotData({
      agentID: allowedAgentID,
      instructions: [],
      prompts: [],
      skills: [],
      tools: new Composition.SnapshotToolInfo({
        fingerprints: [],
        catalogDigest: mockCatalogDigest,
        catalog: ["read", "glob", "grep", "task"],
      }),
    }),
  })

const sessions = SessionV2.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      EventV2.defaultLayer,
      Database.defaultLayer,
      SessionStore.defaultLayer,
      Project.defaultLayer,
      sessionComposition,
      SessionExecution.noopLayer,
    ),
  ),
)

const taskTool = TaskTool.layer.pipe(
  Layer.provide(ToolRegistry.defaultLayer),
  Layer.provide(config),
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(sessionComposition),
  Layer.provide(AgentV2.layer),
  Layer.provide(permission),
  Layer.provide(SessionTask.defaultLayer),
)

const it = testEffect(
  Layer.mergeAll(
    Database.defaultLayer,
    EventV2.defaultLayer,
    SessionProjector.defaultLayer,
    SessionStore.defaultLayer,
    SessionTask.defaultLayer,
    sessionComposition,
    location,
    permission,
    config,
    AgentV2.layer,
    ToolRegistry.defaultLayer,
    sessions,
    taskTool,
  ),
)

describe("Custom Mode Security & Delegation Two-Tier Gate", () => {
  describe("Root Agent Invariant", () => {
    it.effect("allows only meta as primary/root agent in custom mode", () =>
      Effect.gen(function* () {
        const metaVerdict = ProductModeAgentPolicy.checkPrimaryAgent("custom", "meta")
        expect(metaVerdict.allowed).toBe(true)

        const coderVerdict = ProductModeAgentPolicy.checkPrimaryAgent("custom", "custom-coder")
        expect(coderVerdict.allowed).toBe(false)
        if (!coderVerdict.allowed) {
          expect(coderVerdict.error._tag).toBe("AgentNotAllowedError")
        }

        const buildVerdict = ProductModeAgentPolicy.checkPrimaryAgent("custom", "build")
        expect(buildVerdict.allowed).toBe(false)
      }),
    )

    it.effect("SessionV2.create rejects generic root creation for custom mode", () =>
      Effect.gen(function* () {
        const sessionService = yield* SessionV2.Service
        const result = yield* sessionService
          .create({
            mode: "custom",
            agent: AgentV2.ID.make("meta"),
            location: { directory: AbsolutePath.make("/workspace") },
          })
          .pipe(Effect.exit)

        expect(result._tag).toBe("Failure")
      }),
    )
  })

  describe("Tier 1 Gate: Task Tool Precheck in Custom Mode", () => {
    const installDriver = (sessionService: SessionV2.Interface) => {
      const facade: TaskDriver.SessionFacade = {
        get: sessionService.get,
        create: (input) => sessionService.create(input),
        prompt: (input) => sessionService.prompt(input),
        resume: sessionService.resume,
        messages: sessionService.messages,
        injectSynthetic: sessionService.injectSynthetic,
        interrupt: sessionService.interrupt,
      }
      TaskDriver.install(
        facade,
        {
          start: () => Effect.void,
          wait: () => Effect.succeed(undefined),
          extend: () => Effect.succeed(false),
          cancel: () => Effect.void,
        },
        {
          execute: () => Effect.succeed({ text: "", sessionID: SessionSchema.ID.make("s"), status: "success" as const }),
        },
      )
    }

    it.effect("rejects external-cli execution in Custom mode", () =>
      Effect.gen(function* () {
        const sessionService = yield* SessionV2.Service
        installDriver(sessionService)
        const agentService = yield* AgentV2.Service
        yield* agentService.transform((draft) => {
          draft.update(AgentV2.ID.make("custom-coder"), (a) => {
            a.mode = "subagent"
          })
        })
        const reg = yield* ToolRegistry.Service
        const { db } = yield* Database.Service
        const comp = yield* SessionComposition.Service
        const rootSessionID = SessionV2.ID.make("ses_task_cli_test")

        yield* db.insert(ProjectTable).values({ id: ProjectSchema.ID.make("proj_t1_1"), worktree: AbsolutePath.make("/workspace"), sandboxes: [] }).onConflictDoNothing().run().pipe(Effect.orDie)
        yield* db.insert(SessionTable).values({
          id: rootSessionID,
          slug: "t1-slug-1",
          version: "1.0.0",
          project_id: ProjectV2.ID.make("proj_t1_1"),
          directory: AbsolutePath.make("/workspace"),
          title: "Custom Session",
          mode: "custom",
          agent: AgentV2.ID.make("meta"),
          time_created: Date.now(),
          time_updated: Date.now(),
        }).run().pipe(Effect.orDie)
        yield* comp.attach(rootSessionID, mockSnapshot(rootSessionID, "custom-coder"))

        const materialized = yield* reg.materialize()
        const assistantMessageID = SessionMessage.ID.make("msg_task_t1")

        const settlement = yield* materialized.settle({
          sessionID: rootSessionID,
          agent: AgentV2.ID.make("meta"),
          assistantMessageID,
          call: {
            type: "tool-call",
            id: "call-cli",
            name: "task",
            input: {
              description: "run cli",
              prompt: "do something",
              subagent_type: "custom-coder",
              execution_type: "external-cli",
              cli_target: "claude-code",
            },
          },
        })

        expect(settlement.result.type).toBe("error")
        if (settlement.result.type === "error") {
          expect(settlement.result.value).toContain("External CLI execution is not permitted in Custom mode")
        }
      }),
    )

    it.effect("rejects judge execution in Custom mode", () =>
      Effect.gen(function* () {
        const sessionService = yield* SessionV2.Service
        installDriver(sessionService)
        const agentService = yield* AgentV2.Service
        yield* agentService.transform((draft) => {
          draft.update(AgentV2.ID.make("custom-coder"), (a) => {
            a.mode = "subagent"
          })
        })
        const reg = yield* ToolRegistry.Service
        const { db } = yield* Database.Service
        const comp = yield* SessionComposition.Service
        const rootSessionID = SessionV2.ID.make("ses_task_judge_test")

        yield* db.insert(ProjectTable).values({ id: ProjectSchema.ID.make("proj_t1_2"), worktree: AbsolutePath.make("/workspace"), sandboxes: [] }).onConflictDoNothing().run().pipe(Effect.orDie)
        yield* db.insert(SessionTable).values({
          id: rootSessionID,
          slug: "t1-slug-2",
          version: "1.0.0",
          project_id: ProjectV2.ID.make("proj_t1_2"),
          directory: AbsolutePath.make("/workspace"),
          title: "Custom Session",
          mode: "custom",
          agent: AgentV2.ID.make("meta"),
          time_created: Date.now(),
          time_updated: Date.now(),
        }).run().pipe(Effect.orDie)
        yield* comp.attach(rootSessionID, mockSnapshot(rootSessionID, "custom-coder"))

        const materialized = yield* reg.materialize()
        const assistantMessageID = SessionMessage.ID.make("msg_task_t2")

        const settlement = yield* materialized.settle({
          sessionID: rootSessionID,
          agent: AgentV2.ID.make("meta"),
          assistantMessageID,
          call: {
            type: "tool-call",
            id: "call-judge",
            name: "task",
            input: {
              description: "run judge",
              prompt: "do something",
              subagent_type: "custom-coder",
              execution_type: "judge",
              judge_models: ["gpt-5", "claude-sonnet-4"],
            },
          },
        })

        expect(settlement.result.type).toBe("error")
        if (settlement.result.type === "error") {
          expect(settlement.result.value).toContain("Judge execution is not permitted in Custom mode")
        }
      }),
    )

    it.effect("rejects background subagent execution in Custom mode", () =>
      Effect.gen(function* () {
        const sessionService = yield* SessionV2.Service
        installDriver(sessionService)
        const agentService = yield* AgentV2.Service
        yield* agentService.transform((draft) => {
          draft.update(AgentV2.ID.make("custom-coder"), (a) => {
            a.mode = "subagent"
          })
        })
        const reg = yield* ToolRegistry.Service
        const { db } = yield* Database.Service
        const comp = yield* SessionComposition.Service
        const rootSessionID = SessionV2.ID.make("ses_task_bg_test")

        yield* db.insert(ProjectTable).values({ id: ProjectSchema.ID.make("proj_t1_3"), worktree: AbsolutePath.make("/workspace"), sandboxes: [] }).onConflictDoNothing().run().pipe(Effect.orDie)
        yield* db.insert(SessionTable).values({
          id: rootSessionID,
          slug: "t1-slug-3",
          version: "1.0.0",
          project_id: ProjectV2.ID.make("proj_t1_3"),
          directory: AbsolutePath.make("/workspace"),
          title: "Custom Session",
          mode: "custom",
          agent: AgentV2.ID.make("meta"),
          time_created: Date.now(),
          time_updated: Date.now(),
        }).run().pipe(Effect.orDie)
        yield* comp.attach(rootSessionID, mockSnapshot(rootSessionID, "custom-coder"))

        const materialized = yield* reg.materialize()
        const assistantMessageID = SessionMessage.ID.make("msg_task_t3")

        const settlement = yield* materialized.settle({
          sessionID: rootSessionID,
          agent: AgentV2.ID.make("meta"),
          assistantMessageID,
          call: {
            type: "tool-call",
            id: "call-bg",
            name: "task",
            input: {
              description: "run bg",
              prompt: "do something",
              subagent_type: "custom-coder",
              background: true,
            },
          },
        })

        expect(settlement.result.type).toBe("error")
        if (settlement.result.type === "error") {
          expect(settlement.result.value).toContain("Background subagent delegation is not permitted in Custom mode")
        }
      }),
    )

    it.effect("rejects delegation to unauthorized agent in Custom mode", () =>
      Effect.gen(function* () {
        const sessionService = yield* SessionV2.Service
        installDriver(sessionService)
        const agentService = yield* AgentV2.Service
        yield* agentService.transform((draft) => {
          draft.update(AgentV2.ID.make("forbidden-agent"), (a) => {
            a.mode = "subagent"
          })
        })
        const reg = yield* ToolRegistry.Service
        const { db } = yield* Database.Service
        const comp = yield* SessionComposition.Service
        const rootSessionID = SessionV2.ID.make("ses_task_unauth_test")

        yield* db.insert(ProjectTable).values({ id: ProjectSchema.ID.make("proj_t1_4"), worktree: AbsolutePath.make("/workspace"), sandboxes: [] }).onConflictDoNothing().run().pipe(Effect.orDie)
        yield* db.insert(SessionTable).values({
          id: rootSessionID,
          slug: "t1-slug-4",
          version: "1.0.0",
          project_id: ProjectV2.ID.make("proj_t1_4"),
          directory: AbsolutePath.make("/workspace"),
          title: "Custom Session",
          mode: "custom",
          agent: AgentV2.ID.make("meta"),
          time_created: Date.now(),
          time_updated: Date.now(),
        }).run().pipe(Effect.orDie)
        yield* comp.attach(rootSessionID, mockSnapshot(rootSessionID, "custom-coder"))

        const materialized = yield* reg.materialize()
        const assistantMessageID = SessionMessage.ID.make("msg_task_t4")

        const settlement = yield* materialized.settle({
          sessionID: rootSessionID,
          agent: AgentV2.ID.make("meta"),
          assistantMessageID,
          call: {
            type: "tool-call",
            id: "call-unauth",
            name: "task",
            input: {
              description: "run forbidden",
              prompt: "do something",
              subagent_type: "forbidden-agent",
            },
          },
        })

        expect(settlement.result.type).toBe("error")
        if (settlement.result.type === "error") {
          expect(settlement.result.value).toContain("Agent 'forbidden-agent' is not permitted in this Custom session")
        }
      }),
    )
  })

  describe("assertAgentAllowed and Snapshot Delegation (Tier 2 Gate)", () => {
    it.effect("assertAgentAllowed succeeds for matching snapshot agent and fails for other agents", () =>
      Effect.gen(function* () {
        const comp = yield* SessionComposition.Service
        const { db } = yield* Database.Service
        const rootSessionID = SessionV2.ID.make("ses_custom_root_1")

        yield* db.insert(ProjectTable).values({ id: ProjectSchema.ID.make("proj_test_1"), worktree: AbsolutePath.make("/workspace"), sandboxes: [] }).onConflictDoNothing().run().pipe(Effect.orDie)
        yield* db.insert(SessionTable).values({
          id: rootSessionID,
          slug: "root-slug-1",
          version: "1.0.0",
          project_id: ProjectV2.ID.make("proj_test_1"),
          directory: AbsolutePath.make("/workspace"),
          title: "Custom Session",
          mode: "custom",
          agent: AgentV2.ID.make("meta"),
          time_created: Date.now(),
          time_updated: Date.now(),
        }).run().pipe(Effect.orDie)

        yield* comp.attach(rootSessionID, mockSnapshot(rootSessionID, "custom-coder"))

        // Allowed agent
        const allowedExit = yield* comp.assertAgentAllowed(rootSessionID, "custom-coder").pipe(Effect.exit)
        expect(allowedExit._tag).toBe("Success")

        // Forbidden agent
        const forbiddenExit = yield* comp.assertAgentAllowed(rootSessionID, "other-agent").pipe(Effect.exit)
        expect(forbiddenExit._tag).toBe("Failure")
        if (forbiddenExit._tag === "Failure") {
          const err = yield* comp.assertAgentAllowed(rootSessionID, "other-agent").pipe(Effect.flip)
          expect(err._tag).toBe("SessionComposition.AgentDelegationForbiddenError")
          if (err._tag === "SessionComposition.AgentDelegationForbiddenError") {
            expect(err.allowedAgentID).toBe("custom-coder")
          }
        }
      }),
    )

    it.effect("SessionV2.create child under custom parent enforces allowed agent and copies snapshot", () =>
      Effect.gen(function* () {
        const sessionService = yield* SessionV2.Service
        const comp = yield* SessionComposition.Service
        const { db } = yield* Database.Service

        // Create root custom session via DB + attach snapshot
        const rootSessionID = SessionV2.ID.make("ses_root_custom_sec")
        yield* db.insert(ProjectTable).values({ id: ProjectSchema.ID.make("proj_test_2"), worktree: AbsolutePath.make("/workspace"), sandboxes: [] }).onConflictDoNothing().run().pipe(Effect.orDie)
        yield* db.insert(SessionTable).values({
          id: rootSessionID,
          slug: "root-slug-2",
          version: "1.0.0",
          project_id: ProjectV2.ID.make("proj_test_2"),
          directory: AbsolutePath.make("/workspace"),
          title: "Custom Session",
          mode: "custom",
          agent: AgentV2.ID.make("meta"),
          time_created: Date.now(),
          time_updated: Date.now(),
        }).run().pipe(Effect.orDie)

        yield* comp.attach(rootSessionID, mockSnapshot(rootSessionID, "custom-coder"))

        // Child session with matching snapshot agent succeeds
        const childSession = yield* sessionService.create({
          id: SessionV2.ID.make("ses_child_custom_valid"),
          parentID: rootSessionID,
          agent: AgentV2.ID.make("custom-coder"),
          location: { directory: AbsolutePath.make("/workspace") },
        })
        expect(childSession.parentID).toBe(rootSessionID)
        expect(childSession.agent).toBe(AgentV2.ID.make("custom-coder"))
        expect(childSession.mode).toBe("custom")

        // Snapshot was copied to child
        const childSnapshot = yield* comp.get(childSession.id)
        expect(childSnapshot.digest).toBe(mockSnapshot(rootSessionID).digest)
        expect(childSnapshot.data.agentID).toBe("custom-coder")

        // Child session with forbidden agent fails
        const forbiddenChild = yield* sessionService
          .create({
            id: SessionV2.ID.make("ses_child_custom_invalid"),
            parentID: rootSessionID,
            agent: AgentV2.ID.make("unauthorized-agent"),
            location: { directory: AbsolutePath.make("/workspace") },
          })
          .pipe(Effect.exit)

        expect(forbiddenChild._tag).toBe("Failure")
      }),
    )
  })

  describe("Permission Ceiling in Custom Mode", () => {
    it.effect("Custom mode does not elevate permissions to ask wildcard", () =>
      Effect.gen(function* () {
        const baseRules = [
          { action: "*", resource: "*", effect: "deny" as const },
          { action: "read", resource: "*", effect: "allow" as const },
          { action: "edit", resource: "*", effect: "ask" as const },
        ]
        const effective = PermissionEffective.effectiveV2(
          {
            mode: "custom",
            agent: "custom-coder",
            tier: "full",
            attended: true,
            masterPermissionEnabled: false,
            savedApprovals: [],
          },
          baseRules,
        )

        // Unknown action remains deny (no elevation to ask)
        expect(PermissionEffective.evaluate(effective, "some_unknown_action", "*")).toBe("deny")
        expect(PermissionEffective.evaluate(effective, "read", "file.ts")).toBe("allow")
        expect(PermissionEffective.evaluate(effective, "edit", "file.ts")).toBe("ask")
      }),
    )

    it.effect("Custom mode preserves deny ceiling against masterPermissionEnabled and savedApprovals", () =>
      Effect.gen(function* () {
        const baseRules = [
          { action: "*", resource: "*", effect: "deny" as const },
          { action: "read", resource: "*", effect: "allow" as const },
          { action: "bash", resource: "*", effect: "deny" as const },
        ]

        const effectiveWithMaster = PermissionEffective.effectiveV2(
          {
            mode: "custom",
            agent: "custom-coder",
            tier: "full",
            attended: true,
            masterPermissionEnabled: true,
            savedApprovals: [{ action: "bash", resource: "*" }],
          },
          baseRules,
        )

        // Explicit bash deny cannot be elevated by saved approval or master permission
        expect(PermissionEffective.evaluate(effectiveWithMaster, "bash", "*")).toBe("deny")
      }),
    )
  })

  describe("Snapshot Dependency Verification", () => {
    it.effect("assertDependency validates snapshot data completeness", () =>
      Effect.gen(function* () {
        const comp = yield* SessionComposition.Service
        const { db } = yield* Database.Service
        const sessionID = SessionV2.ID.make("ses_dep_test")

        yield* db.insert(ProjectTable).values({ id: ProjectSchema.ID.make("proj_test_3"), worktree: AbsolutePath.make("/workspace"), sandboxes: [] }).onConflictDoNothing().run().pipe(Effect.orDie)
        yield* db.insert(SessionTable).values({
          id: sessionID,
          slug: "dep-slug",
          version: "1.0.0",
          project_id: ProjectV2.ID.make("proj_test_3"),
          directory: AbsolutePath.make("/workspace"),
          title: "Custom Session",
          mode: "custom",
          agent: AgentV2.ID.make("meta"),
          time_created: Date.now(),
          time_updated: Date.now(),
        }).run().pipe(Effect.orDie)

        yield* comp.attach(sessionID, mockSnapshot(sessionID, "custom-coder"))

        const validated = yield* comp.assertDependency(sessionID)
        expect(validated.data.agentID).toBe("custom-coder")
        expect(validated.digest).toBe(mockSnapshot(sessionID).digest)
      }),
    )
  })
})
