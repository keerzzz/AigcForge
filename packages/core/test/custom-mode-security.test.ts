import { afterAll, beforeAll, describe, expect } from "bun:test"
import { Cause, Effect, Layer } from "effect"
import { AgentV2 } from "@aigcfroge/core/agent"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { FSUtil } from "@aigcfroge/core/fs-util"
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
import { SkillV2 } from "@aigcfroge/core/skill"
import { TaskDriver } from "@aigcfroge/core/tool/task-driver"
import { TaskTool } from "@aigcfroge/core/tool/task"
import { ToolRegistry } from "@aigcfroge/core/tool/registry"
import { SkillTool } from "@aigcfroge/core/tool/skill"
import { Config } from "@aigcfroge/core/config"
import { computeDigest } from "@aigcfroge/core/composition/digest"
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
const mockRevision = Composition.Revision.make("c".repeat(64))

// Self-consistent tool catalog fixture: assertDependency requires the catalog
// to equal the sorted fingerprint names and the catalog digest to recompute.
const mockToolFingerprints = ["glob", "grep", "read", "task"].map((name, index) => ({
  placement: "/workspace",
  name,
  digest: Composition.Digest.make(String(index).repeat(64)),
  installationVersion: "local",
}))
const mockCatalogDigest = computeDigest(mockToolFingerprints)

let currentSkills: SkillV2.Info[] = []

const skillsStub = Layer.succeed(
  SkillV2.Service,
  SkillV2.Service.of({
    transform: () => Effect.die("unused"),
    reload: () => Effect.die("unused"),
    sources: () => Effect.die("unused"),
    list: () => Effect.succeed(currentSkills),
  }),
)

const skillTool = SkillTool.layer.pipe(
  Layer.provide(ToolRegistry.defaultLayer),
  Layer.provide(permission),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(skillsStub),
)

