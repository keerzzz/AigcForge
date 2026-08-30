# 会话级权限档位实施计划（Session Permission Tier）

> 状态：**已实施（2026-08-16，分支 `session-permission-tier`；验收与裁决记录见 §9/§10）**
> 日期：2026-08-15（送审）· 2026-08-16（实施收口）
> 依据：[CLAUDE.md](../../CLAUDE.md)、[AGENTS.md](../../AGENTS.md)、[ARCHITECTURE.md](../../ARCHITECTURE.md)、[ADR-13](../architecture/adr/ADR-13-chat-work-mode-boundary.md) + [Amendment-2](../architecture/adr/ADR-13-amendment-2-meta-agent-dispatch.md)、[Chat 模式审计报告](../audit/AigcForge_CHAT_MODE_AUDIT_2026-08-14.md)
> 前置：`fix/chat-mode-audit-p1-p3` 分支已合并（含 `checkCliDelegationAllowed` 与 task 工具模式前置检查）
> 分支：`session-permission-tier`（从 main 切出，批准后即切）
> 范围：`packages/core`（权限服务 + 模式策略 + config 总闸）· `packages/schema`（档位枚举）· `packages/app`（输入框档位选择器 + 设置总闸开关）· `packages/aigcfroge`（V1 meta 信封收窄）
> Owner：Core（权限层）/ Security（边界评审）/ App（输入框 + 设置 UI）
> 命中 skills：`effect`（Effect v4 编码）· `enterprise-code-standard`（实现基线）· `reuse-first-refactor`（复用既有 owner）· `quality-to-pr`（交付门禁）
> Custom 关系：本计划只实现现有 Product Mode 的会话权限档位，不自动批准 Custom 的能力上限或审批模型。Custom 必须在 ADR-17 M0/M1 中定义 mode ceiling 与 Snapshot allowlist；应用级审批入口和 once/Session/Location grant model 属于 Custom M3。
> **裁决修订（2026-08-16 人类裁决，实测确认）**：propose 档写/命令 action 由本计划 §1.3 原提案的 `deny` 修订为 **`ask`（逐次确认）**。两档差异收敛为：`full` 把未知 action 基线从 deny 抬到 ask；已物化的危险 action（bash/edit/write/apply_patch）两档均逐次 ask。档位产生的 ask 与 configured ask 同待遇——可被 saved approval 预授权（实测：propose 档 always 后同类免确认）；不可预授权的红线仅两条：chat × full 的危险 action（红线 4）与 unattended 全降 deny（红线 5）。

---

## 0. 背景与目标

### 0.1 当前状态（代码实测，非推测）

**问题 1 — meta 默认 fail-open，chat 的 deny-write 边界名存实亡。**

`meta` 在 V1（[aigcfroge/agent/agent.ts:129-149](../../packages/aigcfroge/src/agent/agent.ts)）的基线是 `defaults`，首条 `{"*": "allow"}`，仅 deny `bash`/`edit`/`write` 三个 action；V2（[core/plugin/agent.ts:228](../../packages/core/src/plugin/agent.ts)）同形。这属于 fail-open：**新增任何写能力工具，默认对所有模式放行**，除非有人记得去 deny 列表补一行。审计报告 P1-1 / P1-11 已确认。

**问题 2 — 非 coding 模式下 `task → build` 委派被拒且无出路。**

`checkPrimaryAgent` 对三个非编码模式只放行「`meta` + 该模式 orchestrator」，`task → build` 一律拒绝（[product-mode-agent-policy.ts:79-113](../../packages/core/src/product-mode-agent-policy.ts)）。子会话继承父模式（[core/session.ts:203](../../packages/core/src/session.ts) `parent?.mode ?? input.mode ?? Default`），所以委派必被拒；meta 提示词的 `retry once, then switch engine` 换哪个引擎都被拒 → 死路。

**问题 3 — 根会话的 unattended 假设，是 Assistant M4（跨信道）的阻断项。**

[core/permission.ts:177-182](../../packages/core/src/permission.ts) 的 `configured()` 只对子会话做 ask→deny 降级，注释写明「A root session (no parentID) always has the user present」。社交桥接会话是根会话，该假设不成立；`assert` 会挂在 Deferred 上直到会话销毁（`unattendedFallback` 注释预言的挂起失败）。

### 0.2 目标

1. **收窄 meta 默认信封为 fail-closed**：默认只放行提议工具与领域写工具，`bash`/`edit`/`write` 默认 deny。
2. **引入会话级权限档位**：用户可在输入框切换档位，同一 meta 在不同档位下拥有不同有效写权限，且默认档位是收窄的一侧。
3. **build 锁死 coding，meta 非 coding 代 build**：非 coding 模式下 meta 就是 build 的等价体（同样的能力范围），full 档下直接写（走 ask），根治委派死路——meta 不再需要跨模式派 build。
4. **复用现有 ask 审批链路**：高权限档位的写操作走 `ask`，弹现有 `SessionPermissionDock`，不新写弹窗。
5. **修补根会话 unattended 假设**，解除 Assistant M4 的权限层阻断。
6. **委派被拒时返回可操作指引**，消除死路。
7. **新增全局最高权限总闸**：设置里的逃生舱，打开 = 所有智能体所有权限放开（配二次弹窗），越不过 unattended 兜底。

### 0.3 非目标

- 不实现 Assistant M4 的信道网关本身；本计划只解除权限层阻断并交付「桥接会话复用 `subagent_attended_default` 进入无人值守态」契约。
- 不做 `enforcePrimary` 的 `die`→typed failure 改造（影响 5 个调用点，独立立项，见裁决 D4）。
- 不新增"完整访问直接 allow"档位——写权限只给 `ask`，不给 `allow`；更彻底的"全放开"由总闸（Phase 7）提供，配二次弹窗与 unattended 兜底。
- 资产修改/删除的 meta 工具入口（`propose_*_asset_update` / `delete` 之类）不在本计划——目前修改/删除是纯 UI 按钮（PRD §8.3.1），本计划只管"meta 有了写权限后的边界控制"，不管"给 meta 新增删改工具"。

### 0.4 本计划闭环的技术债（从 CLAUDE.md 债表与审计报告收敛）

| 债                                                                         | 来源                                                                                 | 本计划 Phase              |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------- |
| chat 默认 meta fail-open（`{"*":"allow"}` 基线）                           | 审计 P1-1 / P1-11；CLAUDE.md 债表「chat 默认主 agent 为 meta（fail-open 权限信封）」 | Phase 1                   |
| meta 非 coding 无法委派 build 且无兜底出路                                 | CLAUDE.md 债表已登记；审计根因 D                                                     | Phase 5                   |
| 根会话 unattended 假设（ask 挂起风险）                                     | 审计 §7 根因；本计划问题 3                                                           | Phase 0                   |
| `effect` skill 缺吞错反模式（`Effect.catch(() => Effect.void)` / `orDie`） | 审计 §9.3 覆盖缺口                                                                   | Phase 6（弱耦合，可拆出） |

> 注：资产 apply/delete 非会话路由（CLAUDE.md 债表「工作台伪造 sessionID」）与本计划无直接耦合，不纳入，保持独立债项。

---

## 1. 方案核心：会话级档位 + 复用现有 ask

### 1.1 与旧叠加层方案（已否决）的区别

| 维度       | 旧方案：per-agent-per-mode 叠加层                | 新方案：会话级权限档位        |
| ---------- | ------------------------------------------------ | ----------------------------- |
| 权限由谁定 | 代码声明的 mode×agent 规则矩阵                   | **用户在输入框选档位**        |
| 决策成本   | Product 要裁决「assistant 该不该给 write」等组合 | 只需定义档位，用户自行选择    |
| 灵活性     | 固定矩阵，改一次动代码                           | 会话级，临时切换              |
| 安全边界   | 靠代码矩阵保证                                   | 默认 fail-closed + 抬权走 ask |

