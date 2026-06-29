# Sidebar 架构

> 状态：IMPLEMENTED (v2)
> 上次更新：2026-06-29
> 代码位置：packages/app/src/components/secondary-sidebar.tsx

---

## 1. 定位与职责

当前布局使用两套侧边栏：

### 次级侧边栏 (SecondarySidebar)

位于 ModeSwitcher 与 Main 之间，宽度 256px，展示项目树 + 会话搜索：

```
+---------+------------------+---------------------------+
| Mode:64 | Secondary:256px   | Main: flex-1              |
|         |                   |                           |
| ● Chat  | [新会话] [🔍]    | Home / Session /          |
| ○ Coding| 项目列表          | NewSession                 |
| ○ Work  | ├── 📁 Project   |                           |
| ○ Assist| │  ├─ Session A   |                           |
|         | │  ├─ Session B   |                           |
|         | │  └─ Load more   |                           |
|   ◧     |  [+ 添加项目]     |                           |
+---------+-------------------+---------------------------+
```

隐藏条件：路由为 `/` 或 `/new-session` 时自动隐藏（可通过 toggle 手动显示）。

### V1 Sidebar (sidebar-shell.tsx)

保留但未挂载。历史代码参考位于 `packages/app/src/pages/layout/sidebar-shell.tsx`。

---

## 2. 组件树

```
SecondarySidebar
├── Header
│   ├── ButtonV2 "New Session"
│   └── IconButtonV2 (magnifying-glass) — 搜索开关
│
├── SearchPanel (条件显示)
│   ├── Input (magnifying-glass 前缀)
│   ├── Clear button (xmark-small)
│   └── ResultsList (项目筛选结果)
│
├── SectionTitle "项目列表" + "添加项目" button
│
└── ProjectList (scrollable, flex-1)
    └── For each Project:
        ├── ProjectHeader (name + unseen dot + hover actions + menu)
        └── Show when workspaces enabled:
            ├── DragDropProvider > SortableProvider
            │   ├── SortableWorkspace(worktree)
            │   └── For sandboxes: SortableWorkspace(sandbox-*, navigateToNewSession)
            └── Show when workspaces disabled:
                └── LocalWorkspace (flat session list)
```

## 3. Context 依赖

| Context | 用途 |
|---------|------|
| useServer | 获取当前服务器连接 |
| useGlobal | 获取 project 列表 (projects.list) |
| useServerSync | session store 订阅 |
| useTabs | 新建 draft session (newDraft) |
| useNotification | unseen 计数 + 清除 |
| useDialog | workspace 删除/重置对话框 |
| useLayout | sidebar.workspaces 开关, sidebar.setWorkspaceExpanded |
| useLanguage | i18n |
| useMode | 当前模式（为未来支持 mode 侧边栏预留） |
| WorkspaceSidebarContext | 桥接到 SortableWorkspace/LocalWorkspace |

## 4. WorkspaceSidebarContext 桥接

`secondary-sidebar.tsx` 构建 WorkspaceSidebarContext 供给 `SortableWorkspace` / `LocalWorkspace` 使用：

| 方法 | 实现 |
|------|------|
| currentDir | 从 URL params 读取 |
| navList | 所有 project 的 sortedRootSessions 平铺 |
| sidebarExpanded | 始终 true |
| sidebarHovering | 始终 true |
| prefetchSession | no-op |
| archiveSession | no-op |
| workspaceName | Persist.global 存储的自定义名或 branch/目录名 |
| renameWorkspace | 更新 persisted workspaceNameStore |
| isBusy | workspace 删除/重置期间灰显 |
| workspaceExpanded | 每个 directory 独立 persisted toggle |
| showResetWorkspaceDialog | DialogResetWorkspace（从旧 V1 移植） |
| showDeleteWorkspaceDialog | DialogDeleteWorkspace（从旧 V1 移植） |

## 5. Workspace 生命周期

| 操作 | 函数 | 实现 |
|------|------|------|
| 创建 | createWorkspace | worktree.create → bootstrap → newDraft |
| 重命名 | renameWorkspace | 更新 workspaceNameStore |
| 展开/折叠 | workspaceExpanded/setWorkspaceExpanded | Persisted Record<string, boolean> |
| 删除 | deleteWorkspace | worktree.remove → sync 移除 sandbox → close project |
| 重置 | resetWorkspace | vcs status → dispose instance → worktree.reset → 归档 sessions |

## 6. 搜索面板

- 输入：过滤 projects 列表（按 displayName）
- 结果：每条显示项目名，点击 → newDraft({ server, directory })
- 空结果：i18n "未找到结果"
- 键盘：Escape 关闭

## 7. 错误边界

| 场景 | 处理 |
|------|------|
| server 未连接 | conn() 为空 → 不渲染项目列表 |
| project 无 vcs | workspaceEnabled 为 false（workspaces 只对 git 项目可用） |
| workspace 删除失败 | Toast 提示错误 |
| workspace 重置失败 | Toast 提示错误 |

## 8. 上下游文件索引

| 文件 | 用途 |
|------|------|
| [secondary-sidebar.tsx](../../packages/app/src/components/secondary-sidebar.tsx) | 组件本体 + WorkspaceSidebarContext 桥接 |
| [sidebar-workspace.tsx](../../packages/app/src/pages/layout/sidebar-workspace.tsx) | SortableWorkspace/LocalWorkspace/WorkspaceSessionList |
| [sidebar-items.tsx](../../packages/app/src/pages/layout/sidebar-items.tsx) | SessionItem/NewSessionItem/SessionSkeleton |
| [inline-editor.tsx](../../packages/app/src/pages/layout/inline-editor.tsx) | 内联编辑 controller |
| [helpers.ts](../../packages/app/src/pages/layout/helpers.ts) | displayName/sortedRootSessions/homeProjectDirectories |
| [layout.tsx](../../packages/app/src/pages/layout.tsx) | 三栏布局宿主 |
| [mode.tsx](../../packages/app/src/context/mode.tsx) | ModeProvider（次级侧边栏父级） |
