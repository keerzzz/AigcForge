import type { SessionConfigOption } from "@agentclientprotocol/sdk"
import type { Agent } from "@aigcfroge/schema/agent"
import { Model } from "@aigcfroge/schema/model"
import { Provider } from "@aigcfroge/schema/provider"
import { ProductMode } from "@aigcfroge/schema/product-mode"
import { Session } from "@aigcfroge/schema/session"
import { Effect, Order } from "effect"
import { builtinCommands, findModel, type Catalog } from "./catalog"
import { ACPError } from "./error"

const DEFAULT_VARIANT_VALUE = "default"
const INHERITED_MODEL_VALUE = "inherit"
const bindingDescription = "Adopted executor binding; immutable"

export type Selection = {
  readonly mode?: ProductMode.ID
  readonly model?: Model.Selection
  readonly modeID?: Agent.ID
  readonly controller?: Session.Controller
  readonly executorPreference?: Session.ExecutorPreference
}

export type Change =
  | { readonly model: Model.Selection }
  | { readonly modeID: Agent.ID }
  | { readonly executorPreference: Session.ExecutorPreference }

export function selectionFromSession(
  session: Pick<Session.Info, "mode" | "agent" | "model" | "controller" | "executorPreference">,
): Selection {
  return {
    mode: session.mode,
    model: session.model,
    modeID: session.agent,
    controller: session.controller,
    executorPreference: session.executorPreference,
  }
}

export function currentModel(catalog: Catalog, selection: Selection) {
  if (selection.modeID === "meta" && selection.controller?.kind === "root") return selection.model
  return selection.model ?? catalog.defaultModel
}

export function configOptions(catalog: Catalog, selection: Selection): SessionConfigOption[] {
  if (selection.controller?.kind === "child") {
    const binding = selection.controller.executor
    const agent =
      catalog.executors?.find((item) => item.id === binding.agent) ??
      catalog.modes.find((item) => item.id === binding.agent)
    return [
      ...modelOptions(catalog, binding.model, "child"),
      {
        id: "mode",
        name: "Executor",
        description: bindingDescription,
        category: "mode",
        type: "select",
        currentValue: binding.agent,
        options: [{ value: binding.agent, name: agent?.name ?? binding.agent }],
      },
    ]
  }
  const mode = selection.mode ?? ProductMode.Default
  const modes = catalog.modes.filter((agent) => agent.ordinaryModes?.includes(mode) ?? true)
  const ordinary = [
    ...modelOptions(catalog, currentModel(catalog, selection), "session"),
    {
      id: "mode",
      name: "Session Mode",
      category: "mode",
      type: "select",
      currentValue: selection.modeID ?? (modes.some((agent) => agent.id === catalog.defaultModeID)
        ? catalog.defaultModeID
        : (modes[0]?.id ?? "")),
      options: [
        ...modes.map((mode) => ({
          value: mode.id,
          name: mode.name,
          ...(mode.description ? { description: mode.description } : {}),
        })),
        ...(selection.modeID && !modes.some((mode) => mode.id === selection.modeID)
          ? [{ value: selection.modeID, name: selection.modeID, description: "Unavailable Agent; saved selection" }]
          : []),
      ],
    } satisfies SessionConfigOption,
  ]
  if (selection.modeID === "meta" && selection.controller?.kind === "root") {
    const executors = (catalog.executors ?? []).filter((agent) => agent.ordinaryModes?.includes(mode) ?? true)
    const selected = selection.executorPreference?.agent
    return [
      ...ordinary,
      {
        id: "executor",
        name: "Executor",
        description: "Preference for future delegation",
        category: "mode",
        type: "select",
        currentValue: selected ?? "",
        options: [
          ...(!selected ? [{ value: "", name: "Not selected" }] : []),
          ...executors.map((agent) => ({
            value: agent.id,
            name: agent.name,
            ...(agent.description ? { description: agent.description } : {}),
          })),
          ...(selected && !executors.some((agent) => agent.id === selected)
            ? [{ value: selected, name: selected, description: "Unavailable executor; saved preference" }]
            : []),
        ],
      },
      ...modelOptions(catalog, selection.executorPreference?.model, "executor"),
    ]
  }
  return ordinary
}

