import { PermissionV1 } from "@aigcfroge/core/v1/permission"
import { SessionV1 } from "@aigcfroge/core/v1/session"
import { ToolSummary } from "@aigcfroge/core/session/tool-summary"

import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionRevert } from "@/session/revert"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { Todo } from "@/session/todo"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { Snapshot } from "@/snapshot"
import { CacheDiagnostics } from "@aigcfroge/core/session/cache-diagnostics"
import { Schema, Struct } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
  WorkspaceRoutingQueryFields,
} from "../middleware/workspace-routing"
import {
  ApiNotFoundError,
  ConflictError,
  PermissionNotFoundError,
  SessionBusyError,
  InvalidRequestError,
  UnsupportedProductModeError,
} from "../errors"
import { described } from "./metadata"
import { QueryBoolean } from "./query"
import { ProviderV2 } from "@aigcfroge/core/provider"
import { ModelV2 } from "@aigcfroge/core/model"
import { SessionTask } from "@aigcfroge/core/session/task"
import { SessionTask as SessionTaskSchema } from "@aigcfroge/schema/session-task" // Schema namespace; the core SessionTask import above uses the unaliased name.
import { ProductMode } from "@aigcfroge/schema/product-mode"
import { PermissionTier } from "@aigcfroge/schema/permission-tier"
import { Composition } from "@aigcfroge/schema/composition"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"

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
  ...Struct.omit(SessionSummary.DiffInput.fields, ["sessionID"]),
})
export const MessagesQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  limit: Schema.optional(Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
  before: Schema.optional(Schema.String),
})
export const StatusMap = Schema.Record(Schema.String, SessionStatus.Info)
export const UpdatePayload = Schema.Struct({
  title: Schema.optional(Schema.String),
  metadata: Schema.optional(Session.Metadata),
  permission: Schema.optional(PermissionV1.Ruleset),
  permissionTier: Schema.optional(PermissionTier.ID),
  time: Schema.optional(
    Schema.Struct({
      archived: Schema.optional(Session.ArchivedTimestamp),
    }),
  ),
})
export const ForkPayload = Schema.Struct(Struct.omit(Session.ForkInput.fields, ["sessionID"]))
export const InitPayload = Schema.Struct({
  modelID: ModelV2.ID,
  providerID: ProviderV2.ID,
  messageID: MessageID,
})
export const SummarizePayload = Schema.Struct({
  providerID: ProviderV2.ID,
  modelID: ModelV2.ID,
  auto: Schema.optional(Schema.Boolean),
})
export const PromptPayload = Schema.Struct(Struct.omit(SessionPrompt.PromptInput.fields, ["sessionID"]))
export const CommandPayload = Schema.Struct(Struct.omit(SessionPrompt.CommandInput.fields, ["sessionID"]))
export const ShellPayload = Schema.Struct(Struct.omit(SessionPrompt.ShellInput.fields, ["sessionID"]))
export const RevertPayload = Schema.Struct(Struct.omit(SessionRevert.RevertInput.fields, ["sessionID"]))
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
  todo: `${root}/:sessionID/todo`,
  task: `${root}/:sessionID/task`,
  taskItem: `${root}/:sessionID/task/:taskID`,
  taskReorder: `${root}/:sessionID/task/reorder`,
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

