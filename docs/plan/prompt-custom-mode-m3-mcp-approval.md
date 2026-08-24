# Custom Mode M3 全量 TDD 执行提示词

> 对应总计划：[custom-mode-composition-platform-implementation.md](custom-mode-composition-platform-implementation.md)
> M3 计划：[custom-mode-m3-mcp-approval.md](custom-mode-m3-mcp-approval.md)
> 前置：M2 总复审 APPROVED（R5）+ R6 整改（`b9c6d1077`）；**M3 Phase A**（`7a2804624`）、**Phase B**（`99dce8906`）、**Phase D**（`38d82e2b3`）均已交付、经独立复审整改并合入本地 main——ADR-19 Accepted v1.0（C1/C2 已闭合）、ADR-20 Accepted v1.2（§2.6 两半均已 Accepted，attended 裁定为 `ask`）
> 分析基线：**本地 `main@38d82e2b3`**（2026-08-24）。**本地 main 领先 origin/main 34 个提交**：按用户安排 M3 全部 Phase 完成后统一开一个 PR，因此以**本地 main** 为基线，不要因落后 origin 而回退
> 生成日期：2026-08-22（2026-08-24 第五次校准：Phase D 已合入；新增 ADR-21 草案，任务扩为 F0 + Phase C）
> 当前开工阶段：**两个大任务合并交付** —— ① **Phase F0** 审批中心前置切片（分支 `approval-preflight`）② **Phase C** connection / credential / health（分支 `mcp-connection`，**G3-3 已于 2026-08-24 通过；前置改为 Slice 0 独立事实复核**）
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

## 0. 最重要的一条：两个任务，中间有一道硬门

**Phase A / B / D 都已合入本地 `main`，G3-1 / G3-2 / G3-4 均已通过。** 本次要交付两个任务，**顺序不可颠倒**：

```text
任务 1  Phase F0  审批中心前置切片          分支 approval-preflight   ← 立刻可开工
        ├─ Slice 1  grant 保留期与读路径
        └─ Slice 2  资产导入通配 allow 警示
────────── 硬门：Slice 0 独立事实复核（G3-3 已通过）──────────
任务 2  Phase C   connection / credential / health   分支 mcp-connection
        ├─ Slice 0  ADR-21 独立事实复核（先做，见 §0.3）
        ├─ Slice 1  typed MCPConnection owner + stdio
        ├─ Slice 2  credential binding + 跨 Location 拒绝
        ├─ Slice 3  remote / OAuth + health 状态机
        └─ Slice 4  disconnect / reconnect / drift
```

**任务 1 与任务 2 不得混在同一分支、同一提交。** 任务 1 完成 → 停机报告 → 复审通过并合入 main → 才从新 main 开任务 2 的分支。

### 0.1 关于那道硬门：ADR-21 是**草案**，不是批准

[ADR-21 MCP Credential Custody](../architecture/adr/ADR-21-mcp-credential-custody.md) 已 **Accepted for M3 Phase C implementation v1.0**（2026-08-24 人类裁定 §2.5：静态加密排除在 M3 之外，只做两项止血）。**G3-3 已通过，Phase C 解锁。** 但它带一条不可分割的前置条件：

- **它由复审方起草。** 按仓库既有做法，起草方与批准方必须分离——Phase A 的 ADR-19/ADR-20 由执行方起草、复审方批准，正是这个分离抓出了「引用不实」（C2）与整个 §2.6 BLOCK（R6-1/R6-2/R6-3 三项）。所以 ADR-21 **不能由起草方自己接受**。
- **补偿控制 = Slice 0**：Phase C 的第一件事必须是 §0.3 的**独立事实复核**，把结论交给人类与复审方。它不是可选步骤，是「起草方不自批」的替代门禁。
- **Slice 0 完成并通过前，任务 2 的生产代码一行都不许写。** 你可以读代码、写复核报告、写红测试骨架，但不许写 connection / credential 的实现。
- **§2.2「必须新增 `mcp_credential_binding`」是唯一可被 Slice 0 推翻的一条**（ADR-21 §4 第 2 条）；§2.5 加密排除、§2.3 撤销不中断在飞连接、§3 L4 只做绑定、Schema 复用 `mcp-scope.ts` 均为定案，照做不改。

### 0.2 Phase F0 的两个陷阱（任务 1）

**陷阱 A —— 保留已结算行**不得**让它们重新可用。** Slice 1 要让已消费/已撤销/已过期的 grant 行留下来可查，这直接顶在授权边界上：`findValid` 必须**继续**看不到它们（今天靠 SQL `and(isNull(consumed_at), isNull(revoked_at))` + JS 侧 `isExpired`）。

**只测「已结算行还在」不算。** 必须三条成对：留存断言 + 咨询不可见断言 + `once` 二次消费仍失败。写反了就是「撤销过的授权又能用」，这是任务 1 唯一能造成越权的地方。

**陷阱 B —— 警示不能变成「每份资产都报警」。** Slice 2 的价值全在信噪比，它挡的是**导入别人的资产夹带 allow-all**，不是给每份正常资产贴标签。必须成对：夹带 `{*,*,allow}` 或危险动作 allow 的**报**，一份正常的 `tools: [read, grep]` **不报**。

