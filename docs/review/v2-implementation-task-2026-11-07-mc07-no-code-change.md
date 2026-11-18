# MC07 no_code_change 正式实施任务

2026-11-07：**MC07 no_code_change 已按正式范围闭环。** [Root 最终接受](/home/keer/.codex/outputs/2026-11-07/mc07-no-code-change-runtime-root-v2/root-final-acceptance.json)与[同次结果独审](/home/keer/.codex/outputs/2026-11-07/mc07-no-code-change-runtime-root-v2/independent-result-review.md)确认真实 R1→typed approval→同 child 一个直接空提交→新 producer/digest 的 no_code_change→继承原批准→complete/archive→完整父消费。4 个父 Task、3 个工作 turn、2 revisions、1 条原 R1 approved、两次精确 once、6 份完整 Tool 消费均核实。

本次真实 10 请求＝父5/implementer4/reviewer1，均 complete200；最终父 succeeded、aggregate archivedFrom=completed。原验收器误把 RevisionReference.path 预期写成相对路径，runner/controller exit1 保留；同次离线 115 项谓词 exit0 补齐，未新增请求或启动。两次辅助离线失败分别保留。Electron/gateway exit0，Source 已结束、三端口释放，Source 数字退出仍 unknown。末次 delegation GET 和末图未发生，最终领域状态由同次 DB fold 与已消费 complete JSON 验证。

累计 MC07 Source30（父17/child13）、Native预留6；v1预留1但实际启动0计入，不退款、不重置。[账本](/home/keer/.codex/outputs/2026-11-07/mc07-no-code-change-runtime-root-v2/root-runtime-v2-accounting.json)逐包保留。`NoCodeChangeEngineeringAccepted=true`、`NoCodeChangeRuntimeAccepted=true`、`NoCodeChangeComplete=true`、`MC07Complete=false`。后继按 fanout→source 单因素补证→外部只读 reviewer/completion 推进，再按原计划进入 MC08→MC04b→MC09→MC10；工作会话及子智能体使用 gpt-6.1-sol/max。下方时点记录按历史理解。

2026-11-07：**MC07 no_code_change 工程已签收，真实验收待执行。** [Root 工程接受](/home/keer/.codex/outputs/2026-11-07/mc07-no-code-change-engineering-v1/root-engineering-acceptance.json)确认可信 previous 下一个直接空提交的 parent/tree/target/full-diff 合同、新 producer/digest、原批准对新 latest 的有效性及原 complete/归档消费者。2 生产＋1 测试；最终定向7 pass/0 fail/184 expects、Core 类型与静态检查通过，七文件回归292 pass/0 fail/3047 expects的测试版本差额及失败轮次分别留存。工程会话 `01a1b2c4-e653-7713-837f-64b4d73cf5d9` 已停止写入并交回检查槽。

Root 准备新的隔离 Native＋DeepSeek Flash/high 真实链：R1 写入→typed review→同 child 一次空提交→继承批准→complete/父消费；候选总请求10（父5/implementer4/reviewer1），当前新运行授权0。原 R2 最终接受保持；`NoCodeChangeEngineeringAccepted=true`、`NoCodeChangeRuntimeAccepted=false`、`MC07Complete=false`。下一 fanout 仅完成阶段A与提示词独审，尚未派发。原 source 单因素冲突、外部 artifact completion 及后续 MC08→MC04b→MC09→MC10 保持原 owner/unlock。下方为历史记录。

2026-11-07：监督 Root 根据既有人类自主推进委托，在 [R2 最终接受](/home/keer/.codex/outputs/2026-11-07/mc07-r2-root-review-v1/root-final-acceptance.json)及[本片独立任务复审](/home/keer/.codex/outputs/2026-11-07/mc07-no-code-change-prompt-v1/review.md)完成后，正式派发本节工程。工作模型 **gpt-6.1-sol / max**。实际仓 `/home/keer/workspace/aigcfroge-v2`，默认仓 `/home/keer/workspace/aigcfroge`只读；保留当前分支、全部 WIP 与文件模式。

现在授权下方 **2 个生产文件与 1 个测试文件**，一个实施者；承接本任务的新 Codex 会话主智能体独占本片串行工程检查槽，只读子智能体负责复核。Root 只读监督并最终签收，范围内常规修复直接推进，无需再次请求同范围授权。

