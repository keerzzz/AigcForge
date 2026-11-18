# V2 Delegation Service：真实 Bus/DB 回归

本地日期：2026-10-20（Asia/Shanghai；日志时间采用 UTC）。工作区：`/home/keer/workspace/aigcfroge-v2`，分支：`v2-dev`。本子任务只新增永久测试、独立报告和证据；源码修复与类型检查由主智能体负责。没有提交或远程操作。

最终定向回归为 **23 pass / 0 fail / 159 expect**，Bun 1.4.2，命令 exit 0。测试复用真实 AppNodeBuilder、Database、Bus 和 DelegationProjector，验证持久事件、投影重建、原子 fanout、并发准入、retry、fork 和软过期。生产 HTTP、实际模型/CLI 执行、重启恢复和客户端闭环不在本报告验收范围。

## 已验证行为

永久用例位于 [delegation-service.test.ts](/home/keer/workspace/aigcfroge-v2/packages/core/test/delegation-service.test.ts:1)。数据库使用真实隔离内存 SQLite，执行当前 migration；Project/Session 行直接作为真实外键和所有权夹具。Bus 开启实际事件留存，Service.node 自动提供实际 projector。此验证证明 retained event 的编码、读取与投影重建，不证明磁盘重启恢复。

| 范围 | 实际验证 |
| --- | --- |
| 内部 optional 与持久化 | `create`、participant、Turn、delivery、revision、review 保留显式 `undefined`；从 retained events 折叠，删除 Turn 投影后用生产 rebuild 恢复。 |
| 创建边界 | 缺失父 Session、重复 Delegation ID、实际 `persist:false` 均失败；无事件、投影或序号旁路写入。 |
| fanout 原子性 | 首个 Bus 通知即看到所有目标 delivery；后项 projector 失败时 Turn、delivery、事件、序号全回滚且无通知，后续重新准入从 seq 1 开始。 |
| 并发顺序 | 首次 Turn 事务用 Deferred 暂停，第二次准入等待；持久 Turn seq 为 `[1,2]`。 |
| roster 幂等 | 同参数顺序/16 并发准入只保留一个身份；分别改变 provider、target、role、context、child、thread 产生不同身份。 |
| 强制交错 | 在真实 Service 已读状态、调用实际 Bus 前暂停首次 publication，第二次同 Delegation roster/retry 仍只产生一个新事实；另一 Delegation 可继续写入。 |
| binding | 外来 child、跨 Delegation child 占用、改变既有 child/thread、复用其他 participant 的 thread 和空绑定均失败；精确重复绑定不新增事件。 |
| evidence 身份 | 目标集合顺序变化以及 summary/revision 提示变化复用原 Turn；digest、kind、delivery、目标集合、origin 或 sender 改变产生新 Turn。 |
| retry 与恢复 | failed/cancelled/recovery_required 从 attempt 1 准入 attempt 2，保持 Turn/origin/sender；admitted/running/queued/completed 不可重试。16 并发和强制交错只登记一个 attempt 2。多 receipt 恢复保留未恢复阻塞，最后一个开始后状态恢复 running。 |
| 组合写操作 | `complete→archive`、已完成后再归档、`reconcileResume→retry` 均有界完成；不可 resume 的 receipt 保留 recovery_required。 |
| fork | 新 Delegation 和新 participant 身份；保留父 Session/provider/target/role，context 为 fork；不复制 child/thread/Turn/delivery/revision/review；原绑定和历史保留。 |
| 软过期 | TestClock 恰好到 24 小时，presentation 与 resolveActive 一致过期；旧历史可读，普通 resolve 创建新 Delegation，显式 ID 可查询原聚合，错父查询失败。 |

`reconcileResume` 用唯一注册名的 capability fixture，只声明 `resumeThread` 能力；测试确认没有调用外部 callback，结束时禁用该条目。它验证领域重新准入和内部锁组合，不能替代真实 CLI transport 或安全重放证明。

## 失败、根因与修复

失败按共享前提分类，修复由主智能体落盘。本子任务未修改以下源码。

| 问题 | 决定行为的函数 | 可复现结果与最终处理 |
| --- | --- | --- |
| optional 以编码态重复解码 | [foldDelegation 的 Created 分支](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/fold.ts:329) | 已由主智能体改为 `Schema.toType`；内部服务传入的显式 undefined 经真实 Bus/projector 和历史重读通过。 |
| roster/retry 读写竞态 | [addParticipant](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/service.ts:269)、[retry](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/service.ts:801)；串行边界由 [serialized](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/service.ts:183) 和 [公开接口装配](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/service.ts:1150) 决定 | 无锁时强制交错产生两个 participant 身份、两个成功 retry。主智能体复用现有 Delegation-ID KeyedMutex 统一公开 mutation；内部组合调用原方法，避免重复上锁。修复后真实回归通过。仅同时启动 16 次并未复现，不能把该轮顺序调度的绿色当作竞态已排除。 |
| 恰好阈值时关系不一致 | [isSoftExpired](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/presentation.ts:12) 与 [resolveActive](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/service.ts:841) | 24 小时 presentation 已过期，原 `gte` 仍选中原 delegation。主智能体改为 `gt`，精确阈值通过。 |
| 恢复 receipt 后 aggregate 停留旧状态 | [DeliveryStarted 分支](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/fold.ts:569) | attempt 2 已 running，但 aggregate 仍 recovery_required。主智能体只在无剩余 recovery_required receipt 时恢复 running；两个 receipt 先后恢复回归通过。 |