旧方案的根本问题：它替用户回答「这个模式该给多少写权限」，把产品决策固化成代码矩阵。新方案把决定权交还用户，代码只保证**默认安全**与**抬权需确认**。

### 1.2 三个现成资产（本方案复用，不新造）

| 资产                             | 位置                                                                                                            | 现状                                                       | 本计划            |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------- |
| `session.permission` 列          | [session/sql.ts:52](../../packages/core/src/session/sql.ts) `text({mode:"json"}).$type<PermissionV1.Ruleset>()` | **已存在，projector/info 投影，但 V2 `configured()` 不读** | ⚠️ 见 §3 存储决策 |
| `SessionPermissionDock` ask 弹窗 | [session-permission-dock.tsx](../../packages/app/src/pages/session/composer/session-permission-dock.tsx)        | 完整（once/always/reject 三按钮）                          | 直接复用，零改动  |
| ask 审批全链路                   | [permission.ts](../../packages/core/src/permission.ts) assert→ask→Deferred→事件→弹窗→reply                      | 完整，build 智能体在用                                     | 直接复用，零改动  |

### 1.3 档位定义（提案，取值见裁决 D2）

**核心架构决策（用户 2026-08-15 定）**：`build` 锁死在 coding 模式；非 coding 模式（chat/work/assistant）下 **meta 就是 build 的等价体**——build 在 coding 能做的（写文件、跑命令、edit），meta 在这些模式也能做，**同样的能力范围**。区别只在授权方式：build 在 coding 免确认（allow），meta 在非 coding 要确认（ask）。

档位因此只控制一件事：**meta 在非 coding 模式是否启用这份 build 级能力**。

| 档位              | meta 的能力范围（非 coding）                                | 授权方式                                               | 语义                                                                    |
| ----------------- | ----------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------- |
| `propose`（默认） | 只提议资产（`propose_*`）+ 领域写工具                       | 写 **ask**（2026-08-16 裁决修订，原提案 deny，见文头） | 保守默认，写/命令逐次确认                                               |
| `full`            | **= build 级全工具**（`bash`/`edit`/`write`/`propose_*`/…） | 写 **ask**                                             | meta 成为 build 等价体，每次写弹 dock；未知 action 基线由 deny 抬到 ask |

**委派死路的根治**：meta 在非 coding 模式**不再需要派 build**——build 不跨模式，meta 自己就是 build（full 档下直接写，走 ask）。`checkPrimaryAgent` 保持现状（非 coding 拒绝 build 当主 agent），恰好与「build 锁死 coding」一致，**无需档位感知改造**。

**为什么 meta 的写是 ask 而非 build 的 allow**：build 在 coding 免确认，是因为用户"进入 coding 模式"这个动作已经表达了"让 AI 写代码"的意图；meta 在 chat/assistant 模式是"跨界干活"，每次动手必须确认。能力范围相同，授权强度不同——这是有意的安全设计。

**为什么只有 `ask` 没有 `allow` 档**：`allow` 档等于把 meta 的注入风险（P1-1/P1-11 描述的社交桥接直达面）重新打开。用户点 `always` 本身就是"对该动作永久授信"，与 `allow` 档等价且更细粒度、可撤销（走 `PermissionSaved`）。更彻底的"全放开"由 §1.5 第 1 层总闸提供，配二次弹窗。

### 1.4 现有 agent 权限全景（2026-08-15 实测，档位设计的现状基线）

共享基线 `defaults`（V1 与 V2 同形，**fail-open 根源**）：

```
*: allow                          ← 任何未知 action 默认放行
external_directory: ask（白名单 dir → allow）
question / plan_enter / plan_exit: deny
doom_loop: ask
read: *→allow, *.env→ask, *.env.*→ask, *.env.example→allow
```

11 个 agent 在 `defaults` 之上的有效信封：

| Agent                            | mode             | 有效写/执行能力                         | 关键限制                                                                                          |
| -------------------------------- | ---------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **build**（defaultID）           | primary          | 全开（继承 `*:allow`）                  | +question/plan_enter；唯一"什么都干"的 agent                                                      |
| **meta**                         | primary          | deny bash/edit/write；**allow task**    | +list_assets/question/plan_enter；靠 task 委派间接写                                              |
| **plan**                         | primary          | deny edit（除 `.aigcfroge/plans/*.md`） | +plan_exit、external_directory plans                                                              |
| **general**                      | subagent         | 全开（继承 `*:allow`）                  | deny todowrite/taskwrite/task\_\*/task_schedule/task_spawn                                        |
| **explore**                      | subagent         | **deny-all**                            | 只放行 grep/glob/read/webfetch/websearch                                                          |
| **chat-orchestrator**            | primary          | **deny-all**                            | 只放行 7×propose\_\* + read/glob/grep/question                                                    |
| **work-orchestrator**            | primary          | **deny-all**                            | 只放行 work-preset + task_create/task_update + read/glob/grep/question                            |
| **assistant-orchestrator**       | primary          | **deny-all**                            | 只放行 reminder*\*/memory_propose/kb*\*/propose_note + read/glob/grep/websearch/webfetch/question |
| **compaction / title / summary** | primary (hidden) | **deny-all**                            | 纯内部工具 agent                                                                                  |

**结构规律**：`build` 与 `general` 是 fail-open（继承 `*:allow`）；三个 orchestrator 是 fail-closed（deny-all + 白名单）；`meta` 是"夹心"——fail-open 基线 + 手工 deny 三个写 action + allow task。档位开关正是要把 meta 从"夹心"改成"默认 fail-closed、用户可显式抬权"。

**工具 action 全集（40 个，档位展开只涉及其中 3 个写 action）**：

| 分类         | action                                                                                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 写文件/执行  | `bash` `edit` `write` `apply_patch`                                                                                                                            |
| 读           | `read` `glob` `grep` `list`                                                                                                                                    |
| 网络         | `webfetch` `websearch`                                                                                                                                         |
| 委派         | `task`                                                                                                                                                         |
| 任务板       | `todowrite` `taskwrite` `task_create` `task_update` `task_delete` `task_reorder` `task_schedule` `task_spawn`                                                  |
| 提议资产     | `propose_prompt_asset` `propose_skill_asset` `propose_mcp_asset` `propose_command_asset` `propose_agent_asset` `propose_workflow_asset` `propose_plugin_asset` |
| 领域写       | `work-preset` `reminder_create` `reminder_update` `reminder_cancel` `memory_propose` `propose_note`                                                            |
| 交互/状态    | `question` `plan_enter` `plan_exit` `list_assets` `skill`                                                                                                      |
| （统计标记） | `doom_loop`（非工具，重复调用拦截的 action 标记）                                                                                                              |

**说明**：assistant-orchestrator 的 `kb_search` / `kb_read` / `kb_list_dangling` 三个 action 对应工具已在 [core/src/tool/kb-tools.ts](../../packages/core/src/tool/kb-tools.ts) 完整实现并注册（[builtins.ts:88](../../packages/core/src/tool/builtins.ts) `KBTools.layer`），allow 条目是有效放行，非空转预留。

### 1.5 五层权限控制链（总闸 → 档位 → 授权 → 裁决）

权限请求从「发起到放行/拒绝」经过五层，**从外到内**编号，越靠外越先判断、越不可越过：

