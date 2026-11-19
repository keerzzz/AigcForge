export * as SessionStep from "./step.js"

import {
  AIError,
  InvalidRequestError,
  InvalidProviderOutputError,
  LLMClient,
  LLMEvent,
  isContextOverflowFailure,
  type ProviderErrorEvent,
  type ToolCall,
} from "@aigcfroge/ai"
import type { Agent } from "@aigcfroge/schema/agent"
import { Model } from "@aigcfroge/schema/model"
import { SessionAttempt } from "@aigcfroge/schema/session-attempt"
import { Cause, Clock, Data, Effect, Exit, Fiber, Option, Schema, Stream } from "effect"
import { and, eq } from "drizzle-orm"
import { Hash } from "@aigcfroge/util/hash"
import { SessionError } from "@aigcfroge/schema/session-error"
import { Bus } from "../../bus.js"
import { Permission } from "../../permission.js"
import { Snapshot } from "../../snapshot.js"
import { Database } from "../../database/database.js"
import { FSUtil } from "@aigcfroge/util/fs-util"
import { Tool } from "../../tool.js"
import { ToolOutput } from "../../tool-output.js"
import { QuestionTool } from "../../tool/plugin/question.js"
import { StepFailedError } from "../error.js"
import { SessionEvent } from "../event.js"
import { SessionGoal } from "../goal.js"
import { WorkArtifact } from "../artifact.js"
import { SessionNotification } from "../notification.js"
import { SessionTask } from "../task.js"
import { SessionMessage } from "../message.js"
import { SessionModelRequest } from "../model-request.js"
import { SessionSchema } from "../schema.js"
import type { SessionContext } from "../context.js"
import { SessionProviderContext } from "../provider-context.js"
import { SessionMessageTable } from "../sql.js"
import { toSessionError } from "../to-session-error.js"
import { SessionUsage } from "../usage.js"
import { SessionRunnerModel } from "./model.js"
import { createLLMEventPublisher } from "./publish-llm-event.js"
import { SessionRunnerRetry } from "./retry.js"

export type Outcome = Data.TaggedEnum<{
  Reprepare: {}
  Completed: { readonly needsContinuation: boolean }
  Retry: { readonly error: SessionError.Error; readonly decision: SessionRunnerRetry.Decision }
  Continue: {
    readonly error: SessionError.Error
    readonly decision: SessionRunnerRetry.Decision
  }
  RecoverFull: { readonly reason?: SessionAttempt.Failure }
  Compacted: { readonly reason?: SessionAttempt.Failure }
}>
export const Outcome = Data.taggedEnum<Outcome>()

export interface Boundary {
  start?: { readonly model: Model.Ref; readonly started: number; published: boolean; snapshot?: Snapshot.ID }
}

interface Input {
  readonly isLocationClosed: () => boolean
  readonly sessionID: SessionSchema.ID
  readonly assistantMessageID: SessionMessage.ID
  readonly resultAnchorInputID?: SessionMessage.ID
  readonly agent: Agent.ID
  readonly model: SessionRunnerModel.Resolved
  readonly selection?: Model.Selection
  readonly behaviorDigest?: string
  readonly boundary?: Boundary
  readonly transition?: SessionAttempt.Started["transition"]
  readonly reason?: SessionAttempt.Failure
  readonly prepared: Omit<SessionModelRequest.Prepared, "event">
  readonly retry: (
    cause: AIError,
    error: SessionError.Error,
    retry: boolean,
    outputStarted: boolean,
  ) => Effect.Effect<
    SessionRunnerRetry.DecisionResult,
    Effect.Error<ReturnType<SessionContext.Interface["resolveModel"]>> | StepFailedError
  >
  readonly recoverContinuation: boolean
  /** The runner owns compaction policy; the attempt invokes it only before durable output. */
  readonly recoverOverflow: Effect.Effect<boolean>
  /** Successful logical Step settlement, after all attempts and local tools have completed. */
  readonly completeStep?: Effect.Effect<void>
}

const TOOLS_INTERRUPTED = { type: "aborted", message: "Tool execution interrupted" } as const
const STEP_INTERRUPTED = { type: "aborted", message: "Step interrupted" } as const
const RESULT_MISSING = { type: "tool.result-missing", message: "Provider did not return a tool result" } as const
const INPUT_INCOMPLETE = {
  type: "tool.input-incomplete",
  message:
    "Tool call arguments were not completed and were not executed. Re-issue the tool call with complete arguments.",
} as const

