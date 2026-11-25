export * as TaskTool from "./task.js"

import { Message, ToolFailure } from "@omnixa/ai"
import type { Context } from "@omnixa/plugin/effect/plugin"
import { DelegationID, ParticipantID, TurnID } from "@omnixa/schema/delegation-id"
import { Delegation } from "@omnixa/schema/delegation"
import { Cause, Effect, Option, Schema } from "effect"
import { and, eq } from "drizzle-orm"
import { Agent } from "../../agent.js"
import { Model } from "../../model.js"
import { ModelResolver } from "../../model-resolver.js"
import { Service } from "../../plugin/service.js"
import { ControllerConflictError, sameModel } from "../../session/error.js"
import { Config } from "../../config.js"
import { DelegationExecution } from "../../delegation/execution.js"
import { DelegationService } from "../../delegation/service.js"
import { DelegationReview } from "../../delegation/review.js"
import { DelegationReceipt } from "../../delegation/receipt.js"
import { Database } from "../../database/database.js"
import { CliAdapter } from "../cli-adapter.js"
import { CodexAppServer } from "../codex-app-server.js"
import { ClaudeCodeSdkAdapter } from "../claude-code-sdk.js"
import { FileAccess } from "../../file-access.js"
import { ShellParse } from "../../shell/parse.js"
import { ShellSelect } from "../../shell/select.js"
import { Permission } from "../../permission.js"
import { Session } from "../../session.js"
import { SessionComposition } from "../../session/composition.js"
import { SessionExecution } from "../../session/execution.js"
import { SessionMessage } from "../../session/message.js"
import { SessionInputResult } from "../../session/input-result.js"
import { SessionHistory } from "../../session/history.js"
import { SessionInputResultTable } from "../../session/sql.js"
import { SessionTask } from "../../session/task.js"
import { WorkflowExecution } from "../../workflow/execution.js"
import { Composition } from "@omnixa/schema/composition"
import { ExecutorBinding } from "@omnixa/schema/session"
import { Tool } from "@omnixa/schema/tool"
import {
  OperationID,
  OperationInfo,
  OperationPhase,
  OperationReadonlyRef,
  OperationRequest,
  OperationTarget,
  OperationToolSource,
} from "@omnixa/schema/session-task"
import { SessionInbox } from "@omnixa/schema/session-inbox"
import { optional } from "@omnixa/schema/schema"
import { FSUtil } from "@omnixa/util/fs-util"
import { Hash } from "@omnixa/util/hash"
import { Verifier } from "../../session/verifier.js"
import { VerificationRouter } from "../../session/verification-router.js"

export const name = "task"

const backgroundEnabled = () =>
  process.env.OMNIXA_EXPERIMENTAL_BACKGROUND_SUBAGENTS === "1" ||
  process.env.OMNIXA_EXPERIMENTAL_BACKGROUND_SUBAGENTS === "true"

export const Input = Schema.Struct({
  description: Schema.String.annotate({ description: "A short 3-5 word description of the task" }),
  prompt: Schema.String.annotate({ description: "The complete task for the agent to perform" }),
  target: optional(OperationTarget).annotate({
    description:
      "Selected Meta can dispatch into a new or existing independent root. Set its mode, agent, model, and composition in target.",
  }),
  replacesOperationID: optional(OperationID).annotate({
    description:
      "Explicitly replace an unfinished root Task operation from this source Session while retaining its saved history.",
  }),
  delivery: optional(SessionInbox.Delivery).annotate({
    description: "Root-target input delivery; defaults to queue.",
  }),
  resume: optional(Schema.Boolean).annotate({
    description: "Root-target execution defaults to true. False durably admits the input without starting execution.",
  }),
  verification: Schema.optionalKey(
    Schema.Struct({
      source: Schema.optionalKey(
        Schema.Struct({
          sessionID: Schema.optionalKey(Session.ID),
          messageID: SessionMessage.ID,
          id: Schema.String,
        }),
      ),
      intent: Schema.optionalKey(Schema.Literal("content_creation")),
      claims: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({
            claim: Schema.String,
            source: Schema.optionalKey(
              Schema.Struct({
                sessionID: Schema.optionalKey(Session.ID),
                messageID: SessionMessage.ID,
                id: Schema.String,
              }),
            ),
          }),
        ),
      ),
    }),
  ).annotate({
    description:
      "Associate a saved write/edit/patch mechanical result or structured delivery claims (bound to saved shell CommandResult or Verifier sources) with configured verification.",
  }),
  artifact_path: Schema.optionalKey(Schema.String).annotate({
    description: "Capture one existing tracked UTF-8 text path as a revision after this internal Task completes.",
  }),
  intent: Schema.optionalKey(Schema.Literals(["implement", "review"])).annotate({
    description: "Review binds the current verified artifact revision; ordinary Tasks default to implement.",
  }),
  revision_digest: Schema.optionalKey(DelegationService.RevisionReference.fields.revisionDigest),
  subagent_type: Schema.optionalKey(Schema.String).annotate({
    description: "The specialized agent for a delegated task. Workflow tasks use workflow instead.",
  }),
  workflow: Schema.optionalKey(Composition.CompositionInput).annotate({
    description:
      "Run a published Workflow composition in the foreground. Uses its published StepInput; available to the selected Meta in Work.",
  }),
  workflow_retry: Schema.optionalKey(WorkflowExecution.TaskRetry).annotate({
    description:
      "Retry a failed Workflow step using its frozen run definition and current run/step revisions. This new Task owns the retry result.",
  }),
  expectedPlanDigest: Schema.optionalKey(Composition.Digest).annotate({
    description: "Optional known composition digest. When omitted, the system freezes it from the published selection.",
  }),
  model: Schema.optionalKey(Model.Selection),
  task_id: Schema.optionalKey(Schema.String).annotate({
    description: "Resume a previous task using its child session ID. The child must belong to this delegation.",
  }),
  parent_task_id: Schema.optionalKey(Schema.String).annotate({
    description: "Link an existing task from this session. When omitted, an in_progress task is created automatically.",
  }),
  background: Schema.optionalKey(Schema.Boolean).annotate({
    description:
      "Run in the background and receive an automatic completion notification. Requires OMNIXA_EXPERIMENTAL_BACKGROUND_SUBAGENTS; otherwise this option is ignored. Do not poll.",
  }),
  attended: Schema.optionalKey(Schema.Boolean).annotate({
    description:
      "Forward supported external codex/app-server approvals to the parent user. Steer inherits the original Job's approval mode; omit attended. Internal attended execution remains unavailable.",
  }),
  execution_type: Schema.optionalKey(Schema.Literals(["subagent", "external-cli", "judge"])).annotate({
    description:
      "Internal subagent, configured codex/app-server or claude-code/sdk, or distinct-model Judge workers for selected Meta in Work.",
  }),
  cli_target: Schema.optionalKey(Schema.String),
  judge_models: Schema.optionalKey(Schema.Array(Schema.String)).annotate({
    description:
      "Explicit provider/model#variant references for Judge workers. All workers receive the complete prompt.",
  }),
  arbitration_model: Schema.optionalKey(Model.Ref).annotate({
    description: "Request one arbitration of the complete settled Judge results using this model.",
  }),
  summary: Schema.optionalKey(Schema.Struct({ model: Schema.optionalKey(Model.Ref) })).annotate({
    description:
      "Request one summary of the original Judge results and actual arbitration. Omitted model uses the Task executor selection.",
  }),
  delegation_id: Schema.optionalKey(Schema.String).annotate({
    description: "Route into an existing persistent delegation owned by this session.",
  }),
  new_delegation: Schema.optionalKey(Schema.Boolean).annotate({
    description: "Create a fresh delegation instead of adopting the active one when no delegation_id is supplied.",
  }),
  participant_id: Schema.optionalKey(Schema.String).annotate({
    description: "Route to an existing participant in the selected delegation.",
  }),
  turn_id: Schema.optionalKey(Schema.String),
  command: Schema.optionalKey(
    Schema.Literals([
      "append",
      "steer",
      "interrupt",
      "close",
      "complete",
      "retry",
      "reconcile",
      "archive",
      "unarchive",
      "fork",
      "purge",
      "retract_rejection",
    ]),
  ),
})

const Locators = Schema.Struct({
  task_id: Schema.optionalKey(Session.ID),
  delegation_id: Schema.optionalKey(DelegationID.ID),
  participant_id: Schema.optionalKey(ParticipantID),
  turn_id: Schema.optionalKey(TurnID),
})

const Status = Schema.Literals(["completed", "running", "failed", "cancelled", "recovery_required"])

export const InternalOutput = Schema.Struct({
  sessionID: Session.ID,
  output: Schema.String,
  status: Status,
  delegationID: Schema.optionalKey(DelegationID.ID),
  turnID: Schema.optionalKey(TurnID),
  participantID: Schema.optionalKey(ParticipantID),
  inputID: Schema.optionalKey(SessionMessage.ID),
  parentTaskID: Schema.optionalKey(Schema.String),
  governance: Schema.optionalKey(DelegationService.Governance),
  verification: Schema.optionalKey(VerificationRouter.Settlement),
})
const JudgeWorker = Schema.Struct({
  taskID: Schema.String,
  source: Permission.ToolSource,
  requested: Model.Selection,
  executor: ExecutorBinding,
  runtime: Schema.optionalKey(Schema.Struct({ provider: Schema.String, id: Schema.String, route: Schema.String })),
  observation: Schema.optionalKey(VerificationRouter.JudgeResult),
  delegationID: DelegationID.ID,
  participantID: ParticipantID,
  turnID: TurnID,
  receipt: Schema.optionalKey(Delegation.Receipt),
  status: Status,
  text: Schema.String,
  completion: Schema.optionalKey(
    Schema.Struct({
      assistantID: SessionMessage.ID,
      model: SessionMessage.Assistant.fields.model,
      finish: SessionMessage.Assistant.fields.finish,
      rawFinish: SessionMessage.Assistant.fields.rawFinish,
      needsContinuation: SessionMessage.Assistant.fields.needsContinuation,
    }),
  ),
})

class RetainedJudgeResult extends Schema.Class<RetainedJudgeResult>("TaskTool.RetainedJudgeResult")({
  verification: VerificationRouter.Settlement,
  workers: Schema.Array(JudgeWorker),
}) {}

export class JudgeEnhancement extends Schema.Class<JudgeEnhancement>("TaskTool.JudgeEnhancement")({
  requested: Schema.optionalKey(Model.Ref),
  status: Schema.Literals([
    "completed",
    "partial",
    "empty",
    "failed",
    "cancelled",
    "recovery_required",
    "running",
    "unavailable",
  ]),
  result: Schema.optionalKey(JudgeWorker),
  error: Schema.optionalKey(Schema.String),
}) {}

export const JudgeOutput = Schema.Struct({
  kind: Schema.Literal("judge"),
  sessionID: Session.ID,
  parentTaskID: Schema.String,
  source: Permission.ToolSource,
  input: Schema.Struct({ text: Schema.String }),
  arbitration: Schema.Union([Schema.Literal("none"), JudgeEnhancement]),
  summary: Schema.optionalKey(JudgeEnhancement),
  status: Status,
  taskSettlement: Schema.Literals(["updated", "conflict"]),
  workers: Schema.Array(JudgeWorker),
  verification: Schema.optionalKey(VerificationRouter.Settlement),
  retained: Schema.optionalKey(Schema.Array(RetainedJudgeResult)),
})
export const OperationOutput = Schema.Struct({
  kind: Schema.Literal("operation"),
  operation: OperationInfo,
  operationRef: OperationReadonlyRef,
  status: OperationPhase,
  output: Schema.String,
})
export const Output = Schema.Union([InternalOutput, DelegationReceipt.Output, JudgeOutput, OperationOutput])