| 层    | 名称            | 作用域          | 方向               | 位置                            | 谁可越过谁                                        | Phase |
| ----- | --------------- | --------------- | ------------------ | ------------------------------- | ------------------------------------------------- | ----- |
| **0** | unattended 兜底 | 会话            | 收窄（**硬兜底**） | 后端 `configured()`             | **不可被任何开关越过**；无人值守时 ask→deny       | 0     |
| **1** | 最高权限总闸    | 全局            | 放开（逃生舱）     | config + 后端 `evaluateInput`   | 越过后面的档位/autoAccept/弹窗；**越不过第 0 层** | 7     |
| **2** | 档位开关        | 会话（仅 meta） | 收窄/放开          | 输入框 + `configured()`         | `full` 档的 ask 落到第 3/4 层处理                 | 2/3/4 |
| **3** | autoAccept      | 会话/目录       | 放开（提前授权）   | 设置 + `context/permission.tsx` | 短路第 4 层弹窗                                   | 现有  |
| **4** | ask 弹窗        | 当场            | 裁决               | `SessionPermissionDock`         | 最终兜底（有人值守时）                            | 现有  |

**判断顺序（红线，不可写反）**：

```
configured() → 第 0 层：unattended？→ 无人值守：压 deny，结束
            → 第 1 层：总闸开？→ 有人值守：全 allow，结束
            → 第 2 层：档位展开（propose=deny 写 / full=ask 写）
            → 第 3 层：autoAccept？→ 开：自动 allow，结束
            → 第 4 层：ask 弹窗 → once/always/reject
```

**为什么第 0 层必须最外**：unattended 兜底是「没人看着时宁可拒绝」的安全底线。任何"放开"类开关（总闸/档位/autoAccept）都建立在"有人能点确认"的前提上，桥接/社交场景该前提不成立，故必须被第 0 层挡住。

### 1.6 智能体 × 开关 逻辑关系表

| agent                        | 固有信封                                        | 受总闸(层1)                                    | 受档位(层2)                                                                  | 受 autoAccept(层3) | 受弹窗(层4) |
| ---------------------------- | ----------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------- | ------------------ | ----------- |
| **meta**                     | 夹心（fail-open 基线 + deny 三写 + allow task） | ✅ 全 allow                                    | ✅ **唯一受档位控制**：full 档 = build 级能力（写 ask），propose 档 = 只提议 | ✅                 | ✅          |
| **build**                    | fail-open（继承 `*:allow`）                     | ✅ 全 allow                                    | ❌ 档位只管 meta                                                             | ✅                 | ✅          |
| **general**                  | fail-open                                       | ✅ 全 allow                                    | ❌                                                                           | ✅                 | ✅          |
| **explore**                  | fail-closed（deny-all + 只读白名单）            | ✅ 全 allow（总闸放开后 explore 也能写，见下） | ❌                                                                           | ✅                 | ✅          |
| **chat-orchestrator**        | fail-closed（deny-all + 7×propose）             | ✅ 全 allow                                    | ❌                                                                           | ✅                 | ✅          |
| **work-orchestrator**        | fail-closed（deny-all + work-preset）           | ✅ 全 allow                                    | ❌                                                                           | ✅                 | ✅          |
| **assistant-orchestrator**   | fail-closed（deny-all + reminder/memory/kb）    | ✅ 全 allow                                    | ❌                                                                           | ✅                 | ✅          |
| **compaction/title/summary** | deny-all（内部工具）                            | ⚠️ 也全 allow（无害：它们不调危险工具）        | ❌                                                                           | ✅                 | ✅          |

**关键点 1**：档位开关（层 2）**只作用于 meta**——因为 meta 是唯一跨模式入口。build 锁死 coding（coding 内 meta 派它干活）；非 coding 模式 meta 自己就是 build 等价体（full 档）。其它 agent 要么是委派目标，要么是模式专属 orchestrator，各有固定信封，不受档位控制。

**关键点 2**：总闸（层 1）是"核选项"——它连 fail-closed 的 explore/orchestrator 也一起放开。这是"自由度拉满"的字面含义，但代价是：总闸开时，chat 模式里的 chat-orchestrator 也获得写权限（其 deny-all 被总闸覆盖）。所以总闸必须靠「二次弹窗 + 第 0 层不可越」双重保险，才不算 P0 安全洞。

**关键点 3**：autoAccept（层 3）和弹窗（层 4）是**所有 agent 共享**的——不管哪个 agent 的请求触发 ask，都走同一套授权/裁决链路。所以它们不需要 per-agent 配置。

---

## 2. 五层代码追踪（执行前必读）

### L1 Schema 层 — 类型基底

| 文件                                                                    | 关键定义                                                                            | 本计划            |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------- |
| [schema/permission.ts](../../packages/schema/src/permission.ts)         | `Effect = Literals(["allow","deny","ask"])`；V2 `Rule = {action, resource, effect}` | ❌ 不改           |
| [core/v1/permission.ts:18-26](../../packages/core/src/v1/permission.ts) | **V1 `Rule = {permission, pattern, action}`**（字段名与 V2 不同）                   | ⚠️ 见 §3 桥接决策 |
| [schema/product-mode.ts](../../packages/schema/src/product-mode.ts)     | `ID = Literals(["chat","coding","work","assistant"])`；`Default = "coding"`         | ❌ 不改           |
| **新增** `schema/permission-tier.ts`                                    | `ID = Literals(["propose","full"])`；`Default = "propose"`                          | ✅ Phase 2 新增   |

**关键事实 1**：`ask` effect 已存在且在生产使用（`doom_loop: "ask"`、`external_directory: {"*":"ask"}`、`read: {"*.env":"ask"}`），「有权限但每次要人点头」无需新机制。

**关键事实 2**：V1 与 V2 的 `Rule` 字段名不同——V1 是 `{permission, pattern, action}`，V2 是 `{action, resource, effect}`。`session.permission` 列存的是 **V1 形状**。任何「直接读列拼进 V2 ruleset」的做法都必须先做形状桥接，不能盲目复用。

### L2 Core 权限服务层 — 接入点

[core/permission.ts](../../packages/core/src/permission.ts)（350 行）：

| 位置     | 符号                                      | 作用                                                                         | 本计划                                               |
| -------- | ----------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------- |
| :108     | `evaluate(action, resource, ...rulesets)` | `flat().findLast(match)`，后规则胜；无匹配回落 `{effect:"ask"}`              | ❌ 不改                                              |
| :169     | **`configured(sessionID, agentID)`**      | 取 session（含 mode）→ 解析 agent → 取 `agent.permissions` → unattended 覆盖 | ✅ **主改动点**：追加档位展开规则                    |
| :177-182 | unattended 子会话降级                     | ask→deny                                                                     | ✅ Phase 0 扩展根会话兜底                            |
| :195     | `evaluateInput`                           | `denied()` 前置 + `[...rules, ...remembered]`                                | ❌ 不改（档位规则追加在规则列表，天然走 `findLast`） |

**档位展开的插入语义**：

```
configured() 返回 = [ (unattendedFallback?) , ...agent.permissions , ...tierRules ]
```

- 档位规则**追加在 agent.permissions 之后** → `findLast` 使其覆盖基线
- 档位的 **deny 参与 `denied()` 前置判定** → 覆盖 saved approval（默认档位的 deny-write 边界不可被"永久允许"绕过）
- 档位的 **ask 仍可被 saved approval 预授权** → 与现有 configured ask 同等待遇，语义一致

### L3 Agent 定义层 — 收窄对象

