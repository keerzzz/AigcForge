# MC08 W1：Workflow 正文交接、来源与质量

2026-11-07 本片工程与W1/W2共用真实链已由[Root闭环签收](/home/keer/.codex/outputs/2026-11-07/mc08-w2-runtime-root-v1/root-final-acceptance.json)：4次Flash/high请求完成A→B、完整1346 code points原Tool正文的父消费及同次退出。工程合同和此前记录保留如下。

2026-11-07。监督 Root 依据既有人类自主实施委托正式派发本工程片，执行模型 **gpt-6.1-sol / max**。实际仓 `/home/keer/workspace/aigcfroge-v2`、现有 `v2-dev`；默认仓 `/home/keer/workspace/aigcfroge` 只读。完整工程输出写入 `/home/keer/.codex/outputs/2026-11-07/mc08-w1-engineering-v1`，派发和当前 before 见该目录。单一 writer 独占两文件写入及本片串行检查，允许只读子智能体定位和独审。

## 目标与调度依据

现有 Workflow 已通过确切 child/input 读取实际 Assistant，父 handoff 却对普通成功 step 只交 digest。修复这处生产者与消费者接缝，让父模型得到正文、真实来源和完整性状态。

复用 [Stage A 接受](/home/keer/.codex/outputs/2026-11-07/mc08-stage-a-v1/root-stage-a-acceptance.json) 与其已独审调查。原 MC08 正文要求依“对应 MC05–07 链真实成立”；W1 使用已经成立的内部 Session/Task 结果链。决定函数是 `packages/core/src/workflow/execution.ts` 的 `childForStep:217`、`inputResult:255`、`handoff:372`，没有外部 reviewer/completion 调用。此前候选把 MC07 外部真实签收设为 W1 工程前置，扩大了该依赖。Root 以本任务及 dispatch 修订这项调度解释，仅解除 W1 工程等待。MC07 外部真实验收继续开放，MC08 总退出和后继实际 Judge 依赖保持。

先读实际仓 CLAUDE 的第一性原理及当前状态、AGENTS、适用 Core 指南、ARCHITECTURE、docs/testing、Session/Tools 规格；Effect 修改读 `.aigcfroge/skills/effect/SKILL.md`。复用 Stage A 定位，定点回读当前实现；不重做已接受历史调查。保留全部 WIP、暂存状态和文件模式。Git 提交、依赖升级、现用服务不在本片动作内。

## 两文件范围

- `packages/core/src/workflow/execution.ts`：修现 handoff 的正文读取、局部 JSON envelope 的来源/质量及结构完整的限额处理。复用 childForStep、inputResult、assistantText、CredentialScanner、SessionNotification、Session.synthetic。
- `packages/core/test/workflow-execution.test.ts`：扩展现真实 serial、retry/copy 和部分结果 keeper，验证父请求实际消费。模式均保持 `0664`，原字节已冻结。

其它必要差额向 Root 提交决定函数和最小文件集合。公共 Schema、Protocol、Server、generated、持久表、DAG 调度及模型循环均无本片新增需求。仓内文档和债务由 Root 统一同步。

## 用户链与交付合同

已有冻结 Workflow 的 Custom/Meta root → 原 Workflow.run 准入 A→B→END → 实际 child Session/step Task 执行 → B 消费合法前驱 A 正文 → 同 run 的 handoff 持久准入 → 父 Meta 下一请求以普通 user-role 消费实际正文、状态、来源和质量。

1. detail 来自确切 producing child/input 的 InputResult.completed Assistant text，并经现 scanner 脱敏。取消竞态下若 input 已完成，仍交付该正文，同时独立保留 Workflow 的 cancelled 状态与 errorCategory。digest 保留为身份信息。retry/copy 的当前展示 StepRun 与原 producing step/input 分开表达，复用 owning 边界校验后的身份。
2. 在现 envelope 内表达 run/step、当前 StepRun/attempt、实际 child/input/outputDigest 与 complete/truncated/unavailable。字段名称由 writer 按当前局部类型落定，交付列出实际形状。complete 表示所选脱敏正文未截断；缺少 completed 结果时如实 unavailable。失败或取消时保留已完成 sibling 正文。
3. 保持每 step 脱敏 detail 正文 2000 code points；总 handoff 12000 code points 按最终 JSON 转义及包装后文本计算。总包必须仍是可解析 JSON；先缩减可变正文，准确标注截断并保留来源。若合法 Workflow 的最小身份集合本身超限，允许在同 envelope 表达被省略项数量、unavailable/truncated 和 runID 查询引用；不能为了塞入全部身份剪坏 JSON，也不新增第二存储或恢复框架。
4. scanner 在实际正文边界复用，来源作为普通数据进入父请求，保留现 framing。不要为已收窄的内部值添加重复校验。
5. 原 branch/skip/failurePolicy/retry/cancel 状态机、同 run handoffID、first-admission-wins、admit-only→显式 wake、已消费/取消/revert 不复活、events-off 拒绝及 interruption/defect 保持。旧已准入结果不覆盖为新格式。

选择原 owner 内的简单修改；不增加正文存储或通用抽象。技术债仍为 W2 普通 Meta/Task 触发、J1 不同模型 Judge、R1 仲裁/摘要/share/通知和 A1 总闭环；完整恢复与规模归原 MC10。

## 验证

在既有 keeper 中先验证父请求正文缺口，再修复。保存实际 RED、GREEN 和夹具失败；阶段 A 推断不记作已运行测试。

- A→B 的实际父请求得到 A/B 脱敏全文、准确来源/质量和可解析 envelope；B 前驱消费与 Task 结算保持。
- 现真实结果链覆盖 step/总包截断和 JSON 转义，断言可读内容、质量与原限额。用现 scanner 输入验证实际脱敏。
- 对已有 retry/copy 和部分失败用例增加本次 handoff 断言；通知/取消保护面复用已有 keeper，不扩其它 MC 的故障矩阵。

Core cwd `/home/keer/workspace/aigcfroge-v2/packages/core`，使用正式 wrapper，串行执行：

```bash
/home/keer/workspace/aigcfroge-v2/script/bun run test test/workflow-execution.test.ts --test-name-pattern 'executes serial children|MC08 workflow handoff' --timeout 30000
/home/keer/workspace/aigcfroge-v2/script/bun run test test/workflow-execution.test.ts test/workflow-run-events.test.ts test/session-notification.test.ts --timeout 30000
/home/keer/workspace/aigcfroge-v2/script/bun run typecheck
```

修复后进行一次受影响回归、Core 类型，以及两文件 Prettier/oxlint、生产文件常规 AST/Effect 简化扫描和定向 `git diff --check`。使用已安装工具；通过后仅因新改动或实际失败重跑必要差额。等待用现 readiness，不固定 sleep。保留原基线诊断，不把无关旧问题变成本片新增门槛。

## 后继与交回

完整 MC08 后继保持：W2 冻结定义/输入及普通 Meta/正式 Task 触发；J1 指定或预览的实际不同模型 Judge、部分失败/停止；R1 仲裁/摘要质量、内部 share、通知/ACK；A1 原 DAG/Task/结果消费者及真实产品总闭环。MC04b 随后消费真实 Judge/Delegation，MC09/MC10 按原计划。

交付两文件 before/after、最小 diff、逐轮命令/cwd/exit/tally、最终 envelope 和父消费证据、原失败及一份非写者复核。Root 负责工程接受、有限真实消费者及文档；本片工程 Source/Native/Codex/真实模型启动额度均为 0。完成后停止写入并归还检查槽，不自行实施后继。
