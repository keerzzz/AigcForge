# 实施计划：在 @ 提及自动补全中显示外部 CLI 智能体

> 目标：用户在输入框输入 `@` 时，除了内置/项目智能体外，还能看到本地已安装的外部 CLI 智能体（如 `claude-code`、`gemini`、`codex`、`opencode`）。

---

## 1. 问题定义

### 1.1 现象

输入框输入 `@` 后只显示两个项目智能体，没有外部 CLI 智能体。

### 1.2 根因

外部 CLI 适配器与项目智能体注册在**两个独立的注册表**中：

- **项目/内置智能体**：`Agent.Service`（`packages/aigcfroge/src/agent/agent.ts`），通过 `Agent.Service.list()` 暴露给前端同步模型。
- **外部 CLI 适配器**：`CliAdapterRegistry`（`packages/aigcfroge/src/agent/meta/adapters/registry.ts`），只在 `task` 工具执行 `execution_type: "external-cli"` 时使用，**从未暴露给 `Agent.Service.list()` 或前端**。

前端 `@` 自动补全的数据源是 `sync.data.agent`，后端来自 `GET /agent` → `agent.list()`。由于 `Agent.Service.list()` 不知道 `AdapterRegistry`，CLI 智能体对输入框不可见。

### 1.3 相关代码位置

| 层级 | 文件 | 职责 |
|------|------|------|
| 后端 Agent 服务 | `packages/aigcfroge/src/agent/agent.ts` | 定义 `Agent.Info` schema 和 `Agent.Service.list()` |
| CLI 适配器注册表 | `packages/aigcfroge/src/agent/meta/adapters/registry.ts` | 注册 `claude-code`、`gemini`、`codex`，提供 `available()` |
| HTTP API | `packages/aigcfroge/src/server/routes/instance/httpapi/groups/instance.ts` | `/agent` endpoint，返回 `Schema.Array(Agent.Info)` |
| HTTP handler | `packages/aigcfroge/src/server/routes/instance/httpapi/handlers/instance.ts` | `getAgent = agent.list()` |
| 前端同步 | `packages/app/src/context/global-sync/bootstrap.ts` | 调用 `sdk.app.agents()` |
| 前端归一化 | `packages/app/src/context/global-sync/utils.ts` | `normalizeAgentList` / `isAgent` |
| App 自动补全 | `packages/app/src/components/prompt-input.tsx` | 构建 `@` option 列表 |
| App 弹出层 | `packages/app/src/components/prompt-input/slash-popover.tsx` | 渲染 `@` 下拉行 |
| TUI 自动补全 | `packages/tui/src/component/prompt/autocomplete.tsx` | TUI 的 `@` option 列表 |
| Mention 解析 | `packages/core/src/agent/meta/mention.ts` | 解析 `@name` 为 `subagent` 或 `external-cli` |
| PreRouter | `packages/core/src/agent/meta/prerouter.ts` | 硬编码 `EXTERNAL_CLI_NAMES` 做路由 |
| Meta prompt | `packages/core/src/plugin/agent.ts` | 硬编码 `{{CLI_LIST}}` |

---

## 2. 设计决策

### 2.1 推荐方案：在 `Agent.Info` 中增加 `source` 字段

让 `Agent.Service.list()` 将 `AdapterRegistry.available()` 返回的 CLI 适配器**合成为 Agent 条目**，并通过新增的 `source` 字段区分来源。

```ts
// Agent.Info schema 新增字段
source: Schema.optional(Schema.Literals(["native", "external-cli"]))
```

合成后的 CLI agent 示例：

```ts
{
  name: "claude-code",
  description: "Claude Code CLI — Anthropic's official AI coding assistant",
  mode: "subagent",          // 保持为 subagent，避免进入 primary agent switcher
  source: "external-cli",
  native: false,
  hidden: false,
  permission: [],
  options: {}
}
```

### 2.2 为什么不用 `mode: "external-cli"`

前端现有逻辑用 `mode` 做两道过滤：

- `@` 列表：`mode !== "primary"`
- primary agent switcher：`mode !== "subagent"`

如果新增 `mode: "external-cli"`，两处过滤都需要改，且会破坏“外部 CLI 不应作为会话主智能体”的语义。用 `source` 标记来源，`mode` 保持 `subagent`，影响面最小。

### 2.3 为什么合并到 `Agent.Service.list()` 而不是新增独立 endpoint

- 前端只需改一处数据源，无需新增同步字段。
- `@` 列表、agent switcher、meta prompt 的 subagent 列表都可以自然消费同一来源。
- 与现有 `AgentV2.all()` 的 agent registry 概念对齐，避免两个并行概念。

