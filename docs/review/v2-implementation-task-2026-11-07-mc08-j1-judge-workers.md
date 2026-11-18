# MC08 J1 正式实施任务：指定不同模型的 Judge workers，无仲裁

2026-11-07 工程已由[Root签收](/home/keer/.codex/outputs/2026-11-07/mc08-j1-engineering-v1/root-engineering-acceptance.json)，四文件源码冻结，检查槽已归还。完整父消费者、Core类型、受影响回归及最终独审通过；真实J1消费者待Root的有限运行，原工程任务与范围修订保留如下。

2026-11-07。**Root delegated decision：沿既有人类委托，正式授权本片三文件工程及串行检查；由 Root 创建执行聊天后开始。** 工程模型 `gpt-6.1-sol / max`，目标仓 `/home/keer/workspace/aigcfroge-v2`，参考仓 `/home/keer/workspace/aigcfroge` 只读。MC07 已闭环，W1/W2 工程及同次四请求真实链已通过，controller/runner exit0且资源已关闭，见[同次收据](/home/keer/.codex/outputs/2026-11-07/mc08-w2-runtime-root-v1/evidence/controller-receipt-v1.json)。普通 Work 的实际模式 ID 是 `work`。本片绑定[当前三文件 before](/home/keer/.codex/outputs/2026-11-07/mc08-j1-engineering-v1/before.json)，分支 `v2-dev`、HEAD `9e2c6577ef6dd65c8f01ff94d46da0142bcb877c`；保留全部 WIP、文件模式和 index。产品模型请求、Native、Source、gateway、产品 Codex 启动预算均为 0；工程结束后由 Root 另签有限真实包。

依据复用 [阶段 A J1/F1–F5](/home/keer/.codex/outputs/2026-11-07/mc08-stage-a-v1/judge-results-evidence.md:129)、[本次身份决定](/home/keer/.codex/outputs/2026-11-07/mc08-j1-dispatch-prepare-v1/decision-note.md) 与 [原候选独审](/home/keer/.codex/outputs/2026-11-07/mc08-j1-dispatch-prepare-v1/independent-review.md)。当前 Task／测试字节参考 [W2 最终模式 after 清单](/home/keer/.codex/outputs/2026-11-07/mc08-w2-mode-correction-v1/after.json) 的 `path`、`afterSha256`、`mode` 及下表快照；J1 当前字节已绑定到本片 before.json，修改前只核对本片三文件。原 08:57:32 UTC before 和独审记录保留为历史证据。正式工程先读当时 AGENTS、Core/test AGENTS、Effect/数据库指南；保留 WIP、staging 和文件模式，仓内文档／账本由 Root 单写。

**目标。** 普通 Work 中已选 Meta 通过一次正式 `Task(execution_type="judge")` 指定不同实际模型 → 同一固定输入 → 现 Delegation/child/SessionRunner 执行 → 原精确 receipt/result → 下一父请求消费全部 worker 正文、模型与来源；输出明确 `arbitration:"none"`。J1 不进行仲裁、AI 摘要或 share，R1 后继保持。Judge 不是 MC07 typed revision review 的批准权，不把 worker 的“approved”文本变成治理授权。

## 输入、解析与真实执行身份

1. 使用现 Task 的 `judge_models` 与真实 `subagent_type`，沿原 Model.Ref 解析；Judge 列表是 worker 的明确模型选择，单个 `input.model` 不被解释成仲裁模型。普通 Task/external-cli、W2 Workflow 分支和已选 Meta 的身份保持；Build/Plan 不补挂 Meta或改 mode。
2. 在任何 Task/D/child/input/wake 前，取现模型服务 available() 的可用集合，解析全部指定 refs/variant，并由现 ModelResolver 解析实际模型。缺失、不可用或 variant 错误沿原 typed failure，无默认回落。ModelResolver 返回的 catalog ref 用于现 ExecutorBinding；其实际 runtime provider/API model 身份用于本片不同模型合同和结果 readback。调用者不需要提交或猜内部 canonical 值。仅 variant 或相同实际 route 的目录别名不获得“不同模型”信用。
3. Task.prompt 在本次调用内固定一次，作为所有 Judge 的同一输入；不得按模型偷偷摘要、替换或丢弃正文。完整 MC08 链使用 W1/W2 实际结果正文作为该输入，来源按实际 producing receipt/Tool Context 记录；不把 W2 发布 StepInput 的合同改成动态 override。
4. 每个模型调用现 `DelegationService.resolve({newDelegation:true,...})`，创建一个真实 `internal/reviewer/fresh` participant，绑定该模型的现 ExecutorBinding。保留同一个真实 Agent也可完成双模型 Judge；不改去重、不虚构 Agent/role/context、不预建假 child。原 DelegationExecution.dispatch 创建／绑定 child、准入 input并 wake，原 wait 读取其准确结果；不新增 registry、调度器、child-prepare 层或模型循环。

