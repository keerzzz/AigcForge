# AigcForge Differential Review — 2026-07-25

## 1. Executive Summary

**审批结论：REJECT（暂不批准提交）**。当前未暂存工作树完成了多资产 UI/Insert/迁移/flag 泛化，但存在 3 个阻断级高风险缺口：默认 App 会话仍走 V1，而 V1 只注册 prompt propose 工具；单一 feature flag 未覆盖非 prompt apply 与自动迁移；UI apply 未启用 SDK `throwOnError`、会把 4xx/5xx 当成功。另有候选去重导致旧配置被应用、MCP/Command 迁移缺失等问题。

| Severity | Count |
| --- | ---: |
| Critical | 0 |
| High | 3 |
| Medium | 2 |
| Low | 1 |

**Overall Risk:** HIGH  
**Recommendation:** REJECT

**Key Metrics:**
- Reviewed: 46/46 worktree files（43 tracked + 3 untracked）
- Diff size: tracked `+528/-203`；untracked `+363`
- High blast-radius paths: V1 chat tool registry、5-kind apply、Location layer boot migration
- Security/control regressions: 1（feature flag fail-open）
- Test gaps: non-prompt V1 propose、HTTP error tuple、candidate-only metadata changes、flag-off migration/apply、MCP/Command migration

## 2. What Changed

**Branch:** `chat-m3-asset-kind`  
**Baseline:** `HEAD@15d63fcc8` vs current unstaged/untracked worktree  
**Strategy:** FOCUSED differential review（全量 diff + 关键上下游 1-hop/运行路径追踪）

| Area | Main changes | Risk |
| --- | --- | --- |
| Core | 5 kind service error unions、Skill/Agent legacy migration、flag rename | High |
| Aigcfroge | chat-orchestrator permissions/prompt、capability rename、V1 registry gate | High |
| App | multi-kind candidate normalization/apply/insert、invalid kind tagging | High |
| SDK | capability `chatPromptAsset -> chatAsset` | Medium |
| Tests | migration、candidate、flag、Insert E2E updates | Medium |

## 3. Findings

### HIGH-1：默认 App Chat 仍走 V1，但 V1 只注册 `propose_prompt_asset`

**Files:**
- `packages/aigcfroge/src/tool/registry.ts:20,226,247`
- `packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts:414-455`
- `packages/aigcfroge/src/agent/agent.ts:174-178`
- `packages/core/src/agent/prompt/chat-orchestrator.ts:18`

**Blast Radius:** HIGH（默认 App `prompt`/`promptAsync` 路径与全部非 prompt 创建请求）  
**Test Coverage:** NO（现有 location-layer 测试仅证明 V2 registry 有工具）

系统提示和 V1 agent 权限已经声明 5 个 propose 工具，但 V1 `ToolRegistry` 只 import/init/register `ProposePromptAsset`。HTTP 注释明确普通 prompt 始终走 V1，`promptAsync` 仅在 `AIGCFROGE_V2_RUNTIME` 打开时走 V2；默认路径中模型无法调用 skill/mcp/command/agent propose 工具。

**可复现场景：**
1. 在默认 App Chat 会话要求创建 skill。
2. `chat-orchestrator` 被提示调用 `propose_skill_asset`。
3. V1 ToolRegistry 的可用工具列表中不存在该工具。
4. 模型无法产生右栏候选，M3 “全量开闸”闭环失败。

**Recommendation:** 为四种新 kind 提供并注册 V1 wrapper，或在交付前把 App Chat 的 provider turn 完整切到 V2；补一条从 HTTP prompt → V1 registry → tool result 的非 prompt E2E。

### HIGH-2：单一 feature flag 对非 prompt 创建与自动迁移 fail-open

**Files:**
- `packages/core/src/skill-asset.ts:183-199`
- `packages/core/src/agent-asset.ts:180-196`
- `packages/core/src/location-layer.ts:72-104`
- `packages/aigcfroge/src/server/routes/instance/httpapi/handlers/{skill,mcp,command,agent}-asset.ts` apply handlers
- `docs/prd/chat-mode-creation-layer.md:364-369`

**Historical Context:** `7b6443c86` 专门加入 prompt 的 propose/apply fail-closed gate；PRD 要求“单一框架 feature flag 控制创建/捕获/导入入口”。

**Blast Radius:** HIGH（每个 Location layer 初始化 + 4 个公开 apply API）  
**Test Coverage:** NO

