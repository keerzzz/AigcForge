# Meta-Agent V2 生产级闭环升级方案

> **状态**: v4 — 2026-07-08 更新，Share V2 内部分享已实现（替代外网分享），V2 闭环接近完成
> **作者**: 高级全栈顾问
> **日期**: 2026-07-05（v4 更新 2026-07-08）
> **审批**: 有条件批准 → 已修正 3 项事实错误 + 4 项重大遗漏，详见各章修订注记
> **范围**: 弃 V1，全切 V2，接线闭合到生产级闭环
> **关联文档**: [meta-agent-orchestrator.md](meta-agent-orchestrator.md) · [cache-miss-diagnostics-and-agent-upgrade.md](cache-miss-diagnostics-and-agent-upgrade.md) · [subagent-protocol-cards.md](subagent-protocol-cards.md) · [../architecture/global-stats-design.md](../architecture/global-stats-design.md) · [../../specs/v2/todo.md](../../specs/v2/todo.md) · [meta-agent-v2-session-endpoints-handoff.md](meta-agent-v2-session-endpoints-handoff.md)

---

## 0. 文档定位与原则

本文档是 **V1→V2 全切换 + 接线闭合**的总执行方案。它不重复已有计划文档的细节，而是**聚合 + 排序 + 补 gap**：把分散在 5 份 meta-agent 计划、`specs/v2/todo.md`、`specs/effect/todo.md` 中的承诺与现状收敛成单一可执行路线。

**v4 修订要点**：
- R11：Share 方案变更——**外网分享改为内部分享**（[SessionShareV2](../../packages/core/src/session/share-v2.ts)），通过 EventV2 Synthetic 事件在会话间传递上下文
- R12：V2 闭环接近完成，剩余 P3.2/P3.5/P3.6 为 Phase 3 收尾，Fork 为独立任务

