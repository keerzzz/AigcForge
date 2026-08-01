import { WorkPreset } from "@aigcfroge/schema/work-preset"

export type PresetLaunch = {
  mode: "work"
  agent: "work-orchestrator"
  seedPrompt: string
}

/**
 * 预设卡片点击 → 新 draft 参数。纯函数，与渲染分离便于测试。
 * seedPrompt 引导 work-orchestrator 用指定预设：首句点名 preset id，
 * 后续加载指引并澄清。
 */
export function presetLaunch(preset: WorkPreset.Preset): PresetLaunch {
  const questions = preset.questions.map((q) => q.prompt).join("；")
  return {
    mode: "work",
    agent: "work-orchestrator",
    seedPrompt: `请使用官方预设「${preset.title}」（id: ${preset.id}）起草一份 Markdown 文档。先加载预设指引，然后向我澄清关键信息：${questions}。`,
  }
}
