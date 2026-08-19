import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionInput } from "@aigcfroge/core/session/input"
import { Prompt } from "@aigcfroge/core/session/prompt"
import { SessionV2 } from "@aigcfroge/core/session"
import { ProjectV2 } from "@aigcfroge/core/project"
import { AbsolutePath, PositiveInt, RelativePath, withStatics } from "@aigcfroge/core/schema"
import { WorkspaceV2 } from "@aigcfroge/core/workspace"
import { Schema, Struct } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import {
  ConflictError,
  InvalidCursorError,
  InvalidRequestError,
  ServiceUnavailableError,
  SessionNotFoundError,
  UnknownError,
  UnsupportedProductModeError,
  CompositionResolveError,
} from "../errors"
import { SessionLocationMiddleware } from "../middleware/session-location"
import { AgentV2 } from "@aigcfroge/core/agent"
import { ModelV2 } from "@aigcfroge/core/model"
import { Location } from "@aigcfroge/core/location"
import { ProductMode } from "@aigcfroge/schema/product-mode"
import { Composition } from "@aigcfroge/schema/composition"

const SessionsQueryFields = {
  workspace: WorkspaceV2.ID.pipe(Schema.optional),
  mode: ProductMode.ID.pipe(Schema.optional),
  limit: Schema.NumberFromString.pipe(Schema.decodeTo(PositiveInt), Schema.optional).annotate({
    description: "Maximum number of sessions to return. Defaults to the newest 50 sessions.",
  }),
  order: Schema.optional(Schema.Union([Schema.Literal("asc"), Schema.Literal("desc")])).annotate({
    description: "Session order for the first page. Use desc for newest first or asc for oldest first.",
  }),
  search: Schema.optional(Schema.String),
}

const SessionsDirectoryQuery = Schema.Struct({
  ...SessionsQueryFields,
  directory: AbsolutePath,
})

const SessionsProjectQuery = Schema.Struct({
  ...SessionsQueryFields,
  project: ProjectV2.ID,
  subpath: RelativePath.pipe(Schema.optional),
})

const SessionsAllQuery = Schema.Struct(SessionsQueryFields)

const withCursor = <Fields extends Schema.Struct.Fields>(schema: Schema.Struct<Fields>) =>
  schema.mapFields((fields) => ({
    ...Struct.omit(fields, ["limit"]),
    anchor: SessionV2.ListAnchor,
  }))

const SessionsCursorInput = Schema.Union([
  withCursor(SessionsDirectoryQuery),
  withCursor(SessionsProjectQuery),
  withCursor(SessionsAllQuery),
])
const SessionsCursorJson = Schema.fromJsonString(SessionsCursorInput)
const encodeSessionsCursor = Schema.encodeSync(SessionsCursorJson)
const decodeSessionsCursor = Schema.decodeUnknownEffect(SessionsCursorJson)

export const SessionsCursor = Schema.String.pipe(
  Schema.brand("SessionsCursor"),
  withStatics((schema) => {
    const make = schema.make
    return {
      make: (input: typeof SessionsCursorInput.Type) =>
        make(Buffer.from(encodeSessionsCursor(input)).toString("base64url")),
      parse: (input: string) => decodeSessionsCursor(Buffer.from(input, "base64url").toString("utf8")),
    }
  }),
)
export type SessionsCursor = typeof SessionsCursor.Type

const SessionsCursorQuery = Schema.Struct({
  cursor: SessionsCursor.annotate({
    description: "Opaque pagination cursor returned as cursor.previous or cursor.next in the previous response.",
  }),
  limit: SessionsQueryFields.limit,
})

export const SessionsQuery = Schema.Struct({
  ...SessionsQueryFields,
  directory: AbsolutePath.pipe(Schema.optional),
  project: ProjectV2.ID.pipe(Schema.optional),
  subpath: RelativePath.pipe(Schema.optional),
  cursor: SessionsCursorQuery.fields.cursor.pipe(Schema.optional),
}).annotate({ identifier: "SessionsQuery" })

