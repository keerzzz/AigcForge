# MC06-R4 实际 transport 能力与拒绝边界任务

2026-11-06：**MC06 已按本次正式绑定的 app-server 能力与其它 transport 的明确拒绝边界闭环。** [R4真实接受](/home/keer/.codex/outputs/2026-11-06/mc06-r4/root-runtime-acceptance.json)与[同次结果独审](/home/keer/.codex/outputs/2026-11-06/mc06-r4/runtime-v2-result-review.md)确认：显式 sdk 配置的一次正式 Task 在领域准入前返回准确 unavailable；完整127字符错误进入第二父请求，父终答说明不可用。两个 DeepSeek Flash/high 请求均 complete200 且观察到 SSE 终结。无外部请求、Codex启动、领域Task/Delegation/Delivery/child记录或成功receipt。controller/runner、Electron/gateway均退出0，自有Source结束、三端口释放；Source数字退出仍unknown。

[MC06范围裁定](/home/keer/.codex/outputs/2026-11-06/mc06-r4/root-mc06-supported-scope-decision.json)复用前台首片、R1持久结果恢复、R2后台、R3a同turn steer、R3b忙时queue的既有接受，并按原提示词允许的实际能力拒绝完成R4。R4Complete=true、MC06Complete=true；该状态仅指已绑定的app-server功能与准确不可用边界。SDK/ACP/JSONL成功执行、SDK续接/完整结果恢复未交付，沿原owner/unlock登记；不能解释为全部CLI能力完成。MC07Unlocked=true、MC07Started=false，由Root派发后继独立小节。以下早期状态按历史时点理解。

本任务工程、真实与文档退出已满足；明确不可用符合原MC06能力边界。最终源码测试SHA及工程统计沿原工程接受；v1/v2错误转换和SSE观察差异只在仓外。SDK成功功能及更强恢复仍未交付，不在本任务下暗增配置管理或权限绕行。

2026-11-06。Owner：Root。实际仓 `/home/keer/workspace/aigcfroge-v2`；R3b 已按 `mc06-r3b/root-final-acceptance.json` 完成工程、真实链及七文档闭环。本任务已完成独立范围复核；Root 现在授权以下测试白名单与工程检查。生产写入和真实运行仍为 0。

## 原目标与本次选择

原计划 §5.7 要求按真实 adapter 能力准入；无父 Permission callback 的 transport 只有在能强制只读且验证边界时才可执行。不支持的能力应明确拒绝，不能换 transport、造 native 身份或给假 callback。

此前六文件 SDK 前台接线仅是未派发草案。现已核实 SDK 0.146.0 没有父审批回调与 native turn/readResult；固定 CLI 0.162.1 的空 MCP table 递归合并不会清除下层 server，且 MCP 还有插件/Apps来源。不能用 `approvalPolicy=never` 或空配置声明满足所需边界。

对比两条方案：

- 复用当前 `CliAdapter.resolve` 的 typed unavailable，验证 SDK/ACP/JSONL 配置在正式 Task 准入前被拒绝，已有 app-server 能力和目录保持。该方案不新增执行或配置 owner。
- 尝试通过新增有效配置枚举、覆盖、快照及动态 MCP/插件管理建立 SDK 边界；本轮不引入这些配置管理。此选择不证明其它可行的 SDK 只读路线不存在。

Root 选择第一条。明确未交付：SDK 前台成功执行/同 thread 续接、SDK 完整结果恢复，以及其它 transport 尚无的执行能力。它们不能记为已实现。Owner 为原 MC06/CLI/DelegationExecution；解除条件为真实可核的权限/只读、身份及资源生命周期能力和独立任务。是否据此完成 R4 以及 MC06 检查点，必须对照原计划并显式保留未交付账本，不能仅靠一个拒绝测试自动标绿。

## 最小验证范围

先复用当前实现；没有已证明的生产缺陷时不制造 RED 或无必要改动。生产白名单当前为空。如现有 guard 不满足目标，只提交具体决定函数和必要差异给 Root，不能擅自扩入 SDK/receipt/Execution。

Root 现在仅修改 `packages/core/test/meta-agent-integration.test.ts`：复用 `metaSetup` / `externalSetup`、真实 Session/DB/Bus/Task/Permission 与既有受控 app-server peer，允许该测试 fixture 指定现有配置 transport。三个已支持配置值 sdk/acp/jsonl 各只验证正式 Task 被拒绝、父模型消费真实 Tool error、没有新 Task/Delegation/Delivery/child/外部调用或审批，不以注册静态 descriptor 当执行。

复用现有 `packages/core/test/cli-config-adapter.test.ts` 的 typed refusal、Location隔离和目录 keeper；无需新通用测试框架、不跑全仓、不重跑已接受的 app-server 真实链。所有测试/类型/静态检查由 Root 串行执行。测试数据中的受控 provider 与真实模型分开记账。

工程和原实现审查通过后，可冻结一次真实 Native 的显式 sdk 配置拒绝场景：普通 Meta 的单 Task 调用得到正式 Tool error，父模型准确说明不可用；不生成外部成功结果或虚构 child。本轮预算候选为 Source/父/外/总/Codex/Native `2/2/0/2/0/1`，尚未分配；必须由 Root 再绑定具体包、输入、源码/产物、父 DeepSeek Flash/high 与累计账本。外部模型、Codex 启动和额外探活均为 0；首错停止，不自动重跑。

## 现场与交回

保留 HEAD `9e2c6577ef6dd65c8f01ff94d46da0142bcb877c`、分支和全部 WIP；不 stage/commit/push/reset/clean，不安装升级，不修改用户配置或接管服务。默认工作区只读，固定 `script/bun` 1.4.2，测试 cwd `packages/core`；V2 codegraph 未初始化，沿原决定定点读取。

本任务依据已完成的[范围独审](/home/keer/.codex/outputs/2026-11-06/mc06-r3b/r4-capability-decision-review.md)、原 MC06 提示词第206/212行及计划§5.7派发。R4可在正式消费者、限定真实拒绝、独审及文档同步后关闭能力检查点；Root才可在明确app-server支持范围与其它transport不可用/未交付的前提下释放MC07。交回须分清：app-server已接受功能、其它配置的真实拒绝、SDK未交付的执行能力、原失败/unknown和实际新增消耗。当前 R4Complete=false、MC06Complete=false、MC07Started=false；没有新真实授权或无限预算。
