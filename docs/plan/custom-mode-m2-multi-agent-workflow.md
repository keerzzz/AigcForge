# Custom Mode M2 实施计划：多 Agent 与 Workflow 编排

> 状态：**Implemented — Phase A-H 已在 `workflow-surface` 分支实现；R5 独立专项复审已取得并整改完毕，结论 APPROVED，进入 PR 阶段**
> 审批依据：[Custom M2 复审报告（单一真源）](../review/AigcForge_CUSTOM_M2_REVIEW.md) — R0–R5 五轮结论、全部发现与门禁证据均在该文内
> 契约真源：[ADR-18](../architecture/adr/ADR-18-custom-mode-workflow-execution.md)（v1.1，2026-08-22 按实现校准）
> 分析基线：`main@a4ffba0b3`（2026-08-18，本地/远端已同步）；执行基线为 M1 合入并复审后的最新 `main`
> 范围：多 Agent allowlist、Command binding、Workflow durable execution、进度/取消/部分成功、成本预览
> 前置：[Custom Mode M1](custom-mode-m1-single-agent-runtime.md)
> 上级计划：[Custom Mode 组合平台实施计划](custom-mode-composition-platform-implementation.md)

---

## 0. 根问题与范围

M2 不是把 `agents.length` 上限从 1 改成 N。它要建立一个 durable Workflow Run owner，使 `meta` 能在 Snapshot Agent 池内按 DAG 串行/并行委派，并且根 Session 始终拥有取消权、最终回答和部分成功语义。

起点代码事实（分析基线 `main@a4ffba0b3`，非当前分支状态）：

- `WorkflowAsset.StepDef` 有 `next/branches/parallel`，但 `input` 是 `unknown`，没有执行引擎、持久化 run identity 或失败策略。
- `SessionTask`/`TaskDriver` 已提供 durable task、child Session、settle、取消、DAG 字段等可复用积木。
- Work 首页对 Workflow 仍是“引导模式”，不能当作真实执行 owner。

实现后的契约以 [ADR-18](../architecture/adr/ADR-18-custom-mode-workflow-execution.md) §2 为准：`StepDef.input` 收窄为 JSON object，run/step 由 `workflow_run` / `workflow_step_run` 与 `WorkflowRun` Service 独占持有。

### 0.1 M2 范围

- 多用户 Agent allowlist、角色/冲突/重复诊断。
- Prompt/Skill/Command/Workflow 按 Agent 或 orchestrator 显式 binding。
- Workflow DAG 的串行、并行、分支、取消、重试、部分成功和根结果聚合。
- Run/step durable identity 与 SessionTask/child Session 的明确映射。
- 成本/并发/工具目录/token 预览与上限。

### 0.2 非目标

- 不开放 MCP、Plugin runtime、Code Presentation、external CLI 或 judge。
- Command binding 是结构化指令模板，不等于 shell 权限，也不能创建新 executor。
- 不在 Profile 文件中保存运行中 step 状态。
- 不让 Workflow 自己授予权限或绕过 Snapshot/Permission。
- 不把 Work 的引导模式直接标成 Custom Workflow engine。

## 1. 开工 Gate

| Gate         | 通过标准                                                                                                                     | 阻塞范围    |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- | ----------- |
| G2-0 M1 稳定 | Snapshot/allowlist/interrupt/resume/50 次基线通过，M1 无高风险遗留                                                           | 全部        |
| G2-1 ADR     | 新增并接受 Workflow Execution ADR：definition owner、run owner、step state、retry/idempotency、partial success、final answer | Schema/Core |
| G2-2 数据    | Run/step 与 SessionTask/child 的一对一或引用关系、事务边界、删除/恢复规则批准                                                | DB/Runner   |
| G2-3 安全    | 多 Agent 权限交集、最大并发/深度、Command 语义、双门禁扩展通过 Security 评审                                                 | 执行        |
| G2-4 产品    | 分支/失败/取消/部分成功 UI 和成本预览验收口径批准                                                                            | App/Beta    |

M2 的第一个可提交 PR 是 ADR/Schema contract，不是修改 `agents.length`。

## 2. 五层设计

| 层                  | owner/交付                                                                                                   | 复用与约束                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| L1 Schema           | `Composition v2`、Workflow Definition v2、Run/Step 状态与 `ErrorCategory` 固定分类                           | version union；旧 M1 Snapshot 可读；step 只落 digest，不落原始 input/output/error                                           |
| L2 Core/DB          | `WorkflowRun` durable owner（唯一 CAS 写入者）+ `WorkflowRunner` 编排循环 + `WorkflowExecution` 进程内 owner | 复用 SessionTask/TaskDriver 与 `SessionRunCoordinator`，不复制 child runner                                                 |
| L3 HTTP/SDK         | status / run(202) / run cancel / step cancel / step retry(202) 五端点                                        | command/query 分离，typed idempotency（`requestID` + `expectedRunRevision`/`expectedStepRevision`）；不新开 Workflow SSE 流 |
| L4 App              | Agent pool、DAG preview、运行态面板（progress/cancel/retry/partial result）                                  | 复用 Builder/Session timeline/Task UI；只投影服务端状态                                                                     |
| L5 runtime/security | bounded dispatch、per-step allowlist/permission、settle                                                      | 每条路径 success/failure/cancel 必 settle；`TaskDriver` 按 composition root 解析                                            |

