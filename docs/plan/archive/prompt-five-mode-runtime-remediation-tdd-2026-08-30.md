# 五模式运行时修整：受审批门控的 TDD 执行提示词

> 对应总计划：[five-mode-runtime-remediation-tdd-workflow-2026-08-30.md](five-mode-runtime-remediation-tdd-workflow-2026-08-30.md)
> 结构模板：[prompt-custom-mode-m0-composition-platform.md](prompt-custom-mode-m0-composition-platform.md)
> 生成日期：2026-08-30
> 用途：复制 `PROMPT START` 与 `PROMPT END` 之间的正文到新的执行对话。
> 当前授权：**仅 S-1、S0、S0.5 的证据扫描和 RED 测试。不得修改生产代码、不得进入任何 GREEN、不得创建实施分支，直到高级全栈顾问书面批准具体 Slice。**

<!-- PROMPT START -->

你是 AigcForge 仓库（`/media/win_data/aigcfroge`）的高级全栈工程师。你的目标是为“五模式运行时与组合平台代码族修整”完成**受审批门控的 TDD 前置实施**，并向高级全栈顾问提交可审计证据，供其决定后续 Slice 是否可以进入 GREEN。

适用模式：Chat、Coding、Work、Assistant（个人助理）、Custom（自定义）。

你不是自由重构代理。你必须遵循“识别假设 → 追溯本源 → 重构方案 → 精简输出”和“复用 → 删除 → 归并 → 重构 → 新增”。多个问题同时出现时，按共同根因收敛，禁止逐文件打补丁。

## 0. 当前授权、硬边界与开工门禁

### 0.1 当前唯一授权

本次只允许执行以下阶段：

```text
S-1：代码族 owner/reuse + 计划归属证据扫描
S0：冻结五模式行为矩阵、协议决策与 RED 基线
S0.5：测试解锁——移除 false contract 与测试污染
```

在收到高级全栈顾问对某个具体 Slice 的书面 GREEN 授权前：

- **不得修改生产代码**；
- **不得创建实施分支**；
- **不得进入 S1–S10 的 GREEN/REFACTOR**；
- 不得改变数据库、Schema、Snapshot、HTTP API、SDK generated files、App 运行时代码；
- 不得自行裁决 D13 的产品二选一，或并行计划的 code owner；
- 不得 commit、push、创建 PR、改 remote 或使用 `--no-verify`。

允许：只读审计、运行现有测试、在获得同一轮明确允许时新增/修订**RED 测试**，以及在任务报告中给出最小实现建议。若用户没有明确授权写测试，则保持完全只读。

### 0.2 开工门禁

先执行并记录原始输出：

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

1. 文档生成时的基线是 `main` / `origin/main` = `0ed9e6ed91ca24689e089d945ceb80b8a3787d85`；它仅用于对照，**执行时必须以 fetch 后的最新事实为准**，不得硬退回旧 SHA。
2. 不覆盖、回滚、清理、提交用户已有改动。禁止 `git reset --hard`、`git checkout --`、盲目 `git clean`。
3. 当前方案文档可能是未跟踪文件。它不是生产改动；先记录，不得擅自删除、提交或与其他用户改动混合。
4. 如果 `main`、`origin/main` 或远端 `refs/heads/main` 不一致，或存在无关脏改动，先报告基线与隔离建议，停止实施。
5. 所有测试必须从包目录执行；禁止根目录 `bun test`。根目录仅可运行 lint、typecheck、protocol、diff 等非 test 门禁。

## 1. 必读协议、计划与 Skills

开工前完整读取以下文件；不要只信本提示词的转述：

```text
CLAUDE.md
AGENTS.md
ARCHITECTURE.md
CONTEXT.md
DESIGN.md
docs/testing.md
docs/technical-debt.md
docs/plan/five-mode-runtime-remediation-tdd-workflow-2026-08-30.md
docs/plan/v2-architecture-governance-slice-0-3.md
docs/plan/v2-ux-trust-foundation.md
docs/plan/mode-page-unification-v2.md
.aigcfroge/skills/protocols/SKILL.md
.aigcfroge/skills/effect/SKILL.md
.aigcfroge/skills/database/SKILL.md
.aigcfroge/skills/enterprise-code-standard/SKILL.md
.aigcfroge/skills/reuse-first-refactor/SKILL.md
.aigcfroge/skills/quality-to-pr/SKILL.md
```

按触达目录继续读取最近的 `AGENTS.md`，至少包括：

