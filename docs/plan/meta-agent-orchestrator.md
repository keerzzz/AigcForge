# Meta-Agent Orchestrator — Implementation Plan

> 状态：READY（审计通过，v1.1 修复版）
> 分支：`meta-agent-orchestrator`
> 目标版本：v0.1.0
> PRD 参考：`docs/prd/meta-agent-orchestrator.md`
> 审计日期：2026-06-29（6 阻塞 + 7 重要问题已修复）

---

## 开发方式说明

**meta agent 不是"复制 build agent 的代码"。**

| 策略                       | 操作                                                                                                                                 | 涉及的当前项目代码                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| **现有架构内新建 Agent**   | 在 `agent.ts` 注册表新增 `meta` 条目，与 `build`/`plan`/`general` 平级                                                               | `agent/agent.ts` — 注册表扩展                               |
| **权限继承**               | 复用 build 的权限基座（全工具 allow 的 `defaults`），叠加编排工具特权                                                                | `agent/agent.ts` — `Permission.merge(defaults, metaExtras)` |
| **全新编排能力**           | intent.ts、engine-selector.ts、mention.ts 等均为全新代码，build 不具备                                                               | 所有 `agent/meta/*.ts` — 全新文件                           |
| **模式移植（非代码拷贝）** | 从 `/web/aigcfroge` 移植架构模式（意图分类、CLI 适配器），从 `/cc` 移植协调器模式，全部适配为当前项目的 Effect/Schema 版本和模块约定 | 无外部代码直接引用                                          |

```
meta agent = build 的权限基座 + 编排能力(新建) + 模式移植(翻译适配)
                    ↑ 继承                      ↑ /web/aigcfroge + /cc
```

---

## 执行协议

实现者必须先通读以下文档再开始编码：

1. `CLAUDE.md` — 项目宪法（八荣八耻、四大拒绝、改完即审流程）
2. `AGENTS.md` — 代码风格（import 规则、Effect 模式、schema 约定）
3. `DESIGN.md` — 如果涉及 UI 改动
4. `docs/architecture/system-blueprint.md` — 架构总览
5. `docs/prd/meta-agent-orchestrator.md` — 本功能 PRD
6. 本计划文档

**每个阶段完成后**必须执行自审（CLAUDE.md 第 7 步）并输出复查结论卡片。

**禁止跳阶段**。Phase 1 未完成验证不能进入 Phase 2。

**回退策略**：设置环境变量 `AIGCFROGE_DISABLE_META_AGENT=true` 回退默认 agent 为 `build`。P1 1.4.1 中实现。

---

## 总文件变更清单

| 操作         | 文件路径                                                                    | 阶段 | 用途                                   |
| ------------ | --------------------------------------------------------------------------- | ---- | -------------------------------------- |
| 新建         | `packages/aigcfroge/src/agent/meta-agent.ts`                                | P1   | 元智能体定义                           |
| 新建         | `packages/aigcfroge/src/agent/prompt/meta.txt`                              | P1   | 系统提示（L1/L2/L3 缓存结构）          |
| 新建         | `packages/aigcfroge/src/agent/meta/intent.ts`                               | P1   | 意图分类器                             |
| 新建         | `packages/aigcfroge/src/agent/meta/engine-selector.ts`                      | P1   | 引擎路由                               |
| 新建         | `packages/aigcfroge/src/agent/meta/mention.ts`                              | P1   | @mention 解析器                        |
| 新建         | `packages/aigcfroge/src/agent/meta/context-builder.ts`                      | P1   | 委派上下文构建器（C3 修复）            |
| 新建         | `packages/aigcfroge/src/agent/meta/cache-warmth.ts`                         | P1   | 缓存预热跟踪                           |
| 修改         | `packages/aigcfroge/src/agent/agent.ts`                                     | P1   | 注册 meta + 默认 agent 变更 + 回退开关 |
| 修改         | `packages/aigcfroge/src/agent/subagent-permissions.ts`                      | P1   | meta 的子智能体权限派生（C5 修复）     |
| 修改         | `packages/core/src/plugin/agent.ts`                                         | P1   | V2 系统 meta 注册                      |
| 新建         | `packages/aigcfroge/src/agent/meta/adapters/interface.ts`                   | P2   | CLI 适配器接口                         |
| 新建         | `packages/aigcfroge/src/agent/meta/adapters/delegation-parser.ts`           | P2   | CLI 输出解析工具（C2 修复）            |
| 新建         | `packages/aigcfroge/src/agent/meta/adapters/registry.ts`                    | P2   | 适配器注册表                           |
| 新建         | `packages/aigcfroge/src/agent/meta/adapters/scanner.ts`                     | P2   | CLI 扫描器                             |
| 新建         | `packages/aigcfroge/src/agent/meta/adapters/claude-code.ts`                 | P2   | Claude Code 适配器                     |
| 新建         | `packages/aigcfroge/src/agent/meta/adapters/timeout.ts`                     | P2   | 超时与错误处理框架（I1 整合）          |
| 修改         | `packages/aigcfroge/src/tool/task.ts`                                       | P2   | CLI 模式执行分支（C1 详细设计）        |
| 新建         | `packages/aigcfroge/src/agent/meta/workflow/state.ts`                       | P3   | 工作流状态管理                         |
| 新建         | `packages/aigcfroge/src/agent/meta/workflow/pipeline.ts`                    | P3   | 串行 pipeline 执行器                   |
| 新建         | `packages/aigcfroge/src/agent/meta/workflow/fanout.ts`                      | P3   | 并行 fan-out 执行器                    |
| 修改         | `packages/plugin/src/v2/effect/context.ts`                                  | P4   | PluginContext 新增 meta 域             |
| 新建         | `packages/plugin/src/v2/effect/meta.ts`                                     | P4   | MetaHooks 接口定义                     |
| 修改         | `packages/plugin/src/v2/effect/index.ts`                                    | P4   | 导出 MetaHooks                         |
| 新建         | `packages/aigcfroge/src/agent/meta/plugin-gen.ts`                           | P4   | Chat 模式生成插件                      |
| 新建         | `packages/aigcfroge/src/agent/meta/adapters/gemini.ts`                      | P5   | Gemini CLI 适配器                      |
| 新建         | `packages/aigcfroge/src/agent/meta/adapters/codex.ts`                       | P5   | Codex CLI 适配器                       |
| 修改         | `packages/aigcfroge/src/agent/meta/cache-warmth.ts`                         | P5   | 缓存增强                               |
| 新 migration | `packages/core/src/database/migration/<timestamp>_meta_agent_session_v2.ts` | P5   | meta_agent_session 扩展（C6 修复）     |
| 修改         | `packages/core/src/meta-agent/sql.ts`                                       | P5   | 扩展字段                               |

