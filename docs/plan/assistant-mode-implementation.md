# Assistant 模式实施计划：个人主动事项 + 长效上下文闭环

> 状态：**Draft — 待审批**
> 范围：`packages/schema` + `packages/core` + `packages/aigcfroge` + `packages/app`
> 关联：[Assistant PRD v4](../prd/assistant-mode-personal-agent.md)（范围真源）、[Assistant 路线图](assistant-mode-roadmap.md)（本计划的上级）、[元智能体调度架构讨论总结](../research/agent/元智能体调度架构讨论总结.md)（meta 契约）、[ADR-11~15](../architecture/adr/)（全 Accepted）、[双向链接与防幻觉机制调研](../research/agent/AigcForge-双向链接与防幻觉机制调研.md)、[个人笔记与知识库竞品调研](../research/agent/个人笔记与知识库竞品调研.md)
> 依据：`CLAUDE.md`、根/包级 `AGENTS.md`、`effect`/`database`/`frontend-theming`/`protocols` skills、实际 V2 Session/Agent/Tool/API/App 代码
> 分支：**assistant**（从 main 切出）
> 最后更新：2026-08-11

---

## 0. 审批状态与执行 Gate

| Gate | 条件 | 状态 | 阻塞范围 |
|---|---|---|---|
| **G0 范围真源** | Assistant PRD v4 已评审；ARCHITECTURE.md §7 同步 Assistant 状态（Draft → In progress） | 待定 | 全部 Phase |
| **G1 调度内核复用** | Core owner 接受：提取 `scheduled-job.ts` 调度内核为共享基础设施（§3.1），其上叠加独立 Schedule/Delivery 表 | 待定 | Phase 0 |
| **G2 meta 契约** | Core/安全 owner 接受：全模式默认 meta + meta 权限收敛（只读自干/写委派）+ assistant 子智能体权限契约（§3.2/§3.3） | 待定 | Phase 0 |
| **G3 记忆/知识库安全** | 记忆"提议+确认"（PRD §9）+ kb_note/kb_link schema + 隐私（敏感信息不入库） | 待定 | Phase 2 |
| **G4 笔记契约** | `propose_note` 7 种 format + 源数据锚定问答防幻觉验证 | 待定 | Phase 3 |

**与既有代码的边界（必须遵守）**：
- ❌ 不新建第二套调度器——`scheduled-job.ts` 内核必须提取复用，不得复制
- ❌ 不让 assistant 子智能体继承宽权限——必须 fail-closed（§3.3）
- ❌ 不做记忆"自编辑自动注入"——只允许"提议+确认"（PRD §9）
- ❌ 不把社交桥接提前到 Phase 0-3（M4 单独立项）

---

## 1. 目标、非目标与本次收敛

### 1.1 目标

让 `mode=assistant` 从"三槽位 Placeholder"变为"个人主动事项 + 长效上下文"的完整闭环：

- **Phase 0**：调度内核复用 + 全模式默认 meta + assistant 子智能体（体系基座）
- **Phase 1**：单次提醒闭环（创建/修改/取消/收件箱已读/离线补投/桌面通知）
- **Phase 2**：个人记忆 + 知识库（Memory Inspector + kb_note/kb_link + wikilink + 悬空检测 + 反向引用）
- **Phase 3**：个人笔记 + AI 产物（笔记编辑器 + 模板/日记 + propose_note 7 格式 + 源数据锚定问答）

### 1.2 非目标

- ❌ 不做跨信道 IM 桥接（M4 单独立项，PoC 门控）
- ❌ 不做图谱视图/闪卡/思维导图（M3，依赖 vis-network 集成）
- ❌ 不做向量检索 RAG（M3+，M2 用 FTS5）
- ❌ 不做数字人/语音/Computer Use（远期探索）
- ❌ 不做社交网关收敛（M4）

### 1.3 相对 PRD 的收敛

| PRD 描述 | 本次实施收敛 |
|---|---|
| M2 记忆 + 知识库并行 | **先记忆（Phase 2a）后知识库（Phase 2b）**，都依赖 kb_note 基础表 |
| propose_note 7 种 format | Phase 3 先落地 `note`/`summary`/`faq`/`timeline` 4 种，`study_guide`/`briefing`/`mindmap` 后补 |
| 全模式默认 meta | Phase 0 实施；chat/work orchestrator 保留为委派目标，默认改为 meta |
| 桌面通知 | M1 为 best-effort，失败不回滚持久投递（PRD §4.1） |

---

## 2. 背景与当前状态

### 2.1 现有基座（已就绪，直接复用）

