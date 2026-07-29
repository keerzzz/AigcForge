你是 AigcForge 仓库（/media/keer/办公/aigcfroge）的高级全栈工程师。在 `core-import-parser` 分支上执行 Core Import Parser（PRD §7.3 路径 C）实施计划。计划全文见 `docs/plan/core-import-parser-implementation.md`。

---

## 0. 认知加载（写任何代码前必须精读）

按顺序读完以下文件：

```
CLAUDE.md              （根目录 — 第一性原理、八荣八耻、四大拒绝、门禁、改完即审流程）
AGENTS.md              （根目录 — 分支提交、Effect/Schema/测试规范、代码风格）
ARCHITECTURE.md        （根目录 §2/§3 — 系统全景、包拓扑、Layer 边界）
DESIGN.md              （根目录 — 产品性格、v2 token）
.aigcfroge/skills/effect/SKILL.md            （Effect v4 编码规范 — Schema.Class / TaggedErrorClass / Layer 模式）
.aigcfroge/skills/frontend-theming/SKILL.md  （v2 token 强制）
docs/prd/chat-mode-creation-layer.md         （PRD v4.6 §7.3 路径 C 外部导入全文）
docs/plan/chat-m7-create-import-loop.md      （M7 ImportDialog 现状）
docs/plan/core-import-parser-implementation.md （本计划全文，567 行）
```

读完才能在 `core-import-parser` 分支上开始写代码。

---

## 1. 目标

把 M7 ImportDialog 中的 Agent 解析替换为 Core 侧 Effect service——一个确定性规则引擎，从粘贴/导入的原始文本中结构化提取资产候选：

```text
ImportDialog → serializeImport() → POST /import-asset/parse (Effect service)
  → Core ImportParser 解析 → 结构化候选列表（kind + name + description + template）
  → App 展示候选列表 → 用户确认/编辑 → apply
```

M7 的 Agent 解析路径保留为 fallback（"AI 辅助整理"按钮）。

**范围**：`packages/schema`（import-parser.ts 新建）+ `packages/core`（import-parser.ts 新建）+ `packages/aigcfroge`（groups + handlers 新建）+ `packages/sdk/js`（regenerate）+ `packages/app`（chat-import-dialog.tsx 改）。**无硬前置，可独立执行**。

---

## 2. 五层代码验证（执行前 grep 确认）

```bash
# L1 schema — 参照模式
grep -n "class.*Summary\|class.*Info\|class.*Candidate" packages/schema/src/prompt-asset.ts | head -10
grep -n "AssetKindId" packages/schema/src/asset.ts | head -5

# L2 core — 参照 Service 模式
head -60 packages/core/src/prompt-asset-service.ts
grep -n "Context.Tag\|Layer.effect\|Layer.succeed" packages/core/src/prompt-asset-service.ts | head -10

# L3 HTTP API — 参照 Group/Handler 模式
head -50 packages/aigcfroge/src/server/routes/instance/httpapi/groups/prompt-asset.ts
head -60 packages/aigcfroge/src/server/routes/instance/httpapi/handlers/prompt-asset.ts
grep -n "\.add\|prefix\|InstanceHttpApi" packages/aigcfroge/src/server/routes/instance/httpapi/api.ts | head -10

# L5 App — M7 ImportDialog 现状
grep -n "serializeImport\|wrapImportContent\|handleImport\|onImport" packages/app/src/components/chat/chat-import-dialog.tsx | head -10
grep -n "onImportAsset\|ChatImportDialog" packages/app/src/pages/home.tsx | head -5
```

**关键发现**：
- M7 ImportDialog 当前数据流：`ImportDialog → serializeImport() → wrapImportContent("<untrusted_import>…") → create chat Draft → chat-orchestrator → Agent parse → propose_*`
- PRD §7.3 要求："解析器属 Core service（Effect），禁止放 App"
- 所有 schema 类型必须用 `ImportParser.*` 命名空间（遵循 `PromptAsset.*` 约定）
- 错误用 `Schema.Class` 不能是内联 `Schema.Struct`（AGENTS.md 要求）
- Layer 用 `Layer.effect` 不能是 `Layer.succeed(make())`