**已移除的计划项（经审计否决）**：

- ~~修改 `packages/aigcfroge/src/session/tools.ts`~~ — AdapterRegistry 可通过 task.ts 内部的 Effect.gen 直接获取，无需通过 tool context 传递（I6 修复）
- ~~修改 `packages/aigcfroge/src/tool/registry.ts`~~ — describeCLI 逻辑内聚在 task.ts 自身

---

## Phase 1：元智能体基础 (MVP)

**目标**：元智能体作为默认入口，能分类意图、路由到子智能体、支持 @mention、System Prompt 缓存结构。

### Task 1.1：创建元智能体目录和基础结构

**文件**：新建 `packages/aigcfroge/src/agent/meta/` 目录，包含以下独立模块（每模块一个文件 + 自导出，无 barrel `index.ts`）。

#### 1.1.1 `intent.ts` — 意图分类器

> Path: `packages/aigcfroge/src/agent/meta/intent.ts`
> Depends on: (none)
> Depended by: engine-selector.ts, meta-agent.ts

```typescript
export type IntentCategory =
  | "content_creation"
  | "code_understanding"
  | "code_modification"
  | "configuration"
  | "workflow"
  | "mention"
  | "unknown"

export type Complexity = "simple" | "moderate" | "complex"

// C4 修复：IntentResult 不引用 MentionTarget。
// MentionTarget 由 mention.ts 的 ParsedInput.matches 独立返回，
// meta-agent.ts 分别调用 classify() 和 parse() 后合并。
export interface IntentResult {
  category: IntentCategory
  complexity: Complexity
  needsExploration: boolean
  isMention: boolean // 是否包含 @mention
}

export function classify(input: string): IntentResult
```

**实现逻辑**：正则匹配用户输入前缀模式，检测 @mention 标记（设置 `isMention`），委托给 meta-agent.ts 解析具体目标。

**自导出**：`export * as MetaIntent from "./intent"`

#### 1.1.2 `engine-selector.ts` — 引擎路由

> Path: `packages/aigcfroge/src/agent/meta/engine-selector.ts`
> Depends on: intent.ts (IntentCategory, Complexity)
> Depended by: meta-agent.ts

```typescript
export interface EngineDispatchEntry {
  type: "subagent" | "external-cli" | "workflow"
  target: string
}

export const ENGINE_DISPATCH: Record<string, EngineDispatchEntry> = {
  // NOTE: content_creation 路由到 "general"（当前项目无 lightweight agent）
  content_creation: { type: "subagent", target: "general" },
  code_understanding: { type: "subagent", target: "explore" },
  code_modification: { type: "subagent", target: "build" },
  configuration: { type: "subagent", target: "general" },
  workflow: { type: "workflow", target: "builtin" },
  "claude-code": { type: "external-cli", target: "claude-code" },
  gemini: { type: "external-cli", target: "gemini" },
  codex: { type: "external-cli", target: "codex" },
}

export const COMPLEXITY_DEFAULT_ENGINE: Record<Complexity, string> = {
  simple: "general",
  moderate: "build",
  complex: "build",
}

export function selectEngine(input: SelectEngineInput): { engine: string }
```

