# PRD：Assistant 模式 - 私人主动助手

> 状态：v3 草案，待架构前置条件通过后评审
> 负责人：产品（范围与指标）/ Core（Scheduler 与记忆契约）/ App（Assistant surface）
> 范围：`packages/app` + `packages/core` + `packages/aigcfroge`
> 关联：[ADR-11](../architecture/adr/ADR-11-product-mode-session-classification.md)、[ADR-12](../architecture/adr/ADR-12-product-mode-entry-routing.md)、[ADR-13](../architecture/adr/ADR-13-chat-work-mode-boundary.md)（提出）、[ADR-14](../architecture/adr/ADR-14-persistence-and-scope-strategy.md)（提出）、[ARCHITECTURE.md](../../ARCHITECTURE.md) §4.1/§4.10、[CONTEXT.md](../../CONTEXT.md)
> 最后更新：2026-07-14

---

## 1. 三行摘要

- **做什么**：让用户通过 Assistant 对话创建可恢复的单次提醒；M1 先建设持久 Scheduler 和本地投递闭环。
- **为谁做**：需要跨项目记录个人提醒、又不希望维护常驻会话或复杂自动化的 AigcForge 用户。
- **为什么现在做**：Assistant 已有 Product Mode 入口，但 V2 Session 是有限 Drain；必须先补齐可靠调度，再扩展记忆和跨信道能力。

## 2. 问题与定位

普通 Session 只会在用户输入后运行，无法表达“明天 9 点提醒我跟进客户”。同时，当前 `BackgroundJob` 是 scoped、process-local、非持久任务注册表，进程退出后状态丢失，不能承担定时调度真源。

> 用户任务：提醒我明天上午 9 点跟进客户，并让我能随时查看或取消。

Assistant 是**具有个人上下文和主动触达能力的模式**，但不是常驻 Session。Session 继续遵循 V2 的请求驱动有限 Drain；主动性来自持久 Scheduler 在到期时创建幂等投递，或在后续里程碑中唤醒一次普通 Session Drain。

## 3. 运行语义与架构前提

| 决策 | 当前状态 | 本 PRD 处理 |
|---|---|---|
| Product Mode 与 canonical Session route | ADR-11/12 已接受 | 直接遵循 |
| Assistant 与其他模式边界 | ADR-13 仅覆盖 Chat/Work 且仍为提出 | 本 PRD 自行收窄，不假装边界已接受 |
| 全局落盘策略 | ADR-14 提出 | 使用 `Global.Service.config` 解析根目录，开发前接受或替代该 ADR |
| 持久 Scheduler | 尚不存在 | M0 新建独立领域服务、持久表和恢复循环 |
| 本地通知/收件箱投影 | 尚不存在 | M0 与 Scheduler 一并定义 |

M1 的服务承诺固定如下：

- AigcForge server/desktop 进程在线时，在目标时间附近投递。
- 进程离线时不承诺系统级后台运行；下次启动恢复扫描后补投逾期提醒。
- M1 单进程执行，不声称支持集群；租约用于崩溃恢复和防止同一进程重复认领。
- 不运行心跳 Session，不长期占用 `SessionRunCoordinator`，不改变 V2 process-local Drain 所有权。

## 4. 目标与非目标

### 4.1 M1 目标

- 用户可通过 `mode=assistant` 对话创建、查看和取消单次本地提醒。
- 创建前明确展示提醒内容、绝对触发时间、IANA 时区和离线语义，并要求确认。
- Schedule、认领、重试和 Delivery 均持久化；进程重启后可恢复。
- 到期触发不调用 LLM，直接创建 Assistant 收件箱记录；可用时附加桌面系统通知，但系统通知不作为 M1 成功真源。
- 取消成功后不得投递；同一提醒即使重试也不得产生用户可见重复项。

### 4.2 非目标