依据：[当前 Task 的 Judge 拒绝](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/plugin/task.ts:749)、[ModelResolver](/home/keer/workspace/aigcfroge-v2/packages/core/src/model-resolver.ts:110)、[participant 身份比较](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/service.ts:780)、[fresh D](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/service.ts:1497)、[原 dispatch](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/execution.ts:1044)。Judge 拒绝仍存在于已接受的 W2 Task 字节；J1 复用其最终 Input/Output、Workflow 分支及 Task/source 处理。

## Task 关联、等待与单次父结果

- 复用原 Task 创建／linked claim、权限、scheduled 拒绝和 CAS，建立代表整次调用的 aggregate Task。每 worker 用现 SessionTask.append 建 Task，原 `parentID` 指向 aggregate.id；不新增 Task 层级 Schema或新表。每个原 dispatch 的 TaskLink 使用该 worker Task 的 id/revision、实际 Context source、`background:false`，由原 writeback 独立结算。aggregate 不交给某一个 worker 的 writeback。
- 现 Tool progress/结果 metadata 记录 aggregate id、worker Task.id 与 delegation/participant/turn/child/input/attempt；worker 输入的 metadata.task.parentTaskID 指自身 Task，metadata.task.source 取 `{type:"tool",messageID:context.messageID,id:context.id}`。身份由现 owner 返回，不让模型填写。
- 全部配置先解析、身份准备后再派发；全部 workers 派发后独立等待精确 receipts，不以 Turn.partially_completed 或首个完成结果作为整批结束。等待不持父锁，不等父模型 idle/消费，不 sleep/poll。等待中断只取消本调用 owning workers，保留完成结果、原 Task状态和 receipt，不重放 provider工作。
- 每 worker 独立呈现 requested ref、实际 binding/route readback、Task/receipt source、status、完整 text和 provider finish事实。模型失败不抹掉成功 sibling，不用 bounded summary/outputDigest替代全文，不把失败的 Assistant partial 原文当成功。所有 receipts 结算后以原 aggregate revision/CAS结算；CAS 未更新时不声称已写回。
- 正式 Tool 一次返回局部 Judge 结果包：aggregate Task、实际 Tool source、同一输入身份、`arbitration:"none"` 和 workers 全部结果。沿原 Tool content/history codec进入下一父 provider请求；不伪造一个共同 child/delegationID，不额外准入 synthetic 正文或仲裁 wake。metadata/marker不能替代正文消费。
- 原 Tool输出体积／敏感内容处理继续使用现 owner。完整／截断／不可用和 finish 事实按实际结果表达；只有正文实际完整进入父请求才给全文消费信用。不新增 provider输出 token上限、通用质量框架或摘要模型。

现关系依据：[Task.parentID](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/task.ts:33)、[原写入](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/task.ts:796)、[worker TaskLink](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/execution.ts:91)、[单 delivery writeback](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/execution.ts:762)、[精确 wait](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/execution.ts:817)。

## 最小文件与 W2 增量接缝

