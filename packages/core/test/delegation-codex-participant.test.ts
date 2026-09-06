/**
 * Phase 3 contract tests: Codex participant and external CLI binding.
 *
 * This suite deliberately calls only the contracts that exist on the current
 * branch. Participant-aware execution crosses the real TaskDriver seam through
 * DeliveryContext; no test-only interface or unsafe cast is used.
 */

import { describe, expect } from "bun:test"
import { sql } from "drizzle-orm"
import { Cause, Effect, Exit, Layer } from "effect"
import { BackgroundJob } from "@aigcfroge/core/background-job"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { MetaAgentService } from "@aigcfroge/core/meta-agent/service"
import { ProjectV2 } from "@aigcfroge/core/project"
import { SessionV2 } from "@aigcfroge/core/session"
import { Location } from "@aigcfroge/core/location"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionStore } from "@aigcfroge/core/session/store"
import { TaskDriverFill } from "@aigcfroge/core/session/task-driver-fill"
import { TaskDriver } from "@aigcfroge/core/tool/task-driver"
import { CliAdapter, registerCliAdapter } from "@aigcfroge/core/tool/cli-adapter"
import { makeCodexSdkAdapter, type CodexSdk } from "@aigcfroge/core/tool/codex-sdk"
import { PermissionV2 } from "@aigcfroge/core/permission"
import { Delegation } from "@aigcfroge/schema/delegation"
import { DelegationID, ParticipantID } from "@aigcfroge/schema/delegation-id"
import { DelegationService } from "../src/delegation/service"
import { DelegationProjector } from "../src/delegation/projector"
import { DelegationReview } from "../src/delegation/review"
import { DelegationParser } from "../src/tool/delegation-parser"
import { testEffect } from "./lib/effect"

const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })

const projectLayer = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)

const rootServices = Layer.mergeAll(
  Database.defaultLayer,
  EventV2.defaultLayer,
  BackgroundJob.defaultLayer,
  SessionStore.defaultLayer,
  SessionProjector.defaultLayer,
  SessionComposition.defaultLayer,
  SessionExecution.noopLayer,
  TaskDriver.runtimeLayer,
  projectLayer,
)

const sessionsLayer = SessionV2.layer.pipe(Layer.provide(rootServices))
const metaAgentLayer = MetaAgentService.layer.pipe(Layer.provide(rootServices))
const delegationProjectorLayer = DelegationProjector.layer.pipe(Layer.provide(rootServices))
const delegationServiceLayer = DelegationService.layer.pipe(Layer.provide(rootServices))
const fillLayer = TaskDriverFill.layer.pipe(
  Layer.provide(sessionsLayer),
  Layer.provide(rootServices),
  Layer.provide(metaAgentLayer),
  Layer.provide(delegationServiceLayer),
  Layer.provideMerge(TaskDriver.runtimeLayer),
)

const baseLayer = Layer.mergeAll(
  rootServices,
  sessionsLayer,
  metaAgentLayer,
  delegationProjectorLayer,
  delegationServiceLayer,
  fillLayer,
)
const it = testEffect(baseLayer)

const seedParent = Effect.fn("Phase3CodexTest.seedParent")(function* (id?: string) {
  return yield* (yield* SessionV2.Service).create({
    ...(id ? { id: SessionV2.ID.make(id) } : {}),
    location,
  })
})

const runCLI = (input: {
  parentID: SessionV2.ID
  taskID?: SessionV2.ID
  cliTarget?: string
  prompt?: string
  delivery?: TaskDriver.DeliveryContext
}) =>
  TaskDriver.executeCLI({
    cliTarget: input.cliTarget ?? "phase3-codex-cli",
    prompt: input.prompt ?? "review changes",
    description: "Phase 3 Codex review",
    sessionID: input.parentID,
    taskID: input.taskID,
    delivery: input.delivery,
  })

