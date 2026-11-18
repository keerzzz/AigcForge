# MC07-R2 阶段 B 正式实施任务

2026-11-07：**MC07-R2 已按正式范围闭环，MC07 整体继续开放。** [Root 最终签收](/home/keer/.codex/outputs/2026-11-07/mc07-r2-root-review-v1/root-final-acceptance.json)串联真实 R1 拒绝、同 child 的 R2 修复、当前 typed approval、固定 HEAD 的 no_change、显式撤回拒绝，以及 fresh barrier 下的 complete/归档与完整父消费。工程接受和各轮真实证据分别记账。

最终收尾实际为 2 个 DeepSeek Flash/high 请求、1 次 complete、task_close/task_archive 两次精确 once204；893 字符完整结果进入第二父请求。新增 Closing、两个 ParticipantClosed、Completed、Archived 共 5 事件，原 6 Task/6 Turn/6 settlement、2 child 及历史保留。本次六动作全成功，controller/runner、Electron/gateway 退出 0，自有 Source 已结束、三端口释放；Source 数字退出仍 unknown。累计 Source20（父12/child8）、Native4；此前两轮验收器失败及旧余额按原收据保留。

`MC07R2Complete=true`，`MC07Complete=false`。下一片为真实 no_code_change producer/copy，按 Root 独立正式任务推进；fanout、source 单因素冲突、外部 artifact completion 及 MC08→MC04b→MC09→MC10 继续原 owner/unlock，见[唯一债务账本](/home/keer/workspace/aigcfroge-v2/docs/technical-debt.md)。以下保留各轮历史记录。

2026-11-07：监督 Root 根据既有人类自主推进委托，完成阶段 A 与独立复核后正式派发。执行会话 `01a1b1da-ec08-71b1-a4e6-d167259da56f`，模型 **gpt-6.1-sol / max**。

现在授权本文件列明的 **3 个生产文件与 2 个测试文件**，一名实施者负责；该会话主智能体独占本片串行测试、类型和定向静态检查槽。只读子智能体可以审查和建议，不能并行修改或运行检查。监督 Root 本阶段只读监控并最终签收。

Root 已落实独审的两项修正：complete 在同一 Task 边界、同 source/resource 先取得 task_close 与 task_archive 两项现有权限；删除 Task 的提前 canComplete，完成准入由 Service.close 的现有 mutation lock 决定，清理后由原 Service.complete 重验并回读真实 archivedFrom。

工程交付目录 `/home/keer/.codex/outputs/2026-11-07/mc07-r2-engineering-v1` 已保存五文件 before（含全部旧 WIP 与原文件模式），身份以其中 dispatch.json 与 before-files.json 为准。新增 tests/修改 tests先取得可信 RED，再做最小实现、focused green、一次受影响组、Core typecheck与定向检查。临时 fixture 内沿既有测试初始化/提交基准允许；实际工程仓与默认仓的 Git 写、安装升级、构建、生成、用户服务接管仍无授权。真实 Source/Native/Codex/模型运行预算为 0。

范围内常规修复直接推进；只有必要变更超出白名单或改变本文合同才向监督 Root 回传具体证据。不要转向泛化框架、重复验收已签收片或寻求人类重复批准。源码/依赖未冻结前不准备真实运行。完成后交回 before/after、最小 delta、逐轮 command/cwd/exit/tally、失败记录、一次非写者代码复核及未交付 owner/unlock；Root另行签收和安排有限真实包。

以下为已修订、冻结的阶段 A 合同正文；其中阶段 A 的“尚未运行”记录保留其时点，工程写入与检查按上方本次派发生效。精确合同保持固定HEAD下真实R2/no_change、独立来源与close→complete；真实no_code_change和fanout仍是后继原任务，不据本片宣称MC07完成。

---

# MC07-R2 阶段 B 精确实施任务候选

状态：`candidate-awaiting-root-review-and-dispatch`。本文件由阶段 A 只读准备产生；生产/测试写入、工程检查和真实运行尚未授权。监督 Root 保管检查槽。执行与只读子智能体按派发使用 `gpt-6.1-sol / max`。

