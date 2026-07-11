export * as AgentFileLoader from "./file-loader"

import { Context, Effect, Layer, Option } from "effect"
import { Agent } from "@aigcfroge/schema/agent"
import { FSUtil } from "../fs-util"
import { Location } from "../location"
import matter from "gray-matter"

/**
 * File-based agent definition.
 * Parsed from `.claude/agents/*.agent.md` YAML frontmatter + markdown body.
 */
export interface FileAgent {
  readonly info: Agent.Info
  readonly sourcePath: string
}

/** Frontmatter shape expected from .agent.md files. */
interface AgentFrontmatter {
  name?: string
  description?: string
  model?: string | string[]
  tools?: string[]
  "user-invocable"?: boolean
  handoffs?: Array<{ label: string; agent: string; prompt: string; send?: boolean; model?: string }>
}

export interface Interface {
  /** Scan agents directories and return all file-defined agents. */
  readonly loadAll: () => Effect.Effect<FileAgent[]>
  /** Load a single agent file by path. Returns undefined if not found or invalid. */
  readonly loadFile: (filePath: string) => Effect.Effect<FileAgent | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/AgentFileLoader") {}

/**
 * Parse a raw .agent.md string into a FileAgent.
 * Exported for direct testing without filesystem mocking.
 */
export function parseAgentFile(sourcePath: string, raw: string): FileAgent | undefined {
  let parsed: matter.GrayMatterFile<string>
  try {
    parsed = matter(raw)
  } catch {
    return undefined
  }
  const data = parsed.data as AgentFrontmatter
  if (!data.name) return undefined

  const id = data.name as Agent.ID

  // Map tools → permissions (allow ruleset)
  const permissions = Array.isArray(data.tools)
    ? data.tools.map((tool) => ({ action: tool, resource: "*", effect: "allow" as const }))
    : []

  // Map handoffs from frontmatter — validate against Handoff schema
  const handoffs: Array<{ label: string; agent: string; prompt: string; send?: boolean; model?: string }> = Array.isArray(data.handoffs)
    ? data.handoffs.filter((h): h is { label: string; agent: string; prompt: string } => typeof h.label === "string" && typeof h.agent === "string" && typeof h.prompt === "string")
    : []

  return {
    sourcePath,
    info: {
      ...Agent.Info.empty(id),
      description: data.description,
      system: parsed.content.trim() || undefined,
      hidden: data["user-invocable"] === false,
      permissions,
      handoffs,
    },
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fsutil = yield* FSUtil.Service
    const location = yield* Location.Service

    const agentsDir = location.directory + "/.claude/agents"

    const loadFile = Effect.fn("AgentFileLoader.loadFile")(function* (filePath: string) {
      const raw = yield* fsutil.readFileStringSafe(filePath).pipe(Effect.option)
      if (Option.isNone(raw) || !raw.value) return undefined
      return parseAgentFile(filePath, raw.value)
    })

    const loadAll = Effect.fn("AgentFileLoader.loadAll")(function* () {
      const results: FileAgent[] = []
      const entries = yield* fsutil.readDirectoryEntries(agentsDir).pipe(Effect.option)
      if (Option.isNone(entries)) return results
      for (const entry of entries.value) {
        if (!entry.name.endsWith(".agent.md")) continue
        const filePath = agentsDir + "/" + entry.name
        const agent = yield* loadFile(filePath)
        if (agent) results.push(agent)
      }
      return results
    })

    return Service.of({ loadAll, loadFile })
  }),
)
