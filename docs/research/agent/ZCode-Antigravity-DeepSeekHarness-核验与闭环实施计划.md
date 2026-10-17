# 智能体交互调研核验与闭环实施计划

> 审查日期：2026-09-30。性质：**证据核验 + 待批准实施计划，不是已完成的产品改造**。
> 原文：[ZCode / Antigravity / DeepSeek-Harness 调研](/home/keer/workspace/aigcfroge/docs/research/agent/ZCode-Antigravity-DeepSeekHarness智能体交互与UI体系深度调研.md)。
> 机器可核对证据：[基线、逐项主张、文件哈希、命令及测试结果](/home/keer/workspace/aigcfroge/docs/research/agent/agent-ui-audit-evidence-2026-09-30.json)。

## 1. 结论先行

**原文是“真实调研片段 + 未证实的竞品叙述 + 误读/过时的本项目现状 + 尚未闭环的架构建议”的混合稿，不能直接作为实施基线。**

这不是对作者动机的判定，也不能简单给出“全真/全假”或虚构准确率。对话能证明文件如何形成，不能证明每个结论正确。

可以保留的方向：统一图标、紧凑工具记录、任务当前态与历史记录分工、计划资源侧栏、按需展示 Agent 关系、减少同时可操作的待决表单。

必须纠正的五个实施前提：

1. **不新建 SessionPlan 来替换 SessionTask。** 任务持久化真源已统一；需要处理的是呈现、兼容与具体缺口。
2. **不把 PermissionV2 合并进 QuestionV2。** 统一待决事项的界面协调，保留授权、问题和评审各自的业务权威。
3. **不把删除 SessionTodoDock 当作新的布局收益。** 它已无挂载，删除残留文件只是清理。
4. **不只改 BasicToolV2 的故事组件。** 生产消息流走 BasicTool；而它当前甚至不消费 icon 参数。
5. **不再从零设计 Plan Review。** 已有获批 WorkReview 状态机与 revision 规则；真正未完成的是 producer、持久化读写和真实 E4 生命线。

**推荐路线：复用现有领域能力，补齐薄而完整的端到端切片。** “完美闭环”不能预先保证；可承诺的执行标准是：每条需求都有真实 owner、验收证据、错误/恢复路径、回退办法和未决项负责人，没有以“界面看起来完成”替代业务完成。

## 2. 审查基线、来源与边界

### 2.1 以哪个仓库为准

- 指定仓库：`/home/keer/workspace/aigcfroge`，分支 `local-cli-discovery`，HEAD `260e8275b9b0af9d0b445e5acfb6f4d3545eac7b`。
- 聊天默认目录：`/media/win_data/aigcfroge`，HEAD `06872530fa13c17a14fbc60160df27a03f3646be`。两者不是同一 checkout 基线。
- 审查开始时两处待审原文 SHA-256 相同：`cbd3af39724ec1682eeb9bb29c1f355b1b3c18457a7a37cf016084a6d80ec3a4`。CLAUDE/AGENTS 相同，ARCHITECTURE 和代码状态不同。
- 指定仓库包含他人已有 staged/unstaged 修改；本次保留，不切分支、不清理、不提交、不覆盖原文。证据基于**工作树内容**，不能仅靠 HEAD 重现，关键源文件哈希已另存。
- DeepSeek-Harness 参考：本地 `master@639ed015397290b3745d163aafe02ffee4aa3f84`，工作树有 5 项修改；抽查的 README、TodoPanel、QuestionComposer、trigger 类型未被修改。结论限定于该本地源码快照，不冒充全部已发布版本或实际运行版本。

**交付前基线变化**：指定工作区 HEAD 已推进到 `e23b4561cb96162d352e1093b719894d11333686`（`local-cli-discovery`），原文由 305 行格式化为 323 行，SHA-256 变为 `3ac362c8e8290c033825d464ede7b8a1a84e26ea0ef7f5b127e16b74012a1579`。排除空白与 Markdown 表格分隔线宽度后全文一致，关键代码文件哈希未变，因此无需重判本报告结论；原文定位已更新到交付时行号。原始快照哈希、旧行号及当前快照另存于证据 JSON。本次没有执行提交，也没有覆盖这些外部改动。

### 2.2 对话历史的证据链

日志共有 **1186 条 JSONL 记录**，时间覆盖 `2026-09-29T13:27:34Z` 至 `2026-09-30T03:05:18Z`；SHA-256 为 `fe2a31b24493947f27a9b38192326bce4659561ac083e8398958d1935471f994`。下文 L 指 JSONL **物理行号**，不是 step_index。

- L811、L813：用户明确偏好简洁、专属 Icon、统一组件；这是产品偏好来源，不是“所有卡片均违反 DESIGN”的规则。
- L1021：用户要求先架构、再逻辑与位置、最后 UI；原文最终步骤却从图标开始，应纠正实施依赖顺序。
- L1065–L1075：Claude Code 相关证据主要是本地设置/团队配置；无法由此推出原生 Agent Map 的具体 UI。
- L1084、L1086：调研产物被写入 brain，再复制到两个仓库；L1152、L1154 追加 Ask 章节后再次同步。文件存在与副本一致的来源可追溯。
- L983、L987：确实打开并截图了新生成的 **file:// HTML 预览**。因此不能说“完全没有浏览器动作”，但它不是本项目真实运行界面的验收，更不是竞品界面证据。
- 后半段调研窗口未发现包测试/typecheck/E3/E4 执行记录。此结论只针对该窗口，不否定历史前半段其他工作可能跑过验证。

审查只保存来源和必要短摘录，不复制 settings 中的凭证、完整 prompt 或用户文件正文。

### 2.3 协议与工作流约束

基于 [CLAUDE](/home/keer/workspace/aigcfroge/CLAUDE.md:107)、[AGENTS](/home/keer/workspace/aigcfroge/AGENTS.md)、[架构](/home/keer/workspace/aigcfroge/ARCHITECTURE.md:121)、[运行时语义](/home/keer/workspace/aigcfroge/CONTEXT.md:94)、[设计](/home/keer/workspace/aigcfroge/DESIGN.md)、[测试](/home/keer/workspace/aigcfroge/docs/testing.md) 及相关包规范，使用 protocols、reuse-first-refactor、enterprise-code-standard、effect、database、frontend-theming、quality-to-pr 与其 end-to-end-pr 工作流。

执行时必须：复用优先；Effect v4 API 按本地实现查询；Schema/错误有 owner；SDK 用生成脚本；CSS 用 token；文案走 i18n；测试在包目录运行；跨 Session/Location 权限不弱化；UI benchmark 来自生产构建且串行运行；不擅自重启现有 App/Server。

**本次覆盖的是与被审主张有关的上下游链路，不宣称把全仓每一行代码审计完毕。** 没有运行专有竞品实现、全仓检查、完整桌面/TUI运行、E3/E4 或生产性能测试。未完成项见 §9。

## 3. 主张逐项核验

判定词：成立＝有指定基线证据；部分成立＝必须收窄表述；不成立＝被当前代码/契约直接反驳；未证实＝不足以判断真假；落地缺口＝不是可直接执行的完整方案；不接受＝建议会损害现有契约。它们不是同一种统计样本，不计算所谓“真实性百分比”。

### F01 · DeepSeek-Harness 的来源、Cordis 与“首创” — 部分成立

