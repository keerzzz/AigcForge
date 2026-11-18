# MC08 W2 正式实施任务：普通 Meta 的正式 Workflow Task

2026-11-07 本片工程与W1/W2共用真实链已由[Root闭环签收](/home/keer/.codex/outputs/2026-11-07/mc08-w2-runtime-root-v1/root-final-acceptance.json)：4次Flash/high请求完成A→B、完整1346 code points原Tool正文的父消费及同次退出。工程合同和此前记录保留如下。

2026-11-07 工程已由[Root签收](/home/keer/.codex/outputs/2026-11-07/mc08-w2-engineering-v1/root-engineering-acceptance.json)，实施者已停写并归还检查槽。真实消费者待本片有限运行；原工程任务合同与范围修订保留如下。

2026-11-07。**Root delegated decision：依据用户已授予的实施、分节新建聊天和监督委托，正式派发本片工程。** MC07已闭环，MC08 W1工程已签收；本任务与本轮 dispatch.json 绑定八个生产文件、必要测试、一次Core迁移和串行检查槽。工程模型 `gpt-6.1-sol / max`。工程真实模型、Source、Native及产品Codex启动预算均为0，工程通过后由Root接续有限真实验证。

目标仓 `/home/keer/workspace/aigcfroge-v2`。工程开始时使用 Root 下发的当时 WIP before，保留分支、staged/unstaged、未跟踪文件和文件模式。W1 工程已由 Root 签收；复用它的正文、质量、producing source 和限额，不把旧 Stage A HEAD/hash 当当前基线。仓内文档和唯一账本由 Root 单写。

先读目标仓当前 AGENTS、ARCHITECTURE、Core/test AGENTS、docs/testing、Session/Tool 规格与实际使用的 Effect/数据库技能。设计依据为 [冻结归属 note](/home/keer/.codex/outputs/2026-11-07/mc08-w2-stage-a-v1/design-note.md) 和 [父 Task/source note](/home/keer/.codex/outputs/2026-11-07/mc08-w2-stage-a-v1/task-binding-note.md)；本提示词采用已修订的发布 StepInput 合同。

**为什么做。** 当前 Task 没有 Workflow 选择分支，WorkflowExecution.root 只接受冻结 Custom root。普通 Work 中已选 Meta 的用户不能通过一次正式 Task 准入并消费冻结 Workflow 的结果。W2 要接通现 owner：用户选择发布定义／输入 → 原 Task 创建或 claim → owning WorkflowRun 冻结准入 → 原 Workflow children/step Tasks → 原父 Task 结算 → 下一父模型请求消费完整 Tool 正文。

**第一性选择。** 摘要不能还原正文，逐 run 的选择也不能由父 Session 的单份 snapshot 承担。完整现 SnapshotV2 和不可变 Task/source 放在现 run 行，同次提交后执行；真实 child 取得该冻结值供原 Context 消费。更广的后台交付、registry、统一调度或第二份正文存储均不是本接缝所需。本片采用现 owner 内的实现，不提出无测量的性能／ROI 改善。

## 已固定的入口、输入与身份合同

