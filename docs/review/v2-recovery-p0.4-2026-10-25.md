## Config/Location boot 隔离与显式修复输入增量

真实两个 Coding root/Location 均先经 SessionExecution 到达 claim/hang；clean Scope 关闭后，一个 Location 的缺失 file reference 使该 root 的确切旧 input failed/released/budget0，健康 root 的确切旧 input完成。修复文件后从重建图读取 Config.latest，只有显式 fresh prompt再执行；旧 failed input保持不变，cold重复零请求。最终测试源12165b64c02c225759c6e79dbcd927bea17838fceeacb1dcda697cb4f2d78a87。

[最终输入](evidence/v2-recovery-p0.4-2026-10-25/p04-config-location-final-input.json)、[独立复审](evidence/v2-recovery-p0.4-2026-10-25/p04-config-location-review.md) findings=[]、[限定审批](evidence/v2-recovery-p0.4-2026-10-25/protocol-approval-config-location.json)分别保留。最终四文件126 pass/0 fail/1318 expect；Core typecheck、七文件1-rule lint、格式check exit0。前格式化单例1 pass/31 filtered/31 expect独立记账；三生产未变，旧AST仅复用生产输入。

本增量不代表完整配置优先级、enabled/disabled/reused server、借用Scope与MCP/OS资源终结、全Location生命周期、进程kill、并发或逐写入点crash。P0.4仍open，Owner及解除条件由唯一账本持有。

# V2 P0.4 领域恢复故障隔离检查点（本地子切片已获限定审批）

首次记录：2026-10-25；追加记录及审批：2026-10-26（Asia/Shanghai）。当前受影响回归为 **89 pass / 0 fail / 678 expect，3 文件**；本轮 Core 类型与五文件 lint 记录均 exit 0，八组 mode/event 独立复审 `findings=[]`。八组延后恢复证据已获 [主智能体限定审批](v2-recovery-p0.4-approval-2026-10-25.md:27)，[机器记录](evidence/v2-recovery-p0.4-2026-10-25/protocol-approval-mode-event-matrix.json) 锁定该轮五文件与日志；尚未提交。原 80/82 项运行和审批保留历史版本，不累计。新 Workflow 多领域测试切片尚未验证，不能沿用本轮类型绿灯。P0.4、AUDIT-V2-RECOVERY-ISOLATION 和 P0 整项仍开放。

实施目录为 `/home/keer/workspace/aigcfroge-v2`，分支 `v2-dev`，HEAD 为 `251c0fe38041a326e624db464d1ee0efd1522881`。比较基准使用计划冻结的上游 `4617210822bdbb31e5749751afbfb4584ccedac8`。已读原仓 `/home/keer/workspace/aigcfroge/CLAUDE.md`、目标 AGENTS、[现行计划 P0.4](../research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md:96) 和 [未交付账本](../technical-debt.md:64)。运行证据由主线串行采集；文档作者仅核对证据、链接与差异，更新本检查点、计划 P0.4 和对应债项，不进行源码修改或审批。其他 WIP 保留。

本切片已验证范围涉及五文件：

- [DelegationExecution](../../packages/core/src/delegation/execution.ts)、[SessionRestart](../../packages/core/src/session/execution/restart.ts)。
- [Session 恢复回归](../../packages/core/test/session-execution.test.ts)、[Delegation 执行回归](../../packages/core/test/delegation-execution.test.ts)、[Task 更正回归](../../packages/core/test/delegation-task-decision.test.ts)。

`git log --oneline 251c0fe38041a326e624db464d1ee0efd1522881..HEAD` 输出为空。没有本切片提交清单。

**根因与决定函数。** 旧 retained history 仍存在，但 [DelegationService.foldState:192](../../packages/core/src/delegation/service.ts:192) 在当前 events-off 时明确拒绝读取。原恢复边界把该错误转成 defect，阻断共享恢复流程；[SessionRestart.resumeSuspendedSessions:204](../../packages/core/src/session/execution/restart.ts:204) 等待 Delegation 扫描后才到达普通 claim 恢复。真实磁盘红测已触发 `Persistent delegations require retained Bus events`。

