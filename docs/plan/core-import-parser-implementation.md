# Core Import Parser 实施计划（TDD 全流程）

> 状态：**Implemented**（2026-07-29，合入 main @ `8fe23378b`）
> 依据：[Chat PRD §7.3](../prd/chat-mode-creation-layer.md)（Approved 2026-07-18）、[M7 实施计划](../plan/chat-m7-create-import-loop.md)（Approved 2026-07-27）、[CLAUDE.md](../../CLAUDE.md)、[AGENTS.md](../../AGENTS.md)
> 前置：无硬前置（独立 Core service + API 端点，不依赖 ADR-15 或 Session Capture）
> 范围：`packages/core`（ImportParser Effect service）+ `packages/schema`（parse types）+ `packages/aigcfroge`（HTTP endpoint + handler）+ `packages/sdk/js`（regenerate）+ `packages/app`（ImportDialog 集成）
> 分支：`core-import-parser`（从 main 切出）
> **本文件为自包含实施手册，可供其他 agent 独立执行。**

---

## 0. 背景与目标

### 0.1 现状

M7 的 ImportDialog（[chat-import-dialog.tsx](packages/app/src/components/chat/chat-import-dialog.tsx)）将导入内容包裹 `<untrusted_import>` 标记后直接传给 chat-orchestrator Agent 解析。这违反了 PRD §7.3 的架构要求：

> **解析器属 Core service（Effect），禁止放 App**；TUI/CLI 同为消费者，不可信输入解析必须在服务端边界完成，App 只负责传入原始文本与展示解析结果。

### 0.2 当前数据流（M7，非目标状态）

```text
ImportDialog → serializeImport() → wrapImportContent("<untrusted_import>…")
  → create chat Draft → chat-orchestrator → Agent parse → propose_*
```

问题：
- 解析在 LLM 边界做（不可控、不结构化、不可 audit）
- 无 serviced 边界（TUI/CLI 无法复用）
- 无法做预校验（超限、格式错误在 Agent 调用后才暴露）

### 0.3 目标数据流

```text
ImportDialog → serializeImport() → POST /import-asset/parse (Effect service)
  → Core ImportParser 解析 → 结构化候选列表
  → App 展示候选列表（每个候选 = kind + name + description + template）
  → 用户逐条确认/编辑 → POST /<kind>-asset/apply → registry
```

**非解析部分不变**（仍走 Agent 流线）：用户也可选择"AI 辅助整理"按钮跳 chat 流线，M7 ImportDialog 的已有 chat draft 流线保留为 fallback。

### 0.4 非目标

- 不做 CLI/TUI 消费端（先建 Core service，消费端后续各自接入）
- 不做 AI 增强解析（Core parser 是确定性规则引擎，不是 LLM 调用）
- 不做批量导入逐条确认 UI（本阶段做结构化输出，UI 增强延后）
- 不替换 M7 ImportDialog 的 Agent 解析路径（作为 fallback 保留）

---

## 1. 架构

```text
┌─ schema 层 ────────────────────────────────────────────┐
│  schema/import-parser.ts                               │
│  ImportParser.Candidate { kind, name, ... }            │
│  ImportParser.Candidate / ImportParser.Result / ...   │
└───────────────────────────┬──────────────────────────┘
                            ↓
┌─ core 层 ──────────────────────────────────────────────┐
│  core/src/import-parser.ts                             │
│  ImportParser.Interface: parse(input) → Effect<Result> │
│  ImportParser Service: deterministic rule engine       │
│  ImportParser.extractCandidates:                       │
│    - Markdown code blocks → candidates                 │
│    - YAML/JSON blocks → structured candidates          │
│    - Plain text → single prompt candidate              │
│    - Strip thinking/chat noise patterns                │
└───────────────────────────┬──────────────────────────┘
                            ↓
┌─ aigcfroge 层 ─────────────────────────────────────────┐
│  groups/import-parser.ts                               │
│  handlers/import-parser.ts                             │
│  POST /import-asset/parse { content, sourceKind? }     │
│    → { candidates: Candidate[], warnings: ... }        │
└───────────────────────────┬──────────────────────────┘
                            ↓
┌─ sdk/js 层 ───────────────────────────────────────────┐
│  ImportAsset client: parse({ content, sourceKind? })  │
└───────────────────────────┬──────────────────────────⎦
                            ↓
┌─ app 层 ───────────────────────────────────────────────┐
│  ImportDialog: 调用 SDK.parse() 展示候选列表           │
│  保留 "AI 辅助整理" fallback（走 chat Draft 流线）     │
└────────────────────────────────────────────────────────⎦
```

