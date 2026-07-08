export * as TaskDriverFill from "./task-driver-fill"

import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { and, eq } from "drizzle-orm"
import { Effect, Layer, Option } from "effect"
import { BackgroundJob } from "../background-job"
import { SessionV2 } from "../session"
import { TaskDriver } from "../tool/task-driver"
import { getCliAdapter, registerCliAdapter } from "../tool/cli-adapter"
import { executeWithTimeout } from "../tool/cli-timeout"
import { ExternalCliSessionTable } from "../tool/cli-session.sql"
import { adapter as opencodeAdapter } from "../tool/opencode"
import { adapter as claudeCodeAdapter } from "../tool/claude-code"
import { adapter as geminiAdapter } from "../tool/gemini"
import { adapter as codexAdapter } from "../tool/codex"
import { MetaAgentService } from "../meta-agent/service"
import { Database } from "../database/database"

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
    const spawner = yield* Effect.serviceOption(ChildProcessSpawner).pipe(
      Effect.map((op) => (op._tag === "Some" ? op.value : undefined)),
    )
    // Register built-in CLI adapters so the task tool can delegate to external
    // CLI tools. Additional adapters can be registered before this layer runs.
    registerCliAdapter(claudeCodeAdapter.name, claudeCodeAdapter)
    registerCliAdapter(geminiAdapter.name, geminiAdapter)
    registerCliAdapter(codexAdapter.name, codexAdapter)
    registerCliAdapter(opencodeAdapter.name, opencodeAdapter)
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
            if (!spawner) return yield* Effect.fail(new Error("CLI execution not available (no process spawner)"))
            const adapter = getCliAdapter(input.cliTarget)
            if (!adapter) return yield* Effect.fail(new Error(`Unknown CLI target: ${input.cliTarget}`))
            const session = yield* sessions.get(input.sessionID)

            // Attempt to load DB for resume lookup and hint persistence.
            // Not all callers (e.g. tests) provide Database.Service, so the
            // optional service access is caught; when absent, DB operations
            // are skipped without affecting CLI execution.
            const dbOpt = yield* Effect.serviceOption(Database.Service).pipe(
              Effect.catch(() => Effect.succeed(Option.none() as Option.Option<never>),
            ))

            // Check for a pending external CLI session to resume.
            let resumeId: string | undefined
            if (Option.isSome(dbOpt)) {
              // The drizzle db handle is typed as DatabaseShape (a complex
              // EffectDrizzleSqlite type). Cast to any is needed because the
              // drizzle query builder types don't compose across module
              // boundaries for the ExternalCliSessionTable schema.
              const db: any = dbOpt.value.db
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
            }

            const result = yield* executeWithTimeout(spawner, adapter, {
              prompt: input.prompt,
              cwd: session.location.directory,
              resumeId,
            })

            // Persist resume_hint if the CLI emitted one and DB is available.
            if (Option.isSome(dbOpt) && adapter.parseResumeHint) {
              // Same drizzle type boundary as above — DatabaseShape doesn't
              // compose with ExternalCliSessionTable's typed query builder.
              const db: any = dbOpt.value.db
              const hint = adapter.parseResumeHint(result.rawStdout ?? result.summary)
              if (hint) {
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

            return result.summary
          }) as unknown as Effect.Effect<string, Error>,
      },
    )
  }),
)
