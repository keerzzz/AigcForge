export * as TaskDriverFill from "./task-driver-fill"

import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { and, eq } from "drizzle-orm"
import { DateTime, Effect, Layer, Option, Schema } from "effect"
import { AgentV2 } from "../agent"
import { BackgroundJob } from "../background-job"
import { EventV2 } from "../event"
import { SessionV2 } from "../session"
import { Prompt } from "../session/prompt"
import { SessionMessageID } from "../session/message-id"
import { SessionEvent } from "../session/event"
import { TaskDriver } from "../tool/task-driver"
import { getCliAdapter, registerCliAdapter, registerConfigCliAdapters } from "../tool/cli-adapter"
import { executeWithTimeout } from "../tool/cli-timeout"
import { ExternalCliSessionTable } from "../tool/cli-session.sql"
import { adapter as opencodeAdapter } from "../tool/opencode"
import { adapter as claudeCodeAdapter } from "../tool/claude-code"
import { adapter as geminiAdapter } from "../tool/gemini"
import { adapter as codexAdapter } from "../tool/codex"
import { MetaAgentService } from "../meta-agent/service"
import { Database } from "../database/database"
import { Config } from "../config"

/**
 * The external-CLI dispatch could not run because no `ChildProcessSpawner` was
 * provided at the composition root, or the requested CLI target has no registered
 * adapter. A typed error (rather than a bare `Error`) so callers can branch on it.
 */
export class CliUnavailableError extends Schema.TaggedErrorClass<CliUnavailableError>()(
  "TaskDriverFill.CliUnavailableError",
  {
    cliTarget: Schema.String,
    reason: Schema.Literals(["no_spawner", "unknown_target"]),
  },
) {
  override get message() {
    return this.reason === "no_spawner"
      ? `CLI execution not available (no process spawner) for target ${this.cliTarget}`
      : `Unknown CLI target: ${this.cliTarget}`
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
    // Register config-defined cli_agents (config > built-in override) when a
    // Config.Service is present (composition roots always provide one).
    const configOpt = yield* Effect.serviceOption(Config.Service)
    if (configOpt._tag === "Some") {
      yield* configOpt.value.entries().pipe(
        Effect.map(registerConfigCliAdapters),
        Effect.catch(() => Effect.void),
      )
    }
    const metaAgent = yield* Effect.serviceOption(MetaAgentService.Service)
    TaskDriver.install(
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
        start: (sessionID, work) =>
          background.start({ id: sessionID, type: "task", run: work.pipe(Effect.as("")) }),
        // Map BackgroundJob's terminal Info to the seam's BackgroundOutcome. A
        // still-"running" status can't occur here (wait blocks until the job
        // settles); a missing Info (job never registered / scope closed) is
        // reported as undefined so delegate treats it as completed-but-empty.
        wait: (sessionID) =>
          background.wait({ id: sessionID }).pipe(
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
            if (!spawner) return yield* new CliUnavailableError({ cliTarget: input.cliTarget, reason: "no_spawner" })
            const adapter = getCliAdapter(input.cliTarget)
            if (!adapter) return yield* new CliUnavailableError({ cliTarget: input.cliTarget, reason: "unknown_target" })
            const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)

            // Create a real child session so the task card link navigates to a real
            // session. The child's title is the task description and its agent is the
            // CLI name (mirrors V1's task tool, which passes description as the title).
            const childSession = yield* sessions
              .create({
                parentID: input.sessionID,
                agent: AgentV2.ID.make(input.cliTarget),
                location: session.location,
                title: input.description,
              })
              .pipe(Effect.orDie)

            // Write the delegated prompt as the child's first user message so the child
            // Session reads like a real conversation (mirrors V1's task tool).
            const cliPrompt = `[Project directory: ${session.location.directory}]\n\n${input.prompt}`
            yield* events.publish(SessionEvent.Prompted, {
              sessionID: childSession.id,
              messageID: SessionMessageID.ID.create(),
              timestamp: yield* DateTime.now,
              prompt: Prompt.make({ text: cliPrompt }),
              delivery: "steer",
            }).pipe(Effect.orDie)

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
                    eq(ExternalCliSessionTable.status, "active"),
                  ),
                )
                .get()
              resumeId = row?.external_session_id
              if (resumeId) yield* Effect.logInfo(
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

            const result = yield* executeWithTimeout(spawner, adapter, {
              prompt: cliPrompt,
              cwd: session.location.directory,
              resumeId,
            })

            // Write the CLI summary as the child's second user message.
            yield* events.publish(SessionEvent.Prompted, {
              sessionID: childSession.id,
              messageID: SessionMessageID.ID.create(),
              timestamp: yield* DateTime.now,
              prompt: Prompt.make({ text: result.summary }),
              delivery: "steer",
            }).pipe(Effect.orDie)

            if (stepID && metaAgentSvc) {
              yield* metaAgentSvc.updateStep({
                stepID,
                status: result.status === "failed" ? "failed" : "completed",
                ...(result.status === "failed" ? { error: result.summary } : { result: result.summary }),
              })
            }

            // Persist resume_hint if the CLI emitted one and DB is available. Keyed by the
            // PARENT session id so the next same-parent delegation resumes it (P0-1).
            if (Option.isSome(dbOpt) && adapter.parseResumeHint) {
              const db: Database.Interface["db"] = dbOpt.value.db
              const hint = adapter.parseResumeHint(result.rawStdout ?? result.summary)
              if (hint) {
                yield* Effect.logInfo(
                  `CLI resume: persisted hint ${hint} for session ${input.sessionID}, target=${input.cliTarget}`,
                )
                yield* db
                  .insert(ExternalCliSessionTable)
                  .values({
                    session_id: input.sessionID,
                    cli_target: input.cliTarget,
                    external_session_id: hint,
                    status: "active",
                  })
                  .onConflictDoNothing()
              }
            }

            return { text: result.summary, sessionID: childSession.id, status: result.status }
          }),
      },
    )
  }),
)
