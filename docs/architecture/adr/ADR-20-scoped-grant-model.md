# ADR-20: Scoped Grant Model

> **状态**：**Accepted for M3 implementation v1.0，§2.6 除外**（2026-08-23 批准；用户授权 AI 代理代行五方技术审批）—— Phase D/E/F 阻塞解除，但 **§2.6 仍为 Proposed**：其事实基础 `custom-child-turn@c0de66899` 复审 **BLOCK**（见 §4 与 [M2 复审报告](../../review/AigcForge_CUSTOM_M2_REVIEW.md) §2.6/R6），未整改前不得按 §2.6 施工
> **日期**：2026-08-23
> **Gate**：G3-2（M3 计划 §1）；**已通过**（G3-4 的 ①③ 两项一并回答；② 待 §2.6 整改后闭环）
> **关联**：[ADR-17](ADR-17-custom-mode-composition-platform.md)、[ADR-18](ADR-18-custom-mode-workflow-execution.md)、[ADR-19](ADR-19-mcp-scoped-registration.md)、[M3 计划](../../plan/custom-mode-m3-mcp-approval.md)、[Phase A 调研报告](../../plan/custom-mode-m3-phase-a-research.md)
> **事实基础**：每条决策指向调研报告复核过的代码事实（`main@1d5c51f6c` + hotfix `custom-child-turn@c0de66899`）或显式标注为**新增契约**。

---

## 1. 背景

`PermissionSaved` 是 Project 级 allow 的唯一持久层，但只有 4 个字段（`saved.ts:17-23`：id/projectID/action/resource），无 expiry、无 revocation、无 per-agent/per-revision/per-session；表唯一键 `(project_id, action, resource)`（`permission/sql.ts:11-19`）。PRD §(219) 已定案：「现有 `always` 保存审批以 Project 为作用域，不能直接冒充未来的 once/Session/Location grant model」。G3-2 所需的完整维度是 **100% 绿地**。

同时存在两个已证实的缺口：

1. **尾部 allow 绕过 unattended clamp**（§4.5-1）：资产作者可控 ruleset 经全局 AgentV2 注册表直接成为 base（`permission.ts:174-175`），`evaluate` 用 `findLast`（`:106`），clamp 只重写 ask 不动 allow（hotfix 前的 `effective.ts:86-93`）——已由 `custom-child-turn@c0de66899` 为 unattended custom 落地 deny-first 天花板，attended custom 的同一缺口仍开放。
2. **「有人值守但无客户端」永久挂起**：`assert` 的 `Deferred.await` 无 timeout（`permission.ts:247`），只能等 Location idle TTL 60 分钟驱逐时被 finalizer 以 `RejectedError` 释放（`:150-160`）。unattended 本身已 fail-closed（ask→deny），不是缺口。

最接近的现成原语是 break-glass 60 秒租约（Location-scoped Map、child/unattended 拒绝、非 durable，`session-override.ts:14/:58-63`）；最接近的 durable owner 模式是 M2 的 `WorkflowRun`（唯一 CAS 写入者 + `EventV2.publish(..., { commit })` 同事务，ADR-18 §2.2）。

---

## 2. 决策

### 2.1 新增独立 `ScopedGrant` owner，不扩展 `PermissionSaved`

采纳计划默认建议：grant 真源是新的 `ScopedGrantStore` Service，`PermissionSaved` 保持既有 Project 语义原样（**不改名、不迁义、不新增列**——停止条件红线）。二者并存且互不读写：

| | PermissionSaved（不动） | ScopedGrant（新） |
|---|---|---|
| 作用域 | Project | once / Session / Location |
| 维度 | action+resource | action/resource/agent/revision/expiry/revocation |
| 生命周期 | 手动删除才消失 | 消费/过期/撤销即失效 |
| 消费方 | `PermissionEffective.compute` 的 savedApprovals 输入 | `PermissionEffective.compute` 新增 grants 输入 |

### 2.2 Deny 恒胜出；grants 只存 allow

