# Meta-Agent 持久委派对话闭环升级实施计划（TDD 可直接执行版）

> **状态**：Implementation-ready TDD execution plan（2026-09-04；设计已合并，runtime 尚未实施）
> **目标**：实现“Meta-Agent → Build 子智能体 + Codex CLI 审查智能体”的持久、多轮、可恢复、可关闭的委派闭环。
> **主 ADR**：[ADR-22：Meta-Agent 持久委派对话与多参与者闭环](../architecture/adr/ADR-22-meta-agent-persistent-delegation.md)
> **产品需求**：[Meta-Agent Orchestrator PRD](../prd/meta-agent-orchestrator.md)
> **文档审查基线**：本地 `main=3c4e2be50`（2026-09-04）承载初版设计合并；该 SHA 只用于追溯，不作为生产实施硬编码基线。
> **实施基线**：两份实施计划合入并推送后，以创建 worktree 时最新的 `origin/main` 为准，Phase 0 必须记录准确 SHA。
> **实施分支建议**：`delegation-runtime`（最多三段、无 slash；使用独立 worktree，见 §16.1）
> **先例调研**：见 ADR-22 §6。开工前必读 §6.4——审查绑定 revision 在现有生态中没有可抄的实现。

## 修订记录

**2026-09-04 TDD 施工补充（本次修订）**：本计划仍以 §3–§15 的领域决策为真源，但新增 §16「直接实施 Runbook」作为实施者的逐步执行顺序。补充内容把当前代码族、canonical server 与 legacy instance API 的边界、每个 Phase 的红证类型、Layer/fixture 选择、迁移与 SDK 生成命令、兼容与回滚条件固化下来。若本节与旧的概念性示例冲突，以当前源码、ADR-22、§16 的 owner 与命令为准。

2026-08-31 审批后修订。原稿的以下判断已被代码或先例推翻，**不要按原稿理解**：

| 位置                        | 原稿                                                | 修订后                                                                                                                  |
| --------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| §2.1 运行中追加             | 把 `extendBackground` 当既有能力                    | 拆成三档；顺序多轮已可用无需 flag，运行中追加被 flag 门控且是排队不是插话，前台追加无路径（§2.1.1）                     |
| §2.2 `external_cli_session` | 暗示 schema 是瓶颈                                  | 该表无主键、唯一索引是 (父会话, 外部线程)；限制在读写逻辑，**很可能不需要新表**（§2.2.1）                               |
| §3.2 Participant            | `kind` 字段 + `capabilities` 布尔表 + 单一 `status` | 去掉 `kind`（按 provider 解析）、去掉布尔表（方法存在即能力）、`phase` 与 runtime status 分离                           |
| §4.1                        | `approved` 只能 → `closing`                         | 补 `approved → waiting_review`；补 `draft → cancelled`、`cancelled → archived`；`deleted` 不是状态                      |
| §4.4 barrier                | 写死 build/codex 两个 participant，digest 全等      | 按 role 计算；空 reviewer 不永久卡住；change-kind + copy condition 取代二元比较；批准/否决粘性不对称                    |
| §5.6 digest                 | 输入含 `latest durable event sequence`              | **删除**：非代码事件会推进序号，令刚完成的审查失效，形成活锁                                                            |
| §8.1 权限                   | 「外部 CLI 统一经过 PermissionV2 桥」               | 按 transport 分述；Codex SDK/JSONL 不伪造 PermissionV2 bridge，第一期 Codex 只读，app-server/ACP 控制另行接入（§8.1.1） |
| §10.5 门禁                  | 把 protocol/path checks 当作委派文档一致性 gate     | 两脚本都存在但只做基础检查；新增 `scripts/check-delegation-docs.sh` 才检查 PRD/ADR/计划一致性                           |
| Phase 0                     | 「建分支且不覆盖未提交修改」                        | 主工作区有并发写入者，改用独立 worktree                                                                                 |
| §15 方案对冲                | 只比较两个 LLM-in-loop 选项                         | 补第三条路线（声明式编排）；两项原"待裁决"已裁决                                                                        |

**2026-09-04 文档裁决（B6、H7–H10、M8–M12）**：本文与 ADR-22 共同定义当前实施契约；PRD 负责产品目标与用户可见行为，ADR-22 覆盖领域模型、状态机、EventV2、权限和 transport 语义，本文覆盖 TDD 顺序、owner、命令、测试证据、迁移和回滚。若产品目标与实现形状发生冲突，先修 PRD；不允许让实施者在两个“当前有效”文档之间自行猜优先级。

**两项 Schema 裁决（2026-08-31，详见 §15）**：投递**不建投影表**（只建 delegation/participant/turn 三张），Delegation **铸造独立 branded ID**（不复用 `parentSessionID`）。同时删 `Delegation.currentTurn`、保留 `metaAgentID?`（已核实 M:N 不可派生）。新发现两条缺口已补：缺 `delegation_id` 须解析到最近活跃委派（§5.2.1）、委派归宿策略（Phase 6）。

**各 Phase 的「TDD 红」清单已按上述修订重写**，并新增 §6 的 Gate ↔ Phase 对应表。旧稿的 Phase 1 清单要求给 Delivery 状态机和二元 digest 比较写测试，**照旧稿写会写出错的测试**。

---

## 0. 文档定位与执行协议

