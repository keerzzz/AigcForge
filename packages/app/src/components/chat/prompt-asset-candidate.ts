/** Normalize V1/V2 propose_prompt_asset tool results into one UI shape. */

export type CandidateInfo = {
  name: string
  description: string
  template: string
  relativePath: string
  exists: boolean
  revision: string | null
  nameConflict: boolean
  pathConflict: boolean
  status: "valid" | "conflict" | "exists"
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

function statusFrom(exists: boolean, nameConflict: boolean, pathConflict: boolean): CandidateInfo["status"] {
  if (nameConflict || pathConflict) return "conflict"
  if (exists) return "exists"
  return "valid"
}

export function normalizeProposeCandidate(input: { tool: string; state: unknown }): CandidateInfo | null {
  if (input.tool !== "propose_prompt_asset") return null
  if (!isRecord(input.state)) return null

  const rawInput = input.state.input
  if (!isRecord(rawInput)) return null

  const name = stringField(rawInput, "name") ?? ""
  const description = stringField(rawInput, "description") ?? ""
  const template = stringField(rawInput, "template") ?? ""
  if (!name || !template) return null

  const structured = isRecord(input.state.structured) ? input.state.structured : undefined
  const metadata = isRecord(input.state.metadata) ? input.state.metadata : undefined
  const result = structured ?? metadata
  const output = stringField(input.state, "output") ?? ""
  const exists = booleanField(result, "exists") ?? output.includes("exists")
  const nameConflict = booleanField(result, "nameConflict") ?? output.includes("Name conflict")
  const pathConflict = booleanField(result, "pathConflict") ?? output.includes("Path conflict")
  const revision = result?.revision

  return {
    name,
    description,
    template,
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
      if (part.type !== "tool" || part.tool !== "propose_prompt_asset") continue
      if (!isRecord(part.state) || part.state.status !== "completed") continue
      const candidate = normalizeProposeCandidate({ tool: part.tool, state: part.state })
      if (candidate) return candidate
    }
  }
  return null
}
