import { describe, expect, test } from "bun:test"
import { WorkPresetRegistry } from "@aigcfroge/core/session/work-preset"
import { presetLaunch } from "./work-preset-launch"

describe("presetLaunch", () => {
  test("binds every preset to a mode=work draft with work-orchestrator", () => {
    for (const preset of WorkPresetRegistry.list()) {
      const launch = presetLaunch(preset)
      expect(launch.mode).toBe("work")
      expect(launch.agent).toBe("work-orchestrator")
    }
  })

  test("seed prompt names the preset id and requests guidance + clarification", () => {
    const storyboard = WorkPresetRegistry.byId("storyboard-video")!
    const launch = presetLaunch(storyboard)
    expect(launch.seedPrompt).toContain("storyboard-video")
    expect(launch.seedPrompt).toContain("加载预设指引")
    expect(launch.seedPrompt).toContain("视频主题")
  })
})
