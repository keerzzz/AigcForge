# P1 Coding / AI 合同预检

结论：V2 AI/Model/Provider 继续作为默认边界。Coding 的 LSP、修改后校验、doom loop、旧 review subtask，以及旧 Agent option 语义和 judge/parent-summary 仍有明确迁移或取证工作。本文是静态预检，不是验收或审批。

## 输入与分类

当前 V2：`251c0fe38041a326e624db464d1ee0efd1522881`，分支 `v2-dev`。固定 upstream：`4617210822bdbb31e5749751afbfb4584ccedac8`。旧工作区：`edbe67383d830aa40269ddf453c7f5617c940b46`，含既有 WIP，逐源文件 SHA256 见配套 JSON。

源文件最终取证时间：`2026-10-25T19:36:38.174757+00:00`。分类来自当前计划的生产合同要求：[P1 classification · v2 docs/research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md:116](/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md:116)；[P1 Coding scope · v2 docs/research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md:120](/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md:120)；[P1 AI baseline · v2 docs/research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md:129](/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md:129)；[P1 contract fields · v2 docs/research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md:132](/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md:132)；[P1 catalog decision · v2 docs/research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md:134](/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md:134)。

本轮合同统计由 JSON 内容生成：V2 已提供 10；自研增量已接线 1；尚需迁移 9；明确待裁决 4，共 24 项。分类描述来源/接线，不是通过率或已关闭债务数。

- **V2 已提供**：固定 upstream 已有对应边界，当前内建生产来源与消费者已查；只代表静态接线，不等于运行时或旧协议语义验收通过。
- **自研增量已接线**：本项限定增量经当前生产 owner 注册并捕获；完整领域用户链与运行时验收仍单列。
- **尚需迁移**：旧生产或条件式生产合同在当前内建链缺消费者，或有可核验的行为/边界差异。
- **明确待裁决**：默认产品目录、更强门禁或库能力尚缺必要性与启用合同，不能默认新增实现或记为已迁移。

## 已查结论

- **F1**：LSP 查询、runtime status 和修改后 diagnostics 尚未迁移。配置列表与 not_implemented handler 不能当已运行 LSP。 [LspTool operation dispatch · old packages/aigcfroge/src/tool/lsp.ts:83](/home/keer/workspace/aigcfroge/packages/aigcfroge/src/tool/lsp.ts:83)；[LSP.status · old packages/aigcfroge/src/lsp/lsp.ts:315](/home/keer/workspace/aigcfroge/packages/aigcfroge/src/lsp/lsp.ts:315)；[configuredLanguageServers · v2 packages/app/src/settings/workspaces/project-lsp.ts:5](/home/keer/workspace/aigcfroge-v2/packages/app/src/settings/workspaces/project-lsp.ts:5)；[InstanceInstanceHandler lsp stub · v2 packages/server/src/handlers/instance-stubs.ts:35](/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers/instance-stubs.ts:35)；[FileMutation deferred LSP integration · v2 packages/core/src/file-mutation.ts:290](/home/keer/workspace/aigcfroge-v2/packages/core/src/file-mutation.ts:290)。
- **F2**：DoomLoop、ReferenceChecker、Verifier 与 CorrectionStore 的旧执行链共有接线缺口。当前 canonical Tool/Runner 未调用；仅补 Layer 无法覆盖新工具名、CodeMode 和 Permission.Source。 [SessionRunnerLLM.settleTool · old packages/core/src/session/runner/llm.ts:387](/home/keer/workspace/aigcfroge/packages/core/src/session/runner/llm.ts:387)；[SessionRunnerStep.executeTool · v2 packages/core/src/session/runner/step.ts:95](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/runner/step.ts:95)；[SessionModelRequest.executeTool · v2 packages/core/src/session/model-request.ts:408](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/model-request.ts:408)；[Tool.Snapshot.execute · v2 packages/core/src/tool.ts:334](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool.ts:334)；[ReferenceChecker.extractFiles · v2 packages/core/src/session/reference-checker.ts:79](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/reference-checker.ts:79)。
- **F3**：旧 review 默认 subtask，当前 builtin review 直接提示当前 Session。V2 ConfigCommandPlugin 已有 child/SubagentJob 路径可复用。 [Command review default · old packages/aigcfroge/src/command/index.ts:92](/home/keer/workspace/aigcfroge/packages/aigcfroge/src/command/index.ts:92)；[SessionPrompt.command / isSubtask · old packages/aigcfroge/src/session/prompt.ts:1683](/home/keer/workspace/aigcfroge/packages/aigcfroge/src/session/prompt.ts:1683)；[CommandPlugin review execution · v2 packages/core/src/plugin/command.ts:43](/home/keer/workspace/aigcfroge-v2/packages/core/src/plugin/command.ts:43)；[ConfigCommandPlugin subagent command · v2 packages/core/src/config/plugin/command.ts:99](/home/keer/workspace/aigcfroge-v2/packages/core/src/config/plugin/command.ts:99)。
- **F4**：旧 Agent normalized options/generation 与 V2 migrateAgent 的 raw request.body 转换存在边界差异，需逐协议 wire fixture 决定兼容映射。尚未证明任意选项丢失或任意选项等价。 [LLMRequestPrep option precedence · old packages/aigcfroge/src/session/llm/request.ts:90](/home/keer/workspace/aigcfroge/packages/aigcfroge/src/session/llm/request.ts:90)；[LLMRequestPrep generation controls · old packages/aigcfroge/src/session/llm/request.ts:123](/home/keer/workspace/aigcfroge/packages/aigcfroge/src/session/llm/request.ts:123)；[ConfigMigrateV1.migrateAgent · v2 packages/core/src/v1/config/migrate.ts:35](/home/keer/workspace/aigcfroge-v2/packages/core/src/v1/config/migrate.ts:35)；[ConfigAgentPlugin request application · v2 packages/core/src/config/plugin/agent.ts:111](/home/keer/workspace/aigcfroge-v2/packages/core/src/config/plugin/agent.ts:111)；[SessionModelRequest Agent HTTP body forwarding · v2 packages/core/src/session/model-request.ts:284](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/model-request.ts:284)。
- **F5**：V2 canonical AI/Model/Provider、event/history、compaction 和 retry 已有生产消费者。旧 native opt-in 的准入由 statusWithFetch/fromCatalogModel 决定；不能数 provider facade 文件宣称旧 native 都启用。 [LLMNativeRuntime.statusWithFetch · old packages/aigcfroge/src/session/llm/native-runtime.ts:50](/home/keer/workspace/aigcfroge/packages/aigcfroge/src/session/llm/native-runtime.ts:50)；[SessionRunnerModel.fromCatalogModel · old packages/core/src/session/runner/model.ts:136](/home/keer/workspace/aigcfroge/packages/core/src/session/runner/model.ts:136)；[ModelResolver.resolveCatalogModel · v2 packages/core/src/model-resolver.ts:196](/home/keer/workspace/aigcfroge-v2/packages/core/src/model-resolver.ts:196)；[SessionRunnerStep provider stream · v2 packages/core/src/session/runner/step.ts:111](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/runner/step.ts:111)；[SessionCompaction.compact · v2 packages/core/src/session/compaction.ts:205](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/compaction.ts:205)；[SessionRunnerRetry.policy · v2 packages/core/src/session/runner/retry.ts:64](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/runner/retry.ts:64)。
- **F6**：low verbosity 不应只按 AI package helper 判定：已注册 VerbosityPlugin 在实际 Session hooks 补默认，并按真实 model/variant 和支持规则决定。 [VerbosityPlugin hook · v2 packages/core/src/plugin/verbosity.ts:26](/home/keer/workspace/aigcfroge-v2/packages/core/src/plugin/verbosity.ts:26)；[VerbosityPlugin.supportsVerbosity · v2 packages/core/src/plugin/verbosity.ts:45](/home/keer/workspace/aigcfroge-v2/packages/core/src/plugin/verbosity.ts:45)；[VerbosityPlugin.openAIModelID · v2 packages/core/src/plugin/verbosity.ts:52](/home/keer/workspace/aigcfroge-v2/packages/core/src/plugin/verbosity.ts:52)；[PluginInternal verbosity registration · v2 packages/core/src/plugin/internal.ts:317](/home/keer/workspace/aigcfroge-v2/packages/core/src/plugin/internal.ts:317)。
- **F7**：默认 Coding 增量目录、严格全局命名符号门禁及 library-only structured/hosted 功能仍待明确合同。Custom disabled 不能证明 Coding 目录或记忆域已隔离。 [P1 catalog decision · v2 docs/research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md:134](/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md:134)；[SessionContext.select · v2 packages/core/src/session/context.ts:149](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/context.ts:149)；[SessionContext permission/tool/instruction capture · v2 packages/core/src/session/context.ts:216](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/context.ts:216)；[Tool.snapshot · v2 packages/core/src/tool.ts:240](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool.ts:240)；[ReferenceChecker.existsResolved · old packages/core/src/session/reference-checker.ts:69](/home/keer/workspace/aigcfroge/packages/core/src/session/reference-checker.ts:69)；[ToolRuntime.definition · v2 packages/core/src/tool/runtime.ts:21](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/runtime.ts:21)。

## 共同执行合同

