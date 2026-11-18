# Delegation 执行检查点（2026-10-20）

实现目录为 `/home/keer/workspace/aigcfroge-v2`，分支为 `v2-dev`。本切片接续 Session 输入结果提交 `2afd9422e`，接通内部 participant 的持久任务执行、逐输入结果结算、冷恢复核对，以及 retry/steer/interrupt/close HTTP。Task 工具、外部 CLI、review/complete/archive 客户流程和 Custom snapshot 仍开放，见 [技术债账本](../technical-debt.md)。本地检查点不表示整体 V2 迁移完成。

## 行为与复用边界

| 候选               | 证据及兼容性                                                                                                                                                                                             | 决定                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Session 输入与结果 | `SessionInputResult.read`（`packages/core/src/session/input-result.ts:21`）按持久消息顺序决定输入与结果关系；可区分 queue，也允许同一 continuation 内的 steer 共享结果                                   | 直接复用，不建第二套结果表或模型循环                                       |
| Delivery 身份      | `DelegationFold.deliveryKey`（`packages/core/src/delegation/fold.ts:183`）决定 Turn、participant、origin、sender 的关系；`DelegationExecution.inputID`（`execution.ts:46`）在该身份上加入 attempt        | 精确重发采用同一 Session 输入 ID；显式 retry 使用新 ID                     |
| child 归属         | `DelegationService.requireBinding`（`service.ts:226`）统一验证父 Session、project、workspace、directory、mode 和绑定唯一性                                                                               | 执行、结果核对、控制入口复用该校验                                         |
| 执行与观察         | `DelegationExecution.activate`（`execution.ts:271`）复用 Job 和 Bus；`dispatch`（`:311`）复用 Session 准入和 SessionExecution wake                                                                       | 观察 Job 使用 participant ID，避免被 child 的前台中断提前取消              |
| history fork       | `Session.fork`（`packages/core/src/session.ts:323`）决定确切 ID 的既有 fork 是否可复用；`SessionProjector.projectFork`（`session/projector.ts:115`）保存 child 归属与父 mode                             | 在现有 fork 事件增加可选 child 事实；旧事件省略时仍为 root fork            |
| 冷恢复             | `DelegationExecution.findInput`（`execution.ts:141`）验证来源与 attempt；`settle`（`:193`）读取 Session 自有结果；`SessionRestart`（`session/execution/restart.ts:195`）先核对 Session 再处理 Job marker | 无 marker 的崩溃窗口也可识别；未知副作用保留 recovery_required，不自动重放 |

完整任务文本仅进入目标 Session。Delegation 仅保存有界摘要与引用；结果摘要遵循既有 UTF-16 长度限制并避免截断 surrogate pair。HTTP 的可选 `prompt` 缺省时保留仅登记 Turn 的行为。Custom participant 执行仍依赖尚未交付的 composition snapshot，入口明确失败。

`close` 先关闭准入，再中断并等待 child 空闲、取消已验证的 pending 输入、结算剩余 Delivery、清理观察任务与 claim，保留 Session 历史。来源不匹配的 inbox 留待人工裁决。`reconcileResume` 不再以 adapter 的 thread continuation 能力推断未知副作用可安全重放。

方案对比：直接复制旧 TaskDriver/runtime 会重复当前 Session、Job 和 Tool owner；另建每 drain 的结果身份无法表达 Session 的输入关系。本切片选择扩展已有 owner。跨目标原子性和子树关闭尚未实现，作为下一切片验收项登记，不作安全保证。

## 已验证

命令、cwd、退出码和日志 SHA256 见 [verification.json](evidence/v2-delegation-execution-2026-10-20/verification.json)。各包测试分别运行；根 `check` 只执行 lint 与类型检查。运行时为项目启动器固定的 Bun 1.4.2。

| 范围                                        | 实际结果                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| Core 最终四文件回归                         | exit 0；124 pass / 0 fail / 588 expect                                 |
| 接续四文件复验                              | exit 0；124 pass / 0 fail / 589 expect；日志 `core-resumed-review.log` |
| Core 原检查点全包，同 UID 隔离网络          | exit 0；7050 pass / 365 skip / 0 fail / 106059 expect；354 files       |
| Schema 全包                                 | exit 0；353 pass / 0 fail / 1238 expect；42 files                      |
| Protocol 全包                               | exit 0；10 pass / 0 fail / 41 expect；4 files                          |
| Client 全包                                 | exit 0；224 pass / 0 fail / 906 expect；20 files                       |
| Server 全包                                 | exit 0；100 pass / 1 skip / 0 fail / 6155 expect；33 files             |
| Protocol check:generated、Client 官方重生成 | exit 0；11 个 Client 文件重生成零漂移                                  |
| Core、Schema、Server 单包类型检查           | 最终均 exit 0                                                          |
| 接续根 check                                | exit 0；19/19 typecheck，0 cached；1487 lint warnings / 0 errors       |
| 本切片 19 个源码/测试文件格式与 lint        | exit 0；Prettier 全部通过；oxlint 0 warnings / 0 errors                |
| git diff --check                            | exit 0                                                                 |

Core 全包采用已验证的同 UID 网络隔离：启用 loopback 后清除 capability，避免宿主 8080 占用；宿主服务继续运行。Server 的 Mercurial 用例仍 skip，日志中的已有 OAuth listener 告警未在本切片归因。

