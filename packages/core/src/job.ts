export * as Job from "./job.js"

import { Array, Cause, Clock, Context, Deferred, Effect, Exit, Layer, Schema, Scope, SynchronizedRef } from "effect"
import { makeGlobalNode } from "@omnixa/util/effect/app-node"
import { KV } from "./kv.js"
import { SessionMessage } from "./session/message.js"
import { SessionSchema } from "./session/schema.js"
import { DelegationID, ParticipantID } from "@omnixa/schema/delegation-id"

const Background = Schema.Struct({
  id: Schema.String,
  notificationID: SessionMessage.ID,
  recovery: Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("shell"),
      sessionID: SessionSchema.ID,
      shellID: Schema.String,
      command: Schema.String,
    }),
    Schema.Struct({
      kind: Schema.Literal("subagent"),
      parentSessionID: SessionSchema.ID,
      childSessionID: SessionSchema.ID,
      agent: Schema.String,
      description: Schema.String,
    }),
    Schema.Struct({
      kind: Schema.Literal("delegation"),
      delegationID: DelegationID.ID,
      participantID: ParticipantID,
      parentSessionID: SessionSchema.ID,
      childSessionID: SessionSchema.ID,
      description: Schema.String,
    }),
  ]),
  status: Schema.Literals(["running", "completed", "error", "cancelled"]),
  output: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
})

export type Background = typeof Background.Type
export type Recovery = Background["recovery"]
export type Status = Background["status"]

const decodeBackground = Schema.decodeUnknownResult(Background)
const backgroundPrefix = "job.background/"
const sessionDeletionPrefix = "job.session-delete/"
const COMPLETED_LIMIT = 25

const deletionJobID = (sessionID: string) => `${sessionDeletionPrefix}${sessionID}`

export type Info = {
  id: string
  type: string
  title?: string
  status: Status
  started_at: number
  completed_at?: number
  output?: string
  error?: string
  metadata?: Record<string, unknown>
  notificationID?: SessionMessage.ID
}

type Active = {
  info: Info
  done: Deferred.Deferred<Info>
  stopped: Deferred.Deferred<void>
  backgrounded: Deferred.Deferred<Info>
  scope: Scope.Closeable
  blockingSessions: Map<SessionSchema.ID, number>
  isBackgrounded: boolean
  consumed: boolean
  recovery?: Recovery
  deletionReferences?: number
}

type State = {
  jobs: SynchronizedRef.SynchronizedRef<Map<string, Active>>
  scope: Scope.Scope
}

type FinishResult = {
  info?: Info
  done?: Deferred.Deferred<Info>
  scope?: Scope.Closeable
  generation?: Scope.Closeable
}

type BackgroundResult = {
  info?: Info
  backgrounded?: Deferred.Deferred<Info>
}

type StartResult =
  | { info: Info }
  | { info: Info; scope: Scope.Closeable }
  | { info: Info; rejectedScope: Scope.Closeable }

type BlockWait = {
  done: Deferred.Deferred<Info>
  backgrounded: Deferred.Deferred<Info>
  generation: Scope.Closeable
}

type BlockStart =
  | { type: "missing" }
  | { type: "finished"; info: Info; generation: Scope.Closeable }
  | { type: "backgrounded"; info: Info }
  | { type: "wait"; wait: BlockWait }

export type StartInput = {
  id: string
  type: string
  title?: string
  metadata?: Record<string, unknown>
  recovery?: Recovery
  notificationID?: SessionMessage.ID
  run: Effect.Effect<string, unknown>
}

export type WaitInput = {
  id: string
  timeout?: number
}

export type WaitResult = {
  info?: Info
  timedOut: boolean
}

export type BlockInput = {
  id: string
  sessionID: SessionSchema.ID
}

export type BlockResult = { type: "finished"; info: Info } | { type: "backgrounded"; info: Info }

export type BackgroundAllInput = {
  sessionID: SessionSchema.ID
  type?: string
}

