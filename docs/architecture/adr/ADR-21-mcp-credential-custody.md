# ADR-21: MCP Credential Custody

> **状态**：**Accepted for M3 Phase C implementation v1.2**（2026-08-24 起草；2026-08-24 人类裁定 §2.5，G3-3 通过；**2026-08-24 Slice 0 独立事实复核完成并经复审方复跑确认，据其结论修订为 v1.1**；**2026-08-25 Slice 2 复核发现撤销后同 key 不可 rebind，据裁定修订为 v1.2**）—— Phase C 阻塞解除，前置条件**已履行**。
> **v1.2 修订（2026-08-25，Slice 2 发现，人类裁定）**：§2.2 的 `unique(directory, workspace_id, server_name)` 无 `WHERE revoked_at IS NULL` 谓词，撤销行永久占键位，使 §2.3 要求的「typed fail + rebinding」终态不可达。裁定采**原地状态迁移**（`rebind`）而非偏索引，见 §2.2 关键补注与 §2.3 rebind 条。**这一处同样不是起草方发现的，是执行方交付后由复审方红证复跑抓出的。**
> **Slice 0 结论（2026-08-24）**：§1.1 八条事实 **8/8 全部成立，无一被证伪**；§1.2 三个结论均被事实支撑；§2.2「必须新增 `mcp_credential_binding`」经逐候选否决后**保留**（`credential` 加列违反 §2.1、`scoped_grant` 授权语义≠配置绑定语义、`IntegrationConnection` 是 12 行类型转发垫片且不落库、`workspace` 语义不符；全仓 `CREATE TABLE.*integration|mcp` 零命中）。复核另发现三处 ADR 自身缺陷，已在本 v1.1 修订：§2.2 的 DDL 唯一性缺陷、§2.3 的轮换透明性过度声明、§2.5 止血 1 的覆盖不足。**起草方不自批的补偿控制已生效并确实抓出了缺陷——这三处都是起草方（复审方）自己没看见的。**
> **日期**：2026-08-24
> **Gate**：G3-3（M3 计划 §1）；**已通过**。裁定内容 = §2.5：静态加密**不在 M3 范围**，M3 只做两项止血（DB 文件 chmod `0o600`、`McpServerBinding` 解码期拒绝秘密字面量）；加密另立专项，已登记 [technical-debt](../../technical-debt.md) §3.2。
> **关联**：[ADR-17](ADR-17-custom-mode-composition-platform.md)、[ADR-19](ADR-19-mcp-scoped-registration.md)、[ADR-20](ADR-20-scoped-grant-model.md)、[M3 计划](../../plan/custom-mode-m3-mcp-approval.md)、[Phase A 调研报告](../../plan/custom-mode-m3-phase-a-research.md)
> **事实基础**：每条决策指向 `main@178987459` 复核过的代码事实（file:line）或显式标注为**新增契约**。起草时逐项实读了 `credential.ts`、`credential/sql.ts`、`schema/src/credential.ts`、`mcp/v2-auth.ts`、`auth/index.ts`、`credential-scanner.ts`、`schema/src/mcp-scope.ts`、`schema/src/composition.ts`、`location-layer.ts`。事实 7 已于 2026-08-24 由执行方复核修正（生产 `scan()` 取用点 1 个 + Layer 装配点 2 个），修正经复审方独立复跑确认。

---

## 1. 背景

G3-3 与 G3-1/G3-2 性质不同：**它不是「待批准」，是「待建」**。M3 计划 §1 已写明这一点，本节把四项绿地钉到 file:line。

### 1.1 起点事实（逐条复核）

