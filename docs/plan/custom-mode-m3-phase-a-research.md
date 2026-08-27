# Custom Mode M3 Phase A 调研报告

> **状态**：已完成（Phase A 交付物 #1；ADR-19/ADR-20 的代码事实基础）
> **日期**：2026-08-23
> **复核基线**：`main@1d5c51f6c`（相对计划分析基线 `a11b50020` 仅 docs 变更，`packages/` 零漂移）
> **分支**：`mcp-scope-adr`
> **方法**：M3 计划 §0 全部事实逐条独立复核到 file:line；四域（MCP 运行时 / ToolRegistry / Permission / Credential）全量取证；每条引用均在本分支实测，未转抄计划文本。

---

## 0. 复核结论摘要

1. **无漂移**：`git diff --stat a11b50020..HEAD -- packages/` 为空。M3 计划 §0 的全部 file:line 事实在开工基线上逐条成立，无需修正计划。
2. **三项新发现**（§5）：① §4.6 未登记矛盾证实为 P0 并已修复（`custom-child-turn@c0de66899`，合入前本报告按 main 现状引用）；② `switchAgent` 对任意 agent 字符串零校验（同一 hotfix 关闭）；③ task tool child 的 `attended` 默认即 `false`——所有现实 Custom child 都是 unattended。
3. **对 ADR 的总输入**：V1/V2 MCP 收敛裁决、registration fingerprint 新契约、ScopedGrant 独立 owner、ask 超时策略、deny-first 基线的 attended 缺口，见 §6。

---

## 1. MCP 运行时现状：产品今天不连接任何 MCP server

### 1.1 V2 MCP：接口存在，实现为零

| 事实                                                            | 位置                                                                         |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 公开接口只有 `start/stop/tools/callTool`，不注册 canonical Tool | `packages/core/src/mcp/mcp-v2.ts:13-22`                                      |
| 生产装配是 noop（`tools()` 恒返回 `[]`）                        | `mcp-v2.ts:27-35`，装配于 `packages/aigcfroge/src/effect/app-runtime.ts:195` |
| `McpV2.Service` 生产消费方为零                                  | 全仓 grep 仅 mcp-v2.ts 自身 + app-runtime noopLayer                          |

### 1.2 `v2-bridge.ts`：死代码，不可当参考现状

| 事实                                                                                                                               | 位置                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 全仓唯一引用是它自己的自导出行 `export * as McpV2Bridge from "./v2-bridge"`                                                        | `packages/aigcfroge/src/mcp/v2-bridge.ts:1`              |
| `cfg` 为字面 `any`（`servers Map<string, { client: any ... }>` 等），编译器抓不到键名错配                                          | 同文件 :33/:40/:55 区域                                  |
| OAuth 键 camelCase↔snake_case 错配已复核：bridge 读 `clientId/clientSecret/callbackPort/redirectUri`，config schema 是 snake_case | bridge ~`:70` vs `packages/core/src/config/mcp.ts:17-23` |

结论（与计划一致）：M3 Phase C 不是「重构现有 bridge」，是写第一个能跑的实现。bridge 只能作反面教材。

### 1.3 V1 MCP：唯一在服役的实现

| 事实                                                                                                                                                                  | 位置                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| V1 实现共 979 行；状态不是进程全局 Map，而是按 instance 目录键的 `InstanceState` ScopedCache                                                                          | `packages/aigcfroge/src/mcp/index.ts:477`；`effect/instance-state.ts:28-49`（含 disposer 注册） |
| 实际 scope 是 per-instance-directory：多 Session 共用一套 client 与 defs                                                                                              | 同上                                                                                            |
| 真进程全局只有两处：`pendingOAuthTransports`（Map，无清理 API）与 contributor 注册表（Set，只增不减）                                                                 | `index.ts:123`；`packages/core/src/mcp/contributor.ts:25`                                       |
| 无 reconnect、无 health 轮询：`reconnect\|healthcheck\|ping\(` 在两个 MCP 目录 0 命中；health 只有被动 `client.onclose`（删 client+defs、标 failed、发 ToolsChanged） | `index.ts:428-440`                                                                              |

