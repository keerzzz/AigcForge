# MC07-R1 阶段 B 正式实施派发

2026-11-07：**MC07-R2 已按正式范围闭环，MC07 整体继续开放。** [Root 最终签收](/home/keer/.codex/outputs/2026-11-07/mc07-r2-root-review-v1/root-final-acceptance.json)串联真实 R1 拒绝、同 child 的 R2 修复、当前 typed approval、固定 HEAD 的 no_change、显式撤回拒绝，以及 fresh barrier 下的 complete/归档与完整父消费。工程接受和各轮真实证据分别记账。

最终收尾实际为 2 个 DeepSeek Flash/high 请求、1 次 complete、task_close/task_archive 两次精确 once204；893 字符完整结果进入第二父请求。新增 Closing、两个 ParticipantClosed、Completed、Archived 共 5 事件，原 6 Task/6 Turn/6 settlement、2 child 及历史保留。本次六动作全成功，controller/runner、Electron/gateway 退出 0，自有 Source 已结束、三端口释放；Source 数字退出仍 unknown。累计 Source20（父12/child8）、Native4；此前两轮验收器失败及旧余额按原收据保留。

`MC07R2Complete=true`，`MC07Complete=false`。下一片为真实 no_code_change producer/copy，按 Root 独立正式任务推进；fanout、source 单因素冲突、外部 artifact completion 及 MC08→MC04b→MC09→MC10 继续原 owner/unlock，见[唯一债务账本](/home/keer/workspace/aigcfroge-v2/docs/technical-debt.md)。以下保留各轮历史记录。

2026-11-07：**MC07-R2 前四个真实 Task 已限定签收，管理收尾待续接。** [Root 同次接受](/home/keer/.codex/outputs/2026-11-07/mc07-r2-root-review-v1/root-runtime-partial-acceptance.json)确认 rejected R1→真实 R2→当前 approval→no_change 的新来源与原 producer，以及四份 Task 和 write 的完整结果消费。10 次 DeepSeek Flash/high 请求均完整 200；原 runner/controller exit 1 与撤回工具 aborted 保留。[根因证据](/home/keer/.codex/outputs/2026-11-07/mc07-r2-root-review-v1/runtime-v1-review/root-wait-rca.json)证明验收器忽略 needsContinuation 提前等待，阻塞自身后续审批。Electron/gateway 退出 0、自有 Source 已结束、三端口释放；Source 数字 exit 仍 unknown。Root 仅准备撤回拒绝→complete/archive→最终父消费的三父请求续接包，尚未签发；已完成四段不重做。R2EngineeringAccepted=true，MC07R2Complete=false、MC07Complete=false。后续与未交付继续见唯一债务账本；下方为历史检查点。

2026-11-07：**MC07-R2 工程已签收，真实验收待执行。** [Root工程接受](/home/keer/.codex/outputs/2026-11-07/mc07-r2-root-review-v1/root-engineering-acceptance.json)记录3生产+2测试的冻结字节、原七文件回归285 pass/0 fail/2863 expects，以及最终字节的Core类型、17 pass/0 fail/264 expects定向组和静态检查。七文件回归与最终类型修正版的差额、失败轮次和两份独审分别保存。执行会话 `01a1b1da-ec08-71b1-a4e6-d167259da56f` 使用gpt-6.1-sol/max；工程写入和检查槽已收回，Root准备DeepSeek Flash/high的有限真实运行包，当前真实运行预算0。MC07R2Complete=false、MC07Complete=false；[R1最终接受](/home/keer/.codex/outputs/2026-11-07/mc07-r1-root-closeout-v1/root-final-acceptance.json)保持，原失败与同次补验见其收据。未交付owner/unlock见[唯一账本](/home/keer/workspace/aigcfroge-v2/docs/technical-debt.md)。下方记录保留历史时点。