| #   | 事实                                                                                                                                                                                                                                                                                                                                                                                                                                      | 证据                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | **秘密以明文 JSON 存在 SQLite 里。** `credential.value` 是 `text({ mode: "json" })`，`Credential.Value = OAuth \| Key` 直接含 `refresh` / `access` / `key` 明文字符串，无加密、无信封、无 KMS                                                                                                                                                                                                                                             | `credential/sql.ts:9`、`schema/src/credential.ts:15-33`                                                                     |
| 2   | **凭据表无任何 scope 列。** 列只有 `id / integration_id / label / value / connector_id / method_id / active` + Timestamps。**没有 location / session / agent / revision**，也没有 expiry / revocation（OAuth 的 `expires` 在 value 里，是 token 自身有效期，不是授权作用域）                                                                                                                                                              | `credential/sql.ts:5-14`                                                                                                    |
| 3   | **`Credential` 是进程级全局单例，不是 Location-scoped。** 它位于 `LocationServiceMap` 的 `dependencies`，与 `Database` / `ApplicationTools` 同位 —— 即任意 Location 看到同一张表、同一批凭据                                                                                                                                                                                                                                              | `location-layer.ts:274`                                                                                                     |
| 4   | **存在两个绕开 `Credential.Service` 的文件存储。** `auth.json`（provider API keys，`auth/index.ts:10`）与 `mcp-auth.json`（MCP OAuth token / clientInfo / codeVerifier / oauthState，`mcp/v2-auth.ts:36`）。两者**都是明文 JSON**，但**都以 `0o600` 落盘**（`auth/index.ts:79`、`mcp/v2-auth.ts:81`），而 SQLite 库文件**无任何 chmod**（`global.ts:36-42` 只 mkdir，`database.ts:44-54` 只算路径）。**即：今天文件存储比数据库存储更严** |
| 5   | **Snapshot 没有任何字段能装 credential ref。** `schema/src/composition.ts` 内 `credential` 0 命中                                                                                                                                                                                                                                                                                                                                         | `rg credential packages/schema/src/composition.ts` = 0                                                                      |
| 6   | **Phase A 已定义 `McpScope.CredentialRef` 契约，但零消费方。** `Schema.String` + `isStartsWith("cred_")` + 长度上界 + brand，且 `McpServerBinding.credentialRef` 为 optional                                                                                                                                                                                                                                                              | `schema/src/mcp-scope.ts:51-56`、`:89`                                                                                      |
| 7   | **`CredentialScanner` 有 1 个生产 Service 取用点，另有 2 处 Layer 提供/装配点。** 唯一生产取用点是 `workflow/workflow-runner.ts:205`；`location-layer.ts:178` 与 `workflow/workflow-runner.ts:763` 只提供或装配 `CredentialScanner` Layer，不是调用点。它是**正则文本扫描器**（api_key / bearer_token / private_key / env_line 四类），仅作为**输出侧脱敏兜底**，不是密钥管理层                                                           | `credential-scanner.ts:9-30`、`workflow/workflow-runner.ts:205`、`location-layer.ts:178`、`workflow/workflow-runner.ts:763` |
| 8   | **`credential.active` 列在 V2 服务里零引用。** `credential.ts` 内 `active` 0 命中；该列与 `credential_connector_active_idx` 唯一索引来自 V1 时代迁移                                                                                                                                                                                                                                                                                      | `credential.ts`（0 命中）、`migration/20260611035744_credential.ts:21`                                                      |

### 1.2 由这些事实决定的三个结论

1. **「唯一 secret owner」今天不成立，且不能靠 M3 一次性收敛。** 三个存储（DB / `auth.json` / `mcp-auth.json`）各有在役消费方，其中 `mcp-auth.json` 正是 V1 MCP OAuth 的活数据。ADR-19 §2.1 已裁定 V1 MCP 与 canonical 并存、迁移归 M4；**凭据收敛必须服从同一裁定**，否则 M3 会被拖进 V1 全量消费方迁移。
2. **「跨 Location 隔离」今天结构上不可能。** 事实 3：`Credential` 是进程级单例。这不是疏漏，是既有设计——provider API key 本就是用户级而非项目级资源。**所以 M3 不该去改 `Credential` 的作用域，而应在 MCP 侧引入一个 Location-scoped 的绑定层。**
3. **加密不是 M3 该开的战场。** 事实 4 揭示了一个反直觉状况：DB 里的秘密比文件里的更暴露（无 chmod）。真正的「静态加密」需要密钥管理（用户口令 / OS keychain / KMS 三条路各有产品与跨平台代价），是独立专项。M3 能做且必须做的是**收窄暴露面与止血**。

