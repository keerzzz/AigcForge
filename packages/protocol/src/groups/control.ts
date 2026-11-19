import { Provider } from "@aigcfroge/schema/provider"
import { NonNegativeInt } from "@aigcfroge/schema/schema"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { InvalidRequestError } from "../errors.js"
import { Authorization } from "../middleware/authorization.js"
import { described } from "./metadata.js"

// Fork-retained control surface (see prompt-asset.ts for the conventions).
const AuthParams = Schema.Struct({
  providerID: Provider.ID,
})

const LogQuery = Schema.Struct({
  directory: Schema.optional(Schema.String),
  workspace: Schema.optional(Schema.String),
})

export const ControlLogInput = Schema.Struct({
  service: Schema.String.annotate({ description: "Service name for the log entry" }),
  level: Schema.Union([
    Schema.Literal("debug"),
    Schema.Literal("info"),
    Schema.Literal("error"),
    Schema.Literal("warn"),
  ]).annotate({ description: "Log level" }),
  message: Schema.String.annotate({ description: "Log message" }),
  extra: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({
    description: "Additional metadata for the log entry",
  }),
}).annotate({ identifier: "Control.LogInput" })

/** Lifted from the fork entry Auth.Info: stored credential shapes. */
export class ControlAuthOauth extends Schema.Class<ControlAuthOauth>("OAuth")({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  accountId: Schema.optional(Schema.String),
  enterpriseUrl: Schema.optional(Schema.String),
}) {}

export class ControlAuthApi extends Schema.Class<ControlAuthApi>("ApiAuth")({
  type: Schema.Literal("api"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export class ControlAuthWellKnown extends Schema.Class<ControlAuthWellKnown>("WellKnownAuth")({
  type: Schema.Literal("wellknown"),
  key: Schema.String,
  token: Schema.String,
}) {}

export const ControlAuthInfo = Schema.Union([ControlAuthOauth, ControlAuthApi, ControlAuthWellKnown]).annotate({
  discriminator: "type",
  identifier: "Auth",
})

export const ControlGroup = HttpApiGroup.make("control")
  .add(
    HttpApiEndpoint.put("control.authSet", "/auth/:providerID", {
      params: AuthParams,
      payload: ControlAuthInfo,
      success: described(Schema.Boolean, "Successfully set authentication credentials"),
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "auth.set",
        summary: "Set auth credentials",
        description: "Set authentication credentials",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("control.authRemove", "/auth/:providerID", {
      params: AuthParams,
      success: described(Schema.Boolean, "Successfully removed authentication credentials"),
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "auth.remove",
        summary: "Remove auth credentials",
        description: "Remove authentication credentials",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("control.log", "/log", {
      query: LogQuery,
      payload: ControlLogInput,
      success: described(Schema.Boolean, "Log entry written successfully"),
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "app.log",
        summary: "Write log",
        description: "Write a log entry to the server logs with specified level and metadata.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "control", description: "Control plane routes." }))
  .middleware(Authorization)
