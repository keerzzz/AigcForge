# 元智能体 VS Code 对齐升级方案

> **状态**: v1 — 草稿，待审批
> **作者**: 高级产品总监
> **日期**: 2026-07-10
> **范围**: 借鉴 VS Code Copilot 智能体系统设计，升级 AigcForge 元智能体在声明式 Agent 定义、Handoff 切换、Tool 权限管理、CLAUDE.md 热检测、PreToolUse 钩子、MCP 扩展性六个维度的能力
> **关联文档**: [meta-agent-v2-production-closure.md](meta-agent-v2-production-closure.md) · [meta-agent-orchestrator.md](meta-agent-orchestrator.md) · [../../CLAUDE.md](../../CLAUDE.md) · [../../AGENTS.md](../../AGENTS.md) · [../../DESIGN.md](../../DESIGN.md) · [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · [subagent-visibility-and-bottom-stats.md](subagent-visibility-and-bottom-stats.md) · [../../packages/core/src/agent.ts](../../packages/core/src/agent.ts) · [../../packages/core/src/plugin/agent.ts](../../packages/core/src/plugin/agent.ts) · [../../packages/core/src/tool/registry.ts](../../packages/core/src/tool/registry.ts) · [../../packages/core/src/mcp/](../../packages/core/src/mcp/) · [../../packages/plugin/src/v2/effect/meta.ts](../../packages/plugin/src/v2/effect/meta.ts) · [../../packages/core/src/plugin/host.ts](../../packages/core/src/plugin/host.ts)

---

## 0. 文档定位

本文档是 AigcForge 元智能体系统 **借鉴 VS Code Copilot 设计**的执行方案。它不是对现有系统的重构，而是增量升级——在 V2 已就绪的基础设施之上，逐个补齐 VS Code 已验证的产品能力和工程模式。

### 真实需求验证（苏格拉底追问摘要）

**Q**: 为什么要学 VS Code Copilot？用户感知到了什么缺失？
**A**: 用户没有直接抱怨——但四个隐性问题在侵蚀体验：

| 隐性问题 | 表现 | 来源 |
|---|---|---|
| Agent 配置不透明 | 改 agent prompt 要改代码、部署 | VS Code 用 `.agent.md` 声明式定义 |
| 子 agent 切换不可见 | task 委派后用户不知道"现在是谁在干活" | VS Code 用 Handoff 按钮显式切换 |
| Tool 权限一刀切 | 所有工具走同一套 allow/deny/ask 规则 | VS Code 按 tool 注册独立 Handler |
| 配置变更不生效 | 改完 CLAUDE.md 要手动重启 | VS Code 自动检测变更 + session resume |

**→ 核心结论**: 这四件事用户不会主动说"缺了"，但每个都在日常使用中累积摩擦。补齐它们是产品成熟度的必经之路。

---

## 1. 现状基线

### 1.1 直接可用（无需改动）

| 能力 | 位置 | 说明 |
|---|---|---|
| AgentV2 注册框架 | [core/src/agent.ts](../../packages/core/src/agent.ts) | 8 个 agent 的运行时注册，`select`/`resolve`/`default` 完整 |
| V2 Plugin AgentHooks | [plugin/src/v2/effect/agent.ts](../../packages/plugin/src/v2/effect/agent.ts) | plugin 注册 agent 的能力 |
| PermissionV2 规则引擎 | [core/src/permission.ts](../../packages/core/src/permission.ts) | allow/deny/ask 三态 + `deriveSubagent` 继承 |
| LocationServiceMap | [core/src/location-layer/index.ts](../../packages/core/src/location-layer/index.ts) | Location-scoped service 注册 |
| EventV2 PubSub | [core/src/event.ts](../../packages/core/src/event.ts) | 事件发布/订阅基础设施 |
| SessionV2.resume | [core/src/session.ts](../../packages/core/src/session.ts) | session 续接能力 |

### 1.2 部分可用（需扩展）

| 能力 | 位置 | 缺失 |
|---|---|---|
| MetaHooks intent.register | [plugin/src/v2/effect/meta.ts](../../packages/plugin/src/v2/effect/meta.ts) | 接口已定义，middleware hooks 为空壳（PreToolUse/PostToolUse） |
| ToolRegistry.materialize | [core/src/tool/registry.ts](../../packages/core/src/tool/registry.ts) | 已有 `INTENT_TOOL_FILTERS` 定义但 runner 不传 intent（死代码） |
| SessionShareV2.share | [core/src/session/share-v2.ts](../../packages/core/src/session/share-v2.ts) | 只有 `scope:"full"`，无 `scope:"summary"` 摘要压缩 |
| MCP V2 Service | [core/src/mcp/](../../packages/core/src/mcp/) | 独立 Service 已存在，缺 Contributor 注册表机制 |

### 1.3 缺失（本方案新建）

| 缺口 | 说明 | VS Code 对标 |
|---|---|---|
| `.agent.md` 文件加载器 | Agent 定义不能通过文件声明 | `ChatCustomAgentProvider` + `.agent.md` |
| Handoff 机制 | 无显式 agent 切换流程 | `AgentHandoff` 接口 + handoff 按钮 |
| ToolPermissionHandler 注册表 | 按 tool 分类的权限策略 | `IClaudeToolPermissionHandler` |
| CLAUDE.md 变更热检测 | 配置变更需手动重启 session | `ClaudeSettingsChangeTracker` |
| MCP Contributor 注册表 | MCP server 扩展需改核心代码 | `IClaudeMcpServerContributor` + `registerClaudeMcpServerContributor` |
| PreToolUse/PostToolUse 真实实现 | MetaHooks middleware 当前空壳 | Hook 系统 (`system:hook_started`/`hook_response`) |

---

## 2. 目标架构

```
用户
  │
  ├─ .claude/agents/*.agent.md  ← 新增：声明式 Agent 定义
  │     └─ AgentV2 合并加载：file > code
  │
  ├─ Agent 运行
  │     ├─ AgentV2.select() → 默认 agent（含 Handoff 切换） ← 新增 Handoff 状态
  │     ├─ PreToolUse hook → ToolPermissionHandler 链      ← 新增：多层权限
  │     │     ├─ BashHandler（auto-approve 白名单路径）
  │     │     ├─ EditHandler（diff 确认 UI）
  │     │     └─ ReadHandler（auto-approve）
  │     ├─ ToolRegistry.materialize(intent) → 工具裁剪       ← 修复：INTENT_TOOL_FILTERS 接线
  │     ├─ execute → PostToolUse hook                      ← 新增：上下文阈值检查
  │     └─ session turn end
  │           └─ ChatSettingsChangeTracker                  ← 新增：文件变更检测
  │                 ├─ CLAUDE.md / agents/*.agent.md
  │                 └─ settings.json
  │
  ├─ MCP Servers
  │     ├─ registerClaudeMcpServerContributor()             ← 新增：Contributor 注册表
  │     └─ buildMcpServersFromRegistry() → McpV2.Options
  │
  └─ Agent 切换流程                                         ← 新增：Handoff 生命周期
        Plan Agent ── handoff("Start Implementation") ──→ Agent (implement)
                      ↕ (可选)                           ↑ 新会话，注入 context
```

---

## 3. 分阶段实施

### Phase 1 — PreToolUse/PostToolUse 钩子实现（P0，安全底线）

**目标**: 填补 MetaHooks middleware 的空壳状态，使 PreToolUse 可拦截工具执行，PostToolUse 可检查上下文阈值。

**依赖**: 无

**工时**: 1.5 天

#### P1.1 middleware 存储与执行链（0.5 天）

| 动作 | 文件 | 说明 |
|---|---|---|
| 实现 `middleware.register` 存储 | [host.ts](../../packages/core/src/plugin/host.ts) | 维护已注册 middleware 列表（`{name, hooks}`），按注册顺序存储 |
| PreToolUse 拦截点 | [registry.ts:76-108](../../packages/core/src/tool/registry.ts#L76) settle 前 | 遍历 middleware.before 钩子，返回 `{action: "allow" | "deny", reason?: string}` |
| PostToolUse 触发点 | [runner/llm.ts:174-435](../../packages/core/src/session/runner/llm.ts#L174) turn 结束后 | 遍历 middleware.after 钩子，检查上下文阈值触发 compaction |
| 测试 | [plugin/test/](../../packages/plugin/test/) | `testEffect()` + `Layer.mock` 覆盖 allow/deny/compact 三种路径 |

**验收**:
- [ ] plugin 注册 middleware 后，PreToolUse 能拦截指定工具并返回 deny
- [ ] PostToolUse 能在上下文超过阈值时触发 compaction
- [ ] 多个 middleware 按注册顺序执行（非并行覆盖）

#### P1.2 ToolPermissionHandler 注册表（1 天）

| 动作 | 文件 | 说明 |
|---|---|---|
| 新建 `ToolPermissionHandler` 接口 | [packages/core/src/permission/tool-handler.ts](../../packages/core/src/permission/) 新建 | 三段式接口：`canAutoApprove`/`getConfirmationParams`/`handle` |
| 新建 `handlerRegistry` | 同上 | `Map<toolName, HandlerCtor>` + DI 实例化 |
| 对接现有 PermissionV2 | [packages/core/src/permission.ts](../../packages/core/src/permission.ts) | 无 handler 时 fallback 到现有 ruleset |
| Bash auto-approve 示例 | [packages/core/src/tool/bash.ts](../../packages/core/src/tool/bash.ts) | 实现示例 handler：上次 approve 路径 5 分钟内 auto-approve |
| 测试 | [packages/core/test/](../../packages/core/test/) | 覆盖 handler 三种返回路径 + fallback 逻辑 |

**验收**:
- [ ] `BashHandler` 示例实现——白名单路径（`/tmp/*`）auto-approve，其余走确认
- [ ] 无 handler 注册时 behavior 不变（fallback 到 PermissionV2 ruleset）
- [ ] handler 返回 `deny` 后工具不执行，返回 `allow` 后正常执行

**参考（VS Code）**:

```typescript
// claudeToolPermission.ts IClaudeToolPermissionHandler 三段式接口
export interface IClaudeToolPermissionHandler {
  canAutoApprove?(name, input, ctx): Promise<boolean>   // 跳过确认
  getConfirmationParams?(name, input): ConfirmationParams // 自定义确认 UI
  handle?(name, input, ctx): Promise<PermissionResult>    // 完全自定义
}
```

---

### Phase 2 — `.agent.md` 声明式 Agent 定义（P1）

**目标**: 允许用户和插件通过 `.claude/agents/*.agent.md` 文件声明 agent，无需改代码部署。同时保留现有 TypeScript 注册机制（file > code 合并）。

**依赖**: 无

**工时**: 2 天

#### P2.1 AgentFileLoader service（1 天）

| 动作 | 文件 | 说明 |
|---|---|---|
| 新建 `AgentFileLoader` Service | [packages/core/src/agent/file-loader.ts](../../packages/core/src/agent/) 新建 | 扫描 `.claude/agents/*.agent.md` |
| 解析 YAML frontmatter + markdown body | 同上 | frontmatter → `AgentV2.Info`，body → `systemPrompt` |
| 文件变更监听 | 同上 | `fs.watch` 或轮询检测文件增删改 |

**Agent file 格式**:

```yaml
---
name: Explore
description: Fast read-only codebase exploration subagent
tools: [search, read, web, grep, glob]
model: ['Claude Haiku 4.5', 'Gemini 3 Flash']
agents: []
user-invocable: false
---
You are an exploration agent specialized in rapid codebase analysis...
```

**映射到 `AgentV2.Info`**:

| YAML field | `AgentV2.Info` 字段 | 说明 |
|---|---|---|
| `name` | `id` (branded) | agent 唯一标识 |
| `description` | `description` | 展示描述 |
| `tools` | `permission`（转换） | 工具白名单 → allow ruleset |
| `model` | `variant` | 模型选择（优先级列表） |
| `agents` | — | 可委派的子 agent 列表 |
| `user-invocable` | `hidden` | false → hidden |
| body | `system` | system prompt |

#### P2.2 合并到 AgentV2 加载链（0.5 天）

| 动作 | 文件 | 说明 |
|---|---|---|
| `AgentV2.resolve()` 增加 file source | [agent.ts:95-98](../../packages/core/src/agent.ts#L95) | 查询链：file > code 注册（同名 file 覆盖 code） |
| `AgentV2.default()` 增加 file 可见性 | [agent.ts:66-83](../../packages/core/src/agent.ts#L66) | 文件的 `hidden`/`mode` 参与默认选择 |
| 测试 | [packages/core/test/](../../packages/core/test/) | 验证同名 file 覆盖 code 注册 |

#### P2.3 组织级 agent 分发（预留，P3）

| 动作 | 文件 | 说明 |
|---|---|---|
| 新建 `GitOrgAgentProvider` | [packages/aigcfroge/src/agent/](../../packages/aigcfroge/src/agent/) 新建（预留） | 可选的 GitHub Org 同步能力 |
| 轮询间隔 | 参考 VS Code 5 分钟 | 暂不实现，留接口占位 |

**验收**:
- [ ] `.claude/agents/my-agent.agent.md` → app 中可见自定义 agent
- [ ] 同名 agent file 覆盖 TypeScript 注册（升序合并）
- [ ] body 内容作为 system prompt 注入
- [ ] file 增删改后自动刷新 agent 列表（非重启）

**参考（VS Code）**:

```yaml
# VS Code 的 .agent.md 格式
---
name: Plan
description: Researches and outlines multi-step plans
tools: [search, read, web, 'vscode/memory']
handoffs:
  - label: Start Implementation
    agent: agent
    prompt: Start implementation
    send: true
---
You are a PLANNING AGENT, pairing with the user...
```

---

### Phase 3 — Handoff 机制（P1）

**目标**: 让 agent 之间可以显式切换（如 Plan → Implement），切换时传递上下文摘要，用户可见切换按钮。

**依赖**: Phase 2 `.agent.md` | Phase 1 PreToolUse

**工时**: 2.5 天

#### P3.1 Handoff schema 定义（0.5 天）

| 动作 | 文件 | 说明 |
|---|---|---|
| 新建 `Handoff` schema | [packages/schema/src/handoff.ts](../../packages/schema/src/handoff.ts) 新建 | 对等 VS Code `AgentHandoff` 接口 |

```typescript
export interface Handoff {
  readonly label: string           // "Start Implementation"
  readonly agent: string           // 目标 agent ID
  readonly prompt: string          // 上下文传递 prompt
  readonly send?: boolean          // 是否自动发送 prompt
  readonly model?: string          // 目标模型（可选）
}
```

#### P3.2 AgentV2 增加 handoff 状态（0.5 天）

| 动作 | 文件 | 说明 |
|---|---|---|
| `AgentV2.Info` 增加 `handoffs` 字段 | [core/src/agent.ts](../../packages/core/src/agent.ts) | `handoffs: Handoff[]` |
| Handoff 切换逻辑 | 同上 | `select(id, {viaHandoff})` → 继承上下文 |  |

#### P3.3 Handoff UI 按钮（TUI + app）（1.5 天）

| 动作 | 文件 | 说明 |
|---|---|---|
| TUI 中 handoff 按钮 | [packages/tui/src/prompt/part.ts](../../packages/tui/src/prompt/part.ts) | assistant 回复尾部渲染 handoff 按钮 |
| app 中 handoff 按钮 | [packages/app/src/pages/session/timeline/](../../packages/app/src/pages/session/timeline/) | Message 组件尾部扩展 handoff |
| Handoff 触发 | 同上 | 点击 → 创建新会话（或复用）+ 注入 prompt |
| 测试 | TUI + app 测试 | 验证 handoff 显示 + 触发 |  |

#### P3.4 `.agent.md` 增加 handoffs 解析（0.5 天）

| 动作 | 文件 | 说明 |
|---|---|---|
| YAML frontmatter 增加 `handoffs` | [file-loader.ts](../../packages/core/src/agent/file-loader.ts) | 解析 handoffs 数组 |
| 工具白名单：handoff 需要 Agent/Task 工具 | 同上 | handoff 声明时自动注入 task 工具权限 |  |

**验收**:
- [ ] `.agent.md` 中声明 `handoffs` → agent 运行时可见切换按钮
- [ ] 点击 handoff 按钮 → 创建新 agent 会话 + 自动发送 prompt
- [ ] 切换后用户在 timeline 可见"已切换到 agent"的提示
- [ ] app + TUI 双端支持

**参考（VS Code）**:

```typescript
// agentTypes.ts AgentHandoff 接口
export interface AgentHandoff {
  readonly label: string;
  readonly agent: string;
  readonly prompt: string;
  readonly send?: boolean;
  readonly showContinueOn?: boolean;
  readonly model?: string;
}
```

---

### Phase 4 — MCP Contributor 注册表（P1）

**目标**: 让 MCP server 可以通过注册表机制扩展，而非改核心代码。对等 VS Code 的 `registerClaudeMcpServerContributor`。

**依赖**: 无（直接扩展 `McpV2.Service`）

**工时**: 1.5 天

#### P4.1 Contributor 接口 + 注册表（0.5 天）

| 动作 | 文件 | 说明 |
|---|---|---|
| 新建 `IClaudeMcpServerContributor` 接口 | [core/src/mcp/contributor.ts](../../packages/core/src/mcp/) 新建 | `getMcpServers(): Promise<Record<string, McpServerConfig>>` |
| 注册表 `contributorRegistry` | 同上 | 全局 `Set<Ctor>`，模块加载时注册 |
| 构建函数 `buildMcpServersFromRegistry()` | 同上 | DI 实例化 + merge 所有 contributor |

#### P4.2 示例 Contributor（0.5 天）

| 动作 | 文件 | 说明 |
|---|---|---|
| 新建 `IdeMcpServerContributor` | [packages/aigcfroge/src/mcp/contributors/](../../packages/aigcfroge/src/mcp/contributors/) 新建 | 暴露 VS Code 诊断等 IDE 工具（对等 VS Code） |
| 注册 | 同上 | 模块加载时调用 `registerClaudeMcpServerContributor(IdeMcpServerContributor)` |

#### P4.3 对接 McpV2 初始化（0.5 天）

| 动作 | 文件 | 说明 |
|---|---|---|
| McpV2 初始化时调用 `buildMcpServersFromRegistry()` | [core/src/mcp/mcp-v2.ts](../../packages/core/src/mcp/mcp-v2.ts) | 将 contributor 的 server 合并到 `McpServerConfig[]` |

**验收**:
- [ ] `registerClaudeMcpServerContributor` 注册后在 McpV2 中可用
- [ ] 多个 contributor 的 server 配置正确 merge
- [ ] 示例 `IdeMcpServerContributor` 正常暴露

**参考（VS Code）**:

```typescript
// claudeMcpServerRegistry.ts
registerClaudeMcpServerContributor(IdeMcpServerContributor);

// ideMcpServer.ts — 示例：将 VS Code 诊断暴露为 MCP 工具
class IdeMcpServerContributor implements IClaudeMcpServerContributor {
  async getMcpServers(): Promise<Record<string, McpServerConfig>> {
    const getDiagnosticsTool = tool('getDiagnostics', 'Get language diagnostics', {...}, handler);
    return { ide: createSdkMcpServer({ name: 'ide', tools: [getDiagnosticsTool] }) };
  }
}
```

---

### Phase 5 — CLAUDE.md 变更热检测（P2）

**目标**: CLAUDE.md / settings.json / agents 目录变更时自动检测，session 自动 restart with resume，无需用户手动重启。

**依赖**: SessionV2.resume

**工时**: 1.5 天

#### P5.1 变更跟踪器（1 天）

| 动作 | 文件 | 说明 |
|---|---|---|
| 新建 `FileChangeTracker` | [packages/aigcfroge/src/session/file-change-tracker.ts](../../packages/aigcfroge/src/session/) 新建 | 注册路径 + 目录 + 扩展名 |
| 路径解析器 | 同上 | `registerPathResolver()` / `registerDirectoryResolver()` |
| Snapshot 对比 | 同上 | 记录 mtime + size，`hasChanges()` 检测 |

跟踪路径:
```
~/.claude/CLAUDE.md
{workspace}/CLAUDE.md
{workspace}/.claude/CLAUDE.md
{workspace}/CLAUDE.local.md
~/.claude/settings.json
{workspace}/.claude/settings.json
~/.claude/agents/*.md
{workspace}/.claude/agents/*.md
```

#### P5.2 集成到 SessionV2 循环（0.5 天）

| 动作 | 文件 | 说明 |
|---|---|---|
| `_processMessages` 入口检测 | [claudeCodeAgent.ts 模式](../../../web/vscode-main/extensions/copilot/src/extension/chatSessions/claude/node/claudeCodeAgent.ts#L559) 移植 | 消息循环前检查 `hasChanges()` |
| 变更触发 | 同上 | 检测到变更 → abort → resume（tools 快照匹配时）|

**验收**:
- [ ] 修改 CLAUDE.md → session 自动 restart with resume
- [ ] agents 目录增删 `.agent.md` → session 自动 restart
- [ ] 未变更时零开销（不触发额外检测）

**参考（VS Code）**:

```typescript
// ClaudeSettingsChangeTracker — 注册路径解析器
tracker.registerPathResolver(() => [
  URI.joinPath(userHome, '.claude', 'CLAUDE.md'),
  ...workspaceFolders.map(f => URI.joinPath(f, 'CLAUDE.md')),
]);
tracker.registerDirectoryResolver(() => [
  URI.joinPath(userHome, '.claude', 'agents'),
  ...workspaceFolders.map(f => URI.joinPath(f, '.claude', 'agents')),
], '.md');

// session 循环中检测
if (await this._settingsChangeTracker.hasChanges()) {
  this._restartSession();  // abort + resume
}
```

---

### Phase 6 — INTENT_TOOL_FILTERS 接线 + 工具裁剪（P1）

**目标**: 让 PreRouter 的意图分类结果传入 `ToolRegistry.materialize`，使 runner 按 intent 裁剪可用工具集，减少前缀 Token。

**依赖**: Phase 1 PreToolUse | V2 PreRouter（已迁移到 core）

**工时**: 1 天

#### P6.1 runner 传 intent（0.5 天）

| 动作 | 文件 | 说明 |
|---|---|---|
| runner 调用 PreRouter.preRoute | [runner/llm.ts:184-205](../../packages/core/src/session/runner/llm.ts#L184) | `agents.select` 前调用，获取 intent category |
| 将 intent 传入 materialize | 同上 | `materialize({...tools, intent})` |

#### P6.2 materialize 应用 intent filter（0.5 天）

| 动作 | 文件 | 说明 |
|---|---|---|
| `materialize()` 读取 intent | [registry.ts:132-153](../../packages/core/src/tool/registry.ts#L132) | 按 INTENT_TOOL_FILTERS 过滤 |
| `code_understanding` → 只暴露 read/grep/glob | [registry.ts:15-40](../../packages/core/src/tool/registry.ts#L15) | 已验证的 filter 规则 |
| 测试 | [session-runner.test.ts](../../packages/core/test/) | 验证 intent 过滤正确 |

**验收**:
- [ ] `code_understanding` intent → 只返回只读工具（read/grep/glob）
- [ ] `code_modification` intent → 返回全部工具
- [ ] intent 不传时 behavior 不变

---

## 4. 文件变更清单

### 新建文件

| 文件 | Phase | 用途 |
|---|---|---|
| [packages/core/src/permission/tool-handler.ts](../../packages/core/src/permission/) | P1.2 | ToolPermissionHandler 接口 + 注册表 |
| [packages/core/src/agent/file-loader.ts](../../packages/core/src/agent/) | P2.1 | `.agent.md` 文件加载器 |
| [packages/core/src/mcp/contributor.ts](../../packages/core/src/mcp/) | P4.1 | MCP Contributor 接口 + 注册表 |
| [packages/schema/src/handoff.ts](../../packages/schema/src/) | P3.1 | Handoff schema |
| [packages/aigcfroge/src/mcp/contributors/ide.ts](../../packages/aigcfroge/src/mcp/contributors/) | P4.2 | IDE 诊断 MCP 示例 Contributor |
| [packages/aigcfroge/src/session/file-change-tracker.ts](../../packages/aigcfroge/src/session/) | P5.1 | 文件变更跟踪器 |

### 修改文件

| 文件 | Phase | 改动 |
|---|---|---|
| [packages/core/src/plugin/host.ts](../../packages/core/src/plugin/host.ts) | P1.1 | middleware 存储 + 遍历执行 |
| [packages/core/src/tool/registry.ts](../../packages/core/src/tool/registry.ts) | P1.1/P6.2 | PreToolUse 拦截点 + intent filter 接线 |
| [packages/core/src/session/runner/llm.ts](../../packages/core/src/session/runner/llm.ts) | P1.1/P6.1 | PostToolUse 触发点 + intent 传递 |
| [packages/core/src/agent.ts](../../packages/core/src/agent.ts) | P2.2/P3.2 | AgentV2.resolve + AgentV2.Info.handoffs |
| [packages/core/src/mcp/mcp-v2.ts](../../packages/core/src/mcp/mcp-v2.ts) | P4.3 | 集成 Contributor 注册表 |
| [packages/aigcfroge/src/agent/agent.ts](../../packages/aigcfroge/src/agent/agent.ts) | P2.2 | 读取 file loader 合并 |
| [packages/tui/src/prompt/part.ts](../../packages/tui/src/prompt/part.ts) | P3.3 | Handoff 按钮渲染 |
| [packages/app/src/pages/session/timeline/](../../packages/app/src/pages/session/timeline/) | P3.3 | Handoff 按钮渲染 |

---

## 5. 协议合规约束

| 协议 | 约束 | 适用 |
|---|---|---|
| **Effect 编码** | `Effect.fn("ToolPermissionHandler.xxx")` + `Effect.gen` + `Effect.forkIn(scope)` | P1/P6 |
| **模块组织** | `export * as ToolHandler from "./tool-handler"`；禁 `export namespace` | 全 Phase |
| **Schema** | 多字段 `Schema.Struct`，单值 `Schema.brand`，错误 `Schema.TaggedErrorClass` | P3.1 |
| **测试** | `testEffect()` + `Layer.mock`；禁 `Effect.sleep` | 全 Phase |
| **安全门禁** | PreToolUse 拦截点必须 Catch Everything（拦截失败不应执行工具） | P1.1 |
| **改完即审** | 每次改动后 `git diff` + `bun run lint` + 受影响包 typecheck + test | 全 Phase |
| **架构边界** | `AgentFileLoader` 在 core 层，不依赖 aigcfroge 具体实现 | P2.1 |
| **极致减法** | 不新建平行实现，扩展现有 `AgentV2` / `McpV2` / `PermissionV2` | 全 Phase |

---

## 6. 测试策略（审批补充）

> **原则：先写测试，后写实现。** 每个 Phase 的代码变更必须从测试文件开始；测试定义行为契约、验收标准和回归防护，实现只负责让测试通过。

### 6.1 TDD 执行流程

每个 Phase 按以下顺序执行：

1. **写失败测试**：根据本节的测试文件清单新建/扩展测试，运行确认失败。
2. **写最小实现**：只写让测试通过的最小代码。
3. **重构并通过**：运行 `bun run lint` + 受影响包 `typecheck` + `test`。
4. **改完即审**：按 CLAUDE.md §改完即审流程输出复查结论。

### 6.2 测试基础设施

| 项 | 规范 |
|---|---|
| 测试框架 | `bun:test` |
| Effect 测试 | `testEffect(...)`（`packages/<pkg>/test/lib/effect.ts`） |
| Mock 策略 | 优先 `Layer.mock`；禁止 `globalThis.*` 污染 |
| 并发同步 | 禁止 `Effect.sleep` / `setTimeout`；用 `Deferred`、`pollWithTimeout`、`awaitWithTimeout` |
| 运行位置 | 从包目录运行：`bun --cwd packages/<name> test --timeout 30000` |
| 类型检查 | `bun --cwd packages/<name> typecheck`（`tsgo --noEmit`） |
| Lint | `bun run lint`（oxlint） |

### 6.3 按 Phase 测试文件清单

#### Phase 1 — PreToolUse/PostToolUse 钩子 + ToolPermissionHandler

| 测试文件 | 覆盖目标 |
|---|---|
| `packages/core/test/tool-lifecycle-hooks.test.ts` | `runPreToolUse` 单 hook / 多 hook 顺序执行；`allow=true/false`；`reason` 传递；`runPostToolUse` 多 hook 独立执行且失败不互相影响 |
| `packages/core/test/permission-tool-handler.test.ts` | `ToolPermissionHandler` 注册表增删查；handler 返回 `allow/deny/ask`；无 handler 时 fallback 到 `PermissionV2` ruleset；多 handler 链式执行 |
| `packages/core/test/tool-bash-handler.test.ts` | 示例 `BashHandler`：白名单路径（`/tmp/*`）auto-approve；非白名单路径走确认；5 分钟缓存/记忆行为 |
| `packages/core/test/plugin-host-meta-hooks.test.ts` | `PluginHost.make` 中 `MetaDraft.middleware.register` 注册 `preToolUse`/`postToolUse`；scope 关闭时正确注销；intent/adapter 当前空壳行为保留 |

#### Phase 2 — `.agent.md` 声明式 Agent 定义

| 测试文件 | 覆盖目标 |
|---|---|
| `packages/core/test/agent-file-loader.test.ts` | 扫描 `.claude/agents/*.agent.md`；解析 YAML frontmatter + markdown body；字段到 `AgentV2.Info` 映射；文件增删改热刷新；错误文件降级处理 |
| `packages/core/test/agent-file-loader-mapping.test.ts` | `tools` → `permissions`、`model` → `variant`、`user-invocable` → `hidden`、body → `system` 等映射规则 |
| `packages/aigcfroge/test/agent/v2-file-merge.test.ts` | file source 与 code source 合并；同名 file 覆盖 code；`AgentV2.resolve()` / `AgentV2.default()` 包含 file agent |

#### Phase 3 — Handoff 机制

| 测试文件 | 覆盖目标 |
|---|---|
| `packages/core/test/handoff-schema.test.ts` | `Handoff` schema decode/encode；必填字段校验；可选字段默认值（`packages/schema` 无独立 test 脚本，在 core 中验证） |
| `packages/core/test/agent-handoff.test.ts` | `AgentV2.Info.handoffs` 字段生效；`select(id, {viaHandoff})` 继承上下文；handoff prompt 注入 |
| `packages/app/src/components/session/handoff-button.test.tsx` | Handoff 按钮渲染；点击触发创建/复用 session；注入 prompt；切换提示可见 |
| `packages/tui/test/prompt/part-handoff.test.ts` | TUI assistant 回复尾部渲染 handoff 按钮；键盘/点击触发 |

#### Phase 4 — MCP Contributor 注册表

| 测试文件 | 覆盖目标 |
|---|---|
| `packages/core/test/mcp-contributor.test.ts` | `registerClaudeMcpServerContributor`；多 contributor merge；重复 ID 处理；`buildMcpServersFromRegistry()` 输出正确 `McpServerConfig` |
| `packages/aigcfroge/test/mcp/ide-contributor.test.ts` | `IdeMcpServerContributor` 暴露 `getDiagnostics` 工具；配置被 `McpV2` 正确消费 |

#### Phase 5 — CLAUDE.md 变更热检测

| 测试文件 | 覆盖目标 |
|---|---|
| `packages/aigcfroge/test/session/file-change-tracker.test.ts` | `registerPathResolver` / `registerDirectoryResolver`；mtime+size snapshot 对比；`hasChanges()` 正确性；debounce + 冷却期 |
| `packages/aigcfroge/test/session/hot-reload-session.test.ts` | CLAUDE.md 变更触发 abort + resume；agents 目录变更触发 restart；未变更时零开销 |

#### Phase 6 — INTENT_TOOL_FILTERS 接线 + 工具裁剪

| 测试文件 | 覆盖目标 |
|---|---|
| `packages/core/test/tool-registry-intent.test.ts` | `materialize(permissions, intent)` 按 intent 过滤；`code_understanding` → 只读工具；`code_modification` → 全部工具；不传 intent 行为不变 |
| `packages/core/test/session-runner-intent.test.ts` | runner 从最新 user message 推导 intent 并传入 `materialize`；IntentCategory 边界 |

### 6.4 测试覆盖率门禁

- 每个新建模块的单元测试覆盖率目标：分支 ≥ 80%，函数 ≥ 90%。
- UI 组件必须包含 story 或渲染测试：default、hover、disabled、loading、empty、error。
- 每个 Phase 的验收清单中至少 80% 条目有自动化测试对应。
- 不允许提交失败测试；临时 `test.skip` 必须附带 TODO 和 issue 链接。

### 6.5 测试命令速查

```bash
# core 包全量
bun --cwd packages/core test --timeout 30000
bun --cwd packages/core typecheck

# aigcfroge 包全量
bun --cwd packages/aigcfroge test --timeout 30000
bun --cwd packages/aigcfroge typecheck

# app / tui UI 测试
bun --cwd packages/app test --timeout 30000
bun --cwd packages/tui test --timeout 30000

# 全仓 lint
bun run lint
```

---

## 7. 依赖关系

```
Phase 1 (P0)             ← 无前置。安全底线，最先执行
  ├── P1.1 PreToolUse 真实实现
  └── P1.2 ToolPermissionHandler 注册表

Phase 2 (P1)             ← 无前置
  ├── P2.1 AgentFileLoader
  ├── P2.2 合并 AgentV2
  └── P2.3 Org 分发（预留）

Phase 3 (P1)             ← 依赖 Phase 2（.agent.md）+ Phase 1（hook）
  ├── P3.1 Handoff schema
  ├── P3.2 AgentV2 扩展
  ├── P3.3 Handoff UI
  └── P3.4 YAML 解析

Phase 4 (P1)             ← 无前置
  ├── P4.1 Contributor 接口
  ├── P4.2 示例 Contributor
  └── P4.3 对接 McpV2

Phase 5 (P2)             ← 依赖 SessionV2.resume
  ├── P5.1 FileChangeTracker
  └── P5.2 集成 session 循环

Phase 6 (P1)             ← 依赖 Phase 1（hook）+ V2 PreRouter
  ├── P6.1 runner 传 intent
  └── P6.2 materialize filter
```

**执行顺序建议**: Phase 1 → Phase 2 + Phase 4 并行 → Phase 3 + Phase 6 → Phase 5

---

## 8. 风险与回退

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| `.agent.md` 格式与 `AgentV2.Info` 字段不完全对齐 | 中 | 部分字段无法映射 | 降级：不支持字段忽略 + log 警告 |
| Handoff 切换丢失上下文 | 中 | 用户需要重述需求 | `prompt` 字段强制非空；支持 `send:true` 自动发送 |
| PreToolUse 钩子执行失败导致工具无法执行 | 低 | 工具死锁 | Catch Everything + fallback allow |
| FileChangeTracker 在高频写入场景下过度触发 | 低 | 频繁 session restart | 500ms debounce + 1min 冷却期 |
| Phase 6 INTENT_TOOL_FILTERS 裁剪错误 | 中 | agent 工具选择异常 | 按 intent 全量录制测试 |

**回退策略**:
- 所有功能通过 feature flag 控制：`AIGCFROGE_ENABLE_AGENT_FILE` / `AIGCFROGE_ENABLE_HANDOFF` / ...
- `AIGCFROGE_DISABLE_META_AGENT=true` 回退 build agent（已有）
- Phase 5 热检测失败：用户手动重启 session（当前已存在的行为）

---

## 9. 验收清单

### Phase 1 — PreToolUse 钩子 + ToolHandler
- [ ] PreToolUse 遍历已注册 middleware 并正确拦截工具调用
- [ ] PostToolUse 在上下文超过阈值时触发 compaction
- [ ] middleware 按注册顺序执行
- [ ] ToolPermissionHandler 注册后可自定义 auto-approve
- [ ] 示例 BashHandler：白名单路径 auto-approve，其余确认
- [ ] 无 handler 时 fallback 到 PermissionV2 ruleset（behavior 不变）

### Phase 2 — `.agent.md`
- [ ] `.claude/agents/*.agent.md` → agent 可见
- [ ] YAML frontmatter 正确映射到 `AgentV2.Info`
- [ ] 同名 file 覆盖 code 注册
- [ ] body → system prompt
- [ ] 文件增删改后自动刷新

### Phase 3 — Handoff
- [ ] `.agent.md` 中声明 `handoffs` → agent 运行时可见切换按钮
- [ ] 点击 handoff → 创建新 agent 会话 + 自动发送 prompt
- [ ] timeline 中可见切换提示
- [ ] app + TUI 双端支持

### Phase 4 — MCP Contributor
- [ ] `registerClaudeMcpServerContributor` → McpV2 中可用
- [ ] 示例 `IdeMcpServerContributor` 正常暴露 getDiagnostics 工具

### Phase 5 — 热检测
- [ ] CLAUDE.md 变更 → session restart with resume
- [ ] agents 目录变更 → session restart
- [ ] 未变更时零开销

### Phase 6 — Intent 工具裁剪
- [ ] `code_understanding` → 只返回只读工具
- [ ] `code_modification` → 返回全部工具
- [ ] 不传 intent 时 behavior 不变

---

## 10. 工时汇总

| Phase | 内容 | 工时 | 并行 |
|---|---|---|---|
| Phase 1 | PreToolUse 钩子 + ToolHandler | 1.5 天 | — |
| Phase 2 | `.agent.md` 声明式 Agent | 2 天 | ✅ 与 Phase 4 并行 |
| Phase 3 | Handoff 机制 | 2.5 天 | 依赖 Phase 2 |
| Phase 4 | MCP Contributor | 1.5 天 | ✅ 与 Phase 2 并行 |
| Phase 5 | CLAUDE.md 热检测 | 1.5 天 | 独立 |
| Phase 6 | INTENT_TOOL_FILTERS | 1 天 | 依赖 Phase 1 |
| **总计** | | **10 天** | |

> **审批通过后**: 按依赖顺序执行。Phase 1 最先（安全底线），Phase 2 + Phase 4 可并行启动。分支命名按具体 Phase：`pre-tool-hooks` / `agent-file-loader` / `handoff-mechanism` / `mcp-contributor` / `hot-reload-config` / `intent-tool-filters`。

---

## 11. 审批结论

> **状态**: 有条件通过 ✅
> **审批人**: 高级全栈开发顾问
> **日期**: 2026-07-10
> **依据**: [CLAUDE.md](../../CLAUDE.md)、[AGENTS.md](../../AGENTS.md)、[ARCHITECTURE.md](../../ARCHITECTURE.md)、[DESIGN.md](../../DESIGN.md)、`packages/aigcfroge/AGENTS.md`、`packages/llm/AGENTS.md`、`.aigcfroge/skills/effect/SKILL.md`、`.aigcfroge/skills/database/SKILL.md`

### 11.1 总体评价

本方案方向正确，借鉴 VS Code Copilot 的成熟设计补齐 AigcForge 元智能体在声明式 Agent、Handoff、Tool 权限、配置热检测、MCP 扩展性、PreToolUse/PostToolUse 六个维度的能力，符合产品成熟度演进路径。方案分层清晰、依赖合理、风险可控，已具备进入实施的条件。

### 11.2 关键发现：计划与现状的差异

在实施前必须对齐以下现状，避免重复建设或错误假设：

1. **Phase 1 的 PreToolUse/PostToolUse 并非完全空壳**
   - `packages/core/src/tool/lifecycle-hooks.ts` 已实现 `registerPreToolUse` / `registerPostToolUse` / `runPreToolUse` / `runPostToolUse`，支持顺序执行、deny 短路、独立 after hook。
   - `packages/core/src/plugin/host.ts` 的 `meta.transform` 已将 `MetaDraft.middleware.register` 的 `preToolUse` / `postToolUse` 注册到上述 hooks。
   - **计划修正**: Phase 1.1 的重点应从"新建"改为"补全与固化"——补充测试、处理多 hook 异常失败、确保 Catch Everything；`intent.register` 和 `adapter.register` 当前仍是空壳，但不在本方案核心路径，可保留 TODO。

2. **Phase 6 的 INTENT_TOOL_FILTERS 已实质接线**
   - `packages/core/src/tool/registry.ts` 的 `materialize(permissions, intent)` 已读取 intent 并应用 `INTENT_TOOL_FILTERS`。
   - `packages/core/src/session/runner/llm.ts` 已通过 `classify()` 推导 `IntentCategory` 并传入 `materialize(intent)`。
   - **计划修正**: Phase 6 的"工时 1 天"应主要用于**补测试**和**验证行为不变性**，而非重新接线。建议将 Phase 6 的测试文件（`tool-registry-intent.test.ts`、`session-runner-intent.test.ts`）前置到 Phase 1 之后立即执行，以确认当前行为基线。

3. **`AgentV2.Info` 尚无 `handoffs` 字段**
   - `packages/schema/src/agent.ts` 的 `Agent.Info` 未定义 `handoffs`。
   - **强制要求**: Phase 3.1 / Phase 3.2 必须使用 `Schema.Class` 或 `Schema.Struct` 扩展 schema，并同步更新 `Info.empty` 的默认值。

4. **`McpV2.Service` 当前为最小接口**
   - `packages/core/src/mcp/mcp-v2.ts` 只有接口和 `noopLayer`，真实 MCP 实现在 `packages/aigcfroge/src/mcp/`。
   - **架构要求**: `IClaudeMcpServerContributor` 接口可放在 core，但 contributor 注册表的初始化调用应在 aigcfroge 的 MCP 初始化路径中完成，避免 core 层反向依赖 aigcfroge。

5. **`packages/schema` 与 `packages/plugin` 无独立 test 脚本**
   - `packages/schema/package.json` 和 `packages/plugin/package.json` 均未定义 `test` 脚本，且无 `test/` 目录；`packages/app` 的测试位于 `src/` 目录下并使用 `happydom.ts` preload。
   - **测试策略修正**: `Handoff` schema 测试放在 `packages/core/test/handoff-schema.test.ts`；`MetaDraft.middleware` 测试放在 `packages/core/test/plugin-host-meta-hooks.test.ts`；app UI 测试放在 `packages/app/src/components/session/handoff-button.test.tsx`；aigcfroge 层测试按子目录放置（如 `packages/aigcfroge/test/agent/v2-file-merge.test.ts`、`packages/aigcfroge/test/mcp/ide-contributor.test.ts`）。

6. **CLAUDE.md / agents 路径与 AigcForge 配置目录不一致**
   - 计划中的路径是 `~/.claude/CLAUDE.md`、`{workspace}/.claude/agents/*.md`，而 `Global.Path.config` 指向 `~/.config/aigcfroge/`，现有配置搜索的是 `.aigcfroge/` 目录。
   - 现有 agent prompt（`packages/core/src/plugin/agent.ts`）已提到 `~/.claude/CLAUDE.md`，说明产品意图兼容 Claude Code 路径。
   - **决策要求**: Phase 2 / Phase 5 实施前必须明确路径映射策略——是同时监听 `~/.claude/` 和 `~/.config/aigcfroge/` 两套路径，还是将 `~/.claude/` 映射为 AigcForge 配置目录的别名。建议通过 `Global.Service` + `Location.Service` 提供统一解析接口，避免在 `AgentFileLoader` / `FileChangeTracker` 中硬编码两套路径。

### 11.3 强制性修正项（必须执行）

| # | 修正项 | 原因 | 归属 Phase |
|---|---|---|---|
| 1 | 所有新增模块先写测试后写实现 | 用户明确要求的 TDD 流程；降低回归风险 | 全 Phase |
| 2 | `Handoff` schema 必须使用 Effect `Schema.Class` / `Schema.Struct`，错误用 `Schema.TaggedErrorClass` | 符合 AGENTS.md Schema 规范 | P3.1 |
| 3 | `AgentV2.Info` 增加 `handoffs` 字段时必须同步更新 `Info.empty` 和现有测试 | 避免 schema 变更破坏既有测试和运行时 | P3.2 |
| 4 | `ToolPermissionHandler` 必须与现有 `PermissionV2` 的 allow/deny/ask 三态语义兼容；handler 返回 `ask` 时必须复用 `PermissionV2.assert` 进行用户确认，禁止绕过或削弱既有权限流程 | 不能破坏现有 allow/deny/ask 三态语义 | P1.2 |
| 5 | `FileChangeTracker` 必须使用 Effect 平台抽象（`FileSystem` / `Path` / `Clock`），禁止裸 `fs.watch` | 符合 Effect 编码规范和可测试性 | P5.1 |
| 6 | `AgentFileLoader` 必须纯 core 层实现，file > code 合并逻辑放在 aigcfroge 层；文件读取走 `FileSystem`，文件监听复用现有 `FileWatcher.Service` 的 `file.watcher.updated` 事件（基于 `@parcel/watcher`），禁止裸 `fs.watch` | 符合架构边界和 Effect 编码规范 | P2.1/P2.2 |
| 7 | 新增 feature flag 应追加到 `packages/core/src/flag/flag.ts` 的 `Flag` 对象中统一管理；禁止新增散落的 `process.env` 直接读取（遗留读取不顺手重构） | 便于统一管理和测试切换 | 全 Phase |

### 11.4 建议优化项

1. **Phase 1.2 的 `BashHandler` 示例不要过于复杂** — 先实现"白名单路径 auto-approve，其余 ask"即可，5 分钟缓存可作为 Phase 2 增强。
2. **Phase 5 热检测的实现** — 建议复用现有 `FileWatcher.Service` 监听 `file.watcher.updated` 事件来驱动 `FileChangeTracker`，避免重新实现文件监听；触发时机放在 `SessionRunner.run` 的 while 循环入口，而非每个 turn 中间，避免中断正在执行的 provider turn。
3. **Phase 3 Handoff UI** — app 和 TUI 两端先共用 Handoff 数据结构，渲染层可分别实现，避免 UI 逻辑耦合到 core。
4. **Phase 4 MCP Contributor** — 先实现静态注册表和单个示例，动态 contributor 发现可作为后续迭代。
5. **测试覆盖** — 建议每个 Phase 提交 PR 时附带 `git diff --stat` 和测试运行截图/输出，便于代码审查。

### 11.5 风险提醒

- **最大风险**: Handoff 切换时上下文摘要的 token 边界和 prompt 注入安全，需要专门测试防止 prompt injection。
- **次大风险**: `ToolPermissionHandler` 如果实现不当，可能绕过现有 `PermissionV2` 的 ask/deny 规则，导致未授权执行工具。必须保证无 handler 时 100% fallback 到现有规则。
- **测试风险**: Phase 6 的 runner intent 测试需要构造完整 Session 上下文，建议复用 `session-runner-tool-registry.test.ts` 的 fixture 模式。

### 11.6 下一步行动

1. 按本文档第 6 节测试策略，为 Phase 1 新建测试文件并运行确认失败。
2. 根据第 11.2 节修正 Phase 1 / Phase 6 的基线认知，更新任务描述。
3. 创建分支 `pre-tool-hooks`，开始 Phase 1 实施。
4. 每个 Phase 完成后输出 CLAUDE.md 要求的复查结论模板。

---

**审批签字**: 本计划经补充测试策略和强制性修正项后，准予进入实施阶段。