- 当前 App create 不传 mode 时按 ProductMode.Default=coding；Agent selection 与 Session mode 是不同状态。Build 不是唯一可能的配置默认 Agent。 [new-session composer create · v2 packages/app/src/new-session/composer-adapter.ts:97](/home/keer/workspace/aigcfroge-v2/packages/app/src/new-session/composer-adapter.ts:97)；[ProductMode.Default · v2 packages/schema/src/product-mode.ts:13](/home/keer/workspace/aigcfroge-v2/packages/schema/src/product-mode.ts:13)；[Session.create · v2 packages/core/src/session.ts:454](/home/keer/workspace/aigcfroge-v2/packages/core/src/session.ts:454)；[Agent.selectedDefault · v2 packages/core/src/agent.ts:79](/home/keer/workspace/aigcfroge-v2/packages/core/src/agent.ts:79)。
- 当前 Session.prompt 先 reconcile id/type/delivery，再 prepare/admit/wake；durable 输入表是当前 SessionInboxTable(session_inbox)。本预检未验 payload retry 全部不变量或旧库升级。 [Session.prompt · v2 packages/core/src/session/session.ts:156](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/session.ts:156)；[SessionInbox.admit · v2 packages/core/src/session/inbox.ts:169](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/inbox.ts:169)；[SessionInboxTable · v2 packages/core/src/session/sql.ts:165](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/sql.ts:165)。
- 当前非 Custom Session 使用 Agent/Session 权限捕获 Location Tool 与 Instructions；本次捕获的 executor 在本次 request 内使用。Custom 冻结目录另有分支。 [SessionContext.select · v2 packages/core/src/session/context.ts:149](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/context.ts:149)；[SessionContext permission/tool/instruction capture · v2 packages/core/src/session/context.ts:216](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/context.ts:216)；[Tool.snapshot · v2 packages/core/src/tool.ts:240](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool.ts:240)；[SessionModelRequest.prepare · v2 packages/core/src/session/model-request.ts:238](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/model-request.ts:238)。
- 旧 legacy sync prompt 与按 shouldUseV2Runtime 选择的 promptAsync 是不同入口；旧 native LLM 开关又是 legacy stream 内的另一选择。所有旧增量在此按实际入口条件记账。 [SessionHttpApi.prompt · old packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts:834](/home/keer/workspace/aigcfroge/packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts:834)；[SessionHttpApi.promptAsync · old packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts:858](/home/keer/workspace/aigcfroge/packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts:858)；[ProductModePolicy.shouldUseV2Runtime · old packages/core/src/product-mode-policy.ts:102](/home/keer/workspace/aigcfroge/packages/core/src/product-mode-policy.ts:102)；[LLM.run native selection · old packages/aigcfroge/src/session/llm.ts:225](/home/keer/workspace/aigcfroge/packages/aigcfroge/src/session/llm.ts:225)；[LLMNativeRuntime.statusWithFetch · old packages/aigcfroge/src/session/llm/native-runtime.ts:50](/home/keer/workspace/aigcfroge/packages/aigcfroge/src/session/llm/native-runtime.ts:50)。

/review 的模型反馈、WorkReviewMachine 状态机、Delegation review completion barrier 是不同合同。当前 Delegation canComplete 被 fold/service 消费，仅能说明 barrier 接线；不能据此关闭 review/revision、结果/receipt、Task UI 或 P4 生命周期整项。 [CommandPlugin review execution · v2 packages/core/src/plugin/command.ts:43](/home/keer/workspace/aigcfroge-v2/packages/core/src/plugin/command.ts:43)；[DelegationReview.canComplete · v2 packages/core/src/delegation/review.ts:144](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/review.ts:144)；[DelegationFold.deriveApprovalStatus · v2 packages/core/src/delegation/fold.ts:236](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/fold.ts:236)。

## 合同明细

### COD-01 Build Agent、构建与命令执行 — V2 已提供

V2 已有 Build、模型选择、Location 工具捕获和 shell 执行链。这里的 build 是执行 Agent；构建/测试由实际 shell 命令完成。

- **用户入口**：旧 Session 选择 build 后提交提示；V2 new-session composer/Agent picker 或显式 agent=build → Session.create/prompt。
- **输入/输出**：输入：Session、Location、Agent/Model.Ref、文本，以及 shell.command/cwd/timeout/background。输出：Session 消息、工具结果、退出/超时信息与后台 Job 状态。
- **Session/持久状态归属**：Session.create/SessionInbox 拥有会话和持久输入；Location Tool/Shell 执行命令，Job 拥有后台执行。构建状态不新建第二份 Session 状态。
- **Agent/模型/Instructions/工具**：Agent.selectedDefault 先取有效配置默认，再取可选 build；SessionContext 捕获 Instructions 与工具；SessionModelRequest 构造一次 provider turn。Build 的默认权限由 Agent.Info.default 决定。
- **权限**：Tool.snapshot 过滤整项工具；ShellTool.prepare 在叶边界检查 cwd 和 shell 权限。Build 名称不会替代叶授权。
- **取消/重试/恢复**：沿用 Session interruption、Shell/Job 生命周期与有界 provider retry。后台命令和进程重启恢复必须另做真实验收；本预检未执行。
- **消费者**：App composer 的 prompt admission 与真实 shell 工具结果；CLI/App/Desktop 运行匹配由主智能体单独验证。
- **旧数据**：旧 bash/工具输出及 Session 历史按现有兼容读取处理；不按旧 DTO 新建运行器。旧库升级与旧 shell 状态恢复仍属 P6/P0.4。
- **验收**：真实项目中用 Build 执行成功/失败构建，核对 cwd、退出码、权限拒绝、取消、后台通知、不同 Session 并发。可用现有 tool-shell/session-shell/session-runner 测试作起点，尚未运行。
- **Owner**：Coding/Core 负责人；主智能体验收
- **决定函数与消费证据**：[Agent.selectedDefault · v2 packages/core/src/agent.ts:79](/home/keer/workspace/aigcfroge-v2/packages/core/src/agent.ts:79)；[SessionContext permission/tool/instruction capture · v2 packages/core/src/session/context.ts:216](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/context.ts:216)；[ShellTool.prepare · v2 packages/core/src/tool/plugin/shell.ts:117](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/plugin/shell.ts:117)
- **关联账本**：AUDIT-V2-CODING-PARITY；本预检不关闭。

### COD-02 文件读取与精确编辑的边界校验 — V2 已提供

V2 read 的缺失文件失败、edit 的零/多匹配失败与注册工具 schema 校验均有执行消费者。这些边界校验不能代替修改后的引用或符号验证。

- **用户入口**：Build/Coding 提示触发 read/edit/write/patch；旧 read 的不存在路径错误是可核验入口。
- **输入/输出**：输入：真实路径、read 范围或 edit.oldString/newString/replaceAll。输出：真实文件内容/修改结果；缺失路径、零匹配、多匹配或 schema 无效产生工具失败。
- **Session/持久状态归属**：Location FileAccess/FileMutation 拥有文件访问与写入；Session durable tool events 拥有用户看到的终态。
- **Agent/模型/Instructions/工具**：ToolRuntime.execute 解码真实注册 input/output；ReadTool.missing 和 EditTool replacement guard 决定失败。后续 Tool reload 不替换本次捕获的 executor。
- **权限**：执行走叶 FileAccess/Permission 边界。目录显示和已捕获定义不是写入授权。
- **取消/重试/恢复**：按当前 Tool/Session interruption 传播取消；文件修改重试不得由旧消息自动重放。普通精确编辑不等于所有外部写入都有 CAS。
- **消费者**：SessionRunnerStep 的工具终态与模型后续历史；App 渲染真实工具内容。
- **旧数据**：保留历史错误/内容和文件引用；当前文件存在性在实际调用时检查。旧文件状态不由旧 transcript 推断。
- **验收**：对缺失文件、重复 oldString、Unicode/换行匹配、schema 错误、外目录和取消验证真实实现。现有 tool-read/tool-edit/tool-write/file-access 测试可复用，尚未运行。
- **Owner**：Coding/Core 文件工具负责人
- **决定函数与消费证据**：[ToolRuntime.execute · v2 packages/core/src/tool/runtime.ts:29](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/runtime.ts:29)；[ReadTool.missing · v2 packages/core/src/tool/plugin/read.ts:152](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/plugin/read.ts:152)；[EditTool replacement validation · v2 packages/core/src/tool/plugin/edit.ts:189](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/plugin/edit.ts:189)
- **关联账本**：AUDIT-V2-CODING-PARITY；本预检不关闭。

### COD-03 review 命令的审查提示与参数消费 — V2 已提供

V2 builtin review 经 CommandPlugin.append 将参数绑定到审查提示，再提交到真实 Session.prompt。只确认审查提示链；旧默认 subtask 边界见 COD-04。

- **用户入口**：旧 /review [commit|branch|pr]；V2 composer sendCommand → session.api.command(name=review)。
- **输入/输出**：输入：命令参数/文件附件及当前 Agent/Model selection。输出：按审查提示读取真实变更、给出模型反馈的 Session admission 与消息。
- **Session/持久状态归属**：Command 服务分发，当前 SessionInbox admission/Session history 归属不变；builtin review 当前直接使用同一 Session。
- **Agent/模型/Instructions/工具**：CommandPlugin 注册 review；append 替换 $ARGUMENTS，继承当前 Session 的 Agent、模型、Instructions 与工具。
- **权限**：真实 git/gh、文件读取和潜在修改仍由当前工具叶授权决定。review 文本不自动创建审批 verdict。
- **取消/重试/恢复**：沿用 Session 的取消、同 ID admission retry 和 provider retry；失败命令不得产生空成功。
- **消费者**：App sendCommand 和 CommandPlugin → ctx.session.prompt；模型反馈通过现有 Session UI 消费。
- **旧数据**：旧命令参数和历史消息仍是历史；旧 subtask/child 不能由新 builtin review 默认行为自动等价重建。
- **验收**：无参数、commit、branch、PR 参数及附件都绑定一次；验证实际差异读取、反馈、取消。旧默认 subtask 语义另验 COD-04。现有 plugin/command 与 session-command 测试可复用，尚未运行。
- **Owner**：Coding/Core Command 负责人
- **决定函数与消费证据**：[CommandPlugin review execution · v2 packages/core/src/plugin/command.ts:43](/home/keer/workspace/aigcfroge-v2/packages/core/src/plugin/command.ts:43)；[CommandPlugin.append · v2 packages/core/src/plugin/command.ts:86](/home/keer/workspace/aigcfroge-v2/packages/core/src/plugin/command.ts:86)
- **关联账本**：AUDIT-V2-CODING-PARITY；本预检不关闭。

### COD-04 旧 review 默认 subtask/子会话执行边界 — 尚需迁移