### 1.4 Location-scoped MCP 资产子系统（在服役，M3 写入面加固起点）

| 事实                                                                                                                                            | 位置                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 资产子系统三件套在役：`mcp-asset.ts`(200 行) / `mcp-asset-service.ts`(399 行) / `mcp-asset/path.ts`                                             | `packages/core/src/`                                                                                                          |
| Location layer 接线四处                                                                                                                         | `location-layer.ts:119`（MCPAsset.locationLayer）、`:151`（MCPAssetService.locationLayer）、`:198`/`:249`（provide 与依赖表） |
| `ConfigJson` 是不解码的 opaque 串，仅 ≤100,000 UTF-8 字节过滤——解码期无结构校验，正是 M3 写入面不能复制「图不变量只在 freeze 期拒绝」错误的原因 | `packages/schema/src/mcp-asset.ts:34-40`                                                                                      |
| 候选转资产时 `env` 被丢弃：frontmatter 只写 kind/name/description/command/args/configJson                                                       | `mcp-asset-service.ts:230-237`（`\benv\b` 全文件 0 命中）                                                                     |

### 1.5 V1 HTTP 面（已在服役）

- 路径集 `/mcp`、`/mcp/:name/auth`、`/auth/callback`、`/auth/authenticate`、`/connect`、`/disconnect`：`...httpapi/groups/mcp.ts:32-39`。
- 无条件挂载于实例 server 图：`server/routes/instance/httpapi/server.ts:305`（`MCP.node`）。缺的是 revoke 类端点。

---

## 2. ToolRegistry 注册契约：机制齐备，缺身份契约

| #   | 事实                                                                                                                                                                                                                                                                                                   | 位置                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `register` 本来就是运行时动态：闭包内 `local` Map 在调用时 mutate（同名入栈，不抛错）                                                                                                                                                                                                                  | `packages/core/src/tool/registry.ts:149-169`（写入 `:157`）                                                                               |
| 2   | Scope 清理已有：finalizer 按 token 过滤，只移除自己的注册                                                                                                                                                                                                                                              | `registry.ts:158-166`                                                                                                                     |
| 3   | 冲突语义是 last-wins：settle 与 materialize 都取 `.at(-1)`，关掉赢家露出次新                                                                                                                                                                                                                           | `registry.ts:88`（settle）、`:177`（materialize）                                                                                         |
| 4   | ~~反面教材：`ApplicationTools.Service.register` 签名要求 `Scope.Scope` 却从不 `Effect.addFinalizer`~~ **Phase B 更正：断言有误**——清理由 `State.transform` 内建提供（调用方 Scope finalizer + 重放恢复，`state.ts:88-93`），scope 关闭移除自身注册并揭示前一赢家；Phase B 已以 overlay-reveal 测试钉死 | `application-tools.ts:47-50`（经 state.transform）+ `state.ts:88-93`                                                                      |
| 5   | fingerprint 在 registry 内 0 命中——它是 resolver/schema 的概念：freeze 用无参 `materialize()` 后对 definitions 计算 placement/name/digest/installationVersion 四字段 + catalogDigest                                                                                                                   | `rg fingerprint packages/core/src/tool/` = 0；`composition-resolver.ts:742-758`；schema 侧 `SnapshotToolInfo`（`composition.ts:221-232`） |
| 6   | 运行期每轮 provider turn 以 snapshot catalog 为 allowlist 重物化，并重验五类漂移（tool_missing / fingerprint_missing / fingerprint_mismatch / fingerprint_extra / catalog_digest_mismatch），fail-closed via `SessionRunner.SnapshotDriftError`                                                        | `session/runner/llm.ts:205-273`；allowlist 物化 `:541`/`:547`                                                                             |
| 7   | version union 只有 V1\|V2，未知版本硬失败；消费方各自 switch，v3 = 每站点加第三分支                                                                                                                                                                                                                    | `packages/schema/src/composition.ts:301-302`；`session/composition.ts:112-117`                                                            |
| 8   | 计划缺口原文仍成立：「MCP and future Session-scoped registrations still need an explicit canonical registration design」                                                                                                                                                                               | `packages/core/src/tool/AGENTS.md:58`                                                                                                     |

