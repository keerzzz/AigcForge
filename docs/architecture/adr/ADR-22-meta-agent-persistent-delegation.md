# ADR-22：Meta-Agent 持久委派对话与多参与者闭环

> **状态**：Proposed for implementation（2026-09-04 修订；初始决策于 2026-08-31 经先例调研修订）
> **范围**：Meta-Agent、内部子智能体、外部 CLI、Session V2、TaskDriver、EventV2、PermissionV2、AgentTaskHub
> **关联**：[ADR-13 Amendment 2](ADR-13-amendment-2-meta-agent-dispatch.md)、[ADR-14](ADR-14-persistence-and-scope-strategy.md)、[ADR-18](ADR-18-custom-mode-workflow-execution.md)、[ADR-20](ADR-20-scoped-grant-model.md)、[统一实施计划](../../plan/meta-agent-persistent-delegation-closed-loop.md)
> **事实基线**：当前源码与测试；本机 Codex CLI `0.150.1` app-server schema；仓库 `@openai/codex-sdk@0.146.0`；先例调研见 §6

## 1. Context

当前系统已经具备以下基础能力：

- V2 `task` 创建内部 child Session，并可通过 `task_id` 续接；
- `TaskDriver` 支持前台、后台、后台追加、取消和中断；
- 外部 CLI 支持 JSONL、SDK、ACP 三类 transport；
- Codex SDK/JSONL 已有 `start/resume`，`external_cli_session` 可保存外部会话 ID；
- Claude SDK 使用 `persistSession: true`、`resume` 和 `canUseTool`；
- `meta_agent_step` 能记录部分内部/外部委派步骤；
- EventV2、SessionInput、SessionExecution、SessionRunner 已提供持久输入、会话历史与执行协调；
- Codex app-server 暴露 thread/turn 分层能力：`thread/start|resume|fork|archive|delete`、`turn/start|steer|interrupt` 和状态通知。

这些能力仍不是完整的持久委派闭环。`task_id` 与 `external_cli_session` 是两套续接键；`meta_agent_step` 是观测记录而非聚合根；`BackgroundJob` 是进程内运行资源而非 durable truth。系统无法严格表达：

1. Meta 同时委派 Build 修改代码和 Codex 审查同一 revision；
2. Meta 发现新证据后向两个已有对话追加同一个新 Turn；
3. Codex 的批准必须对应最新 Build revision；
4. 单参与者失败或进程重启后可安全恢复或人工接管；
5. 完成后依次 interrupt、close、archive，而不是只结束一个 tool call。

## 2. Decision

### 2.1 `Delegation` 是唯一委派聚合根

新增 Core `DelegationService` 作为唯一写入者，不新增第二 Tool 表示、第二 CLI registry、第二 Session transcript 或第二 LLM tool loop。

```text
Delegation
  ├── Participant(build, implementer)
  │     └── internal child Session
  ├── Participant(codex, reviewer)
  │     └── external Codex thread
  └── Turn 1..N
        ├── evidence/revision binding
        ├── per-participant 投递（事件承载，见 §2.6）
        └── result/review receipt
```

一次 `task` tool call 不等于一个 Delegation；一个 Delegation 可包含多个参与者和多个 Turn。

**Delegation 铸造独立的 branded ID，不复用 `parentSessionID`。** 这是本 ADR 唯一一处主动"新增"，理由必须写明，否则未来会有人以极致减法的名义把它简化回去并撞上共享 barrier：

1. **委派活得比对话轮次长，而对话继续往下走。** §2.6 的核心就是委派跨轮次存活：创建 D1 → 后续某轮发现新证据 → 追加 Turn → 再后来关闭。那么下一轮用户输入发生时 D1 仍然开着；若该轮又需要委派，同一父 Session 下就有两个开着的委派。这不是并发偏好，是本 ADR 前提的必然结果。
2. **completion barrier 是按委派计算的**（§2.5）。两件独立工作若共享一个 Delegation 就共享一个完成条件，一件卡住另一件永远无法收尾。
3. **事件流隔离。** 事件定义中的 `aggregate` 是载荷里充当聚合 id 的字段名（session 事件用 `sessionID`），而 `event_sequence.aggregate_id` 是主键、一个聚合一个单调序号。若委派用 `parentSessionID` 作聚合，委派事件会与 session 事件落进同一序号空间并交错，把委派生命周期与会话流水焊在一起。
4. 成本是一个 `Schema.brand` 字符串，不是一个子系统。

