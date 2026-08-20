# ADR-18: Custom Mode Multi-Agent Workflow Execution

> 状态：**Accepted for M2 implementation v1.0**（2026-08-20；用户授权 AI 代理代行 Product / Core / App / Security / Schema+SDK 技术审批）  
> 日期：2026-08-20  
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
-> WorkflowRun/StepRun durable owner (DB-derived ready frontier)
-> meta dispatches Snapshot pool Agents via SessionTask/TaskDriver (serial/parallel/branch)
-> per-step settle success/failure/cancel + root owns final answer & cancellation
-> partial success / retry-resume / recovery / move / upgrade
```

1. **Definition Owner**：
   - 静态 Workflow 定义由 `.aigcfroge/workflows/*.yaml` 资产管理，并在 Profile/Composition 中以 `WorkflowRef` 显式引用。
   - Session 创建时，由服务端通过 `CompositionResolver` 将 Agent 池、资产绑定和 Workflow DAG 冻结进不可变的 `Composition.Snapshot`（Version 2）。
   - 资产文件在运行期间只读，严禁在运行中回写资产文件。

2. **Durable Run Owner**：
   - 运行态由独立的 SQLite 表 `workflow_run` 与 `workflow_step_run` 拥有。
   - `SessionTask` 作为用户可见的任务投影，与 `workflow_step_run` 单向关联；不建立平行的状态同步通道。

3. **Orchestrator & Execution Owner**：
   - Root 会话固定为 `meta`，负责理解全局目标、监听步骤结算（settle）并生成最终答复。
   - 执行 Agent 必须在 Snapshot 的 Agent Allowlist 内，通过 `TaskDriver` 创建子 Session 执行。

---

### 2.2 步骤状态机 (Step State Machine) 与取消术语

#### 状态定义与转换
`workflow_step_run.status` 枚举：
- `pending`: 初始状态，等待前置依赖完成。
- `ready`: 前置依赖满足（进入 Ready Frontier），等待调度器派发。
- `running`: 调度器已调用 `TaskDriver` 启动子会话执行。
- `completed`: 子步骤成功完成并生成结构化输出。
- `failed`: 子步骤执行失败（达到最大重试次数或遇到不可恢复错误）。
- `cancelled`: 运行中（`running`）的步骤因外部中断或根取消被强制终止。
- `skipped`: 未开始（`pending`/`ready`）的步骤因前序分支未选中、前置步骤失败（abort 策略）或根取消而被跳过。

```text
       [pending]
           │ (all dependencies met)
           ▼
        [ready]
           │ (dispatched to TaskDriver)
           ▼
       [running] ───────(root cancel / abort)───────► [cancelled]
      ┌────┴────┐
      ▼         ▼
 [completed] [failed]
      │
      └─(branch unselected / upstream failed)────────► [skipped]
```

#### Settle 铁律
每个派发的 step 必须显式 settle 为 `completed`、`failed` 或 `cancelled`，严禁遗留孤儿 `running` 或 `in_progress` 状态。

---

### 2.3 失败策略与部分成功语义 (Partial Success)

1. **步骤失败策略 (`StepDef.failurePolicy`)**：
   - `abort` (默认): 步骤失败立即终止后续依赖链路，并将整个 WorkflowRun 标记为 `failed`。
   - `continue`: 允许步骤失败，后续非强依赖分支继续执行；最终整体状态判定为 `partial_success`。
   - `retry`: 支持按指数退避或固定间隔重试指定次数（`maxAttempts`）。

2. **部分成功 (Partial Success)**：
   - 当 WorkflowRun 中存在失败但非关键的步骤（`continue` 策略），且关键主链路完成时，WorkflowRun 结算为 `partial_success`。
   - 根编排器（`meta`）在汇总最终答复时，明确标示已完成的部分和失败的步骤原因。

3. **最终回答所有权**：
   - 任何子 Agent 不得直接面向用户输出最终会话结论；全部子步骤的结构化输出由根 `meta` 会话汇总生成最终回答。

---

### 2.4 重试与幂等性边界 (Retry & Idempotency)

1. **Exact Retry 幂等性**：
   - 重复提交相同的 Run 请求（匹配 SessionID + SnapshotDigest）返回已有 Run 状态，不重复创建。
2. **Step-Level Retry**：
   - 允许对 `failed` 状态的 Step 发起重试，`attempt` 计数自增，并生成新的 `workflow_step_run` 记录或通过 CAS revision 更新。
   - 步骤输入由 Snapshot 及前序输出确定，严禁在重试时注入未经审查的代码。

---

### 2.5 安全与权限单点 (Security Boundaries)

1. **双层委派门禁**：
   - **第一层**：`WorkflowScheduler` 派发前校验 Agent 必须在当前 Session 的 Snapshot `agents` allowlist 中。
   - **第二层**：`SessionV2.create({ parentID })` 与 `TaskDriver` 运行时通过 `SessionComposition.assertAgentAllowed` 强制断言。
2. **Command Binding 语义**：
   - Command 是结构化指令模板（静态参数替换），绑定到特定 Agent。
   - Command 不赋予额外的 OS/Shell 权限，不创建独立的命令执行器；所有执行仍经由统一的 `ToolRegistry` 与 `PermissionEffective` 拦截。
3. **输入与分支约束**：
   - `StepDef.input` 仅作为结构化 JSON 输入传递给执行 Agent，不得解释为可执行代码或 Shell 脚本。
   - 分支条件（`branches`）只做结构化字段精确比对（如 `output.status === "ok"`），严禁执行任意 JS 表达式。

---

### 2.6 Kill-Switch 与 Mid-Drain 执行阻断

1. **Flag 作用域**：
   - `AIGCFROGE_CUSTOM_MODE`（默认关闭）。
2. **创建面门禁**：
   - Flag 关闭时，`plan`、`start`、`upgrade`、`session.custom` 返回 HTTP 400 (`UnsupportedProductModeError`)，历史会话只读。
3. **Drain 级执行阻断**：
   - 在 `SessionRunner` 每次 Provider Turn 及 `WorkflowScheduler` 派发新 Step 之前，检查 `AIGCFROGE_CUSTOM_MODE`；若被运营关闭，则安全暂停调度并 settle 当前活动步骤为 `cancelled`，防止未经授权的未决调度继续发生。

---

## 3. 架构影响与五层映射

| 层级 | 职责与变更 |
|---|---|
| **L1 Schema** | `Snapshot v2` version union、`WorkflowAsset.StepDef` 扩展（失败策略、分支、重试）、`WorkflowRunState`、`StepRunState` |
| **L2 Core/DB** | 新增 `workflow_run` 与 `workflow_step_run` 表、`WorkflowRun` Service、`WorkflowStateMachine`、`getReadyFrontier` 纯计算 |
| **L3 HTTP/SDK** | Workflow 状态查询、单步重试与取消端点，SDK 客户端类型重新生成 |
| **L4 App/UI** | Builder DAG 预览、多 Agent 列表、Session 时间线 Step 进度与部分成功展示、Playwright E2E |
| **L5 Security** | `SessionComposition.assertAgentAllowed` 扩展 step identity 校验，双层门禁拦截 |

---

## 4. 审批与授权记录

- **产品架构审批**：Approved（代理代行，确认多 Agent 编排与 DAG 预览符合 PRD v1.2）
- **Core 运行时审批**：Approved（代理代行，确认 DB 唯一 Run Owner、Settle 铁律与状态机定义）
- **安全团队审批**：Approved（代理代行，确认双层门禁、Command 模板化与无代码执行沙箱）
- **App/前端审批**：Approved（代理代行，确认时间线投影与 18 语言规范）
- **Schema/SDK 审批**：Approved（代理代行，确认 Snapshot v2 向后兼容与 version union）
