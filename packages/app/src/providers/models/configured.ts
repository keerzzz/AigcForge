import { createEffect, createMemo, on } from "solid-js"
import { useData } from "@/runtime/server/current"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useServerSDK } from "@/runtime/server/client"
import { Schema } from "effect"
import { ConfigModel } from "@aigcfroge/schema/config/model"
import { type ModelKey } from "./key"

export function useConfiguredModel() {
  const data = useData()
  const location = useWorkspaceLocation()
  const server = useServerSDK()
  createEffect(
    on(
      () => [location().directory, server.connection.status()] as const,
      ([directory]) => {
        void data.location.config.sync({ directory }).catch(() => undefined)
      },
    ),
  )
  const documents = () => data.location.config.list({ directory: location().directory })

  const model = createMemo<ModelKey | undefined>(() => {
    const entry = documents()?.findLast((entry) => entry.type === "document" && entry.info.model !== undefined)
    const model = entry?.type === "document" ? entry.info.model : undefined

    if (!model) return

    const selection = Schema.decodeUnknownSync(ConfigModel.Selection)(model)

    if ("type" in selection) return { type: "group", groupID: selection.groupID }

    return { providerID: selection.providerID, modelID: selection.model, variant: selection.variant }
  })

  return Object.assign(model, { ready: () => documents() !== undefined })
}
