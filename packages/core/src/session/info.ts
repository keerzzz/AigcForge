import { DateTime, Schema } from "effect"
import { Agent } from "@omnixa/schema/agent"
import { Location } from "@omnixa/schema/location"
import { Model } from "@omnixa/schema/model"
import { Project } from "@omnixa/schema/project"
import { AbsolutePath, RelativePath } from "../schema.js"
import { Workspace } from "@omnixa/schema/workspace"
import { SessionSchema } from "./schema.js"
import type { SessionTable } from "./sql.js"
import { PersistedRevert } from "@omnixa/schema/session-revert"
import { Money } from "@omnixa/schema/money"

const decodeRevert = Schema.decodeUnknownSync(PersistedRevert)

export function fromRow(row: typeof SessionTable.$inferSelect & { last_message?: number | null }): SessionSchema.Info {
  const model = row.model ? Schema.decodeUnknownSync(Model.Selection)(row.model) : undefined
  return SessionSchema.Info.make({
    id: SessionSchema.ID.make(row.id),
    projectID: Project.ID.make(row.project_id),
    title: row.title ?? undefined,
    parentID: row.parent_id ? SessionSchema.ID.make(row.parent_id) : undefined,
    fork:
      row.fork_session_id && row.fork_boundary
        ? {
            sessionID: SessionSchema.ID.make(row.fork_session_id),
            boundary: row.fork_boundary,
          }
        : undefined,
    agent: row.agent ? Agent.ID.make(row.agent) : undefined,
    controller: row.controller ? Schema.decodeUnknownSync(SessionSchema.Controller)(row.controller) : undefined,
    executorPreference: row.executor_preference
      ? Schema.decodeUnknownSync(SessionSchema.ExecutorPreference)(row.executor_preference)
      : undefined,
    model: model
      ? Model.Selection.isGroup(model)
        ? model
        : {
            id: model.id,
            providerID: model.providerID,
            variant: row.controller
              ? model.variant === undefined
                ? undefined
                : model.variant
              : Model.VariantID.make(model.variant ?? "default"),
          }
      : undefined,
    cost: Money.USD.make(row.cost),
    unknownPriceAttempts: row.unknown_price_attempts ?? undefined,
    missingUsageAttempts: row.missing_usage_attempts ?? undefined,
    tokens: {
      input: row.tokens_input,
      output: row.tokens_output,
      reasoning: row.tokens_reasoning,
      cache: {
        read: row.tokens_cache_read,
        write: row.tokens_cache_write,
      },
    },
    location: Location.Ref.make({
      directory: AbsolutePath.make(row.directory),
      workspaceID: row.workspace_id ? Workspace.ID.make(row.workspace_id) : undefined,
    }),
    subpath: row.path ? RelativePath.make(row.path) : undefined,
    mode: row.mode,
    attended: row.attended === null ? undefined : row.attended === 1,
    permissionTier: row.permission_tier,
    metadata: row.metadata ?? undefined,
    permissions: row.permission ?? undefined,
    revert: row.revert ? decodeRevert(row.revert) : undefined,
    outcome: row.idle_outcome ?? undefined,
    time: {
      created: DateTime.makeUnsafe(row.time_created),
      updated: DateTime.makeUnsafe(row.time_updated),
      message: row.last_message == null ? undefined : DateTime.makeUnsafe(row.last_message),
      idle: row.time_idle === null ? undefined : DateTime.makeUnsafe(row.time_idle),
      viewed: row.time_viewed === null ? undefined : DateTime.makeUnsafe(row.time_viewed),
      archived: row.time_archived ? DateTime.makeUnsafe(row.time_archived) : undefined,
    },
  })
}
