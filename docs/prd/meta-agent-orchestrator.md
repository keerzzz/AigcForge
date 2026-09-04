# Meta-Agent Orchestrator PRD

> **版本**：v2.1（2026-09-04）
> **状态**：Implementation-ready proposal（当前有效，不是历史文档）
> **需求真源**：本文负责产品目标、用户故事和用户可见行为；领域实现形状以 [ADR-22](../architecture/adr/ADR-22-meta-agent-persistent-delegation.md) 为准，施工顺序以 [唯一实施计划](../plan/meta-agent-persistent-delegation-closed-loop.md) 为准。
> **取证基线**：`CLAUDE.md`、`AGENTS.md`、`ARCHITECTURE.md`、`CONTEXT.md`、相关 package AGENTS、`.aigcfroge/skills/`、当前 V2 源码与测试、以及本机 `codex-cli 0.150.1` app-server schema 快照。

---

## 1. 产品背景

AigcForge 已有 `meta` 作为统一入口，也已有内部 child Session、TaskDriver、外部 CLI adapter、Codex resume、MetaAgentService、EventV2 和 AgentTaskHub。但这些能力目前是**单次任务委派 + 基础续接**，还不是一个可以持续协作、审查、恢复和关闭的产品级委派对话。

目标用户场景是：

```text
用户只与 Meta-Agent 交互

Meta-Agent
  ├─ 委派 Build：修改代码
  └─ 委派 Codex CLI：只读审查 Build 的修改

Meta-Agent 发现新证据
  ├─ 继续向同一个 Build 对话追加任务
  └─ 继续向同一个 Codex 对话追加审查上下文

两者收敛后
  ├─ Meta-Agent 验证完成条件
  ├─ 停止活动 turn
  ├─ 关闭参与者
  └─ 归档完整委派历史
```

## 2. 规范层级与范围

本文是当前有效 PRD，但不直接定义 Core 的表结构、EventV2 聚合字段或 adapter 内部接口。为防止“两个有效文档各自规定一套实现”，规范职责固定如下：

| 文档         | 规范职责                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------ |
| 本 PRD       | 产品目标、用户故事、用户可见行为、发布范围和 UX 结果                                       |
| ADR-22       | Delegation/Participant/Turn/Delivery 领域模型、状态机、事件真源、权限边界和 transport 语义 |
| 唯一实施计划 | TDD 阶段、owner、测试证据、命令、迁移、回滚和提交顺序                                      |
| 源码与测试   | 当前事实基线；实施前必须用它们复核文档声明                                                 |

如果 PRD 的产品目标与 ADR 冲突，需要产品裁决；如果 PRD 的实现形状与 ADR 冲突，先修订 PRD，不允许靠“ADR 默默覆盖 PRD”掩盖冲突。

## 3. 问题定义

### 3.1 当前用户无法可靠管理什么

- 一次委派里同时有哪些内部/外部参与者；
- Build 与 Codex 是否属于同一个长期协作；
- 新证据追加到了哪一个已有对话；
- Codex 审查的是哪一个 Build revision；
- 某个参与者失败后是否可以只重试它；
- 进程重启后任务是在运行、已完成、未知还是需要人工恢复；
- “完成任务”“关闭运行资源”“归档历史”“删除数据”之间的区别。

### 3.2 根因

现有 `task_id`、`external_cli_session`、`meta_agent_step` 和 `BackgroundJob` 分别解决了部分问题，但没有统一的 `Delegation → Participant → Turn` 持久关系。因此继续增加零散字段不能形成闭环。

## 4. 产品目标

### 4.1 P0 目标

1. 创建一个持久 Delegation；
2. 在同一 Delegation 下绑定 Build implementer 和 Codex **只读** reviewer；
3. 两个 participant 都能保留自己的对话历史；
4. Meta-Agent 可以追加多个 turn；
5. 同一份新证据可以使用 `steer` 或 `queue` 意图 fan-out 到多个 participant；
6. Build revision 与 Codex review verdict 必须绑定；
7. Codex 只能批准它实际审查过的、且仍满足 copy policy 的 revision；
8. 失败、取消、超时和 recovery 状态可见；
9. Meta-Agent 可以 interrupt、close、complete、archive；
10. 默认保留历史，delete 只做显式 purge；
11. flag off 时现有 `task_id`、CLI resume 和 `meta_agent_step` 行为不变。

