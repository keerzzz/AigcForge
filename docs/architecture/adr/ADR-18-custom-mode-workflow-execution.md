# ADR-18: Custom Mode Multi-Agent Workflow Execution

> 状态：**Accepted for M2 implementation v1.1**（2026-08-20 接受；2026-08-22 按实现校准，用户授权 AI 代理代行 Product / Core / App / Security / Schema+SDK 技术审批）
> 日期：2026-08-20（v1.1 校准 2026-08-22）
> 校准范围：§2.1-§2.7 与 §3 收敛为 `workflow-surface` 分支上已实现的契约（Run/Step 状态机与恢复语义、revision CAS 与 durable 事件、失败/重试上限、kill switch 实际边界、5 个公共端点）。决策方向未变，删除未实现的表述（Provider-turn 级 flag 检查、重试退避、`getReadyFrontier` 纯计算）。
> 关联：ADR-13、ADR-17、[Custom PRD](../../prd/custom-mode-composition-platform.md)、[Custom 路线图](../../roadmap/custom-mode-roadmap.md)、[M2 计划](../../plan/custom-mode-m2-multi-agent-workflow.md)

---

## 1. 背景

在 Custom Mode M1 中，系统实现了单 Agent（`meta` 根会话 + 单个受限执行 Agent）的可恢复运行闭环与快照持久化。M2 目标是推进到多 Agent 与 Workflow DAG 编排。

当前存在的核心技术挑战与事实：

1. `WorkflowAsset.StepDef` 拥有 `next/branches/parallel` 结构，但缺少统一的运行时执行引擎、Durable Run Identity、失败恢复策略与确定性取消语义。
2. 调度执行必须基于唯一的持久化 Run Owner（SQLite `workflow_run` / `workflow_step_run`），严禁在 Profile 资产、SessionTask 与 Session 实体间三处复制运行状态并靠事件猜测同步。
3. 根会话必须由 `meta` 统一编排，用户 Agent 仅作为受限执行者运行在 `TaskDriver` 派生的子会话中；根会话始终拥有取消权、最终回答聚合与部分成功裁决权。

---

## 2. 决策

### 2.1 唯一编排拓扑与所有权分离 (Ownership Separation)

```text
Location -> Profile/temporary composition v2 (Agent pool + bindings + Workflow DAG)
-> Plan (cost preview) -> server re-freeze -> atomic Session(mode=custom, root=meta) + Snapshot v2
-> HTTP admit (202) -> WorkflowExecution process-local owner (per-Session serialized, off the request fiber)
-> WorkflowRun/StepRun durable owner (DB-derived ready frontier)
-> meta dispatches Snapshot pool Agents via SessionTask/TaskDriver (serial/parallel/branch)
-> per-step settle success/failure/cancel + durable `<workflow_result>` handoff into root
-> root meta owns final answer & cancellation
-> partial success / terminal-retry lineage / recovery_required / move / upgrade
```

1. **Definition Owner**：
   - 静态 Workflow 定义由 `.aigcfroge/workflows/*.yaml` 资产管理，并在 Profile/Composition 中以 `WorkflowRef` 显式引用。
   - Session 创建时，由服务端通过 `CompositionResolver` 将 Agent 池、资产绑定和 Workflow DAG 冻结进不可变的 `Composition.Snapshot`（Version 2）。
   - 资产文件在运行期间只读，严禁在运行中回写资产文件。

2. **Durable Run Owner**：
   - 运行态由独立的 SQLite 表 `workflow_run` 与 `workflow_step_run` 拥有，唯一写入者是 `WorkflowRun` Service（`packages/core/src/workflow/workflow-run.ts`）。
   - `SessionTask` 作为用户可见的任务投影，与 `workflow_step_run` 单向关联；不建立平行的状态同步通道。

3. **Orchestrator & Execution Owner**：
   - Root 会话固定为 `meta`，拥有取消权、部分成功裁决权与最终答复。
   - 编排循环由 `WorkflowRunner` 拥有；其所有权与 HTTP 请求 fiber 解耦——`WorkflowExecution`（基于 `SessionRunCoordinator`）按 Session 串行持有 run 循环，客户端断连或请求 fiber 被中断不会留下无主 run。
   - 全部步骤结算后，`WorkflowRunner` 把凭据扫描并按 code point 裁剪的 `<workflow_result>` 结构化摘要作为 durable synthetic 输入注入 root（`TaskDriver.injectSynthetic` -> `SessionV2.injectSynthetic` -> `SessionInput.admitSynthetic`），root 在下一个安全 provider 边界据此生成最终答复。
   - 执行 Agent 必须在 Snapshot 的 Agent Allowlist 内，通过 `TaskDriver` 创建子 Session 执行；`TaskDriver` 实现由调用方 composition root 通过 `TaskDriver.Runtime`（Context Reference）解析，不使用进程级「最后注册者胜」。

