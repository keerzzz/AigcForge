# P2.2I MCP 资产后端检查点

2026-10-27。实现分支 `v2-dev`，基线 `b4d75c884ad594f2399370643e3325b09b32ee29`，固定上游 `4617210822bdbb31e5749751afbfb4584ccedac8`。本片范围为七个生产/测试文件，完整迁移与七资产目标继续开放。

## 行为、根因与复用

`core/src/instance.ts` 暴露既有 MCP registry/service；公共 list/content/apply/delete 接到现有 Location graph。[HTTP handler](../../packages/server/src/handlers/mcp-asset.ts:11) 只做传输映射，沿用 [AssetLocation.atSessionLocation](../../packages/server/src/handlers/asset-location.ts:27)。归属关系由该函数第 43 行对规范化 directory 和 workspaceID 的比较决定。apply 受既有 Chat Asset 开关限制，delete 保留开关关闭后显式删除的原合同；缺失 content 按既有 Protocol 返回 400。

[Proposer](../../packages/core/src/tool/propose-mcp-asset.ts:70) 持久化 relativePath、exists、nullable revision、nameConflict、pathConflict 五项事实。完整 command/args/env/configJson 仍在 tool input，不重复写入 metadata。MCP apply 使用 canonical `Info`，不套用 Agent 的 `{asset,warnings}`。

真实 HTTP 红测暴露两个 owner 缺陷：apply 未序列化 env，保存成功后环境变量回读为空；apply 忽略了非空 candidate.relativePath，审阅目标与实际文件可不一致。现由 [MCPAssetService.apply](../../packages/core/src/mcp-asset-service.ts:197) 拒绝不一致目标，使用既有 migration 的 JSON flow mapping 方式写 env。空 relativePath 保留原内部候选兼容语义。[完整回读比较](../../packages/core/src/mcp-asset-service.ts:294) 检查 revision、path、名称、描述、command、args、env 和 configJson，不一致时走原 rollback；未增加第二套锁或写入服务。

复用选择：Location 与 Session 归属用 AssetLocation；路径用 MCPAssetPath/LocationMutation；写入用 FileMutation；CAS、回读和回滚保留在 MCPAssetService；HTTP/runner/FS/SQLite 测试启动用 AssetHttpFixture；进程启动标记复用 mcp-starts.cjs。扩展现有 owner，无平行 registry、配置解析器、连接服务或数据表。

[MCPAsset.reload](../../packages/core/src/mcp-asset.ts:132) 仅重载目录并更新资产/无效项映射。[McpScope.decodeBinding](../../packages/schema/src/mcp-scope.ts:210) 是显式连接输入的严格边界：它不接受 env；连接环境通过 [credential resolution](../../packages/core/src/mcp/connection.ts:929) 提供。HTTP keeper 先确认保存后没有连接和进程标记，再显式使用已保存的 command/args/ref 完成本地 stdio 握手，断开后替换/删除资产不再启动进程。

技术债边界：env/configJson 是明文资产字段，本片仅证明完整持久化与回读。它们没有由此获得秘密存储、OAuth 或运行消费语义。configJson 仍遵循既有字符串 Schema，不新建解释器；保存不等于连接、授权或 provider 执行。

## 验证与独立复审

[验证清单](evidence/v2-mcp-backend-2026-10-27/validation-manifest.json) 自动记录每次命令、cwd、退出码、原始 tally、源码 pins 和日志 SHA256。隔离目录为 `/home/keer/task-backups/v2-agent-backend-validation-20261027`；固定 Bun 1.4.2，workspace links 指向隔离目录，仅共享外部依赖。实际 HTTP fixture 使用 Web Request handler、真实 Session runner/SQLite/文件系统及 TestLLM；不是 GUI 或 TCP 验证。

最终候选树为 `255b0cb3577c6371c92c5011a21502a207fe41e0`。七文件与工作区逐字节一致，manifest 另固定十个相关 owner/fixture 源文件。历史结果与最终源码的差异由 differencesFromFinal 决定。

| 检查 | 实测结果与范围 |
| --- | --- |
| 最终 Server 全包 | 157 pass / 1 skip / 0 fail；7440 expects；42 文件 |
| 最终 Core 资产/迁移/组合/Location 回归 | 31 pass / 0 fail；497 expects；4 文件 |
| MCP 显式连接回归 | 48 pass / 0 fail；225 expects；1 文件，发生于最终类型导入清理前 |
| MCP HTTP 定向 keeper | 3 pass / 0 fail；55 expects，最终 Server 全包包含这三个用例 |
| Core / Server 包级类型 | exit 0；按各记录的源码 pins 判断版本 |
| Client 正式生成 / OpenAPI check / 生成物 diff | 均 exit 0；没有公共生成物变化 |
| 定向 lint / AST / Prettier / diff-check | 最终七文件 lint、六生产文件 AST、七文件格式及暂存差异均 exit 0 |

lint 当前配置仅 1 条规则，不能将其解释为全面审计。Server 的单个 Mercurial 跳过项由 `test/vcs.test.ts:164` 的 `Bun.which("hg")` 门禁决定；现有 MaxListenersExceededWarning 和 AST binary resolution warning 保留。测试均在包目录串行执行，类型检查使用 GOMAXPROCS=2、GOMEMLIMIT=3GiB。

[独立复审](evidence/v2-mcp-backend-2026-10-27/independent-review.md) 对当前七文件无新增阻断项；主线程已重新计算并匹配全部复审文件哈希。复审回读的较早运行记录不冒充最终源码执行；本表与 manifest 中后续 final 记录为最终验证依据。回滚故障分支本次仅静态核对，未作写后失败注入或全部外部写者竞争实验，继续登记在 V2-VALIDATION。

失败记录全部保留：HTTP 首轮 1 pass / 2 fail，随后 env/path 修复后 3 pass / 0 fail；新增显式连接 keeper 因 binding 携带不允许的 env 得到 2 pass / 1 fail；两处品牌类型错误经 Schema 解码修复；AST 发现存量 value alias，改为直接 type import 后通过，随后修正签名格式。emit 比较发现旧 Bun 输出保留了该 import，新代码移除了它，因此没有把这次 emit 比较报告为通过，并对最终代码重跑行为检查。一次隔离同步命令使用了错误的相对 cwd，cp/git add 失败；随后已用绝对路径同步并核验。本次失败与成功不累加计数。

此前复审子智能体多次收到上游 HTTP 400、断流及 token rate limit；这些均不算完成复审。用户明确允许切换复审模型后，使用 gpt-6-astra 继续，保留该过程及限定复审结论。

## 未交付范围与现场保护

`AUDIT-V2-ASSET-CONSUMER` / `V2-SERVER-LEGACY` / `V2-D-REFERENCES` / `V2-VALIDATION` 继续开放。Owner：Core/Server/App/GUI 与主智能体。解除条件：MCP GUI 完整配置、确认/取消与 CAS；资产 env/configJson 到既有安全连接边界的明确消费；秘密/OAuth、native connection UI；默认 Project 和显式 global 目标；编辑、导入、引用删除；冷恢复、外部 provider、Desktop/跨平台；Plugin/Workflow 等剩余资产族。

本片选择已有服务接线，以上能力未被简化实现隐含替代。63 个无关 tracked WIP 的哈希已单独保存并复核；原技术债账本内容保留，仅对本片增量作暂存。现有备份 `/home/keer/workspace/v2-agent-backup-20261027T081509Z` 保留。提交限于本片源码、证据、报告及债务增量，不 push、merge 或发布。