[正式派发](/home/keer/.codex/outputs/2026-11-07/mc07-no-code-change-engineering-v1/dispatch.json)绑定[三文件 before](/home/keer/.codex/outputs/2026-11-07/mc07-no-code-change-engineering-v1/before-files.json)；工程交付目录 `/home/keer/.codex/outputs/2026-11-07/mc07-no-code-change-engineering-v1`。`MC07R2Complete=true`、`MC07Complete=false`。Root 本次批准下述“原 HEAD 不变路径＋可信 previous 下一个直接空提交”的局部合同修订，工程 keeper须以实际 Git/Task 的 RED→GREEN 验证新增关系。原 R2 的固定 HEAD 接受范围保持其历史含义。

真实 Source/Native/Codex/产品模型预算均为 **0**。本任务只授权工程与私有测试夹具；未来 10 请求只是候选，由 Root 在工程接受后另行冻结。

## 首读与复用

先读本仓 `CLAUDE.md` 第一性原理、`AGENTS.md`、`ARCHITECTURE.md`、`docs/testing.md`、适用子目录 AGENTS、`specs/v2/session.md`、`specs/v2/tools.md`；Effect 修改读 `.aigcfroge/skills/effect/SKILL.md`。

直接复用 [no_code_change 阶段 A v2](/home/keer/.codex/outputs/2026-11-07/mc07-no-code-change-prepare-v2/report.md)、[R2 正式任务](/home/keer/workspace/aigcfroge-v2/docs/review/v2-implementation-task-2026-11-07-mc07-r2-repair-complete.md)、[当前唯一债务账本](/home/keer/workspace/aigcfroge-v2/docs/technical-debt.md:5)和[原 MC07 新会话正文](/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/2026-11-05-meta-next-session-prompts.md:221)。阶段 A 已有充分定位，不重做调查或全仓扫描；以已接受 R2 当前字节为基线，不能用 HEAD 替代含 WIP 的 before。符号检索优先 codegraph；本仓尚无索引时只读精确源码，不初始化索引或安装依赖。

本会话主智能体独占本片串行工程检查槽。只读子智能体可复核和建议，不能修改文件、运行检查或启动服务。监督 Root 只读监督、裁定必要合同差额并最终签收。仓内文档仍由 Root 单写；本片只交回工程收据和 owner/unlock。

## 目标与有限合同修订

只完成已有 **no_code_change producer/copy**：

1. 新私有 Git fixture、新 Meta Root 与新 delegation：tracked `artifact.txt` 为 regular 100644，真实 H0 与 stage-0 一致。首个真实 implementer Task 用 write 产生 R1，保留目标 unstaged；真实 reviewer Task 对其实际 digest 返回 typed approved。
2. 同 delegation、同 implementer/child 追加一次 Task，使用服务器返回的身份与原 `artifact_path`。该 child 只执行一次直接空提交，目标内容与 unstaged 状态保持：
   ```text
   git -c core.hooksPath=/dev/null -c commit.gpgsign=false commit --allow-empty -m mc07-no-code-change
   ```
3. 真实 Git 关系必须为 `H1≠H0`、`parents(H1)=[H0]`、`tree(H1)=tree(H0)`；选中路径的原 blob/index/base SHA、目标 SHA 和实际 H1 完整 diff 均保持。由现 capture、recordRevision、review owner 生成新 digest、`no_code_change` 与有效继承批准，再沿原 complete/归档及完整父结果消费收口。

R2 最终归档后的旧 delegation 不再用于追加；`appendTurn` 在 [service.ts:767](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/service.ts:767)拒绝 archived。旧 R1/R2 接受只作为既有信用和回归，不移植其 receipt/review 冒充新 lineage。

原合同在 [captureArtifact:437](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/execution.ts:437)拒绝任意 HEAD 变化；本片正式派发需将其**局部修订**为“HEAD 不变走原路径；有可信 previous 时，只接受上述一次直接空提交”。依据是 commit 身份与内容关系分别由现 [calculateRevisionDigest:15](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/digest.ts:15)及[classifyChangeKind:31](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/digest.ts:31)决定：H1 改变 digest，同完整 diff 得到 no_code_change。批准继承由 [copyable:20](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/review.ts:20)与[isReviewEffectiveForRevision:190](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/review.ts:190)裁定。

选择简单实现：单路径、一个直接空提交、整树相等，复用既有 owner。泛化的“任意 HEAD 关系且所选 diff 相同”涉及其它文件变树、多 commit/merge/rebase 与并发作者；这些是明确技术债，须由真实用例、独立 keeper 和 Root 的 owning 文件/合同授权解除。不新增泛化框架、baseline 字段、Schema/事件/表、registry 或模型循环。

## 精确白名单：2 生产 + 1 测试

