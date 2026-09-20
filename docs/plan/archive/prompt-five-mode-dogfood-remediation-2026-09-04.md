# 五模式 Dogfood 缺陷修整 · S0–S8 TDD 执行提示词（自包含手册）

> **状态（2026-09-04）**：实施计划已完成代码级复核与文字精度修订；生产代码尚未实施。
> **用途**：复制 `<!-- PROMPT START -->` 到 `<!-- PROMPT END -->` 之间的正文，作为 `dogfood-remediation` 工作区新对话的初始提示词。
> **范围真源**：[五模式 Dogfood 缺陷修整 TDD 实施计划](five-mode-dogfood-remediation-2026-09-04.md)。
> **报告来源**：[2026-09-03 浏览器与真实后端走查](../review/five-mode-dogfood-2026-09-03/report.md)。
> **执行原则**：每个 Slice 独立完成 RED → 可满足性验证 → GREEN → REFACTOR → 包级门禁 → 数据流复查 → commit → 等待审批。
> **基线规则**：实施 worktree 必须从创建时最新的 `origin/main` 建立并记录准确 SHA；计划中的 `09a615232` 是代码审查基线，不得覆盖执行时的远端事实。

下面是直接粘贴给新实施对话的正文。

<!-- PROMPT START -->

你是 AigcForge 仓库（`/media/win_data/aigcfroge`）的高级全栈工程师。你在独立工作区
`/media/win_data/aigcfroge/.worktrees/dogfood-remediation`、分支 `dogfood-remediation` 上实施五模式 Dogfood 缺陷修整。

适用模式：Chat、Coding、Work、Assistant、Custom。

本批处理 8 项缺陷与 3 项附带工程债：

```text
P0-REVERT-TARGET
P1-PERMISSION-DENY
P1-TURN-STALL
P1-MODE-MOUNT
P2-REVERT-CONFIRM
P1-HOME-CUSTOM
P1-HOME-CUSTOM-NEW
P2-HOME-EMPTY
D-CMD-DUP
D-SOLID-OWNER
D-E2E-GAP
```

必须遵循：

```text
识别假设 → 追溯本源 → 重构方案 → 精简输出
复用 → 删除 → 归并 → 重构 → 新增
```

不按文件逐个补症状。先按边界丢失、状态缺档、生命周期 owner、第五档能力契约四个面收敛。发现计划与当前代码不一致时，以真实调用图/行为 RED 为准，修订计划而不是强行实现旧结论。

## 0. 当前授权、工作区和停止条件

### 0.1 授权边界

允许按 S0–S8 实施生产代码、测试和文档，但必须逐 Slice 提交并停下复查。未经用户明确授权：

- 不合并 `main`、不 push、不创建或修改 PR；
- 不使用 `--no-verify`、不 force push、不跳过门禁；
- 不清理其他分支/worktree 或覆盖用户修改；
- 不把只在 V2 修好的缺陷声明为默认 V1 用户路径已闭环；
- 不为“统一”反向 import 将退役的 V1 provider helper；
- 不手改 SDK generated files；
- 不在 RED 前预设 Permission translator、`tab.close` owner 或顶层 Chat resource owner；
- 不把 D-SOLID-OWNER 的候选当已确认 culprit。

### 0.2 开工门禁

```bash
pwd
git branch --show-current
git status --short --branch
git fetch origin main --prune
git rev-parse HEAD
git rev-parse origin/main
git merge-base HEAD origin/main
git rev-list --left-right --count origin/main...HEAD
```

必须满足：

1. `pwd` 为 `.../.worktrees/dogfood-remediation`；
2. 当前分支为 `dogfood-remediation`；
3. 工作区干净；
4. HEAD 从最新 `origin/main` 创建；
5. 记录准确 SHA 和运行时 flags；
6. 远端前移、未知脏改动或基线不一致时先停止报告。

### 0.3 必须停止并回报

