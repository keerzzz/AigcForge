import { describe, it, expect } from "bun:test"
import { MetaIntent } from "../../../src/agent/meta/intent"

describe("intent classification", () => {
  it("classifies content_creation for Chinese input", () => {
    const result = MetaIntent.classify("创建一个新的 React 组件")
    expect(result.category).toBe("content_creation")
    expect(result.complexity).toBe("simple")
  })

  it("classifies content_creation for English input", () => {
    const result = MetaIntent.classify("create a new README file")
    expect(result.category).toBe("content_creation")
    expect(result.complexity).toBe("simple")
  })

  it("classifies code_understanding for Chinese input", () => {
    const result = MetaIntent.classify("解释一下这个函数的作用")
    expect(result.category).toBe("code_understanding")
    expect(result.needsExploration).toBe(true)
  })

  it("classifies code_understanding for English input", () => {
    const result = MetaIntent.classify("how does the authentication work")
    expect(result.category).toBe("code_understanding")
    expect(result.needsExploration).toBe(true)
  })

  it("classifies code_modification for Chinese input", () => {
    const result = MetaIntent.classify("修复登录页面的 bug")
    expect(result.category).toBe("code_modification")
    expect(result.complexity).toBe("moderate")
  })

  it("classifies code_modification for English input", () => {
    const result = MetaIntent.classify("refactor the user service")
    expect(result.category).toBe("code_modification")
    expect(result.complexity).toBe("moderate")
  })

  it("classifies configuration input", () => {
    const result = MetaIntent.classify("configure an mcp server")
    expect(result.category).toBe("configuration")
    expect(result.complexity).toBe("simple")
  })

  it("classifies workflow input", () => {
    const result = MetaIntent.classify("先做 A 再做 B")
    expect(result.category).toBe("workflow")
    expect(result.complexity).toBe("complex")
  })

  it("classifies @mention input", () => {
    const result = MetaIntent.classify("@build 修复这个 bug")
    expect(result.category).toBe("mention")
    expect(result.isMention).toBe(true)
  })

  it("classifies unknown input", () => {
    const result = MetaIntent.classify("你好")
    expect(result.category).toBe("unknown")
  })

  it("handles empty string", () => {
    const result = MetaIntent.classify("")
    expect(result.category).toBe("unknown")
    expect(result.isMention).toBe(false)
  })

  it("handles pure symbols", () => {
    const result = MetaIntent.classify("!!!")
    expect(result.category).toBe("unknown")
  })
})