**为什么先例不适用**：调研中的 team 实现（§6.1）把 team 身份直接定为 root SessionId 加一个 brand，不铸造新 id。那能成立是因为在其模型里**一个 root session 恰好一个 team 是构造出来的 1:1 约束**；本仓 Meta 是长期对话，1:1 不成立。

### 2.2 Thread、Turn、投递 分离

- **Delegation**：长期协作容器，拥有稳定 ID、参与者、总体状态、关闭与归档语义；
- **Participant**：一个内部 child Session 或外部 CLI thread；
- **Turn**：一次 task/evidence/review/repair/close 命令；
- **投递**：一个 Turn 投递给一个 Participant 的执行记录，**由事件承载而非独立投影表**（§2.6）。

新证据必须先持久化为 Turn，再投递；不能覆盖旧 prompt 或只修改内存状态。

### 2.3 内外参与者统一建模

Participant 至少包含：

- `provider`: 注册表中的 provider 名称（内部 child Session、ACP、Codex、Claude Code 各是一个 provider）；
- `target`: Agent/CLI 名称；
- `role`: `implementer | reviewer | approver | observer`；
- `context`: `fresh | fork`（子会话是新建还是从父会话分叉）；
- `childSessionID?`；
- `externalThreadID?`；
- **roster phase** 与 **runtime status** 两个独立字段（见下）；
- `lastActivityAt`、`closedAt`。

不设 `kind: internal | external_cli` 字段。内外差异是 **provider 行为差异，不是数据属性**：把它写成字段会诱导调用方按字段分支，而正确做法是按 provider 名解析到实现。参见 §6 先例。

**phase 与 status 必须分开，且 status 不得回写 phase：**

| 字段                      | 取值                                               | 语义                                                           |
| ------------------------- | -------------------------------------------------- | -------------------------------------------------------------- |
| `phase`（roster，持久）   | `provisioning` → 恰好一个终态 `active` \| `failed` | 名册事实。单调，只前进                                         |
| `status`（runtime，派生） | `running` \| `idle` \| `inactive`                  | 瞬时运行态。由 Activation 存在与否派生，**永不写库覆盖 phase** |

合成一个字段（如 `pending|running|idle|failed|closed`）会让一次心跳把终态冲掉——`failed` 的 participant 被一个迟到的 `running` 覆盖后无法复原。

**capability 不设独立的 capabilities 字段包。** 两段机制：

- **start-time 能力**（一次性 run 需要的）：provider 上的静态 descriptor，service 在 run 存在之前检查，缺失即 typed error 大声拒绝，禁止「接受后忽略」；
- **continuation 能力**（续接/steer/fork/archive）：**可选方法的存在本身就是能力**，用 TypeScript narrowing 发现，不再维护一份平行的布尔表。

理由：布尔表和方法实现是两份真源，必然漂移，且没有任何门禁能发现漂移。

`task_id`、`external_cli_session`、`meta_agent_step` 在迁移期保留为兼容输入/投影，但新代码不得依靠“最近 active 行”推断 participant 身份。

### 2.4 EventV2 是事件真源

委派生命周期使用 EventV2 durable aggregate；Drizzle 表是查询投影。事件与投影更新遵循现有 `EventV2.publish(..., { commit })` 同事务模式。

所有 Delegation 事件固定使用：

```ts
durable: {
  version: 1,
  aggregate: "delegationID"
}
```

事件 payload 必须包含 `delegationID`。`aggregate: "delegation"`、payload 字段 `delegation`、或复用 `parentSessionID` 作为 Delegation aggregate id 均禁止；前者会让 EventV2 聚合字段与 payload 语义漂移，后者会把 Session 与 Delegation 事件焊进同一序号空间。