- RED 红因不是缺陷，而是测试自身、模块加载、Layer、fixture 或环境错误；
- V1/V2 某一真实入口仍静默停转，而当前 Slice 只修另一运行时；
- Permission recoverable outcome 已变成 defect，或只能通过 `catchCause` 才能恢复；
- S3b 开始时 plugin 模块循环仍导致 provider/config 测试收集失败；
- Provider typed 收窄删除 `apiKey`、custom `fetch` 或 provider-specific options；
- `whenActive` 后模式功能失效，说明资源可能需要隐藏态预热；
- Workspace 顶层 Chat resource 无法确定 Chat 专属或共享 owner；
- `tab.close` 删除一个注册后 Home/Draft/Session 任一上下文丢命令；
- D-SOLID-OWNER 栈顶在本批范围外；
- 修完一个收敛面后同面另一现象仍复现。

## 1. 认知加载：写代码前完整读取

```text
CLAUDE.md
AGENTS.md
ARCHITECTURE.md
CONTEXT.md
DESIGN.md
docs/testing.md
docs/technical-debt.md

docs/plan/five-mode-dogfood-remediation-2026-09-04.md
docs/review/five-mode-dogfood-2026-09-03/report.md
specs/v2/config.md
specs/v2/session.md
specs/v2/provider-model.md
specs/v2/tools.md

.aigcfroge/skills/protocols/SKILL.md
.aigcfroge/skills/effect/SKILL.md
.aigcfroge/skills/database/SKILL.md
.aigcfroge/skills/enterprise-code-standard/SKILL.md
.aigcfroge/skills/reuse-first-refactor/SKILL.md
.aigcfroge/skills/quality-to-pr/SKILL.md
.aigcfroge/skills/frontend-theming/SKILL.md
```

按触达目录读取最近 `AGENTS.md`，至少包括：

```text
packages/aigcfroge/AGENTS.md
packages/aigcfroge/test/AGENTS.md
packages/aigcfroge/test/server/AGENTS.md
packages/aigcfroge/src/server/routes/instance/httpapi/AGENTS.md
packages/core/src/tool/AGENTS.md
packages/app/e2e/performance/AGENTS.md
```

## 2. 运行时、入口和代码调用图验证

### 2.1 必测矩阵

```text
AIGCFROGE_V2_RUNTIME=false / true
AIGCFROGE_CUSTOM_MODE=false / true
promptAsync
同步 prompt / shell / command（实际触达时）
DeniedError / RejectedError / CorrectedError / AskExpiredError / CommitRejected
无响应头 / 响应头后无 SSE chunk / total timeout / false 关闭档
Work permission / Chat-Assistant stall / Work cold mount / Home empty-custom / Session revert
```

默认 V1 仍复现时，只能写“V2 已修、V1 开放”，不能关闭报告或移动技术债。

### 2.2 检索规则

符号、callers/callees、impact 优先 codegraph；字符串、flag、错误文案、i18n key、command id、请求路径用 `rg`。

开工至少验证：

```bash
rg -n "AIGCFROGE_V2_RUNTIME|promptAsync|continue_loop_on_deny" packages/aigcfroge packages/core
rg -n "DeniedError|RejectedError|CorrectedError|AskExpiredError|CommitRejected" packages/core packages/aigcfroge
rg -n "ToolFailure|permission.assert|settleWith|Materialization.settle" packages/core/src/tool packages/core/src/session
rg -n "MessageTimeline|TimelineRow.Thinking|showThinking|session_status" packages/app packages/session-ui packages/enterprise
rg -n "headerTimeout|chunkTimeout|timeout|settings" packages/schema/src/provider.ts packages/core/src packages/aigcfroge/src/provider
rg -n "ModeSlotActiveProvider|whenActive|useModeSlotActive|chatAssetList|chatSystemData" packages/app/src/pages
rg -n '"tab.close"|modeDraft\(|launchModeSession|assertCreationSupported' packages/app packages/core packages/schema
rg -n "session.revert|session.unrevert|snapshot.start|session_diff" packages/core packages/app packages/session-ui
```

### 2.3 已验证 owner，不得回退到旧假设