| 能力 | 文件 | 状态 |
|---|---|---|
| 调度内核（cron/租约/恢复/daemon） | `packages/core/src/session/scheduled-job.ts` + `scheduled-job-executor.ts` | ✅ 已实现（Work M3 体系） |
| cron 解析 | `packages/core/src/session/schedule.ts`（`nextRun`） | ✅ 已实现 |
| Task 表带 scheduled_at/recurrence/depends_on | `packages/core/src/session/sql.ts:124` | ✅ 已实现（复用参考） |
| question tool | `packages/core/src/tool/question.ts` | ✅ 已注册 |
| chat-orchestrator 范式 | `packages/core/src/agent/prompt/chat-orchestrator.ts` | ✅ 类比创建 assistant 子智能体 |
| meta agent + prerouter | `packages/core/src/agent/meta/prerouter.ts` + `plugin/agent.ts:407` | ✅ 全局自动路由 |
| ModeWorkspace slot | `packages/app/src/pages/mode-workspace-slots.tsx` | ✅ assistant 当前 Placeholder |
| propose 候选-审查链路 | `packages/app/src/components/chat/prompt-asset-candidate.ts` + `asset-insert.ts` + `work-asset-capture.ts` | ✅ 复用为 propose_note |
| Web 剪藏素材 | `packages/core/src/tool/webfetch.ts` | ✅ URL→markdown |
| 联网搜索 | `packages/core/src/tool/websearch.ts` | ✅ Exa/Parallel 双引擎 |
| Memory Inspector 面板范式 | `session-side-panel.tsx` 右栏 Tab 结构 | ✅ 复用 |
| system-context builtins | `packages/core/src/system-context/builtins.ts` | ✅ 复用（core/memory 已挂） |

### 2.2 需新建

| 交付物 | 位置 | 说明 |
|---|---|---|
| Schedule/Delivery 表 + Service | `packages/core/src/session/schedule-*.ts` + migration | 独立运行状态表（ADR-14 §3） |
| assistant 子智能体 | `packages/core/src/agent/prompt/assistant-orchestrator.ts` | fail-closed 权限（§3.3） |
| 全模式默认 meta 改造 | `product-mode-agent-policy.ts` + `local.tsx` + `mode.tsx` | §3.2 |
| memory_* 工具（个人记忆） | `packages/core/src/tool/kb-*.ts` | 提议+确认 |
| kb_note/kb_link 表 + Service | `packages/core/src/session/kb-*.ts` + migration | §7.4 契约 |
| wikilink 解析 + 悬空检测 | `packages/core/src/kb/link.ts` | 机械校验 |
| FTS5 索引 | migration + service | 中文分词 |
| kb_* LLM 工具 | `packages/core/src/tool/kb-*.ts` | create/search/read/update/delete/list_dangling |
| propose_note 工具 | `packages/core/src/tool/propose-note.ts` | 7 格式 |
| Assistant Surface UI | `mode-workspace-slots.tsx` + `mode-surfaces.tsx` | 替换 Placeholder |
| 提醒 Tab / 收件箱 | `session-side-panel.tsx` 新增 | 待办提醒抽屉 |
| 笔记编辑器 | 右栏画布 | Markdown WYSIWYG + [[补全]] |

---

## 3. 关键设计

### 3.1 调度内核复用（G1 需确认）

**目标**：不复制 `scheduled-job.ts`，提取其可复用内核。

| 复用点 | 源 | 提取方式 |
|---|---|---|
| cron 解析 `nextRun` | `session/schedule.ts` | 直接导入（已是独立纯函数） |
| 租约认领 + 崩溃恢复模式 | `scheduled-job.ts:76-102`（arm/recover） | 抽象为 `SchedulerCore`（表无关的扫描+认领+恢复循环） |
| daemon 层模式 | `scheduled-job.ts:246-261` | 抽象 `daemonLayer`（arm + 分钟 tick + 事件 re-arm） |

**新层（不替换旧层）**：
- `ScheduleTable`（`session/schedule-sql.ts`）：PRD §7.1 全部字段（id/sessionID/kind/content/dueAt/timezone/status/attempts/leaseOwner/deliveryKey/createdAt/updatedAt）
- `DeliveryTable`（同文件）：deliveryKey 唯一 + scheduleID + deliveredAt + caughtUp 标记
- `ScheduleService`：typed create/query/cancel/claim/recover
- `DeliveryService`：幂等投递 + 收件箱查询 + 已读标记
- `AssistantSchedulerDaemon`：复用 `SchedulerCore` + 新增 Schedule 表的 daemon

**边界**：Work 的 TaskTable 调度保持不动；本层只服务 Assistant 的 Schedule/Delivery。两者共享 `SchedulerCore`，互不干扰。

**⚠️ P2 时间精度（审批修正）**：提醒用 `dueAt` 绝对时间戳 + **分钟级 tick 扫描**（到分钟对齐），**不引入秒级调度**——复用 `schedule.ts` 分钟级语义。`Schedule.spaced("1 minute")` 两次扫描间隔 ≤60s，满足 PRD §11"在线及时率 ≥99% 在到期后 60 秒内"。

### 3.2 全模式默认 meta（G2 需确认）

