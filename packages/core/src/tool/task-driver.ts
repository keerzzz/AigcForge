export * as TaskDriver from "./task-driver"

import { Cause, Context, Effect, Exit, Layer, Ref, Schema } from "effect"
import { AgentV2 } from "../agent"
import { Location } from "../location"
import { ProductModeAgentPolicy } from "../product-mode-agent-policy"
import { PermissionTier } from "@aigcfroge/schema/permission-tier"
import { SessionMessage } from "../session/message"
import { SessionSchema } from "../session/schema"
import { generateSummary } from "../session/share-summary"
import { judgeMerge } from "../agent/judge"
import type { DelegationStatus } from "./cli-adapter"

/**
 * A foreground delegation ended without a usable result because the child
 * Session's drain itself failed or was cancelled — as opposed to an
 * infrastructure fault (admission, scheduling, history read), which dies. This
 * is the one recoverable outcome the `task` tool retries: `reason` distinguishes
 * a crashed subagent turn (`error`) from an interrupted one (`cancelled`).
 */
export class DelegateError extends Schema.TaggedErrorClass<DelegateError>()("TaskDriver.DelegateError", {
  sessionID: SessionSchema.ID,
  reason: Schema.Literals(["error", "cancelled"]),
  message: Schema.optional(Schema.String),
}) {}

/**
 * Late-bound seam that lets the `task` built-in tool drive child Sessions
 * without importing `SessionV2` directly.
 *
 * The tool registry is constructed inside `LocationServiceMap.lookup`, which is
 * itself a dependency of `SessionExecution` (and therefore `SessionV2`). A
 * direct `yield* SessionV2.Service` inside the tool would close that dependency
 * cycle at the type level, and tool `execute` carries `R = never`, so a tool
 * cannot request services at call time.
 *
 * The concrete implementation is carried by a Context Reference. References
 * have a default value and therefore do not add a Layer requirement to the
 * opaque Tool executor, while an App/public/server composition root can still
 * provide its own isolated Session runtime. This keeps the dependency cycle
 * open without a process-global "last registration wins" cell.
 *
 * This is the V2 formalization of V1's runtime `ctx.extra.promptOps` injection.
 */
