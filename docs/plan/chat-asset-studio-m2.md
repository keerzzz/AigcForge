# Chat 模式 M2 实施计划：Asset Studio 资产工作室 + Insert 闭环

> 状态：Draft（待审批）
> 依据：[PRD v4.5](../prd/chat-mode-creation-layer.md)（Approved 2026-07-18）、[ADR-15](../architecture/adr/ADR-15-mode-workspace-main-area-slot.md)（Accepted 2026-07-19）
> 范围：`packages/app`（主区 AssetWorkbench / ChatRightPanel / SecondarySidebar / Insert 流程 / 路由状态）+ `packages/core` + `packages/schema` + `packages/aigcfroge`（listInvalid 数据契约）
> 关联：[M1 计划](chat-mode-creation-layer-m1.md)、[右栏重构已落地](chat-right-panel-filetree-refactor.md)
> Owner：App（UI 架构）/ Core（listInvalid 数据源）/ Product（范围确认）

---

## 0. M1 → M2 范围缺口矩阵

| 维度                   | M1 已完成                                      | M2 范围                              | 后续         |
| ---------------------- | ---------------------------------------------- | ------------------------------------ | ------------ |
| **主区**               | ModeRoute 渲染 Home / ModeCards 已删           | ✅ AssetWorkbench 4 列表格（新增）   | —            |
| **右栏**               | 双区 ChatRightPanel                            | ✅ 简化为纯 Detail Inspector         | —            |
| **次级侧栏**           | 6 分类功能树 + ChatSessionList                 | ✅ 移除功能树，只留 Location+会话    | —            |
| **Insert 流程**        | 无                                             | ✅ SessionSelectorPopover + 跳转注入 | —            |
| **健康度**             | 无                                             | ✅ 🔴 行级标记                       | —            |
| **ADR-15 合规**        | `home.tsx:461` 用 `<Dynamic>` （remount 违禁） | ✅ 改为 render-all + display:none    | —            |
| **listInvalid 数据源** | registry 跳过坏文件但不存储                    | ✅ 新增 listInvalid + HTTP API       | —            |
| **AssetKind 框架**     | PromptAsset 单类型                             | ❌ 不做                              | 后续独立一期 |
| **外部导入**           | 无                                             | ❌ 不做                              | 后续         |
| **会话捕获**           | 无                                             | ❌ 不做                              | 后续         |
| **命令开闸**           | 无                                             | ❌ 不做                              | 后续         |
| **分析设施**           | 无                                             | ❌ 不做                              | G3 后        |

---

## 1. M2 目标

### 1.1 范围（含）

1. **主区 Asset Studio 资产工作室** — 4 列资产数据表格，Kind:All▼ Dropdown + 搜索框 + [+New Asset] + [Import]（占位禁用）
2. **右栏 ChatRightPanel 简化为纯 Detail Inspector** — 移除 B 区 FileTree，A 区简化为单资产详情预览
3. **次级侧栏 SecondarySidebar 移除功能树** — 6 分类功能树及其 context 移除，只保留 LocationSelector + ChatSessionList
4. **Insert 流程** — 行 Hover [Insert] → SessionSelectorPopover → 跳转 `/server/:key/session/:id?insert=<path>` 注入 Composer
5. **健康度行级标记** — 不引入常驻 Banner；Kind Badge 右上角 🔴 角标标记坏文件
6. **路由状态保持** — `/mode/chat` ↔ 会话页 切换时右栏状态缓存，Provider 挂 Router 之上
7. **文件夹级资产** — Registry 用 `glob("**/*.md")` 已递归加载，表格 Path 列展示相对路径
8. **ADR-15 §4 slot 合规** — home.tsx:461 `<Dynamic component={modeSurface(mode).Sidebar} />` 改为 render-all + display:none（ADR-15 设禁用方案 1，推荐方案 2 上提 resource；M2 选择方案 1 因其实现代价低且 slot 仅 2 个，未来 chat-workspace 扩展后再迁方案 2）
9. **listInvalid 数据源** — PromptAsset registry 存储无效文件列表 + HTTP API 携带 invalid 标记

