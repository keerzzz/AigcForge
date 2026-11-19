# V2 Delegation：持久准入修复与剩余执行设计

日期：2026-10-19。工作区：`/home/keer/workspace/aigcfroge-v2`。分支：`v2-dev`。本报告只覆盖 Delegation 设计审查、共享 Bus 修复及对应定向验证；Service、Schema 和 HTTP 的并行集成由主智能体验收。

共享 Bus 已支持同一事务内的历史前缀投影，并公开真实的事件保留能力。Bun 1.4.2 下，Bus、Session 路由和 Delegation 纯逻辑及投影的 7 文件回归为 **97 pass / 0 fail / 270 expect**。当前持久准入源码已接入 Server；任务执行、逐投递结算、恢复和客户端闭环仍需下一切片。

## 契约和范围

- V2 的权威分工是 Schema 管公开领域形状和 durable payload，Core 管运行与持久化，Protocol/Server 管 HTTP，见 [specs/v2/README.md](/home/keer/workspace/aigcfroge-v2/specs/v2/README.md:7)。
- V2 使用 `Session.prompt`、`session_inbox`、逻辑 Step、进程内 SessionExecution 与启动恢复 claim，见 [Session 契约](/home/keer/workspace/aigcfroge-v2/specs/v2/session.md:7) 和 [执行边界](/home/keer/workspace/aigcfroge-v2/specs/v2/session.md:55)。主仓旧 SessionV2、BackgroundJob 和 TaskDriver runtime 只能作为迁移参考。
- 迁移计划 §10.24 将 Delegation service/execution/recovery、task-driver/fill/task 留给 Phase C，见 [原计划](/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/2026-10-16-upstream-v2-desktop-alignment-plan.md:629)。不能以已有 Schema 或生成端点替代执行验收。
- 主仓 ADR-22 保留产品要求：完整 prompt 归 Session，Delegation 事件仅存有界 summary，Turn 与目标 Delivery 同批准入，见 [ADR-22 §2.4](/home/keer/workspace/aigcfroge/docs/architecture/adr/ADR-22-meta-agent-persistent-delegation.md:115)。运行实现按当前 V2 owner 适配。

## 根因和修复

| 问题组                         | 决定行为的 owner                                                                                                                                                                                                              | 复现与处理                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 历史事件无法解码               | `decodeSerializedEvent` 在 [bus.ts:73](/home/keer/workspace/aigcfroge-v2/packages/core/src/bus.ts:73) 只查 Schema 的 Durable manifest                                                                                         | 初始 projector 集成得到 `Unknown durable event type delegation.created.1`。主智能体将 canonical 事件移入 Schema，并在 [durable-event-manifest.ts:8](/home/keer/workspace/aigcfroge-v2/packages/schema/src/durable-event-manifest.ts:8) 纳入 Delegation 定义；Core [event.ts:1](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/event.ts:1) 精确再导出。 |
| 同批后项看不到前项             | [projectEvent](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/projector.ts:49) 读取 retained history，再追加当前事件折叠                                                                                      | 原 `publishAll` 在全部 projector 完成后才一次插入 EventTable。第二项只见原历史，读不到本批第一项；Delivery 因而看不到刚准入的 Turn。修复在每项 projector/commit 完成后于同事务插入该事件，见 [bus.ts:633](/home/keer/workspace/aigcfroge-v2/packages/core/src/bus.ts:633)。                                                                                            |
| 首次 aggregate 的 FK 失败      | EventTable 的 aggregate FK 在 [event/sql.ts:16](/home/keer/workspace/aigcfroge-v2/packages/core/src/event/sql.ts:16) 指向 EventSequenceTable                                                                                  | 首次尝试逐项插入时漏了 sequence 行，造成 5 个 Bus/路由失败。当前在首项 projector/commit 后、首事件 insert 前创建新 aggregate 的 sequence 行，见 [bus.ts:634](/home/keer/workspace/aigcfroge-v2/packages/core/src/bus.ts:634)。最终序号仍在末尾更新；全部操作保留于同一 immediate transaction。                                                                         |
| 关闭事件留存却声明持久准入可用 | Bus 默认 `persist:false`，见 [bus.ts:205](/home/keer/workspace/aigcfroge-v2/packages/core/src/bus.ts:205)；Delegation [readEvents](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/projector.ts:92) 必须读历史 | raw projector 测试证实 Created 后的 ParticipantAdded 报 `Delegation.DelegationSequenceError`，EventTable 仍为空。共享 [Bus.Interface.retainsEvents](/home/keer/workspace/aigcfroge-v2/packages/core/src/bus.ts:140) 现公开实际能力，在 [Service.of](/home/keer/workspace/aigcfroge-v2/packages/core/src/bus.ts:904) 返回同一 `persist` 值。                            |

