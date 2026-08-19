import type {
  AgentAssetCandidate,
  CommandAssetCandidate,
  CustomProfileCandidate,
  McpAssetCandidate,
  PromptAssetCandidate,
  SkillAssetCandidate,
} from "@aigcfroge/sdk/v2/client"
export type SupportedAssetKind = "prompt" | "skill" | "mcp" | "command" | "agent" | "workflow" | "plugin" | "custom-profile"

type CandidateBase = {
  name: string
  description: string
  /** 展示/diff 用统一文本（prompt=template、skill=content、mcp=configJson、command/agent=source、custom-profile=rawYaml）。 */
  content: string
  relativePath: string
  exists: boolean
  revision: string | null
  nameConflict: boolean
  pathConflict: boolean
  status: "valid" | "conflict" | "exists"
}

type CandidateByKind =
  | { kind: "prompt"; candidate: Omit<PromptAssetCandidate, "relativePath"> }
  | { kind: "skill"; candidate: Omit<SkillAssetCandidate, "relativePath"> }
  | { kind: "mcp"; candidate: Omit<McpAssetCandidate, "relativePath"> }
  | { kind: "command"; candidate: Omit<CommandAssetCandidate, "relativePath"> }
  | { kind: "agent"; candidate: Omit<AgentAssetCandidate, "relativePath"> }
  | { kind: "workflow"; candidate: { name: string; description: string; content: string } }
  | { kind: "plugin"; candidate: { name: string; description: string; content: string } }
  | { kind: "custom-profile"; candidate: CustomProfileCandidate }

export type CandidateInfo = CandidateBase & CandidateByKind

type UnknownRecord = Record<string, unknown>
type CandidateDraft = CandidateByKind & Pick<CandidateBase, "name" | "description" | "content">

const PROPOSE_TOOL_KINDS: Record<string, SupportedAssetKind> = {
  propose_prompt_asset: "prompt",
  propose_skill_asset: "skill",
  propose_mcp_asset: "mcp",
  propose_command_asset: "command",
  propose_agent_asset: "agent",
  propose_workflow_asset: "workflow",
  propose_plugin_asset: "plugin",
  propose_custom_profile_asset: "custom-profile",
  propose_custom_profile: "custom-profile",
}

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
  return value.filter((item): item is string => typeof item === "string")
}

