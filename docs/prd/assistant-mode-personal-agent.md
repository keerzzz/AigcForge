# PRD：Assistant 模式 - 私人主动助手

> 状态：v4 草案，待架构前置条件通过后评审
> 负责人：产品（范围与指标）/ Core（Scheduler、记忆与知识库契约）/ App（Assistant surface）
> 范围：`packages/app` + `packages/core` + `packages/aigcfroge`
> 关联：[ADR-11](../architecture/adr/ADR-11-product-mode-session-classification.md)、[ADR-12](../architecture/adr/ADR-12-product-mode-entry-routing.md)、[ADR-13](../architecture/adr/ADR-13-chat-work-mode-boundary.md)、[ADR-14](../architecture/adr/ADR-14-persistence-and-scope-strategy.md)、[ADR-15](../architecture/adr/ADR-15-mode-workspace-main-area-slot.md)、[ARCHITECTURE.md](../../ARCHITECTURE.md) §4.1/§4.10、[CONTEXT.md](../../CONTEXT.md)
> 关联调研：[双向链接与防幻觉机制调研](../research/agent/AigcForge-双向链接与防幻觉机制调研.md)、[个人笔记与知识库竞品调研](../research/agent/个人笔记与知识库竞品调研.md)、[个人助手智能体功能调研](../research/agent/个人助手智能体功能调研.md)
> 最后更新：2026-08-11

---

## 1. 三行摘要

- **做什么**：让用户通过 Assistant 对话完成「主动事项管理 + 长效上下文管理」——创建可恢复的定时提醒、沉淀个人记忆与笔记知识库、通过对话生成结构化笔记产物。
- **为谁做**：需要跨项目记录个人提醒、维护个人知识库、又希望用自然语言驱动一切、不愿维护常驻会话或复杂自动化的 AigcForge 用户。
- **为什么现在做**：Assistant 已有 Product Mode 入口（ADR-11/12 已接受），但 V2 Session 是有限 Drain；必须先补齐可靠调度与本地投递闭环，再扩展记忆、笔记知识库和跨信道能力。

## 2. 问题与定位

普通 Session 只会在用户输入后运行，无法表达“明天 9 点提醒我跟进客户”。同时，当前 `BackgroundJob` 是 scoped、process-local、非持久任务注册表，进程退出后状态丢失，不能承担定时调度真源。

> 用户任务：提醒我明天上午 9 点跟进客户，并让我能随时查看或取消。把我的重要结论记进个人笔记，下次能直接问我之前是怎么处理的。

Assistant 是**具有个人上下文和主动触达能力的模式**，但不是常驻 Session。Session 继续遵循 V2 的请求驱动有限 Drain；主动性来自持久 Scheduler 在到期时创建幂等投递，或在后续里程碑中唤醒一次普通 Session Drain。

**闭环愿景**：`意图输入 → 记忆沉淀 → 定时/离线调度 → 消息触达 → 安全确认 → 跨模式委派`。Assistant 是个人主动事项与长效上下文层，管理个人长效记忆、定时与事件提醒、个人笔记知识库，并在需要时委派重度任务给其他模式。

## 3. 运行语义与架构前提

| 决策 | 当前状态 | 本 PRD 处理 |
|---|---|---|
| Product Mode 与 canonical Session route | ADR-11/12 已接受 | 直接遵循 |
| Assistant 与其他模式边界 | ADR-13 已接受（2026-07-15） | 按 §17 边界表执行 |
| 全局落盘策略 | ADR-14 已接受（2026-07-15） | 使用 `Global.Service.config` 解析根目录 |
| ModeWorkspace 主区插槽 | ADR-15 已接受 | Assistant surface 通过 typed slot 注入 |
| 持久 Scheduler | 尚不存在（Work 已有 `scheduled-job.ts` 分钟级 cron 调度内核） | M0 新建独立领域服务、持久表和恢复循环，调度内核复用 |
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
- Assistant Session 直接继承全部共享基础能力（§18），含联网搜索、网页抓取、MCP、文件读写、提问确认。

### 4.2 非目标

- M1 不做常驻 Session、后台心跳、无限循环或“关闭应用仍全天在线”的承诺。
- M1 不做周期 Cron、日报、模型生成跟进、自动执行工具或跨项目检索。
- M1 不做 SOUL/USER/MEMORY 自动写入、FTS5、Curator、技能卡片或 Prompt Cache 改造。
- M1 不做跨模式浮层呼出、飞书/TG/QQ/微信桥接、语音、会议或 WebBridge。
- M1 不使用 `BackgroundJob` 作为调度存储，也不使用不存在的 `sessions_spawn/yield` API。
- M1 不把 EventV2 当作 Schedule 查询和运行状态的唯一存储。
- M1 不做个人笔记/知识库（M2 起）；不做图谱、闪卡、AI 产物生成（M2.5/M3）。

## 5. 用户故事

