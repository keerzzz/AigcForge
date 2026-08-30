# Assistant 会话详情页 + 首页归一化实施计划

> 状态：**Draft — 待审批**
> 范围：`packages/app`（主）+ `packages/aigcfroge`（补 `backlinks` 端点）+ `packages/core`（引文契约）
> 关联：[Assistant PRD v4](../prd/assistant-mode-personal-agent.md)（范围真源，§8 已同步本次决策）、[Assistant 模式实施计划](assistant-mode-implementation.md)（本计划的上级，Phase A-F 已合入）、[Work 模式会话详情页计划](work-mode-session-sidebar-plan.md)（右栏归一化架构参考）、[Assistant 路线图](assistant-mode-roadmap.md)
> 依据：`CLAUDE.md`、`DESIGN.md`、`frontend-theming` skill、`packages/app/src/pages/session.tsx` + `session-side-panel.tsx` + `secondary-sidebar.tsx` + `mode-workspace.tsx` + `assistant-dashboard.tsx` 实际代码
> 分支：assistant 后续切 `assistant-session-detail`
> 最后更新：2026-08-13

---

## 0. 审批状态与执行 Gate

| Gate                   | 条件                                                                                                                                    | 状态   | 阻塞范围 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- |
| **G0 范围真源**        | PRD §8.1/§8.2 已更新（首页两栏 + 会话列表联动 + 详情 5-Tab + 交互模型）                                                                 | 待审批 | 全部批次 |
| **G1 共享组件抽取**    | Dashboard 的 ReminderList/MemoryInspector 抽为共享组件，首页与详情右栏两处复用，不复制                                                  | 待审批 | 批次 1   |
| **G2 右栏单面板**      | assistant 槽位渲染 `AssistantSessionPanel`（手动开+拖拽），fileTree 不渲染（无 B 区空占位）；自包含不依赖 work 批次4（未实施，F1 修正） | 待审批 | 批次 1   |
| **G3 实体导航树**      | 首页左栏 + 详情次级左栏实体导航树（对齐 ChatFeatureSidebar），会话列表联动左栏实体列表                                                  | 待审批 | 批次 2   |
| **G4 编辑器/引文契约** | 双栏编辑器 + `[[补全]]` + 引文锚定；assistant-orchestrator prompt 引用输出格式约定配套                                                  | 待审批 | 批次 3/4 |

**与既有代码的边界（必须遵守）**：

- ❌ 不收敛首页主区——Dashboard 的 Memory Inspector/知识库编辑器**保持现状**，操作不在主区与右栏两处重复叠加（§3.5 位置分层裁定：主区=聚合+快速操作，右栏=会话内详情）
- ❌ 不新建第二套会话列表管道——复用 `buildHomeSessionRecords + filterSessionsByMode`
- ❌ 不让 assistant 右栏出现 B 区 fileTree 空占位——隐藏即不渲染
- ❌ 不重做通用 timeline/composer——中栏维持现状，引文锚定在现有 renderer 上扩展

---

## 1. 目标、非目标与本次收敛

### 1.1 目标

补齐 assistant 会话详情页（当前次级左栏/右栏为 Placeholder 空壳）并归一化首页骨架：

- **批次 1**：右栏 AssistantSessionPanel 骨架 + 槽位接入（fileTree 不渲染）+ 宽度机制 + 提醒/记忆/上下文 3 Tab
- **批次 2**：左栏富结构（首页 + 详情）+ 会话列表联动左栏实体列表
- **批次 3**：知识库 Tab + 双栏笔记编辑器（`[[补全]]` + 实时预览 + 悬空高亮）
- **批次 4**：引文锚定（timeline `[笔记ID]` 角标 → 右栏知识库 Tab 定位）

### 1.2 非目标

- ❌ 不做 assistant 专属 timeline/composer 改造（中栏维持通用）
- ❌ 不做 TerminalPanel 隐藏（已决策保留现状）
- ❌ 不做模板/日记/format 扩展（上级计划 Phase E 已有 note/summary/faq/timeline）
- ❌ 不做记忆"注入上下文"接线（`listConfirmed` 无 runner 消费者，独立跟踪）

### 1.3 相对 PRD 的收敛