旧 default review.subtask=true，SessionPrompt.command 的 isSubtask 决定创建 subtask 并交 taskTool；V2 builtin review 直接提示当前 Session。两者执行边界有可核验差异。

- **用户入口**：旧 builtin /review 的默认调用；V2 同名命令的默认调用。
- **输入/输出**：旧命令产生 subtask 描述/目标 Agent/模型并交 taskTool；V2 builtin 当前产生当前 Session 的用户输入。需要保留的子会话导航、结果和隔离合同尚未接到 builtin review。
- **Session/持久状态归属**：应复用 V2 canonical child Session、SubagentJob/Delegation 状态，不建立旧 subtask transcript 镜像。
- **Agent/模型/Instructions/工具**：V2 ConfigCommandPlugin 已支持 command.subagent ?? command.subtask，并创建 parentID child、admit-only 提示与 SubagentJob。可复用该已有实现处理 review 默认/显式覆盖。
- **权限**：child 的 Agent/模型及叶权限按当前 V2 child 合同解析，不把 parent 的宽权限默认为审查者权限。
- **取消/重试/恢复**：用已有 SubagentJob 的取消、结果与恢复消费；需验证 review 取消、父/子归属和 exact retry，不能复制旧 loop。
- **消费者**：旧 SessionPrompt subtask execution 是实际消费者；V2 generic configured-subagent command 有消费者，builtin review 尚未使用该分支。
- **旧数据**：旧 review 默认来自 builtin 配置，不是必然存在于用户 config 的 subtask 字段；仅迁移显式配置不能覆盖旧默认。旧 child 历史保持原 ID/关联。
- **验收**：默认 review、显式 subtask=false/true、不同 Agent/model、取消、重载与 child 导航对照；确认允许差异后才关闭。尚未运行。
- **Owner**：Coding/Core Command 与 Subagent 负责人；产品负责人确认允许差异
- **决定函数与消费证据**：[SessionPrompt.command / isSubtask · old packages/aigcfroge/src/session/prompt.ts:1683](/home/keer/workspace/aigcfroge/packages/aigcfroge/src/session/prompt.ts:1683)；[CommandPlugin review execution · v2 packages/core/src/plugin/command.ts:43](/home/keer/workspace/aigcfroge-v2/packages/core/src/plugin/command.ts:43)；[ConfigCommandPlugin subagent command · v2 packages/core/src/config/plugin/command.ts:99](/home/keer/workspace/aigcfroge-v2/packages/core/src/config/plugin/command.ts:99)
- **关联账本**：AUDIT-V2-CODING-PARITY、V2-C-DELEGATION；本预检不关闭。
- **Unlock**：复用既有 configured-subagent command 路径接入 builtin review，或记录明确允许的同 Session 差异，并完成用户流程验收。

### COD-05 LSP 符号查询、导航与连接状态 — 尚需迁移

旧有九种 LSP 操作和实时连接状态消费者；当前内建 Tool/Plugin 目录没有该执行链，legacy lsp handler 返回 not_implemented。App 的配置列表不能证明 LSP 已运行。

- **用户入口**：旧 experimental LspTool 以及 App SDK lsp.status；V2 当前工作区设置只消费配置。
- **输入/输出**：旧输入：operation/filePath/1-based line/character/query；输出：定义、引用、hover、document/workspace symbols、implementation/call hierarchy 或无结果，以及 connected status。
- **Session/持久状态归属**：旧 LSP client/server 为 Instance/项目生命周期状态；迁移后应由 Location plugin/service 管理。Session 只持久化工具请求/结果，连接状态不伪造为 durable fact。
- **Agent/模型/Instructions/工具**：旧 LspTool dispatch、hasClients、LSP.status 决定真实结果；需要在当前 Tool/plugin/lifecycle 接线。MCP/codegraph 如作替代，必须逐操作证明能力，不以名称替代 hover/diagnostics。
- **权限**：旧先做 external-directory 与 lsp permission 检查；迁移须沿用当前 Permission.Source 和 Location 文件边界。
- **取消/重试/恢复**：验证 server 启动/缺失、断线、配置 disabled、Location disposal、取消及重连。重启重建真实客户端；不得把配置 enabled 显示成 connected。
- **消费者**：旧 App loadLspQuery 读 sdk.lsp.status；V2 configuredLanguageServers 折叠配置，InstanceInstanceHandler lsp stub 明确失败。当前没有本仓内建查询消费者。
- **旧数据**：既有 lsp config 可保留；活动 LSP 连接无持久恢复依据。legacy endpoint 按真实消费者决定适配/扩展/退役，不写空成功。
- **验收**：九操作、1-based 坐标、无结果/缺文件/无 server、状态事件、配置启停与跨 Location 隔离均需实际 LSP 验收。尚未运行。
- **Owner**：Coding/Core LSP 负责人；App/Server 消费负责人
- **决定函数与消费证据**：[LspTool operation dispatch · old packages/aigcfroge/src/tool/lsp.ts:83](/home/keer/workspace/aigcfroge/packages/aigcfroge/src/tool/lsp.ts:83)；[LSP.status · old packages/aigcfroge/src/lsp/lsp.ts:315](/home/keer/workspace/aigcfroge/packages/aigcfroge/src/lsp/lsp.ts:315)；[InstanceInstanceHandler lsp stub · v2 packages/server/src/handlers/instance-stubs.ts:35](/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers/instance-stubs.ts:35)；[configuredLanguageServers · v2 packages/app/src/settings/workspaces/project-lsp.ts:5](/home/keer/workspace/aigcfroge-v2/packages/app/src/settings/workspaces/project-lsp.ts:5)
- **关联账本**：AUDIT-V2-CODING-PARITY、V2-SERVER-LEGACY；本预检不关闭。
- **Unlock**：在 V2 Location/Tool/lifecycle 建立实际 LSP 执行与状态消费者，完成九操作和运行状态验收。

### COD-06 文件修改后的 LSP 诊断反馈 — 尚需迁移

旧 write/edit/apply_patch 的生产执行会 touchFile 并把 diagnostics 返回模型。当前 FileMutation、edit/write 明确保留待 LSP runtime 的 TODO。

- **用户入口**：旧 Coding 文件修改工具；V2 同类 edit/write/patch 调用。
- **输入/输出**：输入：实际修改路径/结果；输出：本文件与有界其他文件的 LSP error 文本及 diagnostics metadata，而非只返回写入成功。
- **Session/持久状态归属**：文件写入由 FileMutation/Formatter 拥有；LSP 是 Location 生命周期服务；Session 拥有最终工具结果。
- **Agent/模型/Instructions/工具**：旧 WriteTool post-write diagnostics 是消费者；V2 需要在现有修改/工具结果边界通知真实 LSP。read 触发的文档状态和文件选择范围也要对应 COD-05。
- **权限**：通知与读取诊断继承原工具的有效路径/权限，不另建绕过 FileAccess 的读写层。
- **取消/重试/恢复**：验证修改已发生但诊断超时/取消的结果语义，保持 typed error 与当前取消链；不会因缺诊断重放写入。
- **消费者**：旧模型后续 turn 消费返回错误；V2 当前写入/格式化结果没有该 LSP 诊断附件。
- **旧数据**：旧诊断是当时工具输出；历史诊断不可当作当前 workspace 诊断。活动文档状态随新 Location 生命周期重建。
- **验收**：真实错误写入→诊断→模型修正→错误消失；覆盖 edit/write/patch、格式化、跨文件、超时和重载。尚未运行。
- **Owner**：Coding/Core FileMutation 与 LSP 负责人
- **决定函数与消费证据**：[WriteTool post-write LSP diagnostics · old packages/aigcfroge/src/tool/write.ts:75](/home/keer/workspace/aigcfroge/packages/aigcfroge/src/tool/write.ts:75)；[FileMutation deferred LSP integration · v2 packages/core/src/file-mutation.ts:290](/home/keer/workspace/aigcfroge-v2/packages/core/src/file-mutation.ts:290)；[SessionModelRequest.executeTool · v2 packages/core/src/session/model-request.ts:408](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/model-request.ts:408)
- **关联账本**：AUDIT-V2-CODING-PARITY；本预检不关闭。
- **Unlock**：依托 COD-05 的真实服务，将修改后 diagnostics 接入 canonical tool outcome 并验收。

### COD-07 修改后相对引用校验与纠错提示 — 尚需迁移

旧 Core settleTool 在 settle 后调用 ReferenceChecker，并把提示并入文本/错误结果；当前 helper 被保留，但 canonical Tool/Runner 没有调用。它校验相对引用路径，不解析命名符号。

- **用户入口**：旧 promptAsync 在 shouldUseV2Runtime 打开的 Coding 路径，进入 Core settleTool；V2 普通 Coding 工具调用。
- **输入/输出**：旧输入：toolName/toolInput 与 Session；扫描 Markdown link、import/require 相对路径。输出：悬空路径警告和 CorrectionStore entry；裸 package specifier 跳过。
- **Session/持久状态归属**：旧/当前 CorrectionStore 为 Location Ref Map，按 Session key/turn TTL 保留，非持久个人记忆。Session 只保有并入工具结果的警告历史。
- **Agent/模型/Instructions/工具**：existsResolved 决定扩展名/index 候选是否存在。迁移须适配当前 shell/patch 和 CodeMode 内部调用，不能仅提供旧 Layer 或扫描 provider 的 execute 包装名。
- **权限**：校验不能扩大修改工具已有文件访问范围；按当前 FileAccess/Environment 与 Location 服务归属实现。
- **取消/重试/恢复**：旧扫描有自身 timeout 并在超时返回空提示。新接线遵守当前 interruption/错误合同；重启不会恢复旧内存纠错 TTL。
- **消费者**：旧 settleTool 消费 referenceWarning；当前 SessionModelRequest.executeTool 直接进 captured tools.execute，没有该后置消费者。
- **旧数据**：保留原工具警告；不将 CorrectionStore 当持久 Meta/Assistant memory 迁移。若要求跨重启保留，需另有存储与启用合同。
- **验收**：有效/失效相对 Markdown/import、扩展名/index、裸 specifier 跳过、已捕获 executor、direct/CodeMode、timeout 与取消。现有 reference-checker/correction-extractor 测试只是起点，尚未运行。
- **Owner**：Coding/Core 校验与 Instructions 负责人
- **决定函数与消费证据**：[ReferenceChecker.existsResolved · old packages/core/src/session/reference-checker.ts:69](/home/keer/workspace/aigcfroge/packages/core/src/session/reference-checker.ts:69)；[SessionRunnerLLM.settleTool · old packages/core/src/session/runner/llm.ts:387](/home/keer/workspace/aigcfroge/packages/core/src/session/runner/llm.ts:387)；[ReferenceChecker.extractFiles · v2 packages/core/src/session/reference-checker.ts:79](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/reference-checker.ts:79)；[SessionModelRequest.executeTool · v2 packages/core/src/session/model-request.ts:408](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/model-request.ts:408)
- **关联账本**：AUDIT-V2-CODING-PARITY；本预检不关闭。
- **Unlock**：在当前实际工具结果/Instructions 边界接入有界引用提示，完成名称、路径与 CodeMode 的消费验收。

