# Meta-Agent V2 生产级闭环升级方案

> **状态**: Draft — 待评审
> **作者**: 高级全栈顾问
> **日期**: 2026-07-05
> **范围**: 弃 V1，全切 V2，接线闭合到生产级闭环
> **关联文档**: [meta-agent-orchestrator.md](meta-agent-orchestrator.md) · [cache-miss-diagnostics-and-agent-upgrade.md](cache-miss-diagnostics-and-agent-upgrade.md) · [subagent-protocol-cards.md](subagent-protocol-cards.md) · [../architecture/global-stats-design.md](../architecture/global-stats-design.md) · [../../specs/v2/todo.md](../../specs/v2/todo.md)

---

## 0. 文档定位与原则

本文档是 **V1→V2 全切换 + 接线闭合**的总执行方案。它不重复已有计划文档的细节，而是**聚合 + 排序 + 补 gap**：把分散在 5 份 meta-agent 计划、`specs/v2/todo.md`、`specs/effect/todo.md` 中的承诺与现状收敛成单一可执行路线。

**执行原则**（继承 [CLAUDE.md](../../CLAUDE.md) 八荣八耻 + 极致减法）：
1. **复用优先**：V2 已实现的能力（runner/agent/tool/permission/skill/todo/event）直接接线，不重写
2. **删除即资产**：孤岛代码（cache-warmth/workflow 双源、INTENT_TOOL_FILTERS 死代码、noopLayer）随迁移删除
3. **小步快跑**：每 Phase 独立可验收、可回退（feature flag）
4. **生产级标准**：schema 稳定 + 错误兜底 + 可观测性 + 测试覆盖四者齐备才算闭环

---

## 1. 现状基线（一句话）

