import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

// 历史根会话的 attended 列在 20260707100100_session_attended 迁移中默认 0，
// 但根会话的 attended 契约（计划 §3.4）是"未显式传 false 即有人值守"。
// 0 会把所有旧根会话读回 unattended，导致 ask 全部降级为 deny。
// 子会话保持既有子代理契约（attended 0 仍为 unattended）。
export default {
  id: "20260816030000_backfill_root_session_attended",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`UPDATE \`session\` SET \`attended\` = NULL WHERE \`parent_id\` IS NULL AND \`attended\` = 0;`)
    })
  },
} satisfies DatabaseMigration.Migration
