# AigcForge V2 对齐计划审批与替代路线

日期：2026-10-25。范围：架构审查与报告复审。本文件已按独立复审修正证据口径、权限 hook 条件、恢复历史事件条件、依赖方向和协议适用范围。产品实现保持暂停；可作为新实施计划依据。审批过程见 [报告复审](v2-alignment-report-approval-2026-10-25.md)，唯一现行计划见 [实施计划](../research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md)。

## 审批结论

**批准以 OpenCode V2 为基准迁移自研功能的总体方向；不批准原实施计划原样继续；不批准当前 WIP 收口、整项迁移完成或发布切换。**

V2 的架构、执行语义、数据归属、UI 宿主先成为基准。复刻自研功能的用户行为、状态、结果与约束，再按 V2 的模块边界实现。归一化从每条功能链开始，最后删除兼容层和旧实现。不能先建立两套执行或状态归属，再把合并留到最后。

现有成果应保留：所审 SessionExecution、SessionRunner、Step、持久 inbox、Delegation 和 Workflow 的 child Session 接入，没有在这些链上重建第二个 provider runner。所审 Desktop/App/GUI/session-ui 主体也继续沿用 V2。需要修订的是旧文件回植指标、部分共用语义，以及新增功能到产品的接线和验收。

## 基线、分支与历史恢复

- 实施现场：[aigcfroge-v2](/home/keer/workspace/aigcfroge-v2)，分支 `v2-dev`，HEAD `251c0fe38041a326e624db464d1ee0efd1522881`。存在未提交 Task/UI/Schema/生成器改动。
- 当前聊天初始目录：[aigcfroge](/home/keer/workspace/aigcfroge)，分支 `desktop-session-nav`，HEAD `1a6b238d7bb73916c933d5c4715326d376a34805`，另有未提交改动。它作为旧产品合同和协议参考。
- 固定上游：`upstream/v2 = 4617210822bdbb31e5749751afbfb4584ccedac8`。2026-10-25 的 `git ls-remote upstream refs/heads/v2 refs/heads/dev` 再次确认远端 V2 相同。远端 dev 已为 `6ac6549a0aed2c69cc31eff17abdc1d690a585a6`，没有混入此次基准，也未更新本地 refs。
- 已读取指定聊天 `01a16d33-4f54-7910-90f0-aef483334f06` 的可用历史。上次已暂停 TaskPanel、生成器和调度实施，审查因代理错误未完成交付。本轮接续已有报告，并由三条新子审查独立核对运行核心、增量领域、UI/桌面链。
- 本次文档写入前，复核上次暂停快照的 29 个文件 hash 全部相同。其中包含源码、测试、配置、锁文件和文档。逐文件 SHA256 见 [暂停快照复核](evidence/v2-alignment-review-2026-10-25/pause-snapshot-recheck.json)。本次交接修改报告、计划和账本文档；27 个既有非文档文件（源码、测试、配置和锁文件）hash 保持不变。没有切分支、修改产品实现、提交、安装依赖或重启服务。

## 第一性原理与共同根因

旧计划将“旧文件完整回植、合同数、类型检查通过”同时用于描述功能和对齐进度。这些指标分别证明文件存在、契约装配和类型关系，不能决定用户流程是否可用。真正的审批单位应是：**用户入口 → Session 准入 → V2 执行 → 持久结果 → UI 消费 → 取消/重试/恢复**。

另一个共同根因是协议时点混用。旧 [CLAUDE.md](/home/keer/workspace/aigcfroge/CLAUDE.md:67) 和 [ARCHITECTURE.md](/home/keer/workspace/aigcfroge/ARCHITECTURE.md:91) 描述旧包拓扑和运行术语；当前 [V2 AGENTS](../../AGENTS.md:178) 与 [Session contract](../../specs/v2/session.md:9) 已使用 Step/Physical Attempt、Instructions、持久 execution claim 和 first-admission-wins。旧 exact-retry 规则与当前 first-admission-wins 不是同一合同，分别由 [旧 SessionInput.equivalent](/home/keer/workspace/aigcfroge/packages/core/src/session/input.ts:666) 与 [当前 SessionInbox.matches](../../packages/core/src/session/inbox.ts:69) 决定。旧协议禁止未设计的崩溃续跑，当前 V2 已定义 claimed Session 启动恢复；它仍不保证 clustered ownership 或 exactly-once。这些差异按用户明确的 V2 基准目标记录，源码证据不能自行覆盖另有明确的人类要求。审批应明确记录这类基线差异，再修订实施文档，不能一边搬旧实现，一边宣称沿用 V2。

