# P2.2J MCP 资产 GUI 检查点

2026-10-27。基线 `5f3b7919a93cbbb12fc325c88d6d9a0ec9d422eb`，分支 `v2-dev`，固定上游 `4617210822bdbb31e5749751afbfb4584ccedac8`。本片十个源码/测试文件，复用现有 `skill-proposals`；MCP 后端已在前片提交，本片不更改公共协议或 Core 服务。

## 用户行为与复用

MCP 候选从同一 Session 持久 tool input 和五项 metadata facts 读取，新增独立页签、header、命令与窄屏菜单入口，保持 lazy chunk 和已恢复页签预载。配置展示包括 command、args、env、configJson；原始 configJson 不 trim、不解析或重新格式化。环境值明确显示为文件内明文，保存状态只表示 `MCP file saved.`。

[read/list](../../packages/gui-extensions/src/skill-proposals/proposal.ts:112) 按工具族解码，`configJson` 区分 MCP；不复用 Agent 的 warnings wrapper。[current](../../packages/gui-extensions/src/skill-proposals/proposal.ts:266) 决定 catalogue/content 的一致性，[applied](../../packages/gui-extensions/src/skill-proposals/proposal.ts:380) 比较完整回读字段，args 按序、env 按自有键和值、configJson 按原字符串。省略输入、nullable revision 缺失、旧 facts、矛盾 facts 或回读不匹配均不能确认保存成功。

[apply](../../packages/gui-extensions/src/skill-proposals/panel.tsx:209) 复用现有 Session/Location 归属与确认状态。取消不发写请求；409 先读取当前完整配置，用户确认后才携带该 revision 覆盖。候选 stamp 与 [sameScope](../../packages/gui-extensions/src/skill-proposals/panel.tsx:731) 决定视图和异步响应是否仍有效。MCP 保存后不走 Skill/Command 刷新，不连接、授权或发送草稿。

方案选择：扩展既有 parser、面板、Asset fixture 和侧栏 keeper，不新建面板框架或平行候选 store。技术债是资产族仍在几个明确分支枚举；当前 Location-only 落盘未实现用户已裁决的默认 Project/显式 global。该目标保持开放，不重问已有裁决。

## 验证与修复

[验证清单](evidence/v2-mcp-gui-2026-10-27/validation-manifest.json) 自动生成命令、cwd、退出码、源码哈希、日志哈希与原始 tally。隔离树 `bb5a3d68a124f8b20a3b860b36dea3c6fe1b9ff8`；十文件与实现目录逐字节一致，另固定十九个后端/读取 owner。固定 Bun 1.4.2，主线程串行执行，未重启用户 app/server。

| 检查 | 实测结果 |
| --- | --- |
| GUI 全包 | 231 pass / 1 skip / 0 fail；753 expects |
| App unit / browser | 742 pass / 0 fail / 2232 expects；168 pass / 0 fail / 1778 expects |
| 生产 fixture-entry 侧栏 keeper | 28 passed，含 MCP 三条、其余资产与共享生命周期行为 |
| 扩展 host/graph | 25 passed |
| GUI / App / E2E 类型 | 各 exit 0；末次变化仅测试空行，manifest 如实列出差异 |
| 增量 lint / AST / SDK 文档 / 格式 / diff-check | 各 exit 0；lint 九个 TS/TSX，AST 五个生产 TS/TSX，格式十文件 |
| 普通 App 生产构建 | exit 0；产物清单 3156 文件 |
| 普通构建真实 GUI/TCP/FS/SQLite/CAS 链 | 1 pass / 0 fail / 116 expects；2 primary / 0 title |

GUI 的 skip 是当前系统不适用的 WSL 用例。构建的 chunk size、Sentry dynamic/static import 与 AST runtime binary resolution warning 保留。未新增公共 Schema/Protocol，正式生成沿用前片边界验证；本片另外固定公共生成物哈希，不声称重新生成。