---

## 2. 决策

### 2.1 不新建第二个 secret owner；MCP 侧只持有 opaque ref（复用 Phase A 契约）

- `Credential.Service` 保持唯一秘密读写入口，**语义、列、作用域一字不改**（红线，与 ADR-20 §2.1 对 `PermissionSaved` 同构）。
- MCP 连接侧**永不接触秘密字面量**：`McpServerBinding.credentialRef` 是 `cred_` 前缀的 opaque ref（已落地，`mcp-scope.ts:51-56`），连接 owner 在建立连接的那一刻向 `Credential.Service` 换取材料，**用完即弃，不缓存、不落 Snapshot、不进 event、不进 log**。
- **不新增 `McpCredential` 表**。新增表就是新增 secret owner，直接违反停止条件。
- **传输映射定案（Phase C Slice 4，2026-08-25）**：`MCP_CREDENTIAL_API_KEY`（key）与 `MCP_CREDENTIAL_ACCESS_TOKEN`（OAuth access token）是**仅 stdio 子进程**的稳定环境变量契约；两者都已由真实 child fixture 读取并受测试守护。remote 只接受 OAuth credential，并在每次 HTTP request 发送 `Authorization: Bearer <access>`；不把 key 猜成某个服务器私有 header，避免将一个不可验证的命名假设冻结为跨 server 契约。`metadata` 一律不转发。该裁定同时关闭 Phase C 对 env 命名的复核欠账。

### 2.2 Location 隔离由新增 `mcp_credential_binding` 承担，不动 `Credential`

事实 3 决定了隔离层的位置。新增一张**只存引用、不存材料**的绑定表（新增契约）：

```text
mcp_credential_binding(
  id            text primary key,   -- mcb_<ascending>
  directory     text not null,      -- Location 身份（与 session/project 既有列同形）
  workspace_id  text,               -- 可空，与 Location.Ref 一致
  server_name   text not null,      -- ADR-19 §2.5 的 server 段
  credential_ref text not null,     -- cred_ 前缀，指向 Credential 表
  binding_revision integer not null default 1,  -- CAS 计数器
  revoked_at    integer,
  time_created / time_updated
)
unique(directory, workspace_id, server_name)
```

> **v1.2 关键补注（Slice 2 发现）——这个 `unique` 没有 `WHERE revoked_at IS NULL` 谓词，因此它跨状态生效：被撤销的行永久占住键位，`revoke → bind` 同 key 永远返回 `duplicate`。**恢复路径不是再 insert 一行，而是 §2.3 的 `rebind` 原地状态迁移。只读本节会误以为 DDL 已自足——那正是产生该缺陷的阅读路径。

**v1.1 修订（Slice 0 发现，人类 2026-08-24 裁定）—— `workspace_id` 改为 `not null`，缺省用空串哨兵：**

上面初稿的 `workspace_id` 可空，而 SQLite 的 `UNIQUE` 把 `NULL` 视为互不相等，于是 `(dir, NULL, server)` 可以**无限重复插入**——唯一约束对「未绑定 workspace」这一最常见情形完全失效，同一 Location × server 能堆出多条 binding，解析时任取其一。这是真实缺陷，Slice 0 抓得对。

裁定采用 **`workspace_id text not null default ''`**（空串哨兵），**不采用** `COALESCE(workspace_id,'')` 表达式索引。依据三条：