真实回归覆盖独立 queue 结果、后续失败保留前次成功、完整原文重试、新 attempt 身份、tool continuation 的 steer、用户中断、shutdown、无 Job marker 的冷恢复、child 缺失、来源不匹配、fanout 绑定冲突提前校验、观察任务换代、close 的 pending 清理和 fork 重放。Server 使用实际 HTTP 与生成客户端验证执行和控制入口；这些测试不能替代全产品 E2E。

## 失败证据与未交付范围

初轮失败包括测试图未提供 Session、shutdown 夹具重复 Location、测试错误类型与字面量推宽、UTF-16 摘要长度和恢复准入缺口。修复后定向和全包回归已通过；失败日志继续保留。

上一轮 `root-check-final.log` 退出 -11，前序 Schema 测试的 `boundary.type` 被推宽为 string。接续时字面量修正已保存，Schema 单包类型检查退出 0；本轮重新执行 `root-check-resumed.log` 退出 0。最终成功不能覆盖前一失败，也不能据此宣称 Turbo 异常根因已查明。

以下范围未交付，owner 与解除条件已登记在账本：跨目标绑定/输入/观察任务的全额回滚，多个 recovery_required 输入的处理顺序，子树先子后父关闭，中途 cleanup 故障恢复，Task canonical leaf Permission，外部 CLI，review/complete/archive 客户链，Custom composition，Workflow，AI judge/share-summary，保留 server endpoints，发布路径，全产品 E2E、Electron/PTY 和存量数据库副本升级。

## 提交核算

本地提交列表必须由 `git log --oneline 2afd9422e..HEAD` 生成。未推送、创建 PR、合并、发布或修改真实生产数据库。

## 关闭清理补验

关闭结果事件不得撤销准入屏障。另一个接续会话留下的修复已纳入 `81a151cc6`：`DeliveryFailed` 不覆盖 closing，`DeliveryRecoveryRequired` 保留 closing/completed/cancelled。本轮补齐当时尚未提交的两项 fold 回归；用数组联合推导修正 `Array.of` 将不同事件推断为同一种事件的问题。

另复现了同一归属前提下的清理缺口：child 移至另一 Location 后，close 的首个 bindParticipant 会失败，观察任务清理无法完成；child 缺失也会在后续 inbox 清理抛错。`DelegationExecution.ownsChild`（`packages/core/src/delegation/execution.ts:193`）直接复用 `DelegationService.requireBinding`，供结果结算、直接 recover 和 close 使用。close 仅对确认 owned 的 child 中断、取消 inbox 和释放 claim；失配分支仍取消自己的 Delivery 和观察 Job，保留目标 Session。直接 recover 仅释放确认 owned 的 claim。

| 补验                  | 实际结果                                                           |
| --------------------- | ------------------------------------------------------------------ |
| 关闭屏障三文件        | exit 0；59 pass / 0 fail / 304 expect                              |
| 缺失及移动 child 回归 | exit 0；2 pass / 16 filtered / 0 fail / 10 expect                  |
| 清理五文件最终回归    | exit 0；144 pass / 0 fail / 653 expect                             |
| 清理修复后 Core 全包  | exit 0；7054 pass / 365 skip / 0 fail / 106630 expect；354 files   |
| 清理修复后根 check    | exit 0；19/19 successful，16 cached；1487 lint warnings / 0 errors |
| Core 单包类型检查     | exit 0                                                             |

最终补验日志为 `core-owner-regression-final.log`、`core-full-owner-final.log`、`root-check-owner-final.log` 和 `core-typecheck-owner-final.log`。失败证据保留：关闭屏障初轮 3 fail，fold 夹具类型推宽，移动 child 夹具缺少 SessionMessage import，真实 moved close 的绑定失配，品牌路径断言类型错误。最终通过只覆盖各自稳定源码范围。

直接 recover 的 claim 保护不代表启动流程保护：SessionRestart 的通用 releaseChildClaims 仍会清理无 recoverable marker 的孤立 child claim；该现有策略没有修改。活动 child 的 recover 提前返回仍保留 lost activation 入口约定。跨目标回滚、子树关闭和 cleanup 故障注入仍登记为开放范围。

## 接续复核

`execution_review` 子智能体完成 `activate/close/recover` 与 `Job.cancel/wait` 的静态追踪，未发现已核查路径上的锁互等。观察器在服务作用域等待 Delegation 锁；`Job.cancel` 在释放自身注册表锁后关闭独立 watcher 作用域（`packages/core/src/job.ts:425`），不等待服务作用域中的观察器。

启动恢复复核未发现正常 dispatch 路径上的活动 claim 缺陷：`recover` 遇到活动 child 直接返回（`packages/core/src/delegation/execution.ts:453`）；dispatch 在 wake 前写入 Job marker；`SessionRestart` 将 marker child 纳入保留集合（`session/execution/restart.ts:200`），由 `SessionStore.releaseChildClaims`（`session/store.ts:225`）决定哪些 child claim 可清理。子智能体未运行测试；上述行为复验由主智能体运行，结果单列。未覆盖绕过 DelegationExecution 直接启动 child、跨目标回滚、子树关闭或 cleanup 故障注入。

`task_contract` 子智能体确认下一 Task 切片应复用 DelegationExecution；当前 `task_spawn` 合同只负责记录任务，不能改成执行器。前台完整输出、后台完成回送、父 Task 关联及叶权限必须逐项实现，不能将 durable admission 或 Delivery 摘要当成任务完成。
