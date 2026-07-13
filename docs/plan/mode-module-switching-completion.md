# Product Mode Module Switching Completion Plan

> 状态：COMPLETED
> 决策日期：2026-07-12
> 实施完成：2026-07-13
> Owner：App + Session Platform
> 架构决策：[`ADR-11-product-mode-session-classification.md`](../architecture/adr/ADR-11-product-mode-session-classification.md)、[`ADR-12-product-mode-entry-routing.md`](../architecture/adr/ADR-12-product-mode-entry-routing.md)
> 取代：[`mode-unified-architecture.md`](mode-unified-architecture.md)、[`mode-switcher-implementation.md`](mode-switcher-implementation.md)

## 实施摘要

### 已完成

| 层面 | 内容 | 状态 |
|------|------|------|
| **Domain** | ProductMode Schema (`chat\|coding\|work\|assistant`) | ✅ |
| **DB** | session 表新增 mode 列 + 2 索引 + migration | ✅ |
| **Schema** | V2 Info `mode` required / V1 SessionInfo decoding default | ✅ |
| **API** | create/list 支持 mode（根/子/Fork 继承）| ✅ |
| **SDK** | 重新生成，ProductMode 类型 + Session.mode | ✅ |
| **ModeContext** | 删除 activeSessionId/ActiveSessionMap/placement | ✅ |
| **DraftTab** | 新增必需 mode 字段，持久化迁移将历史/非法值归一为 Coding | ✅ |
| **Routing** | 新增 `/mode/:mode`，卡片和全局 ModeSwitcher 通过路由进入模块 | ✅ |
| **Secondary Sidebar** | Coding 保持项目树；Chat/Work/Assistant 占位 | ✅ |
| **Right Panel** | Coding 保持 review/file tree；其他模式占位 | ✅ |
| **submit.ts** | draft → session.create 传入 draft.mode | ✅ |
| **Mode authority** | Module/Draft/Session 路由单向同步持久化 currentMode | ✅ |

### ADR-12 落地约束

- `/mode/:mode` 只接受 `chat | coding | work | assistant`。
- Home 卡片和全局 ModeSwitcher 只负责导航，不创建、恢复或重分类 Session。
- Draft 路由以 `DraftTab.mode` 为权威；Session 路由以 durable `Session.mode` 为权威。
- Home 的最近 Mode 仅作为展示默认值。
- ServerSync 按 `(directory, mode)` 发起服务端过滤查询，并合并到统一 Session 实体集。
- Product Mode 是封闭领域，不支持前端任意字符串 Custom Mode。

### 后续迭代

- Chat/Work/Assistant 模式的具体业务侧栏与右栏内容（当前使用共享占位 Surface）。
- Mode 专属空状态文案。

## 架构说明

### Mode Surface Registry

每个模式注册自己的`次级侧栏`和`右栏`组件，Layout 通过 `Dynamic` 注入渲染。新增一个模式只需：

1. `packages/schema/src/product-mode.ts` — 加一个字面量
2. 新建一个 Sidebar 组件 + 一个 RightPanel 组件
3. `packages/app/src/components/mode-surfaces.tsx` — 在 `MODE_SURFACES` 注册表中加一条记录

**不需要改**的文件：Layout 骨架、ModeSwitcher 循环、Home 页面过滤、次级侧栏渲染、右栏渲染。

### 注册表结构

```ts
// packages/app/src/components/mode-surfaces.tsx
type ModeSurface = {
  Sidebar: Component     // 次级侧栏内容
  RightPanel: Component  // 右栏内容
}

export const MODE_SURFACES: Record<Mode, ModeSurface>
```

### 布局复用

```
┌────┬──────────────────┬───────────────────────┬─────────────────┐
│  左│  次级侧栏          │  Main 区域              │  右栏             │
│  侧│  ┌─────────────┐  │                        │                  │
│  栏│  │ 新建 + 搜索   │  │  (统一的消息流/会话内容)  │  (上下文面板)     │
│  │  ├─────────────┤  │                        │                  │
│  N │  · Coding      │  │  所有模式共享同一套        │  · Coding:      │
│  a │  → 项目树+会话  │  │  Session 结构             │  review/file    │
│  v │  · Chat        │  │                        │  · Chat:        │
│  │  → 占位(功能列表) │  │                        │  → 占位          │
│  B │  · Work        │  │                        │  · Work:        │
│  a │  → 占位(工作流)  │  │                        │  → 占位          │
│  a │  → 占位        │  │                        │                  │
│  r │  · Assistant   │  │                        │                  │
│    │  → 占位        │  │                        │                  │
│    └──────────────────┘                        │                  │
└────┴──────────────────┴───────────────────────┴─────────────────┘
```

### 数据流

```
ModeSwitcher / HomeModeCards
  -> navigate(`/mode/${target}`)
  -> ModeRoute 校验参数并单向同步 currentMode
  -> Home 会话列表按 mode 发起服务端过滤查询
  -> 有匹配 session → 显示列表
  -> 无匹配 session → 空状态 + 新建按钮

New Session
  -> tabs.newDraft({ ..., mode: currentMode })  ← DraftTab 冻结 mode
  -> submit.ts 读取 DraftTab.mode
  -> POST /session { mode }
  -> session.mode 持久化
```

### 关键文件

| 文件 | 职责 |
|------|------|
| `packages/schema/src/product-mode.ts` | ProductMode 字面量 Schema |
| `packages/schema/src/session.ts` | Session.Info 新增 mode（withDecodingDefaultKey） |
| `packages/core/src/v1/session.ts` | V1 SessionInfo 新增 mode（可选，旧事件兼容） |
| `packages/core/src/session/sql.ts` | SessionTable 新增 mode 列 + 索引 |
| `packages/aigcfroge/src/session/session.ts` | CreateInput/ListInput/Interface/fork 继承 mode |
| `packages/app/src/context/mode.tsx` | ModeContext: 删 activeSessionId，保留 currentMode |
| `packages/app/src/context/tabs.tsx` | DraftTab 新增 mode |
| `packages/app/src/pages/home.tsx` | Mode 卡片导航 + Mode scoped Session 查询 |
| `packages/app/src/components/secondary-sidebar.tsx` | 非 Coding mode 显示占位 |
| `packages/app/src/pages/session/session-side-panel.tsx` | 非 Coding mode 显示占位 |
| `packages/app/src/components/prompt-input/submit.ts` | session.create 传入 DraftTab.mode |