```text
packages/aigcfroge/AGENTS.md
packages/aigcfroge/src/server/routes/instance/httpapi/AGENTS.md
packages/aigcfroge/test/AGENTS.md
packages/aigcfroge/test/server/AGENTS.md
packages/app/AGENTS.md
packages/core/src/tool/AGENTS.md
```

查找规则：符号定义、调用链、影响面优先用 codegraph MCP；若本会话没有 codegraph，才用 `rg`、精确 `sed`/Read 和包内类型/测试命令。字符串 literal、错误文案、feature flag、路径 glob 必须用 `rg`，不得臆测接口或手写平行 owner。

事实优先级：

1. 当前 `main` 的代码、数据库 Schema 与真实行为测试；
2. 根协议、Accepted ADR、PRD/spec、用户后续批准记录；
3. 两者冲突时登记 drift，停止并请求 owner/用户裁决；代码不能静默 supersede 已接受 ADR。

## 2. 已确认根因与必须复核的关键事实

总计划的诊断已获有条件批准。以下是本轮必须在 S-1/S0 重新以最新 `main` 证明的根因；不要依赖旧行号。

### 2.1 Snapshot / consumer runtime

- V2 同时存在 `bindings` 与顶层 flat `instructions/prompts/skills/commands`；Runtime 当前消费 flat projection，consumer 隔离未闭环。
- Snapshot V1 没有 `bindings`；早期 V2 可能借 decoding default 得到 `{}`，不能误判为合法空 binding。
- `SnapshotBindingData` 当前未完整承载 agent/system instructions；只补 Prompt/Skill/Command 不够。
- `ConsumerKey` 的字符集与 `AgentAsset.Name` 的 Unicode 能力不一致。展示名不得被 machine key 限制。
- `resolve()` 后 `freeze()` 二次读取 live assets 可能产生 TOCTOU 半空 Snapshot。

目标不是立即禁用所有 flat fields，而是：为新 Snapshot 建立完整、可识别版本的 frozen consumer runtime graph；V1 和 pre-binding V2 走显式 compatibility view；只有新 graph 的 Runtime 禁读 flat fields。

### 2.2 Durable admission / policy / events

- Prompt、selection、synthetic、wake 没有单一 Core-owned atomic submission owner。
- `EventV2` 跨连接 publish deadlock 是 D2 的具名风险；不得把既有多个 `admit*` 简单包进一个 transaction。
- 正常业务拒绝不能通过 `Effect.die` 变为 defect；非法 switch 不能先持久化、再由 Runner 拒绝。
- Skill promotion 必须使用 admission timestamp；`SyntheticAdmitted` 必须进入 Durable/All/public stream。

正确事务边界：同一 transaction 写 selection、durable input 与 durable event；commit 后才 publish 和最多一次 wake；post-commit delivery 必须幂等、可观测、可重试。

### 2.3 Prompt / attachment / command

- legacy `prompt_async` 可能只取首段 text、丢 messageID/model/variant/agent/附件/多段 text，并吞掉错误。
- 纯附件不可被当成空 prompt 丢弃；`file://` 等 URI 必须在 provider lowering 前 materialize 或 typed reject。
- Command Snapshot conversion、App Composer 和 runtime 存在重复且有损的手写转换；Command 必须复用普通 Prompt 的完整 context。
- 旧 Snapshot Command 缺完整 frozen contract 时必须 fail closed，禁止从 live/global catalog 回填能力。

### 2.4 Location / App / test truth

- Custom Draft、Provider、Router 参数、SDK Location、server scope、workspaceID 不是单一 identity，可能串数据。
- `sharedStores` 是仍有运行时消费者的迁移/cutover owner，不是可直接删除的死代码。
- Start/Upgrade 可能忽略后端真实 Session ID，转而打开新 Draft。
- 源码字符串测试会把错误实现钉成“契约”；`custom-preview-column` 可能受跨测试进程 Router mock 泄漏影响。

### 2.5 handoff 的新增 P1

App/TUI handoff 会传递 V2 fork 的 `prompt/agent`，而 handler 可能只 lower `messageID`。这是“创建 child 并导航成功，但 prompt 未 admission、agent 未切换”的静默失效活功能。

D13 尚未由用户作最终产品裁决。最终只能二选一：

1. 原子 durable fork submission：fork + frozen child selection + Prompt/synthetic + post-commit wake；
2. Schema/OpenAPI/SDK/App/TUI/Handoff UI 端到端移除。

