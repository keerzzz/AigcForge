# P2.1C Home 模式筛选与搜索归属验收

日期：2026-10-26。状态：最终源码、适用行为/类型/静态门禁、配对性能采集及独立复审已完成，主智能体通过本地限定协议审批，尚未提交。完整模式、全局检索和 P6 继续开放。

现场：`/home/keer/workspace/aigcfroge-v2`，`v2-dev`，HEAD `251c0fe38041a326e624db464d1ee0efd1522881`，固定上游 `4617210822bdbb31e5749751afbfb4584ccedac8`。原聊天的 P0、Skill、运输与模式创建结果保留各自版本和审批范围。本次只接续 Home UI 生产待应用部分；三个测试输入已经应用并获得真实红测。

## 变更与决定函数

新增 Home 的 All/五模式读取筛选，复用原 Select、Home layout、查询、Session store、列表、inline exact 和命令面板。初始 All、独立全局 Home scalar、Custom 可读而保持 composition-only 创建的选择，沿用原 [既有产品边界裁决](evidence/v2-mode-p2.1c-2026-10-25/ui/home-product-boundary-decision.json)。当前 mode 不改变已开 tab、直接 Session 读取或普通 Draft 创建合同。

`packages/app/src/home/sessions/index.ts:61` 在配额前过滤；`mergeHomeSessionIndex:67`（Map 在 `:69`）决定按 Session ID 合并时 known 最后胜出；`:92` 决定省略 DTO mode 按 Coding 匹配。查询中省略 mode 表示 All。共享 `createServerSessionEntries`（`packages/app/src/shell/commands/palette.ts:228`；Map在 `:280`）的 Map 保持 listed 最后胜出。模式与 Project/Agent 分类保持各自 owner。

七字段 owner 比较由 `packages/app/src/home/sessions/controller.tsx:93` 决定：真实 ctx、当前 API getter、Session store、Project、目录、规范化 worktree 集合、mode。`lookup/open/startTransition` 同步检查归属；`packages/app/src/home/sessions/search.ts` 的派生结果、异步提交和选择也核对当前 owner。Scope 变化复用 close，递增 generation 并清除 query/exact/loading；DOM 保留焦点后继续输入会重新打开结果。没有新增 Session cache、HTTP API、abort 协议或执行循环。

声明输出复用公开 ServerCtx/ServerApi，模式控件显式收窄泛型。两个既有类型判断按真实 SessionInfo 与 DOM MouseEvent 边界整理；独立源码复审逐项核对了输入域与原 matcher。

## 失败与最终验证

原 tests-only red：7 unexpected，exit 1，源码/运行时稳定。三例缺模式选择器，四例在 server/Project 范围变化后仍保留旧 query；不是构建或夹具失败。原录入、patch 和 preapply packet 不重写。

首 after v2：16 passed / 2 failed。错误测试前提分别为 Session.update 期待 200（真实 NoContent=204）、child 期待可编辑（真实只读页面）。更正保留精确 GET/parentID/route/title，并检验返回主会话按钮可用。第一次类型检查的私有类型泄漏和 string widening、一次 Show 泛型参数数目错误、31 个增量 lint 问题均各自保留原记录。v3 18/0 后又完成 lint 整理，因此以 v4 的最终字节作验收，不累计重叠数字。

最终字节清单为 [最终源码清单](evidence/v2-home-resume-2026-10-26/final-source-hashes.json)；独立 [独立源码复查](evidence/v2-home-resume-2026-10-26/final-source-review.md) 结论 findings=[]。以下命令均 exit 0，执行期间 source map 不变：

- App typecheck 与 typecheck:e2e，分别记录。
- App test:unit：756 pass / 0 fail，107 文件；保留故障测试产生的 disk full/ECONNRESET 输出。
- App test:browser：168 pass / 0 fail，38 文件。
- canonical lint:changed：显式 HEAD 基线，0 problems / 41 changed GUI files；不是全仓 lint。
- 十个生产文件 AST、十三个文件 Prettier check；AST 保留 postinstall fallback warning。
- production Home keeper v4：18 passed / 0 failed，0 skipped/flaky，单 worker、retries=0。
- production Command palette keeper：6 passed / 0 failed，0 skipped/flaky。

