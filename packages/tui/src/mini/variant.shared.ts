// Model variant resolution and persistence.
//
// Variants are provider-specific reasoning effort levels (e.g., "high", "max").
// Resolution priority: CLI --variant flag > valid session history > saved preference.
//
// The saved variant persists across sessions in ~/.local/state/aigcfroge/model.json
// so your last-used variant sticks. Cycling (ctrl+t) updates both the active
// variant and the persisted file.
import { createSession, sessionVariant, type RunSession, type SessionMessages } from "./session.shared"
import type { RunInput, RunProvider } from "./types"
import { cycleModelVariant, isModelGroup, normalizeModelVariant } from "../model-preference"
import type { ModelGroupCurrent } from "@aigcfroge/client/promise"

export function modelInfo(
  providers: RunProvider[] | undefined,
  model: NonNullable<RunInput["model"]>,
  groups?: readonly ModelGroupCurrent[],
) {
  if (isModelGroup(model))
    return {
      provider: "Model group",
      model: groups?.find((group) => group.groupID === model.groupID)?.definition?.name ?? `group:${model.groupID}`,
    }
  const provider = providers?.find((item) => item.id === model.providerID)
  return {
    provider: provider?.name ?? model.providerID,
    model: provider?.models[model.modelID]?.name ?? model.modelID,
  }
}

export function formatModelLabel(
  model: NonNullable<RunInput["model"]>,
  variant: string | undefined,
  providers?: RunProvider[],
  groups?: readonly ModelGroupCurrent[],
): string {
  const names = modelInfo(providers, model, groups)
  const label = variant && !isModelGroup(model) ? ` · ${variant}` : ""
  return `${names.model} · ${names.provider}${label}`
}

export function cycleVariant(current: string | undefined, variants: string[]): string | undefined {
  return cycleModelVariant(current, variants)
}

export function pickVariant(model: RunInput["model"], input: RunSession | SessionMessages): string | undefined {
  return sessionVariant(Array.isArray(input) ? createSession(input) : input, model)
}

function fitVariant(value: string | undefined, variants: string[]): string | undefined {
  const normalized = normalizeModelVariant(value)
  return normalized && (variants.length === 0 || variants.includes(normalized)) ? normalized : undefined
}

// Picks the active variant. CLI flag wins, then valid session history, then the
// saved preference. Saved and session values are dropped when the provider no
// longer offers them.
export function resolveVariant(
  input: string | undefined,
  session: string | undefined,
  saved: string | undefined,
  variants: string[],
): string | undefined {
  if (input !== undefined) {
    return normalizeModelVariant(input)
  }

  return fitVariant(session, variants) ?? fitVariant(saved, variants)
}