const mockSnapshot = (
  sessionID: SessionV2.ID,
  allowedAgentID: string = "custom-coder",
  skills: Composition.SkillInfo[] = [],
) =>
  new Composition.SnapshotV1({
    version: 1,
    digest: mockDigest,
    sessionID,
    createdAt: Date.now(),
    data: new Composition.SnapshotDataV1({
      agentID: allowedAgentID,
      instructions: [],
      prompts: [],
      skills,
      tools: new Composition.SnapshotToolInfo({
        fingerprints: mockToolFingerprints,
        catalogDigest: mockCatalogDigest,
        catalog: ["glob", "grep", "read", "task"],
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

const taskDriverRuntime = Layer.effect(
  TaskDriver.Runtime,
  Effect.gen(function* () {
    const sessionService = yield* SessionV2.Service
    return yield* TaskDriver.installForTesting(
      {
        get: sessionService.get,
        create: (input) => sessionService.create(input),
        prompt: (input) => sessionService.prompt(input),
        resume: sessionService.resume,
        messages: sessionService.messages,
        injectSynthetic: sessionService.injectSynthetic,
        interrupt: sessionService.interrupt,
      },
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
  }),
).pipe(Layer.provide(sessions))

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
    skillTool,
  ).pipe(Layer.provideMerge(taskDriverRuntime)),
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
      return TaskDriver.installForTesting(
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
    // Child Session creation now asserts the runtime kill switch, so this block
    // needs Custom mode enabled. The switch itself is covered by the dedicated
    // "Custom Mode Runtime Kill Switch" block below, which keeps it disabled.
    let savedFlag: string | undefined
    beforeAll(() => {
      savedFlag = process.env["AIGCFROGE_CUSTOM_MODE"]
      process.env["AIGCFROGE_CUSTOM_MODE"] = "true"
    })
    afterAll(() => {
      if (savedFlag === undefined) delete process.env["AIGCFROGE_CUSTOM_MODE"]
      else process.env["AIGCFROGE_CUSTOM_MODE"] = savedFlag
    })

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
        if (childSnapshot.version === 1) {
          expect(childSnapshot.data.agentID).toBe("custom-coder")
        }

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

    it.effect("switchAgent rejects agents outside the snapshot allowlist", () =>
      Effect.gen(function* () {
        const sessionService = yield* SessionV2.Service
        const comp = yield* SessionComposition.Service
        const { db } = yield* Database.Service

        const rootSessionID = SessionV2.ID.make("ses_switch_gate_root")
        yield* db.insert(ProjectTable).values({ id: ProjectV2.ID.make("proj_test_5"), worktree: AbsolutePath.make("/workspace"), sandboxes: [] }).onConflictDoNothing().run().pipe(Effect.orDie)
        yield* db.insert(SessionTable).values({
          id: rootSessionID,
          slug: "switch-gate-slug",
          version: "1.0.0",
          project_id: ProjectV2.ID.make("proj_test_5"),
          directory: AbsolutePath.make("/workspace"),
          title: "Switch Gate",
          mode: "custom",
          agent: AgentV2.ID.make("meta"),
          time_created: Date.now(),
          time_updated: Date.now(),
        }).run().pipe(Effect.orDie)
        yield* comp.attach(rootSessionID, mockSnapshot(rootSessionID, "custom-coder"))

        // An in-pool agent switches cleanly.
        yield* sessionService.switchAgent({ sessionID: rootSessionID, agent: "custom-coder" })

        // An out-of-pool agent fails closed with the delegation error.
        const forbiddenSwitch = yield* sessionService
          .switchAgent({ sessionID: rootSessionID, agent: "unauthorized-agent" })
          .pipe(Effect.exit)
        expect(forbiddenSwitch._tag).toBe("Failure")
        if (forbiddenSwitch._tag === "Failure") {
          const error = Cause.findErrorOption(forbiddenSwitch.cause)
          if (error._tag === "Some") {
            expect((error.value as { _tag?: string })._tag).toBe("SessionComposition.AgentDelegationForbiddenError")
          } else {
            expect.unreachable()
          }
        }
      }),
    )
  })

  describe("Custom Mode Runtime Kill Switch", () => {
    it.effect("child Session creation fails closed while the runtime switch is off", () =>
      Effect.gen(function* () {
        const savedFlag = process.env["AIGCFROGE_CUSTOM_MODE"]
        delete process.env["AIGCFROGE_CUSTOM_MODE"]
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            if (savedFlag === undefined) delete process.env["AIGCFROGE_CUSTOM_MODE"]
            else process.env["AIGCFROGE_CUSTOM_MODE"] = savedFlag
          }),
        )
        const sessionService = yield* SessionV2.Service
        const comp = yield* SessionComposition.Service
        const { db } = yield* Database.Service

        const rootSessionID = SessionV2.ID.make("ses_root_custom_killswitch")
        yield* db
          .insert(ProjectTable)
          .values({
            id: ProjectSchema.ID.make("proj_test_killswitch"),
            worktree: AbsolutePath.make("/workspace"),
            sandboxes: [],
          })
          .onConflictDoNothing()
          .run()
          .pipe(Effect.orDie)
        yield* db
          .insert(SessionTable)
          .values({
            id: rootSessionID,
            slug: "root-slug-killswitch",
            version: "1.0.0",
            project_id: ProjectV2.ID.make("proj_test_killswitch"),
            directory: AbsolutePath.make("/workspace"),
            title: "Custom Session",
            mode: "custom",
            agent: AgentV2.ID.make("meta"),
            time_created: Date.now(),
            time_updated: Date.now(),
          })
          .run()
          .pipe(Effect.orDie)
        yield* comp.attach(rootSessionID, mockSnapshot(rootSessionID, "custom-coder"))

        // The agent is inside the snapshot allowlist, so only the disabled
        // runtime switch can reject this child.
        const blocked = yield* sessionService
          .create({
            id: SessionV2.ID.make("ses_child_custom_killswitch"),
            parentID: rootSessionID,
            agent: AgentV2.ID.make("custom-coder"),
            location: { directory: AbsolutePath.make("/workspace") },
          })
          .pipe(Effect.exit)

        expect(blocked._tag).toBe("Failure")
        if (blocked._tag === "Failure") {
          expect(Cause.squash(blocked.cause)).toMatchObject({ _tag: "UnsupportedProductModeError" })
        }
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
        if (validated.version === 1) {
          expect(validated.data.agentID).toBe("custom-coder")
        }
        expect(validated.digest).toBe(mockSnapshot(sessionID).digest)
      }),
    )
  })
})

