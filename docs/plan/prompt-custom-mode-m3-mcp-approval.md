# Custom Mode M3 全量 TDD 执行提示词

> 对应总计划：[custom-mode-composition-platform-implementation.md](custom-mode-composition-platform-implementation.md)
> M3 计划：[custom-mode-m3-mcp-approval.md](custom-mode-m3-mcp-approval.md)
> 前置：M2 总复审 APPROVED（R5）+ **R6 合并后 P0 已整改**（`b9c6d1077`）；**M3 Phase A 已完成并合入**（`7a2804624`）；**Phase B 已交付、经独立复审整改并合入**（`99dce8906`）——ADR-19 Accepted v1.0（C1/C2 已闭合）、ADR-20 Accepted v1.2（§2.6 两半均已 Accepted）
> 分析基线：**本地 `main@8c8c2b69e`**（2026-08-23）。**本地 main 领先 origin/main 19 个提交**：按用户安排 M3 全部 Phase 完成后统一开一个 PR，因此以**本地 main** 为基线，不要因落后 origin 而回退
> 生成日期：2026-08-22（2026-08-23 按 Phase A 完成、R6 整改、Phase B 复审整改与 attended 裁定三次校准）
> 当前开工阶段：**Phase D — ScopedGrant 与 PermissionEffective**，分支 `scoped-grants`
> 用途：复制 `PROMPT START` 与 `PROMPT END` 之间的正文到新的执行对话

<!-- PROMPT START -->

你是 AigcForge 仓库（`/media/win_data/aigcfroge`）的高级全栈工程师。你的目标是按仓库协议，以 TDD 小切片执行 **Custom Mode M3：MCP 与统一审批**。

M3 的根问题不是「让 Profile 能选 MCP」。它要让外部工具在一个明确的 Location/Session/Agent/revision scope 内进入**唯一** ToolRegistry，并且凭证、授权、健康、撤销与无人值守策略全部 fail closed：

```text
Location -> Profile/composition (MCP binding = ref + fingerprint, 永不含 secret)
-> Plan (requested/effective/denied + credential/health) -> server re-freeze -> Snapshot
-> scoped registration (owner Scope, 非进程全局) -> canonical ToolRegistry
-> 调用前三重校验: Snapshot allowlist + registration fingerprint + Permission/ScopedGrant
-> pending approval request -> once/Session/Location grant (typed scope + expiry + revocation)
-> 撤销/断线/schema drift 立即使新调用失败
```

## 0. 最重要的一条：现在只能做 Phase D

**Phase A 与 Phase B 都已完成并合入本地 `main`。G3-1 / G3-2 / G3-4 均已通过。** ADR-19 Accepted v1.0（条件 C1/C2 已闭合）、ADR-20 Accepted v1.2（§2.6 unattended 与 attended 两半均已 Accepted；attended 裁定为重写成 **`ask`** 而非 deny）。因此：

- **当前可开工阶段：Phase D**（ScopedGrant 与 PermissionEffective），分支 `scoped-grants`，从最新**本地** `main` 起。
- **Phase C 仍不得开工**：需 G3-3（Credential），ADR **尚未起草**。注意 Phase C 不是「批准待办」而是「设计待建」——秘密明文存储、凭据表无 scope 列、`auth.json`/`mcp-auth.json` 绕开 Credential service、Snapshot 无字段可装 opaque ref，四项全是绿地。**不要因为 Phase D 做完了就顺手做 C。**
- **Phase E 依赖 Phase C，Phase F 依赖 Phase D。** Phase D 结束即停机等复审。
- **不得触碰 unattended 天花板的白名单成员**：`glob | grep | list_assets | read` 是已裁定项，`skill`/`kb_search`/`question` 明确不纳入；变更需重新过 Security 复审（见 §4.5-1）。你在 Phase D 要动的是 **attended 半边**，不是白名单本身。
- 若你发现自己在写 MCP connection、transport、OAuth 或 credential 解析的生产代码，立刻停止并报告——那是 Phase C 且 Gate 未过。

### 0.1 Phase D 的头号陷阱：`ask` 今天没人能答

attended 天花板把资产声明的 allow 重写成 `ask`。但**今天 app/tui/session-ui/ui 对 `permission.v2.*` 零消费**，且 custom 会话的 `permission.v2.asked` 对未带 `product-mode-custom-v1` 能力头的连接会被 SSE 过滤掉（`product-mode-policy.ts:183-198`）。所以在审批中心（Phase F）落地前，attended custom 的每一个 `ask` 都处于**无人可答**状态。

**只做重写而不做 [ADR-20 §2.7](../architecture/adr/ADR-20-scoped-grant-model.md) 的「无应答方即时拒绝」，等于把一个安全洞换成「每次工具调用挂到 TTL 再失败」的可用性事故**，并直接触犯 M3 计划 §6 停止条件「`ask` 在 unattended/headless 状态可能无限等待」。两者必须**同一 slice** 交付。

且「有人能答」的判据必须来自**连接/订阅事实**（存在带能力头的活跃订阅方），不得用 `attended` flag 冒充——`effective.ts:48` 的 `const attended = input.attended !== false` 是**默认值**，不是「真有人在」的证据。这是本 Phase 最容易写出「看起来对、实际全挂」的地方。

## 1. 开工门禁

先执行并记录：

```bash
pwd
git branch --show-current
git status --short --branch
git remote -v
git fetch --prune origin
git log -1 --format='%H %ad %s' --date=iso main
git log -1 --format='%H %ad %s' --date=iso origin/main
git rev-list --left-right --count main...origin/main
git log --oneline --decorate -20 main
```

规则：