1. **只增加普通 Work 中已选 Meta 统筹的正式 Task Workflow 分支。** 以真实父 Session、实际 invocation Context 和原 root controller 判定已选 Meta；模型填写 `subagent_type` 或其它字符串不能授予 Meta 身份。Build/Plan 的原 Task 路径保持原行为；Workflow 请求不为它们补挂 Meta、创建假 Meta root 或改 mode。父 Session 的 Agent、mode 和 snapshot 保持原绑定，真实 workflow-kind children 继承父 mode。
2. Task 的有限 Workflow 分支使用现 `Composition.CompositionInput` 和**可选** `expectedPlanDigest`，沿既有 [StartInput](/home/keer/workspace/aigcfroge-v2/packages/schema/src/composition.ts:451)/[UpgradeInput](/home/keer/workspace/aigcfroge-v2/packages/schema/src/composition.ts:460) 合同：提供时核对冻结 `snapshot.digest`；省略时由 owning freezer 产生并冻结该 digest。temporary 指定带 revision 的 WorkflowRef、AgentRefs、bindings；profile 指定 profilePath/profileRevision。新请求用原 CompositionResolver.freeze，省略 FreezeInput.sessionID，要求确有合法 Workflow，并保留原资产 ref/revision、graph、Agent/binding 和权限校验。不要求模型计算／猜 hash，不为此新增 preview Tool。
3. **输入采用已发布 `WorkflowInfo.steps[].input`，使用现 `WorkflowAsset.StepInput` codec，随完整 snapshot 固定。** StepInput 是 `Record<string, Json>`，缺省 `{}`。`Task.prompt` 不隐式覆盖步骤输入。原需求未要求运行时变量或逐步 override；此扩展不作为当前债务或退出门槛。
4. Source 只取实际 Context：`{ type: "tool", messageID: context.messageID, id: context.id }`，Session identity 取 context.sessionID。parentTaskID/revision 只取原 Task owner 创建／claim 的返回值。它们不由模型输入、自然语言或 step Task 推导。
5. 新 Workflow Task 固定为 foreground，使用稳定 request key，可用现 computeDigest 从实际 Session/source 导出。同 key 精确重试先读原 run 及不可变绑定；不得重新 append/claim 父 Task、重读资产或重新 freeze。输入指纹、来源或显式 linked Task 不匹配时沿原 typed conflict 路径失败。显式新调用有自己的 source/Task 绑定；不能把旧已完成 Tool source 无条件复制给新调用。

源码依据：[CompositionInput/FreezeInput](/home/keer/workspace/aigcfroge-v2/packages/schema/src/composition.ts:142)、[StepInput](/home/keer/workspace/aigcfroge-v2/packages/schema/src/workflow-asset.ts:162)、[freeze](/home/keer/workspace/aigcfroge-v2/packages/core/src/composition-resolver.ts:672)、[Task source](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/plugin/task.ts:182)。[computeCompositionDigest](/home/keer/workspace/aigcfroge-v2/packages/core/src/composition/digest.ts:40) 只散列 CompositionInput；snapshot.digest 继续表示选择输入指纹，不改成完整正文哈希。

## owning run、原 Task CAS 与冻结消费者

1. 在原 Workflow Session keyed lock 的准入段先查旧 request。新请求复用 TaskTool 的 linked ownership／scheduled 拒绝、SessionTask.append/patch，取得真实父 Task id/revision，再在原 getOrCreate 的事件事务内一次写 run、steps 和两个 nullable 私有列。`frozen_snapshot` 保存完整现 Composition.SnapshotV2；`task_binding` 使用局部私有 codec，保存 `parentTaskID`、`parentTaskRevision`、完整实际 Tool source。Session ownership 由 run.session_id 决定。
2. 新 foreground run 必须两列齐全；不能提交只有摘要或只有来源的半份准入。requestDigest 保留选择输入指纹／workflowRevision，并加入不可变父 Task id/revision/source。私有读取用现 SnapshotV2 codec，校验 owning Session、行中摘要／workflowRevision 与冻结值。公开 WorkflowRunInfo 继续由原 rowToRunInfo 投影，不因这两列扩公有 Protocol/Client。
3. run/steps/冻结列/绑定事务成功后才 wake。Task 已创建／claim 而 run 准入失败时，沿 TaskTool 已有 failed 回写及 expect/expectedRevision 处理，不启动 worker。不能遗留 in_progress Task 后只抛一个 Tool 错误。
4. **准入和 wake 后释放父 Session Workflow mutex，再等原 Workflow wait/Job。** executeStep 也需要同一键；持锁等 Job 会堵住 worker。不得等父 Session idle、父模型消费 handoff、或 join 正被此 Tool 阻塞的父 drain。正式 Tool 等待中断时取消 owning run，保留已完成 step 与原 cleanup／interruption 行为。
5. worker 从 owning run 的冻结 Agent/executor/bindings 选择。复用 Session 创建 commit 给真实 child 保存同一冻结 data；该消费副本保持不变，不反向更新 run。SessionComposition 复用原依赖、Agent 和 binding 判定；SessionContext 为实际 workflow-kind child 使用现 frozen 消费路径。原 Meta 来源校验也必须以 owning run 的冻结池决定目标，并继续核 run/step/child/input 的真实对应。
6. retry lineage 继承原冻结定义／步骤输入；resume/reconcile/终态结果读取取 owning run，资产变化或删除不重新绑定当前内容。新的正式 Task retry 使用其自己的实际调用绑定；精确原调用重试复用原绑定和已结算结果，不重新执行父 Task 完成回写。
7. 旧 Custom run 两列 null 时，继续使用已有 Session snapshot；摘要／workflowRevision 必须精确匹配，并通过原依赖校验。迁移不把当前资产填为历史正文。缺冻结正文的普通 run 保留缺失／不可恢复语义；存下定义和来源不授予 unknown provider 工作自动重放权限。保留原 retained-events 拒绝、权限和 cleanup 规则；新 Work 分支按真实 mode 使用现 ProductModePolicy，不能用开启全局 Custom/实验配置替代接线。

