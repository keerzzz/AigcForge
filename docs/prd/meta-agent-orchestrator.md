# Meta-Agent Orchestrator PRD

> 状态：DRAFT v0.1
> 创建：2026-06-29
> 来源对话：智能体架构调研 + 三仓库对照分析

---

## 1. 背景与目标

### 1.1 问题

当前系统有 7 个内置智能体（build/plan/general/explore/compaction/title/summary），但：

- 用户必须**手动选择**智能体，系统没有统一的入口层
- 无法**并行或编排**多个智能体协同工作
- 不支持**外部 CLI 智能体**（Claude Code、Codex、Gemini 等）
- 没有**工作流**概念（plan → build → review 的流水线）
- 无法在对话中**@mention** 特定智能体分配任务

### 1.2 目标

构建一个**元智能体编排层**，作为用户与所有智能体之间的统一入口，具备：

1. **统一入口** — 所有对话通过元智能体，用户不与子智能体直接对话
2. **意图分类** — 分析用户需求，判断类型和复杂度
3. **智能路由** — 根据意图分发到最合适的子智能体或外部 CLI
4. **并行分发** — 支持 `@mention` 语法同时调度多个智能体
5. **工作流引擎** — 串行 pipeline（plan→build→review）和并行 fan-out
6. **全权限兜底** — 元智能体自身拥有全权限，必要时直接执行
7. **CLI 适配器** — 对接 claude-code、codex、gemini 等外部 CLI
8. **CLI 发现** — 扫描系统可用的 CLI 智能体，用户设置页开关控制
9. **缓存极致优化** — L1/L2/L3 三级缓存策略
10. **插件系统** — 可扩展的插件接口，支持 chat 模式生成插件

### 1.3 非目标

- 不替代现有子智能体的独立执行路径（build/plan 等仍可单独使用）
- 不改变现有权限系统架构
- 不引入新的技术栈（全部基于 Effect-TS + Schema）

---

## 2. 架构概览

### 2.1 整体架构

```
┌──────────────────────────────────────────────────────────┐
│                       用户 (唯一入口)                       │
└────────────────────────┬─────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────┐
│                   Meta Agent (编排层)                      │
│                                                           │
│  System Prompt ┌──── L1 恒定区 ────┬── L2 会话区 ──┬── L3 动态区 │
│                │ 角色定义/路由框架   │ 可用CLI列表    │ 对话上下文   │
│                │ 不变规则          │ 子智能体列表   │ 委派历史     │
│                │ (字节级锁定前缀)   │ (会话启动时固定)│ (每次变化)   │
│                └──────────────────┴───────────────┴────────────┘
│                         │
│  Intent Classifier ──── 正则分类器 (插件可扩展)
│                         │
│  Engine Selector ────── 子智能体 / CLI / 工作流
│                         │
│  Workflow Engine ────── 串行 pipeline / 并行 fan-out
│                         │
│  Task Dispatcher ────── task 工具 + cache-warmth + 错误策略
│                         │
│  Result Collector ───── 汇总 → 摘要 → 呈现
│                                                           │
│  权限: 全权限 (兜底执行)                                    │
└────────────────────────┬─────────────────────────────────┘
                         │
    ┌────────────────────┼────────────────────┐
    │                    │                    │
    ▼                    ▼                    ▼
┌──────────┐      ┌──────────┐      ┌──────────────┐
│ 子智能体   │      │ 子智能体   │      │ 外部 CLI     │
│ build    │      │ explore  │      │ claude-code  │
│ plan     │      │ general  │      │ gemini       │
│ ...      │      │ ...      │      │ codex        │
└──────────┘      └──────────┘      └──────────────┘
                         │
┌────────────────────────▼─────────────────────────────────┐
│                   插件系统 (Plugin System)                  │
│  agent · aisdk · catalog · command · skill · meta(NEW)   │
│  meta.intent · meta.adapter · meta.workflow               │
│  meta.middleware · meta.policy                            │
└──────────────────────────────────────────────────────────┘
```

### 2.2 来源分析

本架构综合三个仓库的最佳实践：

