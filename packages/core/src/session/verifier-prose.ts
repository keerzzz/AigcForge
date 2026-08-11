export * as VerifierProse from "./verifier-prose"

export interface Rule {
  readonly pattern: RegExp
  readonly principle: string
  readonly guidance: string
}

// Data-driven prose mapping (DA5): compiler errors are matched mechanically
// against known codebase principles; no LLM involved.
export const RULES: ReadonlyArray<Rule> = [
  {
    pattern: /Cannot find module/,
    principle: "Self-export is the global default",
    guidance:
      "A module exposes a namespace via `export * as Foo from \"./foo\"` at the bottom of the file; consumers import it by name.",
  },
  {
    pattern: /is not assignable to type/,
    principle: "Avoid the `any` type",
    guidance: "Use `unknown` and narrow with type guards, or `Schema.Defect` at Effect defect boundaries.",
  },
  {
    pattern: /does not exist on type/,
    principle: "No Null Pointer",
    guidance: "Defensive null checks: narrow optional fields before access; never assert non-null without reason.",
  },
  {
    pattern: /not exported|has no exported member/,
    principle: "Do not add a second executable entry type",
    guidance: "Tool exports live in the existing registry; never create a parallel execution entry point.",
  },
]

const GENERIC_GUIDANCE =
  "修复该编译错误后重新运行 typecheck 验证。若错误模式不熟悉，先查看仓库 AGENTS.md 与相邻文件的实现风格。"

export const render = (error: string): string => {
  const rule = RULES.find((candidate) => candidate.pattern.test(error))
  if (rule === undefined) return `编译错误:\n${error}\n${GENERIC_GUIDANCE}`
  return `编译错误:\n${error}\n违反原则: ${rule.principle}\n修正指引: ${rule.guidance}`
}
