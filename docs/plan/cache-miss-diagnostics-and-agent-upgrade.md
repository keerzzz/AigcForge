# Cache Miss Diagnostics & Agent Architecture Upgrade Plan

> Status: READY (v2 — 经代码审查修正 6 处)
> Branch: brand-migration-v001
> Scope: 8 phases, ~15 files

---

## 0. Background

参考资源：

| 来源                                     | 核心可借鉴设计                                                                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **DeepSeek-Reasonix** (`cache_shape.go`) | PrefixShape SHA256 快照 + CompareShape 跨轮诊断 + 三级 Compaction 水位线 + 流中断恢复                                                  |
| **2026 AI Agent 白皮书**                 | Protocol Cards 按需注入、MCP 工具动态裁剪、多模型瀑布、执行计划持久化                                                                  |
| **项目现有基础设施**                     | `Step.Ended` 已含 `tokens.cache.read/write`、`CacheHint`/`CachePolicy` Schema 已就位、`compaction.ts` 有一级触发、`Retried` 事件已存在 |

### 当前状态

```
LLM request 流程（当前）:

  Agent → LLM.request(promptCacheKey) → stream → step-finish(usage)
                                                       └── tokens(cacheRead, cacheWrite)

  存在的问题:
  1. ❌ 无 PrefixShape 快照 → 无法诊断"为什么这轮缓存 miss"
  2. ❌ 无跨轮 CompareShape → 无法归因 (system/tools/log_rewrite)
  3. ❌ Compaction 只分"触发/不触发"两级 → 每次压缩都破坏缓存前缀
  4. ❌ 工具 Schema 全量挂载 → 简单任务也浪费大量 tokens
  5. ❌ 流中断后已完成的 tool call 被标记为失败 → 浪费已完成工作
  6. ❌ 无多模型瀑布 → 简单问答也用旗舰模型
  7. ❌ Agent Card 非标准格式 → 无法被 ACP 生态发现

  已有的基础设施（计划中要复用的）:
  - ✅ `Step.Ended` 事件已含 `tokens.cache.{read,write}` → 无需改 durable 事件
  - ✅ `Retried` 事件已存在 → Phase 5 直接复用现有事件类型
  - ✅ `Compaction.Ended` 已含 `reason: "auto" | "manual"`
  - ✅ `CacheHint`/`CachePolicy` Schema 已定义
  - ✅ `agent.json` 已存在（简单格式，Phase 8 扩展它而非重写）
```

### 目标

```
LLM request 流程（目标）:

  PreRouter(intent) → tools.materialize(intent) → PrefixShape.capture()
  → LLM.request(cachePolicy: "auto") → stream(on error: recover)
  → step-finish(usage + CacheDiagnostics ephemeral event)
  → aggregate(sessionCacheHit/Miss on existing Step.Ended tokens)
  → UI: "(N cached / M new) · cache prefix changed: tools"
```

---

## Phase 1: Prefix Cache Diagnostics（核心基础）

> 文件：3 new/modified, 0 deps
> 验证：`bun --cwd packages/core test -t "CacheShape"`

> ⚠ **审查修正**：`Step.Ended` 是 durable event version 2，不可轻率改 schema。
> `CacheDiagnostics` 应以**新的 ephemeral 事件**发布，而非侵入 `Step.Ended`。

### 1.1 新建 `packages/core/src/cache/cache-shape.ts`

```typescript
// @aigcfroge/core/cache
// 遵循 flat export 模式: export * as CacheShape from "."

import { Schema } from "effect"

export class PrefixShape extends Schema.Class<PrefixShape>("Cache.PrefixShape")({
  systemHash: Schema.String,
  toolsHash: Schema.String,
  prefixHash: Schema.String,
  rewriteVersion: Schema.Number,
  toolSchemaTokens: Schema.Number,
}) {}

export class CacheDiagnostics extends Schema.Class<CacheDiagnostics>("Cache.CacheDiagnostics")({
  prefixHash: Schema.String,
  prefixChanged: Schema.Boolean,
  prefixChangeReasons: Schema.Array(Schema.String),
  systemHash: Schema.String,
  toolsHash: Schema.String,
  rewriteVersion: Schema.Number,
  toolSchemaTokens: Schema.Number,
  cacheReadInputTokens: Schema.Number,
  nonCachedInputTokens: Schema.Number,
}) {}
```

