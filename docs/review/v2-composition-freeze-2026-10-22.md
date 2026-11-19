# Custom 解析与内部冻结检查点（2026-10-22）

实施目录 `/home/keer/workspace/aigcfroge-v2`，分支 `v2-dev`，基准 `9267e9e7754b656a812dc69973f9f35a66b0aad0`。代码检查点为 `c40022ef51ee7b9da5a30bc762451cb5512761af`，包含 29 个变更包文件。本切片接通 plan/health 真实 HTTP，提供不创建 Session、不持久化快照的内部 freeze，并扩展持久快照完整性检查。原子 start/upgrade 与生产运行消费继续开放。下列源码行号均指向该代码提交，后续切片不在本证据范围内。

## 用户裁决与上游

用户明确要求 Custom 工具展示和 capability 权限对齐上游 V2。核对的上游 `upstream/v2` SHA 为 `4617210822bdbb31e5749751afbfb4584ccedac8`。`Tool.snapshot` 在 `packages/core/src/tool.ts:233` 按 `options.codemode === false` 保留 direct，其余进入 CodeMode；`whollyDisabled`（同文件 `:349`）由最后匹配 action 的规则决定，只有该规则为全资源 deny 才隐藏，ask 仍可见。

独立复核找到旧迁移提交 `fc51db11bc` 把 Custom MCP 工具强制注册为 direct。本切片删除该特例和过期理由，复用上游默认 CodeMode。Custom binding 没有上游 MCP 配置中的显式 codemode 字段，未新增远端发现字段或展示配置。CodeMode execute 和 Web extension 沿用上游行为；本切片没有添加 Web capability gate。

核对的上游不含 Custom Profile/Composition/requestedCapabilities 实现。当前声明在 `packages/core/src/composition-resolver.ts:560` 一律预览为 unsupported，不新增 capability→tool/action 映射。既有 Permission tier、attended、override、ScopedGrant、responder 和 TTL 扩展保持；不能据此声称整个 fork 权限系统等同上游。`Permission.merge`（`packages/core/src/permission.ts:119`）只拼接规则数组。

## 实现与决定函数