---

### 2.2 Run/Step 状态机与恢复术语

`workflow_run.status` 固定为 `pending | running | cancelling | completed | partial_success | failed | cancelled | recovery_required`；后五项为不可变终态。

`workflow_step_run.status` 固定为 `pending | ready | dispatching | running | cancelling | completed | failed | cancelled | skipped | execution_unknown`。

```text
pending -> ready -> dispatching -> running -> completed | failed | cancelled
                                      \-> cancelling -> cancelled
legacy/orphan running after restart -> execution_unknown
```

- `ready -> dispatching` 只持久化确定性 Task/child identity，不调用 Provider。
- `dispatching -> running` 持久化后才允许 Provider/Tool 副作用；崩溃后的 `dispatching` 可安全续接（`recoverRunning` 把它退回 `ready`，不重放任何 Provider 调用）。
- 启动恢复发现遗留 `running` 时，不自动重放未知副作用；Step 转 `execution_unknown`，Run 转 `recovery_required`，同 run 内未开始的 Step 转 `skipped`。`recovery_required` 是终态，只能由客户端显式重试（见 §2.4）。
- 每个已派发 Step 必须显式 settle，禁止遗留孤儿 `running`；`completeRun` 在任一 Step 仍处于 `pending | ready | dispatching | running | cancelling | execution_unknown` 时拒绝结算整个 run。
- 取消是两段式：`cancelRun` 持久化 `cancelling` 意图（活动 Step 转 `cancelling`，未开始 Step 转 `skipped`），`finalizeCancelRun` 才写入终态 `cancelled`。

#### Run 级 CAS 与 durable 事件

- `workflow_run.revision` 与 `workflow_step_run.revision` 是 CAS 边界，不是计数器：所有转换都带 `expectedRevision`（HTTP 层由 payload 的 `expectedRunRevision` / `expectedStepRevision` 提供），revision 不匹配即 `InvalidStateTransitionError`（HTTP 409）。
- 运行态变更事件是 durable EventV2 `workflow.run.updated`，按 `runID` 聚合（`WorkflowEvent.Updated`，durable version 1）。
- Run 行的写入发生在 `EventV2.publish(..., { commit })` 的 commit 回调里，与事件行同一个事务：commit 断言 `event.seq + 1 === run.revision`，任一侧被拒绝则事件与 DB 状态一起回滚（无「事件已发但状态未变」或反向的中间态）。
- 事件在 run 创建、`dispatching`、`running` 与终态重试建 run 时发布；Step 结算与 run 终态转换只在 CAS 下推进 revision。客户端因此必须把 `workflow.run.updated` 当作失效通知（见 §2.7），以 `GET .../workflow` 的读取结果为真值。

---

### 2.3 失败策略与部分成功语义 (Partial Success)

1. **步骤失败策略 (`StepDef.failurePolicy`)**：
   - `abort` (默认): 步骤失败立即终止本批调度，并将整个 WorkflowRun 标记为 `failed`。
   - `continue`: 允许步骤失败，后续非强依赖分支继续执行；最终整体状态判定为 `partial_success`。带 `branches` 的 Step 不得使用（见 §2.5.3）。
   - `retry`: 在同一个活跃 run 内创建新 attempt，上限 `maxAttempts (1..8)`。**没有退避延迟**：结算失败后立即插入下一 attempt 的 `ready` 行；需要节流请用 `timeoutSeconds` 而非退避。

2. **部分成功 (Partial Success)**：
   - frontier 排空后，若最新一轮全部失败步骤的策略都是 `continue`，run 结算为 `partial_success`；只要有一个失败步骤不是 `continue`，run 结算为 `failed`。
   - 根编排器（`meta`）在汇总最终答复时，明确标示已完成的部分和失败的步骤原因（`errorCategory` 固定分类，不回传原始错误文本）。

3. **最终回答所有权**：
   - 任何子 Agent 不得直接面向用户输出最终会话结论；全部子步骤的结构化输出经 `<workflow_result>` handoff 由根 `meta` 会话汇总生成最终回答。
   - handoff 文本先过 `CredentialScanner`，再按 12,000 code points（单步 2,000）裁剪，超出部分标 `[truncated]`；step 摘要缺失时退化为 `outputDigest`，不写入原始子会话输出。

---

### 2.4 重试与幂等性边界 (Retry & Idempotency)

