# Custom Mode M3 实施计划：MCP 与统一审批

> 状态：**进行中** —— Phase A（`7a2804624`）、Phase B（`99dce8906`）、Phase D（`38d82e2b3`）、**Phase F0**（`f66f93d8c`，合并为 `229e3eb7d`）已交付、经独立复审整改并合入本地 main。当前可开工：**Phase C**（[ADR-21](../architecture/adr/ADR-21-mcp-credential-custody.md) 已 Accepted v1.0、G3-3 于 2026-08-24 通过；**Slice 0 独立事实复核为不可跳过的前置**）。Phase E 依赖 C，Phase F 本体需产品定界面
> 执行提示词：[Custom Mode M3 Phase C 执行提示词](prompt-custom-mode-m3-mcp-approval.md)（2026-08-24 收窄为纯 Phase C：提示词一次只覆盖一个 Phase，因为 Phase C 一交付就会让 E/F 段引用的多条事实过期）
> 分析基线：§0 写于 `main@a11b50020`（2026-08-22），已按 Phase A/B/D/F0 复核逐条更正；执行基线为开工时最新**本地** `main`（现 `229e3eb7d`，领先 origin 38 提交，M3 全部结束后统一开一个 PR）。测试基线：core 2109 pass / 2 skip / 0 fail；aigcfroge server 379 pass / 2 skip / 0 fail
> 范围：Session/Location scoped MCP canonical registration、credential refs、health/revocation、once/Session/Location grant、应用级审批入口
> 前置：[Custom Mode M2](custom-mode-m2-multi-agent-workflow.md) 已完成并合入（复审 [APPROVED](../review/AigcForge_CUSTOM_M2_REVIEW.md)）
> 上级计划：[Custom Mode 组合平台实施计划](custom-mode-composition-platform-implementation.md)

---

## 0. 根问题与当前缺口

M3 的根问题不是「让 Profile 能选 MCP」，而是让外部工具在一个明确 Location/Session/Agent/revision scope 内进入唯一 ToolRegistry，并且凭证、授权、健康、撤销和无人值守策略都能 fail closed。

> **代码事实的时效性**：本节写于 `main@a11b50020`。Phase A 的第一份产出就是把本节逐条复核到开工时的最新 `main`，用 `file:line` 落实或修正；发现偏离时先修计划，再施工。

### 0.1 当前代码事实（`main@a11b50020` 独立核查，2026-08-22）

> 本节由独立事实核查产出并抽查复核过关键三条（credential 明文、V2 permission 无客户端、unattended 已 fail-closed）。**旧计划 §0 的四条事实有两条是错的、两条严重不完整**，逐条纠正如下。

#### MCP 运行时：今天根本没连

- `McpV2` 公开接口只有 `start/stop/tools/callTool`（`packages/core/src/mcp/mcp-v2.ts:13-22`），不注册 canonical Tool。
- **旧计划说「`v2-bridge.ts` 使用宽类型和进程内 server Map」——位置和状态都错。** 该文件在 `packages/aigcfroge/src/mcp/v2-bridge.ts`（164 行）而非 `core`，且是**死代码**：全仓唯一引用是它自己的 barrel 行（`:1`），`globalLayer`（`:158-164`）零调用方，依赖的 `McpAuthV2` 生产never provided，无测试。生产装配是 `McpV2.noopLayer`（`packages/aigcfroge/src/effect/app-runtime.ts:195`），且 `McpV2.Service` **零消费方**。
  **结论：M3 不是「重构现有 bridge」（Phase C 绿的原话），而是写第一个能跑的实现。** 其 `cfg` 是字面 `any`（`:33/:40/:55`），掩盖了 OAuth 键 camelCase↔snake_case（`:70` vs `packages/core/src/config/mcp.ts:17-23`）与 `disabled`↔`enabled` 两处不匹配，编译器抓不到。
- **真正在跑的是 V1**：`packages/aigcfroge/src/mcp/index.ts`（979 行），状态不是进程全局 Map，而是按 instance 目录键的 `InstanceState` ScopedCache（`:477`、`packages/aigcfroge/src/effect/instance-state.ts:30-49`）。真进程全局只有 `pendingOAuthTransports`（`:123`）与无删除 API 的 contributor 注册表（`packages/core/src/mcp/contributor.ts:25`）。**实际 scope 是 per-instance-directory**：多 Session 共用一套 client 与 defs。
- **没有 reconnect、没有 health 轮询**（两个 MCP 目录 `reconnect|healthcheck|ping\(` 0 命中）；health 只有被动 `client.onclose`（`:428-440`）。Phase B 红的「reconnect 产生 fingerprint drift」没有可扩展的既有机制。
- **旧计划完全没提的两块已存在**：① Location-scoped 且在服役的 MCP **资产**子系统（`packages/core/src/mcp-asset.ts` 200 行、`mcp-asset-service.ts` 399 行、`mcp-asset/path.ts`，wired 在 `location-layer.ts:119/:151/:198/:249`），其 `configJson` 是不解码的 ≤100000 字节 opaque 串（`packages/schema/src/mcp-asset.ts:34-40`），`env` 被写模板丢弃（`mcp-asset-service.ts:234-236`）；② 已在服役的 V1 MCP HTTP 面 `/mcp`、`/mcp/:name/{auth,connect,disconnect}`（`.../groups/mcp.ts:32-39`，`MCP.node` 无条件在 server 图里 `server.ts:305`）。Phase F 的 connect/status 部分已存在，缺的是 revoke。