- Revert 目标：`packages/core/src/session/revert.ts`；
- Permission：真实 leaf → `Tool.make` → Registry/Runner 的**首次 typed 语义丢失边界**，由 RED 决定；
- Stall：交互式 App 的 `MessageTimeline`/`rows.ts`；
- Enterprise Share 虽渲染 `SessionTurn`，但固定 `session_status=idle`，stall 当前不可达；
- Provider settings typed owner：`packages/schema/src/provider.ts`；
- Mode pending/error：`ModeWorkspace` 槽边界，`layout.tsx` 只做最小全局兜底；
- Hidden effects：slot 专属资源归 active gate；顶层 Chat 资源归 Chat owner 或有证据的 Workspace shared owner；
- Generic creation capability：schema 唯一类型/集合，Core policy 与 App 共用；
- `tab.close`：先行为矩阵，当前只推荐 Titlebar global owner，不是既定答案。

## 3. 每个 Slice 的固定 TDD 循环

1. **RED**：行为断言先红，失败原因命中真实缺陷。
2. **可满足性判别**：临时最小改对生产 owner → 变绿 → 还原 → 复红，保存输出。
3. **GREEN**：只实现当前 Slice 的最小路径。
4. **REFACTOR**：绿后才归并 owner、删重复、收窄类型。
5. **FOCUSED VERIFY**：受影响包 typecheck + 定向测试。
6. **REGRESSION**：V1/V2、五模式、旧入口和失败路径。
7. **DATA FLOW REVIEW**：从 UI/HTTP 到持久化/transport 再回 UI。
8. **DIFF REVIEW**：无关文件、重复 owner、生成物、日志、错误吞噬。
9. **COMMIT**：可独立回滚的 Slice 一个 conventional commit；前置 RED 可独立 test commit。
10. **STOP**：输出证据卡，等待用户批准下一 Slice。

有效 RED 不包括源码字符串断言、错误 mock、模块循环、Layer 缺失、测试污染、墙钟等待或 `any` 造成的假通过。

测试规则：

- 禁止从仓库根目录运行测试；
- Effect 测试使用 `testEffect`、`Layer.mock` 和 readiness signal；
- 禁止 `Effect.sleep`/`setTimeout` 等待并发结果；
- 测试实际实现，不复制 parser/filter/fold；
- 不使用 `globalThis` mock，除非无替代且明确记录；
- 预期失败用 TaggedError，不能 `Effect.die`；
- 不用 `catchCause` 吞 interruption/defect/CAS conflict。

## 4. S0 — 冻结行为基线

不改生产代码。记录以下 6 条核心基线，受影响运行时应红，未受影响运行时记录实际通过，不为凑红修改 fixture：

1. revert 到第 N 条 user message，`snap.restore` 应收到第 N 轮 `snapshot.start`；
2. 真实 permission leaf Denied/Corrected 后产生可见 error outcome，反馈不丢；
3. App `MessageTimeline` busy 且无输出超过阈值后出现 stalled 出口；
4. 冷加载 `/mode/work` 主区出现 loading；
5. 无项目点击“新建会话”有明确反馈且不 POST session；
6. `tab.close` 在 Home/Draft/Session/context 各只有一个有效 owner，不重复触发也不丢失。

已知基线：

```text
bun --cwd packages/core test test/session-revert-v2.test.ts
  → 2 pass / 0 fail
bun --cwd packages/core test test/session-runner-tool-registry.test.ts
  → 18 pass / 0 fail
bun --cwd packages/core test test/plugin/provider-dynamic.test.ts
  → 0 pass / 1 fail，plugin/internal.ts:119 module cycle
bun --cwd packages/core test test/config/provider.test.ts
  → 同一 plugin.ts ↔ plugin/internal.ts 循环可在 plugin.ts:158 抛出
bun --cwd packages/session-ui typecheck
  → markdown-shiki.worker.ts 的 @shikijs/types 多版本冲突
```

把真实输出写入 `docs/review/five-mode-dogfood-2026-09-03/red-baseline.md`。任何“红得不对”必须先修测试/前置，不能进入 S1。

## 5. S1 — P0 Revert 目标选择

### RED

扩展 `packages/core/test/session-revert-v2.test.ts`：创建三轮对话，每轮 assistant 带不同 `snapshot.start`；revert 到第三条 user message，断言 restore 收到第三轮 snapshot。

### GREEN