1. **开工前提：Phase A 与 Phase B 都已合入本地 main。** 先 fetch 并审计最新 main，确认 `b9c6d1077`（R6 整改）、`7a2804624`（Phase A ADR + mcp-scope 契约）、`99dce8906`（Phase B registration，含复审整改）都在 main 上；`packages/schema/src/mcp-scope.ts`、`packages/core/src/tool/mcp-registration.ts`、`packages/core/test/tool-registry-stale.test.ts` 必须存在。**注意本地 main 领先 origin/main 19 个提交**（按用户安排，M3 全部完成后统一开一个 PR），所以以本地 main 为基线、不要因为落后 origin 而回退。若上述提交或文件缺失，说明你在另一个克隆里，停止并报告。
2. 不覆盖、回滚、清理或提交用户已有改动。若 main 有无关脏改动，先报告并隔离本任务文件；禁止 `git reset --hard`、`git checkout --`、盲目 `clean`。**已知无关在途文件：`docs/research/agent/Codex Harness 深度调研.md`（用户资料，保留原样，不要提交进本任务的 commit）。**
3. 分支策略（M3 计划 §7）：`mcp-scope-adr`（Phase A，已合入）→ `mcp-registration`（Phase B，已合入）→ **`scoped-grants`（Phase D，你在这里）** → `mcp-composition`（Phase E，待 Phase C）、`approval-center`（Phase F，待 Phase D）；Phase C 待 G3-3 批准后另开。分支名不超过三个短词、无 slash。M3 各阶段在本地依次合入 main 成链，**不逐阶段推送、不逐阶段开 PR**。
4. 未经用户确认 remote、issue、最终 diff、commit/PR title，不 push、不创建 PR。禁止 `--no-verify`。
5. 测试永不从仓库根运行。用 `bun --cwd packages/<name> test --timeout 30000`。根目录只跑 typecheck/lint/protocol/diff 等非 test 门禁。
6. **创建 custom session 的新测试文件必须自己拿 kill switch**：在文件作用域调用 `withCustomModeEnabled()`（`packages/core/test/lib/product-mode.ts`），并用 `env -u AIGCFROGE_CUSTOM_MODE bun --cwd packages/core test <file>` 单跑验证。放进 `describe` 里只覆盖那一个 block，不够；靠别的测试文件泄漏的 env 通过 = 本地绿 CI 红（M2 实际踩过）。

## 2. 必读协议与计划

开工前完整读取，不依赖本提示词转述：

```text
CLAUDE.md
AGENTS.md
ARCHITECTURE.md
DESIGN.md
docs/testing.md
.aigcfroge/skills/protocols/SKILL.md
.aigcfroge/skills/enterprise-code-standard/SKILL.md
.aigcfroge/skills/reuse-first-refactor/SKILL.md
.aigcfroge/skills/quality-to-pr/SKILL.md
docs/architecture/adr/ADR-17-custom-mode-composition-platform.md
docs/architecture/adr/ADR-18-custom-mode-workflow-execution.md
docs/prd/custom-mode-composition-platform.md
docs/roadmap/custom-mode-roadmap.md
docs/plan/custom-mode-composition-platform-implementation.md
docs/plan/custom-mode-m2-multi-agent-workflow.md
docs/plan/custom-mode-m3-mcp-approval.md
docs/review/AigcForge_CUSTOM_M2_REVIEW.md
docs/technical-debt.md
specs/v2/session.md
specs/v2/tools.md
specs/v2/schema-changelog.md
packages/core/src/tool/AGENTS.md
```

随后只为当前 Phase 加载专题协议：

- Effect/Core：`.aigcfroge/skills/effect/SKILL.md`、相关 package `AGENTS.md`。
- Database：`.aigcfroge/skills/database/SKILL.md`、migration/schema owner 与测试（grant store 强制）。
- HTTP：`packages/aigcfroge/src/server/routes/instance/httpapi/AGENTS.md`、`packages/aigcfroge/test/server/AGENTS.md`。
- App/UI：`packages/app/AGENTS.md`、`.aigcfroge/skills/frontend-theming/SKILL.md`。

**M2 复审报告必读 §2.5 与 §3。** 它记录了 11 项 P0/P1 的根因与修法，其中 3 条直接决定 M3 的设计边界（见 §4.5）。

## 3. 锁定 M3

只执行 M3（对应 M3 计划 §3）：

```text
Phase A  Registration/Grant ADR 与 Schema 契约            分支 mcp-scope-adr    ✅ 已完成并合入 main（7a2804624）
Phase B  canonical scoped registration                   分支 mcp-registration ✅ 已完成、经复审整改并合入 main（99dce8906）
Phase D  ScopedGrant 与 PermissionEffective               分支 scoped-grants    ← 当前可开工（G3-2/G3-4 已通过）
--- 以下仍被 Gate 阻塞或有前置，不得开工 ---
Phase C  connection、credential 与 health                 分支另开             （需 G3-3，ADR 尚未起草）
Phase E  Resolver/Snapshot 与运行依赖                     分支 mcp-composition （依赖 Phase C 的连接实体）
Phase F  HTTP/SDK/App 审批中心                            分支 approval-center （依赖 Phase D 的 grant owner）
Phase G  故障注入与灰度
```

注意执行顺序与计划 §3 的字母序不同：**D 先于 C**，因为 G3-2/G3-4 已通过而 G3-3 未起草。这不是跳阶段，是按 Gate 实际状态排程。

开始前输出：`M3 / 当前 Phase / Gate 状态 / 基线 / 分支 / 非目标`。

### M3 禁区（计划 §6，违反即停止）

- 不把 secret、executor、MCP client 存进 Snapshot／event／log；Snapshot 只存 opaque ref + fingerprint。
- **不把 `PermissionSaved.always` 改名冒充 once/Session/Location grant。** 它是既有 Project 语义，改名即静默迁义。
- 不新建第二个 Tool registry / executor / permission engine。ToolRegistry 仍是唯一执行入口，leaf Permission assert 仍是最终授权边界。
- **不重新引入进程级「最后注册者胜」。** M2 已把 `TaskDriver` 从进程级注册栈改成 `Context.Reference`（见 §4.1），registration scope 必须沿用 owner Scope 模型。
- 不让 cleanup 只依赖手工 Map 删除而无 owner Scope。
- `ask` 在 unattended/headless 状态不得无限等待，也不得默认 allow。
- 不开放 Plugin runtime（M4）、Code Presentation（M5）、external CLI、judge。
- 应用级审批入口只聚合 pending request，**不成为「应用级永久 allow」**。

## 4. 已确认的架构事实

以下事实来自 `main@8c8c2b69e` 的五层代码、测试与复审报告，并经独立事实核查落到 `file:line`（§4.0/§4.3/§4.5 已按 R6 整改、Phase A/B 结论与 attended 裁定校准）。**[M3 计划 §0](custom-mode-m3-mcp-approval.md) 是完整版，开工必读**；本节只列会直接约束你设计的部分。若最新 main 已改变，必须用代码/测试证据更新计划后再施工，不能静默偏离。

### 4.0 先记住这六条反直觉事实（否则你会照着不存在的东西写代码）