**决策**（来自[元智能体调度架构讨论总结](../research/agent/元智能体调度架构讨论总结.md)）：所有 Product Mode 默认 agent = meta。

| 改动 | 文件 |
|---|---|
| `resolvePrimaryAgent("chat"/"work")` 返回 meta（替代 orchestrator） | `product-mode-agent-policy.ts:41-44` |
| `checkPrimaryAgent` 对 chat/work 的强制改为"允许 meta + orchestrator 作为委派目标" | 同文件 :69-86 |
| `modeDraft("chat"/"work")` 返回 meta | `packages/app/src/context/mode.tsx:61-66` |
| `local.tsx:74-76` 移除"required 只显示 orchestrator"过滤 | `packages/app/src/context/local.tsx` |

**meta 权限收敛**（双层：只读自干，写委派）：

```text
allow  read / glob / grep / websearch / webfetch / question / task / list_assets / plan_enter
deny   bash / edit / write
```

**⚠️ P1 边界澄清（审批修正）**：`deny bash/edit/write` 仅限 meta **直接工具调用**。`task` 工具委派子代理（build 有 edit 权限）是**间接写**，属子代理权限域，**不得 deny `task`**——否则 meta 无法委派写操作，与设计冲突。实现时必须保持 `task` allow，只收紧 meta 的直接写工具。

**委派目标保留**：chat-orchestrator / work-orchestrator 定义、权限、prompt 全部保留，作为 meta 的 `task` 委派目标（做资产→chat-orchestrator、做文档→work-orchestrator）。

### 3.3 assistant 子智能体（G2 需确认）

类比 `chat-orchestrator.ts`，新增 `assistant-orchestrator.ts`：

```text
职责: 处理个人主动事项（提醒/记忆/知识库/笔记），经 meta 委派或在 assistant 会话直接执行
权限 (fail-closed):
  deny   *:*（catch-all）
  allow  read / glob / grep / websearch / webfetch / question
  allow  reminder_*            // Phase 1 提醒创建/修改/取消
  allow  kb_* / propose_note   // Phase 2/3 知识库/笔记
  allow  memory_*              // Phase 2 个人记忆
  deny   bash / edit / write / task_spawn / task_schedule
注册: plugin/agent.ts（类比 chat-orchestrator :320）
```

**system prompt 要点**（G1 需产品确认）：
- 用户请求设提醒时：解析内容/时间/时区 → 展示 → **确认后**才创建（不自行猜测）
- 用户请求记笔记/记忆时：生成候选 → 待确认 → 确认后写入
- 明确告知"有联网搜索能力"
- 时间歧义/已过去/时区不确定 → 必须重新确认

### 3.4 记忆"提议+确认"（G3 需确认）

| 环节 | 机制 |
|---|---|
| AI 提议 | `propose_memory` 工具生成候选（explicit/derived + 信任/敏感等级） |
| 待确认队列 | derived 条目默认 pending，不注入 System Context |
| 用户确认 | Memory Inspector 面板 Approve/Edit/Reject |
| 注入约束 | 仅用户确认后的条目可注入 `mode=assistant` 会话 prefix |
| 审计/撤销 | 每次写入留痕；可删除/恢复 |

**与现有 `memory.ts`（MetaAgent 项目级）区分**：`memory.ts` 绑定 meta_agent_id，是 meta 会话事实；本实施新增**个人记忆**（用户级，跨项目），独立表 `personal_memory`。

### 3.5 知识库双向链接（G3 需确认）

| 环节 | 机制 |
|---|---|
| kb_note 表 | title 唯一（同作用域）+ content(Markdown 含 wikilink) + scope + tags + aliases + format |
| kb_link 表 | source_note_id + target + link_type(reference/supports/contradicts/derived_from) + dangling |
| wikilink 解析 | 写入时扫描 `[[title]]` → 解析目标 → 建/更新 kb_link |
| 悬空检测 | 目标不存在 → `dangling=true`，零依赖机械校验（复用双向链接调研 §3 机制②） |
| 反向引用 | 单边存储 + 索引推导（不双写） |
| FTS5 | title+content 建虚拟表，**unicode61 tokenizer（逐字）+ LIKE 兜底**（P3 修正见下） |
| 文件落盘 | `.md` 落 `<Global.Service.config>/knowledge-base/`（全局）或 `<Location>/.aigcfroge/knowledge-base/`（项目），文件为内容真源（ADR-14 §2） |
| 文件监听 | ConfigWatcher 监听 `.md` 变更 → 重建索引 |

**⚠️ P3 FTS5 中文分词（审批修正）**：全仓现无 FTS5 虚拟表实现（`agent/meta/memory.ts` 仅注释建议，非实际）。SQLite FTS5 默认 tokenizer 对中文是逐字切分。M2 方案：**`unicode61` tokenizer（逐字索引）+ LIKE 精确匹配兜底**——中文精确短语用 LIKE 命中，模糊检索用 FTS 逐字；验收测试覆盖中英文，满足后不引入自定义 tokenizer（jieba 等留 M3+ 规模增长后评估）。

