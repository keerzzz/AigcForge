# 智能体交互与 UI 体系收敛：TDD 实施方案

> **日期**：2026-09-30
>
> **状态**：R2 技术审批版（开发期单版本、单契约）；S00–S09 均未执行。已按用户“不做兼容代码”的决定修订。技术审批不是产品验收、发布批准或对未知风险的保证；执行批次及交回门禁见 §0.3 与 [审批记录](/home/keer/workspace/aigcfroge/docs/review/agent-interaction-ui-tdd-approval-2026-09-30.md)。
>
> **文档与审查源目录**：`/home/keer/workspace/aigcfroge`。历史审查 HEAD 为 `e23b4561cb96162d352e1093b719894d11333686`；最终复核观察到当前分支 `local-cli-discovery@5097f185ddb9bbbe6e09fb674e69f04dd9a22b4b`。这些都不是实施起点。
>
> **实施基线（用户指定）**：从同一仓库的**本地 `refs/heads/main`** 创建新分支，冻结 `mainBaseCommit=260e8275b9b0af9d0b445e5acfb6f4d3545eac7b`；建议新分支 `agent-ui-tdd`。禁止从当前工作分支、`origin/main` 或其他副本开工，禁止夹带当前分支提交/脏改动。本次只修订文档，尚未创建实施分支。开工须匹配审批记录中的 `planSha256` 与 `mainBaseCommit`，任何基线漂移或计划实质修改交回复审；新 checkout 上重新验证事实和测试，不继承历史 GREEN。
>
> **证据前置**：[27 项主张核验与原实施建议](/home/keer/workspace/aigcfroge/docs/research/agent/ZCode-Antigravity-DeepSeekHarness-核验与闭环实施计划.md)；[机器证据与历史测试结果](/home/keer/workspace/aigcfroge/docs/research/agent/agent-ui-audit-evidence-2026-09-30.json)。历史274 pass/0 fail仅说明审查时旧合同基线；R2会主动替换其中的兼容测试，这个数字不是R2或新增行为GREEN。

## 0. 文档职责与既有方案对齐

本文是**本次交互收敛改造的 TDD 施工说明**，不是第二份 Task、Delegation 或 WorkReview 架构规范。

### 0.1 决策来源及优先级

1. [CLAUDE](/home/keer/workspace/aigcfroge/CLAUDE.md)、[AGENTS](/home/keer/workspace/aigcfroge/AGENTS.md)、[ARCHITECTURE](/home/keer/workspace/aigcfroge/ARCHITECTURE.md)、[CONTEXT](/home/keer/workspace/aigcfroge/CONTEXT.md)、[DESIGN](/home/keer/workspace/aigcfroge/DESIGN.md)：边界、权限、运行时、组件与编码约束。
2. [测试体系指南](/home/keer/workspace/aigcfroge/docs/testing.md:7)：TDD 和真实门禁命令；§10 禁止源码字符串代替行为、假 RED 和只测 V2 不测 V1。
3. [Todo/Task 升级方案](/home/keer/workspace/aigcfroge/docs/plan/todo-task-system-upgrade.md:407)：沿用 M7 的标题下方统一轨道、默认折叠、idle 静态留存与写回；其旧流仲裁条款由本次用户单版本决定取代，不另造 28px 常驻栏。
4. [ADR-22](/home/keer/workspace/aigcfroge/docs/architecture/adr/ADR-22-meta-agent-persistent-delegation.md) 与 [持久委派 TDD 方案](/home/keer/workspace/aigcfroge/docs/plan/meta-agent-persistent-delegation-closed-loop.md:926)：Delegation/Participant/Turn、权限与恢复仍由其 owner 决定。本计划只消费或补齐相关 UI，**不重做其已存在的 Schema/表/调度器**。
5. [S9A WorkReview 契约](/home/keer/workspace/aigcfroge/docs/plan/s9a-work-review-lifecycle-contract.md:85)：四态、`reopenedFrom`、artifact revision 及 metadata JSON 已批准；pure machine 已实现，producer、读回及 E4 是本次需完成的缺口。
6. [全局壳与五模式闭环](/home/keer/workspace/aigcfroge/docs/plan/global-shell-product-closure-2026-09-13.md)：共用壳、typed side panel、隐藏 Mode 不执行资源副作用；不扩大 Assistant M2、Custom runtime 或 Work 自定义 Preset 范围。
7. [quality-to-pr 工作流](/home/keer/workspace/aigcfroge/.aigcfroge/skills/quality-to-pr/workflows/end-to-end-pr.md)：每个 slice 的复用审查、行为测试、差分审查和独立交付批准。

旧方案中的“已实现/未实现”、命令和行号可能过期：**规范性决策继续遵守；事实性状态用当前代码和运行结果验证**。例如旧测试表写 desktop 无单测，而当前 desktop 已有 `test`/`test:e2e` scripts，应使用实际 scripts。

### 0.2 本文新增的设计增量

以下是本方案明确提出的增量，不冒充既有已批准 API；采纳本文后实施，并在对应 owner 文档内同步：

- **D-A**：同一 Composer 的问题/权限请求改为稳定选择的一份可操作表单，而不是多个独立表单同时争焦点。
- **D-B**：Agent 目录与运行实例分区；选择仍插入既有 agent part，不直接启动任务。
- **D-C**：生产 `BasicTool` 完成图标接线与紧凑工具行；Task 当前态与历史记录分工。
- **D-D**：为 S9A producer 在唯一 `WorkReview.Review` 契约中补 `revision` 与 `artifactID`，并由 WorkArtifact owner 保存可恢复引用。保持四态，不创建旁路版本字段/第二审批状态机/新表，细则见 §3.4。

S9A 原契约未规定 producer 的 HTTP 名称、并发令牌和 artifact 冷启动绑定；本方案将其补足，新增 Review 字段直接升级当前契约，不提供旧格式解码分支。不得把这些增量直接标成“原方案已经实现”。如果实施时发现与更新后的 owner 契约冲突，只停止对应 slice，保留其他不相交工作的进度。

### 0.3 用户决定与审批批次（2026-09-30）

**最高优先的本次业务约束：项目在开发中，不做旧版本兼容代码。** 本节取代本计划 R1 和前次审查中“保留旧流、维持旧数据兼容窗口”的建议；历史文档中的事实记录不因此改写。

- 不新增旧客户端/旧服务端/旧 payload 的 alias、adapter、fallback、双写、双 store、version 分支或旧数据自动补全。
- 本次被新契约替代的旧路径与旧协议测试同批退役；当前生产者、HTTP、生成 SDK、App、TUI、工具定义/提示词与 fixture 同批更新。
- “v1/v2”目录名不是删除依据。仍在使用的默认运行时、Mode 或外部引擎是当前功能，不因名字旧就能删除；其集成继续验收，但不能为它额外造一层兼容桥。若完整切换超出明确写集，停止对应批次交回审批。
- 不做全仓无边界 legacy 清理；只清理本次改造家族及其实际调用链。历史研究文档和测试里的负例可以出现旧名称，在线生产路径不能靠旧契约工作。
- 无旧数据格式支持要求，但不等于可以删数据。隔离测试用当前 fixture；重置开发数据库、丢弃旧记录或搬移未提交工作须另得用户明确授权。用户已指定从本地 main 创建本任务新分支；除此以外的 Git 变更没有隐含授权。

**分支门禁**：先核验 `refs/heads/main` 存在且等于审批记录的 `mainBaseCommit`，再创建不存在的新分支；创建瞬间其 HEAD 必须等于该提交。不得自动 fetch/pull/rebase/cherry-pick/reset/stash 来凑基线。原工作树有任何 staged/unstaged/untracked 工作时不原地切换或携带它们；使用遵循宿主工具规则的隔离工作树，或停下请求用户指定安全方式。隔离工作树从已核验并冻结的本地 main 提交建立，记录 `implementationRoot`；后续源码/测试/生成命令一律在该 checkout 执行。原目录中的获批文档可只读，不复制整个脏工作树；独立进度账本不得改写已冻结计划。

执行智能体以 [完整交接提示词](/home/keer/workspace/aigcfroge/docs/plan/agent-interaction-ui-execution-prompt.md) 为任务单。批次顺序：

1. **B1 = S00 + S01**：基线与 Task 单契约切换。
2. **B2 = S02 + S03**：待决界面与回复/授权边界。
3. **B3 = S04 + S05**：Agent 目录/关系与生产 ToolRow。
4. **B4 = S06**：WorkReview producer/API/SDK；高风险数据与授权批次独立审批。
5. **B5 = S07 + S08**：WorkReview UI/恢复与集成验收。
6. **B6 = S09**：最终质量与交付准备；不自动 commit/push/PR/发布。

**每批结束必须交付证据并停止，等待用户转交本聊天审查后的明确放行。** 执行者可自检，不可代替审批者自行放行，也不主动向其他聊天发消息。首次任务只执行 B1；B0式只读基线发现工作区冲突/缺执行授权时先停在基线，不覆盖他人工作。

## 1. 范围、非目标与完成口径

### 1.1 必须交付