工程约束继续遵守：先查真实接口，复用现有归属，单包串行验证，不手改生成物，不以占位成功掩盖未交付。关注点权威由 [V2 specs/Authority](../../specs/v2/README.md:5) 划分：Schema 管共享形状，Protocol 管 HTTP，Core 管执行与持久化，Server 装配它们，Client 消费契约，App 消费 Client。

## 可核验发现

### F1：保留 V2 执行骨架，撤销旧 runner 回植工作令

[SessionExecution](../../packages/core/src/session/execution.ts:114) 仍创建进程内 coordinator，交给当前 Location 的 SessionRunner；[Step.attempt](../../packages/core/src/session/runner/step.ts:111) 保留每次 Physical Attempt 的显式 `llm.stream`。新增 [Delegation.dispatch](../../packages/core/src/delegation/execution.ts:616) 与 [Workflow.executeStep](../../packages/core/src/workflow/execution.ts:471) 创建或绑定 child Session，`prompt({resume:false})` 后 wake，协调与模型执行归属分开。

因此，旧计划的 TaskDriver、workflow-runner、fork model/runtime 待回植清单不能继续决定实现。已有 `needsContinuation` 是共用 Step 的新增事实，由 [MessageUpdater](../../packages/core/src/session/message-updater.ts:264) 投影、[SessionInputResult.read](../../packages/core/src/session/input-result.ts:52) 判定输入完成。可以保留，但应列入允许差异清单；历史缺事实返回 unverified，不等于已完成所有 provider 和历史库验收。

### F2：权限存在明确静态偏移，工具展示与执行来源尚未归一

决定关系的函数是 [PermissionEffective.compute](../../packages/core/src/permission/effective.ts:52)，不是模式标签或调用点。它在 [131 行](../../packages/core/src/permission/effective.ts:131) 将非兜底 deny 规则再次追加到底部；[Permission.configured](../../packages/core/src/permission.ts:193) 对所有模式进入该路径。

静态例：Coding、有人值守、master=false、savedApprovals=[]，且权限 hook 不改判。Agent 为 `read/*/deny`，Session 为 `read/*/allow`。固定上游 `permission.ts:158` 合并为 `[deny, allow]`，其 `evaluateInput:173` 最后匹配得到 allow；当前 compute 形成 `[deny, allow, deny]`，结果 deny。关闭 Custom 不隔离此差异。

工具快照仍由 [SessionContext.select](../../packages/core/src/session/context.ts:216) 的原始 merge 与 [Tool.whollyDisabled](../../packages/core/src/tool.ts:374) 决定。同例的工具快照保留 read，但计算规则为 deny；在权限 hook 不改判时最终准入拒绝。最终效果还经过 [Permission.evaluateInput](../../packages/core/src/permission.ts:271) 的 plugin hook，不能省略这个边界。[已有 saved-deny 测试](../../packages/core/test/permission.test.ts:243) 验证另一条两边都相同的关系，不能排除此差异。

审批：按用户已有“保留 V2 展示与权限、requestedCapabilities 仅声明”裁决，先恢复或明确批准共用语义，再迁移自研档位。不能默认把旧权限信封推广至普通 Coding。这是源码静态证明，本轮未运行对应 Core 行为测试。

### F3：当前生成器引用错误已实际复现，WIP 不能收口

[structuralTypes.render](../../packages/httpapi-codegen/src/index.ts:1082) 顺序替换引用，先产生的输出名会被后续输入引用再次命中。当前 [ConfigMCP.servers](../../packages/client/src/promise/generated/types.ts:3878) 引用旧 `McpRemoteConfig2`，其 `enabled`/数字 timeout 与 [canonical Mcp.RemoteConfig](../../packages/schema/src/mcp.ts:53) 的 `disabled`/结构化 timeout 不同；canonical RemoteConfig 的 oauth 也引用旧 camelCase OAuth。

初次架构审查轮从 codegen 包目录调用实际 `compile/emitPromise`，只用两个不同 schema identifiers 复现：

```ts
export type McpRemoteConfig = { readonly disabled: boolean }
export type McpRemoteConfig2 = { readonly enabled: boolean }
export type SampleGetOutput = {
  readonly current: McpRemoteConfig2
  readonly legacy: McpRemoteConfig2
}
```

