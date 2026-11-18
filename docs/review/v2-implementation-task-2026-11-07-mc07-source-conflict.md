# MC07 source 单因素冲突：正式测试补证任务

2026-11-07：**MC07 source 单因素补证已签收。** [Root 最终接受](/home/keer/.codex/outputs/2026-11-07/mc07-source-conflict-engineering-v1/root-final-acceptance.json)确认 govern 的准确来源冲突拒绝、原 completed 结果/事件保留及私有夹具恢复后的精确重入。仅新增一条既有测试；最终1 pass/0 fail/36 expects，Core类型与定向静态通过，模式0775。proofFor/recordRevision的原R2片段与日志逐字相等，复用17/0/264；两次类型失败及备份副本模式误判的额外交付检查exit1分别保留，原仓文件身份已由Root核实。`SourceKeeperComplete=true`，`MC07Complete=false`。检查槽归还Root，下一步完成fanout有限真实包的冻结、检查、复审和签发；外部reviewer/completion后续仍按原owner推进。下方为此前时点记录。

2026-11-07。监督 Root 在 fanout 工程接受、相关 govern 字节未变及检查槽空闲后正式派发本测试补证，和零运行的 fanout 包准备并行。新工作会话及子智能体模型均为 **gpt-6.1-sol / max**。实际仓 `/home/keer/workspace/aigcfroge-v2`，默认 `/home/keer/workspace/aigcfroge` 只读；保留分支、全部 WIP、文件模式。一个实施者、一个串行检查 owner，监督 Root 负责最终签收及仓内文档。

[Root 顺序裁定](</home/keer/.codex/outputs/2026-11-07/mc07-source-conflict-engineering-v1/sequence-decision.json>)确认本测试不依赖 fanout 的真实运行结果；[前序工程接受](/home/keer/.codex/outputs/2026-11-07/mc07-fanout-engineering-v1/root-engineering-acceptance.json)、[before](</home/keer/.codex/outputs/2026-11-07/mc07-source-conflict-engineering-v1/before-files.json>)、[正式派发](</home/keer/.codex/outputs/2026-11-07/mc07-source-conflict-engineering-v1/dispatch.json>)构成本次绑定。输出目录 `/home/keer/.codex/outputs/2026-11-07/mc07-source-conflict-engineering-v1`。本会话主智能体独占工程写入与串行检查槽；最终通过后停止写入并交回监督 Root。

唯一测试文件当前模式为 **0775**，必须保留；现有字节 SHA256 `cb1fd9d3b49a22f02f9bd042e779e5e40464761ed4f18931e193407c4bb304ae`。不得因常见测试模式为0664而改写。原目录的阶段 A / prompt / review 保持历史；当前权限以上述具体正式绑定为准。

## 首读与目标

首读实际仓 CLAUDE.md 第一性原理、AGENTS.md、packages/core/AGENTS.md、test/AGENTS.md 与 docs/testing.md；复用[阶段 A](/home/keer/.codex/outputs/2026-11-07/mc07-source-conflict-stage-a-v1/report.md)。Codegraph 未初始化时定点 rg/读取，不建索引或安装依赖。

原 MC07-R1 source 单因素条目涉及 govern、proofFor、recordRevision 三个实际比较。阶段 A 已逐字核对当前 R2 keeper 和原 17 pass/0 fail/264 expects 证据，覆盖后两者。此次只补 **govern 对留存 governance.source 的直接拒绝与原结果保留**。白名单唯一文件：`packages/core/test/meta-agent-integration.test.ts`。生产、Schema/事件/SQL迁移、其它测试和仓内文档只读。

当前 guard 已存在，本片预期是补 GREEN 证据；禁止制造强制生产 RED 或修改生产代码。若 keeper 失败，先证明确实仅变 source 且命中原 govern 比较；必要生产差额连同决定函数回 Root，不自动扩大。

## 最小 keeper

复用现 metaSetup、mc07Build/mc07Result、TestLLM、真实私有 Session/DB/Bus/Delegation 和原 R1 recover 精确重入路径。新增测试名称含 `MC07 source`。

1. 实际 Build Task 产生 R1 与 completed settlement，保存原 KV、原 TaskLink/User、完整事件流、fold 及 receipt/source/digest/artifact。
2. 仅在该**私有测试夹具**的既有 KV settlement 中，把 `governance.source.id` 替换成另一合法字符串；其余字段保持。比较 before/after，证明唯一语义差额就是该 id。不要修改真实验收 DB，不手种 producer/review 事件。
3. 沿现 execution.recover → settle → govern 入口触发源比较。判定由 [execution.ts](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/execution.ts) 的 govern 决定：确认实际 `attemptedTransition: "govern"` 和源码中精确 reason。调用入口失败、receipt 不匹配或其它前置拒绝不取得 source 比较信用。
4. 验证旧事件、revision/review、producer receipt/正文不变，没有新增 approval/grant；失败 settlement 的实际状态按原 owner 保存，不用测试抹掉失败事实。
5. 恢复原 KV 字节后，经同一现有重入入口拿到原准确结果，证明没有新 revision/review 或重放执行；恢复动作仅为测试安排，不实现产品自动恢复。

先核对目前 guard 和原 R2 keeper与阶段 A 的版本差额；已有同等直接证据可复用。跨同步使用 Deferred/Bus/llm.wait 或现有 readiness，不用固定 sleep、不引入新的 fixture 抽象或 mock Runtime。

## 检查与交付

取得 Root 独占检查槽后，cwd `/home/keer/workspace/aigcfroge-v2/packages/core`：

```bash
/home/keer/workspace/aigcfroge-v2/script/bun run test test/meta-agent-integration.test.ts --test-name-pattern 'MC07 source' --timeout 30000
/home/keer/workspace/aigcfroge-v2/script/bun run typecheck
```

cwd `/home/keer/workspace/aigcfroge-v2`：

```bash
node_modules/.bin/prettier --check packages/core/test/meta-agent-integration.test.ts
node_modules/.bin/oxlint packages/core/test/meta-agent-integration.test.ts
git diff --check -- packages/core/test/meta-agent-integration.test.ts
```

原 proofFor/recordRevision 既有通过证据与当前对应 keeper/比较未变时直接复用；若确有内容差额，只补运行受影响 keeper，不重复整仓回归。保存每轮 command/cwd/exit/tally/stdout/stderr、文件 before/after与模式、最小 diff、原错误和前后事件数，以及一次非写者只读复审。失败轮次保留，谓词数与产品测试数分开。

本片是一个既有已验收产品能力的测试证据缺口；所有 Source/Native/Codex/模型预算为0，不新建或重放真实场景。Root 依据三条 owning 比较的直接证据解除 source keeper 条目，不由本片关闭整个 MC07。原 Job cause 正文、Git 授权时序、外部 reviewer/completion、通用 capture、未知效果恢复和后续 MC08/MC04b/MC09/MC10 继续沿唯一债务账本 owner/unlock；不另造矩阵或债务账本。
