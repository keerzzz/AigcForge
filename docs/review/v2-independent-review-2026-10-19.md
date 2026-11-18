# V2 修复独立复核（2026-10-19）

结论：在下面限定范围内，未发现需要阻止本地交付的确定新增回归或为变绿而削弱契约覆盖的修改。此结论来自只读源码复核，不代表整仓迁移完成。

本轮审查工作区为 `/home/keer/workspace/aigcfroge-v2`，基准 HEAD 为 `8b0661b2a`；主代理正在分批暂存，本审查同时读取 `git diff` 与 `git diff --cached`，避免把已暂存修复漏掉。没有改生产源码、测试或 Git 状态，没有再次运行全量。运行时入口与 Fetch 隔离是本审查者自己实施的代码，未作为自己的独立审查结论。

## 配置归一化

`packages/core/src/config/normalize.ts:205` 以 `Struct.omit(Info.fields, [...])` 取代手工白名单。被排除的字段都有前置兼容 owner：update、references、commands、agents、providers、permissions、plugins，以及 skills/MCP/compaction/experimental/watcher/formatter/LSP/model/instructions。当前补集相较原白名单实际补入 `meta`、`cli_agents`、`subagent_attended_default`，未把这些专用兼容字段再次执行通用 overlay。

决定字段验证和覆盖关系的函数是同文件 `decodeEncoded`、`overlay` 与 `prefer`（`normalize.ts:691`、`:762`、`:773`）：通用字段仍按原 schema decode/encode，native 有效值覆盖 legacy 并记 conflict，未知字段仍不会因为补集而透传。对照 `packages/schema/src/config.ts:26` 的 Info.fields，未发现当前字段漏保留或重复归一化。未来新增公开字段直接进入 schema 补集，减少新字段再次被白名单吞掉的风险。

`packages/core/test/config/normalization.test.ts:110` 新增显式 meta/CLI agents/false 布尔值保留断言，同时原 `:122` 的 Info arbitrary JSON round-trip property 仍保留 100 runs。未删去不等价输入、冲突诊断或属性用例。当前代码和测试支持根因修复，而非只改错误输入。

## 流合并测试

`packages/core/test/process/process.test.ts:57` 改为实时时钟用例并验证每条流内部顺序。决定输出关系的是 `packages/util/src/cross-spawn-spawner.ts:276` 的 `Stream.merge(stdout, stderr)`，消费者是 `packages/util/src/process.ts:149` 的 `collectStream(handle.all, ...)`。两条独立 OS pipe 没有在实现中附带跨流写入序号或时间戳，合并按读取到的元素到达处理；本地 Effect Stream.merge 实现进一步委托 Channel.merge。

因此原测试以子进程 10/20ms setTimeout 断言 `out1/err1/out2` 的跨流总序，超出了该合并函数决定的契约，且 TestClock 不能控制子进程的原生定时器。新断言保持 3 行完整性、stdout 的两条顺序、stderr 的一条内容，并保留 combineOutput 后独立 stdout/stderr 为空的契约。不应把这个修改判为放弃已经由实现保证的总序。

剩余覆盖边界：该用例只有一条 stderr，本身不能验证多条 stderr 的次序；原用例也只有一条，所以没有新增覆盖削弱。如果以后要求更强合并契约，应先在 spawner 定义可观察顺序，再相应增加测试，不以延长定时等待模拟保证。

## 其他测试预期

- Watch names 排序由 `packages/core/src/config/watch.ts:35` 的去重后 `toSorted()` 决定；改为 `.agents/.aigcfroge/.claude/...` 与当前函数一致，原所有 name 项和 parent watch 断言均保留。
- Location key 关系由 `packages/core/src/location-service-map.ts:39` 的 `canonical(ref)` 决定，该函数补齐 workspaceID 并在 Windows normalize directory。`packages/schema/src/location.ts:9` 的 constructor 默认补 workspaceID，所以“缺 own key”的输入应为普通结构 `{ directory }`。`location-layer.test.ts:424` 改输入构造后仍验证空缓存、等价 lookup、单一缓存项和相同 context，没有绕过 canonical。
- Bus replay 的编码/解码关系由 `packages/core/src/bus.ts:687` 决定：replay 接受 SerializedEvent，先对 definition.data 执行 decode。`bus-session-routing.test.ts:313` 用 `Schema.encodeSync(SessionEvent.Moved.data)` 准备序列化 payload，保持 silent replay 不广播、更新归属和 published replay 过滤的原断言；这不是修改生产 replay 来迎合测试。
- models-dev 实际 ID 的注册在 `packages/core/src/plugin/models-dev.ts:54`，直接使用 `provider.info.id`。fixture `packages/core/test/plugin/fixtures/models-dev-reasoning.json:116` 的 ID 是 `opencode-go`，不会经过 V1 provider alias migration。`models-dev.test.ts:1071` 改 lookup ID 与该生产 owner 一致，variants 全部断言仍保留。

