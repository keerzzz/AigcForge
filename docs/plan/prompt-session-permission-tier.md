# 会话级权限档位实施提示词（Session Permission Tier）

> 角色：执行 agent。按 Phase 顺序逐 Phase 红→绿推进；每个 Phase 自验通过后**停下等审批，不 push、不建 PR**（审批通过后按仓库约定提交该 Phase，commit message 遵循 conventional）。
> 上游：计划 `docs/plan/mode-scoped-permission-overlay.md`（2026-08-16 送审终版，架构 Gate 全部关闭）——计划是唯一决策真源，本提示词只做执行门禁提炼，不替代计划。
> 分支：`session-permission-tier`（从当前 `main` 切出；main 已含前置提交：merge `a4b0485aa`（PR #30），`38de28529`/`a6321f20e` 均为 main 祖先，Phase 0 已核验关闭）。
> 协议：CLAUDE.md 第一性原理 + 改完即审；AGENTS.md（分支/Effect/Schema/测试/风格）；命中 skills：`effect`、`database`、`protocols`；涉 HTTP 端点先读 `packages/aigcfroge/src/server/routes/instance/httpapi/AGENTS.md`；涉 UI 命中 `frontend-theming` 与 `DESIGN.md`。
> 完成标准：计划 §11 验收标准全部 [x]；Phase 7 全量门禁通过。

---

## 0. 认知加载（写任何代码前按顺序读完）

```
CLAUDE.md
AGENTS.md（根 — 分支/Effect/Schema/测试/风格 + V2 Session Core 8 不变量）
ARCHITECTURE.md（§4.1 Session V2 / §4.4 Tool Registry / §4.6 Permission & Policy / §4.8 Database / §4.10 Product Mode）
CONTEXT.md（Session 术语字典 + 不变量）
packages/core/src/tool/AGENTS.md
packages/aigcfroge/AGENTS.md
.aigcfroge/skills/effect/SKILL.md
.aigcfroge/skills/database/SKILL.md
.aigcfroge/skills/protocols/SKILL.md
docs/architecture/adr/ADR-13-chat-work-mode-boundary.md
docs/architecture/adr/ADR-13-amendment-2-meta-agent-dispatch.md（§1b/§1c）
docs/prd/chat-mode-creation-layer.md（v4.8 §5.2）
docs/plan/mode-scoped-permission-overlay.md（本任务计划全文，Phase/红线/位点以它为准）
specs/v2/session.md、specs/v2/tools.md（涉 V2 语义时）
```

读完才能开始写代码。**计划中 file:line 锚点是审批当日快照：实施时先 grep 核对最新行号，漂移时先修计划锚点再动代码，不得按旧行号盲改。**

---

## 1. 背景与目标

当前权限行为多处分源：V2 `configured()`（`packages/core/src/permission.ts`）与 `SessionRunner` 的 `tools.materialize(agent.info?.permissions, intent)`（`packages/core/src/session/runner/llm.ts:387`）读不同来源；V1 `ctx.ask`/`resolveTools` 各自 `Permission.merge`；meta 基线 fail-open；根会话 unattended 假设不成立；无 Session 持久档位。

**目标**（计划 §0.2，按序交付）：

1. meta V1/V2 默认信封收敛 fail-closed（未知 action deny，去 wildcard allow）。
2. Session 持久档位 `propose`（默认）/ `full`，只作用于已批准 `chat/work/assistant × meta`。
3. 唯一有效权限 owner `PermissionEffective` 同时驱动 V1/V2 工具物化、执行授权、unattended 降级、saved approval 优先级、master/override。
4. Chat 当前有人值守根 Session 可主动 `meta + full` 直接写/命令，危险 action 逐次 `ask`（ADR-13 Amendment-2 §1c）。
5. 根 Session 显式 `attended:false` 契约；session 级临时 break-glass（不落库/Config/durable EventV2）。
6. Schema/DB/HTTP/SDK/App/fork-child 全数据往返。
7. 动态 Permission Context 替代静态提示词绝对指引。

