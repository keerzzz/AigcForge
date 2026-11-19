# MC08 R1 正式实施任务：仲裁、摘要与确切内部分享

2026-11-08 当前验收：**R1 工程及 J1/R1 合并真实验收已接受，MC08 已完成总签收。** [Root 最终工程接受](/home/keer/.codex/outputs/2026-11-07/mc08-r1-engineering-v1/root-engineering-acceptance.json)绑定最终六文件及其模式；工程写入已结束。最终定向检查 4 pass / 0 fail / 80 expects、Core 类型 exit 0；精简前 26/0/202 与原行为回归 6/0/50 按未受影响范围复用。原 AST 全文件扫描 exit 1 是未改 W2 测试的一条既有诊断，本片新增诊断 0。

实际受控链捕获 8 次 TestLLM 请求，父 Task/share 全文、receipt 所属增强 User 与实际请求、目标全文均已核对。删除重复增强输入回显后，Task 正文从 25,149 降至 7,377 字节，目标正文保持 5,082 字节；原 Judge input、增强结果/模型/来源/finish/receipt 保留，增强输入沿 receipt 的 childSessionID/inputID 读取。[MC08 最终接受](/home/keer/.codex/outputs/2026-11-07/mc08-r1-runtime-root-v1/root-final-acceptance.json)记录复用 W2 原全文后的真实 8 请求：两个实际 provider Judge、仲裁、摘要、share 和父/目标消费均完成。Task/share/目标全文分别为 23,695/12,635/11,431 字节。原验收器的末尾 LF 与 synthetic/user 类型前提错误由同次离线 6 项补验纠正，原 controller/runner exit 1 保留；Electron/gateway exit 0、Source 已结束、三端口释放，Source 数字 exit 仍 unknown。独审通过，接续 MC04b。下方是本次工程的正式合同与派发记录。

2026-11-07。**Root delegated decision：正式授权本片六文件工程及串行检查。** 工程聊天使用 gpt-6.1-sol / max，实际仓为 /home/keer/workspace/aigcfroge-v2；应用所选项目的默认 cwd /home/keer/workspace/aigcfroge 是只读参考，请所有工程命令显式使用实际仓目录。

本片绑定[六文件 before](/home/keer/.codex/outputs/2026-11-07/mc08-r1-engineering-v1/before.json)，分支 v2-dev、HEAD 9e2c6577ef6dd65c8f01ff94d46da0142bcb877c。保留全部 WIP、文件模式及 staging；不 stage/commit/push/reset/clean，不升级依赖。Root 负责仓内状态文档，工程输出写入 /home/keer/.codex/outputs/2026-11-07/mc08-r1-engineering-v1。

**本次调度修订。** J1 工程及完整受控父消费者已签收；[v3真实账本](/home/keer/.codex/outputs/2026-11-07/mc08-j1-runtime-root-v3/root-runtime-accounting.json)确认真实父/Flash worker完整200，以及两种模型的实际 child/input/请求准入。Gemini在收到HTTP响应前发生上游请求错误，J1真实闭环仍开放。R1使用的Task/receipt/结果合同已经成立，因此允许独立工程先行；不把外部连接成功新增为本片代码实施门槛。影响范围仅为工程调度，最终有限真实链须补齐两provider结果及完整父/目标消费，才能关闭J1/R1/A1。Root先前“J1真实完成后才派发R1工程”的排序据此修订，产品退出要求保持。

## 目标与前置

在普通 Work 已选 Meta 的正式 Judge Task 上补齐可选仲裁和摘要，再通过原 share Tool 将确切结果递交另一 Session，证明下一目标请求消费其正文、质量和来源。

J1 工程已由 `/home/keer/.codex/outputs/2026-11-07/mc08-j1-engineering-v1/root-engineering-acceptance.json` 签收。W1/W2 工程与真实消费者已闭环。本片绑定下方六文件 before 和 J1 v3 同次账本；工程聊天不重读全部历史。原范围见 `docs/research/upstream-v2-sync/2026-11-05-meta-next-session-prompts.md:278`，既有 owner 调查见本目录 `next-slice-note.md`。

先读 CLAUDE 当前状态及核心协议、受影响 AGENTS 和对应 Effect/测试指南。保留现有 WIP、index、文件模式。仓内状态文档由 Root 同步。

## 第一性依据与选定方案

用户要的是可消费的实际结果。来源由保存的 Tool/receipt 决定，质量由执行状态和真实 finish/text 决定，权限由原 share 叶判定。模型只提供判断和摘要。

选择 Task 的有限增强链，加原 share 的确切结果分支。Task 负责产出，share 负责读取及递交；沿已验证的 Delegation、SessionInputResult、Notification、Session.synthetic 执行。技术债：该实现承担 MC08 内部结果分享，跨领域恢复及链接访问/撤销仍由既有 MC10、V2-C-SHARE-LINK owner 收口。

## 输入和输出合同

