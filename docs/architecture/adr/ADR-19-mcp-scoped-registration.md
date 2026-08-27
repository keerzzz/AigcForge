# ADR-19: MCP Scoped Registration

> **状态**：**Accepted for M3 implementation v1.0**（2026-08-23 批准；用户授权 AI 代理代行 Product / Core / Security / App / Schema+SDK 五方技术审批）—— Phase B/C/E 阻塞解除
> **日期**：2026-08-23
> **Gate**：G3-1（M3 计划 §1）；**已通过**
> **关联**：[ADR-17](ADR-17-custom-mode-composition-platform.md)、[ADR-18](ADR-18-custom-mode-workflow-execution.md)、[M3 计划](../../plan/custom-mode-m3-mcp-approval.md)、[Phase A 调研报告](../../plan/custom-mode-m3-phase-a-research.md)、[V2 Tools spec](../../../specs/v2/tools.md)
> **事实基础**：本 ADR 每条决策均指向调研报告复核过的代码事实（`main@1d5c51f6c` file:line）或显式标注为**新增契约**。

---

## 1. 背景

产品今天不连接任何 MCP server。生产装配是 `McpV2.noopLayer`（`app-runtime.ts:195`），`v2-bridge.ts` 是零消费方死代码（唯一引用是其自身 barrel 行）。真正在服役的是 V1 实现（`packages/aigcfroge/src/mcp/index.ts`，979 行）：按 instance 目录 scope 的 `InstanceState` ScopedCache、无 reconnect、无 health 轮询（被动 `client.onclose`）、OAuth token 存 `mcp-auth.json` 文件、已有 `/mcp/*` HTTP 面无条件挂载。

同时，canonical ToolRegistry 的注册机制已齐备——运行时动态 register、Scope 清理 finalizer、同名 last-wins、captured settle 与 stale rejection（`registry.ts:149-169/:88/:96-97`）——缺的只是 MCP 的 identity/placement 契约（`tool/AGENTS.md:58`）。fingerprint 今天只存在于 resolver/schema（freeze 与 turn 重验，`composition-resolver.ts:742-758`、`runner/llm.ts:205-273`），registry 内 0 命中：registration fingerprint 是新概念。

若直接把 MCP 工具接进现有机制，会踩三类坑：外部 server 可控工具名经 last-wins 静默遮蔽内建工具；reconnect 后定义漂移没有与 Snapshot 重验的衔接；连接资源与 pending request 没有 owner 负责清理（重蹈 §4.5-2 孤儿教训）。

---

## 2. 决策

### 2.1 V1 收敛裁决：并存但单向隔离冻结

**并存**。V1 实现与其 `/mcp/*` HTTP 面保持现状服役于既有模式，进入**冻结维护**（只修 bug、禁新增能力）；Custom Mode 的 MCP 能力**只**走本 ADR 定义的 canonical scoped registration 路径，二者零共享：

- 不复用 V1 的 instance-directory scope（多 Session 共用一套 client/defs 与 Session/Agent scope 语义冲突）；
- 不复用 V1 凭据面：canonical 连接的 OAuth/token 只经 Credential/Integration service 解析（G3-3），`mcp-auth.json` 对 canonical 路径不可见；
- `McpV2.Service` 接口（start/stop/tools/callTool）废弃，不作为 canonical 形状。

**收敛迁移另立里程碑**：V1 → canonical 的迁移评估是 M4 开工 Gate 输入之一（登记 technical-debt），不在 M3 范围内强行替换在役消费面。

> 依据：调研报告 §1。收敛一次性替换会拖入 V1 全部消费方与双轨凭据迁移，超出 M3 门禁；无边界并存则违反「唯一 ToolRegistry」禁区。单向隔离以测试钉死（§2.7）。

### 2.2 Registration placement 与 scope 语法（新增契约）

注册身份二元组 `{ placement, serverName }`：

```text
placement ::= { kind: "location" }
            | { kind: "session", sessionID }
```

