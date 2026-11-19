import { Schema } from "effect"
import type { ModelSelection } from "@aigcfroge/client/promise"

export const ModelKey = Schema.Union([
  Schema.Struct({
    providerID: Schema.String,
    modelID: Schema.String,
    variant: Schema.optional(Schema.String),
  }),
  Schema.Struct({ type: Schema.Literal("group"), groupID: Schema.String }),
])

export type ModelKey = typeof ModelKey.Type

export function isGroup(model: ModelKey): model is Extract<ModelKey, { type: "group" }> {
  return "type" in model && model.type === "group"
}

export function fromSelection(model: ModelSelection): ModelKey {
  if ("type" in model) return { type: "group", groupID: model.groupID }

  return { providerID: model.providerID, modelID: model.id, variant: model.variant }
}

export function toSelection(model: ModelKey, variant?: string): ModelSelection {
  if (isGroup(model)) return { type: "group", groupID: model.groupID }

  return { id: model.modelID, providerID: model.providerID, variant: variant ?? model.variant }
}

export function sameKey(a: ModelKey | undefined, b: ModelKey | undefined) {
  if (!a || !b) return a === b

  if (isGroup(a)) return isGroup(b) && a.groupID === b.groupID

  return !isGroup(b) && a.providerID === b.providerID && a.modelID === b.modelID
}

export function selectionKey(model: ModelKey) {
  return isGroup(model)
    ? JSON.stringify(["group", model.groupID])
    : JSON.stringify(["model", model.providerID, model.modelID])
}