并且**不要自己再抄一份危险动作清单**：`DANGEROUS_ACTIONS` 与只读白名单都在 `packages/core/src/permission/effective.ts`，是裁定过的单一真源，复制一份就是两份会漂移的清单。

### 0.3 Slice 0：ADR-21 独立事实复核（任务 2 的第一件事）

ADR-21 §1.1 列了 8 条起点事实，每条带 file:line。**逐条独立复跑，不采信转述**，并明确回答：

1. 8 条事实是否全部成立？（起草方已自查过一轮并修正了 2 处行号，但**它自己核自己不算**）
2. §1.2 三个结论是否被事实支撑？特别是结论 2「跨 Location 隔离今天结构上不可能」——`Credential` 真的在 `LocationServiceMap.dependencies` 而非 lookup 内吗？
3. §2.2 新增 `mcp_credential_binding` 是否真的必要，**还是有既有表/服务可以复用**（极致减法：复用 → 删除 → 归并 → 重构 → 新增）？特别核 `Integration` 与 `IntegrationConnection` 是否已能表达「Location × server → credential」。
4. §2.5「DB 文件无 chmod、两个 JSON 文件是 0o600」是否成立？若成立，`0o600` 补齐是否真的一行可done、有无跨平台坑（Windows 上 chmod 语义不同）？
5. **有没有 ADR-21 漏掉的绿地？** 例如：`Credential.remove` 被调用时，指向它的 binding 会不会变成悬空引用？OAuth `expires` 过期后连接 owner 该失败还是该触发 refresh，由谁负责？

**任一条事实被证伪 → 停机报告，不要在错误前提上施工。** 这正是 Phase A 复核抓出 C2 的方式。

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