export interface Interface {
  /**
   * Create a child Session parented to `parentID`. The implementation inherits
   * the parent Session's Location so the child runs in the same place.
   *
   * When `id` is supplied, `SessionV2.create` is idempotent: an existing Session
   * with that id is returned as-is (task `task_id` resume), otherwise a fresh one
   * is created under it. The caller is responsible for verifying that a resumed
   * Session actually belongs to `parentID` before prompting it.
   */
  readonly createChild: (input: {
    parentID: SessionSchema.ID
    agent?: AgentV2.ID
    id?: SessionSchema.ID
    attended?: boolean
  }) => Effect.Effect<SessionSchema.Info>
  /**
   * Admit `prompt`, drive the child Session to settlement, and return its final
   * assistant text (foreground delegation).
   *
   * The drain runs on an independent `BackgroundJob` fiber, never on the
   * caller's fiber. That matters because the caller here is a tool executing
   * inside the parent Session's own drain: driving the child synchronously on
   * the parent's fiber deadlocks the single-connection SQLite serializer (the
   * parent holds the execution chain while the child waits for it). This mirrors
   * V1's task tool, which also settles child Sessions on a BackgroundJob fiber
   * and only awaits the result.
   *
   * Fails with {@link DelegateError} when the child's drain crashed or was
   * cancelled — the recoverable outcome the tool retries. Infrastructure faults
   * (admission, scheduling, history read) still die.
   */
  /**
   * Fails with {@link DelegateError} when the child's drain crashed or was
   * cancelled — the recoverable outcome the tool retries. Infrastructure faults
   * (admission, scheduling, history read) still die.
   *
   * `taskID` + `onSettle` opt into the dual-track todo linkage: when the child
   * settles, `onSettle` fires with the terminal state so the caller can write
   * back the linked todo entry. The callback runs after `background.wait`, on
   * the caller's fiber — the child drain has already settled, so it cannot
   * deadlock the single-connection SQLite serializer.
   */
  readonly delegate: (input: {
    sessionID: SessionSchema.ID
    parentID?: SessionSchema.ID
    prompt: string
    taskID?: string
    onSettle?: (outcome: SettleOutcome) => Effect.Effect<void>
  }) => Effect.Effect<string, DelegateError>
  /**
   * Judge mode: delegate the same prompt to N child sessions in parallel using
   * the specified models, collect all results, call a Judge LLM to merge them,
   * and return the merged text. Each child runs on its own BackgroundJob fiber.
   * Falls back to the first child's result when the Judge LLM is unavailable.
   */
  readonly delegateJudge: (input: {
    parentID: SessionSchema.ID
    models: readonly string[]
    prompt: string
    description?: string
  }) => Effect.Effect<string, DelegateError>
  /**
   * Admit `prompt` and drive the child Session on an independent fiber, then
   * return immediately without awaiting it. When the child settles, its final
   * assistant text is injected into `parentID` as a synthetic message and the
   * parent is woken to run a turn over the result — mirroring V1's background
   * task tool (`inject` + parent wake). `description` labels the injected result.
   */
  readonly delegateBackground: (input: {
    parentID: SessionSchema.ID
    sessionID: SessionSchema.ID
    prompt: string
    description: string
    taskID?: string
    onSettle?: (outcome: SettleOutcome) => Effect.Effect<void>
  }) => Effect.Effect<void>
  /**
   * Admit `prompt` to a child Session whose background drain is already running
   * and append it to that job's work queue. Returns `true` when the job was
   * extended (the prompt will be drained after the in-flight turn settles, then
   * its result injected into `parentID`); `false` when there is no running job
   * for that Session (caller falls back to {@link delegateBackground}). This is
   * the V2 path for `task_id` resume against an in-flight background task.
   */
  readonly extendBackground: (input: {
    parentID: SessionSchema.ID
    sessionID: SessionSchema.ID
    prompt: string
    description: string
  }) => Effect.Effect<boolean>
  /** Interrupt active work owned by this process. Idle interruption is a no-op. */
  readonly interrupt: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  /**
   * Cancel a child Session's scheduled/running background drain and interrupt its
   * active work. Used to clean up the orphan Session left by a failed delegation
   * attempt before the tool retries, so the retry starts from a fresh child.
   */
  readonly cancel: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  /** Returns true when `sessionID` has a parent (is a child Session). */
  readonly isChildSession: (sessionID: SessionSchema.ID) => Effect.Effect<boolean>
  /**
   * The Product Mode of `sessionID`, or undefined when it cannot be resolved.
   * Callers use it to apply mode-bound policy before delegating, so a denied
   * delegation surfaces as a typed tool failure instead of a child-session defect.
   */
  readonly sessionMode: (sessionID: SessionSchema.ID) => Effect.Effect<string | undefined>
  /** Append a synthetic handoff to a Session and run its owning agent. */
  readonly injectSynthetic: (input: {
    id?: SessionMessage.ID
    sessionID: SessionSchema.ID
    text: string
  }) => Effect.Effect<void>
  /**
   * Execute a prompt against an external CLI tool (claude-code, gemini, codex,
   * opencode, etc.). The adapter is resolved through the installed CLI adapter
   * registry at the composition root. Returns the CLI's output text and terminal
   * status, or fails when the CLI is unavailable or times out.
   */
  readonly executeCLI: (input: {
    cliTarget: string
    prompt: string
    description: string
    sessionID: SessionSchema.ID
    taskID?: SessionSchema.ID
  }) => Effect.Effect<{ text: string; sessionID: SessionSchema.ID; status: DelegationStatus }, Error>
}

export const Runtime = Context.Reference<Interface | undefined>("@aigcfroge/v2/TaskDriver/Runtime", {
  defaultValue: () => undefined,
})

const RuntimeState = Context.Reference<Ref.Ref<Interface | undefined> | undefined>(
  "@aigcfroge/v2/TaskDriver/RuntimeState",
  { defaultValue: () => undefined },
)

