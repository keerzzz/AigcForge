import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"
import { clearProposeCandidate, setProposeCandidate, useProposeCandidate } from "@/components/chat/prompt-asset-store"
import { captureWorkArtifactAsCandidate } from "./work-asset-capture"
import { draftFilename, findLatestAssistantMarkdown } from "./work-artifact-extract"

const message = (over: Partial<{ id: string; agent: string; mode: string }> = {}) => ({
  id: over.id ?? "msg_1",
  sessionID: "ses_1",
  role: "assistant" as const,
  time: { created: 1000 },
  parentID: "msg_0",
  modelID: "m",
  providerID: "p",
  mode: over.mode ?? "work",
  agent: over.agent ?? "work-orchestrator",
  path: { cwd: "/project", root: "/project" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
})

const textPart = (text: string) => ({ type: "text" as const, text })

describe("findLatestAssistantMarkdown", () => {
  test("returns the joined text of the latest assistant message", () => {
    const messages = [message({ id: "msg_1" }), message({ id: "msg_2" })]
    const parts = {
      msg_1: [textPart("旧内容")],
      msg_2: [textPart("# 分镜脚本"), textPart("\n\n第二段")],
    }
    expect(findLatestAssistantMarkdown(messages, parts)).toBe("# 分镜脚本\n\n第二段")
  })

  test("returns null when there is no assistant message with text", () => {
    const messages = [message({ id: "msg_1" })]
    const parts = { msg_1: [{ type: "tool" as const, id: "t", name: "question", state: { status: "completed" } }] }
    expect(findLatestAssistantMarkdown(messages, parts)).toBeNull()
  })

  test("returns null when there are no messages", () => {
    expect(findLatestAssistantMarkdown([], {})).toBeNull()
  })

  test("skips tool-only assistant messages and finds the previous text candidate", () => {
    const messages = [message({ id: "msg_1" }), message({ id: "msg_2" })]
    const parts = {
      msg_1: [textPart("# 第一版")],
      msg_2: [{ type: "tool" as const, id: "t", name: "work-preset", state: { status: "completed" } }],
    }
    expect(findLatestAssistantMarkdown(messages, parts)).toBe("# 第一版")
  })
})

describe("draftFilename", () => {
  test("derives a markdown filename from the first heading", () => {
    expect(draftFilename("# 视频分镜脚本\n\n正文")).toBe("视频分镜脚本.md")
  })

  test("falls back to a generic name when there is no heading", () => {
    expect(draftFilename("纯文本正文")).toBe("work-draft.md")
  })

  test("sanitizes invalid filename characters", () => {
    expect(draftFilename("# 分镜: 脚本/测试?")).toBe("分镜- 脚本-测试-.md")
  })
})

// The save-as-asset button's own wiring is covered where it can actually be observed:
// `e2e/regression/work-asset-save.spec.ts` clicks it, checks the candidate reaches the
// Chat propose store with no mode switch, and boots without any flag (which is what
// "un-gated" means); `work-html-artifact.spec.ts` pins the visibility rule from both
// sides, present before an apply and gone after. What is left here is the part that
// needs no DOM: the store hand-off itself.
describe("WorkArtifactContent save-as-asset store hand-off", () => {
  test("onSaveAsset source can be injected into the propose store (D5: store before mode switch)", () => {
    const info = captureWorkArtifactAsCandidate("# 标题\n\n正文")
    expect(info).not.toBeNull()
    if (!info) return
    try {
      setProposeCandidate("ses_m2", info)
      const state = useProposeCandidate()
      expect(state.sessionID).toBe("ses_m2")
      expect(state.candidate?.name).toBe("标题")
      expect(state.candidate?.status).toBe("valid")
      expect(state.candidate?.content).toBe("# 标题\n\n正文")
    } finally {
      clearProposeCandidate()
    }
  })
})

// Format routing and the Chat review chain are covered by real renders instead of by
// reading this file's own source:
//   - `work-html-artifact.spec.ts` — an html candidate produces the sandboxed iframe with
//     its CSP, the Code tab shows the raw source, the Preview/Code labels come from the
//     app's i18n, and apply writes a real `.html`.
//   - `work-mermaid-artifact.spec.ts` — the Markdown route for a non-html candidate.
//   - `work-asset-save.spec.ts` — a work candidate (empty path, `exists: false`) reaches
//     the Chat panel's valid branch with an Apply button and no overwrite diff.
//   - `components/chat/asset-insert.test.ts` — which apply route each kind takes and
//     whether `relativePath` rides along, asserted on the call rather than on the text.
// The removed "does not touch the M2 chain" and "does not touch agent permissions" checks
// asserted that a UI file's text lacked certain substrings, which proved nothing about
// either chain.

// Still source-level, and knowingly so: these two assert that the panel REUSES the
// shared diff variant, the active-tab writeback helper and SessionRightPanel's default
// file tree rather than forking its own. The behavioural equivalent needs a Work
// overwrite-diff e2e, which does not exist yet (recorded in docs/technical-debt.md).
describe("Work right panel shared detail mechanisms (Phase 3)", () => {
  const panel = fs.readFileSync(path.resolve(__dirname, "work-artifact-panel.tsx"), "utf-8")

  test("uses the shared Work diff variant and active-tab writeback helper", () => {
    expect(panel).toContain("<TextDiffView")
    expect(panel).toContain('variant="work"')
    expect(panel).toContain("createActiveTabWriteback")
  })

  test("uses the SessionRightPanel default file tree", () => {
    expect(panel).not.toContain("fileTree=")
  })
})