**v2 修订要点**（基于审批 R1-R10）：
- R1：Stuck 事件已实现（[event.ts:440](../../packages/core/src/session/event.ts#L440) + [compaction.ts:278](../../packages/core/src/session/compaction.ts#L278)），删除"定义+publish"任务
- R2：新增 §1.5 V1 Layer 栈（50 个）V2 对等物清单——**揭示 SessionRevert/SessionSummary 无 V2 对等且被 HTTP 端点直接暴露**，新增 Phase 2 补建任务
- R3：P1.1 改写——`packages/server` V2 路径未验证，Phase 0 必须先 smoke test
- R4：P2.7 补 CLI 适配器归属（接口迁 core，实现保留 aigcfroge）
- R5：新增 V2 禁用 meta 回退开关
- R6：P3.2/P3.3 顺序调换（SDK 扩展先于 hook 迁移）
- R7：P3.1 拆 MCP-basic/MCP-oauth；P3.5 重估工期
- R8：P3.7 拆出 Mode Switcher viewport 为独立 plan
- R9：P5.3 补双 SSE 统一方向
- R10：新增 §8 协议合规约束，各 Phase 任务补注

**执行原则**（继承 [CLAUDE.md](../../CLAUDE.md) 八荣八耻 + 极致减法）：
1. **复用优先**：V2 已实现的能力直接接线，不重写
2. **删除即资产**：孤岛代码随迁移删除
3. **小步快跑**：每 Phase 独立可验收、可回退（feature flag）
4. **生产级标准**：schema 稳定 + 错误兜底 + 可观测性 + 测试覆盖四者齐备
5. **不破坏 HTTP 契约**：V1 端点（revert/unrevert/diff）在 V2 必须有对等实现或显式下线决策

---

## 1. 现状基线

**一句话**：V2 实现已就绪且 `packages/server` 已接线，但 aigcfroge 运行时仍走 V1。阻塞不在 core，而在 aigcfroge 根 Layer 未 provide V2 全栈 + httpapi 路由标识符被 V1 抢注 + CLI/ACP 入口指向 legacy 路由 + **50 个 V1 Layer 中 14 个无 V2 对等（含 SessionRevert/SessionSummary 被 HTTP 端点暴露）**。

### 1.1 已实现并就绪（直接可用）

| 子系统 | 位置 | 状态 |
|---|---|---|
| SessionV2 admission | [session.ts:322-347](../../packages/core/src/session.ts#L322) | ✅ |
| SessionExecution + Coordinator | [execution/local.ts](../../packages/core/src/session/execution/local.ts) + [run-coordinator.ts](../../packages/core/src/session/run-coordinator.ts) | ✅ |
| SessionRunner tool loop | [runner/llm.ts:98-438](../../packages/core/src/session/runner/llm.ts#L98) | ✅ |
| SessionStore/Projector | [store.ts](../../packages/core/src/session/store.ts) + [projector.ts](../../packages/core/src/session/projector.ts) | ✅ |
| AgentV2（8 agent 全对等） | [agent.ts:34-111](../../packages/core/src/agent.ts#L34) + [plugin/agent.ts:184-303](../../packages/core/src/plugin/agent.ts#L184) | ✅ |
| ToolRegistry + ApplicationTools | [tool/registry.ts](../../packages/core/src/tool/registry.ts) + [application-tools.ts](../../packages/core/src/tool/application-tools.ts) | ✅ |
| PermissionV2 | [permission.ts](../../packages/core/src/permission.ts) | ✅ |
| SkillV2 + SkillTool | [skill.ts](../../packages/core/src/skill.ts) + [tool/skill.ts](../../packages/core/src/tool/skill.ts) | ✅ |
| TodoWrite V2 | [tool/todowrite.ts](../../packages/core/src/tool/todowrite.ts) + [session/todo.ts](../../packages/core/src/session/todo.ts) | ✅ |
| EventV2 PubSub + 持久化 | [event.ts](../../packages/core/src/event.ts) | ✅ |
| `packages/server` V2 全栈 | [server/src/handlers.ts:22-56](../../packages/server/src/handlers.ts#L22) | ⚠️ 未端到端验证（见 R3） |
| provider-defined tool (`providerExecuted`) | [runner/llm.ts:272](../../packages/core/src/session/runner/llm.ts#L272) | ✅ |
| **Compaction.Stuck 事件** | [event.ts:440](../../packages/core/src/session/event.ts#L440) 定义 + [compaction.ts:278](../../packages/core/src/session/compaction.ts#L278) publish | ✅ **已实现（R1 修正）** |
| **V2 task 工具** | [tool/task.ts](../../packages/core/src/tool/task.ts) + [tool/task-driver.ts](../../packages/core/src/tool/task-driver.ts) + [session/task-driver-fill.ts](../../packages/core/src/session/task-driver-fill.ts) | ✅ **2026-07-08 完成** |
| **V2 attended 权限收敛** | [permission.ts:160-175](../../packages/core/src/permission.ts#L160) + task tool Input `attended` | ✅ **2026-07-08 完成（替代 V1 deriveSubagentSessionPermission）** |
| **external-cli 迁移** | [tool/cli-adapter.ts](../../packages/core/src/tool/cli-adapter.ts) + [tool/cli-timeout.ts](../../packages/core/src/tool/cli-timeout.ts) + 4 适配器 | ✅ **2026-07-08 完成（含 opencode）** |
| **abort 级联传播** | [session.ts:453-463](../../packages/core/src/session.ts#L453)（interrupt cascade children） | ✅ **2026-07-08 完成** |

### 1.2 已实现未接线（孤岛）

| 子系统 | 位置 | 问题 |
|---|---|---|
| V2 runner 本身 | [runner/llm.ts](../../packages/core/src/session/runner/llm.ts) | aigcfroge 运行时不 provide 它 |
| `INTENT_TOOL_FILTERS` | [tool/registry.ts:15-40](../../packages/core/src/tool/registry.ts#L15) | runner 不传 intent（[llm.ts:205](../../packages/core/src/session/runner/llm.ts#L205) 仅传 permissions），死代码 |
| intent 选模型桩 | [runner/model.ts:75,213](../../packages/core/src/session/runner/model.ts#L75) | 同上，dead |
| cache-warmth | [aigcfroge/src/agent/meta/cache-warmth.ts](../../packages/aigcfroge/src/agent/meta/cache-warmth.ts) | 无 src 调用方 |
| workflow engine | [aigcfroge/src/agent/meta/workflow/](../../packages/aigcfroge/src/agent/meta/workflow/) | 无 src 调用方 |
| `meta_agent_step` 表 | [core/src/meta-agent/sql.ts:46](../../packages/core/src/meta-agent/sql.ts#L46) | 无写入方 |
| TUI EventV2 消费 | [tui/src/context/data.tsx:132-345](../../packages/tui/src/context/data.tsx#L132) | 已就绪（V2 切换后无需改） |

### 1.3 缺失（必须新建）

| 缺口 | 严重度 | 依赖 | 修订注记 |
|---|---|---|---|
| `{{SUBAGENTS_LIST}}`/`{{CLI_LIST}}` 填充器 | P0 | AgentV2.all()（已有） | |
| MetaAgent 服务层（create/get/attach/stats） | P0 | 无 | |
| prerouter 迁移到 core + 接入 runner | P0 | 无 | |
| **V2 SessionRevert 服务** | **P0** | 无 | **R2 新增——断 revert/unrevert HTTP 端点** |
| **V2 SessionSummary/diff 服务** | **P0** | 无 | **R2 新增——断 diff HTTP 端点** |
| V2 MCP 领域模型 | P0 | 无 | R7 拆 basic/oauth |
| MetaHooks 插件扩展点 | P1 | plugin SDK | |
| V2 plugin 自定义工具（ToolHooks） | P1 | plugin SDK | |
| UI event-reducer 识别 `session.next.*` | P1 | 无 | |
| V2 config schema 落地 | P1 | 无 | R7 重估工期 |
| V2 禁用 meta 回退开关 | P1 | 无 | **R5 新增** |
| V2 SessionShare（内部分享） | P1 | 无 | **新决策：替代外网分享** |
| Mode Switcher viewport（Chat/Work/Assistant） | P1 | ADR-09 | R8 拆出独立 plan |

### 1.4 文档漂移（必须同步）

| 文档 | 漂移 |
|---|---|
| [ARCHITECTURE.md:244](../../ARCHITECTURE.md#L244) | 标 MetaAgent/ModeSwitcher/StatusBar "Planned"，实际已实现 |
| [v1-removal-and-v2-migration-plan.md](v1-removal-and-v2-migration-plan.md) | 标题误导：是 UI Token 迁移，非 Agent Runtime 迁移 |
| [specs/v2/todo.md](../../specs/v2/todo.md) | 非结构化叙述，无 done/in-progress/planned 标记 |
| [specs/v2/schema-changelog.md:674](../../specs/v2/schema-changelog.md#L674) | 声明 V2 数据 "disposable"，未达生产级向前兼容 |

### 1.5 V1 Layer 栈 V2 对等物清单（R2 新增）

**审批抽查发现**：[app-runtime.ts:55-106](../../packages/aigcfroge/src/effect/app-runtime.ts#L55) 实际 provide **50 个 V1 Layer**（v1 方案只提 SessionPrompt，严重低估）。逐项对等性：

#### ✅ 已对等（8 个）—— 需迁移消费者 import

Skill · Discovery · Question · Permission · Todo · Command · ToolRegistry · Project · Ripgrep · BackgroundJob · Observability

#### 🔄 范式差异（3 个）—— 需迁移调用方式

| V1 Layer | V2 范式 | 影响 |
|---|---|---|
| SessionCompaction | [compaction.ts:180](../../packages/core/src/session/compaction.ts#L180) `make()` 函数式（非 Layer） | 调用从 `yield* SessionCompaction.Service` 改为 `const c = SessionCompaction.make({...})` |
| LLM | [packages/llm](../../packages/llm/src/index.ts#L9) `LLMClientService`（独立包） | Layer 名变 `LLMClient` |
| SessionPrompt | [runner/llm.ts:98](../../packages/core/src/session/runner/llm.ts#L98) `SessionRunner` | monolith 拆为 runner + publisher + toolMaterialization |

#### 🔀 桥接（2 个）—— 共存期保留

- EventV2Bridge（V1 经桥接复用 V2 EventV2）
- Session → SessionStore 部分（V1 `setSummary`/`setRevert` 在 V2 SessionStore **无对应方法**）

#### ⚠️ 部分对等（7 个）—— 需逐方法核对

Session · SessionStatus · BackgroundJob · MCP · Command · Vcs（→GitV2） · Workspace · Instruction（→SystemContext） · LSP

#### ❌ 完全无对等（14 个）—— 需补建或显式下线决策

| V1 Layer | V1 职责 | V2 状态 | 切换影响 | 处置 |
|---|---|---|---|---|
| **SessionProcessor** | LLM stream 处理/toolcall 生命周期/compaction 触发 [processor.ts:62-1084](../../packages/aigcfroge/src/session/processor.ts#L62) | 逻辑内联进 [runner/llm.ts:174-435](../../packages/core/src/session/runner/llm.ts#L174) | 调用方迁移面广（prompt/compaction/tools/httpapi） | P2.8 迁移消费者 |
| **SessionRevert** | revert/unrevert/cleanup [revert.ts:19-137](../../packages/aigcfroge/src/session/revert.ts#L19) | **完全无对等**（仅 [v1/session.ts:532](../../packages/core/src/v1/session.ts#L532) Schema；[runner/llm.ts:80](../../packages/core/src/session/runner/llm.ts#L80) TODO） | **断 revert/unrevert HTTP 端点 + /revert CLI 命令** | **P2.9 新建 V2 对等** |
| **SessionSummary** | diff 文件变更统计（非 LLM 摘要） [summary.ts:66-146](../../packages/aigcfroge/src/session/summary.ts#L66) | **完全无对等**（V2 compaction 是 LLM 摘要，不同职责） | **断 diff HTTP 端点** | **P2.10 新建 V2 对等** |
| SessionStatus | busy/idle 状态机 | busy 检查散落，无集中 Service | assertNotBusy 逻辑丢失 | 确认丢弃或补建 |
| SessionRunState | 会话运行态/busy 锁 | 无 | 与 SessionStatus 一起是 V1 编排态 | 确认丢弃或补建 |
| RuntimeFlags | 运行时开关 | 无 | 配置开关迁移 V2 Config | P3.5 config 落地时处理 |
| McpAuth | MCP OAuth 授权 | 无 | OAuth 流程丢失 | P3.1 MCP-oauth 含 |
| Truncate | 输出截断 | 散落 tool/bash/compaction | 无独立 Service | 确认丢弃 |
| Format | 输出格式化 | 无 | 需补建或下线 | 确认丢弃 |
| Installation | 安装元信息 | 仅 version/channel 常量 | 无 Service | 确认丢弃 |
| ShareNext / SessionShare | 会话分享 | 仅表结构 | 分享逻辑丢失 | 确认丢弃或补建 |
| InstanceLayer | 实例层 | 无 | 多实例注入逻辑 | 确认丢弃或补建 |

**关键风险（R2 核心）**：SessionRevert/SessionSummary 不仅被 [prompt.ts:141,142](../../packages/aigcfroge/src/session/prompt.ts#L141) 内部用，还被 [httpapi/handlers/session.ts](../../packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts) + [groups/session.ts](../../packages/aigcfroge/src/server/routes/instance/httpapi/groups/session.ts) **直接暴露为 HTTP 端点**。直接删 V1 会断 3 个用户可见端点。必须 P2.9/P2.10 先补建 V2 对等。

---

## 2. 目标架构（V2 全栈目标态）

```
用户输入（CLI / TUI / ACP / desktop）
  ↓
HTTP API（packages/server V2 handlers，session.prompt 路由）
  ↓
SessionV2.prompt → durable admit（session_input 表）+ EventV2 PromptAdmitted
  ↓
SessionExecution.wake → SessionRunCoordinator（coalesce/join）
  ↓
SessionRunner.run（packages/core/src/session/runner/llm.ts）
  ├─ PreRouter.preRoute（迁入 core，intent→engine 快路径）  ← P2.3 接入
  ├─ AgentV2.select（meta 优先；AIGCFROGE_DISABLE_META_AGENT 回退 build）  ← P2.11
  ├─ SystemContext（SkillGuidance + ReferenceGuidance + 填充后的 meta prompt）  ← P2.4
  ├─ SessionHistory.loadForRunner（baseline seq 截断）
  ├─ ToolRegistry.materialize（含 V2 task + MCP V2 + 内置 + plugin 工具）
  ├─ LLMClient.stream（@aigcfroge/llm 原生路径，处理 providerExecuted）
  ├─ tool settlement（durable record + authorize + execute）
  ├─ SessionTodo（todowrite 工具）
  ├─ SessionRevert V2 / SessionSummary V2  ← P2.9/P2.10 补建
  └─ MetaAgent step 写入（meta_agent_step 表）  ← P2.6 接入
  ↓
EventV2 publish（session.next.*）→ SQLite + PubSub
  ↓
SSE（统一路径：aigcfroge handler 直接订阅 EventV2 + directory 过滤）  ← P5.3 统一
  ↓
app（event-reducer 识别 session.next.*）+ TUI（已就绪）+ desktop
```

**v2 修订**：目标架构图新增 P2.9/P2.10（revert/summary 补建）、P2.11（meta 禁用开关）、P5.3（SSE 统一方向）。

---

## 3. 阻塞点依赖图

```
Phase 0（基线+验证）─┬─ P0.1 建分支 + feature flag
                     ├─ P0.2 smoke test 验证 packages/server V2 端到端  ← R3 关键
                     └─ P0.3 V2 schema 基线快照 + 测试基线
                       │
Phase 1（接线）─┬─ P1.1 app-runtime provide V2 全栈（50 Layer 逐项迁移）  ← R3
               ├─ P1.2 httpapi 路由 namespace 解冲突
               └─ P1.3 入口灰度切换（feature flag）
                       │
                       ▼（task/revert/summary 未补建前，meta 委派 + revert 端点降级）
Phase 2（meta + V1 无对等能力补齐）─┬─ P2.1 deriveSubagent（V2 权限收敛）← **✅ 2026-07-08 完成**
                        ├─ P2.2 V2 task 工具重写 ← 依赖 P2.1 **✅ 2026-07-08 完成**
                        ├─ P2.3 prerouter 迁入 core + 接入 runner
                        ├─ P2.4 占位符填充器
                        ├─ P2.5 MetaAgent 服务层 ← 依赖 P2.2
                        ├─ P2.6 meta_agent_step 写入接线 ← 依赖 P2.5
                        ├─ P2.7 PROMPT_META 单源化 + CLI 适配器归属  ← R4 **✅ CLI 适配器已迁移 core（2026-07-08）**
                        ├─ P2.8 SessionProcessor 消费者迁移  ← R2 新增
                        ├─ P2.9 V2 SessionRevert 服务补建  ← R2 新增（断端点）
                        ├─ P2.10 V2 SessionSummary/diff 服务补建  ← R2 新增（断端点）
                        └─ P2.11 V2 禁用 meta 回退开关  ← R5 新增
                       │
Phase 3（下游对等）─┬─ P3.1a MCP-basic + P3.1b MCP-oauth  ← R7 拆分
                   ├─ P3.2 V1 字符串 hook 迁移（依赖 P3.3）  ← R6 顺序调换
                   ├─ P3.3 MetaHooks + ToolHooks SDK 扩展（先于 P3.2）  ← R6
                   ├─ P3.4 UI event-reducer 识别 session.next.*
                   ├─ P3.5 V2 config schema 落地  ← R7 重估
                   └─ P3.6 验证 Stuck 消费链路（事件已实现）  ← R1 修正
                       │
Phase 4（生产级加固）─┬─ P4.1 schema 稳定性
                      ├─ P4.2 错误兜底
                      ├─ P4.3 可观测性
                      └─ P4.4 测试覆盖
                       │
Phase 5（V1 退役）─┬─ P5.1 V1 SessionPrompt/agent/tool 删除
                   ├─ P5.2 孤岛清理
                   ├─ P5.3 event-v2-bridge 降级 + 双 SSE 统一  ← R9
                   └─ P5.4 文档同步
```

**v2 修订**：新增 P0.2（smoke test）、P2.8/P2.9/P2.10（无对等能力补建）、P2.11（meta 开关）；P3.1 拆 a/b；P3.2/P3.3 调换；P3.6 改验证；P5.3 补 SSE 统一。

---

## 4. 分阶段实施

### Phase 0 — 前置准备与基线锁定（1-1.5 天）

**目标**：建基线 + **验证 packages/server V2 端到端可跑通**（R3 关键阻塞解除）。

| 任务 | 文件 | 验收 | 协议约束 |
|---|---|---|---|
| P0.1 建分支 `meta-v2-closure` + 加 flag `AIGCFROGE_V2_RUNTIME`（默认 false） | [effect/app-runtime.ts](../../packages/aigcfroge/src/effect/app-runtime.ts) | flag 可读，V1/V2 可切 | effect: Effect.gen + Effect.fn |
| **P0.2 smoke test 验证 packages/server V2 端到端** | 新建 [packages/server/test/smoke-v2.test.ts](../../packages/server/test/) | 最小 prompt 走通 `SessionV2.prompt → SessionExecution.wake → SessionRunner.run`；**确认 SessionRunner.layer 解析路径**（[execution/local.ts:38](../../packages/core/src/session/execution/local.ts#L38) 仅 provide SessionStore，runner layer 来源待验证） | test: `testEffect()` + `it.live`；禁 `Effect.sleep`，用 `pollWithTimeout`/`SessionStatus.Service` |
| P0.3 V2 schema 基线快照 + 跑全量 V2 session 测试基线 | [specs/v2/schema-changelog.md](../../specs/v2/schema-changelog.md) | 13 个 session-* 测试全绿，记录基线 | test: 包内 `bun --cwd packages/core test` |

**P0.2 失败处置**：若 smoke test 证明 `packages/server` V2 路径跑不通（SessionRunner.Service 解析失败），则方案暂停，先在 core 修复 runner layer 提供链，再重启 Phase 1。**这是 R3 的硬门槛**。

---

### Phase 1 — V2 运行时接线闭合（3-4 天，R3 修订）

**目标**：让 `SessionRunner.run` 在 aigcfroge 运行时被调用，session.prompt 路由打到 V2。task/revert/summary 未补建前降级。

#### P1.1 aigcfroge 根 Layer provide V2 全栈（R3 修订）

**v1 错误**：声称"参考 handlers.ts:49-56 已验证的 provide 模式"——实际 [handlers.ts:40-60](../../packages/server/src/handlers.ts#L40) 未显式 provide SessionRunner.layer（grep 零命中），且 P0.2 smoke test 前不能假设它可跑。

**v2 修正**：基于 P0.2 smoke test 结论，在 [app-runtime.ts:55-106](../../packages/aigcfroge/src/effect/app-runtime.ts#L55) 按下表迁移 50 个 V1 Layer：

| Layer 分类 | 动作 | 数量 |
|---|---|---|
| ✅ 已对等 | 迁移消费者 import 到 V2（Skill/Discovery/Question/Permission/Todo/Command/ToolRegistry/Project/Ripgrep/BackgroundJob/Observability） | 11 |
| 🔄 范式差异 | 改调用方式（SessionCompaction→make / LLM→LLMClient / SessionPrompt→SessionRunner） | 3 |
| 🔀 桥接 | 共存期保留（EventV2Bridge） | 1 |
| ⚠️ 部分对等 | 逐方法核对迁移（Session/SessionStatus/MCP/Vcs→GitV2/Workspace/Instruction→SystemContext/LSP） | 8 |
| ❌ 无对等 | **暂保留 V1**（SessionRevert/SessionSummary 等到 P2.9/P2.10 补建后再删；其余确认丢弃的走 P5.1） | 14 |
| 新增 V2 | provide SessionExecutionLocal.defaultLayer + SessionRunner.layer + LocationServiceMap.layer | 3 |

**关键约束**：[ARCHITECTURE.md §6](../../ARCHITECTURE.md) Layer 在 app/server 边界 provide 一次，handler 内禁 `Effect.provide(SomeLayer)`。

**验收**：`AIGCFROGE_V2_RUNTIME=true` 启动后 `SessionV2.prompt → execution.wake → SessionRunner.run` 链路在事件流可见。

#### P1.2 httpapi 路由 namespace 解冲突

| 动作 | 文件 | 说明 |
|---|---|---|
| legacy 路由组去留 | [groups/session.ts:316,337](../../packages/aigcfroge/src/server/routes/instance/httpapi/groups/session.ts#L316) | `session.prompt`/`prompt_async` 被 V1 抢注 |
| feature flag 控制挂载 | [httpapi/server.ts:97,236](../../packages/aigcfroge/src/server/routes/instance/httpapi/server.ts#L97) | flag 开挂 V2 handlers，关挂 legacy |
| V2 handler 接管 | [packages/server/src/handlers/session.ts:128](../../packages/server/src/handlers/session.ts#L128) | 标识符冲突解除后生效 |
| **保留 revert/diff 端点** | [handlers/session.ts](../../packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts) | **V2 切换后仍指向 V1 SessionRevert/Summary，直到 P2.9/P2.10 完成** |

**验收**：CLI `sdk.session.promptAsync` 命中 V2 handler；revert/diff 端点暂走 V1（降级）。

#### P1.3 入口灰度切换

| 入口 | 文件 | 切换方式 |
|---|---|---|
| CLI run | [stream.transport.ts:1322](../../packages/aigcfroge/src/cli/cmd/run/stream.transport.ts#L1322) | 走 SDK HTTP，server 切 V2 后自动受益 |
| ACP | [acp/service.ts:507](../../packages/aigcfroge/src/acp/service.ts#L507) | 同上 |
| github 命令 | [github.handler.ts:382,895,943](../../packages/aigcfroge/src/cli/cmd/github.handler.ts#L382) | 改 V2 或 shim |
| workspace control-plane | [control-plane/workspace.ts:174,906,979](../../packages/aigcfroge/src/control-plane/workspace.ts#L174) | 同上 |

**验收**：flag 开启时所有入口走 V2；关闭回退 V1。

**Phase 1 风险**：
- task 工具降级期间 meta 委派失败 → 临时 meta.txt 提示，或保留 V1 task 作 shim 到 P2.2 完成
- revert/diff 端点暂走 V1 → V1/V2 共存期数据一致性需观察

---

### Phase 2 — meta-agent + V1 无对等能力补齐（5-6 天，R2/R4/R5 修订）

**目标**：meta 在 V2 恢复完整委派能力 + 补建 V1 无对等且断端点的 SessionRevert/SessionSummary。

#### P2.1 V2 `deriveSubagent` 权限收敛（0.5 天）

| 动作 | 文件 | 协议约束 |
|---|---|---|
| 新建 V2 `deriveSubagent` | [packages/core/src/permission/subagent-permissions.ts](../../packages/core/src/permission/) 新建 | 模块: `export * as Foo` 自导出，禁 namespace |
| 对等 V1 逻辑 | 参考 [aigcfroge/src/agent/subagent-permissions.ts:14-32](../../packages/aigcfroge/src/agent/subagent-permissions.ts#L14) | |
| **修复 C5**：加 `parentAgentName` 参数 | meta 子 agent 跳过 task/todowrite deny | |

**验收**：单测覆盖"父 deny 继承 / meta 子 agent 可再委派 / 非 meta 子 agent 仍 deny task"。test: `testEffect()` + `Layer.mock`。

#### P2.2 V2 task 工具重写（1.5 天，R4 修订）

| 动作 | 文件 | 协议约束 |
|---|---|---|
| 新建 V2 task 工具 | [packages/core/src/tool/task.ts](../../packages/core/src/tool/) | 模块自导出 |
| subagent 模式 | 基于 SessionStore + SessionExecution.wake + deriveSubagent | effect: `Effect.gen` + `Effect.forkIn(scope)`（禁 fork） |
| external-cli 模式 | **接口在 core，实现在 aigcfroge**（R4） | 架构边界: core 不依赖具体 CLI |
| background 模式 | V2 BackgroundJob | 参考 [specs/v2/todo.md:50-52](../../specs/v2/todo.md#L50) |
| 注册到 ToolRegistry | [builtins.ts:27](../../packages/core/src/tool/builtins.ts#L27) | 移除 TODO |

**R4 CLI 适配器归属决策**：
- `CliAdapter` 接口（[adapters/interface.ts](../../packages/aigcfroge/src/agent/meta/adapters/interface.ts)）迁入 [packages/core/src/agent/meta/adapters/interface.ts](../../packages/core/src/) 作为抽象
- 具体适配器（claude-code/codex/gemini）+ AdapterRegistry **保留 aigcfroge 层**（[aigcfroge/src/agent/meta/adapters/](../../packages/aigcfroge/src/agent/meta/adapters/)），因 core 是领域层不应依赖具体 CLI
- V2 task 工具通过 `Effect.serviceOption(AdapterRegistry)` 获取适配器（可选依赖）

**验收**：meta 可调 task 委派 4 子 agent + 3 CLI；录制测试覆盖（禁默认 live）。test: `recordedTests({prefix, requires})` 遵循 [packages/llm/AGENTS.md](../../packages/llm/AGENTS.md)。

#### P2.3 prerouter 迁入 core + 接入 runner（1 天）

| 动作 | 文件 | 协议约束 |
|---|---|---|
| 迁移 intent/mention/engine-selector/prerouter | [aigcfroge/src/agent/meta/](../../packages/aigcfroge/src/agent/meta/) → [packages/core/src/agent/meta/](../../packages/core/src/agent/) | 模块自导出；多兄弟禁 barrel |
| 在 runner 接入 | [runner/llm.ts:184](../../packages/core/src/session/runner/llm.ts#L184) `agents.select` 前 | effect: `Effect.fn("PreRouter.preRoute")` |
| 接线 INTENT_TOOL_FILTERS | [registry.ts:15-40](../../packages/core/src/tool/registry.ts#L15) + [model.ts:213](../../packages/core/src/session/runner/model.ts#L213) | runner 传 intent |
| 删除 V1 prerouter | 迁移后删 [aigcfroge/src/agent/meta/](../../packages/aigcfroge/src/agent/meta/) | 删除即资产 |

**验收**：preRoute 高置信快路径在 V2 生效；intent 传到 materialize 后工具集裁剪。

#### P2.4 占位符填充器（0.5 天）

| 动作 | 文件 |
|---|---|
| 新建填充器 | [packages/core/src/agent/meta/](../../packages/core/src/agent/) |
| `{{SUBAGENTS_LIST}}` | 从 `AgentV2.all()` 过滤 `mode !== "primary"` + 权限可见，复用 [describeTask](../../packages/aigcfroge/src/tool/registry.ts#L261) 逻辑 |
| `{{CLI_LIST}}` | 从 AdapterRegistry（aigcfroge 层注入）取已注册 CLI |
| 接入点 | [plugin/agent.ts:174,177](../../packages/core/src/plugin/agent.ts#L174) PROMPT_META 渲染时 |

**验收**：meta 启动时 LLM 看到实际子 agent + CLI 清单（非字面量）。更新 [meta-agent.test.ts:18-19](../../packages/aigcfroge/test/agent/meta/meta-agent.test.ts#L18) 断言被填充。

#### P2.5 MetaAgent 服务层（1 天）

| 动作 | 文件 | 对标 |
|---|---|---|
| 新建 service.ts + index.ts | [packages/core/src/meta-agent/](../../packages/core/src/meta-agent/)（当前仅 sql.ts） | [global-stats-design.md §2.5](../architecture/global-stats-design.md) |
| 实现 create/get/attach/detach/sessions/stats | 同上 | effect: `Effect.fn("MetaAgent.method")` |
| 复用已有 schema | [schema/src/meta-agent.ts](../../packages/schema/src/meta-agent.ts) + [meta-agent-id.ts](../../packages/schema/src/meta-agent-id.ts) | ✅ |

**验收**：`MetaAgent.Service.create(...)` 可创建记录，`sessions(metaID)` 返回关联会话。

#### P2.6 meta_agent_step 写入接线（0.5 天）

| 动作 | 文件 |
|---|---|
| workflow step 前后 INSERT/UPDATE | [packages/core/src/agent/meta/workflow/](../../packages/core/src/agent/) + [runner/llm.ts](../../packages/core/src/session/runner/llm.ts) turn 边界 |
| 表已就绪 | [core/src/meta-agent/sql.ts:46](../../packages/core/src/meta-agent/sql.ts#L46) ✅ |

**验收**：meta 委派执行后 `meta_agent_step` 有记录。

#### P2.7 PROMPT_META 单源化 + CLI 适配器归属（0.5 天，R4 修订）

| 动作 | 文件 |
|---|---|
| core 内联抽到 [packages/core/src/agent/prompt/meta.txt](../../packages/core/src/agent/) 单源 | V2 plugin import |
| 删除 [aigcfroge/src/agent/prompt/meta.txt](../../packages/aigcfroge/src/agent/prompt/meta.txt) + [aigcfroge/src/agent/meta-agent.ts](../../packages/aigcfroge/src/agent/meta-agent.ts) | 双源漂移消除 |
| CLI 适配器归属 | 见 P2.2 R4 决策 |

**验收**：grep `PROMPT_META` 单一来源。

#### P2.8 SessionProcessor 消费者迁移（0.5 天，R2 新增）

| 动作 | 文件 | 说明 |
|---|---|---|
| prompt.ts 不再持有 SessionProcessor | [session/prompt.ts:125](../../packages/aigcfroge/src/session/prompt.ts#L125) | V2 runner 内联了对等 |
| compaction.ts 改调 V2 make | [session/compaction.ts:173](../../packages/aigcfroge/src/session/compaction.ts#L173) | 范式迁移 |
| tools.ts 改 runner toolMaterialization | [session/tools.ts:41](../../packages/aigcfroge/src/session/tools.ts#L41) | |
| httpapi server.ts 移除 SessionProcessor.node | [httpapi/server.ts:34,232](../../packages/aigcfroge/src/server/routes/instance/httpapi/server.ts#L34) | runner 接管 |

**验收**：grep `SessionProcessor` 在 aigcfroge src 无残留（仅 V1 兼容层）。

#### P2.9 V2 SessionRevert 服务补建（1 天，R2 新增——断端点）

| 动作 | 文件 | 协议约束 |
|---|---|---|
| 新建 V2 SessionRevert Service | [packages/core/src/session/revert.ts](../../packages/core/src/session/) | effect: `Effect.fn` + `Effect.forkIn`；模块自导出 |
| 实现 revert/unrevert/cleanup | 参考 V1 [revert.ts:19-137](../../packages/aigcfroge/src/session/revert.ts#L19) | 基于 Snapshot patch 回滚 |
| SessionStore 加 setRevert/clearRevert | [store.ts:25](../../packages/core/src/session/store.ts#L25) | |
| httpapi revert/unrevert 端点切 V2 | [handlers/session.ts](../../packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts) + [groups/session.ts](../../packages/aigcfroge/src/server/routes/instance/httpapi/groups/session.ts) | |
| /revert CLI 命令切 V2 | grep `revert` in [cli/cmd/](../../packages/aigcfroge/src/cli/cmd/) | |

**验收**：revert/unrevert HTTP 端点 + /revert 命令走 V2；端到端测试覆盖回滚流程。test: `testEffect()` + `it.live`（Snapshot patch 真实 fs）。

#### P2.10 V2 SessionSummary/diff 服务补建（1 天，R2 新增——断端点）

| 动作 | 文件 | 说明 |
|---|---|---|
| 新建 V2 SessionSummary Service | [packages/core/src/session/summary.ts](../../packages/core/src/session/) | **diff 统计**（非 LLM 摘要，与 compaction 的 LLM 摘要是不同职责） |
| 实现 summarize/diff/computeDiff | 参考 V1 [summary.ts:66-146](../../packages/aigcfroge/src/session/summary.ts#L66) | 基于 Snapshot diff 算 additions/deletions/files |
| SessionStore 加 setSummary | [store.ts:25](../../packages/core/src/session/store.ts#L25) | |
| httpapi diff 端点切 V2 | [handlers/session.ts](../../packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts) | |

**验收**：diff HTTP 端点走 V2；用户查看每条消息文件变更统计正常。

#### P2.11 V2 禁用 meta 回退开关（0.5 天，R5 新增）

| 动作 | 文件 | 说明 |
|---|---|---|
| V2 selectedDefault 加 flag 检查 | [core/src/agent.ts:68-81](../../packages/core/src/agent.ts#L68) | 对等 V1 [agent.ts:341,348](../../packages/aigcfroge/src/agent/agent.ts#L341) |
| 复用 `AIGCFROGE_DISABLE_META_AGENT` 环境变量 | 同上 | flag 开时回退 build |

**验收**：`AIGCFROGE_DISABLE_META_AGENT=true` 时 V2 selectedDefault 返回 build 而非 meta。

**Phase 2 风险**：
- SessionRevert/SessionSummary 补建需 Snapshot diff 能力——V2 是否有对应 Snapshot Service 需核实（调研发现 V1 [Snapshot.Service](../../packages/aigcfroge/src/snapshot/) 在 V2 core 未发现对等）
- task 工具 V2 重写依赖 P2.1，串行
- C5 修复后子 agent 可再委派，需防止无限委派深度

---

### Phase 3 — 下游能力 V2 对等（5-6 天，R6/R7/R8 修订）

#### P3.1a MCP V2 basic（1.5 天，R7 拆分）

| 动作 | 文件 | 协议约束 |
|---|---|---|
| 新建 MCPV2 Service（无 OAuth） | [packages/core/src/mcp/](../../packages/core/src/) 新建 | 模块自导出 |
| clients/tools/resources/readResource | 对等 [aigcfroge/src/mcp/index.ts:192-977](../../packages/aigcfroge/src/mcp/index.ts#L192) | effect: `Effect.fn("MCP.method")` |
| 工具注入 runner | [tool/registry.ts:132-137](../../packages/core/src/tool/registry.ts#L132) materialize 合并 MCP 工具源 | |
| stdio/remote transport | 复用 CrossSpawnSpawner | |

**决策**：MCP V2 独立 domain（不并入 integration），因协议复杂度足够。

#### P3.1b MCP V2 OAuth（1.5 天，R7 拆分）

| 动作 | 文件 |
|---|---|
| McpAuth V2 + OAuth flow | 对等 [mcp/auth.ts](../../packages/aigcfroge/src/mcp/) + [oauth-provider.ts](../../packages/aigcfroge/src/mcp/) |
| OAuth callback | [oauth-callback.ts](../../packages/aigcfroge/src/mcp/) |

**验收**：OAuth flow 端到端走通；录制测试覆盖。

#### P3.3 MetaHooks + ToolHooks SDK 扩展（1 天，R6 先于 P3.2）

| 动作 | 文件 |
|---|---|
| 新建 meta.ts | [packages/plugin/src/v2/effect/meta.ts](../../packages/plugin/src/v2/effect/)（不存在） |
| 暴露 intent.register/adapter.register/workflow.register/middleware.register/policy.register | 对标 [prd:345-396](../prd/meta-agent-orchestrator.md#L345) |
| 新建 tool.ts（ToolHooks） | 同目录 |
| PluginContext 加 meta + tool domain | [plugin/src/v2/effect/context.ts](../../packages/plugin/src/v2/effect/context.ts) |
| host.ts 加 meta + tool 域 | [core/src/plugin/host.ts:17-215](../../packages/core/src/plugin/host.ts#L17) |

**验收**：plugin 可注册自定义 tool + meta 扩展。

#### P3.2 V1 字符串 hook 迁移到 V2（1.5 天，R6 依赖 P3.3 先完成）

V1 通用字符串 trigger 需对等迁移到 V2 域 transform 或 aisdk hook：

| V1 hook | 触发点 | V2 对等 |
|---|---|---|
| `tool.execute.before`/`after` | [session/tools.ts:100-411](../../packages/aigcfroge/src/session/tools.ts#L100)（10 处） | V2 tool settlement 包裹层 |
| `tool.definition` | [tool/registry.ts:298](../../packages/aigcfroge/src/tool/registry.ts#L298) | ToolHooks（P3.3） |
| `experimental.chat.system.transform` | [agent/agent.ts:410](../../packages/aigcfroge/src/agent/agent.ts#L410) | SystemContext producer |
| `experimental.chat.messages.transform` | [compaction.ts:360](../../packages/aigcfroge/src/session/compaction.ts#L360) | V2 compaction hook |
| `experimental.provider.small_model` | [provider/provider.ts:1858](../../packages/aigcfroge/src/provider/provider.ts#L1858) | SessionRunnerModel.resolve |
| `shell.env` | [pty.ts:71](../../packages/aigcfroge/src/server/routes/instance/httpapi/handlers/pty.ts#L71) | Shell env producer |
| `event`/`config` | [plugin/index.ts:242,254](../../packages/aigcfroge/src/plugin/index.ts#L242) | EventV2.subscribe / Config 域 |

**验收**：V1 plugin 迁移 V2 后行为对等；逐 hook 迁移测试。

#### P3.4 UI event-reducer 识别 session.next.*（1 天）

| 动作 | 文件 |
|---|---|
| 加 session.next.* case | [app/src/context/global-sync/event-reducer.ts:228,255,279](../../packages/app/src/context/global-sync/event-reducer.ts#L228) |
| V2 类型已生成 | [sdk/js/src/v2/gen/types.gen.ts:823+](../../packages/sdk/js/src/v2/gen/types.gen.ts#L823) ✅ |
| session-ui v2 主线渲染 | [session-ui/src/v2/components/](../../packages/session-ui/src/v2/components/) 补 timeline/message 渲染 |

**验收**：V2 事件流到 app 后 UI 正确渲染。

#### P3.5 V2 config schema 落地（2-3 天，R7 重估）

| 动作 | 文件 | 说明 |
|---|---|---|
| 实现 V2 config schema | 对标 [specs/v2/config.md](../../specs/v2/config.md) 11 组 review 决策 | R7 从 1 天重估为 2-3 天 |
| 旧 config 自动转换 | [specs/v2/todo.md:89](../../specs/v2/todo.md#L89) | |
| `agents`/`permissions`/`providers`/`mcp.servers` 新 schema | 落地 | |
| RuntimeFlags 迁移 | V1 RuntimeFlags → V2 Config | 处理 §1.5 无对等项 |
| 全仓 config 消费点迁移 | grep `cfg.` 全仓 | |

**建议拆 slice**：config-schema（1 天）+ config-migration（1-2 天）。

#### P3.6 验证 Stuck 消费链路（0.5 天，R1 修正）

**v1 错误**：声称"Stuck 事件定义缺失，需新建"。
**v2 修正**：Stuck 已定义（[event.ts:440](../../packages/core/src/session/event.ts#L440)）且已 publish（[compaction.ts:278](../../packages/core/src/session/compaction.ts#L278)）。本任务仅为**验证消费链路**：

| 动作 | 文件 |
|---|---|
| 验证 Stuck 事件到 UI 的消费 | [app event-reducer](../../packages/app/src/context/global-sync/event-reducer.ts) + TUI |
| 补消费 case（若缺） | 同上 |
| 验证 cache-miss Phase 2 CacheDiagnostic 消费 | [cache-shape.ts](../../packages/core/src/cache/cache-shape.ts) 已发布 → TUI/CLI |

**验收**：Stuck 事件可观测；CacheDiagnostic 可展示。

#### P3.7 MetaAgentSource 接入 Status Bar（0.5 天，R8 修订）

**R8 修订**：Mode Switcher viewport 死循环 bug **拆出独立 plan**（[mode-switcher-viewport-fix.md](mode-switcher-viewport-fix.md) 另建），与 V2 runtime 闭环无直接依赖。本方案仅保留与 V2 闭环相关的 MetaAgentSource：

| 动作 | 文件 | 对标 |
|---|---|---|
| MetaAgentSource 接入 Status Bar | [app/src/components/status-bar/](../../packages/app/src/components/status-bar/) | [global-stats-design.md:73](../architecture/global-stats-design.md#L73) |

**验收**：Status Bar 可切 MetaAgent 数据源。

---

### Phase 4 — 生产级加固（2-3 天）

#### P4.1 schema 稳定性（1 天）

| 动作 | 文件 |
|---|---|
| 废弃 disposable 声明 | [specs/v2/schema-changelog.md:674](../../specs/v2/schema-changelog.md#L674) 改为兼容承诺 |
| 定义 schema 版本化策略 | 新建 ADR |
| 加 schema 迁移测试 | [packages/core/test/](../../packages/core/test/) |

**验收**：V2 schema 跨版本兼容；破坏性变更走 ADR。database: 迁移用 TS + 禁 down（[skills/database](../../.aigcfroge/skills/database/SKILL.md)）。

#### P4.2 错误兜底（Catch Everything 复查）

按 [CLAUDE.md](../../CLAUDE.md) 边界与运行安全门禁，逐 V2 边界复查：
- SessionExecution.wake/interrupt（[execution/local.ts](../../packages/core/src/session/execution/local.ts)）
- SessionRunner.run turn 边界（[runner/llm.ts:174-364](../../packages/core/src/session/runner/llm.ts#L174)）
- tool settlement（[registry.ts:76-108](../../packages/core/src/tool/registry.ts#L76)）
- MCP 客户端（P3.1 新建）
- external-cli 执行（[adapters/timeout.ts](../../packages/aigcfroge/src/agent/meta/adapters/timeout.ts)）
- SessionRevert/SessionSummary（P2.9/P2.10 新建）

**验收**：每条 Effect 边界有兜底；无未处理 Promise；无静默失败。

#### P4.3 可观测性

| 动作 | 文件 |
|---|---|
| CacheDiagnostic 事件消费 | [cache-shape.ts](../../packages/core/src/cache/cache-shape.ts) 已发布 → TUI/CLI 消费 |
| Stuck 事件告警 | P3.6 验证后接入 |
| meta_agent_step 可观测 | P2.6 写入后加查询 API |

#### P4.4 测试覆盖（盲区补齐）

| 盲区 | 测试 | 优先级 | 协议约束 |
|---|---|---|---|
| MetaAgent 服务层 | 新建 [packages/core/test/meta-agent.test.ts](../../packages/core/test/) | P0 | `testEffect()` + `Layer.mock` |
| meta_agent_step 写入 | 同上 | P0 | 禁 `Effect.sleep` |
| Plugin MetaHooks | [packages/plugin/test/](../../packages/plugin/test/) | P1 | |
| subagent-permissions parentAgentName | [packages/core/test/](../../packages/core/test/) | P0 | |
| PreRouter V2 runner 集成 | [session-runner.test.ts](../../packages/core/test/) 扩展 | P1 | |
| **SessionRevert V2** | 新建 | P0 | `it.live`（真实 fs Snapshot） |
| **SessionSummary V2** | 新建 | P0 | |
| V1↔V2 桥接正确性 | [packages/aigcfroge/test/](../../packages/aigcfroge/test/) | P1 | |
| CLI 集成（claude-code/gemini/codex） | 录制测试，禁默认 live | P2 | `recordedTests({prefix, requires})` |
| **packages/server V2 端到端** | P0.2 smoke test 扩展 | P0 | |

---

### Phase 5 — V1 退役与清理（2-3 天，R9 修订）

#### P5.1 V1 SessionPrompt/agent/tool 删除

| 删除目标 | 文件 | 前置条件 |
|---|---|---|
| V1 prompt.ts | [aigcfroge/src/session/prompt.ts](../../packages/aigcfroge/src/session/prompt.ts)（1455+ 行） | Phase 1-4 全绿 + 灰度 1 周 |
| V1 agent.ts | [aigcfroge/src/agent/agent.ts](../../packages/aigcfroge/src/agent/agent.ts)（490 行） | |
| V1 tool registry | [aigcfroge/src/tool/registry.ts](../../packages/aigcfroge/src/tool/registry.ts) | |
| V1 task.ts | [aigcfroge/src/tool/task.ts](../../packages/aigcfroge/src/tool/task.ts) | P2.2 完成 |
| V1 mcp/ | [aigcfroge/src/mcp/](../../packages/aigcfroge/src/mcp/) | P3.1 完成 |
| V1 plugin/ | [aigcfroge/src/plugin/](../../packages/aigcfroge/src/plugin/) | P3.2/P3.3 完成 |
| V1 SessionProcessor/Revert/Summary | [session/processor.ts](../../packages/aigcfroge/src/session/processor.ts) + [revert.ts](../../packages/aigcfroge/src/session/revert.ts) + [summary.ts](../../packages/aigcfroge/src/session/summary.ts) | P2.8/P2.9/P2.10 完成 |
| V1 SessionPrompt.defaultLayer | [effect/app-runtime.ts:85](../../packages/aigcfroge/src/effect/app-runtime.ts#L85) | |

#### P5.2 孤岛清理

| 删除目标 | 文件 |
|---|---|
| cache-warmth V1 副本 | [aigcfroge/src/agent/meta/cache-warmth.ts](../../packages/aigcfroge/src/agent/meta/cache-warmth.ts)（P2.3 迁移后） |
| workflow V1 副本 | [aigcfroge/src/agent/meta/workflow/](../../packages/aigcfroge/src/agent/meta/workflow/) |
| INTENT_TOOL_FILTERS 死代码（若 P2.3 不接线则删） | [tool/registry.ts:15-40](../../packages/core/src/tool/registry.ts#L15) |
| aigcfroge Session 服务（noopLayer 依赖） | [session/session.ts:923-930](../../packages/aigcfroge/src/session/session.ts#L923) |
| 14 个无对等且确认丢弃的 Layer | §1.5 清单逐项决策 |

#### P5.3 event-v2-bridge 降级 + 双 SSE 统一（R9 修订）

**R9 双 SSE 统一方向决策**：统一到 **aigcfroge handler 直接订阅 EventV2 + directory 过滤**，移除 GlobalBus 中转。

| 动作 | 文件 | 说明 |
|---|---|---|
| aigcfroge SSE handler 改直接订阅 EventV2 | [httpapi/handlers/event.ts:34-65](../../packages/aigcfroge/src/server/routes/instance/httpapi/handlers/event.ts#L34) | 对齐 [packages/server/src/handlers/event.ts:25](../../packages/server/src/handlers/event.ts#L25) |
| directory 过滤移到 SSE handler 层 | 同上 | 不依赖 GlobalBus |
| event-v2-bridge 降级 | [bridge.ts](../../packages/aigcfroge/src/event-v2-bridge.ts) | 保留 location 注入，删 GlobalBus 转发 + publish 包装 |
| TUI/desktop SSE 消费验证 | [tui/src/context/data.tsx](../../packages/tui/src/context/data.tsx) + desktop | 统一后 TUI 仍消费 EventV2（已就绪） |

**验收**：单 SSE 路径；TUI/desktop 正常渲染。

#### P5.4 文档同步

| 文档 | 动作 |
|---|---|
| [ARCHITECTURE.md:244](../../ARCHITECTURE.md#L244) | MetaAgent/ModeSwitcher/StatusBar 改 Implemented + 指向本方案 |
| [v1-removal-and-v2-migration-plan.md](v1-removal-and-v2-migration-plan.md) | 重命名为 `ui-token-v1-v2-migration.md` |
| [specs/v2/todo.md](../../specs/v2/todo.md) | 重构为 done/in-progress/planned 表格 |
| [specs/v2/schema-changelog.md](../../specs/v2/schema-changelog.md) | P4.1 后更新兼容承诺 |
| 5 篇 meta-agent 计划 | 标注被本方案 supersede |
| **新建 mode-switcher-viewport-fix.md** | Mode Switcher viewport 死循环独立 plan（R8） |

---

## 5. 风险与回退策略（v2 修订）

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| **packages/server V2 路径跑不通**（SessionRunner.layer 解析失败） | 中 | Phase 1 阻塞 | **P0.2 smoke test 硬门槛**，失败则方案暂停先修 core |
| **SessionRevert/SessionSummary 补建需 Snapshot diff 能力**（V2 core 无对应 Snapshot Service） | 中 | P2.9/P2.10 阻塞 | 先调研 V2 Snapshot 对等性，若无需补建 Snapshot Service |
| V2 schema 不向前兼容 | 高 | 升级数据丢失 | P4.1 schema 稳定 + 版本化策略 |
| task 工具 V2 重写遗漏 V1 边界 | 中 | meta 委派回归 | 录制测试覆盖三模式 + background 边界 |
| MCP V2 工作量大 | 高 | Phase 3 延期 | R7 已拆 basic/oauth 两 slice |
| 50 个 V1 Layer 迁移遗漏消费者 | 中 | 运行时 Service 解析失败 | P1.1 按 §1.5 清单逐项迁移 + grep 验证 |
| V1 plugin 字符串 hook 迁移遗漏 | 中 | 插件回归 | 逐 hook 迁移测试 + 灰度 |
| UI event-reducer 改造影响渲染 | 中 | UI 回归 | 保留 V1 reducer 作 fallback 直到 session-ui v2 主线就绪 |
| C5 修复后子 agent 无限委派 | 低 | 资源耗尽 | 加委派深度限制 |

**回退策略**：
- 全程 `AIGCFROGE_V2_RUNTIME` feature flag 控制，任何 Phase 失败可回退 V1
- **V1 删除分两步**：先"V1 不再调用但保留代码"（Phase 5.1a），灰度 1 周后再"V1 代码物理删除"（Phase 5.1b）
- 数据库迁移全部 forward-only（不写 down），V1 schema 表共存到 Phase 5

---

## 6. 验收清单（生产级闭环定义）

### 6.1 功能闭环
- [ ] `AIGCFROGE_V2_RUNTIME=true` 全入口走 V2，无 V1 调用
- [ ] meta agent 可调 task 委派 4 子 agent + 3 CLI
- [ ] meta 子 agent 可再委派（C5 修复）
- [ ] prerouter 高置信快路径在 V2 生效
- [ ] meta prompt 占位符已填充
- [ ] MCP 工具在 V2 runner 可用（含 OAuth）
- [ ] **revert/unrevert/diff HTTP 端点走 V2**（P2.9/P2.10）
- [ ] **/revert CLI 命令走 V2**
- [ ] UI 正确渲染 `session.next.*` 事件
- [ ] `AIGCFROGE_DISABLE_META_AGENT=true` V2 下回退 build（P2.11）

### 6.2 生产级标准
- [ ] V2 schema 向前兼容承诺
- [ ] 所有 Effect 边界有兜底
- [ ] CacheDiagnostic + Stuck 可观测
- [ ] 测试覆盖盲区全补（P4.4 清单）
- [ ] ARCHITECTURE.md §7 文档同步

### 6.3 清理完成
- [ ] V1 SessionPrompt/agent/tool/mcp/plugin/processor/revert/summary 全删
- [ ] 孤岛代码全删
- [ ] event-v2-bridge 降级 + 双 SSE 统一
- [ ] 5 篇 meta-agent 计划标注 supersede

---

## 7. 附录：关键文件清单

### 7.1 V2 已就绪（直接接线）
| 文件 | 职责 |
|---|---|
| [packages/core/src/session.ts](../../packages/core/src/session.ts) | SessionV2.Service + admission |
| [packages/core/src/session/execution/local.ts](../../packages/core/src/session/execution/local.ts) | process-global coordinator |
| [packages/core/src/session/run-coordinator.ts](../../packages/core/src/session/run-coordinator.ts) | coalesce/join |
| [packages/core/src/session/runner/llm.ts](../../packages/core/src/session/runner/llm.ts) | V2 tool loop |
| [packages/core/src/agent.ts](../../packages/core/src/agent.ts) | AgentV2（meta 优先） |
| [packages/core/src/plugin/agent.ts](../../packages/core/src/plugin/agent.ts) | 8 agent 注册 |
| [packages/core/src/tool/registry.ts](../../packages/core/src/tool/registry.ts) | ToolRegistry Location-scoped |
| [packages/core/src/permission.ts](../../packages/core/src/permission.ts) | PermissionV2 |
| [packages/core/src/skill.ts](../../packages/core/src/skill.ts) | SkillV2 |
| [packages/core/src/session/event.ts](../../packages/core/src/session/event.ts) | SessionEvent 全类型（含 Stuck ✅） |
| [packages/server/src/handlers.ts](../../packages/server/src/handlers.ts) | V2 native server 全栈（待 P0.2 验证） |

### 7.2 V2 待新建
| 文件 | Phase |
|---|---|
| [packages/core/src/tool/task.ts](../../packages/core/src/tool/) | P2.2 |
| [packages/core/src/permission/subagent-permissions.ts](../../packages/core/src/permission/) | P2.1 |
| [packages/core/src/agent/meta/](../../packages/core/src/agent/)（prerouter 迁入） | P2.3 |
| [packages/core/src/meta-agent/service.ts](../../packages/core/src/meta-agent/) | P2.5 |
| [packages/core/src/session/revert.ts](../../packages/core/src/session/) | P2.9（R2 新增） |
| [packages/core/src/session/summary.ts](../../packages/core/src/session/) | P2.10（R2 新增） |
| [packages/core/src/mcp/](../../packages/core/src/) | P3.1 |
| [packages/plugin/src/v2/effect/meta.ts](../../packages/plugin/src/v2/effect/) | P3.3 |
| [packages/plugin/src/v2/effect/tool.ts](../../packages/plugin/src/v2/effect/) | P3.3 |

### 7.3 V1 待删除（Phase 5）
| 文件 | 行数 |
|---|---|
| [packages/aigcfroge/src/session/prompt.ts](../../packages/aigcfroge/src/session/prompt.ts) | 1455+ |
| [packages/aigcfroge/src/agent/agent.ts](../../packages/aigcfroge/src/agent/agent.ts) | 490 |
| [packages/aigcfroge/src/tool/registry.ts](../../packages/aigcfroge/src/tool/registry.ts) | — |
| [packages/aigcfroge/src/tool/task.ts](../../packages/aigcfroge/src/tool/task.ts) | 452 |
| [packages/aigcfroge/src/mcp/](../../packages/aigcfroge/src/mcp/) | 979+ |
| [packages/aigcfroge/src/plugin/](../../packages/aigcfroge/src/plugin/) | — |
| [packages/aigcfroge/src/session/processor.ts](../../packages/aigcfroge/src/session/processor.ts) | 1084（R2） |
| [packages/aigcfroge/src/session/revert.ts](../../packages/aigcfroge/src/session/revert.ts) | 137（R2） |
| [packages/aigcfroge/src/session/summary.ts](../../packages/aigcfroge/src/session/summary.ts) | 146（R2） |

---

## 8. 协议合规约束（R10 新增）

各 Phase 实施时必须遵循的协议约束，违反即违反 [CLAUDE.md](../../CLAUDE.md) 八荣八耻：

| 协议 | 约束 | 适用 Phase | 来源 |
|---|---|---|---|
| **Effect 编码** | `Effect.gen` + `Effect.fn("Domain.method")` + `Effect.forkIn(scope)`（禁 fork/forkDaemon）+ `Effect.void`；查 `.aigcfroge/references/effect-smol` 验证 API | P2.1/P2.2/P2.5/P2.9/P2.10/P3.1/P3.3 | [skills/effect](../../.aigcfroge/skills/effect/SKILL.md) + [AGENTS.md](../../AGENTS.md) Effect Coding |
| **Schema** | 多字段 `Schema.Class`，单值 `Schema.brand`，错误 `Schema.TaggedErrorClass`，defect `Schema.Defect` | 全 Phase 新建 schema | [AGENTS.md](../../AGENTS.md) Schema |
| **测试** | `testEffect()` + `Layer.mock`（禁手写 stub）；禁 `Effect.sleep` 等并发，用 `pollWithTimeout`/`Deferred`/`SessionStatus.Service`；`it.live` 用于真实 fs/git/process | P4.4 全部测试 | [packages/aigcfroge/test/AGENTS.md](../../packages/aigcfroge/test/AGENTS.md) |
| **录制测试** | external-cli/MCP 测试用 `recordedTests({prefix, requires})` + cassette，禁默认 live | P2.2 task、P3.1 MCP | [packages/llm/AGENTS.md](../../packages/llm/AGENTS.md) Recording Tests |
| **模块组织** | `export * as Foo from "./foo"` 自导出；禁 `export namespace`；禁 `import { foo as bar }`；禁 `import * as`（除 effect 子模块）；packages/aigcfroge 多兄弟目录禁 barrel index.ts | 全 Phase 新建文件 | [AGENTS.md](../../AGENTS.md) Imports + [packages/aigcfroge/AGENTS.md](../../packages/aigcfroge/AGENTS.md) |
| **数据库迁移** | 迁移用 TS（`up(tx)`），禁 `down`；`migration.gen.ts` 注册；snake_case 字段；走 `EffectDrizzleSqlite` | P2.5/P2.6 若扩展表 | [skills/database](../../.aigcfroge/skills/database/SKILL.md) |
| **架构边界** | Layer 在 app/server 边界 provide 一次，handler 内禁 `Effect.provide(SomeLayer)`；core 不依赖 aigcfroge；请求派生上下文走 `Effect.provideService(...)` 中间件 | P1.1 接线、P2.2 适配器归属 | [ARCHITECTURE.md §6](../../ARCHITECTURE.md) |
| **安全门禁** | Catch Everything（Effect 边界兜底）+ No Null Pointer（外部输入判空）+ Security First（路径/命令/URL 校验） | 全 Phase | [CLAUDE.md](../../CLAUDE.md) 边界与运行安全 |
| **整洁门禁** | No Cheating（禁无理由 `as any`/`@ts-ignore`，类型负测试用 `@ts-expect-error`）+ Reusability（新增前查 owner module）+ Clean Logs（禁输出 key/token/prompt） | 全 Phase | [CLAUDE.md](../../CLAUDE.md) 工程规约 |
| **改完即审** | 每次改动后跑 `git diff` + `bun run lint` + 受影响包 typecheck + 受影响包 test | 全 Phase | [CLAUDE.md](../../CLAUDE.md) 改完即审流程 |

---

## 9. 执行顺序总览（v2 修订）

```
Day 1-1.5:  Phase 0（基线 + P0.2 smoke test 硬门槛）
Day 2-5:    Phase 1（接线闭合，50 Layer 迁移，task/revert/summary 降级）
Day 6-11:   Phase 2（meta 能力 + P2.8/P2.9/P2.10/P2.11 补建）
Day 12-17:  Phase 3（下游对等，P3.1a/b + P3.2/P3.3 + P3.4-P3.7）
Day 18-20:  Phase 4（生产级加固）
Day 21-23:  Phase 5（V1 退役 + SSE 统一 + 文档同步）
Day 24+:    灰度运行 1 周 → 移除 feature flag → V1 物理删除
```

**v1 vs v2 工期对比**：
- v1：18 天（低估）
- v2：~23 天开发 + 1 周灰度（含 P2.8/P2.9/P2.10 补建 + P0.2 smoke test + 50 Layer 迁移工作量）

**关键里程碑**：
- Phase 0 完成：V2 端到端可跑通验证（R3 硬门槛）
- Phase 1 完成：V2 runner 真正运行（task/revert/summary 降级）
- Phase 2 完成：meta 恢复完整委派 + revert/summary/diff 端点恢复
- Phase 3 完成：全栈能力对等（含 MCP OAuth + MetaHooks）
- Phase 4 完成：生产级标准达成
- Phase 5 完成：V1 彻底退役 + 单 SSE 路径

---

## 10. 修订记录

| 版本 | 日期 | 修订项 | 依据 |
|---|---|---|---|
| v1 | 2026-07-05 | 初版 | 4 个调研 agent 报告 |
| v2 | 2026-07-05 | R1 删除 Stuck 定义/publish 任务（已实现） | 审批抽查 [event.ts:440](../../packages/core/src/session/event.ts#L440) + [compaction.ts:278](../../packages/core/src/session/compaction.ts#L278) |
| v2 | 2026-07-05 | R2 新增 §1.5 V1 Layer 栈（50 个）对等清单 + P2.8/P2.9/P2.10 | V1 Layer 对等性深度调研 |
| v2 | 2026-07-05 | R3 P1.1 改写 + P0.2 smoke test | 审批 [handlers.ts](../../packages/server/src/handlers.ts) 未 provide SessionRunner.layer |
| v2 | 2026-07-05 | R4 P2.7 CLI 适配器归属（接口 core，实现 aigcfroge） | [ARCHITECTURE.md §3](../../ARCHITECTURE.md) 架构边界 |
| v2 | 2026-07-05 | R5 P2.11 V2 禁用 meta 回退开关 | V1 [agent.ts:341](../../packages/aigcfroge/src/agent/agent.ts#L341) 有开关 V2 无 |
| v2 | 2026-07-05 | R6 P3.2/P3.3 顺序调换 | SDK 扩展是 hook 迁移前置依赖 |
| v2 | 2026-07-05 | R7 P3.1 拆 MCP-basic/oauth + P3.5 重估 | V1 MCP 979 行 + OAuth 复杂度 |
| v2 | 2026-07-05 | R8 P3.7 拆出 Mode Switcher viewport | 与 V2 闭环无直接依赖 |
| v2 | 2026-07-05 | R9 P5.3 双 SSE 统一方向 | 审批遗漏 |
| v2 | 2026-07-05 | R10 §8 协议合规约束 | [CLAUDE.md](../../CLAUDE.md) 八荣八耻 |

---

> **下一步**：v2 方案评审通过后，从 Phase 0 启动。**P0.2 smoke test 是硬门槛**——若 packages/server V2 路径跑不通，方案暂停先修 core runner layer 提供链。建议 P0.2 用 Workflow 并行验证 SessionRunner.layer 解析路径 + handlers.ts 端到端 + execution/local.ts drain 链路三处可行性。