1. Task 增 `arbitration_model?: Model.Ref`：出现即请求一次指定模型仲裁。增 `summary?: { model?: Model.Ref }`：对象出现即请求一次摘要；省略 model 沿现 Task/Session 选择并报告实际模型。保留现 `input.model` 的含义。
2. 未请求仲裁时保留 J1 `arbitration:"none"`；未请求摘要时无摘要 child。每个已请求增强复用真实 fresh child、准确 input/receipt 和原 runner。只在对应增强配置边界解析一次显式模型；不可用时保留原 Judge 结果并说明原因。
3. 仲裁读取 workers 结算后的确切完整包。摘要读取同一原包及实际仲裁结果。完整结果文本、实际模型、source、receipt、finish/needsContinuation 和增强状态进入最终父 Tool 正文；增强输入沿 receipt 的 childSessionID/inputID 读取已保存 User，不在父结果重复回显。成功、部分、空文本、失败、取消和 unavailable 按实际事实表达；保留 J1 成功部分，父 interruption 沿原取消路径传播。
4. aggregate 仍由 Task 原 owner 一次 CAS 结算。各增强 worker 的 TaskLink 指自身，不让单个 worker 结算 aggregate。沿用 J1 已验证的 receipt JSON metadata 编码。
5. 原 share Tool 增 `scope:"result"` 与 `result_source:{messageID,id}`；继续 sourceSessionID、targetSessionID、trigger。模型只选择已保存结果的定位符。
6. share 外部引用进入的边界，按 sourceSessionID/messageID 读取确切保存的消息，按 Tool id 选 completed Task，解码现 JudgeOutput 一次，取实际摘要或明确 fallback。保存 Tool 后新增 Assistant 不改变这次分享。边界位置遵循依赖方向：可在 share Tool 中复用 TaskTool codec并把已收窄数据交给 share-v2；Session domain 不反向依赖 tool/plugin。
7. share 返回实际 target/inbox、原结果定位、递交状态及确切正文依据。正文携带摘要/可读部分或原结果 fallback、质量和来源；目标保存 synthetic 消息；模型请求转换将其映射为 role=user，故这些消费信息须在正文中。

## 递交和必要守卫

- 保留现 share Tool 的 `permission.assert` 一次：真实调用者与 source/target resources 在准入前决定权限。Task 不嵌入第二条 share 路径。
- 稳定递交 ID 由真实 share Tool Context source、target 和 result_source 派生。同 intent 重试返回原 admission；明确的新调用仍是新 intent。无需模型提供 hash、provenance 或新 intent 参数。
- 复用 Notification.inspect 与 admit-before-wake；在新增接缝处理它已返回的状态，不复制生命周期状态机。share 返回准入/唤醒事实，不等待目标模型 idle；消费信用来自目标实际请求。
- 三类守卫有具体依据：错模型由 ModelResolver 判定；错来源由保存 Tool/SessionInputResult 的 owning 关系判定；越权由 share 叶判定。内部已确认 receipt/typed 包不再重复解码。模型判断不产生治理批准或 Permission grant。

## 六文件写入范围

本工程聊天主智能体独占以下六文件：

- `packages/core/src/tool/plugin/task.ts`
- `packages/core/src/session/share-v2.ts`
- `packages/core/src/tool/plugin/share.ts`
- `packages/core/test/tool-task.test.ts`
- `packages/core/test/meta-agent-integration.test.ts`
- `packages/core/test/tool-share.test.ts`

复用现 Session/Delegation/Model/Notification owner。若实际编译或消费者失败证明还缺依赖接线，回传决定函数和最小文件差额，由 Root 当轮裁定。源码、测试和生成产物分清；generated 沿正式生成器。

## 验证与停止条件

工程检查由 Root 串行分配。先用一条消费者 RED 证明新增能力缺口，再完成以下 GREEN：

1. 一条实际 Work Meta Task：J1 原包 → 仲裁确切 input/result → 摘要确切 input/result → 原 share → 目标请求；下一父请求和目标请求中的完整正文、来源与真实模型可读回。
2. 定向覆盖本次新增的未请求增强、显式配置错误和失败/length/empty/cancelled fallback。复用 J1 已接受模型/取消/CAS例，只补被增强链改变的行为。
3. 新分享接缝证明确切来源不随最新输出漂移，同 intent 不产生第二次准入，权限拒绝无目标准入；由原 inspect 生命周期例支撑不变逻辑，只补新增入口需要的调用断言。
4. Core 类型、实际变更的静态检查和受影响回归各跑必要一轮。只有改动或失败相关项才重跑。不要把原通知全矩阵、无消费者的文档哈希或全链重复 receipt 校验变成本节新门槛。

从 `/home/keer/workspace/aigcfroge-v2/packages/core` 使用现 wrapper：

```bash
/home/keer/workspace/aigcfroge-v2/script/bun run test test/tool-task.test.ts test/meta-agent-integration.test.ts test/tool-share.test.ts --test-name-pattern 'MC08 R1' --timeout 30000
/home/keer/workspace/aigcfroge-v2/script/bun run typecheck
```

交付最小 delta、before/after、实际命令/cwd/exit/tally、失败记录、增强 receipt/模型/Task CAS、父与目标全文消费证据。绿色检查满足本节条件即交回 Root；不为假想失败扩矩阵。Root 独审后绑定有限真实运行。本工程任务的真实模型请求/Source/Native/gateway/产品Codex预算均为0。

## 执行分工与交接

- 你是六文件唯一实施者，并拥有本片串行测试/类型/静态检查槽。可以创建只读子智能体做 owner 核对和独立 diff 复审；避免多个并行源码写者。已有 Codegraph 未初始化的调查直接复用，精准 rg/源码读取即可，不建索引。
- 按一片两段实施，先仲裁/摘要，再确切 share 和目标消费。已有受控用例与规范依据足够时直接改动；只因实际错误追加验证，避免重新调查完整MC历史和建立新校验矩阵。
- 独审聚焦本片改动的正确性、依赖方向、权限叶、取消和全文消费。完成必要检查后交回 before/after、最小delta、检查收据、原失败、独审结果与简短结论，随即停写并归还检查槽。
- 范围外缺口只回传具体决定函数、失败信号与最小文件差额，Root当轮裁定。不要修改仓内文档、自行派发后继或向其它聊天发消息。
- Root接续有限真实验收及A1总闭环，再沿MC04b→MC09→MC10推进。