- 任务六态、稳定身份、调度/DAG/Agent 归属不退化；当前在线链路统一使用 Task 契约，旧三字段投影同批移除。
- 当前任务详情可展示真实 Agent 归属；历史 Todo 工具记录紧凑且保持当次内容。
- 问题/权限表单协调、正确的回复 owner、草稿与焦点恢复、并发终态处理。
- 复用 `@` 候选与 AgentTaskHub 展示目录及真实运行关系；未知能力不伪装可操作。
- 生产消息流的 Icon / ToolRow，包括 thinking、terminal、read/search、edit/diff、task/delegation、todo、question、skill、MCP 与通用工具的适用状态。
- WorkReview 的 producer→metadata→读模型→HTTP/SDK→UI→刷新/隔离测试进程重启闭环。
- 五模式的共享 UI 与权限边界回归，API/SDK、必要 E3/E4、当前桌面/TUI集成及生产 benchmark。

### 1.2 明确不做

- 不新增 `SessionPlan`/`session_plan`，不删除 `SessionTask`，不创建 `session.plan.updated` 视觉专用事件。
- 不合并 PermissionV2 与 QuestionV2，不将 WorkReview verdict 当作 permission grant 或 Delegation review barrier。
- 不承担旧客户端/服务器/格式的支持窗口。Task 旧投影在 S01 同批退役；其他家族按当前调用链直接升级，不新增 legacy 外观适配。
- 不新建第二套 Composer、Mode shell、Session route、CLI registry、SSE 连接或图形引擎；本期用现有列表/树展示关系，不引入 Vis.js/Mermaid 依赖。
- 不实现“点击 Agent 节点即执行”、全局 Enter 自动批准、Esc 自动拒绝。
- 不采纳原文未经验证的“80% 单选流内直接作答”。**本期交互统一在既有 Composer/审批入口完成，流内只显示状态与定位动作。** 这是本方案的范围选择，不是假装已交付双模交互。
- 不把 WorkReview 扩展成所有模式的强制计划审批，不强制 ad-hoc Work 开启 review。
- 不在本计划修复 V2 provider execution、引入集群调度或自动重跑未知副作用；已有 V2 缺口按 §9 的依赖门禁处理。

### 1.3 “完成”分三档，不能混称

- **切片完成**：该 slice 的新行为 RED→GREEN、必要回归和类型检查完成，有证据。
- **交互改造完成**：S01–S07 的真实调用链统一使用本批当前契约，仓库内调用方已改齐；不自动代表五模式 provider 全链路可用。
- **本期完整交付**：S08/S09 所有适用发布门禁完成，或 Owner 显式批准缩减范围且剩余项已登记。没有此批准，不允许用“已有缺口”豁免必需验收。

## 2. 固定设计契约：先写这些断言，再写实现

### 2.1 Task 与历史

- `SessionTask`/TaskTable 为持久化任务 owner；本次将在线读写统一到此契约，退役 `SessionTodo` 兼容 facade 与旧三字段投影。
- 删除 `pickProgressTodos`、不再需要的 `sameTodoList`、`session_todo` 和双源接收时间戳。只保留一份规范 Task 当前态；空数组是合法清空结果。迟到 GET/旧连接回调必须由当前请求/连接代际或现有查询 owner 拦截，不再按两个数据源“谁更新”仲裁。
- `agentID` 存在才显示归属；规范 Task 无 agentID 时显示未归属或不显示，不从 Session agent、任务文字或摘要反推。
- 当前任务可以改变；过去某次规范 Task 写入工具调用的展开内容只来自该 ToolPart 的 input/metadata/output，不能读取当前 task store 重绘历史。
- M7 轨道的四种显示状态不变；“无任务不显示任务字段”不等于隐藏模型工作状态。`cancelled` 不计 completed，`scheduled/failed` 不折成 pending 后写回。

### 2.2 待决事项与焦点

- 继续用现有 Session 树限定当前会话及可代理回答的子会话；不得从其他 server/Location 捞请求。
- 活跃键至少含 `server/Location + sessionID + domain + requestID`。`domain` 区分问题与权限；必要的来源标识只能对应当前真实 owner，不能用于旧版本转换。不能按字符串 ID 猜 owner。
- 当前活跃请求仍 pending 时保持它，不因新请求到达抢焦；请求已完成/过期才选择下一个。
- 无活跃项时：先沿现有父→子树顺序定位；同层先 permission 再 question；同类维持已记录的到达顺序。用户显式选择可切换请求，草稿按键保留。排序只决定 UI，不决定权限优先级。
- 本期 WorkReview 是用户显式打开的评审操作，不因为 `state=open` 就强制占用所有会话的 Composer 或暂停 provider。
- 未发送 prompt、附件、agent/file pills 和 selection 在表单出现/消失后保持；恢复焦点前确认元素仍存在。
- 数字键仅在题目控件激活时解释为选项；IME、普通输入、终端和快捷命令不被全局监听器截走。Enter 只提交明确选择；Esc 关闭临时浮层，不隐式拒绝业务请求。
- 全局 ApprovalCenter 保留；非 Session 页面仍可回答当前 Location 的权限。不同入口争抢同一请求时，以服务端一次终态规则裁决，不靠前端 disabled 冒充并发安全。

### 2.3 Agent、ToolRow 与层边界

- 目录来自现有 Agent 服务；实例来自 Session/Task/Delegation 数据。名字相同的两个实例不得合并。
- `handleAtSelect → buildRequestParts → 既有 submit/prompt channel` 不变；节点选择不直接发起网络执行。
- 权限和 capability 来自服务端/适配器；未知状态显示未知或不可操作，不把 `Busy` 从 Agent 名字上永久缓存。
- 优先扩展生产 `BasicTool`，保留动态 trigger、link、locked、defer、animated 等契约；不只改 BasicToolV2 的 story。
- 图标复用 `packages/ui` 统一字典。新接线的语义名称必须有真实字形，不能悄悄显示 plus fallback；本次触及的旧图标调用方同步更新，不新增别名映射；未触及代码不做无边界清理。
- `session-ui` 只接收展示数据/动作回调，不导入 App 的 store、router 或 SDK 发请求。状态变化复用现有事件通路，不开第二条 SSE。

### 2.4 WorkReview 不变量

- 只复用 `open / fix_requested / responded / resolved` 和既有 `transition`/`isVerdictCurrent`；`reopen` 回到 open，不增加第五态。
- `artifactRevision` 是内容版本，`artifactID` 是评审对象，`Review.revision` 是服务端并发修订号。三者不能互换，`updatedAt` 不能伪装修订号；只有 review 不存在时 expected revision 才为 0。
- 任何 approve/request_changes 必须针对真实、同 Session/Location 的 artifact；存在但损坏的 review 元数据不等同“没有 review”。
- 审批只评价内容，不授予读写/终端权限，也不自动执行、恢复或重跑模型。
- Schema/纯函数、producer、投影、HTTP/SDK 与 UI 分层；无生产 writer 的读字段不得被称为闭环。

## 3. WorkReview producer 的明确施工契约

本节固定 S06/S07 的设计，避免实现到一半再把“状态一致性”留给 UI 猜。

### 3.1 复用与新增位置

**复用**：

- [状态与版本规则](/home/keer/workspace/aigcfroge/packages/core/src/session/work-review.ts)、[WorkReview schema](/home/keer/workspace/aigcfroge/packages/schema/src/work-review.ts)。
- [WorkArtifact](/home/keer/workspace/aigcfroge/packages/core/src/session/artifact.ts)、[SessionInfo.fromRow](/home/keer/workspace/aigcfroge/packages/core/src/session/info.ts)、[Session schema](/home/keer/workspace/aigcfroge/packages/schema/src/session.ts)。
- [Location 层组合](/home/keer/workspace/aigcfroge/packages/core/src/location-layer.ts)、[server.session group](/home/keer/workspace/aigcfroge/packages/server/src/groups/session.ts)、[SessionHandler](/home/keer/workspace/aigcfroge/packages/server/src/handlers/session.ts)。

**拟新增，当前不存在**：`/home/keer/workspace/aigcfroge/packages/core/src/session/work-review-service.ts`。

理由：pure `WorkReviewMachine` 不做 I/O；它需要一个明确的 Effect producer 承担鉴权后的状态校验、并发写入与读回。现有 SessionStore 没有通用 review/metadata 写入接口，不能假装有 `updateMetadata()`。新服务仍在原 Session/WorkReview 领域内，不是第二个 review 模型或通用 Gate 框架。

服务 Location-scoped，方法接收 Session ID；组合根提供 Database、Location、WorkArtifact 等稳定依赖，不在每次 HTTP 请求中重新 build layer，更不能将 Session ID 放进 Layer 定义。

### 3.2 拟新增 HTTP/SDK 合同

下列路由与 identifier 是**本方案设计值**，不是对当前接口存在性的陈述；实现时扩展现有 `server.session` group，不新建平行 API 树：

- `GET /api/session/:sessionID/work-review`：identifier `v2.session.workReview.get`。
- `POST /api/session/:sessionID/work-review`：identifier `v2.session.workReview.transition`。
- 为现有 `session.get` 新增可选 `Session.Info.workReview`，详情/可操作性以 review 读取结果为准。

Transition 请求只允许：`action`、`expectedReviewRevision`、与该 action 有关的 `artifactID/expectedArtifactRevision`。不得接受客户端传入的 next state、timestamp、owner、Location 或任意 metadata。Session ID 取路径，Location/授权取中间件；不要以请求 body 覆盖它们。

Action 沿用 `submit / request_changes / respond / re_review / approve / reopen`。首次 submit 的 expected version 为 0；成功写入后返回新的权威读模型。无 effect 的“讨论/关闭面板”不伪装为这些动作。

读取结果区分：

