# AigcForge V2 当前交接入口

更新：2026-10-29。本页只提供当前新会话入口，并保留旧交接正文供历史核对。唯一总计划：[V2 对齐计划](../research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md)；[批次计划](../research/upstream-v2-sync/2026-10-29-migration-batch-plans.md)与[完整提示词目录](../research/upstream-v2-sync/2026-10-29-migration-session-prompts.md)是执行附件。

当前范围：B00 协议/路线文档；下一批 B01 源码只读调查与能力矩阵。固定上游仍为 `4617210822bdbb31e5749751afbfb4584ccedac8`；实际 HEAD/WIP 重新核对，旧 `251c0fe380` 只是历史检查点。原 S1 身份与冻结/验收以[owner 记录](v2-implementation-owner-2026-10-29.json)核对，不由本文转交。

## 可复制的当前启动提示词

<!-- PROMPT START -->

你是 AigcForge V2 迁移调查协作者。工作区 /home/keer/workspace/aigcfroge-v2，保持现有 v2-dev；默认 /home/keer/workspace/aigcfroge 的 main 与相关 WIP 只读。先读目标 CLAUDE.md、AGENTS.md、ARCHITECTURE.md、DESIGN.md、docs/testing.md，再读 docs/research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md 的 §0 和 2026-10-29-migration-batch-plans.md、2026-10-29-migration-session-prompts.md 的 B01。

核对实际 branch/HEAD/staged/unstaged/相关未跟踪源码与固定上游4617210822bdbb31e5749751afbfb4584ccedac8，不 fetch/换基准/reset/clean，不读取无关用户数据/秘密。追加首读同研究目录的2026-10-29-deepseek-harness-alignment.md：用户已选强化现有五模式、Creator候选审阅后版本化保存与显式采用；不新增第六模式、不自动编译执行/热改旧会话，不把原研究历史审批/命令当授权。按 B01 建完整默认新增能力→V2 owner/差距/允许差异/数据权限恢复/消费者/验收/账本 ID 矩阵，加入H引用/可信度、定义/提供者/消费者与版本/生命周期，冻结相关参考源码身份；仅写该批指定文本和下一条完整用户链的调查任务，不改生产代码。

原 S1 的状态只读 docs/review/v2-implementation-owner-2026-10-29.json，不中断、不接管、不修改该记录。当前不运行产品测试/构建/生成/桌面/真实模型或远程操作；B01 通过后再形成具体文件/合同/门禁/负责人任务单，正式派发一个小节。保留 V2 执行与现有成果；文档/调查通过不等于功能通过，交付后停止。其它批次从提示词目录选对应调查任务，不从历史 P0.1 重跑。

<!-- PROMPT END -->

## 历史交接正文：不作为当前派发令

以下内容保留原运行细节和检查点，当前入口、负责人、验证规则以本页上方及总计划 §0 为准。历史允许、命令和 tallies 不能作为新会话授权或本轮通过。

<!-- HISTORICAL PROMPT START -->

你是 AigcForge 项目的高级全栈工程协作者。完整目标是：架构、执行逻辑、数据归属和 UI 对齐固定 OpenCode V2，再用其真实模块边界复现默认工作区新增模式、功能和 Meta Agent；每条功能链持续归一化，最后清理兼容层并验收切换。2026-10-29起由规划对话 `01a1850f-5d8a-70a3-98e7-c22e4346e8e0` 统一调查、规划、复审与真实桌面验收；辅助实施对话 `01a185f9-7b3d-7e71-ad41-cd3fcb9b3b88` 只执行其明确任务单中的代码修改和测试，不自主扩大设计或推进下一小节。

## 0. 当前工作令：理解两套代码族，按统一任务单交付

历史报告审批与已完成子节保持原证据范围，不能据此省略用户新要求的默认工作区代码族核对。先读[总计划 §0](../research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md)与[调查附件](../research/upstream-v2-sync/2026-10-29-code-family-review.md)，再执行当前任务单；不从历史 P0.1 重跑，也不继续复制旧 TaskPanel/M7 布局。