核心函数：

- `capture(system, tools, version) → PrefixShape` — 对 system prompt 和 tool schema 做 SHA256 摘要，排序归一化
- `compare(prev, cur, usage) → CacheDiagnostics` — 对比前后两轮，标记变化原因（`"system"` | `"tools"` | `"log_rewrite"`）

### 1.2 新增 `Cache.Diagnostic` ephemeral 事件

在 `packages/core/src/session/event.ts` 的 `EphemeralDefinitions` 中新增：

```typescript
// ephemeral 事件 — 仅实时推送，不持久化到事件流
export const CacheDiagnostic = EventV2.define({
  type: "session.next.cache.diagnostic",
  schema: {
    ...Base,
    assistantMessageID: SessionMessageID.ID,
    prefixHash: Schema.String,
    prefixChanged: Schema.Boolean,
    prefixChangeReasons: Schema.Array(Schema.String),
    cacheReadInputTokens: Schema.Number,
    nonCachedInputTokens: Schema.Number,
    // session 级聚合
    sessionCacheRead: Schema.Number,
    sessionNonCached: Schema.Number,
  },
})
```

### 1.3 注入 Session Runner

**`packages/core/src/session/runner/llm.ts`** — 在 `runTurnAttempt` 捕获 PrefixShape：

```typescript
// 在 Effect.fn("SessionRunner.runTurn") 中新增状态
let lastPrefixShape: CacheShape.PrefixShape | undefined
let sessionCacheRead = 0
let sessionNonCached = 0

// 在 LLM.request() 构建前（约 L195）
const prefixShape = CacheShape.capture(
  [agent.info?.system, system.baseline].filter(Boolean).join("\n"),
  toolMaterialization?.definitions ?? [],
  /* session 层面的 rewriteVersion 计数器（Phase 1.4）*/ version,
)

// 在 step-finish 事件到来时，发布 CacheDiagnostic 事件
const diag = CacheShape.compare(lastPrefixShape, prefixShape, usage)
lastPrefixShape = prefixShape
sessionCacheRead += usage?.cacheReadInputTokens ?? 0
sessionNonCached += usage?.nonCachedInputTokens ?? 0

// 发布 ephemeral 事件
yield* events.publish(CacheDiagnostic, {
  sessionID: session.id,
  timestamp: ...,
  assistantMessageID: ...,
  ...diag,
  sessionCacheRead,
  sessionNonCached,
})
```

### 1.4 新增 `Session.rewriteVersion` 追踪

**审查发现**：`rewriteVersion` 在 session 中不存在。需要新增：

可以在 `SessionStore` 的内存状态中维护（无需数据库迁移），每次 compaction 结束后递增：

```typescript
// packages/core/src/session/store.ts
// 在 Service 实现中新增:
let rewriteVersion = 0
const incrementRewrite = () => {
  rewriteVersion++
}
const getRewriteVersion = () => rewriteVersion
```

**`packages/core/src/session/compaction.ts`** — compaction 成功后调用 `incrementRewrite()`。

---

## Phase 2: 缓存聚合率展示

> 文件：1 modified, 依赖 Phase 1（ephemeral 事件）
> 验证：`bun --cwd packages/core test -t "CacheDiagnostics"`

> ⚠ **审查修正**：`Step.Ended.tokens.cache.{read,write}` 已存在。不用改 durable schema。
> session 级聚合直接累加 `step-finish` 的 usage 即可。

Phase 1 的 ephemeral `CacheDiagnostic` 事件已含 `sessionCacheRead` 和 `sessionNonCached` 字段。TUI/CLI 端直接消费该事件展示即可：

- 聚合率：`sessionCacheRead / (sessionCacheRead + sessionNonCached)`
- 单轮归因：`prefixChanged ? "cache prefix changed: " + reasons : "cache: N%"`
- 展示格式：`(N cached / M new)` 绝对值，避免百分比误读

