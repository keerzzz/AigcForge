# Assistant 会话详情页 + 首页归一化 · TDD 执行提示词（自包含手册）

> **用途**：粘贴到新对话作为初始 prompt，驱动独立 agent 完整执行 [Assistant 会话详情页 + 首页归一化实施计划](assistant-session-detail-plan.md)（批次 1-4）。
> **来源**：[实施计划](assistant-session-detail-plan.md)（范围真源）、[Assistant PRD v4](../prd/assistant-mode-personal-agent.md)（§8 已同步本次决策）、[Work 模式会话详情页计划](work-mode-session-sidebar-plan.md)（右栏归一化参考）、上级 [Assistant 模式实施计划](assistant-mode-implementation.md)
> **分支**：`assistant-session-detail`（从最新 `assistant` 切出）
> **完成标准**：§7 验收清单全过 + typecheck/lint/test 绿

---

下面是直接粘贴给新对话的提示词正文（复制 `<!-- PROMPT START -->` 到 `<!-- PROMPT END -->` 之间的内容）：

<!-- PROMPT START -->

你是 AigcForge 项目的高级全栈工程师。本提示词让你**独立、端到端**执行 [Assistant 会话详情页 + 首页归一化实施计划](docs/plan/assistant-session-detail-plan.md)（DRAFT，G0-G4 已过）。范围真源是那份计划，本提示词是执行手册。开工前必须通读：`CLAUDE.md`、`AGENTS.md`、`ARCHITECTURE.md`、`packages/app/AGENTS.md`、`.aigcfroge/skills/frontend-theming/SKILL.md`、`DESIGN.md`，以及 PRD `docs/prd/assistant-mode-personal-agent.md` §8。

---

## 0. 你的任务（一句话）

补齐 assistant 会话详情页的空壳（次级左栏/右栏当前是 `PlaceholderSidebar`/`PlaceholderPanel`）并归一化首页骨架：详情右栏做 5-Tab 实体面板（fileTree 不渲染，无 B 区空占位）、次级左栏做富结构、首页左栏做实体导航树且会话列表联动、补知识库反向引用端点和双栏笔记编辑器、落地引文锚定，全部按 TDD 红→绿→重构推进。

## 1. 范围与禁区

### 1.1 范围（批次 1-4 只做这些）
- **1 右栏骨架 + 3 Tab**：抽 ReminderList/MemoryInspector 共享组件；AssistantSessionPanel 骨架 + 槽位接入（fileTree 不渲染）+ 宽度机制（手动开+拖拽）；提醒/记忆/上下文 Tab；上下文圆环 toggle；`openEntityPanel` 信号
- **2 左栏 + 联动**：AssistantNavTree 实体导航树；首页左栏 + 详情次级左栏共用；主区会话列表联动左栏实体列表（提醒/记忆高亮，知识库退化全量）
- **3 知识库 + 编辑器**：`GET /kb/:id/backlinks` 端点；知识库 Tab；双栏编辑器（`[[补全]]`/预览/悬空高亮）
- **4 引文锚定**：timeline `[笔记ID]` 角标 → 右栏知识库 Tab 定位；assistant-orchestrator prompt 引用格式配套

### 1.2 禁区（违反即返工，绝对不做）
- ❌ **不收敛首页主区**——Dashboard 的 Memory Inspector/知识库编辑器保持现状，不在主区与右栏叠加两套完整操作 UI
- ❌ **不新造会话列表管道**——复用 `buildHomeSessionRecords + filterSessionsByMode`，只加 filter/highlight 参数
- ❌ **不给 assistant 右栏留 B 区 fileTree 空占位**——隐藏即不渲染（display:none / 条件渲染）
- ❌ **不重做 timeline/composer**——中栏维持通用实现，引文锚定在现有 renderer 上扩展
- ❌ 不做记忆"注入上下文"接线（`listConfirmed` 无 runner 消费者，独立跟踪）
- ❌ 不做模板/日记/format 扩展（上级计划 Phase E 已有）
- ❌ 不隐藏 TerminalPanel（已决策保留现状）

## 2. 设计决策（已定案，必须遵守）

### 2.1 D1 · 右栏 AssistantSessionPanel（计划 §3.1，F1 修正）
- `session-side-panel.tsx:454` assistant slot：`PlaceholderPanel` → `AssistantSessionPanel`（5-Tab）。
- 自包含单面板：手动开 + ResizeHandle 拖拽（min 宽 480px，双栏编辑器需要）；fileTree 不在此槽位渲染（无 B 区空占位）。
- **不依赖 work 批次4**（Draft 未实施，无共享 A/B 骨架）——assistant 槽位独立渲染，与未来批次4 归一化不冲突。
- Tab 栏 5 个：提醒 | 记忆 | 知识库 | 笔记编辑器 | 上下文；拥挤则横向滚动或分组（实体 Tab + 上下文分组）。

