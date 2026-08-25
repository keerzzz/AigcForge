# Custom Mode M3 剩余阶段执行提示词

> **状态**：Approved for execution v1.0（2026-08-25）
> **基线**：本地 `main@805eb857f`（Phase A/B/D/F0 + Phase C Slice 0-2 已合入，未推送）
> **范围**：Phase C Slice 3-4 → Phase E → Phase F → Phase G。**Phase C Slice 0-2 已交付，不重做。**
> **依据**：[M3 计划](custom-mode-m3-mcp-approval.md)、[ADR-19](../architecture/adr/ADR-19-mcp-scoped-registration.md) v1.0、[ADR-20](../architecture/adr/ADR-20-scoped-grant-model.md) v1.2、[ADR-21](../architecture/adr/ADR-21-mcp-credential-custody.md) **v1.2**、[Slice 1-2 提示词](prompt-custom-mode-m3-mcp-approval.md)（追溯用）
> **交付纪律**：每 Phase 一个短分支 → 复审 → 合入本地 `main`（`--no-ff`）→ 不推送。**M3 全部结束后统一开一个 PR。**

---

## 0. 先读这一节：Slice 1-2 复审抓出了九次同型缺陷

九次全部是同一个形态，且**每一次都落在安全相关的那条代码上**：

> **测试名声称观察 X，断言实际只观察到 Y（Y 比 X 弱）。**

| # | 声称 | 实际断言 | 拆掉生产代码后 |
|---|---|---|---|
| 1 | 孤儿进程被终结器杀掉 | 观察到的是 spawner 的 release | 删 25 行手写终结器 → 13/13 仍绿 |
| 2 | credentialRef fail-closed | 无断言 | 删守卫 → 全绿 |
| 3 | remote transport fail-closed | 无断言 | 删守卫 → 全绿 |
| 4 | `__proto__` 工具被安全处理 | 静默丢弃且 routes/registry 分叉 | 无人发现 |
| 5 | 跨 Location 隔离 | 只测了同 Location 重复 | `currentLocation()` 返回常量 → 全绿 |
| 6 | duplicate 是 typed `StateError` | 只看 `Exit.isFailure`（defect 也为真） | 文案匹配失效 → 6 pass 不变 |
| 7 | `isUniqueViolation` 判 code+message | 函数零调用点 | 生产路径仍是裸文案匹配 |
| 8 | `revoke` 的 `CommitRejected → revision_mismatch` | `catchDefect` 永不触发（它是 failure） | 死代码 |
| 9 | 悬空 ref 精确校验 `InvalidConfigError{dangling}` | 嵌在 `if (... instanceof ...)` 里 | 换成别的错误类型 → 18 pass 不变 |

**另有三次「报告声称的门禁与实测不符」**：`lint-changed`「passed」实为 13 条 violation（把「13 条违规」读成「13 个文件」）、`schema typecheck`「clean」实为红（连续两轮）、`credentialMaterial`「已真注入 env」实为取了从未读取、`CredentialScanner`「先扫后裁已接 stderr」实为未使用的 import。

### 0.1 因此本阶段的四条硬纪律

1. **每一条安全断言都要有红证。** 拆掉被测的那行生产代码 → 断言必须真的红 → 恢复。**报告里逐条贴「拆什么 / 红在哪个用例 / 恢复后绿」。** 没有红证的安全断言按不存在处理。
2. **断言不许嵌在条件里。** `if (Option.isSome(x) && x.value instanceof T) expect(...)` 是**空转**——类型一变就静默跳过。用无条件的 `expect(probe.tag).toBe(...)` + `expect(probe.reason).toBe(...)`。`Exit.isFailure` **单独使用即为不合格**，因为 defect 也满足它。
3. **「加了但没接」是本 Phase 最高频的缺陷。** 写完任何 helper / 校验函数 / 常量，立刻 `grep -rn "<名字>" packages/` 数调用点。零调用点 = 没做。`oxlint` 与 `tsgo` 都抓不到它（模块内 `const` 被 `export` 的兄弟符号掩护、`let` 被赋值即算「使用」）。
4. **门禁数字先跑后写。** 「passed」这个词只能在看到 `Incremental lint passed:` 之后写。M3 计划 §6.4 是「报告真实性红线，违反即交付拒绝」——复审方每次都会复跑，差异一定会被发现。

### 0.2 一个正面范式：把安全步骤抽成可断言的单点