#### ToolRegistry：机制已有，缺的是身份契约

- **旧计划「Session-scoped registrations 仍缺设计」仍然成立**（`packages/core/src/tool/AGENTS.md:58`），但要说准：`register` **本来就是运行时动态的**（闭包 `Map` 在调用时 mutate，`registry.ts:157`）且**已有 Scope 清理**（`:158-166`）；同名冲突是**入栈后 last-wins、不抛错不丢失**（`:157`、读 `:177`）。缺的不是机制，是 identity/placement 契约。
- 反例警示：`ApplicationTools` 要求 `Scope` 却**根本没装 finalizer**（`application-tools.ts:42-50`）。〔Phase B 更正 2026-08-23：此条有误——清理由 `State.transform` 内建（调用方 Scope finalizer + 重放恢复，`state.ts:88-93`）提供，overlay 关闭后正确揭示前一注册；证据测试 `application-tools.test.ts` "reveals the previously registered tool after an overlay scope closes"。保留原文仅作记录，缺口不存在〕
- **fingerprint 不在 registry**（`packages/core/src/tool/` 内 `fingerprint` 0 命中），它在 resolver/schema（`composition-resolver.ts:742-758`、`packages/schema/src/composition.ts:221-232`）。所以 Phase B 的「registration fingerprint」是**新概念**，不是扩展既有。
- Snapshot 冻结用的是 `tools.materialize()` 无参调用（`composition-resolver.ts:742`），源是**活的 registry**，所以 MCP 工具在结构上能进冻结集——只是今天没有任何路径注册它。运行期每轮 provider turn 会拿 `snapshot.data.tools.catalog` 当 allowlist 并重验 fingerprint，fail-closed（`session/runner/llm.ts:205-273/:541/:547`）。
- **旧计划 Phase E 说「扩 composition v3/version union」需修正**：union 是 V1|V2（`composition.ts:301-302`），**没有 v1→v2 升级**，未知版本硬失败（`session/composition.ts:112-117`），消费方各自 `switch version`（如 `session.ts:335-338`）。v3 = 每个这类站点都要加第三分支。

#### Permission / Grant：`always` 只有 4 个字段

- **旧计划「`always` 是既有 Project 语义」正确且现在可验**：持久化写 `projectID`（`permission.ts:290`），表唯一键 `(project_id, action, resource)`（`permission/sql.ts:11-19`）。
- **但旧计划严重低估了缺口**：saved 行**没有 expiry、没有 revocation 标记、没有 per-agent、没有 per-revision、没有 per-session**——`PermissionSaved.Info` 就 `{id, projectID, action, resource}`（`saved.ts:17-23`）。ask 是 agent-aware 的（`permission.ts:57/:197`），持久化的行不是。**G3-2 的「action/resource/agent/revision/expiry/revocation」是 100% 绿地。**
- 持久化的 resource 来自工具自报的 `save`，可以比被问的更宽：`read` 存 `*`（`tool/read.ts:70`）——即一次 `.env` 的「总是允许」会落成项目级 `read *`。
- 一次 `always` 回复会**顺带放行其它 Session 的 pending**（`permission.ts:299-320`）；一次 `reject` 会**级联拒绝同 Session 全部 pending**（`:275-284`）。
- **最接近的现成原语**：break-glass 60 秒租约（Location-scoped Map、非 durable 事件、对 child 与 unattended 一律拒绝，`permission/session-override.ts:14/:58/:63-65/:69-77`）。ScopedGrant 应参照它 + M2 的 durable owner 模式。
- **G3-4 的表述要改**：unattended **已经**是 fail-closed（`ask`→`deny`，`effective.ts:86-93`，实测确认）。真正的缺口是**「有人值守但没有客户端连着」会永久挂起**——`Deferred.await` 无任何 timeout（`permission.ts:247`；permission 模块 `Effect.timeout` 0 命中），只能等 Location idle 驱逐（60 分钟）时被 finalizer 以 `RejectedError` 释放（`:150-160`、`location-layer.ts:267`）。
- **Phase F 的「全局 pending center」也要改**：V2 的 pending/reply HTTP 面**已经存在并已挂载**（`packages/server/src/groups/permission.ts:14-85`、handlers `:17-59`、挂载 `.../httpapi/api.ts:105`）。缺的是**客户端**：`permission.v2` 在 app/tui/session-ui/ui 全部 **0 命中**（实测确认），app 只处理 V1 的 `permission.asked/replied`（`event-reducer.ts:387/:408`）并从 V1 端点 bootstrap（`bootstrap.ts:294`）。
- **一个会咬人的陷阱**：custom Session 的 `permission.v2.asked` 对**没带 `product-mode-custom-v1` 能力头**的客户端会被 SSE 过滤掉（`product-mode-policy.ts:183-196` 经 `handlers/event.ts:33/:46`）。审批中心必须带能力头，否则永远收不到请求。