[RecoveryResult:63](../../packages/core/src/delegation/execution.ts:63) 使用 Schema 明确区分 `reconciled` 与 `deferred`；[PendingRecoveryResult:69](../../packages/core/src/delegation/execution.ts:69) 返回 `parents`、`deferredChildren` 和 `scanAvailable`。[recover:697](../../packages/core/src/delegation/execution.ts:697) 对 events-off、active child、禁用 Custom 返回 deferred；只有原 `settle` 完成才释放 owning child claim、完成通知并返回 reconciled。[Restart 的 Delegation 分支:265](../../packages/core/src/session/execution/restart.ts:265) 仅在 reconciled 后 ACK 旧 marker。

[recoverPending:740](../../packages/core/src/delegation/execution.ts:740) 先扫描 internal participant 投影绑定。events-off 时保留这些 child，不折叠历史；此时 `scanAvailable=true` 仅表示投影扫描可用。events-on 时，单 participant 的非中断失败转为 deferred，成功与延后结果在 [790 行](../../packages/core/src/delegation/execution.ts:790) 汇总。扫描失败由 [804 行](../../packages/core/src/delegation/execution.ts:804) 返回 `scanAvailable=false`。

child claim 的保留关系由 [SessionStore.releaseChildClaims:228](../../packages/core/src/session/store.ts:228) 决定，其 [239 行](../../packages/core/src/session/store.ts:239) 对传入集合使用 `NOT IN`。[Restart:239](../../packages/core/src/session/execution/restart.ts:239) 将 deferred child 和所有 pending Delegation marker child 放入排除集合；扫描不可用时跳过 child cleanup。[canResume:214](../../packages/core/src/session/execution/restart.ts:214) 限制后续 wake/resume，扫描失败只允许已知 root。非 shell child marker 延后，普通 root 继续原恢复预算路径；deferred claim、非零 budget 和旧 marker 保留。

中断由 [recover:721](../../packages/core/src/delegation/execution.ts:721)、[recoverPending:772](../../packages/core/src/delegation/execution.ts:772)、[scan:804](../../packages/core/src/delegation/execution.ts:804) 与 [Restart:274](../../packages/core/src/session/execution/restart.ts:274) 保留。含 typed failure 的 mixed interrupt 仍中止恢复；Fail→Die 的 reason 映射保留 Interrupt。两处 `Cause.fromReasons<never>` 修正错误通道推断，不改变运行行为。

恢复复用原 [settle:436](../../packages/core/src/delegation/execution.ts:436)，不可证明完成的输入继续标记 `recovery_required`，不自动重放未知模型或工具副作用。方案对冲：采用现有 Delegation/Restart owner 内的结果合同与隔离；通用多领域恢复协调及其并发、崩溃证明仍是开放技术债。默认事件配置、receipt、人工停止与 Session/Job/Task 归属继续沿用既有边界。

**夹具与覆盖边界。** [磁盘用例:358](../../packages/core/test/session-execution.test.ts:358) 分两阶段：events-on 下用实际 Delegation/Job 服务写入 `restart.db`，形成两个 child、非零恢复预算和一个 completed background marker；关闭 scoped 数据库后以 fresh layer、events-off 重开同一文件。两次恢复只 drain 普通 root；child claim/budget、Delegation 投影与事件、旧 Job marker 均保持。SessionRestart、SessionExecution 协调、Store 与 Job 使用生产实现；[runner 回调:482](../../packages/core/test/session-execution.test.ts:482) 是 observer stub，[Workflow 恢复:1992](../../packages/core/test/session-execution.test.ts:1992) 是返回空数组的 mock。本轮未执行真实 provider 请求、managed-server 启动或真实多领域共同恢复。

[扫描不可用用例:729](../../packages/core/test/session-execution.test.ts:729) 删除实际 participant 表，验证 root 恢复而 child claim/budget 保留。[中断用例:766](../../packages/core/test/session-execution.test.ts:766) 注入纯中断与 typed failure 混合中断，验证 root 未 drain、未消耗预算；注入点为 `DelegationService.list`。[Task 更正用例:260](../../packages/core/test/delegation-task-decision.test.ts:260) 使用真实 SQLite KV trigger，验证 participant 失败后的 Task/KV/通知回滚与解除故障后的单次恢复。

