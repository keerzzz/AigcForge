import { Composition } from "@aigcfroge/schema/composition"
import { FileDiff } from "@aigcfroge/schema/file-diff"
import { Model } from "@aigcfroge/schema/model"
import { MetaAgent } from "@aigcfroge/schema/meta-agent"
import { PermissionTier } from "@aigcfroge/schema/permission-tier"
import { ProductMode } from "@aigcfroge/schema/product-mode"
import { Provider } from "@aigcfroge/schema/provider"
import { optional } from "@aigcfroge/schema/schema"
import { Session } from "@aigcfroge/schema/session"
import { SessionIdentity } from "@aigcfroge/schema/session-identity"
import { SessionInput } from "@aigcfroge/schema/session-input"
import { SessionTask } from "@aigcfroge/schema/session-task"
import { PermissionV1 } from "@aigcfroge/schema/v1/permission"
import { SessionV1 } from "@aigcfroge/schema/v1/session"
import { WorkPreset } from "@aigcfroge/schema/work-preset"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import { Workspace } from "@aigcfroge/schema/workspace"
import { Effect, Schema, Struct } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import {
  ApiNotFoundError,
  ConflictError,
  ForbiddenError,
  InvalidRequestError,
  PermissionNotFoundError,
  SessionBusyError,
  UnknownError,
  UnsupportedProductModeError,
} from "../errors.js"
import { Authorization } from "../middleware/authorization.js"
import {
  InstanceContext,
  WorkspaceRouting,
  WorkspaceRoutingQuery,
  WorkspaceRoutingQueryFields,
} from "../middleware/workspace-routing.js"
import { described } from "./metadata.js"
import { QueryBoolean } from "./query.js"

// Lift block: contracts lifted from the fork entry session model and core session
// services. The `SessionInstance.*` identifier namespace keeps them disjoint from
// the base `server.session` contracts.

export const SessionInstanceMetadata = Schema.Record(Schema.String, Schema.Any).annotate({
  identifier: "SessionInstance.Metadata",
})

export const SessionInstanceArchivedTimestamp = Schema.Finite

const SessionInstanceSummaryShape = Schema.Struct({
  additions: Schema.Finite,
  deletions: Schema.Finite,
  files: Schema.Finite,
  diffs: Schema.Array(FileDiff.Info).pipe(optional),
})

const SessionInstanceTokens = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
  reasoning: Schema.Finite,
  cache: Schema.Struct({
    read: Schema.Finite,
    write: Schema.Finite,
  }),
})

const SessionInstanceShare = Schema.Struct({ url: Schema.String })

const SessionInstanceTime = Schema.Struct({
  created: Schema.Finite,
  updated: Schema.Finite,
  compacting: Schema.Finite.pipe(optional),
  archived: SessionInstanceArchivedTimestamp.pipe(optional),
})

const SessionInstanceRevert = Schema.Struct({
  messageID: SessionV1.MessageID,
  partID: SessionV1.PartID.pipe(optional),
  snapshot: Schema.String.pipe(optional),
  diff: Schema.String.pipe(optional),
})

const SessionInstanceModel = Schema.Struct({
  id: Model.ID,
  providerID: Provider.ID,
  variant: Schema.String.pipe(optional),
})

export const SessionInstanceInfo = Schema.Struct({
  id: Session.ID,
  mode: ProductMode.ID.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(ProductMode.Default as ProductMode.ID)),
    Schema.withConstructorDefault(Effect.succeed(ProductMode.Default as ProductMode.ID)),
  ),
  presetCategoryId: Schema.optional(WorkPreset.Category),
  slug: Schema.String,
  projectID: Schema.String,
  workspaceID: optional(Workspace.ID),
  directory: Schema.String,
  path: Schema.String.pipe(optional),
  parentID: Session.ID.pipe(optional),
  summary: SessionInstanceSummaryShape.pipe(optional),
  cost: Schema.Finite.pipe(optional),
  tokens: SessionInstanceTokens.pipe(optional),
  share: SessionInstanceShare.pipe(optional),
  title: Schema.String,
  agent: Schema.String.pipe(optional),
  model: SessionInstanceModel.pipe(optional),
  version: Schema.String,
  metadata: SessionInstanceMetadata.pipe(optional),
  time: SessionInstanceTime,
  permission: PermissionV1.Ruleset.pipe(optional),
  permissionTier: PermissionTier.ID.pipe(optional),
  attended: Schema.Boolean.pipe(optional),
  revert: SessionInstanceRevert.pipe(optional),
}).annotate({ identifier: "SessionInstance.Info" })
export interface SessionInstanceInfo extends Schema.Schema.Type<typeof SessionInstanceInfo> {}

export const SessionInstanceCreateInput = Schema.optional(
  Schema.Struct({
    parentID: Schema.optional(Session.ID),
    mode: Schema.optional(ProductMode.ID),
    presetCategoryId: Schema.optional(WorkPreset.Category),
    title: Schema.optional(Schema.String),
    agent: Schema.optional(Schema.String),
    model: Schema.optional(SessionInstanceModel),
    metadata: Schema.optional(SessionInstanceMetadata),
    permission: Schema.optional(PermissionV1.Ruleset),
    permissionTier: Schema.optional(PermissionTier.ID),
    attended: Schema.optional(Schema.Boolean),
    workspaceID: Schema.optional(Workspace.ID),
  }),
)

export const SessionInstanceForkInput = Schema.Struct({
  sessionID: Session.ID,
  messageID: Schema.optional(SessionV1.MessageID),
})