- `revert.ts` 按 `input.messageID` 找到目标 user 后对应的 assistant snapshot；
- 找不到目标保持既有 no-op：不写 marker、不动磁盘；
- 抽取同文件具名选择函数，删除说谎注释；
- 复查 marker、disk restore、summary/diff、App visible projection 指向同一时点。

### Gate

```bash
bun --cwd packages/core test test/session-revert-v2.test.ts
bun --cwd packages/core typecheck
```

提交建议：`fix(core): restore the selected session snapshot`。输出 Slice card并停止。

## 6. S2 — Permission outcome 可见性

### RED/探针

V2 对真实 leaf 触发：

```text
DeniedError
CorrectedError
RejectedError
AskExpiredError
CommitRejected
```

记录 leaf、`Tool.make`、Registry settlement、Runner part 的 Exit/Cause。另从 V1 `SessionProcessor.failToolCall` 真实入口验证无反馈和带反馈拒绝。

行为必须断言：

- recoverable denial 落可见 `type: "error"`；
- `CorrectedError.feedback` 不丢；
- interruption/defect/CAS conflict 不变成成功 ToolResult；
- 轮次继续/停止沿用对应 Runner policy并明确可见。

### GREEN

由探针决定最小 owner：

- leaf 首先泛化 → leaf 共用边界保留/翻译 typed outcome；
- `Tool.make` 首先丢失 → 扩展其明确适配契约；
- typed failure 真正抵达 Registry → 才在 Registry settlement 翻译；
- 缺陷只存在 V1 → 只修 SessionProcessor 可见状态/消息。

普通 settlement 与 doom-loop 只有输入、输出、审计语义完全一致时才共享 translator。AskExpired/CommitRejected/NotFound 必须有明确操作语义，不能默认伪装为模型可恢复 ToolFailure。

### Gate

```bash
bun --cwd packages/core test --timeout 30000
bun --cwd packages/aigcfroge test --timeout 30000
bun --cwd packages/core typecheck
bun --cwd packages/aigcfroge typecheck
```

提交按 RED 命中的 V2/V1 owner 分开。输出 Slice card并停止。

## 7. S3 — Stall 出口与 Provider timeout 契约

### S3a：App 客户端出口

RED：从真实详情页进入 `MessageTimeline`，构造 busy + active + 无 error + 无可渲染 assistant part，推进响应式时钟越过阈值，断言出现 stalled、stop、retry、change-model 出口。不能 import `SessionTurn` 代替路由测试。

GREEN：

- `rows.ts`/timeline 附近建立最小纯判定 seam；
- `lastActivityAt` 优先级：最新 assistant message/part activity，其次 user message created；
- 缺失或异常时间不误判超时；
- 使用受 owner 清理的响应式 tick，不在 memo 中只读一次 `Date.now()`；
- stalled 是客户端派生态，不直接扩展服务端 SessionStatus；
- stop/retry/model 复用现有 UserActions、abort/halt、restart/resume 和 DialogSelectModel；
- 三语、aria、focus、窄视口、动作 busy/disabled、失败 toast 都有测试。

Enterprise Share 固定 idle，当前不改 `session-turn.tsx`。只有 share 改成实时非 idle 并出现独立 RED 时才纳入。

### S3b 前置：Plugin location-layer 模块循环

先以独立提交修复：

```text
packages/core/src/plugin.ts
packages/core/src/plugin/internal.ts
```

根因是 ESM 循环求值，不是单文件声明顺序。修复后至少使下列测试可收集并通过：

```bash
bun --cwd packages/core test test/plugin/provider-dynamic.test.ts
bun --cwd packages/core test test/config/provider.test.ts
bun --cwd packages/core typecheck
```

不能要求 S1/S2 等待该前置；它只在进入 S3b 前完成。

### S3b：Typed Provider transport

RED：

- schema settings 能 decode/typecheck `timeout/headerTimeout/chunkTimeout`，保留开放 provider options；
- V2 fake server/fetch 覆盖无 header、header 后无 chunk、total timeout、omitted/default、false 关闭；
- V1 现有 header/chunk 实现和真实用户入口跑同组关键语义。

GREEN：