/** Captures Location-scoped dependencies without introducing another service or execution loop. */
export const make = Effect.gen(function* () {
  const bus = yield* Bus.Service
  const llm = yield* LLMClient.Service
  const snapshots = yield* Snapshot.Service
  const toolOutput = yield* ToolOutput.Service
  const goals = yield* SessionGoal.Service
  const database = yield* Database.Service
  const tasks = yield* SessionTask.Service
  const fs = yield* FSUtil.Service
  const artifacts = yield* WorkArtifact.Service

  const readAssistant = Effect.fnUntraced(function* (input: Pick<Input, "sessionID" | "assistantMessageID">) {
    const row = yield* database.db
      .select()
      .from(SessionMessageTable)
      .where(
        and(
          eq(SessionMessageTable.session_id, input.sessionID),
          eq(SessionMessageTable.id, input.assistantMessageID),
          eq(SessionMessageTable.type, "assistant"),
        ),
      )
      .get()
      .pipe(Effect.orDie)
    return row === undefined
      ? undefined
      : Schema.decodeUnknownSync(SessionMessage.Assistant)({ ...row.data, id: row.id, type: row.type })
  })

  const attempt = Effect.fn("SessionStep.attempt")(function* (input: Input) {
    const ordinal = (yield* readAssistant(input))?.attempts?.length ?? 0
    const attemptID = "gatt_" + Hash.sha256(JSON.stringify([input.sessionID, input.assistantMessageID, ordinal]))
    const admission = Effect.gen(function* () {
      const goalAttempts = yield* goals
        .beforeAttempt({
          sessionID: input.sessionID,
          assistantMessageID: input.assistantMessageID,
          attemptID,
          kind: "coordinator",
        })
        .pipe(
          Effect.mapError((error) => new StepFailedError({ error: { type: "goal.budget", message: error.reason } })),
        )
      const started = yield* Clock.currentTimeMillis
      const quote = SessionUsage.currentQuote(input.model.quote ?? { status: "unknown" }, started)
      yield* bus.publish(SessionEvent.Attempt.Started, {
        sessionID: input.sessionID,
        assistantMessageID: input.assistantMessageID,
        ordinal,
        attemptID,
        agent: input.agent,
        selection: input.selection ?? input.model.ref,
        behaviorDigest: input.behaviorDigest,
        groupMemberIndex: input.model.binding?.cursor,
        model: input.model.ref,
        apiModelID: input.prepared.request.model.id,
        connection: input.model.connection,
        preparedDeployment: SessionProviderContext.provenance(
          { model: input.prepared.request.model, ref: input.model.ref, connection: input.model.connection },
          undefined,
          input.prepared.request,
        ),
        quote,
        quoteOrigin: input.model.quoteOrigin,
        quota: input.model.quota,
        goalRefs: goalAttempts,
        transition: input.transition ?? (ordinal === 0 ? "initial" : "retry"),
        reason: input.reason,
        started,
      })
      return { started, goalAttempts, quote }
    })
    const admitted = yield* input.model.binding?.withReservation(admission) ?? admission
    if (admitted === undefined) return Outcome.Reprepare()
    const started = admitted.started
    const boundary: Boundary = input.boundary ?? {}
    boundary.start ??= { model: input.model.ref, started, published: false }
    let delivery: SessionAttempt.Delivery = "unknown"
    const observe = Effect.fnUntraced(function* (observation: SessionAttempt.Observation) {
      delivery = observation.delivery ?? delivery
      yield* bus.publish(SessionEvent.Attempt.Observed, {
        sessionID: input.sessionID,
        assistantMessageID: input.assistantMessageID,
        ordinal,
        observation,
      })
    }, Effect.uninterruptible)
    // The start snapshot only has to exist before local tools run, which cannot happen before Step.Started,
    // so it is captured while the provider request is in flight instead of delaying it.
    const pendingStartSnapshot = yield* snapshots.capture().pipe(
      Effect.tap((snapshot) =>
        Effect.sync(() => {
          if (boundary.start && !boundary.start.published) boundary.start.snapshot = snapshot
        }),
      ),
      Effect.forkScoped,
    )
    const publisher = createLLMEventPublisher(bus, {
      sessionID: input.sessionID,
      assistantMessageID: input.assistantMessageID,
      agent: input.agent,
      model: input.model.ref,
      providerMetadataKey: input.model.model.route.providerMetadataKey ?? input.model.model.provider,
      pendingSnapshot: Fiber.join(pendingStartSnapshot),
      started,
      start: boundary.start,
      admitted: true,
      onOutput: Effect.gen(function* () {
        const time = yield* Clock.currentTimeMillis
        yield* observe(
          new SessionAttempt.Observation({
            observedAt: time,
            outputStarted: true,
            firstOutputAt: time,
            delivery: "accepted",
          }),
        )
      }),
      onToolSuccess: (eventID) =>
        goals
          .observeTool(eventID)
          .pipe(
            Effect.andThen(
              goals.observeArtifact(input.sessionID).pipe(Effect.provideService(WorkArtifact.Service, artifacts)),
            ),
            Effect.orDie,
          ),
    })
    const toolRuns: Array<{
      readonly call: ToolCall
      readonly fiber: Fiber.Fiber<void, Permission.DeclinedError | QuestionTool.CancelledError>
    }> = []
    const interruptTools = Effect.suspend(() => Fiber.interruptAll(toolRuns.map((run) => run.fiber)))
    const executeTool = Effect.fnUntraced(function* (call: ToolCall) {
      if (input.prepared.request.toolChoice?.type === "none")
        return yield* new Tool.Error({ message: "Tools are disabled after the maximum agent steps" })
      return yield* input.prepared.executeTool({
        sessionID: input.sessionID,
        agent: input.agent,
        messageID: input.assistantMessageID,
        call,
        progress: (update) => publisher.progress(call.id, update),
      })
    })

    // Provider and tool fibers retain per-source order without a shared writer queue.
    // A local execution starts only after its Tool.Called publication completes.
    let overflowFailure: ProviderErrorEvent | undefined
    let consumersObserved = false
    let snapshotReady = false
    let firstTokenRecorded = false
    let providerEndedAt: number | undefined
    // Read to the end, not just the finish event, so the next request can reuse this response.
    const providerStream = llm
      .stream(input.prepared.request, input.prepared.optionsForAttempt?.(observe) ?? input.prepared.options)
      .pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            if (
              !firstTokenRecorded &&
              (event.type === "text-delta" || event.type === "reasoning-delta" || event.type === "tool-input-delta") &&
              event.text.length > 0
            ) {
              firstTokenRecorded = true
              const time = yield* Clock.currentTimeMillis
              yield* observe(
                new SessionAttempt.Observation({ observedAt: time, firstTokenAt: time, delivery: "accepted" }),
              )
            }
            if ((overflowFailure || publisher.hasProviderError()) && LLMEvent.is.stepFinish(event)) {
              yield* publisher.publish(event)
              return
            }
            if (overflowFailure || publisher.hasProviderError()) return
            // Wait here, where cancellation still works, rather than inside the uninterruptible publish.
            if (!snapshotReady) {
              yield* Fiber.join(pendingStartSnapshot)
              snapshotReady = true
            }
            if (
              LLMEvent.is.providerError(event) &&
              isContextOverflowFailure(event) &&
              !publisher.record().outputStarted
            ) {
              overflowFailure = event
              return
            }
            yield* publisher.publish(event)
            if (!consumersObserved && publisher.hasStarted() && !publisher.hasProviderError()) {
              consumersObserved = true
              yield* SessionNotification.observeConsumption(database.db, tasks, fs, {
                sessionID: input.sessionID,
                assistantMessageID: input.assistantMessageID,
                started,
                messages: input.prepared.request.messages,
              }).pipe(Effect.orDie)
            }
            if (event.type !== "tool-call" || event.providerExecuted) return
            toolRuns.push({
              call: event,
              fiber: yield* Effect.uninterruptibleMask((restore) =>
                restore(
                  executeTool(event).pipe(
                    Effect.catchCause((cause) => {
                      if (Cause.hasInterrupts(cause) || Cause.hasFails(cause)) return Effect.failCause(cause)
                      return publisher
                        .failTool(event.id, toSessionError(Cause.squash(cause)))
                        .pipe(Effect.as(undefined))
                    }),
                  ),
                ).pipe(
                  Effect.flatMap((outcome) =>
                    outcome === undefined ? Effect.undefined : toolOutput.truncate(outcome),
                  ),
                  Effect.flatMap((outcome) =>
                    outcome === undefined ? Effect.void : publisher.toolExecution(event.id, event.name, outcome),
                  ),
                  Effect.catchTag("Tool.Error", (error) =>
                    publisher.failTool(event.id, toSessionError(error), error.metadata).pipe(Effect.asVoid),
                  ),
                ),
              ).pipe(Effect.forkScoped),
            })
          }),
        ),
        Effect.ensuring(
          Effect.gen(function* () {
            providerEndedAt = yield* Clock.currentTimeMillis
            yield* publisher.flush()
          }),
        ),
      )

    // Keep the final tool and Step events uninterruptible, even when the work itself is cancelled.
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const stream = yield* restore(providerStream).pipe(Effect.exit)
        const streamFailure = Option.getOrUndefined(Exit.findErrorOption(stream))
        const streamInterrupted = Exit.isFailure(stream) && Cause.hasInterrupts(stream.cause)
        const recorded = publisher.record()
        const unknownFinish =
          Exit.isSuccess(stream) && recorded.finish?.finish === "unknown"
            ? new AIError({
                reason: new InvalidProviderOutputError({
                  message: "The provider response ended with an unknown finish reason.",
                  classification: "incomplete-stream",
                }),
              })
            : undefined
        const llmFailure =
          streamFailure instanceof AIError
            ? streamFailure
            : (unknownFinish ??
              (overflowFailure === undefined
                ? undefined
                : new AIError({
                    reason: new InvalidRequestError({
                      message: overflowFailure.message,
                      classification: overflowFailure.classification,
                    }),
                  })))
        const llmError = llmFailure && !recorded.providerFailed ? toSessionError(llmFailure) : undefined
        const terminal = new SessionAttempt.Terminal({
          status: streamInterrupted
            ? input.isLocationClosed()
              ? "interrupted"
              : "cancelled"
            : Exit.isFailure(stream) || llmFailure !== undefined || recorded.providerFailed
              ? "failed"
              : "completed",
          ended: yield* Clock.currentTimeMillis,
          providerEndedAt,
          outputStarted: recorded.outputStarted,
          finish: recorded.finish?.finish,
          rawFinish: recorded.finish?.rawFinish,
          usage: recorded.finish?.usage,
          cost: SessionUsage.quotedCost(admitted.quote, recorded.finish?.usage),
          failure:
            llmFailure === undefined
              ? recorded.providerFailed
                ? new SessionAttempt.Failure({
                    reason: recorded.finish?.finish === "content-filter" ? "ContentPolicy" : "UnknownProvider",
                  })
                : undefined
              : failureDetails(llmFailure),
          delivery:
            llmFailure?.reason._tag === "Transport" && llmFailure.reason.delivery !== undefined
              ? llmFailure.reason.delivery
              : delivery,
        })
        // Provider accounting commits before waiting for local tools or taking any retry path.
        yield* bus.publish(SessionEvent.Attempt.Ended, {
          sessionID: input.sessionID,
          assistantMessageID: input.assistantMessageID,
          ordinal,
          terminal,
        })
        yield* goals.settleAttempt({ refs: admitted.goalAttempts, usage: terminal.usage }).pipe(Effect.orDie)
        if (!overflowFailure && publisher.hasStarted()) yield* publisher.streamed()
        if (streamInterrupted) yield* interruptTools
        const joined = yield* restore(Fiber.awaitAll(toolRuns.map((run) => run.fiber))).pipe(Effect.exit)
        if (Exit.isFailure(joined)) yield* interruptTools
        const tools = classifyToolExits(joined, toolRuns)

        const overflow = overflowFailure ?? streamFailure
        if (
          !publisher.record().outputStarted &&
          isContextOverflowFailure(overflow) &&
          (yield* restore(input.recoverOverflow))
        ) {
          yield* Effect.logWarning("provider rejected the request as too long; compacting", {
            sessionID: input.sessionID,
            model: input.model.ref,
            message: overflow?.message,
          })
          yield* publisher.failAssistant(toSessionError(llmFailure ?? overflow))
          const assistant = yield* readAssistant(input)
          if (!assistant?.attempts)
            return yield* Effect.die(new Error("Persisted physical receipts disappeared before compaction settlement"))
          yield* publisher.publishStepFailure(SessionUsage.aggregate(assistant.attempts))
          return Outcome.Compacted({ reason: failureDetails(llmFailure) })
        }

        if (overflowFailure) yield* publisher.publish(overflowFailure)
        if (
          input.recoverContinuation &&
          llmFailure?.reason._tag === "Transport" &&
          (llmFailure.reason.recovery === "retry-full" || llmFailure.reason.recovery === "rotate-and-retry-full") &&
          !recorded.outputStarted
        ) {
          yield* publisher.startAssistant(false)
          return Outcome.RecoverFull({ reason: failureDetails(llmFailure) })
        }
        const retry =
          llmFailure &&
          llmError &&
          (!isContextOverflowFailure(llmFailure) ||
            (input.selection !== undefined && Model.Selection.isGroup(input.selection)))
            ? yield* restore(
                input.retry(
                  llmFailure,
                  llmError,
                  SessionRunnerRetry.isRetryable(llmFailure) ||
                    (recorded.outputStarted && isInterruptedStream(llmFailure)),
                  recorded.outputStarted,
                ),
              )
            : undefined
        if (llmFailure && llmError && retry?.retry && !recorded.outputStarted) {
          // Retry state projects onto the existing assistant, even before it has produced output.
          yield* publisher.startAssistant(false)
          return Outcome.Retry({ error: llmError, decision: retry })
        }
        if (llmError) yield* publisher.failAssistant(llmError)
        if (Exit.isFailure(stream) && !streamInterrupted && llmError === undefined && !recorded.providerFailed)
          yield* publisher.failAssistant(toSessionError(Cause.squash(stream.cause)))

        for (const decline of tools.declines)
          yield* publisher.failTool(decline.call.id, {
            type: "aborted",
            message: input.isLocationClosed()
              ? "Interaction cancelled because the location shut down"
              : decline.reason._tag === "QuestionTool.CancelledError"
                ? decline.reason.message
                : "The user declined this tool call",
          })
        const interrupted = tools.declines.length > 0 || streamInterrupted || tools.interrupted
        const toolFailure = interrupted
          ? TOOLS_INTERRUPTED
          : tools.failure !== undefined
            ? toSessionError(Cause.squash(tools.failure))
            : recorded.providerFailed
              ? TOOLS_INTERRUPTED
              : undefined
        if (toolFailure) yield* publisher.failUnsettledTools(toolFailure)
        if (tools.failure) yield* publisher.failAssistant(toSessionError(Cause.squash(tools.failure)))
        if (interrupted) yield* publisher.failAssistant(STEP_INTERRUPTED)

        // Parsers may leave unfinished calls without an execution event.
        if (llmError || (Exit.isSuccess(stream) && !recorded.providerFailed)) {
          const missing = yield* publisher.failUnsettledTools(RESULT_MISSING, "hosted")
          if (missing && !llmError && !recorded.finish) yield* publisher.failAssistant(RESULT_MISSING)
          yield* publisher.failUnsettledTools(INPUT_INCOMPLETE, "uncalled")
        }

        const record = publisher.record()
        const needsContinuation = input.prepared.request.toolChoice?.type !== "none" && record.needsContinuation
        {
          const startSnapshot = boundary.start?.snapshot
          const snapshot =
            (record.finish || record.failure) && snapshotReady && !streamInterrupted
              ? yield* restore(snapshots.capture())
              : undefined
          const files =
            startSnapshot && snapshot
              ? startSnapshot === snapshot
                ? []
                : yield* snapshots
                    .files({ from: startSnapshot, to: snapshot })
                    .pipe(Effect.orElseSucceed(() => undefined))
              : undefined
          const assistant = yield* readAssistant(input)
          if (!assistant?.attempts)
            return yield* Effect.die(new Error("Persisted physical receipts disappeared before logical settlement"))
          const usage = SessionUsage.aggregate(assistant.attempts)
          if (record.failure) yield* publisher.publishStepFailure({ ...usage, snapshot, files })
          if (!record.failure)
            yield* bus.publish(SessionEvent.Step.Ended, {
              sessionID: input.sessionID,
              assistantMessageID: yield* publisher.startAssistant(false),
              needsContinuation: Exit.isSuccess(stream) && !interrupted ? needsContinuation : undefined,
              finish: record.finish?.finish ?? "unknown",
              rawFinish: record.finish?.rawFinish,
              providerState: record.finish?.providerState,
              ...usage,
              snapshot,
              files,
            })
        }

        if (
          llmFailure &&
          llmError &&
          retry?.retry &&
          record.outputStarted &&
          tools.declines.length === 0 &&
          !tools.interrupted
        )
          return Outcome.Continue({ error: llmError, decision: retry })

        if (Exit.isFailure(stream)) return yield* Effect.failCause(stream.cause)
        if (tools.declines.length > 0) {
          if (input.isLocationClosed()) return Outcome.Completed({ needsContinuation: true })
          return yield* Effect.interrupt
        }
        if (tools.interrupted && tools.failure) return yield* Effect.failCause(tools.failure)
        if (tools.interrupted && Exit.isFailure(joined)) return yield* Effect.failCause(joined.cause)
        if (tools.failure) return yield* Effect.failCause(tools.failure)
        if (record.failure) return yield* new StepFailedError({ error: record.failure })
        yield* bus.publish(SessionEvent.Step.Completed, {
          sessionID: input.sessionID,
          assistantMessageID: yield* publisher.startAssistant(),
          resultAnchorInputID: needsContinuation ? undefined : input.resultAnchorInputID,
        })
        if (input.completeStep) yield* input.completeStep
        return Outcome.Completed({ needsContinuation })
      }),
    )
  }, Effect.scoped)

  return { attempt }
})

