import { diffLines } from "diff"

export type WorkDiffLine = { type: "add" | "del" | "eq"; text: string }

/** 行级 diff（复用 Chat 右栏同款 Myers diff）。用于覆盖确认时展示新旧内容差异。 */
export function computeWorkDiff(oldText: string, newText: string): WorkDiffLine[] {
  const out: WorkDiffLine[] = []
  for (const change of diffLines(oldText, newText)) {
    const lines = change.value.split("\n")
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
    const type: WorkDiffLine["type"] = change.added ? "add" : change.removed ? "del" : "eq"
    for (const text of lines) out.push({ type, text })
  }
  return out
}