原文定位：[L15](/home/keer/workspace/aigcfroge/docs/research/agent/ZCode-Antigravity-DeepSeekHarness智能体交互与UI体系深度调研.md:15)。本地 README 明确自述 DeepSeek AI、Cordis 和 developer preview；它支持项目自述及本地技术栈，不构成“首创”的比较证明，也不能证明安装中的产品正运行这份源码。

证据：[README.md:5](/home/keer/Documents/web/deepseek-harness-master/README.md:5)。

### F02 · ToolRow / DisclosureRow 单行展开组件 — 成立

原文定位：[L54](/home/keer/workspace/aigcfroge/docs/research/agent/ZCode-Antigravity-DeepSeekHarness智能体交互与UI体系深度调研.md:54)。组件确实存在并组合 DisclosureRow，可借鉴呈现机制；不能把 React/Cordis 组件直接复制到 SolidJS/Kobalte。

证据：[ToolRow.tsx:121](/home/keer/Documents/web/deepseek-harness-master/packages/client/ui-tool/src/client/tool/components/ToolRow.tsx:121)；[QuestionToolRow.tsx:20](/home/keer/Documents/web/deepseek-harness-master/packages/client/ui-tool/src/client/tool/components/QuestionToolRow.tsx:20)。

### F03 · Plan 使用右侧资源面板 — 成立

原文定位：[L57](/home/keer/workspace/aigcfroge/docs/research/agent/ZCode-Antigravity-DeepSeekHarness智能体交互与UI体系深度调研.md:57)。ui-plan 明确依赖 sidebarRight 与 sidebarRightTabs，打开计划资源的接线存在。

证据：[index.ts:52](/home/keer/Documents/web/deepseek-harness-master/packages/client/ui-plan/src/client/index.ts:52)；[index.ts:74](/home/keer/Documents/web/deepseek-harness-master/packages/client/ui-plan/src/client/index.ts:74)。

### F04 · Todo 单一 projection、空列表隐藏、默认折叠 — 成立

原文定位：[L58](/home/keer/workspace/aigcfroge/docs/research/agent/ZCode-Antigravity-DeepSeekHarness智能体交互与UI体系深度调研.md:58)。TodoPanel 默认 collapsed=true、空数组返回 null；TodoDock 从 todos projection 取值。这里是展示投影，不等于所有任务域只有一类实体。

证据：[TodoPanel.tsx:65](/home/keer/Documents/web/deepseek-harness-master/packages/client/ui-conversation/src/client/skeleton/TodoPanel.tsx:65)；[TodoPanel.tsx:106](/home/keer/Documents/web/deepseek-harness-master/packages/client/ui-conversation/src/client/skeleton/TodoPanel.tsx:106)。

### F05 · DeepSeek-Harness 固定 28px Todo 条 — 不成立

原文定位：[L61](/home/keer/workspace/aigcfroge/docs/research/agent/ZCode-Antigravity-DeepSeekHarness智能体交互与UI体系深度调研.md:61)。该快照 CSS 使用上下 6px padding 与标题 24px line-height，并非固定 28px。注册位置是 conversation.input.dock；顶部吸顶是本文作者的新方案，不能借竞品位置为其背书。

证据：[TodoPanel.module.css:35](/home/keer/Documents/web/deepseek-harness-master/packages/client/ui-conversation/src/client/skeleton/TodoPanel.module.css:35)；[TodoPanel.module.css:61](/home/keer/Documents/web/deepseek-harness-master/packages/client/ui-conversation/src/client/skeleton/TodoPanel.module.css:61)；[TodoPanel.tsx:113](/home/keer/Documents/web/deepseek-harness-master/packages/client/ui-conversation/src/client/skeleton/TodoPanel.tsx:113)。

### F06 · DeepSeek-Harness 的 # 触发器 — 不成立

原文定位：[L42](/home/keer/workspace/aigcfroge/docs/research/agent/ZCode-Antigravity-DeepSeekHarness智能体交互与UI体系深度调研.md:42)。当前 TriggerChar 仅为 / 和 @，没有 #。把 PR/Issue 关联写成已实现能力缺少源码支持。

证据：[types.ts:34](/home/keer/Documents/web/deepseek-harness-master/packages/client/ui-input-trigger/src/types.ts:34)。

### F07 · 多引擎子代理、血缘与 task_result 摘要 — 部分成立

原文定位：[L79](/home/keer/workspace/aigcfroge/docs/research/agent/ZCode-Antigravity-DeepSeekHarness智能体交互与UI体系深度调研.md:79)。claude-code、codex、dsh-sdk 包及 SubagentHeaderLineage 注册存在；所检索的 subagent/UI 源码未提供文中 task_result XML 摘要规则的证据。包存在也不等于全部运行通路已验收。

证据：[package.json:1](/home/keer/Documents/web/deepseek-harness-master/packages/subagent/subagent-claude-code/package.json:1)；[package.json:1](/home/keer/Documents/web/deepseek-harness-master/packages/subagent/subagent-codex/package.json:1)；[index.ts:80](/home/keer/Documents/web/deepseek-harness-master/packages/client/ui-subagent/src/client/index.ts:80)。

### F08 · Claude Code 原生 Agent Map、textarea 无失焦、Pierre Diff — 未证实

原文定位：[L22](/home/keer/workspace/aigcfroge/docs/research/agent/ZCode-Antigravity-DeepSeekHarness智能体交互与UI体系深度调研.md:22)。历史主要读取本地 settings 和 teams 配置。实验开关及团队成员不能证明某个原生 GUI 的拓扑、焦点行为或 Diff 实现。必须补具体产品/版本/界面证据；不能直接称该能力不存在。

证据：[对话 L1065–L1075:1065](/home/keer/.gemini/antigravity/brain/fae43dc4-d3b6-4804-b938-b81f2f6cdb01/.system_generated/logs/transcript_full.jsonl:1065)。

### F09 · Antigravity 2.0、@ 上下文与拖拽 — 部分成立

原文定位：[L45](/home/keer/workspace/aigcfroge/docs/research/agent/ZCode-Antigravity-DeepSeekHarness智能体交互与UI体系深度调研.md:45)。随安装提供的指南支持独立桌面应用、文件/文件夹/会话/终端/MCP mentions 和媒体上传；Git 提交类别、全部面板布局和工具行为未在本次真实运行复现。

证据：[Antigravity 安装指南:1](/home/keer/.gemini/antigravity/builtin/skills/antigravity_guide/references/app.md:1)；[@ 与媒体指南:28](/home/keer/.gemini/antigravity/builtin/skills/antigravity_guide/references/app.md:28)。

### F10 · Antigravity 内部 Deferred/Fiber 及 Enter 推荐项 — 未证实

原文定位：[L216](/home/keer/workspace/aigcfroge/docs/research/agent/ZCode-Antigravity-DeepSeekHarness智能体交互与UI体系深度调研.md:216)。公开的本地使用指南和原对话没有足够证据证明内部挂起实现、默认回车语义或“零 token”成本。UI 表现不能推出专有后端架构。

证据：[Ask 调研起点:1091](/home/keer/.gemini/antigravity/brain/fae43dc4-d3b6-4804-b938-b81f2f6cdb01/.system_generated/logs/transcript_full.jsonl:1091)；[权限指南:35](/home/keer/.gemini/antigravity/builtin/skills/antigravity_guide/references/app.md:35)。

