# CODING 模式工作台架构

> 状态：草案 v3.0，企业级架构文档
> 代码基线：packages/app/src/pages/session.tsx + 所有子组件
> 遵循协议：docs/architecture/system-blueprint.md §5 + §11

---

## 1. 定位与职责

CODING 模式是 AigcForge 的默认工作台，提供 AI 辅助代码开发的完整交互闭环：

```
编写 Prompt → AI 生成/修改代码 → Diff 评审 → 行级评论 → 追加 Prompt → 持续迭代
```

它是目前**唯一拥有专属完整工作台的 Mode**。四 Mode 的切换、Session 分类和过滤框架按 `mode-module-switching-completion.md` 补齐；CHAT/WORK/ASSISTANT 的专属 Viewport 仍为 PLANNED。

---

## 2. 上游入口链路

```
URL: /server/:serverKey/session/:id
  → TargetSessionRoute (app.tsx)
    → requireServerKey(params.serverKey)
    → ServerSDKProvider + ServerSyncProvider (按需创建连接)
    → global.sessionPlacement.resolve() (解析 session root/leaf/directory)
    → TargetServerScopedProviders
      → SDKProvider (绑定 directory)
      → DirectoryDataProvider
      → TargetSessionPage
        → SessionProviders (Terminal > File > Prompt > Comments)
          → Session 组件 (session.tsx)
```

**关键决策**: Session 路由不编码 Mode。`/mode/:mode` 只作为模块入口，Session/Draft 仍使用 canonical URL；`Session.mode` 是持久化分类，模块入口导航不创建、不恢复、不重分类，见 ADR-09、ADR-11 与 ADR-12。

---

## 3. 页面布局与组件树

```
Session
├── SessionHeader           — 顶部 Session 操作条
│
├── Main workspace row
│   ├── Center (flex-1)
│   │   ├── MessageTimeline     — 虚拟化消息列表
│   │   │   ├── VirtualItem[] (@tanstack/solid-virtual)
│   │   │   ├── MessagePart     — 消息渲染 (文本/工具/Diff)
│   │   │   ├── StickyAccordionHeader — 工具调用吸顶
│   │   │   └── TextReveal      — 流式文本输出
│   │   │
│   │   └── SessionComposerRegion — 输入中枢
│   │       ├── PromptInput     — 多模态输入
│   │       ├── ModelSelector   — 模型/effort 选择
│   │       ├── AgentSelector   — Agent 分发
│   │       └── InterruptionDock
│   │           ├── SessionQuestionDock
│   │           ├── SessionPermissionDock
│   │           ├── SessionFollowupDock
│   │           ├── SessionRevertDock
│   │           └── SessionTodoDock
│   │
│   └── SessionSidePanel (右侧, 条件展开)
│       ├── Review tab          — Diff 评审和文件变更列表
│       ├── Context tab         — SessionContextUsage + 上下文内容
│       ├── File tabs           — 打开的文件 tab
│       └── FileTree panel      — changes/all 两个文件树视图
│
└── TerminalPanel            — 底部 PTY 终端 (拖拽调整高度)
    ├── ResizeHandle
    ├── Tabs + SortableTerminalTab
    └── Terminal (xterm.js)
```

---

## 4. Context 依赖图

Session 页面注入 **15 个 Context**，分三层：

| 层级      | Context          | 职责                               |
| --------- | ---------------- | ---------------------------------- |
| 全局      | useSDK           | 目录级 SDK 客户端                  |
| 全局      | useServerSDK     | 服务器级 SDK 客户端                |
| 全局      | useSettings      | 用户设置 (visible/disabled 控制)   |
| 全局      | usePlatform      | 平台检测 (desktop/web/mobile)      |
| 全局      | useLanguage      | i18n 翻译函数                      |
| 全局      | useDialog        | 模态对话框管理                     |
| 服务器级  | useServerSync    | 服务器数据同步状态                 |
| 服务器级  | useSync          | 数据缓存 (message, session, agent) |
| 服务器级  | useLayout        | 项目列表、侧边栏状态、终端高度     |
| 服务器级  | useLocal         | 本地模型/Agent 选择状态            |
| Session级 | useTerminal      | PTY 进程生命周期                   |
| Session级 | useFile          | 文件树、文件搜索、选中行           |
| Session级 | usePrompt        | 输入框状态持久化                   |
| Session级 | useComments      | 行级评论管理                       |
| Session级 | useSessionLayout | 路由参数、workspaceKey、tabs、view |

---

## 5. 数据流架构

### 5.1 Prompt 提交全链路

