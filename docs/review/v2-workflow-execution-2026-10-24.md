# V2 Workflow 执行检查点（2026-10-24）

本轮从 `50c4da530b` 接续，在 `aigcfroge-v2 / v2-dev` 交付 Workflow 后端执行子范围。实现、验证和剩余范围分别核算；整体 V2 迁移继续开放。

## 基准与权威来源

实施目录为 `/home/keer/workspace/aigcfroge-v2`，分支为 `v2-dev`。参考目录 `/home/keer/workspace/aigcfroge` 的 `desktop-session-nav` 工作不属于本轮写入范围。

当前未交付状态以 [技术债账本](../technical-debt.md) 为准。恢复的历史通过 [剩余迁移清单](v2-remaining-inventory-2026-10-19.md)、[升级接续记录](v2-upgrade-progress-2026-10-19.md) 和 [Workflow 读取检查点](v2-workflow-read-2026-10-24.md) 核对；原目标见 [迁移计划](../research/upstream-v2-sync/2026-10-16-upstream-v2-desktop-alignment-plan.md) §8、§10.24。历史切片的验证不计为本轮验证，本轮也不缩减全迁移目标。

本轮拆出 Workflow 后端执行、Task 更正和取消来源 unarchive 子范围，并在账本登记历史归属、事件保留和规模性能残留。关闭状态以本轮命令和下列边界为准。

## 本轮实现

1. **Workflow 执行与准入，映射 V2-C-WORKFLOW / V2-D-COMPOSITION。** `WorkflowExecution` 提供 run、cancelRun、cancelStep、retryStep、resume、wait 和启动核对。步骤从冻结快照选择 Agent，经真实 child `Session.prompt({ resume: false })` 准入，再由当前 `SessionExecution.wake/awaitIdle` 执行。`WorkflowRun.getOrCreate` 决定 requestID 的持久复用与冲突，`retryRun` 创建新的不可变重试 lineage；没有增加旧 TaskDriver 或另一套模型执行 owner。决定函数：`packages/core/src/workflow/workflow-run.ts:385`、`:1124`，执行入口 `packages/core/src/workflow/execution.ts:840`。

2. **DAG、分支与失败策略，映射 V2-C-WORKFLOW。** frontier 和步骤 prompt 共用 `WorkflowRun.predecessorsFor` 的直接前驱关系。串行、受限并行、严格单 JSON 分支、timeout、attempt 上限及 run/step CAS 接入现有状态 owner。live、batch 和启动核对共用 `failureDecision`；retry 耗尽保留独立错误类别。决定函数：`packages/core/src/workflow/workflow-run.ts:320`；`packages/core/src/workflow/execution.ts:137`、`:149`、`:448`。

3. **精确输入恢复与结果交接，映射 V2-C-WORKFLOW / V2-C-RECOVERY。** 已知终态按确切 child Session/input receipt 结算；只有事务内重验仍未投递的 dispatch 可继续。未知 provider/tool 副作用进入 `recovery_required`，不因进程重开自动重跑。终态 run 使用确定性 root inbox ID 交接；准入失败保留 Job 错误，wait 可报告缺失 receipt。决定函数：`SessionInputResult.read`（`packages/core/src/session/input-result.ts:21`）、`WorkflowRun.recoverDispatch`（`packages/core/src/workflow/workflow-run.ts:567`）、`WorkflowExecution.reconcile` / `wait`（`packages/core/src/workflow/execution.ts:662`、`:937`）。协调器和 Job 仍为进程内 owner；这不证明多进程执行所有权或未知 provider 工作的自动重放。

4. **生产 HTTP 与事件合同，映射 V2-C-WORKFLOW。** 四个既有执行 handler 已调用当前 WorkflowExecution，并沿用 Session/Location 归属与认证。`workflow.run.updated` 的唯一 Schema 已移到 schema 包；Core facade 复用同一对象，持久和公开清单都注册该事件。保留 type、版本 1、runID 聚合及原公开字段；可选字段使用 canonical optional。决定函数：`SessionInstanceHandler`（`packages/server/src/handlers/session-instance-stubs.ts:174` 起）、生产 nodes（`packages/server/src/routes.ts:77`）、Schema 定义（`packages/schema/src/workflow-event.ts:6`）、facade 直接导出（`packages/core/src/workflow/event.ts:9`）和清单（`packages/schema/src/durable-event-manifest.ts:12`、`packages/schema/src/event-manifest.ts:69`）。同 revision live/log/GET 的关系由 `WorkflowRun.transition`（`packages/core/src/workflow/workflow-run.ts:340`）从完整 `next`（`:348`）构造并写入决定。生成与认证 SSE 结果见验证节。

