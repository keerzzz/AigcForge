# Assistant 模式实施 · TDD 执行提示词（自包含手册）

> **用途**：粘贴到新对话作为初始 prompt，驱动独立 agent 完整执行 [Assistant 模式实施计划](assistant-mode-implementation.md)（Phase A-F）。
> **来源**：[实施计划](assistant-mode-implementation.md)（范围真源）、[Assistant PRD v4](../prd/assistant-mode-personal-agent.md)、[元智能体调度架构讨论总结](../research/agent/元智能体调度架构讨论总结.md)（meta 契约）、[双向链接与防幻觉机制调研](../research/agent/AigcForge-双向链接与防幻觉机制调研.md)
> **后续**：本提示词覆盖 Phase A-F（已合入）。会话详情页布局（§2.6 D6 的右栏 Tab）已拆分为独立工作，见 [assistant-session-detail-plan.md](assistant-session-detail-plan.md) + [assistant-session-detail-tdd-prompt.md](assistant-session-detail-tdd-prompt.md)。
> **分支**：`assistant`（从最新 main 切出）
> **完成标准**：§9 验收清单全过 + typecheck/lint/test 绿

---

下面是直接粘贴给新对话的提示词正文（复制 `<!-- PROMPT START -->` 到 `<!-- PROMPT END -->` 之间的内容）：

<!-- PROMPT START -->

你是 AigcForge 项目的高级全栈工程师。本提示词让你**独立、端到端**执行 [Assistant 模式实施计划](docs/plan/assistant-mode-implementation.md)（DRAFT，G0-G4 已过）。范围真源是那份计划，本提示词是执行手册。开工前必须通读：`CLAUDE.md`、`AGENTS.md`、`ARCHITECTURE.md`、`CONTEXT.md`、`packages/core/src/tool/AGENTS.md`、`.aigcfroge/skills/effect/SKILL.md`、`.aigcfroge/skills/database/SKILL.md`、`.aigcfroge/skills/frontend-theming/SKILL.md`、`.aigcfroge/skills/protocols/SKILL.md`，以及调研文档 `docs/research/agent/元智能体调度架构讨论总结.md`。

---

## 0. 你的任务（一句话）

让 `mode=assistant` 从三槽位 Placeholder 变为"个人主动事项 + 长效上下文"完整闭环：提取调度内核建 Schedule/Delivery 表、全模式默认 meta + assistant 子智能体（fail-closed）、单次提醒闭环、个人记忆（提议+确认）、Obsidian 式双向链接知识库、对话生成笔记（propose_note），全部按 TDD 红→绿→重构推进。

## 1. 范围与禁区

### 1.1 范围（Phase A-F 只做这些）
- **A 调度内核+基座**：提取 `SchedulerCore` + Schedule/Delivery 表/Service + assistant 子智能体 + 全模式默认 meta
- **B 提醒闭环**：reminder_create/update/cancel + 收件箱（已读）+ 离线补投 + 桌面通知 + Dashboard/提醒 Tab
- **C 个人记忆**：personal_memory 表 + propose_memory + 待确认队列 + Memory Inspector + 注入约束
- **D 知识库**：kb_note/kb_link 表 + wikilink 解析 + 悬空检测 + 反向引用 + FTS5 + 文件落盘 + 文件监听
- **E 笔记 + AI 产物**：笔记编辑器 + 模板/日记 + propose_note + 源数据锚定问答 + 引文角标
- **F 打磨**：i18n（en/zh/zht + parity）+ 埋点事件 + E2E + Dashboard 监控

### 1.2 禁区（违反即返工，绝对不做）
- ❌ 不新建第二套调度器——`scheduled-job.ts` 内核必须提取复用，不复制（G1）
- ❌ **不 deny `task` 工具**（P1）：`deny bash/edit/write` 仅限 meta 直接调用；写操作委派 build 是子代理权限域，deny task 会锁死委派
- ❌ 不让 assistant 子智能体继承宽权限——必须 fail-closed（G2）
- ❌ 不做记忆"自编辑自动注入"——只允许"提议+确认"（PRD §9，G3）
- ❌ **不引入秒级调度**（P2）：提醒用 dueAt 绝对时间戳 + 分钟级 tick，`Schedule.spaced("1 minute")`
- ❌ **不引入自定义中文 tokenizer**（P3）：FTS5 用 `unicode61` + LIKE 兜底，jieba 留 M3+
- ❌ 不把 IM 桥接提前到 Phase A-F（M4 单独立项）
- ❌ 不复制 Session 页面——复用 ADR-12 canonical route + ModeWorkspace
- ❌ 不做向量检索 RAG、图谱、闪卡、思维导图（M3）
- ❌ 不修改 V1 代码 / 不迁移 `memory.ts`（MetaAgent 项目级记忆保持原样）

## 2. 设计决策（已定案，必须遵守）