| PRD 描述                           | 本次实施收敛                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| §8.2 右栏 Tab 渐进式（里程碑标注） | **全量 5 Tab**（提醒/记忆/知识库/笔记编辑器/上下文），上下文 Tab 进 Tab 栏                           |
| §8.2 知识库 Tab 反向引用           | 需补 HTTP 端点 `GET /kb/:id/backlinks`（`KBService.backlinks` 已有，未暴露）                         |
| 会话列表联动                       | 提醒/记忆可过滤高亮；知识库无会话反链 → 退化全量（PRD §8.1）                                         |
| 引文锚定                           | 本轮做：`[笔记ID]` 角标 → 开右栏知识库 Tab 定位；需要 assistant-orchestrator prompt 引用格式约定配套 |

---

## 2. 背景与当前状态

### 2.1 已就绪（直接复用）

| 能力                   | 位置                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 首页富聚合 Dashboard   | `packages/app/src/pages/assistant-dashboard.tsx`（提醒横条/最近投递/Memory Inspector/知识库/会话列表）                                                     |
| 共享 Location 模块     | `packages/app/src/components/mode-location-new-session.tsx`                                                                                                |
| 首页 surface 注册      | `packages/app/src/components/mode-surfaces.tsx:324-328`（assistant 三槽位）                                                                                |
| 会话共享管道           | `buildHomeSessionRecords + filterSessionsByMode("assistant") + groupSessions`                                                                              |
| 实体 HTTP API          | `schedule.pending/list/cancel`、`delivery.recent/inbox/read`、`memory.list/confirm/reject/edit/remove`、`kb.list/get/create/update/remove/search/dangling` |
| 上下文 Tab             | `packages/app/src/components/session/session-context-tab.tsx`（零改动复用）                                                                                |
| 上下文圆环 toggle      | `packages/app/src/components/session-context-usage.tsx:51-63`                                                                                              |
| 右栏 mode slot         | `packages/app/src/pages/session/session-side-panel.tsx:447-456`（chat/work/assistant 并列 display:none 槽位，ADR-15 render-all）                           |
| 次级左栏骨架           | `packages/app/src/components/secondary-sidebar.tsx:666-689`（assistant → `PlaceholderSidebar`）                                                            |
| 会话反链               | `Schedule.Info.sessionID`（`packages/core/src/session/schedule-service.ts:37`）、记忆 `sourceSessionID`                                                    |
| 知识库反向引用服务方法 | `KBService.backlinks`（`packages/core/src/session/kb-service.ts:95`）                                                                                      |

### 2.2 需新建/修改

| 能力                                          | 位置                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------- |
| AssistantSessionPanel（右栏 5-Tab）           | `packages/app/src/pages/session/assistant-session-panel.tsx`（新）   |
| AssistantSessionSidebar（详情次级左栏富结构） | `packages/app/src/components/assistant-session-sidebar.tsx`（新）    |
| AssistantNavTree（实体导航树，首页/详情共用） | `packages/app/src/components/assistant-nav-tree.tsx`（新）           |
| 共享组件抽取                                  | ReminderList/MemoryInspector 从 `assistant-dashboard.tsx` 抽取       |
| 双栏笔记编辑器 + `[[补全]]`                   | `packages/app/src/components/assistant-note-editor.tsx`（新）        |
| 引文角标 renderer                             | timeline 现有 renderer 扩展                                          |
| `backlinks` HTTP 端点                         | `packages/aigcfroge/src/server/routes/instance/httpapi/groups/kb.ts` |
| `openEntityPanel` 信号                        | 左栏 → 右栏联动（对齐 `open-session-context.ts` 泛化）               |

### 2.3 缺口确认（2026-08-13 代码核验）

- 首页 = 两栏（`mode-workspace.tsx:139-145` `grid-cols-[280px_minmax(0,960px)]`），**无右栏**——PRD §8.1 本次新增的"无右栏"即此现状。
- 详情页次级左栏 assistant slot = `PlaceholderSidebar`（`secondary-sidebar.tsx:678`）；右栏 assistant slot = `PlaceholderPanel`（`session-side-panel.tsx:454`）。
- 上下文 Tab 触发 = 标题栏圆环 toggle（`session-context-usage.tsx:51-63`），复用为详情页上下文 Tab 入口。

---

## 3. 关键设计

### 3.1 右栏 AssistantSessionPanel（批次 1，G2）

> **2026-08-13 审批修正（F1）**：初稿写"A/B 归一化"并依赖 work 批次4——但 [work-mode-session-sidebar-plan.md](work-mode-session-sidebar-plan.md) 批次4 仍是 **Draft 未实施**，当前代码**没有共享 A/B 骨架**（coding 的 review+fileTree 是独立 `<Show>` 分支 `session-side-panel.tsx:217`；chat/work/assistant 是并列 display:none 槽位 `:448-456`）。修正为**自包含单面板**：assistant 槽位渲染 `AssistantSessionPanel`，fileTree 不在此槽位渲染（"B 区隐藏"语义由槽位本身满足，无空占位）。work 批次4 作未来独立重构，本方案与其不冲突。

