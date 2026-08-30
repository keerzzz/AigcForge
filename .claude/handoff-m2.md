# M2 实施启动提示词

你作为 AigcForge 高级全栈工程师，需实施 Chat M2：Asset Studio 资产工作室。

M1 已全部闭环（commit `e0700c19f`，分支 `chat-m1-closure`），包括 Phase A-F 核心代码 + flag gate + E2E 测试 + V2 smoke 测试。

## 必读文档（首读）

1. **CLAUDE.md** — 八荣八耻、改完即审 7 步、极致减法、门禁
2. **AGENTS.md** — Effect 编码、Schema、测试规范、自导出模式
3. **DESIGN.md** — v2 Token、UI 性格、a11y、i18n
4. `docs/plan/chat-asset-studio-m2.md` — M2 实施计划（审批通过版）
5. `docs/prd/chat-mode-creation-layer.md` — PRD v4.5
6. `.aigcfroge/skills/effect/SKILL.md` — Effect 编码指南
7. `.aigcfroge/skills/frontend-theming/SKILL.md` — v2 token 指南
8. `packages/app/AGENTS.md` + `packages/aigcfroge/AGENTS.md`

## M2 实施步骤（严格按序，不允许跳过）

每步 TDD：先写测试（红）→ 最小实现（绿）→ 重构（清理）

每步完成后执行**改完即审流程**：

```
1. git diff -- <files>
2. 匹配 Skills（effect / frontend-theming）
3. 安全复查（Catch Everything / No Null Pointer / Security First）
4. 整洁复查（No Cheating / Reusability / Clean Logs）
5. 数据流追踪（每个 Effect Layer 已 provide）
6. 命令验证（typecheck + test + lint）
7. 输出复查结论
```

**下一个小节的先决条件：上一个 Step 全部验证通过。**

### 实施顺序

| Step  | 内容                                                 | 包                                                             |
| ----- | ---------------------------------------------------- | -------------------------------------------------------------- |
| **0** | listInvalid 数据源（core/schema/httpapi）            | schema + core + aigcfroge                                      |
| **1** | AssetWorkbench 4 列表格（新增）                      | app                                                            |
| **2** | ChatRightPanel 简化为 Detail Inspector               | app                                                            |
| **3** | 功能树移除 + ADR-15 slot 合规                        | app（删 chat-feature.ts + home.tsx `<Dynamic>` 改 render-all） |
| **4** | Insert 流程 + SessionSelectorPopover                 | app                                                            |
| **5** | 路由状态保持 + Dirty Draft + Provider 提到 Router 外 | app（chat-workspace.tsx 新增）                                 |
| **6** | 全链路集成测试                                       | app                                                            |

### 关键约束（审批定论）

- **不引入** `@solidjs/testing-library`，沿用 `bun:test` + `happydom` preload
- **不做** AssetKind 框架泛化、全局资产写入、外部导入、会话捕获、命令开闸
- 🔴 **坏文件标记** 数据源来自 Step 0 listInvalid，不存在先降级
- **Dirty Draft**：solid-router 无 `beforeRouteLeave`，用 `createEffect` + 确认 Modal
- **ADR-15 合规**：`home.tsx:461` `<Dynamic>` → `render-all + display:none`
- **ChatWorkspaceProvider** 必须挂 Router 之上（app.tsx router 层之外）
- **新组件必须用 v2 token**（`--v2-*`，遵循 frontend-theming skill）
- **新 Effect 代码**：`Effect.gen(function*(){})` + `Effect.fn("Name")` + `Schema.TaggedErrorClass`（遵循 effect skill）

开始 Step 0。

---

## 会话 1 进展（2026-07-24）

### 已完成并 commit（分支 chat-m1-closure）

| commit      | 内容                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------- |
| `5277a551c` | docs(chat-m2): M2 启动文档（handoff + plan + prd v4.5）                                         |
| `80f1f4a09` | feat(chat-m2): Step 0 listInvalid 数据源（schema/core/httpapi/SDK 重新生成/mode-surfaces 适配） |
| `e7edeb9e9` | feat(chat-m2): Step 1 AssetWorkbench 组件 + 纯函数测试（13 测试 + i18n）                        |