1. **Exact Retry 幂等性**：
   - 提交面接受显式 `requestID`：`(session_id, request_id)` 唯一索引 + `request_digest`。相同 `requestID` 且 digest 一致返回已有 Run；digest 不一致返回 `RequestConflictError`（HTTP 409）。
   - 未带 `requestID` 时按运行身份（SessionID + SnapshotDigest + workflowRevision）去重，返回已有 Run，不重复创建。
   - 提交时可带 `expectedSnapshotDigest`；与当前 Snapshot 不一致直接 409，禁止在漂移的组合上开 run。
2. **Step-Level Retry**：
   - 活跃 Run 内的 `failurePolicy: retry` 创建新 attempt。
   - 终态后的人工重试创建新 Run，并记录 `parentRunID`、`rootRunID`、`retryOfStepRunID`；只重跑目标 Step 及其下游闭包，闭包外的 Step 按上一 run 的结算结果原样承接。源 Run 保持不可变。
   - 可人工重试的目标 Step 状态为 `failed | cancelled | execution_unknown`；源 Run 必须已是终态，否则 409。
   - 步骤输入由 Snapshot 及前序输出确定，严禁在重试时注入未经审查的代码。

---

### 2.5 安全与权限单点 (Security Boundaries)

1. **双层委派门禁**：
   - **第一层**：`WorkflowRunner` 派发前校验 Agent 必须在当前 Session 的 Snapshot `agents` allowlist 中（按 `name` 或 `id` 匹配），否则该 Step 以 `agent_not_allowed` fail closed。
   - **第二层**：`SessionV2.create({ parentID })` 与 `TaskDriver` 运行时通过 `SessionComposition.assertAgentAllowed` 强制断言；派发后还会校验 child 的 `parentID` 确实是本 Session，跨 root 拿到的 child 判为 `agent_not_allowed`。
2. **Command Binding 语义**：
   - Snapshot v2 按 `orchestrator` 与 `agents/<agent>` 冻结 Prompt/Skill/Command 目录；同一资产可被不同 consumer 复用，但同一 consumer 内重复引用 fail closed。
   - Command 是结构化指令模板（静态参数替换），绑定到特定 consumer。
   - Command 不赋予额外的 OS/Shell 权限，不创建独立的命令执行器；所有执行仍经由统一的 `ToolRegistry` 与 `PermissionEffective` 拦截。
3. **输入与分支约束**：
   - `StepDef.input` 只接受 JSON object，并仅作为结构化输入传递给执行 Agent，不得解释为可执行代码或 Shell 脚本。
   - 分支输出只接受严格 `{ branch, summary? }`；`summary` 最多 2,000 code points，非法字段或类型 fail closed。
   - 分支节点 fail closed 是硬规则：输出未命中任何 `branches` key 时该 Step 结算为 `failed / invalid_branch_output`，且 `continue` 不能放行它；frontier 侧再校验一次「已 `completed` 的分支节点必须带合法 `branchTarget`」，否则整个 run 以 `invalid_branch_output` 失败。未选中分支臂的传递闭包（排除被选中闭包）标 `skipped`。
   - 带 `branches` 的 Step 禁止使用 `failurePolicy: continue`——`validateGraph` 以 `branch_continue_forbidden` 在解析期拒绝，不依赖运行期兜底。
4. **冻结上限**：Snapshot v2 持久化 `maxConcurrency`，范围固定为 `1..8`（`MAX_PARALLEL`）。Schema 同时钉死 `MAX_STEPS = 64`、`maxAttempts ∈ 1..8`（`MAX_ATTEMPTS`）、`timeoutSeconds ∈ 1..86400`（`MAX_TIMEOUT_SECONDS`）、`MAX_BRANCH_SUMMARY_CODE_POINTS = 2000`，YAML 作者无法用超大重试/超时构造资源耗尽面。

---

### 2.6 Kill-Switch 与 Mid-Drain 执行阻断

1. **Flag 作用域**：
   - `AIGCFROGE_CUSTOM_MODE`（默认关闭）。
2. **创建面门禁**：
   - Flag 关闭时，`plan`、`start`、`upgrade`、`session.custom` 返回 HTTP 400 (`UnsupportedProductModeError`)，历史会话只读。
3. **Drain 级执行阻断**（当前实现边界）：
   - `WorkflowRunner` 在每轮 frontier 求解前检查 flag；关闭时以 `custom_mode_disabled` 走 `cancelRun` -> `finalizeCancelRun`，run 结算为 `cancelled`。
   - 每个 Step 的 `prepare` 与 `execute` 入口各自复查 flag，关闭时该 Step 以 `custom_mode_disabled` 结算，不再派发新的子 Session。
   - `ProductModePolicy.assertRuntimeSupported("custom")` 在 flag 关闭时失败，因此 `SessionV2.create`（含 `TaskDriver` 派生的 child）、`prompt`、`shell`、`skill`、`switchAgent`、`switchModel` 全部 fail closed，已建会话无法继续接受新输入或派生新执行者。
   - **残留边界**：已经进入 `running` 的子 Session 内部 Provider/Tool 调用不会被 flag 中断，`SessionRunner` 也没有 per-provider-turn 的 flag 检查；运营关闭开关只保证「不再派发新工作」，不保证「立即打断在飞工作」。该残留登记在 [`docs/technical-debt.md`](../../technical-debt.md)。