追加 [选择性故障用例:308](../../packages/core/test/delegation-task-decision.test.ts:308) 在同一扫描中建立两个独立 Delegation/parent；[真实 KV trigger:358](../../packages/core/test/delegation-task-decision.test.ts:358) 仅阻断一侧 Task 写回，另一侧 reconciliation 提交。断言覆盖故障侧原 claim/budget、健康侧 release/budget reset、Task revision、通知、KV marker 与提交后事件；重复扫描及解除故障后的写回保持幂等。健康侧 Task 仍为 `failed`，输入按 `recovery_required` 对账，不代表模型或工具任务执行成功。决定关系由 [writeback:290](../../packages/core/src/delegation/execution.ts:290)、[Task/KV 提交:317](../../packages/core/src/delegation/execution.ts:317) 与 [participant catch:772](../../packages/core/src/delegation/execution.ts:772)/[汇总:790](../../packages/core/src/delegation/execution.ts:790) 决定；该用例不调用 Restart，也没有两侧 participant 的 Job background marker。

当前 [八组 mode/event 用例:511](../../packages/core/test/session-execution.test.ts:511) 用四个 mode/Custom 参数与两个 persist 参数扩展原单例 active 测试。每组先写入真实磁盘数据库再关闭、重开；parent/child 同 mode，独立 root 始终 Coding。实际覆盖 **4 组 events-off、3 组 events-on active、1 组 events-on Custom-disabled**，全部 child 返回 deferred。六组由 [真实 SessionExecution fiber:681](../../packages/core/test/session-execution.test.ts:681) 与 Deferred readiness 建立 active child；两组禁用 Custom 在 [673 行](../../packages/core/test/session-execution.test.ts:673) 验证 `UnsupportedProductModeError`，不进入 child drain。direct recover、pending scan 和两轮 Restart 保留 child claim、budget 2、投影/事件及旧 completed marker，root 只恢复一次、预算执行中为 1、完成后归零；owner scope 关闭后再次检查 child 状态与 marker。runner 仍为 observer，Custom 仍为存储夹具，Workflow 仍为 empty mock。该八组全部验证延后分支，未隔离 events-on enabled idle 的逐配置 reconciliation/ACK。

**失败记录。** 以下保留原失败，不与后续绿灯合并统计：

- [retained-events-disabled-red](evidence/v2-recovery-p0.4-2026-10-25/retained-events-disabled-red.json)：2026-10-25 14:23:01 UTC，exit 1；**0 pass / 1 fail / 40 filtered out / 6 expect，1 文件**。[日志](evidence/v2-recovery-p0.4-2026-10-25/retained-events-disabled-red.log) 报 `Persistent delegations require retained Bus events`。采集器未记录当时 HEAD 或未改动生产文件 SHA，fixture 随后增加断言；精确红测生产 revision 未独立锁定。
- [core-recovery-typecheck](evidence/v2-recovery-p0.4-2026-10-25/core-recovery-typecheck.json)：exit 1；[日志](evidence/v2-recovery-p0.4-2026-10-25/core-recovery-typecheck.log) 有两处 TS2322，`Effect<..., unknown, never>` 不满足声明的 `Effect<..., never, never>`。

**历史绿色记录。** 以下 80 项运行对应追加测试前的快照，均独立列示，不累计重叠测试：

