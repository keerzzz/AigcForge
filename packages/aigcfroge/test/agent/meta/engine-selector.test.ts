import { describe, it, expect } from "bun:test"
import { MetaEngine } from "../../../src/agent/meta/engine-selector"

describe("engine selector", () => {
  it("routes content_creation to general", () => {
    const result = MetaEngine.selectEngine({ category: "content_creation", complexity: "simple" })
    expect(result.engine).toBe("general")
  })

  it("routes code_understanding to explore", () => {
    const result = MetaEngine.selectEngine({ category: "code_understanding", complexity: "simple" })
    expect(result.engine).toBe("explore")
  })

  it("routes code_modification to build", () => {
    const result = MetaEngine.selectEngine({ category: "code_modification", complexity: "moderate" })
    expect(result.engine).toBe("build")
  })

  it("routes configuration to general", () => {
    const result = MetaEngine.selectEngine({ category: "configuration", complexity: "simple" })
    expect(result.engine).toBe("general")
  })

  it("routes workflow to builtin", () => {
    const result = MetaEngine.selectEngine({ category: "workflow", complexity: "complex" })
    expect(result.engine).toBe("builtin")
  })

  it("falls back to complexity default for unknown category", () => {
    const result = MetaEngine.selectEngine({ category: "unknown", complexity: "complex" })
    expect(result.engine).toBe("build")
  })

  it("uses simple → general for unknown with simple complexity", () => {
    const result = MetaEngine.selectEngine({ category: "unknown", complexity: "simple" })
    expect(result.engine).toBe("general")
  })
})