```
SessionSidePanel → assistant 槽位 (display:none 切换, session-side-panel.tsx:454)
└── AssistantSessionPanel (5-Tab, 手动开 + ResizeHandle 拖拽, min 宽 480px)
    └── Tab 栏: 提醒 | 记忆 | 知识库 | 笔记编辑器 | 上下文
    （fileTree 不渲染 = 无 B 区空占位）
```

- 上下文 Tab ↔ 中栏标题圆环 toggle（复用 `session-context-usage`），圆环点击开/关上下文 Tab。
- **会话级面板状态** `{ opened, activeTab, target }`（会话内 scope，类比 `useSessionLayout` 的 view/tabs）。
- 右栏 `openEntityPanel(kind, itemId)`：写面板状态（opened=true + activeTab=kind + target=itemId），对齐 `open-session-context.ts` 纯函数模式，供左栏列表点击 + 引文角标调用。

### 3.2 实体导航树（批次 2，G3）

`AssistantNavTree` 对齐 `ChatFeatureSidebar`（树 + 计数），数据源：

| 节点       | 计数                                                     | 数据源                 |
| ---------- | -------------------------------------------------------- | ---------------------- |
| 提醒       | pending 数                                               | `schedule.pending`     |
| 记忆       | pending/confirmed 数                                     | `memory.list`          |
| 知识库分类 | 标签层级聚合                                             | `kb.list` 按 tags 分组 |
| 悬空链接   | 计数（数组 `.length`，端点返回 `DanglingLink[]` 非计数） | `kb.dangling`          |

**复用**：首页左栏（`mode-surfaces.tsx` assistant Sidebar slot）与详情次级左栏（`secondary-sidebar.tsx:678`）共用同一 `AssistantNavTree`，`useChatDirectory` 提供 directory。

### 3.3 会话列表联动（批次 2，G3）

- 首页主区会话列表（`assistant-dashboard.tsx:473`）与左栏实体列表联动。
- 点击左栏提醒/记忆 → 会话列表高亮创建它的会话（`Schedule.Info.sessionID` / `sourceSessionID` 反查）。
- 点击知识库节点 → 会话列表退化为全量（笔记无会话反链）。
- 实现：复用 `mode-workspace.tsx:22-30` 的 `CodingSelectionCtx` 模式，新增 `AssistantSelectionCtx`（实体选中态）；首页左栏导航树写选中态，主区会话列表读选中态 → 过滤/高亮 `records`；不新造列表，仅加 filter/highlight 参数。

### 3.4 知识库 Tab + 双栏编辑器（批次 3，G4）

- 知识库 Tab：上方搜索 + 标签筛；下方笔记列表；选中后正文 + 反向引用 + 悬空链接面板。反向引用走新端点 `GET /kb/:id/backlinks`（服务方法 `KBService.backlinks` 已有，仅暴露；success 复用已导出的 `KBNote.Note`，标识符 `kb.backlinks`，补 aigcfroge 端点契约测试）。
- 双栏编辑器：左 Markdown 编辑（`[[补全]]` 从现有标题索引补全）+ 右实时预览 + 悬空链接高亮；顶部标题/标签编辑。绑 `KBService`，写时同步 wikilink 索引（内容真源 ADR-14 §2）。
- 编辑器只在右栏，不落地首页主区（首页主区现有简单 textarea 保持现状不动）。

### 3.5 位置分层裁定（本次讨论收敛，防冲突）

| 实体   | 首页主区                      | 首页左栏 | 详情次级左栏 | 详情右栏                   |
| ------ | ----------------------------- | -------- | ------------ | -------------------------- |
| 提醒   | 横条（聚合+取消）             | 计数     | 计数+列表    | Tab（详情+取消/修改+历史） |
| 记忆   | Memory Inspector（聚合+操作） | 计数     | 计数         | Tab（详情+操作）           |
| 知识库 | 列表+简单编辑器（现状）       | 分类树   | 分类树       | Tab + 双栏编辑器           |
| 会话   | 列表（联动左栏）              | —        | 列表         | —                          |