本文件下方为原阶段A/B任务历史。最终范围与追加keeper以[工程接受](/home/keer/.codex/outputs/2026-11-06/mc07-r1-engineering-v1/root-engineering-acceptance.json)的3生产+5测试、原差额派发及after为准；当前实现与检查槽已交回监督Root。

2026-11-06。监督Root依据既有人类自主推进委托，签收阶段A精确任务与两份只读核查。实施会话：`01a1b0dc-a0fb-7533-8722-7e9d618d5258`，模型 `gpt-6.1-sol / max`。

现在允许下文四文件白名单内的一名实施者修改生产/keeper；该会话主智能体独占本片测试、Core类型与定向静态检查槽。其只读子智能体可并行审查/提供测试建议，不能并行运行检查或修改同一片。监督Root本阶段只读监督，不与执行会话争用检查槽。真实Source/Native/Codex/模型运行预算仍为0，工程完成后另由监督Root冻结具体有限包。

Root实施补充（与下文一起构成正式合同）：

- 新artifact/review能力显式选择启用，普通无artifact Task不额外要求Git或指定文件存在。`artifact.txt`、基准/目标字节及199-byte patch是受控keeper，生产机制处理一个满足相同条件的声明相对文本路径，不硬编码该fixture文件名。
- 机械读取基准blob/目标全文也是内容读取。在拥有该声明路径的现有Location/调用边界复用 `FileAccess.authorizeRead` 与当前Permission和原Task source；Task可见、task许可或review角色均不授予read权限。已收窄的授权/身份向内传递，不在每层重复校验。新增一个实际deny路径用例，证明拒绝先于该产物内容读取和child input/revision准入；不增设权限注册表。
- 同一completed input的精确重入必须保持原receipt/source与原持久结果。R2新input如何复用相同产物身份属于后继明确关系；本片的冲突拒绝不代表原MC07 no_change repair目标已交付。未知崩溃窗口仍按账本记录，不能借此豁免本片已声明的重入keeper。
- 完整diff使用已校正的 `--no-textconv --no-color --src-prefix=a/ --dst-prefix=b/` 及原固定flags；区分HEAD tree与index stage-0。只用既有raw Buffer/exit/truncation边界，不把显示patch当完整证据。
- 临时测试Git仓内允许沿既有fixture初始化并提交基准，以创建真实tracked文本；此许可仅限测试临时目录。实际aigcfroge-v2和默认仓的stage/commit/push/reset/clean仍禁止。
- 检查直接调用已安装 `node_modules/.bin/oxlint`、`ast-grep`、`prettier`，不使用可能安装依赖的临时下载路径。格式检查/必要格式修正仅限四个实际变化文件，保留旧WIP。保留初始可信RED，随后最小实现、focused green、完整meta集成与受影响delegation/tool组、Core typecheck和定向检查；通过后不重复无新增理由的全组。
- 工程交回到 `/home/keer/.codex/outputs/2026-11-06/mc07-r1-engineering-v1/`：精确before/after、最小delta、逐轮原命令/cwd/退出与统计、失败记录、一次非写者代码复核、未交付owner/unlock。监督Root最终签收，不自标MC07-R1或MC07闭环。

适用源基线和逐文件SHA见Root dispatch.json及before/。若实际必要变化超出四文件，提交具体决定函数/差额给监督Root；不要退回模拟产物或弱化身份/权限来保住白名单。范围内常规实现与修复自行推进，不再要求人类重复批准。

---

# MC07-R1 阶段 A 精确实施任务单

状态：`ready-for-root-dispatch`。本文件只冻结首片实施，不是工程完成或 MC07 闭环收据。

## 1. 目标与退出边界

只交以下真实链：内部 implementer Task 的一个有限 R1 文本产物 → 绑定该 R1 的 reviewer Turn/Delivery → 全文 `ReviewEnvelope` → 现有 fold/review barrier → 父模型实际消费完整结果与来源。

本片还必须交同一 completed input 的精确重入：相同 HEAD 与完整 `normalizedDiff` 复用原 revision 身份，不重复发布 `RevisionRecorded` 或 review 事实，不改变原 participant/child/input/attempt/source 归属。