### F11 · ZCode tasks / task_groups / automations 表 — 成立

原文定位：[L72](/home/keer/workspace/aigcfroge/docs/research/agent/ZCode-Antigravity-DeepSeekHarness智能体交互与UI体系深度调研.md:72)。对 tasks-index.sqlite 以 mode=ro 查询 sqlite_master，三表及其他相关表存在。只验证 schema；tasks 的会话级元数据不能自动等同会话内 Todo 步骤树。

证据：[只读 SQLite schema](/home/keer/.zcode/v2/tasks-index.sqlite)。

### F12 · messageStreamShowTodos 自动静默 — 未证实

原文定位：[L73](/home/keer/workspace/aigcfroge/docs/research/agent/ZCode-Antigravity-DeepSeekHarness智能体交互与UI体系深度调研.md:73)。未独立验证该配置读取链和完成后的真实渲染行为。即便键存在，键名或布尔值也不能证明折叠时机和自动静默。

证据：[历史配置读取:899](/home/keer/.gemini/antigravity/brain/fae43dc4-d3b6-4804-b938-b81f2f6cdb01/.system_generated/logs/transcript_full.jsonl:899)。

### F13 · 后端存在 Todo / Task 两套可信源 — 不成立

原文定位：[L100](/home/keer/workspace/aigcfroge/docs/research/agent/ZCode-Antigravity-DeepSeekHarness智能体交互与UI体系深度调研.md:100)。SessionTodo.update/get 委托 SessionTask；publishBoth 从同一 tasks 结果派生 todo.updated。现状是一个持久化任务域加兼容投影，不是两个独立任务数据库。

证据：[SessionTodo.update:92](/home/keer/workspace/aigcfroge/packages/core/src/session/todo.ts:92)；[SessionTodo.get:118](/home/keer/workspace/aigcfroge/packages/core/src/session/todo.ts:118)；[publishBoth:426](/home/keer/workspace/aigcfroge/packages/core/src/session/task.ts:426)。

### F14 · pickProgressTodos 每次只靠时间戳猜 — 部分成立

原文定位：[L101](/home/keer/workspace/aigcfroge/docs/research/agent/ZCode-Antigravity-DeepSeekHarness智能体交互与UI体系深度调研.md:101)。不同内容确实按客户端接收时间仲裁；但先比较 sameTodoList，相同投影优先保留带 id/revision 的 Task。旧流清空列表等兼容行为已有测试，不可无替代删除。

证据：[sameTodoList:266](/home/keer/workspace/aigcfroge/packages/app/src/pages/session/timeline/session-todo-progress-model.ts:266)；[pickProgressTodos:293](/home/keer/workspace/aigcfroge/packages/app/src/pages/session/timeline/session-todo-progress-model.ts:293)；[兼容测试:246](/home/keer/workspace/aigcfroge/packages/app/src/pages/session/timeline/session-todo-progress-model.test.ts:246)。

### F15 · 顶部、底部 TodoDock、流内三处正在同时显示 — 不成立

原文定位：[L95](/home/keer/workspace/aigcfroge/docs/research/agent/ZCode-Antigravity-DeepSeekHarness智能体交互与UI体系深度调研.md:95)。SessionTodoDock 在 app 源码只剩定义，无导入或挂载；旧升级计划已记录删除挂载。当前可核验的是顶部任务进度与流内 todowrite 历史清单并存，不是三处。

证据：[实际挂载:220](/home/keer/workspace/aigcfroge/packages/app/src/pages/session/composer/session-composer-region.tsx:220)；[既有升级记录:242](/home/keer/workspace/aigcfroge/docs/plan/todo-task-system-upgrade.md:242)；[todowrite renderer:2467](/home/keer/workspace/aigcfroge/packages/session-ui/src/components/message-part.tsx:2467)。

### F16 · Agent 与 Todo 在数据上完全脱节 — 不成立

原文定位：[L102](/home/keer/workspace/aigcfroge/docs/research/agent/ZCode-Antigravity-DeepSeekHarness智能体交互与UI体系深度调研.md:102)。任务 schema 已有 agentID、parentID、spawnedFrom、dependsOn；task 工具有 parent_task_id 及自动创建/结算回写。UI 可改善，但不能把已有关系当作待新建。

证据：[SessionTask.Info:39](/home/keer/workspace/aigcfroge/packages/schema/src/session-task.ts:39)；[任务链接与结算:666](/home/keer/workspace/aigcfroge/packages/core/src/tool/task.ts:666)。

### F17 · Agent Map 必须从零建设输入指派通道 — 部分成立

原文定位：[L204](/home/keer/workspace/aigcfroge/docs/research/agent/ZCode-Antigravity-DeepSeekHarness智能体交互与UI体系深度调研.md:204)。没有证据支持完整可视化 Map 已存在，但 @ 候选、agent pill、结构化 agent request part 都已存在。地图应扩展选择与观察，不另建发送/执行路径。

证据：[agentList / handleAtSelect:675](/home/keer/workspace/aigcfroge/packages/app/src/components/prompt-input.tsx:675)；[agent request part:120](/home/keer/workspace/aigcfroge/packages/app/src/components/prompt-input/build-request-parts.ts:120)。

### F18 · question 的旧 bubble-5 参数就是页面气泡图标 — 部分成立

原文定位：[L257](/home/keer/workspace/aigcfroge/docs/research/agent/ZCode-Antigravity-DeepSeekHarness智能体交互与UI体系深度调研.md:257)。参数确实在 question renderer 与 getToolInfo 存在；当前 BasicTool 的 trigger 不消费 icon prop。不能由参数字面量断言该卡片正在显示旧图标，也不能据此断言所有其他路径都不显示它。厚重程度需真实 DOM/截图证据。

证据：[question 参数:2541](/home/keer/workspace/aigcfroge/packages/session-ui/src/components/message-part.tsx:2541)；[真实 trigger:182](/home/keer/workspace/aigcfroge/packages/session-ui/src/components/basic-tool.tsx:182)；[另一图标映射:496](/home/keer/workspace/aigcfroge/packages/session-ui/src/components/message-part.tsx:496)。

### F19 · 五层 Dock 同堆并吞噬 50% 视口 — 不成立

原文定位：[L262](/home/keer/workspace/aigcfroge/docs/research/agent/ZCode-Antigravity-DeepSeekHarness智能体交互与UI体系深度调研.md:262)。TodoDock 不挂载；blocked 时普通 Composer 不渲染，Revert/Followup 位于其分支内。Question 与 Permission 两个 Show 独立，二者可同现才是可检查的协调缺口；50% 未测量。

证据：[blocked:34](/home/keer/workspace/aigcfroge/packages/app/src/pages/session/composer/session-composer-state.ts:34)；[showComposer:167](/home/keer/workspace/aigcfroge/packages/app/src/pages/session/composer/session-composer-region.tsx:167)；[两个请求 Show:220](/home/keer/workspace/aigcfroge/packages/app/src/pages/session/composer/session-composer-region.tsx:220)。

### F20 · QuestionV2 使用 Deferred 挂起 — 成立

