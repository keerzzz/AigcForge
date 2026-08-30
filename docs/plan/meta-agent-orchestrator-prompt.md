# Meta-Agent Orchestrator Implementation Prompt

> 目标：实现元智能体编排系统 Phase 1（MVP），为后续 Phase 2-5 打好基础。
> 来源计划：`docs/plan/meta-agent-orchestrator.md`
> 来源 PRD：`docs/prd/meta-agent-orchestrator.md`
> 角色：你是高级全栈工程师，在当前 monorepo 的 Effect-TS 架构中开发。

---

## Phase 0：上下文构建（先读完再写一行代码）

### Step 0.1 — 协议文档（必读，不可跳过）

按顺序读取以下 5 个文件，读完第一个才能读下一个：

1. `CLAUDE.md` — 项目宪法（八荣八耻、四大拒绝、改完即审 7 步流程、安全门禁、工程门禁）
2. `AGENTS.md` — 代码风格（import 规则、Effect 模式（`Effect.gen`/`Effect.fn`）、Schema 约定（`Schema.Class`/`Schema.brand`/`Schema.TaggedErrorClass`）、自导出模式 `export * as Foo from "./foo"`、无 barrel `index.ts`、无别名导入、无 star 导入、无 else、const 优先、destructuring 避免）
3. `DESIGN.md` — 设计协议（如有 UI 改动时参照）
4. `packages/llm/AGENTS.md` — LLM 包指南（route/protocol/endpoint/auth/framing 架构、tool dispatch、test 约定）
5. `packages/aigcfroge/AGENTS.md` — aigcfroge 包指南（Database 约定、模块形状、Effect 规则、InstanceState 模式、dev server 启动方式）

### Step 0.2 — 架构文档（必读）

6. `docs/architecture/system-blueprint.md` — 架构总览（21 包拓扑、Session V2 核心、Provider 层级、EventV2 模型、数据表结构）
7. `docs/prd/meta-agent-orchestrator.md` — 需求总纲（10 项目标、架构概览、详细设计 µ3.1-3.10）
8. `docs/plan/meta-agent-orchestrator.md` — 本功能的实施计划（5 Phase 任务分解、文件变更清单、测试策略）

### Step 0.3 — 上游/下游代码（必读，理解现有架构）

按模块读，理解当前系统的完整调用链：

**Agent 系统**：9. `packages/aigcfroge/src/agent/agent.ts` — Agent 注册表（build/plan/general/explore 等的定义、权限合并、`defaultAgent()` 逻辑）10. `packages/aigcfroge/src/agent/subagent-permissions.ts` — 子智能体权限派生（父 deny 规则继承、todowrite/task 强制 deny）11. `packages/core/src/agent.ts` — V2 AgentService（ID/mode/permissions/resolve/select/all）12. `packages/core/src/plugin/agent.ts` — core agent plugin（V2 注册 build/plan/general/explore 等）

**Tool 系统**：13. `packages/aigcfroge/src/tool/task.ts` — Task 工具（子智能体 spawn、权限检查、后台/前台模式、`acquireUseRelease` 中断处理）14. `packages/aigcfroge/src/tool/tool.ts` — Tool 定义框架（`Tool.define`、`Tool.Context`、execute/trucate）15. `packages/aigcfroge/src/tool/registry.ts` — 工具注册表（内置工具 + 插件工具 + MCP 资源工具 + `describeTask`）

**Session 系统**：16. `packages/aigcfroge/src/session/processor.ts` — Session 处理器（LLM 事件流、tool call/tool result 事件处理、compaction 触发）17. `packages/aigcfroge/src/session/tools.ts` — Session 工具解析（权限 ask、插件 hooks、MCP 工具注入）

**插件系统**：18. `packages/plugin/src/v2/effect/agent.ts` — AgentDraft 类型 19. `packages/plugin/src/v2/effect/context.ts` — PluginContext 接口 20. `packages/plugin/src/v2/effect/registration.ts` — Registration/Hooks 模式 21. `packages/plugin/src/v2/effect/index.ts` — 插件包导出