Slice 2 里三次用到同一手法，**继续沿用**：

- `lookupFilter` — 唯一活跃查询谓词，`EXPLAIN QUERY PLAN` 断言它走索引
- `rebindFilter` — rebind 的 CAS 谓词，结构断言它带 `revoked_at IS NOT NULL`（竞态守卫在单线程测试里不可观察，只能结构断言）
- `redactStderrLine` — 先扫后裁的唯一实现点，断言绑定到导出的 `MAX_STDERR_LOG` 而非副本

**判据**：一个安全相关的步骤，如果没有任何断言能碰到它，就是没人在守它。抽出来。

---

## 1. 已交付事实（勿重做，但要复用）

`main@805eb857f` 上已存在、**必须复用而不是重建**的接缝：

| 接缝 | 位置 | 用途 |
|---|---|---|
| `McpConnection.Service` | `core/src/mcp/connection.ts` | typed stdio 连接 owner：`connect` / `disconnect` / `connections` / `callTool` / `shutdown`。**Slice 3 在此扩展 remote，不新建第二个 owner。** |
| `McpConnection.ConnectError` | 同上 | typed 失败联合。**新增失败必须进这个联合**——漏掉一项会让整条错误通道塌成 `unknown`（Slice 2 实测过）。 |
| `McpConnection.redactStderrLine` / `MAX_STDERR_LOG` | 同上 | 先扫后裁的唯一实现点。remote 侧的握手错误 / server 响应文本走同一函数。 |
| `McpRegistration.registerServer` | `core/src/tool/mcp-registration.ts:103` | 唯一工具注册入口，canonical 名 `mcp_<server>_<tool>`。 |
| `McpCredentialBindingStore` | `core/src/mcp/binding/store.ts` | `bind` / `rebind` / `get` / `getById` / `revoke` / `resolve` + `lookupFilter` / `rebindFilter`。 |
| `ScopedGrantStore` | `core/src/grant/store.ts` | durable owner 范式（`publish` + `seq + 1` CAS 在 `grant/event.ts:37` + 0 行更新抛 typed）。**Phase F 的 grant 签发走它，不新建。** |
| `CredentialScan` 四正则 | `schema/src/credential-scan.ts` | 秘密模式单一真源，`containsSecret` 每次新建 RegExp 副本（避免 `lastIndex` 状态污染）。 |
| `McpScope.decodeBinding` | `schema/src/mcp-scope.ts` | canonical 解码：excess-key 拒绝 + transport 形状 + 止血 2 秘密字面量拒绝。**任何解码点都走它，不许再写本地 `Schema.decodeUnknownSync`。** |
| `Database.layerFromPath` | `core/src/database/database.ts` | 单一初始化序列 + 三路径 chmod。**不要再复制 PRAGMA 序列。** |

**装配范式**（`location-layer.ts:148-162`）：新 location 层一律 `Layer.provide`，**永不 `provideMerge`**（Phase D 因它导出第二个内存 SQLite，造成 9 个 HTTP 回归）。依赖必须在**生产装配点**提供——只在测试 harness 里提供，等于该路径在生产不存在（§4.6 陷阱 3，Slice 2 的 `CredentialScanner` 就是这么暴露的）。

### 1.1 一笔必须在 Slice 3/4 结清的欠账

`credentialEnvFor`（`connection.ts`）目前把材料注入 `MCP_CREDENTIAL_API_KEY` / `MCP_CREDENTIAL_ACCESS_TOKEN`。这两个名字**一旦有 server 依赖就是不可变契约**（性质同 canonical 工具名进 Snapshot，ADR-19 §2.6）。现在它只是代码注释里的一个理由，**不是裁定**。Slice 4 拿真实 server 目录定 64 字符截断策略时，**这个命名要一起复核并写进 ADR-21 §2.1**。


---

## 2. 开工门禁（每个 Phase 开工前跑一遍，贴数字）

```bash
git log --oneline -1                       # 必须是 805eb857f 或其后继
bun --cwd packages/core test --timeout 30000        # 基线 2148 pass / 2 skip / 0 fail
bun --cwd packages/schema test --timeout 30000      # 基线 137 pass / 0 fail
bun --cwd packages/core typecheck && bun --cwd packages/schema typecheck
cd packages/core && bun run script/migration.ts --check && cd ../..
bun run script/lint-changed.ts
```