- 无 review：合法 `none`，expected revision 为 0（仅无记录）；不是给缺字段的旧记录补默认值。
- 有效 review：`ready`，携带原 Review、`Review.revision`、artifact 引用及当前内容是否匹配。
- 无法验证：`unavailable`，如损坏元数据、artifact 缺失/越界或版本格式非法；禁用批准并展示可修复原因。不可静默降为 none。

这些是读取可用性，不是新增 review 生命周期状态。Schema 放回现有 WorkReview/WorkArtifact schema owner，多字段记录用项目 Schema 规范，domain 不导入 HttpApi。

错误契约至少覆盖：not found、wrong mode/forbidden、invalid action/payload、stale review version、stale artifact revision、illegal transition、artifact unavailable、corrupt review。映射为已声明 typed 4xx/服务故障；冲突用 409，缺失 404。内部缺依赖或数据库故障不能包装成“无 review”。

**生成后的客户端调用约定**：预期通过 `client.v2.session.workReview.get/transition` 使用；必须由生成产物和实际调用测试验证。如果生成器实际命名不同，先调整 identifier/owner 契约，不能在文档或 App 手写一个并不存在的方法。

### 3.3 授权、作用域与当前运行时

- 认证复用 server API 的 [Authorization](/home/keer/workspace/aigcfroge/packages/server/src/middleware/authorization.ts:11) 与其现有 ServerAuth 配置；[SessionLocationMiddleware](/home/keer/workspace/aigcfroge/packages/server/src/middleware/session-location.ts) 只按 Session 持久化 placement 提供 Location，**不承担用户角色授权**。两者不能混称。
- 本期评审动作遵守现有 Session 管理 API 的操作者信任边界，不新增 reviewer RBAC、不宣称“只有人类能批准”。当配置启用认证，缺失/错误凭证必须 401；认证关闭的受信本地模式保持现有策略，不能假装存在用户身份或角色保证。
- 仍须检查 Work Mode、Session/capability、artifact 归属及 revision。跨 scope 负例是“在 Session A 的路径提交属于 B 的 artifact/request”，不是臆造已认证操作者不能管理另一个 Session 的 ACL。
- 不接受 body 声称的 actor/owner/Location 作为可信身份；公开 DTO 不暴露任意 metadata 写入。若产品要求人类签署/独立 reviewer 身份，这是额外需求，停止并提请新授权，不用 UI 按钮代替后端身份保证。
- WorkReview 不是 grant：review 成功不得调用 permission.reply/grant，不自动执行工具/启动 provider。
- 直接更新当前 App 所使用的 GET/SDK/mapper，使其读取同一规范 Review。需要修改当前调用方时直接改，不添加 legacy 外观或 404 后切另一写端点。
- QuestionDock 当前调用 `client.question.reply/reject`，S03要确认当前真实 owner/桥接事实再改调用方。禁止凭 `que` 前缀或目录名猜运行时；不承担旧版本请求协议支持，也不为活跃默认运行时新增兼容层。

### 3.4 单一 Review 记录与并发：不新增表、不补旧格式

沿用批准的 metadata JSON 存储位置，并直接升级当前 Schema：

- `metadata.workReview`：唯一 `WorkReview.Review` 记录；在四态/contractVersion/artifactRevision/reopenedFrom/updatedAt 基础上，新增必需 `artifactID` 与正整数 `revision`。这两个字段由服务端 producer/纯规则管理，不从客户端 next-state 接收。
- **取消 R1 的 `metadata.workReviewVersion` 旁路字段**。API 的 expectedReviewRevision 对比同一 Review.revision；无记录用 0，首次 submit 得到 revision 1，每次成功动作加 1。存在但缺字段/坏字段的记录返回 unavailable/typed error，不将旧记录当 0 初始化。
- `metadata.workArtifact`：由 WorkArtifact owner 管理的当前 artifact 可恢复引用，复用现有 identity/相对路径/内容 revision，不存正文。它是当前产物指针；Review 自己的 artifactID/artifactRevision 是被审对象，二者不得混同。无此绑定时不能凭当前文件猜旧评审对象。

本节是开发期对 S9A 的 Schema amendment：保持四态和metadata位置，直接更新纯函数、所有当前 fixture及读取方，无旧格式解码/别名/默认字段注入，也不新增数据库表。

在同一数据库事务内读取当前 Review、对比 expectedReviewRevision、调用纯 transition并条件更新唯一记录；只更新拥有的 metadata 键，保留其他当前业务元数据。两个相同 expected revision 请求只有一个成功；失败方409，不写、不增修订号。Scope Semaphore不能替代跨层实例仍有效的数据库条件写。

绑定规则同批补进纯状态机与测试：submit建立被审artifact绑定；request_changes/approve必须匹配已绑定的artifactID和内容revision；respond保留原绑定；re_review/reopen是显式选择当前产物重新打开评审的动作，必须校验并写入新绑定。为避免 open 期间编辑产物后卡死，明确新增现有 re_review 动作的 **stale open → open** 自转换：只有当前绑定已过期、目标产物真实可用且 expectedReviewRevision 匹配时，才可显式重新绑定并递增revision；未过期的open不走该自转换。原 responded → open、resolved → open 路径保留，无第五态。旧批准不会因“新产物内容hash恰好相同”自动继承。 `WorkReviewMachine.isVerdictCurrent` 同批升级为比较artifact身份与内容revision的唯一关系函数；producer和读模型复用它，UI不复制另一套“是否有效”判断，也不保留旧签名重载。

响应丢失后先GET权威结果，不自动重放写命令；旧approve在reopen后因旧Review.revision失败。所有action的修订号和binding变化由服务端生成，四态集合不变；合法迁移只增加本节明确批准的stale-open re_review自转换，其余沿用原规则。该增量与新增字段同批同步回S9A，不伪称原契约已有。

### 3.5 Artifact 恢复与事件

- WorkArtifact 继续通过既有 FileMutation/LocationMutation 做路径、符号链接及原子文件写入；补保存可恢复引用和冷启动重建，不能另写 `node:fs` 旁路。
- 文件与 DB 不是一个原子事务。按“文件成功 → 持久化引用 → 对外报告完成”安排；注入任一步失败，最多留下显式可恢复的未绑定产物，不得留下可用的虚假批准。
- 冷启动读取绑定后，重新检查真实路径/文件内容 revision；文件删除/替换/越界时产生 unavailable/stale，不信任上次内存 Map 或客户端摘要。
- 批准绑定当时的确切内容版本；内容后来改变，旧结论不能继续显示为对当前内容有效。读取和后续操作时重新验证 ID 与内容 revision，不以 UI 缓存充当权限或“当前评审有效”的证明。
- `Session.Info.workReview` 的读解码按 [fromRow](/home/keer/workspace/aigcfroge/packages/core/src/session/info.ts:20) 的既有模式接入；详情读取保留“损坏”和“不存在”的区别，不能因为摘要字段缺失就直接开放操作。
- 同一目标的并发 apply/approve 必须测试“文件内容—持久化引用—被审绑定”三者一致；复用 FileMutation/WorkArtifact 原有协调边界。若无法同时成功，至少一个操作明确冲突且读模型显示 stale/unavailable，不能两个都报成功却把错误对象显示为已批准。
- 本期优先在 mutation 成功后用返回值更新当前视图，再重取受影响的既有 Session/query。跨客户端同步复用 EventV2。
- **拟新增通知** `work.review.updated`，放在 WorkReview Effect owner，payload 仅含 sessionID、`Review.revision` 及必要的已验证视图/引用；它是 metadata 变更的投影通知，不是第二持久化真源，不包含完整正文/prompt。接入既有 event schema/bridge/reducer/SDK，不开新 SSE。
- 事件到达不能让低版本覆盖高版本；提交成功但通知丢失由 GET/reconnect 重建。通知失败要记录和可观察，不把“发出通知”当作持久化成功证明。

## 4. 每个 slice 的 TDD 工作流

### 4.1 三种用例身份

- **C（characterization）**：既有正确行为，预期开始即 GREEN；用来防回归。
- **R（new RED）**：本期真实缺口或新增契约；先看到与行为相关的失败，再写生产实现。
- **X（外部依赖/既有缺陷固定）**：例如 V2 admission gap、受限运行环境；不能冒充 R，也不能拿其绿色宣布产品可用。

R 必须能仅靠修改生产代码变绿。模块找不到、测试文件不存在、缺环境、导入异常、usage 打印、错误 fixture 和零测试不是有效 RED。必要的新模块先提供类型正确的最小外壳或从真实 HTTP/DOM 入口测缺失行为，不用 `expect(false).toBe(true)` 或只改测试才能成功的断言。

### 4.2 标准循环

1. **锁定**：读 slice 依赖和当前 diff；记录文件读写边界及 owner。已有改动不属于本 slice 的不暂存、不重置。
2. **补 C**：运行/补充最近的正确行为回归。若 C 红，按环境/依赖/行为归类找共因，先处理基线，不把它记作新需求 RED。
3. **写 R**：以 `AI-TDD-Sxx-Rnn` 命名；Arrange 使用真实生产数据形状，Act 调实际函数/工具物化/DOM/HTTP，Assert 验结果及副作用。
4. **确认 RED**：命令非 0 且失败用例确实执行；记录首个业务断言差异、失败原因与输出。为避免伪 RED，用小范围临时正确实现验证可变绿，再撤回该临时 patch，仅保存两次证据；不得用 reset 撤销用户工作。
5. **最小 GREEN**：只实现使该用例通过的 owner 内行为；修共同根因，不逐文件补 Layer。检查 Scope、错误、权限和中断路径。
6. **REFACTOR**：在绿色下复用→删除→归并→简化；不先为未来用途抽象。移除测试中复制的业务逻辑；依赖方向用 lint/类型契约，不用读源码 `toContain`。
7. **扩大验证**：焦点测试→相关测试家族→包 typecheck→适用 API/E3/E4；同一套 R 必须在重构后仍绿。
8. **差分审查**：`git diff -- <精确文件>`、权限/并发/恢复、生成物/i18n、日志脱敏；同步 owner 文档、manifest/debt。
9. **关闭**：所有必要检查有退出码、实际用例数和产物；没有证据的状态写未运行/依赖受阻。获得交付批准后才 commit/push/PR，RED patch 不推入需要持续绿的分支。