| 文件                                                                            | 内容                                                                                                                                     | 本计划                                                                                                     |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [core/plugin/agent.ts](../../packages/core/src/plugin/agent.ts)                 | V2 meta（deny bash/edit/write + allow task）· chat-orchestrator（:330 deny-all + 7×propose）· work-orchestrator · assistant-orchestrator | ⚠️ V2 meta 与 V1 同形 fail-open（defaults 首条 `{"*":"allow"}` + 手工 deny 三写 action），Phase 1 一并收敛 |
| [aigcfroge/agent/agent.ts:129-149](../../packages/aigcfroge/src/agent/agent.ts) | **V1 `defaults` 首条 `{"*":"allow"}`**（fail-open 根源）                                                                                 | ✅ Phase 1 收窄                                                                                            |

**现状写通道全景**（档位设计不得破坏）：

| 模式      | 主 agent                      | 落盘通道                               |
| --------- | ----------------------------- | -------------------------------------- |
| coding    | `build`（宽）                 | 直接 `edit`/`write`/`bash`             |
| chat      | meta / chat-orchestrator      | propose → 用户 Apply → HTTP typed 事务 |
| work      | meta / work-orchestrator      | work-artifact `/apply`                 |
| assistant | meta / assistant-orchestrator | reminder/memory/kb 各自 typed service  |

### L4 模式策略层 — 档位展开的 owner

[core/product-mode-agent-policy.ts](../../packages/core/src/product-mode-agent-policy.ts)：

| 符号                                  | 作用                           | 本计划                     |
| ------------------------------------- | ------------------------------ | -------------------------- |
| `checkPrimaryAgent(mode, agent?)`     | per-mode agent 白名单          | ✅ Phase 5 扩展错误信息    |
| `checkCliDelegationAllowed(mode)`     | chat 拒 external-cli           | ❌ 不改（前置分支已加）    |
| `enforcePrimary`                      | resolve + check + `Effect.die` | ⚠️ Phase 5 评估（裁决 D4） |
| **新增 `tierRuleset(tier, agentID)`** | 档位 → V2 `Ruleset`            | ✅ Phase 2 新增            |

**为什么归这个模块**：它已是全部 per-mode 规则的唯一 owner（三个 `check*` 函数），档位展开是同族纯函数。模块无 Effect 依赖、全纯函数，测试成本最低。

### L5 消费者层 — 受影响的调用点（须逐个回归）

| 文件:行                                                                                 | 调用                                        | 影响                                       |
| --------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------ |
| [core/permission.ts:244](../../packages/core/src/permission.ts)                         | `assert` ← 所有工具执行                     | 有效 ruleset 随档位变化                    |
| [aigcfroge/session/prompt.ts:1209](../../packages/aigcfroge/src/session/prompt.ts)      | `enforcePrimary`                            | Phase 5 若改 typed failure，需处理错误通道 |
| [aigcfroge/session/session.ts:709](../../packages/aigcfroge/src/session/session.ts)     | `enforcePrimary`                            | 同上                                       |
| [core/session.ts:203](../../packages/core/src/session.ts)                               | `enforcePrimary` + **子会话继承 mode 源头** | 同上                                       |
| [core/session/runner/llm.ts:336 / :623](../../packages/core/src/session/runner/llm.ts)  | `enforcePrimary` / `checkCommandAllowed`    | 同上                                       |
| [core/tool/task.ts](../../packages/core/src/tool/task.ts)                               | `checkPrimaryAgent` 前置分支                | Phase 5 扩展错误信息                       |
| [app 输入框](../../packages/app/src/pages/session/composer/session-composer-region.tsx) | 无（新增档位选择器）                        | Phase 4 新增                               |
| [app/context/permission.tsx](../../packages/app/src/context/permission.tsx)             | autoAccept / `permission.asked` 监听        | ❌ 不改（ask 弹窗链路复用）                |

### L5 附：现有测试资产（复用，不新建脚手架）

| 文件                                                                                                      | 规模                       | 复用点                                                                                                         |
| --------------------------------------------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [core/test/permission.test.ts](../../packages/core/test/permission.test.ts)                               | 426 行 / 19 个 `it.effect` | `setup(rules)` / `setRules` / `assertion` helper + `testEffect(layer)`；4 个 unattended 用例是本计划新用例模板 |
| [core/test/product-mode-agent-policy.test.ts](../../packages/core/test/product-mode-agent-policy.test.ts) | 25 个 `test`               | 纯函数测试模板                                                                                                 |
| [app/src/context/permission.tsx](../../packages/app/src/context/permission.tsx)                           | 已接线                     | `SessionPermissionDock` 的 `onDecide` → `respond` 全链路无需改                                                 |

⚠️ `setup()` 当前插入的 SessionTable 行不指定 `mode` 与档位列（走默认）。新用例需一个能指定 mode 与档位的变体，见 Phase 3 测试清单。

---

## 3. 设计决策与方案对冲

### 3.1 档位存储：新增列 vs 复用 session.permission 列（裁决 D0）

| 选项                                 | 说明                                                          | 代价                                                                                            |
| ------------------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| A（推荐）：新增 `permission_tier` 列 | `text().notNull().default("propose")`，一个 drizzle migration | 语义清晰，避免 V1/V2 形状纠缠                                                                   |
| B：复用 `session.permission` 列      | 存档位标记                                                    | ❌ 该列是 V1 形状 `{permission,pattern,action}`，塞档位枚举语义别扭；且需 V1↔V2 桥接，容易埋雷 |

**推荐 A**：`session.permission` 是 V1 遗留的半接线字段（projector/info 投影但 V2 不读），复用它会引入「这个列既是 V1 ruleset 又是档位标记」的双重语义，违反「字段单一事实真源」。新增列一个 migration 即可，代价最小。

### 3.2 档位展开：纯函数 vs Service（已定）

`tierRuleset(tier, agentID): Permission.Ruleset` 是纯函数，无 Effect 依赖、无 IO。放 `product-mode-agent-policy.ts`，与 `checkCommandAllowed`/`checkCliDelegationAllowed` 同族。不做 Service/Layer——零依赖的纯函数上 Service 是过度设计。

### 3.3 档位范围：写权限只到 ask（已定，见 §1.3）

不提供 `allow` 档。用户点 `always` 即等价授信，且走 `PermissionSaved` 可撤销。给 `allow` 档等于重新打开 P1-1/P1-11 的注入面。

### 3.4 Phase 0 的必要性（不可跳过）

若跳过根会话 unattended 修补而直接上线 `full` 档：

- 桌面端有人值守 → 弹窗，正常
- Assistant M4 社交桥接（根会话、无人值守）→ `assert` 挂 Deferred 直到会话销毁 = **静默挂死**

**Phase 0 必须先于 Phase 3（configured 接入档位）落地**，否则 `full` 档一上线，桥接场景第一次写就挂。

---

## 4. TDD 工作流总则

### 每步强制流程

```
1. 先写失败测试（红）——断言目标行为，不是断言实现
2. 最小实现使其通过（绿）
3. 跑受影响包 typecheck + test
4. git diff 自查：Catch Everything / No Null Pointer / Security First / No Cheating / Reusability / Clean Logs
5. 进入下一步
```

### 测试规范（对齐 [AGENTS.md](../../AGENTS.md) + `effect` skill）

- Effect 服务测试用 `testEffect(layer)`，禁止手写 runtime
- 纯函数测试用 `bun:test` 的 `test()`，不套 Effect
- 禁止 `Effect.sleep(N)` 等待并发；用 `Deferred` / 就绪信号
- 错误断言到 `_tag` 与 `message` 两级，不只断言"抛了"
- 单包运行：`bun --cwd packages/core test <file>`，永不从根目录跑

### 门禁（每 Phase 结束必跑）

```bash
bun --cwd packages/core typecheck
bun --cwd packages/core test
bun --cwd packages/aigcfroge typecheck      # Phase 1 起
bun --cwd packages/app typecheck            # Phase 4 起
bun run script/lint-changed.ts
```

---

## 5. 实施步骤