### Step 2 决策：跳过首页 Inspector

- chat 首页**对齐 code 首页**（两列：SecondarySidebar + AssetWorkbench 主区，**无右栏 Inspector**）
- code 模式 `modeSurface.RightPanel = () => null`（mode-surfaces.tsx:264），首页 home.tsx 不渲染 RightPanel
- 可编辑交互放**会话页**（PRD §9.5 资产 tab 查看/编辑），首页 AssetWorkbench 仅浏览 + 行操作 `[Insert]`/`[Edit]` 跳会话页（Step 4 Insert 流程）
- `chat-right-panel.tsx` 是**会话页右栏**（session-side-panel.tsx:480 渲染），PRD §9.2 双区，**保持不动**

### Step 3 完整方案（新会话执行，6 项）

1. 删 `chat-feature.ts` + mode-surfaces 的 `CHAT_FEATURES`/`useChatFeatureData`/`ChatFeatureSidebar`/`ChatFeaturePanel`
2. 新建简化 `ChatSidebar`（Location + newSession + addProject，删功能树导航）替代 ChatFeatureSidebar；`modeSurface.chat.Sidebar = ChatSidebar`
3. `home.tsx` 主区 `ChatFeaturePanel` -> `AssetWorkbenchTable`（条件 mode=chat；删 L492-494 Show fallback + L61 chat-feature import）
4. `secondary-sidebar.tsx:664` 删 `<Dynamic component={modeSurface(mode.currentMode).Sidebar} />`（修 M1 重复，非 coding 分支只留 ChatSessionList）
5. `secondarySidebarOpen` 默认 `true` -> `false`（mode.tsx:92 `createStore({ open: true })`，对齐"默认次级左侧边栏关闭"）
6. ADR-15：`home.tsx:461` `<Dynamic>` 改 render-all + `display:none`（slot 仅 chat/code 两个，方案 1）

### 关键发现（新会话必读，避免重复探索）

- **chat-right-panel.tsx 是会话页右栏**（session-side-panel.tsx:480 `<Dynamic component={modeSurface(mode).RightPanel} />`），非首页右栏。PRD §9.2 双区（A 区 tabs + B 区 FileTree 资产树），M1 已实现 S2/A1-A5，**M2 不动**
- **M1 遗留左栏重复**：Home 内部 L461 `<Dynamic modeSurface.Sidebar>` + layout `SecondarySidebar`（secondary-sidebar.tsx:664 也渲染 modeSurface.Sidebar）。`secondarySidebarOpen` 默认 true 致 ChatFeatureSidebar 渲染两次。Step 3 项 4+5 修复
- **测试策略 A**：spike 验证 bun test 无法渲染 solid JSX（双层阻碍：① `node` 条件走 `solid-js/web/dist/server.js` notSup ② bun 内置 transpiler 把 JSX 编 React runtime，`React is not defined`）。app 现有测试全纯逻辑（`solid-virtual.test.ts` 用 `createRoot` 无 JSX，`--conditions=browser` 仅 for `@tanstack/solid-virtual` 内部 client API）。**UI 组件测纯函数+store，渲染靠 dev server 手动验证**。AssetWorkbench 已按此模式（asset-workbench.test.ts 13 测试纯函数）
- **AssetWorkbench 组件名 `AssetWorkbenchTable`**（自导出 `export * as AssetWorkbench` 占用 AssetWorkbench 名），Step 3 挂载时定终名
- **Updated 列暂显示 "-"**（Summary 无 mtime 字段，数据源属 schema 扩展，不在 M2 Step 1 范围），sortRows 按 name 排序，TODO(M2+)
- **errorTag 方案 B**：空 `parsed.data` = parse_error（gray-matter 吞 YAML 错误返回空 data，`!parsed` 几乎不可达）；非空但 schema 失败 = bad_frontmatter；同名 = name_conflict（标记所有冲突文件）。三类皆可测。趁契约未扩散零破坏（M1 未 expose errorTag）
- **list 响应 breaking change**：`Schema.Array(Summary)` -> `ListResponse {assets, invalid}`。消费方：mode-surfaces.tsx:104（已适配 `.assets?.length`）、chat-right-panel.tsx:173（不消费 data，仅 refetch）。SDK 已重新生成（gen 仅 list 相关零 drift）