### COD-08 条件式机械 typecheck 与升级提示 — 尚需迁移

旧 Core Verifier.verify 在代码修改意图、受支持工具、toolInput.path 对应 `packages/<name>` 且失败额度未用尽时运行包级 typecheck；当前生产执行没有消费者。

- **用户入口**：旧条件式 Core Coding 工具 settle；V2 Build 修改文件后的执行边界。
- **输入/输出**：旧输入：Session/tool/input/intent；输出：Verify.Started/Passed/Failed、失败提示和纠错条目。它不保证每个 shell 命令或每个文件都自动验证。
- **Session/持久状态归属**：typecheck 由 Location subprocess 执行；连续失败计数与 CorrectionStore 是内存状态，Session Verify events/工具结果记录当次事实。
- **Agent/模型/Instructions/工具**：Verifier.verify 的 intent、MUTATING_TOOLS、path/packageDirectory、失败次数守卫决定是否运行。新边界缺 intent/校验调用，旧 bash/apply_patch 名称也不能覆盖全部 shell/patch/CodeMode。
- **权限**：复用当前命令与路径执行边界；是否在默认 Coding 启用自动 subprocess 属 COD-12 增量目录合同，不靠 helper 的 enabled 默认值推导。
- **取消/重试/恢复**：旧 subprocess timeout 有界；应分别显示 failed/timeout/skipped，取消不能报 passed。进程重启不重放既往 typecheck 或自动升级 judge。
- **消费者**：旧 settleTool 将 verifyWarning 合入结果，当前 runner 无调用。L1/L2 文本提到 judge 不证明 judge producer 已接线。
- **旧数据**：旧 Verify events 与警告保留原历史；无 durable failure counter 迁移。old packageDirectory 规则是仓库专用条件，不泛化为所有用户仓库合同。
- **验收**：真实修改触发相应包 typecheck，成功/失败/timeout/skipped 与事件一致；非代码意图、无 path、失败额度与 direct/CodeMode 单独验证。尚未运行。
- **Owner**：Coding/Core 执行与验证负责人；产品负责人决定默认启用范围
- **决定函数与消费证据**：[Verifier.verify · old packages/core/src/session/verifier.ts:93](/home/keer/workspace/aigcfroge/packages/core/src/session/verifier.ts:93)；[Verifier.verify · v2 packages/core/src/session/verifier.ts:94](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/verifier.ts:94)；[SessionModelRequest.executeTool · v2 packages/core/src/session/model-request.ts:408](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/model-request.ts:408)
- **关联账本**：AUDIT-V2-CODING-PARITY、V2-D-AI；本预检不关闭。
- **Unlock**：确认默认启用范围并在 V2 实际修改结果边界接入有界 verifier；真实事件/提示/取消验收通过。

### COD-09 重复工具调用 doom loop — 尚需迁移

旧 legacy processor 有重复工具部件判定，旧 Core settleTool 在副作用前调用 DoomLoop.check。当前 helper 无内建生产调用，Build 默认也未单独追加 doom_loop=ask。

- **用户入口**：旧 legacy/native 或条件式 Core Coding turn 中连续同工具/同输入调用；V2 direct 工具或 CodeMode 调用。
- **输入/输出**：旧 legacy 取当前消息尾部 tool parts；旧 Core 按 Session fingerprint/可配 threshold 保留最近调用，providerExecuted 跳过。达到阈值进入 doom_loop Permission。
- **Session/持久状态归属**：DoomLoop 的有界 FIFO Map 是 Location 内存检测状态；Permission/Session 记录实际请求和工具终态。它不是 durable provider turn identity。
- **Agent/模型/Instructions/工具**：Legacy recentParts.every 与 Core DoomLoop.check 是两个实际判定规则，不能断言两者所有轮次等价。复用已有 Core detector，适配当前 Tool.Context 的 source.id 和真实 local invocation。
- **权限**：必须在副作用前进入当前 Permission.assert；目录过滤不代替重复调用批准。Build 的 wildcard allow 不等于旧 doom_loop ask 基线。
- **取消/重试/恢复**：验证 allow/deny/反馈/取消；缺 Session、defect 不能误报为重复调用被拒绝。重启/32 Session FIFO 淘汰重置检测，保留已观察的工具历史。
- **消费者**：当前 SessionRunnerStep.executeTool → SessionModelRequest.executeTool → Tool.Snapshot.execute 直接执行，未经过 DoomLoop。max agent steps 是另一条件，不能冒充该阈值审批。
- **旧数据**：旧 fingerprint buffer 不持久化；旧工具 parts 与 Permission 历史保持原事实。不得把旧审批自动解释为本次任意工具授权。
- **验收**：同输入达到阈值前后、副作用计数、变化输入、key order、providerExecuted、跨 Session、FIFO 淘汰、direct/CodeMode、取消及异常归类。现有 doom-loop 单元测试不是生产接线验收，尚未运行。
- **Owner**：Coding/Core Tool 与 Permission 负责人
- **决定函数与消费证据**：[SessionProcessor repeated-call predicate · old packages/aigcfroge/src/session/processor.ts:522](/home/keer/workspace/aigcfroge/packages/aigcfroge/src/session/processor.ts:522)；[DoomLoop.check · old packages/core/src/session/doom-loop.ts:74](/home/keer/workspace/aigcfroge/packages/core/src/session/doom-loop.ts:74)；[SessionRunnerLLM.settleTool · old packages/core/src/session/runner/llm.ts:387](/home/keer/workspace/aigcfroge/packages/core/src/session/runner/llm.ts:387)；[DoomLoop.check · v2 packages/core/src/session/doom-loop.ts:75](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/doom-loop.ts:75)；[SessionModelRequest.executeTool · v2 packages/core/src/session/model-request.ts:408](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/model-request.ts:408)
- **关联账本**：AUDIT-V2-CODING-PARITY、AUDIT-V2-PERMISSION；本预检不关闭。
- **Unlock**：已有 detector 接到真实 local invocation 的副作用前边界，默认 Permission 合同明确，行为验证通过。

### COD-10 更强的全局命名符号防幻觉门禁 — 明确待裁决

已查旧 LSP symbol 查询、file-range 扩展、相对路径 ReferenceChecker 和条件式 typecheck。未证实旧有独立的全局命名符号拒绝门禁；不能把 P1 名词扩写成已有能力。

- **用户入口**：若要求模型所引用/导入的命名符号在写入或回复前必须存在，需要明确用户触发与失败策略。
- **输入/输出**：待定义：symbol/path/位置与实际解析结果；空结果、动态符号、别名、workspace 不可用的拒绝/警告/跳过合同。
- **Session/持久状态归属**：应使用现有 Location LSP/代码查询及 Session 工具结果。是否需持久验证快照待明确，不能默认新增事实库。
- **Agent/模型/Instructions/工具**：旧 LspTool 无结果返回文本，file-range 仅尽力扩展；ReferenceChecker 检查路径，不解析 imported names；Verifier 条件式 typecheck 间接检测部分符号错误。
- **权限**：候选符号查询遵循现有读取/LSP 权限，不把普通回复变为未授权扫描。
- **取消/重试/恢复**：需定义 unavailable/timeout/cancel 和旧结果过期规则；未确认前不在默认 Coding 加全局阻断。
- **消费者**：当前不存在已证实的全局门禁消费者。COD-05/07/08 保留可核验的具体旧合同。
- **旧数据**：无已证实的独立 symbol-verdict durable state 可迁移；旧 LSP/工具/typecheck 输出按历史保留。
- **验收**：先确认严格门禁还是已有查询/引用提示合同；再用真实解析器验证成功、别名、动态符号、缺 server、超时与模型反馈。未运行。
- **Owner**：产品负责人；Coding/Core LSP 负责人
- **决定函数与消费证据**：[LspTool operation dispatch · old packages/aigcfroge/src/tool/lsp.ts:83](/home/keer/workspace/aigcfroge/packages/aigcfroge/src/tool/lsp.ts:83)；[ReferenceChecker.existsResolved · old packages/core/src/session/reference-checker.ts:69](/home/keer/workspace/aigcfroge/packages/core/src/session/reference-checker.ts:69)；[Verifier.verify · old packages/core/src/session/verifier.ts:93](/home/keer/workspace/aigcfroge/packages/core/src/session/verifier.ts:93)
- **关联账本**：AUDIT-V2-CODING-PARITY；本预检不关闭。
- **Unlock**：明确命名符号检查触发、范围和不可用时策略；不能用旧文件名或 plan 名词代替该裁决。

### COD-11 自研增量工具的注册与请求捕获子合同 — 自研增量已接线

Asset/KB/Memory/Reminder/Task 等增量通过 PluginInternal 进入既有插件激活，再由 SessionContext/Tool.snapshot 捕获。本项仅确认注册到请求的静态接线。