---

### 2.7 公共 API 与事件面

1. **端点（5 个，均在实例 HttpApi `session` 组内，走 `Authorization` + `WorkspaceRouting` + `InstanceContext` 中间件）**：

| 方法 | 路径                                                            | operationId                   | 语义                                                                                |
| ---- | --------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------- |
| GET  | `/session/{sessionID}/workflow`                                 | `session.workflow.get`        | 读取当前 run + 全部 step run（无 run 时返回空投影，200）                            |
| POST | `/session/{sessionID}/workflow/run`                             | `session.workflow.run`        | **202**：admit run 并唤醒进程内 owner，不等待执行                                   |
| POST | `/session/{sessionID}/workflow/{runID}/cancel`                  | `session.workflow.cancelRun`  | 200：`expectedRunRevision` CAS 下写 `cancelling`、interrupt owner、结算 `cancelled` |
| POST | `/session/{sessionID}/workflow/{runID}/step/{stepRunID}/cancel` | `session.workflow.cancelStep` | 200：run + step 双 revision CAS 下取消单个 step，不触发自动重试                     |
| POST | `/session/{sessionID}/workflow/{runID}/step/{stepRunID}/retry`  | `session.workflow.retryStep`  | **202**：按 §2.4 建新 lineage run 并唤醒 owner                                      |

2. **无 Workflow 专属 SSE 流**：`workflow.run.updated` 复用既有 `/event` 流，仅作为失效通知（invalidation notice）；客户端收到后重新 `GET .../workflow`，不在客户端推演 frontier 或成功语义。
3. **错误映射固定**：`RequestConflictError` / `InvalidStateTransitionError` -> 409；run/step 不存在或不属于该 Session -> 404；Snapshot 无 workflow -> 400；custom 能力未协商或 flag 关闭 -> 400 `UnsupportedProductModeError`。

---

## 3. 架构影响与五层映射

| 层级            | 职责与变更                                                                                                                                                                                                                                                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **L1 Schema**   | `Snapshot v2` version union、`WorkflowAsset.StepDef` 扩展（失败策略、分支、重试/超时上限）、`WorkflowRunStatus`、`StepRunStatus`、`ErrorCategory` 固定分类、`BranchOutput`、`validateGraph`                                                                                                                                                     |
| **L2 Core/DB**  | 新增 `workflow_run` 与 `workflow_step_run` 表（run 级 `(session_id, request_id)` 唯一索引 + lineage 列）、`WorkflowRun` Service（唯一状态机与 CAS 写入者）、`WorkflowRun.findReadySteps` DB 派生 frontier（在 CAS 下持久化 `pending -> ready` 与未选中分支的 `skipped`，非纯函数）、`WorkflowRunner` 编排循环、`WorkflowExecution` 进程内 owner |
| **L3 HTTP/SDK** | §2.7 的 5 个端点（status / run 202 / run cancel / step cancel / step retry 202）、typed idempotency 与 revision CAS payload、SDK 客户端类型重新生成                                                                                                                                                                                             |
| **L4 App/UI**   | Builder DAG 预览、多 Agent 列表、Session 运行态面板（step 进度、取消、重试、部分成功、`workflow.run.updated` 失效刷新）                                                                                                                                                                                                                         |
| **L5 Security** | `SessionComposition.assertAgentAllowed` 双层门禁、`TaskDriver.Runtime` 按 composition root 解析、handoff 凭据扫描与裁剪                                                                                                                                                                                                                         |

---

## 4. 审批与授权记录

- **产品架构审批**：Approved（代理代行，确认多 Agent 编排与 DAG 预览符合 PRD v1.2）
- **Core 运行时审批**：Approved（代理代行，确认 DB 唯一 Run Owner、Settle 铁律与状态机定义）
- **安全团队审批**：Approved（代理代行，确认双层门禁、Command 模板化与无代码执行沙箱）
- **App/前端审批**：Approved（代理代行，确认运行态投影只读 Run/Step state，文案按 en/zh/zht 三语维护 + 英文兜底，遵循 2026-07-31 语言策略）
- **Schema/SDK 审批**：Approved（代理代行，确认 Snapshot v2 向后兼容与 version union）
