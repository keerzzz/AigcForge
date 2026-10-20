# ZCode、Antigravity、DeepSeek-Harness 与 Claude Code 智能体交互、UI 体系与 Todo/Task 深度调研

> **归档位置**：`docs/research/agent/ZCode-Antigravity-DeepSeekHarness智能体交互与UI体系深度调研.md`  
> **适用范围**：Coding / Custom / Chat / Work 全模式通用  
> **核心议题**：专属 Icon 体系、输入框交互（Composer）、子智能体弹窗与智能体地图（Agent Map）、任务与规划清单（Todo/Plan）、后台任务调度（Task）

---

## 一、 调研对象与背景概况

本调研针对本地开发环境中实际部署、运行与参考的主流智能体系统进行源码级、配置级与交互行为级的系统性梳理：

1. **ZCode（智谱 AI）**：基于 `/opt/ZCode` 与 `~/.zcode`，面向 GLM-5.2 长程推理的官方全集成开发环境与 CLI Agent 架构。
2. **Google Antigravity**：端到端自主工程智能体平台，包含 CLI `agy`、IDE 与 Desktop 2.0，以及多智能体（Subagents）与后台任务（Background Tasks）架构。
3. **DeepSeek-Harness（`dsh`）**：DeepSeek 开源的 Agent Harness 运行时，源码位于 `/home/keer/Documents/web/deepseek-harness-master`，采用 Cordis 时空可组合范式，首创 `ToolRow` / `DisclosureRow` 无气泡极简工具流与 `ui-plan` / `tool-todo` 解耦架构。
4. **Claude Code（Anthropic）**：本地配置位于 `~/.claude`，涵盖 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`、子智能体拓扑调度（Subagent Map）、程序化交接（Handoff）及输入框 `@` 唤醒体系。

---

## 二、 输入框（Composer）与子智能体模块（Agent Map）机制调研

### 1. Claude Code：输入框子智能体弹窗与 Agent Map 拓扑

- **输入框唤醒机制**：
  - 用户在输入框中输入 `@` 或点击左侧智能体标识时，在输入框上方展开轻量级浮层。
  - **无失焦特性**：光标移动选择时，输入焦点始终锁定在 `textarea`，打字与键盘操作完全连续。
- **智能体地图（Agent Map）能力**：
  - **角色与能力拓扑**：非单纯的名称平铺列表，而是具备明确职责分工的图谱：
    - `Lead / Orchestrator`：意图识别、规划拆解与总控。
    - `Researcher`：只读模式，符号图谱检索、网络文档查阅。
    - `Coder`：拥有写权限、PTY 终端与 Pierre Diff 修改能力。
    - `Reviewer / Verifier`：自动化单测验证、安全审计与代码审查。
  - **执行状态与能力边界透视**：清晰标注每个 Agent 的当前状态（`Idle` / `Busy`）、所绑定的工具集（Tools / MCP）以及交接链路（Lead ➔ Researcher ➔ Coder ➔ Reviewer）。
  - **点击一键指派**：在地图中选择任一节点，输入框自动填充 `@Agent-Name` 并挂载其专属上下文。

### 2. DeepSeek-Harness：Combobox 与触发器分层

- **组件结构**：`packages/client/ui-input-trigger` + `packages/client/ui-chat`。
- **多维触发符**：
  - `/`：触发命令（Slash commands），带分组与面包屑导航。
  - `@`：触发上下文引用（文件、符号、历史会话、诊断信息）。
  - `#`：触发工作项、PR 或 Issue 关联。
- **自适应悬浮锚定**：`MenuSurface` 动态计算输入框上方可用视口空间，自适应向上弹出，随输入框高度变化自动重新测量。

### 3. Google Antigravity：多模态与多维挂载

- **全要素 `@` 挂载**：支持代码文件、文件夹、Git 提交记录、运行中的终端 PTY、已配置的 MCP 工具。
- **多模态与拖拽**：直接拖拽文件或粘贴图片，自动生成轻量附件胶囊（Pills），不污染文本域。

---

## 三、 Todo（任务规划与检查点）机制调研

### 1. DeepSeek-Harness：`ToolRow` 单行折叠流与宏微解耦

- **分层解耦**：
  - **宏观 Plan（`packages/client/ui-plan`）**：独立文档产物 `SubmittedPlan`，推送到 **右侧侧边栏（`sidebarRight`）**，主会话流尾部仅保留 1 行文档链接。
  - **微观 Todo（`packages/todo/tool-todo`）**：由 `todo_write` 触发，前端收拢为会话级响应式单一投影：`useProjection('todos')`。