**数据层**：22. `packages/core/src/meta-agent/sql.ts` — meta*agent + meta_agent_session 表（schema 参考）23. `packages/schema/src/meta-agent.ts` — MetaAgent.Info + MetaAgent.ID（品牌 ID `mag*\*`）

### Step 0.4 — 外部参考（读，理解模式来源，不拷贝代码）

24. `/home/keer/Documents/web/aigcfroge/packages/opencode/src/agent/meta-agent.ts` — 外部 meta-agent 定义（权限模型参考，尤其是 deny bash/read/ grep 的"只委派不执行"模式）
25. `/home/keer/Documents/web/aigcfroge/packages/opencode/src/agent/meta/intent.ts` — 外部意图分类器（正则分类模式）
26. `/home/keer/Documents/web/aigcfroge/packages/opencode/src/agent/meta/engine-selector.ts` — 外部引擎路由（dispatch 映射表）
27. `/home/keer/Documents/web/aigcfroge/packages/opencode/src/agent/meta/adapters/interface.ts` — 外部 CLI 适配器接口（detect/buildArgs/parseOutput）
28. `/home/keer/Documents/web/aigcfroge/packages/opencode/src/agent/meta/adapters/claude-code.ts` — 外部 Claude Code 适配器（stream-json 解析）
29. `/home/keer/Documents/web/aigcfroge/packages/opencode/src/agent/meta/adapters/codex.ts` — 外部 Codex 适配器（text.delta 解析）
30. `/home/keer/Documents/web/aigcfroge/packages/opencode/src/agent/meta/cache-warmth.ts` — 外部缓存预热（命中率跟踪）
31. `/home/keer/Documents/web/aigcfroge/packages/opencode/src/agent/meta/protocol/context-builder.ts` — 外部委派上下文构建器
32. `/home/keer/Documents/web/aigcfroge/packages/opencode/src/agent/meta/protocol/dialog-context.txt` — 外部委派上下文模板
33. `/home/keer/Documents/web/aigcfroge/packages/opencode/src/agent/prompt/meta.txt` — 外部 meta 系统提示

**Step 0.5 — 输出确认**

在读完以上 33 个文件/路径后，向用户输出一份**上下文理解确认书**：

```text
上下文确认:
- 协议文档: CLAUDE.md ✓ / AGENTS.md ✓ / DESIGN.md ✓ / llm AGENTS.md ✓ / aigcfroge AGENTS.md ✓
- 架构文档: system-blueprint.md ✓ / PRD ✓ / Plan ✓
- 当前代码: agent.ts ✓ / subagent-permissions.ts ✓ / core agent.ts ✓ / core plugin agent.ts ✓
            task.ts ✓ / tool.ts ✓ / registry.ts ✓ / processor.ts ✓ / tools.ts ✓
            plugin agent.ts ✓ / plugin context.ts ✓ / plugin registration.ts ✓ / plugin index.ts ✓
            meta-agent sql.ts ✓ / meta-agent schema.ts ✓
- 外部参考: /web/aigcfroge meta-agent.ts ✓ / intent.ts ✓ / engine-selector.ts ✓ / CliAdapter ✓
            claude-code.ts ✓ / codex.ts ✓ / cache-warmth.ts ✓ / context-builder.ts ✓
            dialog-context.txt ✓ / meta.txt ✓
- 理解的架构流: [用 3-5 句简述: 用户输入→Agent 选择→SystemPrompt→LLM→Tool执行→结果回填 的完整链路]
- 本项目 meta 与外部 meta 的核心差异: [本项目=全权限兜底; 外部=只委派不执行]
```

**在用户确认上下文理解无误后，才能进入 Phase 1 的代码编写。**

---

## Phase 1 任务执行流程

Phase 1 包含 **7 个代码任务** + **1 个验证任务**。严格按照以下顺序执行，**禁止跳任务**。

### Task 1：创建意图分类器 `intent.ts`

1. **新文件**：`packages/aigcfroge/src/agent/meta/intent.ts`