### 3.6 用户主流程（Phase 1 端到端）

```mermaid
sequenceDiagram
    autonumber
    actor User as 个人用户
    participant UI as ModeWorkspace (Assistant Surface)
    participant Agent as meta/assistant 子智能体
    participant Q as question tool
    participant Sch as ScheduleService
    participant Box as 收件箱

    User->>UI: 进入 /mode/assistant
    User->>Agent: "明天上午9点提醒我跟进客户"
    Agent->>Agent: 解析内容/时间/时区(Asia/Shanghai)
    Agent->>Q: 展示确认(内容+绝对时间+时区+离线补投语义)
    User->>Q: 确认
    Agent->>Sch: create(pending, deliveryKey)
    Sch->>Box: 提醒 tab 立即可查询
    Note over Sch: 到期扫描器认领 → 幂等 Delivery
    Sch->>Box: 收件箱记录 + 桌面通知(best-effort)
    Note over Sch: 进程重启 → 扫描逾期补投(is_caught_up)
```

### 3.7 Assistant Surface UI

> ⚠️ **2026-08-13 超期说明**：本节的"首页右栏 = AssistantRightPanel"与"右栏 Tab 渐进式"已被 [assistant-session-detail-plan.md](assistant-session-detail-plan.md) 取代——**首页为两栏结构（无右栏）**，右栏 5-Tab 实体面板归属**会话详情页**，`session-side-panel.tsx` 的 assistant slot 落地。实施计划只描述 Phase A-F 已合入的首页 dashboard 基座，页面布局定稿见新计划。

`mode-workspace-slots.tsx` + `mode-surfaces.tsx` 替换 Placeholder：

```tsx
assistant: {
  Sidebar: () => <AssistantSidebar />,          // Location + 知识库导航树 + 新建
  Main: () => <AssistantDashboardMain />,       // 待执行提醒 + 最近投递 + 会话列表
  RightPanel: AssistantRightPanel,              // 提醒/记忆/知识库/笔记 Tab
}
```

右栏 Tab（渐进式）：`提醒`（Phase 1）→ `记忆`（Phase 2）→ `知识库`（Phase 2）→ `笔记编辑器`（Phase 3）。

---

### 3.8 架构设计（数据流 / Layer / 事件 / 灰度 / 埋点）

#### 3.8.1 数据流追踪（CLAUDE.md 数据流门禁）

```
[创建提醒]
User 输入 → meta/assistant 子智能体（Drain）→ question 确认 → reminder_create 工具
  → ScheduleService.create（PermissionV2.assert action=reminder_create）
  → 事务写 ScheduleTable(pending, deliveryKey) → 事件 reminder.created
  → 提醒 Tab 查 ScheduleTable 渲染

[到期投递]
SchedulerDaemon.tick(分钟) → SchedulerCore 认领（租约条件更新 pending→running）
  → 幂等写 DeliveryTable(deliveryKey 唯一) + ScheduleTable→completed
  → 事件 reminder.delivered → 收件箱投影 → 桌面通知(best-effort)

[离线补投]
启动 → SchedulerDaemon.arm(recover:true) → 扫描逾期 pending
  → 按相同 deliveryKey 补投 → DeliveryTable(caught_up=true) → 事件 reminder.caught_up

[知识库写]
User → propose_note/kb_create → KBService
  → 事务写 kb_note + 扫描 wikilink → 写 kb_link(dangling 标记)
  → FTS5 索引更新 → 落盘 .md（内容真源，ADR-14 §2）
  → 事件 kb.note_created → 知识库 Tab 刷新
```

#### 3.8.2 Layer/Node 组合（复用 LayerNode 模式）

| 服务 | 依赖 | 组合方式 |
|---|---|---|
| `ScheduleService` | Database.node | `LayerNode.make(layer, [Database.node])` |
| `AssistantSchedulerDaemon` | ScheduleService + EventV2.node | 复用 `scheduled-job.ts:246-261` daemon 模式 |
| `KBService` | Database.node + EventV2.node | `LayerNode.make(layer, [Database.node, EventV2.node])` |
| `PersonalMemory` | Database.node | 独立 node |
| assistant 子智能体 | agent 注册（plugin/agent.ts）+ ScheduleService + KBService | 工具层依赖注入，不 new layer |

**关键约束**：所有 typed service 只经 LayerNode 组合；UI/模型不直接改表（PRD §7.1）。事件走 EventV2 已有 PubSub，不新建第二套事件系统。

#### 3.8.3 灰度、回滚与监控（PRD §13）

