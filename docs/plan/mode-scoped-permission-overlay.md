# 会话级权限档位实施计划（Session Permission Tier）

> 状态：**送审终版（前置 Gate 已关闭；尚未实施，2026-08-16 最终复审）**
> 日期：2026-08-15（2026-08-16 复审修订）
> 依据：[CLAUDE.md](../../CLAUDE.md)、[AGENTS.md](../../AGENTS.md)、[ARCHITECTURE.md](../../ARCHITECTURE.md)、[CONTEXT.md](../../CONTEXT.md)、[ADR-13](../architecture/adr/ADR-13-chat-work-mode-boundary.md)、[ADR-13 Amendment-2](../architecture/adr/ADR-13-amendment-2-meta-agent-dispatch.md)（§1c，2026-08-15 人类裁决）、[Chat PRD](../prd/chat-mode-creation-layer.md)（v4.8 §5.2）
> 前置 Gate：**已关闭（2026-08-16 核验）**——`chat-mode-audit` 已合入 `main`（merge `a4b0485aa`，PR #30）；权限安全前置提交 `38de28529`（meta 信封收窄 + external-cli 通道 gate）、`a6321f20e`（meta 非 coding 模式 bash/edit/write 改 ask）、`a272e463f`（ADR-13 Amendment-2）均为 `main` 祖先（`git merge-base --is-ancestor 38de28529 main` 通过，`main..HEAD` 为空）。实施分支 `session-permission-tier` 可从当前 `main` 直接切出
> 范围：`packages/schema`、`packages/core`、`packages/aigcfroge`、`packages/app`、`packages/sdk/js`、相关 ADR/PRD/架构文档
> Owner：Core（有效权限与 Session 数据）/ Security（权限边界）/ App（档位与 break-glass UI）/ API（V1/V2 往返）
> 执行提示词：[prompt-mode-scoped-permission-overlay.md](prompt-mode-scoped-permission-overlay.md)

---

## 0. 结论与目标

### 0.1 根因

当前权限行为由多处分别决定（2026-08-16 main 代码实测）：

1. Agent 固有权限决定工具是否在 provider turn 开始前可见。（V2：`SessionRunner.runTurn` 直接 `tools.materialize(agent.info?.permissions, intent)`，`packages/core/src/session/runner/llm.ts:387`；V1：`LLMRequestPrep.resolveTools` 内 `Permission.merge(input.agent.permission, input.permission ?? [])`，`packages/aigcfroge/src/session/llm/request.ts:197-200`）
2. V1 `Permission.ask()` 与 V2 `PermissionV2.assert()` 在执行时再次裁决。（V2 `packages/core/src/permission.ts:244`；V1 `packages/aigcfroge/src/session/prompt.ts:373` 与 `tools.ts:82` 的 `ctx.ask`）
3. Session 的 `permission` 字段只进入 V1 部分链路。（V1 `tools.ts:82`/`request.ts:200` 会 merge `session.permission`；V2 `configured()`（`permission.ts:169-185`）只读 agent 固有权限，不读 `session.permission`）
4. Product Mode 只限制 Agent 选择和部分委派路径，不表达用户主动抬权。
5. V1/V2 Session 创建与 prompt 路径尚未完全收敛。

如果仅在 V2 `configured()` 追加档位规则，会出现“授权层允许，但工具未物化”“V2 生效但默认 V1 不生效”“UI 显示 full 但模型看不到写工具”的三类双轨行为。

### 0.2 目标

1. 将 `meta` 的 V1/V2 默认信封统一收敛为 fail-closed。
2. 新增 Session 持久档位：`propose`（默认）与 `full`。
3. 档位只影响经过批准的 `mode × agent` 组合；Coding 不受档位影响。
4. 用户主动为有人值守的 Chat 根 Session 开启 `full` 后，meta 可直接使用写文件和命令工具；危险操作仍逐次 `ask`，并同步 ADR/PRD。
5. V1/V2 工具物化与执行裁决读取同一个有效权限 owner。
6. 根会话可显式声明 `attended:false`，所有未预授权的 `ask` 确定降级为 `deny`。
7. 提供当前根 Session 的临时 break-glass：有人值守时放开一般权限，但 Chat `full` 危险 action 仍逐次 `ask`；状态不持久化、不继承、进程重启自动关闭。
8. 补齐 Schema、数据库、HTTP、SDK、App、fork/child 的完整数据往返。
9. 通过动态 Permission Context 告知 meta 当前 mode/tier/override，删除静态提示词中的错误绝对指引。

### 0.3 非目标

- 不迁移或删除 V1 runtime；本计划要求 V1/V2 同时实现。
- 不实现 Assistant M4 信道网关；只提供明确的根 Session `attended` 创建契约。
- 不把 `enforcePrimary` 的最后防线从 defect 改为 typed failure；task 前置检查继续提供可读错误，底层 `die` 保留为不可绕过防线。
- 不新增全局持久化“最高权限”配置。
- 不改变 `chat-orchestrator`、`work-orchestrator`、`assistant-orchestrator` 的固定 fail-closed 信封。
- 不给模型暴露 break-glass HTTP API，也不新增可修改权限状态的工具。
- 不顺带修改 Effect skill；吞错反模式规则已经存在。