### Phase 0：根会话 unattended 兜底（阻断项，必须先做）

**问题**：`configured()` 的 ask→deny 降级只覆盖子会话；根会话的 `attended` 读回恒为 `undefined`，而代码假设"根会话总有人在场"。社交桥接会话是根会话，该假设不成立。

**改动**：[core/permission.ts](../../packages/core/src/permission.ts) `configured()`

**Step 0.1（调研，已完成 2026-08-15）**：结论如下，**原"路径 A 去掉 parentID 条件"已证伪**。

实测 `attended` 的全链路取值：

| 环节     | 代码                                                                                                                                                                                                  | 行为                           |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 列定义   | [session/sql.ts:53](../../packages/core/src/session/sql.ts) `integer().$type<0\|1>().default(0)`                                                                                                      | 默认 0                         |
| 写入     | [session/projector.ts:72](../../packages/core/src/session/projector.ts) `info.attended === undefined ? null : info.attended ? 1 : 0`                                                                  | undefined → **NULL**（不是 0） |
| 读出     | [session/info.ts:50](../../packages/core/src/session/info.ts) `row.attended === null ? undefined : row.attended === 1`                                                                                | NULL → **undefined**           |
| 谁显式传 | 仅子会话：[tool/task-driver.ts:389](../../packages/core/src/tool/task-driver.ts)、[session/scheduled-job-executor.ts:36](../../packages/core/src/session/scheduled-job-executor.ts) `attended: false` | **根会话从不传**               |

因此桌面端根会话的 `attended` 恒为 `undefined`，而 `!undefined === true`。**若去掉 `parentID !== undefined` 条件，所有根会话都会被判为无人值守，`doom_loop`/`external_directory`/`.env` 审批弹窗集体失效为静默拒绝——灾难性回归，路径 A 作废。**

**Step 0.2（采纳方案）**：区分「未指定」与「显式声明无人值守」：

```ts
// 子会话：未指定即视为无人值守（保持现状 —— 委派默认不打扰用户）
const unattendedChild = session.parentID !== undefined && !session.attended
// 根会话：只有信道显式声明 attended:false 才降级（桌面端不传 → undefined → 不降级）
const unattendedRoot = session.parentID === undefined && session.attended === false
if (unattendedChild || unattendedRoot) {
  return [unattendedFallback, ...rules.map((r) => (r.effect === "ask" ? { ...r, effect: "deny" as const } : r))]
}
```

- `false` 能与 `undefined` 区分且可往返（projector 写 0，info 读回 `false`），无需新字段、无需 migration
- 代价：Assistant M4 的信道网关须让桥接会话进入无人值守态。**落点已调研**：不硬编码 `attended: false`，而是复用既有配置 `subagent_attended_default`（[settings-v2/general.tsx:425](../../packages/app/src/components/settings-v2/general.tsx) 的开关，`updateConfig({ subagent_attended_default: false })`）。桥接会话创建时读该配置决定 `attended` 取值——桌面端默认 `true` 不受影响，桥接信道默认 `false` 进入降级。这是本 Phase 交付给 M4 的契约

**Step 0.3（红）**：`permission.test.ts` 新增

- `it.effect("root session with attended:false converts ask to deny")` — 新行为
- `it.effect("root session with attended undefined preserves ask rules")` — **桌面端回归锚点，最重要**
- `it.effect("root session with attended:true preserves ask rules")`
- `it.effect("unattended child session still converts ask to deny")` — 现状不回归
- `it.effect("root session with attended:false honors saved approvals over the catch-all deny")` — 与子会话同形

**Step 0.4（绿）**：按 Step 0.2 实现；替换那句「A root session (no parentID) always has the user present」，改为说明两种判据差异及原因。

**验收**：`ask` 在显式声明无人值守的会话下确定降级为 deny；桌面端根会话审批弹窗行为逐字节不变。

### Phase 1：meta 默认信封收窄（fail-closed）

**问题**：V1 `defaults` 首条 `{"*":"allow"}` 是 fail-open 根源（审计 P1-1/P1-11）。档位开关的地基是"默认安全"，否则 `propose` 档本身是漏的。

**改动**：[aigcfroge/agent/agent.ts:129-149](../../packages/aigcfroge/src/agent/agent.ts)

**Step 1.1（调研，已完成 2026-08-15）**：`defaults` 的共享面已实测确认——**V1 侧 4 个 agent 直接继承 `defaults` 的 `{"*":"allow"}`**：`build`（经 `buildDefaults`）、`meta`、`general`、`explore`（后三个在 `defaults` 之上再叠加 deny）。`plan` 也吃 `defaults` 但只在 `.aigcfroge/plans` 内写。

**结论：直接收窄 `defaults` 会同时掐死 `build` 和 `general` 的全开能力，不可行。** 必须**新增一个 fail-closed 的 `metaDefaults`（deny-all + 白名单）只给 meta 用，`defaults` 原样保留给 build/general**。这是 Phase 1 的既定路径，不再是待定分叉。

具体：

```ts
// V1 aigcfroge/agent/agent.ts
const metaDefaults = Permission.fromConfig({
  "*": "deny",
  read: { "*": "allow", "*.env": "ask", "*.env.*": "ask", "*.env.example": "allow" },
  glob: "allow",
  grep: "allow",
  question: "allow",
  list_assets: "allow",
  task: "allow", // 委派保留（间接写，受 checkPrimaryAgent 白名单约束）
  plan_enter: "allow",
  propose_prompt_asset: "allow", // 提议工具白名单（meta 在 propose 档可直接提议）
  propose_skill_asset: "allow",
  propose_mcp_asset: "allow",
  propose_command_asset: "allow",
  propose_agent_asset: "allow",
  propose_workflow_asset: "allow",
  propose_plugin_asset: "allow",
  // bash/edit/write 不在白名单 → 默认 deny（fail-closed）
})
```

V1/V2 侧 `meta` 同形 fail-open（`defaults` 首条 `{"*":"allow"}` + 手工 deny `bash`/`edit`/`write`）：已知写 action 被 deny 覆盖，**新增任何未知写工具默认放行**。Phase 1 对两侧一并收敛为 deny-all + 显式白名单。

**Step 1.2（红）**：`meta-envelope-parity.test.ts` 或现有 agent 测试新增：

- meta 的 `bash`/`edit`/`write` 为 deny（现有行为保持）
- meta 的 `create_agent`/`configure_mcp` 为 deny（V1 已改，V2 保持）
- **meta 的 `{"*": ...}` 不再是 allow**（fail-closed 断言）

**Step 1.3（绿）**：抽 `metaDefaults`（deny-all + 白名单，见 Step 1.1 代码块），meta 用 `metaDefaults` 替代 `defaults`；`defaults` 原样保留给 build/general。V2 侧对齐 `propose_*` 白名单。

**验收**：meta 的基线不再有 `{"*":"allow"}`；新增未知 action 默认 deny；现有提议工具与领域写工具不受影响。

### Phase 2：档位 schema + 展开纯函数

**改动**：[schema/permission-tier.ts](../../packages/schema/src/permission-tier.ts)（新增）· [product-mode-agent-policy.ts](../../packages/core/src/product-mode-agent-policy.ts)

**Step 2.1（红）**：`product-mode-agent-policy.test.ts` 新增 `describe("tierRuleset")`

```
- tierRuleset("propose", "meta") 返回 deny bash/edit/write + allow propose_*（形状断言，非源码字符串匹配）
- tierRuleset("full", "meta") 返回 bash/edit/write → ask
- tierRuleset(未知档位, ...) 返回 []（fail-safe，不放宽）
- tierRuleset(任一档位, 未知 agent) 返回 []
- 返回值是新数组，不共享引用（Ruleset 是 mutable Array）
```

