import { Effect } from "effect"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { BadRequestError } from "../errors"

// Effect's Issue formatter recursively dumps the rejected `actual` value with
// no truncation, so a 5KB invalid array produces a ~360KB string. Cap to keep
// 4xx responses small and avoid mirroring entire request payloads (which may
// contain secrets) into the response body and log file.
const REASON_LIMIT = 1024
function truncateReason(reason: string) {
  if (reason.length <= REASON_LIMIT) return reason
  return reason.slice(0, REASON_LIMIT) + `… (${reason.length - REASON_LIMIT} more chars)`
}

// Declare the same legacy name/data contract that HttpApi encodes at runtime.
export class SchemaErrorMiddleware extends HttpApiMiddleware.Service<SchemaErrorMiddleware>()(
  "@aigcfroge/HttpApiSchemaError",
  {
    error: BadRequestError,
  },
) {}

export const schemaErrorLayer = HttpApiMiddleware.layerSchemaErrorTransform(SchemaErrorMiddleware, (error) =>
  Effect.gen(function* () {
    const reason = truncateReason(error.cause.message)
    yield* Effect.logWarning("schema rejection", { kind: error.kind, reason })
    return yield* new BadRequestError({
      name: "BadRequest",
      data: BadRequestError.fields.data.make({ message: reason, kind: error.kind }),
    })
  }),
)