**含义**：Phase B 要建的是 identity/placement 契约（谁、在哪个 scope、以什么 fingerprint 注册），不是第二个注册机制。registration fingerprint 必须接入 llm.ts:205 已有的重验点，而不是新开检查。

---

## 3. Permission / Grant：决策函数与 `PermissionSaved` 语义

### 3.1 决策链（唯一 owner）

| #   | 事实                                                                                                                                     | 位置                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | 规则求值是 `findLast`：最后匹配胜出，无匹配 fallback `ask`                                                                               | `permission.ts:102-112`（findLast `:106`）；`effective.ts:27` 同构 |
| 2   | base 只来自全局 AgentV2 注册表 `agents.resolve(...).permissions`，**从不查 Snapshot**——名为 X 的注册表条目是否来自被绑定资产，无人验证   | `permission.ts:174-175`                                            |
| 3   | ask 是 agent-aware 的（AssertInput.agent 可选并传入 configured）；持久化的 saved 行不是                                                  | `permission.ts:57`、`:196-201` vs `saved.ts:17-23`                 |
| 4   | unattended clamp：头部 wildcard deny + 全部 ask→deny；**不动 allow**——尾部 allow 经 findLast 完好存活（hotfix 前的现状，即 §4.5-1 机制） | `effective.ts:86-93`                                               |
| 5   | custom 不是 elevated mode（elevated 仅 chat/work/assistant × meta × full）                                                               | `effective.ts:44-45`                                               |

### 3.2 `PermissionSaved`：只有 4 个字段的 Project 级 allow

| 事实                                                                                                         | 位置                                                    |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| Info 就 `{id, projectID, action, resource}`：无 expiry、无 revocation、无 per-agent/per-revision/per-session | `permission/saved.ts:17-23`                             |
| 表唯一键 `(project_id, action, resource)`，无任何 scope 列                                                   | `permission/sql.ts:11-19`                               |
| always 回复写库时 projectID 来自 Location                                                                    | `permission.ts:290`                                     |
| resource 来自工具自报的 save，可宽于被问资源：read 存 `*`——一次 `.env`「总是允许」落成项目级 `read *`        | `tool/read.ts:70-72`                                    |
| 一次 always 会顺带放行其它 Session 中现已满足的 pending；一次 reject 级联拒绝同 Session 全部 pending         | `permission.ts:299-320`；`:275-284`                     |
| 最接近的原语：break-glass 60 秒租约——Location-scoped Map、child/unattended 一律拒绝、非 durable              | `session-override.ts:14`（LEASE_MS）、`:58-63`（guard） |

**含义**：G3-2 所需的 action/resource/agent/revision/expiry/revocation 是 100% 绿地；扩 `PermissionSaved` 还是新增 ScopedGrant owner 由 ADR-20 裁决（计划默认建议：新 owner）。

### 3.3 ask 挂起与审批面

| 事实                                                                                                                                                                                                                            | 位置                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 「有人值守但无客户端」会永久挂起：assert 的 `Deferred.await` 无 timeout（permission 模块 Effect.timeout 0 命中），只能等 Location idle TTL 60 分钟驱逐时 finalizer 以 RejectedError 释放                                        | `permission.ts:247`；finalizer `:150-160`；`location-layer.ts` `idleTimeToLive: "60 minutes"`（`:267` 区域）                                                                                                                                                      |
| V2 pending/reply HTTP 面**已存在并已挂载**：GET `/api/permission/request`、GET+DELETE `/api/permission/saved[/:id]`、GET `/api/session/:id/permission`、POST `.../permission/:requestID/reply`（reply 带 run→session 归属校验） | group：`packages/server/src/groups/permission.ts`；handlers：`packages/server/src/handlers/permission.ts:16-59`（含归属校验 `:36-38`）；handlers 注册 `handlers.ts:16`；Api 挂载进实例 HttpApi（`httpapi/api.ts:42` import、AigcfrogeHttpApi `.addHttpApi(Api)`） |
| 客户端为零：`permission.v2` 在 app/tui/session-ui/ui 全部 0 命中；app 只处理 V1 `permission.asked/replied`                                                                                                                      | rg 0 结果；`app/src/context/global-sync/event-reducer.ts:387/:408`                                                                                                                                                                                                |
| 能力头陷阱：custom Session 的 `permission.v2.asked` 对未带 `x-aigcfroge-capabilities: product-mode-custom-v1` 的 SSE 连接被过滤                                                                                                 | `product-mode-policy.ts:183-198`（isEventPayloadSupported）；流过滤 `handlers/event.ts:33`/`:46`                                                                                                                                                                  |