原文定位：[L219](/home/keer/workspace/aigcfroge/docs/research/agent/ZCode-Antigravity-DeepSeekHarness智能体交互与UI体系深度调研.md:219)。ask/reply/reject 的 Deferred 机制可核验；pending 是 Location 服务内 Map，不是重启可恢复的 durable workflow。Scope finalizer 会拒绝等待者。

证据：[QuestionV2.layer:122](/home/keer/workspace/aigcfroge/packages/core/src/question.ts:122)。

### F21 · 改 BasicToolV2 就能改变生产消息流 — 落地缺口

原文定位：[L198](/home/keer/workspace/aigcfroge/docs/research/agent/ZCode-Antigravity-DeepSeekHarness智能体交互与UI体系深度调研.md:198)。生产 message-part 导入 BasicTool；BasicToolV2 的源码消费者仅故事展示。必须明确真实渲染 owner 的接线及契约迁移，否则只完成预览。

证据：[生产导入:37](/home/keer/workspace/aigcfroge/packages/session-ui/src/components/message-part.tsx:37)；[展示组件:47](/home/keer/workspace/aigcfroge/packages/session-ui/src/v2/components/basic-tool-v2.tsx:47)。

### F22 · 四模式就是全模式 — 不成立

原文定位：[L4](/home/keer/workspace/aigcfroge/docs/research/agent/ZCode-Antigravity-DeepSeekHarness智能体交互与UI体系深度调研.md:4)。ProductMode 和 UI registry 有 chat/coding/work/assistant/custom 五种；不得遗漏 Assistant，也不得在 Custom 自动开放后台委派。

证据：[ProductMode.ID:5](/home/keer/workspace/aigcfroge/packages/schema/src/product-mode.ts:5)；[MODE_DEFINITIONS:7](/home/keer/workspace/aigcfroge/packages/app/src/context/mode.tsx:7)；[Custom gate:321](/home/keer/workspace/aigcfroge/packages/core/src/tool/task.ts:321)。

### F23 · v2 help / shield / lock / checklist 可以直接引用 — 落地缺口

原文定位：[L311](/home/keer/workspace/aigcfroge/docs/research/agent/ZCode-Antigravity-DeepSeekHarness智能体交互与UI体系深度调研.md:311)。help 已有；当前字典没有其余三个名称，未知名会回退 plus。应补字典与实际消费接线，不能仅写 name 字符串或新增 npm 图标库。

证据：[help:16](/home/keer/workspace/aigcfroge/packages/ui/src/v2/components/icon.tsx:16)；[未知图标回退:126](/home/keer/workspace/aigcfroge/packages/ui/src/v2/components/icon.tsx:126)。

### F24 · 新建四态 SessionPlan 并废除现有任务协议 — 不接受

原文定位：[L133](/home/keer/workspace/aigcfroge/docs/research/agent/ZCode-Antigravity-DeepSeekHarness智能体交互与UI体系深度调研.md:133)。新增平行聚合遗漏 cancelled/scheduled、DAG、调度、已有 agentID/revision/写回和兼容消费链。UI 层收敛不能以丢失持久化语义为代价。

证据：[六态:14](/home/keer/workspace/aigcfroge/packages/schema/src/session-task.ts:14)；[完整任务契约:39](/home/keer/workspace/aigcfroge/packages/schema/src/session-task.ts:39)；[replaceLegacy:833](/home/keer/workspace/aigcfroge/packages/core/src/session/task.ts:833)。

### F25 · 权限一律并入 question.v2.\* — 不接受

原文定位：[L273](/home/keer/workspace/aigcfroge/docs/research/agent/ZCode-Antigravity-DeepSeekHarness智能体交互与UI体系深度调研.md:273)。PermissionV2 包含动作/资源、规则、作用域授权、单次消费、持久化 always 和拒绝传播。Question 的字符串答案不能替代授权。可以统一展示仲裁，不可统一吞掉领域协议。

证据：[consultGrant:173](/home/keer/workspace/aigcfroge/packages/core/src/permission.ts:173)；[PermissionV2.reply:338](/home/keer/workspace/aigcfroge/packages/core/src/permission.ts:338)；[replyPermission:175](/home/keer/workspace/aigcfroge/packages/app/src/context/global-sync/permission-pending.ts:175)；[decidePermission:191](/home/keer/workspace/aigcfroge/packages/app/src/context/global-sync/permission-pending.ts:191)。

### F26 · 计划审批只缺一张 UI 卡 — 落地缺口

原文定位：[L296](/home/keer/workspace/aigcfroge/docs/research/agent/ZCode-Antigravity-DeepSeekHarness智能体交互与UI体系深度调研.md:296)。仓库已有获批 WorkReview schema、纯状态机与 revision 校验；producer、metadata 写入/读回和 E4 生命线仍待接通。不能再造 Gate 后绕过它，也不能把纯函数测试算作生产闭环。

证据：[仍待 producer:8](/home/keer/workspace/aigcfroge/packages/core/src/session/work-review.ts:8)；[transition:59](/home/keer/workspace/aigcfroge/packages/core/src/session/work-review.ts:59)；[isVerdictCurrent:97](/home/keer/workspace/aigcfroge/packages/core/src/session/work-review.ts:97)；[已批准与未交付边界:85](/home/keer/workspace/aigcfroge/docs/plan/s9a-work-review-lifecycle-contract.md:85)。

### F27 · 80% 快速单选、Enter 默认批准、Esc 默认拒绝 — 未证实

原文定位：[L289](/home/keer/workspace/aigcfroge/docs/research/agent/ZCode-Antigravity-DeepSeekHarness智能体交互与UI体系深度调研.md:289)。80% 无埋点依据；快捷键是待评审交互，不是可靠的竞品事实。自动批准尤其不能套用敏感权限/计划；IME、编辑、弹层关闭与显式拒绝必须分开。

证据：[键盘与可访问性约束:89](/home/keer/workspace/aigcfroge/DESIGN.md:89)；[授权结果的真实影响:338](/home/keer/workspace/aigcfroge/packages/core/src/permission.ts:338)。

## 4. 根因收敛：不是“大统一模型”，而是分清三种关系

### 4.1 持久化事实不等于前端投影

现有任务链是：

`LLM 工具 / HTTP / scheduler → SessionTask → TaskTable → task.updated + todo.updated兼容投影 → server/SSE/SDK → App reducer/store → 顶部当前态、Agent Hub、TUI`

`SessionTodo` 是兼容入口；`task.updated` 与 `todo.updated` 是同一结果的不同形状。关系由 [publishBoth](/home/keer/workspace/aigcfroge/packages/core/src/session/task.ts:426) 决定，而不是由两个 store 字段名称决定。`publishBoth` 是两次顺序发布，不能误称跨两个事件的原子事务；若要强化重放顺序，要以实际可复现的失败推动设计，不能靠更换事件名声称已解决。

[SessionTask.Info](/home/keer/workspace/aigcfroge/packages/schema/src/session-task.ts:39) 承载稳定身份、六态、优先级、父子关系、agentID、调度、DAG、摘要和 revision。删除它换四态 Plan 会破坏下游，不是“减法”。

### 4.2 Agent 定义不等于运行实例，也不等于审批权

`Agent catalog → @选择/结构化 part → 既有 prompt admission → task/Delegation → child Session/外部 thread → 结算写回 → Hub/时间线`