export const description = [
  "Delegate a complete task to a specialized agent through a persistent delegation and child session.",
  "Foreground execution returns the complete response for this task's input. Include all context for a fresh child.",
  "Selected Meta can set target to new_root or existing_root to dispatch into an independent main session across modes. This path returns the durable operation phase and operationRef as its admission acknowledgement. Put root mode, agent, model, and composition in target; parent_task_id optionally links a source Task. Root delivery defaults to queue and resume defaults to true.",
  "Selected Meta in Work can pass workflow with a published composition. It runs the frozen steps in the foreground and returns the complete Workflow result. expectedPlanDigest is optional; published step inputs supply the execution input.",
  "Selected Meta in Work can use execution_type judge and judge_models to send the same complete prompt to distinct actual models through the requested subagent. Judge returns every worker's full result, model and source. arbitration_model requests one arbitration; summary requests one summary using an optional model. Both use fresh children and retain the original results if unavailable or unsuccessful. Omitted arbitration remains none.",
  "verification.source selects a saved mechanical result by messageID and Tool id; sessionID defaults to this Session and may select an owned Task child. Configured verification routes actual failures to Judge and explicit internal artifact/review/management Tasks. verification.intent content_creation uses its complete input when no package check is available. Judge observations cite exact input quotes; completion still requires the original review barrier or an actual passed check.",
  "Use task_id or participant_id to continue the same participant; use delegation_id to select its delegation.",
  "append and steer both admit a new prompt. Management commands operate on the selected delegation.",
  "Configured codex/app-server supports external-cli tasks, including background execution when its experimental flag is enabled. Set cli_target and subagent_type to codex. Use delegation_id + participant_id to continue its external thread; do not use task_id.",
  "Configured claude-code/sdk supports read-only analysis using Read, Grep and Glob, in the foreground or background, and foreground reviews of a bound revision. Set cli_target and subagent_type to claude-code. Use delegation_id + participant_id to append to the same SDK session; background append queues behind active work. Each new SDK Query has its own parent permission scope/source and retains the SDK session and result message identity when it completes.",
  "Configured claude-code/jsonl supports foreground read-only new/append Tasks through stream-json. Each invocation uses its own parent Read/Grep/Glob approval scope and retains the same-frame session/result identity and complete result after stdout EOF and process exit. Background, active steer and review require their supporting transport.",
  "Configured claude-code/acp supports new foreground Tasks and append continuations. Set cli_target and subagent_type to claude-code; use delegation_id + participant_id to continue its ACP session. File reads use the parent permission interface, and the complete protocol identity and response are retained. ACP execution does not support background Tasks, revision reviews or active steer.",
  "Use interrupt with delegation_id, participant_id and turn_id to cancel one external queued input that has not started. Its original acknowledgement and history stay intact. Continue an available participant with a new Task after cancellation.",
  "Foreground external command=steer adds input to the same active background Codex turn or already started background SDK Query. SDK steer retains an independent Task and result for its new input. Both inherit the original Job's approval scope/source; supply explicit delegation_id and participant_id and omit attended, which cannot be changed for steer. attended forwards supported command/file approvals for new external work to the parent user's permission interface.",
].join("\n")

const commandPermissions = {
  interrupt: "task_interrupt",
  close: "task_close",
  complete: "task_close",
  archive: "task_archive",
  unarchive: "task_archive",
  fork: "task_fork",
  purge: "task_purge",
  retry: "task_reconcile",
  reconcile: "task_reconcile",
  retract_rejection: "task_reconcile",
}

const toToolFailure = (error: { readonly message: string }) => new ToolFailure({ message: error.message, error })