- schema owner 在 `packages/schema/src/provider.ts`；
- Core config/catalog/model/provider 复用同一 typed settings；
- `packages/core/src/provider.ts` 自家 `settings: any` 收窄；第三方逃逸只在 adapter 局部 cast；
- `aisdk.ts` 只消费 typed transport knobs，并把其余 options 继续传给 AI SDK；
- request body 同名字段不能静默覆盖 provider transport deadline；
- false/omitted/default/非法数值语义分别测试；
- V2 不 import V1 helper；若 V1 仍红，在 V1 owner 独立最小修复或保持开放。

### Gate

```bash
bun --cwd packages/schema test
bun --cwd packages/schema typecheck
bun --cwd packages/core test --timeout 30000
bun --cwd packages/core typecheck
bun --cwd packages/aigcfroge test --timeout 30000
bun --cwd packages/aigcfroge typecheck
bun --cwd packages/app test:unit
bun --cwd packages/app typecheck
```

S3a、plugin 前置、schema、core transport、条件性 V1 修复分别保持可回滚。输出各自 Slice card。

## 8. S4 — Mode pending/error 与隐藏资源 owner

### RED

1. 冷加载 `/mode/work`，主内容 ready 前可见 loading；
2. 五模式切换时，可见槽正常请求、隐藏槽不新增专属请求；
3. 单独记账 `ModeWorkspace` 顶层 `chatAssetList`/`chatSystemData`；
4. pending、rejected、partial-success 时槽仍在 DOM，有局部 loading/error，不让整个 main 空白；
5. 已门控 Coding/Work/Chat/Custom 资源不回归。

### GREEN

- `layout.tsx` 只补最小全局 fallback；最终 loading/error owner 在 ModeWorkspace slot；
- Assistant 五个 query 接 slot active gate；
- 顶层 Chat resource 先由网络 RED 分类：优先 Chat active owner；若确为共享预热，明确 owner、缓存、取消和 DoD 记账；
- 保留 render-all 状态，不因 wrapper 抽取卸载 hidden draft/store；
- 复用现有 ErrorBoundary、v2 token、i18n、focus/aria；
- 不顺手重写已经门控的 6 组资源。

### Gate

```bash
bun --cwd packages/app test:unit
bun --cwd packages/app test:e2e
bun --cwd packages/app typecheck
```

提交建议：`fix(app): gate hidden mode resources`。输出 Slice card并停止。

## 9. S5 — Revert 确认与真实预览

### RED

真实详情页点击“重置到此点”：

- 先显示确认；取消后 revert/unrevert/abort 请求为 0；
- 文件数量来自真实 `session_diff` 或 Session summary；
- 零文件、无 summary、无 snapshot 有明确降级；
- 确认只发一次请求；失败时 timeline/draft 本地恢复，错误可见；
- V1/V2 与 Custom 实际适用路径均有明确结果。

### GREEN

- 优先在 `UserMessageDisplay`/message-part 的现有 dialog owner 接确认；
- 若缺数据，沿 MessageTimeline/Session props 传只读 `revertPreview`；
- UI 不重新猜 snapshot，不用消息数量冒充文件数量；
- 说明消息 projection 与工作区文件恢复语义；
- Revert dock 新 revert 后默认展开一次，用户手动折叠后不被每次响应式更新强制打开；
- 复用现有 restore/rollback，不新建撤销系统；
- 三语 parity、aria/focus、失败回滚有测试。

### Gate

```bash
bun --cwd packages/ui test
bun --cwd packages/session-ui test
bun --cwd packages/app test:unit
bun --cwd packages/app test:e2e
bun --cwd packages/ui typecheck
bun --cwd packages/session-ui typecheck
bun --cwd packages/app typecheck
```

提交建议：`fix(app): confirm destructive session revert`。输出 Slice card并停止。

## 10. S6 — Home Custom 筛选与空项目反馈

### RED

- Home filters 与 `MODE_DEFINITIONS` 派生结果等长同序；不能只断言含 custom；
- 无项目点击“新建会话”打开既有目录/项目选择器或明确引导，且不 POST session；
- connection/context 缺失与无项目分开反馈；
- 含 Custom session 时选择 Custom filter，只显示 Custom 记录。

### GREEN