5. **删除与执行共用准入边界，映射 V2-C-WORKFLOW / V2-C-RECOVERY。** `Job.withSessionDeletion` 覆盖 Session.remove 全程。Job.start 在已有 synchronized jobs 状态中检查 root/child 删除租约；Workflow 准入、handoff 和 wake 使用同一边界，取消仍可执行。删除中拒绝的 child Job 不运行输入，并把所属 step 持久结算为 cancelled。决定函数：`packages/core/src/job.ts:292`、`:533`、`:537`；`packages/core/src/session.ts:674`；`packages/core/src/workflow/execution.ts:209`、`:640`、`:836`。内部 cancelled Job waiter 在既有 Session mutex 内重读 Run/Step，避免内部竞争误判未知执行；真实交错回归见验证节。

6. **通知共同判定与 restart 接线，映射 V2-C-RECOVERY。** Delegation 与 Workflow 复用 `SessionNotification.inspect`，依据可见消息、持久 inbox 生命周期、取消、失败/人为停止和 staged revert 决定 admit/wake。在 retained events 前提下，已准入后被删除的通知不重建。SessionRestart 合并两域通知 parents，并保留既有恢复预算和 suspended 判定。决定函数：`packages/core/src/session/notification.ts:11`、`:43`；`packages/core/src/session/execution/restart.ts:206`、`:249`。

7. **Task 人工更正，映射 V2-C-TASK-DECISION。** 新写入通过现有 KV 保存该输入实际写入的 Task revision/status；同一 attempt 的 `recovery_required → cancelled` 只在仍拥有该 revision 时更正父 Task。Task 与 ownership marker 在 Task 写锁内、同一数据库事务提交，提交后再发布事件。原 receipt 由 `DelegationExecution.wait` 的 `Stream.runHead`（`packages/core/src/delegation/execution.ts:364`）保留首次结算，原通知由 `SessionNotification.inspect`（`packages/core/src/session/notification.ts:17`、`:43`）保留；较新人工编辑受保护。决定函数：`DelegationExecution.writeback`（`packages/core/src/delegation/execution.ts:273`、`:296`）、`SessionTask.updateTask`（`packages/core/src/session/task.ts:988`）。没有 marker 的旧数据仍有下节残留。

8. **Delegation 归档来源恢复，映射 V2-C-DELEGATION-LIFE。** fold 保存归档前 completed/cancelled 来源；unarchive 恢复原终态，completed 来源仍需通过完成屏障，cancelled 来源不会被改写成 completed。使用 canonical `delegation.unarchived` 事件并注册既有 projector。决定函数：`DelegationService.unarchive`（`packages/core/src/delegation/service.ts:913`）、`foldDelegation`（`packages/core/src/delegation/fold.ts:1011`、`:1033`、`:1048`）；该行为不关闭 draft purge、未知副作用 resume 等其他生命周期债务。

9. **共享脱敏修复。** CredentialScanner 对 private-key 整个匹配段替换为 `[REDACTED]`，覆盖 JSON 转义换行和单行形式；没有增加 Workflow 专用 scanner。决定函数：`stripText`（`packages/core/src/credential-scanner.ts:57`、`:61`）。分支摘要按 code point 限额，步骤输出及交接正文复用 scanner 和既有有界文本规则。

10. **精确准入与 promotion 竞争。** `SessionInbox.admit` 在入箱投影拒绝后复用同一个 `reconcile`，同时查 pending row 和已投递的 user/synthetic message。保留同 Session/type 首次准入、跨 Session/type 冲突及 control 特例；Workflow/Delegation 复用共同 owner。决定函数：`packages/core/src/session/inbox.ts:155`、`:168`、`:199`。专属 5 个竞态/控制测试与 Session 归属、Workflow 执行联合验证 48 pass / 0 fail。

