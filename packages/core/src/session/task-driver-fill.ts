export * as TaskDriverFill from "./task-driver-fill"

import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { and, desc, eq, isNull } from "drizzle-orm"
import { Cause, DateTime, Duration, Effect, Exit, Layer, Option, Schema } from "effect"
import { AgentV2 } from "../agent"
import { BackgroundJob } from "../background-job"
import { EventV2 } from "../event"
import { SessionV2 } from "../session"
import { Prompt } from "../session/prompt"
import { SessionMessageID } from "../session/message-id"
import { SessionEvent } from "../session/event"
import { TaskDriver } from "../tool/task-driver"
import { getCliAdapter, registerCliAdapter, registerConfigCliAdapters } from "../tool/cli-adapter"
import type { DelegationResult } from "../tool/cli-adapter"
import { executeWithTimeout } from "../tool/cli-timeout"
import { ExternalCliSessionTable } from "../tool/cli-session.sql"
import { adapter as opencodeAdapter } from "../tool/opencode"
import { adapter as claudeCodeAdapter } from "../tool/claude-code"
import { adapter as geminiAdapter } from "../tool/gemini"
import { adapter as codexAdapter } from "../tool/codex"
import { adapter as claudeCodeSdkAdapter } from "../tool/claude-code-sdk"
import { adapter as codexSdkAdapter } from "../tool/codex-sdk"
import { adapter as claudeCodeAcpAdapter } from "../tool/claude-code-acp"
import { adapter as codexAcpAdapter } from "../tool/codex-acp"
import { CodexAppServer } from "../tool/codex-app-server"
import { MetaAgentService } from "../meta-agent/service"
import { DelegationExecution } from "../delegation/execution"
import { DelegationService, type RecordDeliveryInput } from "../delegation/service"
import { Database } from "../database/database"
import { Config } from "../config"
import { PermissionV2 } from "../permission"
import type { SdkPermissionHandler } from "../tool/cli-adapter"
import { which } from "../util/which"
import { Identifier } from "../util/identifier"

/**
 * The external-CLI dispatch could not run because no `ChildProcessSpawner` was
 * provided at the composition root, or the requested CLI target has no registered
 * adapter. A typed error (rather than a bare `Error`) so callers can branch on it.
 */
export class CliUnavailableError extends Schema.TaggedErrorClass<CliUnavailableError>()(
  "TaskDriverFill.CliUnavailableError",
  {
    cliTarget: Schema.String,
    reason: Schema.Literals(["no_spawner", "unknown_target", "invalid_task", "invalid_binding"]),
  },
) {
  override get message() {
    if (this.reason === "no_spawner") {
      return `CLI execution not available (no process spawner) for target ${this.cliTarget}`
    }
    if (this.reason === "invalid_task") return `task_id does not belong to this session for target ${this.cliTarget}`
    if (this.reason === "invalid_binding")
      return `No canonical external CLI binding exists for target ${this.cliTarget}`
    return `Unknown CLI target: ${this.cliTarget}`
  }
}

