export * as AgentProtocol from "./protocol.js"

import { Agent } from "@aigcfroge/schema/agent"
import { Option, Schema } from "effect"

const decodeCard = Schema.decodeUnknownOption(Agent.CardValue)
const decodeDeclaration = Schema.decodeUnknownOption(
  Schema.Struct({ ...Agent.Card.fields, protocol: Schema.optionalKey(Schema.String) }),
)

/** Separate metadata before legacy decoding can move it into provider options. */
export function normalizeDefinition(input: Record<string, unknown>) {
  if (!Object.hasOwn(input, "card")) return { definition: input, card: undefined }
  const decoded = decodeCard(input.card)
  const declaration = Option.isNone(decoded) ? decodeDeclaration(input.card) : Option.none()
  const card = Option.isSome(decoded)
    ? decoded.value
    : new Agent.CardIssue({
        _tag: "InvalidCard",
        reason:
          Option.isSome(declaration) && declaration.value.protocol?.trim() === "" ? "empty_protocol" : "invalid_shape",
      })
  return { definition: Object.fromEntries(Object.entries(input).filter(([key]) => key !== "card")), card }
}
