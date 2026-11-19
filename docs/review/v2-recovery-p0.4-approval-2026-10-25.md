# P0.4 Claude / 固定上游 V2 协议限定审批

日期：2026-10-25。结论：**批准 Delegation 故障与普通 claimed root 的本地恢复隔离子切片。P0.4 整项继续开放。** 主智能体依用户本会话委托完成协议审批。

审批输入是 [恢复检查点](v2-recovery-p0.4-2026-10-25.md) 的五文件。实施分支为 `v2-dev`，HEAD 为 `251c0fe38041a326e624db464d1ee0efd1522881`；固定上游为 `4617210822bdbb31e5749751afbfb4584ccedac8`。[机器记录](evidence/v2-recovery-p0.4-2026-10-25/protocol-approval.json) 保存五文件 SHA、有效日志 SHA、独立复审身份及不可变上游协议 blob。

Claude 的复用顺序、真实验证、错误边界和未交付记账已落实。固定 V2 `specs/v2/session.md` 的 Recovery Boundaries 与 `SessionRestart.prepareResume` 明确：claimed top-level Session 按持久投影与有限预算恢复，不能保证外部副作用 exactly-once。当前修改保持原恢复预算、人工停止与进程归属。

- [recoverPending](../../packages/core/src/delegation/execution.ts:740) 复用现有 participant 投影保护绑定 child；events-off 延后 reconciliation，扫描不可用时返回明确状态。[canResume](../../packages/core/src/session/execution/restart.ts:214) 在扫描不可用时只允许已知 root 恢复。
- child 排除集合的决定关系由 [SessionStore.releaseChildClaims](../../packages/core/src/session/store.ts:228) 的 `NOT IN` 决定；[Restart](../../packages/core/src/session/execution/restart.ts:239) 保留 deferred child 和 pending Delegation marker child。[marker 分支](../../packages/core/src/session/execution/restart.ts:265) 仅在 reconciled 后 ACK。
- [recover](../../packages/core/src/delegation/execution.ts:697) 复用原 settle，不自动重放未知模型或工具副作用。含 typed failure 的 interruption 在 Cause reason 映射中保留。日志只包含固定 tag 与域 ID；没有新增 runner、Session store、权限映射或恢复开关。

主线核验五文件与四份最终输入记录一致：相关行为回归 **80 pass / 0 fail / 436 expect，3 文件**；Core typecheck exit 0；五文件 oxlint exit 0（当前仅 1 rule）；两生产文件 Effect ast-grep exit 0（只有工具 postinstall fallback 提示）。[最终独立复审](evidence/v2-recovery-p0.4-2026-10-25/p04-final-independent-review.md) findings=[]，源码 SHA 一致。各运行独立列示，没有累加重叠测试；历史红测和格式前记录保留在检查点。

AUDIT-V2-RECOVERY-ISOLATION 的完整配置矩阵、多领域与多 participant 混合结果、active child、并发 mutation、逐写入点崩溃、release→ACK 故障及真实 managed-server/provider 启动仍需验证。当前磁盘夹具使用 observer runner 和 empty Workflow mock，不能关闭这些范围。P0.3 的路由预算与原生 Desktop 验收也仍开放，因此本审批不批准 P0 完成、进入依赖该基线的产品阶段、提交、推送、合并或发布。

`git log --oneline 251c0fe38041a326e624db464d1ee0efd1522881..HEAD` 输出为空；本子切片尚未提交。主线继续 P0.3 根因修复和 P0.4 剩余验收。

## 2026-10-26 追加回归审批（Asia/Shanghai）

批准两项追加恢复合同回归。生产两文件与上次审批相同，两个测试文件扩展后，主线重新执行三文件相关回归，结果为 **82 pass / 0 fail / 483 expect**；最终 Core typecheck 和五文件 oxlint `--deny-warnings` 均 exit 0。[追加独立复审](evidence/v2-recovery-p0.4-2026-10-25/p04-matrix-independent-review.md) findings=[]。[追加审批记录](evidence/v2-recovery-p0.4-2026-10-25/protocol-approval-matrix.json) 保存当前五文件和三份命令记录的 SHA；原 80 项运行和审批保持各自版本，不累计两轮 tallies。

