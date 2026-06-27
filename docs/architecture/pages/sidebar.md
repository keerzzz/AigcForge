# Sidebar 架构

> 状态：草案 v3.0，组件级架构文档
> 代码基线：packages/app/src/pages/layout/sidebar-shell.tsx
> Rail 宽度：64px
> 当前挂载状态：组件存在，但 pages/layout.tsx 未挂载全局 Sidebar

---

## 1. 定位与职责

SidebarContent 是可展开/折叠的侧边面板组件。左侧 64px Rail 承载项目列表（可拖拽排序），右侧 Panel 承载动态内容。通过 inert 属性管理非活跃状态的可访问性。

当前 `pages/layout.tsx` 未挂载该组件；现有应用壳层是 Titlebar + main route content + DebugBar/HelpButton/ToastRegion。本文档只能作为组件契约，不能作为当前全局布局拓扑依据。

---

## 2. 上游入口链路

```
未来宿主 / 调用方
  -> SidebarContent (sidebar-shell.tsx)
    -> props.renderPanel() — 调用方注入面板内容
    -> props.renderProject() — 调用方注入项目渲染
```

---

## 3. 组件树

```
SidebarContent
├── Rail (w-16, bg-background-base)
│   ├── ProjectList (overflow-y-auto, no-scrollbar)
│   │   ├── DragDropProvider
│   │   │   ├── DragDropSensors
│   │   │   ├── ConstrainDragXAxis
│   │   │   ├── SortableProvider
│   │   │   │   └── For(projects) -> renderProject()
│   │   │   └── DragOverlay
│   │   │       └── renderProjectOverlay()
│   │   └── AddProjectButton (IconButton: plus + Tooltip)
│   │
│   ├── Spacer
│   └── BottomButtons
│       ├── SettingsButton (IconButton: settings-gear + TooltipKeybind)
│       └── HelpButton (IconButton: help + Tooltip)
│
└── Panel (flex-1)
    ├── 展开: pointer-events-auto, aria-hidden=false
    └── 折叠: pointer-events-none, aria-hidden=true, inert
        └── renderPanel()
```

---

## 4. Context 依赖图

| 层级 | Context | 用途 |
|------|---------|------|
| 全局 | useLayout | projects Accessor, opened Accessor |
| 全局 | useCommand | 键盘快捷键绑定 |
| 全局 | useLanguage | i18n (settings/help label) |
| Props | renderPanel | 面板内容注入 |
| Props | renderProject | 项目卡片渲染注入 |

---

## 5. 数据流架构

### 5.1 展开/折叠

```
props.opened() -> expanded createMemo
  -> 展开: panel.removeAttribute("inert"), pointer-events-auto
  -> 折叠: panel.setAttribute("inert"), pointer-events-none
  -> aria-hidden 同步折叠状态
```

### 5.2 拖拽排序

```
用户拖拽项目
  -> DragDropProvider.onDragStart -> props.handleDragStart
  -> SortableProvider 重排
  -> DragDropProvider.onDragEnd -> props.handleDragEnd
  -> closestCenter 碰撞检测
  -> ConstrainDragXAxis 限制 X 轴
```

### 5.3 项目操作

```
添加: AddProjectButton.onClick -> props.onOpenProject
设置: SettingsButton.onClick -> props.onOpenSettings
帮助: HelpButton.onClick -> props.onOpenHelp
```

---

## 6. 可访问性

| 状态 | inert | aria-hidden | pointer-events |
|------|-------|-------------|----------------|
| 展开 | 移除 | false | auto |
| 折叠 | 设置 | true | none |

inert 兼容 React/Solid，确保屏幕阅读器和键盘导航完全跳过面板。

---

## 7. 错误边界

| 场景 | 处理 |
|------|------|
| projects 为空 | 仅显示 AddProjectButton |
| 拖拽中断 | DragOverlay 自动清理 |
| renderProject 未提供 | 无内容渲染 |
| mobile 模式 | placement 切换为 "bottom" |

---

## 8. 上下游文件索引

| 层级 | 文件 |
|------|------|
| 当前宿主布局 | pages/layout.tsx (未挂载 SidebarContent) |
| Rail 实现 | pages/layout/sidebar-shell.tsx |
| 面板内容 | 调用方通过 renderPanel 注入 |
| 工作空间树 | 调用方通过 renderProject 注入 |
| 拖拽约束 | utils/solid-dnd.ts |
| 项目类型 | context/layout.tsx (LocalProject) |