- 删除 Home 手抄模式表，由 `MODE_DEFINITIONS` 派生；
- label 使用 definition labelKey，count 使用 `Record<Mode, number>`；
- `!directory` 复用 directory picker/添加项目；
- `!conn || !ctx` 使用现有 toast/error owner；
- 复用现有 `filterSessionsByMode`/home-shared，不修改各模式主页列表债。

### Gate

```bash
bun --cwd packages/app test:unit
bun --cwd packages/app test:e2e
bun --cwd packages/app typecheck
```

提交建议：`fix(app): derive home mode filters`。输出 Slice card并停止。

## 11. S7 — Generic session creation capability 与 Custom Builder

### RED

- schema 唯一 `GenericSessionMode`/等价类型只允许 chat/coding/work/assistant；custom 与未来未表态模式不可赋值；
- Core `assertCreationSupported` 消费相同集合/谓词；
- `launchModeSession` 与 `modeDraft` 参数收窄；
- Home/Titlebar 在 currentMode=custom 时导航 `/mode/custom` Builder，不发普通 POST session；
- `titlebar.tsx` 的直接 `modeDraft(mode.currentMode)` 旁路被封堵；
- Custom 使用 `customComposition.start` 原子创建。

### GREEN

- schema 唯一拥有类型和集合；Core policy、App 共用，不复制 if 分支；
- 固定普通模式调用保留；动态 currentMode 显式分支；
- Home/Titlebar 复用既有 navigate/tabs/route helper；
- Schema 变化只有真正影响公共 HTTP/API 时才重生成 SDK。

### Gate

```bash
bun --cwd packages/schema test
bun --cwd packages/schema typecheck
bun --cwd packages/core test --timeout 30000
bun --cwd packages/core typecheck
bun --cwd packages/app test:unit
bun --cwd packages/app test:e2e
bun --cwd packages/app typecheck
```

提交建议：`fix: enforce generic session creation modes`。输出 Slice card并停止。

## 12. S8 — 附带债

### S8a：`tab.close` 单 owner

先覆盖 Home current tab、Draft、Session、Session context child tab、无可关闭 tab、快捷键、command palette、Tab close button。

RED 必须断言每种上下文最多一条有效 registration，并实际执行命令，不读源码字符串。

推荐但未预裁决的 GREEN：保留 Titlebar global command，删除 Session command 重复注册；如果 Titlebar 在某上下文不挂载，则反向补齐全局 owner，不能直接删除。

### S8b：Solid owner 诊断

只在 dev 捕获 `command.tsx` 警告真实 stack。已显式传 owner/`runWithOwner` 的正确候选不动。culprit 在本批改动范围才修；范围外只把栈顶、触发场景、生产影响写入技术债。诊断日志不得含用户内容、prompt、token。

### S8c：E2E readiness

- 不提高 `page.goto`/test timeout 掩盖冷启动；
- 在 `e2e/utils/waits.ts` 等已有 owner 建真实 Vite/backend readiness；
- stalled 与 slot fallback 补 keyboard focus/Enter/Escape 和一个窄视口；
- 每条完成信号来自 DOM/URL/网络/事件，不靠 sleep。

### Gate

```bash
bun --cwd packages/app test:unit
bun --cwd packages/app test:e2e
bun --cwd packages/app typecheck
```

S8a、S8b、S8c 分开提交/记债。输出 Slice card并停止。

## 13. 数据流复查

```text
Revert:
UI message action → dialog/revertPreview → session.revert HTTP
→ SessionRevert target snapshot → disk restore + marker + diff summary
→ Event/SSE → MessageTimeline projection + revert dock

Permission:
UI reply → Permission service → real leaf → Tool.make
→ Registry/Runner or V1 SessionProcessor → durable tool part/state
→ model continuation policy → SSE → message-part

Stall:
config/provider settings → Catalog/Model api → V1/V2 transport
→ header/chunk/total timeout → LLM error/status
→ App MessageTimeline reactive lastActivityAt → stalled actions

Mode resources:
route/currentMode → render-all slot → active signal
→ query/resource source → SDK/network → cache/latest → visible slot

Generic creation:
persisted currentMode → Home/Titlebar action → GenericSessionMode guard
→ ordinary Draft/session OR `/mode/custom` Builder → customComposition.start
```