---

## 2. 五层代码追踪

### L1 schema 层

| 文件 | 说明 |
|------|------|
| `packages/schema/src/prompt-asset.ts` | PromptAsset.Candidate（参照模式） |
| `packages/schema/src/asset.ts` | AssetKindId 定义 |

### L2 core 层

| 文件 | 行 | 说明 |
|------|-----|------|
| `packages/core/src/prompt-asset-service.ts` | 1-60 | Service Interface 模式（参照） |
| `packages/core/src/prompt-asset.ts` | 全文件 | Registry loadDir 模式（参照） |
| `packages/core/src/asset-kind.ts` | 全文件 | AssetKindRegistry（参照） |

### L3 aigcfroge 层

| 文件 | 说明 |
|------|------|
| `packages/aigcfroge/src/server/routes/instance/httpapi/groups/prompt-asset.ts` | Group 定义（参照） |
| `packages/aigcfroge/src/server/routes/instance/httpapi/handlers/prompt-asset.ts` | Handler 实现（参照） |
| `packages/aigcfroge/src/server/routes/instance/httpapi/api.ts` | Api group 注册点 |

### L4 sdk/js 层

| 文件 | 说明 |
|------|------|
| `packages/sdk/js/script/build.ts` | SDK 生成脚本 |
| `packages/sdk/js/src/v2/gen/sdk.gen.ts` | 生成代码（ImportAsset client 会在这里出现） |

### L5 app 层

| 文件 | 行 | 说明 |
|------|-----|------|
| `packages/app/src/components/chat/chat-import-dialog.tsx` | 129-201 | 当前 ImportDialog 组件 |
| `packages/app/src/components/chat/chat-import-dialog.tsx` | 91-94 | `wrapImportContent()` |
| `packages/app/src/components/chat/chat-import-dialog.tsx` | 82-88 | `serializeImport()` |
| `packages/app/src/pages/home.tsx` | 503-519 | `onImportAsset()` — 当前走 chat Draft |

---

## 3. TDD 工作流总则

```
Step A 认知加载：精读本计划全文 + CLAUDE.md（每次执行前重新阅读）
Step B 写测试：先写测试确认按预期失败（红）
Step C 写实现：最小功能代码通过测试（绿）
Step D 命令验证：bun run lint + 受影响包 typecheck + 受影响包 test
Step E 复查结论：按 CLAUDE.md §改完即审 模板输出
Step F 再次认知：重新阅读 CLAUDE.md + PRD §7.3 + AGENTS.md
全部通过 → 进入下一步
```

---

## 4. 实施步骤

### Step 1: Schema — ImportParser.Candidate + ImportParser.Result

**改动文件**：
- `packages/schema/src/import-parser.ts`（新增）
- `packages/schema/src/index.ts`（export）

**红（测试）**：
```ts
// packages/schema/test/import-parser.test.ts
it("Candidate encodes/decodes valid candidate", () => {
  // kind="prompt", name="test", description="desc", template="body"
})
it("Candidate rejects empty name", () => {
  // "" → decode error
})
it("Result encodes with warnings and ParseError[]", () => {
  // { candidates: [], warnings: ["bad_format"], errors: [{section: "Block #1", reason: "unknown_type"}] }
})
```

**绿**：

```ts
// packages/schema/src/import-parser.ts
// 遵循项目命名约定（PromptAsset.Summary / PromptAsset.Info 模式）：命名空间 ImportParser
export class Candidate extends Schema.Class<Candidate>("ImportParser.Candidate")({
  kind: Schema.String,       // AssetKindId: "prompt"|"command"|"skill"|...
  name: Schema.String,       // 1..80 code points
  description: Schema.String,// 0..300 code points
  template: Schema.String,   // 1..100_000 UTF-8 bytes
}) {}

export class ParseError extends Schema.Class<ParseError>("ImportParser.ParseError")({
  section: Schema.String,    // 出错区段标识（如 "Block #3"）
  reason: Schema.String,     // 解析失败原因（如 "unknown_type"）
}) {}

export class Result extends Schema.Class<Result>("ImportParser.Result")({
  candidates: Schema.Array(Candidate),
  warnings: Schema.Array(Schema.String), // strip 掉的内容摘要（不含原文）
  errors: Schema.Array(ParseError),      // Schema.Class 替代内联 Struct（AGENTS.md 要求）
}) {}
```