### 2.2 D2 · 上下文 Tab ↔ 圆环 toggle（计划 §3.1）
- 复用 `session-context-usage.tsx:51-63` 模式：中栏标题右侧用量圆环点击开/关上下文 Tab。
- 上下文 Tab 内容复用 `session-context-tab.tsx`，零改动。

### 2.3 D3 · `openEntityPanel` 信号（计划 §3.1）
- 对齐 `open-session-context.ts` 泛化：`openEntityPanel(kind, itemId)` 打开右栏指定 Tab 并定位条目。
- 调用方：左栏实体列表点击（批次 2）+ 引文角标（批次 4）。

### 2.4 D4 · 实体导航树（计划 §3.2）
- `AssistantNavTree` 对齐 `ChatFeatureSidebar`（树 + 计数）。
- 数据：提醒= `schedule.pending` 计数；记忆= `memory.list` 计数；知识库= `kb.list` 按 tags 层级聚合 + 计数；悬空= `kb.dangling` 计数。
- 首页左栏（`mode-surfaces.tsx` assistant Sidebar slot）与详情次级左栏（`secondary-sidebar.tsx:678`）共用同一组件，`useChatDirectory` 提供 directory。

### 2.5 D5 · 会话列表联动（计划 §3.3）
- 首页主区会话列表（`assistant-dashboard.tsx:473`）与左栏实体列表联动。
- 提醒/记忆有会话反链（`Schedule.Info.sessionID` / `sourceSessionID`）→ 高亮/过滤来源会话。
- 知识库笔记无会话反链 → 点击知识库节点退化为全量。
- 实现：新增 `AssistantSelectionCtx`（复用 `mode-workspace.tsx:22-30` CodingSelectionCtx 模式），左栏导航树写选中态，主区 `records` 读选中态加 filter/highlight，不新造列表。

### 2.6 D6 · 知识库 Tab + 双栏编辑器（计划 §3.4）
- 知识库 Tab：搜索 + 标签筛 + 笔记列表 + 选中正文 + 反向引用 + 悬空链接。
- 反向引用走**新端点** `GET /kb/:id/backlinks`（`KBService.backlinks` 服务方法已有，`packages/aigcfroge/.../groups/kb.ts` 未暴露，需补）。
- 双栏编辑器：左 Markdown 编辑（`[[补全]]` 从现有标题索引补全）+ 右实时预览 + 悬空高亮；顶部标题/标签编辑。编辑器只在右栏。

### 2.7 D7 · 位置分层裁定（计划 §3.5）
- 主区=聚合层（现状不收敛）；右栏=详情层（会话内操作）；左栏=导航层（计数/树）。
- 同一屏幕不放两套完整操作 UI；详情操作收敛右栏，首页主区操作保留为快路径。

### 2.8 D8 · 引文锚定（计划 §3.6，F2 修正）
- **跨包门控**：assistant 文本经 `packages/session-ui/src/components/message-part.tsx`（跨模式共享包）渲染；角标检测**仅 assistant 会话启用**（mode 门控）+ session-ui 回归，coding/chat/work 文本渲染不受影响。优先 app 层 timeline 后处理，避免改共享渲染路径。
- timeline 渲染层识别 `[笔记ID]` 标记 → 可点击角标 → 展开摘要 → `openEntityPanel("kb", id)`。
- `assistant-orchestrator.ts` prompt 补充引用输出格式约定，与 renderer 解析配套。
- 宽容解析：匹配不上则不渲染角标，不阻塞回答；无记录时明说不编造（现有 prompt 已约束）。

## 3. 代码锚点（已核实，直接用）

