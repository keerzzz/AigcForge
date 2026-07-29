import { describe, expect, test } from "bun:test"
import { textSimilarity, findSimilarPrompt, createPromptHistory } from "./repeat-detection"

describe("textSimilarity", () => {
  test("identical texts have similarity 1", () => {
    expect(textSimilarity("hello world", "hello world")).toBe(1)
  })

  test("completely different texts have low similarity", () => {
    expect(textSimilarity("hello world", "completely unrelated content here")).toBeLessThan(0.3)
  })

  test("handles case insensitivity", () => {
    expect(textSimilarity("Hello World", "hello world")).toBe(1)
  })

  test("ignores punctuation", () => {
    expect(textSimilarity("hello, world!", "hello world")).toBe(1)
  })

  test("partial overlap returns moderate similarity", () => {
    const sim = textSimilarity("create a prompt for code review", "create a prompt for testing")
    expect(sim).toBeGreaterThan(0.5)
    expect(sim).toBeLessThan(1)
  })
})

describe("findSimilarPrompt", () => {
  test("finds similar prompt in history", () => {
    const history = [
      "create a prompt for summarizing code",
      "set up a new project",
      "create a prompt for reviewing pull requests",
    ]
    const result = findSimilarPrompt("create a prompt for code review", history)
    expect(result).toBeDefined()
    expect(result!.similarity).toBeGreaterThanOrEqual(0.7)
  })

  test("returns undefined when no match", () => {
    const history = ["set up a new project", "install dependencies"]
    const result = findSimilarPrompt("create a prompt for code review", history)
    expect(result).toBeUndefined()
  })

  test("respects custom threshold", () => {
    const history = ["create a prompt for something"]
    // Very high threshold should not match near-identical
    const result = findSimilarPrompt("create a prompt for something else", history, 0.99)
    expect(result).toBeUndefined()
  })
})

describe("createPromptHistory", () => {
  test("stores and deduplicates consecutive entries", () => {
    const history = createPromptHistory()
    history.push("hello world")
    history.push("hello world")
    history.push("different text")
    expect(history.all().length).toBe(2)
  })

  test("finds similar prompts", () => {
    const history = createPromptHistory()
    history.push("create a prompt for code review")
    history.push("set up a new project")
    const result = history.findSimilar("create a prompt for reviewing code")
    expect(result).toBeDefined()
    expect(result!.similarity).toBeGreaterThanOrEqual(0.7)
  })
})
