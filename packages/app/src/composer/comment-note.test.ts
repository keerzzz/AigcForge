import { describe, expect, test } from "bun:test"
import { commentContextItem, readPromptPresentation } from "./comment-note"
import { createMemoryComposerState } from "./state"

const durable = {
  type: "note" as const,
  origin: "example",
  label: "button#save",
  icon: "select-element",
  subject: 'the "button#save" element',
  href: "tab_00000000-0000-4000-8000-000000000000",
  comment: "Rename this",
}

const note = { ...durable, live: { subject: 'the "button#save" element (browser ref @e42)' } }

describe("extension notes", () => {
  test("presentation preserves exact server identity and skips malformed Session reference offsets", () => {
    const first = {
      reference: {
        serverID: "server-one",
        sessionID: "ses_same",
        title: "Saved title",
        scope: { kind: "identity" as const },
      },
      start: 4,
      end: 9,
      content: "@same",
    }

    const second = {
      reference: {
        serverID: "server-two",
        sessionID: "ses_same",
        title: "Saved title",
        scope: { kind: "through" as const, messageID: "msg_boundary" },
      },
      start: 18,
      end: 23,
      content: "@same",
    }

    const presentation = readPromptPresentation({
      displayText: "Ask @same on one; @same on two.",
      comments: [{ path: "src/app.ts", comment: "Keep" }],
      sessionReferences: [
        first,
        second,
        { ...first, start: -1 },
        { ...first, start: 4.5 },
        { ...first, end: 200 },
        { ...first, start: 0 },
        { ...first, content: "different" },
        { ...first, reference: { ...first.reference, serverID: "" } },
      ],
    })

    expect(presentation?.sessionReferences).toEqual([first, second])
    expect(presentation?.comments).toEqual([{ path: "src/app.ts", comment: "Keep" }])
    expect(presentation?.displayText).toBe("Ask @same on one; @same on two.")
  })

  test("read from message metadata beside file comments and skip malformed entries", () => {
    // Metadata a build before extension notes sent for a browser element comment.
    const browser = {
      type: "browser",
      tabID: "tab_00000000-0000-4000-8000-000000000000",
      url: "http://localhost:5173/settings",
      title: "Settings",
      element: {
        ref: "e42",
        selector: "#settings > button.primary",
        label: "button.primary",
        role: "button",
        name: "Save",
        text: "Save",
      },
      comment: "Match @src/button.css",
    }

    const value = readPromptPresentation({
      displayText: "hi",
      comments: [
        note,
        { ...note, label: 42 },
        browser,
        { ...browser, element: { label: "button" } },
        { path: "src/app.ts", comment: "Keep" },
      ],
    })

    expect(value?.comments).toEqual([
      note,
      {
        type: "note",
        origin: "browser",
        label: "button.primary",
        icon: "select-element",
        subject:
          'the "button.primary" element in browser tab tab_00000000-0000-4000-8000-000000000000 at http://localhost:5173/settings (role button; accessible name "Save"; selector "#settings > button.primary")',
        href: "tab_00000000-0000-4000-8000-000000000000",
        comment: "Match @src/button.css",
      },
      { path: "src/app.ts", comment: "Keep" },
    ])
  })

  test("update and detach by commentID reach notes as well as file comments", () => {
    const context = createMemoryComposerState().context
    context.add({ type: "file", path: "src/app.ts", comment: "Keep", commentID: "file" })
    context.add({ ...note, commentID: "note" })
    context.updateComment("note", { comment: "Rename that" })
    context.updateComment("file", { comment: "Keep this" })
    expect(context.items().map((item) => [item.commentID, item.comment])).toEqual([
      ["file", "Keep this"],
      ["note", "Rename that"],
    ])
    context.removeComment("note")
    expect(context.items().map((item) => item.commentID)).toEqual(["file"])
  })

  test("return to the composer without their live part", () => {
    expect(commentContextItem(note)).toEqual({ ...durable, commentID: expect.any(String) })
  })
})
