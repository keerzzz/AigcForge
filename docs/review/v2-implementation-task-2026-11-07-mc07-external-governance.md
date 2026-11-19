# MC07 外部只读 reviewer 与 completion：正式实施任务

2026-11-07 最新闭环：**MC07 已按正式范围完成，MC08 W1 工程已签收，下一片为 MC08 W2。** [MC07 最终接受](/home/keer/.codex/outputs/2026-11-07/mc07-external-runtime-root-v5/root-final-acceptance.json)串联 R1/R2、no_code_change、来源冲突、fanout 与外部治理。最后一轮真实链完成同 child 的 R1 拒绝→R2 批准、粘性拒绝拦截、明确撤回、fresh complete/archive 和完整父消费；14 请求＝父8/内部4/外部2，均完整HTTP200。原 runner/controller exit1 源于三项错误验收前提，保留原记录；同次离线尾段12项检查exit0及独审通过，未增加模型请求或应用启动。自有资源已关闭，Source/Rust native 数字退出仍unknown，未执行的末尾GET/截图由同次DB、Tool正文、父wire和归档证据覆盖，见[运行接受](/home/keer/.codex/outputs/2026-11-07/mc07-external-runtime-root-v5/root-runtime-acceptance.json)。

累计 MC07 模型59＝父35/内部22/外部2，Native预留19，预留与实际启动分开记账。`MC07Complete=true`、`MC08W1EngineeringAccepted=true`、`MC08Complete=false`。MC08 接续 W2普通Meta/Task入口→J1不同模型Judge→R1仲裁/摘要/share/通知→A1真实闭环，随后 MC04b→MC09→MC10。通用capture、未知副作用与恢复债务按原owner继续。下方保留此前时点记录。

2026-11-07 最新运行交接：v4在应用启动前因Root六份状态文档漏重绑停止，真实启动和请求均0，见 [Root结算](/home/keer/.codex/outputs/2026-11-07/mc07-external-runtime-root-v4/root-runtime-v4-prelaunch-acceptance.json)。MC07累计模型45、Native预留18；本片工程接受和真实待验状态保持。MC08 W1工程已签收，后继按其原合同继续。下方为此前运行和原实施合同。

2026-11-07 当前交接：本片工程已由 [Root 接受](/home/keer/.codex/outputs/2026-11-07/mc07-external-governance-engineering-v1/root-engineering-acceptance.json)，工程会话已停写。真实 v1 的清单解析已修复；v2 首请求上游500，v3 首请求200 SSE在300秒整场景窗口内未完成并由同次清理取消，见 [v3 结算](/home/keer/.codex/outputs/2026-11-07/mc07-external-runtime-root-v3/root-runtime-v3-incomplete-acceptance.json)。本片真实主链仍开，累计MC07请求45、Native预留17。Root 已准备最小等待合同修订，同时按内部结果链的实际依赖派发 [MC08 W1 两文件工程](/home/keer/workspace/aigcfroge-v2/docs/review/v2-implementation-task-2026-11-07-mc08-w1-workflow-handoff.md)；该派发不关闭本片。下文保留原工程合同。

2026-11-07。监督 Root 依据既有自主实施委托派发本片；本任务与 dispatch.json 共同生效。工程写入和串行检查限于下方白名单，真实产品运行由 Root 在工程通过后安排有限任务。工程会话使用 **gpt-6.1-sol / max**，一位 writer 同时独占串行工程检查槽。实际仓 /home/keer/workspace/aigcfroge-v2，默认仓 /home/keer/workspace/aigcfroge 只读；保留分支、全部 WIP、staged/unstaged 和文件模式。

前序状态：

| 前序           | 当前状态与依据                                                                                                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| no_code_change | 工程及真实用户链已接受：[Root 最终接受](/home/keer/.codex/outputs/2026-11-07/mc07-no-code-change-runtime-root-v2/root-final-acceptance.json)。                                                                                             |
| source 单因素  | 工程已接受：[Root 最终接受](/home/keer/.codex/outputs/2026-11-07/mc07-source-conflict-engineering-v1/root-final-acceptance.json)。                                                                                                         |
| fanout         | 原工程与真实链已通过：复用两次已完成 Task，以新 Turn 完成 Build 成功/General 声明故障、显式 close、完整父消费和同次退出。依据：[Root 最终接受](/home/keer/.codex/outputs/2026-11-07/mc07-fanout-tail-root-v1/root-final-acceptance.json)。 |

MC07 整体保持开放，本片是其当前剩余主链。[fanout 文档闭环](/home/keer/.codex/outputs/2026-11-07/mc07-fanout-final-docs-v1/root-document-closure.json)已完成。派发与检查槽见本目录 dispatch.json；六文件 before 复用 before.json，并由 before-reconfirmed.json 确認字节、模式和 WIP 未变。交付写入 /home/keer/.codex/outputs/2026-11-07/mc07-external-governance-engineering-v1。