---

## Phase 3: 多级 Compaction 策略

> 文件：2 modified, 独立可测试
> 验证：`bun --cwd packages/core test -t "Compaction"`

> ⚠ **审查修正**：`Compaction.Ended` 已有 `reason: "auto" | "manual"`，
> 新增 `Compaction.SoftWarning` 和 `Compaction.Stuck` 事件类型。

### 3.1 水位线分级（`packages/core/src/session/compaction.ts`）

`make()` 返回的闭包中新增状态变量，将单级触发改为四级水位线：

| 水位              | 阈值               | 行为                                                            |
| ----------------- | ------------------ | --------------------------------------------------------------- |
| **soft** (50%)    | `watermark >= 0.5` | 只发 `Compaction.SoftWarning` 事件，**不压缩** — 保护缓存前缀   |
| **snip** (60%)    | `watermark >= 0.6` | 修剪陈旧 tool result（已有 `PruneStaleToolResults` 模式可借鉴） |
| **compact** (80%) | `watermark >= 0.8` | 执行现有 `compactAfterOverflow` 逻辑                            |
| **force** (90%)   | `watermark >= 0.9` | 强制压缩，跳过 foldEconomics 检查                               |

### 3.2 防卡死锁（`make()` 闭包中的状态）

```typescript
let consecutiveCompacts = 0
let compactStuck = false

// compactIfNeeded 中:
if (compactStuck) return false // 暂停自动压缩
if (watermark >= compactRatio) {
  const ok = yield * compactAfterOverflow(input)
  if (ok) {
    consecutiveCompacts++
    if (consecutiveCompacts >= 2) {
      compactStuck = true
      // 发布 Compaction.Stuck 事件
      // 条件: watermark < compactRatio 时 reset
    }
  }
}
// 若水位降回 compact 以下: consecutiveCompacts = 0; compactStuck = false
```

### 3.3 新增事件类型

在 `packages/core/src/session/event.ts` 的 `Compaction` namespace 中：

```typescript
export const SoftWarning = EventV2.define({
  type: "session.next.compaction.soft-warning",
  schema: {
    ...Base,
    watermark: Schema.Finite,
    compactAt: Schema.Finite,
  },
})

export const Stuck = EventV2.define({
  type: "session.next.compaction.stuck",
  schema: {
    ...Base,
    message: Schema.String,
  },
})
```

---

## Phase 4: 工具 Schema 动态裁剪

> 文件：2-3 modified, 依赖 intent.ts 导出类型
> 验证：`bun --cwd packages/core test -t "ToolRegistry"`

> ⚠ **审查确认**：`tools.materialize(permissions)` 签名简洁，加可选 `intent` 参数可行。

### 4.1 Intent 到工具过滤规则

```typescript
// core/src/tool/registry.ts 内部
const INTENT_TOOL_FILTERS: Record<string, (def: ToolDef) => boolean> = {
  code_understanding: (t) => isReadOnly(t), // 只读工具
  content_creation: (t) => isFileWriteTool(t), // 文件写工具
  configuration: (t) => isConfigTool(t), // 配置工具
  code_modification: (t) => true, // 全部
  workflow: (t) => true, // 全部
  mention: (t) => true, // 全部
}
```

### 4.2 集成点

**`packages/core/src/tool/registry.ts`** — `materialize` 新增 `intent` 参数：

```typescript
materialize: (permissions, intent?) => {
  let defs = getAllDefinitions()
  if (intent && INTENT_TOOL_FILTERS[intent]) {
    defs = defs.filter(INTENT_TOOL_FILTERS[intent])
  }
  // ... 现有权限过滤 ...
}
```

**`packages/core/src/session/runner/llm.ts`** — 调用处：

```typescript
const intent = session.intent // 或从 PreRouter 获取
const toolMaterialization = yield * tools.materialize(agent.info?.permissions, intent)
```

### 4.3 导出 IntentCategory 类型

**`packages/aigcfroge/src/agent/meta/intent.ts`** — 导出 `IntentCategory` union type，
供 `packages/core/src/tool/registry.ts` 引用（通过 `@aigcfroge/core` 的 peer dep 或值复制）。