本片不交 R2 repair、approval copy/retraction、complete/close、fanout 故障补偿、外部 completion 治理、通用 artifact capture、untracked/binary/任意文件类型、Workflow/Judge/PGE/Hub/UI 或完整崩溃恢复。通过本片只能给内部 R1/review/barrier 链信用，不能声明 `MC07Complete`。

## 2. 已满足前置

- 工作仓库：`/home/keer/workspace/aigcfroge-v2`。
- 冻结 HEAD：`9e2c6577ef6dd65c8f01ff94d46da0142bcb877c`；分支：`v2-dev`；staged 为空。
- MC06 最终前置已由 `/home/keer/.codex/outputs/2026-11-06/mc06-r4/root-final-acceptance.json` 签收，SHA256 `11edca89004eb196a6a97b9639d2acf5c7b1e5db9c9386a4d178d1c84ee90a0b`，其中 `MC06Complete=true`、`MC07Unlocked=true`。
- 文档闭环 `/home/keer/.codex/outputs/2026-11-06/mc06-r4/root-document-closure.json` SHA256 `9b06eef19bfb2c0d979e80ac074ad6745f63bb3a5b682a343725c5a97754754e`；`meta-agent-integration.test.ts` 的 MC06 owner 前置已交回。
- 当前四个授权文件均已有他人 WIP，实施者必须以本文 SHA 为 before 字节，逐文件保留并合并，不得覆盖或回退。

## 3. 受控 artifact 场景

### 3.1 唯一 Location 与路径

- Keeper 使用 `metaSetup` 创建的一个临时 Location；在创建 root Session 前把该目录初始化为 Git 仓库。
- 唯一 artifact 路径固定为仓库根相对路径 `artifact.txt`。不接受绝对路径、`..`、symlink、目录、第二路径或 pathspec 扩张。
- 基准提交只含 regular tracked UTF-8 文件 `artifact.txt`，HEAD tree entry 模式 `100644`，原字节为 `base\n`，5 bytes，SHA256 `f34848ca92665c342abd5816c9e3eda0e82180671195362bcd0080544a3bc2ac`。
- implementer 的真实 child Session 通过现有 `write`/`edit` 产品工具把文件改为 `base\nr1\n`，8 bytes，SHA256 `0e058fda93239ce588dd187f583f54d6e1de2235ff6c6d824b5daf2e52ba1c70`；不能由测试直接改文件冒充 child 产物。

### 3.2 基准捕获时点与 owner

`DelegationExecution.dispatch` 是捕获 owner。它在 child 已绑定、但该 Turn 的 Session input 尚未 `sessions.prompt` 准入和 wake 之前，使用 child 保存的 Location 取得：

1. `Git.repo.discover` 的真实 repository；
2. `Git.history.head` 的非空基准 HEAD；
3. 通过 Location-scoped `AppProcess` 执行 Git 查询得到的 exact stage entry、基准 blob 与工作树字节；
4. 原 Task `source`，以及 delegation/turn/participant/delivery/attempt/child/input 的既有身份。

准入前必须分别证明：HEAD tree 中该路径是唯一 regular `100644` blob；index 中该路径只有 stage-0 entry，且 mode/blob 与 HEAD tree entry 完全一致；工作树原字节再与该 HEAD blob 完全相同；字节数不超过 64 KiB；`TextDecoder("utf-8", { fatal: true })` 无损；所有 Git 命令 exit 0，`stdoutTruncated=false`、`stderrTruncated=false`。任一条件失败时，不 admit child input，不产生 revision。

基准合同写入现有 child input 的私有 `TaskLink` metadata；不新增表、公共 Schema、capture store 或第二 receipt。

### 3.3 完整 target 与 normalizedDiff

`DelegationExecution.settle` 只在 `findInput`、`ownsChild` 和 `SessionInputResult.read` 已证明该 exact input 为 `completed` 后捕获 target；捕获必须发生在发布 terminal `DeliveryCompleted` 之前。