export const SessionGroup = HttpApiGroup.make("server.session")
  .add(
    HttpApiEndpoint.get("session.list", "/api/session", {
      query: SessionsQuery,
      success: Schema.Struct({
        data: Schema.Array(SessionV2.Info),
        cursor: Schema.Struct({
          previous: SessionsCursor.pipe(Schema.optional),
          next: SessionsCursor.pipe(Schema.optional),
        }),
      }).annotate({ identifier: "SessionsResponse" }),
      error: [InvalidCursorError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.session.list",
        summary: "List sessions",
        description:
          "Retrieve sessions in the requested order. Items keep that order across pages; use cursor.next or cursor.previous to move through the ordered list.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("session.create", "/api/session", {
      payload: Schema.Struct({
        id: SessionV2.ID.pipe(Schema.optional),
        parentID: SessionV2.ID.pipe(Schema.optional),
        mode: ProductMode.ID.pipe(Schema.optional),
        agent: AgentV2.ID.pipe(Schema.optional),
        model: ModelV2.Ref.pipe(Schema.optional),
        location: Location.Ref.pipe(Schema.optional),
      }),
      success: Schema.Struct({ data: SessionV2.Info }),
      error: [UnsupportedProductModeError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.session.create",
        summary: "Create session",
        description: "Create a session at the requested location.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("session.custom", "/api/session/custom", {
      payload: Schema.Struct({
        id: SessionV2.ID.pipe(Schema.optional),
        composition: Composition.CompositionInput,
        expectedPlanDigest: Composition.Digest.pipe(Schema.optional),
        location: Location.Ref.pipe(Schema.optional),
        title: Schema.String.pipe(Schema.optional),
      }),
      success: Schema.Struct({
        data: SessionV2.Info,
        snapshot: Composition.Snapshot,
      }),
      error: [UnsupportedProductModeError, InvalidRequestError, ConflictError, CompositionResolveError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.session.custom",
        summary: "Create custom session",
        description: "Atomically freeze composition into an immutable snapshot and create a custom session.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("session.get", "/api/session/:sessionID", {
      params: { sessionID: SessionV2.ID },
      success: Schema.Struct({ data: SessionV2.Info }),
      error: [SessionNotFoundError, InvalidRequestError, UnsupportedProductModeError],
    })
      .middleware(SessionLocationMiddleware)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.session.get",
          summary: "Get session",
          description: "Retrieve a session by ID.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("session.switchAgent", "/api/session/:sessionID/agent", {
      params: { sessionID: SessionV2.ID },
      payload: Schema.Struct({ agent: AgentV2.ID }),
      success: HttpApiSchema.NoContent,
      error: [SessionNotFoundError, InvalidRequestError, UnsupportedProductModeError],
    })
      .middleware(SessionLocationMiddleware)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.session.switchAgent",
          summary: "Switch session agent",
          description: "Switch the agent used by subsequent provider turns.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("session.switchModel", "/api/session/:sessionID/model", {
      params: { sessionID: SessionV2.ID },
      payload: Schema.Struct({ model: ModelV2.Ref }),
      success: HttpApiSchema.NoContent,
      error: [SessionNotFoundError, InvalidRequestError, UnsupportedProductModeError],
    })
      .middleware(SessionLocationMiddleware)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.session.switchModel",
          summary: "Switch session model",
          description: "Switch the model used by subsequent provider turns.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("session.prompt", "/api/session/:sessionID/prompt", {
      params: { sessionID: SessionV2.ID },
      payload: Schema.Struct({
        id: SessionMessage.ID.pipe(Schema.optional),
        prompt: Prompt,
        delivery: SessionInput.Delivery.pipe(Schema.optional),
        resume: Schema.Boolean.pipe(Schema.optional),
      }),
      success: Schema.Struct({ data: SessionInput.Admitted }),
      error: [ConflictError, SessionNotFoundError, InvalidRequestError, UnsupportedProductModeError],
    })
      .middleware(SessionLocationMiddleware)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.session.prompt",
          summary: "Send message",
          description: "Durably admit one session input and schedule agent-loop execution unless resume is false.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("session.compact", "/api/session/:sessionID/compact", {
      params: { sessionID: SessionV2.ID },
      success: HttpApiSchema.NoContent,
      error: [SessionNotFoundError, ServiceUnavailableError, InvalidRequestError, UnsupportedProductModeError],
    })
      .middleware(SessionLocationMiddleware)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.session.compact",
          summary: "Compact session",
          description: "Compact a session conversation.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("session.wait", "/api/session/:sessionID/wait", {
      params: { sessionID: SessionV2.ID },
      success: HttpApiSchema.NoContent,
      error: [SessionNotFoundError, ServiceUnavailableError, InvalidRequestError, UnsupportedProductModeError],
    })
      .middleware(SessionLocationMiddleware)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.session.wait",
          summary: "Wait for session",
          description: "Wait for a session agent loop to become idle.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("session.context", "/api/session/:sessionID/context", {
      params: { sessionID: SessionV2.ID },
      success: Schema.Struct({ data: Schema.Array(SessionMessage.Message) }),
      error: [SessionNotFoundError, UnknownError, InvalidRequestError, UnsupportedProductModeError],
    })
      .middleware(SessionLocationMiddleware)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.session.context",
          summary: "Get session context",
          description: "Retrieve the active context messages for a session (all messages after the last compaction).",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("session.children", "/api/session/:sessionID/children", {
      params: { sessionID: SessionV2.ID },
      success: Schema.Struct({ data: Schema.Array(SessionV2.Info) }),
      error: [SessionNotFoundError, InvalidRequestError, UnsupportedProductModeError],
    })
      .middleware(SessionLocationMiddleware)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.session.children",
          summary: "List child sessions",
          description: "List sessions forked or spawned from this session.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("session.skill", "/api/session/:sessionID/skill", {
      params: { sessionID: SessionV2.ID },
      payload: Schema.Struct({
        id: SessionMessage.ID.pipe(Schema.optional),
        skill: Schema.String,
        resume: Schema.Boolean.pipe(Schema.optional),
      }),
      success: Schema.Struct({ data: SessionInput.Admitted }),
      error: [ConflictError, SessionNotFoundError, InvalidRequestError, UnsupportedProductModeError],
    })
      .middleware(SessionLocationMiddleware)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.session.skill",
          summary: "Invoke skill",
          description:
            "Admit a slash-command skill invocation to the durable inbox. The runner resolves the skill at the next promotion boundary and delivers it as a synthetic user turn.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("session.shell", "/api/session/:sessionID/shell", {
      params: { sessionID: SessionV2.ID },
      payload: Schema.Struct({
        id: SessionMessage.ID.pipe(Schema.optional),
        command: Schema.String,
        resume: Schema.Boolean.pipe(Schema.optional),
      }),
      success: Schema.Struct({ data: SessionInput.Admitted }),
      error: [ConflictError, SessionNotFoundError, InvalidRequestError, UnsupportedProductModeError],
    })
      .middleware(SessionLocationMiddleware)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.session.shell",
          summary: "Run shell command",
          description:
            "Admit a user-run shell command to the durable inbox. The runner drains queued shell inputs at the next idle boundary, publishing shell.started and shell.ended events.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("session.interrupt", "/api/session/:sessionID/interrupt", {
      params: { sessionID: SessionV2.ID },
      success: HttpApiSchema.NoContent,
      error: [SessionNotFoundError, InvalidRequestError, UnsupportedProductModeError],
    })
      .middleware(SessionLocationMiddleware)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.session.interrupt",
          summary: "Interrupt session execution",
          description: "Interrupt active execution owned by this process. Idle interruption is a no-op.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("session.share", "/api/session/:sessionID/share", {
      params: { sessionID: SessionV2.ID },
      payload: Schema.Struct({
        targetSessionID: SessionV2.ID,
        scope: Schema.Literals(["reference", "output", "full"]),
        trigger: Schema.Boolean.pipe(Schema.optional),
      }),
      success: HttpApiSchema.NoContent,
      error: [SessionNotFoundError, InvalidRequestError, UnsupportedProductModeError],
    })
      .middleware(SessionLocationMiddleware)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.session.share",
          summary: "Share session content",
          description:
            "Share context from this session into another session. Scope controls what is shared: reference (session link), output (last assistant result), full (entire history).",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("session.fork", "/api/session/:sessionID/fork", {
      params: { sessionID: SessionV2.ID },
      payload: Schema.Struct({
        prompt: Schema.String.pipe(Schema.optional),
        agent: Schema.String.pipe(Schema.optional),
      }),
      success: Schema.Struct({ sessionID: SessionV2.ID }),
      error: [SessionNotFoundError, InvalidRequestError, UnsupportedProductModeError],
    })
      .middleware(SessionLocationMiddleware)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.session.fork",
          summary: "Fork a session",
          description: "Create a new session that inherits the full context of the source session.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "sessions",
      description: "Experimental session routes.",
    }),
  )
