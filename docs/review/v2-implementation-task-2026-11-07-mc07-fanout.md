# MC07 fanout 正式实施任务

2026-11-07：**MC07 fanout 已闭环。** [Root 最终接受](/home/keer/.codex/outputs/2026-11-07/mc07-fanout-tail-root-v1/root-final-acceptance.json)串联原工程、两次真实 Task roster 和两请求尾链：同一新 Turn 双目标，Build 完整成功保留，General 在声明的发布前故障后准确 failed；旧取消 Turn/输入保留。公开查询、显式 close、完整 14777 字节 Native User 的父消费及同次清理通过。D 为 closing、两 participant closed，符合本故障场景关闭合同。controller/runner、Electron/gateway 均 exit0；Source 已结束、端口释放，数字 exit 仍 unknown。本次 Build→Meta 两请求均完整200，累计 MC07 模型43（父25/子18）、Native预留14；原失败和旧余额按各收据保留。`FanoutComplete=true`、`MC07Complete=false`。MC07 当前仅余外部只读 reviewer/completion 主链，随后按 MC08→MC04b→MC09→MC10 推进；下方记录按历史时点理解。

2026-11-07：**MC07 fanout v1 在网关启动身份校验处停止，真实链待续。** [Root 失败结算](/home/keer/.codex/outputs/2026-11-07/mc07-fanout-runtime-root-v1/root-runtime-v1-failure-acceptance.json)记录 `OwnedGatewayRequired`、runner/controller exit1；本轮模型0、Native/Source各1。原父User在清理期间准入inbox，仍pending、未promote，Task/Delegation均0；原“未准入”推断已按只读DB纠正，输入保留且不重放。Electron/gateway exit0，Source已结束、数字exit unknown，三端口释放。累计MC07模型请求仍30（父17/child13），Native预留7。下一v2仅恢复已验收的“网关就绪后取进程身份”顺序，并保持Native请求拦截至窗口关闭；3次无网络本地实验复现早读参数缺失、就绪后3次通过，原失败具体tuple仍unknown。v2候选7模型/Native1/Source1，当前运行授权0。source补证与fanout工程接受保持，`FanoutRuntimeAccepted=false`、`MC07Complete=false`。下方为此前时点记录。

2026-11-07：**MC07 fanout 工程已签收，真实用户链待验。** [Root 工程接受](/home/keer/.codex/outputs/2026-11-07/mc07-fanout-engineering-v1/root-engineering-acceptance.json)与[独立复审](/home/keer/.codex/outputs/2026-11-07/mc07-fanout-engineering-v1/independent-review.md)覆盖原五项工程合同：同聚合准入、第二失败结算、已完成正文保留、可信新 pending 补偿及显式 reconcile/close。仅改 Delegation execution 和既有测试；最终 focused 4/0/72、Core 类型/定向静态通过，一次四文件回归222/0/2391；测试版本差额、失败和AST fallback分别保留。准备失败保留child/binding并由原owner显式close，不称跨Session回滚。执行会话 `01a1b31f-d36b-7310-aa74-9fad74e004c8` 已停止写入，检查槽归还监督Root。

真实候选复用公开SDK的一次同Turn双target appendTurn、原Session确切结果查询、新Native父User完整消费和显式SDK close；两次普通Task只建立本次roster。候选7个DeepSeek Flash/high请求（父4/Build2/General1）、Native/Source各1，当前运行授权0。[准备裁定](/home/keer/.codex/outputs/2026-11-07/mc07-fanout-runtime-root-v1/prepare-dispatch.json)由Root在既有人类委托下作出，最终包仍须冻结/检查/复审/签发。`FanoutEngineeringAccepted=true`、`FanoutRuntimeAccepted=false`、`FanoutComplete=false`、`MC07Complete=false`。

no_code_change/R1/R2原接受保持；source和外部reviewer候选已独审，沿前序依赖等待派发。[MC08阶段A资料](/home/keer/.codex/outputs/2026-11-07/mc08-stage-a-v1/root-stage-a-acceptance.json)已由Root签收准备，Workflow正文首片与后续普通Meta/Task触发、实际多模型Judge、仲裁/摘要分享保持完整目标，生产尚未派发。后续MC04b/MC09/MC10及原owner/unlock保持。下方为历史时点记录。

2026-11-07：监督 Root 在 no_code_change 最终签收和本提示词独审后正式派发。你是本片唯一工程实施者，模型 **gpt-6.1-sol / max**；实际仓 `/home/keer/workspace/aigcfroge-v2`，默认 `/home/keer/workspace/aigcfroge` 只读。保留当前分支、全部 WIP、staged/unstaged 与文件模式。

**派发绑定：**