新增及修改的 Core、Schema、Server 测试源码对应上述实现。测试源码、生成客户端类型和只读复核均不能代替实际运行结果。

## 本轮残留：负责人、解锁条件与登记位置

- **旧 Task ownership marker。** 负责人：主智能体 `/root`，实现 owner 为 SessionTask / DelegationExecution；历史追认语义由项目 Owner 裁决。已登记 `V2-C-TASK-LEGACY`。没有 marker 的历史首次结算不能仅凭当前 Task 状态或 revision 自动追认所有权。解锁条件：明确旧数据的持久归属证据或人工修复流程，再用真实旧数据库记录验证 recovery→close、较新用户编辑保护和原 receipt/通知冻结。当前安全拒绝不计为历史数据更正完成。

- **事件保留合同。** 负责人：主智能体 `/root`，实现 owner 为 Bus / WorkflowExecution；配置支持范围由项目 Owner 裁决。已登记 `V2-C-WORKFLOW-EVENTS`。当前 `retainsEvents === false` 时 run、retryStep、resume 返回 `workflow_requires_retained_events`，启动核对和 handoff 跳过；取消和历史读仍可使用。解锁条件：明确 Workflow 是否始终要求 retained events，以及日志删除、压缩和保留期限的合同；若要支持关闭保留，须先提供确切结果和通知生命周期的持久证据，再验证取消、删除、revert、重开及一次准入。不能用缺失日志推导“从未通知”。

- **启动规模性能。** 负责人：主智能体 `/root`，实现 owner 为 WorkflowRun / SessionRestart / SessionNotification。已登记 `V2-C-WORKFLOW-SCALE`，关联 `V2-C-RECOVERY`。`WorkflowRun.listForRecovery` 当前读取全部 run，含待交接的终态；通知判定每次扫描所在 Session 的完整 durable log。决定函数：`packages/core/src/workflow/workflow-run.ts:557`、`packages/core/src/session/notification.ts:18`。解锁条件：取得实际规模的 run、Session 和日志数据，测量冷启动耗时、峰值内存与恢复预算，再依据瓶颈在既有 owner 内补分页、批次或可核对水位，并证明不会漏通知、误重放或越过人工停止。

- **Workflow / Task 产品 UI。** 负责人：主智能体 `/root`，前端实施者后续由其分配。继续登记到 `V2-C-WORKFLOW`、`V2-C-TASK-PANEL`、`V2-D-COMPOSITION`。本轮未修改 App/Desktop 产品链。解锁条件：实际用户流程使用当前生成客户端和事件流，闭环 Custom 创建、run/step 状态、取消、retry lineage、Task 编辑冲突、重开和恢复诊断；与参考工作区的独立 UI 任务分别核算。

- **产品 E2E 与系统验收。** 负责人：主智能体 `/root`。继续登记到 `V2-VALIDATION`。解锁条件：全产品 E2E、Electron 冷启动、Sidecar/PTY、真实存量数据库副本升级及独立复核；保留命令、退出码、失败/skip 和同环境基准。进程内 HTTP、离线 TestLLM、SSE 和文件数据库重开只证明各自边界。

方案对冲：简单实现复用当前查询作完整冷启动扫描和完整日志判定；更健壮的规模方案在同一 owner 内增加可核对的分页/水位与日志保留闭包。当前选择前者，明确保留启动性能和保留策略技术债。Task 更正复用 KV 与 Task 原子边界，避免新增状态 owner，但不自动迁移无法证明归属的旧 marker。

以上残留已写入权威技术债账本或保留在其既有条目，均有负责人和解除条件。本文只给出范围和证据映射。

## 原始全迁移仍开放的范围

以下责任均由主智能体 `/root` 接续；条目中标明的业务、合同或远程目标裁决仍归项目 Owner。本轮运行接线不关闭这些独立范围。

- **Delegation 外部与生命周期：`V2-C-DELEGATION`、`V2-C-DELEGATION-LIFE`、`V2-C-FANOUT`、`V2-C-RECOVERY`。** 外部 CLI/transport、attended Permission 等待、真实 review/revision 生产者与产品消费者仍开放。还需跨目标失败的原子准入或补偿、多 unresolved 输入重试顺序、子先父后关闭、cleanup 故障恢复、draft purge 与确切 attempt 的 resume。解锁条件沿用各条真实消费者、持久幂等和故障回归；归档来源与新 Task marker 的本轮实现只收窄其对应子范围。