**验证**：
```bash
bun --cwd packages/schema typecheck
bun --cwd packages/schema test --timeout 30000
bun run lint
```

**Step F 再次认知**：重新阅读 CLAUDE.md、PRD §7.3。

---

### Step 2: Core — ImportParser Service

**改动文件**：
- `packages/core/src/import-parser.ts`（新增）
- `packages/core/test/import-parser.test.ts`（新增）

**红（测试）**：
```ts
// packages/core/test/import-parser.test.ts
it("extracts single Markdown code block as prompt candidate", () => {
  const input = "```\nYou are a helpful assistant\n```"
  // candidates: [{ kind: "prompt", template: "You are a helpful assistant" }]
})
it("extracts named code block with language hint", () => {
  const input = "```yaml\nname: my-workflow\nsteps: []\n```"
  // candidates: [{ kind: "workflow", ... }]
})
it("strips thinking/analysis noise blocks", () => {
  const input = "Let me think...\n<thinking>irrelevant</thinking>\n\nActually, here:\n```\nprompt text\n```"
  // candidates present, thinking text NOT included
  // warnings: ["stripped_thinking"]
})
it("strips chat conversation noise", () => {
  const input = "User: ...\nAssistant: ...\n\nHere's the template:\n```\n...\n```"
  // candidates extracted, conversation noise stripped
})
it("handles plain text as single prompt candidate", () => {
  const input = "You are a code reviewer. Check for bugs."
  // candidates: [{ kind: "prompt", ... }]
})
it("injects name from first line or heading", () => {
  const input = "# Code Review Prompt\n\nCheck for these bugs: ..."
  // candidates: [{ name: "Code Review Prompt", ... }]
})
it("handles empty input", () => {
  // Result: { candidates: [], errors: [{ reason: "empty" }] }
})
it("handles oversized input above limit", () => {
  // 200KB input → ParseError { reason: "too_large" }
})
it("handles multiple candidates from multi-block input", () => {
  // "```\nprompt1\n```\n\n```\nprompt2\n```"
  // 2 candidates
})
it("detects YAML as workflow/plugin kind", () => {
  // "```yaml\nkind: workflow\n...\n```" → kind="workflow"
})
it("detects JSON config as mcp/command kind", () => {
  // "```json\n{\"mcpServers\": ...}\n```" → kind="mcp"
})
```

**绿**：

`packages/core/src/import-parser.ts`：
- `ImportParser` = `Context.Tag<ImportParserInterface>()`
- `ImportParserInterface`：
  ```ts
  interface ImportParserInterface {
    parse(input: string, options?: { maxBytes?: number }): Effect.Effect<ImportParser.Result, ImportParser.ParseError>
  }
  ```
- 解析逻辑：
  1. 大小检查（超限 → `ImportParser.ParseError({ reason: "too_large" })`）
  2. 分区块（按 Markdown code blocks / YAML docs / 空行分隔）
  3. **JSON 解析**：` ```json ` 语言标记的 code block 先尝试 `JSON.parse`；失败时降级为纯文本处理
  4. 噪声剥离：`<thinking>...</thinking>`、纯 `User:/Assistant:` 对话行、元数据 header
  5. 类型推断：block 语言标记 + 内容特征 → kind；纯文本 → `"prompt"` 默认
  6. 名称推断：第一个 heading / 第一行（截断 80 chars）
  7. 输出 `ImportParser.Result`

**Layer**（参照 PromptAssetService 的 Layer 模式）：
```ts
export const ImportParserLive = Layer.effect(
  ImportParser,
  Effect.sync(() => ({
    parse: (input, options) => Effect.sync(() => {
      // 解析逻辑
      return ImportParser.Result.make({ candidates: [...], warnings: [...], errors: [...] })
    })
  }))
)
```

**Schema 错误**（TaggedErrorClass 遵循项目惯例——参考 prompt-asset.ts 命名模式）：
```ts
export class ParseError extends Schema.TaggedErrorClass<ParseError>()(
  "ImportParser.ParseError",
  { reason: Schema.String }
) {}
```

**验证**：
```bash
bun --cwd packages/core typecheck
bun --cwd packages/core test --timeout 30000
bun run lint
```

**Step F 再次认知**：重新阅读 CLAUDE.md、PRD §7.3、Clean Logs。

---

### Step 3: HTTP API — Import Parser Endpoint + Handler

