import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"

// Phase 3b source-contract tests: TextDiffView extracts the overwrite-confirm diff
// rendering shared by Chat and Work, with a variant preserving each surface's visual
// contract (chat: inline add/del/eq colors; work: bordered scrolled container).

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), "utf-8")

describe("TextDiffView (variant diff rendering)", () => {
  test("exports the TextDiffView component", () => {
    expect(read("text-diff-view.tsx")).toContain("export function TextDiffView")
  })

  test("accepts oldText/newText and a chat|work variant", () => {
    const view = read("text-diff-view.tsx")
    expect(view).toContain("oldText")
    expect(view).toContain("newText")
    expect(view).toContain('variant: "chat" | "work"')
  })

  test("uses the shared diffTextLines pipeline", () => {
    expect(read("text-diff-view.tsx")).toContain("diffTextLines")
  })

  test("preserves the chat add/del/eq color contract", () => {
    const view = read("text-diff-view.tsx")
    expect(view).toContain("text-v2-state-fg-success")
    expect(view).toContain("text-v2-state-fg-warning")
    expect(view).toContain("text-v2-text-text-muted")
    expect(view).toContain('"+"')
    expect(view).toContain('"-"')
  })

  test("preserves the work bordered scrolled container contract", () => {
    const view = read("text-diff-view.tsx")
    expect(view).toContain("rounded-lg")
    expect(view).toContain("border-v2-border-border-base")
    expect(view).toContain("overflow-y-auto")
    expect(view).toContain("max-h-48")
  })

  test("chat-right-panel consumes TextDiffView instead of inlining the diff rows", () => {
    const chat = read("../../components/chat/chat-right-panel.tsx")
    expect(chat).toContain("<TextDiffView")
    expect(chat).toContain('variant="chat"')
  })

  test("work-artifact-panel consumes TextDiffView with the work variant", () => {
    const work = read("../work-artifact-panel.tsx")
    expect(work).toContain("<TextDiffView")
    expect(work).toContain('variant="work"')
  })

  test("does not own Chat/Work overwrite/apply/asset business", () => {
    const view = read("text-diff-view.tsx")
    expect(view).not.toContain("handleApply")
    expect(view).not.toContain("applyAssetCandidate")
  })
})