- **Task 产品和调度：`V2-C-TASK-PANEL`、`V2-C-TASK-SCHEDULE`、`V2-C-TASK-CONTRACT`。** Work Task 调度须复用 Session/Job/Task，完成 claim/CAS、取消与冷恢复；账本将该范围与现存 Assistant Schedule 分别核算。全量 reconcile、排序结构 revision、recurrence timezone/nextRun、HTTP workspaceID 和 pre-read→CAS 竞争合同仍需闭环。解锁条件是明确合同后接真实执行/产品消费者并验证结构竞争与跨时区行为。旧 Task marker 另见上节。

- **Custom 及冻结来源：`V2-D-COMPOSITION`、`V2-D-FREEZE`、`V2-D-REFERENCES`。** Custom 产品客户流程、producer 闭包与 Skill 资源、ambient MCP/Web 边界仍开放。Profile 与 Session 引用读取已形成历史切片，其他 Workflow/Command/Plugin 消费者、删除提示、watcher/read 一致性与规模性能尚未关闭。解锁条件是复用现有资产、Tool、Model、MCP owner，按真实生产消费者和 provenance/revision 规则完成用户流程与 profiling。

- **AI 与分享独立范围：`V2-D-AI` 及账本保留的链接分享范围。** judge 和 share-summary 需要真实 Task/Workflow 消费者、现有 Model/Provider/AI、有界回退及 defect/interrupt 验证。AI summary 与链接分享 API 不计入已关闭的跨 Session 分享工具切片。catalog、runtime 的能力沿 current owner 接入，不因旧文件缺失重建旧栈。

- **通用传输类型：`V2-C-TRANSPORT-TYPES`。** Workflow DTO 与本轮事件的 canonical optional 不构成全领域兼容核查。解锁条件是盘点实际受影响端点和消费者，复用 httpapi-codegen 的既有 JSON 边界补 optional/nullable/class 回归，保留公开类型名并使用官方生成。

- **剩余 Server 协议：`V2-SERVER-LEGACY`。** control/sync、work-artifact、旧 question、保留 PTY handler 和其他占位端点须逐个核对当前合同。解锁条件是复用 Location/Form/Credential/Session/Bus 或明确兼容/退役裁决；不把 failClosed 改为空成功，不把 Event replay owner 当作 clustered Session execution owner。

- **桌面与发布：`V2-R01-RELEASE`、`V2-RUNTIME-PLATFORM`，关联原计划 R3/R4。** App/session-ui/desktop 的完整产品回放、Sidecar/PTY 集成、实际发布产物、CI 退役路径和其他平台本地 Bun 入口仍需各自验收。解锁条件是实际消费者、packed/compiled 生命周期、同版本子进程和构建/发布路径一致的证据；远程推送、PR、合并、发布及部署另按用户授权执行。

- **Cutover 与整体门禁：`V2-VALIDATION`，关联原计划 R5。** 全产品 E2E、存量数据库副本升级、Desktop/PTY、整体类型/构建和独立复核仍开放。解锁条件沿用原计划的完整验收与可恢复切换；分包和定向通过不能代替整体切换证据。

历史已关闭或已交付子范围分别是跨 Session 分享工具（`V2-C-SHARE`）、Task HTTP（`V2-C-TASK-HTTP`）、冻结 Command 模板（`V2-D-COMMAND` 的模板子范围）、Custom runtime、Profile/Session 引用读取和 Workflow 只读 GET。它们只按各自历史检查点继承，不重复计成本轮交付，也不关闭上述产品和独立剩余项。

## 验证与提交核算

使用项目 Bun 1.4.2，测试与类型检查逐包串行。Core/Client/Server 的运行环境保留当前 UID、仅启用隔离环境 loopback，并清除 capability；不会访问宿主监听端口或真实服务。所有命令、cwd、退出码、源码和日志 SHA256 保留在 `evidence/v2-workflow-execution-2026-10-24/`。早期结果只证明各自源版本。