- no_code_change 最终接受：[no_code_change 最终接受](/home/keer/.codex/outputs/2026-11-07/mc07-no-code-change-runtime-root-v2/root-final-acceptance.json)。
- 本片正式派发、两文件 before 与检查槽：[Root 派发](/home/keer/.codex/outputs/2026-11-07/mc07-fanout-engineering-v1/dispatch.json)、[两文件 before](/home/keer/.codex/outputs/2026-11-07/mc07-fanout-engineering-v1/before-files.json)；承接新会话 Root 独占工程写入/检查槽。
- 工程交付目录：`/home/keer/.codex/outputs/2026-11-07/mc07-fanout-engineering-v1`。

**本任务在监督 Root 发出的新会话派发消息与 dispatch.json 同时存在后生效。** 仅下列两文件工程范围生效，生产修改须有本片真实 RED；已满足的合同复用既有通过证据。当前 MC07 整体继续开放，真实 Source/Native/Codex/产品模型预算均 0。

## 首读、原合同与复用

读本仓 CLAUDE.md 当前检查点与第一性原理及规范主体（旧流水按引用取证）、AGENTS.md、ARCHITECTURE.md、docs/testing.md、specs/v2/session.md、specs/v2/tools.md、适用子目录 AGENTS；Effect 修改读 `.aigcfroge/skills/effect/SKILL.md`。复用 [阶段 A](/home/keer/.codex/outputs/2026-11-07/mc07-fanout-stage-a-v1/report.md)、原 [V2-C-FANOUT](/home/keer/workspace/aigcfroge-v2/docs/technical-debt.md:13)和专项 [§5.6/6.C/9](/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/2026-10-29-meta-cpu-closure-plan.md:217)。阶段 A 定位已充分，不重做全仓调查；以 no_code_change 已接受字节重新绑定 before/行号，不能用 HEAD 替代 WIP。Codegraph 无索引时用 rg/精确读取，不建索引或安装。

Root 已确认 §5.6 是原合同：全目标类型/权限/来源/既有绑定前置失败不产生新输入；同 Delegation 的 Turn＋Delivery 原子提交；提交后独立结算 failed/partial/recovery，保留成功与未知事实，可逆未执行资源由原 owner 补偿，unknown 不重放。保留 V2-C-FANOUT 条目；旧全额回滚表述限定于前置与同 Delegation 原子准入。跨 Session 更强原子语义仅在确有需求时另行设计，不是本片必交却延期的项目。

一个实施者串行检查；只读子审不能写入、运行检查或启动服务。Root 只读监督、最终签收并单写仓内文档/唯一账本。范围内修复直接推进；必要越界回传决定函数与最小差额，不扩大故障矩阵、Schema/事件/表、registry 或模型循环。

## 精确白名单：1 生产＋1 测试

| 文件                                                                                                                  | 必要差额                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [execution.ts](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/execution.ts:1044)                      | 仅真实 RED 后修原 dispatch/dispatchCall 的后提交失败结算与本次可逆资源收口。复用 ownsChild/findInput、recordDelivery、Session.cancelInbox、settle/recover、Job.cancel/completeBackground、store.release；保留原稳定 delivery/input/attempt/source、权限和锁顺序。不得以整体 close 自动抹掉另一目标的工作。 |
| [delegation-execution.test.ts](/home/keer/workspace/aigcfroge-v2/packages/core/test/delegation-execution.test.ts:961) | 复用 setup、实际 Session/Bus/DB/Job/TestLLM 与现有 readiness。补 `MC07 fanout` 的第二目标准入故障见证，扩现有准备失败/资源收口断言；完成下列五项，已有等价 keeper直接复用。                                                                                                                                |

Service/Bus/Session/Job、task/fold/review、公共 API/generated、其余测试与仓内文档只读。已有同聚合原子 keeper、MC05 独立失败、unknown 与 close 路径通过时不新增生产代码。工程仓/默认仓 Git 写、安装升级、构建生成及现用服务/用户库操作均禁用；测试只用现有私有 Session/DB fixture。

## 五项验收与可信 RED→GREEN

| 原合同                   | 必须交付的直接证据                                                                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 前置失败与同聚合原子准入 | 复用现 Custom 全池/既有 binding 校验，以及 Service 首通知完整 fanout、后项 projector 失败全回滚 keeper。无新目标输入/执行/观察任务；已存在状态保持。提交后准备失败保留已创建 child/binding，明确其实际收口，不能冒充前置回滚。                                      |
| 第二目标准入失败         | 使用真实第二 Session InboxEnqueued 失败 projector，先证明父 Turn/Delivery 与第一输入已提交；保存原错误、全部稳定 inputID/source、pending/visible/result、Delivery 状态与 Job/notification。失败目标准确 failed/cancelled/recovery，不滞留为伪成功或无法解释的等待。 |
| 已执行成功保留           | 复用 MC05 已接受 keeper；补偿路径还须核第一目标已产生实际完整结果时，第二故障不改其 receipt/正文/attempt、不重放。用现有 Deferred/readiness 控制同一切口，暂停放在第二 publication 之前，避免持有同库事务而阻塞第一结果提交。                                       |
| 可逆 pending 补偿        | 用原 owning serialized 边界证明本次输入仍 pending、来源匹配且未执行，才取消；保留 Enqueued/Cancelled 等历史。核本次 inbox、结果观察 Job/notification、执行 claim 收口；共享旧 Job、活动 child、异主输入和已完成结果保持。不能由未 wake 推断未执行。                 |
| 显式 reconcile           | 经现 execution.close/retry/fork 的实际决定路径和原归属/权限，回读持久结果与资源。unknown 保留 recovery/历史，不自动 retry；reconcileResume 返回 0 不算补偿或执行成功。原结果、来源、已完成部分与关闭后的准确状态可消费。                                            |