本文档是 2026-08-31 之后的**唯一施工入口**。旧的 MVP、V1→V2 闭环和 External CLI M1–M5 文档仍保留历史事实，但不再作为新功能的独立执行计划，详见 [文档归一化矩阵](#14-文档归一化与归档策略)。

本计划已经吸收并遵循：

- [CLAUDE.md](../../CLAUDE.md)：九荣九耻、根因收敛、改完即审、不要宣称未验证能力；
- [AGENTS.md](../../AGENTS.md)：Effect/Schema、自导出、单一 owner、Session V2 不变量、测试和 typecheck 规则；
- [packages/aigcfroge/AGENTS.md](../../packages/aigcfroge/AGENTS.md)：InstanceState、数据库和 V1 composition root 约束；
- [packages/core/src/tool/AGENTS.md](../../packages/core/src/tool/AGENTS.md)：单一 Tool 表示、单一 registry、definition/settle 一致性；
- [packages/llm/AGENTS.md](../../packages/llm/AGENTS.md)：LLM route/protocol 边界和 recorded test 纪律；
- [.aigcfroge/skills/protocols/SKILL.md](../../.aigcfroge/skills/protocols/SKILL.md)：L0→L1→L2→L3 文档路由和双向索引；
- [.aigcfroge/skills/effect/SKILL.md](../../.aigcfroge/skills/effect/SKILL.md)：Effect v4 真源、显式 Layer、错误传播；
- [.aigcfroge/skills/database/SKILL.md](../../.aigcfroge/skills/database/SKILL.md)：snake_case、TypeScript migration、schema/migration 同步；
- [.aigcfroge/skills/reuse-first-refactor/SKILL.md](../../.aigcfroge/skills/reuse-first-refactor/SKILL.md)：复用 → 删除 → 归并 → 重构 → 新增；
- [.aigcfroge/skills/quality-to-pr/SKILL.md](../../.aigcfroge/skills/quality-to-pr/SKILL.md)：每个 slice 红→绿→回归→差分审查→文档同步；
- 本机 Codex CLI `codex-cli 0.150.1` 的 app-server 协议快照：`thread/start`、`thread/resume`、`thread/fork`、`thread/archive`、`thread/delete`、`turn/start`、`turn/steer`、`turn/interrupt`、状态通知。快照由 `codex app-server generate-json-schema --out <dir>` 生成，不能把本机版本行为未经 adapter contract test 直接当作跨版本契约。
- 当前 API 拓扑：canonical V2 surface 在 `packages/server/src/api.ts` / `packages/server/src/groups/*` / `packages/server/src/handlers/*`，legacy instance surface 在 `packages/aigcfroge/src/server/routes/instance/httpapi/*`；两者只能共享 Core Service，不能各自复制业务状态机。

### 0.1 不变的工程红线

1. 不新建第二个 Tool 表示、第二个 CLI registry 或第二个 Session transcript；
2. 不让 handler、adapter、UI 直接写委派表；
3. 不在 V2 中桥接回 legacy `SessionPrompt.loop(...)`；
4. 不以 `BackgroundJob` 内存状态作为恢复真源；
5. 不用 `Effect.sleep`/`setTimeout` 等待并发工作；
6. 不把 Codex review verdict 当作 PermissionV2 grant；
7. 不自动重跑未知副作用；
8. 不在旧 `task_id`/`external_cli_session` 迁移完成前删除兼容路径；
9. 每个阶段先红测试，再最小绿实现，再执行包级验证；
10. 所有“支持”必须有代码路径、持久化断言和失败路径证据。

---

## 1. 用户场景与完成定义

### 1.1 主场景

```text
Meta-Agent 创建 Delegation D1
  ├─ Build participant：修改代码
  └─ Codex participant：审查 Build 的修改

Meta-Agent 发现新证据 E2
  ├─ 向同一个 Build participant 追加 Turn 2
  └─ 向同一个 Codex participant 追加 Turn 2

Build 完成 revision R2
  └─ Codex 只对 R2 审查并返回结构化批准/拒绝

Meta-Agent 满足完成条件
  ├─ 停止活动 turn
  ├─ 关闭 participants
  ├─ Delegation → completed
  └─ 默认 archive，保留历史
```

### 1.2 功能完成定义

必须同时满足：

- 一个稳定 `delegationID` 能引用本次协作；
- Build 和 Codex 各有稳定 participant 记录；
- 多个 turn 追加到同一 participant conversation；
- 同一条新证据能 fan-out 到多个 participant，且每个 delivery 独立可重试；
- Codex review 绑定 Build `revisionDigest`，过期审查不能过 barrier；
- participant 支持 `running/idle/failed/recovery_required/closed` 等可解释状态；
- Meta-Agent 能 `append/steer/interrupt/complete/close/archive/fork`；
- 进程重启不会丢失委派状态，也不会静默重跑未知副作用；
- 默认关闭新 flag 时，现有 `task` 和 CLI resume 行为不变；
- UI 和 API 可列出、查看、追加、停止、归档委派；
- 关闭后历史仍可审计，物理删除是显式操作。

### 1.3 不纳入本期

- 跨机器/集群 ownership、分布式 lease 和多节点执行；
- 让所有外部 CLI 都支持 Codex app-server 级 fork/archive/steer；
- PTY 驱动交互式 CLI；
- 自动推断自然语言 review 为 `approved`；
- 让子智能体再次递归委派；现有 child Session 递归 deny 保持不变；
- 将用户个人记忆与项目级 Meta-Agent memory 合并。

---

## 2. 现状基线与根因收敛

### 2.1 已有能力（复用，不重写）

| 能力               | 当前 owner                                   | 复用方式                                       |
| ------------------ | -------------------------------------------- | ---------------------------------------------- |
| 内部 child Session | `SessionV2` / `TaskDriver`                   | participant 绑定 `childSessionID`              |
| 内部续接           | V2 `task_id` / child Session ID              | 迁移为 participant 的兼容 lookup               |
| 前台/后台执行      | `TaskDriver.delegate` / `delegateBackground` | 投递执行器复用                                 |
| 运行中追加         | `extendBackground`                           | 见 §2.1.1 的三档区分；**不能整体当作既有能力** |
| 外部 CLI registry  | `core/tool/cli-adapter.ts`                   | 只扩展现有 `CliAdapter`，不建第二 registry     |
| Codex resume       | `codex-sdk.ts` / `codex.ts`                  | participant 保存 external thread ID            |
| ACP 生命周期       | `acp-client/` + `acp.ts`                     | 在具备能力的 CLI 上提供控制操作                |
| durable 输入/历史  | `SessionInput` / `SessionHistory` / EventV2  | 内部 participant 的 turn 输入真源              |
| Meta 观测          | `meta_agent_step`                            | 保留为兼容投影，不作为聚合根                   |
| Task 任务面板      | `SessionTask` / AgentTaskHub                 | 作为 UI 进度投影，不替代 Delegation 状态       |
| 权限               | `PermissionV2`                               | **覆盖面不完整，见 §8.1**                      |
| 协议卡片           | `agents.json` / `protocol.md`                | participant prompt 的软约束来源                |

#### 2.1.1 「运行中追加」的三档现状（勿当作一种能力）

代码核实（2026-08-31）：

| 形态                               | 现状                                                                                   | 依据                                                                                         |
| ---------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **顺序多轮**：上一轮结束再发下一轮 | ✅ 已可用，**无 flag**                                                                 | 前台路径 `createChild({ id: task_id })` → `TaskDriver.delegate`，同一 child Session 累积历史 |
| **向运行中的后台任务追加**         | ⚠️ 被 `AIGCFROGE_EXPERIMENTAL_BACKGROUND_SUBAGENTS` 门控（默认关），且必须带 `task_id` | flag 关闭时 `background` 字段连工具 schema 都不暴露                                          |
| **向运行中的前台任务追加**         | ❌ 无路径                                                                              | 前台 `delegate` 是阻塞调用，工具未返回前发不出第二条                                         |

另外两点会影响 Phase 4 的设计：

- `extendBackground` 的语义是**尾部串联 FIFO 排队，不是插话**：新建 tail `Deferred`，fork 出的工作先 `await` 前一个 tail，所以追加的输入要等当前轮跑完；它只对应显式 `queue`，不能被描述成 `steer`，也不能反向发明第二套投递词汇；
- `extendBackground` 不接收 `taskID` / `onSettle`，**没有回写腿**。把它映射成一个有终态的投递记录需要补这条腿。

### 2.2 共享根因

当前多个“已支持但不完整”的现象共享一个根因：**委派没有独立的持久聚合根和 participant/turn 关系**。

表现为：

- `task_id` 只能表达一个 child Session，不能表达一组协作参与者；
- `external_cli_session` 的**读写逻辑**只能取「该父 Session + CLI target 下最近一条 active」，无法安全寻址多个 Codex thread；
- `meta_agent_step` 只能记录执行片段，不能驱动 append、barrier、close 或恢复；
- `BackgroundJob` 能运行但不能代表重启后的 durable 状态；
- 自由文本结果没有严格绑定 revision；
- interrupt/cancel 存在，但 close/archive/delete 没有统一语义。

#### 2.2.1 `external_cli_session` 的限制在逻辑不在 schema

这条影响 Phase 3 的工作量，必须先讲清楚，否则会去建一张不需要的表。

代码核实（2026-08-31）：该表**没有主键**，唯一索引是 `(session_id, external_session_id)`，也就是 **(父会话, 外部线程)**，不是 `(父会话, cli_target)`。物理上它已经能容纳同一 parent + codex 下的 N 条线程行。

单线程限制全部来自读写逻辑：查询按 `status = 'active'` 过滤 + `orderBy(desc(time_updated)).get()` 取单行；写入前强制把该 (parent, cli) 下所有旧 active 行降级。

结论：

- Phase 3 的备选方案「若迁移期间不能加列，则新增 binding 表」**大概率不需要**。改读写逻辑 + 最多加一个 nullable `participant_id` 列即可；
- 该表缺主键本身是存量缺陷，可在本批 migration 顺手补上；
- `meta_agent_step` 的问题比原文更重：`writeStep` 硬编码 `status: "running"` 且 `subagent` 路径从不调 `updateStep`，内部委派行永久卡在 `running`；`meta_agent_session_id` 存的是 session id 而非兄弟表的复合键，不构成真 FK。这两点要落进 Phase 2 的红测试。

---

## 3. 目标架构

### 3.1 分层

```text
Product/App/UI
  └─ Delegation HTTP/SDK/UI commands
Application (aigcfroge)
  └─ task tool / Meta prompt / compatibility adapters
Domain (core)
  ├─ DelegationService          durable aggregate owner
  ├─ DelegationExecution        process-local scheduler/coordinator
  ├─ DelegationReview           review envelope + revision barrier
  ├─ DelegationRecovery         restart reconciliation
  └─ existing SessionV2/TaskDriver/CliAdapter seams
Infrastructure
  ├─ EventV2 durable aggregate
  ├─ Drizzle projection tables
  ├─ SessionV2 child sessions
  └─ external CLI SDK/ACP/JSONL transports
```

### 3.2 核心对象

#### `Delegation`

```text
id: Delegation.ID                       独立 branded ID，不复用 parentSessionID
parentSessionID: SessionSchema.ID
metaAgentID?: MetaAgent.ID
title: string
status: draft | running | waiting_review | changes_requested | approved |
        failed | recovery_required | closing | completed | archived | cancelled
createdAt / updatedAt / closedAt / archivedAt
```

两处与初稿不同：

1. **删掉 `currentTurn`**。它可以从该委派 turn 的 max seq 派生；持久化派生值等于给自己造一个可能与事实不一致的第二真源。
2. **保留 `metaAgentID?`**，因为它**不能**从 `parentSessionID` 推出来。核实依据：`meta_agent_session` 表的主键是 `primaryKey({ columns: [meta_agent_id, session_id] })`，即 M:N 关联（一个 meta_agent 有多个 session，角色分 `orchestrator | worker | tool`），所以一个 session id 不唯一决定一个 meta_agent id。它不是冗余列。

**为什么铸造独立 ID** 见 ADR-22 §2.1：委派活得比对话轮次长而对话继续往下走 → 同一父 Session 下必然出现多个并存委派；而 barrier 是按委派算的，两件独立工作不能共享完成条件。次要理由是事件流隔离（复用 `parentSessionID` 会与 session 事件共用一个单调序号空间）。

#### `Participant`

```text
id: DelegationParticipant.ID
delegationID: Delegation.ID
provider: string                       注册表 provider 名（内部 child / acp / codex / claude-code ...）
target: string
role: implementer | reviewer | approver | observer
context: fresh | fork
childSessionID?: SessionSchema.ID
externalThreadID?: string
phase: provisioning | active | failed   持久名册事实，单调只前进
lastActivityAt / closedAt
```

三处与初稿不同，理由见 ADR-22 §2.3：

1. **没有 `kind: internal | external_cli`**。内外差异按 `provider` 名解析到实现，不做成字段。
2. **没有 `capabilities` 字段包**。start-time 能力读 provider 静态 descriptor；续接/steer/fork/archive 等能力由**可选方法是否存在**决定，靠 TS narrowing 发现。布尔表与方法实现是两份真源，必然漂移。
3. **`phase` 只存名册事实，`running/idle/inactive` 是派生的 runtime status，不入库、永不回写 `phase`**。合成一个字段会让一次迟到的 `running` 心跳把 `failed` 终态冲掉且无法复原。

#### `Turn`

```text
id: DelegationTurn.ID
delegationID: Delegation.ID
seq: number
kind: task | evidence | review | repair | close
prompt: string
evidenceDigest?: string
revisionDigest?: string
status: admitted | queued | running | partially_completed | completed |
        failed | cancelled | recovery_required
createdAt / startedAt / completedAt
```

#### 投递（`Delivery`）——事件承载，**不建投影表**

投递是一个 Turn 投递给一个 Participant 的执行记录。它的字段形状如下，但**只作为 `delegation.delivery_*` 事件的载荷存在**，不落独立 Drizzle 表：

```text
turnID: DelegationTurn.ID
participantID: DelegationParticipant.ID
delivery: steer | queue                           投递意图，见 ADR-22 §2.6
status: admitted | queued | running | completed | failed | cancelled | recovery_required
attempt: number
externalTurnID?: string
resultSummary?: string
reviewVerdict?: changes_requested | approved | rejected
reviewedRevision?: { commitSha: string; digest: string }
errorCode?: string
```

聚合状态用**增量折叠**得到：活跃委派的折叠状态随 Activation 生命周期驻留、随新事件增量推进；冷启动借 `event_aggregate_type_seq_idx`（`aggregate_id, type, seq`）一次性折叠。

裁决理由见 ADR-22 §2.6。要点：EventV2 是真源、Drizzle 表只是投影，所以这是**查询形状问题不是真源问题**；投影可随时 drop 重建，而正确形状取决于尚未编写的列表页 UI，现在猜等于赌。

**两条配套约束（违反其一，这个裁决就白做）**：

- Service API 不得出现按投递分页的签名（见 §5.1）。API 形状跨 SDK 和 UI，比表结构更难改；
- §4.4 的 barrier 必须是**吃折叠状态的纯函数**，不吃数据库句柄。这样将来若加投影表，barrier 一行不用改。

技术债与触发条件见 `docs/technical-debt.md`。

### 3.3 Event 命名

所有 Delegation EventV2 定义必须使用以下 durable aggregate 形状：

```ts
durable: {
  version: 1,
  aggregate: "delegationID"
}
```

每个事件 payload 必须携带 `delegationID`；`aggregate: "delegation"`、payload 字段 `delegation` 或把 `parentSessionID` 当作 Delegation aggregate id 均禁止。

事件至少包含：

```text
delegation.created
delegation.participant_added
delegation.turn_admitted
delegation.delivery_started
delegation.delivery_completed
delegation.delivery_failed
delegation.delivery_recovery_required
delegation.review_changes_requested
delegation.review_approved
delegation.turn_appended
delegation.participant_interrupted
delegation.participant_closed
delegation.completed
delegation.cancelled
delegation.archived
delegation.forked
```

事件 payload 必须是 Schema，不能塞完整 prompt、Authorization header、token 或原始工具输出。日志只允许 ID、状态、目标和经过清理的错误码/摘要。

---

## 4. 状态机与不变量

### 4.1 Delegation 状态

```text
draft → running | cancelled
running → waiting_review | changes_requested | approved | failed | closing | cancelled
waiting_review → changes_requested | approved | failed | closing
changes_requested → running | closing | cancelled
approved → waiting_review (旧结论被新 revision 判为 outdated) | closing
failed → running (显式 retry) | recovery_required | closing
recovery_required → running (经过 reconciliation) | failed | closing
closing → completed | cancelled | failed
completed → archived
cancelled → archived
archived → completed (unarchive)
```

非法转换必须返回 typed error；不得通过字符串覆盖状态。

四处与初稿不同：

1. **`draft → cancelled`**：初稿只有 `draft → running`，草稿无法在不跑一遍的情况下废弃。
2. **`approved → waiting_review`**：初稿 `approved` 只有 `→ closing` 一个出口，与 §4.3 不变量 5（新 revision 令旧批准失效）**直接冲突**——处于 `approved` 时若 Build 产出新 revision，状态机无合法出路。
3. **`cancelled → archived`**：初稿 `cancelled` 是无出口终态，被取消的委派会永久留在活跃列表里，与 §1.2「关闭后历史仍可审计」不符。
4. **`deleted` 不是状态**。初稿写了 `archived → deleted`，但 `deleted` 不在 §3.2 的 status 枚举里。purge 是**行记录的物理删除操作**，不是聚合状态；它不进状态机，只作为需显式权限的命令存在。

### 4.2 Participant 状态

`phase` 是持久名册事实，单调只前进，恰好落在一个终态：

```text
provisioning → active | failed
active → failed (不可恢复) | closed
failed → active (显式 retry 且 reconciliation 通过) | closed
```

`running / idle / inactive` 是**派生的 runtime status，不入库**，由 Activation 是否存在及其忙闲推导，**永不回写 `phase`**。`recovery_required` 同样不是 phase，它是投递级的状态（§4.3）。

理由见 ADR-22 §2.3：初稿把瞬时运行态和生命周期终态混在一个字段里，一次迟到的 `running` 心跳就能把 `failed` 冲掉。

### 4.3 Turn/投递不变量

1. `turn.seq` 在同一 Delegation 内单调递增；重复 command 返回原结果，去重键由被投递物自身携带（见不变量 11），不引入独立 idempotency 表；
2. 一个 Turn 可以有多个投递，但一个 `(turnID, participantID)` 只能有一个当前有效投递；
3. 投递完成必须引用 participant 的 conversation handle；
4. review `approved` 满足 barrier 的条件是 **change kind 判定为可复制**，不是 digest 全等（§4.4）；
5. Build 产生新 revision 后，按 change kind 决定旧批准是复制还是标记 **outdated**；被标记 outdated 的结论不得继续满足 barrier；
6. `rejected` 是 Delegation 级、跨 revision 持续阻塞，必须显式撤销，不能被下一个 revision 自动清掉；
7. close 先**关闭准入**，再处理中断和活动投递，释放句柄时子先于父；
8. archive 不删除 Session、EventV2、turn、投递记录或审查回执；
9. `parentSessionID` 归属、Location 和 Product Mode policy 每次 command 都检查；
10. child Session 不得通过 task 工具递归创建 participant；
11. 目标侧在 pending inbox item 与最终落库消息上都保留 `{ turnID, deliveryOrigin, senderParticipantID }`；把该来源在 inbox 与历史上 fold 即去重键。恢复邮箱 = **已入队 − 已确认落库**；
12. **重试只对未结算的投递开放。** 已结算投递的返回值可能已经流向下游消费者，重跑会产生第二份副作用；已结算的只能通过新 Turn 重做；
13. 外部 CLI 的 `externalThreadID` 不得跨 parent Session 自动复用。

### 4.4 Review barrier

barrier 按 **role** 计算，不按写死的两个 participant 名字。初稿的 `buildLatestDelivery` / `codexLatestDelivery` 与 §3.2 的 N participant + 4 role 模型不一致，且会让「只有一个 implementer、无 reviewer」的 Delegation 永远无法 `completed`——而 §5.2 的兼容路径恰好会造出这种 Delegation（旧 `task` 单次调用缺 `delegation_id` 时兼容创建一次委派）。

```text
implementers = participants where role == implementer
reviewers    = participants where role == reviewer   // 可以为空
approvers    = participants where role == approver    // 人工闸门，可以为空

latestRevision = 最新 implementer 投递固化的 revision snapshot

reviewSatisfied =
  reviewers 为空
    ? true                                    // 无 reviewer 的委派不被 barrier 永久卡住
    : 每个 reviewer 的最新有效结论都满足：
        verdict == approved
        && copyable(changeKind(reviewedRevision, latestRevision), verdict)

blocked =
  存在任一 reviewer 的 rejected 结论且未被显式撤销    // Delegation 级，跨 revision 持续

canComplete =
  每个 implementer 的最新投递 == completed
  && reviewSatisfied
  && approvers 全部放行（为空则视为放行）
  && !blocked
  && noOpenDelivery
  && noPendingTurn
```

`copyable(changeKind, verdict)` 的默认策略必须写进 Schema/纯函数，而不是散落在调用点：

| verdict             | `no_change` | `no_code_change` |                 `formatting_only` | `rework` | 处理                                        |
| ------------------- | ----------: | ---------------: | --------------------------------: | -------: | ------------------------------------------- |
| `approved`          |        true |             true | false（本期按 `rework` 保守降级） |    false | 复制或标记 `outdated`                       |
| `changes_requested` |       false |            false |                             false |    false | 不复制，保留当前 revision 的待处理意见      |
| `rejected`          |       false |            false |                             false |    false | 不复制，并建立 Delegation 级 sticky blocker |

`outdated` 是 review receipt 的派生 disposition，不是 Delegation/Turn/Participant 的顶层 status；`soft_expired` 同样是列表可见性派生状态，不进入 status union。

缺少任意条件都只能进入 `waiting_review`、`changes_requested` 或 `closing`，不能进入 `completed`。

**必须成对测试的两侧**：测试 `rework` 不复制批准，并测试本期 `formatting_only` 被保守降级为 `rework`、不会错误复制批准；可靠 formatter service 的正向 `formatting_only → copy` 是后续独立任务，不得在本期伪造绿测。`rejected` 必须有显式 `retractRejection` 或等价人工 override 的正向测试；否则 sticky blocker 没有可实施出口。

**实现形状约束**：整个 barrier 是一个**纯函数**，入参是折叠后的委派状态（participants + 各自最新有效投递 + 最新 revision snapshot），**不接收数据库句柄、不发查询**。因为投递不建表（§3.2），barrier 只能吃折叠结果；反过来这也保证了将来若为性能补一张投影表，barrier 一行都不用改——只是折叠的数据来源换了。

barrier 必须能在纯单元测试里被调用，不需要任何实例级装配（core 侧用 `it.effect` 即可，见 §10.2）。

---

## 5. API、Tool 与 Adapter 契约

### 5.1 Core Service

新增 `packages/core/src/delegation/`，至少包含：

```text
schema.ts       Domain Schema / branded IDs / statuses
sql.ts          Drizzle projection tables
service.ts      DelegationService canonical owner
state.ts        pure transition functions
review.ts       review envelope + digest barrier
execution.ts    process-local coordinator seam
recovery.ts     restart reconciliation and safe resume policy
event.ts        EventV2 definitions and payload schemas
```

模块遵守 `export * as Delegation from "./..."` 自导出模式；多 sibling 目录不新增 barrel。

Service API：

```text
create(input)
get(id)
list(input)
resolveCurrent(parentSessionID)          解析该父 Session 最近活跃委派，见 §5.2
addParticipant(input)
getParticipant(input)
appendTurn(input)
listTurns(id)
foldState(id)                            折叠后的委派状态；barrier 的唯一入参来源
resume(input)
steer(input)
retry(input)
interrupt(input)
complete(input)
close(input)
archive(input)
unarchive(input)
fork(input)
reconcile(input)
retractRejection(input)
```

**没有 `listDeliveries(turnID)`。** 投递不建表（§3.2），投递事实通过 `foldState(id)` 返回的折叠状态读取。这不只是"表没建所以方法没有"——**按投递分页的签名一旦进了 Service 和生成的 SDK，形状就固化了**，Phase 6 想改成"按 participant 取最新"就是破坏性变更。API 形状跨 SDK 和 UI，比表结构更难改。

所有写方法：

- 先校验 parent Session / Location / Product Mode / permission；
- 以 idempotency key 防止重复 command；
- 在 EventV2 publish commit 中更新投影；
- 返回 typed domain errors；
- 不直接启动 provider 工作，除非 command 已 durable admitted。

#### 5.1.1 HTTP owner 与双入口边界

本项目当前存在两套 HTTP 拓扑，实施时不得凭路径猜 owner：

1. **Canonical V2 API**：在 `packages/server/src/groups/delegation.ts` 定义 `/api/delegation...` 合约，在 `packages/server/src/handlers/delegation.ts` 实现薄 handler，并在 `packages/server/src/api.ts`、`packages/server/src/handlers.ts` 注册。它是 SDK/OpenAPI 的唯一主合约。
2. **Legacy instance API**：在 `packages/aigcfroge/src/server/routes/instance/httpapi/groups/delegation.ts` 与对应 `handlers/delegation.ts` 提供兼容入口，并在 `InstanceHttpApi`/`instanceApiRoutes` 注册。它只能把已解码的请求转给同一个 `DelegationService`，不能新增状态转换、第二份投影或第二套权限判断。
3. 两套入口都必须以当前请求解析出的 `SessionLocationMiddleware`/`InstanceContextMiddleware`/`WorkspaceRoutingMiddleware` 为授权和 Location 来源；不得接受客户端传入的 `parentSessionID` 作为唯一信任边界。
4. Canonical OpenAPI identifier 使用 `v2.delegation.<operation>`；legacy identifier 使用 `legacy.delegation.<operation>`，避免 hey-api 在同一生成输入中发生平铺覆盖。每个端点都必须显式 `OpenApi.annotations({ identifier })`。
5. 两套入口都不暴露 `listDeliveries(turnID)`；Delivery 由 `foldState(delegationID)` 投影，避免 HTTP/SDK 先把错误查询形状固化。

### 5.2 `task` 工具兼容扩展

保留已有参数并新增可选字段：

```text
delegation_id?: string
participant_id?: string
turn_id?: string
role?: implementer | reviewer | approver | observer
revision_digest?: string
evidence_digest?: string
command?: append | steer | interrupt | close | retry | reconcile | archive | unarchive | fork | purge | retract_rejection
```

规则：

- **`delegation_id` 缺失时解析到该父 Session 最近活跃的委派，而不是新建**（见 §5.2.1）；
- `task_id` 只作为内部 participant child Session 的兼容入口；
- `execution_type: external-cli` 不直接创建第二个业务对象，而是解析/创建 external participant；
- `judge` 保持现有多模型仲裁语义，暂不强制纳入一个 Delegation，除非调用方显式提供 `delegation_id`；
- child Session 递归 deny 保持；
- tool output 返回 `delegationID`、`participantID`、`turnID` 和摘要，UI 不再靠字符串启发式寻找关联；**不返回 `deliveryID`**（投递不建表、无独立 id，见 §3.2）。

**Task 工具命令与 PermissionV2 source**：每个命令必须声明与 `packages/core/src/tool/AGENTS.md` 一致的 action；不得把 command 文本直接当 action，也不得由 HTTP/UI 伪造 `type: "tool"` source。第一期映射固定为：

| command                           | tool action      | 说明                               |
| --------------------------------- | ---------------- | ---------------------------------- |
| `append` / `steer` / `retry`      | `task`           | 复用现有 task 工具权限             |
| `interrupt`                       | `task_interrupt` | 控制当前运行，不授予写权限         |
| `close`                           | `task_close`     | 关闭新 Turn 准入                   |
| `archive` / `unarchive`           | `task_archive`   | 归档/恢复可见性                    |
| `fork`                            | `task_fork`      | 创建新 Delegation/participant 句柄 |
| `reconcile` / `retract_rejection` | `task_reconcile` | 人工恢复或撤销 sticky blocker      |
| `purge`                           | `task_purge`     | 物理删除，默认 deny                |

TaskDriver → CLI adapter 的 PermissionV2 callback 必须沿调用链保留父 task invocation 的 canonical source：`{ type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID }`。直接 HTTP/UI 命令走 route authorization + parent/Location ownership；若未来需要进入 PermissionV2，必须先扩展 source schema，不能伪造 tool source。

#### 5.2.1 当前委派解析：交互必须单焦点

允许同一父 Session 存在多个委派（§3.2），**但交互不得要求用户或模型报 ID**。

| 情形                                        | 行为                                |
| ------------------------------------------- | ----------------------------------- |
| 缺 `delegation_id`，该父 Session 有活跃委派 | **解析到最近活跃的那个**，追加 Turn |
| 缺 `delegation_id`，无活跃委派              | 创建一次新委派                      |
| 显式给了 `delegation_id`                    | 用它，并校验归属                    |
| 显式要求新建（新增可选标志）                | 创建新委派，即使已有活跃的          |

- 「最近活跃」的判据必须是**持久事实**——该委派最后一次 Turn 或投递事件的时间，不是内存状态；
- 解析结果必须回写 tool output，让 UI 和后续轮次能确认落在了哪个委派上；
- 这条规则不能省。初稿写的"缺 `delegation_id` 就兼容创建一次"在**短命委派**下没问题（一次 task 一个委派），但委派一旦长命（ADR-22 §2.1），它就变成**每一轮持续造空委派**的规则。而反方向——向模型索要 ID——会让模型开始猜 ID。

### 5.3 `CliAdapter` 扩展

不创建第二个 adapter interface 或第二个 registry。对现有 `CliAdapter` 增加可选控制能力：

```text
control?: {
  start(input): Effect<ExternalThreadHandle>
  resume(input): Effect<ExternalThreadHandle>
  turn(input): Effect<DelegationResult>
  steer?(input): Effect<void>
  interrupt?(input): Effect<void>
  fork?(input): Effect<ExternalThreadHandle>
  archive?(input): Effect<void>
  delete?(input): Effect<void>
}
```

**不加 `capabilities` 布尔表。** 初稿同时提议 `capabilities?: { resume, steer, interrupt, fork, archive, delete, liveUpdates }` 和上面的 `control?`，这是两份真源：布尔表说支持而方法不存在（或反之）时，没有任何门禁会报错。改为：

- **能力 = 可选方法的存在**，用 TS narrowing 发现（`if (adapter.control?.steer)`），不查布尔表；
- **start-time 前置校验**用 provider 的静态 descriptor（transport 类型、是否需要外部二进制），service 在启动 run 之前检查，缺失即 typed error **大声拒绝**，禁止「接受后忽略」；
- 需要向 UI 暴露能力矩阵时，**从方法存在性派生**一个只读视图，不新增可写字段。

理由与先例见 ADR-22 §2.3 与 §6.1。

兼容规则：

- 现有 `execute` 继续是 `control` 不可用时的单 turn fallback；
- `jsonl` 只实现真实支持的 `resume`，不暴露 transport-level control method；这不改变上层 `delivery: steer | queue` 消息意图，安全边界由 Service/inbox 处理；
- Codex SDK 先实现 start/resume/turn；
- Codex app-server transport 再实现 thread/turn 控制；
- ACP 适配器实现 session load/prompt/cancel 时按方法存在性映射，不能把 ACP session close 推断为 thread archive；
- 不支持的输入选项必须在启动 transport **之前**显式拒绝，不能静默丢弃；
- `detect`、超时、raw stdout、resume hint、permission callback 和 result parser 仍由现有 adapter seam 负责。

### 5.4 Codex 适配策略

#### Slice A：SDK/JSONL 兼容闭环

- 复用现有 `@openai/codex-sdk` `startThread/resumeThread/run`；
- 将 external thread ID 绑定到 participant，而不是只绑定父 Session；
- 审查 prompt 要求返回严格 review envelope；
- `approvalPolicy: "never"` 保持为无人值守默认，Codex review 只读执行；
- 不能宣称 SDK 具备 `fork/archive/steer`，能力矩阵必须反映实际支持。

#### Slice B：app-server 控制面

- 使用本机 Codex CLI 的 app-server 协议作为可选 transport；
- 通过 `codex app-server generate-ts --out <generated-dir> --experimental` 获取当前版本协议绑定，再封装为 core 内部最小 seam；
- 不把生成的整套协议类型泄漏到 Session/Delegation 领域；
- 实现 thread start/resume/fork/archive/delete、turn start/steer/interrupt、status notifications；
- 建立版本探测和 capability negotiation，未知方法或版本不匹配时降级到 SDK/JSONL；
- app-server 连接生命周期归 `DelegationExecution`/adapter scope 管理，不归 UI 或 handler 管理。

#### Slice C：Claude Code 对齐

- 复用现有 Claude SDK `persistSession: true` 和 `resume`；
- 通过同一 participant/turn/delivery 模型与 Codex 对齐；
- `canUseTool` 继续桥接 PermissionV2；
- Claude 特有能力必须通过 capability 声明，不复制 Codex app-server 语义。

### 5.5 Review Envelope

Review participant 必须输出下列 Schema 可解析的 envelope；自然语言说明作为 `summary`，不能替代字段：

```json
{
  "kind": "aigcfroge.review.v1",
  "verdict": "approved | changes_requested | rejected",
  "reviewed_revision_digest": "rev_...",
  "findings": [{ "severity": "blocking | major | minor | note", "summary": "..." }],
  "summary": "..."
}
```

JSONL/SDK 无结构化输出能力时，adapter 从受控 fenced block 或稳定 marker 提取；解析失败、digest 缺失、verdict 未知都落 `changes_requested`，并记录 `invalid_review_envelope`。

### 5.6 Revision Snapshot 与 Evidence Digest

第一版不新增独立 diff 引擎，但 **revision 的输入必须只来自代码状态，不含任何事件计数器**。

**Revision snapshot**（在 implementer 投递完成时固化，之后不再重算）：

- 输入是**工作树/提交事实**：`Git.Service.head` 的 commit SHA + `Git.Service.patch` 的规范化 diff；
- 对上述内容做稳定 SHA-256，连同 commit SHA 一起存进投递记录；
- **禁止把 `latest durable event sequence` 放进输入。** 事件序号会被与代码无关的事件推进——包括 reviewer 自己的 review 完成事件——于是 Codex 刚提交的审查会立刻因序号前进而失效，barrier 永远无法满足（活锁）。Gerrit 计算 change kind 只看树和 diff，不看任何事件计数器，这是独立佐证；
- 因为是**固化快照而非按需重算**，barrier 比较的两侧都是稳定值。

**Change kind 判定**（供 §4.4 的 `copyable` 使用）：

| 判定              | 依据                                                                                |
| ----------------- | ----------------------------------------------------------------------------------- |
| `no_change`       | commit SHA 与规范化 diff 均相同                                                     |
| `no_code_change`  | 规范化 diff 相同，仅提交信息/描述不同                                               |
| `formatting_only` | 仅在可靠 formatter service 证明格式化等价时成立；本期无此 service 时降级为 `rework` |
| `rework`          | 兜底                                                                                |

**Evidence digest**：对规范化的证据文本、来源 turn ID 和相关 revision 做 digest。

其余约束：

- 原始 prompt/文件全文不写日志；必要内容只在 Session/turn 持久历史中保存；
- digest 或 change kind 计算失败**不得自动批准，也不得自动作废**：投递进入 `failed` 或 `recovery_required`，由人工决定；
- `formatting_only` 需要能在没有 formatter 的仓库里降级——降级方向是 `rework`（保守作废），不是 `no_change`。

---

## 6. 分阶段实施路线

每阶段必须完成：红测试 → 最小绿实现 → 重构 → 受影响包 typecheck/test/lint → 文档与生成物同步 → 差分审查。禁止跨阶段提前接入 UI 或删除旧路径。

### Gate ↔ Phase 对应表

ADR-22 §5 的 Acceptance Gate 是约束集合，不是另一套计划。下表为唯一映射：`来源` 指 ADR/PRD 条款，`Phase` 指首次产生 RED 与最终满足该 Gate 的阶段，`证据` 指必须在复查卡片中留下的可审计事实。改动任一侧时必须同步此表与对应 Phase card；没有映射的 Gate 不得声称已覆盖。

| Gate ID | Gate / 不可妥协条件                                                                                                                                   | 来源                               | Phase                | 证据                                                                 |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------- | -------------------------------------------------------------------- |
| G1      | Schema、状态机、branded ID、EventV2 payload、HTTP/SDK contract 有红测试；aggregate 固定为 `delegationID` 且 payload 有 `delegationID`                 | ADR §2.1/§2.4/§5；PRD §2           | 1、6                 | focused test 文件/用例名/计数；生成 SDK namespace 运行时断言         |
| G2      | Build + Codex 至少两轮 append/review/repair 集成闭环                                                                                                  | ADR §5；PRD §4.1                   | 4                    | 两轮 Turn、revision digest、review receipt、barrier 结果             |
| G3      | `copyable(changeKind, verdict)` 完整：approved/changes_requested/rejected 四种 verdict 及四种 change kind 有明确默认值；本期 formatting_only 保守降级 | ADR §2.5；PRD §4.1                 | 1、4                 | 纯函数 truth table + 端到端 revision 测试                            |
| G4      | `rejected` 是 Delegation 级 sticky blocker，跨 revision 不被洗掉；有显式 retract/override 出口                                                        | ADR §2.5；PRD §4.1                 | 1、4、6              | 正负测试、审计事件、HTTP/tool command                                |
| G5      | roster phase 与 runtime status 分离；迟到 heartbeat 不覆盖失败终态                                                                                    | ADR §2.3；PRD §4.1                 | 1、2                 | state fold regression                                                |
| G6      | barrier 按 role 计算、无 reviewer 不死锁、同一 parent 下并存 Delegation 隔离；缺 delegation_id 解析最近活跃而非新建                                   | ADR §2.1/§2.7.1；PRD §5            | 1、2                 | pure barrier、tool routing、双委派隔离测试                           |
| G7      | `steer` 默认追加与显式 `queue` 语义一致；不引入第二套投递词汇，也不根据 transport capability 在二者之间猜测                                           | ADR §2.6/Rejected 10；AGENTS.md    | 2、4、5              | active/cold/idle 三路径和词汇一致性检查                              |
| G8      | cold-resume-then-steer、interrupt 五条语义、close 顺序、子先于父、flush 不可证明后的恢复路径均有测试                                                  | ADR §2.6–§2.8；PRD §4.1            | 4、5、7              | readiness signal、recovery_required、close-order 证据                |
| G9      | participant 失败、取消、超时、连接丢失、重启恢复不静默重跑未知副作用                                                                                  | ADR §2.8；PRD §4.1                 | 3、5、7              | attempt/receipt/reconciliation 测试                                  |
| G10     | Review 与 PermissionV2 分离；Codex SDK/JSONL 第一阶段只读；不要求不存在的 Codex SDK callback bridge                                                   | ADR §2.5/§2.10；ARCHITECTURE §4.11 | 3、5                 | approvalPolicy/read-only contract；ACP/Claude SDK transport 差异测试 |
| G11     | complete/close/archive/purge 生命周期分离；complete 后默认 archive；soft_expired 是派生列表态且不关闭外部 thread                                      | ADR §2.7；PRD §7                   | 5、6、7              | service/API/UI lifecycle tests                                       |
| G12     | `retry`、`reconcile`、`retract-rejection` 的 HTTP、tool、SDK contract 完整；不存在 `listDeliveries(turnID)` 或 deliveryID API                         | PRD §6.4；本文 §5                  | 1、6                 | OpenAPI identifiers、SDK exports、negative route tests               |
| G13     | migration、schema snapshot、legacy mapping、API/SDK、README/ARCHITECTURE/CONTEXT/PRD/roadmap 文档同步                                                 | ADR §5；PRD §8                     | 0、1、6、7           | generated diff、backfill replay、文档一致性脚本                      |
| G14     | 受影响包 typecheck/test/lint 通过，HTTP exerciser 真实执行并记录 coverage/auth/effect 结果                                                            | ADR §5；docs/testing.md            | 每个 Phase，最终 6/7 | 命令、exit code、测试计数/用例名、报告文件                           |
| G15     | UI 本期仅承诺功能、错误态、键盘焦点和一个窄视口证据；完整 dark/i18n/全量窄视口矩阵列为后续基础设施任务                                                | PRD §8；docs/testing.md            | 6                    | functional E2E + 明确的 deferred follow-up                           |
| G16     | flag off 与旧 task/CLI resume/MetaAgentStep/AgentTaskHub baseline 一致；观察期后再决定退役兼容路径                                                    | PRD §4.1；ADR §5                   | 7                    | flag-off regression、telemetry、回滚演练                             |

**ADR-22 何时能从 Proposed 转 Accepted**：Gate 是累积的，G12–G16 需要 Phase 6/7 的 API、UI、迁移、灰度和文档证据，所以 ADR 状态在 Phase 7 观察期通过后才翻牌。这不是一件可以提前单独完成的任务。

### Phase 0：基线、契约和文档门禁（0.5–1 天）

**目标**：锁定现状，避免旧计划中的“已完成”继续覆盖真实缺口。

**动作**：

1. **在 `persistent-delegation` 分支上工作，且不与主工作区争用。** 主工作区长期存在其他分支的未提交改动（历史上曾同时有 30+ 条脏路径且有并发写入者），因此不要靠"切分支时不覆盖未提交修改"这一假设——`git switch` 无法在有并发写入者时保证安全。使用独立工作区：`git worktree add .worktrees/persistent-delegation persistent-delegation`（`.worktrees` 已在 `.gitignore` 中）。这样主工作区完全不受影响；
2. 记录当前 V2 `task_id`、CLI resume、TaskDriver interrupt/cancel 的定向测试结果；
3. 将 ADR-22 标记为 Proposed；
4. 生成本机 Codex app-server schema 快照，仅作 adapter contract 输入；
5. 新增架构/协议测试的测试清单，不先改生产代码；
6. 运行 `scripts/check-delegation-docs.sh`：验证当前 PRD/ADR/计划的规范层级、状态词、steer/queue、copy policy、retry/reconcile API、Gate↔Phase 映射和历史引用；旧计划只保留 HISTORICAL/SUPERSEDED 头，不再以 READY 作为实施入口。

**Exit**：

- baseline tests、typecheck、git diff 结果可复现；
- 文档没有把“基础 resume”写成“完整持久委派闭环”；
- 所有后续文件清单与 owner 已明确；
- 文档一致性脚本真实检查了 PRD、ADR-22、当前计划、testing.md、technical-debt.md 与历史计划，而不是只检查路径存在。

### Phase 1：Schema、迁移和纯状态机（1.5–2 天）

**写入范围**：`packages/schema`、`packages/core/src/delegation`、数据库 migration。

**TDD 红**（对齐 ADR-22 §5 Acceptance Gate；本清单已按 2026-08-31 修订重写，勿照旧稿）：

Schema 与 ID：

- ID/Schema 解码、未知状态拒绝；
- `Delegation.ID` 是独立 branded ID，与 `SessionSchema.ID` 互不可赋值；
- Event payload 不含 raw secrets/full prompt。

状态机：

- Delegation/Participant/Turn 的合法与非法转换（**没有 Delivery 状态机**——投递不是独立对象）；
- `approved → waiting_review` 可达（新 revision 令旧批准 outdated 时的回路）；
- `draft → cancelled`、`cancelled → archived` 可达；
- `deleted` **不是**状态：purge 是命令不是转换，尝试转换到它必须是 typed error；
- **roster phase 单调只前进**，`provisioning → active | failed` 各恰好一次；
- **runtime status 不入库、不覆盖 phase**：一条迟到的 `running` 不能把 `failed` 冲掉（回归测试）。

Review barrier（§4.4）：

- barrier **按 role 计算**，不认 participant 名字；
- **reviewers 为空的委派不被永久卡住**（覆盖 §5.2 兼容路径造出的单 implementer 委派）；
- change kind 四档判定：`no_change` / `no_code_change` / `formatting_only` / `rework`；
- **两侧都要测**：`rework` 不复制批准；本期 `formatting_only` 必须保守降级为 `rework` 且不复制批准；可靠 formatter service 的正向复制测试延期到单独任务；
- `rejected` 跨 revision 持续阻塞，必须显式撤销才解除；
- **barrier 是纯函数**：入参为折叠状态，不接收数据库句柄，可在纯单测中调用；
- 同一父 Session 下两个并存委派的 barrier 互不干扰。

Turn 与投递不变量：

- `turn.seq` 在同一 Delegation 内单调递增；
- 去重键由被投递物自身携带（`turnID` / `deliveryOrigin` / `senderParticipantID`），在 inbox 与历史上 fold 后判重，**不使用独立 idempotency 表**；
- 恢复邮箱 = 已入队 − 已确认落库；
- **重试只对未结算投递开放**；已结算投递只能通过新 Turn 重做；
- `recovery_required` 只能经 reconciliation 进入 running；
- close / archive / purge 三者语义分离。

Revision snapshot（§5.6）：

- digest 输入**只有** commit SHA + 规范化 diff；**断言输入中不含任何事件序号**（防活锁回归）；
- 在 implementer 投递完成时固化，之后不重算；
- digest 或 change kind 计算失败既不自动批准也不自动作废。

**绿实现**：

- `packages/schema/src/delegation.ts`、`packages/schema/src/delegation-id.ts`、participant/turn schema + 投递事件载荷 schema（投递不建表）；
- `packages/core/src/delegation/{schema,state,review,event,sql,service}.ts`；
- migration 新增**三张**投影表（delegation / participant / turn）、indexes、foreign keys；**不建 `delegation_delivery`**；
- `migration.gen.ts`、`schema.gen.ts`、`schema.json` 同步。

**Exit**：

- `MetaAgentService` 仍可工作；
- 旧 task/CLI 表不改语义；
- core 层 service 测试通过（`it.effect` / `it.live`，见 §10.2 的 helper 分包表）；
- schema/migration clean DB 和 existing DB fixture 均通过；
- barrier 有纯单元测试（无实例级装配），入参是折叠状态而非数据库句柄；
- Service 接口里**不存在**按投递分页的方法（§5.1）。

### Phase 2：内部 Build participant（2–3 天）

**写入范围**：`packages/core/src/tool/task.ts`、`task-driver.ts`、`session/task-driver-fill.ts`、V1 compatibility adapter、测试。

**TDD 红**：

1. 创建 Delegation + Build participant + child Session；
2. 同一 delegation append Turn 2，复用同一 child Session；
3. child Session 不得跨父 delegation/session 被 task_id 劫持；
4. running background turn 的 append 映射为 extend/queue；
5. 已结束 background job 的 append 创建新 turn，但仍复用同一 child Session；
6. Build 投递 success/failure/cancel/retry 都写投递事件并回写兼容 `session_task`；
7. child Session 递归 task deny 保持；
8. parent interrupt 会停止活动投递，但不会自动 archive Delegation；
9. **缺 `delegation_id` 时解析到该父 Session 最近活跃的委派，而不是新建**（§5.2.1）；无活跃委派时才创建；
10. 同一父 Session 下两个并存委派：追加证据落在解析出的那一个，不串台；
11. tool output 回写解析到的 `delegationID`，且**不含 `deliveryID`**（投递无独立 id）；
12. `meta_agent_step` 的内部委派行会被结算（不再永久停留 `running`）。

**绿实现**：

- TaskDriver 接收 delegation/participant/turn context；
- `createChild` 只由 `DelegationService` 绑定 participant；
- `task_id` 变成兼容解析，不再是业务唯一真源；
- 复用现有 BackgroundJob、SessionInput、SessionExecution；
- `meta_agent_step` 由 canonical delivery 写兼容投影，补齐内部 completion/failure；
- 保持 V1 `SessionPrompt` 能力，但新 V2 默认走 core owner。

**Exit**：

- 两轮 Build prompt 在同一 child Session 中可恢复；
- 失败/取消/重试不产生悬挂 in_progress delivery；
- 没有重复 child Session；
- task card 仍显示已有 Session link。

### Phase 3：Codex participant 与外部 CLI 绑定（2–3 天）

**写入范围**：`CliAdapter`、Codex SDK/JSONL、`TaskDriverFill`、`external_cli_session` compatibility、tests。

**TDD 红**：

- 首次 Codex 运行保存 thread ID；
- 同一 Delegation participant 第二次 turn 调用 resume；
- 同一父 Session 下两个 Codex participant 不互相抢 external thread；
- external ID 缺失时不能伪装 resume 成功；
- SDK、JSONL、ACP transport 按**方法存在性**分别测试（不查 capabilities 布尔表，§5.3）；
- provider 缺少 start-time 能力时**大声拒绝**（typed error），不得接受后忽略；
- CLI unavailable、timeout、malformed output、resume failure 均留下可解释的投递事件；
- **失败/超时路径必须保留 external thread id**：当前 codex-sdk 的 `Effect.catch` 分支不带 `sessionId`，这条红测试钉住修复，否则 §8.4 的外部 reconciliation 在最需要它的场景下不可能成立；
- Codex review envelope 缺失/错误/digest 过期 → `changes_requested`；
- Codex review verdict 不改变 PermissionV2 结果；
- Codex SDK 不接收 `canUseTool`；第一期红测试钉住只读 contract（`approvalPolicy: "never"`），并证明 review verdict 不会变成 PermissionV2 grant；可写 Codex 留给 app-server/ACP control。

**绿实现**：

- `external_cli_session` 增加 participant/Delegation 关联：该表**无主键**、唯一索引是 `(session_id, external_session_id)`，物理上已能容纳多线程，所以**只需加一个 nullable `participant_id` 列并改读写逻辑**，不需要新建 binding 表（§2.2.1）；顺带补上缺失的主键；
- `TaskDriverFill.executeCLI` 先解析 participant，再传 `resumeId`；
- `DelegationResult` 增加结构化 review/handle 元数据，但保留旧 summary；
- Codex SDK adapter 保持 `startThread/resumeThread/run`，并在失败分支补齐 `sessionId`；
- Codex SDK 保持只读 reviewer，不新增不存在的 PermissionV2 callback bridge；app-server/ACP control 在 Phase 5 按真实协议接入；
- JSONL adapter 保持 `thread.started`/resume hint fallback；
- ACP 只实现真实支持的 session load/prompt/cancel。

**Exit**：

- Codex 两轮 review 在同一外部 thread 中完成；
- participant 句柄与 parent/delegation 归属可验证；
- 旧 CLI resume contract tests 全绿；
- 真实 CLI 存在时补 `it.live`，不存在时明确 skip 并记录 blocker。

### Phase 4：双参与者 fan-out、证据追加与 review barrier（3–4 天）

**写入范围**：`DelegationExecution`、append command、review service、EventV2、TaskDriver、adapter control。

**TDD 红**：

1. Start D1：Build implementer + Codex reviewer；
2. Turn 1 同时产生两条投递事件；
3. Build 完成 R1，Codex 审查 R1；
4. Meta append E2，产生同一 Turn 2 的两条投递；
5. Build 产出 R2；Codex 审查 R2；
6. Codex 只审查 R1（`rework` 判定）时，不能让 D1 completed；
7. **Build 只做了 `formatting_only` 改动时，本期按 `rework` 保守处理**：Codex 对 R1 的批准不能被错误复制，必须重新审查；可靠 formatter service 的正向豁免另行立项；
8. 一条投递失败时，另一条仍可完成；
9. 重试只增加 attempt，不重复 durable turn；且**只对未结算投递开放**；
10. 默认 `delivery: steer` 在安全 provider-turn 边界 promote；显式 `delivery: queue` 在 Session 将要 idle 时才 promote；二者都是消息意图，不根据 transport capability 猜测（§2.6）；
11. **目标无 Activation（进程已退出）时**：cold resume 重建 Activation；`steer` 在安全边界 promote，`queue` 等到 Session 将要 idle 时 promote，不把两种意图混为一谈；
12. 投递完成顺序任意时，Delegation 状态仍按 barrier 正确收敛；
13. 折叠状态在增量推进与冷启动全量折叠两条路径上结果一致（EventV2 重放一致性）。

**绿实现**：

- `appendTurn` durable first；
- `DelegationExecution` 以 per-delegation coordinator 管理 process-local fiber，使用 `Deferred/BackgroundJob/EventV2` 就绪信号；
- participant queue 与 turn delivery 分离；
- `RevisionSnapshot` 复用 Git/SessionSummary；
- review barrier 由 core pure function + service 持久化状态共同保证；
- Meta-Agent prompt 增加“追加证据必须引用 delegation/participant/turn/revision ID”的协议；
- protocol card 增加 implementer/reviewer 输出格式，但不把软约束当硬状态。

**Exit**：

- 主场景两轮以上完整通过；
- EventV2 重放后状态与 projection 一致；
- fan-out partial failure 可恢复；
- 旧 `task` 单次调用行为没有改变。

### Phase 5：Codex app-server 控制面与关闭语义（2–4 天）

**写入范围**：Codex app-server adapter、adapter capability、close/archive/fork、recovery。

**TDD 红**：

- thread/start/resume/fork/archive/delete 的 request/response contract；
- turn/start/steer/interrupt 与 expected turn ID precondition；
- 不得存在“active turn 不可 steer 就转 queue”的隐式转换；`steer` 与 `queue` 是调用方明确选择的不同意图，运行时只按安全边界执行；
- interrupt 后 turn 进入 cancelled/interrupted，不伪装 completed；

`interrupt` 的五条语义各有一条测试（ADR-22 §2.7）：

- **保留 inbox**：中断后目标的待处理队列仍在；目标重新达到安全边界或 idle 时，按 `steer`/`queue` 原有意图恢复推进；
- **不等静止**：`interrupt` 返回时目标可能仍在收尾，调用方不得假设已静止；
- **已领取批次不重排**：被当前 turn 领取的输入不退回队列；
- **缺失目标是幂等 no-op**：目标未知 / 一次性 run / 已结算，均返回成功而非报错（保证重试安全）；
- **授权先于查找**：陈旧祖先句柄与自指请求在 lookup 之前就返回 `UNAUTHORIZED`。

close 与归档：

- close **关闭准入**（阻止新 turn），顺序为「关准入 → 逐个处置 → 子先于父」；
- 持久 child Session 在进程内拆除后仍存活；
- archive 保留历史；delete 需要显式 purge 权限；
- app-server 不可用时降级 SDK/JSONL，且 UI 显示能力缺失（由方法存在性派生的只读视图，不是布尔表）；
- app-server 连接断开时进入 recovery_required，不自动重复未知 turn；
- flush 失败时不让 Activation 失败，但下一次 resume 必须能处理缺失/陈旧的 child 状态（§2.8 的诚实路径要有测试，不能只写在文档里）。

**绿实现**：

- `codex-app-server` adapter 使用生成协议的最小封装；
- `DelegationExecution` 管理 app-server connection scope；
- `close` 先 interrupt active turn，再等待终态；
- external thread archive/delete 只在 adapter capability 存在时执行；
- JSONL/SDK fallback 的 close 只关闭 AigcForge participant binding/adapter process，明确记录外部 thread 仍可被 CLI 自身恢复；
- Codex 版本与方法 capability negotiation；
- `recovery_required` reconciliation command。

**Exit**：

- 本机 Codex app-server 可用时，完整 control contract 通过；
- 本机只安装 CLI/SDK 时，降级路径仍可续接；
- close/archive/delete 三者 UI/API 语义明确；
- 无静默重跑未知副作用。

### Phase 6：HTTP API、SDK、UI 与实时事件（3–5 天）

**写入范围**：`packages/server/src/{groups,handlers}`、`packages/aigcfroge/src/server/routes/instance/httpapi`、`packages/sdk/js`、`packages/app`、`packages/session-ui`、必要的 TUI 投影。

**API 建议**（根路径避免 workspace-routing 把 literal 当 Session ID）：

```text
GET    /delegation
POST   /delegation
GET    /delegation/:delegationID
POST   /delegation/:delegationID/participant
GET    /delegation/:delegationID/turn
POST   /delegation/:delegationID/turn
POST   /delegation/:delegationID/turn/:turnID/retry
POST   /delegation/:delegationID/reconcile
POST   /delegation/:delegationID/review/retract-rejection
POST   /delegation/:delegationID/steer
POST   /delegation/:delegationID/interrupt
POST   /delegation/:delegationID/complete
POST   /delegation/:delegationID/close
POST   /delegation/:delegationID/archive
POST   /delegation/:delegationID/unarchive
POST   /delegation/:delegationID/fork
DELETE /delegation/:delegationID   # explicit purge only
```

端点 payload 不能依赖 `deliveryID`：

```text
POST /delegation/:delegationID/turn/:turnID/retry
  { participantID }
POST /delegation/:delegationID/reconcile
  { participantID?, turnID?, decision: "resume" | "retry" | "fork" | "close" }
POST /delegation/:delegationID/review/retract-rejection
  { participantID?, reason }
```

`retry` 只允许未结算投递；`reconcile` 是人工选择的恢复动作；`retract-rejection` 必须校验 reviewer/人工 override 权限并产生审计事件。

**TDD 红**：

- auth/Location/parent Session 归属；
- append/retry/reconcile/retract-rejection/close/archive/delete 的 schema 和状态错误；
- generated SDK 与 OpenAPI 一致；
- **每个端点的 `identifier` 存在且生成的 SDK 命名空间可实际调用**——断言 `client.delegation.<method>` 不是 undefined，而不是只断言生成成功；
- **API 中不存在按投递分页的端点**（与 §5.1 对齐，防止形状从 HTTP 层反向固化）；
- EventV2/SSE 增量更新；
- AgentTaskHub 显示 delegation、participant、turn、review 状态；
- **同一父 Session 下多个委派在列表中各自独立呈现**，不合并也不串台；
- Build/Codex 卡片可跳转各自对话；
- 归宿策略：`complete` 后自动 `archive`；闲置委派进入过期态且**在列表默认视图中与"正在进行"区分**；过期**不**关闭外部线程；
- loading/error/recovery_required/archived/过期态 各有呈现；
- 功能性、错误态、长文本、键盘焦点，以及一个窄视口行为证据；完整 dark theme、三语和全量窄视口矩阵不作为本期已成立的硬门禁，另立 UI 基础设施任务。

**绿实现**：

- handler 只解码/授权/调用 service；
- **每个端点必须带 `OpenApi.annotations` 的 `identifier`**（如 `delegation.list`、`delegation.appendTurn`）。缺 identifier 会被 hey-api 平铺到父类，`client.delegation.<method>` 变成 undefined，**且没有任何门禁会报错**——必须逐个端点核对；
- `DelegationPanel` 复用 AgentTaskHub 的布局和 task card，不复制 Session 页面；
- UI 以事件/SDK 数据为真源，不根据 summary 正则推演状态；
- 生成 JS SDK 使用 `./packages/sdk/js/script/build.ts`；
- TUI 只消费 projection，不在 TUI 维护第二套委派状态。

**委派归宿策略（本 Phase 必须定完，不得留到灰度期）**：

用户提出需求后离开是常态，委派又是长命的（ADR-22 §2.1），所以必须回答"没人来收尾时委派去哪"：

- `complete` 之后**默认自动 `archive`**，不要求用户手动归档；
- 从未收尾的委派达到闲置阈值后进入一个**可解释的过期态**，在列表页与"正在进行"区分开——不是静默删除，也不是伪装完成；
- 过期只解除 AigcForge 侧的活跃绑定，**不关闭外部线程**（外部 CLI 的 thread 可能仍可由 CLI 自身恢复）；
- 阈值取值、过期态命名、列表页默认过滤规则在本 Phase 定并落测试。

**Exit**：

- HTTP coverage/auth/effect exercise 全绿；
- 每个新端点的 `identifier` 已核对，生成的 SDK 命名空间可实际调用（不是只看生成成功）；
- App 单测 + Playwright 关键路径全绿；
- SDK 生成物无 drift；
- 归宿策略已实现并有测试：自动 archive、闲置过期、列表页不被僵尸委派污染；
- `GET /delegation` 列表在 50 个委派规模下测过 p95 延迟，结果记入技术债那条的判定依据；
- 真实场景可从 Meta 委派中心打开 Build/Codex 对话并追加证据、关闭、归档。

### Phase 7：恢复、灰度、兼容迁移与旧路径退役（2–4 天 + 观察期）

**写入范围**：recovery、migration backfill、flags、docs/technical-debt、旧 shim。

**动作**：

1. 启动恢复扫描 `dispatching/running` delivery；
2. 为可安全 resume 的 provider/CLI 建立 reconciliation；
3. 不确定副作用统一进入 `recovery_required`；
4. 旧 `task_id` 继续读 participant mapping；
5. 旧 `external_cli_session` backfill 到 participant binding；
6. `meta_agent_step` 改为 canonical projection，观察期后才考虑删除；
7. feature flags：
   - `AIGCFROGE_EXPERIMENTAL_PERSISTENT_DELEGATIONS`：默认 false；
   - `AIGCFROGE_EXPERIMENTAL_DELEGATION_RECOVERY`：默认 false；
   - `AIGCFROGE_DISABLE_META_AGENT`：继续保留，语义不变；
8. 灰度启用：内部 coding 模式 → CLI review → 其他 Product Mode；
9. 观察至少一轮真实重启、取消、网络断连和 malformed review；
10. 通过迁移矩阵后才删除未使用的 V1 orchestration 代码。

**Exit**：

- flag off 行为与 baseline 一致；
- flag on 主场景与失败场景全绿；
- no dangling participant/delivery、no orphan child Session；
- 文档状态与代码、测试、生成物一致；
- ADR-22 可从 Proposed 更新为 Accepted。

---

## 7. 详细文件变更矩阵

### 7.1 新增

| 文件/目录                                                                      | 责任                                                          |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `packages/schema/src/delegation.ts`                                            | Delegation/Participant/Turn Schema + 投递事件载荷 Schema      |
| `packages/schema/src/delegation-id.ts`                                         | branded IDs（含 `Delegation.ID`；无 `DelegationDelivery.ID`） |
| `packages/core/src/delegation/`                                                | service/state/review/event/recovery/execution/sql             |
| `packages/core/src/database/migration/<timestamp>_delegation.ts`               | **三张**投影表 migration（无 `delegation_delivery`）          |
| `packages/core/test/delegation-*.test.ts`                                      | domain/service/integration/recovery tests                     |
| `packages/aigcfroge/test/delegation-*.test.ts`                                 | task/tool/composition tests                                   |
| `packages/server/src/groups/delegation.ts`                                     | canonical V2 HTTP contract（`/api/delegation`）               |
| `packages/server/src/handlers/delegation.ts`                                   | canonical thin handlers                                       |
| `packages/aigcfroge/src/server/routes/instance/httpapi/groups/delegation.ts`   | legacy instance HTTP contract                                 |
| `packages/aigcfroge/src/server/routes/instance/httpapi/handlers/delegation.ts` | legacy thin handlers                                          |
| `packages/app/src/pages/session/timeline/delegation-panel.tsx`                 | session delegation UI                                         |
| `packages/app/src/pages/session/timeline/delegation-panel-model.ts`            | pure UI model                                                 |
| `packages/session-ui/src/components/delegation-tool-card-model.ts`             | shared card projection                                        |
| `packages/core/src/tool/codex-app-server.ts`                                   | optional Codex app-server adapter                             |
| `scripts/check-delegation-docs.sh`                                             | PRD/ADR/plan/testing/technical-debt consistency gate          |

### 7.2 修改

| 文件                                                                  | 责任                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------- |
| `packages/core/src/tool/task.ts`                                      | delegation/participant/turn compatibility fields and commands |
| `packages/core/src/tool/task-driver.ts`                               | canonical delegation execution seam                           |
| `packages/core/src/session/task-driver-fill.ts`                       | internal/CLI dispatch binding and recovery                    |
| `packages/core/src/tool/cli-adapter.ts`                               | capabilities/control extensions, no second registry           |
| `packages/core/src/tool/codex-sdk.ts`                                 | participant handle and structured result mapping              |
| `packages/core/src/tool/codex.ts`                                     | JSONL fallback result/resume mapping                          |
| `packages/core/src/tool/acp.ts`                                       | capability-safe lifecycle bridge                              |
| `packages/core/src/meta-agent/service.ts`                             | compatibility projection or delegation lookup only            |
| `packages/core/src/location-layer.ts`                                 | explicit DelegationService/Execution Layer provision          |
| `packages/aigcfroge/src/agent/meta-agent.ts` / `core/plugin/agent.ts` | append/review/close protocol text                             |
| `packages/aigcfroge/src/tool/delegation-protocol.ts`                  | delegation IDs, turn IDs, revision/evidence constraints       |
| `packages/aigcfroge/src/agent/*/protocol.md`                          | implementer/reviewer participant contracts                    |
| `packages/aigcfroge/src/server/routes/instance/httpapi/api.ts`        | API group registration                                        |
| `packages/sdk/js/script/build.ts` output                              | generated SDK                                                 |
| `packages/app/src/pages/session/timeline/agent-task-hub*`             | projection integration                                        |
| `ARCHITECTURE.md`, `CONTEXT.md`, `specs/v2/todo.md`                   | architecture/status synchronization                           |
| `docs/technical-debt.md`                                              | record/close compatibility debt                               |

### 7.3 Explicitly do not change in first implementation slice

- `packages/llm` provider protocol shapes；除非 review envelope 需要新增通用结构化输出能力，先在 adapter/domain 层完成；
- `ApplicationTools`/`ToolRegistry` 的双层 scope 语义；
- Product Mode 的分类定义；只复用既有 policy gate；
- legacy task/todo files 的物理删除；
- Codex CLI 的用户全局配置；AigcForge 只做 adapter capability negotiation。

---

## 8. 权限、安全、并发与恢复

### 8.1 权限

- 创建/追加/关闭委派按 parent Session、Agent、Product Mode、PermissionTier 检查；
- Build 的代码写权限由 Build participant 自身 permission 决定；
- Codex reviewer 默认只读——实现依据是 `approvalPolicy: "never"`，**不是** PermissionV2 桥；
- review approved 不能创建或扩大 grant；
- `delete`/purge 必须显式权限，默认 deny；
- `externalThreadID` 只能由同一 Delegation/Participant 读取，禁止跨项目泄漏；
- 授权检查在**查找目标之前**执行：父子地址不匹配、调用方不在目标活跃祖先链上、陈旧祖先句柄、自指请求，都在 lookup 前返回 typed `UNAUTHORIZED`。

#### 8.1.1 PermissionV2 桥的真实覆盖面（勿假设统一）

初稿写「外部 CLI 的工具调用仍通过父 Session 的 PermissionV2 bridge」。代码核实（2026-08-31）该表述**对 Codex 和 jsonl 不成立**：

| transport                          | PermissionV2 缺失时                                               | PermissionV2 存在时                                                                   |
| ---------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| ACP（claude-code-acp / codex-acp） | deny                                                              | 正常桥接                                                                              |
| claude-code SDK                    | **不 deny**，传 `undefined` 后退回 Agent SDK 自身 permission mode | 正常桥接                                                                              |
| **codex SDK**                      | 无条件 deny                                                       | **桥不存在**：`execute` 不解构 `canUseTool`，`approvalPolicy: "never"` 无条件自动拒绝 |
| jsonl                              | 无桥                                                              | 无桥                                                                                  |

处理结论：

- Codex reviewer 的只读性成立（`approvalPolicy: "never"`），本期只把它作为 read-only adapter contract；
- Codex SDK 的 `execute` 没有 `canUseTool` callback，**Phase 1–4 不新增伪造的 PermissionV2 bridge**；可写 Codex participant 必须等待 app-server/ACP control 或另行的 SDK 能力；
- JSONL 同样不宣称拥有 PermissionV2 bridge；Claude SDK/ACP 按现有 transport contract 分别测试；
- `ARCHITECTURE.md §4.11` 已于 **2026-09-03** 按 transport 修正，本计划不再把“同批次修正架构”列为动作或 gate；
- H10 的真实改造点是保留父 task invocation 的 canonical source `{ type: "tool", messageID, callID }` 传入具备 callback 的 adapter；这不等于给 Codex SDK 添加不存在的 callback。

### 8.2 Prompt 与日志

- 不把完整父历史塞进每个 participant；继续复用 Structured Handoffs 摘要；
- evidence/revision 使用 digest + 必要的 durable turn 内容；
- 日志不输出 Authorization、token、完整 prompt、完整文件正文；
- review findings 做长度和字符边界限制；
- malformed external output 作为 typed failure，不直接注入为可执行指令。

### 8.3 并发

- 同一 Delegation 的 command 由一个 process-local coordinator 串行化；
- 不同 Delegation 可以并发；
- 不同 participant 可以 fan-out；
- 同一 participant 的 turn 只能按 queue/steer 规则推进；
- 不用 in-memory Map 作为重启后的唯一状态；
- 使用 EventV2 sequence、DB CAS/idempotency key 和 readiness signal 处理竞争。

### 8.4 恢复

```text
startup
  → scan delegation delivery
  → dispatching/running → recovery_required
  → adapter/session reconciliation
  → safe resume OR human-visible failed
  → recompute Delegation state
```

恢复必须区分：

- **安全续接**：外部 thread 已知、上一轮 terminal receipt 已确认、adapter 支持 resume；
- **不确定工作**：provider/tool side effect 可能已经发生但没有 settlement；进入 recovery_required；
- **不可恢复**：thread 被外部删除、child Session 不存在、digest 无法验证；进入 failed 并允许人工 fork/重新执行。

---

## 9. 观测与故障排查

至少记录结构化指标：

- `delegation.created/completed/failed/recovery_required` 数量；
- participant target/kind/status；
- turn/delivery latency；
- fan-out partial failure；
- review stale digest 数量；
- adapter capability/fallback；
- resume 成功/失败；
- close/archive 延迟；
- recovery reconciliation 结果。

禁止记录：完整 prompt、完整审查输出、Authorization、环境变量值、用户文件全文。

故障排查顺序：

1. `delegationID` 是否存在且 parent/location 正确；
2. participant handle 是否唯一、是否属于该 delegation；
3. turn/delivery 是否 durable admitted；
4. EventV2 与 projection 是否同序；
5. adapter capability 与 transport 是否匹配；
6. revision/evidence digest 是否相符；
7. PermissionV2 是否拒绝；
8. 是否属于 recovery_required 而非可盲重试失败。

---

## 10. 测试矩阵与命令

### 10.1 单元/领域

- `packages/schema/test/delegation.test.ts`
- `packages/core/test/delegation-state.test.ts`
- `packages/core/test/delegation-review.test.ts`
- `packages/core/test/delegation-fold.test.ts`
- `packages/core/test/delegation-service.test.ts`

覆盖：Schema 与 branded ID 不可互换、状态转换（含 `approved → waiting_review` 回路与 `deleted` 非状态）、roster phase 不被 runtime status 覆盖、barrier 按 role 计算且 `rework` / `formatting_only` 两侧都测、`rejected` 跨 revision 阻塞、barrier 纯函数性、revision digest 输入不含事件序号、来源携带式去重、重试只对未结算开放、脱敏。

`delegation-review.test.ts` 与 `delegation-fold.test.ts` 必须是**纯单测**——barrier 吃折叠状态、不吃数据库句柄（§4.4），所以这两个文件不应出现任何数据库或 Layer 装配。若发现必须起实例才能测 barrier，说明实现把数据库句柄漏进了纯函数，要回头改实现而不是改测试。

### 10.2 Core integration

- `packages/core/test/delegation-build-participant.test.ts`
- `packages/core/test/delegation-cli-participant.test.ts`
- `packages/core/test/delegation-fanout.test.ts`
- `packages/core/test/delegation-recovery.test.ts`
- `packages/core/test/delegation-codex-app-server.test.ts`

**测试 helper 按包区分，不要混用**（2026-08-31 核实）：

| 包                         | 可用写法                                           | 依据                                                                               |
| -------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `packages/core/test/`      | `it.effect`、`it.live`、`testEffect`、`Layer.mock` | 现有 862 处 `it.effect` + 245 处 `it.live`；**`it.instance` 在 core 一次都没出现** |
| `packages/aigcfroge/test/` | 以上 + `it.instance`                               | `it.instance` 定义在 `packages/aigcfroge/test/lib/effect.ts`，是该包本地 helper    |

所以 core 侧的委派集成测试用 `it.effect` / `it.live`，**不能写 `it.instance`**；需要 `it.instance` 的实例级装配测试放 `packages/aigcfroge/test/delegation-*.test.ts`。

**并发陷阱**：`it.effect` 带 TestClock，会让等待并发 fiber 的 drain 测试挂起。委派的扇出、后台投递、cold resume 都是并发场景，这类用例改用 `it.live`，并用 Deferred / BackgroundJob / SessionStatus 就绪信号同步，**禁止 `Effect.sleep` 等待并发 fiber**。

`packages/aigcfroge/test/` 侧另需覆盖 §5.2.1 的当前委派解析（缺 `delegation_id` → 解析而非新建）与两个并存委派互不串台。

### 10.3 Existing regression

至少回归：

```bash
bun --cwd packages/core test --timeout 30000 test/task-driver-fill.test.ts test/cli-sdk-adapters.test.ts test/cli-adapters.test.ts test/cli-config-adapter.test.ts
bun --cwd packages/core test --timeout 30000 test/meta-agent-service.test.ts test/meta-agent-memory.test.ts test/tool-taskspawn.test.ts
bun --cwd packages/aigcfroge test --timeout 30000 test/tool/task.test.ts test/agent/meta test/meta-agent-e2e.test.ts
```

### 10.4 API/UI/E2E

```bash
bun --cwd packages/aigcfroge test:httpapi
bun --cwd packages/app test:unit
bun --cwd packages/app test:e2e <delegation-spec>
bun ./packages/sdk/js/script/build.ts
```

实际实现后，只运行受影响测试文件先红绿，再运行受影响包完整 suite；禁止从仓库根目录运行测试。

### 10.5 Typecheck/lint/diff

```bash
bun --cwd packages/schema typecheck
bun --cwd packages/core typecheck
bun --cwd packages/aigcfroge typecheck
bun --cwd packages/server typecheck
bun --cwd packages/app typecheck
LINT_BASE_REF=origin/main bun run script/lint-changed.ts
bun run script/format.ts --check
git diff --check
```

文档-only slice 至少执行：

- `git diff --check`；
- Markdown 相对链接存在性扫描；
- `bash .aigcfroge/skills/protocols/scripts/check-refs.sh`（协议引用基础检查）；
- `bash scripts/check-agent-protocols.sh`（agent card 基础检查，不代替委派文档一致性）；
- `bash scripts/check-delegation-docs.sh`（真实检查 PRD/ADR/计划/testing/technical-debt 的一致性）；
- `git diff --stat` 与事实搜索（旧“已完成”声明不能残留）；
- 每条脚本输出的 exit code 与实际检查计数必须记录。

**红测试有效性门禁**：一个「红」必须因**断言失败**而红，不能因 `SyntaxError`、模块解析失败、或访问不存在的属性而红。后者只证明代码没写，不证明行为契约被表达了；它会在实现补齐后自动变绿，从而跳过契约验证。每个 Phase 的复查卡片必须写明红测试的失败类型。

---

## 11. 灰度、回滚与兼容

### 11.1 Flag

| Flag                                            | 默认           | 作用                                               |
| ----------------------------------------------- | -------------- | -------------------------------------------------- |
| `AIGCFROGE_EXPERIMENTAL_PERSISTENT_DELEGATIONS` | false          | 新 Delegation owner、multi-participant、multi-turn |
| `AIGCFROGE_EXPERIMENTAL_DELEGATION_RECOVERY`    | false          | 启用启动恢复和 reconciliation                      |
| `AIGCFROGE_DISABLE_META_AGENT`                  | false/现有语义 | 回退 build，不改变                                 |

### 11.2 回滚

- flag off：新命令不暴露，旧 `task`、`task_id`、CLI resume 保持原路径；
- flag on 期间发现 projection/API 问题：停止新 append，保留已有历史，回退到 participant 的兼容 task/CLI resume；
- 不回滚已执行的文件修改、外部 CLI side effect 或已发布事件；
- migration 只向前兼容，不用 down migration 删除已有历史；
- 不删除旧表，直到 backfill、观察期、对账和 PR 复审全部完成。

### 11.3 兼容映射

```text
legacy task child Session
  → DelegationParticipant(kind=internal, childSessionID=...)

external_cli_session(parent, cli, externalID)
  → DelegationParticipant(kind=external_cli, externalThreadID=...)

meta_agent_step
  → DelegationDelivery / compatibility projection

session_task
  → UI progress projection, not lifecycle truth
```

若历史行无法唯一映射，创建 `unbound_legacy` 记录并要求人工选择，不猜测归属。

---

## 12. 阶段复查卡片

每个 Phase 必须输出：

```text
Phase N 复查结论:
- 影响文件:
- 复用的 owner:
- 新增的状态/Schema/API:
- 红测试:
- 绿测试:
- 回归测试:
- Typecheck:
- Lint/format/diff:
- 权限与安全门禁:
- EventV2/Projection 一致性:
- 恢复/中断/关闭验证:
- 文档同步:
- 剩余风险:
- 是否允许进入下一 Phase:
```

“有测试通过”不能替代“状态、持久化、恢复和失败路径已验证”。

---

## 13. 最终验收清单

### 功能

- [ ] Meta-Agent 能创建 Build + Codex 两 participant 的 Delegation；
- [ ] Build 修改代码后产生 revision digest；
- [ ] Codex 在独立、持久 external thread 中审查该 revision；
- [ ] Meta 追加新证据时，两个 participant 收到同一 turn 的对应 delivery；
- [ ] Build/Codex 至少完成两轮持续对话；
- [ ] Codex 旧 revision approval 不满足最新 barrier；
- [ ] 单 participant 失败不丢失其他 participant 状态；
- [ ] 可重试、可 steer、不可 steer 时可 queue；
- [ ] 可 interrupt、close、complete、archive；
- [ ] delete 只在显式 purge 下发生；
- [ ] 子智能体不会递归委派；
- [ ] Codex review 与 PermissionV2 审批分离；
- [ ] AigcForge 重启后能恢复或明确标记 recovery_required；
- [ ] AgentTaskHub/Session UI 可查看 Delegation、participant、turn、review 状态。

### 工程

- [ ] EventV2 是事件真源；projection 与 event 可重放一致；
- [ ] 无第二 Tool representation/CLI registry/Session transcript；
- [ ] 所有 schema/migration/generated SDK 同步；
- [ ] 无 `Effect.sleep`/`setTimeout` 并发等待；
- [ ] 无无理由 `any`/unchecked cast/吞异常；
- [ ] 日志脱敏；
- [ ] 受影响包 typecheck/test/lint 通过；
- [ ] HTTP auth/coverage/effect exercise 通过；
- [ ] 文档只剩一个 active plan，旧文档已标注历史/替代关系；
- [ ] ADR-22 从 Proposed 更新为 Accepted。

---

## 14. 文档归一化与归档策略

### 14.1 唯一真源

- 需求真源：`docs/prd/meta-agent-orchestrator.md`；
- 架构决策：`docs/architecture/adr/ADR-22-meta-agent-persistent-delegation.md`；
- 施工计划：本文；
- V2 总体状态：`specs/v2/todo.md`；
- 系统架构索引：`ARCHITECTURE.md`；
- 外部 CLI 历史实现：`docs/plan/external-cli-dispatch-implementation.md` + `docs/roadmap/external-cli-dispatch-roadmap.md`，只记录 transport/resume 基线，不再拥有 Delegation lifecycle。

### 14.2 旧文档处理

不直接删除旧文档，避免破坏历史链接；统一在文件顶部增加：

```text
状态：HISTORICAL / SUPERSEDED
替代文档：meta-agent-persistent-delegation-closed-loop.md
本文只保留历史实现事实，不作为新功能施工入口。
```

必须同步的旧文档：

- `docs/plan/meta-agent-orchestrator.md`：MVP 计划，标记历史；
- `docs/plan/meta-agent-orchestrator-prompt.md`：旧执行提示，标记历史；
- `docs/plan/meta-agent-v2-production-closure.md`：旧 V1→V2 闭环计划，纠正“Meta/CLI 完整闭环已完成”的过宽表述；
- `docs/plan/external-cli-dispatch-implementation.md`：M1–M5 transport 实施记录，追加当前限制和本文链接；
- `docs/roadmap/external-cli-dispatch-roadmap.md`：transport roadmap，追加 Delegation lifecycle 已移交本文；
- `docs/plan/subagent-protocol-cards.md`：协议卡片计划，追加 implementer/reviewer turn contract 由本文定义；
- `docs/research/agent/元智能体调度架构讨论总结.md`：研究基线，明确待决问题已经由 ADR-22/本文收敛的部分与仍需产品批准的部分。

### 14.3 文档质量门禁

- 不得继续写“支持完整 pipeline/fan-out/close”而没有对应代码和测试；
- “external CLI session recovery 已完成”只能表示基础 resume hint/SDK resume，不表示 app-server thread lifecycle；
- “MetaAgentService 已完成”只能表示配置/关联/step service，不表示 Delegation aggregate；
- README/ARCHITECTURE/PRD/roadmap 的状态词必须一致；
- 文档引用的 line number 只在稳定审查记录中使用，施工计划优先使用文件链接，避免行号漂移。

---

## 15. 方案对冲与最终建议

### 简单实现

先把现有 `task_id`、`external_cli_session`、`TaskDriver` 包在一个 `DelegationService` 外观下，新增 participant/turn 状态和 revision barrier，再逐步接入 close/archive。

- 优点：改动小、可以快速验证 Build + Codex 两轮闭环；
- 技术债：兼容映射复杂，旧键仍可能被误用，app-server control 能力不完整；
- 适合：Phase 1–4 灰度。

### 健壮架构

完整落地 Delegation/Participant/Turn 聚合、EventV2 真源、reconciliation、Codex app-server 控制面、统一 API/UI 和旧路径退役。

- 优点：状态、恢复、审查版本和生命周期都有唯一 owner；
- 成本：新增 migration、API、SDK、UI、adapter control 和恢复测试；
- 适合：生产承诺和长期多智能体协作。

### 声明式编排（第三条路线，不选但必须记录）

前两个选项都把 LLM 放在编排回路里，只在"外观薄/厚"上不同。第三条路线在结构上不同：**编排本身不含 LLM**。

参照 `microsoft/conductor`（先例见 ADR-22 §6.3）：workflow 用 YAML 声明，路由用表达式求值、first match wins，人工闸门是一等步骤类型，`for_each` 提供动态扇出，另有独立的 mid-run steering 命令和已完成 run 的重放。

- 优点：确定性、可版本控制、可重放；编排决策不会因模型波动而出错；恢复语义天然更简单，因为下一步是算出来的而不是推理出来的；
- 缺点：必须**预先声明**协作形态。Meta-Agent 的核心价值恰恰是应付未声明的协作，这条路线会把它降级成一个 workflow 启动器；
- 值得注意：它证明本计划想要的扇出、人工闸门、mid-run steering 在不把 LLM 放进回路的前提下也能实现——**这些能力本身不构成选 LLM-in-loop 的理由**；
- 与本仓的关系：Custom Mode 已有 workflow 概念（ADR-18），若将来需要"可复现的固定协作流程"，应走 Custom Mode 的 workflow 而不是把 Delegation 改造成声明式引擎。两者共存，各管一类需求。

**最终选择**：按本文 Phase 1→4 先做简单实现的最小垂直闭环，但从第一天就使用健壮架构的领域模型、状态机和事件边界；Phase 5→7 再补 app-server 控制、恢复、UI 和兼容退役。这样既遵守“复用优先”，又不会把 `task_id` 和“最近 active CLI session”继续固化成错误的长期架构。

选 LLM-in-loop 而不选声明式的理由是**能力上限**（应付未声明的协作形态），不是实现难度。这个理由必须成立才值得付本文的成本；如果实际使用中发现委派形态高度固定，应当回头重新评估第三条路线。

### 已裁决的两项（2026-08-31，原"待裁决"）

**裁决一：投递不独立成表。** Phase 1 只建 delegation / participant / turn 三张投影表；投递事实由 `delegation.delivery_*` 事件承载，聚合状态用增量折叠计算。

- 根因重述：EventV2 是真源、Drizzle 表只是投影（ADR-22 §2.4），所以这是**查询形状问题不是真源问题**。投影可随时 drop 重建，因此"以后再加"和"加一张真源表"在风险上不是一个量级；
- 反方最强论点是 barrier 每次投递完成都要重算 → 折叠是 O(全部事件)。已被"增量折叠 + Activation 生命周期缓存"化解，且 `event_aggregate_type_seq_idx`（`aggregate_id, type, seq`）让增量拉取带索引；
- 真正需要投影的是列表页（Phase 6 的 `GET /delegation` + AgentTaskHub 卡片），而那时 UI 还没写，现在猜形状等于赌；
- 配套约束见 §3.2 与 §5.1：不得出现按投递分页的 API 签名；barrier 必须是吃折叠状态的纯函数。

**技术债（方案对冲要求的显式声明）**：选了简单实现。债是——若 Phase 6 实测列表页需要投影，要补一张纯派生的投影表 + 重建脚本。触发条件写死：**`GET /delegation` 在 50 个委派规模下 p95 > 200ms**。已记入 `docs/technical-debt.md`。

**裁决二：铸造独立的 `Delegation.ID`。** 用 `Schema.brand`，事件用 `aggregate: "delegationID"` 拿到自己的序号空间。理由按强度排序：

1. **委派活得比对话轮次长，而对话继续往下走。** 这是 ADR-22 §2.6 自己的前提：委派跨轮次存活、后续某轮追加证据。那么下一轮用户输入发生时前一个委派仍开着；若该轮又要委派，同一父 Session 下就有两个。**这不依赖任何关于用户偏好的假设，是本计划前提的必然结果**；
2. **completion barrier 是按委派算的**（§4.4）。两件独立工作共享一个 Delegation 就共享一个完成条件，一件卡住另一件永远无法收尾；
3. **本计划自己已经隐含假设 >1**：Phase 6 有 `GET /delegation` 列表端点和 `DelegationPanel`。若一个会话只可能有一个委派，不需要列表端点，直接在会话页渲染即可；
4. 事件流隔离：复用 `parentSessionID` 会让委派事件与 session 事件共用一个单调序号（`event_sequence.aggregate_id` 是主键）并交错；
5. 成本是一个 branded string，不是一个子系统。

**曾经用过但已撤回的理由**：初版论证是"用户会在一个 Meta 对话里同时做两件独立的工作"。核对 PRD 后撤回——已归档的历史计划 `docs/plan/meta-agent-orchestrator.md`（HISTORICAL / SUPERSEDED）对应章节中的旧 `@A @B 同时` 语义，是 `@A @B 同时` = **同一件事分给多个引擎、`Effect.all` 等待、结果汇总**，是一件事的扇出，从未承诺两件独立工作各自独立收尾。那个例子是臆想的业务场景，不是产品事实。现有理由 1 不依赖它。

**同时执行的减法**：删掉 `Delegation.currentTurn`（从 turn max seq 派生）。

**核实后保留的字段**：`metaAgentID?` 不删——`meta_agent_session` 的主键是 `(meta_agent_id, session_id)` 复合键即 M:N 关联，一个 session id 不唯一决定一个 meta_agent id，所以它不是冗余列。

**裁决时新发现的两条缺口**（已分别补进 §5.2.1 和 Phase 6）：缺 `delegation_id` 时必须解析到最近活跃委派而非新建；以及委派归宿策略（自动 archive + 闲置过期态）。两条都不改 Schema，但第一条不修会在灰度期持续造空委派。

## 16. TDD 直接实施 Runbook（2026-09-04）

本节是实施者真正执行时的顺序化清单。§3–§5 定义领域契约，§6 定义阶段目标，§16 固化「先读什么、先写什么红、如何转绿、如何验证和如何停机回滚」。除非另有明确裁决，不得跳过本节的 Entry/RED/GREEN/Exit 任一门。

### 16.1 Entry：创建安全施工环境

**开始条件**：

- 当前本地 `main` 已包含 `persistent-delegation` 文档合并提交 `3c4e2be50`；
- `git status --porcelain` 为空；
- 先确认没有其他 agent 正在写入目标 worktree；
- 任何脏工作树都不能通过 `git switch` 强行覆盖，必须另建 worktree；
- 本功能首个 runtime slice 只允许在 Coding 模式、显式开启 flag、单 Location 内灰度，不能一开始扩展到集群或所有 Product Mode。

**开工命令**（从仓库根执行，但不在根目录运行测试）：

```bash
git status --short --branch
git show -s --format='%H %ad %s' --date=iso HEAD
git diff --check

git fetch origin main --prune
git worktree add .worktrees/delegation-runtime -b delegation-runtime origin/main
cd .worktrees/delegation-runtime
```

若 `delegation-runtime` 已存在，则先确认它是否为本计划的干净实施分支；不得复用含无关提交或脏改动的 worktree，也不得用旧文档分支继续生产实施。

**开工取证**：

```bash
codex --version
codex app-server generate-json-schema --out /tmp/aigcfroge-codex-app-server-20260904
bash .aigcfroge/skills/protocols/scripts/check-refs.sh
bash scripts/check-agent-protocols.sh
bun --cwd packages/core migration --check
```

若本机没有 `codex app-server` 或 schema 生成失败，不得把 app-server Phase 标记为通过；只允许先实施 SDK/JSONL 兼容 slice，并把 Phase 5 标记为 blocked-by-environment。不要为了让测试通过而伪造 schema 或把 app-server 降级成普通 `codex exec`。

### 16.2 Owner map：允许写入的边界

| 层                 | 唯一 owner                                                                             | 允许写入                                                   | 明确禁止                                                                     |
| ------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Schema             | `packages/schema/src/delegation-id.ts`、`delegation.ts`、`src/index.ts`                | branded ID、领域 Schema、事件 payload 的纯数据结构         | 依赖 Core、数据库操作、执行 provider                                         |
| Core domain        | `packages/core/src/delegation/`                                                        | 聚合状态、事件定义、fold、barrier、reconciliation、Service | handler/adapter/UI 直接写表；第二套 Tool/registry                            |
| DB projection      | `packages/core/src/delegation/sql.ts`、`packages/core/src/database/migration/`         | 三张 projection table 与 EventV2 commit projector          | `delegation_delivery` 真源表、`down` migration、camelCase 列                 |
| Session seam       | `packages/core/src/tool/task-driver.ts`、`session/task-driver-fill.ts`                 | 将已 durable admitted 的 delivery 驱动到 child Session/CLI | 在 `TaskDriver` 中复制 SessionV2 编排；在 task tool 内自行 fork 未受管 fiber |
| Existing task tool | `packages/core/src/tool/task.ts`、`packages/aigcfroge/src/tool/delegation-protocol.ts` | 参数解码、当前委派解析、权限入口、兼容 output              | 直接插入 delegation/participant/turn 表                                      |
| CLI adapters       | `packages/core/src/tool/cli-adapter.ts`、`codex-sdk.ts`、`codex.ts`、`acp.ts`          | transport、resume、可选 control、结果解析                  | adapter 自己决定 Delegation 状态；凭能力布尔表宣称支持                       |
| Canonical HTTP     | `packages/server/src/groups/delegation.ts`、`handlers/delegation.ts`                   | `/api/delegation` contract + thin handler                  | 复制状态机、绕过 SessionLocationMiddleware                                   |
| Legacy HTTP        | `packages/aigcfroge/src/server/routes/instance/httpapi/...`                            | 兼容入口，转调同一 Core Service                            | 新增业务语义、第二份授权逻辑、另建 projection                                |
| SDK                | `packages/sdk/js/src/gen/*`                                                            | 由 OpenAPI 生成的 SDK                                      | 手改 `gen/` 产物；不验证 namespace 是否可调用                                |
| App/session-ui     | `packages/app/src/pages/session/timeline/`、`packages/session-ui/src/`                 | 纯 projection、状态显示、用户命令                          | 直接读数据库、靠 summary 正则推导状态                                        |
| TUI                | `packages/tui/src/routes/session/`                                                     | 消费统一 projection，显示生命周期                          | 维护第二套 Delegation 状态机或调用 CLI 控制面                                |

所有新模块遵循 self-export：`export * as Delegation from "./delegation"`。多 sibling 目录不新建 barrel；导入必须复用现有 namespace 和 service seam。

#### 16.2.1 最小可实施 Service contract

先把以下方法和错误边界写成 Schema/类型，再开始接 adapter 或 HTTP。命名可以按现有模块风格调整，但语义和输入输出不能缩水：

```text
create({ parentSessionID, metaAgentID?, title, requestedBy })
  -> { delegationID, status: "draft" }

addParticipant({ delegationID, role, provider, target, context: "fresh" | "fork" })
  -> { participantID, phase: "provisioning" }

appendTurn({ delegationID, kind, prompt?, evidenceDigest?, revisionDigest?, participantIDs, delivery, origin })
  -> { turnID, seq, deliveries, status: "admitted" | "queued" }

recordDelivery({ delegationID, turnID, participantID, origin, attempt, status, externalTurnID?, summary?, errorCode? })
recordRevision({ delegationID, turnID, participantID, commitSha, normalizedDiff, revisionDigest, changeKind })
recordReview({ delegationID, turnID, participantID, reviewedRevisionDigest, verdict, findings, summary })

get({ delegationID, parentSessionID })
list({ parentSessionID?, location, includeArchived?, includeExpired? })
foldState({ delegationID, parentSessionID })
resume({ delegationID, participantID, turnID? })
steer({ delegationID, participantID, turnID, delivery: "steer" | "queue" })
retry({ delegationID, participantID, turnID })
interrupt({ delegationID, participantID? })
complete({ delegationID })
close({ delegationID })
archive({ delegationID })
unarchive({ delegationID })
fork({ delegationID, title })
purge({ delegationID })
reconcile({ delegationID, participantID?, turnID?, decision: "resume" | "retry" | "fork" | "close" })
retractRejection({ delegationID, participantID?, reason })
```

补充约束：

- `appendTurn` 必须先持久化 Turn 和 admitted deliveries，再返回；provider 调用不是 admission 的一部分；
- `recordDelivery`/`recordRevision`/`recordReview` 只能由 `DelegationService` 调用，adapter、handler、UI 不得直接写表；
- `get/list/foldState` 必须校验 parent Session/Location，不能用 delegation ID 单独跨租户读取；
- `origin` 至少包含 `{ turnID, deliveryOrigin, senderParticipantID }`，它是 fold 去重输入，不另建幂等表；
- 所有失败必须落在已定义的 typed error/`recovery_required` 结果上；不要以 `Effect.orDie` 把客户可恢复错误伪装成 defect；
- `purge` 是显式物理删除命令，不进入 status union，不允许被 `complete`/`archive` 隐式调用。

### 16.3 每个 Phase 的固定 TDD 循环

每张 Phase card 的 Exit 必须附一条**真实执行记录**：`command`、`exit code`、测试文件、具体用例名或测试计数、pass/fail/skip、是否为 network-dependent。只看到 Bun usage、空输出或仅路径存在性检查时，视为未执行/未通过；不得用 exit 0 代替“断言确实运行”。

每个阶段都必须按下列顺序执行，不能先写实现再补一批「看起来能过」的测试：

1. **RED**：先新增一个最小行为断言，运行它并确认因为断言失败而红；记录失败类型、测试命令和预期行为。`SyntaxError`、模块找不到、Layer 缺失、未导出的属性和 `any` 导致的编译失败都不算有效红证。
2. **GREEN**：只实现让当前红证通过的最小路径；不顺手重写相邻旧路径，不把未来 Phase 的行为提前塞入当前 Phase。
3. **REFACTOR**：检查 owner、重复实现、Effect Layer、错误类型、日志脱敏和调用链；只在行为绿后整理。
4. **FOCUSED VERIFY**：从受影响 package 目录运行指定测试与 typecheck；不从仓库根目录运行测试。
5. **REGRESSION**：运行该阶段列出的旧测试；对旧路径做 flag-off 回归。
6. **DIFF REVIEW**：`git diff -- <files>`、`git diff --check`、旧符号/旧字段/绕过路径搜索。
7. **PHASE CARD**：填写 §12 的 Phase 复查卡片，明确是否允许进入下一阶段。

测试同步规则：纯状态、barrier、digest 和 fold 不得依赖数据库；文件系统、Git、child process、锁和真实时间用 `it.live`；实例级装配用 `it.instance`，但只在 `packages/aigcfroge/test/` 使用。并发就绪必须用 `Deferred`、`Latch`、`pollWithTimeout`、`BackgroundJob.wait` 或 `SessionStatus`，禁止用 `Effect.sleep`/`setTimeout` 猜 fiber 何时完成。

### 16.4 Phase 0：基线与测试脚手架

**Entry**：施工 worktree 已创建，协议引用和迁移 check 通过。

**RED/取证**：

- 在 `packages/core/test/task-driver-fill.test.ts`、`cli-sdk-adapters.test.ts`、`cli-adapters.test.ts` 中记录当前旧行为：`task_id` resume、CLI target 隔离、缺 spawner、SDK sessionId 持久化、PermissionV2 allow/deny；
- 在 `packages/aigcfroge/test/tool/task.test.ts` 固化前台 resume、递归 deny、父 Session 归属、background flag 行为；
- 新建 `packages/core/test/delegation-test-support.ts` 只提供测试数据构造，不复制生产逻辑；
- 新建空的 Phase 1 测试文件时，先让每个断言因行为不满足而失败，不能因 import 缺失而失败。

**GREEN/准备**：

- 只建立测试 fixture、测试数据和文档，不改生产行为；
- 固定 fake provider/adapter 的可观察信号：收到 prompt、resumeId、control method、result envelope、调用次数；
- 对 live tests 使用 scoped temporary directory，Git fixture 用 `tmpdirScoped({ git: true })`；
- 所有 fake adapter 用 `Layer.mock` 或显式 factory 注入，禁止修改 `globalThis`。

**Exit**：旧测试 baseline 已记录；测试可以区分「断言红」与「装配红」；Codex app-server 是否可用已有明确结论；无生产代码改动。

### 16.5 Phase 1：Schema、projection、EventV2 与纯领域状态

**RED 文件**：

```text
packages/schema/test/delegation.test.ts
packages/core/test/delegation-state.test.ts
packages/core/test/delegation-review.test.ts
packages/core/test/delegation-fold.test.ts
packages/core/test/delegation-digest.test.ts
packages/core/test/database-migration.test.ts（扩展现有迁移测试）
```

**RED 必须覆盖**：

- `Delegation.ID`、`DelegationParticipant.ID`、`DelegationTurn.ID` 与 `SessionSchema.ID` 不能互换；
- unknown status、unknown role、缺必填 aggregate ID、空 title、超长 summary、非法 digest 被 Schema 拒绝；
- `draft → running → waiting_review → approved → completed`、`draft → cancelled → archived` 合法；非法回退、`approved → closing` 但没有 close gate、任意状态 → `deleted` 失败；
- `phase` 的 `provisioning → active|failed` 只前进；迟到的 runtime `running` 不得覆盖 `failed`；
- reviewer 为空时 barrier 满足；reviewer 存在但 stale、rejected、missing digest 时 barrier 不满足；
- `rework` 不复制旧 approval；本期 `formatting_only` 同样按 `rework` 处理且不复制；`rejected` 跨 revision 持续阻塞并可显式 retract；
- barrier 只接收折叠状态，测试文件中不得出现 Database/Layer 装配；
- digest 输入只允许 commit SHA + normalized diff，不允许 event sequence、prompt、token、Authorization；同一代码事实生成同一 digest；
- delivery 不创建独立 ID 或独立表；同一 `(turnID, participantID, deliveryOrigin, senderParticipantID)` fold 后幂等；
- migration clean database 和 existing database 都存在恰好三张新表，并有 parent/foreign key/index；schema 使用 snake_case。

**GREEN 文件/动作**：

1. 在 `packages/schema/src/delegation-id.ts` 增加三个 branded ID，并在 `packages/schema/src/delegation.ts` 增加 `Schema.Class`/payload；在 `packages/schema/src/index.ts` 导出，不能从 Core 反向导入。
2. 在 `packages/core/src/delegation/state.ts` 实现纯 transition guard；在 `review.ts` 实现 `changeKind`、`copyable`、`canComplete`；在 `fold.ts` 实现从 `delegation.*` durable events 得到聚合状态。
3. 在 `packages/core/src/delegation/event.ts` 用 `EventV2.define` 注册 durable event；每个事件 payload 携带 `delegationID` 作为 durable aggregate 字段，事件数据只保留 typed IDs、状态、摘要/digest、错误码和必要时间。
4. 在 `packages/core/src/delegation/sql.ts` 定义 `delegation`、`delegation_participant`、`delegation_turn`；只让 projector 在 EventV2 commit transaction 中更新 projection。不要给 Delivery 建 projection table。
5. 新增时间戳命名的 TypeScript migration，执行 `cd packages/core && bun script/migration.ts`；不要手写 `schema.gen.ts`、`migration.gen.ts` 或 `schema.json`。
6. 运行 `bun --cwd packages/core migration --check`，确认 generated schema/registry 与 migration 文件一致。

**Exit 命令**：

```bash
bun --cwd packages/schema typecheck
bun --cwd packages/schema test test/delegation.test.ts
bun --cwd packages/core typecheck
bun --cwd packages/core test --timeout 30000 test/delegation-state.test.ts test/delegation-review.test.ts test/delegation-fold.test.ts test/delegation-digest.test.ts test/database-migration.test.ts
bun --cwd packages/core migration --check
```

**停机条件**：若 barrier 测试必须读取数据库才能通过，立即停止并把数据库查询移回 fold/service；若 migration 需要第二个 database connection 才能通过，停止并先排查 Layer/connection ownership，不加 timeout 掩盖锁问题。

### 16.6 Phase 2：内部 Build participant 与 TaskDriver 接线

**RED 文件**：

```text
packages/core/test/delegation-build-participant.test.ts
packages/aigcfroge/test/delegation-task.test.ts
packages/aigcfroge/test/tool/task.test.ts（扩展兼容回归）
```

**RED 必须覆盖**：

- `create` 一次性持久化 Delegation + Build participant + child Session 绑定；
- `appendTurn` 复用同一个 child Session，并使 `turn.seq` 单调；
- 显式 `delegation_id` 跨 parent Session、Location 或 Product Mode 时 fail closed；
- 缺 `delegation_id` 时按父 Session 最近持久活跃委派解析，不能每轮创建空委派；无活跃委派时才新建；
- 同一 parent Session 下两个并存委派互不串台；
- child Session 内调用 task 仍被拒绝；
- foreground、background、queued append、cancel、failed、retry 都产生正确 delivery event；
- retry 只重试未结算 delivery，已结算 delivery 只能创建新 Turn；
- parent interrupt 只中断本地活动执行，不把 Delegation 自动 archive；
- `meta_agent_step` 兼容投影不会永久停在 `running`，但不会取代 Delegation 真源。

**GREEN**：

1. 扩展 `TaskDriver.Interface` 只增加 delegation-aware command seam，保留现有 `createChild/delegate/delegateBackground/extendBackground/interrupt/cancel`；TaskDriver 不直接依赖数据库表。
2. `DelegationService` 负责先 admit Turn，再通过 `DelegationExecution`/TaskDriver 投递；禁止在 task tool 内直接调用 `SessionV2` 或自建 `BackgroundJob`。
3. `packages/core/src/tool/task.ts` 只做参数 decode、递归 deny、Product Mode/PermissionV2 gate、委派解析和 service 调用；旧 `task_id` 解析为 participant child Session 的兼容输入。
4. 对 foreground child 使用现有 `BackgroundJob` 独立 fiber；对 background append 复用 `extendBackground` 的 FIFO 语义，映射为显式 `queue`，不伪装成 `steer`/插话。
5. 每个内部 delivery 的来源携带 `turnID`、`deliveryOrigin`、`senderParticipantID`，写入目标 inbox 和最终 projected message，恢复时用 fold 去重。
6. `onSettle` 只在 child drain 已结束后回写 `session_task`/`meta_agent_step`；写回失败不得被 `catchCause` 吞掉。

**Exit**：

```bash
bun --cwd packages/core test --timeout 30000 test/delegation-build-participant.test.ts test/session-task-service.test.ts test/task-driver-fill.test.ts
bun --cwd packages/aigcfroge test --timeout 30000 test/delegation-task.test.ts test/tool/task.test.ts
bun --cwd packages/core typecheck
bun --cwd packages/aigcfroge typecheck
```

### 16.7 Phase 3：Codex/CLI participant 与权限边界

**RED 文件**：

```text
packages/core/test/delegation-cli-participant.test.ts
packages/core/test/cli-sdk-adapters.test.ts
packages/core/test/cli-adapters.test.ts
packages/core/test/cli-acp-adapter.test.ts
packages/core/test/task-driver-fill.test.ts
```

**RED 必须覆盖**：

- Codex participant 绑定稳定 `externalThreadID`，下一 Turn 优先从 participant 读取 resume ID；不能从同一 parent/target 的「最近 active」猜线程；
- legacy `external_cli_session` 只有一条未绑定记录时可 backfill；存在多个候选或目标不匹配时进入 `recovery_required`，不能静默选择；
- SDK、JSONL、ACP 的 resume 行为按 adapter 能力不同而不同；未实现的 control method 必须得到 typed unsupported error；
- Codex SDK 保持 `approvalPolicy: "never"` 的 unattended-safe 默认，但测试明确证明这不是 PermissionV2 bridge；Codex SDK 如果需要外部工具授权，必须先增加显式 callback seam，否则只允许只读 reviewer；
- Claude SDK 缺 PermissionV2 时不能沿用隐式放行；ACP/Claude/Codex/JSONL 的 fail-closed 差异必须在 contract test 中记录；
- timeout、process missing、malformed resume hint、malformed result、stderr-only failure 都写 delivery failed/recovery_required，不丢原始状态；
- CLI tool name、resource input、prompt、Authorization、环境变量和完整 stdout 不能进入日志。

**GREEN**：

1. 将 participant 绑定的 external thread 作为 canonical resume source；保留 `external_cli_session` 为兼容投影/回填来源，不把它继续当 Delegation 真源。
2. 扩展现有 `CliAdapter` 的可选 `control` 方法；不新增 registry、不新增 capability boolean map。UI 能力视图只能由方法存在性派生。
3. `TaskDriverFill.executeCLI` 通过 `PermissionV2` 读取父 Session 的授权上下文；child Session 不是授权主体。缺 `PermissionV2` 时按 transport 的真实 contract 处理，并且不能在文档中宣称统一桥接。
4. Codex reviewer 的 v1 prompt 明确只允许审查，不允许写入；任何非只读行为直接拒绝或进入 recovery_required。Writable Codex participant 等待单独的 PermissionV2 callback 设计，不在本 Phase 偷渡。
5. 所有 adapter result 归一为 `DelegationResult`/Review Envelope，再由 Service 写事件；adapter 不写 delegation projection。

**Exit**：

```bash
bun --cwd packages/core test --timeout 30000 test/delegation-cli-participant.test.ts test/cli-sdk-adapters.test.ts test/cli-adapters.test.ts test/cli-acp-adapter.test.ts test/task-driver-fill.test.ts
bun --cwd packages/core typecheck
```

### 16.8 Phase 4：多参与者 fan-out、证据追加与 review barrier

**RED 必须覆盖**：

- 一个 Turn 追加给 Build 与 Codex 两个 participant，生成两个独立 delivery；participant 顺序稳定；
- 一个 participant 失败不会覆盖另一个 participant 的成功结果；
- 同一 evidence digest 重复提交不生成重复 delivery；不同证据即使文本相似，只要来源 turn 不同也必须能区分；
- `steer` delivery 在安全 provider-turn 边界 promote；`queue` delivery 只在 Session 将要 idle 时 promote；运行中工具执行时不得强行打断工具；
- active activation、无 activation、目标已关闭、目标已归档、目标不存在分别走 steer、cold resume、typed error/no-op 的正确分支；
- Build settle 固化 revision snapshot；Codex review envelope 的 `reviewed_revision_digest` 不匹配时只能进入 waiting/changes_requested；
- 新 revision 的 `changeKind` 按 `no_change/no_code_change/formatting_only/rework` 处理，不能用 event seq；
- review approved 只对其绑定的 revision/change kind 有效；新的 rework 不能被旧批准放行；
- barrier 通过后 Delegation 才能进入 approved/completable；缺 reviewer 的兼容 delegation 不死锁。

**GREEN**：

1. `appendTurn` 在单个 durable commit 中先写 Turn admitted，再写每个 participant 的 delivery admitted；事件通知只能发生在 commit 后。
2. delivery 采用确定性来源元组去重，不新建 idempotency table；每次重试必须有 attempt，但已结算 delivery 不能原地重跑。
3. `DelegationExecution` 只负责进程内调度，按 delegation/participant 定位已有 activation；同一 Session 的并发 resume 交给现有 `SessionRunCoordinator`，不得把 Session ID 塞进 Layer。
4. 每个 provider turn 恰有一次显式 `llm.stream(request)`；继续执行前重新加载 projected history，禁止桥接 legacy `SessionPrompt.loop`。
5. Build completion 后调用 Git service 的 `head`/`patch`，以 commit SHA + normalized diff 计算并固化 revision；reviewer 事件不能改变该 digest。
6. Review parser 只接受 Schema 解码后的 envelope；解析失败、digest 缺失、未知 verdict 都是 changes_requested/invalid_review_envelope，绝不能自动批准。

**Exit**：

```bash
bun --cwd packages/core test --timeout 30000 test/delegation-review.test.ts test/delegation-fold.test.ts test/delegation-fanout.test.ts
bun --cwd packages/aigcfroge test --timeout 30000 test/delegation-task.test.ts test/meta-agent-e2e.test.ts
bun --cwd packages/core typecheck
bun --cwd packages/aigcfroge typecheck
```

### 16.9 Phase 5：Codex app-server 控制面与生命周期

**RED 必须覆盖**：

- app-server transport 存在时，`thread/start|resume|fork|archive|delete` 和 `turn/start|steer|interrupt` 请求/响应 Schema 严格匹配当前生成快照；
- app-server 版本/方法不匹配时 capability negotiation 失败并降级 SDK/JSONL；
- `interrupt` 先授权再 lookup；目标不存在/闲置时是幂等 no-op；保留 inbox，不重排已 claim input，不等待不可证明的 quiescence；
- `close` 关闭新的 turn admission，再向活动 participant 发 interrupt；外部控制不支持时只关闭 AigcForge binding，不谎称外部 thread 已关闭；
- `archive` 保留 Session/Event/turn/review，`delete` 是显式 purge 且需要更高权限；
- app-server process/connection 中断进入 recovery_required，不自动重放未知副作用。

**GREEN**：

- 新建 `packages/core/src/tool/codex-app-server.ts`，只暴露 Core 需要的最小 typed seam；生成协议类型不得泄漏到 Session/Delegation Schema；
- connection 生命周期由 `DelegationExecution`/adapter scope 管理，UI/handler 不能直接持有 process；
- 控制面仅在 `control` 方法存在且版本协商通过时启用；否则按 provider fallback，不静默丢选项；
- 生命周期映射为：`interrupt` = 停止当前本地活动；`close` = 禁止新增 turn + 请求停止 participant；`complete` = barrier 通过后的领域状态；`archive` = 隐藏但保留；`delete` = purge。

**Exit**：

```bash
bun --cwd packages/core test --timeout 30000 test/delegation-codex-app-server.test.ts test/delegation-recovery.test.ts
bun --cwd packages/core typecheck
```

若 app-server 只在本机特定 CLI 版本可用，测试必须同时跑 SDK/JSONL fallback；不能以「本机可用」替代跨 transport contract。

### 16.10 Phase 6：Canonical/legacy HTTP、SDK、App 与 TUI

**RED 文件**：

```text
packages/aigcfroge/test/server/delegation-httpapi.test.ts
packages/app/src/pages/session/timeline/delegation-panel-model.test.ts
packages/app/src/pages/session/timeline/delegation-panel.test.tsx
packages/app/e2e/regression/delegation-persistent-loop.spec.ts
packages/session-ui/src/components/delegation-tool-card-model.test.ts
```

**RED 必须覆盖**：

- canonical `/api/delegation` 与 legacy instance `/delegation` 都能调用同一 Service，且响应 Schema 一致；
- Session/Location/Workspace/Authorization 归属失败返回 typed 4xx；不可把跨 Session delegation 伪装成 404 或空列表；
- 新 endpoint 的 OpenAPI identifier 完整，生成的 SDK 真实存在 `client.delegation.<operation>`；
- 不存在 `listDeliveries(turnID)` endpoint；
- append/steer/retry/reconcile/retract-rejection/interrupt/complete/close/archive/unarchive/fork/delete 的状态错误、权限错误、重复命令和 idempotency 可解释；
- SSE/EventV2 只做增量更新，不让一条 stale event 覆盖已完成状态；
- App 显示 Build/Codex participant、turn、review、recovery_required、archived、expired；同一 parent 下两个 delegation 不串台；
- `complete` 后默认 archive；默认列表隐藏 archived/expired，但用户可显式查看；初始 soft-expiry 采用 **7 天可配置阈值**，过期不关闭外部 thread；
- loading、empty、error、recovery、long text、键盘焦点和一个窄视口行为均有证据；完整 dark/i18n/全量窄视口矩阵明确延期，不把历史上未成立的纸面要求当作本期通过条件。

**GREEN**：

1. 在 `packages/server/src/groups/delegation.ts` 定义 canonical contract，在 `packages/server/src/handlers/delegation.ts` 写薄 handler，并注册到 `packages/server/src/api.ts` / `handlers.ts`。
2. 在 legacy instance API 增加同语义兼容 group/handler；它只解析 context、调用 Core Service 和映射错误。两个 surface 使用不同 identifier namespace，避免 hey-api 平铺冲突。
3. 生成 SDK 必须执行 `./packages/sdk/js/script/build.ts`；随后用编译测试和运行时导出测试确认 namespace 与每个 operation 均存在，不只检查文件变更。
4. `DelegationPanel` 复用 `AgentTaskHub` 的布局与消息时间线投影，新增 pure `delegation-panel-model.ts`；不要在组件里直接按摘要推导状态。
5. TUI 只接收共享 projection，不维护第三个状态源；若没有 UI 入口，API/SDK 仍必须完整并可审计。

**Exit**：

```bash
bun --cwd packages/server typecheck
bun --cwd packages/aigcfroge test --timeout 30000 test/server/delegation-httpapi.test.ts
bun --cwd packages/aigcfroge test:httpapi
bun --cwd packages/app test:unit --test-name-pattern delegation
bun --cwd packages/app test:e2e e2e/regression/delegation-persistent-loop.spec.ts
bun --cwd packages/session-ui test src/components/delegation-tool-card-model.test.ts
bun ./packages/sdk/js/script/build.ts
bun --cwd packages/sdk/js typecheck
```

若 `test:httpapi` 受环境网络门禁影响，必须单独记录 network-dependent gate；不能把 coverage 模式通过当作行为测试通过。

### 16.11 Phase 7：恢复、灰度、兼容和退役

**RED 必须覆盖**：

- 进程在 turn admitted、delivery started、provider response 未确认、projection commit 前分别崩溃，启动后得到正确的 recovery state；
- 已确认的 external side effect 不自动重跑；未知是否产生副作用时进入 recovery_required；
- child Session 存在但 projection 缺失、projection 存在但 child Session 缺失、external thread 失联、多候选 legacy CLI row 都能人工接管；
- flag off 完全保持旧 `task_id`、`external_cli_session`、MetaAgentStep、AgentTaskHub 行为；flag on 才启用 Delegation commands；
- legacy mapping backfill 可重复执行，不重复 participant/turn，不改变历史摘要；
- complete/close/archive/expired 后 restart 不重新启动外部 provider。

**GREEN**：

- `DelegationRecovery` 只读取 durable events/projections、Session history/inbox、provider attempt receipt 和 external session metadata；不读取 `BackgroundJob` 作为真源；
- 只对有明确 provider idempotent resume contract 的 participant 自动 reconciliation；其余写 `recovery_required` 并暴露 `reconcile`/人工继续入口；
- `AIGCFROGE_EXPERIMENTAL_PERSISTENT_DELEGATIONS=0`：新 API 显式返回 typed disabled error，旧 task 路径不改变；`=1`：只在允许的 Product Mode/permission tier 生效；
- `AIGCFROGE_EXPERIMENTAL_DELEGATION_RECOVERY=0`：不自动继续 provider 工作，只允许查看和人工 reconcile；
- 观察期内保留 `meta_agent_step` 和 `external_cli_session` 兼容投影；只有全量迁移、回归和 telemetry 证明无读者后，才提出退役 PR。

**Exit**：

```bash
bun --cwd packages/core test --timeout 30000 test/delegation-recovery.test.ts test/database-migration.test.ts
bun --cwd packages/aigcfroge test --timeout 30000 test/delegation-task.test.ts test/server/delegation-httpapi.test.ts
bun --cwd packages/core typecheck
bun --cwd packages/server typecheck
bun --cwd packages/aigcfroge typecheck
bun --cwd packages/app typecheck
```

### 16.12 测试/Layer 处方

**Core 纯领域测试**：

```ts
const it = testEffect(Layer.empty)

it.effect("barrier is pure", () =>
  Effect.gen(function* () {
    expect(DelegationReview.canComplete(state)).toBe(true)
  }),
)
```

实际代码应使用项目中的 `testEffect` 与现有 service layer，不要照搬这个示例中的名字。`delegation-review.test.ts`、`delegation-fold.test.ts` 和 `delegation-digest.test.ts` 不能依赖 Database、HttpClient、BackgroundJob 或 provider。

**Core service/integration**：

- `it.effect`：纯状态、Schema、EventV2 projector 的确定性行为；
- `it.live`：Git、文件、child process、SQLite lock、真实时间和 adapter process；
- 不使用 `it.instance`，因为该 helper 属于 `packages/aigcfroge/test/lib/effect.ts`；
- 只对单方法覆盖用 `Layer.mock`；缺失方法应自然抛 `UnimplementedError`，不能用一串 `Effect.void` 把误调用藏掉。

**aigcfroge service/HTTP**：

- `it.instance` + `provideTmpdirInstance`/`provideTmpdirServer`：实例、Location、HttpApi、权限和真实临时 Git 仓库；
- HTTP 测试优先 tiny probe group + `NodeHttpServer.layerTest`，不要为每条错误路径启动完整生产树；
- 需要共享 Bus/Session 与服务器的测试使用 `testEffectShared`，避免事件订阅到另一份 memoMap；
- 不通过源码字符串断言证明路由挂载，必须从真实 HTTP/DOM 行为验证。

**并发测试**：

- active delivery readiness 用 `Deferred`/`Latch`/`BackgroundJob.wait`；
- session busy 用 `SessionStatus.Service.get` + `pollWithTimeout`；
- fan-out completion 等待每个 delivery 的 durable event，而不是等待固定毫秒；
- interrupt/close 断言「本地活动链已停止」与「外部停止是否已确认」分开；
- 任何 `Effect.sleep` 只能用于真正测试时间语义（如 expiry/debounce），不能用于等待 fiber。

### 16.13 错误、兜底、边界和安全门

每个入口都必须把以下情况映射成 typed domain error 或明确的 no-op，不能落成空 500：

1. **身份边界**：`delegationID` 不存在、属于其他 parent Session、其他 Location/Workspace、其他 Meta-Agent context；先授权再查询敏感 participant/external thread。
2. **状态边界**：已经 archived/closed/completed 的 Delegation 不接受普通 append；expired 只能 resume/reconcile，不自动重启外部 thread；deleted 永不作为查询状态返回。
3. **transport 边界**：adapter 缺 control method、版本不匹配、CLI 未安装、spawner 缺失、timeout、malformed stdout、ACP connection 断开；分别返回 unavailable/unsupported/timeout/invalid-output/recovery-required。
4. **持久化边界**：EventV2 commit 失败时不发 wake、不返回已接受；projection 失败不得吞错，聚合仍可通过 replay 重建；重复 command 返回既有结果或 typed conflict。
5. **副作用边界**：provider response 未确认、process 已启动但响应丢失、外部 thread 可能已修改工作树时，不自动 retry；展示 `recovery_required` 并要求 reconcile。
6. **review 边界**：缺 digest、未知 verdict、reviewer 审查旧 revision、findings 超限、敏感内容进入 envelope 时，不能 approved；只保存脱敏摘要和错误码。
7. **日志边界**：日志只允许 delegation/participant/turn IDs、provider 名、状态、错误码和长度受限摘要；禁止完整 prompt、完整 diff、环境变量、Authorization、token、用户文件全文。
8. **并发边界**：同一 Delegation 的 turn admission 串行；不同 Delegation 可并行；同一 Session 的 execution 归 `SessionRunCoordinator`；不能引入全局锁或按 Session ID 参数化 Layer。
9. **兼容边界**：旧 task 调用没有 `delegation_id` 时解析最近活跃委派；旧 external row 多候选时不猜；旧 `meta_agent_step` 只能作为 projection 读，不反向驱动 canonical state。

### 16.14 迁移、回滚与兼容矩阵

| 场景                           | 处理                                             | 不允许                             |
| ------------------------------ | ------------------------------------------------ | ---------------------------------- |
| flag off、旧 task              | 走现有 `task_id`/TaskDriver/CLI resume           | 自动创建 Delegation 或改旧输出语义 |
| flag on、新 Delegation         | 写 EventV2 + 三张 projection，随后 advisory wake | 先启动 provider 再写 durable turn  |
| legacy external row 唯一可识别 | backfill participant binding，并记录来源         | 删除旧 row 或覆盖不同 target       |
| legacy external row 多候选     | `recovery_required`，人工选择                    | 取最新一条「看起来像」的 thread    |
| provider/connection 崩溃       | 记录 delivery failure/recovery                   | 无条件自动重跑                     |
| projection 损坏                | 从 EventV2 replay 重建                           | 把 projection 当真源永久修正事件   |
| 新 API/SDK 发现错误            | 停止新 append，保留历史，回退旧 resume           | down migration 删除已产生历史      |
| app-server 不可用              | SDK/JSONL fallback（只有真实支持的操作）         | 静默丢 steer/archive/fork 选项     |
| 完成后                         | `complete → archive`，历史可查                   | 默认 delete 外部 thread/Session    |

### 16.15 每阶段交付、提交和复审

每个 Phase 一个可回滚 commit，禁止把 0–7 混成一个不可审查的大提交。建议提交序列：

```text
feat(schema): add delegation contracts
feat(core): add delegation aggregate and event fold
feat(core): bind internal build participant
feat(core): bind codex participant and resume
feat(core): add fan-out and revision review barrier
feat(core): add codex control and lifecycle reconciliation
feat(api): expose canonical and legacy delegation routes
feat(app): add persistent delegation projection
fix(core): add restart recovery and compatibility backfill
```

每个提交前必须执行：

```bash
git diff -- <changed-files>
git diff --check
bun --cwd <affected-package> typecheck
bun --cwd <affected-package> test --timeout 30000 <focused-tests>
LINT_BASE_REF=origin/main bun run script/lint-changed.ts
```

涉及数据库时额外执行：

```bash
bun --cwd packages/core migration --check
bun --cwd packages/core test --timeout 30000 test/database-migration.test.ts
```

涉及 API/SDK 时额外执行：

```bash
bun --cwd packages/server typecheck
bun ./packages/sdk/js/script/build.ts
bun --cwd packages/sdk/js typecheck
```

涉及 UI 时额外执行：

```bash
bun --cwd packages/app test
bun --cwd packages/app test:e2e e2e/regression/delegation-persistent-loop.spec.ts
bun --cwd packages/app typecheck
```

若仓库级 `bun run script/format.ts --check` 因本地依赖/脚本解析失败，不得改写文档宣称通过；先用 `node_modules/.bin/prettier --ignore-unknown --check <changed-files>` 得到格式事实，并在 Phase 0 记录该门禁自身的阻塞原因。

**每阶段复查卡片必须输出**：

```text
Phase N 复查结论:
- RED: 哪个断言先红，失败类型是什么：
- GREEN: 哪些 owner 文件使它转绿：
- Persistence: 哪些 EventV2/projection/Session history 断言通过：
- Boundaries: 权限、Location、transport、未知副作用如何处理：
- Regression: 哪些既有测试通过，哪些未运行及原因：
- Diff: 变更文件、生成文件、是否有重复 owner：
- Rollback: 关闭 flag 或回退该 commit 后的行为：
- 是否允许进入下一 Phase：是/否；理由：
```

### 16.16 最终完成闸门

只有以下条件全部满足，ADR-22 才能从 `Proposed` 改为 `Accepted`：

- [ ] Build participant 与 Codex participant 使用稳定句柄，至少两个 Turn 在同一 Delegation 内可追加；
- [ ] Build 产生 revision snapshot，Codex review 明确绑定 revision/change kind；
- [ ] stale review、rejected、malformed envelope、缺 digest 均无法通过 barrier；
- [ ] 无 reviewer 的兼容 Delegation 不死锁；
- [ ] 两个并存 Delegation 在同一 parent Session 下不串台；
- [ ] 事件、projection、Session inbox/history、MetaAgentStep 兼容投影均有持久化断言；
- [ ] restart、timeout、process death、connection loss 不会静默重放未知副作用；
- [ ] interrupt、close、complete、archive、delete 语义和权限分离；
- [ ] canonical server、legacy instance API、SDK namespace、App/TUI projection 均通过行为测试；
- [ ] flag off 与既有 task/CLI resume 回归一致；
- [ ] migration clean/existing database 通过，generated output 无 drift；
- [ ] `git diff --check`、protocol refs、agent protocol cards、affected package typecheck/test、增量 lint 全通过；
- [ ] 每个残余风险进入 `docs/technical-debt.md`，且没有把未实现能力写成已完成；
- [ ] 完成 7 天 soft-expiry 观察期，确认过期委派不会阻塞列表，也不会关闭外部 thread；
- [ ] 由人类确认是否合入 main、是否更新 ADR 状态和是否退役兼容路径。

本计划的最小可交付顺序是：**Phase 1 领域与持久化 → Phase 2 Build → Phase 3 Codex resume → Phase 4 双参与者 review barrier**。Phase 1–4 形成可验证的垂直闭环后，才允许继续做 app-server 控制面、API/UI 和 restart recovery；不得先做 UI 或先扩展 transport，再回头补 durability。