- [recovery-impacted-tests](evidence/v2-recovery-p0.4-2026-10-25/recovery-impacted-tests.json)：exit 0，80 pass / 0 fail / 436 expect，3 文件；早于 `<never>` 修正与格式化，仅作前一版本行为证据。
- [core-recovery-typecheck-fixed](evidence/v2-recovery-p0.4-2026-10-25/core-recovery-typecheck-fixed.json)：`tsgo -b tsconfig.json tsconfig.tests.json`，exit 0；对应 `<never>` 修正后的格式前源码。
- [recovery-format](evidence/v2-recovery-p0.4-2026-10-25/recovery-format.json)：exit 0；Prettier 改写三个文件，两个测试文件 unchanged。此运行记录的源码 SHA 在格式化前采集。
- [recovery-final-tests](evidence/v2-recovery-p0.4-2026-10-25/recovery-final-tests.json)：2026-10-25 15:13:21 UTC，cwd `packages/core`；固定 `script/bun run test --timeout 30000`，指定上述三个测试文件，exit 0；[日志](evidence/v2-recovery-p0.4-2026-10-25/recovery-final-tests.log) 为 **80 pass / 0 fail / 436 expect，3 文件**。这是受影响回归集，未计为 Core 全包或全仓通过。
- [core-recovery-final-typecheck](evidence/v2-recovery-p0.4-2026-10-25/core-recovery-final-typecheck.json)：2026-10-25 15:28:25 UTC，cwd `packages/core`；`script/bun run typecheck` → `tsgo -b tsconfig.json tsconfig.tests.json`，exit 0，覆盖格式后的源码与测试项目引用。
- [core-recovery-final-lint](evidence/v2-recovery-p0.4-2026-10-25/core-recovery-final-lint.json)：2026-10-25 15:28:51 UTC，cwd 仓根；显式五文件 oxlint，exit 0；[日志](evidence/v2-recovery-p0.4-2026-10-25/core-recovery-final-lint.log) 为 **0 warnings / 0 errors，5 files / 1 rule**，未计为根目录 `bun run check` 或全仓 lint。
- [core-recovery-final-effect-patterns](evidence/v2-recovery-p0.4-2026-10-25/core-recovery-final-effect-patterns.json)：2026-10-25 15:34:27 UTC，cwd 仓根；`ast-grep scan -c script/ast-grep/sgconfig.yml` 显式检查两个生产文件，exit 0。[日志](evidence/v2-recovery-p0.4-2026-10-25/core-recovery-final-effect-patterns.log) 只有 postinstall 未运行、fallback 到运行时二进制解析的提示，无源码诊断；未计为全仓 Effect/lint 门禁。

上述日志的 SHA 在此前检查点已核对。四份 final 记录对应原 80 项快照；追加修改了两个测试文件，其五文件输入不能作为当前 89 项验证证据。两个生产文件 SHA 未变，原两生产文件 Effect 检查保留自身记录，不计为新的 matrix 全仓门禁。采集器只记录 dirty/untracked 文件哈希，不是完整源码和运行环境快照。

[初版独立复审](evidence/v2-recovery-p0.4-2026-10-25/p04-independent-review.md) 与其 [输入 JSON](evidence/v2-recovery-p0.4-2026-10-25/p04-independent-review.json) 对应格式前快照。[原 80 项最终独立复审](evidence/v2-recovery-p0.4-2026-10-25/p04-final-independent-review.md) 为 `findings=[]`，其 [配套 JSON](evidence/v2-recovery-p0.4-2026-10-25/p04-final-independent-review.json)、[原限定审批正文](v2-recovery-p0.4-approval-2026-10-25.md:3) 与 [原审批机器记录](evidence/v2-recovery-p0.4-2026-10-25/protocol-approval.json) 保留各自快照，不能推作新增测试输入的审批证据。

**2026-10-26 的 82 项历史快照（Asia/Shanghai）。** 该轮主线串行执行的三份命令记录为：

- [recovery-matrix-tests](evidence/v2-recovery-p0.4-2026-10-25/recovery-matrix-tests.json)：2026-10-25 15:55:08 UTC 启动，cwd `packages/core`；`script/bun run test --timeout 30000` 指定三个相关文件，exit 0；[日志](evidence/v2-recovery-p0.4-2026-10-25/recovery-matrix-tests.log) 为 **82 pass / 0 fail / 483 expect，3 文件**，未计为 Core 全包或全仓通过。
- [recovery-matrix-typecheck](evidence/v2-recovery-p0.4-2026-10-25/recovery-matrix-typecheck.json)：2026-10-25 15:55:45 UTC 启动，cwd `packages/core`；`tsgo -b tsconfig.json tsconfig.tests.json`，exit 0。
- [recovery-matrix-lint](evidence/v2-recovery-p0.4-2026-10-25/recovery-matrix-lint.json)：2026-10-25 15:57:02 UTC 启动，cwd 仓根；显式五文件 oxlint `--deny-warnings`，exit 0；[日志](evidence/v2-recovery-p0.4-2026-10-25/recovery-matrix-lint.log) 为 **0 warnings / 0 errors，5 files / 1 rule**，未计为全仓 lint/check。