const boundSkill: SkillV2.Info = {
  name: "bound-skill",
  description: "Bound skill",
  location: AbsolutePath.make("/workspace/skills/bound.md"),
  content: "BOUND SKILL CONTENT",
}

const outsideSkill: SkillV2.Info = {
  name: "outside-skill",
  description: "Outside skill",
  location: AbsolutePath.make("/workspace/skills/outside.md"),
  content: "OUTSIDE SKILL CONTENT",
}

const snapshotSkills = [
  new Composition.SkillInfo({
    name: "bound-skill",
    description: "Bound skill",
    relativePath: "skills/bound.md",
    revision: mockRevision,
  }),
]

describe("Skill Tool Snapshot-Local Lookup (MEDIUM-2a)", () => {
  it.effect("loads an in-snapshot skill in Custom mode", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const comp = yield* SessionComposition.Service
      const sessionID = SessionV2.ID.make("ses_skill_snap_in")
      currentSkills = [boundSkill, outsideSkill]

      yield* db.insert(ProjectTable).values({ id: ProjectSchema.ID.make("proj_sk_1"), worktree: AbsolutePath.make("/workspace"), sandboxes: [] }).onConflictDoNothing().run().pipe(Effect.orDie)
      yield* db.insert(SessionTable).values({
        id: sessionID,
        slug: "sk-slug-1",
        version: "1.0.0",
        project_id: ProjectV2.ID.make("proj_sk_1"),
        directory: AbsolutePath.make("/workspace"),
        title: "Custom Session",
        mode: "custom",
        agent: AgentV2.ID.make("meta"),
        time_created: Date.now(),
        time_updated: Date.now(),
      }).run().pipe(Effect.orDie)
      yield* comp.attach(sessionID, mockSnapshot(sessionID, "custom-coder", snapshotSkills))

      const reg = yield* ToolRegistry.Service
      const materialized = yield* reg.materialize()
      const settlement = yield* materialized.settle({
        sessionID,
        agent: AgentV2.ID.make("meta"),
        assistantMessageID: SessionMessage.ID.make("msg_sk_1"),
        call: { type: "tool-call", id: "call-sk-1", name: "skill", input: { name: "bound-skill" } },
      })

      expect(settlement.result.type).toBe("text")
      if (settlement.result.type === "text") {
        expect(settlement.result.value).toContain("BOUND SKILL CONTENT")
      }
    }),
  )

  it.effect("rejects an out-of-snapshot skill in Custom mode", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const comp = yield* SessionComposition.Service
      const sessionID = SessionV2.ID.make("ses_skill_snap_out")
      currentSkills = [boundSkill, outsideSkill]

      yield* db.insert(ProjectTable).values({ id: ProjectSchema.ID.make("proj_sk_2"), worktree: AbsolutePath.make("/workspace"), sandboxes: [] }).onConflictDoNothing().run().pipe(Effect.orDie)
      yield* db.insert(SessionTable).values({
        id: sessionID,
        slug: "sk-slug-2",
        version: "1.0.0",
        project_id: ProjectV2.ID.make("proj_sk_2"),
        directory: AbsolutePath.make("/workspace"),
        title: "Custom Session",
        mode: "custom",
        agent: AgentV2.ID.make("meta"),
        time_created: Date.now(),
        time_updated: Date.now(),
      }).run().pipe(Effect.orDie)
      yield* comp.attach(sessionID, mockSnapshot(sessionID, "custom-coder", snapshotSkills))

      const reg = yield* ToolRegistry.Service
      const materialized = yield* reg.materialize()
      const settlement = yield* materialized.settle({
        sessionID,
        agent: AgentV2.ID.make("meta"),
        assistantMessageID: SessionMessage.ID.make("msg_sk_2"),
        call: { type: "tool-call", id: "call-sk-2", name: "skill", input: { name: "outside-skill" } },
      })

      expect(settlement.result.type).toBe("error")
      if (settlement.result.type === "error") {
        expect(settlement.result.value).toContain("Unable to load skill outside-skill")
      }
    }),
  )

  it.effect("keeps the global skill catalog in Coding mode", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const sessionID = SessionV2.ID.make("ses_skill_coding")
      currentSkills = [boundSkill, outsideSkill]

      yield* db.insert(ProjectTable).values({ id: ProjectSchema.ID.make("proj_sk_3"), worktree: AbsolutePath.make("/workspace"), sandboxes: [] }).onConflictDoNothing().run().pipe(Effect.orDie)
      yield* db.insert(SessionTable).values({
        id: sessionID,
        slug: "sk-slug-3",
        version: "1.0.0",
        project_id: ProjectV2.ID.make("proj_sk_3"),
        directory: AbsolutePath.make("/workspace"),
        title: "Coding Session",
        mode: "coding",
        agent: AgentV2.ID.make("build"),
        time_created: Date.now(),
        time_updated: Date.now(),
      }).run().pipe(Effect.orDie)

      const reg = yield* ToolRegistry.Service
      const materialized = yield* reg.materialize()
      const settlement = yield* materialized.settle({
        sessionID,
        agent: AgentV2.ID.make("build"),
        assistantMessageID: SessionMessage.ID.make("msg_sk_3"),
        call: { type: "tool-call", id: "call-sk-3", name: "skill", input: { name: "outside-skill" } },
      })

      expect(settlement.result.type).toBe("text")
      if (settlement.result.type === "text") {
        expect(settlement.result.value).toContain("OUTSIDE SKILL CONTENT")
      }
    }),
  )

  it.effect("fails closed when the Custom session snapshot row is missing", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const sessionID = SessionV2.ID.make("ses_skill_snap_missing")
      currentSkills = [boundSkill, outsideSkill]

      yield* db.insert(ProjectTable).values({ id: ProjectSchema.ID.make("proj_sk_4"), worktree: AbsolutePath.make("/workspace"), sandboxes: [] }).onConflictDoNothing().run().pipe(Effect.orDie)
      yield* db.insert(SessionTable).values({
        id: sessionID,
        slug: "sk-slug-4",
        version: "1.0.0",
        project_id: ProjectV2.ID.make("proj_sk_4"),
        directory: AbsolutePath.make("/workspace"),
        title: "Custom Session",
        mode: "custom",
        agent: AgentV2.ID.make("meta"),
        time_created: Date.now(),
        time_updated: Date.now(),
      }).run().pipe(Effect.orDie)

      const reg = yield* ToolRegistry.Service
      const materialized = yield* reg.materialize()
      const settlement = yield* materialized.settle({
        sessionID,
        agent: AgentV2.ID.make("meta"),
        assistantMessageID: SessionMessage.ID.make("msg_sk_4"),
        call: { type: "tool-call", id: "call-sk-4", name: "skill", input: { name: "bound-skill" } },
      })

      expect(settlement.result.type).toBe("error")
      if (settlement.result.type === "error") {
        expect(settlement.result.value).toContain("Custom session snapshot not found")
      }
    }),
  )
})

