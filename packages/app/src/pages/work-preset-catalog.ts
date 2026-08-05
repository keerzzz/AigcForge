import { WorkPreset } from "@aigcfroge/schema/work-preset"
import { WorkPresetRegistry } from "@aigcfroge/core/session/work-preset"

export const CATEGORIES = ["it-development", "video-creation", "academic", "general-office"] as const

/** 预留预设：仅展示卡片（"即将上线"），无创建入口（M1 计划 §3.1 预留 8+ 预设）。 */
const RESERVED: Record<(typeof CATEGORIES)[number], string[]> = {
  "it-development": ["BA Gherkin 用例", "架构 ADR"],
  "video-creation": ["游戏 GDD", "口播脚本"],
  academic: ["论文大纲", "研究计划书"],
  "general-office": ["会议纪要", "竞品分析报告"],
}

export type WorkPresetCategory = (typeof CATEGORIES)[number]

export type WorkPresetCategoryView = {
  category: WorkPresetCategory
  labelKey: string
  presets: WorkPreset.Preset[]
  reserved: string[]
}

export function buildWorkPresetCatalog(): { categories: WorkPresetCategoryView[] } {
  const categories = CATEGORIES.map((category) => {
    const presets = WorkPresetRegistry.list().filter((preset) => preset.category === category)
    return {
      category,
      labelKey: `work.preset.category.${category}`,
      presets,
      reserved: RESERVED[category],
    }
  })
  return { categories }
}