const SessionInstanceModelRef = Schema.Struct({
  providerID: Provider.ID,
  modelID: Model.ID,
})

export const SessionInstancePromptInput = Schema.Struct({
  sessionID: Session.ID,
  messageID: Schema.optional(SessionV1.MessageID),
  model: Schema.optional(SessionInstanceModelRef),
  agent: Schema.optional(Schema.String),
  noReply: Schema.optional(Schema.Boolean),
  tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)).annotate({
    description:
      "@deprecated tools and permissions have been merged, you can set permissions on the session itself now",
  }),
  format: Schema.optional(SessionV1.Format),
  system: Schema.optional(Schema.String),
  variant: Schema.optional(Schema.String),
  delegationOrigin: Schema.optional(SessionInput.DelegationOrigin),
  parts: Schema.Array(
    Schema.Union([
      SessionV1.TextPartInput,
      SessionV1.FilePartInput,
      SessionV1.AgentPartInput,
      SessionV1.SubtaskPartInput,
    ]).annotate({ discriminator: "type" }),
  ),
})

export const SessionInstanceShellInput = Schema.Struct({
  sessionID: Session.ID,
  messageID: Schema.optional(SessionV1.MessageID),
  agent: Schema.String,
  model: Schema.optional(SessionInstanceModelRef),
  command: Schema.String,
})

export const SessionInstanceCommandInput = Schema.Struct({
  messageID: Schema.optional(SessionV1.MessageID),
  sessionID: Session.ID,
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  arguments: Schema.String,
  command: Schema.String,
  variant: Schema.optional(Schema.String),
  parts: Schema.optional(
    Schema.Array(
      Schema.Union([
        Schema.Struct({
          id: Schema.optional(SessionV1.PartID),
          type: Schema.Literal("file"),
          mime: Schema.String,
          filename: Schema.optional(Schema.String),
          url: Schema.String,
          source: Schema.optional(SessionV1.FilePartSource),
        }),
      ]).annotate({ discriminator: "type" }),
    ),
  ),
})

export const SessionInstanceRevertInput = Schema.Struct({
  sessionID: Session.ID,
  messageID: SessionV1.MessageID,
  partID: Schema.optional(SessionV1.PartID),
})

export const SessionInstanceStatusInfo = Schema.Union([
  Schema.Struct({ type: Schema.Literal("idle") }),
  Schema.Struct({
    type: Schema.Literal("retry"),
    attempt: Schema.Finite,
    message: Schema.String,
    action: Schema.optional(
      Schema.Struct({
        reason: Schema.String,
        provider: Schema.String,
        title: Schema.String,
        message: Schema.String,
        label: Schema.String,
        link: Schema.optional(Schema.String),
      }),
    ),
    next: Schema.Finite,
  }),
  Schema.Struct({ type: Schema.Literal("busy") }),
]).annotate({ identifier: "SessionInstance.StatusInfo" })

export const SessionInstanceDiffInput = Schema.Struct({
  sessionID: Session.ID,
  messageID: Schema.optional(SessionV1.MessageID),
})

export const SessionInstanceTodoInfo = Schema.Struct({
  content: Schema.String.annotate({ description: "Brief description of the task" }),
  status: Schema.String.annotate({
    description: "Current status of the task: pending, in_progress, completed, cancelled",
  }),
  priority: Schema.String.annotate({ description: "Priority level of the task: high, medium, low" }),
}).annotate({ identifier: "SessionInstance.Todo" })

export class SessionInstanceToolSummaryEntry extends Schema.Class<SessionInstanceToolSummaryEntry>(
  "SessionInstance.ToolSummaryEntry",
)({
  tool: Schema.String,
  file: Schema.String.pipe(Schema.optional),
  count: Schema.Int,
  duration: Schema.Int.pipe(Schema.optional),
  status: Schema.String,
}) {}

export class SessionInstanceToolSummary extends Schema.Class<SessionInstanceToolSummary>("SessionInstance.ToolSummary")(
  {
    agent: Schema.String,
    engine: Schema.String,
    tools: Schema.Array(SessionInstanceToolSummaryEntry),
    totalDuration: Schema.Int,
    totalTokens: Schema.Int.pipe(Schema.optional),
  },
) {}

const SessionInstanceConfidenceLevel = Schema.Literals(["high", "estimated", "unavailable"])

export class SessionInstanceStepCacheStats extends Schema.Class<SessionInstanceStepCacheStats>(
  "SessionInstance.StepCacheStats",
)({
  assistantMessageID: Schema.String,
  hitRate: Schema.Number,
  cacheRead: Schema.Number,
  cacheWrite: Schema.Number,
}) {}

export class SessionInstanceCacheDiagnostics extends Schema.Class<SessionInstanceCacheDiagnostics>(
  "SessionInstance.CacheDiagnostics",
)({
  sessionHitRate: Schema.Number,
  sessionCacheRead: Schema.Number,
  sessionCacheWrite: Schema.Number,
  sessionTotalInput: Schema.Number,
  confidence: SessionInstanceConfidenceLevel,
  perStep: Schema.Array(SessionInstanceStepCacheStats),
  globalTotalCalls: Schema.optional(Schema.Number),
  globalHitRate: Schema.optional(Schema.Number),
  globalTotalTokens: Schema.optional(Schema.Number),
}) {}

const SessionInstanceMessageInfo = Schema.Union([SessionV1.User, SessionV1.Assistant]).annotate({
  discriminator: "role",
  identifier: "SessionInstance.Message",
})

