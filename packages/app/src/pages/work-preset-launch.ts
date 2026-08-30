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

/**
 * 工作流资产卡片 → 新 draft 的引导 prompt（M1 计划 §3.5 D3，引导降级）。
 * 纯函数：workflow 的 name/description/steps 摘要内嵌 seed，首句点名"跳过预设加载"，
 * 引导 work-orchestrator 按内联任务规格执行（对应其 SYSTEM_PROMPT 兜底分支）。
 * 真执行引擎 M2 立项后此函数替换为直接派发，不做假执行（No Cheating）。
 */
export type WorkflowLaunchInput = {
  name: string
  description: string
  steps: ReadonlyArray<{ name?: string; agent?: string }>
}

export function workflowLaunch(input: WorkflowLaunchInput): string {
  const steps = input.steps.map((step, index) => `${index + 1}. ${step.name ?? step.agent ?? "未命名步骤"}`).join("；")
  const stepPart = steps ? `步骤：${steps}。` : "未定义步骤，请先向我澄清任务要求。"
  return `请按用户自定义工作流「${input.name}」执行，跳过预设加载（由你的工作流驱动，引导模式）。工作流说明：${input.description}。${stepPart}`
}
