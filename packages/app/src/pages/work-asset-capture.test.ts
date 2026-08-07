import { describe, expect, test } from "bun:test"
import { captureWorkArtifactAsCandidate } from "./work-asset-capture"

const header = (title: string) => `# ${title}\n\n${"正文第一段，作为资产描述摘要。".repeat(4)}`

describe("captureWorkArtifactAsCandidate", () => {
  test("maps a titled draft into a complete valid prompt CandidateInfo", () => {
    const content = header("视频分镜脚本")
    const info = captureWorkArtifactAsCandidate(content)

    expect(info).not.toBeNull()
    if (!info) return
    expect(info.kind).toBe("prompt")
    expect(info.name).toBe("视频分镜脚本")
    expect(info.description.length).toBeGreaterThan(0)
    expect(info.content).toBe(content)
    expect(info.relativePath).toBe("")
    expect(info.exists).toBe(false)
    expect(info.revision).toBeNull()
    expect(info.nameConflict).toBe(false)
    expect(info.pathConflict).toBe(false)
    expect(info.status).toBe("valid")
    if (info.kind !== "prompt") return
    expect(info.candidate.name).toBe("视频分镜脚本")
    expect(info.candidate.template).toBe(content)
  })

  test("falls back to a generic name when the draft has no heading", () => {
    const info = captureWorkArtifactAsCandidate("纯文本正文，没有标题。")
    expect(info?.name).toBe("Work 产出")
    expect(info?.status).toBe("valid")
  })

  test("truncates an overlong description to 300 chars with an ellipsis", () => {
    const longParagraph = "很长的摘要文字。".repeat(60)
    const info = captureWorkArtifactAsCandidate(`# 长摘要\n\n${longParagraph}`)
    expect(info?.description.length).toBe(300)
    expect(info?.description.endsWith("…")).toBe(true)
  })

  test("truncates an overlong heading to 80 code points", () => {
    const longTitle = "标题".repeat(50)
    const info = captureWorkArtifactAsCandidate(`# ${longTitle}\n\n正文`)
    expect(info?.name).toBe("标题".repeat(40))
  })

  test("keeps candidate free of relativePath (Omit<PromptAssetCandidate, 'relativePath'>)", () => {
    const info = captureWorkArtifactAsCandidate(header("无路径"))
    if (!info) return
    expect("relativePath" in info.candidate).toBe(false)
  })

  test("returns null for empty content (Template constraint keeps results valid)", () => {
    expect(captureWorkArtifactAsCandidate("")).toBeNull()
    expect(captureWorkArtifactAsCandidate("   \n  ")).toBeNull()
  })
})