## 初始 MCP、Permission 与 SSE 修复

MCP 叶权限位于 `packages/core/src/mcp/connection.ts:971`：捕获该 Location 的 Permission.Service，每次实际 execute 都在 RPC 前 assert 当前 session/agent/canonical action，并记录标准 tool source。canonical 命名由 `packages/core/src/tool/mcp-registration.ts:55` 同一函数决定，避免登记名和权限 action 分裂。`Permission.node` 已加入 Connection node deps。`mcp-execution.test.ts` 用真实 Tool snapshot 与 stdio marker 验证无应答者、approve/reject/correct/interrupt、快照后规则改变均不能提前 RPC。

Connection 的 typed mapError 只转换错误通道，DeclinedError 在 `Permission.assert` 的 defect tunnel 仍保留，interruption 也不被转为 ToolFailure。`packages/core/src/permission.ts:337` 将 restore 范围扩到整个 Deferred+timeout 等待，外部 ensuring 清 pending，避免 timeout 组合继承 uninterruptible mask 后将取消拖到 TTL。新测试通过已发布 Asked readiness 后 interrupt，而不是定时 sleep 等待。没有发现将用户拒绝变成模型可继续执行 output 的新路径。

MCP 输出声明在 `connection.ts:970` 保留远端 outputSchema，缺省 `{}`；`toolResultOf` 只有缺远端 schema 才把 JSON 文本转对象，沿用现有 config-driven MCP 的转换规则。原 runtime 的 raw JSON Schema 分支在 `packages/core/src/tool/runtime.ts:128` 只验证 JSON 兼容性；本轮没有扩张为属性类型验证，也不能宣传实现了全部 remote schema 校验。该限制已在主任务交接记录，属于现有契约。

SSE 应答者登记位于 `packages/server/src/handlers/event.ts:22` 的 Stream.unwrap 内：先订阅 EventFeed，再绑定 responder，然后发 server.connected。绑定在消费 stream 的 Scope 内，取消和结束会释放。`packages/server/src/routes.ts:70` 将 ApprovalPresence global node 显式装配；`ApprovalPresence.hasResponder` 的实际筛选函数在 `packages/core/src/permission/approval-presence.ts:82`，普通连接不能保持 Custom ask，capability 通过统一 ProductModePolicy 解析。未发现把连接存在当成授权许可，reply 仍由 Permission 路径裁决。

真实 Web/Node TCP 回归通过生产 createRoutes、公开客户端和 ApprovalPresence/Permission 服务，而非复制业务实现。两种传输都覆盖 reply、断连释放，以及 legacy 与 custom-capable 并存。并发负载下曾有本审查者收取的 Web SSE connect 失败，已在 `v2-project-runtime-2026-10-19.md` 独立保留；没有因为之后有通过证据删除失败或推断其根因。

## 验证范围与未作结论

本轮执行了只读 `git diff`、`git diff --cached`、精准 rg/source ranges。没有新跑测试或全量，因此没有本轮全仓 pass tally。主代理收到的 baseline Core 6949 pass/368 skip/9 fail 属于基线证据，不自动变成当前工作区的结果；净回归必须由同环境当前/基线终态比较。

没有审查当前并行 Phase C/D 的分享、delegation、workflow 新实现，也没有作数据库升级、E2E、Electron 实机或远程发布结论。后续新改动应单独复核。当前限定修复范围的未发现问题，不能用来关闭整体 V2 迁移目标。