- **用户入口**：Location 插件激活后，Coding/Build Session 的下一次请求捕获有效工具目录。
- **输入/输出**：输入：插件注册、有效 Agent/Session permissions；输出：当前请求 snapshot/catalog 与捕获 executor。任何具体资产/记忆/调度用户闭环另验 P2/P3/P4。
- **Session/持久状态归属**：Location Tool registry 拥有注册与 precedence；各领域 service 拥有资产/记忆/Task 状态，Session 持久化调用结果。
- **Agent/模型/Instructions/工具**：PluginInternal.list 生成真实 pre/post plugins；SessionContext.select 合并权限并 capture registry.snapshot。leaf 可另行检查模式与业务状态。
- **权限**：Tool.snapshot 只做 whole-tool visibility filtering；不能从目录存在推导已授权执行，也不能从 Custom disabled 推导 Coding 已隔离。
- **取消/重试/恢复**：插件 scope/dispose/reload 与捕获 executor 的既有合同保留；领域恢复和外部副作用未在本项验收。
- **消费者**：真实 SessionContext capture 与 SessionModelRequest tools lowering；完整 UI、HTTP apply、调度、结果/通知消费不在本项提供状态内。
- **旧数据**：旧资产/记忆/Task 数据归各已确认 V2 owner；本预检没有迁移旧 registry 或旧 service runtime。
- **验收**：核对真实有效注册、请求定义/executor 一致性、权限过滤和 reload/dispose。默认 Coding 目录仍待 COD-12，不能据此关闭各领域债务。未运行。
- **Owner**：Core 插件/工具负责人；各领域负责人
- **决定函数与消费证据**：[PluginInternal.list · v2 packages/core/src/plugin/internal.ts:385](/home/keer/workspace/aigcfroge-v2/packages/core/src/plugin/internal.ts:385)；[SessionContext permission/tool/instruction capture · v2 packages/core/src/session/context.ts:216](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/context.ts:216)；[Tool.snapshot · v2 packages/core/src/tool.ts:240](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool.ts:240)
- **关联账本**：AUDIT-V2-CODING-PARITY；本预检不关闭。
- **本项范围**：仅注册/激活来源→有效请求捕获，不含任何领域用户闭环或默认 Coding 产品批准。

### COD-12 默认 Coding 增量工具与 Instructions 目录 — 明确待裁决

P1 明确要求产品裁决。当前非 Custom includeRegistered 为 undefined，目录按 Agent/Session permissions 过滤；这不是已确认的 Coding 专属增量目录。

- **用户入口**：V2 创建默认 coding Session，选择/默认 Build 后捕获下一次请求。
- **输入/输出**：待确认：默认 Coding 工具增量与上下文 producer 列表、自动 verifier/引用提示启用范围；输出应为可解释的实际目录与 Instructions。
- **Session/持久状态归属**：保持 canonical Session.mode 与 Agent 执行分类正交；Location registry/Instructions producer 拥有来源，不能新增 mode 专用运行器。
- **Agent/模型/Instructions/工具**：Agent.Info.default 的 wildcard allow、SessionContext 的非 Custom capture 和 Tool.snapshot 共同决定当前目录；Custom 的冻结分支独立。
- **权限**：选择『基础 Coding 加明确增量』或『保留内建目录并由叶权限约束』需产品合同。目录与执行授权分别验收；不依据 Custom disabled 宣称隔离。
- **取消/重试/恢复**：目录修改仅影响未来 snapshot；当前 capture、取消及恢复保持 V2 owner。不能在历史 Session 上暗中重分类。
- **消费者**：App composer/model capture、Session request 及模型真实工具列表。产品目录应有相同可观察来源。
- **旧数据**：旧 build/meta 默认选择和 config permission 需有明确迁移规则；不从 Session 旧名称推断新的 mode 或权限档位。
- **验收**：裁决后检验默认 coding、显式 Agent 切换、非 Coding、Custom enabled/disabled、provider 原生/CodeMode、重载、目录与权限一致性。尚未运行。
- **Owner**：产品负责人；主智能体；Core Tool/Instructions 负责人
- **决定函数与消费证据**：[Agent.Info.default · v2 packages/schema/src/agent.ts:45](/home/keer/workspace/aigcfroge-v2/packages/schema/src/agent.ts:45)；[SessionContext.select · v2 packages/core/src/session/context.ts:149](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/context.ts:149)；[SessionContext permission/tool/instruction capture · v2 packages/core/src/session/context.ts:216](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/context.ts:216)；[Tool.snapshot · v2 packages/core/src/tool.ts:240](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool.ts:240)
- **关联账本**：AUDIT-V2-CODING-PARITY、AUDIT-V2-PERMISSION；本预检不关闭。
- **Unlock**：产品批准默认 Coding 增量工具/Instructions/自动校验范围，再以实际 capture 与用户消费验收。

### AI-01 原生模型执行的默认边界与单 provider turn — V2 已提供

采用现有 V2 AI/Model/Provider 和 canonical LLMRequest；SessionRunnerStep 有一次显式 llm.stream，local tool dispatch 留在 Session/Tool。无需搬旧 native adapter 或 ToolRuntime loop。

- **用户入口**：旧 legacy LLM 的 experimentalNativeLlm 开关路径，以及旧 Core conditional runner；V2 App/CLI 提交 canonical Session prompt。
- **输入/输出**：输入：选定 model route、system/messages/tools/generation/providerOptions/http；输出：统一 LLMEvent 流及 Session 工具终态/消息。
- **Session/持久状态归属**：SessionInbox/SessionHistory/Runner 拥有 admission、编排与 durable facts；AI route/parser 只负责语义 lowering、传输和事件。
- **Agent/模型/Instructions/工具**：旧 statusWithFetch 限定 provider/npm/auth/key 后才选 native，unsupported 有明确 SDK fallback；旧 Core fromCatalogModel 也依据 API/package 选择真实 route。V2 ModelResolver 以 package/aisdk: 决定当前模型，仍走同一 canonical request。
- **权限**：local tools 用 captured snapshot 和叶授权；providerExecuted events 跳过 local executor，不能据此推导 provider-side 用户授权。
- **取消/重试/恢复**：遵守 V2 Session cancellation/provider retry 与真实 tool fibers；恢复闭环另见 AI-08/P0.4，未因 stream 入口存在计为完成。
- **消费者**：SessionModelRequest.prepare → SessionRunnerStep.stream → publisher/tool executor → Session UI。
- **旧数据**：旧 AI-SDK-shaped native-request/native-runtime 是 adapter 边界；不新建同型运行器。旧 transcript 转换与 session/tool 历史升级按实际 owner 验证。
- **验收**：OpenAI Responses、Anthropic 与旧支持的 AigcForge-compatible 路径分别做 canonical prepare/stream/tool/finish fixtures；验证每 turn 单 stream、hosted skip、取消及 continuation。尚未运行。
- **Owner**：AI/Core Session 负责人
- **决定函数与消费证据**：[LLMNativeRuntime.statusWithFetch · old packages/aigcfroge/src/session/llm/native-runtime.ts:50](/home/keer/workspace/aigcfroge/packages/aigcfroge/src/session/llm/native-runtime.ts:50)；[SessionRunnerModel.fromCatalogModel · old packages/core/src/session/runner/model.ts:136](/home/keer/workspace/aigcfroge/packages/core/src/session/runner/model.ts:136)；[ModelResolver.resolveCatalogModel · v2 packages/core/src/model-resolver.ts:196](/home/keer/workspace/aigcfroge-v2/packages/core/src/model-resolver.ts:196)；[SessionModelRequest.prepare · v2 packages/core/src/session/model-request.ts:238](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/model-request.ts:238)；[SessionRunnerStep provider stream · v2 packages/core/src/session/runner/step.ts:111](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/runner/step.ts:111)
- **关联账本**：AUDIT-V2-LLM-PARITY、V2-D-AI；本预检不关闭。

### AI-02 模型身份、可用性、Provider 与凭据配置 — V2 已提供

V2 已有 catalog Model.Ref 与 provider API model ID 的区分、可用性/variant 检查、native package 初始化与凭据解析。旧 native adapter 里的 provider 选择不能由 provider 文件数量替代。

- **用户入口**：App Model picker/Agent selection、CLI 显式模型，保存到 Session.model；当前 provider/credential config。
- **输入/输出**：输入：providerID/catalog id/variant、package、endpoint、settings/headers/body 与 credential connection。输出：可执行 LanguageModel 和 typed unavailable/configuration/initialization 错误。
- **Session/持久状态归属**：Location Model/Provider/Integration 拥有目录与连接，Session.model 持久化 catalog identity；AI route 持有 provider API identity，不能回写成另一 Session ID。
- **Agent/模型/Instructions/工具**：ModelResolver.resolveCatalogModel/withVariant 决定 actual native 或 aisdk: 构造；Provider.packageName 处理当前 scope alias。providerOptions 与 auth setup 在 provider facade/entrypoint lowering。
- **权限**：本地 key/OAuth/connection 使用现有 Integration/credential 服务；模型可见不等于连接已授权。预检未读取任何实际凭据。
- **取消/重试/恢复**：初始化错误可观察且有界；模型/variant 不可用不假装 ready。真实 OAuth/endpoint/SDK fallback 与重启连接验收尚待执行。
- **消费者**：SessionContext.resolveModel/SessionRunnerModel → ModelResolver；模型 selection 与 actual request route 在当前生产链相连。
- **旧数据**：现有 V1 config/Provider.packageName 可复用；不能断言所有旧 @llm facade/provider-native选项都已自动迁移。旧 model/API-id 别名与连接需样本验证。
- **验收**：catalog id≠API id、显式/默认模型、variant、alias、native/aisdk:、endpoint 覆盖、key/OAuth 缺失、typed错误。model-resolver/provider/config fixtures 可复用，尚未运行。
- **Owner**：AI/Core Provider、Model 与 Integration 负责人
- **决定函数与消费证据**：[ModelResolver.resolveCatalogModel · v2 packages/core/src/model-resolver.ts:196](/home/keer/workspace/aigcfroge-v2/packages/core/src/model-resolver.ts:196)；[ModelResolver.withVariant · v2 packages/core/src/model-resolver.ts:137](/home/keer/workspace/aigcfroge-v2/packages/core/src/model-resolver.ts:137)；[Provider.packageName · v2 packages/core/src/provider.ts:30](/home/keer/workspace/aigcfroge-v2/packages/core/src/provider.ts:30)
- **关联账本**：AUDIT-V2-LLM-PARITY、V2-D-AI；本预检不关闭。

