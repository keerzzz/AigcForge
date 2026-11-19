import type { ModelKey } from "@/providers/models/key"
import { sameKey } from "@/providers/models/key"
import type { PromptModel } from "@/composer/schema"

type ModelSelection = {
  model: {
    key(): ModelKey | undefined
    variant: {
      current(): string | undefined
    }
  }
}

type PromptState = {
  model: {
    current(): PromptModel | undefined
    set(model: PromptModel): void
  }
}

export const syncPromptModel = (local: ModelSelection, prompt: PromptState) => {
  const model = local.model.key()

  if (!model) return

  const next = "type" in model ? model : { ...model, variant: local.model.variant.current() }

  const current = prompt.model.current()

  if (
    sameKey(current && ("type" in current ? current : { ...current, variant: current.variant ?? undefined }), next) &&
    (current && !("type" in current) ? current.variant : undefined) === ("type" in next ? undefined : next.variant)
  )
    return
  prompt.model.set(next)
}