### 新会话启动步骤

1. 读本文件 + `docs/plan/chat-asset-studio-m2.md` + CLAUDE.md 协议
2. `git log --oneline -5` 确认 Step 0-1 commit
3. 按 Step 3 完整方案 6 项执行（TDD/重构，每项 typecheck + test + lint 验证）
4. Step 3 完成后继续 Step 4（Insert 流程）、Step 5（路由状态）、Step 6（集成测试）

---

## 会话 2 进展（2026-07-25）：Step 3 已完成

### 已完成并 commit（分支 chat-m1-closure）

| commit      | 内容                                                                   |
| ----------- | ---------------------------------------------------------------------- |
| `c95bd1bbb` | refactor(chat-m2): secondarySidebarOpen 默认 true->false（项5）        |
| `4dab40c0f` | refactor(chat-m2): Step 3 功能树移除 + ADR-15 slot 合规（项1+2+3+4+6） |

### Step 3 实施要点（供 Step 4-6 参考）

**render-all 机制（ADR-15 §4 方案1）**：

- L461 sidebar grid slot：`display: contents`（visible）/ `display: none`（hidden）。visible slot 的组件 root 直接成为 grid item（col 1），无额外 wrapper 改变布局
- 主区 section：`display: flex`（visible，flex-1 填充）/ `display: none`（hidden）。wrapper div 承载 pt-6（coding slot）/ 无 padding（chat slot）
- 两个 slot 常驻挂载，display 切换不 remount，createResource 不重取

**数据流**：

- `useChatDirectory()`（mode-surfaces.tsx 导出）：server.current ?? server.list[0] -> ensureServerCtx -> lastSession.directory(scope) ?? 首个 project worktree。ChatSidebar 与 Home 资产 fetch 共用，确保 Location 展示与资产列表目录一致
- Home `createResource(chatDirSdk, promptAsset.list)`：提升到 Home（slot 之上，ADR-15 §4 方案2），**非 mode-gated**（避免切换 chat 时重取）；chatAssetList()?.assets/invalid ?? [] 传入 AssetWorkbenchTable
- `ChatSidebarSlot = modeSurface("chat").Sidebar`（模块级 const，经 registry 解析，保持 modeSurface.chat.Sidebar 非死代码）

**work/assistant 模式处理**：落入 code slot（HomeProjectColumn + session list），对齐 ADR-15 §2「会话列表降为共享能力」。原 PlaceholderSidebar 被替代（项目导航比 placeholder 更有用）。SecondarySidebar 对 work/assistant 为空（仅 coding 有 project list + workspaces，chat 有 ChatSessionList）

**chat 主区左栏（ChatSidebar）**：Location 展示 + New Session + Add Project，内容较短，grid stretch 下空余空间在底部（符合预期：会话降为次级，主区聚焦资产）

### 验证状态

- typecheck ✓（`bun --cwd packages/app typecheck` = tsgo -b，0 errors）
- test ✓（450 pass / 0 fail，含 asset-workbench.test.ts 13 纯函数测试）
- lint ✓（0 errors，2472 warnings **全 pre-existing**，0 新增。mode-surfaces 的 consistent-return/unbound-method/no-unnecessary-type-assertion warning 从删除的 useChatFeatureData/ChatFeatureSidebar 迁移而来，实际 -1 warning）
- ⚠️ **dev server 视觉验证待做**（test strategy A：渲染靠手动）。需验证：chat 主区 AssetWorkbenchTable 填充、左栏 ChatSidebar 布局、render-all display:contents/flex 在 chat<->coding 切换不闪烁、work/assistant 落入 code slot

### 遗留 / 后续

- **i18n 孤立 key 未清理**：`chat.feature.title/skill/mcp/command/agent/workflow/prompt.description/empty/location`（location 改动前已是孤立）。plan §5 改动清单未列 i18n 文件，Step 3 不在范围。后续可统一清理（18 locale × 9 key）
- **AssetWorkbenchTable onSelect 未接**：Step 3 仅浏览（无行操作）。Step 4 需扩展：行 hover [Insert]/[Edit] 按钮 + SessionSelectorPopover + 跳转注入。当前组件无行操作按钮（仅行点击 -> onSelect），Step 4 需补
- **home.tsx:60 `type Mode` 未使用**：pre-existing（改动前后均未使用），非 Step 3 引入，不顺手修

