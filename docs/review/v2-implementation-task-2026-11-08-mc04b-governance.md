# MC04b 正式实施任务：机械结果到 Judge 与委派治理

2026-11-08。**Root delegated decision：授权本片工程与串行检查。** 实际仓 `/home/keer/workspace/aigcfroge-v2`，现有 `v2-dev` / `9e2c6577ef6dd65c8f01ff94d46da0142bcb877c`。工程聊天使用 `gpt-6.1-sol / max`。默认 `/home/keer/workspace/aigcfroge` 是只读参考；所有命令显式使用实际仓。

## 目标与前置

完成原 MC04b：L0 实际机械结果 → 配置启用且触发的 L1 指定模型 Judge → 必要且获准的 L2 正式委派、review、repair/reconcile → 结果消费与失败复位。PGE 关闭仍保留基础 Verifier 和当前 Permission。

[MC08 最终接受](/home/keer/.codex/outputs/2026-11-07/mc08-r1-runtime-root-v1/root-final-acceptance.json)已关闭 W1/W2/J1/R1/A1；MC04a、MC05、MC07 原接受及代码定位见[本片调查](/home/keer/.codex/outputs/2026-11-08/mc04b-stage-a-v1/findings.json)。原范围见 `docs/research/upstream-v2-sync/2026-11-05-meta-next-session-prompts.md` 的 MC04b 节。已有工程与真实绿组直接复用。

首读目标 CLAUDE 的当前状态及核心协议、根/受影响目录 AGENTS、Tools 规格、`docs/testing.md` 和本仓 Effect 技能。保留当前分支、全部 WIP、文件模式和 staging；Git 提交、重置、清理及依赖升级不在本片。

## 已验证事实与第一性依据

当前 `VerificationRouter.route` 没有产品调用者；`Verifier.verify` 只返回展示文本，`ToolIntegrityPlugin` 只把机械检查报告接到 write/edit/patch 的正式结果。现 Task 已有真实 Judge、Delegation、revision/review 和完整结果出口。

因此本片补真实结果的关联与结算。复用既有执行 owner，不新增模型循环。模型提供窄的观测；级别、执行条件和复位由确定性代码决定，完成仍由原 typed review/barrier 判定。

## 选定合同

1. **L0 结构化结果。** 在现 Verifier owner 返回实际结果与原展示文本，包含每个 package 的状态、变更签名、来源及实际执行结论。状态区分 passed、failed、unavailable、未检查；取消和 defect 沿原 Effect 机制传播。ToolIntegrity 将必要结构化事实放入原 Tool metadata，继续递交原可读正文。复用原权限叶、共享检查 permit、同变更限额和 Verify 事件。
2. **正式 Task 关联。** 原 Task 输入增加可选 `verification`：`source?: { sessionID?: Session.ID; messageID: SessionMessage.ID; id: string }`，以及 `intent?: "content_creation"`。未提供 `verification` 时保持既有 Task 行为。source 定位已保存 write/edit/patch Tool 的结构化机械结果；省略 sessionID 指当前 Session。引用 child 时沿原 Task/receipt 所属关系确认，引用边界解码一次。L1 按实际文件变更签名关联，不要求 Git revision；L2 才沿既有 revision/review 必须条件。
3. **确定性治理。** 沿现 `escalation_enabled` 和 `escalation_threshold`。同一保存结果不重复计数，unavailable/未检查不计代码失败；实际失败和当前级别决定下一步。成功复位依据实际 L0 passed 或原 MC07 有效完成条件。治理结算应能从已保存的 Tool/Task 事实读回；进程内缓存不成为第二权威源。未知外部效果不自动重放。
4. **L1 真实 Judge。** 选中 Meta 的 Work 使用现正式 Judge Task、显式 `judge_models` 和真实 ModelResolver。请求、模型与权限沿现 Task/Session 边界执行；有限验收额度由 Root 运行包承担，不移植为产品全局预算框架。L1 观测仅包含带证据原文锚点的 `contradiction` / `missing_evidence` 等本片必要类型；边界解码并核对锚点。自由文本 approved、空 observations 或 child completed 均不自动判定质量通过。非结构化、部分或失败结果保留可读正文与真实质量；只有有效观测才参与确定性路由。
5. **L2 正式治理。** 在已记录的实际结果、现阈值/级别与显式 L2 调用满足时，复用原内部 Task、当前 revision、typed review、粘性拒绝/撤回、repair/reconcile 和 completion barrier。模型意见不创建 review grant 或 Permission grant。保存各级正式 source、input、receipt、结果及级别结算，后继父请求能消费这些事实。
6. **内容创建。** 显式 `verification.intent="content_creation"` 承载原内容路径，不新增自然语言分类器。该路径可在没有机械 package 时明确记录 L0 unavailable，并在配置启用和本次正式 Task 条件满足时进入 L1。没有机械检查不伪造失败或通过。基础 Build/Plan 的 Verifier 保持既有范围，PGE 通过选中 Meta 的正式 Task 使用。
7. **完成与失败。** 一条消费者串联真实 L0、L1、必要 L2、修复及复位；每步采用实际保存的结果。模型/权限/来源缺条件时返回准确的未派发或不可用事实；失败和取消保留已完成部分。L1 的观测协议不改写现 Judge 的一般输出合同，只用于明确带 verification 的调用。