- Grant 记录的 effect 被 Schema 钉死为 `"allow"`（`ScopedGrant.effect: Literal("allow")`，mcp-scope.ts 已落地）——deny 是 policy rulesets 的领地，grant 永远不能表达拒绝。
- 咨询顺序固定：`configured → effectiveV2 → evaluate` 先行；evaluate 结果为 `deny` 直接拒（不查 grants）；为 `allow` 直接放行（无需 grants）；仅结果为 **`ask`** 时按 `(action, resource, scope, agent?, revision?)` 查询候选 grant——命中即免 ask，未命中保持 ask 流程。
- leaf `permission.assert` 仍是最终授权边界（ADR-17 Security §4 既有裁决不变）：grant 命中只是把一次 ask 折叠为 allow 的用户授权凭证，执行路径与权限判定代码不变。

### 2.3 Scope 语义与唯一真源（Schema 已钉形状）

```text
scope ::= { level: "once" }
        | { level: "session", sessionID }
        | { level: "location" }
```

| 维度 | 语义 |
|---|---|
| once | CAS 单次消费：并发消费单赢者（照抄 workflow step revision CAS），消费即终态 |
| session | 绑定签发时的 `sessionID`；其他 Session（含同 root 的兄弟 child）不可见 |
| location | 绑定签发 Location；跨 Location 查询天然 miss（store 按 Location 层装配） |
| agent? | 收窄到单 agent；不匹配即不可用 |
| revision? | 收窄到 Snapshot revision；组合升级/fork 后旧 grant 不随行（ADR-17 §10 升级语义一致） |
| expiry / revocation | 每次咨询实时读 store，无缓存副本——过期与撤销立即生效 |

### 2.4 Store：照抄 WorkflowRun durable owner 模式

SQLite 新表 `scoped_grant`（列含 snake_case 全维度 + revision + issued_at/expires_at/revoked_at/consumed_at），**唯一 CAS 写入者** `ScopedGrantStore.Service`；状态变更写入 `EventV2.publish(..., { commit })` 的 commit 回调、与事件行同事务；revision 不匹配抛 typed error；0 行更新必须抛错。durable 事件族 `grant.updated`（按 grantID 聚合，durable version 1），客户端视为失效通知、以读取为准（ADR-18 §2.7.2 同构）。**不发明第二套一致性方案**。

### 2.5 Grant 与 Snapshot audit digest 分离

Snapshot 冻结的权限摘要（ADR-17 §2.4「有效权限摘要 digest」）只是 **freeze 时点的审计投影**；运行时授权只看 grant store 实时状态 + leaf assert。二者永不互为真源：grant 变更不改 Snapshot（bytes/digest 写入后不可 update 的不变量不动），Snapshot 重放也不重建 grants。

### 2.6 尾部 allow 缺口的收口路径（§4.5-1；R6-1/R6-2 整改后 v1.1）

> **状态**：unattended 部分已按本节整改落地（分支 `custom-child-turn`，提交 `a508eca43`），**待 Security 复审确认白名单成员后本节转 Accepted**；attended 扩展仍为提案。

- **unattended custom：只读白名单制（R6-2 整改，取代原黑名单表述）**。天花板不再「排除危险四项、其余放行」，改为**只有显式只读类 allow 可为无人值守扇出预授权，未收录 action（含未来新工具）一律默认 deny**。白名单成员逐一取自 `packages/core/src/tool/builtins.ts` 注册清单：

  ```text
  READONLY_CEILING_ACTIONS = glob | grep | list_assets | read
  ```

  刻意排除的代表性注册（同一清单可查）：`task_spawn`/`task`（扇出放大）、`webfetch`/`websearch`（外发通道）、`bash`/`edit`/`write`/`apply_patch`（执行/写）、`taskschedule`（延时扇出）、7 个 `propose_*_asset` 与 memory/note（资产与持久态写入）、`skill`/`kb_search`（内容注入，非纯只读——是否纳入由 Security 复审裁定）。