**自导出**：`export * as MetaEngine from "./engine-selector"`

#### 1.1.3 `mention.ts` — @mention 解析器

> Path: `packages/aigcfroge/src/agent/meta/mention.ts`
> Depends on: (none)
> Depended by: meta-agent.ts

```typescript
// C4 修复：MentionTarget 在 mention.ts 定义并自包含，不跨文件引用
export interface MentionTarget {
  readonly name: string
  readonly type: "subagent" | "external-cli"
  readonly prompt: string
  readonly position: number
}

export type WorkflowMode = "parallel" | "pipeline"

export interface ParsedInput {
  readonly text: string
  readonly mentions: MentionTarget[]
  readonly workflow?: WorkflowMode
}

export function parse(input: string, knownAgents: string[], knownCLIs: string[]): ParsedInput
```

**解析规则**：

- `@name` 后跟完整 prompt，到下一个 `@` 或字符串结尾
- 无连接词的多 `@` → parallel
- `先 @A 再 @B` → pipeline
- `@A 和 @B 同时` → parallel

**自导出**：`export * as MetaMention from "./mention"`

#### 1.1.4 `context-builder.ts` — 委派上下文构建器（C3 修复）

> Path: `packages/aigcfroge/src/agent/meta/context-builder.ts`
> Depends on: intent.ts, engine-selector.ts
> Depended by: meta-agent.ts

构建委派给子智能体/CLI 时的结构化上下文：

```typescript
export interface BuildInput {
  project: string
  taskDescription: string
  engine: string
  delegationId: string
  files: string
  constraints: string
  history: DelegationHistoryEntry[]
  warmed?: boolean // cache-warmth 信号
}

export interface DelegationHistoryEntry {
  seq: number
  engine: string
  status: "success" | "partial" | "failed"
  summary: string
  files?: string[]
}

export function build(input: BuildInput): string
```

**模板**（硬编码固定前缀，L1 缓存稳定）：

```
Project: {{project}}
Task: {{taskDescription}}
Engine: {{engine}}
ID: {{delegationId}}
{{files}}
{{constraints}}
{{warmth_signal}}

Previous:
{{history}}
```

**自导出**：`export * as MetaContextBuilder from "./context-builder"`

#### 1.1.5 `cache-warmth.ts` — 缓存预热跟踪

> Path: `packages/aigcfroge/src/agent/meta/cache-warmth.ts`
> Depends in: intent.ts
> Depended by: meta-agent.ts

```typescript
export interface CacheWarmthEntry {
  engineId: string
  lastContextSha: string
  lastUsed: number
  hitRate: number
  taskCategory: IntentCategory
}

export class CacheWarmth extends Context.Service<CacheWarmth, Interface>()("@aigcfroge/CacheWarmth") {}

// Layer 定义（I5 修复）
export const layer = Layer.effect(
  CacheWarmth,
  Effect.gen(function* () {
    // 使用 InstanceState 按目录存储 Map<string, CacheWarmthEntry>
    // 内部使用 Effect.cached 保证预热并发安全
  }),
)
```

**自导出**：`export * as MetaCacheWarmth from "./cache-warmth"`

### Task 1.2：创建元智能体系统提示

**文件**：新建 `packages/aigcfroge/src/agent/prompt/meta.txt`

**内容结构**（缓存友好布局，参阅 PRD §3.7）：

```text
你是 AigcForge 元智能体 — 统一编排入口。

你的角色:
- 理解用户意图，分析需求复杂度
- 通过 task 工具委派给适合的子智能体或 CLI
- 汇总委派结果给用户
- 必要时可直接使用所有工具兜底执行

规则:
- 【委派优先】代码执行、文件修改优先通过 task 委派
- 【兜底执行】简单任务或子智能体不可用时可直接执行
- 【保持简短】你的核心价值是路由，回复保持 1-3 句摘要
- 【@mention 路由】用户可通过 @name 显式指定执行引擎

可用子智能体:
{{SUBAGENTS_LIST}}

可用 CLI 工具:
{{CLI_LIST}}

注意:
- task 工具的子智能体启动全新的上下文
- 提供 task_id 可复用上次的子会话上下文
```

**缓存分区**：

- L1: `你是 AigcForge 元智能体...` 到 `【@mention 路由】用户可通过 @name 显式指定执行引擎` — **字节级锁定，永不变**
- L2: `可用子智能体:` 到 `{{CLI_LIST}}` — 会话启动时渲染一次，会话内不变
- L3: 未写入 meta.txt，由 context-builder.ts 在每次 dispatch 时动态构建

