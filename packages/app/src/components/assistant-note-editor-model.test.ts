import { describe, expect, test } from "bun:test"
import {
  danglingWikilinks,
  extractWikilinks,
  findWikilinkBeforeCaret,
  insertCompletion,
  wikilinkCandidates,
} from "./assistant-note-editor-model"

// 批次 3 G4：双栏编辑器纯逻辑 — [[补全]] 定位/候选/插入 + 悬空链接检测。

describe("findWikilinkBeforeCaret", () => {
  test("locates an open [[ before the caret", () => {
    expect(findWikilinkBeforeCaret("see [[proj", 10)).toEqual({ start: 4, query: "proj" })
  })

  test("returns undefined when no open [[ exists", () => {
    expect(findWikilinkBeforeCaret("no wikilinks here", 12)).toBeUndefined()
  })

  test("ignores a closed wikilink before the caret", () => {
    expect(findWikilinkBeforeCaret("[[done]] then [[w", 17)).toEqual({ start: 14, query: "w" })
  })

  test("stops at a line break (no cross-line completion)", () => {
    expect(findWikilinkBeforeCaret("[[proj\nnext line", 10)).toBeUndefined()
  })
})

describe("wikilinkCandidates", () => {
  const titles = ["Project Alpha", "Project Beta", "Personal Notes", "Alpha Plan"]

  test("filters titles containing the query, prefix matches first", () => {
    expect(wikilinkCandidates(titles, "alpha")).toEqual(["Alpha Plan", "Project Alpha"])
  })

  test("is case-insensitive", () => {
    expect(wikilinkCandidates(titles, "ALPHA")).toHaveLength(2)
  })

  test("returns the full title list for an empty query", () => {
    expect(wikilinkCandidates(titles, "")).toHaveLength(titles.length)
  })

  test("caps the candidate count", () => {
    const many = Array.from({ length: 30 }, (_, i) => `Note ${i}`)
    expect(wikilinkCandidates(many, "note")).toHaveLength(8)
  })
})

describe("insertCompletion", () => {
  test("replaces the [[query with [[title]]", () => {
    const text = "see [[proj here"
    expect(insertCompletion(text, { start: 4, query: "proj" }, "Project Alpha")).toBe("see [[Project Alpha]] here")
  })

  test("replaces only the open [[query span, preserving the tail", () => {
    const text = "see [[proj and more"
    expect(insertCompletion(text, { start: 4, query: "proj" }, "Project Alpha")).toBe("see [[Project Alpha]] and more")
  })

  test("closed wikilinks never reach insertCompletion (finder excludes them)", () => {
    expect(findWikilinkBeforeCaret("[[Foo]] tail", 9)).toBeUndefined()
  })
})

describe("extractWikilinks / danglingWikilinks", () => {
  test("extracts unique [[titles]] in order", () => {
    expect(extractWikilinks("a [[Foo]] and [[Bar]] and [[Foo]] again")).toEqual(["Foo", "Bar"])
  })

  test("reports wikilinks whose target title does not exist", () => {
    expect(danglingWikilinks("see [[Foo]] and [[Bar]]", new Set(["Foo"]))).toEqual(["Bar"])
  })

  test("empty content has no links", () => {
    expect(extractWikilinks("")).toEqual([])
    expect(danglingWikilinks("plain text", new Set())).toEqual([])
  })
})