### AI-03 Provider/Model 选项、reasoning、cache 与实际默认值 — V2 已提供

当前 V2 有 model/provider settings、variant overlays、generation/providerOptions 分类与 native facade lowering。low verbosity 的 Session 默认由已注册 VerbosityPlugin 决定，不能只对比 AI 包 helper。

- **用户入口**：Provider/Model/variant 配置及 Session context/compaction/generate/title 请求；旧 native facade/generation controls。
- **输入/输出**：输入：generation controls、reasoning effort/summary/include/store/cache key/verbosity、HTTP overlays。输出：当前模型实际 request 和协议事件；不是第二套 provider option registry。
- **Session/持久状态归属**：Location model/provider config 拥有默认及覆盖，request 只捕获当次值；Session 拥有实际 response usage/state，AI 不拥有 Session。
- **Agent/模型/Instructions/工具**：Provider.mergeOverlay/mergeHeaders、withVariant、SessionModelRequest options 分类及 provider package config 决定值。VerbosityPlugin 先尊重 event/model/variant 显式值，再由 supportsVerbosity/openAIModelID 决定 low 默认。
- **权限**：配置与 credential 边界保留；HTTP header/body hooks 沿 canonical request 执行，不绕过模型选择与 Session 归属。
- **取消/重试/恢复**：重试使用对应 prepared request/hook 合同；改 endpoint/model 不能把旧 opaque context 或 provider-bound reasoning 状态误用。
- **消费者**：ModelResolver 的 module.model(settings)、SessionModelRequest 和已注册 session hooks 都有消费者；旧 Agent overrides 另列 AI-04，不能并为全部 option parity。
- **旧数据**：旧 provider/model option 与现有 settings schema/aliases逐项 fixture映射；AI 包 helper 去掉默认 verbosity 参数并不等于 Session 默认消失。旧显式 Agent option 不在此提供状态内。
- **验收**：每一旧支持协议验证 generation、reasoning encrypted include、store、cache key、显式 verbosity/variant、大小写 headers 与 body覆盖。支持范围变化要按实际 hook函数对照。尚未运行。
- **Owner**：AI/Core Provider 与 Session hook 负责人
- **决定函数与消费证据**：[Provider.mergeOverlay · v2 packages/core/src/provider.ts:186](/home/keer/workspace/aigcfroge-v2/packages/core/src/provider.ts:186)；[Provider.mergeHeaders · v2 packages/core/src/provider.ts:205](/home/keer/workspace/aigcfroge-v2/packages/core/src/provider.ts:205)；[SessionModelRequest.prepare · v2 packages/core/src/session/model-request.ts:238](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/model-request.ts:238)；[VerbosityPlugin hook · v2 packages/core/src/plugin/verbosity.ts:26](/home/keer/workspace/aigcfroge-v2/packages/core/src/plugin/verbosity.ts:26)；[VerbosityPlugin.supportsVerbosity · v2 packages/core/src/plugin/verbosity.ts:45](/home/keer/workspace/aigcfroge-v2/packages/core/src/plugin/verbosity.ts:45)；[VerbosityPlugin.openAIModelID · v2 packages/core/src/plugin/verbosity.ts:52](/home/keer/workspace/aigcfroge-v2/packages/core/src/plugin/verbosity.ts:52)
- **关联账本**：AUDIT-V2-LLM-PARITY、V2-D-AI；本预检不关闭。

### AI-04 旧 Agent 采样与 provider option 覆盖语义 — 尚需迁移

旧 prepareRequest 将 Agent options 放入 provider/model/agent/variant 合并，并单独处理 temperature/topP；V2 migrateAgent 将 options/temperature/top_p 写入 request.body。边界有差异，未证实所有协议等价。

- **用户入口**：旧 Agent 配置的 temperature/top_p/options，随后通过 legacy/native Coding 请求执行；当前 V1 config 或 agent Markdown 导入。
- **输入/输出**：输入：旧 Agent 通用采样与 native/SDK-shaped options。当前转换输出：Agent.request.body；最终 wire 行为需逐协议 fixture 决定，不能仅以 JSON字段存在判定成功。
- **Session/持久状态归属**：现有 ConfigMigrateV1/ConfigAgentPlugin 拥有一次边界转换；Agent/model/request 保留 V2 schema，不新增平行 AgentRequest/LLM配置状态。
- **Agent/模型/Instructions/工具**：migrateAgent 与 ConfigAgentPlugin request application 是 current deciding functions；SessionModelRequest 通过 http.body 转交 Agent body，而 provider facade 把 model settings 降到 providerOptions。
- **权限**：保持 config/Agent 与 model/credential owner。选项兼容不改变工具授权或模式权限。
- **取消/重试/恢复**：覆盖选项在当前请求/重试中一致；有意不支持的旧值要明确不可用，不能静默忽略。冷恢复继续使用真实 current config，不能依旧 DTO 重建运行器。
- **消费者**：旧 LLMRequestPrep option/generation consumers 已查；V2 raw Agent request.body 有生产消费者，但旧 normalized option 语义尚未证明。
- **旧数据**：复用 migrateAgent，补必要的逐协议转换/允许差异说明。旧 temperature/top_p、nested options 与 unknown option 是不同输入类别，不能一句『配置已迁移』覆盖。
- **验收**：OpenAI Responses/compatible/Anthropic 等分别比较 Agent temperature/top_p、reasoning/其他 options、variant precedence、显式 body覆盖与不支持字段。确认 canonical final wire 后再决定最小改动。尚未运行。
- **Owner**：AI/Core Config 与 Provider 负责人
- **决定函数与消费证据**：[LLMRequestPrep option precedence · old packages/aigcfroge/src/session/llm/request.ts:90](/home/keer/workspace/aigcfroge/packages/aigcfroge/src/session/llm/request.ts:90)；[LLMRequestPrep generation controls · old packages/aigcfroge/src/session/llm/request.ts:123](/home/keer/workspace/aigcfroge/packages/aigcfroge/src/session/llm/request.ts:123)；[ConfigMigrateV1.migrateAgent · v2 packages/core/src/v1/config/migrate.ts:35](/home/keer/workspace/aigcfroge-v2/packages/core/src/v1/config/migrate.ts:35)；[ConfigAgentPlugin request application · v2 packages/core/src/config/plugin/agent.ts:111](/home/keer/workspace/aigcfroge-v2/packages/core/src/config/plugin/agent.ts:111)；[SessionModelRequest Agent HTTP body forwarding · v2 packages/core/src/session/model-request.ts:284](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/model-request.ts:284)
- **关联账本**：AUDIT-V2-LLM-PARITY、V2-D-AI；本预检不关闭。
- **Unlock**：用既有 V2 config/provider 边界完成旧 Agent options 的 wire 对照，修复必要映射或记录明确允许差异。

### AI-05 统一事件、usage、provider state 与历史重放 — V2 已提供

V2 publisher 将真实 LLMEvent 写入 Session events；history lowering 按 model/provider/error 状态决定 provider metadata 重用，opaque provider context 用完整 provenance 比较。

- **用户入口**：当前 Session provider turn、后续 turn、模型切换或 compaction 之后的 continuation。
- **输入/输出**：输入：text/reasoning/tool/usage/finish/provider metadata；输出：有序 Session 消息/工具终态、cost/tokens/provider state 和下一请求的 canonical messages。
- **Session/持久状态归属**：Session events/projections/History/ContextEpoch 持有会话事实；AI parser 只产生 normalized events。LLMRequest 从持久历史重新构建。
- **Agent/模型/Instructions/工具**：Publisher tool-call/step-finish handlers决定执行状态与usage；toLLMMessage.assistant 在同 provider+model且无error时复用绑定状态；SessionProviderContext.compatible 做完整 provenance 相等比较。
- **权限**：工具和 hosted/local 分界来自实际 events；history 中 providerExecuted 不允许重新本地执行旧结果。
- **取消/重试/恢复**：取消/半截 reasoning 与 tool completion 的历史必须真实反映；provider/model/endpoint变化不能复用不兼容 opaque window。Crash/recovery 不因此完成。
- **消费者**：SessionRunnerStep、SessionHistory/toLLMMessages 与 Session UI；下一次 provider request 实际消费 lowering 结果。
- **旧数据**：旧 text/reasoning/tool/provider metadata 与 V1/旧 V2历史需要真实转换样本；不能把所有 provider 定义存在当 universal replay parity。
- **验收**：完整/取消 reasoning、tool args/result、hosted结果、usage/finish、model/provider/endpoint切换与 continuation fixtures逐一验证。现有 session-runner-message/tool-events/model-request tests可复用，尚未运行。
- **Owner**：Core Session/History 与 AI protocol 负责人
- **决定函数与消费证据**：[SessionRunnerPublishLLMEvent tool-call · v2 packages/core/src/session/runner/publish-llm-event.ts:463](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/runner/publish-llm-event.ts:463)；[SessionRunnerPublishLLMEvent step-finish · v2 packages/core/src/session/runner/publish-llm-event.ts:540](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/runner/publish-llm-event.ts:540)；[toLLMMessage assistant metadata replay · v2 packages/core/src/session/runner/to-llm-message.ts:153](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/runner/to-llm-message.ts:153)；[SessionProviderContext.compatible · v2 packages/core/src/session/provider-context.ts:38](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/provider-context.ts:38)
- **关联账本**：AUDIT-V2-LLM-PARITY、V2-D-AI；本预检不关闭。

### AI-06 Session 多模态输入与能力过滤 — V2 已提供

旧 native adapter 接受 string/Uint8Array file parts；V2 Session 先 materialize data/file 附件，再由 model capabilities 过滤不支持输入并约束 inline image预算。

