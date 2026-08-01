import { describe, expect, test } from "bun:test"
import { diffTextLines } from "./text-diff"

describe("diffTextLines", () => {
  test("flags added lines", () => {
    const diff = diffTextLines("旧内容", "新内容")
    expect(diff).toContainEqual({ type: "del", text: "旧内容" })
    expect(diff).toContainEqual({ type: "add", text: "新内容" })
  })

  test("marks identical lines as equal", () => {
    const diff = diffTextLines("第一行\n第二行", "第一行\n第二行改")
    expect(diff.filter((l) => l.type === "eq").map((l) => l.text)).toContain("第一行")
    expect(diff.filter((l) => l.type === "add").map((l) => l.text)).toContain("第二行改")
  })

  test("returns equal line for identical content", () => {
    expect(diffTextLines("相同", "相同")).toEqual([{ type: "eq", text: "相同" }])
  })
})