1. **仓库无表达式索引先例。** 全仓 `packages/core/src/database/` 内 `COALESCE` 零命中；33 张表的唯一性一律用 `uniqueIndex(...).on(列)` 声明（`permission/sql.ts:19`、`event/sql.ts:22`、`session/sql.ts:171`、`workflow/sql.ts:41` 等）。
2. **`schema.json` 是 drizzle-kit 快照，迁移由生成器管线产出**（`cd packages/core && bun run script/migration.ts --check`）。表达式索引要能在「快照 → diff → 迁移」三段里稳定往返，属于给基础设施引入新能力，而本 ADR 只需要一张普通表。**为一张新表引入一种新索引形态，是把偶然成本记在错误的账上。**
3. **哨兵把不变量前移到列上。** `not null` 让「每行必有 workspace 身份」在写入期即被数据库强制，而表达式索引只在唯一性检查时才把 `NULL` 折叠成空串——前者是约束，后者是补丁。既有 `project_directory` 表正是这个做法：两列都 `notNull()` 再组主键（`project/sql.ts:34`）。

**代价如实记录**：`Location.Ref` 侧的 `workspace_id` 可空，所以绑定层写入时必须做一次 `?? ""` 归一，读出时反向处理。这个转换点**必须集中在绑定 store 的单一编解码处**，不许散落到调用方——否则就会出现「有人传 `null` 有人传 `''`」的两套表示。Phase C 必须为此写一条断言：同一 `(directory, server_name)` 在 workspace 缺省下**第二次插入必须抛唯一约束错误**（这正是初稿会漏掉的那条）。

- **跨 Location ref 拒绝（新增契约）**：连接 owner 解析 `credentialRef` 前，必须先在**当前 Location** 的绑定表里命中该 `(directory, workspace_id, server_name, credential_ref)`；不命中即 typed `CrossLocationRefError` fail closed。**Location A 的 binding 绝不能让 Location B 解析出材料**——这正是「隔离」在本 ADR 里的可实现定义：**不是隔离秘密本身（它是用户级资源），而是隔离「哪个 Location 被授权使用哪条秘密」。**
- 表结构照抄 ADR-20 §2.4 的 durable owner 模式：唯一 CAS 写入者、状态变更写在 `EventV2.publish(..., { commit })` 的 commit 回调里与事件行同事务、0 行更新必抛 typed error。**不发明第三套一致性方案。**
- 该表位于 Location 层可见但**数据本身按 directory 分区**；service layer 用 `Layer.provide`（**不是** `provideMerge`）提供 Database/EventV2 —— Phase D 因 `provideMerge` 导出第二个内存 SQLite 并遮蔽共享实例，产生 9 个实例 HTTP 回归，见 [technical-debt](../../technical-debt.md) §3.2 与 Phase D 复审。

### 2.3 Rotation / revocation：绑定层可撤销，材料层复用既有

