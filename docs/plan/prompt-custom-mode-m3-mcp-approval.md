# Custom Mode M3 全量 TDD 执行提示词

> 对应总计划：[custom-mode-composition-platform-implementation.md](custom-mode-composition-platform-implementation.md)
> M3 计划：[custom-mode-m3-mcp-approval.md](custom-mode-m3-mcp-approval.md)
> 前置：M2 总复审 **APPROVED**（[Custom M2 复审报告](../review/AigcForge_CUSTOM_M2_REVIEW.md) R5）；M2 已合入 `main`（PR #46，合并提交 `a11b50020`，2026-08-22）
> 分析基线：`main@a11b50020`（2026-08-22，本地/远端已同步）；执行基线为开工时最新 `main`，不得把该 SHA 当成固定开工基线
> 生成日期：2026-08-22
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

## 0. 最重要的一条：M3 当前被 ADR 阻塞

**G3-1（Registration ADR）与 G3-2（Grant ADR）尚未起草。** 这不是「文档待补」，而是 M3 计划 §1 明确的开工阻塞项与 §6 的停止条件。因此：

- **允许立即执行的只有 Phase A**：调研 + 起草两份 ADR + 定义 Schema 契约，分支 `mcp-scope-adr`。
- **Phase B 及之后一律不得开工**，直到两份 ADR 被接受并记录审批（沿用 M0/M2 先例：五方技术审批由用户授权 AI 代理代行并写入 ADR 正文，不冒充真人手签）。
- 如果你发现自己在没有已接受 ADR 的情况下写 registration/grant 生产代码，立刻停止并报告。

Phase A 内部 slice 全绿后可自动继续；**Phase A 结束后必须停机**，等待用户与高级全栈顾问对两份 ADR 的裁决。不得自动进入 Phase B-G，不得进入 M4-M5。

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

