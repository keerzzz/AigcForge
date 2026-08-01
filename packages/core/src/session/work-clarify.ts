export * as WorkClarify from "./work-clarify"

import { QuestionV2 } from "../question"
import { WorkPreset } from "@aigcfroge/schema/work-preset"

/**
 * M1 澄清闭环：把预设的澄清问题转成 question tool 可用的问卷。
 * work-orchestrator 缺关键信息时用它弹问卷（Phase D）。
 */
export const toClarifyingQuestions = (preset: WorkPreset.Preset): ReadonlyArray<QuestionV2.Prompt> =>
  preset.questions.map((question) => ({
    question: question.prompt,
    header: question.key.slice(0, 30),
    options: (question.options ?? []).map((label) => ({ label, description: "" })),
  }))

/** 小白模式（guided: true）强制走问卷，不生成空泛模板（PRD §7）。 */
export const allRequiredForGuided = (preset: WorkPreset.Preset): boolean => preset.guided