---

## 3. TDD 强制循环（每 Step 必走）

```
1. 精读本 Step 的红/绿/重构 + 本步关联的五层代码文件
2. 红：先写测试，运行确认失败
3. 绿：最小实现使测试通过
4. 重构：清理，测试保持绿
5. 命令验证：bun run lint + 受影响包 typecheck + 受影响包 test
6. 按 CLAUDE.md §改完即审 输出复查结论
7. 重新阅读 CLAUDE.md 全文 + PRD §7.3 + AGENTS.md
全部通过后 git commit，进入下一步。
```

---

## 4. 实施步骤

### Step 1 — Schema：ImportParser.Candidate + ImportParser.Result + ImportParser.ParseError

**测试**：`packages/schema/test/import-parser.test.ts`（新建）— Candidate encode/decode、空 name decode error、Result 含 warnings + ParseError[]

**实现** — `packages/schema/src/import-parser.ts`（新建）：

```ts
// 遵循项目命名约定 PromptAsset.Summary/PromptAsset.Info 同理
export class Candidate extends Schema.Class<Candidate>("ImportParser.Candidate")({
  kind: Schema.String,       // AssetKindId: "prompt"|"command"|"skill"|...
  name: Schema.String,       // 1..80 code points
  description: Schema.String,// 0..300 code points
  template: Schema.String,   // 1..100_000 UTF-8 bytes
}) {}

export class ParseError extends Schema.Class<ParseError>("ImportParser.ParseError")({
  section: Schema.String,    // 如 "Block #3"
  reason: Schema.String,     // 如 "unknown_type"
}) {}

export class Result extends Schema.Class<Result>("ImportParser.Result")({
  candidates: Schema.Array(Candidate),
  warnings: Schema.Array(Schema.String), // 如 "stripped_thinking" — 不含原文
  errors: Schema.Array(ParseError),      // Schema.Class 不是内联 Struct
}) {}
```

`packages/schema/src/index.ts` 加 export。

**验证**：`bun --cwd packages/schema typecheck && bun --cwd packages/schema test --timeout 30000 && bun run lint`

**复查**：重新阅读 CLAUDE.md + PRD §7.3

---

### Step 2 — Core ImportParser Service（确定性规则引擎）

**测试**：`packages/core/test/import-parser.test.ts`（新建并置）— 11 个 case：

1. Markdown code block → prompt candidate
2. ` ```yaml ` with `steps:` → workflow kind
3. `<thinking>` block → stripped，warning `stripped_thinking`
4. `User:/Assistant:` 对话噪声 → stripped
5. 纯文本 → single prompt candidate
6. `# Heading` → name 从 heading 提取（截断 80）
7. 空输入 → Result 含 error `empty`
8. >200KB → ParseError `too_large`
9. 多个 code block → 多个 candidates
10. ` ```yaml ` with `name:`+`tools:`+`hooks:` → plugin kind
11. ` ```json ` with `mcpServers` → mcp kind；JSON parse 失败 → 降级为纯文本

**实现** — `packages/core/src/import-parser.ts`（新建）：

```ts
export const ImportParser = Context.Tag<ImportParserInterface>()

interface ImportParserInterface {
  parse(input: string, options?: { maxBytes?: number }): Effect.Effect<ImportParser.Result, ImportParser.ParseError>
}
```