按第一性原理推进：Stage A 与未变化的已接受证据直接复用；只验证真实修改及原任务要求的用户链。模型已能看到的输入与 owning boundary 校验一次。不要添加没有实际风险条目或失败证据的重复比较、失败后自动业务关闭或新门槛；不得为适配验收脚本增加无业务用途的模型请求。子智能体负责只读定位与独审，单一实施者持有生产写入及串行检查槽。

## 目标、依据与最小方案

目标链：**内部 Build 实际 R1 → 真实外部 Codex 只读 typed rejection → 同内部 child 修复 R2 → 同 external reviewer/thread 新 Turn approval → 显式撤回 sticky rejection → fresh barrier complete/archive → 完整父消费**。审阅必须绑定原 revision、真实 native identity/source 和持久完整结果，才能用于完成治理。

复用 [Stage A 报告](/home/keer/.codex/outputs/2026-11-07/mc07-external-governance-stage-a-v1/report.md)、[已审提示词](/home/keer/.codex/outputs/2026-11-07/mc07-external-governance-stage-a-v1/prompt.md)、[独审](/home/keer/.codex/outputs/2026-11-07/mc07-external-governance-stage-a-v1/review.md)、[Root 候选接受](/home/keer/.codex/outputs/2026-11-07/mc07-external-governance-stage-a-v1/root-candidate-acceptance.json)与 [Schema 范围补充](/home/keer/.codex/outputs/2026-11-07/mc07-external-governance-stage-a-v1/schema-scope-addendum.md)。原合同是专项 [§5.6/§6.C](/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/2026-10-29-meta-cpu-closure-plan.md:217)和 [MC07 提示词](/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/2026-11-05-meta-next-session-prompts.md:246)。下述源码行号沿 Stage A 接缝索引；Root 与实施者在正式 before 上重绑，旧行号/SHA 不替代当前 WIP。

选择四个 Core 接缝的定点实现，复用原内部 capture、External/Binding、Job、parser、pure barrier 与结果持久化。Schema 补充指出类型限制在 Core 私有 Governance/RecordReviewInput；公共 Schema/事件、Protocol、Server、generated 增量为 0。四文件实现仍须类型与行为证据。通用 artifact/外部 implementer 产物提取的技术债沿原 owner/unlock 保留；本片不引入通用 artifact 层。

首读本仓 CLAUDE.md 第一性原理、AGENTS.md、ARCHITECTURE.md、docs/testing.md、specs/v2/session.md、specs/v2/tools.md 和适用子目录 AGENTS；Effect 修改读 [.aigcfroge/skills/effect/SKILL.md](/home/keer/workspace/aigcfroge-v2/.aigcfroge/skills/effect/SKILL.md)。定点回读已有 owner/消费者，不重做全仓调查、不建索引或安装。保留 [MC06 原支持范围](/home/keer/.codex/outputs/2026-11-06/mc06-r4/root-mc06-supported-scope-decision.json)及原取消、steer/queue、普通 attended、冷读全文与恢复合同。

## 精确白名单

| 文件                                                                                                                      | 必要差额                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [tool/plugin/task.ts](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/plugin/task.ts:183)                        | 正式 foreground external review：现 execution_type=external-cli、cli_target/subagent_type=codex、intent=review、attended=false、实际 D/revision_digest；取得当前内部 revision/reference，通过 read 权限后路由 reviewer、准入 review Turn。complete/archive 只接纳具可信 proof 的本链；显式 retract_rejection 沿原 task_reconcile 权限与 active participant 匹配合同，不追加 review proof 门槛。 |
| [delegation/execution.ts](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/execution.ts:1651)               | 在原 dispatchExternal/Job/锁与结算内绑定 reviewer/revision，读取真实完成全文、解析现 envelope、持久可信 typed 结果并记录 review；live/wait/原恢复入口消费同一结果。保留原取消、Scope 清理和通知 owner。                                                                                                                                                                                         |
| [delegation/service.ts](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/service.ts:301)                    | 保留内部 producer/RevisionReference；Core 私有 review receipt/proof 接纳真实 External 分支。proofFor/recordReview 校对原完成绑定、source/attempt/native identity/digest；close/complete/archive 仅放行受支持且 proof 吻合的 roster，沿原 fresh barrier。                                                                                                                                        |
| [delegation/receipt.ts](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/receipt.ts:23)                     | 原 External/Binding/key/matches 内表达审阅引用和持久 typed 结算，供 Task metadata、完整前台结果和冷读消费；External thread/turn 与内部 child/input 保持真实身份。私有字段由正式任务/实现冻结。                                                                                                                                                                                                  |
| [meta-agent-integration.test.ts](/home/keer/workspace/aigcfroge-v2/packages/core/test/meta-agent-integration.test.ts:251) | 主 keeper：复用 mc07Build、实际 Task/Session/DB/Bus/FileAccess/Git 与原 app-server 夹具，覆盖 producer→review→repair/copy→撤回→complete/父消费。                                                                                                                                                                                                                                                |
| [delegation-service.test.ts](/home/keer/workspace/aigcfroge-v2/packages/core/test/delegation-service.test.ts:1)           | 仅补主链不能直接覆盖的 owning proof、旧无证明 review、来源冲突或完成拒绝 keeper。                                                                                                                                                                                                                                                                                                               |