**核心**：主区=聚合层（现状不收敛）；右栏=详情层（会话内操作）；左栏=导航层（计数/树）。同实体允许"聚合"与"详情"并存（§3.9.4 分层原则），但**不在同一屏幕放两套完整操作 UI**——详情操作收敛右栏，首页主区操作保留为快路径。

### 3.6 引文锚定（批次 4，G4）

> **2026-08-13 审批修正（F2）**：assistant 文本经 `packages/session-ui/src/components/message-part.tsx`（**跨模式共享包**）渲染。角标检测若在 session-ui 落地会影响 coding/chat/work 文本渲染，必须**按会话 mode 门控**（仅 assistant 会话启用）+ session-ui 回归测试；优先在 app 层 timeline 后处理，避免改共享渲染路径。

- timeline 渲染层识别 `[笔记ID]` 标记 → 渲染可点击角标 → 点击展开原文摘要 → `openEntityPanel("kb", id)` 打开右栏知识库 Tab 定位。
- assistant-orchestrator prompt 补充：从知识库作答时输出约定引用格式（如 `[笔记标题](kb://id)` 或 `[id]`），与 renderer 解析配套。
- 宽容解析：匹配不上则不渲染角标，不阻塞回答。
- 空结果行为：无相关记录时明说，不编造（现有 prompt 已约束，验证即可）。

---

## 4. 阶段划分

| 批次                   | 内容                                                                                                                                                                       | 退出条件                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **1 右栏骨架 + 3 Tab** | 抽 ReminderList/MemoryInspector 共享组件；AssistantSessionPanel 骨架 + 槽位接入 + 宽度机制（手动开+拖拽）；提醒/记忆/上下文 Tab；上下文圆环 toggle；`openEntityPanel` 信号 | 右栏 3 Tab 可用；B 区无空占位；宽度拖拽正常；**Dashboard 抽取后回归绿（行为不变，F4 门禁）** |
| **2 左栏 + 联动**      | AssistantNavTree 实体导航树；首页左栏 + 详情次级左栏共用；主区会话列表联动左栏实体列表（提醒/记忆高亮，知识库退化全量）                                                    | 首页/详情左栏非 Placeholder；联动高亮/退化正确                                               |
| **3 知识库 + 编辑器**  | `GET /kb/:id/backlinks` 端点；知识库 Tab（搜索/标签/列表/正文/反向引用/悬空）；双栏编辑器（`[[补全]]`/预览/悬空高亮）                                                      | 双向链接/反向引用/悬空在 UI 全闭环                                                           |
| **4 引文锚定**         | timeline `[笔记ID]` 角标渲染 → 右栏知识库 Tab 定位；assistant-orchestrator prompt 引用格式配套                                                                             | 锚定问答点击跳转闭环；防幻觉验证                                                             |

---

## 5. 关键文件

| 文件                                                                 | 动作                                                                                                 |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `packages/app/src/pages/session/assistant-session-panel.tsx`         | 新增 (右栏 5-Tab 面板; 数据访问用 `useServerSDK` 服务级, 对齐 dashboard 非 ChatRightPanel 的 useSDK) |
| `packages/app/src/components/assistant-session-sidebar.tsx`          | 新增 (详情次级左栏富结构)                                                                            |
| `packages/app/src/components/assistant-nav-tree.tsx`                 | 新增 (实体导航树, 首页/详情共用)                                                                     |
| `packages/app/src/components/assistant-note-editor.tsx`              | 新增 (双栏编辑器 + [[补全]])                                                                         |
| `packages/app/src/pages/mode-workspace.tsx`                          | 修改 (新增 `AssistantSelectionCtx`, 对齐 CodingSelectionCtx:22-30)                                   |
| `packages/app/src/pages/session/session-side-panel.tsx`              | 修改 (assistant slot: PlaceholderPanel → AssistantSessionPanel; fileTree 不渲染)                     |
| `packages/app/src/components/secondary-sidebar.tsx`                  | 修改 (assistant slot: PlaceholderSidebar → AssistantSessionSidebar)                                  |
| `packages/app/src/components/mode-surfaces.tsx`                      | 修改 (首页 assistant Sidebar → 实体导航树)                                                           |
| `packages/app/src/pages/assistant-dashboard.tsx`                     | 修改 (抽取共享组件 + 会话列表联动; 行为不变回归门禁)                                                 |
| `packages/app/src/pages/session/assistant-session-panel-open.ts`     | 新增 (openEntityPanel 信号 + 会话级面板状态, 对齐 open-session-context)                              |
| `packages/app/src/pages/session/timeline/*`                          | 修改 (引文角标; 优先 app 层后处理, 避免改 session-ui)                                                |
| `packages/session-ui/src/components/message-part.tsx`                | **只读参考** (跨包共享渲染路径, 角标门控不落此处除非回归)                                            |
| `packages/core/src/agent/prompt/assistant-orchestrator.ts`           | 修改 (引用输出格式约定)                                                                              |
| `packages/aigcfroge/src/server/routes/instance/httpapi/groups/kb.ts` | 修改 (新增 GET /kb/:id/backlinks, 标识符 kb.backlinks, success=KBNote.Note[])                        |
| `packages/app/src/i18n/en.ts` + `zh.ts` + `zht.ts`                   | 修改 (assistant session 详情文案, parity 约束)                                                       |