### 2.1 D1 · 调度内核复用（对齐实施计划 §3.1 + P2）
- `SchedulerCore`：从 `scheduled-job.ts:76-102`（arm/recover）+ `:246-261`（daemonLayer）抽象表无关的扫描+认领+恢复循环；`nextRun` 直接导入 `schedule.ts:103`
- 新层：`ScheduleTable`/`DeliveryTable`（snake_case，PRD §7.1 字段）+ `ScheduleService`（typed create/query/cancel/claim/recover）+ `DeliveryService`（幂等投递 + deliveryKey 唯一 + 收件箱已读 + caughtUp 标记）+ `AssistantSchedulerDaemon`
- 提醒用 `dueAt` 绝对时间戳 + 分钟级 tick（`Schedule.spaced("1 minute")`，满足 PRD §11 在线及时率 60s）
- **回归硬指标**：提取后 `scheduled-job.ts` 现有测试全绿（行为不变）

### 2.2 D2 · 全模式默认 meta + meta 权限收敛（对齐实施计划 §3.2 + P1）
- `product-mode-agent-policy.ts:41` `resolvePrimaryAgent("chat"/"work")` → meta；`:69` `checkPrimaryAgent` 允许 meta + orchestrator 作委派目标
- `mode.tsx:61` `modeDraft("chat"/"work")` → meta；`local.tsx:74-76` 移除"required 只显示 orchestrator"过滤
- meta 权限：`allow read/glob/grep/websearch/webfetch/question/task/list_assets/plan_enter`；`deny bash/edit/write`（**仅直接调用**，`task` 保持 allow——P1）
- orchestrator 定义/权限/prompt 全部保留，作 `task` 委派目标（做资产→chat-orchestrator、做文档→work-orchestrator）

### 2.3 D3 · assistant 子智能体（对齐实施计划 §3.3）
- 类比 `chat-orchestrator.ts` 新建 `assistant-orchestrator.ts`，fail-closed：
  - `deny *:*`（catch-all）
  - `allow read/glob/grep/websearch/webfetch/question`
  - `allow reminder_*`（Phase B）/ `kb_*`+`propose_note`（Phase D/E）/ `memory_*`（Phase C）
  - `deny bash/edit/write/task_spawn/task_schedule`
- 注册 `plugin/agent.ts`（类比 chat-orchestrator :320）；system prompt 要点：提醒/记忆/笔记确认后才创建、明确有联网搜索、时间歧义必确认

### 2.4 D4 · 记忆"提议+确认"（对齐实施计划 §3.4 + G3）
- `personal_memory` 表（用户级跨项目，snake_case，来源/信任/敏感等级）
- `propose_memory` 生成候选（explicit/derived）；derived 默认 pending **不注入** System Context
- Memory Inspector 面板 Approve/Edit/Reject；仅确认后条目可注入 prefix，CacheShape 预算
- **区分**：现有 `memory.ts` 绑 meta_agent_id 是 MetaAgent 项目级事实，**不动**；本实施新增用户级个人记忆

### 2.5 D5 · 知识库双向链接（对齐实施计划 §3.5 + P3）
- `kb_note`（title 唯一同作用域 + content + scope + tags + aliases + format）+ `kb_link`（source/target/link_type/dangling）
- wikilink 写入时解析 `[[title]]` → 建/更新 kb_link；悬空检测零依赖机械校验；反向引用单边存储+索引推导
- FTS5 `unicode61` + LIKE 兜底（**不引入自定义 tokenizer**——P3）；验收覆盖中英文
- `.md` 落 `<Global.Service.config>/knowledge-base/` 或 `<Location>/.aigcfroge/knowledge-base/`（内容真源 ADR-14 §2）；ConfigWatcher 监听重建索引

### 2.6 D6 · 页面布局（对齐实施计划 §3.9）
- 统一首页骨架：全局图标栏角标 + 左栏导航树 + 主区标题区 + 会话列表共享管道 + 空态规则
- Location 模块归一化：抽取共享 `ModeLocationNewSession`（Chat/Work/Assistant 复用；Coding 保持 `HomeProjectColumn`）
- Assistant 首页：提醒横条（主心智，始终显示）+ 最近笔记（空态隐藏）+ 会话列表（共享管道）
- 次级左栏：知识库导航树（对齐 ChatFeatureSidebar）
- 右栏 Tab：提醒/记忆/知识库/笔记编辑器（`session-context-tab.tsx` 复用为上下文）

## 3. 代码锚点（已核实，直接用）