## 1. 目标与前置

复用已接受的 R1：在原 implementer/child 追加修复输入，生产真实 R2；新输入无改动时合法复用原内容 revision，分别保留原 producer 与新调用 receipt/source；消费当前 typed review、明确撤销 sticky rejection；在 fresh barrier 通过后经原 close、complete、archive，并把准确结果交给父模型。

R1 前置已正式闭环，见 [Root 最终接受](/home/keer/.codex/outputs/2026-11-07/mc07-r1-root-closeout-v1/root-final-acceptance.json)，SHA256 `5599bd306650ac0fbc2a00b51e0293731e4977c999d2803379601be573bc0e1a`：`MC07R1Complete=true`、`MC07Complete=false`；原六次真实请求已结算，余额 0。R1 原 runner/controller exit 1、Source 数字 exit unknown 与后继同次补验 exit 0 分开保留。

实际工程仓 `/home/keer/workspace/aigcfroge-v2`，HEAD `9e2c6577ef6dd65c8f01ff94d46da0142bcb877c`，分支 `v2-dev`。默认 `/home/keer/workspace/aigcfroge` 只读。逐文件 before、模式与 R1 after 比较由 [source-pins.json](/home/keer/.codex/outputs/2026-11-07/mc07-r2-stage-a-v1/source-pins.json) 固定；不能以 HEAD 替代含 WIP 的 before 字节。

本片选择固定 HEAD、单一 regular tracked UTF-8 路径的有限实现。实际捕获范围是 `no_change/rework`；`no_code_change` 的真实 producer/copy 沿原 artifact owner 留待后继。不得据本片宣布整个 MC07 完成。

## 2. 精确文件白名单候选

Root 必须在正式派发中确认这五个文件；本候选不授权编辑。

| 实际文件 | 决定函数及必要变化 |
| --- | --- |
| [execution.ts](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/execution.ts:75) | `ArtifactBaseline:75`、`TaskLink:90`、`prepareArtifact:318`、`captureArtifact:367`、`govern:521`、`dispatch:1099`：冻结可信 previous、相对 previous 分类、保留精确重入及原 settlement；`close` 接口 `:206`、实现 `:2707` 透传私有完成意图。 |
| [service.ts](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/service.ts:42) | `RevisionReference:42`、`Governance:61`、`proofFor:298`、`revision:375`、`recordRevision:968`：读出原 proof、分别比较原 producer 与新 input、有限同 digest 复用；`recordReview:1035` 仅适配既有 proof read 结果；`close:1312` 在原 mutation lock 内把 fresh barrier 与 Closing 串联。 |
| [task.ts](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/plugin/task.ts:34) | `Input:34`、commands `:75`、permissions `:123`、management `:199`、路由 `:638`、artifact `:733`、Turn/dispatch `:781`、response `:910`：复用显式同 child 路由；增加 `complete` 命令、原权限与准确 aggregate 结果。 |
| [meta-agent-integration.test.ts](/home/keer/workspace/aigcfroge-v2/packages/core/test/meta-agent-integration.test.ts:147) | 复用 `metaSetup:147`、`mc07Build:243`、`mc07Result:230`；新增 `MC07 R2` keeper；保留 `:679` 的恢复 HEAD 后冒领负例，按新准入边界更新预期。 |
| [tool-task.test.ts](/home/keer/workspace/aigcfroge-v2/packages/core/test/tool-task.test.ts:920) | 扩现真实 Task/Permission 管理命令 keeper，证明 complete 的 deny/ask/source、提前 close 和保留取消归档的拒绝。 |

`digest.ts`、`review.ts`、`fold.ts`、parser、Git/Snapshot/AppProcess、公共 Schema/事件/SQL/Protocol/Server/Client/generated 和仓内文档保持只读。必要差额应先回传具体决定函数，由 Root 更新白名单；不得削弱合同以保住文件数。

## 3. 私有数据合同

复用现有类型和存储，不新增 receipt 实体、表、注册表、capture store 或模型循环。

