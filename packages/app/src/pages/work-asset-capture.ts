import type { CandidateInfo } from "@/components/chat/prompt-asset-candidate"
import { extractFirstHeading } from "./work-artifact-extract"

const MAX_NAME_CODE_POINTS = 80
const MAX_DESCRIPTION_CHARS = 300
const MAX_TEMPLATE_BYTES = 100_000

/**
 * 从候选稿首行 # 标题提取资产名；无标题返回 null。
 * 截断到 PromptAsset.Name 上限（80 code points）。
 */
export function extractTitle(content: string): string | null {
  const title = extractFirstHeading(content)
  if (!title) return null
  return Array.from(title).slice(0, MAX_NAME_CODE_POINTS).join("")
}

/**
 * 从候选稿首段（标题后第一段非空文本）提取摘要。
 * 截断到 PromptAsset.Description 上限（300 code points）。
 */
export function extractSummary(content: string, maxLen = MAX_DESCRIPTION_CHARS): string {
  const body = content.replace(/^#\s+.*/m, "").trim()
  const firstPara =
    body
      .split(/\n\s*\n/)[0]
      ?.replace(/\n/g, " ")
      .trim() ?? ""
  const codePoints = Array.from(firstPara)
  if (codePoints.length <= maxLen) return firstPara
  return codePoints.slice(0, maxLen - 1).join("") + "…"
}

/**
 * Work 候选稿 -> prompt 资产 CandidateInfo（D3 方案 A：不调 propose）。
 * CandidateBase 必含 content（prompt kind = template）+ status（statusFrom 派生）。
 * relativePath 留空：apply 从 name 计算路径（prompt-asset-service.ts），空安全。
 * 内容为空或超 Template 上限（100000 bytes）时返回 null，保证产出永远合法。
 */
export function captureWorkArtifactAsCandidate(
  content: string,
  fallback?: { name?: string; description?: string },
): CandidateInfo | null {
  if (content.trim() === "") return null
  if (new TextEncoder().encode(content).length > MAX_TEMPLATE_BYTES) return null
  const name = extractTitle(content) ?? fallback?.name ?? "Work draft"
  const description = extractSummary(content) || fallback?.description || "From a Work session"
  return {
    name,
    description,
    content,
    relativePath: "",
    exists: false,
    revision: null,
    nameConflict: false,
    pathConflict: false,
    status: "valid",
    kind: "prompt",
    candidate: {
      name,
      description,
      template: content,
    },
  }
}
