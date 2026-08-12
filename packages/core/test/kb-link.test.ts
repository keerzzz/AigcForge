import { describe, expect, test } from "bun:test"
import { KBLink } from "@aigcfroge/core/kb/link"

describe("KBLink.extractWikilinks", () => {
  test("extracts plain [[titles]] in order", () => {
    expect(KBLink.extractWikilinks("See [[Roadmap]] and [[Budget]].")).toEqual(["Roadmap", "Budget"])
  })

  test("strips the display alias [[title|display]] and keeps the target title", () => {
    expect(KBLink.extractWikilinks("See [[Roadmap|our plan]].")).toEqual(["Roadmap"])
  })

  test("strips heading fragments [[title#section]]", () => {
    expect(KBLink.extractWikilinks("See [[Roadmap#Q3]].")).toEqual(["Roadmap"])
  })

  test("deduplicates repeated links preserving first occurrence", () => {
    expect(KBLink.extractWikilinks("[[A]] then [[A]] again")).toEqual(["A"])
  })

  test("ignores single-bracket and unbalanced brackets", () => {
    expect(KBLink.extractWikilinks("[A] and [[unclosed")).toEqual([])
  })

  test("handles empty content", () => {
    expect(KBLink.extractWikilinks("")).toEqual([])
  })

  test("keeps titles with spaces and CJK characters", () => {
    expect(KBLink.extractWikilinks("见 [[项目计划]] 与 [[Q3 目标]]")).toEqual(["项目计划", "Q3 目标"])
  })
})

describe("KBLink.detectDangling", () => {
  test("marks only missing titles as dangling", () => {
    const known = new Set(["Roadmap", "Budget"])
    expect(KBLink.detectDangling(["Roadmap", "Missing", "Budget"], known)).toEqual(["Missing"])
  })

  test("empty known set marks everything dangling", () => {
    expect(KBLink.detectDangling(["A", "B"], new Set())).toEqual(["A", "B"])
  })
})

describe("KBLink.resolveTitle", () => {
  test("resolves a link to a note by exact title", () => {
    const notes = new Map([
      ["Roadmap", "kb_1"],
      ["Budget", "kb_2"],
    ])
    expect(KBLink.resolveTitle("Roadmap", notes)).toBe("kb_1")
    expect(KBLink.resolveTitle("Missing", notes)).toBeUndefined()
  })

  test("resolves through aliases when the title itself does not match", () => {
    const notes = new Map([["Roadmap", "kb_1"]])
    const aliases = new Map([["kb_1", ["计划", "roadmap"]]])
    expect(KBLink.resolveTitle("计划", notes, aliases)).toBe("kb_1")
    expect(KBLink.resolveTitle("roadmap", notes, aliases)).toBe("kb_1")
  })

  test("undefined aliases do not affect exact matches", () => {
    const notes = new Map([["Roadmap", "kb_1"]])
    expect(KBLink.resolveTitle("Roadmap", notes, new Map())).toBe("kb_1")
  })
})