- `RevisionReference` 增加 optional `artifact: ArtifactEvidence`。新的 `revision()` 总返回来自原完成 input 的完整已验证 artifact；optional 让旧 `TaskLink.review` 可解码。
- `ArtifactBaseline` 增加 optional `previous: RevisionReference`。新 repair 的 previous 必须含完整 artifact，且由服务器从 selected latest 的原 `RevisionRecorded` 与 `proofFor` 得到；不增加模型/caller 可自报的 previous 参数。
- 现 `Governance` 的 revision 变体增加 optional `producer: RevisionReference`。只有合法新 input 的 no_change 复用才填原 receipt/source/path/digest；省去该 producer 的 artifact。顶层 receipt/source 仍属于当前调用。旧治理数据可解码。
- `proofFor` 扩现一次边界 decode，读 typed `link.artifact.previous` 和原 settlement 的 optional status，返回私有推断 read 结果中的治理、link、settlement status。现消费者取对应字段；不增加 `RecordRevisionInput.previous` 或第二证明服务。
- 两个现 Core close 接口增加 optional `requireComplete`。默认普通 close 保持取消未结算工作的原语义；complete 使用 true，在同一 mutation lock 内要求 fresh barrier 后才发布 Closing。

这些字段补的是“当前输入依据哪份已接受产物继续”“当前调用来源与原内容 producer 如何分开”“close 是否可以取消工作”的语义缺口。公共事件已有 revision 身份、原 producer Turn/participant 和 completed Delivery；无需另加 revision/copy/完成事件。

## 4. 准入与真实 R2

1. 使用原 `intent=implement`/`command=append`，显式 `task_id` 或 `participant_id`，并声明原 `artifact_path`。沿现路由证明同 delegation/implementer/child；可使用现有 `Turn.kind=repair`，不新增 repair intent。
2. 原 child 绑定后、`sessions.prompt` 前，在其保存 Location 的 FileAccess 边界，以当前 invocation/source 授权读取。
3. 原 latest revision 由 `revision()`/`proofFor` 验证：真实事件、原 child user、派生 inputID、原 KV settlement、completed Session input、receipt/source 均匹配。participant、child、Location、repository、path 必须与本次修复一致。
4. 重新读取真实 HEAD tree、唯一 index stage-0、原 blob，核 HEAD/blob/base SHA 与原捕获一致。保留 mode、symlink、64 KiB、strict UTF-8、Git exit/truncation 和固定 flags 守卫。
5. 当前工作树 target SHA **及完整固定 diff** 分别等于 latest accepted artifact 的 target SHA、normalizedDiff，才可把原基准与 previous 冻结到本次 TaskLink。初始 R1 无 previous 时继续要求工作树等于 HEAD；任意 WIP、恢复 HEAD 后重新写回旧 digest、其它 participant 或旧 revision 不获得此例外。
6. 基准几何复用原 HEAD/blob/base SHA；`baseline.agent` 使用本次 invocation.agent。完成时用本次 TaskLink.source 的 messageID/id 与该 agent 再走当前 FileAccess 权限，不继承 R1 的授权。
7. completed input 后用原完整 capture 得到 target。分类调用现 `classifyChangeKind`，base 使用 previous 的 commitSha/normalizedDiff，target 使用本次捕获。新非空变化生成真实 R2；相同完整内容为 no_change。
8. 新 R2 首次登记也需在 `recordRevision` 锁内核 admission.previous 仍为 latest，避免过时基准生成错误关系。旧 approval 是否有效继续由现 review 函数决定。

## 5. 同 digest 与精确重入

`recordRevision` 保留旧同 producing input 的 exact reentry 分支和所有异主拒绝；仅增加可证明的同 child 延续例外。