| 文件                                                | 必要差额                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/delegation/execution.ts`         | [captureArtifact:423](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/execution.ts:423)复用 repo discovery/head 与 [bounded rawGit:287](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/execution.ts:287)读取实际 parent/tree。新 HEAD 分支验证上述关系、target SHA 与 previous 相等、对实际 H1 运行[原完整 artifactDiff:324](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/execution.ts:324)并逐字等于 previous。返回实际 H1 的 commit/digest/classification target，分类 base 仍为 previous H0/D0；结束前回读 HEAD 仍为 H1。[prepareArtifact:352](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/execution.ts:352)的可信 previous 准入与原 Location/FileAccess/source、stage-0、100644、symlink、64 KiB strict UTF-8、Git exit/truncation 守卫保持。 |
| `packages/core/src/delegation/service.ts`           | [recordRevision:986](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/service.ts:986)的共享 commit 相等条件 [:1071](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/service.ts:1071)也必须修订：仅在本次 digest 尚无 record、且当前可信完成 proof 的机械分类为 no_code_change 时允许 commit 不同。`previous:1023` 是“本次 digest 的已有记录”，前驱是 `admission:1024`，不要混淆。保留 `:1007–1010` 当前 receipt/source/commit/kind 绑定、`:1058` 原 producer 完整 lineage、location/repository/path/base SHA、锁内 `:1118` latest 校验、原 no_change 和已完成 input 精确重入；Service 不再读 Git。新 digest 首次必须是 `recorded`。                                                                                                                                                      |
| `packages/core/test/meta-agent-integration.test.ts` | 复用 `metaSetup:149`、`mc07Result:237`、`mc07Build:250`、TestLLM 和已有 R2 keeper。新增 `MC07 no_code_change` 主 keeper及该新放行关系必要负例；实际 shell/Git、Task/child input、DB/Bus、capture、recordRevision、review barrier、complete 与父消费全部经过现有实现。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

`digest.ts/review.ts/fold.ts/task.ts`、Git/Shell/Permission owner、公共 Schema/事件/SQL/Client/generated 与仓内文档不在写白名单。若必要修改越界或合同无法实现，向 Root 回传具体决定函数和最小差额；范围内常规修复直接推进。

## 私有 Git、权限与可信验证

**私有工程 fixture** 允许按现有 setup 初始化 Git、加入并提交初始基准；每个独立 keeper 的 child 可以执行上述一次空提交。R1 write 之后不 stage 目标、不恢复 HEAD 或清空工作树。**实际工程仓与默认仓的 Git 写均禁用**，包括分支/worktree/stage/commit/push/reset/clean；不安装升级、不构建生成、不接管现用服务或用户库。

Git shell 走现 ShellTool 的 scan、FileAccess 与 Permission，workdir 精确绑定私有 fixture；canonical source 来自本次真实 child call。测试的 wildcard allow 不成为真实运行授权。未来实际 scanner resource、完整命令 hash/cwd/source 与 effective rules 必须由 Root 在其检查槽核实并冻结，不用宽 Git 前缀或 saved grant 替代逐次权限。原硬 deny、read deny/ask 与 child task/subagent deny保持。工程 TestLLM 只控制响应，不手种 RevisionRecorded/ReviewRecorded、不复制 digest/copy/barrier 算法或加入 test-only 生产 seam。

先用当前代码取得可信 RED：实际 child shell 已 completed/exit 0，真实 H1 单亲/同树、目标 SHA/完整 diff 相等已被 Git 证明，而 capture 的 HEAD 守卫拒绝新 revision。权限、准入或 shell 未完成是前置失败，不记为该 RED。保留已发生的 Git/领域事实；未知效果不自动重放空提交。

最小修复后，主 keeper必须证明：两个实际不同 digest、两条 RevisionRecorded；新事件为 no_code_change，新 input/receipt/source 是新 producer，TaskLink.previous 指旧 producer；旧 approved 仍只引用 R1 digest，现 review owner 判其对新 latest 有效，不发布伪 copy 或第二 approval。沿原 complete 边界使用 task_close 与 task_archive 两项权限、锁内 fresh barrier、cleanup 后重验、真实 Completed→Archived，并把完整持久结果交给下一父请求。新关系负例沿阶段 A v2 的无 previous、非直接单亲/树改变、index/target/diff 漂移、过时/异主 proof；已有等价 keeper直接复用，不扩 source 单因素专项或新故障矩阵。用已有 readiness/Deferred/Bus/llm.wait，禁止固定 sleep。

工程命令仅在 Root 正式派发检查槽后，按 **RED→最小修复→focused green→一次受影响回归→Core 类型→已有定向静态** 串行运行。逐轮保存 command/cwd/exit/tally、stdout/stderr、源码身份；失败、green、warning/skip分别记账，重叠 tally 不相加。

cwd `/home/keer/workspace/aigcfroge-v2/packages/core`：

```bash
/home/keer/workspace/aigcfroge-v2/script/bun run test test/meta-agent-integration.test.ts --test-name-pattern 'MC07 no_code_change' --timeout 30000
/home/keer/workspace/aigcfroge-v2/script/bun run test test/meta-agent-integration.test.ts test/delegation-execution.test.ts test/delegation-service.test.ts test/tool-task.test.ts test/delegation-task-decision.test.ts test/session-execution.test.ts test/delegation-review.test.ts --timeout 30000
/home/keer/workspace/aigcfroge-v2/script/bun run typecheck
```

cwd `/home/keer/workspace/aigcfroge-v2`，仅已安装工具：

```bash
node_modules/.bin/prettier --check packages/core/src/delegation/execution.ts packages/core/src/delegation/service.ts packages/core/test/meta-agent-integration.test.ts
node_modules/.bin/oxlint packages/core/src/delegation/execution.ts packages/core/src/delegation/service.ts packages/core/test/meta-agent-integration.test.ts
node_modules/.bin/ast-grep scan -c script/ast-grep/sgconfig.yml packages/core/src/delegation/execution.ts packages/core/src/delegation/service.ts
node_modules/.bin/ast-grep scan -c script/ast-grep/effect-simplifications/sgconfig.yml --off=unused-suppression packages/core/src/delegation/execution.ts packages/core/src/delegation/service.ts
git diff --check -- packages/core/src/delegation/execution.ts packages/core/src/delegation/service.ts packages/core/test/meta-agent-integration.test.ts
```

走包 wrapper，不根 test、不裸 bun test、不 tsc；最终检查通过后不无依据扩大或重跑。不得新增没有已声明风险的矩阵或人为性能阈值。

## 交付与未来真实预算

向 Root 交三文件 before/after（包含 WIP 与模式）、最小 delta、上述逐轮收据、失败原记录、一次非写者只读代码复核，以及未交付 owner/unlock。源码关系结论引用决定函数 `file:line`。本阶段新关系的环境证据只能来自实际工程 keeper；准备稿没有这类执行证据。工程通过后交回 Root，等待独审、源/依赖冻结与另外的有限真实包；不自行关闭本片或 MC07。

本片当前 **真实 Source/Native/Codex/产品模型预算均 0**，不启动、探活、重试、换模型或写/运行真实 harness。下表只是供 Root 后续冻结的候选，不可执行，也不借用旧 R1/R2 未耗槽：

| 未来请求 owner    | 最短新身份链                                                                                   | 候选 physical/Source |
| ----------------- | ---------------------------------------------------------------------------------------------- | -------------------- |
| 新 Root           | 发 R1；消费 R1 发 review；消费 approval 发 H1；消费新 revision 发 complete；消费 complete 终答 | 5                    |
| Implementer Child | write＋完成；一次 shell＋完成                                                                  | 4                    |
| Reviewer Child    | 对真实 R1 typed approved                                                                       | 1                    |
| 合计              | 一个新用户目标，完整连贯链                                                                     | 10                   |

若 Root 另选 Native 入口，候选 Native 1、外部/Codex 0；未来产品模型沿 DeepSeek Flash/high，由 Root 单独冻结。另行结束 R1 父终答再补输入会增加请求，不能默认仍为 10；不加人为输出 token 上限。

| 保留项                                                                                     | Owner / unlock                                                                                             |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| 泛化 HEAD 关系、多路径/untracked/binary/rename/delete/mode、其它 child commit、并发 writer | 原 artifact capture owner / V2-C-DELEGATION；实际用例、必要 owning 文件授权与独立 keeper。                 |
| fanout 前置/后提交故障、补偿与 reconcile                                                   | V2-C-FANOUT / 原资源 owner；独立故障任务和资源授权。                                                       |
| source 单因素冲突、Job cause 正文与 Git 授权相对时序                                       | 原 MC07-R1 Root / 原治理及 capture owner；相应 owning 比较或具体正文/时序保证的直接证据。                  |
| 外部 artifact completion                                                                   | 原外部 completion owner；正式设计与验证。                                                                  |
| 未知效果窗口、完整恢复、Meta/UI/全模式及 MC08/MC04b/MC09/MC10                              | V2-C-RECOVERY/MC10、AUDIT-V2-MODE-META/V2-VALIDATION与各原 owner；沿原依赖、独立恢复设计和真实消费者验收。 |

上述是原账本移交摘要；Root 同步唯一 `docs/technical-debt.md`，本片不另建债务账本。**MC07 整体继续开放。**