1. **开工前提：Phase A / B / D 都已合入本地 main。** 先 fetch 并审计最新 main，确认 `7a2804624`（Phase A）、`99dce8906`（Phase B）、`38d82e2b3`（Phase D，含复审整改）都在 main 上；`packages/core/src/grant/store.ts`、`packages/core/src/permission/approval-presence.ts`、`packages/core/test/permission-ask-bounds.test.ts` 必须存在。**注意本地 main 领先 origin/main 34 个提交**（按用户安排，M3 全部完成后统一开一个 PR），所以以本地 main 为基线、不要因为落后 origin 而回退。若上述提交或文件缺失，说明你在另一个克隆里，停止并报告。
2. 不覆盖、回滚、清理或提交用户已有改动。若 main 有无关脏改动，先报告并隔离本任务文件；禁止 `git reset --hard`、`git checkout --`、盲目 `clean`。**已知无关在途文件：`docs/research/agent/Codex Harness 深度调研.md`（用户资料，保留原样，不要提交进本任务的 commit）。**
3. 分支策略（M3 计划 §7）：`mcp-scope-adr`（Phase A，已合入）→ `mcp-registration`（Phase B，已合入）→ `scoped-grants`（Phase D，已合入）→ **`approval-preflight`（任务 1 = Phase F0）** → **`mcp-connection`（任务 2 = Phase C，需 ADR-21 转 Accepted）** → `mcp-composition`（Phase E，待 Phase C）、`approval-center`（Phase F 本体，需产品定界面）。**任务 1 与任务 2 必须是两个独立分支、两次独立停机报告。** 分支名不超过三个短词、无 slash。M3 各阶段在本地依次合入 main 成链，**不逐阶段推送、不逐阶段开 PR**。
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
Phase A  Registration/Grant ADR 与 Schema 契约            分支 mcp-scope-adr      ✅ 已合入 main（7a2804624）
Phase B  canonical scoped registration                   分支 mcp-registration   ✅ 已合入 main（99dce8906）
Phase D  ScopedGrant 与 PermissionEffective               分支 scoped-grants      ✅ 已合入 main（38d82e2b3）
Phase F0 审批中心前置切片                                分支 approval-preflight ← 任务 1，立刻可开工
Phase C  connection、credential 与 health                 分支 mcp-connection     ← 任务 2，需 ADR-21 转 Accepted
--- 以下不得开工 ---
Phase E  Resolver/Snapshot 与运行依赖                     分支 mcp-composition   （依赖 Phase C 交付的连接实体）
Phase F  HTTP/SDK/App 审批中心本体                       分支 approval-center   （需产品定界面；F0 只做它的前置）
Phase G  故障注入与灰度
```

执行顺序与计划 §3 的字母序不同（D 先于 C，F0 先于 F 本体），因为排程按 Gate 与依赖的实际状态，不按字母。**Phase C 的 Gate 是 ADR-21，它今天还是 Proposed** —— 见 §0.1。

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

### 4.1 已交付接缝（首要复用候选，禁止重建）

- `packages/core/src/grant/` **Phase D 已交付的 grant owner**——本切片的主战场：
  - `store.ts` `ScopedGrantStore`：唯一 CAS 写入者，状态变更写在 `EventV2.publish(..., { commit })` 的 commit 回调里、与事件行同事务，`seq + 1 === grantRevision` 守卫，0 行更新抛 typed `ScopedGrant.StateError`。**照抄的是 M2 的 `WorkflowRun` durable owner 模式，不要发明第二套一致性方案。**
  - `findValid` 是**授权咨询路径**：SQL 侧过滤 `consumed_at IS NULL AND revoked_at IS NULL`，JS 侧做 `isExpired` 与通配 action/resource 匹配（通配无法下推 SQL）。**改行生命周期时这条谓词的语义必须原样保持**（§0.1）。
  - `decodeRow` / `toInfoSafe`：容错解码，缺行与坏行都返回 `undefined` 并在调用方 fiber 上记一条分类日志。**新增读路径必须走它**，不要再写一个 `rows[0]` 直解。
  - `event.ts` `grant.updated` durable 事件族（aggregate `grantID`，version 1）——它就是已结算 grant 的**账本**；这也是「清扫行不丢数据」这句话成立的依据。
  - `locationLayer` 用 `Layer.provide`（**不是** `provideMerge`）。Phase D 复审修过一次：`provideMerge` 会把 Database/EventV2 外导出，而 Location lookup 以 `Layer.fresh` 收尾，于是导出的是**第二个内存 SQLite** 并遮蔽共享实例，写读分家、9 个实例 HTTP 测试红。**新增任何 location 层一律 `provide`。**
- `packages/core/src/permission/approval-presence.ts`：应答方连接事实源，**进程级单例**（`LocationServiceMap` dependencies），两个 SSE 面各按连接 Scope `bindResponder()`。`PermissionV2` 以**硬依赖**取用（首版用 `serviceOption` 且无人提供，导致全模式 ask 静默硬拒出厂）。本切片不需要动它，但**不要把它改回可选**。
- `packages/core/src/permission/effective.ts`：`DANGEROUS_ACTIONS` 与 `READONLY_CEILING_ACTIONS` 的**单一真源**，均为裁定项。任务 2 的检测逻辑必须复用，禁止另抄一份（§0.2）。
- `packages/core/src/agent/asset-bridge.ts`：`parseAgentAssetConfig(rawConfig?)` 是把 `.agent.md` frontmatter 的 `config` 字符串解成 `ConfigAgent.Info` 的唯一入口，并回填 `originRelativePath` / `originRevision`。任务 2 的警示**必须在它解码之后**做——`agent-asset.ts` 目前把 `config` 当字符串原样存（`config: frontmatter.config || ""`）。
- `packages/core/src/agent-asset-service.ts`：`propose`（`:146`）/ `apply`（`:198`）是任务 2 的两个注入点，共用 `AgentAssetPath.validateRelativePath` 与 `FileMutation`。
- `packages/core/src/workflow/` M2 durable owner 模式；`packages/core/src/product-mode-policy.ts` 唯一 policy owner（flag + capability 头）；`packages/core/src/tool/task-driver.ts` `Context.Reference` 范式（**scope 由 Context/owner Scope 决定，不由进程全局最后写入者决定**）。
- 测试装配：实例 HttpApi 测试走 `HttpApiApp.routes` 真实装配；`packages/core/test/lib/product-mode.ts` `withCustomModeEnabled()`；迁移测试范式见 `packages/core/test/database-migration.test.ts`（新建表看 `session_composition_snapshot` 与 `scoped_grant` 两例：clean / existing / rerun 三条腿）。

### 4.2 M0-M2 固定裁决（M3 不得推翻）

- Custom 一律 V2-native；服务端 re-freeze，Session+Snapshot 原子事务；exact retry 幂等，digest 不同即 conflict。
- Snapshot bytes/digest 写入后不可 update；运行中不采用最新资产，升级只能 fork/new Session。
- allowlist 不只写进 Prompt；task 与 child create 双层强制。
- 运行依赖检查经 `SessionComposition` 单点，不在 handler/App 复制。
- 旧客户端不得看到/解码 Custom 为 Coding；capability 矩阵在 M3 全部新端点上继续保持。
- 运行状态只进 DB，不回写 Profile/资产文件，不在 Profile/Task/Session 三处复制再靠事件猜测同步。
- UI 只投影服务端状态；不在客户端推演授权、frontier 或成功语义。

### 4.3 Gate 现状：四项全过（本次不重新讨论任何已定案项）

- **G3-1 已通过**（ADR-19 Accepted v1.0），**G3-2 已通过**（ADR-20 Accepted v1.2），**G3-3 已通过**（ADR-21 Accepted v1.0，2026-08-24；**带 Slice 0 前置**），**G3-4 已通过**（三问由 ADR-20 §2.7 / §2.6 / §2.8 回答）。
- **G3-3 已通过**（[ADR-21](../architecture/adr/ADR-21-mcp-credential-custody.md) Accepted v1.0，2026-08-24）。它回答 secret owner / opaque ref / rotation-revocation / 日志脱敏 / 跨 Location 隔离五问，并**明确把静态加密排除在 M3 之外**（只做 DB 文件权限对齐与解码期秘密拒绝两项止血）。任务 2 开工前仍必须先过 §0.3 的 Slice 0 独立事实复核。
- 与本切片直接相关的已定案项，**照做不改**：
  - ADR-20 §2.2：deny 恒胜出；grant 只存 allow（Schema 钉死 `Literal("allow")`）；仅 `ask` 才查 grant。
  - ADR-20 §2.4：`scoped_grant` 单一 CAS 写入者 + 同事务事件 + 0 行必抛。**保留期改动不得破坏这三条。**
  - ADR-20 §2.5：grant 与 Snapshot audit digest 永不互为真源。
  - ADR-20 §2.8：**不存在应用级永久 allow**；浏览器侧既有 auto-accept 存储不是服务端 grant，禁止混入。
- 定案结果同步 `specs/v2/schema-changelog.md`。**只允许追加/更新状态**；删除既有定案段落必须显式说明理由。Phase A/B/D 三条条目已在其中，注意 Phase D 那条刚被复审修正过三处不实陈述——不要改回去。
- 与任务 2 直接相关的 ADR-21 已写决策，**照做不改**（除非 Slice 0 证伪）：§2.1 不新建第二个 secret owner、MCP 侧只持 opaque ref；§2.2 隔离的是「哪个 Location 被授权用哪条秘密」而非秘密本身；§2.3 撤销绑定不删 `Credential` 行、不中断在飞连接（诚实边界，**不得虚称即时生效**）；§2.4 先扫描后裁剪、scanner 不是密钥保护层；§2.6 不为「统一凭据」去改 V1 `mcp-auth.json`。

### 4.4 M4/M5 硬缺口（M3 不得提前实现）

- Plugin Asset 不是 Installed Extension；缺 provenance/trust/pinned revision/staged rollback/quarantine（M4）。
- Code Presentation 必须使用成熟隔离引擎并证明 Native/Code 等价（M5）。

### 4.5 与本切片相关的遗留项现状（来源 technical-debt §3.1 / §3.2）

- **attended custom 天花板已交付（Phase D，勿重做）**：`mode === "custom"` 下非白名单的**资产来源** allow 改判 `ask`，位序为「改判 ask 前置 → 白名单 allow → 显式非通配 deny」（`evaluate` 是 `findLast`，位序即语义）；用户点过 always 的 saved 追加来源**不受影响**；unattended 半边一字未动（custom/coding 配对断言守着）。配套的 `ApprovalPresence` 与「无应答方即时拒绝」同批交付。
  - **这对任务 2 的含义**：运行期已经会把这些 allow 改判成 `ask`，所以导入警示的作用是**导入时点的知情披露**，不是运行期防护，**更不是阻断**。文案不得暗示资产被拒绝或被修改。
  - provenance 也已落地：`AgentV2.Info` 带 `originRelativePath` / `originRevision`，每轮 custom provider turn 比对绑定资产，不一致 `SessionRunner.AgentProvenanceError` fail closed（堵同名冒名变体）。
- **本切片要清的两项（technical-debt §3.2，原触发条件写「Phase F 开工时」）**：
  1. `ScopedGrantStore.issue` 每次签发都清扫全表已结算行 → settled grant 不可查。
  2. 资产导入/apply 不警示通配 allow 声明。
- **仍开放、本切片不碰**：`MAX_STEPS` 等图不变量不在解码期强制；`timeoutSeconds` 省略即无超时；canonical 工具名 64 字符共享预算无截断策略（Phase C）；MCP 冲突域不是 Location-scoped（`ApplicationTools` 进程全局）。

### 4.6 已确认并修复的 M2 P0（不要重做，但要知道它存在）

每轮 provider turn 都调 `ProductModeAgentPolicy.enforcePrimary(session.mode, session.agent)`，**无 parent/child 豁免**，而 `checkPrimaryAgent("custom", agent)` **只允许 `"meta"`**，否则 `Effect.die(AgentNotAllowedError)`。但 custom 的 child 本来就该拿非 meta 的 agent——`resolveAgent` 的 `parent && parentSnapshot` 分支在 `assertAgentAllowed` 后直接返回 `input.agent`，绕过了 create 期的 `enforcePrimary`，测试也断言了 `agent: "custom-coder"` + `mode: "custom"` 的 child 能建成。而 M2 的 workflow child 走的正是同一个 runner。

**已于 2026-08-23 证实为死路并修复（合并提交 `b9c6d1077`，不要重做）。** 修法是把每轮门禁的豁免**收窄**到 `session.mode === "custom" && session.parentID !== undefined`——依据是 custom 独有的双门禁（create 期 `assertAgentAllowed` + 派发期 allowlist）；其它模式的 child 保留每轮门禁，因为它们没有替代门禁可举证。已核实这不引入新断路：非 custom 的 child 在 `resolveAgent` 的 create 期本来就走 `enforcePrimary`，chat/work/assistant 只委派给自己的 orchestrator（policy 允许），coding 分支对普通 agent 本来放行——收窄后的每轮判定与 create 期一致。

**这条给你的教训比结论重要**：R1–R5 五轮复审 + 全套门禁（typecheck / 单测 / lint / exerciser / e2e）全绿的情况下，M2 带着「多 Agent 委派在真实 Provider 上跑不起来」这个 P0 合并进了 main。原因只有一个——**没有任何测试驱动一个真实的 provider turn**。

**这个教训在 Phase F0 的等价形态，两条都必须遵守**：

1. **只跑 core 不算跑门禁。** Phase D 交付时报告只贴了 core 的数字（全绿），实际带着 **9 个实例 HTTP 回归**合过来——`session task` 读回 `[]`、`task is not owned by session` 的 500。根因是 `ScopedGrantStore.locationLayer` 用了 `Layer.provideMerge` 提供 Database，把第二个内存 SQLite 导出并遮蔽了共享实例；写和读落在两个库。core 单测测不到，因为它们各自直接组合 Layer。**本切片改的是同一个 store 与资产写入面，`bun --cwd packages/aigcfroge test test/server/` 必须真的跑完并贴数字。**
2. **留存断言不等于安全断言。** Slice 1 让已结算行留下来可查，但「行还在」和「行不可用」是两个独立事实。只贴前者就是把撤销过的授权重新放出来而自己看不见。§0.1 那三条必须同时给出实跑输出。

同源的既有教训（勿重犯）：M2 带着「多 Agent 委派在真实 Provider 上跑不起来」这个 P0 穿过五轮复审加全套门禁，唯一原因是没有任何测试驱动真实 provider turn；Phase B 有一条名为「reveals the previously registered tool」的测试用了两个无法区分的处理器，关闭前后断言字面完全相同，证明的是「还在」而不是「露出了前一个赢家」；Phase D 首版的 presence 用 `Effect.serviceOption` 而无人提供，测试却因为每个 harness 自己补了那层而全绿。**共同点：测试名声称什么，断言就必须真的观察到什么；harness 提供的东西，生产装配未必有。**

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

### 5.3 已交付阶段（仅供追溯，勿重做）

- **Phase A**（`7a2804624`）：调研报告、ADR-19、ADR-20、`packages/schema/src/mcp-scope.ts` + 17 例用例。
- **Phase B**（`99dce8906`）：ToolRegistry placement 维度（materialization 绑定 placement，ADR-19 条件 C1）、`registeredNames(sessionID?)` 按 placement 求值、`McpRegistration` 命名空间 + 全或无 + typed 冲突/超长错误、四个守卫测试文件。
- **Phase D**（`38d82e2b3`）：`ScopedGrantStore` durable owner + 迁移 `20260823072731_wakeful_lady_bullseye`、`PermissionV2` 仅 `ask` 时咨询 grant、ask TTL + 无应答方即时拒绝、`ApprovalPresence` 连接事实服务（进程级单例 + 两个 SSE 面绑定 + 硬依赖）、attended 天花板改判为 `ask`、provenance 校验。复审整改了两个 P0（presence 未接线致全模式 ask 硬拒；grant store 用 `provideMerge` 导出第二个 Database 实例）。

### 5.4 两个任务的详细范围

任务 1 的两个 slice 见下；任务 2 的 slice 划分见 §5.5。每个 slice 独立红绿，不要一把梭。

#### 任务 1 · Slice 1：grant 保留期与读路径

**现状与缺陷**：`issue()` 在插入新 grant 前无条件 `DELETE` 全表所有 `consumed_at`/`revoked_at` 非空与已过期行。这与 ADR-20 §2.4「durable 事件是记录源」一致、不丢数据，但两个后果：① 任何「按 grant 查历史」的读路径都查不到，审批中心要列「最近使用 / 已撤销」只能自己折叠事件流；② 它把「查一个已结算 grant」变成常规路径（Phase D 复审据此修掉了一个读路径 defect）。**破坏性清扫耦合在一次无关写入上，这是缺陷；保留多久是产品决策。**

**要做**：
1. **解耦**——把清扫从 `issue()` 里拿出来，签发不再是删除的触发点。
2. **有界保留**——已结算行保留一个**可配置窗口**（给一个文档化的默认值，并在 changelog 与 ADR-20 §2.4 注明），超窗才 prune。**不要顺便决定审批中心要展示什么**，那仍是 Phase F 的产品决策；本 slice 只保证「历史查得到、表不会无界增长」。
3. **读路径**——给 Phase F 一个 `list`/查询入口（按 session / agent / 状态 / 时间窗过滤），返回 active 与窗口内 settled，全部经 `decodeRow`。
4. **索引**——行开始留存后，`scoped_grant` 需要索引（此前靠清扫使表极小，无索引不构成问题）。走 generator/index 管线，补 clean / existing / rerun 三条腿（范式照 `database-migration.test.ts` 里 `scoped_grant` 那条）。

**红测试（至少）**：
- **§0.1 的成对断言**：已结算行在后续 `issue()` 后**仍在**；同一条行 `findValid` **查不到**；`once` 的第二次 `consume` **仍失败**。三条缺一不可。
- 撤销后立即不可咨询（ADR-20 §2.3 的「实时读 store」不得被保留期改坏）。
- prune 只删超窗行，窗口内 settled 行保留；prune 可重入。
- 新 `list` 返回 settled 行且坏行被跳过并记日志（喂一条 `asset_revision` 畸形的行）。
- CAS 与同事务事件不受影响：`consume`/`revoke` 的 0 行仍抛 typed error，`seq + 1 === grantRevision` 守卫仍在。

#### 任务 1 · Slice 2：资产导入/apply 通配 allow 警示（不阻断，只揭示）

**注入点**：`AgentAssetService.propose`（`agent-asset-service.ts:146`）与 `apply`（`:198`），在 `parseAgentAssetConfig` 解码之后。

**检测**：`config.permissions` 中含通配 allow（`action` 或 `resource` 为 `*` 且 `effect: "allow"`）或 `DANGEROUS_ACTIONS` 的 allow。**复用 `permission/effective.ts` 的清单，禁止另抄**（§0.2）。

**跨层影响面（先写 reuse table 再动手）**：`ProposeResult` 形状 → 公开 HTTP 响应 schema → **SDK 重新生成并审查真实 diff** → App 的 diff 预览与 apply 结果展示位 → **en/zh/zht 三语 parity + 图标按钮 `aria-label` key 必须真实存在**。

**红测试（成对，§0.2）**：
- 夹带 `{*,*,allow}` 的候选 → propose 与 apply 都带上诊断；
- 夹带 `bash` allow 的候选 → 报；
- 正常 `tools: [read, grep]` 的候选 → **不报**（信噪比断言，缺这条等于没做）；
- 诊断**不阻断**：带警示的候选仍能 apply 成功，资产内容未被改写；
- App 侧：三语文案存在、警示区在 empty/loading/error 三态下不崩、窄屏与 dark 下可读。

**明确不做**：不改资产解码的拒绝语义（不把警示升级成校验失败）、不动 `agent-asset.ts` 存 `config` 的形态、不做其它资产类型（prompt/skill/command/workflow/plugin）的同类警示——先把 agent 这条唯一有 `permissions` 的路径做对。

### 5.5 任务 2（Phase C）详细范围 —— ADR-21 转 Accepted 后才可写生产代码

**先认清起点**：产品今天**完全不连接任何 MCP server**。生产装配是 `McpV2.noopLayer`，`McpV2.Service` 零消费方，`packages/aigcfroge/src/mcp/v2-bridge.ts` 是死代码（全仓唯一引用是它自己的 barrel 行）。所以 Phase C 是**写第一个能跑的实现**，不是重构现有 bridge。`v2-bridge.ts` 可以当参考，但**不要假设它在服役**——它的 `cfg: any` 曾掩盖两处真实键名不匹配，照抄就是把两个 bug 一起搬进第一个真实实现。

**同时在役、不许动的两套**：① V1 MCP 在跑且已有 HTTP 面（`packages/aigcfroge/src/mcp/index.ts`，979 行，按 instance 目录 scope，`/mcp/*` 端点在服役），ADR-19 §2.1 已裁定 V1 与 canonical **并存不合并**，迁移归 M4；② Location-scoped 的 MCP 资产子系统在服役（`packages/core/src/mcp-asset*.ts`），其 `configJson` 是不解码的 opaque 串（≤100000 字节），ADR-19 §2.9 裁定写入面必须经 `McpScope.McpServerBinding` 解码校验。

**Phase B 已交付的接缝，Phase C 是它的首个生产消费者**：`McpRegistration`（`packages/core/src/tool/mcp-registration.ts`）已有 `mcp_<server>_<tool>` 命名空间、全或无语义、typed `McpNameCollisionError` / `InvalidServerNameError` / `McpToolNameTooLongError`。它**今天只有测试消费方**；Phase C 的 connection owner 是第一个生产消费者。禁止新增第二个 registry / executor。

**Phase B 遗留、Phase C 必须处理的两项（technical-debt §3.2）**：

1. **canonical 工具名 64 字符共享预算无截断策略**：`mcp_`（4）+ server + `_`（1）+ tool 共享 `Tool.validateName` 的 64 上限；实测 server 23 字符 + tool 38 字符 = 66 即越界，报 typed `McpToolNameTooLongError`。Phase C 拿到真实 server 目录后定策略。
2. **ADR-19 §2.7 隔离矩阵 #1（跨 Location）与 #4（V1 单向隔离）的连接期集成断言**：Phase B 时无连接实体无法断言，Phase C 有了连接实体就要补。

**两条贯穿全 slice 的装配约束**：connection owner layer 必须排在 `Tools.Service` 可用**之后**，禁止形成 `PluginBoot -> Tools -> PluginBoot` 循环；新增任何 location 层一律 `Layer.provide`，**不是** `provideMerge`——Phase D 因 `provideMerge` 导出第二个内存 SQLite 并遮蔽共享实例，产生 9 个实例 HTTP 回归。

**health 状态集合**（六态，Slice 3 的状态机就是它）：`connecting | ready | degraded | offline | auth-required | revoked`。

#### 任务 2 · Slice 0：ADR-21 独立事实复核

清单见 §0.3，逐条独立复跑并回答那五个问题，把结论交给人类与复审方。**结论未获人类裁定前不得进入 Slice 1。**

#### 任务 2 · Slice 1：typed MCPConnection owner + stdio

**红**：invalid command / invalid config 被 typed 拒绝；进程启动失败（可执行文件不存在、非零退出）typed fail；stdio 握手超时；process interruption；**owner Scope 关闭必须杀掉子进程且不留孤儿**。

**绿**：第一个能跑的 typed connection owner；发现的工具经 `McpRegistration` 注册（**首个生产消费者**），不新增第二个 registry / executor。

**重构**：expected failure 全部走 tagged errors（`Schema.TaggedErrorClass`），外部 SDK 的 callback 一律经 Effect 边界 Catch Everything；不留宽 `any`（`v2-bridge.ts` 的 `cfg: any` 是反面教材）、不留 raw `console`。

**装配**：必须在本 slice 解决 Layer ordering——owner 在 `Tools.Service` 之后可用，且不成 `PluginBoot -> Tools -> PluginBoot` 环。环无法避免就是停机项，不许靠延迟初始化绕过。

#### 任务 2 · Slice 2：credential binding + 跨 Location 拒绝

依 ADR-21 §2.2 / §2.3（若 Slice 0 复核推翻了「必须新增 `mcp_credential_binding`」，先按复核结论改 ADR 再施工）。

**红**：跨 Location 的 credential ref 解析必须 typed **fail closed**；撤销绑定后下次解析失败；`Credential.remove` 之后的悬空 ref 有确定行为（typed 失败，不是解出 `undefined` 继续连）；绑定表 0 行更新必抛；CAS `expectedRevision` 不匹配必抛。

**绿**：只存 ref、不存材料；**连接建立那一刻**才换取材料，用完即弃，不驻留在服务对象、缓存或闭包里。

**红线**：材料不得进 Snapshot / event / log / 绑定表；日志经 `CredentialScanner`，且**先扫描后裁剪**（先截断再扫描等于把秘密切成扫不出来的碎片放过去）。

#### 任务 2 · Slice 3：remote / OAuth + health 状态机

**红**：invalid URL；credential missing / expired / revoked 三种各自 typed；auth-required 流（缺凭据时进 `auth-required` 而非静默 offline）；六态转换（`connecting | ready | degraded | offline | auth-required | revoked`）；secret redaction。

**绿**：health 投影**只读服务端状态**，App 不自行推演（M0-M2 固定裁决：UI 只投影，不在客户端推演授权或成功语义）。

**未定项**：OAuth `expires` 过期时「该失败还是该 refresh、由谁负责」是 §0.3 第 5 问要回答的问题之一。**答案未定就不要硬编**——先把它作为 Slice 0 的输出交给人类裁定，裁定前该路径只允许 typed fail，不允许悄悄实现一套 refresh。

#### 任务 2 · Slice 4：disconnect / reconnect / drift

**红**：断线重连后 server 的 `listTools` 发生变化 ⇒ 下一个 provider turn 报 `tool_fingerprint_mismatch` / `catalog_digest_mismatch` 并 fail closed（**复用既有重验路径，不新增第三套漂移检测**）；kill switch 关闭时新连接在 admission 处即拒（不是连上再断），pending request 由 owner finalizer 释放、不留悬挂 Deferred。

**本 slice 必须补上的两笔欠账**：ADR-19 §2.7 隔离矩阵 **#1（跨 Location）与 #4（V1 单向隔离）的连接期集成断言**；technical-debt §3.2 的**工具名 64 字符截断策略**（拿真实 server 目录定，写进 changelog 并给依据）。

#### 任务 2 明确不做

- 不动 V1 `mcp/index.ts` 与 `mcp-auth.json` 的在役语义（ADR-19 §2.1 并存裁定，迁移归 M4）。
- 不做静态加密（ADR-21 §2.5 已排除），只做两项止血：DB 文件权限对齐 + 解码期秘密拒绝。
- 不扩 Snapshot version（Phase E）。
- 不做审批中心 UI（Phase F 本体）。

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

**任务 1（Phase F0）完成后 —— 第一个停机点：**

1. 运行 §8 里 Core/Schema/HTTP/SDK/App 受影响门禁 + protocol refs + incremental lint + diff check；**迁移必须给 clean / existing / rerun 三份证据**；跨包改动再跑 `bun turbo typecheck` 与 `bun run lint`。基线（低于即回归）：
   - **core 2101 pass / 2 skip / 0 fail**
   - **aigcfroge server 套件 378 pass / 0 fail**（`bun --cwd packages/aigcfroge test test/server/` 约 10 分钟；**必须真的跑**——Phase D 就是因为只跑 core，漏掉了 9 个实例 HTTP 回归）
2. 以下守卫必须全程绿，**变红都不是「测试要改」**：
   - `packages/core/test/scoped-grant-store.test.ts`（once 单赢、五维度隔离、expiry/revoke 实时）
   - `packages/core/test/permission-grants.test.ts`（完整链路：assert→ask→命中→消费→二次 ask）
   - `packages/core/test/permission-ask-bounds.test.ts`（no_responder 即时拒、TTL、presence 实例共享、天花板×应答方组合）
   - `packages/core/test/permission-effective.test.ts`（R6 块 + Phase D 块 + custom/coding 配对）
   - `packages/core/test/database-migration.test.ts`
3. 输出 Phase F0 报告，必须包含：
   - **§0.1 的三条成对断言实跑输出**（已结算行仍在 / 咨询查不到 / once 二次消费仍失败）——只贴前一条视为未完成；
   - prune 的窗口边界与可重入实跑输出；
   - 迁移三态证据 + 索引真实存在的断言；
   - **§0.2 的信噪比断言实跑输出**（正常资产**不报**）；
   - 带警示的候选仍 apply 成功、资产内容未被改写的证据；
   - SDK 重新生成后的**真实 diff 审查**（不手改生成结果）；
   - App 三语 key 存在性与 desktop/narrow/dark 覆盖说明；
   - `PermissionSaved`（`saved.ts` / `permission/sql.ts`）**diff = 0 行**的证明。
4. **停机等待复审。不得顺手进入 Phase F 本体**（pending 聚合 / revoke 交互 / 客户端消费 `permission.v2.*` 需产品定界面）**或任务 2 = Phase C**（G3-3 虽已通过，任务 1 与任务 2 仍必须两个分支、两次独立停机报告）。
5. 未经交付批准，不 commit/push/PR。**本地 main 领先 origin/main 34 个提交**：按用户安排 M3 全部 Phase 完成后统一开一个 PR，所以本切片只在本地成链，不单独开 PR。

**任务 2（Phase C）完成后 —— 第二个停机点：**

1. 门禁：core 全量 + `bun --cwd packages/aigcfroge test test/server/` **必须真跑并贴数字**（基线：**core 2101 pass / 2 skip / 0 fail**、**aigcfroge server 378 pass / 0 fail**）；迁移给 clean / existing / rerun 三份证据；SDK 重新生成并审查**真实 diff**；跨包改动再跑 `bun turbo typecheck` 与 `bun run lint`。
2. 以下守卫必须全程绿，**变红都不是「测试要改」**：
   - `packages/core/test/tool-registry-stale.test.ts`
   - `packages/core/test/tool-registry-placement.test.ts`
   - `packages/core/test/tool-mcp-registration.test.ts`
   - `packages/aigcfroge/test/session/v1-canonical-registry-boundary.test.ts`
3. 输出 Phase C 报告，必须包含：
   - 真实 stdio 子进程被 owner Scope 杀掉、**无孤儿**的实跑证据；
   - 跨 Location credential ref 被拒绝的实跑输出；
   - 材料未出现在 Snapshot / event / log 的**证明方式**（怎么验的，不是「已确认」）；
   - ADR-19 §2.7 隔离矩阵 **#1 / #4** 的连接期断言；
   - 工具名 64 字符截断策略的**决定与依据**；
   - OAuth `expires` 处置的**裁定来源**（谁裁的、裁的是失败还是 refresh）。
4. **停机等待复审。不进 Phase E（Resolver/Snapshot）、不进 Phase F 本体（审批中心 UI）。**
5. 未经交付批准，不 commit/push/PR。**本地 main 领先 origin/main**：M3 全部 Phase 结束后统一开一个 PR。

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

- Slice 0 未完成或结论未获裁定，却要写 credential/connection/transport 生产代码。
- 保留已结算 grant 行之后，`findValid` 能查到它们，或 `once` 能被二次兑现（§0.1）——这是本切片唯一能造成越权的失误，出现即停机。
- 需要新增/改动 pending / reply / grant / revoke 端点，或需要客户端消费 `permission.v2.*`，才能完成本切片——那说明范围滑进 Phase F 本体了。
- 需要自己再抄一份危险动作清单或只读白名单（真源在 `permission/effective.ts`）。
- 导入警示要变成阻断，或要改资产解码的拒绝语义。
- 任何新增 location 层用了 `Layer.provideMerge` 提供 Database/EventV2（Phase D 已因此产生第二个 SQLite 实例）。
- `ApprovalPresence` 要改回可选依赖（`Effect.serviceOption`）。
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
| 当前安全起点 | **Phase F0（审批中心前置切片），分支 `approval-preflight`**；从最新**本地** `main`（`38d82e2b3`）建分支 |
| 自动继续范围 | 两个 slice 各自全绿后自动继续；**不进 Phase F 本体、不进 Phase C** |
| 强制停止点 | 两个 slice 都完成（等复审）、范围滑进 Phase F 本体或 Phase C、测试失败、owner/协议冲突、§10 任一条 |
| 分支原则 | M3 各阶段在本地依次合入 main 成链，全部完成后统一开一个 PR；不逐阶段推送 |
| 卡住时 | 输出停止报告，不绕过 Gate 或测试 |