### Task 1.3：创建元智能体定义

**文件**：新建 `packages/aigcfroge/src/agent/meta-agent.ts`

```typescript
// 元智能体权限：继承 build 的默认全权限 + 编排工具特权
// 不复制代码——直接引用 agent.ts 中 build 的 defaults 权限模板
export const permission = Permission.merge(
  buildDefaults, // 从 agent.ts 导出（refactor：提取 addDefaults() 为可复用函数）
  Permission.fromConfig({
    task: "allow",
    create_agent: "allow",
    configure_mcp: "allow",
    create_workflow: "allow",
  }),
)

export const prompt = PROMPT_META // 从 prompt/meta.txt 加载
```

**关键设计点**：

- 元智能体的 `mode: "primary"`, `hidden: false`
- `PROMPT_META` 作为纯文本常量导入（Bun.txt loader）
- 遵循 `export * as MetaAgent from "./meta-agent"` 自导出模式

### Task 1.4：注册元智能体到系统

#### 1.4.1 修改 `packages/aigcfroge/src/agent/agent.ts`

**变更**：

1. **提取权限模板**：将 build 的 `defaults` 权限提取为 `const buildDefaults = Permission.fromConfig({...})`，外部可引用
2. **注册 meta**：在 `agents` 记录中添加 `meta` 条目
3. **修改默认逻辑**：

```typescript
const defaultAgent = Effect.fnUntraced(function* () {
  // I7 修复：回退开关
  if (process.env.AIGCFROGE_DISABLE_META_AGENT === "true") {
    return yield* fallbackToBuild()
  }
  const c = yield* config.get()
  if (c.default_agent) {
    // 用户显式设置了 default_agent → 尊重用户选择
    const agent = agents[c.default_agent]
    if (!agent) throw new Error(`...`)
    return agent
  }
  // 回退链: meta → build → 第一个 visible primary
  return agents["meta"] ?? fallbackToBuild()
})
```

#### 1.4.2 修改 `packages/aigcfroge/src/agent/subagent-permissions.ts`（C5 修复）

```typescript
// 当父智能体为 meta 时，不强制 deny task/todowrite
// meta 的子智能体可以进一步委派子任务
export function deriveSubagentSessionPermission(input: {
  parentSessionPermission: PermissionV1.Ruleset
  subagent: Agent.Info
  parentAgentName?: string // NEW: 知道父智能体是谁
}): PermissionV1.Ruleset {
  // meta 的子智能体跳过 todowrite 和 task 的强制 deny
  const isMetaChild = input.parentAgentName === "meta"

  const canTask = isMetaChild || input.subagent.permission.some((r) => r.permission === "task")
  const canTodo = isMetaChild || input.subagent.permission.some((r) => r.permission === "todowrite")
  // ... 其余逻辑不变
}
```

#### 1.4.3 修改 `packages/core/src/plugin/agent.ts` (V2 系统)

在 `AgentPlugin` 中添加 meta 智能体的 V2 注册：

```typescript
draft.update(AgentV2.ID.make("meta"), (item) => {
  item.description = "The meta agent — unified orchestration entry point."
  item.system = PROMPT_META
  item.mode = "primary"
  item.permissions.push(
    ...PermissionV2.merge(defaults, [
      { action: "question", resource: "*", effect: "allow" },
      { action: "task", resource: "*", effect: "allow" },
      { action: "plan_enter", resource: "*", effect: "allow" },
    ]),
  )
})
```

### Task 1.5：验证与测试

**测试清单**（I2 修复：新增 L1 哈希验证）：

```typescript
// 新增测试 7: L1 区哈希固定性
describe("meta.txt L1 cache stability", () => {
  it("SHA256 of L1 prefix is locked", () => {
    const meta = readFileSync("packages/aigcfroge/src/agent/prompt/meta.txt", "utf-8")
    const l1 = meta.split("可用子智能体:")[0].trim()
    const sha = SHA256(l1)
    // 任何修改 L1 区需要同步更新此预期哈希
    expect(sha).toBe("<current_sha256>")
  })
})
```

1. `intent.ts` 的 中文/英文/@mention 边界分类
2. `mention.ts` 的解析/并行/串行模式
3. `engine-selector.ts` 的分类→引擎映射
4. `context-builder.ts` 的模板渲染
5. `cache-warmth.ts` 的 SHA 跟踪/命中率
6. meta agent 权限合并正确性
7. **L1 区 SHA256 固定性**
8. 默认 agent 降级逻辑（meta → build → 第一个 visible）
9. `AIGCFROGE_DISABLE_META_AGENT=true` 回退