function modelOptions(
  catalog: Catalog,
  model: Model.Selection | undefined,
  domain: "session" | "executor" | "child",
): SessionConfigOption[] {
  const executor = domain === "executor"
  const child = domain === "child"
  const group = model && Model.Selection.isGroup(model) ? model : undefined
  const physical = model && !Model.Selection.isGroup(model) ? model : undefined
  const currentValue = model ? advertisedModel(model) : executor ? INHERITED_MODEL_VALUE : ""
  const variants = model ? (findModel(catalog.models, model)?.variants.map((variant) => variant.id) ?? []) : []
  const implicitValue = implicitVariantValue([...variants, ...(physical?.variant ? [physical.variant] : [])])
  const effort = !model && executor ? INHERITED_MODEL_VALUE : (physical?.variant ?? implicitValue)
  const efforts =
    child || (!model && executor)
      ? [effort]
      : [...new Set([...variants, DEFAULT_VARIANT_VALUE, implicitValue, ...(physical?.variant ? [physical.variant] : [])])]
  return [
    {
      id: executor ? "executor-model" : "model",
      name: executor || child ? "Executor Model" : "Model",
      ...(child ? { description: bindingDescription } : {}),
      category: "model",
      type: "select",
      currentValue,
      options: child
        ? [{ value: currentValue, name: currentValue }]
        : [
            ...(executor ? [{ value: INHERITED_MODEL_VALUE, name: "Inherit Agent or Session model" }] : []),
            ...catalog.models
              .toSorted((a, b) => Order.String(a.providerID, b.providerID) || a.name.localeCompare(b.name))
              .map((item) => ({ value: advertisedModel(item), name: item.providerID + "/" + item.name })),
            ...(catalog.groups ?? []).flatMap((item) => item.definition && !item.unavailable
              ? [{ value: `group:${item.groupID}`, name: item.definition.name, description: "Model group" }]
              : []),
            ...(model && (group ? !catalog.groups?.some((item) => item.groupID === group.groupID && item.definition && !item.unavailable) : !findModel(catalog.models, model))
              ? [{ value: currentValue, name: currentValue, description: "Unavailable model; saved selection" }]
              : []),
            ...(!model && !executor ? [{ value: "", name: "Unavailable model" }] : []),
          ],
    },
    ...(group ? [] : [{
      id: executor ? "executor-effort" : "effort",
      name: executor || child ? "Executor Effort" : "Effort",
      description: child ? bindingDescription : "Available effort levels for this model",
      category: "thought_level",
      type: "select",
      currentValue: effort,
      options: efforts.map((variant) => ({
        value: variant,
        name:
          variant === implicitValue
            ? "Implicit default"
            : variant
                .split(/[_-]/)
                .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
                .join(" "),
      })),
    } satisfies SessionConfigOption]),
  ]
}

function implicitVariantValue(variants: readonly string[], value = "implicit"): string {
  return variants.includes(value) ? implicitVariantValue(variants, value + ":") : value
}

export function availableCommands(catalog: Catalog) {
  return [
    ...catalog.commands.map((command) => ({ name: command.name, description: command.description ?? "" })),
    ...Array.from(builtinCommands, ([name, command]) => ({ name, description: command.description })),
  ]
}