export const Plugin = {
  id: "omnixa.tool.task",
  effect: Effect.fn("TaskTool.Plugin")(function* (ctx: Context) {
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const models = yield* Model.Service
    const resolver = yield* ModelResolver.Service
    const plugins = yield* Service
    const compositions = yield* SessionComposition.Service
    const config = yield* Config.Service
    const permission = yield* Permission.Service
    const delegations = yield* DelegationService.Service
    const execution = yield* DelegationExecution.Service
    const runs = yield* SessionExecution.Service
    const tasks = yield* SessionTask.Service
    const workflows = yield* WorkflowExecution.Service
    const database = yield* Database.Service
    const access = yield* FileAccess.Service
    const shells = yield* ShellSelect.Service
    const files = yield* FSUtil.Service
    const router = yield* VerificationRouter.Service.pipe(Effect.provide(VerificationRouter.layer))
    yield* Effect.sync(() => {
      if (!CliAdapter.getCliAdapter("codex")) CliAdapter.registerCliAdapter("codex", CodexAppServer.adapter)
      if (!CliAdapter.getCliAdapter("claude-code"))
        CliAdapter.registerCliAdapter("claude-code", ClaudeCodeSdkAdapter.adapter)
    })
    const attendedDefault = Config.latest(yield* config.entries(), "subagent_attended_default")

    const withVerification = Effect.fn("TaskTool.verification")(function* (
      input: typeof Input.Type,
      context: Tool.Context,
      run: (
        context: Tool.Context,
        prompt?: string,
        evidence?: string,
      ) => Effect.Effect<Tool.Result<typeof Output>, ToolFailure>,
    ) {
      if (!input.verification) return yield* run(context)
      const parent = yield* sessions.get(context.sessionID).pipe(Effect.mapError(toToolFailure))
      const source = new VerificationRouter.Source({
        sessionID: parent.id,
        messageID: context.messageID,
        id: context.id,
      })
      const requested = input.verification.source
      const selected = requested
        ? new VerificationRouter.Source({
            sessionID: requested.sessionID ?? parent.id,
            messageID: requested.messageID,
            id: requested.id,
          })
        : undefined
      const messages = yield* sessions
        .messages({ sessionID: parent.id, type: "assistant", order: "asc" })
        .pipe(Effect.mapError(toToolFailure))
      const saved = messages.flatMap((message) =>
        message.type === "assistant"
          ? message.content.flatMap((part) => {
              if (
                part.type !== "tool" ||
                part.name !== name ||
                (part.state.status !== "completed" && part.state.status !== "error")
              )
                return []
              const decoded = Schema.decodeUnknownOption(VerificationRouter.Settlement)(
                part.state.metadata?.verification,
              )
              if (
                Option.isNone(decoded) ||
                decoded.value.source.sessionID !== parent.id ||
                decoded.value.source.messageID !== message.id ||
                decoded.value.source.id !== part.id
              )
                return []
              const workers =
                part.state.status === "error"
                  ? Schema.decodeUnknownOption(Schema.Array(JudgeWorker))(part.state.metadata?.completedWorkers)
                  : Option.none()
              const restored =
                part.state.status === "completed"
                  ? Schema.decodeUnknownOption(Schema.Array(VerificationRouter.Source))(
                      part.state.metadata?.restoredVerificationSources,
                    )
                  : Option.none()
              return [
                {
                  verification: decoded.value,
                  workers: Option.isSome(workers) ? workers.value : [],
                  restored: Option.isSome(restored) ? restored.value : [],
                  prompt: typeof part.state.input.prompt === "string" ? part.state.input.prompt : undefined,
                },
              ]
            })
          : [],
      )
      const history = saved.map((record) => record.verification)
      const consumed = new Set(saved.flatMap((record) => record.restored).map((restored) => JSON.stringify(restored)))
      // Interrupted Tool metadata is durable, but only canonical content reaches the next provider request.
      const previousResults = saved.flatMap((record) => {
        if (record.workers.length === 0 || consumed.has(JSON.stringify(record.verification.source))) return []
        const associated = selected
          ? record.verification.mechanicalSource?.sessionID === selected.sessionID &&
            record.verification.mechanicalSource.messageID === selected.messageID &&
            record.verification.mechanicalSource.id === selected.id
          : input.verification?.intent === "content_creation" &&
            record.verification.intent === "content_creation" &&
            record.prompt === input.prompt
        if (!associated) return []
        return [new RetainedJudgeResult({ verification: record.verification, workers: record.workers })]
      })
      const operation =
        input.execution_type === "judge"
          ? ("l1" as const)
          : input.artifact_path !== undefined || input.intent === "review" || input.command !== undefined
            ? ("l2" as const)
            : ("none" as const)
      const previous = yield* router.route({ history, source, operation, status: "not_dispatched" })
      const resolveOwnedTool = Effect.fnUntraced(function* (
        target: VerificationRouter.Source,
        bindParticipant: boolean,
      ) {
        if (target.sessionID !== parent.id) {
          const child = yield* sessions.get(target.sessionID).pipe(Effect.mapError(toToolFailure))
          if (child.controller?.kind !== "child" || child.controller.source.kind !== "task")
            return yield* new ToolFailure({ message: "verification source must belong to an existing Task child" })
          const binding = child.controller.source
          const state = yield* delegations
            .resolve({
              parentSessionID: parent.id,
              agent: context.agent,
              title: input.description,
              delegationID: binding.delegationID,
            })
            .pipe(Effect.mapError(toToolFailure))
          if (state.participants.get(binding.participantID)?.childSessionID !== child.id)
            return yield* new ToolFailure({ message: "verification source child is not the saved participant binding" })
          if (bindParticipant)
            yield* delegations
              .bindParticipant({
                delegationID: binding.delegationID,
                participantID: binding.participantID,
                childSessionID: child.id,
              })
              .pipe(Effect.mapError(toToolFailure))
        }
        const message = yield* sessions.message({
          sessionID: target.sessionID,
          messageID: target.messageID,
        })
        const tool =
          message?.type === "assistant"
            ? message.content.find((part) => part.type === "tool" && part.id === target.id)
            : undefined
        return tool?.type === "tool" ? tool : undefined
      })

      const claims = input.verification.claims
        ? yield* Effect.forEach(input.verification.claims, (item) =>
            Effect.gen(function* () {
              if (!item.source) return VerificationRouter.evaluateClaim({ claim: item.claim })
              const claimSource = new VerificationRouter.Source({
                sessionID: item.source.sessionID ?? parent.id,
                messageID: item.source.messageID,
                id: item.source.id,
              })
              const resolved = yield* resolveOwnedTool(claimSource, false).pipe(Effect.result)
              if (resolved._tag === "Failure")
                return VerificationRouter.evaluateClaim({
                  claim: item.claim,
                  source: claimSource,
                  reason: resolved.failure.message,
                })
              const tool = resolved.success
              const verifierResult =
                tool && tool.state.status === "completed" && ["write", "edit", "patch"].includes(tool.name)
                  ? Schema.decodeUnknownOption(Verifier.Result)(tool.state.metadata?.verification)
                  : Option.none()
              const verifierCurrent = Option.isSome(verifierResult)
                ? yield* Verifier.isCurrent(parent.location.directory, verifierResult.value).pipe(
                    Effect.provideService(FSUtil.Service, files),
                    Effect.catchTag("PlatformError", () => Effect.succeed(false)),
                  )
                : undefined
              return VerificationRouter.evaluateClaim({
                claim: item.claim,
                source: claimSource,
                tool,
                verifierCurrent,
              })
            }),
          )
        : undefined

      if (!selected && input.verification.intent !== "content_creation" && claims !== undefined)
        return verificationResponse(
          yield* router.route({
            history,
            source,
            operation,
            status: "not_dispatched",
            claims,
          }),
          undefined,
          previousResults,
        )

      const loaded = yield* Effect.gen(function* () {
        if (!selected) {
          if (input.verification?.intent !== "content_creation")
            return yield* new ToolFailure({
              message: "verification requires a saved mechanical source or explicit content_creation",
            })
          return {
            mechanical: new Verifier.Result({
              sessionID: parent.id,
              toolName: name,
              source: { type: "tool", messageID: context.messageID, id: context.id },
              status: "unavailable",
              files: [],
              packages: [],
            }),
            mechanicalSource: undefined,
            text: input.prompt,
          }
        }
        const mechanicalSource = selected
        const tool = yield* resolveOwnedTool(mechanicalSource, true)
        if (!tool || !["write", "edit", "patch"].includes(tool.name) || tool.state.status !== "completed")
          return yield* new ToolFailure({
            message: "verification source must locate a saved completed write/edit/patch Tool",
          })
        const decoded = Schema.decodeUnknownOption(Verifier.Result)(tool.state.metadata?.verification)
        if (Option.isNone(decoded))
          return yield* new ToolFailure({ message: "verification source has no structured mechanical result" })
        const mechanical = decoded.value
        if (
          mechanical.sessionID !== mechanicalSource.sessionID ||
          mechanical.toolName !== tool.name ||
          mechanical.source?.type !== "tool" ||
          mechanical.source.messageID !== mechanicalSource.messageID ||
          mechanical.source.id !== mechanicalSource.id
        )
          return yield* new ToolFailure({
            message: "verification mechanical result does not belong to the selected source",
          })
        const associated = history.some(
          (record) =>
            record.mechanicalSource?.sessionID === mechanicalSource.sessionID &&
            record.mechanicalSource.messageID === mechanicalSource.messageID &&
            record.mechanicalSource.id === mechanicalSource.id,
        )
        // L1 binds current file content. An already-associated L2 continuation uses the original revision owner instead.
        if (operation !== "l2" || previous.state.level !== "l2" || !associated) {
          const current = yield* Verifier.isCurrent(parent.location.directory, mechanical).pipe(
            Effect.provideService(FSUtil.Service, files),
            Effect.catchTag("PlatformError", () => Effect.succeed(false)),
          )
          if (!current)
            return yield* new ToolFailure({ message: "verification source is stale for the current file change" })
        }
        const text =
          tool.state.metadata?.truncated === true && typeof tool.state.metadata.outputPath === "string"
            ? yield* files.readFileString(tool.state.metadata.outputPath).pipe(Effect.mapError(toToolFailure))
            : tool.state.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
        return { mechanical, mechanicalSource, text }
      }).pipe(Effect.result)
      if (loaded._tag === "Failure")
        return verificationResponse(
          yield* router.route({
            history,
            source,
            operation,
            status: "unavailable",
            reason: loaded.failure.message,
            ...(claims !== undefined ? { claims } : {}),
          }),
          undefined,
          previousResults,
        )
      const facts = {
        history,
        source,
        operation,
        mechanical: loaded.success.mechanical,
        mechanicalSource: loaded.success.mechanicalSource,
        intent: input.verification.intent,
        ...(claims !== undefined ? { claims } : {}),
      }
      const initial = yield* router.route({ ...facts, status: "not_dispatched" })
      const reason =
        parent.parentID !== undefined ||
        parent.mode !== "work" ||
        parent.agent !== "meta" ||
        context.agent !== "meta" ||
        parent.controller?.kind !== "root"
          ? "Configured verification requires the selected Meta root in Work"
          : !initial.enabled
            ? "Verification escalation is disabled; the actual mechanical result is retained"
            : initial.level === "l0"
              ? "The actual mechanical result does not trigger escalation"
              : operation !== initial.level
                ? `Verification requires an explicit ${initial.level === "l1" ? "Judge Task" : "internal artifact/review/management Task"}`
                : input.workflow !== undefined ||
                    input.workflow_retry !== undefined ||
                    input.execution_type === "external-cli" ||
                    input.background === true
                  ? "Verification uses the existing foreground Judge or internal governance Task"
                  : operation === "l1" &&
                      input.verification.intent !== "content_creation" &&
                      loaded.success.mechanical.status !== "failed"
                    ? "The mechanical check is unavailable or unchecked; it is not a code failure"
                    : undefined
      if (reason)
        return verificationResponse(
          yield* router.route({ ...facts, status: "not_dispatched", reason }),
          undefined,
          previousResults,
        )
      if (operation === "l2" && input.artifact_path === undefined && input.intent !== "review") {
        if (input.delegation_id === undefined || input.command === undefined)
          return verificationResponse(
            yield* router.route({
              ...facts,
              status: "unavailable",
              reason: "L2 requires an existing revision/review delegation or artifact capture",
            }),
            undefined,
            previousResults,
          )
      }
      const updates: Tool.Metadata[] = []
      const retained: (readonly (typeof JudgeWorker.Type)[])[] = []
      const attempted = yield* run(
        {
          ...context,
          progress: (update) => {
            updates.push(update)
            return context.progress({
              ...update,
              verification: Schema.encodeSync(Schema.toCodecJson(VerificationRouter.Settlement))(
                new VerificationRouter.Settlement({ ...initial, status: "running" }),
              ),
            })
          },
        },
        operation === "l1"
          ? `${input.prompt}\nReturn only JSON: {"observations":[{"kind":"contradiction"|"missing_evidence","quote":"exact source text","detail":"reported issue"}]}. Cite a non-empty verbatim quote from verification_source for each observation. An empty array reports no issue and grants no approval.\n<verification_source>\n${loaded.success.text}\n</verification_source>`
          : undefined,
        loaded.success.text,
      ).pipe(
        Effect.onError((cause) =>
          Effect.gen(function* () {
            const completed = Schema.decodeUnknownOption(Schema.Array(JudgeWorker))(
              updates.findLast((update) => update.completedWorkers !== undefined)?.completedWorkers,
            )
            if (Option.isSome(completed)) retained.push(completed.value)
            const status = Cause.hasInterruptsOnly(cause) ? "cancelled" : "failed"
            const settlement = yield* router.route({
              ...facts,
              status,
              observations: Option.isSome(completed)
                ? completed.value.flatMap((worker) => (worker.observation ? [worker.observation] : []))
                : [],
            })
            yield* context.progress({
              ...Object.assign({}, ...updates),
              status,
              verification: Schema.encodeSync(Schema.toCodecJson(VerificationRouter.Settlement))(settlement),
            })
          }),
        ),
        Effect.result,
      )
      if (attempted._tag === "Failure") {
        const workers = retained.at(-1) ?? []
        const response = verificationResponse(
          yield* router.route({
            ...facts,
            status: updates.length > 0 ? "failed" : "unavailable",
            reason: attempted.failure.message,
            observations: workers.flatMap((worker) => (worker.observation ? [worker.observation] : [])),
          }),
          undefined,
          previousResults,
        )
        return {
          ...response,
          ...(workers.length > 0
            ? {
                content: `${response.content}\n<completed_judge_results>${JSON.stringify(Schema.encodeSync(Schema.toCodecJson(Schema.Array(JudgeWorker)))(workers))}</completed_judge_results>`,
              }
            : {}),
          metadata: { ...Object.assign({}, ...updates), ...response.metadata },
        }
      }
      const output = attempted.success.output
      const observations =
        output && "kind" in output && output.kind === "judge"
          ? output.workers.flatMap((worker) => (worker.observation ? [worker.observation] : []))
          : []
      const completion =
        input.command === "complete" && output && "delegationID" in output && output.delegationID
          ? yield* delegations.foldState(output.delegationID).pipe(Effect.mapError(toToolFailure))
          : undefined
      const barrier = completion
        ? {
            participants: [...completion.participants.values()],
            reviews: completion.reviews,
            revisions: completion.revisions,
            latestRevisionDigest: completion.delegation.latestRevisionDigest,
            rejectionBlocked: completion.delegation.rejectionBlocked,
            turns: [...completion.turns.values()],
            deliveries: [...completion.deliveries.values()],
          }
        : undefined
      const completed =
        completion?.delegation.status === "archived" &&
        completion.archivedFrom === "completed" &&
        completion.delegation.completedAt !== undefined &&
        barrier &&
        DelegationReview.canComplete(barrier)
          ? new VerificationRouter.Completion({
              delegationID: completion.delegation.id,
              archivedFrom: "completed",
              canComplete: true,
              ...(completion.delegation.latestRevisionDigest
                ? { revisionDigest: completion.delegation.latestRevisionDigest }
                : {}),
            })
          : undefined
      const quality =
        output &&
        "governance" in output &&
        output.governance &&
        "status" in output.governance &&
        output.governance.status === "invalid"
          ? output.governance.reason
          : undefined
      const settlement = yield* router.route({
        ...facts,
        status:
          quality || (output && "taskSettlement" in output && output.taskSettlement === "conflict")
            ? "failed"
            : output?.status === "completed"
              ? "completed"
              : output?.status === "cancelled"
                ? "cancelled"
                : "failed",
        ...(quality ? { reason: quality } : {}),
        observations,
        completion: completed,
      })
      return verificationResponse(settlement, attempted.success, previousResults)
    })

    const dispatchRoot = Effect.fn("TaskTool.dispatchRoot")(function* (
      input: typeof Input.Type,
      context: Tool.Context,
      target: OperationTarget,
    ) {
      // These fields name other execution routes; accepting them here would silently dispatch different work.
      if (
        input.workflow !== undefined ||
        input.workflow_retry !== undefined ||
        input.subagent_type !== undefined ||
        input.model !== undefined ||
        input.expectedPlanDigest !== undefined ||
        input.execution_type === "external-cli" ||
        input.execution_type === "judge" ||
        input.cli_target !== undefined ||
        input.judge_models !== undefined ||
        input.arbitration_model !== undefined ||
        input.summary !== undefined ||
        input.command !== undefined ||
        input.task_id !== undefined ||
        input.delegation_id !== undefined ||
        input.participant_id !== undefined ||
        input.turn_id !== undefined ||
        input.new_delegation === true ||
        input.verification !== undefined ||
        input.artifact_path !== undefined ||
        input.intent === "review" ||
        input.revision_digest !== undefined ||
        input.attended !== undefined
      )
        return yield* new ToolFailure({
          message:
            "Root target requires root dispatch fields; child, Workflow, Judge, and external controls select other execution routes",
        })
      // This Tool must settle before its Session can promote another input.
      if (
        target.type === "existing_root" &&
        target.sessionID === context.sessionID &&
        input.background !== true &&
        input.resume !== false
      )
        return yield* toToolFailure(
          new ControllerConflictError({
            sessionID: context.sessionID,
            field: "target",
            kind: "coordination_root_required",
            message:
              "Synchronous Task target must be a different root Session; use background: true or resume: false for this Session",
          }),
        )
      const identity = Hash.sha256(Buffer.from(JSON.stringify([context.sessionID, context.messageID, context.id])))
      const admitted = yield* sessions
        .dispatchTask(
          {
            sessionID: context.sessionID,
            request: new OperationRequest({
              operationID: OperationID.make(`top_${identity}`),
              inputID: SessionMessage.ID.make(`msg_${identity}`),
              replacesOperationID: input.replacesOperationID,
              taskID: input.parent_task_id,
              target,
              description: input.description,
              prompt: input.prompt,
              delivery: input.delivery ?? "queue",
              resume: input.resume ?? true,
              background: input.background,
            }),
          },
          {
            source: new OperationToolSource({
              type: "model_tool",
              sessionID: context.sessionID,
              agent: context.agent,
              messageID: context.messageID,
              id: context.id,
            }),
          },
        )
        .pipe(Effect.mapError(toToolFailure))
      const operation =
        input.background || input.resume === false
          ? admitted
          : yield* sessions.waitTaskOperation({ sessionID: context.sessionID, operationID: admitted.operationID }).pipe(
              Effect.onInterrupt(() =>
                sessions
                  .cancelTaskOperation({ sessionID: context.sessionID, operationID: admitted.operationID })
                  .pipe(Effect.orDie),
              ),
              Effect.mapError(toToolFailure),
            )
      const operationRef = new OperationReadonlyRef({
        sourceSessionID: context.sessionID,
        operationID: operation.operationID,
      })
      const metadata = {
        operationRef: Schema.encodeSync(OperationReadonlyRef)(operationRef),
        status: operation.phase,
        sourceSessionID: operation.sourceSessionID,
        targetSessionID: operation.targetSessionID,
        inputID: operation.inputID,
        parentTaskID: operation.taskID,
      }
      yield* context.progress(metadata)
      if (["blocked", "failed", "recovery_required", "superseded", "cancelled"].includes(operation.phase))
        return yield* new ToolFailure({
          message: operation.error?.message ?? `Task operation ${operation.operationID}: ${operation.phase}`,
          error: operation.error,
          metadata,
        })
      const output = {
        kind: "operation" as const,
        operation,
        operationRef,
        status: operation.phase,
        output: operation.result?.text ?? `Task operation ${operation.operationID}: ${operation.phase}.`,
      }
      return { output, content: JSON.stringify(Schema.encodeSync(OperationOutput)(output)), metadata }
    })

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, invocation) =>
            input.target !== undefined
              ? dispatchRoot(input, invocation, input.target)
              : input.delivery !== undefined || input.resume !== undefined || input.replacesOperationID !== undefined
                ? Effect.gen(function* () {
                    return yield* new ToolFailure({
                      message: "delivery, resume, and replacesOperationID require a root target",
                    })
                  })
                : withVerification(input, invocation, (context, verificationPrompt, verificationEvidence) =>
                    Effect.gen(function* () {
                      const parent = yield* sessions.get(context.sessionID).pipe(Effect.mapError(toToolFailure))
                      if (parent.parentID !== undefined || parent.controller?.kind === "child")
                        return yield* new ToolFailure({
                          message: "Task tool cannot be used in child sessions (prevents recursive delegation)",
                        })
                      const decoded = Schema.decodeUnknownOption(Locators)(input)
                      if (Option.isNone(decoded))
                        return yield* new ToolFailure({
                          message: "Invalid task_id, delegation_id, participant_id, or turn_id",
                        })
                      const locators = decoded.value
                      const source = { type: "tool" as const, messageID: context.messageID, id: context.id }
                      if (
                        input.execution_type !== "judge" &&
                        (input.arbitration_model !== undefined || input.summary !== undefined)
                      )
                        return yield* new ToolFailure({ message: "arbitration_model and summary require judge" })
                      if (input.workflow !== undefined || input.workflow_retry !== undefined) {
                        if (
                          parent.mode !== "work" ||
                          parent.agent !== "meta" ||
                          context.agent !== "meta" ||
                          parent.controller?.kind !== "root"
                        )
                          return yield* new ToolFailure({ message: "Workflow Task requires the selected Meta in Work" })
                        if (
                          input.background === true ||
                          input.attended === true ||
                          input.execution_type === "external-cli" ||
                          input.execution_type === "judge" ||
                          input.command !== undefined ||
                          locators.task_id !== undefined ||
                          locators.delegation_id !== undefined ||
                          locators.participant_id !== undefined ||
                          locators.turn_id !== undefined ||
                          input.new_delegation === true ||
                          input.artifact_path !== undefined ||
                          input.intent === "review" ||
                          input.revision_digest !== undefined ||
                          input.cli_target !== undefined ||
                          input.judge_models !== undefined ||
                          input.model !== undefined
                        )
                          return yield* new ToolFailure({
                            message: "Workflow Task uses foreground execution and its frozen composition",
                          })
                        yield* permission
                          .assert({
                            action: name,
                            resources: [
                              input.workflow?.source === "profile"
                                ? input.workflow.profilePath
                                : (input.workflow?.workflow?.relativePath ?? input.workflow_retry?.runID ?? "workflow"),
                            ],
                            save: ["*"],
                            sessionID: parent.id,
                            agent: context.agent,
                            source,
                          })
                          .pipe(Effect.mapError(toToolFailure))
                        const result = yield* workflows
                          .task({
                            sessionID: parent.id,
                            agent: context.agent,
                            source,
                            composition: input.workflow,
                            retry: input.workflow_retry,
                            expectedPlanDigest: input.expectedPlanDigest,
                            description: input.description,
                            parentTaskID: input.parent_task_id,
                            onAdmitted: (admitted) =>
                              context.progress({
                                sessionID: parent.id,
                                workflowRunID: admitted.runID,
                                parentTaskID: admitted.parentTaskID,
                                parentTaskRevision: admitted.parentTaskRevision,
                                source,
                                status: "running",
                              }),
                          })
                          .pipe(Effect.mapError(toToolFailure))
                        const status = result.run.status === "partial_success" ? "completed" : result.run.status
                        if (status === "pending" || status === "cancelling")
                          return yield* new ToolFailure({ message: "Workflow Task did not reach a terminal result" })
                        return {
                          output: {
                            sessionID: parent.id,
                            parentTaskID: result.parentTaskID,
                            status,
                            output: result.text,
                          },
                          content: result.text,
                          metadata: {
                            sessionID: parent.id,
                            workflowRunID: result.run.id,
                            parentTaskID: result.parentTaskID,
                            parentTaskRevision: result.parentTaskRevision,
                            status: result.run.status,
                          },
                        }
                      }
                      if (input.subagent_type === undefined)
                        return yield* new ToolFailure({ message: "Task requires subagent_type or workflow" })
                      if (input.expectedPlanDigest !== undefined)
                        return yield* new ToolFailure({ message: "expectedPlanDigest requires workflow" })
                      if (input.execution_type === "judge") {
                        if (
                          parent.mode !== "work" ||
                          parent.agent !== "meta" ||
                          context.agent !== "meta" ||
                          parent.controller?.kind !== "root"
                        )
                          return yield* new ToolFailure({ message: "Judge Task requires the selected Meta in Work" })
                        if (
                          input.background === true ||
                          input.attended === true ||
                          input.model !== undefined ||
                          input.cli_target !== undefined ||
                          input.command !== undefined ||
                          locators.task_id !== undefined ||
                          locators.delegation_id !== undefined ||
                          locators.participant_id !== undefined ||
                          locators.turn_id !== undefined ||
                          input.artifact_path !== undefined ||
                          input.intent === "review" ||
                          input.revision_digest !== undefined
                        )
                          return yield* new ToolFailure({
                            message: "Judge Task uses fresh foreground workers and judge_models",
                          })
                        if (input.judge_models === undefined || input.judge_models.length < 2)
                          return yield* new ToolFailure({
                            message: "Judge Task requires at least two explicit judge_models",
                          })
                        const agent = yield* agents.resolve(input.subagent_type)
                        if (agent === undefined || agent.mode === "primary")
                          return yield* new ToolFailure({ message: `Unknown subagent type: ${input.subagent_type}` })
                        yield* Agent.assertOrdinaryMode(agent, parent.mode).pipe(Effect.mapError(toToolFailure))
                        if (input.attended ?? agent.attended ?? attendedDefault ?? false)
                          return yield* new ToolFailure({ message: "Attended task execution is not available" })
                        const linked = input.parent_task_id
                          ? (yield* tasks.get(parent.id)).find((task) => task.id === input.parent_task_id)
                          : undefined
                        if (input.parent_task_id !== undefined && !linked)
                          return yield* new ToolFailure({
                            message: `Parent task ${input.parent_task_id} does not belong to this session`,
                          })
                        if (linked?.status === "scheduled")
                          return yield* new ToolFailure({
                            message: "A scheduled parent task cannot be delegated while its schedule owns execution",
                          })
                        const available = yield* models.available()
                        const selected = yield* Effect.forEach(input.judge_models, (value) =>
                          Effect.gen(function* () {
                            const requested = yield* Effect.try({
                              try: () => Model.Ref.parse(value),
                              catch: () => new ToolFailure({ message: `Invalid model reference: ${value}` }),
                            })
                            const model = available.find(
                              (model) => model.id === requested.id && model.providerID === requested.providerID,
                            )
                            if (!model)
                              return yield* new ControllerConflictError({
                                sessionID: parent.id,
                                field: "model",
                                kind: "executor_model_unavailable",
                                message: `Executor model is unavailable: ${value}`,
                              })
                            const resolved = yield* resolver.resolveModel(model, requested.variant)
                            return {
                              requested,
                              executor: new ExecutorBinding({ agent: agent.id, model: resolved.ref, source: "tool" }),
                              runtime: {
                                provider: resolved.model.provider,
                                id: resolved.model.id,
                                route: resolved.model.route.id,
                              },
                            }
                          }).pipe(Effect.mapError(toToolFailure)),
                        )
                        if (
                          new Set(
                            selected.map((worker) => JSON.stringify([worker.runtime.provider, worker.runtime.id])),
                          ).size !== selected.length
                        )
                          return yield* new ToolFailure({
                            message: "Judge Task requires distinct actual provider/API models",
                          })
                        yield* permission
                          .assert({
                            action: name,
                            resources: [input.subagent_type],
                            save: ["*"],
                            sessionID: parent.id,
                            agent: context.agent,
                            source,
                          })
                          .pipe(Effect.mapError(toToolFailure))
                        const parentTask = linked
                          ? yield* tasks
                              .patch(
                                {
                                  sessionID: parent.id,
                                  id: linked.id,
                                  status: "in_progress",
                                  expectedRevision: linked.revision,
                                  expect: ["pending", "in_progress", "completed", "failed", "cancelled"],
                                },
                                { claim: source },
                              )
                              .pipe(Effect.mapError(toToolFailure))
                          : (yield* tasks
                              .append(
                                {
                                  sessionID: parent.id,
                                  tasks: [{ content: input.description, status: "in_progress", priority: "medium" }],
                                },
                                { claim: source },
                              )
                              .pipe(Effect.mapError(toToolFailure))).at(-1)
                        if (!parentTask)
                          return yield* new ToolFailure({ message: "Parent task is no longer available for execution" })
                        const prompt = verificationPrompt ?? input.prompt
                        const workerTasks: SessionTask.Info[] = []
                        const completedWorkers: (typeof JudgeWorker.Type)[] = []
                        const recoveryRequired = new Set<string>()
                        const owned = new Set<DelegationID.ID>()
                        const settled = new Set<DelegationID.ID>()
                        return yield* Effect.gen(function* () {
                          yield* context.progress({
                            sessionID: parent.id,
                            parentTaskID: parentTask.id,
                            parentTaskRevision: parentTask.revision,
                            source,
                            status: "running",
                          })
                          const retainWorker = Effect.fnUntraced(function* (result: typeof JudgeWorker.Type) {
                            if (!input.verification) return result
                            const worker = {
                              ...result,
                              observation: judgeObservation(result, verificationEvidence ?? input.prompt),
                            }
                            completedWorkers.push(worker)
                            yield* context.progress({
                              sessionID: parent.id,
                              parentTaskID: parentTask.id,
                              source,
                              status: "running",
                              completedWorkers: Schema.encodeSync(Schema.toCodecJson(Schema.Array(JudgeWorker)))(
                                completedWorkers,
                              ),
                            })
                            return worker
                          })
                          const prepareWorker = Effect.fnUntraced(function* (
                            worker: Pick<typeof JudgeWorker.Type, "requested" | "executor">,
                            description: string,
                          ) {
                            const task = (yield* tasks.append(
                              {
                                sessionID: parent.id,
                                tasks: [
                                  {
                                    content: `${description}: ${Model.Selection.isGroup(worker.requested) ? `group:${worker.requested.groupID}` : `${worker.requested.providerID}/${worker.requested.id}`}`,
                                    status: "in_progress",
                                    priority: "medium",
                                    parentID: parentTask.id,
                                  },
                                ],
                              },
                              { claim: source },
                            )).at(-1)
                            if (!task) return yield* new ToolFailure({ message: "Judge worker Task is unavailable" })
                            workerTasks.push(task)
                            const state = yield* delegations.resolve({
                              parentSessionID: parent.id,
                              agent: context.agent,
                              title: description,
                              newDelegation: true,
                            })
                            owned.add(state.delegation.id)
                            const participant = yield* delegations.addParticipant({
                              delegationID: state.delegation.id,
                              provider: "internal",
                              target: agent.id,
                              role: "reviewer",
                              context: "fresh",
                              executor: worker.executor,
                            })
                            if (!participant.executor)
                              return yield* new ToolFailure({ message: "Judge worker has no saved executor binding" })
                            const turn = yield* delegations.appendTurn({
                              delegationID: state.delegation.id,
                              kind: "task",
                              promptSummary: description,
                              participantIDs: [participant.id],
                              delivery: "steer",
                              origin: { deliveryOrigin: "meta", senderParticipantID: participant.id },
                            })
                            return {
                              ...worker,
                              executor: participant.executor,
                              task,
                              description,
                              delegationID: state.delegation.id,
                              participantID: participant.id,
                              turnID: turn.id,
                            }
                          })
                          const dispatchWorker = Effect.fnUntraced(function* (
                            worker: Effect.Success<ReturnType<typeof prepareWorker>>,
                            text: string,
                          ) {
                            const admission = yield* execution
                              .dispatch({
                                delegationID: worker.delegationID,
                                turnID: worker.turnID,
                                prompt: text,
                                task: {
                                  parentTaskID: worker.task.id,
                                  parentTaskRevision: worker.task.revision,
                                  description: worker.description,
                                  background: false,
                                  source,
                                },
                              })
                              .pipe(
                                Effect.match({
                                  onSuccess: (receipts) => ({
                                    receipt: receipts.find(
                                      (receipt) =>
                                        receipt.participantID === worker.participantID &&
                                        receipt.turnID === worker.turnID &&
                                        receipt.deliveryOrigin === "meta" &&
                                        receipt.senderParticipantID === worker.participantID,
                                    ),
                                    error: undefined,
                                  }),
                                  onFailure: (error) => ({ receipt: undefined, error: error.message }),
                                }),
                              )
                            if (!admission.receipt) {
                              const text = admission.error ?? "Task execution did not return a delivery receipt"
                              yield* execution.close({ delegationID: worker.delegationID, reason: text })
                              yield* tasks.patch(
                                {
                                  sessionID: parent.id,
                                  id: worker.task.id,
                                  expectedRevision: worker.task.revision,
                                  expect: ["in_progress"],
                                  status: "failed",
                                  outputDigest: text,
                                },
                                { settle: { source, revision: worker.task.revision } },
                              )
                              settled.add(worker.delegationID)
                            }
                            return { ...worker, ...admission }
                          })
                          const readWorker = Effect.fnUntraced(function* (
                            worker: Effect.Success<ReturnType<typeof dispatchWorker>>,
                          ): Effect.fn.Return<
                            typeof JudgeWorker.Type,
                            Session.MessageDecodeError | DelegationService.ServiceError
                          > {
                            const identity = {
                              taskID: worker.task.id,
                              source,
                              requested: worker.requested,
                              executor: worker.executor,
                              delegationID: worker.delegationID,
                              participantID: worker.participantID,
                              turnID: worker.turnID,
                            }
                            if (!worker.receipt)
                              return yield* retainWorker({
                                ...identity,
                                status: "failed",
                                text: worker.error ?? "Task execution did not return a delivery receipt",
                              })
                            const result = yield* execution.wait(worker.receipt)
                            if (result.status === "recovery_required") recoveryRequired.add(worker.task.id)
                            const completed = yield* SessionInputResult.read(database.db, {
                              sessionID: worker.receipt.childSessionID,
                              inputID: worker.receipt.inputID,
                            })
                            const membership =
                              completed.status === "completed"
                                ? undefined
                                : yield* database.db
                                    .select({
                                      joined: SessionInputResultTable.joined_event_seq,
                                      terminal: SessionInputResultTable.terminal_event_seq,
                                    })
                                    .from(SessionInputResultTable)
                                    .where(
                                      and(
                                        eq(SessionInputResultTable.session_id, worker.receipt.childSessionID),
                                        eq(SessionInputResultTable.input_id, worker.receipt.inputID),
                                      ),
                                    )
                                    .get()
                                    .pipe(Effect.orDie)
                            const assistant =
                              completed.status === "completed"
                                ? completed.assistant
                                : membership
                                  ? (yield* SessionHistory.load(
                                      database.db,
                                      worker.receipt.childSessionID,
                                      "local",
                                    )).findLast(
                                      (message) =>
                                        message.type === "assistant" &&
                                        message.origin?.kind === "step" &&
                                        message.origin.seq >= membership.joined &&
                                        (membership.terminal === null || message.origin.seq <= membership.terminal),
                                    )
                                  : undefined
                            const attempt = assistant?.type === "assistant" ? assistant.attempts?.at(-1) : undefined
                            const deployment =
                              attempt?.observations.findLast((observation) => observation.deployment !== undefined)
                                ?.deployment ?? attempt?.preparedDeployment
                            settled.add(worker.delegationID)
                            return yield* retainWorker({
                              ...identity,
                              ...(attempt && deployment
                                ? {
                                    runtime: {
                                      provider: deployment.provider,
                                      id: attempt.apiModelID,
                                      route: deployment.route,
                                    },
                                  }
                                : {}),
                              receipt: new Delegation.Receipt(worker.receipt),
                              status: result.status,
                              text:
                                completed.status === "completed" &&
                                !completed.assistant.content.some(
                                  (part) => part.type === "text" && part.text.length > 0,
                                )
                                  ? ""
                                  : result.text,
                              ...(completed.status === "completed"
                                ? {
                                    completion: {
                                      assistantID: completed.assistant.id,
                                      model: completed.assistant.model,
                                      finish: completed.assistant.finish,
                                      rawFinish: completed.assistant.rawFinish,
                                      needsContinuation: completed.assistant.needsContinuation,
                                    },
                                  }
                                : {}),
                            })
                          })
                          // Prepare every original identity before any child input is admitted.
                          const prepared = yield* Effect.forEach(selected, (worker) =>
                            prepareWorker(worker, input.description),
                          )
                          const dispatched = yield* Effect.forEach(prepared, (worker) => dispatchWorker(worker, prompt))
                          yield* context.progress({
                            sessionID: parent.id,
                            parentTaskID: parentTask.id,
                            source,
                            status: "running",
                            workers: dispatched.map((worker) => ({
                              taskID: worker.task.id,
                              delegationID: worker.delegationID,
                              participantID: worker.participantID,
                              turnID: worker.turnID,
                              ...(worker.receipt ? { receipt: worker.receipt } : {}),
                            })),
                          })
                          const workers = yield* Effect.forEach(dispatched, readWorker, { concurrency: "unbounded" })
                          const status: typeof Status.Type = workers.every((worker) => worker.status === "completed")
                            ? "completed"
                            : workers.some((worker) => worker.status === "recovery_required")
                              ? "recovery_required"
                              : workers.some((worker) => worker.status === "failed")
                                ? "failed"
                                : "cancelled"
                          const evidence = JSON.stringify({
                            sessionID: parent.id,
                            parentTaskID: parentTask.id,
                            source,
                            input: { text: prompt },
                            status,
                            workers: Schema.encodeSync(Schema.toCodecJson(Schema.Array(JudgeWorker)))(workers),
                          })
                          const enhance = Effect.fnUntraced(function* (
                            kind: "arbitration" | "summary",
                            text: string,
                            requested?: Model.Ref,
                          ) {
                            const selection = yield* Effect.gen(function* () {
                              const executor = yield* Session.resolveExecutor(parent, agent, requested).pipe(
                                Effect.provideService(Model.Service, models),
                                Effect.provideService(ModelResolver.Service, resolver),
                                Effect.provideService(Config.Service, config),
                                Effect.provideService(SessionComposition.Service, compositions),
                                Effect.provideService(Service, plugins),
                              )
                              return {
                                requested: requested ?? executor.model,
                                executor,
                              }
                            }).pipe(Effect.result)
                            if (selection._tag === "Failure")
                              return new JudgeEnhancement({
                                ...(requested ? { requested } : {}),
                                status: "unavailable",
                                error: selection.failure.message,
                              })
                            const prepared = yield* prepareWorker(selection.success, `${input.description}: ${kind}`)
                            const dispatched = yield* dispatchWorker(prepared, text)
                            yield* context.progress({
                              sessionID: parent.id,
                              parentTaskID: parentTask.id,
                              source,
                              enhancement: kind,
                              taskID: prepared.task.id,
                              ...(dispatched.receipt
                                ? {
                                    receipt: Schema.encodeSync(Schema.toCodecJson(Delegation.Receipt))(
                                      new Delegation.Receipt(dispatched.receipt),
                                    ),
                                  }
                                : {}),
                            })
                            const result = yield* readWorker(dispatched)
                            return new JudgeEnhancement({
                              ...(requested ? { requested } : {}),
                              status:
                                result.status !== "completed"
                                  ? result.status
                                  : result.text.trim().length === 0
                                    ? "empty"
                                    : result.completion?.finish !== "stop" ||
                                        result.completion?.needsContinuation !== false
                                      ? "partial"
                                      : "completed",
                              result,
                            })
                          })
                          const arbitration =
                            input.arbitration_model === undefined
                              ? ("none" as const)
                              : yield* enhance(
                                  "arbitration",
                                  `Arbitrate the complete Judge evidence. Preserve its quality and sources.\n<judge_result>\n${evidence}\n</judge_result>`,
                                  input.arbitration_model,
                                )
                          const summary =
                            input.summary === undefined
                              ? undefined
                              : yield* enhance(
                                  "summary",
                                  `Summarize the complete Judge evidence and actual arbitration. Preserve incomplete or failed outcomes and sources.\n<judge_result>\n${evidence}\n</judge_result>\n<arbitration_result>\n${arbitration === "none" ? "none" : JSON.stringify(Schema.encodeSync(Schema.toCodecJson(JudgeEnhancement))(arbitration))}\n</arbitration_result>`,
                                  input.summary.model,
                                )
                          const updated = yield* tasks.patch(
                            {
                              sessionID: parent.id,
                              id: parentTask.id,
                              expectedRevision: parentTask.revision,
                              expect: ["in_progress"],
                              status: status === "recovery_required" ? "failed" : status,
                              outputDigest: workers
                                .map(
                                  (worker) =>
                                    `${worker.runtime ? `${worker.runtime.provider}/${worker.runtime.id}` : Model.Selection.isGroup(worker.requested) ? `group:${worker.requested.groupID}` : `${worker.requested.providerID}/${worker.requested.id}`}: ${worker.status}`,
                                )
                                .join("\n"),
                            },
                            recoveryRequired.size === 0
                              ? { settle: { source, revision: parentTask.revision } }
                              : undefined,
                          )
                          const output = {
                            kind: "judge" as const,
                            sessionID: parent.id,
                            parentTaskID: parentTask.id,
                            source,
                            input: { text: prompt },
                            arbitration,
                            ...(summary ? { summary } : {}),
                            status,
                            taskSettlement: updated ? ("updated" as const) : ("conflict" as const),
                            workers,
                          }
                          return {
                            output,
                            content: JSON.stringify(Schema.encodeSync(Schema.toCodecJson(JudgeOutput))(output)),
                            metadata: {
                              sessionID: parent.id,
                              parentTaskID: parentTask.id,
                              parentTaskRevision: parentTask.revision,
                              source,
                              status,
                              taskSettlement: output.taskSettlement,
                              arbitration:
                                arbitration === "none"
                                  ? "none"
                                  : Schema.encodeSync(Schema.toCodecJson(JudgeEnhancement))(arbitration),
                              ...(summary
                                ? { summary: Schema.encodeSync(Schema.toCodecJson(JudgeEnhancement))(summary) }
                                : {}),
                              workers: workers.map((worker) => ({
                                taskID: worker.taskID,
                                ...(worker.receipt
                                  ? {
                                      receipt: Schema.encodeSync(Schema.toCodecJson(Delegation.Receipt))(
                                        worker.receipt,
                                      ),
                                    }
                                  : {}),
                                status: worker.status,
                              })),
                            },
                          }
                        }).pipe(
                          Effect.onError((cause) =>
                            Effect.gen(function* () {
                              const status = Cause.hasInterruptsOnly(cause) ? "cancelled" : "failed"
                              yield* Effect.forEach(
                                [...owned].filter((id) => !settled.has(id)),
                                (delegationID) => execution.close({ delegationID, reason: `Judge Task ${status}` }),
                                { discard: true },
                              )
                              yield* Effect.forEach(
                                [...workerTasks, parentTask],
                                (task) =>
                                  tasks.patch(
                                    {
                                      sessionID: parent.id,
                                      id: task.id,
                                      expectedRevision: task.revision,
                                      expect: ["in_progress"],
                                      status,
                                    },
                                    recoveryRequired.has(task.id) ||
                                      (task.id === parentTask.id && recoveryRequired.size > 0)
                                      ? undefined
                                      : { settle: { source, revision: task.revision } },
                                  ),
                                { discard: true },
                              )
                            }).pipe(Effect.orDie),
                          ),
                          Effect.mapError(toToolFailure),
                        )
                      }
                      if (
                        (input.artifact_path !== undefined ||
                          input.intent === "review" ||
                          input.revision_digest !== undefined) &&
                        ((input.execution_type !== undefined && input.execution_type !== "subagent") ||
                          (input.command !== undefined && input.command !== "append")) &&
                        !(
                          input.intent === "review" &&
                          input.execution_type === "external-cli" &&
                          (input.command === undefined || input.command === "append")
                        )
                      )
                        return yield* new ToolFailure({
                          message: "Artifact and review governance require an internal foreground Task",
                        })
                      if (
                        input.intent === "review" &&
                        (input.artifact_path !== undefined ||
                          input.revision_digest === undefined ||
                          locators.delegation_id === undefined)
                      )
                        return yield* new ToolFailure({
                          message: "Review requires an existing delegation and revision_digest",
                        })
                      if (input.revision_digest !== undefined && input.intent !== "review")
                        return yield* new ToolFailure({ message: "revision_digest requires review intent" })
                      if (
                        input.intent === "review" &&
                        input.execution_type === "external-cli" &&
                        (input.background === true || input.attended !== false)
                      )
                        return yield* new ToolFailure({
                          message: "External review requires foreground execution and attended: false",
                        })

                      if (input.command !== undefined && input.command !== "append" && input.command !== "steer") {
                        if (locators.delegation_id === undefined)
                          return yield* new ToolFailure({ message: "delegation_id is required for command" })
                        const state = yield* delegations
                          .resolve({
                            parentSessionID: parent.id,
                            agent: context.agent,
                            title: input.description,
                            delegationID: locators.delegation_id,
                          })
                          .pipe(Effect.mapError(toToolFailure))
                        if (locators.participant_id !== undefined && !state.participants.has(locators.participant_id))
                          return yield* new ToolFailure({
                            message: "participant_id does not belong to this delegation",
                          })
                        if (
                          [...state.participants.values()].some((participant) => participant.provider === "codex") &&
                          input.command !== "interrupt" &&
                          input.command !== "close" &&
                          input.command !== "complete" &&
                          input.command !== "archive" &&
                          input.command !== "retract_rejection"
                        )
                          return yield* new ToolFailure({
                            message:
                              "This external execution slice supports only interrupt and close management commands",
                          })
                        if (input.command === "retry") {
                          if (locators.participant_id === undefined || locators.turn_id === undefined)
                            return yield* new ToolFailure({ message: "retry requires participant_id and turn_id" })
                          if (!state.turns.get(locators.turn_id)?.participantIDs.includes(locators.participant_id))
                            return yield* new ToolFailure({
                              message: "turn_id does not target the requested participant",
                            })
                        }
                        if (input.command === "interrupt" && locators.turn_id !== undefined) {
                          if (locators.participant_id === undefined)
                            return yield* new ToolFailure({
                              message: "Targeted interrupt requires participant_id and turn_id",
                            })
                          if (!state.turns.get(locators.turn_id)?.participantIDs.includes(locators.participant_id))
                            return yield* new ToolFailure({
                              message: "turn_id does not target the requested participant",
                            })
                        }
                        yield* permission
                          .assert({
                            action: commandPermissions[input.command],
                            resources: [state.delegation.id],
                            sessionID: parent.id,
                            agent: context.agent,
                            source,
                          })
                          .pipe(Effect.mapError(toToolFailure))
                        if (input.command === "complete")
                          yield* permission
                            .assert({
                              action: "task_archive",
                              resources: [state.delegation.id],
                              sessionID: parent.id,
                              agent: context.agent,
                              source,
                            })
                            .pipe(Effect.mapError(toToolFailure))
                        const resultID = yield* Effect.gen(function* () {
                          switch (input.command) {
                            case "interrupt":
                              yield* execution.interrupt({
                                delegationID: state.delegation.id,
                                participantID: locators.participant_id,
                                turnID: locators.turn_id,
                              })
                              break
                            case "close":
                              yield* execution.close({ delegationID: state.delegation.id, reason: input.prompt })
                              break
                            case "complete":
                              yield* execution.close({ delegationID: state.delegation.id, requireComplete: true })
                              yield* delegations.complete({
                                delegationID: state.delegation.id,
                                summary: input.prompt,
                                source,
                              })
                              break
                            case "retry": {
                              if (locators.participant_id === undefined || locators.turn_id === undefined)
                                return yield* new ToolFailure({ message: "retry requires participant_id and turn_id" })
                              yield* execution.retry({
                                delegationID: state.delegation.id,
                                participantID: locators.participant_id,
                                turnID: locators.turn_id,
                              })
                              break
                            }
                            case "reconcile":
                              yield* delegations.reconcile({ delegationID: state.delegation.id })
                              break
                            case "retract_rejection":
                              yield* delegations.retractRejection({
                                delegationID: state.delegation.id,
                                participantID: locators.participant_id,
                                reason: input.prompt,
                              })
                              break
                            case "archive":
                              yield* delegations.archive({ delegationID: state.delegation.id, source })
                              break
                            case "unarchive":
                              yield* delegations.unarchive({ delegationID: state.delegation.id })
                              break
                            case "fork":
                              return (yield* delegations.fork({
                                delegationID: state.delegation.id,
                                reason: input.prompt,
                              })).delegation.id
                            case "purge":
                              yield* execution.close({ delegationID: state.delegation.id, reason: input.prompt })
                              yield* delegations.delete({ delegationID: state.delegation.id, purge: true })
                              break
                          }
                          return state.delegation.id
                        }).pipe(Effect.mapError(toToolFailure))
                        if (input.command === "complete") {
                          const completed = yield* delegations.foldState(resultID).pipe(Effect.mapError(toToolFailure))
                          if (
                            completed?.delegation.status !== "archived" ||
                            completed.archivedFrom !== "completed" ||
                            completed.delegation.completedAt === undefined
                          )
                            return yield* new ToolFailure({
                              message: "Delegation completion has no verified completed archive",
                            })
                          const barrier = {
                            participants: [...completed.participants.values()],
                            reviews: completed.reviews,
                            revisions: completed.revisions,
                            latestRevisionDigest: completed.delegation.latestRevisionDigest,
                            rejectionBlocked: completed.delegation.rejectionBlocked,
                            turns: [...completed.turns.values()],
                            deliveries: [...completed.deliveries.values()],
                          }
                          const canComplete = DelegationReview.canComplete(barrier)
                          return response({
                            sessionID: parent.id,
                            delegationID: resultID,
                            status: "completed",
                            text: JSON.stringify({
                              command: input.command,
                              source,
                              delegation: Schema.encodeSync(Schema.toCodecJson(Delegation.Info))(completed.delegation),
                              archivedFrom: completed.archivedFrom,
                              latestRevisionDigest: completed.delegation.latestRevisionDigest,
                              reviewBarrier: DelegationReview.evaluateReviewBarrier(barrier),
                              canComplete,
                            }),
                          })
                        }
                        return response({
                          sessionID: parent.id,
                          delegationID: resultID,
                          status: "completed",
                          text: `${input.command} accepted`,
                        })
                      }

                      if (input.execution_type === "external-cli") {
                        if (
                          (input.cli_target !== "codex" && input.cli_target !== "claude-code") ||
                          input.subagent_type !== input.cli_target ||
                          input.model ||
                          input.judge_models ||
                          locators.task_id ||
                          locators.turn_id ||
                          parent.mode === "custom"
                        )
                          return yield* new ToolFailure({
                            message:
                              "External execution requires a configured CLI transport with its matching subagent, no internal child ID/model override, and a non-Custom parent",
                          })
                        const target = input.cli_target
                        const steer = input.command === "steer"
                        const external = steer
                          ? { operation: "steer" as const, agent: context.agent }
                          : {
                              operation: "execute" as const,
                              agent: context.agent,
                              adapter: yield* Effect.gen(function* () {
                                const entries = yield* config.entries()
                                if (Config.latest(entries, "cli_agents")?.[target]?.transport === "jsonl") {
                                  const { ClaudeCodeAdapter } = yield* Effect.promise(() => import("../claude-code.js"))
                                  return yield* CliAdapter.resolve(entries, target, {
                                    "claude-code": { jsonl: ClaudeCodeAdapter.adapter },
                                  })
                                }
                                if (Config.latest(entries, "cli_agents")?.[target]?.transport !== "acp")
                                  return yield* CliAdapter.resolve(entries, target)
                                const { ClaudeCodeAcpAdapter } = yield* Effect.promise(
                                  () => import("../claude-code-acp.js"),
                                )
                                return yield* CliAdapter.resolve(entries, target, {
                                  "claude-code": { acp: ClaudeCodeAcpAdapter.adapter },
                                })
                              }).pipe(Effect.mapError(toToolFailure)),
                            }
                        const sdk = external.operation === "execute" && external.adapter.transport === "sdk"
                        const acp = external.operation === "execute" && external.adapter.transport === "acp"
                        const jsonl = external.operation === "execute" && external.adapter.transport === "jsonl"
                        if (
                          (acp || jsonl) &&
                          (input.background === true || input.intent === "review" || input.command === "steer")
                        )
                          return yield* toToolFailure(
                            new CliAdapter.UnavailableError({
                              target: input.cli_target,
                              reason: `${acp ? "ACP" : "JSONL"} supports foreground new/append Tasks without background, active steer or review`,
                            }),
                          )
                        const background = input.background === true && backgroundEnabled()
                        if (
                          steer &&
                          (background ||
                            locators.delegation_id === undefined ||
                            locators.participant_id === undefined ||
                            input.new_delegation === true)
                        )
                          return yield* new ToolFailure({
                            message:
                              "External steer requires foreground execution and explicit existing delegation_id and participant_id",
                          })
                        if (steer && input.attended !== undefined)
                          return yield* new ToolFailure({
                            message:
                              "External steer inherits the original Job's approval scope; attended cannot be changed",
                          })
                        const selected = locators.delegation_id
                          ? yield* delegations
                              .resolve({
                                parentSessionID: parent.id,
                                agent: context.agent,
                                title: input.description,
                                delegationID: locators.delegation_id,
                              })
                              .pipe(Effect.mapError(toToolFailure))
                          : input.new_delegation
                            ? undefined
                            : yield* delegations
                                .resolveActive(parent.id, context.agent)
                                .pipe(Effect.mapError(toToolFailure))
                        const role = input.intent === "review" ? "reviewer" : "implementer"
                        const review =
                          input.intent === "review" && selected && input.revision_digest
                            ? yield* delegations
                                .revision({
                                  delegationID: selected.delegation.id,
                                  revisionDigest: input.revision_digest,
                                })
                                .pipe(Effect.mapError(toToolFailure))
                            : undefined
                        const routed = locators.participant_id
                          ? selected?.participants.get(locators.participant_id)
                          : selected &&
                            [...selected.participants.values()].find(
                              (participant) =>
                                participant.provider === input.cli_target &&
                                participant.target === input.cli_target &&
                                participant.role === role,
                            )
                        if (locators.participant_id && !routed)
                          return yield* new ToolFailure({
                            message: "participant_id does not belong to the selected delegation",
                          })
                        if (
                          selected &&
                          ["closing", "completed", "cancelled", "archived"].includes(selected.delegation.status)
                        )
                          return yield* new ToolFailure({ message: "The selected delegation cannot accept a task" })
                        if (
                          routed &&
                          (routed.provider !== input.cli_target ||
                            routed.target !== input.cli_target ||
                            routed.role !== role ||
                            routed.phase === "closed" ||
                            routed.phase === "failed")
                        )
                          return yield* new ToolFailure({
                            message: "The selected external participant cannot accept new work",
                          })
                        const busy =
                          routed !== undefined &&
                          selected !== undefined &&
                          [...selected.deliveries.values()].some(
                            (delivery) =>
                              delivery.participantID === routed.id &&
                              !["completed", "failed", "cancelled"].includes(delivery.status),
                          )
                        const queued =
                          !steer &&
                          background &&
                          busy &&
                          (sdk || routed?.externalThreadID !== undefined) &&
                          (input.command === undefined || input.command === "append")
                        if (!steer && busy && !queued)
                          return yield* new ToolFailure({
                            message: "External participant has active or unresolved work",
                          })
                        const steerClaim = steer
                          ? yield* Effect.gen(function* () {
                              if (!selected || !routed)
                                return yield* new ToolFailure({
                                  message: "External steer requires its existing delegation and participant",
                                })
                              return yield* execution
                                .preflightExternalSteer({
                                  delegationID: selected.delegation.id,
                                  participantID: routed.id,
                                  parentSessionID: parent.id,
                                  agent: context.agent,
                                })
                                .pipe(Effect.mapError(toToolFailure))
                            })
                          : undefined
                        const linked = input.parent_task_id
                          ? (yield* tasks.get(parent.id)).find((task) => task.id === input.parent_task_id)
                          : undefined
                        if (input.parent_task_id && (!linked || linked.status === "scheduled"))
                          return yield* new ToolFailure({ message: "An owned, unscheduled parent task is required" })
                        yield* permission
                          .assert({
                            action: name,
                            resources: [input.cli_target],
                            sessionID: parent.id,
                            agent: context.agent,
                            source,
                          })
                          .pipe(Effect.mapError(toToolFailure))
                        if (review)
                          yield* access.authorizeRead(review.path, context).pipe(Effect.mapError(toToolFailure))
                        const state =
                          selected ??
                          (yield* delegations
                            .resolve({
                              parentSessionID: parent.id,
                              agent: context.agent,
                              title: input.description,
                              newDelegation: input.new_delegation,
                            })
                            .pipe(Effect.mapError(toToolFailure)))
                        const participant =
                          routed ??
                          (yield* delegations
                            .addParticipant({
                              delegationID: state.delegation.id,
                              provider: input.cli_target,
                              target: input.cli_target,
                              role,
                              context: "fresh",
                            })
                            .pipe(Effect.mapError(toToolFailure)))
                        const parentTask = linked
                          ? yield* tasks
                              .patch(
                                {
                                  sessionID: parent.id,
                                  id: linked.id,
                                  status: "in_progress",
                                  expectedRevision: linked.revision,
                                  expect: ["pending", "in_progress", "completed", "failed", "cancelled"],
                                },
                                {
                                  claim: source,
                                  handoff:
                                    steerClaim?.parentTaskID === linked.id &&
                                    steerClaim.parentTaskRevision !== undefined
                                      ? { source: steerClaim.source, revision: steerClaim.parentTaskRevision }
                                      : undefined,
                                },
                              )
                              .pipe(Effect.mapError(toToolFailure))
                          : (yield* tasks
                              .append(
                                {
                                  sessionID: parent.id,
                                  tasks: [{ content: input.description, status: "in_progress", priority: "medium" }],
                                },
                                { claim: source },
                              )
                              .pipe(Effect.mapError(toToolFailure))).at(-1)
                        if (!parentTask) return yield* new ToolFailure({ message: "Parent task is unavailable" })
                        const turn = yield* delegations
                          .appendTurn({
                            delegationID: state.delegation.id,
                            kind: review ? "review" : "task",
                            ...(review ? { revisionDigest: review.revisionDigest } : {}),
                            promptSummary: input.description,
                            participantIDs: [participant.id],
                            delivery: queued ? "queue" : "steer",
                            origin: { deliveryOrigin: "meta", senderParticipantID: participant.id },
                          })
                          .pipe(
                            Effect.onError(() =>
                              tasks
                                .patch(
                                  {
                                    sessionID: parent.id,
                                    id: parentTask.id,
                                    expectedRevision: parentTask.revision,
                                    expect: ["in_progress"],
                                    status: "cancelled",
                                    outputDigest: "External input could not be admitted",
                                  },
                                  { settle: { source, revision: parentTask.revision } },
                                )
                                .pipe(Effect.catchTag("SessionTask.TaskWriteError", () => Effect.void)),
                            ),
                            Effect.mapError(toToolFailure),
                          )
                        const runExternalPermission = Effect.runPromiseWith(yield* Effect.context())
                        yield* context.progress({
                          sessionID: parent.id,
                          delegationID: state.delegation.id,
                          participantID: participant.id,
                          turnID: turn.id,
                          parentTaskID: parentTask.id,
                          parentTaskRevision: parentTask.revision,
                          source,
                          status: queued ? "queued" : "running",
                        })
                        const receipts = yield* execution
                          .dispatch({
                            delegationID: state.delegation.id,
                            turnID: turn.id,
                            prompt: input.prompt,
                            review,
                            task: {
                              parentTaskID: parentTask.id,
                              parentTaskRevision: parentTask.revision,
                              description: input.description,
                              background,
                              source,
                            },
                            external:
                              external.operation === "steer"
                                ? external
                                : {
                                    ...external,
                                    ...(sdk || jsonl
                                      ? {
                                          readOnly: true,
                                          canUseTool: (request: CliAdapter.SdkPermissionRequest) =>
                                            runExternalPermission(
                                              Effect.gen(function* () {
                                                const call = Schema.decodeUnknownOption(
                                                  Schema.Union([
                                                    Schema.Struct({
                                                      toolName: Schema.Literal("Read"),
                                                      input: Schema.Struct({ file_path: Schema.String }),
                                                    }),
                                                    Schema.Struct({
                                                      toolName: Schema.Literals(["Grep", "Glob"]),
                                                      input: Schema.Struct({
                                                        pattern: Schema.String,
                                                        path: Schema.optionalKey(Schema.String),
                                                      }),
                                                    }),
                                                  ]),
                                                )(request)
                                                if (Option.isNone(call)) return "deny" as const
                                                if (call.value.toolName === "Read") {
                                                  yield* access.authorizeRead(call.value.input.file_path, context)
                                                  return "allow" as const
                                                }
                                                const target = yield* access.resolve({
                                                  path: call.value.input.path ?? ".",
                                                  ...(call.value.toolName === "Glob"
                                                    ? { kind: "directory" as const }
                                                    : {}),
                                                })
                                                const metadata = {
                                                  delegationID: state.delegation.id,
                                                  participantID: participant.id,
                                                  externalSessionID: request.externalSessionID,
                                                  toolUseID: request.toolUseID,
                                                  requestId: request.requestId,
                                                }
                                                yield* access.authorizeExternal([target], context, metadata)
                                                yield* permission.assert({
                                                  action: call.value.toolName === "Grep" ? "grep" : "glob",
                                                  resources: [call.value.input.pattern],
                                                  save: ["*"],
                                                  sessionID: parent.id,
                                                  agent: context.agent,
                                                  source,
                                                  metadata,
                                                })
                                                return "allow" as const
                                              }).pipe(
                                                Effect.catchTag("Permission.BlockedError", () =>
                                                  Effect.succeed("deny" as const),
                                                ),
                                              ),
                                              { signal: request.signal },
                                            ),
                                        }
                                      : {}),
                                    ...(acp
                                      ? {
                                          canUseTool: () => Promise.resolve("deny" as const),
                                          readTextFile: (request: Parameters<CliAdapter.AcpReadTextFileHandler>[0]) =>
                                            runExternalPermission(
                                              Effect.gen(function* () {
                                                if (request.line === 0)
                                                  return yield* new ToolFailure({
                                                    message: "ACP file read line must start at 1",
                                                  })
                                                const target = yield* access.authorizeRead(request.path, context)
                                                const content = yield* files
                                                  .readFileString(target.absolute)
                                                  .pipe(Effect.mapError(toToolFailure))
                                                if (request.line == null && request.limit == null) return { content }
                                                const start = (request.line ?? 1) - 1
                                                return {
                                                  content: content
                                                    .split("\n")
                                                    .slice(
                                                      start,
                                                      request.limit == null ? undefined : start + request.limit,
                                                    )
                                                    .join("\n"),
                                                }
                                              }),
                                              { signal: request.signal },
                                            ),
                                        }
                                      : {}),
                                    onText: (text: string) =>
                                      background
                                        ? Effect.void
                                        : context.progress({
                                            delegationID: state.delegation.id,
                                            participantID: participant.id,
                                            turnID: turn.id,
                                            text,
                                          }),
                                    onPermission: (request: CliAdapter.PermissionRequest) => {
                                      if (!(input.attended ?? attendedDefault ?? false))
                                        return Effect.succeed("deny" as const)
                                      return Effect.gen(function* () {
                                        const metadata = {
                                          delegationID: state.delegation.id,
                                          participantID: participant.id,
                                          threadID: request.threadID,
                                          turnID: request.turnID,
                                          itemID: request.itemID,
                                          requestID: request.requestID,
                                        }
                                        if (request.kind === "command") {
                                          const target = yield* access.resolve({ path: request.cwd, kind: "directory" })
                                          const parsed = yield* ShellParse.scan(
                                            request.command,
                                            yield* shells.resolve({ priority: "compat" }),
                                            target.absolute,
                                            { portable: true },
                                          )
                                          const directories = yield* Effect.forEach(parsed.directories, (path) =>
                                            access.resolve({
                                              path: FileAccess.resolvePath(target.absolute, path),
                                              kind: "directory",
                                            }),
                                          )
                                          yield* access.authorizeExternal([target, ...directories], context, metadata)
                                          if (!parsed.commands.length) return "deny" as const
                                          yield* permission.assert({
                                            action: "shell",
                                            resources: parsed.commands.map((command) => command.resource),
                                            sessionID: parent.id,
                                            agent: context.agent,
                                            source,
                                            metadata,
                                          })
                                          return "allow" as const
                                        }
                                        if (!request.paths.length) return "deny" as const
                                        const targets = yield* Effect.forEach(request.paths, (path) =>
                                          access.resolve({
                                            path: FileAccess.resolvePath(parent.location.directory, path),
                                            kind: "file",
                                          }),
                                        )
                                        yield* access.authorizeExternal(targets, context, metadata)
                                        yield* permission.assert({
                                          action: "edit",
                                          resources: targets.map((target) => target.resource),
                                          sessionID: parent.id,
                                          agent: context.agent,
                                          source,
                                          metadata,
                                        })
                                        return "allow" as const
                                      }).pipe(
                                        Effect.catchTag("Permission.BlockedError", () =>
                                          Effect.succeed("deny" as const),
                                        ),
                                        Effect.mapError(toToolFailure),
                                      )
                                    },
                                  },
                          })
                          .pipe(
                            Effect.onInterrupt(() =>
                              steer || queued
                                ? Effect.void
                                : execution
                                    .interrupt({ delegationID: state.delegation.id, participantID: participant.id })
                                    .pipe(Effect.orDie),
                            ),
                            Effect.mapError(toToolFailure),
                          )
                        const receipt = receipts[0]
                        if (!receipt)
                          return yield* new ToolFailure({ message: "External execution returned no receipt" })
                        const externalResponse = (result: Parameters<typeof DelegationReceipt.response>[2]) => {
                          const response = DelegationReceipt.response(receipt, parentTask.id, result)
                          return {
                            ...response,
                            metadata: { ...response.metadata, parentTaskRevision: parentTask.revision },
                          }
                        }
                        if (background)
                          return externalResponse({
                            status:
                              receipt instanceof DelegationReceipt.Pending && receipt.execution === "queued"
                                ? "queued"
                                : "running",
                            text:
                              receipt instanceof DelegationReceipt.Pending && receipt.execution === "queued"
                                ? "The task is queued behind its previous background execution. You will be notified automatically when it settles. Do not sleep, poll, or duplicate its work."
                                : "The task is working in the background. You will be notified automatically when it settles. Do not sleep, poll, or duplicate its work.",
                          })
                        if (receipt instanceof DelegationReceipt.Pending)
                          return yield* new ToolFailure({
                            message: "Queued external execution requires background delivery",
                          })
                        const result = yield* execution.wait(receipt).pipe(Effect.mapError(toToolFailure))
                        return externalResponse(result)
                      }
                      if (input.cli_target !== undefined || input.judge_models !== undefined)
                        return yield* new ToolFailure({
                          message: "cli_target requires external-cli; judge_models requires judge",
                        })
                      if (locators.turn_id !== undefined)
                        return yield* new ToolFailure({ message: "turn_id is only supported by retry" })
                      const agent =
                        parent.mode === "custom"
                          ? (yield* compositions
                              .selectAgent(parent.id, input.subagent_type)
                              .pipe(Effect.mapError(toToolFailure))).info
                          : yield* agents.resolve(input.subagent_type)
                      if (agent === undefined || agent.mode === "primary")
                        return yield* new ToolFailure({ message: `Unknown subagent type: ${input.subagent_type}` })
                      if (parent.mode !== "custom")
                        yield* Agent.assertOrdinaryMode(agent, parent.mode).pipe(Effect.mapError(toToolFailure))
                      if (input.attended ?? agent.attended ?? attendedDefault ?? false)
                        return yield* new ToolFailure({ message: "Attended task execution is not available" })
                      const linked =
                        input.parent_task_id === undefined
                          ? undefined
                          : (yield* tasks.get(parent.id)).find((task) => task.id === input.parent_task_id)
                      if (input.parent_task_id !== undefined && linked === undefined)
                        return yield* new ToolFailure({
                          message: `Parent task ${input.parent_task_id} does not belong to this session`,
                        })
                      if (linked?.status === "scheduled")
                        return yield* new ToolFailure({
                          message: "A scheduled parent task cannot be delegated while its schedule owns execution",
                        })

                      const selected =
                        locators.delegation_id !== undefined
                          ? yield* delegations
                              .resolve({
                                parentSessionID: parent.id,
                                agent: context.agent,
                                title: input.description,
                                delegationID: locators.delegation_id,
                              })
                              .pipe(Effect.mapError(toToolFailure))
                          : input.new_delegation === true
                            ? undefined
                            : yield* delegations
                                .resolveActive(parent.id, context.agent)
                                .pipe(Effect.mapError(toToolFailure))
                      if (
                        selected !== undefined &&
                        ["closing", "completed", "cancelled", "archived"].includes(selected.delegation.status)
                      )
                        return yield* new ToolFailure({ message: "The selected delegation cannot accept a task" })
                      const candidates = selected === undefined ? [] : [...selected.participants.values()]
                      const role = input.intent === "review" ? "reviewer" : "implementer"
                      const review =
                        input.intent === "review" && selected && input.revision_digest
                          ? yield* delegations
                              .revision({ delegationID: selected.delegation.id, revisionDigest: input.revision_digest })
                              .pipe(Effect.mapError(toToolFailure))
                          : undefined
                      const routed =
                        locators.participant_id !== undefined
                          ? selected?.participants.get(locators.participant_id)
                          : locators.task_id !== undefined
                            ? candidates.find((participant) => participant.childSessionID === locators.task_id)
                            : (candidates.find(
                                (participant) =>
                                  participant.provider === "internal" &&
                                  participant.target === agent.id &&
                                  participant.role === role &&
                                  participant.childSessionID !== undefined,
                              ) ??
                              candidates.find(
                                (participant) =>
                                  participant.provider === "internal" &&
                                  participant.target === agent.id &&
                                  participant.role === role,
                              ))
                      if (
                        (locators.task_id !== undefined || locators.participant_id !== undefined) &&
                        routed === undefined
                      )
                        return yield* new ToolFailure({
                          message: "task_id or participant_id does not belong to the selected delegation",
                        })
                      if (
                        routed !== undefined &&
                        (routed.provider !== "internal" || routed.target !== agent.id || routed.role !== role)
                      )
                        return yield* new ToolFailure({
                          message: `The selected participant is not a ${role} for the requested subagent`,
                        })
                      if (locators.task_id !== undefined && routed?.childSessionID !== locators.task_id)
                        return yield* new ToolFailure({ message: "task_id does not match the requested participant" })
                      if (routed?.phase === "closed")
                        return yield* new ToolFailure({ message: "The selected participant is closed" })
                      if (routed?.phase === "failed")
                        return yield* new ToolFailure({
                          message: "The selected participant requires retry before new work",
                        })
                      if (
                        routed !== undefined &&
                        selected !== undefined &&
                        [...selected.deliveries.values()].some(
                          (delivery) => delivery.participantID === routed.id && delivery.status === "recovery_required",
                        )
                      )
                        return yield* new ToolFailure({
                          message: "The selected participant requires reconciliation before new work",
                        })
                      const child =
                        routed?.childSessionID === undefined
                          ? undefined
                          : yield* sessions.get(routed.childSessionID).pipe(Effect.mapError(toToolFailure))
                      if (child !== undefined && child.parentID !== parent.id)
                        return yield* new ToolFailure({
                          message: "The selected child session does not belong to this session",
                        })
                      if (child?.attended === true)
                        return yield* new ToolFailure({
                          message: "Attended child sessions cannot run through the task tool",
                        })
                      const adopted = locators.task_id !== undefined || locators.participant_id !== undefined
                      const metaAgentID = selected
                        ? selected.delegation.metaAgentID
                        : context.agent === "meta"
                          ? parent.controller?.metaAgentID
                          : undefined
                      const executor = metaAgentID
                        ? adopted && routed?.executor
                          ? routed.executor
                          : yield* Session.resolveExecutor(parent, agent, input.model).pipe(
                              Effect.provideService(Model.Service, models),
                              Effect.provideService(ModelResolver.Service, resolver),
                              Effect.provideService(Config.Service, config),
                              Effect.provideService(SessionComposition.Service, compositions),
                              Effect.provideService(Service, plugins),
                              Effect.mapError(toToolFailure),
                            )
                        : undefined
                      if (
                        metaAgentID &&
                        routed &&
                        (!routed.executor ||
                          routed.executor.agent !== executor?.agent ||
                          !sameModel(routed.executor.model, executor?.model) ||
                          (input.model !== undefined && !sameModel(input.model, routed.executor.model)))
                      )
                        return yield* new ToolFailure({
                          message: "Participant binding changed; create a new participant",
                        })
                      const background = input.background === true && backgroundEnabled()
                      if (background && (input.artifact_path !== undefined || review))
                        return yield* new ToolFailure({
                          message: "Artifact and review governance currently require foreground execution",
                        })
                      const queue = background && child !== undefined && (yield* runs.isActive(child.id))
                      yield* permission
                        .assert({
                          action: name,
                          resources: [parent.mode === "custom" ? agent.id : input.subagent_type],
                          save: ["*"],
                          sessionID: parent.id,
                          agent: context.agent,
                          source,
                        })
                        .pipe(Effect.mapError(toToolFailure))
                      if (review) yield* access.authorizeRead(review.path, context).pipe(Effect.mapError(toToolFailure))
                      const previous =
                        input.artifact_path !== undefined && adopted && selected?.delegation.latestRevisionDigest
                          ? yield* delegations
                              .revision({
                                delegationID: selected.delegation.id,
                                revisionDigest: selected.delegation.latestRevisionDigest,
                              })
                              .pipe(Effect.mapError(toToolFailure))
                          : undefined
                      if (previous && previous.receipt.participantID !== routed?.id)
                        return yield* new ToolFailure({
                          message: "Artifact revision belongs to a different implementer",
                        })
                      const artifact =
                        input.artifact_path !== undefined
                          ? { path: input.artifact_path, invocation: context, previous }
                          : undefined
                      if (selected !== undefined && routed !== undefined && child !== undefined)
                        yield* delegations
                          .bindParticipant({
                            delegationID: selected.delegation.id,
                            participantID: routed.id,
                            childSessionID: child.id,
                          })
                          .pipe(Effect.mapError(toToolFailure))

                      const parentTask =
                        linked === undefined
                          ? (yield* tasks
                              .append(
                                {
                                  sessionID: parent.id,
                                  tasks: [{ content: input.description, status: "in_progress", priority: "medium" }],
                                },
                                { claim: source },
                              )
                              .pipe(Effect.mapError(toToolFailure))).at(-1)
                          : yield* tasks
                              .patch(
                                {
                                  sessionID: parent.id,
                                  id: linked.id,
                                  status: "in_progress",
                                  expectedRevision: linked.revision,
                                  expect: ["pending", "in_progress", "completed", "failed", "cancelled"],
                                },
                                { claim: source },
                              )
                              .pipe(Effect.mapError(toToolFailure))
                      if (parentTask === undefined)
                        return yield* new ToolFailure({ message: "Parent task is no longer available for execution" })
                      const admission = { dispatched: false }
                      const receipt = yield* Effect.gen(function* () {
                        const state =
                          selected ??
                          (yield* delegations.resolve({
                            parentSessionID: parent.id,
                            agent: context.agent,
                            title: input.description,
                            newDelegation: input.new_delegation,
                          }))
                        const participant =
                          routed ??
                          (yield* delegations.addParticipant({
                            delegationID: state.delegation.id,
                            provider: "internal",
                            target: agent.id,
                            role,
                            context: "fresh",
                            executor,
                          }))
                        const turn = yield* delegations.appendTurn({
                          delegationID: state.delegation.id,
                          kind: review ? "review" : previous ? "repair" : "task",
                          revisionDigest: review?.revisionDigest,
                          promptSummary: input.description,
                          participantIDs: [participant.id],
                          delivery: queue ? "queue" : "steer",
                          origin: { deliveryOrigin: "meta", senderParticipantID: participant.id },
                        })
                        admission.dispatched = true
                        const receipts = yield* execution.dispatch({
                          delegationID: state.delegation.id,
                          turnID: turn.id,
                          prompt: input.prompt,
                          task: {
                            parentTaskID: parentTask.id,
                            parentTaskRevision: parentTask.revision,
                            description: input.description,
                            background,
                            source,
                          },
                          artifact,
                          review,
                        })
                        const receipt = receipts.find(
                          (item) =>
                            item.participantID === participant.id &&
                            item.turnID === turn.id &&
                            item.deliveryOrigin === "meta" &&
                            item.senderParticipantID === participant.id,
                        )
                        if (receipt === undefined)
                          return yield* new ToolFailure({ message: "Task execution did not return a delivery receipt" })
                        return receipt
                      }).pipe(
                        Effect.onError((cause) =>
                          admission.dispatched
                            ? Effect.void
                            : tasks
                                .patch(
                                  {
                                    sessionID: parent.id,
                                    id: parentTask.id,
                                    status: Cause.hasInterruptsOnly(cause) ? "cancelled" : "failed",
                                    outputDigest: Cause.pretty(cause),
                                    expect: ["pending", "in_progress"],
                                    expectedRevision: parentTask.revision,
                                  },
                                  { settle: { source, revision: parentTask.revision } },
                                )
                                .pipe(Effect.orDie, Effect.asVoid),
                        ),
                        Effect.mapError(toToolFailure),
                      )
                      yield* context.progress({
                        sessionID: receipt.childSessionID,
                        delegationID: receipt.delegationID,
                        participantID: receipt.participantID,
                        turnID: receipt.turnID,
                        parentTaskID: parentTask.id,
                        parentTaskRevision: parentTask.revision,
                        status: "running",
                      })
                      if (background)
                        return response({
                          sessionID: receipt.childSessionID,
                          delegationID: receipt.delegationID,
                          participantID: receipt.participantID,
                          turnID: receipt.turnID,
                          inputID: receipt.inputID,
                          receipt,
                          parentTaskID: parentTask.id,
                          parentTaskRevision: parentTask.revision,
                          status: "running",
                          text: "The task is working in the background. You will be notified automatically when it settles. Do not sleep, poll, or duplicate its work.",
                        })
                      const result = yield* execution.wait(receipt).pipe(
                        Effect.onInterrupt(() =>
                          execution
                            .interrupt({ delegationID: receipt.delegationID, participantID: receipt.participantID })
                            .pipe(Effect.orDie),
                        ),
                        Effect.mapError(toToolFailure),
                      )
                      return response({
                        sessionID: receipt.childSessionID,
                        delegationID: receipt.delegationID,
                        participantID: receipt.participantID,
                        turnID: receipt.turnID,
                        inputID: receipt.inputID,
                        receipt,
                        parentTaskID: parentTask.id,
                        parentTaskRevision: parentTask.revision,
                        status: result.status,
                        text: result.text,
                        governance: result.governance,
                      })
                    }),
                  ),
        }),
      )
      .pipe(Effect.orDie)

    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        if (event.agent !== "meta") return
        const session = yield* sessions.get(event.sessionID).pipe(Effect.orDie)
        if (session.parentID !== undefined || session.controller?.kind !== "root") return
        const current = yield* tasks.get(session.id)
        if (current.length === 0) return
        // Task content is data. Keep this refreshed projection outside durable history and the shared System prefix.
        event.messages.push(
          Message.user(
            `<session_task_snapshot>${JSON.stringify({
              sessionID: session.id,
              counts: Object.fromEntries(
                SessionTask.Info.fields.status.literals.map((status) => [
                  status,
                  current.filter((task) => task.status === status).length,
                ]),
              ),
              tasks: current.map((task) => ({
                id: task.id,
                content: task.content,
                status: task.status,
                revision: task.revision,
                dependsOn: task.dependsOn,
                operationRef: task.operationRef,
                hasOutput: task.outputDigest !== undefined,
              })),
            })}</session_task_snapshot>`,
          ),
        )
      }),
    )
  }),
}

