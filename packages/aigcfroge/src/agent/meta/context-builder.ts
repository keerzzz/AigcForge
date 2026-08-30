export interface DelegationHistoryEntry {
  seq: number
  engine: string
  status: "success" | "partial" | "failed"
  summary: string
  files?: string[]
}

export interface BuildInput {
  project: string
  taskDescription: string
  engine: string
  delegationId: string
  files: string
  constraints: string
  history: DelegationHistoryEntry[]
  warmed?: boolean
}

const TEMPLATE = [
  "Project: {{project}}",
  "Task: {{taskDescription}}",
  "Engine: {{engine}}",
  "ID: {{delegationId}}",
  "{{files}}",
  "{{constraints}}",
  "{{warmth_signal}}",
  "",
  "Previous:",
  "{{history}}",
].join("\n")

const HISTORY_LINE = (h: DelegationHistoryEntry): string =>
  `#${h.seq} [${h.engine}] ${h.status}: ${h.summary}${h.files?.length ? ` (${h.files.join(", ")})` : ""}`

export function build(input: BuildInput): string {
  const historyText = input.history.slice(-5).map(HISTORY_LINE).join("\n") || "None"

  const warmth = input.warmed === true ? "<cache-warm/>" : ""

  return TEMPLATE.replace("{{project}}", input.project)
    .replace("{{taskDescription}}", input.taskDescription)
    .replace("{{engine}}", input.engine)
    .replace("{{delegationId}}", input.delegationId)
    .replace("{{files}}", input.files)
    .replace("{{constraints}}", input.constraints)
    .replace("{{warmth_signal}}", warmth)
    .replace("{{history}}", historyText)
}

export * as MetaContextBuilder from "./context-builder"