1. **产品今天完全不连接任何 MCP server。** 生产装配是 `McpV2.noopLayer`，`McpV2.Service` 零消费方；`packages/aigcfroge/src/mcp/v2-bridge.ts` 是**死代码**（全仓唯一引用是自己的 barrel 行）。M3 不是「重构现有 bridge」，是写第一个能跑的实现。
2. **但 V1 MCP 在跑，而且已有 HTTP 面。** `packages/aigcfroge/src/mcp/index.ts`（979 行）按 instance 目录 scope，`/mcp/*` 端点已在服役。**先裁决收敛还是并存**，别默认它不存在。
3. **另有一整套 Location-scoped 的 MCP 资产子系统在服役**（`core/src/mcp-asset*.ts`），其 `configJson` 是不解码的 opaque 串。写入面加固要从这里开始，别新造。
4. **`ToolRegistry.register` 本来就是运行时动态 + Scope 清理 + 冲突 last-wins。** 缺的是 identity/placement 契约，不是机制。而 **registration fingerprint 是新概念**——fingerprint 今天只在 resolver/schema，registry 内 0 命中。
5. **凭据是明文、全局、双 owner。** `text({mode:"json"})` 逐字写入，无加密；表无任何 scope 列；`auth.json`/`mcp-auth.json` 绕开 Credential service。「唯一 secret owner」「跨 Location 隔离」都是待建。**Snapshot v2 也还没有任何字段能装 opaque ref。**
6. **unattended 已经 fail-closed；真正挂起的是「有人值守但没客户端」。** `ask` 的 `Deferred.await` 无 timeout，只能等 Location 60 分钟 idle 驱逐。而 **V2 的 pending/reply 端点与 `permission.v2.*` 事件都已存在**——缺的是客户端（app/tui/session-ui/ui 对 `permission.v2` 零消费）。

### 4.1 M0-M2 已交付接缝（首要复用候选，禁止重建）

- `packages/core/src/session/composition.ts` `SessionComposition`：attach/get/read/copy/`assertDependency`/`assertAgentAllowed` 的唯一 owner；typed mismatch 错误。M3 的 MCP 运行依赖检查走同一 owner，不建第二组合服务。
- `packages/core/src/composition-resolver.ts`：resolve/freeze、per-tool fingerprint + catalogDigest、typed diagnostics、consumer 目录冻结。M3 的 MCP 解析走 versioned decoder/strategy owner 扩展，不散落 `if version >= N`。
- `packages/schema/src/composition.ts` Snapshot v2：consumer-scoped bindings，key 只接受 `orchestrator` 或 `agents/<agent>`（正则约束，非法 key 解码即失败）。**MCP binding 若要 per-consumer，必须复用这套 consumer 语法，不要发明第二套 scope 字符串。**
- `ToolRegistry.materialize(permissions?, intent?, { allowlist? })` + provider-turn 前置 fingerprint/catalogDigest 重验（fail-closed via `SessionRunner.SnapshotDriftError`）。M3 的 registration fingerprint 必须接入同一重验点，而不是新开一次检查。
- `packages/core/src/tool/task-driver.ts` `TaskDriver.Runtime`：**M2 删除了进程级注册栈**，改为 `Context.Reference` + 私有 `RuntimeState`，`active()` 只解析当前 Context，缺失即 `Effect.die` fail closed。这是 M3 registration scope 的范式：**scope 由调用方 Context/owner Scope 决定，不由进程全局最后写入者决定**。
- `packages/core/src/product-mode-policy.ts`：creation/runtime/capability/event filter 唯一 policy owner。`assertRuntimeSupported("custom")` 在 `AIGCFROGE_CUSTOM_MODE` 关闭时失败，`SessionV2.create`（含 TaskDriver 派生的 child）、prompt、shell、skill、switchAgent、switchModel 全部 fail closed。M3 新端点必须接入同一 flag 与 capability 头检查。
- `packages/core/src/workflow/` M2 的 durable owner 模式（`WorkflowRun` 唯一 CAS 写入者 + `EventV2.publish(..., { commit })` 同事务 + revision CAS）：**ScopedGrant store 应当照抄这套模式**，而不是发明新的一致性方案。
- `packages/core/src/credential-scanner.ts`：M2 在 `<workflow_result>` handoff 上的调用点证明了「先扫描后裁剪」的正确顺序（先裁剪会让跨切点的凭据只剩不足以匹配的前缀）。M3 的 credential 日志脱敏沿用同一 owner 与顺序。
- **Phase B 新增接缝（已合入，Phase D 必须复用而非绕开）**：
  - `ToolRegistry` 的 placement 维度：注册携带可选 `sessionID`；`materialize({ sessionID? })` 过滤 Location∪本 Session；**返回的 `Materialization` 绑定该 placement**，settle 用捕获值解析赢家而非调用方的 `input.sessionID`，Session 物化被别的 Session settle 即 placement mismatch fail closed（ADR-19 条件 C1）。**Phase D 若给 grant 咨询加 session 维度，用同一个 placement 概念，不要发明第二套「当前会话」判据。**
  - `registeredNames(sessionID?)`：按 placement 求值的占用域。Location 注册与全部占用名冲突，Session 注册不与兄弟 Session 冲突。
  - `McpRegistration`（`core/src/tool/mcp-registration.ts`）：`mcp_<server>_<tool>` 命名空间 + 全或无 + typed `McpNameCollisionError`/`InvalidServerNameError`/`McpToolNameTooLongError`。**它今天只有测试消费方**——Phase C 的 connection owner 才是首个生产消费者。
  - 守卫：`tool-registry-stale.test.ts`（四相位 stale rejection Law）、`tool-registry-placement.test.ts`、`tool-mcp-registration.test.ts`、`aigcfroge/test/session/v1-canonical-registry-boundary.test.ts`（V1/canonical 边界 source contract）。**这四个文件变红都不是「测试要改」。**
- **Phase A 契约（已合入）**：`packages/schema/src/mcp-scope.ts` —— `McpServerBinding` / `GrantScope` / `ScopedGrant` / `McpConnectionHealth`，17 例正负用例。**`ScopedGrant.effect` 已被 Schema 钉死为 `Literal("allow")`**（ADR-20 §2.2：deny 是 policy ruleset 的领地，grant 永远不能表达拒绝）。Phase D 的 store 与咨询实现**以这份 schema 为编码真源**，不要在 core 里另立一套 grant 形状。
- 测试装配：实例 HttpApi 测试走 `HttpApiApp.routes` 真实装配；`packages/core/test/lib/product-mode.ts` `withCustomModeEnabled()`；exerciser 覆盖门禁（`--mode coverage/auth --fail-on-missing --fail-on-skip`）。