---

## 4. Credential：明文 + 全局 + 多 owner

| #   | 事实                                                                                                                                                                                                                                        | 位置                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | 秘密明文存储：`value text({mode:"json"})`，写入逐字                                                                                                                                                                                         | `credential/sql.ts:9`；`credential.ts:113-127`                                              |
| 2   | create 先删该 integration 全部旧行再插入（单行语义）                                                                                                                                                                                        | `credential.ts:103-106`（事务 delete+insert）                                               |
| 3   | 表无任何 scope 列；唯一业务键是 integration_id——跨 Location 隔离没有既有机制                                                                                                                                                                | `credential/sql.ts:5-14`                                                                    |
| 4   | 库是单一进程全局 SQLite（按 channel 定路径），且 Credential layer 进了 LocationServiceMap dependencies → 跨 location memoize 共享                                                                                                           | `database/database.ts:43-61`；`location-layer.ts:273`                                       |
| 5   | 全仓无凭据加密：encrypt/cipheriv/aes-256/keytar/safeStorage 命中均为 provider `encrypted_content`（推理内容），与凭据无关                                                                                                                   | rg 复核                                                                                     |
| 6   | opaque ref 类型存在：`Connection.CredentialInfo = {type:"credential", id, label}`，经 `Integration.connection.resolve` 解析为明文 Value；但 Snapshot v2 无任何字段能装它（SnapshotToolInfo 只有 name/digest/placement/installationVersion） | `schema/connection.ts:6-11`；`integration.ts:185-187`；`composition.ts:221-232`/`:254-276`  |
| 7   | 第二秘密存储绕开 Credential service：provider key 走 `auth.json` 模块级 resolver seam；MCP OAuth token 走 `mcp-auth.json` 文件                                                                                                              | `session/runner/auth-seam.ts:19-30`；`mcp/auth.ts:37`、`mcp/v2-auth.ts:36`                  |
| 8   | `CredentialScanner` 生产调用点仅 1 个（M2 workflow handoff，先扫描后裁剪顺序）；durable session 事件的 text 字段均未脱敏                                                                                                                    | `workflow-runner.ts:205`/`:436`（扫描顺序 `:66-73`）；`session/event.ts:131/:142/:153/:189` |
| 9   | Plugin host 可直接拿到解析后的明文凭据（M4 边界，今天为真）                                                                                                                                                                                 | `plugin/host.ts:100-108`                                                                    |

---

## 5. Phase A 期间新发现

### 5.1 §4.6 P0 证实：非 meta custom child 在真实 provider turn 上是死路（已修复）

- 探针红测试（`packages/core/test/custom-child-provider-turn.test.ts`，随 hotfix 提交）在 main 上失败：child 创建成功（create 期 `resolveAgent` parent 分支绕过 enforcePrimary，`session.ts:334-342`；mode 继承 `:358`），但首轮 turn 死于 `Effect.die(AgentNotAllowedError)`（`checkPrimaryAgent("custom", …)` 只许 meta：`product-mode-agent-policy.ts:111-121`，die 于 `:65`；调用点 `runner/llm.ts:479`）。
- 影响链核实到行：child die → `background.wait` error outcome → `TaskDriver.DelegateError(reason:"error")` → workflow step 结算 `step_failed`（默认 abort → run failed）（`task-driver.ts:492-505`、`workflow-runner.ts:343-351`）。
- 门禁时间线：per-turn enforcePrimary 早于 Custom Mode（引入提交 `e0700c19f`，2026-07-23 chat-m1）；custom 分支与其同期落地（`a6e48ab6a`，2026-08-19）。**从未有 child 豁免**；无任何既有测试驱动过非 meta custom child 的真实 turn。
- **讽刺联动**：死路使 §4.5-1 尾部通配 allow 越权路径实际不可达（child 一个 token 都产不出）。修复 P0 必须同时落地 deny-first 天花板，二者已捆绑。