### 1.2 资产作用域

| 作用域       | 当前状态                              | 说明                                       |
| ------------ | ------------------------------------- | ------------------------------------------ |
| **项目级**   | ✅ M1 已实现                          | `<Location.directory>/.aigcfroge/prompts/` |
| **文件夹级** | ✅ M1 已支持（registry 用 glob 递归） | Path 列展示子目录路径                      |
| **全局**     | ❌ PRD §5.2 非目标                    | 其他服务有全局层，PromptAsset 不做         |

### 1.3 非目标（不含）

- **AssetKind 框架泛化** — 不泛化 PromptAsset，表格仅展示 prompts
- **外部导入路径** — Header [Import] 按钮保持 disabled/占位
- **会话捕获路径** — 不实现消息"存为资产"动作
- **命令/其他类型开闸** — 不在 M2 开新类型
- **分析设施** — 不实现分桶/归因/G3 指标
- **窄屏适配** — 延用 M1 A5 <768px 抽屉行为，不做新窄屏改动

---

## 2. 页面架构拓扑

```
ModeWorkspace (app.tsx ModeRoute → <Home />)
├── ModeSwitcher (左轨)
├── SecondarySidebar
│   ├── LocationSelector
│   ├── [+ New Session]
│   └── ChatSessionList
├── MainWorkspaceSlot (home.tsx 主区 - AssetWorkbench)
│   ├── StudioHeader (Title / Search / Kind:All▼ / [+ New Asset])
│   └── AssetDataTable (4列)
│       ├── KindColumn (80px - Pill Badge + 🔴)
│       ├── NamePathColumn (35%)
│       ├── DescriptionColumn (40%)
│       └── UpdatedColumn (20% - Hover [Insert][Edit][⋮])
├── ChatRightPanel (Detail Inspector)
│   ├── InspectorHeader
│   └── InspectorBody (TemplatePreview + VariableForm)
└── StatusBar
```

---

## 3. 实施步骤（TDD 工作流）

**测试规范**：沿用 `bun:test` + `happydom` preload（**不引入** `@solidjs/testing-library`），组件测试 colocate `src/components/chat/*.test.ts`
**UI 规范**：新组件使用 v2 token（`--v2-*`），遵循 DESIGN.md / frontend-theming skill
**Effect 规范**：Schema 使用 `Schema.Class` / `Schema.TaggedErrorClass`，遵循 effect skill / AGENTS.md

### Step 0: listInvalid 数据源（core/schema/httpapi）

**位置**：`packages/core/src/prompt-asset.ts` + `packages/schema/src/prompt-asset.ts` + `packages/aigcfroge/src/server/httpapi/groups+handlers/prompt-asset.ts`

**红**：坏文件跳过并存储；`listInvalid()` 返回 `ReadonlyArray<{relativePath: string, errorTag: string}>`；`getInvalid(relativePath)` 返回单个或 undefined；HTTP list 响应携带 invalid 数组；脱敏：errorTag 不含正文或旧内容（PRD §9.4 C3）

**绿**：loadDir 中存储跳过文件到 `invalid` map（errorTag 分类：`parse_error` / `bad_frontmatter` / `name_conflict`）；Interface 扩 `listInvalid()/getInvalid()`；API list 端点附加 invalid 数据

### Step 1: AssetWorkbench 表格组件（新建）

**位置**：`packages/app/src/components/chat/asset-workbench.tsx`（**新增**，当前不存在源文件）

**红**：空态 / 4 列结构（Kind Badge + NamePath + Description + Updated）/ Kind Dropdown 过滤 / 搜索防抖过滤 / 行点击触发选中回调 / Hover 浮现 [Insert][Edit][⋮] / 🔴 角标标记坏文件（数据来自 listInvalid）

**绿**：solid-js 组件 + v2 token（`--v2-*`）+ 4 列 table + `useAssetStore`（从 registry list 取数据）+ `KindFilterDropdown` + `SearchInput` + `AssetRow`

