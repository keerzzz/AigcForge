import { describe, expect, test } from "bun:test"
import { applyAssetCandidate } from "./asset-insert"
import type { CandidateInfo } from "./prompt-asset-candidate"
import type { DirectorySDK } from "@/context/sdk"

/**
 * `applyAssetCandidate` is the single apply dispatcher behind the Chat review panel, and
 * the per-kind difference that matters is whether `relativePath` rides along: prompt,
 * skill, mcp, command and agent carry one, while workflow, plugin and custom-profile
 * send the candidate as-is. A work-sourced prompt candidate is the case that made this
 * load-bearing — it carries an empty path on purpose and the server derives the real one
 * from the name, so dropping the field would change where the file lands.
 *
 * This replaces `toContain("relativePath: candidate.relativePath")` assertions on the
 * source text of this module, which passed whether or not the call was ever made.
 */
type ApplyPayload = {
  sessionID: string
  baseRevision: string | undefined
  overwrite: boolean
  candidate: Record<string, unknown>
}
type Call = { route: string; payload: ApplyPayload }

function fakeClient() {
  const calls: Call[] = []
  const record = (route: string) => (payload: ApplyPayload) => {
    calls.push({ route, payload })
    return Promise.resolve({ data: {} })
  }
  // Only the apply methods this dispatcher can reach. The generated client type has
  // hundreds of members, so a structurally complete double is not writable; this is the
  // narrowing escape the rule is warning about, taken deliberately for a test double.
  // oxlint-disable-next-line no-unsafe-type-assertion
  const client = {
    promptAsset: { apply: record("promptAsset.apply") },
    skillAsset: { apply: record("skillAsset.apply") },
    workflowAsset: { apply: record("workflowAsset.apply") },
  } as unknown as DirectorySDK["client"]
  return { client, calls }
}

const base = {
  name: "视频分镜脚本",
  description: "from a work draft",
  content: "# 视频分镜脚本\n\n第一段",
  exists: false,
  nameConflict: false,
  pathConflict: false,
  status: "valid" as const,
}

const workPrompt: CandidateInfo = {
  ...base,
  // What `captureWorkArtifactAsCandidate` produces: no path, no base revision.
  relativePath: "",
  revision: null,
  kind: "prompt",
  candidate: { name: base.name, description: base.description, template: base.content },
}

describe("applyAssetCandidate", () => {
  test("a work-sourced prompt keeps its empty relativePath and sends no base revision", async () => {
    const { client, calls } = fakeClient()

    await applyAssetCandidate(client, { sessionID: "ses_work", candidate: workPrompt, overwrite: false })

    expect(calls).toHaveLength(1)
    expect(calls[0].route).toBe("promptAsset.apply")
    expect(calls[0].payload).toEqual({
      sessionID: "ses_work",
      baseRevision: undefined,
      overwrite: false,
      candidate: { name: base.name, description: base.description, template: base.content, relativePath: "" },
    })
  })

  test("an existing asset forwards its path, revision and the overwrite flag", async () => {
    const { client, calls } = fakeClient()
    const candidate: CandidateInfo = {
      ...base,
      exists: true,
      status: "exists",
      relativePath: "skills/review.md",
      revision: "rev-7",
      kind: "skill",
      candidate: {
        name: base.name,
        description: base.description,
        slash: false,
        content: base.content,
        triggers: [],
        tags: [],
      },
    }

    await applyAssetCandidate(client, { sessionID: "ses_chat", candidate, overwrite: true })

    expect(calls[0].route).toBe("skillAsset.apply")
    expect(calls[0].payload.baseRevision).toBe("rev-7")
    expect(calls[0].payload.overwrite).toBe(true)
    expect(calls[0].payload.candidate.relativePath).toBe("skills/review.md")
  })

  test("a workflow candidate is sent as-is, without a relativePath field", async () => {
    const { client, calls } = fakeClient()
    const candidate: CandidateInfo = {
      ...base,
      relativePath: "workflows/ignored.md",
      revision: null,
      kind: "workflow",
      candidate: { name: base.name, description: base.description, content: base.content },
    }

    await applyAssetCandidate(client, { sessionID: "ses_chat", candidate, overwrite: false })

    expect(calls[0].route).toBe("workflowAsset.apply")
    expect(calls[0].payload.candidate).not.toHaveProperty("relativePath")
  })
})