当前只有 prompt apply 检查 `flags.experimentalChatAsset`。Skill/MCP/Command/Agent apply 不检查 flag；新增 Skill/Agent migration 也在 registry boot 时无条件执行。管理员关闭实验 flag 后：

1. 客户端仍可直接调用四类 apply endpoint 写文件。
2. 打开含 `.claude/skills` 或 `.claude/agents` 的项目会自动创建 `.aigcfroge/*` 文件。

这违反灰度/回滚边界，也使 capability 声明与实际权限不一致。

**Recommendation:** 在统一 owner/service 边界实现一个复用的 create/import gate；四类 apply 与 migration 均 fail-closed。list/get/insert 保持可读。增加 flag=false 的 HTTP apply 和“registry boot 不写盘”测试。

### HIGH-3：SDK 错误结果被当作 apply 成功

**Files:**
- `packages/app/src/components/chat/asset-insert.ts:43-64`
- `packages/app/src/components/chat/chat-right-panel.tsx:191-228`
- `packages/sdk/js/src/v2/gen/sdk.gen.ts:3469-3504`（其他 kind 同型）

**Blast Radius:** HIGH（5 种资产的 Apply/Overwrite）  
**Test Coverage:** NO

生成 SDK 的 `ThrowOnError` 默认是 `false`。`applyAssetCandidate()` 原样返回 `{ data?, error? }`，调用方只 `await`，随后无条件 `setApplied()`。因此 stale revision、overwrite conflict、flag disabled、validation error、500 都可能在 UI 显示“已应用”，但磁盘未写入。

**PoC:** 审批中用返回 `{ error: { message: "conflict" } }` 的 skill client 调用 `applyAssetCandidate()`，Promise 正常 resolve，没有抛错。

**Recommendation:** 每个 endpoint 使用第二参数 `{ throwOnError: true }`，或统一检查 `result.error` 后抛出 typed UI error；只有确认 `data` 成功后调用 `setApplied()`。同时 content/list helper 也应区分空内容与请求失败。

### MEDIUM-1：候选相等性守卫会丢弃新配置并应用旧值

**File:** `packages/app/src/components/chat/prompt-asset-store.ts:18-32`  
**Blast Radius:** MEDIUM（所有 proposal sync poll）  
**Test Coverage:** NO

相等性只比较 `kind/name/revision/status/content`。以下字段变化但正文不变时会被视为同一候选：

- description
- skill `slash`
- MCP `command/args/env`
- command `invocation/args`
- agent `config`
- relativePath/conflict flags

审批 PoC 中，同名 command 的 `invocation` 从 `/old` 改为 `/new`、description 改变而 source 不变，store 仍保留旧 candidate；点击 Apply 会写入旧值。

**Recommendation:** 比较完整规范化 candidate（稳定序列化/结构 hash），或给 tool result 使用稳定 proposal identity；添加“正文相同、metadata 改变”的回归测试。

### MEDIUM-2：迁移只覆盖 Skill/Agent，MCP/Command 在 UI 切换后消失

**Files:**
- `packages/core/src/asset-migration.ts:14-19`
- `packages/app/src/pages/home.tsx:344-367`
- `docs/plan/chat-m3-asset-kind-generalization.md:96-105,507-535`

**Blast Radius:** MEDIUM（已有 command/MCP 用户）  
**Test Coverage:** NO

计划明确要求 Phase 3B/4B 完成 MCP/Command migration；当前迁移代码主动排除 config-driven command/mcp。与此同时 Home 和功能树只读取五类 Asset API，不再读取原 server-sync/config 源。旧 MCP/Command 虽仍被 V1 runtime 使用，但不会出现在新资产工作台，违背“先迁移再切 UI”。

**Recommendation:** 要么实现可逆、幂等的 MCP/Command import；要么在 UI 保留 legacy source 合并/只读展示，直到正式迁移完成。补已有配置在 M3 UI 可见的集成测试。

### LOW-1：新边界通过 `as never` 绕过 SDK 类型契约

**File:** `packages/app/src/components/chat/asset-insert.ts:60-64`  
**Lint:** 5 个 `no-unsafe-type-assertion` warning

`Record<string, unknown>` + `as never` 使 per-kind candidate 与生成 SDK schema 脱钩；当前没有 multi-kind apply unit test。建议改为 discriminated union，并在各分支构造真实 SDK payload。新 migration 测试也应按仓库规范使用 `testEffect`/fixture，而不是手写 `runNow` 类型逃逸。

## 4. Test Coverage Analysis