### 4.2 M0-M2 固定裁决（M3 不得推翻）

- Custom 一律 V2-native；服务端 re-freeze，Session+Snapshot 原子事务；exact retry 幂等，digest 不同即 conflict。
- Snapshot bytes/digest 写入后不可 update；运行中不采用最新资产，升级只能 fork/new Session。
- allowlist 不只写进 Prompt；task 与 child create 双层强制。
- 运行依赖检查经 `SessionComposition` 单点，不在 handler/App 复制。
- 旧客户端不得看到/解码 Custom 为 Coding；capability 矩阵在 M3 全部新端点上继续保持。
- 运行状态只进 DB，不回写 Profile/资产文件，不在 Profile/Task/Session 三处复制再靠事件猜测同步。
- UI 只投影服务端状态；不在客户端推演授权、frontier 或成功语义。

### 4.3 Gate 现状：三过一缺（Phase D 直接依赖前三条的定案，不得重新讨论）

- **G3-1 Registration ADR — 已通过**（[ADR-19](../architecture/adr/ADR-19-mcp-scoped-registration.md) Accepted v1.0）。placement 语法、owner Scope 清理、collision fail-closed、命名空间、fingerprint 复用 Snapshot 四字段、隔离矩阵五条均已定案，条件 C1（definitions ≡ captured settle）与 C2（引用不实）已闭合。
- **G3-2 Grant ADR — 已通过**（[ADR-20](../architecture/adr/ADR-20-scoped-grant-model.md) Accepted v1.2）。**Phase D 的全部关键决策都在这里，逐条照做，不要重新设计**：
  - §2.1 新增独立 `ScopedGrant` owner，`PermissionSaved` 保持既有 Project 语义**原样**（不改名、不迁义、不新增列——停止条件红线）。二者并存且互不读写。
  - §2.2 deny 恒胜出；grant 只存 allow（Schema 已钉死 `Literal("allow")`）。咨询顺序固定：`configured → effectiveV2 → evaluate` 先行，deny 直接拒（不查 grants），allow 直接放行（不查 grants），**仅 `ask` 才查候选 grant**。leaf `permission.assert` 仍是最终授权边界。
  - §2.3 scope 语法 `{once} | {session, sessionID} | {location}` + 可选 agent/revision 收窄；expiry/revocation 每次实时读 store，无缓存副本。
  - §2.4 store 照抄 `WorkflowRun` durable owner：SQLite 新表 `scoped_grant`、**唯一 CAS 写入者**、状态变更写入 `EventV2.publish(..., { commit })` 的 commit 回调与事件行同事务、revision 不匹配抛 typed error、**0 行更新必须抛错**。durable 事件族 `grant.updated`。**不发明第二套一致性方案。**
  - §2.5 grant 与 Snapshot audit digest 永不互为真源。
  - §2.6 天花板：unattended 只读白名单（已落地）+ **attended 重写为 `ask`**（本 Phase 落地，见 §4.5-1）。
  - §2.7 ask 超时 `ASK_TTL_MS` 默认 300,000ms（config 可调，须 > 0 且 ≤ Location idle TTL 60 分钟）+ **无应答方即时拒绝**（见 §0.1）。
  - §2.8 审批中心边界：入口必须带 `product-mode-custom-v1` 能力头；**不存在应用级永久 allow**；浏览器侧既有的 auto-accept 存储不是服务端 grant，禁止混入本模型。
- **G3-4 Unattended — 已通过**，三项由 ADR-20 回答：① ask 超时 = §2.7；② 尾部 allow 绕过 clamp = §2.6；③ 审批中心能力头 = §2.8。
- **G3-3 Credential — 未起草，阻塞 Phase C**。secret owner、opaque ref 形态、rotation/revocation、日志脱敏、跨 Location ref 拒绝全部待建。**Phase D 不碰凭证**；若 grant 设计出现「需要存 secret」的诉求，那是设计错了——grant 存授权事实，不存凭据。
- 定案结果同步 `specs/v2/schema-changelog.md`。**文档改写不得丢失已定案内容**（含 M1 的 `session.next.*` 事件清单与 kill-switch 语义、M2 的 ADR-18 §2.2 状态机与 §2.7 五端点契约、Phase A/B 两条 changelog 条目）——只允许追加/更新状态；diff 中删除已有定案段落必须显式说明理由。

### 4.4 M4/M5 硬缺口（M3 不得提前实现）

- Plugin Asset 不是 Installed Extension；缺 provenance/trust/pinned revision/staged rollback/quarantine（M4）。
- Code Presentation 必须使用成熟隔离引擎并证明 Native/Code 等价（M5）。

### 4.5 M2 遗留前置项（M3 必须吸收，来源 technical-debt §3.1）

这三条是 M2 复审登记、**明确划给 M3** 的：