所有模式复用同一 V2 公共底座，Coding 也使用该底座。默认工作区已有独立 Home；必须区分 Home、模式工作区、Draft、canonical Session，并追踪 server/Location/Session/Tab 的权威归属。Session 详情标题栏不得有任何资产按钮，单一资产按钮也不例外。正确入口要从默认工作区真实工作台/右栏代码族映射到 V2，不能自行发明。

当前整体架构未闭环。每个实施小节须由主规划对话用冻结源码/产物启动真实 Electron，并使用 DeepSeek Flash 真实对话完成验收；失败修复并复验后才派下一小节。辅助实施方不操作桌面、不自行重启服务或构建共享产物，相关动作先按任务单协调。

2026-10-29追加：先读[统一底座架构记录](../research/upstream-v2-sync/2026-10-29-shared-foundation-decision.md)。每节按“全部相关代码族调查 → 独立审查 → 主调度批准并发送具体任务 → 实施/包级检查 → 主调度复审/真实桌面验收”推进。主调度可并行研究下一节；辅助方不得提前实施。文件中的草案状态不构成派发。

实施者恢复前必读[当前 owner 记录](v2-implementation-owner-2026-10-29.json)。历史 HTTP400 与实施转交只作时点记录；当前写入/冻结/验收以该记录与正式任务核对，不由旧“正式开工”消息或本文推导。文档批次不修改该记录或转移 S1。

已确认生命周期：行为能力定义更新后，已有会话保持原组合版本；变更经新建或分叉采用。权限逐次判定；允许池内Agent/Model执行选择与组合定义更新分开，不能擅自删除selector。

研究必须评估代码逻辑是否合理，不能把旧实现或类型通过视为正确性依据。真实重复、错误顺序、竞态、归属与恢复问题在共同 owner 优化；涉及产品语义或未理解的内容，由主规划对话整理具体问题继续询问用户。

```text
P0  共用 V2 基线
├─ P0.1  Codegen canonical/legacy 引用    （历史子节，按已有检查点复用）
├─ P0.2  权限、工具快照与共用请求语义
├─ P0.3  Desktop 服务、CLI 与发布闭包
└─ P0.4  领域恢复故障隔离
P1  产品合同与允许差异盘点
P2  模式与资产基础用户链
P3  Meta、Assistant 与 Custom
P4  Work、Task、Delegation 与 Workflow
P5  全局、分享与剩余兼容消费者
P6  归一化、数据库、性能与 Cutover 验收
```

### 0.1 已履行事项与证据边界

报告复审通过只表示可作为计划依据。初次架构审查的 Codegen 单包为 **99 pass / 0 fail**；实际引用诊断为 **exit 1**。两者分开记录，不能称生成器当前正确，也不能把历史记录当作本会话新运行。

29 项是文档写入前核对的混合快照；27 个既有非文档文件在上次交接时未变。新会话仍须重新核对现场，不把 hash 清单当完整 WIP 备份。

### 0.2 自动继续与范围边界

主规划对话在当前切片通过适用验证、复审和真实桌面验收后，按现行计划派发 P0–P6 后续任务；辅助实施方只继续明确分配的范围。范围外发现先回传，不自行增加 UI、路由、Schema、抽象或执行系统。需要产品裁决或外部条件的子项由主规划对话登记并处理，独立任务仍可推进。不要照搬参考模板的人类门禁、旧 main 分支或旧测试基线。

## 1. 开工门禁

先执行并记录：

```bash
cd /home/keer/workspace/aigcfroge-v2
pwd
git branch --show-current
git status --short --branch
git worktree list
git rev-parse HEAD upstream/v2
git diff --stat
git diff --cached --stat
git ls-files --others --exclude-standard
```

### 1.1 固定身份与比较基准