const prepareDelivery = (input: {
  parentID: SessionV2.ID
  cliTarget: string
  participantID?: ParticipantID
  delegationID?: DelegationID.ID
  newDelegation?: boolean
  childSessionID?: SessionV2.ID
}) =>
  Effect.gen(function* () {
    const service = yield* DelegationService.Service
    const state = yield* service.resolve({
      parentSessionID: input.parentID,
      title: "Phase 3 Codex review",
      delegationID: input.delegationID,
      newDelegation: input.newDelegation,
    })
    const participant =
      (input.participantID ? state.participants.get(input.participantID) : undefined) ??
      (yield* service.addParticipant({
        delegationID: state.delegation.id,
        provider: "external",
        target: input.cliTarget,
        role: "reviewer",
        context: "fresh",
        childSessionID: input.childSessionID,
      }))
    const turn = yield* service.appendTurn({
      delegationID: state.delegation.id,
      kind: "review",
      promptSummary: "Phase 3 Codex review",
      participantIDs: [participant.id],
      delivery: "steer",
      origin: { deliveryOrigin: "test", senderParticipantID: participant.id },
    })
    return {
      delegationID: state.delegation.id,
      participantID: participant.id,
      turnID: turn.id,
      deliveryOrigin: "test",
      senderParticipantID: participant.id,
      delivery: "steer" as const,
      attempt: 1,
    }
  })

function sdkAdapter(name: string, execute: NonNullable<CliAdapter["execute"]>): CliAdapter {
  return {
    name,
    command: "codex",
    description: `Phase 3 adapter ${name}`,
    transport: "sdk",
    detect: () => Effect.succeed(true),
    buildArgs: () => Effect.succeed([]),
    parseOutput: (stdout) => Effect.succeed({ status: "success", summary: stdout }),
    execute,
  }
}

function readProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined
  return Reflect.get(value, key)
}

