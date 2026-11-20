import { createMemo } from "solid-js"
import type { ComposerControls } from "./adapter"
import { useLocal, type ModelSelection } from "@/providers/models/selection"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useProviders } from "@/providers/catalog/providers"

export function createComposerControls(input: { model?: ModelSelection } = {}) {
  const local = useLocal()
  const sdk = useWorkspaceLocation()
  const providers = useProviders(() => sdk().directory)
  const loading = () => !local.agent.ready() || !local.session.ready() || !providers.ready()

  return createMemo<ComposerControls>(() => ({
    agents: {
      available: local.agent.available(),
      options: local.agent.list().map((agent) => agent.name),
      current: local.agent.current()?.name ?? "",
      visible: local.agent.visible(),
      select: local.agent.set,
    },
    model: {
      selection: input.model ?? local.model,
      paid: providers.paid().length > 0,
      loading: !(input.model ?? local.model).ready() || loading(),
    },
    executor: local.metaSelected()
      ? {
          selection: local.executor.model,
          preference: local.executor.preference,
          paid: providers.paid().length > 0,
          loading: !local.executor.model.ready() || loading(),
        }
      : undefined,
  }))
}

export function createComposerModelSelection(input: { draftID: string }) {
  const local = useLocal()
  local.session.bindDraft(input.draftID)

  return { ...local.model, remembered: local.session.choices }
}
