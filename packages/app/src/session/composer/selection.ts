import type { SessionInfo, SessionMessageUser } from "@omnixa/client/promise"
import { Option, Predicate, Schema } from "effect"
import { fromSelection, ModelKey } from "@/providers/models/key"

export function resolveSessionComposerSelection(
  info: Pick<SessionInfo, "agent" | "model" | "controller" | "executorPreference"> | undefined,
  metadata: SessionMessageUser["metadata"],
) {
  if (info?.controller)
    return {
      agent: info.agent,
      model: info.model ? fromSelection(info.model) : undefined,
      executorPreference:
        info.controller.kind === "root" && info.agent === "meta" ? info.executorPreference : undefined,
    }

  const model = metadata?.model

  const historical = Option.getOrUndefined(Schema.decodeUnknownOption(ModelKey)(model))

  return {
    agent: info?.agent ?? (Predicate.isString(metadata?.agent) ? metadata.agent : undefined),
    model: info?.model ? fromSelection(info.model) : historical,
  }
}