修复后的投影顺序是：历史前缀 → 当前 projector → 当前 commit → 当前事件 insert → 下一项。当前事件仍通过参数提供，不提前插入造成重复折叠。aggregate mutex、整批回滚、最终序号、事务后路由和通知沿用原 owner；通知位置见 [bus.ts:667](/home/keer/workspace/aigcfroge-v2/packages/core/src/bus.ts:667)。

最终复核还发现新 aggregate 的首个 projector 可通过 [Bus.reserveSequence](/home/keer/workspace/aigcfroge-v2/packages/core/src/bus.ts:34) 创建序号行；现有 Session fork 就在 [projector.ts:234](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/projector.ts:234) 调用该 owner。新增真实用例复现 `UNIQUE constraint failed: event_sequence.aggregate_id`。首行初始化现用 [onConflictDoNothing](/home/keer/workspace/aigcfroge-v2/packages/core/src/bus.ts:638) 保留 projector 已创建行，末尾 finalSeq 更新沿用原规则。

没有新增 Event/Delivery 表、migration、第二 Bus 或第二执行管理器。逐项事件写入增加批内 SQL statement 数量，换取已复现的前缀可见性；本轮未做吞吐基准，不宣称性能无影响。

## 当前接线状态

初始审查时只有 Delegation state/fold/review/projector 和协议，Service/Execution/Recovery 未接入。当前工作树已由主智能体新增 [DelegationService](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/service.ts:170)，其 [appendTurn](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/service.ts:469) 沿用 admission lock、evidence/participant/origin 匹配及 Turn+Delivery 原子 batch。事件定义复用 Schema 的唯一来源。

Server 的 [applicationServiceNodes](/home/keer/workspace/aigcfroge-v2/packages/server/src/routes.ts:57) 已包括 Service；[handlers.ts](/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers.ts:44) 注册实际 DelegationHandler。当前实现 list/create/get/addParticipant/listTurns/appendTurn，见 [handler 返回值](/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers/delegation.ts:63)。其 [executionPending](/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers/delegation.ts:52) 对 retry/reconcile/steer/interrupt/complete/close/archive/fork/delete 等剩余端点明确返回 `not_implemented`。

持久化判断取真实 Bus：HTTP [enabled](/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers/delegation.ts:19) 同时检查功能开关和 `bus.retainsEvents`，Service [foldState](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/service.ts:183) 对无留存 Bus 返回领域 typed error。标准 Server 配置在功能启用且 persist 未显式给值时启用留存，见 [routes.ts:125](/home/keer/workspace/aigcfroge-v2/packages/server/src/routes.ts:125)；实际能力检查也覆盖 composition overrides 替换后的 Bus。

上述 Service/HTTP 是当前源码接线记录，不是本子任务的验证结论。主智能体仍负责 Service/HTTP 回归、fixtures 编译、Schema/Protocol 检查及必要客户端生成。

## 下一执行切片

推荐沿当前 owner 完成一条内部 participant 纵向链，再扩展外部 transport。以下为设计建议，尚未全部实现。

1. **Session 持有完整输入与投递来源。** 使用平铺的 `Session.prompt({ sessionID, id, text, metadata, delivery, resume })`，当前入口类型见 [session.ts:186](/home/keer/workspace/aigcfroge-v2/packages/core/src/session.ts:186)。`metadata` 已进入 UserPayload，见 [prompt.ts:79](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/prompt.ts:79)；回报可复用 [Session.synthetic](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/session.ts:273)。以稳定 inbox identity 和明确来源关联 Delegation/Turn/Participant/origin；复用 [SessionInbox.reconcile](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/inbox.ts:154) 的 first-admission-wins 规则。Delegation 事件不复制完整 prompt，也不把 summary 当恢复用 prompt。
2. **准入独立于 Job。** [Job.start](/home/keer/workspace/aigcfroge-v2/packages/core/src/job.ts:252) 遇到同 ID running job 会返回现有 job，不执行新 run。新 prompt 必须在 Job.start 外准入；现有 [subagent plugin](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/plugin/subagent.ts:203) 已提供正确模式。Job 复用 start/wait/block/background/cancel，不回植旧 BackgroundJob、TaskDriver.Runtime 或内存工具循环。
3. **生命周期归全局 Scope，placement 由 Session 决定。** [SubagentJob](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/subagent-job.ts:24) 已将 job 和完成 observer 放入全局 Scope/context，超过发起插件生命周期。Delegation 执行也应复用这个边界，调用 Session.resume/interrupt，让当前 SessionExecution 在 drain 开始时解析 Location。
4. **逐 Delivery 结算。** [deliveryKey](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/fold.ts:183) 决定逻辑身份：Turn+Participant+origin+sender；attempt 不在 key，[requireDeliveryAttempt](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/fold.ts:132) 决定重试与终态转换。Job 完成不能直接给该 child 的所有 Delivery 标 completed：queued inbox 可能尚未处理。结算必须核对带来源的 pending/delivered inbox 和对应后续结果；多个 Delivery 不共享一个未经归属证明的“最后 assistant”。
5. **复用领域 barrier。** review/revision 关系由 [evaluateReviewBarrier](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/review.ts:78) 决定，complete 由 [canComplete](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/review.ts:144) 决定。状态迁移由 [canTransition](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/state.ts:24) 决定；draft 不能直接 closing。正常完成应经过 closing → completed → archived，不能以 Job.done 替代领域完成。