1. **Agent 资产可自授权限（unattended 半边已修，attended 半边是本 Phase 的核心任务）。** 机制：允许清单以 author 可控的 `name` 为身份，但真正生效的权限来自全局 `AgentV2` 注册表——资产 frontmatter 的 `config.permissions` 可写 `{action:"*",resource:"*",effect:"allow"}`，而 `permission.ts` 的 `evaluate` 用 `findLast`，尾部通配 allow 胜出。

   **已修（2026-08-23，R6-1/R6-2，合并提交 `b9c6d1077`，不要重做）**：unattended custom 现在过 deny-first 只读白名单天花板——白名单固定 `glob | grep | list_assets | read`，未收录 action（含未来新工具）默认 deny；base 的显式非通配 deny 保留并排在白名单 allow **之后**（`evaluate` 是 `findLast`，位序即语义）。**白名单成员是已裁定项**：`skill` / `kb_search` / `question` 不纳入（三者都不是纯只读：`skill` 注入内容改变模型行为、`kb_search` 是外部内容入口、`question` 在无人值守下无人可答）。需要时走 **grant 签发**而非放宽天花板——天花板管「资产作者能否自己预授权」，grant 管「用户能否显式授权一次」，授权主体不同不可互替。任何成员变更须重新过 Security 复审并同步 `permission-effective.test.ts` 的范围界定测试。

   **仍开放，且是本 Phase 的核心任务（attended 半边）**：天花板只在 `attended === false` 启动（`effective.ts:92` 的 `if (!attended)`），所以 attended custom 会话里 `bash`/`edit`/`write` 判定为 `allow`，而**审批框只在判定为 `ask` 时才弹** —— 直接 allow 意味着框根本不出现，「用户在场 ≠ 用户同意」。实测同一 allow-all 资产：`attended=false → 全 deny`，`attended=true → 全 allow`。

   **2026-08-23 产品裁定：重写目标是 `ask`，不是 `deny`。** 理由：缺陷本质是框不弹；压成 deny 会连带废掉合法的写文件类 custom agent，而用户明明在场却没有任何放行途径。与 2026-08-16 对 meta 的既有裁决同型（非 coding 模式下 `bash`/`edit`/`write` 走 ask，非 deny 非 allow），保持权限模型一致。落地要点：

   1. 生效位序：头部 fallback deny → **非白名单的资产来源 allow 重写为 ask** → 白名单 allow → 显式非通配 deny。`evaluate` 是 `findLast`，**位序即语义**——这正是 R6-1 踩过的坑（重建规则时把 base 的 `{read,.env,deny}` 丢了，导致 custom 在显式 deny 上弱于其它所有模式）。
   2. **必须区分「base 来源」与「saved 追加来源」**：用户真实点过 always 的 saved approval 不受天花板影响。搞混就是把用户自己的显式授权一起削掉——从修安全问题变成砸用户功能。
   3. 与 grant 天然衔接：ask 命中 grant 即免问，用户答一次签一张 once/Session/Location grant。**这是天花板与 grant 必须同一 Phase 的原因**（同一处代码，不单开 slice）。
   4. **`ask` 无人可答的时序约束见 §0.1——这条不做，整改就是可用性事故。**
   5. 加 provenance 校验：注册表名为 X 的条目须来自被绑定资产的 `relativePath`+`revision`，不一致 fail closed。堵的是同名碰撞变体（与内置 agent 同名如 `build` 使资产被 `asset-bridge` 丢弃、内置 allow-all ruleset 生效，而 Plan/Snapshot 仍显示已绑定资产且能力标 denied——显示与实际不符）。
   6. **连带交付**「资产导入/apply 警示通配 allow」（technical-debt §3.1 第二行，缓解措施成本低）：上一项最真实的触发路径不是作者粗心，而是**导入别人的资产夹带 allow-all**；仓库已有导入/分享链路（Chat M7 create/import loop），导入时零提示。在 `propose`/`apply` 解码 `config.permissions` 之后，若含通配 allow 或 `DANGEROUS_ACTIONS` allow，于 diff 预览与 apply 结果显式标注（**不阻断，只揭示**）。注意 `agent-asset.ts` 目前把 `config` 当字符串原样存（`config: frontmatter.config || ""`），警示须在 `parseAgentAssetConfig` 解码后做。
2. **Custom kill switch 无「关闭即中断在飞 child」的进程内通知。** 现状只保证「不再派发新工作」。M3 引入外部连接后，运营关闭开关必须同时能停掉 MCP 连接与 pending request；Registration ADR 需要定义 disable 通知与 owner Scope 的关系。
3. **`MAX_STEPS` 等图不变量不在解码期与资产写入期强制**（ADR-18 §2.5.3 写「解析期拒绝」而代码在 freeze 期）。M3 若给 MCP 资产加写入面，**不要复制这个错误**：解码期就要有上界与结构校验。注意 **MCP 资产已经踩了同一个坑**——`configJson` 是不解码的 ≤100000 字节 opaque 串。

### 4.6 已确认并修复的 M2 P0（不要重做，但要知道它存在）

每轮 provider turn 都调 `ProductModeAgentPolicy.enforcePrimary(session.mode, session.agent)`，**无 parent/child 豁免**，而 `checkPrimaryAgent("custom", agent)` **只允许 `"meta"`**，否则 `Effect.die(AgentNotAllowedError)`。但 custom 的 child 本来就该拿非 meta 的 agent——`resolveAgent` 的 `parent && parentSnapshot` 分支在 `assertAgentAllowed` 后直接返回 `input.agent`，绕过了 create 期的 `enforcePrimary`，测试也断言了 `agent: "custom-coder"` + `mode: "custom"` 的 child 能建成。而 M2 的 workflow child 走的正是同一个 runner。

**已于 2026-08-23 证实为死路并修复（合并提交 `b9c6d1077`，不要重做）。** 修法是把每轮门禁的豁免**收窄**到 `session.mode === "custom" && session.parentID !== undefined`——依据是 custom 独有的双门禁（create 期 `assertAgentAllowed` + 派发期 allowlist）；其它模式的 child 保留每轮门禁，因为它们没有替代门禁可举证。已核实这不引入新断路：非 custom 的 child 在 `resolveAgent` 的 create 期本来就走 `enforcePrimary`，chat/work/assistant 只委派给自己的 orchestrator（policy 允许），coding 分支对普通 agent 本来放行——收窄后的每轮判定与 create 期一致。

**这条给你的教训比结论重要**：R1–R5 五轮复审 + 全套门禁（typecheck / 单测 / lint / exerciser / e2e）全绿的情况下，M2 带着「多 Agent 委派在真实 Provider 上跑不起来」这个 P0 合并进了 main。原因只有一个——**没有任何测试驱动一个真实的 provider turn**。

**这个教训在 Phase D 的等价形态**：不许只测 `ScopedGrantStore` 的增删查，也不许只测 `PermissionEffective.compute` 这个纯函数。**必须有一条测试走完整链路**：一次真实的 `permission.assert` 判定为 `ask` → 查到候选 grant → 免问放行 → 消费 once grant → **同一 grant 第二次调用必须失败**。同理，attended 天花板必须有一条测试证明「资产声明 allow-all 的 attended custom 会话，`bash` 真的走到了 ask 分支」，而不是只断言 `compute()` 的返回值形状。Phase B 复审也踩过一次同型问题：一条名为「reveals the previously registered tool」的测试用了两个无法区分的处理器，关闭 overlay 前后断言字面完全相同，证明的是「还在」而不是「露出了前一个赢家」——**测试名声称什么，断言就必须真的观察到什么。**

M3 硬性非目标：Plugin runtime（M4）、Code Presentation（M5）、external CLI、judge、Workflow 语义改造。

## 5. 工作拆解

读取 M3 计划的每个 Phase，拆成最小 vertical slices。每个 slice 开始前建立：

### 5.1 Reuse table

```text
candidate | definition | callers/tests | compatibility | decision | rejection reason
```