---

## 1. 已定架构决策

| 编号 | 决策 | 结果 |
|---|---|---|
| D0 | 档位存储 | 新增 `session.permission_tier` 列；领域/API 字段统一为 `permissionTier` |
| D1 | 档位集合 | `propose`（默认）/ `full` 两档 |
| D2 | 生效范围 | `chat/work/assistant × meta`；Coding 和非 meta Agent 忽略档位 |
| D3 | Chat 边界 | 默认 propose-only；用户主动为有人值守的当前根 Session 开启 `full` 后，meta 可直接写文件和运行命令，危险操作逐次 `ask` |
| D4 | build 定位 | build 继续锁死 Coding；非 Coding 的 meta 在 `full` 下直接使用本地工具，不跨模式委派 build |
| D5 | 有效权限 owner | 新增一个纯 owner，同时生成 V1/V2 有效 Ruleset |
| D6 | break-glass | 当前根 Session 临时状态；不落库、不进 config、不继承 child/fork、服务重启清零 |
| D7 | unattended | 根会话由创建方显式传 `attended:false`；不复用 `subagent_attended_default` |
| D8 | 运行时范围 | V1/V2 工具物化与执行授权必须同时接线 |
| D9 | 生效时机 | 放宽工具目录从下一 provider turn 生效；收窄后的执行裁决可立即拒绝尚未执行的工具调用 |

### 1.1 ADR-13 当前 Session 例外

现有 ADR-13 已批准的默认契约保持不变：

- `propose` 是默认档位。
- `chat-orchestrator` 永远 propose-only。
- Chat 不允许通过 `task → build` 或 external CLI 绕过模式边界。

人类已于 2026-08-15 选择受控例外：

- 用户必须主动为当前有人值守的 Chat 根 Session 选择 `meta + full`。
- meta 可直接使用当前有效规则物化出的写文件和命令工具。
- `bash`、`edit`、`write`、`apply_patch` 及未来未知危险 action 默认 `ask`，每次操作进入现有 Permission Dock。
- Chat `full` 的危险 action 必须逐次确认，saved approval 不得将其静默预授权；Agent 基线显式 deny、unattended deny 优先。
- unattended Session 不得启用 break-glass，且 `full` 中的 `ask` 一律降为 `deny`。
- Chat 的 `task → build` 与 external CLI 继续拒绝，避免形成第二条不可监管执行通道。
- 已注册资产类型仍必须走 `propose_* → 用户确认 → 受校验的 apply/delete 事务`，不得用通用写工具绕过资产校验、CAS、回滚和 registry reload。

该例外改变的是当前 Session 的执行权限，不改变 Chat 默认档位和资产生命周期 owner。ADR-13 Amendment-2 §1c（6 项约束）与 Chat PRD v4.8 §5.2（6 项约束）已与本表逐条一致（2026-08-15 工作区同步版），实施时不得扩大该例外。

### 1.2 档位语义

| 场景 | 有效结果 |
|---|---|
| Coding + 任意 Agent + 任意档位 | 忽略档位，保持 Agent 固有信封 |
| 非 Coding + 非 meta | 忽略档位，保持 orchestrator/Agent 固有信封 |
| 非 Coding + meta + propose | meta fail-closed 基线 |
| Chat/Work/Assistant + meta + full | 未知 action 默认 ask；meta 基线中的安全 allow 继续 allow |
| 当前根 Session + master/override + attended | 一般场景全 action/resource allow；Chat `full` 危险 action 仍为 ask |
| 任意 unattended Session | break-glass 无效；所有 ask 转 deny |
| 未知 mode / 未知 agent / 未知 tier | fail-safe：不抬权、不产生 wildcard allow，保持对应兜底（Coding 默认 / orchestrator 信封 / propose 语义） |

`full` 不是 `build` 的等价体：它只把 `chat/work/assistant × meta` 基线中原本 deny 的写/命令 action 抬到 `ask`，不产生任何新的 `allow`，也不改变 read/领域工具既有 allow。若未来确需“build 等价”语义，必须另行定义完整 action/resource 范围与新增工具的 fail-closed 策略，并另走 ADR 审批。

`full` 的构造不得手写“当前 40 个工具白名单”。它应使用以下稳定语义：

```text
meta fail-closed baseline
→ 追加 wildcard ask，使未知能力可见但必须确认
→ 重新追加 baseline 中非 deny 规则，保留 read/propose/question 等既有 allow
```

这样新工具不会静默放行，也不会因为漏维护静态清单而永远不可见。

### 1.3 saved approval 优先级

规则优先级保持现有安全语义：

1. Agent/meta 基线与档位中的显式 `deny` 优先于 saved approval。
2. Work/Assistant 的 `full` 产生的 `ask` 可沿用 saved approval；Chat `full` 的危险 action 必须逐次确认，不接受 `always` 预授权。
3. unattended 将 `ask` 转成显式 `deny`，saved approval 不得重新放开该次无人值守调用。
4. break-glass 不写入 saved approval，也不产生长期授权。