const resolve = (state: Ref.Ref<Interface | undefined>) =>
  Ref.get(state).pipe(
    Effect.flatMap((implementation) =>
      implementation
        ? Effect.succeed(implementation)
        : Effect.die("TaskDriver runtime must be initialized by the current composition root"),
    ),
  )

const proxy = (state: Ref.Ref<Interface | undefined>): Interface => ({
  createChild: (input) => resolve(state).pipe(Effect.flatMap((implementation) => implementation.createChild(input))),
  delegate: (input) => resolve(state).pipe(Effect.flatMap((implementation) => implementation.delegate(input))),
  delegateJudge: (input) => resolve(state).pipe(Effect.flatMap((implementation) => implementation.delegateJudge(input))),
  cancel: (sessionID) => resolve(state).pipe(Effect.flatMap((implementation) => implementation.cancel(sessionID))),
  delegateBackground: (input) =>
    resolve(state).pipe(Effect.flatMap((implementation) => implementation.delegateBackground(input))),
  extendBackground: (input) =>
    resolve(state).pipe(Effect.flatMap((implementation) => implementation.extendBackground(input))),
  interrupt: (sessionID) => resolve(state).pipe(Effect.flatMap((implementation) => implementation.interrupt(sessionID))),
  isChildSession: (sessionID) =>
    resolve(state).pipe(Effect.flatMap((implementation) => implementation.isChildSession(sessionID))),
  sessionMode: (sessionID) => resolve(state).pipe(Effect.flatMap((implementation) => implementation.sessionMode(sessionID))),
  injectSynthetic: (input) =>
    resolve(state).pipe(Effect.flatMap((implementation) => implementation.injectSynthetic(input))),
  executeCLI: (input) => resolve(state).pipe(Effect.flatMap((implementation) => implementation.executeCLI(input))),
})

/** Creates the root-local runtime proxy and its private initialization state. */
export const runtimeLayer = Layer.effect(
  Runtime,
  Effect.gen(function* () {
    const state = yield* RuntimeState
    if (state === undefined) return yield* Effect.die("TaskDriver runtime state is not provided")
    return proxy(state)
  }),
).pipe(Layer.provideMerge(Layer.effect(RuntimeState, Ref.make<Interface | undefined>(undefined))))

/** Initializes the runtime captured by the current composition root. */
export const initialize = (implementation: Interface) =>
  Effect.gen(function* () {
    const state = yield* RuntimeState
    if (state === undefined) return yield* Effect.die("TaskDriver runtime state is not provided")
    yield* Ref.set(state, implementation)
    return undefined
  })

/** Check whether the current composition root provides a TaskDriver runtime. */
export const isInstalled = () =>
  Runtime.pipe(
    Effect.map((implementation) => implementation !== undefined),
  )

const active = () =>
  Runtime.pipe(
    Effect.flatMap((implementation) =>
      implementation
        ? Effect.succeed(implementation)
        : Effect.die("TaskDriver runtime must be provided by the current composition root"),
    ),
  )

/** Create a child Session through the installed implementation. */
export const createChild = (input: {
  parentID: SessionSchema.ID
  agent?: AgentV2.ID
  id?: SessionSchema.ID
  attended?: boolean
}) => active().pipe(Effect.flatMap((impl) => impl.createChild(input)))

/** Delegate a prompt to a child Session and await its final text (foreground). */
export const delegate = (input: {
  sessionID: SessionSchema.ID
  parentID?: SessionSchema.ID
  prompt: string
  taskID?: string
  onSettle?: (outcome: SettleOutcome) => Effect.Effect<void>
}) => active().pipe(Effect.flatMap((impl) => impl.delegate(input)))

/** Judge mode: parallel dispatch across N models, results merged by Judge LLM. */
export const delegateJudge = (input: {
  parentID: SessionSchema.ID
  models: readonly string[]
  prompt: string
  description?: string
}) => active().pipe(Effect.flatMap((impl) => impl.delegateJudge(input)))

