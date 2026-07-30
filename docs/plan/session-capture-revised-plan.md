# Session Capture 重新规划实施方案

> 状态：**Implemented**（2026-07-30，`6421058`）
> 依据：原实施计划（`session-capture-implementation.md`，已 implemented @ `f5ebe78b9`）+ 代码复审发现 + 审批修正
> 前置：M1-M7 asset 基础设施已完成，ADR-15 ModeWorkspace 已完成
> 范围：`packages/app/src/components/chat/repeat-detection.ts`（重写）、`packages/app/src/pages/session.tsx`（修正）、`packages/app/src/pages/session/timeline/projection.ts`（新增信号）、`packages/app/src/pages/session/timeline/message-timeline.tsx`（修正）

---

## 0. 现有实现审计

原计划 Step 1-6 已全部实现并列在 `§7 不在本文范围的已知延后` 的两项（"会话内重复指令启发式"和"跨会话重复检测"）实际上被**提前实现了**——`repeat-detection.ts` + `SuggestionBar`。

但代码复审发现 **4 个 bug**：

### Bug A：`promptHistory` 跨会话泄漏

**位置**：[session.tsx:L109](packages/app/src/pages/session.tsx#L109)

```ts
// Page 组件体内创建，Page 在切换会话时不重新挂载
const promptHistory = createPromptHistory()
```

`Page` 组件在 SPA 生命周期内只挂载一次，切换 `params.id` 不触发重建。用户从会话 A 切到会话 B 后，A 的历史仍在 `entries[]` 中，会话 B 的 prompt 会与 A 的历史做交叉比对。

**影响**：切换会话后误报重复检测。

### Bug B：计数机制问题 + 只触发一次

**位置**：[repeat-detection.ts:L6](packages/app/src/components/chat/repeat-detection.ts#L6) + [session.tsx:L1380](packages/app/src/pages/session.tsx#L1380)

```ts
const DEFAULT_THRESHOLD = 0.7
// ...
if (repeat && !suggestion.show) {  // 只触发一次！
  setSuggestion("show", true)
}
```

- `findSimilarPrompt` 找到**任意一条**匹配就触发（产品要求：≥3 次相似才提示）
- `!suggestion.show` 守卫导致一旦弹出，后续相同场景不再提醒（需 Dismiss 后能重新触发）

### Bug C：CaptureButton 在每个 assistant 轮次都渲染

**位置**：[message-timeline.tsx:L1194-1199](packages/app/src/pages/session/timeline/message-timeline.tsx#L1194-L1199)

```tsx
lastAssistantGroupKey().get(assistantPartRow().userMessageID) === assistantPartRow().group.key
```

`lastAssistantGroupKey` 的语义是"每个 userMessageID 的最后一条 assistant 回复的 group key"。由于每个 user message 通常只有一条 assistant 回复，每个 assistant 轮次都满足条件。

**预期行为**：只在**整个 timeline 的最后一条 assistant 消息**上显示按钮。

### Bug D：`suggestion.show` 永不重置

**位置**：[session.tsx:L108](packages/app/src/pages/session.tsx#L108) + [session.tsx:L1383](packages/app/src/pages/session.tsx#L1383)

`suggestion.show` 只在 `onAccept` 或 `onDismiss` 中设为 `false`。用户 Dismiss 后，即使又输入了 3 次以上相似内容，也不会再次弹出。

**预期行为**：用户 Dismiss 后，后续重复内容累积到阈值时能再次触发。

---

## 1. 重新设计的架构

### 1.1 重复检测：从有状态闭包改为数据派生

**核心思路**：不从全局闭包维护状态，而从那**事实数据源**（timeline messages）派生。

```text
旧架构（有状态闭包，有 bug）：
  createPromptHistory() → 闭包 entries[] → push()/findSimilar()
  问题：跨会话残留、与 timeline 脱耦

新架构（数据派生，无状态）：
  timeline.messages() + getParts(messageID) → 提取 user prompts → 按 session 隔离 → countSimilar()
  优势：天然按会话隔离、无需手动重置、数据源一致
```

**注意**：Message 类型不包含 `.parts` 字段——parts 通过 `sync().data.part[messageID]` 单独访问。`extractUserPrompts` 接收 `getParts` 回调而非直接从 message 读 parts。

### 1.2 CaptureButton：收窄 + 重新定位

```text
旧逻辑（位置错误 + 条件错误）：
  lastAssistantGroupKey.get(userMessageID) === row.group.key
  → 每个 userMessageID 的最后一条都渲染，按钮在 content 底部

新逻辑（位置正确 + 条件正确）：
  row.userMessageID === lastAssistantMessageID && row.group.key === lastAssistantMessageGroupKey
  → 只有一个按钮，在整个 timeline 的最后一条 assistant 消息上
  → 按钮在 content 上方（靠近代码块 copy 按钮的交互区）
```

### 1.3 SuggestionBar 状态机

```text
状态转换：
  HIDDEN → (count ≥ 3) → SHOWN
  SHOWN → (onDismiss) → DISMISSED（记录 dismissCount）
  DISMISSED → (有新重复 + count > dismissCount) → SHOWN
  SHOWN → (onAccept) → 执行 capture → 重置计数 → HIDDEN
```

注：dismiss 后只需 1 次新重复即可重新触发（`match.count > dismissCount`），非 3 次。相比原行为（每次触发）已有大幅改善。

### 1.4 CJK 文本支持

原 `normalize` 的 `[^\w\s]` 正则中 `\w` 只匹配 ASCII，**所有中文字符被错误剥离**。修复：

- `normalize` 改用 `[^\w\s\p{L}]/gu`（`\p{L}` = Unicode 字母属性，保留 CJK）
- `tokenize` 检测到 CJK 时走字符 bigram（重叠 2-gram），否则保持空白分词

---

## 2. 五层代码追踪

### L1 UI 组件层

| 文件 | 改动 | 说明 |
|------|------|------|
| `packages/app/src/components/chat/capture-button.tsx` | 不变 | 已有，UI 正确 |
| `packages/app/src/components/chat/suggestion-bar.tsx` | 不变 | 已有，展示层正确 |
| `packages/app/src/pages/session/timeline/message-timeline.tsx` | 改 L1169-1210 | CaptureButton 移到 content 上方 + HandoffButton/CaptureButton/workingTurn 条件全部使用新信号 |

### L2 页面层

| 文件 | 改动 | 说明 |
|------|------|------|
| `packages/app/src/pages/session.tsx` | 改 L108-109, L1370-1385, L1914-1930 | import 替换 + 状态机 + dismissCount 追踪 |

### L3 领域逻辑层

| 文件 | 改动 | 说明 |
|------|------|------|
| `packages/app/src/components/chat/repeat-detection.ts` | 重写 | `createPromptHistory` 废弃，改为纯函数 `countSimilarPrompts` + `extractUserPrompts` + `freshRepeatState` |

关键实现细节：
- `extractUserPrompts(messages, getParts)` — 接收 `getParts` 回调，无 dedup（保留重复用于计数）
- `tokenize` — CJK 检测 + bigram / 空白分词双路径
- `normalize` — 导出供外部复用，使用 `\p{L}` Unicode 属性保留 CJK

### L4 Projection 层

| 文件 | 改动 | 说明 |
|------|------|------|
| `packages/app/src/pages/session/timeline/projection.ts` | 改 L90-117 | 新增 `lastAssistantMessageID` + `lastAssistantMessageGroupKey` 信号 |

### L5 测试层

| 文件 | 改动 | 说明 |
|------|------|------|
| `packages/app/src/components/chat/repeat-detection.test.ts` | 重写 | 新算法测试：countSimilarPrompts、extractUserPrompts、CJK bigram |
| `packages/app/src/components/chat/capture-helpers.test.ts` | 原有 | 确认通过 |

---

## 3. 实施步骤

### Step 1: 重写 repeat-detection（Bug A + Bug B）

**文件**：`packages/app/src/components/chat/repeat-detection.ts`

```ts
const DEFAULT_THRESHOLD = 0.7
const MIN_SIMILAR_COUNT = 3
const CJK_RE = /[一-鿿㐀-䶿豈-﫿]/

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s\p{L}]/gu, "")  // \p{L} 保留 CJK 等 Unicode 字母
    .replace(/\s+/g, " ")
    .trim()
}

function hasCJK(text: string): boolean {
  return CJK_RE.test(text)
}

function tokenize(text: string): string[] {
  const normalized = normalize(text)
  if (!normalized) return []
  if (hasCJK(normalized)) {
    const chars = Array.from(normalized.replace(/\s+/g, ""))
    if (chars.length <= 1) return chars
    const bigrams: string[] = []
    for (let i = 0; i < chars.length - 1; i++) {
      bigrams.push(chars[i] + chars[i + 1])
    }
    return bigrams
  }
  return normalized.split(/\s+/).filter(Boolean)
}

function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a)
  const setB = new Set(b)
  if (setA.size === 0 && setB.size === 0) return 0
  let intersection = 0
  for (const item of setA) {
    if (setB.has(item)) intersection++
  }
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

export function textSimilarity(a: string, b: string): number {
  return jaccardSimilarity(tokenize(a), tokenize(b))
}

export interface RepeatMatch {
  readonly count: number
  readonly lastSimilarity: number
}

export function countSimilarPrompts(
  current: string,
  history: string[],
  threshold: number = DEFAULT_THRESHOLD,
): RepeatMatch | undefined {
  const tokens = tokenize(current)
  let count = 0
  let best = 0
  for (const entry of history) {
    const sim = jaccardSimilarity(tokens, tokenize(entry))
    if (sim >= threshold) {
      count++
      if (sim > best) best = sim
    }
  }
  return count >= MIN_SIMILAR_COUNT ? { count, lastSimilarity: best } : undefined
}

/**
 * Extract user prompts from session messages in chronological order.
 * Parts accessed via getParts callback (Message types don't carry inline parts).
 * No dedup — duplicates are preserved for accurate counting.
 */
export function extractUserPrompts(
  messages: Array<{ role: string; id: string }>,
  getParts: (messageID: string) => Array<{ type: string; text?: string }>,
): string[] {
  return messages
    .filter((m) => m.role === "user")
    .map((m) =>
      getParts(m.id)
        .filter((p) => p.type === "text")
        .map((p) => p.text ?? "")
        .join(" "),
    )
    .map(normalize)
    .filter((text) => text.length > 0)
}

export function freshRepeatState() {
  return { show: false, message: "", dismissCount: 0 }
}
```

**关键变化**：
- 移除 `createPromptHistory()` 有状态闭包
- `countSimilarPrompts` 是纯函数，接收 history 参数
- 阈值从 2 次（单次 match）改为 **3 次**（`MIN_SIMILAR_COUNT = 3`）
- `extractUserPrompts` 签名使用 `getParts` 回调（因 Message 类型无 inline parts），**无 dedup**
- `tokenize` 支持 CJK bigram
- `normalize` 导出供外部复用
- `freshRepeatState` 新增 `dismissCount` 字段

### Step 2: 修复 projection — 新增 `lastAssistantMessageID` / `lastAssistantMessageGroupKey`

**文件**：`packages/app/src/pages/session/timeline/projection.ts`

```ts
const lastAssistantMessageID = createMemo(() => {
  let lastID = ""
  rows().forEach((row) => {
    if (row._tag === "AssistantPart") lastID = row.userMessageID
  })
  return lastID
})
const lastAssistantMessageGroupKey = createMemo(() => {
  let lastKey = ""
  rows().forEach((row) => {
    if (row._tag === "AssistantPart") lastKey = row.group.key
  })
  return lastKey
})

return {
  // ... 原有（含 lastAssistantGroupKey，保持向后兼容）
  lastAssistantMessageID,
  lastAssistantMessageGroupKey,
}
```

---

### Step 3: 修复 CaptureButton / HandoffButton / workingTurn 条件（Bug C）

**文件**：`packages/app/src/pages/session/timeline/message-timeline.tsx`

```tsx
// L381 — projection destructuring
const lastAssistantMessageID = projection.lastAssistantMessageID
const lastAssistantMessageGroupKey = projection.lastAssistantMessageGroupKey

// L1009 — workingTurn（ContextToolGroup busy 条件）
workingTurn(row().userMessageID) &&
row().userMessageID === lastAssistantMessageID() &&
row().group.key === lastAssistantMessageGroupKey()

// L1169-1210 — AssistantPart 渲染
case "AssistantPart": {
  const assistantPartRow = row as Accessor<TimelineRowByTag<"AssistantPart">>
  const isLastAssistant = () =>
    assistantPartRow().userMessageID === lastAssistantMessageID() &&
    assistantPartRow().group.key === lastAssistantMessageGroupKey()
  const isWorking = () => workingTurn(assistantPartRow().userMessageID)
  return (
    <TimelineRowFrame row={assistantPartRow}>
      <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
        {/* CaptureButton — ABOVE content, near copy interaction area */}
        <Show when={isLastAssistant() && !isWorking() && props.actions?.capture}>
          <div class="flex items-center justify-end mb-1.5">
            <CaptureButton onClick={props.actions!.capture!} label={language.t("chatCapture.captureAsAsset")} />
          </div>
        </Show>
        <div data-slot="session-turn-assistant-content" aria-hidden={isWorking()}>
          {renderAssistantPartGroup(assistantPartRow, onSizeChange)}
          <Show when={isLastAssistant() && !isWorking() && handoffs().length > 0 && props.actions?.handoff}>
            <HandoffButton actions={...} />
          </Show>
        </div>
      </div>
    </TimelineRowFrame>
  )
}
```

**三处同步修正**：CaptureButton 条件、HandoffButton 条件、ContextToolGroup busy 条件，全部从 `lastAssistantGroupKey` 改为 `lastAssistantMessageID + lastAssistantMessageGroupKey`。

---

### Step 4: 重写 session.tsx 重复检测 + 状态机（Bug A + B + D）

**4.1 替换 import**：
```ts
import { countSimilarPrompts, extractUserPrompts, freshRepeatState } from "@/components/chat/repeat-detection"
```

**4.2 状态初始化**：
```ts
const [suggestion, setSuggestion] = createStore(freshRepeatState())
```

**4.3 替换重复检测逻辑**（onSuccess 回调内）：
```ts
if (promptText) {
  const messages = timeline.messages()
  const getParts = (messageID: string) => sync().data.part[messageID] ?? []
  const userPrompts = extractUserPrompts(messages, getParts)
  // History = prompts before the current one
  const history = userPrompts.slice(0, -1)
  const match = countSimilarPrompts(promptText, history)
  if (match && !suggestion.show) {
    if (suggestion.dismissCount === 0 || match.count > suggestion.dismissCount) {
      setSuggestion("show", true)
      setSuggestion("message", language.t("chatCapture.repeatSuggestion"))
    }
  }
}
```

**注意**：`slice(0, -1)` 排除当前 prompt，因为 `timeline.messages()` 在 `onSuccess` 时已包含刚发送的消息。

**4.4 更新 SuggestionBar 回调**：
```tsx
<SuggestionBar
  show={suggestion.show}
  message={suggestion.message}
  onAccept={() => {
    setSuggestion(freshRepeatState())
    capture()
  }}
  onDismiss={() => {
    const messages = timeline.messages()
    const getParts = (messageID: string) => sync().data.part[messageID] ?? []
    const userPrompts = extractUserPrompts(messages, getParts)
    const lastPrompt = userPrompts[userPrompts.length - 1] ?? ""
    const match = countSimilarPrompts(lastPrompt, userPrompts.slice(0, -1))
    setSuggestion("show", false)
    setSuggestion("dismissCount", match?.count ?? 0)
  }}
/>
```

---

### Step 5: 测试

| # | 测试文件 | 内容 |
|---|---|---|
| 1 | `repeat-detection.test.ts` | 纯函数测试：`countSimilarPrompts` 阈值 3、`extractUserPrompts`（无 dedup）、CJK bigram 相似度、`freshRepeatState` |

i18n 无新增 key（已有 `chatCapture.captureAsAsset` / `repeatSuggestion` / `sourceLabel` 足够）。

### Step 6: 全量验证

```bash
bun --cwd packages/app typecheck
bun --cwd packages/app test --preload ./happydom.ts ./src/components/chat/repeat-detection.test.ts ./src/components/chat/capture-helpers.test.ts
bun run lint
```

**手动冒烟清单**：

| # | 场景 | 预期 |
|---|---|---|
| 1 | Coding 会话发送 3 次相似 prompt（如"写个 React 组件"变体） | 第 3 次发送后 SuggestionBar 出现 |
| 2 | 前 2 次相似 prompt | 无 SuggestionBar |
| 3 | Dismiss SuggestionBar 后再发 1 次相似 | 再次出现（`match.count > dismissCount`） |
| 4 | 点击"存为资产" | capture() 执行，SuggestionBar 重置为 freshRepeatState |
| 5 | 切换会话 A → B，B 中发相似内容 | 不与会话 A 的历史交叉比对 |
| 6 | 最后一条 assistant 消息上方有 CaptureButton | 靠近代码块 copy 按钮交互区；其他 assistant 消息无按钮 |
| 7 | Chat 模式会话无 CaptureButton | ✅ |
| 8 | Streaming 中的 assistant 消息无 CaptureButton | ✅ |

---

## 4. 数据流

```text
用户发送 prompt
  │
  ├─► timeline.messages() + sync().data.part → extractUserPrompts(messages, getParts)
  │     │ 天然按 session 隔离（从 params.id 的 messages 派生）
  │     │ 无 dedup → duplicate prompts 正确计入 count
  │     │
  │     └─► countSimilarPrompts(currentPrompt, history)
  │           │ history = userPrompts.slice(0, -1)
  │           │ count ≥ 3 → SuggestionBar 出现
  │           │
  │           ├─ onAccept → freshRepeatState() + capture() → 新 chat draft
  │           └─ onDismiss → dismissCount 记录 → 允许后续再次触发

Timeline 渲染 assistant 消息
  │
  └─► lastAssistantMessageID() + lastAssistantMessageGroupKey()
        │
        ├─► CaptureButton 在 content 上方（仅最后一条 + 已完成）
        ├─► HandoffButton 条件（同上）
        └─► ContextToolGroup busy 条件（同上）
```

---

## 5. 改动文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/app/src/components/chat/repeat-detection.ts` | 重写 | 纯函数 + CJK bigram + 无 dedup |
| `packages/app/src/components/chat/repeat-detection.test.ts` | 重写 | 新算法测试 |
| `packages/app/src/pages/session/timeline/projection.ts` | 改 | 新增 `lastAssistantMessageID` / `lastAssistantMessageGroupKey` |
| `packages/app/src/pages/session/timeline/message-timeline.tsx` | 改 | CaptureButton 移到 content 上方 + HandoffButton/workingTurn 条件同步修正 |
| `packages/app/src/pages/session.tsx` | 改 | import + 状态机 + SuggestionBar 回调 |

**不涉及的文件**（无需改动）：
- `capture-button.tsx` — UI 正确
- `suggestion-bar.tsx` — 展示层正确
- `capture-helpers.ts` — 内容提取逻辑正确
- `schema/session-capture.ts` — 类型定义正确
- `i18n/en.ts` / `zh.ts` — 无新增 key 需求

---

## 6. 执行顺序

```text
Step 1 (repeat-detection 重写 + 测试)
  ↓
Step 2 (projection 新增信号)
  ↓
Step 3 (message-timeline 条件修正 + 重新定位)
  ↓
Step 4 (session.tsx 状态机重写)
  ↓
Step 5 (测试 + 验证)
```

---

## 7. 风险与回滚

| 风险 | 缓解 |
|------|------|
| `extractUserPrompts` 与 `timeline.messages()` 的时序（onSuccess 时是否已含当前 prompt） | `slice(0, -1)` 排除最后一条；onSuccess 在 sendFollowupDraft 网络返回后触发，此时 sync 已含最新消息 |
| CJK bigram 中文相似度阈值敏感 | 差异 2 字符 + 汉语词组时 ≈ 0.7。测试已验证通过 |
| projection 新增信号与现有 row 遍历性能 | 两个信号各 O(n)，行数 < 10K 可忽略 |
| 语义变更影响 HandoffButton 渲染 | Step 3 同时修正 HandoffButton + workingTurn + CaptureButton，全部使用 `isLastAssistant()` 共享逻辑 |

**回滚**：本分支只改 `packages/app/src/` 内的文件，无 schema migration，revert 安全。