| 用户故事 | 验收结果 |
|---|---|
| 作为个人用户，我想用自然语言设置提醒，以便不填写复杂表单 | 系统解析后展示标准时间和时区，确认后才创建 |
| 作为跨时区用户，我想知道提醒按哪个时区触发，以便避免时间偏差 | UI 同时显示本地时间、IANA 时区和绝对时间 |
| 作为管理提醒的用户，我想查看和取消待执行提醒 | 列表状态来自持久 Schedule 查询，取消后立即更新 |
| 作为离线用户，我想重启后收到错过的提醒 | 启动恢复后生成一条标记为“逾期补投”的收件箱记录 |
| 作为成本敏感用户，我不希望简单提醒再次调用模型 | 到期路径的 LLM 调用数为 0 |
| 作为需要查资料的用户，我想让助手联网搜索并整理给我 | 对话中 `websearch`/`webfetch` 正常执行，结果可整理成笔记 |
| 作为知识沉淀者，我想把重要结论记进个人知识库并互相链接 | `propose_note` 生成候选，确认后写入 kb_note；`[[wikilink]]` 自动解析 |
| 作为回查用户，我想知道“我之前是怎么处理 X 的” | AI 仅基于 kb_note + 记忆检索回答，带引文角标跳转原文 |
| 作为记忆管理用户，我想查看 AI 记住了我什么 | 右栏 Memory Inspector 透明展示，可编辑/删除 |

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
- **复用约束**：`packages/core/src/session/schedule.ts`（cron 解析）与 `scheduled-job.ts`（租约/恢复/daemon）的可复用内核应在 M0 提取为共享调度基础设施，其上叠加 Assistant 独立的 Schedule/Delivery 表与 `deliveryKey` 幂等层；不建立两套并行的调度器。

### 7.2 Delivery

- Delivery 以 `deliveryKey` 唯一，保存 Schedule ID、投递时间、逾期标记和可展示内容引用。
- 认领可能是 at-least-once，但唯一约束使用户可见结果幂等；不得声称分布式 exactly-once。
- 收件箱是 M1 可靠投递面；桌面系统通知属于 best-effort 副作用。
- 重试次数和退避上限由 M0 技术设计确定；超过上限进入 `failed` 并向用户显示可重试状态。

### 7.3 Session 协作

- 创建提醒的自然语言解析发生在普通有限 `mode=assistant` Session Drain 中。
- 到期投递不创建 Session、不调用模型、不执行工具。
- M2 若支持“到期后让模型生成日报”，Scheduler 只能提交 durable input 并 advisory wake 普通 Session；每次仍是有限 Drain，并受 IterationBudget 和 Permission 约束。

### 7.4 知识库表（M2 新增，由 Core owner 管理）

**笔记表 `kb_note`**：

| 字段 | 约束 |
|---|---|
| `id` | 稳定笔记 ID |
| `title` | 笔记标题（同作用域内唯一，供 `[[链接]]` 匹配） |
| `content` | Markdown 正文（含 `[[wikilink]]`） |
| `scope` | `global`（存于 `Global.Service.config`）或 `project`（存于 `Location.directory/.aigcfroge/`） |
| `tags` | 层级标签数组（SQLite JSON） |
| `aliases` | 可选别名数组（`[[别名]]` 也能链接） |
| `format` | `note`/`summary`/`study_guide`/`faq`/`timeline`/`briefing`/`mindmap` |
| `createdAt` / `updatedAt` | 持久时间戳 |

**关系边表 `kb_link`**：

| 字段 | 约束 |
|---|---|
| `source_note_id` | 链接来源笔记 |
| `target_note_id` | 链接目标笔记（悬空时 null） |
| `target_title` | 目标标题（悬空检测用） |
| `link_type` | `reference`/`supports`/`contradicts`/`derived_from`（对齐 NOOA Agent-Curated Store） |
| `dangling` | 目标不存在时为 true |

- 笔记以 `.md` 文件为内容真源（ADR-14 §2，Obsidian 兼容），SQLite 为 FTS5 索引与关系边真源（ADR-14 §3）。
- 反向引用**单边存储 + 索引推导**（Obsidian 机制），不双写。
- 悬空检测为确定性机械校验，零 LLM、零 MCP、零索引依赖（复用双向链接调研 §3 机制②）。

### 7.5 对话生成笔记工具 `propose_note`（M2.5）

输入：`title`、`content`（Markdown 含 wikilink）、`tags`（可选）、`scope`（可选）、`format`（可选，`note` 默认）。
输出：`noteId`、`exists`、`nameConflict`、`danglingLinks`。

- 复用 Chat 模式 propose 候选-审查-持久化链路（`prompt-asset-candidate.ts` 的 CandidateInfo 判别联合 + 右栏审查面板）。
- 生成后进入待确认状态，用户审查/修改/拒绝后才写入；不自动落盘。

## 8. 页面与交互

Assistant 复用 ADR-12/ADR-15 的共享 `ModeWorkspace` 和 canonical Session route，通过 typed slot 注入 surface。

### 8.1 Mode 首页（Dashboard）