export const SessionInstanceWithParts = Schema.Struct({
  info: SessionInstanceMessageInfo,
  parts: Schema.Array(SessionV1.Part),
}).annotate({ identifier: "SessionInstance.WithParts" })
export interface SessionInstanceWithParts extends Schema.Schema.Type<typeof SessionInstanceWithParts> {}

export class SessionInstanceTaskWriteInfo extends Schema.Class<SessionInstanceTaskWriteInfo>(
  "SessionInstanceTaskWriteInfo",
)({
  id: Schema.optional(Schema.String),
  content: Schema.String,
  status: SessionTask.TaskStatus,
  priority: SessionTask.TaskPriority,
  parentID: Schema.optional(Schema.String),
  agentID: Schema.optional(Schema.String),
  scheduledAt: Schema.optional(Schema.Number),
  recurrence: Schema.optional(SessionTask.TaskRecurrence),
  spawnedFrom: Schema.optional(Schema.String),
  dependsOn: Schema.optional(Schema.Array(Schema.String)),
}) {}

const root = "/session"
export const ListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  scope: Schema.optional(Schema.Literals(["project"])),
  mode: Schema.optional(ProductMode.ID),
  path: Schema.optional(Schema.String),
  roots: Schema.optional(QueryBoolean),
  start: Schema.optional(Schema.NumberFromString),
  search: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString),
})
export const DiffQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  ...Struct.omit(SessionInstanceDiffInput.fields, ["sessionID"]),
})
export const MessagesQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  limit: Schema.optional(Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
  before: Schema.optional(Schema.String),
})
export const StatusMap = Schema.Record(Schema.String, SessionInstanceStatusInfo)
export const UpdatePayload = Schema.Struct({
  title: Schema.optional(Schema.String),
  metadata: Schema.optional(SessionInstanceMetadata),
  permission: Schema.optional(PermissionV1.Ruleset),
  permissionTier: Schema.optional(PermissionTier.ID),
  time: Schema.optional(
    Schema.Struct({
      archived: Schema.optional(SessionInstanceArchivedTimestamp),
    }),
  ),
})
export const ForkPayload = Schema.Struct(Struct.omit(SessionInstanceForkInput.fields, ["sessionID"]))
export const InitPayload = Schema.Struct({
  modelID: Model.ID,
  providerID: Provider.ID,
  messageID: SessionV1.MessageID,
})
export const SummarizePayload = Schema.Struct({
  providerID: Provider.ID,
  modelID: Model.ID,
  auto: Schema.optional(Schema.Boolean),
})
export const PromptPayload = Schema.Struct(Struct.omit(SessionInstancePromptInput.fields, ["sessionID"]))
export const CommandPayload = Schema.Struct(Struct.omit(SessionInstanceCommandInput.fields, ["sessionID"]))
export const ShellPayload = Schema.Struct(Struct.omit(SessionInstanceShellInput.fields, ["sessionID"]))
export const RevertPayload = Schema.Struct(Struct.omit(SessionInstanceRevertInput.fields, ["sessionID"]))
export const PermissionResponsePayload = Schema.Struct({
  response: PermissionV1.Reply,
})
/** Idempotency key: bounded because it is persisted under a unique index. */
const WorkflowRequestID = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))
export const WorkflowRunPayload = Schema.Struct({
  requestID: WorkflowRequestID,
  expectedSnapshotDigest: Composition.Digest,
})
export const WorkflowCancelRunPayload = Schema.Struct({
  expectedRunRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
})
export const WorkflowCancelStepPayload = Schema.Struct({
  expectedRunRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  expectedStepRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
})
export const WorkflowRetryStepPayload = Schema.Struct({
  requestID: WorkflowRequestID,
  expectedRunRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  expectedStepRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
})

export const SessionPaths = {
  list: root,
  status: `${root}/status`,
  get: `${root}/:sessionID`,
  children: `${root}/:sessionID/children`,
  identity: `${root}/:sessionID/identity`,
  todo: `${root}/:sessionID/todo`,
  task: `${root}/:sessionID/task`,
  taskItem: `${root}/:sessionID/task/:taskID`,
  taskReorder: `${root}/:sessionID/task/reorder`,
  taskDispatch: `${root}/:sessionID/task/dispatch`,
  taskOperations: `${root}/:sessionID/task/operations`,
  taskOperation: `${root}/:sessionID/task/operations/:operationID`,
  taskOperationCancel: `${root}/:sessionID/task/operations/:operationID/cancel`,
  diff: `${root}/:sessionID/diff`,
  messages: `${root}/:sessionID/message`,
  message: `${root}/:sessionID/message/:messageID`,
  create: root,
  remove: `${root}/:sessionID`,
  update: `${root}/:sessionID`,
  fork: `${root}/:sessionID/fork`,
  abort: `${root}/:sessionID/abort`,
  share: `${root}/:sessionID/share`,
  init: `${root}/:sessionID/init`,
  summarize: `${root}/:sessionID/summarize`,
  prompt: `${root}/:sessionID/message`,
  promptAsync: `${root}/:sessionID/prompt_async`,
  command: `${root}/:sessionID/command`,
  shell: `${root}/:sessionID/shell`,
  revert: `${root}/:sessionID/revert`,
  unrevert: `${root}/:sessionID/unrevert`,
  permissions: `${root}/:sessionID/permissions/:permissionID`,
  permissionOverride: `${root}/:sessionID/permission-override`,
  deleteMessage: `${root}/:sessionID/message/:messageID`,
  deletePart: `${root}/:sessionID/message/:messageID/part/:partID`,
  updatePart: `${root}/:sessionID/message/:messageID/part/:partID`,
  cacheDiagnostics: `${root}/:sessionID/cache-diagnostics`,
  toolSummary: `${root}/:sessionID/tool-summary`,
  composition: `${root}/:sessionID/composition`,
  workflow: `${root}/:sessionID/workflow`,
  workflowRun: `${root}/:sessionID/workflow/run`,
  workflowCancelRun: `${root}/:sessionID/workflow/:runID/cancel`,
  workflowCancelStep: `${root}/:sessionID/workflow/:runID/step/:stepRunID/cancel`,
  workflowRetryStep: `${root}/:sessionID/workflow/:runID/step/:stepRunID/retry`,
} as const

