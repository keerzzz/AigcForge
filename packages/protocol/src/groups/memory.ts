import { PersonalMemory } from "@omnixa/schema/personal-memory"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { InvalidRequestError } from "../errors.js"
import { Authorization } from "../middleware/authorization.js"
import { InstanceContext, WorkspaceRouting } from "../middleware/workspace-routing.js"
import { described } from "./metadata.js"

// Fork-retained instance-scoped surface (see prompt-asset.ts for the conventions).
const root = "/memory"

export const MemoryGroup = HttpApiGroup.make("memory")
  .add(
    HttpApiEndpoint.get("memory.list", root, {
      success: described(Schema.Array(PersonalMemory.Info), "All personal memory entries"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "memory.list",
        summary: "List personal memory entries",
        description: "User-level memory across projects (Memory Inspector).",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("memory.pending", `${root}/pending`, {
      success: described(Schema.Array(PersonalMemory.Info), "Pending memory proposals"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "memory.pending",
        summary: "List pending memory proposals",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("memory.confirm", `${root}/:id/confirm`, {
      params: Schema.Struct({ id: PersonalMemory.ID }),
      error: InvalidRequestError,
      success: described(PersonalMemory.Info, "The confirmed memory entry"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "memory.confirm",
        summary: "Confirm a memory proposal",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("memory.reject", `${root}/:id/reject`, {
      params: Schema.Struct({ id: PersonalMemory.ID }),
      error: InvalidRequestError,
      success: described(PersonalMemory.Info, "The rejected memory entry"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "memory.reject",
        summary: "Reject a memory proposal",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("memory.edit", `${root}/:id`, {
      params: Schema.Struct({ id: PersonalMemory.ID }),
      error: InvalidRequestError,
      payload: Schema.Struct({
        content: Schema.optional(Schema.String),
        trustLevel: Schema.optional(PersonalMemory.TrustLevel),
        sensitivityLevel: Schema.optional(PersonalMemory.SensitivityLevel),
      }),
      success: described(PersonalMemory.Info, "The edited memory entry"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "memory.edit",
        summary: "Edit a memory entry",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("memory.remove", `${root}/:id/remove`, {
      params: Schema.Struct({ id: PersonalMemory.ID }),
      error: InvalidRequestError,
      success: described(PersonalMemory.Info, "The deleted memory entry"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "memory.remove",
        summary: "Soft-delete a confirmed memory entry",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "memory",
      description: "Personal memory inspector surface (assistant mode).",
    }),
  )
  .middleware(InstanceContext)
  .middleware(WorkspaceRouting)
  .middleware(Authorization)