### 4.2 P1 目标

- Codex app-server transport 的 thread/turn 控制；
- 统一委派列表、详情、参与者和 turn UI；
- AgentTaskHub 与 Session Timeline 联动；
- 进程重启后的 safe reconciliation；
- 外部 CLI 工具调用进度和可用控制能力结构化呈现；
- 自建 Agent、Claude Code、Gemini、opencode 复用相同 participant contract；
- 可配置的软过期列表状态。

### 4.3 非目标

- 本期不实现集群级多节点 ownership；
- 不以 PTY 驱动外部 CLI；
- 不让 review verdict 绕过 PermissionV2；
- 不允许 child Session 递归委派；
- 不把项目级 Meta-Agent memory 与 assistant 个人 memory 合并；
- 不一次性删除 V1/V2 compatibility path；
- 不在 Codex SDK 尚未提供 callback 的情况下实现可写 Codex participant；
- 不在本期承诺完整 dark theme、三语和全量窄视口测试矩阵；该矩阵另作为 UI 基础设施任务管理。

## 5. 用户故事与验收标准

### Story A：启动协作

**作为**用户，**我希望** Meta-Agent 能同时启动 Build 和 Codex 两个持久参与者，**以便**一个修改代码、一个独立只读审查。

验收：

- 返回 `delegationID`、两个 `participantID`；
- Build participant 绑定 child Session；
- Codex participant 绑定 external thread，或在尚未启动时明确显示 `pending`；
- 两个 participant 的 role 分别为 `implementer` 和 `reviewer`；
- participant 的 provider/target 可识别，不能依赖 `internal | external_cli` 字段判断类型。

### Story B：持续追加

**作为** Meta-Agent，**我希望**在发现新证据时继续使用原有 Build/Codex 对话，而不是每次新建一次性任务。

验收：

- `appendTurn` 生成新的 durable `turnID`；
- 一个 Turn 可以为多个 participant 生成独立 delivery facts；
- Build 复用原 child Session；
- Codex 复用原 external thread；
- delivery 可以独立成功、失败、重试或进入 recovery；
- 同一 turn 的 evidence digest 可追踪；
- 默认 `steer` 和显式 `queue` 的行为遵守 Session V2 语义，不根据 transport capability 在两者之间猜测。

### Story C：版本化审查

**作为** Meta-Agent，**我希望** Codex 的批准明确对应 Build 的 revision，**以便**不会把旧审查误用于新代码。

验收：

- Build 产出 `revisionDigest`；
- Codex 返回 `reviewedRevisionDigest`；
- digest 不匹配时 review disposition 为 `changes_requested` 或 `outdated`，不是不存在的顶层 `stale_review` 状态；
- `approved` 是否可以复制到新 revision 由 `copyable(changeKind, verdict)` 决定；
- `rejected` 是 Delegation 级阻塞，不能被新 revision 自动清掉；
- 只有最新 revision 的有效 approved 才能通过 completion barrier。

本期 copy policy：

| verdict             |                  `no_change` |             `no_code_change` |                `formatting_only` |                     `rework` |
| ------------------- | ---------------------------: | ---------------------------: | -------------------------------: | ---------------------------: |
| `approved`          |                         复制 |                         复制 | 不复制，本期按 `rework` 保守处理 |                       不复制 |
| `changes_requested` |                       不复制 |                       不复制 |                           不复制 |                       不复制 |
| `rejected`          | 不复制且保持 Delegation 阻塞 | 不复制且保持 Delegation 阻塞 |     不复制且保持 Delegation 阻塞 | 不复制且保持 Delegation 阻塞 |

`formatting_only` 的 formatter 判定属于后续能力；在可靠 formatter service 可用前，必须保守降级为 `rework`，不得把它判断为可复制。

### Story D：失败与恢复

**作为**用户，**我希望**一个参与者失败不会抹掉另一个参与者的结果，并且重启后系统能告诉我是否可以恢复。

验收：

- delivery fact 独立记录 attempt/status/error code；
- safe resume 才允许自动继续；
- 未知副作用进入 `recovery_required`；
- 不因进程重启直接标记 completed；
- HTTP/SDK/UI 提供 retry 和 reconcile 入口；
- 多候选 legacy external thread 不自动猜测。

### Story E：结束协作