function stringMapField(record: UnknownRecord, key: string) {
  const value = record[key]
  if (!isRecord(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
}

function statusFrom(exists: boolean, nameConflict: boolean, pathConflict: boolean): CandidateInfo["status"] {
  if (nameConflict || pathConflict) return "conflict"
  if (exists) return "exists"
  return "valid"
}

function profileFrom(name: string, description: string, value: unknown): CustomProfileCandidate["profile"] {
  const rec = isRecord(value) ? value : {}
  const agents = Array.isArray(rec.agents)
    ? rec.agents.filter(isRecord).map((a) => ({
        kind: "agent" as const,
        relativePath: typeof a.relativePath === "string" ? a.relativePath : "",
        revision: typeof a.revision === "string" ? a.revision : "",
      }))
    : []
  const bindings: CustomProfileCandidate["profile"]["bindings"] = {}
  if (isRecord(rec.bindings)) {
    for (const [k, b] of Object.entries(rec.bindings)) {
      if (isRecord(b)) {
        bindings[k] = {
          prompts: Array.isArray(b.prompts)
            ? b.prompts.filter(isRecord).map((p) => ({
                kind: "prompt" as const,
                relativePath: typeof p.relativePath === "string" ? p.relativePath : "",
                revision: typeof p.revision === "string" ? p.revision : "",
              }))
            : [],
          skills: Array.isArray(b.skills)
            ? b.skills.filter(isRecord).map((s) => ({
                kind: "skill" as const,
                relativePath: typeof s.relativePath === "string" ? s.relativePath : "",
                revision: typeof s.revision === "string" ? s.revision : "",
              }))
            : [],
        }
      }
    }
  }
  return {
    kind: "custom-profile",
    name,
    description,
    agents,
    bindings,
    presentation: "native",
    requestedCapabilities: Array.isArray(rec.requestedCapabilities)
      ? rec.requestedCapabilities.filter((c): c is string => typeof c === "string")
      : [],
  }
}

/** 按 kind 提取 apply candidate + 展示文本；必需字段缺失返回 null。 */
function candidateFromInput(kind: SupportedAssetKind, raw: UnknownRecord): CandidateDraft | null {
  const name = stringField(raw, "name") ?? ""
  const description = stringField(raw, "description") ?? ""
  if (!name) return null

  if (kind === "workflow") {
    const content = stringField(raw, "content") ?? ""
    if (!content) return null
    return { kind, name, description, candidate: { name, description, content }, content }
  }

  if (kind === "plugin") {
    const content = stringField(raw, "content") ?? ""
    if (!content) return null
    return { kind, name, description, candidate: { name, description, content }, content }
  }

  if (kind === "custom-profile") {
    const rawYaml = stringField(raw, "rawYaml") ?? (isRecord(raw.profile) ? JSON.stringify(raw.profile, null, 2) : "")
    const relPath = stringField(raw, "relativePath") ?? ""
    const profile = profileFrom(name, description, raw.profile)
    return {
      kind,
      name,
      description,
      candidate: { name, description, relativePath: relPath, profile },
      content: rawYaml,
    }
  }

  if (kind === "prompt") {
    const template = stringField(raw, "template") ?? ""
    if (!template) return null
    return { kind, name, description, candidate: { name, description, template }, content: template }
  }

  if (kind === "skill") {
    const content = stringField(raw, "content") ?? ""
    if (!content) return null
    return {
      kind,
      name,
      description,
      candidate: {
        name,
        description,
        slash: booleanField(raw, "slash") ?? false,
        content,
        triggers: stringArrayField(raw, "triggers"),
        tags: stringArrayField(raw, "tags"),
      },
      content,
    }
  }

  if (kind === "mcp") {
    const command = stringField(raw, "command") ?? ""
    const configJson = stringField(raw, "configJson") ?? ""
    if (!command || !configJson) return null
    return {
      kind,
      name,
      description,
      candidate: {
        name,
        description,
        command,
        args: stringArrayField(raw, "args"),
        env: stringMapField(raw, "env"),
        configJson,
      },
      content: configJson,
    }
  }

  if (kind === "command") {
    const invocation = stringField(raw, "invocation") ?? ""
    const source = stringField(raw, "source") ?? ""
    if (!invocation || !source) return null
    const args = stringField(raw, "args")
    return {
      kind,
      name,
      description,
      candidate: { name, description, invocation, ...(args ? { args } : {}), source },
      content: source,
    }
  }

  const config = stringField(raw, "config") ?? ""
  const source = stringField(raw, "source") ?? ""
  if (!source) return null
  return { kind, name, description, candidate: { name, description, config, source }, content: source }
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
  const exists = booleanField(result, "exists") ?? false
  const nameConflict = booleanField(result, "nameConflict") ?? false
  const pathConflict = booleanField(result, "pathConflict") ?? false
  const revision = result?.revision

  const common = {
    relativePath: stringField(result ?? rawInput, "relativePath") ?? stringField(rawInput, "relativePath") ?? "",
    exists,
    revision: typeof revision === "string" ? revision : null,
    nameConflict,
    pathConflict,
    status: statusFrom(exists, nameConflict, pathConflict),
  }

  if (extracted.kind === "prompt") return { ...extracted, ...common }
  if (extracted.kind === "skill") return { ...extracted, ...common }
  if (extracted.kind === "mcp") return { ...extracted, ...common }
  if (extracted.kind === "command") return { ...extracted, ...common }
  return { ...extracted, ...common }
}

export function sameCandidateInfo(left: CandidateInfo, right: CandidateInfo) {
  if (left.kind !== right.kind) return false
  if (left.name !== right.name || left.description !== right.description || left.content !== right.content) return false
  if (left.relativePath !== right.relativePath || left.revision !== right.revision || left.status !== right.status) return false
  if (left.exists !== right.exists || left.nameConflict !== right.nameConflict || left.pathConflict !== right.pathConflict) return false

  if (left.kind === "prompt" && right.kind === "prompt") return left.candidate.template === right.candidate.template
  if (left.kind === "skill" && right.kind === "skill") {
    return left.candidate.slash === right.candidate.slash
      && JSON.stringify(left.candidate.triggers) === JSON.stringify(right.candidate.triggers)
      && JSON.stringify(left.candidate.tags) === JSON.stringify(right.candidate.tags)
  }
  if (left.kind === "command" && right.kind === "command") {
    return left.candidate.invocation === right.candidate.invocation && left.candidate.args === right.candidate.args
  }
  if (left.kind === "agent" && right.kind === "agent") return left.candidate.config === right.candidate.config
  if (left.kind === "workflow" && right.kind === "workflow") return left.content === right.content
  if (left.kind === "plugin" && right.kind === "plugin") return left.content === right.content
  if (left.kind === "custom-profile" && right.kind === "custom-profile") return left.content === right.content
  if (left.kind !== "mcp" || right.kind !== "mcp") return false
  if (left.candidate.command !== right.candidate.command) return false
  if (left.candidate.args.length !== right.candidate.args.length) return false
  if (left.candidate.args.some((value, index) => value !== right.candidate.args[index])) return false
  const leftEnv = Object.entries(left.candidate.env).toSorted(([a], [b]) => a.localeCompare(b))
  const rightEnv = Object.entries(right.candidate.env).toSorted(([a], [b]) => a.localeCompare(b))
  if (leftEnv.length !== rightEnv.length) return false
  return leftEnv.every(([key, value], index) => key === rightEnv[index]?.[0] && value === rightEnv[index]?.[1])
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
      if (part.type !== "tool") continue
      const toolName =
        typeof part.tool === "string" ? part.tool : typeof part.name === "string" ? part.name : undefined
      if (!toolName || !(toolName in PROPOSE_TOOL_KINDS)) continue
      if (!isRecord(part.state) || part.state.status !== "completed") continue
      const candidate = normalizeProposeCandidate({ tool: toolName, state: part.state })
      if (candidate) return candidate
    }
  }
  return null
}