function response(input: {
  sessionID: Session.ID
  delegationID: DelegationID.ID
  participantID?: ParticipantID
  turnID?: TurnID
  inputID?: SessionMessage.ID
  receipt?: DelegationExecution.Receipt
  parentTaskID?: string
  parentTaskRevision?: number
  status: typeof Status.Type
  text: string
  governance?: DelegationService.Governance
}) {
  const state = input.status === "running" ? "running" : input.status === "completed" ? "completed" : "error"
  const tag = state === "error" ? "task_error" : "task_result"
  const output = {
    sessionID: input.sessionID,
    delegationID: input.delegationID,
    ...(input.participantID === undefined ? {} : { participantID: input.participantID }),
    ...(input.turnID === undefined ? {} : { turnID: input.turnID }),
    ...(input.inputID === undefined ? {} : { inputID: input.inputID }),
    ...(input.parentTaskID === undefined ? {} : { parentTaskID: input.parentTaskID }),
    status: input.status,
    output: `<task id="${input.sessionID}" state="${state}">\n<${tag}>\n${input.text}\n</${tag}>\n</task>${input.governance ? `\n<task_governance>${JSON.stringify(Schema.encodeSync(Schema.toCodecJson(DelegationService.Governance))(input.governance))}</task_governance>` : ""}`,
    ...(input.governance ? { governance: input.governance } : {}),
  }
  return {
    output,
    content: output.output,
    metadata: {
      sessionID: input.sessionID,
      delegationID: input.delegationID,
      ...(input.participantID === undefined ? {} : { participantID: input.participantID }),
      ...(input.turnID === undefined ? {} : { turnID: input.turnID }),
      ...(input.inputID === undefined ? {} : { inputID: input.inputID }),
      ...(input.receipt === undefined ? {} : { receipt: input.receipt }),
      ...(input.parentTaskID === undefined ? {} : { parentTaskID: input.parentTaskID }),
      ...(input.parentTaskRevision === undefined ? {} : { parentTaskRevision: input.parentTaskRevision }),
      status: input.status,
      ...(input.governance
        ? {
            governance: Schema.encodeSync(Schema.toCodecJson(DelegationService.Governance))(input.governance),
            truncated: false,
          }
        : {}),
    },
  }
}