[82 项独立复审](evidence/v2-recovery-p0.4-2026-10-25/p04-matrix-independent-review.md) 为 `findings=[]`；其 [配套 JSON](evidence/v2-recovery-p0.4-2026-10-25/p04-matrix-independent-review.json) 对应该轮五文件及三份 matrix 命令输入。复审记录时间为 2026-10-26 00:00:11（Asia/Shanghai）；主线于 00:02:25 作 [82 项追加限定审批](v2-recovery-p0.4-approval-2026-10-25.md:19)，[机器记录](evidence/v2-recovery-p0.4-2026-10-25/protocol-approval-matrix.json) 保留该轮输入。本轮 mode/event 扩展再次改变 Session 测试文件，82 项输入只保留为历史，不累计或替代 89 项证据。

**2026-10-26 八组延后恢复记录（Asia/Shanghai）。** 当前三份命令记录为：

- [recovery-mode-event-matrix-tests](evidence/v2-recovery-p0.4-2026-10-25/recovery-mode-event-matrix-tests.json)：2026-10-25 16:22:26 UTC 启动，cwd `packages/core`；指定三个相关测试文件，exit 0；[日志](evidence/v2-recovery-p0.4-2026-10-25/recovery-mode-event-matrix-tests.log) 为 **89 pass / 0 fail / 678 expect，3 文件**，未计为 Core 全包或全仓通过。
- [recovery-mode-event-matrix-typecheck](evidence/v2-recovery-p0.4-2026-10-25/recovery-mode-event-matrix-typecheck.json)：2026-10-25 16:24:57 UTC 启动，cwd `packages/core`；`tsgo -b tsconfig.json tsconfig.tests.json`，exit 0，结论绑定该命令的输入快照。
- [recovery-mode-event-matrix-lint](evidence/v2-recovery-p0.4-2026-10-25/recovery-mode-event-matrix-lint.json)：2026-10-25 16:25:54 UTC 启动，cwd 仓根；显式五文件 oxlint `--deny-warnings`，exit 0；[日志](evidence/v2-recovery-p0.4-2026-10-25/recovery-mode-event-matrix-lint.log) 为 **0 warnings / 0 errors，5 files / 1 rule**，未计为全仓 lint/check。

[八组独立复审](evidence/v2-recovery-p0.4-2026-10-25/p04-mode-event-matrix-review.md) 为 `findings=[]`；其 [配套 JSON](evidence/v2-recovery-p0.4-2026-10-25/p04-mode-event-matrix-review.json) 记录本子切片五文件 SHA 与三份执行输入一致、日志 SHA 匹配。该轮只改变 Session 测试文件，两个生产文件未变。复审记录时间为 2026-10-26 00:31:21（Asia/Shanghai）；主线于 00:35:27 作 [八组限定审批](v2-recovery-p0.4-approval-2026-10-25.md:27)，[机器记录](evidence/v2-recovery-p0.4-2026-10-25/protocol-approval-mode-event-matrix.json) 明确保留 idle reconciliation/ACK 与多领域等范围。各轮独立复审只核对源码与既有证据，没有重跑验证。

**真实多领域新增范围已限定审批。** [workflow-execution.test.ts](../../packages/core/test/workflow-execution.test.ts:557) 复用真实 SQLite/Workflow/Delegation/Restart/SessionRunner；snapshot conflict 被单 run 隔离后，Delegation cold writeback、child claim release、旧 Job ACK 与 Coding root 继续。实际 user interrupt 后同图与 fresh cold 各一轮 sweep 未复活。child 为 failed/recovery_required，parent staged revert 保持 notice pending，模型边界由 TestLLM/resolver 替代。该测试不含 empty Workflow mock；原三个测试文件的 observer 范围仍保留自身边界。