```
用户输入 Prompt
  → PromptInput.Submit
    → submit.validate(prompt, state)
    → submit.execute(prompt, sdk, server)
      → sdk.client.session.prompt({ sessionID, prompt, delivery })
        [HTTP POST → Server → Core SessionV2]
          → SessionInput.admit(db, events, input)
            → 写入 session_input 表
            → SessionExecution.wake(sessionID)
              → SessionRunner.run({ sessionID, force })
                → 初始化/确认 Context Epoch
                → Promote 合格 input
                → Reconcile SystemContext
                → 加载投影历史 (SessionHistory / SessionProjector)
                → 构建 request 并调用唯一一次 llm.stream(request)
                  → TODO list 写入
                  → File operations (read/write/edit)
                → 事件发布 (EventV2 PubSub)
                  → event 表持久化
                  → WebSocket push → SDK → sync store
                    → createResource 触发
                    → MessageTimeline 重新渲染
```

### 5.2 消息同步流

```
ServerSyncProvider (周期性轮询 + WebSocket)
  → sync().session.sync(sessionID)
    → SDK: client.session.getMessages({ sessionID })
    → 写入 sync().data.message[sessionID]
      → createTimelineModel.messages() memo 更新
      → createVirtualizer 重新计算
      → measureElement 动态度量行高
      → 渲染 VirtualItem[]
```

### 5.3 Code Review 闭环

```
AI 生成文件修改
  → MessageTimeline 展示 Diff Part
  → 用户打开 Review Panel
    → SessionReviewTab 渲染 Diff (Unified/Split)
    → 用户双击行 → 添加 Comment
      → CommentsProvider.add({ file, lines, body })
      → Composer 自动附加 file selection context
      → 用户追加 Prompt → 新一轮提交
```

---

## 6. Session 生命周期

### 6.1 创建

```
新 Session 流程:
  /new-session?draftId=xxx
    → DraftRoute → ResolvedDraftRoute
    → NewSessionView (起步引导面板)
    → 用户输入首次 Prompt
    → SDK: client.session.create({ directory, prompt })
    → 返回 sessionID
    → navigate → /server/:key/session/:id
```

### 6.2 恢复

```
Session 切换:
  tabs.addSessionTab({ server, sessionID })
    → sessionPlacement 缓存 placement
    → layout.tabs() 管理标签列表
    → terminalProvider.load() 恢复终端状态
    → promptProvider.restore() 恢复输入草稿
```

### 6.3 Fork

```
session.fork({ sessionID, messageID })
  → SDK: 从指定消息创建子 Session
  → 保留 parentID 关联
  → navigate 到新 Session
```

### 6.4 Compact

```
session.compact({ sessionID })
  → SDK: SessionV2.compact()
  → 生成摘要替换历史消息
  → 减少 context 占用
```

---

## 7. 中断系统 (Interruption System)

### 7.1 状态机

```
session-composer-state.ts: SessionComposerState
  blocked: () => boolean
  questionRequest: () => ...
  permissionRequest: () => ...
  permissionResponding: () => boolean
  decide: (decision) => void
  todos: () => Todo[]
  dock: () => string | undefined
  closing: () => boolean
  opening: () => boolean
```

### 7.2 中断类型

| 类型       | 触发源          | 阻塞 | 用户响应                |
| ---------- | --------------- | ---- | ----------------------- |
| Question   | AI 运行时提问   | 是   | 文本回复 / 选项选择     |
| Permission | 工具权限检查    | 是   | Approve / Deny / Always |
| Revert     | 撤销确认        | 是   | Confirm / Cancel        |
| Followup   | AI 完成后的建议 | 否   | 点击执行建议            |
| Todo       | AI 输出任务计划 | 否   | 查看修改                |

---

## 8. SessionSidePanel

### 8.1 结构

```
SessionSidePanel
├── Review/File tab area (reviewOpen 时占主宽度)
│   ├── review tab -> props.reviewPanel()
│   ├── context tab -> SessionContextTab + SessionContextUsage indicator
│   ├── file tabs -> SortableTab + FileTabContent
│   └── open file button -> DialogSelectFile
└── FileTree panel (showFileTree && layout.fileTree.opened)
    ├── changes tab -> 按 diffFiles 过滤 FileTree
    ├── all tab -> 全量 FileTree
    └── ResizeHandle -> layout.fileTree.width()
```

### 8.2 行为

- Desktop: review panel 或 file tree 打开时展开
- Mobile: 当前 SessionSidePanel 不渲染，移动端使用 session/change tabs
- 折叠状态: `view().reviewPanel` + `layout.fileTree.opened()`
- 文件树可见性: `settings.visibility.fileTree()`

---

## 9. MessageTimeline 性能架构

### 9.1 虚拟化策略