决定函数：[getOrCreate](/home/keer/workspace/aigcfroge-v2/packages/core/src/workflow/workflow-run.ts:385)、[run/steps 事件事务](/home/keer/workspace/aigcfroge-v2/packages/core/src/workflow/workflow-run.ts:424)、[rowToRunInfo](/home/keer/workspace/aigcfroge-v2/packages/core/src/workflow/workflow-run.ts:249)、[SessionTask.append](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/task.ts:667)、[原 Task CAS](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/task.ts:997)、[Task 准入失败回写](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/plugin/task.ts:908)、[executeStep 锁](/home/keer/workspace/aigcfroge-v2/packages/core/src/workflow/execution.ts:562)、[run 准入锁](/home/keer/workspace/aigcfroge-v2/packages/core/src/workflow/execution.ts:949)、[Job wait](/home/keer/workspace/aigcfroge-v2/packages/core/src/workflow/execution.ts:1042)。

## 终态、父 Task 结算与唯一正文出口

- run 到终态后，以准入时的父 Task id/revision 和原 expect/CAS 结算。completed/partial_success 对应 Task completed，cancelled 对应 cancelled，failed/recovery_required 对应 failed；正文始终保留真实 run.status、失败类别和已完成部分，partial_success 不能改写为完整成功。CAS 返回未更新时，不能声称父 Task 已完成回写或覆盖用户的新修改。
- 复用 W1 的实际 child/input 结果读取、scanner、quality、producing step/input/child source 和结构完整的 12000 code-point 包。加入实际 run/父 Task/Tool source 后一并参加该总限额，保留 `<workflow_result>` 的合法 JSON、omittedSteps 和截断质量。原来源进入正文数据，不能进入 System/Instructions 或成为 Permission grant。
- **有 task_binding 的 foreground run：完整正文只走原 Tool content/result。** 所有 terminal/cancel/resume/reconcile 路径由持久绑定选择该出口，不准入第二份 synthetic User 正文，也不因 Workflow 完成另 wake 正被此 Tool 等待的父 drain。Job 结束后返回 W1 同一结果包；原 Tool 成功事件/source 是交付收据。InternalOutput 已允许缺省 delegationID；不得伪造 Delegation、单一 child receipt，或用额外 Task 包装突破 W1 总限额。
- **无 task_binding 的旧 Custom run：** 保留原 handoffID、SessionNotification.inspect、first-admission-wins、admit-only 与 advisory wake。已消费、取消、revert 的 handoff 不重发或覆盖。两路选择不使用仅存内存的开关；原 wait 的 synthetic 收据错误检查只适用于此通知路线。
- 真正父消费证据是原 history codec 生成的下一 provider 请求内，匹配原 Tool call 的完整结果正文、质量和来源。run 202、Task metadata、digest、marker 或 unread notification 均不能替代它。

依据：[Task InternalOutput](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/plugin/task.ts:104)、[response helper](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/plugin/task.ts:969)、[W1 handoff 结果构造](/home/keer/workspace/aigcfroge-v2/packages/core/src/workflow/execution.ts:383)、[旧 synthetic 准入](/home/keer/workspace/aigcfroge-v2/packages/core/src/workflow/execution.ts:477)、[SessionNotification.inspect](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/notification.ts:11)。

## 精确生产接缝、类型位置与生成产物

两 note 已证明的 **7 个生产主接缝**与下方第8个共享来源接缝，均已由Root正式绑定：