**改动文件**：
- `packages/aigcfroge/src/server/routes/instance/httpapi/groups/import-parser.ts`（新增）
- `packages/aigcfroge/src/server/routes/instance/httpapi/handlers/import-parser.ts`（新增）
- `packages/aigcfroge/src/server/routes/instance/httpapi/api.ts`（修改：注册 group）
- `packages/aigcfroge/src/server/routes/instance/httpapi/server.ts`（修改：提供 handler）

**红（测试）**：
```ts
// packages/aigcfroge/test/import-parser-api.test.ts
it("POST /import-asset/parse returns candidates", async () => {
  // payload: { content: "```\nprompt text\n```" }
  // response: { candidates: [{ kind: "prompt", ... }] }
})
it("POST /import-asset/parse returns warnings for stripped content", async () => {
  // content with thinking tags → warnings present
})
it("POST /import-asset/parse returns error for empty content", async () => {
  // { content: "" } → error "empty"
})
it("POST /import-asset/parse returns error for oversized content", async () => {
  // >200KB → error "too_large"
})
```

**绿**：

1. Group 定义（参照 `groups/prompt-asset.ts` 模式）：
```ts
export class ImportParserGroup extends InstanceHttpApi.prefix("/import-asset")
  .add(HttpApiEndpoint.post("parse", "/parse")
    .setRequest(Schema.Struct({ content: Schema.String }))
    .setResponse(ImportParser.Result)
  ) {}
```

2. Handler（参照 `handlers/prompt-asset.ts` 模式）：
```ts
export const parseHandler = HttpApiBuilder.handle(ImportParserGroup, "parse", (payload) =>
  // 调 ImportParser.parse(payload.content)
  // 返回 ImportParser.Result
)
```

3. `api.ts` 注册：
```ts
.add(ImportParserGroup)
```

4. `server.ts` 提供：
```ts
import { importParserHandlers } from "./handlers/import-parser"
// ...
provide(importParserHandlers)
```

**验证**：
```bash
bun --cwd packages/aigcfroge typecheck
bun --cwd packages/aigcfroge test --timeout 30000
bun run lint
```

**Step F 再次认知**：重新阅读 CLAUDE.md、ARCHITECTURE.md §2。

---

### Step 4: SDK Regenerate + App ImportDialog Integration

**改动文件**：
- `packages/sdk/js/src/v2/gen/*`（regenerate）
- `packages/app/src/components/chat/chat-import-dialog.tsx`（集成 SDK.parse）

**红（测试）**：
```ts
// packages/app/src/components/chat/chat-import-dialog.test.ts（扩展）
it("calls SDK.parse on import review click", () => {
  // 点击 review → SDK.ImportAsset.parse() 调用
})
it("shows candidate list after parse success", () => {
  // parse 返回 candidates → 显示列表
})
it("shows parse warnings", () => {
  // warnings → 显示警告区域
})
it("shows parse errors", () => {
  // errors → 显示错误区域，apply 按钮 disabled
})
it("falls back to AI flow when user clicks 'AI 辅助整理'", () => {
  // 保留原有 chat Draft 流线
})
```

**绿**：

1. SDK regenerate：
```bash
./packages/sdk/js/script/build.ts
```

2. ImportDialog 集成：
```tsx
// chat-import-dialog.tsx
function handleImport() {
  const content = serializeImport(result)
  // Step 4A: 调 Core import-parser
  const parseResult = await sdk().ImportAsset.parse({ content })
  if (parseResult.candidates.length > 0) {
    // 显示候选列表 → 用户确认/编辑 → apply
    setCandidates(parseResult.candidates)
  }
  // parseResult.errors → 显示，apply 按钮 disabled
  // parseResult.warnings → 显示警告区域（不含原文）
}
```

保留原有 `onImport` callback 作为 fallback（"AI 辅助整理"按钮）。

**验证**：
```bash
./packages/sdk/js/script/build.ts
bun --cwd packages/sdk/js typecheck
bun --cwd packages/app typecheck
bun --cwd packages/app test --timeout 30000
bun run lint
```

**Step F 再次认知**：重新阅读 CLAUDE.md、PRD §7.3 + §7.1。

---

### Step 5: 全量验收

**改动文件**：无

