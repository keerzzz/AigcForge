export * as Location from "./location"

import { Schema } from "effect"
import { AbsolutePath, optionalOmitUndefined } from "./schema"
import { Workspace } from "./workspace"

export interface Ref extends Schema.Schema.Type<typeof Ref> {}
export const Ref = Schema.Struct({
  directory: AbsolutePath,
  workspaceID: Workspace.ID.pipe(optionalOmitUndefined),
}).annotate({ identifier: "Location.Ref" })