- **UI 呈现**：
  - **空列表时不占任何高度（`todos.length === 0 return null`）**。
  - **有任务时默认折叠为 28px 单行条**：`<IconChecklist /> 任务 · 1 已完成 · 1 进行中 · 1 待处理 <Chevron />`。
  - **流内（In-stream）**：每次 `todo_write` 仅呈现为单行 `ToolRow`，展开通过 `todoDiffModel` 查看增减对比。

### 2. Google Antigravity：Planning 状态机与 Auxiliary Pane

- **产物驱动（Artifact-driven）**：将任务规划定义为持久化 Markdown 产物（`implementation_plan.md` 和 `walkthrough.md`）。
- **右侧专属辅助面板（Auxiliary Pane）**：Plan 完整视图常驻于右侧面板（与 Subagents、Background Tasks、Terminals 平级），无论主对话滚到哪里，用户随时可以比对目标与步骤。
- **会话主视窗**：主视窗只保留线性思考与单行工具日志，遇到决策点时仅弹出轻量选项（`ask_question`）。

### 3. ZCode：持久化任务树与流式静默

- 在 `~/.zcode/v2/tasks-index.sqlite` 中建立完善的数据库表（`tasks`, `task_groups`, `automations`）。
- 会话流中通过配置 `"messageStreamShowTodos": true` 控制流式折叠，完成后自动静默。

---

## 四、 Task（子智能体与后台执行）机制调研

### 1. DeepSeek-Harness：血缘链路与轻量 TaskRow

- **多引擎子代理**：通过 `packages/subagent` 统一派发 Claude Code、Codex、DSH SDK 等子代理。
- **血缘追踪**：`SubagentHeaderLineage` 明确记录父子会话依赖。
- **单行呈现**：会话流内呈现为单行 `[task] Subagent: Claude Code · "Refactor auth" · running`，展开仅展示提取自 `<task_result>` 的关键摘要。

### 2. Google Antigravity：并行协作与后台解耦

- **专长代理（Subagents）**：主 Agent 可通过 `invoke_subagent` 派发并行研究员或安全审计员，在隔离分支工作树中执行，执行完后事件化通知主 Agent。
- **后台 Daemon 任务**：通过 `schedule`（定时/延时）与 `manage_task`（kill, status, send_input）管理异步长程任务，绝不阻塞前端。
- **多维面板收纳**：所有子智能体日志与后台任务统一在 Auxiliary Pane 监控，保持主聊天流整洁。

---

## 五、 AigcForge 现状痛点剖析（为什么之前升级依然不合理？）

1. **三处空间同时争夺焦点（位置冲突）**：
   - 顶部有 34px 的 `SessionTodoProgress` 轨；
   - 底部有 `SessionTodoDock` 浮层抽屉；
   - 中间消息流内又有 `message-part` 的 `todowrite` 卡片。
   - **后果**：一次任务更新，顶部在闪、底部在弹、中间在滚，用户视线被强行撕碎。
2. **状态源分裂（架构缺陷）**：
   - 前端代码存在 `pickProgressTodos(session_task[id], session_todo[id])`——同一个系统里并存两套数据源，每次靠时间戳猜“谁更新听谁的”，极易产生闪烁与时序倒错。
3. **“谁来做（Agent）”与“做什么（Todo）”脱节**：
   - 输入框缺少类似 Claude Code 的直观 Agent Map，用户不知道当前会话有哪些子智能体、各有什么专长；
   - Todo 清单上的任务只是冰冷的文字，无法看出由哪个专长 Agent 承担。

---

## 六、 AigcForge 最优且逻辑最简的全新重构方案

### 1. 概念层：统一三元模型（Unified Triad Model）

```text
┌────────────────────────────────────────────────────────┐
│ 1. 谁来做？ ──> [输入框 Agent Map 弹窗] (组织拓扑与角色) │
│    Lead (统筹) ➔ Researcher (检索) ➔ Coder (重构)      │
└───────────────────────────┬────────────────────────────┘
                            │ 意图驱动并指派执行者
                            ▼
┌────────────────────────────────────────────────────────┐
│ 2. 做什么？ ──> [顶部吸顶单行 Todo 栏] (唯一状态投影)    │
│    • [✓] 1. 调研架构规范   (@Researcher 完成 · 45s)    │
│    • [▶] 2. 重构组件与图标 (@Coder 正在执行 · 1.2m)    │
│    • [ ] 3. 运行测试验收   (@Reviewer 待办)            │
└───────────────────────────┬────────────────────────────┘
                            │ 当前活跃项驱动
                            ▼
┌────────────────────────────────────────────────────────┐
│ 3. 怎么做？ ──> [主会话极简单行 ToolRow] (微观工具调用)  │
│    >_ bash · npm test   |   [edit] basic-tool-v2.tsx   │
└────────────────────────────────────────────────────────┘
```