| Command | Result |
| --- | --- |
| `git diff --check` | Pass |
| `bun run lint` | Pass（0 errors；2570 repository warnings） |
| Changed/new key files oxlint | 0 errors；7 warnings（5× `as never`，2× test Effect cast） |
| `bun --cwd packages/core typecheck` | Pass |
| `bun --cwd packages/aigcfroge typecheck` | Pass |
| `bun --cwd packages/app typecheck` | Pass |
| `bun --cwd packages/sdk/js typecheck` | Pass |
| `bun --cwd packages/core test --timeout 30000` | 1226 pass / 0 fail |
| `bun --cwd packages/app test --timeout 30000` | 457 pass / 0 fail |
| `bun --cwd packages/aigcfroge test --timeout 30000` | 3109 pass / 1 unrelated fail |
| Targeted `test/prompt-asset/e2e.test.ts` | 7 pass / 0 fail |
| Targeted Playwright Insert E2E | Pass on isolated port 3317 |

**Aigcfroge baseline/environment exception:** `test/tool/write.test.ts` expects `0644` but receives `0664`;该文件及 write 实现不在本 diff。隔离重跑仍失败，故记录为与本次资产改动无直接关系的环境/基线失败。

**Playwright note:** 首次使用默认 3000 端口时复用了已存在的无关 “New API” 服务而失败；改用独立 `PLAYWRIGHT_PORT=3317` 后通过。

## 5. Blast Radius Analysis

| Path | Impact | Priority |
| --- | --- | --- |
| V1 ToolRegistry | 默认 App Chat provider turn | P0 |
| Asset apply dispatcher | 5 kind Apply/Overwrite | P0 |
| Location layer migration | 每个打开的项目/目录 | P0 |
| Candidate store dedupe | 所有 propose result 同步 | P1 |
| Legacy migration coverage | 已有 MCP/Command 用户 | P1 |

## 6. Security and Engineering Gates

- **Catch Everything:** FAIL — SDK result-tuple error未转失败。
- **No Null Pointer:** PASS（新增 URL kind 与 tool state 有显式收窄）。
- **Security First:** FAIL — feature flag 对 4 类 apply 与自动迁移 fail-open。
- **No Cheating:** FAIL — 新 apply dispatcher 用 5 个 `as never` 绕过生成类型。
- **Reusability:** PARTIAL — 抽取了共享 Insert helper，但 gate 未统一抽到 owner 边界。
- **Clean Logs:** PASS — 未发现正文、token、env 内容新增日志泄漏。
- **Architecture:** FAIL — V1/V2 工具供给与默认 HTTP Session 路径不一致。

## 7. Required Actions Before Re-approval

### Blocking

- [ ] 补齐默认 V1 Chat 的四类 propose 工具闭环，或完成 App Chat → V2 切换。
- [ ] 统一 feature flag gate：非 prompt apply + migration 在 flag=false 时不得创建/导入。
- [ ] Apply 使用 `throwOnError: true` 或显式检查 `result.error`，失败时不得 `setApplied()`。
- [ ] 修复 candidate dedupe，覆盖所有 materially relevant 字段。
- [ ] 完成 MCP/Command legacy 可见性方案（迁移或过渡期合并展示）。

### Tests

- [ ] V1 non-prompt propose E2E。
- [ ] 4xx/409/500 apply 不显示 applied。
- [ ] flag=false 的 4-kind apply + migration no-write。
- [ ] candidate metadata-only update。
- [ ] legacy MCP/Command 在新工作台可见。

### Cleanup

- [ ] 移除 `as never` payload casts，使用 discriminated union/typed per-kind request。
- [ ] migration 测试改用 `testEffect` 与标准 tmpdir fixture。
- [ ] 提交前剔除与 M3 无关的纯注释翻译/格式噪音，保持 diff 单一职责。

## 8. Methodology and Limitations

- 协议：`CLAUDE.md`、`AGENTS.md`、package AGENTS、`DESIGN.md`、`ARCHITECTURE.md`、M3 plan/PRD。
- Skills：`differential-review`、项目 Effect 规则、UI/HTTP/testing gates。
- 技术：全量 diff、历史 blame/log、V1/V2 数据流追踪、SDK error semantics、PoC、受影响包 typecheck/test、Playwright E2E。
- 未修改产品代码；本文件为审批产物，不计入被审 diff。
- Confidence: HIGH for listed blockers；MEDIUM for全仓健康度（存在大量既有 lint warning 与 1 个无关测试失败）。