/** Cancel a child Session's background drain and interrupt its active work (orphan cleanup). */
export const cancel = (sessionID: SessionSchema.ID) => active().pipe(Effect.flatMap((impl) => impl.cancel(sessionID)))

/** Delegate to a child Session in the background; its result is injected into the parent later. */
export const delegateBackground = (input: {
  parentID: SessionSchema.ID
  sessionID: SessionSchema.ID
  prompt: string
  description: string
  taskID?: string
  onSettle?: (outcome: SettleOutcome) => Effect.Effect<void>
}) => active().pipe(Effect.flatMap((impl) => impl.delegateBackground(input)))

/** Extend a running background delegation with an additional prompt; false if no running job. */
export const extendBackground = (input: {
  parentID: SessionSchema.ID
  sessionID: SessionSchema.ID
  prompt: string
  description: string
}) => active().pipe(Effect.flatMap((impl) => impl.extendBackground(input)))

/** Interrupt a child Session's active work. */
export const interrupt = (sessionID: SessionSchema.ID) =>
  active().pipe(Effect.flatMap((impl) => impl.interrupt(sessionID)))

/** Returns true when `sessionID` has a parent (is a child Session). */
export const isChildSession = (sessionID: SessionSchema.ID) =>
  active().pipe(Effect.flatMap((impl) => impl.isChildSession(sessionID)))

/** The Product Mode of `sessionID`, or undefined when it cannot be resolved. */
export const sessionMode = (sessionID: SessionSchema.ID) =>
  active().pipe(Effect.flatMap((impl) => impl.sessionMode(sessionID)))

/** Append a synthetic handoff through the current composition root. */
export const injectSynthetic = (input: {
  id?: SessionMessage.ID
  sessionID: SessionSchema.ID
  text: string
}) => active().pipe(Effect.flatMap((impl) => impl.injectSynthetic(input)))

/** Execute a prompt against an external CLI tool through the installed adapter. */
export const executeCLI = (input: {
  cliTarget: string
  prompt: string
  description: string
  sessionID: SessionSchema.ID
  taskID?: SessionSchema.ID
}) => active().pipe(Effect.flatMap((impl) => impl.executeCLI(input)))

/** Minimal `SessionV2` surface the implementation needs. Structural to avoid importing SessionV2. */
export interface SessionFacade {
  readonly get: (
    sessionID: SessionSchema.ID,
  ) => Effect.Effect<
    { location: Location.Ref; parentID?: SessionSchema.ID; mode?: string; permissionTier?: PermissionTier.ID },
    unknown
  >
  readonly create: (input: {
    id?: SessionSchema.ID
    parentID: SessionSchema.ID
    agent?: AgentV2.ID
    location: Location.Ref
    attended?: boolean
    title?: string
  }) => Effect.Effect<SessionSchema.Info, unknown>
  readonly prompt: (input: {
    sessionID: SessionSchema.ID
    prompt: { text: string }
    resume?: boolean
  }) => Effect.Effect<unknown, unknown>
  readonly resume: (sessionID: SessionSchema.ID) => Effect.Effect<void, unknown>
  readonly messages: (input: { sessionID: SessionSchema.ID }) => Effect.Effect<SessionMessage.Message[], unknown>
  /**
   * Append a synthetic message to `sessionID` and wake it to run a turn — the
   * V2 injection path for background task results. Backed by
   * `SessionV2.injectSynthetic` at the composition root.
   */
  readonly injectSynthetic: (input: {
    id?: SessionMessage.ID
    sessionID: SessionSchema.ID
    text: string
  }) => Effect.Effect<void, unknown>
  readonly interrupt: (sessionID: SessionSchema.ID) => Effect.Effect<void>
}

/**
 * Runs child Session work on a fiber independent of the caller's; the
 * composition root backs this with `BackgroundJob`. `start` schedules the work
 * and returns immediately; `wait` awaits a scheduled job's completion. See the
 * {@link Interface.delegate} docstring for why the drain must not run on the
 * caller's fiber.
 */
