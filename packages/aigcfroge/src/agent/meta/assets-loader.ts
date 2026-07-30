/**
 * Asset kinds and their corresponding subdirectory names under `.aigcfroge/`.
 * The value is either a string (single subdirectory name) or a function `(name: string) => boolean` for custom matching.
 */
export const ASSET_KIND_DIRS: Record<string, { dir: string; extractNames: (entries: string[]) => string[] }> = {
  prompt: {
    dir: ".aigcfroge/prompts",
    // Each prompt is a subdirectory; the directory name is the prompt name.
    extractNames: (entries) => entries.filter((e) => !e.startsWith(".")),
  },
  skill: {
    dir: ".aigcfroge/skills",
    extractNames: (entries) => entries.filter((e) => !e.startsWith(".")),
  },
  mcp: {
    dir: ".aigcfroge/mcps",
    // MCP assets are `.json` files; strip the extension for the name.
    extractNames: (entries) =>
      entries.filter((e) => e.endsWith(".json")).map((e) => e.slice(0, -".json".length)),
  },
  command: {
    dir: ".aigcfroge/commands",
    // Command assets are `.md` files; strip the extension for the name.
    extractNames: (entries) =>
      entries.filter((e) => e.endsWith(".md")).map((e) => e.slice(0, -".md".length)),
  },
  agent: {
    dir: ".aigcfroge/agents",
    // Agent assets are `.agent.md` files; strip the extension for the name.
    extractNames: (entries) =>
      entries.filter((e) => e.endsWith(".agent.md")).map((e) => e.slice(0, -".agent.md".length)),
  },
  workflow: {
    dir: ".aigcfroge/workflows",
    // Workflow assets are `.yaml` files; strip the extension for the name.
    extractNames: (entries) =>
      entries.filter((e) => e.endsWith(".yaml")).map((e) => e.slice(0, -".yaml".length)),
  },
  plugin: {
    dir: ".aigcfroge/plugins",
    extractNames: (entries) => entries.filter((e) => !e.startsWith(".")),
  },
}

export type AssetEntry = { kind: string; name: string }

/**
 * Scans `.aigcfroge/` directories inside the given project root and returns
 * a flat list of { kind, name } pairs representing available chat mode assets.
 *
 * This is a pure (async) function — no Effect services required.
 */
export async function scanAssets(projectRoot: string): Promise<AssetEntry[]> {
  const fs = await import("fs/promises")
  const path = await import("path")
  const results: AssetEntry[] = []

  for (const [kind, config] of Object.entries(ASSET_KIND_DIRS)) {
    const dirPath = path.join(projectRoot, config.dir)
    try {
      const entries = await fs.readdir(dirPath)
      const names = config.extractNames(entries)
      for (const name of names) {
        results.push({ kind, name })
      }
    } catch {
      // Directory doesn't exist or can't be read — skip silently
    }
  }

  return results
}
