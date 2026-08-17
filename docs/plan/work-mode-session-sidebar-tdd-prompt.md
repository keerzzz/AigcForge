# Work 会话详情页左栏 + 右栏归一 · TDD 执行提示词（自包含手册）

> **用途**：粘贴到新对话作为初始 prompt，驱动独立 agent 完整执行 Work 会话详情页次级左栏（批次 1）+ 右栏归一化（批次 4）。
> **来源**：[实施计划](work-mode-session-sidebar-plan.md)（审批修正版）、[Work PRD v4.1](../prd/work-mode-execution-layer.md) §10.2、[Work 路线图](work-mode-roadmap.md)、[M1.5 TDD 手册](work-mode-m1.5-tdd-prompt.md)、[M3.5 TDD 手册](work-mode-m3.5-tdd-prompt.md)
> **分支**：`work-session-sidebar`（从最新 main 切出，≤3 词 hyphen，AGENTS.md §Branch）
> **完成标准**：计划 §9 验收清单全过 + typecheck/lint/test 绿

---

下面是直接粘贴给新对话的提示词正文（复制 `<!-- PROMPT START -->` 到 `<!-- PROMPT END -->` 之间的内容）：

<!-- PROMPT START -->

你是 AigcForge 项目的高级全栈工程师。本提示词让你**独立、端到端**执行 [Work 会话详情页次级左栏 + 右栏归一化](docs/plan/work-mode-session-sidebar-plan.md)（审批修正版）。范围真源是那份计划，本提示词是执行手册。开工前必须通读：`CLAUDE.md`、`AGENTS.md`、`DESIGN.md`、`ARCHITECTURE.md`、`packages/app/AGENTS.md`（若存在）、`.aigcfroge/skills/effect/SKILL.md`、`.aigcfroge/skills/frontend-theming/SKILL.md`。

**⚠️ 5 层依赖链是硬约束（计划 §3.6）**：presetCategoryId 透传必须覆盖 schema → core CreateInput → aigcfroge HTTP Schema → handler → DraftTab 五层，任何一层遗漏都会导致数据断流。逐层核对，不可跳层。

**⚠️ presetLaunch 不改（审批修正）**：preset 对象已有 `category` 字段（`packages/schema/src/work-preset.ts:36`），调用处直接用 `preset.category`，不创造新接口。违反"以创造接口为耻"即返工。

---

## 0. 你的任务（一句话）

替换 work 会话详情页次级左栏的 `PlaceholderSidebar` 占位，实现"Location + New Session + 维度 Tab（工种/任务集/智能体）+ 会话列表"结构（方向 A），并归一化右栏（A 区改 auto 撑满 + 抽共享 SessionFileTree 组件对齐 code/chat）。批次 1 先做左栏 + 工种 Tab（session 加 presetCategoryId），批次 4 做右栏归一。

## 1. 范围与禁区

### 1.1 范围（批次 1 只做这些）
- schema `session.ts` Info 加 `presetCategoryId: WorkPreset.Category.pipe(Schema.optional)`
- core `session.ts:72` `CreateInput` 加 `presetCategoryId?` + `create()` 写入
- aigcfroge HTTP Schema `Session.CreateInput` 加字段 + handler 透传
- SDK regen（`./packages/sdk/js/script/build.ts`）
- app `DraftTab` 加 `presetCategoryId?` + `mode-workspace-slots.tsx:715` 调用处透传 `preset.category`（**presetLaunch 不改**）
- 新建 `WorkSecondarySidebar` 组件（Location + New Session + 维度 Tab + 会话列表）
- 新建 `computeWorkSidebarGroups` 纯函数（工种 4 大类分组）
- 复用 SessionItem + groupSessions（`packages/app/src/pages/home-shared.tsx`，原 home.tsx 拆除后的共享 owner）
- 跨模式指示器（复用 `session.tsx:1626` sessionMode 路径）
- i18n en/zh/zht（8 个新 key，见计划 §5.1）
- 无障碍（@kobalte/core Tabs 或 TabsV2 + role=tablist + tabindex 管理）

### 1.2 禁区（违反即返工，绝对不做）
- ❌ 不改 `presetLaunch` 返回值（它是 prompt 生成器，preset.category 直接取）
- ❌ 不在 schema 包 import app 包（WorkPreset.Category 已在 schema 包，同包 import）
- ❌ 不新建数据库 migration（presetCategoryId 存 session.Info JSON 列，optional 自动兼容）
- ❌ 不重复造主区/右栏已有能力（进度条/Resume/Context Tab/Artifact Tab/存为资产/问卷澄清均已落地，见计划 §1.3）
- ❌ 不做任务集 Tab 功能（批次 2，跨会话 Task 实体未就绪）--首期空态占位
- ❌ 不做智能体 Tab 功能（批次 3，skills/白名单未就绪）--首期空态占位
- ❌ 不做功能列表/启动器区（D1 决策：启动器留首页 WorkPresetCatalogMain）
- ❌ 不用 card 包裹分组头（DESIGN.md L15-17 dense 风格）
- ❌ 不用 `export namespace` / alias import / star import（AGENTS.md §Imports）
- ❌ 测试禁 `Effect.sleep` / `setTimeout` / `globalThis.*` mock / repo root 跑测试（AGENTS.md §Testing）