```text
唯一实施目录：/home/keer/workspace/aigcfroge-v2
当前分支：v2-dev
交接 HEAD：251c0fe38041a326e624db464d1ee0efd1522881
固定上游：upstream/v2 = 4617210822bdbb31e5749751afbfb4584ccedac8
上游于 2026-10-25 已核对，远端 v2 与此相同；不要混入 dev 或自动换新基准。
旧产品目录 /home/keer/workspace/aigcfroge 当前main@edbe67383d830aa40269ddf453c7f5617c940b46及现有WIP，只读参考，不作为实施现场。
```

### 1.2 保护 WIP

先运行 pwd、git status --short --branch、git worktree list、git rev-parse HEAD upstream/v2、git diff --stat、git diff --cached --stat、git ls-files --others --exclude-standard。身份变化先核对原因，保留现场；不要自动 checkout/reset/clean 或重建干净工作区。

现场有未提交 TaskPanel、Task 事件、Schema、Client、Codegen、App/E2E、bun.lock 和文档改动。既有证据目录也是未跟踪工作。当前交接文档也尚未提交。先阅读 diff 和未跟踪文件，在仓外保存未暂存/暂存 diff、所有未跟踪文件与 manifest，并验证可以读取，再进行生成、整理或切片提交。29 个暂停 hash 是混合快照，不是完整备份；新 worktree 不会自动带入 WIP。

## 2. 必读协议与计划

1. /home/keer/workspace/aigcfroge/CLAUDE.md 的第一性原理、复用、验证和报告规则；路径不存在时用当前 Git 仓的 git show 1a6b238d7bb73916c933d5c4715326d376a34805:CLAUDE.md 恢复。旧 ARCHITECTURE/CONTEXT/DESIGN 是业务合同与历史参考。
2. /home/keer/workspace/aigcfroge-v2/AGENTS.md，以及本切片涉及的包/子目录 AGENTS。
3. /home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md —— 唯一现行实施计划。
4. /home/keer/workspace/aigcfroge-v2/docs/review/v2-alignment-report-2026-10-25.md 与 v2-alignment-report-approval-2026-10-25.md。
5. /home/keer/workspace/aigcfroge-v2/docs/technical-debt.md 与 docs/review/evidence/v2-alignment-review-2026-10-25/ 的现场/测试记录。
6. /home/keer/workspace/aigcfroge-v2/specs/v2/README.md、session.md、tools.md，以及当前实现与实际测试。

2026-10-16 旧迁移计划已经 superseded，只作历史记录。不要按“1,707 文件完整回植”、旧 TaskDriver/workflow-runner、旧 sidecar 默认替换、AppInterface 虚构插槽或重编号 migration 推进。报告审查通过不表示产品问题已解决，不能当作 WIP 全绿或迁移完成。

## 3. 锁定当前执行范围

历史范围曾优先 P0 共用基线修复；当前从总计划 §0 的 B00/B01 或明确当前任务接续，不重跑历史首节。开始前输出：`计划 / 当前 Batch / Slice / 基线 / 分支 / 适用验证 / 非目标`。

当前非目标：旧文件数量回植、旧 provider runner/TaskDriver/workflow-runner、旧 sidecar 默认替换、虚构 AppInterface 插槽、重编号已执行 migration，以及未明确目标的远程发布或合并。

### 3.1 后续 P1–P6 用户链