function judgeObservation(worker: typeof JudgeWorker.Type, evidence: string) {
  if (worker.status !== "completed")
    return new VerificationRouter.JudgeResult({ taskID: worker.taskID, status: worker.status, observations: [] })
  if (worker.completion?.finish !== "stop" || worker.completion.needsContinuation !== false)
    return new VerificationRouter.JudgeResult({ taskID: worker.taskID, status: "partial", observations: [] })
  if (worker.text.trim().length === 0)
    return new VerificationRouter.JudgeResult({ taskID: worker.taskID, status: "empty", observations: [] })
  const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(VerificationRouter.Observations))(worker.text)
  if (Option.isNone(decoded))
    return new VerificationRouter.JudgeResult({
      taskID: worker.taskID,
      status: "invalid",
      observations: [],
      reason: "Judge result is not the requested observation JSON",
    })
  if (
    decoded.value.observations.some(
      (observation) =>
        observation.quote.trim().length === 0 ||
        observation.detail.trim().length === 0 ||
        !evidence.includes(observation.quote),
    )
  )
    return new VerificationRouter.JudgeResult({
      taskID: worker.taskID,
      status: "invalid",
      observations: [],
      reason: "Judge observation has no non-empty verbatim input anchor or detail",
    })
  return new VerificationRouter.JudgeResult({
    taskID: worker.taskID,
    status: decoded.value.observations.length === 0 ? "no_issue_reported" : "reported",
    observations: decoded.value.observations,
  })
}