### 2.1 持久化关系（已实现，`ADR-18` §2.2 为契约真源）

```text
workflow_run
  id, session_id -> session(id) on delete cascade,
  snapshot_digest, workflow_name, workflow_revision,
  request_id?, request_digest?,                      -- unique (session_id, request_id)
  parent_run_id?, root_run_id?, retry_of_step_run_id?, -- 终态重试 lineage
  status, revision, current_step_id?, error_category?,
  time_created, time_updated, time_completed?

workflow_step_run
  id, run_id -> workflow_run(id) on delete cascade,
  step_id, agent_id, status, attempt, revision,
  task_id?, child_session_id?,
  input_digest?, output_digest?, branch_target?, error_category?,
  time_created, time_started?, time_completed?       -- unique (run_id, step_id, attempt)
```

Workflow definition 保存在资产/Snapshot；run/step 状态保存在 DB；SessionTask 提供用户可见任务投影。禁止把同一状态分别写入三处再靠事件猜测同步。原始 step 输入/输出/错误文本一律不落库，只保留 digest 与 `ErrorCategory`。

## 3. 分阶段实施

### Phase A：ADR、Schema v2 与迁移兼容

**红**：Workflow graph decode、唯一 step id、agent/binding 引用、cycle/unreachable、branch target、parallel join、严格 `{ branch, summary? }` 输出、JSON object input、`branches + continue` 禁止、Run/Step 恢复状态、lineage、并发上限；M1 Snapshot v1 仍可读。

**绿**：接受 Workflow Execution ADR；Snapshot v2 冻结 consumer-scoped Prompt/Skill/Command bindings 与 `maxConcurrency (1..8)`；定义 Run/Step state machine、lineage、typed errors、event schemas 和迁移策略。

**重构**：Profile 只保存 definition refs/bindings；运行状态不回写 Profile/Workflow asset。

### Phase B：多 Agent Resolver 与成本预览

**红**：Agent 数量边界、duplicate/conflict/hidden/stale/cross-location、consumer-scoped bindings、Command template decode、Workflow 全引用解析；跨 consumer 复用与同 consumer 重复的差异；requested/effective tools 与 token/concurrency estimate 稳定。

**绿**：CompositionResolver 解析 Prompt/Skill/Command 并冻结 consumer 目录；Command 只进入静态模板目录，不进入 instructions、capabilities 或 Tool catalog；生成 Agent directory、effective tool set 和 cost preview。

**重构**：M1 resolver path 保持原语义；不通过 `if version >= 2` 散落规则，使用 versioned decoder/strategy owner。

### Phase C：WorkflowRun durable owner

**红**：clean/existing migration、create exact retry（`requestID` + `request_digest` 幂等与冲突）、run/step revision CAS、事务失败无孤儿、恢复重建 ready frontier、root/step delete lifecycle、durable 事件与 DB 同事务一致（`event.seq + 1 === run.revision`，commit 被拒时两侧一起回滚）。

**绿**：新增 WorkflowRun/StepRun typed service、表和 durable 事件 `workflow.run.updated`（按 `runID` 聚合）；建立与 SessionTask 的单向投影/引用；实现 DB 派生 ready frontier——`findReadySteps` 在 revision CAS 下持久化 `pending -> ready` 与未选中分支闭包的 `skipped`，不是纯函数，因此不得在客户端或第二处重算。

**重构**：所有状态转换经一个 state machine；禁止 handler/runner/App 直接改表。

### Phase D：串行/并行调度与 settle

**红**：

- 串行只在前置成功后调度；并行尊重最大并发（`computeMaxConcurrency`，上限 8）。
- 分支条件只消费结构化 step result，不执行任意表达式代码；分支未命中一律 fail closed，`continue` 不得放行分支节点。
- 每个 dispatch success/failure/cancel/interruption 都 settle Task + StepRun。
- 根取消两段式：`cancelling` 意图 -> interrupt owner -> `cancelled` 终态；未开始 step 标 `skipped`。
- 进程恢复不重放已完成副作用：遗留 `dispatching` 退回 `ready` 安全续接；遗留 `running` 转 `execution_unknown` 且 run 转 `recovery_required`，必须由客户端显式重试，不自动重放。