- **revocation** 落在绑定层：`revoked_at` 置位后，该 Location 对该 server 的 ref 解析立即失败（每次连接实时读，无缓存副本，与 ADR-20 §2.3 同构）。**撤销绑定不删除 `Credential` 行**——同一条凭据可能被别的 Location 或 provider 正在使用，删它就是越权代用户处置。
- **rebind —— 撤销后同 key 的恢复路径（v1.2 追加，Slice 2 发现，人类裁定）**：`unique(directory, workspace_id, server_name)` 无 `WHERE revoked_at IS NULL` 谓词，被撤销的行永久占键位，导致 `revoke → bind` 同 key 永远 `duplicate`，`§2.3` 要求的 “typed fail + rebinding” 终态不可达。裁定采用**原地状态迁移**而非偏索引：`rebind(id, expectedRevision, newRef)` 要求 `revoked_at IS NOT NULL` 且 `binding_revision = expectedRevision`，`SET revoked_at = NULL, credential_ref = newRef, binding_revision = next`，`WHERE` 自带不变量，CAS 保证单 writer。`bind` 仍以 `onConflictDoNothing` 为唯一执行点，`rebind` 复用同一 CAS + `BindingEvent.publish` 形状，不新增索引形态；`StateError{not_revoked}` 区分 “未撤销无可重绑” 与 `duplicate`。
- **rotation ——「完全透明」只在 `update` 路径成立，v1.1 已收窄（Slice 0 发现，人类 2026-08-24 裁定）**：
  - **透明的那半**：`Credential.update(id, { value })` 原地改 `value` 保留 `id`（`credential.ts:121-129`），OAuth 主动刷新正走这条（`integration.ts:436` 在 5 分钟缓冲内 `credentials.update(credential.id, { value })`）。绑定持 ref 不持材料，所以这条路径上轮换对绑定确实透明。
  - **不透明的那半（初稿漏了，这是本 ADR 最危险的一处过度声明）**：`Credential.create` 是 **delete-then-insert 且换新 ID** —— 它先 `delete where integration_id = X` 再插入一条 `ID.create()` 的新行（`credential.ts:93-119`）。而 `integration.ts` 的 key 录入与重新 authorize 都走 `create`。**于是「重新授权同一个 integration」会让所有指向旧 `cred_` 的 binding 集体悬空**，指向一个已被删除的 ID。
  - **裁定的契约**：解析悬空 ref **一律 typed fail closed，并要求 rebinding**；**不得**解出 `undefined` 后继续连接（`Credential.get` 返回 `Info | undefined`，`credential.ts:89-92`；`remove` 删 0 行也静默返回 `void`，`credential.ts:130-132`——两条路径都不会自己报错，所以判空是连接 owner 的责任，这是 No Null Pointer 门禁的直接适用）。
  - **文档纪律**：本 ADR 与 Phase C 报告**不得再写「轮换对绑定完全透明」**，只能写「`update` 路径透明；`create` 路径换 ID 致悬空，按 typed fail + rebinding 处理」。Phase C 必须为这两条路径各写一条断言——**只测 `update` 透明不算**，那恰好绕开了会出事的那条。
- **在飞连接的处置（新增契约）**：撤销绑定或轮换材料**不中断已建立的连接**，但下一次 reconnect / 重新解析即失败。理由与 ADR-19 §2.8 一致——本 ADR 不虚称能中断任意在飞 Provider 流；「关闭即中断」与 kill-switch 通知共用同一未建机制（[technical-debt](../../technical-debt.md) §3.1 第 1 项）。**必须如实写进 Phase C 的报告，不得宣称即时生效。**

### 2.4 日志脱敏：复用 `CredentialScanner`，并纠正计划里的过期事实

- `CredentialScanner` 是**输出侧文本扫描器**（四类正则，`credential-scanner.ts:9-30`），有 1 个生产 Service 取用点（`workflow/workflow-runner.ts:205`），1 个实际 `scan()` 调用点（`workflow/workflow-runner.ts:436`），另有 2 处 Layer 提供/装配点（`location-layer.ts:178`、`workflow/workflow-runner.ts:763`；事实 7）。它仅作为输出侧兜底；MCP 连接的 **stderr / 握手错误 / server 响应**必须经它扫描后再落日志。
- **顺序不可颠倒**：先扫描后裁剪。M2 在 `<workflow_result>` handoff 上的调用点已证明反序会让跨切点的凭据只剩不足以匹配的前缀（`workflow-runner.ts:205`）。
- **它不是密钥管理，不能当既有安全层倚靠**：正则四类覆盖不了任意 server 自定义 header 名。所以本 ADR 的主防线是 §2.1 的「连接侧永不接触字面量」，scanner 只是外部文本入口的兜底。
- **计划 §1 的「`CredentialScanner` 只有 1 个生产 Service 取用点」在数量上准确。** 需补充的是当前另有 2 处 Layer 提供/装配点（`location-layer.ts:178`、`workflow/workflow-runner.ts:763`）；唯一生产取用点仍是 `workflow/workflow-runner.ts:205`。这进一步说明 scanner 仅是输出侧兜底，不能被误认为完整的密钥保护层。

### 2.5 静态加密：**明确不在 M3 范围**，但必须做两件止血