在裁决前，若发现 modifier 仍被忽略，必须建议 typed fail-closed 的临时保护；不得自行实现最终方案。

## 3. S-1：必须交付的证据与 owner ledger

先建立 owner/reuse 证据，不写 GREEN。每个候选符号/模块记录：

| 字段          | 必填内容                                                                   |
| ------------- | -------------------------------------------------------------------------- |
| candidate     | 符号、模块或数据结构                                                       |
| definition    | 唯一定义与 canonical owner                                                 |
| callers       | 上游入口和下游消费者                                                       |
| registration  | Layer、HttpApi、registry、SDK/OpenAPI 注册点                               |
| persistence   | table/event/snapshot/local storage/query owner                             |
| nearest tests | 最近真实行为测试及覆盖缺口                                                 |
| compatibility | V1/V2、old Snapshot、SDK、migration 边界                                   |
| decision      | keep / reuse / delete / merge / simplify / owner-decision / false-positive |
| reason        | 代码证据、风险、替代方案                                                   |

必须完成以下 owner 与顺序 ledger，空白项即为停止条件：

| 代码族                             | 必须裁定                                                                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| durable admission / lifecycle      | 本计划 S2 与 `v2-architecture-governance-slice-0-3.md` 谁是唯一实现 owner；特别是 `session/input.ts`、`session.ts`、`session/event.ts`、`session/projector.ts`。 |
| Custom Draft / Provider / Location | 本计划 S6 与 `v2-ux-trust-foundation.md` 谁可以改 `custom-draft.tsx`、`use-providers.ts`、Custom 面板与导航 owner。                                              |
| ModeWorkspace                      | `mode-page-unification-v2.md` 与本计划 S6 谁拥有 `mode-workspace*` / slots 的语义；不得破坏现有 render-all + display:none 不变量。                               |
| SDK/OpenAPI                        | tracked spec、V1 `src/gen`、V2 `src/v2/gen`、root `script/generate.ts` 与 SDK build 的 owner、再生命令、冻结/迁移策略。                                          |

S-1 输出必须明确每项的：唯一实施 owner、允许触达文件、其他计划角色、前置条件、合并顺序。没有这张表，不得创建并行 owner。

## 4. S0：五模式 RED 基线

只用可观察行为断言，禁止测试源码是否包含函数名、字符串或 import。

### 4.1 五模式矩阵

对 Chat、Coding、Work、Assistant、Custom 分别验证：

```text
create / read / prompt / command / shell / switchAgent / switchModel
interrupt / wait / compact / share / fork / resume
× legacy / canonical surface
× capability present / missing
× kill switch on / off
```

必须证明：

- session missing 才返回 404；
- capability missing 为 typed unsupported；
- runtime disabled 为 typed disabled；
- policy rejection 不调用 provider、不写 event、不改 row；
- Custom root 只见 `orchestrator`；child 只见 `agents/<frozen-consumer-key>`；同名/Unicode 展示名不造成 key 碰撞；
- child 之间不泄漏 Agent instruction、Prompt、Skill、Command；unbound asset 不可见、不可加载、不可执行。

### 4.2 必须捕获的 RED 基线

逐项记录“未改生产代码时”的命令、实际失败输出、对应 owner、是否命中预期根因：

1. `prompt_async` 多 text、纯附件、messageID、agent/model/variant、synthetic 与错误可见性。
2. Skill admission 后推进时钟再 drain；timestamp 不得变成 promotion time。
3. `SyntheticAdmitted` 的 durable/public union。
4. Custom Start/Upgrade 必须导航到后端返回的准确 Session，而非新 Draft。
5. handoff fork modifier：child 创建后应有 durable selection/prompt；现状若没有，记录完整链路。
6. Snapshot V1、pre-binding V2、新 graph 的识别；新的 complete graph 缺 consumer 才 fail closed，旧 Snapshot 不得被误判为空 catalog。
7. D2 transaction/event boundary 的最小 deadlock/commit-before-wake 复现路径。

若某项 RED 在未改生产代码时已通过，不能硬写成 bug；记录代码事实、缩小/撤回假设，并停止等待顾问修订计划。

## 5. S0.5：测试解锁与隔离

在任何 S6/ModeWorkspace/Custom Preview 运行时代码改动之前完成。此阶段只可改测试或抽取 browser-safe test seam；不得顺带重构业务逻辑。

必须：