- **Location placement**：该 Location 内全部 Session 可见。由 Location 层的 connection owner 在连接 ready 后注册。
- **Session placement**：仅该 Session 可见。由 drain 内的连接路径注册，Session 终态时关闭。
- **Session 维度过滤契约（新增）**：`ToolRegistry.materialize` 增加 `options.sessionID?` 过滤维度，settle 同样校验 placement 匹配——Location 注册对全部 Session 生效，Session 注册只对所属 Session 物化。这是对现有闭包 Map 的小扩展（每条注册记录增加可选 `sessionID`），不改变 last-wins/captured-settle 通用机制。

### 2.3 Owner Scope 清理模型（复用既有机制，禁止新机制）

每条注册路径恰好拥有一个 Effect `Scope`，其 finalizer 负责：unregister 本路径工具（registry 已有按 token 过滤的 finalizer，`registry.ts:158-166`）→ 关闭传输连接 → 以 typed 错误释放该路径产生的全部 pending request。**不存在任何绕过 owner Scope 的手工 Map 删除路径**（停止条件红线）。

> **Phase B 事实修正（2026-08-23）**：原起草时断言「`ApplicationTools.Service.register` 要求 `Scope` 却无 finalizer」——**该断言有误**。清理由 `State.transform` 内建提供：它在调用方 Scope 上挂 finalizer 并通过重放剩余 transform 恢复状态（`state.ts:88-93` 的 `Scope.addFinalizer(scope, dispose)` + materialize 重放），因此 scope 关闭移除自身注册且揭示前一个赢家，与 §2.3 语义一致；钉死测试见 `application-tools.test.ts` "reveals the previously registered tool after an overlay scope closes"。真正的禁止形态仍是 `cli-adapter.ts:71` 的模块级 `Map`（无 Scope、无 Location 归属）。

### 2.4 Name collision 规则：typed error，fail closed（新增契约，收窄通用 last-wins）

MCP 生产者注册遇到**任意在该注册自身 placement 上已生效的同名注册**（内建、应用工具、Location 注册、同 Session 的其他注册）→ typed error，注册失败，绝不静默遮蔽。

理由：MCP 工具名是外部输入，last-wins 允许恶意 server 用 `read`/`bash` 覆盖内建工具（现机制 `.at(-1)` 直接生效，`registry.ts:88/:177`）。通用 registry 机制不改（其他生产者仍 last-wins）；canonical MCP 注册器在注册前做占用检查并失败。

> **Phase B 收窄（2026-08-23）**：占用检查必须在**注册自身的 placement 上**求值，与 §2.2 的可见性用同一个谓词。
>
> - Location 注册（无 sessionID）：对全部 Session 可见，会遮蔽任何 placement 当前的赢家 → 与**全部**已占用名冲突（含某个 Session 自己的注册）。
> - Session 注册：只与应用工具、Location 注册、**本 Session 自己的**注册冲突。**兄弟 Session 的注册在此不可见，不构成冲突**——否则一个组合里的多个子会话无法各自绑定同一个 server，直接废掉 §2.2 的 Session placement。
>
> 首版实现的占用探针 placement-盲（`registeredNames()` 无参），复审探针实测兄弟会话绑同一 server 时第二个会话拿到零工具，已修正为 `registeredNames(sessionID?)`。证据：`tool-mcp-registration.test.ts` "lets sibling sessions bind the same server independently" 与 "fails closed when a Location registration would shadow a session-placed server"。

### 2.5 工具命名空间（新增契约）

Canonical 名称强制前缀化：

```text
name ::= "mcp_" <sanitized-server-name> "_" <tool-name>
sanitized-server-name ::= [a-z0-9_-]+ （≤64 字符，来自 McpServerBinding.serverName 校验）
```

- 前缀把外部工具名与内建名分域，且 allowlist/Snapshot catalog 中来源可读；
- 名称整体仍须通过 `validateName` 的 provider-neutral grammar（`registry.ts:152`）。

