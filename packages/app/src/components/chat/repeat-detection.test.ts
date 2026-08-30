import { describe, expect, test } from "bun:test"
import { textSimilarity, countSimilarPrompts, extractUserPrompts, freshRepeatState } from "./repeat-detection"

function fakePart(text: string) {
  return { type: "text" as const, text }
}

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

  test("CJK text similarity via bigrams", () => {
    const sim = textSimilarity("帮我写一个React组件", "帮我写一个React组件")
    expect(sim).toBe(1)
  })

  test("CJK partial overlap", () => {
    const sim = textSimilarity("帮我写一个React组件包含按钮", "帮我写一个React组件包含表单")
    expect(sim).toBeGreaterThan(0.4)
    expect(sim).toBeLessThan(1)
  })
})

describe("countSimilarPrompts", () => {
  test("returns undefined when < 3 similar in history", () => {
    const history = ["hello world", "how are you"]
    expect(countSimilarPrompts("hello world", history)).toBeUndefined()
  })

  test("returns match when >= 3 similar", () => {
    const history = [
      "write a test for the login page",
      "write a test for the signup page",
      "write a test for the dashboard page",
    ]
    const result = countSimilarPrompts("write a test for the profile page", history)
    expect(result).toBeDefined()
    expect(result!.count).toBe(3)
  })

  test("returns undefined for 2 similar (below threshold)", () => {
    const history = ["hello world", "hello world", "something else"]
    expect(countSimilarPrompts("hello world", history)).toBeUndefined()
  })

  test("respects custom threshold", () => {
    const history = ["hello world", "hello earth", "hello moon"]
    // With threshold 0.99 these barely-overlapping entries won't match
    expect(countSimilarPrompts("hello world", history, 0.99)).toBeUndefined()
  })

  test("CJK: detects repeated similar Chinese prompts", () => {
    const history = [
      "帮我写一个React组件包含按钮和输入框",
      "帮我写一个React组件包含按钮和表单",
      "帮我写一个React组件包含按钮和表格",
    ]
    const result = countSimilarPrompts("帮我写一个React组件包含按钮和下拉框", history)
    expect(result).toBeDefined()
    expect(result!.count).toBe(3)
  })

  test("CJK: below threshold with only 2 similar Chinese prompts", () => {
    const history = ["帮我写一个React组件", "帮我写一个React组件", "完全不相关的文本完全不同的话题"]
    expect(countSimilarPrompts("帮我写一个React组件", history)).toBeUndefined()
  })
})

describe("extractUserPrompts", () => {
  test("extracts user prompts in order", () => {
    const msgs = [
      { role: "user" as const, id: "u1" },
      { role: "assistant" as const, id: "a1" },
      { role: "user" as const, id: "u2" },
    ]
    const getParts = (id: string) => {
      if (id === "u1") return [fakePart("Hello World!")]
      if (id === "u2") return [fakePart("How are you?")]
      return []
    }
    const prompts = extractUserPrompts(msgs, getParts)
    expect(prompts).toEqual(["hello world", "how are you"])
  })

  test("preserves duplicate prompts (no dedup)", () => {
    const msgs = [
      { role: "user", id: "u1" },
      { role: "user", id: "u2" },
      { role: "user", id: "u3" },
    ]
    const getParts = (id: string) => {
      if (id === "u1") return [fakePart("hello world")]
      if (id === "u2") return [fakePart("hello world")]
      if (id === "u3") return [fakePart("different")]
      return []
    }
    expect(extractUserPrompts(msgs, getParts)).toEqual(["hello world", "hello world", "different"])
  })

  test("skips empty prompts", () => {
    const msgs = [
      { role: "user", id: "u1" },
      { role: "user", id: "u2" },
    ]
    const getParts = (id: string) => {
      if (id === "u1") return [{ type: "image" as const, text: "" }]
      if (id === "u2") return [fakePart("real prompt")]
      return []
    }
    expect(extractUserPrompts(msgs, getParts)).toEqual(["real prompt"])
  })
})

describe("freshRepeatState", () => {
  test("returns clean initial state", () => {
    const state = freshRepeatState()
    expect(state.show).toBe(false)
    expect(state.message).toBe("")
    expect(state.dismissCount).toBe(0)
  })
})
