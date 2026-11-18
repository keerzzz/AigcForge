export * as SessionRunnerLLM from "./llm.js"

import { Message } from "@aigcfroge/ai"
import { and, desc, eq, sql } from "drizzle-orm"
import { Cause, Effect, Exit, FiberMap, Layer } from "effect"
import { Database } from "../../database/database.js"
import { Bus } from "../../bus.js"
import { LocationLifecycle } from "../../location-lifecycle.js"
import { InstructionState } from "../instruction-state.js"
import { SessionCompaction } from "../compaction.js"
import { SessionContext } from "../context.js"
import { SessionEvent } from "../event.js"
import { SessionGoal } from "../goal.js"
import { SessionTask } from "../task.js"
import { WorkArtifact } from "../artifact.js"
import { SessionInbox } from "../inbox.js"
import { SessionInputResult } from "../input-result.js"
import { SessionHistory } from "../history.js"
import { SessionProviderContext } from "../provider-context.js"
import { SessionModelRequest } from "../model-request.js"
import { SessionModelTransport } from "../model-transport.js"
import { SessionMessage } from "../message.js"
import { SessionSchema } from "../schema.js"
import { SessionStore } from "../store.js"
import { SessionMemoryAdmission } from "../memory-admission.js"
import { SessionMessageTable } from "../sql.js"
import { SessionTitle } from "../title.js"
import { toSessionError } from "../to-session-error.js"
import { DrainResult, Service, type Interface } from "./index.js"
import { Snapshot } from "../../snapshot.js"
import { FSUtil } from "@aigcfroge/util/fs-util"
import { makeLocationNode } from "@aigcfroge/util/effect/app-node"
import { llmClient } from "../../effect/app-node-platform.js"
import { StepFailedError } from "../error.js"
import { SessionRunnerRetry } from "./retry.js"
import { SessionStep } from "./step.js"
import { ToolOutput } from "../../tool-output.js"
import { Plugin } from "../../plugin.js"
import { ProductModePolicy } from "../../product-mode-policy.js"
import { MAX_STEPS_PROMPT } from "./max-steps.js"
import { CorrectionStore } from "../correction-store.js"
import { SessionRunnerModel } from "./model.js"
import type { SessionAttempt } from "@aigcfroge/schema/session-attempt"