## 恢复和 fork 的实际约束

**Delegation 恢复不能借普通 subagent recovery 暗中重跑。** [Job.Recovery](/home/keer/workspace/aigcfroge-v2/packages/core/src/job.ts:12) 当前只有 shell/subagent，后者经 [SessionRestart.recoverSubagent](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/execution/restart.ts:138) 自动 `execution.resume`。若给 Delegation job 直接挂普通 subagent recovery，重启时可能绕过领域 reconciliation。下一切片可复用 Job 执行且不挂普通 recovery marker，由 Delegation 历史决定恢复；若扩展通用恢复机制，必须仍由领域 owner 判定恢复动作。

同时，[SessionStore.listSuspended](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/store.ts:194) 只自动选顶层 Session，[releaseChildClaims](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/store.ts:225) 清理非普通 recoverable child 的 claim。Delegation startup sweep 必须与 [SessionRestart 启动顺序](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/execution/restart.ts:192) 协调。保留 inbox、识别已 delivered 事实、已知结果和不确定副作用，再决定 admitted/recovery_required/failed；不添加第二执行管理器。

旧 execution 使用 `turn.promptSummary` 再 prompt child，见 [主仓 execution.ts:304](/home/keer/workspace/aigcfroge/packages/core/src/delegation/execution.ts:304)。这段不能直接复制：恢复必须从完整 Session 输入/history 核对，不把 bounded summary 当完整重放输入。

**`context:"fork"` 不能直接调用当前 root fork。** [Session.fork](/home/keer/workspace/aigcfroge-v2/packages/core/src/session.ts:319) 通过 [fork projector](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/projector.ts:156) 写 `parent_id:null`、`fork_session_id:parent`；Delegation [bindParticipant](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/service.ts:364) 要求 `child.parent_id === delegation.parentSessionID`。这两种关系的决定函数不同，直接 fork 后 bind 会失败。下一实现需由 Session owner 明确增强 child history fork，或在产生资源前返回 typed unsupported；不能 roster 声明 fork 而执行 fresh，也不能擅改现有 root fork 契约。

## 外部 transport

复用 [CliAdapter 唯一 registry](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/cli-adapter.ts:120)，按真实 optional control methods 收窄能力，见 [CliAdapterValue](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/cli-adapter.ts:85)。当前 `packages/core/src` 和 `packages/server/src` 检索只见 registerConfigCliAdapters 的定义，尚未发现生产注册调用；需要接线验收后才能声称 config adapter 可用。

外部权限覆盖不统一。主仓 [ADR-22 §2.10](/home/keer/workspace/aigcfroge/docs/architecture/adr/ADR-22-meta-agent-persistent-delegation.md:260) 记录 ACP/Claude SDK 的 callback 桥、Codex SDK 和 JSONL 的不同边界；该记录是产品依据，当前 adapter 仍需 contract 测试，不能宣称新版 SDK 能力已核实。具有 `resumeThread` 只证明提供续接方法，不能证明未知副作用可安全重放。先交付内部链，再以真实 transport 分别验证 read-only、permission source、interrupt、thread reconciliation 和明确拒绝。

## 方案对比与技术债

| 方案                                                                                | 结果                                                               | 裁决                                                                                                                             |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 仅移植 Service，并让 HTTP 返回准入成功                                              | 建立持久领域数据入口；不含执行、投递结果和恢复                     | 作为当前有限切片可交付，但必须登记剩余范围，不能把 task 功能标完成。                                                             |
| Service → Session inbox → 唯一 Job → 逐 Delivery 结算 → 领域恢复 → tool/HTTP/客户端 | 复用现有生命周期、placement、权限、Bus 和 runner，端到端验收可归属 | 推荐继续实现。                                                                                                                   |
| 整拷旧 TaskDriver/BackgroundJob/SessionV2 runtime                                   | 恢复旧 runtime ref、prompt 形态和恢复语义；形成重叠 owner          | 不选。旧 [TaskDriver.Runtime](/home/keer/workspace/aigcfroge/packages/core/src/tool/task-driver.ts:253) 不是当前 V2 的执行边界。 |