### 5.2 `switchAgent` 零校验（P0 安全复查中发现，同 hotfix 关闭）

修复前 `SessionV2.switchAgent` 对任意 agent 字符串直接发 durable 事件，无 allowlist/mode 校验（`session.ts` 原 :740-750）。此前被 P0「意外挡住」（custom 下换 agent 后下轮即死）；P0 解锁后即成活暴露面。hotfix 为 custom session 补 `assertAgentAllowed` 门禁 + HTTP 400 映射。

### 5.3 所有现实 Custom child 都是 unattended

`task` 工具 child：`attended: input.attended ?? subagent.attended ?? configAttendedDefault ?? false`（`tool/task.ts:452-455`）；workflow child 恒 false（`workflow-runner.ts:291` 区域）；scheduled child 恒 false（`scheduled-job-executor.ts:33-37`）。deny-first 天花板作用于 `!attended && mode==="custom"` 即覆盖全部现实委派路径。

### 5.4 hotfix 内容（`custom-child-turn@c0de66899`，待审合入）

| 改动                                                                                                                                                               | 文件                                       | 效果                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| root 门禁与 child 分离：`parentID !== undefined` 时只做默认解析不做 root 判定                                                                                      | `session/runner/llm.ts`                    | 非 meta custom child 可完成 provider turn（探针绿）                                                         |
| unattended custom deny-first 天花板：剥离通配/危险动作 allow（bash/edit/write/apply_patch/\*），保留读取类显式 allow；非 custom 维持 2026-08-02 scheduled-job 裁决 | `permission/effective.ts`                  | 资产自授权 `{*:*:allow}` 不再越过 clamp；同名碰撞变体（内置 build allow-all）在 unattended child 上同步失效 |
| `switchAgent` 补 Snapshot allowlist 门禁 + typed error + HTTP 映射                                                                                                 | `session.ts`、`server/handlers/session.ts` | post-create 换 agent 无法绕过 allowlist                                                                     |
| 测试：探针 2 例、permission-effective +4（含范围界定）、security +1                                                                                                | test/\*                                    | core 全量 2058 pass / 0 fail                                                                                |

---

## 6. G3 Gate 输入清单（ADR-19/ADR-20 必须显式回答）

| Gate              | 本报告给出的事实约束                                                                                                                                                                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G3-1 Registration | §1：V1 在役且有 HTTP 面，收敛/并存必须显式裁决；§2：机制齐备（动态 register/Scope 清理/last-wins），缺 identity/placement；fingerprint 是新概念，须接入 llm.ts:205 重验点；无 reconnect/health 机制可扩展（绿地）；`ApplicationTools` finalizer 缺口顺路修；kill-switch disable 通知须定义与 owner Scope 的关系（§4.5-2） |
| G3-2 Grant        | §3.2：PermissionSaved 4 字段、Project scope、resource 自报放大（read `*`）、级联语义——扩旧表还是新 owner 必须裁决；§3.1：base 只来自注册表、provenance 无人验证（deny-first 已挡 unattended 变体，attended 变体留待 grant 模型）；deny 是否恒胜出；grant 与 Snapshot audit digest 分离                                    |
| G3-3 Credential   | §4：明文/全局/多 owner/opaque ref 无处安放/Scanner 单点——「唯一 secret owner」「跨 Location 隔离」均为待建                                                                                                                                                                                                                |
| G3-4 Unattended   | §3.3：unattended 已 fail-closed 且经 hotfix 加固；真正要批的是「有人值守但无客户端」的 ask 超时策略（60 分钟驱逐是唯一兜底）；审批中心必须带能力头否则收不到 custom asked                                                                                                                                                 |

---

## 7. 引用与状态

- 执行提示词：`docs/plan/prompt-custom-mode-m3-mcp-approval.md`
- 计划：`docs/plan/custom-mode-m3-mcp-approval.md`（§0 事实全部维持有效）
- hotfix 分支：`custom-child-turn`（commit `c0de66899`，合入顺序须先于 M3 实现 Phase B-G）
