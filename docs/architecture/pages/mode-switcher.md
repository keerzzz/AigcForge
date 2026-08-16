# Mode Switcher

> 状态：IMPLEMENTED — Product Mode 分类、入口路由与共享导航骨架已完成；专属 Mode surface 仍按各自 PRD 推进
> 代码位置：packages/app/src/context/mode.tsx, packages/app/src/components/mode-switcher.tsx, packages/app/src/components/mode-surfaces.tsx
> 决策：[`ADR-11-product-mode-session-classification.md`](../adr/ADR-11-product-mode-session-classification.md)、[`ADR-12-product-mode-entry-routing.md`](../adr/ADR-12-product-mode-entry-routing.md)
> 实施计划：[`mode-module-switching-completion.md`](../../plan/mode-module-switching-completion.md)
> Proposed extension: [`ADR-17`](../adr/ADR-17-custom-mode-composition-platform.md) proposes a fixed Custom entry; until accepted, this page documents the implemented four-mode switcher.

---

## 架构概述

四模式切换器，位于 Layout 左侧 64px 轨道：

- **Coding** (默认): 代码编辑 Session 分类
- **Chat**: 对话 Session 分类
- **Work**: 非编程产出 Session 分类
- **Assistant**: 自定义助手 Session 分类

四个 Mode 在切换、Draft 创建、Session 持久化和列表过滤层面统一可用；专属 Agent、工具组合和 Viewport 仍由各 Mode 的后续方案实现。

三栏布局：`ModeSwitcher(64px) | SecondarySidebar(256px) | Main(flex-1)`

ModeSwitcher 底部同时拥有全局帮助和设置入口。Home 不再维护另一套响应式工具导航。

## 核心接口 (mode.tsx)

```ts
type ModeContext = {
  currentMode: ProductMode
  setCurrentMode: (mode: ProductMode) => void
  secondarySidebarOpen: boolean
  toggleSecondarySidebar: () => void
}
```

`activeSessionId` 不属于 ModeContext。路由、Tabs 和 Session placement 已经拥有 Session 身份；ModeContext 只保存最近有效 Mode，并跟随当前权威 route/work item 单向更新。

## 数据流

### 模块入口导航

ModeSwitcher 图标和首页模式卡片行为统一：

```
用户点击 ModeSwitcher 图标 或 首页模式卡片:
  → navigate(modeHref(m))
  → /mode/:mode
  → ModeRoute decode + activate currentMode
  → ModeWorkspace 的 mode-aware selector 重算
  → 不创建/恢复 Draft 或 Session，不选择 Tab，不改变 Agent
```

Session/Draft 路由仍是工作项 canonical URL；在这些路由上，`currentMode` 分别跟随 `Session.mode` 或 `DraftTab.mode`。

### Session 归属

Session Product Mode 是服务端持久化事实：

```
newDraft → DraftTab.mode 冻结
首次提交 → session.create({ mode: draft.mode })
子 Session → 继承 parent.mode
Fork → 继承 source.mode
```

### 持久化

- `Persist.global("mode-view")`：只存 `currentMode`；旧 `activeSessionId` 在 migrate 中删除
- `Persist.global("mode.secondarySidebarOpen")`：次级侧边栏开关状态
- `Persist.global("tabs")`：DraftTab 持久化创建时的 Product Mode
- Session/Draft URL 不编码 Mode（ADR-09）；模块入口 URL 使用 `/mode/:mode`（ADR-12）

## 入口文件

- `MODE_DEFINITIONS` / `modeHref(m)` — Home 卡片、ModeSwitcher、ModeRoute 与 Mode surface 的单一导航/展示契约（id、href、icon、i18n keys、surface slot）
- `setCurrentMode(m)` — [mode.tsx](../../../packages/app/src/context/mode.tsx) 只接受 route/work item authority 的单向激活
- `HomeModeCards` — [home.tsx](../../../packages/app/src/pages/home.tsx) 复用 Mode registry 并导航到 `/mode/:mode`
- `ModeSwitcher` — [mode-switcher.tsx](../../../packages/app/src/components/mode-switcher.tsx) 全局 Icon 导航入口
- `ModeSwitcher` utilities — 帮助打开反馈页；设置打开共享 `DialogSettings`
- `ModeRoute` / `ModeWorkspace` — `/mode/:mode` 的参数化入口和共享工作区
- `DraftTab.mode` — [tabs.tsx](../../../packages/app/src/context/tabs.tsx) Session 创建归属来源

## 实现前置条件

- Layout 中预留 ModeSwitcher 插槽 ✅
- 各 Mode 共享同一套 session/project 基础设施 ✅
- Session Product Mode Schema/API/SDK：IMPLEMENTED
- `/mode/:mode` ModeRoute + shared ModeWorkspace：IMPLEMENTED
- Mode-aware ServerSync/Home/Sidebar：IMPLEMENTED
- 各 Mode 专属 Agent/Viewport：PLANNED
