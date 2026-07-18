/**
 * Normalize V1/V2 propose_prompt_asset tool results into a unified CandidateInfo.
 *
 * V1 ToolPart: input in `state.input`, result text in `state.output`, metadata in `state.metadata`.
 * V2 tool result: input in `state.input`, structured result in `state.structured`.
 */

export type CandidateInfo = {
  name: string
  description: string
  template: string
  relativePath: string
  exists: boolean
  revision: string | null
  nameConflict: boolean
  pathConflict: boolean
  /** Human-readable status summary for the preview header. */
  status: "valid" | "conflict" | "exists"
}

type ToolStateInput = {
  name?: string
  description?: string
  template?: string
  relativePath?: string
  [key: string]: unknown
}

type V1ToolState = {
  input: ToolStateInput
  output?: string
  metadata?: Record<string, unknown>
}

type V2ToolState = {
  input: ToolStateInput
  structured?: {
    relativePath?: string
    exists?: boolean
    revision?: string | null
    nameConflict?: boolean
    pathConflict?: boolean
    [key: string]: unknown
  }
}

type NormalizationInput = {
  tool: string
  state: V1ToolState | V2ToolState
}

function isV1(state: V1ToolState | V2ToolState): state is V1ToolState {
  return "output" in state && !("structured" in state)
}

function isV2(state: V1ToolState | V2ToolState): state is V2ToolState {
  return "structured" in state
}

function statusFrom(exists: boolean, nameConflict: boolean, pathConflict: boolean): CandidateInfo["status"] {
  if (nameConflict || pathConflict) return "conflict"
  if (exists) return "exists"
  return "valid"
}

export function normalizeProposeCandidate(input: NormalizationInput): CandidateInfo | null {
  if (input.tool !== "propose_prompt_asset") return null

  const name = input.state.input?.name ?? ""
  const description = input.state.input?.description ?? ""
  const template = input.state.input?.template ?? ""
  if (!name || !template) return null

  if (isV2(input.state) && input.state.structured) {
    const s = input.state.structured
    return {
      name,
      description,
      template,
      relativePath: s.relativePath ?? "",
      exists: s.exists ?? false,
      revision: s.revision ?? null,
      nameConflict: s.nameConflict ?? false,
      pathConflict: s.pathConflict ?? false,
      status: statusFrom(s.exists ?? false, s.nameConflict ?? false, s.pathConflict ?? false),
    }
  }

  if (isV1(input.state)) {
    const output = input.state.output ?? ""
    const exists = output.includes("exists")
    const nameConflict = output.includes("Name conflict")
    const pathConflict = output.includes("Path conflict")
    const relativePath = input.state.input?.relativePath ?? ""
    return {
      name,
      description,
      template,
      relativePath,
      exists,
      revision: null,
      nameConflict,
      pathConflict,
      status: statusFrom(exists, nameConflict, pathConflict),
    }
  }

  return null
}