/**
 * Terminal state reported to a delegation's `onSettle` writeback callback.
 * `outputDigest` carries the child Session id on completion or the error
 * summary on failure so the linked todo can jump to the sub-session.
 */
export interface SettleOutcome {
  readonly status: "completed" | "failed" | "cancelled"
  readonly outputDigest?: string
}

/**
 * The terminal outcome of a scheduled child drain, as observed by `wait`. Mirrors
 * the subset of `BackgroundJob.Info` the seam needs: a job that never registered
 * (or whose owner scope closed) reports `undefined`, which `delegate` treats as a
 * completed-but-empty drain rather than a failure.
 */
export interface BackgroundOutcome {
  readonly status: "completed" | "error" | "cancelled"
  readonly error?: string
}

export interface BackgroundRunner {
  readonly start: (sessionID: SessionSchema.ID, work: Effect.Effect<void, unknown>) => Effect.Effect<void, unknown>
  readonly wait: (sessionID: SessionSchema.ID) => Effect.Effect<BackgroundOutcome | undefined, unknown>
  /**
   * Append `work` to a running job's queue. Returns `false` if no running job
   * exists for `sessionID`; `true` if queued (work runs after the in-flight turn).
   */
  readonly extend: (sessionID: SessionSchema.ID, work: Effect.Effect<void, unknown>) => Effect.Effect<boolean, unknown>
  /** Cancel a scheduled/running drain owned by this process. Idle cancel is a no-op. */
  readonly cancel: (sessionID: SessionSchema.ID) => Effect.Effect<void, unknown>
}

const lastAssistantText = (messages: ReadonlyArray<SessionMessage.Message>) => {
  const last = messages.findLast((message) => message.type === "assistant")
  if (last?.type !== "assistant") return ""
  return last.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
}

/** Render a completed background task's result as a synthetic message for the parent. */
const renderBackgroundResult = (input: { sessionID: SessionSchema.ID; description: string; text: string }) =>
  [
    `<task id="${input.sessionID}" state="completed">`,
    `<summary>Background task completed: ${input.description}</summary>`,
    "<task_result>",
    input.text,
    "</task_result>",
    "</task>",
  ].join("\n")

/**
 * Builds the concrete seam implementation from a `SessionV2`-shaped facade plus
 * an off-fiber `background` runner. Composition roots provide the result through
 * {@link Runtime} after `SessionV2` exists.
 * Importing `SessionV2` here would reintroduce the cycle the seam exists to
 * break, so the facade is passed in structurally. `SessionV2` is a leaf at the
 * call site; nothing depends back on the seam, so this closes no cycle.
 *
 * `delegate` admits the prompt, drives the child on an independent `BackgroundJob`
 * fiber, and reads the child's final assistant text from the projected history.
 * `delegateBackground` schedules the same drain plus a result injection into the
 * parent, then returns immediately without awaiting it.
 */
