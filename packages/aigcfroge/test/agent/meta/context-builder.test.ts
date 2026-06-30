import { describe, it, expect } from "bun:test"
import { MetaContextBuilder } from "../../../src/agent/meta/context-builder"

describe("context builder", () => {
  it("renders template without history", () => {
    const result = MetaContextBuilder.build({
      project: "/test/project",
      taskDescription: "Fix the login bug",
      engine: "build",
      delegationId: "deleg_001",
      files: "src/login.ts",
      constraints: "Keep it simple",
      history: [],
    })
    expect(result).toContain("Project: /test/project")
    expect(result).toContain("Task: Fix the login bug")
    expect(result).toContain("Engine: build")
    expect(result).toContain("ID: deleg_001")
    expect(result).toContain("src/login.ts")
    expect(result).toContain("Keep it simple")
    expect(result).toContain("Previous:")
  })

  it("renders history with latest 5 entries", () => {
    const history = Array.from({ length: 7 }, (_, i) => ({
      seq: i + 1,
      engine: "build",
      status: "success" as const,
      summary: `Task ${i + 1}`,
      files: i < 2 ? [`file${i + 1}.ts`] : undefined,
    }))

    const result = MetaContextBuilder.build({
      project: "/p",
      taskDescription: "T",
      engine: "build",
      delegationId: "d1",
      files: "",
      constraints: "",
      history,
    })

    expect(result).toContain("#3")
    expect(result).toContain("#7")
    expect(result).not.toContain("#1")
  })

  it("injects cache-warmth signal when warmed", () => {
    const result = MetaContextBuilder.build({
      project: "/p",
      taskDescription: "T",
      engine: "build",
      delegationId: "d1",
      files: "",
      constraints: "",
      history: [],
      warmed: true,
    })
    expect(result).toContain("<cache-warm/>")
  })

  it("does not inject cache-warmth when not warmed", () => {
    const result = MetaContextBuilder.build({
      project: "/p",
      taskDescription: "T",
      engine: "build",
      delegationId: "d1",
      files: "",
      constraints: "",
      history: [],
    })
    expect(result).not.toContain("<cache-warm/>")
  })
})
