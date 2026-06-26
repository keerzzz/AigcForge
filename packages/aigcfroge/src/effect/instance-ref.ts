import { Context } from "effect"
import type { InstanceContext } from "@/project/instance-context"
import type { WorkspaceV2 } from "@aigcfroge/core/workspace"

export const InstanceRef = Context.Reference<InstanceContext | undefined>("~aigcfroge/InstanceRef", {
  defaultValue: () => undefined,
})

export const WorkspaceRef = Context.Reference<WorkspaceV2.ID | undefined>("~aigcfroge/WorkspaceRef", {
  defaultValue: () => undefined,
})