必须查询 owner、调用方、注册路径、近邻测试与相关 Git 历史。符号/调用链优先 codegraph MCP（`search`/`node`/`callers`/`callees`/`impact` 无预算限；`explore` 限 2 次）；字符串/flag/i18n/path 用 `rg`。

新增前遵循：**复用 -> 删除 -> 归并 -> 重构 -> 新增**。禁止复制 Session、ModeWorkspace、ToolRegistry、Permission、Agent registry、asset transaction、Workflow state 或 Plugin lifecycle owner。§4.1 的接缝是首要复用候选。

### 5.2 验收映射

```text
acceptance | layer | red test | expected failure | green evidence | final gate
```

覆盖 success、invalid、boundary、authorization、concurrency、interruption、idempotency、migration、old-client、reload/recovery、UI error/empty/loading。

**安全测试必须成对覆盖「模型看到定义」和「settle 真执行」**——只测 permission assert 或只测 UI 隐藏均不合格（M3 计划 §4）。

### 5.3 Phase A / Phase B 交付物（已完成，仅供追溯）

**Phase A**（分支 `mcp-scope-adr`，合入 `7a2804624`）：调研报告（`custom-mode-m3-phase-a-research.md`）、ADR-19、ADR-20、`packages/schema/src/mcp-scope.ts` + 17 例正负用例、§4.6 那条红测试（非 meta custom child 跑真实 provider turn，已证实为死路并修复）。

**Phase B**（分支 `mcp-registration`，合入 `99dce8906`）：placement 维度 + `McpRegistration` owner + 四个守卫测试文件。复审整改了两项 P1（占用检查 placement-盲导致兄弟会话无法绑同一 server；settle 与 definitions 的 placement 未绑定，违反条件 C1）与一项测试证据缺陷。**两条刻意留给后续的项已登记 technical-debt §3.2**：canonical 名的 64 字符共享预算无截断策略（Phase C 输入）、`ApplicationTools` 进程全局导致冲突域不是 Location-scoped。

### 5.4 Phase D 详细范围（当前任务）与 C/E/F/G 概览（详见 M3 计划 §3）

**Phase D** `scoped-grants` —— 建议的 slice 切法（每个 slice 独立红绿，不要一把梭）：

1. **`ScopedGrantStore` + 迁移**：SQLite `scoped_grant` 表（snake_case 全维度 + revision + `issued_at`/`expires_at`/`revoked_at`/`consumed_at`），唯一 CAS 写入者，`EventV2.publish(..., { commit })` 同事务，`grant.updated` durable 事件族。红：once 消费一次（并发单赢者）、Session 不跨 Session、Location 不跨 Location、agent/revision mismatch、expiry/revocation 立即生效、revision 不匹配抛 typed error、**0 行更新必须抛错**。迁移测试 clean + existing + rerun。
2. **`PermissionEffective` 注入 grants 输入**：咨询顺序 deny 直接拒 / allow 直接放行 / **仅 `ask` 查 grant**。红：deny 恒胜出（grant 不能翻 deny）、saved `always` 不被静默迁义（`PermissionSaved` 四字段与表唯一键一字未改）、grant 命中免问、未命中保持 ask。
3. **ask TTL + 无应答方即时拒绝**（ADR-20 §2.7）：`expiresAt` 契约、到期 typed `AskExpiredError` 自动 reject 并发布 replied 事件、**无能应答订阅方即时 reject**。红：无订阅方时**不进入等待**（不许用 `Effect.sleep` 测，用 Deferred/就绪信号）、TTL 到期自动 reject、TTL 配置边界（> 0 且 ≤ 60 分钟）。
4. **attended 天花板重写为 ask + provenance 校验**（§4.5-1）：与 slice 3 **同一交付单元**，不得分开合。红：allow-all 资产在 attended custom 下 `bash` → ask（并真的走到 ask 分支）、白名单 action 仍 allow、base 显式非通配 deny 仍 deny 且位序正确、**saved 追加来源不被削**、unattended 行为一字不变（用 custom/coding 配对断言防再分叉）、provenance 不一致 fail closed。
5. **资产导入/apply 通配 allow 警示**（不阻断，只揭示）：在 `propose`/`apply` 解码后标注，diff 预览与 apply 结果都要有。

不在 Phase D：任何 MCP 连接/transport/凭证代码（Phase C）、审批中心 UI 与端点（Phase F）、Snapshot version 扩展（Phase E）。

- **Phase C**（待 G3-3）：stdio/remote/OAuth connect；invalid URL/command/config；credential missing/expired/revoked；disconnect/reconnect/timeout/process interruption；secret redaction；跨 Location ref 拒绝。health = `connecting|ready|degraded|offline|auth-required|revoked`。**首个消费 `McpRegistration` 的生产实体**，须验 Layer ordering 无环（不能形成 `PluginBoot -> Tools -> PluginBoot`），并补 ADR-19 §2.7 矩阵 #1/#4 的连接期集成断言与 technical-debt §3.2 的命名截断策略。
- **Phase E** `mcp-composition`：只有 Profile 显式绑定的 MCP 被解析；Plan 显示 requested/effective/denied + credential/health；start re-freeze；运行中定义变化不改 Snapshot；新 provider turn fingerprint mismatch 阻断；撤销后新调用失败。**先评估能否用 V2 内可选字段承载，而不是急着开 v3**（union 只有 V1|V2，无 v1→v2 升级，未知版本硬失败，消费方各自 `switch version`，v3 = 每站点加第三分支）。
- **Phase F** `approval-center`：pending 聚合、once/Session/Location 明示、revoke、无页面连接、Builder health/diagnostics；薄 endpoints + SDK 重新生成；desktop/narrow/keyboard/i18n（en/zh/zht 三语 parity）。入口不自动扩大 scope。**重心是 L4 与 V1/V2 双轨收敛，不是再造端点**——V2 pending/reply 端点与 `permission.v2.*` 事件都已存在并挂载。
- **Phase G**：server crash、network partition、OAuth expiry、credential revoke、grant expiry、Session close、Location unload、name collision、tool schema change；验证撤销后新调用立即失败、已开始调用按 ADR 明确结束/中断策略、无页面连接时请求不会无限挂起。

## 6. 每个 slice 强制 TDD 循环

