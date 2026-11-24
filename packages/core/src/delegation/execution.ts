export * as DelegationExecution from "./execution.js"

import {
  Cause,
  Context,
  DateTime,
  Deferred,
  Effect,
  Exit,
  Layer,
  Option,
  Queue,
  Schema,
  Stream,
  type Scope,
} from "effect"
import { isReadonlyArrayNonEmpty } from "effect/Array"
import { ChildProcess } from "effect/process"
import { createHash, randomUUID } from "node:crypto"
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import { isDeepStrictEqual } from "node:util"
import path from "path"
import { AppProcess } from "@omnixa/util/process"
import { eq } from "drizzle-orm"
import { Delegation } from "@omnixa/schema/delegation"
import { DelegationID, ParticipantID, TurnID } from "@omnixa/schema/delegation-id"
import { Node } from "@omnixa/util/effect/app-node"
import { FSUtil } from "@omnixa/util/fs-util"
import type { LayerNode } from "@omnixa/util/effect/layer-node"
import { Agent } from "../agent.js"
import { Bus } from "../bus.js"
import { Config } from "../config.js"
import { Database } from "../database/database.js"
import { KeyedMutex } from "../effect/keyed-mutex.js"
import { Instance } from "../instance/service.js"
import { Job } from "../job.js"
import { KV } from "../kv.js"
import { Plugin } from "../plugin.js"
import { ProductModePolicy } from "../product-mode-policy.js"
import { Session } from "../session.js"
import { serializedSelection } from "../session/session.js"
import { SessionSchema } from "../session/schema.js"
import { SessionComposition } from "../session/composition.js"
import { SessionExecution } from "../session/execution.js"
import { SessionInbox } from "../session/inbox.js"
import { SessionEvent } from "../session/event.js"
import { SessionInputResult } from "../session/input-result.js"
import { SessionMessage } from "../session/message.js"
import { SessionNotification } from "../session/notification.js"
import { SessionStore } from "../session/store.js"
import { SessionTask } from "../session/task.js"
import { SubagentCompletion } from "../session/subagent-completion.js"
import { DelegationFold } from "./fold.js"
import { DelegationProjector } from "./projector.js"
import { DelegationEvent } from "./event.js"
import { DelegationService } from "./service.js"
import { DelegationReceipt } from "./receipt.js"
import { CliAdapter } from "../tool/cli-adapter.js"
import { CodexAppServer } from "../tool/codex-app-server.js"
import { Tool } from "../tool.js"
import { ToolOutput } from "../tool-output.js"
import { DelegationParticipantTable } from "./sql.js"
import { Permission } from "../permission.js"
import { sameExecutor, bindingMatches } from "../session/error.js"
import { FileAccess } from "../file-access.js"
import { Git } from "../git.js"
import { Location } from "../location.js"
import { Environment } from "../environment/index.js"
import { RelativePath } from "../schema.js"
import { gitExecutable } from "../util/git-executable.js"
import { DelegationDigest } from "./digest.js"
import { DelegationParser } from "../tool/delegation-parser.js"
import { toSessionError } from "../session/to-session-error.js"
import { Schedule } from "@omnixa/schema/schedule"
import { ScheduleService } from "../session/schedule-service.js"
import { SessionCommunication } from "@omnixa/schema/session-communication"
import { CommunicationRecord } from "../session/communication-record.js"

type Recovery = Extract<Job.Recovery, { kind: "delegation" }>
type DeliveryRef = {
  readonly delegationID: DelegationID.ID
  readonly turnID: TurnID
  readonly participantID: ParticipantID
}

class Reference extends Schema.Class<Reference>("DelegationExecution.Reference")({
  delegationID: DelegationID.ID,
  turnID: TurnID,
  participantID: ParticipantID,
  deliveryOrigin: Schema.String,
  senderParticipantID: ParticipantID,
  attempt: Schema.Int,
}) {}

export class ArtifactBaseline extends Schema.Class<ArtifactBaseline>("DelegationExecution.ArtifactBaseline")({
  location: Location.Ref,
  repository: Schema.String,
  path: Schema.String,
  absolute: Schema.String,
  commitSha: Schema.String,
  blob: Schema.String,
  baseSha256: Schema.String,
  agent: Schema.String,
  previous: Schema.optionalKey(DelegationService.RevisionReference),
}) {}

class ArtifactError extends Schema.TaggedError<ArtifactError>()("DelegationExecution.ArtifactError", {
  message: Schema.String,
}) {}

class ScheduledExecutionError extends Schema.TaggedError<ScheduledExecutionError>()(
  "DelegationExecution.ScheduleError",
  {
    message: Schema.String,
  },
) {}

class TaskLink extends Schema.Class<TaskLink>("DelegationExecution.TaskLink")({
  parentTaskID: Schema.String,
  parentTaskRevision: Schema.Int,
  description: Schema.String,
  background: Schema.Boolean,
  source: Schema.optionalKey(Permission.Source),
  artifact: Schema.optionalKey(ArtifactBaseline),
  review: Schema.optionalKey(DelegationService.RevisionReference),
}) {}

class TaskSettlement extends Schema.Class<TaskSettlement>("DelegationExecution.TaskSettlement")({
  status: Schema.Literals(["completed", "failed", "cancelled", "recovery_required"]),
  revision: Schema.Int,
  governance: Schema.optionalKey(DelegationService.Governance),
  sourceSettlement: Schema.optionalKey(Schema.Literals(["completed", "cancelled", "conflict", "unavailable"])),
}) {}

// Bus commit hooks are infallible Effects. This private conflict only rolls back
// the conditional recovery publication and is handled at that same boundary.
class RecoveryConflict extends Schema.TaggedError<RecoveryConflict>()("DelegationExecution.RecoveryConflict", {}) {}

export class RecoveryResult extends Schema.Class<RecoveryResult>("DelegationExecution.RecoveryResult")({
  status: Schema.Literals(["reconciled", "deferred"]),
  childSessionID: Session.ID,
  parentSessionID: Schema.optionalKey(Session.ID),
}) {}

export class PendingRecoveryResult extends Schema.Class<PendingRecoveryResult>(
  "DelegationExecution.PendingRecoveryResult",
)({
  parents: Schema.Array(Session.ID),
  deferredChildren: Schema.Array(Session.ID),
  /** External result reads may defer the parent itself, without an internal child Session. */
  deferredParents: Schema.optionalKey(Schema.Array(Session.ID)),
  /** An unavailable scan requires the caller to defer all child recovery. */
  scanAvailable: Schema.Boolean,
}) {}

export type Receipt = Delegation.Receipt

export type Result = {
  readonly status: "completed" | "failed" | "cancelled" | "recovery_required"
  readonly text: string
  readonly governance?: DelegationService.Governance
  readonly sourceSettlement?: "completed" | "cancelled" | "conflict" | "unavailable"
}

type ExternalJob = {
  binding: DelegationReceipt.Binding
  adapter: CliAdapter.CliAdapterValue<Error>
  inputs: Map<string, DelegationReceipt.Binding>
  finished: Deferred.Deferred<void, Error>
  status: Result["status"]
  stopping: boolean
  previousSdkMessage?: DelegationReceipt.SdkMessage
  previousJsonlMessage?: DelegationReceipt.JsonlMessage
  sdk?: {
    feed: Queue.Queue<SDKUserMessage, Cause.Done>
    waiters: Map<string, Deferred.Deferred<DelegationReceipt.Sdk, Error>>
    ended: boolean
  }
}

const decodeReference = Schema.decodeUnknownOption(Reference)
const decodeTaskLink = Schema.decodeUnknownOption(TaskLink)
const decodeTaskSettlement = Schema.decodeUnknownOption(TaskSettlement)
const terminal = (status: Delegation.DeliveryStatus): status is Result["status"] =>
  status === "completed" || status === "failed" || status === "cancelled" || status === "recovery_required"

const sdkLifecycle = (binding: DelegationReceipt.Binding) =>
  binding.sdkInput?.observations.findLast((observation) => observation instanceof DelegationReceipt.SdkLifecycle)

const sdkInputProtocol = (binding: DelegationReceipt.Binding) =>
  [...(binding.sdkInput?.observations ?? []), ...(binding.sdkObservations ?? [])].some(
    (observation) =>
      observation instanceof DelegationReceipt.SdkLifecycle ||
      (observation instanceof DelegationReceipt.SdkResultObservation && observation.user_message_uuid !== undefined),
  )

/** Delivery identity comes from the domain fold; an explicit retry gets a new Session input. */
export function inputID(delegationID: DelegationID.ID, delivery: Omit<typeof Reference.Type, "delegationID">) {
  return DelegationFold.inputID(delegationID, delivery)
}

type DispatchInput = {
  readonly delegationID: DelegationID.ID
  readonly turnID: TurnID
  readonly prompt: string
  readonly task?: typeof TaskLink.Type
  readonly artifact?: {
    readonly path: string
    readonly invocation: FileAccess.Invocation
    readonly previous?: DelegationService.RevisionReference
  }
  readonly review?: DelegationService.RevisionReference
}
type DispatchError =
  | DelegationService.ServiceError
  | Session.NotFoundError
  | SessionComposition.Error
  | Effect.Error<ReturnType<Session.Interface["fork"]>>
  | Effect.Error<ReturnType<Session.Interface["prompt"]>>
  | Session.InboxConflictError
export type ExternalDispatchInput = DispatchInput & {
  readonly external:
    | {
        readonly operation?: "execute"
        readonly adapter: CliAdapter.CliAdapterValue<Error>
        readonly agent: Agent.ID
        readonly readOnly?: boolean
        readonly canUseTool?: CliAdapter.SdkPermissionHandler
        readonly readTextFile?: CliAdapter.AcpReadTextFileHandler
        readonly onPermission: NonNullable<
          Parameters<NonNullable<CliAdapter.CliAdapterValue<Error>["execute"]>>[0]["onPermission"]
        >
        readonly onText: NonNullable<Parameters<NonNullable<CliAdapter.CliAdapterValue<Error>["execute"]>>[0]["onText"]>
      }
    | {
        readonly operation: "steer"
        readonly agent: Agent.ID
      }
}

type ExternalSteerOwnerInput = {
  readonly delegationID: DelegationID.ID
  readonly participantID: ParticipantID
  readonly parentSessionID: Session.ID
  readonly agent: Agent.ID
}

export interface Interface {
  /** Retained schedules enter the existing internal child dispatcher with a durable operation source. */
  readonly internalParticipant: (occurrenceID: Schedule.OccurrenceID) => Effect.Effect<Receipt, Error>
  readonly readSources: (
    delegationID: DelegationID.ID,
  ) => Effect.Effect<readonly Delegation.DeliveryInfo[], DelegationService.ServiceError>
  readonly readResult: (
    input: Pick<
      Delegation.DeliveryInfo,
      "delegationID" | "turnID" | "participantID" | "deliveryOrigin" | "senderParticipantID" | "attempt"
    >,
  ) => Effect.Effect<
    Delegation.Result,
    DelegationService.ServiceError | Session.NotFoundError | Session.MessageDecodeError
  >
  readonly dispatch: {
    (input: ExternalDispatchInput): Effect.Effect<readonly DelegationReceipt.Outcome[], Error>
    (input: DispatchInput): Effect.Effect<readonly Receipt[], DispatchError>
  }
  readonly wait: {
    (
      receipt: DelegationReceipt.External | DelegationReceipt.Sdk | DelegationReceipt.Acp | DelegationReceipt.Jsonl,
    ): Effect.Effect<Result, Error>
    (receipt: Receipt): Effect.Effect<Result, DelegationService.ServiceError>
  }
  /** Check the original local owner before a new Task or domain Turn is admitted. */
  readonly preflightExternalSteer: (input: ExternalSteerOwnerInput) => Effect.Effect<
    {
      readonly parentTaskID?: string
      readonly parentTaskRevision?: number
      readonly source: Permission.Source
    },
    Error
  >
  /** Reconcile a lost participant activation without replaying model/tool side effects. */
  readonly recover: (recovery: Recovery) => Effect.Effect<RecoveryResult>
  /** Reconcile bound participants even if a crash happened before their background marker was written. */
  readonly recoverPending: Effect.Effect<PendingRecoveryResult>
  readonly retry: (
    input: DeliveryRef,
  ) => Effect.Effect<void, Effect.Error<ReturnType<Interface["dispatch"]>> | Session.InboxConflictError>
  readonly steer: (
    input: DeliveryRef,
  ) => Effect.Effect<void, DelegationService.ServiceError | Session.NotFoundError | Session.InboxConflictError>
  readonly close: (input: {
    readonly delegationID: DelegationID.ID
    readonly reason?: string
    readonly requireComplete?: boolean
  }) => Effect.Effect<void, DelegationService.ServiceError | Session.NotFoundError | Session.InboxConflictError>
  readonly interrupt: (input: {
    readonly delegationID: DelegationID.ID
    readonly participantID?: ParticipantID
    readonly turnID?: TurnID
  }) => Effect.Effect<void, DelegationService.ServiceError | Session.NotFoundError | Session.SyntheticConflictError>
}

export class Service extends Context.Service<Service, Interface>()("@omnixa/DelegationExecution") {}

const make: Effect.Effect<
  Interface,
  never,
  | Database.Service
  | Bus.Service
  | DelegationService.Service
  | Session.Service
  | SessionStore.Service
  | SessionComposition.Service
  | SessionExecution.Service
  | Job.Service
  | KV.Service
  | Instance.Service
  | SessionTask.Service
  | ScheduleService.Service
  | FSUtil.Service
  | AppProcess.Service
  | Git.Service
  | Scope.Scope