- 首页为**两栏结构**（对齐四模式首页骨架，`mode-workspace.tsx:139-145` 共享 `grid-cols-[280px_minmax(0,960px)]`）：280px 左栏 + 主区，**无右栏**。
- **左栏** = Location + 新建 + **实体导航树**（提醒/记忆/知识库分类 + 计数），对齐 chat 首页功能树（`ChatFeatureSidebar` 渲染模式）。
- **主区**（富聚合，保持现状不收敛）：待办提醒横条（主心智）+ 最近投递 + Memory Inspector + 知识库列表/编辑器 + `mode=assistant` 会话列表。
- **会话列表联动**：主区会话列表与左栏实体列表联动——点击左栏某提醒/记忆 → 会话列表高亮/过滤创建它的会话（提醒 `Schedule.Info.sessionID`、记忆 `sourceSessionID` 有会话反链）；知识库笔记为全局实体**无会话反链**，点击知识库节点 → 会话列表退化为全量。
- 待执行提醒可查看时间、时区、状态并取消；数据来自 Schedule 查询。
- M2 起增加：笔记最近变更、知识库导航入口。
- 首页不展示尚未实现的跨信道在线状态或“常驻”指示器。

### 8.2 Session 详情

复用 ADR-12 canonical Session route，壳层 = 次级左栏（可隐藏 256px）+ 中栏 + 右栏（按需打开）：

- **次级左栏**（对齐 chat/work 富左栏）：Location + 新建 + `mode=assistant` 会话列表 + 实体导航树（提醒/记忆/知识库分类/悬空链接计数）。
- **中栏**：消息流 + Composer（维持通用实现，不做 assistant 专属改造）；对话生成笔记的候选审查在此弹出。
- **右栏**（`SessionSidePanel` assistant slot，自包含单面板）：`AssistantSessionPanel`（手动开 + 可拖拽），fileTree 不在此槽位渲染（无 B 区空占位）。
- 底部 TerminalPanel 保留现状（assistant 无 shell，保留无害）。

**右栏 Tab（5 Tab，全量）**：

| Tab | 内容 | 数据源 |
|---|---|---|
| 提醒 | 待执行 Schedule 列表（内容/时间/时区/状态徽章 + 取消/修改）+ 底部历史 Delivery | `schedule.pending/list/cancel` + `delivery.recent/inbox/read` |
| 记忆 | Memory Inspector（pending 提议 + 已确认分组 + confirm/reject/edit/remove） | `memory.list/confirm/reject/edit/remove` |
| 知识库 | 搜索 + 标签筛 + 笔记列表 + 选中正文 + 反向引用 + 悬空链接 | `kb.list/get/search/dangling` + 新增 `backlinks` 端点（服务方法已有，HTTP 未暴露） |
| 笔记编辑器 | 双栏 Markdown 编辑 + `[[补全]]` + 实时预览 + 悬空高亮 + 标签 | `kb.create/update/remove` |
| 上下文 | 会话上下文来源（复用 `session-context-tab.tsx`，零改动） | 现有会话上下文 |

**交互模型**：
- 右栏 Tab 非常驻，按需打开；右上角 X 手动关闭。
- 上下文 Tab ↔ 中栏标题右侧上下文圆环（ProgressCircle 用量%）toggle（对齐 `session-context-usage.tsx` 模式）。
- 提醒/记忆/知识库/笔记编辑器 Tab ↔ 次级左栏实体列表点击：`openEntityPanel(kind, itemId)` 打开对应 Tab 并定位该项。
- 引文锚定：回答中 `[笔记ID]` 角标可点击 → 展开原文摘要 → 打开右栏知识库 Tab 定位。
- 提醒/记忆/知识库状态必须来自对应持久查询，不从对话文本反推。
- 时间确认、取消、错误和逾期状态走 i18n；键盘、焦点、稳定尺寸、明暗主题和窄屏遵循 `DESIGN.md`。

## 9. M2 记忆安全模型

个人记忆在 M1 验证后单独实施，不能简化为三个自动改写的 Markdown 文件。最小记忆记录必须包含：

- 内容、类型、来源 Session/Message、创建者与创建时间。
- `explicit` 或 `derived` 来源、信任等级、敏感等级和适用模式。
- 用户明确写入授权、可见审计记录、撤销/删除和恢复机制。
- 自动提取默认进入待确认状态；外部网页、工具输出和跨信道消息视为不受信来源。
- 敏感信息默认不进入长期记忆；日志、遥测和错误不得输出记忆正文。

**确认优先（Confirm-First）**：AI 只能**提议**记忆条目（`propose_memory`），不得自编辑自动注入 System Context；derived 条目进入待确认队列，用户确认后才晋升为显式记忆。不使用 Letta 式"自编辑记忆自动注入"。

“Prompt-Injection 扫描”只能是辅助信号，不能替代来源、授权和审计。透明文件若保留，路径必须相对 `Global.Service.config` 解析（尊重 XDG 与 `AIGCFROGE_CONFIG_DIR`），不得硬编码 `~/.aigcfroge`。

Prompt Caching 仅作为 M2 成本优化：先核验 Assistant System Context 是否在实际 V2 provider request 路径使用现有 cache hint/key，再决定是否扩展；不得把它写成 M1 正确性的前提。

## 10. M3 跨信道前置条件

跨信道桥接必须单独评审 Gateway、鉴权、用户映射、限流、入站去重、持久 outbox、重试、撤销和审计。Webhook 只负责验签与持久接收；处理端通过公开 Session create/prompt/EventV2 能力协作，不模拟或宣称存在 `sessions_spawn/yield`。