#### Credential：明文 + 全局，两个 owner

- **旧计划「Credential service 可保存秘密」说得太轻**：秘密是**明文**存的——`text({mode:"json"})`（`credential/sql.ts:9`），写入逐字（`credential.ts:113/:125`），core/aigcfroge 全仓无任何加密（`encrypt|cipheriv|aes-256|keytar|safeStorage` 均无相关命中）。**已实测确认。**
- **凭据是全局的，不是 per-project / per-location**：表无任何 scope 列（`credential/sql.ts:5-14`），唯一键是 `integration_id`，且 `create` 会先删该 integration 的所有旧行（`:103-106`）；库是单一进程全局 SQLite（`database/database.ts:42-61`），其 layer 跨 location memoize（`location-layer.ts:273`）。**G3-3 的「跨 Location 隔离」没有既有机制。**
- **旧计划「Snapshot 只能持有 opaque ref」是愿望不是约束**：opaque ref *类型*存在（`Connection.CredentialInfo`，`packages/schema/src/connection.ts:6-11`，经 `Integration.connection.resolve` 解析 `integration.ts:185-187/:421-436`），但 `SnapshotDataV2` **没有任何能装它的字段**（`composition.ts:254-276`；`SnapshotToolInfo` 只有 name/digest 串 `:221-232`）。这是新 schema。
- **不存在「唯一 secret owner」**：第二个秘密存储绕开了 Credential service——`auth.json` 经模块级 seam（非 Layer）接入（`session/runner/auth-seam.ts:19-30`、`runner-auth-bridge.ts:19-33`），另有 `mcp-auth.json`（`mcp/auth.ts:37`、`mcp/v2-auth.ts:36`）。
- **`CredentialScanner` 只有一个生产调用点**：M2 的 workflow root handoff（`workflow-runner.ts:436`，先扫描后裁剪 `:66-73`）。日志与其它事件发布路径**都没接**。Phase C 红的 "secret redaction" 不能当成既有层来倚靠。顺带：durable 事件里未脱敏的是任意会话文本与工具输出（`session/event.ts:131/:142/:153/:189`）。
- Plugin 已经能拿到解析后的明文秘密（`plugin/host.ts:100-108/:133/:146/:157-160`）——属 M4 边界，但今天为真。

#### M2 新增、M3 必须遵守而非绕开

- **registration scope 的范式已定**：M2（提交 `d8cacfba8`）**删除**了 `TaskDriver` 的进程级 `let installed` 单元，改为 `Context.Reference` + 每个 composition root 一个 `Ref`（`tool/task-driver.ts:173-180/:210-226`），缺失即 `Effect.die` fail closed，`install` 改名 `make` 且变纯函数。**M3 的 scoped registration 不得重新引入模块级可变单元。** 反面教材仍在一个文件之外：`tool/cli-adapter.ts:71` 的 `const adapters = new Map()`。
- **consumer scope 语法已存在**：bindings key 是正则校验的普通串 `^(orchestrator|agents\/[a-zA-Z0-9_-]+)$`（`composition.ts:64-70/:257-260`），非法即解码失败。**注意不对称**：输入侧用 branded `Consumer`，snapshot 侧用无 brand 的 `ConsumerKey`（`:125` vs `:257`）；且**没有 key 构造 helper**，唯一生产 `agents/…` 的地方是按 agent **name** 建的校验集（`composition-resolver.ts:305-308`）。
- **没有 `mcp` binding 槽**：`Binding`（`:77-84`）与 `SnapshotBindingData`（`:240-244`）只有 prompts/skills/commands。`McpRef`（`:55-59`）是**死代码**——不在 `AssetRef` union 也不在 `AllowedKind`，全仓仅自身声明。Snapshot v2 无任何 MCP 形状字段。
- **durable owner 模式已落地**：`WorkflowRun` 唯一 CAS 写入者，状态写在 `EventV2.publish(..., { commit })` 的 commit 回调里、与事件行同事务。ScopedGrant store 照抄，别发明新一致性方案。
- **kill switch 边界**：`assertRuntimeSupported("custom")` flag 关时失败，覆盖核心域 6 处（`session.ts:361/:653/:683/:715/:742/:752`）+ HTTP 32 处（`handlers/session.ts:146` 被 28 处调用、`packages/server/src/handlers/session.ts:63` 被 4 处）。flag 是**访问期 getter**（`flag/flag.ts:74-76`），只认 `"true"`/`"1"`，未设即 false。但只保证「不再派发新工作」，**不中断在飞工作**。另注：该函数 `:37-38` 的注释声称「domain 层不读 flag」**已经是假的**。

### 0.2 M2 移交给 M3 的三项前置（technical-debt §3.1）