解析逻辑（确定性规则，非 LLM）：
1. 大小检查 — >200KB → `ImportParser.ParseError`
2. 块分割 — Markdown fenced code blocks（优先级 1）→ YAML `---`（优先级 2）→ 空行（fallback）
3. JSON 解析 — ` ```json ` block 先尝试 `JSON.parse`；失败降级为纯文本
4. 噪声剥离 — `<thinking>`/`<thought>` 块、`User:`/`Assistant:`/`Human:`/`AI:` 行、`<!--`/`/*` 注释头、>3 连续空行压缩为 1。输出 warnings 含分类标签，不含原文片段
5. 类型推断 — 按下表（§6.2）
6. 名称推断 — 第一个 `# heading` → code block 语言标记后的注释 → 首行文本（截断 80）→ 默认 `"Imported Asset {N}"`
7. 输出 `ImportParser.Result`

**Layer**（参照 PromptAssetService 模式）：
```ts
export const ImportParserLive = Layer.effect(
  ImportParser,
  Effect.sync(() => ({ parse: (input, options) => Effect.sync(() => { /* ... */ return ImportParser.Result.make({...}) }) }))
)

export class ParseError extends Schema.TaggedErrorClass<ParseError>()(
  "ImportParser.ParseError",
  { reason: Schema.String }
) {}
```

**验证**：`bun --cwd packages/core typecheck && bun --cwd packages/core test --timeout 30000 && bun run lint`

**复查**：重新阅读 CLAUDE.md + PRD §7.3 + Clean Logs

---

### Step 3 — HTTP API：POST /import-asset/parse

**测试**：`packages/aigcfroge/test/import-parser-api.test.ts`（新建）— POST parse 返回 candidates、warnings 含 stripped 内容、空内容 error、超大内容 error

**实现**：

`packages/aigcfroge/src/server/routes/instance/httpapi/groups/import-parser.ts`（新建，参照 groups/prompt-asset.ts 模式）：
```ts
export class ImportParserGroup extends InstanceHttpApi.prefix("/import-asset")
  .add(HttpApiEndpoint.post("parse", "/parse")
    .setRequest(Schema.Struct({ content: Schema.String }))
    .setResponse(ImportParser.Result)
  ) {}