字段和内部组织可按既有类型作等价实现选择；涉及目标语义的变化给 Root 一个具体场景与最小差额。不要以候选文件数量或旧提示词中的待定字段阻塞常规依赖接线。

## 写入范围与分工

工程聊天主智能体是本片唯一源码写者，拥有串行检查槽。可并行创建只读子智能体做 owner 核对和最终 diff 独审。主要文件：

- `packages/core/src/session/verifier.ts`
- `packages/core/src/session/verification-router.ts`
- `packages/core/src/plugin/tool-integrity.ts`
- `packages/core/src/tool/plugin/task.ts`
- `packages/core/test/tool-integrity.test.ts`
- `packages/core/test/meta-agent-integration.test.ts`

如 Task 的 Router 服务采用直接注入，允许在 `packages/core/src/plugin/internal.ts` 的原 services/requirements 捕获点补最小接线，并在 diff 中说明。也可复用已有 Config/Scope 在 Task activation 构造现 Router.layer；选用真实依赖方向支持的较小方案。新的 Config/Schema/公开 API 差额若由编译或消费者证明必要，回报 Root 当轮裁定。仓内计划、状态和规格由 Root 同步。

输出目录：`/home/keer/.codex/outputs/2026-11-08/mc04b-engineering-v1`。Codegraph 未初始化的既有调查直接复用，精准 rg/源码读取即可。

## 验证与交付

先用一条实际 owner 的 MC04b 消费者 RED 表明接缝缺口，再实现 GREEN：L0 真实失败及来源 → 配置触发 L1 指定模型/完整结果 → 必要 L2 原审阅/修复 → 实际通过复位及完整父消费。补本次新增入口实际改变的关闭、重复来源、不可用、部分失败/取消、过期来源与权限拒绝路径；复用未改变的 MC04a/05/07/08 keeper，不扩完整矩阵。

从 `/home/keer/workspace/aigcfroge-v2/packages/core` 使用现 wrapper：

```bash
/home/keer/workspace/aigcfroge-v2/script/bun run test test/tool-integrity.test.ts test/meta-agent-integration.test.ts --test-name-pattern 'MC04b' --timeout 30000
/home/keer/workspace/aigcfroge-v2/script/bun run typecheck
```

只执行必要受影响回归和变更静态检查；仅因新改动或实际失败补验。交付 before/after、最小 delta、真实命令/cwd/exit/tally、原失败、结构化 L0/路由/receipt/模型/父消费证据及独审。达成工程条件即停写交回，不为交接文案追加检查。

Root 完成限定真实模型与隔离 Native 验收、同步合同并签收 MC04b，再继续 MC09→MC10。本工程任务真实模型/Source/Native/gateway/产品 Codex 预算为 0；工程测试使用现受控模型与隔离本地夹具。

## 风险依据与技术债

新引用入口的错来源或过期变更由保存 Tool/原 receipt 与实际签名判定；模型观测格式错误由该边界 codec 判定；提权或越过拒绝由既有 Permission 和 review/barrier 判定。内部已收窄数据直接使用。

选定简单方案为现 Task 工作流与保存事实的治理接线。独立治理数据库、调度器和跨领域事务没有新增用例依据。跨领域未知副作用恢复、规模 profiling 沿 MC10/V2-C-RECOVERY 等原 owner 和解除条件继续。


## 2026-11-08 Root 最终签收与验收边界

本任务已由 [Root 最终接受](/home/keer/.codex/outputs/2026-11-08/mc04b-runtime-root-v1/root-final-acceptance.json)关闭。真实17请求完成L0/L1/L2、原版本评审修复与屏障复位，三个完整业务结果和八个父Tool全文消费通过。Native场景额外要求模型重复整个治理包装，该要求失败且原exit1保留；依据[范围裁定](/home/keer/.codex/outputs/2026-11-08/mc04b-runtime-root-v1/root-consumer-scope-decision.json)，同次补验采用完整业务正文与原typed owner关联，不把模型重抄控制包装作为额外关闭条件。原产品权限、版本/来源及完整父消费条件保持，同次资源已关闭。后继MC09完整消费者已派发，具体模型运行另由Root绑定。