---

## 2. 唯一有效权限 Owner

### 2.1 新模块

新增：

`packages/core/src/permission/effective.ts`

模块自导出：

```ts
export * as PermissionEffective from "./effective"
```

该模块是纯函数 owner，不访问数据库、不读取 Config、不持有 Map。输入由调用方从 Session、Agent、master/override service 和 saved approvals 组装。

建议公开面：

```ts
type Input = {
  mode: ProductMode.ID
  agent: string
  tier: PermissionTier.ID
  parentID?: SessionSchema.ID
  attended?: boolean
  masterPermissionEnabled: boolean
  savedApprovals: ReadonlyArray<SavedApproval>
}

effectiveV1(input, base): PermissionV1.Ruleset
effectiveV2(input, base): PermissionV2.Ruleset
context(input): PermissionContext
```

`effectiveV1` 与 `effectiveV2` 必须由同一个中性 action/resource 决策结果转换而来；V1/V2 不得各自重写 mode、agent、tier、master、attended 或 saved approval 的条件分支。`masterPermissionEnabled` 是会话级临时状态，默认关闭，必须经过二次确认，且不能由模型或普通 Session API 修改。

同一有效规则是以下五类消费者的唯一输入：

1. V1/V2 provider turn 的工具物化（`ToolRegistry.materialize`，`packages/core/src/tool/registry.ts:52/162`）；
2. V1/V2 工具执行授权（`PermissionV2.assert`，`permission.ts:244`；V1 `ctx.ask`，`packages/aigcfroge/src/session/tools.ts:82`）；
3. unattended 降级（`Input.attended === false` 时 `ask → deny`，saved approval 与 override 均不得重新放开）；
4. saved approval 优先级（`Input.savedApprovals`，见 §1.3）；
5. 会话级临时 master/override（`Input.masterPermissionEnabled` + §4 的 SessionPermissionOverride）。

当前 `configured()`（`permission.ts:169-185`）与 `runner/llm.ts:387` 的 `materialize(agent.info?.permissions, intent)` 分别读取不同来源，正是本计划要消除的分叉；`ToolRegistry` 不新增 Permission service 依赖，也不承担执行授权（`packages/core/src/tool/AGENTS.md` 已确认 registry 无 `PermissionV2` 依赖）。

### 2.2 V2 调用链

```text
SessionRunner.runTurn（packages/core/src/session/runner/llm.ts:327/:578）
  → PermissionV2.Service.effectiveRules(sessionID, agentID)   [新接口]
  → ToolRegistry.materialize(effectiveRules, intent)          （runner llm.ts:387 现传 agent.info?.permissions，需改）
  → provider
  → tool leaf PermissionV2.assert(...)                        （permission.ts:244，经 evaluateInput → configured）
  → PermissionV2.Service.effectiveRules(sessionID, retainedAgent)
```

改动要求：

- `PermissionV2.Interface`（`permission.ts:124-131`）新增只读 `effectiveRules`。
- `configured()`（`permission.ts:169-185`）内部改为调用 `PermissionEffective.effectiveV2`；unattended 降级从“仅子会话”推广到显式 `attended:false` 的根会话（现状只覆盖 `parentID !== undefined`）。
- `SessionRunner` 不再把 `agent.info.permissions` 直接交给 `materialize()`（`runner/llm.ts:387`）。
- `ToolRegistry` 继续只负责定义过滤，不新增 Permission service 依赖，符合 `packages/core/src/tool/AGENTS.md`。
- 执行时重新裁决允许“用户刚刚收窄权限”立即生效；放宽后的新增工具目录在下一 provider turn 出现。

### 2.3 V1 调用链

```text
SessionPrompt.loop（packages/aigcfroge/src/session/prompt.ts）
  → 读取 Session + Agent + SessionPermissionOverride
  → PermissionEffective.effectiveV1(...)
  → SessionTools.resolve(effectiveRules)          （tools.ts:82 现 merge agent.permission + session.permission）
  → LLMRequestPrep.resolveTools(effectiveRules)   （llm/request.ts:197-200 现再次拼接 agent 基线）
  → tool context.ask(effectiveRules)              （prompt.ts:373 现 merge taskAgent.permission + session.permission）
```

改动要求：

- V1 provider turn 只计算一次 effective Ruleset，并传给工具定义过滤、LLM request 和 `ctx.ask()`。
- `SessionTools.resolve` 不再自行 `merge(agent.permission, session.permission)`（`tools.ts:82`）。
- `LLMRequestPrep.resolveTools` 不再再次拼接 Agent 基线（`request.ts:197-200`）。
- Session 临时 `permission` 规则仍可作为 base 的末尾输入，但档位/override 规则必须由统一 owner 追加。
- V1/V2 针对同一 mode/agent/tier/attended/override 的行为必须有 parity 测试。

### 2.4 委派策略

`checkPrimaryAgent` 保持 build 锁死 Coding 的现状（`packages/core/src/product-mode-agent-policy.ts:79`）。

