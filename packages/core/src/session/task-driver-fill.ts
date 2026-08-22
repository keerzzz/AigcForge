export * as TaskDriverFill from "./task-driver-fill"

import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { and, desc, eq } from "drizzle-orm"
import { DateTime, Duration, Effect, Layer, Option, Schema } from "effect"
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
import { MetaAgentService } from "../meta-agent/service"
import { Database } from "../database/database"
import { Config } from "../config"
import { PermissionV2 } from "../permission"
import type { SdkPermissionHandler } from "../tool/cli-adapter"
import { which } from "../util/which"

/**
 * The external-CLI dispatch could not run because no `ChildProcessSpawner` was
 * provided at the composition root, or the requested CLI target has no registered
 * adapter. A typed error (rather than a bare `Error`) so callers can branch on it.
 */
export class CliUnavailableError extends Schema.TaggedErrorClass<CliUnavailableError>()(
  "TaskDriverFill.CliUnavailableError",
  {
    cliTarget: Schema.String,
    reason: Schema.Literals(["no_spawner", "unknown_target", "invalid_task"]),
  },
) {
  override get message() {
    if (this.reason === "no_spawner") {
      return `CLI execution not available (no process spawner) for target ${this.cliTarget}`
    }
    if (this.reason === "invalid_task") return `task_id does not belong to this session for target ${this.cliTarget}`
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
            },
          }),
        catch: (error) => new Error(error instanceof Error ? error.message : String(error)),
      }).pipe(Effect.orDie)
    }
    const metaAgent = yield* Effect.serviceOption(MetaAgentService.Service)
    yield* TaskDriver.initialize(
      TaskDriver.make(
      {
        get: sessions.get,
        create: (input) =>
          Effect.gen(function* () {
            const child = yield* sessions.create(input)
            // Record meta agent step if the parent session is associated with a meta agent.
            if (metaAgent._tag === "Some" && input.parentID) {
              const parentMeta = yield* metaAgent.value.findBySession(input.parentID)
              if (parentMeta) {
                yield* metaAgent.value.writeStep({
                  metaAgentSessionID: parentMeta.sessionID,
                  seq: yield* Effect.sync(() => Date.now()),
                  engine: input.agent ? input.agent.toString() : "default",
                  type: "subagent",
                  prompt: undefined,
                })
              }
            }
            return child
          }),
        prompt: sessions.prompt,
        resume: sessions.resume,
        messages: (input) => sessions.messages({ sessionID: input.sessionID }),
        injectSynthetic: sessions.injectSynthetic,
        interrupt: sessions.interrupt,
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
      },
      {
        execute: (input) =>
          Effect.gen(function* () {
            const adapter = getCliAdapter(input.cliTarget)
            if (!adapter)
              return yield* new CliUnavailableError({ cliTarget: input.cliTarget, reason: "unknown_target" })
            if (adapter.transport !== "sdk" && adapter.transport !== "acp" && !spawner) {
              return yield* new CliUnavailableError({ cliTarget: input.cliTarget, reason: "no_spawner" })
            }
            const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)

            // Create a real child session so the task card link navigates to a real
            // session. The child's title is the task description and its agent is the
            // CLI name (mirrors V1's task tool, which passes description as the title).
            const childSession = yield* sessions
              .create({
                id: input.taskID,
                parentID: input.sessionID,
                agent: AgentV2.ID.make(input.cliTarget),
                location: session.location,
                title: input.description,
              })
              .pipe(Effect.orDie)
            if (childSession.parentID !== input.sessionID) {
              return yield* new CliUnavailableError({ cliTarget: input.cliTarget, reason: "invalid_task" })
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

            // Check for a pending external CLI session to resume. The row is keyed by the
            // PARENT session id — a child executes once, but the parent may delegate to the
            // same CLI again and should pick up its last active external session (P0-1). The
            // child session id is not stored in the row; it stays recoverable via the session
            // parent relationship (`session.parent_id = <parent>`).
            let resumeId: string | undefined
            if (Option.isSome(dbOpt)) {
              const db: Database.Interface["db"] = dbOpt.value.db
              const row = yield* db
                .select()
                .from(ExternalCliSessionTable)
                .where(
                  and(
                    eq(ExternalCliSessionTable.session_id, input.sessionID),
                    eq(ExternalCliSessionTable.cli_target, input.cliTarget),
                    eq(ExternalCliSessionTable.status, "active"),
                  ),
                )
                .orderBy(desc(ExternalCliSessionTable.time_updated))
                .get()
              resumeId = row?.external_session_id
              if (resumeId)
                yield* Effect.logInfo(
                  `CLI resume: found active session ${resumeId} for session ${input.sessionID}, target=${input.cliTarget}`,
                )
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
                      source: { type: "tool", messageID: childSession.id, callID: input.cliTarget },
                    })
                    .pipe(Effect.match({ onSuccess: () => "allow" as const, onFailure: () => "deny" as const })),
                )
                return decision
              }
            }

            // SDK transports (claude/codex) execute through the SDK's own
            // stream/resume; jsonl transports spawn + parse. The SDK/ACP path gets
            // the same timeout bound as executeWithTimeout; interrupting the fiber
            // abandons the wait (the SDK's own child may linger briefly).
            const result =
              (adapter.transport === "sdk" || adapter.transport === "acp") && adapter.execute
                ? yield* adapter
                    .execute({
                      prompt: cliPrompt,
                      cwd: session.location.directory,
                      resumeId,
                      canUseTool,
                    })
                    .pipe(
                      Effect.timeoutOrElse({
                        duration: Duration.millis(adapter.timeout ?? 300_000),
                        orElse: () =>
                          Effect.succeed<DelegationResult>({
                            status: "failed",
                            summary: `CLI "${adapter.name}" execution Timed out`,
                            errors: ["Timed out"],
                          }),
                      }),
                    )
                : yield* executeWithTimeout(spawner!, adapter, {
                    prompt: cliPrompt,
                    cwd: session.location.directory,
                    resumeId,
                  })

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
                status: result.status === "failed" ? "failed" : "completed",
                ...(result.status === "failed" ? { error: result.summary } : { result: result.summary }),
              })
            }

            // Persist the external session id for resume. SDK transports surface
            // it on the DelegationResult; jsonl transports emit a resume_hint
            // frame parsed from raw stdout. Keyed by the PARENT session id so the
            // next same-parent delegation resumes it (P0-1).
            if (Option.isSome(dbOpt)) {
              const db: Database.Interface["db"] = dbOpt.value.db
              const hint = result.sessionId ?? adapter.parseResumeHint?.(result.rawStdout ?? result.summary)
              if (hint) {
                yield* Effect.logInfo(
                  `CLI resume: persisted hint ${hint} for session ${input.sessionID}, target=${input.cliTarget}`,
                )
                yield* db
                  .update(ExternalCliSessionTable)
                  .set({ status: "completed" })
                  .where(
                    and(
                      eq(ExternalCliSessionTable.session_id, input.sessionID),
                      eq(ExternalCliSessionTable.cli_target, input.cliTarget),
                      eq(ExternalCliSessionTable.status, "active"),
                    ),
                  )
                yield* db
                  .insert(ExternalCliSessionTable)
                  .values({
                    session_id: input.sessionID,
                    cli_target: input.cliTarget,
                    external_session_id: hint,
                    status: "active",
                  })
                  .onConflictDoUpdate({
                    target: [ExternalCliSessionTable.session_id, ExternalCliSessionTable.external_session_id],
                    set: { cli_target: input.cliTarget, status: "active" },
                  })
              }
            }

            return { text: result.summary, sessionID: childSession.id, status: result.status }
          }),
      },
      ),
    )
  }),
)