禁止 handler、adapter、UI 直接写委派表；禁止以内存 Map、日志文本或 BackgroundJob 状态作为唯一真源。

### 2.5 Review 与 Permission 分离

Codex `approved` 是代码审查结论，不是 PermissionV2 grant，也不是人类批准。

- review 必须携带 `reviewedRevisionDigest`；
- PermissionV2 继续是本地工具、SDK callback、ACP `request_permission` 的最终授权边界；
- review envelope 缺失、不可解析或 digest 缺失时，fail closed 为 `changes_requested`；
- Codex reviewer 默认只读，不能因 review 通过获得写权限。

**批准的存活由 change kind 决定，不是「digest 不等就作废」。** 采用 Gerrit 的 sticky-approval 模型（§6）：新 revision 产生时，计算它与被审 revision 之间的 change kind，再按 `copyable(changeKind, verdict)` 的固定默认表决定旧结论是否复制到新 revision。未被复制的批准 receipt 标记为 `outdated`；`outdated` 是 receipt disposition，不是 Delegation/Turn/Participant 顶层 status。

| verdict             | `no_change` | `no_code_change` |                `formatting_only` | `rework` | 处理                                          |
| ------------------- | ----------: | ---------------: | -------------------------------: | -------: | --------------------------------------------- |
| `approved`          |        true |             true | false（本期保守降级为 `rework`） |    false | 仅复制明确允许的 receipt                      |
| `changes_requested` |       false |            false |                            false |    false | 永不复制，保留当前 revision 的 finding        |
| `rejected`          |       false |            false |                            false |    false | 永不复制，并建立 Delegation 级 sticky blocker |

`formatting_only` 只有在未来存在可靠 formatter service 且另有明确启用裁决时才可成为正向 copy 条件；本期没有该能力时必须降级为 `rework`，不得靠空白/启发式猜测。

二元比较（任何改动即作废）是 GitHub `dismiss stale approvals` 的档位；本 ADR 不采用它，但也不把没有 formatter 证明的改动误判成可复制。

**批准与否决的粘性不对称：**

- `approved` 是 **revision 级**：按上表复制或标记 `outdated`；
- `changes_requested` 是 revision 级，但永不复制，必须在聚合状态里可见，直到对应 finding 被回应；
- `rejected` 是 **Delegation 级**：跨 revision 持续阻塞，必须由 reviewer 显式 `retractRejection` 或具备权限的人工 override 清除，不能被下一个 revision 悄悄洗掉；该命令必须产生审计事件。

`soft_expired` 是由 `lastActivityAt + expiry policy` 派生的列表/可见性状态，不进入任何顶层 status union；过期不关闭外部 thread。

不设这个不对称，一条 blocking finding 会被下一轮 revision 自动清掉。

### 2.6 中途追加使用 durable Turn + 一个 inbox

1. `appendTurn` 先持久化 Turn；
2. durable commit 后才唤醒 participant；
3. 每次投递独立记录 attempt 和终态；
4. 单个投递失败不覆盖其他参与者的结果；
5. 聚合状态由 service 根据投递终态与 review barrier 计算。

**投递意图是消息属性，不是 transport 能力查询。** 每条投递声明 `delivery`，沿用 AGENTS.md 已有的 `steer | queue` 词汇：

| `delivery` | 语义                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------- |
| `steer`    | 默认追加；durable admit 后，在当前 drain 仍需继续时于下一个安全 provider-turn 边界 promote。工具执行中不得强行打断。 |
| `queue`    | 显式排队；保持 pending，直到 Session 将要 idle 时才 promote 一条，再重新评估 continuation。                          |

调用方声明意图，运行时决定在安全边界满足它；不得先查询 adapter capability 再把 `steer` 隐式改成 `queue`。

**按目标活性路由，三条路径而不是两条：**