export const resolveChange = Effect.fnUntraced(function* (
  catalog: Catalog,
  selection: Selection,
  configId: string,
  value: string,
) {
  const root = selection.modeID === "meta" && selection.controller?.kind === "root"
  const child = selection.controller?.kind === "child" ? selection.controller.executor : undefined
  const preference = selection.executorPreference
  const current = child?.model ?? currentModel(catalog, selection)
  switch (configId) {
    case "model":
      return { model: yield* requireModel(catalog, value, current, true) }
    case "executor-model": {
      if (!root) return yield* new ACPError.InvalidConfigOptionError({ configId })
      if (!preference)
        return yield* new ACPError.InvalidRequestError({
          message: "Select an executor before its model",
          field: "executorPreference.agent",
        })
      return {
        executorPreference: new Session.ExecutorPreference({
          agent: preference.agent,
          ...(value === INHERITED_MODEL_VALUE
            ? {}
            : { model: yield* requireModel(catalog, value, preference.model, true) }),
        }),
      }
    }
    case "effort":
    case "executor-effort": {
      const executor = configId === "executor-effort"
      if (executor && !root) return yield* new ACPError.InvalidConfigOptionError({ configId })
      const ref = executor ? preference?.model : current
      if (ref && Model.Selection.isGroup(ref)) return yield* new ACPError.InvalidEffortError({ effort: value })
      if (!ref) {
        if (executor && value === INHERITED_MODEL_VALUE) return undefined
        return yield* new ACPError.InvalidEffortError({ effort: value })
      }
      const model = findModel(catalog.models, ref)
      const implicitValue = implicitVariantValue([
        ...(model?.variants.map((variant) => variant.id) ?? []),
        ...(ref.variant ? [ref.variant] : []),
      ])
      const implicit = value === implicitValue
      const adopted = value === (ref.variant ?? implicitValue)
      if (
        (!model && !adopted) ||
        (value !== DEFAULT_VARIANT_VALUE &&
          !implicit &&
          !model?.variants.some((variant) => variant.id === value) &&
          !adopted)
      )
        return yield* new ACPError.InvalidEffortError({ effort: value })
      const selected = { ...ref, variant: implicit ? undefined : Model.VariantID.make(value) }
      if (!executor) return { model: selected }
      if (!preference)
        return yield* new ACPError.InvalidRequestError({
          message: "Select an executor before its effort",
          field: "executorPreference.agent",
        })
      return { executorPreference: new Session.ExecutorPreference({ agent: preference.agent, model: selected }) }
    }
    case "executor": {
      if (!root) return yield* new ACPError.InvalidConfigOptionError({ configId })
      const agent = catalog.executors?.find((item) => item.id === value)
      if (!agent) {
        if (!preference || preference.agent !== value) return yield* new ACPError.InvalidModeError({ mode: value })
        return { executorPreference: preference }
      }
      return {
        executorPreference: new Session.ExecutorPreference({
          agent: agent.id,
          ...(preference?.agent === agent.id && preference.model ? { model: preference.model } : {}),
        }),
      }
    }
    case "mode": {
      if (child?.agent === value) return { modeID: child.agent }
      const mode =
        catalog.modes.find((item) => item.id === value) ??
        (child ? catalog.executors?.find((item) => item.id === value) : undefined)
      if (!mode) {
        if (selection.modeID === value) return { modeID: selection.modeID }
        return yield* new ACPError.InvalidModeError({ mode: value })
      }
      return { modeID: mode.id }
    }
    default:
      return yield* new ACPError.InvalidConfigOptionError({ configId })
  }
})

export function parseModelSelection(value: string, models: ReadonlyArray<Model.Info>): Model.Selection {
  if (value.startsWith("group:") && !value.includes("/")) return Model.Selection.parse(value)
  const exact = models.find((model) => advertisedModel(model) === value)
  if (exact) return { providerID: exact.providerID, id: exact.id }
  const separator = value.lastIndexOf("/")
  const variant = Model.VariantID.make(value.slice(separator + 1))
  const base = models.find(
    (model) =>
      advertisedModel(model) === value.slice(0, separator) && model.variants.some((item) => item.id === variant),
  )
  if (base) return { providerID: base.providerID, id: base.id, variant }
  const providerEnd = value.indexOf("/")
  if (providerEnd === -1) return { providerID: Provider.ID.make(value), id: Model.ID.make("") }
  return { providerID: Provider.ID.make(value.slice(0, providerEnd)), id: Model.ID.make(value.slice(providerEnd + 1)) }
}

const requireModel = Effect.fnUntraced(function* (
  catalog: Catalog,
  value: string,
  current?: Model.Selection,
  canonical = false,
) {
  if (
    canonical &&
    current &&
    (advertisedModel(current) === value ||
      (!Model.Selection.isGroup(current) && current.variant && advertisedModel(current) + "/" + current.variant === value))
  )
    return current
  const selected = parseModelSelection(value, catalog.models)
  if (Model.Selection.isGroup(selected)) {
    if (!catalog.groups?.some((group) => group.groupID === selected.groupID && group.definition && !group.unavailable))
      return yield* new ACPError.InvalidModelError({ modelId: value })
    return selected
  }
  const model = findModel(catalog.models, selected)
  if (!model) return yield* new ACPError.InvalidModelError({ providerId: selected.providerID, modelId: value })
  const selectedVariant = model.variants.find((variant) => variant.id === selected.variant)
  if (selected.variant && !selectedVariant) return yield* new ACPError.InvalidEffortError({ effort: selected.variant })
  const variant =
    selectedVariant?.id ??
    (current && !Model.Selection.isGroup(current) && current.providerID === model.providerID &&
    current.id === model.id &&
    (current.variant === DEFAULT_VARIANT_VALUE || model.variants.some((variant) => variant.id === current.variant))
      ? current.variant
      : undefined)
  return { providerID: model.providerID, id: model.id, variant } satisfies Model.Ref
})

function advertisedModel(model: Model.Selection) {
  if (Model.Selection.isGroup(model)) return `group:${model.groupID}`
  return `${model.providerID}/${model.id}`
}