/** Only typed provider facts enter durable failure details. */
export function failureDetails(failure: AIError | ProviderErrorEvent | undefined): SessionAttempt.Failure | undefined {
  if (failure === undefined) return
  if (!(failure instanceof AIError))
    return new SessionAttempt.Failure({
      reason: failure.classification === undefined ? "UnknownProvider" : "InvalidRequest",
      classification: failure.classification,
    })
  const reason = failure.reason
  return new SessionAttempt.Failure({
    reason: reason._tag,
    classification:
      reason._tag === "InvalidRequest" || reason._tag === "InvalidProviderOutput" ? reason.classification : undefined,
    status: reason.http?.status,
    transport: reason._tag === "Transport" ? reason.transport : undefined,
    operation: reason._tag === "Transport" ? reason.operation : undefined,
    phase: reason._tag === "Transport" ? reason.phase : undefined,
    delivery: reason._tag === "Transport" ? reason.delivery : undefined,
    recovery: reason._tag === "Transport" ? reason.recovery : undefined,
  })
}

/** Reconciles the original durable receipts without admitting or sending another request. */
export const reconcile = Effect.fn("SessionStep.reconcile")(function* (
  db: Database.Interface["db"],
  bus: Bus.Interface,
  goals: SessionGoal.Interface,
  sessionID: SessionSchema.ID,
  options?: {
    readonly assistantMessageID?: SessionMessage.ID
    readonly error?: SessionError.Error
    readonly status?: SessionAttempt.Terminal["status"]
  },
) {
  const rows = yield* db
    .select()
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.session_id, sessionID),
        eq(SessionMessageTable.type, "assistant"),
        options?.assistantMessageID === undefined ? undefined : eq(SessionMessageTable.id, options.assistantMessageID),
      ),
    )
    .all()
    .pipe(Effect.orDie)
  for (const row of rows) {
    const message = Schema.decodeUnknownSync(SessionMessage.Assistant)({ ...row.data, id: row.id, type: row.type })
    // Forked receipts remain evidence of the parent's work, with no child Goal admission or accounting.
    if (message.attempts !== undefined && (message.origin?.kind !== "step" || message.origin.sessionID !== sessionID))
      continue
    const unsettled = message.content.filter(
      (tool): tool is SessionMessage.AssistantTool =>
        tool.type === "tool" && (tool.state.status === "streaming" || tool.state.status === "running"),
    )
    for (const tool of unsettled) {
      const metadata = tool.state.status === "running" ? tool.state.metadata : undefined
      const childID =
        tool.name === "subagent" && typeof metadata?.sessionID === "string" ? metadata.sessionID : undefined
      yield* bus.publish(SessionEvent.Tool.Failed, {
        sessionID,
        assistantMessageID: message.id,
        id: tool.id,
        error: {
          type: "aborted",
          message: `Tool execution interrupted: ${tool.name}${childID ? ` (sessionID: ${childID})` : ""}`,
        },
        ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
        executed: tool.executed === true,
      })
    }
    if (message.attempts === undefined || message.attempts.length === 0) continue
    const attempts = yield* Effect.forEach(message.attempts, (attempt) =>
      Effect.gen(function* () {
        const terminal =
          attempt.terminal ??
          new SessionAttempt.Terminal({
            status: options?.status ?? "interrupted",
            ended: yield* Clock.currentTimeMillis,
            outputStarted: attempt.observations.some((observation) => observation.outputStarted),
            delivery:
              attempt.observations.findLast((observation) => observation.delivery !== undefined)?.delivery ?? "unknown",
          })
        if (attempt.terminal === undefined)
          yield* bus.publish(SessionEvent.Attempt.Ended, {
            sessionID,
            assistantMessageID: message.id,
            ordinal: attempt.ordinal,
            terminal,
          })
        yield* goals.settleAttempt({ refs: attempt.goalRefs, usage: terminal.usage }).pipe(Effect.orDie)
        return new SessionAttempt.Info({ ...attempt, terminal })
      }),
    )
    if (
      message.unknownPriceAttempts !== undefined ||
      message.missingUsageAttempts !== undefined ||
      message.completion !== undefined
    )
      continue
    const terminal = attempts.at(-1)?.terminal
    if (terminal === undefined) continue
    const usage = SessionUsage.aggregate(attempts)
    if (terminal.status === "completed" && unsettled.length === 0 && options?.error === undefined) {
      yield* bus.publish(SessionEvent.Step.Ended, {
        sessionID,
        assistantMessageID: message.id,
        finish: terminal.finish ?? "unknown",
        rawFinish: terminal.rawFinish,
        providerState: message.providerState,
        ...usage,
      })
      continue
    }
    yield* bus.publish(SessionEvent.Step.Failed, {
      sessionID,
      assistantMessageID: message.id,
      error: options?.error ?? {
        type: terminal.failure === undefined ? "aborted" : "provider.unknown",
        message:
          terminal.failure === undefined
            ? "Step interrupted before logical settlement"
            : `Model attempt failed: ${terminal.failure.reason}`,
      },
      finish: terminal.finish === "content-filter" ? "content-filter" : undefined,
      rawFinish: terminal.rawFinish,
      providerState: message.providerState,
      ...usage,
    })
  }
}, Effect.uninterruptible)