### 4.3 工具与 fixture

- Core Effect 用 [testEffect](/home/keer/workspace/aigcfroge/packages/core/test/lib/effect.ts)；OS/文件/网络走 live/scoped tmp fixture；纯规则用普通单测。
- 只在真正外部边界替换能力，优先 Layer.mock；不要自己写整套 Session runtime 或 monkey-patch globalThis。
- DOM 复用 `solid-js/web` render 与 app happydom；参考 [实际 DOM 断言](/home/keer/workspace/aigcfroge/packages/app/src/components/asset-load-error.test.tsx)。必须 dispose/remove，复杂 Context 用既有 provider，不新装 testing library。
- E3 可以使用现有受控 API fixture，但必须让真实组件/事件 reducer/用户操作执行。E4 禁止 page.route 截获业务网络来冒充真后端。
- 并发等就绪信号：Deferred/Latch、llm.wait、既有 waits/expect.poll。无固定 sleep、重试撞绿、仅延长 timeout。
- 新增可独立测试逻辑记录覆盖率，目标新增行覆盖至少 85%；这是本方案的切片质量目标，**不是声称仓库已有全局覆盖率门禁**。关键鉴权、冲突、拒绝/中断路径逐项必须有测试；覆盖率不能替代行为或 E4。

## 5. 切片依赖及边界

```text
S00 基线、执行契约、环境
 ├─ S01 Task 单契约切换与归属呈现 ───────────────┐
 ├─ S02 待决事项选择与焦点 ─ S03 回复 owner/并发 ┤
 └─ S04 @目录与真实运行关系 ────────────────┤
                                           └─ S05 生产 Icon/ToolRow
S00 ─ S06 WorkReview producer+API+SDK ─ S07 WorkReview UI/恢复
S01–S07 ─ S08 五模式/API/E3/E4 ─ S09 性能/差分/灰度/交付
```

R2默认按B1–B6串行交回；只有用户另行授权且已证明**无交叠写集**时才并行；触碰同一 `message-part`、schema、SDK、event reducer 或文档 owner 时必须串行整合。不因本文允许工作拆分而自动启动子代理或提交代码；实施分支/隔离工作树只按 §0.3 的本地 main 门禁建立。

## 6. 详细施工卡

命令使用 §7 定义的 `unit` / `e3` 函数。标记“拟新增”的测试文件应先创建；函数会拒绝不存在的路径，避免 Bun 静默忽略。

### S00 · 开工基线与执行契约

**对齐**：原计划 P0、quality-to-pr Intake/Reuse。**owner**：实施负责人 + QA。

**写集**：独立执行状态/证据账本，不改写已冻结计划；核对并记录必要的 S9A producer amendment（正式 owner 契约随 B4 实现同步）；不改生产行为。

- C：重新核对 27 项证据涉及的关键代码哈希；旧 274 通过结果只做参照，重新跑最相关家族。
- C：记录源目录 HEAD/branch/dirty diff、本地 mainBaseCommit、新分支名与创建瞬间 HEAD、implementationRoot、包 scripts、Bun 版本、工作区文件系统、当前运行服务/端口约束。确认新分支确从冻结的本地 main 建立；目标家族基线测试在新 checkout 重跑，不承接 local-cli-discovery 的未合并功能。
- C：确认 S9A 增量 D-D、待决排序和本期“流内摘要/Composer 作答”契约，写入实施记录。缺执行授权时可完成这些只读/文档动作，不冒充允许改代码。
- X：确认真实 E4 环境、隔离 HOME/XDG、provider stub/录制层、CI触发方式；不能因旧文档说 FUSE 就未经检测断言当前无法运行。

**退出**：本地 main 基线、单版本契约和新分支来源已有证据；代码修改的执行 gate 已满足；测试清单存在，不含未来接口假装当前能力。本步骤在未来执行时按用户授权创建新分支，不从当前分支继续；本次文档审批不实际创建。

### S01 · Task 单契约切换与真实归属呈现

**对齐**：P1、用户开发期不做兼容的决定、M7非兼容部分。**owner**：Core/Server/SDK/App/TUI；属于 B1，单独交回审批。

**目标**：复用 `SessionTask`/现有 `session.task` API与 `task.updated`，当前链路只使用含稳定ID/revision的六态 Task，不再输出/读取三字段 Todo投影，不新增另一个Task API。

**写集（实际调用链必须先查全）**：

- `packages/core/src/session/task.ts`、`session/todo.ts`、`tool/taskwrite.ts` 与被替代的 Todo工具/注册点；只做当前Task家族，不改provider循环。
- 当前HTTP的Task/Todo端点、工具定义及提示词、SDK生成物、App task query/event/store/progress/Hub、TUI/CLI实际消费者及各自fixture。
- 拟新增API测试：`/home/keer/workspace/aigcfroge/packages/aigcfroge/test/server/httpapi-session-task.test.ts`。

**先做C**：六态、稳定Task ID、revision冲突、schedule/DAG、agentID、outputDigest、子任务结算。旧兼容断言不再作为必须保留的C；把其中仍有价值的业务场景迁成规范Task测试，不用skip隐藏变化。

**R**：

- `AI-TDD-S01-R01`：当前Task详情显示真实agentID；未分配项不被默认为Session agent。
- `AI-TDD-S01-R02`：规范task.updated更新当前视图，折叠/焦点不被重置，store不创建session_todo旁路。
- `AI-TDD-S01-R03`：失败/取消/定时项写回保持六态；旧expectedRevision冲突时显示错误并重新取当前权威状态。
- `AI-TDD-S01-R04`：当前所有写入口/工具只产生规范Task结果；不再发布todo.updated或维持三字段兼容projection。
- `AI-TDD-S01-R05`：当前HTTP/生成SDK/App/TUI/CLI只读同一Task合同；旧Todo端点/方法/工具注册若已被替代，直接移除，不留alias/redirect/fallback。
- `AI-TDD-S01-R06`：task清空后，迟到GET和已失效连接回调不能恢复旧任务；切Session/Location也不接受旧请求结果。
- `AI-TDD-S01-R07`：仍在使用的默认执行链能经当前注册路径读写Task；不是只把前端字段改绿。若此切换要求修改非目标runtime，停止B1报告边界，不新增兼容桥绕过。
- `AI-TDD-S01-R08`：已退休的 `todos` 请求包装/旧端点不被适配成新合同，非法状态被当前Schema拒绝。规范创建动作仍可由服务端分配ID（这不是旧版本兼容）；规范更新使用稳定ID与当前并发规则，不能以“拒绝旧三字段”为名破坏合法创建。

**GREEN**：改齐生产者和消费者后，同批移除 `SessionTodo` facade、`TodoProjection/TodoUpdated`、仅供兼容的 `replaceLegacy`、`session_todo`/双源时间戳、`pickProgressTodos` 与无用 `sameTodoList`。先确认每项实际引用；当前需要的业务校验转回SessionTask，不把删桥当作删校验。

**同步规则**：保留唯一Task store；优先复用现有query/连接代际防止迟到响应。单行Task.revision不能充当全列表版本，空列表/删除不允许用max(row.revision)伪造顺序。若实际transport缺少可用顺序证据，数据事件只使当前query失效并合并拉取权威快照；不得发明新旧来源timestamp仲裁或承诺未经验证的任意乱序恢复。该选择在B1证据中给出真正的owner函数和测试。

**REFACTOR**：移除失去消费者的旧工具/fixture/注册项，规范当前工具名；不全仓重命名历史文档。旧模型训练习惯不是保留兼容工具别名的理由。

```bash
unit core test/session-task-service.test.ts
unit core test/tool-taskwrite.test.ts
unit core test/tool-task-update.test.ts
unit core test/task-progress.test.ts
unit aigcfroge test/server/httpapi-session-task.test.ts
unit app src/pages/session/timeline/session-todo-progress-model.test.ts
unit tui test/plugin/task-todo-project.test.ts
e3 e2e/regression/session-todo-progress.spec.ts
```

**退出**：规范合同端到端通，受影响包typecheck/行为测试绿，旧兼容符号无在线消费者；同批再生SDK。删改前后的命令与引用清单必须给出，不把旧协议测试继续绿作为验收。**撤销**：保存现场、回到受控开发快照；不要求新旧二进制互读，也不擅自删开发数据。

### S02 · 待决事项选择、草稿与焦点

**对齐**：P2、全局壳权限位置与 typed panel。**owner**：App。

**写集**：[request-tree](/home/keer/workspace/aigcfroge/packages/app/src/pages/session/composer/session-request-tree.ts)、[composer state](/home/keer/workspace/aigcfroge/packages/app/src/pages/session/composer/session-composer-state.ts)、[region](/home/keer/workspace/aigcfroge/packages/app/src/pages/session/composer/session-composer-region.tsx)、两个现有 Dock；不改领域授权算法。