| 能力 | 位置 | 动作 |
|---|---|---|
| 调度内核参考 | `packages/core/src/session/scheduled-job.ts:60-62,76-102,224,246-261` | 提取 SchedulerCore（只读参考 + 抽取） |
| cron 解析 | `packages/core/src/session/schedule.ts:103`（`nextRun`） | 直接导入（纯函数） |
| TaskTable 列参考 | `packages/core/src/session/sql.ts:138-145`（scheduled_at/recurrence/depends_on） | 类比 ScheduleTable |
| 模式策略 | `packages/core/src/product-mode-agent-policy.ts:41,69,109` | 修改（全模式默认 meta + P1） |
| meta 注册 | `packages/core/src/plugin/agent.ts:407`（meta）+ `:320`（chat-orchestrator 范式） | 注册 assistant 子智能体 + meta 权限收敛 |
| assistant 子智能体范式 | `packages/core/src/agent/prompt/chat-orchestrator.ts` | 类比创建 |
| 现有 MetaAgent memory | `packages/core/src/agent/meta/memory.ts`（NotMetaSessionError + findBySession） | 只读参考，不迁移；新增个人记忆独立表 |
| 迁移范式 | `packages/core/src/database/migration/20260806061818_add_task_revision.ts` | 格式参考（forward-only，禁 down） |
| 事件模式 | `packages/core/src/session/todo.ts`（TodoUpdated 转发） | kb/delivery 事件类比 |
| 测试基座 | `packages/core/test/lib/effect.ts`（it/testEffect/pollWithTimeout） | 测试基础设施 |
| 系统上下文 | `packages/core/src/system-context/builtins.ts` | 记忆注入源 |
| Layer 组合 | `packages/core/src/effect/layer-node.ts` | ScheduleService/KBService node |
| 提案候选链路 | `packages/app/src/components/chat/prompt-asset-candidate.ts` + `packages/app/src/pages/work-asset-capture.ts` | propose_note 复用 |
| 首页骨架 | `packages/app/src/pages/mode-workspace.tsx:140-146` + `mode-workspace-slots.tsx` + `mode-surfaces.tsx:322` | Assistant 槽位替换 Placeholder |
| 共享 Location | `packages/app/src/components/work-secondary-sidebar.tsx:162`（WorkLocationNewSession） | 抽取 ModeLocationNewSession |
| 图标栏 | `packages/app/src/components/mode-switcher.tsx` | 加 assistant 角标 |
| i18n | `packages/app/src/i18n/en.ts` + `zh.ts` + `zht.ts` | assistant.* 文案（parity 约束） |

## 4. 测试策略（AGENTS.md + CLAUDE.md 强制）

| 层 | 覆盖 | 命令 |
|---|---|---|
| Schema | Schedule/Delivery/kb_note 类型负测试 | `bun --cwd packages/schema test` |
| Core 调度 | 认领/取消并发/崩溃恢复/幂等重试/逾期补投 | `bun --cwd packages/core test --timeout 30000` |
| Core 知识库 | wikilink 歧义/悬空检测/反推/同名冲突/FTS5 中文 | 同 core test |
| Core 记忆 | 提议+确认/derived 不注入/敏感不入库 | 同 core test |
| App | MODE_SURFACES 注册/提醒 Tab/笔记编辑器 | `bun --cwd packages/app test` |
| E2E | /mode/assistant 设提醒→投递→收件箱；记笔记→回查 | Playwright |

**强制**：时间并发测试用 TestClock/`pollWithTimeout`/`Deferred` 就绪信号，**禁止 `Effect.sleep(N)`**（AGENTS.md）。typecheck 用 `bun --cwd packages/<name> typecheck`（tsgo --noEmit），不直接调 tsc。

## 5. 阶段顺序（TDD 红→绿→重构）

1. **Phase A**：SchedulerCore 提取（先跑 scheduled-job 回归证明行为不变）→ Schedule/Delivery 表/Service → assistant 子智能体 → 全模式默认 meta
2. **Phase B**：reminder 工具 → 收件箱 → 补投 → 桌面通知 → Dashboard/提醒 Tab
3. **Phase C**：personal_memory → propose_memory → 待确认队列 → Memory Inspector → 注入约束
4. **Phase D**：kb_note/kb_link → wikilink → 悬空检测 → 反推 → FTS5 → 落盘 → 监听
5. **Phase E**：笔记编辑器 → 模板/日记 → propose_note → 锚定问答 → 引文角标
6. **Phase F**：i18n + 埋点 + E2E + Dashboard 监控

每个 Phase 完成后跑该包测试；跨 Phase 前跑受影响包 typecheck。

## 6. 完成标准（对齐实施计划 §7 验收清单）

- [ ] `/mode/assistant` 显示 Dashboard（提醒横条 + 最近笔记 + 会话列表），非 Placeholder
- [ ] 全模式默认 meta：coding/chat/work/assistant 新建会话 agent=meta；meta 无 bash/edit/write 直接权限但 `task` 保留
- [ ] assistant 子智能体 fail-closed：reminder_*/kb_*/memory_* 可执行，bash/edit/write 拒绝
- [ ] "明天上午9点提醒我跟进客户"→ 解析内容/时间/时区 → 确认 → 到期投递 → 重启补投，重复=0
- [ ] 记忆"提议+确认"：derived 默认 pending 不注入；确认后可注入
- [ ] 知识库：`[[wikilink]]` 解析、悬空检测、反向引用、FTS5 中文（unicode61+LIKE）
- [ ] 笔记：propose_note 候选 → 审查 → 确认落盘；`.md` Obsidian 兼容
- [ ] 源数据锚定问答：仅基于 kb_note 回答 + 引文角标
- [ ] Location 模块归一化：Chat/Work/Assistant 复用 ModeLocationNewSession
- [ ] i18n en/zh/zht + parity；埋点事件；日志不泄正文
- [ ] typecheck/lint/test 绿；时间并发测试无固定 sleep

<!-- PROMPT END -->