const isInterruptedStream = (failure: AIError) => {
  if (failure.reason._tag === "InvalidProviderOutput") return failure.reason.classification === "incomplete-stream"
  if (failure.reason._tag === "Transport") return failure.reason.operation === "read"
  return false
}

/** Tool.Error settles in each fiber; only user declines remain in the typed error channel. */
const classifyToolExits = (
  settled: Exit.Exit<Array<Exit.Exit<void, Permission.DeclinedError | QuestionTool.CancelledError>>>,
  runs: ReadonlyArray<{ readonly call: ToolCall }>,
) => {
  const exits = Exit.isSuccess(settled) ? settled.value : []
  const declines = exits.flatMap((exit, index) =>
    Exit.isFailure(exit)
      ? exit.cause.reasons.flatMap((reason) =>
          Cause.isFailReason(reason) ? [{ call: runs[index].call, reason: reason.error }] : [],
        )
      : [],
  )
  const causes = Exit.isFailure(settled)
    ? [settled.cause]
    : exits.flatMap((exit) => (Exit.isFailure(exit) ? [exit.cause] : []))
  const failure = causes
    .flatMap((cause) => {
      if (Cause.hasInterrupts(cause)) return []
      const reasons = cause.reasons.filter(Cause.isDieReason)
      return reasons.length > 0 ? [Cause.fromReasons<never>(reasons)] : []
    })
    .at(0)
  return { interrupted: causes.some(Cause.hasInterrupts), declines, failure }
}