**关键数据流**：

```
PromptAsset.list (registry) → AssetWorkbench → 4 列渲染
                                           ↓
                    行点击 → onSelect(asset) → ChatRightPanel Inspector
```

### Step 2: ChatRightPanel 简化为 Detail Inspector

**位置**：`packages/app/src/components/chat/chat-right-panel.tsx`

**红**：选中资产行渲染详情（name/description/template/preview）/ 空态"选择一个资产查看详情" / VariableForm / FileTree 已移除

**绿**：移除 B 区 FileTree；A 区改造（无选中→空态，有选中→name+description+TemplatePreview+VariableForm）；移除多余 tab 合并为单资产详情

**重构**：删 `FileTree` import / 删 `file.tree.refresh` 调用

### Step 3: SecondarySidebar 功能树移除 + ADR-15 slot 合规

**位置**：

- `packages/app/src/context/chat-feature.ts`（删除，功能树 context 源）
- `packages/app/src/components/mode-surfaces.tsx`（修改，删 CHAT_FEATURES/ChatFeatureSidebar/ChatFeaturePanel）
- `packages/app/src/components/secondary-sidebar.tsx`（修改，删 FeatureSidebar 渲染）
- `packages/app/src/pages/home.tsx`（修改，删 ChatFeaturePanel 渲染点 L492-494 + `<Dynamic>` slot L461）
- `packages/app/src/app.tsx`（修改，确认 ModeRoute slot 路径无动态组件切换）

**红**：无功能树 / 编译通过 / slot 不 remount（createResource 不重取）

**绿**：

1. 删除 `chat-feature.ts`（全仓唯一 import 者：`home.tsx` + `mode-surfaces.tsx`，同步清理）
2. `mode-surfaces.tsx`：删 `CHAT_FEATURES` / `ChatFeatureSidebar` / `ChatFeaturePanel` export
3. `secondary-sidebar.tsx`：Chat 分支去 FeatureSidebar，只留 LocationSelector + ChatSessionList
4. `home.tsx`：删 `ChatFeaturePanel` 渲染（L492-494 Show 分支）；`<Dynamic component={modeSurface(mode).Sidebar}>`（L461）改为 render-all + `display:none`（方案 1，侧栏仅 2 个模式 slot）
5. `app.tsx`：确认 ModeRoute 路径无 `<Dynamic>` 残留

### Step 4: Insert 流程

**位置**：`packages/app/src/components/chat/asset-session-selector.tsx`（新增）

**红**：[Insert] → Popover → 选会话 → 跳转 → 注入

**绿**：SessionSelectorPopover + `recentSessions`（server-sync）+ `insertAsset()` + 目标页 `?insert=` 参数检测注入 Composer

### Step 5: 路由状态保持

**位置**：`packages/app/src/context/chat-workspace.tsx`（**新增**，当前不存在源文件）+ 挂载点提到 Router 外

**红**：跨路由右栏状态保持（`/mode/chat` ↔ `/server/:key/session/:id`）/ Dirty Draft 确认 Modal

**绿**：

- 新建 `ChatWorkspaceContext`（`selectedAsset` / `rightPanelOpen` / `dirtyState`）
- Provider 挂 Router 之外（`app.tsx` ModeRoute 所在 router 层之上）
- Dirty Draft 机制：`createEffect` 监听 `dirtyState` → 检测到路由变更前弹 `<Dialog>` / `<Modal>` → 用户确认→调用 `setDirty(false)` →允许导航；取消→保留当前路由
- 注：`@solidjs/router` 无 `beforeRouteLeave` 守卫，全仓无先例；以上机制基于 `createEffect` + 路由参数比较实现

### Step 6: 全链路集成测试

**红**：表格→选行→右栏展开→Insert→跳转→注入

---

## 4. 测试矩阵

