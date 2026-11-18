# V2 P0.1 Codegen 本地实施与复查

日期：2026-10-25。结论：P0.1 本地实现与适用验证通过，尚未切片提交。完整迁移、全域 transport 盘点及发布切换不在本结论中。

- 计划：[唯一现行实施计划](../research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md)。Phase P0，Slice P0.1。
- 实施目录：`/home/keer/workspace/aigcfroge-v2`；分支 `v2-dev`。
- HEAD：`251c0fe38041a326e624db464d1ee0efd1522881`；固定 `upstream/v2`：`4617210822bdbb31e5749751afbfb4584ccedac8`。
- 新的人类裁决：旧产品参考改为当前 `main`（`edbe67383d830aa40269ddf453c7f5617c940b46`）及现有 WIP；后续 Todo 代码族优先保留 V2 实现与语义。V2 比较基准保持不变。

## 现场与改动归属

首次核对了 pwd、branch、HEAD/upstream、worktrees、status、staged/unstaged stat 和全部未跟踪文件。V2 身份与交接一致。旧目录 reflog 记录了 `desktop-session-nav → main` 的切换，已由用户选择新参考。

在仓外保存并逐文件读取核验了 24 个已跟踪改动文件、158 个未跟踪文件、暂存/未暂存 binary diff、文件模式和 manifest：`/home/keer/.codex/backups/aigcfroge-v2/p0.1-20261025T020302Z`。该备份包含完整文件副本，未使用暂停 hash 清单代替备份。

本轮产品改动只有 `packages/httpapi-codegen/src/index.ts`、其现有 `test/generate.test.ts`，以及官方生成的 `packages/client/src/promise/generated/types.ts`。现行计划、canonical 账本、本检查点和本轮证据同步更新。既有 Class/optional、Task、Schema、Client cache 和 App/E2E WIP 不计入本轮实现。

最终逐文件核对证明，除上述产品文件、现行计划与账本外，177 个原有 WIP 文件均保持初始 SHA256，见 [WIP 保留核验](evidence/v2-codegen-p0.1-2026-10-25/wip-preservation.json)。相对初始 WIP 的本轮三个产品文件补丁保存在同证据目录的 `*.final.slice.patch`，用于分辨本轮与既有改动。

本轮无提交、推送、合并或发布。`git log --oneline 251c0fe38041a326e624db464d1ee0efd1522881..HEAD` 的实际输出保存在 [commits.txt](evidence/v2-codegen-p0.1-2026-10-25/commits.txt)，为空。后续切片提交需先确定既有 Codegen Class/optional WIP 与本轮依赖的范围。

## 用户链、决定函数与复用

生成链为 Client `compile(ClientApi)` → `emitPromise` → 生成类型 → Client/App 消费。真实生成入口为 [build.ts:69](../../packages/client/script/build.ts:69)，生产输出使用 [mutableOutputs:147](../../packages/client/script/build.ts:147)。HTTP 的运行依赖方向未改变。

- Schema 继续拥有 canonical MCP/OAuth 与 V1 合同：[Mcp.OAuthConfig:41](../../packages/schema/src/mcp.ts:41)、[Mcp.RemoteConfig:53](../../packages/schema/src/mcp.ts:53)、[ConfigMCP.Info](../../packages/schema/src/config/mcp.ts)、[ConfigMCPV1](../../packages/schema/src/v1/config/mcp.ts)。回归直接导入这些真实 owner，不复制生产合同。
- 名称分配复用 [uniqueTypeName:1131](../../packages/httpapi-codegen/src/index.ts:1131)，不通过改消费者名称绕过错误。
- 引用与字面量由 [promiseTypeTokens:1136](../../packages/httpapi-codegen/src/index.ts:1136) 决定；响应 [render:1092](../../packages/httpapi-codegen/src/index.ts:1092)、输入 [structuralType:1152](../../packages/httpapi-codegen/src/index.ts:1152)、匿名展开及最终 [resolve:890](../../packages/httpapi-codegen/src/index.ts:890) 共用该边界。每次替换读取原始文本，callback 返回的名称和 `$&` 不再作为替换输入解释。
- 等价去重由 [structuralTypes:1107](../../packages/httpapi-codegen/src/index.ts:1107) 的原始 identifier 加渲染结构决定，不再由 `_数字` 后缀推定身份。
- [structuralTypes:1036](../../packages/httpapi-codegen/src/index.ts:1036) 只归一化一次 AST。第一遍官方 `referencePolicy` 记录分配前的 identifier；第二遍复用同一原 roots 与候选 owner，使官方代码生成器暴露最终引用名。未克隆 annotation、修改源 Schema 或复制第三方名称分配算法。

两遍策略的前提是当前完整 encoded AST 边界。Effect 4.0.1 的 `toRepresentation.ts` 第 8、112、141 行分别决定默认策略、候选身份和重复访问；默认策略不依赖 occurrences。以后若改变编码投影或 referencePolicy，需重验该映射。技术债仍是文本渲染及一次额外 representation 遍历；不据本轮耗时宣称性能改善。

## 红测试与最终绿测试

本轮失败与后续成功分别保留，不累计重叠 tallies，也不把历史 99 项通过当作本轮证据。

