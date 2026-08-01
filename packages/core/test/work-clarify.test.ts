import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { QuestionV2 } from "@aigcfroge/core/question"
import { WorkPresetRegistry } from "../src/session/work-preset"
import { toClarifyingQuestions, allRequiredForGuided } from "../src/session/work-clarify"

describe("toClarifyingQuestions", () => {
  test("maps every preset question to a QuestionV2.Prompt", () => {
    const storyboard = WorkPresetRegistry.byId("storyboard-video")!
    const prompts = toClarifyingQuestions(storyboard)
    expect(prompts).toHaveLength(storyboard.questions.length)
    for (const prompt of prompts) {
      expect(() => Schema.decodeUnknownSync(QuestionV2.Prompt)(prompt)).not.toThrow()
      expect(prompt.question.length).toBeGreaterThan(0)
      expect(prompt.header.length).toBeGreaterThan(0)
      expect(Array.isArray(prompt.options)).toBe(true)
    }
  })

  test("maps options to question choices", () => {
    const storyboard = WorkPresetRegistry.byId("storyboard-video")!
    const prompts = toClarifyingQuestions(storyboard)
    const duration = prompts.find((p) => p.question.includes("时长"))
    expect(duration?.options.length).toBeGreaterThan(0)
  })

  test("keeps question order matching the preset", () => {
    const prd = WorkPresetRegistry.byId("write-prd")!
    const prompts = toClarifyingQuestions(prd)
    expect(prompts.map((p) => p.question)).toEqual(prd.questions.map((q) => q.prompt))
  })

  test("guided presets mark every question required", () => {
    const storyboard = WorkPresetRegistry.byId("storyboard-video")!
    expect(storyboard.guided).toBe(true)
    expect(allRequiredForGuided(storyboard)).toBe(true)
  })
})