### 2. 架构层：单一可信源（Single Source of Truth）

- 彻底废除 `session_todo` 与双轨仲裁函数 `pickProgressTodos`。
- 在 `packages/core/src/session/plan.ts` 建立统一的 **`SessionPlan`** 聚合根：

  ```ts
  export interface SessionPlan {
    readonly sessionID: string
    readonly revision: number // 严格递增版本号
    readonly summary?: string // 阶段总目标
    readonly items: readonly PlanItem[] // 统一的检查项列表
  }

  export interface PlanItem {
    readonly id: string
    readonly content: string
    readonly assignedAgent?: string // 绑定的智能体角色 (如 Coder, Researcher)
    readonly status: "pending" | "in_progress" | "completed" | "failed"
    readonly durationMs?: number
  }
  ```

- SSE 仅下发原子事件 `session.plan.updated`，前端 Store 只维持唯一一份 `data.session_plan[sessionID]`。

### 3. 空间与位置层：彻底收敛为 4 个明确区域

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ ❶ 顶部常驻栏 (Sticky Plan Bar, 28px 吸顶):                               │
│    [checklist] 2/3 步 · 当前: @Coder 正在重构 BasicToolV2 ⏱️ 1.2m [展开 ⌄]│
└─────────────────────────────────────────────────────────────────────────┘
                                     │ 点击展开全量步骤清单