| 决定函数                                                                                                                           | 已交付范围                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CompositionResolver.resolveInternal`，`packages/core/src/composition-resolver.ts:61`；`checkHealth`，`:669`                       | 每个资产 owner、Profile 和 MCP facts 每次解析读一次；规范化路径、revision、图、consumer、非法/disabled 执行配置生成诊断；plan 与 health 共用判定。                                  |
| MCP fact 匹配，`packages/core/src/composition-resolver.ts:508`                                                                     | serverName、规范化相对路径、revision、实际 transport 指纹和 credentialRef 必须一致；`:526` 要求 ready。`:542` 用有效工具集合过滤 canonical `mcp_` 注册。                            |
| `CompositionResolver.freeze`，`packages/core/src/composition-resolver.ts:601`                                                      | 复用同次 resolve 的配置、正文和 catalog；保存所有 consumer，包括空 binding；单 Agent plan 也生成完整 SnapshotV2；最终 encode→clone→decode 切断嵌套引用。                            |
| `Tool.snapshot`，`packages/core/src/tool.ts:233`                                                                                   | 同次有效 Map 提供 direct、synthetic execute 和 CodeMode children 的完整 JSON Schema/options capture；同次注册过滤作用于 definitions、discovery 和 execute。                         |
| `CompositionDigest.captureTools` / `validateCapturedTools`，`packages/core/src/composition/digest.ts:42` / `:65`；排序比较，`:146` | 同一 name+placement 排序决定 capture/catalog/fingerprint 对应关系；同名 child execute 与 synthetic execute 都保留。重算原始 JSON 摘要，保留 `x-*` 扩展和合法 own `__proto__` 字段。 |
| `Composition.mcpAuditMatchesCatalog`，`packages/schema/src/composition.ts:467`                                                     | 仅比较 canonical `mcp_` catalog 与排序 audit 名称；不证明 ambient MCP/Web 的封闭范围。                                                                                              |
| `SessionComposition.assertDependency`，`packages/core/src/session/composition.ts:274`                                              | 复用 capture validator；缺执行器、consumer binding、Skill 正文、MCP transport 指纹及身份/摘要篡改拒绝执行；read/copy 仍可读取合法历史格式。                                         |
| `McpConnection.transportFingerprint`，`packages/core/src/mcp/connection.ts:236`；`credentialStatusFor`，`:840`；`facts`，`:1083`   | 指纹只取实际使用的 stdio command 或 remote URL 分支。facts 复用 binding/credential/expiry 规则投影当前可用性，不修改最后 observed health，也不返回 credential material。            |
| `AgentAssetBridge.agentAssetToAgentInfo`，`packages/core/src/agent/asset-bridge.ts:36`；request 合并，`:59`                        | 修复转换 helper 丢弃 ConfigAgent.request 的根因，冻结与普通 registry 转换复用 headers/body 合并。                                                                                   |
| Agent request 凭据判定，`packages/core/src/composition-resolver.ts:273`；`containsCredentialField`，`:689`                         | 嵌套 JSON/数组、auth/cookie header key、共享 CredentialScan key/text 规则共同拦截凭据；短值/空值用固定值探针判定 key，诊断不含材料。                                                |
| CodeMode Cause bridge，`packages/core/src/tool.ts:248` / `:252` / `:323`                                                           | 每次 execute 的 Ref 保存原始 fatal Cause，经解释器 interrupt 路径退出，再由外层 uninterruptibleMask 重抛；同一 snapshot 的并发调用独立。                                            |
| `CustomCompositionHandler`，`packages/server/src/handlers/composition-stubs.ts:25`；plan，`:44`；start/upgrade，`:57` / `:58`      | plan/health/references 使用真实 Location context 与既有 auth/workspace gates；start/upgrade 保留 typed `not_implemented`。                                                          |

方案对冲：只保存工具名无法识别 CodeMode 子工具 Schema/options 漂移；新建旧 ToolRegistry materialize 会重复当前 owner。本切片扩展现有 Tool snapshot，保存完整 JSON capture，由同一个摘要 validator 判定对应关系。执行闭包仍属 producer，未冻结全部运行状态。

Schema 新增 capture、executors、Skill content 和 transportFingerprint 为历史可选字段，不补空默认。新 freeze 必须提供完整数据；合法历史 V1/V2 可读，不完整执行会失败。StartResponse 使用现行 Session 合同（`packages/schema/src/composition.ts:445`），Protocol OpenAPI 与 Client 通过官方脚本生成。

CodeMode 桥只把缺陷与混合 interruption 作为 fatal；普通 Tool.Error，包括 MCP 叶映射的 BlockedError/RejectedError，仍可被脚本捕获。纯 interrupt 和清理子 fiber 的 interrupt 保留。既有无反馈拒绝在 `packages/core/src/permission.ts:344` 进入 defect tunnel，并在 Session 边界 `packages/core/src/session/model-request.ts:401` 恢复为 typed failure；不能把所有权限拒绝都解释为结束 Session drain。

Agent 非凭据的嵌套生成参数与 headers 保持原样冻结。认证材料属于 provider credential owner。MCP facts 把跨 Location、删除、撤销和过期投影为当前 admission 事实，不更改已经观察到的连接状态。

## 已验证

命令、cwd、退出码、日志 SHA256 与提交源码 SHA256 见 [verification.json](evidence/v2-composition-freeze-2026-10-22/verification.json)。[归档说明](evidence/v2-composition-freeze-2026-10-22/README.md) 解释压缩和历史证据边界。共归档 75 份日志，其中 39 份有命令/退出码记录：17 份最终检查、22 份早期迭代；另 36 份只有历史日志，退出码为 null。5 份大日志采用 gzip，哈希同时覆盖原始未压缩字节和归档字节。

所有测试从包目录串行运行，Bun banner 为 1.4.2（`744846f84`）。Core/Server 全包在同 UID 的 user/network namespace 内运行，loopback 设置后通过 setpriv 清除 capabilities。定向与全包数量不相加。下表计数与运行时长均从最终日志抽取；日志未单列的 skip 不补 0。

| 包     | exit | pass | skip       | fail | expect | tests / files | 日志时长 |
| ------ | ---- | ---- | ---------- | ---- | ------ | ------------- | -------- |
| Core   | 0    | 7188 | 365        | 0    | 108636 | 7553 / 357    | 236.12s  |
| Server | 0    | 120  | 1          | 0    | 6908   | 121 / 35      | 42.94s   |
| Schema | 0    | 359  | 日志未单列 | 0    | 1269   | 359 / 42      | 0.673s   |
| Client | 0    | 224  | 日志未单列 | 0    | 906    | 224 / 20      | 38.91s   |

Core、Server、Schema、Protocol、Client 各包 typecheck 均 exit 0。Core 实际执行 `tsgo -b tsconfig.json tsconfig.tests.json`，Server 为 `tsgo -b`，其余三个包为 `tsgo --noEmit`。Protocol 另有官方 `check:generated` exit 0，没有 Protocol 全包测试声明。

MCP bridge 定向回归 exit 0，117 pass / 0 fail / 498 expect，4 files；resolver 凭据定向回归 exit 0，19 pass / 0 fail / 420 expect，1 file。测试实际覆盖 JS try/catch 无法吞掉无反馈拒绝/缺陷、等待权限及在途 RPC 中断、同一 snapshot 的并发 Cause 隔离、普通 RPC 错误可捕获，以及未 await 子任务清理后正常完成。

官方 Client generate exit 0。[生成前后哈希](evidence/v2-composition-freeze-2026-10-22/client-generated-hashes-current.json) 的 11 个文件完全一致，归档时逐一对照代码提交中的 blob，全部匹配。最终源码 Prettier check 和 whitespace diff 均 exit 0。定向 28 个 TS 文件 lint exit 0，0 warnings / 0 errors；根 lint exit 0，1487 warnings / 0 errors，SDK docs 为 0 problems。

29 个包文件的 SHA256 从 `git show c40022ef51:<path>` 取字节，路径从基准到该提交的 package diff 生成。这证明代码检查点的内容；每次历史运行未记录独立 source hash，不能将本次提交哈希倒填为每次运行的精确输入。canonical 根 `check` 本切片未运行，按用户性能约束分别执行受影响包 typecheck。

## 失败与修复

下列失败有记录的非零退出码，已保留原始日志；最终 green 不覆盖这些失败记录。

| 日志                                   | 失败证据                                                                                        | 根因与修复                                                                                                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core-full-closure.log`，exit 1        | 7167 pass / 365 skip / **15 fail**；`No tool named "mcp_execution_echo" is currently available` | MCP 已回归默认 CodeMode，旧测试继续发 direct 名称，权限等待超时，输出和 Location view 断言也沿用旧形态。调用改用真实 execute/CodeMode，覆盖 Cause bridge；最终 Core 全包 0 fail。 |
| `mcp-codemode-current.log`，exit 1     | 165 pass / **1 fail**；real MCP owner preview 断言失败                                          | resolver 的真实 MCP 预览仍期待旧展示计数；按决定函数更新，后续 resolver 与 Core 全包通过。                                                                                        |
| `credential-freeze-red.log`，exit 1    | 17 pass / **1 fail**；冻结凭据未给诊断                                                          | request headers/body 进入 durable freeze 前缺统一凭据判定。复用 CredentialScan 加嵌套 key 检查；green 为 18 pass，随后当前回归 19 pass。                                          |
| `protocol-generated-final.log`，exit 1 | `Generated OpenAPI document is stale. Run bun run generate from packages/protocol.`             | 合同改变后生成文档过期；官方 generate 修复，当前 `check:generated` exit 0。                                                                                                       |
| `format-current.log`，exit 1           | `Code style issues found in 2 files.`                                                           | `composition-resolver.test.ts` 和 `mcp-location-isolation.test.ts` 格式未更新；修复后最终源码 check exit 0。                                                                      |