- [最初有效引用反例](evidence/v2-codegen-p0.1-2026-10-25/codegen-red-corrected.log)：exit 1，93 pass / 5 fail。canonical/legacy 串线同时污染父类型去重、数组/Record、字符串及真实 MCP/OAuth。
- [输入展开反例](evidence/v2-codegen-p0.1-2026-10-25/codegen-inline-red-corrected.log)：exit 1，98 pass / 1 fail。输入中的 identifier 与 `Schema.Json` 字面量被改写。
- 最终占位符替换也改为 callback，保护 `$&` 与包含 `__PROMISE_TYPE_1__` 的字面量；同一夹具断言第二真实响应确实解析为 boolean。
- [原始数字后缀反例](evidence/v2-codegen-p0.1-2026-10-25/codegen-identifier-red.log)：exit 1，99 pass / 1 fail。不同 authored identifier 被误合并。
- 私有 origin annotation 的尝试被等价和 [contextual 回归](evidence/v2-codegen-p0.1-2026-10-25/codegen-contextual-red.log) 拦住，已撤销。最终方案保留同 identifier 的等价去重、非等价区分、带 checks 的名称及共享 optional/contextual owner。
- [最终 Codegen 单包全量](evidence/v2-codegen-p0.1-2026-10-25/codegen-owner-full.log)：exit 0，108 pass / 0 fail，296 assertions，2 files，未报告 skip。
- [最终 Client 单包全量](evidence/v2-codegen-p0.1-2026-10-25/client-owner-full.log)：exit 0，234 pass / 0 fail，958 assertions，20 files，未报告 skip。

## 命令、版本与生成合同

全部包测试/构建由主线串行执行；子智能体只读取证和复审。固定 `/home/keer/workspace/aigcfroge-v2/script/bun`，Bun 1.4.2。每条命令的 argv、cwd、退出码、运行时间、source hashes 和 log SHA256 都在 [本轮证据目录](evidence/v2-codegen-p0.1-2026-10-25/) 的同名 JSON 中。

最终适用验证均为 exit 0：

- Codegen `run typecheck` 与 `run test --timeout 30000`：`codegen-owner-typecheck`、`codegen-owner-full`。
- Client 正式 `run generate`：`client-generate-owner-final` 与 `client-generate-stability`。11 个生成文件逐字节 SHA256 相同，见 [stability](evidence/v2-codegen-p0.1-2026-10-25/generated-stability.json)。这只是补充验证。
- Schema、Protocol、Server 各包 `run typecheck`：`schema-types-final`、`protocol-types-final`、`server-types-final`；这些 owner 源码本轮未修改。
- 最终生成后 Client/App `run typecheck`、App `run typecheck:e2e`：`client-owner-types`、`app-owner-types`、`app-owner-e2e-types`。
- Protocol `run check:generated`：`protocol-owner-generated`。
- 两个 Codegen 文件的定向 oxlint：`codegen-owner-lint`，0 warnings / 0 errors。没有把 GUI 的 `lint:changed` 当作 Codegen lint。

真实 Schema 模块回归及最终生成物含义核验表明：

最终生成文件 SHA256 和 MCP/OAuth 结构引用检查见 [semantic checks](evidence/v2-codegen-p0.1-2026-10-25/generated-semantics-final.json)；公开名称变化见 [public names](evidence/v2-codegen-p0.1-2026-10-25/generated-public-names-final.json)。结构检查针对实际生成物，未以类型名数量代替含义。

- [ConfigMCP.servers:3882](../../packages/client/src/promise/generated/types.ts:3882) 指向 `McpLocalConfig2 | McpRemoteConfig`，两者均为 canonical `disabled` 与对象 timeout。
- [canonical Remote:1805](../../packages/client/src/promise/generated/types.ts:1805) 的 OAuth 指向 `McpOAuthConfig`，保留 snake_case 字段；legacy Remote 指向 `McpOAuthConfig2`，保留 camelCase 字段。
- legacy Local/Remote 保留 `enabled` 与数字 timeout；未把两种结构按名称后缀当作等价。
- 没有删除既有公开类型名，补回 `KBNoteTitle` 与 `RevisionDigest`；`SessionTaskInfo` 保留。数量只作为补充，含义由真实 schema、引用决定函数和类型检查验证。
- 可选 JSON/Class 既有回归仍通过，没有用 Finite 替代 Number、修改消费者名称或手改生成文件。

独立子智能体 `codegen_review` 核对了初始 tar 与最终源码、真实接口、失败尝试和最终原始 owner 映射。其发现的等价、checks、contextual owner 和第二占位符问题均已纳入回归；当前映射复审通过。

## 未交付范围与接续

- AUDIT-V2-CODEGEN：本地实现与适用验证完成；Owner 为 Codegen/Client 负责人、主智能体。尚未提交，解除条件为确定与既有 Class/optional WIP 的提交范围并落地。
- V2-C-TRANSPORT-TYPES：全域 optional/nullable 与真实端点消费者盘点仍开放，Owner 为主智能体/项目 Owner；不得由本次引用修复关闭整个条目。
- P0.2 权限/工具快照只读取证已完成，未修改 Core。接续时须复现真实 Agent deny→Session allow，并保护配置 deny guard→saved→hook 的 V2 顺序、Custom 冻结和目录可见性边界。
- P0.3/P0.4 与 P1–P6 继续按 canonical 账本推进。当前没有 Electron/CLI/native PTY、旧库、性能或全产品 E2E 验收；这些不属于 P0.1 已运行门禁。
- Todo 优先保留 V2 的人类要求已进入现行计划；现有 Todo→Task 桥接在对应切片核对，不用本次 Codegen 结论代替它的验收。

本轮完成接续材料核对、现场保护与 P0.1 本地实现。下一切片为 P0.2；远程目标与切换仍按原边界处理。
