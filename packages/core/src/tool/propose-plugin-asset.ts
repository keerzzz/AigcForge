export * as ProposePluginAssetTool from "./propose-plugin-asset.js"

import type { Context } from "@aigcfroge/plugin/effect/plugin"
import { ToolFailure } from "@aigcfroge/ai"
import { Candidate, Content, Description, Name } from "@aigcfroge/schema/plugin-asset"
import { Effect, Schema } from "effect"
import { Flag } from "../flag/flag.js"
import { PluginAsset } from "../plugin-asset.js"
import { PluginAssetService } from "../plugin-asset-service.js"

export const name = "propose_plugin_asset"

export const description = `Propose a plugin declaration to be saved as a reusable .plugin.yaml file.

Call this tool after discussing the plugin requirements with the user. It validates the
candidate YAML content, checks for conflicts with existing plugin assets, and returns the
proposal result. Saving this declaration does not install or activate it as an executable plugin.

Usage:
- \`name\`: Short descriptive name (1-80 chars), matching the YAML name
- \`description\`: What this plugin does (max 300 chars), matching the YAML description
- \`content\`: The full plugin YAML content (must be valid .plugin.yaml format)`

export const Input = Schema.Struct({ name: Name, description: Description, content: Content })

export const Output = Schema.Struct({
  relativePath: Schema.String,
  exists: Schema.Boolean,
  revision: Schema.optional(Schema.String),
  nameConflict: Schema.Boolean,
  pathConflict: Schema.Boolean,
})

export function propose(input: typeof Input.Type, service: PluginAssetService.Interface) {
  return service
    .propose(Candidate.make(input))
    .pipe(
      Effect.mapError(
        (error) =>
          new ToolFailure({ message: `Proposal failed: ${error instanceof Error ? error.message : String(error)}` }),
      ),
    )
}

export function validateContent(content: string): string | null {
  if (content.length > 1_000_000) return "Plugin content exceeds maximum 1000000 bytes."
  const parsed = PluginAsset.parseContent(content)
  if (parsed.kind === "valid") return null
  if (parsed.errorTag === "parse_error") return "Invalid YAML format in plugin content."
  return 'Plugin content does not match the required schema. Required: kind: "plugin", name, description, version; optional: category, author, source, hooks: [{ event, command }].'
}

export const Plugin = {
  id: "aigcfroge.tool.propose_plugin_asset",
  effect: Effect.fn("ProposePluginAssetTool.Plugin")(function* (ctx: Context) {
    if (!Flag.AIGCFROGE_EXPERIMENTAL_CHAT_ASSET) return
    const service = yield* PluginAssetService.Service

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
                  ? "Name conflicts with an existing plugin asset. Choose a different name."
                  : result.pathConflict
                    ? "The target file has another plugin name. Review it before replacing it."
                    : result.exists
                      ? `Plugin asset exists at "${result.relativePath}". Ask user to review before overwriting.`
                      : `Candidate is valid at "${result.relativePath}". Ask user to apply.`,
              })),
            ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