┌─────────────────────────────────────────────────────────────────────────┐
│ ❷ 会话主视窗 (Timeline, 去卡片化的极简纯净流):                           │
│    • 用户 Prompt (带 @Coder 标记)                                       │
│    • 模型深度思考 (单行折叠: 已思考 3.4s)                                │
│    • 单行时序检查点: ─── ⏱️ @Coder 开始接手步骤 2 ───                    │
│    • 单行极简 ToolRow: >_ bash ...  /  [edit] file.ts (+18 -4)          │
│    • Markdown 回复正文 (纯文本流，无外框气泡)                            │
└─────────────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────────┐
│ ❸ 输入框浮动弹窗 (Input Popover, 输入 @ 或点击图标唤起):                │
│    ┌──────────────────────────────────────────────────────────────┐     │
│    │ 🗺️ 智能体地图 (Agent Map):                                    │     │
│    │  [Lead] ───> [Researcher] ───> [Coder (当前)] ───> [Reviewer] │     │
│    │  (统筹)       (文档/代码检索)   (编辑与终端执行)     (测试与审查)│     │
│    │  *点击任一节点，一键挂载到输入框                                │     │
│    └──────────────────────────────────────────────────────────────┘     │
│ ❹ 纯净输入框 (Composer Input Box):                                       │
│    [ 🤖 @Coder ] 输入指令或补充要求...                      [发送 Enter] │
└─────────────────────────────────────────────────────────────────────────┘
```

1. **【彻底移除】底部输入框抽屉（`SessionTodoDock`）**：把完整高度与垂直视野交还给聊天流与输入框，打字永不被遮挡。
2. **【唯一常驻】顶部 28px 吸顶状态带**：空任务时不占空间，有任务时吸顶展示 `当前 Agent · 当前任务 · 耗时`，点击浮出完整清单。
3. **【流内记录】极简单行 Checkpoint**：任务流转时只输出一条单行细线（`─── ⏱️ [2/3] @Coder 重构组件 ───`），杜绝重复大卡片刷屏。
4. **【输入交互】无失焦 Agent Map 弹窗**：输入 `@` 唤出智能体角色网格与能力拓扑，点击即完成分派。
5. **【辅助面板】右侧抽屉（Auxiliary Pane）**：长篇实施计划（Plan）、宏观拓扑图（Vis.js/Mermaid）、文件 Diff 审查统一收纳于右侧抽屉，按需拉开，不扰正文。

---

---

## 七、 实施推进步骤规划

1. **Phase 1: 图标与单行 ToolRow 落地**
   - 补齐 `packages/ui/src/v2/components/icon.tsx` 专属 SVG。
   - 重构 `BasicToolV2`，支持 DeepSeek-Harness 风格的 `DisclosureRow` 单行折叠。
2. **Phase 2: Todo 状态统一与数据源收敛**
   - 废除 `session_todo`，删除 `pickProgressTodos`。
   - 移除 `SessionTodoDock`（底部抽屉）与流内冗余卡片，改造为顶部 28px 吸顶 `SessionTodoProgress`。
3. **Phase 3: 输入框 Agent Map 弹窗与指派接线**
   - 在 `packages/app/src/components/prompt-input` 引入无失焦 Combobox 浮层，展示子智能体拓扑与当前任务关联。
4. **Phase 4: Ask 提问与决策门禁（Human-in-the-loop Gate）统一重构**
   - 淘汰 `bubble-5` 气泡卡片，统一收拢为 `<Icon name="help" />` 单行 `QuestionToolRow`。
   - 实现**流内原生快捷胶囊（单选题）**与**输入框工位接管（复杂问卷/Plan审批）**双模交互，消灭底部多层 Dock 堆叠。

---

## 八、 Ask（提问、确认与决策门禁）机制全维度调研与重构方案

### 1. 业界标杆智能体 Ask 机制横向深度剖析

| 维度 / 系统                 | **Google Antigravity (`ask_question`)**                    | **DeepSeek-Harness (`QuestionComposer` / `PlanReview`)**                      | **Claude Code (CLI Ask / Confirm)**            | **AigcForge 现状痛点**                                                 |
| :-------------------------- | :--------------------------------------------------------- | :---------------------------------------------------------------------------- | :--------------------------------------------- | :--------------------------------------------------------------------- |
| **底层协议与契约**          | `questions: Array<{ question, options, is_multi_select }>` | `PendingQuestion` + `planReviewOf` 语义分流                                   | 终端原生分级问答 (Numbered Options + Freeform) | `QuestionV2.Request` (`questions: Info[]`)                             |
| **执行挂起机制**            | 异步 Deferred 闭锁，零 token 挂起 Fiber                    | Session-scoped Slot Store，草稿防丢，RPC/Event 双通道                         | 进程原生 stdin 阻塞等待                        | `Effect.Deferred` 挂起，逻辑完备但前端映射混乱                         |
| **分流与语义识别**          | 统一选项表单，首项约定 `(Recommended)`                     | **双轨分流**：区分 **计划审批（PlanReview）** 与 **常规提问（QuestionFlow）** | 单键确认（Enter 走推荐，数字键选分支）         | 无分流，计划/权限/提问分散在 4 个互相割裂的 Dock 中                    |
| **会话流留存 (Transcript)** | 提交后原地坍缩为极简单行记录                               | **单行 `QuestionToolRow`**：运行中带呼吸效果，完成后展开为无框 `<dl>` 键值对  | 终端历史平铺，无额外装饰外框                   | **严重违规**：流内塞入庞大 `BasicTool` 卡片 + 老旧 `bubble-5` 气泡图标 |
| **操作交互位置**            | 流内内联交互 / 紧随最新中断处                              | **接管输入框工位（Composer Seat Takeover）**                                  | 终端当前光标行                                 | **焦点撕裂**：流内转圈卡片，操作 Dock 却出现在屏幕最底端               |

---

### 2. 标杆系统的核心精华与高雅设计

#### (1) DeepSeek-Harness：双轨分流与输入框工位接管（Composer Seat Takeover）

- **语义分流**：源码 `packages/client/ui-user-questions/src/client/QuestionComposer.tsx:140`
  ```tsx
  export function QuestionComposer(props: QuestionComposerProps) {
    const question = props.matched
    const review = useMemo(() => planReviewOf(question.questions), [question])
    return review === undefined
      ? <QuestionFlow pending={question} ... />
      : <PlanReviewPanel pending={question} review={review} ... />
  }
  ```
  如果检测到问题是**方案/计划审查**，直接渲染为带 `[Discuss 讨论]` 和 `[Approve 批准]` 的专属审批卡，并将完整实施文档无缝送入右侧抽屉；如果是普通业务问题，则进入表单流。
- **工位接管而非层叠堆砌**：
  不额外在界面上“贴创可贴”式地堆叠弹窗或 Dock，而是**将底部的输入框区域（Composer Seat）临时无缝替换为问题作答卡**。作答完毕后，工位立刻释放恢复为正常输入框。
- **流内极简 `QuestionToolRow`**：
  在主消息流中，提问仅占 1 行：
  - 待作答：`<IconQuestionOutlineRegular /> ask_user_question · 架构选型待确认 [?] 去回答`（带呼吸光效）。
  - 已作答：只读展示，点击展开极简定义列表 `<dl>`，灰色轻量字，彻底抛弃气泡。

#### (2) Google Antigravity：键盘优先与推荐约定

- **`(Recommended)` 约定**：首选推荐项自动添加快捷回车标签 `(Enter 提交)`，用户无需摸鼠标，一键即可继续。
- **内置自定义补充**：任何单选/多选默认附带自填输入项，用户既能点选预设，也能直接键入补充意图。

---

### 3. AigcForge 现状核心痛点剖析（为什么 Ask 交互必须重构？）

1. **“流内卡片”与“底部 Dock”双重渲染，视线严重割裂**：
   - 消息流正在输出，智能体遇到疑问时停止；
   - 此时消息流最新一行出现了一个带有老旧气泡图标（`bubble-5`）的厚重 `BasicTool` 卡片，正在加载转圈；
   - 但真正的选择项却出现在距离视线极远的屏幕最底部（`SessionQuestionDock`）；
   - 用户视线必须从流中央猛然跳到屏幕底端，作答后又跳回流中央，极为割裂。
2. **多层 Dock 堆叠，吞噬 50% 视口高度**：
   - `session-composer-region.tsx` 中并存：
     `SessionQuestionDock` + `SessionPermissionDock` + `SessionRevertDock` + `SessionTodoDock` + `SessionComposer`。
   - 当任务进行、提问触发、同时伴随权限确认时，底部堆叠厚度极其惊人，正文区域被严重挤压。
3. **概念未统一：提问、权限、计划审批各自为战**：
   - 本质上，它们都是 **“人机回环仲裁点（Human-in-the-loop Gate）”**，但现有实现分散在三套独立体系中，UI 各写一套，逻辑完全碎片化。

---

### 4. AigcForge 最优且逻辑最简的 Ask 重构方案

#### A. 架构层：统一门禁（Decision Gate）

后端保持 `packages/core/src/question.ts` 优雅强大的 Effect Deferred 机制，在类型层提供语义分类：

```ts
export type GateKind =
  | "clarify" // 常规提问 (单选/多选/填空)
  | "plan_review" // 计划与规划审批 (讨论/批准)
  | "permission" // 敏感工具与终端权限 (允许/拒绝/单次/永久)