| 目标状态                                       | 处理                                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| 有活动 Activation，处于安全 provider-turn 边界 | 按 `steer` 意图 promote；`queue` 仍保持 pending                                     |
| 有活动 Activation，正在工具执行中              | `steer` 在工具边界后领取；`queue` 继续 pending                                      |
| **无 Activation（进程已退出）**                | **cold resume 重建 Activation；`steer` 在安全边界 promote，`queue` 等到 idle 语义** |

第三条是原设计缺失的。participant 的执行进程消失后，原设计只能排队等一个永不到来的唤醒，或直接失败。

**投递的至多一次由被投递物自身携带来源保证，不引入独立 idempotency 表。** 目标侧在 pending inbox item 和最终落库的消息上都保留 `{ turnID, deliveryOrigin, senderParticipantID }`；把这个来源在 inbox 与历史上做 fold 就是去重键。恢复邮箱 = **已入队 − 已确认落库**，不需要为「投递中」再造一个状态。

**投递不建独立投影表。** 投递事实由 `delegation.delivery_*` 事件承载，聚合状态用**增量折叠**计算：活跃委派的折叠状态随 Activation 生命周期驻留、随新事件增量推进；冷启动时借 `event_aggregate_type_seq_idx`（`aggregate_id, type, seq`）一次性折叠。

理由：EventV2 是真源，Drizzle 表只是投影（§2.4），所以"要不要这张表"是**查询形状问题，不是真源问题**。投影可随时 drop 重建，因此推迟到有实测需求时再加，风险远低于现在猜一个形状——而形状取决于尚未编写的列表页 UI。先例（§6.1）同样不为 continuable 子会话的每轮创建包装对象。

两条配套约束，否则形状会被 API 提前固化：

- Service API **不得出现按投递分页的签名**（如 `listDeliveries(turnID)`）。API 形状比表结构更难改，因为它跨 SDK 和 UI；
- barrier 必须实现为**吃折叠后状态的纯函数**，不吃数据库句柄。这样将来若加投影表，barrier 一行不用改。

技术债与触发条件记入 `docs/technical-debt.md`。

### 2.7 生命周期分层

- `interrupt`：停止当前活动 Turn；
- `close`：**关闭准入**（拒绝新 Turn），再处理活动投递；
- `complete`：满足 barrier 后进入业务完成态；
- `archive`：保留历史，移出活跃列表；
- `delete`：显式 purge，默认 deny。

正常完成默认 `close → complete → archive`，不执行 delete。

**`interrupt` 的语义逐条写死，不留给实现猜：**

1. **保留 inbox**：中断只停当前 turn，不清空目标的待处理队列。目标重新达到安全边界或 idle 后，按原始 `steer`/`queue` 意图恢复推进；
2. **不等静止**：`interrupt` 授权后立即返回，不等目标进入终态。需要等静止的调用方自己用就绪信号等；
3. **已领取批次不重排**：已被当前 turn 领取的输入不退回队列。中断是至多一次，不是回滚；
4. **缺失目标是幂等 no-op**：目标未知、是一次性 run、或已结算，都返回成功而不是报错。这让重试安全；
5. **授权先于查找**：父子地址不匹配、调用方不在目标活跃祖先链上，返回 typed `UNAUTHORIZED`；陈旧祖先句柄和自指请求在查找目标之前就拒绝。

**`close` 的顺序是「关准入 → 逐个处置 → 子先于父」**：先关闭新 Turn 准入，再处置已准入的投递，释放句柄时子参与者先于父参与者。持久 child Session 必须存活于这次进程内拆除。

**放弃与归宿必须有人负责，不能只依赖用户显式关闭。** 用户提出需求后离开是常态；委派一旦长命（§2.1），没有归宿策略就会累积僵尸委派并污染列表页：

- `complete` 之后**默认自动 `archive`**，不要求用户手动归档；
- 用户从未收尾的委派不得停留在活跃列表：达到闲置阈值后进入一个**可解释的过期态**（不是静默删除，也不是伪装完成），在 UI 上与"正在进行"区分；
- 过期不等于关闭外部线程——外部 CLI 的线程可能仍可由 CLI 自身恢复，过期只解除 AigcForge 侧的活跃绑定；
- 具体阈值、过期态命名和 UI 呈现由施工计划的 Phase 6 定，但**必须在 Phase 6 出口前定**，不能留到灰度期再补。

