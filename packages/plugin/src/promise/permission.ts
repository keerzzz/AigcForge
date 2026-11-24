import type { PermissionApi } from "@omnixa/client/promise/api"
import type { Agent } from "@omnixa/schema/agent"
import type { Permission } from "@omnixa/schema/permission"
import type { Session } from "@omnixa/schema/session"
import type { Hooks } from "./registration.js"

export interface PermissionEvaluation {
  readonly sessionID: Session.ID
  readonly agent?: Agent.ID
  readonly action: string
  readonly resources: ReadonlyArray<string>
  readonly metadata?: Record<string, unknown>
  readonly source?: Permission.Source
  effect: Permission.Effect
  message?: string
}

export interface PermissionHooks {
  readonly evaluate: PermissionEvaluation
}

export type PermissionDomain = Pick<PermissionApi, "list" | "get" | "reply"> & {
  readonly hook: Hooks<PermissionHooks>
}