主线最终四文件回归 [recovery-multidomain-final-fixed-tests](evidence/v2-recovery-p0.4-2026-10-25/recovery-multidomain-final-fixed-tests.json) 为 **113 pass / 0 fail / 858 expect**；[最终类型](evidence/v2-recovery-p0.4-2026-10-25/recovery-multidomain-typecheck-fixed.json) 与 [当前六文件 lint](evidence/v2-recovery-p0.4-2026-10-25/recovery-multidomain-final-fixed-lint.json) 均 exit 0，lint 为0 warnings/errors、6 files / 1 rule。六文件与日志 SHA 均匹配，[独立复审](evidence/v2-recovery-p0.4-2026-10-25/p04-real-multidomain-review.md) findings=[]，主线于2026-10-25 17:18:43 UTC完成 [追加限定审批](v2-recovery-p0.4-approval-2026-10-25.md)，[机器记录](evidence/v2-recovery-p0.4-2026-10-25/protocol-approval-real-multidomain.json) 锁定版本。原89/旧113与旧named case不累计；首次筛选未命中新case、Service输出根错误、4 TS2345+1 TS2769及旧lint版本分别保存在该复审中，不冒称产品红测或本轮通过。

**十四组配置追加定向证据（尚未审批）。** 主线复用既有matrix，增加Coding/Custom enabled idle与对应events-off三对组合。真实SessionInbox.admit保留delivery provenance；events-on idle冷对账为recovery_required、释放child claim/预算，Restart随后ACK旧marker；events-off idle保留input/claim/marker。原八组deferred场景保留，runner仍为observer、Workflow为空mock，不能替代真实多领域或provider。命令 [recovery-mode-event-idle-matrix-ack-boundary-fixed](evidence/v2-recovery-p0.4-2026-10-25/recovery-mode-event-idle-matrix-ack-boundary-fixed.json) exit0、**14 pass / 0 fail / 413 expect，1文件**，44 filtered。固定源码SHA `465035ccf261bbe1ad30837d16c1b96292cdf5c108373d25650700881664dd90`，后续Prettier unchanged；当前14定向不与89/113累计，待合并Cause回归后重跑相关四文件/type/lint和独立复审。

两份先行失败保留：[first](evidence/v2-recovery-p0.4-2026-10-25/recovery-mode-event-idle-matrix-first.json) 为8 pass / 6 fail，错误引用未公开的Reference构造；[fixture-fixed](evidence/v2-recovery-p0.4-2026-10-25/recovery-mode-event-idle-matrix-fixture-fixed.json) 为11 pass / 3 fail，错误要求direct recover即ACK冷marker。它们分别是fixture API与断言时点错误，不是产品红测；真实关系由 [Job.cancel](../../packages/core/src/job.ts:467) 的进程内Job查找和 [Restart](../../packages/core/src/session/execution/restart.ts:265) 的reconciled后completeBackground决定，修正测试、未修改生产。

**正在继续的范围。** [接续方案](evidence/v2-recovery-p0.4-2026-10-25/p04-multidomain-next-slice.md) 的forwarded pure/mixed Cause逐run与scan回归已派发给子智能体，先改测试验证红再修生产边界。它们是Cause传递语义测试，不能替代实际人工停止或真实数据库故障证据。后续测试改动不在本次SHA06b010版本审批内。

**Cause 两处根因已验证，七文件最新范围待独立复审。** 四个用例复用真实 SQLite、WorkflowRun/WorkflowExecution/Restart，只在下层 owner 转发 Cause。逐run的 get 合法传递 typed Fail+Interrupt；scan的never合同只注入Interrupt或Die+Interrupt，没有typed cast。两个Interrupt ID为101、102；mixed共3个reason，原错误对象在Restart的Fail→Die映射后保持。