1. **Agent 资产可自授权限 + workflow child 无人值守 —— G3-2/G3-4 的真实动机。** 链路已核实到行：资产 frontmatter `config` 串（`agent-asset.ts:104`）→ `parseAgentAssetConfig` 解成 `ConfigAgent.Info`（`agent/asset-bridge.ts:18-36`）→ `permissions` 逐字进全局 `AgentV2` 注册表（`:66/:93-95`）→ `permission.ts:174-175` **只按 agent ID 从注册表取 base**，从不查 snapshot → `custom` 不是 elevated mode 所以 base 原样进 `compute`（`effective.ts:44-55`）→ `evaluate` 取**最后**匹配（`permission.ts:106`）。因此尾部 `{*:*:allow}` 对一切动作胜出，之后只追加 base 的**非通配 deny**（`effective.ts:84`），作者省掉即可。unattended clamp 只做两件事：头部插 deny + 把 `ask` 改写成 `deny`（`:86-93`）——**不动 allow、不重排**，而 `evaluate` 是 `findLast`，所以尾部 allow 完好存活并继续胜出。身份是 author 可控的 `name`（`composition-resolver.ts:197-203`、`asset-bridge.ts:44`、`workflow-runner.ts:267-269`、`session/composition.ts:251-253`）；snapshot 明明带了 `relativePath` + `revision` 且 resolver 会报 `agent_stale_revision`，但 `permission.ts` 从不查它——**没有任何东西验证注册表里名为 X 的条目来自被绑定的那个资产**。同名变体：与已注册 agent 冲突的资产被**丢弃并只记一条 warning**（`asset-bridge.ts:86-92`），内置 `build` 的 ruleset 以 `{*:*:allow}` 开头（`plugin/agent.ts:228`）。系统提示还会对模型说「本会话无人值守，写入与命令工具不可用」（`system-context/permission-state.ts:38-39`）——**存在尾部 allow 时这句是假的**。**Grant ADR 必须裁决**：为 `mode === "custom"` 的 child 用 deny-first 的 custom 基线与解析出的 ruleset 求交，并在 agent provenance 与绑定 `relativePath` 不一致时 fail closed。
2. **kill switch 无「关闭即中断在飞 child」的进程内通知**（见 §0.1 最后一条）。
3. **图不变量不在解码期强制**：ADR-18 §2.5.3 写「解析期拒绝」，实现却只在 `freeze` 期拒绝（`validateGraph` 唯一非测试调用方是 `composition-resolver.ts:257`）。M3 若给 MCP 资产加写入面，不要复制这个错误——解码期就要有上界与结构校验。**注意 MCP 资产已经踩了同一个坑**：`configJson` 是不解码的 opaque 串。

### 0.3 一个相邻的、未登记的矛盾（Phase A 必须裁决）

每轮 provider turn 都调 `ProductModeAgentPolicy.enforcePrimary(session.mode, session.agent)`，**无 parent/child 豁免**（`session/runner/llm.ts:479`），而 `checkPrimaryAgent("custom", agent)` **只允许 `"meta"`**，否则 `Effect.die(AgentNotAllowedError)`（`product-mode-agent-policy.ts:111-120`）。但 custom 的 child 本来就该拿非 meta 的 agent：`resolveAgent` 的 `parent && parentSnapshot` 分支在 `assertAgentAllowed` 后直接返回 `input.agent`，绕过了 create 期的 `enforcePrimary`（`session.ts:334-342`），mode 继承自 parent（`:358`）；测试确实断言了 `agent: "custom-coder"` + `mode: "custom"` 的 child 能建成（`custom-mode-security.test.ts:543-552`）。而 workflow child 走的正是同一个 runner（`task-driver.ts:484-487`）。**这意味着 M2 的 workflow 委派在真实 provider turn 上可能踩 `Effect.die`——事实核查未能证伪（无测试驱动真实 turn）。Phase A 的第一个红测试就该驱动一个非 meta custom child 跑一轮，确认它是死路还是有别处兜住。**

## 1. 开工 Gate

| Gate                  | 通过标准                                                                                                                                                                                                                                                                                                                      | 状态                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 阻塞范围    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| G3-0 前置             | M1 Tool allowlist/fingerprint/Permission 运行稳定；M2 已上线，Agent scope 已可表达                                                                                                                                                                                                                                            | **已满足**（M2 = PR #46 / `a11b50020`，复审 APPROVED）                                                                                                                                                                                                                                                                                                                                                                                                                           | 全部        |
| G3-1 Registration ADR | Session/Location registration、owner Scope、name collision、fingerprint、cleanup、reconnect 批准                                                                                                                                                                                                                              | **已通过** —— [ADR-19](../architecture/adr/ADR-19-mcp-scoped-registration.md) Accepted v1.0（2026-08-23），条件 C1/C2 均已闭合                                                                                                                                                                                                                                                                                                                                                   | MCP runtime |
| G3-2 Grant ADR        | once/Session/Location + action/resource/agent/revision/expiry/revocation 的唯一真源批准，且回答 §0.2 第 1 项                                                                                                                                                                                                                  | **已通过** —— [ADR-20](../architecture/adr/ADR-20-scoped-grant-model.md) Accepted v1.2（2026-08-23），§0.2 第 1 项由 §2.6 回答（unattended 只读白名单已落地；attended 重写为 `ask` 已裁定）                                                                                                                                                                                                                                                                                      | 审批/执行   |
| G3-3 Credential       | secret owner、opaque ref、rotation/revocation、日志脱敏和跨 Location 隔离批准                                                                                                                                                                                                                                                 | **已通过** —— [ADR-21](../architecture/adr/ADR-21-mcp-credential-custody.md) Accepted for M3 Phase C implementation v1.0（2026-08-24 人类裁定 §2.5：静态加密**排除在 M3 之外**，另立专项；M3 只做两项止血 —— DB 文件权限与既有 `0o600` 对齐、`McpServerBinding` 解码期拒绝秘密字面量）。**带前置条件**：ADR 由复审方起草，故 Phase C 第一件事必须是 Slice 0 独立事实复核（§1.1 的 8 条事实逐条复跑）；§2.2「必须新增 `mcp_credential_binding`」是**唯一可被 Slice 0 推翻**的一条 | 连接        |
| G3-4 Unattended       | **表述已按事实修正**：unattended **已经** fail-closed（`ask`→`deny`）。本 Gate 真正要批的是 ① 「有人值守但无客户端」的 ask 超时策略（今天无 timeout，永久挂到 Location 60 分钟驱逐）② §0.2 第 1 项的尾部 allow 绕过 clamp 该如何堵 ③ 审批中心必须带 `product-mode-custom-v1` 能力头否则收不到 custom 的 `permission.v2.asked` | **已通过** —— 三项均由 ADR-20 回答（① §2.7 ② §2.6 ③ §2.8）                                                                                                                                                                                                                                                                                                                                                                                                                       | Beta        |