| 模块         | 来源仓库         | 借鉴内容                                 |
| ------------ | ---------------- | ---------------------------------------- |
| 元智能体定义 | `/web/aigcfroge` | meta-agent.ts、meta.txt 系统提示模式     |
| 意图分类     | `/web/aigcfroge` | intent.ts 正则分类器                     |
| 引擎路由     | `/web/aigcfroge` | engine-selector.ts 调度映射              |
| CLI 适配器   | `/web/aigcfroge` | CliAdapter 接口 + claude-code/codex 实现 |
| 缓存预热     | `/web/aigcfroge` | cache-warmth.ts 三区缓存 + SHA 追踪      |
| 委派上下文   | `/web/aigcfroge` | ContextBuilder + dialog-context.txt      |
| 并行分发     | `/cc`            | AgentTool 并行 spawn + 协调器模式        |
| 系统提示缓存 | `/cc`            | 分叉子智能体字节级前缀锁定的方法         |
| 会话复用     | 当前项目         | task.ts 的 task_id 复用                  |
| 子智能体权限 | 当前项目         | deriveSubagentSessionPermission          |
| 全权限兜底   | 当前项目         | build agent 的全权限模型                 |

---

## 3. 详细设计

### 3.1 元智能体定义

新增 `packages/aigcfroge/src/agent/meta-agent.ts`，基于 build agent 的全权限基座：

```ts
// 元智能体权限：全权限 = build 的权限 + 编排相关工具
export const permission = Permission.merge(
  buildPermissions,
  Permission.fromConfig({
    task: "allow", // 委派任务
    question: "allow", // 询问用户
    write: "allow", // 直接写文件 (AGENTS.md, 插件等)
    create_command: "allow",
    create_agent: "allow",
    configure_mcp: "allow",
    create_workflow: "allow",
  }),
)
```

#### 与 `/web/aigcfroge` 的 key 区别

```
/web/aigcfroge 的 meta:                     我们的 meta:
  bash: deny  (不能执行代码)                    bash: allow (全权限兜底)
  read: deny                                   read: allow
  edit: deny                                   edit: allow
  glob: deny                                   glob: allow
  grep: deny                                   grep: allow
  task: allow (必须委派)                        task: allow (优先委派, 必要时自干)
```

行为模式不同：**委派优先，兜底自干**。而非"必须委派，绝不执行"。

### 3.2 意图分类器

**位置**：`packages/aigcfroge/src/agent/meta/intent.ts`

**分类维度**：

| 类别                 | 触发模式                                     | 默认路由             |
| -------------------- | -------------------------------------------- | -------------------- |
| `content_creation`   | `create/generate/write/make/生成/创建`       | lightweight          |
| `code_understanding` | `explain/how/what/why/解释/怎么`             | explore              |
| `code_modification`  | `refactor/fix/add/change/重构/修复`          | build                |
| `configuration`      | `configure/setup/connect/agent/mcp/workflow` | general              |
| `workflow`           | `先...然后.../pipeline/工作流/并行/同时`     | workflow engine      |
| `@mention`           | `@claude-code @gemini @build`                | 显式指定目标         |
| `unknown`            | 以上都不匹配                                 | 元智能体自处理或询问 |

**插件扩展**：`plugin.meta.intent.register(pattern, category)` — 注册新的分类规则。

### 3.3 引擎选择器

**位置**：`packages/aigcfroge/src/agent/meta/engine-selector.ts`

```typescript
interface EngineDispatch {
  type: "subagent" | "external-cli" | "workflow"
  target: string
}

const ENGINE_DISPATCH: Record<string, EngineDispatch> = {
  content_creation: { type: "subagent", target: "lightweight" },
  code_understanding: { type: "subagent", target: "explore" },
  code_modification: { type: "subagent", target: "build" },
  configuration: { type: "subagent", target: "general" },
  "claude-code": { type: "external-cli", target: "claude-code" },
  gemini: { type: "external-cli", target: "gemini" },
  codex: { type: "external-cli", target: "codex" },
}
```

### 3.4 @mention 解析器

**位置**：`packages/aigcfroge/src/agent/meta/mention.ts`

解析用户输入中的 `@name` 语法：

```typescript
// 输入: "@claude-code 分析内存泄漏, @gemini 检查类型安全"
// 输出:
[
  { target: "claude-code", type: "external-cli", prompt: "分析内存泄漏" },
  { target: "gemini",      type: "external-cli", prompt: "检查类型安全" },
]

// 输入: "先 @plan 写方案，然后 @build 实现"
// 输出:
{
  workflow: "pipeline",
  steps: [
    { target: "plan", type: "subagent", prompt: "写方案" },
    { target: "build", type: "subagent", prompt: "实现" },
  ]
}
```

### 3.5 工作流引擎

