import { Predicate, Schema, SchemaGetter } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api"
import { Pty } from "@aigcfroge/schema/pty"
import { Session } from "@aigcfroge/schema/session"
import { SessionConsultation } from "@aigcfroge/schema/session-consultation"
import { Model } from "@aigcfroge/schema/model"
import { ModelGroup } from "@aigcfroge/schema/model-group"
import { ProviderDefinition } from "@aigcfroge/schema/provider-definition"
import { ProviderDiscovery } from "@aigcfroge/schema/provider-discovery"
import { Composition } from "@aigcfroge/schema/composition"
import { SessionTask } from "@aigcfroge/schema/session-task"
import { SessionGoal } from "@aigcfroge/schema/session-goal"
import { SessionCommunication } from "@aigcfroge/schema/session-communication"
import { PositiveInt } from "@aigcfroge/schema/schema"
import { Schedule } from "@aigcfroge/schema/schedule"
import { Worktree } from "@aigcfroge/schema/worktree"
import {
  ApiNotFoundError,
  CompositionResolveError,
  ConflictError,
  InvalidRequestError,
} from "@aigcfroge/protocol/errors"
import {
  SessionInstanceTaskWriteInfo,
  SessionPaths,
  WorkflowRunPayload,
  WorkflowCancelRunPayload,
  WorkflowCancelStepPayload,
  WorkflowRetryStepPayload,
} from "@aigcfroge/protocol/groups/session-instance"
import { MemoryGroup } from "@aigcfroge/protocol/groups/memory"
import { LocationQuery } from "@aigcfroge/protocol/groups/location"
import { WorkspaceRoutingQuery, WorkspaceRoutingQueryFields } from "@aigcfroge/protocol/middleware/workspace-routing"
import { LegacyDelegationState } from "@aigcfroge/protocol/groups/delegation"
import { QueryBoolean } from "@aigcfroge/protocol/groups/query"
import { AgentAssetListQuery } from "@aigcfroge/protocol/groups/agent-asset"
import { WorkflowAssetContentQuery, WorkflowAssetListQuery } from "@aigcfroge/protocol/groups/workflow-asset"
import {
  CustomProfileApplyPayload,
  CustomProfileContentQuery,
  CustomProfileListQuery,
} from "@aigcfroge/protocol/groups/custom-profile"

// Handlers answer plain fixture data: undefined properties are dropped, and other non-JSON values become null.
const Json = Schema.Json.pipe(
  Schema.decodeTo(Schema.Unknown, {
    decode: SchemaGetter.passthrough(),
    encode: SchemaGetter.transform(function json(value): Schema.Json {
      if (value === null || Predicate.isString(value) || Predicate.isBoolean(value)) return value

      if (Predicate.isNumber(value)) return Number.isFinite(value) ? value : null

      if (Array.isArray(value)) return value.map(json)

      if (!Predicate.isObject(value)) return null

      return Object.fromEntries(
        Object.entries(value).flatMap(([key, item]) => (item === undefined ? [] : [[key, json(item)]])),
      )
    }),
  }),
  HttpApiSchema.asJson(),
)

const JsonPayload = Schema.Unknown.pipe(HttpApiSchema.asJson())

// SAFETY: memory.edit declares one JSON payload; this is that endpoint's exact schema, without its middleware.
const MemoryEditPayload = MemoryGroup.endpoints["memory.edit"].payload.get("application/json")!
  .schemas[0] as HttpApiEndpoint.Payload<(typeof MemoryGroup.endpoints)["memory.edit"]>

const Query = Schema.Struct({
  directory: Schema.optional(Schema.String),
  parentID: Schema.optional(Schema.String),
  search: Schema.optional(Schema.String),
  order: Schema.optional(Schema.String),
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString),
  path: Schema.optional(Schema.String),
  query: Schema.optional(Schema.String),
  type: Schema.optional(Schema.String),
  mode: Schema.optional(Schema.String),
})

const SessionParams = { sessionID: Schema.String }

const PtyParams = { ptyID: Pty.ID }

const TaskSessionParams = { sessionID: Session.ID }

const TaskParams = { ...TaskSessionParams, taskID: Schema.String }

const TaskErrors = [ApiNotFoundError, InvalidRequestError]

const CommunicationListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  cursor: Schema.optional(Schema.String),
  limit: Schema.NumberFromString.pipe(Schema.decodeTo(PositiveInt), Schema.optional),
})

const NoContent = HttpApiSchema.NoContent

export class MockNotFound extends Schema.TaggedError<MockNotFound>()("MockNotFound", {
  message: Schema.String,
}) {}

export class MockBadRequest extends Schema.TaggedError<MockBadRequest>()("MockBadRequest", {
  message: Schema.String,
}) {}

export class MockInternal extends Schema.TaggedError<MockInternal>()("MockInternal", {
  message: Schema.String,
}) {}

