# MC05 首片精确任务单：内部持久协作消费者

日期：2026-11-05，Asia/Shanghai。当前实施者/验收者及唯一资源槽 `/root`；原候选 `/root/mc05` 因宿主限流停止后已明确交接。监督侧已完成原一轮独立复审，Root已接受两文件工程切片；限定Native已执行但原链未完成，当前余项见文末；MC05Complete=false、MC06ProductionUnlocked=false。生产源码不在本次两文件白名单。

目的：复用已接受 MC01 Task/receipt，证明真实 Meta→同 Delegation 两个内部 implementer→两个持久 child→原 child 后继输入→根模型消费 receipt、Meta step/stat、任务结算。复用现有 steer/queue、取消、重复通知、前置拒绝 keeper。只在实际新增消费者暴露失败时提出最小 owner 修复。

非目标：MC06 外 CLI/attended；MC07 revision/reviewer/barrier/fanout repair 治理；MC08 Workflow/Judge；MC04b PGE；MC01/02/03 重验；产品 UI、S1、全模式矩阵、全局 claim/恢复。两普通 implementer 的回答不记为 review。

现场：`/home/keer/workspace/aigcfroge-v2`、`v2-dev@9e2c6577ef6dd65c8f01ff94d46da0142bcb877c`，暂存区空。Root startup-manifest 保留 201 tracked modified / 13945 untracked；首片两个测试文件均已有 WIP，任务前字节已复制并 hash 到 `task-baseline.json`。MC01Complete/MC02Complete 与 MC03 最终三项 true 已由 Root 核验，三文档实际 SHA 匹配。S1 权利不转移。

允许文件候选（根派发前均不可写）：

1. `packages/core/test/meta-agent-integration.test.ts`：沿现有 `metaTest(true)` / `metaSetup` / `TestLLM` keeper，新增一个两 implementer、三个 Task 调用的最小真实消费者；核同 Delegation、child identity、来源、显式模型、完整正文结果、Task revision、独立 Meta step/stat。保留 MC01 单 worker 和 MC03 memory keeper 原文。
2. `packages/core/test/delegation-execution.test.ts`：仅在当前 keeper 未覆盖两 participant 后提交独立失败时新增一个同 Turn 两目标的真实执行用例；复用 `setup`、SessionExecution、TestLLM/Bus readiness。不可扩大 fixture 的全局权限/模型设置；不可占用别人的测试修改。

保护文件：全部生产源码、公开 Schema/Protocol/Server/Client/generated；`Tool`/Plugin/SessionContext/runner；`delegation/service.ts`、`fold.ts`、`projector.ts`、`meta-agent/service.ts` 不先改；`CLAUDE.md`、`AGENTS.md`、账本与计划由 Root 单写；所有 App/GUI/S1。出现可信 RED 后向 Root 提交唯一 owning file 与具体必要 diff，得到阶段派发再修。

决定函数（本轮实际行号）：

- `DelegationService.addParticipant`，`packages/core/src/delegation/service.ts:459`：provider/target/role/context/child/thread 共同决定 participant 复用；executor 不一致拒绝。
- `DelegationService.appendTurn`，同文件 `:553`：同 aggregate TurnAdmitted + DeliveryAdmitted 的 publishAll；证据去重比较完整目标集合与 origin。`bindParticipant :495` 决定 immutable binding。
- `DelegationFold.inputID`，`packages/core/src/delegation/fold.ts:25`：Delegation、完整 deliveryKey 与 attempt 决定唯一 inbox ID；`deliveryKey :209` 决定 Turn/participant/origin/sender 关系。不是时间戳或最近 active 猜 owner。
- `DelegationExecution.dispatch`，`packages/core/src/delegation/execution.ts:537`：核全部 targets/binding，existing child 采用；`:681` stable input admit-only，`:704` 统一 advisory wake。跨 child 不是全域原子事务。
- `DelegationExecution.writeback :277` / `settle :423` / `activate :493`：来源/receipt 核对、独立结算、Task/KV/notification 来源与 once marker；未知副作用保留。
- `TaskTool.Plugin`，`packages/core/src/tool/plugin/task.ts:120`：真实父权限 source；`:371` background flag、`:372` active child 决定 queue；按 locator 或确定 target/role 采用 participant；每次新 Task 准入而不是 exact-payload retry。
- `MetaAgentService.materialize`，`packages/core/src/meta-agent/service.ts:388`：canonical Step/Tool/receipt 来源；`stats :649` 按实际关联与 logical identity 归并，recordedOnly=true、physicalAttemptCoverage=unknown 保留。

原合同不变量：first-admission-wins；durable inbox 先 wake；Location-scoped runner；每 Physical Attempt 一个显式流；M:N 与 root/child/source binding；普通 Agent/Model/Tool 独立；当前父权限逐次判定；interruption/defect 保留；数据与 receipt 不提权；retained Bus unavailable 明确，不默认全开 experimental。

可信 RED：新增跨两个 implementer 的整个生产消费者首次运行若失败即为原缺口证据；现阶段没有执行命令或声称红证。现有单 worker MC01 不能冒充多 participant 接受。已有 keeper 已证明的条件直接复用，不为取得 RED 故意破坏源码。