const CONTINUE_AFTER_INCOMPLETE_STREAM =
  "The previous response was interrupted. Continue from where you left off without repeating completed content."

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const lifecycle = yield* LocationLifecycle.Service
    const store = yield* SessionStore.Service
    const context = yield* SessionContext.Service
    const memoryAdmission = yield* SessionMemoryAdmission.Service
    const corrections = yield* CorrectionStore.Service
    const modelTransport = yield* SessionModelTransport.Service
    const db = (yield* Database.Service).db
    const compaction = yield* SessionCompaction.Service
    const plugins = yield* Plugin.Service
    const title = yield* SessionTitle.Service
    const steps = yield* SessionStep.make
    const goals = yield* SessionGoal.Service
    // Title generation starts once input is visible and must not delay model execution.
    const titles = yield* FiberMap.make<SessionSchema.ID, void, never>()

    const drain = Effect.fn("SessionRunner.drain")(function* (input: Parameters<Interface["drain"]>[0]) {
      const sessionID = input.sessionID
      yield* ProductModePolicy.assertRuntimeSupported((yield* store.get(sessionID))?.mode)
      let force = input.force
      let anchorInputID = (yield* SessionInputResult.current(db, sessionID))?.anchorInputID
      let continuing = input.continuation !== undefined || (input.force && anchorInputID !== undefined)
      let step = input.continuation?.step ?? 1
      let entering = true
      let memoryTrigger: SessionMessage.ID | undefined
      const turn: { binding?: SessionRunnerModel.Binding } = {}
      const promotable = input.promotable ?? "input"
      if (!force && !continuing) {
        const pending = yield* SessionInbox.nextPromotable(db, sessionID, "input")
        if (!pending) return DrainResult.Complete()
        const control = pending.type === "compaction" || pending.type === "move"
        if (promotable === "steer" && pending.delivery === "queue" && !control) return DrainResult.Complete()
        if (anchorInputID !== undefined && pending.delivery === "steer" && !control) continuing = true
      }
      yield* plugins.awaitActivation
      yield* ProductModePolicy.assertRuntimeSupported((yield* store.get(sessionID))?.mode)
      yield* settleStaleCompactions(sessionID)
      yield* SessionStep.reconcile(db, bus, goals, sessionID)

      const advanceToStep = Effect.fn("SessionRunner.advanceToStep")(() =>
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            while (true) {
              if (lifecycle.isClosed()) {
                yield* restore(modelTransport.close(sessionID))
                return DrainResult.Reloaded({ force, continuation: continuing ? { step } : undefined })
              }
              // Location entry and idle boundaries allow queued controls, not necessarily queued prompts.
              const pending = yield* SessionInbox.serialized(
                sessionID,
                Effect.gen(function* () {
                  yield* ProductModePolicy.assertRuntimeSupported((yield* store.get(sessionID))?.mode)
                  const next = yield* SessionInbox.nextPromotable(
                    db,
                    sessionID,
                    entering || !continuing ? "input" : "steer",
                  )
                  if (next?.type === "compaction")
                    yield* bus.publishAll([
                      [SessionEvent.InboxDelivered, { sessionID, inboxID: next.id }],
                      [SessionEvent.Compaction.Started, { sessionID, reason: "manual", recent: "", inputID: next.id }],
                    ])
                  if (next?.type === "move")
                    yield* restore(
                      Effect.gen(function* () {
                        yield* modelTransport.close(sessionID)
                        yield* ProductModePolicy.assertRuntimeSupported((yield* store.get(sessionID))?.mode)
                        yield* bus.publishAll([
                          [SessionEvent.InboxDelivered, { sessionID, inboxID: next.id }],
                          [SessionEvent.Moved, { sessionID, ...next.payload }],
                        ])
                      }),
                    )
                  return next
                }),
              )
              if (!continuing && pending?.delivery !== "steer") {
                entering = true
                step = 1
                turn.binding = undefined
              }
              if (pending?.type === "move")
                return DrainResult.Moved({ continuation: continuing ? { step } : undefined })
              if (pending?.type === "synthetic" && !(yield* goals.beforeRoundDelivery({ sessionID, inputID: pending.id }).pipe(Effect.orDie))) {
                yield* SessionInbox.serialized(sessionID, bus.publish(SessionEvent.InboxCancelled, { sessionID, inboxID: pending.id }))
                continue
              }
              if (pending?.type === "compaction") {
                const compacted = yield* restore(
                  Effect.gen(function* () {
                    const selected = yield* context.select(sessionID)
                    const model = yield* context.resolveModel(selected.session)
                    // Preview updates without admitting them after the already-delivered compaction marker.
                    const history = yield* SessionHistory.preview(
                      db,
                      sessionID,
                      selected.instructions,
                      SessionProviderContext.provenance(model) ?? "local",
                    )
                    const appended = yield* syncCorrections(selected.session.id, history.messages)
                    const refreshed = appended
                      ? yield* SessionHistory.preview(
                          db,
                          sessionID,
                          selected.instructions,
                          SessionProviderContext.provenance(model) ?? "local",
                        )
                      : history
                    return yield* compaction.compact({
                      reason: "manual",
                      inputID: pending.id,
                      context: compactionContext({
                        session: selected.session,
                        agent: selected.agent,
                        tools: selected.tools,
                        model,
                        initial: refreshed.initial,
                        messages: refreshed.messages,
                      }),
                    })
                  }).pipe(
                    Effect.catch((error) =>
                      bus.publish(SessionEvent.Compaction.Failed, {
                        sessionID,
                        reason: "manual",
                        inputID: pending.id,
                        error: toSessionError(error),
                      }),
                    ),
                  ),
                ).pipe(Effect.exit)
                if (Exit.isFailure(compacted)) {
                  yield* bus.publish(SessionEvent.Compaction.Failed, {
                    sessionID,
                    reason: "manual",
                    error: Cause.hasInterruptsOnly(compacted.cause)
                      ? { type: "aborted", message: "Compaction cancelled" }
                      : { type: "compaction.failed", message: Cause.pretty(compacted.cause) },
                    inputID: pending.id,
                  })
                  return yield* Effect.failCause(compacted.cause)
                }
                force = false
                continue
              }
              if (!force && !continuing && (!pending || (pending.delivery === "queue" && promotable === "steer")))
                return DrainResult.Complete()
              const ready = yield* restore(
                Effect.gen(function* () {
                  const selected = yield* prepareContext(sessionID)
                  yield* ProductModePolicy.assertRuntimeSupported(selected.session.mode)
                  const promoted = yield* SessionInbox.promote(
                    db,
                    bus,
                    sessionID,
                    entering && !continuing ? promotable : "steer",
                    corrections.enabled
                      ? (source) =>
                          corrections.observe({
                            sessionID,
                            source: { id: source.id, entries: [] },
                          })
                      : undefined,
                    { anchorInputID: continuing ? anchorInputID : undefined },
                  )
                  // A control admitted during context preparation owns this boundary.
                  if (promoted === undefined) return undefined
                  anchorInputID = (yield* SessionInputResult.current(db, sessionID))?.anchorInputID
                  if (promoted > 0 && !selected.session.parentID && SessionTitle.isUntitled(selected.session))
                    yield* FiberMap.run(titles, sessionID, title.generate(sessionID), {
                      onlyIfMissing: true,
                    })
                  if (promoted > 0) {
                    step = 1
                    turn.binding = undefined
                  }
                  if (turn.binding?.behavior.affinity === "off") turn.binding = undefined
                  const loaded = yield* context.load(selected, turn.binding)
                  turn.binding = loaded.model.binding
                  const correctionAppended = yield* syncCorrections(sessionID, loaded.messages)
                  // Compaction may hide the user message from the model window while its durable ID remains valid.
                  memoryTrigger =
                    loaded.messages.findLast((message) => message.type === "user")?.id ??
                    memoryTrigger ??
                    (yield* store.messages({ sessionID, type: "user", order: "desc", limit: 1 }))[0]?.id
                  const memoryBudget = SessionMemoryAdmission.budget()
                  const appended = yield* memoryAdmission.append({
                    loaded,
                    trigger: memoryTrigger,
                    budget: memoryBudget,
                  })
                  return {
                    _tag: "Ready" as const,
                    context: appended || correctionAppended ? yield* reloadMemoryContext(loaded, selected) : loaded,
                    trigger: memoryTrigger,
                    memoryBudget,
                  }
                }),
              )
              if (ready) return ready
            }
          }),
        ),
      )

      while (true) {
        const next = yield* advanceToStep()
        if (next._tag !== "Ready") return next
        continuing = yield* runStep(next.context, step, next.trigger, next.memoryBudget, turn, anchorInputID)
        const advanced = !continuing ? yield* goals.advance({ sessionID }).pipe(Effect.orDie) : undefined
        if (!continuing) {
          anchorInputID = undefined
          turn.binding = undefined
        }
        step++
        force = false
        entering = advanced?.state === "admitted"
      }
    })

    const prepareContext = Effect.fn("SessionRunner.prepareContext")(function* (sessionID: SessionSchema.ID) {
      const selected = yield* context.select(sessionID)
      // A blocked initial instruction baseline must leave admitted input pending.
      yield* InstructionState.prepare(db, bus, selected.instructions, sessionID)
      return selected
    })

    const reloadMemoryContext = Effect.fnUntraced(function* (
      loaded: SessionContext.Loaded,
      selected: SessionContext.Selection,
    ) {
      // Data admission uses this resolved model's window; appending data does not select another model.
      const history = yield* SessionHistory.entriesForRunner(
        db,
        loaded.session.id,
        selected.instructions,
        SessionProviderContext.provenance(loaded.model) ?? "local",
      )
      return { ...loaded, initial: history.initial, messages: history.entries.map((entry) => entry.message) }
    })

    const syncCorrections = Effect.fn("SessionRunner.syncCorrections")(
      (sessionID: SessionSchema.ID, messages: ReadonlyArray<SessionMessage.Info>) =>
        corrections.syncSnapshot({
          sessionID,
          visibleIDs: messages.map((message) => message.id),
          publish: (snapshot) =>
            bus
              .publish(SessionEvent.Synthetic, {
                sessionID,
                text: snapshot.text,
                metadata: snapshot.metadata,
                description: "Current correction facts",
              })
              .pipe(Effect.map((event) => SessionMessage.ID.fromEvent(event.id))),
        }),
    )

    const compactionContext = (loaded: SessionContext.Loaded) => ({
      ...loaded,
      messages: loaded.messages.filter((message) => !CorrectionStore.isCorrectionHistory(message)),
    })

    /** Owns logical Step policy; each attempt owns its streaming, tools, and durable settlement. */
    const runStep = Effect.fn("SessionRunner.runStep")(function* (
      first: SessionContext.Loaded,
      step: number,
      trigger: SessionMessage.ID | undefined,
      memoryBudget: SessionMemoryAdmission.Budget,
      turn: { binding?: SessionRunnerModel.Binding },
      resultAnchorInputID?: SessionMessage.ID,
    ) {
      const sessionID = first.session.id
      let assistantMessageID = SessionMessage.ID.create()
      const retry = yield* SessionRunnerRetry.make(bus, sessionID)
      let initial: SessionContext.Loaded | undefined = first
      let recoverOverflow = true
      let recoverContinuation = true
      let boundary: SessionStep.Boundary = {}
      let transition: SessionAttempt.Started["transition"] = "initial"
      let reason: SessionAttempt.Failure | undefined
      return yield* Effect.gen(function* () {
        while (true) {
        // Reuse boundary preparation once; retries refresh context without delivering more input.
        const selected = initial === undefined ? yield* prepareContext(sessionID) : undefined
        const observed = selected ? yield* context.load(selected, turn.binding) : first
        turn.binding = observed.model.binding
        const correctionAppended = initial === undefined ? yield* syncCorrections(sessionID, observed.messages) : false
        const appended =
          initial === undefined
            ? yield* memoryAdmission.append({ loaded: observed, trigger, budget: memoryBudget })
            : false
        const loaded =
          (appended || correctionAppended) && selected ? yield* reloadMemoryContext(observed, selected) : observed
        initial = undefined
        const compacted = yield* compaction.compact({ reason: "auto", context: compactionContext(loaded) })
        if (compacted.status === "failed") return yield* new StepFailedError({ error: compacted.error })
        if (compacted.status === "completed") {
          assistantMessageID = SessionMessage.ID.create()
          boundary = {}
          continue
        }
        const stepLimitReached = loaded.agent.info.steps !== undefined && step >= loaded.agent.info.steps
        const transcript = SessionModelRequest.baseTranscript({
          agent: loaded.agent.info,
          model: loaded.model,
          tools: loaded.tools,
          initial: loaded.initial,
          messages: loaded.messages,
        })
        const prepared = yield* context.request.primary({
          session: loaded.session,
          agent: loaded.agent.id,
          request: loaded.agent.info.request,
          model: loaded.model,
          tools: loaded.tools,
          system: transcript.system,
          messages: stepLimitReached
            ? [...transcript.messages, Message.assistant(MAX_STEPS_PROMPT)]
            : transcript.messages,
          // Keep tool definitions on the final Step to preserve the provider's cached prefix.
          toolChoice: stepLimitReached ? "none" : undefined,
          webSocket: "session",
          inputTokens: SessionCompaction.estimatePrompt(loaded),
        })
        const outcome = yield* steps.attempt({
          isLocationClosed: lifecycle.isClosed,
          sessionID,
          assistantMessageID,
          resultAnchorInputID,
          completeStep: corrections.enabled ? corrections.completeStep(sessionID) : undefined,
          agent: loaded.agent.id,
          model: loaded.model,
          selection: loaded.model.selection ?? loaded.session.model ?? loaded.model.ref,
          behaviorDigest: loaded.model.binding?.behavior.behaviorDigest,
          boundary,
          transition,
          reason,
          prepared,
          retry: (cause, error, proposed, outputStarted) => Effect.gen(function* () {
            const current = yield* store.get(sessionID)
            if (current === undefined) return yield* Effect.die(new Error(`Session not found: ${sessionID}`))
            const next = loaded.model.binding !== undefined && SessionRunnerModel.fallbackEligible(cause, loaded.model.binding.behavior.strategy)
              ? yield* context.resolveModel({ ...current, agent: loaded.agent.id }, {
                  binding: loaded.model.binding, advance: { from: loaded.model, cause },
                }).pipe(Effect.catchTag("ModelGroup.Unavailable", (error) =>
                  error.reason === "no-candidates" &&
                  !(cause.reason._tag === "Authentication" || cause.reason._tag === "QuotaExceeded" ||
                    (cause.reason._tag === "InvalidRequest" && cause.reason.classification === "model-not-found"))
                    ? Effect.undefined : Effect.fail(error)))
              : undefined
            const binding = next === undefined ? loaded.model.binding : next.binding
            const decision = yield* retry.decide({
              cause,
              error,
              agent: loaded.agent.id,
              model: loaded.model.ref,
              hook: prepared.retry,
              retry: proposed || next !== undefined,
            })
            if (!decision.retry && binding !== undefined && decision.reason !== "declined")
              return yield* new StepFailedError({ error: { type: "model-group.retry-budget", message: `Model group "${binding.behavior.groupID}" exhausted the retry allowance` } })
            if (decision.retry) {
              turn.binding = binding
              transition = outputStarted ? "continuation" : next === undefined ? "retry" : "fallback"
              reason = SessionStep.failureDetails(cause)
            }
            return decision
          }),
          recoverContinuation,
          recoverOverflow: Effect.suspend(() =>
            recoverOverflow
              ? Effect.gen(function* () {
                  const selected = yield* context.select(sessionID).pipe(Effect.orDie)
                  const observed = yield* reloadMemoryContext(loaded, selected)
                  const appended = yield* syncCorrections(sessionID, observed.messages)
                  const refreshed = appended ? yield* reloadMemoryContext(observed, selected) : observed
                  const result = yield* compaction.compact({
                    reason: "overflow",
                    context: compactionContext(refreshed),
                  })
                  return result.status === "completed"
                })
              : Effect.succeed(false),
          ),
        })
        const completed = yield* SessionStep.Outcome.$match(outcome, {
          Reprepare: Effect.fnUntraced(function* () {
            turn.binding = (yield* context.resolveModel({ ...loaded.session, agent: loaded.agent.id }, {
              binding: loaded.model.binding, reprepare: true,
            })).binding
          }),
          Completed: (outcome) => Effect.succeed(outcome.needsContinuation),
          Retry: (outcome) =>
            retry.wait({
              decision: outcome.decision,
              error: outcome.error,
              assistantMessageID,
            }),
          Continue: Effect.fnUntraced(function* (outcome) {
            yield* retry.wait({
              decision: outcome.decision,
              error: outcome.error,
              assistantMessageID,
            })
            yield* bus.publish(SessionEvent.Synthetic, { sessionID, text: CONTINUE_AFTER_INCOMPLETE_STREAM })
            assistantMessageID = SessionMessage.ID.create()
            boundary = {}
            transition = "continuation"
          }),
          Compacted: Effect.fnUntraced(function* (outcome) {
            recoverOverflow = false
            assistantMessageID = SessionMessage.ID.create()
            boundary = {}
            transition = "continuation"
            reason = outcome.reason
          }),
          RecoverFull: Effect.fnUntraced(function* (outcome) {
            recoverContinuation = false
            transition = "retry"
            reason = outcome.reason
          }),
        })
          if (completed !== undefined) return completed
        }
      }).pipe(Effect.onExit((exit) => SessionStep.reconcile(db, bus, goals, sessionID, {
        assistantMessageID,
        status: Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause) ? lifecycle.isClosed() ? "interrupted" : "cancelled" : "failed",
        error: Exit.isFailure(exit) ? Cause.hasInterruptsOnly(exit.cause)
          ? { type: "aborted", message: "Step interrupted" }
          : toSessionError(Cause.squash(exit.cause)) : undefined,
      })))
    })

    const settleStaleCompactions = Effect.fn("SessionRunner.settleStaleCompactions")(function* (
      sessionID: SessionSchema.ID,
    ) {
      // A process death skips compaction finalizers. Include orphans behind a
      // completed checkpoint, and settle newest first to match event projection.
      const rows = yield* db
        .select()
        .from(SessionMessageTable)
        .where(
          and(
            eq(SessionMessageTable.session_id, sessionID),
            eq(SessionMessageTable.type, "compaction"),
            sql`json_extract(${SessionMessageTable.data}, '$.status') = 'running'`,
          ),
        )
        .orderBy(desc(SessionMessageTable.seq))
        .all()
        .pipe(Effect.orDie)
      for (const row of rows) {
        const message = yield* SessionHistory.decodeMessageRow(row)
        if (message.type !== "compaction") continue
        yield* bus.publish(SessionEvent.Compaction.Failed, {
          sessionID,
          reason: message.reason,
          inputID: message.id,
          error: { type: "compaction.interrupted", message: "Compaction was interrupted" },
        })
      }
    })

    return Service.of({ drain })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    Bus.node,
    LocationLifecycle.node,
    llmClient,
    SessionContext.node,
    SessionModelTransport.node,
    SessionStore.node,
    SessionMemoryAdmission.node,
    CorrectionStore.node,
    SessionCompaction.node,
    Plugin.node,
    SessionTitle.node,
    SessionGoal.node,
    SessionTask.node,
    WorkArtifact.node,
    Snapshot.node,
    ToolOutput.node,
    Database.node,
    FSUtil.node,
  ],
})