选择性 SQLite KV trigger 验证同一扫描中的一个 participant 写回失败时，另一 Delegation 的 reconciliation 可以提交；故障方 claim/budget 保留，解除故障后恢复幂等。这里的健康侧是恢复写回完成，其 Task 结果仍为 `failed/recovery_required`，不代表模型任务成功。另一回归以真实 SessionExecution fiber 建立 events-on Coding active child，验证 direct recover、pending scan 和两轮 Restart 保留其 claim、预算、历史和旧 completed Job marker，同时普通 root 恢复。

这两项分别覆盖两个独立 Delegation 的同轮隔离和一个 active 配置组合。完整配置矩阵、同一 Delegation 内多 participant、多领域同时恢复、真实启动/provider、并发 mutation 和逐写入点崩溃仍开放；P0.4 和 P0 的退出条件未因此完成。

## 持久开关与模式组合的追加审批

批准八组延后恢复组合的本地行为证据。相关三文件重新运行结果为 **89 pass / 0 fail / 678 expect**，最终类型和五文件 oxlint `--deny-warnings` 均 exit 0；[独立复审](evidence/v2-recovery-p0.4-2026-10-25/p04-mode-event-matrix-review.md) findings=[]。[机器记录](evidence/v2-recovery-p0.4-2026-10-25/protocol-approval-mode-event-matrix.json) 锁定当前五文件、日志和复审身份；生产两文件未变。旧 80/82 轮保持其历史输入，不累计数字。

矩阵实际覆盖四组 events-off、三组 events-on active 和一组 events-on Custom-disabled。每组在同一磁盘数据库写入后关闭、重开，parent/child mode 匹配真实 binding guard，独立 root 始终 Coding；保留 child claim、预算、旧 marker、投影和事件，root 只恢复一次。全部 child 走 deferred；events-on enabled idle 的 reconciliation/ACK 尚未被本矩阵隔离。模型 drain observer 与 empty Workflow mock 的边界保留，真实多领域场景由下一子切片继续验证。本追加审批不关闭 P0.4、P0 或最终迁移。

## 2026-10-25 17:18:43 UTC 真实多领域与人工停止追加审批

批准一个真实多领域恢复与 user interruption 子范围。[机器审批记录](evidence/v2-recovery-p0.4-2026-10-25/protocol-approval-real-multidomain.json) 锁定六文件、固定上游 Session 协议 blob、三份有效命令记录及 [独立复审](evidence/v2-recovery-p0.4-2026-10-25/p04-real-multidomain-review.md) 身份。四文件相关回归为 **113 pass / 0 fail / 858 expect**，Core typecheck exit 0，当前六文件 lint exit 0（0 warnings/errors，1 rule），主线核验六文件输入与日志 SHA 全部匹配，findings=[]。这三份记录绑定 workflow 测试 SHA `06b0107441f2c150b5a9b94160365ac39e828e483e4b1057e8d021c30161c262`；旧筛选、Service 输出根失败、五处类型错误及旧113轮保留各自历史，不累计或替代本轮结果。

真实 SQLite 关闭重开后，Workflow 的 snapshot conflict 经 [reconcilePending 单 run 边界](../../packages/core/src/workflow/execution.ts:999) 延后；真实 Delegation cold reconciliation、claim release、旧 Job ACK 与普通 Coding root 的生产 SessionRunner 继续。root 在 TestLLM gate 后经实际 user interrupt 停止，同图一轮与再次 cold reopen 一轮 sweep 均未复活。静态三根复用现有 LayerNode 图输出，不新增服务或 runner。两个生产文件与八组审批版本相同。

此处 child 仍为 failed/recovery_required；parent staged revert 故意保留 Task notice pending，不证明成功 child delivery、parent 消化通知或真实 provider。forwarded pure/mixed Cause、反向领域隔离、完整配置/receipt/通知、managed-server、并发 mutation、逐写入点 crash 和 release→ACK 仍由 AUDIT-V2-RECOVERY-ISOLATION 继续跟踪。主线和子智能体继续这些范围；本审批不关闭 P0.4、P0 或 P0.3，不授权提交或发布。机器记录中的命令生成 commit 列表为空，本地 WIP 保留。

## 2026-10-25 18:09:54 UTC Cause 与 idle 七文件追加审批