- M1 不做常驻 Session、后台心跳、无限循环或“关闭应用仍全天在线”的承诺。
- M1 不做周期 Cron、日报、模型生成跟进、自动执行工具或跨项目检索。
- M1 不做 SOUL/USER/MEMORY 自动写入、FTS5、Curator、技能卡片或 Prompt Cache 改造。
- M1 不做跨模式浮层呼出、飞书/TG/QQ/微信桥接、语音、会议或 WebBridge。
- M1 不使用 `BackgroundJob` 作为调度存储，也不使用不存在的 `sessions_spawn/yield` API。
- M1 不把 EventV2 当作 Schedule 查询和运行状态的唯一存储。

## 5. 用户故事

| 用户故事 | 验收结果 |
|---|---|
| 作为个人用户，我想用自然语言设置提醒，以便不填写复杂表单 | 系统解析后展示标准时间和时区，确认后才创建 |
| 作为跨时区用户，我想知道提醒按哪个时区触发，以便避免时间偏差 | UI 同时显示本地时间、IANA 时区和绝对时间 |
| 作为管理提醒的用户，我想查看和取消待执行提醒 | 列表状态来自持久 Schedule 查询，取消后立即更新 |
| 作为离线用户，我想重启后收到错过的提醒 | 启动恢复后生成一条标记为“逾期补投”的收件箱记录 |
| 作为成本敏感用户，我不希望简单提醒再次调用模型 | 到期路径的 LLM 调用数为 0 |

## 6. M1 产品流程

1. 用户进入 `/mode/assistant` 并显式新建 Assistant Draft/Session。
2. 用户说“提醒我明天 9 点跟进客户”；有限 Session Drain 解析候选提醒。
3. 系统展示内容、目标时间、时区和“离线时下次启动补投”，用户确认后调用 typed Schedule 边界。
4. Scheduler 持久化 `pending` 记录；提醒 tab 立即可查询。
5. 到期扫描器以租约认领记录，在一个持久事务中创建幂等 Delivery/收件箱记录并更新 Schedule。
6. App 在线时刷新收件箱并可选显示系统通知；系统通知失败不回滚已持久投递。
7. 进程重启时扫描逾期 `pending`、过期租约和待重试记录，按相同幂等键补投。

时间有歧义、目标时间已过去或时区不可确定时必须重新确认，不得自行猜测。

## 7. 数据与接口契约

### 7.1 Schedule

M0 新增由 Core owner 管理的持久 Schedule 契约，最小字段如下：

| 字段 | 约束 |
|---|---|
| `id` | 稳定 Schedule ID |
| `sessionID` | 创建它的 Assistant Session |
| `kind` | M1 固定为 `reminder` |
| `content` | 用户确认后的提醒文本 |
| `dueAt` | 规范化绝对时间 |
| `timezone` | 用户确认的 IANA 时区 |
| `status` | `pending`、`running`、`completed`、`cancelled`、`failed` |
| `attempts` / `nextAttemptAt` | 有界重试状态 |
| `leaseOwner` / `leaseExpiresAt` | 崩溃后可恢复的临时认领 |
| `deliveryKey` | 唯一幂等键，跨重试不变 |
| `createdAt` / `updatedAt` | 持久时间戳 |

- Schedule 表是列表、取消和运行状态真源；用户可见 EventV2 记录只能作为审计/会话呈现。
- 创建、查询、取消和认领必须通过 typed Core 服务/API，不允许 UI 或模型直接改表。
- `cancelled`、`completed` 为终态；运行中取消的并发规则必须在 M0 技术设计中以事务测试锁定。

### 7.2 Delivery

- Delivery 以 `deliveryKey` 唯一，保存 Schedule ID、投递时间、逾期标记和可展示内容引用。
- 认领可能是 at-least-once，但唯一约束使用户可见结果幂等；不得声称分布式 exactly-once。
- 收件箱是 M1 可靠投递面；桌面系统通知属于 best-effort 副作用。
- 重试次数和退避上限由 M0 技术设计确定；超过上限进入 `failed` 并向用户显示可重试状态。