1. 审计 `packages/app/src/pages/mode-launch-contract.test.ts`、`packages/app/src/pages/location-owner-contract.test.tsx` 与相邻源码字符串测试，改为 public API、可观察 state 或用户行为断言。
2. 在独立 Bun 进程运行 `packages/app/src/components/custom/custom-preview-column.test.ts`，并比较隔离运行与全量 suite；找到并消除 `@solidjs/router` / process-global mock 泄漏。
3. 将 `classifyPlanFailure` 放在 browser-safe pure owner，或用窄组件测试覆盖真实边界；纯测试不得导入 Router/UI graph。
4. 测试不得复制 production filter/reduce/parser，不得依赖兄弟测试执行顺序。

建议命令：

```bash
bun --cwd packages/app test --preload ./happydom.ts ./src/components/custom/custom-preview-column.test.ts
bun --cwd packages/app test --preload ./happydom.ts ./src/pages/mode-launch-contract.test.ts ./src/pages/location-owner-contract.test.tsx
bun --cwd packages/app test:unit
```

完成 S0.5 后停止，向高级全栈顾问提交测试文件、RED/GREEN 证据和对 S6 的影响；**不得自动进入 S1 或 S6**。

## 6. 已批准后才可进入的后续 Slice 地图

这张表只用于准备审批，不授权实施：

| Slice | 目标                                                                                               | 进入 GREEN 的前置条件                                       |
| ----- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| S1    | 完整 consumer runtime graph、stable consumerKey、V1/pre-binding V2 compatibility、freeze 无 TOCTOU | D4/D5 schema 与 compatibility 方案获批，owner ledger 无冲突 |
| S2    | Core atomic durable submission、post-commit publish/wake                                           | D2 deadlock RED 已复现，Core lifecycle owner 获批           |
| S3    | policy/mutation/event/timestamp correctness                                                        | S2 durable contract 已冻结                                  |
| S4    | legacy prompt adapter 与 attachment materialization                                                | S2 admission owner 已冻结                                   |
| S5    | Snapshot Command fidelity/runtime/API/Composer                                                     | S1 frozen Command contract、D7/D8/D9 获批                   |
| S6    | App Location/Draft/Provider/navigation/round-trip                                                  | S0.5 完成，App owner 已裁定                                 |
| S7    | canonical API、legacy adapter、fork/share/profile、SDK/OpenAPI                                     | D13 产品裁决、SDK generation ledger 已获批                  |
| S8    | 测试收敛、跨层覆盖、Playwright                                                                     | S0.5 与各领域 owner 已稳定                                  |
| S9    | 删除/归并/注释/文档                                                                                | 每个删除候选均有生产消费者与 migration 退出证据             |
| S10   | 回归、故障注入、交付审查                                                                           | S1–S9 全部有真实 GREEN 证据                                 |

## 7. 强制 TDD、实现与安全红线

每个获批 Slice 都必须按以下循环，不得跳步：

```text
S-1 evidence → RED（未改生产代码可复现） → 最小 GREEN → REFACTOR → 包级门禁 → 数据流复查 → 停止等审批
```

红线：

- 不新增平行 Session/Runner/Tool/Permission/Location/ModeWorkspace owner。
- 不从 live/global catalog 回填 Snapshot 未绑定资产；不让旧 Snapshot 获得创建时不存在的 Command 能力。
- 不用 `Effect.die` 表示正常业务拒绝；不吞 `Effect.ignore` / catch-all 错误伪装成功或 empty。
- 不新增 `any`、无理由的 `@ts-ignore`、`globalThis.*` 测试逃生口、fixed sleep、broad module mock。
- 不手写或静默修改 SDK generated files；生成物只能通过获批 owner command 产生并审查真实 diff。
- 不以 typecheck 替代行为验证；2xx/204 accepted 必须可读取对应 durable state。
- 不改中文用户 i18n 文案；触及生产注释时只保留必要英文约束注释，保留 fail-closed/timestamp/transaction/Location 等非显而易见约束。
- 不在计划范围外做全仓注释翻译、namespace/import codemod 或机械死代码删除。

## 8. 可用验证命令

只运行当前触达 Slice 所需的命令；不得从仓库根运行测试。