**基线对不上就停机报告**，不要在漂移的基线上施工。

必读（每 Phase 开工前重读对应项，不采信本提示词的转述）：

- `CLAUDE.md` 第一性原理 + 改完即审七步
- `AGENTS.md`（Effect 编码、Schema、测试）、`packages/core/src/tool/AGENTS.md`
- MCP/Tool slice：`specs/v2/tools.md`；credential/grant：`.aigcfroge/skills/database`、`effect`
- UI slice：`DESIGN.md`、`.aigcfroge/skills/frontend-theming`
- HTTP slice：`packages/aigcfroge/AGENTS.md`、`docs/testing.md`

---

## 3. Phase C Slice 3：remote / OAuth + 六态 health

**分支**：继续 `mcp-connection`（或从当时 `main` 起 `mcp-remote`）

### 红（每条都要红证）

1. **连接期失败各自 typed**。`McpServerBinding.url` 已在解码期校验 http(s) 前缀，所以这里测的是**解码通过但连接不可用**的形态：DNS 失败、连接被拒、TLS 失败。
2. **credential missing / expired / revoked 三种各自 typed**，不许合并成一个 `InvalidConfigError`。三者语义不同：missing = 未绑定，expired = 已绑但 token 过期，revoked = 绑定被撤销。**合并即丢失 UI 该给用户的下一步动作。**
3. **`auth-required` 流**：缺凭据时进 `auth-required`，**不是静默 `offline`**。这两个态对用户的含义相反——一个要去授权，一个是等重连。
4. **六态转换** `connecting | ready | degraded | offline | auth-required | revoked`：每条合法边一条断言，**非法边必须被拒**（例如 `revoked → ready` 不经 rebind 不成立）。
5. **secret redaction 覆盖 remote 的新文本入口**：握手错误体、server 响应文本、HTTP 头，全部经既有 `redactStderrLine`。**给顺序证据**：喂一个跨过 `MAX_STDERR_LOG` 的秘密并断言仍被扫出（Slice 2 已有该形状用例，照抄）。

### 绿

- health 投影**只读服务端状态**，App 不自行推演六态（M0-M2 固定裁决）。
- 轮询 / 重连调度用 owner-Scope 范式 `Effect.forkScoped`，**不用裸 `setInterval`、不用 `Effect.fork`/`forkDaemon`**。
- remote 复用 `McpConnection` 既有 `Wire` 语义边界（request / sendOnly / failAll），不新建第二套 pending 管理。
- 新增失败类型**必须进 `ConnectError` 联合**。漏一项就把整条错误通道推断成 `unknown`，`connect` 上所有 typed 保证一次性失效，而 `bun test` 不做类型检查所以测试照绿——Slice 2 实测过这个陷阱。

### 已裁定，不要重新论证

**OAuth `expires` 过期 = typed fail 进 `auth-required`，Phase C 不实现 refresh**（ADR-21 §4.1 第 6 条，人类 2026-08-24 裁定）。取 V1 MCP 的被动判定形状（`packages/aigcfroge/src/mcp/v2-auth.ts:139` 的 `isTokenExpired` —— 注意它在 **aigcfroge 包**，不在 core），不取 provider 侧主动 refresh（`packages/core/src/integration.ts` 的 5 分钟缓冲 refresh）。理由：自动 refresh 会让连接 owner 顺带变成凭据生命周期 owner，违反 ADR-21 §2.1「不新建第二个 secret 读写入口」。**该路径只允许 typed fail。**

---

## 4. Phase C Slice 4：disconnect / reconnect / drift

**分支**：继续同一分支

### 红

1. **重连后 `listTools` 变化 ⇒ 下一个 provider turn 报 `tool_fingerprint_mismatch` / `catalog_digest_mismatch` 并 fail closed。复用既有重验路径，不新增第三套漂移检测。**
2. **kill switch 关闭时新连接在 admission 处即拒**（不是连上再断），且 pending request 一并停止（M3 计划 §0.2 第 2 项）。
3. **pending request 由 owner finalizer 释放，不留悬挂 `Deferred`。** 断言方式：关闭 owner Scope 后，之前 await 的 fiber 必须以 typed 失败结束，**不是「Scope 关闭没抛错」**（那是第 1 号同型缺陷的形态）。

### 本 slice 必须结清的两笔 M2 欠账（technical-debt §3.1）