---

## 2. 关键事实（已核实，实施前仍须 grep 确认）

| 位点                                                                                           | 现状（2026-08-16 main）                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/permission.ts:169-185`                                                      | V2 `configured()`：只读 agent 固有权限；unattended 降级仅覆盖子会话（`parentID !== undefined`），根会话需推广                                                                      |
| `packages/core/src/permission.ts:124-131`                                                      | `PermissionV2.Interface` 无 `effectiveRules`，需新增                                                                                                                               |
| `packages/core/src/permission.ts:244`                                                          | `assert` → `evaluateInput` → `configured`（执行授权入口）                                                                                                                          |
| `packages/core/src/session/runner/llm.ts:327/:578/:387`                                        | `SessionRunner.runTurn`；`:387` 直传 `agent.info?.permissions` 给 `tools.materialize`，需改传 effectiveRules                                                                       |
| `packages/core/src/tool/registry.ts:52/162`                                                    | `materialize(permissions?, intent?)`；registry 无 PermissionV2 依赖（tool/AGENTS.md），不得新增                                                                                    |
| `packages/core/src/product-mode-agent-policy.ts:79/:164`                                       | `checkPrimaryAgent` 现状保留；`checkCliDelegationAllowed(mode)` 单参、未知 mode 放行（测试 `packages/core/test/product-mode-agent-policy.test.ts:155` 断言 allow，Phase 4 需反转） |
| `packages/core/src/tool/task-driver.ts:625`                                                    | `checkCliDelegationAllowed(parent?.mode ?? "coding")` 调用点                                                                                                                       |
| `packages/core/src/plugin/agent.ts:456-485`                                                    | V2 meta：`bash/edit/write→ask`、`task→allow` 已落地；`:229` `defaults` 首条 `{"*":"allow"}` 待移除；`:145` 静态提示词绝对指引已过期待删                                            |
| `packages/aigcfroge/src/agent/agent.ts:227-250`                                                | V1 meta 同形（bash/edit/write ask 已落地）                                                                                                                                         |
| `packages/aigcfroge/src/session/tools.ts:82`                                                   | V1 `ctx.ask` 内 `Permission.merge(agent.permission, session.permission)`，需改单次 effective Ruleset                                                                               |
| `packages/aigcfroge/src/session/llm/request.ts:197-200`                                        | `resolveTools` 再次 `Permission.merge` agent 基线，需移除                                                                                                                          |
| `packages/aigcfroge/src/session/prompt.ts:373`                                                 | V1 `permission.ask({ ruleset: Permission.merge(taskAgent.permission, session.permission) })`                                                                                       |
| `packages/core/src/v1/session.ts:546/:573-574`                                                 | `SessionInfo`（含 permission/attended）、V1 CreateInput 字段                                                                                                                       |
| `packages/aigcfroge/src/session/session.ts:263-276/:278/:694`                                  | V1 `CreateInput`（现无 attended，需补）、`ForkInput`、`create`                                                                                                                     |
| `packages/core/src/session/sql.ts:32/:52/:53`                                                  | `parent_id`/`permission`/`attended`；新增 `permission_tier` 列                                                                                                                     |
| `packages/core/src/session/info.ts:17/:50`、`projector.ts:44/:71-72`                           | `fromRow`/`sessionRow` 投影位点                                                                                                                                                    |
| `packages/schema/src/session.ts:34/:63`                                                        | `SessionSchema.Info`（mode/attended；加 permissionTier）                                                                                                                           |
| `packages/aigcfroge/src/server/routes/instance/httpapi/groups/session.ts:53-62/:313/:337/:108` | `UpdatePayload`/create/update；`permissions` 为 ask 响应端点（与新 override 端点不冲突）                                                                                           |
| `packages/core/src/event.ts:23/36/128`                                                         | EventV2 `define` 支持非 durable 投影（break-glass 状态同步用）                                                                                                                     |
| `packages/core/src/config.ts:114`、`packages/core/src/tool/task.ts:156`                        | `subagent_attended_default` 仅子代理 task 委派专用，根 Session 契约不得复用                                                                                                        |
| `packages/core/src/permission/saved.ts`                                                        | saved approval service（项目级 action/resource 白名单）                                                                                                                            |
| `packages/core/script/migration.ts`                                                            | `--name` 生成迁移；禁止手改 `schema.gen.ts`/`migration.gen.ts`/SDK generated                                                                                                       |
| `./packages/sdk/js/script/build.ts`                                                            | SDK 生成脚本（endpoint/字段变化后必须重跑）                                                                                                                                        |
| `packages/app/src/pages/session/composer/`                                                     | 档位 selector 与 break-glass dialog 落点（现有 `session-permission-dock.tsx` 复用）                                                                                                |

---

## 3. 范围

### 3.1 范围内

- `packages/schema`：`permission-tier.ts`（`propose`/`full`，默认 propose）。
- `packages/core`：`permission/effective.ts`（唯一 owner）、`permission/session-override.ts`（break-glass）、`system-context/permission-state.ts`（V2 Permission Context）、Session SQL/Info/Event/Create/Update、migration、meta 基线、`checkCliDelegationAllowed(mode, tier)`。
- `packages/aigcfroge`：V1 prompt/tools/llm 接线、V1 CreateInput `attended`、HTTP group/handler、V2→V1 adapter。
- `packages/app`：composer 档位 selector + break-glass dialog + Draft/submit/update 接线 + i18n。
- `packages/sdk/js`：生成。
- 文档收口：ADR-13 Amendment-2 / Chat PRD 状态标注、ARCHITECTURE §7 设计状态、CLAUDE.md 债表（仅 Phase 7 计划内收口）。

### 3.2 明确不做（计划 §0.3）

- 不迁移/删除 V1 runtime；V1/V2 双端强制实现。
- 不实现 Assistant M4 信道网关（只交付根 Session `attended` 创建契约）。
- 不把 `enforcePrimary` 的 `Effect.die` 改 typed failure。
- 不新增全局持久化最高权限配置；不给模型暴露 break-glass API 或新增可改权限工具。
- 不改变 chat/work/assistant-orchestrator 的固定 fail-closed 信封。
- 不顺带修改 Effect skill；不顺手修无关代码（额外发现记报告末尾）。

---

## 4. 架构红线（违反即 REJECT）

1. **唯一 owner**：`configured()` 与 `ToolRegistry.materialize()` 不得继续读不同权限源；`ToolRegistry` 不得承担执行授权或新增 Permission service 依赖。
2. **档位边界**：只允许 `chat/work/assistant × meta` 抬权；Coding、非 meta Agent 忽略档位；未知 mode/agent/tier fail-safe（不抬权、无 wildcard allow）。
3. **full ≠ build 等价体**：full 只把危险 action 抬到 `ask`，不产生任何新 `allow`；构造语义 = meta fail-closed baseline → wildcard ask → 重放非 deny 规则，不得手写静态工具白名单。
4. **Chat full 逐次确认**：`bash`/`edit`/`write`/`apply_patch` 及未知危险 action 每次进 Permission Dock；saved approval 不得跳过 Chat `full` 确认（Work/Assistant 保持既有细粒度预授权语义）。
5. **unattended 最高拒绝**：unattended 将 ask 转 deny，saved approval 与 master/override 均不得放开；break-glass 对 unattended 根 Session 返回 `InvalidRequestError`。
6. **资产事务旁路禁令**：已注册资产仍走 `propose_* → 用户确认 → 受校验的 apply/delete 事务`；`full` 不得用通用写工具绕过 Schema/路径 containment/CAS/回滚/registry reload/readback。
7. **break-glass 不持久化**：不落库、不进 Config、不进入 durable EventV2、不继承 fork/child、进程重启清零；不可由模型或普通 Session API（create/update/prompt）修改。
8. **委托通道**：Chat 在 propose/full 下均拒绝 `task → build` 与 external CLI；Work/Assistant 仅 full 放行 external CLI；未知 mode deny。
9. **不扩大已批准例外**：2026-08-15 方案 B 的每一项约束原样实施，任何放宽需先停下报人类重新裁决。

---

## 5. Phase 分解（每 Phase：红→绿→验证→停下等审批）

每个 Phase 严格执行 TDD 红绿循环（红：先写行为测试并确认按预期失败，失败信息与预期不符立即停下报告；绿：最小实现；重构；回归：受影响包 typecheck/test + lint-changed；复查：按 CLAUDE.md 改完即审输出结论）。**退出 Gate 未满足不得进入下一 Phase。**

### Phase 0 — 切分支与基线（无代码）

1. 确认当前 `main` 含前置提交（`git merge-base --is-ancestor 38de28529 main` 应通过）。
2. 从 main 切 `session-permission-tier`。
3. 记录 core/aigcfroge/app/sdk 当前 `typecheck` + 相关测试基线（快照输出）。
4. grep 核对计划 §2 位点行号；漂移先修计划锚点。
5. 核对迁移序列：`packages/core/src/database/migration/` 最新时间戳，确认新迁移序号唯一。

退出 Gate：分支来源正确、基线快照完整、锚点无漂移。

### Phase 1 — Schema、迁移与 Session 往返

红：PermissionTier decode/default 测试；新旧数据库迁移测试；V1/V2 create/get/update/fork/child round-trip（含 fork/child 回落 propose）；V1 HTTP create 接收 `attended:false`。

绿：按计划 §3.3 数据链 22 项顺序实施（Schema → `permission_tier` 列 → `schema.gen.ts` → `bun --cwd packages/core script/migration.ts --name add_session_permission_tier` → `migration.gen.ts` → V1/V2 SessionInfo → CreateInput → event payload → projector/fromRow → V1 Patch → HTTP UpdatePayload/Create/Update → handler → V2→V1 adapter → SDK 重生成 → App Draft/submit/selector → fork/child reset-to-propose）。禁止手改任何 generated 文件。

**Phase 1 可用性门禁（计划 §3.3）**：默认 V1 路径（HTTP `session.create` → aigcfroge V1 `Session.create` → V2 适配）与同步 `session.prompt`（`POST /session/:sessionID/message`）round-trip 测试通过前，不得宣称档位功能可用。

验证：core + aigcfroge typecheck/test；`bun --cwd packages/sdk/js typecheck`；`git diff --check`。停下等审批。

### Phase 2 — meta V1/V2 fail-closed parity

现状（已落地）：V1/V2 meta 的 `bash/edit/write→ask`、`task→allow`（提交 `a6321f20e`）。剩余缺口：`defaults` 首条 wildcard allow（`plugin/agent.ts:229`）。

红：V1/V2 meta 均无 wildcard allow；已知安全工具（read/glob/grep/question/propose\_\*）可见；未知 action 默认 deny；build/general 固有行为无回归。

绿：抽取 V1/V2 `metaDefaults`（deny-first + 白名单），V1/V2 同构；补齐 propose 工具与 read 环境文件（`.env` ask）规则 parity。

验证：core + aigcfroge typecheck/test（含 agent 权限相关既有测试全绿）。停下等审批。

### Phase 3 — 有效权限 Owner + V2

红：mode×agent×tier×attended×override 矩阵（计划 §7.1：4 modes × 6 agents × 2 tiers + attended true/false/undefined + override on/off + unknown）；propose 隐藏 edit/bash；`chat/work/assistant × meta × full` 物化 edit/bash 且执行结果为 ask；master/override 物化并 allow 但 Chat `full` 危险 action 仍 ask；unattended 压制 full/break-glass；saved approval 优先级（Chat full 仍逐次 ask）。

绿：`PermissionEffective`（纯函数 owner，输入 mode+agent+tier+parentID+attended+masterPermissionEnabled+savedApprovals，同源产出 V1/V2 Ruleset 与 Context）；`PermissionV2.Interface.effectiveRules`；`configured()` 改调 owner；`runner/llm.ts:387` 改传 effectiveRules；`assert` 同一 owner；unattended 降级推广到显式 `attended:false` 根会话。

退出 Gate：V2 定义过滤与执行授权无分叉（物化/assert 成对测试）。

验证：core typecheck/test。停下等审批。

### Phase 4 — V1 parity

红：与 Phase 3 相同矩阵的 V1 parity；V1 LLM request 与 tool context 收到同一 Ruleset；work/assistant propose 下 external CLI 被拒；**未知 mode 传 `checkCliDelegationAllowed` 返回 deny（当前 `product-mode-agent-policy.test.ts:155` 断言 allow，需反转）**。

绿：V1 provider turn 单次计算 effective Ruleset；接入 `SessionTools`/`LLMRequestPrep`/`ctx.ask`（移除 `tools.ts:82`、`request.ts:200`、`prompt.ts:373` 的分散 merge）；`checkCliDelegationAllowed(mode, tier)`（`product-mode-agent-policy.ts:164` + `task-driver.ts:625` 调用点），按计划 §2.4 表。

退出 Gate：默认生产 V1 路径档位行为与 V2 对齐。

验证：core + aigcfroge typecheck/test。停下等审批。

### Phase 5 — App 档位与 Permission Context

红：selector 仅 `chat/work/assistant × meta` 显示（Coding/非 meta 不显示）；Draft 默认 propose；新 Session create 透传；已有 Session update 有 pending/error/rollback；agent/mode 切换后显示正确；V1/V2 Permission Context 文本一致。

绿：segmented selector + i18n en/zh/zht；Draft/submit/`session.update` 接线；**删除静态 meta 提示词绝对指引**（`plugin/agent.ts:145` "bash/edit/write are denied for meta…" 与已实现 ask 权限矛盾）；V2 `loadSystemContext`（`runner/llm.ts:309`）组合 `system-context/permission-state.ts` Context Source（注册进 registry，`builtins.ts` 同模式）；V1 system 数组追加同一 renderer 文本（`llm/request.ts:28` `input.system`）。

验证：app typecheck（`tsgo -b`）+ `bun --cwd packages/app test:unit`；core/aigcfroge typecheck；i18n 三语最长文本不溢出。停下等审批。

### Phase 6 — Break-Glass

红：仅根 Session 可启用；unattended 根 Session 返回 `InvalidRequestError`；不落库、不继承 fork/child、Layer 重建后关闭、Session 删除清理；三个 HTTP endpoint（`GET/PUT/DELETE /session/:sessionID/permission-override`）与非 durable event；二次确认 UI。

绿：`SessionPermissionOverride` service（Location-scoped `Map<SessionID, expiresAt>`，60s lease，enable/renew/disable/clear，仅根 Session）；HTTP 接线（PUT 首次 enable 需 `acknowledged:true`，同时承担 renew；child/unattended 拒绝）；非 durable EventV2 definition（`event.ts` 支持，不写 durable）；SDK 重生成（endpoint 加入后，不能只生成 tier 字段）；App 二次确认 dialog + 可见/连接健康时续租、断连/过期自动 disable；effective owner 接入 override；Chat `full` 危险 action 不受 override 静默放行。

验证：core + aigcfroge + app typecheck/test；`./packages/sdk/js/script/build.ts` 重生成后 sdk typecheck。停下等审批。

### Phase 7 — 全量回归与文档收口

1. 文档收口（计划内）：ADR-13 Amendment-2 状态标注、Chat PRD 同步、ARCHITECTURE §7 设计状态、CLAUDE.md 债表删除已闭环债项（保留明确未做项）。
2. 全部命令门禁：core/aigcfroge/app/sdk typecheck + test、`bun run script/lint-changed.ts`、`bash .aigcfroge/skills/protocols/scripts/check-refs.sh`、`git diff --check`。
3. V1/V2 parity、工具物化、安全矩阵最终差分审查。
4. 按计划 §11 验收标准逐项核对，未打勾项如实列明。

验证：全量门禁 + 浏览器手工验证（按 `packages/app/AGENTS.md` 启动本地 backend/app，验证桌面/窄视口、light/dark、三语、Permission Dock 全链路）。停下等审批。

---

## 6. 测试纪律

- 测试矩阵以计划 §7 为准；纯函数矩阵覆盖 unknown 输入 fail-safe。
- 不复制 production 权限算法到测试 helper；不断言源码字符串代替行为；不只测 `assert()` 而不测工具定义物化；不只测 V2 遗漏 V1。
- 测试模式：纯逻辑 `it.effect`（TestClock）；真实 DB/子进程/HTTP `it.live`；落盘 `it.instance`；`testEffect` 来自各包 `test/lib/effect.ts`，优先 `Layer.mock`。
- 等待并发 fiber 只用就绪信号（pollWithTimeout/awaitWithTimeout/Deferred/BackgroundJob.wait），严禁 `Effect.sleep(N)`/`setTimeout`。
- 迁移测试：clean DB schema + existing DB migration 双跑；missing historical field decode 为 propose。

## 7. 验证命令（按 Phase 从小到大，禁止从仓根跑包测试）

```bash
bun --cwd packages/core typecheck
bun --cwd packages/core test --timeout 30000
bun --cwd packages/aigcfroge typecheck
bun --cwd packages/aigcfroge test --timeout 30000
bun --cwd packages/app typecheck        # tsgo -b，非 --noEmit
bun --cwd packages/app test:unit
bun --cwd packages/sdk/js typecheck
bun run script/lint-changed.ts
bash .aigcfroge/skills/protocols/scripts/check-refs.sh
git diff --check
```

迁移/SDK 只允许生成器产出：`bun --cwd packages/core script/migration.ts --name add_session_permission_tier`、`./packages/sdk/js/script/build.ts`。

## 8. 交付报告格式（每个 Phase 停点输出）

```text
Phase N 复查结论:
- 影响文件: [路径+摘要；generated 文件标注"由生成器产出"]
- 红→绿证据: [红测试的预期失败输出 + 通过结果（测试名）]
- 命中 skills: [effect/database/protocols/frontend-theming 及用途]
- 安全门禁: [唯一 owner / 档位边界 / Chat full 逐次确认 / unattended / 资产事务 / break-glass 持久化 —— 逐条说明证据]
- 工程门禁: [typecheck/test/lint/check-refs 命令与结果；无 as any/@ts-ignore/star-import 等违规]
- 剩余风险: [不得以风险声明代替未关闭的退出 Gate]
- 额外发现: [范围外问题如实记录，不擅自修复]
```

## 9. 禁止项

- 禁止扩大已批准的 Chat 当前 Session `meta + full` 例外（任何放宽先停下报人类）。
- 禁止假设 V2 是唯一运行时；V1 默认路径未接通不得宣称功能可用。
- 禁止只改授权裁决而忽略工具物化（两者必须同源接线）。
- 禁止把未进入 main 的提交当作已合并前置（Phase 0 复核）。
- 禁止手改 `schema.gen.ts`/`migration.gen.ts`/SDK generated 文件。
- 禁止修改无关文档、push、创建 PR；commit 只含当前 Phase 改动。
- 禁止在仓根运行包测试；禁止直接调用 tsc（用 `bun --cwd packages/<name> typecheck`）。
- 禁止 `Effect.fork`/`forkDaemon`（用 `Effect.forkIn(scope)`）、`as any`/非空断言/`export namespace`/star import/alias import。
- 遇到与计划相悖的实现障碍（API 不存在、调用链不一致、测试失败信息与预期不符）时停下报告，不得自行改架构决策。
