export * as PermissionTier from "./permission-tier"

import { Schema } from "effect"

export const ID = Schema.Literals(["propose", "full"]).annotate({
  identifier: "PermissionTier",
})
export type ID = typeof ID.Type

export const Default = "propose" as const
