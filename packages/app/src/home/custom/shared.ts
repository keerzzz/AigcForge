import type { CustomCompositionPlanOutput, ModelSelection } from "@aigcfroge/client/promise"
import type { HomeController } from "../model"
import type { ServerConnection } from "@/runtime/server/registry"
import type { useLanguage } from "@/runtime/i18n/language"
import { fromSelection, selectionKey } from "@/providers/models/key"

export type CustomOwner = {
  connection: ReturnType<HomeController["server"]["focused"]>
  server: ServerConnection.Key | undefined
  context: ReturnType<HomeController["server"]["focusedContext"]>
  client: NonNullable<ReturnType<HomeController["server"]["focusedContext"]>>["sdk"]["api"] | undefined
  directory: string | undefined
}

export type ModelOption = {
  key: string
  label: string
  model: ModelSelection | undefined
  unavailable: string | undefined
}

export function buildModelOptions(input: {
  owner: CustomOwner
  selected: ModelSelection | undefined
  language: ReturnType<typeof useLanguage>
}): ModelOption[] {
  const directory = input.owner.directory ?? ""
  const models = input.owner.context?.data.location.model.list({ directory }) ?? []
  const modelGroups = input.owner.context?.data.location.model.group.definition.list({ directory })
  const groups = modelGroups?.effective ?? []
  const selected = input.selected

  return [
    { key: "default", label: input.language.t("home.custom.model.default"), model: undefined, unavailable: undefined },
    ...groups.map((group) => {
      const label = input.language.t("model.group.selection", { name: group.definition?.name || group.groupID })

      return {
        key: selectionKey({ type: "group", groupID: group.groupID }),
        label: group.unavailable
          ? input.language.t("home.custom.model.groupUnavailable", {
              model: label,
              reason: input.language.t(`model.group.unavailable.${group.unavailable}`),
            })
          : label,
        model: { type: "group" as const, groupID: group.groupID },
        unavailable: group.unavailable,
      }
    }),
    ...(selected && "type" in selected && !groups.some((group) => group.groupID === selected.groupID)
      ? [
          {
            key: selectionKey(fromSelection(selected)),
            label: input.language.t("home.custom.model.groupUnavailable", {
              model: input.language.t("model.group.selection", { name: selected.groupID }),
              reason: input.language.t("model.group.unavailable.missing"),
            }),
            model: selected,
            unavailable: "missing" as const,
          },
        ]
      : []),
    ...models.map((model) => ({
      key: selectionKey({ providerID: model.providerID, modelID: model.id }),
      label: `${model.name} (${model.providerID})`,
      model: { id: model.id, providerID: model.providerID },
      unavailable: undefined,
    })),
  ]
}

export function formatSelectedModelLabel(input: {
  owner: CustomOwner
  selected: ModelSelection | undefined
  plan?: CustomCompositionPlanOutput
  defaultModel?: ModelSelection
  language: ReturnType<typeof useLanguage>
}): string {
  const chosen = input.selected ?? input.plan?.orchestrator?.model ?? input.defaultModel

  if (!chosen) return input.language.t("home.custom.model.unavailable")
  const directory = input.owner.directory ?? ""
  const models = input.owner.context?.data.location.model.list({ directory }) ?? []
  const modelGroups = input.owner.context?.data.location.model.group.definition.list({ directory })

  if ("type" in chosen) {
    const group = modelGroups?.effective.find((item) => item.groupID === chosen.groupID)
    const label = input.language.t("model.group.selection", { name: group?.definition?.name || chosen.groupID })
    const unavailable = group ? group.unavailable : "missing"

    return unavailable
      ? input.language.t("home.custom.model.groupUnavailable", {
          model: label,
          reason: input.language.t(`model.group.unavailable.${unavailable}`),
        })
      : label
  }

  const info = models.find((model) => model.id === chosen.id && model.providerID === chosen.providerID)

  return `${info?.name ?? chosen.id} (${chosen.providerID})`
}
