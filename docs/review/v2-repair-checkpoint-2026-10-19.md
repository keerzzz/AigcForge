# V2 既有修复检查点复核（2026-10-19）

接续基准 `8b0661b2a9278373cb020b0998ef0943bb433459`，实现目录 `/home/keer/workspace/aigcfroge-v2`，分支 `v2-dev`。本检查点保存交接已有修复与真实 Node HTTP 回归；整体 Phase C/D 升级仍未完成。

## 实现与复用

- SSE 应答者在 `EventHandler` 消费 stream 的 Scope 内登记，并通过 `ProductModePolicy` 解读能力头；全局 `ApprovalPresence.node` 纳入应用服务图。普通/Custom 共存和断连行为由真实公开客户端验证。
- MCP executor 在构建时捕获 `Permission.Service`，从 invocation context 构造 canonical source；执行顺序为叶权限检查后 RPC。只转换 typed error，decline defect 与 interruption 保持原语义。
- MCP 发现结果保存远端 outputSchema，无声明时使用空 JSON Schema；structured/text/model content 保持现有转换语义。原始 JSON Schema 的属性级验证未扩张。
- Permission.assert 将整个 Deferred 与 timeout 等待放入 restore，取消后 ensuring 清理 pending。
- 客户端通过官方生成器补齐配置字段；本轮再次生成 exit 0，前后文件 SHA256 相同。
- `approval-stream.test.ts` 复用一份业务 fixture 和断言，在 Web 与 Node HTTP 两个真实传输上执行。Node 地址使用既有 `HttpServer.formatAddress`，不复制生产处理逻辑。

上述契约关系由 `packages/core/src/permission/approval-presence.ts:81` 的 hasResponder、`packages/core/src/tool/mcp-registration.ts:55` 的 canonicalToolName、`packages/core/src/tool/runtime.ts:110` 的 encodeOutput 与 `packages/server/src/handlers/event.ts:24` 的 stream Scope 决定；此前证据保留在 [原修复报告](v2-runtime-repair-2026-10-19.md)。

## 本轮验证与限制

证据位于 `evidence/v2-upgrade-2026-10-19/`。统一使用 Bun 1.4.2（初期临时 PATH，之后项目 `script/bun`）。

| 检查 | 结果 |
| --- | --- |
| Core 原修复相关 12 文件 | exit 0；192 pass、42 skip、0 fail，862 assertions，`repair-core.log` |
| Web/Node HTTP approval-stream 首轮 | exit 0；4 pass、0 fail，10 assertions，`approval-stream.log` |
| Server 原修复相关 6 文件复跑 | exit 0；16 pass、0 fail，93 assertions（包括 Web/Node 两种传输），`repair-server.log` |
| Client 全量 | exit 0；224 pass、0 fail，906 assertions，`client-full.json` / `.log` |
| 官方 client generate | exit 0；重生成 SHA256 零漂移，`generated.json` |
| 16 个改动源码/测试 oxlint | exit 0；0 warnings、0 errors，`changed-lint.log` |
| 无缓存根 check 首轮 | exit 2；lint 1487 warnings/0 errors，18/19 typecheck 通过，新增 Node 测试直接读取地址 union 的 port 导致 Server TS2339；`check.log` |
| 上述类型错误修复后 Server typecheck | exit 0，`server-typecheck.log` |

运行时子智能体曾与无缓存 check 并行重跑 approval-stream，得到 2 pass/2 fail（Web SSE readiness 超时），记录保留在 [运行时报告](v2-project-runtime-2026-10-19.md)。不能将该轮描述为绿色，也尚不能断言负载是其根因。上表后续 6 文件复跑通过；完整 Server 隔离结果由接续记录补充。

Core 全量首轮为 6957 pass/365 skip/19 fail；Server 全量首轮为 85 pass/1 skip/1 fail。这些是迁移验收未闭环范围，不由本检查点的定向绿色覆盖。当前正在按配置、编码契约、测试数据和宿主端口归类修复与做基准对照，完整事实在本轮 evidence JSON/log 中。

## 范围和交付

子智能体审查连续因上游资源/流断连失败，本批由主智能体接管审查与 Node 回归。未把失败子任务报告当作独立审查通过。用户已授权可恢复的本地检查点；不执行推送、PR、合并、发布或生产数据修改。

未交付范围及 owner/解除条件登记在 [V2 账本](../technical-debt.md)。提交清单以实际 `git log --oneline 8b0661b2a9278373cb020b0998ef0943bb433459..HEAD` 生成。
