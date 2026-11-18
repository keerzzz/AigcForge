# Delegation 生命周期 HTTP 检查点（2026-10-21）

实现目录 `/home/keer/workspace/aigcfroge-v2`，分支 `v2-dev`，接续基准 `bcba143b0aabfd24229b7f1fd28a779468c7eeb7`。本切片接通既有 Delegation 生命周期 HTTP 合同，补 unarchive 的 typed 错误边界，并复用 Task HTTP 已验证的目录归属规则。外部 CLI、attended、review/revision 生产者及产品客户链仍开放，见 [技术债账本](../technical-debt.md)。

## 行为与决定规则

| Owner                               | 行为与关系依据                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DelegationHttp.parentVisible`      | `packages/server/src/handlers/delegation.ts:30` 让持久 Session owner 与 route 共用 `locationRefForRoute`（`middleware/workspace-routing.ts:18`）；以解析后的 directory 和 workspaceID 决定归属。stored `/.` alias 与目录中的 `%2F` 不因两侧规则不同被拒绝。                                                                                                          |
| `DelegationHttp.reconcile`          | `packages/server/src/handlers/delegation.ts:112` 按既有四决策分派：retry 要求 turnID/participantID，复用 Execution.retry；close 复用 Execution.close；fork 返回新 aggregate；resume 只调用 reconcileResume。`DelegationExecution.retry`（`execution.ts:728`）决定确切旧输入、attempt 与 child 归属；不会直接调用把未决 Delivery 写 failed 的同名 Service.reconcile。 |
| `DelegationService.reconcileResume` | `packages/core/src/delegation/service.ts:1098` 仅验证 aggregate 存在并返回 0。没有确切 attempt 的持久幂等证明时，HTTP resume 保留 recovery_required 回执；不增加 wake、provider 请求或外部 callback。                                                                                                                                                                |
| 撤销拒绝与完成                      | handler `:139`/`:159` 分别调用 `DelegationService.retractRejection`（`service.ts:734`）与 complete（`:978`）。前者检查 blocker participant，保留原 review 回执；撤销不是批准。后者要求合法 closing→completed 转换并调用 `canComplete`（`review.ts:144`），然后自动 archive；HTTP 不隐式 close。                                                                      |
| 归档与恢复                          | handler `:171`/`:174` 复用 archive/unarchive。`DelegationService.unarchive`（`service.ts:913`）在既有 serialized mutation lock 内，先以相同七项 folded 输入调用 canComplete，再发布 Completed；与 Completed fold（`fold.ts:945`）共用屏障。拒绝返回已有 BarrierNotMetError，经 HTTP 映射为 400。                                                                     |
| fork                                | handler `:177` 返回 `DelegationService.fork`（`service.ts:949`）创建的新 aggregate。新 roster 保留 provider/target/role、context 变为 fork，生成新 participant ID；不复制 child 绑定、Turn 或 review 回执。原输入结算保留。                                                                                                                                          |
| purge                               | handler `:183` 先要求 purge=true，再顺序执行 Execution.close→Service.delete。`DelegationExecution.close`（`execution.ts:816`）先提交关闭 fence，等待已验证 child idle、取消 pending inbox、settle 与清理 Job；`DelegationService.delete`（`service.ts:1015`）才删除 aggregate 投影、事件与序列。close 失败停止后续删除。                                             |

close→delete 没有跨两次调用的事务或单一锁。当前执行安全性来自已提交的 Closing/terminal fence：`Service.appendTurn`（`service.ts:434`）与 addParticipant（`:323`）在领域锁内重读并拒绝；Execution dispatch（`execution.ts:702`）、retry（`:728`）、steer（`:790`）与 close（`:816`）共用执行锁；observer（`:516`）重读终态阻止重启。此依据不构成跨进程、任意子树或未来外部 adapter 的排他保证。

方案对冲：直接连接旧同名 reconcile 会把 resume 的未决副作用改成 failed，直接 domain delete 会跳过 child cleanup。本切片按现有 Execution/Service owner 分派命令，并在发布 Completed 前复用纯屏障。没有新增 runtime、输入结果表、恢复循环、状态或事件类型。

## 验证

准确命令、cwd、退出码、日志与源文件 SHA256 见 [verification.json](evidence/v2-delegation-lifecycle-2026-10-21/verification.json)。项目 Bun 1.4.2；测试从包目录运行。定向与全包范围重叠，数量不相加。

| 范围                                           | 实际结果                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| Core unarchive RED                             | exit 1；0 pass / 24 filtered out / 1 fail / 4 expect；1.443s              |
| Core unarchive GREEN                           | exit 0；1 pass / 24 filtered out / 0 fail / 9 expect；1.87s               |
| Core DelegationService 整文件                  | exit 0；25 pass / 0 fail / 170 expect；5.20s                              |
| Core Service/Execution/Fold/Review/Task 五文件 | exit 0；100 pass / 0 fail / 588 expect；22.78s                            |
| Core 全包，同 UID 隔网且清除 capability        | exit 0；7095 pass / 365 skip / 0 fail / 107095 expect；355 files；229.70s |
| Core typecheck                                 | exit 0；tsgo project build                                                |
| Client generate、check:generated、typecheck    | 各 exit 0；生成目录无差异                                                 |
| Server 全包，同 UID 隔网且清除 capability      | exit 0；111 pass / 1 skip / 0 fail / 6417 expect；34 files；41.43s        |
| 最终四文件 lint、格式与 diff 检查              | 各 exit 0；四文件 lint 0 warnings / 0 errors                              |
| 根 check 最终源码                              | exit 0；19/19 successful，16 cached；1487 lint warnings / 0 errors        |

Server 最终 HTTP 为 exit 0，10 pass / 0 fail / 255 expect，9.69s；Task/Routing/Policy 相邻三文件 exit 0，15 pass / 0 fail / 225 expect，8.44s。Server typecheck exit 0；全包与根 check 以 verification.json 的最终记录为准。

真实生产 Web handler 与生成 Promise 客户端验证 close→complete→autoarchive、未 close 拒绝、重复 complete/archive 不新增事件、unarchive、撤销拒绝不替代批准、未满足屏障不写事件、四决策分派、fork 新 roster、取消来源 unarchive 返回 400，以及 auth/实验 flag/retained Bus/foreign/missing aggregate 门禁。

真实内部 Session/TestLLM 通过 interrupt→reconcile retry 将同一输入的 admission attempt 从 1 推进到 2，并保留 Turn。active+queued purge=false 保留聚合、执行、inbox；purge=true 后子 Session idle、pending inbox 和观察 Job/后台记录清空，再删除 aggregate 事件、序列和投影。删除前 `sessions.context` 返回的全部消息按 ID、内容和相对顺序保留；context 经 SessionHistory 选择，测试不证明所有历史表行逐行不变。child Session 仍存在，queued prompt 未成为用户消息，provider 请求没有重复增加。

stored alias 测试先经 `/api/session` 持久化 `/.` 并确认存储原文，随后以规范目录和 alias 查询/执行生命周期；所有新 mutation 对其他目录和不存在的 aggregate 均拒绝。实际 disk database 重开沿用 admitted history 回归；尚未另跑 completed archived 的 cold reopen 顺序。

`history_audit` 进行独立只读审查，核对决定函数、执行 fence、历史断言方向和未交付债务；它没有重复运行测试。生命周期正向 approval 通过实际 Service 记录，不能证明 review/revision 的生产工具或 UI 已接通。本切片不证明真实外部 adapter、产品 E2E、Electron/PTY 或生产数据库升级。

resume 回归验证 recovery_required 回执、fold、事件和序列不变；该 fixture 没有绑定 child 或 pending inbox。bound child+pending inbox 的 resume no-wake 顺序尚未单独运行；不增加 wake 的结论有上述 handler/Service 源码依据，未计为该顺序已测试。不同 workspaceID 对照同样未另加 lifecycle fixture。

## 失败与能力边界

Core RED 已有 cancelled→archived 历史，其 unarchive 缺少 typed precheck，`Cause.findErrorOption` 返回 undefined，进入 projector defect。`Bus`（`bus.ts:402`）先投影再持久化事件与序列，失败会回滚；不能据此声称留下毒 Completed 事件。修复后 typed failure 且无 Die，fold、三张投影、EventTable、EventSequence 和通知均不变。

HTTP 首个生命周期 RED 为现有 complete stub 拒绝，后续初次 active purge 断言误以为已消费 Job 会保留 cancelled 行；实际 cleanup 移除该 Job，断言改为不存在。初次类型检查发现 Promise wire ID 是普通 string，测试进入 Core 前用已有 Schema 解码收窄。全部初次与中间失败日志保留，最终成功不覆盖它们。

当前 archived→completed 只适用于完成屏障有效的历史；取消来源的可见性恢复未新增状态/事件。纯 draft→closing 按既有状态机拒绝，所以 draft purge 返回 typed 400 并保留聚合。resume 在未知副作用下仍不执行；多未决输入、来源不匹配的 inbox、子树与 cleanup 故障恢复仍沿用开放账本。三类边界均有 Owner 和解除条件。

## 本地核算

提交列表以 `git log --oneline bcba143b0..HEAD` 生成，不手写。实现仅在 V2 工作区；参考目录 `/home/keer/workspace/aigcfroge` 的 `brand-mode-icons` 保持干净。未推送、创建 PR、合并、发布或部署。