- P1：盘点旧产品合同与允许差异，逐项找真实 V2 owner/消费者；不是清点旧文件。
- P2：五模式创建/继承/路由/缓存；首个资产 propose→用户确认→真实 HTTP apply→注册→Session 消费，随后七类资产与导入。
- P3：Meta 持久身份/记忆/资产信息进入当前 Instructions；Assistant 个人记忆/Notes/KB/提醒；Custom Builder/Profile/plan/start/upgrade/冻结结果/引用删除/恢复。
- P4：Task CRUD 保留，补真实进度、四态、外部关闭、Work 继续执行、child 导航、当次快照；明确并发/时区后补真实调度。Delegation 外部 CLI/attended/review/revision/fanout/多 pending 恢复；Workflow UI、事件配置、取消/恢复/规模；judge/share-summary 用现有 AI。
- P5：全局首页/跨 Location 搜索与 Sync、分享链接/授权/撤销、跨工具导入/外部续接、遗留 control/question/PTY/work-artifact 消费者；模型协议能力向 V2 AI 映射。
- P6：删除无消费者兼容层，统一当前文档，保护已执行 migration 身份；真实 Electron/bundled CLI/native PTY/服务接管、旧库副本不变量、同环境配对性能与发布/更新验收后再讨论 Cutover。

所有旧计划能力都在 P1 保留盘点：Coding 符号/LSP/审查/防幻觉/doom loop，Chat 创作与资产，Work/Review，Assistant 个人能力，Custom，Meta 与子代理协议卡，导入/CLI 发现，权限档位/Scoped Grant/Break-glass，全局首页/Sync，LLM 协议功能和桌面发布。V2 已提供等价能力就复用并给证据，不制造重复实现。

保留已关闭子范围：跨 Session 分享与 inbox、Task HTTP/组合事务、有 marker 的 Task 更正、Custom 冻结与 Command 模板执行、Session 快照引用读取、Workflow 后端/四执行 HTTP/持久 Updated、内部 Delegation 的现有链。链接分享、AI summary、产品 UI、旧 marker、无日志恢复、producer 边界和规模仍开放。最终状态以 canonical debt ledger 为准；不要创建不存在的 V2-C-TASK 总项代替现有子项。

## 4. 已确认的架构事实与约束

V2 SessionExecution 是进程级、Session-ID 驱动；runner/模型/工具/权限/文件服务 Location-scoped。持久 inbox 准入先于 wake，交付与可见消息投影原子完成。每个 Physical Attempt 有显式 llm.stream；续跑重读历史。Delegation/Workflow 创建/绑定 child Session、准入后 wake，模型执行归现有 SessionRunner。不要重建第二套循环、Session 存储或注册表。

当前 V2 user/synthetic 同 Session/type 是 first-admission-wins；control 保留操作特例。claimed Session 有有界启动恢复，但不是 clustered ownership、exactly-once 或自动重跑未知副作用。请求使用 Instructions。旧协议的运行文字与当前 V2 有时点差异，应结合我明确的 V2 基准目标与目标规范；若有另一个明确人类要求冲突，指出规则和来源，询问该项并推进独立工作，不能仅凭源码擅自裁决业务。

依赖：Core→Schema/AI，Protocol→Schema，Server→Core/Protocol，Client→Schema/Protocol，App→Client。Client 禁止运行时导入 Core/Server。HTTP 请求链和代码生成链单独描述；生成使用真实 ClientApi 与官方 build/generate。

保留 V2 Desktop 内置 CLI/server ensure、服务发现/复用、凭据、IPC/storage、PTY，以及 App provider/location/cache/路由/timeline/composer。UI 扩展查真实 GUI Slot/Panel/Command/SettingsPage 和 session-ui renderer，复用 Token/i18n/可访问性。模式与 Agent 分类正交，选择模式不隐式创建、重分类、恢复 Session 或改 Agent。requestedCapabilities 仅声明，不另建 capability 授权，不强制 Custom MCP 全部 direct。

## 5. 工作拆解

### 5.1 P0.1 Codegen：历史任务定义，按已交付检查点复用

真实决定函数：packages/httpapi-codegen/src/index.ts 的 structuralTypes.render（交接行 1082）。顺序替换会把先产生的输出名再次命中为 legacy 引用。当前 ConfigMCP.servers 和 canonical RemoteConfig.oauth 已引用到旧结构。

