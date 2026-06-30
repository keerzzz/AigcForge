import { describe, it, expect } from "bun:test"
import { PreRouter } from "../../../src/agent/meta/prerouter"

describe("preRouter", () => {
  it("routes code_modification to build with high confidence", () => {
    const result = PreRouter.preRoute("修复登录页面的 bug")
    expect(result.routed).toBe(true)
    expect(result.confidence).toBe("high")
    expect(result.targets[0].engine).toBe("build")
    expect(result.category).toBe("code_modification")
  })

  it("routes English code_modification to build", () => {
    const result = PreRouter.preRoute("fix the login page bug")
    expect(result.routed).toBe(true)
    expect(result.targets[0].engine).toBe("build")
  })

  it("routes code_understanding to explore with high confidence", () => {
    const result = PreRouter.preRoute("explain how authentication works")
    expect(result.routed).toBe(true)
    expect(result.confidence).toBe("high")
    expect(result.targets[0].engine).toBe("explore")
  })

  it("routes Chinese understanding to explore", () => {
    const result = PreRouter.preRoute("解释一下这个函数")
    expect(result.routed).toBe(true)
    expect(result.targets[0].engine).toBe("explore")
  })

  it("routes @mention directly to named engine", () => {
    const result = PreRouter.preRoute("@build 修复这个 bug")
    expect(result.routed).toBe(true)
    expect(result.confidence).toBe("high")
    expect(result.targets[0].engine).toBe("build")
    expect(result.targets[0].prompt).toBe("修复这个 bug")
  })

  it("routes multiple @mentions", () => {
    const result = PreRouter.preRoute("@explore 查找代码 @build 实现修复")
    expect(result.routed).toBe(true)
    expect(result.targets).toHaveLength(2)
    expect(result.targets[0].engine).toBe("explore")
    expect(result.targets[1].engine).toBe("build")
  })

  it("routes content_creation as medium confidence", () => {
    const result = PreRouter.preRoute("创建一个 README 文件")
    expect(result.routed).toBe(true)
    expect(result.confidence).toBe("medium")
    expect(result.targets[0].engine).toBe("general")
  })

  it("passes through unknown intent", () => {
    const result = PreRouter.preRoute("你好")
    expect(result.routed).toBe(false)
    expect(result.confidence).toBe("pass_through")
  })

  it("passes through empty input", () => {
    const result = PreRouter.preRoute("")
    expect(result.routed).toBe(false)
    expect(result.confidence).toBe("pass_through")
  })

  it("routes workflow input", () => {
    const result = PreRouter.preRoute("先做 A 再做 B")
    expect(result.routed).toBe(true)
    expect(result.confidence).toBe("high")
    expect(result.category).toBe("workflow")
  })

  it("strips @mention from prompt text", () => {
    const result = PreRouter.preRoute("@build 修复这个 bug")
    expect(result.targets[0].prompt).toBe("修复这个 bug")
  })
})