- Agent 的名字/描述表达能力目录；“运行中”必须来自某个具体 Session/Participant/Task，不能把一个 Agent 名下多次运行压成单一 Busy。
- `@` 选择不能绕过已有发送、权限、Custom snapshot 与委派协议。原文的固定 Lead→Researcher→Coder→Reviewer 只能是示意图，不能成为自动创建的真实组织。
- [task 的链接/结算](/home/keer/workspace/aigcfroge/packages/core/src/tool/task.ts:666) 已经存在；[Custom gate](/home/keer/workspace/aigcfroge/packages/core/src/tool/task.ts:321) 禁止的后台委派不能因为“全模式通用 Map”而放开。
- [ADR-22](/home/keer/workspace/aigcfroge/docs/architecture/adr/ADR-22-meta-agent-persistent-delegation.md) 的 Delegation/Participant/Turn 身份与能力必须保留。图形库不是补齐这些关系的替代品。

### 4.3 统一界面不等于统一授权与恢复语义

- Question：请求/答案/拒绝，Deferred + process-local pending。
- Permission：动作、资源、规则、grant scope、一次消费、授权保存、拒绝传播、ApprovalPresence。
- WorkReview：artifact revision 绑定的评审生命周期；已经有纯状态机，仍欠生产写入与读取。
- Revert / queued follow-up：编辑历史与交付控制，不是授权，也不能硬塞到 GateKind。

[decidePermission](/home/keer/workspace/aigcfroge/packages/app/src/context/global-sync/permission-pending.ts:191) 与 [replyPermission](/home/keer/workspace/aigcfroge/packages/app/src/context/global-sync/permission-pending.ts:175) 才决定实际发往哪个授权端点。普通问题回复由 [withOwnedQuestion](/home/keer/workspace/aigcfroge/packages/server/src/handlers/question.ts:14) 校验 session/request 归属。统一 UI 必须保留这些边界。

[ApprovalCenter](/home/keer/workspace/aigcfroge/packages/app/src/components/approval-center.tsx:40) 是离开会话页后仍可回答权限的既有入口。不能只留 Composer 内的一张卡，导致 `/mode/:mode` 页有 responder 但看不到问题。

## 5. 目标方案与技术债取舍

### 5.1 两条路线对比

**简单实现：只换图标、把历史卡片默认折叠。** 改动小、容易回退，能改善密度；但不能宣称解决并发 Gate、跨重启评审、运行实例身份或版本兼容。若先发布，必须登记这些技术债并明确只是视觉切片。

**推荐的健壮方案：保留现有领域 owner，逐层补齐缺失的协调与持久化生产链。** 复用 Task、Question、Permission、WorkReview、@、Hub、侧栏和 SDK；仅在确有缺口处增量补行为。成本比纯 CSS 高，但不背上第二套 Task/Plan/Permission 模型的长期维护债。

本计划选择第二条。**保留 V1 投影属于有退出条件的兼容债，不是隐藏的第二真源。** 不为“界面干净”强删它。

### 5.2 必须冻结的产品契约

1. **当前态 / 历史态分工**：顶部是当前任务唯一主要操作入口；流内是当次工具调用的只读历史，不能用当前 store 回写过去的记录。侧栏按需展示长计划、Diff 与运行关系。
2. **空状态**：没有任务时不显示任务栏；模型执行但无任务时，既有“正在工作”状态仍要有位置。不可把隐藏 Todo 等同隐藏整个执行状态。
3. **Agent 选择**：先复用 `handleAtSelect` 插入既有 agent part，不因点击拓扑节点直接发送 prompt/启动执行。实时拓扑只展示真实关系；不可用名称猜测关联，未知能力显示未知/不可操作。
4. **待决表单**：同一请求只有一份提交状态；稳定键包含 server/Location、session、domain、requestID。可保留全局发现入口，但不能双写同一决定。当前交互不被新请求抢走；队列优先级由产品在 P0 批准，不靠数组偶然顺序。
5. **焦点与快捷键**：数字键只在已激活的题目控件内生效；IME composing、正常输入、快捷命令不被抢占。Enter 只提交明确选中的答案；权限/评审不默认授予批准。Esc 先关闭浮层，不等同拒绝任务；拒绝是显式操作。
6. **重载/重启**：页面刷新重取 pending；服务重启不把旧 requestID 重新当作活请求，不自动重试 provider 工作。持久化评审状态恢复与运行 fiber 恢复是两件事。
7. **模式**：共享展示能力，分别保留五模式的可用性、Agent allowlist 和交付语义。Assistant 纳入回归，但不借本任务扩大此前未批准的 Assistant M2 业务范围。
8. **尺寸与可访问性**：28px 只能是待批准的视觉目标，不是硬编码验收口号；由 token、触达区域、缩放、长文案和窄屏验证决定。保留焦点可见、可读状态和 reduced-motion。

## 6. 可执行实施计划

顺序：**P0 → P1/P2 → P3 → P4 → P5 → P6**。P1/P2 仅在写入集合不重叠且各自契约冻结后可并行。P5 的 WorkReview 生产契约设计可提前，但不得跳过版本绑定与恢复验证。

每个阶段按“入口条件 → 有限写集 → 行为测试 → package typecheck → focused diff → 门禁证据”关闭。下面的新增能力均为待实施，不是声称当前已存在的 API。

### P0 · 证据基线和需求冻结

**负责人**：技术负责人；产品/设计、QA共同确认。

- 保留原文，把 F01–F27 的判定作为修订依据；区分竞品事实、用户偏好、设计提案。
- 冻结 code snapshot、脏工作树归属、支持的服务器/客户端版本；不能在不同 checkout 之间凭文件名实施。
- 批准三项决定：Map 是选择目录还是运行拓扑（推荐两者分区）；Plan Review 是普通确认还是有约束的审批（推荐完成获批 WorkReview，而不是新的全域 Gate）；V1 消费者退役条件。
- 建立本需求→owner→测试→证据映射；按 app 协议获取现有生产构建基准，使用既有性能场景且串行执行。
- ADR 记录“保留 Task / 分离权限 / 复用 WorkReview / UI 仲裁”的决策，引用旧 ADR，不再平行定义。

**退出**：需求和不变量获批；未知竞品行为已标记且不会阻挡本地明确的修复；没测的性能指标不写成达标。**回退**：仅文档，无运行行为变化。

### P1 · Task 真源与任务呈现

**负责人**：Core + App。**范围**：任务 schema/service/facade、app task/todo reducer、progress model、Hub、TUI兼容测试。

- 复用 SessionTask 六态/稳定 ID/每行 revision，继续走现有写 API 和 `expectedRevision`；不得用整张列表的 max revision 假装新增的全局流版本。
- 第一切片保留 `pickProgressTodos`、`sameTodoList` 与既有刷新 seed guard。只有版本支持窗口、旧事件来源和替代读取路径均明确后，才实施独立的 V1 退役切片。
- 删除证明无引用的 TodoDock 残留可单独进行；**不把它计作新功能**。把顶部当前任务与流内 todowrite 历史摘要的分工写成契约，历史展开仍能看原调用内容。
- agentID、parent_task_id、DAG、schedule、outputDigest、取消/失败和回写行为不损失；Task 与子会话的跳转用稳定身份，不能从摘要字符串猜。
- 若观察到乱序/迟到快照问题，先补可复现测试，再在现有同步 owner 修复；不得凭“可能闪烁”新增 session.plan.updated 或把接收时间包装为服务端版本。