**位置**：`packages/aigcfroge/src/agent/meta/workflow.ts`

支持两种模式：

| 模式          | 语法                  | 语义                             | 实现                                         |
| ------------- | --------------------- | -------------------------------- | -------------------------------------------- |
| 并行          | `@A @B 同时...`       | 同时分发，各自执行，结果汇总     | 多个 `task()` 同时发起，用 `Effect.all` 等待 |
| 串行 pipeline | `先 @A 再 @B 最后 @C` | 按序执行，前一步输出是后一步输入 | `Effect.flatMap` 链或状态机                  |

**工作流状态**：每个工作流有独立的 `WorkflowState` 跟踪：

```typescript
interface WorkflowState {
  id: string
  status: "running" | "completed" | "failed"
  steps: WorkflowStep[]
  results: Map<string, StepResult>
  createdAt: number
}
```

### 3.6 CLI 适配器 & 发现

#### CLI 适配器接口

**位置**：`packages/aigcfroge/src/agent/meta/adapters/interface.ts`

```typescript
interface CliAdapter {
  readonly name: string
  readonly command: string
  readonly detect: () => Effect<boolean> // 系统是否有这个 CLI
  readonly buildArgs: (input: { prompt: string; cwd: string }) => Effect<readonly string[]>
  readonly parseOutput: (stdout: string, stderr: string) => Effect<DelegationResult>
  readonly cancel?: (cwd: string) => Effect<void> // 可选中断
  readonly timeout?: number // 可选超时 (ms)
}

interface DelegationResult {
  status: "success" | "partial" | "failed"
  summary: string
  files?: { created?: string[]; modified?: string[]; deleted?: string[] }
  errors?: string[]
}
```

#### CLI 发现机制

**位置**：`packages/aigcfroge/src/agent/meta/adapters/registry.ts`

- 启动时扫描：对已注册的适配器调用 `detect()`，记录可用性
- 用户配置开关：在设置页勾选哪些 CLI 可用
- 动态注册：插件可以注册新的适配器

内置适配器（第一阶段）：

| CLI         | 命令     | 默认启用        |
| ----------- | -------- | --------------- |
| Claude Code | `claude` | 若检测到        |
| Gemini CLI  | `gemini` | 若检测到 (TODO) |
| Codex       | `codex`  | 若检测到 (TODO) |

**插件扩展**：`plugin.meta.adapter.register(name, factory)` — 注册新的 CLI 适配器。

### 3.7 缓存策略 (L1/L2/L3)

#### L1: 绝对稳定区 — 系统提示前缀

```typescript
// system prompt 结构 (字节级顺序固定):

// ═══════════════ L1: 100% 恒定 ═══════════════
const L1_STABLE = `
你是 AigcForge 元智能体 — 统一编排入口。

你的角色:
- 理解用户意图
- 拆解任务，选择最合适的执行引擎
- 通过 task 工具委派给子智能体或外部 CLI
- 汇总委派结果给用户

规则:
- 委派优先: 代码执行优先通过 task 委派
- 兜底执行: 必要时可直接使用所有工具
- 保持回应简短 — 你的工作是路由，不是创作
- 委派完成后，用 1-3 句摘要呈现结果
`

// ═══════════════ L2: 会话级固定 ═══════════════
const L2_SESSION = `
可用子智能体:
{{SUBAGENTS_LIST}}

可用 CLI 智能体:
{{CLI_AGENTS_LIST}}

工作流模板:
{{WORKFLOW_TEMPLATES}}
`

// ═══════════════ L3: 动态 ═══════════════
const L3_DYNAMIC = `
当前上下文:
{{RECENT_CONTEXT}}
`
```

**L2 在会话启动时渲染一次**，在会话生命周期内不变，通过 `{{placeholder}}` 在最后注入，不破坏 L1 前缀。

#### 缓存预热 (cache-warmth)

参考 `/web/aigcfroge` 的 cache-warmth.ts，跟踪：

```typescript
interface CacheWarmthEntry {
  engineId: string
  lastContextSha: string // 上下文哈希，用于比较缓存是否有效
  lastUsed: number // last used timestamp
  hitRate: number // 命中率 (0-1)
  taskCategory: IntentCategory // 按分类统计
}
```

策略：

- 当 `hitRate > 0.5` 时在委派上下文中加入 `<cache-warm/>` 信号
- 基于意图分类**预测下一引擎**，在等待用户输入时预构造上下文
- 字节级前缀锁定：system prompt 的 L1 区**任何情况下不允许动态内容**

