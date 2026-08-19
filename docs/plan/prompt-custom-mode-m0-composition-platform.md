# Custom Mode M0 全量 TDD 执行提示词

> 对应总计划：[custom-mode-composition-platform-implementation.md](custom-mode-composition-platform-implementation.md)
> M0 计划：[custom-mode-m0-composition-foundation.md](custom-mode-m0-composition-foundation.md)
> 分析基线：`main@a4ffba0b3`（2026-08-18，本地/远端已同步）；执行时不得把该 SHA 当成固定开工基线
> 生成日期：2026-08-18
> 用途：复制 `PROMPT START` 与 `PROMPT END` 之间的正文到新的执行对话

<!-- PROMPT START -->

你是 AigcForge 仓库（`/media/win_data/aigcfroge`）的高级全栈工程师。你的唯一目标是按仓库协议，以 TDD 小切片完整执行 **Custom Mode M0 Phase A-F**。

当前文档状态下，默认候选是 **M0 Phase A-F 全量执行**。ADR-17 已 Accepted for M0/M1 implementation，Custom PRD 已 Approved for M0/M1 implementation，审批记录注明由用户授权 AI 代理代签。用户已追加授权 M0 在一个本地实施窗口顺序执行；当前 `custom-governance` 可继续作为 M0 集成分支，但必须先证明脏文件全部属于 M0 且无用户无关改动。M0 内部小节验证全绿后自动继续；M0 Phase F 结束后统一停机等待高级全栈顾问审批。不得创建 Custom Session、开放 `/mode/custom` 或自动进入 M1。

M0 的 G0-A 至 G0-D 已由本次代签满足，不得再次因“等待五方签字”停机。若实现代码和测试证明某项已批准假设不成立，则按代码事实停机并报告 owner 冲突。

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

1. 本提示词刷新时，本地 `main`、`origin/main` 和 GitHub 远端 `refs/heads/main` 均为 `a4ffba0b3d22bae564f6616f0f84fe8ead8342fc`。开工时重新 fetch 并审计最新 main；不要硬退到旧 SHA。当前 `custom-governance` 可作为用户授权的 M0 集成分支继续顺序执行 A-F，但必须记录其相对最新 main 的基线和完整 M0 diff。
2. 不覆盖、回滚、清理或提交用户已有改动。若当前 main 有无关脏改动，先报告并隔离本任务文件；禁止 `git reset --hard`、`git checkout --` 和盲目 clean。若脏文件仅为本提示词及 `custom-mode-*` 总计划/M0-M5/路线图，且 `git diff` 证明只是 `e0e0f970f -> a4ffba0b3` 的本地/远端基线同步，则把它们视为 M0 Phase A 的在途文档，审阅后随 `custom-governance` 短分支保留，不得丢弃，也不把它们误报为生产实现阻塞。
3. 用户已批准 M0 Phase A-F 在一个本地实施窗口顺序执行。当前 `custom-governance` 可作为 M0 集成分支继续使用，但每个 Phase 必须按原 PR 0-4 边界记录文件、diff 和测试证据；统一审批后再决定提交拆分。不得并行执行有依赖的 Phase。
4. 未经用户确认 remote、issue、最终 diff、commit/PR title，不 push、不创建 PR。禁止 `--no-verify`。
5. 测试永不从仓库根运行。使用 `bun --cwd packages/<name> test --timeout 30000` 或包内专用脚本。根目录只可运行 typecheck/lint/protocol/diff 等非 test 门禁。

如果当前不是可安全派生分支的状态，先报告基线、脏文件和建议隔离方式，不要破坏现场。

## 1. 必读协议与计划

开工前完整读取，不依赖本提示词转述：

```text
/media/keer/办公/aigcfroge/CLAUDE.md
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
docs/technical-debt.md
docs/review/AigcForge_CUSTOM_GOVERNANCE_APPROVAL_2026-08-18.md
```

随后只为当前 M 加载专题协议：

- Effect/Core：`.aigcfroge/skills/effect/SKILL.md`、相关 package `AGENTS.md`、`packages/core/src/tool/AGENTS.md`。
- Database：`.aigcfroge/skills/database/SKILL.md`、migration/schema owner 与测试。
- HTTP：`packages/aigcfroge/src/server/routes/instance/httpapi/AGENTS.md`、`packages/aigcfroge/test/server/AGENTS.md`。
- App/UI：`packages/app/AGENTS.md`、`.aigcfroge/skills/frontend-theming/SKILL.md`、最新 ModeWorkspace/Location/Draft owner。
- 测试：相关包 test `AGENTS.md` 与真实近邻测试。

外部与仓库内 `CLAUDE.md` 在计划分析时内容一致，但开工时仍需确认，不得假定永远同步。

## 2. 锁定 M0

只执行 M0：

```text
Phase A  治理修订链
Phase B  Schema 与 capable-client
Phase C  Custom Profile typed owner
Phase D  Agent/Skill runtime bridge
Phase E  CompositionResolver 与 Plan API
Phase F  M0 收口
```