**作为** Meta-Agent，**我希望**两个参与者完成后关闭这次委派并保留历史。

验收：

- 关闭前禁止新 turn；
- 活动 turn 先 interrupt/cancel；
- participants 进入关闭终态；
- Delegation 进入 `completed` 或 `cancelled`；
- 默认进入 `archived`，历史仍可读；
- delete 需要显式 purge 权限。

## 6. 产品状态模型

### 6.1 Delegation

```text
draft → running → waiting_review → changes_requested → running
running → approved → closing → completed → archived
running → failed → recovery_required → running | failed | closing
running → cancelled → archived
```

`stale_review` 不属于 Delegation status。`outdated` 是 review receipt 的派生 disposition。

`soft_expired` 也不属于 Delegation status。它是由 `lastActivityAt + expiry policy` 派生的列表/可见性状态；过期不关闭外部 thread，显式 resume/reopen 才能继续。

### 6.2 Participant

Participant 的持久 roster phase 与运行时状态分开：

```text
phase: provisioning → active | failed
active → failed | closed
failed → active（显式 retry 且 reconciliation 通过）| closed

runtime status: running | idle | inactive
```

`recovery_required` 是 delivery/turn 的恢复状态，不是 participant phase。

### 6.3 Turn 与 Delivery fact

一个 Delegation 可以有多个 Turn，一个 Turn 可以为多个 Participant 生成 delivery fact。Delivery fact 保留 attempt/status/result/review 信息，但不铸造独立 `deliveryID`，也不要求独立 projection table；它通过 `(turnID, participantID, deliveryOrigin, senderParticipantID)` 等来源事实折叠和去重。

## 7. 领域模型

### 7.1 Delegation

- 稳定 `delegationID`、标题、父 Session、可选 MetaAgent 关联；
- 总体状态、turn 序号、关闭/归档时间；
- 不保存外部工具权限凭证；
- EventV2 durable aggregate 使用 payload 字段 `delegationID`。
- EventV2 定义固定使用 `durable: { version: 1, aggregate: "delegationID" }`；不得使用 `aggregate: "delegation"` 或把 `parentSessionID` 当作 Delegation aggregate id。

### 7.2 Participant

- `provider`、`target` 与 role；
- child Session ID 或 external thread ID；
- `phase`、最后活动时间和关闭时间；
- transport capability 由 provider descriptor 和可选控制方法派生，不保存平行 capability 布尔表。

### 7.3 Turn

- task/evidence/review/repair/close 类型；
- prompt、evidence digest、revision digest；
- Delegation 内递增 seq 和 durable status。

### 7.4 Delivery fact

- Turn 与 Participant 的连接；
- attempt、status、结果摘要、错误码；
- review verdict、reviewed revision digest 和 review disposition；
- 由 EventV2 `delegation.delivery_*` 事件承载，不对外暴露 `deliveryID`。

## 8. 权限与安全要求

1. Meta-Agent 只能在当前 Session/Location/Product Mode policy 允许的范围内创建 participant；
2. Build 写代码的权限由 Build participant 规则决定；
3. Codex reviewer 默认只读，第一期依靠 `approvalPolicy: "never"`，不是伪造的 PermissionV2 callback；
4. 对具备真实 permission callback 的 transport，外部 CLI 工具调用必须经过父 Session 的 PermissionV2；不具备 callback 的 transport 必须显式保持只读/拒绝，不得声称统一桥接；
5. review approved 不是工具授权，不创建 grant；
6. delegation archive 可由拥有委派的用户执行；
7. delegation purge 默认 deny，需要明确授权；
8. parent Session、Location、Workspace 不匹配时，task_id/externalThreadID 续接必须失败；
9. 日志不输出完整 prompt、token、Authorization、环境变量、完整 diff 和文件正文；
10. malformed review envelope 默认不批准；
11. 模型调用路径必须传递 canonical PermissionV2 source `{ type: "tool", messageID, callID }`，不能用 child Session ID 或 cli target 伪造来源。

## 9. Codex 与外部 CLI 产品能力

### 9.1 能力来源

所有 CLI 继续通过现有 `CliAdapter` 注册表接入。能力不使用平行布尔表：