---

## 3. TDD 流程

### Phase 1：先写/对齐测试

#### 3.1 后端测试

**文件 1：`packages/aigcfroge/test/agent/agent.test.ts`**

在现有 `Agent.list()` 测试基础上新增：

```ts
it.instance("Agent.list includes available external CLI adapters", () =>
  Effect.gen(function* () {
    const agents = yield* load((svc) => svc.list())
    const cliAgents = agents.filter((a) => a.source === "external-cli")
    expect(cliAgents.some((a) => a.name === "claude-code")).toBe(true)
    expect(cliAgents.every((a) => a.mode === "subagent")).toBe(true)
    expect(cliAgents.every((a) => !a.hidden)).toBe(true)
  }),
)
```

> 注意：`AdapterRegistry.available()` 会调用 `which`，测试环境可能未安装某些 CLI。测试应断言**已安装的** CLI 出现，或 mock `detect()`。

**文件 2：`packages/aigcfroge/test/agent/meta/adapters/registry.test.ts`**

已覆盖 `available()` 返回通过 `detect()` 的适配器。保持现有测试，可能新增一个测试断言 `available()` 返回的条目可被转换为 Agent 形状。

**文件 3：`packages/aigcfroge/test/server/httpapi-instance.test.ts`**

新增 `/agent` endpoint 测试：

```ts
it.live("GET /agent returns external CLI adapters with source", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped({ git: true })
    const response = yield* HttpClientRequest.get(InstancePaths.agent).pipe(
      directoryHeader(dir),
      HttpClient.execute,
    )
    expect(response.status).toBe(200)
    const agents = yield* response.json
    expect(Array.isArray(agents)).toBe(true)
    const cliAgents = (agents as any[]).filter((a) => a.source === "external-cli")
    expect(cliAgents.some((a) => a.name === "claude-code")).toBe(true)
    expect(cliAgents.every((a) => a.mode === "subagent")).toBe(true)
  }),
)
```

**文件 4：`packages/aigcfroge/test/agent/meta/mention.test.ts` / `prerouter.test.ts`**

- 扩展 `MetaMention.parse` 测试，验证传入动态 CLI 列表时正确识别 `external-cli` 类型。
- 扩展 `PreRouter` 测试，验证 `@claude-code` 路由到 `external-cli` 引擎。

#### 3.2 前端测试

**文件 5：`packages/app/src/context/global-sync/utils.test.ts`（新建或扩展）**

```ts
it("normalizeAgentList keeps external-cli agents", () => {
  const agents = normalizeAgentList([
    { name: "claude-code", mode: "subagent", source: "external-cli" },
    { name: "build", mode: "primary" },
  ])
  expect(agents.map((a) => a.name)).toContain("claude-code")
})
```

**文件 6：`packages/app/src/components/prompt-input/autocomplete.test.tsx`（新建）**

- 渲染 `PromptInput`，传入包含 CLI agent 的 `controls.agents.available`。
- 输入 `@`，断言下拉中出现 `@claude-code`。
- 选择 `@claude-code`，断言插入的 part 包含 CLI 标识。

**文件 7：TUI `packages/tui/test/prompt/autocomplete.test.tsx`（新建或扩展）**

- 向 `sync.data.agent` 注入 CLI agent。
- 断言 `@` 可见选项包含 `claude-code`。

#### 3.3 测试运行策略

每写一个测试就先运行，确认当前失败（红色）：

```bash
bun --cwd packages/aigcfroge test --timeout 30000 ./test/agent/agent.test.ts
bun --cwd packages/aigcfroge test --timeout 30000 ./test/server/httpapi-instance.test.ts
bun --cwd packages/aigcfroge test --timeout 30000 ./test/agent/meta/mention.test.ts
bun --cwd packages/aigcfroge test --timeout 30000 ./test/agent/meta/prerouter.test.ts
bun --cwd packages/app test
bun --cwd packages/tui test
```

---

### Phase 2：开发实现

#### 步骤 1：扩展 `Agent.Info` schema

**文件：`packages/aigcfroge/src/agent/agent.ts`**

在 `Info` schema 中新增 `source`：

```ts
export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  mode: Schema.Literals(["subagent", "primary", "all"]),
  source: Schema.optional(Schema.Literals(["native", "external-cli"])), // 新增
  native: Schema.optional(Schema.Boolean),
  hidden: Schema.optional(Schema.Boolean),
  // ... 其余不变
})
```

默认 `source` 为 `native`（可在合成时省略，保持现有数据不变）。

#### 步骤 2：让 `Agent.Service.list()` 合并 CLI 适配器