// Tier-1 fail-closed seam: when the TaskDriver bridge reports Custom mode but
// SessionComposition is absent from the tool context, both gated tools must
// fail instead of silently skipping the delegation/skill gates. A dedicated
// harness is required because the shared one merges SessionComposition for the
// other suites. The stub facade scopes "custom" to bareSessionID so the
// process-global bridge stays permissive for every other Session (including
// later test files in this process).
const bareSessionID = SessionV2.ID.make("ses_bare_gate")

const taskToolNoComposition = TaskTool.layer.pipe(
  Layer.provide(ToolRegistry.defaultLayer),
  Layer.provide(config),
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(AgentV2.layer),
  Layer.provide(permission),
  Layer.provide(SessionTask.defaultLayer),
)

const skillToolNoComposition = SkillTool.layer.pipe(
  Layer.provide(ToolRegistry.defaultLayer),
  Layer.provide(permission),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(skillsStub),
)

const bareTaskDriverRuntime = Layer.effect(
  TaskDriver.Runtime,
  TaskDriver.installForTesting(
    {
      get: (sessionID) =>
        Effect.succeed({
          location: { directory: AbsolutePath.make("/workspace") },
          mode: sessionID === bareSessionID ? "custom" : undefined,
        }),
      create: () => Effect.die("unused"),
      prompt: () => Effect.die("unused"),
      resume: () => Effect.die("unused"),
      messages: () => Effect.die("unused"),
      injectSynthetic: () => Effect.die("unused"),
      interrupt: () => Effect.void,
    },
    {
      start: () => Effect.void,
      wait: () => Effect.succeed(undefined),
      extend: () => Effect.succeed(false),
      cancel: () => Effect.void,
    },
  ),
)

