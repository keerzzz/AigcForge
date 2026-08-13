import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"

// 批次 3 G4：知识库 Tab（搜索/标签/列表/正文/反向引用/悬空）+ 双栏编辑器
// （[[补全]]/预览/悬空高亮）。纯逻辑由 editor-model / wikilink-decorate 覆盖。

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), "utf-8")
const kbTab = read("assistant-kb-tab.tsx")
const editor = read("../../components/assistant-note-editor.tsx")
const panel = read("assistant-session-panel.tsx")

describe("AssistantKbTab (knowledge base tab, batch 3 G4)", () => {
  test("exports the component", () => {
    expect(kbTab).toContain("export function AssistantKbTab")
  })

  test("wires search (FTS5) and tag filter over the note list", () => {
    expect(kbTab).toContain("client.kb.search")
    expect(kbTab).toContain("client.kb.list({})")
    expect(kbTab).toContain("tagFilter")
    expect(kbTab).toContain("assistant.kb.allTags")
  })

  test("shows the selected note body, backlinks and the dangling panel", () => {
    expect(kbTab).toContain("client.kb.backlinks({ id })")
    expect(kbTab).toContain("client.kb.dangling()")
    expect(kbTab).toContain('language.t("assistant.kb.backlinks")')
    expect(kbTab).toContain('language.t("assistant.kb.danglingTitle")')
    expect(kbTab).toContain("<Markdown")
  })

  test("targets notes opened via openEntityPanel (target -> selected)", () => {
    expect(kbTab).toContain("props.target")
    expect(kbTab).toContain("setSelectedID(id)")
  })

  test("decorates wikilinks in the body preview (dangling highlight)", () => {
    expect(kbTab).toContain("decorateWikilinks")
    expect(kbTab).toContain("MutationObserver")
  })
})

describe("AssistantNoteEditor (dual-pane editor, batch 3 G4)", () => {
  test("exports the component", () => {
    expect(editor).toContain("export function AssistantNoteEditor")
  })

  test("renders the split panes: markdown edit + live preview", () => {
    expect(editor).toContain("grid-cols-2")
    expect(editor).toContain("textarea")
    expect(editor).toContain("<Markdown")
    expect(editor).toContain('language.t("assistant.editor.preview")')
  })

  test("implements [[completion]] from the title index", () => {
    expect(editor).toContain("findWikilinkBeforeCaret")
    expect(editor).toContain("wikilinkCandidates")
    expect(editor).toContain("insertCompletion")
  })

  test("highlights dangling wikilinks in the preview", () => {
    expect(editor).toContain("danglingWikilinks")
    expect(editor).toContain("decorateWikilinks")
    expect(editor).toContain('language.t("assistant.editor.dangling"')
  })

  test("creates and updates notes through KBService endpoints", () => {
    expect(editor).toContain("sdk.client.kb.create")
    expect(editor).toContain("sdk.client.kb.update")
    expect(editor).toContain("client.kb.remove({ id })")
  })
})

describe("AssistantSessionPanel kb/editor tabs (batch 3 G4)", () => {
  test("replaces the batch-1 empty stubs with the real tabs", () => {
    expect(panel).toContain("<AssistantKbTab")
    expect(panel).toContain("<AssistantNoteEditor")
    expect(panel).not.toContain("assistant.panel.kb.empty")
    expect(panel).not.toContain("assistant.panel.editor.empty")
  })

  test("edit from the kb tab opens the editor tab with the note target", () => {
    expect(panel).toContain('openEntityPanel(assistant(), "editor", note.id)')
  })

  test("saving the editor returns to the kb tab", () => {
    expect(panel).toContain('onSaved={() => openEntityPanel(assistant(), "kb")}')
  })
})