**文件：`packages/aigcfroge/src/agent/agent.ts`**

1. `Agent.layer` 依赖 `CliAdapterRegistry.Service`。
2. 在 `list()` 中调用 `AdapterRegistry.available()`，合成 Agent.Info 条目：

```ts
const list = Effect.fnUntraced(function* () {
  const cfg = yield* config.get()
  const cliAdapters = yield* cliAdapterRegistry.available()
  const cliAgents = cliAdapters.map((adapter) => ({
    name: adapter.name,
    description: adapter.description,
    mode: "subagent" as const,
    source: "external-cli" as const,
    native: false,
    hidden: false,
    permission: [],
    options: {},
  }))

  return pipe(
    [...agents.values(), ...cliAgents],
    sortBy(
      [(x) => (cfg.default_agent ? x.name === cfg.default_agent : process.env.AIGCFROGE_DISABLE_META_AGENT === "true" ? x.name === "build" : x.name === "meta"), "desc"],
      [(x) => x.name, "asc"],
    ),
  )
})
```

> 注意：避免在 `list()` 中对 `meta`、`build` 等 primary agent 设置 `source`，保持未定义即视为 `native`。

#### 步骤 3：更新 Agent layer 依赖

**文件：`packages/aigcfroge/src/agent/agent.ts`**

- `Agent.layer` yield `CliAdapterRegistry.Service`。
- `Agent.defaultLayer` 需要 `Layer.provide(CliAdapterRegistry.defaultLayer)`。
- `Agent.node` 需要依赖 `CliAdapterRegistry.node`。

检查 `AppLayer`（`packages/aigcfroge/src/effect/app-runtime.ts`）是否已提供 `CliAdapterRegistry`：

- `ToolRegistry.defaultLayer` 已 provide `CliAdapterRegistry.defaultLayer`。
- 若 `Agent.defaultLayer` 改为依赖 `CliAdapterRegistry`，需确保 `AppLayer` 的 merge 顺序正确。推荐显式在 `AppLayer` 中加入 `CliAdapterRegistry.defaultLayer`（即使已有，也避免隐式依赖）。

#### 步骤 4：HTTP API 自动生效

`/agent` endpoint 返回 `Schema.Array(Agent.Info)`，schema 变更后 OpenAPI 会自动更新，无需手动改路由/handler。

#### 步骤 5：重新生成 SDK

**文件：`packages/sdk/js/src/v2/gen/types.gen.ts`**

运行 SDK 生成脚本：

```bash
bun --cwd packages/sdk/js build
```

该脚本会：

1. 在 `packages/aigcfroge` 跑 `bun dev generate` 生成 `openapi.json`。
2. 用 `@hey-api/openapi-ts` 重新生成 `src/v2/gen/*`。
3. 运行 prettier 和 tsc。

生成后确认 `Agent` type 包含 `source?: "native" | "external-cli"`。

#### 步骤 6：前端归一化

**文件：`packages/app/src/context/global-sync/utils.ts`**

`isAgent` 当前只检查 `name` 和 `mode`。新增 `source` 是可选字符串，不影响现有过滤。若需严格校验，可扩展为：

```ts
function isAgent(input: unknown): input is Agent {
  if (!input || typeof input !== "object") return false
  const item = input as { name?: unknown; mode?: unknown; source?: unknown }
  if (typeof item.name !== "string") return false
  if (item.mode !== "subagent" && item.mode !== "primary" && item.mode !== "all") return false
  if (item.source !== undefined && item.source !== "native" && item.source !== "external-cli") return false
  return true
}
```

#### 步骤 7：App 自动补全

**文件：`packages/app/src/components/prompt-input.tsx`**

在 `agentList` memo 中保留 CLI agent：

```ts
const agentList = createMemo(() =>
  props.controls.agents.available
    .filter((agent) => !agent.hidden && (agent.mode !== "primary" || agent.source === "external-cli"))
    .map((agent): AtOption => ({
      type: "agent",
      name: agent.name,
      display: agent.name,
      source: agent.source,
      description: agent.description,
    })),
)
```

> 当前过滤 `mode !== "primary"` 会把 CLI agent 也排除（如果它们被错误标记为 primary）。由于我们设置 `mode: "subagent"`，常规过滤即可通过。但为防御性，可显式放行 `source === "external-cli"`。

**文件：`packages/app/src/components/prompt-input/slash-popover.tsx`**

扩展 `AtOption` 类型：

```ts
export type AtOption =
  | { type: "agent"; name: string; display: string; source?: "native" | "external-cli"; description?: string }
  | { type: "file"; path: string; display: string; recent?: boolean }
```