## 2. 设计决策（已定案，必须遵守）

### 2.1 方向 A：维度 Tab + 会话列表常驻下方
- Tab 在上（工种/任务集/智能体），会话列表在 Tab 下方（非 Tab 之一）
- 会话列表按选中 Tab 维度分组，复用 SessionItem 显示逻辑（同 code/chat）

### 2.2 D1 左栏无功能列表
- 左栏 = 切换对话（会话列表）+ 切换工作（维度 Tab）+ 创建新会话（New Session）
- 启动器（预设/工作流）留首页，不在左栏

### 2.3 Q2 任务集命名 + Q3 工种 4 大类
- "任务"Tab 改名"任务集"（避免与主区 Progress Ledger 任务步骤混淆）
- 工种 Tab 按 4 大类分组（it-development/video-creation/academic/general-office），非 17 细工种
- 老会话无 presetCategoryId 归"未分类"组

### 2.4 D5 A 区 auto + D6 B 区对齐 code（批次 4）
- work A 区 `workPanel.width px` → `auto`，删内部 ResizeHandle + `layout.workPanel` store + `DEFAULT_WORK_PANEL_WIDTH`
- 三模式共用主区 `session.width` ResizeHandle 联动 A 区
- 抽共享 `SessionFileTree` 组件，code/chat 去重 + work 接入，默认关

## 3. 代码锚点（5 层依赖链 + 组件，已核实，直接用）

| 能力 | 位置 | 动作 |
|---|---|---|
| WorkPreset.Category（schema 已有）| `packages/schema/src/work-preset.ts:5-11` | 不改，import 用 |
| session.Info | `packages/schema/src/session.ts:31-64` | 改：加 `presetCategoryId: WorkPreset.Category.pipe(Schema.optional)` |
| core CreateInput | `packages/core/src/session.ts:72-81` | 改：加 `presetCategoryId?` + `create()` 写入 |
| aigcfroge HTTP Schema | `@/session/session` Session.CreateInput（`groups/session.ts:315` 引用）| 改：加 Schema 字段 |
| session create handler | `packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts` | 改：透传 payload.presetCategoryId |
| SDK regen | `./packages/sdk/js/script/build.ts` | 跑 regen |
| DraftTab | `packages/app/src/context/tabs.tsx:21-29` | 改：加 `presetCategoryId?` |
| presetLaunch 调用处 | `packages/app/src/pages/mode-workspace-slots.tsx:715` | 改：`newDraft({..., presetCategoryId: preset.category}, presetLaunch(preset))` |
| PlaceholderSidebar 替换点 | `packages/app/src/components/secondary-sidebar.tsx:666-668` | 改：替换为 WorkSecondarySidebar |
| WorkProjectColumnSidebar（复用顶部）| `packages/app/src/pages/mode-workspace-slots.tsx:521-590` | 不改，抽 Location+New Session 复用 |
| SessionItem（复用行）| `packages/app/src/pages/layout/sidebar-items.tsx:147` | 不改，复用 |
| groupSessions（复用分组）| `packages/app/src/pages/home-shared.tsx` | 不改，复用 |
| sessionMode（复用跨模式指示）| `packages/app/src/pages/session.tsx:1626` | 不改，复用读取路径 |
| computeWorkSidebarGroups | 新建 `packages/app/src/pages/work-sidebar-groups.ts` | 新建：纯函数，参考 computeProgressLedger 模式 |
| WorkSecondarySidebar | 新建 `packages/app/src/components/work-secondary-sidebar.tsx` | 新建组件 |
| workPanel store（批次4删）| `packages/app/src/context/layout.tsx:28,282,698-705` | 删：DEFAULT_WORK_PANEL_WIDTH + workPanel store |
| work A 区 ResizeHandle（批次4删）| `packages/app/src/pages/work-artifact-panel.tsx:280,285,306-321` | 删：改 auto + 删 ResizeHandle |
| fileTree 重复逻辑（批次4抽）| `session-side-panel.tsx:70-85` + `chat-right-panel.tsx:72-82` | 抽：SessionFileTree 共享组件 |

## 4. TDD 工作流（红-绿-重构，每小节后重读协议）

### Step 1（红）：`computeWorkSidebarGroups.test.ts`
```
- 测 4 大类归类（it-development/video-creation/academic/general-office）
- 测 presetCategoryId 缺失归"未分类"
- 测空数组、计数
- bun --cwd packages/app test --timeout 30000 确认红
```
**完成后重读**：AGENTS.md §Testing

