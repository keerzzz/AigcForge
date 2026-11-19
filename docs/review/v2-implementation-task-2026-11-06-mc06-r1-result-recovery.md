# MC06-R1 外部结果恢复

2026-11-06 已完成本任务限定验收，见[最终接受](/home/keer/.codex/outputs/2026-11-06/mc06-r1/root-final-acceptance.json)。真实原生读取与受控父恢复分别记账，原边界保留；完整MC06仍待R2/R3/R4。

Owner：监督 Root。2026-11-06。依据最新自主执行 goal，接续 MC06 原剩余项；MC06 首片功能接受及原严格 fixture 失败均保留。

## 问题与选择

外部 Codex 完成后，Delegation 只保存 4096 字符摘要。完整结果在进程内 Job，父 Task 的 Tool.Success 落盘前崩溃会丢失本地全文。

复用固定 Codex 0.162.1 的 `thread/read(includeTurns=true)` 读取原生持久结果，在既有 `DelegationExecution.recoverPending` 中恢复原 running Tool。该入口早于父 Session 恢复，不再执行模型、命令或 Task。

比较方案：新增 KV 全文快照实现简单，但只能覆盖本地已收结果之后的窗口，还增加保留/删除责任。本片采用原生 thread 读取，复用 Delegation Binding 身份与既有 Task 输出/截断规则，不另建全文真源。

## 范围

- 固定 codex/app-server；准确 Binding 的 Location、父 Session、source message/tool、Delegation delivery/attempt、thread/turn。
- 已完成且持久保存、完整 items 的准确外部 turn；只读取最后 agentMessage 原文。
- 原父 Tool 仍 running 且父执行/本地 Job 没有活动 owner。已有 completed/failed/cancelled 终态不覆写。
- 按原 Task revision 与 delivery 身份幂等结算，复用正式 Tool.Success 和 ToolOutput 截断。
- 缺历史、未知/中断/失败 turn、身份变更或终态冲突保持待协调，不伪造成功。

## 修改与分工

- 子智能体：`tool/cli-adapter.ts`、`tool/codex-app-server.ts` 及对应协议测试。
- Root：`delegation/execution.ts`、`delegation/receipt.ts`、`tool/plugin/task.ts`、`tool.ts` 的既有结果处理提取；测试子智能体只写恢复集成测试。
- 原启动消费点 `session/execution/restart.ts` 接收 deferredParents，防止临时读取失败进入 stale Tool 清理。复用既有 Bus.commit 条件提交，不新增 Bus API 或跨聚合事务框架。
- 独审子智能体只读；Root 独占测试和运行槽。保留仓内全部已有 WIP，不暂存、提交、推送或清理 Git。

## 验收

1. 先 RED：原父 running Tool 未提交、完整输出超过 4096 字符、关闭并重新打开同一数据库后恢复。
2. 冷恢复只发 thread/read；没有 thread/start、thread/resume、turn/start、模型或命令执行。
3. 原 Tool.Success 正文包含完整结果；重复恢复不重复结算；父后继能够消费该结果。
4. 错 thread/turn/Location、非完整/非完成结果、已 failed/cancelled 和缺失 Binding 不恢复成功。
   完整结果超过50KiB时，冷wait复用ToolOutput保存的原文件；缺失或身份不符不返回成功、不启动新模型。文件沿用既有7天保留周期。
5. 定点测试、Core typecheck、受影响格式/lint/AST、独立审查；只对新增失败做必要复查。
6. 真实持久读取可复用 v8 已保存的外部线程，在隔离目录中作一次读取验收。运行前冻结有限启动范围；真实模型预算为 0，不触发重试或探活。

## 后继

MC06-R2 后台外部 Task、R3 忙时 steer/queue、R4 有能力依据的其他 engine/transport 尚未交付。MC07 不因 R1 工程通过而提前开始。最终文档与唯一债务账本按实际证据更新。
