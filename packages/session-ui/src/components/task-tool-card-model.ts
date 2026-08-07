/**
 * Pure shaping of a `task` tool card from its call input + result metadata.
 * Renderer-agnostic so the presentation rules (external-cli recognition, 4-state
 * status, summary extraction) are unit-testable without a SolidJS harness.
 *
 * `status` reflects the CLI's terminal state from `metadata.status`; live
 * `pending`/`running` is layered on top by the renderer via the part's own state.
 * `href` is the child Session id used to build the card's jump link.
 */

export type TaskCardStatus = "running" | "completed" | "failed" | "timeout"

export type TaskCardModel = {
  isExternalCli: boolean
  title: string
  subtitle?: string
  status: TaskCardStatus
  href?: string
  summary?: string
}

const titlecase = (value: string) => (value ? value[0].toUpperCase() + value.slice(1) : value)

const cliTitle = (input: Record<string, unknown>, metadata: Record<string, unknown> | undefined): string => {
  const cli = metadata?.cli
  if (typeof cli === "string" && cli) return cli
  const target = input.cli_target
  if (typeof target === "string" && target) return target
  return "CLI"
}

const subagentTitle = (input: Record<string, unknown>): string => {
  const type = input.subagent_type
  return typeof type === "string" && type ? titlecase(type) : "Agent"
}

const cliStatus = (metadata: Record<string, unknown> | undefined, output?: string): TaskCardStatus => {
  const status = metadata?.status
  if (status === "failed") {
    // A timed-out CLI fails with a "Timed out" error message in its rendered output;
    // surface it as a distinct state instead of a plain failure.
    return /timed out/i.test(output ?? "") ? "timeout" : "failed"
  }
  if (status === "success" || status === "partial") return "completed"
  return "running"
}

const extractSummary = (output?: string): string | undefined => {
  if (!output) return undefined
  const match =
    output.match(/<\s*task_result\s*>([\s\S]*?)<\/\s*task_result\s*>/) ??
    output.match(/<\s*task_error\s*>([\s\S]*?)<\/\s*task_error\s*>/)
  const value = match?.[1]?.trim()
  return value ? value : undefined
}

export function taskCardModel(
  input: Record<string, unknown>,
  metadata: Record<string, unknown> | undefined,
  output?: string,
): TaskCardModel {
  // The tool-call input carries execution_type from the start (even while a CLI
  // is still running and no result metadata exists yet), so check it first.
  const isExternalCli =
    input.execution_type === "external-cli" || metadata?.execution_type === "external-cli" || typeof metadata?.cli === "string"
  const subtitle = typeof input.description === "string" && input.description ? input.description : undefined
  const href = typeof metadata?.sessionId === "string" && metadata.sessionId ? metadata.sessionId : undefined

  if (isExternalCli) {
    const summary = extractSummary(output)
    return {
      isExternalCli,
      title: cliTitle(input, metadata),
      ...(subtitle ? { subtitle } : {}),
      status: cliStatus(metadata, output),
      ...(href ? { href } : {}),
      ...(summary ? { summary } : {}),
    }
  }

  return {
    isExternalCli,
    title: subagentTitle(input),
    ...(subtitle ? { subtitle } : {}),
    status: "completed",
    ...(href ? { href } : {}),
  }
}