`current` 应引用 disabled 结构，却指向 enabled 结构。诊断子进程 exit 1；外层记录程序 exit 0 只代表成功写出证据。见 [诊断源码](evidence/v2-alignment-review-2026-10-25/codegen-reference-diagnostic.ts)、[输出](evidence/v2-alignment-review-2026-10-25/codegen-reference-diagnostic.log)、[元数据](evidence/v2-alignment-review-2026-10-25/codegen-reference-diagnostic.json)。

同一 codegen 包现存测试在初次架构审查轮 **99 pass / 0 fail / 226 assertions**。它没有覆盖上述引用关系。后续修唯一替换根因，保护 canonical 与 legacy 的各自引用和公开类型；不能手改生成物、改消费者名称绕过，或把名字数量/二次生成零漂移当语义正确。

### F4：桌面 CLI 与发布闭包被过早裁剪，旧 sidecar 替换依据不足

V2 [DesktopCli.resolve](../../packages/desktop/src/main/service/desktop-cli.ts:53) 与 [resolveBundled](../../packages/desktop/src/main/service/desktop-cli.ts:77) 已支持内置 CLI；[BackgroundService.connect](../../packages/desktop/src/main/service/background-service.ts:32) 用 `serve --service`、服务发现、版本协调与复用。这条链不要求用户另行安装外部 CLI。

当前 [prepareServer](../../packages/desktop/scripts/dev.ts:52) 仍指向被删除的 `packages/cli`；[prebuild](../../packages/desktop/scripts/prebuild.ts:8) 要求 CLI_DIST，打包与运行时都读 CLI/version；[prepare](../../packages/desktop/scripts/prepare.ts:2) 和 publish 仍引用已删除的 script 包。

审批：先恢复桌面实际需要的 V2 启动、服务和发布闭包，再按产品范围裁剪 TUI 交互或发布入口。原计划 [§5.3](../../docs/research/upstream-v2-sync/2026-10-16-upstream-v2-desktop-alignment-plan.md:167) 与 [方案1](../../docs/research/upstream-v2-sync/2026-10-16-upstream-v2-desktop-alignment-plan.md:176) 的旧 utilityProcess 瘦 sidecar 回植路线应改写。本轮没有启动、打包或发布桌面产物。

### F5：保留 V2 UI 宿主；计划的 AppInterface 插槽并不存在

[AppInterface](../../packages/app/src/app.tsx:87) 的参数是 children、servers 和 router。真实扩展点由 [GUI SlotMap](../../packages/gui-extensions/src/sdk/registries.ts:546) 与 [ExtensionSlot](../../packages/app/src/runtime/extension/render.tsx:33) 决定，另有 Panel、Command、SettingsPage。

审批：重写原计划 [方案3](../../docs/research/upstream-v2-sync/2026-10-16-upstream-v2-desktop-alignment-plan.md:184) 与 R3 整体旧 UI 回放路线。侧面板、标题状态、命令使用已有注册面；模式创建、composer 和路由没有现成接点时，明确修改哪个 V2 宿主并验证生命周期。保留 provider、Session.location、缓存、timeline、composer、Token、i18n 和可访问性。

所查 DesktopApp、AppInterface、AppRoutes、GUI 注册/渲染、new-session adapter、HEAD screen 经品牌映射后与固定 V2 一致。品牌关系由 [rename-bridge.transform](../../script/rename-bridge.ts:40) 决定。这证明这些源码仍保留基座，不能证明改变 Core/Schema/Server 后的完整产品行为。

### F6：五模式的合同存在，但创建与 Agent 生产消费链未完成

[new-session 创建](../../packages/app/src/new-session/composer-adapter.ts:97) 和 [Data.session.create](../../packages/client/src/solid/data.ts:1552) 没有 mode 参数；[Session.create](../../packages/core/src/session.ts:460) 因而默认 Coding。[SessionContext.select](../../packages/core/src/session/context.ts:149) 对非 Custom 使用当前 agents.select，模式 Agent policy 检索未发现生产消费者。

不能用 five-mode union、Core 支持字段或增加 selector 代替五模式产品迁移。每个模式应明确用户入口、Session 分类与继承、Agent、Instructions、Tools、权限、模型、结果和恢复。复用 V2 创建/切换/执行归属，UI 与领域在同一功能链内交付。