批准三生产文件、四测试文件的Cause传播与idle对账子范围。[机器审批记录](evidence/v2-recovery-p0.4-2026-10-25/protocol-approval-forwarded-idle.json) 锁定当前七文件、固定上游协议blob、四份最终命令证据和 [独立复审](evidence/v2-recovery-p0.4-2026-10-25/p04-forwarded-idle-final-review.md)。结果为 **123 pass / 0 fail / 1171 expect，4 files**；Core类型、七文件lint（0 warnings/errors、1 rule）、三生产文件Effect检查均exit0，后者只有工具fallback提示。复审findings=[]，主线核验七文件输入与全部日志SHA一致。未计作Core全包或全仓验证，采集器不是完整不可变WIP/依赖快照。

实际产品红→绿为2 pass/2 fail→3 pass/1 fail→4 pass/0 fail，分别隔离出 [Workflow单run](../../packages/core/src/workflow/execution.ts:1000) 与 [Restart](../../packages/core/src/session/execution/restart.ts:207) 的中断吞掉边界。前者原样传播Cause；后者在原typed catch前将含中断的Fail映射为Die，保持never通道、两个Interrupt ID和原错误对象，原非中断行为保留。scan遵守never合同，使用Die+Interrupt对照，不靠cast制造typed scan failure。

14组精确为7 events-off、3 events-on active、1 events-on Custom-disabled、3 events-on enabled idle；3组idle对账为recovery_required/release/Restart ACK，11组deferred。真实admitted input仍pending，不自动重放未知child。旧marker由 [reconciled后ACK](../../packages/core/src/session/execution/restart.ts:283) 删除，直接recover没有cold process-local Job时先保留marker。前两轮idle失败是夹具API及ACK时点错误，分别保留，不称产品红测；旧113及更早审批不累计或覆盖新版本。

反向真实Workflow健康/Delegation故障组合由下一子切片继续；成功child delivery、完整receipt/parent notice、全部配置/Location、managed-server/provider、并发和逐写入crash仍开放。P0.4/P0/P0.3整项、提交与发布未批准。`git log`生成的本批commit列表仍为空，全部WIP保留。此审批绑定Workflow测试e5b444…快照，后续新增反向测试须单独验证。

## 2026-10-25T18:51:46.939735+00:00 UTC 反向真实领域增量审批

批准一个反向恢复用例及现有KV输出根的增量。[机器记录](evidence/v2-recovery-p0.4-2026-10-25/protocol-approval-reverse-workflow.json) 保存当前七文件、三份有效日志与 [独立复审](evidence/v2-recovery-p0.4-2026-10-25/p04-reverse-workflow-review.md) 身份，复审JSON SHA `af4ccdb6e0cdadcf7bdc22c66fa4e68e155d56097db2b6e0ace022d2bc868470`，findings=[]。主线重核所有源码与日志SHA；四文件回归 **124 pass / 0 fail / 1229 expect**，Core类型exit0、七文件lint exit0（0 warnings/errors、1 rule）。三生产文件和其余三测试与123审批相同，旧Effect检查只复用相同三生产SHA，不扩大为新测试AST检查。原123及单例格式前58断言记录均保留，不累计。

真实SQLite trigger阻断Delegation Task settlement marker，Task事务回滚并保留原claim/预算2/未知child input/旧Job marker；健康Workflow先按Restart原顺序调度并在TestLLM gate等待，同次sweep归账故障后释放gate，生产step与root handoff的两个精确input result均completed。移除trigger后，一次recovery_required写回、Task/KV/notice/release/ACK及重复/cold sweep幂等。关系由 [Task事务](../../packages/core/src/session/task.ts:1019)、[Restart顺序](../../packages/core/src/session/execution/restart.ts:206) 与 [通知wake](../../packages/core/src/session/notification.ts:46) 决定；KV root经既有LayerNode graph/layer memo复用同服务。

fault child仍pending；parent staged revert使入箱notice保持pending。这不证明成功Delegation delivery/result/receipt、notice消费、实际provider或进程kill。AUDIT-V2-RECOVERY-ISOLATION保留完整配置/Location/lifecycle、managed-server/provider、并发/逐写入crash/release→ACK等剩余范围。P0.4整项、提交和发布未获批准；当前commit列表由Git生成为空。主线继续同源Desktop验收和后续合同取证。