### 2.7.1 当前委派解析：交互必须单焦点

允许同一父 Session 存在多个委派（§2.1），**但交互不得要求用户或模型报 ID**。

- `task` 工具缺少 `delegation_id` 时，解析到该父 Session **最近活跃的委派**，而不是新建一个；
- 只有在没有活跃委派、或调用方显式要求新建时才创建；
- 「最近活跃」的判据必须是持久事实（最后一次投递或 Turn 的时间），不是内存状态；
- 解析结果必须回写到 tool output，让 UI 和后续轮次能确认落在哪个委派上。

不定这条规则的后果是具体的：委派长命之后，"缺 ID 就新建"会在每一轮持续造出新的空委派；而若改成向模型索要 ID，模型就会开始猜 ID。

### 2.8 故障恢复不盲目重跑未知副作用

**先把「持久」和「进程内」命名分开。** 一个 participant = **一个持久 child Session / external thread**（跨重启存活）+ **至多一个进程内 Activation**（重建出的执行常驻期）。Activation 不是请求、不是结果、不是取消、也不是 Turn：它可以执行多个 FIFO turn，并在它派生的后代仍在运行时保持常驻。

`BackgroundJob` 是 Activation 层的东西，**永远不是恢复真源**。给这一层单独命名的目的就是让人不可能把它当持久态用。

进程重启时：

- `dispatching/running` 投递先进入 `recovery_required`；
- 仅在 provider 声明可恢复且具有可靠 thread/idempotency 信息时自动 resume；
- provider、shell、文件写入、MCP 等不确定副作用不得静默重跑；
- 内部 participant 从 SessionInput/Session history reconciliation；
- 外部 participant 从 external thread reconciliation；
- 无法证明安全时显示 failed/recovery_required，等待人工 retry/fork/close。

**明确承认持久化成功是不可证明的。** 结算时等待 flush，但**不把 flush 的返回值当作「已落盘」的证明**——任意监听者无法证明持久化后端真的存储了状态。因此：

- flush 失败只记录，不让 Activation 失败；管理器仍然释放句柄和所有权；
- **后果写进文档而不是假装保证**：下一次 resume 可能读到缺失或陈旧的 child 状态，恢复路径必须能处理这种情况，而不是断言它不会发生；
- 这也意味着「durable commit 后才唤醒」的提交点定在**输入被受理**（拿到消息 id），不是定在「确认写入日志」——后者等不到可信答复。

失败前的任何一步都必须全额回滚：不返回半个 id，销毁已创建的句柄，回滚 Activation 与父子所有权。

### 2.9 复用现有 owner

- 内部：复用 SessionV2、SessionInput、SessionExecution、TaskDriver；
- 外部：复用现有唯一 `CliAdapter` registry，按 provider 名解析，不新建第二注册表；
- Codex app-server 是可选增强 transport，不替代 SDK/JSONL fallback；
- 第一阶段 Codex SDK/JSONL 只读 reviewer；app-server/ACP control 才承担 interrupt/archive/fork 等可选控制；
- Meta prompt、Claude 协议文本、protocol card 是软约束；
- PermissionV2、状态机、Schema 和 review barrier 是硬约束。

### 2.10 PermissionV2 桥的真实覆盖面

**不得声称「外部 CLI 的工具调用统一经过 PermissionV2 桥」。** 代码核实（2026-08-31）的实际覆盖面：

| transport                          | PermissionV2 缺失时                                                 | PermissionV2 存在时                                                                   |
| ---------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| ACP（claude-code-acp / codex-acp） | deny                                                                | 正常桥接                                                                              |
| claude-code SDK                    | **不 deny**，传 `undefined` 后退回 Agent SDK 自身的 permission mode | 正常桥接                                                                              |
| **codex SDK**                      | 无条件 deny                                                         | **桥不存在**：`execute` 不接收 `canUseTool`，`approvalPolicy: "never"` 无条件自动拒绝 |
| jsonl                              | 无桥                                                                | 无桥                                                                                  |

