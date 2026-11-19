# P2.2S Prompt 所选目标后端限定检查点

日期：2026-10-28。实施仓 `/home/keer/workspace/aigcfroge-v2`，分支 `v2-dev`；参考仓只读。基线 `e93c4bebd70e90098f2f3fad8f76b7f48e4c7a47`，固定上游 `4617210822bdbb31e5749751afbfb4584ccedac8`。本片范围见 [scope](evidence/v2-prompt-placement-backend-2026-10-28/scope.md)，18 个源码/测试/正式生成路径见 [files](evidence/v2-prompt-placement-backend-2026-10-28/files.json)。

## 已交付行为

Prompt 接入 canonical Inspection、显式 scope 的 inspect、单 owner list/content 及可选 target 的 apply/delete。Project 是当前 worktree/clone 的项目根，global 是当前 Global.config 下的 prompts，Location 是当前目录的 .aigcfroge/prompts。省略 scope/target 保留旧 Location 合同；本片未切换 proposer 与 GUI 默认。

目标由 [AssetPlacement.resolve](/home/keer/workspace/aigcfroge-v2/packages/core/src/asset-placement.ts:41) 重算；[targetMismatch](/home/keer/workspace/aigcfroge-v2/packages/core/src/asset-placement.ts:74) 用 scope/root 判断相等。目标检查先于 CAS，事务进入 [apply](/home/keer/workspace/aigcfroge-v2/packages/core/src/prompt-asset-service.ts:290) 的共享绝对路径锁后再次解析。服务端没有历史 inspect token：Project 与 Location 在项目根合法解析到同一物理 root 时，两种目标各自有效；前端重新选择后的确认由下一片负责。

保存前固定预期 bytes/hash；首次回读、完整 Info 和 owner 身份均要匹配，失败时以本次预期字节判断回滚所有权。selected 现存删除要求当前 revision，缺失且无 revision 幂等，缺失但持旧 revision 冲突。legacy null 无条件删除及缺失文件的旧幂等行为保留。完整 template 往返保留 BOM/CRLF、空白和占位符，不自动执行。work.asset_saved 仍只含 relativePath。

Prompt 原 catalog 建图即加载；[select/read](/home/keer/workspace/aigcfroge-v2/packages/core/src/prompt-asset.ts:191) 在物理 root 等于 canonical Location ownerRoot 时同步 eager cache，在返回投影才附 target。旧 Custom sourceLocation、冻结正文及引用解析没有改写。没有依赖 FileMutation 人工发 watcher 事件。

## 验证结果

root 在隔离仓使用已核实的 Bun 1.4.2 串行执行，测试使用包 cwd，类型使用包脚本及资源限制。命令、cwd、时间、退出码、原始 tally、日志 SHA 与本轮源码相对最终字节的差异见 [validation-manifest](evidence/v2-prompt-placement-backend-2026-10-28/validation-manifest.json) 和 [verification-summary](evidence/v2-prompt-placement-backend-2026-10-28/verification-summary.json)。运行权威是前后工作字节 hash；JSON 的 sourceTree 是旧普通 index reference，不能代替实际执行源码。

| 执行面                                               | 原始结果（不累计重跑）                                                                  | 日志 label                 |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------- |
| Core Prompt/Skill/Command/Composition 相关（8 文件） | 212 pass; 0 fail; 1687 expect() calls; Ran 212 tests across 8 files. [10.80s]           | `core-related-final`       |
| Schema 全包                                          | 415 pass; 0 fail; 1569 expect() calls; Ran 415 tests across 44 files. [417.00ms]        | `schema-full-final`        |
| Client 全包                                          | 233 pass; 0 fail; 1008 expect() calls; Ran 233 tests across 20 files. [37.23s]          | `client-full-final`        |
| Server 全包（品牌期望修复前；生产字节相同）          | 191 pass; 1 skip; 0 fail; 8875 expect() calls; Ran 192 tests across 44 files. [114.88s] | `server-full-final`        |
| Server Prompt 修复后（最终测试字节）                 | 10 pass; 0 fail; 320 expect() calls; Ran 10 tests across 1 file. [12.96s]               | `server-prompt-repaired`   |
| Core 类型                                            | exit 0                                                                                  | `core-types-final`         |
| Schema 类型                                          | exit 0                                                                                  | `schema-types-final`       |
| Protocol 类型                                        | exit 0                                                                                  | `protocol-types-final`     |
| Server 类型                                          | exit 0                                                                                  | `server-types-repaired`    |
| Client 类型                                          | exit 0                                                                                  | `client-types-final`       |
| GUI 类型                                             | exit 0                                                                                  | `gui-types-final`          |
| App 类型                                             | exit 0                                                                                  | `app-types-final`          |
| App E2E 类型                                         | exit 0                                                                                  | `app-e2e-types-final`      |
| Protocol 正式生成稳定                                | exit 0                                                                                  | `protocol-generated-final` |
| Client 正式生成稳定                                  | exit 0                                                                                  | `client-generated-final`   |
| 17 TS 文件 scoped lint                               | Found 0 warnings and 0 errors.                                                          | `lint-scoped-verified`     |
| 13 手写 TS 文件 AST                                  | exit 0                                                                                  | `ast-scoped-verified`      |
| 限定源码/生成物 Prettier                             | All matched files use Prettier code style!                                              | `format-final-verified`    |
| 限定 diff --check                                    | exit 0                                                                                  | `diff-final-verified`      |