---

## 6. 测试策略

| 层            | 覆盖                                                                   | 工具                                |
| ------------- | ---------------------------------------------------------------------- | ----------------------------------- |
| App 组件      | 右栏 Tab 渲染/fileTree 不渲染/宽度拖拽/导航树计数/联动过滤             | `bun --cwd packages/app test`       |
| Aigcfroge API | `GET /kb/:id/backlinks` 契约                                           | `bun --cwd packages/aigcfroge test` |
| E2E           | /mode/assistant 首页左栏树→会话列表联动；详情右栏 5-Tab 打开/关闭/定位 | Playwright                          |

**命令**（CLAUDE.md 测试规范）：

```bash
bun --cwd packages/app test
bun --cwd packages/aigcfroge typecheck
bun --cwd packages/app typecheck
bun run script/lint-changed.ts
```

**门禁**：右栏 B 区隐藏后无空占位 DOM；联动高亮不破坏会话列表共享管道；无固定 `Effect.sleep`。

---

## 7. 验收清单

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

---

## 8. 估算

| 批次               | 估时    |
| ------------------ | ------- |
| 1 右栏骨架 + 3 Tab | 3d      |
| 2 左栏 + 联动      | 3d      |
| 3 知识库 + 编辑器  | 4d      |
| 4 引文锚定         | 3d      |
| **总计**           | **13d** |

---

## 9. 风险与应对

| 风险                                                                  | 概率 | 应对                                                                                   |
| --------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------- |
| 主区操作与右栏详情双入口歧义                                          | 中   | §3.5 位置分层裁定：主区=聚合快路径，右栏=详情；不做同一屏幕两套完整操作 UI             |
| 会话列表联动破坏共享管道                                              | 低   | 复用 `filterSessionsByMode` 加 filter/highlight 参数，不新造列表                       |
| 双栏编辑器绑 KBService 与 dashboard 简单编辑器并存                    | 中   | 编辑器只在右栏；首页简单 textarea 现状不动                                             |
| `[[补全]]` 与 marked/wikilink 渲染冲突                                | 中   | 复用现有 markdown 渲染管线，编辑器内预览走同一 sanitize 路径                           |
| 5-Tab 栏拥挤                                                          | 低   | Tab 栏横向滚动或分组（实体 Tab + 上下文分组）                                          |
| 引文标记格式 LLM 不稳定                                               | 中   | prompt 输出约定格式 + renderer 宽容解析（匹配不上则不渲染角标，不阻塞回答）            |
| **F2：引文锚定触碰 session-ui 共享渲染路径（coding/chat/work 回归）** | 高   | 角标按会话 mode 门控（仅 assistant）；优先 app 层 timeline 后处理；session-ui 全量回归 |
| **F4：Dashboard 抽取共享组件破坏已合入主区**                          | 中   | 抽取后 Dashboard 组件测试回归绿 + 手动核对主区四区块行为不变，作为批次 1 退出门禁      |

---

## 10. 桌面端 E2E 手动测试流程（验收标准）

> 前置：`bun --cwd packages/desktop dev` 启动桌面端（自动拉起本地 server）；配置 LLM provider；建议干净数据目录。scheduler daemon 每分钟 tick，投递存在 ≤1min 延迟，测投递时 due 设 ≥2min。

### 10.1 批次 1 · 右栏骨架 + 提醒/记忆/上下文 Tab

