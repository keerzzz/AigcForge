# V2 配置与测试契约修复（2026-10-19）

本批在 `v2-dev` 接续运行时检查点，修复原 HEAD `8b0661b2a` 可复现的配置丢失与测试边界偏差。它不代表 Phase C/D 已交付。

- ConfigNormalize 从 `Info.fields` 排除已有专用兼容处理字段，复用 Schema 保留 `meta`、`cli_agents`、`subagent_attended_default`。决定校验与覆盖关系的是 `packages/core/src/config/normalize.ts` 的 `decodeEncoded`、`overlay`、`prefer`，没有新增第二份字段白名单。
- Location 缓存测试以普通结构表达确实缺少 workspaceID own key 的输入；归一化由 `packages/core/src/location-service-map.ts:39` 决定。
- Bus replay 测试先用事件 Schema 编码 payload；`packages/core/src/bus.ts:687` 的 replay 接收序列化事件再解码。
- Config watcher 的预期顺序遵从 `packages/core/src/config/watch.ts:35` 的 `toSorted()`；models-dev lookup 使用 fixture 中的 `opencode-go`，注册关系由 `packages/core/src/plugin/models-dev.ts:54` 决定。
- Process 合流测试使用真实时钟，验证四行完整性及 stdout/stderr 各自顺序。`packages/util/src/cross-spawn-spawner.ts:276` 的 `Stream.merge` 不提供跨独立管道的写入总序；移除依赖 10/20ms 定时器的错误总序假设。
- Server Fetch 测试统一通过 scoped 配置目录构建真实 handler，阻止用户 JSON/MCP 配置进入测试。行为与限制见 [隔离报告](v2-server-test-isolation-2026-10-19.md)。

## 验证

统一 Bun 1.4.2；Core 测试从 `packages/core` 运行，Server 从 `packages/server` 运行。原始日志保留在 `evidence/v2-upgrade-2026-10-19/`。

| 检查 | 退出与结果 |
| --- | --- |
| 原 HEAD Core 全量，UID 1000 / 无 capability / 独立网络 | exit 1；6954 pass / 365 skip / 7 fail / 106084 assertions，`baseline-core-user.json` / `.log` |
| 原 HEAD 首次 root 映射网络隔离 | exit 1；6949 pass / 368 skip / 9 fail，`baseline-core-full.json` / `.log`；两个权限失败仅在该环境出现，已改普通用户重跑 |
| 修复后 Config/Location/Bus 五文件 | exit 0；112 pass / 0 fail / 639 assertions，`core-contract-fixes.log` |
| models-dev/process 两文件 | exit 0；40 pass / 0 fail / 167 assertions，`core-fixture-fixes.log` |
| 七文件合并验证初轮 | exit 1；151 pass / 1 fail / 802 assertions，`core-contract-final.log`；并行 share 注册已生效，Location 精确工具列表尚未包含 share |
| 七文件工具列表接线后 | exit 0；152 pass / 0 fail / 806 assertions，`core-contract-integrated.log`；包含 share 工作区改动，share 随下一批独立交付 |
| Server 隔离后全量 | exit 0；86 pass / 1 skip / 0 fail / 5804 assertions，详见隔离报告 |

七文件命令：`../../script/bun run test --timeout 30000 test/config/normalization.test.ts test/config/config.test.ts test/config/watch.test.ts test/location-layer.test.ts test/bus-session-routing.test.ts test/plugin/models-dev.test.ts test/process/process.test.ts`。

基准七个失败依次为 Location canonical 测试、Bus replay 编码、ConfigNormalize 属性保留、三个 watcher 排序、models-dev provider ID。Process 时间总序在基准这一轮未失败，不将其称为稳定基准失败。

保留操作失误证据：`core-contract-share.log` 是一次补丁脚本使用错误相对路径后仍启动测试的重复失败，退出 1，151 pass / 1 fail；随后修正路径并运行上表最后一轮，没有覆盖该失败日志。

独立只读审查见 [复核报告](v2-independent-review-2026-10-19.md)。审查后将 stderr 加到两行，补齐其内部顺序断言；其他结论保持原范围。修改后 Core 全量及最终根 `./script/bun run check` 仍须完成。

未交付范围继续登记于 [技术债账本](../technical-debt.md)，Owner 为主智能体；解除条件为真实全量退出、生产纵向链和剩余验收证据。本地检查点获用户授权，未执行任何远程交付。
