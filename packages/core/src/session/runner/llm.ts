import {
  LLM,
  LLMClient,
  LLMError,
  LLMEvent,
  Message,
  SystemPart,
  isContextOverflowFailure,
  type ProviderErrorEvent,
} from "@aigcfroge/llm"
import { Cause, DateTime, Duration, Effect, Exit, FiberSet, Layer, Option, Semaphore, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { AgentV2 } from "../../agent"
import { ProductModeAgentPolicy } from "../../product-mode-agent-policy"
import { AppProcess } from "../../process"
import { Config } from "../../config"
import { Database } from "../../database/database"
import { EventV2 } from "../../event"
import { Location } from "../../location"
import { ModelV2 } from "../../model"
import { ProviderV2 } from "../../provider"
import { QuestionV2 } from "../../question"
import { PermissionV2 } from "../../permission"
import { Shell } from "../../shell"
import { SystemContext } from "../../system-context/index"
import { SystemContextRegistry } from "../../system-context/registry"
import { SkillGuidance } from "../../skill/guidance"
import { SkillV2 } from "../../skill"
import { ReferenceGuidance } from "../../reference/guidance"
import { ToolRegistry } from "../../tool/registry"
import { CacheShape } from "../../cache/cache-shape"
import { ToolOutputStore } from "../../tool-output-store"
import { classify, type IntentCategory } from "../../agent/meta/intent"
import { SessionContextEpoch } from "../context-epoch"
import { SessionCompaction } from "../compaction"
import { DoomLoop } from "../doom-loop"
import { SessionEvent } from "../event"
import { SessionHistory } from "../history"
import { SessionMessage } from "../message"
import { Prompt } from "../prompt"
import { SessionInput } from "../input"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { type RunError, Service } from "./index"
import { SessionRunnerModel } from "./model"
import { createLLMEventPublisher } from "./publish-llm-event"
import { toLLMMessages } from "./to-llm-message"
import { MAX_STEPS_PROMPT } from "./max-steps"

/**
 * Runs one durable coding-agent Session until it settles.
 *
 * Keep this as orchestration over smaller collaborators rather than rebuilding the legacy
 * `SessionPrompt` monolith. Implement the unchecked items in small reviewed slices:
 *
 * - Session ownership and controls
 *   - [x] Coordinate one local active drain per Session; explicit resumes join and prompt wakeups coalesce.
 *   - [ ] Replace local ownership with durable multi-node ownership when clustered.
 *   - [ ] Mark busy, retrying, idle, interrupted, or terminal-failure status durably.
 *   - [ ] Honor interruption and reject stale work after runtime attachment replacement.
 *   - [x] Honor optional agent step limits.
 *   - [ ] Bound provider retries and repeated identical tool calls.
 *
 * - Runtime context assembly
 *   - Track V1 runtime-context parity canonically in `specs/v2/session.md`.
 *
 * - One provider turn
 *   - [x] Translate every projected V2 Session message variant into canonical
 *     `@aigcfroge/llm` messages.
 *   - [ ] Resolve policy-filtered built-in, MCP, plugin, and structured-output tool definitions.
 *   - [x] Stream exactly one `llm.stream(request)` provider turn.
 *   - [x] Persist assistant text and usage events incrementally as they arrive.
 *   - [ ] Persist snapshots, patches, and retry notices incrementally as they arrive.
 *   - [x] Persist reasoning, provider errors, and tool-call events incrementally as they arrive.
 *
 * - Tool settlement and continuation
 *   - [x] Durably record each tool call before side effects begin.
 *   - [x] Authorize and execute recorded local calls through a core-owned registry hook.
 *   - [x] Persist typed success, failure, and provider-executed tool outcomes.
 *   - [x] Start each recorded local call eagerly and await all settlements before continuation.
 *   - [ ] Add scoped runtime context, progress updates, attachment normalization,
 *     plugins, and cancellation settlement.
 *   - [x] Reload projected history and start the next explicit provider turn after local tool results.
 *   - [x] Continue for durable user steering accepted during an active provider turn.
 *   - [ ] Continue for compaction or another continuation condition when required.
 *
 * - Post-run maintenance
 *   - [ ] Settle final status and expose durable output events to replayable consumers.
 *   - [ ] Coalesce streamed deltas and add covering projected-history indexes.
 *   - [ ] Update title, summaries, compaction state, and cleanup in bounded background work.
 *
 * Use `llm.stream(request)` for each provider turn. Keep tool execution and continuation here.
 * Durable continuation recovery remains a separate future slice with an explicit retry policy.
 *
 * The current slice loads V2 history, translates it, resolves a model through a core service, and persists one
 * provider turn. Registry definitions are advertised, local tool calls are settled durably, and an
 * explicit loop starts the next provider turn after local settlement. Configured agent step limits bound the loop.
 */

/** Per-session cache diagnostics state, owned by `run` and threaded through the call chain. */
type CacheState = {
  lastPrefixShape: CacheShape.PrefixShape | undefined
  sessionCacheRead: number
  sessionNonCached: number
  rewriteVersion: number
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const llm = yield* LLMClient.Service
    const agents = yield* AgentV2.Service
    const tools = yield* ToolRegistry.Service
    const models = yield* SessionRunnerModel.Service
    const store = yield* SessionStore.Service
    const location = yield* Location.Service
    const systemContext = yield* SystemContextRegistry.Service
    const skillGuidance = yield* SkillGuidance.Service
    const referenceGuidance = yield* ReferenceGuidance.Service
    const skills = yield* SkillV2.Service
    const config = yield* Config.Service
    const appProcess = yield* AppProcess.Service
    const db = (yield* Database.Service).db
    const doomLoop = yield* DoomLoop.Service
    const compaction = SessionCompaction.make({ events, llm, config: yield* config.entries() })

    const getSession = Effect.fn("SessionRunner.getSession")(function* (sessionID: SessionSchema.ID) {
      const session = yield* store.get(sessionID)
      if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
      return session
    })

    const getContext = Effect.fn("SessionRunner.getContext")(function* (sessionID: SessionSchema.ID) {
      return yield* store.context(sessionID)
    })
    const failInterruptedTools = Effect.fn("SessionRunner.failInterruptedTools")(function* (
      sessionID: SessionSchema.ID,
    ) {      for (const message of yield* getContext(sessionID)) {
        if (message.type !== "assistant") continue
        for (const tool of message.content) {
          if (tool.type !== "tool" || (tool.state.status !== "pending" && tool.state.status !== "running")) continue
          yield* events.publish(SessionEvent.Tool.Failed, {
            sessionID,
            timestamp: yield* DateTime.now,
            assistantMessageID: message.id,
            callID: tool.id,
            error: { type: "unknown", message: "Tool execution interrupted" },
            provider: {
              executed: tool.provider?.executed === true,
              ...(tool.provider?.metadata === undefined ? {} : { metadata: tool.provider.metadata }),
            },
          })
        }
      }
    })

    const settleTool = (input: {
      readonly sessionID: SessionSchema.ID
      readonly agent: AgentV2.ID
      readonly toolName: string
      readonly toolInput: unknown
      readonly providerExecuted: boolean
      readonly callID: string
      readonly assistantMessageID: SessionMessage.ID
      readonly materialization: ToolRegistry.Materialization
    }): Effect.Effect<ToolRegistry.Settlement, ToolOutputStore.Error> =>
      Effect.gen(function* () {
        const check = yield* doomLoop.check({
          sessionID: input.sessionID,
          toolName: input.toolName,
          toolInput: input.toolInput,
          providerExecuted: input.providerExecuted,
          source: { type: "tool", messageID: input.assistantMessageID, callID: input.callID },
        }).pipe(Effect.exit)
        if (Exit.isFailure(check)) {
          const blocked = Cause.squash(check.cause)
          const value =
            blocked instanceof PermissionV2.CorrectedError
              ? blocked.feedback
              : `Repeated identical ${input.toolName} call blocked by doom_loop approval`
          return { result: { type: "error" as const, value } }
        }
        return yield* input.materialization.settle({
          sessionID: input.sessionID,
          agent: input.agent,
          assistantMessageID: input.assistantMessageID,
          call: { type: "tool-call", id: input.callID, name: input.toolName, input: input.toolInput },
        })
      })

    const awaitToolFibers = (fibers: FiberSet.FiberSet<void, ToolOutputStore.Error>) =>
      Effect.raceFirst(FiberSet.join(fibers), FiberSet.awaitEmpty(fibers))

    // Match V1: dismissing a question halts the loop instead of becoming model-facing tool output.
    const isQuestionRejected = (cause: Cause.Cause<unknown>) =>
      cause.reasons.some((reason) => Cause.isDieReason(reason) && reason.defect instanceof QuestionV2.RejectedError)

    type TurnTransition =
      // Automatic compaction completed; rebuild the request from compacted history.
      | { readonly _tag: "ContinueAfterCompaction"; readonly step: number }
      // Overflow compaction completed; rebuild once through the path without overflow recovery.
      | { readonly _tag: "ContinueAfterOverflowCompaction"; readonly step: number }

    class TurnTransitionError extends Error {
      constructor(readonly transition: TurnTransition) {
        super()
      }
    }

    const continueAfterCompaction = (step: number) => new TurnTransitionError({ _tag: "ContinueAfterCompaction", step })
    const continueAfterOverflowCompaction = (step: number) =>
      new TurnTransitionError({ _tag: "ContinueAfterOverflowCompaction", step })

    const loadSystemContext = (agent: AgentV2.Selection) =>
      Effect.all([systemContext.load(), skillGuidance.load(agent), referenceGuidance.load()], {
        concurrency: "unbounded",
      }).pipe(Effect.map(SystemContext.combine))

    const runTurnAttempt = Effect.fn("SessionRunner.runTurn")(function* (
      state: CacheState,
      sessionID: SessionSchema.ID,
      promotion: SessionInput.Delivery | undefined,
      step: number,
      recoverOverflow?: typeof compaction.compactAfterOverflow,
    ) {
      const session = yield* getSession(sessionID)
      // Enforce Product Mode × Agent policy on each provider turn.
      const agentID = yield* ProductModeAgentPolicy.enforcePrimary(session.mode, session.agent)
      if (session.location.directory !== location.directory || session.location.workspaceID !== location.workspaceID)
        return yield* Effect.interrupt
      const agent = yield* agents.select(agentID)
      const initialized = yield* SessionContextEpoch.initialize(db, loadSystemContext(agent), session.id)
      const toolFibers = yield* FiberSet.make<void, ToolOutputStore.Error>()
      let needsContinuation = false
      let currentStep = step
      if (promotion) {
        const cutoff = yield* EventV2.latestSequence(db, session.id)
        let promoted = 0
        if (promotion === "steer") {
          promoted = yield* SessionInput.promoteSteers(db, events, session.id, cutoff)
          promoted += yield* promoteSkills(session.id, cutoff)
        }
        if (promotion === "queue") {
          promoted += Number(yield* SessionInput.promoteNextQueued(db, events, session.id))
          promoted += yield* SessionInput.promoteSteers(db, events, session.id, cutoff)
          promoted += yield* promoteSkills(session.id, cutoff)
        }
        if (promoted > 0) currentStep = 1
      }
      const system =
        initialized ?? (yield* SessionContextEpoch.prepare(db, events, loadSystemContext(agent), session.id))
      const model = yield* models.resolve(session)
      const entries = yield* SessionHistory.entriesForRunner(db, session.id, system.baselineSeq)
      const context = entries.map((entry) => entry.message)
      const isLastStep = agent.info?.steps !== undefined && currentStep >= agent.info.steps
      // Derive tool-filtering intent from the latest user message, if available.
      const intent: IntentCategory | undefined = (() => {
        for (let i = context.length - 1; i >= 0; i--) {
          const msg = context[i]
          if (msg.type === "user") {
            const category = classify(msg.text).category
            return category !== "unknown" ? category : undefined
          }
        }
        return undefined
      })()
      const toolMaterialization = isLastStep ? undefined : yield* tools.materialize(agent.info?.permissions, intent)
      const promptCacheKey = /^ses_[0-9a-f]{64}$/.test(session.id) ? session.id.slice(4) : session.id
      const request = LLM.request({
        model,
        providerOptions: { openai: { promptCacheKey } },
        system: [agent.info?.system, system.baseline]
          .filter((part): part is string => part !== undefined && part.length > 0)
          .map(SystemPart.make),
        messages: [...toLLMMessages(context, model), ...(isLastStep ? [Message.assistant(MAX_STEPS_PROMPT)] : [])],
        tools: toolMaterialization?.definitions ?? [],
        toolChoice: isLastStep ? "none" : undefined,
      })
      if (yield* compaction.compactIfNeeded({ sessionID: session.id, entries, model, request })) {
        state.rewriteVersion++
        return yield* Effect.die(continueAfterCompaction(currentStep))
      }
      const prefixShape = CacheShape.capture(
        [agent.info?.system, system.baseline].filter((part): part is string => part !== undefined && part.length > 0).join("\n"),
        toolMaterialization?.definitions ?? [],
        state.rewriteVersion,
      )
      const publisher = createLLMEventPublisher(events, {
        sessionID: session.id,
        agent: agent.id,
        model: {
          id: ModelV2.ID.make(model.id),
          providerID: ProviderV2.ID.make(model.provider),
          ...(session.model?.variant === undefined ? {} : { variant: session.model.variant }),
        },
        onStepFinish: (usage, assistantMessageID) =>
          Effect.gen(function* () {
            const cur = prefixShape
            const read = usage?.cacheReadInputTokens ?? 0
            const miss = usage?.nonCachedInputTokens ?? 0
            const diag = CacheShape.compare(state.lastPrefixShape, cur, read, miss)
            state.lastPrefixShape = cur
            state.sessionCacheRead += read
            state.sessionNonCached += miss
            yield* events.publish(SessionEvent.Cache.Diagnostic, {
              sessionID: session.id,
              timestamp: yield* DateTime.now,
              assistantMessageID,
              prefixHash: diag.prefixHash,
              prefixChanged: diag.prefixChanged,
              prefixChangeReasons: diag.prefixChangeReasons,
              cacheReadInputTokens: read,
              nonCachedInputTokens: miss,
              sessionCacheRead: state.sessionCacheRead,
              sessionNonCached: state.sessionNonCached,
            })
          }),
      })
      const withPublication = Semaphore.makeUnsafe(1).withPermit
      const publish = (event: LLMEvent, outputPaths: ReadonlyArray<string> = []) =>
        withPublication(publisher.publish(event, outputPaths))
      let overflowFailure: ProviderErrorEvent | undefined
      const providerStream = llm.stream(request).pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            if (overflowFailure || publisher.hasProviderError()) return
            if (LLMEvent.is.providerError(event)) {
              if (isContextOverflowFailure(event) && !publisher.hasAssistantStarted()) {
                overflowFailure = event
                return
              }
            }
            yield* publish(event)
            if (event.type !== "tool-call" || event.providerExecuted) return
            if (!toolMaterialization) {
              yield* withPublication(publisher.failUnsettledTools("Tools are disabled after the maximum agent steps"))
              return
            }
            needsContinuation = true
            const assistantMessageID = yield* publisher.assistantMessageID(event.id)
            yield* Effect.uninterruptibleMask((restore) =>
              restore(
                settleTool({
                  sessionID: session.id,
                  agent: agent.id,
                  toolName: event.name,
                  toolInput: event.input,
                  providerExecuted: event.providerExecuted === true,
                  callID: event.id,
                  assistantMessageID,
                  materialization: toolMaterialization,
                }),
              ).pipe(
                Effect.flatMap((settlement) =>
                  publish(
                    LLMEvent.toolResult({
                      id: event.id,
                      name: event.name,
                      result: settlement.result,
                      output: settlement.output,
                    }),
                    settlement.outputPaths ?? [],
                  ),
                ),
              ),
            ).pipe(FiberSet.run(toolFibers))
          }),
        ),
        Effect.ensuring(withPublication(publisher.flush())),
      )

      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const stream = yield* restore(providerStream).pipe(Effect.exit)
          const failure =
            stream._tag === "Failure" ? Option.getOrUndefined(Cause.findErrorOption(stream.cause)) : undefined
          if (
            recoverOverflow &&
            !publisher.hasAssistantStarted() &&
            isContextOverflowFailure(overflowFailure ?? failure) &&
            (yield* restore(recoverOverflow({ sessionID: session.id, entries, model, request })))
          ) {
            state.rewriteVersion++
            return yield* Effect.die(continueAfterOverflowCompaction(currentStep))
          }
          if (overflowFailure) yield* publish(overflowFailure)
          const llmFailure = failure instanceof LLMError ? failure : undefined
          if (llmFailure && !publisher.hasProviderError()) {
            yield* withPublication(publisher.failUnsettledTools("Provider did not return a tool result", true))
            yield* withPublication(publisher.failAssistant(llmFailure.reason.message))
          }
          if (stream._tag === "Failure" && Cause.hasInterrupts(stream.cause)) yield* FiberSet.clear(toolFibers)
          const settled = yield* restore(awaitToolFibers(toolFibers)).pipe(Effect.exit)
          if (settled._tag === "Failure" && isQuestionRejected(settled.cause)) {
            yield* FiberSet.clear(toolFibers)
            yield* withPublication(publisher.failUnsettledTools("Tool execution interrupted"))
            return yield* Effect.interrupt
          }
          if (
            (stream._tag === "Failure" && Cause.hasInterrupts(stream.cause)) ||
            (settled._tag === "Failure" && Cause.hasInterrupts(settled.cause))
          ) {
            yield* FiberSet.clear(toolFibers)
            yield* withPublication(publisher.failUnsettledTools("Tool execution interrupted"))
            if (publisher.hasActiveAssistant())
              yield* withPublication(publisher.failAssistant("Provider turn interrupted"))
          }
          if (settled._tag === "Failure" && !Cause.hasInterrupts(settled.cause)) {
            const failure = Cause.squash(settled.cause)
            const message = failure instanceof Error ? failure.message : String(failure)
            yield* withPublication(publisher.failUnsettledTools(`Tool execution failed: ${message}`))
          }
          if (publisher.hasProviderError())
            yield* withPublication(publisher.failUnsettledTools("Tool execution interrupted"))
          if (publisher.isAborted()) {
            yield* events.publish(SessionEvent.Retried, {
              sessionID: session.id,
              timestamp: yield* DateTime.now,
              attempt: 1,
              error: { message: "Stream interrupted after partial output", isRetryable: true },
            })
          }
          if (stream._tag === "Success" && !publisher.hasProviderError())
            yield* withPublication(publisher.failUnsettledTools("Provider did not return a tool result", true))
          if (stream._tag === "Failure") return yield* Effect.failCause(stream.cause)
          if (settled._tag === "Failure") return yield* Effect.failCause(settled.cause)
          return { needsContinuation: (!publisher.hasProviderError() || publisher.isAborted()) && needsContinuation, step: currentStep }
        }),
      )
    }, Effect.scoped)
    type RunTurn = (
      state: CacheState,
      sessionID: SessionSchema.ID,
      promotion: SessionInput.Delivery | undefined,
      step: number,
    ) => Effect.Effect<{ readonly needsContinuation: boolean; readonly step: number }, RunError>

    const runAfterOverflowCompaction: RunTurn = Effect.fnUntraced(function* (state, sessionID, promotion, step) {
      return yield* runTurnAttempt(state, sessionID, promotion, step).pipe(
        Effect.catchDefect(
          Effect.fnUntraced(function* (defect) {
            if (!(defect instanceof TurnTransitionError)) return yield* Effect.die(defect)
            if (defect.transition._tag === "ContinueAfterOverflowCompaction")
              return yield* Effect.die("Post-compaction provider attempt cannot recover another overflow")
            yield* Effect.yieldNow
            return yield* runAfterOverflowCompaction(state, sessionID, undefined, defect.transition.step)
          }),
        ),
      )
    })

    const runTurn: RunTurn = Effect.fnUntraced(function* (state, sessionID, promotion, step) {
      return yield* runTurnAttempt(state, sessionID, promotion, step, compaction.compactAfterOverflow).pipe(
        Effect.catchDefect(
          Effect.fnUntraced(function* (defect) {
            if (!(defect instanceof TurnTransitionError)) return yield* Effect.die(defect)
            yield* Effect.yieldNow
            if (defect.transition._tag === "ContinueAfterOverflowCompaction")
              return yield* runAfterOverflowCompaction(state, sessionID, undefined, defect.transition.step)
            return yield* runTurn(state, sessionID, undefined, defect.transition.step)
          }),
        ),
      )
    })

    const promoteSkills = Effect.fn("SessionRunner.promoteSkills")(function* (
      sessionID: SessionSchema.ID,
      cutoff: number,
    ) {
      const pending = yield* SessionInput.pendingSkillSteers(db, sessionID, cutoff)
      if (pending.length === 0) return 0
      const available = yield* skills.list()
      for (const admitted of pending) {
        if (admitted.kind !== "skill") continue
        const skill = available.find((candidate) => candidate.name === admitted.skill)
        const text = skill ? skill.content : `Skill not found: ${admitted.skill}`
        // Reuse the admission timestamp: projectPrompted's matchesProjection compares the
        // Prompted event time against the stored inbox row's time_created (admission time).
        // Using DateTime.now here (promotion time) would fail that check under a real clock.
        yield* events.publish(SessionEvent.Prompted, {
          sessionID,
          messageID: admitted.id,
          timestamp: yield* DateTime.now,
          prompt: Prompt.make({ text }),
          delivery: admitted.delivery,
        })
      }
      return pending.length
    })

    const drainShell = Effect.fn("SessionRunner.drainShell")(function* (admitted: SessionInput.Admitted) {
      if (admitted.kind !== "shell") return
      // Fence shell execution to the session's owning Location, mirroring runTurnAttempt.
      const session = yield* getSession(admitted.sessionID)
      // V2 shell policy guard: deny shell in chat mode (defense in depth, shell method
      // also checks this, but drainShell executes independently via the runner loop).
      const commandVerdict = ProductModeAgentPolicy.checkCommandAllowed(session.mode)
      if (!commandVerdict.allowed) return yield* Effect.die(commandVerdict.error)
      if (session.location.directory !== location.directory || session.location.workspaceID !== location.workspaceID)
        return yield* Effect.interrupt
      // Spawn is interruptible; Shell.Ended is published from an uninterruptible tail so the
      // shell message never strands in "running" if the drain is interrupted or the spawn fails.
      // Shell.Started is inside the mask so an interrupt cannot fire Started without Ended.
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const callID = crypto.randomUUID()
          yield* events.publish(SessionEvent.Shell.Started, {
            sessionID: admitted.sessionID,
            messageID: admitted.id,
            timestamp: yield* DateTime.now,
            callID,
            command: admitted.command,
          })
          const exit = yield* restore(
            Effect.gen(function* () {
              const entries = yield* config.entries()
              const shellConfig = Object.assign(
                {},
                ...entries.flatMap((entry) => (entry.type === "document" ? [entry.info] : [])),
              ).shell
              const command = ChildProcess.make(admitted.command, [], {
                cwd: location.directory,
                shell: Shell.preferred(shellConfig),
                stdin: "ignore",
                detached: process.platform !== "win32",
                forceKillAfter: Duration.seconds(3),
              })
              const result = yield* appProcess
                .run(command, {
                  timeout: Duration.seconds(30),
                  maxOutputBytes: 1024 * 1024,
                  maxErrorBytes: 1024 * 1024,
                })
                .pipe(
                  Effect.catchTag("AppProcessError", (error) =>
                    Effect.succeed({
                      command: admitted.command,
                      exitCode: -1,
                      stdout: Buffer.from(""),
                      stderr: Buffer.from(String(error)),
                      stdoutTruncated: false,
                      stderrTruncated: false,
                    }),
                  ),
                )
              return [result.stdout.toString("utf8"), result.stderr.toString("utf8"), `exit code ${result.exitCode}`]
                .filter((part) => part.length > 0)
                .join("\n")
            }),
          ).pipe(Effect.exit)
          const output = Exit.match(exit, {
            onSuccess: (value) => value,
            onFailure: (cause) => `Command failed: ${Cause.pretty(cause)}`,
          })
          yield* events.publish(SessionEvent.Shell.Ended, {
            sessionID: admitted.sessionID,
            timestamp: yield* DateTime.now,
            callID,
            output,
          })
          // Re-raise interrupt so the runner drain stops; other failures are absorbed (output captures them).
          if (Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)) return yield* Effect.failCause(exit.cause)
        }),
      )
    })

    const run = Effect.fn("SessionRunner.run")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly force: boolean
    }) {
      const state: CacheState = {
        lastPrefixShape: undefined,
        sessionCacheRead: 0,
        sessionNonCached: 0,
        rewriteVersion: 0,
      }

      const hasPromptSteer = yield* SessionInput.hasPending(db, input.sessionID, "steer", "prompt")
      const hasSkillSteer = hasPromptSteer
        ? false
        : yield* SessionInput.hasPending(db, input.sessionID, "steer", "skill")
      const hasSteer = hasPromptSteer || hasSkillSteer
      const hasQueue = hasSteer ? false : yield* SessionInput.hasPending(db, input.sessionID, "queue")
      const hasShell = hasQueue ? false : (yield* SessionInput.nextPendingShell(db, input.sessionID)) !== undefined
      if (!input.force && !hasSteer && !hasQueue && !hasShell) return
      yield* failInterruptedTools(input.sessionID)
      let promotion: SessionInput.Delivery | undefined = hasSteer ? "steer" : hasQueue ? "queue" : undefined
      let shouldRun = input.force || hasSteer || hasQueue || hasShell
      let forceTurn = input.force
      while (shouldRun) {
        // Run LLM turns only when there is a prompt to promote or an explicit force drain;
        // a shell-only wake skips this to avoid firing a spurious provider turn with no new input.
        if (promotion !== undefined || forceTurn) {
          forceTurn = false
          let needsContinuation = true
          let step = 1
          while (needsContinuation) {
            const result = yield* runTurn(state, input.sessionID, promotion, step)
            needsContinuation = result.needsContinuation
            step = result.step + 1
            promotion = "steer"
            if (!needsContinuation)
              needsContinuation =
                (yield* SessionInput.hasPending(db, input.sessionID, "steer", "prompt")) ||
                (yield* SessionInput.hasPending(db, input.sessionID, "steer", "skill"))
          }
        }
        // Drain queued shell inputs at the idle boundary.
        let shell = yield* SessionInput.nextPendingShell(db, input.sessionID)
        while (shell) {
          yield* drainShell(shell)
          shell = yield* SessionInput.nextPendingShell(db, input.sessionID)
        }
        const nextQueue = yield* SessionInput.hasPending(db, input.sessionID, "queue")
        const nextShell = nextQueue
          ? false
          : (yield* SessionInput.nextPendingShell(db, input.sessionID)) !== undefined
        shouldRun = nextQueue || nextShell
        promotion = nextQueue ? "queue" : undefined
      }
    })

    return Service.of({
      run,
    })
  }),
)

export const defaultLayer = layer
