# AigcForge main PR 审批报告

- 日期：2026-08-05
- 审查范围：`origin/main..main`（81 个提交，`068664fc..d896ae0e`，first-parent）
- 变更规模：297 文件，`+39.5k/-4.4k`（含大量文档与本地化）
- 结论：**有条件通过（拒绝合并直至修复两项 HIGH 阻断项）**

## 一、门禁与验证记录

| 门禁                                       | 结果                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| typecheck（core/app/aigcfroge/tui/schema） | 全绿                                                                           |
| `bun run lint`                             | 退出码 0，**8 条 warning**（3 条在新增生产代码 `SessionTask` Class spread 上） |
| `git diff --check origin/main...main`      | **失败**：`docs/prd/work-mode-execution-layer.md` 末尾多余空行                 |
| core 迁移/dag/schedule/session-task        | 56 pass                                                                        |
| core 服务层 13 文件                        | 130 pass                                                                       |
| aigcfroge HTTP/agent/tool/mcp 6 文件       | 148 pass                                                                       |
| schema 全量                                | 39 pass                                                                        |
| tui 4 文件                                 | 17 pass                                                                        |
| app 全量                                   | 620 + 5 pass（前序已核）                                                       |

说明：现成审批报告将 lint warning 归为 "pre-existing" 不准确——其中 3 条位于本次新增的 `SessionTask` Class spread 生产代码。

## 二、阻断项

### BLOCKER-1（HIGH）Task 全局单写锁并非全局 —— 并发环/丢写窗口重新打开

- 协议承诺（`packages/core/src/session/task.ts:278-283` 注释）：“Single-writer mutex for all task mutations”，用于序列化跨 Session 追加与检环。
- 实际接线：
  - `server.ts:282` HTTP/调度走 `SessionTask.node`（独立实例）；
  - `location-layer.ts:138` 在每 Location 构建时注册 `SessionTask.layer`，`:191` 对整层 `Layer.fresh`——Effect 语义为每实例不共享；
  - 因此进程内至少存在 3 把独立 Semaphore（HTTP/调度 ×1、Location 工具写 ×N），共享同一 SQLite 库。
- 影响：SQLite 延迟事务不串行化两个并发追加；跨 Location 工具写与 HTTP/调度写可交叉事务，HIGH-2 曾关闭的"双方同时检环通过/丢更新"窗口可重现。
- 测试盲区：现有并发测试全部基于单一 `SessionTask` 实例，无法暴露该问题。
- 修复方向（任选其一）：把 writeLock 提升为进程级共享单例（如 `Effect.cached` 的 Semaphore）；或让 HTTP/调度与 Location 工具复用同一实例；并为跨实例并发写补充回归测试。

### BLOCKER-2（HIGH）`pickProgressTodos` 陈旧 Task 复活（V1 清空 → V2 残留）

- 纯函数实证：`pickProgressTodos([{id:"tsk_old",...}], 100, [], 200)` 在 todo 列表为空时仍返回旧 TaskTable 任务。
- 当前默认 `AIGCFROGE_V2_RUNTIME=false`：迁移后用户清空 legacy Todo，刷新后一次性 backfill 的陈旧 Task 会重新显示，写回被导向错误数据源。
- 测试只覆盖"空 task → 非空 todo"，遗漏反向清空场景。
- 修复方向：todo 为空时以 todo 数据为准返回空集（或按 `updatedAt` 新旧裁决），并补充清空方向的回归测试。

## 三、低危项

- `git diff --check` 空白错误（1 处，docs 文件）——合并前清理。
- lint 新增 3 条 warning（Class spread）——非阻断，建议顺手消除。

## 四、通过面（抽样核验）

- Core 持久化：单写锁意图、事务内跨 Session 检环、原子单项 patch/delete、事件从落库结果重读——实现与文档一致。
- HTTP 域错误映射、middleware 授权、work-artifact/agent-task 端点原子性——符合协议。
- 权限链 fail-closed（subagent 继承父会话 deny 为硬上限）——测试通过。
- 调度恢复不破坏 claim、SDK 生成、UI 写回单任务原子——符合约束。
- 历史评审 HIGH/MEDIUM 项对应代码均已独立复核（BLOCKER-1/2 为本次新发现，不继承历史"已关闭"标签）。

## 五、结论

**有条件通过**：修复 BLOCKER-1、BLOCKER-2 并清理门禁（空白错误 + 新增 lint warning）后即可开 PR 合并；在此之前不建议推送远端 `main`。