- **显式非通配 deny 的位序保证（R6-1 整改）**。base 的资源级 deny（如 `{read,.env,deny}`）必须保留，且在结果集中排在白名单 allow **之后**——`evaluate` 是 `findLast`，位序即语义；custom 在显式 deny 上不得弱于其它模式。实现顺序：头部 fallback deny → ask→deny 重写 → 白名单 allow → 显式非通配 deny。
- **非 custom 模式不回退**：2026-08-02 scheduled-job 裁决（显式 allow 不被 unattended clamp 改写）维持不变，并以 custom/coding 配对断言防再分叉。
- **attended custom（提案维持，随 Phase D 裁决）**：资产来源的通配/执行类 allow 天花板扩展到全量 `mode === "custom"`（用户在场 ≠ 用户同意）。用户显式 saved approval 不受天花板影响；实现须区分 base 来源与 saved 追加来源，并同步修订 `permission-effective.test.ts` 的范围界定用例。
- **provenance 校验（新增契约，随 Phase D 落地）**：grant 咨询与 base 解析前置校验「注册表名为 X 的条目来自被绑定资产的 relativePath+revision」，不一致 fail closed——堵同名碰撞变体在 attended 路径的残留暴露。

### 2.7 Ask 超时策略（回答 G3-4 ①）

- unattended：维持现状即时 deny（已 fail-closed），不引入等待。
- **attended 但无客户端连接**（新增契约，提案默认值待产品确认）：pending request 携带 `expiresAt = created + ASK_TTL_MS`，默认 **300,000ms（5 分钟）**；到期由 permission owner 以 typed `AskExpiredError` 自动拒绝并发布 replied 事件（reply 语义 = reject），客户端可见「已超时」。TTL 经 config 可调但必须 > 0 且 ≤ Location idle TTL（60 分钟）——保证永不出现「只能靠驱逐兜底」的挂起。

### 2.8 审批中心边界（回答 G3-4 ③，Phase F 约束）

应用级入口只聚合 pending request 展示与回复（V2 端点 `packages/server/src/groups/permission.ts` 与 `permission.v2.*` 事件均已存在并挂载，缺的是客户端消费）；入口**必须带** `x-aigcfroge-capabilities: product-mode-custom-v1` 能力头否则 SSE 过滤掉 custom 会话请求（`product-mode-policy.ts:183-198`）；入口产生的任何授权都落成显式 once/Session/Location grant 并明示 scope，**不存在应用级永久 allow**。浏览器侧既有的 auto-accept 存储不是服务端 grant，禁止混入本模型。

---

## 3. 架构影响与五层映射

| 层级 | 变更 |
|---|---|
| L1 Schema | `McpScope.GrantScope` / `ScopedGrant`（已落地，17 例负向/正向用例）；pending request 增加 expiresAt 字段契约 |
| L2 Core/DB | `scoped_grant` 表 + `ScopedGrantStore` 唯一 CAS 写入者；`PermissionEffective` grants 注入点；attended 天花板扩展（若 §2.6 批准）；ask TTL |
| L3 HTTP/SDK | pending/reply/grant/revoke 薄端点复用既有 V2 组扩展；SDK 重新生成 |
| L4 App | 审批中心（聚合/明示 scope/revoke）、能力头接入（Phase F） |
| L5 Security | deny 恒胜出、leaf assert 不动、provenance 校验、跨 Session/Location 隔离矩阵、审计投影分离 |

## 4. 审批与授权记录

审批日期 2026-08-23，`main@1d5c51f6c`。审批方独立复核了 `PermissionSaved` 四字段、`permission.ts:106` 的 `findLast`、`:247` 无 timeout、V2 pending/reply 端点已挂载而客户端零消费、`product-mode-policy.ts` 能力头过滤，并**实跑了 §2.6 所依赖 hotfix 的 `compute` 纯函数**（结果见下）。