### Step 4-6 接续

1. **Step 4（Insert 流程）**：新建 `asset-session-selector.tsx`（SessionSelectorPopover）+ AssetWorkbenchTable 加行操作按钮 + 目标页 `?insert=<path>` 参数检测注入 Composer
2. **Step 5（路由状态保持）**：新建 `chat-workspace.tsx`（ChatWorkspaceContext）+ Provider 挂 Router 之外 + Dirty Draft 确认 Modal
3. **Step 6（全链路集成测试）**：表格 -> 选行 -> Insert -> 跳转 -> 注入

---

## 会话 2 进展（续 - 2026-07-25）：产品反馈驱动重构

**重要**：上面「Step 3 已完成」描述的功能树移除已被产品反馈推翻。功能分类+资产计数导航有价值，按用户决策恢复。当前状态以本节为准。

### 新增 commit

| commit      | 内容                                                             |
| ----------- | ---------------------------------------------------------------- |
| `5ca4b6b84` | refactor(chat-m2): 按产品反馈恢复功能树导航 + chatFeature 持久化 |
| `eddfd73f2` | fix(chat-m2): ChatSessionList 标题 i18n 误译 项目列表->会话列表  |

### 当前 chat 首页布局（最终态）

- **Home L461（chat slot，常驻）**：ChatSidebar（瘦版：Location + New Session + Add Project）。render-all display:contents/none
- **SecondarySidebar（chat，默认关闭，打开后）**：ChatFeatureSidebar（全貌：Location + New Session + 功能树 prompt/skill/mcp/command/agent/workflow + 计数）+ ChatSessionList（下方，标题「会话列表」）
- **Home 主区（chat slot）**：功能切换 Show--prompt->AssetWorkbenchTable，其他->ChatFeaturePanel（运行时列表，只读）。render-all display:flex/none 包裹
- **chatFeature 持久化**：ChatFeatureProvider（Layout 内，ModeProvider 下）+ useChatFeature() context。Persist.global `chat.feature.v1`，下次进入恢复上次选择
- **modeSurface.chat.Sidebar = ChatFeatureSidebar**（SecondarySidebar 用 Dynamic 渲染）；Home L461 直接导入 ChatSidebar（不经 modeSurface）

### 保留的 Step 3 决策

- item 3：Home 主区 chat 用 AssetWorkbenchTable（prompt 功能时）
- item 5：secondarySidebarOpen 默认 false（对齐 code 首页不显示次级侧栏）
- item 6：render-all（L461 sidebar slot + 主区 section，display:contents/flex）
- useChatDirectory hook（ChatSidebar/ChatFeatureSidebar/Home 资产 fetch 共用）

### 验证状态

- typecheck ✓ / test 450 pass ✓ / lint 0 errors（2475 warnings，+3 来自 ChatSidebar/ChatFeatureSidebar 共享 Location+addProject 逻辑的重复 unbound-method/no-unnecessary-type-assertion，M1 既有模式）
- ⚠️ dev server 视觉验证进行中（用户已确认布局结构正确，发现并修复 ChatSessionList 标题误译）

### 技术债 / 遗留

- **ChatSidebar/ChatFeatureSidebar Location+addProject 重复**：两 sidebar 变体共享 header 逻辑（~50 行 + 2 lint warnings）。可抽取 ChatSidebarHeader 归并（后续重构）
- **ChatFeaturePanel 非 prompt 功能显示运行时列表**：skill/mcp/command/agent 是 server-sync 数据（非持久化资产）。M2 只有 prompt 是真资产类型。PRD §9.4 资产树按消费路径分组（非按 kind），功能树分类是 M1 设计，后续对齐 PRD
- **AssetWorkbenchTable onSelect 未接**：Step 4 补行操作 + SessionSelectorPopover
- **i18n sessionList 仅 en+zh**：其他 16 locale 回退 en「Session list」（与 projectList 现状一致）；全本地化待后续