**验收**：同内容双事件保持 Task 身份；新旧流差异和空列表清除正确；慢 GET 不覆盖已收到的 live 数据；删除/重排/并发 patch/冲突提示可恢复；失败/取消/定时任务保真；TUI仍兼容。**回退**：回退呈现切片，不删除旧事件或用户数据。

### P2 · 待决事项协调层

**负责人**：App + Permission/Core。**范围**：现有 composer state/region/request-tree、QuestionDock、PermissionDock、ApprovalCenter、question/permission SDK适配。

- 在已有 state owner 增强带来源的 UI 判别模型，不新建后端 Gate 服务。问题→原 Question endpoint；权限→原 reply/grant endpoint；WorkReview→其生产 owner。
- 仲裁当前可操作请求、同类/异类排队、子会话请求来源与“转到对应位置”；不能简单把两个数组拼起来后取第一条。
- `server/Location/session/domain/requestID` 绑定答案、草稿、submitting/error；重复点击单次发送，失败不丢选择，外部已完成/过期请求及时失效。跨客户端并发由服务端现有 owner 负责终态一致性；缺测试则先补再修，不能只靠 disable 按钮。
- 基于现有草稿 context 保存输入、附件、selection，完成/拒绝/中断后恢复；焦点恢复到仍存在的控件，不强制抢焦。
- 全局 ApprovalCenter 保持可达；scope grant、always 和 once 不混同，未具备批准能力的页面/客户端不伪造成功。

**验收**：父/子会话问题与权限同时待决时，没有不可见阻塞；同一请求不双提交；拒绝、修正反馈、自动响应筛选、离开会话页、401/404/断网重试均有结果；无敏感动作默认批准。**回退**：只撤 UI 仲裁，保持两套原领域协议可用。

### P3 · Agent 目录与真实执行拓扑

**负责人**：Agent/Core + App。**范围**：现有 @ 候选、PromptPopover、buildRequestParts/submit、AgentTaskHub、Delegation 数据视图。

- 复用列表/键盘/文件搜索机制，增加角色与可用性展示；不要新写并行 Combobox/发送器。
- 区分“可选择的 Agent 定义”和“这次会话产生的运行实例”。同 Agent 多实例不能合并掉；child Session、Participant、Task 与外部 thread 分别使用其 ID。
- 拓扑优先用现有列表/树及关系导航，确有大图需求再评估库；不预装 Vis.js/Mermaid，不把能力集直接等同授权。
- 点击节点默认只定位/选择；启动、取消、重试、继续均复用已有 task/Delegation 能力及 capability gate；不保证所有 CLI 同样支持恢复/中断。
- Custom 的 snapshot/allowlist、禁止后台委派等服务端门禁保持不变；不同 Mode 的不可用动作要解释原因，而非藏掉错误。

**验收**：键盘选择不误发送；agent part 正确进入请求；未知/隐藏/禁止 Agent 不执行；取消与任务结算对应到正确实例；跨 Session/Location 不串状态。**回退**：退回原 @ 列表/Hub，不删运行记录。

### P4 · 生产 ToolRow 与图标统一

**负责人**：Session UI/UI/App + 设计。**范围**：`message-part`、生产 `BasicTool`、统一 Icon、相关 CSS/story、顶部进度/侧栏入口。

- 默认选择**扩展生产 BasicTool**，保留 `locked/defer/animated/triggerHref/自定义 trigger` 等使用契约。若最终选用 BasicToolV2，必须先完成这些能力的接线/迁移测试，禁止只替换名字。
- 先盘点 tool metadata→icon name→实际渲染路径，补字典缺项并验证不是 plus fallback；复用已有 help，不重复造图。普通工具、MCP、skill、terminal、edit、question、permission、task 状态各有明确映射。
- 工具执行/失败/中断不可为了“单行”而隐藏必要错误、授权原因、Diff 或输出；折叠是默认呈现，不是删除证据。
- 顶部显示当前任务；流内是当次调用摘要/只读历史。Checkpoint 若加入，优先从已有事件/消息投影，不为视觉分隔线再造持久化业务事件。
- 侧栏复用 review/artifact/Hub 入口，不新建壳；CSS 使用 v2 token 与同名样式文件，文本入 i18n；旧卡片只在实际不再承担功能后删除。

**验收**：真实 message-part 而非仅 Storybook 可见；每类工具测试默认/加载/成功/失败/中断/展开；主题、英文/中文、窄屏、键盘、缩放与 reduced-motion；长流虚拟化、展开和滚动不回退。**回退**：独立 renderer/style 提交回退，领域状态不动。

### P5 · 补齐 WorkReview 的真实闭环

**负责人**：Schema + Core/Server + App + QA。**前提**：沿用 [已获批 S9A 契约](/home/keer/workspace/aigcfroge/docs/plan/s9a-work-review-lifecycle-contract.md:85)，不是重新争论已批准的四态和存储形式。

- 复用 `WorkReview.Review`、`WorkReviewMachine.transition`、`isVerdictCurrent`、WorkContract 和 artifact revision。
- 按现有契约完成调用 transition 的 **producer**、`metadata.workReview` 写入、`Session.Info.workReview` 读取和 `info.fromRow` 解码。当前已有纯函数和 schema，不代表这些生产路径已经接通。默认沿用获批 metadata JSON，无 Task 新表，也不臆造一个第二审批库。
- 回复必须绑定实际 session、artifact identity/revision 和合法迁移；若 artifact 已变更，旧 approve/request_changes 不得自动套到新版。producer 必须验证当前 artifact/review 条件，而不是信任客户端提交的 hash。
- 将明确的 PlanReview 呈现意图接入 P2，而不是由问题文本出现“计划/approve”来猜。任何必要 HTTP/Schema 扩展都在既有 owner 上定义，随后用脚本再生 OpenAPI/SDK。
- 右侧显示正在评审的确切内容；“讨论/要求修改”不等于拒绝工具权限；“批准计划”不授予 shell/file 权限。无 review 的 ad-hoc Work 会话继续合法。
- 刷新和进程重启后从真实存储重建评审与 artifact 绑定；WorkArtifact 当前内存视图的恢复要由现有 artifact/file owner 明确实现或验证，不能只持久化一个无法匹配正文的 revision。
- 不把 review 恢复扩展成 Session drain/provider 自动重试；这类执行恢复另需设计。跨模式的“通用计划审批”若超出获批 Work 范围，应列作明确增量，不暗中复用 Custom composition 的完全不同语义。

**验收**：submit→request_changes→respond→re_review→approve→reopen 生命周期；非法迁移拒绝；旧 revision 失效；并发/重放不重复批准；历史无 review 兼容；真 backend + SQLite + provider turn + 刷新/重启恢复的 E4。**回退**：撤入口与新写入、保留可兼容读取的 metadata；不靠丢弃已批准/待审记录回退。

### P6 · 完整验收与发布

**负责人**：QA/全栈负责人。**入口**：P1–P5 各自行为门禁通过。