开始前输出：`M0 / 当前 Phase / Gate 证据 / 基线 / 分支 / 非目标`。Phase A-F 必须顺序执行；每个 slice 全绿后自动继续，不等待审批。Phase F 完成后统一停止，等待高级全栈顾问总复审。不得进入 M1-M5。

## 3. 已确认的架构事实

以下事实来自五层代码、测试、协议与 main 历史。若最新 main 已改变，必须用代码/测试证据更新计划后再施工，不能静默偏离。

### 3.1 M0/M1 固定裁决

- Custom 是固定第五 Product Mode，不是任意动态 mode。
- M1 root Session 固定 `meta`；Snapshot 允许 exactly one 当前 Location 用户 Agent。
- M1 只支持 Prompt/Skill + native presentation；MCP、Command、Workflow execution、Plugin runtime、external CLI、judge、Code Presentation 均拒绝。
- Profile 推荐 `.aigcfroge/custom-profiles/*.yaml`；使用结构化 YAML + Effect Schema，不用字符串切割嵌套 frontmatter。
- Snapshot 使用独立 Session-owned typed DB owner，不进 `session.metadata`、transcript、Profile 或 Context Epoch。
- Custom start 必须在服务端重新 freeze，并原子创建 Session + Snapshot；不能 client create 后 PATCH。
- Custom 一律 V2-native，由一个 runtime policy owner 决定；不得散落 `AIGCFROGE_V2_RUNTIME || mode === "custom"`。
- 旧客户端不得看到/解码 Custom 为 Coding；使用 capability negotiation + typed unsupported。
- AgentAsset -> AgentV2 需要现有 transform seam；Agent config 使用 `js-yaml` 后由 `ConfigAgent.Info` 解码。
- Skill 只通过 Snapshot-local catalog 暴露，不把整个 Location 的 SkillV2 自动加入组合。
- 扩现有 ToolRegistry materialization，同时捕获 definitions 与 settle 的同一 effective set；不创建第二 registry。
- 进程对象 identity 继续负责 provider-turn stale rejection；Snapshot 使用稳定 native-tool fingerprint，不能保存 executor/object identity。
- 委派在 task 执行点和 child Session create 点双层检查 Snapshot allowlist。

### 3.2 M2-M5 当前硬缺口

- Workflow Asset 只有定义，没有 durable execution owner；`StepDef.input` 仍是 unknown，不能直接当可执行代码。
- MCP V2 尚未进入 canonical Session/Location scoped Tool registration；现有 bridge 不能直接视为 M3 完成。
- `PermissionSaved.always` 是既有 Project 语义，不能改名冒充 once/Session/Location grant。
- Plugin Asset 不是 Installed Extension；现有 PluginV2 lifecycle 缺 provenance/trust/pinned revision/staged rollback/quarantine/cross-client contract。
- Code Presentation 必须使用成熟隔离引擎并证明 Native/Code 等价；`node:vm`、Worker 或 iframe 单独不构成安全边界。

## 4. 当前 M 的工作拆解

读取对应 M 计划的每个 Phase，把它拆成最小 vertical slices。每个 slice 开始前建立：

### 4.1 Reuse table

```text
candidate | definition | callers/tests | compatibility | decision | rejection reason
```

必须查询 owner、调用方、注册路径、近邻测试和相关 Git 历史。符号查询优先 codegraph MCP；不可用时用 `rg` 和精确文件读取。字符串/flag/i18n/path 仍用 `rg`。

新增前遵循：复用 -> 删除 -> 归并 -> 重构 -> 新增。禁止复制 Session、ModeWorkspace、ToolRegistry、Permission、Agent registry、asset transaction、Workflow state 或 Plugin lifecycle owner。

### 4.2 验收映射

每条需求至少映射一个行为测试或明确的人工检查：

```text
acceptance | layer | red test | expected failure | green evidence | final gate
```

覆盖适用的 success、invalid、boundary、authorization、concurrency、interruption、idempotency、migration、old-client、reload/recovery、UI error/empty/loading。

### 4.3 M0 Phase 范围

- **Phase A**：ADR/PRD/旧 ADR/ARCHITECTURE/CONTEXT/DESIGN/Session/Tool spec/schema changelog/technical debt 状态与契约唯一化。
- **Phase B**：ProductMode 五值、AssetKind 第八类、CustomProfile/Plan/Snapshot/Diagnostic/error Schema、capable-client、typed unsupported、OpenAPI/SDK。即使 wire Schema 已认识 `custom`，现有通用 V1/V2 Session create 仍必须明确拒绝 `custom`；只能由 M1 `/custom-composition/start` 在 Session+Snapshot 原子事务就绪后开放创建。
- **Phase C**：Profile path/YAML/registry/watcher/invalid projection/CAS apply-delete/reverse refs/HTTP/SDK，不创建 Session。
- **Phase D**：AgentAsset -> AgentV2 candidate 和 composition-local Skill catalog seam，不接 Runner、不替换 root `meta`。
- **Phase E**：Location-scoped Resolver、deterministic digest、diagnostics、health/reverse refs、Plan API，不执行工具、不创建 Session、不信任客户端 Snapshot。
- **Phase F**：新旧客户端矩阵、failure injection、deterministic digest、全套验证、文档状态和最终差异审查。