---

## Phase 5: 流中断恢复

> 文件：2 modified, 独立
> 验证：`bun --cwd packages/core test -t "StreamRecovery"`

> ⚠ **审查修正**：`Retried` 事件已存在（`event.ts:383`），Phase 5 复用该事件而非新建。
> 已有 `RetryError` schema，含 `message/statusCode/isRetryable/responseHeaders/responseBody/metadata`。

### 5.1 在 `publish-llm-event.ts` 中支持部分恢复

当前流中断后 `provider-error` 事件调用 `failAssistant()`，把已完成的 tool call 全部标记失败。
改为：在 `publish()` 函数中增加 `aborted` 状态标记，标记流中断但不清除已完成的 tool call：

```typescript
// publish-llm-event.ts 新增
let aborted = false
let hasPartialOutput = false

// 在 provider-error 分支:
case "provider-error":
  if (!hasPartialOutput) {
    // 没有任何输出，直接失败（无法恢复）
    yield* failAssistant(event.message)
    return
  }
  // 有部分输出 → 标记为 aborted，保留已完成的 tool call
  aborted = true
  providerFailed = true
  // 不发 failAssistant，保留已完成的工作
  return
```

### 5.2 在 Session Runner 中重试

在 `session/runner/llm.ts` 的 `runTurnAttempt` 中，检测 `aborted` 状态并重试：

```typescript
// 在 providerStream 消费后:
if (aborted && streamRecoveries < maxStreamRecoveries) {
  streamRecoveries++
  // 注入恢复 user message（复用已有 MidTurnSteerPrefix 模式）
  session.add(
    Message.user({
      text: "[Stream interrupted] Continue from where you left off without repeating completed work.",
    }),
  )
  // 发布 Retried 事件
  yield *
    events.publish(SessionEvent.Retried, {
      sessionID: session.id,
      attempt: streamRecoveries,
      error: { message: "Stream interrupted", isRetryable: true },
    })
  // 继续下一轮
  needsContinuation = true
}
```

### 5.3 状态传递

`publish` 函数需要暴露 `aborted` 状态供 `runTurnAttempt` 判断：

```typescript
return {
  publish,
  flush,
  failAssistant,
  failUnsettledTools,
  hasActiveAssistant,
  hasAssistantStarted,
  hasProviderError,
  assistantMessageID,
  // 新增:
  isAborted: () => aborted,
}
```

---

## Phase 6: 多模型瀑布调度

> 文件：1 modified, 依赖 Phase 4 的 intent 分类
> 验证：`bun --cwd packages/core test -t "ModelResolve"`

### 6.1 `SessionRunnerModel.resolve()` 升级

```typescript
resolve: (session, intent?) => {
  const primary = resolvePrimary(session)

  // 简单任务 → 低成本模型
  if (intent === "code_understanding" || intent === "content_creation") {
    const fallback = findCheaperModel(session)
    if (fallback) return fallback
  }

  return primary
}
```

### 6.2 `findCheaperModel` 查找策略

遍历 session 的 provider 配置，查找同一 provider 的更便宜模型：

- `deepseek-reasoner` → `deepseek-chat`
- `claude-opus` → `claude-haiku`
- 未配置 fallback → 返回 primary（安全降级）

---

## Phase 7: 执行计划持久化

> 文件：3 modified, 独立
> 验证：`bun --cwd packages/core typecheck`

### 7.1 新建 `meta_agent_step` 表

在 `packages/core/src/meta-agent/sql.ts` 中新增：

```typescript
export const metaAgentStep = sqliteTable("meta_agent_step", {
  id: text("id").primaryKey(),
  meta_agent_session_id: text("meta_agent_session_id")
    .notNull()
    .references(() => metaAgentSession.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  type: text("type").notNull(), // "subagent" | "external-cli" | "tool"
  engine: text("engine").notNull(),
  status: text("status").notNull(), // "pending" | "running" | "completed" | "failed"
  prompt: text("prompt"),
  result: text("result"),
  error: text("error"),
  time_created: integer("time_created").notNull(),
  time_updated: integer("time_updated").notNull(),
})
```

