import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { KBNote } from "../src/index"

const validNote = {
  id: "kb_abc123",
  title: "Meeting notes",
  content: "Discussed [[Roadmap]] and [[Budget]].",
  scope: "global",
  tags: ["work"],
  format: "note",
  createdAt: 1,
  updatedAt: 2,
}

describe("KBNote.Note", () => {
  test("decodes a valid note", () => {
    const s = Schema.decodeUnknownSync(KBNote.Note)(validNote)
    expect(s.title).toBe("Meeting notes")
    expect(s.content).toContain("[[Roadmap]]")
    expect(s.scope).toBe("global")
    expect(s.format).toBe("note")
  })

  test("rejects an unknown scope", () => {
    expect(() => Schema.decodeUnknownSync(KBNote.Note)({ ...validNote, scope: "local" })).toThrow()
  })

  test("rejects an unknown format", () => {
    expect(() => Schema.decodeUnknownSync(KBNote.Note)({ ...validNote, format: "memo" })).toThrow()
  })

  test("rejects a malformed id prefix", () => {
    expect(() => Schema.decodeUnknownSync(KBNote.Note)({ ...validNote, id: "note_wrong" })).toThrow()
  })

  test("omits optional aliases without error", () => {
    const s = Schema.decodeUnknownSync(KBNote.Note)(validNote)
    expect(s.aliases).toBeUndefined()
  })

  test("NoteFormat literal set covers the seven formats", () => {
    const format = Schema.decodeUnknownSync(KBNote.NoteFormat)
    for (const value of ["note", "summary", "faq", "timeline", "study_guide", "briefing", "mindmap"] as const) {
      expect(format(value)).toBe(value)
    }
  })
})

describe("KBNote.Link", () => {
  test("decodes a resolved link", () => {
    const s = Schema.decodeUnknownSync(KBNote.Link)({
      sourceNoteID: "kb_src" as KBNote.NoteID,
      targetNoteID: "kb_tgt" as KBNote.NoteID,
      targetTitle: "Roadmap",
      linkType: "reference",
      dangling: false,
    })
    expect(s.targetNoteID).toBe("kb_tgt" as KBNote.NoteID)
    expect(s.dangling).toBe(false)
  })

  test("decodes a dangling link without a target", () => {
    const s = Schema.decodeUnknownSync(KBNote.Link)({
      sourceNoteID: "kb_src" as KBNote.NoteID,
      targetTitle: "Missing",
      linkType: "reference",
      dangling: true,
    })
    expect(s.dangling).toBe(true)
    expect(s.targetNoteID).toBeUndefined()
  })

  test("rejects an unknown link type", () => {
    expect(() =>
      Schema.decodeUnknownSync(KBNote.Link)({
        sourceNoteID: "kb_src",
        targetTitle: "x",
        linkType: "informs",
        dangling: false,
      }),
    ).toThrow()
  })
})