**绿**：在 process-local coordinator（`WorkflowExecution` 基于 `SessionRunCoordinator`）上实现 DB-derived frontier，run 循环脱离 HTTP 请求 fiber；`ready -> dispatching` 只绑定确定性 Task/child identity，`dispatching -> running` 持久化后才允许 Provider 调用；通过现有 TaskDriver 创建/驱动 child；用 Scope/Deferred/SessionStatus，不用 sleep。

**重构**：调度器不执行模型/Tool，只拥有“何时调用 TaskDriver”；Runner 不拥有 DAG。

### Phase E：权限、委派与 Command binding

**红**：每 step Agent 必须在 Snapshot pool；child create 再检查；Workflow/Command 不提升权限；跨 Agent Prompt/Skill 不串扰；最大深度/并发 fail closed；CLI/Judge/MCP/Plugin 仍拒绝。

**绿**：扩 `SessionComposition.assertAgentAllowed` 接受 step identity；Command 降低为绑定到消费者的稳定指令模板；每 child 使用 agent-specific Snapshot view 与 PermissionEffective。

**重构**：不要建立 Workflow permission engine；仍由唯一 Permission owner + leaf assert 决定。

### Phase F：HTTP/SDK/App 进度闭环

**红**：status/run/cancel-run/cancel-step/retry-step 五端点 auth、idempotency（`requestID`）、revision CAS 冲突 -> 409；Builder Agent pool/DAG/成本；运行态 step progress；单步和根取消；部分成功/失败/重试；reload 恢复；responsive/a11y/i18n（en/zh/zht）。

**绿**：新增薄 HttpApi/SDK（提交类端点返回 202，读取端点返回 200）；扩 Custom Builder 和 Session panel；复用 Task progress/Agent hub/Session rows，不创建第二时间线；不新开 Workflow SSE 流——`workflow.run.updated` 走既有 `/event` 流作为失效通知，客户端据此重新 `GET .../workflow`。

**重构**：UI 只投影 Run/Step state，不在客户端推演 ready frontier 或成功语义。

### Phase G：恢复、故障注入和灰度

- 覆盖 1/2/N Agent、串行/并行/分支、取消竞态、部分成功、进程重启、stale revision、permission deny。
- 覆盖跨 composition root 委派与跨 workspace identity：child 必须落在调用方 root 与 Session 自己的 Location 下。
- 验证一个 step 失败不会把已完成结果伪装成全部失败/成功。
- 验证 root Session 始终拥有最终回答和取消权（`<workflow_result>` handoff 必须经凭据扫描与裁剪）。
- 更新 Work 引导模式文案：只有接入同一 engine 后才能移除“引导模式”标记。

## 4. TDD 与逐小节复查

每个 slice 执行：owner/history/reuse audit -> 红 -> 绿 -> 重构 -> focused test/typecheck -> `CLAUDE.md` 改完即审 -> 重读 Effect/DB/Tool/UI 协议 -> lint/diff。每个 Phase 全绿后才进入下一 Phase；M2 完成后停止等待 M3 Gate。

重点红线：

- 每条委派路径都回答“谁 settle success/failure/cancel”。
- 事件 payload、DB row、SessionTask 投影一致。
- 不记录 raw prompt/output/error/Authorization；digest 使用固定分类。
- 不使用 `Effect.die` 表达业务拒绝，不使用 sleep 等并发。

## 5. 最终测试矩阵

- Schema：version compatibility、graph/limits/negative cases。
- Core：migration、state machine、frontier、scheduler、recovery、cancel/interruption、permission。
- HTTP/SDK：auth/coverage/effect、idempotency、event replay、generated diff。
- App：unit、Playwright 真实多 Agent workflow、reload、desktop/narrow、theme、keyboard、三语。
- 全局：各受影响包 tests/typechecks、protocol refs、incremental lint、full typecheck/lint、diff check。

具体命令沿用 M1 §5；新增 focused files 后用真实路径替换占位，测试仍只从包目录执行。

## 6. 停止条件

- M1 尚未稳定或 Workflow Execution ADR 未 Accepted。
- 无法定义唯一 durable run/step owner，或需要在 Profile/Task/Session 三处复制状态。
- Workflow `input: unknown` 被直接解释为可执行代码/命令。
- 任一调度路径可能留下 orphan `in_progress`。
- 需要 MCP/Plugin/Code 才能完成基本 workflow。
- 测试/迁移/权限/中断/E2E 任一失败。

## 7. 分支策略

- 只从 M1 合入后的最新 main 开始；不从当前分析锚点 `main@a4ffba0b3` 预建实现分支。
- 推荐依次使用 `workflow-contract`、`workflow-runtime`、`workflow-security`、`workflow-surface`。
- 每个 PR 合入后下一分支重新基于最新 main；跨 PR schema 依赖不靠长期 stacked branch 隐藏。
