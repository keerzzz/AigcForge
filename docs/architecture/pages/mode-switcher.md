# Mode Switcher

> 状态：IMPLEMENTED
> 代码位置：packages/app/src/context/mode.tsx, packages/app/src/components/mode-switcher.tsx

---

## 架构概述

四模式切换器，位于 Layout 左侧 64px 轨道：

- **Coding** (默认): 代码编辑交互
- **Chat**: 对话式 AI（当前使用默认 agent，元智能体就绪后接入）
- **Work**: Agent 工作流调度（当前使用默认 agent）
- **Assistant**: 用户自定义智能体（当前使用默认 agent）

三栏布局：`ModeSwitcher(64px) | SecondarySidebar(256px) | Main(flex-1)`

## 核心接口 (mode.tsx)

```ts
type ModeContext = {
  currentMode: Mode                          // 当前选中模式
  setCurrentMode: (m: Mode) => void          // 切换模式
  activeSessionId: (m: Mode) => () =>        // 获取指定模式的活跃 Session
    ModePlacement | undefined
  setActiveSessionId: (m: Mode, p: ModePlacement) => void  // 记录活跃 Session
  secondarySidebarOpen: boolean              // 次级侧边栏开关
  toggleSecondarySidebar: () => void
}

type ModePlacement = {
  server: ServerConnection.Key
  sessionId: string
}
```

## 数据流

### 模式切换

ModeSwitcher 图标和首页模式卡片行为统一：

```
用户点击 ModeSwitcher 图标 或 首页模式卡片:
  → mode.setCurrentMode(m)
  → mode.activeSessionId(m)() 存在?    // 上次的 session 还在吗？
     ├── 是 → navigate(sessionHref)    // 恢复到上次 session
     └── 否 → newDraft                 // 新建 draft session
```

### Session 归属记录

两个 hook 点自动记录当前 mode 活跃 session：

```
Draft 提交后 (submit.ts):
  → modeCtx.setActiveSessionId(currentMode, { server, sessionId })

导航到已有 session (app.tsx):
  → mode.setActiveSessionId(currentMode, { server, sessionId })
```

### 持久化

- `Persist.global("mode-view")`：currentMode + activeSessionId 每个 mode 独立存储
- `Persist.global("mode.secondarySidebarOpen")`：次级侧边栏开关状态
- 不在 URL 中编码 Mode（ADR-09）

## 入口文件

- `enterMode(m)` — [home.tsx](../../packages/app/src/pages/home.tsx) 首页模式卡片统一入口（四种 mode 无特殊分支）
- `setActiveSessionId` — [submit.ts](../../packages/app/src/components/prompt-input/submit.ts) draft 提交后
- `setActiveSessionId` — [app.tsx](../../packages/app/src/app.tsx) session 导航后
- `ModeSwitcher` — [mode-switcher.tsx](../../packages/app/src/components/mode-switcher.tsx) 纯状态切换，不导航

## 实现前置条件

- Layout 中预留 ModeSwitcher 插槽 ✅
- 各 Mode 共享同一套 session/project 基础设施 ✅
- 元智能体引擎：PLANNED