每条链必须明确唯一 owner、持久事实、失败语义、回滚和用户可见出口。

## 14. 安全、类型和 UI 红线

- 不使用 `any`、`@ts-ignore`、`@ts-expect-error` 掩盖真实生产类型错误；负类型测试除外；
- Schema 多字段用 `Schema.Class`，错误用 `Schema.TaggedErrorClass`；
- Effect 用 `Effect.gen`/`Effect.fn`，后台 fiber 必须 scoped；
- 外部边界才 try/catch；不宽捕获 interruption/defect；
- 破坏性磁盘写入必须确认、失败可见、状态可回滚；
- provider secrets、Authorization、prompt、用户文件和 raw Cause 不进日志；
- 新 UI 使用现有 v2 token/组件/i18n，不造平行 spinner/dialog/model selector/toast；
- 不因为 test/typecheck 基线失败就跳过受影响包；先拆真实前置或保持 Slice 未完成；
- 不用源码 `toContain`、消息数量冒充文件数量、event 顺序冒充 identity。

## 15. 每 Slice 证据卡

```text
Slice S<n> 复查结论
- 基线 SHA / flags / 入口：
- RED：测试、失败类型、实际输出：
- 可满足性：临时改对 → 变绿 → 还原 → 复红：
- GREEN：生产 owner 与最小实现：
- V1/V2 parity：
- 五模式影响：
- Data flow：输入 → 边界 → 持久化/transport → UI：
- Tests/typecheck/lint：命令、exit code、计数：
- Diff：文件、生成物、重复 owner、无关改动：
- Rollback：单提交回退行为：
- 技术债更新：
- 剩余风险：
- 是否允许下一 Slice：否，等待用户明确批准。
```

## 16. 最终门禁

```bash
bash .aigcfroge/skills/protocols/scripts/check-refs.sh
bun --cwd packages/schema typecheck
bun --cwd packages/core typecheck
bun --cwd packages/aigcfroge typecheck
bun --cwd packages/ui typecheck
bun --cwd packages/session-ui typecheck
bun --cwd packages/app typecheck
bun --cwd packages/schema test
bun --cwd packages/core test --timeout 30000
bun --cwd packages/aigcfroge test --timeout 30000
bun --cwd packages/ui test
bun --cwd packages/session-ui test
bun --cwd packages/app test:unit
bun --cwd packages/app test:e2e
LINT_BASE_REF=origin/main bun run script/lint-changed.ts
git diff --check
```

最终清单：

- 8 项缺陷各有真实 RED→GREEN→复红证据；
- Permission 五类 outcome、interruption/defect、V1/V2 用户入口各有明确结果；
- App timeline stalled 响应式可达且动作可用；
- Provider 三档 timeout typed、保留 provider options、关闭档可测；
- Assistant 和顶层 Chat resource 不再漏出 owner；
- Revert target/磁盘/marker/diff/确认一致；
- Home Custom、empty 与 GenericSessionMode/Builder 契约闭环；
- `tab.close` 不重复不丢失；Solid warning 有真实 culprit 或诚实技术债；
- E2E readiness 不靠提高 timeout；
- affected packages、文档、技术债、报告、页面架构说明无 drift；
- 未经用户批准不合 main、不 push、不创建 PR。

<!-- PROMPT END -->

## 使用说明

- **复制范围**：`<!-- PROMPT START -->` 至 `<!-- PROMPT END -->`。
- **目标工作区**：`/media/win_data/aigcfroge/.worktrees/dogfood-remediation`。
- **目标分支**：`dogfood-remediation`。
- **开工顺序**：确认最新 `origin/main` → 认知加载 → S0 → S1。
- **执行节奏**：每 Slice 红→可满足性→绿→重构→门禁→提交→证据卡→等待批准。
- **特别前置**：S3b 开始前必须独立修复 plugin location-layer 模块循环；S1/S2 不等待它。
- **禁止事项**：从旧 `dogfood-remediation-plan` 继续生产实施、跨 Slice、跳门禁、未经授权合并/推送。