2. **实现内容**：
   - `IntentCategory` 类型（7 类别: content_creation, code_understanding, code_modification, configuration, workflow, mention, unknown）
   - `Complexity` 类型（simple, moderate, complex）
   - `IntentResult` 接口（category, complexity, needsExploration, isMention）
   - `classify(input: string): IntentResult` 函数（正则匹配 + @mention 检测）
   - `export * as MetaIntent from "./intent"` 自导出

3. **必须遵循的代码规则**：
   - 不使用 `export namespace`
   - 不使用 `else`，用 early return
   - 不使用 `as any` 或 `@ts-ignore`
   - 正则模式从 `/web/aigcfroge` 的 intent.ts 移植，适配中文/英文
   - `IntentResult` 不引用 `MentionTarget`（类型独立，mention 解析由 meta-agent.ts 合并）

4. **自审门禁**（写完代码后）：
   - 对照 CLAUDE.md 八荣八耻逐项检查
   - 检查 import 是否真实存在
   - 检查函数签名是否用 effect 函数（纯同步函数不需要 Effect.fn）
   - 确认导出模式为 `export * as MetaIntent from "./intent"`

5. **测试文件**：`packages/aigcfroge/test/agent/meta/intent.test.ts`
   - 测试中文输入分类
   - 测试英文输入分类
   - 测试 @mention 标记检测
   - 测试空字符串/纯符号边界

6. **验证**：

   ```bash
   bun --cwd packages/aigcfroge test --timeout 30000
   ```

7. **输出**："Task 1 完成 — intent.ts ✓"

### Task 2：创建引擎选择器 `engine-selector.ts`

1. **新文件**：`packages/aigcfroge/src/agent/meta/engine-selector.ts`

2. **实现内容**：
   - `EngineDispatchEntry` 接口（type: "subagent"|"external-cli"|"workflow", target: string）
   - `ENGINE_DISPATCH` 映射表（按意图类别路由到子智能体/CLI）
   - `COMPLEXITY_DEFAULT_ENGINE` 映射表（不确定类别时按复杂度选引擎）
   - `selectEngine(input): { engine: string }` 函数
   - `export * as MetaEngine from "./engine-selector"` 自导出

3. **代码规则**：
   - content_creation 路由到 "general"（当前项目无 lightweight agent）
   - 外部 CLI（claude-code/gemini/codex）的条目预留在映射表中（P2 实现）
   - 纯函数，无 Effect 依赖

4. **自审门禁**：同上

5. **测试文件**：`packages/aigcfroge/test/agent/meta/engine-selector.test.ts`
   - 每种意图类别 → 正确引擎
   - 未知类别按复杂度默认路由
   - 工作流类别返回 workflow type

6. **验证**：

   ```bash
   bun --cwd packages/aigcfroge test --timeout 30000
   ```

7. **输出**："Task 2 完成 — engine-selector.ts ✓"

### Task 3：创建 @mention 解析器 `mention.ts`

1. **新文件**：`packages/aigcfroge/src/agent/meta/mention.ts`

2. **实现内容**：
   - `MentionTarget` 接口（name, type: "subagent"|"external-cli", prompt, position）
   - `WorkflowMode` 类型（"parallel" | "pipeline" | undefined）
   - `ParsedInput` 接口（text, mentions[], workflow?）
   - `parse(input, knownAgents[], knownCLIs[]): ParsedInput` 函数

3. **解析逻辑**：
   - 在输入字符串中扫描 `@` 前缀，匹配已知智能体/CLI 名
   - 截取 @name 后到下一个 @name 或字符串结尾为 prompt
   - 多 @ 无连接词 → parallel；`先 @A 再 @B` → pipeline
   - 去掉 @mention 标签后的纯文本作为 `ParsedInput.text`

4. **自审门禁**：同上。特别检查 — 如果输入中无 @mention，返回 `{ text: input, mentions: [], workflow: undefined }`