| 比较 | 必须成立的关系 |
| --- | --- |
| 当前 input | 新 receipt/source 与当前 user、TaskLink、Governance、completed Session input 匹配；原 source 不拿来代替新 source。 |
| previous 与原 producer | previous receipt/source 与原 RevisionRecorded 指向的完成 proof 匹配；previous.artifact 与原 proof.artifact 完整相等，包含原 changeKind。 |
| 新 artifact 与原内容 | 比较 `location/repository/path/commitSha/baseSha256/targetSha256/normalizedDiff/revisionDigest`；另要求本次 artifact/input changeKind 均为 no_change。原 event 的 rework 保留。 |
| 首次结算 | previous digest 仍为 current latest，且等于本次 digest；不同 participant/child/path、伪 previous、过时 digest 或历史 digest 往返均拒绝。 |
| 已接受精确重入 | 匹配 completed Delivery、`TaskSettlement.status=completed`、原保存治理 receipt/source 和 producer lineage；可返回该原结果，不因后来出现 R2 再要求旧 digest 为 latest。缺这些完成事实不能走此分支。 |

合法 no_change 返回 reused，不发布第二个 RevisionRecorded，不改原 event/producer/changeKind。新 TaskLink、input、Delivery、Task settlement 和父 Tool 仍属于新调用。producer 指针由已验证 lineage 产生，并保存在原 settlement；重复结算返回原完整值和原来源。

保留 `fold.ts:817` 的重复 digest corruption。no_change 的新 repair Turn 可不填 revisionDigest：现 canComplete 不读取每个 Turn 的 digest，当前 receipt/Governance 与 aggregate latest 足够；不造 TurnRevision 或 copy 事实。

## 6. Review 与完成入口

复用已有 typed review、copyable、isReviewEffectiveForRevision、evaluateReviewBarrier 和 canComplete。

- R2/rework 后旧 approved 无效，当前 R2 通过现 Task review intent、latest admission、完整 envelope 解码与 receipt/source 证明重新审阅。formatting_only 继续保守，模型声称“只是格式”不构成机械分类。
- 新 no_change 保持同一个 latest digest，原 approved 直接仍有效，不发布伪 copy/新 revision。changes_requested/rejected 是治理判断；completed 执行不被改为失败。
- sticky rejection 用现 `retract_rejection`、`task_reconcile`、canonical source 与匹配 blocker participant 显式撤销。新 approved 不自动撤回；撤回也不替代 approval。
- Task 的新 `complete` 先分别判定原 `task_close` 与 `task_archive` 两个 action，使用相同 selected delegation resource、当前 session/agent 与 canonical source；两项均通过后才关闭。现 Task.archive 单独使用 task_archive（task.ts:126），Permission 按 action/resource 匹配（permission.ts:108、effective.ts:36），task_close 授权不能代替 task_archive。复用现 assert，不新增 action、权限注册表或规则。

complete 顺序必须全部实现：

1. 在现 command owning boundary 依次调用 Permission.assert(task_close) 与 Permission.assert(task_archive)。任一 deny/reject 均在 Closing/资源清理前返回。允许 close、拒绝 archive 时，complete 拒绝；不能以内部自动 archive 绕过原独立权限。两个请求各按实际 action/resource 判定并保留 canonical source。
2. 两项权限返回后，await `execution.close({ delegationID, requireComplete: true })`。不增加 Task 层 canComplete 预检。
3. Service.close 在现 serialized mutation lock 内读 fresh state，先核取消/归档来源与原 canComplete，再发布 Closing。检查放在 terminal/idempotent early return 前。失败不进入 Execution 的 interrupt/cancel/settle/release。appendTurn 使用同一锁，因此 fence 提交后新输入被拒绝。
4. 原 close 清理结束后调用原 Service.complete，保留其锁内 barrier 重验与 external refusal；该复验跨越了真实异步 cleanup 边界。
5. fresh foldState 确认 `status=archived`、`archivedFrom=completed`、completedAt 存在。原 canComplete/review barrier 结果供父内容消费；不在 Task 新加放行校验。Service.complete 对 archived 的 void/no-op 本身不是成功证明。
6. 原 Task output/content 返回真实 Delegation.Info、archivedFrom、latest digest、review barrier passed/reason、canComplete 和当前 command/source；下一父请求逐字消费该完整持久 content。操作 status 与 aggregate status分别表达，不新增 completion receipt。

保留所有仍 failed/cancelled/recovery_required 的原 Turn/Delivery 守卫。新成功 Turn 不替代旧未结算失败；本片不定义 supersession、未知副作用 retry 或跨 child 补偿。