// The server's error for an unknown shell command; the timeline shows that shell's output as missing.
export class MockShellNotFound extends Schema.TaggedError<MockShellNotFound>()("ShellNotFoundError", {
  id: Schema.String,
  message: Schema.String,
}) {}

// The server's error for an unknown PTY, or one owned by another workspace.
export class MockPtyNotFound extends Schema.TaggedError<MockPtyNotFound>()("PtyNotFoundError", {
  ptyID: Schema.String,
  message: Schema.String,
}) {}

// The server's error for a request without its password.
export class MockUnauthorized extends Schema.TaggedError<MockUnauthorized>()("UnauthorizedError", {
  message: Schema.String,
}) {}

// A mutation the scenario did not configure a handler for.
export class MockUnsupported extends Schema.TaggedError<MockUnsupported>()("MockUnsupported", {
  message: Schema.String,
}) {}

const Unsupported = MockUnsupported.pipe(HttpApiSchema.status(501))

const PtyMissing = [MockNotFound.pipe(HttpApiSchema.status(404)), MockPtyNotFound.pipe(HttpApiSchema.status(404))]

const Group = HttpApiGroup.make("mock")
  .add(
    HttpApiEndpoint.get("profileList", "/custom-profile", {
      query: CustomProfileListQuery,
      success: Json,
    }),
  )
  .add(
    HttpApiEndpoint.get("profileContent", "/custom-profile/content", {
      query: CustomProfileContentQuery,
      success: Json,
      error: TaskErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("profileApply", "/custom-profile/apply", {
      query: WorkspaceRoutingQuery,
      payload: CustomProfileApplyPayload,
      success: Json,
      error: [InvalidRequestError, ConflictError, Unsupported],
    }),
  )
  .add(
    HttpApiEndpoint.post("compositionPlan", "/custom-composition/plan", {
      query: WorkspaceRoutingQuery,
      payload: Composition.CompositionInput,
      success: Json,
      error: [InvalidRequestError, ConflictError, Unsupported],
    }),
  )
  .add(
    HttpApiEndpoint.post("compositionStart", "/custom-composition/start", {
      query: WorkspaceRoutingQuery,
      payload: Composition.StartInput,
      success: Json,
      error: [InvalidRequestError, ConflictError, CompositionResolveError, Unsupported],
    }),
  )
  .add(HttpApiEndpoint.get("agent-asset.list", "/agent-asset", { query: AgentAssetListQuery, success: Json }))
  .add(HttpApiEndpoint.get("workflow-asset.list", "/workflow-asset", { query: WorkflowAssetListQuery, success: Json }))
  .add(
    HttpApiEndpoint.get("workflow-asset.content", "/workflow-asset/content", {
      query: WorkflowAssetContentQuery,
      success: Json,
      error: TaskErrors,
    }),
  )
  .add(HttpApiEndpoint.get("memory.list", "/memory", { success: Json, error: TaskErrors }))
  .add(HttpApiEndpoint.get("memory.pending", "/memory/pending", { success: Json, error: TaskErrors }))
  .add(
    HttpApiEndpoint.post("memory.confirm", "/memory/:id/confirm", {
      params: { id: Schema.String },
      success: Json,
      error: TaskErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("memory.reject", "/memory/:id/reject", {
      params: { id: Schema.String },
      success: Json,
      error: TaskErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("memory.edit", "/memory/:id", {
      params: { id: Schema.String },
      payload: MemoryEditPayload,
      success: Json,
      error: TaskErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("memory.remove", "/memory/:id/remove", {
      params: { id: Schema.String },
      success: Json,
      error: TaskErrors,
    }),
  )
  .add(HttpApiEndpoint.get("hub.list", "/agent-task", { query: Query, success: Json }))
  .add(
    HttpApiEndpoint.get("meta.get", "/session/:sessionID/meta", { params: SessionParams, query: Query, success: Json }),
  )
  .add(
    HttpApiEndpoint.get("facts.get", "/session/:sessionID/project-memory", {
      params: SessionParams,
      query: Schema.Struct({
        ...Query.fields,
        keyword: Schema.optional(Schema.String),
        category: Schema.optional(Schema.String),
      }),
      success: Json,
    }),
  )
  .add(
    HttpApiEndpoint.delete("facts.remove", "/session/:sessionID/project-memory/:id", {
      params: { ...SessionParams, id: Schema.String },
      query: Query,
      success: Schema.Void,
    }),
  )
  .add(
    HttpApiEndpoint.get("cache.get", "/session/:sessionID/cache-diagnostics", {
      params: SessionParams,
      query: Query,
      success: Json,
      error: TaskErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("workflow.get", "/session/:sessionID/workflow", {
      params: SessionParams,
      query: Schema.Struct({ ...Query.fields, runID: Schema.optional(Schema.String) }),
      success: Json,
      error: TaskErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("workflow.run", "/session/:sessionID/workflow/run", {
      params: SessionParams,
      query: Query,
      payload: WorkflowRunPayload,
      success: Json.pipe(HttpApiSchema.status("Accepted")),
      error: [...TaskErrors, ConflictError],
    }),
  )
  .add(
    HttpApiEndpoint.post("workflow.cancelRun", "/session/:sessionID/workflow/:runID/cancel", {
      params: { ...SessionParams, runID: Schema.String },
      query: Query,
      payload: WorkflowCancelRunPayload,
      success: Json,
      error: [...TaskErrors, ConflictError],
    }),
  )
  .add(
    HttpApiEndpoint.post("workflow.cancelStep", "/session/:sessionID/workflow/:runID/step/:stepRunID/cancel", {
      params: { ...SessionParams, runID: Schema.String, stepRunID: Schema.String },
      query: Query,
      payload: WorkflowCancelStepPayload,
      success: Json,
      error: [...TaskErrors, ConflictError],
    }),
  )
  .add(
    HttpApiEndpoint.post("workflow.retryStep", "/session/:sessionID/workflow/:runID/step/:stepRunID/retry", {
      params: { ...SessionParams, runID: Schema.String, stepRunID: Schema.String },
      query: Query,
      payload: WorkflowRetryStepPayload,
      success: Json.pipe(HttpApiSchema.status("Accepted")),
      error: [...TaskErrors, ConflictError],
    }),
  )
  .add(
    HttpApiEndpoint.post("artifact.apply", "/session/:sessionID/work-artifact/apply", {
      params: SessionParams,
      query: Query,
      payload: JsonPayload,
      success: Json,
      error: [InvalidRequestError, ConflictError],
    }),
  )
  .add(
    HttpApiEndpoint.get(
      "delegation.result",
      "/delegation/:delegationID/turn/:turnID/participant/:participantID/result",
      {
        params: { delegationID: Schema.String, turnID: Schema.String, participantID: Schema.String },
        query: Schema.Struct({
          ...Query.fields,
          deliveryOrigin: Schema.String,
          senderParticipantID: Schema.String,
          attempt: Schema.NumberFromString,
        }),
        success: Json,
        error: TaskErrors,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get("delegation.list", "/delegation", {
      query: Schema.Struct({
        ...WorkspaceRoutingQuery.fields,
        parentSessionID: Schema.optional(Session.ID),
        includeArchived: Schema.optional(QueryBoolean),
      }),
      success: Schema.Array(LegacyDelegationState),
      error: TaskErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("delegation.interrupt", "/delegation/:delegationID/interrupt", {
      params: { delegationID: Schema.String },
      query: WorkspaceRoutingQuery,
      payload: JsonPayload,
      success: LegacyDelegationState,
      error: TaskErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("delegation.close", "/delegation/:delegationID/close", {
      params: { delegationID: Schema.String },
      query: WorkspaceRoutingQuery,
      payload: JsonPayload,
      success: LegacyDelegationState,
      error: TaskErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("delegation.reconcile", "/delegation/:delegationID/reconcile", {
      params: { delegationID: Schema.String },
      query: WorkspaceRoutingQuery,
      payload: JsonPayload,
      success: LegacyDelegationState,
      error: TaskErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("delegation.retry", "/delegation/:delegationID/turn/:turnID/retry", {
      params: { delegationID: Schema.String, turnID: Schema.String },
      query: WorkspaceRoutingQuery,
      payload: JsonPayload,
      success: LegacyDelegationState,
      error: TaskErrors,
    }),
  )
  .add(HttpApiEndpoint.get("info", "/api/info", { success: Json }))
  .add(
    HttpApiEndpoint.get("event", "/api/event", {
      success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/event-stream" })),
    }),
  )
  .add(HttpApiEndpoint.get("reference", "/api/reference", { success: Json }))
  .add(HttpApiEndpoint.get("config", "/api/config", { success: Json }))
  .add(HttpApiEndpoint.get("agent", "/api/agent", { success: Json }))
  .add(HttpApiEndpoint.get("provider", "/api/provider", { success: Json }))
  .add(HttpApiEndpoint.get("providerDefinition", "/api/provider/definition", { success: Json }))
  .add(
    HttpApiEndpoint.get("providerDiscovery", "/api/provider/discovery", {
      query: Schema.Struct({ ...LocationQuery.fields, ...ProviderDiscovery.GetInput.fields }),
      success: Json,
    }),
  )
  .add(
    HttpApiEndpoint.post("providerDiscoveryPreview", "/api/provider/discovery/preview", {
      payload: ProviderDiscovery.PreviewInput,
      success: Json,
      error: Unsupported,
    }),
  )
  .add(
    HttpApiEndpoint.post("providerDiscoveryRefresh", "/api/provider/discovery/refresh", {
      payload: ProviderDiscovery.RefreshInput,
      success: Json,
      error: Unsupported,
    }),
  )
  .add(
    HttpApiEndpoint.post("providerDefinitionSave", "/api/provider/definition", {
      payload: ProviderDefinition.SaveInput,
      success: Json,
      error: Unsupported,
    }),
  )
  .add(
    HttpApiEndpoint.delete("providerDefinitionRemove", "/api/provider/definition", {
      payload: ProviderDefinition.RemoveInput,
      success: Json,
      error: Unsupported,
    }),
  )
  .add(HttpApiEndpoint.get("model", "/api/model", { success: Json }))
  .add(HttpApiEndpoint.get("modelGroupDefinition", "/api/model/group", { success: Json }))
  .add(
    HttpApiEndpoint.post("modelGroupDefinitionSave", "/api/model/group", {
      payload: ModelGroup.SaveInput,
      success: Json,
      error: Unsupported,
    }),
  )
  .add(
    HttpApiEndpoint.delete("modelGroupDefinitionRemove", "/api/model/group", {
      payload: ModelGroup.RemoveInput,
      success: Json,
      error: Unsupported,
    }),
  )
  .add(HttpApiEndpoint.get("modelDefault", "/api/model/default", { success: Json }))
  .add(HttpApiEndpoint.get("integrationList", "/api/integration", { success: Json }))
  .add(
    HttpApiEndpoint.get("integrationGet", "/api/integration/:integrationID", {
      params: { integrationID: Schema.String },
      success: Json,
    }),
  )
  .add(
    HttpApiEndpoint.post("integrationConnect", "/api/integration/:integrationID/connect/key", {
      params: { integrationID: Schema.String },
      payload: JsonPayload,
      success: NoContent,
    }),
  )
  .add(
    HttpApiEndpoint.post("integrationOAuthConnect", "/api/integration/:integrationID/connect/oauth", {
      params: { integrationID: Schema.String },
      payload: JsonPayload,
      success: Json,
      error: Unsupported,
    }),
  )
  .add(
    HttpApiEndpoint.get("integrationOAuthStatus", "/api/integration/:integrationID/connect/oauth/:attemptID", {
      params: { integrationID: Schema.String, attemptID: Schema.String },
      success: Json,
      error: MockNotFound.pipe(HttpApiSchema.status(404)),
    }),
  )
  .add(
    HttpApiEndpoint.delete("credentialRemove", "/api/credential/:credentialID", {
      params: { credentialID: Schema.String },
      success: NoContent,
    }),
  )
  .add(HttpApiEndpoint.get("command", "/api/command", { success: Json }))
  .add(HttpApiEndpoint.get("skill", "/api/skill", { success: Json }))
  .add(HttpApiEndpoint.get("plugin", "/api/plugin", { success: Json }))
  .add(HttpApiEndpoint.get("mcp", "/api/mcp", { success: Json }))
  .add(
    HttpApiEndpoint.post("mcpConnect", "/api/experimental/mcp/:server/connect", {
      params: { server: Schema.String },
      success: NoContent,
      error: MockNotFound.pipe(HttpApiSchema.status(404)),
    }),
  )
  .add(
    HttpApiEndpoint.post("mcpDisconnect", "/api/experimental/mcp/:server/disconnect", {
      params: { server: Schema.String },
      success: NoContent,
      error: MockNotFound.pipe(HttpApiSchema.status(404)),
    }),
  )
  .add(HttpApiEndpoint.get("mcpResource", "/api/mcp/resource", { success: Json }))
  .add(HttpApiEndpoint.get("projectList", "/api/project", { success: Json }))
  .add(
    HttpApiEndpoint.patch("projectUpdate", "/api/project/:projectID", {
      params: { projectID: Schema.String },
      payload: JsonPayload,
      success: Json,
    }),
  )
  .add(HttpApiEndpoint.get("configShells", "/api/config/shell", { success: Json }))
  .add(
    HttpApiEndpoint.patch("configUpdate", "/api/experimental/config", {
      payload: Schema.Struct({ shell: Schema.NullOr(Schema.String) }),
      success: HttpApiSchema.NoContent,
    }),
  )
  .add(HttpApiEndpoint.get("websearchProviders", "/api/websearch/provider", { success: Json }))
  .add(
    HttpApiEndpoint.get("worktreeList", "/api/worktree", {
      query: Schema.Struct({ projectID: Schema.String }),
      success: Json,
    }),
  )
  .add(
    HttpApiEndpoint.post("worktreeCreate", "/api/worktree", {
      payload: Worktree.CreateInput,
      success: Json,
      error: Unsupported,
    }),
  )
  .add(
    HttpApiEndpoint.delete("worktreeRemove", "/api/worktree", {
      payload: Worktree.RemoveInput,
      success: NoContent,
      error: Unsupported,
    }),
  )
  .add(
    HttpApiEndpoint.post("worktreeRefresh", "/api/worktree/refresh", {
      payload: Schema.Struct({ projectID: Schema.String }),
      success: NoContent,
    }),
  )
  .add(HttpApiEndpoint.get("location", "/api/location", { success: Json }))
  .add(
    HttpApiEndpoint.get("permissionRequests", "/api/permission/request", {
      success: Json,
      error: MockInternal.pipe(HttpApiSchema.status(500)),
    }),
  )
  .add(HttpApiEndpoint.get("formRequests", "/api/form", { success: Json }))
  .add(HttpApiEndpoint.get("vcs", "/api/vcs", { success: Json }))
  .add(HttpApiEndpoint.post("vcsInit", "/api/vcs/init", { success: NoContent, error: Unsupported }))
  .add(HttpApiEndpoint.get("vcsStatus", "/api/vcs/status", { success: Json }))
  .add(HttpApiEndpoint.get("vcsBranches", "/api/vcs/branch", { success: Json }))
  .add(HttpApiEndpoint.get("vcsDiff", "/api/vcs/diff", { query: Query, success: Json }))
  .add(HttpApiEndpoint.get("fsList", "/api/fs/list", { query: Query, success: Json }))
  .add(
    HttpApiEndpoint.get("fsRead", "/api/fs/read/*", {
      success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
    }),
  )
  .add(HttpApiEndpoint.get("fsFind", "/api/fs/find", { query: Query, success: Json }))
  .add(
    HttpApiEndpoint.post("fsWrite", "/api/experimental/fs/write", {
      payload: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
      success: Json,
      error: Unsupported,
    }),
  )
  .add(HttpApiEndpoint.get("shell", "/api/shell", { success: Json }))
  .add(
    HttpApiEndpoint.get("shellOutput", "/api/shell/:id/output", {
      params: { id: Schema.String },
      success: Json,
      error: MockShellNotFound.pipe(HttpApiSchema.status(404)),
    }),
  )
  .add(
    HttpApiEndpoint.delete("shellRemove", "/api/shell/:id", {
      params: { id: Schema.String },
      success: NoContent,
    }),
  )
  .add(
    HttpApiEndpoint.get("ptyList", "/api/pty", {
      success: Json,
      error: MockNotFound.pipe(HttpApiSchema.status(404)),
    }),
  )
  .add(
    HttpApiEndpoint.post("ptyCreate", "/api/pty", {
      payload: Pty.CreateInput,
      success: Json,
      error: MockNotFound.pipe(HttpApiSchema.status(404)),
    }),
  )
  .add(
    HttpApiEndpoint.get("ptyGet", "/api/pty/:ptyID", {
      params: PtyParams,
      success: Json,
      error: PtyMissing,
    }),
  )
  .add(
    HttpApiEndpoint.put("ptyUpdate", "/api/pty/:ptyID", {
      params: PtyParams,
      payload: Pty.UpdateInput,
      success: Json,
      error: PtyMissing,
    }),
  )
  .add(
    HttpApiEndpoint.delete("ptyRemove", "/api/pty/:ptyID", {
      params: PtyParams,
      success: NoContent,
      error: PtyMissing,
    }),
  )
  .add(
    HttpApiEndpoint.post("ptyConnectToken", "/api/pty/:ptyID/connect-token", {
      params: PtyParams,
      success: Json,
      error: PtyMissing,
    }),
  )
  .add(
    HttpApiEndpoint.get("sessionList", "/api/session", {
      query: Query,
      success: Json,
      error: MockBadRequest.pipe(HttpApiSchema.status(400)),
    }),
  )
  .add(HttpApiEndpoint.post("sessionCreate", "/api/session", { payload: JsonPayload, success: Json }))
  .add(
    HttpApiEndpoint.post("sessionCreateConsultation", "/api/session/:sourceSessionID/consultation", {
      params: { sourceSessionID: Session.ID },
      payload: SessionConsultation.Input,
      success: Schema.Struct({ data: SessionConsultation.Data }),
      error: [Unsupported, MockBadRequest.pipe(HttpApiSchema.status(400)), InvalidRequestError, ConflictError],
    }),
  )
  .add(
    HttpApiEndpoint.get("sessionConsultation", "/api/session/:sessionID/consultation", {
      params: SessionParams,
      success: Schema.Struct({ data: SessionConsultation.Read }),
      error: [Unsupported, MockNotFound.pipe(HttpApiSchema.status(404)), InvalidRequestError, ConflictError],
    }),
  )
  .add(
    HttpApiEndpoint.post("sessionFork", "/api/session/:sessionID/fork", {
      params: SessionParams,
      payload: Schema.Struct({
        before: Schema.optional(Schema.String),
        through: Schema.optional(Schema.String),
        control: Schema.optional(Schema.Literal("meta")),
        model: Schema.optional(Model.Selection),
        executorPreference: Schema.optional(Session.ExecutorPreference),
        expectedSource: Schema.optional(Session.ForkExpectedSource),
      }),
      success: Json,
      error: [MockNotFound.pipe(HttpApiSchema.status(404)), InvalidRequestError],
    }),
  )
  .add(
    HttpApiEndpoint.get("sessionComposition", SessionPaths.composition, {
      params: SessionParams,
      query: WorkspaceRoutingQuery,
      success: Json,
      error: [ApiNotFoundError, InvalidRequestError],
    }),
  )
  .add(HttpApiEndpoint.get("sessionActive", "/api/session/active", { success: Json }))
  .add(
    HttpApiEndpoint.get("sessionGet", "/api/session/:sessionID", {
      params: SessionParams,
      success: Json,
      error: MockNotFound.pipe(HttpApiSchema.status(404)),
    }),
  )
  .add(
    HttpApiEndpoint.delete("sessionRemove", "/api/session/:sessionID", {
      params: SessionParams,
      success: NoContent,
    }),
  )
  .add(
    HttpApiEndpoint.post("sessionShell", "/api/session/:sessionID/shell", {
      params: SessionParams,
      success: NoContent,
    }),
  )
  .add(
    HttpApiEndpoint.get("sessionForm", "/api/session/:sessionID/form", {
      params: SessionParams,
      success: Json,
    }),
  )
  .add(
    HttpApiEndpoint.post("sessionFormReply", "/api/session/:sessionID/form/:formID/reply", {
      params: { ...SessionParams, formID: Schema.String },
      payload: JsonPayload,
      success: NoContent,
    }),
  )
  .add(
    HttpApiEndpoint.delete("sessionFormCancel", "/api/session/:sessionID/form/:formID", {
      params: { ...SessionParams, formID: Schema.String },
      success: NoContent,
    }),
  )
  .add(
    HttpApiEndpoint.post("sessionBackground", "/api/session/:sessionID/background", {
      params: SessionParams,
      success: NoContent,
    }),
  )
  .add(
    HttpApiEndpoint.get("sessionInbox", "/api/session/:sessionID/inbox", {
      params: SessionParams,
      success: Json,
    }),
  )
  .add(
    HttpApiEndpoint.get("sessionTaskGet", SessionPaths.task, {
      params: TaskSessionParams,
      query: WorkspaceRoutingQuery,
      success: Schema.Array(SessionTask.Info),
      error: TaskErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("sessionIdentity", SessionPaths.identity, {
      params: TaskSessionParams,
      query: WorkspaceRoutingQuery,
      success: Json,
      error: TaskErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("taskOperations", SessionPaths.taskOperations, {
      params: TaskSessionParams,
      query: WorkspaceRoutingQuery,
      success: Json,
      error: TaskErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("taskOperation", SessionPaths.taskOperation, {
      params: { ...TaskSessionParams, operationID: SessionTask.OperationID },
      query: WorkspaceRoutingQuery,
      success: Json,
      error: TaskErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("taskDispatch", SessionPaths.taskDispatch, {
      params: TaskSessionParams,
      query: WorkspaceRoutingQuery,
      payload: SessionTask.OperationRequest,
      success: Json,
      error: [ApiNotFoundError, InvalidRequestError, ConflictError],
    }),
  )
  .add(
    HttpApiEndpoint.post("taskCancelOperation", SessionPaths.taskOperationCancel, {
      params: { ...TaskSessionParams, operationID: SessionTask.OperationID },
      query: WorkspaceRoutingQuery,
      success: Json,
      error: TaskErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("communicationList", "/api/session/:sessionID/communication", {
      params: TaskSessionParams,
      query: CommunicationListQuery,
      success: Json,
      error: TaskErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("communicationRead", "/api/session/:sessionID/communication/:communicationID", {
      params: { ...TaskSessionParams, communicationID: SessionCommunication.ID },
      query: WorkspaceRoutingQuery,
      success: Json,
      error: TaskErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("communicationSend", "/api/session/:sessionID/communication", {
      params: TaskSessionParams,
      query: WorkspaceRoutingQuery,
      payload: SessionCommunication.Send,
      success: Json,
      error: [ApiNotFoundError, InvalidRequestError, ConflictError],
    }),
  )
  .add(
    HttpApiEndpoint.post("communicationReply", "/api/session/:sessionID/communication/:communicationID/reply", {
      params: { ...TaskSessionParams, communicationID: SessionCommunication.ID },
      query: WorkspaceRoutingQuery,
      payload: SessionCommunication.Reply,
      success: Json,
      error: [ApiNotFoundError, InvalidRequestError, ConflictError],
    }),
  )
  .add(
    HttpApiEndpoint.get("goalList", "/api/session/:sessionID/goal", {
      params: TaskSessionParams,
      success: Json,
      error: TaskErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("goalGet", "/api/session/:sessionID/goal/:goalID", {
      params: { ...TaskSessionParams, goalID: SessionGoal.ID },
      success: Json,
      error: TaskErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("goalSet", "/api/session/:sessionID/goal", {
      params: TaskSessionParams,
      payload: SessionGoal.CreateInput,
      success: Json,
      error: [ApiNotFoundError, InvalidRequestError, ConflictError],
    }),
  )
  .add(
    HttpApiEndpoint.patch("goalEdit", "/api/session/:sessionID/goal/:goalID", {
      params: { ...TaskSessionParams, goalID: SessionGoal.ID },
      payload: SessionGoal.EditInput,
      success: Json,
      error: [ApiNotFoundError, InvalidRequestError, ConflictError],
    }),
  )
  .add(
    HttpApiEndpoint.post("goalPause", "/api/session/:sessionID/goal/:goalID/pause", {
      params: { ...TaskSessionParams, goalID: SessionGoal.ID },
      payload: SessionGoal.RevisionInput,
      success: Json,
      error: [ApiNotFoundError, InvalidRequestError, ConflictError],
    }),
  )
  .add(
    HttpApiEndpoint.post("goalResume", "/api/session/:sessionID/goal/:goalID/resume", {
      params: { ...TaskSessionParams, goalID: SessionGoal.ID },
      payload: SessionGoal.RevisionInput,
      success: Json,
      error: [ApiNotFoundError, InvalidRequestError, ConflictError],
    }),
  )
  .add(
    HttpApiEndpoint.post("goalCancel", "/api/session/:sessionID/goal/:goalID/cancel", {
      params: { ...TaskSessionParams, goalID: SessionGoal.ID },
      payload: SessionGoal.RevisionInput,
      success: Json,
      error: [ApiNotFoundError, InvalidRequestError, ConflictError],
    }),
  )
  .add(
    HttpApiEndpoint.post("goalConfirm", "/api/session/:sessionID/goal/:goalID/confirm", {
      params: { ...TaskSessionParams, goalID: SessionGoal.ID },
      payload: SessionGoal.ConfirmInput,
      success: Json,
      error: [ApiNotFoundError, InvalidRequestError, ConflictError],
    }),
  )
  .add(
    HttpApiEndpoint.get("scheduleRules", "/schedule/rules/:sessionID", {
      params: TaskSessionParams,
      query: WorkspaceRoutingQuery,
      success: Json,
      error: TaskErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("scheduleRule", "/schedule/rule/:id", {
      params: { id: Schedule.ID },
      query: WorkspaceRoutingQuery,
      success: Json,
      error: TaskErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("scheduleCreate", "/schedule/rule", {
      query: WorkspaceRoutingQuery,
      payload: Schedule.Create,
      success: Json,
      error: [ApiNotFoundError, InvalidRequestError, ConflictError],
    }),
  )
  .add(
    HttpApiEndpoint.patch("scheduleEdit", "/schedule/rule/:id", {
      params: { id: Schedule.ID },
      query: WorkspaceRoutingQuery,
      payload: Schedule.Edit,
      success: Json,
      error: [ApiNotFoundError, InvalidRequestError, ConflictError],
    }),
  )
  .add(
    HttpApiEndpoint.post("schedulePause", "/schedule/rule/:id/pause", {
      params: { id: Schedule.ID },
      query: WorkspaceRoutingQuery,
      payload: Schedule.Mutation,
      success: Json,
      error: TaskErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("scheduleResume", "/schedule/rule/:id/resume", {
      params: { id: Schedule.ID },
      query: WorkspaceRoutingQuery,
      payload: Schedule.Mutation,
      success: Json,
      error: TaskErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("scheduleCancel", "/schedule/rule/:id/cancel", {
      params: { id: Schedule.ID },
      query: WorkspaceRoutingQuery,
      payload: Schedule.Mutation,
      success: Json,
      error: TaskErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("scheduleRun", "/schedule/rule/:id/run", {
      params: { id: Schedule.ID },
      query: WorkspaceRoutingQuery,
      payload: Schedule.Mutation,
      success: Json,
      error: TaskErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("scheduleRuns", "/schedule/rule/:id/runs", {
      params: { id: Schedule.ID },
      query: WorkspaceRoutingQuery,
      success: Json,
      error: TaskErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("scheduleCancelRun", "/schedule/run/:occurrenceID/cancel", {
      params: { occurrenceID: Schedule.OccurrenceID },
      query: WorkspaceRoutingQuery,
      success: Json,
      error: TaskErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("sessionTaskCreate", SessionPaths.task, {
      params: TaskSessionParams,
      query: WorkspaceRoutingQuery,
      payload: SessionInstanceTaskWriteInfo,
      success: SessionTask.Info,
      error: TaskErrors,
    }),
  )
  .add(
    HttpApiEndpoint.patch("sessionTaskPatch", SessionPaths.taskItem, {
      params: TaskParams,
      query: WorkspaceRoutingQuery,
      payload: Schema.Struct({
        status: Schema.optional(SessionTask.TaskStatus),
        content: Schema.optional(Schema.String),
        priority: Schema.optional(SessionTask.TaskPriority),
        expectedRevision: Schema.optional(Schema.Number),
      }),
      success: SessionTask.Info,
      error: TaskErrors,
    }),
  )
  .add(
    HttpApiEndpoint.delete("sessionTaskDelete", SessionPaths.taskItem, {
      params: TaskParams,
      query: WorkspaceRoutingQuery,
      success: SessionTask.Info,
      error: TaskErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("sessionPrompt", "/api/session/:sessionID/prompt", {
      params: SessionParams,
      payload: JsonPayload,
      success: Json,
    }),
  )
  .add(
    HttpApiEndpoint.post("sessionCompact", "/api/session/:sessionID/compact", {
      params: SessionParams,
      payload: JsonPayload,
      success: Json,
    }),
  )
  .add(
    HttpApiEndpoint.post("sessionCommand", "/api/session/:sessionID/command", {
      params: SessionParams,
      payload: JsonPayload,
      success: NoContent,
      error: Unsupported,
    }),
  )
  .add(
    HttpApiEndpoint.post("sessionGenerate", "/api/session/:sessionID/generate", {
      params: SessionParams,
      payload: Schema.Struct({ prompt: Schema.String }),
      success: Json,
    }),
  )
  .add(
    HttpApiEndpoint.post("sessionSwitchAgent", "/api/session/:sessionID/agent", {
      params: SessionParams,
      payload: Schema.Struct({ agent: Schema.String, model: Schema.optional(Model.Selection) }),
      success: NoContent,
      error: InvalidRequestError,
    }),
  )
  .add(
    HttpApiEndpoint.post("sessionSwitchModel", "/api/session/:sessionID/model", {
      params: SessionParams,
      payload: Schema.Struct({ model: Model.Selection }),
      success: NoContent,
      error: InvalidRequestError,
    }),
  )
  .add(
    HttpApiEndpoint.post("sessionSelectExecutor", "/api/session/:sessionID/executor", {
      params: SessionParams,
      payload: Session.ExecutorPreference,
      success: Json,
      error: [MockNotFound.pipe(HttpApiSchema.status(404)), InvalidRequestError],
    }),
  )
  .add(
    HttpApiEndpoint.delete("sessionInboxCancel", "/api/session/:sessionID/inbox/:inboxID", {
      params: { ...SessionParams, inboxID: Schema.String },
      success: NoContent,
    }),
  )
  .add(
    HttpApiEndpoint.patch("sessionInboxUpdate", "/api/session/:sessionID/inbox/:inboxID", {
      params: { ...SessionParams, inboxID: Schema.String },
      payload: Schema.Struct({ delivery: Schema.Literals(["steer", "queue"]) }),
      success: NoContent,
    }),
  )
  .add(
    HttpApiEndpoint.get("sessionPermission", "/api/session/:sessionID/permission", {
      params: SessionParams,
      success: Json,
    }),
  )
  .add(
    HttpApiEndpoint.post("sessionPermissionReply", "/api/session/:sessionID/permission/:permissionID/reply", {
      params: { ...SessionParams, permissionID: Schema.String },
      payload: JsonPayload,
      success: NoContent,
      error: Unsupported,
    }),
  )
  .add(
    HttpApiEndpoint.patch("sessionRename", "/api/session/:sessionID", {
      params: SessionParams,
      payload: JsonPayload,
      success: NoContent,
    }),
  )
  .add(
    HttpApiEndpoint.post("sessionInterrupt", "/api/session/:sessionID/interrupt", {
      params: SessionParams,
      success: Json,
    }),
  )
  .add(
    HttpApiEndpoint.post("sessionWait", "/api/experimental/session/:sessionID/wait", {
      params: SessionParams,
      success: NoContent,
    }),
  )
  .add(
    HttpApiEndpoint.post("sessionRevertStage", "/api/session/:sessionID/revert/stage", {
      params: SessionParams,
      payload: JsonPayload,
      success: Json,
      error: MockBadRequest.pipe(HttpApiSchema.status(400)),
    }),
  )
  .add(
    HttpApiEndpoint.delete("sessionRevertClear", "/api/session/:sessionID/revert", {
      params: SessionParams,
      success: NoContent,
    }),
  )
  .add(
    HttpApiEndpoint.post("sessionRevertCommit", "/api/session/:sessionID/revert/commit", {
      params: SessionParams,
      success: NoContent,
    }),
  )
  .add(
    HttpApiEndpoint.get("messageGet", "/api/session/:sessionID/message/:messageID", {
      params: { ...SessionParams, messageID: Schema.String },
      success: Json,
      error: MockNotFound.pipe(HttpApiSchema.status(404)),
    }),
  )
  .add(
    HttpApiEndpoint.get("messageList", "/api/session/:sessionID/message", {
      params: SessionParams,
      query: Query,
      success: Json,
      error: MockBadRequest.pipe(HttpApiSchema.status(400)),
    }),
  )

export const MockApi = HttpApi.make("mock").add(Group)