```text
1. 精读当前 slice 的计划、owner、调用方、近邻测试、协议和 Git 历史
2. 写 reuse table 与验收映射
3. 红：先写最小测试，实际运行并确认因目标行为缺失而失败
4. 绿：写最小生产实现使红测试通过，不扩张当前 slice
5. 重构：去重、收敛错误/Layer/状态/分支，保持 focused tests 绿
6. 检查 focused diff 与五层数据流
7. 执行 CLAUDE.md「改完即审」七项并输出复查结论
8. 重读 CLAUDE.md、相关 AGENTS/skill 和当前计划小节
9. 运行 focused test + 受影响包 test/typecheck + incremental lint + diff check
10. 全绿后才进入下一 slice；失败则根因收敛并停止范围扩张
```

红测试必须真实失败，不能只写完不跑。**不得用源码字符串断言替代行为测试**（仅明确的 owner/source-contract 测试除外，且测试名不得声称它渲染或执行了什么——M2 有一个名为「renders the complete runtime state surface」却从未 import 组件的用例，已被复审判为假测试）。不对无关文件做机械格式化；diff 中每个 hunk 必须能映射到本 slice 的语义变更。

### 6.1 Effect/Schema/DB 红线

- `Effect.gen(function* () {})`；公开效果用 `Effect.fn("Domain.method")`。
- expected failure 用 `Schema.TaggedErrorClass` + `yield* new Error(...)`；不以 `Effect.die` 表达业务拒绝（`Effect.die` 只用于编程错误，如 owner Scope 缺失）。
- 不 `catchCause` 吞 interruption/defect；外部文件/网络/SDK/JSON callback 边界必须 Catch Everything。
- 不用 `Effect.fork`/`forkDaemon`；用 owner Scope / `Effect.forkIn(scope)`。
- 不用 `Effect.sleep(N)`/`setTimeout` 做并发同步；用 Deferred/Latch/readiness signals。
- 多字段 contract 用 `Schema.Class` + `new X(...)`；single ID/digest/revision 用 brand。
- DB 列 snake_case；迁移走 generator/index 管线，测试 clean + existing + rerun。**迁移里不要建随后就会被删掉的索引，也不要在回填时把「当前值」写进历史行**——M2 两者都踩过（前者会让 `DatabaseMigration.apply` 在真实数据上失败进而 `orDie` 让应用起不来）。
- 状态转换全部带 `expectedRevision` CAS；0 行结果必须抛，不得静默返回。

### 6.2 Tool/Permission/MCP 红线

- Tool definition filtering 不是授权；leaf Permission assert 仍是最终边界。
- definitions 与 captured settle 必须来自同一 effective registrations。
- **每条注册/连接路径必须有 owner Scope 负责清理**，不留孤儿 server/registration/pending request。这是 ADR-18 §2.2「每个已派发单元必须显式 settle」的同构要求；M2 的教训是清扫语句漏掉中间态（`dispatching`/`cancelling`）就会留下永久孤儿。
- 事件 payload、DB row、返回 Info 必须一致；日志只记稳定分类/digest，**不记完整 prompt/output/secret/path/Authorization**。
- 外部输入（MCP tool 名、schema、server 响应）进入 Record 查找前必须 `Object.hasOwn` 或经 Schema 解码——不要让 `constructor`/`__proto__` 经原型链解析出一个「有效」值（M2 的 `branchTarget` 踩过）。
- 取消/撤销后已在飞的调用按 ADR 明确策略结束；不得默默继续。

### 6.3 UI 红线

- 复用 ModeRoute/ModeWorkspace/typed slots/side panel/Location owner；新 UI 用 shared v2 components/tokens、现有 icon library、i18n、a11y。
- 不硬编码颜色/间距/圆角（用 `--v2-*` token）；**所有用户可见文案走 i18n 并保证 en/zh/zht 三语 parity**，图标按钮必须有存在的 `aria-label` key（M2 有 3 个按钮引用了三语都不存在的 key，`aria-label` 直接不渲染）。
- 动作可用性必须与服务端守卫一致：不要渲染一个服务端一律 409/403 的按钮。
- 覆盖 desktop/narrow、light/dark、keyboard/focus、empty/loading/error、三语 overflow。

### 6.4 报告真实性红线（违反即交付拒绝）

- 完成/复查报告中每个测试数字必须可复制粘贴自真实命令输出；顾问会独立复跑，**虚报（含把红报绿）一律 REJECT**。
- 负载敏感失败必须如实标注并给出空载单跑证据，不得写成「已全绿」。已知负载敏感文件见 technical-debt §3.1。
- 不得在生产模块引入全局可变测试 seam。
- 文档改写只允许追加或状态更新；删除既有定案段落必须显式说明理由。

## 7. 每个 slice 的复查结论

```text
复查结论:
- M / Phase / slice / 基线 / 分支:
- 影响文件:
- 五层数据流:
- reuse table 摘要:
- 保留的 owner 与不变量:
- Gate 状态(G3-1 至 G3-4，含「未批准」):
- Catch Everything / No Null Pointer / Security First:
- No Cheating / Reusability / Clean Logs:
- 红测试失败证据:
- 绿测试与重构证据:
- 已运行命令:
- 剩余风险:
- 下一 slice / 是否触发停止条件:
```

「声明风险」不能代替修复或 Gate。发现多个同类失败时按 CLAUDE.md 根因收敛，不逐文件打补丁。

## 8. 常用验证命令

只选当前 slice 受影响的命令；最终门禁按 M3 计划 §5 全量执行：

```bash
# Schema
bun --cwd packages/schema test --timeout 30000
bun --cwd packages/schema typecheck

# Core（含 migration clean/existing/rerun 证据）
bun --cwd packages/core test path/to/focused.test.ts --timeout 30000
env -u AIGCFROGE_CUSTOM_MODE bun --cwd packages/core test path/to/focused.test.ts --timeout 30000
bun --cwd packages/core test --timeout 30000
bun --cwd packages/core typecheck
bun --cwd packages/core run script/migration.ts --check

# HTTP/server（含 coverage+auth exerciser 门禁）
bun --cwd packages/aigcfroge test path/to/focused.test.ts --timeout 30000
cd packages/aigcfroge && bun run script/httpapi-exercise.ts --mode coverage --fail-on-missing --fail-on-skip
cd packages/aigcfroge && bun run script/httpapi-exercise.ts --mode auth --fail-on-missing --fail-on-skip
bun --cwd packages/aigcfroge typecheck

# SDK（重新生成并审查真实 diff）
bun ./packages/sdk/js/script/build.ts
bun --cwd packages/sdk/js typecheck

# App/UI
bun --cwd packages/app test --timeout 30000
bun --cwd packages/app typecheck
bun --cwd packages/app test:e2e e2e/regression/<spec>.spec.ts

# Protocol/delivery
bash .aigcfroge/skills/protocols/scripts/check-refs.sh
bun run script/lint-changed.ts
git diff --check
```