### 3.8 插件系统扩展

#### 新增 `MetaHooks`

在 `packages/plugin/src/v2/effect/context.ts` 的 `PluginContext` 中新增：

```typescript
interface MetaHooks {
  /** 注册新的意图分类规则 */
  intent: (pattern: RegExp, category: IntentCategory) => Effect<Registration, never, Scope>

  /** 注册新的 CLI 适配器 */
  adapter: (name: string, factory: CliAdapterFactory) => Effect<Registration, never, Scope>

  /** 注册工作流模板 */
  workflow: (name: string, template: WorkflowTemplate) => Effect<Registration, never, Scope>

  /** 注册编排中间件 (拦截/dispatch/审计) */
  middleware: (hook: MetaMiddlewareHook) => Effect<Registration, never, Scope>

  /** 注册编排策略规则 */
  policy: (rule: MetaPolicy) => Effect<Registration, never, Scope>
}
```

#### 插件示例

```typescript
// 审计插件: 每次 dispatch 记录日志
define({
  id: "audit-logger",
  effect: (ctx) =>
    Effect.gen(function* () {
      yield* ctx.meta.middleware({
        name: "audit",
        onDispatch: (input) =>
          Effect.gen(function* () {
            yield* log(`[AUDIT] dispatch: ${input.target} - ${input.prompt}`)
          }),
      })
    }),
})

// Gemini 适配器插件
define({
  id: "gemini-adapter",
  effect: (ctx) =>
    Effect.gen(function* () {
      yield* ctx.meta.adapter.register("gemini", () => GeminiAdapter)
    }),
})

// Code review 工作流插件
define({
  id: "code-review-workflow",
  effect: (ctx) =>
    Effect.gen(function* () {
      yield* ctx.meta.workflow.register("code-review", {
        name: "代码审查",
        steps: [
          { target: "plan", prompt: "审查代码变更计划" },
          { target: "build", prompt: "执行必要的修改" },
          { target: "explore", prompt: "验证修改正确性" },
        ],
        mode: "pipeline",
      })
    }),
})
```

### 3.9 Chat 模式生成插件

分阶段实现：

| 阶段 | 能力                          | 用户交互                                            |
| ---- | ----------------------------- | --------------------------------------------------- |
| P1   | 通过对话描述 → 生成插件配置   | 元智能体生成 `.md` 插件定义，写入 `config/plugins/` |
| P2   | 生成后 → 自动加载 & 可用      | 插件写入后热加载生效                                |
| P3   | 生成 → 测试沙箱 → 验证 → 上线 | 插件先加载到沙箱环境测试，通过后正式注册            |

### 3.10 错误处理策略

| 错误场景         | 策略                                                    |
| ---------------- | ------------------------------------------------------- |
| 子智能体执行失败 | 元智能体收到 `<task-error>` → 判断是否重试 or 换引擎    |
| 外部 CLI 超时    | `CliAdapter.timeout` 配置 → 超时后 kill 进程 → 报告失败 |
| 外部 CLI 不可用  | `detect()` 返回 false → 从可用列表移除 → 推荐替代       |
| 工作流某步骤失败 | 跳过后续步骤 → 报告部分完成 → 用户决定是否继续          |
| 元智能体自身中断 | 子任务继续后台执行（后台模式）或 一并取消（前台模式）   |

---

## 4. 分阶段实施路线图

### 阶段 1：元智能体基础 (MVP)

**目标**：元智能体作为默认入口，能分类意图、路由到子智能体、支持 `@mention`

| 编号 | 任务                                     | 影响文件                                               | 预估复杂度 |
| ---- | ---------------------------------------- | ------------------------------------------------------ | ---------- |
| 1.1  | 创建 `meta/` 目录和 intent.ts 分类器     | `packages/aigcfroge/src/agent/meta/intent.ts`          | S          |
| 1.2  | 创建 engine-selector.ts 路由             | `packages/aigcfroge/src/agent/meta/engine-selector.ts` | S          |
| 1.3  | 创建 mention.ts @mention 解析            | `packages/aigcfroge/src/agent/meta/mention.ts`         | M          |
| 1.4  | 创建 meta-agent.ts 定义                  | `packages/aigcfroge/src/agent/meta-agent.ts`           | M          |
| 1.5  | 创建 meta.txt 系统提示（L1+L2 缓存结构） | `packages/aigcfroge/src/agent/prompt/meta.txt`         | M          |
| 1.6  | 在 Agent 注册表中注册元智能体            | `packages/aigcfroge/src/agent/agent.ts`                | S          |
| 1.7  | 改默认智能体为 meta                      | `packages/core/src/plugin/agent.ts`                    | S          |
| 1.8  | 扩展 `deriveSubagentSessionPermission`   | `packages/aigcfroge/src/agent/subagent-permissions.ts` | S          |
| 1.9  | L1/L2 缓存结构实现                       | `packages/aigcfroge/src/agent/meta/cache-warmth.ts`    | M          |