四生产是接缝白名单，不要求逐文件新增代码。review/fold/digest、Session/Job/FileAccess、CliAdapter/codex-app-server、公共 API/generated、其余测试及仓内文档只读。工程仓/默认仓 Git 写、安装、构建生成和现用服务/用户 DB 操作均 0；测试的私有 tmpdir seed/empty commit 仅复用已有 fixture。必要越界先交决定函数、实际失败与最小差额，由 Root 重分配。

## 原来源与决定函数

1. 先从内部完成 Task、capture、Service.revision 读取 R1 的 receipt/source、repository/path/Location、commit/base/target/full normalized diff。实际外部请求保存 R1 引用与读到的产物证据；对照 capture 的字节，不能以路径名或模型复述 digest 证明已审 R1。read deny/拒绝确认时无 review 准入/native 启动或批准。
2. 原 [External/Binding/key/matches](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/receipt.ts:151) 和 externalCall 校对 parent Session/Location/Meta/D/participant/Turn、origin/sender/attempt、父 Task claim、确切 tool messageID/callID/source、真实 thread/turn。同 thread 复审必须是新 Turn/source；已完成回读保留原 receipt/result。
3. 完整结果经现 [ReviewEnvelope](/home/keer/workspace/aigcfroge-v2/packages/schema/src/delegation.ts:120) 校对 digest/verdict/findings；缺失、malformed、wrong digest 保持 invalid。4096 字符摘要不能提供全文 proof。可信结算先于父 Tool.Success；禁止等待自身尚未发布的成功记录、手种事件/SQL/成功 metadata、影子 child/SessionInputResult 或旁路 reviewer。
4. [proofFor/recordReview](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/service.ts:301) 以原完成 native binding 和持久结果裁决；旧无 proof review 不因删除外部守卫取得完成资格。迟到、取消、unknown 和临时全文读失败保留原事实/成功 producer，不重放未知工作。
5. [copyable](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/review.ts:20)、[isReviewEffectiveForRevision](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/review.ts:190)、[evaluateReviewBarrier/canComplete](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/review.ts:78) 继续决定 copy、最新有效 review 与完成。R2 rework 新审；no_change/no_code_change 只继承原批准有效性，原 External receipt/digest/source 不变；formatting_only 维持原保守规则。
6. 原 [retractRejection](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/service.ts:1261) 匹配 active rejectionParticipantID，走 task_reconcile；complete 走 task_close＋task_archive。typed verdict 不产生 grant 或自动撤回。保留 execution.close 锁内计划、锁外 Job/Scope 收口及 cleanup 后 fresh barrier；native archiveThread 的实际配置/thread/回执与失败须留存。

## 用户链与验收

fixture 为已有已跟踪文本 artifact.txt：初始 base 换行，R1 为 base 换行 r1 换行，R2 为 base 换行 r2 换行。D、digest、child、participant、thread/turn、receipt/source 均取原真实结果，不预写成功身份。

