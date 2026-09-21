import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { WorkContract } from "@aigcfroge/schema/work-contract"
import { WorkPresetRegistry } from "@aigcfroge/core/session/work-preset"
import { presetLaunch, workflowDraft, workflowLaunch } from "./work-preset-launch"

describe("presetLaunch", () => {
  // mode=work / agent 绑定由 modeDraft + policy 保证，覆盖见 context/mode.test.ts
  test("seed prompt names the preset id and requests guidance + clarification", () => {
    const storyboard = WorkPresetRegistry.byId("storyboard-video")!
    const prompt = presetLaunch(storyboard)
    expect(prompt).toContain("storyboard-video")
    expect(prompt).toContain("加载预设指引")
    expect(prompt).toContain("视频主题")
  })
})

describe("workflowLaunch", () => {
  test("seed names the workflow, embeds description + step summary, signals skip-preset", () => {
    const seed = workflowLaunch({
      name: "发布会工作流",
      description: "从需求到发布稿的完整流程",
      steps: [
        { name: "需求澄清", agent: "orchestrator" },
        { name: "撰写发布稿", agent: "writer" },
      ],
    })
    expect(seed).toContain("发布会工作流")
    expect(seed).toContain("从需求到发布稿的完整流程")
    expect(seed).toContain("需求澄清")
    expect(seed).toContain("撰写发布稿")
    expect(seed).toContain("跳过预设加载")
  })

  test("empty steps fall back to asking the orchestrator to clarify the task", () => {
    const seed = workflowLaunch({ name: "PRD 审查", description: "", steps: [] })
    expect(seed).toContain("PRD 审查")
    expect(seed).toContain("步骤")
  })
})

describe("workflowDraft", () => {
  test("pins the prompt and contract to the same fetched workflow revision", () => {
    const draft = workflowDraft({
      name: "Updated workflow",
      description: "Current content",
      relativePath: "updated.md",
      revision: "b".repeat(64),
      steps: [{ name: "Current step" }],
    })
    expect(draft.initialPrompt).toContain("Updated workflow")
    expect(draft.initialPrompt).toContain("Current content")
    expect(draft.initialPrompt).toContain("Current step")
    expect(Schema.encodeSync(WorkContract.Workflow)(draft.workContract)).toEqual({
      source: "workflow",
      contractVersion: 1,
      workflowID: "updated.md",
      revision: "b".repeat(64),
    })
  })

  test("rejects an invalid revision instead of creating a workflow contract", () => {
    expect(() =>
      workflowDraft({ name: "Invalid", description: "", steps: [], relativePath: "invalid.md", revision: "invalid" }),
    ).toThrow()
  })
})