先在 no_code_change 接受后的生产代码上取得真实 RED：第二故障晚于第一准入，观察具体不满足上述合同的状态。准备/权限/夹具失败单列；不为造 RED 破坏源码。最小修复后 focused GREEN 必须经过实际实现；新故障主链的成败/receipt 由真实 owner 产生，不手种事件或 SQL 冒充 producer。既有 unknown/保留历史 fixture 沿原信用复用，不复制幂等/结算算法、不加 test-only 生产 seam。

取消与检查跨真实 Session 边界时，以 owning input 状态决定补偿；visible/processing/已执行或证据不足保留并准确结算/显式 reconcile。沿原锁内规划、锁外 Job Scope 清理，保留原 cause/interruption。使用 Deferred/Bus/llm.wait/pollWithTimeout，不固定 sleep。所有已列合同均由当前或可追溯已接受证据覆盖，才能申请整片签收；仅无泄漏不够。

## 串行工程检查

Root 正式派发后依次：RED→必要最小修复→focused GREEN→一次受影响回归→Core 类型→定向静态。cwd `/home/keer/workspace/aigcfroge-v2/packages/core`，走包 wrapper：

```bash
/home/keer/workspace/aigcfroge-v2/script/bun run test test/delegation-execution.test.ts --test-name-pattern 'MC07 fanout' --timeout 30000
/home/keer/workspace/aigcfroge-v2/script/bun run test test/delegation-execution.test.ts test/delegation-service.test.ts test/meta-agent-integration.test.ts test/tool-task.test.ts --timeout 30000
/home/keer/workspace/aigcfroge-v2/script/bun run typecheck
```

cwd `/home/keer/workspace/aigcfroge-v2`，仅已安装定向工具：

```bash
node_modules/.bin/prettier --check packages/core/src/delegation/execution.ts packages/core/test/delegation-execution.test.ts
node_modules/.bin/oxlint packages/core/src/delegation/execution.ts packages/core/test/delegation-execution.test.ts
node_modules/.bin/ast-grep scan -c script/ast-grep/sgconfig.yml packages/core/src/delegation/execution.ts
node_modules/.bin/ast-grep scan -c script/ast-grep/effect-simplifications/sgconfig.yml --off=unused-suppression packages/core/src/delegation/execution.ts
git diff --check -- packages/core/src/delegation/execution.ts packages/core/test/delegation-execution.test.ts
```

逐轮保存 command/cwd/exit/tally、stdout/stderr、源码身份，失败/green/warning/skip 分开，重叠 tally 不相加。不根 test、不裸 bun test、不 tsc；检查通过后无新变化或失败不扩大/重跑。

## 交付、真实验收与关闭标准

交两文件 before/after（含 WIP/模式）、最小 delta、逐轮收据、原失败、一次非写者只读复核，以及五项合同各自的实际证据；关系结论引用决定函数 file:line。已有实现满足的项只交验证。遗漏项登记原 V2-C-FANOUT owner/unlock，由 Root 同步唯一账本；不另建债务账本。

最小未来用户链：新隔离 Meta Root/Delegation 与两个实际独立内部 participant，沿现有 owned `delegation.appendTurn` 进入同 Turn fanout；保留第一真实成功，第二触发 Root 冻结的合法故障，实际结果/状态经原查询或通知交父完整消费，再显式原 reconcile/close 收口。当前 Task 每次只准入一个 participant，两次单目标调用不冒充一次 fanout。Root 须先绑定实际用户入口、故障触发、结果消费者和同次清理，再按真实路径推导并独立授权必要请求；本候选不给数值预算、不借旧槽。

当前真实 Source/Native/Codex/产品模型预算均 **0**，不启动、探活、重试、换模型或准备/运行真实 harness。工程五项通过后只申请工程接受；Root 完成独审、源/依赖冻结和上述有限真实消费者验收后，方可按 §5.6 标记本片 fanout 完成。任一五项或真实消费/收口缺证据时保持本片开放并登记具体 owner/unlock。MC07 其它原余项保持，不能由本片关闭 MC07 整体。

本任务复用阶段 A 及其独立复审，正式执行从当前 before 字节开始；报告如实区分既有通过、新检查与真实运行。

前序闭环文档已同步：[七文档闭环收据](/home/keer/.codex/outputs/2026-11-07/mc07-no-code-change-final-docs-v1/root-document-closure.json)。