任何信道在 PoC 验证 API 稳定性、平台政策和账号风控前不得进入承诺范围（微信 WCF 高封号风险、OpenClaw 默认无鉴权 CVE 均需规避）。

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
| 笔记创建率（M2+） | 观察 | 对话生成笔记/主动创建笔记的用户占比 |
| 知识库回查率（M2+） | 观察 | 触发源数据锚定问答的会话占比 |

至少记录 `assistant_reminder_draft_started`、`assistant_reminder_confirmed`、`assistant_reminder_created`、`assistant_reminder_cancelled`、`assistant_reminder_delivered`、`assistant_reminder_caught_up` 和 `assistant_reminder_failed`；不记录提醒正文。M2 起增加 `assistant_note_proposed`、`assistant_note_applied`、`assistant_note_rejected`、`assistant_memory_confirmed`；不记录笔记正文。

## 12. 里程碑与优先级

| 阶段 | 范围 | 准入/退出条件 |
|---|---|---|
| **M0 Scheduler** | Schedule/Delivery schema、迁移、租约、恢复循环、typed API（复用 `scheduled-job.ts` 内核） | Core/数据库/安全评审通过，时间与崩溃测试完成 |
| **M1 单次提醒** | 对话确认、列表、取消、收件箱、在线投递、离线补投 | Beta Gate 全部达标 |
| **M2 个人记忆 + 知识库** | 显式记忆（确认优先）、Memory Inspector、kb_note/kb_link、FTS5、`[[wikilink]]`、悬空检测、反向引用 | 独立记忆安全设计 + 知识库 schema 评审通过 |
| **M2.5 个人笔记 + AI 产物** | 笔记编辑器、模板、日记页、Web 剪藏、`propose_note`（7 种 format）、源数据锚定问答 + 引文角标、版本历史 | 笔记 UX 评审通过，锚定问答防幻觉验证通过 |
| **M3 主动任务** | 周期计划、有限 Session wake、跨模式委派、图谱视图、闪卡/间隔重复（与 Scheduler 联动）、随机反刍 | IterationBudget、幂等和 Permission 设计通过 |
| **M4 跨信道** | 经 PoC 通过的单一信道，再逐个扩展 | Gateway 安全与 outbox 设计通过 |

按 WSJF，Scheduler 与单次提醒优先：它是所有主动能力的公共根基，同时不引入模型成本、工具风险和信道依赖。知识库与笔记紧随其后——它们是 Assistant 区别于其他模式的核心差异化能力。

### 12.1 成本收益假设

| 假设 | 验证方式 |
|---|---|
| 可靠单次提醒能验证用户是否需要 Assistant 的主动能力 | 观察提醒创建量、投递及时率、取消率和 7 日重复创建率 |
| 主要成本集中在 Scheduler 的事务、恢复和时间语义，M1 到期路径无模型成本 | 记录 M0/M1 工程工作量、故障率和 provider 调用数 |
| Scheduler 可被周期计划和有限 Session wake 复用 | M3 立项前验证不需要替换 Schedule/Delivery 身份与恢复模型 |
| 笔记知识库是 Assistant 的核心留存能力（相对纯笔记工具差异化） | 观察笔记创建率、回查率、7 日留存 |

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
- M2 知识库：`[[链接]]` 解析歧义、悬空检测、反向引用推导、同名冲突、FTS5 中文分词、文件外部修改后索引重建。
- M2.5 笔记：`propose_note` 各 format 输出、候选审查、确认前不落盘、引文角标跳转正确性。

## 15. 批准 Gate

1. Scheduler/Delivery 技术设计明确事务、租约、恢复、重试、取消并发和进程生命周期；明确与 `scheduled-job.ts` 的复用边界。
2. ADR-14 已被接受；知识库落盘遵循其配置/产出/运行状态真源划分。
3. 数据库、安全、Core、App 负责人确认 schema、隐私、指标和 Beta Gate。
4. M1 UI 删除“常驻/全天在线/跨信道已连接”等超出实际能力的承诺。
5. M2 记忆安全模型确认“提议+确认”而非“自编辑自动注入”；M2.5 锚定问答通过防幻觉验证。

---

## 16. 附录：开源 5 大高指标项目竞品调研与功能全景补充 (v4.0 补充方案)

> **补充说明**：本章节为 2026-08-11 基于全球 5 个最高指标开源 Agent 项目的深度调研成果补充。**完全保留 §1~§15 原有 M1~M3 的所有定义与架构约束**，为后续 M2~M4 演进提供功能与架构扩展视角。

### 16.1 5 大开源顶尖 Agent 项目深度对齐表