5. **测试文件**：`packages/aigcfroge/test/agent/meta/mention.test.ts`
   - 单个 @mention: `@build 修复 bug`
   - 多个 @mention（并行）: `@claude-code 分析 @gemini 检查`
   - pipeline: `先 @plan 写方案，然后 @build 实现`
   - 无 @mention: 普通输入原样返回
   - @mention 后无内容：prompt 为空字符串
   - 未知 @name: 不识别为 mention

6. **验证**：

   ```bash
   bun --cwd packages/aigcfroge test --timeout 30000
   ```

7. **输出**："Task 3 完成 — mention.ts ✓"

### Task 4：创建委派上下文构建器 `context-builder.ts`

1. **新文件**：`packages/aigcfroge/src/agent/meta/context-builder.ts`

2. **实现内容**：
   - `BuildInput` 接口（project, taskDescription, engine, delegationId, files, constraints, history[], warmed?）
   - `DelegationHistoryEntry` 接口（seq, engine, status, summary, files?）
   - `build(input: BuildInput): string` 函数

3. **实现细节**：
   - 使用硬编码模板字符串（保护缓存前缀稳定性）
   - 模板字段: Project/Task/Engine/ID/files/constraints/warmth_signal/Previous
   - history 取最近 5 条，格式化为 `#N [engine] status: summary (files)`
   - warmth: `input.warmed === true` 时注入 `<cache-warm/>` 标记

4. **自审门禁**：同上。特别检查 — 模板是固定字符串，不含动态内容

5. **测试文件**：`packages/aigcfroge/test/agent/meta/context-builder.test.ts`
   - 无历史记录的模板渲染
   - 有历史的模板渲染（最近 5 条截取）
   - warmth 标记注入

6. **验证**：

   ```bash
   bun --cwd packages/aigcfroge test --timeout 30000
   ```

7. **输出**："Task 4 完成 — context-builder.ts ✓"

### Task 5：创建缓存预热 `cache-warmth.ts`

1. **新文件**：`packages/aigcfroge/src/agent/meta/cache-warmth.ts`

2. **实现内容**：
   - `CacheWarmthEntry` 接口（engineId, lastContextSha, lastUsed, hitRate, taskCategory）
   - `CacheWarmth` Context.Service 类
   - `Interface` 接口（get, record, prewarm）
   - `layer` 定义（使用 InstanceState 按目录存储）

3. **代码规则**：
   - 使用 `Context.Service<CacheWarmth, Interface>()("@aigcfroge/CacheWarmth")`
   - 使用 InstanceState 按 directory 隔离（参考 `agent.ts` 的 InstanceState 使用模式）
   - 使用 `Effect.fn("CacheWarmth.method")` 命名所有 effect 函数
   - `prewarm()` 使用 `Effect.cached` 保证并发安全（参考 aigcfroge/AGENTS.md）
   - `record()` 更新 entry 并计算 hitRate（缓存命中次数/总请求次数）

4. **自审门禁**：特别检查 — Layer 正确依赖 InstanceState，所有 Effect 函数用 Effect.fn 命名

5. **测试文件**：`packages/aigcfroge/test/agent/meta/cache-warmth.test.ts`
   - 首次 get 返回 undefined
   - record → get 返回正确 entry
   - prewarm 返回 boolean
   - hitRate 计算（命中/总请求 = rate）

6. **验证**：

   ```bash
   bun --cwd packages/aigcfroge test --timeout 30000
   ```

7. **输出**："Task 5 完成 — cache-warmth.ts ✓"

### Task 6：创建元智能体定义和系统提示

#### Task 6a：创建系统提示 `meta.txt`

1. **新文件**：`packages/aigcfroge/src/agent/prompt/meta.txt`

2. **内容**：完全按照 Plan 文档中 L1 缓存区的文本拷贝（"你是 AigcForge 元智能体..." 到 "...可编排串行/并行工作流"），后跟 L2 占位符 `{{SUBAGENTS_LIST}}` 和 `{{CLI_LIST}}`。

3. **关键约束**：
   - L1 区文本**逐字精确**，不允许任何修改（包括空格、换行）
   - 任何修改 L1 区会在测试中 SHA256 不匹配
   - 文件编码：UTF-8