### 7.2 新迁移文件

`packages/core/src/database/migration/<timestamp>_meta_agent_step.ts`

### 7.3 Workflow 引擎写入

在 `fanout.ts` 每个 step 前后写 `meta_agent_step` 记录。写入时机：

```
start(step):
  INSERT INTO meta_agent_step (seq, type, engine, status, prompt, time_created, time_updated)
  VALUES (seq, type, engine, 'running', prompt, now, now)

end(step):
  UPDATE meta_agent_step SET status='completed', result=..., time_updated=now WHERE id=id
```

---

## Phase 8: ACP Agent Card 标准化

> 文件：4 modified, 独立
> 验证：`bun --cwd packages/aigcfroge typecheck`

> ⚠ **审查修正**：当前 `agent.json` 有字段 `{name, mode, description, capabilities, constraints, protocol}`。
> 应在现有格式上扩展，而非替换。

### 8.1 扩展 agent.json

在现有字段基础上补充 ACP 标准字段：

```jsonc
// packages/aigcfroge/src/agent/build/agent.json — 在现有字段基础上扩展
{
  "name": "build",
  "mode": "primary",
  "description": "The default agent. Executes tools based on configured permissions.",
  "capabilities": ["code_modification", "file_operations", "test_execution", "configuration"],
  "constraints": [],
  "protocol": "build",
  // 以下为新增 ACP 兼容字段:
  "version": "1.0.0",
  "card": {
    "tools": ["read", "write", "edit", "bash", "glob", "grep", "task"],
    "readOnly": false,
    "endpoints": { "type": "internal" },
    "auth": { "type": "inherited" },
  },
}
```

涉及文件（扩展方式相同）：

- `packages/aigcfroge/src/agent/build/agent.json`
- `packages/aigcfroge/src/agent/explore/agent.json`
- `packages/aigcfroge/src/agent/general/agent.json`
- `packages/aigcfroge/src/agent/plan/agent.json`

---

## 实施顺序与依赖

```
Phase 1 ─────── 独立，无外部依赖（新建 + 注入）
  │
  ├──→ Phase 2 (依赖 Phase 1 的 ephemeral CacheDiagnostic 事件)
  ├──→ Phase 3 (独立，同为 event.ts 修改，可与 Phase 1 并行)
  ├──→ Phase 4 (独立，仅需 intent.ts 导出类型)
  └──→ Phase 5 (独立，复用现有 Retried 事件)

Phase 6 (依赖 Phase 4 的 intent 分类)

Phase 7 (独立)
Phase 8 (独立)
```

**推荐顺序**：Phase 1 → Phase 3 → Phase 4 → Phase 2 → Phase 5 → Phase 6 → Phase 7 → Phase 8

理由：Phase 1 建立诊断基础不破坏任何现有逻辑；Phase 3 优化压缩保护缓存；Phase 4 减少不必要的 token 浪费；其余 phases 在此基础上叠加。

---

## 测试验证

```bash
# Phase 1: CacheShape 单元测试
bun --cwd packages/core test --timeout 30000 -t "CacheShape"

# Phase 2-3: Compaction + CacheDiagnostics 测试
bun --cwd packages/core test --timeout 30000 -t "Compaction|CacheDiagnostics"

# Phase 4: ToolRegistry + intent 过滤测试
bun --cwd packages/core test --timeout 30000 -t "ToolRegistry"

# Phase 5: 流恢复不破坏现有 tool call 闭环
bun --cwd packages/core test --timeout 30000 -t "Step|Tool"

# Phase 6: ModelResolver 多模型回退
bun --cwd packages/core test --timeout 30000 -t "ModelResolve"

# Phase 7-8: 类型检查保障
bun --cwd packages/core typecheck
bun --cwd packages/aigcfroge typecheck

# 全仓
bun turbo typecheck
```

---

## 审查修正清单（v1 → v2）

