import { Schema } from "effect"
import AGENTS_INDEX from "./agents.json"

export const AgentCardSchema = Schema.Struct({
  name: Schema.String,
  mode: Schema.Literals(["primary", "subagent", "all"]),
  description: Schema.String,
  capabilities: Schema.Array(Schema.String),
  constraints: Schema.Array(Schema.String),
  protocol: Schema.optional(Schema.String),
  card: Schema.optional(
    Schema.Struct({
      version: Schema.String,
      readOnly: Schema.Boolean,
      tools: Schema.Array(Schema.String),
      endpoints: Schema.Struct({ type: Schema.String }),
      auth: Schema.Struct({ type: Schema.String }),
    }),
  ),
})
export type AgentCard = Schema.Schema.Type<typeof AgentCardSchema>

export const AgentIndexSchema = Schema.Record(Schema.String, AgentCardSchema)
export type AgentIndex = Schema.Schema.Type<typeof AgentIndexSchema>

const index: AgentIndex = Schema.decodeUnknownSync(AgentIndexSchema)(AGENTS_INDEX)

export function getAgentCard(name: string): AgentCard | undefined {
  return index[name]
}

export function listAgents(): AgentCard[] {
  return Object.values(index)
}

export function protocolCardPath(name: string): string {
  return `src/agent/${name}/protocol.md`
}

export function formatAgentCard(name: string): string | undefined {
  const card = getAgentCard(name)
  if (!card) return undefined
  return [
    `Agent: ${card.name} (${card.mode}) — ${card.description}`,
    `Capabilities: ${card.capabilities.join(", ")}`,
    `Constraints: ${card.constraints.join(", ") || "None"}`,
  ].join("\n")
}

const protocolCards = {
  build: new URL("./build/protocol.md", import.meta.url),
  explore: new URL("./explore/protocol.md", import.meta.url),
  general: new URL("./general/protocol.md", import.meta.url),
  plan: new URL("./plan/protocol.md", import.meta.url),
} as const

export async function loadProtocolCard(name: string): Promise<string | undefined> {
  const protocol = getAgentCard(name)?.protocol
  if (protocol === "build") return readProtocolCard(protocolCards.build)
  if (protocol === "explore") return readProtocolCard(protocolCards.explore)
  if (protocol === "general") return readProtocolCard(protocolCards.general)
  if (protocol === "plan") return readProtocolCard(protocolCards.plan)
  return undefined
}

async function readProtocolCard(url: URL) {
  const content = (await Bun.file(url).text()).trim()
  return content || undefined
}

export { index as agentIndex }
