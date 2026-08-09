# Work 模式会话详情页 · 次级左侧边栏 + 右栏归一化 实施计划

> 状态：**Draft - 待审批**
> 日期：2026-08-08
> Owner：产品 + App
> 依据：[Work PRD v4.1](../prd/work-mode-execution-layer.md) §10.2、[DESIGN.md](../../DESIGN.md)、[ARCHITECTURE.md](../../ARCHITECTURE.md) §4.10、[Work 路线图](work-mode-roadmap.md)
> 分支：`work-session-sidebar`（建议）
> 性质：本计划覆盖**会话详情页**次级左侧边栏（方向 A：维度 Tab + 会话列表）与右栏架构归一化（A 区 auto + B 区 fileTree 对齐 code）

---

## 1. 背景与决策记录

### 1.1 问题

Work 模式会话详情页的次级左侧边栏（`SecondarySidebar`，256px，会话内壳层）当前为 `PlaceholderSidebar` 纯占位（[secondary-sidebar.tsx:666-668](../../packages/app/src/components/secondary-sidebar.tsx#L666-L668)），与 coding（项目树+会话）/chat（功能树+会话）形成内容断层。用户在 work 会话内无法切换同项目其他 work 会话、无法按维度回溯历史工作。

### 1.2 决策记录（产品讨论 2026-08-08）

| 决策 | 结论 | 依据 |
|------|------|------|
| **D1 左栏功能列表去留** | 不要。左栏 = 切换对话 + 切换工作（维度 Tab）+ 创建新会话。启动器留首页 `WorkPresetCatalogMain` | 主区有进度条+Resume、右栏有 Context+Artifact+存为资产，左栏不重复 |
| **D2 智能体放开节奏** | (a) 先 skills 文件，后子智能体。用户自建智能体导入 work 放更后期 | 极致减法；skills 无需新 agent 注册 |
| **D3 width store 共享/独立** | 自动消解。A 区改 auto 后无 `workPanel.width`，三模式共用 `session.width` | D5 改 auto |
| **D4 左栏+右栏是否同批** | 分批。批次 1 左栏（产品功能），批次 4 右栏归一（架构重构）| 左栏用户可感知，右栏用户无感，混批 PR 过大 |
| **D5 work A 区宽度** | auto 撑满（对齐 coding/chat）。删 `workPanel.width` + 内部 ResizeHandle，接主区 ResizeHandle | 场景分析：artifact/候选稿需宽 A 区，auto 自适应；work 引导式定位不需要可拖拽 |
| **D6 B 区 fileTree** | 直接对齐 code fileTree。抽共享 `SessionFileTree` 组件，code/chat 去重 + work 接入，默认关闭 | 复用 > 复制；fileTree 可开关不干扰 |
| **方向 A（Tab 版）vs chat 式** | 方向 A：维度 Tab 在上、会话列表常驻下方 | work 维度少（3 个），Tab 紧凑，会话列表空间大 |
| **Q1 i18n 语言** | en/zh/zht 三语。parity 测试只校验 zh/zht，其余 14 locale 冻结 | [parity.test.ts](../../packages/app/src/i18n/parity.test.ts) 确认 |
| **Q2 任务 Tab 命名** | (b) 改叫"任务集"，避免与主区 Progress Ledger 任务步骤混淆 | 语义区隔 |
| **Q3 工种粒度** | 4 大类（it-development/video-creation/academic/general-office），非 17 细工种 | 对齐 [work-preset-catalog.ts:4](../../packages/app/src/pages/work-preset-catalog.ts#L4)；`presetCategoryId` 存 4 大类 |

### 1.3 PRD §10.2 已落地能力（不重复造）

| PRD 要求 | 代码位置 |
|----------|---------|
| 主区 Progress Ledger 进度条 | [message-timeline.tsx:1725](../../packages/app/src/pages/session/timeline/message-timeline.tsx#L1725) `SessionTodoProgress`，L1697 受 `showSessionProgressBar` 门控 |
| Resume 断点恢复（work only）| [session-todo-progress.tsx:277-282](../../packages/app/src/pages/session/timeline/session-todo-progress.tsx#L277-L282) `canResume && mode==="work"` |
| Context Tab 对齐 Code | [work-artifact-panel.tsx:295](../../packages/app/src/pages/work-artifact-panel.tsx#L295) 复用 `SessionContextTab` |
| Artifact Tab + 应用 + 同名冲突 Diff | [work-artifact-panel.tsx:110-156](../../packages/app/src/pages/work-artifact-panel.tsx#L110-L156) `WorkDiffView` + 覆盖 Dialog |
| 消息级"存为资产"（M2）| [work-artifact-panel.tsx:167,236](../../packages/app/src/pages/work-artifact-panel.tsx#L167) |
| 问卷式澄清 | [session-composer-region.tsx:217](../../packages/app/src/pages/session/composer/session-composer-region.tsx#L217) `SessionQuestionDock` |

**结论**：左栏聚焦"会话间导航"，不重复主区/右栏/Composer 已有能力。

---

## 2. 总体架构

```
Work 会话详情页（批次 1 + 批次 4 归一后）
┌──────────────────────────────────────────────────────────────────┐
│ Titlebar                                                         │
├────┬───────────────┬─────────────────────────┬──────────────────┤
│Mode│ 次级左栏       │ 主区（SSE 对话）         │ 右栏 A 区         │
│切换│ 256px         │ session.width(可拖拽)   │ auto 撑满         │
│64px│               │ 默认 600px              │ ├ Context Tab     │
│    │ ┌Location───┐ │                         │ └ Artifact Tab   │
│    │ │New Session│ │ ┌SessionTodoProgress──┐ │                   │
│    │ └───────────┘ │ │ 进度条 + Resume     │ │                   │
│    │ [工种][任务集] │ └─────────────────────┘ │                   │
│    │ [智能体]      │                         │                   │
│    │ ─会话列表─    │ 消息流                   │                   │
│    │ (按Tab分组)   │                         │                   │
│    │               │ Composer(问卷澄清)      │                   │
│    │               │                         │ ←ResizeHandle(主区)│
├────┴───────────────┴─────────────────────────┴──────────────────┤
│ StatusBar                                                        │
└──────────────────────────────────────────────────────────────────┘
                                         右栏 B 区(fileTree，默认关，批次4)
```

---

## 3. 批次 1：次级左侧边栏

### 3.1 范围

替换 [secondary-sidebar.tsx:666-668](../../packages/app/src/components/secondary-sidebar.tsx#L666-L668) 的 `PlaceholderSidebar mode="work"`，实现完整 work 左栏。

### 3.2 组件结构

新建 `packages/app/src/components/work-secondary-sidebar.tsx`：

```
WorkSecondarySidebar
├─ Location 栏 + New Session   ← 复用 WorkProjectColumnSidebar 顶部逻辑
│                              （[mode-workspace-slots.tsx:521-590](../../packages/app/src/pages/mode-workspace-slots.tsx#L521-L590)）
├─ 维度 Tab 栏                 ← 新建（工种 / 任务集 / 智能体）
│   role="tablist"，键盘方向键切换，aria-selected
└─ 会话列表                    ← 复用 SessionItem + groupSessions
    按 selectedTab 维度分组，flex-1 滚动
```

### 3.3 维度 Tab 设计

| Tab | 数据源 | 首期状态 | 前置依赖 |
|-----|--------|---------|----------|
| 工种 | `session.presetCategoryId`（4 大类）| ✅ 可用 | session schema 加字段（本批做）|
| 任务集 | 跨会话 Task 实体 | ⏳ 空态"跨会话任务集即将上线" | 批次 2（跨会话 Task，M5 方向）|
| 智能体 | `session.agent` | ⏳ 空态"多智能体分组即将上线" | 批次 3（skills + work 白名单放开）|

- 默认选中"工种"，持久化到 `mode.secondaryWorkTab`（参考 chat-feature 持久化模式）
- Tab 栏 256px 内宽 ~240px，3 个 Tab（工种~48px + 任务集~64px + 智能体~64px = ~176px + 间距）舒适，余量充足

### 3.4 工种 Tab 分组逻辑

- 分组键：`session.presetCategoryId`（4 大类：it-development / video-creation / academic / general-office）
- 老会话无 `presetCategoryId` 归"未分类"组
- 分组头：纯文本 + 计数（dense 风格，**不用 card**，对齐 DESIGN.md L15-17）
- 分组头计数预留固定宽度，避免计数变化导致布局抖动（DESIGN.md L21）

### 3.5 会话列表

- 过滤：`session.mode === "work"`（对齐 [chat-session-list.tsx:28](../../packages/app/src/components/chat/chat-session-list.tsx#L28) chat 过滤逻辑）
- 分组：按选中 Tab 维度键 `groupSessions`
- 行组件：复用 [SessionItem](../../packages/app/src/pages/layout/sidebar-items.tsx#L147)（状态灯 working/权限/错误/未读 + 截断标题 + hover 归档 + 子会话嵌套）
- 空态：无 work 会话时引导"从首页预设开始"
- 加载态：skeleton 占位，不 collapse 布局

### 3.6 数据模型变更（5 层依赖链 · 审批修正版）

> ⚠️ 审批修正：原稿只覆盖 schema + newDraft 两层，缺失 core CreateInput + aigcfroge HTTP Schema + DraftTab 三层，数据流断在中间。另 presetLaunch 返回值改法违反"复用现有"（preset 对象已有 category 字段），改为调用处直接用 `preset.category`，presetLaunch 不动。

| 层 | 改动点 | 文件 | 内容 |
|----|--------|------|------|
| 1 schema | Info 加字段 | [session.ts:31-64](../../packages/schema/src/session.ts#L31-L64) | 加 `presetCategoryId: WorkPreset.Category.pipe(Schema.optional)`（`WorkPreset.Category` 已在 [work-preset.ts:5-11](../../packages/schema/src/work-preset.ts#L5-L11)，同包直接 import，无边界违规）|
| 2 core 内部接口 | CreateInput 加字段 | [session.ts:72-81](../../packages/core/src/session.ts#L72-L81) `type CreateInput` | 加 `presetCategoryId?: WorkPreset.Category`；`create()` 逻辑写入 session.Info |
| 2b aigcfroge HTTP Schema | Session.CreateInput 加字段 | aigcfroge `@/session/session` Session.CreateInput（HttpApi payload，[groups/session.ts:315](../../packages/aigcfroge/src/server/routes/instance/httpapi/groups/session.ts#L315) 引用）| 加 `presetCategoryId?: WorkPreset.Category` Schema 字段 |
| 3 server handler | create 透传 | [handlers/session.ts](../../packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts) session create | payload.presetCategoryId -> core `Session.create({presetCategoryId})` |
| 4 sdk/js | regen | `./packages/sdk/js/script/build.ts` | 随 schema regen（client.session.create 类型更新）|
| 5 app DraftTab | 加字段 | [tabs.tsx:21-29](../../packages/app/src/context/tabs.tsx#L21-L29) `DraftTab` | 加 `presetCategoryId?: WorkPreset.Category` |
| 5b app 启动处 | 调用 newDraft 透传 | [mode-workspace-slots.tsx:715](../../packages/app/src/pages/mode-workspace-slots.tsx#L715) | `tabs.newDraft({ ..., presetCategoryId: preset.category }, presetLaunch(preset))`--**presetLaunch 不改**，preset.category 直接取 |
| 5c app draft->session | 透传到 create | draft 发送首消息 -> `session.create` 调用处（aigcfroge session runtime）| DraftTab.presetCategoryId -> Session.create input |

optional 字段，老会话无值归"未分类"，不破坏现有数据。无数据库 migration（presetCategoryId 存 session.Info JSON 列，schema 层 optional 自动兼容）。

**presetLaunch 不改的理由**：它是 prompt 生成器（纯函数返回 string），职责单一。preset 对象已有 `category` 字段（[work-preset.ts:36](../../packages/schema/src/work-preset.ts#L36)），调用处直接用即可，不创造新接口。

### 3.7 跨模式会话上下文指示器

DESIGN.md L30 + ARCHITECTURE.md §4.10 要求："当路由的 Session 属于不同 Mode 时，显示 compact contextual indicator，不静默重分类"。

- work 左栏会话列表过滤 `mode===work`，chat/coding 会话不出现
- 但若当前打开的会话非 work（如用户从历史进入 chat 会话），Location 栏下方显示 compact 提示："当前会话为 chat 模式"（不阻断，不重分类）
- 实现：Location 栏下加 `Show when={sessionMode() !== "work"}` 提示条，`sessionMode` 复用 [session.tsx:1626](../../packages/app/src/pages/session.tsx#L1626) `const sessionMode = () => info()?.mode` 路径（不新建读取逻辑）

---

## 4. 批次 4：右栏归一化

### 4.1 A 区宽度归一（D5）

| 改动 | 文件 | 内容 |
|------|------|------|
| work A 区改 auto | [work-artifact-panel.tsx:280](../../packages/app/src/pages/work-artifact-panel.tsx#L280) | `width: reviewOpen ? workPanel.width px : 0` → `width: reviewOpen ? auto : 0`（或由父 flex 决定）|
| 删内部 ResizeHandle | [work-artifact-panel.tsx:306-321](../../packages/app/src/pages/work-artifact-panel.tsx#L306-L321) | 删除 WorkSessionPanel 内的 ResizeHandle |
| 删 workPanel store | [layout.tsx:28,282-283,698-705](../../packages/app/src/context/layout.tsx#L28) | 删 `DEFAULT_WORK_PANEL_WIDTH` + `layout.workPanel` |
| 接主区 ResizeHandle | [session.tsx:1936-1951](../../packages/app/src/pages/session.tsx#L1936-L1951) | work A 区开 = `reviewPanel.opened()` = `desktopReviewOpen()` → 主区 ResizeHandle 自动可用 |

归一后三模式统一：主区 `session.width`(可拖拽) + A 区 auto 吃剩余。

### 4.2 B 区 fileTree 对齐（D6）

抽共享 `SessionFileTree` 组件，消除 code/chat 重复 + work 接入：

| 改动 | 文件 | 内容 |
|------|------|------|
| 抽共享组件 | 新建 `packages/app/src/components/session-file-tree.tsx` | 封装 fileTree 逻辑（fileOpen/panelWidth/treeWidth/ResizeHandle）|
| code 接入 | [session-side-panel.tsx:70-85,393,460](../../packages/app/src/pages/session/session-side-panel.tsx#L70-L85) | 删内联 fileTree 逻辑，引用 `SessionFileTree` |
| chat 接入 | [chat-right-panel.tsx:72-82,458,487](../../packages/app/src/components/chat/chat-right-panel.tsx#L72-L82) | 删重复逻辑，引用 `SessionFileTree` |
| work 接入 | [work-artifact-panel.tsx](../../packages/app/src/pages/work-artifact-panel.tsx) WorkSessionPanel | 加 `SessionFileTree` 槽位，默认关闭 |

- 开关共享：`layout.fileTree.opened()` + `settings.visibility.fileTree`
- 宽度共享：`layout.fileTree.width()` + ResizeHandle
- work B 区默认关闭，低频使用（work 用户不浏览代码，但可查看落盘的 .html/.md 产物）

---

## 5. i18n

### 5.1 新 key（en/zh/zht 三语）

| key | en | zh | zht |
|-----|----|----|-----|
| `work.sidebar.tab.trade` | Trade | 工种 | 工種 |
| `work.sidebar.tab.taskSet` | Task Set | 任务集 | 任務集 |
| `work.sidebar.tab.agent` | Agent | 智能体 | 智能體 |
| `work.sidebar.taskSet.empty` | Cross-session task sets coming soon | 跨会话任务集即将上线 | 跨會話任務集即將上線 |
| `work.sidebar.agent.empty` | Multi-agent grouping coming soon | 多智能体分组即将上线 | 多智能體分組即將上線 |
| `work.sidebar.uncategorized` | Uncategorized | 未分类 | 未分類 |
| `work.sidebar.empty` | Start from a preset on the home page | 从首页预设开始 | 從首頁預設開始 |
| `work.sidebar.modeMismatch` | Current session is in {{mode}} mode | 当前会话为 {{mode}} 模式 | 當前會話為 {{mode}} 模式 |

### 5.2 parity 测试

[parity.test.ts](../../packages/app/src/i18n/parity.test.ts) 只校验 zh/zht 与 en 的 keys + placeholders 一致。其余 14 locale 冻结不检查。新 key 补 en/zh/zht 即可，冻结 locale 走英文兜底（[language.tsx](../../packages/app/src/context/language.tsx) base-spread）。

---

## 6. 无障碍与设计约束

### 6.1 无障碍（DESIGN.md L81-84）

- 维度 Tab：`role="tablist"` + `role="tab"` + `aria-selected` + 键盘方向键切换（左右箭头）+ `tabindex` 管理（选中 Tab `tabindex=0`，非选中 `tabindex=-1`，对齐 WAI-ARIA Tabs 模式）
- 优先复用 `@kobalte/core` Tabs 原语（DESIGN.md L9 "prefer @kobalte/core for accessible primitives"），若 v2 已有 TabsV2 组件则优先复用（见 [tabs-v2](../../packages/ui/src/v2/components/tabs-v2.tsx)）
- 对齐 chat 功能树的 button 实现（[mode-surfaces.tsx:263-268](../../packages/app/src/components/mode-surfaces.tsx#L263-L268) `data-selected` + `aria-current`）
- icon-only 按钮（如有）必须 `aria-label`
- 焦点可见，对比度 4.5:1（body text）/ 3:1（非文本指示器）

### 6.2 产品性格（DESIGN.md L15-17）

- quiet, dense, operational
- 分组头：纯文本 + 计数，**不用 card**，不用装饰性边框/背景
- 避免 nested cards、gradient backgrounds

### 6.3 稳定布局（DESIGN.md L21）

- Tab 计数、分组头计数预留固定宽度（如 `min-w-[2ch]`）
- 会话列表加载态用 skeleton 占位，不 collapse
- hover/计数变化不 shift 布局

### 6.4 非目标边界（PRD §6.2）

- 左栏不出现"编辑产物""创建预设""运行命令"入口
- work 不做内嵌编辑器，修改走对话

---

## 7. 分期路线图

| 批次 | 内容 | 前置依赖 | 工期 | 状态 |
|------|------|---------|------|------|
| **1** | 左栏骨架 + 工种 Tab + 任务集/智能体空态 | session 加 presetCategoryId | 3-5d | 本计划 |
| 2 | 任务集 Tab | 跨会话 Task 实体（M5 方向 spawnedFrom/dependsOn）| 周级 | 待立项 |
| 3 | 智能体 Tab | skills 文件 + work 白名单放开（D2 方向 a）| 周级 | 待立项 |
| 4 | 右栏归一 | A 区 auto + 抽 SessionFileTree + work 接入 | 2-3d | 本计划 |

### 7.1 批次 1 任务拆解（5 层依赖链对齐）

| # | 任务 | 包 | 工期 |
|---|------|----|------|
| 1 | session.ts Info 加 `presetCategoryId: WorkPreset.Category` optional | schema | 0.3d |
| 2 | core `CreateInput` 加字段 + `create()` 写入 + aigcfroge HTTP Schema 加字段 + handler 透传 | core + aigcfroge | 1d |
| 3 | SDK regen（`./packages/sdk/js/script/build.ts`）| sdk/js | 0.3d |
| 4 | DraftTab 加 `presetCategoryId?` + [mode-workspace-slots.tsx:715](../../packages/app/src/pages/mode-workspace-slots.tsx#L715) 调用处透传 `preset.category`（**presetLaunch 不改**）| app | 0.3d |
| 5 | `WorkSecondarySidebar` 组件（Location + New Session + Tab + 会话列表）| app | 2d |
| 6 | 工种 Tab 分组（`computeWorkSidebarGroups` 纯函数）+ 任务集/智能体空态 + 跨模式指示器 | app | 1d |
| 7 | i18n en/zh/zht + 无障碍（@kobalte/core Tabs / tabindex）+ 布局稳定性 | app | 0.5d |
| 8 | 测试（纯函数 unit + 组件契约 + session create 透传 e2e）| app + core | 1d |

### 7.2 批次 4 任务拆解

| # | 任务 | 工期 |
|---|------|------|
| 1 | work A 区改 auto + 删 workPanel store + 删内部 ResizeHandle | 0.5d |
| 2 | 抽 `SessionFileTree` 共享组件 | 1d |
| 3 | code/chat 接入共享组件（去重）| 0.5d |
| 4 | work 接入 `SessionFileTree` | 0.5d |
| 5 | 三模式回归测试（A 区 auto + B 区 fileTree 开关）| 0.5d |

---

## 8. TDD 工作流（红-绿-重构）

> 协议依据：[AGENTS.md](../../AGENTS.md) §Testing（"Test actual implementation; do not duplicate logic into tests"、"testEffect()"、"Layer.mock"、禁 `Effect.sleep` 等并发、三模式 `it.effect`/`it.live`/`it.instance`）。每完成一个小节必须重新阅读相关协议文档。

### 8.1 测试锚点（先写测试，再实现）

| 锚点 | 类型 | 包 | 测什么 |
|------|------|----|--------|
| `computeWorkSidebarGroups` | 纯函数 unit | app | 工种分组：4 大类归类 + 老会话归"未分类" + 空会话空数组 + 分组计数正确 |
| `WorkSecondarySidebar` | 组件契约 | app | Tab 切换持久化、空态文案、跨模式指示器显隐、键盘方向键 + tabindex、布局不 shift |
| `presetCategoryId` 透传 | 端到端 | core | `Session.create({presetCategoryId})` -> session.Info 落库 -> 回读一致 |
| session create handler | HTTP 契约 | aigcfroge | payload.presetCategoryId -> core create 透传（用 `testEffect` + `Layer.mock`）|
| `SessionFileTree` 抽取 | 回归 | app | code/chat 接入后 fileTree 开关/宽度/ResizeHandle 行为不变（批次 4）|
| A 区 auto 联动 | 回归 | app | work 拖主区 ResizeHandle -> A 区宽度联动（批次 4）|

### 8.2 红绿重构节奏（批次 1）

**Step 1（红）**：先写 `computeWorkSidebarGroups.test.ts`
- 测 4 大类归类（it-development/video-creation/academic/general-office）
- 测 `presetCategoryId` 缺失归"未分类"
- 测空数组、计数
- 运行 `bun --cwd packages/app test --timeout 30000` 确认红

**Step 2（绿）**：实现 `computeWorkSidebarGroups` 纯函数（放 `pages/work-sidebar-groups.ts`，参考 `computeProgressLedger` 纯函数模式）
- 运行测试确认绿

**Step 3（红）**：写 `WorkSecondarySidebar.test.tsx` 组件契约
- Tab 切换 -> 持久化到 `mode.secondaryWorkTab`
- 工种 Tab 渲染分组 + 会话列表
- 任务集/智能体 Tab 空态文案
- 跨模式指示器 `sessionMode() !== "work"` 时显示
- 确认红

**Step 4（绿）**：实现 `WorkSecondarySidebar` 组件
- 复用 WorkProjectColumnSidebar 顶部 + SessionItem + groupSessions
- 接入 `computeWorkSidebarGroups`
- 确认绿

**Step 5（红）**：写 core `Session.create` 透传测试（`packages/core/test/session-create-preset-category.test.ts`）
- 用 `testEffect` + `Layer.mock`（参考 AGENTS.md §Testing）
- 测 `create({presetCategoryId: "it-development"})` -> info.presetCategoryId === "it-development"
- 确认红

**Step 6（绿）**：core `CreateInput` 加字段 + `create()` 写入 + aigcfroge HTTP Schema + handler 透传
- schema session.ts Info 加字段（Step 1 已做或同步做）
- SDK regen
- 确认绿

**Step 7（重构）**：审查 `WorkSecondarySidebar` 是否有重复逻辑可归并到 `computeWorkSidebarGroups`；确认无 `as any`/`@ts-ignore`（AGENTS.md §No Cheating）

### 8.3 每小节完成后重新阅读协议（强制）

| 完成小节 | 重新阅读 |
|---------|---------|
| schema 加字段 | [AGENTS.md](../../AGENTS.md) §Schema + `.aigcfroge/skills/database/SKILL.md`（若涉及 migration）|
| core CreateInput | [AGENTS.md](../../AGENTS.md) §V2 Session Core 8 invariants + [ARCHITECTURE.md](../../ARCHITECTURE.md) §4.1 |
| app 组件 | [DESIGN.md](../../DESIGN.md) §Components/Accessibility + `.aigcfroge/skills/frontend-theming/SKILL.md` |
| i18n | [DESIGN.md](../../DESIGN.md) §Text And I18n |
| 测试 | [AGENTS.md](../../AGENTS.md) §Testing + `packages/aigcfroge/test/AGENTS.md` |
| 右栏归一 | [DESIGN.md](../../DESIGN.md) §Layout + [AGENTS.md](../../AGENTS.md) §Style（不过度抽象）|

### 8.4 测试禁线（AGENTS.md §Testing）

- ❌ 禁 `Effect.sleep(N)` / `setTimeout` 等并发 fiber --用 `pollWithTimeout` / `Deferred` / `SessionStatus.Service`
- ❌ 禁 `globalThis.*` mock --用 `Layer.mock` 代替 `Layer.succeed(Service, Service.of({...}))` 全 stub
- ❌ 禁从 repo root 跑测试 --`bun --cwd packages/<name> test --timeout 30000`
- ❌ 禁复制实现逻辑到测试 --测实际行为，不测实现细节

---

## 9. 验证清单

### 9.1 批次 1 验证

- [ ] work 会话详情页左栏显示 Location + New Session + 维度 Tab + 会话列表
- [ ] 工种 Tab 按 4 大类分组，老会话归"未分类"
- [ ] 任务集/智能体 Tab 显示空态文案
- [ ] 会话列表过滤 `mode===work`，复用 SessionItem 显示逻辑
- [ ] 维度 Tab 键盘可达（方向键切换），aria-selected 正确
- [ ] 跨模式指示器：打开 chat 会话时左栏显示"当前会话为 chat 模式"
- [ ] i18n en/zh/zht 三语完整，parity 测试通过
- [ ] 布局稳定：计数变化、加载态不 shift
- [ ] `bun --cwd packages/app typecheck` 通过
- [ ] `bun --cwd packages/app test` 通过

### 9.2 批次 4 验证

- [ ] work A 区 auto 撑满，拖主区右边缘 ResizeHandle 联动 A 区宽度
- [ ] `layout.workPanel` store + `DEFAULT_WORK_PANEL_WIDTH` 已删除
- [ ] `SessionFileTree` 共享组件被 code/chat/work 三模式复用
- [ ] code/chat fileTree 行为不变（开关、宽度、ResizeHandle）
- [ ] work B 区 fileTree 默认关闭，可开关，展示项目文件含 .html 产物
- [ ] 三模式右栏 A 区宽度行为一致（auto 吃剩余）
- [ ] `bun --cwd packages/app typecheck` + `test` 通过

### 9.3 设计协议验证（DESIGN.md）

- [ ] 桌面 + 窄视口布局（text overflow、overlap、clipped、unusable scroll）
- [ ] 明暗主题（颜色/surface 改动时）
- [ ] 键盘焦点路径
- [ ] 空/加载/禁用/错误态
- [ ] 中英文 text overflow

---

## 10. 风险与应对

| 风险 | 概率 | 影响 | 应对 |
|------|------|------|------|
| session schema 加字段跨包改动回归 | 中 | 中 | optional 字段向后兼容；老会话归"未分类"；全量 typecheck + test；5 层依赖链逐层验证 |
| 5 层依赖链某层遗漏透传（core CreateInput / handler / DraftTab）| 中 | 高 | §3.6 表格逐层核对；core `Session.create` 透传测试兜底 |
| 工种 Tab 老会话全归"未分类"体验差 | 中 | 低 | 可接受：新会话从预设启动即带工种；老会话用户可手动归类（远期）|
| 右栏归一影响三模式右栏回归 | 中 | 高 | 批次 4 单独 PR；三模式 A 区/B 区逐一回归；先抽组件再接入 |
| `SessionFileTree` 抽象泄漏（三模式 fileTree 细节差异）| 中 | 中 | 抽取时保留 props 透传差异点；不强行合并互斥逻辑 |
| 任务集 Tab 命名仍与主区进度条混淆 | 低 | 低 | 已改"任务集"；空态文案明确"跨会话"语义 |

---

## 11. 开放问题

| 问题 | 状态 | 负责人 |
|------|------|--------|
| 跨会话 Task 实体（批次 2 前置）是否纳入 M5 spawnedFrom/dependsOn 方向 | 待 Core 确认 | Core |
| work 模式 agent 白名单放开策略（批次 3 前置）| 待 D2 skills 验证后定 | Core + 产品 |
| 老会话 presetCategoryId 回填（是否从 prompt 文本解析）| 暂不做，归"未分类" | 产品 |
| 左栏 Tab 切换/会话切换是否埋点 | 暂不埋点（非业务关键路径）| 产品 |

---

## 12. 关联文档

- [Work PRD v4.1](../prd/work-mode-execution-layer.md) - 范围真源（§10.2 会话详情页结构）
- [Work 路线图](work-mode-roadmap.md) - M0-M3.5 阶段全景
- [Work M1.5 计划](work-mode-execution-layer-m1.5.md) - ProgressLedger + Resume（已合入 main）
- [Work M2 计划](work-mode-execution-layer-m2.md) - 存为资产（已合入 main）
- [Work M3.5 计划](work-mode-execution-layer-m3.5.md) - HTML artifact iframe（已合入 main）
- [ADR-15](../architecture/adr/ADR-15-mode-workspace-main-area-slot.md) - ModeWorkspace slot 基座
- [DESIGN.md](../../DESIGN.md) - UI 设计协议（dense、无障碍、i18n、稳定布局）
- [ARCHITECTURE.md](../../ARCHITECTURE.md) §4.10 - Product Mode 边界（跨模式指示器、会话过滤）
- [Todo/Task 升级计划](todo-task-system-upgrade.md) - 跨会话 Task 实体（批次 2 前置）
