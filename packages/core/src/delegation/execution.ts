import { Cause, Context, Effect, Exit, Layer, Scope } from "effect"
import { DelegationID, ParticipantID, TurnID } from "@aigcfroge/schema/delegation-id"
import { Delegation } from "@aigcfroge/schema/delegation"
import { SessionMessageID } from "@aigcfroge/schema/session-message-id"
import { SessionRunCoordinator } from "../session/run-coordinator"
import { DelegationService } from "./service"
import { SessionV2 } from "../session"
import { BackgroundJob } from "../background-job"
import { TaskDriver } from "../tool/task-driver"
import { SessionSchema } from "../session/schema"
import { AgentV2 } from "../agent"
import { getCliAdapter } from "../tool/cli-adapter"

export interface Interface {
  /** Starts execution while idle or joins the active execution. */
  readonly resume: (delegationID: DelegationID.ID) => Effect.Effect<void, unknown>
  /** Registers newly recorded work. Repeated wakeups may coalesce. */
  readonly wake: (delegationID: DelegationID.ID) => Effect.Effect<void>
  /** Interrupt active work owned by this process. Idle interruption is a no-op. */
  readonly interrupt: (delegationID: DelegationID.ID, participantID?: ParticipantID) => Effect.Effect<void, unknown>
  /** Reports whether this process owns in-flight or scheduled work for the delegation. */
  readonly isActive: (delegationID: DelegationID.ID) => Effect.Effect<boolean, unknown>
  /** Explicitly drains pending deliveries for the delegation. */
  readonly drain: (delegationID: DelegationID.ID) => Effect.Effect<void, unknown>
  /** Durable admission fence followed by process-local participant teardown. */
  readonly close: (input: {
    readonly delegationID: DelegationID.ID
    readonly reason?: string
  }) => Effect.Effect<void, unknown>
  /**
   * Executes one already-admitted Turn through the canonical TaskDriver seam.
   * TaskTool uses this command instead of choosing its own foreground/background
   * execution path; `drain` remains the recovery/cold-resume path.
   */
  readonly dispatch: (
    input: TaskDriver.DelegationDispatchInput,
  ) => Effect.Effect<TaskDriver.DelegationDispatchResult, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/DelegationExecution") {}

function participantJobID(
  delegationID: DelegationID.ID,
  participant: Pick<Delegation.ParticipantInfo, "id" | "childSessionID">,
) {
  return participant.childSessionID ?? `cli_${delegationID}_${participant.id}`
}

function makeWakeAfterJob(
  background: BackgroundJob.Interface,
  wake: (delegationID: DelegationID.ID) => Effect.Effect<void>,
  scope: Scope.Scope,
) {
  const watched = new Set<string>()

  return (id: string, delegationID: DelegationID.ID) =>
    Effect.suspend(() => {
      const key = `${delegationID}:${id}`
      if (watched.has(key)) return Effect.void
      watched.add(key)
      return background.wait({ id }).pipe(
        // Wake even when the process-local record disappeared. The next drain
        // must reconcile the durable delivery instead of leaving it pending.
        Effect.andThen(wake(delegationID)),
        Effect.ensuring(Effect.sync(() => watched.delete(key))),
        Effect.forkIn(scope),
        Effect.asVoid,
      )
    })
}

function startChildRunnerJob(input: {
  delegationID: DelegationID.ID
  turn: Delegation.TurnInfo
  delivery: {
    readonly turnID: TurnID
    readonly participantID: ParticipantID
    readonly deliveryOrigin: string
    readonly senderParticipantID: ParticipantID
    readonly attempt: number
  }
  participant: Delegation.ParticipantInfo
  childSessionID: SessionSchema.ID
  sessions: SessionV2.Interface
  background: BackgroundJob.Interface
  service: DelegationService.Interface
  wake: (delegationID: DelegationID.ID) => Effect.Effect<void>
}) {
  return input.background.start({
    id: input.childSessionID,
    type: "delegation",
    title: input.turn.promptSummary,
    run: Effect.gen(function* () {
      const existingAssistantIDs = new Set(
        (yield* input.sessions.messages({ sessionID: input.childSessionID, order: "asc" }))
          .filter((message) => message.type === "assistant")
          .map((message) => message.id),
      )
      const exit = yield* Effect.gen(function* () {
        yield* input.sessions.resume(input.childSessionID)
        const last = (yield* input.sessions.messages({ sessionID: input.childSessionID, order: "asc" })).findLast(
          (message) => message.type === "assistant" && !existingAssistantIDs.has(message.id),
        )
        if (!last || last.type !== "assistant") {
          return yield* Effect.fail(new Error("Child Session completed without a new assistant response"))
        }
        const summary = last.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("")
          .trim()
        if (!summary) {
          return yield* Effect.fail(new Error("Child Session completed without assistant text"))
        }
        return summary
      }).pipe(Effect.exit)
      if (Exit.isSuccess(exit)) {
        yield* input.service.recordDelivery({
          delegationID: input.delegationID,
          turnID: input.turn.id,
          participantID: input.participant.id,
          deliveryOrigin: input.delivery.deliveryOrigin,
          senderParticipantID: input.delivery.senderParticipantID,
          attempt: input.delivery.attempt,
          status: "completed",
          summary: exit.value,
        })
        yield* input.wake(input.delegationID)
        return exit.value
      }
      const interrupted = Cause.hasInterruptsOnly(exit.cause)
      yield* input.service.recordDelivery({
        delegationID: input.delegationID,
        turnID: input.turn.id,
        participantID: input.participant.id,
        deliveryOrigin: input.delivery.deliveryOrigin,
        senderParticipantID: input.delivery.senderParticipantID,
        attempt: input.delivery.attempt,
        status: interrupted ? "cancelled" : "failed",
        summary: interrupted ? "Interrupted" : "Child Session execution failed",
        errorCode: interrupted ? undefined : "child_session_execution_failed",
      })
      yield* input.wake(input.delegationID)
      return interrupted ? "cancelled" : "failed"
    }),
  })
}

function makeDrain(
  service: DelegationService.Interface,
  background: BackgroundJob.Interface,
  sessions: SessionV2.Interface,
  wake: (delegationID: DelegationID.ID) => Effect.Effect<void>,
  scope: Scope.Scope,
) {
  const wakeAfterJob = makeWakeAfterJob(background, wake, scope)

  return Effect.fn("DelegationExecution.drain")(
    (delegationID: DelegationID.ID): Effect.Effect<void, unknown> =>
      Effect.gen(function* () {
        const state = yield* service.foldState(delegationID)
        if (!state) return
        if (["closing", "completed", "cancelled", "archived"].includes(state.delegation.status)) return

        const turns = [...state.turns.values()].sort((a, b) => a.seq - b.seq)
        for (const turn of turns) {
          if (["completed", "cancelled", "recovery_required"].includes(turn.status)) continue

          for (const participantID of turn.participantIDs) {
            const participant = state.participants.get(participantID)
            if (!participant || participant.phase === "closed" || participant.phase === "failed") continue

            const delivery = [...state.deliveries.values()].find(
              (d) => d.turnID === turn.id && d.participantID === participantID,
            )
            if (!delivery) continue
            if (["completed", "failed", "cancelled", "recovery_required"].includes(delivery.status)) continue

            const isCli = getCliAdapter(participant.target) !== undefined

            if (isCli) {
              const jobID = participantJobID(delegationID, participant)
              const isRunning = (yield* background.get(jobID))?.status === "running"
              if (isRunning) {
                if (turn.delivery === "steer" && participant.externalThreadID && delivery.externalTurnID) {
                  const adapter = getCliAdapter(participant.target) ?? getCliAdapter(participant.provider)
                  if (adapter?.steerTurn) {
                    yield* adapter
                      .steerTurn({
                        threadId: participant.externalThreadID,
                        expectedTurnId: delivery.externalTurnID,
                        input: [{ type: "text", text: turn.promptSummary ?? "" }],
                      })
                      .pipe(Effect.ignore)
                  }
                }
                yield* wakeAfterJob(jobID, delegationID)
                continue
              }
              if (delivery.status === "running") {
                yield* service.recordDelivery({
                  delegationID,
                  turnID: turn.id,
                  participantID,
                  deliveryOrigin: delivery.deliveryOrigin,
                  senderParticipantID: delivery.senderParticipantID,
                  attempt: delivery.attempt,
                  status: "recovery_required",
                  summary: "External execution ownership was lost before settlement",
                  errorCode: "external_activation_lost",
                })
                continue
              }

              const executeCLIWork = TaskDriver.executeCLI({
                cliTarget: participant.target,
                prompt: turn.promptSummary ?? "Review changes",
                description: turn.promptSummary ?? "External review",
                sessionID: state.delegation.parentSessionID,
                taskID: participant.childSessionID,
                delivery: {
                  delegationID,
                  participantID,
                  turnID: turn.id,
                  deliveryOrigin: delivery.deliveryOrigin,
                  senderParticipantID: delivery.senderParticipantID,
                  delivery: turn.delivery,
                  attempt: delivery.attempt,
                },
              }).pipe(
                Effect.map((res) => res.status),
                Effect.catch((err: unknown) =>
                  Effect.gen(function* () {
                    const latest = yield* service.foldState(delegationID)
                    const latestDelivery = [...(latest?.deliveries.values() ?? [])].find(
                      (candidate) => candidate.turnID === turn.id && candidate.participantID === participantID,
                    )
                    if (
                      latestDelivery &&
                      !["completed", "failed", "cancelled", "recovery_required"].includes(latestDelivery.status)
                    ) {
                      yield* service.recordDelivery({
                        delegationID,
                        turnID: turn.id,
                        participantID,
                        deliveryOrigin: delivery.deliveryOrigin,
                        senderParticipantID: delivery.senderParticipantID,
                        attempt: delivery.attempt,
                        status: "failed",
                        summary: err instanceof Error ? err.message : "External CLI execution failed",
                        errorCode: "cli_execution_failed",
                      })
                    }
                    return "failed" as const
                  }),
                ),
                Effect.onExit((exit) =>
                  Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause) ? Effect.void : wake(delegationID),
                ),
              )

              yield* background.start({
                id: jobID,
                type: "delegation",
                title: turn.promptSummary,
                run: executeCLIWork,
              })
              continue
            }

            // Internal participant (Build, etc.)
            let childSessionID = participant.childSessionID
            if (!childSessionID) {
              const child = yield* TaskDriver.createChild({
                parentID: state.delegation.parentSessionID,
                agent: AgentV2.ID.make(participant.target),
              })
              yield* service.bindParticipant({
                delegationID,
                participantID,
                childSessionID: child.id,
              })
              childSessionID = child.id
            }

            const isRunning = yield* TaskDriver.isRunning(childSessionID)
            const messageID = SessionMessageID.ID.make(`msg_del_${turn.id}_${participantID}_${delivery.attempt}`)

            // Queue delivery: only promote when child session is idle
            if (delivery.status === "queued") {
              if (isRunning) {
                yield* wakeAfterJob(childSessionID, delegationID)
                continue
              }
              yield* service.recordDelivery({
                delegationID,
                turnID: turn.id,
                participantID,
                deliveryOrigin: delivery.deliveryOrigin,
                senderParticipantID: delivery.senderParticipantID,
                attempt: delivery.attempt,
                status: "started",
              })
              yield* sessions.prompt({
                id: messageID,
                sessionID: childSessionID,
                prompt: { text: turn.promptSummary ?? "" },
                delivery: "queue",
                delegationOrigin: {
                  turnID: turn.id,
                  deliveryOrigin: delivery.deliveryOrigin,
                  senderParticipantID: delivery.senderParticipantID,
                },
                resume: false,
              })
              yield* startChildRunnerJob({
                delegationID,
                turn,
                delivery,
                participant,
                childSessionID,
                sessions,
                background,
                service,
                wake,
              })
              continue
            }

            // Running delivery: prior active tool finished; prompt was already admitted in active steer
            if (delivery.status === "running") {
              if (isRunning) {
                yield* wakeAfterJob(childSessionID, delegationID)
                continue
              }
              yield* startChildRunnerJob({
                delegationID,
                turn,
                delivery,
                participant,
                childSessionID,
                sessions,
                background,
                service,
                wake,
              })
              continue
            }

            // Steer or admitted delivery
            if (delivery.status === "admitted") {
              if (isRunning) {
                // Active tool execution: steer promotes at safe provider boundary without killing running work
                yield* sessions.prompt({
                  id: messageID,
                  sessionID: childSessionID,
                  prompt: { text: turn.promptSummary ?? "" },
                  delivery: "steer",
                  delegationOrigin: {
                    turnID: turn.id,
                    deliveryOrigin: delivery.deliveryOrigin,
                    senderParticipantID: delivery.senderParticipantID,
                  },
                  resume: false,
                })
                yield* service.recordDelivery({
                  delegationID,
                  turnID: turn.id,
                  participantID,
                  deliveryOrigin: delivery.deliveryOrigin,
                  senderParticipantID: delivery.senderParticipantID,
                  attempt: delivery.attempt,
                  status: "started",
                })
                yield* wakeAfterJob(childSessionID, delegationID)
                continue
              }

              // Cold resume: child session is idle, reconstruct activation
              yield* service.recordDelivery({
                delegationID,
                turnID: turn.id,
                participantID,
                deliveryOrigin: delivery.deliveryOrigin,
                senderParticipantID: delivery.senderParticipantID,
                attempt: delivery.attempt,
                status: "started",
              })
              yield* sessions.prompt({
                id: messageID,
                sessionID: childSessionID,
                prompt: { text: turn.promptSummary ?? "" },
                delivery: turn.delivery,
                delegationOrigin: {
                  turnID: turn.id,
                  deliveryOrigin: delivery.deliveryOrigin,
                  senderParticipantID: delivery.senderParticipantID,
                },
                resume: false,
              })
              yield* startChildRunnerJob({
                delegationID,
                turn,
                delivery,
                participant,
                childSessionID,
                sessions,
                background,
                service,
                wake,
              })
            }
          }
        }
      }).pipe(
        // Fail-closed: only catch interrupts if interrupted, never swallow domain or storage errors as success!
        Effect.catchCause((cause: Cause.Cause<unknown>) =>
          Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.failCause(cause),
        ),
      ),
  )
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const service = yield* DelegationService.Service
    const sessions = yield* SessionV2.Service
    const background = yield* BackgroundJob.Service
    const scope = yield* Scope.Scope

