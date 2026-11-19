import { Session } from "@aigcfroge/core/session"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { SessionIdentityProjection } from "@aigcfroge/core/session/session-identity"
import { LocationServiceMap } from "@aigcfroge/core/location-services"
import { SessionTask } from "@aigcfroge/core/session/task"
import { Database } from "@aigcfroge/core/database/database"
import { getCacheDiagnostics } from "@aigcfroge/core/session/cache-diagnostics"
import { MetaAgentService } from "@aigcfroge/core/meta-agent/service"
import { MetaAgentMemory } from "@aigcfroge/core/agent/meta/memory"
import { MetaAgent } from "@aigcfroge/schema/meta-agent"
import { SessionTodo } from "@aigcfroge/core/session/todo"
import { WorkflowRun } from "@aigcfroge/core/workflow/workflow-run"
import { WorkflowExecution } from "@aigcfroge/core/workflow/execution"
import {
  ApiNotFoundError,
  ConflictError,
  ForbiddenError,
  InvalidRequestError,
  UnsupportedProductModeError,
} from "@aigcfroge/protocol/errors"
import { WorkspaceRouteContext } from "@aigcfroge/protocol/middleware/workspace-routing"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import {
  SessionInstanceCacheDiagnostics,
  SessionInstanceStepCacheStats,
} from "@aigcfroge/protocol/groups/session-instance"
import { HttpApiBuilder } from "effect/http-api"
import { Effect } from "effect"
import { Api } from "../api"
import { locationRefForRoute } from "../middleware/workspace-routing"

/**
 * Remaining R1b transitional stubs: contracts are live
 * and the client is generated; handlers arrive with the R2 session port. Fail
 * closed with kind "not_implemented"; deleted as the R2 slices land.
 */
const failClosed = (group: string, name: string) =>
  Effect.fail(
    new InvalidRequestError({
      message: `${group}.${name} is not implemented until the R2 session port`,
      kind: "not_implemented",
    }),
  )