**验收清单**：
```bash
# 1. 全量 typecheck
bun --cwd packages/schema typecheck
bun --cwd packages/core typecheck
bun --cwd packages/aigcfroge typecheck
bun --cwd packages/sdk/js typecheck
bun --cwd packages/app typecheck

# 2. 全量测试
bun --cwd packages/schema test --timeout 30000
bun --cwd packages/core test --timeout 30000
bun --cwd packages/aigcfroge test --timeout 30000
bun --cwd packages/app test --timeout 30000

# 3. Lint
bun run lint

# 4. SDK regenerate（确保无 build error）
./packages/sdk/js/script/build.ts

# 5. 手动验证（浏览器 ImportDialog）
# - 粘贴 Markdown code block → 解析为 prompt candidate
# - 导入 YAML 工作流文件 → 解析为 workflow candidate
# - 导入含噪声对话文本 → 噪声剥离、警告显示
# - 空内容 → 错误提示
# - "AI 辅助整理" fallback 仍可用
```

**复查结论**：
```text
复查结论:
- Step: 5 全量验收
- 影响文件: schema(1新) + core(1新) + aigcfroge(3新+1改) + sdk(regenerate) + app(1改)
- 命中 skills: effect（Effect service 编码）、frontend-theming（ImportDialog v2 token）
- 安全门禁: PASS（不可信输入在服务端解析/不执行/不注入 System Context）
- 工程门禁: PASS（复用 PromptAssetService 模式/无 new router）
- 已运行命令: typecheck + test + lint + sdk build
- 剩余风险: CLI/TUI 消费端未接入（非本期范围）
```

---

## 5. 依赖图与执行顺序

```text
Step 1 (Schema: ImportParser.Candidate + ImportParser.Result)
  ↓
Step 2 (Core: ImportParser Service + Layer)
  ↓
Step 3 (HTTP API: endpoint + handler + group registration)
  ↓
Step 4 (SDK regenerate + App ImportDialog integration)
  ↓
Step 5 (全量验收)
```

独立于 ADR-15 和 Session Capture，可并行执行。

---

## 6. 解析器规则表

### 6.1 块分割规则

| 分隔方式 | 正则/方法 | 优先级 |
|---------|----------|--------|
| Markdown fenced code blocks | `` ``` `...` ``` `` 或 `~~~...~~~` | 1（最高） |
| YAML document separators | `---` 开头行 | 2 |
| 空行分隔（plain text） | `\n\n+` | 3（fallback） |

### 6.2 类型推断规则

| 特征 | 推断 kind | 置信度 |
|------|----------|--------|
| ```` ```yaml ```` 含 `kind: workflow` / `steps:` | `"workflow"` | high |
| ```` ```yaml ```` 含 `name:` + `tools:` + `hooks:` | `"plugin"` | high |
| ```` ```yaml ```` 含 `triggers:` / `context:` | `"skill"` | high |
| ```` ```json ```` 含 `"mcpServers"` | `"mcp"` | high |
| ```` ```json ```` 含 `"commands"` | `"command"` | medium |
| ```` ```sh / ```bash ```` | `"command"` | medium |
| ```` ``` ```` （无语言标记）或 ```` ```md ```` | `"prompt"` | medium |
| 纯文本（无 code block） | `"prompt"` | low |

### 6.3 噪声剥离规则

| 模式 | 处理 |
|------|------|
| `<thinking>...</thinking>` / `<thought>...</thought>` | 剥离，warning `stripped_thinking` |
| `User:` / `Assistant:` / `Human:` / `AI:` 对话行 | 剥离行，warning `stripped_conversation` |
| `\n---\n` 做 YAML 分隔符时 | 保留（是文档结构） |
| 以 `<!--` / `/*` 开头的 metadata 注释 | 剥离 |
| 纯空白行连续超过 3 行 | 压缩为 1 空行 |
| 输入 > 200KB | error `too_large` |

### 6.4 名称推断规则

| 来源 | 示例 |
|------|------|
| Markdown heading `# Title` | name = "Title"（截断 80） |
| Code block 语言标记后的注释 | ` ```python # Web Scraper` → "Web Scraper" |
| 第一行非空文本 | 截断 80 |
| 无（default） | "Imported Asset {N}" |

---

## 7. 风险与回滚

| 风险 | 缓解 |
|------|------|
| 类型推断不准确 | 低置信度类型显示为建议值，用户可修改 |
| 噪声剥离过度 | 只剥离高可信模式；原始内容保留在 ImportDialog preview |
| M7 ImportDialog 兼容 | 保留现有 Agent 解析 fallback 路径 |

**回滚**：独立分支，可完整 revert。

---

## 8. 不在本文范围的延后

- CLI/TUI 消费端接入 ImportParser service
- 批量导入逐条确认 UI 增强
- AI 增强解析（LLM 辅助类型推断）
- 导入历史/undo