身份关系以真实决定函数为依据：roster 比较位于 `addParticipant`；evidence 去重位于 [appendTurn](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/service.ts:478) 内完整匹配谓词；delivery 键由 [deliveryKey](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/fold.ts:183) 决定，状态与 attempt 合法性由 [requireDeliveryAttempt](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/fold.ts:132) 决定。测试不重写这些算法。

原子性来自 [Bus.publishAll](/home/keer/workspace/aigcfroge-v2/packages/core/src/bus.ts:533)，其事务后通知位于 [bus.ts:675](/home/keer/workspace/aigcfroge-v2/packages/core/src/bus.ts:675)；Service 用 [单一 batch](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/service.ts:561) 提交 Turn 与所有 delivery。

## 复用审查

| 候选 owner | 兼容性与选择 |
| --- | --- |
| `test/lib/effect.ts`、AppNodeBuilder、Bus.configured | 复用当前 V2 graph 与 scoped 测试工具，未另建 runtime。 |
| `delegation-projector.test.ts` 的 Project/Session 外键夹具 | 复用真实表字段与现有种子模式；局部 seedParent 只生成测试数据，不复制业务判断。 |
| Schema Event.versionedType | 复用真实持久事件版本规则，避免把 EventTable 的 `.1` 类型误当未版本化 live 类型。 |
| 旧主仓 service suite | 仅参考业务场景；旧 EventV2/SessionV2/defaultLayer 与当前 V2 graph 不兼容，未直接复制。 |
| publication 边界探针 | 无可复用的已读状态暂停夹具；仅转发真实 Bus，在 Deferred 门上改变调度，保留实际事务/投影/事件与通知。`Layer.fresh` 避免服务层被 outer graph memo 复用。 |

没有新增持久表、migration、第二 Event owner 或执行器。当前采用领域准入这一有限切片；它留下实际执行与恢复技术债，不能据此标记完整 Delegation 功能已交付。

## 命令与证据

最终命令 cwd 为 `/home/keer/workspace/aigcfroge-v2/packages/core`，放入禁用外网的 user/network namespace，仅开启 loopback：

```sh
unshare -Urn sh -c 'ip link set lo up && exec ../../script/bun run test --timeout 30000 test/delegation-service.test.ts'
```

[service-final.log](/home/keer/workspace/aigcfroge-v2/docs/review/evidence/v2-delegation-service-2026-10-20/service-final.log) 原始输出：Bun 1.4.2、23 pass、0 fail、159 expect、23 tests/1 file；exit 0。[service-final.json](/home/keer/workspace/aigcfroge-v2/docs/review/evidence/v2-delegation-service-2026-10-20/service-final.json) 保存 cwd、argv、UTC 起止、退出码以及运行前后源码 SHA-256。前后 hashes 相同。

| 保留日志 | 当时实际结果 | 归因 |
| --- | --- | --- |
| service-red.log | exit 1；11 pass / 6 fail / 99 expect | 5 个测试适配问题（版本化事件类型、取消 Effect 当函数）；1 个软过期业务问题。 |
| service-concurrency-red.log | exit 1；16 pass / 3 fail / 107 expect | Layer memo 使新 forwarding probe 未注入，2 个 readiness 超时；软过期问题仍存在。 |
| service-boundary-red.log | exit 1；16 pass / 3 fail / 109 expect | 修正测试后真实复现 roster、retry、软过期三个业务失败。 |
| service-green-first.log | exit 1；21 pass / 1 fail / 152 expect | 前三业务问题修复；新增恢复 aggregate 状态失败，文件名不表示命令通过。 |
| service-final.log | exit 0；23 pass / 0 fail / 159 expect | 最终真实回归。 |

测试文件的精确 oxlint 为 exit 0，0 warning/0 error；Prettier check 与 git diff --check 均 exit 0。原始收据由[已校验的 committed 归档索引](v2-committed-evidence-index-2026-11-18.json)定位：逻辑目录 `docs/review/evidence/v2-delegation-service-2026-10-20/` 下的 `lint-final.json`、`format-test-final.json` 和 `diff-check-final.json`。本子任务未运行 typecheck；它由主智能体统一执行，不能由以上测试结果推定通过。

## 未交付范围

| 登记编号 | Owner | 解除条件 |
| --- | --- | --- |
| V2-C-DELEGATION：实际 delivery 执行、未知副作用恢复、内部 child context fork、外部 transport | 主智能体；Core/Delegation、Session、Job、CliAdapter | 当前 Session inbox/Job owner 驱动实际生产执行；逐 delivery 结果、取消、restart reconciliation、安全重放和 child 历史边界有真实用例。 |
| V2-C-DELEGATION：生产 HTTP 与真实客户端消费者 | 主智能体；Server/Protocol/Client | 功能关闭/无留存/所有权/原子准入/查询合同通过；需执行语义的端点按真实执行 owner 交付。 |
| V2-VALIDATION：全量门禁、E2E、desktop、数据库副本迁移 | 主智能体 | 全量实际退出码、失败/skip、同运行时基准和隔离数据库升级演练证据齐全。 |

以上范围仍在 [V2 迁移未交付账本](/home/keer/workspace/aigcfroge-v2/docs/technical-debt.md:8) 开放。本报告不关闭共享账本条目，不把领域重新准入等同模型/CLI 执行成功。
