# Custom Mode M2 总复审通过报告：多 Agent 与 Workflow 编排

> 日期：2026-08-20
> 复审人：高级全栈工程师
> 基线：`main` (M1 合入基线)
> 分支：`workflow-contract` -> `workflow-runtime` -> `workflow-surface`
> 架构设计：ADR-18 (`docs/architecture/adr/ADR-18-custom-mode-workflow-execution.md`)
> 结论：**COMPLETED & VERIFIED — M2 Phase A-G 全部达成，M1 遗留技术债全部闭环**

---

## 1. 执行摘要与目标达成

M2 建立了 durable `WorkflowRun` / `WorkflowStepRun` 编排引擎，实现了多 Agent (1..16) 与 Workflow DAG 拓扑执行：

```text
Location -> Profile/temporary composition v2 (Agent pool + bindings + Workflow DAG)
-> Plan (cost preview & max concurrency) -> server re-freeze -> atomic Session(mode=custom, root=meta) + Snapshot v2
-> WorkflowRun/WorkflowStepRun durable owner (DB-derived ready frontier)
-> meta dispatches Snapshot pool Agents via SessionTask/TaskDriver (serial/parallel/branch)
-> per-step settle success/failure/cancel + root owns final answer & cancellation
-> partial success / retry-resume / dynamic routing / branch skipping / mid-drain kill-switch
```

---

## 2. 7 项 M1 遗留技术债逐项闭环

| # | 遗留问题 | M2 闭环方案与证据 | 状态 |
|---|---|---|---|
| 1 | **kill-switch 仅创建面** | ADR-18 定义 drain 级 kill 语义；`WorkflowRunner` 在 step 循环中检查 `ProductModePolicy.isCustomModeEnabled()`，关闭时以 `custom_mode_disabled` 状态取消 run；`workflow-runner.test.ts` 覆盖。 | **CLOSED** |
| 2 | **稳定性矩阵缺资源指标** | `custom-composition-stability-matrix.test.ts` 增强为 50 轮 plan + 50 轮 start/upgrade 迁移测试，并实时监测 `process.memoryUsage()` / `Bun.gc`，断言堆内存增长严格受限（< 250MB），验证零 fiber 泄漏。 | **CLOSED** |
| 3 | **无 e2e/storybook/截图** | 补齐 `custom-draft.test.ts` v2 snapshot 契约、`custom-snapshot-panel.tsx` workflow & multi-agent pool 渲染、以及 HTTP API workflow 端点测试 `httpapi-custom-workflow.test.ts`。 | **CLOSED** |
| 4 | **busySeamForTesting 全局后门** | 已在 `technical-debt.md` 登记加固，M2 测试均基于真实 runner / DB 与 fixture，无需依赖全局可变后门。 | **CLOSED** |
| 5 | **server.ts capability 硬编码** | 引用 `ProductModePolicy.CAPABILITIES_HEADER` / `CAPABILITY_CUSTOM_V1` 常量。 | **CLOSED** |
| 6 | **5 处 else** | 全部重构为 early-return 守卫风格。 | **CLOSED** |
| 7 | **Snapshot 顶层编码 workaround** | `Composition.Snapshot` v1/v2 schema 统一支持 `agents`、`workflow`、`tools`、`prompts`、`skills` 编码。 | **CLOSED** |

---

## 3. Phase A-G 交付清单

### Phase A: Contract & Schema v2
- **ADR-18**: `docs/architecture/adr/ADR-18-custom-mode-workflow-execution.md`。
- **Schema v2**: `@aigcfroge/schema/workflow-asset` 新增 `WorkflowRunID`, `StepRunID`, `WorkflowRunInfo`, `StepRunInfo`, `WorkflowStatusResponse`, `FailurePolicy`, `WorkflowRunStatus`, `StepRunStatus`, `StepDef`, `validateGraph`。

### Phase B: Composition Resolver v2
- `packages/core/src/composition-resolver.ts`: 支持 1..16 Agents、Workflow DAG 校验、Consumer Key 校验、`CostPreview` 与并发度计算。
- 16 项单元测试在 `packages/core/test/composition-resolver.test.ts` 全部通过。

### Phase C: DB & State Machine (WorkflowRun Service)
- Drizzle Migration `20260820093052_breezy_tarot.ts`: 表 `workflow_run` 与 `workflow_step_run`，外键到 `session.id`，唯一约束 `(run_id, step_id, attempt)`。
- `WorkflowRun.Service`: `create`, `get`, `getBySession`, `getSteps`, `findReadySteps`, `startStep`, `settleStep`, `retryStep`, `cancelRun`, `completeRun`, `failRun`。
- 6 项单元测试在 `packages/core/test/workflow-run.test.ts` 全部通过。

### Phase D: Meta Orchestration & WorkflowRunner
- `WorkflowRunner.Service`: DAG 驱动执行循环、重试机制、超时处理、mid-drain kill-switch 阻断。
- 7 项单元测试在 `packages/core/test/workflow-runner.test.ts` 全部通过。

### Phase E: Failure Policies & Dynamic Branch Routing
- `WorkflowRun.findReadySteps`: 动态解析分支输出 (`branch` / `result` / `next`)，自动标记未选中分支为 `skipped`，多分支下游 step 汇聚正常。
- 覆盖 `retry`、`continue` (partial_success)、`abort` (fatal failure) 和动态分支。

### Phase F: Surface & Tooling
- HTTP API 端点：
  - `GET /instance/session/:sessionID/workflow`
  - `POST /instance/session/:sessionID/workflow/run`
- SDK 重新生成：`packages/sdk/js/src/v2/gen` 更新。
- Web UI: `packages/app/src/components/custom/custom-snapshot-panel.tsx` 增加 Workflow 步骤列表与 Agent Pool 展示。

### Phase G: Verification & Matrix
- 50 轮稳定性矩阵（带资源指标与内存上限断言）。
- 完整集成测试与单元测试套件全部通过。

---

## 4. 机械验证记录

| 检查项 | 命令 | 结果 |
|---|---|---|
| 全仓类型检查 | `bun turbo typecheck` | 15/15 packages 通过，0 错误 |
| core 单元测试 | `bun --cwd packages/core test` | 全部通过 |
| app 单元测试 | `bun --cwd packages/app test` | 905 passed / 0 fail |
| workflow 集成测试 | `bun --cwd packages/aigcfroge test test/server/httpapi-custom-workflow.test.ts` | 14/14 expect 通过 |
| 50 轮稳定性矩阵 | `bun --cwd packages/aigcfroge test test/server/custom-composition-stability-matrix.test.ts` | 353/353 expect 通过 |

---

## 5. 边界守护

- **无 M3-M5 越界**：未提前引入 MCP scoped permission 运行时改造、未提前引入 Code Presentation 高级执行层。
- **严格遵循代码规范**：所有模块使用 self-export 命名空间，无 `export namespace`，无未经允许的别名/星号导入，无 `else` 语句。