处理结论：

- Codex reviewer 的**只读性**由 `approvalPolicy: "never"` 保证，这一点成立，可以作为 §2.5「reviewer 默认只读」的实现依据；
- Codex SDK 的 `execute` 没有 `canUseTool` callback，Phase 1–4 不新增伪造的 PermissionV2 bridge；可写 Codex 不属于当前 SDK 能力，留给 app-server/ACP control 或后续明确的 SDK 能力；
- JSONL 同样不宣称拥有 PermissionV2 bridge；Claude SDK 与 ACP 按各自真实 contract 测试；
- `ARCHITECTURE.md §4.11` 已于 **2026-09-03** 按 transport 修正，本 ADR 不再要求重复修复它；
- 对具备 callback 的路径，必须传递父 task invocation 的 canonical source `{ type: "tool", messageID, callID }`；HTTP/UI 直连不能伪造这个 source。

## 3. Consequences

### Positive

- Build 与 Codex 可在一个 Delegation 下持续多轮协作；
- 新证据可追踪、可重试、可 fan-out；
- review 绑定 revision，避免过期批准；
- close/archive 不再与杀进程或删除历史混淆；
- 可逐步迁移，不需要一次性重写 TaskDriver、Session 或 adapter。

### Costs

- 新增 Delegation/Participant/Turn 三张投影表、migration、service 和 EventV2 聚合；投递不建表（§2.6）；
- 需要兼容映射 `task_id`、`external_cli_session`、`meta_agent_step`、`session_task`；
- Codex SDK/JSONL 不具备全部 app-server 控制能力，必须 capability negotiation；
- Codex SDK/JSONL 的只读限制需要 adapter contract test；不存在的 PermissionV2 callback bridge 不列为本期实现目标（§2.10）；
- change-kind 判定需要一个可信的「这次改动是不是实质改动」的计算，比二元 digest 比较贵；
- 重启恢复扩大测试面，且跨进程 lease/fencing 仍是后续任务；
- HTTP、SDK、App、Session UI、TUI 和文档必须同步。

## 4. Rejected Alternatives

1. **继续只扩展 `task_id`**：无法表达多 participant、review barrier 与统一 close；
2. **把 external thread ID 塞进 `meta_agent_step`**：step 是观测，不是聚合根；
3. **每次新证据新建一次性 task**：丢失持续对话和 revision 对齐；
4. **Meta 轮询 BackgroundJob**：进程重启即丢；
5. **Codex approved 绕过 PermissionV2**：混淆 review 与 authorization；
6. **一次性删除 V1/V2 兼容路径**：会破坏现有 composition root 和客户端；
7. **建立万能 TurnMiddleware**：重复现有 SessionRunner/TaskDriver/EventV2 边界；
8. **在 Participant 上加 `kind: internal | external_cli`**：内外差异是 provider 行为差异，字段化会诱导调用方按字段分支（§2.3）；
9. **维护一份平行的 capabilities 布尔表**：与方法实现是两份真源，必然漂移且无门禁可查（§2.3）；
10. **把 steer/queue 做成 transport 能力查询**：调用方要先问 adapter 才知道怎么发消息；正确做法是消息自带 `delivery`（§2.6）；
11. **`reviewedRevisionDigest` 二元比较**：一次 formatter 就作废刚拿到的批准，制造无意义轮次（§2.5）；
12. **把 flush 返回值当作已落盘的证明**：任意监听者无法证明持久化后端存储了状态（§2.8）；
13. **复用 `parentSessionID` 作为委派身份**：两件独立工作会共享 completion barrier，一件卡住另一件无法收尾；且委派事件会与 session 事件共用一个单调序号空间（§2.1）；
14. **为投递建独立投影表**：投影形状取决于尚未编写的列表页 UI，而投影可随时 drop 重建，因此推迟到有实测需求（§2.6）；
15. **`delegation_id` 缺失即新建委派**：委派长命之后这条规则会每轮持续造出空委派；正确做法是解析到最近活跃委派（§2.7.1）；
16. **向模型索要 `delegation_id`**：模型会开始猜 ID；交互必须单焦点（§2.7.1）。