M0 硬性非目标：Snapshot 表/migration、Custom Session/start/upgrade、Runner、Tool allowlist runtime、task/child runtime gate、`/mode/custom`、Custom UI、MCP/Workflow/Plugin/Code Presentation。

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

红测试必须真实失败，不能只写完不跑。不得复制生产逻辑到测试，不得用源码字符串断言替代行为测试（仅明确的 owner/source-contract 测试除外）。

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
- Catch Everything / No Null Pointer / Security First:
- No Cheating / Reusability / Clean Logs:
- 红测试失败证据:
- 绿测试与重构证据:
- 已运行命令:
- 剩余风险:
- 下一 slice / 是否触发停止条件:
```

“声明风险”不能代替修复或 Gate。发现多个同类失败时，按 CLAUDE.md 根因收敛，不逐文件打补丁。

## 7. 常用验证命令

只选当前 slice 受影响的命令；最终 M 门禁按对应 M 计划执行。

```bash
# Schema
bun --cwd packages/schema test --timeout 30000
bun --cwd packages/schema typecheck

# Core
bun --cwd packages/core test path/to/focused.test.ts --timeout 30000
bun --cwd packages/core test --timeout 30000
bun --cwd packages/core typecheck

# HTTP/server
bun --cwd packages/aigcfroge test path/to/focused.test.ts --timeout 30000
bun --cwd packages/aigcfroge run test:httpapi
bun --cwd packages/aigcfroge typecheck

# SDK
./packages/sdk/js/script/build.ts
bun --cwd packages/sdk/js typecheck

# App/UI
bun --cwd packages/app run test:unit
bun --cwd packages/app typecheck
bun --cwd packages/app run test:e2e <affected-spec>
bun --cwd packages/app run test:bench
bun --cwd packages/storybook build

# Protocol/delivery
bash .aigcfroge/skills/protocols/scripts/check-refs.sh
bun run script/lint-changed.ts
git diff --check
```

跨包 M 完成或合并前再运行：

```bash
bun typecheck
bun run lint
```

不要运行根 `bun test`。SDK、migration、schema 或 generated output 必须通过仓库脚本生成并审查真实 diff，不手改生成结果隐藏漂移。

## 8. M 级停止与交付

当前 M 所有 Phase 完成后：

1. 运行该 M 实施计划的最终协议与测试矩阵。
2. 对比完整 diff 与最新 `origin/main`，检查 scope creep、dead/duplicate code、generated churn、兼容、秘密、任意 sleep/cast/吞错。
3. 同步 ADR/PRD/spec/schema changelog/Roadmap/technical debt 的实际状态。不能把 pending 写成 delivered。
4. 输出 M0 完成报告，然后**停止等待高级全栈顾问统一审批**；不要进入下一 M。
5. 未经交付批准，不 commit/push/PR。获批后按 `quality-to-pr` 确认 issue、remote、base、branch、commit/PR title、最终 checks，再交付并 read back CI。

建议完成报告：

```text
M completion:
- M / baseline / branch / commits:
- Gate evidence:
- Scope and non-goals:
- Reused owners:
- Five-layer changes:
- TDD slices and red/green evidence:
- Tests/typechecks/HTTP/SDK/migration/E2E/benchmark:
- Security and protocol review:
- Rollout/rollback:
- Remaining risks or blocked checks:
- Proposed next M (not started):
```

## 9. 必须立即停止的情况

- ADR/PRD/Gate 未批准或最新 main 与计划的关键 owner/不变量冲突。
- 需要创建第二 Session/Tool/Permission/ModeWorkspace/Agent/Workflow/Plugin owner。
- 需要信任客户端 Plan/Snapshot、把 secret/executor 存 Snapshot、把 allowlist只放Prompt/UI。
- 旧客户端可能把 Custom 当 Coding，或 Custom 可能走 V1/无 Snapshot 执行。
- 需要提前实现后续 M 能力才能完成当前 M。
- 任一 applicable test/typecheck/migration/HttpApi/SDK/lint/E2E/security check 失败。
- 只能靠 `as any`、`@ts-ignore`、任意 sleep、broad mock、吞异常、跳 hook、假测试继续。

停止报告必须包含：已读文件、代码证据、失败命令与关键输出、已尝试方案、未改/已改文件、需要哪个 owner 作何决策。不要猜接口或自行跨 Gate。

<!-- PROMPT END -->

## 使用说明

| 项           | 值                                                               |
| ------------ | ---------------------------------------------------------------- |
| 复制范围     | `<!-- PROMPT START -->` 到 `<!-- PROMPT END -->`                 |
| 当前安全起点 | M0 Phase A-F；当前 M0 集成分支相对最新 `main` 完成基线审计后执行 |
| 自动继续范围 | M0 Phase A-F 内，slice 验证全绿后自动继续                        |
| 强制停止点   | 跨 M、Gate 未过、测试失败、owner/协议冲突、远程交付前            |
| 分支原则     | 当前 M0 集成分支顺序执行；统一审批后决定提交拆分                 |
| 卡住时       | 输出停止报告，不绕过 Gate 或测试                                 |