跨包 Phase 完成或合并前再运行 `bun turbo typecheck` 与 `bun run lint`。不要运行根 `bun test`。SDK/migration/schema/generated output 必须通过仓库脚本生成并审查真实 diff，不手改生成结果隐藏漂移。

已知：`packages/storybook` 构建当前 OOM（分支既有，technical-debt §3.1），视觉截图门禁取不到——如实标注，不要伪造。

## 9. 停止与交付

**Phase D 完成后（你的停机点）：**

1. 运行 §8 里 Core/Schema 受影响门禁 + protocol refs + incremental lint + diff check；**迁移必须给 clean / existing / rerun 三份证据**；跨包改动再跑 `bun turbo typecheck` 与 `bun run lint`。**core 全量基线 2073 pass / 2 skip / 0 fail**，低于此数即回归。
2. 以下守卫必须全程绿，**变红都不是「测试要改」**：
   - `packages/core/test/tool-registry-stale.test.ts`（stale rejection Law 四相位）
   - `packages/core/test/tool-registry-placement.test.ts`（placement 与 C1 绑定）
   - `packages/core/test/permission-effective.test.ts`（含 R6 整改块与 custom/coding 配对断言——它变红说明你把 unattended 半边一起改了）
3. 输出 Phase D 报告，必须包含：
   - grant 五个维度（once/session/location/agent/revision）各自的隔离测试名与实跑输出；
   - **once grant「第二次调用失败」的实跑输出**（不是只测第一次成功）；
   - **一条完整链路证据**：真实 `permission.assert` 判定 ask → 命中 grant → 放行 → 消费 → 二次失败（见 §4.6 教训）；
   - **attended 天花板的成对证据**：allow-all 资产在 attended custom 下 `bash` 真的走到 ask 分支，且 unattended 行为一字未变（custom/coding 配对）；
   - **saved 追加来源未被削**的证据（用户点过 always 的授权仍然 allow）；
   - **无应答方即时拒绝**的证据：无订阅方时请求不进入等待（不许用 sleep 证，用 Deferred/就绪信号）；
   - 迁移三态证据 + `PermissionSaved` 四字段与表唯一键**未被改动**的 diff 证明。
4. **停机等待复审。不得自行进入 Phase C**（需 G3-3 Credential，ADR 尚未起草）**或 Phase F**（依赖本 Phase 复审通过）。
5. 未经交付批准，不 commit/push/PR。**本地 main 领先 origin/main 19 个提交**：按用户安排 M3 全部 Phase 完成后统一开一个 PR，所以 Phase D 只在本地成链，不单独开 PR。

**Phase C-G 各自 Gate 过后同理**：完成即停机等复审。**M3 全部 Phase 完成后**按 M3 计划 §5 跑完整测试矩阵，输出 M 完成报告，统一开一个 PR，不进入 M4。

```text
M completion:
- M / baseline / branch / commits:
- Gate evidence(G3-0 至 G3-4):
- Scope and non-goals:
- Reused owners(含 M0-M2 接缝):
- Five-layer changes:
- TDD slices and red/green evidence:
- Tests/typechecks/HTTP/SDK/migration/E2E/资源指标:
- Security and protocol review:
- Rollout/rollback:
- M2 遗留项闭环证据(§4.5 三项):
- Remaining risks or blocked checks:
- Proposed next M (not started):
```

## 10. 必须立即停止的情况

- G3-3 未批准却要写 credential/connection/transport 生产代码。
- `ScopedGrant` 被设计成能表达 `deny`，或 grant 能翻掉一条 policy deny。
- `PermissionSaved` 需要新增列、改名或迁义才能承载 grant。
- attended 天花板重写为 ask 却**没有**「无应答方即时拒绝」——这会让每次工具调用挂到 TTL（见 §0.1）。
- 需要放宽 unattended 天花板白名单（`glob|grep|list_assets|read`）才能让某个场景跑通——正确做法是走 grant 签发。
- 方案要求把 executor/client/secret 存入 Snapshot。
- Location/Session cleanup 只能依赖手工 Map 删除而无 owner Scope。
- `PermissionSaved.always` 被直接改名成 Session/Location grant。
- `ask` 在 unattended/headless 状态可能无限等待或默认 allow。
- 需要重新引入进程级「最后注册者胜」。
- 需要创建第二个 Session/Tool/Permission/ModeWorkspace/Agent/Workflow/Plugin owner。
- 需要 Plugin runtime / Code Presentation / external CLI 才能完成基本 MCP 闭环。
- 任一 applicable test/typecheck/migration/HttpApi/SDK/lint/E2E/security check 失败。
- 只能靠 `as any`、`@ts-ignore`、任意 sleep、broad mock、吞异常、跳 hook、假测试、全局可变测试 seam 继续。
- 最新 main 与计划的关键 owner/不变量冲突（此时先修计划，不要静默偏离）。

停止报告必须包含：已读文件、代码证据、失败命令与关键输出、已尝试方案、未改/已改文件、需要哪个 owner 作何决策。不要猜接口或自行跨 Gate。

<!-- PROMPT END -->

## 使用说明

| 项 | 值 |
| --- | --- |
| 复制范围 | `<!-- PROMPT START -->` 到 `<!-- PROMPT END -->` |
| 当前安全起点 | **Phase D（ScopedGrant 与 PermissionEffective），分支 `scoped-grants`**；从最新**本地** `main`（`8c8c2b69e`）建分支 |
| 自动继续范围 | Phase D 内部 slice 全绿后自动继续；不跨 Phase。**slice 3（ask TTL + 无应答方拒绝）与 slice 4（attended 天花板）必须同一交付单元** |
| 强制停止点 | Phase D 结束（等复审）、G3-3 未批准而需要 credential/connection 范围、跨 M、测试失败、owner/协议冲突、`tool-registry-stale.test.ts` / `tool-registry-placement.test.ts` / `permission-effective.test.ts` 任一变红 |
| 分支原则 | M3 各阶段在本地依次合入 main 成链，全部完成后统一开一个 PR；不逐阶段推送 |
| 卡住时 | 输出停止报告，不绕过 Gate 或测试 |