export const SessionInstanceHandler = HttpApiBuilder.group(Api, "session-instance", (handlers) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const tasks = yield* SessionTask.Service
    const todos = yield* SessionTodo.Service
    const compositions = yield* SessionComposition.Service
    const workflows = yield* WorkflowRun.Service
    const execution = yield* WorkflowExecution.Service
    const database = yield* Database.Service
    const metas = yield* MetaAgentService.Service
    const memories = yield* MetaAgentMemory.Service
    const locations = yield* LocationServiceMap.Service
    const requireSession = Effect.fn("SessionTaskHttp.requireSession")(function* (sessionID: Session.ID) {
      const route = locationRefForRoute(yield* WorkspaceRouteContext)
      const session = yield* sessions
        .get(sessionID)
        .pipe(Effect.mapError(() => notFound(`Session not found: ${sessionID}`)))
      const owner = locationRefForRoute(session.location)
      if (owner.directory !== route.directory || owner.workspaceID !== route.workspaceID)
        return yield* notFound(`Session not found: ${sessionID}`)
      return session
    })

    return handlers
      .handle("list", () => failClosed("session-instance", "list"))
      .handle("status", () => failClosed("session-instance", "status"))
      .handle("get", () => failClosed("session-instance", "get"))
      .handle("children", () => failClosed("session-instance", "children"))
      .handle("identity", ({ params }) =>
        Effect.gen(function* () {
          const session = yield* requireSession(params.sessionID)
          const context = yield* locations
            .contextEffect(session.location)
            .pipe(Effect.mapError((error) => notFound(`Location not found: ${error.directory}`)))
          return yield* Effect.gen(function* () {
            const identities = yield* SessionIdentityProjection.Service
            return yield* identities.project(session.id).pipe(
              Effect.catchTag("Session.NotFoundError", () => notFound(`Session not found: ${session.id}`)),
              Effect.catchTag(
                "SessionIdentity.IdentityFieldMissing",
                (error) =>
                  new ConflictError({
                    resource: error.sessionID,
                    message: `Session identity field missing: ${error.field}`,
                  }),
              ),
              Effect.catchTag("SessionIdentity.SnapshotUnavailable", (error) =>
                notFound(`Snapshot not found for session ${error.sessionID}`),
              ),
              Effect.catchTag(
                "SessionComposition.SnapshotDecodeError",
                (error) =>
                  new ConflictError({ resource: error.sessionID, message: "Invalid Session composition snapshot" }),
              ),
              Effect.catchTag("Permission.BlockedError", (error) => new ForbiddenError({ message: error.message })),
            )
          }).pipe(Effect.provideContext(context))
        }),
      )
      .handle("todo", ({ params }) =>
        Effect.gen(function* () {
          yield* requireSession(params.sessionID)
          return yield* todos.get(params.sessionID)
        }),
      )
      .handle("task", ({ params, payload }) =>
        Effect.gen(function* () {
          yield* requireSession(params.sessionID)
          return yield* tasks.update({ sessionID: params.sessionID, tasks: payload }).pipe(Effect.mapError(invalidTask))
        }),
      )
      .handle("getTask", ({ params }) =>
        Effect.gen(function* () {
          yield* requireSession(params.sessionID)
          return yield* tasks.get(params.sessionID)
        }),
      )
      .handle("patchTask", ({ params, payload }) =>
        Effect.gen(function* () {
          yield* requireSession(params.sessionID)
          const prior = (yield* tasks.get(params.sessionID)).find((task) => task.id === params.taskID)
          if (!prior) return yield* notFound(`Task not found: ${params.taskID}`)
          if (payload.status === undefined && payload.content === undefined && payload.priority === undefined)
            return yield* new InvalidRequestError({ message: "At least one task field is required" })
          if (payload.expectedRevision !== undefined && payload.expectedRevision !== prior.revision)
            return yield* new InvalidRequestError({
              message: "Task changed since the caller last read it",
              kind: "stale_revision",
            })
          const updated = yield* tasks
            .updateTask({
              sessionID: params.sessionID,
              id: params.taskID,
              status: payload.status,
              content: payload.content,
              priority: payload.priority,
              expectedRevision: payload.expectedRevision,
            })
            .pipe(Effect.mapError(invalidTask))
          if (updated) return updated
          if (!(yield* tasks.get(params.sessionID)).some((task) => task.id === params.taskID))
            return yield* notFound(`Task not found: ${params.taskID}`)
          return yield* new InvalidRequestError({
            message: "Task changed since the caller last read it",
            kind: "stale_revision",
          })
        }),
      )
      .handle("createTask", ({ params, payload }) =>
        Effect.gen(function* () {
          yield* requireSession(params.sessionID)
          const created = (yield* tasks
            .append({ sessionID: params.sessionID, tasks: [payload] })
            .pipe(Effect.mapError(invalidTask))).at(-1)
          if (!created) return yield* Effect.die(new Error("SessionTask.append returned no created task"))
          return created
        }),
      )
      .handle("deleteTask", ({ params }) =>
        Effect.gen(function* () {
          yield* requireSession(params.sessionID)
          const deleted = yield* tasks
            .removeTask({ sessionID: params.sessionID, id: params.taskID })
            .pipe(Effect.mapError(invalidTask))
          if (!deleted) return yield* notFound(`Task not found: ${params.taskID}`)
          return deleted
        }),
      )
      .handle("reorderTask", ({ params, payload }) =>
        Effect.gen(function* () {
          yield* requireSession(params.sessionID)
          return yield* tasks.reorder({ sessionID: params.sessionID, ...payload }).pipe(Effect.mapError(invalidTask))
        }),
      )
      .handle("dispatchTask", ({ params, payload }) =>
        Effect.gen(function* () {
          yield* requireSession(params.sessionID)
          return yield* sessions.dispatchTask({ sessionID: params.sessionID, request: payload }).pipe(
            Effect.catchTag("Session.NotFoundError", (error) => notFound(`Session not found: ${error.sessionID}`)),
            Effect.catchTag("SessionTask.TaskWriteError", invalidTask),
            Effect.catchTag("SessionTask.OperationConflictError", operationConflict),
            Effect.catchTag(
              "Session.ControllerConflictError",
              (error) => new InvalidRequestError({ message: error.message, field: error.field, kind: error.kind }),
            ),
          )
        }),
      )
      .handle("taskOperations", ({ params, query }) =>
        Effect.gen(function* () {
          yield* requireSession(params.sessionID)
          return yield* tasks.operations({ sessionID: params.sessionID, taskID: query.taskID })
        }),
      )
      .handle("taskOperation", ({ params }) =>
        Effect.gen(function* () {
          yield* requireSession(params.sessionID)
          const operation = yield* tasks.operation(params)
          if (!operation) return yield* notFound(`Task operation not found: ${params.operationID}`)
          return operation
        }),
      )
      .handle("cancelTaskOperation", ({ params }) =>
        Effect.gen(function* () {
          yield* requireSession(params.sessionID)
          return yield* sessions.cancelTaskOperation(params).pipe(
            Effect.catchTag("Session.NotFoundError", (error) => notFound(`Session not found: ${error.sessionID}`)),
            Effect.catchTag("SessionTask.OperationConflictError", operationConflict),
          )
        }),
      )
      .handle("diff", () => failClosed("session-instance", "diff"))
      .handle("messages", () => failClosed("session-instance", "messages"))
      .handle("message", () => failClosed("session-instance", "message"))
      .handle("create", () => failClosed("session-instance", "create"))
      .handle("remove", () => failClosed("session-instance", "remove"))
      .handle("update", () => failClosed("session-instance", "update"))
      .handle("fork", () => failClosed("session-instance", "fork"))
      .handle("abort", () => failClosed("session-instance", "abort"))
      .handle("init", () => failClosed("session-instance", "init"))
      .handle("share", () => failClosed("session-instance", "share"))
      .handle("unshare", () => failClosed("session-instance", "unshare"))
      .handle("summarize", () => failClosed("session-instance", "summarize"))
      .handle("prompt", () => failClosed("session-instance", "prompt"))
      .handle("promptAsync", () => failClosed("session-instance", "promptAsync"))
      .handle("command", () => failClosed("session-instance", "command"))
      .handle("shell", () => failClosed("session-instance", "shell"))
      .handle("revert", () => failClosed("session-instance", "revert"))
      .handle("unrevert", () => failClosed("session-instance", "unrevert"))
      .handle("permissionRespond", () => failClosed("session-instance", "permissionRespond"))
      .handle("getPermissionOverride", () => failClosed("session-instance", "getPermissionOverride"))
      .handle("putPermissionOverride", () => failClosed("session-instance", "putPermissionOverride"))
      .handle("deletePermissionOverride", () => failClosed("session-instance", "deletePermissionOverride"))
      .handle("deleteMessage", () => failClosed("session-instance", "deleteMessage"))
      .handle("deletePart", () => failClosed("session-instance", "deletePart"))
      .handle("updatePart", () => failClosed("session-instance", "updatePart"))
      .handle("cacheDiagnostics", ({ params }) =>
        Effect.gen(function* () {
          yield* requireSession(params.sessionID)
          const value = yield* getCacheDiagnostics(database.db, params.sessionID).pipe(Effect.orDie)
          return new SessionInstanceCacheDiagnostics({
            ...value,
            perStep: value.perStep.map((step) => new SessionInstanceStepCacheStats(step)),
          })
        }),
      )
      .handle("meta", ({ params }) =>
        Effect.gen(function* () {
          const session = yield* requireSession(params.sessionID)
          if (!session.controller) return new MetaAgent.Read({ sessions: [] })
          yield* metas
            .assertOwner(session)
            .pipe(Effect.mapError((error) => new InvalidRequestError({ message: error.message })))
          return new MetaAgent.Read({
            owner: yield* metas.get(session.controller.metaAgentID),
            controller: session.controller,
            sessions: yield* metas.sessions(session.controller.metaAgentID),
            stats: yield* metas.stats(session.controller.metaAgentID),
          })
        }),
      )
      .handle("projectMemory", ({ params, query }) =>
        Effect.gen(function* () {
          const session = yield* requireSession(params.sessionID)
          const records =
            query.keyword === undefined
              ? yield* memories.query({ projectID: session.projectID, factCategory: query.category })
              : yield* memories.search({ projectID: session.projectID, keyword: query.keyword })
          return query.category === undefined
            ? records
            : records.filter((record) => record.factCategory === query.category)
        }),
      )
      .handle("removeProjectMemory", ({ params }) =>
        Effect.gen(function* () {
          const session = yield* requireSession(params.sessionID)
          yield* memories.remove(params.id, session.projectID)
        }),
      )
      .handle("toolSummary", () => failClosed("session-instance", "toolSummary"))
      .handle("composition", ({ params }) =>
        Effect.gen(function* () {
          yield* requireSession(params.sessionID)
          return yield* compositions.get(params.sessionID).pipe(
            Effect.catchTag("SessionComposition.SnapshotNotFoundError", () =>
              notFound(`Snapshot not found for session ${params.sessionID}`),
            ),
            Effect.catchTag(
              "SessionComposition.SnapshotDecodeError",
              () => new InvalidRequestError({ message: "Invalid Session composition snapshot" }),
            ),
          )
        }),
      )
      .handle("workflow", ({ params, query }) =>
        Effect.gen(function* () {
          yield* requireSession(params.sessionID)
          const run =
            query.runID === undefined
              ? yield* workflows.getBySession(params.sessionID)
              : yield* workflows
                  .get(query.runID)
                  .pipe(Effect.mapError((error) => notFound(`Workflow run not found: ${error.runID}`)))
          if (run && run.sessionID !== params.sessionID)
            return yield* notFound(`Workflow run not found: ${query.runID}`)
          return new WorkflowAsset.WorkflowStatusResponse({
            run,
            steps: run === undefined ? [] : yield* workflows.getSteps(run.id),
          })
        }),
      )
      .handle("workflowRun", ({ params, payload }) =>
        Effect.gen(function* () {
          yield* requireSession(params.sessionID)
          return yield* execution.run({ ...params, ...payload }).pipe(Effect.mapError(workflowError))
        }),
      )
      .handle("workflowCancelRun", ({ params, payload }) =>
        Effect.gen(function* () {
          yield* requireSession(params.sessionID)
          return yield* execution.cancelRun({ ...params, ...payload }).pipe(Effect.mapError(workflowError))
        }),
      )
      .handle("workflowCancelStep", ({ params, payload }) =>
        Effect.gen(function* () {
          yield* requireSession(params.sessionID)
          return yield* execution.cancelStep({ ...params, ...payload }).pipe(Effect.mapError(workflowError))
        }),
      )
      .handle("workflowRetryStep", ({ params, payload }) =>
        Effect.gen(function* () {
          yield* requireSession(params.sessionID)
          return yield* execution.retryStep({ ...params, ...payload }).pipe(Effect.mapError(workflowError))
        }),
      )
  }),
)