| 动作                                                               | 直接验收证据                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1 内部 Build 完成 R1                                              | 实际 write/capture 与完整父 Tool 消费先于 reviewer 准入；记录原 D、implementer/child、revision 与 source。                                                                                                                                                                                      |
| U2 外部只读审 R1，typed rejected                                   | foreground、attended=false，实际 readOnly/networkAccess=false；原完整 review envelope 绑定 R1，blocking finding 要求末行 r1 改 r2并保留 base。reviewer/review Turn、真实 native identity、可信 typed proof/全文进入父；sticky rejection 保持。                                                  |
| U3 同 implementer/child 修 R2，同 reviewer/thread 新 Turn approved | 原 R1 findings/全文进入修复输入；R2 rework 有实际新 digest/producer/source，同 reviewer/thread 新 native Turn 精确审 R2，完整 approval 回父。                                                                                                                                                   |
| U4 尝试 complete                                                   | R2 approval 已有效，sticky rejection 仍使 completion 拒绝；原拒绝、失败理由、状态可消费，无 RejectionRetracted/Completed/Archived 或新 grant。                                                                                                                                                  |
| U5 明确 retract_rejection                                          | 匹配实际 active rejectionParticipantID，保留理由及 task_reconcile 许可/拒绝确认事实；拒绝确认/错误 participant 不撤回，R1 历史保留。                                                                                                                                                            |
| copy 增量，归档前                                                  | 同 child/D 的 no_change 与已接受 no_code_change 私有空提交链核 producer/commit 来源和原批准有效性；不另启 reviewer、不造新 receipt/review 事件；与 rework 主链分账。                                                                                                                            |
| U6 fresh completion/archive/完整父消费                             | task_close/task_archive 当前权限；cleanup 后再验 fresh barrier，Completed/Archived/archivedFrom 与原 source/时间真实持久，原完整 complete 结果进入后续父请求。逐请求核对模型实际收到的正文和下一步所需身份，不能把持久 Tool metadata 当模型可见正文；活动/未完成新 Turn 不能借旧 barrier 完成。 |

最小新增边界证据：缺/坏/wrong digest、一次 source/native identity 冲突、超过摘要上限的完整 envelope 冷读、父 Tool.Success 前结算、旧无 proof review 完成拒绝。复用相同 keeper，不扩全故障矩阵。外部局部失败/取消/迟到/unknown 保留准确状态、原成功和完整消费者；归档错误/unavailable 不冒充成功。

## 工程与交付

正式派发后：重新绑定 before → 真实 RED → 必要最小接线 → focused GREEN → 一次受影响回归 → Core 类型 → 定向静态 → 非写者只读独审 → 最终字节。每个生产修复有直接失败证据；配置/权限/夹具错误单列，不修改源码造 RED、不复制算法或新增 test-only 生产 seam。用 Deferred/Bus/llm.wait/pollWithTimeout readiness，不固定 sleep 等并发。

cwd /home/keer/workspace/aigcfroge-v2/packages/core，按 [已审提示词的检查表](/home/keer/.codex/outputs/2026-11-07/mc07-external-governance-stage-a-v1/prompt.md) 使用包 wrapper：

    /home/keer/workspace/aigcfroge-v2/script/bun run test test/meta-agent-integration.test.ts test/delegation-service.test.ts --test-name-pattern 'MC07 external governance' --timeout 30000
    /home/keer/workspace/aigcfroge-v2/script/bun run test test/delegation-execution.test.ts test/delegation-service.test.ts test/meta-agent-integration.test.ts test/tool-task.test.ts test/delegation-review.test.ts --timeout 30000
    /home/keer/workspace/aigcfroge-v2/script/bun run typecheck

随后仅已安装 prettier/oxlint、两套 ast-grep、git diff --check，目标为实际白名单改动；命令与 cwd 沿已审提示词，由同一 owner 串行运行。不根 test、不裸 bun test、不 tsc；通过后没有变化/失败不扩跑。保存 command/cwd/exit/tally/stdout/stderr/源码身份，失败/green/warning/skip 分开，重叠 tally 不相加。

交 before/after、最小 delta、模式/WIP 身份、原 RED 与各轮收据、上述验收逐项证据、只读独审及最终字节。源码推演、受控 adapter/TestLLM、确定性工程与真实产品证据分别标注；受控 app-server 不取得真实 Codex 信用。Root 单写仓内文档/唯一账本，保留外部 completion、V2-C-DELEGATION/LIFE、通用 capture 等原 owner/unlock；本片必交缺口须登记。

工程接受后，Root 另冻隔离 Native 实际入口、内部 Build 产物、真实 Codex 同 thread 两次只读审阅、R2/copy、权限、模型/CLI/Native/Source 有限额度、完整父消费与 owned cleanup。本稿不推导或转借运行额度。必要用户链/资源证据齐备后才签收本片实交范围，MC07 整体仍由 Root 裁决。

本片复用已审 Stage A；正式执行从已确认的 before 字节开始。签收依据是四处原 owner 的最小接线、实际测试结果和明确用户链，不以新增文件、报告或检查数量计算完成。

2026-11-07 Root 澄清：原 Stage A 的 U5 允许当前权限下明确撤回匹配 participant 的拒绝；review proof 决定审阅记录与完成/归档资格。四文件表曾将两者统称为“治理命令”，现按原合同明确区分。缺少 settlement 不单独成为禁止明确撤回的理由，缺 proof 的完成/归档仍由原 owning boundary 拒绝。此澄清只消除新增撤回门槛，权限、来源与完成规则保持原定义。
