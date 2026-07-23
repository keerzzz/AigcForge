# Chat 右栏 B区 FileTree 重构 + 对话列表 + 编辑确认实施方案

> 状态：Draft（待实施）
> 关联：ADR-15（ModeWorkspace typed slot）、`chat-asset-workspace-implementation.md` A1 第2点（B区方案变更）
> 日期：2026-07-20

## 1. 背景

chat 模式右栏 A/B 区已对齐 code 架构（tab store `layout.tabs` / SortableTab 参数化 / DragDrop / resize `layout.fileTree` / inert 显隐 `reviewPanel.opened` / `createFileTabListSync`，见前序提交 e55d5deb9 / f3f375c2d）。

本方案进一步对齐（基于 Claude Code + Codex + aigcfroge 全局文件格式调查）：

- **B区**：从 promptAsset 资产列表（按 kind 分组）改为 **`FileTree path=".aigcfroge"`**（文件树，统一 .aigcfroge 总文件夹：agent/command/skill/prompt/glossary/plugin + 配置/代码）
- **A区**：从 promptAsset 资产 tab 改为 **file:// 文件 tab**（FileTabContent，可编辑 + 二级弹窗确认）
- **对话列表**：chat 次级左侧边栏功能树下方加对话列表（mode="chat" 过滤）

### A1 第2点变更

`chat-asset-workspace-implementation.md` L31「B区资产树分组+计数（by kind: prompt/command/skill/agent/mcp）」**变更为**「FileTree 文件树（`.aigcfroge` 总文件夹）」。理由：用户决策"跟文件树一样格式，统一总文件夹 + 子文件夹 + 多格式文件"，对齐 code FileTree，零手写（复用 FileTree 组件）。

## 2. 方案总览

| 区域 | 改前 | 改后 |
|------|------|------|
| 次级左侧边栏（chat） | ChatFeatureSidebar（功能树，无对话列表） | ChatFeatureSidebar（上）+ 对话列表（下，mode="chat" 过滤） |
| 右栏 A区 | promptAsset 资产 tab（relativePath）+ preview + context | file:// 文件 tab（ChatFileTabContent）+ preview + context |
| 右栏 B区 | promptAsset 资产列表 + 搜索框 | FileTree path=".aigcfroge" + 搜索框（搜文件名过滤） |
| 编辑 | promptAsset API apply（CAS） | file:// tab 编辑 + 弹窗确认 + 文件直写 + refetch |

## 3. 决策点（已验证 ✅）