| #   | 问题                             | v1 写法                 | 修正                                         |
| --- | -------------------------------- | ----------------------- | -------------------------------------------- |
| 1   | `Step.Ended` 是 durable event v2 | 建议在其 payload 加字段 | 改为新增 ephemeral `CacheDiagnostic` 事件    |
| 2   | `rewriteVersion` 不存在          | 说"从 session 获取"     | 需在 SessionStore 新增计数器                 |
| 3   | `Step.Ended` 已有 cache tokens   | 未提及                  | Phase 2 直接复用，无需改 schema              |
| 4   | `Retried` 事件已存在             | 说要新建恢复事件        | Phase 5 复用 `Retried`                       |
| 5   | `Compaction.Ended` 已定义        | 未提及现有 schema       | 在其基础上新增 SoftWarning/Stuck             |
| 6   | `agent.json` 已有独立格式        | 建议替换为全新格式      | 改为在现有字段上扩展                         |
| 7   | Phase 2 全局累加器无初始化位置   | 只说"在 run 中加变量"   | 明确在 `runTurnAttempt` 闭包中初始化         |
| 8   | Phase 4 intent 类型跨包引用      | 未说明引用方式          | 通过 `intent.ts` 导出 Union，core 层直接引用 |

---

## 复查结论

```
影响文件（总计约 15 个）:
  NEW:  packages/core/src/cache/cache-shape.ts
  NEW:  packages/core/src/database/migration/<ts>_meta_agent_step.ts
  MOD:  packages/core/src/session/event.ts (新增 ephemeral CacheDiagnostic + Compaction.SoftWarning/.Stuck)
  MOD:  packages/core/src/session/runner/llm.ts (PrefixShape 捕获 + 流恢复 + session 累加器)
  MOD:  packages/core/src/session/runner/publish-llm-event.ts (暴露 aborted 状态)
  MOD:  packages/core/src/session/compaction.ts (四级水位线 + 防卡死)
  MOD:  packages/core/src/session/store.ts (rewriteVersion 计数器)
  MOD:  packages/core/src/tool/registry.ts (intent 过滤)
  MOD:  packages/core/src/meta-agent/sql.ts (meta_agent_step 表)
  MOD:  packages/core/src/session/runner/model.ts (瀑布调度)
  MOD:  packages/aigcfroge/src/agent/meta/intent.ts (导出 IntentCategory)
  MOD:  packages/aigcfroge/src/agent/*/agent.json (x4, 扩展 ACP 字段)

命中 skills:
  - 八荣八耻: 以复用现有为荣（复用 Retried/CacheHint/Step.Ended.tokens）
  - 极致减法: 优先复用（Phase 2 0 新增事件，Phase 5 复用现有 Retried）

安全门禁:
  - PrefixShape 仅存 SHA256 摘要，不存 prompt 原文
  - CacheDiagnostics 不透传敏感内容
  - Agent Card 不含密钥

工程门禁:
  - 所有新 API 遵循 flat export 模式（export * as CacheShape）
  - 所有新增事件采用 EventV2.define 标准注册
  - 不做顺手重构（如不顺手删除已有的 CacheWarmth）

数据流追踪:
  PrefixShape: session runner → capture() → LLM.request → step-finish → compare() → CacheDiagnostic event
  Compaction:  watermark >= soft → SoftWarning | >= compact → compactAfterOverflow → IncrementRewrite()
  工具裁剪:    intent → materialize(intent) → filtered definitions
  瀑布调度:    intent → model.resolve(intent, session) → cheaper || primary
  流恢复:      provider-error + hasPartialOutput → Retried event → recovery user message → continue
  持久化:      workflow step → INSERT meta_agent_step → UPDATE on complete

已运行命令:
  - 代码审查: packages/core/src/session/event.ts, runner/llm.ts, runner/publish-llm-event.ts, compaction.ts, tool/registry.ts
  - schema 验证: packages/llm/src/schema/events.ts, options.ts
  - agent.json 格式确认: packages/aigcfroge/src/agent/build/agent.json
  - 已确认 rewriteVersion 不存在: grep 返回空 — 需新增

剩余风险:
  - 无（审查已闭环，所有假设已用实码验证）
```