**拟新增测试**：

- `/home/keer/workspace/aigcfroge/packages/app/src/pages/session/composer/session-request-tree.test.ts`。
- `/home/keer/workspace/aigcfroge/packages/app/e2e/regression/session-decision-surface.spec.ts`。

**R**：

- `AI-TDD-S02-R01`：同一 Session 同时收到 question/permission，仅一份活跃作答表单；其他请求可发现而非丢失。
- `AI-TDD-S02-R02`：已有活跃请求时新请求不抢焦；该请求解决后按 §2.2 选择下一项。
- `AI-TDD-S02-R03`：父/子请求、同字符串 ID 的不同 domain、切换 server/Location 不串草稿或 submitting。
- `AI-TDD-S02-R04`：未发送 prompt 的文字、图片、file/agent pill、selection，在问答开始/完成/失败/取消后保留。
- `AI-TDD-S02-R05`：中文 composing 和普通数字输入不触发选择/发送；Enter/Esc 只作用于激活控件。
- `AI-TDD-S02-R06`：切到 `/mode/:mode` 后权限仍能在 ApprovalCenter 找到并处理，不发生有 responder 无 UI 的等待。

**GREEN**：扩展已有请求选择/Composer store；复用 permission-pending 的判别类型，合并重复树遍历时保持父子/过滤行为；不创建全局 Gate store 或第二个执行状态机。真正跨组件共用的纯选择逻辑才抽取。

**REFACTOR**：删除不再使用的并行可见性分支，保留 Revert/Followup 的原语义；停止监听时移除 DOM handler。

```bash
unit app src/pages/session/composer/session-request-tree.test.ts
unit app src/context/global-sync/permission-pending.test.ts
unit app src/components/approval-center.test.ts
e3 e2e/regression/session-decision-surface.spec.ts
```

**退出**：焦点/草稿由真实 DOM/E3 证明，不用源码 `toContain`；无自动批准。**回退**：撤展示协调，仍使用原服务和端点。

### S03 · 回复路由、授权与一次终态

**对齐**：P2、当前问题/权限owner及其实际运行链；不建立旧版本支持矩阵。**owner**：Question/Permission/Core/Server。

**写集**：[Question owner](/home/keer/workspace/aigcfroge/packages/core/src/question.ts)、[Permission owner](/home/keer/workspace/aigcfroge/packages/core/src/permission.ts)、[reply adapter](/home/keer/workspace/aigcfroge/packages/app/src/context/global-sync/permission-pending.ts)、[QuestionDock](/home/keer/workspace/aigcfroge/packages/app/src/pages/session/composer/session-question-dock.tsx)；handler/bridge 仅在用例证明归属问题时修改。

**测试**：扩展现有 question/permission suites；拟新增 `/home/keer/workspace/aigcfroge/packages/aigcfroge/test/server/httpapi-decision-ownership.test.ts`。真实 HTTP group 使用 repo Effect/NodeHttpServer 测试模式，不用复制业务的假路由。

**C/R，先测再决定是否改代码**：

- `AI-TDD-S03-R01`：当前实际运行链产生的question/permission请求在正确owner结算；不猜ID、不保留旧请求格式，也不用写接口fallback。仍活跃的不同owner若无法同批统一，不新增转换层，提交真实调用链交回审批。
- `AI-TDD-S03-R02`：错误 Session/Location 的 requestID 被拒绝，原请求保持 pending。
- `AI-TDD-S03-R03`：两个客户端同时 reply/reject 同一请求，只有一个合法终态；丢响应后重取状态，不能重复 grant。
- `AI-TDD-S03-R04`：once、always、session、location 行为及保存/消费范围一致；WorkReview 操作不能触发其中任何授权。
- `AI-TDD-S03-R05`：拒绝/修正反馈和同 Session 关联请求的既有传播规则不变。
- `AI-TDD-S03-R06`：服务 finalizer、取消、无 responder、持久化/事件发布失败不遗留不可回答 pending 或成功假象。

**GREEN**：若当前实现已满足则只新增回归。若竞争可复现，在现有 pending owner 的终态临界区修复；仅禁止前端双击不足。保持中断/defect，不用 catchCause 吞掉它们。

```bash
unit core test/question.test.ts
unit core test/tool-question.test.ts
unit core test/permission.test.ts
unit core test/permission-grants.test.ts
unit aigcfroge test/server/httpapi-decision-ownership.test.ts
unit app src/pages/session/composer/session-permission-dock.test.tsx
```

**退出**：从工具定义物化到执行授权、HTTP归属、真实回复均有断言；不是仅测试 assert helper。**回退**：按原 owner 回退，保留当前合法授权数据；不能靠清空授权表解决失败。

### S04 · @目录与 Agent Hub 的真实关系

**对齐**：P3、ADR-22、持久委派 Phase 6。**owner**：App/Agent。

**写集**：[prompt input](/home/keer/workspace/aigcfroge/packages/app/src/components/prompt-input.tsx)、[PromptPopover](/home/keer/workspace/aigcfroge/packages/app/src/components/prompt-input/slash-popover.tsx)、[Hub model](/home/keer/workspace/aigcfroge/packages/app/src/pages/session/timeline/agent-task-hub-model.ts)、[Hub](/home/keer/workspace/aigcfroge/packages/app/src/pages/session/timeline/agent-task-hub.tsx)、[Delegation model](/home/keer/workspace/aigcfroge/packages/app/src/pages/session/timeline/delegation-panel-model.ts)。

**拟新增 E3**：`/home/keer/workspace/aigcfroge/packages/app/e2e/regression/prompt-agent-directory.spec.ts`；扩展 build-request-parts、Hub/Delegation model 现有测试。

**R**：

- `AI-TDD-S04-R01`：目录展示真实可用 Agent 与来源；隐藏/禁止项不能通过另一入口重新选中。
- `AI-TDD-S04-R02`：选择只插入结构化 agent part，保持编辑焦点；单击不会发送 prompt/启动 task。
- `AI-TDD-S04-R03`：同名 Agent 的两个 child Session/Participant 独立显示；Task 无归属项不被过滤消失。
- `AI-TDD-S04-R04`：运行状态/跳转来自具体稳定 ID；摘要文字变化不改变关系。
- `AI-TDD-S04-R05`：未知/缺失能力不能显示可用的 steer/resume/interrupt；执行时仍由服务端拒绝越权。
- `AI-TDD-S04-R06`：Custom allowlist、禁止后台委派、模式切换不重分类 Session 等已有门禁不退化。

**GREEN**：复用已有候选、part builder、提交通道、Hub布局和 Delegation能力判断；不新建 dispatch API 或完整图形库。

```bash
unit app src/components/prompt-input/build-request-parts.test.ts
unit app src/components/prompt-input/submit.test.ts
unit app src/pages/session/timeline/agent-task-hub-model.test.ts
unit app src/pages/session/timeline/delegation-panel-model.test.ts
e3 e2e/regression/prompt-agent-directory.spec.ts
e3 e2e/regression/agent-task-hub.spec.ts
```

**退出**：目录、实例与能力不会混为一谈；实际请求沿既有链路。**回退**：恢复原列表，不删除 Delegation/Task 记录。

### S05 · 生产 Icon / ToolRow / 历史记录

**对齐**：P4、DESIGN、M7。**owner**：Session UI/UI/App。

**写集**：[BasicTool](/home/keer/workspace/aigcfroge/packages/session-ui/src/components/basic-tool.tsx)、[message-part](/home/keer/workspace/aigcfroge/packages/session-ui/src/components/message-part.tsx)、[Icon字典](/home/keer/workspace/aigcfroge/packages/ui/src/v2/components/icon.tsx)、对应 CSS/stories/i18n；只通过 [Data context](/home/keer/workspace/aigcfroge/packages/session-ui/src/context/data.tsx) 等已有边界向上交付动作。

**拟新增**：

- `/home/keer/workspace/aigcfroge/packages/app/src/components/basic-tool-render.test.tsx`（复用 App 的 happydom/browser 条件；import 并执行真实 session-ui 组件，不复制实现）。
- `/home/keer/workspace/aigcfroge/packages/app/e2e/regression/session-tool-row.spec.ts`。

**R**：

- `AI-TDD-S05-R01`：真实生产 BasicTool 消费传入的语义图标；help/permission/task 等新接线名称不落入 plus fallback。
- `AI-TDD-S05-R02`：pending/running/completed/error/interrupted 的标签、可展开性、错误可见性正确；无可展开内容不生成假操作。
- `AI-TDD-S05-R03`：旧动态 trigger、triggerHref、locked、defer、animated 保持行为；终端/长输出和 Diff 不因单行化丢失。
- `AI-TDD-S05-R04`：规范Task写入工具历史记录默认紧凑；展开仍是当次调用内容，后续任务修改不覆盖历史。
- `AI-TDD-S05-R05`：Question 未回答显示等待/定位，回答后显示只读结果；流内不挂第二份提交器。
- `AI-TDD-S05-R06`：thinking、终端、read/search、edit、task/delegation、todo、question、skill、MCP、unknown generic 工具均有适用状态样例，未知类型有明确安全通用呈现。
- `AI-TDD-S05-R07`：图标装饰元素对读屏隐藏，交互控件有名称/键盘操作；英文/中文长文本、light/dark、窄屏、缩放和 reduced-motion 不裁切关键动作。

**GREEN**：从生产 registry 到真实组件接通。优先复用 sprite/字典中的 SVG，新增只补缺口；不安装 icon npm 包。新视觉 token 化，不为这个任务重写主题引擎。

