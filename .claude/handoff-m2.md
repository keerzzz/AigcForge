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

| Step | 内容 | 包 |
|------|------|----|
| **0** | listInvalid 数据源（core/schema/httpapi）| schema + core + aigcfroge |
| **1** | AssetWorkbench 4 列表格（新增）| app |
| **2** | ChatRightPanel 简化为 Detail Inspector | app |
| **3** | 功能树移除 + ADR-15 slot 合规 | app（删 chat-feature.ts + home.tsx `<Dynamic>` 改 render-all）|
| **4** | Insert 流程 + SessionSelectorPopover | app |
| **5** | 路由状态保持 + Dirty Draft + Provider 提到 Router 外 | app（chat-workspace.tsx 新增）|
| **6** | 全链路集成测试 | app |

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

| commit | 内容 |
|---|---|
| `5277a551c` | docs(chat-m2): M2 启动文档（handoff + plan + prd v4.5） |
| `80f1f4a09` | feat(chat-m2): Step 0 listInvalid 数据源（schema/core/httpapi/SDK 重新生成/mode-surfaces 适配） |
| `e7edeb9e9` | feat(chat-m2): Step 1 AssetWorkbench 组件 + 纯函数测试（13 测试 + i18n） |

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