### Step 2（绿）：实现 `computeWorkSidebarGroups` 纯函数
```
- 放 packages/app/src/pages/work-sidebar-groups.ts
- 参考 computeProgressLedger 纯函数模式
- 确认绿
```

### Step 3（红）：`WorkSecondarySidebar.test.tsx` 组件契约
```
- Tab 切换 -> 持久化 mode.secondaryWorkTab
- 工种 Tab 渲染分组 + 会话列表
- 任务集/智能体 Tab 空态文案
- 跨模式指示器 sessionMode() !== "work" 时显示
- 键盘方向键 + tabindex
- 确认红
```
**完成后重读**：DESIGN.md §Components/Accessibility + frontend-theming SKILL

### Step 4（绿）：实现 `WorkSecondarySidebar`
```
- 复用 WorkProjectColumnSidebar 顶部 + SessionItem + groupSessions
- 接入 computeWorkSidebarGroups
- 确认绿
```

### Step 5（红）：core `Session.create` 透传测试
```
- packages/core/test/session-create-preset-category.test.ts
- testEffect + Layer.mock（参考 AGENTS.md §Testing）
- 测 create({presetCategoryId: "it-development"}) -> info.presetCategoryId === "it-development"
- 确认红
```
**完成后重读**：AGENTS.md §V2 Session Core 8 invariants + ARCHITECTURE.md §4.1

### Step 6（绿）：5 层依赖链实现
```
- schema session.ts Info 加字段
- core CreateInput 加字段 + create() 写入
- aigcfroge HTTP Schema + handler 透传
- SDK regen
- DraftTab 加字段 + mode-workspace-slots.tsx:715 透传 preset.category
- 确认绿
```
**完成后重读**：AGENTS.md §Schema + database SKILL（确认无需 migration）

### Step 7（重构）：审查
```
- 无 as any / @ts-ignore（AGENTS.md §No Cheating）
- 无重复逻辑可归并到 computeWorkSidebarGroups
- 自导出模式 export * as Foo（AGENTS.md §Imports）
- 确认绿
```

### 批次 4 TDD（左栏合入后单独 PR）
```
- 红：SessionFileTree 抽取后 code/chat 回归测试（fileTree 开关/宽度/ResizeHandle 不变）
- 绿：抽 SessionFileTree + work 接入 + A 区改 auto
- 重读：DESIGN.md §Layout + AGENTS.md §Style（不过度抽象）
```

## 5. 验收清单（计划 §9，全过才算完成）

### 批次 1
- [ ] work 会话详情页左栏显示 Location + New Session + 维度 Tab + 会话列表
- [ ] 工种 Tab 按 4 大类分组，老会话归"未分类"
- [ ] 任务集/智能体 Tab 显示空态文案
- [ ] 会话列表过滤 `mode===work`，复用 SessionItem
- [ ] 维度 Tab 键盘可达（方向键），aria-selected + tabindex 正确
- [ ] 跨模式指示器：打开 chat 会话时左栏显示"当前会话为 chat 模式"
- [ ] i18n en/zh/zht 三语完整，parity 测试通过
- [ ] 布局稳定：计数变化、加载态不 shift
- [ ] `bun --cwd packages/app typecheck` 通过（tsgo -b）
- [ ] `bun --cwd packages/app test --timeout 30000` 通过
- [ ] `bun --cwd packages/core test --timeout 30000` 通过（create 透传测试）
- [ ] `bun run lint` 通过（oxlint）

### 批次 4
- [ ] work A 区 auto 撑满，拖主区右边缘 ResizeHandle 联动 A 区
- [ ] `layout.workPanel` store + `DEFAULT_WORK_PANEL_WIDTH` 已删除
- [ ] `SessionFileTree` 共享组件被 code/chat/work 三模式复用
- [ ] code/chat fileTree 行为不变（开关、宽度、ResizeHandle）
- [ ] work B 区 fileTree 默认关闭，可开关
- [ ] 三模式右栏 A 区宽度行为一致（auto 吃剩余）

## 6. 改完即审（CLAUDE.md 强制）

每次提交前走完：
1. `git diff -- <files>` 锁定改动
2. 安全门禁：Catch Everything / No Null Pointer / Security First
3. 工程门禁：No Cheating / Reusability / Clean Logs
4. 数据流追踪：presetCategoryId 从 preset.category → DraftTab → Session.create → session.Info 全链路通
5. 命令验证：lint + typecheck + test（受影响包）
6. 输出复查结论

## 7. 分支与提交

- 分支：`work-session-sidebar`（≤3 词 hyphen，无斜线，AGENTS.md §Branch）
- commit：`feat(app): work secondary sidebar with dimension tabs` / `feat(schema): session presetCategoryId field` 等 conventional commit
- 批次 1 和批次 4 分开 PR（D4 决策）

<!-- PROMPT END -->