**Step 2.2（绿）**：新增 `schema/permission-tier.ts`（`ID = Literals(["propose","full"])` + `Default = "propose"`）；`product-mode-agent-policy.ts` 新增 `tierRuleset(tier, agentID)` 纯函数，返回 `Permission.Ruleset`。

**Step 2.3**：`export` 走模块自导出（policy 文件顶部已有 `export * as ProductModeAgentPolicy`）。

**验收**：`tierRuleset` 对全部 tier×agent 组合有确定返回，未知输入 fail-safe 返回空。

### Phase 3：`configured()` 接入档位

**改动**：[core/permission.ts](../../packages/core/src/permission.ts)

**Step 3.1（调研，先做）**：确认档位列的读写链路。新增 `permission_tier` 列（裁决 D0 推荐 A）需要：

- drizzle migration 一行
- [session/projector.ts](../../packages/core/src/session/projector.ts) 投影（读）
- [session/info.ts](../../packages/core/src/session/info.ts) 读出
- 会话创建 input（[core/session.ts](../../packages/core/src/session.ts)）透传

**Step 3.2（红）**：`permission.test.ts` 新增 `describe("permission tier")`，先加能指定档位的 setup 变体：

```
- propose 档下 agent 基线 allow edit，档位 deny 生效（档位覆盖基线）
- full 档下同一 agent，edit 走 ask（档位切换可证）
- propose 档的 deny 覆盖 saved approval（先 reply "always" 再 assert 仍 deny）
- 档位为空/默认时行为与改动前逐字节一致（回归锚点）
- full 档 + unattended 会话 → ask 降级为 deny（Phase 0 兜底覆盖档位 ask）
```

**Step 3.3（绿）**：`configured()` 在取 `agent.permissions` 后追加档位展开：

```ts
const tier = session.permissionTier ?? PermissionTier.Default
const tierRules = ProductModeAgentPolicy.tierRuleset(tier, agentID ?? session.agent)
const rules = [...base, ...tierRules]
```

然后 unattended 分支基于合并后 `rules` 处理（顺序：先叠加档位，再 unattended 降级——档位可能引入 ask，需被降级覆盖）。

**Step 3.4**：确认 `denied()` 的 `rules.filter((rule) => rule !== unattendedFallback)` 仍正确——档位 deny 应当参与 deny 优先级，不加入过滤名单。

**验收**：`permission.test.ts` 全绿；`bun --cwd packages/core test` 全绿。

### Phase 4：输入框档位选择器

**改动**：[session-composer-region.tsx](../../packages/app/src/pages/session/composer/session-composer-region.tsx) + 新组件

**Step 4.1（调研，先做）**：读 composer 区域现有控件布局，确认档位选择器插入位置与现有 agent/mode 选择器的交互模式（`session-composer-state.ts` 已有 `permissionRequest` memo 与 `SessionPermissionDock` 渲染，复用其状态管理模式）。

**Step 4.2（红）**：组件测试（happy-dom）——档位选择器：

- 默认显示 `propose`
- 切换到 `full` 触发会话档位更新调用
- 档位切换有 pending/error 态
- i18n 走 `language.t`（en/zh/zht 三语）

**Step 4.3（绿）**：实现选择器组件 + 接线到会话创建/更新（写 `permission_tier` 列）。

**Step 4.4**：确认 `full` 档触发写时，`SessionPermissionDock` 正常弹出（复用现有 `permission.asked` 事件链路，零新增 UI）。

**验收**：桌面端可在输入框切换档位，切换即时生效；`full` 写操作弹现有 dock。

### Phase 5：meta 非 coding 代 build + 拒绝可操作化

**核心目标**：build 锁死 coding（`checkPrimaryAgent` 保持现状，无需档位感知改造）；非 coding 模式下 meta 自己就是 build 的等价体，full 档下直接写（走 ask，Phase 2 的 `tierRuleset` 已覆盖）。本 Phase 只做**提示词对齐 + 拒绝文案**，不动 `checkPrimaryAgent`、不动 `session.ts` 的 mode 继承。

**Step 5.1（调研，先做）**：确认 `PROMPT_META` 里关于委派的指引。现有提示词写的是「every FILE write must go through task → build delegation」（[plugin/agent.ts:145](../../packages/core/src/plugin/agent.ts)）。这条在非 coding 模式是**错误指引**——build 不跨模式，meta 照做只会拿到拒绝。

**Step 5.2（红）**：meta 提示词相关的断言（提示词是字符串，用「含/不含关键句」断言，非假测试）：

- 提示词含「非 coding 模式下不要委派 build，你自己就是 build，直接执行（写走 ask）」
- 提示词含「coding 模式下仍委派 build」
- 不含「FILE write must go through task → build delegation」的绝对表述

**Step 5.3（绿）**：更新 `PROMPT_META` 的委派段，改成模式感知的指引：

```
- coding 模式：写文件委派 build（build 是本模式的执行者）
- 非 coding 模式（chat/work/assistant）：不要委派 build；你自己就是 build 的等价体，
  直接执行（写文件走 ask，用户会确认 once/always/reject）
```

**Step 5.4（红）**：`product-mode-agent-policy.test.ts` 拒绝文案断言（`checkPrimaryAgent` 现状不变，只补文案）：

- `checkPrimaryAgent("chat", "build")` 的 error.message 含「切换 coding 模式」指引
- error.message 含该模式可用 agent 清单

**Step 5.5（绿）**：给 `AgentNotAllowedError.reason` 补动作指引（"要执行代码修改请切到 coding 模式，或在当前模式抬 full 档让我直接做"）。

**Step 5.6**：`enforcePrimary` 的 `Effect.die` 改 typed failure（裁决 D4）。影响 5 个调用点，**默认拆出独立立项**，本 Phase 只做文案。

**验收**：meta 提示词不再误导非 coding 委派 build；拒绝信息可操作（切 coding / 抬 full 档）；无死路。

### Phase 6：文档与架构决策 + 技术债清理

**Step 6.1**：[ADR-13 Amendment-2](../architecture/adr/ADR-13-amendment-2-meta-agent-dispatch.md) 追加 **§1c — Session Permission Tier & Master Switch**

- 声明档位机制：默认 `propose`（fail-closed），用户可切换 `full`；`full` 档 = meta 在非 coding 模式成为 build 等价体（`tierRuleset` 展开写 ask）
- 声明 build 定位：build 锁死 coding；非 coding 模式 meta 代 build（`checkPrimaryAgent` 保持现状，无需档位感知）
- 声明总闸：`master_permission_enabled`（逃生舱），开 = 有人值守会话全 allow；**越不过 unattended 兜底**
- 声明优先级：档位规则覆盖 agent 基线；档位 deny 覆盖 saved approval；档位 ask 在无人值守下降级为 deny；五层控制链顺序（§1.5）
- 声明 owner：`tierRuleset` 归 `product-mode-agent-policy.ts`
- **只写代码实测成立的机制，附 file:line，不重蹈 §1b.3 的"声称但未实现"覆辙**

**Step 6.2**：[CLAUDE.md](../../CLAUDE.md) 技术债表更新

- 删除「chat 默认主 agent 为 meta（fail-open 权限信封）」（Phase 1 闭环，抽 `metaDefaults`）
- 删除「meta 在非 coding 模式下无法委派 build，且无兜底出路」（Phase 5 闭环，meta 非 coding 代 build）
- 若 D4 裁决为「拆出 `die`→typed failure」→ 新增一行记录该项技术债（影响 5 个调用点）

