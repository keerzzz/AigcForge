import type { Page } from "@playwright/test"
import type {
  AgentAssetListOutput,
  CommandAssetListOutput,
  PromptAssetListOutput,
  McpAssetListOutput,
  PluginAssetListOutput,
  JsonValue,
  SessionMessageInfo,
  SessionMessageToolStateCompleted,
  SkillAssetInfo,
  SkillAssetListOutput,
  WorkflowAssetListOutput,
} from "@aigcfroge/client/promise"
import { ApiNotFoundError } from "@aigcfroge/protocol/errors"
import { AssetPlacement } from "@aigcfroge/schema/asset-placement"
import { SkillAsset } from "@aigcfroge/schema/skill-asset"
import { Schema } from "effect"

export function body(name = " Review ") {
  return {
    name,
    description: "Review changed code",
    slash: false,
    content: "Use " + name.trim() + " to inspect the changed code.\n",
  }
}

export function facts(relativePath = "Review.md") {
  return { relativePath, exists: false, revision: null, nameConflict: false, pathConflict: false }
}

export function info(revision: string, content = body().content, target?: SkillAssetInfo["target"]): SkillAssetInfo {
  const result: SkillAssetInfo = {
    kind: "skill",
    ...body(),
    relativePath: "Review.md",
    revision: revision.repeat(64),
    content,
    triggers: [],
    tags: [],
  }

  if (target) result.target = target

  return result
}

export function history(
  label: string,
  input: Record<string, JsonValue> = body(),
  metadata: Record<string, JsonValue> | null = facts(),
  kind: "skill" | "command" | "prompt" | "agent" | "mcp" | "plugin" | "workflow" = "skill",
): SessionMessageInfo[] {
  const userID = "msg_" + kind + "_" + label + "_user"

  const state = {
    status: "completed",
    input,
    content: [{ type: "text", text: "Candidate ready" }],
  } satisfies SessionMessageToolStateCompleted

  if (metadata !== null) Object.assign(state, { metadata })

  return [
    {
      id: userID,
      type: "user",
      text: `Propose a ${kind}`,
      time: { created: 1 },
    },
    {
      id: "msg_" + kind + "_" + label + "_assistant",
      type: "assistant",
      time: { created: 2, completed: 3 },
      metadata: { parentID: userID },
      agent: "build",
      model: { providerID: "aigcfroge", id: "claude-opus-4-6", variant: "max" },
      content: [
        {
          type: "tool",
          id: "call_" + kind + "_" + label,
          name: `propose_${kind}_asset`,
          time: { created: 2, completed: 3 },
          state,
        },
      ],
    },
  ]
}

export type Reply = { status: number; json: unknown }

export type Call = { sessionID: string; url: URL; body: unknown }

export async function mock(
  page: Page,
  input: {
    apply: (call: Call, attempt: number) => Reply | Promise<Reply>
    kind?: "skill" | "command" | "prompt" | "agent" | "mcp" | "plugin" | "workflow"
    inspect?: (call: Call, attempt: number) => Reply | Promise<Reply>
    catalog?: (
      url: URL,
    ) =>
      | SkillAssetListOutput
      | CommandAssetListOutput
      | PromptAssetListOutput
      | AgentAssetListOutput
      | McpAssetListOutput
      | PluginAssetListOutput
      | WorkflowAssetListOutput
      | Promise<
          | SkillAssetListOutput
          | CommandAssetListOutput
          | PromptAssetListOutput
          | AgentAssetListOutput
          | McpAssetListOutput
          | PluginAssetListOutput
          | WorkflowAssetListOutput
        >
    content?: (url: URL) => Reply | Promise<Reply>
    remove?: (call: Call, attempt: number) => Reply | Promise<Reply>
  },
) {
  const kind = input.kind ?? "skill"
  const calls: Call[] = []
  const deletes: Call[] = []
  const deleteReplies: Call[] = []
  const reads: URL[] = []
  const readReplies: URL[] = []
  const replies: Call[] = []
  const inspections: Call[] = []
  const inspectionReplies: Call[] = []

  const headers = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  }

  await page.route(
    new RegExp(`(?:/${kind}-asset(?:/content)?|/session/[^/?]+/${kind}-asset/(?:inspect|apply|delete))(?:\\?|$)`),
    async (route) => {
      const request = route.request()
      const url = new URL(request.url())

      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers })

      if (request.method() === "GET") {
        reads.push(url)

        const reply =
          url.pathname === "/" + kind + "-asset"
            ? { status: 200, json: (await input.catalog?.(url)) ?? { assets: [], invalid: [] } }
            : ((await input.content?.(url)) ?? {
                status: 404,
                json: new ApiNotFoundError({ name: "NotFoundError", data: { message: "No scripted content" } }),
              })

        await route.fulfill({ ...reply, headers })
        readReplies.push(url)

        return
      }

      const match = url.pathname.match(new RegExp(`^/session/([^/]+)/${kind}-asset/(inspect|apply|delete)$`))

      if (request.method() !== "POST" || !match?.[1])
        throw new Error("Unexpected scripted asset route: " + request.method() + " " + url.pathname)

      const body: unknown = request.postDataJSON()
      const call = { sessionID: decodeURIComponent(match[1]), url, body }

      if (match[2] === "inspect") {
        if (kind !== "skill" && kind !== "command" && kind !== "prompt")
          throw new Error("This asset has no scripted inspect endpoint")

        if (kind === "command" && !input.inspect) throw new Error("Command inspect requires its own scripted reply")

        if (kind === "prompt" && !input.inspect) throw new Error("Prompt inspect requires its own scripted reply")

        inspections.push(call)
        const reply = input.inspect ? await input.inspect(call, inspections.length) : defaultInspection(call)
        await route.fulfill({ ...reply, headers })
        inspectionReplies.push(call)

        return
      }

      if (match[2] === "delete") {
        if (!input.remove) throw new Error("Asset deletion is not scripted")

        deletes.push(call)
        await route.fulfill({ ...(await input.remove(call, deletes.length)), headers })
        deleteReplies.push(call)

        return
      }

      calls.push(call)
      const reply = await input.apply(call, calls.length)
      await route.fulfill({ ...reply, headers })
      replies.push(call)
    },
  )

  return { calls, reads, readReplies, replies, deletes, deleteReplies, inspections, inspectionReplies }
}

function defaultInspection(call: Call): Reply {
  const input = Schema.decodeUnknownSync(
    Schema.Struct({ candidate: SkillAsset.Candidate, scope: AssetPlacement.Scope }),
  )(call.body)

  const directory = call.url.searchParams.get("directory")

  if (!directory) throw new Error("Skill inspect must retain its Session directory query")

  return {
    status: 200,
    json: {
      ...facts(input.candidate.relativePath),
      target: {
        scope: input.scope,
        root: input.scope === "global" ? "/global/config/skills" : directory + "/.aigcfroge/skills",
      },
    },
  }
}

export * as SkillAssets from "./skill-asset"