目标条件：

- child 的 Location、repository worktree、artifact path 和 HEAD 必须与基准合同一致；本有限片不接受 child commit 或 Location 切换。
- target 仍为 regular `100644`、UTF-8、最大 64 KiB；selected path 之外的仓库 WIP 不纳入本 artifact，但该 path 的基准前 WIP、rename、delete、mode change、binary 或 symlink 均拒绝。
- 完整 diff 由 `AppProcess.run` 执行固定 Git 命令取得，设置足够但有限的 `maxOutputBytes`，并显式要求 `stdoutTruncated=false`：

```text
git -c core.quotepath=false -c core.autocrlf=false --literal-pathspecs diff --no-ext-diff --no-textconv --no-renames --no-color --src-prefix=a/ --dst-prefix=b/ --full-index --unified=2147483647 <frozen-head> -- artifact.txt
```

- `normalizedDiff` 就是该命令 stdout 的严格 UTF-8 全字节字符串；不 `trim`、不重排、不从 `FileDiff.Info.patch`、显示 patch、Snapshot ID、摘要或模型文本重建。
- Fixture 的预期 `normalizedDiff` 必须逐字节等于以下 199 bytes，末尾 LF 保留；SHA256 为 `1af3f84f075ffc53daadd7b3de4ca46197f269b06a1e5d81c1b991e300c7fc78`：

```diff
diff --git a/artifact.txt b/artifact.txt
index df967b96a579e45a18b8251732d16804b2e56a55..230c401cfd8f8bfffcaded578b08c2985de11ff6 100644
--- a/artifact.txt
+++ b/artifact.txt
@@ -1 +1,2 @@
 base
+r1
```

完整机械证据必须进入现有 foreground Task 持久工具结果/content 与 metadata，至少包含 Location、repository、frozen HEAD、path、base/target byte SHA256、完整 `normalizedDiff`、revision digest、change kind 和原 receipt/source。领域 `RevisionRecorded.diffSummary` 仍只作摘要，不能替代完整证据。

## 4. revision 与 review 合同

### 4.1 R1 生产与幂等

- 用现有 `calculateRevisionDigest({ commitSha: frozenHead, normalizedDiff })` 计算身份；算法不改。
- 第一份非空 diff 相对空基线分类为 `rework`；同一 completed input 重入时重新得到相同 HEAD/diff，按 `classifyChangeKind` 为 `no_change`，但返回原 revision 身份，不发布第二个 `RevisionRecorded`。
- `recordRevision` 必须在现有 delegation mutation lock 内核对原事件与原 TaskLink/receipt。只凭 `state.revisions.some` 或相同 digest 不足以转移归属。
- 若 digest 已存在且原 delegation/turn/participant/child/input/attempt/origin/source 完全匹配，则返回 `reused`；若 digest 相同但 owner 不同，则明确拒绝。保留 `fold.ts:817` 的重复 digest corruption 守卫。

### 4.2 reviewer 准入

- `Task` 增加显式内部 intent：普通实现默认不变；review intent 必须提供 selected delegation 和 `revision_digest`，创建或路由 `reviewer` participant，admit `kind: "review"` 的 Turn。
- `DelegationService.appendTurn` 是决定边界。review admission 必须验证 digest 已由该 delegation 的真实 revision 事实产生，并等于当前 latest revision；目标 participant 必须是 reviewer/approver。
- 无 R1、伪 `rev_`、旧 digest、错误角色或无法证明 artifact 时，在 `sessions.prompt` 前拒绝；新增 reviewer input、review Turn/Delivery 必须均为 0。Caller 字符串不是存在证明。

### 4.3 typed review