```bash
bun run lint
bun --cwd packages/core typecheck
bun --cwd packages/aigcfroge typecheck
bun --cwd packages/aigcfroge test --timeout 30000
bun --cwd packages/core test --timeout 30000
```

**Phase 1 出口标准**：

- ✅ `bun run lint` 零错误
- ✅ `bun --cwd packages/aigcfroge typecheck` 零错误
- ✅ 所有测试通过
- ✅ meta 的 system prompt L1 区 SHA256 通过测试
- ✅ `AIGCFROGE_DISABLE_META_AGENT=true` 回退验证

---

## Phase 2：外部 CLI 集成

**目标**：元智能体可调用外部 CLI 智能体（Claude Code 优先），CLI 扫描 + 设置页开关。

### Task 2.1：CLI 适配器接口 + 输出解析工具

**文件**：新建 `packages/aigcfroge/src/agent/meta/adapters/interface.ts`

```typescript
export interface CliAdapter {
  readonly name: string
  readonly command: string
  readonly description: string
  readonly detect: () => Effect<boolean>
  readonly buildArgs: (input: { prompt: string; cwd: string }) => Effect<readonly string[]>
  readonly parseOutput: (stdout: string, stderr: string) => Effect<DelegationResult>
  readonly cancel?: (cwd: string) => Effect<void>
}

export type DelegationStatus = "success" | "partial" | "failed"

export interface DelegationResult {
  status: DelegationStatus
  summary: string
  files?: { created?: string[]; modified?: string[]; deleted?: string[] }
  errors?: string[]
}
```

**自导出**：`export * as CliAdapter from "./interface"`

**同时新建** `packages/aigcfroge/src/agent/meta/adapters/delegation-parser.ts`（C2 修复）：

```typescript
import { Schema } from "effect"
import type { DelegationResult } from "./interface"

// I3 修复：使用 Effect Schema 代替 raw JSON.parse
const StdoutChunk = Schema.UnknownFromJsonString

export function parseDelegationResult(text: string): DelegationResult | undefined
// 从文本中提取:
//   <result> / <task-result> / <task_error> tag
//   <summary> tag
//   文件变更标记 (created/modified/deleted)
//   错误信息
// 兜底: 提取前 200 字符作为 summary

// 用于适配器的 parseOutput:
export function parseDelegationOutput(stdout: string, stderr: string): Effect<DelegationResult>
```

**自导出**：`export * as DelegationParser from "./delegation-parser"`

### Task 2.2：适配器注册表

**文件**：新建 `packages/aigcfroge/src/agent/meta/adapters/registry.ts`

```typescript
export interface Interface {
  readonly register: (name: string, adapter: CliAdapter) => Effect<void>
  readonly get: (name: string) => Effect<CliAdapter | undefined>
  readonly list: () => Effect<CliAdapter[]>
  readonly available: () => Effect<CliAdapter[]> // detect() 通过的
  readonly scan: () => Effect<void> // 触发扫描
}

// I5 修复：完整 Layer 定义
export const layer = Layer.effect(
  AdapterRegistry,
  Effect.gen(function* () {
    const config = yield* Config.Service
    // 内存存储 Map<string, CliAdapter>
    // scan() 调用每个已注册的 detect()
  }),
)
```

**自导出**：`export * as CliAdapterRegistry from "./registry"`

### Task 2.3：CLI 扫描器

**文件**：新建 `packages/aigcfroge/src/agent/meta/adapters/scanner.ts`

```typescript
// 扫描 $PATH 中已知的 CLI 命令
// 使用 which() — 参考 /web/aigcfroge 的 @opencode-ai/core/util/which
// 当前项目可用 @aigcfroge/core 中的 ChildProcess.which 或 which 工具

export function scan(registry: AdapterRegistry): Effect<void>
// 对每个已注册适配器调用 detect()
// 记录可用/不可用状态

// 用户设置过滤
export function availableAdapters(cfg: Config, registry: AdapterRegistry): Effect<CliAdapter[]>
// scan() → filter(按 cfg.meta?.cli?.enabled)
```

**自导出**：`export * as CliScanner from "./scanner"`

### Task 2.4：Claude Code 适配器

**文件**：新建 `packages/aigcfroge/src/agent/meta/adapters/claude-code.ts`

```typescript
export const adapter: CliAdapter = {
  name: "claude-code",
  command: "claude",
  description: "Claude Code CLI — Anthropic 官方 AI 编码助手",
  detect: () => Effect.sync(() => which("claude") !== null),
  buildArgs: (input) => Effect.succeed(["--print", "--output-format", "stream-json", input.prompt]),
  parseOutput: (stdout, stderr) =>
    Effect.gen(function* () {
      // I3 修复：使用 parseDelegationOutput
      const result = yield* DelegationParser.parseDelegationOutput(stdout, stderr)
      // 对 stream-json 格式的特化处理: 逐行寻找 type=result/completion
      // parseDelegationOutput 已包含兜底逻辑
      return result
    }),
}
```