1. **ADR-19 §2.7 隔离矩阵 #1（跨 Location）与 #4（V1 单向隔离）的连接期集成断言。** 写 #1 时注意：**冲突域今天不是 Location-scoped**——别断言一个今天不成立的事，再去改产品让它成立。先确认现状，再决定断言的是「现状」还是「需要改产品」。
2. **工具名 64 字符截断策略。** 拿**真实 server 目录**定，写进 changelog 并给依据。**必须解释为什么这个方案在「不可变命名契约」前提下站得住**——canonical 名进 Snapshot catalog 与工具指纹，定了就改不动。**§1.1 的 `MCP_CREDENTIAL_*` 环境变量命名同批复核并写进 ADR-21 §2.1。**

### 交付后

**必须真跑 `test/server/`**（基线 379 pass / 2 skip / 0 fail，约 10 分钟），不许因为「core 没变」推断。Phase D 的 9 个回归就是这么漏的。

---

## 5. Phase E：Resolver / Snapshot 与运行依赖

**分支**：`mcp-composition`（从 Phase C 合入后的 `main` 起）

### 红

1. **只有 Profile 显式绑定的 MCP 被解析**——未绑定的 server 不得因为「Location 里存在这个资产」就进 Plan。
2. **Plan 显示 requested / effective / denied 三列 + credential / health**。三列缺一即不合格：只显示 effective 会让用户看不到自己请求了什么被拒。
3. **start 时 re-freeze**；**运行中定义变化不改已有 Snapshot**。
4. **新 provider turn fingerprint mismatch 阻断**；**撤销后新调用失败**。

### 绿：先评估，别急着开 v3

M3 计划 §3 Phase E 的事实校准是本 Phase 最重要的一条：

> 现有 composition union 只有 V1|V2，**没有 v1→v2 升级**，未知版本硬失败，消费方各自 `switch version`。新增 v3 意味着**每个这类站点都要加第三分支**。

**所以先回答「能不能用 V2 内的可选字段承载 MCP catalog 与 registration fingerprint」**，答案是「能」就不要开 v3。要开 v3 必须：

- 先把所有 `switch version` 站点列出来（`rg -n "version === \"v2\"\|case \"v2\"" packages/`），给出每个站点的第三分支改法
- 说明未知版本硬失败的语义在 v3 引入后如何不破坏既有 Snapshot 的可恢复性
- **这是一次独立评估，不是一个字段**。评估结论进 ADR 或计划，人类裁定后再施工。

### 陷阱

Snapshot 只存 **ref / fingerprint**，永不存材料、executor、client（M3 计划 §6 停止条件）。MCP tool catalog 进 Snapshot audit facts 时，**catalog 里的每一项都要能追回 registration identity**，否则漂移检测无从比对。

---

## 6. Phase F：HTTP / SDK / App 审批中心

**分支**：`approval-center`（需产品先定界面）

### 事实校准：重心是客户端，不是端点

M3 计划 §3 Phase F 已核实：**V2 的 pending / reply 端点与 `permission.v2.*` 事件都已存在并已挂载，缺的纯粹是客户端**（app/tui/session-ui/ui 对 `permission.v2` 零消费，app 仍走 V1 的 `permission.asked/replied`）。**所以本 Phase 的重心是 L4 与「V1/V2 双轨如何收敛」，不是再造一套端点。**

### 两个必须处理的陷阱

1. **custom Session 的 `permission.v2.asked` 对没带 `product-mode-custom-v1` 能力头的连接会被 SSE 过滤掉。** 审批中心如果不带能力头，pending 永远不出现在列表里——而 UI 看起来完全正常。
2. **app 侧已有一个纯浏览器的 auto-accept 存储**（按 `base64(directory)/sessionID` 持久化，带会话血缘继承）。**它不是服务端 grant，不能与 `ScopedGrant` 混为一谈。** 收敛方案必须显式说明这两者的关系，不许让浏览器存储成为事实上的授权来源。

### 不可分割的时序约束（M3 计划 §3 Phase D 注 1）

Phase D 把 attended custom 的资产自授权重写成 `ask`，而**在审批中心落地前，每一个 `ask` 都处于「无人可答」状态**。所以：

> **重写与 ADR-20 §2.7「无应答方即时拒绝」必须同一 slice 交付。**