新 parser 在旧实现上得到 45 pass / 9 fail，证明新增行为可被用例检出；接线后全包通过。独立复审发现两项 P2 并修复：普通 code 会折叠 command 连续空白，现由候选/当前配置共用的 McpConfiguration 使用 pre 保留；零连接观测原来只计 POST，漏掉立即连接的 canonical PUT，现计入所有非 GET/HEAD/OPTIONS 请求。命令空格浏览器红测实际得到 `normal`，修后 keeper 验证 `pre-wrap` 和双空格原 textContent。增量 lint 的八处测试空行错误已修，原失败记录保留。

[独立复审](evidence/v2-mcp-gui-2026-10-27/independent-review.md) 由 gpt-6-astra 完成，报告包含两项修复、最终源码哈希与证据附录。子智能体负责 parser 实现、真实链准备、独立复审和下一片预审；所有测试由主线程执行。复审中断与恢复不计为通过记录。

## 真实链、产物来源与性能

真实链通过生产 GUI 发出一次 prompt，真实 runner 在 SQLite 投影持久化 MCP input/facts。取消保持零文件；确认创建后核对文件 hash、frontmatter env、原 configJson、HTTP content/list；另一个 HTTP 客户端更新当前 revision 后，同一候选收到 409，GUI 展示当前完整配置并经用户确认 CAS 覆盖。恢复后的文件字节和原创建字节相同，revision 因为是内容 hash 也相同。草稿未发送，运行连接/facts 为空、health 未产生、进程 marker 不存在。

首轮真实链行为通过但用了 Playwright 重新构建的 3177 文件产物；[playwright.config.ts](../../packages/app/playwright.config.ts:24) 的 build 与第 53 行的 fixture 环境、[vite.config.ts](../../packages/app/vite.config.ts:38) 的三个额外入口决定了差异。它不能与之前普通 build 的产物哈希混称。原记录和 [产物对比](evidence/v2-mcp-gui-2026-10-27/served-artifact-comparison.json) 保留；随后重建普通产物，launcher 新增必需 artifact manifest 并逐文件校验，再次真实链通过。

最终普通链归档：`/home/keer/task-backups/v2-mcp-plain-real-chain-20261027T144528Z`。6387 文件复制后逐个哈希回读；599 源码、3156 服务产物在运行前后不变且与父构建清单相同。归档 manifest SHA256 为 `7e8521c0a8ba9c02ed2d75be2e53d41885abfec170e8b658d01a5d109849b5ca`。详见 [真实链摘要](evidence/v2-mcp-gui-2026-10-27/real-chain-plain-summary.json)。该链使用受限 TestLLM 和既有 Chat，不是外部 provider、Mode 创建、冷恢复或 packaged Desktop 验收。

性能前后各三路径、每路径五样本，均 15 passed；两侧都采用同一 Playwright fixture-entry 生产构建配置。稳定时间中位数：cold Session 670.6→909.5 ms，Home→new 382.1→515.9 ms，Session→new 155.1→217.9 ms。三条均变慢；样本仅描述，不推断原因，不宣称无性能回归。原样本见 [performance-summary.json](evidence/v2-mcp-gui-2026-10-27/performance-summary.json)，归因和配对 profiling 留在 P6。

## 剩余范围与现场保护

`AUDIT-V2-ASSET-CONSUMER` / `V2-SERVER-LEGACY` / `V2-D-REFERENCES` / `V2-VALIDATION` 继续开放。Owner：Core/Server/App/GUI/Desktop 与主智能体。解除条件：env/configJson 进入既有安全连接边界的消费、秘密/OAuth 与 native connection UI；默认 Project/显式 global 实际落盘；编辑/导入/引用删除；controller-generation/Location 移动专项、回滚故障注入、冷恢复、外部 provider、Desktop/跨平台；Plugin/Workflow 资产族；性能归因。普通 reload 不替代专项竞态和跨进程恢复。

63 个无关 tracked WIP 与既有债务内容均保留；本片仅限十文件、对应证据/报告及账本增量的本地提交。没有 push、merge 或发布。

归档格式补正：初次本地GUI提交前，原始Playwright错误上下文的八处尾随空格使暂存diff-check退出2；批次脚本未及时停止而继续提交。随后保留原字节副本并仅清理归档文本尾随空格，整片diff-check重新通过；见 [补正记录](evidence/v2-mcp-gui-2026-10-27/artifact-whitespace-correction.json)。这是交付脚本问题，不属于生产代码或行为测试通过范围。