**验证标准**：

- 新会话默认使用 meta agent
- meta agent 能分类意图并路由到正确的子智能体
- `@build xxx` 能直接转发到 build
- L1 system prompt 前缀字节级锁定（写测试验证）

### 阶段 2：外部 CLI 集成

**目标**：元智能体可以调用外部 CLI 智能体

| 编号 | 任务                        | 影响文件                                                    | 预估复杂度 |
| ---- | --------------------------- | ----------------------------------------------------------- | ---------- |
| 2.1  | CLI 适配器接口              | `packages/aigcfroge/src/agent/meta/adapters/interface.ts`   | S          |
| 2.2  | Claude Code 适配器          | `packages/aigcfroge/src/agent/meta/adapters/claude-code.ts` | M          |
| 2.3  | 适配器注册表                | `packages/aigcfroge/src/agent/meta/adapters/registry.ts`    | M          |
| 2.4  | CLI 扫描 & detect()         | `packages/aigcfroge/src/agent/meta/adapters/scanner.ts`     | M          |
| 2.5  | 扩展 task 工具支持 CLI 模式 | `packages/aigcfroge/src/tool/task.ts`                       | L          |
| 2.6  | CLI 超时 & 中断处理         | `packages/aigcfroge/src/agent/meta/adapters/timeout.ts`     | M          |

**验证标准**：

- 系统有 `claude` 命令时，元智能体能检测到并路由给它
- `@claude-code xxx` 启动 Claude Code 子进程并返回结果
- 超时能中断外部 CLI 进程

### 阶段 3：工作流引擎

**目标**：支持并行和串行工作流

| 编号 | 任务                      | 影响文件                                                 | 预估复杂度 |
| ---- | ------------------------- | -------------------------------------------------------- | ---------- |
| 3.1  | 工作流状态管理            | `packages/aigcfroge/src/agent/meta/workflow/state.ts`    | M          |
| 3.2  | 串行 pipeline 执行器      | `packages/aigcfroge/src/agent/meta/workflow/pipeline.ts` | M          |
| 3.3  | 并行 fan-out 执行器       | `packages/aigcfroge/src/agent/meta/workflow/fanout.ts`   | M          |
| 3.4  | 工作流系统提示表述        | `packages/aigcfroge/src/agent/prompt/meta.txt` (更新)    | S          |
| 3.5  | `@mention` 工作流解析增强 | `packages/aigcfroge/src/agent/meta/mention.ts`           | S          |

**验证标准**：

- `先 @plan 设计方案，再 @build 实现` 能按序执行
- `@claude-code 分析, @gemini 检查(同时)` 能并行分发
- 工作流步骤失败能正确处理

### 阶段 4：插件系统扩展

**目标**：完整的 meta 插件扩展点 + chat 模式生成

| 编号 | 任务                              | 影响文件                                    | 预估复杂度 |
| ---- | --------------------------------- | ------------------------------------------- | ---------- |
| 4.1  | 新增 `MetaHooks` 到 PluginContext | `packages/plugin/src/v2/effect/context.ts`  | M          |
| 4.2  | 实现 meta.intent 注册             | `packages/plugin/src/v2/effect/meta.ts`     | M          |
| 4.3  | 实现 meta.adapter 注册            | `packages/plugin/src/v2/effect/meta.ts`     | M          |
| 4.4  | 实现 meta.workflow 注册           | `packages/plugin/src/v2/effect/meta.ts`     | M          |
| 4.5  | 实现 meta.middleware 注册         | `packages/plugin/src/v2/effect/meta.ts`     | M          |
| 4.6  | 实现 meta.policy 注册             | `packages/plugin/src/v2/effect/meta.ts`     | M          |
| 4.7  | Chat 模式生成插件 — 基础          | 元智能体生成插件 .md 写入 `config/plugins/` | L          |
| 4.8  | 插件热加载                        | 插件文件变更 → 自动注册                     | L          |