默认 Coding 的增量工具也需明确允许差异：[PluginInternal.pre](../../packages/core/src/plugin/internal.ts:329) 全局注册 Task、资产、memory、reminder。关闭 Custom 不恢复上游原始目录，不能把“runner 保留”等同“普通 Coding 的模型上下文完全原样”。

### F7：已有 meta 与 Custom 成果应保留；身份、记忆和资产写入仍有断点

[builtin meta](../../packages/core/src/plugin/agent.ts:182) 已注册，context 已渲染 meta system，持久 Task/Delegation 也有真实执行链。不能说元智能体完全缺席。但 [MetaAgentMemory.record](../../packages/core/src/agent/meta/memory.ts:87) 要求 Session 已 attach 到 meta identity；生产检索未见 create/attach 的入口。旧 system-context 记忆注入与当前 Instructions 的消费归属也需接续核对。

Custom 的冻结 snapshot、Command 模板消费和部分 lifecycle 已有成果，可保留。产品 Builder、资产引用/删除提示、模式入口和实际用户执行仍开放。

资产断点不只在 UI：[Server.handlers](../../packages/server/src/handlers.ts:121) 仍装配七组 [asset-stubs](../../packages/server/src/handlers/asset-stubs.ts:16)。Prompt/Skill/MCP/Command/Agent/Plugin/Workflow 的 list 或 apply 直接失败。Core propose 模块测试与磁盘读取不能证明“候选 → 用户确认 → apply → 注册 → 实际消费”闭环。先选择一个资产族打通真实 HTTP 与消费者，再扩展共享路径。

### F8：Task CRUD 是部分成果；调度、结果和 M7 仍未交付

[TaskPanel.mutate](../../packages/app/src/session/tasks/session-task-panel.tsx:108) 与 [Data.session.task](../../packages/client/src/solid/data.ts:1433) 复用当前 client、cache、sync，keyed screen 限定 Session 生命周期。可以保留数据接线。但 [outputDigest 展示](../../packages/app/src/session/tasks/session-task-panel.tsx:512) 仍是文本，持久 child 导航、当次快照、Work 恢复、标题进度和外部关闭尚未闭合。

当前表单可以作为临时 CRUD 消费，最终位置和交互按 V2 header/panel/timeline 决定。旧 M7 的功能约束可保留，旧布局尺寸、轨道形态和动画不应强制复刻。

Todo 与 Task 的关系由 [SessionTodo.update](../../packages/core/src/session/todo.ts:109) 决定，其写入转到 SessionTask；不能因为两个模块存在就判断两份持久状态。Task CRUD 也不等于 Schedule daemon 或模型执行，调度 producer 和 primary agent 通道应单独验收。

### F9：事件保留与恢复边界需要产品配置和故障隔离验收

[Server.makeRoutes](../../packages/server/src/routes.ts:132) 默认不强制保留事件；Workflow 与 Delegation 的执行、折叠依赖 retained events。现存 opt-in 测试不能外推默认桌面可用。保留 V2 默认行为，把功能启用、实际服务配置、版本复用、取消和恢复列入产品合同。

另有条件性恢复风险：[SessionRestart](../../packages/core/src/session/execution/restart.ts:212) 在普通 claimed Session 恢复前直接等 Delegation.recoverPending。旧库仍存在可折叠的 retained EventTable 历史，能够还原 internal participant、childSessionID 和 delivery；仅有投影行不足以触发此路径。相关 Session 不被 disabled Custom 提前跳过且 child 不 active 时，recover → settle → [foldState](../../packages/core/src/delegation/service.ts:192) 可因当前关闭 retained events 失败，再经 orDie 传播，阻止 [普通恢复循环](../../packages/core/src/session/execution/restart.ts:259) 到达。[服务安装](../../packages/server/src/process.ts:240) 将它 forkScoped，风险是恢复 fiber 失败，不能说整个服务启动崩溃。

本轮未运行这条混合旧库故障路径；这是明确条件的源码推导。现有 persist=true Delegation 测试和 Workflow events-off guard 测试没有证明该组合。后续保持原开关，验证领域故障不阻断普通 Session 恢复。

### F10：不能批准数据库与整体产品切换

[DatabaseMigration.applyOnly](../../packages/core/src/database/migration.ts:54) 以 migration ID 判重，并用旧 journal 名称/时间戳映射身份。旧计划“归并后重排时间戳”必须限定为未发布的新 migration，不能重编号已执行迁移。