`checkCliDelegationAllowed`（`product-mode-agent-policy.ts:164`，调用点 `packages/core/src/tool/task-driver.ts:625`）改为接收档位：

| Mode | propose | full |
|---|---|---|
| chat | deny | deny |
| work | deny | allow |
| assistant | deny | allow |
| coding | allow | allow（档位实际忽略） |

现状注意：当前签名只有 `(mode: string)` 且未知 mode 返回 `allowed: true`（`packages/core/test/product-mode-agent-policy.test.ts:155` 有断言）。实施时必须改为 `(mode, tier)` 并把未知 mode 断言反转为 deny（fail-safe）；档位化与 fail-safe 属本计划 Phase 4 实施项，不是已合并行为。

Chat 的 external CLI 在 `propose` 和 `full` 下都保持拒绝；已批准的直接写入范围不能由 external CLI 旁路扩大。

---

## 3. Session 数据与 API

### 3.1 领域字段

新增 `packages/schema/src/permission-tier.ts`：

```ts
export const ID = Schema.Literals(["propose", "full"])
export const Default = "propose"
```

字段命名：

- 数据库：`permission_tier`
- TypeScript/HTTP/SDK：`permissionTier`

### 3.2 持久化规则

- 新建根 Session：未传时为 `propose`。
- 子 Session：默认 `propose`；不得继承 Chat 根 Session 的 `full` 例外。
- fork：默认 `propose`；用户必须在新根 Session 再次主动开启 `full`。
- 旧 Session：迁移默认 `propose`。
- 更新已有 Session：允许通过 `session.update` 修改。
- break-glass 不进入 Session Info、Event durable payload、数据库或 SDK Session 类型。

### 3.3 数据往返清单

实施必须按以下顺序完整覆盖（每项都有对应代码位点）：

```text
PermissionTier Schema（packages/schema/src/permission-tier.ts，新增）
→ SessionTable.permission_tier（packages/core/src/session/sql.ts，新增列；现列见 :32 parent_id / :52 permission / :53 attended）
→ schema.gen.ts（生成器）
→ TypeScript migration（packages/core/src/database/migration/*.ts，由生成器产出）
→ migration.gen.ts（生成器）
→ SessionV1.SessionInfo（packages/core/src/v1/session.ts:546，含 permission :573 / attended :574）
→ SessionSchema.Info（packages/schema/src/session.ts:34 mode / :63 attended）
→ V1/V2 CreateInput（core v1/session.ts、packages/aigcfroge/src/session/session.ts:263-276、packages/core/src/session.ts:81 attended）
→ Session Created/Updated event payload（v1/session.ts:585-601，携带完整 SessionInfo）
→ projector.sessionRow（packages/core/src/session/projector.ts:44，permission :71 / attended :72）
→ SessionInfo.fromRow（packages/core/src/session/info.ts:17，attended :50）
→ V1 Session.Info/CreateInput/Patch（packages/aigcfroge/src/session/session.ts:245 Info permission / :263 CreateInput / :498 Patch 排除 permission 需复核）
→ HTTP CreateInput/UpdatePayload（packages/aigcfroge/src/server/routes/instance/httpapi/groups/session.ts:53-62 UpdatePayload、:313-320 create、:337-345 update）
→ handler create/update
→ session adapter V2→V1（packages/aigcfroge/src/session/session.ts）
→ SDK regeneration（./packages/sdk/js/script/build.ts）
→ App Draft（packages/app/src/pages/session/composer/）
→ new Session submit
→ existing Session selector update
→ fork/child reset-to-propose
```

迁移必须通过生成器产生：

```bash
bun --cwd packages/core script/migration.ts --name add_session_permission_tier
```

禁止手改 `schema.gen.ts`、`migration.gen.ts` 或 SDK generated 文件。

**Phase 1 可用性门禁**：默认 V1 路径（HTTP `session.create` → aigcfroge V1 `Session.create`（`packages/aigcfroge/src/session/session.ts:694`）→ V2 适配）与同步 `session.prompt`（HTTP `POST /session/:sessionID/message` → `SessionPrompt`，`groups/session.ts:103/439`）接通且 round-trip 测试通过之前，不得宣称档位功能可用。

### 3.4 attended 契约

- 根 Session 的 `attended` owner 必须是 V1/V2 Session create adapter；不得从仅服务子代理的 `subagent_attended_default` 推导——该配置项（`packages/core/src/config.ts:114`）只被 task 委派子会话读取（`packages/core/src/tool/task.ts:156`），与根 Session 契约无关。
- V2 `CreateInput.attended` 保持现有字段（`packages/core/src/session.ts:81/234`）。
- V1 `Session.CreateInput`（`packages/aigcfroge/src/session/session.ts:263-276` 现无 attended）、HTTP CreateInput 和 V1 Session 创建实现补 `attended?: boolean`。
- 桌面 App 不传，保持 `undefined`，视为有人值守。
- Assistant M4 或其他无人值守桥接创建根 Session 时必须显式传 `false`。
- 子 Session 的 attended 规则必须沿用现有子代理契约（`permission.ts:181` 仅对 `parentID !== undefined` 生效），并与根 Session 契约分开验证。