证据：docs/review/evidence/v2-alignment-review-2026-10-25/codegen-reference-diagnostic.ts、.log、.json。实际 compile/emitPromise 将 current 和 legacy 都指向旧 enabled 结构；诊断 exit 1。现有 codegen 单包 99 pass / 0 fail，只证明原有用例，没覆盖该关系。

先在真实模块测试中加入 canonical/legacy 引用含义回归并获得失败，再修同一替换根因。保留公开类型名称、canonical MCP/OAuth、匿名 Class、等价 schema 去重与可选 JSON 字段含义。不能手改生成物、改消费者名字绕过，或用 Finite 掩盖 Number 编码。夹具的 ./src/index.ts 依赖 codegen cwd/eval，不能直接执行证据目录路径。优先纳入实际测试。

修复后在 Client 正式 generate，逐包验证受影响类型/合同/行为。生成两次零漂移和类型名数量不等于语义正确。

### 5.2 P0.2 权限与工具快照

决定函数：permission/effective.ts compute、permission.ts configured/evaluateInput、session/context.ts select、tool.ts whollyDisabled。

静态反例前提：Coding、有人值守、master=false、savedApprovals=[]、权限 hook 不改判；Agent read deny 后 Session read allow。上游 last-match allow，当前 compute 末尾重放 deny；快照仍用原始 merge。

用真实 Session/Agent/Permission/Tool 路径复现，保护普通 Coding 的 V2 规则与展示。保留 Custom 冻结/明确安全合同，不因统一规则删除自研功能；旧 full/master/档位增量独立登记，不能扩散到所有普通 Session。补 saved、hook、CodeMode/direct、Custom 开/关及快照→执行回归。

### 5.3 P0.3 Desktop 服务与发布闭包

从 DesktopCli.resolve/resolveBundled、BackgroundService.connect、prepareServer、prebuild、electron-builder、发布脚本追踪实际依赖。packages/cli/script 等被过早裁剪，开发/打包仍引用它们。恢复 V2 必需入口与构建模块；内置 CLI 服务能力和独立 TUI/CLI 发布形态分开裁决，不搬回旧 utilityProcess runtime。静态检查不证明真实冷启动、服务复用和 native PTY。真实验证使用隔离 user-data、测试服务与旧库副本，不修改用户现用服务和存量数据。

### 5.4 P0.4 恢复故障隔离

条件风险尚未实测：旧 EventTable 有可折叠历史，可还原 internal participant/childSessionID/delivery；当前 events off、child 不 active、没有 disabled Custom 提前跳过，Delegation recoverPending 可能经 orDie 终止恢复 fiber，普通 claimed Session 循环未到达。只有投影行不足以触发该路径。
先用真实持久数据与现有恢复入口验证，再在原恢复归属修隔离。保留 V2 默认开关、预算、人工停止和 unknown side effects，不能全局强开日志或重放所有 provider 请求。

完成 P0 相应门禁后，按现行计划继续；不要先恢复旧 M7 轨道或 Scheduler 工作令。需要平台/产品裁决的子项登记并携具体选项询问，不将独立工作一起停下。

### 5.5 每条切片的复用与验收映射

先写清已有候选、真实消费者、兼容关系和选用理由，再动代码。按当前切片填写，不为未来阶段预建抽象。

| 项           | 必须记录                                                   |
| ------------ | ---------------------------------------------------------- |
| 复用候选     | 真实 owner、定义/调用者/测试 file:line、可复用与不兼容原因 |
| 关系决定函数 | 比较、合并、去重、投影或授权函数，不能只引用调用点         |
| 用户链       | 入口 → 准入 → V2 执行 → 持久结果 → 产品消费                |
| 适用验收     | 实际行为回归、类型/生成、UI/恢复及当前切片需要的检查       |
| 未交付范围   | canonical 账本 ID、Owner、解除条件与下一步                 |

## 6. 每个 slice 的执行与验证循环