在渲染 agent 行时，若 `source === "external-cli"`，显示 terminal 图标和 `[CLI]` 标签（或 i18n key）。

#### 步骤 8：TUI 自动补全

**文件：`packages/tui/src/component/prompt/autocomplete.tsx`**

扩展 agents memo：

```ts
const agents = createMemo(() => {
  return sync.data.agent
    .filter((agent) => !agent.hidden && agent.mode !== "primary")
    .map((agent): AutocompleteOption => ({
      display: "@" + agent.name,
      description: agent.source === "external-cli" ? `[CLI] ${agent.description ?? ""}` : agent.description,
      onSelect: () => {
        insertPart(agent.name, {
          type: "agent",
          name: agent.name,
          source: agent.source,
          // ...
        })
      },
    }))
})
```

TUI 文本行可在前缀加 `[CLI]` 以区分。

#### 步骤 9：Core prerouter 动态化

**文件：`packages/core/src/agent/meta/prerouter.ts`**

当前硬编码：

```ts
const EXTERNAL_CLI_NAMES = ["claude-code", "gemini", "codex", "opencode"]
const parsed = parse(trimmed, ["build", "explore", "plan", "general"], EXTERNAL_CLI_NAMES)
```

改为让 `preRoute` 接受 `knownCLIs: string[]` 参数，调用方从 `Agent.list()` 或 `AdapterRegistry.available()` 传入：

```ts
export function preRoute(input: string, knownAgents: string[], knownCLIs: string[]): RouteResult {
  // ...
  const parsed = parse(trimmed, knownAgents, knownCLIs)
  // ...
}
```

并在 V1/V2 runner 调用处传入当前可用的 CLI 名称列表。

> 这一步可选，但如果保留硬编码，新增 CLI adapter（用户自定义）不会走 `@mention` 路由。

#### 步骤 10：Meta prompt 动态化

**文件：`packages/core/src/plugin/agent.ts`**

当前硬编码：

```ts
.replace("{{CLI_LIST}}", "(configured via AdapterRegistry — claude-code, codex, gemini)")
```

改为通过 `AdapterRegistry.available()` 获取名称并渲染：

```ts
const cliList = (yield* cliAdapterRegistry.available())
  .map((adapter) => `- ${adapter.name}: ${adapter.description ?? ""}`)
  .join("\n")
item.system = PROMPT_META
  .replace("{{SUBAGENTS_LIST}}", subagentList || "(no subagents registered)")
  .replace("{{CLI_LIST}}", cliList || "(no external CLI tools configured)")
```

这要求 `AgentV2` 的初始化层能访问 `CliAdapterRegistry`。由于 `plugin/agent.ts` 在 `AgentV2.layer` 的 transform 中执行，需要确保 `CliAdapterRegistry` 在该 scope 中可用。

---

### Phase 3：验证

#### 3.1 类型检查

```bash
bun --cwd packages/aigcfroge typecheck
bun --cwd packages/core typecheck
bun --cwd packages/app typecheck
bun --cwd packages/tui typecheck
bun --cwd packages/sdk/js typecheck
```

#### 3.2 Lint

```bash
bun run lint
```

确认修改文件无新增 lint error/warning。

#### 3.3 单元/集成测试

```bash
bun --cwd packages/aigcfroge test --timeout 30000 ./test/agent/agent.test.ts
bun --cwd packages/aigcfroge test --timeout 30000 ./test/agent/meta/adapters/registry.test.ts
bun --cwd packages/aigcfroge test --timeout 30000 ./test/agent/meta/mention.test.ts
bun --cwd packages/aigcfroge test --timeout 30000 ./test/agent/meta/prerouter.test.ts
bun --cwd packages/aigcfroge test --timeout 30000 ./test/server/httpapi-instance.test.ts
bun --cwd packages/aigcfroge test --timeout 30000 ./test/tool/task.test.ts
bun --cwd packages/app test
bun --cwd packages/tui test
```

#### 3.4 端到端手动验证

1. 启动后端：

```bash
cd packages/aigcfroge
bun run --conditions=browser ./src/index.ts serve --port 4096
```

2. 启动 App：

```bash
cd packages/app
bun dev -- --port 4444
```

3. 打开 `http://localhost:4444`，在会话输入框输入 `@`，确认：
   - 出现 `@claude-code`（若已安装 `claude` 命令）。
   - CLI 行有 terminal 图标或 `[CLI]` 标签。
   - 选择 `@claude-code` 后发送消息，模型能正确路由到外部 CLI 执行。

---

