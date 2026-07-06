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
   * Admit `prompt`, drive the Session to settlement, and return its final
   * assistant text.
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

/** Delegate a prompt to a child Session and await its final text. */
export const delegate = (input: { sessionID: SessionSchema.ID; prompt: string }) =>
  active().pipe(Effect.flatMap((impl) => impl.delegate(input)))

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
  readonly interrupt: (sessionID: SessionSchema.ID) => Effect.Effect<void>
}

/**
 * Runs a child Session drain on a fiber independent of the caller's. See the
 * {@link Interface.delegate} docstring for why the drain must not run on the
 * caller's fiber; the composition root backs this with `BackgroundJob`.
 */
export interface BackgroundRunner {
  readonly runOffFiber: (
    sessionID: SessionSchema.ID,
    drain: Effect.Effect<void, unknown>,
  ) => Effect.Effect<void, unknown>
}

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
 */
export const install = (sessions: SessionFacade, background: BackgroundRunner) => {
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
        Effect.andThen(background.runOffFiber(input.sessionID, sessions.resume(input.sessionID))),
        Effect.andThen(sessions.messages({ sessionID: input.sessionID })),
        Effect.map(lastAssistantText),
        Effect.orDie,
      ),
    interrupt: (sessionID) => sessions.interrupt(sessionID),
  }
}

const lastAssistantText = (messages: ReadonlyArray<SessionMessage.Message>) => {
  const last = messages.findLast((message) => message.type === "assistant")
  if (last?.type !== "assistant") return ""
  return last.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
}
