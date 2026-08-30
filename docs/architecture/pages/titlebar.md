# Titlebar 架构

> 状态：草案 v3.0，企业级架构文档
> 代码基线：packages/app/src/components/titlebar.tsx
> 高度：36px V2

---

## 1. 定位与职责

Titlebar 是应用顶层导航栏，固定横跨全宽。承载 Session Tab 条、窗口控制、导航历史和设置入口。适配 Electron + Tauri 双桌面壳层。

---

## 2. 上游入口链路

```
AppInterface (app.tsx)
  -> AppLayout -> Layout (pages/layout.tsx)
    -> Titlebar 始终挂载，不随路由切换卸载
```

---

## 3. 组件树

```
Titlebar (36px)
├── 左侧区
│   ├── SidebarToggleButton    — IconButton: 侧边栏切换
│   ├── NavBackButton          — 路由后退
│   └── NavForwardButton       — 路由前进
│
├── 中央区 (flex-1, overflow-x-auto)
│   ├── SessionTabScroller     — 可滚动 Tab 容器
│   │   └── SessionTab[]       — 每个 Tab
│   │       ├── SessionTabAvatar  — 项目图标 + 名称
│   │       ├── TabLabel        — Session 标题
│   │       ├── UnseenBadge     — 未读标记
│   │       └── CloseButton     — 关闭按钮
│   └── NoTabsPlaceholder       — 无 Tab 时显示
│
├── 中间区 (macOS)
│   └── TrafficLightSpacer      — macOS 原生按钮占位
│
└── 右侧区
    ├── UpdateBadge             — 版本更新通知
    ├── WindowsAppMenu          — Windows 应用菜单 (hamburger)
    ├── WinControls             — Windows: 最小化/最大化/关闭
    ├── HelpButton              — 帮助
    └── SettingsButton          — 设置 (齿轮)
```

---

## 4. Context 依赖图

| 层级 | Context              | 用途                                   |
| ---- | -------------------- | -------------------------------------- |
| 全局 | useLayout            | 侧边栏状态、项目列表                   |
| 全局 | usePlatform          | OS/桌面/Web 检测、缩放、Tauri API      |
| 全局 | useCommand           | 键盘快捷键 (sidebar.toggle, nav)       |
| 全局 | useSettings          | mobileTitlebarPosition, showNavigation |
| 全局 | useTabs              | Session Tab 生命周期、tabHref          |
| 全局 | useLocation          | 当前路由路径                           |
| 全局 | useNavigate          | 路由导航                               |
| 局部 | createMediaQuery     | mobile 检测 (max-width: 767px)         |
| 局部 | createResizeObserver | 标题栏宽度测量                         |
| 局部 | makeEventListener    | Tauri drag region 事件                 |

---

## 5. 桌面壳层适配

```
运行时检测:
  window.__TAURI__  -> Tauri  (startDragging, toggleMaximize)
  window.api        -> Electron (contextBridge IPC)
  macOS             -> 原生 traffic light 按钮 + setTitlebar theme
  Windows           -> 应用内 WindowsAppMenu + 自定义窗口控制
  Linux             -> 标准窗口控制
```

```ts
type TauriDesktopWindow = { startDragging?: () => Promise<void>; toggleMaximize?: () => Promise<void> }
type TauriApi = { window?: { getCurrentWindow?: () => TauriDesktopWindow }; webviewWindow?: {...} }
const tauriApi = () => (window as unknown as { __TAURI__?: TauriApi }).__TAURI__
```

---

## 6. Session Tab 条数据流

```
useLayout().tabs(route.sessionKey)
  -> For 遍历渲染 SessionTab
  -> tabHref(tab): 生成 /server/:key/session/:id 链接
  -> 关闭事件:
    -> 单个: tab.onClose() -> tabs.removeTab()
    -> 批量: SESSION_TABS_REMOVED_EVENT CustomEvent
  -> 拖拽排序: 默认禁用手势拖拽
```

---

## 7. 缩放适配

```
zoom = platform.webviewZoom?.() ?? 1
titlebarZoom = windows ? Math.max(zoom, 0.25) : zoom
height = mac ? 36px/zoom : 36px/Math.min(titlebarZoom, 1)
windowsControlsWidth = 138px / Math.max(titlebarZoom, 1)
counterZoom = windows && titlebarZoom < 1 ? 1/titlebarZoom : 1
```

---

## 8. 错误边界

| 场景             | 处理                                           |
| ---------------- | ---------------------------------------------- |
| Tauri API 不可用 | tauriApi() 返回 undefined，fallback 到通用实现 |
| 导航历史为空     | backPath/forwardPath 按钮禁用                  |
| Tabs 为空        | NoTabsPlaceholder 组件渲染                     |
| 缩放异常         | minTitlebarZoom = 0.25 下限保护                |

---

## 9. 上下游文件索引

| 层级             | 文件                                  |
| ---------------- | ------------------------------------- |
| 宿主布局         | pages/layout.tsx                      |
| Titlebar 组件    | components/titlebar.tsx               |
| Tab 管理         | context/tabs.tsx                      |
| 导航历史         | components/titlebar-history.ts        |
| Session Tab 头像 | pages/layout/session-tab-avatar.tsx   |
| Tab 事件         | components/titlebar-session-events.ts |
| Windows 菜单     | components/windows-app-menu.tsx       |
| 桌面平台         | context/platform.tsx                  |
