import { WorkPreset } from "@aigcfroge/schema/work-preset"

/**
 * 预设卡片点击 → 新 draft 的引导 prompt。纯函数，与渲染分离便于测试。
 * 首句点名 preset id，引导 work-orchestrator 加载指引并澄清。
 * mode/agent 绑定由 modeDraft("work") + product-mode-agent-policy 强制，不在此返回。
 */
export function presetLaunch(preset: WorkPreset.Preset): string {
  const questions = preset.questions.map((q) => q.prompt).join("；")
  return `请使用官方预设「${preset.title}」（id: ${preset.id}）起草一份 Markdown 文档。先加载预设指引，然后向我澄清关键信息：${questions}。`
}