---

## 4. Session 级 Break-Glass

### 4.1 状态 Owner

新增：

`packages/core/src/permission/session-override.ts`

职责：

- Location-scoped `Map<SessionID, expiresAt>`。
- `get`、`enable`、`renew`、`disable`、`clear`。
- 只允许根 Session 激活。
- Chat `full` 的危险 action 不受 override 静默放行，仍逐次 `ask`。
- 每次 enable/renew 写入 60 秒 lease；过期后读取即视为关闭并清理。
- Session 删除时清理。
- Layer 释放或服务重启时自动清空。
- 不读取/写入 config 或数据库。

### 4.2 HTTP

在 Session HTTP group/handler 增加认证后的 typed 端点（`packages/aigcfroge/src/server/routes/instance/httpapi/groups/session.ts`，现有 `SessionPaths.permissions`（:108，ask 响应端点）路径不变，不与新端点冲突）：

```text
GET    /session/:sessionID/permission-override
PUT    /session/:sessionID/permission-override
DELETE /session/:sessionID/permission-override
```

启用 payload 至少包含：

```ts
{ acknowledged: true }
```

约束：

- child Session 返回 `InvalidRequestError`。
- unattended 根 Session 返回 `InvalidRequestError`。
- API 不注册为模型工具；普通 Session API（create/update/prompt）不得携带或修改 override 状态。
- 状态变化发布非 durable 的 EventV2 definition（EventV2 `define` 的 `durable` 可省略，`packages/core/src/event.ts:23/36/128` 支持非持久投影），App 多窗口同步；不得写 durable EventV2。
- SDK 在 endpoint 加入后重新生成，不能只生成 Session tier 字段。
- `PUT` 同时承担 enable/renew；只有首次 enable 需要 `acknowledged:true`，未启用状态下缺确认必须拒绝。

### 4.3 UI

break-glass 位于 Session composer 权限区域，不放全局 Settings。

打开时必须：

1. 弹二次确认对话框。
2. 明示将允许当前 Session 的所有 Agent 读取敏感文件、执行命令、写文件和访问网络；Chat `full` 的危险操作仍逐次确认。
3. 要求显式勾选确认。
4. 显示“服务重启自动关闭、不会应用到子会话或其他会话”。
5. App 仅在页面可见且 Session 连接健康时续租；页面隐藏、断连或 60 秒无续租时服务端自动关闭。

关闭无需二次确认。

---

## 5. 动态 Permission Context

静态 meta 提示词（V1/V2 共用，`packages/core/src/plugin/agent.ts` 内 prompt 常量，:145 处“bash/edit/write are denied for meta — every FILE write (create/edit) must go through task → build delegation”已与实现矛盾）不得继续声明任何绝对写路径指引。

改为：

1. 静态 prompt 只要求服从当前 Session Permission Context。
2. 公共纯 renderer 根据 mode/agent/tier/override 生成短指令。
3. V2 在 `SessionRunner.loadSystemContext`（`packages/core/src/session/runner/llm.ts:309`）组合一个 Session-owned Context Source（`packages/core/src/system-context/permission-state.ts`，注册进 registry，`builtins.ts` 同模式）。
4. V1 在 provider turn 的 system 数组中追加同一 renderer 的文本（`LLMRequestPrep.prepare` 的 `input.system`，`packages/aigcfroge/src/session/llm/request.ts:28`）。

必须表达：

- Coding meta：写入继续委派 build。
- 非 Coding meta + propose：只使用当前安全/领域工具，不尝试通用写入。
- 非 Coding meta + full：可直接使用当前可见工具；ask 表示必须等待用户确认。
- break-glass：当前 Session 已显式全开，但仍须遵守用户任务和安全协议。

不得依赖模型自行猜测 mode 或 tier。

---

## 6. TDD 实施阶段

每个 Phase 严格执行：

```text
红：先写行为测试并确认按预期失败
绿：最小实现使测试通过
重构：去重并保持测试绿色
回归：受影响包 typecheck/test + lint-changed
复查：按 CLAUDE.md 改完即审输出结论
```

### Phase 0：基线与前置 Gate（已关闭，仅做切分支前复核）

1. [已核验 2026-08-16] `chat-mode-audit` 已合入 `main`（merge `a4b0485aa`，PR #30）；`38de28529` 为 `main` 祖先；`checkCliDelegationAllowed` 已存在于 `packages/core/src/product-mode-agent-policy.ts:164`（当前单参 `(mode: string)`，未知 mode 放行——档位化与 fail-safe 是本计划 Phase 4 的实施项，不是已合并行为）。
2. [已核验] Chat `full` 的 2026-08-15 人类裁决（方案 B）已同步进 ADR-13 Amendment-2 §1c 与 Chat PRD v4.8 §5.2（本分支工作区修订版）。
3. 从当前 `main` 创建 `session-permission-tier`。
4. 记录 core、aigcfroge、app、sdk 当前 typecheck/test 基线。
5. 实施首日按最新代码重新核对 file:line；漂移时先修计划锚点。