两次后续私有端口 preflight EADDRINUSE 在测试/采样前停止，记录为 0 tests/samples。之后 ss 未捕到原占用者，普通 bind 成功后使用未改的原 runner 接续；不推断占用根因，不计为产品红测。

Entry 每侧 40 样本、Home-index 每侧 80 样本已完整采集。[样本比较记录](evidence/v2-home-resume-2026-10-26/comparison.json) 为 VERIFIED_DESCRIPTIVE_COMPARISON、verificationFailures=[]；对照除本十三源外无漂移，具名 runtime、fixture 与受控参数一致。比较必须核对场景、repeat、runtime、源码、fixture 和受控环境；序贯差值不是随机交错或因果结论，path-level processMs 不能称为隔离 parse 时间，400 churn 子样本不算 400 独立运行。

## 保护与未交付

完整 WIP 备份为 [完整备份记录](evidence/v2-resume-2026-10-26/backup.json) 指向的仓外备份，2524 路径，210346026 bytes，副本与补丁已读核。[WIP保留记录](evidence/v2-home-resume-2026-10-26/wip-preservation-home.json) 核现有路径及新增 tracked 变更；新变更限本十三路径，原 evidence 保留。提交列表由 `git log --oneline 251c0fe38041a326e624db464d1ee0efd1522881..HEAD` 生成，[机器生成提交列表](evidence/v2-home-resume-2026-10-26/commits.txt) 为空。

当前必需 exact scope 缺口已由真实 server cached/pending、Project worktree hydration、迟到响应、继续输入和导航用例覆盖。以下剩余项须保持在 canonical AUDIT-V2-MODE-META / AUDIT-V2-GLOBAL-PARITY / V2-VALIDATION：

- 跨 server 的已选模式持久化完整运行链、每 query variant 的独立可观测回归、真实 durable 删除：Owner App/Core/Server；解除为对应真实用户入口与持久结果，避免重复假测试。
- 五模式完整模型/权限/Custom composition/Meta 用户链：Owner Core/App/Meta；解除为创建、继承、权限与当前 Instructions、重载/fork/compaction 消费。
- packaged Desktop、live provider、旧库、全进程内存和独立 forced-GC：Owner Desktop/Release/performance；解除为独立生产验收。
- Entry 描述性变慢及 P6 归因：Owner App/performance；解除为有瓶颈证据的 profiling 与同环境复验。不能由本轮采样通过宣称性能改善。

Home批准时，下一Command v2后端仍为prepared；后续实施与验收另行绑定。Coding的人类裁决针对工具registry/catalog及叶权限，不自动裁决Command文件的写入目标目录；Assistant个人记忆可见域沿用已保存裁决。

最终批准见 [protocol-approval-home.json](evidence/v2-home-resume-2026-10-26/protocol-approval-home.json)；批准时冻结源码、13份独立记录引用和复查分别绑定 [final-input](evidence/v2-home-resume-2026-10-26/final-input.json)、[源码复查](evidence/v2-home-resume-2026-10-26/final-source-review.md)、[证据复查](evidence/v2-home-resume-2026-10-26/final-evidence-review.md)。[配对结果](evidence/v2-home-resume-2026-10-26/comparison.md)记录入口stable median Home373.10→464.95ms、Session145.10→161.20ms；Home 500/5000/10000行就绪510.45/775.95/987.50→552.65/843.35/1075.05ms，更新run median56.475→58.55ms。各场景n20，仅描述性变慢；归因未关闭。旧entry-only reporter对四个Home场景各20条显示excluded/invalid，因为缺entry字段；原始Home字段validator已独立验证80/80有效，该文案不能当Home收集失败。
