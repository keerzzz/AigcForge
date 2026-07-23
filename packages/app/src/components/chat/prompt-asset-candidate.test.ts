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
    })
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
})