| 项 | 设计 |
|---|---|
| feature flag | `assistant_reminder`（Phase B 起）+ `assistant_kb`（Phase D 起），先内部 → 10% Beta → 全量 |
| 关闭 flag 语义 | 禁止创建新提醒/笔记，但保留列表、取消、已创建投递；不遗弃 pending/kb 数据 |
| 回滚约束 | 应用版本回滚保持 Schedule/kb 状态可读；migration forward-only（数据库 skill） |
| 停止灰度条件 | 重复投递、取消后误投、恢复丢失、跨用户数据泄露、wikilink 解析破坏 → 立即停 |
| Dashboard 监控 | 待执行数量、投递延迟分布、租约过期、重试、failed 数、重复约束冲突、悬空链接数；**不采集正文** |

#### 3.8.4 埋点事件（PRD §11，Phase F 落地）

| 阶段 | 事件 |
|---|---|
| M1 提醒 | `assistant_reminder_draft_started` / `confirmed` / `created` / `cancelled` / `delivered` / `caught_up` / `failed` |
| M2 记忆 | `assistant_memory_proposed` / `confirmed` / `rejected` / `injected` |
| M2 知识库 | `assistant_note_proposed` / `applied` / `rejected` / `kb_searched` |
| 约束 | 不记录提醒/笔记/记忆正文；日志脱敏 |

#### 3.8.5 跨模式委派接口（PRD §21）

- meta 委派目标保留：chat-orchestrator（做资产）、work-orchestrator（做文档）——经 `task` 工具 `subagent_type` 路由（task.ts:44，自由字符串）。
- 数据流：meta（Drain）→ `task` 工具 → permission.assert(action=task, resource=chat-orchestrator) → `createChild`+`delegate` → 结果 `delegateBackground` inject 回原会话。
- 无模式切换：子代理是父会话下子会话（ADR-11），从头到尾同一对话。
- 委派阈值：meta system prompt 引导"复杂才派、简单自干"（简单只读自干）。

---

### 3.9 页面布局（PRD §8/§19/§20）

#### 3.9.0 统一首页骨架（Home Shell）——四模式位置架构归一化

**调研结论**（对照 `mode-workspace.tsx`、`mode-workspace-slots.tsx`、`mode-surfaces.tsx`、`secondary-sidebar.tsx`）：四模式首页已事实共享同一容器网格（`mode-workspace.tsx:140-146`：`[280px 侧栏 + 720/960px 主区]`），但各模式内容结构不同。归纳出 **5 个可统一的位置架构约束**：

| 统一位置 | 四模式现状 | 统一规则 |
|---|---|---|
| **① 全局图标栏** | ModeSwitcher（`mode-switcher.tsx`，w-16） | 加**数字角标**支持（assistant 显示 pending 提醒数） |
| **② 左栏 = 该模式主对象导航树** | Chat=功能树（7 类资产）、Work=维度 Tab+会话、Coding=项目树、Assistant=占位 | 统一为"Location + 新建 + 主对象分层导航树" |
| **③ 主区顶部 = 标题区 + 新建按钮** | Work 已有（`:655-658`）、Coding 有搜索框 | 统一"模式名标题 + subtitle + 主操作按钮" |
| **④ 会话列表 = 共享管道** | Coding/Work 都用 `buildHomeSessionRecords + filterSessionsByMode + groupSessions + HomeSessionRow` | **完全共享**（Assistant 直接复用，零新代码） |
| **⑤ 列表空态规则** | Coding=空态+新建引导、Work=辅助区块空态隐藏 | 主心智区块空态显示引导；辅助区块空态隐藏 |

**Location 模块归一化**（用户提出，已确认）：除 Coding 的项目树（`HomeProjectColumn` 含项目地址列，是 Coding 专属）外，Chat/Work/Assistant 的 Location 模块结构相同（folder 图标 + 文件名 + folder-add-left 按钮 + 无 Location 提示）：

- Chat：内联在 `ChatSidebar`/`ChatFeatureSidebar`（`mode-surfaces.tsx:103-111`）
- Work：独立 `WorkLocationNewSession` 组件（`work-secondary-sidebar.tsx:162`）
- Assistant：**复用** `WorkLocationNewSession`（抽为共享组件 `ModeLocationNewSession`），替换内联重复

**结论**：抽取共享 `ModeLocationNewSession` 组件，Chat/Work/Assistant 三模式复用；Coding 保持 `HomeProjectColumn`（项目树含地址列是 Coding 主心智，不归一）。

#### 3.9.1 Assistant 首页（Personal Dashboard，替换 `PlaceholderMain`）

```
┌──────────────────────────────────────────────────────────────┐
│ Assistant Dashboard（主区，遵循统一骨架 ③④⑤）                 │
├──────────────────────────────────────────────────────────────┤
│ ① 顶部标题区：模式名 + subtitle + [新建助手对话]               │  ← 统一 ③
├──────────────────────────────────────────────────────────────┤
│ ② 待办提醒横条（主心智，始终显示）                            │
│    ⚠ [3 条待办 · 最近: 今天 09:00 跟进客户]      [查看全部→]  │
│    （点击展开 → 右栏提醒 Tab）                                │
├──────────────────────────────────────────────────────────────┤
│ ③ 最近笔记（辅助区块，空态隐藏）                              │  ← 统一 ⑤
│    [笔记A #tag] [笔记B] [笔记C]                               │
├──────────────────────────────────────────────────────────────┤
│ ④ 会话列表（复用共享管道，纯 Session 实体）                   │  ← 统一 ④
│    搜索 + 分组（Today/Yesterday/older）                       │
└──────────────────────────────────────────────────────────────┘
```