**自导出**：`export * as ClaudeCodeAdapter from "./claude-code"`

### Task 2.5：超时与错误处理框架

**文件**：新建 `packages/aigcfroge/src/agent/meta/adapters/timeout.ts`（I1 整合）

```typescript
export interface TimeoutConfig {
  defaultTimeout: number // 默认 300_000 (5min)
  perAdapter: Record<string, number> // 按 CLI 覆盖
  retryPolicy: {
    maxRetries: number // 默认 1
    backoff: "exponential" | "fixed" // 默认 exponential
    baseDelayMs: number // 默认 2000
  }
}

// 错误分类
export type CliErrorType = "timeout" | "parse_error" | "exit_error" | "not_found" | "unknown"

export interface CliError {
  type: CliErrorType
  message: string
  permanent: boolean // true = 重试无意义
}

export function executeWithTimeout<T>(
  adapter: CliAdapter,
  input: { prompt: string; cwd: string },
  config: TimeoutConfig,
): Effect<DelegationResult, CliError>

// 内部实现:
// 1. buildArgs → ChildProcessSpawner.spawn → 进程句柄
// 2. stdout 流式收集（Truncate 集成 — I4 修复）
// 3. Process.wait + Effect.timeout
// 4. 超时 → process.kill → 分类为 permanent=false → 返回 timeout 错误
// 5. parseOutput 失败 → 分类为 parse_error → 降级为 raw output
// 6. exit code ≠ 0 → 分类为 exit_error → 检查可重试性
// 7. 孤儿进程注册 → meta agent 退出时清理
```

**注意**：使用 `ChildProcessSpawner.ChildProcessSpawner` + `ChildProcess.make(...)` 而非 raw child_process（符合 AGENTS.md 约定）。

**自导出**：`export * as CliTimeout from "./timeout"`

### Task 2.6：扩展 Task 工具支持 CLI 模式（C1 详细设计）

**文件**：修改 `packages/aigcfroge/src/tool/task.ts`

#### 2.6a：新增 CLI 执行函数（新代码，独立函数）

```typescript
// 新增: CLI 执行分支（独立函数，不与现有 subagent 逻辑耦合）
const executeCLI = Effect.fn("TaskTool.executeCLI")(function* (
  params: { cli_target: string; prompt: string; cwd: string },
  ctx: Tool.Context,
) {
  const registry = yield* AdapterRegistry.Service
  const truncate = yield* Truncate.Service
  const adapter = yield* registry.get(params.cli_target)
  if (!adapter) return yield* Effect.fail(new Error(`Unknown CLI: ${params.cli_target}`))

  const available = yield* adapter.detect()
  if (!available) return yield* Effect.fail(new Error(`CLI ${params.cli_target} is not available`))

  const result = yield* executeWithTimeout(
    adapter,
    {
      prompt: params.prompt,
      cwd: params.cwd,
    },
    timeoutConfig,
  )

  // I4 修复：截断大输出
  const truncated = yield* truncate.output(result.summary, {}, ctx.agent as Agent.Info)

  return {
    title: `CLI: ${params.cli_target}`,
    output: renderOutput({
      sessionID: SessionID.ascending(),
      state: result.status === "failed" ? "error" : "completed",
      text: truncated.truncated ? truncated.content : result.summary,
    }),
    metadata: { cli: params.cli_target, status: result.status },
  }
})
```

#### 2.6b：在现有 execute 中添加分支

```typescript
// 在 execute 函数开始时:
const run = Effect.fn("TaskTool.execute")(function* (params, ctx) {
  // NEW: CLI 模式分支
  if (params.execution_type === "external-cli") {
    return yield* executeCLI(
      {
        cli_target: params.cli_target!,
        prompt: params.prompt,
        cwd: ctx.directory ?? process.cwd(),
      },
      ctx,
    )
  }
  // 原有 subagent 逻辑不变...
})
```

#### 2.6c：扩展参数 schema

```typescript
const Parameters = Schema.Struct({
  ...BaseParameterFields,
  background: Schema.optional(Schema.Boolean),
  execution_type: Schema.optional(Schema.Literals(["subagent", "external-cli"])).annotate({
    description: "Execution mode. subagent (default) for internal agents, external-cli for CLI tools like claude-code.",
  }),
  cli_target: Schema.optional(Schema.String).annotate({
    description: "CLI name when execution_type is 'external-cli'. Use @name in conversation.",
  }),
})
```

### Task 2.7：验证与测试