Root 单一资源槽待派命令（cwd 仓库 `/home/keer/workspace/aigcfroge-v2`）：

- `/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/core test --timeout 30000 test/meta-agent-integration.test.ts --test-name-pattern 'MC05'`
- 若实际增加 execution 用例：同 wrapper `test/delegation-execution.test.ts --test-name-pattern 'MC05'`。
- 受影响既有 keeper 仅定向运行：same child fork (`:1283`)、queued success/later failure (`:628`)、steer safe boundary (`:1364`)、interrupt pending (`:1263`)、close observer (`:1609`)、pending Task notice once (`:439`)、whole fanout precheck (`:1852`)，现有记账可重用；是否运行由 Root 根据实际影响决定。
- 包类型：`/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/core typecheck`。
- 格式/lint：使用 Root 从真实 manifest 核定的定向工具。无需公开 API 或 Client generate；没有产品构建/Native/provider 授权。

命令记录完整 cwd、actual code、pass/fail/filtered/expect tally、freeze SHA、历史失败。受控 TestLLM 与 offline catalogue 不记真实 Flash。

方案对比：现有 Task/Delegation/Session owner 已有完整首片执行链；采用扩展最强 keeper 的简单实现，生产结构不增加。更健壮新 Driver/统计 registry/协作 API 既重复来源也扩大架构成本，当前无实证需要。保留的技术债是真实 Electron+模型多 participant 验收待本片具体预算、外 CLI/attended 和原后继治理/全领域恢复，不以工程 green 消除。

原账本：`AUDIT-V2-MODE-META` / `V2-VALIDATION` 的 MC05 子范围；`V2-C-DELEGATION` 的内部多 participant 产品消费者；Task legacy/PANEL/PERF/SCHEDULE 原 owner/unlock 保留。解除本片工程条件：新消费者和必要 keeper/typecheck 实际绿、独审通过、Root 裁定；MC05Complete 仍需原退出要求的真实验收与文档同步。MC06 实施只在原 MC02/MC05 接受后解锁。

运行包候选另行形成：隔离 Root-owned Home/user-data/config/DB/ports，同源源码/产物，DeepSeek Flash 实际 model/variant、最大 physical 数值与停止规则，完整 Task 3 次调用至少 7 次物理请求的正常路径（根4＋child3），不人为限输出 tokens。取消/不可用场景按已有受控 keeper 复用与原合同决定是否需额外真实请求。当前授权 0，未探活或启动 Native。

## Root 首批派发

Root 已核定文件交集：MC04a 尚未开始源写入；MC05 两个 keeper 与 MC04a detector/Plugin 候选无共同写入文件。只授权本任务上列两个测试文件，新增精确消费者与必要独立失败见证。所有生产文件保护；需要修复时先交真实失败和 owning file，再由 Root 分配。保留 MC03 memory 与 MC01 原有测试。

Root 当前三文件基线（delegation-execution、delegation-service、meta-agent-service）actual exit0、68 pass/0 fail/551 expects，源和依赖见仓外 root-checks/mc05-baseline-receipt.json。该基线未包含本次将新增的 meta-agent-integration 用例，也不是本节完整验收。

实施者不运行检查。Root 统一 tests/typecheck/format/lint 资源槽；完成后冻结最小 diff 交独立复审。新的 provider/Native 请求预算仍为0。

## 限流后的明确交接

实施子智能体在宿主 token rate limit 下中断后，Root 先验证两个文件均与 task-baseline.json 完全一致，再暂停旧实施者写入权，接收两文件测试实现。当前唯一写者为 `/root`；源冻结与该交接分别见仓外 `mc05/root-source-freeze-v2.json`、`mc05/root-takeover.json`。两处新测试共272行，移除新增块后逐字等于原 baseline，未改原 MC01/MC03 WIP。独立复审仍需由非实现者完成，工程检查不替代它。

## 当前工程接受与原生候选（2026-11-05）

原一轮独审已由监督侧完成，无blocker。Root核review/source-freeze/两测试文件的SHA后仅[接受两keeper工程切片](/home/keer/.codex/outputs/2026-11-05/mc04a-mc05-engineering-v1/mc05/root-engineering-acceptance-v1.json)。无需新增复审层或重跑已接受绿组。完整MC05仍false，MC06生产仍锁定。

Root完成[有限Native候选包](/home/keer/.codex/outputs/2026-11-05/mc04a-mc05-engineering-v1/mc05/native-runtime-v1/README.md)，固定DeepSeek/deepseek-flash/high，Build+General及第一child显式续接；最多7次physical/1次Native是拟申请值，尚无授权。运行包不取得MC04a Native检测信用；原任务的其余原生、文档退出条件继续唯一账本。

MC04a工程四项复审修复已接受；MC05候选运行包已绑定其修后Source和Desktop v2产物，旧版保留。人类7次physical/1次Native额度问题已提交，尚未答复；当前provider/Native实际仍为0，不因本工程签收而启动。

## 已授权原生执行与当前余项