事实 4 是本 ADR 最值得注意的发现：**`auth.json` / `mcp-auth.json` 都是 `0o600`，而 SQLite 库文件没有任何 chmod** —— 秘密最集中的地方权限最松。

- **止血 1（M3 范围）——v1.1 已按 Slice 0 结论扩展覆盖面（人类 2026-08-24 裁定纳入）**：数据库文件创建后 chmod `0o600`，与既有两个文件存储对齐。这不是加密，是把**已有的**保护级别补齐到一致。初稿写「一行可 done」，Slice 0 指出三处不足，均纳入：
  - **必须同时覆盖 `-wal` / `-shm` 侧车。** WAL 是强制启用的（`database/database.ts:27` `PRAGMA journal_mode = WAL`，Node 驱动同样默认开启：`packages/effect-sqlite-node/src/index.ts:68-69`），所以**最新提交的凭据行会先落在 `-wal` 里**，其权限只由 umask 决定。只 chmod 主库文件 = 把最新的秘密留在一个没被收紧的文件里，等于没做。实现为：open 后对主库 / `-wal` / `-shm` 三条路径**幂等 chmod 并容忍 `ENOENT`**（侧车在某些时点不存在）。
  - **Windows 上是 best-effort，必须如实声明。** `chmod` 在 win32 只能切换 read-only 位，无法表达 owner-only 语义。仓库已有同型认知与写法先例：`ripgrep/binary.ts:88` 显式 `if (process.platform !== "win32")` 才 chmod。所以本控制在 Windows 上退化为依赖用户目录 ACL，**Phase C 报告不得声称跨平台等效**。
  - **存在一个不可消除的时序小窗**：SQLite 创建文件到 chmod 之间有一段默认权限窗口。裁定为**如实记录、不追求消除**（open 后立即 chmod、再跑迁移可把窗口压到最小）。要彻底消除需在创建时即指定权限，属驱动层能力，不在 M3。
  - **v1.2 实测修正（2026-08-25，Slice 2 实现期复核）—— 侧车不需要独立的时序窗口，因为 SQLite 用主库文件的 mode 创建 `-wal` / `-shm`。** bun:sqlite 实测：主库 `0600` → 侧车 `0600`；主库 `0644` → 侧车 `0644`；且 `PRAGMA journal_mode = WAL` **本身不创建侧车**，侧车在第一次写入时才出现。因此 chmod **必须排在任何写入之前**（迁移会写）：这样新库的侧车是**以 0600 出生**的，完全没有 umask 窗口；同一次调用在重开既有库时又顺带收紧被旧版本留松的文件。**代价如实记录**：把 chmod 移到迁移之后，最终权限完全相同，所以**没有任何断言能抓到这个回归**——`database.ts` 的注释是唯一的守卫，不得删。上一条的「不可消除的小窗」**只剩主库文件**（open 到 chmod 之间），侧车那半已消除。
- **止血 2（M3 范围）**：`McpServerBinding` 的解码期校验拒绝任何看起来像秘密的字面量（复用 `CredentialScanner` 的四类模式对 `command` / `args` / `env` / header 值做检查），命中即解码失败。理由：ADR-19 §2.9 已裁定写入面必须经解码校验；**这里堵的是「用户把 token 直接写进 MCP 配置」这条最常见的泄漏路径**。
- **静态加密另立专项（不在 M3）**：需要先定密钥来源（用户口令 / OS keychain / KMS）、跨平台（macOS Keychain / Windows DPAPI / Linux Secret Service 各不相同）、以及「忘记口令即丢全部凭据」的产品语义。**登记 technical-debt，不在 G3-3 内假装解决。**

### 2.6 `credential.active` 与 V1 并存边界

- 事实 8：`active` 列在 V2 服务零引用，属 V1 残留。**本 ADR 不动它**（删列需迁移且要确认 V1 面消费方），只登记。
- V1 的 `mcp-auth.json` 与 canonical MCP 凭据**并存不合并**，与 ADR-19 §2.1 的 V1 MCP 裁定一致；迁移评估归 M4 Gate 输入。**Phase C 不得为了「统一」去改 `mcp/v2-auth.ts`。**

