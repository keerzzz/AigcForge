export * as PermissionStateContext from "./permission-state"

import { PermissionEffective } from "../permission/effective"

// 动态 Permission Context 渲染（计划 §5）：meta 的当前 mode/tier/override
// 状态由纯函数渲染成短指令，V1/V2 共用同一 renderer；静态提示词不得再
// 声明绝对写路径指引。break-glass（masterPermissionEnabled）语义在
// SessionPermissionOverride（Phase 6）接入后生效。
export function render(input: PermissionEffective.Input): string {
  const attended = input.attended !== false
  const elevated =
    (input.mode === "chat" || input.mode === "work" || input.mode === "assistant") &&
    input.agent === "meta" &&
    input.tier === "full"
  const breakGlass = input.masterPermissionEnabled && attended

  const lines: string[] = ["<permission-state>", `  Current mode: ${input.mode}`]
  if (input.agent === "meta") {
    lines.push(`  Permission tier: ${input.tier}`)
    if (input.mode === "coding") {
      lines.push("  Coding mode: file writes continue to delegate through task → build.")
    } else if (elevated) {
      lines.push(
        "  Full tier: you may directly use the currently materialized write and command tools; an ask means the user must confirm before execution.",
      )
    } else {
      lines.push(
        "  Propose tier: use only the currently available safe and domain tools; do not attempt generic file writes or shell commands beyond the visible toolset.",
      )
    }
  } else {
    lines.push(`  Agent: ${input.agent}`)
  }
  if (breakGlass) {
    lines.push(
      "  Permission override is active for this session: general actions are allowed, but still follow the user's task and the security protocol; chat dangerous actions still require per-use confirmation.",
    )
  } else if (!attended) {
    lines.push("  This session is unattended: no user is present to confirm; write and command tools are unavailable.")
  }
  lines.push("</permission-state>")
  return lines.join("\n")
}