人类批准原7次physical/1次Native包后已串行执行。实际[结算](/home/keer/.codex/outputs/2026-11-05/mc04a-mc05-engineering-v1/root-native-execution-disposition-v1.json)：3/7 physical（2完整200、1取消）、Source准入4/7、Native1/1；剩余分别4、3、0。首个Build child成功ALPHA_ONE，General child已有身份但被本地网关429拒绝且无forward4；第三Task/原Build续接ALPHA_TWO与最终根结果仍未完成。上述运行前“授权0/未执行”段落保留为历史，不作为当前预算。

[根因收据](/home/keer/.codex/outputs/2026-11-05/mc04a-mc05-engineering-v1/mc05/native-result-v1/root-cause-disposition-v1.json)绑定批准task SHA314216959effc474c6df493b411fe09dbd3febf2bc6a07e04363f22d038b2b41：slot3记录取消后，forward-ledger.js:68的首次失败停止阻断后继，gateway.mjs:140统一报429；底层取消原因unknown。原Native输入少第261字符、步骤1前一个LF，runner.mjs:259在释放后才查精确正文。controller/runner exit1、原Electron清理TypeError及Source/Electron数值unknown保留。

失败后初步计划（历史，已由下节新选择接续）：工程信用、现有库/Session/Delegation/两个child、Build成功与旧ledger/stop保持。Root只准备输入释放校验及同Session余项候选，须把Source剩3/physical剩4、显式恢复/rearm和新增Native数值做成可审查包后再取得人类对应授权；余4不准许自动重试，禁止重放Build成功或新造替代场景。未交付owner/unlock统一见[唯一账本](../technical-debt.md#2026-11-05-mc04a-原退出完成与-mc05-真实链余项)。MC05Complete=false、MC06ProductionUnlocked=false，MC04a已完成不改变本节出口。

当前相关状态：MC04aComplete=true、MC05Complete=false、MC06ProductionUnlocked=false。

## 新七请求完整场景的离线冻结

后加入participant状态修复已按[补充任务](v2-implementation-task-2026-11-05-mc05-recovery-state.md)实施并接受；仅state.ts一项转换与delegation-execution.test.ts keeper。旧DB不回写。四请求操作方转交proof已归档并撤回测试增量，五请求不绕过failed-participant守卫；当前选用新的隔离完整原三Task链，[选择收据](/home/keer/.codex/outputs/2026-11-05/mc04a-mc05-engineering-v1/review/supervisor-root-mc05-offline-disposition-v1.json)仅授权离线准备。

实施子智能体只写新包的runner/controller/preflight/task/README/approval/server/first-prompt-release；Root单写gateway、manifest、文档并占用唯一命令槽。Root修正实际budgetDirectory字段并复用已有原子writeExclusive；没有新产品接口、恢复Driver或旧库协调器。新包文件及最小diff见[冻结交接](/home/keer/.codex/outputs/2026-11-05/mc04a-mc05-engineering-v1/mc05/full-native-candidate-v2/root-runtime-freeze-handoff-v1.json)。新增屏障4/0、15166文件预检、无批准拒绝均通过；旧已绿组、构建及已接受独审不重复。

[完整新包独审及Root准备接受](/home/keer/.codex/outputs/2026-11-05/mc04a-mc05-engineering-v1/mc05/full-native-candidate-v2/root-runtime-preparation-acceptance-v1.json)已完成，84项只读核对通过；人类新7 physical /7 Source /1 Native批准仍待完成；旧3/4/1保持，累计最大10/11/2。原三真实Task、两participant、首child续接、最终模型Tool消费及正常原退出条件保持；本次准备不取得Native成功信用。MC05Complete=false、MC06ProductionUnlocked=false。

## 首次fresh7失败及私有布局修复

本包已运行且首次Native启动失败，0 physical/0 Source/1 Native消耗与[有限退出接受](/home/keer/.codex/outputs/2026-11-05/mc04a-mc05-engineering-v1/mc05/full-native-candidate-v2/root-native-exit-accounting-acceptance-v1.json)成立；此前“准备通过”是历史工程信用。旧MC05累计现在为3/4/2，没有自动重启。

运行期发现实际Desktop产物放在node_modules桥的旁边，后置desktop模块的三个ESM依赖解析失败。只对新的[私有候选目录](/home/keer/.codex/outputs/2026-11-05/mc04a-mc05-engineering-v1/mc05/full-native-candidate-v3/README.md)做同字节产物重排和实际入口预检，Root为唯一写者；允许文件为该目录下runner base、preflight、artifact-module-resolution和manifests/产物副本。仓内生产、旧包、旧run/DB/ledger、Source屏障与gateway保护不动。新layout对照与15170文件预检通过，[该一次差异独审及Root准备接受](/home/keer/.codex/outputs/2026-11-05/mc04a-mc05-engineering-v1/mc05/full-native-candidate-v3/root-layout-repair-acceptance-v1.json)已完成，无当前阻断。

仅拟申请额外1 Native，并明确重绑定原fresh7未使用7 physical/7 Source；其总量不增加，失败即停。原三真实Task与最终Tool消费者的退出标准保持，MC05Complete=false、MC06ProductionUnlocked=false。