### 7.3 Session 协作

- 创建提醒的自然语言解析发生在普通有限 `mode=assistant` Session Drain 中。
- 到期投递不创建 Session、不调用模型、不执行工具。
- M2 若支持“到期后让模型生成日报”，Scheduler 只能提交 durable input 并 advisory wake 普通 Session；每次仍是有限 Drain，并受 IterationBudget 和 Permission 约束。

## 8. 页面与交互

Assistant 复用 ADR-12 的共享 `ModeWorkspace` 和 canonical Session route，不复制 Session 页面。

### 8.1 Mode 首页

- 显示“新建助手对话”、待执行提醒、最近投递和 `mode=assistant` Session 列表。
- 首页不展示尚未实现的记忆摘要、跨信道在线状态或“常驻”指示器。
- 待执行提醒可查看时间、时区、状态并取消。

### 8.2 Session 详情

- 中栏复用消息流和 Composer。
- 右栏 M1 只有“提醒”和“上下文”tab；记忆 tab 到 M2 再出现。
- 提醒 tab 状态必须来自 Schedule 查询，不从对话文本反推。
- 时间确认、取消、错误和逾期状态走 i18n；键盘、焦点、稳定尺寸、明暗主题和窄屏遵循 `DESIGN.md`。

## 9. M2 记忆安全模型

个人记忆在 M1 验证后单独实施，不能简化为三个自动改写的 Markdown 文件。最小记忆记录必须包含：

- 内容、类型、来源 Session/Message、创建者与创建时间。
- `explicit` 或 `derived` 来源、信任等级、敏感等级和适用模式。
- 用户明确写入授权、可见审计记录、撤销/删除和恢复机制。
- 自动提取默认进入待确认状态；外部网页、工具输出和跨信道消息视为不受信来源。
- 敏感信息默认不进入长期记忆；日志、遥测和错误不得输出记忆正文。

“Prompt-Injection 扫描”只能是辅助信号，不能替代来源、授权和审计。透明文件若保留，路径必须相对 `Global.Service.config` 解析（尊重 XDG 与 `AIGCFROGE_CONFIG_DIR`），不得硬编码 `~/.aigcfroge`。

Prompt Caching 仅作为 M2 成本优化：先核验 Assistant System Context 是否在实际 V2 provider request 路径使用现有 cache hint/key，再决定是否扩展；不得把它写成 M1 正确性的前提。

## 10. M3 跨信道前置条件

跨信道桥接必须单独评审 Gateway、鉴权、用户映射、限流、入站去重、持久 outbox、重试、撤销和审计。Webhook 只负责验签与持久接收；处理端通过公开 Session create/prompt/EventV2 能力协作，不模拟或宣称存在 `sessions_spawn/yield`。

任何信道在 PoC 验证 API 稳定性、平台政策和账号风控前不得进入承诺范围。

## 11. 成功指标与埋点

上线前使用 100 个含重启、取消和故障注入的内部提醒建立基线；Beta Gate 如下：

| 指标 | 目标 | 测量方式 |
|---|---|---|
| 有效提醒创建成功率 | ≥95% | 持久可查询 Schedule / 用户确认创建次数 |
| 在线投递及时率 | ≥99% 在到期后 60 秒内 | 在线期间 Delivery 时间减 `dueAt` |
| 离线补投成功率 | ≥99% 在启动后 30 秒内 | 逾期 pending 恢复到 Delivery |
| 用户可见重复投递 | 0 | 同一 `deliveryKey` 的可见记录数超过 1 |
| 取消后误投 | 0 | `cancelled` 后生成 Delivery 的次数 |
| 到期路径 LLM 调用 | 0 | Scheduler worker 的 provider 调用数 |
| 7 日重复创建率 | ≥25% | 首次成功创建提醒后 7 日内再次创建提醒的用户占比 |