| 开源标杆项目 | GitHub/行业定位 | 核心机制与优势 | 对齐 AigcForge Assistant 的补充演进视角 |
|---|---|---|---|
| **1. Open Interpreter** | 60k+ Stars<br>系统级/代码执行 Agent | 本地代码执行（Python/Bash/REPL 沙盒）、Computer Use (GUI/截图控制)、Agent Client Protocol (ACP)。 | **端侧与代码沙盒 (Module E)**：为后续 M3/M4 演进提供本地 Python/REPL 沙盒与高危 Shell 指令的 Human-In-The-Loop (HITL) 授权机制。 |
| **2. Letta (前 MemGPT)** | 30k+ Stars<br>UC Berkeley 记忆 OS | LLM-as-an-OS 理念、Core / Recall / Archival 三层记忆模型、Self-Editing Memory (自编辑记忆)。 | **长效 3-Tier 记忆 (Module B)**：为 §9 个人记忆提供规范化架构——Core Memory (User Block 动态 Prompt 注入) + Archival (向量检索)。 |
| **3. Dify.ai** | 50k+ Stars<br>工作流与 Agent 平台 | 可视化 Tool 编排、ReAct 思考链显性化、Sub-agent 协同与 Agentic Workflow。 | **任务编排与 MCP (Module C/D)**：补充 ReAct 显性思考链与 MCP (Model Context Protocol) 插件标准的对接规范。 |
| **4. Open WebUI** | 50k+ Stars<br>个人 AI 门户 | Svelte/FastAPI 架构、Artifacts (Notes Canvas) 双栏 UI、Native RAG 知识库与多模型切换。 | **双栏 UI 与 Artifacts (Module A)**：补充共享 `ModeWorkspace` 的双栏交互模式（主会话流 + 右侧 Artifacts/Memory Canvas）。 |
| **5. OpenClaw / AutoGPT** | 200k+ Stars<br>全渠道网关 Agent | 多 IM 渠道连接器 (Telegram/Discord/WeChat)、Outbox 发件箱幂等去重、后台任务 Scheduler。 | **消息网关与 Outbox (Module D)**：为 §10 跨信道补充 Channel Outbox 幂等去重与外部 webhook 签名校验机制。 |

---

### 16.2 个人助手 Agent 5 大功能模块与内容全景清单

基于上述开源调研，将 Assistant 模式的长远功能扩展梳理为以下 5 大模块（作为 §4~§10 实施的完整功能库）：

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                       Assistant 模式 5 大功能模块 (全景补充)                            │
└───────────────────────────────────────────┬─────────────────────────────────────────────┘
                                            │
   ┌───────────────────┬────────────────────┼───────────────────┬────────────────────┐
   ▼                   ▼                    ▼                   ▼                    ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ Module A        │ │ Module B        │ │ Module C        │ │ Module D        │ │ Module E        │