- 数据：② 来自 `ScheduleService.list(pending)`；③ 来自 `KBService.list(recent, 6)`；④ 来自 `buildHomeSessionRecords + filterSessionsByMode("assistant")`。
- 空状态：无提醒 → "还没有待办提醒，说'提醒我明天 9 点跟进客户'"引导文案（主心智不隐藏）。

#### 3.9.1b 全局图标栏角标（ModeSwitcher）

- `mode-switcher.tsx` assistant 图标右下角叠加 pending 提醒数角标（`ScheduleService.countPending()`）。
- 计数范围：`pending` 状态提醒数；>99 显示 "99+"；为 0 时隐藏角标。
- 跨模式可见（提醒是个人主动事项，非 assistant 模式专属）。
- 角标机制通用化：未来 Chat 资产数、Work 任务数可复用同一角标组件。

#### 3.9.1c 次级左栏：知识库导航树（替换 `PlaceholderSidebar`）

> ⚠️ **2026-08-13 超期说明**：次级左栏落地已并入 [assistant-session-detail-plan.md](assistant-session-detail-plan.md) 批次 2——`AssistantNavTree` 实体导航树在**首页左栏 + 详情次级左栏两处共用**，`PlaceholderSidebar` 由 `AssistantSessionSidebar`（Location + 会话列表 + 实体导航树）替换。本节保留为设计意图记录。

对齐 Chat 功能树（`ChatFeatureSidebar`）结构，内容换为知识库分类：

```
Assistant 次级左栏 (AssistantFeatureSidebar)：
┌────────────────────────────────┐
│ Location + 新建助手对话 [Add]    │  ← 统一 ②（复用 ModeLocationNewSession）
├────────────────────────────────┤
│ 知识库（对齐 Chat 功能树）       │
│  ├─ 📁 全部笔记            (42) │
│  ├─ # 工作                 (18) │
│  │   ├─ # 工作/项目A       (5)  │
│  │   └─ # 工作/项目B       (3)  │
│  ├─ # 个人                 (12) │
│  ├─ ⚠ 悬空链接             (3)  │  ← 零依赖机械检测结果
│  └─ 🗒 记忆条目             (25) │
└────────────────────────────────┘
```

- 树数据：`KBService.list` 按标签层级聚合 + 计数；悬空链接数 `KBService.countDangling`；记忆计数 `PersonalMemory.count`。
- 复用 Chat 功能树的树+计数渲染模式。

#### 3.9.2 右栏 Tab（`session-side-panel.tsx` 渐进式）

> ⚠️ **2026-08-13 超期说明**：渐进式右栏 Tab 已由 [assistant-session-detail-plan.md](assistant-session-detail-plan.md) 取代——改为**全量 5 Tab**（提醒/记忆/知识库/笔记编辑器/上下文），上下文 Tab 进 Tab 栏，A/B 归一化 B 区 fileTree 隐藏。本小节保留为历史设计过程记录。

| Tab | 布局 | 数据源 |
|---|---|---|
| 提醒 | 列表行：提醒文本 + 时间/时区 + 状态徽章 + [取消][修改]；底部历史 Delivery | `ScheduleService` / `DeliveryService` |
| 记忆 | Memory Inspector：分组卡片（explicit/derived/pending）+ 每卡片 [Edit][Delete][审计] | `PersonalMemory` |
| 知识库 | 上方搜索 + 标签筛；下方笔记列表 + 选中后正文 + 反向引用面板 + 悬空链接面板 | `KBService` + FTS5 |
| 笔记编辑器 | 双栏：左 Markdown 编辑（[[补全]]）/ 右实时预览；顶部标签编辑；悬空链接高亮提示 | `KBService` |

- 与 Code 模式一致：`session-context-tab.tsx` 复用为"上下文"Tab（零改动）。
- 候选审查（propose_note）：在消息流弹出 NoteCandidatePanel（复用 `prompt-asset-candidate.ts` 判别联合 + SuggestionBar"存为笔记"按钮）。

#### 3.9.3 源数据锚定问答（引文角标）

- AI 回答中 `[笔记ID]` 角标渲染为可点击，点击 → 展开笔记原文摘要 → 跳转知识库 Tab 定位。
- 空结果：AI 明确"你的知识库中没有相关记录"（不虚构）。

#### 3.9.4 Assistant 列表三层结构纵览