其余 36 份未登记早期日志保留为历史记录，command/cwd/exit 为 null；即使包含 tally 或脚本错误文本，也不推定命令退出码。包含的失败分组有缺 catalog fixture 的类型错误、resolver Location 环境泄漏与 optional agents 推导、过期 capability 断言、新 DB 测试 JSON/品牌类型不匹配、旧 provider definitions 计数 10→1。它们不属于最终 green 证据。

## 尚未交付与限制

Owner：主智能体；解除条件见 [技术债账本](../technical-debt.md) 的 `V2-D-COMPOSITION`、`V2-D-FREEZE` 和 `V2-D-REFERENCES`。SessionContext/Permission/ModelRequest/Skill/Task/Subagent/Delegation 尚未消费此冻结配置；Session 创建、切换、fork/move/resume 仍需双层 allowlist 与原子快照事务。start/upgrade 仍需 exact retry 与新 Session 语义，整体 Custom 产品流程及其他迁移账本继续开放。

跨 owner capture 不具有原子一致性。plan.digest 是输入摘要；installationVersion 是 host build version，未证明独立插件 provenance。producer execute 闭包、raw Schema producer 状态和 discovery cache 仍可变。Skill 正文已冻结，资源文件尚未归档。canonical `mcp_` 审计由 `mcpAuditMatchesCatalog` 决定，未覆盖上游 ambient MCP/Web，不能报告完整 MCP 封闭 allowlist。

未验证产品 UI/E2E、Electron/PTY、真实外部 MCP/CLI、生产数据库或存量副本升级。Server 最终全包输出 `MaxListenersExceededWarning`，根 lint 仍有上述 warnings。本切片没有远程交付。

参考工作区 `/home/keer/workspace/aigcfroge` 保持 `desktop-session-nav`；既有 `packages/app/src/components/session/git-state.ts` 修改和未跟踪 `packages/app/e2e/regression/draft-first-send-navigation.spec.ts` 均未触碰。

## 提交核算

代码提交列表由以下命令生成。此处范围固定到代码检查点，不包含后续文档提交或下一切片。

```sh
git log --oneline 9267e9e7754b656a812dc69973f9f35a66b0aad0..c40022ef51
```

```text
c40022ef51 feat(core): freeze custom composition inputs
```