至少记录 `assistant_reminder_draft_started`、`assistant_reminder_confirmed`、`assistant_reminder_created`、`assistant_reminder_cancelled`、`assistant_reminder_delivered`、`assistant_reminder_caught_up` 和 `assistant_reminder_failed`；不记录提醒正文。

## 12. 里程碑与优先级

| 阶段 | 范围 | 准入/退出条件 |
|---|---|---|
| **M0 Scheduler** | Schedule/Delivery schema、迁移、租约、恢复循环、typed API | Core/数据库/安全评审通过，时间与崩溃测试完成 |
| **M1 单次提醒** | 对话确认、列表、取消、收件箱、在线投递、离线补投 | Beta Gate 全部达标 |
| **M2 个人记忆** | 显式记忆、来源/信任/敏感等级、检索与删除 | 独立记忆安全设计通过 |
| **M3 主动任务** | 周期计划、有限 Session wake、跨模式呼出 | IterationBudget、幂等和 Permission 设计通过 |
| **M4 跨信道** | 经 PoC 通过的单一信道，再逐个扩展 | Gateway 安全与 outbox 设计通过 |

按 WSJF，Scheduler 与单次提醒优先：它是所有主动能力的公共根基，同时不引入模型成本、工具风险和信道依赖。

### 12.1 成本收益假设

| 假设 | 验证方式 |
|---|---|
| 可靠单次提醒能验证用户是否需要 Assistant 的主动能力 | 观察提醒创建量、投递及时率、取消率和 7 日重复创建率 |
| 主要成本集中在 Scheduler 的事务、恢复和时间语义，M1 到期路径无模型成本 | 记录 M0/M1 工程工作量、故障率和 provider 调用数 |
| Scheduler 可被周期计划和有限 Session wake 复用 | M3 立项前验证不需要替换 Schedule/Delivery 身份与恢复模型 |

若 Beta 用户的 7 日重复创建率低于 15%，或无法连续两周满足投递/补投 Gate，停止记忆和跨信道扩围，优先验证提醒价值与可靠性。

## 13. 灰度、回滚与监控

- 使用 Assistant Reminder feature flag；先内部，再 10% Beta，再全量。
- 关闭 flag 后禁止创建新提醒，但保留列表、取消和已创建提醒的投递；不得遗弃 pending 数据。
- 若出现重复投递、取消后误投、恢复丢失或跨用户数据泄露，立即停止灰度。
- 应用版本回滚必须保持新 Schedule 状态可读；数据库迁移遵循仓库 forward-only 约束。
- Dashboard 监控待执行数量、延迟分布、租约过期、重试、failed 数和重复约束冲突，不采集正文。

## 14. 验收与测试

- 明确时间、相对时间、过去时间、无效时区、夏令时跳变/重复小时和系统时区变化。
- 创建确认、取消、并发取消与认领、重复点击、幂等重试和终态不可逆。
- 认领前/后崩溃、事务失败、进程重启、租约过期、逾期补投和系统通知失败。
- 单进程多个扫描 tick 不重复；同一 `deliveryKey` 只能有一条可见 Delivery。
- 到期路径不调用 LLM、不执行工具；日志和遥测不包含提醒正文。
- Session 保持 `mode=assistant`，URL 使用 canonical Session route。
- 桌面/窄屏、键盘、明暗主题、中文/英文溢出以及空/加载/错误状态。
- 实现后运行受影响包 typecheck/test；时间并发测试使用 TestClock/就绪信号，不使用固定 sleep。

## 15. 批准 Gate

1. Scheduler/Delivery 技术设计明确事务、租约、恢复、重试、取消并发和进程生命周期。
2. ADR-14 被接受或由新的全局持久化决策取代，并与 `ARCHITECTURE.md` 状态一致。
3. 数据库、安全、Core、App 负责人确认 schema、隐私、指标和 Beta Gate。
4. M1 UI 删除“常驻/全天在线/跨信道已连接”等超出实际能力的承诺。