const itBare = testEffect(
  Layer.mergeAll(
    Database.defaultLayer,
    EventV2.defaultLayer,
    AgentV2.layer,
    ToolRegistry.defaultLayer,
    permission,
    config,
    SessionTask.defaultLayer,
    taskToolNoComposition,
    skillToolNoComposition,
  ).pipe(Layer.provideMerge(bareTaskDriverRuntime)),
)

describe("Fail-Closed Without Snapshot Service", () => {
  itBare.effect("task tool fails closed when SessionComposition is unavailable", () =>
    Effect.gen(function* () {
      const agentService = yield* AgentV2.Service
      yield* agentService.transform((draft) => {
        draft.update(AgentV2.ID.make("custom-coder"), (a) => {
          a.mode = "subagent"
        })
      })
      const reg = yield* ToolRegistry.Service
      const materialized = yield* reg.materialize()
      const settlement = yield* materialized.settle({
        sessionID: bareSessionID,
        agent: AgentV2.ID.make("meta"),
        assistantMessageID: SessionMessage.ID.make("msg_bare_task"),
        call: {
          type: "tool-call",
          id: "call-bare-task",
          name: "task",
          input: { description: "delegate", prompt: "do something", subagent_type: "custom-coder" },
        },
      })

      expect(settlement.result.type).toBe("error")
      if (settlement.result.type === "error") {
        expect(settlement.result.value).toContain("Custom session snapshot service unavailable")
      }
    }),
  )

  itBare.effect("skill tool fails closed when SessionComposition is unavailable", () =>
    Effect.gen(function* () {
      currentSkills = [boundSkill]
      const reg = yield* ToolRegistry.Service
      const materialized = yield* reg.materialize()
      const settlement = yield* materialized.settle({
        sessionID: bareSessionID,
        agent: AgentV2.ID.make("meta"),
        assistantMessageID: SessionMessage.ID.make("msg_bare_skill"),
        call: {
          type: "tool-call",
          id: "call-bare-skill",
          name: "skill",
          input: { name: "bound-skill" },
        },
      })

      expect(settlement.result.type).toBe("error")
      if (settlement.result.type === "error") {
        expect(settlement.result.value).toContain("Custom session snapshot service unavailable")
      }
    }),
  )
})