| 未交付范围                              | Owner                                 | 解除条件                                                                                                                     |
| --------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 持久准入 Service/HTTP 的完整验收        | Core/Delegation + Server，主智能体    | 真实生产服务图下 CRUD/Turn fan-out、wrong parent/Location、功能关闭、实际 Bus 无留存、回滚、重读和公开客户端 contract 通过。 |
| 内部 task 执行、队列与结算              | Core/Delegation + Core/Session + Tool | Session 完整输入先准入，唯一 Job 驱动，多个 steer/queue 不丢失，逐 Delivery 对应结果、并发与中断通过。                       |
| restart/retry/reconcile                 | Core/Delegation + Core/SessionRestart | 与 child claim sweep 明确协调；崩溃前后准入/已投递/未知副作用各有测试，不重复执行不可证明安全的工作。                        |
| child context fork                      | Core/Session + Core/Delegation        | 明确父子关系和历史复制边界，生产实现或 typed unsupported；无伪造 fresh 行为。                                                |
| 外部 transport 与 task-driver/fill/task | Core/Tool + Core/CliAdapter           | 注册接线、真实 transport contract、权限边界、thread/result reconciliation 与 close 顺序通过。                                |
| 客户端、桌面和整体迁移验收              | Client/App/Desktop + 主智能体         | 真实消费者可执行两轮 build/review/repair，必要生成无漂移，E2E、桌面冒烟和存量数据库副本演练通过。                            |

主智能体应将以上未交付范围同步到 `V2-DELEGATION`/`V2-TASK` 清单或 debt ledger。本报告记录 owner 与解除条件，不代替共享账本验收。本子任务未提交、未远程操作、未运行 typecheck 或全量检查。

## 验证记录

最终定向命令从 Core 包目录运行：

```sh
../../script/bun run test test/bus.test.ts test/bus-session-routing.test.ts test/delegation-state.test.ts test/delegation-fold.test.ts test/delegation-review.test.ts test/delegation-digest.test.ts test/delegation-projector.test.ts --timeout 30000
```

exit 0；`bun test v1.4.2 (744846f84)`；**97 pass / 0 fail / 0 skip / 270 expect / 7 files / 2.41s**。证据：[bus-delegation-final-bun-1.4.2.log](/home/keer/workspace/aigcfroge-v2/docs/review/evidence/v2-delegation-resumption-2026-10-19/bus-delegation-final-bun-1.4.2.log)。

新增 5 个真实 projector/数据库用例覆盖：批内只见此前前缀、无留存的实际失败、首 projector 自行初始化序号、Turn+两 Delivery 原子提交且通知见全量，以及后项错误时投影/事件/序号全部回滚且无通知。已有 Bus 与 Session 路由套件同时通过。

| 保留日志                                 | 当时实际结果                                           | 分类                                                       |
| ---------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------- |
| `projector-red.log`                      | Bun 1.3.14；0 pass / 2 fail                            | Durable manifest 漏 Delegation 事件。                      |
| `batch-prefix-red.log`                   | Bun 1.3.14；0 pass / 1 fail / 3 filtered               | 第二 batch projector 实际只读到 `[0]`，应读到 `[0,1]`。    |
| `batch-prefix-green.log`                 | Bun 1.3.14；1 pass / 1 fail / 2 filtered               | 前缀修复通过，无留存用例预期错误文本写错；该日志不是绿轮。 |
| `bus-delegation-first.log`               | Bun 1.3.14；89 pass / 5 fail / 2 filtered / 239 expect | 首次逐项 insert 缺 sequence FK 行，已修复。                |
| `bus-delegation-green.log`               | Bun 1.3.14；96 pass / 0 fail / 266 expect              | 历史成功；不计作 Bun 1.4.2 门禁。                          |
| `bus-delegation-bun-1.4.2.log`           | Bun 1.4.2；96 pass / 0 fail / 266 expect               | 格式整理后、新增 retention capability 前的成功。           |
| `bus-delegation-retention-bun-1.4.2.log` | Bun 1.4.2；96 pass / 0 fail / 268 expect               | retention capability 已加入、reservation 回归前的成功。    |

补充最终复核日志：`batch-sequence-reservation-red-bun-1.4.2.log` 为 Bun 1.4.2、0 pass / 1 fail / 4 filtered，序号行重复插入；修复后的 `bus-delegation-final-bun-1.4.2.log` 为 97 pass / 0 fail / 270 expect，是当前源码最终定向结果。

源码/测试的精确 oxlint 为 exit 0、0 warning/0 error。格式、补丁空白检查与文件 SHA-256 见 [verification.json](/home/keer/workspace/aigcfroge-v2/docs/review/evidence/v2-delegation-resumption-2026-10-19/verification.json)。重复运行不累加通过数；本轮未覆盖 Service/HTTP 测试、全量 Core、Server、Client、E2E、桌面或数据库迁移。