**V2 实现已就绪且 `packages/server` 已完整接线，但 aigcfroge 运行时仍走 V1——阻塞不在 core，而在 aigcfroge 根 Layer 未 provide V2 全栈 + httpapi 路由标识符被 V1 抢注 + CLI/ACP 入口指向 legacy 路由三处。**

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
| `packages/server` V2 全栈 | [server/src/handlers.ts:22-56](../../packages/server/src/handlers.ts#L22) | ✅ |
| provider-defined tool (`providerExecuted`) | [runner/llm.ts:272](../../packages/core/src/session/runner/llm.ts#L272) | ✅ |

### 1.2 已实现未接线（孤岛）

| 子系统 | 位置 | 问题 |
|---|---|---|
| V2 runner 本身 | [runner/llm.ts](../../packages/core/src/session/runner/llm.ts) | aigcfroge 运行时不 provide 它 |
| `INTENT_TOOL_FILTERS` | [tool/registry.ts:15-40](../../packages/core/src/tool/registry.ts#L15) | runner 不传 intent，死代码 |
| intent 选模型桩 | [runner/model.ts:75,213](../../packages/core/src/session/runner/model.ts#L75) | 同上，dead |
| cache-warmth | [aigcfroge/src/agent/meta/cache-warmth.ts](../../packages/aigcfroge/src/agent/meta/cache-warmth.ts) | 无 src 调用方 |
| workflow engine | [aigcfroge/src/agent/meta/workflow/](../../packages/aigcfroge/src/agent/meta/workflow/) | 无 src 调用方 |
| `meta_agent_step` 表 | [core/src/meta-agent/sql.ts:46](../../packages/core/src/meta-agent/sql.ts#L46) | 无写入方 |
| TUI EventV2 消费 | [tui/src/context/data.tsx:132-345](../../packages/tui/src/context/data.tsx#L132) | 已就绪（V2 切换后无需改） |

### 1.3 缺失（必须新建）

| 缺口 | 严重度 | 依赖 |
|---|---|---|
| V2 task 工具 | P0 阻塞 meta 委派 | deriveSubagent |
| V2 `deriveSubagent` 权限收敛 | P0 | 无 |
| `{{SUBAGENTS_LIST}}`/`{{CLI_LIST}}` 填充器 | P0 | AgentV2.all()（已有） |
| MetaAgent 服务层（create/get/attach/stats） | P0 | 无 |
| prerouter 迁移到 core + 接入 runner | P0 | 无 |
| V2 MCP 领域模型 | P0 | 无 |
| MetaHooks 插件扩展点 | P1 | plugin SDK |
| V2 plugin 自定义工具（ToolHooks） | P1 | plugin SDK |
| UI event-reducer 识别 `session.next.*` | P1 | 无 |
| V2 config schema 落地 | P1 | 无 |
| `Compaction.Stuck` 事件定义 | P1 | 无 |
| Mode Switcher viewport（Chat/Work/Assistant） | P1 | ADR-09 |

### 1.4 文档漂移（必须同步）

| 文档 | 漂移 |
|---|---|
| [ARCHITECTURE.md:244](../../ARCHITECTURE.md#L244) | 标 MetaAgent/ModeSwitcher/StatusBar "Planned"，实际已实现 |
| [v1-removal-and-v2-migration-plan.md](v1-removal-and-v2-migration-plan.md) | 标题误导：是 UI Token 迁移，非 Agent Runtime 迁移 |
| [specs/v2/todo.md](../../specs/v2/todo.md) | 非结构化叙述，无 done/in-progress/planned 标记 |
| [specs/v2/schema-changelog.md:674](../../specs/v2/schema-changelog.md#L674) | 声明 V2 数据 "disposable"，未达生产级向前兼容 |

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
  ├─ PreRouter.preRoute（迁入 core，intent→engine 快路径）  ← Phase 2 接入
  ├─ AgentV2.select（meta 优先）
  ├─ SystemContext（SkillGuidance + ReferenceGuidance + 填充后的 meta prompt）
  ├─ SessionHistory.loadForRunner（baseline seq 截断）
  ├─ ToolRegistry.materialize（含 V2 task + MCP V2 + 内置 + plugin 工具）
  ├─ LLMClient.stream（@aigcfroge/llm 原生路径，处理 providerExecuted）
  ├─ tool settlement（durable record + authorize + execute）
  ├─ SessionTodo（todowrite 工具）
  └─ MetaAgent step 写入（meta_agent_step 表）  ← Phase 2 接入
  ↓
EventV2 publish（session.next.*）→ SQLite + PubSub
  ↓
event-v2-bridge（location 注入 + GlobalBus 转发）
  ↓
SSE/WS → app（event-reducer 识别 session.next.*）+ TUI（已就绪）+ desktop
```

**核心差异**（vs V1 现状）：
1. 入口从 `SessionPrompt.prompt`（V1）切到 `SessionV2.prompt`（V2）
2. tool loop 从 `session/prompt.ts:runLoop`（V1 AI SDK streamText）切到 `SessionRunner.run`（V2 原生 LLMClient.stream）
3. 工具集从 V1 registry 切到 V2 ToolRegistry（含 V2 task + MCP V2）
4. 事件流从 V1 `message.part.*` 切到 V2 `session.next.*`
5. meta-agent 编排从 V1 prerouter（aigcfroge 层）迁到 core，接入 runner

---

## 3. 阻塞点依赖图

```
Phase 1（接线）─┬─ P1.1 app-runtime provide V2 全栈
               ├─ P1.2 httpapi 路由 namespace 解冲突
               └─ P1.3 入口灰度切换（feature flag）
                       │
                       ▼（task 工具 V2 重写前，meta 委派降级）
Phase 2（meta 能力对等）─┬─ P2.1 deriveSubagent（V2 权限收敛）
                        ├─ P2.2 V2 task 工具重写 ← 依赖 P2.1
                        ├─ P2.3 prerouter 迁入 core + 接入 runner
                        ├─ P2.4 占位符填充器
                        ├─ P2.5 MetaAgent 服务层 ← 依赖 P2.2
                        ├─ P2.6 meta_agent_step 写入接线 ← 依赖 P2.5
                        └─ P2.7 PROMPT_META 单源化
                       │
Phase 3（下游对等）─┬─ P3.1 MCP V2 领域模型 + 工具注入
                   ├─ P3.2 V1 字符串 hook 迁移到 V2 域 transform
                   ├─ P3.3 MetaHooks + ToolHooks 插件 SDK 扩展
                   ├─ P3.4 UI event-reducer 识别 session.next.*
                   ├─ P3.5 V2 config schema 落地
                   ├─ P3.6 Compaction.Stuck 事件 + Phase 4/6 接线
                   └─ P3.7 Mode Switcher viewport 修复
                       │
Phase 4（生产级加固）─┬─ P4.1 schema 稳定性（废弃 disposable 声明）
                      ├─ P4.2 错误兜底（Catch Everything 复查）
                      ├─ P4.3 可观测性（CacheDiagnostic + Stuck 消费）
                      └─ P4.4 测试覆盖（盲区补齐）
                       │
Phase 5（V1 退役）─┬─ P5.1 V1 SessionPrompt/agent/tool 删除
                   ├─ P5.2 孤岛清理（cache-warmth/workflow/INTENT_TOOL_FILTERS）
                   ├─ P5.3 event-v2-bridge 降级
                   └─ P5.4 文档同步
```

---

## 4. 分阶段实施

### Phase 0 — 前置准备与基线锁定（0.5 天）

| 任务 | 文件 | 验收 |
|---|---|---|
| 0.1 建分支 `meta-v2-closure` | — | 分支创建 |
| 0.2 加 feature flag `AIGCFROGE_V2_RUNTIME`（默认 false） | [effect/app-runtime.ts](../../packages/aigcfroge/src/effect/app-runtime.ts) | flag 可读，V1/V2 可切换 |
| 0.3 锁定 V2 schema 基线快照 | [specs/v2/schema-changelog.md](../../specs/v2/schema-changelog.md) | 快照 commit，后续迁移基于此 |
| 0.4 跑全量 V2 session 测试基线 | `bun --cwd packages/core test` | 13 个 session-* 测试全绿，记录基线 |

---

### Phase 1 — V2 运行时接线闭合（2-3 天）

**目标**：让 `SessionRunner.run` 在 aigcfroge 运行时真正被调用，session.prompt 路由打到 V2。task 工具暂用降级模式（V1 task 不可用则 meta 委派先报"待 Phase 2"）。

#### P1.1 aigcfroge 根 Layer provide V2 全栈

参考 `packages/server/src/handlers.ts:49-56` 已验证的 provide 模式，在 aigcfroge 运行时根补齐：

| 动作 | 文件 | 当前 | 目标 |
|---|---|---|---|
| provide SessionExecutionLocal.defaultLayer | [effect/app-runtime.ts:85](../../packages/aigcfroge/src/effect/app-runtime.ts#L85) | 仅 V1 SessionPrompt.defaultLayer | 加 V2 execution local |
| provide SessionRunner.layer | 同上 | 缺 | 加（**验证 [handlers.ts:49-56](../../packages/server/src/handlers.ts#L49) 是否已隐式 provide runner**，见调研 B.3 潜在炸点） |
| provide LocationServiceMap.layer | 同上 | 缺 | 加 |
| 移除 SessionExecution.noopLayer | [session/session.ts:927](../../packages/aigcfroge/src/session/session.ts#L927) | 显式 noop | 删 noopLayer provide，让 wake 真正触发 |

**验收**：`AIGCFROGE_V2_RUNTIME=true` 启动后，`SessionV2.prompt` → `execution.wake` → `SessionRunner.run` 链路在日志/事件中可见。

#### P1.2 httpapi 路由 namespace 解冲突

| 动作 | 文件 | 说明 |
|---|---|---|
| 评估 legacy 路由组去留 | [server/routes/instance/httpapi/groups/session.ts:316,337](../../packages/aigcfroge/src/server/routes/instance/httpapi/groups/session.ts#L316) | `session.prompt`/`prompt_async` 被 V1 抢注 |
| 决策：移除 legacy 或换 namespace | 同上 + [httpapi/server.ts:97,236](../../packages/aigcfroge/src/server/routes/instance/httpapi/server.ts#L97) | 推荐：feature flag 控制挂载哪套 |
| V2 handler 接管 `session.prompt` | [packages/server/src/handlers/session.ts:128](../../packages/server/src/handlers/session.ts#L128) | 标识符冲突解除后 V2 handler 生效 |

**验收**：CLI `sdk.session.promptAsync` 命中 V2 handler（`SessionV2.Service.prompt`），而非 V1 `promptSvc.prompt`。

#### P1.3 入口灰度切换

| 入口 | 文件 | 切换方式 |
|---|---|---|
| CLI run | [cli/cmd/run/stream.transport.ts:1322](../../packages/aigcfroge/src/cli/cmd/run/stream.transport.ts#L1322) | 走 SDK HTTP，server 切 V2 后自动受益 |
| ACP | [acp/service.ts:507](../../packages/aigcfroge/src/acp/service.ts#L507) | 同上 |
| github 命令 | [cli/cmd/github.handler.ts:382,895,943](../../packages/aigcfroge/src/cli/cmd/github.handler.ts#L382) | 直接持有 V1 SessionPrompt.Service，需改为 V2 或 shim |
| workspace control-plane | [control-plane/workspace.ts:174,906,979](../../packages/aigcfroge/src/control-plane/workspace.ts#L174) | 同上 |

**验收**：flag 开启时所有入口走 V2；关闭时回退 V1。`AIGCFROGE_V2_RUNTIME` 全局可切。

**Phase 1 风险**：
- SessionRunner.layer 解析路径未验证（调研 B.3）→ 必须先写一个 smoke test 确认 `SessionRunner.Service` 在 aigcfroge runtime 下可解析
- task 工具降级期间 meta 委派失败 → 临时在 meta.txt 加"V2 切换中，task 工具暂不可用"提示，或保留 V1 task 作 shim 直到 Phase 2 完成

---

### Phase 2 — meta-agent 能力 V2 对等（3-4 天）

**目标**：meta 在 V2 下恢复完整委派能力，孤岛接线，占位符填充。

#### P2.1 V2 `deriveSubagent` 权限收敛（0.5 天）

| 动作 | 文件 |
|---|---|
| 新建 V2 `deriveSubagent` | [packages/core/src/permission/](../../packages/core/src/permission/) 或 [agent/](../../packages/core/src/agent/) 下新建 `subagent-permissions.ts` |
| 对等 V1 逻辑 | 参考 [aigcfroge/src/agent/subagent-permissions.ts:14-32](../../packages/aigcfroge/src/agent/subagent-permissions.ts#L14) |
| **修复 C5**：加 `parentAgentName` 参数 | meta 委派的子 agent 跳过 task/todowrite deny，允许再委派 |

**验收**：单测覆盖"父 deny 继承 / meta 子 agent 可再委派 / 非 meta 子 agent 仍 deny task"。

#### P2.2 V2 task 工具重写（1.5 天）

| 动作 | 文件 | 说明 |
|---|---|---|
| 新建 V2 task 工具 | [packages/core/src/tool/task.ts](../../packages/core/src/tool/task.ts) | 基于 SessionStore + SessionRunner + PermissionV2 |
| subagent 模式 | 同上 | `sessions.create({parentID, agent, permission: deriveSubagent(...)})` + `SessionExecution.wake` |
| external-cli 模式 | 复用 [aigcfroge/src/agent/meta/adapters/](../../packages/aigcfroge/src/agent/meta/adapters/) | 适配器迁到 core 或保留 aigcfroge 层（决策见 P2.7） |
| background 模式 | 新建 V2 BackgroundJob | 参考 [specs/v2/todo.md:50-52](../../specs/v2/todo.md#L50) deferred 项 |
| 注册到 ToolRegistry | [packages/core/src/tool/builtins.ts:27](../../packages/core/src/tool/builtins.ts#L27) | 移除 TODO，加入 task |

**验收**：meta 可调 task 工具委派 build/explore/general/plan 子 agent，结果回流；external-cli 委派 Claude Code/Gemini/Codex 可执行（用录制测试，禁默认 live）。

#### P2.3 prerouter 迁入 core + 接入 runner（1 天）

| 动作 | 文件 | 说明 |
|---|---|---|
| 迁移 intent/mention/engine-selector/prerouter | [aigcfroge/src/agent/meta/](../../packages/aigcfroge/src/agent/meta/) → [packages/core/src/agent/meta/](../../packages/core/src/agent/) | 纯函数，迁移低风险 |
| 在 runner 接入 | [runner/llm.ts:184](../../packages/core/src/session/runner/llm.ts#L184) `agents.select` 前 | `PreRouter.preRoute(text)` 高置信单目标时切 agent |
| 接线 INTENT_TOOL_FILTERS | [tool/registry.ts:15-40](../../packages/core/src/tool/registry.ts#L15) + [runner/model.ts:213](../../packages/core/src/session/runner/model.ts#L213) | runner 传 intent，激活工具裁剪 + 选便宜模型（cache-miss Phase 4/6） |
| 删除 V1 prerouter | 迁移后删 [aigcfroge/src/agent/meta/](../../packages/aigcfroge/src/agent/meta/) | 孤岛清理 |

**验收**：preRoute 高置信快路径在 V2 生效（省 LLM 调用）；intent 传到 materialize 后工具集按 intent 裁剪。

#### P2.4 占位符填充器（0.5 天）

| 动作 | 文件 |
|---|---|
| 新建填充器 | [packages/core/src/agent/meta/](../../packages/core/src/agent/) 下，渲染 system prompt 时填充 |
| `{{SUBAGENTS_LIST}}` | 从 `AgentV2.all()` 过滤 `mode !== "primary"` + 权限可见，复用 [aigcfroge/src/tool/registry.ts:261 describeTask](../../packages/aigcfroge/src/tool/registry.ts#L261) 逻辑 |
| `{{CLI_LIST}}` | 从 AdapterRegistry（迁入 core 后）取已注册 CLI |
| 接入点 | [plugin/agent.ts:174,177](../../packages/core/src/plugin/agent.ts#L174) PROMPT_META 渲染时 |

**验收**：meta agent 启动时 LLM 看到实际子 agent + CLI 清单（非字面量 `{{...}}`）。更新 [test/agent/meta/meta-agent.test.ts:18-19](../../packages/aigcfroge/test/agent/meta/meta-agent.test.ts#L18) 断言被填充。

#### P2.5 MetaAgent 服务层（1 天）

| 动作 | 文件 | 对标 |
|---|---|---|
| 新建 service.ts + index.ts | [packages/core/src/meta-agent/](../../packages/core/src/meta-agent/)（当前仅 sql.ts） | [global-stats-design.md §2.5](../architecture/global-stats-design.md) Interface |
| 实现 create/get/attach/detach/sessions/stats | 同上 | 落地 PRD §3.9 |
| 复用已有 schema | [packages/schema/src/meta-agent.ts](../../packages/schema/src/meta-agent.ts) + [meta-agent-id.ts](../../packages/schema/src/meta-agent-id.ts) | ✅ 已有 |

**验收**：`MetaAgent.Service.create(...)` 可创建 meta_agent 记录，`sessions(metaID)` 返回关联会话。

#### P2.6 meta_agent_step 写入接线（0.5 天）

| 动作 | 文件 |
|---|---|
| workflow step 前后 INSERT/UPDATE | [packages/core/src/agent/meta/workflow/](../../packages/core/src/agent/meta/)（迁移后）+ [runner/llm.ts](../../packages/core/src/session/runner/llm.ts) turn 边界 |
| 表已就绪 | [core/src/meta-agent/sql.ts:46](../../packages/core/src/meta-agent/sql.ts#L46) ✅ |

**验收**：meta 委派执行后 `meta_agent_step` 表有记录（seq/type/engine/status/result）。

#### P2.7 PROMPT_META 单源化（0.5 天）

**决策**：core 内联抽到 [packages/core/src/agent/prompt/meta.txt](../../packages/core/src/agent/) 单源，V2 plugin import；删除 [aigcfroge/src/agent/prompt/meta.txt](../../packages/aigcfroge/src/agent/prompt/meta.txt) + [aigcfroge/src/agent/meta-agent.ts](../../packages/aigcfroge/src/agent/meta-agent.ts)。

**验收**：grep `PROMPT_META` 单一来源；V1 双源漂移消除。

---

### Phase 3 — 下游能力 V2 对等（4-5 天，可并行）

#### P3.1 MCP V2 领域模型 + 工具注入（2 天）⚠️ 最大缺口

| 动作 | 文件 | 说明 |
|---|---|---|
| 新建 MCPV2 领域 | [packages/core/src/mcp/](../../packages/core/src/) 新建 | 当前 core 层完全无 MCP |
| Service：clients/tools/resources/readResource | 对等 [aigcfroge/src/mcp/index.ts:192-977](../../packages/aigcfroge/src/mcp/index.ts#L192) | 含 OAuth |
| 工具注入 runner | [tool/registry.ts:132-137](../../packages/core/src/tool/registry.ts#L132) materialize 合并 MCP 工具源 | 当前仅 ApplicationTools + Tools.register |
| MCP 资源工具 | 对等 list_mcp_resources/read_mcp_resource | 当前仅 V1 |
| Layer 依赖 | McpAuth / EventV2Bridge / Config / CrossSpawnSpawner | 复用 V1 实现 |

**决策点**：MCP V2 是独立 domain 还是并入 [integration](../../packages/core/src/plugin/models-dev.ts) domain（models-dev 已把 MCP-like 塞 integration）？建议独立，因 MCP 协议复杂度足够。

**验收**：V2 runner 可用 MCP 工具；OAuth flow 可走通（录制测试）。

#### P3.2 V1 字符串 hook 迁移到 V2（1.5 天）

V1 通用字符串 trigger（`plugin.trigger(name, ...)`）需对等迁移到 V2 域 transform 或 aisdk hook：

| V1 hook | 触发点 | V2 对等 |
|---|---|---|
| `tool.execute.before`/`after` | [session/tools.ts:100-411](../../packages/aigcfroge/src/session/tools.ts#L100)（10 处） | V2 tool settlement 包裹层 |
| `tool.definition` | [tool/registry.ts:298](../../packages/aigcfroge/src/tool/registry.ts#L298) | ToolHooks（见 P3.3） |
| `experimental.chat.system.transform` | [agent/agent.ts:410](../../packages/aigcfroge/src/agent/agent.ts#L410) | SystemContext producer |
| `experimental.chat.messages.transform` | [compaction.ts:360](../../packages/aigcfroge/src/session/compaction.ts#L360) | V2 compaction hook |
| `experimental.provider.small_model` | [provider/provider.ts:1858](../../packages/aigcfroge/src/provider/provider.ts#L1858) | SessionRunnerModel.resolve |
| `shell.env` | [pty.ts:71](../../packages/aigcfroge/src/server/routes/instance/httpapi/handlers/pty.ts#L71) | Shell env producer |
| `event`/`config` | [plugin/index.ts:242,254](../../packages/aigcfroge/src/plugin/index.ts#L242) | EventV2.subscribe / Config 域 |

**验收**：V1 plugin 迁移到 V2 后行为对等；逐 hook 写迁移测试。

#### P3.3 MetaHooks + ToolHooks 插件 SDK 扩展（1 天）

| 动作 | 文件 |
|---|---|
| 新建 meta.ts | [packages/plugin/src/v2/effect/meta.ts](../../packages/plugin/src/v2/effect/)（不存在） |
| 暴露 intent.register/adapter.register/workflow.register/middleware.register/policy.register | 对标 [prd/meta-agent-orchestrator.md:345-396](../prd/meta-agent-orchestrator.md#L345) |
| 新建 tool.ts（ToolHooks） | 同目录 |
| PluginContext 加 meta + tool domain | [plugin/src/v2/effect/context.ts](../../packages/plugin/src/v2/effect/context.ts) |
| host.ts 加 meta + tool 域 | [core/src/plugin/host.ts:17-215](../../packages/core/src/plugin/host.ts#L17) |

**验收**：plugin 可注册自定义 tool + meta 扩展；单测覆盖 hook 触发。

#### P3.4 UI event-reducer 识别 session.next.*（1 天）

| 动作 | 文件 |
|---|---|
| 加 session.next.* case | [app/src/context/global-sync/event-reducer.ts:228,255,279](../../packages/app/src/context/global-sync/event-reducer.ts#L228) |
| V2 类型已生成 | [sdk/js/src/v2/gen/types.gen.ts:823+](../../packages/sdk/js/src/v2/gen/types.gen.ts#L823) ✅ |
| session-ui v2 主线渲染 | [session-ui/src/v2/components/](../../packages/session-ui/src/v2/components/)（当前仅 3 辅助组件）补 timeline/message 渲染 |

**验收**：V2 事件流到 app 后 UI 正确渲染（text delta / tool call / step）。

#### P3.5 V2 config schema 落地（1 天）

| 动作 | 文件 |
|---|---|
| 实现 V2 config schema | 对标 [specs/v2/config.md](../../specs/v2/config.md) 11 组 review 决策 |
| 旧 config 自动转换 | [specs/v2/todo.md:89](../../specs/v2/todo.md#L89) |
| `agents`/`permissions`/`providers`/`mcp.servers` 新 schema | 落地 |

**验收**：旧 config 加载时自动转换；V2 config 类型检查通过。

#### P3.6 Compaction.Stuck 事件 + Phase 4/6 接线（0.5 天）

| 动作 | 文件 |
|---|---|
| 定义 Stuck 事件 | [core/src/session/event.ts](../../packages/core/src/session/event.ts)（handler 已在 [message-updater.ts:371](../../packages/core/src/session/message-updater.ts#L371)） |
| Phase 4 工具裁剪接线 | 见 P2.3 |
| Phase 6 多模型瀑布 | [runner/model.ts](../../packages/core/src/session/runner/model.ts) `findCheaperModel` |

**验收**：Stuck 事件可发布 + 消费；intent 选便宜模型生效。

#### P3.7 Mode Switcher viewport 修复（1 天）

| 动作 | 文件 | 对标 |
|---|---|---|
| 实现 Chat/Work/Assistant viewport | [packages/app/src/pages/](../../packages/app/src/pages/) | [mode-unified-architecture.md:13,18](mode-unified-architecture.md) 已知 bug |
| 修 setActiveSessionId 死循环 | 同上 | navigate('/') 死循环 |
| MetaAgentSource 接入 Status Bar | [app/src/components/status-bar/](../../packages/app/src/components/status-bar/) | [global-stats-design.md:73](../architecture/global-stats-design.md#L73) |

**验收**：4 个 mode 均有 viewport；Status Bar 可切 MetaAgent 数据源。

---

### Phase 4 — 生产级加固（2-3 天）

#### P4.1 schema 稳定性（1 天）

| 动作 | 文件 |
|---|---|
| 废弃 disposable 声明 | [specs/v2/schema-changelog.md:674](../../specs/v2/schema-changelog.md#L674) 改为兼容承诺 |
| 定义 schema 版本化策略 | 新建 ADR |
| 加 schema 迁移测试 | [packages/core/test/](../../packages/core/test/) |

**验收**：V2 schema 跨版本兼容；破坏性变更走 ADR。

#### P4.2 错误兜底（Catch Everything 复查）

按 [CLAUDE.md](../../CLAUDE.md) 边界与运行安全门禁，逐个 V2 边界复查：
- SessionExecution.wake/interrupt（[execution/local.ts](../../packages/core/src/session/execution/local.ts)）
- SessionRunner.run turn 边界（[runner/llm.ts:174-364](../../packages/core/src/session/runner/llm.ts#L174)）
- tool settlement（[registry.ts:76-108](../../packages/core/src/tool/registry.ts#L76)）
- MCP 客户端（P3.1 新建）
- external-cli 执行（[adapters/timeout.ts](../../packages/aigcfroge/src/agent/meta/adapters/timeout.ts)）

**验收**：每条 Effect 边界有兜底；无未处理 Promise；无静默失败。

#### P4.3 可观测性

| 动作 | 文件 |
|---|---|
| CacheDiagnostic 事件消费 | [cache-shape.ts](../../packages/core/src/cache/cache-shape.ts) 已发布 → TUI/CLI 消费（cache-miss Phase 2） |
| Stuck 事件告警 | P3.6 定义后接入 |
| meta_agent_step 可观测 | P2.6 写入后加查询 API |

#### P4.4 测试覆盖（盲区补齐）

| 盲区 | 测试 | 优先级 |
|---|---|---|
| MetaAgent 服务层 | 新建 [packages/core/test/meta-agent.test.ts](../../packages/core/test/) | P0 |
| meta_agent_step 写入 | 同上 | P0 |
| Plugin MetaHooks | [packages/plugin/test/](../../packages/plugin/test/) | P1 |
| subagent-permissions parentAgentName | [packages/core/test/](../../packages/core/test/) | P0 |
| PreRouter V2 runner 集成 | [packages/core/test/session-runner.test.ts](../../packages/core/test/) 扩展 | P1 |
| V1↔V2 桥接正确性 | [packages/aigcfroge/test/](../../packages/aigcfroge/test/) | P1 |
| CLI 集成（claude-code/gemini/codex） | 录制测试，禁默认 live | P2 |

---

### Phase 5 — V1 退役与清理（2 天）

#### P5.1 V1 SessionPrompt/agent/tool 删除

| 删除目标 | 文件 |
|---|---|
| V1 prompt.ts | [aigcfroge/src/session/prompt.ts](../../packages/aigcfroge/src/session/prompt.ts)（1455+ 行） |
| V1 agent.ts | [aigcfroge/src/agent/agent.ts](../../packages/aigcfroge/src/agent/agent.ts)（490 行） |
| V1 tool registry | [aigcfroge/src/tool/registry.ts](../../packages/aigcfroge/src/tool/registry.ts) |
| V1 task.ts | [aigcfroge/src/tool/task.ts](../../packages/aigcfroge/src/tool/task.ts)（被 P2.2 取代） |
| V1 mcp/ | [aigcfroge/src/mcp/](../../packages/aigcfroge/src/mcp/)（被 P3.1 取代） |
| V1 plugin/ | [aigcfroge/src/plugin/](../../packages/aigcfroge/src/plugin/)（被 P3.2/P3.3 取代） |
| V1 SessionPrompt.defaultLayer | [effect/app-runtime.ts:85](../../packages/aigcfroge/src/effect/app-runtime.ts#L85) |

**前置条件**：Phase 1-4 全部完成 + feature flag 移除。

#### P5.2 孤岛清理

| 删除目标 | 文件 |
|---|---|
| cache-warmth V1 副本 | [aigcfroge/src/agent/meta/cache-warmth.ts](../../packages/aigcfroge/src/agent/meta/cache-warmth.ts)（P2.3 迁移后） |
| workflow V1 副本 | [aigcfroge/src/agent/meta/workflow/](../../packages/aigcfroge/src/agent/meta/workflow/) |
| INTENT_TOOL_FILTERS 死代码（若 P2.3 不接线则删） | [tool/registry.ts:15-40](../../packages/core/src/tool/registry.ts#L15) |
| aigcfroge Session 服务（noopLayer 依赖） | [session/session.ts:923-930](../../packages/aigcfroge/src/session/session.ts#L923) |

#### P5.3 event-v2-bridge 降级

[bridge.ts](../../packages/aigcfroge/src/event-v2-bridge.ts) 保留 location 注入 + GlobalBus 转发，但 publish 包装部分（V1 残留模块消失后）删除。SSE 路径统一（[packages/server](../../packages/server/) 直接 EventV2 vs aigcfroge GlobalBus 二选一）。

#### P5.4 文档同步

| 文档 | 动作 |
|---|---|
| [ARCHITECTURE.md:244](../../ARCHITECTURE.md#L244) | MetaAgent/ModeSwitcher/StatusBar 改 Implemented + 指向本方案 |
| [v1-removal-and-v2-migration-plan.md](v1-removal-and-v2-migration-plan.md) | 重命名为 `ui-token-v1-v2-migration.md`，消除标题误导 |
| [specs/v2/todo.md](../../specs/v2/todo.md) | 重构为 done/in-progress/planned 表格 |
| [specs/v2/schema-changelog.md](../../specs/v2/schema-changelog.md) | P4.1 后更新兼容承诺 |
| [meta-agent-orchestrator.md](meta-agent-orchestrator.md) 等 5 篇 | 标注被本方案 supersede，标注 C5/I5 实现状态 |

---

## 5. 风险与回退策略

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| SessionRunner.layer 在 aigcfroge runtime 解析失败（调研 B.3 未验证） | 中 | Phase 1 阻塞 | **P1.1 前先写 smoke test 验证 Service 解析** |
| V2 schema 不向前兼容 | 高 | 升级数据丢失 | P4.1 schema 稳定 + 版本化策略 |
| task 工具 V2 重写遗漏 V1 边界 | 中 | meta 委派回归 | 录制测试覆盖三模式 + background 边界 |
| MCP V2 工作量大（2 天估计乐观） | 高 | Phase 3 延期 | 可拆 P3.1 为 MCP-basic（无 OAuth）+ MCP-oauth 两 slice |
| Mode Switcher viewport 修复牵扯广 | 中 | Phase 3 延期 | 独立分支，不阻塞主线 |
| V1 plugin 字符串 hook 迁移遗漏 | 中 | 插件回归 | 逐 hook 迁移测试 + 灰度 |
| UI event-reducer 改造影响渲染 | 中 | UI 回归 | 保留 V1 reducer 作 fallback 直到 session-ui v2 主线就绪 |

**回退策略**：
- 全程 `AIGCFROGE_V2_RUNTIME` feature flag 控制，任何 Phase 失败可回退 V1
- Phase 5（V1 删除）必须在 Phase 1-4 全绿 + 灰度运行 1 周后执行
- 数据库迁移全部 forward-only（不写 down），但保留 V1 schema 表共存直到 Phase 5

---

## 6. 验收清单（生产级闭环定义）

### 6.1 功能闭环
- [ ] `AIGCFROGE_V2_RUNTIME=true` 全入口走 V2，无 V1 调用
- [ ] meta agent 可调 task 工具委派 4 个子 agent + 3 个 CLI
- [ ] meta 子 agent 可再委派（C5 修复）
- [ ] prerouter 高置信快路径在 V2 生效
- [ ] meta prompt 占位符已填充
- [ ] MCP 工具在 V2 runner 可用
- [ ] Mode Switcher 4 模式均有 viewport
- [ ] UI 正确渲染 `session.next.*` 事件

### 6.2 生产级标准
- [ ] V2 schema 向前兼容承诺
- [ ] 所有 Effect 边界有兜底
- [ ] CacheDiagnostic + Stuck 可观测
- [ ] 测试覆盖盲区全补（P4.4 清单）
- [ ] ARCHITECTURE.md §7 文档同步

### 6.3 清理完成
- [ ] V1 SessionPrompt/agent/tool/mcp/plugin 全删
- [ ] 孤岛代码全删
- [ ] event-v2-bridge 降级
- [ ] 5 篇 meta-agent 计划文档标注 supersede

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
| [packages/core/src/session/event.ts](../../packages/core/src/session/event.ts) | SessionEvent 全类型 |
| [packages/server/src/handlers.ts](../../packages/server/src/handlers.ts) | V2 native server 全栈 |

### 7.2 V2 待新建

| 文件 | Phase |
|---|---|
| [packages/core/src/tool/task.ts](../../packages/core/src/tool/) | P2.2 |
| [packages/core/src/permission/subagent-permissions.ts](../../packages/core/src/permission/) | P2.1 |
| [packages/core/src/agent/meta/](../../packages/core/src/agent/)（prerouter 迁入） | P2.3 |
| [packages/core/src/meta-agent/service.ts](../../packages/core/src/meta-agent/) | P2.5 |
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

---

## 8. 执行顺序总览

```
Day 1:    Phase 0（基线）+ P1.1 smoke test
Day 2-4:  Phase 1（接线闭合，task 降级）
Day 5-8:  Phase 2（meta 能力对等，P2.1-P2.7 可部分并行）
Day 9-13: Phase 3（下游对等，P3.1-P3.7 并行）
Day 14-16:Phase 4（生产级加固）
Day 17-18:Phase 5（V1 退役清理）
Day 19+:  灰度运行 1 周 → 移除 feature flag
```

**关键里程碑**：
- Phase 1 完成：V2 runner 真正运行（task 降级）
- Phase 2 完成：meta 恢复完整委派能力
- Phase 3 完成：全栈能力对等
- Phase 4 完成：生产级标准达成
- Phase 5 完成：V1 彻底退役

---

> **下一步**：本方案评审通过后，从 Phase 0 开始执行。建议先用 Workflow 并行验证 Phase 1 的三个阻塞点（app-runtime provide / 路由 namespace / 入口切换）的可行性，确认无隐藏依赖后再正式启动。