/**
 * Installs a `SessionV2`-backed implementation into the {@link TaskDriver}
 * module bridge so the `task` built-in can drive child Sessions. Merge this at
 * every composition root that runs Sessions (public API, server, app runtime).
 *
 * Requires `SessionV2.Service` + `BackgroundJob.Service`. `SessionV2` is a leaf
 * here — nothing depends back on the filler — so this closes no dependency
 * cycle. This module may import `SessionV2` because it is only imported by
 * composition roots, never by the `SessionV2` construction chain.
 *
 * The child Session drain runs on a `BackgroundJob` fiber, never on the caller's
 * fiber. The caller is a `task` tool executing inside the parent Session's own
 * drain; driving the child synchronously on the parent's fiber would deadlock
 * the single-connection SQLite serializer. This mirrors V1's task tool, which
 * also settles child Sessions on a BackgroundJob fiber. Foreground delegation
 * awaits the job; background delegation lets it run and inject its result into
 * the parent later.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const sessions = yield* SessionV2.Service
    const background = yield* BackgroundJob.Service
    const events = yield* EventV2.Service
    const spawner = yield* Effect.serviceOption(ChildProcessSpawner).pipe(
      Effect.map((op) => (op._tag === "Some" ? op.value : undefined)),
    )
    // Register built-in CLI adapters so the task tool can delegate to external
    // CLI tools. Additional adapters can be registered before this layer runs.
    registerCliAdapter(claudeCodeAdapter.name, claudeCodeAdapter)
    registerCliAdapter(geminiAdapter.name, geminiAdapter)
    registerCliAdapter(codexAdapter.name, codexAdapter)
    registerCliAdapter(opencodeAdapter.name, opencodeAdapter)
    // SDK transports become the default for claude/codex; a config cli_agents
    // entry with transport "jsonl" overrides back to the spawn+parse path.
    registerCliAdapter(claudeCodeSdkAdapter.name, claudeCodeSdkAdapter)
    registerCliAdapter(codexSdkAdapter.name, codexSdkAdapter)
    // ACP transports become the default only when the bridge binary is on PATH;
    // otherwise the SDK transport stays the default so machines without
    // claude-code-acp/codex-acp keep working. Config transport:"acp" for these
    // two names still resolves to the bridge adapter (see registerConfigCliAdapters).
    if (which("claude-code-acp")) registerCliAdapter(claudeCodeAcpAdapter.name, claudeCodeAcpAdapter)
    if (which("codex-acp")) registerCliAdapter(codexAcpAdapter.name, codexAcpAdapter)
    const codexAppServerAdapter = CodexAppServer.makeNegotiatedCodexAdapter({
      appServer: CodexAppServer.adapter,
      fallbackSdk: codexSdkAdapter,
      fallbackJsonl: codexAdapter,
    })
    registerCliAdapter(codexAppServerAdapter.name, codexAppServerAdapter)
    // Register config-defined cli_agents (config > built-in override) when a
    // Config.Service is present (composition roots always provide one).
    const configOpt = yield* Effect.serviceOption(Config.Service)
    if (configOpt._tag === "Some") {
      const entries = yield* configOpt.value.entries()
      yield* Effect.try({
        try: () =>
          registerConfigCliAdapters(entries, {
            "claude-code": {
              sdk: claudeCodeSdkAdapter,
              ...(which("claude-code-acp") ? { acp: claudeCodeAcpAdapter } : {}),
            },
            codex: {
              sdk: codexSdkAdapter,
              ...(which("codex-acp") ? { acp: codexAcpAdapter } : {}),
              ...(which("codex") ? { "app-server": codexAppServerAdapter } : {}),
            },
          }),
        catch: (error) => new Error(error instanceof Error ? error.message : String(error)),
      }).pipe(Effect.orDie)
    }
    const metaAgent = yield* Effect.serviceOption(MetaAgentService.Service)
    const delegation = yield* DelegationService.Service
    const delegationExecution = yield* Effect.serviceOption(DelegationExecution.Service)
    const settleDeliveryIfActive = Effect.fnUntraced(function* (input: {
      readonly delivery?: TaskDriver.DeliveryContext
      readonly status: RecordDeliveryInput["status"]
      readonly externalTurnID?: string
      readonly summary?: string
      readonly errorCode?: string
    }) {
      if (input.delivery === undefined) return false
      const state = yield* delegation.foldState(input.delivery.delegationID)
      const current = [...(state?.deliveries.values() ?? [])].find(
        (delivery) =>
          delivery.turnID === input.delivery?.turnID &&
          delivery.participantID === input.delivery?.participantID &&
          delivery.deliveryOrigin === input.delivery?.deliveryOrigin &&
          delivery.senderParticipantID === input.delivery?.senderParticipantID,
      )
      if (current !== undefined && ["completed", "failed", "cancelled", "recovery_required"].includes(current.status)) {
        return false
      }
      yield* delegation
        .recordDelivery({
          ...input.delivery,
          status: input.status,
          externalTurnID: input.externalTurnID,
          summary: input.summary,
          errorCode: input.errorCode,
        })
        .pipe(Effect.orDie)
      return true
    })
    yield* TaskDriver.initialize(
      TaskDriver.make(
        {
          get: sessions.get,
          create: (input) =>
            Effect.gen(function* () {
              const child = yield* sessions.create(input)
              let stepID: string | undefined
              // Record meta agent step if the parent session is associated with a meta agent.
              if (metaAgent._tag === "Some" && input.parentID) {
                const parentMeta = yield* metaAgent.value.findBySession(input.parentID)
                if (parentMeta) {
                  stepID = yield* metaAgent.value.writeStep({
                    metaAgentSessionID: parentMeta.sessionID,
                    seq: yield* Effect.sync(() => Date.now()),
                    engine: input.agent ? input.agent.toString() : "default",
                    type: "subagent",
                    prompt: undefined,
                  })
                }
              }
              return Object.assign(child, { stepID })
            }),
          prompt: sessions.prompt,
          resume: sessions.resume,
          messages: sessions.messages,
          children: sessions.children,
          injectSynthetic: sessions.injectSynthetic,
          interrupt: sessions.interrupt,
          settleStep: (input) =>
            Effect.gen(function* () {
              if (metaAgent._tag !== "Some") return
              yield* metaAgent.value.updateStep({
                stepID: input.stepID,
                status: input.status,
              })
            }),
          settleDelivery: (input) =>
            delegation
              .recordDelivery({
                delegationID: input.delegationID,
                turnID: input.turnID,
                participantID: input.participantID,
                deliveryOrigin: input.deliveryOrigin,
                senderParticipantID: input.senderParticipantID,
                attempt: input.attempt,
                status: input.status,
                summary: input.summary,
              })
              .pipe(Effect.orDie),
        },
        {
          start: (sessionID, work) => background.start({ id: sessionID, type: "task", run: work.pipe(Effect.as("")) }),
          // Map BackgroundJob's terminal Info to the seam's BackgroundOutcome. A
          // still-"running" status can't occur here (wait blocks until the job
          // settles); a missing Info (job never registered / scope closed) is
          // reported as undefined so delegate treats it as completed-but-empty.
          wait: (sessionID) =>
            background
              .wait({ id: sessionID })
              .pipe(
                Effect.map(({ info }) =>
                  info && info.status !== "running"
                    ? { status: info.status, ...(info.error ? { error: info.error } : {}) }
                    : undefined,
                ),
              ),
          cancel: (sessionID) => background.cancel(sessionID).pipe(Effect.asVoid),
          extend: (sessionID, work) => background.extend({ id: sessionID, run: work.pipe(Effect.as("")) }),
          isRunning: (sessionID) => background.get(sessionID).pipe(Effect.map((info) => info?.status === "running")),
        },
        {
          execute: (input) =>
            Effect.gen(function* () {
              const adapter = getCliAdapter(input.cliTarget)
              if (!adapter)
                return yield* new CliUnavailableError({ cliTarget: input.cliTarget, reason: "unknown_target" })
              if (
                adapter.transport !== "sdk" &&
                adapter.transport !== "acp" &&
                adapter.transport !== "app-server" &&
                !spawner
              ) {
                return yield* new CliUnavailableError({ cliTarget: input.cliTarget, reason: "no_spawner" })
              }
              const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
              const delegationState = input.delivery
                ? yield* delegation.foldState(input.delivery.delegationID).pipe(Effect.orDie)
                : undefined
              const participant = input.delivery
                ? delegationState?.participants.get(input.delivery.participantID)
                : undefined
              if (input.delivery && participant === undefined) {
                return yield* new CliUnavailableError({ cliTarget: input.cliTarget, reason: "invalid_binding" })
              }
              if (input.delivery && input.taskID && participant?.childSessionID === undefined) {
                yield* delegation
                  .recordDelivery({
                    ...input.delivery,
                    status: "recovery_required",
                    errorCode: "unbound_child_session",
                    summary: "task_id cannot select a child session before the participant is bound",
                  })
                  .pipe(Effect.orDie)
                return yield* new CliUnavailableError({ cliTarget: input.cliTarget, reason: "invalid_binding" })
              }
              const requestedChildID = input.taskID ?? participant?.childSessionID
              const existingChild = requestedChildID
                ? yield* sessions.get(requestedChildID).pipe(Effect.exit)
                : undefined

              // Create a real child session so the task card link navigates to a real
              // session. The child's title is the task description and its agent is the
              // CLI name (mirrors V1's task tool, which passes description as the title).
              const childSession = yield* sessions
                .create({
                  id: requestedChildID,
                  parentID: input.sessionID,
                  agent: AgentV2.ID.make(input.cliTarget),
                  location: session.location,
                  title: input.description,
                })
                .pipe(Effect.orDie)
              if (childSession.parentID !== input.sessionID) {
                return yield* new CliUnavailableError({ cliTarget: input.cliTarget, reason: "invalid_task" })
              }
              if (participant?.childSessionID !== undefined && participant.childSessionID !== childSession.id) {
                return yield* new CliUnavailableError({ cliTarget: input.cliTarget, reason: "invalid_binding" })
              }
              if (input.delivery && participant?.childSessionID === undefined && input.taskID === undefined) {
                yield* delegation
                  .bindParticipant({
                    delegationID: input.delivery.delegationID,
                    participantID: input.delivery.participantID,
                    childSessionID: childSession.id,
                  })
                  .pipe(Effect.orDie)
              }

              // Write the delegated prompt as the child's first user message so the child
              // Session reads like a real conversation (mirrors V1's task tool).
              const cliPrompt = `[Project directory: ${session.location.directory}]\n\n${input.prompt}`
              yield* events
                .publish(SessionEvent.Prompted, {
                  sessionID: childSession.id,
                  messageID: SessionMessageID.ID.create(),
                  timestamp: yield* DateTime.now,
                  prompt: Prompt.make({ text: cliPrompt }),
                  delivery: "steer",
                })
                .pipe(Effect.orDie)

              // Attempt to load DB for resume lookup and hint persistence.
              // Not all callers (e.g. tests) provide Database.Service, so
              // use serviceOption; when absent, DB operations are skipped.
              const dbOpt = yield* Effect.serviceOption(Database.Service)

              // The participant is the canonical resume source for persistent
              // delegations. The compatibility table is only consulted for the
              // same participant; the parent/target fallback remains available
              // only to legacy callers that do not carry delegation context.
              let resumeId: string | undefined
              let ambiguousLegacyBinding = false
              if (Option.isSome(dbOpt)) {
                const db: Database.Interface["db"] = dbOpt.value.db
                const participantFilter = input.delivery
                  ? eq(ExternalCliSessionTable.participant_id, input.delivery.participantID)
                  : undefined
                const row = yield* db
                  .select()
                  .from(ExternalCliSessionTable)
                  .where(
                    and(
                      eq(ExternalCliSessionTable.session_id, input.sessionID),
                      eq(ExternalCliSessionTable.cli_target, input.cliTarget),
                      eq(ExternalCliSessionTable.status, "active"),
                      participantFilter,
                    ),
                  )
                  .orderBy(desc(ExternalCliSessionTable.time_updated))
                  .get()
                resumeId = row?.external_session_id
                if (resumeId)
                  yield* Effect.logInfo(
                    `CLI resume: found active session for session ${input.sessionID}, target=${input.cliTarget}`,
                  )
                if (input.delivery && resumeId === undefined && participant?.externalThreadID === undefined) {
                  const legacyRows = yield* db
                    .select({ external_session_id: ExternalCliSessionTable.external_session_id })
                    .from(ExternalCliSessionTable)
                    .where(
                      and(
                        eq(ExternalCliSessionTable.session_id, input.sessionID),
                        eq(ExternalCliSessionTable.cli_target, input.cliTarget),
                        eq(ExternalCliSessionTable.status, "active"),
                        isNull(ExternalCliSessionTable.participant_id),
                      ),
                    )
                    .all()
                  if (legacyRows.length === 1) resumeId = legacyRows[0]?.external_session_id
                  if (legacyRows.length > 1) ambiguousLegacyBinding = true
                }
              }

              if (!resumeId && participant?.externalThreadID !== undefined) {
                resumeId = participant.externalThreadID
              }
              const hasPriorDelivery = input.delivery
                ? [...(delegationState?.deliveries.values() ?? [])].some(
                    (delivery) =>
                      delivery.participantID === input.delivery?.participantID &&
                      delivery.turnID !== input.delivery?.turnID,
                  )
                : true
              if (
                ambiguousLegacyBinding ||
                (!resumeId && hasPriorDelivery && existingChild !== undefined && Exit.isSuccess(existingChild))
              ) {
                if (input.delivery) {
                  yield* delegation
                    .recordDelivery({
                      ...input.delivery,
                      status: "recovery_required",
                      errorCode: ambiguousLegacyBinding ? "ambiguous_legacy_binding" : "missing_external_binding",
                      summary: ambiguousLegacyBinding
                        ? "Multiple unbound legacy external CLI sessions require reconciliation"
                        : "Existing participant has no canonical external thread binding",
                    })
                    .pipe(Effect.orDie)
                }
                return yield* new CliUnavailableError({ cliTarget: input.cliTarget, reason: "invalid_binding" })
              }

              // Meta agent step: record the dispatch up front (status running), then settle it
              // with the CLI outcome so meta_agent_step reflects real work.
              const metaAgentSvc = metaAgent._tag === "Some" ? metaAgent.value : undefined
              let stepID: string | undefined
              if (metaAgentSvc) {
                const parentMeta = yield* metaAgentSvc.findBySession(input.sessionID)
                if (parentMeta) {
                  stepID = yield* metaAgentSvc.writeStep({
                    metaAgentSessionID: parentMeta.sessionID,
                    seq: yield* Effect.sync(() => Date.now()),
                    engine: input.cliTarget,
                    type: "external-cli",
                    prompt: input.prompt,
                  })
                }
              }

              // PermissionV2 bridge (M5): when a PermissionV2.Service is present,
              // external CLI tool calls (SDK canUseTool / ACP request_permission)
              // are decided against the PARENT session's rules — the child session
              // is unattended, so asserting against it would auto-deny. The assert
              // carries its dependencies in the service instance, so it runs from
              // the SDK/ACP plain-async callback via Effect.runPromise; an "ask"
              // parks until the user replies through the dock UI.
              const permissionOpt = yield* Effect.serviceOption(PermissionV2.Service)
              let canUseTool: SdkPermissionHandler | undefined
              if (permissionOpt._tag === "Some") {
                const permission = permissionOpt.value
                canUseTool = async (request) => {
                  const decision = await Effect.runPromise(
                    permission
                      .assert({
                        sessionID: input.sessionID,
                        action: request.toolName,
                        resources: [JSON.stringify(request.input)],
                        metadata: { cli: input.cliTarget, external: true },
                        source: input.permissionSource,
                      })
                      .pipe(Effect.match({ onSuccess: () => "allow" as const, onFailure: () => "deny" as const })),
                  )
                  return decision
                }
              }

              yield* settleDeliveryIfActive({ delivery: input.delivery, status: "started" })

              // SDK transports own their timeout so a provider-created thread id
              // remains available on the timeout path. JSONL keeps the existing
              // process boundary, whose timeout result still preserves resumeId.
              const execution =
                (adapter.transport === "sdk" || adapter.transport === "acp" || adapter.transport === "app-server") &&
                adapter.execute
                  ? adapter
                      .execute({
                        prompt: cliPrompt,
                        cwd: session.location.directory,
                        resumeId,
                        timeoutMs: adapter.timeout ?? 300_000,
                        canUseTool,
                      })
                      .pipe(
                        Effect.timeoutOrElse({
                          duration: Duration.millis(adapter.timeout ?? 300_000),
                          orElse: () =>
                            Effect.succeed<DelegationResult>({
                              status: "failed",
                              summary: `CLI "${adapter.name}" execution Timed out`,
                              ...(resumeId ? { sessionId: resumeId } : {}),
                              errorCode: "timeout",
                              recoveryRequired: true,
                              errors: ["Timed out"],
                            }),
                        }),
                      )
                  : executeWithTimeout(spawner!, adapter, {
                      prompt: cliPrompt,
                      cwd: session.location.directory,
                      resumeId,
                    })
              const executionExit = yield* execution.pipe(Effect.exit)
              if (Exit.isFailure(executionExit)) {
                const interrupted = Cause.hasInterruptsOnly(executionExit.cause)
                yield* settleDeliveryIfActive({
                  delivery: input.delivery,
                  status: interrupted ? "cancelled" : "recovery_required",
                  errorCode: interrupted ? undefined : "adapter_failure",
                  summary: interrupted
                    ? "External CLI execution interrupted"
                    : "External CLI adapter failed before returning a result",
                })
                if (stepID && metaAgentSvc) {
                  yield* metaAgentSvc
                    .updateStep({
                      stepID,
                      status: "failed",
                      error: "External CLI adapter failed before returning a result",
                    })
                    .pipe(Effect.orDie)
                }
                return yield* Effect.failCause(executionExit.cause)
              }
              const result = executionExit.value
              const reviewRequired = participant?.role === "reviewer" || participant?.role === "approver"
              const resultStatus =
                result.status === "failed" || (reviewRequired && result.review?.status !== "valid")
                  ? ("failed" as const)
                  : result.status

              // Write the CLI summary as the child's second user message.
              yield* events
                .publish(SessionEvent.Prompted, {
                  sessionID: childSession.id,
                  messageID: SessionMessageID.ID.create(),
                  timestamp: yield* DateTime.now,
                  prompt: Prompt.make({ text: result.summary }),
                  delivery: "steer",
                })
                .pipe(Effect.orDie)

              if (stepID && metaAgentSvc) {
                yield* metaAgentSvc.updateStep({
                  stepID,
                  status: resultStatus === "failed" ? "failed" : "completed",
                  ...(resultStatus === "failed" ? { error: result.summary } : { result: result.summary }),
                })
              }

              const hint = result.sessionId ?? adapter.parseResumeHint?.(result.rawStdout ?? result.summary)
              if (hint && input.delivery) {
                yield* delegation
                  .bindParticipant({
                    delegationID: input.delivery.delegationID,
                    participantID: input.delivery.participantID,
                    externalThreadID: hint,
                  })
                  .pipe(Effect.orDie)
              }

              // Persist the external session id for resume. SDK transports surface
              // it on the DelegationResult; jsonl transports emit a resume_hint
              // frame parsed from raw stdout. The participant id is nullable only
              // for legacy callers that have not entered the delegation protocol.
              if (Option.isSome(dbOpt) && hint) {
                const db: Database.Interface["db"] = dbOpt.value.db
                const participantID = input.delivery?.participantID
                yield* db
                  .update(ExternalCliSessionTable)
                  .set({ status: resultStatus === "failed" ? "failed" : "completed" })
                  .where(
                    and(
                      eq(ExternalCliSessionTable.session_id, input.sessionID),
                      eq(ExternalCliSessionTable.cli_target, input.cliTarget),
                      eq(ExternalCliSessionTable.status, "active"),
                      participantID ? eq(ExternalCliSessionTable.participant_id, participantID) : undefined,
                    ),
                  )
                yield* db
                  .insert(ExternalCliSessionTable)
                  .values({
                    id: `ecs_${Identifier.ascending()}`,
                    session_id: input.sessionID,
                    participant_id: participantID,
                    cli_target: input.cliTarget,
                    external_session_id: hint,
                    status: resultStatus === "failed" ? "failed" : "active",
                  })
                  .onConflictDoUpdate({
                    target: [ExternalCliSessionTable.session_id, ExternalCliSessionTable.external_session_id],
                    set: {
                      participant_id: participantID,
                      cli_target: input.cliTarget,
                      status: resultStatus === "failed" ? "failed" : "active",
                    },
                  })
              }

              if (input.delivery) {
                const reviewValid = result.review?.status === "valid"
                const deliveryStatus =
                  resultStatus === "failed" || (reviewRequired && !reviewValid)
                    ? result.recoveryRequired || (reviewRequired && !reviewValid)
                      ? ("recovery_required" as const)
                      : ("failed" as const)
                    : ("completed" as const)
                const settled = yield* settleDeliveryIfActive({
                  delivery: input.delivery,
                  status: deliveryStatus,
                  externalTurnID: result.turnId,
                  summary: result.summary,
                  errorCode:
                    result.errorCode ?? (reviewRequired && !reviewValid ? "malformed_review_envelope" : undefined),
                })
                if (settled && result.review?.status === "valid") {
                  yield* delegation
                    .recordReview({
                      delegationID: input.delivery.delegationID,
                      turnID: input.delivery.turnID,
                      participantID: input.delivery.participantID,
                      reviewedRevisionDigest: result.review.envelope.reviewed_revision_digest,
                      verdict: result.review.envelope.verdict,
                      findings: result.review.envelope.findings,
                      summary: result.review.envelope.summary,
                    })
                    .pipe(Effect.orDie)
                }
              }

              return {
                text: result.summary,
                sessionID: childSession.id,
                status: resultStatus,
                externalSessionID: hint,
                externalTurnID: result.turnId,
                review: result.review,
              }
            }),
        },
        Option.isNone(delegationExecution)
          ? undefined
          : (input) =>
              delegationExecution.value
                .dispatch(input)
                .pipe(Effect.mapError((error) => (error instanceof Error ? error : new Error(String(error))))),
        Option.isNone(delegationExecution)
          ? undefined
          : (delegationID, participantID) => delegationExecution.value.interrupt(delegationID, participantID),
      ),
    )
  }),
)