│ 交互与对话外壳  │ │ 记忆与知识体系  │ │ 任务规划与执行  │ │ 工具与生态网关  │ │ 系统与端侧控制  │
└─────────────────┘ └─────────────────┘ └─────────────────┘ └─────────────────┘ └─────────────────┘
```

#### Module A：交互与对话外壳 (Interaction & Conversational Shell)
1. **多模态对话流 (Multi-modal Stream)**：文本、语音 (TTS/STT 实时中断)、图像输入与代码/图表实时渲染。
2. **多模型/多 Provider 动态切换**：无缝切换 OpenAI、Anthropic、DeepSeek 及 Ollama/vLLM 本地模型。
3. **Artifacts 画布 (Notes & Product Canvas)**：在双栏右侧独立渲染长文档、代码块、Mermaid 图表与 HTML 预览。
4. **全渠道 IM/消息接入 (Channel Gateway)**：绑定 Telegram、Discord、Slack、微信等信道进行消息交互与主动通知。

#### Module B：记忆与知识体系 (Stateful Memory & RAG)
1. **三层记忆模型 (3-Tier Memory System)**：
   * **Core Memory (RAM)**：存放用户画像、交互偏好（注入 System Context Prefix）。
   * **Recall Memory (Cache)**：会话上下文窗口与近期交互历史摘要。
   * **Archival Memory (Disk)**：基于 SQLite-VSS / Vector DB 的向量化长期历史与文档检索。
2. **自编辑记忆 (Self-Editing Memory)**：Agent 自动识别用户偏好并触发 `update_memory`，且在 Memory Panel 中向用户透明展示。**（本 PRD §9 修正：仅允许"提议+确认"，禁止未经确认的自动注入）**
3. **个人知识库 RAG Pipeline**：支持 Markdown/PDF/URL 一键导入构建索引库，采用 Hybrid Search + Cross-Encoder Rerank。**（本 PRD §7.4 修正：M2 用 FTS5 + 双向链接，向量检索延至 M3+）**

#### Module C：任务规划与 Agent 执行引擎 (Task Engine & Scheduler)
1. **持久化调度器 (Persistent Scheduler)**：基于 Core 引擎的定时（One-shot/Cron）与事件驱动调度器，带租约认领与崩溃恢复（严格遵循 §3/§7 规范）。
2. **ReAct 显性思考链**：透明展示 Reasoning、Tool Call 与 Observation 步骤。**（本 PRD §17 修正：Assistant 左栏不展示 ReAct 显性思考链，简洁确认优先）**
3. **Human-In-The-Loop (HITL) 授权控制**：对高危操作（修改本地文件、执行 Shell、发送外部消息）弹窗二次确认。
4. **Sub-agent 任务分发**：支持 Assistant 将复杂研究或代码审查任务委派给专门子 Agent 独立异步执行。

#### Module D：工具与生态网关 (Tools, Extensions & MCP)
1. **MCP (Model Context Protocol) 原生支持**：无缝接入标准 MCP Server 提供的工具与数据源。（AigcForge 已有 MCP V2 stdio+remote+OAuth）
2. **Channel Outbox 消息发件箱**：保证向外部 IM 投递消息时的幂等性与有序性。
3. **Agentic Web Search**：集成 Brave/Tavily/Perplexity 联网搜索能力。（AigcForge 已有 `websearch` Exa/Parallel 双引擎）

#### Module E：系统与端侧控制 (OS & Execution Sandbox)
1. **Python/REPL 代码沙盒**：安全执行数据分析、绘图与计算脚本。**（本 PRD §17 判定：伪需求/远期探索，AigcForge 已有 bash + Coding 模式）**
2. **CLI & Terminal Hook**：支持运行受限命令与脚本（高危指令需 HITL 授权）。
3. **本地工作区文件整理**：自动根据约定提取、清洗、组织本地特定目录中的文件。**（远期探索）**

---

### 16.3 UX 交互设计补充规范

1. **Memory Inspector (记忆面板)**：
   * 复用右栏 Slot，直观分类呈现记忆条目，支持用户一键编辑（Edit）、手动删除（Delete）或停用特定记忆条目。
2. **Human-In-The-Loop (HITL) 授权组件**：
   * 采用高对比度提示框，展示指令类型、目标路径/API 与风险等级，提供 **Approve (授权)** / **Edit (修改参数)** / **Decline (拒绝)** 三选项。**（M3+ 完整版；M1 提醒创建确认为轻量版，复用 `question` 工具）**
3. **Pending Reminders Drawer (待办提醒抽屉)**：
   * 结合 §8 页面设计，在侧边栏提供待执行 Schedule 列表，支持一键取消与查看历史 Delivery 记录。

---

## 17. 架构职责边界与伪需求甄别

### 17.1 五模式职责切割（遵循 ADR-11/13）

| 模式/组件 | 核心定位与职责 | 不属于本模式的内容 |
|---|---|---|
| **Meta-Agent (元智能体)** | 系统总路由与编排层：意图识别、子 Agent 分发、并行调度、工作流 Pipeline | 不承担具体个人提醒存储或用户个性化记忆管理 |
| **Chat 模式** | 资产捏造与创造层：调试、生成和管理 Prompt/Skill/Workflow/Plugin 资产 | 不承担通用业务执行或个人日程管理 |
| **Code 模式** | 工程研发层：以代码库、Git、LSP、终端为中心的代码构造与调试 | 不承担非代码类日常办公提醒与个人偏好记忆 |
| **Work 模式** | 非编程预设执行层：消费硬编码 Presets 完成一次性交付物 | 不承担跨会话长效记忆或周期性主动触达 |
| **Assistant 模式** | 个人主动事项与长效上下文层：个人长效记忆、定时与事件提醒、个人笔记知识库、多端 IM 触达、HITL 安全授权 | 不重复做代码编写、不重复做预设执行、不替代元智能体总路由 |

### 17.1.1 全模式默认元智能体 + assistant 子智能体契约（2026-08-11 决策）

**决策**：所有 Product Mode 的默认 agent 均为元智能体（meta）。meta 依据用户输入自行判断是否委派子智能体，用户无需手动选择。

- **实现**：`modeDraft("chat")`/`modeDraft("work")` 返回 meta；`local.tsx` 移除"chat/work 只显示 orchestrator"过滤。chat-orchestrator / work-orchestrator 在 agent 列表中**废弃为默认选项**，但**定义/权限/功能保留**——作为 meta 的委派目标（做资产→chat-orchestrator、做文档→work-orchestrator）。
- **meta 权限**（双层：只读自干，写操作委派）：
  ```text
  allow  read / glob / grep / websearch / webfetch / question / task / list_assets / plan_enter
  deny   bash / edit / write
  ```
  简单只读/联网/提问任务由 meta 自干；破坏性写（改代码/跑 shell）必须委派 build。
- **跨模式调度**：委派通过 `task` 工具（subagent_type 自由，`agents.resolve` 解析任意注册 agent）。子代理是父会话下的通用子会话，**无模式切换**，结果经 `delegateBackground` inject 回原对话。禁止递归（子代理不能再 spawn）。
- **失败兜底**：task 层自动 retry 一次（`error` 可重试 / `cancelled` 不重试），重试前清理孤儿会话；不需要 meta 接手兜底。

**新增 `assistant` 子智能体（个人事项执行者）**：assistant 模式专属能力的 fail-closed 执行者，meta 在个人事项场景委派给它。权限契约：

```text
deny   *:*（catch-all）
allow  read / glob / grep / websearch / webfetch / question
allow  reminder_*            // M1 提醒创建/取消
allow  kb_* / propose_note   // M2 知识库/笔记
allow  memory_*              // M2 个人记忆
deny   bash / edit / write / task_spawn / task_schedule
```

- 它确保 assistant 的边界（只做个人事项，不碰代码）真正闭环——meta 委派时有"负责提醒/笔记/记忆/知识库"的执行者。
- 同时作为用户自建"个人助手"类智能体的权限参照模板。

**token / 缓存影响**：子代理是独立 Session，不共享父会话 prompt cache，每次委派是新 miss（除非 `task_id` 续接同一子代理）；复杂任务委派省 token（上下文不膨胀），简单任务委派浪费。建议配**委派阈值**：meta 在 system prompt 中引导"复杂才派、简单自干"。

### 17.2 伪需求甄别（绝不能踩的坑）

| 伪需求 | 剔除原因 | 真需求解法 |
|---|---|---|
| 1. 假装“关闭应用后依然全天候云端在线” | 本地/桌面架构下关机宣称在线是欺骗 | 持久 Scheduler 事务引擎 + 启动时扫描逾期补投（Caught-up Delivery） |
| 2. 把“大段历史对话”充当“个人记忆” | 长上下文滚屏致模型迷失，新开 Session 依然失忆 | 结构化记忆（Core 画像 + 显式条目），FTS5 检索，可视化面板编辑/删除 |
| 3. 让 Assistant 承担重度写代码或长文档交付 | 混淆 Assistant 与 Code/Work 模式界限 | 跨模式委派（Mode Delegation）：写代码交 Code，做文档交 Work 预设 |
| 4. “完全无感”替用户自动执行高危操作 | 全自动发邮件/删文件易因幻觉致数据灾难或社交事故 | HITL 渐进式授权卡片（Approve / Edit / Decline） |
| 5. AI 自编辑记忆并自动注入 prompt | 个人助手场景下用户失控感是致命体验问题，且引入注入污染 | 记忆"提议+确认"，derived 进入待确认队列 |
| 6. 左栏展示 ReAct 显性思考链 | Assistant 用户需要简洁确认，不是逐步推理展开；Session Runner 已有内部循环 | 左栏为消息流 + 确认卡片 |
| 7. Python/REPL 代码沙盒、Computer Use、Phone Use、全双工语音 | 工程量等于独立产品线，且与开发者工具定位不符 | 已有 bash + Coding 模式覆盖代码执行；数字人/语音标为远期探索 |

---

## 18. 共享基础能力（Assistant 继承，不独立建设）

以下能力已在 `packages/core` 实现，Assistant Session 作为 `mode=assistant` 普通 Session，通过 Tool Registry + PermissionV2 直接继承：

| 能力 | 代码位置 | 对 Assistant 的意义 |
|---|---|---|
| 联网搜索 | `tool/websearch.ts` | Exa/Parallel 双引擎，查资料、整理信息 |
| 网页抓取 | `tool/webfetch.ts` | URL 转 markdown，读链接、Web 剪藏素材 |
| MCP 工具接入 | MCP V2（stdio+remote+OAuth） | 继承全部已注册 MCP Server 工具 |
| 文件读写 | `tool/read|write|edit|glob|grep` | 读写项目文件 |
| 提问确认 | `tool/question.ts` | 提醒创建确认、记忆确认、HITL 轻量版 |
| Bash 执行 | `tool/bash.ts` | 受 PermissionV2 控制的命令执行 |
| Skill 加载 | `tool/skill.ts` | 按需加载技能 playbook |
| 会话共享/回滚/摘要 | `session/share-v2|revert|summary` | 跨会话上下文协作 |

联网搜索（`websearch`）+ 网页抓取（`webfetch`）是用户使用 Assistant 的高频场景（"帮我查一下最近的 X"），也是 AI 辅助写入笔记/知识库的前提。需要在 Assistant Agent 的 system prompt 中显式告知模型"你有联网搜索能力"。

---

## 19. 个人知识库（双向链接，M2）

> 依据：[双向链接与防幻觉机制调研](../research/agent/AigcForge-双向链接与防幻觉机制调研.md) §4.1——知识图谱/双向链接数据库适合"个人助手 + 本地知识库"场景（Obsidian/NOOA/Windsurf 先例），不适合编程执行 Harness。

### 19.1 与个人记忆的关系

| 维度 | 个人记忆（§9） | 个人知识库（本节） |
|---|---|---|
| 内容来源 | AI 提议或用户主动写入的事实片段 | 用户主动创建的结构化笔记/文档 |
| 粒度 | 一条事实（几句话，≤2000 字符） | 一篇笔记（可长可短，含格式化内容） |
| 关系 | 无显式关系边（只有 source 溯源） | 笔记间 `[[双向链接]]`，可追溯反向引用 |
| 检索 | FTS5 关键词搜索 | FTS5 + 双向链接遍历 + 悬空检测 |
| 用户心智 | 被动消费（AI 注入上下文时用） | 主动组织（浏览、编辑、关联） |

知识库是记忆的载体和容器：记忆条目可挂载到笔记上，一条笔记可含多条记忆事实；两者通过关系边（`supports`/`contradicts`/`derived_from`）关联，为防幻觉证据链打基础。

### 19.2 核心功能（M2）

1. **`[[Wikilink]]` 语法解析**：`[[项目A]]` 自动解析为指向标题为"项目A"笔记的链接；目标不存在则标记悬空链接（UI 高亮提示）。
2. **反向引用（Backlinks）**：笔记被 `[[B]]` 引用时，B 页面自动展示"被以下笔记引用"列表；单边存储 + 索引推导，不双写。
3. **悬空链接检测**：扫描所有 `[[链接]]`，目标不存在时报告；UI 面板展示悬空列表，点击可创建缺失笔记（调研确认的唯一零依赖机械防线）。
4. **FTS5 全文检索**：笔记正文+标题建 FTS5 虚拟表，中文分词；M2 笔记量百级够用，无需向量检索。
5. **层级标签**：`#tag/subtag`，左栏按标签树导航，可按标签筛选聚合。
6. **Markdown 文件落盘 + Obsidian 兼容**：`.md` 文件存于 `<Global.Service.config>/knowledge-base/`（全局）或 `<Location.directory>/.aigcfroge/knowledge-base/`（项目）；用户可直接用 Obsidian 打开编辑，AigcForge 通过文件监听重建索引。
7. **LLM 工具**：`kb_create`/`kb_search`/`kb_read`/`kb_update`/`kb_delete`/`kb_list_dangling`，遵循 Tool Registry + PermissionV2。

