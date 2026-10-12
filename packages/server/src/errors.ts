import { Effect, Schema } from "effect"
import { Composition } from "@aigcfroge/schema/composition"
import { optionalOmitUndefined } from "@aigcfroge/schema/schema"
import { SessionLegacyHistory } from "@aigcfroge/core/session/legacy-history"

export class InvalidRequestError extends Schema.TaggedErrorClass<InvalidRequestError>()(
  "InvalidRequestError",
  {
    message: Schema.String,
    kind: Schema.optional(Schema.String),
    field: Schema.optional(Schema.String),
  },
  { httpApiStatus: 400 },
) {}

// Legacy adoption currently rejects unsupported shapes as defects. Translate only
// that domain error; raw transcript content and unrelated defects stay out of 400s.
export const mapUnsupportedHistory = Effect.catchDefect((error) => {
  if (!(error instanceof SessionLegacyHistory.ImportError)) return Effect.die(error)
  return new InvalidRequestError({
    message: "This session's legacy history cannot be adopted. Its source history has been preserved.",
    kind: "unsupported-history",
    field: "sessionID",
  })
})

export class UnauthorizedError extends Schema.TaggedErrorClass<UnauthorizedError>()(
  "UnauthorizedError",
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}

export class ConflictError extends Schema.TaggedErrorClass<ConflictError>()(
  "ConflictError",
  {
    message: Schema.String,
    resource: Schema.optional(Schema.String),
  },
  { httpApiStatus: 409 },
) {}

export class ServiceUnavailableError extends Schema.TaggedErrorClass<ServiceUnavailableError>()(
  "ServiceUnavailableError",
  {
    message: Schema.String,
    service: Schema.optional(Schema.String),
  },
  { httpApiStatus: 503 },
) {}

export class WorkReviewUnavailableError extends Schema.TaggedErrorClass<WorkReviewUnavailableError>()(
  "WorkReviewUnavailableError",
  {
    message: Schema.String,
    code: Schema.Literals(["storage", "notification"]),
    committedRevision: optionalOmitUndefined(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  },
  { httpApiStatus: 503 },
) {}

export class UnknownError extends Schema.TaggedErrorClass<UnknownError>()(
  "UnknownError",
  {
    message: Schema.String,
    ref: Schema.optional(Schema.String),
  },
  { httpApiStatus: 500 },
) {}

export class ProviderNotFoundError extends Schema.TaggedErrorClass<ProviderNotFoundError>()(
  "ProviderNotFoundError",
  {
    providerID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class SessionNotFoundError extends Schema.TaggedErrorClass<SessionNotFoundError>()(
  "SessionNotFoundError",
  {
    sessionID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class InvalidCursorError extends Schema.TaggedErrorClass<InvalidCursorError>()(
  "InvalidCursorError",
  { message: Schema.String },
  { httpApiStatus: 400 },
) {}

export class GrantNotFoundError extends Schema.TaggedErrorClass<GrantNotFoundError>()(
  "GrantNotFoundError",
  {
    grantID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class PermissionNotFoundError extends Schema.TaggedErrorClass<PermissionNotFoundError>()(
  "PermissionNotFoundError",
  {
    requestID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class QuestionNotFoundError extends Schema.TaggedErrorClass<QuestionNotFoundError>()(
  "QuestionNotFoundError",
  {
    requestID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class ForbiddenError extends Schema.TaggedErrorClass<ForbiddenError>()(
  "ForbiddenError",
  { message: Schema.String },
  { httpApiStatus: 403 },
) {}

export class PtyNotFoundError extends Schema.TaggedErrorClass<PtyNotFoundError>()(
  "PtyNotFoundError",
  {
    ptyID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class UnsupportedProductModeError extends Schema.TaggedErrorClass<UnsupportedProductModeError>()(
  "UnsupportedProductModeError",
  {
    mode: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 400 },
) {}

export class CompositionResolveError extends Schema.TaggedErrorClass<CompositionResolveError>()(
  "CompositionResolveError",
  {
    code: Schema.String,
    message: Schema.String,
    diagnostics: Schema.optional(Schema.Array(Composition.Diagnostic)),
  },
  { httpApiStatus: 422 },
) {}