退出 Gate：实施分支从含前置提交的 `main` 切出，工作区无无关改动。

### Phase 1：Schema、迁移与 Session 往返

红：

- PermissionTier decode/default。
- 新旧数据库迁移。
- V1/V2 create/get/update/fork/child round-trip。
- V1 HTTP create 接收 `attended:false`。

绿：

- 新增 Schema。
- 修改 Session SQL/Info/Event/Create/Patch。
- 运行 migration generator。
- 补 HTTP schema/handler/adapter。
- 重新生成 SDK。

退出 Gate：新旧数据库均解码 `permissionTier`；V1/V2/API/SDK 字段一致。

### Phase 2：meta V1/V2 fail-closed parity

现状核对（main 已实现部分，本 Phase 只做剩余缺口）：

- V1 meta（`packages/aigcfroge/src/agent/agent.ts:227-250`）与 V2 meta（`packages/core/src/plugin/agent.ts:456-485`）的 `bash/edit/write → ask`、`task → allow` 已落地（提交 `a6321f20e`，2026-08-15 裁决实现）。
- 剩余缺口：两个 meta 基线仍以 `defaults` 首条 `{ action: "*", resource: "*", effect: "allow" }` 开头（`plugin/agent.ts:229`），新增写能力工具默认对所有模式放行（fail-open）。本 Phase 需替换为 deny-first 基线 + 显式白名单，并保持 V1/V2 同构。

红：

- V1/V2 meta 均无 wildcard allow。
- 已知安全工具可见。
- 未知 action 默认 deny。
- build/general 固有行为不变。

绿：

- 分别抽取 V1/V2 `metaDefaults`（deny-first）。
- 保留共享 build/general defaults。
- 补齐 propose 工具和 read 环境文件规则 parity。

退出 Gate：meta fail-closed，其他 Agent 无回归。

### Phase 3：有效权限 Owner + V2

红：

- mode×agent×tier×attended×override 矩阵。
- propose 隐藏 edit/bash。
- 已批准 `mode × agent × full` 组合物化 edit/bash 且执行结果为 ask。
- master/override 物化并 allow；Chat `full` 危险 action 仍保持 ask。
- unattended 压制 full/break-glass。
- saved approval 优先级；Chat `full` 危险 action 仍逐次 ask，Work/Assistant 保持既有细粒度预授权语义。

绿：

- 实现 `PermissionEffective`。
- `PermissionV2.Service.effectiveRules`。
- runner 使用 effectiveRules 物化。
- assert 使用同一 owner。

退出 Gate：V2 定义过滤与执行授权无分叉。

### Phase 4：V1 parity

红：

- 与 Phase 3 相同矩阵的 V1 parity。
- V1 LLM request 和 tool context 收到同一 Ruleset。
- work/assistant propose 下 external CLI 被拒。
- 未知 mode 传 `checkCliDelegationAllowed` 返回 deny（当前 `packages/core/test/product-mode-agent-policy.test.ts:155` 断言 allow，需反转）。

绿：

- V1 provider turn 单次计算 effective Ruleset。
- 接入 SessionTools、LLMRequestPrep、ctx.ask。
- `checkCliDelegationAllowed(mode, tier)`（`product-mode-agent-policy.ts:164`，调用点 `task-driver.ts:625`）。

退出 Gate：默认生产 V1 路径的档位行为与 V2 对齐。

### Phase 5：App 档位与 Permission Context

红：

- selector 只在 `chat/work/assistant × meta` 显示；Coding 和非 meta Agent 不显示。
- Draft 默认 propose。
- 新 Session create 透传。
- 已有 Session update 有 pending/error/rollback。
- agent/mode 切换后显示规则正确。
- V1/V2 Permission Context 文本一致。

绿：

- segmented selector + i18n en/zh/zht。
- 接线 Draft、submit、session.update。
- 删除 V2 meta 静态提示词中的错误绝对指引（`packages/core/src/plugin/agent.ts:145`：“bash/edit/write are denied for meta — every FILE write must go through task → build delegation”，与已实现的 ask 权限矛盾，且对 Coding/非 Coding 一律断言不成立）。
- V1/V2 注入动态 Permission Context。

退出 Gate：用户看到的档位与实际 mode/agent 生效范围一致。

### Phase 6：Break-Glass

红：

- 仅根 Session 可启用。
- unattended 不可启用。
- 不落库、不继承 fork/child。
- Layer 重建后关闭。
- Session 删除清理。
- 三个 HTTP endpoint 与非 durable event。
- 二次确认 UI。

绿：

- SessionPermissionOverride service。
- HTTP/API/App 接线。
- effective owner 接入 override。
- endpoint 加入后再次运行 SDK generator。

退出 Gate：临时全开只作用于当前有人值守根 Session。

### Phase 7：全量回归与文档收口