## 7. 最小可信 keeper

所有正向事实通过真实 Task→Session→DB/Bus→Permission/Location/Git→原 settlement 产生。模型响应用既有 TestLLM/offline catalogue 控制。不得手种 revision/review、复制 digest/copy/barrier 算法或加入 test-only 生产 seam。用现 readiness/Deferred/Bus/llm.wait/awaitIdle；不固定 sleep。

| Keeper | RED→green 要观察的事实 |
| --- | --- |
| `MC07 R2 same child repair` | 真实 R1 与 typed changes_requested→原 child 新输入实际 write/edit 产 R2；原 HEAD/blob/base SHA 不变、diff/target/digest 准确；旧 review 不允许完成，当前 typed R2 approval 后通过；新/旧 receipt、完整父消费成立。 |
| `MC07 R2 no_change producer` | R1 approved 后不恢复 HEAD；原 child 新输入无改动，reused、revision 事件仍一条，原 producer 不变，新 input/receipt/source 与完整 diff 进入父请求；随后真实 R2 出现后再重入该 completed no_change input，结果逐项相等、领域事件不增。 |
| `MC07 R2 admission lineage` | 保留原 `:679` 的真实恢复 HEAD 负例，提前在准入拒绝、新 child input/revision 为 0；再覆盖其它 participant/child、伪或过时 previous、current target/diff 漂移、当前 read deny/ask reject。已提交的原 domain/resource 事实准确保留，不要求虚假的全额回滚。 |
| `MC07 R2 sticky retraction` | 真实 rejected R1→真实 R2 approved 仍 blocked；正确 participant 的显式 Task retraction 经 task_reconcile ask/once；错误 participant/deny 无撤回，撤回前后原 review/history 保留，撤回本身不批准。 |
| `MC07 R2 complete after permission` | 同父 Step 的真实 complete 在 task_close 或 task_archive ask 挂起时，另一真实 Task 追加原 child 新工作；等 Turn/child request readiness 后 once。fresh barrier 拒绝，无新 Closing/DeliveryCancelled，新输入仍可完成。允许 task_close/拒绝 task_archive 时也拒绝且无关闭/完成/归档事件；两项 ask 各有正确 action/resource/source。正常 complete 证明 cleanup→Completed→Archived→完整父消费及重复 complete 不增事件。 |
| `MC07 R2 close preserves failure` | 提前真实 Task.close 保留 cancelled Delivery，complete 准确拒绝。历史 `archivedFrom=cancelled` 仅作 retained lifecycle 兼容负例，review/revision 仍由真实 Task 产生；不能声称 Task 已能生产 cancelled aggregate。旧失败、取消、recovery_required 与 external refusal 回归保持。 |

原 R1 精确重入、source/owner 与 failed/cancelled/mixed-cause keeper继续保留。source 单因素证明缺口沿原 owner/unlock；新 no_change 的 current/previous source 比较须在 owning boundary 获执行证据，不能只靠 caller 字符串。

## 8. 待 Root 派发的串行工程命令

本节全部命令**未运行**。Root 正式派发检查槽后才能执行；本阶段实际测试/type/lint/AST/build 为 0。Core manifest 当前 test 是 `bun run script/test.ts`，typecheck 是 `tsgo -b tsconfig.json tsconfig.tests.json`，须走包 wrapper。

cwd `/home/keer/workspace/aigcfroge-v2/packages/core`，依次：

```bash
/home/keer/workspace/aigcfroge-v2/script/bun run test test/meta-agent-integration.test.ts test/tool-task.test.ts --test-name-pattern 'MC07 R2' --timeout 30000
```

第一轮在生产修改前保存可信 RED；最小修复后重复同一 focused 命令取得 green，然后一次受影响回归：

```bash
/home/keer/workspace/aigcfroge-v2/script/bun run test test/meta-agent-integration.test.ts test/delegation-execution.test.ts test/delegation-service.test.ts test/tool-task.test.ts test/delegation-task-decision.test.ts test/session-execution.test.ts test/delegation-review.test.ts --timeout 30000
```