1. **开工前提：M2 已合入 main 且本地/远端同步。** 先 fetch 并审计最新 main，确认 `a11b50020`（或更新的 M2 merge commit）在 main 上。若 M2 不在 main 上，停止并报告。
2. 不覆盖、回滚、清理或提交用户已有改动。若 main 有无关脏改动，先报告并隔离本任务文件；禁止 `git reset --hard`、`git checkout --`、盲目 `clean`。**已知无关在途文件：`docs/research/agent/Codex Harness 深度调研.md`（用户资料，保留原样，不要提交进本任务的 commit）。**
3. 分支策略（M3 计划 §7）：研究/ADR 用 `mcp-scope-adr`；生产实现等 Gate 过后依次 `mcp-registration`、`scoped-grants`、`mcp-composition`、`approval-center`。分支名不超过三个短词、无 slash。每个 PR 合入后从最新 main 开下一分支。
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
Phase A  Registration/Grant ADR 与 Schema 契约            分支 mcp-scope-adr    ← 当前唯一可开工阶段
--- 以下全部被 G3-1/G3-2 阻塞，ADR 未接受不得开工 ---
Phase B  canonical scoped registration                   分支 mcp-registration （需 G3-1）
Phase C  connection、credential 与 health                 分支 mcp-registration （需 G3-1/G3-3）
Phase D  ScopedGrant 与 PermissionEffective               分支 scoped-grants    （需 G3-2/G3-4）
Phase E  Resolver/Snapshot 与运行依赖                     分支 mcp-composition  （需 G3-1/G3-2）
Phase F  HTTP/SDK/App 审批中心                            分支 approval-center  （需 G3-2/G3-4）
Phase G  故障注入与灰度
```

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

以下事实来自 `main@a11b50020` 的五层代码、测试与复审报告，并经独立事实核查落到 `file:line`。**[M3 计划 §0](custom-mode-m3-mcp-approval.md) 是完整版，开工必读**；本节只列会直接约束你设计的部分。若最新 main 已改变，必须用代码/测试证据更新计划后再施工，不能静默偏离。

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
- 测试装配：实例 HttpApi 测试走 `HttpApiApp.routes` 真实装配；`packages/core/test/lib/product-mode.ts` `withCustomModeEnabled()`；exerciser 覆盖门禁（`--mode coverage/auth --fail-on-missing --fail-on-skip`）。

### 4.2 M0-M2 固定裁决（M3 不得推翻）

- Custom 一律 V2-native；服务端 re-freeze，Session+Snapshot 原子事务；exact retry 幂等，digest 不同即 conflict。
- Snapshot bytes/digest 写入后不可 update；运行中不采用最新资产，升级只能 fork/new Session。
- allowlist 不只写进 Prompt；task 与 child create 双层强制。
- 运行依赖检查经 `SessionComposition` 单点，不在 handler/App 复制。
- 旧客户端不得看到/解码 Custom 为 Coding；capability 矩阵在 M3 全部新端点上继续保持。
- 运行状态只进 DB，不回写 Profile/资产文件，不在 Profile/Task/Session 三处复制再靠事件猜测同步。
- UI 只投影服务端状态；不在客户端推演授权、frontier 或成功语义。

### 4.3 Phase A 必须闭环的待裁决契约（不得留白）

- **G3-1 Registration ADR**：Session/Location registration 的 scope 语法与 owner Scope、name collision 规则、server/tool fingerprint、cleanup、reconnect 后的 fingerprint drift、跨 Location 隔离、definitions 与 captured settle 来自同一 effective registrations 的证明方式。
- **G3-2 Grant ADR**：`once | Session | Location` × `action/resource/agent/revision/expiry/revocation` 的唯一真源。**必须显式回答**：新增独立 `ScopedGrant` owner 还是扩 `PermissionSaved`（计划 §3 Phase A 的默认建议是新增 scoped owner 并让 `PermissionEffective` 消费，以免破坏 `always` 的既有兼容语义）；deny 是否始终胜出；grant 与 Snapshot audit digest 如何分离。
- **G3-3 Credential**：secret owner、opaque ref 形态、rotation/revocation、日志脱敏、跨 Location ref 拒绝。
- **G3-4 Unattended**：无页面/无用户时 `ask` 的 timeout 与 fail-closed 策略。**这条必须同时覆盖 §4.5 的 workflow child 无人值守问题**，不能只考虑「用户开着页面但没点」的情形。
- 定案结果同步 `specs/v2/schema-changelog.md`。**文档改写不得丢失已定案内容**（含 M1 的 `session.next.*` 事件清单与 kill-switch 语义、M2 的 ADR-18 §2.2 状态机与 §2.7 五端点契约）——只允许追加/更新状态；diff 中删除已有定案段落必须显式说明理由。

### 4.4 M4/M5 硬缺口（M3 不得提前实现）

- Plugin Asset 不是 Installed Extension；缺 provenance/trust/pinned revision/staged rollback/quarantine（M4）。
- Code Presentation 必须使用成熟隔离引擎并证明 Native/Code 等价（M5）。

### 4.5 M2 遗留前置项（M3 必须吸收，来源 technical-debt §3.1）

这三条是 M2 复审登记、**明确划给 M3** 的：

1. **Agent 资产可自授权限 + workflow child 无人值守（G3-2/G3-4 的真实动机）。** 允许清单以 author 可控的 `name` 为身份，但真正生效的权限来自全局 `AgentV2` 注册表：资产 frontmatter 的 `config.permissions` 可写 `{action:"*",resource:"*",effect:"allow"}`，而 `permission.ts` 的 `evaluate` 用 `findLast`，尾部通配 allow 胜出；child 以 `attended: false` 创建，无人值守 clamp 把 `ask` 压成 `deny` 但**尾部 allow 不受影响**，于是 bash/edit/write 无审批执行。另一变体：与内置 agent 同名（如 `build`）使资产被 `asset-bridge` 丢弃、内置 allow-all ruleset 生效，而 Plan/Snapshot 仍显示已绑定资产且能力标 denied。该机制早于 M2，但 M2 新增了最多 64 step × 8 attempt 的无人值守扇出，放大了它。**Grant ADR 必须给出裁决**：为 `mode === "custom"` 的 child 用 deny-first 的 custom 基线与解析出的 ruleset 求交，并在 agent provenance 与绑定 `relativePath` 不一致时 fail closed。
2. **Custom kill switch 无「关闭即中断在飞 child」的进程内通知。** 现状只保证「不再派发新工作」。M3 引入外部连接后，运营关闭开关必须同时能停掉 MCP 连接与 pending request；Registration ADR 需要定义 disable 通知与 owner Scope 的关系。
3. **`MAX_STEPS` 等图不变量不在解码期与资产写入期强制**（ADR-18 §2.5.3 写「解析期拒绝」而代码在 freeze 期）。M3 若给 MCP 资产加写入面，**不要复制这个错误**：解码期就要有上界与结构校验。注意 **MCP 资产已经踩了同一个坑**——`configJson` 是不解码的 ≤100000 字节 opaque 串。

### 4.6 一个未登记的矛盾，Phase A 第一个红测试就该打它

每轮 provider turn 都调 `ProductModeAgentPolicy.enforcePrimary(session.mode, session.agent)`，**无 parent/child 豁免**，而 `checkPrimaryAgent("custom", agent)` **只允许 `"meta"`**，否则 `Effect.die(AgentNotAllowedError)`。但 custom 的 child 本来就该拿非 meta 的 agent——`resolveAgent` 的 `parent && parentSnapshot` 分支在 `assertAgentAllowed` 后直接返回 `input.agent`，绕过了 create 期的 `enforcePrimary`，测试也断言了 `agent: "custom-coder"` + `mode: "custom"` 的 child 能建成。而 M2 的 workflow child 走的正是同一个 runner。

**事实核查未能证伪这条**——没有任何测试驱动一个非 meta 的 custom child 跑真实 turn。所以 Phase A 的第一个红测试就是：驱动这样一个 child 跑一轮，确认它是死路还是有别处兜住。**如果是死路，那是 M2 的 P0 而不是 M3 的新工作——立刻停下报告，不要顺手改。**

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

### 5.3 Phase A 的具体交付物（当前唯一可开工阶段）

分支 `mcp-scope-adr`，产物：

1. **调研报告**：以 `file:line` 落实 MCP 运行时现状、ToolRegistry 注册契约、Permission 决策函数与 `PermissionSaved` 语义、Credential 存储形态。**先把 M3 计划 §0 的代码事实逐条复核一遍**——它写于 `a11b50020`，如果 main 已前进，你的第一份产出就是修正它。§0 已经纠正了旧计划四条事实中的两条错误与两条严重不完整，**别把它当成可以跳读的背景**。
2. **打 §4.6 那个红测试**：非 meta 的 custom child 跑一轮真实 provider turn。这一条排在 ADR 之前，因为如果它是死路，M2 的 workflow 委派在真实 Provider 上就是坏的，M3 的整个 grant 设计前提都要重估。
3. **ADR-19 MCP Scoped Registration**（G3-1）与 **ADR-20 Scoped Grant Model**（G3-2）：结构沿用 ADR-18（背景 / 决策 / 架构影响与五层映射 / 审批与授权记录），每条决策必须能指向代码事实或明确标注为新增契约。**必须显式回答**：V1 MCP 是收敛还是并存；registration fingerprint 与 Snapshot tool fingerprint 的关系；`ScopedGrant` 是新 owner 还是扩 `PermissionSaved`（默认建议新 owner）；「有人值守但无客户端」的 ask 超时策略；尾部 allow 绕过 unattended clamp 怎么堵。
4. **Schema 契约红测试先行**：MCP binding/ref/health/fingerprint、ScopedGrant scope 语法、pending request 的 decode 边界与负向用例（secret 出现在 binding 即解码失败、非法 scope 即失败、跨 Location ref 即失败）。**解码期就要有上界**（见 §4.5 第 3 条）。
5. 同步 `specs/v2/schema-changelog.md`（只追加/更新状态）。

Phase A 不写 registration/connection/grant 的生产实现，不接真实 MCP server。Schema + ADR 定案即停机。

### 5.4 Phase B-G 范围（ADR 接受后才展开，详见 M3 计划 §3）

- **Phase B** `mcp-registration`：Location/Session register/unregister；owner Scope close 只移除自己的工具；同名 collision；definitions/settle 捕获一致；reconnect 产生 fingerprint drift；A/B Location 隔离。给 MCP producer 注入窄 capability，不新增 registry/executor。先解决 Location-layer ordering，不能形成 `PluginBoot -> Tools -> PluginBoot` 循环。
- **Phase C** `mcp-registration` 继续：stdio/remote/OAuth connect；invalid URL/command/config；credential missing/expired/revoked；disconnect/reconnect/timeout/process interruption；secret redaction；跨 Location ref 拒绝。health = `connecting|ready|degraded|offline|auth-required|revoked`。expected failure 用 tagged errors，外部 SDK callback 经 Effect 边界兜底。
- **Phase D** `scoped-grants`：once 消费一次；Session 不跨 Session；Location 不跨 Location；agent/revision mismatch；expiry/revocation 立即生效；deny 始终胜出；saved `always` 不被静默迁义；**unattended ask fail closed（含 workflow child）**。grant store 照抄 M2 的 durable owner + CAS + 同事务事件模式。
- **Phase E** `mcp-composition`：只有 Profile 显式绑定的 MCP 被解析；Plan 显示 requested/effective/denied + credential/health；start re-freeze；运行中定义变化不改 Snapshot；新 provider turn fingerprint mismatch 阻断；撤销后新调用失败。
- **Phase F** `approval-center`：pending 聚合、once/Session/Location 明示、revoke、无页面连接、Builder health/diagnostics；薄 endpoints + SDK 重新生成；desktop/narrow/keyboard/i18n（en/zh/zht 三语 parity）。入口不自动扩大 scope。
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

**Phase A 完成后：**

1. 运行 Schema/Core 受影响门禁 + protocol refs + incremental lint + diff check。
2. 输出 Phase A 报告：两份 ADR 的决策清单、Schema 契约与负向用例、对 M3 计划 §0 代码事实的修正、以及每个 G3 Gate 的当前状态。
3. **停机等待用户与高级全栈顾问对 ADR-19/ADR-20 的裁决。不得自行接受自己起草的 ADR 然后继续。**
4. 未经交付批准，不 commit/push/PR。获批后按 `quality-to-pr` 确认 issue、remote、base、branch、commit/PR title、最终 checks，再交付并 read back CI。

**Phase B-G 全部完成后**按 M3 计划 §5 跑完整测试矩阵，输出 M 完成报告，停止等待总复审，不进入 M4。

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

- G3-1/G3-2 未批准却要写 registration/grant 生产代码。
- canonical Session/Location registration 或唯一 grant owner 未批准。
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
| 当前安全起点 | **只有 Phase A（研究 + ADR-19/ADR-20 + Schema 契约），分支 `mcp-scope-adr`**；从最新 `main` 建分支 |
| 自动继续范围 | Phase A 内部 slice 全绿后自动继续 |
| 强制停止点 | Phase A 结束（等 ADR 裁决）、Gate 证据缺失、跨 M、测试失败、owner/协议冲突、每个 slice 交付前 |
| 分支原则 | 每个可合并 slice 从前置合入后的最新 main 新建短分支，不用 M3 巨型分支 |
| 卡住时 | 输出停止报告，不绕过 Gate 或测试 |