4. **自审门禁**：
   - 与 Plan 文档中的 L1 文本逐行对比
   - 确认中包含 `{{SUBAGENTS_LIST}}` 和 `{{CLI_LIST}}` 占位符

#### Task 6b：创建元智能体定义 `meta-agent.ts`

1. **新文件**：`packages/aigcfroge/src/agent/meta-agent.ts`

2. **实现内容**：
   - 导入 `PROMPT_META` 从 `./prompt/meta.txt`（Bun .txt import）
   - 导入 build 的 defaults 权限模板（需要先修改 `agent.ts` 导出）
   - 定义 `permission` = `Permission.merge(buildDefaults, Permission.fromConfig({ task: "allow", create_agent: "allow", configure_mcp: "allow" }))`
   - 导出 `prompt = PROMPT_META`、`permission`、`mode = "primary" as const`、`hidden = false`
   - `export * as MetaAgent from "./meta-agent"` 自导出

3. **代码规则**：
   - 不重复定义权限——直接引用 `agent.ts` 中的 buildDefaults
   - 不在此文件中实现编排逻辑——编排逻辑由 LLM 根据 meta.txt 系统提示执行

4. **自审门禁**：
   - 确认 import 的 meta.txt 路径正确（Bun 支持 .txt import）
   - 权限合并正确（build 全工具允许 + meta 特权）

5. **输出**："Task 6 完成 — meta.txt ✓ + meta-agent.ts ✓"

### Task 7：注册元智能体到系统

#### Task 7a：修改 `agent.ts`（V1 注册）

1. **修改文件**：`packages/aigcfroge/src/agent/agent.ts`

2. **变更**：
   - **提取权限模板**：将内联在 `build` 条目中的 `Permission.merge(defaults, Permission.fromConfig({...}))` 提取为 `export const buildDefaults = Permission.merge(defaults, Permission.fromConfig({...}))`
   - **新增 meta 条目**：在 `agents` 记录中添加：
     ```typescript
     meta: {
       name: "meta",
       description: MetaAgent.description,
       permission: MetaAgent.permission,
       mode: "primary",
       native: true,
       options: MetaAgent.options ?? {},
       prompt: MetaAgent.prompt,
     },
     ```
   - **修改 defaultAgent**：
     ```typescript
     const defaultAgent = Effect.fnUntraced(function* () {
       if (process.env.AIGCFROGE_DISABLE_META_AGENT === "true") {
         return yield* fallbackToBuild()
       }
       const c = yield* config.get()
       if (c.default_agent) {
         const agent = agents[c.default_agent]
         if (!agent) throw new Error(`default agent "${c.default_agent}" not found`)
         return agent
       }
       // 回退链: config.default_agent → meta → build → 第一个 visible
       return agents["meta"] ?? fallbackToBuild()
     })
     ```
   - **添加 import**：`import { MetaAgent } from "./meta-agent"`

3. **回退开关**：`AIGCFROGE_DISABLE_META_AGENT=true` 时完全跳过 meta

4. **自审门禁**：
   - 确认已存在的 agent 定义不受影响（build/plan/general/explore 的行为不变）
   - 确认 `buildDefaults` 导出不影响现有逻辑
   - 确认 meta 在所有必需的 import 中存在

#### Task 7b：修改 `subagent-permissions.ts`

1. **修改文件**：`packages/aigcfroge/src/agent/subagent-permissions.ts`

2. **变更**：函数签名增加可选参数 `parentAgentName?: string`：

   ```typescript
   export function deriveSubagentSessionPermission(input: {
     parentSessionPermission: PermissionV1.Ruleset
     subagent: Agent.Info
     parentAgentName?: string
   }): PermissionV1.Ruleset
   ```

   - 当 `parentAgentName === "meta"` 时，不强制添加 todowrite/task deny
   - 其他情况保持原有逻辑不变

3. **自审门禁**：
   - 新增参数为可选 → 向后兼容
   - 非 meta 的父智能体行为完全不变

#### Task 7c：修改 `packages/core/src/plugin/agent.ts`（V2 注册）

1. **修改文件**：`packages/core/src/plugin/agent.ts`

