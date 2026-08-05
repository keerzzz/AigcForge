# AigcForge Main 未推送合并审批报告

- **审批日期**：2026-08-05
- **基线**：`origin/main` (`068664fca71d8fe034681527b772b5bfe9bd5191`)
- **目标**：本地 `main` (`d896ae0e81297be6041ff0680dd37ac1a5a04e44`)
- **范围**：`068664fc..d896ae0e`，8 个 first-parent 提交 / ~63 个提交
- **审批结论**：✅ **有条件批准（CONDITIONAL APPROVE）**——批准推送至 origin/main，条件见 §6

## 1. Executive Summary

| 分项 | 提交数 | 结论 | 发现 |
|---|---|---|---|
| work-m1（重点对象，无历史审查记录） | 12 | ✅ 无阻断项 | F1 MEDIUM-LOW + F2 LOW |
| todo-task + todo-task-m2（08-04 三轮已批准） | 41 | ✅ 与 08-04 结论一致，闭环验证通过 | 无 |
| 收尾（2 直接文档提交 + 2 fix 分支 + docs 清理） | 3+2+1 | ✅ 通过 | 无 |

无 HIGH/阻断项。

## 2. 审查范围清单

| commit | 类型 | 内容 |
|---|---|---|
| `58c7d532` | commit | 中文/台湾文档 + 乌克兰本地化（uk.ts app+ui 双包，language.tsx 六处接线；parity 政策仅强制 zh/zht） |
| `3f7f093e` | commit | Work mode M1 计划文档（execution-layer-m1 / tdd-prompt / roadmap） |
| `a041ca61` | merge work-m1 | schema Work preset + core work-orchestrator/registry/tool + artifact atomic apply + HTTP endpoint + app 三区块（12 提交） |
| `ef454564` | merge todo-task (FF) | schema SessionTask + core SessionTask service + TaskWrite tool + PATCH API + backfill migration + V1 /todo 兼容修复（10 提交） |
| `814dfae3` | merge todo-task-m2 | output_digest + GET API + ScheduledJobRunner + task_schedule tool + M4-M7 + 多轮审查修复（31 提交） |
| `4b83ac96` | merge docs-cleanup | docs/review/*.md 尾随空格清理 |
| `bcad23a9` | merge mcp-oauth-fix | McpOAuthCallback.cancelPending unhandled rejection 测试修复（08-04 仍开放项①收尾） |
| `d896ae0e` | merge provider-flaky-fix | provider credential 测试 404 HttpClient stub（08-04 仍开放项②收尾） |

## 3. 关键验证证据

### work-m1
- `schema/work-preset.ts`：Literal 品牌约束 + 自导出合规；**F1**：Question/ArtifactSpec/Preset 三个多字段 Struct 无豁免注释（对照 session-task.ts TaskRecurrence 有注释豁免）
- `core/session/artifact.ts`：atomic apply 路径穿越双重防御（validate + LocationMutation.resolve 符号链接拦截）+ writeAtomic + PathValidationError/ConflictError TaggedErrorClass + EventV2
- `core/plugin/agent.ts:337-361`：work-orchestrator fail-closed 权限（`* deny` + read/glob/grep/question/work-preset allow + `.env` ask 恢复）
- `core/product-mode-agent-policy.ts`：work mode 专属 agent 校验 + 拒 shell/command
- HTTP `work-artifact` group/handler：Effect.fn 命名 + LocationServiceMap + Layer.provide + 错误映射
- app：三区块全 v2 token + i18n + a11y；preset/workflow 引导纯函数显式"不做假执行"
- 测试：core 4 文件（work-preset 9 + tool-work-preset 3 + work-orchestrator 7 + work-clarify-e2e）+ app 4 文件

### todo/task epic 8 项修复清单（08-04 三轮）
| # | 修复项 | main 上证据 |
|---|---|---|
| ① | taskschedule remove 复用 removeTask | `tool/taskschedule.ts:80-92` 单行删除，注释引用 HIGH-2 |
| ② | append 事务内检环 + Semaphore + POST mint id | `session/task.ts:283` Semaphore 写锁覆盖 6 写操作；`:523-596` 事务内 reachableCycleGraph+findCycle（tagged result）；`handlers/session.ts:185-202` 忽略客户端 id |
| ③ | createTask `.at(-1)` + 空结果 500 | `handlers/session.ts:216-220` |
| ④ | position `max+1` | `task.ts:562` `(existing.at(-1)?.position ?? -1) + 1` |
| ⑤ | Hub request-start 守卫 | `agent-task-hub.tsx:90-116` session_task_updated_at 对比 |
| ⑥ | cron 窗口语义注释 | `schedule.ts:80-102` MAX_DAY_STEPS day-loop 步数语义 |
| ⑦ | at-least-once 声明 + startup recover | `scheduled-job.ts:53-96` + `specs/v2/todo.md:159` |
| ⑧ | PATCH 移除 outputDigest | `groups/session.ts:213-214` + handler 载荷仅 { status } |

附加：update 事务内 digestById/parentIdById/scheduleById 回退（resolved Info 与 DB/事件一致）；patch expect 条件 claim 在写锁内；22 条评审修复记录对应回归测试全部在 main（含 B-1 Result API、并发跨 session 拒环、M-2 写锁、MEDIUM-2 position、HIGH-4 dead-job、§7.1-7.3 电商场景）。

### M4-M7
- TUI `task-status.ts` 六状态显式 switch（未知态返回 undefined 诚实回退）+ `task-item.tsx` scheduled ⚡+nextRun + theme token
- app `session-todo-progress-model.ts`：preserveStatus 六态透传（写路径不降级）+ flipTaskWriteStatus 显式裁决 + M7 决策 3/4/5（inset 8px/fillEndPct 索引语义/lastCompletedPct）+ pickProgressTodos 双源新鲜度选择

### 收尾
- mcp-oauth：`test/mcp/lifecycle.test.ts:1093-1121` 先挂 no-op catch 防同步 reject 变 unhandled，再 Effect.tryPromise 订阅——模式正确，仅测试文件
- provider-flaky：`core/test/plugin/provider-aigcfroge.test.ts:17-25` notFoundHttpClientLayer（404），3 个 credential 测试 Effect.provide；不改变断言语义，live 测试保留真实网络
- 本地化：th.ts/zh.ts 的 language.uk 经 read_file 复核为正常 "Українська"（grep 乱码系工具显示问题）

## 4. 发现清单

| # | 级别 | 位置 | 内容 | 建议 |
|---|---|---|---|---|
| F1 | MEDIUM-LOW | `packages/schema/src/work-preset.ts` | 三个多字段 Schema.Struct 无豁免注释 | 补豁免注释或改 Schema.Class |
| F2 | LOW | `packages/core/src/session/work-preset.ts` | 自导出名 WorkPresetRegistry 与文件名不一致 | 补注释 |

## 5. 门禁符合性

Effect 编码（fn/gen/forkScoped/Semaphore）✓ · Schema（Class/TaggedErrorClass）✓ · 自导出模式 ✓ · 无 export namespace ✓ · star import 仅 effect 豁免（task.ts:5 DateTime）✓ · 无 as any/@ts-ignore ✓ · 路径穿越防御 ✓ · fail-closed 权限 ✓ · Clean Logs ✓ · v2 token/i18n/a11y ✓ · 测试非假测试 ✓

## 6. 验证结果与批准条件

**验证已全部完成（2026-08-05，bash 沙箱经用户授权关闭后重跑）**：

| 验证 | 结果 |
|---|---|
| `bun run typecheck`（turbo 18 包） | ✅ 18/18 成功（core+aigcfroge 实跑 tsgo，余缓存命中） |
| `packages/core: bun test --timeout 30000` | ✅ 1484 pass / 0 fail（190 文件；08-04 为 1481） |
| `packages/aigcfroge: bun test --timeout 30000` | ✅ 首次全量 3150 pass / 0 fail；重跑出现 2 fail → `--only-failures` 定位为 `test/cli/cmd/tui/attention.test.ts`（通知/声音时序），该文件**不在审批分支 diff**（pre-existing），单独重跑 18 pass / 0 fail——判定为全量并发下的环境 flaky，非本分支回归 |
| `packages/app: bun test --timeout 30000` | ✅ 620 unit + 3 virtualizer pass / 0 fail（与 08-04 的 623 一致） |
| `bun run lint` | ✅ 0 errors / 8 pre-existing warnings；增量 lint 通过 |
| `git diff --stat 068664fc..d896ae0e` | 297 文件 / +39555 / -4406 / 81 提交 |

**批准条件**：
1. ✅ 验证全绿——08-04 批准条件 1 已满足，可推送 `origin/main`
2. ⏳ 随手清理项：F1（work-preset.ts Struct 豁免注释）——不阻断推送
3. ⏳ 随手清理项：F2（WorkPresetRegistry 命名注释）——可选

**剩余风险**：cron AND 语义 / at-least-once 交付 / executor stub 覆盖 / ScheduledJob 生产幂等（durable claim 延期）均为 specs 已声明限制，与 08-04 结论一致。新增记录：`attention.test.ts` 为 pre-existing 全量并发 flaky（不在本分支 diff，单独运行稳定通过），与 08-04 记录的 prompt-directory 超时 flaky 同类。