复杂决策按：识别假设 → 追溯本源 → 重构方案 → 精简输出。
修复按：复用 → 删除 → 归并 → 重构 → 新增。多个同现错误先归类和找共享前提，修决定该关系的边界。每项关系结论给比较/合并/去重/投影函数的 file:line。对比短期简单实现与长期架构成本，明确技术债；不为理论风险预建统一框架。

每条功能链实现→真实行为测试→类型/生成→必要 lint→独立复审→账本更新。测试数据和 readiness signal 复用现有设施，禁止固定 sleep 等并发，禁止复制生产逻辑到假测试。所有命令记录 cwd、退出码、tally、skip、版本/hash；失败和后续成功分别保存，不把历史测试当本轮通过，不累计重叠用例数。

### 6.1 低资源执行与子智能体

系统性能不高。主线独占测试/构建资源，一次一个包；子智能体先并行只读取证、审查或独立文件范围实现，不并发测试/构建/大索引初始化。使用协作子智能体，不创建新的用户聊天代替子任务。代理 HTTP 400 失败任务不能计作完成；可以拆成不继承长历史的短任务接续。

读取/编辑符号优先 Codegraph search/node/impact；目标无索引时用 rg 与精确行读取，不为本切片先建大型索引。explore 每项目最多两次。改动前检查影响面和真实接口，禁止猜 API。

固定使用 /home/keer/workspace/aigcfroge-v2/script/bun；当前 packageManager 为 Bun 1.4.2。不要依赖 PATH 中全局 Bun 或沿用旧 Effect API。包命令从真实 package.json 读取，typecheck 用包脚本/tsgo，不直接 tsc。

## 7. 每个 slice 的复查结论

```text
复查结论:
- 计划 / Phase / Slice / 基线 / 分支:
- 影响文件与已有 WIP 归属:
- 用户链与真实决定函数 file:line:
- Reuse table 摘要与保留的 owner:
- 当前适用门禁与架构不变量:
- 红测试 / 修复后绿测试 / 重构证据:
- 已运行命令、cwd、退出码、tally、skip、版本/hash:
- 生成物与公开合同语义核验:
- 未交付 ID / Owner / 解除条件:
- 剩余风险、需要裁决的具体问题:
- 下一 Slice / 是否暂停相关动作:
```

测试数字取自真实输出；失败和后续成功分别保存，不累计重叠用例，不用声明风险代替适用验证。

## 8. 常用验证命令

只选当前切片受影响的命令，逐条串行执行。以下为现行 V2 项目的命令，不继承参考模板的旧包路径、旧 Bun 限制或旧测试数字。

### 8.1 P0.1 Codegen、生成与受影响类型

```bash
cd /home/keer/workspace/aigcfroge-v2
task_bun=/home/keer/workspace/aigcfroge-v2/script/bun
"$task_bun" --version
"$task_bun" run --cwd=packages/httpapi-codegen test --timeout 30000 ./test/generate.test.ts
"$task_bun" run --cwd=packages/httpapi-codegen typecheck
"$task_bun" run --cwd=packages/httpapi-codegen test --timeout 30000
"$task_bun" run --cwd=packages/client generate
"$task_bun" run --cwd=packages/protocol check:generated
"$task_bun" run --cwd=packages/client typecheck
"$task_bun" run --cwd=packages/app typecheck
"$task_bun" run --cwd=packages/app typecheck:e2e
```

### 8.2 Core 行为回归

Core 测试必须走 package test wrapper，例如：

```bash
"$task_bun" run --cwd=packages/core test --timeout 30000 ./test/permission.test.ts ./test/permission-session-override.test.ts
```

不要裸 bun test 绕过环境隔离。Protocol 无 test script；用其类型/生成与真实 Server 行为测试。