export const SessionInstanceGroup = HttpApiGroup.make("session-instance")
  .add(
    HttpApiEndpoint.get("list", SessionPaths.list, {
      query: ListQuery,
      success: described(Schema.Array(SessionInstanceInfo), "List of sessions"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.list",
        summary: "List sessions",
        description: "Get a list of all Aigcfroge sessions, sorted by most recently updated.",
      }),
    ),
    HttpApiEndpoint.get("status", SessionPaths.status, {
      query: WorkspaceRoutingQuery,
      success: described(StatusMap, "Get session status"),
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.status",
        summary: "Get session status",
        description: "Retrieve the current status of all sessions, including active, idle, and completed states.",
      }),
    ),
    HttpApiEndpoint.get("get", SessionPaths.get, {
      params: { sessionID: Session.ID },
      query: WorkspaceRoutingQuery,
      success: described(SessionInstanceInfo, "Get session"),
      error: [InvalidRequestError, ApiNotFoundError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.get",
        summary: "Get session",
        description: "Retrieve detailed information about a specific Aigcfroge session.",
      }),
    ),
    HttpApiEndpoint.get("children", SessionPaths.children, {
      params: { sessionID: Session.ID },
      query: WorkspaceRoutingQuery,
      success: described(Schema.Array(SessionInstanceInfo), "List of children"),
      error: [InvalidRequestError, ApiNotFoundError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.children",
        summary: "Get session children",
        description: "Retrieve all child sessions that were forked from the specified parent session.",
      }),
    ),
    HttpApiEndpoint.get("identity", SessionPaths.identity, {
      params: { sessionID: Session.ID },
      query: WorkspaceRoutingQuery,
      success: described(SessionIdentity.Identity, "Session product identity projection"),
      error: [InvalidRequestError, ApiNotFoundError, ConflictError, ForbiddenError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.identity",
        summary: "Get session identity",
        description:
          "Read-only SessionProductIdentity projection (ADR-23): common identity, permission posture, and the mode detail the owners can supply today.",
      }),
    ),
    HttpApiEndpoint.get("todo", SessionPaths.todo, {
      params: { sessionID: Session.ID },
      query: WorkspaceRoutingQuery,
      success: described(Schema.Array(SessionInstanceTodoInfo), "Todo list"),
      error: [InvalidRequestError, ApiNotFoundError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.todo",
        summary: "Get session todos",
        description: "Retrieve the todo list associated with a specific session, showing tasks and action items.",
      }),
    ),
    HttpApiEndpoint.patch("task", SessionPaths.task, {
      params: { sessionID: Session.ID },
      query: WorkspaceRoutingQuery,
      payload: Schema.Array(SessionInstanceTaskWriteInfo),
      success: described(Schema.Array(SessionTask.Info), "Updated task list"),
      error: [InvalidRequestError, ApiNotFoundError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.task.update",
        summary: "Replace session tasks",
        description:
          "Reconcile a session's task list: entries without an id are minted a stable tsk_ id, entries with an existing id are updated in place, and omitted entries are removed.",
      }),
    ),
    HttpApiEndpoint.get("getTask", SessionPaths.task, {
      params: { sessionID: Session.ID },
      query: WorkspaceRoutingQuery,
      success: described(Schema.Array(SessionTask.Info), "Task list"),
      error: [InvalidRequestError, ApiNotFoundError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.task.get",
        summary: "Get session tasks",
        description:
          "Retrieve a session's task list with stable ids and persisted output digests (reload-recovery source for the TaskPanel).",
      }),
    ),
    // Single-task atomic mutations: the UI must
    // never PATCH a stale full-list snapshot — the reconcile above deletes
    // rows the client hasn't seen yet (a concurrent append between SSE
    // delivery and the write would be silently dropped). These three ops
    // touch only the named row, so a stale cache can never delete what it
    // doesn't know about.
    HttpApiEndpoint.patch("patchTask", SessionPaths.taskItem, {
      params: { sessionID: Session.ID, taskID: Schema.String },
      query: WorkspaceRoutingQuery,
      // P3-d: single-task update accepts status and/or content/priority plus
      // expectedRevision. At least one field is required (handler-enforced);
      // expectedRevision rejects stale writes (optimistic concurrency).
      payload: Schema.Struct({
        status: Schema.optional(SessionTask.TaskStatus),
        content: Schema.optional(Schema.String),
        priority: Schema.optional(SessionTask.TaskPriority),
        expectedRevision: Schema.optional(Schema.Number),
        // outputDigest deliberately absent: it is written by the TaskDriver /
        // ScheduledJob settle paths (internal), and exposing it publicly would
        // let a client overwrite the execution digest / child-session linkage.
      }),
      success: described(SessionTask.Info, "Patched task"),
      error: [InvalidRequestError, ApiNotFoundError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.task.patch",
        summary: "Update one task",
        description:
          "Update a single task's status, content, and/or priority by id. Pass expectedRevision to reject stale writes. Unlike the full-list reconcile, no other row is touched and no absent row is deleted.",
      }),
    ),
    HttpApiEndpoint.post("createTask", SessionPaths.task, {
      params: { sessionID: Session.ID },
      query: WorkspaceRoutingQuery,
      payload: SessionInstanceTaskWriteInfo,
      success: described(SessionTask.Info, "Created task"),
      error: [InvalidRequestError, ApiNotFoundError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.task.create",
        summary: "Create one task",
        description: "Append a single task to the session without reconciling (and thus deleting) the existing list.",
      }),
    ),
    HttpApiEndpoint.delete("deleteTask", SessionPaths.taskItem, {
      params: { sessionID: Session.ID, taskID: Schema.String },
      query: WorkspaceRoutingQuery,
      success: described(SessionTask.Info, "Deleted task"),
      error: [InvalidRequestError, ApiNotFoundError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.task.delete",
        summary: "Delete one task",
        description: "Delete a single task by id. Other rows are untouched.",
      }),
    ),
    HttpApiEndpoint.post("reorderTask", SessionPaths.taskReorder, {
      params: { sessionID: Session.ID },
      query: WorkspaceRoutingQuery,
      payload: Schema.Struct({
        ids: Schema.Array(Schema.String),
        expectedRevision: Schema.optional(Schema.Number),
      }),
      success: described(Schema.Array(SessionTask.Info), "Reordered task list"),
      error: [InvalidRequestError, ApiNotFoundError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.task.reorder",
        summary: "Reorder tasks",
        description:
          "Reorder a session's task list by id. The ids must be a permutation of the current task ids (every task, no omissions, no duplicates). expectedRevision is the max revision the caller observed; if any task changed, the reorder is rejected as stale.",
      }),
    ),
    HttpApiEndpoint.post("dispatchTask", SessionPaths.taskDispatch, {
      params: { sessionID: Session.ID },
      query: WorkspaceRoutingQuery,
      payload: SessionTask.OperationRequest,
      success: described(SessionTask.OperationInfo, "Durable task operation"),
      error: [InvalidRequestError, ApiNotFoundError, ConflictError, ForbiddenError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.task.dispatch",
        summary: "Dispatch a task operation",
        description:
          "Dispatch work from the selected Meta root into a new or existing independent root. Set replacesOperationID to explicitly replace an unfinished operation from this source Session while retaining its history. The server captures user provenance, selection, permission, and durable input identity; an exact retry returns the existing operation.",
      }),
    ),
    HttpApiEndpoint.get("taskOperations", SessionPaths.taskOperations, {
      params: { sessionID: Session.ID },
      query: Schema.Struct({ ...WorkspaceRoutingQueryFields, taskID: optional(Schema.String) }),
      success: described(Schema.Array(SessionTask.OperationInfo), "Retained task operations"),
      error: [InvalidRequestError, ApiNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.task.operations",
        summary: "List task operations",
        description: "Read retained operations owned by this session, optionally filtered by the source task.",
      }),
    ),
    HttpApiEndpoint.get("taskOperation", SessionPaths.taskOperation, {
      params: { sessionID: Session.ID, operationID: SessionTask.OperationID },
      query: WorkspaceRoutingQuery,
      success: described(SessionTask.OperationInfo, "Retained task operation"),
      error: [InvalidRequestError, ApiNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.task.operation",
        summary: "Read a task operation",
        description: "Read the durable operation and its saved input, target, settlement, and cancellation references.",
      }),
    ),
    HttpApiEndpoint.post("cancelTaskOperation", SessionPaths.taskOperationCancel, {
      params: { sessionID: Session.ID, operationID: SessionTask.OperationID },
      query: WorkspaceRoutingQuery,
      success: described(SessionTask.OperationInfo, "Task operation after cancellation"),
      error: [InvalidRequestError, ApiNotFoundError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.task.cancelOperation",
        summary: "Cancel a task operation",
        description:
          "Record cancellation through the source session's existing ownership checks, including after its selected agent changes.",
      }),
    ),
    HttpApiEndpoint.get("diff", SessionPaths.diff, {
      params: { sessionID: Session.ID },
      query: DiffQuery,
      success: described(Schema.Array(FileDiff.Info), "Successfully retrieved diff"),
      error: [InvalidRequestError, ApiNotFoundError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.diff",
        summary: "Get message diff",
        description: "Get the file changes (diff) that resulted from a specific user message in the session.",
      }),
    ),
    HttpApiEndpoint.get("messages", SessionPaths.messages, {
      params: { sessionID: Session.ID },
      query: MessagesQuery,
      success: described(Schema.Array(SessionInstanceWithParts), "List of messages"),
      error: [InvalidRequestError, ApiNotFoundError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.messages",
        summary: "Get session messages",
        description: "Retrieve all messages in a session, including user prompts and AI responses.",
      }),
    ),
    HttpApiEndpoint.get("message", SessionPaths.message, {
      params: { sessionID: Session.ID, messageID: SessionV1.MessageID },
      query: WorkspaceRoutingQuery,
      success: described(SessionInstanceWithParts, "Message"),
      error: [InvalidRequestError, ApiNotFoundError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.message",
        summary: "Get message",
        description: "Retrieve a specific message from a session by its message ID.",
      }),
    ),
    HttpApiEndpoint.post("create", SessionPaths.create, {
      query: WorkspaceRoutingQuery,
      // 4.0.1 codegen note: multi-payload unions are unsupported; the optional
      // struct already admits an absent body, matching the fork wire.
      payload: SessionInstanceCreateInput,
      success: described(SessionInstanceInfo, "Successfully created session"),
      error: [InvalidRequestError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.create",
        summary: "Create session",
        description: "Create a new Aigcfroge session for interacting with AI assistants and managing conversations.",
      }),
    ),
    HttpApiEndpoint.delete("remove", SessionPaths.remove, {
      params: { sessionID: Session.ID },
      query: WorkspaceRoutingQuery,
      success: described(Schema.Boolean, "Successfully deleted session"),
      error: [InvalidRequestError, ApiNotFoundError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.delete",
        summary: "Delete session",
        description: "Delete a session and permanently remove all associated data, including messages and history.",
      }),
    ),
    HttpApiEndpoint.patch("update", SessionPaths.update, {
      params: { sessionID: Session.ID },
      query: WorkspaceRoutingQuery,
      payload: UpdatePayload,
      success: described(SessionInstanceInfo, "Successfully updated session"),
      error: [InvalidRequestError, ApiNotFoundError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.update",
        summary: "Update session",
        description: "Update properties of an existing session, such as title or other metadata.",
      }),
    ),
    HttpApiEndpoint.post("fork", SessionPaths.fork, {
      params: { sessionID: Session.ID },
      query: WorkspaceRoutingQuery,
      payload: ForkPayload,
      success: described(SessionInstanceInfo, "200"),
      error: [InvalidRequestError, ApiNotFoundError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.fork",
        summary: "Fork session",
        description: "Create a new session by forking an existing session at a specific message point.",
      }),
    ),
    HttpApiEndpoint.post("abort", SessionPaths.abort, {
      params: { sessionID: Session.ID },
      query: WorkspaceRoutingQuery,
      success: described(Schema.Boolean, "Aborted session"),
      error: [InvalidRequestError, ApiNotFoundError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.abort",
        summary: "Abort session",
        description: "Abort an active session and stop any ongoing AI processing or command execution.",
      }),
    ),
    HttpApiEndpoint.post("init", SessionPaths.init, {
      params: { sessionID: Session.ID },
      query: WorkspaceRoutingQuery,
      payload: InitPayload,
      success: described(Schema.Boolean, "200"),
      error: [InvalidRequestError, ApiNotFoundError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.init",
        summary: "Initialize session",
        description:
          "Analyze the current application and create an AGENTS.md file with project-specific agent configurations.",
      }),
    ),
    HttpApiEndpoint.post("share", SessionPaths.share, {
      params: { sessionID: Session.ID },
      query: WorkspaceRoutingQuery,
      success: described(SessionInstanceInfo, "Successfully shared session"),
      error: [UnknownError, ApiNotFoundError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.share",
        summary: "Share session",
        description: "Create a shareable link for a session, allowing others to view the conversation.",
      }),
    ),
    HttpApiEndpoint.delete("unshare", SessionPaths.share, {
      params: { sessionID: Session.ID },
      query: WorkspaceRoutingQuery,
      success: described(SessionInstanceInfo, "Successfully unshared session"),
      error: [UnknownError, ApiNotFoundError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.unshare",
        summary: "Unshare session",
        description: "Remove the shareable link for a session, making it private again.",
      }),
    ),
    HttpApiEndpoint.post("summarize", SessionPaths.summarize, {
      params: { sessionID: Session.ID },
      query: WorkspaceRoutingQuery,
      payload: SummarizePayload,
      success: described(Schema.Boolean, "Summarized session"),
      error: [InvalidRequestError, ApiNotFoundError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.summarize",
        summary: "Summarize session",
        description: "Generate a concise summary of the session using AI compaction to preserve key information.",
      }),
    ),
    HttpApiEndpoint.post("prompt", SessionPaths.prompt, {
      params: { sessionID: Session.ID },
      query: WorkspaceRoutingQuery,
      payload: PromptPayload,
      success: described(SessionInstanceWithParts, "Created message"),
      error: [InvalidRequestError, ApiNotFoundError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.prompt",
        summary: "Send message",
        description: "Create and send a new message to a session, streaming the AI response.",
      }),
    ),
    HttpApiEndpoint.post("promptAsync", SessionPaths.promptAsync, {
      params: { sessionID: Session.ID },
      query: WorkspaceRoutingQuery,
      payload: PromptPayload,
      success: described(HttpApiSchema.NoContent, "Prompt accepted"),
      error: [InvalidRequestError, ApiNotFoundError, UnsupportedProductModeError, UnknownError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.prompt_async",
        summary: "Send async message",
        description:
          "Create and send a new message to a session asynchronously, starting the session if needed and returning immediately.",
      }),
    ),
    HttpApiEndpoint.post("command", SessionPaths.command, {
      params: { sessionID: Session.ID },
      query: WorkspaceRoutingQuery,
      payload: CommandPayload,
      success: described(SessionInstanceWithParts, "Created message"),
      error: [InvalidRequestError, ApiNotFoundError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.command",
        summary: "Send command",
        description: "Send a new command to a session for execution by the AI assistant.",
      }),
    ),
    HttpApiEndpoint.post("shell", SessionPaths.shell, {
      params: { sessionID: Session.ID },
      query: WorkspaceRoutingQuery,
      payload: ShellPayload,
      success: described(SessionInstanceWithParts, "Created message"),
      error: [InvalidRequestError, ApiNotFoundError, SessionBusyError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.shell",
        summary: "Run shell command",
        description: "Execute a shell command within the session context and return the AI's response.",
      }),
    ),
    HttpApiEndpoint.post("revert", SessionPaths.revert, {
      params: { sessionID: Session.ID },
      query: WorkspaceRoutingQuery,
      payload: RevertPayload,
      success: described(SessionInstanceInfo, "Updated session"),
      error: [InvalidRequestError, ApiNotFoundError, SessionBusyError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.revert",
        summary: "Revert message",
        description: "Revert a specific message in a session, undoing its effects and restoring the previous state.",
      }),
    ),
    HttpApiEndpoint.post("unrevert", SessionPaths.unrevert, {
      params: { sessionID: Session.ID },
      query: WorkspaceRoutingQuery,
      success: described(SessionInstanceInfo, "Updated session"),
      error: [InvalidRequestError, ApiNotFoundError, SessionBusyError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.unrevert",
        summary: "Restore reverted messages",
        description: "Restore all previously reverted messages in a session.",
      }),
    ),
    HttpApiEndpoint.post("permissionRespond", SessionPaths.permissions, {
      params: { sessionID: Session.ID, permissionID: PermissionV1.ID },
      query: WorkspaceRoutingQuery,
      payload: PermissionResponsePayload,
      success: described(Schema.Boolean, "Permission processed successfully"),
      error: [InvalidRequestError, ApiNotFoundError, PermissionNotFoundError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.permission.respond",
        summary: "Respond to permission",
        description: "Approve or deny a permission request from the AI assistant.",
        deprecated: true,
      }),
    ),
    HttpApiEndpoint.get("getPermissionOverride", SessionPaths.permissionOverride, {
      params: { sessionID: Session.ID },
      query: WorkspaceRoutingQuery,
      success: described(Schema.Struct({ enabled: Schema.Boolean }), "Override status"),
      error: [InvalidRequestError, ApiNotFoundError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.permission.override.get",
        summary: "Get session permission override status",
        description: "Returns whether the temporary break-glass permission override is active for the current session.",
      }),
    ),
    HttpApiEndpoint.put("putPermissionOverride", SessionPaths.permissionOverride, {
      params: { sessionID: Session.ID },
      query: WorkspaceRoutingQuery,
      payload: Schema.Struct({ acknowledged: Schema.optional(Schema.Boolean) }),
      success: described(Schema.Struct({ enabled: Schema.Boolean }), "Override status"),
      error: [InvalidRequestError, ApiNotFoundError, InvalidRequestError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.permission.override.put",
        summary: "Enable or renew the session permission override",
        description:
          "Enables (first enable requires acknowledged:true) or renews the 60s temporary break-glass lease. Child and unattended sessions are rejected.",
      }),
    ),
    HttpApiEndpoint.delete("deletePermissionOverride", SessionPaths.permissionOverride, {
      params: { sessionID: Session.ID },
      query: WorkspaceRoutingQuery,
      success: described(Schema.Struct({ enabled: Schema.Boolean }), "Override status"),
      error: [InvalidRequestError, ApiNotFoundError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.permission.override.delete",
        summary: "Disable the session permission override",
        description: "Disables the temporary break-glass permission override for the current session.",
      }),
    ),
    HttpApiEndpoint.delete("deleteMessage", SessionPaths.deleteMessage, {
      params: { sessionID: Session.ID, messageID: SessionV1.MessageID },
      query: WorkspaceRoutingQuery,
      success: described(Schema.Boolean, "Successfully deleted message"),
      error: [InvalidRequestError, ApiNotFoundError, SessionBusyError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.deleteMessage",
        summary: "Delete message",
        description:
          "Permanently delete a specific message and all of its parts from a session without reverting file changes.",
      }),
    ),
    HttpApiEndpoint.delete("deletePart", SessionPaths.deletePart, {
      params: { sessionID: Session.ID, messageID: SessionV1.MessageID, partID: SessionV1.PartID },
      query: WorkspaceRoutingQuery,
      success: described(Schema.Boolean, "Successfully deleted part"),
      error: [InvalidRequestError, ApiNotFoundError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.part.delete",
        description: "Delete a part from a message.",
      }),
    ),
    HttpApiEndpoint.patch("updatePart", SessionPaths.updatePart, {
      params: { sessionID: Session.ID, messageID: SessionV1.MessageID, partID: SessionV1.PartID },
      query: WorkspaceRoutingQuery,
      payload: SessionV1.Part,
      success: described(SessionV1.Part, "Successfully updated part"),
      error: [InvalidRequestError, ApiNotFoundError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.part.update",
        description: "Update a part in a message.",
      }),
    ),
    HttpApiEndpoint.get("cacheDiagnostics", SessionPaths.cacheDiagnostics, {
      params: { sessionID: Session.ID },
      query: WorkspaceRoutingQuery,
      success: described(SessionInstanceCacheDiagnostics, "Cache diagnostics"),
      error: [InvalidRequestError, ApiNotFoundError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.cacheDiagnostics",
        summary: "Get cache diagnostics",
        description: "Retrieve cache hit rate and per-step cache statistics for a session.",
      }),
    ),
    HttpApiEndpoint.get("meta", `${root}/:sessionID/meta`, {
      params: { sessionID: Session.ID },
      query: WorkspaceRoutingQuery,
      success: described(MetaAgent.Read, "Current Meta owner and recorded statistics"),
      error: [InvalidRequestError, ApiNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({ identifier: "session.instance.session.meta", summary: "Read current Meta owner" }),
    ),
    HttpApiEndpoint.get("projectMemory", `${root}/:sessionID/project-memory`, {
      params: { sessionID: Session.ID },
      query: Schema.Struct({
        ...WorkspaceRoutingQueryFields,
        category: optional(MetaAgent.FactCategory),
        keyword: optional(Schema.String),
      }),
      success: described(Schema.Array(MetaAgent.MemoryRecord), "Project facts at this Session's project"),
      error: [InvalidRequestError, ApiNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({ identifier: "session.instance.session.projectMemory.get", summary: "Read project facts" }),
    ),
    HttpApiEndpoint.delete("removeProjectMemory", `${root}/:sessionID/project-memory/:id`, {
      params: { sessionID: Session.ID, id: Schema.String },
      query: WorkspaceRoutingQuery,
      success: described(Schema.Void, "Project fact removed"),
      error: [InvalidRequestError, ApiNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.projectMemory.remove",
        summary: "Remove a project fact",
      }),
    ),
    HttpApiEndpoint.get("toolSummary", SessionPaths.toolSummary, {
      params: { sessionID: Session.ID },
      query: WorkspaceRoutingQuery,
      success: described(Schema.Array(SessionInstanceToolSummary), "Tool summary"),
      error: [InvalidRequestError, ApiNotFoundError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.toolSummary",
        summary: "Get tool summary",
        description: "Retrieve aggregated tool call summary for a sub-agent session.",
      }),
    ),
    HttpApiEndpoint.get("composition", SessionPaths.composition, {
      params: { sessionID: Session.ID },
      query: WorkspaceRoutingQuery,
      success: described(Composition.Snapshot, "Session composition snapshot"),
      error: [InvalidRequestError, ApiNotFoundError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.composition",
        summary: "Get session composition snapshot",
        description: "Retrieve the immutable composition snapshot for a custom session.",
      }),
    ),
    HttpApiEndpoint.get("workflow", SessionPaths.workflow, {
      params: { sessionID: Session.ID },
      query: Schema.Struct({
        ...WorkspaceRoutingQueryFields,
        runID: Schema.optional(WorkflowAsset.WorkflowRunID),
      }),
      success: described(WorkflowAsset.WorkflowStatusResponse, "Session workflow status"),
      error: [InvalidRequestError, ApiNotFoundError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.workflow.get",
        summary: "Get session workflow status",
        description: "Retrieve the requested workflow run and its steps, or the latest run when runID is omitted.",
      }),
    ),
    HttpApiEndpoint.post("workflowRun", SessionPaths.workflowRun, {
      params: { sessionID: Session.ID },
      query: WorkspaceRoutingQuery,
      payload: WorkflowRunPayload,
      success: described(
        WorkflowAsset.WorkflowStatusResponse.pipe(HttpApiSchema.status("Accepted")),
        "Accepted workflow status",
      ),
      error: [InvalidRequestError, ApiNotFoundError, ConflictError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.workflow.run",
        summary: "Admit session workflow",
        description: "Atomically admit a custom workflow run and wake its process-local asynchronous owner.",
      }),
    ),
    HttpApiEndpoint.post("workflowCancelRun", SessionPaths.workflowCancelRun, {
      params: { sessionID: Session.ID, runID: WorkflowAsset.WorkflowRunID },
      query: WorkspaceRoutingQuery,
      payload: WorkflowCancelRunPayload,
      success: described(WorkflowAsset.WorkflowStatusResponse, "Cancelled workflow status"),
      error: [InvalidRequestError, ApiNotFoundError, ConflictError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.workflow.cancelRun",
        summary: "Cancel session workflow run",
        description:
          "Persist the cancelling intent under run-revision CAS, interrupt the process-local owner and return the settled terminal state.",
      }),
    ),
    HttpApiEndpoint.post("workflowCancelStep", SessionPaths.workflowCancelStep, {
      params: {
        sessionID: Session.ID,
        runID: WorkflowAsset.WorkflowRunID,
        stepRunID: WorkflowAsset.StepRunID,
      },
      query: WorkspaceRoutingQuery,
      payload: WorkflowCancelStepPayload,
      success: described(WorkflowAsset.WorkflowStatusResponse, "Step cancellation workflow status"),
      error: [InvalidRequestError, ApiNotFoundError, ConflictError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.workflow.cancelStep",
        summary: "Cancel session workflow step",
        description:
          "Explicitly cancel a single step run under run and step revision CAS without triggering automatic retry.",
      }),
    ),
    HttpApiEndpoint.post("workflowRetryStep", SessionPaths.workflowRetryStep, {
      params: {
        sessionID: Session.ID,
        runID: WorkflowAsset.WorkflowRunID,
        stepRunID: WorkflowAsset.StepRunID,
      },
      query: WorkspaceRoutingQuery,
      payload: WorkflowRetryStepPayload,
      success: described(
        WorkflowAsset.WorkflowStatusResponse.pipe(HttpApiSchema.status("Accepted")),
        "Accepted retry workflow status",
      ),
      error: [InvalidRequestError, ApiNotFoundError, ConflictError, UnsupportedProductModeError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.instance.session.workflow.retryStep",
        summary: "Retry session workflow step",
        description:
          "Create a new lineage run that replays the target step and its downstream closure, leaving the terminal run immutable.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "session",
      description: "Experimental HttpApi session routes.",
    }),
  )
  .middleware(InstanceContext)
  .middleware(WorkspaceRouting)
  .middleware(Authorization)