**验证标准**：

- 插件能注册新的意图分类规则
- 插件能注册新的 CLI 适配器
- 插件能注册工作流模板
- 插件 middleware 能拦截 dispatch 事件
- Chat 生成的插件能写入并生效

### 阶段 5：优化 & 完善

**目标**：缓存优化、审计、文档

| 编号 | 任务                                    | 影响文件                                               | 预估复杂度 |
| ---- | --------------------------------------- | ------------------------------------------------------ | ---------- |
| 5.1  | cache-warmth 全面集成                   | `packages/aigcfroge/src/agent/meta/cache-warmth.ts`    | M          |
| 5.2  | `meta_agent_session` 表集成（层级会话） | `packages/core/src/meta-agent/`                        | L          |
| 5.3  | Gemini CLI 适配器                       | `packages/aigcfroge/src/agent/meta/adapters/gemini.ts` | M          |
| 5.4  | Codex CLI 适配器                        | `packages/aigcfroge/src/agent/meta/adapters/codex.ts`  | M          |
| 5.5  | Chat 生成插件 → 沙箱测试                | P3 完善                                                | L          |
| 5.6  | 用户设置页 CLI 开关集成                 | `packages/app/` + `packages/server/`                   | M          |
| 5.7  | 审计日志 & telemetry                    | `packages/core/src/agent/meta/audit.ts`                | M          |

---

## 5. 关键设计决策

### 5.1 为什么元智能体要全权限

与 `/web/aigcfroge` 的 meta（拒绝所有代码工具）不同，我们的元智能体是全权限的。理由：

1. **兜底执行**：当子智能体不可用或任务足够简单时，元智能体可以直接执行
2. **单一会话**：简化用户心智模型 — "我只需要和元智能体对话"
3. **插件生成**：写插件文件需要 Write 权限

**行为约定**（通过系统提示约束，而非权限硬限制）：

- 委派优先：99% 的代码执行通过 task 委派
- 兜底自干：仅在子智能体不可用或任务足够简单时直接执行

### 5.2 为什么在 packagages/aigcfroge/ 层实现

当前项目的架构是分层的：

| 层                    | 用途         | 内容                                  |
| --------------------- | ------------ | ------------------------------------- |
| `packages/schema/`    | 数据类型定义 | meta-agent.ts (已有)                  |
| `packages/core/`      | 核心服务     | AgentV2, plugin, meta-agent sql       |
| `packages/aigcfroge/` | 应用逻辑     | Agent 服务, Tool 注册表, Session 处理 |

元智能体的编排逻辑属于**应用层行为**（因为它依赖 Tool 注册表、Session 系统、子智能体定义），所以放在 `packages/aigcfroge/src/agent/meta/` 最合理。`packages/core/` 中的 `meta-agent/sql.ts` 作为数据层支持。

### 5.3 为什么第一阶段走平面会话

`meta_agent_session` 表已经支持层级会话，但第一阶段使用平面会话（子任务作为 tool_call 记录在主会话中）。理由：

1. 现有 `task.ts` 直接用，零改造
2. 复杂度最低，快速验证元智能体的编排价值
3. 数据表已经准备好，未来随时可以升级
4. 断点恢复可以先做"恢复整个会话"再做"按子任务恢复"

---

## 6. 参考文档

- [系统蓝图](../architecture/system-blueprint.md)
- [Agent 实现](../../packages/aigcfroge/src/agent/agent.ts)
- [Task 工具](../../packages/aigcfroge/src/tool/task.ts)
- [插件上下文](../../packages/plugin/src/v2/effect/context.ts)
- [/web/aigcfroge meta-agent](../../../web/aigcfroge/packages/opencode/src/agent/meta-agent.ts) (外部参考)
- [/web/aigcfroge intent.ts](../../../web/aigcfroge/packages/opencode/src/agent/meta/intent.ts) (外部参考)
- [/web/aigcfroge engine-selector.ts](../../../web/aigcfroge/packages/opencode/src/agent/meta/engine-selector.ts) (外部参考)
- [/web/aigcfroge CliAdapter](../../../web/aigcfroge/packages/opencode/src/agent/meta/adapters/interface.ts) (外部参考)
- [/cc 协调器模式](../../../cc/src/coordinator/coordinatorMode.ts) (外部参考)