| 文件 | 必要变化 |
| --- | --- |
| [tool/plugin/task.ts](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/plugin/task.ts:36) | 有限正式 Workflow 输入分支、已选 Meta 判定、实际 Context source、原 Task link/失败路径、完整 Tool 结果。 |
| [workflow/sql.ts](/home/keer/workspace/aigcfroge-v2/packages/core/src/workflow/sql.ts:6) | 在现 run 行增加 frozen_snapshot 和 task_binding 两个 nullable 列。 |
| [workflow/workflow-run.ts](/home/keer/workspace/aigcfroge-v2/packages/core/src/workflow/workflow-run.ts:385) | owning request lookup、私有 codec/读取、完整 requestDigest/冲突、同次准入与 retry 继承。 |
| [workflow/execution.ts](/home/keer/workspace/aigcfroge-v2/packages/core/src/workflow/execution.ts:183) | 正式 Task 准入、释放锁后等待、run 冻结消费、Task CAS、W1 单出口和原取消／Custom 兼容。 |
| [session.ts](/home/keer/workspace/aigcfroge-v2/packages/core/src/session.ts:702) | 原创建/采用路径保存并核对真实 Workflow child 的 run 冻结副本，保留父 mode/Agent。 |
| [session/composition.ts](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/composition.ts:434) | 复用原冻结依赖、Agent/binding 选择判定，使消费可以明确指向 owning run 值。 |
| [session/context.ts](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/context.ts:176) | 实际 Work Workflow child 的模型/提示/工具/Skill 采用现 frozen 路线，普通父继续现路线。 |

**第8个已正式绑定的共享来源判定接缝：** [meta-agent/service.ts:332](/home/keer/workspace/aigcfroge-v2/packages/core/src/meta-agent/service.ts:332) 的 assertChildSource workflow 分支虽然核真实 run/step/child/input，仍无条件 `compositions.selectAgent(parent.id, step.agent_id)`。普通父没有该 Session snapshot，仅改上述七文件不能完成这处原校验。应在同一原判定内使用 owning run 冻结池；不要把 SessionComposition.selectAgent 改成依赖隐式跨 run 猜选。此项有源码依据，与七个主接缝同次实施。

**Session.create 的类型位置已核实：** [CreateInput](/home/keer/workspace/aigcfroge-v2/packages/core/src/session.ts:162)、[Interface.create](/home/keer/workspace/aigcfroge-v2/packages/core/src/session.ts:266)、[create 实现](/home/keer/workspace/aigcfroge-v2/packages/core/src/session.ts:672) 均在同一 session.ts。为真实 child 增加冻结输入须同步这里的本地类型／接口；现 SnapshotV2、WorkflowControllerSource、Selection 可复用，不自动新增公共 Schema 文件。若工程实际需要其它类型差额，给出使用该类型的决定函数及精确路径让 Root 重绑，不能漏报或预先扩大 Protocol/Client。

两个 run 列 **合并正式生成一次 Core 迁移**。从 [Core migration script](/home/keer/workspace/aigcfroge-v2/packages/core/package.json:20)、[migration 参数/产物](/home/keer/workspace/aigcfroge-v2/packages/core/script/migration.ts:9)、[generate](/home/keer/workspace/aigcfroge-v2/packages/core/script/migration.ts:29) 定点确认：新模块生成在 [database/migration](/home/keer/workspace/aigcfroge-v2/packages/core/src/database/migration)，同步 [migration.gen.ts](/home/keer/workspace/aigcfroge-v2/packages/core/src/database/migration.gen.ts)、[schema.gen.ts](/home/keer/workspace/aigcfroge-v2/packages/core/src/database/schema.gen.ts)、[core/schema.json](/home/keer/workspace/aigcfroge-v2/packages/core/schema.json)。不预造迁移时间戳或手改生成文件。正式生成／一致性命令如下，cwd 必须为 `/home/keer/workspace/aigcfroge-v2/packages/core`：

```bash
/home/keer/workspace/aigcfroge-v2/script/bun run migration --name workflow-task
/home/keer/workspace/aigcfroge-v2/script/bun run migration --check
```

## 最小 keeper 与验收

