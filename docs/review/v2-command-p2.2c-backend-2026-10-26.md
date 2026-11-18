# P2.2C — Command 提案与资产 HTTP 后端

状态：实现和适用验证完成，独立复审 `APPROVABLE_SCOPED`、`blockers=[]`。2026-10-26T02:42:36.715641+00:00 获[限定协议审批](evidence/v2-command-resume-2026-10-26/protocol-approval-command-backend.json)，SHA256 `970a4d29fdac1aece54dbe9eba76ca4ccce15da63f0cfc9af15d190316a551c1`。

唯一实施目录 `/home/keer/workspace/aigcfroge-v2`，分支 `v2-dev`，HEAD `251c0fe38041a326e624db464d1ee0efd1522881`，固定上游 `4617210822bdbb31e5749751afbfb4584ccedac8`。旧产品目录只读；本地未提交。此审批只覆盖后端，不关闭 P2.2 或完整迁移。

## 改动与决定函数

五个生产路径和一个真实 Server 回归文件已绑定在[最终输入](evidence/v2-command-resume-2026-10-26/final-input.json)，SHA256 `80292622a120ecf29a2b215edf4b46c78ac63d9426eaa56f592248ce1d27daae`。

- [propose-command-asset.ts:58](../../packages/core/src/tool/propose-command-asset.ts:58) 复用原 proposer；在 :68 持久提供 relativePath、exists、revision、nameConflict、pathConflict 五事实。正文仍来自 tool input。
- [instance.ts:81](../../packages/core/src/instance.ts:81) 把已有 CommandAsset 与 CommandAssetService 加入公共 roots。输出关系由 [LayerNode.compile:308](../../packages/util/src/effect/layer-node.ts:308) 的私有 dependency provide 与 :314 的 root provideMerge 决定；此处统一补齐服务出口，不新建 registry。
- [command-asset.ts](../../packages/server/src/handlers/command-asset.ts:1)、[asset-stubs.ts](../../packages/server/src/handlers/asset-stubs.ts:1) 和 [handlers.ts](../../packages/server/src/handlers.ts:1) 将现有四个 Command asset HTTP 操作接到 typed owner。沿用 canonical Session/Location、授权、文件变更与原生 watcher。
- [command-asset.test.ts:48](../../packages/server/test/command-asset.test.ts:48) 复用 `Schema.decodeUnknownSync(ProposeCommandAssetTool.Input)`；初始与修改输入经过相同品牌边界，字面值和完整断言保留。

公开 Schema/Protocol 没有变化，本切片不需要生成 Client。现有 Command 模板与 Session runner 消费保持原 owner。简单只接 HTTP 不能证明消费链；当前后端通过真实文件 watcher 与有界模型回归补足这一子范围，GUI 另行验收。

创建时 null revision 只允许新目标。删除的实际比较由 [CommandAssetService.delete:343](../../packages/core/src/command-asset-service.ts:343) 决定：只有非 null revision 才检查当前版本。[HTTP adapter:120](../../packages/server/src/handlers/command-asset.ts:120) 把省略 revision 转为 null。因此显式 revision 支持版本检查；省略 revision 保留 Core 无条件删除语义。本审批不宣称后端强制 CAS。

## 最终验证与保留失败

主线独占测试/构建槽，使用 `script/bun` 1.4.2，实际 package cwd 串行运行。七个记录的 argv/cwd/退出码/log SHA 与六份最终源码逐一匹配，运行前后 7284 项源快照相同。该集合不是完整安装依赖或全运行时快照。

- Server 全包：[最终记录](evidence/v2-command-resume-2026-10-26/command-server-final.json)，155 pass / 1 skip / 0 fail；39 files、7273 expect calls。
- Core 四个相关文件：[最终记录](evidence/v2-command-resume-2026-10-26/command-core-final.json)，44 pass / 0 fail；86 expect calls。不是 Full Core。
- Core/Server 类型检查分别 exit 0；实际脚本分别为 `tsgo -b tsconfig.json tsconfig.tests.json` 与 `tsgo -b`。
- 六文件定向 lint exit 0，实际 1 rule、0 warnings/errors；五生产文件 AST 与六文件格式检查分别 exit 0。不替代全仓 lint。

Server 日志保留两条 `MaxListenersExceededWarning`；AST 保留 postinstall 未运行后的 binary-resolution fallback。通过 tally 不代表没有警告。

初次命令仅输出 Bun help，虽 exit 0，但执行了零测试，明确无效。修正实际 cwd 后的 tests-only red 为 1 pass / 2 fail，缺少持久 relativePath facts 和公共服务；随后 targeted green 为 3 pass / 0 fail。早期 Server typecheck exit 2 的品牌 fixture 错误已在真实解码边界修正。历史轮次、失败、帮助页和日志各自保留，不累加成最终数字。

[最终独立证据复审](evidence/v2-command-resume-2026-10-26/final-backend-evidence-review.md) SHA256 `3250cce9ffa8aa5d91d046056f65b129aad18d1225837956e17546079060b307`；[独立源码复审](evidence/v2-command-resume-2026-10-26/independent-backend-review.md) findings=[]。真实 createRoutes/Location、FS、native watcher 与 Session 投影已覆盖；SQLite 为 `:memory:`，模型为 TestLLM/resolver。不是 TCP/GUI、外部 provider 或磁盘冷恢复证据。

## 开放范围与现场保护

Command GUI、真实 GUI→TCP→FS→native→同 Session 消费、编辑/默认权限/任意 invocation、全局与默认文件系统目标、导入、引用删除、写后失败全范围、平台与 P6 继续开放。Owner：Core/Server/App 负责人与主智能体；解除条件登记于唯一 [technical-debt](../technical-debt.md) 的 `AUDIT-V2-ASSET-CONSUMER` 及 Command 子范围。

原 Home 13 份批准源码仍匹配其审批；后续 Command 变更不倒算为 Home 历史采样期变化。2524 项仓外备份可回读，既有无关 WIP 保留。GUI 候选尚未应用，独立审查发现的两处品牌测试边界正在准备 v2 修正包；原包和原 manifest 不覆盖。

本切片没有 commit、push、merge 或 release。提交列表由 `git log --oneline 251c0fe38041a326e624db464d1ee0efd1522881..HEAD` 生成，当前为空。目标是继续现行 P0–P6，不以此后端审批结束整体任务。