| 候选文件 | 本片范围 |
| --- | --- |
| [当前 task.ts](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/plugin/task.ts)（[已接受快照](/home/keer/.codex/outputs/2026-11-07/mc08-w2-mode-correction-v1/after/packages/core/src/tool/plugin/task.ts)） | Judge 列表 preflight、现 Task/D dispatch/receipt 组合、局部 typed output和完整 Tool消费。**增量接缝：保留 W2 最终 Input/Output union、Workflow 分支、Work guard、Task/source/结果 helper。** |
| [当前 tool-task.test.ts](/home/keer/workspace/aigcfroge-v2/packages/core/test/tool-task.test.ts)（[已接受快照](/home/keer/.codex/outputs/2026-11-07/mc08-w2-mode-correction-v1/after/packages/core/test/tool-task.test.ts)） | 正式 Judge strongest keeper：模型/身份/Task.parentID/失败/取消与无仲裁；在已接受的实际 Work keeper 上合并增量。 |
| [当前 meta-agent-integration.test.ts](/home/keer/workspace/aigcfroge-v2/packages/core/test/meta-agent-integration.test.ts)（[已接受快照](/home/keer/.codex/outputs/2026-11-07/mc08-w2-mode-correction-v1/after/packages/core/test/meta-agent-integration.test.ts)） | 原 Meta正式调用与真实下一父请求的全文/source断言；保留已接受的 W2 实际 Work keeper，再合并 J1 增量。 |

现 DelegationService/Execution、SessionTask、ModelResolver 是复用 owner；本推荐不需要修改它们的去重或存储，也没有已证明的 J1 SQL/migration/公共 Protocol/Client差额。若主 keeper 出现确切原owner缺口，提交决定函数和最小差额供 Root绑定，不能预先扩仓或建新层。

## 必要验证和后续派发

- RED：正式 Task 用已选 Meta、同一真实 Agent、两个明确实际模型调用 judge；正式派发时绑定的 before 中 Judge 拒绝分支使成功断言失败。只登记实际执行的 RED，夹具／依赖失败单列。
- GREEN：两份真实 D/participant/child/worker Task，均有 `workerTask.parentID = aggregateTask.id`；同一输入、不同实际请求模型、精确 receipts；aggregate在全部结算前未完成；下一父请求逐字消费两份正文、真实source和明确无仲裁。
- 风险驱动负例仅限已有证据：第二模型missing/variant错误或同实际route→零新执行；旧绑定换模型→原绑定冲突；单 worker失败／中断→独立状态、成功 sibling保留、无默认回落／仲裁；聚合 Task CAS冲突不覆盖新修改。沿现 readiness/Bus/Job，不复制实现到测试。

候选 focused命令，未来 cwd `/home/keer/workspace/aigcfroge-v2/packages/core`：

```bash
/home/keer/workspace/aigcfroge-v2/script/bun run test test/tool-task.test.ts test/meta-agent-integration.test.ts --test-name-pattern 'MC08 J1' --timeout 30000
/home/keer/workspace/aigcfroge-v2/script/bun run typecheck
```

受影响的原 keeper/静态检查只按真实增量补一次，不重跑 MC07或无改动的 W1/W2组。W1/W2 共用真实验收通过后，Root 以届时 Task／测试字节绑定 before，创建 `gpt-6.1-sol / max` 工程聊天并派发三文件范围及串行检查槽；正式 dispatch 前本材料仍为候选。J1 真实运行另绑定父 Meta、两种实际 Judge 模型/route/variant 和有限请求配置。无仲裁角色或预算，不借前片余额。

交付当前 before/after、最小delta、命令/cwd/exit/tally、失败原因、逐 worker receipt/模型/Task关联和实际父 Tool请求全文证据。此片只签收 J1，无仲裁不形成新门槛；R1仲裁／摘要／share和原MC08最终退出保持。交付 Root 后停止继续写入并归还串行检查槽。

## 执行分工与交接

执行聊天主智能体是本片唯一源码实施者；可用只读子智能体核 owner 与独立复审，测试和类型检查由主智能体串行执行。Root 负责仓内文档、账本及最终签收。交付写入 `/home/keer/.codex/outputs/2026-11-07/mc08-j1-engineering-v1`，包含工程短交接、before/after、最小 delta、实际检查收据及独审。既有绿色检查复用，变更或实际失败才补对应验证。

## 2026-11-07 必要 owner 接线差额

Root 已根据运行注册失败和同处类型错误，签发[最小范围修订](/home/keer/.codex/outputs/2026-11-07/mc08-j1-engineering-v1/root-scope-delta-v1.json)。在原三文件外，仅增加 `packages/core/src/plugin/internal.ts`：导入现有 Database，并加入原 `services` 注入列表；既有 layer graph 确需时才补同一 `Database.node`。此变更供 Task 复用 `SessionInputResult.read` 的精确 finish 事实，不新增服务或存储。实施者继续单独写入与串行检查，产品运行预算仍为0。
