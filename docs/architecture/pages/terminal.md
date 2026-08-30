# Terminal Panel 架构

> 状态：草案 v3.0，企业级架构文档
> 代码基线：packages/app/src/pages/session/terminal-panel.tsx + context/terminal.tsx

---

## 1. 定位与职责

TerminalPanel 是 Session 页面的 PTY 终端面板。支持多标签、拖拽调整高度、标签排序。通过 TerminalProvider 管理 PTY 进程的完整生命周期。

---

## 2. 上游入口链路

```
Session (pages/session.tsx)
  -> TerminalPanel (terminal-panel.tsx)
    -> TerminalProvider (context/terminal.tsx)
      -> terminal.new() -> sdk.client.pty.create({ title }) -> server PTY fork
      -> terminal.load()  -> Persist.serverWorkspace 恢复标签列表
```

---

## 3. 组件树

```
TerminalPanel
├── ResizeHandle (垂直拖拽)
│   └── onDrag -> layout.terminal.height 更新
│
├── Tabs (标签栏)
│   ├── SortableTerminalTab[]
│   │   ├── terminalTabLabel (名称 + 状态指示)
│   │   └── CloseButton
│   └── NewTabButton
│
└── Terminal (xterm.js 渲染器)
    ├── xterm.Terminal 实例
    ├── WebSocket PTY 双向通信
    │   ├── 输入: onData -> PTY stdin
    │   └── 输出: PTY stdout -> term.write()
    └── ResizeObserver -> term.fit()
```

---

## 4. Context 依赖图

| 层级      | Context          | 用途                                       |
| --------- | ---------------- | ------------------------------------------ |
| Session级 | useTerminal      | PTY 生命周期 (open/close/kill/tabs)        |
| Session级 | useSDK           | sdk.client.pty.create API                  |
| Session级 | useSessionLayout | workspaceKey, view                         |
| 服务器级  | useLayout        | layout.terminal.height() 持久化高度        |
| 服务器级  | useSettings      | terminal 字体设置                          |
| 全局      | useCommand       | 键盘快捷键 (terminal.toggle ctrl+backtick) |
| 全局      | useLanguage      | i18n 翻译                                  |

---

## 5. 数据流架构

### 5.1 终端创建

```
terminal.new()
  -> pickNextTerminalNumber() 获取下一个编号
  -> sdk.client.pty.create({ title: defaultTitle(nextNumber) })
    -> Server PTY fork
    -> 返回 { id, title }
    -> Terminal 实例挂载 -> xterm.open(el)
    -> focusTerminalById() 聚焦
```

### 5.2 Session 切换恢复

```
terminalProvider.load(sdk, scope, legacySessionID)
  -> Persist.serverWorkspace(scope, dir, "terminal", legacy)
  -> 恢复 store.all + store.active
  -> UI 渲染 active PTY 对应 Terminal 并建立 WebSocket
  -> 无标签 -> 自动创建首个终端 (autoCreated 防重复)
```

---

## 6. 布局约束

```
maxHeight = viewport.height * 0.6 (防占满屏幕)
minHeight = ResizeHandle min constraint
persistedHeight = layout.terminal.height() (workspace 级记忆)
opened/closed = view().terminal.opened() / .close()
```

---

## 7. 持久化

```
主 Key: Persist.serverWorkspace(scope, dir, "terminal", legacy)
Legacy: {dir}/terminal.v1, {dir}/terminal/{sessionID}.v1
存储: Tab ID 列表 + 标题
```

---

## 8. 错误边界

| 场景           | 处理                         |
| -------------- | ---------------------------- |
| PTY 创建失败   | showToast 错误通知           |
| WebSocket 断开 | 自动重连                     |
| 所有 Tab 关闭  | 自动 close() 收起面板        |
| 首次加载无 Tab | 自动创建 (store.autoCreated) |
| PTY 进程僵死   | kill + 重新创建              |

---

## 9. 上下游文件索引

| 层级         | 文件                                                       |
| ------------ | ---------------------------------------------------------- |
| Session 宿主 | pages/session.tsx                                          |
| Panel 实现   | pages/session/terminal-panel.tsx                           |
| PTY 生命周期 | context/terminal.tsx                                       |
| 排序 Tab     | components/session/session-sortable-terminal-tab.tsx       |
| 终端渲染器   | components/terminal/terminal.tsx                           |
| 布局 helpers | pages/session/helpers.ts (createSizing, focusTerminalById) |
| 持久化       | utils/persist.ts                                           |