```bash
bun run lint
bun --cwd packages/aigcfroge typecheck
bun --cwd packages/core typecheck
bun --cwd packages/aigcfroge test --timeout 30000
```

测试重点：mock `AdapterRegistry` 和 `ChildProcessSpawner` 验证 CLI 执行分支的正确分流。

---

## Phase 3：工作流引擎

（无阻塞问题，内容与 v1.0 一致，以下仅列变更）

### Task 3.4 更新：系统提示不修改 L1 区

工作流指令写入 `context-builder.ts` 的模板（L2 区），不加入 meta.txt 的 L1 区（保护缓存前缀稳定性）。

---

## Phase 4：插件系统扩展

（无阻塞问题。I5 修复：MetaHooks 内部接口定义为纯接口/type，不使用 `Context.Service` 模式 — 插件 hooks 由 `packages/plugin/` 包管理，不需要独立 Layer。）

### 补充说明

`MetaHooks` 作为 Plugin 包的扩展接口，不创建 Effect `Context.Service`。hooks 通过 Registration 模式管理生命周期（`Scope` 范围内）。

---

## Phase 5：优化与完善

### Task 5.6 新增：数据库 migration（C6 修复）

**新 migration 文件**：`packages/core/src/database/migration/YYYYMMDDHHMMSS_meta_agent_session_v2.ts`

```typescript
export default {
  id: "YYYYMMDDHHMMSS_meta_agent_session_v2",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE meta_agent_session ADD COLUMN effort TEXT;`)
      yield* tx.run(`ALTER TABLE meta_agent_session ADD COLUMN tokens_used INTEGER;`)
      yield* tx.run(`ALTER TABLE meta_agent_session ADD COLUMN error TEXT;`)
      yield* tx.run(`ALTER TABLE meta_agent_session ADD COLUMN result_summary TEXT;`)
    })
  },
}
```

**同时更新** `packages/core/src/meta-agent/sql.ts` 的 Drizzle schema 对应新增列。

---

## 关键接口变更汇总（修复版）

### 新增 Context.Service 类

| Service                   | Layer               | 依赖                      | 用途             |
| ------------------------- | ------------------- | ------------------------- | ---------------- |
| `CacheWarmth.Service`     | `Layer.effect(...)` | `InstanceState`           | 缓存预热跟踪     |
| `AdapterRegistry.Service` | `Layer.effect(...)` | `Config.Service`          | CLI 适配器注册表 |
| `WorkflowEngine.Service`  | `Layer.effect(...)` | `AdapterRegistry.Service` | 工作流执行       |

### 新增 Plugin Hooks

| Hook                                         | 用途               |
| -------------------------------------------- | ------------------ |
| `ctx.meta.intent.register(name, rule)`       | 注册自定义意图分类 |
| `ctx.meta.adapter.register(name, factory)`   | 注册 CLI 适配器    |
| `ctx.meta.workflow.register(name, template)` | 注册工作流模板     |
| `ctx.meta.middleware.register(hook)`         | 注册编排中间件     |
| `ctx.meta.policy.register(policy)`           | 注册编排策略       |

### 现有接口干扰（修复版）

| 修改                                                           | 兼容性                                               |
| -------------------------------------------------------------- | ---------------------------------------------------- |
| `agent.ts`: 提取 `buildDefaults` 为外部引用                    | ✅ 无破坏                                            |
| `agent.ts`: 默认 agent 回退链 + `AIGCFROGE_DISABLE_META_AGENT` | ✅ 无破坏                                            |
| `subagent-permissions.ts`: 多一个可选 `parentAgentName` 参数   | ✅ 可选参数                                          |
| `task.ts`: 参数新增 `execution_type` / `cli_target`            | ✅ `Schema.optional`                                 |
| `plugin/context.ts`: 新增 `meta` 字段                          | ⚠️ 轻度 — 已有插件不访问即不受影响                   |
| ~~`session/tools.ts`~~                                         | ✅ **已移除**，AdapterRegistry 在 task.ts 内直接获取 |
| ~~`registry.ts`~~                                              | ✅ **已移除**，describeCLI 内聚在 task.ts            |

---

## 实施顺序依赖（修复版 — C2/C3/C5 加入 Phase 1）

```
Phase 1 ──────────────────────────────────────────
  Task 1.1.1 (intent.ts)          ← 无前置
  Task 1.1.2 (engine-selector)    ← 依赖 1.1.1
  Task 1.1.3 (mention.ts)         ← 无前置
  Task 1.1.4 (context-builder)    ← 依赖 1.1.1, 1.1.2  [C3 新增]
  Task 1.1.5 (cache-warmth)       ← 依赖 1.1.1
  Task 1.2 (meta.txt)             ← 无前置
  Task 1.3 (meta-agent.ts)        ← 依赖 1.1.x, 1.1.4, 1.2
  Task 1.4.1 (agent.ts 注册)       ← 依赖 1.3
  Task 1.4.2 (subagent-perms 扩展) ← 依赖 1.3     [C5 新增]
  Task 1.4.3 (core V2 注册)        ← 依赖 1.3
  └── 验证 & 测试