| 列表 | 全局角标 | 首页区块 | 次级左栏 | 右栏 Tab |
|---|---|---|---|---|
| 提醒 | ✅ pending 数 | ✅ 横条 | — | ✅ 提醒列表 |
| 笔记 | — | ✅ 最近笔记 | — | ✅ 笔记列表 |
| 知识库分类 | — | — | ✅ 导航树 | ✅ 知识库 Tab |
| 记忆 | — | — | ✅ 计数（树中） | ✅ Memory Inspector |
| 会话 | — | ✅ 底部 | ✅ 底部 | — |

**核心原则**：实体独立（提醒=Schedule、笔记=kb_note、记忆=personal_memory、会话=Session，永不混列表）；位置分层（高频主动→全局角标、导航→左栏树、详情→右栏 Tab、聚合→首页区块）；复用现有模式（树=Chat 功能树、会话=共享管道、Location=ModeLocationNewSession）。

---

## 4. 阶段划分

| Phase | 内容 | 退出条件 |
|---|---|---|
| **A 调度内核 + 基座** | 提取 SchedulerCore + Schedule/Delivery 表/Service + assistant 子智能体 + 全模式默认 meta（§3.1-3.3） | Core/数据库/安全评审通过；时间与崩溃测试完成 |
| **B 提醒闭环** | reminder_create/update/cancel 工具 + 收件箱（已读）+ 离线补投 + 桌面通知 + Assistant Dashboard/提醒 Tab | 内部 100 次提醒测试达标（PRD §11 Beta Gate） |
| **C 个人记忆** | personal_memory 表 + propose_memory + 待确认队列 + Memory Inspector + 注入约束（§3.4） | 记忆安全设计通过；提议+确认闭环 |
| **D 知识库** | kb_note/kb_link 表 + wikilink 解析 + 悬空检测 + 反向引用 + FTS5 + 文件落盘 + 文件监听（§3.5） | 双向链接机制测试通过；悬空检测零依赖验证 |
| **E 笔记 + AI 产物** | 笔记编辑器 + 模板/日记 + propose_note（note/summary/faq/timeline）+ 源数据锚定问答 + 引文角标（§3.7） | propose_note 各 format 输出正确；锚定问答防幻觉验证通过 |
| **F 打磨** | i18n（en/zh/zht，parity 约束）+ 埋点事件 + E2E + Dashboard 监控 | typecheck/lint/test 通过；PRD §14 验收全覆盖 |

---

## 5. 关键文件

| 文件 | 动作 |
|---|---|
| `packages/schema/src/schedule.ts` | 新增 (Schedule/Delivery Schema) |
| `packages/schema/src/personal-memory.ts` | 新增 (个人记忆 Schema) |
| `packages/schema/src/kb-note.ts` | 新增 (kb_note/kb_link Schema) |
| `packages/core/src/session/schedule-core.ts` | 新增 (SchedulerCore 提取) |
| `packages/core/src/session/schedule-service.ts` | 新增 (Schedule/Delivery Service) |
| `packages/core/src/session/schedule-sql.ts` | 新增 (ScheduleTable/DeliveryTable) |
| `packages/core/src/session/personal-memory.ts` | 新增 (个人记忆 Service) |
| `packages/core/src/kb/link.ts` | 新增 (wikilink 解析 + 悬空检测) |
| `packages/core/src/session/kb-service.ts` | 新增 (kb_note/kb_link Service) |
| `packages/core/src/tool/reminder-*.ts` | 新增 (reminder_create/update/cancel) |
| `packages/core/src/tool/propose-memory.ts` | 新增 (记忆提议) |
| `packages/core/src/tool/kb-*.ts` | 新增 (kb_create/search/read/update/delete/list_dangling) |
| `packages/core/src/tool/propose-note.ts` | 新增 (7 格式笔记候选) |
| `packages/core/src/agent/prompt/assistant-orchestrator.ts` | 新增 (assistant 子智能体) |
| **`packages/core/src/product-mode-agent-policy.ts`** | **修改 (全模式默认 meta: resolvePrimaryAgent:41 / checkPrimaryAgent:69)** |
| `packages/core/src/plugin/agent.ts` | 修改 (注册 assistant 子智能体; meta 权限收敛) |
| `packages/core/src/session/scheduled-job.ts` | 修改 (提取 SchedulerCore，行为不变) |
| `packages/core/src/database/migration/*.ts` | 新增 (schedule/delivery/personal_memory/kb_note/kb_link 迁移) |
| `packages/core/src/database/schema.gen.ts` | 重生成 |
| `packages/app/src/context/mode.tsx` | 修改 (modeDraft 返回 meta) |
| `packages/app/src/context/local.tsx` | 修改 (agent 列表过滤) |
| `packages/app/src/pages/mode-workspace-slots.tsx` | 修改 (AssistantDashboardMain + AssistantSidebar) |
| `packages/app/src/components/mode-surfaces.tsx` | 修改 (assistant 三槽位注册) |
| `packages/app/src/components/mode-switcher.tsx` | 修改 (assistant 角标: pending 数) |
| `packages/app/src/components/mode-location-new-session.tsx` | **新增 (共享 Location 模块, Chat/Work/Assistant 复用, 替换 WorkLocationNewSession)** |
| `packages/app/src/components/assistant-feature-sidebar.tsx` | 新增 (知识库导航树, 对齐 ChatFeatureSidebar) |
| `packages/app/src/pages/session/session-side-panel.tsx` | 修改 (提醒/记忆/知识库 Tab) |
| `packages/app/src/components/chat/prompt-asset-candidate.ts` | 修改 (扩展 note kind) |
| `packages/app/src/pages/work-asset-capture.ts` | 参考 (笔记候选提取) |
| `packages/app/src/i18n/en.ts` + `zh.ts` + `zht.ts` | 修改 (assistant.* 文案, parity 约束) |