复用既有 keeper，只增加本接缝断言；新测试名统一含 `MC08 W2`，不建立新观察框架或复制算法。

1. [meta-agent-integration.test.ts](/home/keer/workspace/aigcfroge-v2/packages/core/test/meta-agent-integration.test.ts)：真实普通 Work/已选 Meta → 正式 Task → 发布 A→B→END。证明父 mode/Agent/snapshot 保持原绑定，run/父 Task/Tool source 持久对应，真实 children 使用冻结 StepInput/Agent 配置，下一父 provider 请求逐字消费 W1 全文、quality 和 producing source。不是 HTTP 准入或手种 run 的替代链。
2. [workflow-run-events.test.ts](/home/keer/workspace/aigcfroge-v2/packages/core/test/workflow-run-events.test.ts)：run/steps/两列同次准入，未 commit 不 wake；精确请求复用原 Task/run/冻结值，不同输入/source/linked Task 明确冲突；失败重试继承定义；资产改变／删除后精确重试不重读。run 准入失败的父 Task 沿原 failed/CAS 路径且无 worker。
3. [workflow-execution.test.ts](/home/keer/workspace/aigcfroge-v2/packages/core/test/workflow-execution.test.ts)：锁释放后 Job 可推进；foreground 的 terminal/cancel/resume/reconcile 仅 Tool 正文出口；部分失败／中断保留真实已完成部分、原质量和 source；旧 Custom 的通知/取消/revert 不复活。改动共享构造后，只重验受影响 W1 限额／兼容组。
4. [tool-task.test.ts](/home/keer/workspace/aigcfroge-v2/packages/core/test/tool-task.test.ts)：非 Meta 的 Build/Plan Workflow 请求没有挂 Meta 或改 mode，原 Task 行为与权限保留；外 Session linked Task、scheduled ownership、Task CAS 失配、准入失败及正式等待中断走实际边界。
5. [session-composition.test.ts](/home/keer/workspace/aigcfroge-v2/packages/core/test/session-composition.test.ts) 与 [meta-agent-service.test.ts](/home/keer/workspace/aigcfroge-v2/packages/core/test/meta-agent-service.test.ts)：仅补 run 冻结 child 读取／采用与原来源判定接缝；外 run/step/child/input 或错误冻结 Agent 拒绝，原 Custom selector 保持。能由上述真实集成 keeper 覆盖的断言不重复写。

**候选 RED 尚未执行。** 当前正式 Task 无此分支，Workflow root 拒普通 Work，Context/Meta 来源判定仍读父 Session；先新增真实最小 keeper 取得当前源码 RED，分开记录夹具／依赖失败。流程为 Root 当前 before → 实测 RED → 必要修复和一次迁移生成 → focused GREEN → 一次受影响回归 → Core typecheck/迁移一致性/实际白名单静态检查 → 非写者复审及 Root 冻结。既有通过组没有新源码、失败或未决风险时不重复跑。

下列包命令基于 [test wrapper](/home/keer/workspace/aigcfroge-v2/packages/core/script/test.ts:37) 与 [script/bun](/home/keer/workspace/aigcfroge-v2/script/bun:4)。受影响回归限定实际命中且focused尚未覆盖的原 Custom handoff／冻结 selector 保护；下列模式作为候选，执行者按实际增量收窄后合并为至多一次回归。cwd 同上：

```bash
/home/keer/workspace/aigcfroge-v2/script/bun run test test/meta-agent-integration.test.ts test/workflow-run-events.test.ts test/workflow-execution.test.ts test/tool-task.test.ts test/session-composition.test.ts test/meta-agent-service.test.ts --test-name-pattern 'MC08 W2' --timeout 30000
/home/keer/workspace/aigcfroge-v2/script/bun run test test/workflow-execution.test.ts test/session-composition.test.ts --test-name-pattern 'executes serial children|MC08 workflow handoff|selects frozen root|persists, reads, and copies|handoff|cancel' --timeout 30000
/home/keer/workspace/aigcfroge-v2/script/bun run typecheck
```

Root 按实际增量白名单绑定 prettier、oxlint、现 ast-grep/Effect 规则及 git diff --check；生成产物随同一次改动核验。测试按包运行，使用现 wrapper；工程writer持有串行检查槽。仓内状态文档由Root维护。