- reviewer 的真实 child Session 返回完整终答；keeper 把合法 `<review>{...}</review>` 放在超过 4096 字符的尾部。
- 在摘要 `.slice(0, 4096)` 之前，用现有 `DelegationParser.parseDelegationResult(fullText).review` 解码；不修改 parser 的缺失/坏 JSON/坏 schema 语义。
- envelope 的 `reviewed_revision_digest` 必须等于 review Turn 准入 digest；receipt 必须仍由 `findInput`、`ownsChild`、inputID/attempt/origin/source 证明。
- 只有 transport `completed` 且 envelope valid、digest matching、ownership matching 时调用 `recordReview`。缺失、malformed、错 digest 仍可报告 transport completed，但治理结果为 invalid，不产生 approved。
- review 记录在 terminal Delivery 发布前完成；精确重入不重复 review 事件。defect/interruption 不宽 catch 成成功。

### 4.4 barrier 与父消费

- 复用 `evaluateReviewBarrier`、`canComplete`、fold 的现有消费；不改 copy/retraction 或 failed/retry 守卫。
- 实际 reviewer roster 存在时，有效 review 前 barrier 必须阻断；approved 当前 R1 后只证明该 barrier 链可通过。本片不调用或宣称完整 delegation complete/close。
- Task 工具返回给父模型的 content 必须保留完整 child 文本，并附机械治理结果和原 provenance；keeper 必须检查下一次真实父模型 request 已消费该完整内容，而不只检查 DB/event。
- revision/review 不创建或暗授 Permission grant；沿用现有 Task、edit/write 与父 permission 判定。

## 5. 精确修改白名单

1. `/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/plugin/task.ts`
   - 决定函数：`Input`（当前 :34）、internal participant/Turn 创建（当前 :604/:732/:740）、`response`（当前 :831）。
   - 修改：增加有限 artifact path 与 review intent/revision digest；按 intent 路由 implementer/reviewer；把完整治理结果加入现有 output/content/metadata。普通 Task、external CLI、management command 默认行为不变。
2. `/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/execution.ts`
   - 决定函数：`TaskLink`（当前 :61）、`findInput`（:242）、`ownsChild`（:310）、`waitInternal`（:401）、`settle`（:474）、`dispatch`（:588）。
   - 修改：在 child Location 内冻结基准；把私有合同持久到 input metadata；completed 后用 AppProcess/Git 完整捕获；生产 revision/review；在 Delivery terminal 前完成治理；向 foreground wait 返回完整治理结果。不得使用 `SessionDiff.turn` 或 4096 摘要作 artifact/review 输入。
3. `/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/service.ts`
   - 决定函数：`appendTurn`（当前 :572）、`recordRevision`（:782）、`recordReview`（:798）。
   - 修改：review admission 验真实 latest R1；在现 mutation lock 内做 owner-aware exact reentry；返回 recorded/reused 结果；相同 digest 不允许跨 owner 认领。保留 `complete` 的 external refusal（当前 :1183）。
4. `/home/keer/workspace/aigcfroge-v2/packages/core/test/meta-agent-integration.test.ts`
   - 决定 fixture：`metaSetup`（当前 :143）与真实 Task→父请求 keeper（当前 :354 起）。
   - 修改：只新增 MC07-R1 真实链 keeper。使用真实 Task、Session、DB、Bus、Permission、Location、Git 临时仓库和 write/edit 工具；不得手工调用 `recordRevision`/`recordReview`、手种治理事件或复制 digest/barrier 算法。

禁止修改：`git.ts`、`snapshot.ts`、`delegation-parser.ts`、`digest.ts`、`fold.ts`、`review.ts`、公共 Schema/Protocol/Server/Client/generated、SQL、账本文档。若实施证明上述四文件无法满足合同，立即停在具体决定函数和证据，由 Root 重新授权；不得自行扩文件。

## 6. 必要 RED 与 keeper

先新增 keeper 并运行 RED；旧错误不能被后继绿覆盖。至少覆盖：

