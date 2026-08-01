import { describe, expect, test } from "bun:test"
import { computeWorkDiff } from "./work-artifact-diff"

describe("computeWorkDiff", () => {
  test("flags added lines", () => {
    const diff = computeWorkDiff("旧内容", "新内容")
    expect(diff).toContainEqual({ type: "del", text: "旧内容" })
    expect(diff).toContainEqual({ type: "add", text: "新内容" })
  })

  test("marks identical lines as equal", () => {
    const diff = computeWorkDiff("第一行\n第二行", "第一行\n第二行改")
    expect(diff.filter((l) => l.type === "eq").map((l) => l.text)).toContain("第一行")
    expect(diff.filter((l) => l.type === "add").map((l) => l.text)).toContain("第二行改")
  })

  test("returns empty for identical content", () => {
    expect(computeWorkDiff("相同", "相同")).toEqual([{ type: "eq", text: "相同" }])
  })
})
