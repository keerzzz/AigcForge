# Custom Mode M2 全量 TDD 执行提示词

> 对应总计划：[custom-mode-composition-platform-implementation.md](custom-mode-composition-platform-implementation.md)
> M2 计划：[custom-mode-m2-multi-agent-workflow.md](custom-mode-m2-multi-agent-workflow.md)
> 前置：M1 总复审 **APPROVED**([AigcForge_CUSTOM_M1_FINAL_APPROVAL_2026-08-19.md](../review/AigcForge_CUSTOM_M1_FINAL_APPROVAL_2026-08-19.md))；M1 PR 合入 main 后才允许开工
> 分析基线：`custom-rollout@4b5e10976`(2026-08-20,M1 待合入）；执行基线为 M1 合入并复审后的最新 `main`，不得把该 SHA 当成固定开工基线
> 生成日期：2026-08-20
> 用途：复制 `PROMPT START` 与 `PROMPT END` 之间的正文到新的执行对话

<!-- PROMPT START -->

你是 AigcForge 仓库(`/media/win_data/aigcfroge`)的高级全栈工程师。你的唯一目标是按仓库协议，以 TDD 小切片完整执行 **Custom Mode M2 Phase A-G**：多 Agent 与 Workflow 编排。

M2 不是把 `agents.length` 上限从 1 改成 N。它要建立一个 durable Workflow Run owner，证明唯一拓扑：

```text
Location -> Profile/temporary composition v2 (Agent pool + bindings + Workflow DAG)
-> Plan (cost preview) -> server re-freeze -> atomic Session(mode=custom, root=meta) + Snapshot v2
-> WorkflowRun/StepRun durable owner (DB-derived ready frontier)
-> meta dispatches Snapshot pool Agents via SessionTask/TaskDriver (serial/parallel/branch)
-> per-step settle success/failure/cancel + root owns final answer & cancellation
-> partial success / retry-resume / recovery / move / upgrade
```

M1 已合入 main 并总复审通过，G2-0 以 M1 复审报告为准。G2-1(Workflow Execution ADR)/G2-2(数据契约)/G2-3(安全)/G2-4(产品)必须在被 Gate 阻塞的 Phase 开工前组装证据映射（代码/ADR/测试 -> Gate 标准），放入当 Phase 复查结论；任一 Gate 标准与代码事实冲突时停止并报告，不得自行跨 Gate。**M2 的第一个可提交 slice 是 ADR/Schema contract，不是修改 `agents.length`。** M2 内部 slice 验证全绿后自动继续；Phase G 结束后统一停机等待高级全栈顾问总复审。**不得自动进入 M3-M5。**

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

1. 本提示词生成时 M1 在 `custom-rollout` 分支等待合入。**开工前提：M1 PR 已合入 main 且本地/远端同步**；先 fetch 并审计最新 main，确认 M1 merge commit 在 main 上，不要硬退到旧 SHA。若 M1 未合入，停止并报告。
2. 不覆盖、回滚、清理或提交用户已有改动。若当前 main 有无关脏改动，先报告并隔离本任务文件；禁止 `git reset --hard`、`git checkout --` 和盲目 clean。已知无关在途文件：`v3-ui-prototype.html`（未跟踪，与本任务无关，保留原样）。
3. 分支策略（M2 计划 §7）：**不使用单一 M2 巨型分支**。每个可独立合并的 slice 从当时最新 main 建短分支，依次使用 `workflow-contract`、`workflow-runtime`、`workflow-security`、`workflow-surface`；后一 slice 分支必须基于前一 slice 已合入 main 的结果。分支名不超过三个短词、无 slash。
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
docs/plan/custom-mode-m1-single-agent-runtime.md
docs/plan/custom-mode-m2-multi-agent-workflow.md
specs/v2/session.md
specs/v2/tools.md
specs/v2/schema-changelog.md
docs/technical-debt.md
docs/review/AigcForge_CUSTOM_M1_DELIVERY_REVIEW_2026-08-19.md
docs/review/AigcForge_CUSTOM_M1_FINAL_APPROVAL_2026-08-19.md
```

随后只为当前 Phase 加载专题协议：

- Effect/Core：`.aigcfroge/skills/effect/SKILL.md`、相关 package `AGENTS.md`、`packages/core/src/tool/AGENTS.md`。
- Database：`.aigcfroge/skills/database/SKILL.md`、migration/schema owner 与测试（Phase A/C 强制）。
- HTTP：`packages/aigcfroge/src/server/routes/instance/httpapi/AGENTS.md`、`packages/aigcfroge/test/server/AGENTS.md`。
- App/UI：`packages/app/AGENTS.md`、`.aigcfroge/skills/frontend-theming/SKILL.md`、最新 ModeWorkspace/Location/Draft owner（Phase F 强制）。
- 测试：相关包 test `AGENTS.md` 与真实近邻测试。

## 2. 锁定 M2

只执行 M2（对应 M2 计划 §3）：

```text
Phase A  Workflow Execution ADR、Schema/Composition v2 与迁移兼容（需 G2-1/G2-2 证据）
Phase B  多 Agent Resolver、bindings 与成本预览                （需 G2-1 证据）
Phase C  WorkflowRun/StepRun durable owner 与状态机            （需 G2-2 证据）
Phase D  串行/并行/分支调度与 settle                           （需 G2-2/G2-3 证据）
Phase E  权限、委派双层门禁扩展与 Command binding              （需 G2-3 证据）
Phase F  HTTP/SDK/App 进度、取消、部分成功闭环                 （需 G2-4 证据）
Phase G  恢复、故障注入、灰度与文档收口
```

开始前输出：`M2 / 当前 Phase / Gate 证据 / 基线 / 分支 / 非目标`。Phase A-G 必须顺序执行；每个 slice 全绿后自动继续，不等待审批。Phase G 完成后统一停止，等待高级全栈顾问总复审。不得进入 M3-M5。

### M2 禁区（计划 §0.2，违反即停止）

- 不开放 MCP、Plugin runtime、Code Presentation、external CLI 或 judge。
- Command binding 是绑定到消费者的结构化指令模板，不等于 shell 权限，不能创建新 executor。
- Workflow `StepDef.input`（当前 `unknown`）不得被直接解释为可执行代码/命令；分支条件只消费结构化 step result，不执行任意表达式。
- 不在 Profile/Workflow 资产文件中保存运行中 run/step 状态；运行状态只进 DB。
- 不让 Workflow 自己授予权限或绕过 Snapshot/Permission；不建立第二个 permission engine。
- 不把 Work 首页引导模式直接标成 Custom Workflow engine；只有接入同一 engine 后才能移除“引导模式”文案标记。
- 不在 Profile/Task/Session 三处复制同一运行状态再靠事件猜测同步。
- root 固定 `meta`，用户 Agent 不得成为 root。

## 3. 已确认的架构事实

以下事实来自五层代码、测试、协议与 main 历史。若最新 main 已改变，必须用代码/测试证据更新计划后再施工，不能静默偏离。

### 3.1 M0/M1 已交付接缝（必须复用，禁止重建）

- `packages/core/src/session/composition.ts`:`SessionComposition` typed owner——attach/get/read/copy/`assertDependency`/`assertAgentAllowed`；typed mismatch 错误（`tool_catalog_mismatch`/`tool_catalog_digest_mismatch` 等）。M2 扩展走同一 owner（如 `assertAgentAllowed` 接受 step identity），不建第二组合服务。
- `session_composition_snapshot` 表 + Snapshot Schema v1：一 Session 一 Snapshot、写入后不可 update、64-hex digest 严格校验。M2 的 Snapshot v2 必须是 version union，**M1 v1 Snapshot 保持可读**。
- `packages/core/src/composition-resolver.ts`:resolve/freeze、per-tool fingerprint + catalogDigest、typed diagnostics。M2 用 versioned decoder/strategy owner 扩展，不散落 `if version >= 2`。
- `packages/core/src/product-mode-policy.ts`:creation/runtime/capability/event filter 唯一 policy owner；`AIGCFROGE_CUSTOM_MODE` kill switch 四门禁（plan/start/upgrade/session.custom）已建立，M2 新端点必须接入同一 flag 与 capability 检查。
- `ToolRegistry.materialize(permissions?, intent?, { allowlist? })` + provider-turn 前置 fingerprint/catalogDigest 重验（fail-closed via `SessionRunner.SnapshotDriftError`)。
- 委派双层门禁：task precheck + `SessionV2.create({parentID})` domain boundary；`PermissionEffective` deny 上限不可提升。M2 多 Agent 委派必须复用同一双层防线。
- `SessionTask`/`TaskDriver`:durable task、child Session、settle、取消、DAG 字段——M2 调度的唯一积木；scheduler 只拥有“何时调用 TaskDriver”，Runner 不拥有 DAG。
- Upgrade 闭环：`POST /custom-composition/upgrade`(409 `SessionBusyError`)、SDK `customComposition.upgrade`、App Snapshot panel。
- App Custom surface:Builder 三列（`custom-sidebar.tsx`/`custom-builder-main.tsx`/`custom-preview-column.tsx`)、四预览 Tabs、Draft `Persist`、18 locale parity 基建。
- 稳定性矩阵基建：`packages/aigcfroge/test/server/custom-composition-stability-matrix.test.ts`(50 轮 digest 确定性与状态机迁移）,M2 矩阵在其模式上扩展。
- 测试装配约束：实例 HttpApi 测试走 `HttpApiApp.routes` 真实装配；M1 遗留 `SessionExecution.setBusySeamForTesting` 全局 seam 已登记 technical-debt §4,**M2 不得新增同类 seam**——需要 busy/并发场景时用真实 drain 构造，或先落地测试装配注入点根治该债。

### 3.2 M1 固定裁决（M2 不得推翻）

- Custom 一律 V2-native，由唯一 runtime policy owner 决定。
- 服务端 re-freeze,Session+Snapshot 原子事务；exact retry 幂等，digest 不同即 conflict。
- Snapshot 不进 `session.metadata`、transcript、Profile 或 Context Epoch。
- allowlist 不只写进 Prompt;task 与 child create 双层强制。
- 运行中不采用最新资产；升级只能 fork/new Session。
- 旧客户端不得看到/解码 Custom 为 Coding（capability 矩阵在 M2 全部新端点上继续保持）。
- 运行依赖检查经 `SessionComposition` 单点，不在 handler/App 复制。

### 3.3 待裁决契约（Phase A 必须闭环，不得留白）

- **Workflow Execution ADR(G2-1)**：定义 definition owner、run owner、step state machine、retry/idempotency 边界、partial success 语义、final answer owner、取消术语（cancelled/skipped)。审批沿用 M0 先例——五方技术审批由用户授权 AI 代理代行并记录于 ADR 正文，不冒充真人手签；ADR 与既有 owner/不变量冲突即停止。
- **Run/Step 持久化契约(G2-2)**:run/step 与 SessionTask/child Session 的一对一或引用关系、事务边界、删除/恢复规则。`workflow_run`/`workflow_step_run` 表结构在 ADR 批准前只是设计占位，不是已授权接口。
- **Composition/Snapshot v2**:version union 编解码；M1 v1 Snapshot 可读；M2 字段不得被 M1 server 静默忽略（unknown version fail closed)。
- **Command binding 语义**：结构化指令模板的 Schema、消费者绑定、与 shell 权限的明确边界。
- 定案结果同步 `specs/v2/schema-changelog.md`。**文档改写不得丢失已定案内容**（含 M1 定案的 38 个 `session.next.*` 事件清单、children/context 只读契约、kill-switch 语义、Fingerprint 段）——只允许追加/更新状态；diff 中删除已有定案段落必须显式说明理由。

### 3.4 M3-M5 当前硬缺口（M2 不得提前实现）

- MCP V2 尚未进入 canonical Session/Location scoped Tool registration(M3)。
- Plugin Asset 不是 Installed Extension；缺 provenance/trust/pinned revision/staged rollback/quarantine(M4)。
- Code Presentation 必须使用成熟隔离引擎并证明 Native/Code 等价（M5)。
- `PermissionSaved.always` 是既有 Project 语义，不能改名冒充 once/Session/Location grant(M3 前置）。

### 3.5 M1 遗留前置项（M2 必须吸收）

以下来自 M1 总复审 §5 接受项与 technical-debt §4,M2 对应 Phase 必须闭环：

1. **资源指标缺口**:M1 50 轮矩阵只覆盖 digest 确定性与状态机迁移，未测内存/挂起 fiber。M2 Phase G 矩阵必须补齐内存增长与 fiber 泄漏指标（0 泄漏为准线）。
2. **e2e/storybook 证据缺口**:M1 未交付 e2e spec、storybook、截图/视频。M2 Phase F/G 必须交付 Playwright 真实多 Agent workflow e2e + storybook/截图证据，缺失即停止条件，不接受“声明降级”。
3. **busySeam 根治**:M2 调度测试若需要 busy 场景，优先落地实例测试装配注入点根治 technical-debt §4 条目，而不是复用全局 seam。
4. **drain 级 kill switch 裁决**:M1 kill switch 仅覆盖创建面。M2 落地根取消语义时，一并裁决是否需要执行级 kill(drain 中断），结论记录于 ADR/technical-debt。
5. LOW nits（顺路收敛，不强制）:`packages/app/src/utils/server.ts` capability 头硬编码字符串改为引用常量；M1 新 UI 文件的 `else` 收敛为 early-return。

## 4. 当前 M 的工作拆解

读取 M2 计划的每个 Phase，把它拆成最小 vertical slices。每个 slice 开始前建立：

### 4.1 Reuse table

```text
candidate | definition | callers/tests | compatibility | decision | rejection reason
```

必须查询 owner、调用方、注册路径、近邻测试和相关 Git 历史。符号查询优先 codegraph MCP；不可用时用 `rg` 和精确文件读取。字符串/flag/i18n/path 仍用 `rg`。

新增前遵循：复用 -> 删除 -> 归并 -> 重构 -> 新增。禁止复制 Session、ModeWorkspace、ToolRegistry、Permission、Agent registry、asset transaction、Workflow state 或 Plugin lifecycle owner。**§3.1 的 M0/M1 接缝是首要复用候选。**

### 4.2 验收映射

每条需求至少映射一个行为测试或明确的人工检查：

```text
acceptance | layer | red test | expected failure | green evidence | final gate
```

覆盖适用的 success、invalid、boundary、authorization、concurrency、interruption、idempotency、migration、old-client、reload/recovery、UI error/empty/loading。**M0/M1 复审教训：门禁级行为必须配行为测试（创建/fork/端点/SSE 矩阵模式已建立），不接受“实现存在但无测试”的交付。**

### 4.3 M2 Phase 范围（红/绿要点，详见 M2 计划 §3）

- **Phase A**（分支 `workflow-contract`):Workflow Execution ADR 起草并记录代行审批；Workflow graph decode、唯一 step id、agent/binding 引用、unknown step kind、cycle/unreachable、branch target、parallel join、失败策略、并发上限的 Schema 红测试先行；Composition/Snapshot v2 version union,M1 v1 可读，M2 字段不被 M1 server 静默忽略；迁移走 generator 管线。
- **Phase B**（分支 `workflow-contract` 继续）:Agent 数量边界、duplicate/conflict/hidden/stale/cross-location、per-Agent bindings、Command template decode、Workflow 全引用解析；requested/effective tools 与 token/concurrency estimate 成本预览稳定输出；M1 resolver path 语义零回归。
- **Phase C**（分支 `workflow-runtime`):`WorkflowRun`/`StepRun` typed service、表、事件；clean/existing/rerun migration、create exact retry、run/step revision CAS、事务失败无孤儿、恢复重建 ready frontier、root/step delete lifecycle、event payload 与 DB 一致；与 SessionTask 单向投影/引用；ready frontier 纯计算；所有状态转换经一个 state machine,handler/runner/App 不直接改表。
- **Phase D**（分支 `workflow-runtime` 继续）：串行只在前置成功后调度；并行尊重最大并发；分支只消费结构化 step result；每个 dispatch success/failure/cancel/interruption 都 settle Task + StepRun，无 orphan `in_progress`；根取消停止活动 child，未开始 step 按 ADR 术语标记；进程恢复不重放已完成副作用，不确定 provider work 按 Session V2 显式 resume 规则阻断；用 Scope/Deferred/SessionStatus，不用 sleep。
- **Phase E**（分支 `workflow-security`)：每 step Agent 必须在 Snapshot pool;child create 再检查；Workflow/Command 不提升权限；跨 Agent Prompt/Skill 不串扰；最大深度/并发 fail closed;CLI/Judge/MCP/Plugin 仍拒绝；每 child 使用 agent-specific Snapshot view 与 PermissionEffective。
- **Phase F**（分支 `workflow-surface`):start/status/cancel/retry 端点 auth、idempotency、event replay,SDK 重新生成；Builder Agent pool/DAG preview/成本预览；timeline step progress；单步和根取消；部分成功/失败/重试 UI;reload 恢复；responsive/a11y/18 locale parity;UI 只投影 Run/Step state，不在客户端推演 ready frontier 或成功语义；**必须交付 Playwright e2e（真实多 Agent workflow)与 storybook/截图证据**。
- **Phase G**（分支 `workflow-surface` 或独立短分支）：覆盖 1/2/N Agent、串行/并行/分支、取消竞态、部分成功、进程重启、stale revision、permission deny；验证一个 step 失败不会把已完成结果伪装成全部失败/成功；验证 root 始终拥有最终回答和取消权；稳定性矩阵补**内存增长与挂起 fiber 指标**;Work 引导模式文案更新；同步 ADR/PRD/Roadmap/technical debt/schema changelog/operator notes。

M2 硬性非目标：MCP(M3)、Plugin runtime(M4)、Code Presentation(M5)、external CLI、judge、scoped grant 语义改造。

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

### 5.2 Tool/Permission/Session/Workflow 红线

- Tool definition filtering 不是授权；leaf Permission assert 仍是最终边界。
- definitions 与 captured settle 必须来自同一 effective registrations。
- **每条委派/调度路径必须 settle success/failure/cancel，不能留下 orphan `in_progress`。**
- 事件 payload、DB row、SessionTask 投影、返回 Info 必须一致；日志只记稳定分类/digest，不记完整 prompt/output/secret/path。
- Session V2 durable admission、process-local drain、Context Epoch、interrupt、fork/move 不变量保持。
- Snapshot bytes/digest 写入后不可 update；任何运行依赖检查经 `SessionComposition` 单点。
- Workflow 不提高自身或任一 Agent/父 Session 的权限上限；不建第二 permission engine。
- 分支条件只消费结构化 step result;`StepDef.input` 不得解释为可执行代码。

### 5.3 UI 红线

- 复用 ModeRoute/ModeWorkspace/render-all typed slots/timeline/composer/side panel/Location owner。
- 新 UI 使用 shared v2 components/tokens、现有 icon library、i18n、a11y；不硬编码颜色/视觉间距/圆角。
- 无页面 card 套 card；Builder 宽屏为主区 unframed layout，窄屏用 tabs/steps/drawer。
- 覆盖 desktop/narrow、light/dark、keyboard/focus、empty/loading/error、English/Chinese/Traditional Chinese overflow；不得 overlap/clipping。
- UI 只投影 Run/Step state；ready frontier 与成功语义只由服务端裁定。

### 5.4 测试与报告真实性红线（M1 复审教训，违反即交付拒绝）

- 完成/复查报告中的每个测试数字必须可复制粘贴自真实命令输出；顾问将独立复跑，**虚报测试结果（含把红报绿）一律 REJECT**。
- 不得在生产模块引入全局可变测试 seam;busy/并发场景用真实 drain 构造，或先落地测试装配注入点（technical-debt §4 根治项）。
- 文档改写不得丢失已定案内容；schema-changelog/roadmap/technical-debt 只允许追加或状态更新，删除既有定案段落必须显式说明理由。

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

只选当前 slice 受影响的命令；M2 最终门禁按 M2 计划 §5 全量执行：

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

# App/UI(e2e/storybook 为 M2 强制交付物)
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

M2 Phase A-G 全部完成后：

1. 运行 M2 计划 §5 的最终协议与测试矩阵（含 migration 证据、HTTP exerciser、E2E、benchmark、Storybook、资源指标）。
2. 对比完整 diff 与最新 `origin/main`，检查 scope creep、dead/duplicate code、generated churn、兼容、秘密、任意 sleep/cast/吞错。
3. 同步 ADR/PRD/spec/schema changelog/Roadmap/technical debt 的实际状态（含 §3.3 全部契约定案与 §3.5 遗留项闭环）。不能把 pending 写成 delivered。
4. 输出 M2 完成报告，然后**停止等待高级全栈顾问统一审批**；不要进入 M3。
5. 未经交付批准，不 commit/push/PR。获批后按 `quality-to-pr` 确认 issue、remote、base、branch、commit/PR title、最终 checks，再交付并 read back CI。

建议完成报告：

```text
M completion:
- M / baseline / branch / commits:
- Gate evidence(G2-0 至 G2-4):
- Scope and non-goals:
- Reused owners(含 M0/M1 接缝):
- Five-layer changes:
- TDD slices and red/green evidence:
- Tests/typechecks/HTTP/SDK/migration/E2E/benchmark/资源指标:
- Security and protocol review:
- Rollout/rollback(稳定性矩阵含内存/fiber):
- M1 遗留项闭环证据(§3.5 五项):
- Remaining risks or blocked checks:
- Proposed next M (not started):
```

## 9. 必须立即停止的情况

- M1 未合入或未稳定，或 G2-1/G2-2/G2-3/G2-4 任一无批准证据，或最新 main 与计划的关键 owner/不变量冲突。
- 无法定义唯一 durable run/step owner，或需要在 Profile/Task/Session 三处复制状态。
- Workflow `input: unknown` 被直接解释为可执行代码/命令；分支条件执行任意表达式。
- 任一调度路径可能留下 orphan `in_progress`。
- Workflow/Command 可能提升任一 Agent 或父 Session 权限上限。
- 需要 MCP/Plugin/Code Presentation 才能完成基本 workflow。
- Custom 仍可能落到 V1、无 Snapshot 执行或旧 client 误解为 Coding。
- 需要创建第二 Session/Tool/Permission/ModeWorkspace/Agent/Workflow/Plugin owner。
- 需要信任客户端 Plan/Snapshot、把 secret/executor 存 Snapshot、把 run 状态写回 Profile/Workflow 资产。
- 任一 applicable test/typecheck/migration/HttpApi/SDK/lint/E2E/security check 失败。
- 只能靠 `as any`、`@ts-ignore`、任意 sleep、broad mock、吞异常、跳 hook、假测试、全局可变测试 seam 继续。

停止报告必须包含：已读文件、代码证据、失败命令与关键输出、已尝试方案、未改/已改文件、需要哪个 owner 作何决策。不要猜接口或自行跨 Gate。

<!-- PROMPT END -->

## 使用说明

| 项           | 值                                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| 复制范围     | `<!-- PROMPT START -->` 到 `<!-- PROMPT END -->`                                                           |
| 当前安全起点 | M2 Phase A（前提：M1 PR 已合入 main；G2-0 以 M1 总复审 APPROVED 为准）；从 M1 合入后的最新 `main` 建短分支 |
| 自动继续范围 | M2 Phase A-G 内，slice 验证全绿后自动继续                                                                  |
| 强制停止点   | Gate 证据缺失、跨 M、测试失败、owner/协议冲突、每个 slice PR 交付前                                        |
| 分支原则     | 每个可合并 slice 从前置合入后的最新 main 新建短分支，不用 M2 巨型分支                                      |
| 卡住时       | 输出停止报告，不绕过 Gate 或测试                                                                           |