> **Phase B 事实修正（2026-08-23）**：原文「前缀使 collision 域收缩到同 server 内部」**不成立**。`_` 在 server 段与 tool 段内均合法，前缀化后**不是单射**：server `a_b` + tool `c` 与 server `a` + tool `b_c` 同为 `mcp_a_b_c`（复审探针实测：注册前者后，后者报 collision）。后果由 §2.4 fail-closed 兜住（无遮蔽风险），代价是跨 server 可能出现**伪冲突**。不改分隔符：改用 `__` 既不能恢复单射（`_` 仍在两段内合法），又把固定开销从 4 字符抬到 6，进一步压缩下面的名称预算。
>
> **共享名称预算（Phase C Slice 4 定案，2026-08-25）**：最终名仍受 `validateName` 的 64 字符上限（`tool.ts:116`）约束。对 `mcp_<server>_<tool>` 不超过 64 字符的既有输入，名称**保持逐字不变**；这保护了已冻结 Snapshot catalog / tool fingerprint 的不可变契约。超过预算时，canonical 名固定为 `mcp_<server-prefix>_<tool-prefix>_<hash16>`：`hash16` 是完整原始 `(serverName, toolName)` 以 NUL 分隔后的 SHA-256 前 16 个十六进制字符（64-bit），两段前缀共享其余 42 个可读字符预算。实现仍对最终名做 `validateName`，并保留既有占用检查；极低概率哈希碰撞也会 **typed fail closed**，绝不发生静默覆盖。
>
> 定案依据是 Slice 4 对实际已安装 MCP 目录的结构化盘点：12 个 server key 中最长为 `openai-api-key-local-confirmation`（33 字符），其余可见实例包括 `cloudflare-api`、`codex-security`、`xcodebuildmcp`、`github`、`linear`、`notion`、`figma`；该目录没有一个现有 canonical 名越界。另一方面，已有真实样例 `azure-devops-work-items`(23) + `list_work_item_comments_with_expansion`(38) 会产生 66 字符，证明仅靠「目录当前没撞」不足以维持未来兼容。因此选择“短名恒定 + 长名带内容哈希的稳定压缩”，不采用纯截断（会把不同尾部工具折叠为同名），也不收紧 server 上界（会在 Builder/现存来源上制造无行动的拒绝）。

### 2.6 Fingerprint 契约：与 Snapshot 四字段同形，drift 由既有重验兜住

- **Registration fingerprint** 复用 Snapshot fingerprint 的四字段 shape（placement/name/digest/installationVersion；形状真源：`composition-resolver.ts:742-758` + `packages/schema/src/composition.ts:221-232`）：MCP 工具经 `register` 进入 registry 后，resolver freeze 与 runner turn 重验（`llm.ts:205-273`）**无需感知 MCP 特殊性**即可覆盖它们——materialize 自然包含已注册条目。
- **Server-level fingerprint（新增契约）**：`{ serverName, refRevision, configDigest, toolsCatalogDigest }`，其中 configDigest 是规范化 server 定义（binding + transport 参数，不含任何 secret）的内容 digest，toolsCatalogDigest 是该 server 当前工具目录聚合 digest。它用于 health 投影与 reconnect drift 判定，不进入 Snapshot（Snapshot 仍只见四字段工具指纹）。
- **Reconnect drift**：重连后重新 listTools，definitions 变化 ⇒ registry 条目更新 ⇒ 下一 provider turn 的既有重验报 `tool_fingerprint_mismatch` / `catalog_digest_mismatch` fail-closed。**无需新增漂移检测机制**——这正是把 MCP 接进同一 materialize 路径的红利。
- 运行中 Snapshot 不可变不变量维持：升级只能 fork/new Session（ADR-17 §10）。

### 2.7 隔离与一致性证明（测试钉死）

