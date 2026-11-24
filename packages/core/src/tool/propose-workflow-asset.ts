export * as ProposeWorkflowAssetTool from "./propose-workflow-asset.js"

import type { Context } from "@omnixa/plugin/effect/plugin"
import { ToolFailure } from "@omnixa/ai"
import { Candidate, Content, Description, Name } from "@omnixa/schema/workflow-asset"
import { Effect, Schema } from "effect"
import { Flag } from "../flag/flag.js"
import { WorkflowAsset } from "../workflow-asset.js"
import { WorkflowAssetService } from "../workflow-asset-service.js"

export const name = "propose_workflow_asset"

export const description = `Propose a new workflow asset to be saved as a reusable workflow.

Call this tool after discussing the workflow requirements with the user. It validates the
candidate YAML content, checks for conflicts with existing workflow assets, and returns the
proposal result. The user can then review and apply the asset in the Chat right panel.
Saving a declaration does not run its steps or start its triggers.

Usage:
- \`name\`: Short descriptive name (1-80 chars), matching the YAML name
- \`description\`: What this workflow does (max 300 chars), matching the YAML description
- \`content\`: The full workflow YAML content`

export const Input = Schema.Struct({ name: Name, description: Description, content: Content })

export const Output = Schema.Struct({
  relativePath: Schema.String,
  exists: Schema.Boolean,
  revision: Schema.optional(Schema.String),
  nameConflict: Schema.Boolean,
  pathConflict: Schema.Boolean,
})

export function propose(input: typeof Input.Type, service: WorkflowAssetService.Interface) {
  return service
    .propose(Candidate.make(input))
    .pipe(
      Effect.mapError(
        (error) =>
          new ToolFailure({ message: `Proposal failed: ${error instanceof Error ? error.message : String(error)}` }),
      ),
    )
}

/**
 * Validate candidate YAML: must parse to a plain object and satisfy the
 * WorkflowAsset Frontmatter schema — the same contract the registry enforces
 * on load. Retained for parser compatibility callers; the service also validates
 * candidate identity and the graph before proposing or applying a new definition.
 */
export function validateContent(content: string): string | null {
  const MAX_PROPOSE_BYTES = 100_000
  const bytes = new TextEncoder().encode(content).length
  if (bytes > MAX_PROPOSE_BYTES) {
    return `Workflow content exceeds maximum ${MAX_PROPOSE_BYTES} UTF-8 bytes.`
  }
  const parsed = WorkflowAsset.parseContent(content)
  if (parsed.kind === "valid") return null
  if (parsed.errorTag === "parse_error") return "Invalid YAML format in workflow content."
  return 'Workflow content does not match the required schema. Required: kind: "workflow", name, description, version, steps: [{ id, name, agent }]; optional: triggers, step input.'
}

export const Plugin = {
  id: "omnixa.tool.propose_workflow_asset",
  effect: Effect.fn("ProposeWorkflowAssetTool.Plugin")(function* (ctx: Context) {
    if (!Flag.OMNIXA_EXPERIMENTAL_CHAT_ASSET) return

    const service = yield* WorkflowAssetService.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input) =>
            propose(input, service).pipe(
              Effect.map((result) => ({
                output: { ...result, revision: result.revision ?? undefined },
                metadata: { ...result },
                content: result.nameConflict
                  ? `Name conflicts with an existing workflow asset. Choose a different name.`
                  : result.pathConflict
                    ? `The target file has another workflow name. Review it before replacing it.`
                    : result.exists
                      ? `Workflow asset exists at "${result.relativePath}". Ask user to review before overwriting.`
                      : `Candidate is valid at "${result.relativePath}". Ask user to apply.`,
              })),
            ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