```
createVirtualizer({
  getScrollElement: () => scrollContainer,
  estimateSize: () => 80,          // 初始估计行高
  measureElement: (el) => el.getBoundingClientRect().height,
  rangeExtractor: defaultRangeExtractor,
  overscan: 5,                     // 预渲染 overscan 行
})

每个 VirtualItem:
  { index, start, size, end, lane }
```

### 9.2 缓存策略

- `timelineCache`: 缓存 messages 的展开/折叠状态
- `measurements`: 缓存每行的测量高度，切换路由时恢复
- `toolOpen`: 工具调用的折叠状态持久化
- `scrollPosition`: 滚动位置在 Session 切换时保持

### 9.3 手势防护

```ts
shouldMarkBoundaryGesture(e) // 识别触控板边界手势
normalizeWheelDelta(e) // 归一化滚轮增量
// 拦截会导致父容器滚动的 gesture → 阻止 Viewport 切换
```

---

## 10. SessionReviewTab

### 10.1 渲染模式

- **Unified**: 单栏混排 Diff (`diffStyle = "unified"`)
- **Split**: 左右双栏对比 (`diffStyle = "split"`)

### 10.2 文件懒加载

```ts
// 仅在文件展开时加载内容
client.file.read({ path, revision? })
  → 异步获取文件内容
  → Diff 计算
  → 渲染行
```

### 10.3 评论系统

```
onLineComment → CommentsProvider.add({ file, lines, body })
onLineCommentUpdate → CommentsProvider.update(id, body)
onLineCommentDelete → CommentsProvider.remove(id)

focusedComment: 高亮定位目标评论
focusedFile: 定位目标文件
commentMentions: @ 提及系统
```

---

## 11. 错误处理

| 层级    | 机制                             | 行为                |
| ------- | -------------------------------- | ------------------- |
| Route   | ErrorBoundary + ErrorPage        | 显示错误 + 重试     |
| Server  | ConnectionGate + ConnectionError | 健康检查 + 定时重试 |
| SDK     | formatServerError()              | 格式化错误消息      |
| Effect  | Cause.fail + catchAll            | 结构化错误传播      |
| Session | NotFoundError, LifecycleConflict | 特定业务错误类型    |
| UI      | showToast()                      | 非阻塞错误通知      |

---

## 12. 键盘命令系统

Session 页面的键盘快捷键通过 `useSessionCommands()` 注册 (use-session-commands.tsx)：

| 命令 ID                | 快捷键          | 动作                 |
| ---------------------- | --------------- | -------------------- |
| session.new            | `mod+shift+s`   | 新建会话             |
| message.previous       | `mod+alt+[`     | 上一个消息           |
| message.next           | `mod+alt+]`     | 下一个消息           |
| file.open              | `mod+k,mod+p`   | 打开文件             |
| fileTree.toggle        | `mod+\`         | 切换文件树           |
| terminal.toggle        | `ctrl+backtick` | 切换终端             |
| terminal.new           | `ctrl+alt+t`    | 新建终端             |
| review.toggle          | `mod+shift+r`   | 切换 Review 面板     |
| model.choose           | `mod+'`         | 选择模型             |
| model.variant.cycle    | `shift+mod+d`   | 循环 thinking effort |
| agent.cycle            | `mod+.`         | 循环切换 Agent       |
| agent.cycle.reverse    | `shift+mod+.`   | 反向循环 Agent       |
| tab.close              | `mod+w`         | 关闭 Tab             |
| input.focus            | `ctrl+l`        | 聚焦输入框           |
| permissions.autoaccept | `mod+shift+a`   | 自动接受权限         |
| context.addSelection   | `mod+shift+l`   | 添加选中行到上下文   |

---

## 13. 上下游文件索引

| 层级           | 关键文件                                            |
| -------------- | --------------------------------------------------- |
| **路由入口**   | app.tsx → TargetSessionRoute → TargetSessionPage    |
| **主组件**     | pages/session.tsx (Session default export)          |
| **侧边栏**     | pages/session/session-side-panel.tsx                |
| **消息列表**   | pages/session/timeline/message-timeline.tsx         |
| **时间线模型** | pages/session/timeline/model.ts                     |
| **输入框**     | pages/session/composer/session-composer-region.tsx  |
| **中断状态**   | pages/session/composer/session-composer-state.ts    |
| **终端**       | pages/session/terminal-panel.tsx                    |
| **审查**       | pages/session/review-tab.tsx                        |
| **布局**       | pages/session/session-layout.ts                     |
| **命令**       | pages/session/use-session-commands.tsx              |
| **帮助函数**   | pages/session/helpers.ts                            |
| **Core API**   | packages/core/src/session.ts (SessionV2)            |
| **SDK**        | packages/sdk/js (client.session.\*)                 |
| **持久化**     | utils/persist.ts (Persist.session / Persist.scoped) |