**Step 6.3**：[effect skill](../../.aigcfroge/skills/effect/SKILL.md) 补吞错反模式条目（`Effect.catch(() => Effect.void)` / `orDie` / `ignore`）——与本计划弱耦合，可拆出，但审计 §9.3 已指出为覆盖缺口，建议本分支顺手补。

**Step 6.4**：[ARCHITECTURE.md](../../ARCHITECTURE.md) §7 ADR 状态表加 Amendment-2 §1c 引用。

**验收**：文档描述与代码逐条对应，无"声称但未实现"。

### Phase 7：全局最高权限总闸（逃生舱）

**问题**：高级用户需要一个"放开一切"的全局逃生舱——在受控的知情同意下，临时跳过所有权限检查，让所有智能体自由度拉满。这是与「默认 fail-closed」互补的另一极：默认安全，但可显式全开。

**语义（红线在 Step 7.1 说明）**：

- 配置项 `master_permission_enabled`（默认 `false`）
- 打开时：**有人值守的会话**，所有 agent 的所有 action → allow，跳过档位、autoAccept、ask 弹窗
- 打开动作本身触发**二次确认弹窗**（防误触，见 Step 7.4）
- 关闭或会话结束恢复默认

**Step 7.1（红线，先定）**：**总闸越不过 unattended 兜底。** 总闸的意图是"我在桌面端盯着时别烦我"，桥接/社交场景用户不在场，该意图不成立。故 `evaluateInput` 的判断顺序必须是：

```
1. 先判 unattended（Phase 0 兜底）→ 无人值守：ask/allow 压 deny，返回，结束
2. 再判总闸           → 有人值守 + 总闸开：返回 allow，结束
3. 才轮到档位/autoAccept/ask 弹窗
```

顺序写反（总闸先判、unattended 后判）= 一条微信消息 + 用户之前开过总闸 = 注入直通文件系统。这是 P0 级，Step 7.3 必测。

**Step 7.2（红）**：`permission.test.ts` 新增

- `it.effect("master switch allows a write that tier would deny")` — 总闸开 + propose 档 + write → allow
- `it.effect("master switch does NOT bypass unattended")` — 总闸开 + 无人值守 + write → deny（**红线用例，最关键**）
- `it.effect("master switch off preserves tier semantics")` — 总闸关 + 档位行为逐字节不变（回归锚点）

**Step 7.3（绿）**：`core/config.ts` 加配置项；`evaluateInput` 按 Step 7.1 顺序插入总闸判断（在 `denied()` 之前、`configured()` 之后）。

**Step 7.4（UI + 二次弹窗）**：`settings-v2/general.tsx` 加「最高权限」开关。打开时弹二次确认对话框——措辞须明确"放开所有智能体的所有权限（写文件/执行命令/读 .env/外发网络），仅当前有人值守会话生效"，要求显式勾选/输入确认，不单点即开。

**Step 7.5**：总闸状态持久化（`config` 走 `updateConfig`，与 `subagent_attended_default` 同通道）；会话结束时是否自动复位写入 §6.1 文档（建议：全局配置持久，但每次打开都要二次弹窗，防"忘了关"）。

**验收**：总闸开 + 有人值守 → 全 allow 无弹窗；总闸开 + 无人值守 → 仍 deny（红线不破）；总闸关 → 行为与改动前一致；打开动作必有二次确认。

---

## 6. 测试策略

### 6.1 纯函数层（`product-mode-agent-policy.test.ts`）

穷举 `2 档位 × {meta, chat-orchestrator, work-orchestrator, assistant-orchestrator, build, 未知}` = 12 组合的 `tierRuleset` 返回值。加"未知档位 / 未知 agent → 空"的 fail-safe 用例。

### 6.2 服务层（`permission.test.ts`）

复用 `testEffect(layer)` + `setup`/`setRules`/`assertion`，新增能指定档位的 setup 变体。必测矩阵：

| 场景                       | 期望                       |
| -------------------------- | -------------------------- |
| 档位 deny × 基线 allow     | deny（档位胜）             |
| 档位空/默认 × 基线 allow   | allow（回归锚点）          |
| 档位 deny × saved approval | deny（边界不可被记忆绕过） |
| 档位 ask × 根会话值守      | ask                        |
| 档位 ask × 无人值守        | deny（Phase 0 兜底）       |
| 同 agent 跨两档位          | 判定不同（隔离性）         |

### 6.3 UI 层（组件测试，happy-dom）

档位选择器渲染、切换回调、pending/error 态、i18n 三语。

### 6.4 回归防护

- `bun --cwd packages/core test`（基线 1808 pass / 2 skip）
- `bun --cwd packages/aigcfroge test test/permission-task.test.ts`
- `bun --cwd packages/app test:unit`

### 6.5 禁止的测试写法（假测试）

- ❌ 断言源码字符串包含某规则
- ❌ 只断言"抛错"不断言 `_tag`/`message`
- ❌ 用 `Effect.sleep` 等 permission ask 的 Deferred

---

## 7. 文件清单

### 新增

| 文件                                                                   | 内容                          |
| ---------------------------------------------------------------------- | ----------------------------- |
| `packages/schema/src/permission-tier.ts`                               | 档位枚举 + Default（Phase 2） |
| `packages/core/test/product-mode-agent-policy.test.ts`（扩展）         | `tierRuleset` 穷举            |
| `packages/app/src/pages/session/composer/permission-tier-selector.tsx` | 档位选择器组件（Phase 4）     |
| `packages/app/src/components/settings-v2/master-permission-dialog.tsx` | 总闸二次确认弹窗（Phase 7）   |

### 修改

| 文件                                                                  | Phase   | 改动                                                                      |
| --------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------- |
| `packages/core/src/permission.ts`                                     | 0, 3, 7 | 根会话 unattended 兜底 + 接入档位 + 总闸判断（`evaluateInput`）+ 注释更正 |
| `packages/core/src/product-mode-agent-policy.ts`                      | 2, 5    | 新增 `tierRuleset`；`AgentNotAllowedError.reason` 补动作指引              |
| `packages/core/src/config.ts`                                         | 7       | 新增 `master_permission_enabled` 配置项                                   |
| `packages/core/src/session/sql.ts` + projector + info                 | 3       | 新增 `permission_tier` 列（若裁决 A）                                     |
| `packages/core/src/session.ts`                                        | 3       | 会话创建透传档位                                                          |
| `packages/core/src/plugin/agent.ts`                                   | 5       | `PROMPT_META` 委派指引改模式感知                                          |
| `packages/aigcfroge/src/agent/agent.ts`                               | 1       | meta 信封收窄（fail-closed）                                              |
| `packages/app/src/pages/session/composer/session-composer-region.tsx` | 4       | 接入档位选择器                                                            |
| `packages/app/src/components/settings-v2/general.tsx`                 | 7       | 总闸开关 + 二次弹窗接线                                                   |
| `packages/core/test/permission.test.ts`                               | 0, 3, 7 | 根会话 unattended + 档位矩阵 + 总闸矩阵                                   |
| `packages/core/test/product-mode-agent-policy.test.ts`                | 2, 5    | 档位穷举 + 文案断言                                                       |
| `docs/architecture/adr/ADR-13-amendment-2-meta-agent-dispatch.md`     | 6       | 追加 §1c                                                                  |
| `CLAUDE.md`                                                           | 6       | 技术债表增删                                                              |
| `ARCHITECTURE.md`                                                     | 6       | ADR 状态表                                                                |
| `.aigcfroge/skills/effect/SKILL.md`                                   | 6       | 补吞错反模式                                                              |

### 条件修改（取决于裁决）