describe.serial("Phase 3: Codex Participant & External CLI Binding", () => {
  it.effect("1. external CLI compatibility projection has a participant binding and primary key", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const columns = yield* db.all<{ name: string; pk: number }>(sql`PRAGMA table_info(external_cli_session)`)

      expect(columns.some((column) => column.name === "participant_id")).toBe(true)
      expect(columns.some((column) => column.pk > 0)).toBe(true)
    }),
  )

  it.effect("2. same external child Session resumes the stored Codex thread", () =>
    Effect.gen(function* () {
      const parent = yield* seedParent()
      const resumes: Array<string | undefined> = []
      registerCliAdapter(
        "phase3-codex-resume",
        sdkAdapter("phase3-codex-resume", ({ resumeId }) =>
          Effect.succeed({
            status: "success" as const,
            summary: "review complete",
            sessionId: resumeId ?? "thread_same_participant",
          }).pipe(Effect.tap(() => Effect.sync(() => resumes.push(resumeId)))),
        ),
      )

      const child = yield* (yield* SessionV2.Service).create({ parentID: parent.id, location })
      const firstDelivery = yield* prepareDelivery({
        parentID: parent.id,
        cliTarget: "phase3-codex-resume",
        childSessionID: child.id,
      })
      const first = yield* runCLI({
        parentID: parent.id,
        cliTarget: "phase3-codex-resume",
        taskID: child.id,
        delivery: firstDelivery,
      })
      const state = yield* (yield* DelegationService.Service).foldState(firstDelivery.delegationID)
      const participant = state?.participants.get(firstDelivery.participantID)
      const secondDelivery = yield* prepareDelivery({
        parentID: parent.id,
        cliTarget: "phase3-codex-resume",
        participantID: firstDelivery.participantID,
        delegationID: firstDelivery.delegationID,
      })
      const second = yield* runCLI({
        parentID: parent.id,
        cliTarget: "phase3-codex-resume",
        taskID: participant?.childSessionID ?? first.sessionID,
        delivery: secondDelivery,
      })

      expect(second.sessionID).toBe(first.sessionID)
      expect(resumes).toEqual([undefined, "thread_same_participant"])
      const finalState = yield* (yield* DelegationService.Service).foldState(firstDelivery.delegationID)
      expect(finalState?.participants.get(firstDelivery.participantID)?.externalThreadID).toBe(
        "thread_same_participant",
      )
      expect(
        [...(finalState?.deliveries.values() ?? [])].find((delivery) => delivery.turnID === secondDelivery.turnID)
          ?.status,
      ).toBe("recovery_required")
    }),
  )

  it.effect("3. two Codex child Session bindings under one parent do not share external threads", () =>
    Effect.gen(function* () {
      const parent = yield* seedParent()
      const sessions = yield* SessionV2.Service
      const childA = yield* sessions.create({ parentID: parent.id, location, title: "Codex participant A" })
      const childB = yield* sessions.create({ parentID: parent.id, location, title: "Codex participant B" })
      const resumes: Array<{ prompt: string; resumeId?: string }> = []

      registerCliAdapter(
        "phase3-codex-isolation",
        sdkAdapter("phase3-codex-isolation", ({ prompt, resumeId }) => {
          resumes.push({ prompt, resumeId })
          return Effect.succeed({
            status: "success",
            summary: "review complete",
            sessionId: prompt.includes("participant A") ? "thread_A" : "thread_B",
          })
        }),
      )

      const delegationService = yield* DelegationService.Service
      const delegationState = yield* delegationService.resolve({
        parentSessionID: parent.id,
        title: "Phase 3 Codex isolation",
        newDelegation: true,
      })
      const participantA = yield* delegationService.addParticipant({
        delegationID: delegationState.delegation.id,
        provider: "external",
        target: "phase3-codex-isolation",
        role: "reviewer",
        context: "fresh",
        childSessionID: childA.id,
      })
      const participantB = yield* delegationService.addParticipant({
        delegationID: delegationState.delegation.id,
        provider: "external",
        target: "phase3-codex-isolation",
        role: "reviewer",
        context: "fresh",
        childSessionID: childB.id,
      })
      const turnA = yield* delegationService.appendTurn({
        delegationID: delegationState.delegation.id,
        kind: "review",
        promptSummary: "participant A review",
        participantIDs: [participantA.id],
        delivery: "steer",
        origin: { deliveryOrigin: "test", senderParticipantID: participantA.id },
      })
      yield* runCLI({
        parentID: parent.id,
        taskID: childA.id,
        cliTarget: "phase3-codex-isolation",
        prompt: "participant A review",
        delivery: {
          delegationID: delegationState.delegation.id,
          participantID: participantA.id,
          turnID: turnA.id,
          deliveryOrigin: "test",
          senderParticipantID: participantA.id,
          delivery: "steer",
          attempt: 1,
        },
      })
      const turnB = yield* delegationService.appendTurn({
        delegationID: delegationState.delegation.id,
        kind: "review",
        promptSummary: "participant B review",
        participantIDs: [participantB.id],
        delivery: "steer",
        origin: { deliveryOrigin: "test", senderParticipantID: participantB.id },
      })
      yield* runCLI({
        parentID: parent.id,
        taskID: childB.id,
        cliTarget: "phase3-codex-isolation",
        prompt: "participant B review",
        delivery: {
          delegationID: delegationState.delegation.id,
          participantID: participantB.id,
          turnID: turnB.id,
          deliveryOrigin: "test",
          senderParticipantID: participantB.id,
          delivery: "steer",
          attempt: 1,
        },
      })
      const turnA2 = yield* delegationService.appendTurn({
        delegationID: delegationState.delegation.id,
        kind: "review",
        promptSummary: "participant A second review",
        participantIDs: [participantA.id],
        delivery: "steer",
        origin: { deliveryOrigin: "test", senderParticipantID: participantA.id },
      })
      yield* runCLI({
        parentID: parent.id,
        taskID: childA.id,
        cliTarget: "phase3-codex-isolation",
        prompt: "participant A second review",
        delivery: {
          delegationID: delegationState.delegation.id,
          participantID: participantA.id,
          turnID: turnA2.id,
          deliveryOrigin: "test",
          senderParticipantID: participantA.id,
          delivery: "steer",
          attempt: 1,
        },
      })

      expect(resumes.map((entry) => entry.resumeId)).toEqual([undefined, undefined, "thread_A"])
      expect(resumes.map((entry) => entry.prompt.trim().split("\n").at(-1))).toEqual([
        "participant A review",
        "participant B review",
        "participant A second review",
      ])
    }),
  )

  it.effect("4. an existing external child without a binding cannot fresh-start a resume", () =>
    Effect.gen(function* () {
      const parent = yield* seedParent()
      const child = yield* (yield* SessionV2.Service).create({
        parentID: parent.id,
        location,
        title: "External Codex participant",
      })
      const service = yield* DelegationService.Service
      const state = yield* service.resolve({
        parentSessionID: parent.id,
        title: "Phase 3 Codex missing binding",
        newDelegation: true,
      })
      const participant = yield* service.addParticipant({
        delegationID: state.delegation.id,
        provider: "external",
        target: "phase3-codex-missing-binding",
        role: "reviewer",
        context: "fresh",
        childSessionID: child.id,
      })
      const priorTurn = yield* service.appendTurn({
        delegationID: state.delegation.id,
        kind: "review",
        participantIDs: [participant.id],
        delivery: "steer",
        origin: { deliveryOrigin: "test", senderParticipantID: participant.id },
      })
      yield* service.recordDelivery({
        delegationID: state.delegation.id,
        turnID: priorTurn.id,
        participantID: participant.id,
        deliveryOrigin: "test",
        senderParticipantID: participant.id,
        attempt: 1,
        status: "failed",
        errorCode: "provider_error",
        summary: "prior external attempt did not return a thread",
      })
      const delivery = yield* prepareDelivery({
        parentID: parent.id,
        cliTarget: "phase3-codex-missing-binding",
        participantID: participant.id,
        delegationID: state.delegation.id,
      })
      let adapterCalled = false
      registerCliAdapter(
        "phase3-codex-missing-binding",
        sdkAdapter("phase3-codex-missing-binding", ({ resumeId }) => {
          adapterCalled = true
          return resumeId
            ? Effect.succeed({ status: "success", summary: "resumed", sessionId: resumeId })
            : Effect.die("missing external thread id")
        }),
      )

      const exit = yield* runCLI({
        parentID: parent.id,
        taskID: child.id,
        cliTarget: "phase3-codex-missing-binding",
        delivery,
      }).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(adapterCalled).toBe(false)
    }),
  )

  it.effect("5. transport dispatch uses method presence rather than a capabilities boolean", () =>
    Effect.gen(function* () {
      const parent = yield* seedParent()
      let sdkCalled = false
      registerCliAdapter(
        "phase3-sdk-method",
        sdkAdapter("phase3-sdk-method", () => {
          sdkCalled = true
          return Effect.succeed({ status: "success", summary: "sdk" })
        }),
      )
      registerCliAdapter("phase3-jsonl-method", {
        name: "phase3-jsonl-method",
        command: "codex",
        description: "JSONL adapter without a process owner",
        transport: "jsonl",
        detect: () => Effect.succeed(true),
        buildArgs: () => Effect.succeed(["codex"]),
        parseOutput: (stdout) => Effect.succeed({ status: "success", summary: stdout }),
      })

      yield* runCLI({ parentID: parent.id, cliTarget: "phase3-sdk-method" })
      expect(sdkCalled).toBe(true)

      const jsonlExit = yield* runCLI({ parentID: parent.id, cliTarget: "phase3-jsonl-method" }).pipe(Effect.exit)
      expect(Exit.isFailure(jsonlExit)).toBe(true)
      if (Exit.isFailure(jsonlExit)) {
        expect(Cause.squash(jsonlExit.cause)).toBeInstanceOf(TaskDriverFill.CliUnavailableError)
      }
    }),
  )

  it.effect("6. an unavailable CLI target fails with a typed error", () =>
    Effect.gen(function* () {
      const parent = yield* seedParent("ses_parent_codex_unavailable")
      const exit = yield* runCLI({ parentID: parent.id, cliTarget: "phase3-not-registered" }).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause)
        expect(error).toBeInstanceOf(TaskDriverFill.CliUnavailableError)
        if (error instanceof TaskDriverFill.CliUnavailableError) expect(error.reason).toBe("unknown_target")
      }
    }),
  )

  it.effect("7. CLI failure retains an explainable failed result", () =>
    Effect.gen(function* () {
      const parent = yield* seedParent("ses_parent_codex_failure")
      registerCliAdapter(
        "phase3-codex-failure",
        sdkAdapter("phase3-codex-failure", () =>
          Effect.succeed({
            status: "failed",
            summary: "Codex rate limit exceeded (HTTP 429)",
            errors: ["HTTP 429 Too Many Requests"],
          }),
        ),
      )

      const result = yield* runCLI({ parentID: parent.id, cliTarget: "phase3-codex-failure" })
      expect(result.status).toBe("failed")
      expect(result.text).toContain("429")
    }),
  )

  it.effect("8. Codex SDK failure preserves the external thread ID", () =>
    Effect.gen(function* () {
      const mockSdk: CodexSdk = {
        startThread: () => ({
          id: "thread_error_preserve_123",
          run: () => Promise.reject(new Error("API rate limit exceeded during execution")),
        }),
        resumeThread: (id) => ({
          id,
          run: () => Promise.reject(new Error("API rate limit exceeded during execution")),
        }),
      }
      const adapter = makeCodexSdkAdapter(mockSdk, "phase3-codex-preserve")
      const execute = adapter.execute ?? (() => Effect.die("Codex adapter must expose execute"))

      const result = yield* execute({ prompt: "review changes", cwd: "/tmp" })
      expect(result.status).toBe("failed")
      expect(result.summary).toContain("API rate limit exceeded")
      expect(result.sessionId).toBe("thread_error_preserve_123")
    }),
  )

  it.effect("9. review parsing fails closed and stale approval does not satisfy the current revision", () =>
    Effect.gen(function* () {
      const missing = DelegationParser.parseDelegationResult("plain review text")
      expect(readProperty(missing, "review")).toEqual({ status: "invalid", reason: "missing" })

      const malformed = DelegationParser.parseDelegationResult(
        `<review>{"verdict":"approved","digest":broken}</review>`,
      )
      expect(readProperty(malformed, "review")).toEqual({ status: "invalid", reason: "malformed" })
      const validDigest = `rev_${"c".repeat(64)}`
      const valid = DelegationParser.parseDelegationResult(
        `<review>${JSON.stringify({
          kind: "aigcfroge.review.v1",
          reviewed_revision_digest: validDigest,
          verdict: "approved",
          findings: [],
        })}</review>`,
      )
      expect(readProperty(valid, "review")).toEqual({
        status: "valid",
        envelope: {
          kind: "aigcfroge.review.v1",
          reviewed_revision_digest: validDigest,
          verdict: "approved",
          findings: [],
        },
      })

      const delegationID = DelegationID.ID.make("dlg_phase3_review")
      const participantID = ParticipantID.make("par_phase3_review")
      const oldDigest = Delegation.RevisionDigest.make(`rev_${"a".repeat(64)}`)
      const currentDigest = Delegation.RevisionDigest.make(`rev_${"b".repeat(64)}`)
      const participant = new Delegation.ParticipantInfo({
        id: participantID,
        delegationID,
        provider: "external",
        target: "codex",
        role: "reviewer",
        context: "fresh",
        phase: "active",
        lastActivityAt: 1,
        createdAt: 1,
        updatedAt: 1,
      })

      const barrier = DelegationReview.evaluateReviewBarrier({
        participants: [participant],
        reviews: [{ participantID, reviewedRevisionDigest: oldDigest, verdict: "approved" }],
        latestRevisionDigest: currentDigest,
        revisions: [
          { revisionDigest: oldDigest, changeKind: "no_change" },
          { revisionDigest: currentDigest, changeKind: "rework" },
        ],
        rejectionBlocked: false,
      })
      expect(barrier.passed).toBe(false)
      expect(barrier.reason).toContain("has not approved revision")
    }),
  )

  it.effect("10. review copyability is not a PermissionV2 authorization decision", () =>
    Effect.gen(function* () {
      expect(DelegationReview.copyable("no_change", "approved")).toBe(true)
      const permission = PermissionV2.Service.of({
        effectiveRules: () => Effect.succeed([]),
        ask: () => Effect.succeed({ id: PermissionV2.ID.create(), effect: "deny" }),
        assert: () => Effect.fail(new PermissionV2.DeniedError({ rules: [] })),
        reply: () => Effect.void,
        get: () => Effect.succeed(undefined),
        forSession: () => Effect.succeed([]),
        list: () => Effect.succeed([]),
      })
      const exit = yield* permission
        .assert({
          sessionID: SessionV2.ID.make("ses_parent_codex_permission"),
          action: "write",
          resources: ["/project/file"],
        })
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.effect("11. Codex SDK is read-only and does not receive a canUseTool bridge", () =>
    Effect.gen(function* () {
      let seenOptions: unknown
      const mockSdk: CodexSdk = {
        startThread: (options) => {
          seenOptions = options
          return { id: "thread_readonly_001", run: async () => ({ finalResponse: "review approved" }) }
        },
        resumeThread: (id, options) => {
          seenOptions = options
          return { id, run: async () => ({ finalResponse: "review approved" }) }
        },
      }
      const adapter = makeCodexSdkAdapter(mockSdk, "phase3-codex-readonly")
      const execute = adapter.execute ?? (() => Effect.die("Codex adapter must expose execute"))

      yield* execute({
        prompt: "review code",
        cwd: "/project",
        canUseTool: async () => "allow",
      })

      expect(readProperty(seenOptions, "approvalPolicy")).toBe("never")
      expect(readProperty(seenOptions, "canUseTool")).toBeUndefined()
    }),
  )
})
