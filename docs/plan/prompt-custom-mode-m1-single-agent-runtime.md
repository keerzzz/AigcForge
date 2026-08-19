# Custom Mode M1 全量 TDD 执行提示词

> 对应总计划：[custom-mode-composition-platform-implementation.md](custom-mode-composition-platform-implementation.md)
> M1 计划：[custom-mode-m1-single-agent-runtime.md](custom-mode-m1-single-agent-runtime.md)
> 前置：M0 已全部合入（PR #43，merge commit `cd30c5496`，2026-08-19）
> 分析基线：`main@cd30c549615b481a4ac13eabb4f133a682460b52`（2026-08-19，本地/远端已同步）；执行时不得把该 SHA 当成固定开工基线
> 生成日期：2026-08-19
> 用途：复制 `PROMPT START` 与 `PROMPT END` 之间的正文到新的执行对话

<!-- PROMPT START -->

你是 AigcForge 仓库（`/media/win_data/aigcfroge`）的高级全栈工程师。你的唯一目标是按仓库协议，以 TDD 小切片完整执行 **Custom Mode M1 Phase A-G**：单 Agent 可恢复运行闭环。

M1 证明唯一拓扑的完整闭环：

```text
Location -> temporary/Profile composition -> Plan -> server re-freeze
-> atomic Session(mode=custom, root=meta) + immutable Snapshot
-> meta delegates exactly one Snapshot Agent
-> Snapshot Prompt/Skill/native tools
-> resume/fork/move/dependency recheck
```

M0 已合入 main（PR #43），G1 已满足。G2/G3/G4 的契约设计已在 ADR-17/Custom PRD 获批，你必须在每个被 Gate 阻塞的 Phase 开工前组装该 Gate 的证据映射（代码/ADR/测试 -> Gate 标准），放入当 Phase 复查结论；任一 Gate 标准与代码事实冲突时停止并报告，不得自行跨 Gate。M1 内部 slice 验证全绿后自动继续；M1 Phase G 结束后统一停机等待高级全栈顾问总复审。**不得自动进入 M2-M5。**

