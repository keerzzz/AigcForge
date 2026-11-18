# Delegation 执行边界（2026-10-20）

当前已交付持久准入和查询。完整执行、恢复、task 消费者和客户端流程仍开放，Owner 为主智能体，解除条件见 [技术债账本](../technical-debt.md)。本报告是主智能体源码审查，不是失败子智能体完成的独立复核。

## 已确认的共同根因

`SubagentJob.start` (`packages/core/src/session/subagent-job.ts:59`) 在 `Session.resume` 后，从最后 20 条消息取最后一个完成的 assistant。这适用于既有单个子任务摘要，但不足以为长命 participant 的多次 Delivery 归属结果。

`SessionExecution` 的 `settled` (`packages/core/src/session/execution.ts:128`) 一次覆盖全部合并 drain，不能为每次 queued Delivery 单独结算。Idle 仍是 busy-period marker。`SessionInbox.promote` (`packages/core/src/session/inbox.ts:496`) 投递输入并返回数量；输入本身的 ID 与 metadata 已保留于 inbox 和 message。投影序号定义输入和 assistant 的顺序，不需要再给 drain 创建持久身份。

不可从 provider finish 猜 continuation。真实判断是 `SessionStep.attempt` (`packages/core/src/session/runner/step.ts:285`)：agent step limit 禁用工具时，即使 provider 要求工具也会停止。当前 `session.step.ended` (`packages/schema/src/session-event.ts:355`) 和 projected Assistant 未持有该运行策略结果。只读取现有 finish/Idle 无法可靠区分同一 busy period 内的多个结果边界。

## 方案对冲

| 方案                                                                           | 代价与结论                                                                                                                                           |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 在 Delegation watcher 中按 Job 完成或最后 assistant 结算                       | 代码少，但多个 queued 输入可误用最后结果；中间投递已成功而后续失败时也会丢失成功结果。属于明确业务错误，不采用。                                     |
| 为每个 drain 创建结果表、输入 ID 列表和执行循环                                | 增加第二套执行身份；输入关系本可由 Session 顺序决定，违反 durable event 极简规则。不采用。                                                           |
| Session 持久化实际 continuation 判断，按 authoritative transcript 解析输入结果 | 复用既有 Step 事件和 message projection。新增不可推导事实，关系按 Session 有序 transcript 决定；旧历史缺该事实时明确未验证，不推断成功。选择此方向。 |

后续 Session-owned 查询应以确切 inbox/message ID 开始，在完整 projected transcript 中找到第一个确实停止 continuation 的成功 assistant；retry partial、tool continuation 与其他 queued 输入不能冒充该结果。失败/人为中断按既有 execution/Idle 事实结算；shutdown 保留未完成语义。结果文本仍从 Session 读取，Delegation 仅记录有界 summary 和引用。

## 执行与恢复约束

1. Turn/fanout commit 后，将完整 prompt 和必填 `{ turnID, deliveryOrigin, senderParticipantID }` 来源写入唯一目标 Session inbox。首准入幂等按当前 V2 Session 契约执行。
2. participant 内部 child 必须保留父 Session、project、workspace、directory、mode 所有权，由 `DelegationService.requireBinding` (`packages/core/src/delegation/service.ts:226`) 决定。`context: fork` 应复用真实 history fork 并保持 child 关系，不能绑定现有 root fork 冒充 child。
3. 执行继续使用既有 SessionExecution 与 Job。独立 Delivery 结算监听 Session 自有结果事实，而不是整个 busy period 的终态。
4. 冷启动先核对 target pending input、visible input 和结果。外部 `resumeThread` capability 与 child claim 都不能独自证明未知副作用可重放。无法证明时保持 recovery_required。
5. close 先停止准入，interrupt 保留 pending inbox；缺失目标按领域契约幂等处理；Permission 仍为工具最终授权边界，review 不授予 Permission。

本报告对应 `8723a4021` 检查点，当时未修改 Session 结果协议、数据库或 runner。随后 [Session 输入结果切片](v2-session-input-result-2026-10-20.md) 已交付所选查询及多 queue、steer、重试、step limit、失败和 shutdown 回归；Delegation execution 生产消费者仍待接入。
