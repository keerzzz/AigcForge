# Plan：Chat 模式元智能体对话挂起 + 会话列表跨模式泄漏修复

> 状态：Draft（待批准）
> 范围：`packages/app` + `packages/aigcfroge` + `packages/session-ui`
> 关联：[ADR-13](../architecture/adr/ADR-13-chat-work-mode-boundary.md)、[Chat PRD](../prd/chat-mode-creation-layer.md)、[M2 plan](chat-asset-studio-m2.md)
> 最后更新：2026-07-24

---

## 1. 问题现象

1. chat 模式选「元智能体(meta)」agent 发对话 -> 一直显示「思考中」，无任何输出。
2. 上下文 tab 的原始消息只有 user 记录，无 assistant。
3. code 模式下完全正常（同一 provider `opencode-go`）。
4. code 模式会话列表里出现了 chat 模式创建的会话（跨模式泄漏）。

## 2. 根因（日志 + DB + 代码三方闭合）

### 2.1 chat 挂起的完整链路

| 步  | 位置                                                                                                                | 发生                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 前端 [local.tsx:67](../../packages/app/src/context/local.tsx#L67)                                                   | agent 选择器列表 `filter(mode !== "subagent" && !hidden)`，**不按产品模式过滤**；chat 模式可选到 `meta`                                                                            |
| 2   | 后端 [prompt.ts:1186](../../packages/aigcfroge/src/session/prompt.ts#L1186)                                         | `enforcePrimary("chat", "meta")` -> `Effect.die(AgentNotAllowedError)`，发生在 `loop()`(1200) 之前                                                                                 |
| 3   | [runner.ts:76](../../packages/aigcfroge/src/effect/runner.ts#L76)                                                   | runLoop 未启动 -> Runner `onIdle` 永不触发 -> **无 `session.status` idle 事件**                                                                                                    |
| 4   | [handlers/session.ts:456-463](../../packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts#L456) | `catchCause` 只 `logError` + `publish(Session.Event.Error)`，**不调 `status.set(idle)`**                                                                                           |
| 5   | 前端 [event-reducer.ts:106-389](../../packages/app/src/context/global-sync/event-reducer.ts#L106)                   | **无 `"session.error"` 分支** -> `session_status` 保持乐观 busy（[submit.ts:64](../../packages/app/src/components/prompt-input/submit.ts#L64)）-> `working()` 永真 -> spinner 永转 |
| 6   | [prompt.ts:1331](../../packages/aigcfroge/src/session/prompt.ts#L1331)                                              | runLoop 未执行 -> assistant 占位未写 -> 无 `message.updated`                                                                                                                       |
| 7   | 前端 [session-context-tab.tsx:94,434](../../packages/app/src/components/session/session-context-tab.tsx#L94)        | 读 V1 event store，不过滤 finish；占位事件没进 store -> **「只有 user 消息」**（非 UI 过滤，是真没写）                                                                             |

**日志铁证**（今天 7-24 所有 chat session）：

```
prompt_async failed cause="Cause([Die(AgentNotAllowedError:
  Agent "meta" is not allowed in mode "chat": Only chat-orchestrator is allowed in chat mode)])"
```

**DB 实测**：今天 3 个 meta chat session 的 `message` / `session_message` / `session_input` 全空；7-21 的 `ses_07be434a`（chat-orchestrator）有 user + assistant 占位（`finish: undefined`）。

### 2.2 code 模式正常的原因

[product-mode-agent-policy.ts:78-86](../../packages/core/src/product-mode-agent-policy.ts#L78) 对非 chat 模式不限制 agent，`meta` 可用，policy 不 die，runLoop 正常启动。

### 2.3 会话列表跨模式泄漏

- coding 模式用 [sidebar-workspace.tsx:326,474](../../packages/app/src/pages/layout/sidebar-workspace.tsx#L326) 的 `sessions = sortedRootSessions(...)`，[helpers.ts:25](../../packages/app/src/pages/layout/helpers.ts#L25) `isRootVisibleSession` **不按 mode 过滤**。
- 加载端 [layout.tsx:567](../../packages/app/src/context/layout.tsx#L567)、[sidebar-workspace.tsx:345,481](../../packages/app/src/pages/layout/sidebar-workspace.tsx#L345) `loadSessions(directory)` **不传 mode** -> 拉所有模式会话。
- 对比 ChatSessionList 双重过滤（加载 `{mode:"chat"}` + 渲染 `.filter(mode==="chat")`）。
- [secondary-sidebar.tsx:665](../../packages/app/src/components/secondary-sidebar.tsx#L665) 注释写「对齐 code session list」，但 code 端实际没过滤 —— 注释与实现不符。

### 2.4 独立加剧因素（subagent B 发现）

openai-compatible provider **无默认 `chunkTimeout`**（[provider.ts:208](../../packages/aigcfroge/src/provider/provider.ts#L208) 仅 `headerTimeout:10s` 覆盖首字节）。即使用对 chat-orchestrator，opencode-go 若在 SSE 阶段 stall 也会永久挂起。这是独立的健壮性缺口，本 plan 顺带处理。

---

## 3. 修复方案

按「复用 -> 删除 -> 归并 -> 重构 -> 新增」优先级，治本与兜底分层。

### 3.1 前端：chat 模式 agent 选择锁定 chat-orchestrator（治本）

**问题**：[local.tsx:67](../../packages/app/src/context/local.tsx#L67) agent 列表不按 mode 过滤，chat 模式能选 meta/plan/build。

**改法**：`local.tsx` 引入 `useMode`，`list` memo 按 `currentMode` 过滤：

- `chat` 模式：仅保留 `chat-orchestrator`（id 来自 `ProductModeAgentPolicy.CHAT_ORCHESTRATOR`）
- 其他模式：保持原逻辑（排除 chat-orchestrator，避免误选）

**兜底**：[submit.ts](../../packages/app/src/components/prompt-input/submit.ts) 发送 prompt 时，若 `session.mode === "chat"` 强制 `agent = "chat-orchestrator"`（防 UI 绕过 / 旧 session 残留 agent）。

**复用**：`ProductModeAgentPolicy.resolvePrimaryAgent(mode)` 已有 chat->chat-orchestrator 映射，直接复用。

### 3.2 后端：handler `catchCause` 设 session idle（治本）

**问题**：[handlers/session.ts:456-463](../../packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts#L456) `catchCause` 只 publish Error，不设 idle。

**改法**：`catchCause` 内追加 `yield* status.set(sessionID, { type: "idle" })`。`status.set(idle)` 会 `publish(Event.Status)` + `publish(Event.Idle)`（[status.ts:80-82](../../packages/aigcfroge/src/session/status.ts#L80)），前端 event-reducer 的 `session.status` 分支收到后清 `session_status` -> `working()` 转 false。

**覆盖范围**：所有 `promptSvc.prompt` 的失败（含 1186 die、runLoop 外任何抛错）都会清 busy，不再卡死。

**注意**：`status` Service 需在 handler 依赖中可用（已有 `SessionStatus.Service`，确认 provide）。

### 3.3 前端：event-reducer 加 `session.error` 分支（健壮兜底）

**问题**：[event-reducer.ts:106](../../packages/app/src/context/global-sync/event-reducer.ts#L106) switch 无 `session.error` 分支，error 事件只弹 toast（[notification.tsx:290](../../packages/app/src/components/notification.tsx#L290)），不清 working。

**改法**：加 `case "session.error"` 分支：取 `props.sessionID`，`setStore("session_status", sessionID, { type: "idle" })`。

**事件 schema**（[session.ts:334-342](../../packages/aigcfroge/src/session/session.ts#L334)）：`sessionID` 是 `Schema.optional`，需判空（无 sessionID 时跳过，不误清）。

**意义**：即使后端某条路径漏设 idle（如 V2 native 路径），前端也能兜底清 loading。与 3.2 双保险。

### 3.4 会话列表按 mode 过滤

**改法 A（渲染端，必做）**：[sidebar-workspace.tsx:326,474](../../packages/app/src/pages/layout/sidebar-workspace.tsx#L326) 两处 `sessions` memo 追加 `.filter(s => (s.mode ?? "coding") === "coding")`，复用 ChatSessionList 的 `(s.mode ?? "coding")` 惯例。

**改法 B（加载端，可选优化）**：[layout.tsx:567](../../packages/app/src/context/layout.tsx#L567)、[sidebar-workspace.tsx:345,481](../../packages/app/src/pages/layout/sidebar-workspace.tsx#L345) `loadSessions(directory, { mode: "coding" })`，让 code 的 store 只含 coding 会话（减少不必要数据，与 chat 的 bucket 分离）。

**不改** `helpers.ts` 的 `isRootVisibleSession`（避免影响其他调用方，如 ChatSessionList 也用 `sortedRootSessions`）。

### 3.5（可选）openai-compatible chunkTimeout

**问题**：[provider.ts:208](../../packages/aigcfroge/src/provider/provider.ts#L208) openai 路径只设 `headerTimeout`，SSE chunk stall 无超时。

**改法**：openai-compatible 路径加默认 `chunkTimeout`（如 60s），`wrapSSE` 在 `chunkTimeout>0` 时生效（[provider.ts:1719,1739](../../packages/aigcfroge/src/provider/provider.ts#L1719)），stall 时 abort -> 触发 `onError` -> `halt` publish Error + idle。

**范围**：独立健壮性改进，可单独 commit 或本轮一起做。

---

## 4. 验证

| 场景                             | 期望                                                                    |
| -------------------------------- | ----------------------------------------------------------------------- |
| chat 模式选 meta（若 UI 仍放行） | 不卡思考中；显示「chat 模式只允许 chat-orchestrator」错误；loading 清除 |
| chat 模式默认 chat-orchestrator  | 正常对话出 assistant                                                    |
| chat 模式切到 code 模式          | 会话列表不显示 chat 会话                                                |
| code 模式会话列表                | 只含 coding 会话                                                        |
| 后端任意 prompt 失败（模拟 die） | UI 收到 error + loading 清除                                            |
| openai-compatible SSE stall      | 60s 超时 abort，不永久挂起（若做 3.5）                                  |

**命令**：

- `bun --cwd packages/app typecheck` + `bun --cwd packages/aigcfroge typecheck` + `bun --cwd packages/session-ui typecheck`
- `bun --cwd packages/app test`（event-reducer / submit 相关）
- `bun --cwd packages/aigcfroge test`（handler / policy 相关）
- `bun run lint`

## 5. 风险与回滚

| 风险                                             | 缓解                                                           |
| ------------------------------------------------ | -------------------------------------------------------------- |
| 3.1 local.tsx 引入 useMode 破坏现有 agent 选择   | 仅过滤 chat 模式，其他模式逻辑不变；typecheck + 手动验证       |
| 3.2 handler 多调 `status.set(idle)` 影响正常流程 | idle 是幂等；正常流程 runLoop 的 `finishRun` 也设 idle，不冲突 |
| 3.3 event-reducer 误清正常会话的 busy            | `sessionID` 判空；仅 error 事件触发，正常 busy 不发 error      |
| 3.4 会话列表过滤导致历史无 mode 会话消失         | `s.mode ?? "coding"` 把 null 当 coding，历史会话保留           |
| 3.5 chunkTimeout 误杀慢响应                      | 60s 足够宽；可配置                                             |

回滚：每项独立 commit，按需 revert。

## 6. 实施步骤

1. **3.1** local.tsx 引入 useMode + list 按 mode 过滤 + submit.ts 兜底强制 chat-orchestrator
2. **3.2** handlers/session.ts catchCause 加 `status.set(idle)`
3. **3.3** event-reducer.ts 加 `session.error` 分支
4. **3.4** sidebar-workspace.tsx 渲染过滤 + loadSessions 传 mode
5. **3.5**（可选）provider.ts openai chunkTimeout
6. typecheck + test + lint
7. 手动验证 chat 模式对话 + code 模式会话列表

## 7. 非目标

- 不改 ADR-13 的 chat 模式 agent 限制语义（chat 只允许 chat-orchestrator 是设计，不变）。
- 不改 V2 native session 路径（`AIGCFROGE_V2_RUNTIME=true` 走 `v2session.prompt`，本 plan 只修 V1 `promptSvc` 路径；3.3 的 event-reducer 兜底对 V2 也有效）。
- 不修 7-21 历史 `ERR_MODULE_NOT_FOUND`（plugin/src/tool.ts 已存在，已修复）。
- 不做 agent 选择器 UI 重设计（仅过滤逻辑）。