- [初始红测](evidence/v2-recovery-p0.4-2026-10-25/recovery-forwarded-causes-red.json)：2 pass / 2 fail / 80 expect，24 filtered，4个用例。两个get场景的direct退出被当作成功；两个scan对照通过。[显式七文件红测输入](evidence/v2-recovery-p0.4-2026-10-25/forwarded-causes-red-input.json) 补记未改动的Workflow生产文件（原dirty-only采集器不会保存该文件），主线核验前后SHA未变。这不是完整仓库快照。
- [仅修Workflow](evidence/v2-recovery-p0.4-2026-10-25/recovery-forwarded-causes-workflow-guard.json)：3 pass / 1 fail / 103 expect；剩余get mixed在Restart退出断言失败。与初始两个get的direct失败属于不同边界，均保留原日志。
- [两处修复](evidence/v2-recovery-p0.4-2026-10-25/recovery-forwarded-causes-both-guards.json)：4 pass / 0 fail / 112 expect。完整Interrupt集合、reason数量、原错误对象和下游claim/预算/marker/请求不变均通过；这是一版格式化前的定向证据。

关系由 [Workflow 单run guard](../../packages/core/src/workflow/execution.ts:1000) 和 [Restart 前置 Cause guard](../../packages/core/src/session/execution/restart.ts:207) 决定。后者复用既有Cause reason映射，把含Interrupt的Fail改为Die后继续失败，保留原typed catch的非中断行为；未新增runner、存储或恢复开关。当前旧marker ACK仍由 [Restart reconciled 分支](../../packages/core/src/session/execution/restart.ts:283) 决定。

格式化后的四文件相关回归 [recovery-forwarded-idle-final-tests](evidence/v2-recovery-p0.4-2026-10-25/recovery-forwarded-idle-final-tests.json) 为 **123 pass / 0 fail / 1171 expect**；[Core类型](evidence/v2-recovery-p0.4-2026-10-25/recovery-forwarded-idle-final-typecheck.json)、[七文件lint](evidence/v2-recovery-p0.4-2026-10-25/recovery-forwarded-idle-final-lint.json) 均exit0，lint为0 warnings/errors、7 files / 1 rule；[三生产文件Effect检查](evidence/v2-recovery-p0.4-2026-10-25/recovery-forwarded-idle-final-effect-patterns.json) exit0，仅有工具postinstall fallback提示。[最终显式输入](evidence/v2-recovery-p0.4-2026-10-25/forwarded-idle-final-input.json) 锁定七文件并核验四份日志SHA。最新Workflow/Restart生产SHA分别为82f0fe…/96f0d8…；Session/Workflow测试SHA为465035…/e5b444…。当前范围待新的独立复审与限定审批，不由旧113审批覆盖；不累加89/113/14/4与本轮123。

十四组现在精确覆盖7 events-off、3 events-on active、1 events-on Custom-disabled与3 events-on enabled idle。11组child deferred，3组idle为recovery_required/release/Restart ACK；输入仍pending，未证明成功child执行或完整receipt/通知生命周期。真实多领域/user stop的旧新增用例也在本轮四文件中重跑，但完整provider/managed-server、反向隔离、并发与逐写入点crash范围继续开放。

**未交付范围。** AUDIT-V2-RECOVERY-ISOLATION 保持开放，Owner 为 Core/Server 负责人、主智能体。解除剩余范围需补齐 events-on enabled idle 的逐配置 reconciliation/ACK、停机后下一次 cold sweep、running marker、同一 Delegation/shared lock 内多 participant 混合结果、多故障与顺序组合、成功执行与完整 delivery/result 组合、跨 participant Job ACK、真实 Workflow 与 Delegation 共同恢复、完整 Location/Custom 运行图、非中断 list failure、direct/background mixed interrupt、外部并发 mutation、逐持久写入点崩溃、claim release→ACK 故障及真实 managed-server/provider 启动链；当前没有完整 concurrency、crash 或 exactly-once 证明。

