/** Normalize V1/V2 propose_*_asset tool results into one UI shape. */

import type { AssetKindId } from "@aigcfroge/schema/asset"

export type CandidateInfo = {
  kind: AssetKindId
  name: string
  description: string
  /** 展示/diff 用统一文本（prompt=template、skill=content、mcp=configJson、command/agent=source）。 */
  content: string
  /** Per-kind apply candidate；字段在此已按 kind 校验，apply 时补 relativePath 透传给对应端点。 */
  candidate: UnknownRecord
  relativePath: string
  exists: boolean
  revision: string | null
  nameConflict: boolean
  pathConflict: boolean
  status: "valid" | "conflict" | "exists"
}

const PROPOSE_TOOL_KINDS: Record<string, AssetKindId> = {
  propose_prompt_asset: "prompt",
  propose_skill_asset: "skill",
  propose_mcp_asset: "mcp",
  propose_command_asset: "command",
  propose_agent_asset: "agent",
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringField(record: UnknownRecord, key: string) {
  const value = record[key]
  return typeof value === "string" ? value : undefined
}

function booleanField(record: UnknownRecord | undefined, key: string) {
  const value = record?.[key]
  return typeof value === "boolean" ? value : undefined
}

function stringArrayField(record: UnknownRecord, key: string) {
  const value = record[key]
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === "string")
}

function stringMapField(record: UnknownRecord, key: string) {
  const value = record[key]
  if (!isRecord(value)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string") out[k] = v
  }
  return out
}

function statusFrom(exists: boolean, nameConflict: boolean, pathConflict: boolean): CandidateInfo["status"] {
  if (nameConflict || pathConflict) return "conflict"
  if (exists) return "exists"
  return "valid"
}

/** 按 kind 提取 apply candidate + 展示文本；必需字段缺失返回 null（与原 template 缺失行为一致）。 */
function candidateFromInput(
  kind: AssetKindId,
  raw: UnknownRecord,
): { name: string; description: string; candidate: UnknownRecord; content: string } | null {
  const name = stringField(raw, "name") ?? ""
  const description = stringField(raw, "description") ?? ""
  if (!name) return null

  if (kind === "prompt") {
    const template = stringField(raw, "template") ?? ""
    if (!template) return null
    return { name, description, candidate: { name, description, template }, content: template }
  }
  if (kind === "skill") {
    const content = stringField(raw, "content") ?? ""
    if (!content) return null
    return {
      name,
      description,
      candidate: { name, description, slash: booleanField(raw, "slash") ?? false, content },
      content,
    }
  }
  if (kind === "mcp") {
    const configJson = stringField(raw, "configJson") ?? ""
    if (!configJson) return null
    return {
      name,
      description,
      candidate: {
        name,
        description,
        command: stringField(raw, "command") ?? "",
        args: stringArrayField(raw, "args"),
        env: stringMapField(raw, "env"),
        configJson,
      },
      content: configJson,
    }
  }
  if (kind === "command") {
    const source = stringField(raw, "source") ?? ""
    if (!source) return null
    const args = stringField(raw, "args")
    return {
      name,
      description,
      candidate: { name, description, invocation: stringField(raw, "invocation") ?? "", ...(args ? { args } : {}), source },
      content: source,
    }
  }
  if (kind === "agent") {
    const source = stringField(raw, "source") ?? ""
    if (!source) return null
    return {
      name,
      description,
      candidate: { name, description, config: stringField(raw, "config") ?? "", source },
      content: source,
    }
  }
  return null
}

export function normalizeProposeCandidate(input: { tool: string; state: unknown }): CandidateInfo | null {
  const kind = PROPOSE_TOOL_KINDS[input.tool]
  if (!kind) return null
  if (!isRecord(input.state)) return null

  const rawInput = input.state.input
  if (!isRecord(rawInput)) return null

  const extracted = candidateFromInput(kind, rawInput)
  if (!extracted) return null

  const structured = isRecord(input.state.structured) ? input.state.structured : undefined
  const metadata = isRecord(input.state.metadata) ? input.state.metadata : undefined
  const result = structured ?? metadata
  const output = stringField(input.state, "output") ?? ""
  const exists = booleanField(result, "exists") ?? output.includes("exists")
  const nameConflict = booleanField(result, "nameConflict") ?? output.includes("Name conflict")
  const pathConflict = booleanField(result, "pathConflict") ?? output.includes("Path conflict")
  const revision = result?.revision

  return {
    kind,
    name: extracted.name,
    description: extracted.description,
    content: extracted.content,
    candidate: extracted.candidate,
    relativePath: stringField(result ?? rawInput, "relativePath") ?? stringField(rawInput, "relativePath") ?? "",
    exists,
    revision: typeof revision === "string" ? revision : null,
    nameConflict,
    pathConflict,
    status: statusFrom(exists, nameConflict, pathConflict),
  }
}

export function findProposeResult(
  messages: readonly { id: string }[],
  partsByMessage: Record<string, readonly unknown[] | undefined>,
) {
  for (const message of messages.toReversed()) {
    const parts = partsByMessage[message.id]
    if (!parts) continue
    for (const part of parts.toReversed()) {
      if (!isRecord(part)) continue
      if (part.type !== "tool" || typeof part.tool !== "string" || !(part.tool in PROPOSE_TOOL_KINDS)) continue
      if (!isRecord(part.state) || part.state.status !== "completed") continue
      const candidate = normalizeProposeCandidate({ tool: part.tool, state: part.state })
      if (candidate) return candidate
    }
  }
  return null
}
