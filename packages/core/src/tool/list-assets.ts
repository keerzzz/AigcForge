export * as ListAssetsTool from "./list-assets"

import { ToolFailure } from "@aigcfroge/llm"
import { Effect, Layer, Schema } from "effect"
import { Location } from "../location"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "list_assets"

export const description = `List available chat mode assets (prompts, skills, MCP configs, commands, agents, workflows, plugins) in the current project.

Each asset entry includes its kind, name, and relative path in the .aigcfroge/ directory.
The agent can then use "read" to view the full content of an asset by its relative path.

Usage:
- \`kind\` (optional): filter by asset type (e.g. "prompt", "skill", "mcp", "command", "agent", "workflow", "plugin"). If omitted, returns all asset types.`

const KIND_DIRS: Record<string, { dir: string }> = {
  prompt: { dir: ".aigcfroge/prompts" },
  skill: { dir: ".aigcfroge/skills" },
  mcp: { dir: ".aigcfroge/mcps" },
  command: { dir: ".aigcfroge/commands" },
  agent: { dir: ".aigcfroge/agents" },
  workflow: { dir: ".aigcfroge/workflows" },
  plugin: { dir: ".aigcfroge/plugins" },
  "custom-profile": { dir: ".aigcfroge/custom-profiles" },
}

export const Input = Schema.Struct({
  kind: Schema.optional(Schema.String),
})

export const Output = Schema.Struct({
  assets: Schema.Array(
    Schema.Struct({
      kind: Schema.String,
      name: Schema.String,
      relativePath: Schema.String,
    }),
  ),
})

async function scanDir(dirPath: string): Promise<{ kind: string; name: string; relativePath: string }[]> {
  const fs = await import("fs/promises")
  const path = await import("path")
  const results: { kind: string; name: string; relativePath: string }[] = []

  for (const [kind, config] of Object.entries(KIND_DIRS)) {
    const kindDir = path.join(dirPath, config.dir)
    try {
      const entries = await fs.readdir(kindDir)
      for (const entry of entries) {
        if (entry.startsWith(".")) continue
        // Strip file extensions for known formats
        const name = entry
          .replace(/\.agent\.md$/, "")
          .replace(/\.json$/, "")
          .replace(/\.yaml$/, "")
          .replace(/\.md$/, "")
        results.push({
          kind,
          name,
          relativePath: `${config.dir}/${entry}`,
        })
      }
    } catch {
      // Directory doesn't exist — skip silently
    }
  }

  return results
}

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const location = yield* Location.Service

    yield* tools.register({
      [name]: Tool.make({
        description,
        input: Input,
        output: Output,
        execute: (input) =>
          Effect.gen(function* () {
            const all = yield* Effect.promise(() => scanDir(location.directory))
            const assets = input.kind
              ? all.filter((a) => a.kind === input.kind)
              : all
            return { assets }
          }).pipe(
            Effect.catch((err) =>
              Effect.fail(new ToolFailure({ message: `Failed to list assets: ${(err as Error).message}` })),
            ),
          ),
        toModelOutput: ({ output }) => {
          if (output.assets.length === 0) {
            return [{ type: "text" as const, text: "No assets found." }]
          }
          const byKind = new Map<string, Array<{ kind: string; name: string; relativePath: string }>>()
          for (const asset of output.assets) {
            const list = byKind.get(asset.kind) ?? []
            list.push(asset)
            byKind.set(asset.kind, list)
          }
          const lines = [`Found ${output.assets.length} asset(s):`]
          for (const [kind, assets] of byKind) {
            lines.push(`- **${kind}**: ${assets.map((a) => a.name).join(", ")}`)
          }
          return [{ type: "text" as const, text: lines.join("\n") }]
        },
      }),
    })
  }),
)