1. 更新 ADR-13 Amendment-2、Chat PRD、ARCHITECTURE/CLAUDE 技术债，记录 Chat 默认 propose-only 与当前 Session `full` 例外。
2. 删除已闭环债项，保留明确未做项。
3. 执行全部命令门禁。
4. 对 V1/V2 parity、工具物化、安全矩阵做最终差分审查。

---

## 7. 测试矩阵

### 7.1 纯函数

至少覆盖：

```text
4 modes × 6 agents × 2 tiers
+ attended true/false/undefined
+ override on/off
+ unknown mode/agent/tier
```

未知输入必须 fail-safe，不得产生 wildcard allow。

### 7.2 工具物化与执行一致性

| 场景 | 定义可见 | 执行效果 |
|---|---|---|
| chat/meta/propose/edit | 否 | deny |
| chat/meta/full/edit | 是 | ask |
| chat/meta/full/edit + saved approval | 是 | ask（仍逐次确认） |
| work/meta/propose/bash | 否 | deny |
| work/meta/full/bash | 是 | ask |
| assistant/assistant-orchestrator/full/edit | 否 | deny |
| coding/meta/full/edit | 否 | meta 继续委派 build |
| work/meta + attended root + override/edit | 是 | allow |
| chat/meta + attended root + override/edit | 是 | ask（仍逐次确认） |
| unattended root + override/edit | 否 | deny |

### 7.3 数据与迁移

- clean DB schema。
- existing DB migration。
- missing historical field decode 为 propose。
- update 后重载仍为新档位。
- fork/child 均回落 `propose`，不继承根 Session 的 `full` 例外。
- break-glass 永不出现在 DB/Event/SDK。

### 7.4 UI

- selector 显示条件。
- pending/error/rollback。
- break-glass confirm/disable。
- light/dark。
- en/zh/zht 文案和最长文本不溢出。
- 键盘 focus 与可访问名称。

### 7.5 禁止的测试

- 不断言源码字符串代替行为。
- 不复制 production 权限算法到测试 helper。
- 不使用 `Effect.sleep(N)` 等待。
- 不只测 `assert()` 而不测工具定义物化。
- 不只测 V2 而遗漏默认 V1。

---

## 8. 文件清单

### 8.1 新增

| 文件 | 内容 |
|---|---|
| `packages/schema/src/permission-tier.ts` | 档位 Schema |
| `packages/core/src/permission/effective.ts` | V1/V2 唯一有效权限 owner |
| `packages/core/src/permission/session-override.ts` | Session 临时 break-glass |
| `packages/core/src/system-context/permission-state.ts` | V2 Permission Context |
| `packages/app/src/pages/session/composer/permission-tier-selector.tsx` | 档位 segmented selector |
| `packages/app/src/pages/session/composer/session-permission-override-dialog.tsx` | break-glass 二次确认 |
| 对应 core/aigcfroge/app 测试文件 | 纯函数、服务、API、UI 与 parity |

### 8.2 修改

| 区域 | 文件 |
|---|---|
| Session Schema/DB | `packages/core/src/session/{sql,info,projector}.ts`、`packages/schema/src/session.ts`、`packages/core/src/v1/session.ts`、数据库生成物 |
| Session 服务 | `packages/core/src/session.ts`、`packages/aigcfroge/src/session/session.ts` |
| V2 Permission | `packages/core/src/permission.ts`、`packages/core/src/session/runner/llm.ts`、`packages/core/src/plugin/agent.ts`（meta 基线） |
| V1 Permission | `packages/aigcfroge/src/session/{prompt,tools,llm}.ts`、`packages/aigcfroge/src/session/llm/request.ts`、`packages/aigcfroge/src/agent/agent.ts`（meta 基线） |
| Agent/Policy | `packages/core/src/plugin/agent.ts`、`packages/aigcfroge/src/agent/agent.ts`、`packages/core/src/product-mode-agent-policy.ts`、`packages/core/src/tool/task-driver.ts`（:625 调用点） |
| HTTP | `packages/aigcfroge/src/server/routes/instance/httpapi/groups/session.ts`（:53-62 UpdatePayload、:313 create、:337 update）、handler 与 server tests |
| App | Draft/submit/composer/global sync/i18n |
| SDK | 通过 `./packages/sdk/js/script/build.ts` 生成 |
| Docs | ADR-13 Amendment-2、Chat PRD、ARCHITECTURE、CLAUDE 债表 |

---

## 9. 验证命令

按 Phase 从小到大执行，禁止从仓库根目录运行包测试：

```bash
bun --cwd packages/core typecheck
bun --cwd packages/core test --timeout 30000

bun --cwd packages/aigcfroge typecheck
bun --cwd packages/aigcfroge test --timeout 30000

bun --cwd packages/app typecheck
bun --cwd packages/app test:unit

bun --cwd packages/sdk/js typecheck

bun run script/lint-changed.ts
bash .aigcfroge/skills/protocols/scripts/check-refs.sh
git diff --check
```

UI 实现完成后按 `packages/app/AGENTS.md` 启动本地 backend/app，使用浏览器验证桌面与窄视口、light/dark、三语和 Permission Dock 全链路。

