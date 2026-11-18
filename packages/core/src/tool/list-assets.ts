export * as ListAssetsTool from "./list-assets.js"

import type { Context } from "@aigcfroge/plugin/effect/plugin"
import { ToolFailure } from "@aigcfroge/ai"
import { FSUtil } from "@aigcfroge/util/fs-util"
import { Effect, Option, Schema } from "effect"
import path from "node:path"
import { Location } from "../location.js"
import { LocationMutation } from "../location-mutation.js"
import { Global } from "@aigcfroge/util/global"
import { SessionStore } from "../session/store.js"
import { Skill } from "../skill.js"

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

const toModelContent = (assets: ReadonlyArray<{ kind: string; name: string; relativePath: string }>) => {
  if (assets.length === 0) return "No assets found."
  const byKind = new Map<string, Array<{ kind: string; name: string; relativePath: string }>>()
  for (const asset of assets) {
    const list = byKind.get(asset.kind) ?? []
    list.push(asset)
    byKind.set(asset.kind, list)
  }
  const lines = [`Found ${assets.length} asset(s):`]
  for (const [kind, kindAssets] of byKind) {
    lines.push(`- **${kind}**: ${kindAssets.map((asset) => asset.name).join(", ")}`)
  }
  return lines.join("\n")
}

export const Plugin = {
  id: "aigcfroge.tool.list_assets",
  effect: Effect.fn("ListAssetsTool.Plugin")(function* (ctx: Context) {
    const location = yield* Location.Service
    const fs = yield* FSUtil.Service
    const sessions = Option.getOrUndefined(yield* Effect.serviceOption(SessionStore.Service))
    const skills = Option.getOrUndefined(yield* Effect.serviceOption(Skill.Service))
    const mutation = Option.getOrUndefined(yield* Effect.serviceOption(LocationMutation.Service))
    const global = Option.getOrUndefined(yield* Effect.serviceOption(Global.Service))

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              if ((yield* fs.stat(location.directory)).type !== "Directory")
                return yield* new ToolFailure({
                  message: `Failed to list assets: Location root is not a directory: ${location.directory}`,
                })
              const all = (yield* Effect.forEach(Object.entries(KIND_DIRS), ([kind, config]) =>
                fs.readDirectory(path.join(location.directory, config.dir)).pipe(
                  Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed([])),
                  Effect.map((entries) =>
                    entries
                      .filter((entry) => !entry.startsWith("."))
                      .map((entry) => ({
                        kind,
                        name: entry
                          .replace(/\.agent\.md$/, "")
                          .replace(/\.json$/, "")
                          .replace(/\.yaml$/, "")
                          .replace(/\.md$/, ""),
                        relativePath: `${config.dir}/${entry}`,
                      })),
                  ),
                ),
              )).flat()
              const assets = input.kind ? all.filter((asset) => asset.kind === input.kind) : all
              const session = sessions === undefined ? undefined : yield* sessions.get(context.sessionID)
              if (
                session === undefined ||
                session.mode === "custom" ||
                session.location.directory !== location.directory ||
                session.location.workspaceID !== location.workspaceID
              )
                return { output: { assets }, content: toModelContent(assets) }
              if (skills === undefined || mutation === undefined || global === undefined)
                return yield* new ToolFailure({ message: "Asset publication sources are unavailable for this Session" })
              const { AssetPublication } = yield* Effect.promise(() => import("../asset-publication.js"))
              const publication = yield* AssetPublication.read({ fs, mutation, location, global }, yield* skills.list())
              return {
                output: { assets },
                content: [
                  toModelContent(assets),
                  "Definition inventory and registered Skills do not grant execution permissions.",
                  ...AssetPublication.toModelAssets(publication).map((asset) => `${asset.kind}: ${asset.name}`),
                ].join("\n"),
                metadata: { publication: Schema.encodeSync(AssetPublication.Json)(publication) },
              }
            }).pipe(
              Effect.mapError((error) =>
                error instanceof ToolFailure
                  ? error
                  : new ToolFailure({ message: `Failed to list assets: ${error.message}` }),
              ),
            ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