| 评审方 | 结论 | 备注 |
|---|---|---|
| Product | **Approved** | §2.7 TTL 默认 300,000ms 采纳（须 > 0 且 ≤ Location idle TTL 60 分钟，config 可调）。§2.6 的产品确认**暂缓**，见 R6-1/R6-2 |
| Core | **Approved** | §2.4 照抄 `WorkflowRun` durable owner + CAS + 同事务事件，不发明第二套一致性方案。§2.2 咨询顺序接入点定在 `PermissionEffective.compute` 的新增 grants 输入，leaf assert 不动 |
| Security | **Approved except §2.6** | §2.2 deny 恒胜出 + grant 只存 allow（Schema 钉死 `Literal("allow")`）是正确的单向性。§2.8 能力头与「不存在应用级永久 allow」通过。**§2.6 不予批准**：其声称已落地的 unattended 天花板经实测有 2 项缺陷，见下 |
| App | **Approved** | §2.8 入口必须带 `product-mode-custom-v1` 能力头，否则 SSE 过滤掉 custom 请求 |
| Schema+SDK | **Approved** | `mcp-scope.ts` 作为 grant/pending 编码真源，17 例用例实跑通过 |

### §2.6 不予批准的理由（对 `custom-child-turn@c0de66899` 的复审）

该 hotfix **未合入 main**，且其 deny-first 天花板经实测存在 2 项缺陷。审批方把 hotfix 的 `effective.ts` 抽出为纯函数探针实跑（探针已删除），base 取
`[{read,*,allow}, {read,.env,deny}, {task_spawn,*,allow}, {webfetch,*,allow}, {bash,*,allow}, {*,*,allow}]`，`mode=custom, attended=false`：

```text
custom unattended:  read src/x.ts -> allow   read .env -> allow   bash ls -> deny
                    task_spawn * -> allow    webfetch  -> allow
coding unattended（同一 base）: read .env -> deny
```

- **R6-1（P0，加固补丁自身引入的回归）**：custom 分支用 `rules.flatMap(rule => rule.effect === "ask" ? [deny] : [])` 重建规则，**把 base 的显式非通配 `deny` 全部丢弃**（第 84 行刚 push 进去的那批），而 `ceilingAllows` 被追加在尾部；`evaluate` 是 `findLast`，于是 `{read,*,allow}` 压过被丢弃的 `{read,.env,deny}` → **`.env` 在 custom unattended 下可读，而同一 base 在 coding 下正确 deny**。即：一个为收紧 custom 而写的补丁，使 custom 在显式 deny 上**弱于其它所有模式**。修法：显式非通配 deny 必须保留并排在 `ceilingAllows` 之后。
- **R6-2（P1，天花板是黑名单而非白名单）**：`ceilingAllows` 的过滤条件是「action !== "*" 且不在 `DANGEROUS_ACTIONS`（仅 bash/edit/write/apply_patch 四个）」。因此资产作者仍可为 unattended 预授权 `task_spawn`（**继续派生 child，正是天花板要抑制的扇出放大原语**）与 `webfetch`（外发通道），实测均为 `allow`。这与 §2.6 自述目的「不得为 unattended 扇出预授权执行能力」直接冲突。修法：改为只保留只读类 action 的**白名单**，新增工具默认落进 deny。
- **R6-3（P1，豁免范围宽于缺陷）**：hotfix 的 `llm.ts` 以 `session.parentID !== undefined` 对**所有模式的所有 child** 跳过 `checkPrimaryAgent`，但 commit 与 §2.6 的理由是 custom 专属机制 `assertAgentAllowed`（hotfix 自己的 `session.ts` 改动即证明该门禁只在 `mode === "custom"` 生效）。`product-mode-agent-policy.ts` 无任何 delegation 专用门禁（`checkDelegation`/`checkSubagent` 0 命中），因此非 custom 的 child 在豁免后**每轮 mode×agent 门禁全空**。方向本身可辩（`checkPrimaryAgent` 文档自述是 root/primary 不变量），但要么收窄到 `mode === "custom"`，要么举证非 custom child 的替代门禁。

> §2.6 之外的全部决策已批准，Phase D/E/F 可开工；触及 unattended 天花板的 slice 必须等 R6-1/R6-2/R6-3 整改并复审后再动。