Phase 2 ──────────────────────────────────────────
  Task 2.1 (interface + parser)    ← 无前置        [C2 合并]
  Task 2.2 (registry)             ← 依赖 2.1
  Task 2.3 (scanner)              ← 依赖 2.2
  Task 2.4 (claude-code)          ← 依赖 2.1
  Task 2.5 (timeout + error)      ← 依赖 2.1       [I1 合并]
  Task 2.6a (executeCLI 独立函数)   ← 依赖 2.2, 2.5 [C1 拆分]
  Task 2.6b (task.ts 分支)         ← 依赖 2.6a
  Task 2.6c (params schema)        ← 依赖 2.6b
  └── 验证 & 测试

Phase 3-5 ──────── (依前序阶段，不变)
```

---

## 复查结论模板

```text
Phase N 复查结论:
- 影响文件:
- 已运行命令:
- Lint:
- Typecheck:
- Test:
- 安全门禁 (Catch Everything / No Null Pointer / Security First):
- 工程门禁 (No Cheating / Reusability / Clean Logs):
- 剩余风险:
```

---

**审计修复清单**：

| 编号 | 级别 | 修复                                                                     |
| ---- | ---- | ------------------------------------------------------------------------ |
| C1   | 阻塞 | Task 2.6 拆分为 2.6a/b/c，CLI 执行路径独立函数，不耦合现有 subagent 逻辑 |
| C2   | 阻塞 | Phase 2 新增 `delegation-parser.ts`                                      |
| C3   | 阻塞 | Phase 1 新增 `context-builder.ts`                                        |
| C4   | 阻塞 | intent.ts 移除 MentionTarget 引用，mention.ts 自包含                     |
| C5   | 阻塞 | Phase 1 新增 Task 1.4.2 subagent-permissions 扩展                        |
| C6   | 阻塞 | Phase 5 Task 5.6 显式添加 migration 创建步骤                             |
| I1   | 重要 | timeout.ts 整合错误分类/重试策略/孤儿进程清理                            |
| I2   | 重要 | Task 1.5 测试清单新增 L1 SHA256 固定性测试                               |
| I3   | 重要 | 适配器使用 Effect Schema 代替 raw JSON.parse                             |
| I4   | 重要 | executeCLI 中显式添加 Truncate 集成                                      |
| I5   | 重要 | 所有新 Service 附带完整 Layer 定义和 I1                                  |
| I6   | 重要 | 移除 session/tools.ts 和 registry.ts 的不必要修改                        |
| I7   | 重要 | 新增 `AIGCFROGE_DISABLE_META_AGENT` 回退开关                             |

---

## 参考链接

| 项目                                                   | 参考内容           | 用途                         |
| ------------------------------------------------------ | ------------------ | ---------------------------- |
| `docs/prd/meta-agent-orchestrator.md`                  | 完整 PRD           | 需求总纲                     |
| `packages/aigcfroge/src/agent/agent.ts`                | Agent 服务         | 注册、权限模板提取、默认逻辑 |
| `packages/aigcfroge/src/agent/subagent-permissions.ts` | 子智能体权限       | meta 子智能体特殊处理        |
| `packages/aigcfroge/src/tool/task.ts`                  | Task 工具          | CLI 模式分支注入点           |
| `packages/core/src/plugin/agent.ts`                    | V2 agent 插件      | meta V2 注册                 |
| `packages/core/src/agent.ts`                           | V2 Agent 服务      | 默认 agent 变更              |
| `packages/core/src/meta-agent/sql.ts`                  | 元智能体数据表     | migration 目标               |
| `packages/schema/src/meta-agent.ts`                    | MetaAgent schema   | schema 参考                  |
| `packages/plugin/src/v2/effect/agent.ts`               | AgentHooks 模式    | MetaHooks 模式参考           |
| `packages/plugin/src/v2/effect/context.ts`             | PluginContext      | meta 域注入                  |
| `/web/aigcfroge` intent.ts                             | 意图分类参考       | 移植来源                     |
| `/web/aigcfroge` engine-selector.ts                    | 引擎路由参考       | 移植来源                     |
| `/web/aigcfroge` CliAdapter                            | 适配器接口参考     | 移植来源                     |
| `/web/aigcfroge` cache-warmth.ts                       | 缓存预热参考       | 移植来源                     |
| `/web/aigcfroge` claude-code.ts                        | Claude Code 适配器 | 移植来源                     |
| `/cc` coordinatorMode.ts                               | 协调器模式         | 行为模式参考                 |
