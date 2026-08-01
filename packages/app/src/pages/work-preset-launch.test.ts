import { describe, expect, test } from "bun:test"
import { WorkPresetRegistry } from "@aigcfroge/core/session/work-preset"
import { presetLaunch } from "./work-preset-launch"

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