真实旧库副本、字段/事件/结果不变量、packaged 冷启动、内置 CLI/native PTY、跨版本服务接管和发布产物尚未在本轮验证。浏览器 keeper 使用 production App build 配 mock API/PTY，不能代替这些验收。

[性能记录](../../docs/review/evidence/v2-task-panel-2026-10-24/production-comparison.json:384) 每版本一次，首正确显示 `575.6 → 956.6 ms`，稳定 `662.5 → 1170.9 ms`，未归因。它提示需要配对复测与 profiling，不能用于显著性结论或性能闭环。

## 替代实施路线

### 阶段 0：先恢复可运行、可比较的 V2 基线

固定 commit、允许品牌差异和明确的增量合同。先解决 F2/F3 的共用兼容问题，恢复 F4 的必需桌面入口闭包，检查普通 Session、工具展示/权限、UI、IPC/storage、后台服务与 PTY。共用变更单独验收，不能用关闭 Custom 代替隔离。

同时修订旧计划的权威状态：保留历史完成记录，撤销旧文件回植、虚构插槽、旧 sidecar 默认替换和迁移重编号工作令。不要继续新增第二套 API 或 runtime。最终合并目标在 cutover 决策中明确，本轮不以 main/v2 的默认规则冲突执行合并。

### 阶段 1：把旧文件清单改为可验收功能合同

每项记录：用户行为、V2 对应归属、允许差异、输入输出、持久状态、权限、取消/恢复、真实消费者和验证方法。旧实现只提供功能语义。模式不是 Agent 分类，模式选择不能隐式创建或重分类 Session；这些旧产品不变量应通过 V2 creation/route/cache 接线保留。

未确定的产品差异保留 V2 行为，并登记具体缺失与解除条件。模块存在、stub 合同或测试绿不能关闭用户功能。

### 阶段 2：按功能链逐项迁移，UI 与领域一起完成

建议顺序：

1. 模式分类与创建链：UI 选择 → Client → Protocol/Schema → Session owner → 继承/切换 → 页面显示与重载。
2. 首个资产族：propose → 用户确认 → 真 HTTP apply → 现有注册/配置 → 实际 Session 消费；共用路径稳定后扩展其它资产族。
3. Meta 身份与记忆：复用 builtin meta、Session 与当前 Instructions；接通 attach、record、读取与恢复。模型执行仍归 SessionRunner。
4. Custom 用户流程：保留已验证冻结与 Command 子范围，补 Builder、选择、启动、结果、引用/删除和恢复消费。
5. Work Task/Delegation/Workflow：从已存在的 CRUD、child Session 和持久结果继续，补真实调度/进度/导航/取消/恢复。是否在默认桌面启用 retained events 是明确配置合同。

运行依赖应明确：Core 依赖 Schema/AI；Protocol 依赖 Schema；Server 依赖 Core/Protocol；Client 依赖 Schema/Protocol，禁止 Client 运行时导入 Core/Server；App 消费 Client。HTTP 消费链是 App → Client 请求 → Server → Core，不是模块依赖箭头。生成关系由 [Client build 的 compile(ClientApi)](../../packages/client/script/build.ts:69) 决定。展示复用 GUI registry、session-ui renderer、composer 和 timeline；不能另建持久 owner。完成一条链就删除无消费者适配，并验证普通 Coding 未回归。

### 阶段 3：最终归一化、迁移与切换验收

删除已无消费者的旧 API、DTO、注册表和状态副本，统一当前文档/术语/包拓扑；保护生成引用含义、持久 ID 和数据库 migration 身份。完成真实桌面、服务复用/native PTY、旧库副本和同环境性能验收后，才能审批发布与 cutover。

## 简单实现与健壮架构的比较

简单路线是立即搬回旧页面、runner、权限信封，再补适配。它短期能恢复更多外观，但会扩大 V2 差异、重复 owner 和升级成本，不批准。

建议的架构路线是保留 V2 基座与 owner，用最小纵向功能链复现自研行为。也不需要先造一个“统一元框架”或改造所有扩展点。已有 Slot/Panel/Command 能承接时直接复用，确有缺口才扩展 V2 宿主。