| 能力 | 位置 | 动作 |
|---|---|---|
| 首页两栏骨架 | `packages/app/src/pages/mode-workspace.tsx:139-145`（grid-cols-[280px_minmax(0,960px)]） | 首页只改左栏/主区 slot，不加右栏 |
| 首页 surface 注册 | `packages/app/src/components/mode-surfaces.tsx:324-328` | assistant Sidebar → 实体导航树 |
| 首页富聚合 | `packages/app/src/pages/assistant-dashboard.tsx` | 抽取 ReminderList/MemoryInspector 共享组件 + 会话列表联动 |
| 详情右栏 slot | `packages/app/src/pages/session/session-side-panel.tsx:447-456` | assistant slot → AssistantSessionPanel; fileTree 不渲染 |
| 详情次级左栏 | `packages/app/src/components/secondary-sidebar.tsx:678` | PlaceholderSidebar → AssistantSessionSidebar |
| 上下文圆环 | `packages/app/src/components/session-context-usage.tsx:51-63` | 复用 toggle 模式 |
| 上下文 Tab | `packages/app/src/components/session/session-context-tab.tsx` | 零改动复用 |
| 面板打开信号范式 | `packages/app/src/components/open-session-context.ts` + `open-session-context.tsx` | 泛化为 openEntityPanel |
| 会话共享管道 | `packages/app/src/pages/layout/helpers.ts`（buildHomeSessionRecords/filterSessionsByMode/groupSessions） | 复用，不新造 |
| 实体 API | `schedule.pending/list/cancel`、`delivery.recent/inbox/read`、`memory.*`、`kb.*`（server-sdk client） | 直接调用 |
| 知识库反向引用 | `packages/core/src/session/kb-service.ts:95`（backlinks）+ `packages/aigcfroge/src/server/routes/instance/httpapi/groups/kb.ts` | 补 GET /kb/:id/backlinks |
| 树渲染范式 | `packages/app/src/components/mode-surfaces.tsx:262-280`（ChatFeatureSidebar 树+计数） | AssistantNavTree 类比 |
| 引文 renderer | `packages/app/src/pages/session/timeline/*`（现有 message renderer） | 扩展角标 |
| assistant prompt | `packages/core/src/agent/prompt/assistant-orchestrator.ts` | 加引用格式约定 |
| i18n | `packages/app/src/i18n/en.ts` + `zh.ts` + `zht.ts` | assistant.* 文案（parity 约束） |

## 4. 测试策略（AGENTS.md + CLAUDE.md 强制）

| 层 | 覆盖 | 命令 |
|---|---|---|
| App 组件 | 右栏 Tab 渲染/fileTree 不渲染/宽度拖拽/导航树计数/联动过滤 | `bun --cwd packages/app test` |
| Aigcfroge API | `GET /kb/:id/backlinks` 契约 | `bun --cwd packages/aigcfroge test` |
| E2E | /mode/assistant 首页左栏树→会话列表联动；详情右栏 5-Tab 打开/关闭/定位 | Playwright |

**强制**：右栏 B 区隐藏后无空占位 DOM；联动高亮不破坏会话列表共享管道；禁止固定 `Effect.sleep`。typecheck 用 `bun --cwd packages/<name> typecheck`（tsgo --noEmit），不直接调 tsc。

## 5. 阶段顺序（TDD 红→绿→重构）

1. **批次 1**：抽 ReminderList/MemoryInspector 共享组件 → AssistantSessionPanel 骨架 + 槽位接入 + 宽度拖拽 → 提醒/记忆/上下文 Tab → 圆环 toggle → openEntityPanel
2. **批次 2**：AssistantNavTree → 首页左栏 + 详情次级左栏接入 → 会话列表联动（高亮/退化）
3. **批次 3**：backlinks 端点 → 知识库 Tab → 双栏编辑器（[[补全]]/预览/悬空高亮）
4. **批次 4**：引文角标 renderer → prompt 引用格式配套 → 跳转闭环

每个批次完成后跑 `bun --cwd packages/app test`；跨批次前跑受影响包 typecheck。

## 6. 完成标准（对齐计划 §7 验收清单）

- [ ] 首页保持两栏（左栏实体导航树 + 主区富聚合），无右栏
- [ ] 首页左栏非 Placeholder，实体导航树显示提醒/记忆/知识库分类 + 计数
- [ ] 首页主区会话列表点击左栏提醒/记忆 → 高亮来源会话；点击知识库 → 退化全量
- [ ] 详情页次级左栏非 Placeholder（Location + 会话列表 + 实体导航树）
- [ ] 详情右栏 5-Tab 全量（提醒/记忆/知识库/笔记编辑器/上下文），B 区 fileTree 隐藏不渲染
- [ ] 右栏手动开 + ResizeHandle 拖拽；右上角 X 关闭
- [ ] 上下文 Tab 圆环 toggle（复用 session-context-usage）
- [ ] 左栏实体列表点击 → `openEntityPanel` 开右栏对应 Tab 并定位
- [ ] 知识库 Tab：搜索/标签筛/列表/正文/反向引用/悬空链接全闭环（backlinks 端点可用）
- [ ] 双栏编辑器：Markdown 编辑 + `[[补全]]` + 实时预览 + 悬空高亮
- [ ] 引文锚定：`[笔记ID]` 角标点击 → 右栏知识库 Tab 定位
- [ ] i18n en/zh/zht + parity；typecheck/lint/test 绿
- [ ] **桌面端手动 E2E**：按 [实施计划 §10 桌面端 E2E 手动测试流程](assistant-session-detail-plan.md#10-桌面端-e2e-手动测试流程验收标准) 全部通过（批次 1-4 + 横切）

<!-- PROMPT END -->
