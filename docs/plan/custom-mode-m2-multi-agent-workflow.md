# Custom Mode M2 实施计划：多 Agent 与 Workflow 编排

> 状态：**Future / Contract blocked - M1 通过后才允许启动**
> 分析基线：`main@a4ffba0b3`（2026-08-18，本地/远端已同步）；执行基线为 M1 合入并复审后的最新 `main`
> 范围：多 Agent allowlist、Command binding、Workflow durable execution、进度/取消/部分成功、成本预览
> 前置：[Custom Mode M1](custom-mode-m1-single-agent-runtime.md)
> 上级计划：[Custom Mode 组合平台实施计划](custom-mode-composition-platform-implementation.md)

---

## 0. 根问题与范围

M2 不是把 `agents.length` 上限从 1 改成 N。它要建立一个 durable Workflow Run owner，使 `meta` 能在 Snapshot Agent 池内按 DAG 串行/并行委派，并且根 Session 始终拥有取消权、最终回答和部分成功语义。

当前代码事实：

- `WorkflowAsset.StepDef` 有 `next/branches/parallel`，但 `input` 是 `unknown`，没有执行引擎、持久化 run identity 或失败策略。
- `SessionTask`/`TaskDriver` 已提供 durable task、child Session、settle、取消、DAG 字段等可复用积木。
- Work 首页对 Workflow 仍是“引导模式”，不能当作真实执行 owner。

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

| 层                  | owner/交付                                                      | 复用与约束                                       |
| ------------------- | --------------------------------------------------------------- | ------------------------------------------------ |
| L1 Schema           | `Composition v2`、Workflow Definition v2、Run/Step/Result/Error | version union；旧 M1 Snapshot 可读               |
| L2 Core/DB          | `WorkflowRun` durable owner + scheduler/coordinator             | 复用 SessionTask/TaskDriver，不复制 child runner |
| L3 HTTP/SDK         | plan/start/run/status/cancel/retry endpoints/events             | command/query 分离，typed idempotency            |
| L4 App              | Agent pool、DAG preview、progress/cancel/partial result         | 复用 Builder/Session timeline/Task UI            |
| L5 runtime/security | bounded dispatch、per-step allowlist/permission、settle         | 每条路径 success/failure/cancel 必 settle        |

### 2.1 推荐持久化关系

在 ADR 批准前表名是设计占位，不是已授权接口：

```text
workflow_run
  id, root_session_id, snapshot_digest, workflow_revision,
  status, revision, time_created, time_updated

workflow_step_run
  id, run_id, step_id, task_id, child_session_id?, agent_id,
  attempt, status, input_digest, output_digest?, error_category?, revision
```

Workflow definition 保存在资产/Snapshot；run/step 状态保存在 DB；SessionTask 提供用户可见任务投影。禁止把同一状态分别写入三处再靠事件猜测同步。

## 3. 分阶段实施

### Phase A：ADR、Schema v2 与迁移兼容

**红**：Workflow graph decode、唯一 step id、agent/binding 引用、unknown step kind、cycle/unreachable、branch target、parallel join、失败策略、并发上限；M1 Snapshot v1 仍可读；M2 字段不能被 M1 server 静默忽略。

**绿**：接受 Workflow Execution ADR；引入 versioned definition/composition Snapshot v2；定义 Run/Step state machine、typed errors、event schemas 和迁移策略。

**重构**：Profile 只保存 definition refs/bindings；运行状态不回写 Profile/Workflow asset。

### Phase B：多 Agent Resolver 与成本预览

**红**：Agent 数量边界、duplicate/conflict/hidden/stale/cross-location、per-Agent bindings、Command template decode、Workflow 全引用解析；requested/effective tools 与 token/concurrency estimate 稳定。

**绿**：扩 CompositionResolver version dispatch；生成 Agent directory、step binding、effective tool set 和 cost preview。

**重构**：M1 resolver path 保持原语义；不通过 `if version >= 2` 散落规则，使用 versioned decoder/strategy owner。

### Phase C：WorkflowRun durable owner

**红**：clean/existing migration、create exact retry、run/step revision CAS、事务失败无孤儿、恢复重建 ready frontier、root/step delete lifecycle、event payload 与 DB 一致。

**绿**：新增 WorkflowRun/StepRun typed service、表和事件；建立与 SessionTask 的单向投影/引用；实现 ready frontier 纯计算。

**重构**：所有状态转换经一个 state machine；禁止 handler/runner/App 直接改表。

### Phase D：串行/并行调度与 settle

**红**：

- 串行只在前置成功后调度；并行尊重最大并发。
- 分支条件只消费结构化 step result，不执行任意表达式代码。
- 每个 dispatch success/failure/cancel/interruption 都 settle Task + StepRun。
- 根取消停止活动 child，未开始 step 标 cancelled/skipped（术语由 ADR 定）。
- 进程恢复不重放已完成副作用；不确定 provider work 按 Session V2 显式 resume 规则阻断或等待人工。

**绿**：在 process-local coordinator 上实现 DB-derived frontier；通过现有 TaskDriver 创建/驱动 child；用 Scope/Deferred/SessionStatus，不用 sleep。

**重构**：调度器不执行模型/Tool，只拥有“何时调用 TaskDriver”；Runner 不拥有 DAG。

### Phase E：权限、委派与 Command binding

**红**：每 step Agent 必须在 Snapshot pool；child create 再检查；Workflow/Command 不提升权限；跨 Agent Prompt/Skill 不串扰；最大深度/并发 fail closed；CLI/Judge/MCP/Plugin 仍拒绝。

**绿**：扩 `SessionComposition.assertAgentAllowed` 接受 step identity；Command 降低为绑定到消费者的稳定指令模板；每 child 使用 agent-specific Snapshot view 与 PermissionEffective。

**重构**：不要建立 Workflow permission engine；仍由唯一 Permission owner + leaf assert 决定。

### Phase F：HTTP/SDK/App 进度闭环

**红**：start/status/cancel/retry auth、idempotency、event replay；Builder Agent pool/DAG/成本；timeline step progress；单步和根取消；部分成功/失败/重试；reload 恢复；responsive/a11y/i18n。

**绿**：新增薄 HttpApi/SDK；扩 Custom Builder 和 Session panel；复用 Task progress/Agent hub/Session rows，不创建第二时间线。

**重构**：UI 只投影 Run/Step state，不在客户端推演 ready frontier 或成功语义。

### Phase G：恢复、故障注入和灰度

- 覆盖 1/2/N Agent、串行/并行/分支、取消竞态、部分成功、进程重启、stale revision、permission deny。
- 验证一个 step 失败不会把已完成结果伪装成全部失败/成功。
- 验证 root Session 始终拥有最终回答和取消权。
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
