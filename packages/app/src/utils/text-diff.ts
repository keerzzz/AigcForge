import { diffLines } from "diff"

export type TextDiffLine = { type: "add" | "del" | "eq"; text: string }

/** Line-level Myers diff (diffLines, O(ND) without a dense matrix) for overwrite-confirm diffs. */
export function diffTextLines(oldText: string, newText: string): TextDiffLine[] {
  const out: TextDiffLine[] = []
  for (const change of diffLines(oldText, newText)) {
    const lines = change.value.split("\n")
    // diffLines values usually end in \n; split leaves an empty tail to drop
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
    const type: TextDiffLine["type"] = change.added ? "add" : change.removed ? "del" : "eq"
    for (const text of lines) out.push({ type, text })
  }
  return out
}
