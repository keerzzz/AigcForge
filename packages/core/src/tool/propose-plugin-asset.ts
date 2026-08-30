export * as ProposePluginAssetTool from "./propose-plugin-asset"

import { Effect, Layer, Option, Schema } from "effect"
import path from "path"
import yaml from "js-yaml"
import { ToolFailure } from "@aigcfroge/llm"
import { Flag } from "../flag/flag"
import { PluginAsset } from "../plugin-asset"
import { PluginAsset as SchemaPluginAsset } from "@aigcfroge/schema/plugin-asset"
import { PluginAssetPath } from "../plugin-asset/path"
import { FSUtil } from "../fs-util"
import { Location } from "../location"
import { Hash } from "../util/hash"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "propose_plugin_asset"

export const description = `Propose a new plugin asset to be saved as a reusable plugin configuration.

Call this tool after discussing the plugin requirements with the user. It validates the
candidate YAML content, checks for conflicts with existing plugin assets, and returns the
proposal result. The user can then review and apply the asset in the Chat right panel.

Usage:
- \`name\`: Short descriptive name (1-80 chars)
- \`description\`: What this plugin does (max 300 chars)
- \`content\`: The full plugin YAML content (must be valid .plugin.yaml format)`

export const Input = Schema.Struct({
  name: SchemaPluginAsset.Name,
  description: SchemaPluginAsset.Description,
  content: Schema.String,
})

export const Output = Schema.Struct({
  relativePath: Schema.String,
  exists: Schema.Boolean,
  revision: Schema.optional(Schema.String),
  nameConflict: Schema.Boolean,
  pathConflict: Schema.Boolean,
})

/** Inline propose logic (no typed service — §1.2 tech debt). */
export function propose(
  input: { name: string; description: string; content: string },
  deps: {
    pluginAsset: PluginAsset.Interface
    fs: FSUtil.Interface
    directory: string
  },
): Effect.Effect<
  {
    relativePath: string
    exists: boolean
    revision: string | undefined
    nameConflict: boolean
    pathConflict: boolean
  },
  ToolFailure
> {
  return Effect.gen(function* () {
    // 1. Validate YAML format + Frontmatter schema (same contract the registry enforces on load)
    const invalid = validateContent(input.content)
    if (invalid) {
      return yield* Effect.fail(new ToolFailure({ message: invalid }))
    }

    // 2. Build relative path from name
    let relativePath: string
    try {
      relativePath = PluginAssetPath.nameToRelativePath(input.name)
    } catch {
      return yield* Effect.fail(new ToolFailure({ message: `Invalid plugin name: ${input.name}` }))
    }

    // 3. Check file exists and get revision
    const targetPath = path.resolve(deps.directory, relativePath)
    const fileExists = yield* deps.fs.exists(targetPath).pipe(Effect.catch(() => Effect.succeed(false)))
    let revision: string | undefined
    if (fileExists) {
      const bytes = yield* deps.fs.readFile(targetPath).pipe(
        Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)),
        Effect.catch(() => Effect.succeed(undefined)),
      )
      if (bytes) {
        revision = Hash.sha256(Buffer.from(bytes))
      }
    }

    // 4. Check registry for name/path conflicts
    const existingName = yield* deps.pluginAsset.findByName(input.name)
    const existingPath = yield* deps.pluginAsset.getByPath(relativePath).pipe(Effect.option)

    return {
      relativePath,
      exists: fileExists,
      revision,
      nameConflict: existingName !== undefined && existingName.relativePath !== relativePath,
      pathConflict: Option.isSome(existingPath),
    }
  })
}

/**
 * Validate candidate YAML: must parse to a plain object and satisfy the
 * PluginAsset Frontmatter schema — the same contract the registry enforces
 * on load. Returns a failure message, or null when valid. Shared by propose
 * and the HTTP apply handler so both layers enforce one contract.
 */
export function validateContent(content: string): string | null {
  const MAX_PROPOSE_YAML = 1_000_000
  if (content.length > MAX_PROPOSE_YAML) {
    return `Plugin content exceeds maximum ${MAX_PROPOSE_YAML} bytes.`
  }
  let parsed: unknown
  try {
    parsed = yaml.load(content)
  } catch {
    return "Invalid YAML format in plugin content."
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "Plugin content must be a YAML object."
  }
  try {
    Schema.decodeUnknownSync(SchemaPluginAsset.Frontmatter)(parsed)
  } catch {
    return 'Plugin content does not match the required schema. Required: kind: "plugin", name, description, version; optional: category, author, source, hooks: [{ event, command }].'
  }
  return null
}

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    if (!Flag.AIGCFROGE_EXPERIMENTAL_CHAT_ASSET) return

    const tools = yield* Tools.Service
    const pluginAsset = yield* PluginAsset.Service
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service

    const tool = Tool.make({
      description,
      input: Input,
      output: Output,
      execute: (input) =>
        propose(input, {
          pluginAsset,
          fs,
          directory: location.directory,
        }).pipe(Effect.catch((err) => Effect.fail(new ToolFailure({ message: `Proposal failed: ${err.message}` })))),
      toModelOutput: ({ output }) => [
        {
          type: "text" as const,
          text: output.nameConflict
            ? `Name conflicts with an existing plugin asset. Choose a different name.`
            : output.pathConflict
              ? `Path conflict. Choose a different name.`
              : output.exists
                ? `Plugin asset exists at "${output.relativePath}". Ask user to review before overwriting.`
                : `Candidate is valid at "${output.relativePath}". Ask user to apply.`,
        },
      ],
    })

    yield* tools.register({ [name]: tool }).pipe(Effect.catch((err) => Effect.die(err)))
  }),
)