- 运行受影响包的 unit/integration/typecheck；API变更运行 HttpApi coverage/auth 和相关实际 effect 用例；SDK 再生后验证 drift。
- E3覆盖五模式和 presentation 标签矩阵；E4证明产品链真实接通，不以 mock route 替代。尤其检查 [E4 job](/home/keer/workspace/aigcfroge/.github/workflows/test.yml:104) 在 PR 事件被跳过、以及 [V2 step](/home/keer/workspace/aigcfroge/.github/workflows/test.yml:173) 会因前一步失败被跳过的实际语义。必要检查要触发并读回结果，不能把“workflow 绿”当作全部跑过。
- 生产 benchmark 前后比较相同场景/机器/构建条件；不用机器相关硬阈值伪造稳定结论；桌面检查 packaged Electron，TUI检查旧事件兼容。
- 用户批准的试用/灰度范围内发布，记录版本、回退点和观察结果。任务丢失、越权/误批准、请求不可回答、旧客户端断裂任一出现即停止放量并按切片回退。
- 写入 coverage-manifest/debt ledger 的缺口必须有 owner 和 unlock；提交清单来自命令，不能手写数量。获得用户交付批准后再提交/推送/PR，标题用 conventional commit；分支遵守本项目三词以内无斜杠约束。

**完成定义**：§7 的适用场景均有可复查证据；必需门禁无跳过；兼容退出/未交付广度已获批准并登记；回退演练不损失任务/授权/评审事实；PR/CI 状态已实际读回。未满足则不能称“全量闭环”。

## 7. 验收场景：不能只靠快照或源码字符串断言

- **T01 / Task 一致性**：V2 双投影相同、V1独立写入/清空、迟到 GET、同时间戳、重排/删除、revision 冲突、重新加载；数据与 UI一致。
- **T02 / Task 完整性**：六态、agentID、parent_task_id、DAG、定时/时区、摘要、正常/异常/取消的结算回写；主/子会话不能错绑。
- **T03 / Gate 并发**：父子请求、问题/权限同现、重复点击、两个客户端回答、服务拒绝/已过期/网络失败、切路由；只产生合法终态。
- **T04 / 授权边界**：once/always/session/location 分别走正确通道；拒绝与反馈保留；无 ApprovalPresence、错误 session/Location、Custom 不允许 Agent 均 fail-closed。
- **T05 / 输入连续性**：中文 IME、附件/pill、选区、撤销、草稿与 queued follow-up、Enter/Esc/数字键；取消表单后不误发 prompt。
- **T06 / Agent 拓扑**：同名多实例、父子链、外部 CLI 能力未知/不支持、取消/继续/失败结算、跨服务端切换；禁止假造 Busy 和关系。
- **T07 / 工具呈现**：真实 registry→BasicTool→Icon 路径；无未知名 plus 回退；history 不被当前任务覆盖；错误和 Diff 不因折叠丢失。
- **T08 / WorkReview**：纯状态机测试之外，验证 producer→metadata→读字段→SDK→UI；合法/非法迁移、旧 revision、修改正文、历史数据、刷新及进程重启。
- **T09 / 五模式**：共用呈现但分别测试可用动作；Mode 切换不创建/重分类 Session、不改变 Agent；隐藏 mode slot 不新增 SDK/SSE effects。
- **T10 / 视觉与无障碍**：desktop/narrow，light/dark，en/zh（需要时 zht），长文案/缩放、Tab/焦点恢复/屏幕阅读语义、reduced-motion。被矩阵运行的测试必须打现有 presentation/a11y 标签。
- **T11 / 回放与恢复**：断连重连、重复/晚到事件、删除任务后的旧快照、关闭 Session、进程重启。既有 pending question 非 durable 的现实不能被 UI 掩盖。
- **T12 / 发布兼容**：旧客户端/服务器与 TUI、真实桌面包、生成 SDK、API auth/coverage、数据回退；性能基线与改后基准可比。

每个 T 项必须在执行分支映射到具体 spec/断言。现有测试覆盖的部分直接复用；不存在的用例列为新增，不能把本清单当作已覆盖。

## 8. 本次实际验证

只统计最后一轮、互不重叠的测试批次，避免重复计算早先 88 项等子集。以下命令均从列出的包目录执行，结果由日志提取。

### core-final

工作目录：`/home/keer/workspace/aigcfroge/packages/core`。

```bash
bun test --timeout 30000 --only-failures test/session-task-service.test.ts test/session-todo.test.ts test/tool-todowrite.test.ts test/task-progress.test.ts test/question.test.ts test/permission.test.ts test/permission-grants.test.ts test/tool-question.test.ts test/delegation-service.test.ts test/delegation-recovery.test.ts
```

结果：exit **0**；**112 pass / 0 fail**；10 files；382 expect calls；7.32s。

### app-final

工作目录：`/home/keer/workspace/aigcfroge/packages/app`。

```bash
bun run test:unit:file --timeout 30000 src/pages/session/timeline/session-todo-progress-model.test.ts src/pages/session/timeline/session-todo-progress.test.tsx src/context/global-sync/session-todo.test.ts src/context/global-sync/permission-pending.test.ts src/pages/session/composer/session-permission-dock.test.tsx src/pages/session/timeline/agent-task-hub-model.test.ts src/pages/session/timeline/agent-task-hub.test.tsx
```

结果：exit **0**；**99 pass / 0 fail**；7 files；228 expect calls；590.00ms。

### prompt

工作目录：`/home/keer/workspace/aigcfroge/packages/app`。

```bash
bun run test:unit:file --timeout 30000 src/components/prompt-input/build-request-parts.test.ts src/components/prompt-input/submit.test.ts src/components/prompt-input/history.test.ts
```

结果：exit **0**；**35 pass / 0 fail**；3 files；134 expect calls；803.00ms。

### session-ui

工作目录：`/home/keer/workspace/aigcfroge/packages/session-ui`。

```bash
bun test --timeout 30000 --only-failures src/components/task-tool-card-model.test.ts src/components/delegation-tool-card-model.test.ts
```

结果：exit **0**；**13 pass / 0 fail**；2 files；32 expect calls；240.00ms。

### work-review

工作目录：`/home/keer/workspace/aigcfroge/packages/core`。

```bash
bun test --timeout 30000 --only-failures test/work-review-lifecycle.test.ts
```

结果：exit **0**；**12 pass / 0 fail**；1 files；20 expect calls；197.00ms。

### approval-center

工作目录：`/home/keer/workspace/aigcfroge/packages/app`。

```bash
bun run test:unit:file --timeout 30000 src/components/approval-center.test.ts
```

结果：exit **0**；**3 pass / 0 fail**；1 files；5 expect calls；1239.00ms。

**合计：274 pass / 0 fail，24 个测试文件。** 这是所选范围的基线，不是全仓覆盖率。

需要特别说明：`session-todo-progress.test.tsx`、`agent-task-hub.test.tsx` 中有源码结构约束断言；WorkReview 的 12 项是纯状态机/契约测试。它们都不能证明真实 DOM、生产 producer 或重启恢复已完成。

本次没有运行：全仓/受影响包完整 typecheck 和全量 lint/test、HttpApi exerciser、E3/E4、打包桌面/TUI运行、生产性能/可访问性测量。原因是本轮只做文档核验与规划，不改变产品代码；这些仍是实施阶段门禁，而不是可以省略的验证。原始竞品的未证实 UI 行为也没有被本地单测“证实”。

## 9. 未决项与闭环账本