1. R1 前 review intent 以伪 digest 拒绝，reviewer input/Turn/Delivery 为 0。
2. 真实 child 工具修改 `artifact.txt`，exact 199-byte diff、HEAD、文件 SHA、receipt/source 进入父 Task 持久结果；恰好一个 R1。
3. R1 后 review 精确 admission；合法 envelope 位于 >4096 字符后仍完整解码；当前 barrier 在 review 前阻断、approved 后通过；父下一次 request 消费完整文本与来源。
4. missing/malformed/wrong-digest envelope，错误 child/input/attempt/source，failed/cancelled/interrupted 均无 approval、无 Permission grant。
5. 同一 completed input 的 owning settlement/recovery 精确重入得到 `no_change/reused`，revision/review 事件计数不增，原 owner 不变；相同 digest 配不同 owner 明确拒绝。
6. 现 MC05/MC06 keeper保持，不改 `review.ts:151`、retry attempt 重算及 `service.ts:1183`。

## 7. Root 串行验证命令

所有命令均尚未执行。唯一资源槽由 Root 获取后串行运行。

cwd：`/home/keer/workspace/aigcfroge-v2/packages/core`

```bash
/home/keer/workspace/aigcfroge-v2/script/bun test test/meta-agent-integration.test.ts --test-name-pattern "MC07 R1" --timeout 30000
/home/keer/workspace/aigcfroge-v2/script/bun test test/meta-agent-integration.test.ts --timeout 30000
/home/keer/workspace/aigcfroge-v2/script/bun test test/delegation-execution.test.ts test/delegation-service.test.ts test/tool-task.test.ts --timeout 30000
/home/keer/workspace/aigcfroge-v2/script/bun run typecheck
```

定向静态检查在工程绿后运行，cwd：`/home/keer/workspace/aigcfroge-v2`：

```bash
/home/keer/workspace/aigcfroge-v2/script/bun x oxlint packages/core/src/tool/plugin/task.ts packages/core/src/delegation/execution.ts packages/core/src/delegation/service.ts packages/core/test/meta-agent-integration.test.ts
/home/keer/workspace/aigcfroge-v2/script/bun x ast-grep scan -c script/ast-grep/sgconfig.yml packages/core/src/tool/plugin/task.ts packages/core/src/delegation/execution.ts packages/core/src/delegation/service.ts
/home/keer/workspace/aigcfroge-v2/script/bun x ast-grep scan -c script/ast-grep/effect-simplifications/sgconfig.yml --off=unused-suppression packages/core/src/tool/plugin/task.ts packages/core/src/delegation/execution.ts packages/core/src/delegation/service.ts
git diff --check -- packages/core/src/tool/plugin/task.ts packages/core/src/delegation/execution.ts packages/core/src/delegation/service.ts packages/core/test/meta-agent-integration.test.ts
```

每轮单独记录 command/cwd/exit/pass/fail/filtered/expect 与运行前源码 SHA；RED 与后继绿分开。禁止根 test、`tsc`、生成、构建、Source/Native/CLI/模型请求。

## 8. 未交付 owner 与 unlock

- `V2-C-DELEGATION` / `V2-C-DELEGATION-LIFE`：同 participant/child 的完整 R2 repair、approval copy、sticky rejection/retraction、complete/close。解除：后继 S2 真实 Task/review 链及独审。
- `V2-C-FANOUT`：前置/后提交故障、补偿与 reconcile。解除：独立故障任务和资源 owner 授权。
- artifact capture owner：untracked、binary、任意文件、多路径、rename/delete/mode change、child commit、并发写者、通用 strict capture store。解除：实际需求、必要 owning 文件授权和可信 keeper。
- `V2-C-RECOVERY` / MC10：RevisionRecorded 后父 Tool 结果未持久等未知效果窗口及完整重建。解除：单独恢复设计与崩溃证据。
- 外部 artifact governance：保留 `service.ts:1183` 的 current complete refusal；解除：外部 completion owner 的正式设计。
- `AUDIT-V2-MODE-META` / `V2-VALIDATION`：只关闭本片实交范围；不取得全模式、UI、全项目或完整 MC07 信用。

阶段 A 无阻断。实施 Root 必须按本文件四文件白名单另行派发。
