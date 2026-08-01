import { describe, expect, test } from "bun:test"
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