    let coordinatorRef: SessionRunCoordinator.Coordinator<DelegationID.ID, unknown>

    const wakeCoordinator = (delegationID: DelegationID.ID) => Effect.suspend(() => coordinatorRef.wake(delegationID))

    const drain = makeDrain(service, background, sessions, wakeCoordinator, scope)

    const coordinator = yield* SessionRunCoordinator.make<DelegationID.ID, unknown>({
      drain: (delegationID: DelegationID.ID, _force: boolean) => drain(delegationID),
    })
    coordinatorRef = coordinator

    const cancelPendingDeliveries = (delegationID: DelegationID.ID, participantID?: ParticipantID) =>
      Effect.gen(function* () {
        // Re-read after stopping the coordinator. A runner may have settled while
        // the caller was waiting for the coordinator fiber to stop; never append a
        // cancellation event against that newer terminal attempt.
        const latest = yield* service.foldState(delegationID)
        if (!latest) return
        for (const delivery of latest.deliveries.values()) {
          if (
            (participantID === undefined || delivery.participantID === participantID) &&
            ["admitted", "running"].includes(delivery.status)
          ) {
            yield* service.recordDelivery({
              delegationID,
              turnID: delivery.turnID,
              participantID: delivery.participantID,
              deliveryOrigin: delivery.deliveryOrigin,
              senderParticipantID: delivery.senderParticipantID,
              attempt: delivery.attempt,
              status: "cancelled",
              summary: "Interrupted",
            })
          }
        }
      })

