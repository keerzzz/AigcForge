import type { ModelGroupCurrent, ModelSelection } from "@aigcfroge/client/promise"
import { Model } from "@aigcfroge/schema/model"
import { isModelGroup, toModelPreference } from "../model-preference"

export function parse(value: string) {
  if (value.startsWith("group:") && !value.includes("/")) return toModelPreference(Model.Selection.parse(value))
  if (value.includes("#") && value.includes("/")) return toModelPreference(Model.Selection.parse(value))
  const [providerID, ...modelID] = value.split("/")
  return { providerID, modelID: modelID.join("/") }
}

export function formatRef(model: ModelSelection) {
  if (isModelGroup(model)) return `group:${model.groupID}`
  return [model.providerID, model.id, model.variant].filter((value) => value !== undefined).join("/")
}

export function switchLabel(
  model: ModelSelection,
  models?: readonly { providerID: string; id: string; name: string }[],
  previous?: ModelSelection,
  groups?: readonly ModelGroupCurrent[],
) {
  if (isModelGroup(model))
    return `Switched model to ${groups?.find((item) => item.groupID === model.groupID)?.definition?.name ?? formatRef(model)}`
  if (previous && !isModelGroup(previous) && previous.providerID === model.providerID && previous.id === model.id)
    return `Switched variant to ${model.variant ?? "default"}`
  const display = models?.find((item) => item.providerID === model.providerID && item.id === model.id)?.name
  if (display === undefined) return `Switched model to ${formatRef(model)}`
  const variant = model.variant && model.variant !== "default" ? ` (${model.variant})` : ""
  return `Switched model to ${display}${variant}`
}
