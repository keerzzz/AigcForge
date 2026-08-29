import { marked } from "marked"

// 与 packages/ui/src/context/marked.tsx 同一原则：不覆写 link renderer ——
// 自行插值 href/title 会丢掉 marked 的上游转义。外链的 target/rel/class
// 由 session-ui 的 sanitize hook（markdown-cache.tsx）在消毒阶段统一补齐。
export function parseMarkdown(input: string) {
  return marked(input, {
    breaks: false,
    gfm: true,
  })
}