- **用户入口**：App composer 附件或 canonical prompt.files；旧 file/native message 输入。
- **输入/输出**：输入：Session 支持的附件 URI/名称/描述/范围；输出：durable FileAttachment 和对应 canonical media/text。AI 的 URL/ref source API 不等于 App 公开所有 URI方式。
- **Session/持久状态归属**：SessionPrompt 在 admission 前 materialize；SessionInbox/history 持久化附件事实；Image/文件服务与 AI Media.Asset 各守当前边界。
- **Agent/模型/Instructions/工具**：materializeAttachment 决定字节、大小、MIME、range；unsupportedParts/boundImages 决定当前 model可见内容。用户必须看到不支持输入提示，而非模型臆造已读。
- **权限**：保留 Session/Location 文件读取和输入边界；媒体 schema 不新增任意外目录/remote读取授权。
- **取消/重试/恢复**：materialization 失败或取消不能产生错误 admission；重试采用同 ID input 合同。被移除图片需重新读取，不能从记忆声称内容仍可见。
- **消费者**：App附件 → SessionPrompt → model request → actual protocol lowering；通用独立 image/video/speech generation 不计为此合同。
- **旧数据**：旧 inline media/file history逐样本走当前 history/media兼容；旧库二进制/URI升级尚未运行。
- **验收**：data/file附件、范围、MIME、大小、模型不支持、image预算、tool media结果、取消与重放；逐协议验证真实 request。现有 session-model-request/AI media fixtures尚未运行。
- **Owner**：Core Session/附件与 AI Media/Protocol 负责人
- **决定函数与消费证据**：[SessionPrompt.materializeAttachment · v2 packages/core/src/session/prompt.ts:92](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/prompt.ts:92)；[SessionModelRequest.unsupportedParts · v2 packages/core/src/session/model-request.ts:185](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/model-request.ts:185)；[SessionModelRequest.prepare · v2 packages/core/src/session/model-request.ts:238](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/model-request.ts:238)
- **关联账本**：AUDIT-V2-LLM-PARITY、V2-D-AI；本预检不关闭。

### AI-07 Session context/summary 与 native compaction — V2 已提供

V2 已有 manual/auto/overflow 的 summary/native compaction、模型能力检查及有 provenance 的 replacement window。旧 Core watermark/snip实现不应成为第二套 context runner。

- **用户入口**：当前 Session compact、自动上下文阈值或 provider overflow；旧 Core 也有 auto水位/summary路径。
- **输入/输出**：输入：当前 history/Instructions/model limits、compaction配置与trigger reason。输出：真实 summary/recent 或 native providerContext、完成/失败事实。
- **Session/持久状态归属**：Session History/ContextEpoch/compaction拥有选择与持久窗口；AI route提供 native触发/endpoint能力，不能拥有Session。
- **Agent/模型/Instructions/工具**：SessionCompaction.compact 决定 auto开关、due与native/summary分支；compactNatively 拒绝不稳定或hook改写后不兼容endpoint。ProviderContext.compatible决定窗口可重用性。
- **权限**：复用现有 compaction Agent/Model/Instructions 和 request hooks；不会借 compaction执行本地工具或扩大历史可见域。
- **取消/重试/恢复**：保留失败/取消与真实窗口提交边界；下一turn重新读当前history。post-crash provider continuation恢复仍单列P0.4。
- **消费者**：SessionRunner 的当前 context/compaction request与后续 continuation；不把通用 library compact方法当独立产品验收。
- **旧数据**：旧 summary/snipped history/opaque格式按真实adapter与projection处理；旧三水位的内部策略不直接等同新V2策略，允许差异与数据不变量需样本对照。
- **验收**：manual/auto off/overflow、未知窗口、summary失败/格式、native trigger/endpoint、endpoint改写、model切换、重载与旧历史样本。现有 session-compaction/native-compaction/checkpoint transport tests尚未运行。
- **Owner**：Core Session/History 与 AI Compaction 负责人
- **决定函数与消费证据**：[SessionCompaction.compact · v2 packages/core/src/session/compaction.ts:205](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/compaction.ts:205)；[SessionCompaction.compactNatively · v2 packages/core/src/session/compaction.ts:324](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/compaction.ts:324)；[SessionProviderContext.compatible · v2 packages/core/src/session/provider-context.ts:38](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/provider-context.ts:38)
- **关联账本**：AUDIT-V2-LLM-PARITY、V2-D-AI；本预检不关闭。

### AI-08 取消、typed错误、retry 与可选 Responses transport — V2 已提供

当前 V2 有 provider/tool fiber取消、typed AI错误与有界retry，并可按选定transport使用Session-keyed WebSocket executor。此状态仅确认执行策略接线，不关闭冷恢复。

- **用户入口**：Session interrupt/用户停止、provider失败、显式配置当前 provider transport；默认仍依V2选定模型政策。
- **输入/输出**：输入：当前provider request、error/transport observation、stop信号；输出：真实tool/assistant终态、RetryScheduled、typed失败及transport checkpoint。
- **Session/持久状态归属**：SessionExecution/Runner拥有active drain与取消；SessionModelTransport拥有process-local连接；Session持久事件和providerContext与连接状态分开。
- **Agent/模型/Instructions/工具**：SessionRunnerStep 管理provider和tool fibers；SessionRunnerRetry.policy/timeout allowance/retry hook决定是否重试。SessionModelTransport.bind按Session提供channelexecutor。
- **权限**：拒绝/取消保持当前typed边界，不能被tool转换为普通成功；provider transport不改变tool授权。
- **取消/重试/恢复**：bounded retry与用户取消已见生产入口；未知provider送达/外部副作用不可用缺日志推断未执行。完整crash/recovery、release/ACK和平台验证由主智能体另验。
- **消费者**：prepared request transport options、actual stream、runner retry/terminal events与客户端停止操作。
- **旧数据**：旧WebSocket facade存在不证明旧native Session启用：LLMNative.model选择responses而非responsesWebSocket。旧in-flight状态不自动搬为可安全重试请求。
- **验收**：HTTP/配置WS、frame错误/timeout、部分输出、provider observed、拒绝/取消、hosted/local、retry限额与typed cause；现有retry/transport测试尚未运行，不计入P0.4关闭。
- **Owner**：AI/Core Session/Transport 负责人；主智能体负责恢复验收
- **决定函数与消费证据**：[SessionRunnerStep.executeTool · v2 packages/core/src/session/runner/step.ts:95](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/runner/step.ts:95)；[SessionModelRequest.executeTool · v2 packages/core/src/session/model-request.ts:408](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/model-request.ts:408)；[SessionRunnerRetry.policy · v2 packages/core/src/session/runner/retry.ts:64](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/runner/retry.ts:64)；[SessionModelTransport.bind implementation · v2 packages/core/src/session/model-transport.ts:509](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/model-transport.ts:509)；[SessionModelRequest transport executor selection · v2 packages/core/src/session/model-request.ts:375](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/model-request.ts:375)
- **关联账本**：AUDIT-V2-LLM-PARITY、V2-D-AI、AUDIT-V2-RECOVERY-ISOLATION；本预检不关闭。

### AI-09 多模型 Task judge 与有界合并 — 尚需迁移

旧 TaskDriver.delegateJudge 有多child结果→judgeMerge的实际消费者；当前 TaskTool明确拒绝execution_type=judge。通用Generate.text/SessionGenerate不等于该产品链已接通。

- **用户入口**：旧 task execution_type=judge + judge_models；当前相同输入返回not available。
- **输入/输出**：输入：task prompt及多个model/child结果；输出：有界合并text，旧无模型/请求失败/短结果时回退首个有效结果。
- **Session/持久状态归属**：Task/Delegation/child Session拥有执行、结果与receipt；AI合并是已有结果上的一次辅助请求，不创建第二runner或Catalog。
- **Agent/模型/Instructions/工具**：旧 judgeMerge/findJudgeModel/fromCatalogModel 和TaskDriver调用决定结果；迁移复用当前 Model.small/ModelResolver及AI request/LLMClient，不能恢复旧Catalog。
- **权限**：fanout、child、结果可见域与最终review边界遵守当前Task/Delegation合同。judge文本不是人工/审查receipt。
- **取消/重试/恢复**：有界AI失败fallback需与真实Task取消/失败分开；fanout补偿、未知副作用和多participant恢复仍在P4开放。
- **消费者**：旧TaskDriver实际调用judgeMerge；当前TaskTool guard拒绝，已有Generate服务只提供可复用模型边界。
- **旧数据**：保留旧Task/child/model结果与裁决历史；不从旧judge输出推断当前revision已批准。
- **验收**：0/1/N结果、缺cheap model、失败/短响应fallback、最大fanout、模型不可用、取消、结果/receipt归属。未运行。
- **Owner**：Work/Task/Delegation 与 AI/Core 负责人
- **决定函数与消费证据**：[judgeMerge · old packages/core/src/agent/judge.ts:21](/home/keer/workspace/aigcfroge/packages/core/src/agent/judge.ts:21)；[TaskDriver.delegateJudge · old packages/core/src/tool/task-driver.ts:822](/home/keer/workspace/aigcfroge/packages/core/src/tool/task-driver.ts:822)；[TaskTool unsupported execution guard · v2 packages/core/src/tool/plugin/task.ts:232](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/plugin/task.ts:232)；[ModelResolver.resolveCatalogModel · v2 packages/core/src/model-resolver.ts:196](/home/keer/workspace/aigcfroge-v2/packages/core/src/model-resolver.ts:196)
- **关联账本**：AUDIT-V2-LLM-PARITY、V2-D-AI、V2-C-DELEGATION、V2-C-FANOUT；本预检不关闭。
- **Unlock**：在当前Task results/Model边界补judge消费者和bounded fallback，完成取消、fanout与receipt用户流程验收。

### AI-10 委派 parent context 的 LLM摘要与fallback — 尚需迁移

旧 composeParentSummary 实际调用 generateSummary 再给child prompt；当前未找到对应native LLM parent-summary消费者。Session compaction和泛用generate是可复用边界，不是这条消费者的证明。