export const SessionApi = HttpApi.make("session")
  .add(
    HttpApiGroup.make("session")
      .add(
        HttpApiEndpoint.get("list", SessionPaths.list, {
          query: ListQuery,
          success: described(Schema.Array(Session.Info), "List of sessions"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.list",
            summary: "List sessions",
            description: "Get a list of all Aigcfroge sessions, sorted by most recently updated.",
          }),
        ),
        HttpApiEndpoint.get("status", SessionPaths.status, {
          query: WorkspaceRoutingQuery,
          success: described(StatusMap, "Get session status"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.status",
            summary: "Get session status",
            description: "Retrieve the current status of all sessions, including active, idle, and completed states.",
          }),
        ),
        HttpApiEndpoint.get("get", SessionPaths.get, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Session.Info, "Get session"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.get",
            summary: "Get session",
            description: "Retrieve detailed information about a specific Aigcfroge session.",
          }),
        ),
        HttpApiEndpoint.get("children", SessionPaths.children, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(Session.Info), "List of children"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.children",
            summary: "Get session children",
            description: "Retrieve all child sessions that were forked from the specified parent session.",
          }),
        ),
        HttpApiEndpoint.get("todo", SessionPaths.todo, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(Todo.Info), "Todo list"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.todo",
            summary: "Get session todos",
            description: "Retrieve the todo list associated with a specific session, showing tasks and action items.",
          }),
        ),
        HttpApiEndpoint.patch("task", SessionPaths.task, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: Schema.Array(SessionTask.WriteInfo),
          success: described(Schema.Array(SessionTask.Info), "Updated task list"),
          error: [InvalidRequestError, ApiNotFoundError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.task.update",
            summary: "Replace session tasks",
            description:
              "Reconcile a session's task list: entries without an id are minted a stable tsk_ id, entries with an existing id are updated in place, and omitted entries are removed.",
          }),
        ),
        HttpApiEndpoint.get("getTask", SessionPaths.task, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(SessionTask.Info), "Task list"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.task.get",
            summary: "Get session tasks",
            description:
              "Retrieve a session's task list with stable ids and persisted output digests (reload-recovery source for the TaskPanel).",
          }),
        ),
        // Single-task atomic mutations (differential-review HIGH-2): the UI must
        // never PATCH a stale full-list snapshot — the reconcile above deletes
        // rows the client hasn't seen yet (a concurrent append between SSE
        // delivery and the write would be silently dropped). These three ops
        // touch only the named row, so a stale cache can never delete what it
        // doesn't know about.
        HttpApiEndpoint.patch("patchTask", SessionPaths.taskItem, {
          params: { sessionID: SessionID, taskID: Schema.String },
          query: WorkspaceRoutingQuery,
          // P3-d: single-task update accepts status and/or content/priority plus
          // expectedRevision. At least one field is required (handler-enforced);
          // expectedRevision rejects stale writes (optimistic concurrency).
          payload: Schema.Struct({
            status: Schema.optional(SessionTaskSchema.TaskStatus),
            content: Schema.optional(Schema.String),
            priority: Schema.optional(SessionTaskSchema.TaskPriority),
            expectedRevision: Schema.optional(Schema.Number),
            // outputDigest deliberately absent: it is written by the TaskDriver /
            // ScheduledJob settle paths (internal), and exposing it publicly would
            // let a client overwrite the execution digest / child-session linkage.
          }),
          success: described(SessionTask.Info, "Patched task"),
          error: [InvalidRequestError, ApiNotFoundError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.task.patch",
            summary: "Update one task",
            description:
              "Update a single task's status, content, and/or priority by id. Pass expectedRevision to reject stale writes. Unlike the full-list reconcile, no other row is touched and no absent row is deleted.",
          }),
        ),
        HttpApiEndpoint.post("createTask", SessionPaths.task, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: SessionTask.WriteInfo,
          success: described(SessionTask.Info, "Created task"),
          error: [InvalidRequestError, ApiNotFoundError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.task.create",
            summary: "Create one task",
            description:
              "Append a single task to the session without reconciling (and thus deleting) the existing list.",
          }),
        ),
        HttpApiEndpoint.delete("deleteTask", SessionPaths.taskItem, {
          params: { sessionID: SessionID, taskID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(SessionTask.Info, "Deleted task"),
          error: [InvalidRequestError, ApiNotFoundError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.task.delete",
            summary: "Delete one task",
            description: "Delete a single task by id. Other rows are untouched.",
          }),
        ),
        HttpApiEndpoint.post("reorderTask", SessionPaths.taskReorder, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: Schema.Struct({
            ids: Schema.Array(Schema.String),
            expectedRevision: Schema.optional(Schema.Number),
          }),
          success: described(Schema.Array(SessionTask.Info), "Reordered task list"),
          error: [InvalidRequestError, ApiNotFoundError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.task.reorder",
            summary: "Reorder tasks",
            description:
              "Reorder a session's task list by id. The ids must be a permutation of the current task ids (every task, no omissions, no duplicates). expectedRevision is the max revision the caller observed; if any task changed, the reorder is rejected as stale.",
          }),
        ),
        HttpApiEndpoint.get("diff", SessionPaths.diff, {
          params: { sessionID: SessionID },
          query: DiffQuery,
          success: described(Schema.Array(Snapshot.FileDiff), "Successfully retrieved diff"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.diff",
            summary: "Get message diff",
            description: "Get the file changes (diff) that resulted from a specific user message in the session.",
          }),
        ),
        HttpApiEndpoint.get("messages", SessionPaths.messages, {
          params: { sessionID: SessionID },
          query: MessagesQuery,
          success: described(Schema.Array(SessionV1.WithParts), "List of messages"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.messages",
            summary: "Get session messages",
            description: "Retrieve all messages in a session, including user prompts and AI responses.",
          }),
        ),
        HttpApiEndpoint.get("message", SessionPaths.message, {
          params: { sessionID: SessionID, messageID: MessageID },
          query: WorkspaceRoutingQuery,
          success: described(SessionV1.WithParts, "Message"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.message",
            summary: "Get message",
            description: "Retrieve a specific message from a session by its message ID.",
          }),
        ),
        HttpApiEndpoint.post("create", SessionPaths.create, {
          query: WorkspaceRoutingQuery,
          payload: [HttpApiSchema.NoContent, Session.CreateInput],
          success: described(Session.Info, "Successfully created session"),
          error: [HttpApiError.BadRequest, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.create",
            summary: "Create session",
            description:
              "Create a new Aigcfroge session for interacting with AI assistants and managing conversations.",
          }),
        ),
        HttpApiEndpoint.delete("remove", SessionPaths.remove, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Successfully deleted session"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.delete",
            summary: "Delete session",
            description: "Delete a session and permanently remove all associated data, including messages and history.",
          }),
        ),
        HttpApiEndpoint.patch("update", SessionPaths.update, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: UpdatePayload,
          success: described(Session.Info, "Successfully updated session"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.update",
            summary: "Update session",
            description: "Update properties of an existing session, such as title or other metadata.",
          }),
        ),
        HttpApiEndpoint.post("fork", SessionPaths.fork, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: [HttpApiSchema.NoContent, ForkPayload],
          success: described(Session.Info, "200"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.fork",
            summary: "Fork session",
            description: "Create a new session by forking an existing session at a specific message point.",
          }),
        ),
        HttpApiEndpoint.post("abort", SessionPaths.abort, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Aborted session"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.abort",
            summary: "Abort session",
            description: "Abort an active session and stop any ongoing AI processing or command execution.",
          }),
        ),
        HttpApiEndpoint.post("init", SessionPaths.init, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: InitPayload,
          success: described(Schema.Boolean, "200"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.init",
            summary: "Initialize session",
            description:
              "Analyze the current application and create an AGENTS.md file with project-specific agent configurations.",
          }),
        ),
        HttpApiEndpoint.post("share", SessionPaths.share, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Session.Info, "Successfully shared session"),
          error: [HttpApiError.InternalServerError, ApiNotFoundError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.share",
            summary: "Share session",
            description: "Create a shareable link for a session, allowing others to view the conversation.",
          }),
        ),
        HttpApiEndpoint.delete("unshare", SessionPaths.share, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Session.Info, "Successfully unshared session"),
          error: [HttpApiError.InternalServerError, ApiNotFoundError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.unshare",
            summary: "Unshare session",
            description: "Remove the shareable link for a session, making it private again.",
          }),
        ),
        HttpApiEndpoint.post("summarize", SessionPaths.summarize, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: SummarizePayload,
          success: described(Schema.Boolean, "Summarized session"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.summarize",
            summary: "Summarize session",
            description: "Generate a concise summary of the session using AI compaction to preserve key information.",
          }),
        ),
        HttpApiEndpoint.post("prompt", SessionPaths.prompt, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: PromptPayload,
          success: described(SessionV1.WithParts, "Created message"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.prompt",
            summary: "Send message",
            description: "Create and send a new message to a session, streaming the AI response.",
          }),
        ),
        HttpApiEndpoint.post("promptAsync", SessionPaths.promptAsync, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: PromptPayload,
          success: described(HttpApiSchema.NoContent, "Prompt accepted"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.prompt_async",
            summary: "Send async message",
            description:
              "Create and send a new message to a session asynchronously, starting the session if needed and returning immediately.",
          }),
        ),
        HttpApiEndpoint.post("command", SessionPaths.command, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: CommandPayload,
          success: described(SessionV1.WithParts, "Created message"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.command",
            summary: "Send command",
            description: "Send a new command to a session for execution by the AI assistant.",
          }),
        ),
        HttpApiEndpoint.post("shell", SessionPaths.shell, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: ShellPayload,
          success: described(SessionV1.WithParts, "Created message"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, SessionBusyError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.shell",
            summary: "Run shell command",
            description: "Execute a shell command within the session context and return the AI's response.",
          }),
        ),
        HttpApiEndpoint.post("revert", SessionPaths.revert, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: RevertPayload,
          success: described(Session.Info, "Updated session"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, SessionBusyError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.revert",
            summary: "Revert message",
            description:
              "Revert a specific message in a session, undoing its effects and restoring the previous state.",
          }),
        ),
        HttpApiEndpoint.post("unrevert", SessionPaths.unrevert, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Session.Info, "Updated session"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, SessionBusyError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.unrevert",
            summary: "Restore reverted messages",
            description: "Restore all previously reverted messages in a session.",
          }),
        ),
        HttpApiEndpoint.post("permissionRespond", SessionPaths.permissions, {
          params: { sessionID: SessionID, permissionID: PermissionV1.ID },
          query: WorkspaceRoutingQuery,
          payload: PermissionResponsePayload,
          success: described(Schema.Boolean, "Permission processed successfully"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, PermissionNotFoundError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "permission.respond",
            summary: "Respond to permission",
            description: "Approve or deny a permission request from the AI assistant.",
            deprecated: true,
          }),
        ),
        HttpApiEndpoint.get("getPermissionOverride", SessionPaths.permissionOverride, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Struct({ enabled: Schema.Boolean }), "Override status"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "permission.override.get",
            summary: "Get session permission override status",
            description:
              "Returns whether the temporary break-glass permission override is active for the current session.",
          }),
        ),
        HttpApiEndpoint.put("putPermissionOverride", SessionPaths.permissionOverride, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: Schema.Struct({ acknowledged: Schema.optional(Schema.Boolean) }),
          success: described(Schema.Struct({ enabled: Schema.Boolean }), "Override status"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, InvalidRequestError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "permission.override.put",
            summary: "Enable or renew the session permission override",
            description:
              "Enables (first enable requires acknowledged:true) or renews the 60s temporary break-glass lease. Child and unattended sessions are rejected.",
          }),
        ),
        HttpApiEndpoint.delete("deletePermissionOverride", SessionPaths.permissionOverride, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Struct({ enabled: Schema.Boolean }), "Override status"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "permission.override.delete",
            summary: "Disable the session permission override",
            description: "Disables the temporary break-glass permission override for the current session.",
          }),
        ),
        HttpApiEndpoint.delete("deleteMessage", SessionPaths.deleteMessage, {
          params: { sessionID: SessionID, messageID: MessageID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Successfully deleted message"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, SessionBusyError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.deleteMessage",
            summary: "Delete message",
            description:
              "Permanently delete a specific message and all of its parts from a session without reverting file changes.",
          }),
        ),
        HttpApiEndpoint.delete("deletePart", SessionPaths.deletePart, {
          params: { sessionID: SessionID, messageID: MessageID, partID: PartID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Successfully deleted part"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "part.delete",
            description: "Delete a part from a message.",
          }),
        ),
        HttpApiEndpoint.patch("updatePart", SessionPaths.updatePart, {
          params: { sessionID: SessionID, messageID: MessageID, partID: PartID },
          query: WorkspaceRoutingQuery,
          payload: SessionV1.Part,
          success: described(SessionV1.Part, "Successfully updated part"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "part.update",
            description: "Update a part in a message.",
          }),
        ),
        HttpApiEndpoint.get("cacheDiagnostics", SessionPaths.cacheDiagnostics, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(CacheDiagnostics, "Cache diagnostics"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.cacheDiagnostics",
            summary: "Get cache diagnostics",
            description: "Retrieve cache hit rate and per-step cache statistics for a session.",
          }),
        ),
        HttpApiEndpoint.get("toolSummary", SessionPaths.toolSummary, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(ToolSummary.Summary), "Tool summary"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.toolSummary",
            summary: "Get tool summary",
            description: "Retrieve aggregated tool call summary for a sub-agent session.",
          }),
        ),
        HttpApiEndpoint.get("composition", SessionPaths.composition, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Composition.Snapshot, "Session composition snapshot"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.composition",
            summary: "Get session composition snapshot",
            description: "Retrieve the immutable composition snapshot for a custom session.",
          }),
        ),
        HttpApiEndpoint.get("workflow", SessionPaths.workflow, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(WorkflowAsset.WorkflowStatusResponse, "Session workflow status"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.workflow.get",
            summary: "Get session workflow status",
            description: "Retrieve workflow run and step run execution state for a session.",
          }),
        ),
        HttpApiEndpoint.post("workflowRun", SessionPaths.workflowRun, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: WorkflowRunPayload,
          success: described(
            WorkflowAsset.WorkflowStatusResponse.pipe(HttpApiSchema.status("Accepted")),
            "Accepted workflow status",
          ),
          error: [HttpApiError.BadRequest, ApiNotFoundError, ConflictError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.workflow.run",
            summary: "Admit session workflow",
            description: "Atomically admit a custom workflow run and wake its process-local asynchronous owner.",
          }),
        ),
        HttpApiEndpoint.post("workflowCancelRun", SessionPaths.workflowCancelRun, {
          params: { sessionID: SessionID, runID: WorkflowAsset.WorkflowRunID },
          query: WorkspaceRoutingQuery,
          payload: WorkflowCancelRunPayload,
          success: described(WorkflowAsset.WorkflowStatusResponse, "Cancelled workflow status"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, ConflictError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.workflow.cancelRun",
            summary: "Cancel session workflow run",
            description:
              "Persist the cancelling intent under run-revision CAS, interrupt the process-local owner and return the settled terminal state.",
          }),
        ),
        HttpApiEndpoint.post("workflowCancelStep", SessionPaths.workflowCancelStep, {
          params: {
            sessionID: SessionID,
            runID: WorkflowAsset.WorkflowRunID,
            stepRunID: WorkflowAsset.StepRunID,
          },
          query: WorkspaceRoutingQuery,
          payload: WorkflowCancelStepPayload,
          success: described(WorkflowAsset.WorkflowStatusResponse, "Step cancellation workflow status"),
          error: [HttpApiError.BadRequest, ApiNotFoundError, ConflictError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.workflow.cancelStep",
            summary: "Cancel session workflow step",
            description:
              "Explicitly cancel a single step run under run and step revision CAS without triggering automatic retry.",
          }),
        ),
        HttpApiEndpoint.post("workflowRetryStep", SessionPaths.workflowRetryStep, {
          params: {
            sessionID: SessionID,
            runID: WorkflowAsset.WorkflowRunID,
            stepRunID: WorkflowAsset.StepRunID,
          },
          query: WorkspaceRoutingQuery,
          payload: WorkflowRetryStepPayload,
          success: described(
            WorkflowAsset.WorkflowStatusResponse.pipe(HttpApiSchema.status("Accepted")),
            "Accepted retry workflow status",
          ),
          error: [HttpApiError.BadRequest, ApiNotFoundError, ConflictError, UnsupportedProductModeError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.workflow.retryStep",
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
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "aigcfroge experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