```

所有暂停执行的人机协作决策，全部统一走相同的事件通道（`question.v2.asked` ➔ `replied` / `rejected`），彻底消灭散落的特殊逻辑。

#### B. 空间与位置策略（Placement Strategy）：视线一致性双模驱动

```text
【模式 A：快速单选/二选一（占 80% 场景）】
 ──> 流内原地内联交互（In-Stream Inline Row，视线 0 偏移）

   [help] 提问: 代码规范采用何种方案?
   [ 1. ESLint + Prettier (Enter 推荐) ]  [ 2. Biome 极速版 ]  [ ✎ 其它输入... ]
   * 用户直接按键盘数字 1 或敲 Enter，立即提交继续，根本不需要看底部！

【模式 B：多题问卷 / 计划审批（复杂场景）】
 ──> 输入框工位接管（Composer Seat Takeover，视口 0 膨胀）

   • 流内仅占单行：[help] 智能体发起方案规划审批 ── ⇣ [定位至输入区审批]
   • 屏幕底部：Composer 输入框临时平滑变形为 PlanReview 审批卡：
     ┌────────────────────────────────────────────────────────┐
     │ 📋 实施计划审批 (共 3 个阶段)                 [查看文档 ↗] │
     │ 当前提议：重构 BasicToolV2 并接入统一图标库             │
     │ [ 💬 补充修改要求 (Esc) ]            [ ✓ 批准并继续 (Enter) ] │
     └────────────────────────────────────────────────────────┘
   • 审批或取消后，输入区瞬间无缝还原为常规输入框，绝不向上堆叠任何 Dock！
```

#### C. UI 视觉规范（严格遵循零气泡与统一图标）

1. **专属统一 Icon**：
   - 彻底删除 `bubble-5` 气泡图标引用。
   - 统一引用 `packages/ui/src/v2/components/icon.tsx`：
     - 常规提问：`<Icon name="help" />`
     - 权限审批：`<Icon name="shield" />` / `<Icon name="lock" />`
     - 计划审批：`<Icon name="checklist" />`
2. **零气泡单行态（Zero-bubble Row）**：
   - **待作答**：`[help] 架构提问: 状态层选型? · 等待选择 [1. Effect (推荐)] [2. Zustand]`（带微微呼吸光感）。
   - **已回答**：`[help] 架构提问: 状态层选型 · 已选择: Effect ⌄`（点击展开仅为极简无边框 `<dl>` 键值对）。
3. **键盘首选（Keyboard-First）**：
   - 数字键 `1`~`9` 映射选项。
   - `Enter` 默认提交推荐项或当前选中项。
   - `Esc` 拒绝/取消当前提问。