---

## 10. 风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| 工具物化与执行授权再次分叉 | P0 | 同一 effective owner；V1/V2 parity + materialization/assert 成对测试 |
| Chat full 绕过默认产品边界 | 高 | 默认 propose；用户主动开启；危险 action 逐次 ask；unattended deny；资产写入仍走 typed propose/apply |
| break-glass 被持久化或跨 Session 泄漏 | P0 | 独立临时 service；禁止 DB/config；重启/删除清理；不继承测试 |
| V1 默认路径无档位 | P0 | Phase 4 阻断 Gate；V1/V2 同矩阵 |
| wildcard ask 覆盖安全 allow 导致噪声 | 中 | full 后重新追加 meta baseline 的非 deny 规则 |
| 档位切换与当前 turn 竞态 | 中 | 放宽下一 turn 生效；执行阶段重新裁决允许立即收窄 |
| migration/generated 文件漂移 | 高 | 只运行 generator；clean/existing DB 双测试；SDK 只用脚本生成 |
| Assistant 默认 orchestrator 显示无效 selector | 中 | 仅 `chat/work/assistant × meta` 显示 |
| external CLI 形成第二写通道 | 高 | Chat 永久 deny；Work/Assistant propose deny、full 才 allow |
| break-glass 在客户端断连后仍存活 | 高 | HTTP lease 每 60 秒续期；App 可见且连接健康时续租，断连或过期自动 disable |

---

## 11. 验收标准

- [x] 前置权限安全提交已进入 `main`（merge `a4b0485aa`，PR #30；`38de28529` 为 `main` 祖先，2026-08-16 核验），实施分支来源正确
- [x] Chat `full` 已于 2026-08-15 获人类裁决（方案 B），ADR-13 Amendment-2 §1c 与 Chat PRD v4.8 §5.2 已同步记录显式 Session 例外
- [ ] meta V1/V2 基线 fail-closed，未知 action 默认 deny（现状：bash/edit/write=ask 已落地，`defaults` wildcard allow 待移除）
- [ ] `PermissionEffective` 是 V1/V2 档位和 override 的唯一决策 owner
- [ ] V1/V2 工具物化与执行裁决使用同一有效规则
- [ ] Coding、非 meta Agent 不受档位影响
- [ ] propose/full 在 V1/V2 上行为一致
- [ ] Session permissionTier 完整往返，fork/child 明确回落 `propose`
- [ ] V1 根 Session 可显式创建为 `attended:false`（V1 `Session.CreateInput` 补字段并接通 HTTP）
- [ ] 默认 V1 `session.create` 与同步 `session.prompt` 接通（HTTP → V1 服务 → V2 适配 round-trip）后才宣称档位功能可用
- [ ] break-glass 仅当前有人值守根 Session 生效、不持久化、断连过期自动关闭
- [ ] Chat external CLI 在所有档位均拒绝
- [ ] Work/Assistant external CLI 仅 full 可用；未知 mode fail-safe deny（`checkCliDelegationAllowed(mode, tier)` 档位化）
- [ ] 动态 Permission Context 与实际 mode/tier/override 一致；静态 meta 提示词绝对指引（`plugin/agent.ts:145`）已删除
- [ ] SDK、migration、schema generated 文件均由脚本生成
- [ ] core/aigcfroge/app/sdk typecheck 与相关测试通过
- [ ] lint-changed、协议引用检查、`git diff --check` 通过
- [ ] CLAUDE.md 改完即审报告无未声明风险

---

## 12. 审批记录

| 项目 | 结论 |
|---|---|
| 前置 Gate | 已关闭：`chat-mode-audit` 已合入 `main`（merge `a4b0485aa`，PR #30），`38de28529` 为 `main` 祖先（2026-08-16 核验） |
| 架构冲突 | 已裁决：默认 propose-only；当前有人值守根 Session 可主动开启 `meta + full`（ADR-13 Amendment-2 §1c / Chat PRD v4.8 §5.2 已同步） |
| 工具物化双轨 | 设计已指定唯一 effective owner（`PermissionEffective`，五类消费者同一输入）；代码待实施 |
| V1/V2 双运行时 | 计划已要求双端强制实现；代码待实施 |
| mode 维度 | 设计已限定 `chat/work/assistant × meta`；Coding 与非 meta Agent 忽略档位；未知 mode/agent/tier fail-safe |
| 数据链 | 计划已补齐 Schema/DB/API/SDK/App/fork/child（§3.3 全链位点）；代码待实施 |
| 总闸风险 | 设计已改为 Session 级临时 break-glass；Chat 危险 action 不免确认 |
| unattended owner | 设计已改为创建方显式 `attended:false`；不复用 `subagent_attended_default` |
| external CLI | 设计已同步为 Chat 全档拒绝、Work/Assistant full 才放行、未知 mode fail-safe；代码待实施 |
| 无关 Effect skill 工作 | 已移出范围 |

> 最终批准条件：本修订版通过文档引用、事实一致性和独立读者复审后，将状态更新为“已批准”，再生成实施提示词施工。