| # | 决策 | 验证 |
|---|------|------|
| 1 | file context 加载 .aigcfroge | ✅ `file.list`（[file.ts handler](packages/aigcfroge/src/server/routes/instance/httpapi/handlers/file.ts#L66)）不排除 .aigcfroge，项目根 .gitignore 不排除 |
| 2 | FileTabContent 复用 | ✅ file:// tab + file context（[file-tabs.tsx:174](packages/app/src/pages/session/file-tabs.tsx#L174)） |
| 3 | promptAsset .md file:// tab 只读（编辑后续） | ✅ FileTabContent 只读 viewer；编辑能力（弹窗确认 + refetch）后续补充 |
| 4 | 搜索框搜文件名过滤 FileTree | ✅ |
| 5 | 对话列表复用 SessionItem | ✅（[sidebar-items.tsx](packages/app/src/pages/layout/sidebar-items.tsx)）+ mode="chat" 过滤 |
| 6 | 次级左侧边栏布局分割 | ChatFeatureSidebar `flex-1` -> `shrink-0` + 对话列表 `flex-1` 滚动 |
| 7 | 新建入口 | ChatFeatureSidebar 已有（[mode-surfaces.tsx:168](packages/app/src/components/mode-surfaces.tsx#L168)） |
| 8 | workflow | 保留导航（无数据），FileTree 无 workflow 节点（自然不显示） |
| 9 | chatFeature vs FileTree | 独立（chatFeature 管 Home ChatFeaturePanel，session B区 独立） |
| 10 | apply 后 FileTree 刷新 | `file.tree.refresh`（[file.tsx:264](packages/app/src/context/file.tsx#L264)）+ watcher |
| 11 | FileTree path 根 | `sdk().directory`（项目根 = ChatFeatureSidebar directory） |
| 12 | mcp 配置 | `.aigcfroge/aigcfroge.jsonc` 文件 tab（FileTabContent 文本编辑 JSON） |
| 13 | token | FileTree legacy（bg-surface-raised-base 等），chat 复用 = legacy（与 code 一致，后续统一 v2 单独做） |
| 14 | 窄屏 | 次级左侧边栏 `w-64` 固定 + `secondarySidebarOpen` toggle（code/chat 共用） |
| 15 | 测试 | typecheck（tsgo -b）+ lint（oxlint）+ test（bun test）+ 手动 |

### 3.1 弹窗确认细化（#3）

- **范围**：所有 `.aigcfroge/` 文件编辑
- **内容**：文件名 + diff 预览（复用 `computeDiff` / diffLines）+ 保存/取消
- **aigcfroge.jsonc**：额外提示"需重启生效"
- **保存后**：`file.tree.refresh` + 若 path 在 `.aigcfroge/prompts/`，`promptAsset.list` refetch（revision 一致，避免 AI propose StaleRevision）

### 3.2 数据形态（.aigcfroge 总文件夹）

```
.aigcfroge/
├── agent/      *.md（mode/hidden/model/color/tools frontmatter）
├── command/    *.md（description/model/subtask frontmatter）
├── skills/     <name>/（目录）
├── prompts/    *.md（promptAsset，PROMPTS_DIR = ".aigcfroge/prompts"）
├── glossary/   *.md（多语言术语）
├── plugins/    .json/.tsx（代码）
├── references/ themes/ tool/
├── aigcfroge.jsonc  tui.json  env.d.ts（配置/代码）
```

## 4. 分步实施

### Step 1: B区 FileTree + A区 file:// tab（只读）✅ 已完成（2026-07-20）

**改动**（chat-right-panel.tsx）：
- imports：加 FileTree/FileTabContent/useFile；删 FileIcon/useNavigate/PromptAssetSummary
- state：删 editingPath/editedTemplates/deletingPath/deleting/navigate；加 file=useFile()/openFileTab；openedAssetTabs->openedFileTabs（filter file://）
- handlers：删 openAsset/handleDelete/startEdit/cancelEdit/handleEditApply/assets/filteredAssets/assetContent；保留 result/refetch + 候选 preview 逻辑（candidate/handleApply/handleApplyOverwrite/oldTemplate/diffLinesMemo）
- A区 List：SortableTab 不传 visual（默认 file.pathFromTab+FileVisual）+ openedFileTabs
- A区 Content：For 资产 -> `<Show when={file://}><FileTabContent tab={tab} /></Show>`（只读 viewer）
- DragOverlay：FileVisual path={file.pathFromTab(tab) ?? ""}
- B区：资产列表 + 新建按钮 -> `<FileTree path=".aigcfroge" onFileClick={openFileTab} />` + 搜索框（搜文件名，TODO 过滤）

**验证**：typecheck（tsgo -b 过）+ lint（0 warn 0 err）+ test（433 pass 0 fail）

**剩余 TODO**（Step 4 处理）：
- 搜索框过滤 FileTree（当前 onInput setQuery no-op）
- FileTree `active` 高亮（当前激活 file:// tab）
- promptAsset apply 后 `file.tree.refresh`（.aigcfroge/prompts/）

### Step 2: A区 file:// 文件 tab（只读）✅ Step 1 已完成 + 编辑能力（后续补充）

**已完成（Step 1 含，只读）**：
- A区 tab：file:// 文件 tab（SortableTab 默认 file visual）+ preview + context
- `<FileTabContent tab={tab} />`（只读 viewer，File 组件 mode="text"）
- 点击 .aigcfroge 文件 -> openFileTab -> file:// tab -> FileTabContent 只读查看

**调查结论（2026-07-20）**：
- FileTabContent = File 组件（[session-ui/src/components/file.tsx](packages/session-ui/src/components/file.tsx)，1195 行）
- 基于 `@pierre/diffs` + virtualizer，**无 CodeMirror/editable/onSave**
- aigcfroge 定位 AI agent（AI tools 编辑文件），用户手动编辑非核心场景
- 决策：**先只读**，编辑能力后续补充

**后续补充（编辑能力，单独 Step）**：
- 新增可编辑组件（CodeMirror/textarea editor + save）或改 File 组件加 editable 模式
- 编辑弹窗确认（文件名 + diff 预览 + 保存/取消，复用 `computeDiff`）+ aigcfroge.jsonc "需重启生效"提示
- 保存后 `file.tree.refresh` + 若 path 在 `.aigcfroge/prompts/`，`promptAsset.list` refetch（revision 一致）
- 验证：点击文件打开 tab + 编辑保存弹窗 + diff 预览

### Step 3: 对话列表（次级左侧边栏）✅ 已完成（2026-07-20）

**改动**：
- 新建 `packages/app/src/components/chat/chat-session-list.tsx`（SessionItem + `serverSync().child(dir).session.filter(mode==="chat")`，复用 code SessionItem）
- `secondary-sidebar.tsx` 非 coding 分支：Dynamic Sidebar + `<ChatSessionList>`（chat 模式 + currentDir）
- `mode-surfaces.tsx`：ChatFeatureSidebar 去 `flex-1`（让 ChatSessionList `flex-1` 占剩余）

**验证**：typecheck（tsgo -b 过）+ lint（0 err，6 pre-existing warn 非本次引入）+ test（433 pass）

**剩余 TODO**：
- sessions 加载确认（`sync().child(dir, { bootstrap: false })`，运行时需确认 sessions 显示）
- ChatFeatureSidebar 去 flex-1 后自然高（内容多时可能溢出，需 overflow-y-auto?）
- ChatSessionList sessionProps 简化（prefetchSession/clearHoverProjectSoon no-op，无 hover 预取/清除）

### Step 4: 清理 + 完善 ✅ 部分完成（2026-07-20）

**已完成**：
- FileTree `active` 高亮（当前激活 file:// tab -> `activeFilePath` memo -> FileTree `active` prop，对齐 code）
- promptAsset apply 后 `void file.tree.refresh(".aigcfroge/prompts")`（handleApply + handleApplyOverwrite，刷新 FileTree + 避免 floating promise）
- Step 1 已删 promptAsset 资产列表残留（filteredAssets/openAsset/handleDelete/startEdit/cancelEdit/handleEditApply/assetContent 等）

**验证**：typecheck（tsgo -b 过）+ lint（0 warn 0 err）+ test（433 pass 0 fail）

**剩余 TODO**（后续补充）：
- ✅ 搜索框过滤 FileTree（query -> 递归 `walk .aigcfroge/` 匹配文件名 -> `allowed` 集合；版本控制防旧 walk 覆盖；`file.tree.list` 等加载 + `children` 读）
- ✅ ChatFeatureSidebar 加 `shrink-0`（防 ChatSessionList 被挤，对话列表 flex-1 收缩 + 滚动）
- ✅ token 统一（FileTree legacy -> v2：`bg-surface-raised-base` -> `bg-v2-background-bg-layer-02`、`hover` -> `bg-v2-overlay-simple-overlay-hover`、`active` -> `bg-v2-overlay-simple-overlay-pressed`、`text-strong/weak/weaker` -> `text-v2-text-text-base/muted/faint`、`border-base` -> `border-v2-border-border-base`；影响 code FileTree 视觉，需手动验证）
- 窄屏（次级左侧边栏 `w-64` + `secondarySidebarOpen` toggle 已对齐 code）

## 5. 验证点

- B区 FileTree 显示 .aigcfroge 文件树（agent/command/skill/prompt/glossary/plugin + 配置）
- A区 file:// tab 打开文件 + 编辑 + 弹窗确认（diff 预览）+ 保存 + refetch
- 对话列表 mode="chat" 过滤（只显示 chat 会话，code 会话不混入）
- 弹窗 diff 预览 + aigcfroge.jsonc 重启提示
- promptAsset apply 后 FileTree 刷新
- 搜索框搜文件名过滤 FileTree

## 6. 风险与待确认

- **FileTabContent save 拦截机制**：FileTabContent = File 组件（只读 viewer，无 save）。编辑能力后续补充（新增可编辑组件或改 File 加 editable）
- **搜索框过滤 FileTree**：FileTree 无内联搜索。用 `allowed` prop（code diffFiles 模式）或自建过滤树
- **候选 apply vs file:// tab**：file:// tab 只读，无编辑冲突。apply 后 file:// tab 需刷新（file.tree.refresh + FileTabContent 重载）
- **.aigcfroge/ 不存在**（新项目）：FileTree 空状态。提示？或自动创建？
- **FileTabContent context 依赖**：`useComments`/`useFileComponent`/`usePrompt` 需确认 chat session 可用（全局 Provider）
- **A区 tab 类型混合**：preview/context + file://。SortableTab visual 区分（file:// -> FileVisual）。是否复用 `createSessionTabs`（preview 像 review）待评估

## 7. 改动文件

- `packages/app/src/components/chat/chat-right-panel.tsx`（B区 FileTree + A区 file:// tab + 搜索框）
- `packages/app/src/components/secondary-sidebar.tsx`（chat 分支加对话列表）
- `packages/app/src/components/mode-surfaces.tsx`（ChatFeatureSidebar 布局分割）
- 新建 `packages/app/src/components/chat/chat-file-tab-content.tsx`（FileTabContent + 弹窗 + refetch）
- 新建 `packages/app/src/components/chat/chat-session-list.tsx`（对话列表）
- 可能新建 `packages/app/src/components/chat/chat-save-dialog.tsx`（编辑确认弹窗 + diff 预览）