> = Effect.gen(function* () {
  const db = (yield* Database.Service).db
  const bus = yield* Bus.Service
  const delegations = yield* DelegationService.Service
  const sessions = yield* Session.Service
  const store = yield* SessionStore.Service
  const compositions = yield* SessionComposition.Service
  const execution = yield* SessionExecution.Service
  const jobs = yield* Job.Service
  const kv = yield* KV.Service
  const instances = yield* Instance.Service
  const tasks = yield* SessionTask.Service
  const schedules = yield* ScheduleService.Service
  const files = yield* FSUtil.Service
  const processes = yield* AppProcess.Service
  const git = yield* Git.Service
  const scope = yield* Effect.scope
  const context = yield* Effect.context<never>()
  const locks = KeyedMutex.makeUnsafe<DelegationID.ID>()
  const observers = new Set<SessionMessage.ID>()
  const externalJobs = new Map<string, ExternalJob>()

  const requireState = Effect.fnUntraced(function* (delegationID: DelegationID.ID) {
    const state = yield* delegations.foldState(delegationID)
    if (!state) return yield* new Delegation.DelegationNotFoundError({ delegationID })
    return state
  })

  const invalid = (state: DelegationFold.DelegationFoldState, operation: string, reason: string) =>
    new Delegation.DelegationInvalidStateError({
      delegationID: state.delegation.id,
      currentStatus: state.delegation.status,
      attemptedTransition: operation,
      reason,
    })

  const rawGit = Effect.fn("DelegationExecution.rawGit")(function* (repository: string, args: readonly string[]) {
    const result = yield* processes
      .run(
        ChildProcess.make(
          gitExecutable,
          ["-c", "core.quotepath=false", "-c", "core.autocrlf=false", "--literal-pathspecs", ...args],
          { cwd: repository, extendEnv: true, stdin: "ignore" },
        ),
        { maxOutputBytes: 1024 * 1024, maxErrorBytes: 65536 },
      )
      .pipe(Effect.flatMap(AppProcess.requireSuccess))
    if (result.stdoutTruncated || result.stderrTruncated)
      return yield* new ArtifactError({ message: "Artifact Git output is incomplete" })
    return result.stdout
  })

  const textBytes = (bytes: Uint8Array) =>
    Effect.try({
      try: () => {
        if (bytes.length > 65536 || bytes.includes(0)) throw new Error("Artifact must be finite UTF-8 text")
        return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
      },
      catch: () => new ArtifactError({ message: "Artifact must be strict UTF-8 text of at most 64 KiB" }),
    })

  const readArtifact = Effect.fn("DelegationExecution.readArtifact")(function* (absolute: string) {
    const environment = yield* Environment.Service
    const stat = yield* environment.files.stat(absolute)
    if (stat.type !== "file" || stat.size > 65536)
      return yield* new ArtifactError({ message: "Artifact must remain a regular finite text file" })
    if ((yield* files.realPath(absolute)) !== absolute)
      return yield* new ArtifactError({ message: "Artifact symlinks are unsupported" })
    const content = yield* environment.files.read(absolute)
    yield* textBytes(content.bytes)
    return content.bytes
  })

  const artifactDiff = Effect.fn("DelegationExecution.artifactDiff")(function* (
    repository: string,
    commitSha: string,
    relative: string,
  ) {
    const diff = yield* rawGit(repository, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      "--no-color",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "--full-index",
      "--unified=2147483647",
      commitSha,
      "--",
      relative,
    ])
    const normalizedDiff = yield* Effect.try({
      try: () => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(diff),
      catch: () => new ArtifactError({ message: "Artifact diff is not strict UTF-8" }),
    })
    if (/^(?:old mode|new mode|deleted file mode|new file mode|Binary files|GIT binary patch)/m.test(normalizedDiff))
      return yield* new ArtifactError({ message: "Artifact modes, deletion and binary changes are unsupported" })
    return normalizedDiff
  })

  const prepareArtifact = Effect.fn("DelegationExecution.prepareArtifact")(function* (input: {
    readonly child: SessionSchema.Info
    readonly path: string
    readonly invocation: FileAccess.Invocation
    readonly previous?: DelegationService.RevisionReference
  }) {
    if (
      path.isAbsolute(input.path) ||
      input.path.includes("\\") ||
      input.path.includes("\0") ||
      input.path.split("/").some((segment) => !segment || segment === "." || segment === "..")
    )
      return yield* new ArtifactError({ message: "Artifact requires one canonical relative path" })
    if (input.child.location.workspaceID)
      return yield* new ArtifactError({ message: "Artifact capture currently requires a local Git Location" })
    return yield* Effect.gen(function* () {
      const access = yield* FileAccess.Service
      const location = yield* Location.Service
      const target = yield* access.authorizeRead(input.path, input.invocation)
      if (!FSUtil.contains(location.directory, target.absolute))
        return yield* new ArtifactError({ message: "Artifact is outside the selected Location" })
      const repository = yield* git.repo.discover(location.directory)
      const head = repository ? yield* git.history.head(repository) : undefined
      if (!repository || !head) return yield* new ArtifactError({ message: "Artifact requires an existing Git HEAD" })
      const relative = RelativePath.make(path.relative(repository.worktree, target.absolute).replaceAll("\\", "/"))
      const tree = (yield* rawGit(repository.worktree, ["ls-tree", "-z", head, "--", relative])).toString("utf8")
      const match = /^100644 blob ([0-9a-f]+)\t([^\0]+)\0$/.exec(tree)
      if (!match || match[2] !== relative)
        return yield* new ArtifactError({ message: "Artifact must be a regular tracked HEAD blob" })
      const index = (yield* rawGit(repository.worktree, ["ls-files", "--stage", "-z", "--", relative])).toString("utf8")
      if (index !== `100644 ${match[1]} 0\t${relative}\0`)
        return yield* new ArtifactError({ message: "Artifact index must match the HEAD tree entry" })
      const base = yield* rawGit(repository.worktree, ["cat-file", "blob", match[1]])
      yield* textBytes(base)
      const current = yield* readArtifact(target.absolute)
      const baseSha256 = createHash("sha256").update(base).digest("hex")
      if (input.previous) {
        const original = input.previous.artifact
        if (
          !original ||
          input.previous.receipt.childSessionID !== input.child.id ||
          input.previous.path !== target.absolute ||
          !isDeepStrictEqual(original.location, input.child.location) ||
          original.repository !== repository.worktree ||
          original.path !== relative ||
          original.commitSha !== head ||
          original.baseSha256 !== baseSha256
        )
          return yield* new ArtifactError({ message: "Artifact baseline does not match the accepted producer" })
        if (
          createHash("sha256").update(current).digest("hex") !== original.targetSha256 ||
          (yield* artifactDiff(repository.worktree, head, relative)) !== original.normalizedDiff
        )
          return yield* new ArtifactError({ message: "Artifact path differs from the latest accepted revision" })
      }
      if (!input.previous && !Buffer.from(current).equals(base))
        return yield* new ArtifactError({ message: "Artifact path has pre-existing changes" })
      return new ArtifactBaseline({
        location: input.child.location,
        repository: repository.worktree,
        path: relative,
        absolute: target.absolute,
        commitSha: head,
        blob: match[1],
        baseSha256,
        agent: input.invocation.agent,
        ...(input.previous ? { previous: input.previous } : {}),
      })
    }).pipe(instances.provide(input.child))
  })

  const captureArtifact = Effect.fn("DelegationExecution.captureArtifact")(function* (
    child: SessionSchema.Info,
    baseline: ArtifactBaseline,
    invocation: FileAccess.Invocation,
  ) {
    if (!isDeepStrictEqual(child.location, baseline.location))
      return yield* new ArtifactError({ message: "Artifact Location changed after admission" })
    return yield* Effect.gen(function* () {
      const access = yield* FileAccess.Service
      yield* access.authorizeRead(baseline.absolute, invocation)
      const repository = yield* git.repo.discover(child.location.directory)
      const head = repository ? yield* git.history.head(repository) : undefined
      if (!repository || repository.worktree !== baseline.repository || !head)
        return yield* new ArtifactError({ message: "Artifact repository or HEAD changed after admission" })
      if (head !== baseline.commitSha) {
        if (!baseline.previous?.artifact)
          return yield* new ArtifactError({ message: "Artifact repository or HEAD changed after admission" })
        const parents = (yield* rawGit(repository.worktree, ["show", "-s", "--format=%P", head]))
          .toString("utf8")
          .trim()
        const trees = (yield* rawGit(repository.worktree, [
          "rev-parse",
          `${head}^{tree}`,
          `${baseline.commitSha}^{tree}`,
        ]))
          .toString("utf8")
          .trim()
          .split("\n")
        // The new identity must preserve the entire accepted tree, including paths outside this artifact.
        if (parents !== baseline.commitSha || trees.length !== 2 || trees[0] !== trees[1])
          return yield* new ArtifactError({
            message: "Artifact HEAD must be one direct empty commit from its baseline",
          })
      }
      const index = (yield* rawGit(repository.worktree, ["ls-files", "--stage", "-z", "--", baseline.path])).toString(
        "utf8",
      )
      if (index !== `100644 ${baseline.blob} 0\t${baseline.path}\0`)
        return yield* new ArtifactError({ message: "Artifact index changed after admission" })
      const target = yield* readArtifact(baseline.absolute)
      const targetSha256 = createHash("sha256").update(target).digest("hex")
      const normalizedDiff = yield* artifactDiff(repository.worktree, head, baseline.path)
      if (head !== baseline.commitSha) {
        if (
          targetSha256 !== baseline.previous?.artifact?.targetSha256 ||
          normalizedDiff !== baseline.previous?.artifact?.normalizedDiff
        )
          return yield* new ArtifactError({ message: "Artifact changed across the empty commit" })
        if ((yield* git.history.head(repository)) !== head)
          return yield* new ArtifactError({ message: "Artifact HEAD changed during capture" })
      }
      return new DelegationService.ArtifactEvidence({
        location: baseline.location,
        repository: baseline.repository,
        path: baseline.path,
        commitSha: head,
        baseSha256: baseline.baseSha256,
        targetSha256,
        normalizedDiff,
        revisionDigest: Delegation.RevisionDigest.make(
          DelegationDigest.calculateRevisionDigest({ commitSha: head, normalizedDiff }),
        ),
        changeKind: DelegationDigest.classifyChangeKind({
          baseCommitSha: baseline.previous?.artifact?.commitSha ?? baseline.commitSha,
          targetCommitSha: head,
          baseDiff: baseline.previous?.artifact?.normalizedDiff ?? "",
          targetDiff: normalizedDiff,
        }),
      })
    }).pipe(instances.provide(child))
  })

  const findInput = Effect.fnUntraced(function* (
    delegationID: DelegationID.ID,
    childSessionID: Session.ID,
    delivery: Omit<typeof Reference.Type, "delegationID">,
  ) {
    const id = inputID(delegationID, delivery)
    const pending = yield* SessionInbox.find(db, id)
    const visible = yield* store.message(id)
    const projected =
      pending?.type === "user" || pending?.type === "synthetic"
        ? { sessionID: pending.sessionID, payload: pending.payload }
        : visible?.message.type === "user" || visible?.message.type === "synthetic"
          ? { sessionID: visible.sessionID, payload: visible.message }
          : undefined
    // Cancelled inbox rows are removed. Retained admission still owns retry text and Task linkage.
    const admission = projected
      ? Option.none()
      : yield* bus.log({ aggregateID: childSessionID }).pipe(
          Stream.map((event) => {
            if (Bus.isSynced(event) || event.type !== SessionEvent.InboxEnqueued.type) return undefined
            const data = Schema.decodeUnknownOption(SessionEvent.InboxEnqueued.data)(event.data)
            if (Option.isNone(data) || data.value.inboxID !== id) return undefined
            const item = data.value.item
            if (item.type !== "user" && item.type !== "synthetic") return undefined
            return { sessionID: data.value.sessionID, payload: item.payload }
          }),
          Stream.filter((source) => source !== undefined),
          Stream.runHead,
        )
    const source = projected ?? Option.getOrUndefined(admission)
    const reference = decodeReference(source?.payload.metadata?.delegation)
    const matches =
      source !== undefined &&
      source.sessionID === childSessionID &&
      Option.isSome(reference) &&
      reference.value.delegationID === delegationID &&
      DelegationFold.deliveryKey(
        reference.value.turnID,
        reference.value.participantID,
        reference.value.deliveryOrigin,
        reference.value.senderParticipantID,
      ) ===
        DelegationFold.deliveryKey(
          delivery.turnID,
          delivery.participantID,
          delivery.deliveryOrigin,
          delivery.senderParticipantID,
        ) &&
      reference.value.attempt === delivery.attempt
    return { id, pending, visible, source, matches }
  })

  const requireInput = Effect.fnUntraced(function* (input: DeliveryRef) {
    const state = yield* requireState(input.delegationID)
    const participant = state.participants.get(input.participantID)
    if (!participant) return yield* new Delegation.DelegationParticipantNotFoundError(input)
    const delivery = [...state.deliveries.values()]
      .filter((item) => item.turnID === input.turnID && item.participantID === input.participantID)
      .sort((a, b) => b.attempt - a.attempt || b.updatedAt - a.updatedAt)[0]
    if (!delivery || !participant.childSessionID || participant.provider !== "internal")
      return yield* invalid(state, "input", "Delivery has no internal Session input")
    yield* delegations.bindParticipant({ ...input, childSessionID: participant.childSessionID })
    const saved = yield* findInput(input.delegationID, participant.childSessionID, delivery)
    if (!saved.matches || !saved.source)
      return yield* invalid(state, "input", "Delivery Session input cannot be verified")
    return { state, participant, delivery, saved, source: saved.source }
  })

  const ownsChild = Effect.fnUntraced(function* (state: DelegationFold.DelegationFoldState, recovery: Recovery) {
    // The domain command owns the binding rule and is idempotent for an unchanged binding.
    if (state.participants.get(recovery.participantID)?.childSessionID !== recovery.childSessionID) return false
    return yield* delegations
      .bindParticipant({
        delegationID: recovery.delegationID,
        participantID: recovery.participantID,
        childSessionID: recovery.childSessionID,
      })
      .pipe(
        Effect.as(true),
        Effect.catchTag("Delegation.DelegationInvalidStateError", () => Effect.succeed(false)),
      )
  })

  const resultText = (status: Result["status"], result: SessionInputResult.Result, fallback: string) =>
    status === "completed" && result.status === "completed"
      ? SubagentCompletion.text(result.assistant)
      : status === "failed" && result.status === "failed"
        ? (result.error?.message ?? fallback)
        : fallback

  const govern = Effect.fn("DelegationExecution.govern")(function* (
    recovery: Recovery,
    delivery: DelegationFold.DeliveryState,
    saved: Effect.Success<ReturnType<typeof findInput>>,
    result: SessionInputResult.Result,
  ) {
    const link = decodeTaskLink(saved.source?.payload.metadata?.task)
    if (Option.isNone(link) || (!link.value.artifact && !link.value.review)) return
    const state = yield* requireState(recovery.delegationID)
    if (!saved.matches || !link.value.source || !(yield* ownsChild(state, recovery)))
      return yield* invalid(state, "govern", "Governance requires the original completed Task input owner")
    if (result.status !== "completed") return
    const receipt = Schema.decodeUnknownSync(Delegation.Receipt)({
      ...new Reference({ delegationID: recovery.delegationID, ...delivery }),
      childSessionID: recovery.childSessionID,
      inputID: saved.id,
    })
    const source = link.value.source
    if (source.type !== "tool")
      return yield* invalid(state, "govern", "Artifact and review governance require the original Tool source")
    const key = `delegation:task-settlement:${DelegationReceipt.notificationID(saved.id, link.value.parentTaskID)}`
    const previous = yield* kv.get(key)
    const decoded = Schema.decodeUnknownOption(Schema.Struct({ governance: DelegationService.Governance }))(previous)
    const governance: DelegationService.Governance = Option.isSome(decoded)
      ? decoded.value.governance
      : yield* Effect.gen(function* () {
          if (terminal(delivery.status))
            return yield* invalid(
              state,
              "govern",
              "Completed governance has no retained result; reconciliation is required",
            )
          if (link.value.artifact) {
            const child = yield* sessions.get(recovery.childSessionID)
            return yield* captureArtifact(child, link.value.artifact, {
              sessionID: recovery.parentSessionID,
              agent: Agent.ID.make(link.value.artifact.agent),
              messageID: SessionMessage.ID.make(source.messageID),
              id: Tool.CallID.make(source.id),
            }).pipe(
              Effect.match({
                onSuccess: (artifact) => ({ kind: "revision" as const, receipt, source, artifact }),
                onFailure: (error) => ({
                  kind: "revision" as const,
                  status: "invalid" as const,
                  reason: error.message,
                  receipt,
                  source,
                }),
              }),
            )
          }
          const turn = state.turns.get(delivery.turnID)
          const review = DelegationParser.parseDelegationResult(SubagentCompletion.text(result.assistant))?.review
          const envelope = review?.status === "valid" ? review.envelope : undefined
          if (
            !envelope ||
            turn?.kind !== "review" ||
            turn.revisionDigest !== link.value.review?.revisionDigest ||
            envelope.reviewed_revision_digest !== turn.revisionDigest
          )
            return {
              kind: "review" as const,
              status: "invalid" as const,
              reason: !envelope ? (review?.status === "invalid" ? review.reason : "missing") : "wrong_digest",
              receipt,
              source,
            }
          return {
            kind: "review" as const,
            status: "valid" as const,
            receipt,
            source,
            reviewedRevisionDigest: envelope.reviewed_revision_digest,
            envelope,
          }
        })
    if (!isDeepStrictEqual(governance.receipt, receipt) || !isDeepStrictEqual(governance.source, source))
      return yield* invalid(state, "govern", "Retained governance belongs to a different receipt or source")
    if (Option.isNone(decoded))
      yield* kv.set(key, {
        governance: Schema.encodeSync(Schema.toCodecJson(DelegationService.Governance))(governance),
      })
    if (governance.kind === "revision" && "artifact" in governance) {
      const publication = yield* delegations
        .recordRevision({
          delegationID: recovery.delegationID,
          turnID: delivery.turnID,
          participantID: delivery.participantID,
          commitSha: governance.artifact.commitSha,
          revisionDigest: governance.artifact.revisionDigest,
          changeKind: governance.artifact.changeKind,
          diffSummary: governance.artifact.normalizedDiff.slice(0, 1000).replace(/[\uD800-\uDBFF]$/, ""),
          receipt,
          source,
        })
        .pipe(Effect.catchTag("Delegation.DelegationInvalidStateError", (error) => Effect.succeed(error)))
      if (typeof publication !== "string") {
        const rejected = {
          kind: "revision" as const,
          status: "invalid" as const,
          reason: publication.reason,
          receipt,
          source,
        }
        if (Option.isSome(decoded)) return yield* publication
        yield* kv.set(key, {
          governance: Schema.encodeSync(Schema.toCodecJson(DelegationService.Governance))(rejected),
        })
        return rejected
      }
      const producer = link.value.artifact?.previous
      if (
        publication === "reused" &&
        governance.artifact.changeKind === "no_change" &&
        !governance.producer &&
        producer &&
        producer.receipt.inputID !== receipt.inputID
      ) {
        const copied = {
          ...governance,
          producer: new DelegationService.RevisionReference({
            receipt: producer.receipt,
            source: producer.source,
            path: producer.path,
            revisionDigest: producer.revisionDigest,
          }),
        }
        const settlement = decodeTaskSettlement(previous)
        yield* kv.set(key, {
          ...(Option.isSome(settlement)
            ? { status: settlement.value.status, revision: settlement.value.revision }
            : {}),
          governance: Schema.encodeSync(Schema.toCodecJson(DelegationService.Governance))(copied),
        })
        return copied
      }
    }
    if (governance.kind === "review" && "envelope" in governance)
      yield* delegations.recordReview({
        delegationID: recovery.delegationID,
        turnID: delivery.turnID,
        participantID: delivery.participantID,
        reviewedRevisionDigest: governance.reviewedRevisionDigest,
        verdict: governance.envelope.verdict,
        findings: governance.envelope.findings,
        summary: governance.envelope.summary,
        receipt,
        source,
      })
    return governance
  })

  const writeback = Effect.fn("DelegationExecution.writeback")(function* (
    recovery: Recovery,
    delivery: DelegationFold.DeliveryState,
  ) {
    if (!terminal(delivery.status)) return false
    const status = delivery.status
    const saved = yield* findInput(recovery.delegationID, recovery.childSessionID, delivery)
    if (!saved.matches || !saved.source) return false
    const link = decodeTaskLink(saved.source.payload.metadata?.task)
    if (Option.isNone(link)) return false
    const result = yield* SessionInputResult.read(db, {
      sessionID: recovery.childSessionID,
      inputID: saved.id,
    }).pipe(Effect.orDie)
    // A cancelled queued input has no assistant. A completed receipt must retain its exact Session result.
    const text = resultText(status, result, delivery.summary ?? "Task requires reconciliation")
    const notificationID = DelegationReceipt.notificationID(saved.id, link.value.parentTaskID)
    const retained = Schema.decodeUnknownOption(Schema.Struct({ governance: DelegationService.Governance }))(
      yield* kv.get(`delegation:task-settlement:${notificationID}`),
    )
    yield* Effect.gen(function* () {
      const key = `delegation:task-settlement:${notificationID}`
      const previous = decodeTaskSettlement(yield* kv.get(key))
      const correction =
        Option.isSome(previous) && previous.value.status === "recovery_required" && status === "cancelled"
      if (Option.isSome(previous) && !correction) return
      const updated = yield* tasks
        .patch(
          {
            sessionID: recovery.parentSessionID,
            id: link.value.parentTaskID,
            status: status === "completed" ? "completed" : status === "cancelled" ? "cancelled" : "failed",
            outputDigest: DelegationReceipt.outputDigest(text),
            expect: correction ? ["failed"] : ["pending", "in_progress"],
            expectedRevision: Option.isSome(previous) ? previous.value.revision : link.value.parentTaskRevision,
          },
          {
            ...(link.value.source && status !== "recovery_required"
              ? { settle: { source: link.value.source, revision: link.value.parentTaskRevision } }
              : {}),
            commit: (task) =>
              kv.set(
                key,
                Schema.encodeSync(Schema.toCodecJson(TaskSettlement))(
                  new TaskSettlement({
                    status,
                    revision: task.revision,
                    ...(link.value.source?.type === "operation" && status !== "recovery_required"
                      ? { sourceSettlement: status === "cancelled" ? ("cancelled" as const) : ("completed" as const) }
                      : {}),
                    ...(Option.isSome(retained) ? { governance: retained.value.governance } : {}),
                  }),
                ),
              ),
          },
        )
        .pipe(Effect.orDie)
      if (updated) return
      if (link.value.source?.type !== "operation") return
      const present = (yield* tasks.get(recovery.parentSessionID)).some((task) => task.id === link.value.parentTaskID)
      if (link.value.source && status !== "recovery_required")
        yield* tasks.releaseClaim({
          sessionID: recovery.parentSessionID,
          id: link.value.parentTaskID,
          revision: link.value.parentTaskRevision,
          source: link.value.source,
        })
      yield* kv.set(
        key,
        Schema.encodeSync(Schema.toCodecJson(TaskSettlement))(
          new TaskSettlement({
            status,
            revision: link.value.parentTaskRevision,
            sourceSettlement: present ? "conflict" : "unavailable",
            ...(Option.isSome(retained) ? { governance: retained.value.governance } : {}),
          }),
        ),
      )
    }).pipe(Effect.uninterruptible)
    if (!link.value.background) return false
    const notification = { sessionID: recovery.parentSessionID, inboxID: notificationID }
    const decision = yield* SessionNotification.inspect(db, bus, store, notification)
    if (!decision.admit) return decision.wake
    const notificationText = `<task id="${recovery.childSessionID}" state="${delivery.status}">\n${text}\n</task>`
    const communication = yield* CommunicationRecord.prepareSystem(db, {
      inputID: notificationID,
      targetSessionID: recovery.parentSessionID,
      text: notificationText,
      actor: new SessionCommunication.SystemActor({
        type: "system",
        sessionID: recovery.childSessionID,
        origin: new SessionCommunication.DelegationOrigin({
          type: "delegation_delivery",
          delegationID: recovery.delegationID,
          participantID: delivery.participantID,
          turnID: delivery.turnID,
          deliveryOrigin: delivery.deliveryOrigin,
          senderParticipantID: delivery.senderParticipantID,
          attempt: delivery.attempt,
        }),
      }),
      contentSource: new SessionCommunication.ContentSource({ sessionID: recovery.childSessionID, scope: "result" }),
      delivery: "steer",
      trigger: true,
      createdAt: (yield* DateTime.nowAsDate).getTime(),
    }).pipe(Effect.orDie)
    // The input is the durable notification marker. Exact retries reuse it before any parent wake.
    yield* sessions
      .synthetic(
        {
          id: notificationID,
          sessionID: recovery.parentSessionID,
          description: link.value.description,
          text: communication.text,
          metadata: {
            source: "task",
            childID: recovery.childSessionID,
            state: delivery.status,
            parentTaskID: link.value.parentTaskID,
            inputID: saved.id,
            delegation: new Reference({ delegationID: recovery.delegationID, ...delivery }),
            communication: Schema.encodeSync(SessionCommunication.Record)(communication.record),
          },
          resume: false,
        },
        { communication: communication.record },
      )
      .pipe(
        Effect.catchTag("Session.NotFoundError", () => Effect.void),
        Effect.orDie,
      )
    const admitted = yield* SessionNotification.inspect(db, bus, store, notification)
    return !admitted.admit && admitted.wake
  })

  const waitInternal = (receipt: Receipt): Effect.Effect<Result, DelegationService.ServiceError> =>
    Effect.gen(function* () {
      const state = yield* requireState(receipt.delegationID)
      const owned = yield* ownsChild(state, {
        kind: "delegation",
        ...receipt,
        parentSessionID: state.delegation.parentSessionID,
        description: state.delegation.title,
      })
      const saved = yield* findInput(receipt.delegationID, receipt.childSessionID, receipt)
      if (!owned || !saved.matches || saved.id !== receipt.inputID)
        return yield* invalid(state, "wait", "Task receipt has conflicting Session input ownership")
      const statuses = {
        [DelegationEvent.DeliveryCompleted.type]: "completed",
        [DelegationEvent.DeliveryFailed.type]: "failed",
        [DelegationEvent.DeliveryCancelled.type]: "cancelled",
        [DelegationEvent.DeliveryRecoveryRequired.type]: "recovery_required",
      } as const
      const settled = yield* bus.log({ aggregateID: receipt.delegationID, follow: true }).pipe(
        Stream.map((event) => {
          if (Bus.isSynced(event) || !Object.hasOwn(statuses, event.type)) return undefined
          const status = statuses[event.type as keyof typeof statuses]
          const data = Schema.decodeUnknownOption(DelegationEvent.DeliveryCompletedData)(event.data)
          if (Option.isNone(data)) return undefined
          if (
            data.value.attempt !== receipt.attempt ||
            DelegationFold.deliveryKey(
              data.value.turnID,
              data.value.participantID,
              data.value.deliveryOrigin,
              data.value.senderParticipantID,
            ) !==
              DelegationFold.deliveryKey(
                receipt.turnID,
                receipt.participantID,
                receipt.deliveryOrigin,
                receipt.senderParticipantID,
              )
          )
            return undefined
          return { status, summary: data.value.summary }
        }),
        Stream.filter((result) => result !== undefined),
        Stream.runHead,
      )
      if (Option.isNone(settled)) return yield* invalid(state, "wait", "Delegation result log closed")
      const result = yield* SessionInputResult.read(db, {
        sessionID: receipt.childSessionID,
        inputID: receipt.inputID,
      }).pipe(Effect.orDie)
      if (settled.value.status === "completed" && result.status !== "completed")
        return yield* invalid(state, "wait", "Completed delivery has no verified Session result")
      const notifyParent = yield* locks.withLock(receipt.delegationID)(
        Effect.gen(function* () {
          const current = yield* requireState(receipt.delegationID)
          const recovery: Recovery = {
            kind: "delegation",
            ...receipt,
            parentSessionID: current.delegation.parentSessionID,
            description: current.delegation.title,
          }
          if (!(yield* ownsChild(current, recovery)))
            return yield* invalid(current, "wait", "Task receipt lost Session input ownership while waiting")
          return yield* writeback(recovery, { ...receipt, ...settled.value, updatedAt: 0 })
        }),
      )
      if (notifyParent) yield* execution.wake(state.delegation.parentSessionID)
      const link = decodeTaskLink(saved.source?.payload.metadata?.task)
      const retained = Option.isSome(link)
        ? Schema.decodeUnknownOption(Schema.Struct({ governance: DelegationService.Governance }))(
            yield* kv.get(
              `delegation:task-settlement:${DelegationReceipt.notificationID(saved.id, link.value.parentTaskID)}`,
            ),
          )
        : Option.none()
      const settlement = Option.isSome(link)
        ? decodeTaskSettlement(
            yield* kv.get(
              `delegation:task-settlement:${DelegationReceipt.notificationID(saved.id, link.value.parentTaskID)}`,
            ),
          )
        : Option.none()
      const latest =
        Option.isSome(link) && link.value.source?.type === "operation"
          ? yield* requireState(receipt.delegationID)
          : undefined
      const delivery = latest?.deliveries.get(
        DelegationFold.deliveryKey(
          receipt.turnID,
          receipt.participantID,
          receipt.deliveryOrigin,
          receipt.senderParticipantID,
        ),
      )
      const corrected =
        settled.value.status === "recovery_required" &&
        delivery?.attempt === receipt.attempt &&
        delivery.status === "cancelled"
      const status = corrected ? "cancelled" : settled.value.status
      return {
        status,
        text: resultText(status, result, (corrected ? delivery.summary : settled.value.summary) ?? "Task settled"),
        ...(Option.isSome(retained) ? { governance: retained.value.governance } : {}),
        ...(Option.isSome(link) &&
        link.value.source?.type === "operation" &&
        Option.isSome(settlement) &&
        settlement.value.sourceSettlement
          ? { sourceSettlement: settlement.value.sourceSettlement }
          : {}),
      }
    }).pipe(Effect.setContext(context))

  const settle = Effect.fn("DelegationExecution.settle")(function* (recovery: Recovery, cold: boolean) {
    const state = yield* delegations.foldState(recovery.delegationID)
    if (!state) return { done: true, summary: "Delegation removed", owned: false, notifyParent: false }
    if (!state.participants.has(recovery.participantID))
      return { done: true, summary: "Participant removed", owned: false, notifyParent: false }
    const owned = yield* ownsChild(state, recovery)
    const deliveries = [...state.deliveries.values()].filter((item) => item.participantID === recovery.participantID)
    let waiting = false
    let summary = "Delegation inputs settled"
    let notifyParent = false
    for (const delivery of deliveries) {
      if (terminal(delivery.status)) {
        if (owned) {
          const saved = yield* findInput(recovery.delegationID, recovery.childSessionID, delivery)
          if (saved.matches && delivery.status === "completed") {
            const result = yield* SessionInputResult.read(db, {
              sessionID: recovery.childSessionID,
              inputID: saved.id,
            }).pipe(Effect.orDie)
            yield* govern(recovery, delivery, saved, result)
          }
          notifyParent = (yield* writeback(recovery, delivery)) || notifyParent
        }
        continue
      }
      const saved = yield* findInput(recovery.delegationID, recovery.childSessionID, delivery)
      if (!saved.pending && !saved.visible && (!cold || (owned && delivery.status !== "running"))) continue
      const result =
        owned && saved.matches
          ? yield* SessionInputResult.read(db, { sessionID: recovery.childSessionID, inputID: saved.id }).pipe(
              Effect.orDie,
            )
          : { status: "unverified" as const }
      if (owned && saved.matches && saved.visible && (delivery.status === "admitted" || delivery.status === "queued"))
        yield* delegations.recordDelivery({ delegationID: recovery.delegationID, ...delivery, status: "started" })
      if (result.status === "pending" || result.status === "processing") {
        if (!cold) {
          waiting = true
          continue
        }
      }
      const status =
        result.status === "completed"
          ? "completed"
          : result.status === "failed"
            ? "failed"
            : result.status === "interrupted"
              ? "cancelled"
              : "recovery_required"
      if (owned && saved.matches)
        yield* govern(recovery, delivery, saved, result).pipe(
          Effect.onExit((exit) => {
            if (Exit.isSuccess(exit)) return Effect.void
            const status = Cause.hasInterruptsOnly(exit.cause) ? ("cancelled" as const) : ("failed" as const)
            const error = toSessionError(Cause.squash(exit.cause))
            const summary = error.message.slice(0, 4096).replace(/[\uD800-\uDBFF]$/, "")
            return delegations
              .recordDelivery({
                delegationID: recovery.delegationID,
                ...delivery,
                status,
                summary,
                errorCode: error.type,
              })
              .pipe(
                Effect.andThen(writeback(recovery, { ...delivery, status, summary, errorCode: error.type })),
                Effect.asVoid,
              )
          }),
        )
      summary = (
        result.status === "completed"
          ? result.assistant.content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n\n")
          : result.status === "failed"
            ? (result.error?.message ?? "Session failed")
            : result.status === "interrupted"
              ? "Session interrupted"
              : "Session input requires reconciliation before resuming"
      )
        .slice(0, 4096)
        .replace(/[\uD800-\uDBFF]$/, "")
      yield* delegations.recordDelivery({
        delegationID: recovery.delegationID,
        ...delivery,
        status,
        summary,
        errorCode:
          status === "recovery_required"
            ? "session_input_unverified"
            : result.status === "failed"
              ? result.error?.type
              : undefined,
      })
      if (owned) notifyParent = (yield* writeback(recovery, { ...delivery, status, summary })) || notifyParent
    }
    return { done: !waiting, summary, owned, notifyParent }
  })

  const activate = Effect.fn("DelegationExecution.activate")(function* (recovery: Recovery): Effect.fn.Return<void> {
    const info = yield* jobs.start({
      // SessionExecution cancels the child Session's foreground Job before publishing user interruption.
      id: `delegation:${recovery.participantID}`,
      type: "delegation",
      title: recovery.description,
      recovery,
      notificationID: SessionMessage.ID.create(),
      run: bus.log({ aggregateID: recovery.childSessionID, follow: true }).pipe(
        Stream.mapEffect(() => locks.withLock(recovery.delegationID)(settle(recovery, false))),
        Stream.tap((result) => (result.notifyParent ? execution.wake(recovery.parentSessionID) : Effect.void)),
        Stream.filter((result) => result.done),
        Stream.runHead,
        Effect.map((result) => (Option.isSome(result) ? result.value.summary : "Session event log closed")),
        Effect.tap(() => execution.awaitIdle(recovery.childSessionID)),
        Effect.orDie,
      ),
    })
    yield* jobs.background(info.id)
    const notificationID = info.notificationID
    if (!notificationID || observers.has(notificationID)) return
    observers.add(notificationID)
    yield* jobs.wait({ id: info.id }).pipe(
      Effect.andThen(
        locks.withLock(recovery.delegationID)(
          Effect.gen(function* () {
            const state = yield* delegations.foldState(recovery.delegationID)
            if (!state || ["closing", "completed", "cancelled", "archived"].includes(state.delegation.status)) return
            // A later input may already be visible or completed by the time awaitIdle returns.
            const result = yield* settle(recovery, false)
            if (!result.done) yield* activate(recovery)
            return result.notifyParent
          }),
        ),
      ),
      Effect.andThen((notifyParent) => (notifyParent ? execution.wake(recovery.parentSessionID) : Effect.void)),
      Effect.andThen(jobs.completeBackground(notificationID)),
      Effect.tapCause((cause) => Effect.logError("Delegation result reconciliation failed", cause)),
      Effect.ensuring(Effect.sync(() => observers.delete(notificationID))),
      Effect.forkIn(scope, { startImmediately: true }),
      Effect.setContext(context),
    )
  })

  const rejectUnadmittedTask = Effect.fnUntraced(function* (input: DispatchInput, cause: Cause.Cause<unknown>) {
    const task = input.task
    if (!task?.source) return
    const source = task.source
    const state = yield* requireState(input.delegationID)
    // One parent claim can belong to the whole turn's fanout.
    const deliveries = [...state.deliveries.values()].filter((delivery) => delivery.turnID === input.turnID)
    const states = yield* Effect.forEach(deliveries, (delivery) =>
      Effect.gen(function* () {
        if (delivery.status === "recovery_required") return "unknown" as const
        const childSessionID = state.participants.get(delivery.participantID)?.childSessionID
        if (!childSessionID) return "unadmitted" as const
        const saved = yield* findInput(input.delegationID, childSessionID, delivery)
        const link = decodeTaskLink(saved.source?.payload.metadata?.task)
        if (
          Option.isNone(link) ||
          link.value.parentTaskID !== task.parentTaskID ||
          link.value.parentTaskRevision !== task.parentTaskRevision ||
          !isDeepStrictEqual(link.value.source, source)
        )
          return "unadmitted" as const
        if (!saved.matches) return "unknown" as const
        return terminal(delivery.status) ? ("settled" as const) : ("unknown" as const)
      }),
    )
    if (states.includes("unknown")) return
    if (states.length > 0 && states.every((status) => status === "settled"))
      return yield* tasks.releaseClaim({
        sessionID: state.delegation.parentSessionID,
        id: task.parentTaskID,
        revision: task.parentTaskRevision,
        source,
      })
    yield* tasks
      .patch(
        {
          sessionID: state.delegation.parentSessionID,
          id: task.parentTaskID,
          expectedRevision: task.parentTaskRevision,
          expect: ["in_progress"],
          status:
            Cause.hasInterruptsOnly(cause) || ["closing", "cancelled", "archived"].includes(state.delegation.status)
              ? "cancelled"
              : "failed",
          outputDigest: Cause.pretty(cause),
        },
        { settle: { source, revision: task.parentTaskRevision } },
      )
      .pipe(Effect.mapError((error) => invalid(state, "dispatch", error.message)))
  })

  const dispatch = Effect.fn("DelegationExecution.dispatch")(function* (input: {
    readonly delegationID: DelegationID.ID
    readonly turnID: TurnID
    readonly prompt: string
    readonly task?: typeof TaskLink.Type
    readonly artifact?: DispatchInput["artifact"]
    readonly review?: DelegationService.RevisionReference
    readonly participantID?: ParticipantID
    readonly superseded?: { readonly sessionID: Session.ID; readonly inboxID: SessionMessage.ID }
  }) {
    const state = yield* requireState(input.delegationID)
    if (input.task?.source?.type === "operation") {
      const source = input.task.source
      const run = /^top_schedule_[a-f0-9]{64}$/.test(source.operationID)
        ? yield* schedules.occurrence(
            Schedule.OccurrenceID.make(`sco_${source.operationID.slice("top_schedule_".length)}`),
          )
        : undefined
      if (
        !run ||
        run.snapshot.target?.policy !== "legacy_child" ||
        run.snapshot.kind !== "task" ||
        run.sessionID !== state.delegation.parentSessionID ||
        source.sessionID !== run.sessionID ||
        run.taskID !== input.task.parentTaskID ||
        run.taskRevision !== input.task.parentTaskRevision ||
        input.prompt !== run.snapshot.content ||
        input.artifact ||
        input.review
      )
        return yield* invalid(
          state,
          "dispatch",
          "An operation source requires its exact persisted scheduled child claim",
        )
    }
    const turn = state.turns.get(input.turnID)
    if (!turn) return yield* new Delegation.DelegationTurnNotFoundError(input)
    const deliveries = [...state.deliveries.values()].filter(
      (delivery) =>
        delivery.turnID === turn.id &&
        !terminal(delivery.status) &&
        (input.participantID === undefined || delivery.participantID === input.participantID),
    )
    if (deliveries.length === 0) {
      yield* rejectUnadmittedTask(
        input,
        Cause.fail(invalid(state, "dispatch", "Task execution returned no delivery receipt")),
      )
      return []
    }
    if (["closing", "completed", "cancelled", "archived"].includes(state.delegation.status)) {
      const error = new Delegation.DelegationInvalidStateError({
        delegationID: input.delegationID,
        currentStatus: state.delegation.status,
        attemptedTransition: "dispatch",
        reason: "Delegation cannot accept execution",
      })
      yield* rejectUnadmittedTask(input, Cause.fail(error))
      return yield* error
    }
    const parent = yield* sessions.get(state.delegation.parentSessionID)
    // Validate the entire fanout before creating or waking any target.
    const targets = yield* Effect.forEach(
      turn.participantIDs.filter((id) => deliveries.some((delivery) => delivery.participantID === id)),
      (participantID) =>
        Effect.gen(function* () {
          const participant = state.participants.get(participantID)
          if (!participant)
            return yield* new Delegation.DelegationParticipantNotFoundError({
              delegationID: input.delegationID,
              participantID,
            })
          if (
            participant.provider !== "internal" ||
            participant.phase === "closed" ||
            (participant.phase === "failed" &&
              !deliveries.some((delivery) => delivery.participantID === participantID && delivery.attempt > 1))
          )
            return yield* new Delegation.DelegationInvalidStateError({
              delegationID: input.delegationID,
              currentStatus: participant.phase,
              attemptedTransition: "dispatch",
              reason: `Participant provider ${participant.provider} is not available for this execution slice`,
            })
          const agent =
            parent.mode === "custom"
              ? (yield* compositions.selectAgent(parent.id, participant.target)).info
              : yield* Plugin.awaitActivation.pipe(
                  Effect.andThen(Agent.Service.use((agents) => agents.resolve(participant.target))),
                  instances.provide(parent),
                  Effect.orDie,
                )
          if (!agent || agent.mode === "primary")
            return yield* new Delegation.DelegationInvalidStateError({
              delegationID: input.delegationID,
              currentStatus: participant.phase,
              attemptedTransition: "dispatch",
              reason: `Target ${participant.target} is not a subagent`,
            })
          if (
            state.delegation.metaAgentID &&
            (parent.controller?.kind !== "root" ||
              parent.controller.metaAgentID !== state.delegation.metaAgentID ||
              !participant.executor ||
              participant.executor.agent !== agent.id)
          )
            return yield* invalid(state, "dispatch", "Meta dispatch requires the saved participant binding")
          if (participant.childSessionID)
            yield* delegations.bindParticipant({
              delegationID: input.delegationID,
              participantID,
              childSessionID: participant.childSessionID,
            })
          if (
            [...state.deliveries.values()].some(
              (delivery) => delivery.participantID === participantID && delivery.status === "recovery_required",
            )
          )
            return yield* invalid(
              state,
              "dispatch",
              "Participant has unresolved Session inputs; reconcile them before executing new work",
            )
          return { participant, agent }
        }),
    ).pipe(Effect.onError((cause) => rejectUnadmittedTask(input, cause).pipe(Effect.orDie)))
    const prepared = yield* Effect.forEach(targets, (target) =>
      Effect.gen(function* () {
        const childID = target.participant.childSessionID ?? Session.ID.make(`ses_delegation_${target.participant.id}`)
        const executor = state.delegation.metaAgentID ? target.participant.executor : undefined
        const source = new SessionSchema.TaskControllerSource({
          kind: "task",
          delegationID: state.delegation.id,
          participantID: target.participant.id,
        })
        const child = target.participant.childSessionID
          ? yield* sessions.get(childID)
          : target.participant.context === "fork"
            ? yield* sessions.fork({
                id: childID,
                sessionID: parent.id,
                child: true,
                control: executor ? "meta" : undefined,
                agent: target.agent.id,
                model: executor?.model,
                executor,
                source,
              })
            : yield* sessions.create({
                id: childID,
                parentID: parent.id,
                title: state.delegation.title,
                agent: target.agent.id,
                model: executor?.model ?? target.agent.model ?? parent.model,
                executor,
                source,
              })
        yield* delegations.bindParticipant({
          delegationID: input.delegationID,
          participantID: target.participant.id,
          childSessionID: child.id,
        })
        if (
          executor &&
          (child.controller?.kind !== "child" ||
            !sameExecutor(child.controller.executor, executor) ||
            !bindingMatches(child))
        )
          return yield* invalid(state, "dispatch", "Saved child and participant bindings disagree")
        if (!executor && child.agent !== target.agent.id)
          yield* sessions.switchAgent({ sessionID: child.id, agent: target.agent.id })
        return { participant: target.participant, child }
      }),
    ).pipe(Effect.onError((cause) => rejectUnadmittedTask(input, cause).pipe(Effect.orDie)))
    const admissions: { id: SessionMessage.ID; created: boolean }[] = []
    yield* Effect.gen(function* () {
      for (const target of prepared) {
        const artifact = input.artifact
          ? yield* prepareArtifact({ child: target.child, ...input.artifact }).pipe(
              Effect.mapError((error) => invalid(state, "dispatch", error.message)),
            )
          : undefined
        for (const delivery of deliveries.filter((delivery) => delivery.participantID === target.participant.id)) {
          const saved = yield* findInput(input.delegationID, target.child.id, delivery)
          if ((saved.pending || saved.visible) && !saved.matches)
            return yield* invalid(state, "dispatch", "Existing delivery Session input has conflicting provenance")
          yield* sessions.prompt({
            id: saved.id,
            sessionID: target.child.id,
            text: input.prompt,
            delivery: turn.delivery,
            resume: false,
            metadata: {
              delegation: new Reference({ delegationID: input.delegationID, ...delivery }),
              ...(input.task
                ? {
                    task: new TaskLink({
                      ...input.task,
                      ...(artifact ? { artifact } : {}),
                      ...(input.review ? { review: input.review } : {}),
                    }),
                  }
                : {}),
            },
          })
          admissions.push({ id: saved.id, created: !saved.pending && !saved.visible })
        }
        yield* activate({
          kind: "delegation",
          delegationID: input.delegationID,
          participantID: target.participant.id,
          childSessionID: target.child.id,
          parentSessionID: parent.id,
          description: state.delegation.title,
        })
      }
      if (input.superseded) yield* sessions.cancelInbox(input.superseded)
      // All fanout inputs precede advisory wakes. Already active Sessions retain their normal safe-boundary admission.
      yield* Effect.forEach(prepared, (target) => execution.wake(target.child.id), { discard: true })
    }).pipe(
      Effect.onError((cause) =>
        Effect.gen(function* () {
          if (admissions.length === 0) return
          const error = toSessionError(Cause.squash(cause))
          const summary = error.message.slice(0, 4096).replace(/[\uD800-\uDBFF]$/, "")
          const current = yield* requireState(input.delegationID)
          for (const target of prepared) {
            const recovery: Recovery = {
              kind: "delegation",
              delegationID: input.delegationID,
              participantID: target.participant.id,
              childSessionID: target.child.id,
              parentSessionID: parent.id,
              description: state.delegation.title,
            }
            const owned = yield* ownsChild(current, recovery)
            for (const delivery of deliveries.filter((delivery) => delivery.participantID === target.participant.id)) {
              const latest = current.deliveries.get(
                DelegationFold.deliveryKey(
                  delivery.turnID,
                  delivery.participantID,
                  delivery.deliveryOrigin,
                  delivery.senderParticipantID,
                ),
              )
              if (!latest || latest.attempt !== delivery.attempt || terminal(latest.status)) continue
              const saved = yield* findInput(input.delegationID, target.child.id, delivery)
              if (
                owned &&
                saved.matches &&
                saved.pending &&
                admissions.some((item) => item.id === saved.id && item.created)
              ) {
                // cancelInbox checks pending state under the same Session serialization as promotion.
                const cancelled = yield* sessions.cancelInbox({ sessionID: target.child.id, inboxID: saved.id }).pipe(
                  Effect.as(true),
                  Effect.catchTag("Session.InboxConflictError", () => Effect.succeed(false)),
                )
                if (cancelled) {
                  yield* delegations.recordDelivery({
                    delegationID: input.delegationID,
                    ...delivery,
                    status: "cancelled",
                    summary: "Fanout dispatch failed before input delivery",
                  })
                  continue
                }
              }
              if (owned && saved.matches) continue
              yield* delegations.recordDelivery({
                delegationID: input.delegationID,
                ...delivery,
                status:
                  owned && !saved.source
                    ? Cause.hasInterruptsOnly(cause)
                      ? "cancelled"
                      : "failed"
                    : "recovery_required",
                summary,
                errorCode: owned && !saved.source ? error.type : "session_input_unverified",
              })
            }
            // Existing observers settle normally after cancellation; shared Jobs and active Sessions keep their owner.
            const result = yield* settle(recovery, false)
            if (result.notifyParent) yield* execution.wake(parent.id)
          }
        }).pipe(Effect.andThen(rejectUnadmittedTask(input, cause)), Effect.orDie),
      ),
    )
    return prepared.flatMap((target) =>
      deliveries
        .filter((delivery) => delivery.participantID === target.participant.id)
        .map((delivery) => ({
          ...new Reference({ delegationID: input.delegationID, ...delivery }),
          childSessionID: target.child.id,
          inputID: inputID(input.delegationID, delivery),
        })),
    )
  })

  const recover = (recovery: Recovery) =>
    locks
      .withLock(recovery.delegationID)(
        Effect.gen(function* () {
          const deferred = new RecoveryResult({ status: "deferred", childSessionID: recovery.childSessionID })
          if (!bus.retainsEvents || (yield* execution.isActive(recovery.childSessionID))) return deferred
          if (!ProductModePolicy.isCustomModeEnabled()) {
            const parent = yield* store.get(recovery.parentSessionID)
            const child = yield* store.get(recovery.childSessionID)
            if (parent?.mode === "custom" || child?.mode === "custom") return deferred
          }
          const result = yield* settle(recovery, true)
          if (!result.done) return deferred
          const job = yield* jobs.cancel(`delegation:${recovery.participantID}`)
          if (result.owned) yield* store.release(recovery.childSessionID)
          if (job?.notificationID) yield* jobs.completeBackground(job.notificationID)
          return new RecoveryResult({
            status: "reconciled",
            childSessionID: recovery.childSessionID,
            ...(result.notifyParent ? { parentSessionID: recovery.parentSessionID } : {}),
          })
        }),
      )
      .pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterrupts(cause))
            return Effect.failCause(
              // orDie keeps only the first typed failure; retain every interruption reason.
              Cause.fromReasons<never>(
                cause.reasons.map((reason) =>
                  Cause.isFailReason(reason) ? Cause.makeDieReason(reason.error) : reason,
                ),
              ),
            )
          return Effect.die(Cause.squash(cause))
        }),
        Effect.setContext(context),
      )

  const externalCall = Effect.fnUntraced(function* (
    binding: Pick<DelegationReceipt.Binding, "parentSessionID" | "source" | "agent">,
  ) {
    const message = yield* sessions.message({
      sessionID: binding.parentSessionID,
      messageID: binding.source.messageID,
    })
    if (message?.type !== "assistant" || message.agent !== binding.agent) return
    const call = message.content.find(
      (part) => part.type === "tool" && part.id === binding.source.id && part.name === "task",
    )
    return call?.type === "tool" ? call : undefined
  })

  const readToolText = Effect.fnUntraced(function* (call: SessionMessage.AssistantTool) {
    if (call.state.status !== "completed") return Option.none<string>()
    return call.state.metadata?.truncated === true && typeof call.state.metadata.outputPath === "string"
      ? yield* files.readFileString(call.state.metadata.outputPath).pipe(Effect.option)
      : Option.some(call.state.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""))
  })
  const readExternalOutput = Effect.fnUntraced(function* (call: SessionMessage.AssistantTool) {
    return Option.flatMap(yield* readToolText(call), DelegationReceipt.decodeOutput)
  })

  const findExternalJob = (key: string) =>
    [...externalJobs.entries()].find(([jobKey, entry]) => jobKey === key || entry.inputs.has(key))

  const requireExternalSteerOwner = Effect.fnUntraced(function* (input: ExternalSteerOwnerInput) {
    const state = yield* requireState(input.delegationID)
    const parent = yield* sessions.get(input.parentSessionID)
    const participant = state.participants.get(input.participantID)
    const owners = [...externalJobs.entries()].filter(
      ([, entry]) =>
        !entry.stopping &&
        (entry.binding.transport === "sdk"
          ? entry.sdk !== undefined && !entry.sdk.ended && entry.binding.review === undefined
          : entry.binding.externalTurnID !== undefined) &&
        entry.binding.delegationID === input.delegationID &&
        entry.binding.participantID === input.participantID,
    )
    const owner = owners.at(0)
    if (!owner || owners.length !== 1)
      return yield* invalid(state, "steer", "The participant has no unique active local Job")
    const binding = owner[1].binding
    const job = yield* jobs.get(owner[0])
    const delivery = state.deliveries.get(
      DelegationFold.deliveryKey(
        binding.turnID,
        binding.participantID,
        binding.deliveryOrigin,
        binding.senderParticipantID,
      ),
    )
    if (binding.transport === "sdk") {
      const saved = Schema.decodeUnknownOption(DelegationReceipt.Binding)(yield* kv.get(owner[0]))
      const call = yield* externalCall(binding)
      const ack = call ? yield* readExternalOutput(call) : Option.none<DelegationReceipt.Output>()
      if (
        !owner[1].sdk ||
        owner[1].sdk.ended ||
        state.delegation.parentSessionID !== parent.id ||
        parent.mode === "custom" ||
        binding.parentSessionID !== parent.id ||
        binding.agent !== input.agent ||
        binding.background !== true ||
        binding.location.directory !== parent.location.directory ||
        binding.location.workspaceID !== parent.location.workspaceID ||
        !binding.externalThreadID ||
        binding.externalTurnID !== undefined ||
        participant?.provider !== "claude-code" ||
        participant.target !== "claude-code" ||
        participant.role !== "implementer" ||
        participant.phase === "closed" ||
        participant.externalThreadID !== binding.externalThreadID ||
        ["closing", "completed", "cancelled", "archived"].includes(state.delegation.status) ||
        (state.delegation.metaAgentID &&
          (parent.controller?.kind !== "root" || parent.controller.metaAgentID !== state.delegation.metaAgentID)) ||
        delivery?.attempt !== binding.attempt ||
        job?.status !== "running" ||
        job.metadata?.sessionID !== parent.id ||
        !binding.sdkInput?.observations.some(
          (observation) =>
            observation instanceof DelegationReceipt.SdkLifecycle &&
            observation.state === "started" &&
            observation.session_id === binding.externalThreadID,
        ) ||
        Option.isNone(saved) ||
        saved.value.command !== binding.command ||
        saved.value.sdkInput?.uuid !== binding.sdkInput?.uuid ||
        !DelegationReceipt.matches(saved.value, DelegationReceipt.pending(binding, binding.execution ?? "admitted")) ||
        !call ||
        Option.isNone(ack) ||
        !DelegationReceipt.isBackgroundAck(binding, call, ack.value)
      )
        return yield* invalid(state, "steer", "The original started SDK Query owner is unavailable or changed")
      return { parent, owner, externalThreadID: binding.externalThreadID, externalTurnID: undefined }
    }
    if (
      state.delegation.parentSessionID !== parent.id ||
      parent.mode === "custom" ||
      binding.parentSessionID !== parent.id ||
      binding.agent !== input.agent ||
      binding.location.directory !== parent.location.directory ||
      binding.location.workspaceID !== parent.location.workspaceID ||
      binding.background !== true ||
      !binding.externalThreadID ||
      !binding.externalTurnID ||
      participant?.provider !== "codex" ||
      participant.target !== "codex" ||
      participant.role !== "implementer" ||
      participant.phase === "closed" ||
      participant.phase === "failed" ||
      participant.externalThreadID !== binding.externalThreadID ||
      ["closing", "completed", "cancelled", "archived"].includes(state.delegation.status) ||
      (state.delegation.metaAgentID &&
        (parent.controller?.kind !== "root" || parent.controller.metaAgentID !== state.delegation.metaAgentID)) ||
      delivery?.attempt !== binding.attempt ||
      delivery.status !== "running" ||
      job?.status !== "running" ||
      job.metadata?.sessionID !== parent.id ||
      [...state.deliveries.values()].some(
        (value) => value.participantID === input.participantID && value.status === "recovery_required",
      )
    )
      return yield* invalid(state, "steer", "The original background execution owner is unavailable or changed")
    const saved = Schema.decodeUnknownOption(DelegationReceipt.Binding)(yield* kv.get(owner[0]))
    if (
      Option.isNone(saved) ||
      saved.value.command !== binding.command ||
      saved.value.agent !== binding.agent ||
      saved.value.location.directory !== binding.location.directory ||
      saved.value.location.workspaceID !== binding.location.workspaceID ||
      !DelegationReceipt.matches(
        saved.value,
        new DelegationReceipt.External({
          ...binding,
          externalThreadID: binding.externalThreadID,
          externalTurnID: binding.externalTurnID,
        }),
      )
    )
      return yield* invalid(state, "steer", "The original durable execution binding changed")
    const call = yield* externalCall(binding)
    const ack = call ? yield* readExternalOutput(call) : Option.none<DelegationReceipt.Output>()
    if (!call || Option.isNone(ack) || !DelegationReceipt.isBackgroundAck(binding, call, ack.value))
      return yield* invalid(state, "steer", "The original Job has no exact committed background ACK")
    // A Task edit can supersede a claim without invalidating its still-running native Job.
    return { parent, owner, externalThreadID: binding.externalThreadID, externalTurnID: binding.externalTurnID }
  })

  const settleExternalInputs = Effect.fnUntraced(function* (
    delegationID: DelegationID.ID,
    bindings: Iterable<DelegationReceipt.Binding>,
    result: Result,
    errorCode?: string,
  ) {
    const state = yield* requireState(delegationID)
    yield* Effect.forEach(
      [...bindings],
      (binding) =>
        Effect.gen(function* () {
          const resultCompletion =
            (binding.transport === "sdk" || binding.transport === "acp" || binding.transport === "jsonl") &&
            result.status === "completed"
          const delivery = state.deliveries.get(
            DelegationFold.deliveryKey(
              binding.turnID,
              binding.participantID,
              binding.deliveryOrigin,
              binding.senderParticipantID,
            ),
          )
          if (!delivery || delivery.attempt !== binding.attempt) {
            if (resultCompletion) return yield* invalid(state, "settle", "This result delivery execution claim changed")
            return
          }
          const status = terminal(delivery.status) ? delivery.status : result.status
          if (resultCompletion && status !== "completed")
            return yield* invalid(state, "settle", "This Task already has a different terminal outcome")
          if (!resultCompletion && !terminal(delivery.status))
            yield* delegations.recordDelivery({
              ...binding,
              status,
              summary: DelegationReceipt.outputDigest(result.text),
              errorCode,
            })
          const receipt = DelegationReceipt.fromBinding(binding)
          const review =
            binding.review &&
            status === "completed" &&
            (receipt instanceof DelegationReceipt.External || receipt instanceof DelegationReceipt.Sdk)
              ? DelegationParser.parseDelegationResult(result.text)?.review
              : undefined
          const envelope = review?.status === "valid" ? review.envelope : undefined
          const governance =
            binding.review &&
            (receipt instanceof DelegationReceipt.External || receipt instanceof DelegationReceipt.Sdk) &&
            status === "completed"
              ? envelope && envelope.reviewed_revision_digest === binding.review.revisionDigest
                ? {
                    kind: "review" as const,
                    status: "valid" as const,
                    receipt,
                    source: binding.source,
                    reviewedRevisionDigest: envelope.reviewed_revision_digest,
                    envelope,
                  }
                : {
                    kind: "review" as const,
                    status: "invalid" as const,
                    receipt,
                    source: binding.source,
                    reason: envelope ? "wrong_digest" : review?.status === "invalid" ? review.reason : "missing",
                  }
              : undefined
          const patched = yield* tasks
            .patch(
              {
                sessionID: binding.parentSessionID,
                id: binding.parentTaskID,
                expectedRevision: binding.parentTaskRevision,
                expect: ["in_progress"],
                status: status === "completed" ? "completed" : status === "cancelled" ? "cancelled" : "failed",
                outputDigest: DelegationReceipt.outputDigest(result.text),
              },
              {
                ...(status !== "recovery_required"
                  ? { settle: { source: binding.source, revision: binding.parentTaskRevision } }
                  : {}),
                ...(governance ||
                binding.transport === "sdk" ||
                binding.transport === "acp" ||
                binding.transport === "jsonl"
                  ? {
                      commit: () =>
                        kv.set(
                          DelegationReceipt.key(binding),
                          Schema.encodeSync(Schema.toCodecJson(DelegationReceipt.Binding))(
                            new DelegationReceipt.Binding({
                              ...binding,
                              settlement: { status, text: result.text, ...(governance ? { governance } : {}) },
                            }),
                          ),
                        ),
                    }
                  : {}),
              },
            )
            .pipe(Effect.catchTag("SessionTask.TaskWriteError", () => Effect.void))
          if (resultCompletion) {
            if (!patched) {
              const task = (yield* tasks.get(binding.parentSessionID)).find((task) => task.id === binding.parentTaskID)
              const saved = Schema.decodeUnknownOption(DelegationReceipt.Binding)(
                yield* kv.get(DelegationReceipt.key(binding)),
              )
              if (
                !task ||
                task.status !== "completed" ||
                task.revision !== binding.parentTaskRevision + 1 ||
                task.outputDigest !== DelegationReceipt.outputDigest(result.text) ||
                !(
                  receipt instanceof DelegationReceipt.Sdk ||
                  receipt instanceof DelegationReceipt.Acp ||
                  receipt instanceof DelegationReceipt.Jsonl
                ) ||
                Option.isNone(saved) ||
                !DelegationReceipt.matches(saved.value, receipt) ||
                saved.value.settlement?.status !== "completed" ||
                saved.value.settlement.text !== result.text
              )
                return yield* invalid(state, "settle", "This Task execution claim was superseded or cancelled")
              if (governance && !saved.value.settlement.governance)
                yield* kv.set(
                  DelegationReceipt.key(binding),
                  Schema.encodeSync(Schema.toCodecJson(DelegationReceipt.Binding))(
                    new DelegationReceipt.Binding({
                      ...saved.value,
                      settlement: { ...saved.value.settlement, governance },
                    }),
                  ),
                )
            }
            const current = yield* requireState(delegationID)
            const settled = current.deliveries.get(
              DelegationFold.deliveryKey(
                binding.turnID,
                binding.participantID,
                binding.deliveryOrigin,
                binding.senderParticipantID,
              ),
            )
            if (
              !settled ||
              settled.attempt !== binding.attempt ||
              (terminal(settled.status) && settled.status !== "completed")
            )
              return yield* invalid(current, "settle", "This result delivery was superseded or cancelled")
            if (settled.status !== "completed")
              yield* delegations.recordDelivery({
                ...binding,
                status: "completed",
                summary: DelegationReceipt.outputDigest(result.text),
                errorCode,
              })
          }
          if (governance?.status === "valid")
            yield* delegations.recordReview({
              ...binding,
              reviewedRevisionDigest: governance.reviewedRevisionDigest,
              verdict: governance.envelope.verdict,
              findings: governance.envelope.findings,
              summary: governance.envelope.summary,
              receipt: governance.receipt,
              source: governance.source,
            })
        }),
      { discard: true },
    )
  })

  const settleSdkInput = Effect.fnUntraced(function* (
    entry: ExternalJob,
    key: string,
    binding: DelegationReceipt.Binding,
    result: Result,
    message?: DelegationReceipt.SdkMessage,
  ) {
    if (binding.settlement) return
    const saved = new DelegationReceipt.Binding({
      ...binding,
      ...(message ? { sdkMessage: message } : {}),
      settlement: result,
    })
    entry.inputs.set(key, saved)
    if (key === DelegationReceipt.key(entry.binding)) entry.binding = saved
    // Keep the complete producer result before the original Task CAS.
    yield* kv.set(key, Schema.encodeSync(DelegationReceipt.Binding)(saved))
    const ready = entry.sdk?.waiters.get(key)
    const committed = yield* settleExternalInputs(saved.delegationID, [saved], result).pipe(
      Effect.as(true),
      Effect.catchTag("Delegation.DelegationInvalidStateError", (error) =>
        ready ? Deferred.fail(ready, error).pipe(Effect.as(false)) : Effect.succeed(false),
      ),
    )
    if (!committed || !ready) return
    const receipt = DelegationReceipt.fromBinding(saved)
    if (result.status === "completed" && receipt instanceof DelegationReceipt.Sdk)
      return yield* Deferred.succeed(ready, receipt).pipe(Effect.asVoid)
    const state = yield* requireState(saved.delegationID)
    yield* Deferred.fail(ready, invalid(state, "result", result.text))
  })

  const observeSdk = Effect.fnUntraced(function* (
    key: string,
    entry: ExternalJob,
    observation: DelegationReceipt.SdkObservation,
  ) {
    return yield* locks.withLock(entry.binding.delegationID)(
      Effect.gen(function* () {
        if (!entry.sdk || entry.stopping) return
        const state = yield* requireState(entry.binding.delegationID)
        const sessionID = observation.session_id
        if (observation instanceof DelegationReceipt.SdkSessionObservation) {
          if (entry.binding.externalThreadID && entry.binding.externalThreadID !== sessionID)
            return yield* invalid(state, "bind", "SDK initialization changed its original session")
          yield* delegations.bindParticipant({
            delegationID: entry.binding.delegationID,
            participantID: entry.binding.participantID,
            externalThreadID: sessionID,
          })
          yield* Effect.forEach(
            [...entry.inputs.entries()],
            ([inputKey, binding]) =>
              Effect.gen(function* () {
                const saved = new DelegationReceipt.Binding({ ...binding, externalThreadID: sessionID })
                entry.inputs.set(inputKey, saved)
                if (inputKey === key) entry.binding = saved
                yield* kv.set(inputKey, Schema.encodeSync(DelegationReceipt.Binding)(saved))
              }),
            { discard: true },
          )
          return
        }
        const legacy =
          observation instanceof DelegationReceipt.SdkResultObservation &&
          observation.user_message_uuid === undefined &&
          entry.inputs.size === 1 &&
          !sdkInputProtocol(entry.binding)
        const input = [...entry.inputs.entries()].find(
          ([, binding]) =>
            binding.sdkInput?.uuid ===
            (observation instanceof DelegationReceipt.SdkLifecycle
              ? observation.command_uuid
              : observation.user_message_uuid),
        )
        if (
          !input ||
          !input[1].sdkInput ||
          (entry.binding.externalThreadID && sessionID !== entry.binding.externalThreadID)
        ) {
          entry.binding = new DelegationReceipt.Binding({
            ...entry.binding,
            sdkObservations: [...(entry.binding.sdkObservations ?? []), observation],
          })
          entry.inputs.set(key, entry.binding)
          yield* kv.set(key, Schema.encodeSync(DelegationReceipt.Binding)(entry.binding))
          if (!legacy || entry.sdk.ended) return
          // A legacy result ends stdin; the normalized completion below owns its acceptance and Task CAS.
          entry.sdk.ended = true
          return yield* Queue.end(entry.sdk.feed)
        }
        const binding = new DelegationReceipt.Binding({
          ...input[1],
          ...(sessionID ? { externalThreadID: sessionID } : {}),
          sdkInput: new DelegationReceipt.SdkInput({
            ...input[1].sdkInput,
            observations: [...input[1].sdkInput.observations, observation],
          }),
        })
        entry.inputs.set(input[0], binding)
        if (input[0] === key) entry.binding = binding
        const lifecycle = sdkLifecycle(binding)
        const completion =
          observation instanceof DelegationReceipt.SdkResultObservation &&
          !binding.settlement &&
          observation.subtype === "success" &&
          observation.is_error === false &&
          observation.terminal_reason === "completed" &&
          observation.session_id &&
          observation.uuid &&
          observation.result?.trim() &&
          lifecycle?.state !== "cancelled" &&
          lifecycle?.state !== "discarded"
            ? {
                text: observation.result,
                message: new DelegationReceipt.SdkMessage({
                  sessionID: observation.session_id,
                  messageID: observation.uuid,
                }),
              }
            : undefined
        const reused =
          completion &&
          (entry.previousSdkMessage?.messageID === completion.message.messageID ||
            [...entry.inputs.entries()].some(
              ([inputKey, value]) =>
                inputKey !== input[0] && value.sdkMessage?.messageID === completion.message.messageID,
            ))
        // A valid success has one first durable observation/checkpoint, before the original Task CAS.
        if (!completion || reused) yield* kv.set(input[0], Schema.encodeSync(DelegationReceipt.Binding)(binding))
        if (sessionID && !state.participants.get(binding.participantID)?.externalThreadID)
          yield* delegations.bindParticipant({
            delegationID: binding.delegationID,
            participantID: binding.participantID,
            externalThreadID: sessionID,
          })
        const delivery = state.deliveries.get(
          DelegationFold.deliveryKey(
            binding.turnID,
            binding.participantID,
            binding.deliveryOrigin,
            binding.senderParticipantID,
          ),
        )
        if (
          observation instanceof DelegationReceipt.SdkLifecycle &&
          observation.state === "started" &&
          !binding.settlement &&
          delivery?.attempt === binding.attempt &&
          delivery.status === "admitted"
        )
          yield* delegations.recordDelivery({ ...binding, status: "started" })
        if (
          observation instanceof DelegationReceipt.SdkLifecycle &&
          (observation.state === "cancelled" || observation.state === "discarded")
        )
          yield* settleSdkInput(entry, input[0], binding, {
            status: "cancelled",
            text: `SDK input reported ${observation.state}`,
          })
        if (completion && !reused)
          yield* settleSdkInput(
            entry,
            input[0],
            binding,
            { status: "completed", text: completion.text },
            completion.message,
          )
        if (reused)
          yield* settleSdkInput(entry, input[0], binding, {
            status: "failed",
            text: "SDK result reused a message identity already owned by its predecessor or another input",
          })
        if (
          observation instanceof DelegationReceipt.SdkResultObservation &&
          !binding.settlement &&
          observation.is_error === true
        )
          yield* settleSdkInput(entry, input[0], binding, {
            status: "failed",
            text: observation.result || observation.errors?.join("\n") || "SDK input failed without error details",
          })
        const consumed = [...entry.inputs.values()].every((value) => {
          const lifecycle = sdkLifecycle(value)
          if (!lifecycle) return value.settlement !== undefined
          if (lifecycle.state === "cancelled" || lifecycle.state === "discarded") return true
          return lifecycle.state === "completed" && value.settlement !== undefined
        })
        if (!consumed || entry.sdk.ended) return
        // Native input termination and output EOF are distinct; held result frames still drain below.
        entry.sdk.ended = true
        yield* Queue.end(entry.sdk.feed)
      }),
    )
  })

  const notifyExternal = Effect.fn("DelegationExecution.notifyExternal")(function* (
    binding: DelegationReceipt.Binding,
    result: Result,
  ) {
    if (yield* jobs.isDeletingSession(binding.parentSessionID)) return false
    const parent = yield* store.get(binding.parentSessionID)
    if (
      !parent ||
      parent.mode === "custom" ||
      parent.location.directory !== binding.location.directory ||
      parent.location.workspaceID !== binding.location.workspaceID
    )
      return false
    const receipt = DelegationReceipt.fromBinding(binding)
    if (
      !receipt ||
      !DelegationReceipt.matches(binding, receipt) ||
      (receipt instanceof DelegationReceipt.Pending && result.status === "completed")
    )
      return false
    const call = yield* externalCall(binding)
    if (!call || call.state.status !== "completed") return false
    const ack = yield* readExternalOutput(call)
    if (Option.isNone(ack) || !DelegationReceipt.isBackgroundAck(binding, call, ack.value)) return false
    const state = yield* requireState(binding.delegationID)
    const delivery = state.deliveries.get(
      DelegationFold.deliveryKey(
        binding.turnID,
        binding.participantID,
        binding.deliveryOrigin,
        binding.senderParticipantID,
      ),
    )
    if (
      state.delegation.parentSessionID !== parent.id ||
      ["closing", "completed", "cancelled", "archived"].includes(state.delegation.status) ||
      (state.participants.get(binding.participantID)?.externalThreadID !== binding.externalThreadID &&
        !(binding.transport === "sdk" && binding.externalThreadID === undefined)) ||
      delivery?.attempt !== binding.attempt ||
      delivery.status !== result.status ||
      (result.status === "completed" && delivery.externalTurnID !== binding.externalTurnID) ||
      (state.delegation.metaAgentID &&
        (parent.controller?.kind !== "root" || parent.controller.metaAgentID !== state.delegation.metaAgentID))
    )
      return false
    const task = (yield* tasks.get(parent.id)).find((task) => task.id === binding.parentTaskID)
    if (
      !task ||
      task.revision !== binding.parentTaskRevision + 1 ||
      task.status !==
        (result.status === "completed" ? "completed" : result.status === "cancelled" ? "cancelled" : "failed") ||
      (result.status === "completed" && task.outputDigest !== DelegationReceipt.outputDigest(result.text))
    )
      return false
    const notification = {
      sessionID: parent.id,
      inboxID: DelegationReceipt.notificationID(inputID(binding.delegationID, binding), task.id),
    }
    const decision = yield* SessionNotification.inspect(db, bus, store, notification)
    if (!decision.admit) return decision.wake
    const response = DelegationReceipt.response(receipt, task.id, result)
    const communication = yield* CommunicationRecord.prepareSystem(db, {
      inputID: notification.inboxID,
      targetSessionID: parent.id,
      text: response.content.map((part) => part.text).join(""),
      actor: new SessionCommunication.SystemActor({
        type: "system",
        sessionID: parent.id,
        origin: new SessionCommunication.DelegationOrigin({
          type: "delegation_delivery",
          delegationID: binding.delegationID,
          participantID: binding.participantID,
          turnID: binding.turnID,
          deliveryOrigin: binding.deliveryOrigin,
          senderParticipantID: binding.senderParticipantID,
          attempt: binding.attempt,
        }),
      }),
      contentSource: new SessionCommunication.ContentSource({ sessionID: parent.id, scope: "result" }),
      delivery: "steer",
      trigger: true,
      createdAt: (yield* DateTime.nowAsDate).getTime(),
    }).pipe(Effect.orDie)
    yield* sessions.synthetic(
      {
        id: notification.inboxID,
        sessionID: parent.id,
        description:
          typeof call.state.input.description === "string" ? call.state.input.description : state.delegation.title,
        text: communication.text,
        metadata: {
          ...response.metadata,
          source: "task",
          state: result.status,
          communication: Schema.encodeSync(SessionCommunication.Record)(communication.record),
        },
        resume: false,
      },
      { communication: communication.record },
    )
    const admitted = yield* SessionNotification.inspect(db, bus, store, notification)
    return !admitted.admit && admitted.wake
  })

  const readExternalNotice = Effect.fnUntraced(function* (binding: DelegationReceipt.Binding) {
    const id = DelegationReceipt.notificationID(inputID(binding.delegationID, binding), binding.parentTaskID)
    const projected = yield* store.message(id)
    const pending = projected ? undefined : yield* SessionInbox.find(db, id)
    const notification =
      projected?.sessionID === binding.parentSessionID && projected.message.type === "synthetic"
        ? projected.message
        : pending?.sessionID === binding.parentSessionID && pending.type === "synthetic"
          ? pending.payload
          : undefined
    if (!notification) return Option.none<DelegationReceipt.Output>()
    const receipt = Schema.decodeUnknownOption(DelegationReceipt.Outcome)(notification.metadata?.externalReceipt)
    if (Option.isNone(receipt) || !DelegationReceipt.matches(binding, receipt.value))
      return Option.none<DelegationReceipt.Output>()
    const output = DelegationReceipt.decodeOutput(notification.text)
    if (
      Option.isNone(output) ||
      output.value.status === "running" ||
      output.value.status === "queued" ||
      !DelegationReceipt.matchesOutput(binding, output.value)
    )
      return Option.none<DelegationReceipt.Output>()
    return output
  })

  const unstartedExternal = Effect.fnUntraced(function* (
    state: DelegationFold.DelegationFoldState,
    delivery: DelegationFold.DeliveryState,
  ) {
    const participant = state.participants.get(delivery.participantID)
    if (
      state.turns.get(delivery.turnID)?.delivery !== "queue" ||
      delivery.externalTurnID !== undefined ||
      (participant?.provider !== "codex" && participant?.provider !== "claude-code") ||
      participant.target !== participant.provider ||
      participant.role !== "implementer" ||
      participant.phase === "closed" ||
      (participant.provider === "codex" && !participant.externalThreadID)
    )
      return
    const key = DelegationReceipt.key({ delegationID: state.delegation.id, ...delivery })
    const saved = Schema.decodeUnknownOption(DelegationReceipt.Binding)(yield* kv.get(key))
    if (Option.isNone(saved)) return
    const binding = saved.value
    // A missing native ID alone cannot prove that the start request was never sent.
    if (
      binding.execution !== "queued" ||
      binding.externalTurnID !== undefined ||
      binding.sdkMessage !== undefined ||
      binding.target !== participant.provider ||
      binding.transport !== (participant.provider === "claude-code" ? "sdk" : "app-server") ||
      (binding.externalThreadID !== participant.externalThreadID &&
        !(binding.transport === "sdk" && binding.externalThreadID === undefined)) ||
      binding.parentSessionID !== state.delegation.parentSessionID ||
      DelegationReceipt.key(binding) !== key
    )
      return
    const parent = yield* store.get(binding.parentSessionID)
    if (
      !parent ||
      parent.mode === "custom" ||
      parent.location.directory !== binding.location.directory ||
      parent.location.workspaceID !== binding.location.workspaceID ||
      (state.delegation.metaAgentID &&
        (parent.controller?.kind !== "root" || parent.controller.metaAgentID !== state.delegation.metaAgentID))
    )
      return
    const call = yield* externalCall(binding).pipe(
      Effect.mapError(() => invalid(state, "input", "The original external Task call cannot be decoded")),
    )
    const ack = call ? yield* readExternalOutput(call) : Option.none<DelegationReceipt.Output>()
    if (
      !call ||
      Option.isNone(ack) ||
      ack.value.status !== "queued" ||
      !DelegationReceipt.isBackgroundAck(binding, call, ack.value)
    )
      return
    return binding
  })

  const dispatchExternalSteer = Effect.fn("DelegationExecution.dispatchExternalSteer")(function* (
    input: ExternalDispatchInput,
    attempt: { phase: "not_sent" | "unknown" | "accepted" },
  ) {
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const state = yield* requireState(input.delegationID)
        const turn = state.turns.get(input.turnID)
        const delivery = [...state.deliveries.values()].find((value) => value.turnID === input.turnID)
        const source = input.task?.source
        if (
          !turn ||
          turn.participantIDs.length !== 1 ||
          turn.delivery !== "steer" ||
          !delivery ||
          delivery.status !== "admitted" ||
          !source ||
          source.type !== "tool" ||
          !input.task ||
          input.task.background
        )
          return yield* invalid(
            state,
            "steer",
            "External steer requires its newly admitted foreground Task and tool source",
          )
        const owned = yield* requireExternalSteerOwner({
          delegationID: input.delegationID,
          participantID: delivery.participantID,
          parentSessionID: state.delegation.parentSessionID,
          agent: input.external.agent,
        })
        const entry = owned.owner[1]
        const callSource = { ...source, messageID: SessionMessage.ID.make(source.messageID) }
        const call = yield* externalCall({
          parentSessionID: owned.parent.id,
          source: callSource,
          agent: input.external.agent,
        })
        const task = (yield* tasks.get(owned.parent.id)).find((value) => value.id === input.task?.parentTaskID)
        if (
          !call ||
          call.state.status !== "running" ||
          call.state.input.prompt !== input.prompt ||
          call.state.input.command !== "steer" ||
          !task ||
          task.status !== "in_progress" ||
          task.revision !== input.task.parentTaskRevision
        )
          return yield* invalid(state, "steer", "The new durable Task call or execution claim changed")
        const key = DelegationReceipt.key({ delegationID: input.delegationID, ...delivery })
        if (yield* kv.get(key))
          return yield* invalid(state, "steer", "External attempt already admitted; reconcile its original result")
        if (entry.binding.transport === "sdk") {
          if (!entry.sdk || entry.sdk.ended)
            return yield* invalid(state, "steer", "The original SDK input feed has closed")
          const previous = { ...entry.binding }
          delete previous.sdkMessage
          delete previous.settlement
          delete previous.sdkObservations
          const binding = new DelegationReceipt.Binding({
            ...previous,
            turnID: input.turnID,
            deliveryOrigin: delivery.deliveryOrigin,
            senderParticipantID: delivery.senderParticipantID,
            attempt: delivery.attempt,
            source: callSource,
            parentTaskID: input.task.parentTaskID,
            parentTaskRevision: input.task.parentTaskRevision,
            background: false,
            sdkInput: new DelegationReceipt.SdkInput({ uuid: randomUUID(), observations: [] }),
          })
          const ready = yield* Deferred.make<DelegationReceipt.Sdk, Error>()
          entry.inputs.set(key, binding)
          entry.sdk.waiters.set(key, ready)
          yield* kv.set(key, Schema.encodeSync(DelegationReceipt.Binding)(binding))
          attempt.phase = "unknown"
          const offered = yield* Queue.offer(entry.sdk.feed, {
            type: "user",
            uuid: binding.sdkInput?.uuid,
            session_id: owned.externalThreadID,
            message: { role: "user", content: input.prompt },
            parent_tool_use_id: null,
            priority: "now",
          })
          if (!offered)
            return yield* invalid(state, "steer", "The original SDK input feed closed before this input was offered")
          // An offered user is a local fact. Its receipt waits for its own native result outside this lock.
          return { sdkReady: ready }
        }
        const steer = entry.adapter.steerTurn
        if (!steer) return yield* invalid(state, "steer", "The original adapter cannot steer its active turn")
        if (!owned.externalTurnID) return yield* invalid(state, "steer", "The original native turn is unavailable")
        const externalTurnID = owned.externalTurnID
        // The adapter alone proves whether a native request was not sent, rejected, or unconfirmed.
        attempt.phase = "unknown"
        yield* restore(
          steer({
            threadId: owned.externalThreadID,
            expectedTurnId: externalTurnID,
            input: [{ type: "text", text: input.prompt }],
          }),
        ).pipe(
          Effect.mapError((error) =>
            error instanceof CodexAppServer.SteerError
              ? error
              : new CodexAppServer.SteerError({
                  threadID: owned.externalThreadID,
                  turnID: externalTurnID,
                  phase: "unknown",
                  reason: error instanceof Error ? error.message : String(error),
                }),
          ),
        )
        attempt.phase = "accepted"
        const binding = new DelegationReceipt.Binding({
          ...entry.binding,
          turnID: input.turnID,
          deliveryOrigin: delivery.deliveryOrigin,
          senderParticipantID: delivery.senderParticipantID,
          attempt: delivery.attempt,
          source: callSource,
          parentTaskID: input.task.parentTaskID,
          parentTaskRevision: input.task.parentTaskRevision,
          background: false,
        })
        // Full bindings and shared-result credit only exist after the native ACK.
        yield* kv.set(key, Schema.encodeSync(DelegationReceipt.Binding)(binding))
        entry.inputs.set(key, binding)
        yield* delegations.recordDelivery({ ...binding, status: "started" })
        return [
          new DelegationReceipt.External({
            ...binding,
            externalThreadID: owned.externalThreadID,
            externalTurnID,
          }),
        ]
      }),
    )
  })

  const rejectExternalSteer = Effect.fnUntraced(function* (
    input: ExternalDispatchInput,
    attempt: { phase: "not_sent" | "unknown" | "accepted" },
    cause: Cause.Cause<unknown>,
  ) {
    const state = yield* requireState(input.delegationID)
    const delivery = [...state.deliveries.values()].find((value) => value.turnID === input.turnID)
    if (!delivery || terminal(delivery.status) || !input.task) return
    const saved = Schema.decodeUnknownOption(DelegationReceipt.Binding)(
      yield* kv.get(DelegationReceipt.key({ delegationID: input.delegationID, ...delivery })),
    )
    const sdk = Option.isSome(saved) && saved.value.transport === "sdk" && saved.value.sdkInput !== undefined
    const failure = cause.reasons
      .flatMap((reason) =>
        Cause.isFailReason(reason) && reason.error instanceof CodexAppServer.SteerError ? [reason.error] : [],
      )
      .at(0)
    const status =
      attempt.phase === "not_sent" ||
      failure?.phase === "not_sent" ||
      failure?.phase === "rejected" ||
      (sdk && Cause.hasInterruptsOnly(cause)) ||
      (attempt.phase === "accepted" && Cause.hasInterruptsOnly(cause))
        ? ("cancelled" as const)
        : ("recovery_required" as const)
    const summary =
      `${status === "cancelled" ? "External steer input cancelled" : "External steer acceptance requires reconciliation"}: ${failure?.message ?? Cause.pretty(cause)}`.slice(
        0,
        4096,
      )
    yield* delegations.recordDelivery({ ...delivery, delegationID: input.delegationID, status, summary })
    yield* tasks
      .patch(
        {
          sessionID: state.delegation.parentSessionID,
          id: input.task.parentTaskID,
          expectedRevision: input.task.parentTaskRevision,
          expect: ["in_progress"],
          status: status === "cancelled" ? "cancelled" : "failed",
          outputDigest: summary,
        },
        status === "cancelled" && input.task.source
          ? { settle: { source: input.task.source, revision: input.task.parentTaskRevision } }
          : undefined,
      )
      .pipe(Effect.catchTag("SessionTask.TaskWriteError", () => Effect.void))
  })

  const dispatchExternal = Effect.fn("DelegationExecution.dispatchExternal")(function* (
    input: ExternalDispatchInput,
    terminalReady?: Deferred.Deferred<DelegationReceipt.Sdk | DelegationReceipt.Acp | DelegationReceipt.Jsonl, Error>,
    ready?: Deferred.Deferred<DelegationReceipt.External, Error>,
  ) {
    const external = input.external
    if (external.operation === "steer")
      return yield* new CliAdapter.UnavailableError({
        target: "codex",
        reason: "steer requires its original Job owner",
      })
    const state = yield* requireState(input.delegationID)
    const sdk = external.adapter.transport === "sdk"
    const acp = external.adapter.transport === "acp"
    const jsonl = external.adapter.transport === "jsonl"
    if (!sdk && !acp && !jsonl && external.adapter.transport !== "app-server")
      return yield* new CliAdapter.UnavailableError({
        target: external.adapter.name,
        reason: "transport is unavailable",
      })
    const parent = yield* sessions.get(state.delegation.parentSessionID)
    const turn = state.turns.get(input.turnID)
    const delivery = [...state.deliveries.values()].find((value) => value.turnID === input.turnID)
    const participant = delivery && state.participants.get(delivery.participantID)
    const source = input.task?.source
    const review = input.review
    const queued = turn?.delivery === "queue" && input.task?.background === true
    if (
      !turn ||
      turn.participantIDs.length !== 1 ||
      (turn.delivery !== "steer" && !queued) ||
      !delivery ||
      !participant ||
      !source ||
      source.type !== "tool" ||
      !input.task
    )
      return yield* invalid(state, "dispatch", "External execution requires one Task and its exact tool source")
    if (acp && (review || input.task.background === true || turn.kind !== "task" || !external.readTextFile))
      return yield* new CliAdapter.UnavailableError({
        target: participant.target,
        reason: "ACP requires a foreground Task and its owning file-read callback",
      })
    if (
      jsonl &&
      (review ||
        input.task.background === true ||
        turn.kind !== "task" ||
        external.readOnly !== true ||
        !external.canUseTool)
    )
      return yield* new CliAdapter.UnavailableError({
        target: participant.target,
        reason: "JSONL requires a foreground read-only Task and its owning permission callback",
      })
    if (sdk && (turn.kind !== (review ? "review" : "task") || external.readOnly !== true || !external.canUseTool))
      return yield* invalid(
        state,
        "dispatch",
        "SDK execution requires its read-only Task and owning permission callback",
      )
    if (
      participant.provider !== (sdk || acp || jsonl ? "claude-code" : "codex") ||
      participant.target !== (sdk || acp || jsonl ? "claude-code" : "codex") ||
      participant.role !== (review ? "reviewer" : "implementer") ||
      participant.phase === "closed" ||
      participant.phase === "failed" ||
      ["closing", "completed", "cancelled", "archived"].includes(state.delegation.status)
    )
      return yield* invalid(state, "dispatch", "External participant is unavailable")
    if (
      state.delegation.metaAgentID &&
      (parent.controller?.kind !== "root" || parent.controller.metaAgentID !== state.delegation.metaAgentID)
    )
      return yield* invalid(state, "dispatch", "External participant has a different Meta owner")
    if (queued && !sdk && !participant.externalThreadID)
      return yield* invalid(state, "dispatch", "Queued external work requires its existing native thread")
    if (
      review &&
      (input.task.background ||
        turn.kind !== "review" ||
        turn.revisionDigest !== review.revisionDigest ||
        state.delegation.latestRevisionDigest !== review.revisionDigest)
    )
      return yield* invalid(
        state,
        "review",
        "External review requires the current revision and a foreground review Turn",
      )
    const prior = yield* Effect.filter(
      [...state.deliveries.values()]
        .filter(
          (value) =>
            value.participantID === participant.id && (state.turns.get(value.turnID)?.seq ?? turn.seq) < turn.seq,
        )
        .sort((a, b) => (state.turns.get(b.turnID)?.seq ?? 0) - (state.turns.get(a.turnID)?.seq ?? 0)),
      (value) =>
        value.status === "cancelled"
          ? unstartedExternal(state, value).pipe(Effect.map((binding) => binding === undefined))
          : Effect.succeed(true),
    )
    // A later steer still belongs to the active physical Job, ahead of its pending queue.
    const previous =
      prior.find(
        (value) =>
          queued &&
          state.turns.get(value.turnID)?.delivery === "queue" &&
          (!terminal(value.status) || value.status === "recovery_required"),
      ) ?? prior[0]
    const predecessor =
      previous && findExternalJob(DelegationReceipt.key({ delegationID: input.delegationID, ...previous }))
    const saved = previous
      ? Option.getOrUndefined(
          Schema.decodeUnknownOption(DelegationReceipt.Binding)(
            yield* kv.get(DelegationReceipt.key({ delegationID: input.delegationID, ...previous })),
          ),
        )
      : undefined
    const continuationReceipt = !queued && !sdk && saved ? DelegationReceipt.fromBinding(saved) : undefined
    if (participant.externalThreadID || queued) {
      if (
        !saved ||
        saved.parentSessionID !== parent.id ||
        (saved.externalThreadID !== participant.externalThreadID &&
          !(sdk && queued && saved.externalThreadID === undefined)) ||
        saved.location.directory !== parent.location.directory ||
        saved.location.workspaceID !== parent.location.workspaceID ||
        saved.command !== external.adapter.command ||
        saved.target !== (sdk || acp || jsonl ? "claude-code" : "codex") ||
        saved.transport !== external.adapter.transport ||
        (!sdk && !acp && !jsonl && !queued && !saved.externalTurnID) ||
        (queued && saved.agent !== external.agent)
      )
        return yield* invalid(
          state,
          "dispatch",
          "External continuation requires its original Location and execution binding",
        )
      if (
        (sdk || acp || jsonl) &&
        !queued &&
        (previous?.status !== "completed" ||
          saved.target !== "claude-code" ||
          saved.transport !== external.adapter.transport ||
          saved.agent !== external.agent ||
          (sdk ? saved.sdkMessage?.sessionID : jsonl ? saved.jsonlMessage?.sessionID : saved.acpPrompt?.sessionID) !==
            participant.externalThreadID ||
          saved.externalTurnID !== undefined ||
          saved.settlement?.status !== "completed")
      )
        return yield* invalid(state, "dispatch", "Continuation requires its completed Task and original session")
      if (acp || jsonl) {
        const receipt = DelegationReceipt.fromBinding(saved)
        if (
          !(receipt instanceof DelegationReceipt.Acp || receipt instanceof DelegationReceipt.Jsonl) ||
          !DelegationReceipt.matches(saved, receipt)
        )
          return yield* invalid(state, "dispatch", "Continuation has no exact completed protocol receipt")
      }
      if (sdk && queued && (saved.target !== "claude-code" || saved.transport !== "sdk"))
        return yield* invalid(state, "dispatch", "SDK queue requires its original SDK predecessor")
    }
    const messageID = SessionMessage.ID.make(source.messageID)
    const message = yield* sessions.message({ sessionID: parent.id, messageID })
    const call =
      message?.type === "assistant"
        ? message.content.find((part) => part.type === "tool" && part.id === source.id && part.name === "task")
        : undefined
    if (!call || call.type !== "tool" || call.state.status !== "running" || call.state.input.prompt !== input.prompt)
      return yield* invalid(state, "dispatch", "External Task requires its durable running parent call")
    if (sdk || acp || jsonl) {
      const task = (yield* tasks.get(parent.id)).find((value) => value.id === input.task?.parentTaskID)
      if (
        message?.type !== "assistant" ||
        message.agent !== external.agent ||
        !task ||
        task.status !== "in_progress" ||
        task.revision !== input.task.parentTaskRevision
      )
        return yield* invalid(state, "dispatch", "This Task execution claim was superseded or cancelled")
    }
    const reviewText = review
      ? yield* Effect.gen(function* () {
          if (!review.artifact) return yield* invalid(state, "review", "Review has no captured artifact")
          const bytes = yield* readArtifact(review.path).pipe(
            instances.provide(parent),
            Effect.mapError((error) => invalid(state, "review", error.message)),
          )
          if (createHash("sha256").update(bytes).digest("hex") !== review.artifact.targetSha256)
            return yield* invalid(state, "review", "Review bytes differ from the captured revision")
          return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)
        })
      : undefined
    const binding = new DelegationReceipt.Binding({
      kind: "external-cli",
      delegationID: input.delegationID,
      turnID: input.turnID,
      participantID: participant.id,
      deliveryOrigin: delivery.deliveryOrigin,
      senderParticipantID: delivery.senderParticipantID,
      attempt: delivery.attempt,
      parentSessionID: parent.id,
      source: { ...source, messageID },
      location: parent.location,
      agent: input.external.agent,
      target: sdk || acp || jsonl ? "claude-code" : "codex",
      transport: sdk ? "sdk" : acp ? "acp" : jsonl ? "jsonl" : "app-server",
      command: external.adapter.command,
      parentTaskID: input.task.parentTaskID,
      parentTaskRevision: input.task.parentTaskRevision,
      ...(input.task.background ? { background: true } : {}),
      ...(sdk && input.task.background ? { execution: "admitted" as const } : {}),
      ...(sdk && input.task.background
        ? { sdkInput: new DelegationReceipt.SdkInput({ uuid: randomUUID(), observations: [] }) }
        : {}),
      ...(queued ? { execution: "queued" as const } : {}),
      ...(participant.externalThreadID ? { externalThreadID: participant.externalThreadID } : {}),
      ...(reviewText !== undefined ? { review, reviewText } : {}),
    })
    const key = DelegationReceipt.key(binding)
    if (yield* kv.get(key))
      return yield* invalid(state, "dispatch", "External attempt already admitted; reconcile its original result")
    const unresolved = [...state.deliveries.values()].some(
      (value) =>
        value.participantID === participant.id &&
        value.turnID !== turn.id &&
        (!terminal(value.status) || value.status === "recovery_required"),
    )
    if (unresolved && !queued) return yield* invalid(state, "dispatch", "External participant has unresolved work")
    const execute = external.adapter.execute
    if (!execute)
      return yield* new CliAdapter.UnavailableError({ target: participant.target, reason: "execute is unavailable" })
    const entry: ExternalJob = {
      binding,
      adapter: external.adapter,
      previousSdkMessage: saved?.sdkMessage,
      previousJsonlMessage: saved?.jsonlMessage,
      inputs: new Map([[key, binding]]),
      finished: yield* Deferred.make<void, Error>(),
      status: (sdk || acp || jsonl ? "failed" : "recovery_required") as Result["status"],
      stopping: false,
    }
    yield* kv.set(key, Schema.encodeSync(DelegationReceipt.Binding)(binding))
    externalJobs.set(key, entry)
    const start = queued
      ? Effect.gen(function* () {
          if (!predecessor)
            return yield* invalid(state, "queue", "The exact predecessor Job is unavailable; coordination is required")
          // Job completion follows adapter Scope cleanup. Cancellation is never a success gate.
          const settled = yield* jobs.wait({ id: predecessor[0] })
          if (settled.timedOut || settled.info?.status !== "completed" || predecessor[1].status !== "completed")
            return yield* invalid(
              state,
              "queue",
              "The predecessor did not complete successfully; coordination is required",
            )
          return yield* locks.withLock(input.delegationID)(
            Effect.gen(function* () {
              const current = yield* requireState(input.delegationID)
              const owner = yield* store.get(binding.parentSessionID)
              const participant = current.participants.get(binding.participantID)
              const delivery = current.deliveries.get(
                DelegationFold.deliveryKey(
                  binding.turnID,
                  binding.participantID,
                  binding.deliveryOrigin,
                  binding.senderParticipantID,
                ),
              )
              const saved = Schema.decodeUnknownOption(DelegationReceipt.Binding)(yield* kv.get(key))
              const task = (yield* tasks.get(binding.parentSessionID)).find((task) => task.id === binding.parentTaskID)
              const job = yield* jobs.get(key)
              const call = yield* externalCall(binding)
              const ack =
                call?.state.status === "completed"
                  ? yield* readExternalOutput(call)
                  : Option.none<DelegationReceipt.Output>()
              if (
                entry.stopping ||
                externalJobs.get(key) !== entry ||
                job?.status !== "running" ||
                (yield* jobs.isDeletingSession(binding.parentSessionID)) ||
                !owner ||
                owner.mode === "custom" ||
                owner.location.directory !== binding.location.directory ||
                owner.location.workspaceID !== binding.location.workspaceID ||
                current.delegation.parentSessionID !== owner.id ||
                (current.delegation.metaAgentID &&
                  (owner.controller?.kind !== "root" ||
                    owner.controller.metaAgentID !== current.delegation.metaAgentID)) ||
                ["closing", "completed", "cancelled", "archived"].includes(current.delegation.status) ||
                participant?.provider !== (sdk ? "claude-code" : "codex") ||
                participant.target !== participant.provider ||
                participant.role !== "implementer" ||
                participant.phase === "closed" ||
                participant.phase === "failed" ||
                (participant.externalThreadID !== binding.externalThreadID &&
                  !(sdk && binding.externalThreadID === undefined)) ||
                Option.isNone(saved) ||
                !DelegationReceipt.matches(saved.value, DelegationReceipt.pending(binding, "queued")) ||
                saved.value.command !== external.adapter.command ||
                saved.value.agent !== binding.agent ||
                saved.value.location.directory !== binding.location.directory ||
                saved.value.location.workspaceID !== binding.location.workspaceID ||
                saved.value.background !== true ||
                saved.value.parentTaskID !== binding.parentTaskID ||
                saved.value.parentTaskRevision !== binding.parentTaskRevision ||
                !task ||
                task.status !== "in_progress" ||
                task.revision !== binding.parentTaskRevision ||
                delivery?.status !== "queued" ||
                delivery.attempt !== binding.attempt ||
                current.turns.get(binding.turnID)?.delivery !== "queue" ||
                !call ||
                (call.state.status !== "running" && call.state.status !== "completed") ||
                call.state.input.prompt !== input.prompt ||
                (call.state.status === "completed" &&
                  (Option.isNone(ack) ||
                    ack.value.status !== "queued" ||
                    !DelegationReceipt.isBackgroundAck(binding, call, ack.value))) ||
                [...current.deliveries.values()].some(
                  (value) =>
                    value.participantID === binding.participantID &&
                    (current.turns.get(value.turnID)?.seq ?? turn.seq) < turn.seq &&
                    (!terminal(value.status) || value.status === "recovery_required"),
                )
              )
                return yield* invalid(current, "queue", "Queued Task ownership or its queue head changed before start")
              if (sdk) {
                const previous = Schema.decodeUnknownOption(DelegationReceipt.Binding)(yield* kv.get(predecessor[0]))
                const receipt = DelegationReceipt.fromBinding(predecessor[1].binding)
                if (
                  Option.isNone(previous) ||
                  !(receipt instanceof DelegationReceipt.Sdk) ||
                  !DelegationReceipt.matches(previous.value, receipt) ||
                  previous.value.settlement?.status !== "completed" ||
                  previous.value.agent !== binding.agent ||
                  previous.value.command !== external.adapter.command ||
                  (yield* waitExternal(receipt)).status !== "completed"
                )
                  return yield* invalid(current, "queue", "SDK predecessor has no exact completed result")
                entry.previousSdkMessage = receipt.sdkMessage
                entry.binding = new DelegationReceipt.Binding({
                  ...entry.binding,
                  externalThreadID: receipt.sdkMessage.sessionID,
                })
              }
              entry.binding = new DelegationReceipt.Binding({ ...entry.binding, execution: "start_unknown" })
              entry.inputs.set(key, entry.binding)
              yield* kv.set(key, Schema.encodeSync(DelegationReceipt.Binding)(entry.binding))
              return yield* delegations.recordDelivery({ ...binding, status: "started" })
            }),
          )
        })
      : Effect.gen(function* () {
          if (!continuationReceipt) return yield* delegations.recordDelivery({ ...binding, status: "started" })
          if (continuationReceipt instanceof DelegationReceipt.Pending)
            return yield* invalid(state, "dispatch", "The predecessor has no complete execution receipt")
          // This Job waits for cleanup without inheriting the predecessor's cancellation scope.
          if (predecessor) {
            const ended = yield* jobs.wait({ id: predecessor[0] })
            if (ended.timedOut || ended.info?.status === "running")
              return yield* invalid(state, "dispatch", "The predecessor Job has not finished cleanup")
            // Foreground protocol results are retained in Binding/Task after process cleanup.
            if (acp || jsonl) externalJobs.delete(predecessor[0])
          }
          if ((acp || jsonl) && (yield* waitExternal(continuationReceipt)).status !== "completed")
            return yield* invalid(state, "dispatch", "The predecessor has no exact completed result")
          return yield* locks.withLock(input.delegationID)(
            Effect.gen(function* () {
              const current = yield* requireState(input.delegationID)
              const owner = yield* store.get(binding.parentSessionID)
              const claimed = (yield* tasks.get(binding.parentSessionID)).find(
                (task) => task.id === binding.parentTaskID,
              )
              const call = yield* externalCall(binding)
              const original = Schema.decodeUnknownOption(DelegationReceipt.Binding)(
                yield* kv.get(DelegationReceipt.key(continuationReceipt)),
              )
              const activeParticipant = current.participants.get(binding.participantID)
              const activeDelivery = current.deliveries.get(
                DelegationFold.deliveryKey(
                  binding.turnID,
                  binding.participantID,
                  binding.deliveryOrigin,
                  binding.senderParticipantID,
                ),
              )
              if (
                entry.stopping ||
                !owner ||
                owner.mode === "custom" ||
                owner.location.directory !== binding.location.directory ||
                owner.location.workspaceID !== binding.location.workspaceID ||
                (current.delegation.metaAgentID &&
                  (owner.controller?.kind !== "root" ||
                    owner.controller.metaAgentID !== current.delegation.metaAgentID)) ||
                ["closing", "completed", "cancelled", "archived"].includes(current.delegation.status) ||
                activeParticipant?.phase === "closed" ||
                activeParticipant?.phase === "failed" ||
                activeParticipant?.provider !== binding.target ||
                activeParticipant.target !== binding.target ||
                activeParticipant.externalThreadID !== binding.externalThreadID ||
                activeDelivery?.attempt !== binding.attempt ||
                activeDelivery.status !== "admitted" ||
                !claimed ||
                claimed.status !== "in_progress" ||
                claimed.revision !== binding.parentTaskRevision ||
                !call ||
                call.state.status !== "running" ||
                call.state.input.prompt !== input.prompt ||
                Option.isNone(original) ||
                !DelegationReceipt.matches(original.value, continuationReceipt)
              )
                return yield* invalid(
                  current,
                  "dispatch",
                  "Continuation ownership or Task execution claim changed during predecessor cleanup",
                )
              if (jsonl) {
                const predecessorCall = yield* externalCall(original.value)
                if (predecessorCall?.state.status !== "completed")
                  return yield* invalid(current, "dispatch", "JSONL predecessor has no exact committed Tool result")
                const predecessorOutput = yield* readExternalOutput(predecessorCall)
                const predecessorReceipt = Schema.decodeUnknownOption(DelegationReceipt.Outcome)(
                  predecessorCall.state.metadata?.externalReceipt,
                )
                if (
                  Option.isNone(predecessorOutput) ||
                  predecessorOutput.value.status !== "completed" ||
                  !DelegationReceipt.matchesOutput(original.value, predecessorOutput.value) ||
                  predecessorOutput.value.output !== original.value.settlement?.text ||
                  Option.isNone(predecessorReceipt) ||
                  !DelegationReceipt.matches(original.value, predecessorReceipt.value)
                )
                  return yield* invalid(current, "dispatch", "JSONL predecessor has no exact committed Tool result")
              }
              return yield* delegations.recordDelivery({ ...binding, status: "started" })
            }),
          )
        })
    return yield* jobs
      .start({
        id: key,
        type: "delegation",
        title: input.task.description,
        metadata: { sessionID: parent.id, delegationID: input.delegationID, participantID: participant.id },
        ...(binding.background
          ? {
              notificationID: DelegationReceipt.notificationID(
                inputID(binding.delegationID, binding),
                binding.parentTaskID,
              ),
            }
          : {}),
        // Job owns cancellation before the durable Started fact becomes observable.
        run: Effect.scoped(
          start.pipe(
            Effect.andThen(() =>
              Effect.gen(function* () {
                if (!sdk || !binding.sdkInput) return
                const feed = yield* Queue.make<SDKUserMessage, Cause.Done>()
                const waiters = new Map<string, Deferred.Deferred<DelegationReceipt.Sdk, Error>>()
                entry.sdk = { feed, waiters, ended: false }
                yield* Effect.addFinalizer(() =>
                  Effect.gen(function* () {
                    if (entry.sdk) entry.sdk.ended = true
                    yield* Queue.shutdown(feed)
                    yield* Effect.forEach(
                      [...waiters.values()],
                      (ready) => Deferred.fail(ready, new Error("SDK Query closed before this input had a result")),
                      { discard: true },
                    )
                  }),
                )
                yield* Queue.offer(feed, {
                  type: "user",
                  uuid: binding.sdkInput.uuid,
                  ...(entry.binding.externalThreadID ? { session_id: entry.binding.externalThreadID } : {}),
                  message: { role: "user", content: input.prompt },
                  parent_tool_use_id: null,
                })
              }),
            ),
            Effect.andThen(() =>
              execute({
                prompt: review
                  ? `${input.prompt}\n\nBound artifact review:\n${JSON.stringify({ reference: review, text: reviewText })}`
                  : input.prompt,
                cwd: parent.location.directory,
                resumeId: entry.binding.externalThreadID,
                ...(sdk || acp || jsonl
                  ? {
                      readOnly: external.readOnly,
                      canUseTool: external.canUseTool,
                      readTextFile: external.readTextFile,
                    }
                  : {}),
                timeoutMs: external.adapter.timeout,
                onPermission: external.onPermission,
                onText: external.onText,
                ...(entry.sdk
                  ? {
                      sdkInput: Stream.toAsyncIterable(Stream.fromQueue(entry.sdk.feed)),
                      onSdkObservation: (observation: DelegationReceipt.SdkObservation) =>
                        observeSdk(key, entry, observation),
                    }
                  : {}),
                ...(ready
                  ? {
                      onThread: (thread: CliAdapter.ThreadBinding) => {
                        const bind = Effect.gen(function* () {
                          if (
                            thread.cwd !== parent.location.directory ||
                            (queued && (entry.stopping || thread.threadID !== binding.externalThreadID))
                          )
                            return yield* invalid(state, "bind", "External Location changed")
                          yield* delegations.bindParticipant({
                            delegationID: input.delegationID,
                            participantID: participant.id,
                            externalThreadID: thread.threadID,
                          })
                          entry.binding = new DelegationReceipt.Binding({
                            ...entry.binding,
                            externalThreadID: thread.threadID,
                            model: thread.model,
                            modelProvider: thread.modelProvider,
                            cliVersion: thread.cliVersion,
                          })
                          yield* kv.set(key, Schema.encodeSync(DelegationReceipt.Binding)(entry.binding))
                          entry.inputs.set(key, entry.binding)
                        })
                        return queued ? locks.withLock(input.delegationID)(bind) : bind
                      },
                      onTurn: (externalTurnID: string) => {
                        const bind = Effect.gen(function* () {
                          if (!entry.binding.externalThreadID)
                            return yield* invalid(state, "bind", "External turn has no thread")
                          if (queued && (entry.stopping || externalTurnID === predecessor?.[1].binding.externalTurnID))
                            return yield* invalid(
                              state,
                              "bind",
                              "Queued native turn was cancelled or reused its predecessor",
                            )
                          const externalThreadID = entry.binding.externalThreadID
                          entry.binding = new DelegationReceipt.Binding({ ...entry.binding, externalTurnID })
                          yield* kv.set(key, Schema.encodeSync(DelegationReceipt.Binding)(entry.binding))
                          entry.inputs.set(key, entry.binding)
                          yield* Deferred.succeed(
                            ready,
                            new DelegationReceipt.External({ ...entry.binding, externalThreadID, externalTurnID }),
                          )
                        })
                        return queued ? locks.withLock(input.delegationID)(bind) : bind
                      },
                    }
                  : {}),
              }),
            ),
            Effect.flatMap((result) =>
              locks.withLock(input.delegationID)(
                Effect.gen(function* () {
                  if (entry.sdk && (entry.inputs.size > 1 || sdkInputProtocol(entry.binding))) {
                    yield* Effect.forEach(
                      [...entry.inputs.entries()],
                      ([inputKey, value]) => {
                        if (value.settlement) return Effect.void
                        return settleSdkInput(entry, inputKey, value, {
                          status: "recovery_required",
                          text: "SDK Query ended without a complete matching result for this input",
                        })
                      },
                      { discard: true },
                    )
                    entry.stopping = true
                    entry.status = result.status === "success" ? "completed" : "recovery_required"
                    yield* Deferred.succeed(entry.finished, undefined)
                    if (entry.status !== "completed") return yield* invalid(state, "result", result.summary)
                    return result.summary
                  }
                  if (terminalReady) {
                    const current = yield* requireState(input.delegationID)
                    const delivery = current.deliveries.get(
                      DelegationFold.deliveryKey(
                        binding.turnID,
                        binding.participantID,
                        binding.deliveryOrigin,
                        binding.senderParticipantID,
                      ),
                    )
                    if (
                      entry.stopping ||
                      !delivery ||
                      delivery.attempt !== binding.attempt ||
                      terminal(delivery.status)
                    ) {
                      if (entry.stopping) entry.status = "cancelled"
                      return yield* invalid(current, "result", "This Task was stopped or already settled")
                    }
                    if (result.status !== "success") {
                      entry.status = "failed"
                      entry.stopping = true
                      yield* settleExternalInputs(
                        input.delegationID,
                        entry.inputs.values(),
                        {
                          status: "failed",
                          text: result.summary,
                        },
                        result.errorCode,
                      )
                      return yield* invalid(current, "result", result.summary)
                    }
                    if (sdk && (!result.sdkMessage?.sessionID || !result.sdkMessage.messageID))
                      return yield* invalid(current, "result", "The SDK result has no complete native message identity")
                    if (
                      jsonl &&
                      (!result.jsonlMessage?.sessionID ||
                        !result.jsonlMessage.messageID ||
                        result.sessionId !== result.jsonlMessage.sessionID ||
                        result.turnId !== undefined)
                    )
                      return yield* invalid(
                        current,
                        "result",
                        "The JSONL result has no complete same-frame native message identity",
                      )
                    if (
                      acp &&
                      (!result.acpPrompt?.sessionID ||
                        (typeof result.acpPrompt.requestID !== "number" &&
                          typeof result.acpPrompt.requestID !== "string") ||
                        result.sessionId !== result.acpPrompt.sessionID ||
                        result.turnId !== undefined ||
                        result.sdkMessage !== undefined)
                    )
                      return yield* invalid(
                        current,
                        "result",
                        "The ACP result has no complete protocol prompt identity",
                      )
                    const sessionID = sdk
                      ? result.sdkMessage?.sessionID
                      : jsonl
                        ? result.jsonlMessage?.sessionID
                        : result.acpPrompt?.sessionID
                    if (!sessionID || (entry.binding.externalThreadID && sessionID !== entry.binding.externalThreadID))
                      return yield* invalid(
                        current,
                        "result",
                        sdk
                          ? "SDK continuation changed its native session"
                          : jsonl
                            ? "JSONL continuation changed its native session"
                            : "ACP continuation changed its protocol session",
                      )
                    if (sdk && entry.previousSdkMessage?.messageID === result.sdkMessage?.messageID)
                      return yield* invalid(current, "result", "SDK continuation reused its previous result message")
                    if (jsonl && entry.previousJsonlMessage?.messageID === result.jsonlMessage?.messageID)
                      return yield* invalid(current, "result", "JSONL continuation reused its previous result message")
                    if (!result.summary.trim())
                      return yield* invalid(current, "result", "The result has no complete response")
                    const identity =
                      sdk && result.sdkMessage
                        ? { sdkMessage: new DelegationReceipt.SdkMessage(result.sdkMessage) }
                        : jsonl && result.jsonlMessage
                          ? { jsonlMessage: new DelegationReceipt.JsonlMessage(result.jsonlMessage) }
                          : acp && result.acpPrompt
                            ? { acpPrompt: new DelegationReceipt.AcpPrompt(result.acpPrompt) }
                            : undefined
                    if (!identity) return yield* invalid(current, "result", "The result has no protocol identity")
                    yield* delegations.bindParticipant({
                      delegationID: input.delegationID,
                      participantID: participant.id,
                      externalThreadID: sessionID,
                    })
                    entry.binding = new DelegationReceipt.Binding({
                      ...entry.binding,
                      externalThreadID: sessionID,
                      ...identity,
                      settlement: { status: "completed", text: result.summary },
                    })
                    const receipt = DelegationReceipt.fromBinding(entry.binding)
                    if (
                      !(
                        receipt instanceof DelegationReceipt.Sdk ||
                        receipt instanceof DelegationReceipt.Acp ||
                        receipt instanceof DelegationReceipt.Jsonl
                      )
                    )
                      return yield* invalid(current, "result", "The persisted result has no protocol receipt")
                    entry.inputs.set(key, entry.binding)
                    yield* kv.set(key, Schema.encodeSync(DelegationReceipt.Binding)(entry.binding))
                    entry.stopping = true
                    yield* settleExternalInputs(input.delegationID, entry.inputs.values(), {
                      status: "completed",
                      text: result.summary,
                    })
                    entry.status = "completed"
                    yield* Deferred.succeed(entry.finished, undefined)
                    yield* Deferred.succeed(terminalReady, receipt)
                    return result.summary
                  }
                  if (
                    result.sessionId !== entry.binding.externalThreadID ||
                    result.turnId !== entry.binding.externalTurnID
                  )
                    return yield* invalid(state, "result", "External result binding changed")
                  entry.status = entry.stopping
                    ? "cancelled"
                    : result.status === "success"
                      ? "completed"
                      : result.recoveryRequired
                        ? "recovery_required"
                        : "failed"
                  entry.stopping = true
                  yield* settleExternalInputs(
                    input.delegationID,
                    entry.inputs.values(),
                    { status: entry.status, text: result.summary },
                    result.errorCode,
                  )
                  if (entry.status !== "completed") return yield* invalid(state, "result", result.summary)
                  yield* Deferred.succeed(entry.finished, undefined)
                  return result.summary
                }),
              ),
            ),
            Effect.onError((cause) =>
              Effect.gen(function* () {
                // Startup may fail while dispatch holds the lock waiting for ready.
                if (ready) yield* Deferred.failCause(ready, cause)
                if (terminalReady) yield* Deferred.failCause(terminalReady, cause)
                yield* locks.withLock(input.delegationID)(
                  Effect.gen(function* () {
                    entry.stopping = true
                    if (entry.sdk && (entry.inputs.size > 1 || sdkInputProtocol(entry.binding))) {
                      entry.status = Cause.hasInterruptsOnly(cause) ? "cancelled" : "recovery_required"
                      yield* Effect.forEach(
                        [...entry.inputs.entries()],
                        ([inputKey, value]) =>
                          value.settlement
                            ? Effect.void
                            : settleSdkInput(entry, inputKey, value, {
                                status: entry.status,
                                text: "SDK Query stopped before this input had a complete matching result",
                              }),
                        { discard: true },
                      )
                      return
                    }
                    if (terminalReady) {
                      const saved = Schema.decodeUnknownOption(DelegationReceipt.Binding)(yield* kv.get(key))
                      const receipt = DelegationReceipt.fromBinding(entry.binding)
                      if (
                        (receipt instanceof DelegationReceipt.Sdk ||
                          receipt instanceof DelegationReceipt.Acp ||
                          receipt instanceof DelegationReceipt.Jsonl) &&
                        Option.isSome(saved) &&
                        DelegationReceipt.matches(saved.value, receipt) &&
                        saved.value.settlement?.status === "completed" &&
                        saved.value.settlement.text.trim()
                      )
                        return
                    }
                    if (Cause.hasInterruptsOnly(cause)) entry.status = "cancelled"
                    yield* settleExternalInputs(input.delegationID, entry.inputs.values(), {
                      status:
                        entry.status === "cancelled"
                          ? "cancelled"
                          : terminalReady && entry.binding.execution !== "queued"
                            ? "failed"
                            : "recovery_required",
                      text:
                        entry.binding.execution === "queued"
                          ? `Queued external input stopped before native start: ${Cause.pretty(cause)}`
                          : terminalReady
                            ? `Protocol execution stopped before a complete result: ${Cause.pretty(cause)}`
                            : "External execution stopped; side effects must be reconciled",
                    })
                  }),
                )
              }).pipe(
                Effect.ensuring(
                  Effect.gen(function* () {
                    yield* Deferred.failCause(entry.finished, cause)
                  }),
                ),
                Effect.orDie,
              ),
            ),
          ),
        ),
      })
      .pipe(
        Effect.flatMap(
          (job): Effect.Effect<DelegationReceipt.Outcome | void, Error> =>
            job.status === "running"
              ? sdk && binding.background
                ? Effect.succeed(DelegationReceipt.pending(binding, queued ? "queued" : "admitted"))
                : queued
                  ? Effect.succeed(DelegationReceipt.pending(binding, "queued"))
                  : Effect.void
              : invalid(state, "dispatch", "External Job did not take ownership"),
        ),
        Effect.tap(() =>
          Effect.gen(function* () {
            if (!binding.background) return
            const notificationID = DelegationReceipt.notificationID(
              inputID(binding.delegationID, binding),
              binding.parentTaskID,
            )
            yield* jobs.background(key)
            if (observers.has(notificationID)) return
            observers.add(notificationID)
            yield* Effect.gen(function* () {
              // A stopped Job settles its Delivery and Task before the observer can publish a notice.
              yield* Deferred.await(entry.finished).pipe(Effect.exit)
              const settled = yield* jobs.wait({ id: key })
              // Keep the original Job output until every accepted Tool call can commit its own result.
              yield* bus.log({ aggregateID: parent.id, follow: true }).pipe(
                Stream.mapEffect(() => Effect.forEach([...entry.inputs.values()], (input) => externalCall(input))),
                Stream.filter((calls) =>
                  calls.every(
                    (call) => !call || (call.state.status !== "running" && call.state.status !== "streaming"),
                  ),
                ),
                Stream.runHead,
              )
              const wake = yield* locks.withLock(binding.delegationID)(
                Effect.gen(function* () {
                  const state = yield* requireState(binding.delegationID)
                  const delivery = state.deliveries.get(
                    DelegationFold.deliveryKey(
                      binding.turnID,
                      binding.participantID,
                      binding.deliveryOrigin,
                      binding.senderParticipantID,
                    ),
                  )
                  if (!delivery || !terminal(delivery.status)) return false
                  const saved = Schema.decodeUnknownOption(DelegationReceipt.Binding)(yield* kv.get(key))
                  if (Option.isNone(saved)) return false
                  if (sdk) {
                    if (saved.value.settlement?.status !== delivery.status) return false
                    return yield* notifyExternal(saved.value, saved.value.settlement)
                  }
                  return yield* notifyExternal(saved.value, {
                    status: delivery.status,
                    text:
                      settled.info?.output ??
                      settled.info?.error ??
                      delivery.summary ??
                      "External task requires reconciliation",
                  })
                }),
              )
              if (wake) yield* execution.wake(parent.id)
            }).pipe(
              Effect.tapCause((cause) => Effect.logError("External background notification failed", cause)),
              Effect.ensuring(
                Effect.gen(function* () {
                  yield* jobs.completeBackground(notificationID)
                  externalJobs.delete(key)
                  observers.delete(notificationID)
                }),
              ),
              Effect.forkIn(scope, { startImmediately: true }),
              Effect.setContext(context),
            )
          }),
        ),
        Effect.map((receipt) => (receipt ? [receipt] : [])),
      )
  })

  function dispatchCall(input: ExternalDispatchInput): Effect.Effect<readonly DelegationReceipt.Outcome[], Error>
  function dispatchCall(input: DispatchInput): Effect.Effect<readonly Receipt[], DispatchError>
  function dispatchCall(
    input: DispatchInput | ExternalDispatchInput,
  ): Effect.Effect<readonly (Receipt | DelegationReceipt.Outcome)[], Error> {
    if ("external" in input) {
      if (input.external.operation === "steer") {
        const attempt = { phase: "not_sent" as "not_sent" | "unknown" | "accepted" }
        return locks
          .withLock(input.delegationID)(dispatchExternalSteer(input, attempt))
          .pipe(
            Effect.andThen(
              (receipts): Effect.Effect<readonly DelegationReceipt.Outcome[], Error> =>
                "sdkReady" in receipts
                  ? Deferred.await(receipts.sdkReady).pipe(Effect.map((receipt) => [receipt]))
                  : Effect.succeed(receipts),
            ),
            Effect.onError((cause) =>
              locks
                .withLock(input.delegationID)(rejectExternalSteer(input, attempt, cause))
                .pipe(Effect.orDie),
            ),
            Effect.setContext(context),
          )
      }
      return Effect.gen(function* () {
        const ready =
          input.external.operation !== "steer" && input.external.adapter.transport === "app-server"
            ? yield* Deferred.make<DelegationReceipt.External, Error>()
            : undefined
        const terminalReady =
          input.external.operation !== "steer" &&
          (input.external.adapter.transport === "sdk" ||
            input.external.adapter.transport === "acp" ||
            input.external.adapter.transport === "jsonl")
            ? yield* Deferred.make<DelegationReceipt.Sdk | DelegationReceipt.Acp | DelegationReceipt.Jsonl, Error>()
            : undefined
        return yield* locks
          .withLock(input.delegationID)(
            dispatchExternal(input, terminalReady, ready).pipe(
              Effect.onError((cause) =>
                Effect.gen(function* () {
                  // Before Job ownership starts, dispatch still owns rejection of the admitted Task.
                  const state = yield* requireState(input.delegationID)
                  const delivery = [...state.deliveries.values()].find((value) => value.turnID === input.turnID)
                  if (!delivery || (delivery.status !== "admitted" && delivery.status !== "queued") || !input.task)
                    return
                  const status = Cause.hasInterruptsOnly(cause) ? ("cancelled" as const) : ("failed" as const)
                  yield* delegations.recordDelivery({
                    ...delivery,
                    delegationID: input.delegationID,
                    status,
                    summary: "External dispatch was rejected before execution",
                  })
                  yield* tasks
                    .patch(
                      {
                        sessionID: state.delegation.parentSessionID,
                        id: input.task.parentTaskID,
                        expectedRevision: input.task.parentTaskRevision,
                        expect: ["in_progress"],
                        status,
                      },
                      input.task.source
                        ? { settle: { source: input.task.source, revision: input.task.parentTaskRevision } }
                        : undefined,
                    )
                    .pipe(Effect.catchTag("SessionTask.TaskWriteError", () => Effect.void))
                }).pipe(Effect.orDie),
              ),
            ),
          )
          .pipe(
            Effect.andThen((receipts) =>
              terminalReady && input.task?.background !== true
                ? Deferred.await(terminalReady).pipe(Effect.map((receipt) => [receipt]))
                : ready && receipts.length === 0
                  ? Deferred.await(ready).pipe(Effect.map((receipt) => [receipt]))
                  : Effect.succeed(receipts),
            ),
          )
      }).pipe(
        // Scope.close waits for native settlement, which takes this same delegation lock.
        Effect.onError(() =>
          locks
            .withLock(input.delegationID)(
              Effect.gen(function* () {
                const state = yield* requireState(input.delegationID)
                const delivery = [...state.deliveries.values()].find((value) => value.turnID === input.turnID)
                if (!delivery) return
                const key = DelegationReceipt.key({ delegationID: input.delegationID, ...delivery })
                const entry = externalJobs.get(key)
                if (!entry) return
                entry.stopping = true
                return key
              }),
            )
            .pipe(
              Effect.andThen((key) =>
                key === undefined
                  ? Effect.void
                  : jobs.cancel(key).pipe(Effect.andThen(Effect.sync(() => externalJobs.delete(key)))),
              ),
              Effect.orDie,
            ),
        ),
        Effect.setContext(context),
      )
    }
    return locks.withLock(input.delegationID)(dispatch(input)).pipe(Effect.setContext(context))
  }

  const waitExternal = (
    receipt: DelegationReceipt.External | DelegationReceipt.Sdk | DelegationReceipt.Acp | DelegationReceipt.Jsonl,
  ) =>
    Effect.gen(function* () {
      const state = yield* requireState(receipt.delegationID)
      const binding = Schema.decodeUnknownOption(DelegationReceipt.Binding)(
        yield* kv.get(DelegationReceipt.key(receipt)),
      )
      const parent = yield* sessions.get(receipt.parentSessionID)
      if (
        Option.isNone(binding) ||
        !DelegationReceipt.matches(binding.value, receipt) ||
        state.delegation.parentSessionID !== parent.id ||
        parent.location.directory !== binding.value.location.directory ||
        parent.location.workspaceID !== binding.value.location.workspaceID ||
        state.participants.get(receipt.participantID)?.externalThreadID !== binding.value.externalThreadID
      )
        return yield* invalid(state, "wait", "External receipt ownership changed")
      const key = DelegationReceipt.key(receipt)
      const owner = findExternalJob(key)
      if (receipt instanceof DelegationReceipt.Sdk && sdkInputProtocol(binding.value)) {
        if (owner) {
          yield* Deferred.await(owner[1].finished).pipe(Effect.exit)
          const ended = yield* jobs.wait({ id: owner[0] })
          if (ended.timedOut || ended.info?.status === "running")
            return yield* invalid(state, "wait", "The original SDK Query has not finished cleanup")
        }
        const current = yield* requireState(receipt.delegationID)
        const saved = Schema.decodeUnknownOption(DelegationReceipt.Binding)(yield* kv.get(key))
        if (Option.isNone(saved) || !DelegationReceipt.matches(saved.value, receipt) || !saved.value.settlement)
          return yield* invalid(current, "wait", "This SDK input has no complete persisted settlement")
        const result = saved.value.settlement
        const task = (yield* tasks.get(parent.id)).find((value) => value.id === saved.value.parentTaskID)
        const delivery = current.deliveries.get(
          DelegationFold.deliveryKey(
            receipt.turnID,
            receipt.participantID,
            receipt.deliveryOrigin,
            receipt.senderParticipantID,
          ),
        )
        if (
          !task ||
          task.revision !== saved.value.parentTaskRevision + 1 ||
          task.status !==
            (result.status === "completed" ? "completed" : result.status === "cancelled" ? "cancelled" : "failed") ||
          delivery?.attempt !== receipt.attempt ||
          delivery.status !== result.status ||
          (result.status === "completed" && task.outputDigest !== DelegationReceipt.outputDigest(result.text))
        )
          return yield* invalid(current, "wait", "This SDK input Task execution claim was superseded or cancelled")
        return {
          status: result.status,
          text: result.text,
          ...(result.governance ? { governance: result.governance } : {}),
        }
      }
      if (owner) {
        const active = owner[1]
        const local = yield* Effect.gen(function* () {
          yield* Deferred.await(active.finished)
          const result = yield* jobs.wait({ id: owner[0] })
          if (!result.info?.output) return
          const task = (yield* tasks.get(parent.id)).find((task) => task.id === binding.value.parentTaskID)
          if (
            !task ||
            task.revision !== binding.value.parentTaskRevision + 1 ||
            task.status !==
              (active.status === "completed" ? "completed" : active.status === "cancelled" ? "cancelled" : "failed") ||
            (active.status === "completed" && task.outputDigest !== DelegationReceipt.outputDigest(result.info.output))
          )
            return yield* invalid(state, "wait", "This Task execution claim was superseded or cancelled")
          const saved =
            binding.value.review ||
            receipt instanceof DelegationReceipt.Sdk ||
            receipt instanceof DelegationReceipt.Acp ||
            receipt instanceof DelegationReceipt.Jsonl
              ? Schema.decodeUnknownOption(DelegationReceipt.Binding)(yield* kv.get(key))
              : Option.none<DelegationReceipt.Binding>()
          return {
            status: active.status,
            text: result.info.output,
            ...(Option.isSome(saved) && saved.value.settlement?.governance
              ? { governance: saved.value.settlement.governance }
              : {}),
          }
        }).pipe(
          Effect.onInterrupt(() =>
            key === owner[0] && !active.binding.background
              ? locks
                  .withLock(receipt.delegationID)(
                    Effect.sync(() => {
                      active.stopping = true
                    }),
                  )
                  .pipe(Effect.andThen(jobs.cancel(owner[0])), Effect.asVoid)
              : Effect.void,
          ),
          Effect.ensuring(
            Effect.sync(() => {
              if (key === owner[0] && !active.binding.background) externalJobs.delete(owner[0])
            }),
          ),
        )
        if (local) return local
      }
      if (
        (receipt instanceof DelegationReceipt.Sdk ||
          receipt instanceof DelegationReceipt.Acp ||
          receipt instanceof DelegationReceipt.Jsonl) &&
        binding.value.settlement
      ) {
        const result = binding.value.settlement
        if (
          (receipt instanceof DelegationReceipt.Acp || receipt instanceof DelegationReceipt.Jsonl) &&
          result.status !== "completed"
        )
          return yield* invalid(state, "wait", "The protocol checkpoint has no complete terminal response")
        const task = (yield* tasks.get(parent.id)).find((value) => value.id === binding.value.parentTaskID)
        const delivery = state.deliveries.get(
          DelegationFold.deliveryKey(
            receipt.turnID,
            receipt.participantID,
            receipt.deliveryOrigin,
            receipt.senderParticipantID,
          ),
        )
        if (
          !task ||
          task.revision !== binding.value.parentTaskRevision + 1 ||
          task.status !==
            (result.status === "completed" ? "completed" : result.status === "cancelled" ? "cancelled" : "failed") ||
          delivery?.attempt !== receipt.attempt ||
          delivery.status !== result.status ||
          (result.status === "completed" && task.outputDigest !== DelegationReceipt.outputDigest(result.text))
        )
          return yield* invalid(state, "wait", "This result Task execution claim was superseded or cancelled")
        return {
          status: result.status,
          text: result.text,
          ...(result.governance ? { governance: result.governance } : {}),
        }
      }
      const call = yield* externalCall(binding.value)
      if (call?.state.status === "completed") {
        const decoded = yield* readExternalOutput(call)
        if (Option.isSome(decoded) && DelegationReceipt.isBackgroundAck(binding.value, call, decoded.value)) {
          const notice = yield* readExternalNotice(binding.value)
          if (Option.isSome(notice) && notice.value.status !== "running" && notice.value.status !== "queued")
            return { status: notice.value.status, text: notice.value.output }
          return yield* invalid(state, "wait", "External background result is awaiting reconciliation")
        }
        const stored = Schema.decodeUnknownOption(DelegationReceipt.Outcome)(call.state.metadata?.externalReceipt)
        if (Option.isNone(stored) || !DelegationReceipt.matches(binding.value, stored.value))
          return yield* invalid(state, "wait", "Committed external result ownership changed")
        if (
          Option.isSome(decoded) &&
          decoded.value.status !== "running" &&
          decoded.value.status !== "queued" &&
          DelegationReceipt.matchesOutput(binding.value, decoded.value)
        )
          return {
            status: decoded.value.status,
            text: decoded.value.output,
            ...("governance" in decoded.value && decoded.value.governance
              ? { governance: decoded.value.governance }
              : {}),
          }
      }
      return yield* invalid(state, "wait", "Complete external result is unavailable; reconciliation is required")
    }).pipe(Effect.setContext(context))

  function waitCall(
    receipt: DelegationReceipt.External | DelegationReceipt.Sdk | DelegationReceipt.Acp | DelegationReceipt.Jsonl,
  ): Effect.Effect<Result, Error>
  function waitCall(receipt: Receipt): Effect.Effect<Result, DelegationService.ServiceError>
  function waitCall(
    receipt:
      | Receipt
      | DelegationReceipt.External
      | DelegationReceipt.Sdk
      | DelegationReceipt.Acp
      | DelegationReceipt.Jsonl,
  ): Effect.Effect<Result, Error> {
    return "kind" in receipt ? waitExternal(receipt) : waitInternal(receipt)
  }

  const recoverExternal = Effect.fn("DelegationExecution.recoverExternal")(function* (
    reference: typeof Reference.Type,
  ) {
    const state = yield* requireState(reference.delegationID)
    const deliveryKey = DelegationFold.deliveryKey(
      reference.turnID,
      reference.participantID,
      reference.deliveryOrigin,
      reference.senderParticipantID,
    )
    const originalDelivery = state.deliveries.get(deliveryKey)
    const participant = state.participants.get(reference.participantID)
    if (
      !originalDelivery ||
      originalDelivery.attempt !== reference.attempt ||
      !["admitted", "queued", "running", "completed", "failed", "cancelled", "recovery_required"].includes(
        originalDelivery.status,
      ) ||
      (participant?.provider !== "codex" && participant?.provider !== "claude-code") ||
      participant.phase === "closed" ||
      ["closing", "completed", "cancelled", "archived"].includes(state.delegation.status)
    )
      return
    const key = DelegationReceipt.key(reference)
    if (findExternalJob(key)) return
    const saved = Schema.decodeUnknownOption(DelegationReceipt.Binding)(yield* kv.get(key))
    if (Option.isNone(saved)) return
    const sdk = saved.value.target === "claude-code" && saved.value.transport === "sdk"
    const acp = saved.value.target === "claude-code" && saved.value.transport === "acp"
    const jsonl = saved.value.target === "claude-code" && saved.value.transport === "jsonl"
    if (
      participant.provider !== (sdk || acp || jsonl ? "claude-code" : "codex") ||
      saved.value.target !== participant.provider ||
      saved.value.parentSessionID !== state.delegation.parentSessionID ||
      DelegationReceipt.key(saved.value) !== key
    )
      return
    const restored = yield* Effect.gen(function* () {
      const binding = saved.value
      const receipt = DelegationReceipt.fromBinding(binding)
      if (
        !(
          receipt instanceof DelegationReceipt.Sdk ||
          receipt instanceof DelegationReceipt.Acp ||
          receipt instanceof DelegationReceipt.Jsonl
        ) ||
        binding.settlement?.status !== "completed"
      )
        return { binding, delivery: originalDelivery }
      const sessionID =
        receipt instanceof DelegationReceipt.Sdk
          ? receipt.sdkMessage.sessionID
          : receipt instanceof DelegationReceipt.Jsonl
            ? receipt.jsonlMessage.sessionID
            : receipt.acpPrompt.sessionID
      if (
        !DelegationReceipt.matches(binding, receipt) ||
        !sessionID ||
        (receipt instanceof DelegationReceipt.Sdk && !receipt.sdkMessage.messageID) ||
        (receipt instanceof DelegationReceipt.Jsonl && !receipt.jsonlMessage.messageID) ||
        sessionID !== participant.externalThreadID ||
        !binding.settlement.text.trim() ||
        (originalDelivery.status !== "running" && originalDelivery.status !== "completed")
      )
        return
      const task = (yield* tasks.get(binding.parentSessionID)).find((task) => task.id === binding.parentTaskID)
      if (
        !task ||
        !(
          (task.status === "in_progress" && task.revision === binding.parentTaskRevision) ||
          (task.status === "completed" &&
            task.revision === binding.parentTaskRevision + 1 &&
            task.outputDigest === DelegationReceipt.outputDigest(binding.settlement.text))
        )
      )
        return
      if (task.status === "completed" && originalDelivery.status === "completed")
        return { binding, delivery: originalDelivery }
      const parent = yield* store.get(binding.parentSessionID)
      const call = yield* externalCall(binding)
      if (
        !parent ||
        parent.mode === "custom" ||
        parent.location.directory !== binding.location.directory ||
        parent.location.workspaceID !== binding.location.workspaceID ||
        (state.delegation.metaAgentID &&
          (parent.controller?.kind !== "root" || parent.controller.metaAgentID !== state.delegation.metaAgentID)) ||
        !call ||
        (call.state.status !== "running" && call.state.status !== "completed") ||
        call.state.input.execution_type !== "external-cli"
      )
        return
      const ack = yield* readExternalOutput(call)
      if (binding.background === true) {
        if (Option.isNone(ack) || !DelegationReceipt.isBackgroundAck(binding, call, ack.value)) return
      }
      if (binding.background !== true && (call.state.status !== "running" || (yield* execution.isActive(parent.id))))
        return
      yield* settleExternalInputs(reference.delegationID, [binding], binding.settlement)
      const committed = Schema.decodeUnknownOption(DelegationReceipt.Binding)(yield* kv.get(key))
      const current = yield* requireState(reference.delegationID)
      const delivery = current.deliveries.get(deliveryKey)
      if (
        Option.isNone(committed) ||
        !delivery ||
        delivery.attempt !== reference.attempt ||
        delivery.status !== "completed"
      )
        return
      return { binding: committed.value, delivery }
    })
    if (!restored) return
    const binding = restored.binding
    const delivery = restored.delivery
    const queued =
      state.turns.get(reference.turnID)?.delivery === "queue" &&
      binding.externalTurnID === undefined &&
      (delivery.status === "queued" || delivery.status === "running")
    if (
      (!participant.externalThreadID && !(sdk && binding.background === true && binding.execution)) ||
      ((acp || jsonl) &&
        (binding.background === true ||
          delivery.status !== "completed" ||
          binding.settlement?.status !== "completed")) ||
      (sdk &&
        !queued &&
        (binding.background === true
          ? !terminal(delivery.status) || binding.settlement?.status !== delivery.status
          : delivery.status !== "completed" || binding.settlement?.status !== "completed"))
    )
      return
    if (sdk && binding.background === true && binding.settlement) {
      const wake = yield* notifyExternal(binding, binding.settlement)
      return wake ? { parentSessionID: binding.parentSessionID, status: "reconciled" as const } : undefined
    }
    if (queued) {
      const parent = yield* store.get(binding.parentSessionID)
      const call = yield* externalCall(binding)
      const ack = call ? yield* readExternalOutput(call) : Option.none<DelegationReceipt.Output>()
      if (
        !parent ||
        parent.mode === "custom" ||
        parent.id !== state.delegation.parentSessionID ||
        parent.location.directory !== binding.location.directory ||
        parent.location.workspaceID !== binding.location.workspaceID ||
        (binding.externalThreadID !== participant.externalThreadID &&
          !(sdk && binding.externalThreadID === undefined)) ||
        binding.execution === undefined ||
        (state.delegation.metaAgentID &&
          (parent.controller?.kind !== "root" || parent.controller.metaAgentID !== state.delegation.metaAgentID)) ||
        !call ||
        Option.isNone(ack) ||
        !DelegationReceipt.isBackgroundAck(binding, call, ack.value) ||
        ack.value.status !== "queued"
      )
        return
      const pending = new DelegationReceipt.Binding({
        ...binding,
        execution: delivery.status === "running" ? "start_unknown" : binding.execution,
      })
      yield* kv.set(key, Schema.encodeSync(DelegationReceipt.Binding)(pending))
      const result = {
        status: "recovery_required" as const,
        text:
          pending.execution === "queued"
            ? "Retained queued external input requires coordination after restart; no native turn was started"
            : "External start acceptance is unknown; its queued input requires coordination without replay",
      }
      yield* settleExternalInputs(reference.delegationID, [pending], result)
      const wake = yield* notifyExternal(pending, result)
      return wake ? { parentSessionID: parent.id, status: "reconciled" as const } : undefined
    }
    if (delivery.status === "failed" || delivery.status === "cancelled" || delivery.status === "recovery_required") {
      if (binding.background !== true) return
      // This terminal outcome is already stored; recover only its missing summary notification.
      const wake = yield* notifyExternal(binding, {
        status: delivery.status,
        text: `Retained external ${delivery.status} summary:\n${delivery.summary ?? "No detailed summary was retained."}`,
      })
      return wake ? { parentSessionID: binding.parentSessionID, status: "reconciled" as const } : undefined
    }
    if (participant.phase === "failed") return
    const parent = yield* sessions.get(state.delegation.parentSessionID)
    if (
      parent.mode === "custom" ||
      parent.location.directory !== binding.location.directory ||
      parent.location.workspaceID !== binding.location.workspaceID ||
      (state.delegation.metaAgentID &&
        (parent.controller?.kind !== "root" || parent.controller.metaAgentID !== state.delegation.metaAgentID))
    )
      return
    const receipt = DelegationReceipt.fromBinding(binding)
    if (!receipt || receipt instanceof DelegationReceipt.Pending || !DelegationReceipt.matches(binding, receipt)) return
    const externalThreadID = binding.externalThreadID
    if (
      externalThreadID !== participant.externalThreadID ||
      (receipt instanceof DelegationReceipt.External &&
        delivery.status === "completed" &&
        delivery.externalTurnID !== receipt.externalTurnID)
    )
      return
    const modelProvider = binding.modelProvider
    const cliVersion = binding.cliVersion
    const reader = (
      receipt instanceof DelegationReceipt.Sdk ||
      receipt instanceof DelegationReceipt.Acp ||
      receipt instanceof DelegationReceipt.Jsonl
        ? waitExternal(receipt).pipe(
            Effect.map(
              (result): CliAdapter.DelegationResult => ({
                status: result.status === "completed" ? "success" : "failed",
                summary: result.text,
              }),
            ),
          )
        : modelProvider && cliVersion
          ? Effect.gen(function* () {
              const readInput = {
                cwd: binding.location.directory,
                threadID: receipt.externalThreadID,
                turnID: receipt.externalTurnID,
                modelProvider,
                cliVersion,
              }
              if (binding.review && binding.settlement?.status === "completed")
                return {
                  status: "success" as const,
                  summary: binding.settlement.text,
                  sessionId: receipt.externalThreadID,
                  turnId: receipt.externalTurnID,
                }
              yield* Plugin.awaitActivation
              const adapter = yield* CliAdapter.resolve(
                yield* Config.Service.use((config) => config.entries()),
                binding.target,
              )
              if (adapter.command !== binding.command || !adapter.readResult)
                return yield* invalid(state, "recover", "External result reader or configured command changed")
              return yield* adapter.readResult(readInput)
            })
          : undefined
    )?.pipe(instances.provide(parent))
    if (!reader) return
    const message = yield* sessions.message({ sessionID: parent.id, messageID: binding.source.messageID })
    const call =
      message?.type === "assistant" && message.agent === binding.agent
        ? message.content.find((part) => part.type === "tool" && part.id === binding.source.id && part.name === "task")
        : undefined
    if (
      call?.type !== "tool" ||
      (call.state.status !== "running" && call.state.status !== "completed") ||
      call.state.input.execution_type !== "external-cli"
    )
      return
    // A foreground steer stores its full Binding after native ACK, before Started.
    const acceptedSteer =
      delivery.status === "admitted" &&
      binding.background !== true &&
      call.state.status === "running" &&
      call.state.input.command === "steer"
    if (delivery.status === "admitted" && !acceptedSteer) return
    const ack = yield* readExternalOutput(call)
    const backgroundAck = Option.isSome(ack) && DelegationReceipt.isBackgroundAck(binding, call, ack.value)
    if (!backgroundAck && (call.state.status !== "running" || (yield* execution.isActive(parent.id)))) return
    if (backgroundAck) {
      const notification = {
        sessionID: parent.id,
        inboxID: DelegationReceipt.notificationID(inputID(binding.delegationID, binding), binding.parentTaskID),
      }
      const decision = yield* SessionNotification.inspect(db, bus, store, notification)
      if (!decision.admit) {
        const notice = yield* readExternalNotice(binding)
        return Option.isSome(notice) && decision.wake
          ? { parentSessionID: parent.id, status: "reconciled" as const }
          : undefined
      }
    }
    const task = (yield* tasks.get(parent.id)).find((task) => task.id === binding.parentTaskID)
    if (
      !task ||
      !(
        (task.status === "in_progress" && task.revision === binding.parentTaskRevision) ||
        (task.status === "completed" && task.revision === binding.parentTaskRevision + 1)
      )
    )
      return
    const result = yield* backgroundAck
      ? reader.pipe(
          Effect.catch(() =>
            Effect.logWarning("External background result requires reconciliation", {
              delegationID: binding.delegationID,
              participantID: binding.participantID,
            }).pipe(Effect.as(undefined)),
          ),
        )
      : reader
    if (!result) return
    if (
      result.status !== "success" ||
      (receipt instanceof DelegationReceipt.External &&
        (result.sessionId !== receipt.externalThreadID || result.turnId !== receipt.externalTurnID)) ||
      !result.summary.trim()
    )
      return backgroundAck ? undefined : yield* invalid(state, "recover", "The bound external result is not complete")
    if (task.status === "completed" && task.outputDigest !== DelegationReceipt.outputDigest(result.summary)) return
    if (backgroundAck && receipt instanceof DelegationReceipt.External) {
      const currentState = yield* requireState(binding.delegationID)
      const currentDelivery = currentState.deliveries.get(deliveryKey)
      const currentParent = yield* store.get(parent.id)
      const currentCall = yield* externalCall(binding)
      if (!currentCall || currentCall.state.status !== "completed") return
      const currentAck = yield* readExternalOutput(currentCall)
      if (
        Option.isNone(currentAck) ||
        !DelegationReceipt.isBackgroundAck(binding, currentCall, currentAck.value) ||
        !currentParent ||
        currentParent.location.directory !== binding.location.directory ||
        currentParent.location.workspaceID !== binding.location.workspaceID ||
        !currentDelivery ||
        currentDelivery.attempt !== binding.attempt ||
        !["running", "completed"].includes(currentDelivery.status) ||
        (currentDelivery.status === "completed" && currentDelivery.externalTurnID !== receipt.externalTurnID) ||
        currentState.participants.get(binding.participantID)?.externalThreadID !== receipt.externalThreadID ||
        ["closing", "completed", "cancelled", "archived"].includes(currentState.delegation.status)
      )
        return
      const currentTask = (yield* tasks.get(parent.id)).find((task) => task.id === binding.parentTaskID)
      if (
        !currentTask ||
        !(
          (currentTask.status === "in_progress" && currentTask.revision === binding.parentTaskRevision) ||
          (currentTask.status === "completed" &&
            currentTask.revision === binding.parentTaskRevision + 1 &&
            currentTask.outputDigest === DelegationReceipt.outputDigest(result.summary))
        )
      )
        return
      if (currentDelivery.status !== "completed")
        yield* delegations.recordDelivery({
          ...receipt,
          status: "completed",
          summary: DelegationReceipt.outputDigest(result.summary),
        })
      if (currentTask.status === "in_progress") {
        const settled = yield* tasks.patch(
          {
            sessionID: parent.id,
            id: currentTask.id,
            expectedRevision: binding.parentTaskRevision,
            expect: ["in_progress"],
            status: "completed",
            outputDigest: DelegationReceipt.outputDigest(result.summary),
          },
          { settle: { source: binding.source, revision: binding.parentTaskRevision } },
        )
        if (!settled) return
      }
      const wake = yield* notifyExternal(binding, { status: "completed", text: result.summary })
      return wake ? { parentSessionID: parent.id, status: "reconciled" as const } : undefined
    }
    const finalize = Effect.gen(function* () {
      const settled = binding.review
        ? Schema.decodeUnknownOption(DelegationReceipt.Binding)(yield* kv.get(key))
        : Option.none<DelegationReceipt.Binding>()
      const response = DelegationReceipt.response(receipt, task.id, {
        status: "completed",
        text: result.summary,
        ...(Option.isSome(settled) && settled.value.settlement?.governance
          ? { governance: settled.value.settlement.governance }
          : {}),
      })
      return yield* Tool.finalizeResult({
        tool: "task",
        sessionID: parent.id,
        agent: Agent.ID.make(binding.agent),
        messageID: binding.source.messageID,
        id: Tool.CallID.make(binding.source.id),
        input: call.state.input,
        status: "completed",
        result: { ...response, output: Schema.encodeSync(DelegationReceipt.Output)(response.output) },
      }).pipe(
        Effect.flatMap((result) => ToolOutput.Service.use((output) => output.truncate(result))),
        instances.provide(parent),
      )
    })
    const finalized = binding.review ? undefined : yield* finalize
    // Reading the external store can take time; a concurrent owner or terminal tool wins.
    if (yield* execution.isActive(parent.id)) return
    const currentState = yield* requireState(reference.delegationID)
    const currentDelivery = currentState.deliveries.get(deliveryKey)
    if (
      !currentDelivery ||
      currentDelivery.attempt !== reference.attempt ||
      (!["running", "completed"].includes(currentDelivery.status) &&
        !(acceptedSteer && currentDelivery.status === "admitted")) ||
      (receipt instanceof DelegationReceipt.External &&
        currentDelivery.status === "completed" &&
        currentDelivery.externalTurnID !== receipt.externalTurnID) ||
      currentState.participants.get(reference.participantID)?.externalThreadID !== externalThreadID ||
      ["closing", "completed", "cancelled", "archived"].includes(currentState.delegation.status)
    )
      return
    const currentParent = yield* sessions.get(parent.id)
    if (
      currentParent.location.directory !== binding.location.directory ||
      currentParent.location.workspaceID !== binding.location.workspaceID
    )
      return
    const current = yield* sessions.message({ sessionID: parent.id, messageID: binding.source.messageID })
    if (
      current?.type !== "assistant" ||
      !current.content.some(
        (part) => part.type === "tool" && part.id === binding.source.id && part.state.status === "running",
      )
    )
      return
    const currentTask = (yield* tasks.get(parent.id)).find((task) => task.id === binding.parentTaskID)
    if (
      !currentTask ||
      !(
        (currentTask.status === "in_progress" && currentTask.revision === binding.parentTaskRevision) ||
        (currentTask.status === "completed" &&
          currentTask.revision === binding.parentTaskRevision + 1 &&
          currentTask.outputDigest === DelegationReceipt.outputDigest(result.summary))
      )
    )
      return
    if (binding.review)
      yield* settleExternalInputs(reference.delegationID, [binding], { status: "completed", text: result.summary })
    if (!binding.review && currentDelivery.status !== "completed")
      yield* delegations.recordDelivery({
        ...receipt,
        status: "completed",
        summary: DelegationReceipt.outputDigest(result.summary),
      })
    if (!binding.review && currentTask.status === "in_progress") {
      const settled = yield* tasks.patch(
        {
          sessionID: parent.id,
          id: task.id,
          expectedRevision: binding.parentTaskRevision,
          expect: ["in_progress"],
          status: "completed",
          outputDigest: DelegationReceipt.outputDigest(result.summary),
        },
        { settle: { source: binding.source, revision: binding.parentTaskRevision } },
      )
      if (!settled) return
    }
    const output = finalized ?? (yield* finalize)
    if (!isReadonlyArrayNonEmpty(output.content))
      return yield* invalid(state, "recover", "Recovered Task has no model content")
    const committed = yield* bus
      .publish(
        SessionEvent.Tool.Success,
        {
          sessionID: parent.id,
          assistantMessageID: binding.source.messageID,
          id: binding.source.id,
          content: output.content,
          metadata: output.metadata,
          executed: false,
        },
        {
          commit: () =>
            Effect.gen(function* () {
              const task = (yield* tasks.get(parent.id)).find((task) => task.id === binding.parentTaskID)
              const message = yield* sessions.message({ sessionID: parent.id, messageID: binding.source.messageID })
              const call =
                message?.type === "assistant"
                  ? message.content.find((part) => part.type === "tool" && part.id === binding.source.id)
                  : undefined
              if (
                task?.status !== "completed" ||
                task.revision !== binding.parentTaskRevision + 1 ||
                task.outputDigest !== DelegationReceipt.outputDigest(result.summary) ||
                call?.type !== "tool" ||
                call.state.status !== "completed" ||
                (yield* execution.isActive(parent.id))
              )
                return yield* Effect.die(new RecoveryConflict({}))
              const receipt = Schema.decodeUnknownOption(DelegationReceipt.Outcome)(
                call.state.metadata?.externalReceipt,
              )
              if (Option.isNone(receipt) || !DelegationReceipt.matches(binding, receipt.value))
                return yield* Effect.die(new RecoveryConflict({}))
            }),
        },
      )
      .pipe(
        Effect.as(true),
        Effect.catchCauseIf(
          (cause) =>
            cause.reasons.length > 0 &&
            cause.reasons.every((reason) => Cause.isDieReason(reason) && reason.defect instanceof RecoveryConflict),
          () => Effect.succeed(false),
        ),
      )
    if (!committed) return
    return { parentSessionID: parent.id, status: "reconciled" as const }
  })

  const readSources = Effect.fn("DelegationExecution.readSources")(function* (delegationID: DelegationID.ID) {
    const state = yield* requireState(delegationID)
    const events = yield* DelegationProjector.readEvents(db, delegationID)
    const decode = Schema.decodeUnknownOption(
      Schema.Union([
        DelegationEvent.DeliveryAdmitted,
        DelegationEvent.DeliveryStarted,
        DelegationEvent.DeliveryCompleted,
        DelegationEvent.DeliveryFailed,
        DelegationEvent.DeliveryCancelled,
        DelegationEvent.DeliveryRecoveryRequired,
      ]),
    )
    const history = events.flatMap((event) => {
      const value = decode(event)
      return Option.isSome(value) && value.value.data.delegationID === delegationID ? [value.value] : []
    })
    const latest = new Map(history.map((event) => [inputID(event.data.delegationID, event.data), event]))
    const admitted = new Map(
      history.flatMap((event) =>
        event.type === DelegationEvent.DeliveryAdmitted.type
          ? [[inputID(event.data.delegationID, event.data), event.data] as const]
          : [],
      ),
    )
    return yield* Effect.forEach([...admitted.values()], (identity) =>
      Effect.gen(function* () {
        const participant = state.participants.get(identity.participantID)
        const occurrence = latest.get(inputID(identity.delegationID, identity))
        if (!participant || !occurrence)
          return yield* invalid(state, "result", "Admitted delivery has no retained participant")
        const status: Delegation.DeliveryStatus =
          occurrence.type === DelegationEvent.DeliveryAdmitted.type
            ? occurrence.data.status
            : occurrence.type === DelegationEvent.DeliveryStarted.type
              ? "running"
              : occurrence.type === DelegationEvent.DeliveryCompleted.type
                ? "completed"
                : occurrence.type === DelegationEvent.DeliveryFailed.type
                  ? "failed"
                  : occurrence.type === DelegationEvent.DeliveryCancelled.type
                    ? "cancelled"
                    : "recovery_required"
        const base = {
          ...identity,
          delegationID,
          provider: participant.provider,
          status,
          current:
            state.deliveries.get(
              DelegationFold.deliveryKey(
                identity.turnID,
                identity.participantID,
                identity.deliveryOrigin,
                identity.senderParticipantID,
              ),
            )?.attempt === identity.attempt,
          updatedAt: occurrence.data.timestamp,
          summary: "summary" in occurrence.data ? occurrence.data.summary : undefined,
          errorCode: "errorCode" in occurrence.data ? occurrence.data.errorCode : undefined,
        }
        if (participant.provider === "internal" && participant.childSessionID) {
          const saved = yield* findInput(delegationID, participant.childSessionID, identity)
          const task = saved.matches
            ? Option.getOrUndefined(decodeTaskLink(saved.source?.payload.metadata?.task))
            : undefined
          return new Delegation.DeliveryInfo({
            ...base,
            status,
            receipt: saved.matches
              ? new Delegation.Receipt({ ...identity, childSessionID: participant.childSessionID, inputID: saved.id })
              : undefined,
            source: task?.source,
            parentTaskID: task?.parentTaskID,
          })
        }
        const binding = Schema.decodeUnknownOption(DelegationReceipt.Binding)(
          yield* kv.get(DelegationReceipt.key(identity)),
        )
        const owned =
          Option.isSome(binding) &&
          binding.value.parentSessionID === state.delegation.parentSessionID &&
          DelegationReceipt.key(binding.value) === DelegationReceipt.key(identity) &&
          binding.value.externalThreadID === participant.externalThreadID &&
          (occurrence.type !== DelegationEvent.DeliveryCompleted.type ||
            occurrence.data.externalTurnID === undefined ||
            binding.value.externalTurnID === occurrence.data.externalTurnID)
        return new Delegation.DeliveryInfo({
          ...base,
          status,
          source: owned ? binding.value.source : undefined,
          parentTaskID: owned ? binding.value.parentTaskID : undefined,
          externalThreadID: owned ? binding.value.externalThreadID : undefined,
          externalTurnID: owned ? binding.value.externalTurnID : undefined,
        })
      }),
    )
  })

  const matchesReceipt = (
    value: typeof Reference.Type & { readonly childSessionID: unknown; readonly inputID: unknown },
    receipt: Receipt,
  ) =>
    inputID(value.delegationID, value) === receipt.inputID &&
    value.childSessionID === receipt.childSessionID &&
    value.inputID === receipt.inputID

  const readResult = Effect.fn("DelegationExecution.readResult")(function* (
    input: Parameters<Interface["readResult"]>[0],
  ) {
    const state = yield* requireState(input.delegationID)
    const sources = yield* readSources(input.delegationID)
    const delivery = sources.find(
      (source) => inputID(source.delegationID, source) === inputID(input.delegationID, input),
    )
    if (!delivery) return yield* invalid(state, "result", "Delivery identity was not admitted")
    const result = (text?: string) => new Delegation.Result({ delivery, available: text !== undefined, text })
    if (delivery.provider !== "internal") {
      const decoded = Schema.decodeUnknownOption(DelegationReceipt.Binding)(yield* kv.get(DelegationReceipt.key(input)))
      if (Option.isNone(decoded)) return result()
      const binding = decoded.value
      if (
        binding.parentSessionID !== state.delegation.parentSessionID ||
        DelegationReceipt.key(binding) !== DelegationReceipt.key(delivery) ||
        delivery.source?.type !== "tool" ||
        binding.source.messageID !== delivery.source.messageID ||
        binding.source.id !== delivery.source.id ||
        binding.parentTaskID !== delivery.parentTaskID ||
        binding.externalThreadID !== delivery.externalThreadID ||
        binding.externalTurnID !== delivery.externalTurnID
      )
        return result()
      const call = yield* externalCall(binding)
      const output = call ? yield* readExternalOutput(call) : Option.none<DelegationReceipt.Output>()
      const committed = Schema.decodeUnknownOption(DelegationReceipt.Outcome)(
        call?.state.status === "completed" ? call.state.metadata?.externalReceipt : undefined,
      )
      if (
        Option.isSome(output) &&
        Option.isSome(committed) &&
        DelegationReceipt.matches(binding, committed.value) &&
        DelegationReceipt.matchesOutput(binding, output.value) &&
        terminal(output.value.status)
      )
        return result(output.value.output)
      if (call && Option.isSome(output) && DelegationReceipt.isBackgroundAck(binding, call, output.value)) {
        const notice = yield* readExternalNotice(binding)
        if (Option.isSome(notice)) return result(notice.value.output)
      }
      if (call?.state.status === "error" && binding.settlement?.status === delivery.status)
        return result(binding.settlement.text)
      return result()
    }
    if (!delivery.receipt) return result()
    const receipt = delivery.receipt
    const completion = yield* SessionInputResult.read(db, {
      sessionID: receipt.childSessionID,
      inputID: receipt.inputID,
    })
    const completedText = completion.status === "completed" ? SubagentCompletion.text(completion.assistant) : undefined
    if (
      completion.status === "completed" &&
      completion.assistant.content.some((part) => part.type === "text" && part.text.length > 0)
    )
      return result(completedText)
    if (completedText !== undefined && delivery.source?.type !== "tool") return result(completedText)
    if (completedText === undefined && delivery.parentTaskID) {
      const id = DelegationReceipt.notificationID(receipt.inputID, delivery.parentTaskID)
      const projected = yield* store.message(id)
      const pending = projected ? undefined : yield* SessionInbox.find(db, id)
      const notice =
        projected?.sessionID === state.delegation.parentSessionID && projected.message.type === "synthetic"
          ? projected.message
          : pending?.sessionID === state.delegation.parentSessionID && pending.type === "synthetic"
            ? pending.payload
            : undefined
      const reference = decodeReference(notice?.metadata?.delegation)
      if (
        notice &&
        Option.isSome(reference) &&
        matchesReceipt(
          { ...reference.value, childSessionID: notice.metadata?.childID, inputID: notice.metadata?.inputID },
          receipt,
        ) &&
        notice.metadata?.source === "task" &&
        notice.metadata.parentTaskID === delivery.parentTaskID
      )
        return result(notice.text)
    }
    if (delivery.source?.type === "tool") {
      const source = delivery.source
      const message = yield* sessions.message({
        sessionID: state.delegation.parentSessionID,
        messageID: SessionMessage.ID.make(source.messageID),
      })
      const call =
        message?.type === "assistant"
          ? message.content.find((part) => part.type === "tool" && part.id === source.id)
          : undefined
      if (completedText !== undefined)
        return result(
          call?.type === "tool" &&
            call.name === "task" &&
            call.state.status !== "streaming" &&
            call.state.input.execution_type === "judge"
            ? ""
            : completedText,
        )
      if (call?.type === "tool" && call.name === "task" && call.state.status !== "streaming") {
        const { TaskTool } = yield* Effect.promise(() => import("../tool/plugin/task.js"))
        const text = yield* readToolText(call)
        const judge = Option.isSome(text)
          ? Schema.decodeUnknownOption(Schema.fromJsonString(TaskTool.JudgeOutput))(text.value)
          : Option.none()
        const retained = Schema.decodeUnknownOption(TaskTool.JudgeOutput.fields.workers)(
          call.state.metadata?.completedWorkers,
        )
        const workers = [
          ...(Option.isSome(retained) ? retained.value : []),
          ...(Option.isSome(judge)
            ? [
                ...judge.value.workers,
                ...(judge.value.retained ?? []).flatMap((entry) => entry.workers),
                ...[
                  judge.value.arbitration === "none" ? undefined : judge.value.arbitration?.result,
                  judge.value.summary?.result,
                ].filter((entry) => entry !== undefined),
              ]
            : []),
        ]
        const worker = workers.find(
          (worker) =>
            worker.receipt &&
            matchesReceipt(worker.receipt, receipt) &&
            worker.delegationID === receipt.delegationID &&
            worker.participantID === receipt.participantID &&
            worker.turnID === receipt.turnID &&
            worker.taskID === delivery.parentTaskID &&
            terminal(worker.status) &&
            worker.source.type === "tool" &&
            worker.source.messageID === source.messageID &&
            worker.source.id === source.id,
        )
        if (worker) return result(worker.text)
        const direct = Schema.decodeUnknownOption(Delegation.Receipt)(call.state.metadata?.receipt)
        const status = Schema.decodeUnknownOption(Delegation.DeliveryStatus)(call.state.metadata?.status)
        if (
          call.state.status === "completed" &&
          Option.isSome(direct) &&
          matchesReceipt(direct.value, receipt) &&
          call.state.metadata?.parentTaskID === delivery.parentTaskID &&
          Option.isSome(status) &&
          terminal(status.value) &&
          Option.isSome(text)
        )
          return result(text.value)
      }
    }
    if (completion.status === "failed") return result(completion.error?.message)
    return result()
  })

  const internalParticipant = Effect.fn("DelegationExecution.internalParticipant")(function* (
    occurrenceID: Schedule.OccurrenceID,
  ): Effect.fn.Return<Receipt, Error> {
    const run = yield* schedules.occurrence(occurrenceID)
    if (run?.receipt) return run.receipt
    if (!run || run.snapshot.kind !== "task" || run.snapshot.target?.policy !== "legacy_child" || !run.taskID)
      return yield* new ScheduledExecutionError({
        message: "Internal scheduled execution requires a claimed retained Task occurrence",
      })
    if (run.cancelRequested || ["completed", "cancelled", "failed", "blocked", "skipped"].includes(run.status))
      return yield* new ScheduledExecutionError({ message: "The scheduled occurrence already has a terminal outcome" })
    const parent = yield* sessions.get(run.sessionID)
    const source = new Permission.OperationSource({
      type: "operation",
      sessionID: parent.id,
      operationID: run.operationID,
    })
    const current = (yield* tasks.get(parent.id)).find((task) => task.id === run.taskID)
    if (!current) return yield* new ScheduledExecutionError({ message: "The scheduled Task no longer exists" })
    const claimed =
      run.taskRevision !== undefined
        ? current.status === "in_progress" && current.revision === run.taskRevision
          ? current
          : undefined
        : yield* tasks.patch(
            {
              sessionID: parent.id,
              id: current.id,
              expectedRevision: current.revision,
              expect: ["pending", "scheduled", "completed", "failed"],
              status: "in_progress",
            },
            {
              claim: source,
              commit: (task) =>
                schedules
                  .advanceOccurrence(run.id, new Schedule.OccurrenceChange({ taskRevision: task.revision }))
                  .pipe(Effect.asVoid, Effect.orDie),
            },
          )
    if (!claimed)
      return yield* new ScheduledExecutionError({
        message: "The scheduled Task changed or has another execution owner",
      })
    const selected = yield* Effect.gen(function* () {
      yield* Plugin.awaitActivation
      const agents = yield* Agent.Service
      const actor = run.actorAgent ?? run.snapshot.sourceAgent ?? (yield* agents.resolve(parent.agent, parent.mode))?.id
      if (!actor) return yield* new ScheduledExecutionError({ message: "The scheduled source Agent is unavailable" })
      const permission = yield* Permission.Service
      yield* schedules.advanceOccurrence(run.id, new Schedule.OccurrenceChange({ actorAgent: actor }))
      yield* permission.assert({
        id: Permission.ID.make(`per_schedule_${run.id}`),
        sessionID: parent.id,
        agent: actor,
        action: "task",
        resources: [
          run.snapshot.target?.policy === "legacy_child" ? (run.snapshot.target.agentID ?? "build") : "build",
        ],
        source,
        metadata: { scheduleID: run.scheduleID, occurrenceID: run.id, operationID: run.operationID },
      })
      const preference =
        run.snapshot.target?.policy === "legacy_child"
          ? (run.snapshot.target.agentID ?? Agent.ID.make("build"))
          : Agent.ID.make("build")
      const agent =
        parent.mode === "custom"
          ? (yield* compositions.selectAgent(parent.id, preference)).info
          : yield* agents.resolve(preference, parent.mode)
      if (!agent || agent.mode === "primary")
        return yield* new ScheduledExecutionError({ message: "The scheduled child Agent is unavailable" })
      const executor =
        actor === "meta" && parent.controller?.kind === "root"
          ? yield* Session.resolveExecutor(parent, agent).pipe(
              Effect.provideService(SessionComposition.Service, compositions),
            )
          : undefined
      return { actor, agent, executor }
    }).pipe(instances.provide(parent))
    return yield* serializedSelection(
      run.sessionID,
      Effect.gen(function* () {
        const latest = yield* schedules.occurrence(run.id)
        if (
          !latest ||
          latest.cancelRequested ||
          ["completed", "failed", "cancelled", "blocked", "skipped"].includes(latest.status)
        )
          return yield* new ScheduledExecutionError({ message: "The scheduled child was cancelled before admission" })
        const route = yield* delegations.internalParticipant({
          occurrenceID: run.id,
          agent: selected.agent.id,
          actor: selected.actor,
          executor: selected.executor,
        })
        const receipts = yield* dispatch({
          ...route,
          prompt: run.snapshot.content,
          task: {
            parentTaskID: claimed.id,
            parentTaskRevision: claimed.revision,
            description: run.snapshot.content,
            background: true,
            source,
          },
        })
        const receipt = receipts.find(
          (item) => item.participantID === route.participantID && item.turnID === route.turnID,
        )
        if (!receipt || receipt.inputID !== run.inputID || receipt.childSessionID !== run.targetSessionID)
          return yield* new ScheduledExecutionError({
            message: "The scheduled child admission has a different fixed input identity",
          })
        yield* schedules.advanceOccurrence(
          run.id,
          new Schedule.OccurrenceChange({
            receipt,
            status: "admitted",
            admission: new Schedule.Admission({
              targetSessionID: receipt.childSessionID,
              inputID: receipt.inputID,
              operationID: run.operationID,
              taskID: claimed.id,
              taskRevision: claimed.revision,
              admittedAt: (yield* DateTime.nowAsDate).getTime(),
            }),
          }),
        )
        return receipt
      }),
    )
  })

  return Service.of({
    internalParticipant,
    readSources: (input) => readSources(input).pipe(Effect.setContext(context)),
    readResult: (input) => readResult(input).pipe(Effect.setContext(context)),
    dispatch: dispatchCall,
    wait: waitCall,
    preflightExternalSteer: (input) =>
      locks
        .withLock(input.delegationID)(requireExternalSteerOwner(input))
        .pipe(
          Effect.map((owned) => ({
            parentTaskID: owned.owner[1].binding.parentTaskID,
            parentTaskRevision: owned.owner[1].binding.parentTaskRevision,
            source: owned.owner[1].binding.source,
          })),
          Effect.setContext(context),
        ),
    recover,
    recoverPending: Effect.gen(function* () {
      // Projection bindings protect claims even when retained history cannot be read.
      const bindings = yield* db
        .select({ childSessionID: DelegationParticipantTable.child_session_id })
        .from(DelegationParticipantTable)
        .where(eq(DelegationParticipantTable.provider, "internal"))
        .all()
      const boundChildren = bindings.flatMap((binding) => (binding.childSessionID ? [binding.childSessionID] : []))
      if (!bus.retainsEvents)
        return new PendingRecoveryResult({
          parents: [],
          deferredChildren: [...new Set(boundChildren)],
          scanAvailable: true,
        })
      const states = yield* delegations.list({ includeArchived: true })
      const externalResults = yield* Effect.forEach(states, (state) =>
        Effect.forEach(
          [...state.deliveries.values()].filter((delivery) =>
            ["codex", "claude-code"].includes(state.participants.get(delivery.participantID)?.provider ?? ""),
          ),
          (delivery) =>
            locks.withLock(state.delegation.id)(
              recoverExternal({ delegationID: state.delegation.id, ...delivery }).pipe(
                Effect.catch(() =>
                  Effect.logWarning("External Task recovery requires reconciliation", {
                    delegationID: state.delegation.id,
                    participantID: delivery.participantID,
                    turnID: delivery.turnID,
                  }).pipe(
                    Effect.as({ parentSessionID: state.delegation.parentSessionID, status: "deferred" as const }),
                  ),
                ),
              ),
            ),
        ),
      )
      const results = yield* Effect.forEach(states, (state) =>
        Effect.forEach(
          [...state.participants.values()].filter(
            (participant) =>
              participant.provider === "internal" &&
              participant.childSessionID &&
              [...state.deliveries.values()].some((delivery) => delivery.participantID === participant.id),
          ),
          (participant) =>
            recover({
              kind: "delegation",
              delegationID: state.delegation.id,
              participantID: participant.id,
              childSessionID: participant.childSessionID ?? Session.ID.make(`ses_delegation_${participant.id}`),
              parentSessionID: state.delegation.parentSessionID,
              description: state.delegation.title,
            }).pipe(
              Effect.catchCause((cause) => {
                if (Cause.hasInterrupts(cause)) return Effect.failCause(cause)
                return Effect.logWarning("Delegation recovery was deferred", {
                  delegationID: state.delegation.id,
                  participantID: participant.id,
                }).pipe(
                  Effect.as(
                    new RecoveryResult({
                      status: "deferred",
                      childSessionID: participant.childSessionID ?? Session.ID.make(`ses_delegation_${participant.id}`),
                    }),
                  ),
                )
              }),
            ),
        ),
      )
      const outcomes = results.flat()
      const external = externalResults.flat().filter((result) => result !== undefined)
      const deferredParents = [
        ...new Set(external.filter((result) => result.status === "deferred").map((result) => result.parentSessionID)),
      ]
      const reconciled = new Set(
        outcomes.filter((result) => result.status === "reconciled").map((result) => result.childSessionID),
      )
      return new PendingRecoveryResult({
        parents: [
          ...new Set([
            ...external.filter((result) => result.status === "reconciled").map((result) => result.parentSessionID),
            ...outcomes.flatMap((result) => (result.parentSessionID ? [result.parentSessionID] : [])),
          ]),
        ],
        deferredChildren: [
          ...new Set([
            ...boundChildren.filter((childSessionID) => !reconciled.has(childSessionID)),
            ...outcomes.filter((result) => result.status === "deferred").map((result) => result.childSessionID),
          ]),
        ],
        ...(deferredParents.length ? { deferredParents } : {}),
        scanAvailable: true,
      })
    }).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterrupts(cause))
          return Effect.failCause(
            Cause.fromReasons<never>(
              cause.reasons.map((reason) => (Cause.isFailReason(reason) ? Cause.makeDieReason(reason.error) : reason)),
            ),
          )
        return Effect.logWarning("Delegation recovery scan was deferred", { tag: "RecoveryUnavailable" }).pipe(
          Effect.as(new PendingRecoveryResult({ parents: [], deferredChildren: [], scanAvailable: false })),
        )
      }),
      Effect.setContext(context),
    ),
    retry: (input) =>
      locks
        .withLock(input.delegationID)(
          Effect.gen(function* () {
            const previous = yield* requireInput(input)
            if (!["failed", "cancelled", "recovery_required"].includes(previous.delivery.status))
              return yield* invalid(previous.state, "retry", "Delivery is not retryable")
            if (
              previous.participant.phase === "closed" ||
              ["closing", "completed", "cancelled", "archived"].includes(previous.state.delegation.status)
            )
              return yield* invalid(previous.state, "retry", "Delegation cannot accept execution")
            if (
              [...previous.state.deliveries.values()].some(
                (delivery) =>
                  delivery.participantID === input.participantID &&
                  delivery.status === "recovery_required" &&
                  delivery !== previous.delivery,
              )
            )
              return yield* invalid(
                previous.state,
                "retry",
                "Other participant inputs require reconciliation before retry",
              )
            const link = decodeTaskLink(previous.source.payload.metadata?.task)
            const linked = Option.isSome(link)
              ? (yield* tasks.get(previous.state.delegation.parentSessionID)).find(
                  (task) => task.id === link.value.parentTaskID,
                )
              : undefined
            if (Option.isSome(link) && (linked === undefined || linked.status === "scheduled"))
              return yield* invalid(previous.state, "retry", "Linked parent Task is unavailable for retry")
            const parentTask = Option.isSome(link)
              ? yield* tasks
                  .patch(
                    {
                      sessionID: previous.state.delegation.parentSessionID,
                      id: link.value.parentTaskID,
                      status: "in_progress",
                      expectedRevision: linked?.revision,
                      expect: ["pending", "in_progress", "completed", "failed", "cancelled"],
                    },
                    link.value.source
                      ? {
                          claim: link.value.source,
                          settle: { source: link.value.source, revision: link.value.parentTaskRevision },
                        }
                      : undefined,
                  )
                  .pipe(Effect.mapError((error) => invalid(previous.state, "retry", error.message)))
              : undefined
            if (Option.isSome(link) && parentTask === undefined)
              return yield* invalid(previous.state, "retry", "Linked parent Task changed before retry")
            yield* delegations.retry(input).pipe(
              Effect.onError(() =>
                Option.isSome(link) && link.value.source && parentTask
                  ? tasks
                      .patch(
                        {
                          sessionID: previous.state.delegation.parentSessionID,
                          id: parentTask.id,
                          status: "failed",
                          expectedRevision: parentTask.revision,
                          expect: ["in_progress"],
                        },
                        { settle: { source: link.value.source, revision: parentTask.revision } },
                      )
                      .pipe(Effect.orDie)
                  : Effect.void,
              ),
            )
            // Admit the new attempt before removing its pending predecessor; neither may wake before cancellation.
            yield* dispatch({
              ...input,
              prompt: previous.source.payload.text,
              task:
                Option.isSome(link) && parentTask
                  ? { ...link.value, parentTaskRevision: parentTask.revision }
                  : undefined,
              superseded: previous.saved.pending
                ? { sessionID: previous.saved.pending.sessionID, inboxID: previous.saved.id }
                : undefined,
            })
            return
          }),
        )
        .pipe(Effect.setContext(context)),
    steer: (input) =>
      locks
        .withLock(input.delegationID)(
          Effect.gen(function* () {
            const previous = yield* requireInput(input)
            if (
              terminal(previous.delivery.status) ||
              ["closing", "completed", "cancelled", "archived"].includes(previous.state.delegation.status)
            )
              return yield* invalid(previous.state, "steer", "Delivery cannot be steered")
            if (
              [...previous.state.deliveries.values()].some(
                (delivery) => delivery.participantID === input.participantID && delivery.status === "recovery_required",
              )
            )
              return yield* invalid(
                previous.state,
                "steer",
                "Participant has unresolved Session inputs; reconcile them before executing new work",
              )
            if (previous.saved.pending)
              yield* sessions.steerInbox({ sessionID: previous.saved.pending.sessionID, inboxID: previous.saved.id })
            yield* execution.wake(previous.source.sessionID)
          }),
        )
        .pipe(Effect.setContext(context)),
    close: (input) =>
      locks
        .withLock(input.delegationID)(
          Effect.gen(function* () {
            yield* delegations.close(input)
            const state = yield* requireState(input.delegationID)
            const external = [...externalJobs.entries()].filter(
              ([, value]) => value.binding.delegationID === input.delegationID,
            )
            external.forEach(([, value]) => {
              value.stopping = true
            })
            // Commit the fence before interrupting. Pending work is explicitly cancelled; history survives.
            const notifications = yield* Effect.forEach([...state.participants.values()], (participant) =>
              Effect.gen(function* () {
                if (!participant.childSessionID) return
                const recovery: Recovery = {
                  kind: "delegation",
                  delegationID: input.delegationID,
                  participantID: participant.id,
                  parentSessionID: state.delegation.parentSessionID,
                  childSessionID: participant.childSessionID,
                  description: state.delegation.title,
                }
                const owned = yield* ownsChild(state, recovery)
                if (owned) {
                  yield* execution.interrupt(participant.childSessionID)
                  yield* execution.awaitIdle(participant.childSessionID)
                }
                for (const delivery of state.deliveries.values()) {
                  if (
                    delivery.participantID !== participant.id ||
                    ["completed", "failed", "cancelled"].includes(delivery.status)
                  )
                    continue
                  const saved = yield* findInput(input.delegationID, participant.childSessionID, delivery)
                  if (!owned || !saved.matches || !saved.pending) continue
                  yield* sessions.cancelInbox({ sessionID: participant.childSessionID, inboxID: saved.id })
                  yield* delegations.recordDelivery({
                    delegationID: input.delegationID,
                    ...delivery,
                    status: "cancelled",
                    summary: "Delegation closed before input delivery",
                  })
                }
                const result = yield* settle(recovery, true)
                return {
                  notifyParent: result.notifyParent,
                  jobID: `delegation:${participant.id}`,
                  release: owned ? participant.childSessionID : undefined,
                }
              }),
            )
            // Close also abandons unresolved or never-admitted deliveries; it does not claim they completed.
            const remaining = yield* requireState(input.delegationID)
            const unresolved = [...remaining.deliveries.values()].filter(
              (delivery) => !["completed", "failed", "cancelled"].includes(delivery.status),
            )
            yield* Effect.forEach(
              unresolved,
              (delivery) =>
                delegations.recordDelivery({
                  delegationID: input.delegationID,
                  ...delivery,
                  status: "cancelled",
                  summary: "Delegation owner closed this delivery",
                }),
              { discard: true },
            )
            const corrections = yield* Effect.forEach(
              [...remaining.participants.values()].filter((participant) =>
                unresolved.some((delivery) => delivery.participantID === participant.id),
              ),
              (participant) =>
                Effect.gen(function* () {
                  if (!participant.childSessionID) return false
                  // A recovery-required input may already be visible or removed from the inbox.
                  // Project the owner's final cancellation after that delivery fact is committed.
                  return (yield* settle(
                    {
                      kind: "delegation",
                      delegationID: input.delegationID,
                      participantID: participant.id,
                      parentSessionID: state.delegation.parentSessionID,
                      childSessionID: participant.childSessionID,
                      description: state.delegation.title,
                    },
                    true,
                  )).notifyParent
                }),
            )
            return {
              parent:
                notifications.some((result) => result?.notifyParent) || corrections.some(Boolean)
                  ? state.delegation.parentSessionID
                  : undefined,
              jobs: [
                ...external.map(([key]) => key),
                ...notifications.flatMap((result) => (result ? [result.jobID] : [])),
              ],
              releases: notifications.flatMap((result) => (result?.release ? [result.release] : [])),
            }
          }),
        )
        .pipe(
          Effect.andThen((plan) =>
            Effect.gen(function* () {
              // The close fence is durable before native Scope cleanup can wait for settlement.
              yield* Effect.forEach(
                plan.jobs,
                (id) =>
                  jobs
                    .cancel(id)
                    .pipe(
                      Effect.andThen((job) =>
                        job?.notificationID ? jobs.completeBackground(job.notificationID) : Effect.void,
                      ),
                    ),
                { discard: true },
              )
              yield* Effect.forEach(plan.releases, (id) => store.release(id), { discard: true })
              if (plan.parent) yield* execution.wake(plan.parent)
            }),
          ),
          Effect.setContext(context),
        ),
    interrupt: (input) =>
      locks
        .withLock(input.delegationID)(
          Effect.gen(function* () {
            const state = yield* requireState(input.delegationID)
            if (input.turnID !== undefined) {
              if (input.participantID === undefined)
                return yield* invalid(state, "interrupt", "A precise interrupt requires participant_id")
              const delivery = [...state.deliveries.values()].find(
                (delivery) => delivery.turnID === input.turnID && delivery.participantID === input.participantID,
              )
              const binding = delivery ? yield* unstartedExternal(state, delivery) : undefined
              if (
                !delivery ||
                !binding ||
                !["queued", "recovery_required", "cancelled"].includes(delivery.status) ||
                ["closing", "completed", "cancelled", "archived"].includes(state.delegation.status)
              )
                return yield* invalid(
                  state,
                  "interrupt",
                  "The requested input is not a proven unstarted external queue",
                )
              const key = DelegationReceipt.key(binding)
              const owner = findExternalJob(key)
              if (
                owner &&
                (owner[0] !== key ||
                  owner[1].inputs.size !== 1 ||
                  !owner[1].inputs.has(key) ||
                  !DelegationReceipt.matches(owner[1].binding, DelegationReceipt.pending(binding, "queued")))
              )
                return yield* invalid(state, "interrupt", "The requested input does not own an independent pending Job")
              if (owner) owner[1].stopping = true
              // Recovery may have settled the Task before its observer admitted the original notice.
              if (delivery.status === "recovery_required") {
                const settled = yield* jobs.get(key)
                yield* notifyExternal(binding, {
                  status: "recovery_required",
                  text:
                    settled?.output ??
                    settled?.error ??
                    delivery.summary ??
                    "External queued input requires reconciliation",
                })
              }
              const result = {
                status: "cancelled" as const,
                text: "External queued input cancelled before native start",
              }
              if (delivery.status !== "cancelled")
                yield* delegations.recordDelivery({ ...binding, status: "cancelled", summary: result.text })
              if (!owner) {
                yield* settleExternalInputs(input.delegationID, [binding], result)
                yield* notifyExternal(binding, result)
              }
              // Native Scope finalizers may take this same lock; cancel only this Job after releasing it.
              return owner ? [owner[0]] : []
            }
            const external = [...externalJobs.entries()].filter(
              ([, value]) =>
                value.binding.delegationID === input.delegationID &&
                (input.participantID === undefined || value.binding.participantID === input.participantID),
            )
            external.forEach(([, value]) => {
              value.stopping = true
            })
            yield* Effect.forEach(
              [...state.participants.values()].filter(
                (participant) => input.participantID === undefined || participant.id === input.participantID,
              ),
              (participant) =>
                Effect.gen(function* () {
                  if (!participant.childSessionID || !(yield* store.get(participant.childSessionID))) return
                  yield* delegations.bindParticipant({
                    delegationID: input.delegationID,
                    participantID: participant.id,
                    childSessionID: participant.childSessionID,
                  })
                  yield* execution.interrupt(participant.childSessionID)
                }),
              { discard: true },
            )
            return external.map(([key]) => key)
          }),
        )
        .pipe(
          Effect.andThen((ids) => Effect.forEach(ids, (id) => jobs.cancel(id), { discard: true })),
          Effect.setContext(context),
        ),
  })
})

export const layer = Layer.effect(Service, make)

export const node: LayerNode.Provider<Service, never, typeof Node.tags.values.global> = Node.makeGlobalNode({
  service: Service,
  layer,
  deps: [
    Database.node,
    Bus.node,
    DelegationService.node,
    Session.node,
    SessionStore.node,
    SessionComposition.node,
    SessionExecution.node,
    Job.node,
    KV.node,
    Instance.node,
    SessionTask.node,
    ScheduleService.node,
    FSUtil.node,
    AppProcess.node,
    Git.node,
  ],
})