export interface Interface {
  readonly get: (id: string) => Effect.Effect<Info | undefined>
  readonly start: (input: StartInput) => Effect.Effect<Info>
  readonly wait: (input: WaitInput) => Effect.Effect<WaitResult>
  readonly block: (input: BlockInput) => Effect.Effect<BlockResult | undefined>
  readonly background: (id: string) => Effect.Effect<Info | undefined>
  readonly backgroundAll: (input: BackgroundAllInput) => Effect.Effect<Info[]>
  readonly cancel: (id: string) => Effect.Effect<Info | undefined>
  readonly cancelAllForSession: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly isDeletingSession: (sessionID: SessionSchema.ID) => Effect.Effect<boolean>
  readonly withSessionDeletion: <A, E, R>(
    sessionID: SessionSchema.ID,
    self: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>
  readonly pendingBackground: Effect.Effect<readonly Background[]>
  readonly completeBackground: (notificationID: SessionMessage.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@omnixa/Job") {}

function snapshot(job: Active): Info {
  return {
    ...job.info,
    ...(job.info.metadata ? { metadata: { ...job.info.metadata } } : {}),
  }
}

function errorText(cause: Cause.Cause<unknown>) {
  const render = (error: Error): string => {
    const message = error.message || error.name || "Unknown error"
    if (!(error.cause instanceof Error)) return message
    const detail = render(error.cause)
    return detail === message || detail.startsWith(`${message}\n`) ? detail : `${message}\nCaused by: ${detail}`
  }
  return Cause.prettyErrors(cause).map(render).join("\n") || "Unknown error"
}

function incrementSession(input: Map<SessionSchema.ID, number>, sessionID: SessionSchema.ID) {
  return new Map(input).set(sessionID, (input.get(sessionID) ?? 0) + 1)
}

function decrementSession(input: Map<SessionSchema.ID, number>, sessionID: SessionSchema.ID) {
  const count = input.get(sessionID)
  if (count === undefined) return input
  const next = new Map(input)
  if (count <= 1) next.delete(sessionID)
  else next.set(sessionID, count - 1)
  return next
}

/**
 * Makes one scoped, process-local registry. Explicitly recoverable background
 * work also owns a durable notification marker until its notification is admitted.
 * Unconsumed results survive the start-to-wait handoff. Foreground block/cancel
 * and non-recoverable wait results enter a 25-entry consumed history. Recoverable
 * wait results stay available for background registration and acknowledgment.
 */
export const make = Effect.gen(function* () {
  const kv = yield* KV.Service
  const state: State = {
    jobs: yield* SynchronizedRef.make(new Map()),
    scope: yield* Scope.Scope,
  }

  const consume = (id: string, generation: Scope.Closeable) =>
    SynchronizedRef.update(state.jobs, (jobs) => {
      const job = jobs.get(id)
      if (!job || job.scope !== generation || job.info.status === "running" || job.consumed) return jobs
      const next = new Map(jobs)
      // Order history by first consumption, not by start time or subsequent reads.
      next.delete(id)
      next.set(id, { ...job, consumed: true })
      const completed = [...next].filter(([, job]) => job.consumed && !job.info.notificationID)
      for (const [id] of completed.slice(0, -COMPLETED_LIMIT)) next.delete(id)
      return next
    })

  const persistBackground = Effect.fnUntraced(function* (job: Active) {
    if (!job.recovery || !job.info.notificationID) return
    yield* kv.set(`${backgroundPrefix}${job.info.notificationID}`, {
      id: job.info.id,
      notificationID: job.info.notificationID,
      recovery: job.recovery,
      status: job.info.status,
      ...(job.info.output !== undefined ? { output: job.info.output } : {}),
      ...(job.info.error !== undefined ? { error: job.info.error } : {}),
    })
  })

  const settle = Effect.fnUntraced(function* (id: string, scope: Scope.Closeable, exit: Exit.Exit<string, unknown>) {
    const completed_at = yield* Clock.currentTimeMillis
    const result = yield* SynchronizedRef.modifyEffect(
      state.jobs,
      Effect.fnUntraced(function* (jobs): Effect.fn.Return<readonly [FinishResult, Map<string, Active>]> {
        const job = jobs.get(id)
        if (!job) return [{}, jobs]
        if (job.scope !== scope) return [{}, jobs]
        if (job.info.status !== "running") return [{ info: snapshot(job) }, jobs]
        const status: Exclude<Status, "running"> = Exit.isSuccess(exit)
          ? "completed"
          : Cause.hasInterruptsOnly(exit.cause)
            ? "cancelled"
            : "error"
        const next = {
          ...job,
          blockingSessions: new Map<SessionSchema.ID, number>(),
          info: {
            ...job.info,
            status,
            completed_at,
            ...(Exit.isSuccess(exit) ? { output: exit.value } : {}),
            ...(Exit.isFailure(exit) ? { error: errorText(exit.cause) } : {}),
          },
        }
        if (status !== "cancelled") yield* persistBackground(next)
        return [{ info: snapshot(next), done: job.done, scope: job.scope }, new Map(jobs).set(id, next)]
      }),
    )
    if (result.info && result.done) yield* Deferred.succeed(result.done, result.info)
    if (result.scope) {
      yield* Scope.close(result.scope, Exit.void).pipe(Effect.forkIn(state.scope, { startImmediately: true }))
    }
    return result.info
  })

  const get: Interface["get"] = Effect.fn("Job.get")(function* (id) {
    const job = (yield* SynchronizedRef.get(state.jobs)).get(id)
    if (!job) return undefined
    return snapshot(job)
  })

  const start: Interface["start"] = Effect.fnUntraced(function* (input) {
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const started_at = yield* Clock.currentTimeMillis
        const done = yield* Deferred.make<Info>()
        const stopped = yield* Deferred.make<void>()
        const backgrounded = yield* Deferred.make<Info>()
        const result = yield* SynchronizedRef.modifyEffect(
          state.jobs,
          Effect.fnUntraced(function* (jobs): Effect.fn.Return<readonly [StartResult, Map<string, Active>]> {
            const existing = jobs.get(input.id)
            const closed = state.scope.state._tag === "Closed"
            const blocked =
              closed ||
              input.id.startsWith(sessionDeletionPrefix) ||
              [input.metadata?.sessionID, input.metadata?.childSessionID].some(
                (sessionID) =>
                  typeof sessionID === "string" && (jobs.get(deletionJobID(sessionID))?.deletionReferences ?? 0) > 0,
              )
            const info = {
              id: input.id,
              type: input.type,
              title: input.title,
              status: blocked ? ("cancelled" as const) : ("running" as const),
              started_at,
              metadata: input.metadata,
              ...(input.notificationID ? { notificationID: input.notificationID } : {}),
              ...(blocked
                ? {
                    completed_at: started_at,
                    error: closed
                      ? "Job registry scope is closed"
                      : input.id.startsWith(sessionDeletionPrefix)
                        ? "Session deletion Job IDs are reserved"
                        : "Session deletion in progress",
                  }
                : {}),
            }
            // An incoming start is rejected without replacing the generation that deletion is already stopping.
            if (blocked && existing?.info.status === "running") return [{ info }, jobs]
            if (existing?.info.status === "running") {
              return [{ info: snapshot(existing) }, jobs]
            }
            const scope = yield* Scope.fork(state.scope, "parallel")
            const job = {
              info,
              done,
              stopped,
              backgrounded,
              scope,
              blockingSessions: new Map<SessionSchema.ID, number>(),
              isBackgrounded: false,
              consumed: false,
              recovery: input.recovery,
            }
            if (blocked) {
              yield* Deferred.succeed(done, info)
              yield* Deferred.succeed(stopped, undefined)
              return [{ info, rejectedScope: scope }, new Map(jobs).set(input.id, job)]
            }
            return [{ info: snapshot(job), scope }, new Map(jobs).set(input.id, job)]
          }),
        )
        if ("scope" in result)
          yield* restore(input.run).pipe(
            Effect.ensuring(Deferred.succeed(stopped, undefined)),
            Effect.exit,
            Effect.flatMap((exit) => settle(input.id, result.scope, exit)),
            Effect.asVoid,
            Effect.forkIn(result.scope, { startImmediately: true }),
          )
        if ("rejectedScope" in result) {
          yield* Scope.close(result.rejectedScope, Exit.void)
          yield* consume(input.id, result.rejectedScope)
        }
        return result.info
      }),
    )
  })

  const wait: Interface["wait"] = Effect.fn("Job.wait")(function* (input) {
    const job = (yield* SynchronizedRef.get(state.jobs)).get(input.id)
    if (!job) return { timedOut: false }
    return yield* Effect.gen(function* () {
      if (job.info.status !== "running") return { info: snapshot(job), timedOut: false }
      if (input.timeout === undefined) return { info: yield* Deferred.await(job.done), timedOut: false }
      if (input.timeout <= 0) return { info: snapshot(job), timedOut: true }
      const info = yield* Deferred.await(job.done).pipe(Effect.timeoutOption(input.timeout))
      if (info._tag === "Some") return { info: info.value, timedOut: false }
      return { info: snapshot(job), timedOut: true }
    }).pipe(
      // Recoverable wait -> background is a supported handoff, even after failure.
      Effect.tap((result) =>
        result.info.status === "running" || job.recovery ? Effect.void : consume(input.id, job.scope),
      ),
    )
  })

  const removeBlock = Effect.fnUntraced(function* (input: BlockInput) {
    yield* SynchronizedRef.update(state.jobs, (jobs) => {
      const job = jobs.get(input.id)
      if (!job || job.info.status !== "running" || job.isBackgrounded) return jobs
      return new Map(jobs).set(input.id, {
        ...job,
        blockingSessions: decrementSession(job.blockingSessions, input.sessionID),
      })
    })
  })

  const block: Interface["block"] = Effect.fnUntraced(function* (input) {
    const result = yield* SynchronizedRef.modify(state.jobs, (jobs): readonly [BlockStart, Map<string, Active>] => {
      const job = jobs.get(input.id)
      if (!job) return [{ type: "missing" }, jobs]
      if (job.info.status !== "running") return [{ type: "finished", info: snapshot(job), generation: job.scope }, jobs]
      if (job.isBackgrounded) return [{ type: "backgrounded", info: snapshot(job) }, jobs]
      return [
        { type: "wait", wait: { done: job.done, backgrounded: job.backgrounded, generation: job.scope } },
        new Map(jobs).set(input.id, {
          ...job,
          blockingSessions: incrementSession(job.blockingSessions, input.sessionID),
        }),
      ]
    })
    if (result.type === "missing") return undefined
    if (result.type === "finished") {
      yield* consume(input.id, result.generation)
      return { type: "finished", info: result.info }
    }
    if (result.type === "backgrounded") return { type: "backgrounded", info: result.info }
    return yield* Effect.raceFirst(
      Deferred.await(result.wait.done).pipe(Effect.map((info) => ({ type: "finished" as const, info }))),
      Deferred.await(result.wait.backgrounded).pipe(Effect.map((info) => ({ type: "backgrounded" as const, info }))),
    ).pipe(
      Effect.tap((outcome) => (outcome.type === "finished" ? consume(input.id, result.wait.generation) : Effect.void)),
      Effect.ensuring(removeBlock(input)),
    )
  })

  const markBackground = Effect.fnUntraced(function* (job: Active) {
    const next = {
      ...job,
      isBackgrounded: true,
      blockingSessions: new Map<SessionSchema.ID, number>(),
      info: {
        ...job.info,
        ...(job.recovery ? { notificationID: job.info.notificationID ?? SessionMessage.ID.create() } : {}),
      },
    }
    yield* persistBackground(next)
    return next
  })

  const background: Interface["background"] = Effect.fn("Job.background")(function* (id) {
    const result = yield* SynchronizedRef.modifyEffect(
      state.jobs,
      Effect.fnUntraced(function* (jobs): Effect.fn.Return<readonly [BackgroundResult, Map<string, Active>]> {
        const job = jobs.get(id)
        // Recoverable work may finish before the caller backgrounds it.
        if (!job || (job.info.status !== "running" && !job.recovery)) return [{}, jobs]
        if (job.isBackgrounded) return [{ info: snapshot(job) }, jobs]
        const next = yield* markBackground(job)
        return [{ info: snapshot(next), backgrounded: job.backgrounded }, new Map(jobs).set(id, next)]
      }),
    )
    if (result.info && result.backgrounded) yield* Deferred.succeed(result.backgrounded, result.info)
    return result.info
  })

  const backgroundAll: Interface["backgroundAll"] = Effect.fn("Job.backgroundAll")(function* (input) {
    const result = yield* SynchronizedRef.modifyEffect(
      state.jobs,
      Effect.fnUntraced(function* (jobs): Effect.fn.Return<
        readonly [Required<BackgroundResult>[], Map<string, Active>]
      > {
        const results: Required<BackgroundResult>[] = []
        const next = new Map(jobs)
        for (const [id, job] of jobs) {
          if (job.info.status !== "running") continue
          if (job.isBackgrounded) continue
          if (input.type !== undefined && job.info.type !== input.type) continue
          if (!job.blockingSessions.has(input.sessionID)) continue
          const updated = yield* markBackground(job)
          results.push({ info: snapshot(updated), backgrounded: job.backgrounded })
          next.set(id, updated)
        }
        return [results, next]
      }),
    )
    yield* Effect.forEach(result, (item) => Deferred.succeed(item.backgrounded, item.info), { discard: true })
    return result.map((item) => item.info)
  })

  const cancel = Effect.fn("Job.cancel")(function* (id: string, generation?: Scope.Closeable) {
    const completed_at = yield* Clock.currentTimeMillis
    const result = yield* SynchronizedRef.modifyEffect(
      state.jobs,
      Effect.fnUntraced(function* (jobs): Effect.fn.Return<readonly [FinishResult, Map<string, Active>]> {
        const job = jobs.get(id)
        if (!job || (generation !== undefined && job.scope !== generation)) return [{}, jobs]
        if (job.deletionReferences !== undefined) return [{ info: snapshot(job) }, jobs]
        if (job.info.status !== "running") return [{ info: snapshot(job), generation: job.scope }, jobs]
        const next = {
          ...job,
          blockingSessions: new Map<SessionSchema.ID, number>(),
          info: {
            ...job.info,
            status: "cancelled" as const,
            completed_at,
          },
        }
        yield* persistBackground(next)
        return [
          { info: snapshot(next), done: job.done, scope: job.scope, generation: job.scope },
          new Map(jobs).set(id, next),
        ]
      }),
    )
    if (result.info && result.done) yield* Deferred.succeed(result.done, result.info)
    if (result.scope) yield* Scope.close(result.scope, Exit.void)
    if (result.generation) yield* consume(id, result.generation)
    return result.info
  })

  const cancelAllForSession: Interface["cancelAllForSession"] = Effect.fn("Job.cancelAllForSession")(
    function* (sessionID) {
      const owned = Effect.gen(function* () {
        return yield* Effect.filter(
          [...(yield* SynchronizedRef.get(state.jobs)).values()].filter(
            (job) =>
              job.deletionReferences === undefined &&
              (job.info.metadata?.sessionID === sessionID || job.info.metadata?.childSessionID === sessionID),
          ),
          (job) =>
            job.info.status === "running"
              ? Effect.succeed(true)
              : Deferred.isDone(job.stopped).pipe(Effect.map((stopped) => !stopped)),
        )
      })
      const stop = (job: Active) =>
        cancel(job.info.id, job.scope).pipe(Effect.andThen(Deferred.await(job.stopped)), Effect.asVoid)

      // Producers must stop before the child snapshot: their finalizers can register more work.
      yield* Effect.forEach(
        (yield* owned).filter(
          (job) => job.info.metadata?.sessionID === sessionID && job.info.metadata?.childSessionID === undefined,
        ),
        stop,
        { discard: true },
      )
      // cancel publishes before scope cleanup; join stopped even when another caller already cancelled.
      while (true) {
        const remaining = yield* owned
        if (remaining.length === 0) return
        yield* Effect.forEach(remaining, stop, { discard: true })
      }
    },
  )

  const isDeletingSession: Interface["isDeletingSession"] = Effect.fn("Job.isDeletingSession")(function* (sessionID) {
    return ((yield* SynchronizedRef.get(state.jobs)).get(deletionJobID(sessionID))?.deletionReferences ?? 0) > 0
  })

  const withSessionDeletion: Interface["withSessionDeletion"] = Effect.fn("Job.withSessionDeletion")(function* <
    A,
    E,
    R,
  >(sessionID: SessionSchema.ID, self: Effect.Effect<A, E, R>): Effect.fn.Return<A, E, R> {
    const id = deletionJobID(sessionID)
    return yield* Effect.acquireUseRelease(
      SynchronizedRef.modifyEffect(
        state.jobs,
        Effect.fnUntraced(function* (jobs): Effect.fn.Return<readonly [Scope.Closeable, Map<string, Active>]> {
          const existing = jobs.get(id)
          if (existing?.deletionReferences !== undefined)
            return [
              existing.scope,
              new Map(jobs).set(id, { ...existing, deletionReferences: existing.deletionReferences + 1 }),
            ]
          const scope = yield* Scope.fork(state.scope, "parallel")
          return [
            scope,
            new Map(jobs).set(id, {
              info: {
                id,
                type: "session_delete",
                status: "running",
                started_at: yield* Clock.currentTimeMillis,
                metadata: { deletingSessionID: sessionID },
              },
              done: yield* Deferred.make<Info>(),
              stopped: yield* Deferred.make<void>(),
              backgrounded: yield* Deferred.make<Info>(),
              scope,
              blockingSessions: new Map<SessionSchema.ID, number>(),
              isBackgrounded: false,
              consumed: false,
              deletionReferences: 1,
            }),
          ]
        }),
      ),
      () => self,
      (scope, exit) =>
        Effect.gen(function* () {
          const finished = yield* SynchronizedRef.modify(
            state.jobs,
            (jobs): readonly [Active | undefined, Map<string, Active>] => {
              const job = jobs.get(id)
              if (!job || job.scope !== scope || job.deletionReferences === undefined) return [undefined, jobs]
              if (job.deletionReferences > 1)
                return [undefined, new Map(jobs).set(id, { ...job, deletionReferences: job.deletionReferences - 1 })]
              const next = new Map(jobs)
              next.delete(id)
              return [job, next]
            },
          )
          if (!finished) return
          yield* Scope.close(scope, exit)
          yield* Deferred.succeed(finished.stopped, undefined)
          yield* Deferred.succeed(finished.done, {
            ...finished.info,
            status: Exit.isSuccess(exit) ? "completed" : Cause.hasInterruptsOnly(exit.cause) ? "cancelled" : "error",
            completed_at: yield* Clock.currentTimeMillis,
          })
        }),
    )
  })

  const pendingBackground: Interface["pendingBackground"] = Effect.gen(function* () {
    const recovered: Background[] = []
    let after: string | undefined
    do {
      const page = yield* kv.scan({ prefix: backgroundPrefix, after })
      recovered.push(...Array.filterMap(page.entries, (entry) => decodeBackground(entry.value)))
      after = page.next
    } while (after)
    return recovered
  }).pipe(Effect.withSpan("Job.pendingBackground"))

  const completeBackground: Interface["completeBackground"] = Effect.fn("Job.completeBackground")((notificationID) =>
    SynchronizedRef.updateEffect(state.jobs, (jobs) =>
      Effect.gen(function* () {
        yield* kv.remove(`${backgroundPrefix}${notificationID}`)
        const entry = [...jobs].find(([, job]) => job.info.notificationID === notificationID)
        if (!entry || entry[1].info.status === "running") return jobs
        const next = new Map(jobs)
        next.delete(entry[0])
        return next
      }),
    ),
  )

  return Service.of({
    get,
    start,
    wait,
    block,
    background,
    backgroundAll,
    cancel,
    cancelAllForSession,
    isDeletingSession,
    withSessionDeletion,
    pendingBackground,
    completeBackground,
  })
})

const layer = Layer.effect(Service, make)

export const node = makeGlobalNode({ service: Service, layer, deps: [KV.node] })