```

`packages/aigcfroge/src/server/routes/instance/httpapi/handlers/import-parser.ts`（新建，参照 handlers/prompt-asset.ts 模式）：
```ts
export const parseHandler = HttpApiBuilder.handle(ImportParserGroup, "parse", (payload) =>
  ImportParser.pipe(Effect.flatMap(svc => svc.parse(payload.content)))
)
```

`api.ts` — `.add(ImportParserGroup)` 注册
`server.ts` — `import { importParserHandlers }` + `provide(importParserHandlers)`

**验证**：`bun --cwd packages/aigcfroge typecheck && bun --cwd packages/aigcfroge test --timeout 30000 && bun run lint`

**复查**：重新阅读 CLAUDE.md + ARCHITECTURE.md §2

---

### Step 4 — SDK Regenerate + App ImportDialog 集成

**测试**：`packages/app/src/components/chat/chat-import-dialog.test.ts` 扩展 — review 点击调 SDK.ImportAsset.parse()、parse 成功显示候选列表、warnings 显示警告区域、errors 显示错误区域且 apply disabled、"AI 辅助整理" fallback 仍可用

**实现**：

1. SDK regenerate：
```bash
./packages/sdk/js/script/build.ts
```

2. ImportDialog 集成（`chat-import-dialog.tsx`）：
```tsx
function handleImport() {
  const content = serializeImport(result)
  const parseResult = await sdk().ImportAsset.parse({ content })
  if (parseResult.candidates.length > 0) {
    setCandidates(parseResult.candidates)
  }
  // parseResult.errors → apply disabled
  // parseResult.warnings → 显示警告区域
}
```

保留 M7 `onImport` callback 作为 "AI 辅助整理" fallback 按钮。

**验证**：
```bash
./packages/sdk/js/script/build.ts
bun --cwd packages/sdk/js typecheck
bun --cwd packages/app typecheck
bun --cwd packages/app test --timeout 30000
bun run lint
```

**复查**：重新阅读 CLAUDE.md + PRD §7.3 + §7.1

---

### Step 5 — 全量验收

```bash
bun --cwd packages/schema typecheck && bun --cwd packages/schema test --timeout 30000
bun --cwd packages/core typecheck && bun --cwd packages/core test --timeout 30000
bun --cwd packages/aigcfroge typecheck && bun --cwd packages/aigcfroge test --timeout 30000
bun --cwd packages/sdk/js typecheck
bun --cwd packages/app typecheck && bun --cwd packages/app test --timeout 30000
bun run lint
./packages/sdk/js/script/build.ts   # 确认无 build error
```

浏览器手动验收：
- 粘贴 Markdown code block → Core parser 返回 prompt candidate
- 导入 YAML 工作流文件 → Core parser 返回 workflow candidate
- 导入含 `<thinking>` 噪声文本 → 噪声剥离、警告显示
- 空内容 → 错误提示
- "AI 辅助整理" fallback 按钮仍可点击 → 走 chat Draft 流线

---

## 5. 解析器规则表（确定性引擎核心）

### 块分割

| 优先级 | 方式 |
|--------|------|
| 1（最高） | Markdown fenced `` ``` `...` ``` `` 或 `~~~...~~~` |
| 2 | `---` 开头的 YAML document separator |
| 3（fallback） | `\n\n+` 空行分隔 |

### 类型推断

| 特征 | kind | 置信度 |
|------|------|--------|
| `` ```yaml `` + `steps:` / `kind: workflow` | `workflow` | high |
| `` ```yaml `` + `name:`+`tools:`+`hooks:` | `plugin` | high |
| `` ```yaml `` + `triggers:`/`context:` | `skill` | high |
| `` ```json `` + `"mcpServers"` | `mcp` | high |
| `` ```sh ``/`` ```bash `` | `command` | medium |
| `` ``` ``（无语言标记）或 `` ```md `` | `prompt` | medium |
| 纯文本（无 code block） | `prompt` | low |

### 噪声剥离

| 模式 | 处理 | warning |
|------|------|---------|
| `<thinking>...</thinking>` / `<thought>...</thought>` | 剥离 | `stripped_thinking` |
| `User:`/`Assistant:`/`Human:`/`AI:` 行 | 剥离行 | `stripped_conversation` |
| `<!--`/`/*` metadata 注释 | 剥离 | — |
| >3 连续空行 | 压缩为 1 | — |
| 输入 >200KB | error | `too_large` |

### 名称推断

| 来源 | 示例 |
|------|------|
| Markdown heading `# Title` | name = "Title"（截断 80） |
| Code block 语言标记后的注释 | ` ```python # Web Scraper` → "Web Scraper" |
| 首行非空文本 | 截断 80 |
| 无 | "Imported Asset {N}" |

---

## 6. 数据流全貌

```
ImportDialog（用户粘贴/选文件）
  └─ serializeImport(result) → raw text
       │
       ├── [Core Parser Path] ── POST /import-asset/parse
       │     → ImportParser.parse(content)
       │     → ImportParser.Result { candidates, warnings, errors }
       │     → App 展示结构化候选列表 → 用户逐条确认/编辑 → apply
       │
       └── [AI Fallback Path] ── wrapImportContent("<untrusted_import>…")
             → create chat Draft → chat-orchestrator → propose_* → apply
```

---

## 7. 强制规则

- 每 Step 完成后必须重新阅读 CLAUDE.md 全文
- 每 Step 完成后必须跑 typecheck + test + lint
- 测试必须先写（红）再实现（绿）
- 所有 Schema 类型用 `ImportParser.*` 命名空间（非 `ImportCandidate` / `ImportParseResult`）
- 错误用 `Schema.Class` 不能是内联 `Schema.Struct`
- Layer 用 `Layer.effect()` 不能是 `Layer.succeed(make())`
- 噪声剥离 warning 含分类标签不含原文片段
- 禁止 as any / @ts-ignore / 改无关文件
- 阻塞问题：先向用户报告现状和已试方案，请求决策

**已知延后**（不在本期范围）：CLI/TUI 消费端接入、批量导入逐条确认 UI、AI 增强解析、导入历史/undo