App test:unit 和 test:browser 保留各自 preload/conditions；App typecheck 不串联 typecheck:e2e。受影响 UI 定稿后用 test:e2e:built，--project=chromium --workers=1 --retries=0。若使用 PLAYWRIGHT_BASE_URL，确认对应本轮 production build。mock keeper 不等于真实 Electron/CLI/native PTY/旧库验收。

lint:changed 传显式切片基线，例如 "$task_bun" run lint:changed 251c0fe38041a326e624db464d1ee0efd1522881；它只覆盖 GUI 指定包，不能代表 Core/Codegen lint。Client check:generated 会先 generate 写文件；Protocol check:generated 是检查分支。先保护 WIP，再执行生成。
根测试明确禁止，不能 turbo test。根 check 的全仓 typecheck 固定 concurrency=3，日常留给 CI/最终验收；确需本地全量类型检查明确 turbo typecheck --concurrency=1，另验 App e2e。当前 pre-push 没有旧 AIGCFROGE_SKIP_TYPECHECK 跳过分支，不假设可用。

## 9. 停止与交付

未完成范围必须写 canonical docs/technical-debt.md 的 ID、Owner、解除条件，plan 同步实际状态。只改相关代码；切片提交时先确认文件范围与 WIP 归属，commit 列表通过 git log 生成。不要提交未知归属改动，不自行推送/合并/发布，最终远端/分支/切换目标需明确。

先给简洁现场核对，按上方当前提示词选择 B01 调查或明确正式小节；旧“直接从 P0.1 实施”不再生效。已明确产品路线不重复问；实质合同歧义给具体证据与选项，仅阻断相关链，独立研究继续。文档/调查任务不运行下方历史产品命令。

## 10. 必须暂停相关动作的情况

以下条件只暂停依赖该问题的修改、验收或交付；继续取证、修根因，并推进不依赖该回答的工作。

- 工作区、分支或关键基线与交接不符，原因尚未核对，拟执行覆盖/切换动作。
- WIP 归属不明或完整备份未验证，拟执行生成、整理或切片提交。
- 明确人类要求、现行计划与运行合同存在实质冲突，拟自行裁决业务。
- 当前适用验证失败，拟跳过失败或跨入依赖它的阶段。
- 方案需要第二套 runner、Session 存储、注册表或权限映射，或者需要放宽既有合同才能继续。
- 只能手改生成物、改消费者名称、固定 sleep、假测试、吞异常或绕过 hook 取得通过。
- 需要变更现用服务、存量数据或执行推送/合并/发布，而目标和授权尚未明确。

暂停报告包含：已读材料、决定函数与代码证据、失败命令及关键输出、已尝试方案、已改/未改文件、所需 Owner 决策和可继续的独立工作。不要虚报，不绕过当前门禁。

<!-- HISTORICAL PROMPT END -->

## 历史使用说明（不执行）

| 项           | 值                                                                              |
| ------------ | ------------------------------------------------------------------------------- |
| 历史正文     | `HISTORICAL PROMPT START/END` 之间仅供核对；当前复制上方启动提示词或批次目录 |
| 新会话工作区 | `/home/keer/workspace/aigcfroge-v2`，继续 `v2-dev` |
| 当前安全起点 | 首读 V2 协议并核对现场，下一批 **B01 能力矩阵/架构覆盖调查**；原 S1 独立验收 |
| 已完成前置   | 完整报告复审与实施计划修订；不是产品修复验收                                    |
| 自动继续范围 | 当前切片适用验证与复审完成后，按现行计划推进 P0–P6；依赖产品裁决的子项单独处理  |
| 历史证据     | Codegen 99 pass / 0 fail；引用诊断 exit 1；不计作新会话测试通过                 |
| 分支与交付   | 不新建干净 worktree 替代 WIP；最终远端与合并/发布目标需明确                     |
| 资源约束     | 单包串行，主线独占测试/构建；浏览器 workers=1、retries=0                        |
| 卡住时       | 输出具体阻塞与证据，修根因或询问该项；继续独立工作                              |
