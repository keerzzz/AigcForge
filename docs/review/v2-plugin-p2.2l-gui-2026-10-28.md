# P2.2L Plugin 声明资产 GUI 检查点

2026-10-28，Asia/Shanghai。基线 `ccfa1f22d6df2367f72eebb0f0bb847ab028a64c`，分支 `v2-dev`，固定上游 `4617210822bdbb31e5749751afbfb4584ccedac8`。本片十个源码/测试文件；扩展既有 `skill-proposals`，不新增安装器、运行插件或 YAML 编辑器。

## 用户行为与复用

新增 Plugin 页签、header/命令/窄屏入口和恢复预载；候选来自当前 Session 持久的三项输入及五项 facts。界面展示完整原 YAML，包含 BOM、注释、空白与扩展字段。确认创建和覆盖时都提示共享目录变更可能刷新已有插件；保存结果只表示 `Plugin declaration file saved.`，不表示安装、激活或授权。

[PluginInput/PluginFacts](../../packages/gui-extensions/src/skill-proposals/contract.ts:78) 复用 canonical schema，独立接受 `.plugin.yaml` 短路径；不套用 Markdown 资产后缀。[isPluginCandidate](../../packages/gui-extensions/src/skill-proposals/proposal.ts:484) 在已解码的候选联合上区分 Plugin 与也含 content 的 Skill，供 parser 和面板请求分派复用。[bodyOf](../../packages/gui-extensions/src/skill-proposals/panel.tsx:713) 先处理 Plugin Info，避免把其 source 对象误当 Command 源文。

[current](../../packages/gui-extensions/src/skill-proposals/proposal.ts:326) 决定当前文件和 catalogue 的一致性；[applied](../../packages/gui-extensions/src/skill-proposals/proposal.ts:390) 比较原文、名称、描述和目标路径。Plugin HTTP Info/catalog 使用 canonical JSON codec，正确解码后端合法的 `"NaN" / "Infinity" / "-Infinity"`，不另造数值转换或解析 YAML。bridged 目录项不被当作本地目标；页面不声称 Bridge 扫描已完成。

保存复用现有 owner scope、确认、取消、409 后读取当前版本及显式 CAS。保存不会发送草稿，不触发 Skill 刷新，不主动请求 Plugin 更新或 MCP 连接。对共享目录后台刷新保留准确说明；没有把“GUI 未调用安装”扩写为整个进程绝无副作用。

方案选择是扩展既有分派和面板，避免复制一个新资产框架；技术债仍为分派在解析/请求/展示几处枚举。默认 Project/显式 global 已有人类裁决，但当前仍是 Location-only 接线，未因此关闭该债务。

## 验证与独立复审

[验证清单](evidence/v2-plugin-gui-2026-10-28/validation-manifest.json) 自动记录命令、cwd、退出码、原始 tally、源码/日志哈希。隔离树 `61aaccc0a73656045b44084547ca73bce97e1937`，十文件与主工作区逐字节一致，并固定二十四个后端来源。固定 Bun 1.4.2；主线程包内串行验证，子智能体未运行测试。

| 检查 | 实测结果 |
| --- | --- |
| GUI 全包 | 245 pass / 1 skip / 0 fail；863 expects；33 文件 |
| App unit / browser | 742 pass / 0 fail / 2232 expects；168 pass / 0 fail / 1778 expects |
| 生产 fixture-entry 侧栏 keeper | 31 passed，含 Plugin 三条与现有共享生命周期回归 |
| 扩展 host/graph | 25 passed |
| GUI/App/E2E 类型 | 各 exit 0；其后仅两测试文件空行修订，manifest 保留实际差异 |
| 增量 lint/AST/SDK 文档/格式/diff | 各 exit 0；九个 TS/TSX、五个生产 TS/TSX、十文件格式 |
| 普通 App 生产构建 | exit 0；3156 个产物文件 |
| 普通构建真实 GUI/TCP/FS/SQLite/CAS | 1 pass / 0 fail；137 expects；2 primary / 0 title |

新 parser 在旧实现上得到 57 pass / 11 fail，随后当前实现通过全包。类型检查发现 expected Candidate 的可选路径与 ready 必选路径不一致，已修正测试断言；lint 的九处测试空行已修。初始失败和后续成功均保留，不累计用例数。WSL 单个不适用用例跳过；构建 chunk/Sentry 警告和 AST binary resolution warning 保留。公共 Schema/Protocol/SDK 本片未变，前片生成校验不冒充本片重新生成。

[独立复审](evidence/v2-plugin-gui-2026-10-28/independent-review.md) 对十文件无剩余阻断。预审指出 HTTP JSON codec 缺口，已修并覆盖线上字符串编码。该智能体未编写本片实现或测试；另一个智能体负责 parser 与真实链准备，主线程负责界面、E2E 与全部执行验证。源码 hashes 与最终结果分别绑定。

## 真实链与性能

真实生产 GUI 发出一次 prompt，真实 runner 将 proposal input/facts 存入 SQLite。用户取消后零写入，确认创建后核对原 YAML 字节和 BOM、未知字段、HTTP Info 中 NaN 字符串及 canonical 解码；另一 HTTP 客户端改成新版本和 Infinity 后，同一候选收到 409，界面显示当前完整声明与副作用说明，再经确认带该 revision 覆盖。草稿未自动发送，原持久 proposer 行不变。

此隔离链没有配置其他可执行插件；它确认声明不被发现为执行入口、hook marker 未产生、连接为空。它不能否定前片已经证明的共享目录刷新，也不覆盖实际安装、完整授权、外部 provider、Mode 创建、冷恢复或 packaged Desktop。

Launcher 强制校验父构建的 artifact manifest。归档 `/home/keer/task-backups/v2-plugin-plain-real-chain-20261027T215211Z` 含 7388 文件，逐个复制/哈希回读；604 源码和 3156 服务产物运行前后不变，且产物与普通构建清单相同。归档 manifest SHA256：`99325a1c6e66299f9130c47fd57bc1ace8cfe7492d33a79dadc4878b4f8732b3`，见 [真实链摘要](evidence/v2-plugin-gui-2026-10-28/real-chain-summary.json)。归档名称使用 UTC，因此日期为 2026-10-27。

性能前后各三条路径、每路径五样本，均 15 passed；使用相同 fixture-entry 生产构建与端口。稳定时间 median：cold Session 686.6→707.3 ms、Home→new 417.8→397.3 ms、Session→new 153.3→128.6 ms。只作描述，不能归因或宣称无性能回归；P6 的配对 profiling 与平台测量仍开放。原样本见 [performance-summary.json](evidence/v2-plugin-gui-2026-10-28/performance-summary.json)。

## 剩余范围与现场保护

`AUDIT-V2-ASSET-CONSUMER` / `V2-SERVER-LEGACY` / `V2-D-REFERENCES` / `V2-VALIDATION` 继续开放。Owner Core/Server/App/GUI/Plugin/Desktop 与主智能体。解除条件：Plugin 实际安装、source/hooks 消费与授权；共享目录原生 watcher/HTTP 到执行/网络副作用全链；Bridge/导入/编辑/引用删除；已裁决 Project/global 实际落盘；controller-generation/Location 移动、冷恢复、provider/Desktop/跨平台；Workflow 等剩余资产与性能归因。普通 reload 不等于专项竞态或跨进程恢复。

63 个既有 tracked WIP 哈希保留，包含前片已合并而未提交的 Codegen 生成改动。本片只作十文件、证据/报告和账本增量的本地提交，不 push、merge 或发布。