**REFACTOR**：统一实际使用的语义映射，避免在 registry、row、Popover 三处各写一份。不要为了“v2”命名把已经可用的生产组件换成缺失契约的故事组件。

```bash
unit app src/components/basic-tool-render.test.tsx
unit session-ui src/components/task-tool-card-model.test.ts
unit session-ui src/components/delegation-tool-card-model.test.ts
e3 e2e/regression/session-tool-row.spec.ts
e3 e2e/regression/session-todo-progress.spec.ts
```

**退出**：通过生产入口验证，不只看 story。**回退**：renderer/style 回退，不恢复旧数据库或改历史消息。

### S06 · WorkReview producer、API、SDK 与读回

**对齐**：P5、S9A §6、本文 §3。**owner**：Core/Schema/Server/API。

**写集**：现有 WorkReview schema/纯状态机保持 owner；新增 §3.1 的 Effect producer；Session schema/info、WorkArtifact、Location layer；现有 server.session group/handler/error映射；必要 bridge；SDK/OpenAPI生成物；S9A 契约同步。

**拟新增测试**：

- `/home/keer/workspace/aigcfroge/packages/core/test/work-review-service.test.ts`。
- `/home/keer/workspace/aigcfroge/packages/core/test/work-review-persistence.test.ts`。
- `/home/keer/workspace/aigcfroge/packages/aigcfroge/test/server/httpapi-work-review.test.ts`。

**C**：原WorkReview四态迁移规则、artifact路径/冲突、SessionInfo/fromRow及当前WorkContract/ad-hoc业务规则。直接更新fixture到新增必需字段，不为旧fixture保留解析分支；原12通过不能冒充新合同验收。

**R**：

- `AI-TDD-S06-R01`：真实 producer submit 后 DB metadata、详情 GET、Session.Info.workReview 三者一致；不能只在 fixture 手填 metadata 再测读取。
- `AI-TDD-S06-R02`：合法生命周期与非法迁移；请求不能直接写 next state、owner、timestamp 或任意 metadata。
- `AI-TDD-S06-R03`：保留 metadata 其他键；合法无 review 的 ad-hoc 不被强制迁移；坏Review或缺少其必需字段显式unavailable，不补旧格式默认值。
- `AI-TDD-S06-R04`：同版本并发两个命令一个成功一个冲突；失败不增版本；旧 approve 在 reopen 后仍拒绝。
- `AI-TDD-S06-R05`：客户端 artifact ID/revision 与真实 Session/Location/内容不符时拒绝；approve 不产生 permission grant。
- `AI-TDD-S06-R06`：文件已写、引用未存/DB写失败、通知失败等故障注入不会产生虚假有效批准；可通过权威 GET 恢复解释。
- `AI-TDD-S06-R07`：销毁并重建服务 scope 后，用同一 SQLite 和真实文件重取状态；不依赖旧 Map。
- `AI-TDD-S06-R08`：artifact 删除/替换/符号链接越界时不得沿用旧 verdict；真实内容改变后结论对当前内容失效。
- `AI-TDD-S06-R09`：错误 Session/Location/Mode、无权限、损坏存储返回声明的 typed error；handler 不泄露内部路径/正文。
- `AI-TDD-S06-R10`：新路由 identifier 生成到实际 SDK namespace，方法可调用；body/status/error 与 OpenAPI一致。
- `AI-TDD-S06-R11`：当前App实际读取路径/SDK直接读取规范Review；不再另供旧外观。不能通过全局开启V2 runtime绕过当前调用链测试。
- `AI-TDD-S06-R12`：重复/乱序 work.review.updated 不回退版本；丢通知后重载从持久化 owner 恢复。
- `AI-TDD-S06-R13`：Review.revision是唯一并发修订号；无记录才允许expected=0，存在但缺revision/artifactID的记录不可当新记录自动初始化。
- `AI-TDD-S06-R14`：A已批准后换成同内容hash的B不能继承批准；re_review/reopen显式重新绑定，旧命令因修订号冲突失败。
- `AI-TDD-S06-R15`：认证启用时缺凭证/错凭证401；SessionLocation只定位不充当角色鉴权；body伪造actor/owner不能改变可信上下文。
- `AI-TDD-S06-R16`：并发artifact apply与approve最终绑定真实目标；不能两个都报成功却显示错误对象的有效批准，冲突/部分失败必须显式可恢复。
- `AI-TDD-S06-R17`：submit(A)→apply(B)使open过期后，可显式re_review(B)→approve(B)；旧A命令仍被拒绝；未过期open、revision冲突和不可用B不能借自转换放行。

**GREEN**：按 §3 逐条实现，先 producer+数据库行为，再 HTTP/SDK；如前置 WorkContract 持久化在本基线不存在，记录为既有 S9A 前置缺口并修同一入口，不能用测试直接灌数据掩盖无生产 writer。

**REFACTOR**：纯规则仍在 WorkReviewMachine，权限仍在原 owner；metadata 更新不拆成 App/handler/producer 三套。新多字段契约用 Schema，typed errors 有可读 message；不用裸接口假装端到端合同。

```bash
unit core test/work-review-lifecycle.test.ts
unit core test/work-review-service.test.ts
unit core test/work-review-persistence.test.ts
unit core test/artifact.test.ts
unit core test/artifact-contract.test.ts
unit aigcfroge test/server/httpapi-work-review.test.ts
# 完成 schema/route 后执行 §7.4 的生成与 drift 门禁
```

**退出**：生产 HTTP 可完成写→读→重建；generated client 实际调用成功；所有服务依赖在组合根提供。可以作为完整 API 切片交付，但没有 S07 UI/E4 时不能宣称产品交互闭环。

**回退**：停止新写入并保存当前数据/代码快照；不存在旧版互读保证，不补兼容JSON。需要恢复旧开发数据快照或重置fixture以外数据时先取用户明确授权；无自动DDL down/清库。

### S07 · WorkReview UI 与真实恢复生命线

**对齐**：P5、S9A producer/E4、现有 Work 侧栏。**owner**：App/Work/QA。

**写集**：[WorkArtifactPanel](/home/keer/workspace/aigcfroge/packages/app/src/pages/work-artifact-panel.tsx)、相关 typed side panel/query/model；复用 S02 定位/焦点能力，但不把 WorkReview 当 Question/Permission。

**拟新增**：

- `/home/keer/workspace/aigcfroge/packages/app/e2e/regression/work-review-lifecycle.spec.ts`。
- `/home/keer/workspace/aigcfroge/packages/app/e2e/real/work-review-lifeline.spec.ts`。

**R**：

- `AI-TDD-S07-R01`：从真实 Work artifact 打开评审，显示所审确切版本；无记录、ready、unavailable、stale 的操作不同。
- `AI-TDD-S07-R02`：submit→要求修改→回应→复审→批准→重开，每一步走 S06 SDK，只有服务端成功才显示成功。
- `AI-TDD-S07-R03`：快速双击/两个页面提交同版本，冲突页面重新拉取，不覆盖新结果，不自动重试写命令。
- `AI-TDD-S07-R04`：网络/权限/版本失败保留用户选择或反馈，显示可恢复错误；关闭面板不拒绝其他问题/权限。
- `AI-TDD-S07-R05`：页面 reload 后仍读同一 metadata/内容绑定；重启 harness 自己的 backend 后仍可验证，不误认旧内存状态。
- `AI-TDD-S07-R06`：从真实 provider turn 产生可用 artifact，随后经真实 UI/API 完成 review；不以直接 seed 最终 approved 状态冒充链路。
- `AI-TDD-S07-R07`：review 不启动 provider、不改变 permission grant、Mode、Agent；ad-hoc 无 review 路径仍合法。

**GREEN**：复用侧栏与现有 SDK/query；显式动作驱动，默认不抢 Composer。权限边界按§3.3的现有操作者信任模型执行；不凭按钮文案声称存在独立reviewer身份认证。

```bash
unit app src/pages/work-artifact-panel.test.ts
unit app src/pages/work-artifact-error.test.ts
e3 e2e/regression/work-review-lifecycle.spec.ts
# 新增真实 spec 后执行 §7.5 的指定 E4
```

E4复用 [fixture](/home/keer/workspace/aigcfroge/packages/app/e2e/real/fixture.ts)、[orchestrator](/home/keer/workspace/aigcfroge/packages/app/e2e/real/orchestrator.ts:196) 的 `/e4/restart-backend` 与健康就绪接口，仅操作 harness 启动的隔离进程；不重启用户现有 App/Server，不再写一套重启管理器。

**退出**：trace + SQLite/GET证据 + manifest/version/teardown 能对上同一次 run。缺真实 E4则本切片仍未完成。**回退**：回退 UI，保留可解释的评审事实。

### S08 · 五模式与当前跨层整体验收

**对齐**：P6、全局壳/测试指南。**owner**：QA + 各层负责人。

**拟新增共享展示 spec**：`/home/keer/workspace/aigcfroge/packages/app/e2e/regression/agent-interaction-presentation.spec.ts`；按现有 presentation-matrix 的标签约定运行，不伪造第六套项目配置。

**R/C**：