---

## 3. 架构影响与五层映射

| 层级        | 变更                                                                                                                                                                              |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1 Schema   | `McpScope.CredentialRef` 已落地（`mcp-scope.ts:51-56`）；新增 `McpCredentialBinding` 编码契约与 `CrossLocationRefError`；`McpServerBinding` 解码期加秘密字面量拒绝（§2.5 止血 2） |
| L2 Core/DB  | 新增 `mcp_credential_binding` 表 + 唯一 CAS 写入者 service（照抄 ADR-20 §2.4；layer 用 `provide`）；DB 文件 chmod `0o600`；`Credential` 与 `CredentialScanner` **均不改语义**     |
| L3 HTTP/SDK | Phase C/F：bind / unbind / list 薄端点（带 `product-mode-custom-v1` 能力头）；**响应体永不含材料**，只含 ref 与 `label`；SDK 重新生成                                             |
| L4 App      | Builder 里选择既有凭据并绑定到 server（不新建凭据录入面，复用 Integration 既有流）；显示 ref 与 label，**不显示材料**                                                             |
| L5 Security | 连接侧零字面量、跨 Location ref 拒绝、绑定层可撤销、解码期秘密拒绝、日志经 scanner、DB 文件权限对齐                                                                               |

## 4. 评审要点与结论

1. **Product — 已裁定（2026-08-24，人类）**：§2.5 静态加密另立专项、M3 只做两项止血 —— **接受**。加密专项须先定密钥来源（用户口令 / OS keychain / KMS）与「忘记口令即丢全部凭据」的产品语义，已登记 [technical-debt](../../technical-debt.md) §3.2。**M3 内不得实现任何加密。**
2. **Core — 已采纳，待 Slice 0 证实**：§2.2 新增绑定表而非改 `Credential` 作用域，定义为「隔离授权关系而非隔离秘密」。**Slice 0 必须先证明无既有表/服务可复用**（重点核 `Integration` / `IntegrationConnection` 是否已能表达「Location × server → credential」）；能复用则改 ADR 再施工（极致减法：复用 → 删除 → 归并 → 重构 → 新增）。
3. **Security — 已采纳为诚实边界**：§2.3「撤销不中断在飞连接」是**如实声明的边界**，与 ADR-19 §2.8 及 kill-switch 通知共用同一未建机制；Phase C 报告**不得宣称即时生效**。§2.4 scanner 正则覆盖不全属已知，主防线是 §2.1「连接侧永不接触字面量」，scanner 只是外部文本入口的兜底。
4. **App — 已采纳**：§3 L4 只做绑定、不做凭据录入，复用 Integration 既有流；响应体与界面只显示 ref 与 `label`，永不显示材料。
5. **Schema+SDK — 已采纳**：`McpCredentialBinding` 复用 `mcp-scope.ts` 作为编码真源，与 Phase A 一致。

**第 2 条是 Slice 0 唯一可推翻的一条**；第 1 / 3 / 4 / 5 条为定案，Phase C 照做不改。

### 4.1 v1.1 新增裁定（2026-08-24，人类；来源 = Slice 0 第 5 问「ADR 漏掉的绿地」）