V2-C-RECOVERY 的多个 unresolved 输入顺序、子树 cleanup 与中途故障，V2-C-WORKFLOW-EVENTS 的无日志恢复、删除/压缩/保留期和 receipt/通知生命周期继续按既有账本开放。仅投影无事件与全部 Coding/Custom 组合尚未形成完整独立验收矩阵。现行计划与账本同步本地部分实现、追加验证及限定审批；主线继续 P0.3 和剩余 matrix，提交与剩余验收仍开放，不关闭 P0.4、相关整项或 P0，不表示最终切换完成。


**最新反向124范围已限定审批。** 前文“待复审”均保留其历史时点。[最新四文件回归](evidence/v2-recovery-p0.4-2026-10-25/recovery-reverse-workflow-final-tests.json) 为124 pass /0 fail /1229 expect；[类型](evidence/v2-recovery-p0.4-2026-10-25/recovery-reverse-workflow-final-typecheck.json) 与 [七文件lint](evidence/v2-recovery-p0.4-2026-10-25/recovery-reverse-workflow-final-lint.json) exit0。独立复审findings=[]，主线于2026-10-25T18:51:46.939735+00:00完成 [七文件输入增量审批](evidence/v2-recovery-p0.4-2026-10-25/protocol-approval-reverse-workflow.json)。Workflow测试SHA f9e7a8…，三生产SHA与123不变；只复用旧三生产Effect检查。新case与eq/sql、KV import、KV.node四项逆还原逐字节回到e5b444…稳定源。

实际时序为健康Workflow先调度并在gate等待，同Sweep保留Delegation故障child后释放gate；健康step/root两个精确输入完成。选择性marker失败回滚Task，重复/cold保持fault claim/预算2/input/旧marker；解除trigger后recovery_required写回与release/ACK一次发生，fault input和parent notice仍pending。使用真实SQLite与现有服务，模型边界仍是TestLLM/resolver。单case格式前1 pass/58 expect不与124累计。反向组合已交付；成功Delegation/receipt/通知消费、完整配置/Location/lifecycle、managed-server/provider、并发/进程kill/逐写入点crash/release→ACK继续开放。
# 成功 internal Task 交付与原通知消费增量

2026-10-25 UTC，主线在真实 SQLite/SessionRunner/Delegation/Task/Restart owner 上补齐成功 child 写回后通知的磁盘重开消费。最终输入：[p04-success-delivery-final-input.json](evidence/v2-recovery-p0.4-2026-10-25/p04-success-delivery-final-input.json)；独立复审：[p04-success-delivery-review.md](evidence/v2-recovery-p0.4-2026-10-25/p04-success-delivery-review.md)，findings=[]；主线限定批准：[protocol-approval-success-delivery.json](evidence/v2-recovery-p0.4-2026-10-25/protocol-approval-success-delivery.json)。P0.4 整项保持 open。

新增用例位于 `packages/core/test/delegation-execution.test.ts:687`。首图实际 parent/child 请求数 2；Task completed、receipt/result 与原 notice ID 保存。第二图先保持 pending notice，无模型请求；公开 revert.clear 自带 wake，再调用 Restart，父通知一次消费后该图请求数 1。再次恢复与第三 cold 图没有新请求，投影中只保留原 notice ID。该边界为同进程 clean Scope close 和 TestLLM/resolver，不能单独归因 Restart，也不证明进程 kill、真实 provider 或未知副作用可重试。

准备输入 SHA 4a45d19… 的单例 1 pass/30 filtered/58 expect 和四文件 125 pass/1287 expect 分别保留。格式初检 exit 1 后按 Prettier 修复；最终测试源为 047fa46642c4eba9e5a74c2a98c6f984cd489aadc5a59b23cc810f0cf9077bd7。绑定该源的最终四文件为 125 pass/0 fail/1287 expect，Core typecheck exit 0，七文件 oxlint exit 0（实际 1 rule），格式 check exit 0。不同轮不相加。三生产源未变，旧 Effect AST 仅复用它们，不当作新测试 AST 覆盖。

仍需完整 config/Location/lifecycle、running marker、多 participant 与故障顺序、managed-server/provider、并发 mutation、进程 kill/逐写入 crash 和 release→ACK。Config/Location 两 root 增量已由原 prepared 精确应用、验证并取得下述限定审批。