**当前可开工阶段是 Phase C**（connection、credential 与 health），分支 `mcp-connection`。Phase A（`7a2804624`）、Phase B（`99dce8906`）、Phase D（`38d82e2b3`）、Phase F0（`f66f93d8c`，合并为 `229e3eb7d`）均已交付、经独立复审整改并合入本地 main。**G3-3 已于 2026-08-24 通过**（[ADR-21](../architecture/adr/ADR-21-mcp-credential-custody.md) Accepted v1.0），Phase C 解锁；但因 ADR 由复审方起草，**Slice 0 独立事实复核是不可跳过的前置**，任一事实被证伪即停机改 ADR，不得因为「Gate 已过」而跳过它。Phase E 依赖 Phase C 交付的连接实体，Phase F 本体需产品定界面。

应用级审批入口只聚合 pending request；它不成为“应用级永久 allow”。

## 2. 五层设计

| 层              | M3 交付                                                                                                     | 不变量                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| L1 Schema       | MCP binding/ref/health/fingerprint、ScopedGrant、pending request                                            | scope/version/expires/revoked typed；**解码期就有上界与结构校验**，不留 opaque 串 |
| L2 Core/DB      | MCPConnection owner、ScopedGrant owner、registration lifecycle                                              | secret 不进 Snapshot/event/log；owner Scope 负责清理，**无模块级可变单元**        |
| L3 HTTP/SDK     | connect/status/**revoke**、pending/reply/grant/revoke APIs（**pending/reply 的 V2 面已存在，见 §0.1**）     | auth + scope checks                                                               |
| L4 App          | Builder MCP blocks、health、全局 pending center（**这是真正缺的一层：V2 事件与端点都有了，客户端 0 消费**） | 入口全局可见，grant 明确显示 scope；**必须带 `product-mode-custom-v1` 能力头**    |
| L5 Tool/runtime | canonical registration、captured settle、runtime permission/grant recheck                                   | Location A 永不泄露到 B                                                           |

## 3. 分阶段实施

### Phase A：Registration/Grant ADR 与 Schema

**红**：scope grammar、Location/Session/Agent/revision identity、expiry/revocation、MCP server/tool fingerprint、name collision、credential ref secret rejection、old Snapshot version compatibility；**外加 §0.3 的 `enforcePrimary` 矛盾——驱动一个非 meta 的 custom child 跑一轮真实 provider turn，确认是否 `Effect.die`**。

**绿**：接受两个 ADR；定义 MCP binding、health state、ScopedGrant/pending request、event/error schemas；决定扩 `PermissionSaved` 还是新增唯一 `ScopedGrant` owner。默认建议新增 scoped owner 并让 PermissionEffective 消费，避免破坏 `always` 兼容语义——**注意 saved 行今天只有 4 个字段，expiry/revocation/agent/revision 全是绿地（§0.1）**。

**重构**：authorization fact 与 connection health 分离；Snapshot audit digest 与实时 grant 分离。

### Phase B：Canonical scoped registration

**红**：Location/Session register/unregister；latest active placement规则；Scope close 只移除自己的工具；同名 collision；definitions/settle捕获一致；reconnect revision变化产生 fingerprint drift；A/B Location 隔离。

**绿**：给 MCP producer 注入窄 `Tools.Service` capability；每个 server/Session 拥有 Scope；把工具转换为 canonical `Tool.make`，settle 回到 MCP client且保留 interruption/ToolFailure。

**重构**：不增加 MCP registry/executor；ToolRegistry 仍是唯一执行入口。先解决 Location-layer ordering，不能形成 `PluginBoot -> Tools -> PluginBoot` 循环。

> 事实校准（§0.1）：`register` 已是运行时动态且有 Scope 清理，冲突已是入栈 last-wins，所以本 Phase 要建的是 **identity/placement 契约**而非注册机制。**registration fingerprint 是新概念**（fingerprint 今天只在 resolver/schema，registry 内 0 命中）。今天**没有 reconnect 也没有 health 轮询**，「reconnect 产生 drift」没有可扩展的既有机制。~~顺路修 `ApplicationTools` 要求 `Scope` 却无 finalizer 的缺口~~〔Phase B 更正：该缺口不存在，见 §0.1 反例警示处的更正〕。

### Phase C：Connection、credential 与 health

**红**：stdio/remote/OAuth connect、invalid URL/command/config、credential missing/expired/revoked、disconnect/reconnect、timeout、process interruption、secret redaction、跨 Location ref拒绝。

**绿**：**写第一个能跑的 typed MCPConnection owner**——`v2-bridge.ts` 是零消费方的死代码（§0.1），可以当参考但不要假设它「在服役」；同时决定 V1 `mcp/index.ts`（979 行、按 instance 目录 scope、已有 HTTP 面）是收敛进来还是并存。凭证只经 Credential/Integration service 解析；health=`connecting|ready|degraded|offline|auth-required|revoked`；Snapshot 只存 ref/fingerprint（**该字段在 Snapshot v2 里还不存在，是新 schema**）。

**重构**：移除新增路径里的宽 `any`/raw console（`v2-bridge.ts` 的 `cfg: any` 掩盖了两处真实的键名不匹配，见 §0.1）；expected failures 用 tagged errors，外部 SDK callback 经 Effect 边界兜底。**`CredentialScanner` 有 2 个生产调用点（`location-layer.ts:178` 提供 layer、`workflow-runner.ts:205` 调用），且是正则文本扫描器而非密钥管理，secret redaction 不能当既有安全层倚靠。**

### Phase D：ScopedGrant 与 PermissionEffective

**红**：once 消费一次；Session 不跨 Session；Location 不跨 Location；agent/revision mismatch；expiry/revocation立即生效；deny 始终胜出；saved `always` 不被静默迁义；unattended ask fail closed。

**绿**：实现唯一 grant store/service和事务；PermissionEffective 查询候选 grant但仍由 leaf assert最终授权；pending request/reply/revoke事件持久或可回放语义按 ADR 落地。

**重构**：审批 UI、Resolver、ToolRegistry 不计算授权；统一走 Permission owner。

> **Phase D 必须一并处理的两项 R6 残留**（technical-debt §3.1 已独立登记，触发条件即「Phase D 开工时」；它们与 grant 注入点是同一处代码，不单开 slice）：
>
> 1. **attended custom 的资产自授权限尾部 allow**（[ADR-20 §2.6](../architecture/adr/ADR-20-scoped-grant-model.md) attended 条目，**2026-08-23 已裁定：重写为 `ask`，非 `deny`**）。unattended 半边已由 R6-1/R6-2 封住（只读白名单 `glob|grep|list_assets|read` + 显式 deny 位序保证），attended 半边仍开放：天花板只在 `attended === false` 启动（`effective.ts:92`），所以 attended custom 会话里 `bash`/`edit`/`write` 判定为 `allow`，而**审批框只在判定为 `ask` 时才弹**——直接 allow 意味着框根本不出现，「用户在场 ≠ 用户同意」。实测同一 allow-all 资产：`attended=false → 全 deny`，`attended=true → 全 allow`。裁定为 `ask` 而非 `deny` 的理由：缺陷本质是框不弹，压成 deny 会连带废掉合法的写文件类 custom agent 且用户没有在场放行途径；与 2026-08-16 对 meta 的既有裁决同型。落地要点：① 生效位序为 头部 fallback deny → 非白名单资产 allow 重写为 ask → 白名单 allow → 显式非通配 deny（`evaluate` 是 `findLast`）；② **必须区分「base 来源」与「saved 追加来源」**，用户真实点过 always 的 saved approval 不受天花板影响，否则会把用户自己的显式授权一起削掉；③ 加 provenance 校验（注册表条目须来自被绑定资产的 `relativePath`+`revision`，不一致 fail closed）；④ **白名单成员是已裁定项**：`skill` / `kb_search` / `question` 不纳入，需要时走 grant 签发而非放宽天花板——授权主体不同，不可互替；任何成员变更须重新过 Security 复审并同步 `permission-effective.test.ts` 的范围界定测试。
>
>    **⚠ 不可分割的时序约束**：今天 app/tui/session-ui/ui 对 `permission.v2.*` **零消费**，且 custom 会话的 `permission.v2.asked` 对未带 `product-mode-custom-v1` 能力头的连接会被 SSE 过滤掉。因此在审批中心（Phase F）落地前，attended custom 的每一个 `ask` 实际处于**无人可答**状态。只做重写而不做 [ADR-20 §2.7](../architecture/adr/ADR-20-scoped-grant-model.md) 的「无应答方即时拒绝」，会把一个安全洞换成「每次工具调用挂到 TTL 再失败」的可用性事故，并直接触犯本计划 §6 停止条件「ask 在 unattended/headless 状态可能无限等待」。**重写与无应答方快速拒绝必须同一 slice 交付**；且判据必须来自连接/订阅事实，不得用「`attended` flag 没被显式设成 false」冒充（`effective.ts:48` 的 `input.attended !== false` 是默认值，不是「真有人能答」）。
>
> 2. **资产导入/apply 警示通配 allow**（缓解措施，成本低）。上一项最真实的触发路径不是作者粗心，而是**导入别人的资产夹带 allow-all**；仓库已有导入/分享链路，导入时零提示。在 `propose`/`apply` 解码 `config.permissions` 之后，若含通配 allow 或 `DANGEROUS_ACTIONS` allow，于 diff 预览与 apply 结果显式标注（**不阻断，只揭示**）。注意 `agent-asset.ts` 目前把 `config` 当字符串原样存，警示须在 `parseAgentAssetConfig` 解码后做。

### Phase E：Resolver/Snapshot 与运行依赖

**红**：只有 Profile 显式绑定 MCP 被解析；Plan 显示 requested/effective/denied + credential/health；start re-freeze；运行中定义变化不改 Snapshot；新 provider turn fingerprint mismatch 阻断；撤销后新调用失败。

**绿**：扩 composition version union；MCP tool catalog 进入 Snapshot audit facts；Runner materialize 时同时满足 Snapshot allowlist、registration fingerprint、Permission/grant。

> 事实校准（§0.1）：现有 union 只有 V1|V2，**没有 v1→v2 升级**，未知版本硬失败，消费方各自 `switch version`。新增 v3 意味着**每个这类站点都要加第三分支**——先评估是否能用 V2 内的可选字段承载，而不是急着开 v3。

> **Phase E 交付事实（2026-08-26，`mcp-composition`）**：评估结论是不新增 v3。`Composition.Plan.mcp` 与 `SnapshotDataV2.mcp` 使用可选/默认字段承载 MCP 投影和审计事实，旧 V1/V2 解码保持兼容，既有 `version` 分支无需扩展。`Plan` 的 `requested/effective/denied` 来自 Profile 的显式 `mcpBindings`、MCP 资产 revision 校验和唯一 `McpConnection.Service.facts()` owner 投影；Location 中存在但未绑定的 MCP 不进入 effective、cost catalog 或 Snapshot catalog。
>
> **连接边界是明确的**：`CompositionResolver.resolve/freeze` 只读取 `MCPAsset.Service` 与 `McpConnection.Service.facts()`，绝不调用 `connect()`。连接、transport、registration、health 和 credential admission 由唯一 MCP connection owner 完成；若产品未来需要 start 自动连接，必须另设显式 coordinator/admission 流程，而不是把副作用藏进 resolver。
>
> **Snapshot 只存审计身份**：`SnapshotMcpInfo` 记录 server、MCP ref/revision、opaque `credentialRef` 和实际注册的 canonical tool names；不记录 command、URL、headers、client、executor、PID、health 或 secret material。MCP asset 的 `configJson` 当前仍是 opaque body，只用于 asset existence/revision provenance，不能被当作已验证的 connection config 真源。
>
> **运行时观察者**：Session runner 在每个 custom provider turn 前复用 generic fingerprint/catalog guard，并额外校验 Snapshot MCP audit catalog、binding identity、ready health 与实际 canonical registration；任何 mismatch/revoked/not-ready 都在 provider dispatch 前抛 typed `SnapshotDriftError`。连接 owner 的 `requestOn` 在每次带 credentialRef 的 tool admission 前重新解析 Location-scoped binding；撤销保证后续调用失败并投影 `revoked`，不宣称中断已经在飞的调用。
>
> **Phase E 红证记录（2026-08-26 修正）**：原 catalog red proof 仍成立，但它只证明未绑定的 `mcp_unbound_admin` 不进 frozen catalog，**不能**证明 requested-but-unusable 的 denial branches。`2307df31f` 补齐三个独立 red proof：无 connection fact → `not_connected`、fact 非 ready → `not_ready`、同名/同 revision 但 credentialRef 不同 → `binding_mismatch`；每条无条件断言 denial reason 与 exact `effectiveToolCount`。同一修正还把 Snapshot loader 与 runner 的两套排序归并为 `Composition.mcpAuditMatchesCatalog`：合法的 `list-files` / `list_files` 名称在 default sort 与 `localeCompare` 下顺序不同，原 runner 会假阳性阻断 turn；helper 回退为默认 `.toSorted()` 时正常输入断言立即失败。其余红证保持：移除 runner `verifySnapshotMcp`、`requestOn` binding revalidation、或 Profile canonical decoder 均令各自 focused negative test 失败；恢复后通过。

### Phase F：HTTP/SDK/App 审批中心

**红**：auth/scope/CSRF等现有 HTTP 边界；pending 聚合；once/Session/Location 明示；revoke；无页面连接；Builder health/diagnostics；desktop/narrow/keyboard/i18n（en/zh/zht 三语）。

**绿**：薄 endpoints + SDK；应用级 pending indicator/dialog；Custom Builder/Session panel MCP health。入口不自动扩大 scope。

> 事实校准（§0.1，**2026-08-26 复核修正**）：初稿写「V2 的 pending/reply 端点与 `permission.v2.*` 事件都已存在并已挂载，缺的纯粹是客户端」——**其中 pending 端点这一半是错的**。复核结果：① **reply 存在但走 V1 类型路由**（`groups/session.ts:535` 的 `POST /session/:sessionID/permissions/:permissionID`，`permissionID` 声明为 `PermissionV1.ID`，handler `handlers/session.ts:922` 按 `shouldUseV2Runtime` 分叉到 `PermissionV2.reply`）；② **V2 pending 聚合端点不存在**——唯一的 list 是 `GET /permission`（`groups/permission.ts:20`），success 类型为 `Schema.Array(PermissionV1.Request)`，全仓 `rg PermissionV2 packages/aigcfroge/src` 仅 4 处命中且全在 reply 路径；③ `permission.v2.asked/replied` 事件确实存在（`core/src/permission.ts:79/81`）；④ 客户端消费确为字面零（app/tui/session-ui/ui/desktop 各 0 命中，app 仍走 V1 `permission.asked`，`app/src/context/permission.tsx:167`）。**所以本 Phase 的 L3 需要新写 V2 pending 端点，不是纯 L4 工作。** 三个必须处理的陷阱：① custom Session 的事件对没带 `product-mode-custom-v1` 能力头的连接会被 SSE 过滤（`core/src/product-mode-policy.ts:186-197`，挂载点 `handlers/event.ts:34/52`）；② app 侧的浏览器 auto-accept（`app/src/context/permission-auto-respond.ts`，三层键含 `base64(directory)/*` 通配 + `parentID` 血缘继承）不是服务端 grant，不能与 `ScopedGrant` 混为一谈；③ **`handlers/event.ts:44` 无条件 `bindResponder()` 而 `:52` 按能力头过滤事件——不带能力头的连接既被计为 responder、又收不到 custom 会话的 ask，于是每次 ask 等满 TTL 后 `AskExpiredError`。responder 判据必须对齐能力集。**

### Phase G：故障注入与灰度

- server crash、network partition、OAuth expiry、credential revoke、grant expiry、Session close、Location unload、name collision、tool schema change。
- 验证撤销后新调用立即失败；已开始调用按 ADR 明确结束/中断策略。
- 验证无页面连接时请求不会无限挂起（**2026-08-26 修正：这条挂起已由 Phase F0 修掉**——`core/src/permission.ts:310-323` 用 `timeoutOrElse(presence.ttlMs)` 包住 `Deferred.await` 并抛 `AskExpiredError`。所以 Phase G 的任务是**验证 TTL 边界成立**，不是再修一次挂起；报告不得把「验证既有控制」写成「修复了一个挂起」）。
- 验证 kill switch 关闭时 MCP 连接与 pending request 一并停止（§0.2 第 2 项）。

## 4. TDD/协议复查

每个 slice 走红->绿->重构，并在继续前执行 `CLAUDE.md` 改完即审。MCP/Tool slice 重读 `packages/core/src/tool/AGENTS.md` 与 Tool spec；credential/grant 重读 database/effect/security owner；UI 重读 DESIGN/frontend-theming；HTTP 重读 HttpApi/test server AGENTS。

安全测试必须成对覆盖“模型看到定义”和“settle 真执行”；只测 permission assert 或只测 UI 隐藏均不合格。

## 5. 最终测试矩阵

- Core：registration Scope/collision/stale/interruption；credential/health；grant transaction/expiry/revoke；Permission deny。
- AigcForge：stdio/remote/OAuth fixture、HTTP coverage/auth/effect、session recovery。
- Schema/SDK：version/negative/secret rejection、generated diff/typecheck。
- App：pending center、scope selection/revoke、Builder health、Playwright disconnected/unattended、responsive/a11y/i18n。
- 全局：包级 test/typecheck、protocol refs、lint/full typecheck、diff；不得从根跑 test。

## 6. 停止条件

- canonical Session/Location registration 或唯一 grant owner 未批准。
- 方案要求把 executor/client/secret 存入 Snapshot。
- Location/Session cleanup 只能依赖手工 Map 删除而无 owner Scope。
- `always` 被直接改名成 Session/Location grant。
- ask 在 unattended/headless 状态可能无限等待或默认 allow。
- 撤销、断线、schema drift、权限拒绝测试失败。

## 7. 分支策略

- 研究/ADR 走 `mcp-scope-adr`（Phase A，**已合入 main `7a2804624`**）；Phase B 走 `mcp-registration`（**已交付，复审整改完成，未推送**）。
- 剩余实现分支：**`mcp-connection`（Phase C；Slice 0-2 已交付并合入本地 `main`，当前 Slice 3-4）**、`mcp-composition`（Phase E，待 Phase C 交付连接实体）、`approval-center`（Phase F 本体，需产品定界面）。已合入：`approval-preflight`（Phase F0，`f66f93d8c` → `229e3eb7d`）。
- 按现行安排：M3 各阶段分支在本地依次叠加，**全部阶段结束后统一开一个 PR**，不逐阶段推送。不与 M4 Plugin 生命周期修改混在同一 PR。
- 执行细则、必读清单、TDD 循环与停止条件见 [执行提示词](prompt-custom-mode-m3-mcp-approval.md)。
