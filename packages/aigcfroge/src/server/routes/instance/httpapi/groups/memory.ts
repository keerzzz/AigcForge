export * as MemoryApiGroup from "./memory"

import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { PersonalMemory } from "@aigcfroge/schema/personal-memory"
import { described } from "./metadata"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"

const root = "/memory"

export const MemoryApi = HttpApi.make("memory").add(
  HttpApiGroup.make("memory")
    .add(
      HttpApiEndpoint.get("list", root, {
        success: described(Schema.Array(PersonalMemory.Info), "All personal memory entries"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "memory.list",
          summary: "List personal memory entries",
          description: "User-level memory across projects (Memory Inspector).",
        }),
      ),
      HttpApiEndpoint.get("pending", `${root}/pending`, {
        success: described(Schema.Array(PersonalMemory.Info), "Pending memory proposals"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "memory.pending",
          summary: "List pending memory proposals",
        }),
      ),
      HttpApiEndpoint.post("confirm", `${root}/:id/confirm`, {
        params: Schema.Struct({ id: Schema.String }),
        success: described(PersonalMemory.Info, "The confirmed memory entry"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "memory.confirm",
          summary: "Confirm a memory proposal",
        }),
      ),
      HttpApiEndpoint.post("reject", `${root}/:id/reject`, {
        params: Schema.Struct({ id: Schema.String }),
        success: described(PersonalMemory.Info, "The rejected memory entry"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "memory.reject",
          summary: "Reject a memory proposal",
        }),
      ),
      HttpApiEndpoint.post("edit", `${root}/:id`, {
        params: Schema.Struct({ id: Schema.String }),
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
      HttpApiEndpoint.post("remove", `${root}/:id/remove`, {
        params: Schema.Struct({ id: Schema.String }),
        success: described(PersonalMemory.Info, "The deleted memory entry"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "memory.remove",
          summary: "Soft-delete a confirmed memory entry",
        }),
      ),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