### 19.3 增强功能（M2.5）

- 日记页（Daily Notes）：日期命名自动生成
- 模板系统：会议纪要/周报/读书笔记/每日回顾
- Web 剪藏：对话中发 URL → webfetch → Markdown 笔记草稿
- 别名（Aliases）：`[[别名]]` 也能链接
- 版本历史：每次 update 保存旧版本，diff + 回滚
- 文件监听与索引重建：外部 Obsidian 编辑后自动同步

### 19.4 高级功能（M3+）

- 图谱视图（vis-network，Work M3.5 已内联）
- 闪卡/间隔重复：SM-2 算法 + 提醒引擎联动（到期 → 收件箱提醒复习）
- 思维导图视图（Mermaid）
- 记忆↔笔记关系边（supports/contradicts/derived_from）
- 导出（Markdown 批量包/PDF/HTML）

---

## 20. 个人笔记与 AI 产物生成（Studio，M2.5）

> 依据：[个人笔记与知识库竞品调研](../research/agent/个人笔记与知识库竞品调研.md) §3（NotebookLM Studio）——AI 严格基于源文件作答、引文溯源、一键生成多种结构化产物。

### 20.1 对话生成笔记（propose_note）

复用 Chat 模式 propose 候选-审查-持久化链路：

```
对话消息流 (SSE parts)
  -> extractMessageContent() 提取文本 [capture-helpers.ts]
  -> propose_note LLM 工具（新）候选稿 -> NoteCandidateInfo
  -> NoteCandidatePanel 右栏审查（Markdown 预览 + 标签 + 悬空链接提示）
  -> applyNoteCandidate() 调用 kb_create API 持久化
  -> kb_note 表 + <config>/knowledge-base/*.md 落盘
```

