# Custom Mode M3 实施计划：MCP 与统一审批

> 状态：**待开工 — G3-0 已随 M2 满足；G3-1 Registration ADR 与 G3-2 Grant ADR 尚未起草，只能先执行 Phase A（研究 + ADR + Schema 契约）**
> 执行提示词：[Custom Mode M3 全量 TDD 执行提示词](prompt-custom-mode-m3-mcp-approval.md)
> 分析基线：`main@a11b50020`（2026-08-22，M2 = PR #46 合入后；本地/远端已同步）；执行基线为开工时最新 `main`
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
- 反例警示：`ApplicationTools` 要求 `Scope` 却**根本没装 finalizer**（`application-tools.ts:42-50`）。
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

| Gate                  | 通过标准                                                                                         | 状态 | 阻塞范围    |
| --------------------- | ------------------------------------------------------------------------------------------------ | --- | ----------- |
| G3-0 前置             | M1 Tool allowlist/fingerprint/Permission 运行稳定；M2 已上线，Agent scope 已可表达            | **已满足**（M2 = PR #46 / `a11b50020`，复审 APPROVED） | 全部        |
| G3-1 Registration ADR | Session/Location registration、owner Scope、name collision、fingerprint、cleanup、reconnect 批准 | **未起草 —— 阻塞 Phase B/C/E** | MCP runtime |
| G3-2 Grant ADR        | once/Session/Location + action/resource/agent/revision/expiry/revocation 的唯一真源批准，且回答 §0.2 第 1 项 | **未起草 —— 阻塞 Phase D/E/F** | 审批/执行    |
| G3-3 Credential       | secret owner、opaque ref、rotation/revocation、日志脱敏和跨 Location 隔离批准。**注意起点比旧计划记的差**：秘密明文存储、凭据全局无 scope 列、存在第二个绕开 Credential service 的存储（`auth.json`/`mcp-auth.json`）、Snapshot 无字段可装 ref、`CredentialScanner` 只有 1 个生产调用点。「唯一 secret owner」与「跨 Location 隔离」都是**待建**而非待批准 | 未批准 | 连接        |
| G3-4 Unattended       | **表述已按事实修正**：unattended **已经** fail-closed（`ask`→`deny`）。本 Gate 真正要批的是 ① 「有人值守但无客户端」的 ask 超时策略（今天无 timeout，永久挂到 Location 60 分钟驱逐）② §0.2 第 1 项的尾部 allow 绕过 clamp 该如何堵 ③ 审批中心必须带 `product-mode-custom-v1` 能力头否则收不到 custom 的 `permission.v2.asked` | 未批准 | Beta        |

**当前唯一可开工阶段是 Phase A**（研究 + 起草 ADR + Schema 契约），分支 `mcp-scope-adr`。Phase A 结束后停机等待 ADR 裁决；不得自行接受自己起草的 ADR 然后继续。

应用级审批入口只聚合 pending request；它不成为“应用级永久 allow”。

## 2. 五层设计