## 4. 风险与技术债

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| `AdapterRegistry.available()` 调用 `which` 可能耗时 | `/agent` 请求变慢 | 只在 `Agent.list()` 调用时检测；结果可被 InstanceState 缓存 |
| 新增 `source` 字段需要重新生成 SDK | 增加提交大小 | 将 SDK 生成作为独立 commit；确保生成的类型与 schema 一致 |
| CLI agent 被错误当作 primary agent | 可能出现在 agent switcher | 强制 `mode: "subagent"`；过滤逻辑显式放行而非改变 mode |
| 自定义 CLI adapter 名称与内置 agent 冲突 | `Agent.list()` 去重问题 | 在合成前检查冲突，冲突时 CLI adapter 优先或报错 |
| TUI/App 对 `source` 字段的消费不一致 | UI 行为分叉 | 两端同时修改，并在计划中列明统一模式 |
| PreRouter 动态化涉及调用方修改 | 影响 V1/V2 runner | 在计划中单独标注，分阶段实现；可先保留硬编码，后续迭代 |

---

## 5. 最小可交付版本（MVP）

如果希望分阶段交付，第一期可只做：

1. `Agent.Info` schema 加 `source`。
2. `Agent.Service.list()` 合并 `AdapterRegistry.available()`。
3. `Agent.layer` / `Agent.node` 依赖 `CliAdapterRegistry`。
4. SDK 重新生成。
5. App 和 TUI 的 `@` 自动补全显示 CLI agent。

这样即可解决“输入框看不到 CLI 智能体”的问题。`prerouter` 和 `meta prompt` 的动态化可作为第二期。

---

## 6. 变更清单

### 后端

- `packages/aigcfroge/src/agent/agent.ts`：新增 `source` schema 字段；`Agent.Service.list()` 合并 CLI adapters；更新 layer/node 依赖。
- `packages/aigcfroge/src/effect/app-runtime.ts`：确保 `CliAdapterRegistry` 在 `AppLayer` 中显式提供（如尚未提供）。
- `packages/core/src/plugin/agent.ts`：动态填充 `{{CLI_LIST}}`（可选/MVP 后）。
- `packages/core/src/agent/meta/prerouter.ts`：`preRoute` 接受动态 CLI 列表（可选/MVP 后）。

### SDK

- `packages/sdk/js/src/v2/gen/types.gen.ts`：重新生成后 `Agent` 类型包含 `source`。

### 前端

- `packages/app/src/context/global-sync/utils.ts`：`isAgent` 校验 `source`。
- `packages/app/src/components/prompt-input.tsx`：`agentList` 保留 CLI agent。
- `packages/app/src/components/prompt-input/slash-popover.tsx`：扩展 `AtOption`，渲染 CLI 标签/图标。
- `packages/tui/src/component/prompt/autocomplete.tsx`：渲染 CLI agent 并加 `[CLI]` 前缀。

### 测试

- `packages/aigcfroge/test/agent/agent.test.ts`：`Agent.list()` 包含 CLI adapters。
- `packages/aigcfroge/test/server/httpapi-instance.test.ts`：`GET /agent` 返回 CLI adapters。
- `packages/aigcfroge/test/agent/meta/mention.test.ts` / `prerouter.test.ts`：动态 CLI 列表解析与路由。
- `packages/app/src/context/global-sync/utils.test.ts`：归一化保留 CLI agent。
- `packages/app/src/components/prompt-input/autocomplete.test.tsx`（新建）：`@` 补全包含 CLI。
- TUI 测试扩展或新建。

---

## 7. 参考协议与规范

- `AGENTS.md`：Effect 编码、`InstanceState`、Layer 组合、self-export 模式。
- `CLAUDE.md`：测试从包目录运行、typecheck 用 `tsgo`、禁止 `export namespace`、优先复用。
- `.aigcfroge/skills/effect/SKILL.md`：`Effect.gen`、`Effect.fn`、测试用 `testEffect`、显式 layer。
- `.aigcfroge/skills/frontend-theming/SKILL.md`：新 UI 用 v2 token，CSS 不硬编码颜色。
- `packages/app/AGENTS.md`：SolidJS 优先 `createStore`、浏览器自动化用 `agent-browser`。

---

## 8. 建议的提交顺序

1. `test(aigcfroge): add failing tests for CLI adapters in Agent.list and /agent endpoint`
2. `feat(aigcfroge): include available CLI adapters in Agent.Service.list`
3. `chore(sdk): regenerate v2 SDK types with Agent.source`
4. `feat(app,tui): render external CLI agents in @ mention autocomplete`
5. `test(app,tui): autocomplete coverage for external CLI agents`
6. `refactor(core): use dynamic CLI list in prerouter and meta prompt`（可选/MVP 后）
