import { Schema } from "effect"
import AGENTS_INDEX from "./agents.json"

export const AgentCardSchema = Schema.Struct({
  name: Schema.String,
  mode: Schema.Literals(["primary", "subagent", "all"]),
  description: Schema.String,
  capabilities: Schema.Array(Schema.String),
  constraints: Schema.Array(Schema.String),
  protocol: Schema.optional(Schema.String),
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

export { index as agentIndex }
