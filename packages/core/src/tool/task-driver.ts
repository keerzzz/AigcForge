export * as TaskDriver from "./task-driver"

import { Effect } from "effect"
import { AgentV2 } from "../agent"
import { Location } from "../location"
import { SessionMessage } from "../session/message"
import { SessionSchema } from "../session/schema"

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
 * The bridge is a process-global cell rather than a Layer service on purpose.
 * `BuiltInTools` sits deep inside a widely-shared `LayerMap` (`LocationServiceMap`
 * and the aigcfroge Agent/System maps). Modelling the seam as a `Context.Service`
 * forces that requirement to surface at every one of the ~40 call sites that
 * build those maps (LayerMap rejects an unsatisfied `lookup` requirement with a
 * "Missing dependencies" type error). A module-level cell keeps the seam
 * dependency-free: the tool reads it at call time, and the composition root
 * installs the concrete implementation once `SessionV2` exists.
 *
 * This is the V2 formalization of V1's runtime `ctx.extra.promptOps` injection.
 */
export interface Interface {
  /**
   * Create a child Session parented to `parentID`. The implementation inherits
   * the parent Session's Location so the child runs in the same place.
   */
  readonly createChild: (input: { parentID: SessionSchema.ID; agent?: AgentV2.ID }) => Effect.Effect<SessionSchema.Info>
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
   */
  readonly delegate: (input: { sessionID: SessionSchema.ID; prompt: string }) => Effect.Effect<string>
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
  }) => Effect.Effect<void>
  /** Interrupt active work owned by this process. Idle interruption is a no-op. */
  readonly interrupt: (sessionID: SessionSchema.ID) => Effect.Effect<void>
}

// The process-global bridge cell. `install` replaces it; the accessors read it
// lazily at call time so a re-install (e.g. a fresh test runtime) takes effect.
let installed: Interface | undefined

const active = () =>
  installed
    ? Effect.succeed(installed)
    : Effect.die("TaskDriver.install must run before the task tool executes")

/** Create a child Session through the installed implementation. */
export const createChild = (input: { parentID: SessionSchema.ID; agent?: AgentV2.ID }) =>
  active().pipe(Effect.flatMap((impl) => impl.createChild(input)))

/** Delegate a prompt to a child Session and await its final text (foreground). */
export const delegate = (input: { sessionID: SessionSchema.ID; prompt: string }) =>
  active().pipe(Effect.flatMap((impl) => impl.delegate(input)))

/** Delegate to a child Session in the background; its result is injected into the parent later. */
export const delegateBackground = (input: {
  parentID: SessionSchema.ID
  sessionID: SessionSchema.ID
  prompt: string
  description: string
}) => active().pipe(Effect.flatMap((impl) => impl.delegateBackground(input)))

/** Interrupt a child Session's active work. */
export const interrupt = (sessionID: SessionSchema.ID) =>
  active().pipe(Effect.flatMap((impl) => impl.interrupt(sessionID)))

/** Minimal `SessionV2` surface the implementation needs. Structural to avoid importing SessionV2. */
export interface SessionFacade {
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<{ location: Location.Ref }, unknown>
  readonly create: (input: {
    parentID: SessionSchema.ID
    agent?: AgentV2.ID
    location: Location.Ref
  }) => Effect.Effect<SessionSchema.Info, unknown>
  readonly prompt: (input: { sessionID: SessionSchema.ID; prompt: { text: string } }) => Effect.Effect<unknown, unknown>
  readonly resume: (sessionID: SessionSchema.ID) => Effect.Effect<void, unknown>
  readonly messages: (input: { sessionID: SessionSchema.ID }) => Effect.Effect<SessionMessage.Message[], unknown>
  /**
   * Append a synthetic message to `sessionID` and wake it to run a turn — the
   * V2 injection path for background task results. Backed by
   * `SessionV2.injectSynthetic` at the composition root.
   */
  readonly injectSynthetic: (input: { sessionID: SessionSchema.ID; text: string }) => Effect.Effect<void, unknown>
  readonly interrupt: (sessionID: SessionSchema.ID) => Effect.Effect<void>
}

/**
 * Runs child Session work on a fiber independent of the caller's; the
 * composition root backs this with `BackgroundJob`. `start` schedules the work
 * and returns immediately; `wait` awaits a scheduled job's completion. See the
 * {@link Interface.delegate} docstring for why the drain must not run on the
 * caller's fiber.
 */
export interface BackgroundRunner {
  readonly start: (sessionID: SessionSchema.ID, work: Effect.Effect<void, unknown>) => Effect.Effect<void, unknown>
  readonly wait: (sessionID: SessionSchema.ID) => Effect.Effect<void, unknown>
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
 * Installs the concrete seam implementation from a `SessionV2`-shaped facade plus
 * an off-fiber `background` runner. Call this once at each composition root that
 * runs Sessions (public API, server, app runtime), after `SessionV2` exists.
 * Importing `SessionV2` here would reintroduce the cycle the seam exists to
 * break, so the facade is passed in structurally. `SessionV2` is a leaf at the
 * call site; nothing depends back on the seam, so this closes no cycle.
 *
 * `delegate` admits the prompt, drives the child on an independent `BackgroundJob`
 * fiber, and reads the child's final assistant text from the projected history.
 * `delegateBackground` schedules the same drain plus a result injection into the
 * parent, then returns immediately without awaiting it.
 */
export const install = (sessions: SessionFacade, background: BackgroundRunner) => {
  const readResult = (sessionID: SessionSchema.ID) =>
    sessions.messages({ sessionID }).pipe(Effect.map(lastAssistantText))

  installed = {
    createChild: (input) =>
      sessions.get(input.parentID).pipe(
        Effect.flatMap((parent) =>
          sessions.create({ parentID: input.parentID, agent: input.agent, location: parent.location }),
        ),
        Effect.orDie,
      ),
    delegate: (input) =>
      sessions.prompt({ sessionID: input.sessionID, prompt: { text: input.prompt } }).pipe(
        Effect.andThen(background.start(input.sessionID, sessions.resume(input.sessionID))),
        Effect.andThen(background.wait(input.sessionID)),
        Effect.andThen(readResult(input.sessionID)),
        Effect.orDie,
      ),
    delegateBackground: (input) =>
      sessions.prompt({ sessionID: input.sessionID, prompt: { text: input.prompt } }).pipe(
        // Drive the child, then inject its result into the parent — all on the
        // background fiber, sequential (never nested), so no SQLite deadlock.
        // BackgroundJob isolates fiber failures, so a failed injection is logged
        // but never crashes the runtime; the child result still lives in its own
        // Session history.
        Effect.andThen(
          background.start(
            input.sessionID,
            sessions.resume(input.sessionID).pipe(
              Effect.andThen(readResult(input.sessionID)),
              Effect.flatMap((text) =>
                sessions.injectSynthetic({
                  sessionID: input.parentID,
                  text: renderBackgroundResult({ sessionID: input.sessionID, description: input.description, text }),
                }),
              ),
              Effect.tapCause((cause) => Effect.logError("TaskDriver background injection failed", cause)),
            ),
          ),
        ),
        Effect.orDie,
      ),
    interrupt: (sessionID) => sessions.interrupt(sessionID),
  }
}