## 0. 开工门禁

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
git ls-remote --heads origin main
git log --oneline --decorate -20 main
```

规则：

1. 本提示词刷新时，本地 `main`、`origin/main` 和 GitHub 远端 `refs/heads/main` 均为 `cd30c549615b481a4ac13eabb4f133a682460b52`（M0 合入点）。开工时重新 fetch 并审计最新 main；不要硬退到旧 SHA。
2. 不覆盖、回滚、清理或提交用户已有改动。若当前 main 有无关脏改动，先报告并隔离本任务文件；禁止 `git reset --hard`、`git checkout --` 和盲目 clean。已知无关在途文件：`v3-ui-prototype.html`（未跟踪，与本任务无关，保留原样）。
3. 分支策略（M1 计划 §7）：**不使用单一 M1 巨型分支**。每个可独立合并的 slice 从当时最新 main 建短分支，依次使用 `custom-snapshot`、`custom-runtime`、`custom-security`、`custom-surface`、`custom-rollout`；后一 slice 分支必须基于前一 slice 已合入 main 的结果。分支名不超过三个短词、无 slash。
4. 未经用户确认 remote、issue、最终 diff、commit/PR title，不 push、不创建 PR。禁止 `--no-verify`。每个 slice PR 合入后才切下一分支。
5. 测试永不从仓库根运行。使用 `bun --cwd packages/<name> test --timeout 30000` 或包内专用脚本。根目录只可运行 typecheck/lint/protocol/diff 等非 test 门禁。

如果当前不是可安全派生分支的状态，先报告基线、脏文件和建议隔离方式，不要破坏现场。

## 1. 必读协议与计划

开工前完整读取，不依赖本提示词转述：

```text
CLAUDE.md
AGENTS.md
ARCHITECTURE.md
CONTEXT.md
DESIGN.md
docs/testing.md
.aigcfroge/skills/protocols/SKILL.md
.aigcfroge/skills/enterprise-code-standard/SKILL.md
.aigcfroge/skills/reuse-first-refactor/SKILL.md
.aigcfroge/skills/quality-to-pr/SKILL.md
.aigcfroge/skills/quality-to-pr/references/delivery-gates.md
docs/architecture/adr/ADR-17-custom-mode-composition-platform.md
docs/prd/custom-mode-composition-platform.md
docs/roadmap/custom-mode-roadmap.md
docs/plan/custom-mode-composition-platform-implementation.md
docs/plan/custom-mode-m0-composition-foundation.md
docs/plan/custom-mode-m1-single-agent-runtime.md
specs/v2/session.md
specs/v2/tools.md
specs/v2/schema-changelog.md
docs/technical-debt.md
docs/review/AigcForge_CUSTOM_GOVERNANCE_APPROVAL_2026-08-18.md
docs/review/AigcForge_CUSTOM_M0_INDEPENDENT_ACCEPTANCE_2026-08-18.md
docs/review/AigcForge_CUSTOM_M0_REMEDIATION_REREVIEW_2026-08-18.md
```

随后只为当前 Phase 加载专题协议：

- Effect/Core：`.aigcfroge/skills/effect/SKILL.md`、相关 package `AGENTS.md`、`packages/core/src/tool/AGENTS.md`。
- Database：`.aigcfroge/skills/database/SKILL.md`、migration/schema owner 与测试（Phase A 强制）。
- HTTP：`packages/aigcfroge/src/server/routes/instance/httpapi/AGENTS.md`、`packages/aigcfroge/test/server/AGENTS.md`。
- App/UI：`packages/app/AGENTS.md`、`.aigcfroge/skills/frontend-theming/SKILL.md`、最新 ModeWorkspace/Location/Draft owner（Phase E 强制）。
- 测试：相关包 test `AGENTS.md` 与真实近邻测试。

## 2. 锁定 M1

只执行 M1：

```text
Phase A  Snapshot persistence 与迁移        （需 G1）
Phase B  原子 start 与唯一 V2 runtime policy（需 G2 证据）
Phase C  Runner、Skill catalog 与 Tool materialization（需 G3 证据）
Phase D  Custom ceiling 与委派双层门禁       （需 G3 证据）
Phase E  App Custom surface                 （需 G4 证据）
Phase F  恢复、fork、move 与升级
Phase G  50 次基线、灰度与文档收口
```

开始前输出：`M1 / 当前 Phase / Gate 证据 / 基线 / 分支 / 非目标`。Phase A-G 必须顺序执行；每个 slice 全绿后自动继续，不等待审批。Phase G 完成后统一停止，等待高级全栈顾问总复审。不得进入 M2-M5。

### M1 禁区（计划 §0.1，违反即停止）

- 用户 Agent 不得成为 root；root 固定 `meta`。
- 不支持多 Agent、Command、Workflow execution、MCP、Plugin runtime、external CLI、judge、`run_code`。
- 不把 Snapshot 放进 `session.metadata`、transcript、Profile 或 Context Epoch。
- 不先 create Session 再由客户端 PATCH Snapshot。
- 不把 allowlist 只写进 Prompt；task 与 child create 必须双层强制。
- 不在运行中采用最新资产；升级只能 fork/new Session。

## 3. 已确认的架构事实

以下事实来自五层代码、测试、协议与 main 历史。若最新 main 已改变，必须用代码/测试证据更新计划后再施工，不能静默偏离。

### 3.1 M0 已交付接缝（必须复用，禁止重建）

- `packages/core/src/custom-profile-service.ts`：Profile propose/apply/delete 事务（原子写、readback、rollback 补偿）。
- `packages/core/src/composition-resolver.ts`：`resolve`/`freeze(FreezeInput)` 可信重解析；per-tool fingerprint（placement/name/digest/installationVersion）+ 独立 catalogDigest；`duplicate_asset`/`unconnected_asset` 等 typed diagnostics；`findReferencingProfiles`。
- `packages/core/src/product-mode-policy.ts`：`assertCreationSupported`/`assertRuntimeSupported`/`isCustomCapable`（仅 `product-mode-custom-v1`）/`eventFilter`/`isEventPayloadSupported(lookupMode)`；`packages/core/src/session/store.ts` `SessionStore.sessionModes()`。
- `packages/core/src/agent/asset-bridge.ts`：AgentAsset -> AgentV2 candidate 生产接线（Location 层）。
- `packages/core/src/asset-kind.ts`：八类 AssetKind 注册表（canonical ownerDir 常量）。
- `packages/core/src/skill/composition-catalog.ts`：composition-local Skill catalog seam——**M0 已 de-scope 并登记 technical-debt §3，触发条件正是本 M1 Phase C**；接线时移除 de-scope 注释并闭环该债条目。
- HTTP/测试基建：custom-profile/custom-composition groups+handlers；`requireSessionAndCapability`/`requireRuntimeSession` V2 helper；`session-mode-gate`、`session-mode-fork-gate`、`v2-session-capability`、`httpapi-event-mode-isolation` 测试文件（作为新旧客户端矩阵与 SSE 隔离的既有模式）。

### 3.2 M1 固定裁决

- Custom 一律 V2-native，由**唯一 runtime policy owner** 决定；不得散落 `AIGCFROGE_V2_RUNTIME || mode === "custom"`。
- Custom start 服务端重新 freeze，Session+Snapshot 原子事务；exact retry 幂等，digest 不同即 conflict。
- Snapshot 独立 `session_composition_snapshot` 表 + `SessionComposition` typed owner；一 Session 一 Snapshot，无 orphan；bytes/digest 写入后不可 update。
- root system prompt = platform + Custom + Snapshot instructions；selected Agent 内容只进入委派目标。
- Skill guidance/lookup 只见 Snapshot-local catalog；native tool fingerprint 对规范 definition 稳定，版本/schema/name/placement 变化产生 drift。
- 扩现有 `ToolRegistry.materialize` options，definitions 与 captured settle 同一 effective set；不创建第二 registry。
- 进程对象 identity 继续负责 provider-turn stale rejection；stable fingerprint 只做跨 turn/恢复依赖匹配，不能持久化 executor。
- 委派在 task 执行点和 child Session create 点双层检查 Snapshot allowlist；Custom ceiling 进 `PermissionEffective` 唯一 owner；Runner 每次执行重评估 PermissionV2。
- 旧客户端不得看到/解码 Custom 为 Coding（M0 已实现的 capability 矩阵在 M1 全部新端点上继续保持）。

### 3.3 待裁决契约（Phase A/B 必须闭环，不得留白）

- `specs/v2/schema-changelog.md` 中 `unsupported_mode` HTTP status 与 EventV2 lifecycle event names 仍为 TBD——以 M0 实际实现（400 `UnsupportedProductModeError`）与 M1 start/upgrade 事件设计为准定案并更新 changelog。
- V2 `children`/`context` 当前按 runtime 门禁（capable 也 400）；read/runtime 最终归类在 Phase B 唯一 runtime policy owner 落地时裁决，更新测试注释与契约文档。

### 3.4 M2-M5 当前硬缺口（M1 不得提前实现）

- Workflow Asset 只有定义，没有 durable execution owner；`StepDef.input` 仍是 unknown。
- MCP V2 尚未进入 canonical Session/Location scoped Tool registration。
- `PermissionSaved.always` 是既有 Project 语义，不能改名冒充 once/Session/Location grant。
- Plugin Asset 不是 Installed Extension；缺 provenance/trust/pinned revision/staged rollback/quarantine。
- Code Presentation 必须使用成熟隔离引擎并证明 Native/Code 等价；`node:vm`、Worker 或 iframe 单独不构成安全边界。

## 4. 当前 M 的工作拆解

读取 M1 计划的每个 Phase，把它拆成最小 vertical slices。每个 slice 开始前建立：

### 4.1 Reuse table

```text
candidate | definition | callers/tests | compatibility | decision | rejection reason
```

必须查询 owner、调用方、注册路径、近邻测试和相关 Git 历史。符号查询优先 codegraph MCP；不可用时用 `rg` 和精确文件读取。字符串/flag/i18n/path 仍用 `rg`。

新增前遵循：复用 -> 删除 -> 归并 -> 重构 -> 新增。禁止复制 Session、ModeWorkspace、ToolRegistry、Permission、Agent registry、asset transaction、Workflow state 或 Plugin lifecycle owner。**§3.1 的 M0 接缝是首要复用候选。**

### 4.2 验收映射

每条需求至少映射一个行为测试或明确的人工检查：

```text
acceptance | layer | red test | expected failure | green evidence | final gate
```

覆盖适用的 success、invalid、boundary、authorization、concurrency、interruption、idempotency、migration、old-client、reload/recovery、UI error/empty/loading。**M0 复审教训：门禁级行为必须配行为测试（创建/fork/端点/SSE 矩阵模式已建立），不接受"实现存在但无测试"的交付。**

### 4.3 M1 Phase 范围（红/绿要点，详见 M1 计划 §3）

- **Phase A**（分支 `custom-snapshot`）：`session_composition_snapshot` 表走 drizzle/migration generator 与 `schema.gen.ts`/`migration.gen.ts` 管线，不手写游离 SQL；`SessionComposition` typed owner 提供 attach/read/copy/assertDependency；Snapshot Schema v1 decode、Session FK cascade、每 Session 唯一、坏 JSON/version typed failure、内容型与运行依赖字段分层、无 secret 字段；migration 测试 clean + existing + rerun。
- **Phase B**（分支 `custom-runtime`）：`createCustom` domain transaction 复用 `SessionV2.create` 内部构造/投影路径；re-freeze 成功后 Session+Snapshot 同事务提交，任一失败无半状态；exact retry 幂等/conflict；flag off、stale Plan、missing dependency、wrong kind/cardinality fail closed；global V2 flag true/false 下 Custom 始终同一 V2-native 路径；Custom 无 Snapshot 时 prompt/resume 拒绝；start/get API + SDK；闭环 §3.3 两项契约。
- **Phase C**（分支 `custom-runtime` 继续）：root system 组装；Skill guidance/lookup 走 Snapshot-local catalog（接线 §3.1 的 catalog seam）；`ToolRegistry.materialize` allowlist 同时限制 definitions 与 captured settle；unknown/stale/removed registration 不执行；非 Custom caller 不传 allowlist 时行为零回归；runner recorded/failure/interruption 测试。
- **Phase D**（分支 `custom-security`）：root 恒 meta；task 只允许 Snapshot Agent，precheck 与 `SessionV2.create({parentID, agent})` 双层防线各有绕过测试；external-cli/judge/background multi-agent/task recursion 拒绝；foreign resume id、child digest mismatch、changed Agent identity、missing runtime dependency 拒绝；Profile/requestedCapabilities/saved approval/presentation 不能提升 Permission deny；root interruption 停止 child/tool fiber，不发伪成功，不用 sleep。
- **Phase E**（分支 `custom-surface`）：mode registry/href/route/slot、render-all + `display:none`、切换不 remount；Builder 三列主区 unframed layout、窄屏 steps/tabs/drawer；Location/Profile/temporary composition、exactly-one Agent、Prompt/Skill binding、四预览 Tabs；Draft 恢复、start stale 保留用户选择；Snapshot panel 只读；upgrade 只创建 fork/new Session；flag off/old server/empty/loading/error/dependency/version-drift/starting/read-only 全状态；desktop/narrow、light/dark、keyboard/focus、18 locale parity、English/Chinese overflow；不创建 `/custom/*` shell、不嵌套页面 cards。
- **Phase F**（分支 `custom-runtime` 或独立短分支）：同一 Profile 两 Session 独立 Snapshot row；child/fork 独立 Snapshot row 且 digest 按契约复制；Profile 删除后历史可读、冻结内容可回放、运行依赖缺失明确阻断；move 保留 Snapshot、reset Context Epoch、目标 Location 重检不匹配拒绝；upgrade 重新解析/冻结只创建新 Session/fork；所有运行依赖检查经 `SessionComposition`，不在 handler/App 复制。
- **Phase G**（分支 `custom-rollout`）：50 次矩阵（temporary/profile、stale、delete、resume、fork、move、permission deny、interrupt、old client）；指标 Plan >=98%、preview->start >=95%、Snapshot consistency=100%、unauthorized/silent upgrade/fallback=0；演练入口 flag 与 execution kill switch，关闭后保留历史读取；同步 ADR/PRD/Roadmap/technical debt/schema changelog/operator notes。

M1 硬性非目标：多 Agent（M2）、MCP（M3）、Plugin runtime（M4）、Code Presentation（M5）、Command/Workflow execution、external CLI、judge。

## 5. 每个小节强制 TDD 循环

每个 slice 严格执行：

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

红测试必须真实失败，不能只写完不跑。不得复制生产逻辑到测试，不得用源码字符串断言替代行为测试（仅明确的 owner/source-contract 测试除外）。**不对无关文件做机械格式化；diff 中每个 hunk 必须能映射到本 slice 的语义变更。**

### 5.1 Effect/Schema/DB 红线

- `Effect.gen(function* () {})`；公开效果用 `Effect.fn("Domain.method")`。
- expected failure 使用 `Schema.TaggedErrorClass` 和 `yield* new Error(...)`；不以 `Effect.die` 表达业务拒绝。
- 不 `catchCause` 吞 interruption/defect；外部文件/网络/SDK/JSON callback 边界必须 Catch Everything。
- 不用 `Effect.fork`/`forkDaemon`；用 owner Scope / `Effect.forkIn(scope)`。
- 不用 `Effect.sleep(N)`/`setTimeout` 等并发测试；用 Deferred/Latch/SessionStatus/readiness signals。
- 多字段 contract 用 `Schema.Class`，实例化时使用 `new X(...)`；single ID/digest/revision 用 brand。
- DB 列 snake_case；迁移走 generator/index 管线，测试 clean + existing + rerun/rollback。

### 5.2 Tool/Permission/Session 红线

- Tool definition filtering 不是授权；leaf Permission assert 仍是最终边界。
- definitions 与 captured settle 必须来自同一 effective registrations。
- 每条委派/调度路径必须 settle success/failure/cancel，不能留下 orphan `in_progress`。
- 事件 payload、DB row、返回 Info 必须一致；日志只记稳定分类/digest，不记完整 prompt/output/secret/path。
- Session V2 durable admission、process-local drain、Context Epoch、interrupt、fork/move 不变量保持。
- Snapshot bytes/digest 写入后不可 update；任何运行依赖检查经 `SessionComposition` 单点。

### 5.3 UI 红线

- 复用 ModeRoute/ModeWorkspace/render-all typed slots/timeline/composer/side panel/Location owner。
- 新 UI 使用 shared v2 components/tokens、现有 icon library、i18n、a11y；不硬编码颜色/视觉间距/圆角。
- 无页面 card 套 card；Builder 宽屏为主区 unframed layout，窄屏用 tabs/steps/drawer。
- 覆盖 desktop/narrow、light/dark、keyboard/focus、empty/loading/error、English/Chinese/Traditional Chinese overflow；不得 overlap/clipping。

## 6. 每个 slice 的复查结论

每次完成后输出：

```text
复查结论:
- M / Phase / slice / 基线 / 分支:
- 影响文件:
- 五层数据流:
- reuse table 摘要:
- 保留的 owner 与不变量:
- Gate 证据(被该 Phase 阻塞的 Gate):
- Catch Everything / No Null Pointer / Security First:
- No Cheating / Reusability / Clean Logs:
- 红测试失败证据:
- 绿测试与重构证据:
- 已运行命令:
- 剩余风险:
- 下一 slice / 是否触发停止条件:
```

"声明风险"不能代替修复或 Gate。发现多个同类失败时，按 CLAUDE.md 根因收敛，不逐文件打补丁。

## 7. 常用验证命令

只选当前 slice 受影响的命令；M1 最终门禁按 M1 计划 §5 全量执行：

```bash
# Schema
bun --cwd packages/schema test --timeout 30000
bun --cwd packages/schema typecheck

# Core(含 migration clean/existing/rerun 证据)
bun --cwd packages/core test path/to/focused.test.ts --timeout 30000
bun --cwd packages/core test --timeout 30000
bun --cwd packages/core typecheck

# HTTP/server(含 coverage+auth exerciser)
bun --cwd packages/aigcfroge test path/to/focused.test.ts --timeout 30000
bun --cwd packages/aigcfroge run test:httpapi
bun --cwd packages/aigcfroge typecheck

# SDK(重新生成并审查真实 diff)
./packages/sdk/js/script/build.ts
bun --cwd packages/sdk/js typecheck

# App/UI
bun --cwd packages/app run test:unit
bun --cwd packages/app typecheck
bun --cwd packages/app run test:e2e e2e/regression/custom-mode.spec.ts
bun --cwd packages/app run test:bench
bun --cwd packages/storybook build

# Protocol/delivery
bash .aigcfroge/skills/protocols/scripts/check-refs.sh
bun run script/lint-changed.ts
git diff --check
```

跨包 Phase 完成或合并前再运行：

```bash
bun typecheck
bun run lint
```

不要运行根 `bun test`。SDK、migration、schema 或 generated output 必须通过仓库脚本生成并审查真实 diff，不手改生成结果隐藏漂移。UI 交付必须提供 desktop/narrow、主题、键盘、三语截图或视频证据。

## 8. M 级停止与交付

M1 Phase A-G 全部完成后：

1. 运行 M1 计划 §5 的最终协议与测试矩阵（含 migration 证据、HTTP exerciser、E2E、benchmark、Storybook）。
2. 对比完整 diff 与最新 `origin/main`，检查 scope creep、dead/duplicate code、generated churn、兼容、秘密、任意 sleep/cast/吞错。
3. 同步 ADR/PRD/spec/schema changelog/Roadmap/technical debt 的实际状态（含 §3.3 两项契约定案与 catalog 债闭环）。不能把 pending 写成 delivered。
4. 输出 M1 完成报告，然后**停止等待高级全栈顾问统一审批**；不要进入 M2。
5. 未经交付批准，不 commit/push/PR。获批后按 `quality-to-pr` 确认 issue、remote、base、branch、commit/PR title、最终 checks，再交付并 read back CI。

建议完成报告：

```text
M completion:
- M / baseline / branch / commits:
- Gate evidence(G1-G4):
- Scope and non-goals:
- Reused owners(含 M0 接缝):
- Five-layer changes:
- TDD slices and red/green evidence:
- Tests/typechecks/HTTP/SDK/migration/E2E/benchmark:
- Security and protocol review:
- Rollout/rollback(50 次基线指标):
- Remaining risks or blocked checks:
- Proposed next M (not started):
```

## 9. 必须立即停止的情况

- M0/G2/G3/G4 任一没有批准证据，或最新 main 与计划的关键 owner/不变量冲突。
- 原子 start 无法保证 Session/Snapshot/Event 同一 durable outcome。
- Custom 仍可能落到 V1、无 Snapshot 执行或旧 client 误解为 Coding。
- definitions 与 settle effective set 不一致，或 allowlist 只存在 Prompt/UI。
- 需要支持 M2-M5 能力才能完成 M1。
- 需要创建第二 Session/Tool/Permission/ModeWorkspace/Agent/Workflow/Plugin owner。
- 需要信任客户端 Plan/Snapshot、把 secret/executor 存 Snapshot。
- 任一 applicable test/typecheck/migration/HttpApi/SDK/lint/E2E/security check 失败。
- 只能靠 `as any`、`@ts-ignore`、任意 sleep、broad mock、吞异常、跳 hook、假测试继续。

停止报告必须包含：已读文件、代码证据、失败命令与关键输出、已尝试方案、未改/已改文件、需要哪个 owner 作何决策。不要猜接口或自行跨 Gate。

<!-- PROMPT END -->

## 使用说明

| 项           | 值                                                                       |
| ------------ | ------------------------------------------------------------------------ |
| 复制范围     | `<!-- PROMPT START -->` 到 `<!-- PROMPT END -->`                         |
| 当前安全起点 | M1 Phase A（G1 已由 PR #43 满足）；从 M0 合入后的最新 `main` 建短分支    |
| 自动继续范围 | M1 Phase A-G 内，slice 验证全绿后自动继续                                |
| 强制停止点   | Gate 证据缺失、跨 M、测试失败、owner/协议冲突、每个 slice PR 交付前      |
| 分支原则     | 每个可合并 slice 从前置合入后的最新 main 新建短分支，不用 M1 巨型分支    |
| 卡住时       | 输出停止报告，不绕过 Gate 或测试                                         |