function verificationResponse(
  verification: VerificationRouter.Settlement,
  result?: Tool.Result<typeof Output>,
  retained: readonly RetainedJudgeResult[] = [],
): Tool.Result<typeof Output> {
  const encoded = Schema.encodeSync(Schema.toCodecJson(VerificationRouter.Settlement))(verification)
  const metadata = {
    ...result?.metadata,
    verification: encoded,
    ...(retained.length > 0
      ? {
          restoredVerificationSources: retained.map((record) =>
            Schema.encodeSync(VerificationRouter.Source)(record.verification.source),
          ),
        }
      : {}),
  }
  if (result?.output && "kind" in result.output && result.output.kind === "judge") {
    const output = { ...result.output, verification, ...(retained.length > 0 ? { retained } : {}) }
    const text = JSON.stringify(Schema.encodeSync(Schema.toCodecJson(JudgeOutput))(output))
    return { output, content: text, metadata }
  }
  const restored =
    retained.length > 0
      ? `\n<retained_judge_results>${JSON.stringify(Schema.encodeSync(Schema.toCodecJson(Schema.Array(RetainedJudgeResult)))(retained))}</retained_judge_results>`
      : ""
  const text = `${typeof result?.content === "string" ? `${result.content}\n` : ""}<task_verification>${JSON.stringify(encoded)}</task_verification>${restored}`
  if (result?.output && "sessionID" in result.output && "output" in result.output)
    return { output: { ...result.output, output: text, verification }, content: text, metadata }
  return {
    output: {
      sessionID: verification.source.sessionID,
      status: verification.status === "unavailable" || verification.status === "failed" ? "failed" : "completed",
      output: text,
      verification,
    },
    content: text,
    metadata,
  }
}