| 层              | M3 交付                                                                   | 不变量                              |
| --------------- | ------------------------------------------------------------------------- | ----------------------------------- |
| L1 Schema       | MCP binding/ref/health/fingerprint、ScopedGrant、pending request          | scope/version/expires/revoked typed；**解码期就有上界与结构校验**，不留 opaque 串 |
| L2 Core/DB      | MCPConnection owner、ScopedGrant owner、registration lifecycle            | secret 不进 Snapshot/event/log；owner Scope 负责清理，**无模块级可变单元** |
| L3 HTTP/SDK     | connect/status/**revoke**、pending/reply/grant/revoke APIs（**pending/reply 的 V2 面已存在，见 §0.1**） | auth + scope checks                 |
| L4 App          | Builder MCP blocks、health、全局 pending center（**这是真正缺的一层：V2 事件与端点都有了，客户端 0 消费**） | 入口全局可见，grant 明确显示 scope；**必须带 `product-mode-custom-v1` 能力头** |
| L5 Tool/runtime | canonical registration、captured settle、runtime permission/grant recheck | Location A 永不泄露到 B             |

## 3. 分阶段实施

### Phase A：Registration/Grant ADR 与 Schema

**红**：scope grammar、Location/Session/Agent/revision identity、expiry/revocation、MCP server/tool fingerprint、name collision、credential ref secret rejection、old Snapshot version compatibility；**外加 §0.3 的 `enforcePrimary` 矛盾——驱动一个非 meta 的 custom child 跑一轮真实 provider turn，确认是否 `Effect.die`**。

**绿**：接受两个 ADR；定义 MCP binding、health state、ScopedGrant/pending request、event/error schemas；决定扩 `PermissionSaved` 还是新增唯一 `ScopedGrant` owner。默认建议新增 scoped owner 并让 PermissionEffective 消费，避免破坏 `always` 兼容语义——**注意 saved 行今天只有 4 个字段，expiry/revocation/agent/revision 全是绿地（§0.1）**。

**重构**：authorization fact 与 connection health 分离；Snapshot audit digest 与实时 grant 分离。

### Phase B：Canonical scoped registration

**红**：Location/Session register/unregister；latest active placement规则；Scope close 只移除自己的工具；同名 collision；definitions/settle捕获一致；reconnect revision变化产生 fingerprint drift；A/B Location 隔离。

**绿**：给 MCP producer 注入窄 `Tools.Service` capability；每个 server/Session 拥有 Scope；把工具转换为 canonical `Tool.make`，settle 回到 MCP client且保留 interruption/ToolFailure。

**重构**：不增加 MCP registry/executor；ToolRegistry 仍是唯一执行入口。先解决 Location-layer ordering，不能形成 `PluginBoot -> Tools -> PluginBoot` 循环。

> 事实校准（§0.1）：`register` 已是运行时动态且有 Scope 清理，冲突已是入栈 last-wins，所以本 Phase 要建的是 **identity/placement 契约**而非注册机制。**registration fingerprint 是新概念**（fingerprint 今天只在 resolver/schema，registry 内 0 命中）。今天**没有 reconnect 也没有 health 轮询**，「reconnect 产生 drift」没有可扩展的既有机制。顺路修 `ApplicationTools` 要求 `Scope` 却无 finalizer 的缺口。

### Phase C：Connection、credential 与 health

**红**：stdio/remote/OAuth connect、invalid URL/command/config、credential missing/expired/revoked、disconnect/reconnect、timeout、process interruption、secret redaction、跨 Location ref拒绝。

**绿**：**写第一个能跑的 typed MCPConnection owner**——`v2-bridge.ts` 是零消费方的死代码（§0.1），可以当参考但不要假设它「在服役」；同时决定 V1 `mcp/index.ts`（979 行、按 instance 目录 scope、已有 HTTP 面）是收敛进来还是并存。凭证只经 Credential/Integration service 解析；health=`connecting|ready|degraded|offline|auth-required|revoked`；Snapshot 只存 ref/fingerprint（**该字段在 Snapshot v2 里还不存在，是新 schema**）。

**重构**：移除新增路径里的宽 `any`/raw console（`v2-bridge.ts` 的 `cfg: any` 掩盖了两处真实的键名不匹配，见 §0.1）；expected failures 用 tagged errors，外部 SDK callback 经 Effect 边界兜底。**`CredentialScanner` 今天只有 1 个生产调用点，secret redaction 不能当既有层倚靠。**

### Phase D：ScopedGrant 与 PermissionEffective

**红**：once 消费一次；Session 不跨 Session；Location 不跨 Location；agent/revision mismatch；expiry/revocation立即生效；deny 始终胜出；saved `always` 不被静默迁义；unattended ask fail closed。

**绿**：实现唯一 grant store/service和事务；PermissionEffective 查询候选 grant但仍由 leaf assert最终授权；pending request/reply/revoke事件持久或可回放语义按 ADR 落地。

**重构**：审批 UI、Resolver、ToolRegistry 不计算授权；统一走 Permission owner。

### Phase E：Resolver/Snapshot 与运行依赖

**红**：只有 Profile 显式绑定 MCP 被解析；Plan 显示 requested/effective/denied + credential/health；start re-freeze；运行中定义变化不改 Snapshot；新 provider turn fingerprint mismatch 阻断；撤销后新调用失败。

**绿**：扩 composition version union；MCP tool catalog 进入 Snapshot audit facts；Runner materialize 时同时满足 Snapshot allowlist、registration fingerprint、Permission/grant。

> 事实校准（§0.1）：现有 union 只有 V1|V2，**没有 v1→v2 升级**，未知版本硬失败，消费方各自 `switch version`。新增 v3 意味着**每个这类站点都要加第三分支**——先评估是否能用 V2 内的可选字段承载，而不是急着开 v3。

### Phase F：HTTP/SDK/App 审批中心

**红**：auth/scope/CSRF等现有 HTTP 边界；pending 聚合；once/Session/Location 明示；revoke；无页面连接；Builder health/diagnostics；desktop/narrow/keyboard/i18n（en/zh/zht 三语）。

**绿**：薄 endpoints + SDK；应用级 pending indicator/dialog；Custom Builder/Session panel MCP health。入口不自动扩大 scope。

> 事实校准（§0.1）：**V2 的 pending/reply 端点与 `permission.v2.*` 事件都已存在并已挂载，缺的纯粹是客户端**（app/tui/session-ui/ui 对 `permission.v2` 零消费，app 仍走 V1 的 `permission.asked/replied` 与 V1 bootstrap 端点）。所以本 Phase 的重心是 L4 与「V1/V2 双轨如何收敛」，不是再造一套端点。**两个必须处理的陷阱**：① custom Session 的 `permission.v2.asked` 对没带 `product-mode-custom-v1` 能力头的连接会被 SSE 过滤掉；② app 侧已有一个**纯浏览器**的 auto-accept 存储（按 `base64(directory)/sessionID` 持久化、带会话血缘继承），它不是服务端 grant，不能与 ScopedGrant 混为一谈。

### Phase G：故障注入与灰度

- server crash、network partition、OAuth expiry、credential revoke、grant expiry、Session close、Location unload、name collision、tool schema change。
- 验证撤销后新调用立即失败；已开始调用按 ADR 明确结束/中断策略。
- 验证无页面连接时请求不会无限挂起（**这是今天真实存在的挂起，不是假想**：`Deferred.await` 无 timeout，只能等 Location 60 分钟 idle 驱逐）。
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

- 研究/ADR 走 `mcp-scope-adr`（**当前可开工**）；生产实现必须等 G3-1/G3-2 批准。
- 推荐实现分支：`mcp-registration`、`scoped-grants`、`mcp-composition`、`approval-center`。
- 每个 PR 合入后从最新 main 开下一分支，不与 M4 Plugin 生命周期修改混在同一 PR。
- 执行细则、必读清单、TDD 循环与停止条件见 [执行提示词](prompt-custom-mode-m3-mcp-approval.md)。