function notFound(message: string) {
  return new ApiNotFoundError({ name: "NotFoundError", data: { message } })
}

function invalidTask(error: SessionTask.TaskWriteError) {
  return new InvalidRequestError({ message: error.message, kind: error.reason })
}

function operationConflict(
  error: SessionTask.OperationConflictError,
): Effect.Effect<never, ApiNotFoundError | ConflictError> {
  if (error.reason === "operation_missing") return notFound(`Task operation not found: ${error.operationID}`)
  return new ConflictError({ resource: error.operationID, message: `Task operation conflict: ${error.reason}` })
}

function workflowError(error: WorkflowExecution.Error) {
  if (error._tag === "Session.NotFoundError") return notFound(`Session not found: ${error.sessionID}`)
  if (error._tag === "WorkflowRun.WorkflowNotFoundError") return notFound(`Workflow run not found: ${error.runID}`)
  if (error._tag === "WorkflowRun.StepNotFoundError") return notFound(`Workflow step not found: ${error.stepRunID}`)
  if (error._tag === "SessionComposition.SnapshotNotFoundError")
    return notFound(`Snapshot not found for session ${error.sessionID}`)
  if (error._tag === "UnsupportedProductModeError")
    return new UnsupportedProductModeError({ mode: error.mode, message: error.message })
  if (error._tag === "WorkflowExecution.ConflictError")
    return new ConflictError({ resource: error.sessionID, message: `Workflow conflict: ${error.reason}` })
  if (error._tag === "WorkflowRun.RequestConflictError")
    return new ConflictError({ resource: error.requestID, message: error.message })
  if (error._tag === "WorkflowRun.InvalidStateTransitionError")
    return new ConflictError({ resource: "workflow", message: error.message })
  if (error._tag === "WorkflowExecution.InvalidError")
    return new InvalidRequestError({ message: `Invalid workflow request: ${error.reason}`, kind: error.reason })
  return new InvalidRequestError({ message: `Workflow unavailable: ${error._tag}` })
}