    const settleDispatch = (input: TaskDriver.DelegationDispatchInput, outcome: TaskDriver.SettleOutcome) =>
      (input.onSettle ? input.onSettle(outcome) : Effect.void).pipe(
        Effect.ensuring(coordinator.wake(input.delegationID)),
      )

    const settleExternalDelivery = (
      input: TaskDriver.DelegationDispatchInput,
      status: "completed" | "failed" | "cancelled" | "recovery_required",
      options: {
        readonly externalTurnID?: string
        readonly summary?: string
        readonly errorCode?: string
        readonly review?: import("../tool/cli-adapter").DelegationReview
      } = {},
    ) =>
      Effect.gen(function* () {
        const state = yield* service.foldState(input.delegationID)
        const current = [...(state?.deliveries.values() ?? [])].find(
          (delivery) =>
            delivery.turnID === input.delivery.turnID &&
            delivery.participantID === input.delivery.participantID &&
            delivery.deliveryOrigin === input.delivery.deliveryOrigin &&
            delivery.senderParticipantID === input.delivery.senderParticipantID,
        )
        if (
          current !== undefined &&
          ["completed", "failed", "cancelled", "recovery_required"].includes(current.status)
        ) {
          return false
        }
        yield* service.recordDelivery({
          ...input.delivery,
          status,
          externalTurnID: options.externalTurnID,
          summary: options.summary,
          errorCode: options.errorCode,
        })
        if (status === "completed" && options.review?.status === "valid") {
          yield* service.recordReview({
            delegationID: input.delegationID,
            turnID: input.turnID,
            participantID: input.participantID,
            reviewedRevisionDigest: options.review.envelope.reviewed_revision_digest,
            verdict: options.review.envelope.verdict,
            findings: options.review.envelope.findings,
            summary: options.review.envelope.summary,
          })
        }
        return true
      })