| 不变量                        | 证明方式                                                                                                                       | Phase B 状态                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 跨 Location 隔离              | Location A 注册的 server 在 Location B 的 materialize/settle 中不存在（registry 本就 Location-scoped，`ARCHITECTURE.md` §4.4） | ✅ 结构性成立：`location-layer.ts:267` 整个 lookup 组合以 `Layer.fresh` 收尾，绕过 MemoMap 按 Layer 对象引用的记忆化，每 Location 一份独立 registry 闭包。**例外须知**：`ApplicationTools.layer` 在 LayerMap `dependencies`（`location-layer.ts:289`）→ 进程全局单实例，而它并入 §2.4 占用域，故**冲突域不是 Location-scoped**（A 的应用工具会占掉 B 的 MCP 名）。存量设计，fail-closed，登记 technical-debt |
| 跨 Session 隔离               | Session placement 注册对同 Location 其他 Session 的 materialize 不可见                                                         | ✅ `tool-registry-placement.test.ts` 三例（含 close 后消失 + 跨会话 settle 负向）                                                                                                                                                                                                                                                                                                                            |
| definitions ≡ captured settle | settle 绑定物化时的 registration.identity，漂移即 stale error（`registry.ts:96-97`；Laws 见 `specs/v2/tools.md:178-179`）      | ✅ 见 §4 条件 C1 状态                                                                                                                                                                                                                                                                                                                                                                                        |
| V1 单向隔离                   | Custom Session 的 materialize 结果中不出现任何 V1 InstanceState 来源的工具；V1 HTTP 面改动不影响 canonical 路径                | ✅ 结构性成立并已钉死：V1 用**另一个** registry（`aigcfroge/src/session/tools.ts:10` 的 `@/tool/registry`），V1 MCP 工具落在本地 `Record`（`:386` 的 `mcp.tools()`），从不进 canonical `local`。因两个 registry 同名不同包、边界离「被 refactor 抹掉」只差一行 import 且抹掉后无任何别的测试会红，故补 source contract：`aigcfroge/test/session/v1-canonical-registry-boundary.test.ts`                      |
| 安全成对覆盖                  | 每条「模型看到定义」测试必有对应「settle 真执行」负向测试（计划 §4）                                                           | ✅ placement 与 MCP 命名两套测试均为「定义可见 + settle 真执行 text」成对                                                                                                                                                                                                                                                                                                                                    |

### 2.8 Kill-switch 与 disable 通知（§4.5-2 的 registration 部分）

- `AIGCFROGE_CUSTOM_MODE` 被关闭后：下一次 canonical MCP `connect` 或 `callTool` admission 会读取同一 flag owner 并 typed reject；该 admission 同时关闭当前 owner 的 MCP connections，pending request 由 owner finalizer 释放。**这不是环境变量变化的异步通知**：没有后续 MCP admission 的在飞 Provider/child 中断仍属于 technical-debt 的进程内通知缺口，Phase C 不得宣称即时中断。
- 「关闭即中断在飞 child/Provider 请求」的进程内完整通知，与 workflow kill-switch 根治项共用同一机制（technical-debt §3.1 第 1 项：disable 通知 → `WorkflowExecution.interrupt` + `SessionExecution` 中断），本 ADR 只承诺 registration 资源随 flag fail-closed，不虚称能中断任意在飞 Provider 流。

### 2.9 Layer ordering 与资产写入面

- Connection owner layer 必须位于 `Tools.Service` 可用之后（Location layer 依赖序），禁止形成 `PluginBoot -> Tools -> PluginBoot` 循环（`specs/v2/tools.md` Follow-Up 既有约束）。
- MCP 资产 apply/导入路径不得再把 `configJson` 当 opaque 串直存（现状 ≤100,000 字节裸串，`schema/src/mcp-asset.ts:34-40`）：写入面必须经 `McpScope.McpServerBinding` 解码校验（解码期上界与结构校验，§4.5-3 教训）。存量 opaque 行读取兼容策略在 Phase C 定义。

---

## 3. 架构影响与五层映射

| 层级        | 变更                                                                                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1 Schema   | `McpScope.McpServerBinding` / `GrantScope` / `ScopedGrant` / `McpConnectionHealth`（已在 `packages/schema/src/mcp-scope.ts` 落地并通过负向用例）；后续按需增补 server fingerprint 编码 |
| L2 Core/DB  | ToolRegistry 的 sessionID 过滤维度（小扩展）；connection owner Service（Phase C）；无第二 registry/executor                                                                            |
| L3 HTTP/SDK | Phase C/F：connect/status/revoke 端点（V1 面之外新增，带能力头）；SDK 重新生成                                                                                                         |
| L4 App      | Builder MCP blocks、health/diagnostics 投影（Phase F）                                                                                                                                 |
| L5 Security | collision fail-closed、命名空间前缀、owner Scope 清理、kill-switch admission、跨 Location/Session 隔离矩阵（§2.7）                                                                     |

## 4. 审批与授权记录

审批日期 2026-08-23，`main@1d5c51f6c`。审批方独立复核了本 ADR 引用的代码事实与外部引用（`specs/v2/tools.md:178-179` Laws、`ARCHITECTURE.md` §4.4、`registry.ts` 注册/finalizer/stale 机制、`application-tools.ts:42-50` 缺 finalizer、`mcp-asset.ts:34-40` opaque 串），并实跑 `packages/schema/test/mcp-scope.test.ts` → **17 pass / 0 fail**。

