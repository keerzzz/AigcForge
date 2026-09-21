export * as Location from "./location"

import { Effect, Schema } from "effect"
import { AbsolutePath, optionalOmitUndefined } from "./schema"
import { Workspace } from "./workspace"

export interface Ref extends Schema.Schema.Type<typeof Ref> {}
export const Ref = Schema.Struct({
  directory: AbsolutePath,
  // LayerMap compares decoded key shapes; normalize local placement while keeping JSON omission.
  // Schema defaults need the value undefined, not Effect.void's void type.
  workspaceID: Workspace.ID.pipe(
    optionalOmitUndefined,
    Schema.withDecodingDefaultTypeKey(Effect.succeed(undefined)),
    Schema.withConstructorDefault(Effect.succeed(undefined)),
  ),
}).annotate({ identifier: "Location.Ref" })
