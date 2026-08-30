# Session Composer Region 架构

> 状态：草案 v3.0，企业级架构文档
> 代码基线：packages/app/src/pages/session/composer/session-composer-region.tsx + components/prompt-input.tsx

---

## 1. 定位与职责

SessionComposerRegion 是 Session 页面的输入中枢。管理多模态 PromptInput + 5 种 Interruption Dock。它连接用户输入到 Session V2 核心执行流，并通过 InterruptionDock 处理 AI 的中断请求。

---

## 2. 上游入口链路

```
Session (pages/session.tsx)
  -> SessionComposerRegion (props: state, ready, centered, placement, inputRef,
        newSessionWorktree, onNewSessionWorktreeReset,
        onSubmit, onResponseSubmit,
        followup, revert)
    -> createSessionComposerState() 创建中断状态机
    -> controls memo 构建 PromptInput 能力接口
```

---

## 3. 组件树

```
SessionComposerRegion
├── PromptInput
│   ├── EditorPanel
│   │   ├── TextEditor (contenteditable/textarea)
│   │   ├── AttachmentBar
│   │   │   ├── FileAttachment[]
│   │   │   ├── AgentTag[] (@agent 语法)
│   │   │   └── ImageAttachment[]
│   │   └── ContextBadge[] (已附加文件/Agent 标签)
│   │
│   ├── ControlBar
│   │   ├── AgentSelector — Agent 切换器
│   │   ├── ModelSelector — Model + thinking effort
│   │   ├── ProjectSelector — 工作区切换
│   │   └── SubmitButton — 提交 (Enter/Ctrl+Enter)
│   │
│   └── ShellModeToggle — Normal/Shell 模式切换
│
└── InterruptionDock (动态插槽)
    ├── SessionQuestionDock    — AI 提问
    │   ├── QuestionText
    │   ├── OptionsList         — 选择项
    │   └── TextReplyInput      — 文本回复
    │
    ├── SessionPermissionDock  — 权限审批
    │   ├── PermissionDetail    — 操作详情
    │   ├── ApproveButton
    │   ├── DenyButton
    │   └── AlwaysApproveToggle
    │
    ├── SessionFollowupDock    — 后续建议
    │   └── FollowupCard[]      — 建议卡片 (点击执行)
    │
    ├── SessionRevertDock      — 撤销确认
    │   ├── RevertItemList
    │   └── Confirm/Cancel
    │
    └── SessionTodoDock        — 任务计划
        ├── TodoItem[]
        └── TodoProgress
```

PromptInput 下的 EditorPanel、AttachmentBar、ControlBar、ShellModeToggle 是逻辑区域名称；实现中部分区域为内联 JSX 或子模块组合，不要求存在同名导出组件。

---

## 4. Context 依赖图

| 层级      | Context            | 用途                             |
| --------- | ------------------ | -------------------------------- |
| Session级 | usePrompt          | 输入状态 (current/clear/restore) |
| Session级 | useSDK             | SessionV2.prompt() API           |
| Session级 | useSync            | 服务器数据缓存                   |
| 服务器级  | useLayout          | 布局状态、项目列表               |
| 服务器级  | useLocal           | Agent/Model 本地选择             |
| 服务器级  | useSettings        | visibility 控制 (customAgents)   |
| 服务器级  | useServer          | 服务器连接                       |
| 全局      | useTabs            | Session Tab 管理                 |
| 全局      | useGlobal          | sessionPlacement                 |
| 全局      | useProviders       | 模型 Provider 列表               |
| 局部      | useDirectoryPicker | 项目目录选择                     |
| 局部      | useSessionKey      | Session 路由参数                 |

---

## 5. 数据流架构

### 5.1 Prompt 提交链路

```
用户输入 -> PromptInput.prompt.current()
  -> submit.validate(state)
    -> 检查阻塞: state.blocked() ? 中断未处理 : 继续
    -> 检查权限: auto-accept 模式
  -> submit.execute(prompt, sdk, server)
    -> sdk.client.session.prompt({ sessionID, prompt, delivery })
      -> [HTTP -> Server -> Core SessionV2]
        -> SessionInput.admit(db, events, input)
          -> SessionExecution.wake(sessionID)
            -> SessionRunner.run() -> LLM -> EventV2 -> Timeline
```

### 5.2 中断处理流

```
EventV2 事件到达
  -> SessionComposerState 更新
    -> state.blocked() -> true
    -> 对应 Dock 挂载 (useSpring 动画)
    -> 用户交互 -> onResponse/decide
      -> SDK API 回调
      -> state.blocked() -> false
      -> Dock 卸载
```

### 5.3 项目切换流

```
SessionComposerRegion
  -> useDirectoryPicker().pickDirectory({ server, title, onSelect })
    -> directory-picker UI
    -> onSelect(directory)
      -> ServerSync 加载新目录
      -> TabsProvider 创建新 Session
```

---

## 6. InterruptionDock 状态机

```
SessionComposerState (session-composer-state.ts:178)
  blocked: () => boolean           -- 是否阻塞输入
  questionRequest: () => ...       -- 智能体提问请求
  permissionRequest: () => ...     -- 权限请求
  permissionResponding: () => bool -- 权限响应中
  decide: (decision) => void       -- 驱动 V2 核心状态机
  todos: () => Todo[]              -- 任务计划
  dock: () => string | undefined   -- 当前活跃 dock 类型
  closing: () => boolean           -- 关闭动画中
  opening: () => boolean           -- 打开动画中

中断优先级: questionRequest > permissionRequest (互斥)
todos 不阻塞输入。followup 和 revert 由 Session 组件作为 props 注入，不属于 createSessionComposerState 的返回值。
```

---

## 7. 错误与边界

| 场景           | 处理                          |
| -------------- | ----------------------------- |
| 输入为空       | Submit 按钮禁用               |
| 已有阻塞中断   | 新提交被阻止                  |
| SDK 调用失败   | formatServerError + showToast |
| 项目未选择     | project selector 提示         |
| handoff prompt | 跨 Session 保持输入草稿       |

---

## 8. 性能考虑

- controls memo 仅在依赖变化时重建
- useSpring 动画 GPU 加速 (opacity + transform)
- InterruptionDock 条件渲染，非活跃时 unmount
- PromptInput 附件懒加载

---

## 9. 上下游文件索引

| 层级            | 文件                                               |
| --------------- | -------------------------------------------------- |
| Session 宿主    | pages/session.tsx                                  |
| Composer Region | pages/session/composer/session-composer-region.tsx |
| Composer State  | pages/session/composer/session-composer-state.ts   |
| PromptInput     | components/prompt-input.tsx                        |
| Submit 逻辑     | components/prompt-input/submit.ts                  |
| 附件系统        | components/prompt-input/attachments.ts             |
| Question Dock   | pages/session/composer/session-question-dock.tsx   |
| Permission Dock | pages/session/composer/session-permission-dock.tsx |
| Followup Dock   | pages/session/composer/session-followup-dock.tsx   |
| Revert Dock     | pages/session/composer/session-revert-dock.tsx     |
| Todo Dock       | pages/session/composer/session-todo-dock.tsx       |
| Handoff         | pages/session/handoff.ts                           |