最终全包分别为 Core `core-full-final-1`：7395 pass / 365 skip / 0 fail，371 文件；Server `server-full-final-2`：139 pass / 1 skip / 0 fail，37 文件；Schema `schema-full-final-2`：367 pass / 0 fail，43 文件；Protocol `protocol-full-final-1`：10 pass / 0 fail，4 文件。Client `client-full-final-2`：224 pass / 0 fail，20 文件。保留原有 skip；Server 的 MaxListenersExceededWarning 未在本批修复。

关键定向验证：最终 owner event 两文件 16 pass / 0 fail，逐 revision 比较 live/log/GET；WorkflowExecution 23 pass / 0 fail，包含真实双 child 删除及删除与已知 sibling 结果交错；Inbox admission/Session ownership/Workflow 联合三文件 48 pass / 0 fail，证明 promotion 后 exact retry 不误报失败，冲突不写入。HTTP 与认证 SSE 联合两文件 15 pass / 0 fail，完成 invalidation 后 GET 状态/revision 一致。上述定向结果不代替产品 E2E。

Core `core-typecheck-final-4`、Server `server-typecheck-final-3`、Schema `schema-typecheck-final-3`、Protocol `protocol-typecheck-final-1`、Client `client-typecheck-final-1` 单包 typecheck 均 exit 0。最终 Core/Server/Client 全包与格式规则检查的 42 个 TS 源码 hash 与当前文件一致，所有写入结束后才运行最终完整包。

Protocol 官方 generate/check 与 Client 官方 generate 均 exit 0；再次生成 12 个文件 SHA256 无漂移，见 `generated-proof.json`。保留三个既有 Workflow DTO 名，并生成 canonical `WorkflowRunUpdated` 类型。没有手改生成物。

Prettier `format-source-final-1`、42 文件 oxlint `lint-scoped-final-2`、Effect ast-grep `effect-patterns-scoped-final-3`、git diff --check 均 exit 0。oxlint 为 0 warnings / 0 errors，但当前该范围配置仅 1 条规则；ast-grep 覆盖六类项目规则。GUI-only 的 `lint-changed-final-1` 筛选为 0 文件，不计为后端验证。

失败证据单独保留：早期 Task/Workflow 测试的 Layer 缺口和结果策略不一致、HTTP 404 顺序和测试 AI 导入、Schema Type/Encoded fixture、当前 Effect API/品牌类型及 LogItem 收窄、SSE Run 存在性收窄、codepoint filter 无 representation、AST 字符串 defect/导入样式。新增两个竞争用例首次未进入目标暂停点（80 pass / 2 fail），根因是实际 Session.remove 先结算中断 receipt；在真实结算边界增加就绪信号后目标路径通过，未增加超时。原失败日志不覆盖为绿色。全部命令、结果、源码版本差异与日志 hash 由 verification.json 记录。

参考目录工作区diff SHA256从初始`ce188c07a18c0a0cc352edb2ad886e3ab828ebf95b655e5aa417ae786c4196fb`变为观察时`a055a1b2a260b7f17eb520ed9a8d6e13ff68017bd8bf971b835b418eefd66d53`。决定关系的命令为`git diff --binary -- packages/app docs/technical-debt.md | sha256sum`，记录在`reference-workspace-observation.json`；变化来源未验证。主智能体和本轮子智能体的写入目标均为V2目录，未覆盖参考目录内容。

未运行根canonical check、产品E2E、Electron/PTY或真实存量数据库升级。本轮隔离数据库重开不证明产品cutover或数据库升级。所有子智能体只做实现/静态复核，没有并行跑测试；最终命令由主智能体串行执行。

本地代码提交后按以下命令生成提交列表，禁止手写：

```sh
git log --oneline 50c4da530b..HEAD
```

下方提交列表由代码提交后、报告提交前的实际 git log 输出生成；报告提交本身由最终 git log 核算。整体 V2 迁移目标继续开放。

代码提交后、报告提交前的实际输出：

```text
617141b099 feat(core): execute durable workflows
4342b0bf22 fix(core): reconcile promoted admission retries
dceae7d2cf fix(core): reconcile delegation task decisions
9fee6607b5 fix(core): redact complete private key blocks
```