---

## 6. 测试策略

| 层 | 覆盖 | 工具 |
|---|---|---|
| Schema | Schedule/Delivery/kb_note 类型负测试 | `bun --cwd packages/schema test` |
| Core 调度 | 认领/取消并发/崩溃恢复/幂等重试/逾期补投（TestClock + 就绪信号，不用 sleep） | `bun --cwd packages/core test` |
| Core 知识库 | wikilink 解析歧义/悬空检测/反向引用推导/同名冲突/FTS5 中文分词 | `bun --cwd packages/core test` |
| Core 记忆 | 提议+确认/derived 不注入/敏感不入库 | `bun --cwd packages/core test` |
| App | MODE_SURFACES 注册/提醒 Tab/笔记编辑器渲染 | 组件测试 |
| E2E | /mode/assistant 设提醒→确认→投递→收件箱；记笔记→知识库回查 | Playwright |

**命令**（CLAUDE.md 测试规范）：
```bash
bun --cwd packages/schema test
bun --cwd packages/core test --timeout 30000
bun --cwd packages/app test
bun --cwd packages/core typecheck
bun run script/lint-changed.ts
```

**时间并发测试**：使用 TestClock/`pollWithTimeout`/`Deferred` 就绪信号，禁止 `Effect.sleep(N)`（AGENTS.md Testing）。

---

## 7. 验收清单

- [ ] `/mode/assistant` 显示 Dashboard（待执行提醒 + 最近投递 + 会话列表），非 Placeholder
- [ ] "明天上午9点提醒我跟进客户" → 解析内容/时间/时区 → 确认后创建
- [ ] 提醒可修改/取消；取消后不投递；同一 deliveryKey 无重复投递
- [ ] 进程重启 → 逾期 pending 补投（is_caught_up 标记）
- [ ] 收件箱可读标记；桌面通知失败不回滚投递
- [ ] 全模式默认 meta：coding/chat/work/assistant 新建会话 agent=meta
- [ ] meta 权限收敛：无 bash/edit/write；写操作委派 build
- [ ] assistant 子智能体：reminder_*/kb_*/memory_* 可执行，bash/edit/write 拒绝
- [ ] 记忆"提议+确认"：derived 默认 pending，不注入；确认后可注入
- [ ] 知识库：`[[wikilink]]` 解析、悬空检测、反向引用、FTS5 中文搜索
- [ ] 笔记：propose_note 生成候选 → 审查 → 确认落盘；`.md` 文件落盘 Obsidian 兼容
- [ ] 源数据锚定问答：仅基于 kb_note 回答 + 引文角标跳转
- [ ] i18n en/zh/zht + parity；埋点事件（PRD §11）；日志不泄正文
- [ ] 时间/崩溃/并发测试用 TestClock/就绪信号，无固定 sleep

---

## 8. 估算

| Phase | 估时 |
|---|---|
| A 调度内核 + 基座 | 4d |
| B 提醒闭环 | 4d |
| C 个人记忆 | 3d |
| D 知识库 | 4d |
| E 笔记 + AI 产物 | 4d |
| F 打磨 | 2d |
| **总计** | **21d** |

---

## 9. 风险与应对

| 风险 | 概率 | 影响 | 应对 |
|---|---|---|---|
| SchedulerCore 提取破坏现有 Work 调度 | 中 | 高 | 提取后跑 `scheduled-job` 现有测试回归；行为不变是硬约束 |
| 记忆注入 System Context 失控 | 中 | 高 | §3.4 确认门控 + 注入预算受 CacheShape 纪律 |
| wikilink 解析歧义（同名） | 中 | 中 | 同作用域标题唯一；M3 引入路径消歧 |
| FTS5 中文分词质量 | 中 | 中 | 用 SQLite FTS5 内置 tokenizer + 验收测试覆盖中英文 |
| 笔记编辑器工程量超预期 | 高 | 中 | M1 复用右栏画布（WorkArtifactPanel 模式），不引入重型编辑器 |
| 全模式默认 meta 影响 chat/work 既有行为 | 中 | 高 | 保留 orchestrator 定义；灰度期可回切（feature flag） |