| 文件                                                                                                 | 触发条件                                          |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `packages/core/src/session.ts`、`session/runner/llm.ts`、`aigcfroge/src/session/{prompt,session}.ts` | 裁决 D4 为"做 die→typed failure 改造"             |
| `packages/schema/src/session.ts` + migration                                                         | 裁决 D0 为"新增字段"（推荐 A）                    |
| `packages/app/src/context/permission.tsx`                                                            | 若档位切换需联动 autoAccept（Phase 4 调研后确认） |

---

## 8. 风险与缓解

| 风险                                                    | 等级   | 缓解                                                                                                                     |
| ------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| Phase 1 收窄 `defaults` 波及其它共享 agent              | **高** | Step 1.1 已调研关闭：`defaults` 被 4 个 agent 共享，故抽 `metaDefaults` 只给 meta，不碰 `defaults`                       |
| 档位顺序写错导致默认 deny-write 失效                    | **高** | §1 L2 已写明 `findLast` 语义；Phase 3 必测"档位 deny × 基线 allow"；回归锚点保证空档位行为不变                           |
| 档位 deny 被 saved approval 绕过                        | **高** | 档位规则不加入 `denied()` 过滤名单；专门用例：先 reply "always" 再 assert 仍 deny                                        |
| Phase 0 改动影响所有现存会话的 ask 行为                 | **高** | 已调研 `attended` 取值；三个回归用例锁定桌面端现有行为                                                                   |
| V1/V2 权限形状桥接错误                                  | 中     | 裁决 D0 推荐新增独立列，避开复用 V1 形状的 `session.permission` 列                                                       |
| 档位与 `checkPrimaryAgent` 语义重叠                     | 低     | build 锁死 coding（`checkPrimaryAgent` 现状恰好实现它，不改）；`tierRuleset` 管"meta 非 coding 直接写什么"；两者不再重叠 |
| 循环依赖（permission → policy）                         | 低     | policy 模块只依赖 `effect`/`Schema`，无反向依赖                                                                          |
| `full` 档上线后桥接会话挂死                             | **高** | Phase 0 先落地，Phase 3 的 unattended 用例覆盖"档位 ask + 无人值守 → deny"                                               |
| **总闸判断顺序写反（总闸先于 unattended）**             | **P0** | Step 7.1 红线：unattended 先判、总闸后判；Step 7.2 必测"总闸开 + 无人值守 → 仍 deny"，此用例失败即阻断合入               |
| 总闸开时 fail-closed 的 explore/orchestrator 也获写权限 | **高** | §1.6 关键点 2 已明示；靠「二次弹窗 + 第 0 层不可越」双重保险，非 P0 但须在二次弹窗措辞中明示"放开所有智能体"             |

---

## 9. 验收标准

- [x] meta 基线不再含 `{"*":"allow"}`，未知 action 默认 deny
- [x] `tierRuleset(tier, agentID)` 对 12 组合有确定返回，未知输入 fail-safe 返回空
- [x] 同一 agent 在 `propose` 与 `full` 档下对 `edit` 判定不同（档位隔离可证；裁决修订后两档均为 ask，差异体现在未知 action 基线 deny vs ask，`permission-effective.test.ts` 覆盖）
- [x] 档位 deny 覆盖 agent 基线 allow **且** 覆盖 saved approval（裁决修订后档位不再产生 deny-write；本条由「基线显式 deny 重放压过 saved approval」承接，`permission.test.ts` 覆盖）
- [x] 空/默认档位时行为与改动前完全一致（回归锚点用例）
- [x] 任何无人值守会话（根或子）的 `ask` 都不再挂起（unattended 全降 deny，红线 5）
- [x] 输入框可切换档位，`full` 写操作弹现有 `SessionPermissionDock`（2026-08-16 桌面实测 + e2e `permission-tier.spec.ts`）
- [x] 模式拒绝的错误信息含该模式可用替代路径与可操作指引
- [x] `bun --cwd packages/core typecheck` PASS
- [x] `bun --cwd packages/aigcfroge typecheck` PASS
- [x] `bun --cwd packages/app typecheck` PASS
- [x] `bun --cwd packages/core test` ≥ 基线 1808 pass / 0 fail（实测 1855 pass / 0 fail / 2 skip）
- [x] `bun run script/lint-changed.ts` 0 违规
- [x] ADR / CLAUDE.md / ARCHITECTURE.md 描述与代码逐条对应，无"声称但未实现"（2026-08-16 复核补齐本文件闭环）
- [x] CLAUDE.md 债表删除 2 条已闭环债（fail-open 信封、委派死路）
- [x] 总闸开 + 有人值守 → 全 allow 无弹窗；总闸开 + 无人值守 → 仍 deny（红线不破；以 Session 级 break-glass 形态落地，见 §10 D6 裁决修订）
- [x] 总闸关 → 行为与改动前一致（回归锚点）
- [x] 打开总闸必有二次确认弹窗（非单点即开；break-glass 需勾选「我已了解风险并确认」后才可启用，e2e + 实测覆盖）

---

## 10. 审批 Gate

### 已定决策（讨论中已拍板，无需再裁决）

| 编号   | 决策                                                                                                            | 依据                       |
| ------ | --------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **D3** | build 锁死 coding；非 coding 模式 meta 代 build（同样的能力范围，写走 ask）；`checkPrimaryAgent` 保持现状不改造 | 用户明确确认（2026-08-15） |

### 裁决结论（2026-08-16 实施收口时回填）

| 编号         | 裁决                                                                                                                                                                                                                | 实施状态                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **D0**       | **A：新增 `permission_tier` 列**                                                                                                                                                                                    | ✅ `session/sql.ts` + migration `20260815190311_add_session_permission_tier`                                                              |
| **D1**       | 接受（桥接会话复用 `subagent_attended_default`，不硬编码）                                                                                                                                                          | ✅ Phase 0 落地，unattended 兜底测试覆盖                                                                                                  |
| **D2**       | 两档够（`propose` 默认 / `full`），中间档待 Product 提出                                                                                                                                                            | ✅ `schema/permission-tier.ts`                                                                                                            |
| **D2-amend** | **propose 档写/命令 = `ask`（逐次确认），修订原提案 deny**（人类裁决 2026-08-16，见文头「裁决修订」）                                                                                                               | ✅ 实测确认（propose 档 edit 弹 dock）                                                                                                    |
| **D4**       | `enforcePrimary` die→typed failure 改造**拆出**                                                                                                                                                                     | ✅ 未做（保持 die 兜底 + 前置 typed 检查）                                                                                                |
| **D5**       | `effect` skill 补吞错反模式**拆出**                                                                                                                                                                                 | ⏸ 未做，技术债跟进                                                                                                                       |
| **D6**       | **形态修订**：全局持久 config 总闸未实施；以 **Session 级 break-glass**（60s 租约、首启需 `acknowledged:true` 二次确认、不持久化、仅根会话 + 有人值守）落地，chat 危险 action 在 break-glass 下仍逐次确认（红线 4） | ✅ `core/src/permission/session-override.ts` + HTTP `PUT/DELETE /session/:id/permission-override` + App 控件（2026-08-16 e2e + 桌面实测） |

### 审批记录

> 2026-08-16：分支 `session-permission-tier` 实施完成并复审（含 core 五层链路代码审查、e2e 回归、桌面端真实模型实测）。裁决结论如上表；propose=ask 与 break-glass 形态两处对原计划的修订均经人类确认。遗留技术债（V2 系统提示 override 状态 M1、V1 每 turn 收权粒度 M2、break-glass 审计日志 M3、wildcard deny 语义 M5、effect skill 补充 D5）已在 PR 描述声明。

---

> **执行前必读**：本计划 §2 五层追踪的每个 file:line 均为 2026-08-15 实测。执行时若发现代码已变动，先更新 §2 再改代码，不要按过期的追踪表施工。
