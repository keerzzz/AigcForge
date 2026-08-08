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

// M2 save-as-asset button: the app has no DOM-render unit-test harness (no
// solid-testing-library); per the agent-task-hub.test.tsx precedent this
// verifies the source-level wiring contract, while the behavioural path
// (click -> store -> mode switch) is covered by the M2 E2E.
describe("WorkArtifactContent save-as-asset button (M2)", () => {
  const panel = fs.readFileSync(path.resolve(__dirname, "work-artifact-panel.tsx"), "utf-8")

  test("renders a save-as-asset button next to apply", () => {
    expect(panel).toContain('data-component="work-save-asset-button"')
    expect(panel).toContain('language.t("work.asset.save")')
  })

  test("shows the button only when a candidate exists and is not applied (D6: no flag)", () => {
    expect(panel).toMatch(/<Show when=\{candidate\(\) !== null && !appliedCurrent\(\)\}>/)
  })

  test("onSaveAsset wires capture -> setProposeCandidate (no auto mode switch: session mode is authoritative)", () => {
    expect(panel).toContain("captureWorkArtifactAsCandidate(content)")
    expect(panel).toContain("setProposeCandidate")
    expect(panel).not.toMatch(/setCurrentMode\("chat"\)/)
  })

  test("does not read the chat-asset flag (G4 un-gated)", () => {
    expect(panel).not.toContain("AIGCFROGE_EXPERIMENTAL_CHAT_ASSET")
  })

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

// M3.5 format routing: the Artifact tab routes ```html candidates to the
// HtmlArtifact renderer and everything else to the M1/M3 Markdown renderer.
// Source-level contract (no DOM harness in the app, per the M2 precedent).
describe("WorkArtifactContent format routing (M3.5)", () => {
  const panel = fs.readFileSync(path.resolve(__dirname, "work-artifact-panel.tsx"), "utf-8")

  test("routes html candidates to HtmlArtifact and others to Markdown in a single outlet", () => {
    expect(panel).toContain('detectArtifactFormat(candidate()!) === "html"')
    expect(panel).toContain("HtmlArtifact")
    expect(panel).toContain("extractHtmlBlock(candidate()!)")
    expect(panel).toContain('<Markdown text={candidate()!} />')
  })

  test("keeps the Markdown fallback for non-html candidates (M1/M3 no regression)", () => {
    expect(panel).toContain('detectArtifactFormat(candidate()!) === "html"')
    expect(panel).toContain('<Markdown text={candidate()!} />')
  })

  test("passes app-provided i18n labels to HtmlArtifact", () => {
    expect(panel).toContain('language.t("work.artifact.html.preview")')
    expect(panel).toContain('language.t("work.artifact.html.code")')
    expect(panel).toContain('language.t("work.artifact.html.renderError")')
    expect(panel).toContain('language.t("work.artifact.html.viewCode")')
  })

  test("does not touch the M2 save-as-asset chain", () => {
    expect(panel).toContain("captureWorkArtifactAsCandidate(content)")
    expect(panel).toContain('data-component="work-save-asset-button"')
  })
})

// M2 Phase C: the Chat review/apply chain must render work-sourced candidates
// (empty relativePath + status="valid") without changes. Source-level contract
// checks against the reused modules; the Core side already covers applying an
// empty relativePath candidate (packages/core/test/prompt-asset-service.test.ts).
describe("work-sourced candidate through the Chat review chain (M2 Phase C)", () => {
  const panelPath = path.resolve(__dirname, "../components/chat/chat-right-panel.tsx")
  const panel = fs.readFileSync(panelPath, "utf-8")
  const insertPath = path.resolve(__dirname, "../components/chat/asset-insert.ts")
  const insert = fs.readFileSync(insertPath, "utf-8")

  test("chat-right-panel renders the apply button on the status=valid branch", () => {
    expect(panel).toContain('candidate.candidate?.status === "valid"')
    expect(panel).toMatch(/onClick=\{handleApply\}/)
  })

  test("chat-right-panel skips the relativePath diff when exists=false (work candidates carry empty path)", () => {
    expect(panel).toContain("if (!c?.exists) return null")
  })

  test("asset-insert prompt branch forwards candidate.relativePath; Core apply derives the path from name", () => {
    expect(insert).toMatch(/client\.promptAsset\.apply/)
    expect(insert).toContain("relativePath: candidate.relativePath")
  })

  test("M2 does not touch agent permissions (work-orchestrator keeps no edit/shell)", () => {
    const panel = fs.readFileSync(path.resolve(__dirname, "work-artifact-panel.tsx"), "utf-8")
    expect(panel).not.toContain("workOrchestrator")
    expect(panel).not.toContain("tool.use")
  })
})