- provider descriptor 提供启动前可判断的静态能力；
- `control`、`steer`、`interrupt`、`fork`、`archive`、`delete` 等能力由可选方法存在性派生；
- `liveUpdates` 只有存在真实 progress callback/stream 时才可显示；
- 不支持的能力显示为 `unavailable`，但不得把“未实现”降级成假成功。

### 9.2 Codex

本机 `codex-cli 0.150.1` 提供两层能力：

- CLI/SDK：start/resume/one turn；
- app-server：thread/turn 分层、steer、interrupt、fork、archive、delete、状态通知。

AigcForge 分阶段接入：

1. P0 使用现有 SDK/JSONL 实现只读 reviewer 的 start/resume/turn；
2. P1 使用 app-server transport 补充真实 control lifecycle；
3. 版本不匹配时仅降级到实际支持的 SDK/JSONL 操作，并返回 capability/unavailable 状态；
4. 未提供 permission callback 的 Codex SDK 不承担可写 participant。

### 9.3 Claude Code

复用现有 SDK `persistSession: true`、`resume` 和 `canUseTool`，纳入同一个 Participant/Turn/Delivery contract。Claude 特有能力只通过真实 descriptor/可选方法宣告。

## 10. 委派中心与 UI

### 10.1 委派中心

展示：

- Delegation 标题、总体状态、当前 turn；
- Build/Codex participant 的 provider、target、role 和 phase/runtime status；
- 当前 revision、review verdict、review disposition、是否通过 barrier；
- recovery_required、changes_requested、failed、soft_expired 等可解释状态；
- append、steer、queue、interrupt、close、archive、retry、reconcile 操作；
- 不支持的 control 显示 `unavailable`，不渲染成可点击的假成功按钮。

### 10.2 Session Timeline

保留现有 Task card 隐喻，但增加：

- delegation/participant/turn 标识；
- Build/Codex 标签；
- review status/disposition；
- 结果链接；
- 归档后只读展示。

### 10.3 UI 不做的推断

UI 不通过正则解析 summary 推断状态，不通过最近 task 猜 participant，不把 review approved 渲染成 Permission approved，不从缺失字段猜 transport capability。

本期 UI 验收只承诺功能性、错误态、键盘焦点和一个窄视口行为证据；完整 dark theme、三语和全量窄视口矩阵另行建设。

## 11. 非功能要求

- SQLite migration 向前兼容；
- EventV2 replay 与 projection 一致；
- 单一 canonical owner；
- 不同 Delegation 可并发，同一 Delegation command 串行；
- append 必须 durable first；
- 重启后状态可解释；
- 不重跑未知副作用；
- 受影响包 typecheck/test/lint 全绿；
- API/SDK/文档同步；
- 测试报告必须包含真实执行的测试文件、用例计数、pass/fail/skip 和 exit code。

## 12. 发布与回滚

新增 feature flags：

- `AIGCFROGE_EXPERIMENTAL_PERSISTENT_DELEGATIONS=false`；
- `AIGCFROGE_EXPERIMENTAL_DELEGATION_RECOVERY=false`。

保持既有：

- `AIGCFROGE_DISABLE_META_AGENT` 回退 build；
- V1 `task_id`；
- V2 external CLI resume；
- `meta_agent_step` 兼容投影。

关闭新 flag 时，不暴露新的 Delegation command，不改变旧 task/CLI 行为。

## 13. 关联文档

- [ADR-22](../architecture/adr/ADR-22-meta-agent-persistent-delegation.md)
- [唯一实施计划](../plan/meta-agent-persistent-delegation-closed-loop.md)
- [CLAUDE.md](../../CLAUDE.md)
- [AGENTS.md](../../AGENTS.md)
- [ARCHITECTURE.md](../../ARCHITECTURE.md)
- [CONTEXT.md](../../CONTEXT.md)
- [docs/testing.md](../testing.md)
- [External CLI dispatch 历史实施](../plan/external-cli-dispatch-implementation.md)
- [Subagent protocol cards](../plan/subagent-protocol-cards.md)
- [V2 status](../../specs/v2/todo.md)

## 14. 当前实现边界

本文不宣称当前 runtime 已经完成上述闭环。当前源码仍然主要提供基础 child Session/CLI resume 和 MetaAgent step 能力；Delegation aggregate、multi-participant fan-out、revision barrier、recovery、HTTP/SDK/UI 闭环需要按唯一实施计划实施并通过其验收门禁。