## 实际产品消费者与交回

未来真实运行拓扑只限本接缝：新隔离普通 Work/已选 Meta 的原 User → P1 正式 Workflow Task（已发布定义、StepInput，可选 expectedPlanDigest）→ A/B 真实 Workflow children/step Tasks → owning run 终态／父 Task CAS → P2 的原 Tool result 全文/quality/source 消费 → 原 owned cleanup。实际模型、route/variant、各角色请求上限、Native/Source、隔离 Home/库/端口由 Root 后续明确；不借 MC07/W1 额度或从外部 HTTP 造 run。工程接受后由Root按既有委托安排本片有限真实验证。

交付当前 before/after、精确最小 delta、生成器产物、command/cwd/exit/tally、原失败与修复、实际父请求 Tool 消费证据及非写者复审。关系结论引用决定函数 file:line；行为只由执行工件授予“已验证”，未执行的部分单列。Root 只签收本 W2 接缝；原 J1/R1/A1 与恢复／规模继续原合同，不新增未请求 override 的门槛。交回 Root 后停写，不自行派发、运行后继或发送其它聊天消息。

## 本轮执行分工与检查绑定

- 当前 before 与 dispatch 位于 `/home/keer/.codex/outputs/2026-11-07/mc08-w2-engineering-v1`。实施者写源码/测试并串行执行检查；可并行调用只读子智能体做精确消费者核对与完成后独审。子智能体不写仓、不跑重检查。工程聊天可用的并发由实际工具决定，不为凑人数等待。
- 六个候选测试文件均准入写入白名单，只改实际缺口涉及的文件。无需每文件新增测试。focused 命令按本片新增测试执行；如focused未覆盖受影响原路径，按上列既有模式收窄后补一次回归，必要原Task/Meta路径合并同轮并说明依据；已通过且源码未变的组直接复用。
- 静态检查用已安装 Prettier/oxlint 对实际改动TS文件执行；main AST 与 Effect AST 使用现 `script/ast-grep/sgconfig.yml` 和 `script/ast-grep/effect-simplifications/sgconfig.yml`，只扫实际改动生产文件。Core typecheck、migration --check 和最终diff空白检查各一次；失败修复后只补对应检查。
- W1的原权限keeper在当前依赖下缺 `aigcfroge_worktree_remove`，已在 `mc08-w1-engineering-v1/baseline-gap.json`留证。先复用该基线结论；若本片未改变相关路径，不以此扩改registry或要求全绿重跑。
- 按需防御：校验放在实际Task输入、持久run解码、权限和Task CAS边界。边界已收窄的类型直接使用。不要让模型提供系统已能生成的hash、另造preview Tool、追加无消费者的抽象或重新审核已接受MC07。
- 每次进展以实际缺口/实现/测试结果说明；遇范围外问题将证据回传Root，同时推进独立部分。提交完整工程交接后停写并归还检查槽；不要自行运行后继或新增真实请求。

## Root 补充接线裁定（2026-11-07）

只读子智能体与Root已核实另两处真实消费者：`tool/plugin/skill.ts:58`对非Custom取live Skill，`permission.ts:194 configured`仅Custom取冻结Agent。普通Work的真实workflow child需使用本run冻结Skill正文及所选Agent权限，否则与本片已定冻结合同冲突。现将这两个生产文件及`test/tool-skill.test.ts`加入写入/静态白名单，补充before见同目录`scope-addition-01.json`；此补充覆盖上方八文件数量描述。

沿现SessionComposition和真实workflow来源接线，保持Work的ProductModePolicy、每次Permission判定及普通父会话来源。没有权限等级或默认策略变更。最小验证加入现W2集成链/Skill keeper；共用串行检查，不另开全权限测试矩阵。

Root补充接线裁定02：`plugin/internal.ts`的services与requirements是内置插件实际可用依赖的决定处。green-main-01已证明新Task即使在Root存在WorkflowExecution.node时仍取不到该服务。将此原文件加入写入/静态范围，在现列表提供WorkflowExecution.Service/node并由Task沿原依赖机制获取；不新增注册表或执行器。补充before见`scope-addition-02.json`，验证仍用本轮同一正式Task集成keeper。