export const make = (
  sessions: SessionFacade,
  background: BackgroundRunner,
  cli?: {
    readonly execute: (input: {
      cliTarget: string
      prompt: string
      description: string
      sessionID: SessionSchema.ID
      taskID?: SessionSchema.ID
    }) => Effect.Effect<{ text: string; sessionID: SessionSchema.ID; status: DelegationStatus }, Error>
  },
) => {
  const readResult = (sessionID: SessionSchema.ID) =>
    sessions.messages({ sessionID }).pipe(Effect.map(lastAssistantText))

  // P6.1 Structured Handoffs: compress parent context into a 200-500 token
  // summary via a cheap LLM. Runs in the caller's Effect context (the runner
  // settle path), so LLMClient/Catalog are resolved from the runner scope at
  // runtime - the `R` is erased here so the seam stays dependency-free. Falls
  // back to empty string when summarization is unavailable or fails; defects
  // (missing services in test contexts) are also caught so delegation never
  // breaks due to summary generation.
  const composeParentSummary = (parentID: SessionSchema.ID) =>
    sessions.messages({ sessionID: parentID }).pipe(
      Effect.flatMap((messages) =>
        generateSummary(messages).pipe(
          Effect.catchDefect(() => Effect.succeed("")),
          Effect.catch(() => Effect.succeed("")),
        ),
      ),
      Effect.catchDefect(() => Effect.succeed("")),
      Effect.catch(() => Effect.succeed("")),
    )

  return {
    createChild: (input) =>
      sessions.get(input.parentID).pipe(
        Effect.flatMap((parent) =>
          sessions.create({
            id: input.id,
            parentID: input.parentID,
            agent: input.agent,
            location: parent.location,
            attended: input.attended,
          }),
        ),
        Effect.orDie,
      ),
    delegate: (input) =>
      Effect.gen(function* () {
        // P6.1: prepend a compressed parent-context summary to the prompt so the
        // subagent receives context without the full history. The summary call
        // yields LLMClient/Catalog, resolved from the runner scope at runtime;
        const parentContextSummary = input.parentID ? yield* composeParentSummary(input.parentID) : ""
        const prompt = parentContextSummary
          ? `<parent_context>\n${parentContextSummary}\n</parent_context>\n\n${input.prompt}`
          : input.prompt
        yield* sessions
          .prompt({ sessionID: input.sessionID, prompt: { text: prompt }, resume: false })
          .pipe(Effect.orDie)
        yield* background.start(input.sessionID, sessions.resume(input.sessionID)).pipe(Effect.orDie)
        // Capture the exit of wait + result handling so the dual-track writeback
        // fires even when the caller's fiber is interrupted during background.wait
        // (user abort). Infrastructure faults (prompt, start) still die above.
        let childCancelled = false
        const exit = yield* Effect.gen(function* () {
          const outcome = yield* background.wait(input.sessionID).pipe(Effect.orDie)
          if (outcome && (outcome.status === "error" || outcome.status === "cancelled")) {
            childCancelled = outcome.status === "cancelled"
            return yield* new DelegateError({
              sessionID: input.sessionID,
              reason: outcome.status,
              ...(outcome.error ? { message: outcome.error } : {}),
            })
          }
          const text = yield* readResult(input.sessionID).pipe(Effect.orDie)
          if (text.trim()) return text
          return yield* new DelegateError({
            sessionID: input.sessionID,
            reason: "error",
            message: "Child Session completed without assistant output",
          })
        }).pipe(Effect.exit)
        // Dual-track writeback always fires, regardless of exit status.
        // Sanitised outputDigest: the raw cause may embed Authorization headers,
        // tokens, prompts, or stacks, which must not reach task.updated (Clean Logs).
        if (input.taskID && input.onSettle) {
          const status = Exit.isSuccess(exit)
            ? "completed"
            : childCancelled || Cause.hasInterruptsOnly(exit.cause)
              ? "cancelled"
              : "failed"
          yield* input
            .onSettle({
              status,
              outputDigest:
                status === "completed"
                  ? input.sessionID
                  : status === "failed"
                    ? "foreground delegation failed"
                    : undefined,
            })
            .pipe(Effect.catchCause((cause) => Effect.logError("TaskDriver onSettle writeback failed", cause)))
        }
        return yield* exit
      }) as unknown as Effect.Effect<string, DelegateError>,
    delegateJudge: (input) =>
      Effect.gen(function* () {
        const modelCount = Math.min(input.models.length, 5)
        if (modelCount === 0)
          return yield* new DelegateError({
            sessionID: input.parentID,
            reason: "error",
            message: "judge_models must specify at least one model",
          })

        // Create N children under the same parent.
        const parent = yield* sessions.get(input.parentID)
        const children: Array<SessionSchema.ID> = []
        for (let i = 0; i < modelCount; i++) {
          const child = yield* sessions.create({
            parentID: input.parentID,
            location: parent.location,
          })
          children.push(child.id)
        }

        // Compose parent context summary (same as delegate's pattern).
        const parentSummary = input.parentID ? yield* composeParentSummary(input.parentID) : ""
        const prompt = parentSummary
          ? `<parent_context>\n${parentSummary}\n</parent_context>\n\n${input.prompt}`
          : input.prompt

        // Admit prompt to each child sequentially (SQLite serialization), then
        // start background drains and wait for all to complete concurrently.
        for (const id of children) {
          yield* sessions.prompt({ sessionID: id, prompt: { text: prompt }, resume: false })
          yield* background.start(id, sessions.resume(id))
        }

        const outcomes = yield* Effect.all(
          children.map((id) =>
            background.wait(id).pipe(
              Effect.andThen(readResult(id).pipe(Effect.catch(() => Effect.succeed("")))),
              Effect.catch(() => Effect.succeed("")),
            ),
          ),
          { concurrency: "unbounded" },
        )
        yield* Effect.logDebug(
          `delegateJudge: ${children.length} children, ${outcomes.filter((r): r is string => r.length > 0).length} succeeded`,
        )

        // Cancel failed children so their BackgroundJob scopes close.
        for (let i = 0; i < children.length; i++) {
          if (!outcomes[i] || outcomes[i].length === 0) yield* background.cancel(children[i]).pipe(Effect.ignore)
        }

        // Judge merge: non-empty results → LLM merge → final text.
        const results = outcomes.filter((r): r is string => r.length > 0)
        if (results.length === 0)
          return yield* new DelegateError({
            sessionID: input.parentID,
            reason: "error",
            message: "All judge delegates failed",
          })

        return yield* judgeMerge(prompt, results)
      }) as unknown as Effect.Effect<string, DelegateError>,
    delegateBackground: (input) =>
      sessions.prompt({ sessionID: input.sessionID, prompt: { text: input.prompt }, resume: false }).pipe(
        // Drive the child, then inject its result into the parent — all on the
        // background fiber, sequential (never nested), so no SQLite deadlock.
        // The dual-track writeback settles here too, after the child drain, so
        // the DB serializer is free. BackgroundJob isolates fiber failures, so a
        // failed injection is logged but never crashes the runtime; the child
        // result still lives in its own Session history.
        Effect.andThen(
          background.start(
            input.sessionID,
            Effect.gen(function* () {
              // Capture the drain exit (resume + readResult) separately from
              // injection so a failed injection does not classify the delegation
              // itself as failed.
              const drainExit = yield* Effect.gen(function* () {
                yield* sessions.resume(input.sessionID)
                return yield* readResult(input.sessionID)
              }).pipe(Effect.exit)
              // Settle the linked todo based on the drain outcome only.
              if (input.taskID && input.onSettle) {
                if (Exit.isSuccess(drainExit)) {
                  yield* input
                    .onSettle({ status: "completed", outputDigest: input.sessionID })
                    .pipe(Effect.catchCause((cause) => Effect.logError("TaskDriver onSettle writeback failed", cause)))
                } else if (Cause.hasInterruptsOnly(drainExit.cause)) {
                  yield* input
                    .onSettle({ status: "cancelled" })
                    .pipe(Effect.catchCause((cause) => Effect.logError("TaskDriver onSettle writeback failed", cause)))
                } else {
                  // Fixed classification only: the raw cause may embed Authorization
                  // headers, tokens, prompts, or stacks, which must not reach the
                  // task.updated payload (Clean Logs).
                  yield* input
                    .onSettle({ status: "failed", outputDigest: "background delegation failed" })
                    .pipe(Effect.catchCause((cause) => Effect.logError("TaskDriver onSettle writeback failed", cause)))
                }
              }
              // Inject result into parent (best-effort, after writeback).
              if (Exit.isSuccess(drainExit)) {
                yield* sessions
                  .injectSynthetic({
                    sessionID: input.parentID,
                    text: renderBackgroundResult({
                      sessionID: input.sessionID,
                      description: input.description,
                      text: drainExit.value,
                    }),
                  })
                  .pipe(Effect.catchCause((cause) => Effect.logError("TaskDriver background injection failed", cause)))
              }
              if (Exit.isFailure(drainExit)) {
                yield* Effect.logError("TaskDriver background delegation failed", drainExit.cause)
              }
              // Re-raise so the BackgroundJob status reflects the drain outcome.
              yield* drainExit
            }),
          ),
        ),
        Effect.orDie,
      ),
    extendBackground: (input) =>
      // The prompt is admitted INSIDE the queued work, not before extend: if
      // there is no running job (extend returns false), nothing is admitted and
      // the caller falls back to delegateBackground. When extended, the work runs
      // after the in-flight turn settles — admit, drain, read, inject — mirroring
      // delegateBackground's tail but appended to the existing job's queue.
      background
        .extend(
          input.sessionID,
          sessions.prompt({ sessionID: input.sessionID, prompt: { text: input.prompt }, resume: false }).pipe(
            Effect.andThen(sessions.resume(input.sessionID)),
            Effect.andThen(readResult(input.sessionID)),
            Effect.flatMap((text) =>
              sessions.injectSynthetic({
                sessionID: input.parentID,
                text: renderBackgroundResult({ sessionID: input.sessionID, description: input.description, text }),
              }),
            ),
            Effect.tapCause((cause) => Effect.logError("TaskDriver background extend injection failed", cause)),
          ),
        )
        .pipe(Effect.orDie),
    interrupt: (sessionID) => sessions.interrupt(sessionID),
    // Cancel the scheduled/running drain (so its BackgroundJob settles as
    // cancelled and its scope closes), then interrupt any active execution the
    // child still owns. Orphan cleanup before a retry: best-effort, so both legs
    // ignore failure rather than masking the original delegation error.
    cancel: (sessionID) =>
      background.cancel(sessionID).pipe(Effect.ignore, Effect.andThen(sessions.interrupt(sessionID))),
    isChildSession: (sessionID) =>
      sessions.get(sessionID).pipe(
        Effect.map((info) => info.parentID !== undefined),
        Effect.orDie,
      ),
    sessionMode: (sessionID) =>
      sessions.get(sessionID).pipe(
        Effect.map((info) => info.mode),
        Effect.catch(() =>
          Effect.logWarning(`task-driver: session lookup failed for mode gate (${sessionID}), defaulting permissively`).pipe(
            Effect.andThen(Effect.succeed(undefined)),
          ),
        ),
      ),
    injectSynthetic: (input) => sessions.injectSynthetic(input).pipe(Effect.orDie),
    executeCLI: (input) =>
      Effect.gen(function* () {
        // External-CLI delegation never creates a child Session, so it bypasses
        // `enforcePrimary`'s mode-bound agent allowlist. Gate it on the mode here
        // or chat mode keeps an open write channel (ADR-13 Amendment-2 §1b).
        // Session lookup failure is fail-closed（M4）：存储故障时不得按 coding
        // 放行，否则 chat propose-first 不变量在瞬时 DB 错误下洞开。
        const parent = yield* sessions.get(input.sessionID).pipe(
          Effect.catch(() =>
            Effect.logWarning(`task-driver: session lookup failed for CLI gate (${input.sessionID}), denying`).pipe(
              Effect.andThen(
                Effect.fail(
                  new ProductModeAgentPolicy.CommandDeniedError({
                    mode: "unknown",
                    reason: "Session lookup failed; external CLI delegation denied",
                  }),
                ),
              ),
            ),
          ),
        )
        const verdict = ProductModeAgentPolicy.checkCliDelegationAllowed(
          parent.mode ?? "coding",
          parent.permissionTier ?? PermissionTier.Default,
        )
        if (!verdict.allowed) return yield* Effect.fail(verdict.error)
        if (!cli) return yield* Effect.fail(new Error("CLI adapter registry not available"))
        return yield* cli.execute(input)
      }),
  } satisfies Interface
}

/**
 * Builds a test runtime for effects that do not construct a full composition
 * root. Tests must provide the returned value through {@link Runtime}; this
 * helper never mutates process-global selection state.
 */
export const installForTesting = (
  sessions: SessionFacade,
  background: BackgroundRunner,
  cli?: Parameters<typeof make>[2],
) => Effect.succeed(make(sessions, background, cli))