```bash
# Schema
bun --cwd packages/schema test
bun --cwd packages/schema typecheck

# Core focused
bun --cwd packages/core test test/composition-resolver.test.ts --timeout 30000
bun --cwd packages/core test test/session-runner-custom-composition.test.ts --timeout 30000
bun --cwd packages/core test test/custom-child-provider-turn.test.ts --timeout 30000
bun --cwd packages/core test test/session-prompt.test.ts --timeout 30000
bun --cwd packages/core test test/session-projector.test.ts --timeout 30000
bun --cwd packages/core typecheck

# Canonical / legacy HTTP
bun --cwd packages/server typecheck
bun --cwd packages/aigcfroge test test/server/httpapi-promptasync-context.test.ts --timeout 30000
bun --cwd packages/aigcfroge test test/server/httpapi-session.test.ts --timeout 30000
bun --cwd packages/aigcfroge test test/server/v2-session-capability.test.ts --timeout 30000
bun --cwd packages/aigcfroge typecheck

# App
bun --cwd packages/app test:unit
bun --cwd packages/app test:virtualizer
bun --cwd packages/app typecheck
bun --cwd packages/app build

# SDK/OpenAPI: only after S-1 identifies the full generation owner.
bun ./script/generate.ts
bun --cwd packages/sdk/js typecheck
git diff -- packages/sdk/openapi.json packages/sdk/js/src/gen packages/sdk/js/src/v2/gen

# Protocol/delivery
bash .aigcfroge/skills/protocols/scripts/check-refs.sh
LINT_BASE_REF=origin/main bun run script/lint-changed.ts
bun run lint
git diff --check
```

全仓 `bun typecheck`、完整 App E2E、HTTP exerciser、SDK generated zero-diff 仅在获批 Slice 的计划门禁要求时运行；不要把未运行项目写成通过。

## 9. 停止条件与交付给高级全栈顾问的报告

出现任一情况，立即停止，不要猜接口或自行跨 Gate：

- 当前 `main` 与计划的关键 owner、协议不变量或 Approved decision 冲突；
- D13 的产品二选一、S-1 owner ledger、SDK generation strategy 仍未裁定；
- 需要改生产代码才能“证明” RED；
- 需要让 Snapshot 回退到 live/global catalog、legacy Runner，或增加平行 owner；
- 需要修改 render-all + `display:none` 的 ModeWorkspace 不变量；
- transaction/event deadlock 无法安全复现、隔离或解释；
- 某个 required test/typecheck/HTTP/SDK/lint 门禁失败；
- 只能靠 `as any`、`@ts-ignore`、固定 sleep、broad mock、吞异常、跳 hook 或假测试继续；
- 发现新的跨 Slice P0/P1。

停止时输出以下报告，交由高级全栈顾问审批：

```text
Pre-implementation report:
- 当前日期 / main / origin/main / 工作树:
- 已读协议、计划、Skills 与 package AGENTS:
- 当前授权边界；是否修改过任何文件:
- S-1 owner/reuse evidence table:
- Owner 与顺序 ledger（明确冲突与建议唯一 owner）:
- S0 五模式 RED：命令、实际输出、根因、代码证据:
- S0.5 隔离测试：单文件 vs 全量结果、mock 泄漏结论:
- D2：transaction / EventV2 publish deadlock 证据:
- D4/D5：consumerKey、Snapshot version/marker、compatibility 选项:
- D13：handoff 完整调用链、两种产品选项、临时 typed fail-closed 建议:
- SDK/OpenAPI：tracked spec、V1 gen、V2 gen、再生命令/冻结策略:
- 建议进入或阻塞的下一个 Slice:
- 需要高级全栈顾问决定的精确问题:
- 已运行命令及真实结果:
- 剩余风险、未运行门禁与原因:
```

不要声称“应该通过”“理论上没问题”。报告必须区分已证实事实、待复现假设和需要产品/owner 决策的事项。

<!-- PROMPT END -->

## 使用说明

| 项           | 值                                                                               |
| ------------ | -------------------------------------------------------------------------------- |
| 复制范围     | `<!-- PROMPT START -->` 到 `<!-- PROMPT END -->`                                 |
| 当前安全起点 | S-1、S0、S0.5 的审计、RED 与测试解锁；生产 GREEN 未授权                          |
| 强制停止点   | owner ledger、D5 compatibility、D13 产品裁决、SDK generation ledger、S0.5 完成后 |
| 交付对象     | 高级全栈顾问，由其对每个后续 Slice 作 GREEN / 停止 / 重规划审批                  |
| 分支与交付   | 本阶段不创建实施分支、不 commit/push/PR；获批后按仓库分支与 PR 协议执行          |
| 卡住时       | 返回第 9 节报告；不绕过 Gate、不把假设写成代码                                   |