| 评审方     | 结论                           | 备注                                                                                                                                                                                                                                                                                           |
| ---------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product    | **Approved**                   | §2.1 并存-冻结成立：一次性收敛会拖入 V1 全部消费方与双轨凭据迁移，超出 M3 门禁。V1→canonical 迁移归 M4 Gate 输入，须登记 technical-debt                                                                                                                                                        |
| Core       | **Approved with condition C1** | §2.2 的 `materialize` 增加 `sessionID` 过滤维度是必要扩展；条件见下                                                                                                                                                                                                                            |
| Security   | **Approved**                   | §2.4 collision 由 last-wins 收窄为 typed error 是本 ADR 最重要的决策——外部 server 可控工具名在现机制下能静默遮蔽 `read`/`bash`（`registry.ts:88/:177` 的 `.at(-1)` 直接生效）。§2.5 前缀化、§2.3 owner Scope、§2.9 解码期校验均通过。§2.8 明确拒绝虚称能中断在飞 Provider 流，符合诚实边界要求 |
| App        | **Approved**                   | §3 L4 投影范围仅读取服务端 health/diagnostics，不自行推演授权                                                                                                                                                                                                                                  |
| Schema+SDK | **Approved**                   | `mcp-scope.ts`（157 行）+ 17 例正负用例已落地并实跑通过                                                                                                                                                                                                                                        |

### 批准条件（Phase B 开工前必须处理）

- **C1（Core）**：`materialize` 的 `sessionID` 过滤必须与 §2.7「definitions ≡ captured settle」同时成立——settle 侧的 placement 校验要和 definitions 侧用**同一次**物化结果，不得二次查询 registry。否则会重新打开 stale 窗口，而 stale rejection 正是 §2.7 用来证明一致性的既有 Law（`registry.ts:96-97`）。红测试：同一 Session 在物化后、settle 前发生 Location 注册变化，settle 必须仍绑定物化时的 identity。
  - **状态：守卫已落地**（`custom-child-turn` 分支 `test/core/tool-registry-stale.test.ts`："settle keeps the materialized identity across a mid-flight registration change"）——该测试钉死既有 Law 的四个相位（物化前 settle 成功 / 重注册后 stale / 关闭新注册露出旧赢家后同一物化恢复 settle / 全部关闭后 stale）。因 Law 今日已成立，测试即时通过而非红先行；其角色是 Phase B sessionID 过滤实现期间的回归守卫。
  - **状态：已闭合（2026-08-23 复审整改后）**。首版实现的 settle 侧 placement 取自 `input.sessionID`（调用方）而 definitions 侧取自 `options.sessionID`（物化）——**两个独立来源，无任何不变量保证相等**，正是 C1 禁止的「二次查询」。复审探针实测两处后果：① 生产路径上唯一两个 materialize 调用点（`session/runner/llm.ts:209`、`:556`）都不传 sessionID，故一旦出现 Session 注册，该 Session 自己的注册会成为比已公布 definitions 更新的赢家 → 每次调用回 `Stale tool call`，即一条 session 注册可静默废掉该会话的内建工具；② 为 Session A 物化的结果在 Session B 身上照样执行。两者均 fail-closed（无 fail-open），但都是 Phase C 地雷。整改：`Materialization` 携带自身 placement，settle 用捕获值做可见性过滤，且 Session 物化被非本 Session settle 时以 placement mismatch 失败。证据：`tool-registry-placement.test.ts` "a Location-wide materialization is not perturbed by a session registration"（红先行已验证）+ 跨会话 mismatch 断言；`tool-registry-stale.test.ts` 四相位保持全绿。
- **C2（文档）**：§2.6 引用的「`specs/v2/tools.md` §Accepted Extension」**该小节名不存在**（Laws 在 `:178-179`，无此标题）。四字段指纹形状的真源是 `composition-resolver.ts:742-758` + `packages/schema/src/composition.ts:221-232`，改引这两处。这是引用不实，不影响决策实质，但必须修正后才能作为 Phase B 的施工依据。
  - **状态：已修正**（本提交，§2.6 首条改引两处真源）。