2. **变更**：在 `AgentPlugin.effect` 的 transform 回调中新增 meta 注册：

   ```typescript
   draft.update(AgentV2.ID.make("meta"), (item) => {
     item.description = "The meta agent — unified orchestration entry point."
     item.system = PROMPT_META
     item.mode = "primary"
     item.permissions.push(
       ...PermissionV2.merge(defaults, [
         { action: "question", resource: "*", effect: "allow" },
         { action: "task", resource: "*", effect: "allow" },
       ]),
     )
   })
   ```

   - `PROMPT_META` 需要从对应的 .txt 文件导入（使用 Bun text import 或 copy prompt string）
   - 注意 V2 注册路径在 core 包中，meta.txt 路径需要调

3. **自审门禁**：
   - 确认 V2 注册不影响 V1 Agent 的行为
   - PROMPT_META 的导入路径正确

4. **输出**："Task 7 完成 — agent.ts ✓ + subagent-permissions.ts ✓ + core/plugin/agent.ts ✓"

### Task 8：Phase 1 全量验证

1. **运行所有检查**：

   ```bash
   bun run lint
   bun --cwd packages/core typecheck
   bun --cwd packages/aigcfroge typecheck
   bun --cwd packages/aigcfroge test --timeout 30000
   bun --cwd packages/core test --timeout 30000
   ```

2. **L1 哈希锁定验证**：
   - 在测试中验证 meta.txt L1 区（"可用子智能体:" 之前的部分）的 SHA256
   - 任何修改 L1 区 → 测试失败 → 需要同步更新预期哈希

3. **回退开关验证**：

   ```bash
   AIGCFROGE_DISABLE_META_AGENT=true bun --cwd packages/aigcfroge test --timeout 30000
   ```

   - 验证默认 agent 回到 build

4. **输出 Phase 1 复查结论**：

   ```text
   Phase 1 复查结论:
   - 影响文件: intent.ts, engine-selector.ts, mention.ts, context-builder.ts, cache-warmth.ts,
                meta-agent.ts, meta.txt, agent.ts, subagent-permissions.ts, core/plugin/agent.ts
   - 已运行命令: lint + typecheck(aigcfroge+core) + test(aigcfroge+core) + 回退开关测试
   - Lint: [pass/fail]
   - Typecheck: [pass/fail]
   - Test: [pass/fail]
   - 安全门禁: [Catch Everything/No Null Pointer/Security First 逐项检查结果]
   - 工程门禁: [No Cheating/Reusability/Clean Logs 逐项检查结果]
   - 剩余风险: [none 或 具体风险描述]
   ```

5. **输出**："Phase 1 全部完成 ✓"

---

## 全局规则

### 代码风格（AGENTS.md 完整要求）

```
✅ 使用 Effect.gen(function* () {}) 进行组合
✅ 使用 Effect.fn("Domain.method") 命名效果函数
✅ 使用 Schema.Class / Schema.brand / Schema.TaggedErrorClass
✅ 使用 Effect.void 而非 Effect.succeed(undefined)
✅ 使用 export * as Foo from "./foo" 自导出
✅ 不使用 export namespace
✅ 不使用 barrel index.ts（多兄弟目录）
✅ 不使用 import { foo as bar } 别名
✅ 不使用 import * as Foo 星号导入
✅ 不使用 else（用 early return）
✅ 不使用 try/catch（Effect 内让错误自然传播）
✅ 使用 const 而非 let（用 ternary/reassignment avoidance）
✅ 使用 Inline 单用变量（如 await Bun.file(path.join(...)).json()）
✅ 使用 obj.a / obj.b 而非 const { a, b } = obj
✅ 禁止 as any（写注释原因说明）
✅ 禁止 @ts-ignore（用 @ts-expect-error 替代）
✅ 使用 Effect.forkIn(scope) 而非 Effect.fork/forkDaemon
✅ 使用 ChildProcessSpawner 而非 raw child_process
```

### 改完即审流程（CLAUDE.md 第 7 步）

每次写完代码后：