    const externalOutcome = (
      input: TaskDriver.DelegationDispatchInput,
      exit: Exit.Exit<
        {
          readonly text: string
          readonly sessionID: SessionSchema.ID
          readonly status: "success" | "partial" | "failed"
          readonly externalSessionID?: string
          readonly externalTurnID?: string
          readonly review?: import("../tool/cli-adapter").DelegationReview
        },
        unknown
      >,
    ) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          if (Exit.isSuccess(exit)) {
            const recoveryRequired = exit.value.review?.status === "invalid"
            const deliveryStatus =
              exit.value.status === "failed" ? "failed" : recoveryRequired ? "recovery_required" : "completed"
            const settled = yield* settleExternalDelivery(input, deliveryStatus, {
              externalTurnID: exit.value.externalTurnID,
              summary: exit.value.text,
              errorCode: recoveryRequired ? "malformed_review_envelope" : undefined,
              review: exit.value.review,
            })
            yield* settleDispatch(input, {
              status: deliveryStatus === "completed" ? "completed" : "failed",
              outputDigest: exit.value.status === "failed" ? exit.value.text : exit.value.sessionID,
            })
            return settled
          }

          const interrupted = Cause.hasInterruptsOnly(exit.cause)
          const deliveryStatus = interrupted ? "cancelled" : "recovery_required"
          const settled = yield* settleExternalDelivery(input, deliveryStatus, {
            summary: interrupted ? "External delegation interrupted" : "External delegation failed",
            errorCode: interrupted ? undefined : "external_delegation_failed",
          })
          yield* settleDispatch(input, {
            status: interrupted ? "cancelled" : "failed",
            outputDigest: interrupted ? undefined : "external delegation failed",
          })
          return settled
        }),
      )

    const dispatch = Effect.fn("DelegationExecution.dispatch")(function* (input: TaskDriver.DelegationDispatchInput) {
      if (input.execution === "external") {
        if (!input.cliTarget) return yield* Effect.fail(new Error("External delegation requires cliTarget"))
        const execute = TaskDriver.executeCLI({
          cliTarget: input.cliTarget,
          prompt: input.prompt,
          description: input.description,
          sessionID: input.parentID,
          taskID: input.sessionID,
          delivery: input.delivery,
          permissionSource: input.permissionSource,
        })
        if (input.background) {
          const jobID = `cli_${input.delegationID}_${input.participantID}`
          yield* background.start({
            id: jobID,
            type: "delegation",
            title: input.description,
            run: execute.pipe(
              Effect.onExit((exit) => externalOutcome(input, exit)),
              Effect.map((result) => result.text),
            ),
          })
          return {
            sessionID: input.sessionID ?? input.parentID,
            status: "running",
          } satisfies TaskDriver.DelegationDispatchResult
        }
        const result = yield* execute.pipe(
          Effect.map((res) => ({ ...res, executorFailed: false })),
          Effect.onExit((exit) => externalOutcome(input, exit)),
          Effect.catch((err: unknown) =>
            Effect.succeed({
              sessionID: input.sessionID ?? input.parentID,
              status: "failed" as const,
              text: err instanceof Error ? err.message : "External CLI failed",
              externalSessionID: undefined,
              externalTurnID: undefined,
              review: undefined,
              executorFailed: true,
            }),
          ),
        )
        return {
          sessionID: result.sessionID,
          status: result.status === "failed" ? "failed" : "completed",
          text: result.text,
          providerStatus: result.status,
          externalSessionID: result.externalSessionID,
          externalTurnID: result.externalTurnID,
          review: result.review,
          executorFailed: result.executorFailed,
        } satisfies TaskDriver.DelegationDispatchResult
      }

      if (!input.sessionID) return yield* Effect.fail(new Error("Internal delegation requires a child Session"))
      const taskInput = {
        parentID: input.parentID,
        sessionID: input.sessionID,
        prompt: input.prompt,
        description: input.description,
        taskID: input.taskID,
        stepID: input.stepID,
        delivery: input.delivery,
        onSettle: (outcome: TaskDriver.SettleOutcome) => settleDispatch(input, outcome),
      }
      if (input.background) {
        if (input.queue && (yield* TaskDriver.extendBackground(taskInput))) {
          return { sessionID: input.sessionID, status: "running" } satisfies TaskDriver.DelegationDispatchResult
        }
        yield* TaskDriver.delegateBackground(taskInput)
        return { sessionID: input.sessionID, status: "running" } satisfies TaskDriver.DelegationDispatchResult
      }
      const text = yield* TaskDriver.delegate({
        sessionID: input.sessionID,
        parentID: input.parentID,
        prompt: input.prompt,
        taskID: input.taskID,
        stepID: input.stepID,
        delivery: input.delivery,
        onSettle: taskInput.onSettle,
      })
      return { sessionID: input.sessionID, status: "completed", text } satisfies TaskDriver.DelegationDispatchResult
    })

    return Service.of({
      resume: coordinator.run,
      wake: coordinator.wake,
      interrupt: (delegationID, participantID): Effect.Effect<void, unknown> =>
        Effect.gen(function* () {
          // Fail-closed: foldState errors bubble up rather than pretending state is undefined.
          const state = yield* service.foldState(delegationID)
          if (!state) return

          // Stop the serialized drain before recording cancellation. Otherwise a
          // job-completion wake can start a fresh child runner between resource
          // cancellation and the durable delivery_cancelled event.
          // Fork in scope so interrupt returns immediately without blocking on fiber quiescence.
          yield* coordinator.interrupt(delegationID).pipe(Effect.forkIn(scope))
          yield* cancelPendingDeliveries(delegationID, participantID)

          const interruptParticipant = (participant: Delegation.ParticipantInfo) =>
            Effect.gen(function* () {
              if (participant.childSessionID) yield* TaskDriver.cancel(participant.childSessionID)
              else yield* background.cancel(participantJobID(delegationID, participant))
              if (participant.externalThreadID) {
                const adapter = getCliAdapter(participant.target) ?? getCliAdapter(participant.provider)
                const activeDelivery = [...state.deliveries.values()].find(
                  (d) => d.participantID === participant.id && d.status === "running" && d.externalTurnID,
                )
                if (activeDelivery?.externalTurnID && adapter?.interruptTurn) {
                  yield* adapter
                    .interruptTurn({
                      threadId: participant.externalThreadID,
                      turnId: activeDelivery.externalTurnID,
                    })
                    .pipe(
                      Effect.catch((error) =>
                        Effect.logWarning("Delegation app-server interrupt failed", {
                          delegationID,
                          participantID: participant.id,
                          error: String(error),
                        }),
                      ),
                    )
                } else if (adapter?.cancel) {
                  yield* adapter.cancel(process.cwd(), participant.externalThreadID)
                }
              }
            })

          const participants = participantID
            ? [state.participants.get(participantID)].filter((participant) => participant !== undefined)
            : [...state.participants.values()]
          yield* Effect.forEach(participants, interruptParticipant, { discard: true }).pipe(Effect.forkIn(scope))
        }),
      isActive: (delegationID): Effect.Effect<boolean, unknown> =>
        Effect.gen(function* () {
          const coordActive = yield* coordinator.isActive(delegationID)
          if (coordActive) return true
          const state = yield* service.foldState(delegationID)
          if (!state) return false
          for (const participant of state.participants.values()) {
            if ((yield* background.get(participantJobID(delegationID, participant)))?.status === "running") return true
            if (participant.childSessionID && (yield* TaskDriver.isRunning(participant.childSessionID))) return true
          }
          return false
        }),
      close: (input) =>
        Effect.gen(function* () {
          // Service.close commits the durable admission fence before any local
          // cancellation begins, so appendTurn cannot race through teardown.
          yield* service.close(input)
          yield* coordinator.interrupt(input.delegationID).pipe(Effect.forkIn(scope))
          const state = yield* service.foldState(input.delegationID)
          if (!state) return
          const interruptParticipant = (participant: Delegation.ParticipantInfo) =>
            Effect.gen(function* () {
              if (participant.childSessionID) yield* TaskDriver.cancel(participant.childSessionID)
              else yield* background.cancel(participantJobID(input.delegationID, participant))
              if (!participant.externalThreadID) return
              const adapter = getCliAdapter(participant.target) ?? getCliAdapter(participant.provider)
              if (adapter?.cancel) yield* adapter.cancel(process.cwd(), participant.externalThreadID)
            })
          yield* Effect.forEach([...state.participants.values()], interruptParticipant, { discard: true }).pipe(
            Effect.forkIn(scope),
          )
        }),
      dispatch,
      drain,
    })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(Layer.provide(DelegationService.defaultLayer), Layer.provide(BackgroundJob.defaultLayer)),
)

export const noopLayer = Layer.succeed(
  Service,
  Service.of({
    resume: () => Effect.void,
    wake: () => Effect.void,
    interrupt: () => Effect.void,
    isActive: () => Effect.succeed(false),
    close: () => Effect.void,
    dispatch: () => Effect.die("DelegationExecution noop layer cannot dispatch"),
    drain: () => Effect.void,
  }),
)

export * as DelegationExecution from "./execution"