本节登记本次核验范围之外的事项；实施 slice 若据此延期，须在关闭前同步到 [technical-debt](/home/keer/workspace/aigcfroge/docs/technical-debt.md) 或 [coverage-manifest](/home/keer/workspace/aigcfroge/packages/app/e2e/coverage-manifest.json)，而不是在最终回复中一句“后续补齐”。当前这两个文件包含已有工作，本次不擅自修改。

- **U01 竞品 Agent Map 身份** — owner：产品/设计；unlock：明确是 Claude Code CLI、Claude Desktop/其他客户端还是插件，提供版本与可复现界面。未解锁前不宣称“按竞品原生机制实现”。
- **U02 V1 退出窗口** — owner：Core/API/TUI；unlock：列全受支持消费者、事件读写链和迁移测试，并有版本策略批准。未解锁前保留兼容投影与 picker。
- **U03 WorkReview 生产闭环** — owner：Work/Core/App；unlock：P5 producer、读回、revision/current artifact 和真实 E4 通过。纯函数已落地不等于本项关闭。
- **U04 多 Gate 的排序/焦点** — owner：产品/设计/App；unlock：批准稳定选择策略，并通过并发、中文输入和键盘实测。未解锁前不引入全局 Enter 自动批准。
- **U05 外部 CLI 能力与恢复** — owner：Delegation/Core；unlock：按适配器能力验证 thread/resume/interrupt、权限桥接与失败；不把一个 engine 的能力推广给所有引擎。
- **U06 E3/E4 与 CI 实际执行** — owner：QA/CI；unlock：真实环境中运行所需 job/variant 并保存 trace、日志和 teardown 证据；不能把 PR 跳过视为通过。
- **U07 生产视觉、桌面与性能** — owner：App/Desktop/QA；unlock：生产构建基准、五模式展示矩阵、packaged desktop/TUI兼容测量。28px/50%/80% 等没有依据的数字不得当既成指标。
- **U08 跨服务器/历史/失败矩阵广度** — owner：技术负责人/QA；unlock：按 S9A 契约明确批准 MVP 范围并登记剩余项。若要求本轮“完整闭环”，这些不能静默砍掉。

这些负责人是执行角色，尚未分派到具体人员；P0 必须落实人和验收责任。本报告不凭空承诺日历排期或“零风险”。

## 10. 关键关系函数的核验记录

### 10.1 SessionTodo.update / SessionTask.publishBoth

目的：兼容旧三字段调用，同时将写入集中到现有任务域。它不是第二个任务聚合，也不拥有另一张任务表。

输入/前提：session 身份已确定；SessionTask layer 可用；当前列表来自相同 TaskTable；legacy 调用是全列表替换；baseline 与 writeLock 是进程级而非分布式锁。输出是任务写入、task.updated 及其三字段投影。

观察到的约束：调用前比较完整 id/revision fingerprint；replaceLegacy 沿位置复用已有 ID；toTodo 只映射兼容字段。`publishBoth` 明确从同一 tasks 生成两种 payload，是决定“是否两套真源”的关系函数。

边界风险：位置复用不等于可任意重排的语义身份；两事件顺序发布不等于原子多消息提交；跨进程/重启并发保证不能由本地 Semaphore 推出。任何改动应保留现有并发测试，并按真实缺口补充。

### 10.2 sameTodoList / pickProgressTodos

目的：在旧/新流并存时提供可用的显示列表，并尽量保留可写 Task 身份。它有刻意的兼容优先级，不能只从函数名判断是坏的“双真源”。

输入/前提：两数组可不存在；todo 无 ID；顺序具有显示语义；缺失 priority 按 medium；时间是接收侧记录而不是数据库提交序号。输出为选中的原列表，不写数据库。

分支约束：空 Task 回退 Todo；内容/status/priority 相同优先 Task；不同时再比较时间，平手保留 Task；较新的空 Todo 可以清除旧 seed。移除此函数的前提是旧来源退役或有等价替代，不是看见两个字段就删除。

### 10.3 blocked / showComposer / request-tree

目的：从当前 Session 树找到待决事项，并决定普通输入区是否出现。问题和权限分别选择，所以协调缺口与“全部 Dock 堆叠”不是同一问题。

输入/前提：当前路由 sessionID 有效；session parentID 树已加载；request map 按正确 scope 提供；自动权限筛选仍在生效；子会话的只读提示与根会话输入不同。输出是 UI 可见性与各自请求，不新建授权事实。

约束：根会话有问题或权限即 blocked；普通 Composer 随之隐藏；TodoDock 没有实际挂载。剩余风险是两个独立 Show 可同时成立、子树请求身份/草稿/焦点需要协调，以及全局 ApprovalCenter 不能被遗漏。

### 10.4 WorkReviewMachine.transition / isVerdictCurrent

目的：执行已批准的评审迁移，并判断结论是否仍对应当前 artifact revision。这两者是纯规则，不负责存储或执行恢复。

输入/前提：事件已鉴权；传入当前而非猜测的 review；artifact 来源与 session 对应；revision 来自真实内容；时间由生产边界提供。输出为下一 review 或 IllegalTransition，以及严格 revision 相等判定。

约束：无记录只能由 submit 建立；非法迁移不通过；批准/修改结论绑定 artifactRevision；无 review 的 ad-hoc 合法。风险必须在欠缺的 producer 解决：并发写入、旧版批准/正文替换、重启后的内容/身份恢复。12 项纯测试不是这些边界的生产证明。

## 11. 交付会计与下一步

**用户后续决定（2026-09-30）**：项目开发中，不做旧版本兼容代码。本报告中基于旧范围提出的“保留兼容投影/等待退役窗口”建议不再约束实施；事实核验仍保留，实际施工以 [TDD方案R2](/home/keer/workspace/aigcfroge/docs/plan/agent-interaction-ui-tdd-implementation.md)、[本轮审批](/home/keer/workspace/aigcfroge/docs/review/agent-interaction-ui-tdd-approval-2026-09-30.md) 和 [执行提示词](/home/keer/workspace/aigcfroge/docs/plan/agent-interaction-ui-execution-prompt.md) 为准。

**后续施工入口（2026-09-30）**：[智能体交互与 UI 体系收敛：TDD 实施方案](/home/keer/workspace/aigcfroge/docs/plan/agent-interaction-ui-tdd-implementation.md)。本报告保留事实核验；新增行为、RED/GREEN 用例、命令和切片门禁以该施工方案为准，领域契约仍服从各 owner 文档。

本次只新增核验报告、结构化证据，以及聊天旁可查看的证据看板；**没有实施 P1–P6，没有改变生产代码、原调研文档、既有 staged 内容或权限配置**。

实施 checkpoint 每次都必须附：

```bash
# 在已确认的执行分支；提交清单不得手写
 git log --oneline <上个检查点提交>..HEAD
 git diff --check
# lint 的比较基线需显式选择，避免 main 自比空绿
 LINT_BASE_REF=origin/main bun run script/lint-changed.ts
```

按变更实际范围追加包级 `typecheck`/测试；HTTP/Schema 变更执行仓库 SDK 生成脚本 `./packages/sdk/js/script/build.ts` 与 drift 检查；完整检查命令以当前 package scripts 和 CI为准。不得直接运行 tsc，不从仓库根直接运行包测试。

**建议先批准 P0 的三项契约，再按 P1/P2 开始第一批切片。不要批准“新增 SessionPlan + 合并权限到 question”的原实施方案。**