1. `git diff -- <改动的文件>` 锁定改动范围
2. 安全复查：Catch Everything / No Null Pointer / Security First
3. 整洁复查：No Cheating / Reusability / Clean Logs
4. 数据流追踪：每个改动的完整调用链
5. 运行命令：lint + typecheck + test
6. 输出复查结论卡片

### 禁止修改的文件

- `packages/schema/src/meta-agent.ts`（已有 meta-agent schema，不在此次修改范围）
- `packages/core/src/database/migration/20260629103917_meta_agent.ts`（已存在的 migration）
- 任何 `*.test.ts` 之外的已有测试文件
- 任何已有智能体的行为（build/plan/general/explore 等）
- `packages/aigcfroge/src/session/processor.ts`（Phase 2+ 才需要介入）
- `packages/aigcfroge/src/tool/task.ts`（Phase 2+ 才需要修改）

---

## 任务完成检查清单

在 Phase 1 全部完成后，逐项检查：

- [ ] `intent.ts` — 7 种意图分类、中英文支持、正则匹配
- [ ] `engine-selector.ts` — 意图→引擎映射、复杂度默认
- [ ] `mention.ts` — @name 解析、pipeline/parallel 检测
- [ ] `context-builder.ts` — 委派上下文模板、历史注入
- [ ] `cache-warmth.ts` — Context.Service + Layer、SHA 跟踪
- [ ] `meta.txt` — L1 区字节锁定、L2 占位符
- [ ] `meta-agent.ts` — 权限继承 buildDefaults + 编排特权
- [ ] `agent.ts` — meta 条目注册、默认逻辑、回退开关
- [ ] `subagent-permissions.ts` — meta 子智能体特殊处理
- [ ] `core/plugin/agent.ts` — V2 meta 注册
- [ ] 所有测试通过
- [ ] L1 SHA256 锁定测试通过
- [ ] `AIGCFROGE_DISABLE_META_AGENT=true` 回退验证通过
- [ ] lint 零错误
- [ ] typecheck 零错误

---

## 参考文件速查

### 当前项目关键路径

| 文件                                                   | 用途               |
| ------------------------------------------------------ | ------------------ |
| `CLAUDE.md`                                            | 执行宪法           |
| `AGENTS.md`                                            | 代码风格           |
| `docs/architecture/system-blueprint.md`                | 架构总览           |
| `docs/prd/meta-agent-orchestrator.md`                  | PRD                |
| `docs/plan/meta-agent-orchestrator.md`                 | 实施计划           |
| `packages/aigcfroge/src/agent/agent.ts`                | Agent 注册表       |
| `packages/aigcfroge/src/agent/subagent-permissions.ts` | 子智能体权限       |
| `packages/core/src/agent.ts`                           | V2 AgentService    |
| `packages/core/src/plugin/agent.ts`                    | V2 内置 agent 注册 |
| `packages/aigcfroge/src/tool/task.ts`                  | Task 工具          |
| `packages/aigcfroge/src/tool/tool.ts`                  | Tool 定义框架      |
| `packages/plugin/src/v2/effect/context.ts`             | PluginContext      |
| `packages/core/src/meta-agent/sql.ts`                  | meta_agent 数据表  |

### 外部参考路径

| 路径                                                                                              | 用途           |
| ------------------------------------------------------------------------------------------------- | -------------- |
| `/home/keer/Documents/web/aigcfroge/packages/opencode/src/agent/meta-agent.ts`                    | meta 定义参考  |
| `/home/keer/Documents/web/aigcfroge/packages/opencode/src/agent/meta/intent.ts`                   | 意图分类参考   |
| `/home/keer/Documents/web/aigcfroge/packages/opencode/src/agent/meta/engine-selector.ts`          | 引擎路由参考   |
| `/home/keer/Documents/web/aigcfroge/packages/opencode/src/agent/meta/adapters/interface.ts`       | CLI 适配器参考 |
| `/home/keer/Documents/web/aigcfroge/packages/opencode/src/agent/meta/protocol/context-builder.ts` | 委派上下文参考 |