采用增量路线的技术债应明确：部分旧产品功能暂时缺席，TaskPanel 暂为 CRUD 消费，旧镜像 API 暂仍占位，跨平台入口、默认事件配置和完整恢复未交付。这些缺失不能计作功能已对齐。

## 审查台账与解除条件

初次只读审查未改项目台账；本轮文档交接已将下列范围合入 [canonical technical debt](../../docs/technical-debt.md)，按新计划实施后再逐项关闭。

- **AUDIT-V2-PERMISSION**，Owner：Core 负责人/主智能体。解除：明确 V2 权限合同，真实 Agent deny + Session allow 回归、工具快照和实际执行一致；不新增 capability 授权映射。
- **AUDIT-V2-CODEGEN**，Owner：Codegen/Client 负责人。解除：当前最小失败诊断转绿，canonical/legacy MCP/OAuth 正确引用，单包测试与官方生成语义核验通过。
- **AUDIT-V2-DESKTOP-CLOSURE**，Owner：Desktop/Release 负责人。解除：V2 开发、服务、打包和发布所需入口齐全，真实冷启动与 PTY handoff 通过；关联 V2-R01-RELEASE。
- **AUDIT-V2-ASSET-CONSUMER**，Owner：Core/Server/App 负责人。解除：至少一个资产族真实 propose/apply/注册/消费闭环，随后扩展其余六组；关联 V2-SERVER-LEGACY/V2-D-COMPOSITION。
- **AUDIT-V2-MODE-META**，Owner：Core/App 负责人。解除：模式实际创建/继承/Agent 选择与 Meta attach/记忆/Instructions 有生产消费者和功能验证。
- **AUDIT-V2-RECOVERY-ISOLATION**，Owner：Core/Server 负责人。解除：旧 Delegation 数据 + events off + 普通 Coding claim 的故障测试证明恢复隔离，不误重放未知副作用。
- **V2-C-TASK-PANEL / V2-C-TASK-SCHEDULE / V2-C-TASK-CONTRACT / V2-C-WORKFLOW / V2-D-COMPOSITION / V2-VALIDATION**，沿用当前 Owner。解除：按已有账本补产品消费、调度、配置、恢复、真实桌面/数据库和性能，不用 CRUD 或后端测试关闭整项。
- **AUDIT-V2-DOCUMENT-AUTHORITY**，Owner：项目 Owner/主智能体。解除：旧方案已标 superseded，当前基准、允许差异、术语、合并目标和验收方法有一份可执行计划。

## 验证记录与边界

初次架构审查轮仅在 `packages/httpapi-codegen` 串行执行产品单包测试与最小诊断；本次文档复审没有重跑产品测试：

- `../../script/bun run test --timeout 30000`：exit 0，99 pass / 0 fail / 226 assertions。见 [测试日志](evidence/v2-alignment-review-2026-10-25/codegen-existing-tests.log) 和 [运行记录](evidence/v2-alignment-review-2026-10-25/codegen-existing-tests.json)。
- 实际 compile/emitPromise 的引用诊断：exit 1，canonicalReferencePreserved=false。未修改产品生成器或生成物。
- 66 份历史命令元数据与日志 SHA256 在初次架构审查轮重新核对，全部吻合。见 [历史证据核对](evidence/v2-alignment-review-2026-10-25/historical-evidence-recheck.json)。历史失败分别保留，未改记为成功；历史 tallies 不计作本轮测试通过。
- 部分 TaskPanel/screen/spec 已晚于历史 keeper 的 source hashes。日志真实不代表当前 UI 已通过；后续定稿需重跑受影响 keeper。
- 两轮均未重跑 Core/Server/App/Client 全包、真实 Electron、native PTY、旧库升级或性能测试。权限结论为静态证明，恢复风险为条件推导。

恢复实施后的本地门禁：主线独占测试进程，先受影响包 typecheck 与有意义的定向测试，再运行该切片所需单包全量。App 浏览器验收使用 `workers=1`、`retries=0`；子智能体做独立文件范围审查或实现，不并发测试。Protocol 没有 test script 时使用其真实 typecheck/生成和相邻 Server 合同测试，不虚构命令。全仓 check 和跨平台矩阵留给 CI/切换验收。

完成的是基线与关键代码族、上下游生产链、测试合同和当前计划审批。没有逐行读完所有项目文件，也没有批准所有功能已对齐。本轮仅修改交接文档；新会话从已修订实施计划的 P0 开始。报告所列产品问题保持开放。
