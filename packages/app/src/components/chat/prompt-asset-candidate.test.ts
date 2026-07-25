import { describe, expect, test } from "bun:test"
import { findProposeResult, normalizeProposeCandidate } from "./prompt-asset-candidate"

const completed = (name: string, result: Record<string, unknown>) => ({
  type: "tool",
  tool: "propose_prompt_asset",
  state: {
    status: "completed",
    input: { name, description: `${name} description`, template: `${name} template` },
    structured: result,
  },
})

describe("normalizeProposeCandidate", () => {
  test("uses V1 metadata for revision-safe overwrite", () => {
    const candidate = normalizeProposeCandidate({
      tool: "propose_prompt_asset",
      state: {
        input: { name: "existing", description: "desc", template: "next" },
        output: 'Target "existing.md" exists.',
        metadata: {
          relativePath: "existing.md",
          exists: true,
          revision: "a".repeat(64),
          nameConflict: false,
          pathConflict: false,
        },
      },
    })

    expect(candidate).toMatchObject({
      relativePath: "existing.md",
      revision: "a".repeat(64),
      status: "exists",
      kind: "prompt",
      content: "next",
    })
  })

  test("normalizes per-kind candidates with unified content", () => {
    const skill = normalizeProposeCandidate({
      tool: "propose_skill_asset",
      state: {
        input: { name: "s", description: "d", slash: true, content: "SKILL BODY" },
        structured: { relativePath: "s.md", exists: false },
      },
    })
    expect(skill).toMatchObject({
      kind: "skill",
      content: "SKILL BODY",
      candidate: { name: "s", description: "d", slash: true, content: "SKILL BODY" },
    })

    const mcp = normalizeProposeCandidate({
      tool: "propose_mcp_asset",
      state: {
        input: { name: "m", description: "d", command: "npx", args: ["-y", "srv"], env: { KEY: "v" }, configJson: "{}" },
        structured: { relativePath: "m.md", exists: false },
      },
    })
    expect(mcp).toMatchObject({
      kind: "mcp",
      content: "{}",
      candidate: { command: "npx", args: ["-y", "srv"], env: { KEY: "v" }, configJson: "{}" },
    })

    const command = normalizeProposeCandidate({
      tool: "propose_command_asset",
      state: {
        input: { name: "c", description: "d", invocation: "/run", source: "RUN BODY" },
        structured: { relativePath: "c.md", exists: false },
      },
    })
    expect(command).toMatchObject({ kind: "command", content: "RUN BODY", candidate: { invocation: "/run", source: "RUN BODY" } })

    const agent = normalizeProposeCandidate({
      tool: "propose_agent_asset",
      state: {
        input: { name: "a", description: "d", config: "mode: subagent", source: "AGENT BODY" },
        structured: { relativePath: "a.md", exists: false },
      },
    })
    expect(agent).toMatchObject({ kind: "agent", content: "AGENT BODY", candidate: { config: "mode: subagent", source: "AGENT BODY" } })
  })

  test("rejects unknown tools and missing per-kind content", () => {
    expect(normalizeProposeCandidate({ tool: "propose_workflow_asset", state: { input: { name: "w" } } })).toBeNull()
    expect(normalizeProposeCandidate({ tool: "propose_skill_asset", state: { input: { name: "s" } } })).toBeNull()
    expect(normalizeProposeCandidate({ tool: "propose_mcp_asset", state: { input: { name: "m" } } })).toBeNull()
  })

  test("rejects malformed tool state", () => {
    expect(normalizeProposeCandidate({ tool: "propose_prompt_asset", state: null })).toBeNull()
    expect(normalizeProposeCandidate({ tool: "other", state: {} })).toBeNull()
  })
})

describe("findProposeResult", () => {
  test("returns the newest completed proposal", () => {
    const result = findProposeResult(
      [{ id: "old" }, { id: "new" }],
      {
        old: [completed("old", { relativePath: "old.md", exists: false })],
        new: [completed("new", { relativePath: "new.md", exists: false })],
      },
    )

    expect(result?.name).toBe("new")
    expect(result?.relativePath).toBe("new.md")
  })

  test("skips incomplete and malformed parts", () => {
    const result = findProposeResult(
      [{ id: "message" }],
      {
        message: [
          null,
          { type: "tool", tool: "propose_prompt_asset", state: { status: "running" } },
          completed("valid", { relativePath: "valid.md", exists: false }),
        ],
      },
    )

    expect(result?.name).toBe("valid")
  })

  test("detects non-prompt propose tools", () => {
    const result = findProposeResult(
      [{ id: "message" }],
      {
        message: [
          completed("old", { relativePath: "old.md", exists: false }),
          {
            type: "tool",
            tool: "propose_skill_asset",
            state: {
              status: "completed",
              input: { name: "sk", description: "d", slash: false, content: "BODY" },
              structured: { relativePath: "sk.md", exists: false },
            },
          },
        ],
      },
    )

    expect(result?.kind).toBe("skill")
    expect(result?.name).toBe("sk")
    expect(result?.content).toBe("BODY")
  })
})