| #   | 步骤                                              | 期望                                                                                      |
| --- | ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | 打开一个 assistant 会话（首页新建或会话列表点击） | 右栏默认收起，不显示空占位                                                                |
| 2   | 点中栏标题右侧用量圆环                            | 右栏打开，上下文 Tab 激活；再点圆环 → 关闭                                                |
| 3   | 手动开右栏（Tab 栏/按钮），点「提醒」Tab          | 显示 pending 提醒（内容/时间/时区/状态徽章）；空态有引导文案                              |
| 4   | 提醒 Tab 点「取消」某条                           | 该条从 pending 消失；首页角标数同步 -1                                                    |
| 5   | 提醒 Tab 底部历史投递                             | 显示已投递记录（含 caught_up 标记、可标记已读）                                           |
| 6   | 切「记忆」Tab                                     | pending 提议 + 已确认分组；confirm/reject/remove 生效（与首页 Memory Inspector 数据同步） |
| 7   | 拖右栏 ResizeHandle 到最窄/最宽                   | 宽度随拖拽变化，min 480px 生效；不出现横向溢出                                            |
| 8   | 右栏右上角 X                                      | 右栏关闭                                                                                  |
| 9   | Dashboard 抽取后回归                              | 首页提醒横条/最近投递/Memory Inspector/知识库/会话列表四区块行为与抽取前一致              |

### 10.2 批次 2 · 左栏实体导航树 + 会话联动

| #   | 步骤                          | 期望                                                          |
| --- | ----------------------------- | ------------------------------------------------------------- |
| 1   | 首页左栏                      | Location + 新建 + 实体导航树（提醒/记忆/知识库分类/悬空计数） |
| 2   | 首页左栏点某提醒              | 主区会话列表高亮创建它的会话                                  |
| 3   | 首页左栏点某记忆              | 主区会话列表高亮来源会话                                      |
| 4   | 首页左栏点知识库分类          | 会话列表退化为全量（无会话反链）                              |
| 5   | 打开 assistant 会话，次级左栏 | Location + 会话列表 + 实体导航树，非 Placeholder              |
| 6   | 详情左栏点某提醒/记忆         | 右栏自动打开对应 Tab 并定位该项（openEntityPanel）            |
| 7   | 次级左栏可隐藏/显示           | titlebar 切换按钮生效                                         |

### 10.3 批次 3 · 知识库 Tab + 双栏编辑器

| #   | 步骤                                           | 期望                                                       |
| --- | ---------------------------------------------- | ---------------------------------------------------------- |
| 1   | 知识库 Tab 搜索关键词                          | FTS5 命中；无记录时空态                                    |
| 2   | 知识库 Tab 标签筛                              | 按标签过滤列表                                             |
| 3   | 选中某笔记                                     | 右侧显示正文 + 反向引用面板 + 悬空链接面板                 |
| 4   | 反向引用验证：笔记 A 含 `[[B]]`                | B 的反向引用列出 A                                         |
| 5   | 双栏编辑器新建笔记：标题含 `[[C]]`（C 不存在） | 左编辑右预览；`[[C]]` 悬空高亮；保存后知识库悬空列表出现 C |
| 6   | 编辑器输入 `[[`                                | 弹出标题补全候选                                           |
| 7   | 编辑已有笔记标题/内容/标签 → 保存              | 更新生效；wikilink 索引同步（反向引用刷新）                |
| 8   | 删除笔记                                       | 列表移除；其反向引用/悬空状态正确更新                      |

### 10.4 批次 4 · 引文锚定

| #   | 步骤                                         | 期望                                              |
| --- | -------------------------------------------- | ------------------------------------------------- |
| 1   | assistant 会话问知识库问题（需已存相关笔记） | 回答引用笔记并渲染 `[笔记ID]` 可点击角标          |
| 2   | 点角标                                       | 展开原文摘要 → 右栏自动打开知识库 Tab 定位该笔记  |
| 3   | 问知识库不存在的问题                         | 回答明确"无相关记录"，不编造，无角标              |
| 4   | 跨模式回归                                   | coding/chat/work 会话消息文本渲染不受角标逻辑影响 |

### 10.5 横切验证（每批次抽查）

| 项         | 检查                                                          |
| ---------- | ------------------------------------------------------------- |
| i18n       | 设置切换 en/zh/zht，新文案（Tab 名/编辑器/空态/角标）三语一致 |
| 主题       | 明/暗主题下新组件用 v2 Token，无硬编码颜色                    |
| 键盘/焦点  | Tab 切换/编辑器/右栏关闭均可用键盘操作，焦点圈可见            |
| 窄屏       | 右栏拖拽 min 宽 + 5-Tab 横向滚动不破坏布局                    |
| 数据一致性 | 右栏操作后首页角标/横条同步（60s 刷新内）                     |