- **用户入口**：旧Task内部委派/多模型委派带parentID；迁移后应由当前Task/Delegation的已选context转交。
- **输入/输出**：输入：允许共享的parent messages；输出：旧200–500 token摘要或raw最近5消息/2000字符fallback，随后进入child admission。
- **Session/持久状态归属**：parent/child Session及Delegation输入拥有上下文转交事实；辅助AI请求不持久化第二份parent Session。
- **Agent/模型/Instructions/工具**：旧generateSummary/findCheapModel与composeParentSummary决定有界摘要/fallback；复用当前Model/AI和SessionHistory selection，补真实child输入消费者。
- **权限**：使用当前parent context可见域与Instructions选择，不能把所有旧history默认传给外部CLI或其他域。
- **取消/重试/恢复**：摘要失败可有界fallback，但parent/child取消与未知执行不报成功；转交/retry/recovery沿当前Task/Session ownership。
- **消费者**：旧TaskDriver有实际调用；当前Generate.text/SessionGenerate提供基础，不能以存在generate endpoint关闭parent-summary链。
- **旧数据**：旧 `<session_summary>` / `parent_context` 文本仍是历史输入；不得从旧summary反推完整parent history或新的授权。
- **验收**：正常摘要、无cheap model、LLM失败/短结果、bounded fallback、child实际输入、重载、取消与跨Session可见域。未运行。
- **Owner**：Core Task/Delegation/History 与 AI 负责人
- **决定函数与消费证据**：[generateSummary · old packages/core/src/session/share-summary.ts:33](/home/keer/workspace/aigcfroge/packages/core/src/session/share-summary.ts:33)；[TaskDriver.composeParentSummary · old packages/core/src/tool/task-driver.ts:683](/home/keer/workspace/aigcfroge/packages/core/src/tool/task-driver.ts:683)；[SessionGenerate.generate · v2 packages/core/src/session/generate.ts:27](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/generate.ts:27)；[ModelResolver.resolveCatalogModel · v2 packages/core/src/model-resolver.ts:196](/home/keer/workspace/aigcfroge-v2/packages/core/src/model-resolver.ts:196)
- **关联账本**：AUDIT-V2-LLM-PARITY、V2-D-AI、V2-C-DELEGATION；本预检不关闭。
- **Unlock**：在当前delegation child admission接入经授权context的bounded summary/fallback，并验证实际消费者。

### AI-11 generateObject/结构化输出的产品启用合同 — 明确待裁决

旧与V2库都有forced tool + schema decode的generateObject能力；本仓旧native产品消费者未证实。不能凭library API或测试数宣称产品已迁移。

- **用户入口**：尚待具体产品入口、调用必要性与启用范围；未在本预检新增默认Coding工具或Builder调用。
- **输入/输出**：已有库输入：model/prompt/schema；输出：解码后的typed object或缺forced-call/schema decode的typed错误。
- **Session/持久状态归属**：库只拥有一次request/result；若产品使用，状态与确认/应用应归现有Session/资产或领域owner。
- **Agent/模型/Instructions/工具**：LLM.runGenerateObject两侧均生成一次forced工具请求并解码；具体生产producer/consumer尚未确定。
- **权限**：模型可用性与数据可见域沿现有V2模型/Session边界；结构化输出不自动应用资产或执行外部副作用。
- **取消/重试/恢复**：待定义入口的取消/重试/应用幂等；库能力存在不证明这些产品合同。
- **消费者**：当前AI库有实现，Core/Server里未发现generateObject产品调用。旧judge/summary使用普通text generate，不是此能力消费者。
- **旧数据**：无已证实的独立structured-output durable state可迁移；旧工具/schema输出保持历史。
- **验收**：先明确用户入口与所有字段，再复用已有AI generate-object测试验证forced-call缺失、malformed/schema失败和实际消费；未运行。
- **Owner**：产品入口负责人；AI/Core 负责人
- **决定函数与消费证据**：[LLM.runGenerateObject · old packages/llm/src/llm.ts:110](/home/keer/workspace/aigcfroge/packages/llm/src/llm.ts:110)；[LLM.runGenerateObject · v2 packages/ai/src/llm.ts:123](/home/keer/workspace/aigcfroge-v2/packages/ai/src/llm.ts:123)
- **关联账本**：AUDIT-V2-LLM-PARITY、V2-D-AI；本预检不关闭。
- **Unlock**：有明确必要性、产品入口、输出确认/消费和取消/恢复合同后，直接复用现有V2 API。

### AI-12 provider-hosted工具的产品目录与执行授权 — 明确待裁决

旧native和V2均有providerExecuted跳过local dispatch的行为；这不证明默认Session已安装或授权hosted tool。需要独立必要性、定义producer和消费者。

- **用户入口**：待明确具体provider-hosted功能开关/用户入口；普通Coding/MCP/local Tool注册不自动等价。
- **输入/输出**：输入：provider-native定义/选项与允许数据范围；输出：providerExecuted call/result/provider metadata及明确的Session消费。
- **Session/持久状态归属**：provider拥有hosted执行，Session记录观察的call/result；本地Tool registry不能代替provider能力或其副作用状态。
- **Agent/模型/Instructions/工具**：两侧stream对providerExecuted不做local dispatch；V2 ToolRuntime.definition产生本地tool定义，SessionModelRequest.drop invented hook entries也不是hosted producer。
- **权限**：必须明确provider工具启用、数据访问和实际用户授权；local leaf审批与hosted执行边界不混用。
- **取消/重试/恢复**：需要定义provider取消/partial result/未知执行与重试合同；已执行hosted结果不得当作待执行local tool重放。
- **消费者**：已查统一事件/hosted skip消费者；具体hosted定义来源与默认产品调用尚未证实。
- **旧数据**：保留providerExecuted/state/result历史；不根据名称或缺本地日志推断provider未执行。
- **验收**：确定入口后测试真正provider-native definition lowering、hosted events、零local副作用、history replay、取消/重试和实际UI消费。未运行。
- **Owner**：产品负责人；AI Protocol/Core Permission 负责人
- **决定函数与消费证据**：[LLMNativeRuntime.stream · old packages/aigcfroge/src/session/llm/native-runtime.ts:74](/home/keer/workspace/aigcfroge/packages/aigcfroge/src/session/llm/native-runtime.ts:74)；[SessionRunnerStep provider stream · v2 packages/core/src/session/runner/step.ts:111](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/runner/step.ts:111)；[ToolRuntime.definition · v2 packages/core/src/tool/runtime.ts:21](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/runtime.ts:21)；[SessionModelRequest.prepare · v2 packages/core/src/session/model-request.ts:238](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/model-request.ts:238)
- **关联账本**：AUDIT-V2-LLM-PARITY、V2-D-AI、AUDIT-V2-PERMISSION；本预检不关闭。
- **Unlock**：明确hosted功能必要性、definition producer、用户授权、结果consumer与未知执行恢复合同。

## 方案与收敛顺序

- **简单实现**：复用独立 verify/配置 command/MCP 查询，让用户显式触发。实现少，但旧自动 diagnostics、post-tool 校验与 doom-loop 前置审批仍是技术债，不能作为本合同的等价关闭。
- **稳健复用**：在现有 Location lifecycle、Tool snapshot/local invocation、Session hooks 与 Instructions producer 中复用已有 detector/校验服务；统一新工具名、CodeMode、Permission.Source、终态与取消。LSP 接真实服务和 FileMutation，review 接已有 configured-subagent command。

推荐稳健复用；本预检只记录合同，没有选择手动降级实现、添加框架或实施迁移。

1. 先冻结本预检输入与产品待裁决范围，保持 V2 AI/Model/Provider 默认。
2. 将 COD-07/08/09 归为共享工具执行边界缺口；在当前边界复用实现，验证 direct/CodeMode、权限与取消，不搬旧 runner。
3. 在 Location lifecycle 建立真实 LSP 服务，再接查询/status 与 FileMutation diagnostics。
4. 复用 ConfigCommandPlugin 的 subagent/subtask 路径处理 review 默认差异。
5. 在现有 ConfigMigrateV1/provider boundary 验证旧 Agent options 的 final wire；在现有 Task/Model/result owner 迁移 judge/parent-summary。
6. 待必要性与启用合同明确后才启用 library-only 能力；默认 Coding 目录独立裁决。

## 验证与未交付范围

执行的检查仅为产物 JSON/字段、源路径/行锚点、工作树与固定 Git blob 摘要、四个注明范围的负查询，以及现有测试文件路径检查。负查询的无匹配退出码为 1；不记成测试通过。

测试、构建、生产模块和索引均未运行。可复用测试路径与逐项未来 acceptance 见配套 JSON；主智能体独占串行 runtime/CI 验证。

- 本预检没有运行生产模块、测试、构建、索引，也没有形成 P1/P0.3/P0.4 或全产品审批。
- 分类统计是合同来源/接线盘点，不是验收通过率、文件迁移率或 provider 家族的 universal wire parity。
- 旧工作区包含既有 WIP；old HEAD 不是所有被读字节的替代。本文件按实际工作树 source SHA256 记录。
- 静态负查询只覆盖注明的本仓内建源码，不覆盖用户外部插件、MCP 服务或真实运行环境。
- 未把独立 Image/Video/Speech/Transcription API 或 provider facade/DTO 文件数量计为旧 native LLM 产品合同。
- 完整旧库升级、所有历史/opaque state、完整 Core、CLI/App/Desktop、网络/OAuth、发布和跨平台均未在本预检交付。主智能体的串行运行/CI 证据独立。
- 冻结的 Merman G、restoration/final-source 证据与原审批未改；本预检不扩展其批准范围。
- Plan/债务账本未改；本 JSON 为每项迁移/待裁决范围保留 existing debt IDs、Owner、unlock condition，主智能体在自己的 slice close 前负责账本登记。

配套机器记录：[p1-coding-ai-contract-preflight.json](/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/p1-coding-ai-contract-preflight.json)。其中每个源文件都有实际 SHA256、HEAD blob、fixed-upstream 存在/锚点依据；每项开放合同都有 Owner 与 unlock condition。