Server 全包有一个既有 hg skip 和 MaxListenersExceededWarning，未声明无警告。全包后仅将三处测试期望用 canonical AbsolutePath/Template 构造；生产未改，最终 Prompt keeper 与 Server 类型重跑通过。其他包不会因这三处 Server 测试期望改变而重跑。lint:changed 首轮没有扫描到 GUI 变动文件，不用它证明后端 lint。AST 最终绿色只覆盖 13 个手写文件；首次 17 文件全范围扫描的生成 SSE cast 仍是独立债务。

Core 覆盖真实 Git child/worktree/clone、非 Git owner、路径/链接拒绝、多 owner 同路径、selected/legacy CAS、共享绝对路径锁下的多 Location apply/apply 与 apply/delete、首次回读恢复及完整 Info 校验。Server 通过真实 Web Request handler、FS/SQLite 与 TestLLM 验证认证/Session 归属、三 scope、目标篡改、typed 404、创建 flag、保存零新增模型请求，以及显式提交后同 Session 的精确新 user 正文。它们不是普通浏览器/TCP、外部 provider 或 Desktop 验收。

## 失败与合同纠正

所有原始失败保留，见 [独立复审](evidence/v2-prompt-placement-backend-2026-10-28/independent-review.md)。未把失败轮覆盖成通过，亦未累计相同测试的多轮数字。

1. Schema/Core 初始红分别为 32 pass/10 fail 和 24 pass/50 fail；包括接口缺失以及旧路径锁、首次回读恢复、完整 Info 等真实行为断言。初期 Client runtime/type 两轮误重叠 6.05 秒，见 schedule-correction.json；保留诊断结果并串行重跑，不作为串行执行证据。
2. 旧 revision 的 Schema.optional wire 原本接受 null；Effect 省略业务输入会编码 null，Promise 省略字段。保留 codec。验证仓生成器 renderPromiseTypes（packages/httpapi-codegen/src/index.ts:799、806）使用 Schema.toEncoded；effectType（:483、484）与 effectInputSchema（:521、532）使用 Schema.toType；normalizeTransport 的 sameEncoding 分支决定变换后的完整 payload 保留。新增 target omission transform 后正式 Promise 类型反映 null，Effect decoded 仍是 optional string。修测试而未收窄生产；不能归因于原本已具名的 payload 名称。
3. nested directory symlink 的 list 返回空：packages/util/src/glob.ts:18 默认不跟随目录链接。测试改为安全跳过，并保留显式路径拒绝和外部字节不变断言；没有改生产扫描跟随链接。
4. server-first 缺 handler 闭合括号，0 pass/1 fail/1 error，未执行路由合同。补括号后 9 pass/1 fail：未知 workspace 由 packages/server/src/middleware/workspace-routing.ts:64–65 先返回 404，早于 :79 handler 和 handlers/asset-location.ts:43 的 Session 比较。修正未知 workspace 预期；缺 workspace、错 directory 的 409 保留。
5. Core/Schema/Client/Server 初次类型失败分别是品牌期望、可选 Target 守卫和错误 null 负断言。使用 canonical 类型修正并保留真实行为断言；最终结果单列。两处手写 value alias 已改为 canonical 直接导入。正式生成 Promise SSE 的 `yield JSON.parse(data) as A` 与基线相同，在唯一账本登记 owner 和解除条件。
6. 五个生成文件与原 WIP 三方合并时，types.ts 中原 ConfigMCP 插入紧邻本片 PromptAssetListResponse 替换而冲突；首轮在任何主文件写入前停止。限定按完整类型块保留 ConfigMCP 与正式 Prompt 列表定义，正反两向验证恢复原 WIP 精确字节，见 generated-merge-result.json。未手改正式提交产物或 codegen 源码。

## WIP、复审和后续

原 64 项 tracked WIP 保留：58 项字节不变，5 个生成文件可逆合并，账本保留原前缀并追加本片。另有 13 个冻结边界文件在工作和验证副本均保持原 pin。提交采用隔离仓正式生成 blob；主仓生成文件继续含原 WIP。提交准备前普通 index 为空，见 [WIP 记录](evidence/v2-prompt-placement-backend-2026-10-28/wip-preservation-final.json)。

独立 reviewer 只写本片报告，复核源码、原始日志、合同纠正和冻结边界；最终结论以 [independent-review](evidence/v2-prompt-placement-backend-2026-10-28/independent-review.md) 的最终段为准。实际本地提交和提交列表另由 Git 命令生成，不手写，不 push、merge 或部署。

下一片按 [Prompt GUI 实施计划](evidence/v2-prompt-placement-backend-2026-10-28/next-gui-implementation-plan.md) 同步交付 proposer 默认 Project、显式 global、canonical metadata、审阅确认与 saved target/revision 精确回读后增量插入。保存和插入不发送、不展开模板；不擅自增加 Prompt GUI 删除。未交付的 GUI、跨 owner Custom、其余四族、编辑/导入/引用删除、Workflow/Composition、跨进程与平台范围已登记唯一 [technical-debt.md](../technical-debt.md) 的本片追加，均含 owner 与解除条件。