- `AI-TDD-S08-R01`：chat/coding/work/assistant/custom 共用组件，但各自可用操作与 scope 正确；Mode切换不新建或重分类 Session。
- `AI-TDD-S08-R02`：隐藏 Mode slot 不增加网络/SDK/SSE effect；恢复 slot 不丢草稿或重复提交。
- `AI-TDD-S08-R03`：父子会话、两个 server/Location、多个 Delegation 不串状态；不存在/不支持能力显式失败。
- `AI-TDD-S08-R04`：light/dark、en/zh、narrow/desktop、键盘/reduced-motion；测试打实际 `@presentation`/`@a11y` 标签，确实进入矩阵。
- `AI-TDD-S08-R05`：规范Task事件、当前问题/权限owner、TUI投影与生成SDK同一版本可用；已退休旧格式不再处理。没有重写入场/provider循环或创建第二ToolRegistry。
- `AI-TDD-S08-R06`：E4 provider 调用及持久化结果是真实产品链；已有 V2 gap pin 的绿色单独记 X，不计为 Custom 正向执行成功。

**命令**：跑 S01–S07 的完整相关 spec、受影响包全套与 §7 的 API/E3/E4。仅跑 -g 新用例不足以关闭本阶段。

**退出**：适用矩阵通过；环境/既有 runtime缺口按 §9 处理，未获批准不能缩减完成定义。**回退**：定位最小 slice；不得通过 skip/fixme 或篡改旧缺陷 pin 让总览变绿。

### S09 · 清理、性能、灰度和交付

**对齐**：P6、quality-to-pr 最终 Gate。**owner**：实施负责人/QA。

- C：复查所有 registry/导入引用后，删除无挂载 TodoDock 残留与本次形成的死代码；这只是清理，不能计作释放视口的新功能。
- C：相同机器/生产构建条件下串行跑既有 timeline、tab-switch/flash benchmark；比较前后 trace，不设机器相关硬阈值。
- C：桌面包/IPC相关变更跑 desktop实际测试与 smoke；即便只共享 App UI，也要按发布目标验证 packaged Electron 呈现。TUI相关投影测试必须保留。
- C：SDK/OpenAPI无drift；文档 owner、S9A、技术债和 coverage-manifest 与实际交付一致。
- C：保留可恢复的开发代码/数据快照，验证停止变更和恢复程序；不保证旧二进制解释新格式，不为回退写适配器，禁止未经授权清库/reset用户工作区。
- X：灰度/远程操作需明确批准，记录验证版本、观察窗口、异常和回退点；不得自行定义生产 rollout 百分比或自动向用户外系统发布。

**硬停止条件**：任务丢失、跨 scope串台、隐式批准/越权、请求无法回答、当前在线调用链断裂、review旧版结论仍生效。出现任一即停止交付/放量，归因到原 owner。

**退出**：所有必需门禁有实际证据；用户批准 diff、分支/远程/issue 后才提交/推送/PR。提交列表由命令生成，不手写数量。没有批准则交付停在本地可审查状态。

## 7. 可复制运行手册

以下是**实施时命令**；本次只编写文档，并未执行这些未来测试。新文件必须先写入，不存在即拒跑。

### 7.1 初始化与焦点命令

从 Bash 执行；先把 ROOT 设置为已从冻结本地 main 新建分支的 implementationRoot，把 MAIN_BASE_COMMIT 设置为审批记录的 mainBaseCommit，不能照抄源目录作为实施目录。文中源码绝对路径是审查定位地址，实施时映射为 ROOT 下同一仓库相对路径；获批计划/审批文件仍从源目录只读。RUN 在仓库外，避免测试输出污染工作树；关闭 slice 前归档必要证据。

```bash
: "${ROOT:?先设置为实施新分支所在的 checkout}"
: "${MAIN_BASE_COMMIT:?先设置为审批记录的 mainBaseCommit}"
git -C "$ROOT" merge-base --is-ancestor "$MAIN_BASE_COMMIT" HEAD || exit 2
test -n "$(git -C "$ROOT" branch --show-current)" || exit 2
test "$(git -C "$ROOT" branch --show-current)" != main || exit 2
export RUN="$(mktemp -d /tmp/agent-interaction-tdd.XXXXXX)"

git -C "$ROOT" rev-parse HEAD > "$RUN/head.txt"
git -C "$ROOT" status --porcelain > "$RUN/status.txt"
bun --version > "$RUN/bun-version.txt"

unit() {
  local pkg="$1" file="$2"
  shift 2
  test -f "$ROOT/packages/$pkg/$file" || {
    printf 'Missing test file: %s\n' "$ROOT/packages/$pkg/$file" >&2
    return 2
  }
  (
    cd "$ROOT/packages/$pkg" || exit 2
    if [ "$pkg" = app ]; then
      bun run test:unit:file --timeout 30000 "$file" "$@"
      exit "$?"
    fi
    bun test --timeout 30000 "$file" "$@"
  )
}

e3() {
  local spec="$1"
  shift
  test -f "$ROOT/packages/app/$spec" || {
    printf 'Missing E3 spec: %s\n' "$spec" >&2
    return 2
  }
  (
    cd "$ROOT/packages/app" || exit 2
    bun run test:e2e:local "$spec" --project=chromium --workers=1 --retries=0 "$@"
  )
}
```

运行 E3/benchmark 前检查测试端口与服务归属；端口冲突用已有 `PLAYWRIGHT_PORT` 等配置切换，不能停止用户服务。E4使用自己现有的隔离环境/ports/orchestrator。

### 7.2 RED / GREEN / REFACTOR 证据

以 S02 为例，先创建对应测试，再执行：

```bash
set +e
unit app src/pages/session/composer/session-request-tree.test.ts \
  -t 'AI-TDD-S02-R01' > "$RUN/S02-red.log" 2>&1
red_rc=$?
set -e
printf '%s\n' "$red_rc" > "$RUN/S02-red.exit"
test "$red_rc" -ne 0
```

这只检查退出码，**还必须人工核对日志中测试确实运行、失败是预期业务差异**。0 tests、usage、缺模块、导入异常或 fixture错误一律修正后重跑，不是 RED证据。

最小实现后执行同一命令保存 `S02-green.log/exit`，要求 exit 0、用例数大于0、无新增 skip；重构后再保存 `S02-refactor.log/exit`。保存测试补丁与实现 diff，并记录把正确生产实现临时撤回后 R 再红的反证。不要为取反证覆盖他人的改动。

### 7.3 包级门禁

每个 slice 按写集选包，不把一次 package typecheck 等同全项目绿：

```bash
(cd "$ROOT/packages/core" && bun run typecheck && bun run test)
(cd "$ROOT/packages/schema" && bun run typecheck && bun run test)
(cd "$ROOT/packages/server" && bun run typecheck)
(cd "$ROOT/packages/session-ui" && bun run typecheck && bun run test)
(cd "$ROOT/packages/ui" && bun run typecheck && bun run test)
(cd "$ROOT/packages/sdk/js" && bun run typecheck)
(cd "$ROOT/packages/app" && bun run typecheck && bun run test)
(cd "$ROOT/packages/tui" && bun run typecheck && bun run test)
```

App 的 `test` 是复合脚本，不给它追加 `--timeout` 期待影响所有子命令。焦点用 `test:unit:file`；全包用原脚本，以实际 tally为准。禁止 `bun --cwd <pkg> run <script>` 的历史空绿陷阱；这里统一 `cd && bun run`。

新增逻辑的覆盖率示例（创建测试文件后）：

```bash
unit core test/work-review-service.test.ts   --coverage --coverage-reporter=lcov --coverage-dir="$RUN/S06-coverage"
```

按本次新增/修改逻辑行核对报告，记录未覆盖分支原因，不用外部模块的大量覆盖行稀释指标；关键负路径仍逐条过门禁。

### 7.4 Schema、HTTP 与 SDK

```bash
(cd "$ROOT" && ./packages/sdk/js/script/build.ts)
(cd "$ROOT" && bun run script/check-openapi-drift.ts)
unit aigcfroge test/server/httpapi-sdk.test.ts
unit aigcfroge test/server/httpapi-work-review.test.ts

(cd "$ROOT/packages/aigcfroge" && \
  bun run script/httpapi-exercise.ts --mode coverage --fail-on-missing --fail-on-skip)
(cd "$ROOT/packages/aigcfroge" && \
  bun run script/httpapi-exercise.ts --mode auth --fail-on-missing --fail-on-skip)
(cd "$ROOT/packages/aigcfroge" && \
  bun run script/httpapi-exercise.ts --mode effect)
```

coverage/auth是仓库硬门禁。effect全量当前是advisory，单独记录已有失败；**本次新增端点必须由真实调用测试证明有效**，不能借advisory跳过自己的失败，也不擅自修改全仓CI政策。

不手改生成 SDK/OpenAPI掩盖 drift。只有 Schema/HTTP完成后才生成；每个新 identifier都检查客户端方法存在且可调用。

### 7.5 E3/E4 与展示矩阵

```bash
# 本期真实新增展示spec创建并打好标签后
(cd "$ROOT/packages/app" && bun run test:e2e:local   e2e/regression/agent-interaction-presentation.spec.ts   --project=chromium --project=chromium-dark --project=chromium-zh   --project=chromium-narrow --workers=1 --retries=0)

# 真后端WorkReview生命线：先确认fixture/ext4/隔离环境就绪
(cd "$ROOT/packages/app" && \
  E4_RUN_DIR="$RUN/e4-work-review-default" bun run test:e2e:real   work-review-lifeline.spec.ts --project=chromium-real --workers=1 --retries=0)

# 正向默认链完整回归
(cd "$ROOT/packages/app" && \
  E4_RUN_DIR="$RUN/e4-default" bun run test:e2e:real   --project=chromium-real --workers=1 --retries=0)

# 既有V2现状单独运行、单独报告；不以其绿色宣称缺口已修
(cd "$ROOT/packages/app" && \
  E4_V2_RUNTIME=1 E4_RUN_DIR="$RUN/e4-v2" bun run test:e2e:real   --project=chromium-real --workers=1 --retries=0)
```

