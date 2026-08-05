import { diffLines } from "diff"

export type TextDiffLine = { type: "add" | "del" | "eq"; text: string }

/** 行级 Myers diff（diff 库 diffLines，O(ND) 无稠密矩阵）。覆盖确认等场景展示新旧内容差异。 */
export function diffTextLines(oldText: string, newText: string): TextDiffLine[] {
  const out: TextDiffLine[] = []
  for (const change of diffLines(oldText, newText)) {
    const lines = change.value.split("\n")
    // diffLines 的 value 末尾常含 \n，split 产生空尾，去掉
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
    const type: TextDiffLine["type"] = change.added ? "add" : change.removed ? "del" : "eq"
    for (const text of lines) out.push({ type, text })
  }
  return out
}