## 5. Acceptance Gate

ADR 转 `Accepted` 前必须满足以下 Gate。Phase 是实施计划中的首次 RED/最终证据位置；工程质量门和 UI 后续质量任务不得被误写成领域决策已经完成。

| Gate ID | 必须为真                                                                                                                                                 | 来源 / 证据位置                     |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| G1      | Schema、状态机、branded ID、EventV2/API contract 有红测试；每个 Delegation EventV2 使用 `durable.aggregate: "delegationID"` 且 payload 有 `delegationID` | §2.1/§2.4；计划 Phase 1/6           |
| G2      | Build + Codex 至少两轮 append/review/repair 集成测试通过                                                                                                 | §2.5；计划 Phase 4                  |
| G3      | `copyable(changeKind, verdict)` 对 approved/changes_requested/rejected 与四种 change kind 有 Schema 默认值；本期 `formatting_only` 保守降级，不误复制    | §2.5；计划 Phase 1/4                |
| G4      | `rejected` 跨 revision sticky 阻塞，只有显式 `retractRejection`/授权人工 override 能清除                                                                 | §2.5；计划 Phase 1/4/6              |
| G5      | roster phase 与 runtime status 分离，迟到 heartbeat 不能覆盖失败终态                                                                                     | §2.3；计划 Phase 1/2                |
| G6      | barrier 按 role 计算、无 reviewer 不死锁、同父 Session 的多个 Delegation 隔离；缺 `delegation_id` 解析最近活跃而非新建                                   | §2.1/§2.7.1；计划 Phase 1/2         |
| G7      | `steer` 默认追加与显式 `queue` 语义固定；不引入第二套投递词汇，也不根据 transport capability 在二者之间隐式转换                                          | §2.6、Rejected 10；计划 Phase 2/4/5 |
| G8      | cold-resume-then-steer、interrupt 五条语义、close 顺序、子先于父、flush 不可证明后的恢复路径有测试                                                       | §2.6–§2.8；计划 Phase 4/5/7         |
| G9      | participant 失败、取消、超时、连接丢失、重启恢复不静默重跑未知副作用                                                                                     | §2.8；计划 Phase 3/5/7              |
| G10     | Review 与 PermissionV2 分离；Codex SDK/JSONL 第一阶段只读；不要求不存在的 Codex SDK callback bridge                                                      | §2.5/§2.10；计划 Phase 3/5          |
| G11     | complete/close/archive/purge 分离；complete 默认 archive；soft-expired 是派生可见性状态且不关闭外部 thread                                               | §2.7；计划 Phase 5/6/7              |
| G12     | `retry`、`reconcile`、`retract-rejection` 有 HTTP/tool/SDK contract；无 `listDeliveries(turnID)` 或 `deliveryID` 对外 API                                | PRD；计划 Phase 5/6                 |
| G13     | migration/schema snapshot、legacy compatibility、API/SDK 生成、受影响包 typecheck/test/lint、HTTP exercise 和功能性 UI E2E 通过                          | 工程门；计划 Phase 0/1/6/7          |
| G14     | flag off 保持旧 task/CLI resume/MetaAgentStep/AgentTaskHub baseline；观察期后再决定退役兼容路径                                                          | PRD；计划 Phase 7                   |
| G15     | 本期 UI 仅要求功能、错误态、焦点和一个窄视口证据；完整 dark/i18n/全量窄视口矩阵列为后续 UI 基础设施任务                                                  | PRD；计划 Phase 6                   |
| G16     | PRD、ADR、计划、testing.md、technical-debt.md 与生成物/历史文档的引用链和规范词汇一致                                                                    | 文档门；计划 Phase 0、脚本 gate     |

## 6. Prior Art