若实际 config包含 zht 且变更影响繁体文案，加入相应project。执行前用 `test:e2e:local --list` 核对新spec实际被选中；listing不是运行证据。

CI E4只在非PR事件执行；V2 step默认可能被前一步失败跳过。完整验收要有明确触发方式并读回每个variant结果；是否调整CI隔离为独立job或 `if: always()`，须在单独验证安装/setup前提后做，不能盲目修改一行然后声称所有情况都运行。

### 7.6 生产基准与最终差分

```bash
(cd "$ROOT/packages/app" && bun run test:bench)
# 仅在本次/发布目标需要时运行桌面门禁
(cd "$ROOT/packages/desktop" && bun run typecheck && bun run test)
# 桌面实际E2E会构建独立测试产物，确认环境后再执行
(cd "$ROOT/packages/desktop" && bun run test:e2e)

(cd "$ROOT" && LINT_BASE_REF="$MAIN_BASE_COMMIT" bun run script/lint-changed.ts)
(cd "$ROOT" && bun typecheck)
(cd "$ROOT" && bun run lint)
git -C "$ROOT" diff --check
```

benchmark基于现有生产构建场景、串行；分别保存before/after。最终 diff/lint 使用冻结的 MAIN_BASE_COMMIT，不用移动后的 main/origin/main，更不能当前 main 自比造成空绿。`git diff --check` 不涵盖未跟踪文件，新增文件还需独立格式/链接/空白校验。

## 8. 证据账本与PR验收模板

每个 slice 保存一份记录，字段固定；这只是记录格式，未填充项不能填“通过”：

```text
slice: Sxx
requirement_ids: AI-TDD-Sxx-Rnn ...
source_head / main_base_commit / new_branch / creation_head / implementation_root:
baseline_head / implementation_head / dirty_scope:
owner / reviewer:
existing_C / new_R / dependency_X:
test_files: existing | added
RED: command, cwd, exit, executed_count, first_expected_failure, log
GREEN: same_command, exit=0, executed_count, assertions, log
REFACTOR: command, exit, scope_diff
package_checks / API / SDK / E3 / E4 / benchmark:
fixture: scope, provider, DB, ports, cleanup
manifest / trace / screenshots / teardown:
security: session+Location owner, no implicit approval, stale/conflict/interrupt
single_contract: current producers/API/SDK/App/TUI, retired paths, no adapters
recovery: controlled development snapshot; no unauthorized reset
unverified: exact reason, owner, unlock, ledger_id
```

每个新增R必须能映射到一个真实测试和生产owner；表述型场景若无法自动化，记录人工步骤与证据，不伪造测试数量。

共享 UI 新增/变更补 story；story 是状态展示，不替代行为证明。文案走 i18n/parity，样式走 v2 token；不做全仓格式化。

发布前检查清单：

- [ ] S00本地 main 冻结提交、新建分支来源、执行授权与工作树归属明确。
- [ ] S01–S07所有R有有效RED、同测试GREEN、重构后回归。
- [ ] 关键权限/并发/恢复负路径无skip，当前单契约链路/五模式范围按定义验收。
- [ ] WorkReview不是只有schema/pure machine；真实producer、读回、SDK、UI、E4证据齐全。
- [ ] 生产消息入口改变，而非只改BasicToolV2 story。
- [ ] API identifiers/生成SDK方法实际调用有效，无手改生成物。
- [ ] 测试端口/Scope/进程清理可追溯，没有重启用户服务。
- [ ] before/after基准同口径，桌面/TUI发布目标有实际证据。
- [ ] 未交付项已登记owner/unlock；不把缺陷pin或CI跳过算通过。
- [ ] 回退不丢Task/权限/Review事实；最终diff获批。
- [ ] 用户授权commit/push/PR；每批列表由 `git log --oneline "$PREVIOUS_CHECKPOINT"..HEAD` 生成。

## 9. 外部依赖与延期边界

本期不能通过“待后续”掩盖必需功能，但也不能把其他系统的大重构暗中塞进UI计划。

### X01 · V2/Custom执行缺口

依据 [v2-admission-gap.spec](/home/keer/workspace/aigcfroge/packages/app/e2e/real/v2-admission-gap.spec.ts:1) 与 [技术债账本](/home/keer/workspace/aigcfroge/docs/technical-debt.md)，存在“绿色表示缺口仍在”的现状固定测试。开工先查当前实现与实际探针，不能仅依据文档假定今天仍相同。

若缺口仍在：S01–S07可继续做已界定交互/API工作；**Custom完整provider正向E4不能宣布完成**。owner为Core运行时负责人，unlock为既有runtime闭环计划/显式授权及正向E4。没有授权，不在本计划改Session admission/runner；没有关闭或获批scope-cut，不关闭S08完整交付。

### X02 · E4环境与矩阵广度

owner为QA/CI。unlock为稳定生产构建、隔离环境、真实存储/文件/PTY/provider路径。不能以E3 mock替代E4，也不把一次无法运行泛化为所有环境不可行。

S9A允许讨论单backend MVP与后续cross-server/历史/失败广度，但其最终scope仍需显式批准；完整目标默认保留，本期若缩减必须同步ledger，写清剩余用例和解锁条件。

### X03 · 当前调用链的原子切换边界（不是兼容窗口）

owner为Core/API/App/TUI。用户已明确不做旧版本兼容，不再等待旧客户端退役。Task家族在B1按S01切换；其他被修改的合同直接改齐当前消费者。若某条仍活跃的默认执行链需要超出本期边界的重构，提交调用链、缺口和最小切换方案暂停对应批次，不编写临时adapter/fallback，也不擅自删整个运行时。

### X04 · 原生竞品Map与完整图形拓扑

owner为产品/设计。unlock为具体产品/版本、可复现证据及新的需求批准。本期交付是基于真实本地能力的目录/树，不依赖这项；原文“首创/完整原生Map/80%”不转成验收条件。

### X05 · 超出本期的全域审批和自动恢复

owner为对应领域负责人。unlock为PRD/ADR增量：跨所有Mode硬审批、自动provider重试、跨进程集群协调、未知CLI恢复能力。未批准不实现；不能用WorkReview approve隐式实现权限或执行恢复。

每个slice结束前，把实际未交付项写入 [coverage-manifest](/home/keer/workspace/aigcfroge/packages/app/e2e/coverage-manifest.json) 的既有结构或 [technical-debt](/home/keer/workspace/aigcfroge/docs/technical-debt.md) 的现有owner条目，至少包含scope/test/status/owner/unlock；不再建另一个长期债务真源。

## 10. 文档同步、回退与执行交接

### 10.1 同步规则

- 已审批本文保持冻结，slice 状态与执行证据写独立执行账本；领域事实/批准决策仍回各 owner 文档。需要改变本文时先交回复审并重新锁定 planSha256，执行者不能自行改哈希放行。
- S01/S05→Todo/Task方案与适用状态记录；不得将保留的M7规则改写为尚未实现。
- S04→ADR-22/委派方案的UI接线状态；不覆盖其runtime/恢复决策。
- S06/S07→S9A producer、唯一 Review 的 revision/artifactID、WorkArtifact 可恢复引用、API/读取与E4状态；删除“已存在服务/接口”的错误描述。
- S08/S09→docs/testing的实际命令差异、coverage-manifest/debt与发布证据；不为本任务改历史统计。
- 原审查报告保留事实核验，只添加本TDD方案链接，不把审查日的274通过数更新成未来验收结果。

### 10.2 回退演练

在隔离测试环境用当前合同创建Task六态、pending权限/问题与WorkReview各态样本；保存配套代码/数据快照并验证停止写入与受控恢复，不承担旧代码读取新Schema的兼容。回退不自动做DDL down/purge/数据转换，不自动重跑provider；恢复真实开发数据快照必须用户明确授权。切片失败保存现场并交回审批。

### 10.3 可直接交给实施者的任务单

> 以本文件R2为开发期单契约TDD施工入口，先执行S00并核对审批哈希、本地mainBaseCommit与源工作树dirty scope，从该本地main提交新建分支且隔离既有工作；首次只完成B1后停止交回审查。保留Task/Permission/Question/WorkReview各自owner，不做旧版本适配、双写或数据格式fallback，不重写V2运行时。逐slice先运行C，再编写有行为依据的R，确认有效RED后做最小GREEN并重构。新文件标记为拟新增，先创建再运行，拒绝0测试空绿。每个slice给出命令、退出码、tally、diff、失败/恢复证据及未交付账本。不得仅改story、仅测helper或用E3替代E4。没有用户交付批准，不commit/push/创建PR或操作生产服务。

## 11. 文档编制与审批边界

R1只新增方案及审查报告入口；R2按用户开发期不做兼容的决定修订，并补足Review身份/并发/授权边界。本轮仍未创建拟新增生产/test文件、未运行未来RED/GREEN、未改变权限或产品行为。审批记录和执行提示词单独保存。

文档校验包括：现有引用路径和行号、拟新增文件与现有文件的区分、case ID唯一性、slice依赖、package scripts/测试参数、代码块闭合、链接与空白。执行方案中的产品测试和发布门禁仍由实际实施轮次逐项完成。