判据必须来自**连接/订阅事实**，不得用「`attended` flag 没被显式设成 false」冒充（`effective.ts:48` 的 `input.attended !== false` 是默认值，不是「真有人能答」）。这条直接触及 M3 计划 §6 停止条件「ask 在 unattended/headless 状态可能无限等待」。

### 红

auth / scope / CSRF 等现有 HTTP 边界；pending 聚合；once/Session/Location 明示；revoke；无页面连接；Builder health/diagnostics；desktop/narrow/keyboard/i18n（**en/zh/zht 三语，其余 locale 已冻结**）。

### 绿

薄 endpoints + SDK 重新生成（**审查真实 diff**，`OpenApi.annotations identifier` 缺失会让 `client.<group>.<sub>.<method>` 变 `undefined` 且无门禁报错）；应用级 pending indicator/dialog；Custom Builder/Session panel 显示 MCP health。**入口只聚合请求，不自动扩大 scope。**

Grant 签发走既有 `ScopedGrantStore`，**不新建第二个 grant owner**（M3 计划 §6 停止条件）。

---

## 7. Phase G：故障注入与灰度

**分支**：同 Phase F 或独立短分支

逐项注入并断言：server crash、network partition、OAuth expiry、credential revoke、grant expiry、Session close、Location unload、name collision、tool schema change。

四条必须验到的：

1. **撤销后新调用立即失败**；已开始的调用按 ADR 明确结束/中断策略——**ADR-21 §2.3 已如实声明「撤销不中断在飞连接」，报告不得宣称即时生效。**
2. **无页面连接时请求不会无限挂起。** 这是**今天真实存在的挂起，不是假想**：`Deferred.await` 无 timeout，只能等 Location 60 分钟 idle 驱逐。
3. **kill switch 关闭时 MCP 连接与 pending request 一并停止**（M3 计划 §0.2 第 2 项）。
4. **Location A 的 MCP 不出现在 Location B**（M3 退出条件）。

---

## 8. 每个 slice 的 TDD 循环

红 → 绿 → 重构 → **CLAUDE.md 改完即审七步** → 报告。

安全测试必须**成对覆盖「模型看到定义」和「settle 真执行」**；只测 permission assert 或只测 UI 隐藏均不合格（M3 计划 §4）。

### 复查结论格式（每 slice 必出）

```text
复查结论:
- 影响文件:
- 命中 skills:
- 安全门禁:      Catch Everything / No Null Pointer / Security First 逐项
- 工程门禁:      No Cheating / Reusability / Clean Logs 逐项
- 已运行命令:    贴真实数字，不贴「passed」二字
- 红证:          拆什么 / 红在哪个用例 / 恢复后绿
- 剩余风险:
```

---

## 9. 验证命令

```bash
# Schema
bun --cwd packages/schema test --timeout 30000 && bun --cwd packages/schema typecheck

# Core（含 migration clean/existing/rerun 证据）
bun --cwd packages/core test --timeout 30000 && bun --cwd packages/core typecheck
cd packages/core && bun run script/migration.ts --check && cd ../..

# HTTP/server（约 10 分钟，必须真跑完并贴数字）
bun --cwd packages/aigcfroge test test/server/ --timeout 60000

# SDK（重新生成并审查真实 diff）
bun run script/generate.ts       # = sdk build + `bun dev generate > ../sdk/openapi.json` + format
git diff packages/sdk/js packages/sdk/openapi.json

# App/UI
bun --cwd packages/app typecheck && bun --cwd packages/ui test

# Lint（增量；全量 `bun run lint` = oxlint 全仓 + lint-changed）
bun run script/lint-changed.ts
```

---

## 10. 停止条件（M3 计划 §6，违反即停机）

- canonical Session/Location registration 或唯一 grant owner 未批准。
- 方案要求把 executor / client / secret 存入 Snapshot。
- Location/Session cleanup 只能依赖手工 `Map` 删除而无 owner Scope。
- `always` 被直接改名成 Session/Location grant。
- **ask 在 unattended/headless 状态可能无限等待或默认 allow。**
- 撤销、断线、schema drift、权限拒绝测试失败。
- **任何一条安全断言没有红证却写进报告。**

---

## 11. 交付与合并

每 Phase：短分支 → 复审 → 合入本地 `main`（`git merge --no-ff`）→ **不推送**。
**M3 全部 Phase（C Slice 3-4 / E / F / G）结束后统一开一个 PR**，不与 M4 Plugin 生命周期修改混在同一 PR。