2026-08-31 调研（约 30 个开源项目 + 协议与评审工具）。以下是本 ADR 直接借用的先例；未列出的项目基本是并行 worktree / tmux 会话管理器，解决隔离与并行，不解决持久委派。

### 6.1 DeepSeek Harness（`deepseek-ai/deepseek-harness`，MIT，developer preview）

同类问题中最完整的公开实现，其 `ctx.subagents` 与实验性 `ctx.agentTeams` 与本 ADR 高度重叠。文档级核实（未读源码），借用点：

| 借用                                                                                            | 出处                          |
| ----------------------------------------------------------------------------------------------- | ----------------------------- |
| provider 注册表统一内外（in-process spawn/fork、ACP、Codex、Claude Code 同一接口）              | `docs/subsystems/subagent.md` |
| start-time 能力用静态 descriptor 提前大声拒绝；continuation 能力用可选方法存在性 + TS narrowing | 同上                          |
| durable child Session + 至多一个进程内 Activation 的命名切分                                    | 同上                          |
| `delivery: steer \| queue`；恢复邮箱 = 已入队 − 已确认                                          | `AGENTS.md` / 本 ADR §2.6     |
| roster phase 与 runtime status 分离，后者永不回写前者                                           | 同上                          |
| `interrupt` 的 keepInbox / 不等静止 / 已领取不重排 / 缺失即 no-op / 授权先于查找                | `docs/subsystems/subagent.md` |
| 承认 flush 返回值不构成持久化证明，把后果写进文档                                               | 同上                          |
| 「continuable 路径不创建包装对象」促使重新评估 Delivery 是否独立成表                            | 同上                          |

其 `dsh --profile acp` 提供 ACP server，可用本仓现有 ACP transport 直接对接，作为独立于本 ADR 的低风险验证项。

### 6.2 Gerrit（sticky approvals）

§2.5 的 change-kind + copy-condition 模型来自 Gerrit label 配置：approval 存储为 (change, patch set, account, label)，新 patch set 上传时按 `copyCondition` 查询决定是否复制，未复制者标记 **outdated**；`changekind:` 支持 `NO_CHANGE` / `NO_CODE_CHANGE` / `TRIVIAL_REBASE` / `REWORK` 等；Code-Review 标签默认 `TRIVIAL_REBASE`，Verified 标签默认 `NO_CODE_CHANGE`；`-2` 是 change 级、跨 patch set 阻塞——这条给了 §2.5 的批准/否决不对称。

GitHub 的 `dismiss stale pull request approvals` 是同一问题的粗档位：锚点是 diff 而非 SHA，**无 trivial 改动豁免**，任何影响 diff 的推送即作废。本 ADR 原设计等价于这一档。

### 6.3 Microsoft Conductor（反向立场，记录以备对冲）

`microsoft/conductor` 的核心设计是 **「No LLM in the orchestration loop」**：YAML 声明 workflow，Jinja2 表达式路由，first match wins，人工闸门是一等步骤类型，`conductor guide --text` 提供 mid-run steering，`conductor replay` 重放已完成 run。

它证明本 ADR 想要的 fan-out、人工闸门、mid-run steering 在「不把 LLM 放进编排回路」的前提下也能实现，代价是必须预先声明 workflow。本 ADR 仍选择 LLM-in-loop（Meta 需要应付未声明的协作形态），但施工计划的方案对冲章节必须显式记录这条第三路线，不能只在两个 LLM-in-loop 选项之间比较。

### 6.4 无先例的部分

**审查结论绑定代码 revision，全行业没有 agent 项目实现。** 核实过 `ultraswarm`（有 `stale_base` 基线漂移检测，但不是审查绑版本）、`vnx-orchestration`（ADR-008 的 contract hash 绑的是审查契约不是代码树）、`araozmd/multi-cli-orchestrator`（缓存按 PR 号而非 commit，README 自己把 verdict-to-SHA 绑定留空）。这是本 ADR 相对现有生态的领先点，也因此没有可抄的实现——§2.5 必须自建，且必须有测试。