| 层        | 测试点                                     | 工具                      | 位置                            |
| --------- | ------------------------------------------ | ------------------------- | ------------------------------- |
| Component | AssetWorkbench / ChatRightPanel / Popover  | `bun:test` + happydom     | `src/components/chat/*.test.ts` |
| 行为      | Insert URL、路由状态、Dirty Draft          | `bun:test` + context mock | `src/*.test.ts`                 |
| 集成      | 功能树删除编译通过、ADR-15 slot 不 remount | typecheck + resource spy  | —                               |
| E2E       | 全链路                                     | playwright                | `e2e/`                          |
| Core      | listInvalid 存储+返回+脱敏                 | `bun:test` + tmpdir       | `core/test/`                    |
| API       | HTTP list 携带 invalid                     | `bun:test`                | `aigcfroge/test/server/`        |

---

## 5. 改动文件清单

| 文件                                                             | 操作                                                                          |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `packages/schema/src/prompt-asset.ts`                            | 修改（增 InvalidEntry schema）                                                |
| `packages/core/src/prompt-asset.ts`                              | 修改（增 listInvalid/getInvalid + loadDir 存储坏文件）                        |
| `packages/core/test/prompt-asset-registry.test.ts`               | 修改（增 listInvalid 测试）                                                   |
| `packages/aigcfroge/src/server/httpapi/groups/prompt-asset.ts`   | 修改（list 响应增 invalid 字段）                                              |
| `packages/aigcfroge/src/server/httpapi/handlers/prompt-asset.ts` | 修改（list handler 注入 invalid 数据）                                        |
| `packages/aigcfroge/test/server/httpapi-prompt-asset.test.ts`    | 修改（增 list invalid 测试）                                                  |
| `packages/app/src/components/chat/asset-workbench.tsx`           | **新增**（4 列资产表格）                                                      |
| `packages/app/src/components/chat/asset-workbench.test.ts`       | **新增**（表格组件测试）                                                      |
| `packages/app/src/components/chat/chat-right-panel.tsx`          | **重写**（简化为 Detail Inspector）                                           |
| `packages/app/src/components/chat/asset-session-selector.tsx`    | **新增**（Insert 会话选择浮窗）                                               |
| `packages/app/src/context/chat-workspace.tsx`                    | **新增**（路由状态保持 Provider）                                             |
| `packages/app/src/context/chat-feature.ts`                       | **删除**（功能树 context 源）                                                 |
| `packages/app/src/components/secondary-sidebar.tsx`              | **修改**（删 FeatureSidebar 渲染）                                            |
| `packages/app/src/components/mode-surfaces.tsx`                  | **修改**（删 CHAT_FEATURES）                                                  |
| `packages/app/src/pages/home.tsx`                                | **修改**（删 ChatFeaturePanel + `<Dynamic>` slot 改 render-all+display:none） |
| `packages/app/src/app.tsx`                                       | **验证**（确认 ModeRoute slot 路径无残留）                                    |

---

## 6. 验收标准

- [ ] `/mode/chat` 主区 4 列表格，空/载/错态完整
- [ ] Kind Dropdown + 搜索过滤正确
- [ ] 行点击展开右栏 Inspector，无选中空态
- [ ] 右栏 FileTree 已移除
- [ ] 次级侧栏无功能树（chat-feature.ts 已删，编译通过）
- [ ] [Insert] → Popover → 跳转 → 注入
- [ ] 路由切换右栏状态不丢失（Provider 挂 Router 外）
- [ ] Dirty Draft 确认 Modal（createEffect 监听 dirtyState）
- [ ] 🔴 坏文件标记（数据来自 listInvalid）
- [ ] ADR-15 合规：home.tsx:461 `<Dynamic>` → render-all + display:none
- [ ] `bun --cwd packages/app typecheck` 通过
- [ ] `bun --cwd packages/app test --timeout 30000` 通过
- [ ] `bun --cwd packages/core test --timeout 30000` 通过
- [ ] `bun --cwd packages/aigcfroge test --timeout 30000` 通过
- [ ] `bun run lint` 通过
- [ ] DESIGN.md 合规（v2 token / 键盘 focus / 明暗主题）