```bash
/home/keer/workspace/aigcfroge-v2/script/bun run typecheck
```

cwd `/home/keer/workspace/aigcfroge-v2`，仅已安装工具、仅白名单：

```bash
node_modules/.bin/prettier --check packages/core/src/delegation/execution.ts packages/core/src/delegation/service.ts packages/core/src/tool/plugin/task.ts packages/core/test/meta-agent-integration.test.ts packages/core/test/tool-task.test.ts
```

```bash
node_modules/.bin/oxlint packages/core/src/delegation/execution.ts packages/core/src/delegation/service.ts packages/core/src/tool/plugin/task.ts packages/core/test/meta-agent-integration.test.ts packages/core/test/tool-task.test.ts
```

```bash
node_modules/.bin/ast-grep scan -c script/ast-grep/sgconfig.yml packages/core/src/delegation/execution.ts packages/core/src/delegation/service.ts packages/core/src/tool/plugin/task.ts
```

```bash
node_modules/.bin/ast-grep scan -c script/ast-grep/effect-simplifications/sgconfig.yml --off=unused-suppression packages/core/src/delegation/execution.ts packages/core/src/delegation/service.ts packages/core/src/tool/plugin/task.ts
```

```bash
git diff --check -- packages/core/src/delegation/execution.ts packages/core/src/delegation/service.ts packages/core/src/tool/plugin/task.ts packages/core/test/meta-agent-integration.test.ts packages/core/test/tool-task.test.ts
```

before/after 内容与模式、最小 delta、每轮 command/cwd/exit/tally/source SHA分别保存；RED、后继 green、格式前/后身份、warning/skip、受控与真实模型分开。通过后不无理由重跑全组。公共 API 未改，无 generate/build；真实 Source/Native/CLI/provider 预算继续 0。

## 9. 真实验收的最短观察链与未交付

工程接受后由 Root 冻结源/依赖/产物、原 Session/DB/Location、独立有限预算和验收谓词。本阶段不写运行 harness、不启动或重放 R1。

复用原 R1 保存身份→原 reviewer 新 typed changes_requested 或 rejected 与父消费→原 implementer/child 新输入实际产 R2→当前 R2 typed approval 与父消费→同 child 新 no_change receipt/原 producer/copy有效性→必要的显式 retraction→fresh barrier→原 close cleanup→Completed→Archived→父模型准确消费与同次退出。实际选择 changes_requested/rejected 和请求数由 Root 按冻结场景决定；不施加人为输出 token 上限、不借 R1 已耗额度。

| 原账本/owner | 本片后的保留范围及 unlock |
| --- | --- |
| V2-C-DELEGATION / V2-C-DELEGATION-LIFE，主智能体/Root及状态语义 Owner | 本 R2 阶段 B 未派发；解除需上述 keeper、工程独审、限定真实同 child 链和 Root 签收。 |
| 原 artifact capture owner / V2-C-DELEGATION | **真实 no_code_change producer/copy 未交付**：classifier 要求 commit 变而完整 diff 相同，本片固定 HEAD；解除需明确基准/新 commit 关系、真实 producer、完整证据与独立 keeper/授权。纯 copyable 测试不解除。其它文件类型、多路径、child commit、并发写者同归原 owner。 |
| V2-C-FANOUT，原资源 owner/主智能体 | 前置/后提交故障、补偿、reconcile；独立故障小节和资源 owner 授权后解除。 |
| V2-C-RECOVERY / MC10，原实现 owner/Root | 未知副作用、revision 后父 Tool 未持久、完整崩溃恢复、旧失败 supersession；独立恢复设计与崩溃证据后解除。 |
| AUDIT-V2-MODE-META / V2-VALIDATION，原 owner | 只取得本片实际交付信用；全部 MC07、后继 MC08/MC04b/MC09/MC10 沿原条件。 |

唯一未交付账本仍是 [technical-debt.md](/home/keer/workspace/aigcfroge-v2/docs/technical-debt.md)。上表是本候选的范围移交，不是第二账本；Root 在本片关闭前将真实未交付差额同步原账本。