6. **OAuth `expires` 过期处置 —— 裁定为 typed fail 进 `auth-required`，Phase C 不实现 refresh。** 现状盘点（Slice 0 提供，复审方复跑确认）：provider 侧已有主动 refresh 先例（`integration.ts:432-437`，5 分钟缓冲 + `update` 保 ID），V1 MCP 侧是被动判定（`packages/aigcfroge/src/mcp/v2-auth.ts:139` 的 `isTokenExpired` 只做比较，过期要求重走 auth，无自动 refresh；**注意该文件在 aigcfroge 包，不在 core**）。**裁定取 V1 MCP 的形状**，依据三条：① `auth-required` 已在六态之内（§2.2 的 health 状态集），过期进该态是状态机的自然表达，不需要新机制；② 自动 refresh 要决定「谁在什么 fiber 上刷、并发连接如何去重、刷失败怎么退」，那是一个独立的所有权问题，塞进 Slice 3 会让连接 owner 顺带变成凭据生命周期 owner，违反 §2.1「不新建第二个 secret 读写入口」；③ provider 侧的 refresh 走 `update` 保 ID，而 MCP 侧的重新 authorize 走 `create` 换 ID（见 §2.3 v1.1）——**在悬空 ref 契约刚刚定下的同一个 Phase 里再叠一套自动 refresh，会让两个新契约互相耦合**。若日后要做，归 Phase C 之后的独立切片，照抄 provider 侧模式并由凭据层而非连接层负责。**Phase C 内该路径只允许 typed fail，不允许悄悄实现 refresh。**
7. **§2.5 两项补强纳入止血 1 范围** —— WAL/SHM 侧车一并 chmod、Windows best-effort 声明，均已写入 §2.5，见该节。
8. **§2.2 DDL 唯一性缺陷按空串哨兵修订、§2.3 轮换透明性声明按 `update`/`create` 双路径收窄** —— 已分别写入 §2.2、§2.3，理由见各节。

**这四条都不是起草方发现的，是 Slice 0 发现的。** 记录在此作为「起草方与批准方必须分离」的又一次实证：ADR-19/ADR-20 由执行方起草、复审方批准时抓出 C2 与 §2.6 BLOCK；ADR-21 反向由复审方起草，Slice 0 抓出上述三处缺陷加一处未定项。**任何一方自起草自批准，这四条都会带着进生产。**

## 5. 停止条件（本 ADR 特有，补充 M3 计划 §6）

- 任何方案要求把材料写入 Snapshot / event / log / 绑定表。
- 任何方案新增第二个 secret 读写入口，或改 `Credential.Value` 语义。
- 任何方案宣称「撤销即中断在飞连接」而无进程内通知机制支撑。
- 任何方案为了「统一凭据」去改 V1 `mcp-auth.json` 或 `auth.json` 的在役语义（违反 ADR-19 §2.1 的并存裁定）。
- 任何方案把 `CredentialScanner` 当作充分的密钥保护层。
- **Slice 0 未完成、或 §1.1 任一事实被证伪，却继续写 connection / credential 生产代码。**

## 6. 审批与授权记录

| 评审方     | 结论                                             | 备注                                                                                                                                                                                                              |
| ---------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product    | **Accepted**（2026-08-24）                       | 人类直接裁定 §2.5：加密排除在 M3 之外，只做两项止血；v1.1 追加裁定 §2.5 两项补强纳入止血 1、OAuth `expires` 取 typed fail 不做 refresh（§4.1 第 6/7 条）                                                          |
| Core       | **Accepted, condition discharged**（2026-08-24） | 用户授权 AI 代理代行技术审批；§2.2「必须新增绑定表」的复核前置**已由 Phase C Slice 0 履行**：八条事实 8/8 成立，逐候选否决后保留新增，另发现三处 ADR 缺陷（DDL 唯一性、轮换透明性、止血覆盖面），均已在 v1.1 修订 |
| Security   | **Accepted**（2026-08-24）                       | §2.3 为如实边界；主防线 §2.1，scanner 仅兜底                                                                                                                                                                      |
| App        | **Accepted**（2026-08-24）                       | 只做绑定，不做凭据录入                                                                                                                                                                                            |
| Schema+SDK | **Accepted**（2026-08-24）                       | 复用 `mcp-scope.ts` 为编码真源                                                                                                                                                                                    |

> **起草/批准分离说明**：本 ADR 由复审方起草，故不由起草方自批。§2.5 由人类裁定；其余四条以「Accepted + Slice 0 独立事实复核」形式闭门——Slice 0 就是起草方不自批的补偿控制，**不是可选步骤**。