参考：[capture-helpers.ts](../../../packages/app/src/components/chat/capture-helpers.ts)、[work-asset-capture.ts](../../../packages/app/src/pages/work-asset-capture.ts)、[prompt-asset-candidate.ts](../../../packages/app/src/components/chat/prompt-asset-candidate.ts)、[suggestion-bar.tsx](../../../packages/app/src/components/chat/suggestion-bar.tsx)

### 20.2 format 产物类型

| format | NotebookLM 对应 | Assistant 场景 |
|---|---|---|
| `note` | 笔记卡片 | 从对话提取要点 |
| `summary` | 摘要 | 压缩整段对话 |
| `study_guide` | Study Guide | 概念 + 简答题 |
| `faq` | FAQ | 问答对整理 |
| `timeline` | Timeline | 事件排序 |
| `briefing` | Briefing Doc | 结构化汇报摘要 |
| `mindmap` | Mind Map | Mermaid mindmap 语法 |

### 20.3 触发方式

1. **AI 主动提议**：SuggestionBar 弹"这段讨论有价值，保存为笔记吗？"→ 用户确认 → propose_note
2. **用户主动指令**："把刚才讨论的整理成笔记"/"总结今天的对话"/"生成 FAQ" → propose_note（带 format）
3. **快速捕获**："记一下：..." → AI 生成极简笔记直接写入（可配置确认）

### 20.4 源数据锚定问答（AI 知识库问答）

用户问"我之前是怎么处理 X 问题的？"：

1. 先 `kb_search` 检索相关笔记 + 记忆条目
2. 将检索结果作为 grounding context 注入 Session 上下文
3. System prompt 指示："仅基于以下笔记内容回答，不要使用通用知识。笔记中没有相关信息时明确告知用户。"
4. AI 产出引用笔记 ID，前端渲染为可点击引文角标，点击跳转笔记原文

这实现 NotebookLM 式 Zero-Hallucination Grounding，对齐调研 §5 的"证据链可追溯"防幻觉结论。

---

## 21. 跨模式委派与自定义模式扩展

### 21.1 跨模式委派（M3）

Assistant 发现用户需要重度写代码或大文档交付时，自动发起面向 Code/Work 模式的 Draft 委派链接：

- 写代码 → Code 模式（bash/read/write/edit + LSP）
- 结构化文档/画报 → Work 模式预设（work-preset + artifact）
- Assistant 只负责发起委派和跟进进度（task 委派工具已有 `task_spawn`/`task-driver`）

### 21.2 自定义模式扩展契约（M3+）

遵循 ADR-15 ModeWorkspace 主区插槽：Main Area Slot 与 Right Canvas Slot 采用 typed slot 设计。未来用户添加"自定义模式"时，只需注册新的 Typed Slot 组件 + Prompt 模板，即可复用底层 Session、Memory、知识库与 Scheduler 基础设施，不新增第五种 Product Mode 硬编码。
